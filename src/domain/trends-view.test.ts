import { test, expect } from "bun:test";
import { currentStreak, goalsResolver, longestStreak } from "./insights.js";
import type { NutritionGoals } from "../db/nutrition.js";
import {
    trendsView,
    type TrendsDay,
    type TrendsWeightInput,
} from "./trends-view.js";

function day(
    date: string,
    opts: Partial<TrendsDay> & { logged?: boolean } = {},
): TrendsDay {
    const logged = opts.logged ?? true;
    return {
        date,
        calories: opts.calories ?? (logged ? 2000 : 0),
        protein_g: opts.protein_g ?? (logged ? 100 : 0),
        carbs_g: opts.carbs_g ?? (logged ? 200 : 0),
        fat_g: opts.fat_g ?? (logged ? 70 : 0),
        logged,
    };
}

const baseGoals: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2000,
    daily_protein_g: 150,
    daily_carbs_g: 250,
    daily_fat_g: 65,
    daily_fiber_g: 30,
    daily_sugar_g: 50,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

function view(
    days: TrendsDay[],
    today: string,
    range: 7 | 30 | 90 | 365 = 7,
    goals = goalsResolver(baseGoals, []),
    weights: TrendsWeightInput[] = [],
    month = { year: 2026, month: 8 },
) {
    return trendsView(days, goals, weights, range, "kg", month, today);
}

test("calorie bar: 120 kcal from goal is near, 121 is off", () => {
    const today = "2026-08-10";
    const withOff = [
        day("2026-08-08", { logged: false }),
        day("2026-08-09", { calories: 2000 }),
        day("2026-08-10", { calories: 2120 }),
    ];
    const vNear = view(withOff, today, 7);
    expect(vNear.bars.find((b) => b.date === "2026-08-10")?.status).toBe(
        "near",
    );

    const with121 = [
        day("2026-08-08", { logged: false }),
        day("2026-08-09", { calories: 2000 }),
        day("2026-08-10", { calories: 2121 }),
    ];
    const vOff = view(with121, today, 7);
    expect(vOff.bars.find((b) => b.date === "2026-08-10")?.status).toBe("off");
});

test("per-day calorie goal changes bar status", () => {
    const today = "2026-08-12";
    const goals = goalsResolver(baseGoals, [
        {
            user_id: "u1",
            date: "2026-08-12",
            updated_at: "x",
            daily_calories: 1700,
            daily_protein_g: null,
            daily_carbs_g: null,
            daily_fat_g: null,
            daily_fiber_g: null,
            daily_sugar_g: null,
            daily_alcohol_g: null,
            daily_caffeine_mg: null,
            daily_water_ml: null,
        },
    ]);
    const kcal = 1880;
    const days = [
        day("2026-08-11", { calories: kcal }),
        day("2026-08-12", { calories: kcal }),
    ];
    const v = view(days, today, 7, goals);
    expect(v.bars.find((b) => b.date === "2026-08-11")?.status).toBe("near");
    expect(v.bars.find((b) => b.date === "2026-08-12")?.status).toBe("off");
});

test("day with no calorie goal shows logged bar status", () => {
    const today = "2026-08-10";
    const goals = goalsResolver(null, []);
    const days = [day("2026-08-10", { calories: 1800 })];
    const v = view(days, today, 7, goals);
    expect(v.bars.find((b) => b.date === today)?.status).toBe("logged");
});

test("streaks: gap resets current, longest keeps earlier run", () => {
    const today = "2026-08-10";
    const days = [
        day("2026-08-04", { logged: true }),
        day("2026-08-05", { logged: true }),
        day("2026-08-06", { logged: true }),
        day("2026-08-07", { logged: false }),
        day("2026-08-08", { logged: true }),
        day("2026-08-09", { logged: true }),
        day("2026-08-10", { logged: true }),
    ];
    const v = view(days, today, 7);
    expect(v.tiles.currentStreak).toBe(3);
    expect(v.tiles.longestStreak).toBe(3);
    expect(longestStreak(days, (d) => d.logged)).toBe(3);
    expect(currentStreak(days, (d) => d.logged)).toBe(3);
});

