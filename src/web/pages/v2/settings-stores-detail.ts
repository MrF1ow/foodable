/**
 * Settings › Household › a store (FigCraft 413782, 421271): the store's name,
 * its sections in walking order, and its rules. The Detail bar's ⋯ has Rename
 * (the name field becomes editable) and Delete (confirms in place; a store
 * with lines on the list opens a sheet, a real choice: move them or delete
 * them). A section row's ⋯ has Rename, Move up, Move down and Hide. "Add a
 * section" and "Add a rule" are inline rows.
 *
 * Owners and admins edit; everyone else reads. Every write posts and comes
 * back here with a 303 and no toast.
 */
import type { AppChromeBase } from "../../attention.js";
import type { StoreRule } from "../../../domain/rules.js";
import type { GrocerySection, GroceryStore } from "../../../domain/settings.js";
import { addRow } from "../../components/v2/add-row.js";
import { button } from "../../components/v2/button.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { plural, STORES_PATH } from "./settings-stores.js";

export const STORE_ADD_SECTION_ID = "fd-store-add-section";
export const STORE_ADD_RULE_ID = "fd-store-add-rule";
export const STORE_DELETE_SHEET_ID = "fd-store-delete";

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
    /** The name field is open for editing (Rename). */
    rename?: boolean;
    /** The section whose row is open for renaming. */
    renameSectionId?: string;
    error?: string;
    /** The add row or the sheet to render open (it comes back with its error). */
    open?: string;
};

export function storePath(store: Pick<GroceryStore, "id">): string {
    return `${STORES_PATH}/${encodeURIComponent(store.id)}`;
}

/** A section row's id: stores.js finds the row again after a move by it, and the morph matches rows by it. */
export function sectionDomId(section: Pick<GrocerySection, "id">): string {
    return `fd-section-${section.id}`;
}

function sectionPath(view: SettingsStoreV2View, section: GrocerySection) {
    return `${storePath(view.store)}/sections/${encodeURIComponent(section.id)}`;
}

/** The Detail bar's ⋯: Rename, and Delete in whichever form the store needs. */
function storeMenu(view: SettingsStoreV2View): Html | undefined {
    if (!view.canManage) return undefined;
    const base = storePath(view.store);
    const del: MenuItem =
        view.lineCount === 0
            ? {
                  kind: "destructive",
                  label: "Delete",
                  confirmLabel: "Delete store",
                  action: `${base}/delete`,
                  fields: { lines: "0" },
              }
            : {
                  kind: "opens",
                  label: "Delete",
                  sheetId: STORE_DELETE_SHEET_ID,
                  danger: true,
              };
    return menu({
        label: `Actions for ${view.store.name}`,
        anchor: "more",
        items: [
            { kind: "link", label: "Rename", href: `${base}?rename=1` },
            del,
        ],
    });
}

function nameBlock(view: SettingsStoreV2View): Html {
    const editing = view.canManage && view.rename === true;
    const box = field({
        id: "fd-store-name",
        label: "Name",
        name: "name",
        value: view.store.name,
        maxlength: 80,
        required: true,
        autocomplete: "off",
        disabled: !editing,
        autofocus: editing,
        inputData: editing
            ? { "fd-autosave-input": "", "fd-autofocus": "" }
            : undefined,
    });
    if (!editing) return box;
    return raw(
        `<form method="post" action="${storePath(view.store)}/rename" data-fd-autosave>${box}</form>`,
    );
}

function sectionMenu(
    view: SettingsStoreV2View,
    section: GrocerySection,
    movable: readonly GrocerySection[],
): Html {
    const base = sectionPath(view, section);
    const index = movable.findIndex((row) => row.id === section.id);
    const items: MenuItem[] = [
        {
            kind: "link",
            label: "Rename",
            href: `${storePath(view.store)}?rename_section=${encodeURIComponent(section.id)}`,
        },
    ];
    const order = `${storePath(view.store)}/sections/order`;
    if (index > 0) {
        items.push({
            kind: "post",
            label: "Move up",
            action: order,
            fields: { move: `${section.id}:up` },
        });
    }
    if (index >= 0 && index < movable.length - 1) {
        items.push({
            kind: "post",
            label: "Move down",
            action: order,
            fields: { move: `${section.id}:down` },
        });
    }
    if (!section.isOther) {
        items.push({
            kind: "post",
            label: "Hide",
            action: `${base}/visibility`,
            fields: { hidden: "1" },
        });
    }
    return menu({
        label: `Actions for ${section.name}`,
        anchor: "more",
        items,
    });
}

function sectionRow(
    view: SettingsStoreV2View,
    section: GrocerySection,
    movable: readonly GrocerySection[],
): Html {
    if (view.canManage && view.renameSectionId === section.id) {
        return itemRow({
            id: sectionDomId(section),
            title: section.name,
            edit: {
                action: `${sectionPath(view, section)}/rename`,
                name: "name",
                value: section.name,
                label: "Section name",
                maxlength: 80,
                cancelHref: storePath(view.store),
                error: view.error,
            },
        });
    }
    const count = view.sectionLineCounts.get(section.id);
    return itemRow({
        id: sectionDomId(section),
        title: section.name,
        value: count ? String(count) : undefined,
        trailing: view.canManage
            ? { kind: "control", html: sectionMenu(view, section, movable) }
            : undefined,
    });
}

