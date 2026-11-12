import { z } from "zod";
import type { AdditiveRisk } from "./additive-risk.js";
import { parseOffNutrientLevel } from "./off-nutrient-levels.js";

export type NutrientLevel = "low" | "moderate" | "high";

export type ScorePart =
    "nutrition" | "processing" | "additives" | "environment";

export type ScoreWeights = Record<ScorePart, number>;

export const SCORE_PARTS: readonly ScorePart[] = [
    "nutrition",
    "processing",
    "additives",
    "environment",
] as const;

/*
 * Additive part penalties (chosen against OFF fixtures, Yuka-like sensitivity):
 * - high −15 each, any high-risk additive caps the part score at 40 (budget ceiling)
 * - moderate −6, none 0, unknown tier −2 (OFF lists the tag but we have no tier)
 * Minimum known configured weight share 0.5: fewer than half the preset points with
 * real data yields not_enough_data instead of a misleading average.
 */
const ADDITIVE_PENALTY: Record<AdditiveRisk | "unknown", number> = {
    high: 15,
    moderate: 6,
    none: 0,
    unknown: 2,
};
const ADDITIVE_HIGH_RISK_CAP = 40;
const MIN_KNOWN_WEIGHT_SHARE = 0.5;

export const SCORE_PRESETS = {
    balanced: {
        nutrition: 40,
        processing: 25,
        additives: 20,
        environment: 15,
    },
    health_first: {
        nutrition: 60,
        processing: 15,
        additives: 20,
        environment: 5,
    },
    less_processed: {
        nutrition: 20,
        processing: 50,
        additives: 25,
        environment: 5,
    },
    planet: {
        nutrition: 25,
        processing: 15,
        additives: 10,
        environment: 50,
    },
} as const satisfies Record<string, ScoreWeights>;

export type ScorePresetId = keyof typeof SCORE_PRESETS;

export const DEFAULT_SCORE_PRESET: ScorePresetId = "balanced";

export const SCORE_PRESET_LABELS: Record<ScorePresetId | "custom", string> = {
    balanced: "Balanced",
    health_first: "Health first",
    less_processed: "Less processed",
    planet: "Planet",
    custom: "Custom",
};

/** Each custom weight is a whole number from 0 to 100 (a slider step). */
export const SCORE_WEIGHT_MIN = 0;
export const SCORE_WEIGHT_MAX = 100;

export const SCORE_WEIGHTS_SUM_ERROR =
    "Give at least one part a weight above 0.";
export const SCORE_WEIGHT_RANGE_ERROR = `Each weight is a whole number from ${SCORE_WEIGHT_MIN} to ${SCORE_WEIGHT_MAX}.`;
export const SCORE_PRESET_ERROR = "Pick a score preset.";

/** A way of weighting the score: a named preset, or four custom weights. */
export type ScoreChoicePreset = ScorePresetId | "custom";

export type ScoreChoice = {
    preset: ScoreChoicePreset;
    /** Set only for `custom`; a preset carries its own weights. */
    weights: ScoreWeights | null;
};

const weightSchema = z
    .number()
    .int()
    .min(SCORE_WEIGHT_MIN)
    .max(SCORE_WEIGHT_MAX);

const weightsSchema = z.object({
    nutrition: weightSchema,
    processing: weightSchema,
    additives: weightSchema,
    environment: weightSchema,
});

const presetSchema = z.enum([
    "balanced",
    "health_first",
    "less_processed",
    "planet",
    "custom",
] satisfies ScoreChoicePreset[]);

function weightsSum(w: ScoreWeights): number {
    return SCORE_PARTS.reduce((s, p) => s + w[p], 0);
}

/** Custom weights that are well-formed and not all zero, else null. */
function usableCustomWeights(raw: unknown): ScoreWeights | null {
    const parsed = weightsSchema.safeParse(raw);
    if (!parsed.success) return null;
    return weightsSum(parsed.data) > 0 ? parsed.data : null;
}

/**
 * Reads a stored choice (`{preset, weights}` jsonb). A preset row keeps the
 * preset and drops its weights, so a corrupt weights value cannot hurt it. A
 * custom row whose weights are invalid stays `custom` with no weights, which
 * `resolveWeights` treats as no choice. An unknown preset or a non-object is
 * no choice at all (null).
 */
export function parseScoreChoice(raw: unknown): ScoreChoice | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const preset = presetSchema.safeParse(record.preset);
    if (!preset.success) return null;
    if (preset.data !== "custom") {
        return { preset: preset.data, weights: null };
    }
    return { preset: "custom", weights: usableCustomWeights(record.weights) };
}

