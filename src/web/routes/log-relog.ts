import {
    snapshotToMealItemWrite,
    type Meal,
    type MealInput,
} from "../../db/nutrition.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { effectiveFoodsByIds, type EffectiveFood } from "../../domain/foods.js";
import {
    relogMeal,
    relogSlotMeals,
    type RecipeMealSource,
    type RelogMealOutput,
    type RelogStoredItem,
} from "../../domain/meals.js";

async function foodsAndRecipesForRelog(
    householdId: string,
    items: readonly RelogStoredItem[],
): Promise<{
    foods: Map<string, EffectiveFood>;
    recipes: Map<string, RecipeMealSource>;
}> {
    const foodIdSet = new Set(
        items
            .map((item) => item.food_id)
            .filter((id): id is string => id != null),
    );
    const recipeIds = [
        ...new Set(
            items
                .map((item) => item.recipe_id)
                .filter((id): id is string => id != null),
        ),
    ];
    const foodsStore = liveFoodsStore();
    const recipesStore = liveRecipesStore();
    const recipes = new Map<string, RecipeMealSource>();
    for (const recipeId of recipeIds) {
        const recipe = await recipesStore.getRecipe(householdId, recipeId);
        if (!recipe) continue;
        const ingredients = await recipesStore.listIngredients(
            householdId,
            recipeId,
        );
        recipes.set(recipeId, { recipe, ingredients });
        for (const row of ingredients) {
            if (row.foodId) foodIdSet.add(row.foodId);
        }
    }
    // Archived foods stay in the map: a recipe's macros still count an
    // archived ingredient (as a fresh log of the recipe does), and
    // `itemCanRelive` keeps an archived food line on its logged snapshot.
    const foods: Map<string, EffectiveFood> = await effectiveFoodsByIds(
        foodsStore,
        householdId,
        foodIdSet,
    );
    return { foods, recipes };
}

export function mealInputFromRelogOutput(
    householdId: string,
    output: RelogMealOutput,
): MealInput {
    return {
        description: output.description,
        meal_type: output.meal_type,
        logged_at: output.logged_at,
        notes: output.notes,
        calories: output.calories,
        protein_g: output.protein_g,
        carbs_g: output.carbs_g,
        fat_g: output.fat_g,
        fiber_g: output.fiber_g,
        sugar_g: output.sugar_g,
        alcohol_g: output.alcohol_g,
        caffeine_mg: output.caffeine_mg,
        items: output.items?.map((item) =>
            snapshotToMealItemWrite(item, householdId),
        ),
        item_digest: output.item_digest,
    };
}

export async function mealInputForRelog(
    householdId: string,
    meal: Meal,
    loggedAt: string,
): Promise<MealInput> {
    const items = (meal.items ?? []) as RelogStoredItem[];
    if (items.length === 0) {
        return mealInputFromRelogOutput(
            householdId,
            relogMeal(meal, [], new Map(), loggedAt),
        );
    }
    const { foods, recipes } = await foodsAndRecipesForRelog(
        householdId,
        items,
    );
    return mealInputFromRelogOutput(
        householdId,
        relogMeal(meal, items, foods, loggedAt, recipes),
    );
}

export async function mealInputForSlotRelog(
    householdId: string,
    meals: Meal[],
    slot: MealInput["meal_type"],
    loggedAt: string,
): Promise<MealInput | null> {
    const flatItems = meals.flatMap(
        (row) => (row.items ?? []) as RelogStoredItem[],
    );
    const { foods, recipes } =
        flatItems.length > 0
            ? await foodsAndRecipesForRelog(householdId, flatItems)
            : { foods: new Map(), recipes: new Map() };
    const output = relogSlotMeals(meals, slot, foods, loggedAt, recipes);
    if (!output) return null;
    return mealInputFromRelogOutput(householdId, output);
}
