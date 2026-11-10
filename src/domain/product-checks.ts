import { normalizeFoodName } from "./foods.js";
import type { Notice } from "./notices.js";
import { NOTICE_SEVERITY, sortNotices } from "./notices.js";
import {
    ALLERGEN_LABELS,
    type AllergenCode,
    type NamedAllergen,
} from "./rules.js";

/** OFF allergen tag → household named allergen (contains and traces lists). */
export const OFF_ALLERGEN_TAG_TO_CODE: Readonly<Record<string, NamedAllergen>> =
    {
        "en:peanuts": "peanut",
        "en:nuts": "tree_nut",
        "en:milk": "milk",
        "en:eggs": "egg",
        "en:soybeans": "soy",
        "en:fish": "fish",
        "en:crustaceans": "shellfish",
        "en:molluscs": "shellfish",
        "en:sesame-seeds": "sesame",
        "en:wheat": "wheat",
    };

export type ProductServingNutrition = {
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fiberG?: number | null;
    sugarG?: number | null;
    alcoholG?: number | null;
    caffeineMg?: number | null;
};

export type ProductCheckInput = {
    id: string;
    name: string;
    allergensTags: string[] | null;
    tracesTags: string[] | null;
    ingredientsText?: string | null;
    servingNutrition?: ProductServingNutrition | null;
    per100g?: ProductServingNutrition | null;
    servingGrams?: number | null;
};

export type ProductCheckMember = {
    id: string;
    name: string;
    allergens: readonly AllergenCode[];
    dislikes: readonly string[];
};

export type ProductCheckNutrient =
    | "calories"
    | "protein_g"
    | "carbs_g"
    | "fat_g"
    | "fiber_g"
    | "sugar_g"
    | "alcohol_g"
    | "caffeine_mg";

export type ProductCheckToday = {
    remaining: Partial<Record<ProductCheckNutrient, number>>;
};

const NUTRIENT_SERVING_KEY: Record<
    ProductCheckNutrient,
    keyof ProductServingNutrition
> = {
    calories: "calories",
    protein_g: "proteinG",
    carbs_g: "carbsG",
    fat_g: "fatG",
    fiber_g: "fiberG",
    sugar_g: "sugarG",
    alcohol_g: "alcoholG",
    caffeine_mg: "caffeineMg",
};

const NUTRIENT_WORD: Record<ProductCheckNutrient, string> = {
    calories: "calories",
    protein_g: "protein",
    carbs_g: "carbs",
    fat_g: "fat",
    fiber_g: "fiber",
    sugar_g: "sugar",
    alcohol_g: "alcohol",
    caffeine_mg: "caffeine",
};

function normalizeOffTag(tag: string): string {
    return tag.trim().toLowerCase();
}

function allergenCodeFromOffTag(tag: string): NamedAllergen | null {
    const raw = normalizeOffTag(tag);
    const direct = OFF_ALLERGEN_TAG_TO_CODE[raw];
    if (direct) return direct;
    const slug = raw.replace(/^en:/, "").replaceAll("_", "-");
    for (const [key, code] of Object.entries(OFF_ALLERGEN_TAG_TO_CODE)) {
        const keySlug = key.replace(/^en:/, "").replaceAll("_", "-");
        if (keySlug === slug) return code;
    }
    return null;
}

function containsGlutenTag(tags: string[] | null | undefined): boolean {
    if (tags == null) return false;
    return tags.some((tag) => {
        const slug = normalizeOffTag(tag).replace(/^en:/, "");
        return slug === "gluten";
    });
}

function namedAllergensInTags(
    tags: string[] | null | undefined,
): Set<NamedAllergen> {
    const out = new Set<NamedAllergen>();
    if (tags == null) return out;
    for (const tag of tags) {
        const code = allergenCodeFromOffTag(tag);
        if (code) out.add(code);
    }
    return out;
}

function memberNamedAllergens(member: ProductCheckMember): Set<NamedAllergen> {
    const out = new Set<NamedAllergen>();
    for (const code of member.allergens) {
        if (code === "other") continue;
        out.add(code);
    }
    return out;
}

