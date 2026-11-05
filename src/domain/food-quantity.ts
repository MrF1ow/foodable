import {
    convertQuantity,
    dimensionOf,
    isQuantityUnit,
    type Quantity,
    type QuantityUnit,
} from "./quantity.js";

export type FoodQuantityFactors = {
    gramsPerEach: number | null;
    gramsPerMl: number | null;
    genericFoodId?: string | null;
};

/** Family id of a food reference: the plain food's id for a product, else the id itself. */
export function familyIdOf(
    foodId: string,
    foodsById: ReadonlyMap<string, { genericFoodId?: string | null }>,
): string {
    return foodsById.get(foodId)?.genericFoodId ?? foodId;
}

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

function asQuantity(
    quantity: { amount: number; unit: string },
    unit: QuantityUnit,
): Quantity {
    return { amount: quantity.amount, unit } as Quantity;
}

/**
 * Convert a food quantity to grams. Mass converts directly. Volume needs
 * `gramsPerMl`. Count needs `gramsPerEach`. A missing factor returns null —
 * unknown is never treated as zero.
 */
export function toGrams(
    quantity: { amount: number; unit: string },
    food: FoodQuantityFactors | null | undefined,
): number | null {
    if (!Number.isFinite(quantity.amount)) return null;
    if (!isQuantityUnit(quantity.unit)) return null;
    const dim = dimensionOf(quantity.unit);
    if (dim === "mass") {
        return convertQuantity(asQuantity(quantity, quantity.unit), "g").amount;
    }
    if (dim === "volume") {
        const density = food?.gramsPerMl;
        if (density == null || !(density > 0)) return null;
        const ml = convertQuantity(
            asQuantity(quantity, quantity.unit),
            "ml",
        ).amount;
        return roundAmount(ml * density);
    }
    const gramsPerEach = food?.gramsPerEach;
    if (gramsPerEach == null || !(gramsPerEach > 0)) return null;
    return roundAmount(quantity.amount * gramsPerEach);
}

/** Convert grams back into `unit` when that unit can be resolved for `food`. */
export function fromGrams(
    grams: number,
    unit: string,
    food: FoodQuantityFactors | null | undefined,
): number | null {
    if (!Number.isFinite(grams)) return null;
    const one = toGrams({ amount: 1, unit }, food);
    if (one == null || one === 0) return null;
    return roundAmount(grams / one);
}

export type GramsGapReason =
    "unknown_unit" | "missing_grams_per_each" | "missing_grams_per_ml";

export function missingGramsGap(
    displayName: string,
    quantity: { unit: string },
    food: FoodQuantityFactors | null | undefined,
): { reason: GramsGapReason; message: string } | null {
    if (!isQuantityUnit(quantity.unit)) {
        return {
            reason: "unknown_unit",
            message: `${displayName}: unknown unit`,
        };
    }
    const dim = dimensionOf(quantity.unit);
    if (dim === "mass") return null;
    if (toGrams({ amount: 1, unit: quantity.unit }, food) != null) return null;
    if (dim === "count") {
        return {
            reason: "missing_grams_per_each",
            message: `${displayName}: set grams per each`,
        };
    }
    return {
        reason: "missing_grams_per_ml",
        message: `${displayName}: set grams per millilitre`,
    };
}

export function missingGramsReason(
    displayName: string,
    quantity: { unit: string },
    food: FoodQuantityFactors | null | undefined,
): string | null {
    return missingGramsGap(displayName, quantity, food)?.message ?? null;
}

export function storedFoodUnit(
    unit: string | undefined,
    food: { defaultUnit: string },
): string {
    const trimmed = unit?.trim() ?? "";
    return trimmed || food.defaultUnit || "g";
}
