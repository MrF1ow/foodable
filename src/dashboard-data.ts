import type { DrinkUnit } from "./alcohol.js";
import { buildDailyBuckets, dateDiffDays } from "./domain/insights.js";
import {
    goalsPayloadOf,
    mealBreakdown,
    nutrientPresence,
    rangeAverages,
    sumMeals,
    totalsPayloadOf,
    trendsDayPayloadOf,
} from "./mcp.js";
import {
    getLatestWeight,
    getMealsByDate,
    getMealsInRange,
    getGoalsForDate,
    getGoalsForRange,
    getNutritionGoals,
    getWaterByDate,
    getWaterInRange,
    getWeightInRange,
    type Meal,
} from "./db/nutrition.js";
import {
    getProfile,
    preferredWeightUnitFromProfile,
    timezoneFromProfile,
} from "./db/profiles.js";
import { dateInTz, shiftLocalDate, todayInTz } from "./domain/tz.js";
import { fromGrams } from "./domain/units.js";

export type AlcoholDisplay = DrinkUnit | null;

function tzOf(profile: Awaited<ReturnType<typeof getProfile>>): string {
    return timezoneFromProfile(profile) ?? "UTC";
}

export async function getGoalProgressPayload(
    userId: string,
    alcohol: AlcoholDisplay,
) {
    const profile = await getProfile(userId);
    const tz = tzOf(profile);
    const targetDate = todayInTz(tz);
    const [meals, water, goals, latestWeight] = await Promise.all([
        getMealsByDate(userId, targetDate, tz),
        getWaterByDate(userId, targetDate, tz),
        getGoalsForDate(userId, targetDate),
        getLatestWeight(userId),
    ]);
    const unit = preferredWeightUnitFromProfile(profile) ?? "kg";
    const locale = "en";
    const totals = sumMeals(meals);
    totals.water_ml = water.reduce((n, e) => n + e.amount_ml, 0);
    const present = nutrientPresence(meals);
    return {
        date: targetDate,
        meal_count: meals.length,
        water_entries: water.length,
        drink_unit: alcohol,
        locale,
        goals: goalsPayloadOf(goals, alcohol),
        totals: totalsPayloadOf(totals, alcohol, present.caffeine_mg),
        weight:
            latestWeight || goals?.target_weight_g != null
                ? {
                      current: latestWeight
                          ? fromGrams(latestWeight.weight_g, unit)
                          : null,
                      target:
                          goals?.target_weight_g != null
                              ? fromGrams(goals.target_weight_g, unit)
                              : null,
                      unit,
                      logged_on: latestWeight
                          ? dateInTz(latestWeight.logged_at, tz)
                          : null,
                  }
                : null,
        meals: mealBreakdown(meals, null, alcohol),
    };
}

