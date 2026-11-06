import {
    effectiveFoodsByIds,
    findFoodById,
    findOrCreateManualFood,
    FoodsInputError,
    type Food,
    type FoodsStore,
} from "./foods.js";
import { toGrams } from "./food-quantity.js";
import {
    macrosForPerson,
    type Recipe,
    type RecipeIngredient,
    type RecipesStore,
} from "./recipes.js";

export class MealItemsError extends Error {
    readonly code = "meal_items" as const;

    constructor(message: string) {
        super(message);
        this.name = "MealItemsError";
    }
}

export type MealItemSpec = {
    foodId?: string | null;
    recipeId?: string | null;
    name?: string | null;
    amount?: number | null;
    unit?: string | null;
    portions?: number | null;
};

export type MealNutrients = {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
};

export type MealItemSnapshot = MealNutrients & {
    foodId: string | null;
    recipeId: string | null;
    label: string;
    amount: number | null;
    unit: string | null;
    grams: number | null;
    portions: number | null;
    sortOrder: number;
    unknown: boolean;
};

export type RecipeMealSource = {
    recipe: Recipe;
    ingredients: RecipeIngredient[];
};

export type BuiltMealFromItems = {
    items: MealItemSnapshot[];
    totals: MealNutrients;
    unknownItems: string[];
};

const NUTRIENT_KEYS = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sugar_g",
    "alcohol_g",
    "caffeine_mg",
] as const;

type NutrientKey = (typeof NUTRIENT_KEYS)[number];

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

function emptyNutrients(): MealNutrients {
    return {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
    };
}

function scaleFrom100g(value: number | null, grams: number): number | null {
    if (value == null) return null;
    return roundAmount(value * (grams / 100));
}

function nutrientsFromFood(food: Food, grams: number | null): MealNutrients {
    if (grams == null) return emptyNutrients();
    return {
        calories: scaleFrom100g(food.calories, grams),
        protein_g: scaleFrom100g(food.proteinG, grams),
        carbs_g: scaleFrom100g(food.carbsG, grams),
        fat_g: scaleFrom100g(food.fatG, grams),
        fiber_g: scaleFrom100g(food.fiberG, grams),
        sugar_g: scaleFrom100g(food.sugarG, grams),
        alcohol_g: scaleFrom100g(food.alcoholG, grams),
        caffeine_mg: scaleFrom100g(food.caffeineMg, grams),
    };
}

function allNutrientsNull(n: MealNutrients): boolean {
    return NUTRIENT_KEYS.every((key) => n[key] == null);
}

export function sumItemNutrients(items: MealNutrients[]): MealNutrients {
    const totals = emptyNutrients();
    for (const item of items) {
        for (const key of NUTRIENT_KEYS) {
            const value = item[key];
            if (value == null) continue;
            totals[key] = roundAmount((totals[key] ?? 0) + value);
        }
    }
    return totals;
}

function parsePositive(
    value: number | null | undefined,
    label: string,
): number | null {
    if (value == null) return null;
    if (!Number.isFinite(value) || value <= 0) {
        throw new MealItemsError(`Enter a ${label} greater than zero.`);
    }
    return value;
}

function snapshotFoodItem(
    spec: MealItemSpec,
    food: Food | null,
    sortOrder: number,
): MealItemSnapshot {
    const amount = parsePositive(spec.amount, "amount");
    const unit = spec.unit?.trim() || food?.defaultUnit || "g";
    const grams = amount == null ? null : toGrams({ amount, unit }, food);
    const nutrients = food ? nutrientsFromFood(food, grams) : emptyNutrients();
    const label =
        spec.name?.trim() ||
        food?.name ||
        (amount != null ? `${amount} ${unit}` : "Food");
    const unknown =
        food == null || grams == null || allNutrientsNull(nutrients);
    return {
        foodId: food?.id ?? spec.foodId?.trim() ?? null,
        recipeId: null,
        label,
        amount,
        unit,
        grams,
        portions: null,
        ...nutrients,
        sortOrder,
        unknown,
    };
}

