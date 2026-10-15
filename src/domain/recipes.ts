import { catalogIdentity } from "./food-identity.js";
import type { FoodIdentity, SupplyIdentity } from "./food-identity.js";
import type { FoodResult } from "../foods.js";
import {
    findFoodById,
    findOrCreateFoodByBarcode,
    findOrCreateManualFood,
    FoodsInputError,
    type Food,
    type FoodsStore,
} from "./foods.js";
import {
    missingGramsReason,
    storedFoodUnit,
    toGrams,
} from "./food-quantity.js";
import {
    resolveGrocerySectionId,
    suggestGrocerySection,
    type GroceryLine,
    type GroceryListStore,
} from "./grocery.js";
import {
    alreadyHaveTag,
    recipeToGroceryRemainder,
    type LinkedNeed,
    type RecipeGroceryRemainderLine,
} from "./linking.js";
import { dimensionOf, isQuantityUnit } from "./quantity.js";
import type { MemberAllergen } from "./rules.js";
import type { SettingsStore } from "./settings.js";

export type Recipe = {
    id: string;
    householdId: string;
    creatorId: string;
    name: string;
    yieldPortions: number;
    instructions: string | null;
    sourceUrl: string | null;
    tags: string[];
    notes: string | null;
    prepMinutes: number | null;
    cookMinutes: number | null;
};

export type IngredientNutrition = {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    basisAmount: number;
    basisUnit: string;
};

export type RecipeIngredient = {
    id: string;
    householdId: string;
    recipeId: string;
    kind: "food";
    displayName: string;
    quantity: { amount: number; unit: string };
    identity: FoodIdentity | SupplyIdentity;
    foodId: string | null;
    nutrition: IngredientNutrition | null;
    sortOrder: number;
    note: string | null;
};

export type RecipePortion = {
    recipeId: string;
    householdId: string;
    userId: string;
    portionCount: number;
};

export type RecipeIngredientView = RecipeIngredient & {
    perPortionAmount: number;
    personAmount: number;
};

export type RecipeView = Recipe & {
    portionCount: number;
    ingredients: RecipeIngredientView[];
};

export type RecipeMacros = {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    incomplete: boolean;
    incompleteReasons: string[];
};

export type RecipesStore = {
    listRecipes(householdId: string): Promise<Recipe[]>;
    getRecipe(householdId: string, id: string): Promise<Recipe | null>;
    insertRecipe(row: Recipe): Promise<Recipe>;
    updateRecipe(row: Recipe): Promise<Recipe | null>;
    deleteRecipe(householdId: string, id: string): Promise<boolean>;
    listIngredients(
        householdId: string,
        recipeId: string,
    ): Promise<RecipeIngredient[]>;
    insertIngredient(row: RecipeIngredient): Promise<RecipeIngredient>;
    updateIngredient(row: RecipeIngredient): Promise<RecipeIngredient | null>;
    deleteIngredient(
        householdId: string,
        ingredientId: string,
    ): Promise<boolean>;
    getPortion(
        householdId: string,
        recipeId: string,
        userId: string,
    ): Promise<RecipePortion | null>;
    upsertPortion(row: RecipePortion): Promise<RecipePortion>;
};

export type RecipePatch = {
    name?: string;
    yieldPortions?: number;
    instructions?: string | null;
    sourceUrl?: string | null;
    tags?: string[];
    notes?: string | null;
    prepMinutes?: number | null;
    cookMinutes?: number | null;
};

export type RecipeIngredientPatch = {
    amount?: number;
    unit?: string;
    note?: string | null;
};

export type RecipeListFilter = {
    tag?: string | null;
    canMakeNow?: boolean;
    safeFor?: {
        allergens: MemberAllergen[];
        dislikes: { displayName: string }[];
    } | null;
};

export type RecipeImportIngredient = {
    name: string;
    amount: number;
    unit?: string;
    note?: string | null;
    foodId?: string;
    barcode?: string;
};

export type IngredientGapKind = "nutrition" | "grams_per_each" | "grams_per_ml";

export type IngredientGap = {
    ingredientId: string;
    foodId: string | null;
    displayName: string;
    missing: IngredientGapKind[];
};

export class RecipeInputError extends Error {
    readonly code = "recipe_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "RecipeInputError";
    }
}

export class RecipeForbiddenError extends Error {
    readonly code = "recipe_forbidden" as const;

    constructor(message: string) {
        super(message);
        this.name = "RecipeForbiddenError";
    }
}

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

function parseAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new RecipeInputError("Enter an amount greater than zero.");
    }
    return amount;
}

function parseYield(yieldPortions: number): number {
    if (!Number.isFinite(yieldPortions) || yieldPortions <= 0) {
        throw new RecipeInputError("Enter a yield greater than zero.");
    }
    return yieldPortions;
}

