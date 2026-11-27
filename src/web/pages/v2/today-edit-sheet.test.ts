import { expect, test } from "bun:test";
import type { Meal, MealItem } from "../../../db/nutrition.js";
import { renderTodayEditSheet } from "./today-edit-sheet.js";

function meal(fields: Partial<Meal> = {}): Meal {
    return {
        id: "11111111-1111-4111-8111-111111111111",
        user_id: "u1",
        logged_at: "2026-03-01T12:00:00.000Z",
        meal_type: "lunch",
        description: "Pasta plate",
        calories: 600,
        protein_g: 40,
        carbs_g: 80,
        fat_g: 20,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        ...fields,
    };
}

function render(m: Meal): string {
    return renderTodayEditSheet(m, { day: "2026-03-01", tz: "UTC" });
}

function servingsValue(html: string): string | null {
    const input = /<input[^>]*name="servings"[^>]*>/.exec(html)?.[0];
    return input ? (/value="([^"]*)"/.exec(input)?.[1] ?? null) : null;
}

test("a quick meal with no stored servings opens at one", () => {
    expect(servingsValue(render(meal()))).toBe("1");
    expect(servingsValue(render(meal({ servings: null })))).toBe("1");
});

test("a quick meal reopens at the servings last saved", () => {
    const html = render(meal({ servings: 2.5 }));
    expect(servingsValue(html)).toBe("2.5");
    // The tiles and the script's base stay the saved totals at those servings.
    expect(html).toContain('data-fd-calories="600"');
});

test("an item-backed meal has item steppers and no servings stepper", () => {
    const item: MealItem = {
        id: "22222222-2222-4222-8222-222222222222",
        meal_id: "11111111-1111-4111-8111-111111111111",
        user_id: "u1",
        household_id: "h1",
        food_id: "33333333-3333-4333-8333-333333333333",
        recipe_id: null,
        label: "Egg",
        amount: 2,
        unit: "each",
        grams: 100,
        portions: null,
        calories: 160,
        protein_g: 12,
        carbs_g: 1,
        fat_g: 10,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        sort_order: 0,
        created_at: "2026-03-01T12:00:00.000Z",
    };
    const html = render(meal({ items: [item], servings: null }));
    expect(servingsValue(html)).toBeNull();
    expect(html).toContain(`name="item_amount_${item.id}"`);
    expect(html).toMatch(/name="item_amount_[^"]*" value="2"/);
});
