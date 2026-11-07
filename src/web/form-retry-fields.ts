import { escapeHtml } from "../html.js";
import { formText } from "./form.js";

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

export function hiddenFieldsHtml(fields: Record<string, string>): string {
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
        )
        .join("\n");
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

export function recipeIngredientRetryFields(
    body: Record<string, File | string>,
): Record<string, string> {
    return compactFormFields({
        food_id: formText(body, "food_id") || undefined,
        food_name: formText(body, "food_name") || undefined,
        barcode: formText(body, "barcode") || undefined,
        qty_amount: formText(body, "qty_amount") || undefined,
        qty_unit: formText(body, "qty_unit") || undefined,
    });
}
