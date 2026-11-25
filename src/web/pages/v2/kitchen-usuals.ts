import type { GroceryLine } from "../../../domain/grocery.js";
import { onGroceryList } from "../../../domain/grocery.js";
import {
    RESTOCK_MAX_EVERY_WEEKS,
    usualLowLevel,
    type Food,
    type RestockSchedule,
    type UsualProductRow,
} from "../../../domain/foods.js";
import { FOOD_QUANTITY_UNITS } from "../../../domain/quantity.js";
import { WEEKDAY_NAMES } from "../../../domain/weekdays.js";
import type { GroceryStore } from "../../../domain/settings.js";
import type { AppChromeBase } from "../../attention.js";
import {
    formatQuantityDisplayParts,
    quantityUnitOptionLabel,
} from "../../display-quantity.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, menuRow, type MenuItem } from "../../components/v2/menu.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { searchField } from "../../components/v2/search-field.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepperControl } from "../../components/v2/stepper-control.js";
import { toggle } from "../../components/v2/toggle.js";
import { renderAppShell } from "../../shell.js";
import {
    addUsualButton,
    addUsualSheet,
    knownUsualAmounts,
    USUAL_ADD_SHEET_ID,
    type UsualAddView,
} from "./kitchen-usuals-add.js";
import { kitchenTopTools, renderKitchenHead } from "./kitchen-head.js";
import { selectionBars } from "./select-mode.js";
import { settingsErrorBanner } from "./settings-shared.js";

export { USUAL_ADD_SHEET_ID };

export const USUALS_V2_RETURN_TO = "/kitchen/usuals";

export const USUAL_SCHEDULE_PATH_SUFFIX = "schedule";
/** The edit sheet's "Add when it runs low" switch, and the marker that says the sheet posted it (an unchecked box posts nothing). */
export const USUAL_WHEN_LOW_FIELD = "restock_when_low";
export const USUAL_WHEN_LOW_MARKER = "restock_when_low_present";

/**
 * The edit sheet's weight fields, and the marker that says the sheet posted
 * them: a post without it (an older form) leaves both factors alone, while a
 * blank field on the sheet clears that factor.
 */
export const USUAL_GRAMS_PER_ML_FIELD = "grams_per_ml";
export const USUAL_GRAMS_PER_EACH_FIELD = "grams_per_each";
export const USUAL_WEIGHTS_MARKER = "weights_present";

function formatFactor(value: number | null | undefined): string {
    return value != null && value > 0 ? String(value) : "";
}

/** The route a usual's restock settings post to. */
export function usualSchedulePath(foodId: string): string {
    return `${USUALS_V2_RETURN_TO}/${foodId}/${USUAL_SCHEDULE_PATH_SUFFIX}`;
}

/** The household restock day as "Sundays" (the header's "restock on …"). */
export function restockWeekdayLabel(weekday: number): string | null {
    const name = WEEKDAY_NAMES[weekday];
    return name ? `${name}s` : null;
}

export function usualSheetId(foodId: string): string {
    return `fd-usual-${foodId}`;
}

function productPickerSheetId(foodId: string): string {
    return `${usualSheetId(foodId)}-product`;
}

export function usualRestockSheetId(foodId: string): string {
    return `${usualSheetId(foodId)}-restock`;
}

/** What a usual's row and sheet show of its restock settings. */
export type UsualRestockView = {
    schedule: RestockSchedule | null;
    everyWeeks: number | null;
    paused: boolean;
    whenLow: boolean;
    /** The stored low level; null means the default (a quarter of the usual). */
    lowLevel: number | null;
    /** The stored level, else a quarter of the usual amount; null when neither. */
    effectiveLowLevel: number | null;
    /** The unit the usual amount (and so the low level) is measured in. */
    unit: string | null;
};

export function usualRestockView(row: UsualProductRow): UsualRestockView {
    const food = row.food;
    const amount = resolvePurchase(row).amount;
    return {
        schedule: food.restockSchedule,
        everyWeeks: food.restockEveryWeeks,
        paused: food.restockPaused,
        whenLow: food.restockWhenLow,
        lowLevel: food.restockLowLevel,
        effectiveLowLevel: usualLowLevel({
            restockLowLevel: food.restockLowLevel,
            usualAmount: amount,
        }),
        unit: amount?.unit ?? null,
    };
}

