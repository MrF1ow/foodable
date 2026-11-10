import type { HouseholdMember } from "../household.js";
import {
    getGoalsForRange,
    getLatestWeight,
    getMealsByDate,
    getMealLoggedLocalDatesInRange,
    getMealsInRangeWithoutItems,
    getWaterInRange,
    getWaterLoggedLocalDatesInRange,
    getWeightInRange,
    type NutritionGoals,
    type WaterEntry,
    type WeightEntry,
} from "../db/nutrition.js";
import { getProfile } from "../db/profiles.js";
import { householdToday } from "../db/restock.js";
import {
    buildDailyBuckets,
    loggingStreakFromDates,
} from "../domain/insights.js";
import { listExpiring } from "../domain/stock.js";
import type { NoticesForResult } from "../domain/notices-for.js";
import type { Food } from "../domain/foods.js";
import { needsAttentionCount } from "../domain/notices.js";
import {
    adjacentWeekStarts,
    annotateWeekDays,
    mealRows,
    sundayWeekStart,
    todayDayTotals,
    weekDates,
    weekDayTotalsFromBucket,
    weekDots,
    type MealTypeGroup,
    type TodayDayTotals,
    type WeekDot,
    type WeekStripLayout,
} from "../domain/today.js";
import {
    dateInTz,
    shiftLocalDate,
    todayInTz,
    validateTz,
} from "../domain/tz.js";
import type { WeightUnit } from "../domain/units.js";
import { loadHouseholdNotices } from "./attention.js";
import type { FridgeItem } from "../domain/fridge.js";
import type { Notice } from "../domain/notices.js";

export type TodayWeightPoint = {
    date: string;
    weight_g: number;
};

export type TodayAttention = {
    count: number;
    notices: Notice[];
    noticeFoods: ReadonlyMap<string, Pick<Food, "genericFoodId">>;
};

export type TodayView = {
    date: string;
    timezone: string;
    preferredWeightUnit: WeightUnit;
    alcoholTrackingEnabled: boolean;
    totals: TodayDayTotals;
    goals: NutritionGoals | null;
    meals: MealTypeGroup[];
    week: WeekStripLayout & { dots: WeekDot[] };
    streak: number;
    expiringFridge: FridgeItem[];
    attention: TodayAttention;
    weight: {
        latest: WeightEntry | null;
        series30d: TodayWeightPoint[];
    };
};

const STREAK_LOOKBACK_DAYS = 400;

export type LoadTodayDeps = {
    getProfile: typeof getProfile;
    getMealsByDate: typeof getMealsByDate;
    getMealsInRangeWithoutItems: typeof getMealsInRangeWithoutItems;
    getWaterInRange: typeof getWaterInRange;
    getMealLoggedLocalDatesInRange: typeof getMealLoggedLocalDatesInRange;
    getWaterLoggedLocalDatesInRange: typeof getWaterLoggedLocalDatesInRange;
    getGoalsForRange: typeof getGoalsForRange;
    getLatestWeight: typeof getLatestWeight;
    getWeightInRange: typeof getWeightInRange;
    loadHouseholdNotices: typeof loadHouseholdNotices;
    householdToday: typeof householdToday;
    todayInTz: typeof todayInTz;
};

const defaultTodayDeps = (): LoadTodayDeps => ({
    getProfile,
    getMealsByDate,
    getMealsInRangeWithoutItems,
    getWaterInRange,
    getMealLoggedLocalDatesInRange,
    getWaterLoggedLocalDatesInRange,
    getGoalsForRange,
    getLatestWeight,
    getWeightInRange,
    loadHouseholdNotices,
    householdToday,
    todayInTz,
});

function tzFromProfile(
    profile: Awaited<ReturnType<typeof getProfile>>,
): string {
    const raw = profile?.timezone?.trim();
    return raw && validateTz(raw) ? raw : "UTC";
}

function sumWaterForDate(
    entries: WaterEntry[],
    date: string,
    tz: string,
): number {
    let total = 0;
    for (const e of entries) {
        if (dateInTz(e.logged_at, tz) === date) total += e.amount_ml;
    }
    return total;
}

