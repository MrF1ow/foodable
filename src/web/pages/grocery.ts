import { type Quantity } from "../../domain/quantity.js";
import { formatQuantityDisplayParts } from "../display-quantity.js";
import type { GroceryLine } from "../../domain/grocery.js";
import type { GrocerySection, GroceryStore } from "../../domain/settings.js";
import type { StoreRule } from "../../domain/rules.js";
import type { AlreadyHaveTag } from "../../domain/linking.js";
import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { renderAlreadyHaveTag } from "../components/already-have-tag.js";
import { renderFoodPicker } from "../components/food-picker.js";
import { renderGroceryLineRow } from "../components/page-markup.js";
import { sharedDialogItem } from "../components/shared-dialog.js";
import {
    confirmModal,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    type ModalFill,
} from "../components/ui.js";

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

/** Fields to replay on "Add anyway" after a blocking allergen warning. */
export type GroceryAllergenRetry = {
    storeId: string;
    fields: Record<string, string>;
};

export type GroceryPageView = {
    chrome: ViewerChrome;
    stores: GroceryStoreView[];
    locations?: { id: string; name: string }[];
    canManage?: boolean;
    error?: string;
    allergenWarning?: string;
    allergenRetry?: GroceryAllergenRetry;
    unknownAllergen?: boolean;
    openModalId?: string;
};

const ADD_STORE_MODAL_ID = "grocery-add-store";
const CLEAR_CHECKED_MODAL_ID = "grocery-clear-checked";
/** One add-food dialog for every store. Filled from the store row. */
const GROCERY_ADD_FOOD_ID = "grocery-add-food";
const ADD_FOOD_PREFIX = "grocery-add-food-";
const GROCERY_FOOD_PICKER_ID = "grocery-food-picker";
const GROCERY_SECTION_SELECT_ID = "grocery-add-section";

function quantityLabel(line: GroceryLine): string {
    return formatQuantityDisplayParts(line.quantity.amount, line.quantity.unit);
}

function modalOpen(view: GroceryPageView, id: string): boolean {
    return view.openModalId === id;
}

function modalFormError(view: GroceryPageView, modalId: string): string {
    if (view.error && modalOpen(view, modalId)) {
        return errorBanner(view.error);
    }
    return "";
}

function hasCheckedLine(stores: GroceryStoreView[]): boolean {
    for (const store of stores) {
        for (const section of store.sections) {
            if (section.lines.some((line) => line.checked)) return true;
        }
    }
    return false;
}

function grocerySectionFieldHtml(store: GroceryStoreView): string {
    const other = store.sections.find((section) => section.isOther);
    if (other) return "";
    const sec =
        store.sections.find((section) => !section.hidden && !section.isOther) ??
        store.sections[0];
    if (!sec) return "";
    return `<input type="hidden" name="section_id" value="${escapeHtml(sec.id)}" data-grocery-section-field />`;
}

/** Section `<select>` for one store. Rendered in that store's template. */
function sectionOptionsHtml(store: GroceryStoreView): string {
    const other = store.sections.find((section) => section.isOther);
    const inferAttr = other
        ? ` data-infer-section="${escapeHtml(other.id)}"`
        : "";
    const options = store.sections
        .filter((section) => !section.hidden || section.isOther)
        .map((section) => {
            const sel = section.isOther ? " selected" : "";
            return `<option value="${escapeHtml(section.id)}"${sel}>${escapeHtml(section.name)}</option>`;
        })
        .join("");
    return `<label for="${GROCERY_SECTION_SELECT_ID}">Section</label>
<select id="${GROCERY_SECTION_SELECT_ID}" data-grocery-section${inferAttr}>${options}</select>`;
}

function sectionTemplateId(storeId: string): string {
    return `grocery-sections-${storeId}`;
}

function sectionTemplate(store: GroceryStoreView): string {
    return `<template id="${escapeHtml(sectionTemplateId(store.id))}">${sectionOptionsHtml(store)}</template>`;
}

function sectionSlot(store: GroceryStoreView | null): string {
    if (!store) return `<div data-fill-slot="sections"></div>`;
    const id = sectionTemplateId(store.id);
    return `<div data-fill-slot="sections" data-filled-template="${escapeHtml(id)}">${sectionOptionsHtml(store)}</div>`;
}

function storeFill(store: GroceryStoreView): ModalFill {
    return {
        action: "/grocery/lines",
        fields: {
            store_id: store.id,
            kind: "food",
            barcode: "",
            food_name: "",
            qty_amount: "",
            qty_unit: "g",
        },
        templates: { sections: sectionTemplateId(store.id) },
    };
}

function reopenStore(view: GroceryPageView): GroceryStoreView | null {
    return (
        sharedDialogItem({
            openModalId: view.openModalId,
            prefix: ADD_FOOD_PREFIX,
            lookup: (id) => view.stores.find((store) => store.id === id),
        })?.item ?? null
    );
}

