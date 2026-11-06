import type { Notice, NoticeCode } from "../domain/notices.js";
import type { RecipeGapNutrient } from "../domain/recipes.js";

export type NoticeRoute = "usualProductPicker";

export type NoticeCopy = {
    badge: string;
    sentence: (notice: Notice) => string;
    action?: { label: string; to: NoticeRoute };
    help: string;
    dismissible: boolean;
};

const NUTRIENT_WORD: Record<RecipeGapNutrient, string> = {
    calories: "calories",
    protein_g: "protein",
    carbs_g: "carbs",
    fat_g: "fat",
};

export function formatMissingNutrientList(
    missing: RecipeGapNutrient[],
): string {
    const words = missing.map((key) => NUTRIENT_WORD[key]);
    if (words.length === 1) return words[0]!;
    if (words.length === 2) return `${words[0]} and ${words[1]}`;
    return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export const NOTICE_COPY: Record<NoticeCode, NoticeCopy> = {
    "recipe.no_food": {
        badge: "Not linked",
        sentence: (notice) =>
            `${String(notice.params.name)}: not linked to a food`,
        help: "usual-products",
        dismissible: false,
    },
    "recipe.no_nutrition": {
        badge: "No nutrition",
        sentence: (notice) => {
            const name = String(notice.params.name);
            const usual = notice.related[0]?.name;
            return usual
                ? `${name}: no nutrition — its usual product, ${usual}, has none either`
                : `${name}: no nutrition — add it, or pick a usual product`;
        },
        action: { label: "Pick usual product", to: "usualProductPicker" },
        help: "usual-products",
        dismissible: false,
    },
    "recipe.partial_nutrition": {
        badge: "Partial nutrition",
        sentence: (notice) =>
            `${String(notice.params.name)}: missing ${formatMissingNutrientList((notice.params.missing ?? []) as RecipeGapNutrient[])}`,
        help: "usual-products",
        dismissible: false,
    },
    "recipe.unknown_unit": {
        badge: "Unknown unit",
        sentence: (notice) => `${String(notice.params.name)}: unknown unit`,
        help: "recipe-portions",
        dismissible: false,
    },
    "recipe.missing_grams_per_each": {
        badge: "Grams per each",
        sentence: (notice) =>
            `${String(notice.params.name)}: set grams per each`,
        help: "recipe-portions",
        dismissible: false,
    },
    "recipe.missing_grams_per_ml": {
        badge: "Grams per ml",
        sentence: (notice) =>
            `${String(notice.params.name)}: set grams per millilitre`,
        help: "recipe-portions",
        dismissible: false,
    },
};

export function noticeSentence(notice: Notice): string {
    return NOTICE_COPY[notice.code].sentence(notice);
}