function weightSeries30d(
    entries: WeightEntry[],
    tz: string,
): TodayWeightPoint[] {
    const daily = new Map<string, { total: number; count: number }>();
    for (const e of entries) {
        const date = dateInTz(e.logged_at, tz);
        const cur = daily.get(date) ?? { total: 0, count: 0 };
        cur.total += e.weight_g;
        cur.count += 1;
        daily.set(date, cur);
    }
    return [...daily.entries()]
        .map(([date, { total, count }]) => ({
            date,
            weight_g: total / count,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
}

async function loggedDatesForStreak(
    userId: string,
    today: string,
    tz: string,
    deps: LoadTodayDeps,
): Promise<Set<string>> {
    const start = shiftLocalDate(today, -STREAK_LOOKBACK_DAYS);
    const [mealDates, waterDates] = await Promise.all([
        deps.getMealLoggedLocalDatesInRange(userId, start, today, tz),
        deps.getWaterLoggedLocalDatesInRange(userId, start, today, tz),
    ]);
    return new Set([...mealDates, ...waterDates]);
}

export async function loadToday(
    viewer: HouseholdMember,
    date?: string,
    deps: LoadTodayDeps = defaultTodayDeps(),
): Promise<TodayView> {
    const profile = await deps.getProfile(viewer.userId);
    const tz = tzFromProfile(profile);
    const today = deps.todayInTz(tz);
    const targetDate = date ?? today;

    const weekStart = sundayWeekStart(targetDate);
    const weekEnd = shiftLocalDate(weekStart, 6);
    const streakLookbackStart = shiftLocalDate(today, -STREAK_LOOKBACK_DAYS);
    const weightStart = shiftLocalDate(today, -29);

    const householdId = viewer.householdId;
    const userId = viewer.userId;

    const householdDate = await deps.householdToday(householdId);

    const [
        dayMeals,
        weekMeals,
        weekWater,
        weekGoals,
        latestWeight,
        weightRange,
        mealLogDates,
        waterLogDates,
        noticeResult,
    ] = await Promise.all([
        deps.getMealsByDate(userId, targetDate, tz),
        deps.getMealsInRangeWithoutItems(userId, weekStart, weekEnd, tz),
        deps.getWaterInRange(userId, weekStart, weekEnd, tz),
        deps.getGoalsForRange(userId, weekStart, weekEnd),
        deps.getLatestWeight(userId),
        deps.getWeightInRange(userId, weightStart, today, tz),
        deps.getMealLoggedLocalDatesInRange(
            userId,
            streakLookbackStart,
            today,
            tz,
        ),
        deps.getWaterLoggedLocalDatesInRange(
            userId,
            streakLookbackStart,
            today,
            tz,
        ),
        deps.loadHouseholdNotices(householdId, { today: householdDate }),
    ]);

    const waterMl = sumWaterForDate(weekWater, targetDate, tz);
    const totals = todayDayTotals(dayMeals, waterMl);
    const meals = mealRows(dayMeals);
    const goals = weekGoals.forDate(targetDate);

    const weekBuckets = buildDailyBuckets(
        weekMeals,
        weekWater,
        weekStart,
        weekEnd,
        tz,
    );
    const weekDayInputs = weekBuckets.map(weekDayTotalsFromBucket);
    const dots = weekDots(weekDayInputs, weekGoals.forDate);
    const bounds = adjacentWeekStarts(weekStart);
    const week = {
        ...annotateWeekDays(weekDates(weekStart), today, targetDate, bounds),
        dots,
    };

    const loggedDates = new Set([...mealLogDates, ...waterLogDates]);
    const streak = loggingStreakFromDates(loggedDates, today);

    const expiringFridge = listExpiring(
        noticeResult.recipesListPrefetch.fridgeItems,
        householdDate,
        3,
    );

    const preferredWeightUnit =
        profile?.preferred_weight_unit === "lb" ? "lb" : "kg";

    return {
        date: targetDate,
        timezone: tz,
        preferredWeightUnit,
        alcoholTrackingEnabled: profile?.alcohol_tracking_enabled === true,
        totals,
        goals,
        meals,
        week,
        streak,
        expiringFridge,
        attention: {
            count: needsAttentionCount(noticeResult.notices),
            notices: [...noticeResult.notices],
            noticeFoods: noticeResult.noticeFoods,
        },
        weight: {
            latest: latestWeight,
            series30d: weightSeries30d(weightRange, tz),
        },
    };
}
