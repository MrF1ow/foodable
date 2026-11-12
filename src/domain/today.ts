import type { Meal, NutritionGoals } from "../db/nutrition.js";
import type { MealItem } from "../db/nutrition.js";
import { descriptionFromItems, type MealItemSnapshot } from "./meals.js";
import type { GoalsByDate } from "./insights.js";
import {
    activeCalorieGoal,
    dayCarries,
    nonEmpty,
    type DailyBucket,
} from "./insights.js";
import { shiftLocalDate } from "./tz.js";

export const WEEK_DOT_TOLERANCE_KCAL = 120;

export type WeekDotState = "hit" | "off" | "empty";

export type WeekDayTotals = {
    date: string;
    meals: Meal[];
    waterMl: number;
    /** Sum of meal calories (`?? 0`), used only for dot colour vs goal. */
    calories: number;
};

export type WeekDot = {
    date: string;
    state: WeekDotState;
};

export type WeekDayMarker = {
    date: string;
    isToday: boolean;
    isSelected: boolean;
};

export type WeekStripLayout = {
    weekStart: string;
    prevWeekStart: string;
    nextWeekStart: string;
    days: WeekDayMarker[];
};

const MEAL_TYPE_ORDER = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealTypeSlot = (typeof MEAL_TYPE_ORDER)[number];

const KNOWN_MEAL_TYPES = new Set<string>(MEAL_TYPE_ORDER);

export function resolveMealType(mealType: string | null): MealTypeSlot {
    if (mealType && KNOWN_MEAL_TYPES.has(mealType)) {
        return mealType as MealTypeSlot;
    }
    return "snack";
}

function bucketLogged(day: Pick<WeekDayTotals, "meals" | "waterMl">): boolean {
    const bucket: Pick<DailyBucket, "meals" | "waterMl"> = {
        meals: day.meals,
        waterMl: day.waterMl,
    };
    return nonEmpty(bucket as DailyBucket);
}

function sumMealCaloriesForDot(meals: readonly Meal[]): number | null {
    if (meals.length === 0) return null;
    if (meals.every((m) => m.calories == null)) return null;
    let total = 0;
    for (const m of meals) total += m.calories ?? 0;
    return total;
}

export function weekDotState(
    day: Pick<WeekDayTotals, "meals" | "waterMl" | "calories">,
    goals: NutritionGoals | null,
): WeekDotState {
    if (!bucketLogged(day)) return "empty";
    const target = activeCalorieGoal(goals);
    const actual = sumMealCaloriesForDot(day.meals);
    if (target == null || actual == null) return "off";
    const diff = Math.abs(actual - target);
    return diff <= WEEK_DOT_TOLERANCE_KCAL ? "hit" : "off";
}

export function weekDots(
    days: readonly WeekDayTotals[],
    goalsByDay: GoalsByDate,
): WeekDot[] {
    return days.map((day) => ({
        date: day.date,
        state: weekDotState(day, goalsByDay(day.date)),
    }));
}

export function sundayWeekStart(date: string): string {
    const [y, m, d] = date.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    const dow = dt.getUTCDay();
    return shiftLocalDate(date, -dow);
}

export function weekDates(weekStartSunday: string): string[] {
    return Array.from({ length: 7 }, (_, i) =>
        shiftLocalDate(weekStartSunday, i),
    );
}

export function adjacentWeekStarts(weekStartSunday: string): {
    prevWeekStart: string;
    nextWeekStart: string;
} {
    return {
        prevWeekStart: shiftLocalDate(weekStartSunday, -7),
        nextWeekStart: shiftLocalDate(weekStartSunday, 7),
    };
}

export function annotateWeekDays(
    dates: readonly string[],
    today: string,
    selected: string,
    bounds: { prevWeekStart: string; nextWeekStart: string },
): WeekStripLayout {
    const weekStart = dates[0] ?? today;
    return {
        weekStart,
        prevWeekStart: bounds.prevWeekStart,
        nextWeekStart: bounds.nextWeekStart,
        days: dates.map((date) => ({
            date,
            isToday: date === today,
            isSelected: date === selected,
        })),
    };
}

