import { z } from "zod";
import type { Food } from "./foods.js";
import type { Recipe, RecipeIngredient } from "./recipes.js";

/**
 * The portable recipe document: a shared recipe as versioned JSON that
 * another Foodable deploy can read (`GET /s/:token.json`). Pure: no database
 * import. It carries what a stranger needs to rebuild the recipe (its text,
 * the amounts, and each food's per-100 nutrition, per 100 g unless it says
 * per 100 ml, and unit factors) and
 * nothing of the household: no ids, no members, no notes, no source URL, no
 * brand or barcode.
 *
 * One schema (`shareDocumentSchema`) is both the builder's last gate and the
 * parser's check, so a document this deploy produces always parses. Keys the
 * schema does not know are dropped, never read and never refused: a field
 * added later within version 1 must not make older deploys reject the whole
 * document. Only a breaking change bumps the version.
 */

export const SHARE_DOCUMENT_VERSION = 1;

/** The importer refuses anything larger, so the builder never produces it. */
export const SHARE_DOCUMENT_MAX_BYTES = 256 * 1024;

/**
 * Bounds on every field. Lengths count UTF-16 code units (what Zod counts),
 * so the bounds alone do not keep a document under the byte cap (a CJK
 * character is three bytes per unit). The builder's byte check is what keeps
 * documents under the cap, and the parser enforces it on the text.
 */
export const SHARE_DOCUMENT_LIMITS = {
    name: 200,
    instructions: 20_000,
    tags: 20,
    tagLength: 40,
    ingredients: 200,
    foodName: 100,
    unit: 16,
    /** Largest portions count or ingredient amount. */
    quantity: 10_000_000,
    /** Largest nutrition value or unit factor (per 100 g). */
    nutrition: 1_000_000,
} as const;

const L = SHARE_DOCUMENT_LIMITS;

export class ShareDocumentError extends Error {
    readonly code = "share_document" as const;

    constructor(message: string) {
        super(message);
        this.name = "ShareDocumentError";
    }
}

// Every control character in C0 except tab, newline and carriage return. The
// NUL is what Postgres text cannot hold (a document carrying one would pass
// the parser and fail while being written); the rest never belongs in recipe
// text. One rule for every string, so the builder and the parser agree: a
// field that allows a newline in one place allows it in all.
const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const CONTROL_CHARACTERS = new RegExp(CONTROL_CHARACTER.source, "g");

/** Marks a string schema as text: no control characters beyond \t \n \r. */
function text<T extends z.ZodString>(schema: T) {
    return schema.refine((value) => !CONTROL_CHARACTER.test(value), {
        message: "must not contain control characters",
    });
}

const nutrient = z.number().min(0).max(L.nutrition).nullable();
// The foods table checks a unit factor > 0 (a nutrient only >= 0): a zero
// factor would parse here and then be refused by the database on import.
const unitFactor = z.number().positive().max(L.nutrition).nullable();

const foodSchema = z.object({
    calories: nutrient,
    protein_g: nutrient,
    carbs_g: nutrient,
    fat_g: nutrient,
    fiber_g: nutrient,
    sugar_g: nutrient,
    saturated_fat_g: nutrient,
    alcohol_g: nutrient,
    caffeine_mg: nutrient,
    grams_per_ml: unitFactor,
    grams_per_each: unitFactor,
    // What the nutrition above is per. Absent reads as per 100 g, which is what
    // every document before this key meant; only "100ml" is ever written.
    nutrition_basis: z.enum(["100g", "100ml"]).optional(),
});

const ingredientSchema = z
    .object({
        food_name: text(z.string().trim().min(1).max(L.foodName)),
        amount: z.number().positive().max(L.quantity).nullable(),
        unit: text(z.string().trim().min(1).max(L.unit)).nullable(),
        food: foodSchema,
    })
    .superRefine((value, ctx) => {
        if (value.amount !== null && value.unit === null) {
            ctx.addIssue({
                code: "custom",
                path: ["unit"],
                message: "unit is required when amount is given",
            });
        }
        if (value.unit !== null && value.amount === null) {
            ctx.addIssue({
                code: "custom",
                path: ["amount"],
                message: "amount is required when unit is given",
            });
        }
    });

export const shareDocumentSchema = z.object({
    version: z.literal(SHARE_DOCUMENT_VERSION),
    name: text(z.string().trim().min(1).max(L.name)),
    portions: z.number().positive().max(L.quantity),
    instructions: text(z.string().max(L.instructions)).nullable(),
    tags: z.array(text(z.string().min(1).max(L.tagLength))).max(L.tags),
    ingredients: z.array(ingredientSchema).max(L.ingredients),
});

export type ShareDocument = z.infer<typeof shareDocumentSchema>;
export type ShareDocumentIngredient = ShareDocument["ingredients"][number];
export type ShareDocumentFood = ShareDocumentIngredient["food"];

function describeIssue(issue: z.core.$ZodIssue): string {
    const where = issue.path.join(".");
    return where ? `${where}: ${issue.message}` : issue.message;
}

/**
 * Checks an already-parsed value. Throws `ShareDocumentError` with a message
 * naming the field (an unknown version names the versions this deploy reads).
 */
