import { test, expect } from "bun:test";
import {
    fromGrams,
    missingGramsReason,
    nutritionScaleAmount,
    storedFoodUnit,
    toGrams,
} from "./food-quantity.js";

const egg = { gramsPerEach: 50, gramsPerMl: null };
const milk = { gramsPerEach: null, gramsPerMl: 1.03 };

test("3 each at 50 g each is 150 g", () => {
    expect(toGrams({ amount: 3, unit: "each" }, egg)).toBe(150);
});

test("1 cup of milk at 1.03 g/ml is about 247 g (240 ml cup)", () => {
    // FDA labeling cup is 240 ml (existing ML_PER_CUP). 240 × 1.03 = 247.2.
    // A US customary cup (236.588 ml) would be about 244 g.
    expect(toGrams({ amount: 1, unit: "cup" }, milk)).toBeCloseTo(247.2, 1);
});

test("each without a factor is null", () => {
    expect(
        toGrams(
            { amount: 2, unit: "each" },
            { gramsPerEach: null, gramsPerMl: null },
        ),
    ).toBeNull();
    expect(toGrams({ amount: 2, unit: "each" }, null)).toBeNull();
});

test("volume without density is null, never a guess", () => {
    expect(toGrams({ amount: 1, unit: "cup" }, egg)).toBeNull();
    expect(toGrams({ amount: 100, unit: "ml" }, null)).toBeNull();
});

test("mass converts without a food row", () => {
    expect(toGrams({ amount: 48, unit: "oz" }, null)).toBe(1360.8);
    expect(toGrams({ amount: 1, unit: "lb" }, egg)).toBe(453.6);
});

test("unknown or non-finite units do not convert", () => {
    expect(toGrams({ amount: 1, unit: "roll" }, egg)).toBeNull();
    expect(toGrams({ amount: Number.NaN, unit: "g" }, egg)).toBeNull();
});

test("fromGrams inverts toGrams in the need unit", () => {
    expect(fromGrams(150, "each", egg)).toBe(3);
    expect(fromGrams(247.2, "cup", milk)).toBeCloseTo(1, 1);
});

test("missingGramsReason names the factor that is absent", () => {
    expect(
        missingGramsReason(
            "Eggs",
            { unit: "each" },
            {
                gramsPerEach: null,
                gramsPerMl: null,
            },
        ),
    ).toBe("Eggs: set grams per each");
    expect(missingGramsReason("Milk", { unit: "cup" }, egg)).toBe(
        "Milk: set grams per millilitre",
    );
    expect(missingGramsReason("Eggs", { unit: "g" }, null)).toBeNull();
});

test("storedFoodUnit prefers an explicit unit then the food default", () => {
    expect(storedFoodUnit("each", { defaultUnit: "g" })).toBe("each");
    expect(storedFoodUnit("  ", { defaultUnit: "cup" })).toBe("cup");
    expect(storedFoodUnit(undefined, { defaultUnit: "g" })).toBe("g");
});

test("per-100 ml scaling: ml is direct, g and each go through grams per ml", () => {
    const oil = {
        gramsPerMl: 0.92,
        gramsPerEach: 46,
        nutritionBasis: "100ml" as const,
    };
    expect(nutritionScaleAmount({ amount: 100, unit: "ml" }, oil)).toBe(100);
    // 92 g at 0.92 g/ml is 100 ml, not 92.
    expect(nutritionScaleAmount({ amount: 92, unit: "g" }, oil)).toBe(100);
    expect(nutritionScaleAmount({ amount: 2, unit: "each" }, oil)).toBe(100);
    expect(nutritionScaleAmount({ amount: 1, unit: "cup" }, oil)).toBe(240);
});

test("per-100 ml scaling never assumes 1 g = 1 ml", () => {
    const noDensity = {
        gramsPerMl: null,
        gramsPerEach: 330,
        nutritionBasis: "100ml" as const,
    };
    expect(
        nutritionScaleAmount({ amount: 100, unit: "g" }, noDensity),
    ).toBeNull();
    expect(
        nutritionScaleAmount({ amount: 1, unit: "each" }, noDensity),
    ).toBeNull();
    expect(nutritionScaleAmount({ amount: 250, unit: "ml" }, noDensity)).toBe(
        250,
    );
    // Per 100 g stays grams.
    expect(
        nutritionScaleAmount(
            { amount: 3, unit: "each" },
            { gramsPerMl: null, gramsPerEach: 50, nutritionBasis: "100g" },
        ),
    ).toBe(150);
});
