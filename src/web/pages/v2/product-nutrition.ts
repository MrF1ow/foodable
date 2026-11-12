import type { Food } from "../../../domain/foods.js";
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

function scalePer100g(value: number | null, grams: number): number | null {
    if (value == null) return null;
    return Math.round((value * grams) / 10) / 10;
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

export function buildProductNutritionTable(food: Food): ProductNutritionTable {
    const servingG = servingGramsForFood(food);
    const out = {} as ProductNutritionTable;
    for (const row of PRODUCT_MACRO_ROWS) {
        const raw = food[row.key];
        const per100 =
            row.unit === "kcal"
                ? formatMacroValue(raw, "kcal")
                : formatMacroValue(raw, "g");
        let perServing: string | null = null;
        if (servingG != null) {
            const scaled =
                row.key === "calories"
                    ? scalePer100g(raw, servingG)
                    : scalePer100g(raw, servingG);
            perServing =
                row.unit === "kcal"
                    ? formatMacroValue(scaled, "kcal")
                    : formatMacroValue(scaled, "g");
        }
        out[row.key] = { per100g: per100, perServing };
    }
    return out;
}