function allergenModalBlock(
    view: GroceryPageView,
    storeId: string,
    addFoodModalId: string,
): string {
    if (
        !view.allergenWarning ||
        view.openModalId !== addFoodModalId ||
        !view.allergenRetry ||
        view.allergenRetry.storeId !== storeId
    ) {
        return "";
    }
    const hidden = Object.entries(view.allergenRetry.fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
        )
        .join("\n");
    return `<div data-fill-transient><p class="allergen-warning" data-blocking="true">${escapeHtml(view.allergenWarning)}</p>
<form class="grocery-allergen-override" method="post" action="/grocery/lines">
${hidden}
<input type="hidden" name="confirm_allergen" value="1" />
<button type="submit" class="btn-sm">Add anyway</button>
</form></div>`;
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
    const headActions = `<div class="row-actions">
${modalTrigger({
    target: GROCERY_ADD_FOOD_ID,
    label: "Add food",
    className: "btn-sm",
    fill: storeFill(store),
})}
</div>`;
    return `<section class="grocery-store panel" data-store-id="${escapeHtml(store.id)}">
${sectionTemplate(store)}
<div class="grocery-store-head row">
<h2 class="row-title">${escapeHtml(store.name)}</h2>
${headActions}
</div>
${rules ? `<ul class="store-rule-list muted">${rules}</ul>` : ""}
${sections}
</section>`;
}

/**
 * Routes still reopen with `grocery-add-food-<storeId>`. A known store fills
 * this dialog and reports that id so the banner stays inside it.
 */
function sharedAddFoodModal(view: GroceryPageView): string {
    if (view.stores.length === 0) return "";
    const store = reopenStore(view);
    const reopenId = store ? `${ADD_FOOD_PREFIX}${store.id}` : "";
    const open = store != null && modalOpen(view, reopenId);
    return modal({
        id: GROCERY_ADD_FOOD_ID,
        title: "Add food",
        openOnLoad: open,
        submitDisabled: store == null,
        body: `${open ? modalFormError(view, reopenId) : ""}${
            store ? allergenModalBlock(view, store.id, reopenId) : ""
        }${sectionSlot(store)}
${renderFoodPicker({
    id: GROCERY_FOOD_PICKER_ID,
    action: store ? "/grocery/lines" : "",
    method: "post",
    hiddenFields: { kind: "food", store_id: store?.id ?? "" },
    formExtras: store ? grocerySectionFieldHtml(store) : "",
    includeQuantity: true,
})}`,
    });
}

export function renderGroceryPage(view: GroceryPageView): string {
    const allergenInModal =
        view.allergenWarning != null && view.openModalId != null;
    const allergen = allergenInModal
        ? view.unknownAllergen
            ? `<p class="allergen-unknown">unknown allergen data</p>`
            : ""
        : view.allergenWarning
          ? `<p class="allergen-warning" data-blocking="true">${escapeHtml(view.allergenWarning)}</p>`
          : view.unknownAllergen
            ? `<p class="allergen-unknown">unknown allergen data</p>`
            : "";
    const empty =
        view.stores.length === 0
            ? `${emptyState("Add a grocery store in Settings, then add a line.", "empty-grocery")}
<p><a href="/settings/household">Household settings</a></p>`
            : "";
    const locations = view.locations ?? [];
    const stores = view.stores
        .map((store) => storeSection(store, locations))
        .join("");
    const addFoodMatch = sharedDialogItem({
        openModalId: view.openModalId,
        prefix: ADD_FOOD_PREFIX,
        lookup: (id) => view.stores.find((store) => store.id === id),
    });
    const modalIds: string[] = [];
    if (view.error && addFoodMatch) modalIds.push(addFoodMatch.openModalId);

    const headerActions: string[] = [];
    if (view.canManage) {
        headerActions.push(
            modalTrigger({
                target: ADD_STORE_MODAL_ID,
                label: "Add store",
                className: "btn-sm btn-primary",
            }),
        );
    }
    if (hasCheckedLine(view.stores)) {
        headerActions.push(
            modalTrigger({
                target: CLEAR_CHECKED_MODAL_ID,
                label: "Clear checked",
                className: "btn-sm btn-danger",
            }),
        );
    }

    const pageModals: string[] = [];
    if (view.canManage) {
        modalIds.push(ADD_STORE_MODAL_ID);
        pageModals.push(
            modal({
                id: ADD_STORE_MODAL_ID,
                title: "Add store",
                openOnLoad: modalOpen(view, ADD_STORE_MODAL_ID),
                body: `${modalFormError(view, ADD_STORE_MODAL_ID)}<form class="grocery-add-store" method="post" action="/grocery/stores">
<label for="grocery_store_name">Grocery store</label>
<input id="grocery_store_name" name="name" maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add store</button>
</form>`,
            }),
        );
    }
    if (hasCheckedLine(view.stores)) {
        modalIds.push(CLEAR_CHECKED_MODAL_ID);
        pageModals.push(
            confirmModal({
                id: CLEAR_CHECKED_MODAL_ID,
                title: "Clear checked",
                message: "Remove every checked item from the list?",
                action: "/grocery/clear-checked",
                confirmLabel: "Clear checked",
                formClass: "modal-confirm grocery-clear-checked",
                openOnLoad: modalOpen(view, CLEAR_CHECKED_MODAL_ID),
                bodyPrefix: modalFormError(view, CLEAR_CHECKED_MODAL_ID),
            }),
        );
    }

    const body = `
        ${pageHeader({
            title: "Groceries",
            titleActions: headerActions.length
                ? headerActions.join("\n")
                : undefined,
        })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${allergen}
        ${empty}
        ${stores}
        ${pageModals.join("")}
        ${sharedAddFoodModal(view)}
    `;
    return renderAppShell({
        title: "Groceries",
        active: "grocery",
        theme: view.chrome.theme,
        body,
    });
}
