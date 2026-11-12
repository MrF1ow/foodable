import { describe, expect, test } from "bun:test";
import type { Food } from "./foods.js";
import type { Recipe, RecipeIngredient } from "./recipes.js";
import {
    parseShareDocument,
    recipeShareDocument,
    SHARE_DOCUMENT_LIMITS,
    SHARE_DOCUMENT_MAX_BYTES,
    ShareDocumentError,
    validateShareDocument,
    type ShareDocument,
} from "./sharing-document.js";

const HH = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const FOOD_ID = "44444444-4444-4444-8444-444444444444";
const RECIPE_ID = "55555555-5555-4555-8555-555555555555";

function recipe(over: Partial<Recipe> = {}): Recipe {
    return {
        id: RECIPE_ID,
        householdId: HH,
        creatorId: USER,
        name: "Lentil soup",
        yieldPortions: 4,
        instructions: "1. Rinse.\n2. Simmer.",
        sourceUrl: "https://secret-source.leak-check.test/recipe",
        tags: ["dinner", "soup"],
        notes: "NOTES-7731-do-not-share",
        prepMinutes: 10,
        cookMinutes: 30,
        verification: "verified",
        updatedAt: "2026-11-12T12:00:00.000Z",
        ...over,
    } as Recipe;
}

function ingredient(over: Partial<RecipeIngredient> = {}): RecipeIngredient {
    return {
        id: "66666666-6666-4666-8666-666666666666",
        householdId: HH,
        recipeId: RECIPE_ID,
        kind: "food",
        displayName: "Red lentils",
        quantity: { amount: 300, unit: "g" },
        foodId: FOOD_ID,
        sortOrder: 0,
        note: "LINENOTE-4419-do-not-share",
        ...over,
    };
}

function food(over: Partial<Food> = {}): Food {
    return {
        id: FOOD_ID,
        householdId: HH,
        kind: "food",
        name: "Red lentils",
        normalizedName: "red lentils",
        brand: "BRAND-9921-do-not-share",
        defaultUnit: "g",
        gramsPerEach: null,
        gramsPerMl: 0.85,
        calories: 352,
        proteinG: 24.6,
        carbsG: 63,
        fatG: null,
        fiberG: 10.7,
        sugarG: 2,
        saturatedFatG: 0.4,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: "manual",
        offNutrientLevels: null,
        allergens: [],
        offSourceId: "OFF-BARCODE-3017620422003",
        genericFoodId: null,
        usualProductId: null,
        usualStoreId: null,
        usualAmount: null,
        restockSchedule: null,
        restockEveryWeeks: null,
        restockPaused: false,
        restockWhenLow: false,
        restockLowLevel: null,
        lastRestockedOn: null,
        offQuality: null,
        createdBy: USER,
        archivedAt: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
        ...over,
    } as Food;
}

const foodsById = (...foods: Food[]) => new Map(foods.map((f) => [f.id, f]));

function build(
    r: Recipe,
    ingredients: RecipeIngredient[],
    foods: Map<string, Food>,
) {
    return recipeShareDocument({ ...r, ingredients }, foods);
}

