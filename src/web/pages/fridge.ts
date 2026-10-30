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
/** One add/remove dialog for every location. Filled from the location row. */
const FRIDGE_ADD_FOOD_ID = "fridge-add-food";
const FRIDGE_ADD_SUPPLY_ID = "fridge-add-supply";
const FRIDGE_REMOVE_LOCATION_ID = "fridge-remove-location";
const ADD_FOOD_PREFIX = "fridge-add-food-";
const ADD_SUPPLY_PREFIX = "fridge-add-supply-";
const REMOVE_LOCATION_PREFIX = "fridge-remove-location-";
const FRIDGE_FOOD_PICKER_ID = "fridge-food-picker";

function findItem(view: FridgePageView, id: string): FridgeItem | null {
    return view.items.find((item) => item.id === id) ?? null;
}

function findLocation(view: FridgePageView, id: string): FridgeLocation | null {
    return view.locations.find((location) => location.id === id) ?? null;
}

/**
 * Routes still reopen with `fridge-edit-<itemId>` / `fridge-delete-<itemId>`.
 * When that item is on the page, the matching shared dialog shows the error
 * and this id is reported to `pageLevelErrorBanner` so the banner is not
 * repeated under the header. An unknown id stays off the list.
 */
function sharedItemErrorId(view: FridgePageView): string | null {
    if (!view.error) return null;
    const edit = sharedDialogItem({
        openModalId: view.openModalId,
        prefix: "fridge-edit-",
        lookup: (id) => findItem(view, id),
    });
    if (edit) return edit.openModalId;
    const remove = sharedDialogItem({
        openModalId: view.openModalId,
        prefix: "fridge-delete-",
        lookup: (id) => findItem(view, id),
    });
    return remove ? remove.openModalId : null;
}

/**
 * Routes still reopen with `fridge-add-food-<locationId>`,
 * `fridge-add-supply-<locationId>`, and `fridge-remove-location-<locationId>`.
 * A known location reports that id so the banner stays inside the shared
 * dialog. An unknown id stays off the list and the page banner shows it.
 */
function sharedLocationErrorId(view: FridgePageView): string | null {
    if (!view.error) return null;
    for (const prefix of [
        ADD_FOOD_PREFIX,
        ADD_SUPPLY_PREFIX,
        REMOVE_LOCATION_PREFIX,
    ]) {
        const match = sharedDialogItem({
            openModalId: view.openModalId,
            prefix,
            lookup: (id) => findLocation(view, id),
        });
        if (match) return match.openModalId;
    }
    return null;
}

function reopenLocation(
    view: FridgePageView,
    prefix: string,
): FridgeLocation | null {
    return (
        sharedDialogItem({
            openModalId: view.openModalId,
            prefix,
            lookup: (id) => findLocation(view, id),
        })?.item ?? null
    );
}

function editReopenItem(
    view: FridgePageView,
    kind: FridgeItem["kind"],
): FridgeItem | null {
    const match = sharedDialogItem({
        openModalId: view.openModalId,
        prefix: "fridge-edit-",
        lookup: (id) => findItem(view, id),
    });
    if (!match || match.item.kind !== kind) return null;
    return match.item;
}

function itemFill(item: FridgeItem, mode: "edit" | "delete"): ModalFill {
    if (mode === "delete") {
        return {
            action: `/fridge/items/${item.id}/delete`,
            message: `Remove ${item.displayName} from the fridge?`,
        };
    }
    return {
        action: `/fridge/items/${item.id}`,
        title: `Edit ${item.displayName}`,
        fields: {
            qty_amount: item.quantity.amount,
            qty_unit: item.quantity.unit,
            location_id: item.locationId,
            expires_on: item.expiresOn ?? "",
        },
    };
}