export function validateShareDocument(value: unknown): ShareDocument {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ShareDocumentError("The shared recipe is not a JSON object.");
    }
    const version = (value as { version?: unknown }).version;
    if (version !== SHARE_DOCUMENT_VERSION) {
        throw new ShareDocumentError(
            version === undefined
                ? `The shared recipe has no version; this deploy reads version ${SHARE_DOCUMENT_VERSION}.`
                : `The shared recipe is version ${JSON.stringify(version)}; this deploy reads version ${SHARE_DOCUMENT_VERSION}.`,
        );
    }
    const result = shareDocumentSchema.safeParse(value);
    if (!result.success) {
        throw new ShareDocumentError(
            `The shared recipe is not valid. ${describeIssue(result.error.issues[0]!)}`,
        );
    }
    return result.data;
}

/** Parses document text. Throws `ShareDocumentError` for anything it refuses. */
export function parseShareDocument(text: string): ShareDocument {
    if (new TextEncoder().encode(text).length > SHARE_DOCUMENT_MAX_BYTES) {
        throw new ShareDocumentError(
            `The shared recipe is too large (the limit is ${SHARE_DOCUMENT_MAX_BYTES / 1024} KB).`,
        );
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new ShareDocumentError("The shared recipe is not valid JSON.");
    }
    return validateShareDocument(value);
}

/** What the builder reads: a recipe and its ingredients (a `RecipeView` fits). */
export type ShareableRecipeDocumentSource = Pick<
    Recipe,
    "name" | "yieldPortions" | "instructions" | "tags"
> & {
    ingredients: readonly Pick<
        RecipeIngredient,
        "displayName" | "quantity" | "foodId" | "sortOrder"
    >[];
};

type DocumentFoodSource = Pick<
    Food,
    | "name"
    | "calories"
    | "proteinG"
    | "carbsG"
    | "fatG"
    | "fiberG"
    | "sugarG"
    | "saturatedFatG"
    | "alcoholG"
    | "caffeineMg"
    | "gramsPerMl"
    | "gramsPerEach"
    | "nutritionBasis"
>;

const NO_FOOD: ShareDocumentFood = {
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    saturated_fat_g: null,
    alcohol_g: null,
    caffeine_mg: null,
    grams_per_ml: null,
    grams_per_each: null,
};

// Field by field on purpose: a column added to `Food` never reaches a document
// by accident. Null stays null; a missing value is never turned into zero.
function foodBlock(food: DocumentFoodSource): ShareDocumentFood {
    return {
        calories: food.calories,
        protein_g: food.proteinG,
        carbs_g: food.carbsG,
        fat_g: food.fatG,
        fiber_g: food.fiberG,
        sugar_g: food.sugarG,
        saturated_fat_g: food.saturatedFatG,
        alcohol_g: food.alcoholG,
        caffeine_mg: food.caffeineMg,
        grams_per_ml: food.gramsPerMl,
        grams_per_each: food.gramsPerEach,
        // Only a per-100 ml food says so: a document without the key is per
        // 100 g, so those stay byte-identical to what older deploys wrote.
        ...(food.nutritionBasis === "100ml"
            ? { nutrition_basis: "100ml" as const }
            : {}),
    };
}

// Recipe writes accept the stray control characters pasted Word and PDF text
// carries (vertical tab, form feed, bell). The parser refuses them, so the
// builder removes them from every string it emits before validating, and a
// recipe with one still has a document. Removed, not replaced: "Mix.\vBake."
// reads "Mix.Bake.". Tab, newline and carriage return are kept.
const plain = (value: string): string =>
    value.replaceAll(CONTROL_CHARACTERS, "");

/**
 * The document for a recipe, or null when the recipe is outside the document's
 * bounds (or would serialise past the byte cap): the route answers that like
 * any other refusal rather than send a truncated recipe.
 *
 * `foods` holds the foods the ingredients point at, loaded for the recipe's
 * own household (`FoodsStore.getFoodsByIds(householdId, ids)`). An ingredient
 * with no food, or whose food is not in the map, ships under its own name with
 * no nutrition. A known food is shared under its own name (the identity the
 * importer matches on), otherwise under the ingredient's.
 */
export function recipeShareDocument(
    recipe: ShareableRecipeDocumentSource,
    foods: ReadonlyMap<string, DocumentFoodSource>,
    opts: { maxBytes?: number } = {},
): ShareDocument | null {
    const ingredients = [...recipe.ingredients]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((ingredient): ShareDocumentIngredient => {
            const food =
                ingredient.foodId === null
                    ? undefined
                    : foods.get(ingredient.foodId);
            return {
                food_name: plain(food?.name ?? ingredient.displayName).trim(),
                amount: ingredient.quantity?.amount ?? null,
                unit:
                    ingredient.quantity === null ||
                    ingredient.quantity === undefined
                        ? null
                        : plain(ingredient.quantity.unit),
                food: food ? foodBlock(food) : NO_FOOD,
            };
        });
    const candidate = {
        version: SHARE_DOCUMENT_VERSION,
        name: plain(recipe.name).trim(),
        portions: recipe.yieldPortions,
        instructions:
            recipe.instructions === null ? null : plain(recipe.instructions),
        // A tag that was only control characters is no tag.
        tags: recipe.tags.map(plain).filter((tag) => tag !== ""),
        ingredients,
    };
    const result = shareDocumentSchema.safeParse(candidate);
    if (!result.success) return null;
    const bytes = new TextEncoder().encode(JSON.stringify(result.data)).length;
    if (bytes > (opts.maxBytes ?? SHARE_DOCUMENT_MAX_BYTES)) return null;
    return result.data;
}
