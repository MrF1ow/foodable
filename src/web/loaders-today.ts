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
    activeCalorieGoal,
    buildDailyBuckets,
    loggingStreakFromDates,
} from "../domain/insights.js";
import { listExpiring } from "../domain/stock.js";
import type {
    NoticesForResult,
    RecipesListPrefetch,
} from "../domain/notices-for.js";
import type { Food } from "../domain/foods.js";
import {
    macrosForPerson,
    recipeTotalMinutes,
    type RecipeFilterRow,
} from "../domain/recipes.js";
import {
    recipesUsingExpiring,
    suggestForSlot,
    type ExpiringItem,
    type ExpiringUse,
    type MacrosLeft,
    type SlotSuggestion,
} from "../domain/suggestions.js";
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
    /** Up to two recipes that fit, per empty slot (today view only). */
    slotSuggestions: Partial<Record<MealTypeSlot, SlotSuggestion[]>>;
    /** For each item in `expiringFridge`, the recipes that use it. */
    useSoonUses: ExpiringUse[];
    /** One recipe that uses several of the expiring items, when there is one. */
    useSoonHighlight: UseSoonHighlight | null;
};

export type UseSoonHighlight = {
    recipeId: string;
    name: string;
    /** How many of the expiring items the recipe uses. */
    itemCount: number;
    /** How many items are expiring. */
    totalItems: number;
    minutes: number | null;
    kcalPerPortion: number | null;
};

/** Recipes as the Recipes page reads them, from data already loaded. */
export function recipeRowsFromPrefetch(
    prefetch: RecipesListPrefetch,
): RecipeFilterRow[] {
    const byRecipe = new Map<string, RecipesListPrefetch["allIngredients"]>();
    for (const row of prefetch.allIngredients) {
        const list = byRecipe.get(row.recipeId) ?? [];
        list.push(row);
        byRecipe.set(row.recipeId, list);
    }
    return prefetch.recipes.map((recipe) => {
        const ingredients = byRecipe.get(recipe.id) ?? [];
        return {
            recipe,
            ingredients,
            macrosPerPortion: macrosForPerson(
                ingredients,
                recipe.yieldPortions,
                1,
                prefetch.foodsById,
            ),
        };
    });
}

function stockFromPrefetch(prefetch: RecipesListPrefetch) {
    return prefetch.fridgeItems.map((item) => ({
        quantity: item.quantity,
        foodId: item.foodId,
    }));
}

/** What is left of the day's targets; null when there is no calorie goal. */
export function macrosLeftFor(
    goals: NutritionGoals | null,
    totals: Pick<
        TodayDayTotals,
        "calories" | "protein_g" | "carbs_g" | "fat_g"
    >,
): MacrosLeft | null {
    const calorieGoal = activeCalorieGoal(goals);
    if (calorieGoal == null) return null;
    const left = (goal: number | null | undefined, eaten: number | null) =>
        goal != null && Number.isFinite(goal) && goal > 0
            ? goal - (eaten ?? 0)
            : null;
    return {
        calories: calorieGoal - (totals.calories ?? 0),
        protein_g: left(goals?.daily_protein_g, totals.protein_g),
        carbs_g: left(goals?.daily_carbs_g, totals.carbs_g),
        fat_g: left(goals?.daily_fat_g, totals.fat_g),
    };
}

/** Suggestions for each empty slot, from the recipes the page already loaded. */
export function slotSuggestionsFor(
    prefetch: RecipesListPrefetch,
    opts: {
        emptySlots: readonly MealTypeSlot[];
        macrosLeft: MacrosLeft | null;
        expiring: readonly ExpiringItem[];
    },
): Partial<Record<MealTypeSlot, SlotSuggestion[]>> {
    if (opts.macrosLeft == null || opts.emptySlots.length === 0) return {};
    const recipes = recipeRowsFromPrefetch(prefetch);
    const stock = stockFromPrefetch(prefetch);
    const out: Partial<Record<MealTypeSlot, SlotSuggestion[]>> = {};
    for (const slot of opts.emptySlots) {
        const picked = suggestForSlot({
            slot,
            recipes,
            stock,
            macrosLeft: opts.macrosLeft,
            expiring: opts.expiring,
            foodsById: prefetch.foodsById,
        });
        if (picked.length > 0) out[slot] = picked;
    }
    return out;
}

/** The recipes that use each expiring item, plus the one using the most. */
export function useSoonFor(
    prefetch: RecipesListPrefetch,
    expiring: readonly ExpiringItem[],
): { uses: ExpiringUse[]; highlight: UseSoonHighlight | null } {
    if (expiring.length === 0) return { uses: [], highlight: null };
    const rows = recipeRowsFromPrefetch(prefetch);
    const uses = recipesUsingExpiring(
        rows,
        stockFromPrefetch(prefetch),
        expiring,
        prefetch.foodsById,
    );
    const counts = new Map<string, number>();
    for (const use of uses) {
        for (const recipe of use.recipes) {
            counts.set(recipe.recipeId, (counts.get(recipe.recipeId) ?? 0) + 1);
        }
    }
    let best: { recipeId: string; count: number } | null = null;
    for (const use of uses) {
        for (const recipe of use.recipes) {
            const count = counts.get(recipe.recipeId) ?? 0;
            if (count >= 2 && (best == null || count > best.count)) {
                best = { recipeId: recipe.recipeId, count };
            }
        }
    }
    if (best == null) return { uses, highlight: null };
    const row = rows.find((r) => r.recipe.id === best.recipeId);
    if (!row) return { uses, highlight: null };
    return {
        uses,
        highlight: {
            recipeId: row.recipe.id,
            name: row.recipe.name,
            itemCount: best.count,
            totalItems: uses.length,
            minutes: recipeTotalMinutes(row.recipe),
            kcalPerPortion: row.macrosPerPortion.incomplete
                ? null
                : row.macrosPerPortion.calories,
        },
    };
}

const STREAK_LOOKBACK_DAYS = 400;

const MEAL_SLOTS: readonly MealTypeSlot[] = [
    "breakfast",
    "lunch",
    "dinner",
    "snack",
];

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

    // Suggestions only for the viewer's own today: a past day or a peer's day
    // is not theirs to plan.
    const slotSuggestions = wantsCopyHint
        ? slotSuggestionsFor(noticeResult.recipesListPrefetch, {
              emptySlots: MEAL_SLOTS.filter(
                  (slot) =>
                      !meals.some(
                          (group) =>
                              group.mealType === slot && group.rows.length > 0,
                      ),
              ),
              macrosLeft: macrosLeftFor(goals, totals),
              expiring: expiringFridge,
          })
        : {};
    const useSoon = useSoonFor(
        noticeResult.recipesListPrefetch,
        expiringFridge,
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
        slotSuggestions,
        useSoonUses: useSoon.uses,
        useSoonHighlight: useSoon.highlight,
    };
}
