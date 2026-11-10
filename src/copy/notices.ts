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
    if (words.length === 0) return "";
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

export type NoticeDigestTone = "over" | "warn" | "dim";

export type NoticeDigestWire = {
    title: string;
    detail: string | null;
    detail_tone: NoticeDigestTone | null;
    group_key: string;
    group_label: string;
    dot_tone: NoticeDigestTone | null;
};

function weekdayShortUtc(iso: string): string {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
    });
}

function monthDayUtc(iso: string): string {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function dotToneFromDaysLeft(daysLeft: number): NoticeDigestTone {
    if (daysLeft < 0) return "over";
    if (daysLeft <= 1) return "over";
    if (daysLeft <= 3) return "warn";
    return "dim";
}

function dotToneFromExpiryLevel(level: string): NoticeDigestTone {
    if (level === "expired" || level === "high") return "over";
    if (level === "medium") return "warn";
    return "dim";
}

function detailToneFromExpiryLevel(level: string): NoticeDigestTone | null {
    if (level === "high") return "over";
    if (level === "medium") return "warn";
    return null;
}

function fridgeWhenFromDaysLeft(
    daysLeft: number,
    expiresOn: string,
): { text: string; tone: NoticeDigestTone } {
    if (daysLeft < 0) return { text: "expired", tone: "over" };
    if (daysLeft === 0) return { text: "today", tone: "over" };
    if (daysLeft === 1) return { text: "tomorrow", tone: "over" };
    if (daysLeft <= 3) return { text: `${daysLeft} days`, tone: "warn" };
    return {
        text: new Date(`${expiresOn}T00:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "UTC",
        }),
        tone: "dim",
    };
}

function digestFridge(notice: Notice): NoticeDigestWire {
    const group = { key: "expiring", label: "Expiring" };
    const name =
        typeof notice.params.name === "string" ? notice.params.name : "Item";
    const expiresOn =
        typeof notice.params.expiresOn === "string"
            ? notice.params.expiresOn
            : "";
    if (notice.code === "fridge.expired") {
        const date = expiresOn !== "" ? monthDayUtc(expiresOn) : null;
        const detail = date ? `${date} · expired` : "expired";
        return {
            title: name,
            detail,
            detail_tone: "over",
            group_key: group.key,
            group_label: group.label,
            dot_tone: "over",
        };
    }
    const daysLeft =
        typeof notice.params.daysLeft === "number"
            ? notice.params.daysLeft
            : null;
    if (daysLeft != null && expiresOn !== "") {
        const when = fridgeWhenFromDaysLeft(daysLeft, expiresOn);
        return {
            title: name,
            detail: when.text,
            detail_tone:
                when.tone === "over" || when.tone === "warn" ? when.tone : null,
            group_key: group.key,
            group_label: group.label,
            dot_tone: dotToneFromDaysLeft(daysLeft),
        };
    }
    if (expiresOn !== "") {
        const level =
            typeof notice.params.level === "string" ? notice.params.level : "";
        const detail = monthDayUtc(expiresOn);
        const detail_tone: NoticeDigestTone | null =
            level !== "" ? detailToneFromExpiryLevel(level) : null;
        return {
            title: name,
            detail,
            detail_tone,
            group_key: group.key,
            group_label: group.label,
            dot_tone:
                level !== ""
                    ? dotToneFromExpiryLevel(level)
                    : notice.severity === "warn"
                      ? "warn"
                      : "dim",
        };
    }
    return {
        title: name,
        detail: null,
        detail_tone: null,
        group_key: group.key,
        group_label: group.label,
        dot_tone: notice.severity === "warn" ? "warn" : "dim",
    };
}

function digestGroceryRestocked(notice: Notice): NoticeDigestWire {
    const itemName =
        typeof notice.params.itemName === "string"
            ? notice.params.itemName
            : null;
    const lineName =
        typeof notice.params.name === "string" ? notice.params.name : "Item";
    const title = itemName ?? lineName;
    const expiresOn =
        typeof notice.params.expiresOn === "string"
            ? notice.params.expiresOn
            : "";
    const daysLeft =
        typeof notice.params.daysLeft === "number"
            ? notice.params.daysLeft
            : null;
    if (itemName == null || expiresOn === "" || daysLeft == null) {
        return {
            title,
            detail: "Added by restock",
            detail_tone: null,
            group_key: "running_low",
            group_label: "Running low",
            dot_tone: "dim",
        };
    }
    const when = restockWhen(expiresOn, daysLeft);
    const detail = when === "expired" ? "expired" : when;
    const detail_tone: NoticeDigestTone | null =
        when === "expired" || when === "today" || when === "tomorrow"
            ? "over"
            : null;
    return {
        title,
        detail,
        detail_tone,
        group_key: "running_low",
        group_label: "Running low",
        dot_tone: dotToneFromDaysLeft(daysLeft),
    };
}

function digestGroceryAllergen(notice: Notice): NoticeDigestWire {
    const allergens = (notice.params.allergens ?? []) as string[];
    return {
        title: allergens[0] ?? "Allergen",
        detail: notice.related.map((r) => r.name).join(", ") || null,
        detail_tone: null,
        group_key: "household",
        group_label: "Household",
        dot_tone: "over",
    };
}

function digestRecipe(notice: Notice): NoticeDigestWire {
    const title =
        typeof notice.params.name === "string" ? notice.params.name : "Item";
    const recipeName =
        typeof notice.params.recipeName === "string"
            ? notice.params.recipeName
            : "Recipe";
    const plannedOn =
        typeof notice.params.plannedOn === "string"
            ? notice.params.plannedOn
            : "";
    const planned = plannedOn !== "";
    let detail: string | null = recipeName;
    if (planned) {
        detail = `${weekdayShortUtc(plannedOn)} · ${recipeName.toLowerCase()}`;
    }
    if (notice.code === "recipe.no_amount") {
        const taste =
            typeof notice.params.taste === "string"
                ? notice.params.taste
                : "to taste";
        detail = `${taste} — ${recipeName}`;
    } else if (notice.code === "recipe.partial_nutrition") {
        const missing = (notice.params.missing ?? []) as RecipeGapNutrient[];
        detail = `${formatMissingNutrientList(missing)} — ${recipeName}`;
    } else if (notice.code === "recipe.unknown_unit") {
        detail = `unknown unit — ${recipeName}`;
    } else if (
        notice.code === "recipe.missing_grams_per_each" ||
        notice.code === "recipe.missing_grams_per_ml"
    ) {
        detail = `missing conversion — ${recipeName}`;
    }
    return {
        title,
        detail,
        detail_tone: null,
        group_key: "recipe_gaps",
        group_label: planned ? "Missing for planned meals" : "Recipes",
        dot_tone: notice.severity === "warn" ? "warn" : "dim",
    };
}

function digestFoodDuplicate(notice: Notice): NoticeDigestWire {
    const title =
        typeof notice.params.name === "string" ? notice.params.name : "Food";
    const other = notice.related[0]?.name ?? "another food";
    return {
        title,
        detail: `may be the same as ${other}`,
        detail_tone: null,
        group_key: "household",
        group_label: "Household",
        dot_tone: "dim",
    };
}

/** A product check (rate_product): the product is the title, the check is the detail. */
function digestProductCheck(notice: Notice): NoticeDigestWire {
    const name =
        typeof notice.params.name === "string" && notice.params.name !== ""
            ? notice.params.name
            : noticeSentence(notice);
    const tone =
        notice.severity === "block"
            ? "over"
            : notice.severity === "warn"
              ? "warn"
              : "dim";
    return {
        title: name,
        detail: noticeSentence(notice),
        detail_tone: notice.severity === "block" ? "over" : null,
        group_key: "product_checks",
        group_label: "Product checks",
        dot_tone: tone,
    };
}

/** Attention widget row fields derived from notice params (not message parsing). */
export function noticeDigestWire(notice: Notice): NoticeDigestWire {
    switch (notice.code) {
        case "fridge.expired":
        case "fridge.expiring":
            return digestFridge(notice);
        case "grocery.restocked":
            return digestGroceryRestocked(notice);
        case "grocery.allergen":
            return digestGroceryAllergen(notice);
        case "recipe.allergen":
            return digestGroceryAllergen(notice);
        case "food.possible_duplicate":
            return digestFoodDuplicate(notice);
        case "food.product_allergen":
        case "food.product_trace":
        case "food.product_gluten":
        case "food.product_goal":
        case "food.product_dislike":
            return digestProductCheck(notice);
        default:
            if (notice.code.startsWith("recipe.")) {
                return digestRecipe(notice);
            }
            return {
                title: noticeSentence(notice),
                detail: null,
                detail_tone: null,
                group_key: "other",
                group_label: "Other",
                dot_tone: null,
            };
    }
}

export function noticeActionFor(notice: Notice): NoticeCopy["action"] | null {
    const action = NOTICE_COPY[notice.code].action;
    if (!action) return null;
    const when = action.when ?? (() => true);
    return when(notice) ? action : null;
}
