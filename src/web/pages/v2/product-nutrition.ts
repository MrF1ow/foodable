import type {
    Food,
    FoodServing,
    FoodServingNutrition,
} from "../../../domain/foods.js";
import { perServingFromFood } from "../../../domain/foods.js";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
} from "../../../domain/log-macro-format.js";

export type ProductMacroKey =
    "calories" | "proteinG" | "carbsG" | "fatG" | "fiberG" | "sugarG";

export const PRODUCT_MACRO_ROWS: ReadonlyArray<{
    key: ProductMacroKey;
    label: string;
    unit: "kcal" | "g";
}> = [
    { key: "calories", label: "Calories", unit: "kcal" },
    { key: "proteinG", label: "Protein", unit: "g" },
    { key: "carbsG", label: "Carbs", unit: "g" },
    { key: "fatG", label: "Fat", unit: "g" },
    { key: "fiberG", label: "Fiber", unit: "g" },
    { key: "sugarG", label: "Sugar", unit: "g" },
];

export type ProductNutritionColumn = {
    per100g: string;
    perServing: string | null;
};

export type ProductNutritionTable = Record<
    ProductMacroKey,
    ProductNutritionColumn
>;

function scalePer100g(value: number | null, amount: number): number | null {
    if (value == null) return null;
    return Math.round((value * amount) / 10) / 10;
}

/** A figure as text, or null when it is unknown (never a zero). */
function macroText(value: number | null, unit: "kcal" | "g"): string | null {
    if (value == null) return null;
    return unit === "kcal"
        ? formatLogMacroKcal(value)
        : formatLogMacroGrams(value);
}

function formatMacroValue(value: number | null, unit: "kcal" | "g"): string {
    return macroText(value, unit) ?? "–";
}

/** Grams that define “one serving” for scaling catalog nutrition, or null. */
export function servingGramsForFood(food: Food): number | null {
    if (food.gramsPerEach != null && food.gramsPerEach > 0) {
        return food.gramsPerEach;
    }
    const usual = food.usualAmount;
    if (usual == null) return null;
    if (usual.unit === "g" && usual.amount > 0) return usual.amount;
    if (
        usual.unit === "ml" &&
        food.gramsPerMl != null &&
        food.gramsPerMl > 0 &&
        usual.amount > 0
    ) {
        return Math.round(usual.amount * food.gramsPerMl * 10) / 10;
    }
    return null;
}

export function servingBasisLabel(food: Food): string | null {
    if (food.usualAmount) {
        const { amount, unit } = food.usualAmount;
        return unit === "each" ? `${amount} each` : `${amount} ${unit}`;
    }
    const g = servingGramsForFood(food);
    if (g == null) return null;
    return `${formatLogMacroGrams(g)} g serving`;
}

const UNIT_WORDS = "g|kg|mg|ml|l|cl|dl|oz|fl\\s*oz|lb";
/**
 * Digits, separators and fraction glyphs, then at most a unit word; or a
 * count form like "2 x 15 g" (its leading "1 " is already gone: "x 25 g").
 */
const NAMELESS = new RegExp(
    `^[\\d.,\\s/½¼¾⅓⅔⅛]*(${UNIT_WORDS})?$|^(\\d+\\s*)?[x×]\\s*[\\d.,\\s/½¼¾⅓⅔⅛]*(${UNIT_WORDS})?$`,
    "i",
);

/** One amount, one decimal at most, no trailing ".0": 29.5735 → "29.6". */
function formatServingAmount(amount: number): string {
    return String(Math.round(amount * 10) / 10);
}