function singleItemInlineMeta(items: MealItem[]): string | null {
    if (items.length !== 1) return null;
    const item = mealItemsSorted(items)[0]!;
    const amount = item.amount;
    const unit = item.unit?.trim() ?? "";
    if (amount == null || !Number.isFinite(amount)) return null;
    const amountText =
        Math.abs(amount - Math.round(amount)) < 1e-6
            ? String(Math.round(amount))
            : String(amount);
    return unit ? `${amountText} ${unit}` : amountText;
}

export type MealRow = {
    mealId: string;
    mealType: MealTypeSlot;
    title: string;
    /** Multi-item item list (fd-row__sub). */
    subtitle: string | null;
    /** Single-item amount + unit inline after the title (fd-row__meta). */
    inlineMeta: string | null;
    loggedAt: string;
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    itemCount: number;
};

export type MealTypeGroup = {
    mealType: MealTypeSlot;
    rows: MealRow[];
    subtotals: {
        calories: number | null;
        protein_g: number | null;
        carbs_g: number | null;
        fat_g: number | null;
    };
};

function nullAwareSum(values: readonly (number | null)[]): number | null {
    if (values.length === 0) return null;
    if (values.every((v) => v == null)) return null;
    let sum = 0;
    for (const v of values) sum += v ?? 0;
    return sum;
}

