import { describe, expect, test } from "bun:test";
import { verifyRecipe } from "./recipe-import.js";
import type { Recipe, RecipeIngredient } from "./recipes.js";
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
});
