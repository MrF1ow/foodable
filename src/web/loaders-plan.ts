/**
 * What This week on Today and Recipes is read from: the household's plans for
 * the next seven days, the recipes they name, and the kitchen's stock. Kept
 * apart from `loaders.ts` so the pages that only show it can be tested with
 * this one module stubbed.
 */
import { liveFoodsStore } from "../db/foods.js";
import { liveFridgeStore } from "../db/fridge.js";
import { liveRecipePlansStore } from "../db/plans.js";
import { liveRecipesStore } from "../db/recipes.js";
import { householdToday } from "../db/restock.js";
import { effectiveFoodsByIds, type EffectiveFood } from "../domain/foods.js";
import { listFridge } from "../domain/fridge.js";
import type { RecipePlan } from "../domain/plan.js";
import {
    addPlanDays,
    planRecipesOf,
    WEEK_PLAN_DAYS,
    type PlanRecipe,
} from "../domain/plan-week.js";
import {
    buildWeekPlanView,
    type WeekPlanView,
} from "./pages/v2/recipes-plan.js";

/** What the week's plan is worked out from; the missing-to-groceries route reads it too. */
export type WeekPlanInputs = {
    today: string;
    plans: RecipePlan[];
    recipes: PlanRecipe[];
    stock: {
        quantity: { amount: number; unit: string } | null;
        foodId: string | null;
    }[];
    foodsById: Map<string, EffectiveFood>;
};

/**
 * The household's plans for the next seven days (from the household's today),
 * with the recipes they name and the kitchen's stock. With nothing planned it
 * reads nothing else.
 */
export async function loadWeekPlanInputs(
    householdId: string,
    today?: string,
): Promise<WeekPlanInputs> {
    const from = today ?? (await householdToday(householdId));
    const plans = await liveRecipePlansStore().listPlans(
        householdId,
        from,
        addPlanDays(from, WEEK_PLAN_DAYS - 1),
    );
    if (plans.length === 0) {
        return {
            today: from,
            plans,
            recipes: [],
            stock: [],
            foodsById: new Map(),
        };
    }
    const recipesStore = liveRecipesStore();
    const [allRecipes, allIngredients, fridge] = await Promise.all([
        recipesStore.listRecipes(householdId),
        recipesStore.listIngredientsForHousehold(householdId),
        listFridge(liveFridgeStore(), householdId),
    ]);
    const recipes = planRecipesOf(plans, allRecipes, allIngredients);
    const planned = new Set(plans.map((p) => p.recipeId));
    const foodsById = await effectiveFoodsByIds(liveFoodsStore(), householdId, [
        ...allIngredients
            .filter((row) => planned.has(row.recipeId))
            .map((row) => row.foodId),
        ...fridge.items.map((item) => item.foodId),
    ]);
    return {
        today: from,
        plans,
        recipes,
        stock: fridge.items.map((item) => ({
            quantity: item.quantity,
            foodId: item.foodId,
        })),
        foodsById,
    };
}

/** This week for Today and Recipes: seven days, the plans on them, what is missing. */
export async function loadWeekPlanView(
    householdId: string,
    today?: string,
): Promise<WeekPlanView> {
    return buildWeekPlanView(await loadWeekPlanInputs(householdId, today));
}
