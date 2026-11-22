import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    preferredWeightUnitFromProfile,
    timezoneFromProfile,
    upsertProfile,
    getProfile,
    widgetsEnabledFromProfile,
    alcoholTrackingEnabledFromProfile,
    preferredDrinkUnitFromProfile,
} from "../../db/profiles.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, validateTz } from "../../domain/tz.js";
import { isWeightUnit } from "../../domain/units.js";
import { isDrinkUnit, type DrinkUnit } from "../../alcohol.js";
import { formatClockLine, drinkUnitLabel } from "../shared.js";
import type { ToolContext } from "../shared.js";

export function registerProfilePreferenceTools(
    server: McpServer,
    ctx: ToolContext,
) {
    const { alcohol, personSchema, writeUserId, analytics } = ctx;
    server.registerTool(
        "set_weight_unit",
        {
            title: "Set Weight Unit",
            description:
                "Set the user's preferred weight unit ('kg' or 'lb'), or pass null to clear it. This controls how weights are shown and how a bare number is interpreted when logging without an explicit unit. Stored weights are unaffected (they are canonical) — only display and default parsing change. While unset, logging requires an explicit unit and weights display in kg.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                unit: z
                    .enum(["kg", "lb"])
                    .nullable()
                    .describe(
                        "Preferred weight unit: 'kg' or 'lb'. Pass null to clear the preference.",
                    ),
            }),
        },
        async ({ unit, user_id }) => {
            return withAnalytics(
                "set_weight_unit",
                async () => {
                    const userId = await writeUserId(user_id, undefined);
                    if (unit !== null && !isWeightUnit(unit)) {
                        throw new Error(
                            `Invalid weight unit: ${unit}. Use 'kg', 'lb', or null to clear.`,
                        );
                    }
                    const profile = await upsertProfile(userId, {
                        preferred_weight_unit: unit,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: profile.preferred_weight_unit
                                    ? `Preferred weight unit set to ${profile.preferred_weight_unit}.`
                                    : "Preferred weight unit cleared. Logging will require an explicit unit until you set one, and weights display in kg.",
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "set_widget_display",
        {
            title: "Set Widget Display",
            description:
                "Enable or disable the in-chat visual widgets (nutrition dashboard, goal progress, meal-logged rings, trends, weight charts). When disabled, the same tools still return their full text and data — just no rendered widget. Widgets are enabled by default. Note: hosts read the widget list when a session connects, so the change takes effect in new conversations; an already-open chat may keep showing widgets until it reconnects.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                enabled: z
                    .boolean()
                    .describe(
                        "true to show widgets (default), false for text-only responses with no widget.",
                    ),
            }),
        },
        async ({ enabled, user_id }) => {
            return withAnalytics(
                "set_widget_display",
                async () => {
                    const userId = await writeUserId(user_id, undefined);
                    const profile = await upsertProfile(userId, {
                        widgets_enabled: enabled,
                    });
                    return {
                        content: [
                            {
                                type: "text",
                                text: profile.widgets_enabled
                                    ? "Widgets enabled. Supported tools will show a visual widget alongside their text in new conversations."
                                    : "Widgets disabled. Supported tools will return text and data only, with no widget, in new conversations.",
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "set_alcohol_tracking",
        {
            title: "Set Alcohol Tracking",
            description:
                "Turn alcohol tracking on or off for the user, and optionally choose whether drinks are counted in US standard drinks (14 g of ethanol) or UK units (7.9 g). Off by default. Alcohol grams passed to log_meal, update_meal or bulk_import_meals are stored either way — this setting controls whether alcohol is shown in meals, goals and progress. One exception, which matters BEFORE a backfill: the file importer (start_meal_import) skips the file's alcohol column entirely while tracking is off, because it will not write a figure the user was never shown for review — and re-importing the same file later does not backfill it. So if the user wants alcohol from an export, turn this on first. Offer it when the user asks to track drinking; do not enable it on your own initiative, and if they ask to stop seeing alcohol, disable it here rather than deleting their meals. The change is live immediately — the next tool call in this same conversation already honours it, with nothing to reconnect or restart.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                enabled: z
                    .boolean()
                    .describe(
                        "true to show alcohol in meals, goals and progress; false to hide it (stored values are kept either way).",
                    ),
                drink_unit: z
                    // `satisfies` keeps this in step with DrinkUnit at compile
                    // time; z.enum needs the literal tuple, not the exported
                    // readonly array.
                    .enum(["us", "uk"] as const satisfies readonly DrinkUnit[])
                    .optional()
                    .describe(
                        "Which standard drink to show alongside grams: 'us' (14 g per drink) or 'uk' (7.9 g per unit). Defaults to 'us' when never set. Ask the user rather than inferring it from their language.",
                    ),
            }),
        },
        // No "takes effect next conversation" caveat here, unlike
        // set_widget_display. That caveat is true for widgets because
        // widgets_enabled decides each tool's _meta.ui link, which a host only
        // re-reads on tools/list. Alcohol touches no registration metadata: it
        // is threaded into handlers as `alcohol`, and handleMcp builds a fresh
        // McpServer per POST (sessionIdGenerator: undefined) with buildMcpServer
        // re-reading the profile every time — so the very next tool call, in the
        // same open chat, already sees the new setting.
        async ({ enabled, drink_unit, user_id }) => {
            return withAnalytics(
                "set_alcohol_tracking",
                async () => {
                    const userId = await writeUserId(user_id, undefined);
                    const profile = await upsertProfile(userId, {
                        alcohol_tracking_enabled: enabled,
                        // Left untouched when omitted, so toggling tracking off
                        // and on again does not reset the unit.
                        ...(drink_unit !== undefined
                            ? { preferred_drink_unit: drink_unit }
                            : {}),
                    });
                    const unit = isDrinkUnit(profile.preferred_drink_unit)
                        ? profile.preferred_drink_unit
                        : "us";
                    return {
                        content: [
                            {
                                type: "text",
                                text: profile.alcohol_tracking_enabled
                                    ? `Alcohol tracking enabled, shown in grams alongside ${drinkUnitLabel(unit)}. It appears in meals, goals and daily progress from your next tool call — no need to start a new chat.`
                                    : "Alcohol tracking disabled, effective immediately. Alcohol is no longer shown in meals, goals or progress; anything already logged is kept and reappears if you turn it back on.",
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );
}

export function registerProfileTools(server: McpServer, ctx: ToolContext) {
    const {
        widgetsEnabled,
        alcohol,
        personSchema,
        actorUserId,
        writeUserId,
        analytics,
    } = ctx;
    server.registerTool(
        "get_profile",
        {
            title: "Get Profile",
            description:
                "Get the user's current settings in one call: timezone (plus local date and time), preferred weight unit, whether in-chat widgets are shown, and whether alcohol tracking is on — everything set_timezone, set_weight_unit, set_widget_display and set_alcohol_tracking each control. Prefer this over guessing a setting from context, and use it once instead of calling several separate settings tools when you need more than one.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({}),
        },
        async (args) => {
            return withAnalytics(
                "get_profile",
                async () => {
                    const userId = await actorUserId(args.user_id, "read");
                    const profile = await getProfile(userId);
                    const tz = timezoneFromProfile(profile);
                    const weightUnit = preferredWeightUnitFromProfile(profile);
                    const widgetsEnabled = widgetsEnabledFromProfile(profile);
                    const alcoholEnabled =
                        alcoholTrackingEnabledFromProfile(profile);
                    const drinkUnit =
                        preferredDrinkUnitFromProfile(profile) ?? "us";

                    const lines = [
                        tz === null
                            ? `Timezone: not set (defaulting to UTC). ${formatClockLine("UTC")} Call set_timezone to configure one so 'today' matches the user's local calendar day.`
                            : `Timezone: ${tz}. ${formatClockLine(tz)}`,
                        weightUnit
                            ? `Weight unit: ${weightUnit}.`
                            : "Weight unit: not set. Weights display in kg by default, and logging requires an explicit unit ('kg' or 'lb').",
                        widgetsEnabled
                            ? "Widgets: enabled. Supported tools show a visual widget alongside their text."
                            : "Widgets: disabled. Supported tools return text and data only.",
                        alcoholEnabled
                            ? `Alcohol tracking: enabled, displayed in grams alongside ${drinkUnitLabel(drinkUnit)}${preferredDrinkUnitFromProfile(profile) ? "" : " (the default — no preference saved)"}.`
                            : "Alcohol tracking: disabled, so alcohol is hidden from meals, goals and progress. Alcohol already stored is kept, and anything logged with alcohol_g while it is off is still stored. The exception is the file importer, which skips a file's alcohol column while tracking is off and will not backfill it on a later re-import — so enable tracking before importing an export whose alcohol the user wants to keep. Enable it with set_alcohol_tracking.",
                    ];

                    return {
                        content: [
                            {
                                type: "text",
                                text: lines.join("\n"),
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "set_timezone",
        {
            title: "Set Timezone",
            description:
                "Set the user's IANA timezone (e.g. 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Tokyo'). This controls which calendar day meals and water are grouped into — e.g. a meal logged at 11pm in LA counts on that LA day, not the next UTC day — and it is also how a logged_at with no UTC offset is placed on write, which is permanent: correcting the timezone later re-buckets nothing that is already stored. If the user hasn't set one yet and logs a meal or asks about 'today', offer to set it.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                timezone: z
                    .string()
                    .describe(
                        "IANA timezone identifier (e.g. 'America/New_York'). Must be a valid tzdata name.",
                    ),
            }),
        },
        async ({ timezone, user_id }) => {
            return withAnalytics(
                "set_timezone",
                async () => {
                    const userId = await writeUserId(user_id, undefined);
                    if (!validateTz(timezone)) {
                        throw new Error(
                            `Invalid timezone: ${timezone}. Use an IANA identifier like 'America/Los_Angeles' or 'Europe/London'.`,
                        );
                    }
                    await upsertProfile(userId, { timezone });
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Timezone set to ${timezone}. Local today is ${todayInTz(timezone)}.`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    // The clock is the server's to give, not the user's: a host that keeps the
    // wall time out of the model's context otherwise leaves it with no way to
    // resolve "this morning" except asking or guessing (issue #102).
    // get_profile answers this too, but only a model that already suspects a
    // timezone problem thinks to call it — the tool NAME is the discoverable
    // part, which is why this exists as well as the fuller line above.
    server.registerTool(
        "get_current_time",
        {
            title: "Get Current Time",
            description:
                "Get the current date and time in the user's timezone, plus the UTC instant. Call this whenever you need to know what time it is for this user — to resolve 'today', 'this morning', 'an hour ago' or 'last Monday' into a real timestamp — instead of asking the user or guessing. Not needed to log something that is happening now: omit logged_at and the server stamps the current time itself.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: personSchema({}),
        },
        async (args) => {
            return withAnalytics(
                "get_current_time",
                async () => {
                    const userId = await actorUserId(args.user_id, "read");
                    const configuredTz = timezoneFromProfile(
                        await getProfile(userId),
                    );
                    const unset =
                        configuredTz !== null
                            ? ""
                            : " No timezone is set for this account, so this is UTC and may not be the user's actual local time — offer set_timezone.";
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${formatClockLine(configuredTz ?? "UTC")}${unset}`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );
}
