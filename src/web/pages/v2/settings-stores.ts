import type { AppChromeBase } from "../../attention.js";
import type { GroceryStore } from "../../../domain/settings.js";
import { cls, esc, join, raw, type Html } from "../../components/v2/html.js";
import {
    iconCart,
    iconChevronRight,
    iconPlus,
    iconRepeat,
} from "../../components/v2/icons.js";
import { rowList, sectionHeader, usualRow } from "../../components/v2/rows.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
} from "./settings-shared.js";

export const STORES_PATH = "/settings/household/stores";

export const STORES_ADD_SHEET_ID = "fd-stores-add";
export const STORES_REORDER_SHEET_ID = "fd-stores-reorder";
export const STORES_DEFAULT_SHEET_ID = "fd-stores-default";

export const STORES_INTRO =
    "Where the household shops. Groceries are grouped by store, then by each store's sections in walking order.";
export const DEFAULT_STORE_HINT =
    "New items go here when Foodable has no better guess.";
export const USUAL_STORE_SUB_ON = "Falls back to the default";
export const USUAL_STORE_SUB_OFF = "Falls back to the store it was last on";
/** The pick order, spelled out under the two preferences. */
export const USUAL_STORE_ORDER_ON =
    "A food goes to its usual store, then the default store, then the store it was last on the list.";
export const USUAL_STORE_ORDER_OFF =
    "A food goes to its usual store, then the store it was last on the list, then the default store.";

export type StoreSummary = {
    id: string;
    name: string;
    sectionCount: number;
    /** Lines on the grocery list that sit in this store. */
    lineCount: number;
};

export type SettingsStoresV2View = {
    chrome: AppChromeBase;
    stores: StoreSummary[];
    defaultStoreId: string | null;
    useUsualStore: boolean;
    /** Owners and admins edit; members only read. */
    canManage: boolean;
    error?: string;
    openModalId?: string;
};

export function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

const ICON_TARGET = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.2"/></svg>`,
);
const ICON_GRIP = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M5 8h14M5 12h14M5 16h9"/></svg>`,
);
const ICON_UP = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 14l6-6 6 6"/></svg>`,
);
const ICON_DOWN = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 10l6 6 6-6"/></svg>`,
);

export type OrderItem = {
    id: string;
    /** Accessible name of the move buttons ("Move Produce up"). */
    label: string;
    /** The row's content after the handle. */
    main: Html;
};

/**
 * A reorderable list that posts the whole order. One form: every row carries a
 * hidden `order` field, so the DOM order is the submitted order. The drag
 * script (`stores.js`) reorders rows and submits the form; without it the
 * up/down buttons submit `move=<id>:up|down` and the server moves that one id.
 * `alwaysShowMoves` keeps the buttons visible (the store sheet); in a section
 * list they appear on hover and keyboard focus so the rows match the design.
 */
