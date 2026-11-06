import { formatMissingNutrientList, noticeSentence } from "../copy/notices.js";
import { normalizeBarcode, type FoodResult } from "../foods.js";
import type { Notice, NoticeCode, NoticeRelated } from "./notices.js";
import { NOTICE_SEVERITY } from "./notices.js";
import {
    effectiveFoodsByIds,
    familyOf,
    findFoodById,
    findOrCreateFoodByBarcode,
    findOrCreateFoodByBarcodeFromHit,
    findOrCreateManualFood,
    FoodsInputError,
    type EffectiveFood,
    type Food,
    type FoodsStore,
} from "./foods.js";
import { familyIdOf } from "./food-quantity.js";
import { missingGramsGap, storedFoodUnit, toGrams } from "./food-quantity.js";
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
import type { MemberAllergen } from "./rules.js";
import type { SettingsStore } from "./settings.js";
import {
    cleanupDismissalsForRecipe,
    cleanupDismissalsForSubject,
    type MemoryNoticeDismissalsHolder,
    type NoticeDismissalsStore,
} from "./notice-dismissals.js";
import {
    recheckRecipe,
    type RecipeImport,
    type RecipeProblem,
    type RecipeVerification,
} from "./recipe-import.js";
import { assertRecipeVerified } from "./recipe-import.js";

export type { RecipeVerification, RecipeImport, RecipeProblem };
export {
    recheckRecipe,
    RecipeUnverifiedError,
    resolveUnresolvedLines,
} from "./recipe-import.js";

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
    verification: RecipeVerification;
    updatedAt: string;
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
    quantity: { amount: number; unit: string } | null;
    foodId: string | null;
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
    perPortionAmount: number | null;
    personAmount: number | null;
};

export type RecipeView = Recipe & {
    portionCount: number;
    ingredients: RecipeIngredientView[];
};

export type RecipeGapReason =
    | "no_food"
    | "no_nutrition"
    | "partial_nutrition"
    | "no_amount"
    | "unknown_unit"
    | "missing_grams_per_each"
    | "missing_grams_per_ml";

export type RecipeGapNutrient = "calories" | "protein_g" | "carbs_g" | "fat_g";

export type RecipeGap = {
    ingredientId: string;
    displayName: string;
    foodId: string | null;
    reason: RecipeGapReason;
    missingNutrients: RecipeGapNutrient[];
    usualProduct: { id: string; name: string } | null;
    message: string;
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
    gaps: RecipeGap[];
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
    listIngredientsForHousehold(
        householdId: string,
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
    recipeActivityMsById?(householdId: string): Promise<Map<string, number>>;
    getImport(
        householdId: string,
        recipeId: string,
    ): Promise<RecipeImport | null>;
    upsertImport(row: RecipeImport): Promise<RecipeImport>;
    setVerification(
        householdId: string,
        recipeId: string,
        verification: RecipeVerification,
        problems: RecipeProblem[],
    ): Promise<void>;
    deleteStaleUnverified(householdId: string, before: Date): Promise<number>;
    findRecipeBySourceUrl(
        householdId: string,
        urls: string[],
    ): Promise<Recipe | null>;
    listImports(householdId: string): Promise<RecipeImport[]>;
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
    /** null clears amount and unit (to taste). */
    amount?: number | null;
    unit?: string;
    note?: string | null;
};

export type RecipeListFilter = {
    tag?: string | null;
    canMakeNow?: boolean;
    verification?: RecipeVerification | null;
    safeFor?: {
        allergens: MemberAllergen[];
        dislikes: { displayName: string }[];
    } | null;
};

export type RecipeImportIngredient = {
    name: string;
    amount?: number | null;
    unit?: string;
    note?: string | null;
    foodId?: string;
    barcode?: string;
};

export type IngredientGapKind =
    "nutrition" | "amount" | "grams_per_each" | "grams_per_ml";

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

function quantityForNewIngredient(
    amount: number | null | undefined,
    unit: string | undefined,
    food: Food,
): RecipeIngredient["quantity"] {
    if (amount == null) return null;
    return {
        amount: parseAmount(amount),
        unit: storedFoodUnit(unit, food),
    };
}

function noteForUnmeasuredIngredient(
    quantity: RecipeIngredient["quantity"],
    note: string | null,
): string | null {
    if (quantity != null) return note;
    return note?.trim() ? note : "to taste";
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

const STEP_MARKER = /^(?:step\s*\d+\s*[:.)-]?|\d+[.)](?=\s|$)|[-*•](?=\s))\s*/i;

