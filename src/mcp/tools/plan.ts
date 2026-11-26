import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import { liveNotifier } from "../../db/notify.js";
import { loadWeekPlanInputs, type WeekPlanInputs } from "../../db/plan-week.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveRecipePlansStore, planTransaction } from "../../db/plans.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "../../db/recipes.js";
import { householdClock, householdToday } from "../../db/restock.js";
import { liveSettingsStore } from "../../db/settings.js";
import { GroceryInputError } from "../../domain/grocery.js";
import { noticesFor } from "../../domain/notices-for.js";
import {
    checkPlanDate,
    checkPlanDay,
    PLAN_REPEATS,
    PLAN_SLOTS,
    planRecipe,
    repeatPatternWords,
    unplanRecipe,
    updatePlannedRecipe,
    type RecipePlan,
} from "../../domain/plan.js";
import {
    addMissingToGroceries,
    addPlanDays,
    countedServings,
    missingForPlan,
    WEEK_PLAN_DAYS,
    weekPlan,
    type PlanMissingLine,
} from "../../domain/plan-week.js";
import { isRecipeDraft, macrosForPerson } from "../../domain/recipes.js";
import { WEEKDAY_NAMES } from "../../domain/weekdays.js";
import {
    registerWidgetResource,
    uiMetaForKey,
    destructiveOutcome,
    withUndo,
    noticeIdTags,
    noticeToWire,
    type ToolContext,
    idTag,
} from "../shared.js";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PLAN_ENTRY_SCHEMA = z.object({
    plan_id: z.string(),
    recipe_id: z.string(),
    recipe_name: z.string(),
    slot: z.enum(PLAN_SLOTS),
    servings: z.number(),
    /** True on a day of a repeating plan (plan_id is rule:<id>:<date>); absent on a one-off. */
    repeats: z.boolean().optional(),
    /** Who it is planned for, when anyone is named; absent otherwise. */
    member_ids: z.array(z.string()).optional(),
    /** Calories in one portion of the recipe; null when the recipe's macros are unknown or incomplete. */
    kcal_per_portion: z.number().nullable(),
});

const NEEDED_BY_SCHEMA = z.object({
    plan_id: z.string(),
    recipe_id: z.string(),
    recipe_name: z.string(),
    date: z.string(),
    slot: z.enum(PLAN_SLOTS),
});

/**
 * What an agent acts on in a plan notice. The notices are sent exactly as every
 * tool sends them (`noticeToWire`, so `NOTICE_SCHEMA` parses each one); this
 * names only the fields it needs, and is loose about the rest, because
 * tools/list pays for every character of the full schema.
 */
const PLAN_NOTICE_SCHEMA = z.looseObject({
    code: z.string(),
    message: z.string(),
    dismiss: z
        .object({
            code: z.string(),
            subject_kind: z.literal("food"),
            subject_id: z.string(),
            related_id: z.string().nullable(),
        })
        .nullable(),
});

export const WEEK_PLAN_OUTPUT_SCHEMA = z.object({
    /** The household's today, `YYYY-MM-DD`, whatever `from` is. */
    today: z.string(),
    /** First day shown, `YYYY-MM-DD`: the household's today unless `from` was passed. */
    from: z.string(),
    planned_count: z.number().int(),
    days: z.array(
        z.object({
            date: z.string(),
            weekday: z.string(),
            /** In slot order: breakfast, lunch, dinner, snack. */
            plans: z.array(PLAN_ENTRY_SCHEMA),
        }),
    ),
    /** What the planned recipes need that the kitchen does not hold. */
    missing: z.array(
        z.object({
            /** The food behind the line; null when the recipe line names no food (add_plan_missing_to_groceries skips those). */
            food_id: z.string().nullable(),
            display_name: z.string(),
            /** What is short, in `unit`; null when the recipe gives no amount. */
            amount: z.number().nullable(),
            unit: z.string().nullable(),
            /** Stock in another unit could not be counted, so `amount` is the full recipe amount. */
            unknown: z.boolean(),
            /** The recipe gives no amount ("salt, to taste"). */
            unmeasured: z.boolean(),
            needed_by: z.array(NEEDED_BY_SCHEMA),
        }),
    ),
    /** The notices about the plan the household has not dismissed (what it is missing), each with the `dismiss` fields dismiss_notice takes. */
    notices: z.array(PLAN_NOTICE_SCHEMA),
});

