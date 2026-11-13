import {
    defaultFreezeExpiry,
    type FridgeItem,
    type FridgeLocation,
    type FridgeSnapshot,
} from "../../../domain/fridge.js";
import type { Food } from "../../../domain/foods.js";
import type { GroceryLine } from "../../../domain/grocery.js";
import type { ExpiringUse } from "../../../domain/suggestions.js";
import {
    daysUntilExpiry,
    expiryLevel,
    listExpiring,
} from "../../../domain/stock.js";
import type { AppChromeBase } from "../../attention.js";
import type { Notice } from "../../../domain/notices.js";
import { noticeStrip, stripNotices } from "./notice-strip.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { sheet } from "../../components/v2/sheet.js";
import { stepper } from "../../components/v2/stepper.js";
import { fridgeRow, rowList, sectionHeader } from "../../components/v2/rows.js";
import {
    iconChevronRight,
    iconMinus,
    iconPlus,
} from "../../components/v2/icons.js";
import {
    type DidYouMeanModal,
    renderDidYouMeanBlock,
} from "../../components/did-you-mean.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { renderAppShell } from "../../shell.js";
import { fdIcon } from "../../components/fd-icons.js";
import { formatExpiryWhen, expiryToneClass } from "./today-rail.js";
import { kitchenAddButton, kitchenTopTools } from "./kitchen-head.js";
import { selectMode } from "./select-mode.js";
import {
    type KitchenFridgeGroceryOverview,
    kitchenFridgeItemCountLabel,
    renderKitchenOverviewHead,
    renderKitchenOverviewGroceriesCard,
    wrapKitchenOverviewColumns,
} from "./kitchen-overview.js";

export const FD_FRIDGE_ADD_SHEET_ID = "fd-fridge-add";

export type KitchenFridgeFoodMeta = Pick<
    Food,
    "id" | "genericFoodId" | "usualAmount"
>;

export type KitchenFridgeV2View = FridgeSnapshot & {
    chrome: AppChromeBase;
    today: string;
    foodsById?: ReadonlyMap<string, KitchenFridgeFoodMeta>;
    /** For each expiring item, the recipes that use it (Use soon lines). */
    useSoonUses?: readonly ExpiringUse[];
    error?: string;
    openItemId?: string;
    openAdd?: boolean;
    openModalId?: string;
    didYouMean?: DidYouMeanModal;
    freezeDefaultExpiry: string;
    groceryLines?: readonly GroceryLine[];
    groceryOverview?: KitchenFridgeGroceryOverview;
    /** The household's open notices; the usuals running low show in place. */
    notices?: readonly Notice[];
};

export type FridgeLocationGroup = {
    location: FridgeLocation;
    items: FridgeItem[];
};

export function fridgeItemSheetId(itemId: string): string {
    return `fd-fridge-item-${itemId}`;
}