export function orderList(opts: {
    action: string;
    label: string;
    items: readonly OrderItem[];
    alwaysShowMoves?: boolean;
    hiddenFields?: Readonly<Record<string, string>>;
    /** Full page load instead of a Turbo visit (the sheet reopens from the URL). */
    turboFalse?: boolean;
}): Html {
    const hidden = Object.entries(opts.hiddenFields ?? {})
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`,
        )
        .join("");
    const last = opts.items.length - 1;
    const rows = opts.items.map((item, index) => {
        const move = (dir: "up" | "down", icon: Html, disabled: boolean) =>
            `<button type="submit" class="fd-order-move" name="move" value="${esc(item.id)}:${dir}" aria-label="Move ${esc(item.label)} ${dir}"${disabled ? " disabled" : ""}>${icon}</button>`;
        return `<li class="fd-order-item" data-fd-order-item><input type="hidden" name="order" value="${esc(item.id)}" /><span class="fd-order-handle" data-fd-order-handle aria-hidden="true">${ICON_GRIP}</span>${item.main}<span class="fd-order-moves">${move("up", ICON_UP, index === 0)}${move("down", ICON_DOWN, index === last)}</span></li>`;
    });
    return raw(
        `<form method="post" action="${esc(opts.action)}" class="fd-order-form" data-fd-order-form${opts.turboFalse ? ' data-turbo="false"' : ""}>${hidden}<ul class="${cls("fd-order-list", opts.alwaysShowMoves && "fd-order-list--moves")}" aria-label="${esc(opts.label)}" data-fd-order-list>${rows.join("")}</ul></form>`,
    );
}

function storeRow(store: StoreSummary): Html {
    return usualRow({
        title: store.name,
        parts: [
            store.sectionCount === 0
                ? "No sections"
                : plural(store.sectionCount, "section", "sections"),
            `${store.lineCount} on the list`,
        ],
        href: `${STORES_PATH}/${encodeURIComponent(store.id)}`,
        lead: { html: iconCart() },
        className: "fd-row--store",
    });
}

/** A quiet accent row that opens a sheet ("+ Add a store"). */
export function actionRow(opts: {
    variant: string;
    target: string;
    label: string;
    icon: Html;
}): Html {
    return raw(
        `<li class="fd-row fd-row--${esc(opts.variant)}"><button type="button" class="fd-stores-action" commandfor="${esc(opts.target)}" command="show-modal"><span class="fd-stores-action__icon" aria-hidden="true">${opts.icon}</span><span class="fd-stores-action__label">${esc(opts.label)}</span></button></li>`,
    );
}

function defaultStoreName(view: SettingsStoresV2View): string | null {
    return (
        view.stores.find((row) => row.id === view.defaultStoreId)?.name ?? null
    );
}

function defaultStoreRow(view: SettingsStoresV2View): Html {
    const name = defaultStoreName(view) ?? "None";
    const inner = `<span class="fd-stores-pref__icon" aria-hidden="true">${ICON_TARGET}</span><span class="fd-stores-pref__main"><span class="fd-row__title">Default store</span></span><span class="fd-stores-pref__value">${esc(name)}</span>`;
    if (!view.canManage) {
        return raw(
            `<li class="fd-row fd-row--stores-pref"><div class="fd-row__body fd-stores-pref">${inner}</div></li>`,
        );
    }
    return raw(
        `<li class="fd-row fd-row--stores-pref"><button type="button" class="fd-row__body fd-stores-pref" commandfor="${esc(STORES_DEFAULT_SHEET_ID)}" command="show-modal">${inner}<span class="fd-row__chevron" aria-hidden="true">${iconChevronRight()}</span></button></li>`,
    );
}

function usualSwitchRow(view: SettingsStoresV2View): Html {
    const sub = view.useUsualStore ? USUAL_STORE_SUB_ON : USUAL_STORE_SUB_OFF;
    const label = "Use each food's usual store";
    const text = `<span class="fd-stores-pref__icon" aria-hidden="true">${iconRepeat()}</span><span class="fd-stores-pref__main"><span class="fd-row__title">${esc(label)}</span><span class="fd-row__sub">${esc(sub)}</span></span>`;
    const state = view.useUsualStore ? "true" : "false";
    if (!view.canManage) {
        return raw(
            `<li class="fd-row fd-row--stores-pref"><div class="fd-row__body fd-stores-pref">${text}<span class="fd-stores-pref__value">${view.useUsualStore ? "On" : "Off"}</span></div></li>`,
        );
    }
    return raw(
        `<li class="fd-row fd-row--stores-pref"><form method="post" action="${STORES_PATH}/preferences" class="fd-row__body fd-stores-pref"><input type="hidden" name="use_usual_store" value="${view.useUsualStore ? "0" : "1"}" />${text}<button type="submit" class="fd-switch" role="switch" aria-checked="${state}" aria-label="${esc(label)}"><span class="fd-switch__knob" aria-hidden="true"></span></button></form></li>`,
    );
}

function addStoreSheet(view: SettingsStoresV2View): string {
    const formId = `${STORES_ADD_SHEET_ID}-form`;
    const body = `<form id="${formId}" method="post" action="${STORES_PATH}/add" class="fd-stores-form">${String(
        settingsField({
            id: "fd-stores-add-name",
            label: "Store name",
            control: `<input class="fd-settings-input" id="fd-stores-add-name" name="name" required maxlength="80" autocomplete="off" />`,
        }),
    )}</form>`;
    return sheet({
        id: STORES_ADD_SHEET_ID,
        kind: "edit",
        title: "Add a store",
        body,
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${STORES_ADD_SHEET_ID}">Cancel</button><button type="submit" class="fd-btn fd-btn--primary" form="${formId}">Add store</button>`,
        openOnLoad: view.openModalId === STORES_ADD_SHEET_ID,
    });
}

