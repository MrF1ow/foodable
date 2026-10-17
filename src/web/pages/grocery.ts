import {
    formatQuantity,
    isQuantityUnit,
    type Quantity,
} from "../../domain/quantity.js";
import type { GroceryLine } from "../../domain/grocery.js";
import type { GrocerySection, GroceryStore } from "../../domain/settings.js";
import type { StoreRule } from "../../domain/rules.js";
import type { AlreadyHaveTag } from "../../domain/linking.js";
import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { renderAlreadyHaveTag } from "../components/already-have-tag.js";
import { renderFoodPicker } from "../components/food-picker.js";
import {
    renderEmptyGrocery,
    renderErrorBanner,
    renderGroceryLineRow,
} from "../components/page-markup.js";

export type GroceryLineView = GroceryLine & {
    alreadyHave: AlreadyHaveTag | null;
    lastLocationId?: string | null;
};

export type GrocerySectionView = GrocerySection & {
    lines: GroceryLineView[];
};

export type GroceryStoreView = GroceryStore & {
    sections: GrocerySectionView[];
    rules: StoreRule[];
};

export type GroceryPageView = {
    chrome: ViewerChrome;
    stores: GroceryStoreView[];
    locations?: { id: string; name: string }[];
    isOwner?: boolean;
    error?: string;
    allergenWarning?: string;
    unknownAllergen?: boolean;
};

function quantityLabel(line: GroceryLine): string {
    if (isQuantityUnit(line.quantity.unit)) {
        return formatQuantity({
            amount: line.quantity.amount,
            unit: line.quantity.unit,
        });
    }
    return `${line.quantity.amount} ${line.quantity.unit}`;
}

function storeSectionSelect(store: GroceryStoreView): string {
    const options = store.sections
        .filter((section) => !section.hidden || section.isOther)
        .map((section) => {
            const sel = section.isOther ? " selected" : "";
            return `<option value="${escapeHtml(section.id)}"${sel}>${escapeHtml(section.name)}</option>`;
        })
        .join("");
    return `<label for="section-${escapeHtml(store.id)}">Section</label>
<select id="section-${escapeHtml(store.id)}" data-grocery-section>${options}</select>`;
}

function alreadyHaveHtml(tag: AlreadyHaveTag | null): string {
    if (tag == null) return "";
    if (tag.cover === "full") return renderAlreadyHaveTag({ cover: "full" });
    return renderAlreadyHaveTag({
        cover: "partial",
        have: tag.have as Quantity,
        need: tag.need as Quantity,
    });
}

function lineRow(
    line: GroceryLineView,
    locations: { id: string; name: string }[],
): string {
    let putAwayHtml = "";
    if (line.checked && locations.length > 0) {
        const selected = line.lastLocationId ?? locations[0]!.id;
        const options = locations
            .map((loc) => {
                const sel = loc.id === selected ? " selected" : "";
                return `<option value="${escapeHtml(loc.id)}"${sel}>${escapeHtml(loc.name)}</option>`;
            })
            .join("");
        putAwayHtml = `<form class="grocery-put-away row-actions" method="post" action="/grocery/lines/${escapeHtml(line.id)}/put-away">
<label class="visually-hidden" for="put-away-loc-${escapeHtml(line.id)}">Location</label>
<select id="put-away-loc-${escapeHtml(line.id)}" name="location_id">${options}</select>
<button type="submit" class="btn-sm btn-primary">Put away</button>
</form>`;
    }
    return renderGroceryLineRow({
        id: line.id,
        kind: line.kind,
        checked: line.checked,
        displayName: line.displayName,
        quantityLabel: quantityLabel(line),
        alreadyHaveHtml: alreadyHaveHtml(line.alreadyHave),
        putAwayHtml,
    });
}

function storeSection(
    store: GroceryStoreView,
    locations: { id: string; name: string }[],
): string {
    const rules = store.rules
        .map((rule) => `<li class="store-rule">${escapeHtml(rule.body)}</li>`)
        .join("");
    const sections = store.sections
        .filter((section) => section.lines.length > 0)
        .map((section) => {
            const rows = section.lines
                .map((line) => lineRow(line, locations))
                .join("");
            return `<section class="grocery-section psec" data-section-id="${escapeHtml(section.id)}" data-section-name="${escapeHtml(section.name)}">
<h3>${escapeHtml(section.name)}</h3>
<ul class="grocery-lines list">${rows}</ul>
</section>`;
        })
        .join("");
    const pickerId = `picker-${store.id}`;
    const other = store.sections.find((section) => section.isOther);
    const hidden: Record<string, string> = {
        kind: "food",
        store_id: store.id,
    };
    if (other) hidden.section_id = other.id;
    return `<section class="grocery-store panel" data-store-id="${escapeHtml(store.id)}">
<h2>${escapeHtml(store.name)}</h2>
${rules ? `<ul class="store-rule-list muted">${rules}</ul>` : ""}
${sections}
<details class="more">
<summary><h3>Add food</h3></summary>
${storeSectionSelect(store)}
${renderFoodPicker({
    id: pickerId,
    action: "/grocery/lines",
    method: "post",
    hiddenFields: hidden,
    includeQuantity: true,
})}
</details>
</section>`;
}

export function renderGroceryPage(view: GroceryPageView): string {
    const error = renderErrorBanner(view.error);
    const allergen = view.allergenWarning
        ? `<p class="allergen-warning" data-blocking="true">${escapeHtml(view.allergenWarning)}</p>`
        : view.unknownAllergen
          ? `<p class="allergen-unknown">unknown allergen data</p>`
          : "";
    const empty = view.stores.length === 0 ? renderEmptyGrocery() : "";
    const addStore = view.isOwner
        ? `<details class="more"${view.stores.length === 0 ? " open" : ""}>
<summary>Add store</summary>
<form class="grocery-add-store" method="post" action="/grocery/stores">
<label for="grocery_store_name">Grocery store</label>
<input id="grocery_store_name" name="name" maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add store</button>
</form>
</details>`
        : "";
    const clearChecked =
        view.stores.length === 0
            ? ""
            : `<form class="grocery-clear-checked" method="post" action="/grocery/clear-checked">
<button type="submit" class="btn-sm">Clear checked</button>
</form>`;
    const locations = view.locations ?? [];
    const stores = view.stores
        .map((store) => storeSection(store, locations))
        .join("");
    const body = `
        <h1>Groceries</h1>
        ${error}
        ${allergen}
        ${empty}
        ${stores}
        ${clearChecked}
        ${addStore}
    `;
    return renderAppShell({
        title: "Groceries",
        active: "grocery",
        theme: view.chrome.theme,
        body,
    });
}