export function formatFridgeExpiryLabel(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

export function groupFridgeItemsByLocation(
    locations: readonly FridgeLocation[],
    items: readonly FridgeItem[],
): FridgeLocationGroup[] {
    const sorted = locations
        .slice()
        .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
    const byLoc = new Map<string, FridgeItem[]>();
    for (const loc of sorted) byLoc.set(loc.id, []);
    for (const row of items) {
        const bucket = byLoc.get(row.locationId);
        if (bucket) bucket.push(row);
    }
    for (const bucket of byLoc.values()) {
        bucket.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return sorted.map((location) => ({
        location,
        items: byLoc.get(location.id) ?? [],
    }));
}

function expiryDateTone(
    expiresOn: string | null | undefined,
    today: string,
): string {
    const level = expiresOn
        ? (expiryLevel(expiresOn, today) ?? undefined)
        : undefined;
    if (level === "expired" || level === "high") return "fd-row__date--high";
    if (level === "medium") return "fd-row__date--medium";
    if (level === "low") return "fd-row__date--low";
    return "";
}

function expiryDateHtml(
    expiresOn: string | null | undefined,
    today: string,
): { label: string; dateTime?: string; className: string } {
    if (!expiresOn?.trim()) {
        return { label: "No date", className: "" };
    }
    const level = expiryLevel(expiresOn, today);
    const urgent =
        level === "expired" || level === "high" || level === "medium";
    const label = urgent
        ? formatExpiryWhen(today, expiresOn)
        : formatFridgeExpiryLabel(expiresOn);
    return {
        label,
        dateTime: urgent ? undefined : expiresOn,
        className: expiryDateTone(expiresOn, today),
    };
}

export function eatPortionAmount(
    item: FridgeItem,
    food: KitchenFridgeFoodMeta | undefined,
): number {
    const usual = food?.usualAmount;
    if (usual && usual.unit === item.quantity.unit && usual.amount > 0) {
        return Math.min(usual.amount, item.quantity.amount);
    }
    const unit = item.quantity.unit;
    if (unit === "each" || unit === "portion") {
        return Math.min(1, item.quantity.amount);
    }
    if (unit === "g" || unit === "ml") {
        return Math.min(100, item.quantity.amount);
    }
    return Math.min(1, item.quantity.amount);
}

const FRIDGE_RETURN_TO = "/kitchen/fridge";

export function formatSheetExpiryLine(
    today: string,
    expiresOn: string,
): string {
    const days = daysUntilExpiry(today, expiresOn);
    if (days < 0) return "Expired";
    if (days === 0) return "Expires today";
    if (days === 1) return "Expires tomorrow";
    return `Expires in ${days} days`;
}

function locationName(
    locations: readonly FridgeLocation[],
    locationId: string,
): string {
    return locations.find((loc) => loc.id === locationId)?.name ?? "Fridge";
}

function itemSheetSubtitle(
    item: FridgeItem,
    view: KitchenFridgeV2View,
): string {
    const place = locationName(view.locations, item.locationId);
    if (item.purchasedOn) {
        return `${place} · bought ${formatFridgeExpiryLabel(item.purchasedOn)}`;
    }
    return place;
}

function useSoonStrip(view: KitchenFridgeV2View): string {
    const primary = listExpiring(view.items, view.today, 3);
    const extra = listExpiring(view.items, view.today, 7)
        .filter((item) => !primary.some((row) => row.id === item.id))
        .slice(0, Math.max(0, 5 - primary.length));
    const items = [...primary, ...extra];
    if (items.length === 0) return "";
    const usesByItem = new Map(
        (view.useSoonUses ?? []).map((use) => [use.item.id, use.recipes[0]]),
    );
    const cards = items
        .map((item, index) => {
            const desktopOnly =
                index >= primary.length
                    ? " fd-kitchen-use-card--desktop-only"
                    : "";
            const expiresOn = item.expiresOn ?? "";
            const level = expiryLevel(expiresOn, view.today) ?? "medium";
            const when = formatExpiryWhen(view.today, expiresOn);
            const sheetId = fridgeItemSheetId(item.id);
            const qty = formatQuantityDisplayParts(
                item.quantity.amount,
                item.quantity.unit,
            );
            const recipe = usesByItem.get(item.id);
            const useIn = recipe
                ? `<span class="fd-kitchen-use-card__use">Use in: ${esc(recipe.name)}</span>`
                : "";
            return `<button type="button" class="fd-kitchen-use-card${desktopOnly}" commandfor="${esc(sheetId)}" command="show-modal" data-sheet-id="${esc(sheetId)}">
<span class="fd-kitchen-use-card__when ${expiryToneClass(level)}">${esc(when)}</span>
<span class="fd-kitchen-use-card__title">${esc(item.displayName)}</span>
<span class="fd-kitchen-use-card__meta">${esc(qty)}</span>${useIn}
</button>`;
        })
        .join("");
    return `<section class="fd-kitchen-use-soon" aria-label="Use soon">${String(
        sectionHeader({ title: "Use soon", count: items.length, level: 3 }),
    )}<div class="fd-kitchen-use-soon__scroll">${cards}</div></section>`;
}

function fridgeItemRowMarkup(
    item: FridgeItem,
    view: KitchenFridgeV2View,
): Html {
    const qty = formatQuantityDisplayParts(
        item.quantity.amount,
        item.quantity.unit,
    );
    const date = expiryDateHtml(item.expiresOn, view.today);
    const sheetId = fridgeItemSheetId(item.id);
    const food = item.foodId ? view.foodsById?.get(item.foodId) : undefined;
    const eatAmount = eatPortionAmount(item, food);
    const swipe = {
        lead: {
            label: "Ate some",
            form: {
                action: `/kitchen/fridge/items/${item.id}/eat`,
                fields: {
                    qty_amount: String(eatAmount),
                    return_to: FRIDGE_RETURN_TO,
                },
            },
        },
        trail: {
            label: "Toss",
            form: {
                action: `/kitchen/fridge/items/${item.id}/discard`,
                fields: { return_to: FRIDGE_RETURN_TO },
            },
        },
        sheetId,
    };
    const rowHtml = String(
        fridgeRow({
            title: item.displayName,
            qty,
            date: date.label,
            dateTime: date.dateTime,
            dateClass: date.className || undefined,
            swipe,
            select: {
                name: "ids[]",
                value: item.id,
                label: item.displayName,
            },
        }),
    );
    const attrs = ` data-fd-fridge-row data-sheet-id="${esc(sheetId)}" tabindex="0"`;
    return raw(
        // A function replacement: a string would read `$` in an id as a pattern.
        rowHtml.replace(
            "<li ",
            () => `<li id="fd-fridge-row-${esc(item.id)}"${attrs} `,
        ),
    );
}

function locationSection(
    group: FridgeLocationGroup,
    view: KitchenFridgeV2View,
    emptyOnOverview = false,
): string {
    const locId = `fd-kitchen-loc-${group.location.id}`;
    const header = String(
        sectionHeader({
            title: group.location.name,
            count: group.items.length,
            id: locId,
        }),
    );
    if (group.items.length === 0) {
        if (!emptyOnOverview) return "";
        return `<section class="fd-kitchen-fridge-loc fd-kitchen-overview-loc fd-kitchen-overview-loc--empty" aria-labelledby="${esc(locId)}">${header}<p class="fd-kitchen-overview-loc-empty">Nothing here</p></section>`;
    }
    const rows = group.items.map((item) => fridgeItemRowMarkup(item, view));
    return `<section class="fd-kitchen-fridge-loc fd-kitchen-overview-loc" aria-labelledby="${esc(locId)}">${header}${String(rowList(rows, { label: group.location.name }))}</section>`;
}

export function renderFridgeLocationSections(
    view: KitchenFridgeV2View,
    opts: { includeEmptyLocations?: boolean } = {},
): string {
    const groups = groupFridgeItemsByLocation(view.locations, view.items);
    return groups
        .map((group) =>
            locationSection(group, view, !!opts.includeEmptyLocations),
        )
        .join("");
}

function roundAction(
    label: string,
    opts: {
        form?: string;
        type?: "submit" | "button";
        danger?: boolean;
        icon: string;
        /** Reveals this panel instead of submitting (button type). */
        controls?: string;
    },
): string {
    const danger = opts.danger ? " fd-kitchen-round-action--danger" : "";
    const type = opts.type ?? "button";
    const form = opts.form ? ` form="${esc(opts.form)}"` : "";
    const controls = opts.controls
        ? ` aria-controls="${esc(opts.controls)}" aria-expanded="false" data-fd-reveal="${esc(opts.controls)}"`
        : "";
    return `<button type="${type}" class="fd-kitchen-round-action${danger}"${form}${controls} aria-label="${esc(label)}"><span class="fd-kitchen-round-action__icon" aria-hidden="true">${opts.icon}</span><span class="fd-kitchen-round-action__label">${esc(label)}</span></button>`;
}

function itemSheetExpiryStatus(
    item: FridgeItem,
    view: KitchenFridgeV2View,
): string {
    if (!item.expiresOn) return "";
    const level = expiryLevel(item.expiresOn, view.today) ?? "low";
    const label = formatSheetExpiryLine(view.today, item.expiresOn);
    return `<p class="fd-kitchen-item-expiry ${expiryToneClass(level)}"><span class="fd-kitchen-item-expiry__dot" aria-hidden="true"></span>${esc(label)}</p>`;
}

function sheetNavRow(
    label: string,
    value: string,
    control: string,
    icon: string,
): string {
    return `<div class="fd-kitchen-sheet-row"><span class="fd-kitchen-sheet-row__icon" aria-hidden="true">${icon}</span><span class="fd-kitchen-sheet-row__label">${esc(label)}</span><span class="fd-kitchen-sheet-row__value">${control}<span class="fd-kitchen-sheet-row__meta">${esc(value)}</span><span class="fd-kitchen-sheet-row__chev" aria-hidden="true">${String(iconChevronRight())}</span></span></div>`;
}

function itemSheet(item: FridgeItem, view: KitchenFridgeV2View): string {
    const open = view.openItemId === item.id;
    const sheetId = fridgeItemSheetId(item.id);
    const food = item.foodId ? view.foodsById?.get(item.foodId) : undefined;
    const eatAmount = eatPortionAmount(item, food);
    const subtitle = itemSheetSubtitle(item, view);
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const eatFormId = `${sheetId}-eat-form`;
    const qtyFormId = `${sheetId}-qty-form`;
    const freezeFormId = `${sheetId}-freeze-form`;
    const groceryFormId = `${sheetId}-grocery-form`;
    const tossFormId = `${sheetId}-toss-form`;
    const locationOptions = view.locations
        .map(
            (loc) =>
                `<option value="${esc(loc.id)}"${loc.id === item.locationId ? " selected" : ""}>${esc(loc.name)}</option>`,
        )
        .join("");
    const expiresValue = item.expiresOn ?? "";
    const usualBuy =
        item.foodId != null
            ? `<a class="fd-kitchen-sheet-row fd-kitchen-sheet-row--link" href="/kitchen/usuals/${esc(item.foodId)}"><span class="fd-kitchen-sheet-row__label">Usually buy</span><span class="fd-kitchen-sheet-row__value"><span class="fd-kitchen-sheet-row__meta">Usuals</span><span class="fd-kitchen-sheet-row__chev" aria-hidden="true">${String(iconChevronRight())}</span></span></a>`
            : "";
    const body = `${error}
<div class="fd-kitchen-item-sheet">
${itemSheetExpiryStatus(item, view)}
<div class="fd-kitchen-round-actions" role="group" aria-label="Item actions">
${roundAction("Ate some", {
    form: eatFormId,
    type: "submit",
    icon: String(iconMinus()),
})}
${roundAction("Add to list", {
    form: groceryFormId,
    type: "submit",
    icon: `<svg class="fd-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6l-1-2H3"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></svg>`,
})}
${roundAction("Freeze", {
    controls: freezeFormId,
    icon: `<svg class="fd-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/></svg>`,
})}
${roundAction("Toss", {
    form: tossFormId,
    type: "submit",
    danger: true,
    icon: `<svg class="fd-icon" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2"/><path d="M7 7l1 13h8l1-13"/></svg>`,
})}
</div>
<form id="${eatFormId}" method="post" action="/kitchen/fridge/items/${esc(item.id)}/eat" class="fd-visually-hidden" aria-hidden="true">
<input type="hidden" name="return_to" value="${esc(FRIDGE_RETURN_TO)}" />
<input type="hidden" name="qty_amount" value="${esc(String(eatAmount))}" />
</form>
<form id="${groceryFormId}" method="post" action="/kitchen/fridge/items/${esc(item.id)}/add-to-grocery" class="fd-visually-hidden" aria-hidden="true">
<input type="hidden" name="from" value="${esc(FRIDGE_RETURN_TO)}" />
</form>
<form id="${freezeFormId}" method="post" action="/kitchen/fridge/items/${esc(item.id)}/freeze" class="fd-kitchen-freeze" hidden>
<input type="hidden" name="return_to" value="${esc(FRIDGE_RETURN_TO)}" />
<label class="fd-kitchen-freeze__field"><span class="fd-kitchen-sheet-label">Freeze until</span><input type="date" name="expires_on" value="${esc(view.freezeDefaultExpiry)}" required /></label>
<button type="submit" class="fd-btn fd-btn--primary fd-kitchen-freeze__submit">Freeze</button>
</form>
<form id="${tossFormId}" method="post" action="/kitchen/fridge/items/${esc(item.id)}/discard" class="fd-visually-hidden" aria-hidden="true">
<input type="hidden" name="return_to" value="${esc(FRIDGE_RETURN_TO)}" />
</form>
<form id="${qtyFormId}" method="post" action="/kitchen/fridge/items/${esc(item.id)}">
<input type="hidden" name="return_to" value="${esc(FRIDGE_RETURN_TO)}" />
<p class="fd-kitchen-sheet-label">How much is left</p>
${String(
    stepper({
        name: "qty_amount",
        label: "Quantity",
        value: item.quantity.amount,
        min: 0,
        step: item.quantity.amount >= 1 ? 1 : 0.1,
        inputStep: "any",
        unit: item.quantity.unit,
        id: `${sheetId}-qty-amt`,
    }),
)}
<input type="hidden" name="qty_unit" value="${esc(item.quantity.unit)}" />
<div class="fd-kitchen-sheet-rows">
${sheetNavRow(
    "Expires",
    expiresValue ? formatFridgeExpiryLabel(expiresValue) : "No date",
    `<input type="date" class="fd-kitchen-sheet-row__control" name="expires_on" value="${esc(expiresValue)}" />`,
    fdIcon("cal"),
)}
${sheetNavRow(
    "Kept in",
    locationName(view.locations, item.locationId),
    `<select class="fd-kitchen-sheet-row__control" name="location_id" aria-label="Location">${locationOptions}</select>`,
    fdIcon("fridge"),
)}
</div>
${usualBuy}
</form>
</div>`;
    return sheet({
        id: sheetId,
        kind: "edit",
        title: item.displayName,
        subtitle,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${qtyFormId}">Save</button>`,
        openOnLoad: open,
    });
}

