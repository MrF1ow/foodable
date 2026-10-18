import { searchFoodsByName } from "../../food-search.js";
import {
    lookupBarcode,
    normalizeBarcode,
    type FoodResult,
} from "../../foods.js";
import { escapeHtml } from "../shell.js";
import { renderQuantityField } from "./quantity-field.js";

type SearchHooks = Parameters<typeof searchFoodsByName>[2];

export async function searchPickerFoods(
    query: string,
    householdNames: string[] = [],
    hooks: SearchHooks = {},
): Promise<FoodResult[]> {
    return searchFoodsByName(query, householdNames, hooks);
}

export async function runBarcodeLookupAction(
    raw: string,
    opts: {
        lookup?: (barcode: string) => Promise<FoodResult | null>;
    } = {},
): Promise<{ barcode: string; food: FoodResult | null } | { error: string }> {
    const barcode = normalizeBarcode(raw);
    if (!barcode) return { error: "invalid barcode" };
    const lookup = opts.lookup ?? lookupBarcode;
    const food = await lookup(barcode);
    return { barcode, food };
}

function hiddenInputs(fields: Record<string, string>): string {
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
        )
        .join("");
}

export type FoodPickerOptions = {
    id?: string;
    action?: string;
    method?: "get" | "post";
    hiddenFields?: Record<string, string>;
    /** Extra HTML inserted inside each POST form (after hidden fields). */
    formExtras?: string;
    includeQuantity?: boolean;
};

export function renderFoodPicker(opts: FoodPickerOptions = {}): string {
    const id = opts.id ?? "food-picker";
    const action = opts.action ?? "#";
    const method = opts.method ?? "get";
    const extras =
        hiddenInputs(opts.hiddenFields ?? {}) + (opts.formExtras ?? "");
    const qty = opts.includeQuantity
        ? renderQuantityField({
              kind: "food",
              idPrefix: `${id}-qty`,
              namePrefix: "qty",
              required: method === "post",
          })
        : "";
    const barcodePanel = `${id}-barcode-panel`;
    const searchPanel = `${id}-search-panel`;
    const manualPanel = `${id}-manual`;
    const manualQty = renderQuantityField({
        kind: "food",
        idPrefix: `${id}-manual-qty`,
        namePrefix: method === "post" ? "qty" : `${id.replace(/-/g, "_")}_qty`,
        required: method === "post",
    });
    const barcodeSubmit = method === "post" ? "Add food" : "Look up";
    const searchQty =
        method === "post" && opts.includeQuantity
            ? renderQuantityField({
                  kind: "food",
                  idPrefix: `${id}-search-qty`,
                  namePrefix: "qty",
                  required: true,
              })
            : "";
    const searchFields = `<label for="${escapeHtml(id)}-search">Search</label>
<input id="${escapeHtml(id)}-search" type="search" data-search-input autocomplete="off" />
${
    method === "post"
        ? `<form class="food-picker-search" data-search-form method="post" action="${escapeHtml(action)}">
${extras}
${searchQty}
<ul class="food-picker-results" data-search-results></ul>
</form>`
        : `<ul class="food-picker-results" data-search-results></ul>`
}`;
    const manualBlock =
        method === "post"
            ? `<form class="food-picker-manual" method="post" action="${escapeHtml(action)}">
${extras}
<label for="${escapeHtml(id)}-name">Name</label>
<input id="${escapeHtml(id)}-name" name="food_name" type="text" required autocomplete="off" />
${manualQty}
<button type="submit" class="btn-primary">Add food</button>
</form>`
            : `<label for="${escapeHtml(id)}-name">Name</label>
<input id="${escapeHtml(id)}-name" name="food_name" type="text" autocomplete="off" />
${manualQty}`;
    const hit = method === "post" ? "submit" : "text";
    return `<div class="food-picker" id="${escapeHtml(id)}" data-food-picker data-hit="${hit}">
<div class="food-picker-tabs seg" role="tablist" aria-label="Food identity">
<button type="button" role="tab" class="seg-btn" id="${escapeHtml(id)}-tab-barcode" data-tab="barcode" aria-controls="${escapeHtml(barcodePanel)}" aria-selected="true">Barcode</button>
<button type="button" role="tab" class="seg-btn" id="${escapeHtml(id)}-tab-search" data-tab="search" aria-controls="${escapeHtml(searchPanel)}" aria-selected="false">Search</button>
<button type="button" role="tab" class="seg-btn" id="${escapeHtml(id)}-tab-manual" data-tab="manual" aria-controls="${escapeHtml(manualPanel)}" aria-selected="false">Manual</button>
</div>
<div class="food-picker-panel" role="tabpanel" id="${escapeHtml(barcodePanel)}" data-panel="barcode" aria-labelledby="${escapeHtml(id)}-tab-barcode">
<form class="food-picker-barcode" data-barcode-form data-lookup-path="lookupBarcode" action="${escapeHtml(action)}" method="${method}">
${extras}
<label for="${escapeHtml(id)}-barcode">Barcode</label>
<input id="${escapeHtml(id)}-barcode" name="barcode" inputmode="numeric" pattern="[0-9]*" autocomplete="off" />
${qty}
<button type="submit" class="btn-primary">${escapeHtml(barcodeSubmit)}</button>
</form>
<ul class="food-picker-results" data-barcode-results></ul>
</div>
<div class="food-picker-panel" role="tabpanel" id="${escapeHtml(searchPanel)}" data-panel="search" aria-labelledby="${escapeHtml(id)}-tab-search" hidden>
${searchFields}
</div>
<div class="food-picker-panel" role="tabpanel" id="${escapeHtml(manualPanel)}" data-panel="manual" aria-labelledby="${escapeHtml(id)}-tab-manual" hidden>
${manualBlock}
</div>
</div>`;
}
