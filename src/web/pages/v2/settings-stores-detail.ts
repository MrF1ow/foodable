import type { AppChromeBase } from "../../attention.js";
import type { StoreRule } from "../../../domain/rules.js";
import type { GrocerySection, GroceryStore } from "../../../domain/settings.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconPlus } from "../../components/v2/icons.js";
import { rowList, sectionHeader } from "../../components/v2/rows.js";
import { sheet } from "../../components/v2/sheet.js";
import {
    actionRow,
    orderList,
    plural,
    STORES_PATH,
} from "./settings-stores.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
} from "./settings-shared.js";

export const STORE_ADD_SECTION_SHEET_ID = "fd-store-add-section";
export const STORE_ADD_RULE_SHEET_ID = "fd-store-add-rule";
export const STORE_DELETE_SHEET_ID = "fd-store-delete";

export function storeSectionSheetId(sectionId: string): string {
    return `fd-store-section-${sectionId}`;
}

export type SettingsStoreV2View = {
    chrome: AppChromeBase;
    store: GroceryStore;
    /** Every section of the store, in walking order, hidden ones included. */
    sections: GrocerySection[];
    /** Lines on the grocery list per section id. */
    sectionLineCounts: ReadonlyMap<string, number>;
    /** Lines on the grocery list in this store. */
    lineCount: number;
    rules: StoreRule[];
    /** Where "Move N lines" sends them; null when this is the only store. */
    moveTarget: GroceryStore | null;
    canManage: boolean;
    error?: string;
    openModalId?: string;
};

function storePath(view: SettingsStoreV2View): string {
    return `${STORES_PATH}/${encodeURIComponent(view.store.id)}`;
}

function countLabel(count: number | undefined): string {
    return count ? `${count} on the list` : "";
}

function nameBlock(view: SettingsStoreV2View): string {
    if (!view.canManage) {
        return `<p class="fd-stores-name-static">${esc(view.store.name)}</p>`;
    }
    const field = settingsField({
        id: "fd-store-name",
        label: "Name",
        control: `<input class="fd-settings-input" id="fd-store-name" name="name" value="${esc(view.store.name)}" required maxlength="80" autocomplete="off" data-fd-autosubmit />`,
    });
    return `<form method="post" action="${storePath(view)}/rename" class="fd-stores-name">${String(field)}<button type="submit" class="fd-sr-submit">Save name</button></form>`;
}

function sectionMain(view: SettingsStoreV2View, section: GrocerySection): Html {
    const count = countLabel(view.sectionLineCounts.get(section.id));
    const countHtml = count
        ? `<span class="fd-order-count">${esc(count)}</span>`
        : "";
    const name = view.canManage
        ? `<button type="button" class="fd-order-name fd-order-name--button" commandfor="${esc(storeSectionSheetId(section.id))}" command="show-modal">${esc(section.name)}</button>`
        : `<span class="fd-order-name">${esc(section.name)}</span>`;
    return raw(`${name}${countHtml}`);
}

/** The Other section is the last stop: no handle, no order field. */
function otherRow(view: SettingsStoreV2View, section: GrocerySection): Html {
    return raw(
        `<li class="fd-order-item fd-order-item--fixed"><span class="fd-order-handle fd-order-handle--none" aria-hidden="true"></span>${String(sectionMain(view, section))}</li>`,
    );
}

function sectionsBlock(view: SettingsStoreV2View): string {
    const visible = view.sections.filter((row) => !row.hidden);
    const movable = visible.filter((row) => !row.isOther);
    const other = visible.find((row) => row.isOther);
    const list = view.canManage
        ? orderList({
              action: `${storePath(view)}/sections/order`,
              label: "Sections in walking order",
              items: movable.map((row) => ({
                  id: row.id,
                  label: row.name,
                  main: sectionMain(view, row),
              })),
          })
        : raw(
              `<ul class="fd-order-list" aria-label="Sections in walking order">${movable
                  .map(
                      (row) =>
                          `<li class="fd-order-item fd-order-item--fixed"><span class="fd-order-handle fd-order-handle--none" aria-hidden="true"></span>${String(sectionMain(view, row))}</li>`,
                  )
                  .join("")}</ul>`,
          );
    const otherList = other
        ? `<ul class="fd-order-list fd-order-list--other" aria-label="Fallback section">${String(otherRow(view, other))}</ul>`
        : "";
    const empty =
        visible.length === 0
            ? `<p class="fd-stores-empty">No sections yet.</p>`
            : "";
    const add = view.canManage
        ? `<ul class="fd-list fd-list--plain">${String(
              actionRow({
                  variant: "section-add",
                  target: STORE_ADD_SECTION_SHEET_ID,
                  label: "Add a section",
                  icon: iconPlus(),
              }),
          )}</ul>`
        : "";
    return `${String(sectionHeader({ title: "Sections · walking order", count: visible.length, level: 2, className: "fd-stores-head" }))}${empty}${String(list)}${otherList}${add}`;
}

