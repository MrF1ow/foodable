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
import { renderGroceryLineRow } from "../components/page-markup.js";
import {
    confirmModal,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
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
    isOwner?: boolean;
    error?: string;
    allergenWarning?: string;
    allergenRetry?: GroceryAllergenRetry;
    unknownAllergen?: boolean;
    openModalId?: string;
};

const ADD_STORE_MODAL_ID = "grocery-add-store";
const CLEAR_CHECKED_MODAL_ID = "grocery-clear-checked";

function quantityLabel(line: GroceryLine): string {
    if (isQuantityUnit(line.quantity.unit)) {
        return formatQuantity({
            amount: line.quantity.amount,
            unit: line.quantity.unit,
        });
    }
    return `${line.quantity.amount} ${line.quantity.unit}`;
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

function storeSectionSelect(store: GroceryStoreView): string {
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
    return `<label for="section-${escapeHtml(store.id)}">Section</label>
<select id="section-${escapeHtml(store.id)}" data-grocery-section${inferAttr}>${options}</select>`;
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
    return `<p class="allergen-warning" data-blocking="true">${escapeHtml(view.allergenWarning)}</p>
<form class="grocery-allergen-override" method="post" action="/grocery/lines">
${hidden}
<input type="hidden" name="confirm_allergen" value="1" />
<button type="submit" class="btn-sm">Add anyway</button>
</form>`;
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
    view: GroceryPageView,
): { section: string; modals: string; modalId: string } {
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
    const addFoodModalId = `grocery-add-food-${store.id}`;
    const hidden: Record<string, string> = {
        kind: "food",
        store_id: store.id,
    };
    const addFoodModal = modal({
        id: addFoodModalId,
        title: "Add food",
        openOnLoad: modalOpen(view, addFoodModalId),
        body: `${modalFormError(view, addFoodModalId)}${allergenModalBlock(view, store.id, addFoodModalId)}${storeSectionSelect(store)}
${renderFoodPicker({
    id: pickerId,
    action: "/grocery/lines",
    method: "post",
    hiddenFields: hidden,
    formExtras: grocerySectionFieldHtml(store),
    includeQuantity: true,
})}`,
    });
    const headActions = `<div class="row-actions">
${modalTrigger({
    target: addFoodModalId,
    label: "Add food",
    className: "btn-sm",
})}
</div>`;
    const section = `<section class="grocery-store panel" data-store-id="${escapeHtml(store.id)}">
<div class="grocery-store-head row">
<h2 class="row-title">${escapeHtml(store.name)}</h2>
${headActions}
</div>
${rules ? `<ul class="store-rule-list muted">${rules}</ul>` : ""}
${sections}
</section>`;
    return { section, modals: addFoodModal, modalId: addFoodModalId };
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
    const storeParts = view.stores.map((store) =>
        storeSection(store, locations, view),
    );
    const stores = storeParts.map((part) => part.section).join("");
    const storeModals = storeParts.map((part) => part.modals).join("");
    const modalIds = storeParts.map((part) => part.modalId);

    const headerActions: string[] = [];
    if (view.isOwner) {
        headerActions.push(
            modalTrigger({
                target: ADD_STORE_MODAL_ID,
                label: "Add store",
                className: "btn-primary",
            }),
        );
    }
    if (hasCheckedLine(view.stores)) {
        headerActions.push(
            modalTrigger({
                target: CLEAR_CHECKED_MODAL_ID,
                label: "Clear checked",
                className: "btn-danger",
            }),
        );
    }

    const pageModals: string[] = [];
    if (view.isOwner) {
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
            actions: headerActions.length
                ? headerActions.join("\n")
                : undefined,
        })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${allergen}
        ${empty}
        ${stores}
        ${pageModals.join("")}
        ${storeModals}
    `;
    return renderAppShell({
        title: "Groceries",
        active: "grocery",
        theme: view.chrome.theme,
        body,
    });
}
