import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
    getMealsByDate,
    upsertNutritionGoals,
    upsertGoalDays,
    getGoalsForDate,
    getNutritionGoals,
    getWaterByDate,
    getLatestWeight,
    type NutritionGoalDayInput,
} from "../../db/nutrition.js";
import {
    goalDayRows,
    type GoalDayRow,
} from "../../db/agent-actions-goal-days.js";
import {
    getPreferredWeightUnit,
    preferredWeightUnitFromProfile,
    timezoneFromProfile,
    getProfile,
} from "../../db/profiles.js";
import { withAnalytics } from "../../analytics.js";
import { todayInTz, dateInTz } from "../../domain/tz.js";
import {
    GOAL_NAME_MAX,
    GOAL_NOTE_MAX,
    cleanGoalLabel,
} from "../../domain/goal-label.js";
import {
    GOAL_DAY_FIELDS,
    dateDiffDays,
    isCalendarDate,
} from "../../domain/insights.js";
import { toGrams, formatWeight, fromGrams } from "../../domain/units.js";
import { MAX_CALORIES } from "../../domain/import.js";
import {
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
    destructiveOutcome,
    withUndo,
} from "../shared.js";
import type { ToolContext } from "../shared.js";

const MAX_GOAL_DAYS_PER_CALL = 92;

// The fields that change what the targets are. Writing any of them is a save of
// the goals, which stamps goals_set_on; a write of only the name or note is not.
const GOAL_TARGET_ARGS = [
    "daily_calories",
    "daily_protein_g",
    "daily_carbs_g",
    "daily_fat_g",
    "daily_fiber_g",
    "daily_sugar_g",
    "daily_alcohol_g",
    "daily_caffeine_mg",
    "daily_water_ml",
    "target_weight",
] as const;

export const SET_NUTRITION_GOALS_OUTPUT_SCHEMA = z.object({
    scope: z.enum(["default", "days"]),
    days: z.array(z.string()),
    goals: GOALS_ITEM.nullable(),
    target_weight: z.number().nullable(),
    weight_unit: z.enum(["kg", "lb"]),
});

function addCalendarDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function resolveGoalDayWindow(args: {
    date?: string;
    from?: string;
    to?: string;
}): { days: string[]; label: string } {
    const hasDate = args.date !== undefined;
    const hasFrom = args.from !== undefined;
    const hasTo = args.to !== undefined;
    if (hasDate && (hasFrom || hasTo)) {
        throw new Error("Pass date or from and to, not both.");
    }
    if (hasFrom !== hasTo) {
        throw new Error("Pass both from and to for a date range.");
    }
    const start = hasFrom ? args.from! : args.date!;
    const end = hasFrom ? args.to! : args.date!;
    if (!isCalendarDate(start)) {
        throw new Error(`Invalid calendar date: ${start}`);
    }
    if (!isCalendarDate(end)) {
        throw new Error(`Invalid calendar date: ${end}`);
    }
    if (start > end) {
        throw new Error("from must be on or before to.");
    }
    const count = dateDiffDays(start, end) + 1;
    if (count > MAX_GOAL_DAYS_PER_CALL) {
        throw new Error(
            `Date range may include at most ${MAX_GOAL_DAYS_PER_CALL} days per call (${count} given).`,
        );
    }
    const days: string[] = [];
    for (let i = 0; i < count; i++) {
        days.push(addCalendarDays(start, i));
    }
    const label =
        start === end ? `${start} only` : `${start} to ${end} (${count} days)`;
    return { days, label };
}

function goalDayFieldsFromArgs(
    args: Record<string, unknown>,
): NutritionGoalDayInput {
    const input: NutritionGoalDayInput = {};
    for (const field of GOAL_DAY_FIELDS) {
        if (args[field] !== undefined) {
            input[field] = args[field] as number | null;
        }
    }
    return input;
}

/**
 * The existing overrides this patch would leave with every target empty. A day
 * with no target left is the same as no override, so the write removes it.
 */
