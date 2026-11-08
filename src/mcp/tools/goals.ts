import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    getMealsByDate,
    upsertNutritionGoals,
    getGoalsForDate,
    getNutritionGoals,
    getWaterByDate,
    getLatestWeight,
} from "../../db/nutrition.js";
import {
    getPreferredWeightUnit,
    preferredWeightUnitFromProfile,
    timezoneFromProfile,
    getProfile,
} from "../../db/profiles.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, dateInTz } from "../../domain/tz.js";
import { WIDGET_LOCALE } from "../../routes.js";
import { toGrams, formatWeight, fromGrams } from "../../domain/units.js";
import { MAX_CALORIES } from "../../domain/import.js";
import {
    GOAL_PROGRESS_WIDGET_URI,
    MAX_GOAL_G,
    MAX_GOAL_MG,
    sumMeals,
    nutrientPresence,
    sumWater,
    MEAL_BREAKDOWN_ITEM,
    mealBreakdown,
    GOALS_ITEM,
    TOTALS_ITEM,
    DRINK_UNIT_FIELD,
    goalsPayloadOf,
    totalsPayloadOf,
    formatProgress,
    formatGoals,
    resolveWriteWeightUnit,
    assertPlausibleWeight,
    alcoholHiddenNote,
} from "../shared.js";
import type { ToolContext } from "../shared.js";

