import { expect, test } from "bun:test";
import { newFood } from "./foods.js";
import type { FoodQuality } from "./foods.js";
import {
    foodDisplayScore,
    offHitDisplayScore,
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

test("the viewer's weights change the score and the default stays Balanced", () => {
    // Nutri-Score A with NOVA 4: a nutrition-only weighting loves it, a
    // processing-only weighting does not.
    const f = food({
        offQuality: quality({ nutriscoreGrade: "a", novaGroup: 4 }),
    });
    const nutritionOnly = {
        nutrition: 100,
        processing: 0,
        additives: 0,
        environment: 0,
    };
    const processingOnly = {
        nutrition: 0,
        processing: 100,
        additives: 0,
        environment: 0,
    };
    const byNutrition = foodDisplayScore(f, nutritionOnly)!;
    const byProcessing = foodDisplayScore(f, processingOnly)!;
    expect(byNutrition).toBeGreaterThan(byProcessing);
    expect(foodDisplayScore(f)).toBe(foodDisplayScore(f, undefined));
    expect(foodDisplayScore(f)).not.toBe(byNutrition);
    expect(scoredFoodProduct(f, processingOnly)?.score).toBe(byProcessing);
});

test("an offer from Open Food Facts is scored with the viewer's weights too", () => {
    const hit = {
        nutriscore_grade: "a",
        nova_group: 4,
        quality: {
            nutriscore_grade: "a",
            nova_group: 4,
            ecoscore_grade: null,
            additives_tags: [],
            allergens_tags: null,
            traces_tags: null,
            ingredients_analysis_tags: null,
            labels_tags: null,
            fetched_at: "2026-01-01T00:00:00.000Z",
        },
    } as never;
    const weights = {
        nutrition: 100,
        processing: 0,
        additives: 0,
        environment: 0,
    };
    expect(offHitDisplayScore(hit, weights)).not.toBe(offHitDisplayScore(hit));
});
