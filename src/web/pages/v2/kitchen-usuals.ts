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
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { quantityUnitOptionLabel } from "../../display-quantity.js";
import { chipLink, chipNav } from "../../components/v2/chips.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { iconBolt, iconRefresh } from "../../components/v2/icons.js";
import {
    rowList,
    sectionHeader,
    usualRow,
    type UsualPart,
} from "../../components/v2/rows.js";
import { confirmSheet, sheet } from "../../components/v2/sheet.js";
import {
    addUsualSheet,
    addUsualButton,
    USUAL_ADD_SHEET_ID,
    type UsualAddView,
} from "./kitchen-usuals-add.js";

export { USUAL_ADD_SHEET_ID };
import { selectMode } from "./select-mode.js";
import { stepper } from "../../components/v2/stepper.js";
import type { Notice } from "../../../domain/notices.js";
import { renderAppShell } from "../../shell.js";
import { noticeStrip, stripNotices } from "./notice-strip.js";
import { kitchenTopTools, renderKitchenHead } from "./kitchen-head.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const USUALS_V2_RETURN_TO = "/kitchen/usuals";

export const USUALS_INTRO =
    "What you usually buy, where, and how much. Adding a food to the list fills these in.";

export const USUALS_EDIT_SUBTITLE = "Your usual product, store and amount";

export const USUAL_SCHEDULE_PATH_SUFFIX = "schedule";
/** The edit sheet's "Add when it runs low" checkbox, and the marker that says the sheet posted it (an unchecked box posts nothing). */
export const USUAL_WHEN_LOW_FIELD = "restock_when_low";
export const USUAL_WHEN_LOW_MARKER = "restock_when_low_present";

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

export function usualRemoveSheetId(foodId: string): string {
    return `${usualSheetId(foodId)}-remove`;
}