test("dense range: missing calendar day breaks streaks and fills bars", () => {
    const today = "2026-08-10";
    const days = [
        day("2026-08-04"),
        day("2026-08-05"),
        day("2026-08-06"),
        day("2026-08-08"),
        day("2026-08-09"),
        day("2026-08-10"),
    ];
    const v = view(days, today, 7);
    expect(v.bars).toHaveLength(7);
    expect(v.bars.find((b) => b.date === "2026-08-07")?.status).toBe("empty");
    expect(v.tiles.currentStreak).toBe(3);
    expect(v.tiles.longestStreak).toBe(3);
});

test("dense range: 30-day window with two logged rows still has 30 bars", () => {
    const today = "2026-08-10";
    const days = [day("2026-08-09"), day("2026-08-10")];
    const v = view(days, today, 30);
    expect(v.bars).toHaveLength(30);
    expect(v.rangeStart).toBe("2026-07-12");
    expect(v.rangeEnd).toBe(today);
});

test("dense range: omitted today row counts as empty; streak 0", () => {
    const today = "2026-08-10";
    const v = view([day("2026-08-08"), day("2026-08-09")], today, 7);
    expect(v.bars).toHaveLength(7);
    expect(v.bars[v.bars.length - 1]!.date).toBe(today);
    expect(v.bars[v.bars.length - 1]!.status).toBe("empty");
    expect(v.tiles.currentStreak).toBe(0);
});

test("dense range: input order does not change bars or streak", () => {
    const today = "2026-08-10";
    const forward = [
        day("2026-08-10", { logged: false }),
        day("2026-08-09"),
        day("2026-08-08"),
    ];
    const reversed = [...forward].reverse();
    const vf = view(forward, today, 7, goalsResolver(baseGoals, []), [
        { date: "2026-08-08", weight_g: 80000 },
        { date: "2026-08-10", weight_g: 79000 },
    ]);
    const vr = view(reversed, today, 7, goalsResolver(baseGoals, []), [
        { date: "2026-08-08", weight_g: 80000 },
        { date: "2026-08-10", weight_g: 79000 },
    ]);
    expect(vr.tiles.currentStreak).toBe(vf.tiles.currentStreak);
    expect(vr.bars.map((b) => b.date)).toEqual(vf.bars.map((b) => b.date));
    expect(vr.weight.points.map((p) => p.date).sort()).toEqual(
        vf.weight.points.map((p) => p.date).sort(),
    );
    expect(vf.tiles.currentStreak).toBe(0);
    expect(vf.weight.points.map((p) => p.date)).toEqual([
        "2026-08-08",
        "2026-08-10",
    ]);
});

test("current streak uses full calendar through today, not range slice", () => {
    const today = "2026-08-10";
    const run: TrendsDay[] = [];
    for (let i = 14; i >= 0; i--) {
        const d = new Date(Date.UTC(2026, 7, 10 - i));
        run.push(day(d.toISOString().slice(0, 10)));
    }
    expect(view(run, today, 7).tiles.currentStreak).toBe(15);
    expect(view(run, today, 30).tiles.currentStreak).toBe(15);
});

test("longest streak is per range; can exceed current after a gap", () => {
    const today = "2026-08-10";
    const days = [
        day("2026-08-01"),
        day("2026-08-02"),
        day("2026-08-03"),
        day("2026-08-04"),
        day("2026-08-05"),
        day("2026-08-06", { logged: false }),
        day("2026-08-07"),
        day("2026-08-08"),
        day("2026-08-09"),
        day("2026-08-10"),
    ];
    const v30 = view(days, today, 30);
    expect(v30.tiles.longestStreak).toBe(5);
    expect(v30.tiles.currentStreak).toBe(4);
});

test("averages vs goals pair only logged days that have an active goal", () => {
    const today = "2026-08-10";
    const goals = goalsResolver(null, [
        {
            user_id: "u1",
            date: "2026-08-09",
            updated_at: "x",
            daily_calories: 2000,
            daily_protein_g: 100,
            daily_carbs_g: 200,
            daily_fat_g: 70,
            daily_fiber_g: null,
            daily_sugar_g: null,
            daily_alcohol_g: null,
            daily_caffeine_mg: null,
            daily_water_ml: null,
        },
    ]);
    const days = [
        day("2026-08-09", { calories: 2000, protein_g: 100 }),
        day("2026-08-10", { calories: 4000, protein_g: 0 }),
    ];
    const v = view(days, today, 7, goals);
    expect(v.tiles.avgKcal).toBe(3000);
    expect(v.averagesVsGoals.calories.actual).toBe(2000);
    expect(v.averagesVsGoals.calories.goal).toBe(2000);
    expect(v.averagesVsGoals.calories.ratio).toBe(1);
});