export const PLAN_RECIPE_OUTPUT_SCHEMA = z.object({
    plan: z.object({
        plan_id: z.string(),
        recipe_id: z.string(),
        recipe_name: z.string(),
        date: z.string(),
        slot: z.enum(PLAN_SLOTS),
        servings: z.number(),
        /** True when the plan repeats (plan_id is its first day); absent on a one-off. */
        repeats: z.boolean().optional(),
        member_ids: z.array(z.string()).optional(),
    }),
    /** The recipe was already planned on that day and meal, so nothing new was made. */
    already_planned: z.boolean(),
});

export const UNPLAN_RECIPE_OUTPUT_SCHEMA = z.object({
    removed: z.literal(true),
    plan_id: z.string(),
});

export const UPDATE_PLAN_OUTPUT_SCHEMA = z.object({
    /** The entry as it is now; its plan_id changes when the day leaves its series or the repeat changes. */
    plan: PLAN_RECIPE_OUTPUT_SCHEMA.shape.plan,
    repeat: z.enum(PLAN_REPEATS),
    /** False when nothing was written. */
    changed: z.boolean(),
    already_planned: z.boolean(),
});

const GROCERY_LINE_REF = z.object({
    food_id: z.string().nullable(),
    display_name: z.string(),
});

export const ADD_PLAN_MISSING_OUTPUT_SCHEMA = z.object({
    added: z.array(
        GROCERY_LINE_REF.extend({
            line_id: z.string(),
            amount: z.number(),
            unit: z.string(),
            store_id: z.string(),
            note: z.string().nullable(),
        }),
    ),
    /** Already covered by the grocery list, so nothing was added. */
    on_list: z.array(
        GROCERY_LINE_REF.extend({
            existing_line_id: z.string(),
        }),
    ),
    /** Added at the recipe's full amount because the stock could not be counted. */
    unknown: z.array(
        GROCERY_LINE_REF.extend({
            notice: z.string(),
        }),
    ),
    skipped: z.array(
        GROCERY_LINE_REF.extend({
            reason: z.string(),
        }),
    ),
});

/**
 * Takes the household's planning lock (the one every plan write takes) for the
 * rest of the transaction the caller is in, which is the guard's in a
 * destructive tool. Taken before the tool reads or records anything, so what
 * the guard captures is what the write then finds: a save that lands first is
 * waited for, not undone by this call's undo.
 */
function holdPlanning(householdId: string): Promise<void> {
    return planTransaction("plan-recipe", householdId)(async () => undefined);
}

function weekdayName(date: string): string {
    return WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? "";
}

function missingWire(line: PlanMissingLine) {
    return {
        food_id: line.foodId,
        display_name: line.displayName,
        amount: line.missing?.amount ?? null,
        unit: line.missing?.unit ?? null,
        unknown: line.unknown,
        unmeasured: line.unmeasured,
        needed_by: line.neededBy.map((need) => ({
            plan_id: need.planId,
            recipe_id: need.recipeId,
            recipe_name: need.recipeName,
            date: need.date,
            slot: need.slot,
        })),
    };
}

function planWire(
    plan: RecipePlan,
    recipeName: string,
    /** What the plan counts; see `countedServings`. Default the stored servings. */
    servings: number = plan.servings,
) {
    return {
        plan_id: plan.id,
        recipe_id: plan.recipeId,
        recipe_name: recipeName,
        date: plan.date,
        slot: plan.slot,
        servings,
        ...(plan.ruleId !== undefined ? { repeats: true } : {}),
        ...((plan.memberIds?.length ?? 0) > 0
            ? { member_ids: plan.memberIds }
            : {}),
    };
}

/** The people a plan is for, as the text names them. */
function memberTags(plan: { member_ids?: string[] }): string {
    return (plan.member_ids ?? []).map((id) => idTag(id, "member_id")).join("");
}