/** "Every week", "Every 2 weeks", "Every month", or null with no schedule. */
export function usualScheduleLabel(
    view: Pick<UsualRestockView, "schedule" | "everyWeeks">,
): string | null {
    if (view.schedule === "weekly") return "Every week";
    if (view.schedule === "monthly") return "Every month";
    if (view.schedule === "every_n_weeks") {
        const n = view.everyWeeks;
        if (n == null || n === 1) return "Every week";
        return `Every ${n} weeks`;
    }
    return null;
}

const LOW_FRACTIONS: ReadonlyArray<[number, string]> = [
    [0.25, "¼"],
    [0.5, "½"],
    [0.75, "¾"],
];

/** A low level as a reader says it: 6, 1½, ¼, 2.5. */
export function formatLowLevel(level: number): string {
    const whole = Math.floor(level);
    const frac = level - whole;
    const fraction = LOW_FRACTIONS.find(
        ([value]) => Math.abs(value - frac) < 1e-9,
    );
    if (fraction) return whole > 0 ? `${whole}${fraction[1]}` : fraction[1];
    return String(Math.round(level * 100) / 100);
}

/** The row's restock part: the schedule, "When low" with none, or "Paused". The level lives in the Restock sheet. */
export function usualRestockParts(view: UsualRestockView): string[] {
    const label = usualScheduleLabel(view);
    if (label == null && !view.whenLow) return [];
    if (view.paused) return ["Paused"];
    return [label ?? "When low"];
}

export type KitchenUsualsRowMeta = {
    productLabel: string;
    storeId: string | null;
    storeName: string | null;
    amountLabel: string | null;
    onList: boolean;
    /** An open running-low notice says its stock is below the level now. */
    lowNow?: boolean;
    /** The usual's restock settings; a row built without one shows none. */
    restock?: UsualRestockView;
};

export type KitchenUsualsV2View = {
    chrome: AppChromeBase;
    rows: UsualProductRow[];
    stores: GroceryStore[];
    rowMeta: ReadonlyMap<string, KitchenUsualsRowMeta>;
    addable: Food[];
    /** The stores the list is filtered to; none is every store. */
    selectedStoreIds?: readonly string[];
    error?: string;
    openFoodId?: string;
    /** A restock-form error reopens the Restock sheet, not just the usual's. */
    openRestock?: boolean;
    /** "Sundays": the household's restock day, when restocking is on. */
    restockDay?: string | null;
    /** The Add a usual sheet's state; absent leaves it closed. */
    add?: UsualAddView;
    openGroceriesCount?: number;
};

function sortStoresByName<T extends { name: string }>(stores: T[]): T[] {
    return [...stores].sort((a, b) => a.name.localeCompare(b.name));
}

function productDisplayName(product: Food): string {
    return product.brand?.trim()
        ? `${product.name} · ${product.brand}`
        : product.name;
}

function resolvePurchase(row: UsualProductRow): {
    storeId: string | null;
    amount: { amount: number; unit: string } | null;
} {
    const usual = row.usual;
    if (usual) {
        return {
            storeId: usual.usualStoreId,
            amount: usual.usualAmount,
        };
    }
    return {
        storeId: row.food.usualStoreId,
        amount: row.food.usualAmount,
    };
}

/** The usual product as the sheet's Product row says it ("Any brand" with none). */
export function kitchenUsualProductLabel(row: UsualProductRow): string {
    if (row.usual) return productDisplayName(row.usual);
    return "Any brand";
}

export function kitchenUsualRowMeta(
    row: UsualProductRow,
    ctx: {
        storesById: ReadonlyMap<string, { name: string }>;
        groceryLines: readonly Pick<GroceryLine, "foodId" | "checked">[];
        foodsById: ReadonlyMap<string, Pick<Food, "id" | "genericFoodId">>;
        /** Usuals with an open running-low notice (the design's "low now"). */
        lowFoodIds?: ReadonlySet<string>;
    },
): KitchenUsualsRowMeta {
    const purchase = resolvePurchase(row);
    const storeName =
        purchase.storeId != null
            ? (ctx.storesById.get(purchase.storeId)?.name ?? null)
            : null;
    const amountLabel =
        purchase.amount != null
            ? formatQuantityDisplayParts(
                  purchase.amount.amount,
                  purchase.amount.unit,
              )
            : null;
    const onList = onGroceryList(
        { foodId: row.food.id },
        ctx.groceryLines,
        ctx.foodsById,
    );
    return {
        productLabel: kitchenUsualProductLabel(row),
        storeId: purchase.storeId,
        storeName,
        amountLabel,
        onList,
        lowNow: ctx.lowFoodIds?.has(row.food.id) ?? false,
        restock: usualRestockView(row),
    };
}

