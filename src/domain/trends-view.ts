import {
    activeCalorieGoal,
    currentStreak,
    longestStreak,
    type DailyBucket,
    type GoalsByDate,
    nonEmpty,
} from "./insights.js";
import { macroRings, type MacroKey } from "./geometry.js";
import { fromGrams, type WeightUnit } from "./units.js";
import type { NutritionGoals } from "../db/nutrition.js";

/** One calendar day in the user's timezone — maps from `buildDailyBuckets` /
 * `trendsDayPayloadOf` day rows (totals plus a `logged` flag). */
export type TrendsDay = {
    date: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    logged: boolean;
};

export function trendsDayFromBucket(bucket: DailyBucket): TrendsDay {
    return {
        date: bucket.date,
        calories: bucket.calories,
        protein_g: bucket.protein_g,
        carbs_g: bucket.carbs_g,
        fat_g: bucket.fat_g,
        logged: nonEmpty(bucket),
    };
}

export type TrendsRange = 7 | 30 | 90 | 365;

export type CalorieBarStatus = "near" | "off" | "logged" | "empty";

export type TrendsTiles = {
    avgKcal: number | null;
    avgProtein: number | null;
    loggedDays: number;
    currentStreak: number;
    longestStreak: number;
};

export type TrendsDayRing = {
    date: string;
    rings: ReturnType<typeof macroRings>;
};

export type MacroAverageVsGoal = {
    actual: number | null;
    goal: number | null;
    ratio: number | null;
};

export type TrendsAveragesVsGoals = Record<MacroKey, MacroAverageVsGoal> & {
    calories: MacroAverageVsGoal;
};

export type TrendsCalorieBar = {
    date: string;
    calories: number;
    goal: number | null;
    status: CalorieBarStatus;
};

export type MonthCellStatus =
    "on-target" | "logged" | "empty" | "outside-month";

export type MonthGridCell = {
    date: string;
    status: MonthCellStatus;
};

export type MonthGrid = {
    year: number;
    month: number;
    prev: { year: number; month: number };
    next: { year: number; month: number };
    weeks: MonthGridCell[][];
};

export type TrendsWeightPoint = {
    date: string;
    value: number;
};

export type TrendsWeightSeries = {
    points: TrendsWeightPoint[];
    latest: number | null;
    change: number | null;
    axisMin: number | null;
    axisMax: number | null;
    unit: WeightUnit;
};

export type TrendsView = {
    range: TrendsRange;
    rangeStart: string;
    rangeEnd: string;
    tiles: TrendsTiles;
    rings: TrendsDayRing[];
    averagesVsGoals: TrendsAveragesVsGoals;
    bars: TrendsCalorieBar[];
    monthGrid: MonthGrid;
    weight: TrendsWeightSeries;
};

export type TrendsWeightInput = {
    date: string;
    weight_g: number;
};

const KCAL_NEAR_BAND = 120;

function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function mean(values: number[]): number | null {
    if (values.length === 0) return null;
    let sum = 0;
    for (const v of values) sum += v;
    return sum / values.length;
}

function activeMacroGoal(
    goals: NutritionGoals | null,
    field:
        `${MacroKey}_g` | "daily_protein_g" | "daily_carbs_g" | "daily_fat_g",
): number | null {
    const key =
        field === "protein_g" || field === "daily_protein_g"
            ? "daily_protein_g"
            : field === "carbs_g" || field === "daily_carbs_g"
              ? "daily_carbs_g"
              : "daily_fat_g";
    const g = goals?.[key];
    if (g == null || !Number.isFinite(g) || g <= 0) return null;
    return g;
}

function calorieBarStatus(
    day: TrendsDay,
    goal: number | null,
): CalorieBarStatus {
    if (!day.logged) return "empty";
    if (goal == null) return "logged";
    const diff = Math.abs(day.calories - goal);
    if (diff <= KCAL_NEAR_BAND) return "near";
    return "off";
}

function monthCellStatus(
    day: TrendsDay | undefined,
    goal: number | null,
    inMonth: boolean,
): MonthCellStatus {
    if (!inMonth) return "outside-month";
    if (!day?.logged) return "empty";
    if (goal == null) return "logged";
    const diff = Math.abs(day.calories - goal);
    if (diff <= KCAL_NEAR_BAND) return "on-target";
    return "logged";
}

function shiftMonth(
    year: number,
    month: number,
    delta: number,
): {
    year: number;
    month: number;
} {
    let m = month + delta;
    let y = year;
    while (m < 1) {
        m += 12;
        y -= 1;
    }
    while (m > 12) {
        m -= 12;
        y += 1;
    }
    return { year: y, month: m };
}

function daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Week rows start on Sunday (same as `insights` day-of-week labels and household weekday pickers). */
function buildMonthGrid(
    days: readonly TrendsDay[],
    goalsByDay: GoalsByDate,
    year: number,
    month: number,
): MonthGrid {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const firstDom = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const dim = daysInMonth(year, month);
    const cells: MonthGridCell[] = [];

    for (let i = 0; i < firstDom; i++) {
        const date = addDays(
            `${year}-${String(month).padStart(2, "0")}-01`,
            -firstDom + i,
        );
        cells.push({
            date,
            status: monthCellStatus(
                byDate.get(date),
                activeCalorieGoal(goalsByDay(date)),
                false,
            ),
        });
    }

    for (let d = 1; d <= dim; d++) {
        const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        const day = byDate.get(date);
        cells.push({
            date,
            status: monthCellStatus(
                day,
                activeCalorieGoal(goalsByDay(date)),
                true,
            ),
        });
    }

    while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1]!.date;
        const date = addDays(last, 1);
        cells.push({
            date,
            status: monthCellStatus(
                byDate.get(date),
                activeCalorieGoal(goalsByDay(date)),
                false,
            ),
        });
    }

    const weeks: MonthGridCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
        weeks.push(cells.slice(i, i + 7));
    }

    return {
        year,
        month,
        prev: shiftMonth(year, month, -1),
        next: shiftMonth(year, month, 1),
        weeks,
    };
}

function emptyTrendsDay(date: string): TrendsDay {
    return {
        date,
        calories: 0,
        protein_g: 0,
        carbs_g: 0,
        fat_g: 0,
        logged: false,
    };
}

function daysByDate(days: readonly TrendsDay[]): Map<string, TrendsDay> {
    const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
    const map = new Map<string, TrendsDay>();
    for (const d of sorted) map.set(d.date, d);
    return map;
}

/** Exactly `range` calendar days ending at `today`, dense; missing input dates are empty. */
function sliceRange(
    days: readonly TrendsDay[],
    today: string,
    range: TrendsRange,
): TrendsDay[] {
    const byDate = daysByDate(days);
    const start = addDays(today, -(range - 1));
    const out: TrendsDay[] = [];
    for (let i = 0; i < range; i++) {
        const date = addDays(start, i);
        out.push(byDate.get(date) ?? emptyTrendsDay(date));
    }
    return out;
}

function denseCalendar(
    byDate: Map<string, TrendsDay>,
    from: string,
    to: string,
): TrendsDay[] {
    const out: TrendsDay[] = [];
    let date = from;
    while (date <= to) {
        out.push(byDate.get(date) ?? emptyTrendsDay(date));
        date = addDays(date, 1);
    }
    return out;
}

function weightAxisBounds(values: number[]): {
    min: number;
    max: number;
} | null {
    if (values.length === 0) return null;
    let lo = Math.min(...values);
    let hi = Math.max(...values);
    if (hi === lo) {
        hi = lo + 1;
        lo = lo - 1;
    }
    const pad = (hi - lo) * 0.18;
    return { min: lo - pad, max: hi + pad };
}

function buildWeightSeries(
    weights: readonly TrendsWeightInput[],
    rangeDays: readonly TrendsDay[],
    unit: WeightUnit,
): TrendsWeightSeries {
    if (rangeDays.length === 0) {
        return {
            points: [],
            latest: null,
            change: null,
            axisMin: null,
            axisMax: null,
            unit,
        };
    }
    const start = rangeDays[0]!.date;
    const end = rangeDays[rangeDays.length - 1]!.date;
    const daily = new Map<string, { total: number; count: number }>();
    for (const w of weights) {
        if (w.date < start || w.date > end) continue;
        const cur = daily.get(w.date) ?? { total: 0, count: 0 };
        cur.total += w.weight_g;
        cur.count += 1;
        daily.set(w.date, cur);
    }
    const entries = [...daily.entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
    );
    const points = entries.map(([date, { total, count }]) => ({
        date,
        value: fromGrams(total / count, unit),
    }));

    const values = points.map((p) => p.value);
    const axis = weightAxisBounds(values);
    const latest = points.length > 0 ? points[points.length - 1]!.value : null;
    const change =
        entries.length >= 2
            ? fromGrams(
                  entries[entries.length - 1]![1].total /
                      entries[entries.length - 1]![1].count -
                      entries[0]![1].total / entries[0]![1].count,
                  unit,
              )
            : null;

    return {
        points,
        latest,
        change,
        axisMin: axis?.min ?? null,
        axisMax: axis?.max ?? null,
        unit,
    };
}

