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

function formatMacroValue(value: number | null, unit: "kcal" | "g"): string {
    if (value == null) return "–";
    return unit === "kcal"
        ? formatLogMacroKcal(value)
        : formatLogMacroGrams(value);
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
        .toLowerCase();
    if (NAMELESS.test(name)) name = "serving";
    return {
        name: `Per ${name}`,
        amount: `${formatServingAmount(serving.amount)} ${serving.unit}`,
    };
}

/**
 * Heading for a pack serving: "Per portion · 30 ml". The name is the label's
 * text before any "(" with a leading "1 " dropped; a label that is only the
 * amount or a unit word ("30 g", "1 l") has no name, so it reads "serving".
 */
export function servingHeading(serving: FoodServing): string {
    const { name, amount } = servingHeadingParts(serving);
    return `${name} · ${amount}`;
}

/** Where the serving column comes from, decided once per food. */
type ServingSource =
    | { kind: "pack"; serving: FoodServing; values: FoodServingNutrition }
    | { kind: "derived"; amount: number };

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
    return grams != null ? { kind: "derived", amount: grams } : null;
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

export function buildProductNutritionTable(food: Food): ProductNutritionTable {
    return productNutrition(food).table;
}
