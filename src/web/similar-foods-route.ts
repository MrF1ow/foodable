import {
    rememberAliasForChoice,
    didYouMeanView,
} from "../domain/did-you-mean.js";
import type { DidYouMeanModal } from "./components/did-you-mean.js";
import {
    SimilarFoodsError,
    type FoodsStore,
    type OnSimilar,
} from "../domain/foods.js";
import { formText } from "./form.js";

export function manualOnSimilar(
    body: Record<string, File | string>,
): OnSimilar {
    return formText(body, "new_food") === "1" ? "create" : "ask";
}

export async function rememberAliasIfRequested(
    foods: FoodsStore,
    householdId: string,
    body: Record<string, File | string>,
    foodId: string,
): Promise<void> {
    if (formText(body, "remember_alias") !== "1") return;
    const aliasName = formText(body, "alias_name");
    if (!aliasName) return;
    await rememberAliasForChoice(foods, householdId, foodId, aliasName);
}

export function buildDidYouMeanModal(
    err: SimilarFoodsError,
    fields: Record<string, string>,
    modalId: string,
    action: string,
): DidYouMeanModal | null {
    const entry = err.entries[0];
    if (!entry) return null;
    return {
        modalId,
        action,
        view: didYouMeanView(entry, fields),
    };
}

export function isSimilarFoodsError(err: unknown): err is SimilarFoodsError {
    return err instanceof SimilarFoodsError;
}
