import type { Notice, NoticeCode } from "../domain/notices.js";
import type { RecipeGapNutrient } from "../domain/recipes.js";

export type NoticeRoute = "usualProductPicker";

export type NoticeCopy = {
    badge: string;
    sentence: (notice: Notice) => string;
    action?: { label: string; to: NoticeRoute };
    help: string;
    dismissible: boolean;
    badgeTone?: "bad" | "warn" | "dim";
};

export const UNKNOWN_ALLERGEN_TEXT = "unknown allergen data";

export function fridgeExpiryLine(p: {
    name: string;
    amount: number;
    unit: string;
    expiresOn: string;
}): string {
    return `${p.name} ${p.amount} ${p.unit} expires ${p.expiresOn}`;
}

function fridgeSentence(notice: Notice): string {
    return fridgeExpiryLine({
        name: String(notice.params.name),
        amount: Number(notice.params.amount),
        unit: String(notice.params.unit),
        expiresOn: String(notice.params.expiresOn),
    });
}

/** Today's `groceryAllergenWarning` text: the first allergen, then every affected member. */
function allergenSentence(notice: Notice): string {
    const allergens = (notice.params.allergens ?? []) as string[];
    const label = allergens[0] ?? "allergen";
    const names = notice.related.map((r) => r.name);
    return `Contains ${label} — ${names.join(", ")}.`;
}

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
    "fridge.expired": {
        badge: "Expired",
        badgeTone: "bad",
        sentence: fridgeSentence,
        help: "expiry-levels",
        dismissible: false,
    },
    "fridge.expiring": {
        badge: "Expiring soon",
        sentence: fridgeSentence,
        help: "expiry-levels",
        dismissible: false,
    },
    "grocery.allergen": {
        badge: "Allergen",
        sentence: allergenSentence,
        help: "allergens",
        dismissible: false,
    },
    "recipe.allergen": {
        badge: "Allergen",
        sentence: allergenSentence,
        help: "allergens",
        dismissible: false,
    },
    "recipe.no_food": {
        badge: "Not linked",
        sentence: (notice) =>
            `${String(notice.params.name)}: not linked to a food`,
        help: "usual-products",
        dismissible: false,
    },
    "recipe.no_amount": {
        badge: "No amount",
        sentence: (notice) =>
            `${String(notice.params.name)} has no amount (${String(notice.params.taste ?? "to taste")}), so it isn't counted.`,
        help: "recipe-portions",
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