export async function getNutritionSummaryPayload(
    userId: string,
    alcohol: AlcoholDisplay,
    days: number,
) {
    const profile = await getProfile(userId);
    const tz = tzOf(profile);
    const locale = "en";
    const endDate = todayInTz(tz);
    const startDate = shiftLocalDate(endDate, -(days - 1));
    const daysInRange = Math.max(1, dateDiffDays(startDate, endDate) + 1);
    const [meals, water, { forDate }] = await Promise.all([
        getMealsInRange(userId, startDate, endDate, tz),
        getWaterInRange(userId, startDate, endDate, tz),
        getGoalsForRange(userId, startDate, endDate),
    ]);
    const goalsPayload = goalsPayloadOf(forDate(endDate), alcohol);
    if (meals.length === 0 && water.length === 0) {
        const empty = sumMeals([]);
        return {
            start_date: startDate,
            end_date: endDate,
            logged_days: 0,
            days_in_range: daysInRange,
            drink_unit: alcohol,
            locale,
            goals: goalsPayload,
            averages: totalsPayloadOf(empty, alcohol, false),
            recorded_days: {
                fiber_g: 0,
                sugar_g: 0,
                alcohol_g: alcohol ? 0 : null,
                caffeine_mg: 0,
            },
            days: [],
            meals: [],
        };
    }
    const byDate = new Map<string, Meal[]>();
    for (const meal of meals) {
        const date = dateInTz(meal.logged_at, tz);
        const existing = byDate.get(date) ?? [];
        existing.push(meal);
        byDate.set(date, existing);
    }
    const waterByDate = new Map<string, number>();
    for (const entry of water) {
        const date = dateInTz(entry.logged_at, tz);
        waterByDate.set(date, (waterByDate.get(date) ?? 0) + entry.amount_ml);
        if (!byDate.has(date)) byDate.set(date, []);
    }
    const dayRows: Array<
        ReturnType<typeof totalsPayloadOf> & {
            date: string;
            meal_count: number;
        }
    > = [];
    const perDay: Array<{
        meals: Meal[];
        totals: ReturnType<typeof sumMeals>;
    }> = [];
    for (const [date, dateMeals] of [...byDate.entries()].sort()) {
        const totals = sumMeals(dateMeals);
        totals.water_ml = waterByDate.get(date) ?? 0;
        const present = nutrientPresence(dateMeals);
        dayRows.push({
            date,
            meal_count: dateMeals.length,
            ...totalsPayloadOf(totals, alcohol, present.caffeine_mg),
        });
        perDay.push({ meals: dateMeals, totals });
    }
    const { averages: rawAverages, recordedDays } = rangeAverages(perDay);
    return {
        start_date: startDate,
        end_date: endDate,
        logged_days: dayRows.length,
        days_in_range: daysInRange,
        drink_unit: alcohol,
        locale,
        goals: goalsPayload,
        averages: totalsPayloadOf(
            rawAverages,
            alcohol,
            recordedDays.caffeine_mg > 0,
        ),
        recorded_days: {
            fiber_g: recordedDays.fiber_g,
            sugar_g: recordedDays.sugar_g,
            alcohol_g: alcohol ? recordedDays.alcohol_g : null,
            caffeine_mg: recordedDays.caffeine_mg,
        },
        days: dayRows,
        meals: mealBreakdown(meals, tz, alcohol),
    };
}

export async function getTrendsPayload(
    userId: string,
    alcohol: AlcoholDisplay,
) {
    const profile = await getProfile(userId);
    const tz = tzOf(profile);
    const locale = "en";
    const endDate = todayInTz(tz);
    const startDate = shiftLocalDate(endDate, -29);
    const [meals, water, { forDate }] = await Promise.all([
        getMealsInRange(userId, startDate, endDate, tz),
        getWaterInRange(userId, startDate, endDate, tz),
        getGoalsForRange(userId, startDate, endDate),
    ]);
    const buckets = buildDailyBuckets(meals, water, startDate, endDate, tz);
    return {
        end_date: endDate,
        default_range: 7,
        drink_unit: alcohol,
        locale,
        goals: goalsPayloadOf(forDate(endDate), alcohol),
        days: buckets.map((b) => trendsDayPayloadOf(b, alcohol)),
    };
}

export async function getWeightTrendsPayload(userId: string) {
    const profile = await getProfile(userId);
    const tz = tzOf(profile);
    const unit = preferredWeightUnitFromProfile(profile) ?? "kg";
    const locale = "en";
    const endDate = todayInTz(tz);
    const fetchStart = shiftLocalDate(endDate, -29);
    const [entries, goals] = await Promise.all([
        getWeightInRange(userId, fetchStart, endDate, tz),
        getNutritionGoals(userId),
    ]);
    const targetG = goals?.target_weight_g ?? null;
    const dailyG = new Map<string, { total: number; count: number }>();
    for (const e of entries) {
        const date = dateInTz(e.logged_at, tz);
        const cur = dailyG.get(date) ?? { total: 0, count: 0 };
        cur.total += e.weight_g;
        cur.count += 1;
        dailyG.set(date, cur);
    }
    const days = [...dailyG.entries()]
        .map(([date, { total, count }]) => ({
            date,
            weight: fromGrams(total / count, unit),
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
        end_date: endDate,
        unit,
        target: targetG != null ? fromGrams(targetG, unit) : null,
        default_range: 7,
        locale,
        days,
    };
}