/**
 * Splits stored instructions into display steps. Plain lines are one step
 * each. Once the text uses blank lines or numbering, a step starts at a blank
 * line or a numbered/bulleted line and following lines wrap into it. Typed or
 * pasted numbering ("1.", "Step 2:", "-") is dropped because the list numbers
 * itself.
 */
export function recipeSteps(instructions: string | null): string[] {
    if (!instructions) return [];
    const lines = instructions
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim());
    const structured =
        lines.some((line) => STEP_MARKER.test(line)) ||
        /\n\s*\n/.test(instructions.replace(/\r\n?/g, "\n").trim());
    const steps: string[] = [];
    let current: string[] = [];
    const flush = () => {
        const step = current.join(" ").trim();
        if (step) steps.push(step);
        current = [];
    };
    for (const line of lines) {
        if (!line) {
            flush();
            continue;
        }
        const marked = STEP_MARKER.test(line);
        if (!structured || marked) flush();
        current.push(marked ? line.replace(STEP_MARKER, "") : line);
    }
    flush();
    return steps;
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
        quantity: row.quantity ? { ...row.quantity } : null,
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

const REQUIRED_MACRO_KEYS: RecipeGapNutrient[] = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
];

function missingRequiredNutrients(
    nutrition: IngredientNutrition,
): RecipeGapNutrient[] {
    return REQUIRED_MACRO_KEYS.filter((key) => nutrition[key] == null);
}

function usualProductRef(
    food: Food | undefined,
): { id: string; name: string } | null {
    if (!food || !("product" in food)) return null;
    const product = (food as EffectiveFood).product;
    if (!product) return null;
    return { id: product.id, name: product.name };
}

function gapBase(
    ingredient: RecipeIngredient,
    food: Food | undefined,
): Pick<RecipeGap, "ingredientId" | "displayName" | "foodId" | "usualProduct"> {
    return {
        ingredientId: ingredient.id,
        displayName: ingredient.displayName,
        foodId: ingredient.foodId,
        usualProduct: usualProductRef(food),
    };
}

export function recipeIngredientGaps(
    ingredient: RecipeIngredient,
    food: Food | undefined,
): RecipeGap[] {
    if (ingredient.quantity == null) {
        const note = ingredient.note?.trim();
        const taste = note || "to taste";
        return [
            {
                ...gapBase(ingredient, food),
                reason: "no_amount",
                missingNutrients: [...REQUIRED_MACRO_KEYS],
                message: `${ingredient.displayName} has no amount (${taste}), so it isn't counted.`,
            },
        ];
    }
    if (!ingredient.foodId || !food) {
        return [
            {
                ...gapBase(ingredient, food),
                reason: "no_food",
                missingNutrients: [],
                message: `${ingredient.displayName}: not linked to a food`,
            },
        ];
    }
    const gaps: RecipeGap[] = [];
    const nutrition = nutritionFromCatalogFood(food);
    if (nutrition == null) {
        const usual = usualProductRef(food);
        gaps.push({
            ...gapBase(ingredient, food),
            reason: "no_nutrition",
            missingNutrients: [],
            message: usual
                ? `${ingredient.displayName}: no nutrition — its usual product, ${usual.name}, has none either`
                : `${ingredient.displayName}: no nutrition — add it, or pick a usual product`,
        });
    } else if (!isNutritionComplete(nutrition)) {
        const missing = missingRequiredNutrients(nutrition);
        gaps.push({
            ...gapBase(ingredient, food),
            reason: "partial_nutrition",
            missingNutrients: missing,
            message: `${ingredient.displayName}: missing ${formatMissingNutrientList(missing)}`,
        });
    }
    const gramsGap = missingGramsGap(
        ingredient.displayName,
        ingredient.quantity,
        food,
    );
    if (gramsGap) {
        gaps.push({
            ...gapBase(ingredient, food),
            reason: gramsGap.reason,
            missingNutrients: [],
            message: gramsGap.message,
        });
    }
    return gaps;
}

function gapToNotice(recipeId: string, gap: RecipeGap): Notice {
    const code = `recipe.${gap.reason}` as NoticeCode;
    const related: NoticeRelated[] = gap.usualProduct
        ? [
              {
                  kind: "food",
                  id: gap.usualProduct.id,
                  name: gap.usualProduct.name,
              },
          ]
        : [];
    const params: Record<string, string | number | string[]> = {
        name: gap.displayName,
    };
    if (gap.foodId != null) {
        params.foodId = gap.foodId;
    }
    if (gap.reason === "partial_nutrition" && gap.missingNutrients.length > 0) {
        params.missing = [...gap.missingNutrients];
    }
    return {
        code,
        severity: NOTICE_SEVERITY[code],
        subject: {
            kind: "recipe_ingredient",
            id: gap.ingredientId,
            recipeId,
        },
        related,
        params,
    };
}

