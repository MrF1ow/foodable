import { formatQuantityDisplayParts } from "../display-quantity.js";
import type {
    FridgeItem,
    FridgeLocation,
    FridgeSnapshot,
} from "../../domain/fridge.js";
import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { renderFoodPicker } from "../components/food-picker.js";
import { renderQuantityField } from "../components/quantity-field.js";
import {
    renderExpiringStrip,
    renderFridgeItemRow,
} from "../components/page-markup.js";
import { iconPencil, iconTrash } from "../components/icons.js";
import {
    confirmModal,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
} from "../components/ui.js";
import {
    expiryLevel,
    listExpiring,
    utcTodayFromDate,
} from "../../domain/stock.js";

const SUPPLY_UNITS = [
    "roll",
    "each",
    "box",
    "pack",
    "g",
    "oz",
    "lb",
    "ml",
    "fl oz",
    "cup",
] as const;

export type FridgePageView = FridgeSnapshot & {
    chrome: ViewerChrome;
    error?: string;
    openModalId?: string;
};

function quantityLabel(item: FridgeItem): string {
    return formatQuantityDisplayParts(item.quantity.amount, item.quantity.unit);
}

function locationSelect(
    locations: FridgeLocation[],
    selectedId: string,
    name: string,
    id: string,
): string {
    const options = locations
        .map((loc) => {
            const sel = loc.id === selectedId ? " selected" : "";
            return `<option value="${escapeHtml(loc.id)}"${sel}>${escapeHtml(loc.name)}</option>`;
        })
        .join("");
    return `<select id="${escapeHtml(id)}" name="${escapeHtml(name)}">${options}</select>`;
}

function modalOpen(view: FridgePageView, id: string): boolean {
    return view.openModalId === id;
}

function modalError(view: FridgePageView, id: string): string {
    return view.error && modalOpen(view, id) ? errorBanner(view.error) : "";
}

/** One edit dialog per kind; unit lists differ. Filled from the row at open. */
const FRIDGE_EDIT_FOOD_ID = "fridge-edit-food";
const FRIDGE_EDIT_SUPPLY_ID = "fridge-edit-supply";
const FRIDGE_DELETE_ITEM_ID = "fridge-delete-item";

function openItemId(
    openModalId: string | undefined,
    prefix: string,
): string | null {
    if (!openModalId?.startsWith(prefix)) return null;
    const id = openModalId.slice(prefix.length);
    return id.length > 0 ? id : null;
}

function itemById(view: FridgePageView, id: string | null): FridgeItem | null {
    if (!id) return null;
    return view.items.find((item) => item.id === id) ?? null;
}

/**
 * Routes still reopen with `fridge-edit-<itemId>` / `fridge-delete-<itemId>`.
 * When that item is on the page, the matching shared dialog shows the error
 * and this id is reported to `pageLevelErrorBanner` so the banner is not
 * repeated under the header. An unknown id stays off the list.
 */
function sharedItemErrorId(view: FridgePageView): string | null {
    if (!view.error || !view.openModalId) return null;
    const editId = openItemId(view.openModalId, "fridge-edit-");
    if (editId && itemById(view, editId)) return view.openModalId;
    const deleteId = openItemId(view.openModalId, "fridge-delete-");
    if (deleteId && itemById(view, deleteId)) return view.openModalId;
    return null;
}

function editReopenItem(
    view: FridgePageView,
    kind: FridgeItem["kind"],
): FridgeItem | null {
    const item = itemById(view, openItemId(view.openModalId, "fridge-edit-"));
    if (!item || item.kind !== kind) return null;
    return item;
}

function itemTriggerData(item: FridgeItem): Record<string, string> {
    return {
        "item-id": item.id,
        "item-name": item.displayName,
        "item-kind": item.kind,
        "item-amount": String(item.quantity.amount),
        "item-unit": item.quantity.unit,
        "item-location": item.locationId,
        "item-expires": item.expiresOn ?? "",
    };
}

