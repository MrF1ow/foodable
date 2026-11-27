/**
 * What the week plan is worked out from: the household's plans for the next
 * seven days, the recipes they name, and the kitchen's stock. Shared by the
 * household app and the MCP plan tools.
 */
import { effectiveFoodsByIds, type EffectiveFood } from "../domain/foods.js";
import { listFridge } from "../domain/fridge.js";
import type { PlanRepeat, RecipePlan } from "../domain/plan.js";
import {
    addPlanDays,
    loadPlanVersionSources,
    versionFoodIds,
    planRecipesOf,
    plansOfSavedRecipes,
    WEEK_PLAN_DAYS,
    type PlanRecipe,
} from "../domain/plan-week.js";
import type { RecipeIngredient } from "../domain/recipes.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveRecipePlansStore } from "./plans.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "./recipes.js";
import { householdToday } from "./restock.js";

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
    /** The ingredient rows of the planned recipes, for work (macros) that needs more than `recipes`. */
    plannedIngredients: RecipeIngredient[];
    /** The household's saved recipes: what a planned entry's Recipe menu offers. */
    savedRecipes: { id: string; name: string }[];
    /** How each repeat in `plans` repeats, by its id: what the Repeat row starts on. */
    rules: Map<string, { repeat: PlanRepeat; days: number[] }>;
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
    const listed = await liveRecipePlansStore().listPlans(
        householdId,
        from,
        addPlanDays(from, WEEK_PLAN_DAYS - 1),
    );
    if (listed.length === 0) {
        return {
            today: from,
            plans: listed,
            recipes: [],
            stock: [],
            foodsById: new Map(),
            plannedIngredients: [],
            savedRecipes: [],
            rules: new Map(),
        };
    }
    const recipesStore = liveRecipesStore();
    const [allRecipes, allIngredients, fridge] = await Promise.all([
        recipesStore.listRecipes(householdId),
        recipesStore.listIngredientsForHousehold(householdId),
        listFridge(liveFridgeStore(), householdId),
    ]);
    // listRecipes holds saved recipes only: a plan on a draft is not shown.
    const plans = plansOfSavedRecipes(listed, allRecipes);
    const versions = await loadPlanVersionSources(
        { recipes: recipesStore, variants: liveRecipeVariantsStore() },
        householdId,
        plans,
        allIngredients,
    );
    const recipes = planRecipesOf(plans, allRecipes, allIngredients, versions);
    const plansStore = liveRecipePlansStore();
    const rules = new Map<string, { repeat: PlanRepeat; days: number[] }>();
    const ruleIds = [
        ...new Set(plans.flatMap((p) => (p.ruleId ? [p.ruleId] : []))),
    ];
    for (const rule of await Promise.all(
        ruleIds.map((id) => plansStore.getRule(householdId, id)),
    )) {
        if (rule) rules.set(rule.id, { repeat: rule.repeat, days: rule.days });
    }
    const planned = new Set(plans.map((p) => p.recipeId));
    const plannedIngredients = allIngredients.filter((row) =>
        planned.has(row.recipeId),
    );
    const foodsById = await effectiveFoodsByIds(liveFoodsStore(), householdId, [
        ...plannedIngredients.map((row) => row.foodId),
        ...versionFoodIds(versions),
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
        plannedIngredients,
        savedRecipes: allRecipes.map((recipe) => ({
            id: recipe.id,
            name: recipe.name,
        })),
        rules,
    };
}
