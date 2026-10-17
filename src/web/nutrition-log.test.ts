import { test, expect } from "bun:test";
import type {
    MealInput,
    MealInsertResult,
    WaterInput,
    WaterInsertResult,
    WeightInput,
    WeightInsertResult,
} from "../db/nutrition.js";
import {
    logMealFromForm,
    logWaterFromForm,
    logWeightFromForm,
} from "./pages/nutrition.js";

const USER = "11111111-1111-4111-8111-111111111111";

test("logs a meal through insertMeal", async () => {
    const calls: { userId: string; input: MealInput }[] = [];
    const result = await logMealFromForm(
        USER,
        { description: "Oats" },
        async (userId, input) => {
            calls.push({ userId, input });
            return {
                meal: { id: "m1" },
                deduplicated: false,
            } as MealInsertResult;
        },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
        {
            userId: USER,
            input: { description: "Oats", meal_type: "snack" },
        },
    ]);
});

test("rejects an empty meal description without inserting", async () => {
    const calls: unknown[] = [];
    const result = await logMealFromForm(
        USER,
        { description: "   " },
        async (userId, input) => {
            calls.push({ userId, input });
            return {
                meal: { id: "m1" },
                deduplicated: false,
            } as MealInsertResult;
        },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    expect(calls).toEqual([]);
});

test("logs a food-backed meal with computed totals", async () => {
    const { createMemoryFoodsStore, findOrCreateManualFood, updateFood } =
        await import("../domain/foods.js");
    const { createMemoryRecipesStore } = await import("../domain/recipes.js");
    const foods = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(foods, "hh-1", "food", "Eggs");
    await updateFood(foods, "hh-1", eggs.id, {
        defaultUnit: "each",
        gramsPerEach: 50,
        calories: 155,
        proteinG: 13,
        carbsG: 1.1,
        fatG: 11,
        fiberG: 0,
        sugarG: 1.1,
    });
    const calls: { userId: string; input: MealInput }[] = [];
    const result = await logMealFromForm(
        USER,
        {
            meal_type: "breakfast",
            items: [
                {
                    food_id: eggs.id,
                    name: "Eggs",
                    amount: "2",
                    unit: "each",
                },
            ],
        },
        async (userId, input) => {
            calls.push({ userId, input });
            return {
                meal: { id: "m1" },
                deduplicated: false,
            } as MealInsertResult;
        },
        {
            householdId: "hh-1",
            foods,
            recipes: createMemoryRecipesStore(),
        },
    );
    expect(result).toEqual({ ok: true });
    expect(calls[0]!.input.meal_type).toBe("breakfast");
    expect(calls[0]!.input.calories).toBe(155);
    expect(calls[0]!.input.items).toHaveLength(1);
    expect(calls[0]!.input.item_digest).toBeTruthy();
});

test("logs water through insertWater", async () => {
    const calls: { userId: string; input: WaterInput }[] = [];
    const result = await logWaterFromForm(
        USER,
        { amount_ml: "250" },
        async (userId, input) => {
            calls.push({ userId, input });
            return {
                entry: { id: "w1", amount_ml: input.amount_ml },
                deduplicated: false,
            } as WaterInsertResult;
        },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ userId: USER, input: { amount_ml: 250 } }]);
});

test("logs weight through insertWeight as kilograms", async () => {
    const calls: { userId: string; input: WeightInput }[] = [];
    const result = await logWeightFromForm(
        USER,
        { weight: "70", unit: "kg" },
        async (userId, input) => {
            calls.push({ userId, input });
            return {
                entry: { id: "k1", weight_g: input.weight_g },
                deduplicated: false,
            } as WeightInsertResult;
        },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ userId: USER, input: { weight_g: 70000 } }]);
});