function sectionsBlock(view: SettingsStoreV2View): Html {
    const visible = view.sections.filter((row) => !row.hidden);
    // Walking order, the fallback section last; the moves apply to the others.
    const movable = visible.filter((row) => !row.isOther);
    const rows: Html[] = visible.map((row) => sectionRow(view, row, movable));
    if (view.canManage) {
        rows.push(
            addRow({
                id: STORE_ADD_SECTION_ID,
                label: "Add a section",
                action: `${storePath(view.store)}/sections`,
                name: "name",
                fieldLabel: "Section name",
                maxlength: 80,
                open: view.open === STORE_ADD_SECTION_ID,
                error:
                    view.open === STORE_ADD_SECTION_ID ? view.error : undefined,
            }),
        );
    }
    return join([
        sectionHeader({
            label: "Sections · walking order",
            count: visible.length,
            rule: false,
        }),
        rows.length > 0
            ? listGroup({ rows, label: "Sections in walking order" })
            : raw(""),
    ]);
}

function hiddenBlock(view: SettingsStoreV2View): Html {
    const hidden = view.sections.filter((row) => row.hidden);
    if (hidden.length === 0) return raw("");
    const rows = hidden.map((section) =>
        itemRow({
            id: sectionDomId(section),
            title: section.name,
            trailing: view.canManage
                ? {
                      kind: "control",
                      html: menu({
                          label: `Actions for ${section.name}`,
                          anchor: "more",
                          items: [
                              {
                                  kind: "post",
                                  label: "Show",
                                  action: `${sectionPath(view, section)}/visibility`,
                                  fields: { hidden: "0" },
                              },
                          ],
                      }),
                  }
                : undefined,
        }),
    );
    return join([
        sectionHeader({
            label: "Hidden sections",
            count: hidden.length,
            rule: false,
        }),
        listGroup({ rows, label: "Hidden sections" }),
    ]);
}

function rulesBlock(view: SettingsStoreV2View): Html {
    const rows: Html[] = view.rules.map((rule) =>
        itemRow({ title: rule.body, className: "fd-store-rule" }),
    );
    if (view.canManage) {
        rows.push(
            addRow({
                id: STORE_ADD_RULE_ID,
                label: "Add a rule",
                action: `${storePath(view.store)}/rules/add`,
                name: "body",
                fieldLabel: "Rule",
                maxlength: 500,
                open: view.open === STORE_ADD_RULE_ID,
                error: view.open === STORE_ADD_RULE_ID ? view.error : undefined,
            }),
        );
    }
    return join([
        sectionHeader({
            label: "Store rules",
            count: view.rules.length,
            rule: false,
        }),
        rows.length > 0 ? listGroup({ rows, label: "Store rules" }) : raw(""),
    ]);
}

/**
 * The delete dialog for a store with lines on the list: move them to
 * `moveTarget`, or delete them with the store. Both post to the same route;
 * `mode` says which button was pressed.
 */
function deleteSheet(view: SettingsStoreV2View): string {
    const formId = `${STORE_DELETE_SHEET_ID}-form`;
    const lines = view.lineCount;
    const noun = plural(lines, "line", "lines");
    const them = lines === 1 ? "it" : "them";
    const deleteAll = button({
        label: `Delete the store and its ${noun}`,
        variant: "danger",
        type: "submit",
        attrs: { form: formId, name: "mode", value: "delete" },
    });
    const hidden = `<input type="hidden" name="lines" value="${lines}">${
        view.moveTarget
            ? `<input type="hidden" name="move_to" value="${esc(view.moveTarget.id)}">`
            : ""
    }`;
    const message = view.moveTarget
        ? `${noun} on the grocery list ${lines === 1 ? "is" : "are"} in this store. Move ${them} to ${view.moveTarget.name}, or delete ${them} with the store.`
        : `${noun} on the grocery list ${lines === 1 ? "is" : "are"} in this store, and there is no other store to move ${them} to.`;
    return String(
        sheet({
            id: STORE_DELETE_SHEET_ID,
            placement: "dialog",
            header: { kind: "title", title: `Delete ${view.store.name}?` },
            body: sheetSection({
                kind: "custom",
                content: raw(
                    `<form id="${formId}" method="post" action="${storePath(view.store)}/delete">${hidden}<p class="fd-sheet__text">${esc(message)}</p></form>${view.moveTarget ? `<div class="fd-store-delete">${String(deleteAll)}</div>` : ""}`,
                ),
            }),
            actions: view.moveTarget
                ? {
                      kind: "pair",
                      primary: {
                          label: `Move ${noun}`,
                          type: "submit",
                          form: formId,
                          attrs: { name: "mode", value: "move" },
                      },
                  }
                : {
                      kind: "destructive",
                      danger: {
                          label: `Delete the store and its ${noun}`,
                          type: "submit",
                          form: formId,
                          attrs: { name: "mode", value: "delete" },
                      },
                  },
            openOnLoad: view.open === STORE_DELETE_SHEET_ID,
        }),
    );
}

/** What the banner says: a refusal an add row or a rename row already shows under its field is not said twice. */
function bannerError(view: SettingsStoreV2View): string | undefined {
    const inRow =
        view.open === STORE_ADD_SECTION_ID ||
        view.open === STORE_ADD_RULE_ID ||
        (view.canManage &&
            view.sections.some(
                (row) => row.id === view.renameSectionId && !row.hidden,
            ));
    return inRow ? undefined : view.error;
}

export function renderSettingsStoreV2Body(view: SettingsStoreV2View): string {
    const sheets =
        view.canManage && view.lineCount > 0 ? deleteSheet(view) : "";
    return `${String(
        join([
            settingsErrorBanner(bannerError(view)),
            nameBlock(view),
            sectionsBlock(view),
            hiddenBlock(view),
            rulesBlock(view),
        ]),
    )}${sheets}`;
}

export function renderSettingsStoreV2Page(view: SettingsStoreV2View): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: view.store.name,
        backHref: STORES_PATH,
        className: "fd-stores-page fd-store-page",
        actions: storeMenu(view),
        body: renderSettingsStoreV2Body(view),
    });
}
