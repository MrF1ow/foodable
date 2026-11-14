import { describe, expect, test } from "bun:test";
import {
    canonicalUnitText,
    convertQuantity,
    resolveQuantityUnit,
} from "./quantity.js";
import {
    convertAmount,
    densityFromServing,
    measuresInLabel,
    resolveFactors,
    type ConversionFoodRow,
} from "./unit-conversion.js";
import { parseIngredientLines } from "./ingredient-lines.js";

function row(over: Partial<ConversionFoodRow> = {}): ConversionFoodRow {
    return {
        id: "plain",
        name: "Heavy cream",
        gramsPerMl: null,
        gramsPerEach: null,
        serving: null,
        ...over,
    };
}

describe("unit table", () => {
    test("spellings resolve to one unit, unknown ones stay as written", () => {
        expect(resolveQuantityUnit("Cups")).toBe("cup");
        expect(resolveQuantityUnit(" tablespoons ")).toBe("tbsp");
        expect(resolveQuantityUnit("Litres")).toBe("l");
        expect(resolveQuantityUnit("pints")).toBe("pint");
        expect(resolveQuantityUnit("qt.")).toBe("quart");
        expect(resolveQuantityUnit("fluid ounces")).toBe("fl oz");
        expect(resolveQuantityUnit("kilograms")).toBe("kg");
        // Ambiguous shorthands are refused, not guessed.
        expect(resolveQuantityUnit("T")).toBeNull();
        expect(resolveQuantityUnit("c")).toBeNull();
        expect(resolveQuantityUnit("clove")).toBeNull();
        expect(canonicalUnitText(" Pints ")).toBe("pint");
        expect(canonicalUnitText(" bag ")).toBe("bag");
    });

    test("the new volume and mass units convert by definition", () => {
        expect(convertQuantity({ amount: 1, unit: "pint" }, "ml").amount).toBe(
            473.2,
        );
        expect(
            convertQuantity({ amount: 1, unit: "quart" }, "pint").amount,
        ).toBe(2);
        expect(
            convertQuantity({ amount: 1, unit: "gallon" }, "quart").amount,
        ).toBe(4);
        expect(convertQuantity({ amount: 2, unit: "l" }, "ml").amount).toBe(
            2000,
        );
        expect(convertQuantity({ amount: 1.5, unit: "kg" }, "g").amount).toBe(
            1500,
        );
        expect(convertQuantity({ amount: 500, unit: "mg" }, "g").amount).toBe(
            0.5,
        );
    });

    test("recipe lines keep pints, quarts and gallons as their own unit", () => {
        const { items } = parseIngredientLines([
            "1 pint heavy cream",
            "2 quarts chicken stock",
            "1 gallon water",
        ]);
        expect(items.map((i) => i.quantity)).toEqual([
            { amount: 1, unit: "pint" },
            { amount: 2, unit: "quart" },
            { amount: 1, unit: "gallon" },
        ]);
    });
});

describe("densityFromServing", () => {
    test("a line that states a volume and a weight gives grams per ml", () => {
        expect(
            densityFromServing({
                label: "2 tbsp (30 g)",
                amount: 30,
                unit: "g",
            }),
        ).toBe(1);
        expect(
            densityFromServing({
                label: "2 Tbsp (32g)",
                amount: 32,
                unit: "g",
            }),
        ).toBe(1.067);
        expect(
            densityFromServing({
                label: "1/4 cup (30 g)",
                amount: 30,
                unit: "g",
            }),
        ).toBe(0.5);
        expect(
            densityFromServing({
                label: "½ cup (120 ml) 113 g",
                amount: 113,
                unit: "g",
            }),
        ).toBe(0.942);
    });

    test("a line with only one side is not evidence, whatever the amount says", () => {
        // A database can store "1 tbsp (15 ml)" as 15 g by assuming 1 g = 1 ml.
        expect(
            densityFromServing({
                label: "1 tbsp (15 ml)",
                amount: 15,
                unit: "g",
            }),
        ).toBeNull();
        expect(
            densityFromServing({ label: "2 tbsp", amount: 30, unit: "g" }),
        ).toBeNull();
        expect(
            densityFromServing({
                label: "1 cup (240 ml)",
                amount: 240,
                unit: "ml",
            }),
        ).toBeNull();
        expect(
            densityFromServing({ label: "30 g", amount: 30, unit: "g" }),
        ).toBeNull();
    });

    test("a serving amount that disagrees with its own line is refused", () => {
        expect(
            densityFromServing({
                label: "2 tbsp (30 g)",
                amount: 45,
                unit: "g",
            }),
        ).toBeNull();
    });

    test("a density no food has is refused", () => {
        expect(
            densityFromServing({
                label: "1 tsp (40 g)",
                amount: 40,
                unit: "g",
            }),
        ).toBeNull();
    });

    test("measures read fractions and fluid ounces", () => {
        expect(measuresInLabel("1 1/2 cups (8 fl oz)")).toEqual([
            { amount: 1.5, unit: "cup" },
            { amount: 8, unit: "fl oz" },
        ]);
    });
});