/** Asks before taking one usual off the list; posts to its remove route. */
function removeUsualSheet(row: UsualProductRow, returnTo: string): string {
    return confirmSheet({
        id: usualRemoveSheetId(row.food.id),
        title: "Remove from usuals",
        message: `Remove ${row.food.name} from your usuals?`,
        action: `${USUALS_V2_RETURN_TO}/${row.food.id}/remove`,
        confirmLabel: "Remove",
        hiddenFields: { return_to: returnTo },
    });
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

/** The row's restock parts: the schedule, then the low level when adding on low. */
export function usualRestockParts(view: UsualRestockView): UsualPart[] {
    const label = usualScheduleLabel(view);
    if (label == null && !view.whenLow) return [];
    if (view.paused) return [{ text: "Paused", tone: "muted" }];
    const parts: UsualPart[] = [label ?? "When low"];
    if (view.whenLow && view.effectiveLowLevel != null) {
        parts.push(`below ${formatLowLevel(view.effectiveLowLevel)}`);
    }
    return parts;
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
    selectedStoreId?: string | null;
    error?: string;
    openFoodId?: string;
    /** A restock-form error reopens the Restock sheet, not just the usual's. */
    openRestock?: boolean;
    /** "Sundays": the household's restock day, when restocking is on. */
    restockDay?: string | null;
    /** The Add a usual sheet's state; absent leaves it closed on Scan. */
    add?: UsualAddView;
    openGroceriesCount?: number;
    /** The household's open notices; the usuals running low show in place. */
    notices?: readonly Notice[];
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

export function kitchenUsualRowParts(
    meta: KitchenUsualsRowMeta,
): readonly UsualPart[] {
    const parts: UsualPart[] = [];
    if (meta.storeName) parts.push(meta.storeName);
    if (meta.amountLabel) parts.push(meta.amountLabel);
    if (meta.restock) parts.push(...usualRestockParts(meta.restock));
    if (meta.lowNow) parts.push({ text: "low now", tone: "warn" });
    if (meta.onList) parts.push({ text: "on the list", tone: "accent" });
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
    view: Pick<KitchenUsualsV2View, "rows" | "selectedStoreId" | "stores"> & {
        filteredCount: number;
    },
): string {
    if (
        view.selectedStoreId &&
        view.rows.length > 0 &&
        view.filteredCount === 0
    ) {
        const name =
            view.stores.find((s) => s.id === view.selectedStoreId)?.name ??
            "this store";
        return `No usuals at ${name}`;
    }
    return "No usual products yet.";
}

function storeFilterChips(view: KitchenUsualsV2View): string {
    const counts = new Map<string, number>();
    let all = 0;
    for (const row of view.rows) {
        const meta = view.rowMeta.get(row.food.id);
        if (!meta) continue;
        all += 1;
        if (meta.storeId) {
            counts.set(meta.storeId, (counts.get(meta.storeId) ?? 0) + 1);
        }
    }
    const chips = [
        chipLink({
            label: "All",
            href: USUALS_V2_RETURN_TO,
            count: all,
            selected: !view.selectedStoreId,
        }),
        ...sortStoresByName(view.stores).map((store) =>
            chipLink({
                label: store.name,
                href: `${USUALS_V2_RETURN_TO}?store=${encodeURIComponent(store.id)}`,
                count: counts.get(store.id) ?? 0,
                selected: view.selectedStoreId === store.id,
            }),
        ),
    ];
    return String(
        chipNav(chips, {
            label: "Filter usuals by store",
            className: "fd-kitchen-usual-stores",
        }),
    );
}

function filteredRows(view: KitchenUsualsV2View): UsualProductRow[] {
    if (!view.selectedStoreId) return view.rows;
    return view.rows.filter((row) => {
        const meta = view.rowMeta.get(row.food.id);
        return meta?.storeId === view.selectedStoreId;
    });
}

function partsMarkup(parts: readonly UsualPart[]): string {
    return parts
        .map((part) =>
            typeof part === "object"
                ? `<span class="fd-tone fd-tone--${part.tone}">${esc(part.text)}</span>`
                : `<span>${esc(part)}</span>`,
        )
        .join(`<span class="fd-sep" aria-hidden="true"> · </span>`);
}

/**
 * The desktop table's cells (FigCraft 48217: product, store, amount, restock).
 * They show from 1024px, where the phone's meta and sub-line are hidden; the
 * restock cell takes the row's status tone, "low now" or "on the list".
 */
export function usualTableCells(meta: KitchenUsualsRowMeta): string {
    const product =
        meta.productLabel === "Any brand"
            ? `<span class="fd-usual-cell fd-usual-cell--product fd-usual-cell--muted">${esc(meta.productLabel)}</span>`
            : `<span class="fd-usual-cell fd-usual-cell--product">${esc(meta.productLabel)}</span>`;
    const restock: UsualPart[] = meta.restock
        ? usualRestockParts(meta.restock)
        : [];
    const status = meta.lowNow
        ? { text: "low now", tone: "warn" as const }
        : meta.onList
          ? { text: "on the list", tone: "accent" as const }
          : null;
    if (status) restock.push(status.text);
    const tone = status ? ` fd-tone fd-tone--${status.tone}` : "";
    return `${product}<span class="fd-usual-cell fd-usual-cell--store">${esc(meta.storeName ?? "")}</span><span class="fd-usual-cell fd-usual-cell--amount">${esc(meta.amountLabel ?? "")}</span><span class="fd-usual-cell fd-usual-cell--restock${tone}">${status ? restock.map((part) => esc(typeof part === "object" ? part.text : part)).join(" · ") : partsMarkup(restock)}</span>`;
}

/** The desktop table's column titles; the phone list has none. */
const USUAL_TABLE_HEAD = `<div class="fd-kitchen-usual-thead" aria-hidden="true"><span>Food</span><span>Product</span><span>Store</span><span>Amount</span><span>Restock</span></div>`;

function usualListRow(row: UsualProductRow, view: KitchenUsualsV2View): Html {
    const meta = view.rowMeta.get(row.food.id)!;
    const sheetId = usualSheetId(row.food.id);
    const rowHtml = String(
        usualRow({
            title: row.food.name,
            meta: meta.productLabel,
            parts: kitchenUsualRowParts(meta),
            select: { name: "ids[]", value: row.food.id, label: row.food.name },
        }),
    );
    // Function replacements: a string would read `$` in an id as a pattern.
    return raw(
        rowHtml
            .replace(
                "<li ",
                () =>
                    `<li id="fd-usual-row-${esc(row.food.id)}" data-fd-usual-row data-sheet-id="${esc(sheetId)}" tabindex="0" `,
            )
            .replace(
                '<span class="fd-row__chevron"',
                () => `${usualTableCells(meta)}<span class="fd-row__chevron"`,
            ),
    );
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

function productPickerRadios(
    formId: string,
    row: UsualProductRow,
    usualProductId: string | null,
): string {
    const options: { value: string; label: string; selected: boolean }[] = [
        {
            value: "",
            label: "Any brand",
            selected: usualProductId == null,
        },
        ...row.products.map((product) => ({
            value: product.id,
            label: productDisplayName(product),
            selected: usualProductId === product.id,
        })),
    ];
    const chips = options
        .map((option) => {
            const autofocus = option.selected ? " autofocus" : "";
            return `<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" form="${esc(formId)}" name="product_food_id" value="${esc(option.value)}"${option.selected ? " checked" : ""}${autofocus}><span class="fd-chip__face"><span class="fd-chip__label">${esc(option.label)}</span></span></label>`;
        })
        .join("");
    return `<fieldset class="fd-choice-group"><legend class="fd-sr">Usual product</legend><div class="fd-chips fd-chips--stack">${chips}</div></fieldset>`;
}

function productPickerSheet(
    row: UsualProductRow,
    formId: string,
    pick: ReturnType<typeof pickerDataForRow>,
): string {
    const pickerId = productPickerSheetId(row.food.id);
    const body = productPickerRadios(formId, row, pick.usualProductId);
    return sheet({
        id: pickerId,
        kind: "edit",
        title: "Product",
        subtitle: row.food.name,
        body,
        actions: `<button type="button" class="fd-btn fd-btn--primary" commandfor="${esc(pickerId)}" command="close">Done</button>`,
    });
}

function storeChoiceGroup(
    formId: string,
    pick: ReturnType<typeof pickerDataForRow>,
    stores: GroceryStore[],
): string {
    const options = [
        {
            value: "",
            label: "Any store",
            selected: !pick.prefillStoreId,
        },
        ...sortStoresByName(stores).map((store) => ({
            value: store.id,
            label: store.name,
            selected: pick.prefillStoreId === store.id,
        })),
    ];
    const chips = options
        .map((option) => {
            return `<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" form="${esc(formId)}" name="usual_store_id" value="${esc(option.value)}"${option.selected ? " checked" : ""}><span class="fd-chip__face"><span class="fd-chip__label">${esc(option.label)}</span></span></label>`;
        })
        .join("");
    return `<fieldset class="fd-choice-group fd-kitchen-usual-store-field"><legend class="fd-sr">Store</legend><div class="fd-chips">${chips}</div></fieldset>`;
}

function unitField(
    formId: string,
    unitValue: string,
    stepperUnitId: string,
): string {
    const hiddenId = `${formId}-unit`;
    // A blank choice leaves the usual amount unset, as the old picker could.
    const blank = `<option value=""${unitValue === "" ? " selected" : ""}>No amount</option>`;
    const opts =
        blank +
        FOOD_QUANTITY_UNITS.map((unit) => {
            const label = quantityUnitOptionLabel(unit);
            const sel = unitValue === unit ? " selected" : "";
            return `<option value="${esc(unit)}"${sel}>${esc(label)}</option>`;
        }).join("");
    return `<input type="hidden" name="usual_unit" value="${esc(unitValue)}" id="${esc(hiddenId)}" form="${esc(formId)}" /><select class="fd-kitchen-usual-unit" aria-labelledby="${esc(stepperUnitId)}" data-fd-usual-unit data-fd-usual-unit-target="${esc(hiddenId)}">${opts}</select>`;
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

function scheduleChoiceGroup(formId: string, view: UsualRestockView): string {
    const current = view.schedule ?? "";
    const chips = SCHEDULE_CHOICES.map(
        (choice) =>
            `<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" form="${esc(formId)}" name="restock_schedule" value="${esc(choice.value)}"${choice.value === current ? " checked" : ""}><span class="fd-chip__face"><span class="fd-chip__label">${esc(choice.label)}</span></span></label>`,
    ).join("");
    return `<fieldset class="fd-choice-group fd-kitchen-restock-schedule"><legend class="fd-sr">Restock schedule</legend><div class="fd-chips">${chips}</div></fieldset>`;
}

/** A switch that submits with its form: a checkbox drawn like `.fd-switch`. */
function restockCheckSwitch(opts: {
    formId: string;
    name: string;
    label: string;
    checked: boolean;
}): string {
    return `<label class="fd-kitchen-sheet-row fd-kitchen-restock-switch"><span class="fd-kitchen-sheet-row__label">${esc(opts.label)}</span><input type="checkbox" class="fd-kitchen-switch" role="switch" form="${esc(opts.formId)}" name="${esc(opts.name)}" value="1"${opts.checked ? " checked" : ""}></label>`;
}

function restockSheet(
    row: UsualProductRow,
    view: UsualRestockView,
    ctx: {
        returnTo: string;
        open: boolean;
        error: string;
    },
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
    const body = `${ctx.error}<form id="${esc(formId)}" method="post" action="${esc(usualSchedulePath(row.food.id))}" class="fd-kitchen-usual-sheet-form fd-kitchen-restock-form">
<input type="hidden" name="return_to" value="${esc(ctx.returnTo)}" />
<input type="hidden" name="scope" value="schedule" />
<p class="fd-kitchen-sheet-label">How often</p>
${scheduleChoiceGroup(formId, view)}
<div class="fd-kitchen-restock-weeks">
<p class="fd-kitchen-sheet-label">Weeks between</p>
${String(
    stepper({
        name: "restock_every_weeks",
        label: "Weeks between restocks",
        value: weeks,
        min: 1,
        max: RESTOCK_MAX_EVERY_WEEKS,
        step: 1,
        unit: weeks === 1 ? "week" : "weeks",
        id: `${sheetId}-weeks`,
    }),
)}
</div>
<div class="fd-kitchen-sheet-rows">
${restockCheckSwitch({ formId, name: "restock_paused", label: "Paused", checked: view.paused })}
</div>
<p class="fd-kitchen-restock-hint">Paused: not added on schedule or when it runs low.</p>
<p class="fd-kitchen-sheet-label">Low level</p>
<div class="fd-kitchen-restock-level">
<input class="fd-kitchen-restock-level__input" type="number" inputmode="decimal" min="0" step="any" name="restock_low_level" form="${esc(formId)}" value="${esc(levelValue)}" placeholder="${esc(placeholder)}" aria-label="Low level" />
${unit ? `<span class="fd-kitchen-restock-level__unit">${esc(unit)}</span>` : ""}
</div>
<p class="fd-kitchen-restock-hint">When the fridge has less than this, “Add when it runs low” puts the usual on the list. Left blank, it is a quarter of the usual amount.</p>
</form>`;
    return sheet({
        id: sheetId,
        kind: "edit",
        title: "Restock",
        subtitle: row.food.name,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${esc(formId)}">Save</button>`,
        openOnLoad: ctx.open,
    });
}

/**
 * The two design rows under Amount: Restock (opens its sheet) and the switch.
 * The switch is a checkbox of the edit sheet's own form (`editFormId`), so one
 * Save commits it together with the store and the amount.
 */
function restockGroup(
    row: UsualProductRow,
    view: UsualRestockView,
    editFormId: string,
): string {
    const restockId = usualRestockSheetId(row.food.id);
    const summary =
        view.paused && (view.schedule || view.whenLow)
            ? "Paused"
            : (usualScheduleLabel(view) ?? "No schedule");
    const lowLabel = "Add when it runs low";
    return `<div class="fd-kitchen-sheet-rows fd-kitchen-restock-group">
<button type="button" class="fd-kitchen-sheet-row" commandfor="${esc(restockId)}" command="show-modal"><span class="fd-kitchen-sheet-row__icon">${String(iconRefresh())}</span><span class="fd-kitchen-sheet-row__label">Restock</span><span class="fd-kitchen-sheet-row__value"><span class="fd-kitchen-sheet-row__meta">${esc(summary)}</span><span class="fd-kitchen-sheet-row__chev" aria-hidden="true">${String(iconChevronRight())}</span></span></button>
<label class="fd-kitchen-sheet-row fd-kitchen-restock-low"><span class="fd-kitchen-sheet-row__icon">${String(iconBolt())}</span><span class="fd-kitchen-sheet-row__label">${lowLabel}</span><input type="checkbox" class="fd-kitchen-switch" role="switch" form="${esc(editFormId)}" name="${USUAL_WHEN_LOW_FIELD}" value="1"${view.whenLow ? " checked" : ""}></label>
</div>`;
}

function editUsualSheet(
    row: UsualProductRow,
    view: KitchenUsualsV2View,
    resolvedOpenFoodId: string | undefined,
): string {
    const open = resolvedOpenFoodId === row.food.id;
    const sheetId = usualSheetId(row.food.id);
    const pick = pickerDataForRow(row);
    const returnTo = view.selectedStoreId
        ? `${USUALS_V2_RETURN_TO}?store=${encodeURIComponent(view.selectedStoreId)}`
        : USUALS_V2_RETURN_TO;
    const errorHtml =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const restockOpen = open && view.openRestock === true;
    const error = restockOpen ? "" : errorHtml;
    const restock = usualRestockView(row);
    const formId = `${sheetId}-form`;
    const productLabel = kitchenUsualProductLabel(row);
    const pickerId = productPickerSheetId(row.food.id);
    const stepperId = `${sheetId}-amount`;
    const unitValue = pick.prefillAmount ? (pick.prefillAmount.unit ?? "") : "";
    const amountValue = pick.prefillAmount?.amount ?? 1;
    const productRow = `<div class="fd-kitchen-sheet-rows"><button type="button" class="fd-kitchen-sheet-row" commandfor="${esc(pickerId)}" command="show-modal"><span class="fd-kitchen-sheet-row__label">Product</span><span class="fd-kitchen-sheet-row__value"><span class="fd-kitchen-sheet-row__meta">${esc(productLabel)}</span><span class="fd-kitchen-sheet-row__chev" aria-hidden="true">${String(iconChevronRight())}</span></span></button></div>`;
    const body = `${error}<form id="${esc(formId)}" method="post" action="/kitchen/usuals/${esc(row.food.id)}" class="fd-kitchen-usual-sheet-form">
<input type="hidden" name="return_to" value="${esc(returnTo)}" />
<input type="hidden" name="${USUAL_WHEN_LOW_MARKER}" value="1" />
${productRow}
<p class="fd-kitchen-sheet-label">Store</p>
${storeChoiceGroup(formId, pick, view.stores)}
<p class="fd-kitchen-sheet-label">Usually buy</p>
<div class="fd-kitchen-usual-amount">
${String(
    stepper({
        name: "usual_amount",
        label: "Amount",
        value: amountValue,
        min: 0,
        step: 1,
        inputStep: "any",
        unit: quantityUnitOptionLabel(unitValue),
        id: stepperId,
    }),
)}
${unitField(formId, unitValue, `${stepperId}-unit`)}
</div>
</form>
${restockGroup(row, restock, formId)}
${productPickerSheet(row, formId, pick)}
${removeUsualSheet(row, returnTo)}
${restockSheet(row, restock, { returnTo, open: restockOpen, error: restockOpen ? errorHtml : "" })}`;
    return sheet({
        id: sheetId,
        kind: "edit",
        title: row.food.name,
        subtitle: USUALS_EDIT_SUBTITLE,
        body,
        actions: `<button type="button" class="fd-btn fd-btn--danger" commandfor="${esc(usualRemoveSheetId(row.food.id))}" command="show-modal">Remove</button>
<button type="submit" class="fd-btn fd-btn--primary" form="${esc(formId)}">Save</button>`,
        openOnLoad: open,
    });
}

function renderUsualsHead(view: KitchenUsualsV2View): string {
    const subtitle = kitchenUsualsHeaderSubtitle(
        view.rows.length,
        view.restockDay,
    );
    return renderKitchenHead({
        active: "usuals",
        phoneSubtitle: subtitle,
        desktopSubtitle: subtitle,
        desktopTools: addUsualButton().desktop,
    });
}

/** The usuals running low, with Add to list and Dismiss; empty when none is. */
export function runningLowStrip(notices: readonly Notice[] | undefined) {
    return noticeStrip(
        stripNotices(notices ?? [], ["grocery.running_low"], undefined),
        { back: "/kitchen/usuals", label: "Running low" },
    );
}

export function renderKitchenUsualsBody(view: KitchenUsualsV2View): string {
    const resolvedOpen = kitchenUsualsResolvedOpenFoodId(view);
    const rows = filteredRows(view);
    const emptyMsg = kitchenUsualsEmptyMessage({
        ...view,
        filteredCount: rows.length,
    });
    const list =
        rows.length === 0
            ? `<p class="fd-kitchen-usual-empty">${esc(emptyMsg)}</p>`
            : String(
                  rowList(
                      rows.map((row) => usualListRow(row, view)),
                      { label: "Usual products" },
                  ),
              );
    const pageError =
        view.error && !resolvedOpen
            ? String(settingsErrorBanner(view.error))
            : "";
    const sheets = view.rows
        .map((row) => editUsualSheet(row, view, resolvedOpen))
        .join("");
    const returnTo = view.selectedStoreId
        ? `${USUALS_V2_RETURN_TO}?store=${encodeURIComponent(view.selectedStoreId)}`
        : USUALS_V2_RETURN_TO;
    const addSheet = addUsualSheet({
        add: view.add,
        addable: view.addable,
        stores: view.stores,
        selectedStoreId: view.selectedStoreId,
        returnTo,
        barcodeCamera: view.chrome.flags.barcodeCamera,
    });
    const select = selectMode({
        scope: "usuals",
        returnTo: view.selectedStoreId
            ? `${USUALS_V2_RETURN_TO}?store=${encodeURIComponent(view.selectedStoreId)}`
            : USUALS_V2_RETURN_TO,
        actions: [
            {
                kind: "confirm",
                key: "remove",
                label: "Remove",
                action: "/kitchen/usuals/bulk/remove",
                title: "Remove usuals",
                one: "Remove 1 usual from the list?",
                many: "Remove {n} usuals from the list?",
                confirmLabel: "Remove",
            },
        ],
    });
    const selectable = rows.length > 0;
    return `${renderUsualsHead(view)}
<div class="fd-kitchen-usuals-page"${select.rootAttrs}>
${kitchenTopTools(addUsualButton().phone)}
${pageError}
<p class="fd-kitchen-usual-intro">${esc(USUALS_INTRO)}</p>
${String(runningLowStrip(view.notices))}
${view.stores.length > 0 ? storeFilterChips(view) : ""}
${selectable ? select.tools + select.bar : ""}
${rows.length > 0 ? String(sectionHeader({ title: "Usuals", count: rows.length })) : ""}
<div class="fd-kitchen-usual-table">${rows.length > 0 ? USUAL_TABLE_HEAD : ""}${list}</div>
${sheets}
${selectable ? select.sheets : ""}
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
        selectedStoreId: null,
        openGroceriesCount: 3,
        addable: [],
        ...view,
    };
}
