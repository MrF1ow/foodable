/**
 * Settings › Household › Stores (FigCraft 413237, 420979): the household's
 * grocery stores in shopping order, one row each (sections, lines on the list)
 * that opens the store, "Add a store" as an inline row, and the two things
 * that decide where a new line goes: the default store (a pull-down on the
 * row) and whether each food goes to its usual store. The Detail bar's ⋯ has
 * Reorder, which turns the page into an inline edit mode: a handle on every
 * row, dragged (or moved with the arrows), and a check that ends it.
 *
 * Owners and admins edit; everyone else reads. Every write posts and comes
 * back here with a 303 and no toast.
 */
import type { AppChromeBase } from "../../attention.js";
import { addRow } from "../../components/v2/add-row.js";
import { button } from "../../components/v2/button.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const STORES_PATH = "/settings/household/stores";
/** The list in reorder mode. */
export const STORES_REORDER_PATH = `${STORES_PATH}?reorder=1`;

export const STORES_ADD_ID = "fd-stores-add";

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
    /** Reorder mode: only for someone who can manage, with two stores or more. */
    reorder?: boolean;
    error?: string;
    /** The add row to render open (it comes back with its form's error). */
    open?: string;
};

export function plural(count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** "6 sections · 5 on the list"; a store with no sections leaves that part out. */
function storeSubtitle(store: StoreSummary): string {
    const lines = `${store.lineCount} on the list`;
    return store.sectionCount === 0
        ? lines
        : `${plural(store.sectionCount, "section", "sections")} · ${lines}`;
}

function sectionsLabel(store: StoreSummary): string {
    return store.sectionCount === 0
        ? "No sections"
        : plural(store.sectionCount, "section", "sections");
}

/** Whether the page is in reorder mode: there must be something to order. */
export function storesReorderable(view: {
    canManage: boolean;
    stores: readonly unknown[];
}): boolean {
    return view.canManage && view.stores.length > 1;
}

function storeRow(store: StoreSummary): Html {
    return itemRow({
        title: store.name,
        subtitle: storeSubtitle(store),
        href: `${STORES_PATH}/${encodeURIComponent(store.id)}`,
        trailing: { kind: "chevron" },
    });
}

function reorderList(view: SettingsStoresV2View): Html {
    const last = view.stores.length - 1;
    const rows = view.stores.map((store, index) =>
        itemRow({
            title: store.name,
            subtitle: sectionsLabel(store),
            reorder: {
                name: "order",
                value: store.id,
                label: store.name,
                canUp: index > 0,
                canDown: index < last,
            },
        }),
    );
    return raw(
        `<form class="fd-stores-order" method="post" action="${STORES_PATH}/order" data-fd-order-form>${listGroup(
            {
                rows,
                label: "Stores in order",
                data: { "fd-order-list": "" },
            },
        )}</form>`,
    );
}

function defaultStoreName(view: SettingsStoresV2View): string {
    return (
        view.stores.find((row) => row.id === view.defaultStoreId)?.name ??
        "None"
    );
}

/** Default store: a pull-down on the row; each choice posts and comes back here. */
function defaultStoreRow(view: SettingsStoresV2View): Html {
    const title = "Default store";
    if (!view.canManage) {
        return itemRow({ title, value: defaultStoreName(view) });
    }
    const choose = (value: string, label: string, checked: boolean) => ({
        kind: "checked" as const,
        label,
        checked,
        action: `${STORES_PATH}/preferences`,
        fields: { default_store_id: value },
    });
    return raw(
        `<li class="fd-item-row">${menu({
            label: title,
            anchor: "row",
            row: { title, value: defaultStoreName(view) },
            items: [
                choose("", "None", view.defaultStoreId === null),
                ...view.stores.map((store) =>
                    choose(
                        store.id,
                        store.name,
                        store.id === view.defaultStoreId,
                    ),
                ),
            ],
        })}</li>`,
    );
}

function usualStoreRow(view: SettingsStoresV2View): Html {
    const title = "Use each food's usual store";
    if (!view.canManage) {
        return itemRow({ title, value: view.useUsualStore ? "On" : "Off" });
    }
    return itemRow({
        title,
        trailing: {
            kind: "toggle",
            on: view.useUsualStore,
            label: title,
            form: {
                action: `${STORES_PATH}/preferences`,
                fields: { use_usual_store: view.useUsualStore ? "0" : "1" },
            },
        },
    });
}

function storesBody(view: SettingsStoresV2View): Html {
    const rows: Html[] = view.stores.map(storeRow);
    if (view.canManage) {
        rows.push(
            addRow({
                id: STORES_ADD_ID,
                label: "Add a store",
                action: `${STORES_PATH}/add`,
                name: "name",
                fieldLabel: "Store name",
                maxlength: 80,
                open: view.open === STORES_ADD_ID,
                error: view.open === STORES_ADD_ID ? view.error : undefined,
            }),
        );
    }
    return join([
        // An add row that comes back open shows the refusal under its field.
        settingsErrorBanner(
            view.open === STORES_ADD_ID ? undefined : view.error,
        ),
        rows.length > 0
            ? listGroup({ rows, label: "Grocery stores" })
            : emptyState({ title: "No stores yet" }),
        sectionHeader({ label: "When adding to the list", rule: false }),
        listGroup({
            rows: [defaultStoreRow(view), usualStoreRow(view)],
            label: "When adding to the list",
        }),
    ]);
}

export function renderSettingsStoresV2Body(view: SettingsStoresV2View): string {
    return String(
        view.reorder && storesReorderable(view)
            ? join([settingsErrorBanner(view.error), reorderList(view)])
            : storesBody(view),
    );
}

export function renderSettingsStoresV2Page(view: SettingsStoresV2View): string {
    const reordering = view.reorder === true && storesReorderable(view);
    const actions = reordering
        ? button({
              label: "Done",
              icon: "check",
              round: true,
              href: STORES_PATH,
          })
        : storesReorderable(view)
          ? menu({
                label: "Stores actions",
                anchor: "more",
                items: [
                    {
                        kind: "link",
                        label: "Reorder",
                        href: STORES_REORDER_PATH,
                    },
                ],
            })
          : undefined;
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: "Stores",
        className: "fd-stores-page",
        actions,
        body: renderSettingsStoresV2Body(view),
    });
}