/**
 * What a plan counts: its servings, or for a plan that names people their
 * portions (`servings` is already that sum, from `countedServings`).
 */
function countedText(plan: {
    servings: number;
    member_ids?: string[];
}): string {
    return (plan.member_ids ?? []).length === 0
        ? `${plan.servings} servings`
        : `${plan.servings} ${plan.servings === 1 ? "portion" : "portions"}`;
}

function planLine(plan: ReturnType<typeof planWire>): string {
    return `${plan.recipe_name} · ${weekdayName(plan.date)} ${plan.date} · ${plan.slot} · ${countedText(plan)}${plan.repeats ? " · repeats" : ""}${plan.member_ids ? " · for" : ""}${memberTags(plan)}`;
}

/** Calories in one portion of each planned recipe, by recipe id. Null when unknown or incomplete. */
function kcalPerPortionByRecipe(
    inputs: WeekPlanInputs,
): Map<string, number | null> {
    const out = new Map<string, number | null>();
    for (const recipe of inputs.recipes) {
        const macros = macrosForPerson(
            inputs.plannedIngredients.filter(
                (row) => row.recipeId === recipe.id,
            ),
            recipe.yieldPortions,
            1,
            inputs.foodsById,
        );
        out.set(
            recipe.id,
            macros.incomplete || macros.calories == null
                ? null
                : Math.round(macros.calories),
        );
    }
    return out;
}

