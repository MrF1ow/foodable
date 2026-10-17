import { formatQuantity, isQuantityUnit } from "../../domain/quantity.js";
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
import {
    disclosure,
    emptyState,
    errorBanner,
    pageHeader,
} from "../components/ui.js";
import { listExpiring } from "../../domain/stock.js";

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
};

function quantityLabel(item: FridgeItem): string {
    if (isQuantityUnit(item.quantity.unit)) {
        return formatQuantity({
            amount: item.quantity.amount,
            unit: item.quantity.unit,
        });
    }
    return `${item.quantity.amount} ${item.quantity.unit}`;
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

function itemRow(item: FridgeItem, locations: FridgeLocation[]): string {
    const qtyId = `qty-${item.id}`;
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
    return renderFridgeItemRow({
        id: item.id,
        kind: item.kind,
        displayName: item.displayName,
        quantityLabel: quantityLabel(item),
        expiresOn: item.expiresOn,
        editFields: `${qty}
<label for="move-${escapeHtml(item.id)}">Location</label>
${locationSelect(locations, item.locationId, "location_id", `move-${item.id}`)}
<label for="expires-${escapeHtml(item.id)}">Expires</label>
<input id="expires-${escapeHtml(item.id)}" name="expires_on" type="date" value="${escapeHtml(item.expiresOn ?? "")}" />`,
        extraActions:
            item.foodId == null
                ? ""
                : `<form class="fridge-item-eat" method="post" action="/fridge/items/${escapeHtml(item.id)}/eat">
<button type="submit" class="btn-sm">Ate it</button>
</form>
<form class="fridge-item-discard" method="post" action="/fridge/items/${escapeHtml(item.id)}/discard">
<button type="submit" class="btn-sm">Toss</button>
</form>`,
    });
}

function locationSection(
    location: FridgeLocation,
    items: FridgeItem[],
    locations: FridgeLocation[],
): string {
    const rows = items
        .filter((item) => item.locationId === location.id)
        .map((item) => itemRow(item, locations))
        .join("");
    const empty = items.some((item) => item.locationId === location.id)
        ? ""
        : emptyState(`Add an item to ${location.name}.`, "add-item-prompt");
    const pickerId = `picker-${location.id}`;
    return `<section class="fridge-location panel" data-location-id="${escapeHtml(location.id)}">
<div class="fridge-location-head row">
<h2 class="row-title">${escapeHtml(location.name)}</h2>
<form class="row-meta" method="post" action="/fridge/locations/${escapeHtml(location.id)}/delete">
<button type="submit" class="btn-sm btn-danger">Remove</button>
</form>
</div>
${empty}
<ul class="fridge-items list">${rows}</ul>
${disclosure({
    summary: "<h3>Add food</h3>",
    body: renderFoodPicker({
        id: pickerId,
        action: "/fridge/items",
        method: "post",
        hiddenFields: { kind: "food", location_id: location.id },
        includeQuantity: true,
    }),
})}
${disclosure({
    summary: "<h3>Add supply</h3>",
    body: `<form class="fridge-add-supply" method="post" action="/fridge/items">
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
<button type="submit" class="btn-primary">Add supply</button>
</form>`,
})}
</section>`;
}

export function renderFridgePage(view: FridgePageView): string {
    const error = errorBanner(view.error);
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
        .map((loc) => locationSection(loc, view.items, view.locations))
        .join("");
    const body = `
        ${pageHeader({ title: "Fridge" })}
        ${error}
        ${emptyPrompt}
        ${expiring}
        ${sections}
        ${disclosure({
            summary: "Add location",
            open: view.locations.length === 0,
            body: `<form class="fridge-add-location" method="post" action="/fridge/locations">
<label for="location_name">Location name</label>
<input id="location_name" name="name" type="text" required maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add location</button>
</form>`,
        })}
    `;
    return renderAppShell({
        title: "Fridge",
        active: "fridge",
        theme: view.chrome.theme,
        body,
    });
}
