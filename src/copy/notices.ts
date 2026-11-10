import type { Notice, NoticeCode } from "../domain/notices.js";
import type { RecipeGapNutrient } from "../domain/recipes.js";

export type NoticeRoute =
    "usualProductPicker" | "addFridgeItemToGrocery" | "possibleDuplicatePair";

export const POSSIBLE_DUPLICATE_OF_PREFIX = "Possible duplicate of";

export function possibleDuplicateOfText(otherName: string): string {
    return `${POSSIBLE_DUPLICATE_OF_PREFIX} ${otherName}`;
}

export type NoticeCopy = {
    badge: string;
    sentence: (notice: Notice) => string;
    action?: {
        label: string;
        to: NoticeRoute;
        method?: "get" | "post";
        when?: (notice: Notice) => boolean;
    };
    help: string;
    dismissible: boolean;
    dismissLabel?: string;
    dismissPair?: true;
    badgeTone?: "bad" | "warn" | "dim";
};

export const ON_GROCERY_LIST_TEXT = "on the grocery list";

export function noticeDismissLabel(code: NoticeCode): string {
    return NOTICE_COPY[code].dismissLabel ?? "Dismiss";
}

export function noticeCodeDismissible(code: NoticeCode): boolean {
    return NOTICE_COPY[code].dismissible;
}

export function noticeDismissPair(code: NoticeCode): boolean {
    return NOTICE_COPY[code].dismissPair === true;
}

export const UNKNOWN_ALLERGEN_TEXT = "unknown allergen data";

export function fridgeExpiryLine(p: {
    name: string;
    amount: number;
    unit: string;
    expiresOn: string;
}): string {
    return `${p.name} ${p.amount} ${p.unit} expires ${p.expiresOn}`;
}

function fridgeExpirySentence(notice: Notice): string {
    return fridgeExpiryLine({
        name: String(notice.params.name),
        amount: Number(notice.params.amount),
        unit: String(notice.params.unit),
        expiresOn: String(notice.params.expiresOn),
    });
}

function fridgeExpiredSentence(notice: Notice): string {
    if (notice.params.onGroceryList === "yes") {
        return `${String(notice.params.name)} expired · ${ON_GROCERY_LIST_TEXT}`;
    }
    return fridgeExpirySentence(notice);
}

