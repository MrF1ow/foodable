import type { Meal, MealItem } from "../db/nutrition.js";

export function todayEditSheetId(mealId: string): string {
    return `fd-edit-meal-${mealId}`;
}

export type EditItemQuantity = {
    value: number;
    unit: string;
    mode: "portions" | "amount";
};

/** Stepper display value and unit for a meal_items row. */
export function editItemQuantity(item: MealItem): EditItemQuantity {
    if (item.recipe_id != null) {
        const portions = item.portions ?? 1;
        return { value: portions, unit: "portion(s)", mode: "portions" };
    }
    const amount = item.amount ?? 1;
    const unit = item.unit?.trim() || "g";
    return { value: amount, unit, mode: "amount" };
}

export function submittedItemAmountsUnchanged(
    items: readonly MealItem[],
    submitted: ReadonlyMap<string, number>,
): boolean {
    if (items.length !== submitted.size) return false;
    for (const item of items) {
        const expected = editItemQuantity(item).value;
        const got = submitted.get(item.id);
        if (got == null || got !== expected) return false;
    }
    return true;
}

export function mealLocalTimeValue(
    loggedAt: string,
    _day: string,
    tz: string,
): string {
    const d = new Date(loggedAt);
    const fmt = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
    });
    const parts = fmt.formatToParts(d);
    let hour = "00";
    let minute = "00";
    for (const p of parts) {
        if (p.type === "hour") hour = p.value;
        if (p.type === "minute") minute = p.value;
    }
    return `${hour}:${minute}`;
}

/** Wall time on `day` in the member's zone, for resolveWriteTimestamp. */
export function mealLoggedAtFromLocalTime(
    day: string,
    time: string,
    tz: string,
): string {
    const trimmed = time.trim();
    const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
    if (!m) throw new Error("Enter a valid time.");
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour > 23 || minute > 59) throw new Error("Enter a valid time.");
    const h = String(hour).padStart(2, "0");
    const min = String(minute).padStart(2, "0");
    return `${day}T${h}:${min}:00`;
}

export type MacroTileValues = {
    calories: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
};

function scaleNullable(value: number | null, factor: number): number | null {
    if (value == null || !Number.isFinite(value)) return null;
    return value * factor;
}

/** Free-text meal: scale stored totals by servings (1 = as logged). */
export function scaleMealTotals(
    meal: Pick<
        Meal,
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
    >,
    servings: number,
): MacroTileValues & {
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
} {
    if (!Number.isFinite(servings) || servings <= 0) {
        throw new Error("Enter servings greater than zero.");
    }
    return {
        calories:
            meal.calories == null ? null : Math.round(meal.calories * servings),
        protein_g: scaleNullable(meal.protein_g, servings),
        carbs_g: scaleNullable(meal.carbs_g, servings),
        fat_g: scaleNullable(meal.fat_g, servings),
        fiber_g: scaleNullable(meal.fiber_g, servings),
        sugar_g: scaleNullable(meal.sugar_g, servings),
        alcohol_g: scaleNullable(meal.alcohol_g, servings),
        caffeine_mg: scaleNullable(meal.caffeine_mg, servings),
    };
}

export function itemMacrosAtAmount(
    item: Pick<
        MealItem,
        | "amount"
        | "portions"
        | "recipe_id"
        | "calories"
        | "protein_g"
        | "carbs_g"
        | "fat_g"
        | "fiber_g"
        | "sugar_g"
        | "alcohol_g"
        | "caffeine_mg"
    >,
    amount: number,
): MacroTileValues & {
    fiber_g: number | null;
    sugar_g: number | null;
    alcohol_g: number | null;
    caffeine_mg: number | null;
} {
    const base = item.recipe_id != null ? item.portions : item.amount;
    if (base == null || !Number.isFinite(base) || base <= 0) {
        return {
            calories: item.calories,
            protein_g: item.protein_g,
            carbs_g: item.carbs_g,
            fat_g: item.fat_g,
            fiber_g: item.fiber_g,
            sugar_g: item.sugar_g,
            alcohol_g: item.alcohol_g,
            caffeine_mg: item.caffeine_mg,
        };
    }
    const factor = amount / base;
    return {
        calories:
            item.calories == null ? null : Math.round(item.calories * factor),
        protein_g: scaleNullable(item.protein_g, factor),
        carbs_g: scaleNullable(item.carbs_g, factor),
        fat_g: scaleNullable(item.fat_g, factor),
        fiber_g: scaleNullable(item.fiber_g, factor),
        sugar_g: scaleNullable(item.sugar_g, factor),
        alcohol_g: scaleNullable(item.alcohol_g, factor),
        caffeine_mg: scaleNullable(item.caffeine_mg, factor),
    };
}

export function sumMacroTiles(
    parts: readonly MacroTileValues[],
): MacroTileValues {
    let calories = 0;
    let calKnown = false;
    let protein = 0;
    let proteinKnown = false;
    let carbs = 0;
    let carbsKnown = false;
    let fat = 0;
    let fatKnown = false;
    for (const p of parts) {
        if (p.calories != null) {
            calories += p.calories;
            calKnown = true;
        }
        if (p.protein_g != null) {
            protein += p.protein_g;
            proteinKnown = true;
        }
        if (p.carbs_g != null) {
            carbs += p.carbs_g;
            carbsKnown = true;
        }
        if (p.fat_g != null) {
            fat += p.fat_g;
            fatKnown = true;
        }
    }
    return {
        calories: calKnown ? Math.round(calories) : null,
        protein_g: proteinKnown ? Math.round(protein * 10) / 10 : null,
        carbs_g: carbsKnown ? Math.round(carbs * 10) / 10 : null,
        fat_g: fatKnown ? Math.round(fat * 10) / 10 : null,
    };
}
