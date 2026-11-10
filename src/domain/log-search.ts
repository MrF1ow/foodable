import { matchFoodsByWords } from "./foods.js";

export type LogSearchGroupKind =
    "food" | "recipe" | "history" | "stock" | "off";

const GROUP_ORDER: LogSearchGroupKind[] = [
    "food",
    "recipe",
    "history",
    "stock",
    "off",
];

export type LogSearchSourceItem = {
    kind: LogSearchGroupKind;
    id: string;
    name: string;
    brand?: string | null;
    food_id?: string | null;
    recipe_id?: string | null;
    kcal_per_100g?: number | null;
    protein_per_100g?: number | null;
    carbs_per_100g?: number | null;
    fat_per_100g?: number | null;
    /** Per-portion macros for recipes. */
    kcal_per_portion?: number | null;
    protein_g_per_portion?: number | null;
    carbs_g_per_portion?: number | null;
    fat_g_per_portion?: number | null;
    /** Meal total kcal for history rows (not per 100 g). */
    meal_kcal?: number | null;
    /** Fridge quantity on hand, for the row subtitle only (never a log amount). */
    stock_amount?: number | null;
    stock_unit?: string | null;
    amount?: number | null;
    unit?: string | null;
    barcode?: string | null;
    source: string;
    grams_per_each?: number | null;
    grams_per_ml?: number | null;
    logged_at?: string | null;
};

export type LogSearchSources = Partial<
    Record<LogSearchGroupKind, LogSearchSourceItem[]>
>;

export type LogSearchResultItem = {
    id: string;
    name: string;
    brand?: string | null;
    food_id?: string | null;
    recipe_id?: string | null;
    kcal_per_100g?: number | null;
    protein_per_100g?: number | null;
    carbs_per_100g?: number | null;
    fat_per_100g?: number | null;
    grams_per_ml?: number | null;
    grams_per_each?: number | null;
    /** Per-portion macros for recipes (and history meal totals in kcal). */
    kcal?: number | null;
    protein_g?: number | null;
    carbs_g?: number | null;
    fat_g?: number | null;
    amount?: number | null;
    unit?: string | null;
    unit_hints: string[];
    source: string;
    barcode?: string | null;
    /** Meal total kcal for history row subtitles only. */
    meal_kcal?: number | null;
    /** Fridge quantity on hand, for the row subtitle only (never a log amount). */
    stock_amount?: number | null;
    stock_unit?: string | null;
};

export type LogSearchResult = {
    groups: Array<{
        kind: LogSearchGroupKind;
        items: LogSearchResultItem[];
    }>;
};

/**
 * Recipes and fridge stock arrive as whole lists; they are matched here with
 * the same word matcher as household foods (plurals, word order, a prefix on
 * the last word), and ranked the same way.
 */
const MATCHED_HERE: ReadonlySet<LogSearchGroupKind> = new Set([
    "recipe",
    "stock",
]);

function matchByWords(
    query: string,
    items: LogSearchSourceItem[],
): LogSearchSourceItem[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const rows = items.map((item) => ({
        id: item.id,
        name: item.name,
        brand: item.brand ?? null,
        archivedAt: null,
    }));
    return matchFoodsByWords(query, rows, new Map()).map((row) =>
        byId.get(row.id)!,
    );
}

/**
 * First local date of the empty-query history window: `days` calendar days
 * before local `today` (YYYY-MM-DD), so the window is the same length on
 * either side of a DST change.
 */
export function recentHistoryStart(today: string, days: number): string {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
}

export function unitHintsForLog(
    factors: {
        grams_per_each?: number | null;
        grams_per_ml?: number | null;
    },
    opts: { recipe?: boolean } = {},
): string[] {
    if (opts.recipe) return ["portion"];
    const hints = ["g"];
    if (factors.grams_per_ml != null && factors.grams_per_ml > 0) {
        hints.push("ml");
    }
    if (factors.grams_per_each != null && factors.grams_per_each > 0) {
        hints.push("each");
    }
    return hints;
}

