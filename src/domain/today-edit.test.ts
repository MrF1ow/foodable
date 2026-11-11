import { expect, test } from "bun:test";
import { mealIdempotencyKey } from "../db/nutrition.js";
import type { MealItem } from "../db/nutrition.js";
import { itemListDigest } from "./meals.js";
import {
    editItemQuantity,
    itemMacrosAtAmount,
    itemSpecCandidatesFromStoredItem,
    mealLocalTimeValue,
    mealLoggedAtFromLocalTime,
    recoverLoggingSpecsFromMeal,
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

test("itemSpecCandidatesFromStoredItem includes omitted unit", () => {
    const variants = itemSpecCandidatesFromStoredItem({
        food_id: "f1",
        recipe_id: null,
        label: "Egg",
        amount: 2,
        unit: "each",
        portions: null,
    });
    expect(
        variants.some((s) => s.foodId === "f1" && s.amount === 2 && !s.unit),
    ).toBe(true);
});

test("recoverLoggingSpecsFromMeal matches omitted unit auto key", () => {
    const loggedAt = "2026-03-02T12:34:56.789Z";
    const userId = "user-1";
    const loggingSpecs = [{ foodId: "f1", amount: 2 }];
    const item_digest = itemListDigest(loggingSpecs);
    const key = mealIdempotencyKey(
        userId,
        {
            description: "2 Egg",
            meal_type: "lunch",
            calories: 160,
            protein_g: 12,
            item_digest,
        },
        loggedAt,
    );
    const storedItem: MealItem = {
        id: "i1",
        meal_id: "m1",
        household_id: "hh",
        user_id: userId,
        food_id: "f1",
        recipe_id: null,
        label: "Egg",
        amount: 2,
        unit: "each",
        grams: 100,
        portions: null,
        calories: 160,
        protein_g: 12,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        created_at: "",
    };
    expect(
        recoverLoggingSpecsFromMeal(userId, {
            idempotency_key: key,
            description: "2 Egg",
            meal_type: "lunch",
            calories: 160,
            protein_g: 12,
            carbs_g: null,
            fat_g: null,
            notes: null,
            logged_at: loggedAt,
            items: [storedItem],
        }),
    ).toEqual(loggingSpecs);
});

test("recoverLoggingSpecsFromMeal stays bounded on a 20-item meal", () => {
    const loggedAt = "2026-03-02T12:34:56.789Z";
    const userId = "user-1";
    const loggingSpecs = Array.from({ length: 20 }, (_, i) => ({
        foodId: `f${i}`,
        amount: i + 1,
    }));
    const key = mealIdempotencyKey(
        userId,
        {
            description: "big meal",
            meal_type: "dinner",
            item_digest: itemListDigest(loggingSpecs),
        },
        loggedAt,
    );
    const items: MealItem[] = loggingSpecs.map((spec, i) => ({
        id: `i${i}`,
        meal_id: "m1",
        household_id: "hh",
        user_id: userId,
        food_id: spec.foodId,
        recipe_id: null,
        label: `Food ${i}`,
        amount: spec.amount,
        unit: "each",
        grams: 50,
        portions: null,
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: i,
        created_at: "",
    }));
    const meal = {
        idempotency_key: key,
        description: "big meal",
        meal_type: "dinner",
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        notes: null,
        logged_at: loggedAt,
        items,
    };
    const started = performance.now();
    expect(recoverLoggingSpecsFromMeal(userId, meal)).toEqual(loggingSpecs);
    // An unmatched key gives up after the capped search instead of 4^20 tries.
    expect(
        recoverLoggingSpecsFromMeal(userId, {
            ...meal,
            idempotency_key: "auto:nope",
        }),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(2000);
});
