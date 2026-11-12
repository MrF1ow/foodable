import type { Meal } from "../db/nutrition.js";
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
import { liveFridgeStore } from "../db/fridge.js";
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
    yesterdayCopyHints,
    type MealTypeGroup,
    type MealTypeSlot,
    type TodayDayTotals,
    type WeekDot,
    type WeekStripLayout,
    type YesterdayCopyHint,
} from "../domain/today.js";
import { recentHistoryStart } from "../domain/log-search.js";
import {
    dateInTz,
    shiftLocalDate,
    todayInTz,
    validateTz,
} from "../domain/tz.js";
import type { WeightUnit } from "../domain/units.js";
import { loadHouseholdNotices } from "./attention.js";
import type { FridgeItem, FridgeLocation } from "../domain/fridge.js";
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
    /** Household calendar date when the view was built (expiring-soon list). */
    householdDate: string;
    timezone: string;
    fridgeLocationNames: ReadonlyMap<string, string>;
    preferredWeightUnit: WeightUnit;
    alcoholTrackingEnabled: boolean;
    totals: TodayDayTotals;
    goals: NutritionGoals | null;
    /** Full meal rows for the selected day (edit sheets). */
    editMeals: Meal[];
    meals: MealTypeGroup[];
    week: WeekStripLayout & { dots: WeekDot[] };
    streak: number;
    expiringFridge: FridgeItem[];
    attention: TodayAttention;
    weight: {
        latest: WeightEntry | null;
        series30d: TodayWeightPoint[];
    };
    /** Per-slot copy-yesterday hints when today's slot is empty (today view only). */
    yesterdayCopy: Partial<Record<MealTypeSlot, YesterdayCopyHint>>;
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
    listFridgeLocations: (
        householdId: string,
    ) => Promise<readonly FridgeLocation[]>;
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
    listFridgeLocations: (householdId) =>
        liveFridgeStore().listLocations(householdId),
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
    opts: { readOnly?: boolean } = {},
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

    const viewingToday = targetDate === today;
    // A peer's day is read-only: no copy hint, so no yesterday query either.
    const wantsCopyHint = viewingToday && opts.readOnly !== true;
    const yesterdayDate = wantsCopyHint ? recentHistoryStart(today, 1) : null;

    const [
        dayMeals,
        yesterdayMeals,
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
        yesterdayDate
            ? deps.getMealsByDate(userId, yesterdayDate, tz)
            : Promise.resolve([] as Meal[]),
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
    const editMeals = dayMeals;
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

    const fridgeLocations = await deps.listFridgeLocations(householdId);
    const fridgeLocationNames = new Map(
        fridgeLocations.map((loc) => [loc.id, loc.name]),
    );

    const yesterdayCopy = yesterdayCopyHints(
        wantsCopyHint,
        dayMeals,
        yesterdayMeals,
    );

    return {
        date: targetDate,
        householdDate,
        timezone: tz,
        fridgeLocationNames,
        preferredWeightUnit,
        alcoholTrackingEnabled: profile?.alcohol_tracking_enabled === true,
        totals,
        goals,
        editMeals,
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
        yesterdayCopy,
    };
}