function historyUnitHints(item: LogSearchSourceItem): string[] {
    if (item.recipe_id) return ["portion"];
    if (item.food_id != null && item.amount != null) {
        return unitHintsForLog(item);
    }
    return [];
}

function toResultItem(item: LogSearchSourceItem): LogSearchResultItem {
    const unit_hints =
        item.kind === "history"
            ? historyUnitHints(item)
            : unitHintsForLog(item, { recipe: item.kind === "recipe" });
    const out: LogSearchResultItem = {
        id: item.id,
        name: item.name,
        unit_hints,
        source: item.source,
    };
    if (item.brand != null) out.brand = item.brand;
    if (item.food_id != null) out.food_id = item.food_id;
    if (item.recipe_id != null) out.recipe_id = item.recipe_id;
    if (item.kcal_per_100g != null) out.kcal_per_100g = item.kcal_per_100g;
    if (item.protein_per_100g != null)
        out.protein_per_100g = item.protein_per_100g;
    if (item.carbs_per_100g != null) out.carbs_per_100g = item.carbs_per_100g;
    if (item.fat_per_100g != null) out.fat_per_100g = item.fat_per_100g;
    if (item.grams_per_ml != null) out.grams_per_ml = item.grams_per_ml;
    if (item.grams_per_each != null) out.grams_per_each = item.grams_per_each;
    if (item.kcal_per_portion != null) out.kcal = item.kcal_per_portion;
    if (item.protein_g_per_portion != null)
        out.protein_g = item.protein_g_per_portion;
    if (item.carbs_g_per_portion != null)
        out.carbs_g = item.carbs_g_per_portion;
    if (item.fat_g_per_portion != null) out.fat_g = item.fat_g_per_portion;
    if (item.meal_kcal != null) out.meal_kcal = item.meal_kcal;
    if (item.stock_amount != null) out.stock_amount = item.stock_amount;
    if (item.stock_unit != null) out.stock_unit = item.stock_unit;
    if (item.amount != null) out.amount = item.amount;
    if (item.unit != null) out.unit = item.unit;
    if (item.barcode != null) out.barcode = item.barcode;
    return out;
}

/**
 * Groups come out in `GROUP_ORDER`. Household foods, meal history and Open
 * Food Facts arrive already matched and ranked by their own search (aliases,
 * meal text, OFF), so their order is kept and nothing is dropped; recipes and
 * stock are matched here. When the same `food_id` appears in more than one
 * group, the earliest group keeps it (food before stock, etc.).
 */
export function mergeLogResults(
    sources: LogSearchSources,
    query: string,
): LogSearchResult {
    const trimmed = query.trim();
    const seenFoodIds = new Set<string>();
    const groups: LogSearchResult["groups"] = [];

    if (!trimmed) {
        const history = sources.history ?? [];
        const sorted = [...history].sort((a, b) =>
            (b.logged_at ?? "").localeCompare(a.logged_at ?? ""),
        );
        if (sorted.length > 0) {
            groups.push({
                kind: "history",
                items: sorted.map(toResultItem),
            });
        }
        return { groups };
    }

    for (const kind of GROUP_ORDER) {
        const raw = sources[kind];
        if (!raw?.length) continue;
        const items = MATCHED_HERE.has(kind) ? matchByWords(trimmed, raw) : raw;
        if (items.length === 0) continue;
        const kept: LogSearchSourceItem[] = [];
        for (const item of items) {
            const fid = item.food_id?.trim();
            if (fid) {
                if (seenFoodIds.has(fid)) continue;
                seenFoodIds.add(fid);
            }
            kept.push(item);
        }
        if (kept.length === 0) continue;
        groups.push({ kind, items: kept.map(toResultItem) });
    }

    return { groups };
}

/** Household hit count across every non-OFF group (for OFF gating). */
export function householdLogSearchCount(result: LogSearchResult): number {
    let n = 0;
    for (const group of result.groups) {
        if (group.kind === "off") continue;
        n += group.items.length;
    }
    return n;
}
