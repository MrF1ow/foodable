import { describe, expect, test } from "bun:test";
import type { HouseholdMember } from "../household.js";
import type { Meal, NutritionGoals, WeightEntry } from "../db/nutrition.js";
import type { NoticesForResult } from "../domain/notices-for.js";
import { dateInTz } from "../domain/tz.js";
import { loadToday, type LoadTodayDeps } from "./loaders-today.js";

const viewer: HouseholdMember = {
    householdId: "hh-1",
    userId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    displayName: "Alice",
};

const goals: NutritionGoals = {
    user_id: viewer.userId,
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

function meal(over: Partial<Meal>): Meal {
    return {
        id: over.id ?? "m1",
        user_id: viewer.userId,
        logged_at: over.logged_at ?? "2026-03-03T21:30:00.000Z",
        meal_type: over.meal_type ?? "dinner",
        description: over.description ?? "Dinner",
        calories: over.calories ?? 500,
        protein_g: 40,
        carbs_g: 30,
        fat_g: 20,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        items: over.items,
        ...over,
    };
}

function emptyNotices(): NoticesForResult {
    return {
        notices: [],
        dismissals: [],
        subjectNames: new Map(),
        subjectTimes: new Map(),
        noticeFoods: new Map(),
        catalogFoods: [],
        aliasMap: new Map(),
        barcodedIds: new Set(),
        possibleDuplicatePairs: [],
        recipesListPrefetch: {
            recipes: [],
            allIngredients: [],
            fridgeItems: [],
            foodsById: new Map(),
        },
    };
}

function loggedDatesFromMeals(meals: Meal[], tz: string): string[] {
    return [...new Set(meals.map((m) => dateInTz(m.logged_at, tz)))].sort();
}

function fakeDeps(over: Partial<LoadTodayDeps>): LoadTodayDeps {
    const allMeals: Meal[] = [];
    const tz = "Europe/Kyiv";
    return {
        getProfile: async () => ({
            user_id: viewer.userId,
            timezone: tz,
            theme: null,
            preferred_weight_unit: "kg",
            preferred_drink_unit: null,
            alcohol_tracking_enabled: false,
            widgets_enabled: true,
            nutrition_layout: null,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
        }),
        getMealsByDate: async (_userId, date) =>
            allMeals.filter((m) => dateInTz(m.logged_at, tz) === date),
        getMealsInRangeWithoutItems: async () => allMeals,
        getWaterInRange: async () => [],
        getMealLoggedLocalDatesInRange: async (_u, start, end) =>
            loggedDatesFromMeals(allMeals, tz).filter(
                (d) => d >= start && d <= end,
            ),
        getWaterLoggedLocalDatesInRange: async () => [],
        getGoalsForRange: async () => ({
            defaults: goals,
            forDate: () => goals,
        }),
        getLatestWeight: async () => null,
        getWeightInRange: async () => [],
        loadHouseholdNotices: async () => emptyNotices(),
        householdToday: async () => "2026-03-03",
        todayInTz: () => "2026-03-03",
        listFridgeLocations: async () => [],
        ...over,
    };
}

describe("loadToday", () => {
    test("meal at 23:30 local in UTC+ zone lands on the local calendar day", async () => {
        // 21:30 UTC = 23:30 Europe/Kyiv on 2026-03-03 (standard time, UTC+2)
        const late = meal({
            id: "late",
            logged_at: "2026-03-03T21:30:00.000Z",
            calories: 1980,
        });
        const deps = fakeDeps({
            getMealsByDate: async (_u, date) =>
                date === "2026-03-03" ? [late] : [],
            getMealsInRangeWithoutItems: async () => [late],
        });
        const view = await loadToday(viewer, "2026-03-03", deps);
        expect(view.date).toBe("2026-03-03");
        expect(view.meals).toHaveLength(1);
        expect(view.meals[0]!.rows[0]!.mealId).toBe("late");
        expect(view.week.dots.find((d) => d.date === "2026-03-03")?.state).toBe(
            "hit",
        );
    });

    test("multi-item meal surfaces one grouped row", async () => {
        const combo = meal({
            id: "combo",
            meal_type: "breakfast",
            items: [
                {
                    id: "i1",
                    meal_id: "combo",
                    user_id: viewer.userId,
                    household_id: "hh-1",
                    food_id: "f1",
                    recipe_id: null,
                    label: "Oats",
                    amount: 50,
                    unit: "g",
                    grams: 50,
                    portions: null,
                    calories: 190,
                    protein_g: 7,
                    carbs_g: 34,
                    fat_g: 3,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                    created_at: "2026-03-03T08:00:00.000Z",
                },
                {
                    id: "i2",
                    meal_id: "combo",
                    user_id: viewer.userId,
                    household_id: "hh-1",
                    food_id: "f2",
                    recipe_id: null,
                    label: "Berries",
                    amount: 100,
                    unit: "g",
                    grams: 100,
                    portions: null,
                    calories: 50,
                    protein_g: 1,
                    carbs_g: 12,
                    fat_g: 0,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 1,
                    created_at: "2026-03-03T08:00:00.000Z",
                },
            ],
        });
        const deps = fakeDeps({
            getMealsByDate: async () => [combo],
            getMealsInRangeWithoutItems: async () => [combo],
        });
        const view = await loadToday(viewer, "2026-03-03", deps);
        expect(view.meals[0]!.rows).toHaveLength(1);
        expect(view.meals[0]!.rows[0]!.subtitle).toContain("Oats");
    });

    test("streak counts consecutive logged days ending on household today", async () => {
        const meals = [
            meal({
                id: "d1",
                logged_at: "2026-03-01T10:00:00.000Z",
            }),
            meal({
                id: "d2",
                logged_at: "2026-03-02T10:00:00.000Z",
            }),
            meal({
                id: "d3",
                logged_at: "2026-03-03T10:00:00.000Z",
            }),
        ];
        const deps = fakeDeps({
            getMealsInRangeWithoutItems: async () => meals,
            getMealLoggedLocalDatesInRange: async () => [
                "2026-03-01",
                "2026-03-02",
                "2026-03-03",
            ],
            householdToday: async () => "2026-03-03",
        });
        const view = await loadToday(viewer, "2026-03-03", deps);
        expect(view.streak).toBe(3);
    });

    test("loads yesterday meals only when viewing today", async () => {
        const calls: string[] = [];
        const dinnerYesterday = meal({
            id: "y-dinner",
            meal_type: "dinner",
            description: "Curry",
            calories: 600,
            logged_at: "2026-03-02T19:00:00.000Z",
        });
        const deps = fakeDeps({
            getMealsByDate: async (_u, date) => {
                calls.push(date);
                if (date === "2026-03-03") return [];
                if (date === "2026-03-02") return [dinnerYesterday];
                return [];
            },
            getMealsInRangeWithoutItems: async () => [],
        });
        const view = await loadToday(viewer, "2026-03-03", deps);
        expect(calls).toContain("2026-03-02");
        expect(view.yesterdayCopy.dinner?.label).toBe("Curry");
        expect(view.yesterdayCopy.dinner?.kcal).toBe(600);

        calls.length = 0;
        const past = await loadToday(viewer, "2026-03-01", deps);
        expect(calls).not.toContain("2026-03-02");
        expect(past.yesterdayCopy).toEqual({});
    });

    test("a read-only peer view skips the yesterday query and the hint", async () => {
        const calls: string[] = [];
        const deps = fakeDeps({
            getMealsByDate: async (_u, date) => {
                calls.push(date);
                if (date === "2026-03-02") {
                    return [
                        meal({
                            id: "y-dinner",
                            meal_type: "dinner",
                            description: "Curry",
                            logged_at: "2026-03-02T19:00:00.000Z",
                        }),
                    ];
                }
                return [];
            },
            getMealsInRangeWithoutItems: async () => [],
        });
        const view = await loadToday(viewer, "2026-03-03", deps, {
            readOnly: true,
        });
        expect(calls).not.toContain("2026-03-02");
        expect(view.yesterdayCopy).toEqual({});
    });

    test("streak ends yesterday when today has nothing logged yet", async () => {
        const meals = [
            meal({
                id: "d1",
                logged_at: "2026-03-01T15:00:00.000Z",
            }),
            meal({
                id: "d2",
                logged_at: "2026-03-02T15:00:00.000Z",
            }),
            meal({
                id: "d3",
                logged_at: "2026-03-03T15:00:00.000Z",
            }),
        ];
        const deps = fakeDeps({
            getMealsInRangeWithoutItems: async () => meals,
            getMealLoggedLocalDatesInRange: async () => [
                "2026-03-01",
                "2026-03-02",
                "2026-03-03",
            ],
            todayInTz: () => "2026-03-04",
        });
        const view = await loadToday(viewer, "2026-03-04", deps);
        expect(view.streak).toBe(3);
    });

    test("keeps noticeFoods and profile display flags on the view", async () => {
        const foods = new Map([["f1", { genericFoodId: "g1" }]]);
        const deps = fakeDeps({
            getProfile: async () => ({
                user_id: viewer.userId,
                timezone: "UTC",
                theme: null,
                preferred_weight_unit: "lb",
                preferred_drink_unit: null,
                alcohol_tracking_enabled: true,
                widgets_enabled: true,
                nutrition_layout: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
            }),
            loadHouseholdNotices: async () => ({
                ...emptyNotices(),
                noticeFoods: foods,
            }),
        });
        const view = await loadToday(viewer, "2026-03-03", deps);
        expect(view.attention.noticeFoods).toBe(foods);
        expect(view.preferredWeightUnit).toBe("lb");
        expect(view.alcoholTrackingEnabled).toBe(true);
    });

    test("empty day yields empty dot and no meal groups", async () => {
        const deps = fakeDeps({
            getMealsByDate: async () => [],
            getMealsInRangeWithoutItems: async () => [],
        });
        const view = await loadToday(viewer, "2026-03-03", deps);
        expect(view.meals).toHaveLength(0);
        expect(view.totals.calories).toBeNull();
        expect(view.week.dots.some((d) => d.state === "empty")).toBe(true);
    });
});