export function recipeIngredientNotices(
    recipeId: string,
    ingredient: RecipeIngredient,
    food: Food | undefined,
): Notice[] {
    return recipeIngredientGaps(ingredient, food).map((g) => {
        const notice = gapToNotice(recipeId, g);
        if (g.reason === "no_amount") {
            notice.params.taste = ingredient.note?.trim() || "to taste";
        }
        return notice;
    });
}

export function recipeNotices(
    recipeId: string,
    ingredients: readonly RecipeIngredient[],
    foodsById: ReadonlyMap<string, Food>,
): Notice[] {
    const out: Notice[] = [];
    for (const ingredient of ingredients) {
        const food = ingredient.foodId
            ? foodsById.get(ingredient.foodId)
            : undefined;
        out.push(...recipeIngredientNotices(recipeId, ingredient, food));
    }
    return out;
}

export function gapFromNotice(notice: Notice): RecipeGap {
    const reason = notice.code.replace("recipe.", "") as RecipeGapReason;
    const usual =
        notice.related[0] != null
            ? {
                  id: notice.related[0]!.id,
                  name: notice.related[0]!.name,
              }
            : null;
    const subj = notice.subject;
    const ingredientId = subj.kind === "recipe_ingredient" ? subj.id : "";
    const foodIdParam = notice.params.foodId;
    return {
        ingredientId,
        displayName: String(notice.params.name),
        foodId: typeof foodIdParam === "string" ? foodIdParam : null,
        reason,
        missingNutrients: Array.isArray(notice.params.missing)
            ? (notice.params.missing as RecipeGapNutrient[])
            : [],
        usualProduct: usual,
        message: noticeSentence(notice),
    };
}

function scaleNutrient(value: number | null, factor: number): number | null {
    if (value == null) return null;
    return roundAmount(value * factor);
}

type MacroNutrient = Exclude<
    keyof RecipeMacros,
    "incomplete" | "incompleteReasons" | "gaps"
>;

export function macrosForPerson(
    ingredients: RecipeIngredient[],
    yieldPortions: number,
    portionCount: number,
    foodsById: ReadonlyMap<string, Food> = new Map(),
): RecipeMacros {
    const gaps: RecipeGap[] = [];
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
        gaps: [],
    };
    for (const ingredient of ingredients) {
        const catalog = ingredient.foodId
            ? foodsById.get(ingredient.foodId)
            : undefined;
        const notices = recipeIngredientNotices(
            ingredient.recipeId,
            ingredient,
            catalog,
        );
        gaps.push(...notices.map(gapFromNotice));
        if (notices.length > 0) continue;
        if (ingredient.quantity == null) continue;
        const nutrition = nutritionFromCatalogFood(catalog!)!;
        const eaten = amountForPortion(
            ingredient.quantity.amount,
            yieldPortions,
            portionCount,
        );
        const grams = toGrams(
            { amount: eaten, unit: ingredient.quantity.unit },
            catalog,
        );
        if (grams == null) continue;
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
    sum.gaps = gaps;
    const seen = new Set<string>();
    sum.incompleteReasons = gaps
        .map((gap) => gap.message)
        .filter((message) => {
            if (seen.has(message)) return false;
            seen.add(message);
            return true;
        });
    sum.incomplete = gaps.length > 0;
    return sum;
}

function nowIso(): string {
    return new Date().toISOString();
}

async function maybeRecheckUnverified(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    wasUnverified: boolean,
): Promise<void> {
    if (wasUnverified) {
        await recheckRecipe(store, householdId, recipeId);
    }
}

export type MemoryRecipesStore = RecipesStore &
    MemoryNoticeDismissalsHolder & {
        __paritySetRecipeActivityAt?(id: string, activityAt: string): void;
    };

type MemoryRecipeRow = Recipe & { activityAt: string };