describe("recipeShareDocument", () => {
    test("builds the versioned document with per-100 g nutrition and unit factors", () => {
        const doc = build(recipe(), [ingredient()], foodsById(food()));
        expect(doc).toEqual({
            version: 1,
            name: "Lentil soup",
            portions: 4,
            instructions: "1. Rinse.\n2. Simmer.",
            tags: ["dinner", "soup"],
            ingredients: [
                {
                    food_name: "Red lentils",
                    amount: 300,
                    unit: "g",
                    food: {
                        calories: 352,
                        protein_g: 24.6,
                        carbs_g: 63,
                        fat_g: null,
                        fiber_g: 10.7,
                        sugar_g: 2,
                        saturated_fat_g: 0.4,
                        alcohol_g: null,
                        caffeine_mg: null,
                        grams_per_ml: 0.85,
                        grams_per_each: null,
                    },
                },
            ],
        });
    });

    test("round trip: build, stringify, parse gives the same document", () => {
        const doc = build(
            recipe(),
            [
                ingredient({ sortOrder: 1 }),
                ingredient({
                    id: "77777777-7777-4777-8777-777777777777",
                    displayName: "Salt",
                    quantity: null,
                    foodId: null,
                    sortOrder: 0,
                }),
            ],
            foodsById(food()),
        );
        expect(doc).not.toBeNull();
        expect(parseShareDocument(JSON.stringify(doc))).toEqual(doc!);
    });

    test("carries no id, member data, note, source URL, brand or barcode", () => {
        const doc = build(recipe(), [ingredient()], foodsById(food()));
        const json = JSON.stringify(doc);
        for (const secret of [
            HH,
            USER,
            FOOD_ID,
            RECIPE_ID,
            ingredient().id,
            "NOTES-7731",
            "LINENOTE-4419",
            "secret-source",
            "BRAND-9921",
            "OFF-BARCODE",
        ]) {
            expect(json).not.toContain(secret);
        }
    });

    test("unknown nutrition stays null, never zero", () => {
        const doc = build(
            recipe(),
            [ingredient()],
            foodsById(
                food({
                    calories: null,
                    proteinG: null,
                    carbsG: null,
                    fiberG: null,
                    sugarG: null,
                    saturatedFatG: null,
                    gramsPerMl: null,
                }),
            ),
        );
        expect(Object.values(doc!.ingredients[0]!.food)).toEqual(
            Array(11).fill(null),
        );
    });

    test("an ingredient without a food, or with an unknown food id, ships all-null nutrition under its own name", () => {
        const doc = build(
            recipe(),
            [
                ingredient({ foodId: null, displayName: "Salt" }),
                ingredient({
                    foodId: crypto.randomUUID(),
                    displayName: "Pepper",
                    sortOrder: 1,
                }),
            ],
            foodsById(),
        );
        expect(doc!.ingredients.map((i) => i.food_name)).toEqual([
            "Salt",
            "Pepper",
        ]);
        for (const i of doc!.ingredients) {
            expect(Object.values(i.food).every((v) => v === null)).toBe(true);
        }
    });

    test("the food's own name is the shared name; ingredients follow sort order; to-taste has null amount and unit", () => {
        const doc = build(
            recipe(),
            [
                ingredient({
                    displayName: "lentils (rinsed)",
                    sortOrder: 2,
                }),
                ingredient({
                    id: "77777777-7777-4777-8777-777777777777",
                    foodId: null,
                    displayName: "Salt",
                    quantity: null,
                    sortOrder: 1,
                }),
            ],
            foodsById(food()),
        );
        expect(doc!.ingredients.map((i) => i.food_name)).toEqual([
            "Salt",
            "Red lentils",
        ]);
        expect(doc!.ingredients[0]).toMatchObject({
            amount: null,
            unit: null,
        });
    });

    test("a null instructions field stays null", () => {
        const doc = build(recipe({ instructions: null }), [], foodsById());
        expect(doc!.instructions).toBeNull();
        expect(doc!.ingredients).toEqual([]);
    });

    test("a recipe outside the bounds has no document", () => {
        expect(build(recipe({ name: "x".repeat(201) }), [], foodsById())).toBe(
            null,
        );
        expect(
            build(
                recipe({ instructions: "x".repeat(20_001) }),
                [],
                foodsById(),
            ),
        ).toBe(null);
        const many = Array.from({ length: 201 }, (_, i) =>
            ingredient({ id: crypto.randomUUID(), sortOrder: i }),
        );
        expect(build(recipe(), many, foodsById(food()))).toBeNull();
        expect(
            build(
                recipe(),
                [ingredient({ displayName: "y".repeat(201), foodId: null })],
                foodsById(),
            ),
        ).toBeNull();
    });

    test("a maximal in-bounds document of widest realistic characters stays under the size cap", () => {
        const L = SHARE_DOCUMENT_LIMITS;
        // 4-byte characters in every free-text field, the widest in UTF-8.
        const wide = (n: number) => "😀".repeat(Math.floor(n / 2));
        const big = food({
            name: wide(L.foodName),
            calories: 999999.123456789,
            proteinG: 999999.123456789,
            carbsG: 999999.123456789,
            fatG: 999999.123456789,
            fiberG: 999999.123456789,
            sugarG: 999999.123456789,
            saturatedFatG: 999999.123456789,
            alcoholG: 999999.123456789,
            caffeineMg: 999999.123456789,
            gramsPerMl: 999999.123456789,
            gramsPerEach: 999999.123456789,
        });
        const ingredients = Array.from({ length: L.ingredients }, (_, i) =>
            ingredient({
                id: crypto.randomUUID(),
                quantity: {
                    amount: 1234567.123456789,
                    unit: "u".repeat(L.unit),
                },
                sortOrder: i,
            }),
        );
        const doc = build(
            recipe({
                name: wide(L.name),
                // control characters escape to six bytes each in JSON
                instructions: "\u0001".repeat(L.instructions),
                tags: Array.from({ length: L.tags }, (_, i) =>
                    `${i}`.padEnd(L.tagLength, "é"),
                ),
            }),
            ingredients,
            foodsById(big),
        );
        expect(doc).not.toBeNull();
        const text = JSON.stringify(doc);
        expect(new TextEncoder().encode(text).length).toBeLessThan(
            SHARE_DOCUMENT_MAX_BYTES,
        );
        expect(parseShareDocument(text)).toEqual(doc!);
    });

    test("every field filled to its bound with control characters is over the cap: no document, and the parser refuses the text by size", () => {
        const L = SHARE_DOCUMENT_LIMITS;
        // "\u0001" is six bytes escaped in JSON: schema-valid, but too big.
        const ctl = (n: number) => "\u0001".repeat(n);
        const big = food({
            name: ctl(L.foodName),
            calories: 999999.123456789,
            proteinG: 999999.123456789,
            carbsG: 999999.123456789,
            fatG: 999999.123456789,
            fiberG: 999999.123456789,
            sugarG: 999999.123456789,
            saturatedFatG: 999999.123456789,
            alcoholG: 999999.123456789,
            caffeineMg: 999999.123456789,
            gramsPerMl: 999999.123456789,
            gramsPerEach: 999999.123456789,
        });
        const ingredients = Array.from({ length: L.ingredients }, (_, i) =>
            ingredient({
                id: crypto.randomUUID(),
                quantity: {
                    amount: 1234567.123456789,
                    unit: ctl(L.unit),
                },
                sortOrder: i,
            }),
        );
        const source = recipe({
            name: ctl(L.name),
            instructions: ctl(L.instructions),
            tags: Array.from({ length: L.tags }, () => ctl(L.tagLength)),
        });
        expect(build(source, ingredients, foodsById(big))).toBeNull();

        // The same fields, built by hand: schema-valid yet over the byte cap.
        const nutrition = Object.fromEntries(
            [
                "calories",
                "protein_g",
                "carbs_g",
                "fat_g",
                "fiber_g",
                "sugar_g",
                "saturated_fat_g",
                "alcohol_g",
                "caffeine_mg",
                "grams_per_ml",
                "grams_per_each",
            ].map((k) => [k, 999999.123456789]),
        );
        const text = JSON.stringify({
            version: 1,
            name: ctl(L.name),
            portions: 9999999.123456789,
            instructions: ctl(L.instructions),
            tags: Array.from({ length: L.tags }, () => ctl(L.tagLength)),
            ingredients: Array.from({ length: L.ingredients }, () => ({
                food_name: ctl(L.foodName),
                amount: 1234567.123456789,
                unit: ctl(L.unit),
                food: nutrition,
            })),
        });
        expect(new TextEncoder().encode(text).length).toBeGreaterThan(
            SHARE_DOCUMENT_MAX_BYTES,
        );
        expect(() => parseShareDocument(text)).toThrow(/too large/i);
    });

    test("a recipe whose serialised form would pass the cap has no document", () => {
        // Within each field bound, but 200 widest ingredients plus the widest
        // instructions would not fit if the bounds alone were trusted; the
        // size check is the backstop, so lower the cap to prove it applies.
        const doc = recipeShareDocument(
            { ...recipe(), ingredients: [ingredient()] },
            foodsById(food()),
            { maxBytes: 100 },
        );
        expect(doc).toBeNull();
    });
});