/** The line under a usual's name: store, amount, restock, then what is happening to it. */
export function kitchenUsualRowParts(meta: KitchenUsualsRowMeta): string[] {
    const parts: string[] = [];
    if (meta.storeName) parts.push(meta.storeName);
    if (meta.amountLabel) parts.push(meta.amountLabel);
    if (meta.restock) parts.push(...usualRestockParts(meta.restock));
    if (meta.lowNow) parts.push("low now");
    if (meta.onList) parts.push("on the list");
    return parts;
}

export function kitchenUsualsHeaderSubtitle(
    rowCount: number,
    restockDay?: string | null,
): string {
    const count = rowCount === 1 ? "1 usual" : `${rowCount} usuals`;
    return restockDay ? `${count} · restock on ${restockDay}` : count;
}

/** Open sheet only when the food id matches a listed row. */
export function kitchenUsualsResolvedOpenFoodId(
    view: Pick<KitchenUsualsV2View, "rows" | "openFoodId">,
): string | undefined {
    if (!view.openFoodId) return undefined;
    return view.rows.some((row) => row.food.id === view.openFoodId)
        ? view.openFoodId
        : undefined;
}

export function kitchenUsualsEmptyMessage(
    view: Pick<KitchenUsualsV2View, "rows" | "selectedStoreIds" | "stores"> & {
        filteredCount: number;
    },
): string {
    const selected = view.selectedStoreIds ?? [];
    if (
        selected.length > 0 &&
        view.rows.length > 0 &&
        view.filteredCount === 0
    ) {
        const names = selected
            .map((id) => view.stores.find((s) => s.id === id)?.name)
            .filter((name): name is string => name != null);
        return `No usuals at ${names.length > 0 ? names.join(" or ") : "this store"}`;
    }
    return "No usual products yet.";
}

/**
 * Where an action comes back to: the list with the stores it was filtered to.
 * The stores ride in one `store` value, comma-separated, so the list route
 * (which reads one `store`) and a refused post's return path both keep them.
 */
export function usualsReturnTo(
    selected?: readonly string[] | string | null,
): string {
    const ids = (typeof selected === "string" ? [selected] : (selected ?? []))
        .filter(Boolean)
        .join(",");
    return ids === ""
        ? USUALS_V2_RETURN_TO
        : `${USUALS_V2_RETURN_TO}?store=${encodeURIComponent(ids)}`;
}

/** The stores a `store` query names: known ids only, in the order given. */
export function parseUsualsStoreFilter(
    value: string | undefined,
    stores: readonly { id: string }[],
): string[] {
    if (!value) return [];
    const known = new Set(stores.map((store) => store.id));
    const out: string[] = [];
    for (const part of value.split(",")) {
        const id = part.trim();
        if (id !== "" && known.has(id) && !out.includes(id)) out.push(id);
    }
    return out;
}

function filteredRows(view: KitchenUsualsV2View): UsualProductRow[] {
    const selected = view.selectedStoreIds ?? [];
    if (selected.length === 0) return view.rows;
    return view.rows.filter((row) => {
        const storeId = view.rowMeta.get(row.food.id)?.storeId;
        return storeId != null && selected.includes(storeId);
    });
}

