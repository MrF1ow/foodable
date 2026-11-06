import { ALLERGEN_LABELS, NAMED_ALLERGENS } from "../../domain/rules.js";
import { FOOD_QUANTITY_UNITS } from "../../domain/quantity.js";
import type { GroceryStore } from "../../domain/settings.js";
import type { Food, UsualProductRow } from "../../domain/foods.js";
import { quantityUnitOptionLabel } from "../display-quantity.js";
import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { renderFoodPicker } from "../components/food-picker.js";
import { renderHouseholdNav } from "../components/settings-nav.js";
import {
    emptyState,
    errorBanner,
    field,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
} from "../components/ui.js";
import {
    safeReturnPath,
    usualProductsPickerHref,
} from "../usual-products-path.js";

export const USUAL_PRODUCT_ADD_MODAL_ID = "usual-product-add";

export type UsualProductsAddSearchView = {
    q: string;
    results: Food[];
    truncated: boolean;
};

export type UsualProductsListView = {
    chrome: ViewerChrome;
    rows: UsualProductRow[];
    /** Plain foods with no products yet: the "Add usual product" choices. */
    addable: Food[];
    from?: string;
    error?: string;
    openFoodId?: string;
    addSearch?: UsualProductsAddSearchView;
};

export type UsualProductsPickerView = {
    chrome: ViewerChrome;
    food: Food;
    products: Food[];
    usualProductId: string | null;
    /** Pre-fill for Usually buy when the usual product is set; else the plain food's own fields. */
    prefillStoreId: string | null;
    prefillAmount: { amount: number; unit: string } | null;
    stores: GroceryStore[];
    from: string;
    error?: string;
};

function sortStoresByName<T extends { name: string }>(stores: T[]): T[] {
    return [...stores].sort((a, b) => a.name.localeCompare(b.name));
}

function nutrientInput(
    id: string,
    name: string,
    label: string,
    value: number | null | undefined,
): string {
    return `<label>${escapeHtml(label)}
<input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="number" min="0" step="0.1" value="${value == null ? "" : escapeHtml(String(value))}" />
</label>`;
}

function productOption(product: Food, selected: boolean): string {
    const brand = product.brand ? ` · ${escapeHtml(product.brand)}` : "";
    const sel = selected ? " checked" : "";
    return `<label class="choice-row"><input type="radio" name="product_food_id" value="${escapeHtml(product.id)}"${sel} /> ${escapeHtml(product.name)}${brand}</label>`;
}

function manualProductForm(foodId: string, from: string): string {
    const allergenBoxes = [...NAMED_ALLERGENS, "other" as const]
        .map(
            (code) =>
                `<label><input type="checkbox" name="allergens" value="${escapeHtml(code)}" /> ${escapeHtml(ALLERGEN_LABELS[code])}</label>`,
        )
        .join("");
    return `<form method="post" action="/household/usual-products/${escapeHtml(foodId)}/products" class="usual-product-manual">
<input type="hidden" name="from" value="${escapeHtml(from)}" />
${field({ id: "usual-product-name", label: "Name", control: `<input id="usual-product-name" name="name" required maxlength="120" />` })}
${field({ id: "usual-product-brand", label: "Brand", control: `<input id="usual-product-brand" name="brand" maxlength="80" />` })}
<div class="field-grid">
${nutrientInput("usual-product-each", "grams_per_each", "Grams per item", null)}
${nutrientInput("usual-product-ml", "grams_per_ml", "Grams per millilitre", null)}
${nutrientInput("usual-product-cal", "calories", "Calories / 100 g", null)}
${nutrientInput("usual-product-pro", "protein_g", "Protein g", null)}
${nutrientInput("usual-product-carb", "carbs_g", "Carbs g", null)}
${nutrientInput("usual-product-fat", "fat_g", "Fat g", null)}
${nutrientInput("usual-product-fib", "fiber_g", "Fiber g", null)}
${nutrientInput("usual-product-sug", "sugar_g", "Sugar g", null)}
${nutrientInput("usual-product-alc", "alcohol_g", "Alcohol g", null)}
${nutrientInput("usual-product-caf", "caffeine_mg", "Caffeine mg", null)}
</div>
<fieldset class="allergens choice-row"><legend>Allergens</legend>${allergenBoxes}</fieldset>
<button type="submit" class="btn-primary">Add product</button>
</form>`;
}