function hiddenBlock(view: SettingsStoreV2View): string {
    const hidden = view.sections.filter((row) => row.hidden);
    if (hidden.length === 0) return "";
    const rows = hidden.map((row) => {
        const action = view.canManage
            ? `<form method="post" action="${storePath(view)}/sections/${encodeURIComponent(row.id)}/visibility" class="fd-stores-inline"><input type="hidden" name="hidden" value="0" /><button type="submit" class="fd-stores-link">Show</button></form>`
            : "";
        return raw(
            `<li class="fd-row fd-row--hidden-section"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__title">${esc(row.name)}</span></div>${action}</div></li>`,
        );
    });
    return `${String(sectionHeader({ title: "Hidden sections", count: hidden.length, level: 2, className: "fd-stores-head" }))}<p class="fd-stores-hint">Hidden sections stay out of the walking order. Items already in one stay on the list.</p>${String(rowList(rows, { label: "Hidden sections" }))}`;
}

function rulesBlock(view: SettingsStoreV2View): string {
    const rows: Html[] = view.rules.map((rule) =>
        raw(
            `<li class="fd-row fd-row--store-rule"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-stores-rule">${esc(rule.body)}</span></div></div></li>`,
        ),
    );
    if (view.canManage) {
        rows.push(
            actionRow({
                variant: "rule-add",
                target: STORE_ADD_RULE_SHEET_ID,
                label: "Add a rule",
                icon: iconPlus(),
            }),
        );
    }
    const body =
        rows.length === 0
            ? `<p class="fd-stores-empty">No rules for this store.</p>`
            : String(rowList(rows, { label: "Store rules" }));
    return `${String(sectionHeader({ title: "Store rules", count: view.rules.length, level: 2, className: "fd-stores-head" }))}${body}`;
}

function sectionSheets(view: SettingsStoreV2View): string {
    return view.sections
        .map((section) => {
            const id = storeSectionSheetId(section.id);
            const renameId = `${id}-rename`;
            const hideId = `${id}-hide`;
            const base = `${storePath(view)}/sections/${encodeURIComponent(section.id)}`;
            const field = settingsField({
                id: `${id}-name`,
                label: "Section name",
                control: `<input class="fd-settings-input" id="${esc(id)}-name" name="name" value="${esc(section.name)}" required maxlength="80" autocomplete="off" />`,
            });
            const hide = section.isOther
                ? ""
                : `<form id="${esc(hideId)}" method="post" action="${base}/visibility"><input type="hidden" name="hidden" value="1" /></form>`;
            const body = `<form id="${esc(renameId)}" method="post" action="${base}/rename" class="fd-stores-form">${String(field)}</form>${hide}${section.isOther ? `<p class="fd-stores-hint">Anything without a better section lands in Other, so it stays at the end of the walk.</p>` : ""}`;
            const actions = `${section.isOther ? "" : `<button type="submit" class="fd-btn" form="${esc(hideId)}">Hide section</button>`}<button type="submit" class="fd-btn fd-btn--primary" form="${esc(renameId)}">Save</button>`;
            return sheet({
                id,
                kind: "edit",
                title: section.name,
                body,
                actions,
                openOnLoad: view.openModalId === id,
            });
        })
        .join("");
}

function addSectionSheet(view: SettingsStoreV2View): string {
    const formId = `${STORE_ADD_SECTION_SHEET_ID}-form`;
    const body = `<form id="${formId}" method="post" action="${storePath(view)}/sections" class="fd-stores-form">${String(
        settingsField({
            id: "fd-store-add-section-name",
            label: "Section name",
            control: `<input class="fd-settings-input" id="fd-store-add-section-name" name="name" required maxlength="80" autocomplete="off" />`,
        }),
    )}</form>`;
    return sheet({
        id: STORE_ADD_SECTION_SHEET_ID,
        kind: "edit",
        title: "Add a section",
        subtitle: "It goes just before Other in the walking order.",
        body,
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${STORE_ADD_SECTION_SHEET_ID}">Cancel</button><button type="submit" class="fd-btn fd-btn--primary" form="${formId}">Add section</button>`,
        openOnLoad: view.openModalId === STORE_ADD_SECTION_SHEET_ID,
    });
}