function itemRow(item: FridgeItem, today: string): string {
    const editTarget =
        item.kind === "supply" ? FRIDGE_EDIT_SUPPLY_ID : FRIDGE_EDIT_FOOD_ID;
    const data = itemTriggerData(item);
    const rowActions = `${modalTrigger({
        target: editTarget,
        label: `Edit ${item.displayName}`,
        className: "btn-sm btn-icon",
        icon: iconPencil(),
        data,
    })}${modalTrigger({
        target: FRIDGE_DELETE_ITEM_ID,
        label: `Delete ${item.displayName}`,
        className: "btn-sm btn-icon btn-danger",
        icon: iconTrash(),
        data,
    })}`;
    return renderFridgeItemRow({
        id: item.id,
        kind: item.kind,
        displayName: item.displayName,
        quantityLabel: quantityLabel(item),
        expiresOn: item.expiresOn,
        expiryLevel: expiryLevel(item.expiresOn, today),
        rowActions,
    });
}

function editFields(
    kind: FridgeItem["kind"],
    locations: FridgeLocation[],
    item: FridgeItem | null,
): string {
    const idPrefix = `qty-edit-${kind}`;
    const locId = `move-edit-${kind}`;
    const expiresId = `expires-edit-${kind}`;
    const qty =
        kind === "food"
            ? renderQuantityField({
                  kind: "food",
                  amount: item?.quantity.amount,
                  unit: item?.quantity.unit,
                  idPrefix,
                  namePrefix: "qty",
                  required: true,
              })
            : renderQuantityField({
                  kind: "supply",
                  amount: item?.quantity.amount,
                  unit: item?.quantity.unit ?? "roll",
                  units: SUPPLY_UNITS,
                  idPrefix,
                  namePrefix: "qty",
                  required: true,
              });
    return `${qty}
<label for="${locId}">Location</label>
${locationSelect(locations, item?.locationId ?? "", "location_id", locId)}
<label for="${expiresId}">Expires</label>
<input id="${expiresId}" name="expires_on" type="date" value="${escapeHtml(item?.expiresOn ?? "")}" />`;
}

function sharedEditModal(
    kind: FridgeItem["kind"],
    locations: FridgeLocation[],
    view: FridgePageView,
): string {
    const id = kind === "food" ? FRIDGE_EDIT_FOOD_ID : FRIDGE_EDIT_SUPPLY_ID;
    const item = editReopenItem(view, kind);
    const openId = item ? `fridge-edit-${item.id}` : "";
    const open = item != null && modalOpen(view, openId);
    const action = item ? `/fridge/items/${item.id}` : "";
    const title = item ? `Edit ${item.displayName}` : "Edit item";
    return modal({
        id,
        title,
        openOnLoad: open,
        body: `${open ? modalError(view, openId) : ""}<form class="fridge-item-edit" method="post" action="${escapeHtml(action)}">
${editFields(kind, locations, item)}
<button type="submit" class="btn-primary">Save</button>
</form>`,
    });
}

function sharedDeleteModal(view: FridgePageView): string {
    const item = itemById(view, openItemId(view.openModalId, "fridge-delete-"));
    const openId = item ? `fridge-delete-${item.id}` : "";
    const open = item != null && modalOpen(view, openId);
    return confirmModal({
        id: FRIDGE_DELETE_ITEM_ID,
        title: "Delete item",
        message: item
            ? `Remove ${item.displayName} from the fridge?`
            : "Remove this item from the fridge?",
        action: item ? `/fridge/items/${item.id}/delete` : "",
        confirmLabel: "Delete",
        openOnLoad: open,
        bodyPrefix: open ? modalError(view, openId) : "",
    });
}

