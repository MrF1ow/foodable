import type { NutrientLevel } from "./product-score.js";

const OFF_NUTRIENT_LEVELS = new Set<NutrientLevel>(["low", "moderate", "high"]);

export function parseOffNutrientLevel(raw: string): NutrientLevel | null {
    const level = raw.trim().toLowerCase();
    return OFF_NUTRIENT_LEVELS.has(level as NutrientLevel)
        ? (level as NutrientLevel)
        : null;
}

/** Keep only OFF low/moderate/high values; empty or invalid input → null. */
export function filterOffNutrientLevels(
    raw: unknown,
): Record<string, NutrientLevel> | null {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const out: Record<string, NutrientLevel> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        const level = parseOffNutrientLevel(value);
        if (level) out[key] = level;
    }
    return Object.keys(out).length > 0 ? out : null;
}
