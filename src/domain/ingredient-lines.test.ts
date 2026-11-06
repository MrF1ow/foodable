import { describe, expect, test } from "bun:test";
import { verifyRecipe } from "./recipe-import.js";
import type { Recipe, RecipeIngredient } from "./recipes.js";
import { isNotMeasuredNote } from "./recipe-import.js";
import { mapUnit, parseIngredientLines } from "./ingredient-lines.js";

describe("mapUnit", () => {
    test("maps mass and volume units", () => {
        expect(mapUnit("g", "g")?.unit).toBe("g");
        expect(mapUnit("kilogram", "kg")?.unit).toBe("g");
        expect(mapUnit("tablespoon", "tbsp")?.unit).toBe("tbsp");
    });

    test("count-like units become each", () => {
        expect(mapUnit("clove", "cloves")).toEqual({
            unit: "each",
            countNote: "cloves",
        });
    });
});

describe("parseIngredientLines", () => {
    test("parses common ingredient shapes", () => {
        const { items } = parseIngredientLines([
            "1 ½ cups flour, sifted",
            "2 cloves garlic, minced",
            "500 g chicken",
            "1 kg potatoes",
            "1-2 tbsp oil",
            "salt to taste",
            "Salt, to taste",
            "Sesame seeds",
            "Chicken Coating:",
            "1 tbsp paprika",
            "",
        ]);
        expect(items[0]).toMatchObject({
            name: "flour",
            quantity: { amount: 1.5, unit: "cup" },
            note: "sifted",
        });
        expect(items[1]).toMatchObject({
            name: "garlic",
            quantity: { amount: 2, unit: "each" },
        });
        expect(items[2]?.quantity).toEqual({ amount: 500, unit: "g" });
        expect(items[3]?.quantity).toEqual({ amount: 1000, unit: "g" });
        expect(items[4]).toMatchObject({
            name: "oil",
            quantity: { amount: 1, unit: "tbsp" },
            note: "1–2 tbsp",
        });
        expect(items[5]).toMatchObject({
            quantity: null,
            note: "to taste",
        });
        expect(items[6]).toMatchObject({
            name: "Salt",
            quantity: null,
            note: "to taste",
        });
        expect(items[7]).toMatchObject({
            name: "Sesame seeds",
            quantity: null,
            note: null,
        });
        expect(items[8]?.section).toBe("Chicken Coating");
        expect(items[8]?.name).toBe("paprika");
    });

    test("run-together lines are unresolved", () => {
        const { unresolved } = parseIngredientLines([
            "1.5 lb Chicken Breast 50g Egg Whites",
        ]);
        expect(unresolved).toEqual(["1.5 lb Chicken Breast 50g Egg Whites"]);
    });

    test("counted ingredients without size-as-unit become each", () => {
        for (const [line, name] of [
            ["3 eggs", "eggs"],
            ["2 limes", "limes"],
            ["1 lemon", "lemon"],
            ["2 chicken breasts", "chicken breasts"],
            ["4 medium carrots", "medium carrots"],
        ] as const) {
            const { items, unresolved } = parseIngredientLines([line]);
            expect(unresolved).toEqual([]);
            expect(items[0]).toMatchObject({
                name,
                quantity: { unit: "each" },
                note: null,
            });
        }
        const beaten = parseIngredientLines([
            "2 large eggs (beaten until frothy)",
        ]).items[0]!;
        expect(beaten).toMatchObject({
            name: "large eggs",
            quantity: { amount: 2, unit: "each" },
            note: "beaten until frothy",
        });
        expect(
            parseIngredientLines(["1 chicken breast ((large), about 1 1/2 lb)"])
                .items[0],
        ).toMatchObject({
            name: "chicken breast",
            quantity: { amount: 1, unit: "each" },
            note: "large, about 1 1/2 lb",
        });
    });

    test("alternate measures in parentheses do not trigger run-together", () => {
        expect(
            parseIngredientLines(["4 oz mozzarella cheese ((1 cup shredded))"])
                .items[0],
        ).toMatchObject({
            name: "mozzarella cheese",
            quantity: { amount: 4, unit: "oz" },
            note: "1 cup shredded",
        });
        expect(
            parseIngredientLines(["6 oz cheddar ((2 cups shredded))"]).items[0],
        ).toMatchObject({
            quantity: { amount: 6, unit: "oz" },
            note: "2 cups shredded",
        });
        expect(
            parseIngredientLines(["2 tbsp oil (or 30 ml)"]).items[0],
        ).toMatchObject({
            quantity: { amount: 2, unit: "tbsp" },
            note: "or 30 ml",
        });
        expect(
            parseIngredientLines(["1 cup stock (about 250 ml)"]).items[0],
        ).toMatchObject({
            quantity: { amount: 1, unit: "cup" },
            note: "about 250 ml",
        });
    });

    test("notes unwrap parentheses and footnote marks", () => {
        const cases: Array<[string, string | null]> = [
            ["(or GF flour)", "or GF flour"],
            ["( to sauté)", "to sauté"],
            ["(*)", null],
        ];
        for (const [note, expected] of cases) {
            const line = `1 cup flour ${note}`;
            const item = parseIngredientLines([line]).items[0]!;
            expect(item.note).toBe(expected);
        }
        expect(
            parseIngredientLines(["1 (15 oz) can tomatoes"]).items[0],
        ).toMatchObject({
            name: "tomatoes",
            quantity: { amount: 1, unit: "each" },
            note: "15 oz, can",
        });
    });
});

