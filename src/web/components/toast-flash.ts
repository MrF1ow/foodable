import type { ToastKey } from "../../copy/toasts.js";
import type { PersonRuleKind } from "../../domain/rules.js";
import type { ToastParams } from "./toast.js";

export type ToastFlashChoice = {
    key: ToastKey;
    params?: ToastParams;
};

/** POST /recipes/:id/cook — omit flash when neither stock nor meals were requested. */
export function cookRecipeToastFlash(
    deductStock: boolean,
    logMeals: boolean,
    shortfallCount: number,
    unmeasuredNames: string[] = [],
): ToastFlashChoice | null {
    if (!deductStock && !logMeals) return null;
    if (shortfallCount > 0 && unmeasuredNames.length > 0) {
        return {
            key: "recipes.cooked.shortfall.unmeasured",
            params: { names: unmeasuredNames.join(", ") },
        };
    }
    if (shortfallCount > 0) {
        return { key: "recipes.cooked.shortfall" };
    }
    if (unmeasuredNames.length > 0) {
        return {
            key: "recipes.cooked.unmeasured",
            params: { names: unmeasuredNames.join(", ") },
        };
    }
    return { key: "recipes.cooked" };
}

export function addRecipeToGroceryToastFlash(
    addedCount: number,
): ToastFlashChoice {
    if (addedCount > 0) {
        return {
            key: "recipes.added-to-grocery",
            params: { count: addedCount },
        };
    }
    return { key: "recipes.add-to-grocery.nothing" };
}

/** Listed so toast.test finds every recipes.import.* key (R4 URL import). */
export function recipeImportToastKeysForAudit(): readonly ToastKey[] {
    return [
        "recipes.import.imported",
        "recipes.import.unverified_needs_review",
        "recipes.import.unverified_needs_review_one",
        "recipes.import.paste_needed",
        "recipes.import.paste_needed_site",
        "recipes.import.paste_needed_reader",
        "recipes.import.no_recipe_in_text",
        "recipes.import.no_recipe_on_page",
        "recipes.import.robots_disallowed",
        "recipes.import.site_refused",
        "recipes.import.site_refused_recent",
        "recipes.import.not_found",
        "recipes.import.not_found_recent",
        "recipes.import.timeout",
        "recipes.import.duplicate",
        "recipes.import.invalid_link",
    ];
}

export function groceryLineCheckToastKey(checked: boolean): ToastKey {
    return checked ? "grocery.line.checked" : "grocery.line.unchecked";
}

export function householdPersonRuleRemovedKey(kind: PersonRuleKind): ToastKey {
    switch (kind) {
        case "allergen":
            return "settings.household.allergen.removed";
        case "dislike":
            return "settings.household.dislike.removed";
        default:
            return "settings.household.rule.removed";
    }
}
