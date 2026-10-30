import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { HOUSEHOLD_CANNOT_DELETE_ACCOUNT } from "../../auth-context.js";
import {
    MEMBER_ROLES,
    householdConfigToWire,
    mergeHouseholdConfig,
    parseHouseholdConfigPatch,
} from "../../household.js";
import { deleteAllUserData } from "../../db/nutrition.js";
import {
    listHouseholdMembers,
    getHouseholdConfig,
    updateHouseholdConfig,
} from "../../db/household.js";
import {
    DELETED_ACCOUNT_ANALYTICS_ID,
    withAnalytics,
} from "../../analytics.js";
import type { ToolContext } from "../shared.js";

export function registerHouseholdTools(server: McpServer, ctx: ToolContext) {
    const {
        auth,
        requireUser,
        callerHouseholdId,
        callerManagerHouseholdId,
        analytics,
    } = ctx;
    const LIST_MEMBERS_OUTPUT_SCHEMA = z.object({
        members: z.array(
            z.object({
                user_id: z.string(),
                display_name: z.string(),
                role: z.enum(MEMBER_ROLES),
            }),
        ),
    });

    server.registerTool(
        "list_members",
        {
            title: "List Household Members",
            description:
                "List household members as user_id, display_name, and role. A household bot token and any household member may call this. Person tools on a household token require user_id set to one of these ids.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: LIST_MEMBERS_OUTPUT_SCHEMA,
        },
        async () => {
            return withAnalytics(
                "list_members",
                async () => {
                    const householdId = await callerHouseholdId();
                    const members = await listHouseholdMembers(householdId);
                    const payload = members.map((member) => ({
                        user_id: member.userId,
                        display_name: member.displayName,
                        role: member.role,
                    }));
                    const lines =
                        payload.length === 0
                            ? "No household members."
                            : payload
                                  .map(
                                      (member) =>
                                          `${member.display_name} (${member.role}) ${member.user_id}`,
                                  )
                                  .join("\n");
                    return {
                        content: [
                            {
                                type: "text",
                                text: lines,
                            },
                        ],
                        structuredContent: { members: payload },
                    };
                },
                analytics,
            );
        },
    );

    const RECIPE_PLACE_KIND_SCHEMA = z.enum([
        "grocery",
        "recipe_site",
        "meal_kit",
        "other",
    ]);
    const HOUSEHOLD_CONFIG_OUTPUT_SCHEMA = z.object({
        name: z.string(),
        recipe_search_places: z.array(
            z.object({
                name: z.string(),
                kind: RECIPE_PLACE_KIND_SCHEMA,
                url: z.string().nullable(),
            }),
        ),
        preferences: z.object({
            constraints: z.array(z.string()),
            budget: z.string().nullable(),
            shopping_cadence: z.string().nullable(),
        }),
    });

    server.registerTool(
        "get_household_config",
        {
            title: "Get Household Config",
            description:
                "Read the household name, recipe search places, and shared preferences. A household bot token and any household member may call this. Writes are household-scoped, not a person user_id.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: HOUSEHOLD_CONFIG_OUTPUT_SCHEMA,
        },
        async () => {
            return withAnalytics(
                "get_household_config",
                async () => {
                    const householdId = await callerHouseholdId();
                    const config = householdConfigToWire(
                        await getHouseholdConfig(householdId),
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${config.name}\nPlaces: ${config.recipe_search_places.map((place) => place.name).join(", ") || "(none)"}`,
                            },
                        ],
                        structuredContent: config,
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "update_household_config",
        {
            title: "Update Household Config",
            description:
                "Merge household name, recipe search places, or shared preferences. Only the household owner, an admin, or the household bot may call this. Places are labels only, not a recipe table.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                name: z.string().min(1).optional(),
                recipe_search_places: z
                    .array(
                        z.object({
                            name: z.string(),
                            kind: RECIPE_PLACE_KIND_SCHEMA,
                            url: z.string().nullable().optional(),
                        }),
                    )
                    .optional(),
                preferences: z
                    .object({
                        constraints: z.array(z.string()).optional(),
                        budget: z.string().nullable().optional(),
                        shopping_cadence: z.string().nullable().optional(),
                    })
                    .optional(),
            }),
            outputSchema: HOUSEHOLD_CONFIG_OUTPUT_SCHEMA,
        },
        async (args) => {
            return withAnalytics(
                "update_household_config",
                async () => {
                    const parsed = parseHouseholdConfigPatch(args);
                    if (!parsed.ok) throw new Error(parsed.error);
                    const householdId = await callerManagerHouseholdId();
                    const current = await getHouseholdConfig(householdId);
                    const config = householdConfigToWire(
                        await updateHouseholdConfig(
                            householdId,
                            mergeHouseholdConfig(current, parsed.value),
                        ),
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Updated ${config.name}`,
                            },
                        ],
                        structuredContent: config,
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "delete_account",
        {
            title: "Delete Account",
            description:
                "Permanently delete the user's account and all associated data (meals, tokens, auth). This action is irreversible. Always confirm with the user before calling this tool. Shared household data (fridge, grocery, recipes, foods) stays. If the user owns the household, ownership passes to an admin, or else the member with the oldest account; mention that before confirming, and suggest they hand ownership to someone in Settings → Household first if they prefer.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                confirm: z
                    .boolean()
                    .describe(
                        "Must be true to confirm deletion. Always ask the user for explicit confirmation before setting this to true.",
                    ),
            }),
        },
        async ({ confirm }) => {
            return withAnalytics(
                "delete_account",
                async () => {
                    if (auth.kind === "household") {
                        throw new Error(HOUSEHOLD_CANNOT_DELETE_ACCOUNT);
                    }
                    const userId = requireUser();
                    if (!confirm) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: "Account deletion cancelled. No data was removed.",
                                },
                            ],
                        };
                    }
                    await deleteAllUserData(userId);
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Your account and all associated data have been permanently deleted.",
                            },
                        ],
                    };
                },
                // deleteAllUserData wipes tool_analytics before anything else,
                // so the row withAnalytics writes once this handler settles
                // must not carry the id it just erased. The cancelled path
                // keeps the request's analytics id (the OAuth user, or hh:<id>
                // for a household token that never reaches a person).
                {
                    ...analytics,
                    userId: confirm
                        ? DELETED_ACCOUNT_ANALYTICS_ID
                        : analytics.userId,
                },
            );
        },
    );
}
