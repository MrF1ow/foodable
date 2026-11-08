import { additiveRisk, type AdditiveRisk } from "./additive-risk.js";

export type { AdditiveRisk };

export type OffProductQuality = {
    nutriscore_grade: "a" | "b" | "c" | "d" | "e" | null;
    nova_group: 1 | 2 | 3 | 4 | null;
    ecoscore_grade: "a-plus" | "a" | "b" | "c" | "d" | "e" | "f" | null;
    additives_tags: string[] | null;
    allergens_tags: string[] | null;
    traces_tags: string[] | null;
    ingredients_analysis_tags: string[] | null;
    labels_tags: string[] | null;
    fetched_at: string;
};

const NUTRISCORE_GRADES = ["a", "b", "c", "d", "e"] as const;
const ECOSCORE_GRADES = ["a-plus", "a", "b", "c", "d", "e", "f"] as const;

export function normalizeNutriscoreGrade(
    value: unknown,
): OffProductQuality["nutriscore_grade"] {
    const grade = String(value ?? "")
        .trim()
        .toLowerCase();
    return (NUTRISCORE_GRADES as readonly string[]).includes(grade)
        ? (grade as OffProductQuality["nutriscore_grade"])
        : null;
}

export function normalizeNovaGroup(
    value: unknown,
): OffProductQuality["nova_group"] {
    const group = typeof value === "string" ? parseFloat(value) : value;
    return group === 1 || group === 2 || group === 3 || group === 4
        ? group
        : null;
}

export function normalizeEcoscoreGrade(
    value: unknown,
    alt?: unknown,
): OffProductQuality["ecoscore_grade"] {
    const raw =
        value != null && String(value).trim() !== ""
            ? value
            : alt != null && String(alt).trim() !== ""
              ? alt
              : null;
    if (raw == null) return null;
    let grade = String(raw).trim().toLowerCase();
    if (grade === "a+") grade = "a-plus";
    return (ECOSCORE_GRADES as readonly string[]).includes(grade)
        ? (grade as OffProductQuality["ecoscore_grade"])
        : null;
}

function normalizeTagArray(value: unknown): string[] | null {
    if (value == null) return null;
    if (!Array.isArray(value)) return null;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (typeof item !== "string") continue;
        const tag = item.trim().toLowerCase();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        out.push(tag);
    }
    return out;
}

function offRecord(product: unknown): Record<string, unknown> | null {
    if (product == null || typeof product !== "object") return null;
    return product as Record<string, unknown>;
}

export function qualityFromOff(
    product: unknown,
    fetchedAt: string,
): OffProductQuality {
    const p = offRecord(product);
    const nutriscore = normalizeNutriscoreGrade(p?.nutriscore_grade);
    const nova = normalizeNovaGroup(p?.nova_group);
    const ecoscore = normalizeEcoscoreGrade(
        p?.ecoscore_grade,
        p?.environmental_score_grade,
    );
    return {
        nutriscore_grade: nutriscore,
        nova_group: nova,
        ecoscore_grade: ecoscore,
        additives_tags: normalizeTagArray(p?.additives_tags),
        allergens_tags: normalizeTagArray(p?.allergens_tags),
        traces_tags: normalizeTagArray(p?.traces_tags),
        ingredients_analysis_tags: normalizeTagArray(
            p?.ingredients_analysis_tags,
        ),
        labels_tags: normalizeTagArray(p?.labels_tags),
        fetched_at: fetchedAt,
    };
}
