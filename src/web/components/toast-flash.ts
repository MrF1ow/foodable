import type { ToastKey } from "../../copy/toasts.js";
import type { PersonRuleKind } from "../../domain/rules.js";
import { truncateToastParam } from "../truncate-toast-param.js";
import type { ToastParams } from "./toast.js";

export type ToastFlashChoice = {
    key: ToastKey;
    params?: ToastParams;
};

/** Omit the flash when neither stock nor meals were requested. */
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

/** The trouble toasts that also say where a logged serving went. */
const COOKED_LOGGED_KEY = {
    "recipes.cooked.shortfall": "recipes.cooked.shortfall.logged",
    "recipes.cooked.shortfall.unmeasured":
        "recipes.cooked.shortfall.unmeasured.logged",
    "recipes.cooked.unmeasured": "recipes.cooked.unmeasured.logged",
} as const satisfies Partial<Record<ToastKey, ToastKey>>;

/**
 * POST /recipes/:id/cook/confirm. Trouble outranks the good news: a kitchen
 * that changed since the preview, then a shortfall, then ingredients with
 * nothing to take; a clean cook says where the serving went, if one was logged.
 */
export function cookSheetToastFlash(opts: {
    loggedSlot: string | null;
    shortfallCount: number;
    unmeasuredNames: string[];
    changedNames: string[];
}): ToastFlashChoice {
    const slot = opts.loggedSlot;
    if (opts.changedNames.length > 0) {
        return {
            key: slot
                ? "recipes.cooked.changed.logged"
                : "recipes.cooked.changed",
            params: {
                names: truncateToastParam(opts.changedNames.join(", ")),
                ...(slot ? { slot } : {}),
            },
        };
    }
    const trouble = cookRecipeToastFlash(
        true,
        false,
        opts.shortfallCount,
        opts.unmeasuredNames,
    );
    if (trouble && trouble.key !== "recipes.cooked") {
        if (!slot) return trouble;
        return {
            key: COOKED_LOGGED_KEY[
                trouble.key as keyof typeof COOKED_LOGGED_KEY
            ],
            params: { ...trouble.params, slot },
        };
    }
    if (slot) {
        return { key: "recipes.cooked.logged", params: { slot } };
    }
    return { key: "recipes.cooked" };
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
