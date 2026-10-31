import { test, expect } from "bun:test";
import { fridgeItemFromRow, fridgeItemToRow } from "./fridge.js";
import { groceryLineFromRow, groceryLineToRow } from "./grocery.js";
import { recipeIngredientFromRow, recipeIngredientToRow } from "./recipes.js";
import { memberDislikeToRow } from "./rules.js";

// Phase 8 dropped the legacy identity JSON, the ingredient nutrition snapshot
// and the dislike identity column. Rows name their food by food_id alone, and
// writes must not send a dropped column back: PostgREST rejects unknown keys.

const FOOD_ID = "11111111-1111-4111-8111-111111111111";

test("a fridge row round-trips through food_id alone", () => {
    const item = fridgeItemFromRow({
        id: "i1",
        household_id: "h1",
        location_id: "l1",
        kind: "supply",
        display_name: "Foil",
        amount: 2,
        unit: "each",
        food_id: FOOD_ID,
    });
    expect(item.foodId).toBe(FOOD_ID);
    expect(item.kind).toBe("supply");
    const row = fridgeItemToRow(item);
    expect(row.food_id).toBe(FOOD_ID);
    expect(row).not.toHaveProperty("identity");
});

test("a grocery row round-trips through food_id alone", () => {
    const line = groceryLineFromRow({
        id: "g1",
        household_id: "h1",
        store_id: "s1",
        section_id: "sec1",
        kind: "food",
        display_name: "Lentils",
        amount: 300,
        unit: "g",
        checked: false,
        food_id: FOOD_ID,
    });
    expect(line.foodId).toBe(FOOD_ID);
    const row = groceryLineToRow(line);
    expect(row.food_id).toBe(FOOD_ID);
    expect(row).not.toHaveProperty("identity");
});

test("a recipe ingredient row writes neither identity nor nutrition", () => {
    const ingredient = recipeIngredientFromRow({
        id: "r1",
        household_id: "h1",
        recipe_id: "rec1",
        kind: "food",
        display_name: "Lentils",
        amount: 400,
        unit: "g",
        sort_order: 0,
        food_id: FOOD_ID,
    });
    expect(ingredient.foodId).toBe(FOOD_ID);
    const row = recipeIngredientToRow(ingredient);
    expect(row.food_id).toBe(FOOD_ID);
    expect(row).not.toHaveProperty("identity");
    expect(row).not.toHaveProperty("nutrition");
});

test("a dislike row does not write identity", () => {
    expect(
        memberDislikeToRow({
            id: "d1",
            householdId: "h1",
            userId: "u1",
            displayName: "Cilantro",
        }),
    ).not.toHaveProperty("identity");
});