function parseOptionalText(
    value: string | null | undefined,
    label: string,
    max: number,
): string | null {
    if (value == null) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.length > max) {
        throw new RecipeInputError(`${label} is too long.`);
    }
    return trimmed;
}

function parseOptionalMinutes(
    value: number | null | undefined,
    label: string,
): number | null {
    if (value == null) return null;
    if (!Number.isFinite(value) || value < 0) {
        throw new RecipeInputError(`Enter ${label} as zero or more minutes.`);
    }
    if (!Number.isInteger(value)) {
        throw new RecipeInputError(`${label} must be a whole number.`);
    }
    return value;
}

export function normalizeRecipeTags(tags: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of tags) {
        const tag = raw.trim().toLowerCase();
        if (!tag) continue;
        if (tag.length > 40) {
            throw new RecipeInputError("Tags must be 40 characters or fewer.");
        }
        if (seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
        if (out.length > 20) {
            throw new RecipeInputError("A recipe can have at most 20 tags.");
        }
    }
    return out;
}

export function emptyRecipeDetails(): Pick<
    Recipe,
    | "instructions"
    | "sourceUrl"
    | "tags"
    | "notes"
    | "prepMinutes"
    | "cookMinutes"
> {
    return {
        instructions: null,
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
    };
}

function cloneRecipe(row: Recipe): Recipe {
    return { ...row, tags: [...row.tags] };
}

function cloneIngredient(row: RecipeIngredient): RecipeIngredient {
    return {
        ...row,
        quantity: { ...row.quantity },
        nutrition: row.nutrition ? { ...row.nutrition } : null,
    };
}

function parseUnit(unit: string | undefined): string {
    const trimmed = unit?.trim() ?? "";
    return trimmed || "g";
}

export function perPortionAmount(
    totalAmount: number,
    yieldPortions: number,
): number {
    return roundAmount(totalAmount / yieldPortions);
}

export function amountForPortion(
    totalAmount: number,
    yieldPortions: number,
    portionCount: number,
): number {
    return roundAmount(totalAmount * (portionCount / yieldPortions));
}

export function nutritionFromCatalogFood(
    food: Pick<
        Food,
        | "calories"
        | "proteinG"
        | "carbsG"
        | "fatG"
        | "fiberG"
        | "sugarG"
        | "alcoholG"
    >,
): IngredientNutrition | null {
    const nutrition: IngredientNutrition = {
        calories: food.calories,
        protein_g: food.proteinG,
        carbs_g: food.carbsG,
        fat_g: food.fatG,
        fiber_g: food.fiberG,
        sugar_g: food.sugarG,
        alcohol_g: food.alcoholG,
        basisAmount: 100,
        basisUnit: "g",
    };
    if (
        nutrition.calories == null &&
        nutrition.protein_g == null &&
        nutrition.carbs_g == null &&
        nutrition.fat_g == null
    ) {
        return null;
    }
    return nutrition;
}

export function isNutritionComplete(
    nutrition: IngredientNutrition | null,
): nutrition is IngredientNutrition {
    if (nutrition == null) return false;
    return (
        nutrition.calories != null &&
        nutrition.protein_g != null &&
        nutrition.carbs_g != null &&
        nutrition.fat_g != null
    );
}

function scaleNutrient(value: number | null, factor: number): number | null {
    if (value == null) return null;
    return roundAmount(value * factor);
}

type MacroNutrient = Exclude<
    keyof RecipeMacros,
    "incomplete" | "incompleteReasons"
>;

export function macrosForPerson(
    ingredients: RecipeIngredient[],
    yieldPortions: number,
    portionCount: number,
    foodsById: ReadonlyMap<string, Food> = new Map(),
): RecipeMacros {
    let incomplete = false;
    const incompleteReasons: string[] = [];
    const sum: RecipeMacros = {
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        incomplete: false,
        incompleteReasons: [],
    };
    for (const ingredient of ingredients) {
        const catalog = ingredient.foodId
            ? foodsById.get(ingredient.foodId)
            : undefined;
        const nutrition = catalog
            ? nutritionFromCatalogFood(catalog)
            : ingredient.nutrition;
        if (!isNutritionComplete(nutrition)) {
            incomplete = true;
            continue;
        }
        const eaten = amountForPortion(
            ingredient.quantity.amount,
            yieldPortions,
            portionCount,
        );
        const grams = toGrams(
            { amount: eaten, unit: ingredient.quantity.unit },
            catalog,
        );
        if (grams == null || nutrition.basisAmount <= 0) {
            incomplete = true;
            const reason = missingGramsReason(
                ingredient.displayName,
                ingredient.quantity,
                catalog,
            );
            if (reason) incompleteReasons.push(reason);
            continue;
        }
        if (nutrition.basisUnit !== "g") {
            incomplete = true;
            continue;
        }
        const factor = grams / nutrition.basisAmount;
        const add = (key: MacroNutrient) => {
            const scaled = scaleNutrient(nutrition[key], factor);
            if (scaled == null && sum[key] == null) return;
            sum[key] = roundAmount((sum[key] ?? 0) + (scaled ?? 0));
        };
        add("calories");
        add("protein_g");
        add("carbs_g");
        add("fat_g");
        add("fiber_g");
        add("sugar_g");
        add("alcohol_g");
    }
    sum.incomplete = incomplete;
    sum.incompleteReasons = incompleteReasons;
    return sum;
}

