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
import { liveRecipesStore } from "../../db/recipes.js";
import { householdClock, householdToday } from "../../db/restock.js";
import { liveSettingsStore } from "../../db/settings.js";
import { GroceryInputError } from "../../domain/grocery.js";
import { noticesFor } from "../../domain/notices-for.js";
import {
    checkPlanDate,
    checkPlanDay,
    PLAN_SLOTS,
    planRecipe,
    unplanRecipe,
    type RecipePlan,
} from "../../domain/plan.js";
import {
    addMissingToGroceries,
    addPlanDays,
    missingForPlan,
    WEEK_PLAN_DAYS,
    weekPlan,
    type PlanMissingLine,
} from "../../domain/plan-week.js";
import { macrosForPerson } from "../../domain/recipes.js";
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
    }),
    /** The recipe was already planned on that day and meal, so nothing new was made. */
    already_planned: z.boolean(),
});

export const UNPLAN_RECIPE_OUTPUT_SCHEMA = z.object({
    removed: z.literal(true),
    plan_id: z.string(),
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

function planWire(plan: RecipePlan, recipeName: string) {
    return {
        plan_id: plan.id,
        recipe_id: plan.recipeId,
        recipe_name: recipeName,
        date: plan.date,
        slot: plan.slot,
        servings: plan.servings,
    };
}

function planLine(plan: ReturnType<typeof planWire>): string {
    return `${plan.recipe_name} · ${weekdayName(plan.date)} ${plan.date} · ${plan.slot} · ${plan.servings} servings`;
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
    const { callerHouseholdId, callerActor, analytics, runDestructive } = ctx;

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
                "Read the household's week plan: seven days from `from` (default the household's today), each with the recipes planned on it by meal slot, what the planned recipes still need that the kitchen does not hold (`missing`), and the plan's open `notices` (dismiss_notice takes each one's `dismiss` fields). Each plan has a plan_id for unplan_recipe. To put the missing foods on the grocery list call add_plan_missing_to_groceries.",
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
                                servings: plan.servings,
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
                                `- ${day.weekday} ${day.date} · ${plan.slot}: ${plan.recipe_name} (${plan.servings} servings)${idTag(plan.plan_id, "plan_id")}${idTag(plan.recipe_id, "recipe_id")}`,
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
                "Put a recipe on the household's week plan for a day and meal slot. `date` is YYYY-MM-DD in the household's calendar and must be today or later; `slot` is breakfast, lunch, dinner or snack; `servings` defaults to the recipe's yield. Planning the same recipe on the same day and slot twice returns the existing plan (already_planned true).",
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
                    // The web app's Add to plan runs the same function.
                    const outcome = await planRecipe(
                        liveRecipePlansStore(),
                        {
                            householdId,
                            recipeId: recipe.id,
                            recipeName: recipe.name,
                            recipeYield: recipe.yieldPortions,
                            date: args.date.trim(),
                            slot: args.slot,
                            servings: args.servings,
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
                    const wire = planWire(plan, recipe.name);
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: alreadyPlanned
                                    ? `Already planned: ${planLine(wire)}${idTag(wire.plan_id, "plan_id")}`
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
                "Remove one entry from the household's week plan by its plan_id (from get_week_plan or plan_recipe). The recipe itself is untouched.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({ plan_id: z.string() }),
            outputSchema: UNPLAN_RECIPE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "unplan_recipe",
                async () => {
                    const run = await runDestructive(
                        "unplan_recipe",
                        async (rec, householdId, notify) => {
                            const plans = liveRecipePlansStore();
                            const plan = await plans.getPlan(
                                householdId,
                                args.plan_id,
                            );
                            if (!plan) throw new Error("Plan not found.");
                            const recipe = await liveRecipesStore().getRecipe(
                                householdId,
                                plan.recipeId,
                            );
                            await rec.captureByIds(
                                "recipe_plans",
                                [args.plan_id],
                                "deleted",
                            );
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
                            );
                            if (!removed) throw new Error("Plan not found.");
                            return {
                                value: null,
                                summary: `Removed ${recipe?.name ?? "a recipe"} from the plan for ${plan.date} (${plan.slot})`,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    `Removed plan ${args.plan_id}.`,
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
