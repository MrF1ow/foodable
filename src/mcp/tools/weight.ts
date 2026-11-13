import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    getNutritionGoals,
    insertWeight,
    getWeightByDate,
    getWeightInRange,
    updateWeight,
    deleteWeight,
} from "../../db/nutrition.js";
import {
    getUserTimezone,
    getPreferredWeightUnit,
    preferredWeightUnitFromProfile,
    timezoneFromProfile,
    getProfile,
} from "../../db/profiles.js";
import type { WeightEntry } from "../../db/nutrition.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, shiftLocalDate, dateInTz } from "../../domain/tz.js";
import { computeWeightTrend } from "../../domain/insights.js";
import { toGrams, formatWeight, fromGrams } from "../../domain/units.js";
import type { WeightUnit } from "../../domain/units.js";
import {
    formatWeightEntry,
    LOGGED_AT_FORMS,
    LOGGED_AT_OMIT_IF_NOW,
    resolveWriteTimestamp,
    resolveWriteWeightUnit,
    assertPlausibleWeight,
    resolveDateWindow,
} from "../shared.js";
import type { ToolContext } from "../shared.js";

export function registerWeightTools(server: McpServer, ctx: ToolContext) {
    const {
        personSchema,
        nutritionWriteSchema,
        actorUserId,
        writeUserId,
        analytics,
        uiMeta,
    } = ctx;
    server.registerTool(
        "log_weight",
        {
            title: "Log Weight",
            description:
                "Log a body-weight measurement. Provide the number in `weight` and its `unit` ('kg' or 'lb'); if you omit the unit, the user's saved preference is used, and if they have no preference set yet the call fails asking you to specify one. IMPORTANT: do NOT convert units yourself — pass the value in whatever unit the user stated and set `unit` accordingly. The server stores weight canonically and converts as needed. Multiple weigh-ins per day are allowed.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                weight: z.coerce
                    .number()
                    .positive()
                    .describe("Body weight value, in `unit` (> 0)."),
                unit: z
                    .enum(["kg", "lb"])
                    .optional()
                    .describe(
                        "Unit of the weight value. Defaults to the user's preferred weight unit.",
                    ),
                logged_at: z
                    .string()
                    .optional()
                    .describe(
                        "When this actually happened (defaults to now). " +
                            LOGGED_AT_FORMS +
                            LOGGED_AT_OMIT_IF_NOW,
                    ),
                notes: z
                    .string()
                    .optional()
                    .describe(
                        "Optional notes (e.g. 'morning, fasted', 'after workout').",
                    ),
                idempotency_key: z
                    .string()
                    .min(1)
                    .max(255)
                    .optional()
                    .describe(
                        "Optional stable key for safe retries. You normally don't need to set this: when omitted, the server derives a stable key from the entry content (including logged_at), so replaying the identical call returns the original entry instead of duplicating it. Pass a UUID only to force-override that behavior.",
                    ),
            }),
        },
        async (args) => {
            return withAnalytics(
                "log_weight",
                async () => {
                    const userId = await writeUserId(
                        args.user_id,
                        args.target_member,
                    );
                    const { iso, note } = await resolveWriteTimestamp(
                        userId,
                        args.logged_at,
                    );
                    const unit = await resolveWriteWeightUnit(
                        userId,
                        args.unit,
                    );
                    const weight_g = toGrams(args.weight, unit);
                    assertPlausibleWeight(weight_g, unit);
                    const { entry, deduplicated } = await insertWeight(userId, {
                        weight_g,
                        logged_at: iso,
                        notes: args.notes,
                        idempotency_key: args.idempotency_key,
                    });
                    const prefix = deduplicated
                        ? "Already logged (idempotent retry)"
                        : "Weight logged";
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${prefix}: ${formatWeight(entry.weight_g, unit)} at ${entry.logged_at}${entry.notes ? ` (${entry.notes})` : ""}. ID: ${entry.id}${note}`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "get_weight",
        {
            title: "Get Weight",
            description:
                "Get weight entries in the user's preferred unit. Omit date/from/to for today; pass date for one local day; pass from and to (inclusive, YYYY-MM-DD) for a range (grouped by day with each day's average). Do not mix date with from/to.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                date: z
                    .string()
                    .optional()
                    .describe(
                        "Single local day (YYYY-MM-DD). Defaults to today.",
                    ),
                from: z
                    .string()
                    .optional()
                    .describe(
                        "Range start (YYYY-MM-DD), inclusive. Requires to.",
                    ),
                to: z
                    .string()
                    .optional()
                    .describe(
                        "Range end (YYYY-MM-DD), inclusive. Requires from.",
                    ),
            }),
        },
        async (args) => {
            return withAnalytics(
                "get_weight",
                async () => {
                    const userId = await actorUserId(args.user_id, "read");
                    const [tz, weightPref] = await Promise.all([
                        getUserTimezone(userId),
                        getPreferredWeightUnit(userId),
                    ]);
                    const unit = weightPref ?? "kg";
                    const window = resolveDateWindow(args, todayInTz(tz));
                    const entries = window.single
                        ? await getWeightByDate(userId, window.start, tz)
                        : await getWeightInRange(
                              userId,
                              window.start,
                              window.end,
                              tz,
                          );
                    if (entries.length === 0) {
                        const empty = window.single
                            ? window.start === todayInTz(tz)
                                ? "No weight logged today."
                                : `No weight logged on ${window.start}.`
                            : `No weight found between ${window.start} and ${window.end}.`;
                        return {
                            content: [{ type: "text", text: empty }],
                        };
                    }
                    if (window.single) {
                        const lines = entries.map((e) =>
                            formatWeightEntry(e, unit),
                        );
                        const label =
                            window.start === todayInTz(tz)
                                ? "Today"
                                : window.start;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `${label} (${entries.length} entr${entries.length === 1 ? "y" : "ies"}):\n\n${lines.join("\n")}`,
                                },
                            ],
                        };
                    }

                    const byDate = new Map<string, WeightEntry[]>();
                    for (const e of entries) {
                        const date = dateInTz(e.logged_at, tz);
                        const existing = byDate.get(date) ?? [];
                        existing.push(e);
                        byDate.set(date, existing);
                    }

                    const sections: string[] = [];
                    for (const [date, dayEntries] of [
                        ...byDate.entries(),
                    ].sort()) {
                        const avgG =
                            dayEntries.reduce((s, e) => s + e.weight_g, 0) /
                            dayEntries.length;
                        const header =
                            dayEntries.length === 1
                                ? `## ${date}`
                                : `## ${date} (avg ${formatWeight(avgG, unit)}, ${dayEntries.length} entries)`;
                        const formatted = dayEntries
                            .map((e) => formatWeightEntry(e, unit))
                            .join("\n");
                        sections.push(`${header}\n${formatted}`);
                    }

                    return {
                        content: [
                            {
                                type: "text",
                                text: sections.join("\n\n"),
                            },
                        ],
                    };
                },
                analytics,
                { date: args.date, from: args.from, to: args.to },
            );
        },
    );

    server.registerTool(
        "get_weight_trends",
        {
            title: "Get Weight Trends",
            description:
                "Weight trend over a window: latest reading, overall change, 7/14/30-day moving averages (to smooth day-to-day noise), min/max, and progress toward the target weight if one is set. Aggregates multiple weigh-ins per day by averaging. Defaults to the last 30 days ending today.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: personSchema({
                days: z.coerce
                    .number()
                    .int()
                    .min(2)
                    .max(365)
                    .optional()
                    .describe("Window size in days (default 30, max 365)."),
                end_date: z
                    .string()
                    .optional()
                    .describe("Window end date YYYY-MM-DD (default today)."),
            }),
            outputSchema: z.object({
                end_date: z.string(),
                unit: z.string(),
                target: z.number().nullable(),
                default_range: z.number(),
                // Per-day weight (same-day weigh-ins averaged) in display units,
                // for logged days within the last 30 days; widget slices 7/14/30.
                days: z.array(
                    z.object({
                        date: z.string(),
                        weight: z.number(),
                    }),
                ),
            }),
            // Link the tool to its interactive weight-trends UI (MCP Apps).
            ...uiMeta("weight-trends"),
        },
        async ({ days, end_date, user_id }) => {
            return withAnalytics(
                "get_weight_trends",
                async () => {
                    const userId = await actorUserId(user_id, "read");
                    const profile = await getProfile(userId);
                    const tz = timezoneFromProfile(profile) ?? "UTC";
                    const unit =
                        preferredWeightUnitFromProfile(profile) ?? "kg";
                    const endDate = end_date ?? todayInTz(tz);
                    const windowDays = days ?? 30;
                    // The widget's toggle offers up to 30 days, so fetch at
                    // least 30 regardless of the requested text window.
                    const seriesDays = Math.max(windowDays, 30);
                    const fetchStart = shiftLocalDate(
                        endDate,
                        -(seriesDays - 1),
                    );
                    const requestedStart = shiftLocalDate(
                        endDate,
                        -(windowDays - 1),
                    );
                    const [entries, goals] = await Promise.all([
                        getWeightInRange(userId, fetchStart, endDate, tz),
                        getNutritionGoals(userId),
                    ]);
                    const targetG = goals?.target_weight_g ?? null;

                    // Text summary respects the requested window.
                    const textEntries =
                        windowDays >= 30
                            ? entries
                            : entries.filter(
                                  (e) =>
                                      dateInTz(e.logged_at, tz) >=
                                      requestedStart,
                              );

                    // Widget series: one value per logged day (same-day
                    // weigh-ins averaged), in display units, within 30 days.
                    const seriesCutoff = shiftLocalDate(endDate, -29);
                    const dailyG = new Map<
                        string,
                        { total: number; count: number }
                    >();
                    for (const e of entries) {
                        const date = dateInTz(e.logged_at, tz);
                        const cur = dailyG.get(date) ?? { total: 0, count: 0 };
                        cur.total += e.weight_g;
                        cur.count += 1;
                        dailyG.set(date, cur);
                    }
                    const widgetDays = [...dailyG.entries()]
                        .filter(([date]) => date >= seriesCutoff)
                        .map(([date, { total, count }]) => ({
                            date,
                            weight: fromGrams(total / count, unit),
                        }))
                        .sort((a, b) => (a.date < b.date ? -1 : 1));

                    return {
                        content: [
                            {
                                type: "text",
                                text: computeWeightTrend(
                                    textEntries,
                                    requestedStart,
                                    endDate,
                                    tz,
                                    targetG,
                                    unit,
                                ),
                            },
                        ],
                        structuredContent: {
                            end_date: endDate,
                            unit,
                            target:
                                targetG != null
                                    ? fromGrams(targetG, unit)
                                    : null,
                            default_range: [7, 14, 30].includes(windowDays)
                                ? windowDays
                                : 30,
                            days: widgetDays,
                        },
                    };
                },
                analytics,
                { days: days ?? 30 },
            );
        },
    );

    server.registerTool(
        "update_weight",
        {
            title: "Update Weight Entry",
            description:
                "Update fields of an existing weight entry. Provide `unit` alongside `weight` (defaults to the user's preferred unit); do NOT convert units yourself.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                id: z.string().describe("UUID of the weight entry to update"),
                weight: z.coerce
                    .number()
                    .positive()
                    .optional()
                    .describe("New weight value, in `unit`."),
                unit: z
                    .enum(["kg", "lb"])
                    .optional()
                    .describe(
                        "Unit of the weight value. Defaults to the user's preferred weight unit.",
                    ),
                logged_at: z
                    .string()
                    .optional()
                    .describe(
                        "When the weight was measured. " + LOGGED_AT_FORMS,
                    ),
                notes: z.string().optional(),
            }),
        },
        async ({
            id,
            weight,
            unit,
            logged_at,
            notes,
            user_id,
            target_member,
        }) => {
            return withAnalytics(
                "update_weight",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const { iso, note } = await resolveWriteTimestamp(
                        userId,
                        logged_at,
                    );
                    const patch: {
                        weight_g?: number;
                        logged_at?: string;
                        notes?: string | null;
                    } = {};
                    // Only require a unit when a new weight value is supplied;
                    // otherwise fall back to kg purely for formatting the result.
                    let displayUnit: WeightUnit;
                    if (weight !== undefined) {
                        displayUnit = await resolveWriteWeightUnit(
                            userId,
                            unit,
                        );
                        patch.weight_g = toGrams(weight, displayUnit);
                        assertPlausibleWeight(patch.weight_g, displayUnit);
                    } else {
                        displayUnit =
                            unit ??
                            (await getPreferredWeightUnit(userId)) ??
                            "kg";
                    }
                    if (iso !== undefined) patch.logged_at = iso;
                    if (notes !== undefined) patch.notes = notes;
                    const entry = await updateWeight(userId, id, patch);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Weight updated:\n${formatWeightEntry(entry, displayUnit)}${note}`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "delete_weight",
        {
            title: "Delete Weight Entry",
            description: "Delete a weight log entry by ID.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                id: z.string().describe("UUID of the weight entry to delete"),
            }),
        },
        async ({ id, user_id, target_member }) => {
            return withAnalytics(
                "delete_weight",
                async () => {
                    const userId = await writeUserId(user_id, target_member);
                    const deleted = await deleteWeight(userId, id);
                    return {
                        content: [
                            {
                                type: "text",
                                text: deleted
                                    ? `Weight entry ${id} deleted.`
                                    : `No weight entry found with id ${id}.`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );
}