describe("parseShareDocument", () => {
    const valid = (): ShareDocument =>
        build(recipe(), [ingredient()], foodsById(food()))!;
    const withDoc = (patch: (d: any) => void) => {
        const d = structuredClone(valid()) as any;
        patch(d);
        return JSON.stringify(d);
    };

    test("accepts what the builder makes", () => {
        expect(parseShareDocument(JSON.stringify(valid()))).toEqual(valid());
        expect(validateShareDocument(valid())).toEqual(valid());
    });

    test("an unknown version is a clear error naming the version", () => {
        const err = (() => {
            try {
                parseShareDocument(withDoc((d) => (d.version = 2)));
            } catch (e) {
                return e;
            }
        })();
        expect(err).toBeInstanceOf(ShareDocumentError);
        expect((err as Error).message).toMatch(/version 2/i);
        expect((err as Error).message).toMatch(/version 1/i);
        expect(() =>
            parseShareDocument(withDoc((d) => delete d.version)),
        ).toThrow(/version/i);
    });

    test("not JSON, not an object, and oversize text are refused", () => {
        expect(() => parseShareDocument("{nope")).toThrow(ShareDocumentError);
        expect(() => parseShareDocument("[]")).toThrow(ShareDocumentError);
        expect(() => parseShareDocument("null")).toThrow(ShareDocumentError);
        expect(() =>
            parseShareDocument(" ".repeat(SHARE_DOCUMENT_MAX_BYTES + 1)),
        ).toThrow(/too large/i);
    });

    test.each([
        ["name too long", (d: any) => (d.name = "x".repeat(201)), /name/i],
        ["name empty", (d: any) => (d.name = ""), /name/i],
        ["name wrong type", (d: any) => (d.name = 7), /name/i],
        ["portions zero", (d: any) => (d.portions = 0), /portions/i],
        ["portions string", (d: any) => (d.portions = "4"), /portions/i],
        [
            "instructions too long",
            (d: any) => (d.instructions = "x".repeat(20_001)),
            /instructions/i,
        ],
        ["too many tags", (d: any) => (d.tags = Array(21).fill("a")), /tags/i],
        ["tag too long", (d: any) => (d.tags = ["x".repeat(41)]), /tags/i],
        [
            "too many ingredients",
            (d: any) =>
                (d.ingredients = Array(201).fill(
                    structuredClone(d.ingredients[0]),
                )),
            /ingredients/i,
        ],
        [
            "food_name too long",
            (d: any) => (d.ingredients[0].food_name = "x".repeat(201)),
            /food_name/i,
        ],
        [
            "negative amount",
            (d: any) => (d.ingredients[0].amount = -1),
            /amount/i,
        ],
        [
            "amount without a unit",
            (d: any) => (d.ingredients[0].unit = null),
            /unit/i,
        ],
        [
            "unit without an amount",
            (d: any) => (d.ingredients[0].amount = null),
            /amount/i,
        ],
        [
            "nutrition as string",
            (d: any) => (d.ingredients[0].food.calories = "352"),
            /calories/i,
        ],
        [
            "negative nutrition",
            (d: any) => (d.ingredients[0].food.protein_g = -2),
            /protein_g/i,
        ],
        [
            "missing food block",
            (d: any) => delete d.ingredients[0].food,
            /food/i,
        ],
    ])("refuses %s with a message naming the field", (_label, patch, re) => {
        expect(() => parseShareDocument(withDoc(patch))).toThrow(re);
    });

    test("keys this deploy does not know are dropped, never read, never refused", () => {
        const text = withDoc((d) => {
            d.household_id = "TOP-LEVEL-EXTRA";
            d.ingredients[0].food_id = "INGREDIENT-EXTRA";
            d.ingredients[0].food.sodium_mg = 123;
        });
        const parsed = parseShareDocument(text);
        expect(parsed).toEqual(valid());
        expect(JSON.stringify(parsed)).not.toContain("EXTRA");
        expect(parsed).not.toHaveProperty("household_id");
        expect(parsed.ingredients[0]).not.toHaveProperty("food_id");
        expect(parsed.ingredients[0]!.food).not.toHaveProperty("sodium_mg");
        expect(validateShareDocument(JSON.parse(text))).toEqual(valid());
    });

    test("a version that is not the number 1 is named as received", () => {
        try {
            parseShareDocument(withDoc((d) => (d.version = "1")));
            throw new Error("expected a throw");
        } catch (e) {
            expect(e).toBeInstanceOf(ShareDocumentError);
            expect((e as Error).message).toContain('version "1"');
            expect((e as Error).message).not.toMatch(
                /version 1; this deploy reads version 1/,
            );
        }
    });

    test("errors are ShareDocumentError and name where the problem is", () => {
        try {
            parseShareDocument(
                withDoc((d) => (d.ingredients[0].food.calories = "x")),
            );
            throw new Error("expected a throw");
        } catch (e) {
            expect(e).toBeInstanceOf(ShareDocumentError);
            expect((e as Error).message).toContain(
                "ingredients.0.food.calories",
            );
        }
    });
});
