import { test, expect } from "bun:test";
import { fridgeItemFromRow, fridgeItemToRow } from "./fridge.js";
import { groceryLineFromRow, groceryLineToRow } from "./grocery.js";
import { recipeIngredientFromRow, recipeIngredientToRow } from "./recipes.js";
import { memberDislikeToRow } from "./rules.js";

// Phase 8, step 1: rows no longer carry the legacy identity JSON or the
// ingredient nutrition snapshot. Identity is derived from food_id on read,
// and writes leave both columns out so a later migration can drop them.

const FOOD_ID = "11111111-1111-4111-8111-111111111111";

test("a fridge row without identity derives it from food_id", () => {
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
    expect(item.identity).toEqual({
        kind: "supply",
        via: "catalog",
        source: "foodable",
        sourceId: FOOD_ID,
        displayName: "Foil",
    });
    expect(fridgeItemToRow(item)).not.toHaveProperty("identity");
});

test("a grocery row without identity derives it from food_id", () => {
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
    expect(line.identity).toMatchObject({
        kind: "food",
        via: "catalog",
        sourceId: FOOD_ID,
    });
    expect(groceryLineToRow(line)).not.toHaveProperty("identity");
});

test("a recipe ingredient row carries neither identity nor nutrition", () => {
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
    expect(ingredient.identity).toMatchObject({
        kind: "food",
        via: "catalog",
        sourceId: FOOD_ID,
    });
    expect(ingredient.nutrition).toBeNull();
    const row = recipeIngredientToRow(ingredient);
    expect(row).not.toHaveProperty("identity");
    expect(row).not.toHaveProperty("nutrition");
});

test("a dislike row no longer writes identity", () => {
    expect(
        memberDislikeToRow({
            id: "d1",
            householdId: "h1",
            userId: "u1",
            displayName: "Cilantro",
        }),
    ).not.toHaveProperty("identity");
});
