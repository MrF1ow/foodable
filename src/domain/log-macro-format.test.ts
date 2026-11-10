import { expect, test } from "bun:test";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
    macrosForLogItem,
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