function locationSection(
    location: FridgeLocation,
    items: FridgeItem[],
    view: FridgePageView,
    today: string,
): { section: string; modals: string; modalIds: string[] } {
    const locItems = items.filter((item) => item.locationId === location.id);
    const rows = locItems.map((item) => itemRow(item, today)).join("");
    const empty = locItems.length
        ? ""
        : emptyState(`Add an item to ${location.name}.`, "add-item-prompt");
    const pickerId = `picker-${location.id}`;
    const foodModalId = `fridge-add-food-${location.id}`;
    const supplyModalId = `fridge-add-supply-${location.id}`;
    const removeModalId = `fridge-remove-location-${location.id}`;
    const locationModals =
        modal({
            id: foodModalId,
            title: "Add food",
            openOnLoad: modalOpen(view, foodModalId),
            body: `${modalError(view, foodModalId)}${renderFoodPicker({
                id: pickerId,
                action: "/fridge/items",
                method: "post",
                hiddenFields: { kind: "food", location_id: location.id },
                includeQuantity: true,
            })}`,
        }) +
        modal({
            id: supplyModalId,
            title: "Add household item",
            openOnLoad: modalOpen(view, supplyModalId),
            body: `${modalError(view, supplyModalId)}<form class="fridge-add-supply" method="post" action="/fridge/items">
<input type="hidden" name="kind" value="supply" />
<input type="hidden" name="location_id" value="${escapeHtml(location.id)}" />
<label for="supply-name-${escapeHtml(location.id)}">Name</label>
<input id="supply-name-${escapeHtml(location.id)}" name="name" type="text" required autocomplete="off" />
${renderQuantityField({
    kind: "supply",
    unit: "roll",
    units: SUPPLY_UNITS,
    idPrefix: `supply-qty-${location.id}`,
    namePrefix: "qty",
    required: true,
})}
<button type="submit" class="btn-primary">Add household item</button>
</form>`,
        }) +
        confirmModal({
            id: removeModalId,
            title: "Remove location",
            message: `Remove ${location.name} and everything in it?`,
            action: `/fridge/locations/${location.id}/delete`,
            confirmLabel: "Remove",
            openOnLoad: modalOpen(view, removeModalId),
            bodyPrefix: modalError(view, removeModalId),
        });
    const locationModalIds = [foodModalId, supplyModalId, removeModalId];
    const headActions = `<div class="row-actions">
${modalTrigger({
    target: foodModalId,
    label: "Add food",
    className: "btn-sm",
})}
<span class="fridge-supply-action">${modalTrigger({
        target: supplyModalId,
        label: "Add household item",
        className: "btn-sm",
    })}</span>
${modalTrigger({
    target: removeModalId,
    label: "Remove",
    className: "btn-sm btn-danger",
})}
</div>`;
    const section = `<section class="fridge-location panel" data-location-id="${escapeHtml(location.id)}">
<div class="fridge-location-head row">
<h2 class="row-title">${escapeHtml(location.name)}</h2>
${headActions}
</div>
${empty}
<ul class="fridge-items list">${rows}</ul>
</section>`;
    return {
        section,
        modals: locationModals,
        modalIds: locationModalIds,
    };
}

export function renderFridgePage(view: FridgePageView): string {
    const today = utcTodayFromDate();
    const addLocationId = "fridge-add-location";
    const emptyPrompt =
        view.locations.length === 0
            ? emptyState("Add a location, then add an item.", "empty-fridge")
            : "";
    const expiring = renderExpiringStrip(
        listExpiring(view.items, 3).map((item) => ({
            id: item.id,
            displayName: item.displayName,
            expiresOn: item.expiresOn ?? "",
        })),
    );
    const locationParts = view.locations.map((loc) =>
        locationSection(loc, view.items, view, today),
    );
    const itemErrorId = sharedItemErrorId(view);
    const modalIds = [
        addLocationId,
        ...locationParts.flatMap((part) => part.modalIds),
        ...(itemErrorId ? [itemErrorId] : []),
    ];
    const sections = locationParts.map((part) => part.section).join("");
    const modals =
        modal({
            id: addLocationId,
            title: "Add location",
            openOnLoad: modalOpen(view, addLocationId),
            body: `${modalError(view, addLocationId)}<form class="fridge-add-location" method="post" action="/fridge/locations">
<label for="location_name">Location name</label>
<input id="location_name" name="name" type="text" required maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add location</button>
</form>`,
        }) +
        locationParts.map((part) => part.modals).join("") +
        sharedEditModal("food", view.locations, view) +
        sharedEditModal("supply", view.locations, view) +
        sharedDeleteModal(view);
    const body = `
        ${pageHeader({
            title: "Fridge",
            titleActions: modalTrigger({
                target: addLocationId,
                label: "Add location",
                className: "btn-sm btn-primary",
            }),
        })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${emptyPrompt}
        ${expiring}
        ${sections}
        ${modals}
    `;
    return renderAppShell({
        title: "Fridge",
        active: "fridge",
        theme: view.chrome.theme,
        body,
    });
}