function didYouMeanBlock(view: KitchenFridgeV2View): string {
    const modal = view.didYouMean;
    if (!modal || !view.openModalId || modal.modalId !== view.openModalId) {
        return "";
    }
    return renderDidYouMeanBlock({
        action: modal.action,
        view: modal.view,
    }).replaceAll("did-you-mean-", "fd-did-you-mean-");
}

function addItemSheet(view: KitchenFridgeV2View): string {
    if (view.locations.length === 0) return "";
    const defaultLoc = view.locations[0]!.id;
    const locationOptions = view.locations
        .map(
            (loc) =>
                `<option value="${esc(loc.id)}"${loc.id === defaultLoc ? " selected" : ""}>${esc(loc.name)}</option>`,
        )
        .join("");
    const addError =
        view.openAdd && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const body = `${addError}${didYouMeanBlock(view)}<form id="fd-fridge-add-form" method="post" action="/kitchen/fridge/items">
<input type="hidden" name="kind" value="food" />
<label class="fd-kitchen-sheet-label">Location<select name="location_id" required>${locationOptions}</select></label>
<label class="fd-kitchen-sheet-label">Name<input name="food_name" type="text" required autocomplete="off" /></label>
${String(
    stepper({
        name: "qty_amount",
        label: "Amount",
        value: 1,
        min: 0,
        step: 1,
        inputStep: "any",
        unit: "each",
        id: "fd-fridge-add-qty",
    }),
)}
<input type="hidden" name="qty_unit" value="each" />
</form>`;
    return sheet({
        id: FD_FRIDGE_ADD_SHEET_ID,
        kind: "edit",
        title: "Add item",
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="fd-fridge-add-form">Add</button>`,
        openOnLoad: view.openAdd,
    });
}

function allItemSheets(view: KitchenFridgeV2View): string {
    return view.items.map((item) => itemSheet(item, view)).join("");
}

export function renderKitchenFridgeBody(view: KitchenFridgeV2View): string {
    const sections = renderFridgeLocationSections(view, {
        includeEmptyLocations: true,
    });
    const groceriesCard = view.groceryOverview
        ? renderKitchenOverviewGroceriesCard(view.groceryOverview)
        : "";
    const columns = wrapKitchenOverviewColumns(sections, groceriesCard);
    const empty =
        view.locations.length === 0
            ? `<p class="fd-kitchen-fridge-empty">Add a location, then add items with the button above.</p>`
            : view.items.length === 0
              ? `<p class="fd-kitchen-fridge-empty">Nothing in the fridge yet.</p>`
              : "";
    const addBtn = kitchenAddButton({
        target: FD_FRIDGE_ADD_SHEET_ID,
        label: "Add item",
    }).phone;
    const groceryOpen =
        view.groceryOverview?.openLineCount ??
        (view.groceryLines
            ? view.groceryLines.filter((row) => !row.checked).length
            : 0);
    const head = renderKitchenOverviewHead(view.items.length, groceryOpen);
    const select = selectMode({
        scope: "fridge",
        returnTo: FRIDGE_RETURN_TO,
        actions: [
            {
                kind: "confirm",
                key: "discard",
                label: "Discard",
                action: "/kitchen/fridge/bulk/discard",
                title: "Discard items",
                one: "Discard 1 item?",
                many: "Discard {n} items?",
                confirmLabel: "Discard",
            },
        ],
    });
    const selectable = view.items.length > 0;
    return `${head}
<div class="fd-kitchen-fridge-page"${select.rootAttrs}>
${kitchenTopTools(addBtn)}
${view.error && !view.openItemId && !view.openAdd ? String(settingsErrorBanner(view.error)) : ""}
${String(noticeStrip(stripNotices(view.notices ?? [], ["grocery.running_low"], undefined), { back: "/kitchen/fridge", label: "Running low" }))}
${useSoonStrip(view)}
${selectable ? select.tools + select.bar : ""}
${columns}
${empty}
${allItemSheets(view)}
${selectable ? select.sheets : ""}
${addItemSheet(view)}
</div>`;
}

export function renderKitchenFridgeV2Page(view: KitchenFridgeV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: "Fridge",
        active: "fridge",
        v2Kitchen: "fridge",
        body: renderKitchenFridgeBody(view),
    });
}

export function buildPreviewKitchenFridgeView(
    chrome: KitchenFridgeV2View["chrome"],
    today: string,
    overrides: Partial<KitchenFridgeV2View> = {},
): KitchenFridgeV2View {
    const locations = overrides.locations ?? [
        {
            id: "loc-fridge",
            householdId: "hh",
            name: "Fridge",
            sortOrder: 0,
        },
    ];
    const items = overrides.items ?? [
        {
            id: "it-1",
            householdId: "hh",
            locationId: "loc-fridge",
            kind: "food",
            displayName: "Eggs",
            quantity: { amount: 9, unit: "each" },
            foodId: "f-eggs",
            expiresOn: "2026-11-19",
        },
    ];
    return {
        chrome,
        today,
        locations,
        items,
        foodsById: overrides.foodsById ?? new Map(),
        freezeDefaultExpiry:
            overrides.freezeDefaultExpiry ?? defaultFreezeExpiry(today),
        ...overrides,
    };
}
