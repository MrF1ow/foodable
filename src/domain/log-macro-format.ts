/** Display formatting for log amount macro tiles (SSR and client stay in sync). */

/** What the per-100 columns are per, and the pack serving, as search items carry them. */
export type LogBasis = "100g" | "100ml";
export type LogServing = { label: string; amount: number; unit: "g" | "ml" };

export type LogMacroItem = {
    /** Null or missing reads as per 100 g. */
    basis?: LogBasis | null;
    serving?: LogServing | null;
    kcal_per_100g?: number | null;
    protein_per_100g?: number | null;
    carbs_per_100g?: number | null;
    fat_per_100g?: number | null;
    grams_per_ml?: number | null;
    grams_per_each?: number | null;
    recipe_id?: string | null;
    kcal?: number | null;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
};

function round1(n: number): number {
    return Math.round(n * 10) / 10;
}

/** One portion is the pack serving, in the serving's own unit. */
export function resolvePortion(
    serving: LogServing,
    portions: number,
): { amount: number; unit: "g" | "ml" } {
    return {
        amount: Math.round(serving.amount * portions * 100) / 100,
        unit: serving.unit,
    };
}

function trimNumber(n: number): string {
    return String(Math.round(n * 100) / 100);
}

/** "1 portion · 30 ml": the amount sheet's echo of what a portion is. */
export function portionLabel(serving: LogServing, portions: number): string {
    const q = resolvePortion(serving, portions);
    return `${trimNumber(portions)} portion · ${trimNumber(q.amount)} ${q.unit}`;
}

export function itemGramsForLog(
    amount: number,
    unit: string,
    item: LogMacroItem,
): number | null {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === "g") return amount;
    if (unit === "ml") {
        const d = item.grams_per_ml;
        return d != null && d > 0 ? round1(amount * d) : null;
    }
    if (unit === "each") {
        const d = item.grams_per_each;
        return d != null && d > 0 ? round1(amount * d) : null;
    }
    return null;
}

/** The ml a per-100 ml food's figures scale by, or null when a density is missing. */
export function mlForLogItem(
    amount: number,
    unit: string,
    item: LogMacroItem,
): number | null {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (unit === "ml") return amount;
    const grams = itemGramsForLog(amount, unit, item);
    const d = item.grams_per_ml;
    return grams != null && d != null && d > 0 ? round1(grams / d) : null;
}

export function macrosForLogItem(
    item: LogMacroItem,
    amount: number,
    unit: string,
): {
    kcal: number | null;
    protein_g: number | null;
    carbs_g: number | null;
    fat_g: number | null;
} | null {
    if (unit === "portion" && item.recipe_id) {
        const scale = (v: number | null | undefined) =>
            v != null && Number.isFinite(Number(v))
                ? round1(Number(v) * amount)
                : null;
        return {
            kcal: scale(item.kcal),
            protein_g: scale(item.protein_g),
            carbs_g: scale(item.carbs_g),
            fat_g: scale(item.fat_g),
        };
    }
    if (unit === "portion" && item.serving) {
        const q = resolvePortion(item.serving, amount);
        return macrosForLogItem({ ...item, serving: null }, q.amount, q.unit);
    }
    // A per-100 ml food scales by ml: the amount itself in ml, or grams ÷
    // density for g and each. No density, no figure.
    const grams =
        item.basis === "100ml"
            ? mlForLogItem(amount, unit, item)
            : itemGramsForLog(amount, unit, item);
    if (grams == null) return null;
    const scale100 = (v: number | null | undefined) =>
        v != null && Number.isFinite(Number(v))
            ? Math.round((Number(v) * grams) / 10) / 10
            : null;
    return {
        kcal: scale100(item.kcal_per_100g),
        protein_g: scale100(item.protein_per_100g),
        carbs_g: scale100(item.carbs_per_100g),
        fat_g: scale100(item.fat_per_100g),
    };
}

export function formatLogMacroKcal(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(Number(value))) return "–";
    return String(Math.round(Number(value)));
}

export function formatLogMacroGrams(value: number | null | undefined): string {
    if (value == null || !Number.isFinite(Number(value))) return "–";
    const v = Number(value);
    if (v >= 10) return String(Math.round(v));
    const one = Math.round(v * 10) / 10;
    if (one % 1 === 0) return String(Math.round(one));
    return one.toFixed(1).replace(/\.0$/, "");
}
