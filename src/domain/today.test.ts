import { describe, expect, test } from "bun:test";
import type { Meal, NutritionGoals } from "../db/nutrition.js";
import type { GoalsByDate } from "./insights.js";
import { descriptionFromItems } from "./meals.js";
import {
    annotateWeekDays,
    mealRows,
    mondayWeekStart,
    weekDates,
    weekDotState,
    weekDots,
} from "./today.js";

function meal(over: Partial<Meal> & { calories?: number | null } = {}): Meal {
    return {
        id: "m1",
        user_id: "u1",
        logged_at: "2026-03-02T12:00:00.000Z",
        meal_type: "lunch",
        description: "Salad",
        calories: 400,
        protein_g: 30,
        carbs_g: 20,
        fat_g: 10,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        ...over,
    };
}

const goals2000: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2000,
    daily_protein_g: null,
    daily_carbs_g: null,
    daily_fat_g: null,
    daily_fiber_g: null,
    daily_sugar_g: null,
    daily_alcohol_g: null,
    daily_caffeine_mg: null,
    daily_water_ml: null,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

const noGoals: GoalsByDate = () => null;

describe("weekDotState", () => {
    test("empty when nothing logged (no meals, no water)", () => {
        expect(
            weekDotState({ meals: [], waterMl: 0, calories: 0 }, goals2000),
        ).toBe("empty");
    });

    test("water alone counts as logged (streak parity) but not hit without a meal", () => {
        expect(
            weekDotState({ meals: [], waterMl: 250, calories: 0 }, goals2000),
        ).toBe("off");
        expect(
            weekDotState(
                { meals: [], waterMl: 250, calories: 0 },
                { ...goals2000, daily_calories: 120 },
            ),
        ).toBe("off");
    });

    test("null-calorie meal or zero goal is off, not hit", () => {
        expect(
            weekDotState(
                {
                    meals: [meal({ calories: null })],
                    waterMl: 0,
                    calories: 0,
                },
                { ...goals2000, daily_calories: 100 },
            ),
        ).toBe("off");
        expect(
            weekDotState(
                { meals: [meal({ calories: 50 })], waterMl: 0, calories: 50 },
                { ...goals2000, daily_calories: 0 },
            ),
        ).toBe("off");
    });

    test("explicit zero kcal meal can still hit when goal is set", () => {
        expect(
            weekDotState(
                { meals: [meal({ calories: 0 })], waterMl: 0, calories: 0 },
                { ...goals2000, daily_calories: 100 },
            ),
        ).toBe("hit");
    });

    test("hit when within 120 kcal of goal (exactly 120 off)", () => {
        expect(
            weekDotState(
                {
                    meals: [meal({ calories: 1880 })],
                    waterMl: 0,
                    calories: 1880,
                },
                goals2000,
            ),
        ).toBe("hit");
        expect(
            weekDotState(
                {
                    meals: [meal({ calories: 2120 })],
                    waterMl: 0,
                    calories: 2120,
                },
                goals2000,
            ),
        ).toBe("hit");
    });

    test("off when 121 kcal away from goal", () => {
        expect(
            weekDotState(
                {
                    meals: [meal({ calories: 1879 })],
                    waterMl: 0,
                    calories: 1879,
                },
                goals2000,
            ),
        ).toBe("off");
        expect(
            weekDotState(
                {
                    meals: [meal({ calories: 2121 })],
                    waterMl: 0,
                    calories: 2121,
                },
                goals2000,
            ),
        ).toBe("off");
    });

    test("off when logged but no calorie goal", () => {
        expect(
            weekDotState({ meals: [meal()], waterMl: 0, calories: 400 }, null),
        ).toBe("off");
        expect(
            weekDotState(
                { meals: [meal()], waterMl: 0, calories: 400 },
                { ...goals2000, daily_calories: null },
            ),
        ).toBe("off");
    });
});

