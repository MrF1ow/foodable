import { expect, test } from "bun:test";
import {
    moveCard,
    NUTRITION_CARDS,
    nutritionLayoutOrderErrorMessage,
    orderCards,
    validateNutritionLayoutOrder,
    type NutritionCard,
} from "./layout.js";

test("orderCards with null uses default order", () => {
    expect(orderCards(null)).toEqual([...NUTRITION_CARDS]);
    expect(orderCards(undefined)).toEqual([...NUTRITION_CARDS]);
});

test("orderCards drops unknown keys and dedupes", () => {
    expect(
        orderCards([
            "bogus",
            "trends",
            "trends",
            "nutrition-summary",
            "also-bogus",
        ]),
    ).toEqual([
        "trends",
        "nutrition-summary",
        "log",
        "goal-progress",
        "weight-trends",
    ]);
});

test("orderCards appends missing keys in default order", () => {
    expect(orderCards(["weight-trends", "log"])).toEqual([
        "weight-trends",
        "log",
        "nutrition-summary",
        "goal-progress",
        "trends",
    ]);
});

test("moveCard swaps adjacent entries", () => {
    const base: NutritionCard[] = [...NUTRITION_CARDS];
    expect(moveCard(base, "goal-progress", "up")).toEqual([
        "log",
        "goal-progress",
        "nutrition-summary",
        "trends",
        "weight-trends",
    ]);
    expect(moveCard(base, "goal-progress", "down")).toEqual([
        "log",
        "nutrition-summary",
        "trends",
        "goal-progress",
        "weight-trends",
    ]);
});

test("validateNutritionLayoutOrder accepts a full permutation once each", () => {
    const order: NutritionCard[] = [
        "weight-trends",
        "log",
        "nutrition-summary",
        "goal-progress",
        "trends",
    ];
    expect(validateNutritionLayoutOrder(order)).toEqual(order);
});

test("validateNutritionLayoutOrder rejects unknown, duplicate, and partial lists", () => {
    expect(
        validateNutritionLayoutOrder([
            "log",
            "bogus",
            "trends",
            "goal-progress",
            "weight-trends",
        ]),
    ).toBe("unknown-card");
    expect(nutritionLayoutOrderErrorMessage("unknown-card")).toBe(
        "Unknown card.",
    );
    expect(
        validateNutritionLayoutOrder([
            "log",
            "log",
            "nutrition-summary",
            "goal-progress",
            "trends",
        ]),
    ).toBe("duplicate-card");
    expect(validateNutritionLayoutOrder(["log", "nutrition-summary"])).toBe(
        "wrong-length",
    );
});

test("moveCard is a no-op at the ends and for unknown keys", () => {
    const base: NutritionCard[] = [...NUTRITION_CARDS];
    expect(moveCard(base, "log", "up")).toEqual(base);
    expect(moveCard(base, "weight-trends", "down")).toEqual(base);
    expect(moveCard(base, "nutrition-summary", "up")).not.toBe(base);
    const partial = ["log", "trends"] as NutritionCard[];
    expect(moveCard(partial, "nutrition-summary", "up")).toEqual(partial);
});