function addRuleSheet(view: SettingsStoreV2View): string {
    const formId = `${STORE_ADD_RULE_SHEET_ID}-form`;
    const body = `<form id="${formId}" method="post" action="${storePath(view)}/rules/add" class="fd-stores-form">${String(
        settingsField({
            id: "fd-store-add-rule-body",
            label: "Rule",
            control: `<textarea class="fd-settings-input" id="fd-store-add-rule-body" name="body" rows="3" required maxlength="500"></textarea>`,
        }),
    )}</form>`;
    return sheet({
        id: STORE_ADD_RULE_SHEET_ID,
        kind: "edit",
        title: "Add a store rule",
        subtitle: "Something Foodable should know when it shops here.",
        body,
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${STORE_ADD_RULE_SHEET_ID}">Cancel</button><button type="submit" class="fd-btn fd-btn--primary" form="${formId}">Add rule</button>`,
        openOnLoad: view.openModalId === STORE_ADD_RULE_SHEET_ID,
    });
}

/**
 * The delete dialog. A store with lines asks what to do with them: move them
 * to `moveTarget`, or delete them with the store. A store with none is a plain
 * confirm. Both post to the same route; `mode` says which button was pressed.
 */
function deleteSheet(view: SettingsStoreV2View): string {
    const formId = `${STORE_DELETE_SHEET_ID}-form`;
    const name = view.store.name;
    const lines = view.lineCount;
    const action = `${storePath(view)}/delete`;
    const cancel = `<button type="button" class="fd-btn" command="close" commandfor="${STORE_DELETE_SHEET_ID}">Cancel</button>`;
    if (lines === 0) {
        return sheet({
            id: STORE_DELETE_SHEET_ID,
            kind: "confirm",
            title: `Delete ${name}?`,
            body: `<form id="${formId}" method="post" action="${action}"><input type="hidden" name="lines" value="0" /><p class="fd-sheet-message">Its sections and rules go with it. Nothing on the grocery list is in this store.</p></form>`,
            actions: `${cancel}<button type="submit" class="fd-btn fd-btn--danger" form="${formId}">Delete store</button>`,
            openOnLoad: view.openModalId === STORE_DELETE_SHEET_ID,
        });
    }
    const move = view.moveTarget
        ? `<button type="submit" class="fd-btn fd-btn--primary" form="${formId}" name="mode" value="move">Move ${esc(plural(lines, "line", "lines"))} to ${esc(view.moveTarget.name)}</button>`
        : "";
    const hidden = `<input type="hidden" name="lines" value="${lines}" />${
        view.moveTarget
            ? `<input type="hidden" name="move_to" value="${esc(view.moveTarget.id)}" />`
            : ""
    }`;
    const message = view.moveTarget
        ? `${plural(lines, "line", "lines")} on the grocery list ${lines === 1 ? "is" : "are"} in this store. Move ${lines === 1 ? "it" : "them"} to ${view.moveTarget.name}, or delete ${lines === 1 ? "it" : "them"} with the store.`
        : `${plural(lines, "line", "lines")} on the grocery list ${lines === 1 ? "is" : "are"} in this store, and there is no other store to move ${lines === 1 ? "it" : "them"} to.`;
    return sheet({
        id: STORE_DELETE_SHEET_ID,
        kind: "confirm",
        title: `Delete ${name}?`,
        body: `<form id="${formId}" method="post" action="${action}">${hidden}<p class="fd-sheet-message">${esc(message)}</p></form>`,
        actions: `${cancel}${move}<button type="submit" class="fd-btn fd-btn--danger" form="${formId}" name="mode" value="delete">Delete the store and its ${esc(plural(lines, "line", "lines"))}</button>`,
        openOnLoad: view.openModalId === STORE_DELETE_SHEET_ID,
    });
}

export function renderSettingsStoreV2Body(view: SettingsStoreV2View): string {
    const back = `<a class="fd-stores-back" href="${STORES_PATH}" data-turbo="false"><svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>Stores</a>`;
    const del = view.canManage
        ? `<button type="button" class="fd-stores-delete" commandfor="${STORE_DELETE_SHEET_ID}" command="show-modal">Delete store</button>`
        : "";
    const sheets = view.canManage
        ? `${sectionSheets(view)}${addSectionSheet(view)}${addRuleSheet(view)}${deleteSheet(view)}`
        : "";
    return `<div class="fd-stores" data-fd-stores="store" data-store-id="${esc(view.store.id)}">${back}${String(settingsErrorBanner(view.error))}${nameBlock(view)}${sectionsBlock(view)}${hiddenBlock(view)}${rulesBlock(view)}${del}${sheets}</div>`;
}

export function renderSettingsStoreV2Page(view: SettingsStoreV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: view.store.name,
        backHref: STORES_PATH,
        backLabel: "Stores",
        body: renderSettingsStoreV2Body(view),
    });
}

export const SETTINGS_STORE_V2_MARKER = 'data-fd-stores="store"';
