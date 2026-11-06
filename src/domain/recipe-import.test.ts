import { test, expect } from "bun:test";
import {
    recipeImportFromRow,
    recipeImportToRow,
    sweepUnverifiedRecipes,
    verifyRecipe,
} from "./recipe-import.js";
import {
    createMemoryRecipesStore,
    type Recipe,
    type RecipeIngredient,
} from "./recipes.js";

const HH = "11111111-1111-1111-1111-111111111111";
const USER = "00000000-0000-0000-0000-0000000000a1";

function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: "r1",
        householdId: HH,
        creatorId: USER,
        name: "Soup",
        yieldPortions: 2,
        instructions: "1. Simmer.",
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "unverified",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function ingredient(
    overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
    return {
        id: "i1",
        householdId: HH,
        recipeId: "r1",
        kind: "food",
        displayName: "Salt",
        quantity: { amount: 1, unit: "g" },
        foodId: "f1",
        sortOrder: 0,
        note: null,
        ...overrides,
    };
}

test("verifyRecipe passes for a complete recipe without nutrition", () => {
    const result = verifyRecipe(baseRecipe(), [ingredient()], {
        recipeId: "r1",
        householdId: HH,
        sourceKind: "text",
        sourceUrl: null,
        sourceText: "paste",
        sourceTextOrigin: "pasted",
        transcript: null,
        credit: null,
        unresolvedLines: [],
        problems: [],
        importedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.verified).toBe(true);
    expect(result.problems).toEqual([]);
});

test("verifyRecipe failing rules", () => {
    expect(
        verifyRecipe(baseRecipe({ name: "  " }), [], null).problems[0]?.code,
    ).toBe("no_name");
    expect(verifyRecipe(baseRecipe(), [], null).problems[0]?.code).toBe(
        "no_ingredients",
    );
    expect(
        verifyRecipe(baseRecipe(), [ingredient({ foodId: null })], null)
            .problems[0]?.code,
    ).toBe("ingredient_no_food");
    expect(
        verifyRecipe(
            baseRecipe(),
            [ingredient({ quantity: null, note: null })],
            null,
        ).problems[0]?.code,
    ).toBe("ingredient_no_amount");
    expect(
        verifyRecipe(
            baseRecipe(),
            [ingredient({ quantity: null, note: "to taste" })],
            null,
        ).verified,
    ).toBe(true);
    expect(
        verifyRecipe(baseRecipe(), [ingredient()], {
            recipeId: "r1",
            householdId: HH,
            sourceKind: "text",
            sourceUrl: null,
            sourceText: null,
            sourceTextOrigin: null,
            transcript: null,
            credit: null,
            unresolvedLines: ["bad line"],
            problems: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        }).problems[0]?.code,
    ).toBe("unresolved_lines");
    expect(
        verifyRecipe(baseRecipe({ instructions: null }), [ingredient()], null)
            .problems[0]?.code,
    ).toBe("no_instructions");
});

test("recipe import row mappers round-trip", () => {
    const row = {
        recipeId: "r1",
        householdId: HH,
        sourceKind: "text" as const,
        sourceUrl: null,
        sourceText: "hello",
        sourceTextOrigin: "pasted" as const,
        transcript: null,
        credit: null,
        unresolvedLines: ["x"],
        problems: [
            {
                code: "no_instructions" as const,
                message: "Add the steps.",
                ingredientId: null,
                line: null,
            },
        ],
        importedAt: "2026-01-01T00:00:00.000Z",
    };
    const mapped = recipeImportFromRow(recipeImportToRow(row) as never);
    expect(mapped.sourceText).toBe("hello");
    expect(mapped.unresolvedLines).toEqual(["x"]);
    expect(mapped.problems[0]?.code).toBe("no_instructions");
});

test("sweepUnverifiedRecipes respects expiry", async () => {
    const store = createMemoryRecipesStore();
    const old = await store.insertRecipe({
        ...baseRecipe({ id: "old", name: "Old", verification: "unverified" }),
        updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const recent = await store.insertRecipe({
        ...baseRecipe({
            id: "recent",
            name: "Recent",
            verification: "unverified",
        }),
        updatedAt: "2026-05-20T00:00:00.000Z",
    });
    const verified = await store.insertRecipe({
        ...baseRecipe({ id: "ok", name: "Verified", verification: "verified" }),
        updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const recipes = store;
    const deleted = await sweepUnverifiedRecipes({
        households: [
            { id: HH, preferences: { unverifiedRecipeExpiryDays: 30 } },
        ],
        recipes,
        now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(deleted).toBe(1);
    expect(await recipes.getRecipe(HH, old.id)).toBeNull();
    expect(await recipes.getRecipe(HH, recent.id)).not.toBeNull();
    expect(await recipes.getRecipe(HH, verified.id)).not.toBeNull();
    expect(
        await sweepUnverifiedRecipes({
            households: [
                { id: HH, preferences: { unverifiedRecipeExpiryDays: null } },
            ],
            recipes,
            now: new Date(),
        }),
    ).toBe(0);
});
