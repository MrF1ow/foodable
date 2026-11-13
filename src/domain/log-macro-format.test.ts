import { expect, test } from "bun:test";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
    macrosForLogItem,
    portionLabel,
    resolvePortion,
} from "./log-macro-format.js";

test("kcal formats as a whole number", () => {
    expect(formatLogMacroKcal(248.4)).toBe("248");
    expect(formatLogMacroKcal(null)).toBe("–");
});

test("grams round at 10 and use one decimal below", () => {
    expect(formatLogMacroGrams(46.5)).toBe("47");
    expect(formatLogMacroGrams(7.5)).toBe("7.5");
    expect(formatLogMacroGrams(9.04)).toBe("9");
});

test("amount display scales per 100 g", () => {
    const m = macrosForLogItem(
        {
            kcal_per_100g: 165,
            protein_per_100g: 31,
            carbs_per_100g: 0,
            fat_per_100g: 3.3,
        },
        150,
        "g",
    );
    expect(m?.kcal).toBe(247.5);
    expect(m?.protein_g).toBe(46.5);
});

// Half & Half: 40 kcal in a 30 ml serving, so 133.3 kcal per 100 ml.
const HALF_AND_HALF = {
    kcal_per_100g: (40 / 30) * 100,
    protein_per_100g: 3.3,
    carbs_per_100g: 3.3,
    fat_per_100g: 10,
    basis: "100ml" as const,
    serving: { label: "1 tbsp (30 ml)", amount: 30, unit: "ml" as const },
};

test("ml on a per-100 ml food scales directly, with no density", () => {
    const m = macrosForLogItem(HALF_AND_HALF, 30, "ml");
    expect(m?.kcal).toBe(40);
    expect(macrosForLogItem(HALF_AND_HALF, 100, "ml")?.kcal).toBe(133.3);
});

test("a portion is the pack serving in its own unit", () => {
    expect(macrosForLogItem(HALF_AND_HALF, 1, "portion")?.kcal).toBe(40);
    expect(macrosForLogItem(HALF_AND_HALF, 2, "portion")?.kcal).toBe(80);
    expect(resolvePortion(HALF_AND_HALF.serving, 2)).toEqual({
        amount: 60,
        unit: "ml",
    });
    expect(portionLabel(HALF_AND_HALF.serving, 1)).toBe("1 portion · 30 ml");
    expect(portionLabel(HALF_AND_HALF.serving, 0.5)).toBe(
        "0.5 portion · 15 ml",
    );
});

test("a per-100 g food keeps scaling by grams, and a serving in g is a portion", () => {
    const flour = {
        kcal_per_100g: 364,
        serving: { label: "1/4 cup (30 g)", amount: 30, unit: "g" as const },
    };
    expect(macrosForLogItem(flour, 150, "g")?.kcal).toBe(546);
    expect(macrosForLogItem(flour, 1, "portion")?.kcal).toBe(109.2);
    // ml still needs a density on a per-100 g food.
    expect(macrosForLogItem(flour, 30, "ml")).toBeNull();
});

test("a per-100 ml food: g and each scale through grams per ml, never 1 g = 1 ml", () => {
    const oil = {
        basis: "100ml" as const,
        kcal_per_100g: 800,
        grams_per_ml: 0.92,
        grams_per_each: 46,
    };
    expect(macrosForLogItem(oil, 92, "g")?.kcal).toBe(800);
    expect(macrosForLogItem(oil, 2, "each")?.kcal).toBe(800);
    expect(macrosForLogItem(oil, 100, "ml")?.kcal).toBe(800);
    const noDensity = { basis: "100ml" as const, kcal_per_100g: 42 };
    expect(macrosForLogItem(noDensity, 100, "g")).toBeNull();
    expect(macrosForLogItem(noDensity, 100, "ml")?.kcal).toBe(42);
    expect(
        macrosForLogItem(
            { ...noDensity, serving: { label: "x", amount: 250, unit: "g" } },
            1,
            "portion",
        ),
    ).toBeNull();
});