function scalePer100g(
    value: number | null | undefined,
    grams: number,
): number | null {
    if (value == null) return null;
    return (value * grams) / 100;
}

function roundNutrient(n: number): number {
    return Math.round(n * 10) / 10;
}

function formatNutrientAmount(n: number): string {
    const rounded = roundNutrient(n);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function servingNutritionFor(
    product: ProductCheckInput,
): ProductServingNutrition | null {
    if (product.servingNutrition != null) return product.servingNutrition;
    if (
        product.per100g != null &&
        product.servingGrams != null &&
        product.servingGrams > 0
    ) {
        const g = product.servingGrams;
        const p = product.per100g;
        return {
            calories: scalePer100g(p.calories, g),
            proteinG: scalePer100g(p.proteinG, g),
            carbsG: scalePer100g(p.carbsG, g),
            fatG: scalePer100g(p.fatG, g),
            fiberG: scalePer100g(p.fiberG, g),
            sugarG: scalePer100g(p.sugarG, g),
            alcoholG: scalePer100g(p.alcoholG, g),
            caffeineMg: scalePer100g(p.caffeineMg, g),
        };
    }
    return null;
}

function memberRelated(member: ProductCheckMember) {
    return [
        {
            kind: "member" as const,
            id: member.id,
            name: member.name,
        },
    ];
}

function productSubject(product: ProductCheckInput) {
    return { kind: "food" as const, id: product.id };
}

function blockAllergenNotice(
    product: ProductCheckInput,
    member: ProductCheckMember,
    labels: string[],
): Notice {
    return {
        code: "food.product_allergen",
        severity: NOTICE_SEVERITY["food.product_allergen"],
        subject: productSubject(product),
        related: memberRelated(member),
        params: {
            name: product.name,
            allergens: labels,
        },
    };
}

function traceAllergenNotice(
    product: ProductCheckInput,
    member: ProductCheckMember,
    labels: string[],
): Notice {
    return {
        code: "food.product_trace",
        severity: NOTICE_SEVERITY["food.product_trace"],
        subject: productSubject(product),
        related: memberRelated(member),
        params: {
            name: product.name,
            allergens: labels,
        },
    };
}

function glutenWheatNotice(
    product: ProductCheckInput,
    member: ProductCheckMember,
): Notice {
    return {
        code: "food.product_gluten",
        severity: NOTICE_SEVERITY["food.product_gluten"],
        subject: productSubject(product),
        related: memberRelated(member),
        params: { name: product.name },
    };
}

function goalNotice(
    product: ProductCheckInput,
    member: ProductCheckMember,
    nutrient: ProductCheckNutrient,
    servingAmount: number,
    remaining: number,
): Notice {
    return {
        code: "food.product_goal",
        severity: NOTICE_SEVERITY["food.product_goal"],
        subject: productSubject(product),
        related: memberRelated(member),
        params: {
            name: product.name,
            nutrient,
            servingAmount: formatNutrientAmount(servingAmount),
            remainingAmount: formatNutrientAmount(remaining),
            unit:
                nutrient === "calories"
                    ? "cal"
                    : nutrient === "caffeine_mg"
                      ? "mg"
                      : "g",
            word: NUTRIENT_WORD[nutrient],
        },
    };
}

function dislikeNotice(
    product: ProductCheckInput,
    member: ProductCheckMember,
    dislike: string,
): Notice {
    return {
        code: "food.product_dislike",
        severity: NOTICE_SEVERITY["food.product_dislike"],
        subject: productSubject(product),
        related: memberRelated(member),
        params: { name: product.name, dislike },
    };
}

function allergenLabels(codes: Iterable<NamedAllergen>): string[] {
    return [...codes].map((code) => ALLERGEN_LABELS[code].toLowerCase());
}

function prepareDislikeText(text: string): string {
    return normalizeFoodName(text).replace(/'/g, "").replace(/&/g, " and ");
}

function singularizeDislikeToken(token: string): string {
    if (token.length > 3 && token.endsWith("ies")) {
        return `${token.slice(0, -3)}y`;
    }
    if (token.length > 3 && token.endsWith("oes")) {
        return `${token.slice(0, -3)}o`;
    }
    if (token.length > 4 && /(?:ses|xes|ches|shes)$/.test(token)) {
        return token.slice(0, -2);
    }
    if (
        token.length > 4 &&
        token.endsWith("es") &&
        !token.endsWith("oes") &&
        token[token.length - 3] === "o"
    ) {
        return token.slice(0, -2);
    }
    if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) {
        return token.slice(0, -1);
    }
    return token;
}

function dislikeTextTokens(text: string): string[] {
    return prepareDislikeText(text)
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .map(singularizeDislikeToken);
}

function productDislikeTokenList(product: ProductCheckInput): string[] {
    return dislikeTextTokens(
        `${product.name} ${product.ingredientsText ?? ""}`,
    );
}

function dislikeTokensMatch(
    productTokens: readonly string[],
    dislikeTokens: readonly string[],
): boolean {
    if (dislikeTokens.length === 0) return false;
    if (dislikeTokens.length === 1) {
        const needle = dislikeTokens[0]!;
        return productTokens.some((token) => token === needle);
    }
    for (let i = 0; i <= productTokens.length - dislikeTokens.length; i++) {
        let matched = true;
        for (let j = 0; j < dislikeTokens.length; j++) {
            if (productTokens[i + j] !== dislikeTokens[j]) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }
    return false;
}

export function productMatchesDislike(
    product: ProductCheckInput,
    dislike: string,
): boolean {
    const trimmed = dislike.trim();
    if (!trimmed) return false;
    const productTokens = productDislikeTokenList(product);
    const dislikeTokens = dislikeTextTokens(trimmed);
    return dislikeTokensMatch(productTokens, dislikeTokens);
}

export function checkProductForMember(
    product: ProductCheckInput,
    member: ProductCheckMember,
    today: ProductCheckToday,
): Notice[] {
    const notices: Notice[] = [];

    const contains = namedAllergensInTags(product.allergensTags);
    const memberAllergens = memberNamedAllergens(member);
    const blockHits = [...memberAllergens].filter((code) => contains.has(code));
    if (blockHits.length > 0) {
        notices.push(
            blockAllergenNotice(product, member, allergenLabels(blockHits)),
        );
    }
    if (
        memberAllergens.has("wheat") &&
        containsGlutenTag(product.allergensTags) &&
        !blockHits.includes("wheat")
    ) {
        notices.push(glutenWheatNotice(product, member));
    }

    const traces = namedAllergensInTags(product.tracesTags);
    const traceHits = [...memberAllergens].filter((code) => traces.has(code));
    if (traceHits.length > 0) {
        notices.push(
            traceAllergenNotice(product, member, allergenLabels(traceHits)),
        );
    }
    const glutenWarned = notices.some((n) => n.code === "food.product_gluten");
    if (
        memberAllergens.has("wheat") &&
        containsGlutenTag(product.tracesTags) &&
        !traceHits.includes("wheat") &&
        !glutenWarned
    ) {
        notices.push(glutenWheatNotice(product, member));
    }

    const serving = servingNutritionFor(product);
    if (serving != null) {
        for (const nutrient of Object.keys(
            today.remaining,
        ) as ProductCheckNutrient[]) {
            const remaining = today.remaining[nutrient];
            if (remaining == null) continue;
            const key = NUTRIENT_SERVING_KEY[nutrient];
            const raw = serving[key];
            if (typeof raw !== "number") continue;
            notices.push(goalNotice(product, member, nutrient, raw, remaining));
        }
    }

    for (const dislike of member.dislikes) {
        if (productMatchesDislike(product, dislike)) {
            notices.push(dislikeNotice(product, member, dislike.trim()));
        }
    }

    return sortNotices(notices);
}