export function renderUsualProductsListPage(
    view: UsualProductsListView,
): string {
    const listFrom = safeReturnPath(view.from, "/household/usual-products");
    const mainRows = view.rows
        .map((row) => {
            const usualMeta = row.usual
                ? `${escapeHtml(row.usual.name)}${row.usual.brand ? ` · ${escapeHtml(row.usual.brand)}` : ""}`
                : "No usual product";
            return `<li><div class="row">
<p class="row-title">${escapeHtml(row.food.name)}</p>
<p class="row-meta">${usualMeta}</p>
<div class="row-actions"><a class="btn-sm" href="${escapeHtml(usualProductsPickerHref(row.food.id, listFrom))}">Change</a></div>
</div></li>`;
        })
        .join("");
    const mainPanel =
        view.rows.length === 0
            ? emptyState("No usual products yet.")
            : panel({
                  body: `<ul class="list">${mainRows}</ul>`,
              });
    const searchQ = view.addSearch?.q ?? "";
    const searchResults = view.addSearch?.results ?? [];
    const resultRows = searchResults
        .map((food) => {
            const brand = food.brand
                ? `<p class="row-meta">${escapeHtml(food.brand)}</p>`
                : "";
            const chooseHref = `/household/usual-products?food=${encodeURIComponent(food.id)}${listFrom !== "/household/usual-products" ? `&from=${encodeURIComponent(listFrom)}` : ""}`;
            return `<li><div class="row">
<p class="row-title">${escapeHtml(food.name)}</p>
${brand}
<div class="row-actions"><a class="btn-sm" href="${escapeHtml(chooseHref)}">Choose</a></div>
</div></li>`;
        })
        .join("");
    const searchOutcome =
        view.addSearch == null
            ? ""
            : searchResults.length === 0
              ? `<p class="muted">No matching food.</p>`
              : `<ul class="list">${resultRows}</ul>${view.addSearch.truncated ? `<p class="muted">Showing the first 20. Type more to narrow it.</p>` : ""}`;
    const addModal =
        view.addable.length === 0
            ? ""
            : modal({
                  id: USUAL_PRODUCT_ADD_MODAL_ID,
                  title: "Add usual product",
                  openOnLoad: view.addSearch != null,
                  body: `<form method="get" action="/household/usual-products" class="usual-product-add">
${field({ id: "usual-product-add-q", label: "Food", control: `<input id="usual-product-add-q" name="q" type="search" autocomplete="off" value="${escapeHtml(searchQ)}" />` })}
<button type="submit" class="btn-primary">Search</button>
</form>
<p class="muted">Scanned products aren't listed. File them under a food with Belongs to… on <a href="/household/items">Items</a>.</p>
${searchOutcome}`,
              });
    const addTrigger =
        view.addable.length === 0
            ? undefined
            : modalTrigger({
                  target: USUAL_PRODUCT_ADD_MODAL_ID,
                  label: "Add usual product",
              });
    const body = `
        ${pageHeader({ title: "Usual products", actions: addTrigger })}
        ${pageLevelErrorBanner(view, view.openFoodId ? [`picker-${view.openFoodId}`] : [])}
        ${renderHouseholdNav("usual-products")}
        ${mainPanel}
        ${addModal}
    `;
    return renderAppShell({
        title: "Usual products",
        active: "household",
        theme: view.chrome.theme,
        body,
    });
}

export function renderUsualProductsPickerPage(
    view: UsualProductsPickerView,
): string {
    const foodId = view.food.id;
    const from = view.from;
    const backHref = safeReturnPath(from, "/household/usual-products");
    const usualId = view.usualProductId;
    const productRadios = view.products.map((p) =>
        productOption(p, p.id === usualId),
    );
    const noneChecked = usualId == null ? " checked" : "";
    const prefill = view.prefillAmount;
    const amountVal = prefill != null ? String(prefill.amount) : "";
    const unitOpts = [
        `<option value="">—</option>`,
        ...FOOD_QUANTITY_UNITS.map((unit) => {
            const label = quantityUnitOptionLabel(unit);
            const sel = prefill?.unit === unit ? " selected" : "";
            return `<option value="${escapeHtml(unit)}"${sel}>${escapeHtml(label)}</option>`;
        }),
    ].join("");
    const storeOpts = [
        `<option value="">—</option>`,
        ...sortStoresByName(view.stores).map((s) => {
            const sel = view.prefillStoreId === s.id ? " selected" : "";
            return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name)}</option>`;
        }),
    ].join("");
    const usualBuyBlock = `
${field({
    id: "usual-buy-amount",
    label: "Usually buy",
    control: `<div class="field-grid">
<label>Amount<input id="usual-buy-amount" name="usual_amount" type="number" min="0" step="any" value="${escapeHtml(amountVal)}" /></label>
<label>Unit<select id="usual-buy-unit" name="usual_unit">${unitOpts}</select></label>
</div>`,
})}
${field({
    id: "usual-buy-store",
    label: "at",
    control: `<select id="usual-buy-store" name="usual_store_id">${storeOpts}</select>`,
})}`;
    const existingProducts =
        view.products.length === 0
            ? `<p class="muted">No products for this food yet. Search, scan or add one below.</p>`
            : `<form method="post" action="/household/usual-products/${escapeHtml(foodId)}">
<input type="hidden" name="from" value="${escapeHtml(from)}" />
<div class="choice-col">
<label class="choice-row"><input type="radio" name="product_food_id" value=""${noneChecked} /> None</label>
${productRadios.join("")}
</div>
${usualBuyBlock}
<button type="submit" class="btn-primary">Set usual</button>
</form>`;
    const picker = renderFoodPicker({
        id: "usual-product-picker",
        action: `/household/usual-products/${foodId}/pick`,
        method: "post",
        hiddenFields: { from },
        includeQuantity: false,
        includeManual: false,
    });
    const body = `
        ${pageHeader({
            title: `Usual product for ${view.food.name}`,
            sub: `<p class="muted"><a href="${escapeHtml(backHref)}">Back</a></p>`,
        })}
        ${renderHouseholdNav("usual-products")}
        ${view.error ? errorBanner(view.error) : ""}
        ${panel({ title: "Your products", body: existingProducts })}
        ${panel({ title: "Search or scan", body: picker })}
        ${panel({
            title: "Add product by hand",
            body: manualProductForm(foodId, from),
        })}
    `;
    return renderAppShell({
        title: "Usual product",
        active: "household",
        theme: view.chrome.theme,
        body,
    });
}