/** Checks a choice a person is saving; the handler calls this before any write. */
export function validateScoreChoice(
    raw: unknown,
): { ok: true; value: ScoreChoice } | { ok: false; error: string } {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ok: false, error: SCORE_PRESET_ERROR };
    }
    const record = raw as Record<string, unknown>;
    const preset = presetSchema.safeParse(record.preset);
    if (!preset.success) return { ok: false, error: SCORE_PRESET_ERROR };
    if (preset.data !== "custom") {
        return { ok: true, value: { preset: preset.data, weights: null } };
    }
    const weights = weightsSchema.safeParse(record.weights);
    if (!weights.success) {
        return { ok: false, error: SCORE_WEIGHT_RANGE_ERROR };
    }
    if (weightsSum(weights.data) <= 0) {
        return { ok: false, error: SCORE_WEIGHTS_SUM_ERROR };
    }
    return { ok: true, value: { preset: "custom", weights: weights.data } };
}

function weightsOfChoice(choice: ScoreChoice | null): ScoreWeights | null {
    if (!choice) return null;
    if (choice.preset === "custom") return usableCustomWeights(choice.weights);
    return SCORE_PRESETS[choice.preset];
}

/**
 * The weights a viewer's scores use: their own choice, else the household
 * default, else Balanced. A choice that cannot produce weights (custom with
 * none or all-zero) counts as unset, so a bad row never blanks the score.
 */
export function resolveWeights(
    member: ScoreChoice | null,
    householdDefault: ScoreChoice | null,
): ScoreWeights {
    return (
        weightsOfChoice(member) ??
        weightsOfChoice(householdDefault) ??
        SCORE_PRESETS[DEFAULT_SCORE_PRESET]
    );
}

export type ScoreQuality = {
    nutriscoreGrade: "a" | "b" | "c" | "d" | "e" | null;
    novaGroup: 1 | 2 | 3 | 4 | null;
    ecoscoreGrade: "a-plus" | "a" | "b" | "c" | "d" | "e" | "f" | null;
    additives: { tag: string; risk: AdditiveRisk | null }[] | null;
};

export type ProductScoreLabel =
    "good" | "middling" | "poor" | "not_enough_data";

export type ScoreBreakdownEntry = {
    part: ScorePart;
    value: number | null;
    weight: number;
    known: boolean;
    source: string | null;
};

export type ProductScore = {
    score: number | null;
    label: ProductScoreLabel;
    breakdown: ScoreBreakdownEntry[];
    partsUsed: number;
    partsTotal: number;
    missing: ScorePart[];
};

export type ProductInfoRow = {
    kind: "sugars" | "saturated-fat";
    per100g: number | null;
    level: NutrientLevel | null;
};

export type ProductInfoInput = {
    sugarG: number | null;
    saturatedFatG: number | null;
    offNutrientLevels: Record<string, NutrientLevel> | null;
};

// UK FSA / OFF solid-food thresholds (per 100 g): sugars low ≤ 5 g, high > 22.5 g;
// saturated fat low ≤ 1.5 g, high > 5 g.
export function nutrientLevel(
    kind: "sugars" | "saturated-fat",
    per100g: number | null,
    offLevels: Record<string, string> | null,
): NutrientLevel | null {
    const offKey = kind;
    const raw = offLevels?.[offKey];
    if (raw != null) {
        const level = parseOffNutrientLevel(raw);
        if (level) return level;
    }
    if (per100g == null) return null;
    if (kind === "sugars") {
        if (per100g <= 5) return "low";
        if (per100g > 22.5) return "high";
        return "moderate";
    }
    if (per100g <= 1.5) return "low";
    if (per100g > 5) return "high";
    return "moderate";
}

const NUTRISCORE_POINTS: Record<
    NonNullable<ScoreQuality["nutriscoreGrade"]>,
    number
> = {
    a: 100,
    b: 75,
    c: 50,
    d: 25,
    e: 0,
};

const NOVA_POINTS: Record<NonNullable<ScoreQuality["novaGroup"]>, number> = {
    1: 100,
    2: 67,
    3: 33,
    4: 0,
};

const ECOSCORE_POINTS: Record<
    NonNullable<ScoreQuality["ecoscoreGrade"]>,
    number
> = {
    "a-plus": 100,
    a: 85,
    b: 70,
    c: 50,
    d: 30,
    e: 15,
    f: 0,
};

function nutritionPart(quality: ScoreQuality): {
    value: number | null;
    source: string | null;
} {
    const g = quality.nutriscoreGrade;
    if (g == null) return { value: null, source: null };
    return { value: NUTRISCORE_POINTS[g], source: `nutriscore ${g}` };
}

