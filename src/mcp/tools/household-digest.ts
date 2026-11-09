import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import {
    buildHouseholdDigestForViewer,
    parseDigestWeekEnd,
} from "../../db/household-digest.js";
import { gatedTool } from "../gated.js";
import { isViewerFlagOn } from "../../viewer-flags.js";
import type {
    HouseholdDigest,
    HouseholdDigestMemberNutrition,
} from "../../domain/household-digest.js";
import type { ToolContext } from "../shared.js";

const DIGEST_TARGET_SCHEMA = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("full"),
        value: z.number(),
        averaged: z.boolean(),
    }),
    z.object({
        kind: z.literal("partial"),
        covered: z.number(),
        total: z.number(),
    }),
    z.object({ kind: z.literal("none") }),
]);

const EXPIRING_ITEM_SCHEMA = z.object({
    fridge_item_id: z.string(),
    display_name: z.string(),
    expires_on: z.string(),
    quantity_amount: z.number(),
    quantity_unit: z.string(),
    days_left: z.number(),
});

const RAN_OUT_SCHEMA = z.object({
    movement_id: z.string(),
    food_id: z.string(),
    display_name: z.string(),
    at: z.string(),
    reason: z.enum(["cook", "eat", "discard", "adjust", "purchase"]),
});

const DAY_NUTRITION_SCHEMA = z.object({
    date: z.string(),
    calories: z.number(),
    protein_g: z.number(),
    calorie_goal: z.number().nullable(),
    protein_goal: z.number().nullable(),
    calorie_grade: z.enum(["on_target", "under", "over", "no_goal"]),
});

const MEMBER_NUTRITION_SCHEMA = z.object({
    member_id: z.string(),
    display_name: z.string(),
    days_logged: z.number(),
    window_days: z.number(),
    avg_calories: z.number(),
    calorie_target: DIGEST_TARGET_SCHEMA,
    avg_protein_g: z.number(),
    protein_target: DIGEST_TARGET_SCHEMA,
    best_day: z
        .object({
            date: z.string(),
            calories: z.number(),
            calorie_goal: z.number().nullable(),
        })
        .nullable(),
    roughest_day: z
        .object({
            date: z.string(),
            calories: z.number(),
            calorie_goal: z.number().nullable(),
        })
        .nullable(),
    summary: z.string(),
    days: z.array(DAY_NUTRITION_SCHEMA),
});

const SUGGESTION_SCHEMA = z.object({
    food_id: z.string(),
    display_name: z.string(),
    store_id: z.string(),
    quantity_amount: z.number(),
    quantity_unit: z.string(),
    source: z.enum(["restock", "usual"]),
});

export const HOUSEHOLD_DIGEST_OUTPUT_SCHEMA = z.object({
    timezone: z.string(),
    today: z.string(),
    window: z.object({ from: z.string(), to: z.string() }),
    expiring: z.array(EXPIRING_ITEM_SCHEMA),
    ran_out: z.array(RAN_OUT_SCHEMA),
    members: z.array(MEMBER_NUTRITION_SCHEMA),
    suggestions: z.array(SUGGESTION_SCHEMA),
    text: z.string(),
});

type WireDigest = z.infer<typeof HOUSEHOLD_DIGEST_OUTPUT_SCHEMA>;

function memberToWire(
    member: HouseholdDigestMemberNutrition,
): WireDigest["members"][number] {
    return {
        member_id: member.memberId,
        display_name: member.displayName,
        days_logged: member.daysLogged,
        window_days: member.windowDays,
        avg_calories: member.avgCalories,
        calorie_target: member.calorieTarget,
        avg_protein_g: member.avgProtein_g,
        protein_target: member.proteinTarget,
        best_day: member.bestDay
            ? {
                  date: member.bestDay.date,
                  calories: member.bestDay.calories,
                  calorie_goal: member.bestDay.calorieGoal,
              }
            : null,
        roughest_day: member.roughestDay
            ? {
                  date: member.roughestDay.date,
                  calories: member.roughestDay.calories,
                  calorie_goal: member.roughestDay.calorieGoal,
              }
            : null,
        summary: member.summary,
        days: member.days.map((day) => ({
            date: day.date,
            calories: day.calories,
            protein_g: day.protein_g,
            calorie_goal: day.calorieGoal,
            protein_goal: day.proteinGoal,
            calorie_grade: day.calorieGrade,
        })),
    };
}

export function householdDigestToWire(digest: HouseholdDigest): WireDigest {
    return {
        timezone: digest.timezone,
        today: digest.today,
        window: digest.window,
        expiring: digest.expiring.map((item) => ({
            fridge_item_id: item.fridgeItemId,
            display_name: item.displayName,
            expires_on: item.expiresOn,
            quantity_amount: item.quantityAmount,
            quantity_unit: item.quantityUnit,
            days_left: item.daysLeft,
        })),
        ran_out: digest.ranOut.map((row) => ({
            movement_id: row.movementId,
            food_id: row.foodId,
            display_name: row.displayName,
            at: row.at,
            reason: row.reason,
        })),
        members: digest.members.map(memberToWire),
        suggestions: digest.suggestions.map((s) => ({
            food_id: s.foodId,
            display_name: s.displayName,
            store_id: s.storeId,
            quantity_amount: s.quantityAmount,
            quantity_unit: s.quantityUnit,
            source: s.source,
        })),
        text: digest.text,
    };
}

export function registerHouseholdDigestTools(
    server: McpServer,
    ctx: ToolContext,
) {
    const { auth, callerHouseholdId, requireUser, analytics, alcohol } = ctx;

    async function digestForCaller(weekOf?: string) {
        const viewerUserId = auth.kind === "household" ? null : requireUser();
        const householdId = await callerHouseholdId();
        const digest = await buildHouseholdDigestForViewer(
            auth,
            viewerUserId,
            householdId,
            weekOf,
            alcohol,
        );
        const structuredContent = householdDigestToWire(digest);
        return {
            content: [{ type: "text" as const, text: digest.text }],
            structuredContent,
        };
    }

    gatedTool(
        server,
        ctx,
        "mcp-household-digest",
        "get_household_digest",
        {
            title: "Get Household Digest",
            description:
                "Weekly household digest: expiring fridge items, what ran out, each visible member's nutrition vs per-day goals, and suggested grocery lines. Optional week_of (YYYY-MM-DD) is the last day of the 7-day window; defaults to today in the household timezone.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                week_of: z
                    .string()
                    .optional()
                    .describe(
                        "Last day of the 7-day window (YYYY-MM-DD). Defaults to today in the household timezone.",
                    ),
            }),
            outputSchema: HOUSEHOLD_DIGEST_OUTPUT_SCHEMA,
        },
        async ({ week_of }) => {
            return withAnalytics(
                "get_household_digest",
                async () => {
                    if (week_of != null && week_of !== "") {
                        parseDigestWeekEnd(week_of, "UTC");
                    }
                    return digestForCaller(week_of);
                },
                analytics,
            );
        },
    );

    if (isViewerFlagOn(ctx.flags, "mcp-household-digest")) {
        server.registerResource(
            "weekly-household-digest",
            "household://weekly-digest",
            {
                title: "Weekly Household Digest",
                description:
                    "Rolling household digest: expiring fridge stock, ran-out items, nutrition by member, and grocery suggestions. Good to pull at the start of a weekly check-in.",
                mimeType: "text/plain",
            },
            async (uri) => {
                const payload = await digestForCaller(undefined);
                return {
                    contents: [
                        {
                            uri: uri.href,
                            mimeType: "text/plain",
                            text: payload.content[0]!.text,
                        },
                    ],
                };
            },
        );
    }
}
