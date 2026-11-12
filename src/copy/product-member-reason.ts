import type { Notice } from "../domain/notices.js";

function capitalizeWord(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function allergenPhrase(allergens: string[]): string {
    if (allergens.length === 0) return "allergen";
    if (allergens.length === 1) return capitalizeWord(allergens[0]!);
    const head = allergens.slice(0, -1).map(capitalizeWord).join(", ");
    const last = capitalizeWord(allergens[allergens.length - 1]!);
    return `${head} and ${last}`;
}

function productGoalLine(notice: Notice): string {
    const serving = Number(notice.params.servingAmount);
    const remaining = Number(notice.params.remainingAmount);
    const word = String(notice.params.word);
    const unit = String(notice.params.unit);
    if (Number.isNaN(serving) || Number.isNaN(remaining)) {
        return "Fits today";
    }
    const goal =
        unit === "cal"
            ? Math.round(serving + remaining)
            : Math.round((serving + remaining) * 10) / 10;
    const servingText = String(notice.params.servingAmount);
    const goalText =
        unit === "cal"
            ? String(goal)
            : Number.isInteger(goal)
              ? String(goal)
              : goal.toFixed(1);
    if (unit === "cal") {
        return `Fits today · ${servingText} cal toward your ${goalText} cal`;
    }
    if (unit === "mg") {
        return `Fits today · ${servingText} mg ${word} toward your ${goalText} mg`;
    }
    return `Fits today · ${servingText} g ${word} toward your ${goalText} g`;
}

/** One-line reason under a household member on the product score screen. */
export function productMemberReasonLine(notices: readonly Notice[]): string {
    if (notices.length === 0) {
        return "No issues found for this product.";
    }
    const notice = notices[0]!;
    switch (notice.code) {
        case "food.product_allergen": {
            const allergens = (notice.params.allergens ?? []) as string[];
            return `Contains ${allergenPhrase(allergens)} · listed as an allergy`;
        }
        case "food.product_trace": {
            const allergens = (notice.params.allergens ?? []) as string[];
            const label = allergenPhrase(allergens).toLowerCase();
            return `May contain traces of ${label}`;
        }
        case "food.product_gluten":
            return "Possible wheat (contains gluten)";
        case "food.product_goal":
            return productGoalLine(notice);
        case "food.product_dislike": {
            const dislike = String(notice.params.dislike);
            return `Matches dislike · ${dislike}`;
        }
        default:
            return "No issues found for this product.";
    }
}