function itemRow(item: FridgeItem, today: string): string {
    const editTarget =
        item.kind === "supply" ? FRIDGE_EDIT_SUPPLY_ID : FRIDGE_EDIT_FOOD_ID;
    const rowActions = `${modalTrigger({
        target: editTarget,
        label: `Edit ${item.displayName}`,
        className: "btn-sm btn-icon",
        icon: iconPencil(),
        fill: itemFill(item, "edit"),
    })}${modalTrigger({
        target: FRIDGE_DELETE_ITEM_ID,
        label: `Delete ${item.displayName}`,
        className: "btn-sm btn-icon btn-danger",
        icon: iconTrash(),
        fill: itemFill(item, "delete"),
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
        submitDisabled: item == null,
    });
}

function sharedDeleteModal(view: FridgePageView): string {
    const item = sharedDialogItem({
        openModalId: view.openModalId,
        prefix: "fridge-delete-",
        lookup: (id) => findItem(view, id),
    })?.item;
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
        submitDisabled: item == null,
    });
}

function locationFill(
    location: FridgeLocation,
    mode: "food" | "supply" | "remove",
): ModalFill {
    if (mode === "remove") {
        return {
            action: `/fridge/locations/${location.id}/delete`,
            message: `Remove ${location.name} and everything in it?`,
        };
    }
    if (mode === "supply") {
        return {
            action: "/fridge/items",
            title: `Add household item to ${location.name}`,
            fields: {
                location_id: location.id,
                kind: "supply",
                name: "",
                qty_amount: "",
                qty_unit: "roll",
            },
        };
    }
    return {
        action: "/fridge/items",
        title: `Add food to ${location.name}`,
        fields: {
            location_id: location.id,
            kind: "food",
            barcode: "",
            food_name: "",
            qty_amount: "",
            qty_unit: "g",
        },
    };
}

function locationSection(
    location: FridgeLocation,
    items: FridgeItem[],
    today: string,
): string {
    const locItems = items.filter((item) => item.locationId === location.id);
    const rows = locItems.map((item) => itemRow(item, today)).join("");
    const empty = locItems.length
        ? ""
        : emptyState(`Add an item to ${location.name}.`, "add-item-prompt");
    const headActions = `<div class="row-actions">
${modalTrigger({
    target: FRIDGE_ADD_FOOD_ID,
    label: "Add food",
    className: "btn-sm",
    fill: locationFill(location, "food"),
})}
<span class="fridge-supply-action">${modalTrigger({
        target: FRIDGE_ADD_SUPPLY_ID,
        label: "Add household item",
        className: "btn-sm",
        fill: locationFill(location, "supply"),
    })}</span>
${modalTrigger({
    target: FRIDGE_REMOVE_LOCATION_ID,
    label: "Remove",
    className: "btn-sm btn-danger",
    fill: locationFill(location, "remove"),
})}
</div>`;
    return `<section class="fridge-location panel" data-location-id="${escapeHtml(location.id)}">
<div class="fridge-location-head row">
<h2 class="row-title">${escapeHtml(location.name)}</h2>
${headActions}
</div>
${empty}
<ul class="fridge-items list">${rows}</ul>
</section>`;
}

function sharedAddFoodModal(view: FridgePageView): string {
    if (view.locations.length === 0) return "";
    const location = reopenLocation(view, ADD_FOOD_PREFIX);
    const openId = location ? `${ADD_FOOD_PREFIX}${location.id}` : "";
    const open = location != null && modalOpen(view, openId);
    return modal({
        id: FRIDGE_ADD_FOOD_ID,
        title: location ? `Add food to ${location.name}` : "Add food",
        openOnLoad: open,
        submitDisabled: location == null,
        body: `${open ? modalError(view, openId) : ""}${renderFoodPicker({
            id: FRIDGE_FOOD_PICKER_ID,
            action: location ? "/fridge/items" : "",
            method: "post",
            hiddenFields: { kind: "food", location_id: location?.id ?? "" },
            includeQuantity: true,
        })}`,
    });
}

function sharedAddSupplyModal(view: FridgePageView): string {
    if (view.locations.length === 0) return "";
    const location = reopenLocation(view, ADD_SUPPLY_PREFIX);
    const openId = location ? `${ADD_SUPPLY_PREFIX}${location.id}` : "";
    const open = location != null && modalOpen(view, openId);
    const action = location ? "/fridge/items" : "";
    return modal({
        id: FRIDGE_ADD_SUPPLY_ID,
        title: location
            ? `Add household item to ${location.name}`
            : "Add household item",
        openOnLoad: open,
        submitDisabled: location == null,
        body: `${open ? modalError(view, openId) : ""}<form class="fridge-add-supply" method="post" action="${escapeHtml(action)}">
<input type="hidden" name="kind" value="supply" />
<input type="hidden" name="location_id" value="${escapeHtml(location?.id ?? "")}" />
<label for="supply-name">Name</label>
<input id="supply-name" name="name" type="text" required autocomplete="off" />
${renderQuantityField({
    kind: "supply",
    unit: "roll",
    units: SUPPLY_UNITS,
    idPrefix: "supply-qty",
    namePrefix: "qty",
    required: true,
})}
<button type="submit" class="btn-primary">Add household item</button>
</form>`,
    });
}

function sharedRemoveLocationModal(view: FridgePageView): string {
    if (view.locations.length === 0) return "";
    const location = reopenLocation(view, REMOVE_LOCATION_PREFIX);
    const openId = location ? `${REMOVE_LOCATION_PREFIX}${location.id}` : "";
    const open = location != null && modalOpen(view, openId);
    return confirmModal({
        id: FRIDGE_REMOVE_LOCATION_ID,
        title: "Remove location",
        message: location
            ? `Remove ${location.name} and everything in it?`
            : "Remove this location and everything in it?",
        action: location ? `/fridge/locations/${location.id}/delete` : "",
        confirmLabel: "Remove",
        openOnLoad: open,
        bodyPrefix: open ? modalError(view, openId) : "",
        submitDisabled: location == null,
    });
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
    const sections = view.locations
        .map((loc) => locationSection(loc, view.items, today))
        .join("");
    const locationErrorId = sharedLocationErrorId(view);
    const itemErrorId = sharedItemErrorId(view);
    const modalIds = [
        addLocationId,
        ...(locationErrorId ? [locationErrorId] : []),
        ...(itemErrorId ? [itemErrorId] : []),
    ];
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
        sharedAddFoodModal(view) +
        sharedAddSupplyModal(view) +
        sharedRemoveLocationModal(view) +
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