function restockWhen(expiresOn: string, daysLeft: number): string {
    if (daysLeft < 0) return "expired";
    if (daysLeft === 0) return "today";
    if (daysLeft === 1) return "tomorrow";
    return new Date(`${expiresOn}T00:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: "UTC",
    });
}

function groceryRestockedSentence(notice: Notice): string {
    const itemName =
        typeof notice.params.itemName === "string"
            ? notice.params.itemName
            : null;
    const expiresOn =
        typeof notice.params.expiresOn === "string"
            ? notice.params.expiresOn
            : "";
    const daysLeft =
        typeof notice.params.daysLeft === "number"
            ? notice.params.daysLeft
            : null;
    // No item, or an undated one: there is no expiry to name.
    if (itemName == null || expiresOn === "" || daysLeft == null) {
        return "Added by restock";
    }
    const when = restockWhen(expiresOn, daysLeft);
    if (when === "expired") {
        return `Added because ${itemName} expired`;
    }
    return `Added because ${itemName} expires ${when}`;
}

function fridgeExpiringSentence(notice: Notice): string {
    if (notice.params.onGroceryList === "yes") {
        const name = String(notice.params.name);
        const daysLeft = Number(notice.params.daysLeft);
        const expiresOn = String(notice.params.expiresOn);
        let when: string;
        if (daysLeft === 0) when = "today";
        else if (daysLeft === 1) when = "tomorrow";
        else {
            when = new Date(`${expiresOn}T00:00:00Z`).toLocaleDateString(
                "en-US",
                { weekday: "long", timeZone: "UTC" },
            );
        }
        return `${name} expires ${when} · ${ON_GROCERY_LIST_TEXT}`;
    }
    return fridgeExpirySentence(notice);
}

function formatAllergenList(allergens: string[]): string {
    if (allergens.length === 0) return "allergen";
    if (allergens.length === 1) return allergens[0]!;
    if (allergens.length === 2) {
        return `${allergens[0]} and ${allergens[1]}`;
    }
    return `${allergens.slice(0, -1).join(", ")} and ${allergens[allergens.length - 1]}`;
}

/** Grocery allergen block notice: every matched allergen, then every affected member. */
function allergenSentence(notice: Notice): string {
    const allergens = (notice.params.allergens ?? []) as string[];
    const label = formatAllergenList(allergens);
    const names = notice.related.map((r) => r.name);
    return `Contains ${label} — ${names.join(", ")}.`;
}

function productAllergenSentence(notice: Notice): string {
    return allergenSentence(notice);
}

function productTraceSentence(notice: Notice): string {
    const allergens = (notice.params.allergens ?? []) as string[];
    const label = formatAllergenList(allergens);
    const names = notice.related.map((r) => r.name);
    return `May contain ${label} — ${names.join(", ")}.`;
}

function productGlutenSentence(_notice: Notice): string {
    return "Possible wheat (contains gluten)";
}

function productGoalSentence(notice: Notice): string {
    const serving = String(notice.params.servingAmount);
    const remaining = String(notice.params.remainingAmount);
    const remainingNum = Number(notice.params.remainingAmount);
    const noneLeft =
        notice.params.remainingAmount !== "" &&
        !Number.isNaN(remainingNum) &&
        Math.round(remainingNum * 10) / 10 <= 0;
    const word = String(notice.params.word);
    const unit = String(notice.params.unit);
    if (unit === "cal") {
        if (noneLeft) return `${serving} ${word}, none left today`;
        return `${serving} ${word}, ${remaining} ${word} left today`;
    }
    if (unit === "mg") {
        if (noneLeft) return `${serving} mg ${word}, none left today`;
        return `${serving} mg ${word}, ${remaining} mg left today`;
    }
    if (noneLeft) return `${serving} g ${word}, none left today`;
    return `${serving} g ${word}, ${remaining} g left today`;
}

function productDislikeSentence(notice: Notice): string {
    const dislike = String(notice.params.dislike);
    const names = notice.related.map((r) => r.name);
    return `${names.join(", ")} dislikes ${dislike}`;
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
        sentence: fridgeExpiredSentence,
        action: {
            label: "Add to grocery list",
            to: "addFridgeItemToGrocery",
            method: "post",
            when: (n) => n.params.onGroceryList === "no",
        },
        help: "expiry-levels",
        dismissible: false,
    },
    "fridge.expiring": {
        badge: "Expiring soon",
        sentence: fridgeExpiringSentence,
        action: {
            label: "Add to grocery list",
            to: "addFridgeItemToGrocery",
            method: "post",
            when: (n) => n.params.onGroceryList === "no",
        },
        help: "expiry-levels",
        dismissible: true,
    },
    "grocery.allergen": {
        badge: "Allergen",
        sentence: allergenSentence,
        help: "allergens",
        dismissible: false,
    },
    "grocery.restocked": {
        badge: "Restocked",
        sentence: groceryRestockedSentence,
        help: "restock",
        dismissible: true,
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
    "food.possible_duplicate": {
        badge: "Possible duplicate",
        sentence: (notice) => {
            const subject = String(notice.params.name);
            const related = notice.related[0]?.name ?? "another food";
            return `${subject} may be the same as ${related}`;
        },
        action: { label: "Review", to: "possibleDuplicatePair" },
        help: "possible-duplicates",
        dismissible: true,
        dismissLabel: "Keep separate",
        dismissPair: true,
    },
    "food.product_allergen": {
        badge: "Allergen",
        sentence: productAllergenSentence,
        help: "allergens",
        dismissible: false,
    },
    "food.product_trace": {
        badge: "May contain",
        sentence: productTraceSentence,
        help: "allergens",
        dismissible: false,
    },
    "food.product_gluten": {
        badge: "Gluten",
        sentence: productGlutenSentence,
        help: "allergens",
        dismissible: false,
    },
    "food.product_goal": {
        badge: "Goals",
        sentence: productGoalSentence,
        help: "needs-attention",
        dismissible: true,
    },
    "food.product_dislike": {
        badge: "Dislike",
        sentence: productDislikeSentence,
        help: "needs-attention",
        dismissible: true,
    },
};

export function noticeSentence(notice: Notice): string {
    return NOTICE_COPY[notice.code].sentence(notice);
}

export function noticeActionFor(notice: Notice): NoticeCopy["action"] | null {
    const action = NOTICE_COPY[notice.code].action;
    if (!action) return null;
    const when = action.when ?? (() => true);
    return when(notice) ? action : null;
}