export function createMemoryRecipesStore(): RecipesStore {
    const recipes: Recipe[] = [];
    const ingredients: RecipeIngredient[] = [];
    const portions: RecipePortion[] = [];
    return {
        async listRecipes(householdId) {
            return recipes
                .filter((row) => row.householdId === householdId)
                .map(cloneRecipe);
        },
        async getRecipe(householdId, id) {
            const row = recipes.find(
                (recipe) =>
                    recipe.householdId === householdId && recipe.id === id,
            );
            return row ? cloneRecipe(row) : null;
        },
        async insertRecipe(row) {
            const saved = cloneRecipe(row);
            recipes.push(saved);
            return cloneRecipe(saved);
        },
        async updateRecipe(row) {
            const idx = recipes.findIndex(
                (recipe) =>
                    recipe.householdId === row.householdId &&
                    recipe.id === row.id,
            );
            if (idx < 0) return null;
            recipes[idx] = cloneRecipe(row);
            return cloneRecipe(row);
        },
        async deleteRecipe(householdId, id) {
            const before = recipes.length;
            const next = recipes.filter(
                (row) => !(row.householdId === householdId && row.id === id),
            );
            const removed = next.length < before;
            recipes.length = 0;
            recipes.push(...next);
            const keepIng = ingredients.filter(
                (row) =>
                    !(row.householdId === householdId && row.recipeId === id),
            );
            ingredients.length = 0;
            ingredients.push(...keepIng);
            const keepPortions = portions.filter(
                (row) =>
                    !(row.householdId === householdId && row.recipeId === id),
            );
            portions.length = 0;
            portions.push(...keepPortions);
            return removed;
        },
        async listIngredients(householdId, recipeId) {
            return ingredients
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.recipeId === recipeId,
                )
                .slice()
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map(cloneIngredient);
        },
        async insertIngredient(row) {
            const saved = cloneIngredient(row);
            ingredients.push(saved);
            return cloneIngredient(saved);
        },
        async updateIngredient(row) {
            const idx = ingredients.findIndex(
                (ingredient) =>
                    ingredient.householdId === row.householdId &&
                    ingredient.id === row.id,
            );
            if (idx < 0) return null;
            ingredients[idx] = cloneIngredient(row);
            return cloneIngredient(row);
        },
        async deleteIngredient(householdId, ingredientId) {
            const before = ingredients.length;
            const next = ingredients.filter(
                (row) =>
                    !(
                        row.householdId === householdId &&
                        row.id === ingredientId
                    ),
            );
            const removed = next.length < before;
            ingredients.length = 0;
            ingredients.push(...next);
            return removed;
        },
        async getPortion(householdId, recipeId, userId) {
            const row = portions.find(
                (portion) =>
                    portion.householdId === householdId &&
                    portion.recipeId === recipeId &&
                    portion.userId === userId,
            );
            return row ? { ...row } : null;
        },
        async upsertPortion(row) {
            const idx = portions.findIndex(
                (portion) =>
                    portion.householdId === row.householdId &&
                    portion.recipeId === row.recipeId &&
                    portion.userId === row.userId,
            );
            if (idx >= 0) portions[idx] = { ...row };
            else portions.push({ ...row });
            return { ...row };
        },
    };
}

export async function listRecipes(
    store: RecipesStore,
    householdId: string,
): Promise<Recipe[]> {
    return store.listRecipes(householdId);
}

export async function createRecipe(
    store: RecipesStore,
    input: {
        householdId: string;
        creatorId: string;
        name: string;
        yieldPortions: number;
        instructions?: string | null;
        sourceUrl?: string | null;
        tags?: string[];
        notes?: string | null;
        prepMinutes?: number | null;
        cookMinutes?: number | null;
    },
): Promise<Recipe> {
    const name = input.name.trim();
    if (!name) throw new RecipeInputError("Enter a recipe name.");
    const yieldPortions = parseYield(input.yieldPortions);
    return store.insertRecipe({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        creatorId: input.creatorId,
        name,
        yieldPortions,
        instructions: parseOptionalText(
            input.instructions,
            "Instructions",
            20_000,
        ),
        sourceUrl: parseOptionalText(input.sourceUrl, "Source URL", 2_000),
        tags: normalizeRecipeTags(input.tags ?? []),
        notes: parseOptionalText(input.notes, "Notes", 5_000),
        prepMinutes: parseOptionalMinutes(input.prepMinutes, "prep time"),
        cookMinutes: parseOptionalMinutes(input.cookMinutes, "cook time"),
    });
}