describe("weekDots", () => {
    test("maps each day through goalsByDate", () => {
        const goalsOn: GoalsByDate = (date) =>
            date === "2026-03-03" ? goals2000 : null;
        const dots = weekDots(
            [
                { date: "2026-03-02", meals: [], waterMl: 0, calories: 0 },
                {
                    date: "2026-03-03",
                    meals: [meal({ calories: 2000 })],
                    waterMl: 0,
                    calories: 2000,
                },
            ],
            goalsOn,
        );
        expect(dots).toEqual([
            { date: "2026-03-02", state: "empty" },
            { date: "2026-03-03", state: "hit" },
        ]);
    });
});

describe("week calendar helpers", () => {
    test("mondayWeekStart lands on Monday", () => {
        expect(mondayWeekStart("2026-03-04")).toBe("2026-03-02"); // Wed -> Mon
        expect(mondayWeekStart("2026-03-08")).toBe("2026-03-02"); // Sun -> Mon
        expect(mondayWeekStart("2026-03-02")).toBe("2026-03-02"); // Mon
    });

    test("weekDates is seven Monday-first days", () => {
        expect(weekDates("2026-03-02")).toEqual([
            "2026-03-02",
            "2026-03-03",
            "2026-03-04",
            "2026-03-05",
            "2026-03-06",
            "2026-03-07",
            "2026-03-08",
        ]);
    });

    test("annotateWeekDays marks today and selected", () => {
        const out = annotateWeekDays(
            weekDates("2026-03-02"),
            "2026-03-04",
            "2026-03-03",
            { prevWeekStart: "2026-02-23", nextWeekStart: "2026-03-09" },
        );
        expect(out.weekStart).toBe("2026-03-02");
        expect(out.prevWeekStart).toBe("2026-02-23");
        expect(out.nextWeekStart).toBe("2026-03-09");
        expect(out.days.find((d) => d.date === "2026-03-04")?.isToday).toBe(
            true,
        );
        expect(out.days.find((d) => d.date === "2026-03-03")?.isSelected).toBe(
            true,
        );
    });
});