function hiddenInputs(fields: Readonly<Record<string, string>>): string {
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`,
        )
        .join("");
}

/** The store filter: a tick for each store shown, Clear to show them all. */
function storeFilter(view: KitchenUsualsV2View): string {
    if (view.stores.length < 2) return "";
    const selected = new Set(view.selectedStoreIds ?? []);
    const stores = sortStoresByName(view.stores);
    const items: MenuItem[] = stores.map((store) => {
        const next = stores
            .filter((row) =>
                row.id === store.id
                    ? !selected.has(row.id)
                    : selected.has(row.id),
            )
            .map((row) => row.id);
        return {
            kind: "checked" as const,
            label: store.name,
            checked: selected.has(store.id),
            href: usualsReturnTo(next),
        };
    });
    if (selected.size > 0) {
        items.push({
            kind: "link",
            label: "Clear",
            href: USUALS_V2_RETURN_TO,
        });
    }
    return String(
        menu({
            label: "Filter by store",
            anchor: "filter",
            filterCount: selected.size,
            items,
        }),
    );
}

/** The row of one usual: name, its product, then store, amount and restock. */
function usualListRow(row: UsualProductRow, meta: KitchenUsualsRowMeta): Html {
    const sheetId = usualSheetId(row.food.id);
    const product = row.usual
        ? productDisplayName(row.usual)
        : "No usual product yet";
    const sub = kitchenUsualRowParts(meta).join(" · ");
    return itemRow({
        title: row.food.name,
        meta: product,
        ...(sub
            ? {
                  subtitle: sub,
                  ...(meta.lowNow ? { state: "warning" as const } : {}),
              }
            : {}),
        trailing: { kind: "chevron" },
        select: { name: "ids[]", value: row.food.id },
        id: `fd-usual-row-${row.food.id}`,
        focusable: true,
        data: { "fd-sheet-row": "", "sheet-id": sheetId },
    });
}

function pickerDataForRow(row: UsualProductRow): {
    usualProductId: string | null;
    prefillStoreId: string | null;
    prefillAmount: { amount: number; unit: string } | null;
} {
    const usualId = row.food.usualProductId;
    const usual = row.usual;
    const prefillFromProduct =
        usual != null && usual.genericFoodId === row.food.id;
    return {
        usualProductId: usualId,
        prefillStoreId: prefillFromProduct
            ? usual.usualStoreId
            : row.food.usualStoreId,
        prefillAmount: prefillFromProduct
            ? usual.usualAmount
            : row.food.usualAmount,
    };
}

/** The product picker: one radio row for each product and "Any brand". */
function productPickerSheet(
    row: UsualProductRow,
    formId: string,
    usualProductId: string | null,
): string {
    const pickerId = productPickerSheetId(row.food.id);
    const radio = (opts: {
        value: string;
        title: string;
        subtitle: string;
        checked: boolean;
        filter: string;
    }) =>
        itemRow({
            title: opts.title,
            subtitle: opts.subtitle,
            lead: {
                kind: "radio",
                label: opts.title,
                name: "product_food_id",
                value: opts.value,
                checked: opts.checked,
                form: formId,
            },
            data: { "fd-usual-product": opts.filter.toLowerCase() },
        });
    const rows = [
        // The chosen product first, then the rest in the order they came.
        ...[...row.products]
            .sort(
                (a, b) =>
                    Number(b.id === usualProductId) -
                    Number(a.id === usualProductId),
            )
            .map((product) =>
                radio({
                    value: product.id,
                    title: product.name,
                    // "Kirkland · 1 gal": the brand, then what is bought of it.
                    subtitle:
                        [
                            product.brand?.trim(),
                            product.usualAmount
                                ? formatQuantityDisplayParts(
                                      product.usualAmount.amount,
                                      product.usualAmount.unit,
                                  )
                                : null,
                        ]
                            .filter(Boolean)
                            .join(" · ") || "In your foods",
                    checked: usualProductId === product.id,
                    filter: productDisplayName(product),
                }),
            ),
        radio({
            value: "",
            title: "Any brand",
            subtitle: "No usual product",
            checked: usualProductId == null,
            filter: "any brand",
        }),
    ];
    const search = searchField({
        label: "Search products",
        placeholder: "Search products",
        name: "pq",
        id: `${pickerId}-q`,
        style: "boxed",
        data: { "fd-usual-product-search": "" },
    });
    return sheet({
        id: pickerId,
        placement: "dialog",
        className: "fd-kitchen-sheet",
        header: {
            kind: "title",
            title: "Product",
            subtitle: row.food.name,
        },
        body: raw(
            `${sheetSection({ kind: "fields", content: raw(`<div data-fd-usual-product-find>${search}</div>`) })}${sheetSection(
                {
                    kind: "choice",
                    content: listGroup({ rows, label: "Products" }),
                },
            )}`,
        ),
        actions: {
            kind: "single",
            primary: {
                label: "Done",
                attrs: { command: "close", commandfor: pickerId },
            },
        },
        focus: "panel",
    });
}

function storeChips(
    pick: ReturnType<typeof pickerDataForRow>,
    stores: GroceryStore[],
): Html {
    return choiceGroup({
        name: "usual_store_id",
        legend: "Store",
        options: [
            { value: "", label: "Any store", selected: !pick.prefillStoreId },
            ...sortStoresByName(stores).map((store) => ({
                value: store.id,
                label: store.name,
                selected: pick.prefillStoreId === store.id,
            })),
        ],
    });
}

/** The unit as a pull-down on a row; its choice rides in `usual_unit`. */
function unitPulldown(unit: string): Html {
    const choices = [
        { value: "", label: "No amount" },
        ...FOOD_QUANTITY_UNITS.map((u) => ({
            value: u,
            label: quantityUnitOptionLabel(u),
        })),
    ];
    const current = choices.find((c) => c.value === unit) ?? choices[0]!;
    return menuRow({
        label: "Unit",
        row: { title: "Unit", value: current.label },
        field: { name: "usual_unit", value: current.value },
        items: choices.map((choice) => ({
            kind: "checked" as const,
            label: choice.label,
            checked: choice.value === current.value,
            value: choice.value,
        })),
    });
}

const SCHEDULE_CHOICES: ReadonlyArray<{
    value: RestockSchedule | "";
    label: string;
}> = [
    { value: "", label: "No schedule" },
    { value: "weekly", label: "Every week" },
    { value: "every_n_weeks", label: "Every N weeks" },
    { value: "monthly", label: "Every month" },
];

function restockSheet(
    row: UsualProductRow,
    view: UsualRestockView,
    ctx: { returnTo: string; open: boolean; error: string },
): string {
    const sheetId = usualRestockSheetId(row.food.id);
    const formId = `${sheetId}-form`;
    const placeholder =
        view.lowLevel == null && view.effectiveLowLevel != null
            ? formatLowLevel(view.effectiveLowLevel)
            : "";
    const unit = view.unit ? quantityUnitOptionLabel(view.unit) : "";
    const weeks = view.everyWeeks ?? 2;
    const levelValue = view.lowLevel != null ? String(view.lowLevel) : "";
    const current = view.schedule ?? "";
    const how = choiceGroup({
        name: "restock_schedule",
        legend: "How often",
        options: SCHEDULE_CHOICES.map((choice) => ({
            value: choice.value,
            label: choice.label,
            selected: choice.value === current,
        })),
    });
    const body = `${ctx.error}<form id="${esc(formId)}" method="post" action="${esc(usualSchedulePath(row.food.id))}">${hiddenInputs({ return_to: ctx.returnTo, scope: "schedule" })}${sheetSection({ kind: "chips", label: "How often", content: how })}<div data-fd-restock-weeks>${sheetSection(
        {
            kind: "amount",
            label: "Weeks between",
            content: stepperControl({
                name: "restock_every_weeks",
                label: "Weeks between restocks",
                value: weeks,
                min: 1,
                max: RESTOCK_MAX_EVERY_WEEKS,
                step: 1,
                unit: weeks === 1 ? "week" : "weeks",
                id: `${sheetId}-weeks`,
            }),
        },
    )}</div>${sheetSection({
        kind: "rows",
        content: listGroup({
            label: "Paused",
            rows: [
                itemRow({
                    title: "Paused",
                    trailing: {
                        kind: "control",
                        html: toggle({
                            label: "Paused",
                            name: "restock_paused",
                            value: "1",
                            on: view.paused,
                        }),
                    },
                }),
            ],
        }),
    })}${sheetSection({
        kind: "fields",
        label: unit ? `Low below · ${unit}` : "Low below",
        content: field({
            id: `${sheetId}-low`,
            label: "Low below",
            labelHidden: true,
            name: "restock_low_level",
            type: "number",
            inputmode: "decimal",
            min: 0,
            step: "any",
            value: levelValue,
            placeholder,
        }),
    })}</form>`;
    return sheet({
        id: sheetId,
        placement: "dialog",
        className: "fd-kitchen-sheet",
        header: { kind: "title", title: "Restock", subtitle: row.food.name },
        body: raw(body),
        actions: {
            kind: "single",
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: ctx.open,
        focus: "panel",
    });
}

function editUsualSheet(
    row: UsualProductRow,
    view: KitchenUsualsV2View,
    resolvedOpenFoodId: string | undefined,
): string {
    const open = resolvedOpenFoodId === row.food.id;
    const sheetId = usualSheetId(row.food.id);
    const pick = pickerDataForRow(row);
    const returnTo = usualsReturnTo(view.selectedStoreIds);
    const errorHtml =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const restockOpen = open && view.openRestock === true;
    const restock = usualRestockView(row);
    const formId = `${sheetId}-form`;
    const unitValue = pick.prefillAmount?.unit ?? "";
    const amountValue = pick.prefillAmount?.amount ?? 1;
    const summary =
        restock.paused && (restock.schedule || restock.whenLow)
            ? "Paused"
            : (usualScheduleLabel(restock) ?? "No schedule");

    const product = sheetSection({
        kind: "rows",
        content: listGroup({
            label: "Usual product",
            rows: [
                itemRow({
                    title: "Product",
                    value: kitchenUsualProductLabel(row),
                    trailing: { kind: "chevron" },
                    opens: productPickerSheetId(row.food.id),
                }),
            ],
        }),
    });
    const store = view.stores.length
        ? sheetSection({
              kind: "chips",
              label: "Store",
              content: storeChips(pick, view.stores),
          })
        : "";
    const amount = sheetSection({
        kind: "amount",
        label: "Usually buy",
        content: raw(
            `${stepperControl({
                name: "usual_amount",
                label: "Amount",
                value: amountValue,
                min: 0,
                step: 1,
                inputStep: "any",
                unit: quantityUnitOptionLabel(unitValue),
                id: `${sheetId}-amount`,
            })}${listGroup({ rows: [unitPulldown(unitValue)], label: "Unit" })}`,
        ),
    });
    const restockRows = sheetSection({
        kind: "rows",
        content: listGroup({
            label: "Restock",
            rows: [
                itemRow({
                    title: "Restock",
                    value: summary,
                    trailing: { kind: "chevron" },
                    opens: usualRestockSheetId(row.food.id),
                }),
                itemRow({
                    title: "Add when it runs low",
                    trailing: {
                        kind: "control",
                        html: toggle({
                            label: "Add when it runs low",
                            name: USUAL_WHEN_LOW_FIELD,
                            value: "1",
                            on: restock.whenLow,
                        }),
                    },
                }),
            ],
        }),
    });
    const weight = sheetSection({
        kind: "fields",
        label: "Weight",
        content: raw(
            `<div class="fd-kitchen-weight">${field({
                id: `${sheetId}-g-ml`,
                label: "Grams per ml",
                name: USUAL_GRAMS_PER_ML_FIELD,
                type: "number",
                inputmode: "decimal",
                min: 0,
                step: "any",
                value: formatFactor(row.food.gramsPerMl),
                placeholder: formatFactor(row.usual?.gramsPerMl) || "–",
            })}${field({
                id: `${sheetId}-g-each`,
                label: "Grams per item",
                name: USUAL_GRAMS_PER_EACH_FIELD,
                type: "number",
                inputmode: "decimal",
                min: 0,
                step: "any",
                value: formatFactor(row.food.gramsPerEach),
                placeholder: formatFactor(row.usual?.gramsPerEach) || "–",
            })}</div>`,
        ),
    });
    const form = `<form id="${esc(formId)}" method="post" action="/kitchen/usuals/${esc(row.food.id)}" data-fd-usual-edit>${hiddenInputs({ return_to: returnTo, [USUAL_WHEN_LOW_MARKER]: "1", [USUAL_WEIGHTS_MARKER]: "1" })}${product}${store}${amount}${restockRows}${weight}</form>`;
    const remove = menu({
        label: `Actions for ${row.food.name}`,
        anchor: "more",
        items: [
            {
                kind: "destructive",
                label: "Remove",
                action: `${USUALS_V2_RETURN_TO}/${row.food.id}/remove`,
                fields: { return_to: returnTo },
            },
        ],
    });
    return `${sheet({
        id: sheetId,
        placement: "side",
        className: "fd-kitchen-sheet",
        header: { kind: "title", title: row.food.name, menu: remove },
        body: raw(`${restockOpen ? "" : errorHtml}${form}`),
        actions: {
            kind: "single",
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: open,
        focus: "panel",
    })}${productPickerSheet(row, formId, pick.usualProductId)}${restockSheet(row, restock, { returnTo, open: restockOpen, error: restockOpen ? errorHtml : "" })}`;
}

function renderUsualsHead(
    view: KitchenUsualsV2View,
    tools: string,
    addDesktop: string,
): string {
    const subtitle = kitchenUsualsHeaderSubtitle(
        view.rows.length,
        view.restockDay,
    );
    return renderKitchenHead({
        active: "usuals",
        phoneSubtitle: subtitle,
        desktopTools: `${tools}${addDesktop}`,
    });
}

export function renderKitchenUsualsBody(view: KitchenUsualsV2View): string {
    const resolvedOpen = kitchenUsualsResolvedOpenFoodId(view);
    const rows = filteredRows(view);
    const returnTo = usualsReturnTo(view.selectedStoreIds);
    const select = selectionBars({
        scope: "usuals",
        returnTo,
        actions: [
            {
                kind: "confirm",
                key: "remove",
                label: "Remove",
                action: "/kitchen/usuals/bulk/remove",
            },
        ],
    });
    const selectable = rows.length > 0;
    // The ⋯ holds only what applies: Select with rows to pick; with none, no ⋯.
    const more = selectable
        ? String(
              menu({
                  label: "Usuals options",
                  anchor: "more",
                  items: [select.menuItem],
              }),
          )
        : "";
    const tools = `${storeFilter(view)}${more}`;
    const add = addUsualButton();
    const head = renderUsualsHead(view, tools, add.desktop);

    const addRow = listGroup({
        label: "Add a usual",
        data: { "fd-usual-add-row": "" },
        rows: [
            itemRow({
                title: "Add a usual",
                lead: { kind: "icon", name: "plus" },
                opens: USUAL_ADD_SHEET_ID,
            }),
        ],
    });
    const list =
        rows.length === 0
            ? String(
                  emptyState({
                      title: kitchenUsualsEmptyMessage({
                          ...view,
                          filteredCount: rows.length,
                      }),
                  }),
              )
            : `${String(
                  sectionHeader({
                      label: "Usuals",
                      count: rows.length,
                      rule: false,
                  }),
              )}${String(
                  listGroup({
                      label: "Usual products",
                      rows: rows.map((row) =>
                          usualListRow(row, view.rowMeta.get(row.food.id)!),
                      ),
                  }),
              )}`;
    const layout = pageLayout({
        layout: "single",
        content: raw(`${list}${String(addRow)}`),
        className: "fd-kitchen-usuals-layout",
    });
    const pageError =
        view.error && !resolvedOpen
            ? String(settingsErrorBanner(view.error))
            : "";
    const sheets = view.rows
        .map((row) => editUsualSheet(row, view, resolvedOpen))
        .join("");
    const addSheet = addUsualSheet({
        add: view.add,
        addable: view.addable,
        stores: view.stores,
        selectedStoreIds: view.selectedStoreIds,
        known: knownUsualAmounts([
            ...view.rows.map((row) => row.food),
            ...view.addable,
        ]),
        // One store filtered: the add posts that store and returns to it. Two or
        // more cannot name one store, so an add returns to the whole list.
        returnTo:
            (view.selectedStoreIds ?? []).length === 1
                ? returnTo
                : USUALS_V2_RETURN_TO,
        barcodeCamera: view.chrome.flags.barcodeCamera,
    });
    return `${head}
<div class="fd-kitchen-usuals-page"${select.rootAttrs}>
${kitchenTopTools(tools, add.phone)}
${pageError}
${selectable ? `${String(select.bars)}${String(select.head)}` : ""}
${String(layout)}
${sheets}
${addSheet}
</div>`;
}

export function renderKitchenUsualsV2Page(view: KitchenUsualsV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: "Usuals",
        active: "household",
        v2Active: "kitchen",
        v2Kitchen: "usuals",
        v2KitchenGroceriesCount: view.openGroceriesCount,
        body: renderKitchenUsualsBody(view),
    });
}

export function buildPreviewKitchenUsualsView(
    view: Pick<KitchenUsualsV2View, "chrome" | "rows" | "stores" | "rowMeta"> &
        Partial<KitchenUsualsV2View>,
): KitchenUsualsV2View {
    return {
        selectedStoreIds: [],
        openGroceriesCount: 3,
        addable: [],
        ...view,
    };
}