describe("resolveFactors", () => {
    test("the usual product comes before the plain food, stored before serving", () => {
        const plain = row({ gramsPerMl: 0.9, gramsPerEach: 5 });
        const product = row({
            id: "prod",
            name: "Kirkland Heavy Cream",
            serving: { label: "1 tbsp (15 g)", amount: 15, unit: "g" },
        });
        const f = resolveFactors(plain, product);
        expect(f.gramsPerMl).toMatchObject({
            value: 1,
            source: "product_serving",
            foodId: "prod",
            servingLabel: "1 tbsp (15 g)",
        });
        expect(f.gramsPerEach).toMatchObject({ value: 5, source: "food" });
        const stored = resolveFactors(plain, { ...product, gramsPerMl: 1.01 });
        expect(stored.gramsPerMl).toMatchObject({
            value: 1.01,
            source: "product",
        });
    });

    test("nothing stored and no usable serving leaves the factor unknown", () => {
        const f = resolveFactors(row(), null);
        expect(f).toEqual({ gramsPerMl: null, gramsPerEach: null });
    });
});

describe("convertAmount", () => {
    const none = { gramsPerMl: null, gramsPerEach: null };
    const cream = resolveFactors(
        row({ gramsPerMl: 1.01, gramsPerEach: null }),
        null,
    );

    test("within a dimension the unit table is enough", () => {
        const r = convertAmount(1, "pint", "cup", none);
        expect(r).toMatchObject({ ok: true, unit: "cup", amount: 1.97 });
        expect(convertAmount(2, "lbs", "g", none)).toMatchObject({
            ok: true,
            amount: 907,
        });
    });

    test("volume to weight needs grams per ml and records where it came from", () => {
        const r = convertAmount(1, "pint", "g", cream, "Heavy cream");
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.amount).toBe(478);
        expect(r.steps.map((s) => s.kind)).toEqual(["table", "grams_per_ml"]);
    });

    test("volume to weight without a factor is refused and names it", () => {
        const r = convertAmount(1, "cup", "g", none, "Flour");
        expect(r).toMatchObject({
            ok: false,
            reason: "missing_grams_per_ml",
        });
        if (r.ok) return;
        expect(r.message).toContain("Flour has no grams per ml");
    });

    test("count needs grams per item; count to volume needs both", () => {
        const garlic = resolveFactors(
            row({ name: "Garlic", gramsPerEach: 5 }),
            null,
        );
        expect(convertAmount(3, "each", "g", garlic)).toMatchObject({
            ok: true,
            amount: 15,
        });
        expect(
            convertAmount(3, "each", "tbsp", garlic, "Garlic"),
        ).toMatchObject({ ok: false, reason: "missing_grams_per_ml" });
        expect(convertAmount(100, "g", "each", none, "Garlic")).toMatchObject({
            ok: false,
            reason: "missing_grams_per_each",
        });
    });

    test("an unknown unit is refused, never treated as grams", () => {
        expect(convertAmount(1, "bunch", "g", cream)).toMatchObject({
            ok: false,
            reason: "unknown_unit",
            unknownUnit: "bunch",
        });
    });
});
