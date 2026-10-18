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

function itemRow(
    item: FridgeItem,
    locations: FridgeLocation[],
    view: FridgePageView,
    today: string,
): { row: string; modals: string; modalIds: string[] } {
    const qtyId = `qty-${item.id}`;
    const editId = `fridge-edit-${item.id}`;
    const deleteId = `fridge-delete-${item.id}`;
    const qty =
        item.kind === "food"
            ? renderQuantityField({
                  kind: "food",
                  amount: item.quantity.amount,
                  unit: item.quantity.unit,
                  idPrefix: qtyId,
                  namePrefix: "qty",
                  required: true,
              })
            : renderQuantityField({
                  kind: "supply",
                  amount: item.quantity.amount,
                  unit: item.quantity.unit,
                  units: SUPPLY_UNITS,
                  idPrefix: qtyId,
                  namePrefix: "qty",
                  required: true,
              });
    const editFields = `${qty}
<label for="move-${escapeHtml(item.id)}">Location</label>
${locationSelect(locations, item.locationId, "location_id", `move-${item.id}`)}
<label for="expires-${escapeHtml(item.id)}">Expires</label>
<input id="expires-${escapeHtml(item.id)}" name="expires_on" type="date" value="${escapeHtml(item.expiresOn ?? "")}" />`;
    const rowActions = `${modalTrigger({
        target: editId,
        label: `Edit ${item.displayName}`,
        className: "btn-sm btn-icon",
        icon: iconPencil(),
    })}${modalTrigger({
        target: deleteId,
        label: `Delete ${item.displayName}`,
        className: "btn-sm btn-icon btn-danger",
        icon: iconTrash(),
    })}`;
    const row = renderFridgeItemRow({
        id: item.id,
        kind: item.kind,
        displayName: item.displayName,
        quantityLabel: quantityLabel(item),
        expiresOn: item.expiresOn,
        expiryLevel: expiryLevel(item.expiresOn, today),
        rowActions,
    });
    const modals =
        modal({
            id: editId,
            title: `Edit ${item.displayName}`,
            openOnLoad: modalOpen(view, editId),
            body: `${modalError(view, editId)}<form class="fridge-item-edit" method="post" action="/fridge/items/${escapeHtml(item.id)}">
${editFields}
<button type="submit" class="btn-primary">Save</button>
</form>`,
        }) +
        confirmModal({
            id: deleteId,
            title: "Delete item",
            message: `Remove ${item.displayName} from the fridge?`,
            action: `/fridge/items/${item.id}/delete`,
            confirmLabel: "Delete",
            openOnLoad: modalOpen(view, deleteId),
            bodyPrefix: modalError(view, deleteId),
        });
    return { row, modals, modalIds: [editId, deleteId] };
}

function locationSection(
    location: FridgeLocation,
    items: FridgeItem[],
    locations: FridgeLocation[],
    view: FridgePageView,
    today: string,
): { section: string; modals: string; modalIds: string[] } {
    const locItems = items.filter((item) => item.locationId === location.id);
    const itemParts = locItems.map((item) =>
        itemRow(item, locations, view, today),
    );
    const rows = itemParts.map((part) => part.row).join("");
    const itemModals = itemParts.map((part) => part.modals).join("");
    const itemModalIds = itemParts.flatMap((part) => part.modalIds);
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
    const locationModalIds = [
        foodModalId,
        supplyModalId,
        removeModalId,
        ...itemModalIds,
    ];
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
        modals: locationModals + itemModals,
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
        locationSection(loc, view.items, view.locations, view, today),
    );
    const modalIds = [
        addLocationId,
        ...locationParts.flatMap((part) => part.modalIds),
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
        }) + locationParts.map((part) => part.modals).join("");
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