function recipeCaffeine(
    ingredients: RecipeIngredient[],
    yieldPortions: number,
    portions: number,
    foodsById: ReadonlyMap<string, Food>,
): number | null {
    let total: number | null = null;
    for (const ingredient of ingredients) {
        const food = ingredient.foodId
            ? foodsById.get(ingredient.foodId)
            : undefined;
        if (!food || food.caffeineMg == null) continue;
        const eaten = ingredient.quantity.amount * (portions / yieldPortions);
        const grams = toGrams(
            { amount: eaten, unit: ingredient.quantity.unit },
            food,
        );
        if (grams == null) continue;
        const scaled = scaleFrom100g(food.caffeineMg, grams);
        if (scaled == null) continue;
        total = roundAmount((total ?? 0) + scaled);
    }
    return total;
}

function snapshotRecipeItem(
    spec: MealItemSpec,
    source: RecipeMealSource,
    foodsById: ReadonlyMap<string, Food>,
    sortOrder: number,
): MealItemSnapshot {
    const portions = parsePositive(spec.portions, "portion count") ?? 1;
    const macros = macrosForPerson(
        source.ingredients,
        source.recipe.yieldPortions,
        portions,
        foodsById,
    );
    const nutrients: MealNutrients = {
        calories: macros.calories,
        protein_g: macros.protein_g,
        carbs_g: macros.carbs_g,
        fat_g: macros.fat_g,
        fiber_g: macros.fiber_g,
        sugar_g: macros.sugar_g,
        alcohol_g: macros.alcohol_g,
        caffeine_mg: recipeCaffeine(
            source.ingredients,
            source.recipe.yieldPortions,
            portions,
            foodsById,
        ),
    };
    return {
        foodId: null,
        recipeId: source.recipe.id,
        label: spec.name?.trim() || source.recipe.name,
        amount: null,
        unit: null,
        grams: null,
        portions,
        ...nutrients,
        sortOrder,
        unknown: macros.incomplete || allNutrientsNull(nutrients),
    };
}

/**
 * Resolve grams, snapshot nutrition at write time, and sum meal totals.
 * A nutrient is null on the meal only when every item's value is null.
 * Snapshots are plain values: later edits to a food do not rewrite them.
 */
export function buildMealFromItems(
    specs: MealItemSpec[],
    foods: ReadonlyMap<string, Food>,
    recipes: ReadonlyMap<string, RecipeMealSource> = new Map(),
): BuiltMealFromItems {
    if (specs.length === 0) {
        throw new MealItemsError("Add at least one food or recipe item.");
    }
    const items: MealItemSnapshot[] = specs.map((spec, index) => {
        const recipeId = spec.recipeId?.trim() ?? null;
        if (recipeId) {
            const source = recipes.get(recipeId);
            if (!source) throw new MealItemsError("Unknown recipe.");
            return snapshotRecipeItem(spec, source, foods, index);
        }
        const foodId = spec.foodId?.trim() ?? null;
        if (foodId) {
            const food = foods.get(foodId);
            if (!food) throw new MealItemsError("Unknown food.");
            return snapshotFoodItem(spec, food, index);
        }
        const name = spec.name?.trim() || "";
        if (!name) {
            throw new MealItemsError(
                "Each item needs a food, a recipe, or a name.",
            );
        }
        return snapshotFoodItem({ ...spec, name }, null, index);
    });
    return {
        items,
        totals: sumItemNutrients(items),
        unknownItems: items
            .filter((item) => item.unknown)
            .map((item) => item.label),
    };
}

export function itemListDigest(specs: MealItemSpec[]): string {
    const rows = specs.map((spec) => ({
        food_id: spec.foodId?.trim() ?? "",
        recipe_id: spec.recipeId?.trim() ?? "",
        name: (spec.name ?? "").trim().toLowerCase(),
        amount: spec.amount ?? "",
        unit: (spec.unit ?? "").trim().toLowerCase(),
        portions: spec.portions ?? "",
    }));
    return JSON.stringify(rows);
}