export async function deleteRecipe(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    actor: { userId: string; isOwner: boolean },
): Promise<boolean> {
    const recipe = await store.getRecipe(householdId, recipeId);
    if (!recipe) return false;
    if (recipe.creatorId !== actor.userId && !actor.isOwner) {
        throw new RecipeForbiddenError(
            "Only the creator or household owner can delete this recipe.",
        );
    }
    return store.deleteRecipe(householdId, recipeId);
}

export async function updateRecipe(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    patch: RecipePatch,
): Promise<Recipe> {
    const recipe = await requireRecipe(store, householdId, recipeId);
    const next: Recipe = {
        ...recipe,
        name: patch.name === undefined ? recipe.name : patch.name.trim(),
        yieldPortions:
            patch.yieldPortions === undefined
                ? recipe.yieldPortions
                : parseYield(patch.yieldPortions),
        instructions:
            patch.instructions === undefined
                ? recipe.instructions
                : parseOptionalText(patch.instructions, "Instructions", 20_000),
        sourceUrl:
            patch.sourceUrl === undefined
                ? recipe.sourceUrl
                : parseOptionalText(patch.sourceUrl, "Source URL", 2_000),
        tags:
            patch.tags === undefined
                ? recipe.tags
                : normalizeRecipeTags(patch.tags),
        notes:
            patch.notes === undefined
                ? recipe.notes
                : parseOptionalText(patch.notes, "Notes", 5_000),
        prepMinutes:
            patch.prepMinutes === undefined
                ? recipe.prepMinutes
                : parseOptionalMinutes(patch.prepMinutes, "prep time"),
        cookMinutes:
            patch.cookMinutes === undefined
                ? recipe.cookMinutes
                : parseOptionalMinutes(patch.cookMinutes, "cook time"),
    };
    if (!next.name) throw new RecipeInputError("Enter a recipe name.");
    const saved = await store.updateRecipe(next);
    if (!saved) throw new RecipeInputError("Unknown recipe.");
    return saved;
}

async function requireIngredient(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    ingredientId: string,
): Promise<RecipeIngredient> {
    await requireRecipe(store, householdId, recipeId);
    const ingredients = await store.listIngredients(householdId, recipeId);
    const ingredient = ingredients.find((row) => row.id === ingredientId);
    if (!ingredient) throw new RecipeInputError("Unknown ingredient.");
    return ingredient;
}

export async function updateRecipeIngredient(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    ingredientId: string,
    patch: RecipeIngredientPatch,
): Promise<RecipeIngredient> {
    const ingredient = await requireIngredient(
        store,
        householdId,
        recipeId,
        ingredientId,
    );
    const amount =
        patch.amount === undefined
            ? ingredient.quantity.amount
            : parseAmount(patch.amount);
    const unit =
        patch.unit === undefined
            ? ingredient.quantity.unit
            : parseUnit(patch.unit);
    const note =
        patch.note === undefined
            ? ingredient.note
            : parseOptionalText(patch.note, "Ingredient note", 500);
    const saved = await store.updateIngredient({
        ...ingredient,
        quantity: { amount, unit },
        note,
    });
    if (!saved) throw new RecipeInputError("Unknown ingredient.");
    return saved;
}

export async function removeRecipeIngredient(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    ingredientId: string,
): Promise<boolean> {
    await requireIngredient(store, householdId, recipeId, ingredientId);
    return store.deleteIngredient(householdId, ingredientId);
}

export async function reorderRecipeIngredients(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    orderedIds: string[],
): Promise<RecipeIngredient[]> {
    const ingredients = await store.listIngredients(householdId, recipeId);
    if (orderedIds.length !== ingredients.length) {
        throw new RecipeInputError(
            "Send every ingredient id exactly once to reorder.",
        );
    }
    const byId = new Map(ingredients.map((row) => [row.id, row]));
    const seen = new Set<string>();
    for (const id of orderedIds) {
        if (!byId.has(id) || seen.has(id)) {
            throw new RecipeInputError(
                "Send every ingredient id exactly once to reorder.",
            );
        }
        seen.add(id);
    }
    const next: RecipeIngredient[] = [];
    for (const [index, id] of orderedIds.entries()) {
        const row = byId.get(id)!;
        const saved = await store.updateIngredient({
            ...row,
            sortOrder: index,
        });
        if (saved) next.push(saved);
    }
    return next;
}

