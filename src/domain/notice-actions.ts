// The one-tap actions of the notices that come with one: a usual running low
// goes on the grocery list, and what a planned recipe is missing goes on it.
// Each is an existing write (`addGroceryFoodById`, `addMissingToGroceries`) run
// for exactly the food the notice names. What to add is never taken from the
// caller: the notice is looked up again from the household's data as it is now,
// and an action on a notice that is no longer open does nothing.

import { PLAN_UNKNOWN_LINE_NOTE } from "../copy/toasts.js";
import { effectiveFoodsByIds } from "./foods.js";
import {
    addGroceryFoodById,
    addGrocerySupply,
    type GroceryListStore,
} from "./grocery.js";
import type { FoodsStore } from "./foods.js";
import { PLAN_NOTICE_DAYS, type WeighInStore } from "./notices-actionable.js";
import { noticesFor, type NoticesForDeps } from "./notices-for.js";
import type { Notice, NoticeCode } from "./notices.js";
import {
    addMissingToGroceries,
    addPlanDays,
    missingForPlan,
    planRecipesOf,
} from "./plan-week.js";
import type { PlanTransaction } from "./plan.js";
import type { SettingsStore } from "./settings.js";

/** The codes that act on a write; the weigh-in reminder opens a sheet instead. */
export const ACTIONABLE_NOTICE_CODES = [
    "grocery.running_low",
    "plan.missing_ingredient",
] as const satisfies readonly NoticeCode[];

export type ActionableNoticeCode = (typeof ACTIONABLE_NOTICE_CODES)[number];

export function isActionableNoticeCode(
    code: string,
): code is ActionableNoticeCode {
    return (ACTIONABLE_NOTICE_CODES as readonly string[]).includes(code);
}

export class NoticeActionError extends Error {
    readonly code = "notice_action" as const;

    constructor(message: string) {
        super(message);
        this.name = "NoticeActionError";
    }
}

export type NoticeActionDeps = NoticesForDeps & {
    foods: FoodsStore;
    grocery: GroceryListStore;
    settings: SettingsStore;
    weighIns?: WeighInStore;
    /** Runs the grocery add under the household's plan-missing lock (live stores). */
    transaction?: PlanTransaction;
};

export type NoticeActionResult =
    | {
          status: "added";
          /** The food, as the notice names it. */
          name: string;
          /** Lines put on the list (a food short in two kinds of unit adds two). */
          count: number;
          /** Foods whose stock could not be counted: added at the recipe's amount. */
          checkNames: string[];
      }
    /** The notice is not open (done, dismissed, another household's): nothing was written. */
    | { status: "gone" };

/**
 * Runs the action of the open `code` notice about `subjectId` (a food id).
 * Throws `NoticeActionError` for a code with no write behind it and lets a
 * `GroceryInputError` ("Add a store first.") through. Calling it again for a
 * notice it already resolved returns `gone` and writes nothing.
 */
export async function actOnNotice(
    deps: NoticeActionDeps,
    householdId: string,
    input: { code: NoticeCode; subjectId: string },
    opts: { today: string; timezone: string },
): Promise<NoticeActionResult> {
    if (!isActionableNoticeCode(input.code)) {
        throw new NoticeActionError("That notice has no one-tap action.");
    }
    const { notices } = await noticesFor(deps, householdId, {
        today: opts.today,
        timezone: opts.timezone,
        actionable: true,
    });
    const notice = notices.find(
        (n) =>
            n.code === input.code &&
            n.subject.kind === "food" &&
            n.subject.id === input.subjectId,
    );
    if (!notice) return { status: "gone" };
    if (notice.code === "grocery.running_low") {
        return addUsual(deps, householdId, notice);
    }
    return addPlanMissing(deps, householdId, notice, opts.today);
}

async function addUsual(
    deps: NoticeActionDeps,
    householdId: string,
    notice: Notice,
): Promise<NoticeActionResult> {
    const foodId = notice.subject.id;
    const name = String(notice.params.name);
    const food = (await deps.foods.listFoods(householdId)).find(
        (row) => row.id === foodId,
    );
    if (!food) return { status: "gone" };
    // The same write the restock run makes for a usual, so the line lands in the
    // usual's store and amount (or the default store pick) and is not doubled.
    if (food.kind === "supply") {
        await addGrocerySupply(deps.grocery, deps.settings, deps.foods, {
            householdId,
            name: food.name,
            foodId: food.id,
            source: "restock",
        });
    } else {
        await addGroceryFoodById(deps.grocery, deps.settings, deps.foods, {
            householdId,
            foodId: food.id,
            source: "restock",
        });
    }
    return { status: "added", name, count: 1, checkNames: [] };
}

async function addPlanMissing(
    deps: NoticeActionDeps,
    householdId: string,
    notice: Notice,
    today: string,
): Promise<NoticeActionResult> {
    if (!deps.plans) return { status: "gone" };
    const foodId = notice.subject.id;
    const plans = await deps.plans.listPlans(
        householdId,
        today,
        addPlanDays(today, PLAN_NOTICE_DAYS - 1),
    );
    const [allRecipes, allIngredients, stock] = await Promise.all([
        deps.recipes.listRecipes(householdId),
        deps.recipes.listIngredientsForHousehold(householdId),
        deps.fridge.listItems(householdId),
    ]);
    const recipes = planRecipesOf(plans, allRecipes, allIngredients);
    const planned = new Set(plans.map((plan) => plan.recipeId));
    const foodsById = await effectiveFoodsByIds(deps.foods, householdId, [
        ...allIngredients
            .filter((row) => planned.has(row.recipeId))
            .map((row) => row.foodId),
        ...stock.map((item) => item.foodId),
    ]);
    // Only this food's lines, worked out from the plan as it is now.
    const lines = missingForPlan(
        plans,
        recipes,
        stock.map((item) => ({
            quantity: item.quantity,
            foodId: item.foodId,
        })),
        { from: today, days: PLAN_NOTICE_DAYS, foodsById },
    ).filter((line) => line.foodId === foodId);
    if (lines.length === 0) return { status: "gone" };
    const result = await addMissingToGroceries(
        deps.grocery,
        deps.settings,
        deps.foods,
        { householdId, lines },
        { transaction: deps.transaction },
    );
    if (result.added.length === 0) return { status: "gone" };
    for (const entry of result.unknown) {
        const added = result.added.find(
            (line) => line.foodId === entry.line.foodId,
        );
        if (added && added.note == null) {
            await deps.grocery.updateLine({
                ...added,
                note: PLAN_UNKNOWN_LINE_NOTE,
            });
        }
    }
    return {
        status: "added",
        name: String(notice.params.name),
        count: result.added.length,
        checkNames: [
            ...new Set(result.unknown.map((entry) => entry.line.displayName)),
        ],
    };
}