export function registerPlanTools(server: McpServer, ctx: ToolContext) {
    const {
        callerHouseholdId,
        callerActor,
        analytics,
        runDestructive,
        requireHouseholdMemberId,
    } = ctx;

    registerWidgetResource(server, {
        key: "week-plan",
        resourceName: "week-plan",
        title: "Week plan",
        description:
            "The week's planned recipes by day, with Remove and add-missing-to-groceries, for get_week_plan.",
    });

    server.registerTool(
        "get_week_plan",
        {
            title: "Get Week Plan",
            description:
                "Read the household's week plan: seven days from `from` (default the household's today), each with the recipes planned on it by meal slot, what the planned recipes still need that the kitchen does not hold (`missing`), and the plan's open `notices` (dismiss_notice takes each one's `dismiss` fields). Each plan has a plan_id for unplan_recipe (`repeats: true` on a repeating plan's day). To put the missing foods on the grocery list call add_plan_missing_to_groceries.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                from: z
                    .string()
                    .optional()
                    .describe(
                        "First day, YYYY-MM-DD. Defaults to the household's today.",
                    ),
            }),
            outputSchema: WEEK_PLAN_OUTPUT_SCHEMA,
            ...uiMetaForKey(ctx, "week-plan"),
        },
        async (args) =>
            withAnalytics(
                "get_week_plan",
                async () => {
                    const householdId = await callerHouseholdId();
                    const { today, timezone } =
                        await householdClock(householdId);
                    const inputs = await loadWeekPlanInputs(
                        householdId,
                        args.from === undefined
                            ? today
                            : checkPlanDate(args.from),
                    );
                    const kcal = kcalPerPortionByRecipe(inputs);
                    const recipeById = new Map(
                        inputs.recipes.map((r) => [r.id, r]),
                    );
                    const nameById = new Map(
                        inputs.recipes.map((r) => [r.id, r.name]),
                    );
                    const days = weekPlan(inputs.plans, inputs.today).map(
                        (day) => ({
                            date: day.date,
                            weekday: weekdayName(day.date),
                            plans: day.plans.map((plan) => ({
                                plan_id: plan.id,
                                recipe_id: plan.recipeId,
                                recipe_name: nameById.get(plan.recipeId) ?? "",
                                slot: plan.slot,
                                servings: countedServings(
                                    plan,
                                    recipeById.get(plan.recipeId)?.versions,
                                ),
                                ...(plan.ruleId !== undefined
                                    ? { repeats: true }
                                    : {}),
                                ...((plan.memberIds?.length ?? 0) > 0
                                    ? { member_ids: plan.memberIds }
                                    : {}),
                                kcal_per_portion:
                                    kcal.get(plan.recipeId) ?? null,
                            })),
                        }),
                    );
                    const missing = missingForPlan(
                        inputs.plans,
                        inputs.recipes,
                        inputs.stock,
                        {
                            from: inputs.today,
                            days: WEEK_PLAN_DAYS,
                            foodsById: inputs.foodsById,
                        },
                    ).map(missingWire);
                    // What the Recipes and Today pages dismiss in place: the
                    // plan's missing foods, read the way those pages read them
                    // (from the household's today, whatever `from` is).
                    const { notices: found } = await noticesFor(
                        {
                            foods: liveFoodsStore(),
                            fridge: liveFridgeStore(),
                            recipes: liveRecipesStore(),
                            dismissals: liveNoticeDismissalsStore(),
                            grocery: liveGroceryStore(),
                            plans: liveRecipePlansStore(),
                            variants: liveRecipeVariantsStore(),
                        },
                        householdId,
                        { today, timezone, actionable: true },
                    );
                    const notices = found
                        .filter((n) => n.code === "plan.missing_ingredient")
                        .map(noticeToWire);
                    const plannedCount = days.reduce(
                        (sum, day) => sum + day.plans.length,
                        0,
                    );
                    const last = addPlanDays(inputs.today, WEEK_PLAN_DAYS - 1);
                    const lines = days.flatMap((day) =>
                        day.plans.map(
                            (plan) =>
                                `- ${day.weekday} ${day.date} · ${plan.slot}: ${plan.recipe_name} (${countedText(plan)}${plan.repeats ? ", repeats" : ""})${idTag(plan.plan_id, "plan_id")}${idTag(plan.recipe_id, "recipe_id")}${memberTags(plan)}`,
                        ),
                    );
                    const missingLines = missing.map(
                        (m) =>
                            `- ${m.display_name}${m.amount != null ? ` ${m.amount} ${m.unit ?? ""}`.trimEnd() : ""}${m.unknown ? " (stock could not be counted)" : ""}${m.food_id ? idTag(m.food_id, "food_id") : ""}`,
                    );
                    const text = [
                        `Week plan ${inputs.today} to ${last}: ${plannedCount} planned.`,
                        ...lines,
                        missing.length > 0
                            ? `Missing for the plan:\n${missingLines.join("\n")}`
                            : "Nothing missing for the plan.",
                        ...(notices.length > 0
                            ? [
                                  `Notices (dismiss_notice takes the fields in brackets):\n${notices
                                      .map(
                                          (n) =>
                                              `- ${n.message}${noticeIdTags(n)}`,
                                      )
                                      .join("\n")}`,
                              ]
                            : []),
                    ].join("\n");
                    return {
                        content: [{ type: "text" as const, text }],
                        structuredContent: {
                            today,
                            from: inputs.today,
                            planned_count: plannedCount,
                            days,
                            missing,
                            notices,
                        },
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "plan_recipe",
        {
            title: "Plan Recipe",
            description:
                "Put a recipe on the household's week plan for a day and meal slot. `date` is YYYY-MM-DD in the household's calendar and must be today or later; `slot` is breakfast, lunch, dinner or snack; `servings` defaults to the recipe's yield. A recipe already on that day and slot (once or by a repeat) comes back unchanged (already_planned true), whatever servings; servings change in the app. Repeats of one recipe and slot may not overlap. `repeat` (default once) plans it from `date` weekly, daily, on weekdays (Mon-Fri) or on `days` (0 = Sunday to 6); plan_id is its first day. `member_ids`: who eats it; the plan is their saved portions added up (`servings` ignored), and the week's needs use each one's own version.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                recipe_id: z.string(),
                date: z.string().describe("The day, YYYY-MM-DD."),
                slot: z.enum(PLAN_SLOTS),
                servings: z.coerce.number().optional(),
                repeat: z.enum(PLAN_REPEATS).optional(),
                member_ids: z.array(z.string()).optional(),
                // A blank, null or true/false weekday is refused, not read as
                // Sunday (or Monday) by the number coercion.
                days: z
                    .array(
                        z.preprocess(
                            (v) =>
                                v === null ||
                                typeof v === "boolean" ||
                                (typeof v === "string" && v.trim() === "")
                                    ? Number.NaN
                                    : v,
                            z.coerce.number(),
                        ),
                    )
                    .optional(),
            }),
            outputSchema: PLAN_RECIPE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "plan_recipe",
                async () => {
                    const actor = await callerActor();
                    const { householdId } = actor;
                    // A malformed id names no recipe; the uuid column would
                    // refuse it with a database error instead.
                    if (!UUID_RE.test(args.recipe_id)) {
                        throw new Error("Recipe not found.");
                    }
                    const recipe = await liveRecipesStore().getRecipe(
                        householdId,
                        args.recipe_id,
                    );
                    if (!recipe) throw new Error("Recipe not found.");
                    // Naming people is a read of their versions, so any
                    // member of the household may be named.
                    const memberIds: string[] = [];
                    const memberPortions: Record<string, number> = {};
                    for (const id of args.member_ids ?? []) {
                        // Stored ids are lower case, whatever case was typed.
                        const memberId = (
                            await requireHouseholdMemberId(id)
                        ).toLowerCase();
                        memberIds.push(memberId);
                        const saved = await liveRecipesStore().getPortion(
                            householdId,
                            recipe.id,
                            memberId,
                        );
                        if (saved)
                            memberPortions[memberId] = saved.portionCount;
                    }
                    // The web app's Add to plan runs the same function.
                    const outcome = await planRecipe(
                        liveRecipePlansStore(),
                        {
                            householdId,
                            recipeId: recipe.id,
                            recipeName: recipe.name,
                            recipeIsDraft: isRecipeDraft(recipe),
                            recipeYield: recipe.yieldPortions,
                            date: args.date.trim(),
                            slot: args.slot,
                            servings: args.servings,
                            repeat: args.repeat,
                            days: args.days,
                            memberIds,
                            memberPortions,
                            today: await householdToday(householdId),
                            createdBy: actor.userId,
                        },
                        {
                            transaction: planTransaction(
                                "plan-recipe",
                                householdId,
                            ),
                            notify: liveNotifier(householdId, actor.userId),
                        },
                    );
                    if (!outcome) throw new Error("Recipe not found.");
                    const { plan, alreadyPlanned } = outcome;
                    // A plan for named people counts their portions as saved
                    // now, so a plan that was already there reads the same
                    // as everywhere else.
                    const portionsOf: Record<string, number> = {};
                    for (const userId of plan.memberIds ?? []) {
                        const saved = await liveRecipesStore().getPortion(
                            householdId,
                            recipe.id,
                            userId,
                        );
                        if (saved) portionsOf[userId] = saved.portionCount;
                    }
                    const wire = planWire(
                        plan,
                        recipe.name,
                        countedServings(plan, { portions: portionsOf }),
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: alreadyPlanned
                                    ? `Already planned, nothing changed: ${planLine(wire)}${idTag(wire.plan_id, "plan_id")}. To change its servings, edit that plan in the app.`
                                    : `Planned: ${planLine(wire)}${idTag(wire.plan_id, "plan_id")}`,
                            },
                        ],
                        structuredContent: {
                            plan: wire,
                            already_planned: alreadyPlanned,
                        },
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "unplan_recipe",
        {
            title: "Unplan Recipe",
            description:
                "Remove one entry from the household's week plan by its plan_id (from get_week_plan or plan_recipe). A repeating plan's day (`repeats: true`) goes alone (scope day, default) or with its whole series from that day on (scope series): ask the person which, never choose. The recipe is untouched.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                plan_id: z.string(),
                scope: z.enum(["day", "series"]).optional(),
            }),
            outputSchema: UNPLAN_RECIPE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "unplan_recipe",
                async () => {
                    const run = await runDestructive(
                        "unplan_recipe",
                        async (rec, householdId, notify) => {
                            await holdPlanning(householdId);
                            const plans = liveRecipePlansStore();
                            const plan = await plans.getPlan(
                                householdId,
                                args.plan_id,
                            );
                            if (!plan) throw new Error("Plan not found.");
                            const scope = args.scope ?? "day";
                            if (scope === "series" && !plan.ruleId) {
                                throw new Error(
                                    "That plan does not repeat, so there is no series to remove. Remove the day instead.",
                                );
                            }
                            const recipe = await liveRecipesStore().getRecipe(
                                householdId,
                                plan.recipeId,
                            );
                            // A day of a repeat changes its repeat's row (an
                            // end day for the series, a skipped day for the
                            // day); a one-off is deleted.
                            if (plan.ruleId) {
                                await rec.captureByIds(
                                    "plan_rules",
                                    [plan.ruleId],
                                    "updated",
                                );
                            } else {
                                await rec.captureByIds(
                                    "recipe_plans",
                                    [args.plan_id],
                                    "deleted",
                                );
                            }
                            const removed = await unplanRecipe(
                                plans,
                                householdId,
                                args.plan_id,
                                {
                                    recipes: liveRecipesStore(),
                                    notify,
                                    // Already read above: a second read inside
                                    // the guard's transaction could abort it.
                                    recipeName: recipe?.name ?? null,
                                },
                                scope,
                            );
                            if (!removed) throw new Error("Plan not found.");
                            const name = recipe?.name ?? "a recipe";
                            return {
                                value: scope,
                                summary:
                                    scope === "series"
                                        ? `Ended the repeating plan of ${name} from ${plan.date} (${plan.slot}); earlier days stay`
                                        : plan.ruleId
                                          ? `Removed ${name} from the plan for ${plan.date} (${plan.slot}); the rest of the repeat stays`
                                          : `Removed ${name} from the plan for ${plan.date} (${plan.slot})`,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    run.value === "series"
                                        ? `Ended the repeating plan from ${args.plan_id}.`
                                        : `Removed plan ${args.plan_id}.`,
                                    run.undo,
                                ),
                            },
                        ],
                        structuredContent: {
                            removed: true as const,
                            plan_id: args.plan_id,
                        },
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    server.registerTool(
        "update_plan",
        {
            title: "Update Plan",
            description:
                "Change one week-plan entry by plan_id: `recipe_id`, `date` (YYYY-MM-DD, today or later), `slot`, `servings`, `repeat`, `days` (0 = Sunday). Only fields that differ change. On a repeating plan's day, recipe, date, slot and servings change that day only; `repeat` or `days` change the series from that day on. The plan_id in the answer is the entry's now: it can differ from the one you passed.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                plan_id: z.string(),
                recipe_id: z.string().optional(),
                date: z.string().optional(),
                slot: z.enum(PLAN_SLOTS).optional(),
                servings: z.coerce.number().optional(),
                repeat: z.enum(PLAN_REPEATS).optional(),
                // A blank, null or true/false weekday is refused, not read as
                // Sunday (or Monday) by the number coercion.
                days: z
                    .array(
                        z.preprocess(
                            (v) =>
                                v === null ||
                                typeof v === "boolean" ||
                                (typeof v === "string" && v.trim() === "")
                                    ? Number.NaN
                                    : v,
                            z.coerce.number(),
                        ),
                    )
                    .optional(),
            }),
            outputSchema: UPDATE_PLAN_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "update_plan",
                async () => {
                    const run = await runDestructive(
                        "update_plan",
                        async (rec, householdId, notify) => {
                            // The household's planning lock comes first: what
                            // is recorded below is then what the change finds
                            // when it writes, so two saves of one plan at once
                            // cannot undo each other.
                            await holdPlanning(householdId);
                            const plans = liveRecipePlansStore();
                            const entry = await plans.getPlan(
                                householdId,
                                args.plan_id,
                            );
                            if (!entry) throw new Error("Plan not found.");
                            if (
                                args.recipe_id !== undefined &&
                                !UUID_RE.test(args.recipe_id.trim())
                            ) {
                                throw new Error("Recipe not found.");
                            }
                            const recipes = liveRecipesStore();
                            // Read here, as unplan_recipe does: a read that
                            // failed inside the guard's transaction would
                            // abort it.
                            const was = await recipes.getRecipe(
                                householdId,
                                entry.recipeId,
                            );
                            const out = await updatePlannedRecipe(
                                plans,
                                householdId,
                                args.plan_id,
                                {
                                    recipeId: args.recipe_id,
                                    date: args.date?.trim(),
                                    slot: args.slot,
                                    servings: args.servings,
                                    repeat: args.repeat,
                                    days: args.days,
                                },
                                {
                                    recipes,
                                    today: await householdToday(householdId),
                                    notify,
                                    transaction: planTransaction(
                                        "plan-recipe",
                                        householdId,
                                    ),
                                    recipeName: was?.name ?? null,
                                    // What the change touches, recorded
                                    // before it writes: the domain says which
                                    // rows it ends, removes, skips a day of,
                                    // edits or replaces.
                                    beforeWrite: async ({ rule, plan }) => {
                                        if (rule) {
                                            await rec.captureByIds(
                                                "plan_rules",
                                                [rule.id],
                                                rule.change,
                                            );
                                        }
                                        if (plan) {
                                            await rec.captureByIds(
                                                "recipe_plans",
                                                [plan.id],
                                                plan.change,
                                            );
                                        }
                                    },
                                },
                            );
                            if (!out) throw new Error("Plan not found.");
                            if (out.created.planId) {
                                rec.inserted("recipe_plans", [
                                    out.created.planId,
                                ]);
                            }
                            if (out.created.ruleId) {
                                rec.inserted("plan_rules", [
                                    out.created.ruleId,
                                ]);
                            }
                            const recipe = await recipes.getRecipe(
                                householdId,
                                out.plan.recipeId,
                            );
                            // A plan for named people counts their portions as
                            // saved now, as everywhere else.
                            const portionsOf: Record<string, number> = {};
                            for (const userId of out.plan.memberIds ?? []) {
                                const saved = await recipes.getPortion(
                                    householdId,
                                    out.plan.recipeId,
                                    userId,
                                );
                                if (saved) {
                                    portionsOf[userId] = saved.portionCount;
                                }
                            }
                            const name = recipe?.name ?? "a recipe";
                            return {
                                value: {
                                    out,
                                    wire: planWire(
                                        out.plan,
                                        name,
                                        countedServings(out.plan, {
                                            portions: portionsOf,
                                        }),
                                    ),
                                },
                                summary: `Changed the plan for ${name} on ${entry.date} (${entry.slot})`,
                                changed: !out.unchanged,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    const { out, wire } = run.value;
                    const lead = out.alreadyPlanned
                        ? "Already planned there, nothing changed"
                        : out.unchanged
                          ? "Nothing changed"
                          : "Updated";
                    const repeats =
                        out.repeat === "once"
                            ? ""
                            : ` Repeats ${repeatPatternWords({
                                  repeat: out.repeat,
                                  days: out.days,
                                  startsOn: wire.date,
                              })}.`;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    `${lead}: ${planLine(wire)}${idTag(wire.plan_id, "plan_id")}${idTag(wire.recipe_id, "recipe_id")}${repeats}`,
                                    run.undo,
                                ),
                            },
                        ],
                        structuredContent: {
                            plan: wire,
                            repeat: out.repeat,
                            changed: !out.unchanged,
                            already_planned: out.alreadyPlanned,
                        },
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    server.registerTool(
        "add_plan_missing_to_groceries",
        {
            title: "Add Plan Missing To Groceries",
            description:
                "Put what the week plan still needs, and the kitchen does not hold, on the grocery list: the same lines get_week_plan lists under `missing` for the seven days from `from` (default the household's today; a day before today is refused). A food the list already covers is not added again, so calling it twice adds nothing new; a food whose stock could not be counted is added at the recipe's full amount and listed under `unknown`. Needs at least one store. Prefer this to add_grocery_line per missing line, which would skip those checks.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                from: z
                    .string()
                    .optional()
                    .describe(
                        "First day of the seven, YYYY-MM-DD, today or later. Defaults to the household's today.",
                    ),
            }),
            outputSchema: ADD_PLAN_MISSING_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "add_plan_missing_to_groceries",
                async () => {
                    const householdId = await callerHouseholdId();
                    // Today by default, like the web app; a later day for a
                    // card showing a later window. Never a past one: a plan
                    // the app would not show stays out.
                    const today = await householdToday(householdId);
                    const from =
                        args.from === undefined
                            ? today
                            : checkPlanDay(args.from.trim(), today);
                    const inputs = await loadWeekPlanInputs(householdId, from);
                    const lines = missingForPlan(
                        inputs.plans,
                        inputs.recipes,
                        inputs.stock,
                        {
                            from: inputs.today,
                            days: WEEK_PLAN_DAYS,
                            foodsById: inputs.foodsById,
                        },
                    );
                    const structured = {
                        added: [] as z.infer<
                            typeof ADD_PLAN_MISSING_OUTPUT_SCHEMA
                        >["added"],
                        on_list: [] as z.infer<
                            typeof ADD_PLAN_MISSING_OUTPUT_SCHEMA
                        >["on_list"],
                        unknown: [] as z.infer<
                            typeof ADD_PLAN_MISSING_OUTPUT_SCHEMA
                        >["unknown"],
                        skipped: [] as z.infer<
                            typeof ADD_PLAN_MISSING_OUTPUT_SCHEMA
                        >["skipped"],
                    };
                    if (lines.length === 0) {
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: "Nothing is missing for the plan.",
                                },
                            ],
                            structuredContent: structured,
                        };
                    }
                    let result;
                    try {
                        result = await addMissingToGroceries(
                            liveGroceryStore(),
                            liveSettingsStore(),
                            liveFoodsStore(),
                            { householdId, lines },
                            {
                                transaction: planTransaction(
                                    "plan-missing",
                                    householdId,
                                ),
                            },
                        );
                    } catch (err) {
                        // The caller reads the message ("Add a store first.").
                        if (err instanceof GroceryInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                    for (const line of result.added) {
                        structured.added.push({
                            line_id: line.id,
                            food_id: line.foodId,
                            display_name: line.displayName,
                            amount: line.quantity.amount,
                            unit: line.quantity.unit,
                            store_id: line.storeId,
                            note: line.note,
                        });
                    }
                    for (const entry of result.onList) {
                        structured.on_list.push({
                            food_id: entry.line.foodId,
                            display_name: entry.line.displayName,
                            existing_line_id: entry.existing.id,
                        });
                    }
                    for (const entry of result.unknown) {
                        structured.unknown.push({
                            food_id: entry.line.foodId,
                            display_name: entry.line.displayName,
                            notice: entry.notice,
                        });
                    }
                    for (const entry of result.skipped) {
                        structured.skipped.push({
                            food_id: entry.line.foodId,
                            display_name: entry.line.displayName,
                            reason: entry.reason,
                        });
                    }
                    const foodTag = (row: { food_id: string | null }) =>
                        row.food_id ? idTag(row.food_id, "food_id") : "";
                    const text = [
                        `Added ${structured.added.length} to the grocery list${structured.added.length > 0 ? `: ${structured.added.map((a) => `${a.display_name}${idTag(a.line_id)}${foodTag(a)}${a.store_id ? idTag(a.store_id, "store_id") : ""}`).join(", ")}` : ""}.`,
                        structured.on_list.length > 0
                            ? `Already on the list: ${structured.on_list.map((a) => `${a.display_name}${idTag(a.existing_line_id)}${foodTag(a)}`).join(", ")}.`
                            : null,
                        structured.unknown.length > 0
                            ? `Check what you have: ${structured.unknown.map((a) => `${a.display_name}${foodTag(a)}`).join(", ")}.`
                            : null,
                        structured.skipped.length > 0
                            ? `Skipped: ${structured.skipped.map((a) => `${a.display_name} (${a.reason})${foodTag(a)}`).join(", ")}.`
                            : null,
                    ]
                        .filter((part): part is string => part != null)
                        .join("\n");
                    return {
                        content: [{ type: "text" as const, text }],
                        structuredContent: structured,
                    };
                },
                analytics,
            ),
    );
}