function buildAveragesVsGoals(
    rangeDays: readonly TrendsDay[],
    goalsByDay: GoalsByDate,
): TrendsAveragesVsGoals {
    const logged = rangeDays.filter((d) => d.logged);
    const macroFields: Array<{
        key: MacroKey | "calories";
        actual: (d: TrendsDay) => number;
        goal: (g: NutritionGoals | null) => number | null;
    }> = [
        {
            key: "calories",
            actual: (d) => d.calories,
            goal: (g) => activeCalorieGoal(g),
        },
        {
            key: "protein",
            actual: (d) => d.protein_g,
            goal: (g) => activeMacroGoal(g, "daily_protein_g"),
        },
        {
            key: "carbs",
            actual: (d) => d.carbs_g,
            goal: (g) => activeMacroGoal(g, "daily_carbs_g"),
        },
        {
            key: "fat",
            actual: (d) => d.fat_g,
            goal: (g) => activeMacroGoal(g, "daily_fat_g"),
        },
    ];

    const out = {} as TrendsAveragesVsGoals;
    for (const { key, actual, goal } of macroFields) {
        // Compare like with like: tile averages still use all logged days; goal
        // comparison means only days that had a target that day.
        const paired = logged.filter((d) => goal(goalsByDay(d.date)) != null);
        const actuals = paired.map(actual);
        const goals = paired.map((d) => goal(goalsByDay(d.date))!);
        const avgActual = mean(actuals);
        const avgGoal = mean(goals);
        const ratio =
            avgActual != null && avgGoal != null && avgGoal > 0
                ? avgActual / avgGoal
                : null;
        if (key === "calories") {
            out.calories = {
                actual: avgActual,
                goal: avgGoal,
                ratio,
            };
        } else {
            out[key] = { actual: avgActual, goal: avgGoal, ratio };
        }
    }
    return out;
}

/**
 * Pure view model for the household Trends page. The visible range is a dense
 * calendar of `range` days ending at `today`. `currentStreak` runs over every
 * calendar day from the earliest input date through `today` (same rule as
 * `computeTrends` on dense buckets); `longestStreak` is computed only inside
 * the visible range.
 */
export function trendsView(
    days: readonly TrendsDay[],
    goalsByDay: GoalsByDate,
    weights: readonly TrendsWeightInput[],
    range: TrendsRange,
    weightUnit: WeightUnit,
    month: { year: number; month: number },
    today: string,
): TrendsView {
    const byDate = daysByDate(days);
    const rangeDays = sliceRange(days, today, range);
    const logged = rangeDays.filter((d) => d.logged);
    const isLogged = (d: TrendsDay) => d.logged;

    let streakFrom = today;
    for (const d of byDate.keys()) {
        if (d < streakFrom) streakFrom = d;
    }
    const streakDays = denseCalendar(byDate, streakFrom, today);

    const tiles: TrendsTiles = {
        avgKcal: mean(logged.map((d) => d.calories)),
        avgProtein: mean(logged.map((d) => d.protein_g)),
        loggedDays: logged.length,
        currentStreak: currentStreak(streakDays, isLogged),
        longestStreak: longestStreak(rangeDays, isLogged),
    };

    const rings: TrendsDayRing[] = rangeDays.map((day) => {
        const g = goalsByDay(day.date);
        return {
            date: day.date,
            rings: macroRings({
                protein: {
                    value: day.protein_g,
                    goal: activeMacroGoal(g, "daily_protein_g"),
                },
                carbs: {
                    value: day.carbs_g,
                    goal: activeMacroGoal(g, "daily_carbs_g"),
                },
                fat: {
                    value: day.fat_g,
                    goal: activeMacroGoal(g, "daily_fat_g"),
                },
            }),
        };
    });

    const bars: TrendsCalorieBar[] = rangeDays.map((day) => {
        const goal = activeCalorieGoal(goalsByDay(day.date));
        return {
            date: day.date,
            calories: day.calories,
            goal,
            status: calorieBarStatus(day, goal),
        };
    });

    return {
        range,
        rangeStart: rangeDays[0]?.date ?? today,
        rangeEnd: rangeDays[rangeDays.length - 1]?.date ?? today,
        tiles,
        rings,
        averagesVsGoals: buildAveragesVsGoals(rangeDays, goalsByDay),
        bars,
        monthGrid: buildMonthGrid(days, goalsByDay, month.year, month.month),
        weight: buildWeightSeries(weights, rangeDays, weightUnit),
    };
}
