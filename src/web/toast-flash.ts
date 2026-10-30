import type { ToastKey } from "../copy/toasts.js";
import type { PersonRuleKind } from "../domain/rules.js";
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
): ToastFlashChoice | null {
    if (!deductStock && !logMeals) return null;
    if (shortfallCount > 0) {
        return { key: "recipes.cooked.shortfall" };
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
