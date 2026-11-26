import { expect, test } from "bun:test";
import {
    formatAmountText,
    formatFractionAmount,
    formatRecipeAmountParts,
    pluralUnit,
} from "./amount-text.js";

test("a household's own count word reads in the plural past one (396429: 3 rolls)", () => {
    expect(formatAmountText(3, "roll")).toBe("3 rolls");
    expect(formatAmountText(1, "roll")).toBe("1 roll");
    expect(formatAmountText(3, "each")).toBe("3");
    expect(formatAmountText(200, "g")).toBe("200 g");
    expect(pluralUnit("clove", 2)).toBe("cloves");
    expect(pluralUnit("box", 2)).toBe("boxes");
    expect(pluralUnit("bunch", 2)).toBe("bunches");
    expect(pluralUnit("berry", 4)).toBe("berries");
    expect(pluralUnit("bags", 2)).toBe("bags");
    expect(pluralUnit("slice", 0.5)).toBe("slice");
    // Measuring units keep their short form.
    expect(pluralUnit("cup", 2)).toBe("cup");
    expect(pluralUnit("g", 200)).toBe("g");
});

test("recipe amounts read halves, thirds and quarters as fractions (402619: ½ cup)", () => {
    expect(formatFractionAmount(0.5)).toBe("½");
    expect(formatFractionAmount(1.25)).toBe("1¼");
    expect(formatFractionAmount(0.333)).toBe("⅓");
    expect(formatFractionAmount(2 / 3)).toBe("⅔");
    expect(formatFractionAmount(0.75)).toBe("¾");
    expect(formatFractionAmount(2)).toBe("2");
    expect(formatFractionAmount(0.4)).toBe("0.4");
    expect(formatRecipeAmountParts(0.5, "cup")).toBe("½ cup");
    expect(formatRecipeAmountParts(1.5, "each")).toBe("1½");
    expect(formatRecipeAmountParts(2, "clove")).toBe("2 cloves");
    expect(formatRecipeAmountParts(200, "g")).toBe("200 g");
});