/** The two lines of a serving heading: "Per portion" and "30 ml". */
export function servingHeadingParts(serving: FoodServing): {
    name: string;
    amount: string;
} {
    // A leading "1 " is dropped, but not the whole part of "1 1/2" or "1 ½".
    let name = serving.label
        .split(/[(=]/)[0]!
        .trim()
        .replace(/^1\s+(?![\d/½¼¾⅓⅔⅛])/, "")
        .toLowerCase()
        // The heading adds its own "Per": "Per serving (30g)" is "serving".
        .replace(/^per\s+/, "");
    if (NAMELESS.test(name)) name = "serving";
    return {
        name: `Per ${name}`,
        amount: `${formatServingAmount(serving.amount)} ${serving.unit}`,
    };
}

/** Where the serving column comes from, decided once per food. */
type ServingSource =
    | { kind: "pack"; serving: FoodServing; values: FoodServingNutrition }
    | { kind: "derived"; amount: number; label?: string };

function servingSource(food: Food): ServingSource | null {
    const values = perServingFromFood(food);
    if (food.serving != null && values != null) {
        return { kind: "pack", serving: food.serving, values };
    }
    if (food.nutritionBasis === "100ml") {
        // Scaling per-100 ml values by grams would be a density guess; a
        // usual amount in ml needs none.
        const usual = food.usualAmount;
        if (usual != null && usual.unit === "ml" && usual.amount > 0) {
            return { kind: "derived", amount: usual.amount };
        }
        return null;
    }
    const grams = servingGramsForFood(food);
    if (grams == null) return null;
    // A usual amount in ml keeps its own words in the heading ("250 ml"),
    // as the subtitle says; the values still scale by its grams.
    const usual = food.usualAmount;
    const label =
        usual != null && usual.unit === "ml" && usual.amount > 0
            ? `${formatServingAmount(usual.amount)} ml`
            : undefined;
    return { kind: "derived", amount: grams, label };
}

/** The serving bit of the subtitle: none when the nutrition head names it. */
export function subtitleServingLabel(food: Food): string | null {
    return servingSource(food)?.kind === "pack"
        ? null
        : servingBasisLabel(food);
}

export type ProductNutritionHead = {
    /** Leading per-serving heading: name line, optional amount line. */
    serving: { name: string; amount: string | null } | null;
    /** The per-100 column heading. */
    per100: string;
    /** Note under "Per serving" for a serving derived from grams; else null. */
    servingNote: string | null;
};

export type ProductNutrition = {
    head: ProductNutritionHead;
    table: ProductNutritionTable;
};

export function productNutrition(food: Food): ProductNutrition {
    const source = servingSource(food);
    const per100 = food.nutritionBasis === "100ml" ? "Per 100 ml" : "Per 100 g";
    let head: ProductNutritionHead;
    if (source?.kind === "pack") {
        head = {
            serving: servingHeadingParts(source.serving),
            per100,
            servingNote: null,
        };
    } else if (source?.kind === "derived") {
        head = {
            serving: { name: "Per serving", amount: null },
            per100,
            servingNote: servingBasisLabel(food),
        };
    } else {
        head = { serving: null, per100, servingNote: null };
    }
    const table = {} as ProductNutritionTable;
    for (const row of PRODUCT_MACRO_ROWS) {
        const raw = food[row.key];
        let perServing: string | null = null;
        if (source?.kind === "pack") {
            perServing = formatMacroValue(source.values[row.key], row.unit);
        } else if (source?.kind === "derived") {
            perServing = formatMacroValue(
                scalePer100g(raw, source.amount),
                row.unit,
            );
        }
        table[row.key] = {
            per100g: formatMacroValue(raw, row.unit),
            perServing,
        };
    }
    return { head, table };
}

/** One body row of the nutrition Table: its label and one cell per column. */
export type ProductNutritionTableRow = {
    label: string;
    /** Per serving first (when there is a serving column), then per 100; null is unknown. */
    cols: (string | null)[];
};

export type ProductNutritionTableData = {
    /** The header cells: "1 serving · 30 ml" and "100 ml", or "100 g" alone. */
    head: string[];
    rows: ProductNutritionTableRow[];
};

/**
 * "1 serving · 30 ml": the serving column's heading, as frames 391040 and
 * 391131 set it. The pack's own unit of eating names it ("1 cup · 240 ml",
 * "2 cookies · 30 g"); the generic words a label uses for any pack ("portion",
 * "serving") read as "serving".
 */
function servingColumnHead(parts: { name: string; amount: string }): string {
    const named = parts.name.replace(/^Per\s+/, "");
    const name = /^(portion|serving)s?$/.test(named) ? "serving" : named;
    // A mixed number or a fraction ("1 1/2 cup") already carries its count.
    const counted = /^[\d½¼¾⅓⅔⅛]/.test(name);
    return `${counted ? "" : "1 "}${name} · ${parts.amount}`;
}

/**
 * The Table's header and rows: the serving column leads when the food has a
 * serving, then 100 g (100 ml for a liquid basis). Unknown cells are null; the
 * Table draws them as a dash.
 */
export function productNutritionTable(food: Food): ProductNutritionTableData {
    const source = servingSource(food);
    const basisUnit = food.nutritionBasis === "100ml" ? "ml" : "g";
    const head: string[] = [];
    if (source?.kind === "pack") {
        head.push(servingColumnHead(servingHeadingParts(source.serving)));
    } else if (source?.kind === "derived") {
        head.push(
            `1 serving · ${source.label ?? `${formatServingAmount(source.amount)} ${basisUnit}`}`,
        );
    }
    head.push(`100 ${basisUnit}`);
    // Grams carry their unit in the Table, as the design sets them ("17 g").
    const cell = (value: number | null, unit: "kcal" | "g") => {
        const text = macroText(value, unit);
        return text != null && unit === "g" ? `${text} g` : text;
    };
    const rows = PRODUCT_MACRO_ROWS.map((row) => {
        const cols: (string | null)[] = [];
        if (source?.kind === "pack") {
            cols.push(cell(source.values[row.key], row.unit));
        } else if (source?.kind === "derived") {
            cols.push(
                cell(scalePer100g(food[row.key], source.amount), row.unit),
            );
        }
        cols.push(cell(food[row.key], row.unit));
        return { label: row.label, cols };
    });
    // A food with no nutrition at all lists the four basics, as frame 392480.
    const known = rows.some((row) => row.cols.some((c) => c != null));
    return {
        head,
        rows: known
            ? rows
            : rows.filter(
                  (row) => row.label !== "Fiber" && row.label !== "Sugar",
              ),
    };
}
