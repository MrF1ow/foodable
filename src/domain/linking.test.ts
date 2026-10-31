import { test, expect } from "bun:test";
import { alreadyHaveTag, recipeToGroceryRemainder } from "./linking.js";

// Matching is by food_id alone. Two foods can share a display name (two
// cottage cheeses, say), and those must never net against each other.
const COTTAGE = "food-cottage";
const OTHER_COTTAGE = "food-cottage-other";

test("full cover when fridge stock meets the grocery need", () => {
    const tag = alreadyHaveTag(
        {
            quantity: { amount: 1360.8, unit: "g" },
            foodId: COTTAGE,
        },
        [
            {
                quantity: { amount: 1360.8, unit: "g" },
                foodId: COTTAGE,
            },
        ],
    );
    expect(tag).toEqual({ cover: "full" });
});

test("partial cover converts fridge grams into grocery ounces", () => {
    const tag = alreadyHaveTag(
        {
            quantity: { amount: 48, unit: "oz" },
            foodId: COTTAGE,
        },
        [
            {
                quantity: { amount: 680.4, unit: "g" },
                foodId: COTTAGE,
            },
        ],
    );
    expect(tag).toEqual({
        cover: "partial",
        have: { amount: 24, unit: "oz" },
        need: { amount: 24, unit: "oz" },
    });
});

test("two foods with the same display name do not net", () => {
    const tag = alreadyHaveTag(
        {
            quantity: { amount: 400, unit: "g" },
            foodId: COTTAGE,
        },
        [
            {
                quantity: { amount: 400, unit: "g" },
                foodId: OTHER_COTTAGE,
            },
        ],
    );
    expect(tag).toBeNull();
});

test("supply stock with a matching food covers the grocery line", () => {
    expect(
        alreadyHaveTag(
            { foodId: "supply-foil", quantity: { amount: 2, unit: "roll" } },
            [{ foodId: "supply-foil", quantity: { amount: 2, unit: "roll" } }],
        ),
    ).toEqual({ cover: "full" });
});

test("recipe grocery remainder sums selected member portions then nets fridge", () => {
    const plan = recipeToGroceryRemainder({
        ingredients: [
            {
                displayName: "Cottage Cheese",
                quantity: { amount: 400, unit: "g" },
                foodId: COTTAGE,
            },
        ],
        yieldPortions: 4,
        portionCounts: [1, 2],
        stock: [
            {
                quantity: { amount: 50, unit: "g" },
                foodId: COTTAGE,
            },
        ],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0]?.need).toEqual({ amount: 300, unit: "g" });
    expect(plan[0]?.skipped).toBe(false);
    expect(plan[0]?.remainder).toEqual({ amount: 250, unit: "g" });
    expect(plan[0]?.tag).toEqual({
        cover: "partial",
        have: { amount: 50, unit: "g" },
        need: { amount: 250, unit: "g" },
    });
});

test("recipe grocery remainder skips a fully covered ingredient", () => {
    const plan = recipeToGroceryRemainder({
        ingredients: [
            {
                displayName: "Cottage Cheese",
                quantity: { amount: 400, unit: "g" },
                foodId: COTTAGE,
            },
        ],
        yieldPortions: 4,
        portionCounts: [1],
        stock: [
            {
                quantity: { amount: 100, unit: "g" },
                foodId: COTTAGE,
            },
        ],
    });
    expect(plan[0]?.need).toEqual({ amount: 100, unit: "g" });
    expect(plan[0]?.skipped).toBe(true);
    expect(plan[0]?.remainder).toBeNull();
    expect(plan[0]?.tag).toEqual({ cover: "full" });
});

test("recipe grocery remainder does not net a different food with the same name", () => {
    const plan = recipeToGroceryRemainder({
        ingredients: [
            {
                displayName: "cottage cheese",
                quantity: { amount: 400, unit: "g" },
                foodId: COTTAGE,
            },
        ],
        yieldPortions: 2,
        portionCounts: [1],
        stock: [
            {
                quantity: { amount: 400, unit: "g" },
                foodId: OTHER_COTTAGE,
            },
        ],
    });
    expect(plan[0]?.skipped).toBe(false);
    expect(plan[0]?.remainder).toEqual({ amount: 200, unit: "g" });
    expect(plan[0]?.tag).toBeNull();
});

test("same food_id covers fridge stock", () => {
    const foodId = "food-eggs";
    expect(
        alreadyHaveTag(
            {
                quantity: { amount: 200, unit: "g" },
                foodId,
            },
            [
                {
                    quantity: { amount: 200, unit: "g" },
                    foodId,
                },
            ],
        ),
    ).toEqual({ cover: "full" });
});

test("6 eggs needed with 4 in the fridge is partial", () => {
    const foodId = "food-eggs";
    expect(
        alreadyHaveTag(
            {
                quantity: { amount: 6, unit: "each" },
                foodId,
            },
            [
                {
                    quantity: { amount: 4, unit: "each" },
                    foodId,
                },
            ],
        ),
    ).toEqual({
        cover: "partial",
        have: { amount: 4, unit: "each" },
        need: { amount: 2, unit: "each" },
    });
});

test("each vs grams compares through grams when the food has a factor", () => {
    const foodId = "food-eggs";
    const foods = new Map([[foodId, { gramsPerEach: 50, gramsPerMl: null }]]);
    expect(
        alreadyHaveTag(
            {
                quantity: { amount: 6, unit: "each" },
                foodId,
            },
            [
                {
                    quantity: { amount: 200, unit: "g" },
                    foodId,
                },
            ],
            foods,
        ),
    ).toEqual({
        cover: "partial",
        have: { amount: 4, unit: "each" },
        need: { amount: 2, unit: "each" },
    });
});

test("cross-dimension stock without a factor is unknown, not zero", () => {
    const foodId = "food-eggs";
    expect(
        alreadyHaveTag(
            {
                quantity: { amount: 6, unit: "each" },
                foodId,
            },
            [
                {
                    quantity: { amount: 200, unit: "g" },
                    foodId,
                },
            ],
        ),
    ).toBeNull();
});

test("a row without a food_id never matches", () => {
    expect(
        alreadyHaveTag({ quantity: { amount: 1, unit: "each" } }, [
            { quantity: { amount: 1, unit: "each" } },
        ]),
    ).toBeNull();
});

test("recipe grocery remainder: total portions override the members' sum", () => {
    const ingredients = [
        {
            displayName: "Cottage Cheese",
            quantity: { amount: 500, unit: "g" },
        },
    ];
    // A 10-portion loaf, two people eating one slice each.
    const perPeople = recipeToGroceryRemainder({
        ingredients,
        yieldPortions: 10,
        portionCounts: [1, 1],
        stock: [],
    });
    expect(perPeople[0]?.need).toEqual({ amount: 100, unit: "g" });
    const wholeLoaf = recipeToGroceryRemainder({
        ingredients,
        yieldPortions: 10,
        portionCounts: [1, 1],
        totalPortions: 10,
        stock: [],
    });
    expect(wholeLoaf[0]?.need).toEqual({ amount: 500, unit: "g" });
});
