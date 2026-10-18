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

export function orderCards(
    saved: readonly string[] | null | undefined,
): NutritionCard[] {
    const out: NutritionCard[] = [];
    const seen = new Set<NutritionCard>();
    if (saved) {
        for (const key of saved) {
            if (!isNutritionCard(key) || seen.has(key)) continue;
            seen.add(key);
            out.push(key);
        }
    }
    for (const key of NUTRITION_CARDS) {
        if (!seen.has(key)) out.push(key);
    }
    return out;
}

export type NutritionLayoutOrderError =
    "missing-card" | "unknown-card" | "duplicate-card" | "wrong-length";

export function validateNutritionLayoutOrder(
    submitted: readonly string[],
): NutritionCard[] | NutritionLayoutOrderError {
    if (submitted.length !== NUTRITION_CARDS.length) {
        return "wrong-length";
    }
    const seen = new Set<NutritionCard>();
    const out: NutritionCard[] = [];
    for (const key of submitted) {
        if (!isNutritionCard(key)) return "unknown-card";
        if (seen.has(key)) return "duplicate-card";
        seen.add(key);
        out.push(key);
    }
    for (const key of NUTRITION_CARDS) {
        if (!seen.has(key)) return "missing-card";
    }
    return out;
}

export function nutritionLayoutOrderErrorMessage(
    err: NutritionLayoutOrderError,
): string {
    switch (err) {
        case "unknown-card":
            return "Unknown card.";
        case "duplicate-card":
            return "Duplicate card in order.";
        case "missing-card":
            return "Missing card in order.";
        case "wrong-length":
            return "Invalid card order.";
    }
}

export function moveCard(
    order: readonly NutritionCard[],
    key: NutritionCard,
    direction: "up" | "down",
): NutritionCard[] {
    const index = order.indexOf(key);
    if (index === -1) return [...order];
    const swap = direction === "up" ? index - 1 : index + 1;
    if (swap < 0 || swap >= order.length) return [...order];
    const next = [...order];
    [next[index], next[swap]] = [next[swap]!, next[index]!];
    return next;
}