test("weight change from grams once, rounded to one decimal", () => {
    const today = "2026-08-10";
    const days = [day("2026-08-09"), day("2026-08-10")];
    const dust = view(days, today, 7, goalsResolver(baseGoals, []), [
        { date: "2026-08-09", weight_g: 80100 },
        { date: "2026-08-10", weight_g: 79200 },
    ]);
    expect(dust.weight.change).toBe(-0.9);
    const gap = view(
        [day("2026-08-10")],
        today,
        7,
        goalsResolver(baseGoals, []),
        [
            { date: "2026-08-08", weight_g: 80000 },
            { date: "2026-08-10", weight_g: 79000 },
        ],
    );
    expect(gap.weight.points.map((p) => p.date)).toEqual([
        "2026-08-08",
        "2026-08-10",
    ]);
});

test("range slices last 7/30/90/365 days ending today", () => {
    const today = "2026-12-31";
    const days: TrendsDay[] = [];
    for (let i = 364; i >= 0; i--) {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        days.push(day(date, { logged: i % 3 !== 0 }));
    }
    expect(view(days, today, 7).bars).toHaveLength(7);
    expect(view(days, today, 30).bars).toHaveLength(30);
    expect(view(days, today, 90).bars).toHaveLength(90);
    expect(view(days, today, 365).bars).toHaveLength(365);
    expect(view(days, today, 7).rangeStart).toBe("2026-12-25");
    expect(view(days, today, 7).rangeEnd).toBe(today);
});

test("month grid: February 2026 starts Sunday; August 2026 starts Saturday", () => {
    const today = "2026-08-15";
    const days = [day("2026-02-01"), day("2026-08-01")];
    const feb = view(days, today, 7, goalsResolver(baseGoals, []), [], {
        year: 2026,
        month: 2,
    }).monthGrid;
    expect(feb.weeks[0]![0]!.date).toBe("2026-02-01");
    expect(feb.weeks[0]![0]!.status).not.toBe("outside-month");
    expect(feb.weeks[0]).toHaveLength(7);

    const aug = view(days, today, 7, goalsResolver(baseGoals, []), [], {
        year: 2026,
        month: 8,
    }).monthGrid;
    expect(new Date(`${aug.weeks[0]![0]!.date}T00:00:00Z`).getUTCDay()).toBe(0);
    expect(aug.weeks[0]![0]!.status).toBe("outside-month");
    expect(aug.weeks[0]![6]!.date).toBe("2026-08-01");
    expect(aug.prev).toEqual({ year: 2026, month: 7 });
    expect(aug.next).toEqual({ year: 2026, month: 9 });
});

test("weight change is null with 0 or 1 point, set with 2+", () => {
    const today = "2026-08-10";
    const days = [day("2026-08-09"), day("2026-08-10")];
    const none = view(days, today, 7, goalsResolver(baseGoals, []), []);
    expect(none.weight.change).toBeNull();
    expect(none.weight.latest).toBeNull();

    const one = view(days, today, 7, goalsResolver(baseGoals, []), [
        { date: "2026-08-10", weight_g: 80000 },
    ]);
    expect(one.weight.points).toHaveLength(1);
    expect(one.weight.change).toBeNull();
    expect(one.weight.latest).toBe(80);

    const two = view(days, today, 7, goalsResolver(baseGoals, []), [
        { date: "2026-08-09", weight_g: 80000 },
        { date: "2026-08-10", weight_g: 79000 },
    ]);
    expect(two.weight.change).toBe(-1);
    expect(two.weight.axisMin).not.toBeNull();
    expect(two.weight.axisMax).not.toBeNull();
});

test("tile averages ignore empty days", () => {
    const today = "2026-08-10";
    const days = [
        day("2026-08-09", { calories: 1000, protein_g: 50, logged: true }),
        day("2026-08-10", { calories: 0, protein_g: 0, logged: false }),
    ];
    const v = view(days, today, 7);
    expect(v.tiles.avgKcal).toBe(1000);
    expect(v.tiles.avgProtein).toBe(50);
    expect(v.tiles.loggedDays).toBe(1);
});
