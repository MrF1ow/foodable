import { expect, test } from "bun:test";
import type { NutritionGoals } from "../db/nutrition.js";
import {
    createMemoryGoalDayStore,
    goalDayFromRow,
    goalsForDate,
    goalsResolver,
    type GoalDayOverride,
} from "./insights.js";

const defaults: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2000,
    daily_protein_g: 150,
    daily_carbs_g: 200,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 40,
    daily_alcohol_g: 20,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: 75000,
    updated_at: "2026-01-01T00:00:00Z",
};

function override(
    date: string,
    patch: Partial<GoalDayOverride> = {},
): GoalDayOverride {
    return {
        user_id: "u1",
        date,
        updated_at: patch.updated_at ?? "2026-02-01T00:00:00Z",
        daily_calories: null,
        daily_protein_g: null,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_fiber_g: null,
        daily_sugar_g: null,
        daily_alcohol_g: null,
        daily_caffeine_mg: null,
        daily_water_ml: null,
        ...patch,
    };
}

test("no override returns defaults reference", () => {
    expect(goalsForDate(defaults, [], "2026-06-01")).toBe(defaults);
});

test("null defaults and no override returns null", () => {
    expect(goalsForDate(null, [], "2026-06-01")).toBeNull();
});

test("per-field fallback from defaults", () => {
    const merged = goalsForDate(
        defaults,
        [override("2026-06-01", { daily_calories: 1800 })],
        "2026-06-01",
    );
    expect(merged!.daily_calories).toBe(1800);
    expect(merged!.daily_protein_g).toBe(150);
    expect(merged!.target_weight_g).toBe(75000);
});

test("override with null defaults builds goals without target weight", () => {
    const merged = goalsForDate(
        null,
        [override("2026-06-01", { daily_calories: 1600 })],
        "2026-06-01",
    );
    expect(merged!.user_id).toBe("u1");
    expect(merged!.daily_calories).toBe(1600);
    expect(merged!.target_weight_g).toBeNull();
});

test("all-null override with null defaults returns null", () => {
    expect(
        goalsForDate(null, [override("2026-06-01")], "2026-06-01"),
    ).toBeNull();
});

test("goalsResolver resolves each date separately", () => {
    const forDate = goalsResolver(defaults, [
        override("2026-06-01", { daily_calories: 1600 }),
        override("2026-06-02", { daily_calories: 2200 }),
    ]);
    expect(forDate("2026-06-01")!.daily_calories).toBe(1600);
    expect(forDate("2026-06-03")).toBe(defaults);
});

test("createMemoryGoalDayStore range and isolation", async () => {
    const store = createMemoryGoalDayStore([
        override("2026-06-01", { daily_calories: 1 }),
        override("2026-06-03", { daily_calories: 3 }),
        override("2026-06-02", { user_id: "u2", daily_calories: 9 }),
    ]);
    expect(await store.overrideForDate("u1", "2026-06-01")).toMatchObject({
        daily_calories: 1,
    });
    expect(await store.overrideForDate("u1", "2026-06-02")).toBeNull();
    const range = await store.overridesInRange(
        "u1",
        "2026-06-01",
        "2026-06-03",
    );
    expect(range.map((r) => r.date)).toEqual(["2026-06-01", "2026-06-03"]);
    expect(
        await store.overridesInRange("u1", "2026-05-01", "2026-05-31"),
    ).toEqual([]);
});

test("goalDayFromRow maps numerics and dates", () => {
    const row = goalDayFromRow({
        user_id: "u1",
        date: new Date("2026-08-09T12:00:00Z"),
        updated_at: "2026-08-09T10:00:00Z",
        daily_calories: "2100",
        daily_protein_g: null,
    });
    expect(row.date).toBe("2026-08-09");
    expect(row.daily_calories).toBe(2100);
    expect(row.daily_protein_g).toBeNull();
});