describe("mealRows", () => {
    test("multi-item meal uses distinct title when description matches item list", () => {
        const itemDefs = [
            {
                id: "i2",
                meal_id: "combo",
                user_id: "u1",
                household_id: "h1",
                food_id: "f2",
                recipe_id: null,
                label: "Toast",
                amount: 1,
                unit: "slice",
                grams: null,
                portions: null,
                calories: 80,
                protein_g: 3,
                carbs_g: 14,
                fat_g: 1,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
                sort_order: 0,
                created_at: "2026-03-02T12:00:00.000Z",
            },
            {
                id: "i1",
                meal_id: "combo",
                user_id: "u1",
                household_id: "h1",
                food_id: "f1",
                recipe_id: null,
                label: "Eggs",
                amount: 2,
                unit: "each",
                grams: null,
                portions: null,
                calories: 140,
                protein_g: 12,
                carbs_g: 1,
                fat_g: 10,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
                sort_order: 1,
                created_at: "2026-03-02T12:00:00.000Z",
            },
        ] as const;
        const produced = descriptionFromItems(
            [...itemDefs]
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((item) => ({
                    foodId: item.food_id,
                    recipeId: null,
                    label: item.label,
                    amount: item.amount,
                    unit: item.unit,
                    grams: null,
                    portions: null,
                    sortOrder: item.sort_order,
                    unknown: false,
                    calories: item.calories,
                    protein_g: item.protein_g,
                    carbs_g: item.carbs_g,
                    fat_g: item.fat_g,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                })),
        );
        const rows = mealRows([
            meal({
                id: "combo",
                description: produced,
                meal_type: "breakfast",
                items: itemDefs.map((item) => ({
                    ...item,
                    meal_id: "combo",
                    user_id: "u1",
                    household_id: "h1",
                    grams: null,
                    portions: null,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                })),
            }),
        ]);
        const row = rows[0]!.rows[0]!;
        expect(row.title).toBe("Toast + 1 more");
        expect(row.subtitle).toBe(produced);
        expect(row.title).not.toBe(row.subtitle);
    });

    test("multi-item title also ignores a description in write order", () => {
        const items = [
            { id: "a", label: "Eggs", amount: 2, unit: "each", sort_order: 1 },
            {
                id: "b",
                label: "Toast",
                amount: 1,
                unit: "slice",
                sort_order: 0,
            },
        ].map((i) => ({
            ...i,
            meal_id: "m",
            user_id: "u1",
            household_id: "h1",
            food_id: `f-${i.id}`,
            recipe_id: null,
            grams: null,
            portions: null,
            calories: 100,
            protein_g: 1,
            carbs_g: 1,
            fat_g: 1,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            created_at: "2026-03-02T12:00:00.000Z",
        }));
        const row = mealRows([
            meal({
                id: "m",
                description: "2 each Eggs + 1 slice Toast",
                meal_type: "breakfast",
                items,
            }),
        ])[0]!.rows[0]!;
        expect(row.title).toBe("Toast + 1 more");
        expect(row.subtitle).toBe("1 slice Toast + 2 each Eggs");
    });

    test("multi-item meal is one row with item subtitle", () => {
        const rows = mealRows([
            meal({
                id: "combo",
                description: "Breakfast plate",
                meal_type: "breakfast",
                items: [
                    {
                        id: "i1",
                        meal_id: "combo",
                        user_id: "u1",
                        household_id: "h1",
                        food_id: "f1",
                        recipe_id: null,
                        label: "Eggs",
                        amount: 2,
                        unit: "each",
                        grams: null,
                        portions: null,
                        calories: 140,
                        protein_g: 12,
                        carbs_g: 1,
                        fat_g: 10,
                        fiber_g: null,
                        sugar_g: null,
                        alcohol_g: null,
                        caffeine_mg: null,
                        sort_order: 0,
                        created_at: "2026-03-02T12:00:00.000Z",
                    },
                    {
                        id: "i2",
                        meal_id: "combo",
                        user_id: "u1",
                        household_id: "h1",
                        food_id: "f2",
                        recipe_id: null,
                        label: "Toast",
                        amount: 1,
                        unit: "slice",
                        grams: null,
                        portions: null,
                        calories: 80,
                        protein_g: 3,
                        carbs_g: 14,
                        fat_g: 1,
                        fiber_g: null,
                        sugar_g: null,
                        alcohol_g: null,
                        caffeine_mg: null,
                        sort_order: 1,
                        created_at: "2026-03-02T12:00:00.000Z",
                    },
                ],
            }),
        ]);
        expect(rows).toHaveLength(1);
        const group = rows[0]!;
        expect(group.mealType).toBe("breakfast");
        expect(group.rows).toHaveLength(1);
        expect(group.rows[0]!.title).toBe("Breakfast plate");
        expect(group.rows[0]!.subtitle).toBe("2 each Eggs + 1 slice Toast");
    });

    test("unknown meal type lands in snack", () => {
        const rows = mealRows([meal({ meal_type: null })]);
        expect(rows[0]!.mealType).toBe("snack");
    });

    test("groups in breakfast-lunch-dinner-snack order", () => {
        const rows = mealRows([
            meal({ id: "s", meal_type: "snack", description: "S" }),
            meal({ id: "b", meal_type: "breakfast", description: "B" }),
            meal({ id: "d", meal_type: "dinner", description: "D" }),
        ]);
        expect(rows.map((g) => g.mealType)).toEqual([
            "breakfast",
            "dinner",
            "snack",
        ]);
    });

    test("row macros stay null when meal macros are null", () => {
        const rows = mealRows([
            meal({
                calories: null,
                protein_g: null,
                carbs_g: null,
                fat_g: null,
            }),
        ]);
        const row = rows[0]!.rows[0]!;
        expect(row.calories).toBeNull();
        expect(row.protein_g).toBeNull();
        expect(row.carbs_g).toBeNull();
        expect(row.fat_g).toBeNull();
    });
});
