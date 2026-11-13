import type { WaterInput, WaterInsertResult } from "../db/nutrition.js";
import {
    rememberAliasForChoice,
    SimilarFoodsError,
    type FoodsStore,
    type OnSimilar,
} from "../domain/foods.js";

export function formText(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): string {
    const value = body[key];
    if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === "string");
        return typeof first === "string" ? first : "";
    }
    return typeof value === "string" ? value : "";
}

export function formAmount(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): number {
    return Number(formText(body, key));
}

/** A number field the user may leave blank: blank is undefined, anything
 * else is passed through Number (so junk becomes NaN for the caller to
 * reject). */
export function formOptionalNumber(
    body: Record<string, string | File | (string | File)[]>,
    key: string,
): number | undefined {
    const raw = formText(body, key).trim();
    return raw === "" ? undefined : Number(raw);
}

/** Drop empty strings so hidden replay fields stay minimal. */
export function compactFormFields(
    entries: Record<string, string | undefined>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(entries)) {
        if (value !== undefined && value !== "") out[key] = value;
    }
    return out;
}

export function groceryLineRetryFields(
    body: Record<string, File | string>,
    storeId: string,
): Record<string, string> {
    return compactFormFields({
        kind: formText(body, "kind") || "food",
        store_id: storeId,
        section_id: formText(body, "section_id") || undefined,
        food_id: formText(body, "food_id") || undefined,
        food_name: formText(body, "food_name") || undefined,
        barcode: formText(body, "barcode") || undefined,
        qty_amount: formText(body, "qty_amount") || undefined,
        qty_unit: formText(body, "qty_unit") || undefined,
        name: formText(body, "name") || undefined,
        confirm_allergen:
            formText(body, "confirm_allergen") === "1" ? "1" : undefined,
        remember_alias:
            formText(body, "remember_alias") === "1" ? "1" : undefined,
        alias_name: formText(body, "alias_name") || undefined,
    });
}

export function fridgeItemRetryFields(
    body: Record<string, File | string>,
): Record<string, string> {
    return compactFormFields({
        kind: formText(body, "kind") || "food",
        location_id: formText(body, "location_id") || undefined,
        food_id: formText(body, "food_id") || undefined,
        food_name: formText(body, "food_name") || undefined,
        barcode: formText(body, "barcode") || undefined,
        qty_amount: formText(body, "qty_amount") || undefined,
        qty_unit: formText(body, "qty_unit") || undefined,
        name: formText(body, "name") || undefined,
    });
}

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

export function isSimilarFoodsError(err: unknown): err is SimilarFoodsError {
    return err instanceof SimilarFoodsError;
}

export type LogFormResult = { ok: true } | { ok: false; error: string };

/** The log-water form: a positive whole-millilitre amount, then `insert`. */
export async function logWaterFromForm(
    userId: string,
    fields: { amount_ml?: string },
    insert: (userId: string, input: WaterInput) => Promise<WaterInsertResult>,
): Promise<LogFormResult> {
    const amount_ml = Number(fields.amount_ml);
    if (!Number.isFinite(amount_ml) || amount_ml <= 0) {
        return { ok: false, error: "Enter a water amount greater than zero." };
    }
    await insert(userId, { amount_ml: Math.round(amount_ml) });
    return { ok: true };
}
