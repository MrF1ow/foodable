import {
    effectiveFoodsByIds,
    findFoodById,
    findOrCreateManualFood,
    FoodsInputError,
    normalizeFoodName,
    similarFoodsForNames,
    SimilarFoodsError,
    type OnSimilar,
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
    readonly code: "meal_items" | "recipe_unverified";

    constructor(
        message: string,
        code: "meal_items" | "recipe_unverified" = "meal_items",
    ) {
        super(message);
        this.name = "MealItemsError";
        this.code = code;
    }
}

export type MealItemSpec = {
    foodId?: string | null;
    recipeId?: string | null;
    name?: string | null;
    amount?: number | null;
    unit?: string | null;
    portions?: number | null;
    newFood?: boolean;
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
        if (ingredient.quantity == null) continue;
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
    onSimilar?: OnSimilar;
}): Promise<{ built: BuiltMealFromItems; specs: MealItemSpec[] }> {
    const onSimilar = opts.onSimilar ?? "create";
    if (onSimilar === "ask") {
        const namesToCheck: string[] = [];
        for (const spec of opts.items) {
            if (spec.recipeId?.trim()) continue;
            if (spec.foodId?.trim()) continue;
            if (spec.newFood === true) continue;
            const n = spec.name?.trim() ?? "";
            if (n) namesToCheck.push(n);
        }
        if (namesToCheck.length > 0) {
            const entries = await similarFoodsForNames(
                opts.foods,
                opts.householdId,
                "food",
                namesToCheck,
            );
            if (entries.length > 0) {
                throw new SimilarFoodsError(entries);
            }
        }
    }

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
            // Asked once above for every line; what is left is created.
            { onSimilar: "create" },
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
        if (recipe.verification === "unverified") {
            const { assertRecipeVerified } = await import("./recipe-import.js");
            try {
                await assertRecipeVerified(
                    opts.recipes,
                    opts.householdId,
                    recipeId,
                );
            } catch (err) {
                if (
                    err instanceof Error &&
                    err.name === "RecipeUnverifiedError"
                ) {
                    throw new MealItemsError(err.message, "recipe_unverified");
                }
                throw err;
            }
        }
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

export type RelogStoredItem = MealNutrients & {
    food_id: string | null;
    recipe_id: string | null;
    label: string;
    amount: number | null;
    unit: string | null;
    grams: number | null;
    portions: number | null;
};

export type RelogMealSource = MealNutrients & {
    meal_type: string | null;
    description: string;
    notes?: string | null;
    items?: readonly RelogStoredItem[];
};

export type RelogMealOutput = {
    meal_type: "breakfast" | "lunch" | "dinner" | "snack";
    description: string;
    logged_at: string;
    notes?: string;
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    sugar_g?: number;
    alcohol_g?: number;
    caffeine_mg?: number;
    items?: MealItemSnapshot[];
    item_digest?: string;
};

function relogMealType(raw: string | null): RelogMealOutput["meal_type"] {
    switch (raw) {
        case "breakfast":
        case "lunch":
        case "dinner":
        case "snack":
            return raw;
        default:
            return "snack";
    }
}

type OptionalMealNutrients = {
    [K in NutrientKey]?: number;
};

function optionalNutrients(n: MealNutrients): OptionalMealNutrients {
    const out: OptionalMealNutrients = {};
    for (const key of NUTRIENT_KEYS) {
        const value = n[key];
        if (value != null) out[key] = value;
    }
    return out;
}

function storedItemToSnapshot(
    item: RelogStoredItem,
    sortOrder: number,
): MealItemSnapshot {
    return {
        foodId: item.food_id,
        recipeId: item.recipe_id,
        label: item.label,
        amount: item.amount,
        unit: item.unit,
        grams: item.grams,
        portions: item.portions,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fiber_g: item.fiber_g,
        sugar_g: item.sugar_g,
        alcohol_g: item.alcohol_g,
        caffeine_mg: item.caffeine_mg,
        sortOrder,
        unknown: true,
    };
}

function specFromStoredItem(item: RelogStoredItem): MealItemSpec {
    if (item.recipe_id) {
        return {
            recipeId: item.recipe_id,
            name: item.label,
            portions: item.portions ?? 1,
        };
    }
    if (item.food_id) {
        return {
            foodId: item.food_id,
            name: item.label,
            amount: item.amount ?? 1,
            unit: item.unit?.trim() || "g",
        };
    }
    return {
        name: item.label,
        amount: item.amount ?? 1,
        unit: item.unit?.trim() || "g",
    };
}

function itemCanRelive(
    item: RelogStoredItem,
    foods: ReadonlyMap<string, Food>,
    recipes: ReadonlyMap<string, RecipeMealSource>,
): boolean {
    if (item.recipe_id) return recipes.has(item.recipe_id);
    if (item.food_id) {
        const food = foods.get(item.food_id);
        return food != null && food.archivedAt == null;
    }
    return false;
}

/**
 * Build a new meal write from a prior log: food-backed lines re-snapshot from
 * current effective catalog rows; missing, archived, or deleted foods and
 * missing recipes keep the logged snapshot (`unknown` marks those lines).
 * Free-text meals copy totals unchanged.
 */
export function relogMeal(
    meal: RelogMealSource,
    items: readonly RelogStoredItem[],
    foods: ReadonlyMap<string, Food>,
    now: string,
    recipes: ReadonlyMap<string, RecipeMealSource> = new Map(),
): RelogMealOutput {
    const meal_type = relogMealType(meal.meal_type);
    if (items.length === 0) {
        return {
            meal_type,
            description: meal.description,
            logged_at: now,
            ...(meal.notes ? { notes: meal.notes } : {}),
            ...optionalNutrients({
                calories: meal.calories,
                protein_g: meal.protein_g,
                carbs_g: meal.carbs_g,
                fat_g: meal.fat_g,
                fiber_g: meal.fiber_g,
                sugar_g: meal.sugar_g,
                alcohol_g: meal.alcohol_g,
                caffeine_mg: meal.caffeine_mg,
            }),
        };
    }

    const reliveMask = items.map((item) => itemCanRelive(item, foods, recipes));
    const reliveSpecs = items
        .filter((_, index) => reliveMask[index])
        .map(specFromStoredItem);
    const builtItems =
        reliveSpecs.length > 0
            ? buildMealFromItems(reliveSpecs, foods, recipes).items
            : [];
    let builtPtr = 0;
    const merged: MealItemSnapshot[] = items.map((item, index) => {
        if (reliveMask[index]) {
            const snap = builtItems[builtPtr]!;
            builtPtr += 1;
            return { ...snap, sortOrder: index };
        }
        return storedItemToSnapshot(item, index);
    });
    const totals = sumItemNutrients(merged);
    const digestSpecs = items.map(specFromStoredItem);
    return {
        meal_type,
        description: descriptionFromItems(merged),
        logged_at: now,
        ...(meal.notes ? { notes: meal.notes } : {}),
        ...optionalNutrients(totals),
        items: merged,
        item_digest: itemListDigest(digestSpecs),
    };
}

/** Merge every log from a meal slot into one new log input (copy yesterday). */
export function relogSlotMeals(
    meals: readonly RelogMealSource[],
    slot: RelogMealOutput["meal_type"],
    foods: ReadonlyMap<string, Food>,
    now: string,
    recipes: ReadonlyMap<string, RecipeMealSource> = new Map(),
): RelogMealOutput | null {
    if (meals.length === 0) return null;
    const flatItems = meals.flatMap((row) => [...(row.items ?? [])]);
    const freeTextRows = meals.filter((row) => (row.items ?? []).length === 0);
    if (flatItems.length === 0) {
        const totals = sumItemNutrients(
            meals.map((row) => ({
                calories: row.calories,
                protein_g: row.protein_g,
                carbs_g: row.carbs_g,
                fat_g: row.fat_g,
                fiber_g: row.fiber_g,
                sugar_g: row.sugar_g,
                alcohol_g: row.alcohol_g,
                caffeine_mg: row.caffeine_mg,
            })),
        );
        return {
            meal_type: slot,
            description: meals.map((row) => row.description).join(" + "),
            logged_at: now,
            ...optionalNutrients(totals),
        };
    }
    // A free-text log in a slot that also has item logs becomes a label-only
    // item that keeps its logged totals, so the copied meal's totals stay the
    // sum of its items (an amount edit later re-sums them).
    const textItems: RelogStoredItem[] = freeTextRows.map((row) => ({
        food_id: null,
        recipe_id: null,
        label: row.description,
        amount: null,
        unit: null,
        grams: null,
        portions: null,
        calories: row.calories,
        protein_g: row.protein_g,
        carbs_g: row.carbs_g,
        fat_g: row.fat_g,
        fiber_g: row.fiber_g,
        sugar_g: row.sugar_g,
        alcohol_g: row.alcohol_g,
        caffeine_mg: row.caffeine_mg,
    }));
    const fromItems = relogMeal(
        {
            meal_type: slot,
            description: "",
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
        },
        [...flatItems, ...textItems],
        foods,
        now,
        recipes,
    );
    return { ...fromItems, meal_type: slot };
}

export function copyYesterdayIdempotencyKey(
    userId: string,
    todayLocal: string,
    slot: string,
): string {
    return `copy:${userId}:${todayLocal}:${slot}`;
}

/** Distinctness key for recent meal history (food set or normalized text). */
export function recentLogDistinctKey(meal: {
    description: string;
    items?: readonly RelogStoredItem[];
}): string {
    const items = meal.items ?? [];
    if (items.length === 0) {
        return `text:${normalizeFoodName(meal.description)}`;
    }
    const specs = items.map(specFromStoredItem);
    specs.sort((a, b) => {
        const key = (s: MealItemSpec) =>
            [
                s.foodId ?? "",
                s.recipeId ?? "",
                (s.name ?? "").toLowerCase(),
                String(s.amount ?? ""),
                (s.unit ?? "").toLowerCase(),
                String(s.portions ?? ""),
            ].join("\0");
        return key(a).localeCompare(key(b));
    });
    return `items:${itemListDigest(specs)}`;
}
