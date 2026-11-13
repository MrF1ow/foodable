import { expect, test } from "bun:test";
import { isNutritionCard, NUTRITION_CARDS } from "./layout.js";

test("isNutritionCard accepts every card key and nothing else", () => {
    for (const key of NUTRITION_CARDS) expect(isNutritionCard(key)).toBe(true);
    for (const key of ["", "bogus", "Trends", "trends ", "__proto__"]) {
        expect(isNutritionCard(key)).toBe(false);
    }
});
