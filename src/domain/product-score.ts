import { parseOffNutrientLevel } from "./off-nutrient-levels.js";

export type NutrientLevel = "low" | "moderate" | "high";

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