export function descriptionFromItems(items: MealItemSnapshot[]): string {
    return items
        .map((item) => {
            if (item.portions != null) {
                return `${item.portions} portion${item.portions === 1 ? "" : "s"} ${item.label}`;
            }
            if (item.amount != null && item.unit) {
                return `${item.amount} ${item.unit} ${item.label}`;
            }
            return item.label;
        })
        .join(" + ");
}

export type MealItemWrite = MealItemSnapshot & {
    householdId: string | null;
};

export function mealItemToWrite(
    item: MealItemSnapshot,
    householdId: string | null,
): MealItemWrite {
    return { ...item, householdId };
}

/**
 * Resolve catalog/recipe refs through the stores, then snapshot. Names
 * find-or-create a manual food so "eggs" in a meal is the household food.
 */
export async function resolveAndBuildMeal(opts: {
    householdId: string;
    foods: FoodsStore;
    recipes: RecipesStore;
    items: MealItemSpec[];
}): Promise<{ built: BuiltMealFromItems; specs: MealItemSpec[] }> {
    const resolved: MealItemSpec[] = [];
    const foodIds = new Set<string>();
    const recipeIds = new Set<string>();
    for (const spec of opts.items) {
        const recipeId = spec.recipeId?.trim() ?? null;
        if (recipeId) {
            recipeIds.add(recipeId);
            resolved.push({ ...spec, recipeId });
            continue;
        }
        const foodId = spec.foodId?.trim() ?? null;
        if (foodId) {
            try {
                const food = await findFoodById(
                    opts.foods,
                    opts.householdId,
                    foodId,
                );
                foodIds.add(food.id);
                resolved.push({
                    ...spec,
                    foodId: food.id,
                    name: spec.name || food.name,
                });
            } catch (err) {
                if (err instanceof FoodsInputError) {
                    throw new MealItemsError(err.message);
                }
                throw err;
            }
            continue;
        }
        const name = spec.name?.trim() || "";
        if (!name) {
            throw new MealItemsError(
                "Each item needs a food, a recipe, or a name.",
            );
        }
        const food = await findOrCreateManualFood(
            opts.foods,
            opts.householdId,
            "food",
            name,
        );
        foodIds.add(food.id);
        resolved.push({ ...spec, foodId: food.id, name: food.name });
    }

    const foodsById = await effectiveFoodsByIds(opts.foods, opts.householdId, [
        ...foodIds,
    ]);
    const recipesById = new Map<string, RecipeMealSource>();
    for (const recipeId of recipeIds) {
        const recipe = await opts.recipes.getRecipe(opts.householdId, recipeId);
        if (!recipe) throw new MealItemsError("Unknown recipe.");
        const ingredients = await opts.recipes.listIngredients(
            opts.householdId,
            recipeId,
        );
        recipesById.set(recipeId, { recipe, ingredients });
        for (const ingredient of ingredients) {
            if (ingredient.foodId) foodIds.add(ingredient.foodId);
        }
    }
    const foodsForRecipes = await effectiveFoodsByIds(
        opts.foods,
        opts.householdId,
        [...foodIds],
    );
    for (const [id, food] of foodsForRecipes) foodsById.set(id, food);

    return {
        built: buildMealFromItems(resolved, foodsById, recipesById),
        specs: resolved,
    };
}

export function callerSentTotals(fields: {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sugar_g?: number;
    alcohol_g?: number;
    caffeine_mg?: number;
}): boolean {
    return (
        fields.calories != null ||
        fields.protein_g != null ||
        fields.carbs_g != null ||
        fields.fat_g != null ||
        fields.fiber_g != null ||
        fields.sugar_g != null ||
        fields.alcohol_g != null ||
        fields.caffeine_mg != null
    );
}

export const COMPUTED_TOTALS_WARNING =
    "Item nutrition was computed from the food list; the calories and macros you sent were ignored.";