function reorderSheet(view: SettingsStoresV2View): string {
    const list = orderList({
        action: `${STORES_PATH}/order`,
        label: "Stores in order",
        alwaysShowMoves: true,
        turboFalse: true,
        items: view.stores.map((store) => ({
            id: store.id,
            label: store.name,
            main: raw(`<span class="fd-order-name">${esc(store.name)}</span>`),
        })),
    });
    return sheet({
        id: STORES_REORDER_SHEET_ID,
        kind: "edit",
        title: "Reorder stores",
        subtitle: "Drag a store by its handle, or use the arrows.",
        body: String(list),
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${STORES_REORDER_SHEET_ID}">Done</button>`,
        openOnLoad: view.openModalId === STORES_REORDER_SHEET_ID,
    });
}

function defaultStoreSheet(view: SettingsStoresV2View): string {
    const formId = `${STORES_DEFAULT_SHEET_ID}-form`;
    const option = (value: string, label: string, checked: boolean) =>
        `<label class="fd-stores-radio"><input type="radio" name="default_store_id" value="${esc(value)}"${checked ? " checked" : ""} /><span>${esc(label)}</span></label>`;
    const options = [
        option("", "No default store", view.defaultStoreId === null),
        ...view.stores.map((store) =>
            option(store.id, store.name, store.id === view.defaultStoreId),
        ),
    ].join("");
    const body = `<form id="${formId}" method="post" action="${STORES_PATH}/preferences" class="fd-stores-form"><p class="fd-stores-hint">${esc(DEFAULT_STORE_HINT)}</p><div class="fd-stores-radios" role="radiogroup" aria-label="Default store">${options}</div></form>`;
    return sheet({
        id: STORES_DEFAULT_SHEET_ID,
        kind: "edit",
        title: "Default store",
        body,
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${STORES_DEFAULT_SHEET_ID}">Cancel</button><button type="submit" class="fd-btn fd-btn--primary" form="${formId}">Save</button>`,
        openOnLoad: view.openModalId === STORES_DEFAULT_SHEET_ID,
    });
}

export function renderSettingsStoresV2Body(view: SettingsStoresV2View): string {
    const rows: Html[] = view.stores.map(storeRow);
    if (view.canManage) {
        rows.push(
            actionRow({
                variant: "store-add",
                target: STORES_ADD_SHEET_ID,
                label: "Add a store",
                icon: iconPlus(),
            }),
        );
    }
    const reorder =
        view.canManage && view.stores.length > 1
            ? `<p class="fd-stores-reorder">${sheetTrigger({
                  target: STORES_REORDER_SHEET_ID,
                  label: "Reorder stores",
                  className: "fd-stores-link",
              })}</p>`
            : "";
    const empty =
        view.stores.length === 0
            ? `<p class="fd-stores-empty">No grocery stores yet.</p>`
            : "";
    const preferences = join([
        sectionHeader({
            title: "When adding to the list",
            level: 2,
            className: "fd-stores-head",
        }),
        rowList([defaultStoreRow(view), usualSwitchRow(view)], {
            label: "When adding to the list",
            className: "fd-list--card",
        }),
        `<p class="fd-stores-hint">${esc(DEFAULT_STORE_HINT)} ${esc(view.useUsualStore ? USUAL_STORE_ORDER_ON : USUAL_STORE_ORDER_OFF)}</p>`,
    ]);
    const sheets = view.canManage
        ? `${addStoreSheet(view)}${view.stores.length > 1 ? reorderSheet(view) : ""}${defaultStoreSheet(view)}`
        : "";
    return `<div class="fd-stores" data-fd-stores="list"><p class="fd-stores-intro">${esc(STORES_INTRO)}</p>${String(settingsErrorBanner(view.error))}${empty}${rowList(rows, { label: "Grocery stores", className: "fd-list--card fd-list--stores" })}${reorder}${String(preferences)}${sheets}</div>`;
}

export function renderSettingsStoresV2Page(view: SettingsStoresV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: "Stores",
        backHref: "/settings/household",
        body: renderSettingsStoresV2Body(view),
    });
}

export const SETTINGS_STORES_V2_MARKER = 'data-fd-stores="list"';
