export const NUTRITION_CARDS = [
    "nutrition-summary",
    "goal-progress",
    "trends",
    "weight-trends",
] as const;

export type NutritionCard = (typeof NUTRITION_CARDS)[number];

const CARD_SET = new Set<string>(NUTRITION_CARDS);

export function isNutritionCard(key: string): key is NutritionCard {
    return CARD_SET.has(key);
}