export function createMemoryRecipesStore(): MemoryRecipesStore {
    const recipes: MemoryRecipeRow[] = [];
    const ingredients: RecipeIngredient[] = [];
    const portions: RecipePortion[] = [];
    let linkedDismissals: NoticeDismissalsStore | undefined;
    const imports = new Map<string, RecipeImport>();

    function bumpRecipe(householdId: string, recipeId: string): void {
        const idx = recipes.findIndex(
            (row) => row.householdId === householdId && row.id === recipeId,
        );
        if (idx >= 0) {
            recipes[idx] = { ...recipes[idx]!, updatedAt: nowIso() };
        }
    }

    return {
        linkDismissals(s) {
            linkedDismissals = s;
        },
        dismissalsStore() {
            return linkedDismissals;
        },
        async listRecipes(householdId) {
            return recipes
                .filter((row) => row.householdId === householdId)
                .map(cloneRecipe)
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        async getRecipe(householdId, id) {
            const row = recipes.find(
                (recipe) =>
                    recipe.householdId === householdId && recipe.id === id,
            );
            return row ? cloneRecipe(row) : null;
        },
        async insertRecipe(row) {
            const saved: MemoryRecipeRow = {
                ...cloneRecipe(row),
                activityAt: new Date().toISOString(),
            };
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
            const updated: MemoryRecipeRow = {
                ...cloneRecipe({ ...row, updatedAt: nowIso() }),
                activityAt: new Date().toISOString(),
            };
            recipes[idx] = updated;
            return cloneRecipe(updated);
        },
        async recipeActivityMsById(householdId) {
            const map = new Map<string, number>();
            for (const recipe of recipes) {
                if (recipe.householdId === householdId) {
                    map.set(recipe.id, Date.parse(recipe.activityAt));
                }
            }
            return map;
        },
        __paritySetRecipeActivityAt(id: string, activityAt: string) {
            const row = recipes.find((recipe) => recipe.id === id);
            if (row) row.activityAt = activityAt;
        },
        async deleteRecipe(householdId, id) {
            const ingIds = ingredients
                .filter(
                    (row) =>
                        row.householdId === householdId && row.recipeId === id,
                )
                .map((row) => row.id);
            await cleanupDismissalsForRecipe(
                linkedDismissals,
                householdId,
                id,
                ingIds,
            );
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
            imports.delete(id);
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
        async listIngredientsForHousehold(householdId) {
            return ingredients
                .filter((row) => row.householdId === householdId)
                .slice()
                .sort(
                    (a, b) =>
                        a.recipeId.localeCompare(b.recipeId) ||
                        a.sortOrder - b.sortOrder,
                )
                .map(cloneIngredient);
        },
        async insertIngredient(row) {
            const saved = cloneIngredient(row);
            ingredients.push(saved);
            bumpRecipe(row.householdId, row.recipeId);
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
            bumpRecipe(row.householdId, row.recipeId);
            return cloneIngredient(row);
        },
        async deleteIngredient(householdId, ingredientId) {
            const target = ingredients.find(
                (row) =>
                    row.householdId === householdId && row.id === ingredientId,
            );
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
            if (removed) {
                await cleanupDismissalsForSubject(
                    linkedDismissals,
                    householdId,
                    "recipe_ingredient",
                    ingredientId,
                );
            }
            if (removed && target) {
                bumpRecipe(householdId, target.recipeId);
            }
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
        async getImport(householdId, recipeId) {
            const row = imports.get(recipeId);
            if (!row || row.householdId !== householdId) return null;
            return {
                ...row,
                unresolvedLines: [...row.unresolvedLines],
                problems: [...row.problems],
            };
        },
        async upsertImport(row) {
            const saved = {
                ...row,
                unresolvedLines: [...row.unresolvedLines],
                problems: [...row.problems],
            };
            imports.set(row.recipeId, saved);
            return { ...saved };
        },
        async setVerification(householdId, recipeId, verification, problems) {
            const idx = recipes.findIndex(
                (row) => row.householdId === householdId && row.id === recipeId,
            );
            if (idx >= 0) {
                recipes[idx] = { ...recipes[idx]!, verification };
            }
            const imp = imports.get(recipeId);
            if (imp && imp.householdId === householdId) {
                imports.set(recipeId, {
                    ...imp,
                    problems: problems.map((p) => ({ ...p })),
                });
            }
        },
        async findRecipeBySourceUrl(householdId, urls) {
            const keys = new Set(
                urls.map((u) => u.trim()).filter((u) => u.length > 0),
            );
            if (keys.size === 0) return null;
            const hit = recipes.find(
                (row) =>
                    row.householdId === householdId &&
                    row.sourceUrl != null &&
                    keys.has(row.sourceUrl),
            );
            return hit ? cloneRecipe(hit) : null;
        },
        async listImports(householdId) {
            const out: RecipeImport[] = [];
            for (const row of imports.values()) {
                if (row.householdId !== householdId) continue;
                out.push({
                    ...row,
                    unresolvedLines: [...row.unresolvedLines],
                    problems: row.problems.map((p) => ({ ...p })),
                });
            }
            return out;
        },
        async deleteStaleUnverified(householdId, before) {
            const cutoff = before.toISOString();
            const staleIds = recipes
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.verification === "unverified" &&
                        row.updatedAt < cutoff,
                )
                .map((row) => row.id);
            for (const id of staleIds) {
                imports.delete(id);
                const nextRecipes = recipes.filter(
                    (row) =>
                        !(row.householdId === householdId && row.id === id),
                );
                recipes.length = 0;
                recipes.push(...nextRecipes);
                const keepIng = ingredients.filter(
                    (row) =>
                        !(
                            row.householdId === householdId &&
                            row.recipeId === id
                        ),
                );
                ingredients.length = 0;
                ingredients.push(...keepIng);
                const keepPortions = portions.filter(
                    (row) =>
                        !(
                            row.householdId === householdId &&
                            row.recipeId === id
                        ),
                );
                portions.length = 0;
                portions.push(...keepPortions);
            }
            return staleIds.length;
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
        verification?: RecipeVerification;
    },
): Promise<Recipe> {
    const name = input.name.trim();
    if (!name) throw new RecipeInputError("Enter a recipe name.");
    const yieldPortions = parseYield(input.yieldPortions);
    const stamp = nowIso();
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
        verification: input.verification ?? "verified",
        updatedAt: stamp,
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
    const wasUnverified = recipe.verification === "unverified";
    const saved = await store.updateRecipe(next);
    if (!saved) throw new RecipeInputError("Unknown recipe.");
    await maybeRecheckUnverified(store, householdId, recipeId, wasUnverified);
    return (await store.getRecipe(householdId, recipeId)) ?? saved;
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
    foods?: FoodsStore,
): Promise<RecipeIngredient> {
    const recipe = await requireRecipe(store, householdId, recipeId);
    const wasUnverified = recipe.verification === "unverified";
    const ingredient = await requireIngredient(
        store,
        householdId,
        recipeId,
        ingredientId,
    );
    const note =
        patch.note === undefined
            ? ingredient.note
            : parseOptionalText(patch.note, "Ingredient note", 500);
    // A blank unit (an untouched form field) means "not given", not grams.
    const unitIn = patch.unit?.trim() ? patch.unit : undefined;
    let quantity: RecipeIngredient["quantity"];
    if (patch.amount === null) {
        quantity = null;
    } else if (patch.amount === undefined) {
        if (ingredient.quantity == null) {
            quantity = null;
        } else {
            quantity = {
                amount: ingredient.quantity.amount,
                unit:
                    unitIn === undefined
                        ? ingredient.quantity.unit
                        : parseUnit(unitIn),
            };
        }
    } else {
        const amount = parseAmount(patch.amount);
        let unit;
        if (unitIn !== undefined) {
            unit = parseUnit(unitIn);
        } else if (ingredient.quantity?.unit) {
            unit = ingredient.quantity.unit;
        } else if (foods && ingredient.foodId) {
            const food = await foods.getFood(householdId, ingredient.foodId);
            unit = parseUnit(
                storedFoodUnit(undefined, food ?? { defaultUnit: "g" }),
            );
        } else {
            unit = parseUnit(undefined);
        }
        quantity = { amount, unit };
    }
    const saved = await store.updateIngredient({
        ...ingredient,
        quantity,
        note: noteForUnmeasuredIngredient(quantity, note),
    });
    if (!saved) throw new RecipeInputError("Unknown ingredient.");
    await maybeRecheckUnverified(store, householdId, recipeId, wasUnverified);
    return saved;
}

export async function removeRecipeIngredient(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    ingredientId: string,
): Promise<boolean> {
    const recipe = await requireRecipe(store, householdId, recipeId);
    const wasUnverified = recipe.verification === "unverified";
    await requireIngredient(store, householdId, recipeId, ingredientId);
    const removed = await store.deleteIngredient(householdId, ingredientId);
    if (removed) {
        await maybeRecheckUnverified(
            store,
            householdId,
            recipeId,
            wasUnverified,
        );
    }
    return removed;
}

export async function reorderRecipeIngredients(
    store: RecipesStore,
    householdId: string,
    recipeId: string,
    orderedIds: string[],
): Promise<RecipeIngredient[]> {
    const recipe = await requireRecipe(store, householdId, recipeId);
    const wasUnverified = recipe.verification === "unverified";
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
    await maybeRecheckUnverified(store, householdId, recipeId, wasUnverified);
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
        amount?: number | null;
        unit?: string;
    },
): Promise<RecipeIngredient> {
    const recipe = await requireRecipe(
        store,
        input.householdId,
        input.recipeId,
    );
    const wasUnverified = recipe.verification === "unverified";
    const existing = await store.listIngredients(input.householdId, recipe.id);
    try {
        const food = await findFoodById(foods, input.householdId, input.foodId);
        if (food.kind !== "food") {
            throw new RecipeInputError("That catalog item is a supply.");
        }
        const quantity = quantityForNewIngredient(
            input.amount,
            input.unit,
            food,
        );
        const saved = await store.insertIngredient({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity,
            foodId: food.id,
            sortOrder: existing.length,
            note: noteForUnmeasuredIngredient(quantity, null),
        });
        await maybeRecheckUnverified(
            store,
            input.householdId,
            recipe.id,
            wasUnverified,
        );
        return saved;
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
        amount?: number | null;
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
    const wasUnverified = recipe.verification === "unverified";
    const existing = await store.listIngredients(input.householdId, recipe.id);
    try {
        const food = await findOrCreateFoodByBarcode(
            foods,
            input.householdId,
            input.barcode,
            opts.lookup,
        );
        const quantity = quantityForNewIngredient(
            input.amount,
            input.unit,
            food,
        );
        const saved = await store.insertIngredient({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity,
            foodId: food.id,
            sortOrder: existing.length,
            note: noteForUnmeasuredIngredient(quantity, null),
        });
        await maybeRecheckUnverified(
            store,
            input.householdId,
            recipe.id,
            wasUnverified,
        );
        return saved;
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
        amount?: number | null;
        unit?: string;
    },
): Promise<RecipeIngredient> {
    const recipe = await requireRecipe(
        store,
        input.householdId,
        input.recipeId,
    );
    const wasUnverified = recipe.verification === "unverified";
    const existing = await store.listIngredients(input.householdId, recipe.id);
    try {
        const food = await findOrCreateManualFood(
            foods,
            input.householdId,
            "food",
            input.name,
        );
        const quantity = quantityForNewIngredient(
            input.amount,
            input.unit,
            food,
        );
        const saved = await store.insertIngredient({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity,
            foodId: food.id,
            sortOrder: existing.length,
            note: noteForUnmeasuredIngredient(quantity, null),
        });
        await maybeRecheckUnverified(
            store,
            input.householdId,
            recipe.id,
            wasUnverified,
        );
        return saved;
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
            perPortionAmount:
                ingredient.quantity == null
                    ? null
                    : perPortionAmount(
                          ingredient.quantity.amount,
                          recipe.yieldPortions,
                      ),
            personAmount:
                ingredient.quantity == null
                    ? null
                    : amountForPortion(
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
    foods?: FoodsStore;
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
    await assertRecipeVerified(opts.recipes, opts.householdId, opts.recipeId);
    const ingredients = await opts.recipes.listIngredients(
        opts.householdId,
        opts.recipeId,
    );
    if (ingredients.length === 0) {
        throw new RecipeInputError("Add an ingredient first.");
    }
    const plan = recipeToGroceryRemainder({
        ingredients: ingredients.map((ingredient) => ({
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
    const foodsById = opts.foodsById ?? new Map<string, Food>();
    let familyById: Map<string, string>;
    if (opts.foods) {
        const listed = await opts.foods.listFoods(opts.householdId);
        familyById = new Map(listed.map((row) => [row.id, familyOf(row)]));
    } else {
        familyById = new Map(
            [...foodsById.values()].map((row) => [row.id, familyOf(row)]),
        );
    }
    function familyKey(foodId: string): string {
        return familyById.get(foodId) ?? foodId;
    }
    function listHasFoodFamily(foodId: string | null): boolean {
        if (!foodId) return false;
        const family = familyKey(foodId);
        return existingLines.some((row) => {
            if (!row.foodId) return false;
            return familyKey(row.foodId) === family;
        });
    }

    const added: GroceryLine[] = [];
    const skipped: RecipeGroceryRemainderLine[] = [];
    for (const line of plan) {
        if (line.unmeasured) {
            if (line.skipped || listHasFoodFamily(line.foodId ?? null)) {
                skipped.push(line);
                continue;
            }
            const lineFamily = line.foodId
                ? familyIdOf(line.foodId, foodsById)
                : null;
            const ingredient = ingredients.find(
                (row) =>
                    (lineFamily &&
                        row.foodId &&
                        familyIdOf(row.foodId, foodsById) === lineFamily) ||
                    row.displayName === line.displayName,
            );
            const kind = ingredient?.kind ?? "food";
            const foodId = line.foodId ?? ingredient?.foodId ?? null;
            if (!foodId) {
                skipped.push(line);
                continue;
            }
            const food = foodsById.get(foodId);
            const placeholderUnit = food?.defaultUnit || "g";
            const section = suggestGrocerySection({
                sections: storeSections,
                allSections,
                lines: existingLines,
                kind,
                foodId,
                displayName: line.displayName,
                familyById,
            });
            const inserted = await opts.grocery.insertLine({
                id: crypto.randomUUID(),
                householdId: opts.householdId,
                storeId: opts.storeId,
                sectionId: section?.id ?? otherSectionId,
                kind,
                displayName: line.displayName,
                quantity: { amount: 1, unit: placeholderUnit },
                foodId,
                checked: false,
                note: "to taste",
                source: "recipe",
                sourceFridgeItemId: null,
            });
            existingLines.push(inserted);
            added.push(inserted);
            continue;
        }
        if (line.skipped || line.remainder == null) {
            skipped.push(line);
            continue;
        }
        const lineFamily = line.foodId
            ? familyIdOf(line.foodId, foodsById)
            : null;
        const ingredient = ingredients.find(
            (row) =>
                (lineFamily &&
                    row.foodId &&
                    familyIdOf(row.foodId, foodsById) === lineFamily) ||
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
            familyById,
        });
        const inserted = await opts.grocery.insertLine({
            id: crypto.randomUUID(),
            householdId: opts.householdId,
            storeId: opts.storeId,
            sectionId: section?.id ?? otherSectionId,
            kind,
            displayName: line.displayName,
            quantity: line.remainder,
            foodId,
            checked: false,
            source: "recipe",
            sourceFridgeItemId: null,
            note: null,
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
    for (const gap of recipeIngredientGaps(ingredient, food)) {
        switch (gap.reason) {
            case "no_food":
            case "no_nutrition":
            case "partial_nutrition":
                if (!missing.includes("nutrition")) missing.push("nutrition");
                break;
            case "missing_grams_per_each":
                if (!missing.includes("grams_per_each")) {
                    missing.push("grams_per_each");
                }
                break;
            case "missing_grams_per_ml":
                if (!missing.includes("grams_per_ml")) {
                    missing.push("grams_per_ml");
                }
                break;
            case "no_amount":
                if (!missing.includes("amount")) missing.push("amount");
                break;
            default:
                break;
        }
    }
    return missing;
}

export function recipeCanMakeNow(
    recipe: Recipe,
    ingredients: RecipeIngredient[],
    fridgeStock: LinkedNeed[],
    foodsById: ReadonlyMap<string, Food> = new Map(),
): boolean {
    if (recipe.verification === "unverified") return false;
    if (ingredients.length === 0) return false;
    return ingredients.every((ingredient) => {
        const tag = alreadyHaveTag(
            {
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
    if (filter.verification && recipe.verification !== filter.verification) {
        return false;
    }
    if (
        filter.canMakeNow &&
        !recipeCanMakeNow(recipe, ingredients, fridgeStock, foodsById)
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

type ImportLineResolved = {
    index: number;
    line: RecipeImportIngredient;
    food: Food;
    quantity: RecipeIngredient["quantity"];
    note: string | null;
};

function validateImportLine(line: RecipeImportIngredient): {
    quantity: RecipeIngredient["quantity"];
    note: string | null;
} {
    const name = line.name?.trim() ?? "";
    if (!name) {
        throw new RecipeInputError("Each ingredient needs a name.");
    }
    const quantity =
        line.amount == null
            ? null
            : {
                  amount: parseAmount(line.amount),
                  unit: parseUnit(line.unit),
              };
    // No default note here: an import only counts as "not measured" when the
    // caller says so (note "to taste"), otherwise the check asks for an amount.
    const note = parseOptionalText(line.note, "Ingredient note", 500);
    return { quantity, note };
}

export async function importRecipeFromText(
    store: RecipesStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        creatorId: string;
        text: string;
        instructions?: string | null;
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
        transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
    },
): Promise<{
    recipe: Recipe;
    ingredients: RecipeIngredient[];
    gaps: IngredientGap[];
    verification: RecipeVerification;
    problems: RecipeProblem[];
}> {
    const rawText = parseOptionalText(input.text, "Recipe text", 20_000);
    if (!rawText) throw new RecipeInputError("Enter recipe text.");
    const extractedName = input.name?.trim() ?? "";
    const nameFromText =
        rawText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? "";
    const name = extractedName || nameFromText;
    if (!name) throw new RecipeInputError("Enter a recipe name.");

    const lines = input.ingredients ?? [];
    const validated = lines.map((line) => validateImportLine(line));

    const barcodeHits = new Map<string, FoodResult>();
    for (const line of lines) {
        if (!line.barcode) continue;
        const normalized = normalizeBarcode(line.barcode);
        if (normalized && !barcodeHits.has(normalized)) {
            const hit = await opts.lookup(normalized);
            if (hit == null) {
                throw new RecipeInputError("Unknown barcode.");
            }
            barcodeHits.set(normalized, hit);
        }
    }

    const runTx = opts.transaction ?? ((fn) => fn());
    return runTx(async () => {
        const barcodeResolved: ImportLineResolved[] = [];
        for (const [index, line] of lines.entries()) {
            const { quantity, note } = validated[index]!;
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
                    const normalized = normalizeBarcode(line.barcode);
                    if (!normalized) {
                        throw new RecipeInputError("Enter a valid barcode.");
                    }
                    const hit = barcodeHits.get(normalized);
                    if (!hit) {
                        throw new RecipeInputError("Unknown barcode.");
                    }
                    food = (
                        await findOrCreateFoodByBarcodeFromHit(
                            foods,
                            input.householdId,
                            normalized,
                            hit,
                        )
                    ).food;
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
            const storedQuantity =
                quantity == null
                    ? null
                    : {
                          amount: quantity.amount,
                          unit: storedFoodUnit(line.unit, food),
                      };
            barcodeResolved.push({
                index,
                line,
                food,
                quantity: storedQuantity,
                note,
            });
        }
        const instructionBody =
            input.instructions !== undefined
                ? parseOptionalText(input.instructions, "Instructions", 20_000)
                : null;
        const recipe = await createRecipe(store, {
            householdId: input.householdId,
            creatorId: input.creatorId,
            name,
            yieldPortions: input.yieldPortions ?? 1,
            instructions: instructionBody,
            sourceUrl: input.sourceUrl,
            tags: input.tags,
            notes: input.notes,
            prepMinutes: input.prepMinutes,
            cookMinutes: input.cookMinutes,
            verification: "unverified",
        });
        const importedAt = nowIso();
        await store.upsertImport({
            recipeId: recipe.id,
            householdId: input.householdId,
            sourceKind: "text",
            sourceUrl: parseOptionalText(input.sourceUrl, "Source URL", 2_000),
            sourceText: rawText,
            sourceTextOrigin: "pasted",
            transcript: null,
            credit: null,
            unresolvedLines: [],
            problems: [],
            importedAt,
        });
        const imported: RecipeIngredient[] = [];
        for (const row of barcodeResolved) {
            imported.push(
                await store.insertIngredient({
                    id: crypto.randomUUID(),
                    householdId: input.householdId,
                    recipeId: recipe.id,
                    kind: "food",
                    displayName: row.food.name,
                    quantity: row.quantity,
                    foodId: row.food.id,
                    sortOrder: row.index,
                    note: row.note,
                }),
            );
        }
        const catalog = await effectiveFoodsByIds(
            foods,
            input.householdId,
            imported.map((ingredient) => ingredient.foodId),
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
        const checked = await recheckRecipe(
            store,
            input.householdId,
            recipe.id,
        );
        const saved =
            (await store.getRecipe(input.householdId, recipe.id)) ?? recipe;
        return {
            recipe: saved,
            ingredients: imported,
            gaps,
            verification: checked.verification,
            problems: checked.problems,
        };
    });
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
    verification?: unknown;
    updated_at?: unknown;
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
        verification:
            row.verification === "unverified" ? "unverified" : "verified",
        updatedAt:
            row.updated_at == null || row.updated_at === ""
                ? new Date().toISOString()
                : String(row.updated_at),
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
        verification: row.verification,
        updated_at: row.updatedAt,
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
        quantity:
            row.amount == null || row.unit == null || row.unit === ""
                ? null
                : {
                      amount: Number(row.amount),
                      unit: String(row.unit),
                  },
        foodId:
            row.food_id == null || row.food_id === ""
                ? null
                : String(row.food_id),
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
        amount: row.quantity?.amount ?? null,
        unit: row.quantity?.unit ?? null,
        food_id: row.foodId,
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
