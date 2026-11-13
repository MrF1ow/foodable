import type {
    NutrientLevel,
    ProductScore,
    ScorePart,
    ScoreQuality,
} from "./product-score.js";

/**
 * How one line of the score breakdown reads, shared by the household app's
 * Product screen and the `rate_product` tool, so the two say the same thing
 * in the same words.
 */
export type PartStatus = "good" | "warn" | "over";

export const SCORE_PART_LABELS: Record<ScorePart, string> = {
    nutrition: "Nutri-Score",
    processing: "Processing",
    additives: "Additives",
    environment: "Green-Score",
};

const NOVA_LABEL: Record<1 | 2 | 3 | 4, string> = {
    1: "NOVA 1 · unprocessed",
    2: "NOVA 2 · processed culinary",
    3: "NOVA 3 · processed",
    4: "NOVA 4 · ultra-processed",
};

export function nutriscoreStatus(
    grade: NonNullable<ScoreQuality["nutriscoreGrade"]>,
): PartStatus {
    if (grade === "a" || grade === "b") return "good";
    if (grade === "c") return "warn";
    return "over";
}

/** A nutrient's low / moderate / high level as a status; unknown reads warn. */
export function levelStatus(level: NutrientLevel | null): PartStatus {
    if (level === "low") return "good";
    if (level === "moderate") return "warn";
    if (level === "high") return "over";
    return "warn";
}

/** A 0–100 part value: 70 and up good, 40 and up warn, below that over. */
export function partValueStatus(value: number): PartStatus {
    if (value >= 70) return "good";
    if (value >= 40) return "warn";
    return "over";
}

function formatEco(grade: NonNullable<ScoreQuality["ecoscoreGrade"]>): string {
    return grade === "a-plus" ? "A+" : grade.toUpperCase();
}

function additivesLabel(quality: ScoreQuality): string {
    const list = quality.additives;
    if (list == null) return "–";
    if (list.length === 0) return "None";
    const high = list.filter((row) => row.risk === "high").length;
    return high > 0
        ? `${list.length} additive(s), ${high} high risk`
        : `${list.length} additive(s)`;
}

/**
 * What the breakdown shows for one part: its label, the value as the app
 * words it and the status colouring it. Null when the product has no data for
 * that part.
 */
export function breakdownValue(
    part: ScorePart,
    quality: ScoreQuality,
    scored: Pick<ProductScore, "breakdown">,
): { label: string; value: string; status: PartStatus } | null {
    const entry = scored.breakdown.find((row) => row.part === part);
    const label = SCORE_PART_LABELS[part];
    if (part === "nutrition" && quality.nutriscoreGrade != null) {
        const g = quality.nutriscoreGrade;
        return { label, value: g.toUpperCase(), status: nutriscoreStatus(g) };
    }
    if (part === "processing" && quality.novaGroup != null) {
        const status =
            entry?.value != null
                ? partValueStatus(entry.value)
                : partValueStatus(50);
        return { label, value: NOVA_LABEL[quality.novaGroup], status };
    }
    if (part === "additives" && quality.additives != null) {
        const status =
            entry?.value != null ? partValueStatus(entry.value) : "good";
        return { label, value: additivesLabel(quality), status };
    }
    if (part === "environment" && quality.ecoscoreGrade != null) {
        const status =
            entry?.value != null
                ? partValueStatus(entry.value)
                : partValueStatus(50);
        return { label, value: formatEco(quality.ecoscoreGrade), status };
    }
    return null;
}