async function requireRecipe(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
): Promise<Recipe> {
    const recipe = await store.getRecipe(householdId, recipeId);
    if (!recipe) throw new RecipeInputError("Unknown recipe.");
    return recipe;
}

function wrapFoodsError(err: unknown): never {
    if (err instanceof FoodsInputError) {
        throw new RecipeInputError(err.message);
    }
    throw err;
}

export async function addRecipeIngredientById(
    store: RecipesStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        recipeId: string;
        foodId: string;
        amount: number;
        unit?: string;
    },
): Promise<RecipeIngredient> {
    const recipe = await requireRecipe(
        store,
        input.householdId,
        input.recipeId,
    );
    const amount = parseAmount(input.amount);
    const existing = await store.listIngredients(input.householdId, recipe.id);
    try {
        const food = await findFoodById(foods, input.householdId, input.foodId);
        if (food.kind !== "food") {
            throw new RecipeInputError("That catalog item is a supply.");
        }
        return store.insertIngredient({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity: { amount, unit: storedFoodUnit(input.unit, food) },
            identity: catalogIdentity("food", food.id, food.name),
            foodId: food.id,
            nutrition: nutritionFromCatalogFood(food),
            sortOrder: existing.length,
            note: null,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addRecipeIngredientByBarcode(
    store: RecipesStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        recipeId: string;
        barcode: string;
        amount: number;
        unit?: string;
    },
    opts: {
        lookup: (barcode: string) => Promise<FoodResult | null>;
    },
): Promise<RecipeIngredient> {
    const recipe = await requireRecipe(
        store,
        input.householdId,
        input.recipeId,
    );
    const amount = parseAmount(input.amount);
    const existing = await store.listIngredients(input.householdId, recipe.id);
    try {
        const food = await findOrCreateFoodByBarcode(
            foods,
            input.householdId,
            input.barcode,
            opts.lookup,
        );
        return store.insertIngredient({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity: { amount, unit: storedFoodUnit(input.unit, food) },
            identity: catalogIdentity("food", food.id, food.name),
            foodId: food.id,
            nutrition: nutritionFromCatalogFood(food),
            sortOrder: existing.length,
            note: null,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addRecipeManualIngredient(
    store: RecipesStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        recipeId: string;
        name: string;
        amount: number;
        unit?: string;
    },
): Promise<RecipeIngredient> {
    const recipe = await requireRecipe(
        store,
        input.householdId,
        input.recipeId,
    );
    const amount = parseAmount(input.amount);
    const existing = await store.listIngredients(input.householdId, recipe.id);
    try {
        const food = await findOrCreateManualFood(
            foods,
            input.householdId,
            "food",
            input.name,
        );
        return store.insertIngredient({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity: { amount, unit: storedFoodUnit(input.unit, food) },
            identity: catalogIdentity("food", food.id, food.name),
            foodId: food.id,
            nutrition: nutritionFromCatalogFood(food),
            sortOrder: existing.length,
            note: null,
        });
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function setPersonPortion(
    store: RecipesStore,
    input: {
        householdId: string;
        recipeId: string;
        userId: string;
        portionCount: number;
    },
): Promise<RecipePortion> {
    await requireRecipe(store, input.householdId, input.recipeId);
    const portionCount = parseAmount(input.portionCount);
    return store.upsertPortion({
        recipeId: input.recipeId,
        householdId: input.householdId,
        userId: input.userId,
        portionCount,
    });
}

export async function getRecipeView(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    userId: string,
): Promise<RecipeView> {
    const recipe = await requireRecipe(store, householdId, recipeId);
    const [ingredients, portion] = await Promise.all([
        store.listIngredients(householdId, recipeId),
        store.getPortion(householdId, recipeId, userId),
    ]);
    const portionCount = portion?.portionCount ?? 1;
    return {
        ...recipe,
        portionCount,
        ingredients: ingredients.map((ingredient) => ({
            ...ingredient,
            perPortionAmount: perPortionAmount(
                ingredient.quantity.amount,
                recipe.yieldPortions,
            ),
            personAmount: amountForPortion(
                ingredient.quantity.amount,
                recipe.yieldPortions,
                portionCount,
            ),
        })),
    };
}

/**
 * How many portions a cook or a grocery run is for. By default it is the sum
 * of the members' portions: one meal, nothing left over. `total` overrides it
 * for a whole batch (a loaf, a casserole) or for leftovers ("cook once, eat
 * twice"). It can exceed the members' sum, never fall below it: the extra is
 * cooked or bought but not logged as eaten.
 */
export function resolveTotalPortions(
    memberPortions: number,
    total?: number | null,
): number {
    if (total == null) {
        if (!(memberPortions > 0)) {
            throw new RecipeInputError(
                "Select who this is for, or enter total portions.",
            );
        }
        return memberPortions;
    }
    if (!Number.isFinite(total) || total <= 0) {
        throw new RecipeInputError("Enter total portions greater than zero.");
    }
    if (total < memberPortions) {
        throw new RecipeInputError(
            `Total portions (${total}) can't be less than the portions for people (${memberPortions}).`,
        );
    }
    return total;
}

export async function addRecipeToGrocery(opts: {
    recipes: RecipesStore;
    grocery: GroceryListStore;
    settings: SettingsStore;
    fridgeItems: LinkedNeed[];
    householdId: string;
    recipeId: string;
    storeId: string;
    portionCounts: number[];
    /** See resolveTotalPortions. */
    totalPortions?: number | null;
    foodsById?: ReadonlyMap<string, Food>;
}): Promise<{
    added: GroceryLine[];
    skipped: RecipeGroceryRemainderLine[];
    plan: RecipeGroceryRemainderLine[];
    totalPortions: number;
}> {
    const totalPortions = resolveTotalPortions(
        opts.portionCounts.reduce((sum, n) => sum + n, 0),
        opts.totalPortions,
    );
    const stores = await opts.settings.listStores(opts.householdId);
    if (!stores.some((store) => store.id === opts.storeId)) {
        throw new RecipeInputError("Unknown store.");
    }
    const recipe = await requireRecipe(
        opts.recipes,
        opts.householdId,
        opts.recipeId,
    );
    const ingredients = await opts.recipes.listIngredients(
        opts.householdId,
        opts.recipeId,
    );
    if (ingredients.length === 0) {
        throw new RecipeInputError("Add an ingredient first.");
    }
    const plan = recipeToGroceryRemainder({
        ingredients: ingredients.map((ingredient) => ({
            identity: ingredient.identity,
            displayName: ingredient.displayName,
            quantity: ingredient.quantity,
            foodId: ingredient.foodId,
        })),
        yieldPortions: recipe.yieldPortions,
        portionCounts: opts.portionCounts,
        totalPortions,
        stock: opts.fridgeItems,
        foodsById: opts.foodsById,
    });
    const otherSectionId = await resolveGrocerySectionId(
        opts.settings,
        opts.storeId,
    );
    const allSections = (
        await Promise.all(
            stores.map((store) => opts.settings.listSections(store.id)),
        )
    ).flat();
    const storeSections = allSections.filter(
        (row) => row.storeId === opts.storeId,
    );
    const existingLines = await opts.grocery.listLines(opts.householdId);
    const added: GroceryLine[] = [];
    const skipped: RecipeGroceryRemainderLine[] = [];
    for (const line of plan) {
        if (line.skipped || line.remainder == null) {
            skipped.push(line);
            continue;
        }
        const ingredient = ingredients.find(
            (row) =>
                (line.foodId && row.foodId === line.foodId) ||
                row.displayName === line.displayName,
        );
        const kind = ingredient?.kind ?? "food";
        const foodId = line.foodId ?? ingredient?.foodId ?? null;
        const section = suggestGrocerySection({
            sections: storeSections,
            allSections,
            lines: existingLines,
            kind,
            foodId,
            displayName: line.displayName,
        });
        const inserted = await opts.grocery.insertLine({
            id: crypto.randomUUID(),
            householdId: opts.householdId,
            storeId: opts.storeId,
            sectionId: section?.id ?? otherSectionId,
            kind,
            displayName: line.displayName,
            quantity: line.remainder,
            identity: line.identity,
            foodId,
            checked: false,
        });
        added.push(inserted);
    }
    return { added, skipped, plan, totalPortions };
}

export function ingredientGaps(
    ingredient: RecipeIngredient,
    food: Food | undefined,
): IngredientGapKind[] {
    const missing: IngredientGapKind[] = [];
    const nutrition = food
        ? nutritionFromCatalogFood(food)
        : ingredient.nutrition;
    if (!isNutritionComplete(nutrition)) missing.push("nutrition");
    if (!food) return missing;
    const unit = ingredient.quantity.unit;
    if (isQuantityUnit(unit)) {
        const dim = dimensionOf(unit);
        if (dim === "count" && food.gramsPerEach == null) {
            missing.push("grams_per_each");
        }
        if (dim === "volume" && food.gramsPerMl == null) {
            missing.push("grams_per_ml");
        }
    }
    return missing;
}

export function recipeCanMakeNow(
    ingredients: RecipeIngredient[],
    fridgeStock: LinkedNeed[],
    foodsById: ReadonlyMap<string, Food> = new Map(),
): boolean {
    if (ingredients.length === 0) return false;
    return ingredients.every((ingredient) => {
        const tag = alreadyHaveTag(
            {
                identity: ingredient.identity,
                quantity: ingredient.quantity,
                foodId: ingredient.foodId,
            },
            fridgeStock,
            foodsById,
        );
        return tag?.cover === "full";
    });
}

export function recipeIsSafeFor(
    ingredients: RecipeIngredient[],
    foodsById: ReadonlyMap<string, Food>,
    person: {
        allergens: MemberAllergen[];
        dislikes: { displayName: string }[];
    },
): boolean {
    const names = ingredients.map((row) => row.displayName);
    if (recipeDislikeNote(names, person.dislikes, "member") != null) {
        return false;
    }
    for (const ingredient of ingredients) {
        const food = ingredient.foodId
            ? foodsById.get(ingredient.foodId)
            : undefined;
        const allergens = food?.allergens ?? [];
        for (const row of person.allergens) {
            if (row.allergen === "other") {
                const label = row.otherLabel?.trim().toLowerCase();
                if (
                    allergens.some(
                        (code) => code.trim().toLowerCase() === "other",
                    ) ||
                    (label &&
                        ingredient.displayName.toLowerCase().includes(label))
                ) {
                    return false;
                }
                continue;
            }
            if (
                allergens.some(
                    (code) => code.trim().toLowerCase() === row.allergen,
                )
            ) {
                return false;
            }
        }
    }
    return true;
}

export function recipeMatchesFilter(
    recipe: Recipe,
    ingredients: RecipeIngredient[],
    foodsById: ReadonlyMap<string, Food>,
    fridgeStock: LinkedNeed[],
    filter: RecipeListFilter,
): boolean {
    if (filter.tag) {
        const tag = filter.tag.trim().toLowerCase();
        if (tag && !recipe.tags.includes(tag)) return false;
    }
    if (
        filter.canMakeNow &&
        !recipeCanMakeNow(ingredients, fridgeStock, foodsById)
    ) {
        return false;
    }
    if (
        filter.safeFor &&
        !recipeIsSafeFor(ingredients, foodsById, filter.safeFor)
    ) {
        return false;
    }
    return true;
}

export async function listRecipesFiltered(
    store: RecipesStore,
    householdId: string,
    foodsById: ReadonlyMap<string, Food>,
    fridgeStock: LinkedNeed[],
    filter: RecipeListFilter,
): Promise<Recipe[]> {
    const recipes = await store.listRecipes(householdId);
    const matched: Recipe[] = [];
    for (const recipe of recipes) {
        const ingredients = await store.listIngredients(householdId, recipe.id);
        if (
            recipeMatchesFilter(
                recipe,
                ingredients,
                foodsById,
                fridgeStock,
                filter,
            )
        ) {
            matched.push(recipe);
        }
    }
    return matched;
}

export async function importRecipeFromText(
    store: RecipesStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        creatorId: string;
        text: string;
        sourceUrl?: string | null;
        name?: string;
        yieldPortions?: number;
        ingredients?: RecipeImportIngredient[];
        tags?: string[];
        notes?: string | null;
        prepMinutes?: number | null;
        cookMinutes?: number | null;
    },
    opts: {
        lookup: (barcode: string) => Promise<FoodResult | null>;
    },
): Promise<{
    recipe: Recipe;
    ingredients: RecipeIngredient[];
    gaps: IngredientGap[];
}> {
    const instructions = parseOptionalText(input.text, "Recipe text", 20_000);
    const extractedName = input.name?.trim() ?? "";
    const nameFromText =
        instructions
            ?.split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
    const name = extractedName || nameFromText;
    if (!name) throw new RecipeInputError("Enter a recipe name.");
    const recipe = await createRecipe(store, {
        householdId: input.householdId,
        creatorId: input.creatorId,
        name,
        yieldPortions: input.yieldPortions ?? 1,
        instructions: input.text,
        sourceUrl: input.sourceUrl,
        tags: input.tags,
        notes: input.notes,
        prepMinutes: input.prepMinutes,
        cookMinutes: input.cookMinutes,
    });
    const imported: RecipeIngredient[] = [];
    for (const [index, line] of (input.ingredients ?? []).entries()) {
        const amount = parseAmount(line.amount);
        const unit = parseUnit(line.unit);
        const note = parseOptionalText(line.note, "Ingredient note", 500);
        let food: Food;
        try {
            if (line.foodId) {
                food = await findFoodById(
                    foods,
                    input.householdId,
                    line.foodId,
                );
                if (food.kind !== "food") {
                    throw new RecipeInputError(
                        "That catalog item is a supply.",
                    );
                }
            } else if (line.barcode) {
                food = await findOrCreateFoodByBarcode(
                    foods,
                    input.householdId,
                    line.barcode,
                    opts.lookup,
                );
            } else {
                food = await findOrCreateManualFood(
                    foods,
                    input.householdId,
                    "food",
                    line.name,
                );
            }
        } catch (err) {
            wrapFoodsError(err);
        }
        imported.push(
            await store.insertIngredient({
                id: crypto.randomUUID(),
                householdId: input.householdId,
                recipeId: recipe.id,
                kind: "food",
                displayName: food.name,
                quantity: { amount, unit },
                identity: catalogIdentity("food", food.id, food.name),
                foodId: food.id,
                nutrition: nutritionFromCatalogFood(food),
                sortOrder: index,
                note,
            }),
        );
    }
    const catalog = new Map(
        (await foods.listFoods(input.householdId)).map((row) => [row.id, row]),
    );
    const gaps: IngredientGap[] = imported.map((ingredient) => ({
        ingredientId: ingredient.id,
        foodId: ingredient.foodId,
        displayName: ingredient.displayName,
        missing: ingredientGaps(
            ingredient,
            ingredient.foodId ? catalog.get(ingredient.foodId) : undefined,
        ),
    }));
    return { recipe, ingredients: imported, gaps };
}

export function recipeDislikeNote(
    ingredientNames: string[],
    dislikes: { displayName: string }[],
    personName: string,
): string | null {
    const hits = dislikes.filter((row) => {
        const needle = row.displayName.toLowerCase();
        return ingredientNames.some((name) =>
            name.toLowerCase().includes(needle),
        );
    });
    if (hits.length === 0) return null;
    return `${personName} dislikes ${hits.map((row) => row.displayName).join(", ")}.`;
}

export function recipeFromRow(row: {
    id: unknown;
    household_id: unknown;
    creator_id: unknown;
    name: unknown;
    yield_portions: unknown;
    instructions?: unknown;
    source_url?: unknown;
    tags?: unknown;
    notes?: unknown;
    prep_minutes?: unknown;
    cook_minutes?: unknown;
}): Recipe {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        creatorId: String(row.creator_id),
        name: String(row.name),
        yieldPortions: Number(row.yield_portions),
        instructions:
            row.instructions == null || row.instructions === ""
                ? null
                : String(row.instructions),
        sourceUrl:
            row.source_url == null || row.source_url === ""
                ? null
                : String(row.source_url),
        tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
        notes: row.notes == null || row.notes === "" ? null : String(row.notes),
        prepMinutes:
            row.prep_minutes == null || row.prep_minutes === ""
                ? null
                : Number(row.prep_minutes),
        cookMinutes:
            row.cook_minutes == null || row.cook_minutes === ""
                ? null
                : Number(row.cook_minutes),
    };
}

export function recipeToRow(row: Recipe) {
    return {
        id: row.id,
        household_id: row.householdId,
        creator_id: row.creatorId,
        name: row.name,
        yield_portions: row.yieldPortions,
        instructions: row.instructions,
        source_url: row.sourceUrl,
        tags: row.tags,
        notes: row.notes,
        prep_minutes: row.prepMinutes,
        cook_minutes: row.cookMinutes,
    };
}

export function recipeIngredientFromRow(row: {
    id: unknown;
    household_id: unknown;
    recipe_id: unknown;
    kind: unknown;
    display_name: unknown;
    amount: unknown;
    unit: unknown;
    identity: unknown;
    nutrition: unknown;
    sort_order: unknown;
    food_id?: unknown;
    note?: unknown;
}): RecipeIngredient {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        recipeId: String(row.recipe_id),
        kind: "food",
        displayName: String(row.display_name),
        quantity: {
            amount: Number(row.amount),
            unit: String(row.unit),
        },
        identity: row.identity as FoodIdentity | SupplyIdentity,
        foodId:
            row.food_id == null || row.food_id === ""
                ? null
                : String(row.food_id),
        nutrition: (row.nutrition as IngredientNutrition | null) ?? null,
        sortOrder: Number(row.sort_order) || 0,
        note: row.note == null || row.note === "" ? null : String(row.note),
    };
}

export function recipeIngredientToRow(row: RecipeIngredient) {
    return {
        id: row.id,
        household_id: row.householdId,
        recipe_id: row.recipeId,
        kind: row.kind,
        display_name: row.displayName,
        amount: row.quantity.amount,
        unit: row.quantity.unit,
        identity: row.identity,
        food_id: row.foodId,
        nutrition: row.nutrition,
        sort_order: row.sortOrder,
        note: row.note,
    };
}

export function recipePortionFromRow(row: {
    recipe_id: unknown;
    household_id: unknown;
    user_id: unknown;
    portion_count: unknown;
}): RecipePortion {
    return {
        recipeId: String(row.recipe_id),
        householdId: String(row.household_id),
        userId: String(row.user_id),
        portionCount: Number(row.portion_count),
    };
}

export function recipePortionToRow(row: RecipePortion) {
    return {
        recipe_id: row.recipeId,
        household_id: row.householdId,
        user_id: row.userId,
        portion_count: row.portionCount,
    };
}
