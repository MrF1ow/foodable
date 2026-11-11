import { expect, test } from "bun:test";
import { newFood } from "./foods.js";
import type { FoodQuality } from "./foods.js";
import {
    foodDisplayScore,
    memberProductVerdict,
    productCheckFromFood,
    scoredFoodProduct,
} from "./product-screen.js";
import { checkProductForMember } from "./product-checks.js";

const HH = "hh-1";

function quality(over: Partial<FoodQuality> = {}): FoodQuality {
    return {
        nutriscoreGrade: "a",
        novaGroup: 1,
        ecoscoreGrade: "b",
        additives: [],
        allergensTags: [],
        tracesTags: null,
        ingredientsAnalysisTags: [],
        labelsTags: [],
        fetchedAt: "2026-01-01T00:00:00.000Z",
        ...over,
    };
}

function food(over: Record<string, unknown> = {}) {
    return newFood({
        householdId: HH,
        kind: "food",
        name: "Yogurt",
        brand: "Fage",
        calories: 59,
        proteinG: 10,
        sugarG: 4,
        saturatedFatG: 2,
        offQuality: quality(),
        ...over,
    });
}

test("scoredFoodProduct returns null without OFF quality", () => {
    expect(scoredFoodProduct(food({ offQuality: null }))).toBeNull();
});

test("scoredFoodProduct returns a score for full OFF quality", () => {
    const scored = scoredFoodProduct(food());
    expect(scored?.score).toBeTypeOf("number");
    expect(scored?.partsUsed).toBe(4);
});

test("partial OFF data can still yield a score", () => {
    const scored = scoredFoodProduct(
        food({
            offQuality: quality({
                ecoscoreGrade: null,
                additives: null,
            }),
        }),
    );
    expect(scored?.score).toBeTypeOf("number");
    expect(scored!.partsUsed).toBeLessThan(4);
});

test("foodDisplayScore is null when not enough data", () => {
    expect(
        foodDisplayScore(
            food({
                offQuality: quality({
                    nutriscoreGrade: null,
                    novaGroup: null,
                    ecoscoreGrade: null,
                    additives: null,
                }),
            }),
        ),
    ).toBeNull();
});

test("memberProductVerdict maps allergen block to avoid", () => {
    const f = food({
        offQuality: quality({ allergensTags: ["en:peanuts"] }),
    });
    const notices = checkProductForMember(
        productCheckFromFood(f),
        {
            id: "u1",
            name: "Sam",
            allergens: ["peanut"],
            dislikes: [],
        },
        { remaining: {} },
    );
    expect(memberProductVerdict(notices)).toBe("avoid");
    expect(notices[0]!.severity).toBe("block");
});