function processingPart(quality: ScoreQuality): {
    value: number | null;
    source: string | null;
} {
    const n = quality.novaGroup;
    if (n == null) return { value: null, source: null };
    return { value: NOVA_POINTS[n], source: `nova ${n}` };
}

function environmentPart(quality: ScoreQuality): {
    value: number | null;
    source: string | null;
} {
    const g = quality.ecoscoreGrade;
    if (g == null) return { value: null, source: null };
    return { value: ECOSCORE_POINTS[g], source: `ecoscore ${g}` };
}

function additivesPart(quality: ScoreQuality): {
    value: number | null;
    source: string | null;
} {
    const list = quality.additives;
    if (list == null) return { value: null, source: null };
    if (list.length === 0) {
        return { value: 100, source: "no additives listed" };
    }
    let score = 100;
    let hasHigh = false;
    let highCount = 0;
    for (const { risk } of list) {
        const tier: AdditiveRisk | "unknown" =
            risk === "high" || risk === "moderate" || risk === "none"
                ? risk
                : "unknown";
        score -= ADDITIVE_PENALTY[tier];
        if (risk === "high") {
            hasHigh = true;
            highCount += 1;
        }
    }
    if (hasHigh) score = Math.min(score, ADDITIVE_HIGH_RISK_CAP);
    score = Math.max(0, Math.min(100, score));
    return {
        value: score,
        source:
            highCount > 0
                ? `${list.length} additive(s), ${highCount} high risk`
                : `${list.length} additive(s)`,
    };
}

function partResult(
    part: ScorePart,
    quality: ScoreQuality,
): { value: number | null; source: string | null } {
    switch (part) {
        case "nutrition":
            return nutritionPart(quality);
        case "processing":
            return processingPart(quality);
        case "additives":
            return additivesPart(quality);
        case "environment":
            return environmentPart(quality);
    }
}

function scoreLabel(
    score: number,
): Exclude<ProductScoreLabel, "not_enough_data"> {
    if (score >= 70) return "good";
    if (score >= 40) return "middling";
    return "poor";
}

export function scoreProduct(
    quality: ScoreQuality,
    weights: ScoreWeights,
): ProductScore {
    const partsTotal = SCORE_PARTS.length;
    // A negative, NaN or infinite custom weight counts as 0, so it can neither
    // shrink the total that the minimum-data share is measured against nor
    // turn the score into NaN.
    const configuredWeight = (part: ScorePart): number => {
        const w = weights[part];
        return Number.isFinite(w) && w > 0 ? w : 0;
    };
    const totalConfigured = SCORE_PARTS.reduce(
        (s, p) => s + configuredWeight(p),
        0,
    );

    const breakdown: ScoreBreakdownEntry[] = [];
    const missing: ScorePart[] = [];
    const usable: { part: ScorePart; value: number; configured: number }[] = [];

    for (const part of SCORE_PARTS) {
        const { value, source } = partResult(part, quality);
        const configured = configuredWeight(part);
        const known = value != null;
        if (!known) missing.push(part);
        if (known && configured > 0) {
            usable.push({ part, value, configured });
        }
        breakdown.push({
            part,
            value,
            weight: 0,
            known,
            source,
        });
    }

    const partsUsed = partsTotal - missing.length;
    const knownConfigured = usable.reduce((s, u) => s + u.configured, 0);

    if (
        knownConfigured <= 0 ||
        knownConfigured / totalConfigured < MIN_KNOWN_WEIGHT_SHARE
    ) {
        return {
            score: null,
            label: "not_enough_data",
            breakdown,
            partsUsed,
            partsTotal,
            missing,
        };
    }

    let weighted = 0;
    for (const u of usable) {
        const effective = u.configured / knownConfigured;
        weighted += u.value * effective;
        const entry = breakdown.find((b) => b.part === u.part);
        if (entry) entry.weight = effective;
    }

    const score = Math.round(Math.max(0, Math.min(100, weighted)));

    return {
        score,
        label: scoreLabel(score),
        breakdown,
        partsUsed,
        partsTotal,
        missing,
    };
}

export function productInfoRows(food: ProductInfoInput): ProductInfoRow[] {
    const offRaw =
        food.offNutrientLevels == null
            ? null
            : Object.fromEntries(
                  Object.entries(food.offNutrientLevels).map(([k, v]) => [
                      k,
                      v,
                  ]),
              );
    return [
        {
            kind: "sugars",
            per100g: food.sugarG,
            level: nutrientLevel("sugars", food.sugarG, offRaw),
        },
        {
            kind: "saturated-fat",
            per100g: food.saturatedFatG,
            level: nutrientLevel("saturated-fat", food.saturatedFatG, offRaw),
        },
    ];
}