function overridesEmptiedBy(
    existing: readonly GoalDayRow[],
    patch: NutritionGoalDayInput,
): GoalDayRow[] {
    return existing.filter((row) =>
        GOAL_DAY_FIELDS.every(
            (field) =>
                (patch[field] !== undefined ? patch[field] : row[field]) ==
                null,
        ),
    );
}

/** Whether the patch changes a field this override holds. */
function overrideChangedBy(
    row: GoalDayRow,
    patch: NutritionGoalDayInput,
): boolean {
    return GOAL_DAY_FIELDS.some((field) => {
        const next = patch[field];
        if (next === undefined) return false;
        const current = row[field];
        if (next === null || current == null) return next !== (current ?? null);
        return Number(next) !== Number(current);
    });
}

function overrides(count: number): string {
    return `${count} per-day goal override${count === 1 ? "" : "s"}`;
}

function hasGoalDayScope(args: {
    date?: string;
    from?: string;
    to?: string;
}): boolean {
    // An empty string still counts as given, so it is rejected as a bad
    // calendar date rather than silently writing the standing defaults.
    return (
        args.date !== undefined ||
        args.from !== undefined ||
        args.to !== undefined
    );
}

export function registerGoalsTools(server: McpServer, ctx: ToolContext) {
    const {
        alcohol,
        personSchema,
        nutritionWriteSchema,
        actorUserId,
        writeUserId,
        callerHouseholdId,
        analytics,
        uiMeta,
        runDestructive,
    } = ctx;
    server.registerTool(
        "set_nutrition_goals",
        {
            title: "Set Nutrition Goals",
            description:
                "Set the user's daily calorie and macro targets, and optionally a target body weight. Pass only the fields you want to update — omitted fields keep their previous value. Pass null explicitly to clear a target. Calories, protein, carbs, fat, fiber and water are targets to REACH; sugar, alcohol and caffeine are limits to STAY UNDER, and progress against them is worded accordingly. Every gram target is in grams and the caffeine limit is in MILLIGRAMS. For a limit, 0 is a real value meaning 'none at all' rather than 'unset'. Omit date, from and to to change the standing defaults; pass date for one calendar day, or from and to (inclusive, YYYY-MM-DD) for a per-day override on each day in the range, at most 92 days per call. Per-day overrides do not accept target_weight — set that on the defaults instead. Pass clear: true with a date or range to remove those overrides and fall back to the defaults; removing overrides (clear, or nulling a day's last target) is recorded and the household can undo it for 24 hours, and is refused while the household has turned off destructive agent changes. goal_name (at most 40 characters) and goal_note (at most 280) label the standing goals, for example Recomp; they apply to the defaults only, an omitted one keeps its stored value, and null or blank clears it. Saving any target also records today (in the user's timezone) as the day the goals were set; changing only the name or note leaves that day alone. Targets are the user's own choice; this server does not provide medical or dietary advice.",
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
                date: z
                    .string()
                    .optional()
                    .describe(
                        "Calendar day (YYYY-MM-DD) to override instead of the defaults. Do not combine with from or to.",
                    ),
                from: z
                    .string()
                    .optional()
                    .describe(
                        "Start of an inclusive override range (YYYY-MM-DD). Requires to.",
                    ),
                to: z
                    .string()
                    .optional()
                    .describe(
                        "End of an inclusive override range (YYYY-MM-DD). Requires from.",
                    ),
                clear: z
                    .boolean()
                    .optional()
                    .describe(
                        "When true, remove per-day overrides for date or from/to and fall back to the defaults.",
                    ),
                // Length is checked in the handler, not here: a schema-level
                // rejection is a bare protocol error, while the handler's is a
                // message the caller can act on, like every other goal bound.
                goal_name: z
                    .string()
                    .nullable()
                    .optional()
                    .describe(
                        `Name for the standing goals, at most ${GOAL_NAME_MAX} characters (for example "Recomp"). Omit to keep the stored name; null or blank to clear it. Defaults only, not per-day overrides.`,
                    ),
                goal_note: z
                    .string()
                    .nullable()
                    .optional()
                    .describe(
                        `Short note beside the goal name, at most ${GOAL_NOTE_MAX} characters. Omit to keep it; null or blank to clear it. Defaults only.`,
                    ),
            }),
            outputSchema: SET_NUTRITION_GOALS_OUTPUT_SCHEMA,
        },
        async (args) => {
            return withAnalytics(
                "set_nutrition_goals",
                async () => {
                    const userId = await writeUserId(
                        args.user_id,
                        args.target_member,
                    );
                    const dayScoped = hasGoalDayScope(args);
                    // Validate the label up front, before any read or write, so
                    // an over-long name is refused whatever else the call says.
                    const goalName =
                        args.goal_name === undefined
                            ? undefined
                            : cleanGoalLabel("goal_name", args.goal_name);
                    const goalNote =
                        args.goal_note === undefined
                            ? undefined
                            : cleanGoalLabel("goal_note", args.goal_note);
                    // Only a per-day override needs the household (its rows
                    // carry household_id); the standing defaults never did.
                    const [existing, preferredUnit, householdId] =
                        await Promise.all([
                            getNutritionGoals(userId),
                            getPreferredWeightUnit(userId),
                            dayScoped ? callerHouseholdId() : null,
                        ]);
                    const displayUnit = args.unit ?? preferredUnit ?? "kg";

                    if (args.clear && !dayScoped) {
                        throw new Error(
                            "clear requires date or from and to for per-day overrides.",
                        );
                    }

                    if (dayScoped && householdId != null) {
                        const { days, label } = resolveGoalDayWindow(args);
                        if (args.target_weight !== undefined) {
                            throw new Error(
                                "target_weight applies to default goals only, not per-day overrides. Omit date, from and to to set it.",
                            );
                        }
                        if (
                            args.goal_name !== undefined ||
                            args.goal_note !== undefined
                        ) {
                            throw new Error(
                                "goal_name and goal_note apply to default goals only, not per-day overrides. Omit date, from and to to set them.",
                            );
                        }

                        if (args.clear) {
                            const run = await runDestructive(
                                "set_nutrition_goals",
                                async (rec) => {
                                    const found = await goalDayRows().list(
                                        userId,
                                        householdId,
                                        days,
                                    );
                                    const ids = found.map((row) => row.id);
                                    await rec.captureByIds(
                                        "nutrition_goal_days",
                                        ids,
                                        "deleted",
                                    );
                                    // Exactly the rows recorded, so what undo
                                    // puts back is what went.
                                    const removed = await goalDayRows().remove(
                                        userId,
                                        householdId,
                                        ids,
                                    );
                                    return {
                                        value: removed,
                                        summary: `Cleared ${overrides(removed)} for ${label}`,
                                        changed: removed > 0,
                                    };
                                },
                            );
                            if (run.refused) return run.result;
                            const defaults =
                                existing ?? (await getNutritionGoals(userId));
                            const text = `${withUndo(`Cleared per-day goal overrides for ${label}.`, run.undo)}\n\n${formatGoals(defaults, displayUnit, alcohol)}`;
                            return {
                                content: [{ type: "text", text }],
                                structuredContent: {
                                    scope: "days",
                                    days,
                                    goals: goalsPayloadOf(defaults, alcohol),
                                    target_weight:
                                        defaults?.target_weight_g != null
                                            ? fromGrams(
                                                  defaults.target_weight_g,
                                                  displayUnit,
                                              )
                                            : null,
                                    weight_unit: displayUnit,
                                },
                            };
                        }

                        const dayPatch = goalDayFieldsFromArgs(args);
                        if (
                            GOAL_DAY_FIELDS.every(
                                (f) => dayPatch[f] === undefined,
                            )
                        ) {
                            throw new Error(
                                "Pass at least one daily goal field to update, or clear: true to remove overrides.",
                            );
                        }

                        // Nulling a day's last target removes its override, so
                        // that goes through the guard like a clear does. A write
                        // that leaves every override standing does not.
                        const emptiesOne =
                            Object.values(dayPatch).includes(null) &&
                            overridesEmptiedBy(
                                await goalDayRows().list(
                                    userId,
                                    householdId,
                                    days,
                                ),
                                dayPatch,
                            ).length > 0;
                        let undoNote = "";
                        if (emptiesOne) {
                            const run = await runDestructive(
                                "set_nutrition_goals",
                                async (rec) => {
                                    // The same call also rewrites the overrides
                                    // it leaves standing, and undo puts back all
                                    // of it, so all of it is recorded, read again
                                    // here inside the write. A patch that empties
                                    // an override holds nothing but nulls, so it
                                    // adds no row for undo to remove.
                                    const found = await goalDayRows().list(
                                        userId,
                                        householdId,
                                        days,
                                    );
                                    const emptied = overridesEmptiedBy(
                                        found,
                                        dayPatch,
                                    );
                                    const gone = new Set(
                                        emptied.map((row) => row.id),
                                    );
                                    // Only the overrides the patch really
                                    // changes: an untouched one recorded here
                                    // would make undo refuse once a person
                                    // removed it, for no reason.
                                    const rewritten = found.filter(
                                        (row) =>
                                            !gone.has(row.id) &&
                                            overrideChangedBy(row, dayPatch),
                                    );
                                    await rec.captureByIds(
                                        "nutrition_goal_days",
                                        emptied.map((row) => row.id),
                                        "deleted",
                                    );
                                    await rec.captureByIds(
                                        "nutrition_goal_days",
                                        rewritten.map((row) => row.id),
                                        "updated",
                                    );
                                    await upsertGoalDays(
                                        userId,
                                        householdId,
                                        days,
                                        dayPatch,
                                    );
                                    return {
                                        value: null,
                                        summary: `Cleared a goal target for ${label}: removed ${overrides(emptied.length)}${
                                            rewritten.length > 0
                                                ? `, rewrote ${overrides(rewritten.length)}`
                                                : ""
                                        }`,
                                    };
                                },
                            );
                            if (run.refused) return run.result;
                            undoNote = run.undo;
                        } else {
                            await upsertGoalDays(
                                userId,
                                householdId,
                                days,
                                dayPatch,
                            );
                        }
                        const resolved =
                            days.length === 1
                                ? await getGoalsForDate(userId, days[0]!)
                                : null;
                        const alcoholNote = alcoholHiddenNote(
                            args.daily_alcohol_g != null,
                            alcohol,
                            "Alcohol target saved",
                        );
                        const body =
                            resolved != null
                                ? formatGoals(resolved, displayUnit, alcohol)
                                : `Updated ${days.length} day${days.length === 1 ? "" : "s"}.`;
                        const text = `${withUndo(`Goals updated for ${label}.`, undoNote)}\n\n${body}${alcoholNote}`;
                        return {
                            content: [{ type: "text", text }],
                            structuredContent: {
                                scope: "days",
                                days,
                                goals: goalsPayloadOf(resolved, alcohol),
                                target_weight:
                                    resolved?.target_weight_g != null
                                        ? fromGrams(
                                              resolved.target_weight_g,
                                              displayUnit,
                                          )
                                        : null,
                                weight_unit: displayUnit,
                            },
                        };
                    }

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
                        // Undefined leaves the stored value alone: a write
                        // without a name keeps the name.
                        goal_name: goalName,
                        goal_note: goalNote,
                        goals_set_on: undefined as string | null | undefined,
                    };
                    if (GOAL_TARGET_ARGS.some((f) => args[f] !== undefined)) {
                        const profile = await getProfile(userId);
                        merged.goals_set_on = todayInTz(
                            timezoneFromProfile(profile) ?? "UTC",
                        );
                    }
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
                        structuredContent: {
                            scope: "default",
                            days: [],
                            goals: goalsPayloadOf(goals, alcohol),
                            target_weight:
                                goals.target_weight_g != null
                                    ? fromGrams(
                                          goals.target_weight_g,
                                          displayUnit,
                                      )
                                    : null,
                            weight_unit: displayUnit,
                        },
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
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
            ...uiMeta("goal-progress"),
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
