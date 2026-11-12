import type { Food, FoodQuality } from "./foods.js";
import type { FoodResult } from "../foods.js";
import { foodQualityFromHit } from "./foods.js";
import {
    OFF_ALLERGEN_TAG_TO_CODE,
    checkProductForMember,
    type ProductCheckInput,
    type ProductCheckMember,
    type ProductCheckToday,
} from "./product-checks.js";
import type { NamedAllergen } from "./rules.js";
import type { Notice } from "./notices.js";
import {
    DEFAULT_SCORE_PRESET,
    SCORE_PRESETS,
    productInfoRows,
    scoreProduct,
    type ProductScore,
    type ScoreQuality,
    type ScoreWeights,
} from "./product-score.js";

export function scoreQualityFromFoodQuality(
    quality: FoodQuality,
): ScoreQuality {
    return {
        nutriscoreGrade: quality.nutriscoreGrade,
        novaGroup: quality.novaGroup,
        ecoscoreGrade: quality.ecoscoreGrade,
        additives: quality.additives,
    };
}

export function scoreQualityFromOffHit(hit: FoodResult): ScoreQuality | null {
    const q = foodQualityFromHit(hit);
    return q == null ? null : scoreQualityFromFoodQuality(q);
}

/**
 * Scores a product with the viewer's weights (Balanced when none are given).
 * Null when there is not enough data to say anything.
 */
export function scoredProduct(
    quality: ScoreQuality,
    weights: ScoreWeights = SCORE_PRESETS[DEFAULT_SCORE_PRESET],
): ProductScore | null {
    const scored = scoreProduct(quality, weights);
    if (scored.label === "not_enough_data") return null;
    return scored;
}

export function scoredFoodProduct(
    food: Food,
    weights?: ScoreWeights,
): ProductScore | null {
    if (food.offQuality == null) return null;
    return scoredProduct(scoreQualityFromFoodQuality(food.offQuality), weights);
}

export function scoredOffHit(
    hit: FoodResult,
    weights?: ScoreWeights,
): ProductScore | null {
    const quality = scoreQualityFromOffHit(hit);
    if (quality == null) return null;
    return scoredProduct(quality, weights);
}

export function foodDisplayScore(
    food: Food,
    weights?: ScoreWeights,
): number | null {
    return scoredFoodProduct(food, weights)?.score ?? null;
}

export function offHitDisplayScore(
    hit: FoodResult,
    weights?: ScoreWeights,
): number | null {
    return scoredOffHit(hit, weights)?.score ?? null;
}

const OFF_TAG_FOR_NAMED: Partial<Record<NamedAllergen, string>> = (() => {
    const out: Partial<Record<NamedAllergen, string>> = {};
    for (const [tag, code] of Object.entries(OFF_ALLERGEN_TAG_TO_CODE)) {
        if (out[code] == null) out[code] = tag;
    }
    return out;
})();

function allergenTagsForFood(food: Food): string[] | null {
    const offTags = food.offQuality?.allergensTags ?? [];
    const tags = new Set<string>(offTags);
    const wheatFromGluten =
        offTags.includes("en:gluten") && !offTags.includes("en:wheat");
    for (const code of food.allergens) {
        if (code === "other") continue;
        if (code === "wheat" && wheatFromGluten) continue;
        const tag = OFF_TAG_FOR_NAMED[code as NamedAllergen];
        if (tag) tags.add(tag);
    }
    return tags.size > 0 ? [...tags] : null;
}

function per100gFromFood(food: Food) {
    return {
        calories: food.calories,
        proteinG: food.proteinG,
        carbsG: food.carbsG,
        fatG: food.fatG,
        fiberG: food.fiberG,
        sugarG: food.sugarG,
        alcoholG: food.alcoholG,
        caffeineMg: food.caffeineMg,
    };
}

export function productCheckFromFood(food: Food): ProductCheckInput {
    const q = food.offQuality;
    return {
        id: food.id,
        name: food.name,
        allergensTags: allergenTagsForFood(food),
        tracesTags: q?.tracesTags ?? null,
        ingredientsText: null,
        per100g: per100gFromFood(food),
        servingGrams: food.gramsPerEach,
    };
}

export type MemberProductVerdict = "good" | "careful" | "avoid";

export function memberProductVerdict(
    notices: readonly Notice[],
): MemberProductVerdict {
    if (notices.some((n) => n.severity === "block")) return "avoid";
    if (notices.some((n) => n.severity === "warn")) return "careful";
    return "good";
}

export function memberChecksForProduct(
    product: ProductCheckInput,
    members: readonly ProductCheckMember[],
    todayForMember: (member: ProductCheckMember) => ProductCheckToday = () => ({
        remaining: {},
    }),
): Map<string, Notice[]> {
    const out = new Map<string, Notice[]>();
    for (const member of members) {
        out.set(
            member.id,
            checkProductForMember(product, member, todayForMember(member)),
        );
    }
    return out;
}