describe("parseIngredientLines with verifyRecipe", () => {
    const baseRecipe: Recipe = {
        id: "r1",
        householdId: "h1",
        creatorId: "u1",
        name: "Test",
        instructions: "Step one",
        yieldPortions: 4,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "unverified",
        sourceUrl: null,
        updatedAt: "2026-01-01T00:00:00.000Z",
    };

    function ingredient(
        displayName: string,
        quantity: RecipeIngredient["quantity"],
        note: string | null,
    ): RecipeIngredient {
        return {
            id: displayName,
            householdId: "h1",
            recipeId: "r1",
            kind: "food",
            displayName,
            quantity,
            foodId: "food-1",
            sortOrder: 0,
            note,
        };
    }

    test("to taste verifies; bare name does not", () => {
        const { items: tasteItems } = parseIngredientLines(["Salt, to taste"]);
        const taste = tasteItems[0]!;
        const tasteIngredient = ingredient(
            taste.name,
            taste.quantity,
            taste.note,
        );
        expect(
            verifyRecipe(baseRecipe, [tasteIngredient], {
                recipeId: "r1",
                householdId: "h1",
                sourceKind: "website",
                sourceUrl: "https://example.com",
                sourceText: null,
                sourceTextOrigin: null,
                transcript: null,
                credit: null,
                unresolvedLines: [],
                problems: [],
                importedAt: "2026-01-01T00:00:00.000Z",
            }).verified,
        ).toBe(true);

        const { items: seedItems } = parseIngredientLines(["Sesame seeds"]);
        const seed = seedItems[0]!;
        const seedIngredient = ingredient(seed.name, seed.quantity, seed.note);
        const result = verifyRecipe(baseRecipe, [seedIngredient], null);
        expect(result.verified).toBe(false);
        expect(
            result.problems.some((p) => p.code === "ingredient_no_amount"),
        ).toBe(true);
    });

    test("not-measured phrase with extra whitespace in parentheses", () => {
        const line = "fresh herbs (or parsley, chopped for  garnish), optional";
        const { items } = parseIngredientLines([line]);
        const item = items[0]!;
        expect(item.quantity).toBeNull();
        expect(item.name).toBe("fresh herbs");
        expect(isNotMeasuredNote(item.note)).toBe(true);
        const ing = ingredient(item.name, item.quantity, item.note);
        expect(
            verifyRecipe(baseRecipe, [ing], {
                recipeId: "r1",
                householdId: "h1",
                sourceKind: "website",
                sourceUrl: "https://example.com",
                sourceText: null,
                sourceTextOrigin: null,
                transcript: null,
                credit: null,
                unresolvedLines: [],
                problems: [],
                importedAt: "2026-01-01T00:00:00.000Z",
            }).verified,
        ).toBe(true);
    });
});
