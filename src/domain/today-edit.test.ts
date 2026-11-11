import { expect, test } from "bun:test";
import {
    editItemQuantity,
    itemMacrosAtAmount,
    mealLocalTimeValue,
    mealLoggedAtFromLocalTime,
    scaleMealTotals,
    submittedItemAmountsUnchanged,
} from "./today-edit.js";

test("mealLocalTimeValue formats in zone", () => {
    const t = mealLocalTimeValue(
        "2026-03-01T17:30:00.000Z",
        "2026-03-01",
        "America/New_York",
    );
    expect(t).toMatch(/^\d{2}:\d{2}$/);
});

test("mealLoggedAtFromLocalTime builds local wall clock", () => {
    const raw = mealLoggedAtFromLocalTime(
        "2026-03-01",
        "12:40",
        "America/New_York",
    );
    expect(raw).toBe("2026-03-01T12:40:00");
});

test("scaleMealTotals doubles free-text meal", () => {
    const scaled = scaleMealTotals(
        {
            calories: 400,
            protein_g: 30,
            carbs_g: 40,
            fat_g: 10,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
        },
        2,
    );
    expect(scaled.calories).toBe(800);
    expect(scaled.protein_g).toBe(60);
});

test("editItemQuantity uses portions for recipe rows", () => {
    const q = editItemQuantity({
        id: "i1",
        meal_id: "m1",
        household_id: "hh",
        food_id: null,
        recipe_id: "r1",
        label: "Stew",
        amount: null,
        unit: null,
        grams: null,
        portions: 2,
        calories: 400,
        protein_g: 30,
        carbs_g: 20,
        fat_g: 10,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        user_id: "u1",
        created_at: "",
    });
    expect(q).toEqual({
        value: 2,
        unit: "portion(s)",
        mode: "portions",
    });
});

test("itemMacrosAtAmount scales recipe item by portions", () => {
    const m = itemMacrosAtAmount(
        {
            recipe_id: "r1",
            food_id: null,
            amount: null,
            portions: 2,
            calories: 400,
            protein_g: 30,
            carbs_g: 20,
            fat_g: 10,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
        },
        3,
    );
    expect(m.calories).toBe(600);
    expect(m.protein_g).toBe(45);
});

test("submittedItemAmountsUnchanged detects quantity drift", () => {
    const items = [
        {
            id: "a",
            recipe_id: "r",
            portions: 2,
            amount: null,
        },
    ] as unknown as Parameters<typeof submittedItemAmountsUnchanged>[0];
    expect(submittedItemAmountsUnchanged(items, new Map([["a", 2]]))).toBe(
        true,
    );
    expect(submittedItemAmountsUnchanged(items, new Map([["a", 1]]))).toBe(
        false,
    );
});

test("itemMacrosAtAmount scales item macros", () => {
    const m = itemMacrosAtAmount(
        {
            recipe_id: null,
            food_id: null,
            amount: 100,
            portions: null,
            calories: 200,
            protein_g: 20,
            carbs_g: 10,
            fat_g: 5,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
        },
        150,
    );
    expect(m.calories).toBe(300);
    expect(m.protein_g).toBe(30);
});

test("a row whose recipe was deleted still steps and scales by portions", () => {
    const item = {
        id: "i1",
        meal_id: "m1",
        household_id: "hh",
        food_id: null,
        recipe_id: null,
        label: "Chili",
        amount: null,
        unit: null,
        grams: null,
        portions: 2,
        calories: 500,
        protein_g: 30,
        carbs_g: 40,
        fat_g: 20,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        user_id: "u1",
        created_at: "",
    };
    expect(editItemQuantity(item)).toEqual({
        value: 2,
        unit: "portion(s)",
        mode: "portions",
    });
    expect(itemMacrosAtAmount(item, 4).calories).toBe(1000);
});