function mealItemsSorted(items: MealItem[]): MealItem[] {
    return [...items].sort(
        (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
    );
}

function mealItemSnapshots(items: MealItem[]): MealItemSnapshot[] {
    return mealItemsSorted(items).map((item) => ({
        foodId: item.food_id,
        recipeId: item.recipe_id,
        label: item.label,
        amount: item.amount,
        unit: item.unit,
        grams: item.grams,
        portions: item.portions,
        sortOrder: item.sort_order,
        unknown: false,
        calories: item.calories,
        protein_g: item.protein_g,
        carbs_g: item.carbs_g,
        fat_g: item.fat_g,
        fiber_g: item.fiber_g,
        sugar_g: item.sugar_g,
        alcohol_g: item.alcohol_g,
        caffeine_mg: item.caffeine_mg,
    }));
}

function mealItemSubtitle(items: MealItem[]): string | null {
    if (items.length <= 1) return null;
    return descriptionFromItems(mealItemSnapshots(items));
}

function mealTitle(meal: Meal): string {
    return meal.description.trim() || "Meal";
}

function multiItemMealTitle(
    meal: Meal,
    items: MealItem[],
    itemsDescription: string,
): string {
    const desc = meal.description.trim();
    // The stored description may list the items in write order rather than
    // sort order; either way it repeats the subtitle.
    const generated = new Set([
        itemsDescription,
        descriptionFromItems(
            items.map((item) => mealItemSnapshots([item])[0]!),
        ),
    ]);
    if (desc && !generated.has(desc)) return desc;
    const sorted = mealItemsSorted(items);
    const first = sorted[0]!;
    const label = first.label.trim() || "Item";
    if (items.length <= 1) return label;
    return `${label} + ${items.length - 1} more`;
}

export function mealRows(meals: readonly Meal[]): MealTypeGroup[] {
    const byType = new Map<MealTypeSlot, Meal[]>();
    for (const slot of MEAL_TYPE_ORDER) byType.set(slot, []);
    const sorted = [...meals].sort((a, b) =>
        a.logged_at.localeCompare(b.logged_at),
    );
    for (const meal of sorted) {
        const slot = resolveMealType(meal.meal_type);
        byType.get(slot)!.push(meal);
    }
    const groups: MealTypeGroup[] = [];
    for (const mealType of MEAL_TYPE_ORDER) {
        const typeMeals = byType.get(mealType)!;
        if (typeMeals.length === 0) continue;
        const rows: MealRow[] = typeMeals.map((meal) => {
            const items = meal.items ?? [];
            const subtitle = items.length > 1 ? mealItemSubtitle(items) : null;
            const inlineMeta =
                items.length === 1 ? singleItemInlineMeta(items) : null;
            const title =
                items.length > 1
                    ? multiItemMealTitle(
                          meal,
                          items,
                          subtitle ??
                              descriptionFromItems(mealItemSnapshots(items)),
                      )
                    : mealTitle(meal);
            return {
                mealId: meal.id,
                mealType,
                title,
                subtitle,
                inlineMeta,
                loggedAt: meal.logged_at,
                calories: meal.calories,
                protein_g: meal.protein_g,
                carbs_g: meal.carbs_g,
                fat_g: meal.fat_g,
                itemCount: items.length,
            };
        });
        groups.push({
            mealType,
            rows,
            subtotals: {
                calories: nullAwareSum(rows.map((r) => r.calories)),
                protein_g: nullAwareSum(rows.map((r) => r.protein_g)),
                carbs_g: nullAwareSum(rows.map((r) => r.carbs_g)),
                fat_g: nullAwareSum(rows.map((r) => r.fat_g)),
            },
        });
    }
    return groups;
}

export function sumMealCalories(meals: readonly Meal[]): number | null {
    return sumMealCaloriesForDot(meals);
}

export function weekDayTotalsFromBucket(
    bucket: Pick<DailyBucket, "date" | "meals" | "waterMl" | "calories">,
): WeekDayTotals {
    return {
        date: bucket.date,
        meals: bucket.meals,
        waterMl: bucket.waterMl,
        calories: bucket.calories,
    };
}

export type TodayDayTotals = {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
    water_ml: number;
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
};

export type YesterdayCopyHint = {
    label: string;
    kcal: number | null;
};

const YESTERDAY_HINT_LABEL_MAX = 48;

function mealRowTitle(meal: Meal): string {
    for (const group of mealRows([meal])) {
        for (const row of group.rows) {
            if (row.mealId === meal.id) return row.title;
        }
    }
    return meal.description.trim() || "Meal";
}

function shortenYesterdayHintLabel(text: string): string {
    const t = text.trim();
    if (t.length <= YESTERDAY_HINT_LABEL_MAX) return t;
    return `${t.slice(0, YESTERDAY_HINT_LABEL_MAX - 1).trimEnd()}…`;
}

/** One-line label for a copy-yesterday chip (meal titles in the slot, shortened). */
export function yesterdaySlotHintLabel(
    slotMeals: readonly Meal[],
): string | null {
    if (slotMeals.length === 0) return null;
    return shortenYesterdayHintLabel(
        slotMeals.map((meal) => mealRowTitle(meal)).join(" & "),
    );
}

function slotMealsFor(meals: readonly Meal[], slot: MealTypeSlot): Meal[] {
    return meals.filter((meal) => resolveMealType(meal.meal_type) === slot);
}

function todayHasSlot(meals: readonly Meal[], slot: MealTypeSlot): boolean {
    return slotMealsFor(meals, slot).length > 0;
}

/** Copy-yesterday hints for empty slots when viewing the member's today. */
export function yesterdayCopyHints(
    viewingToday: boolean,
    todayMeals: readonly Meal[],
    yesterdayMeals: readonly Meal[],
): Partial<Record<MealTypeSlot, YesterdayCopyHint>> {
    if (!viewingToday) return {};
    const out: Partial<Record<MealTypeSlot, YesterdayCopyHint>> = {};
    for (const slot of MEAL_TYPE_ORDER) {
        if (todayHasSlot(todayMeals, slot)) continue;
        const rows = slotMealsFor(yesterdayMeals, slot);
        const label = yesterdaySlotHintLabel(rows);
        if (!label) continue;
        out[slot] = {
            label,
            kcal: nullAwareSum(rows.map((row) => row.calories)),
        };
    }
    return out;
}

export function todayDayTotals(
    meals: readonly Meal[],
    waterMl: number,
): TodayDayTotals {
    const pick = (field: keyof Meal) =>
        nullAwareSum(meals.map((m) => m[field] as number | null));
    return {
        calories: pick("calories"),
        protein_g: pick("protein_g"),
        carbs_g: pick("carbs_g"),
        fat_g: pick("fat_g"),
        water_ml: waterMl,
        fiber_g: dayCarries([...meals], "fiber_g")
            ? (nullAwareSum(meals.map((m) => m.fiber_g)) ?? 0)
            : null,
        sugar_g: dayCarries([...meals], "sugar_g")
            ? (nullAwareSum(meals.map((m) => m.sugar_g)) ?? 0)
            : null,
        alcohol_g: dayCarries([...meals], "alcohol_g")
            ? (nullAwareSum(meals.map((m) => m.alcohol_g)) ?? 0)
            : null,
        caffeine_mg: dayCarries([...meals], "caffeine_mg")
            ? (nullAwareSum(meals.map((m) => m.caffeine_mg)) ?? 0)
            : null,
    };
}