export function registerGoalsTools(server: McpServer, ctx: ToolContext) {
    const {
        alcohol,
        personSchema,
        nutritionWriteSchema,
        actorUserId,
        writeUserId,
        analytics,
        uiMeta,
    } = ctx;
    server.registerTool(
        "set_nutrition_goals",
        {
            title: "Set Nutrition Goals",
            description:
                "Set the user's daily calorie and macro targets, and optionally a target body weight. Pass only the fields you want to update — omitted fields keep their previous value. Pass null explicitly to clear a target. Calories, protein, carbs, fat, fiber and water are targets to REACH; sugar, alcohol and caffeine are limits to STAY UNDER, and progress against them is worded accordingly. Every gram target is in grams and the caffeine limit is in MILLIGRAMS. For a limit, 0 is a real value meaning 'none at all' rather than 'unset'. Targets are the user's own choice; this server does not provide medical or dietary advice.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: nutritionWriteSchema({
                // Bounded in the schema for the same reason as log_meal, with
                // the gram ceiling set by the numeric(6,2) goal columns rather
                // than by what a plausible meal carries.
                daily_calories: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_CALORIES)
                    .nullable()
                    .optional()
                    .describe("Daily calorie target (kcal). Null to clear."),
                daily_protein_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_G)
                    .nullable()
                    .optional()
                    .describe("Daily protein target (grams). Null to clear."),
                daily_carbs_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_G)
                    .nullable()
                    .optional()
                    .describe("Daily carbs target (grams). Null to clear."),
                daily_fat_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_G)
                    .nullable()
                    .optional()
                    .describe("Daily fat target (grams). Null to clear."),
                daily_fiber_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_G)
                    .nullable()
                    .optional()
                    .describe(
                        "Daily fiber target (grams), treated as a minimum to reach. Null to clear.",
                    ),
                daily_sugar_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_G)
                    .nullable()
                    .optional()
                    .describe(
                        "Daily TOTAL sugar limit (grams), treated as a maximum to stay under. Total sugars include sugar naturally present in fruit and milk, not only added sugar — say so when the user sets one, since public guidance figures usually refer to ADDED sugar and are therefore a much lower number. Null to clear.",
                    ),
                daily_alcohol_g: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_G)
                    .nullable()
                    .optional()
                    .describe(
                        "Daily alcohol limit in grams of pure ethanol, treated as a maximum to stay under. One US standard drink is 14 g, one UK unit is 7.9 g. Null to clear.",
                    ),
                daily_caffeine_mg: z.coerce
                    .number()
                    .min(0)
                    .max(MAX_GOAL_MG)
                    .nullable()
                    .optional()
                    .describe(
                        "Daily caffeine limit in MILLIGRAMS, treated as a maximum to stay under. Reference points to offer when the user has no figure in mind: the EFSA and FDA ceiling for healthy adults is 400 mg/day and 200 mg in pregnancy, and a 240 ml brewed coffee is about 95 mg — so 400 mg is roughly four cups. 0 is a real limit meaning none at all, not 'unset'. Null to clear.",
                    ),
                daily_water_ml: z.coerce
                    .number()
                    .nullable()
                    .optional()
                    .describe(
                        "Daily water target (milliliters). Null to clear.",
                    ),
                target_weight: z.coerce
                    .number()
                    .positive()
                    .nullable()
                    .optional()
                    .describe(
                        "Target body weight in `unit` (defaults to the user's preferred weight unit). Null to clear.",
                    ),
                unit: z
                    .enum(["kg", "lb"])
                    .optional()
                    .describe(
                        "Unit for target_weight. Defaults to the user's preferred weight unit.",
                    ),
            }),
        },
        async (args) => {
            return withAnalytics(
                "set_nutrition_goals",
                async () => {
                    const userId = await writeUserId(
                        args.user_id,
                        args.target_member,
                    );
                    const [existing, preferredUnit] = await Promise.all([
                        getNutritionGoals(userId),
                        getPreferredWeightUnit(userId),
                    ]);
                    // Only demand a unit when actually writing a numeric target.
                    let target_weight_g: number | null;
                    if (args.target_weight === undefined) {
                        target_weight_g = existing?.target_weight_g ?? null;
                    } else if (args.target_weight === null) {
                        target_weight_g = null;
                    } else {
                        const writeUnit = await resolveWriteWeightUnit(
                            userId,
                            args.unit,
                        );
                        target_weight_g = toGrams(
                            args.target_weight,
                            writeUnit,
                        );
                        assertPlausibleWeight(target_weight_g, writeUnit);
                    }
                    const displayUnit = args.unit ?? preferredUnit ?? "kg";
                    const merged = {
                        daily_calories:
                            args.daily_calories === undefined
                                ? (existing?.daily_calories ?? null)
                                : args.daily_calories,
                        daily_protein_g:
                            args.daily_protein_g === undefined
                                ? (existing?.daily_protein_g ?? null)
                                : args.daily_protein_g,
                        daily_carbs_g:
                            args.daily_carbs_g === undefined
                                ? (existing?.daily_carbs_g ?? null)
                                : args.daily_carbs_g,
                        daily_fat_g:
                            args.daily_fat_g === undefined
                                ? (existing?.daily_fat_g ?? null)
                                : args.daily_fat_g,
                        daily_fiber_g:
                            args.daily_fiber_g === undefined
                                ? (existing?.daily_fiber_g ?? null)
                                : args.daily_fiber_g,
                        daily_sugar_g:
                            args.daily_sugar_g === undefined
                                ? (existing?.daily_sugar_g ?? null)
                                : args.daily_sugar_g,
                        daily_alcohol_g:
                            args.daily_alcohol_g === undefined
                                ? (existing?.daily_alcohol_g ?? null)
                                : args.daily_alcohol_g,
                        daily_caffeine_mg:
                            args.daily_caffeine_mg === undefined
                                ? (existing?.daily_caffeine_mg ?? null)
                                : args.daily_caffeine_mg,
                        daily_water_ml:
                            args.daily_water_ml === undefined
                                ? (existing?.daily_water_ml ?? null)
                                : args.daily_water_ml,
                        target_weight_g,
                    };
                    const goals = await upsertNutritionGoals(userId, merged);
                    // An alcohol target set by someone who has alcohol tracking
                    // off is saved but invisible everywhere else, so say so here
                    // rather than let the goal silently vanish from the list.
                    const alcoholNote = alcoholHiddenNote(
                        args.daily_alcohol_g != null,
                        alcohol,
                        "Alcohol target saved",
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Goals updated.\n\n${formatGoals(goals, displayUnit, alcohol)}${alcoholNote}`,
                            },
                        ],
                    };
                },
                analytics,
            );
        },
    );

    server.registerTool(
        "get_goal_progress",
        {
            title: "Get Goal Progress",
            description:
                "Get progress against daily nutrition goals for a specific date (defaults to today). Renders intake-vs-goal rings plus body-weight progress in clients that support MCP Apps UI, and returns the same data as text elsewhere. Figures are estimates, not medical or dietary advice.",
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
                    .describe("Date in YYYY-MM-DD format. Defaults to today."),
            }),
            outputSchema: z.object({
                date: z.string(),
                meal_count: z.number(),
                water_entries: z.number(),
                drink_unit: DRINK_UNIT_FIELD,
                // The widget's UI language — see the identical field on
                // get_nutrition_summary's outputSchema for why this is
                // Widgets are English-only.
                locale: z.string(),
                goals: GOALS_ITEM.nullable(),
                totals: TOTALS_ITEM,
                weight: z
                    .object({
                        current: z.number().nullable(),
                        target: z.number().nullable(),
                        unit: z.string(),
                        logged_on: z.string().nullable(),
                    })
                    .nullable(),
                meals: z.array(MEAL_BREAKDOWN_ITEM),
            }),
            // Link the tool to its progress UI (MCP Apps).
            ...uiMeta(GOAL_PROGRESS_WIDGET_URI),
        },
        async ({ date, user_id }) => {
            return withAnalytics(
                "get_goal_progress",
                async () => {
                    const userId = await actorUserId(user_id, "read");
                    const profile = await getProfile(userId);
                    const tz = timezoneFromProfile(profile) ?? "UTC";
                    const targetDate = date ?? todayInTz(tz);
                    const [meals, water, goals, latestWeight] =
                        await Promise.all([
                            getMealsByDate(userId, targetDate, tz),
                            getWaterByDate(userId, targetDate, tz),
                            getGoalsForDate(userId, targetDate),
                            getLatestWeight(userId),
                        ]);
                    const unit =
                        preferredWeightUnitFromProfile(profile) ?? "kg";
                    const locale = WIDGET_LOCALE;
                    const totals = sumMeals(meals);
                    totals.water_ml = sumWater(water);
                    const present = nutrientPresence(meals);
                    const header = `Progress for ${targetDate} (${meals.length} meal${meals.length === 1 ? "" : "s"}, ${water.length} water entr${water.length === 1 ? "y" : "ies"})`;
                    const body = formatProgress(
                        totals,
                        goals,
                        alcohol,
                        present,
                    );

                    // Weight is a standing metric (latest overall), not per-date.
                    let weightLine = "";
                    if (latestWeight) {
                        const loggedOn = dateInTz(latestWeight.logged_at, tz);
                        if (goals?.target_weight_g != null) {
                            const delta =
                                latestWeight.weight_g - goals.target_weight_g;
                            const remaining = fromGrams(Math.abs(delta), unit);
                            const goalStr =
                                remaining === 0
                                    ? "at target"
                                    : `${remaining} ${unit} ${delta > 0 ? "to lose" : "to gain"}`;
                            weightLine = `\nWeight: ${formatWeight(latestWeight.weight_g, unit)} / ${formatWeight(goals.target_weight_g, unit)} target (${goalStr}, last logged ${loggedOn})`;
                        } else {
                            weightLine = `\nWeight: ${formatWeight(latestWeight.weight_g, unit)} (last logged ${loggedOn})`;
                        }
                    } else if (goals?.target_weight_g != null) {
                        weightLine = `\nWeight: no entries yet (target ${formatWeight(goals.target_weight_g, unit)}). Log one with log_weight.`;
                    }

                    const footer = goals
                        ? ""
                        : "\n\n(Tip: set daily targets with set_nutrition_goals to see progress percentages.)";

                    // Payload for the goal-progress widget (MCP Apps). Mirrors
                    // the text above: per-macro intake vs goal for the day, plus
                    // the standing weight metric converted to display units.
                    const goalsPayload = goalsPayloadOf(goals, alcohol);
                    const totalsPayload = totalsPayloadOf(
                        totals,
                        alcohol,
                        present.caffeine_mg,
                    );
                    const weightPayload =
                        latestWeight || goals?.target_weight_g != null
                            ? {
                                  current: latestWeight
                                      ? fromGrams(latestWeight.weight_g, unit)
                                      : null,
                                  target:
                                      goals?.target_weight_g != null
                                          ? fromGrams(
                                                goals.target_weight_g,
                                                unit,
                                            )
                                          : null,
                                  unit,
                                  logged_on: latestWeight
                                      ? dateInTz(latestWeight.logged_at, tz)
                                      : null,
                              }
                            : null;

                    return {
                        content: [
                            {
                                type: "text",
                                text: `${header}\n${body}${weightLine}${footer}`,
                            },
                        ],
                        structuredContent: {
                            date: targetDate,
                            drink_unit: alcohol,
                            locale,
                            meal_count: meals.length,
                            water_entries: water.length,
                            goals: goalsPayload,
                            totals: totalsPayload,
                            weight: weightPayload,
                            // Single day → label rows by meal type in the widget.
                            meals: mealBreakdown(meals, null, alcohol),
                        },
                    };
                },
                analytics,
                { date: date ?? "today" },
            );
        },
    );
}
