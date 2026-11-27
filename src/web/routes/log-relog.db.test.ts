import { afterEach, beforeEach, expect, test } from "bun:test";
import { getMealById, insertMeal, updateMeal } from "../../db/nutrition.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { setSqlForTests } from "../../db/sql.js";
import { mealServings, scaleMealTotals } from "../../domain/today-edit.js";
import { mealInputForRelog, mealInputForSlotRelog } from "./log-relog.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "relog servings db", (getCtx) => {
    let userId: string;
    let householdId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId, householdId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("again on a quick meal saved at 2 servings copies it at 2, so its sheet does not double", async () => {
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: "Soup",
            calories: 300,
            protein_g: 10,
        });
        const scaled = scaleMealTotals(meal, 2);
        await updateMeal(userId, meal.id, {
            calories: scaled.calories!,
            protein_g: scaled.protein_g!,
            servings: 2,
        });
        const input = await mealInputForRelog(
            householdId,
            (await getMealById(userId, meal.id))!,
            "2026-03-15T12:00:00.000Z",
        );
        const { meal: copy } = await insertMeal(userId, {
            ...input,
            idempotency_key: "again:1",
        });
        expect(copy.calories).toBe(600);
        expect(copy.servings).toBe(2);
        expect(mealServings(copy)).toBe(2);
        // saving the sheet at 2 again keeps the totals, not 1200
        expect(scaleMealTotals(copy, 2).calories).toBe(600);
    });

    test("insertMeal stores no servings for an item-backed meal", async () => {
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: "Egg",
            calories: 160,
            servings: 2,
            items: [
                {
                    household_id: householdId,
                    food_id: null,
                    recipe_id: null,
                    label: "Egg",
                    amount: 2,
                    unit: "each",
                    grams: null,
                    portions: null,
                    calories: 160,
                    protein_g: null,
                    carbs_g: null,
                    fat_g: null,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                },
            ],
            idempotency_key: "items:1",
        });
        expect(meal.servings ?? null).toBeNull();
    });

    test("a slot copy of one quick meal keeps its servings; two meals merge to none", async () => {
        const { meal } = await insertMeal(userId, {
            meal_type: "dinner",
            logged_at: "2026-03-01T18:00:00.000Z",
            description: "Chili",
            calories: 800,
        });
        await updateMeal(userId, meal.id, { calories: 800, servings: 2 });
        const one = await getMealById(userId, meal.id);
        const single = await mealInputForSlotRelog(
            householdId,
            [one!],
            "dinner",
            "2026-03-15T18:00:00.000Z",
        );
        expect(single?.servings).toBe(2);
        const { meal: other } = await insertMeal(userId, {
            meal_type: "dinner",
            logged_at: "2026-03-01T19:00:00.000Z",
            description: "Bread",
            calories: 100,
        });
        const merged = await mealInputForSlotRelog(
            householdId,
            [one!, (await getMealById(userId, other.id))!],
            "dinner",
            "2026-03-15T18:00:00.000Z",
        );
        expect(merged?.servings).toBeUndefined();
        expect(merged?.calories).toBe(900);
    });
});
