import type { GroceryLine } from "../../../domain/grocery.js";
import { onGroceryList } from "../../../domain/grocery.js";
import type { Food, UsualProductRow } from "../../../domain/foods.js";
import { FOOD_QUANTITY_UNITS } from "../../../domain/quantity.js";
import type { GroceryStore } from "../../../domain/settings.js";
import type { AppChromeBase } from "../../attention.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { quantityUnitOptionLabel } from "../../display-quantity.js";
import { chipLink, chipNav } from "../../components/v2/chips.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import {
    rowList,
    sectionHeader,
    usualRow,
    type UsualPart,
} from "../../components/v2/rows.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import { stepper } from "../../components/v2/stepper.js";
import { renderAppShell } from "../../shell.js";
import { renderKitchenDesktopSeg } from "./kitchen-overview.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const USUALS_V2_RETURN_TO = "/kitchen/usuals";
export const USUAL_ADD_SHEET_ID = "fd-usual-add";

export const USUALS_INTRO =
    "What you usually buy, where, and how much. Adding a food to the list fills these in.";

export const USUALS_EDIT_SUBTITLE = "Your usual product, store and amount";

export function usualSheetId(foodId: string): string {
    return `fd-usual-${foodId}`;
}

function productPickerSheetId(foodId: string): string {
    return `${usualSheetId(foodId)}-product`;
}

export type KitchenUsualsRowMeta = {
    productLabel: string;
    storeId: string | null;
    storeName: string | null;
    amountLabel: string | null;
    onList: boolean;
};

export type KitchenUsualsAddSearch = {
    q: string;
    results: Food[];
    truncated: boolean;
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
    addSearch?: KitchenUsualsAddSearch;
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
    };
}

export function kitchenUsualRowParts(
    meta: KitchenUsualsRowMeta,
): readonly UsualPart[] {
    const parts: UsualPart[] = [];
    if (meta.storeName) parts.push(meta.storeName);
    if (meta.amountLabel) parts.push(meta.amountLabel);
    if (meta.onList) parts.push({ text: "on the list", tone: "accent" });
    return parts;
}

export function kitchenUsualsHeaderSubtitle(rowCount: number): string {
    return rowCount === 1 ? "1 usual" : `${rowCount} usuals`;
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

function usualListRow(row: UsualProductRow, view: KitchenUsualsV2View): Html {
    const meta = view.rowMeta.get(row.food.id)!;
    const sheetId = usualSheetId(row.food.id);
    const rowHtml = String(
        usualRow({
            title: row.food.name,
            meta: meta.productLabel,
            parts: kitchenUsualRowParts(meta),
        }),
    );
    return raw(
        rowHtml.replace(
            "<li ",
            `<li id="fd-usual-row-${esc(row.food.id)}" data-fd-usual-row data-sheet-id="${esc(sheetId)}" tabindex="0" `,
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
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const formId = `${sheetId}-form`;
    const productLabel = kitchenUsualProductLabel(row);
    const pickerId = productPickerSheetId(row.food.id);
    const stepperId = `${sheetId}-amount`;
    const unitValue = pick.prefillAmount ? (pick.prefillAmount.unit ?? "") : "";
    const amountValue = pick.prefillAmount?.amount ?? 1;
    const productRow = `<div class="fd-kitchen-sheet-rows"><button type="button" class="fd-kitchen-sheet-row" commandfor="${esc(pickerId)}" command="show-modal"><span class="fd-kitchen-sheet-row__label">Product</span><span class="fd-kitchen-sheet-row__value"><span class="fd-kitchen-sheet-row__meta">${esc(productLabel)}</span><span class="fd-kitchen-sheet-row__chev" aria-hidden="true">${String(iconChevronRight())}</span></span></button></div>`;
    const body = `${error}<form id="${esc(formId)}" method="post" action="/kitchen/usuals/${esc(row.food.id)}" class="fd-kitchen-usual-sheet-form">
<input type="hidden" name="return_to" value="${esc(returnTo)}" />
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
</form>${productPickerSheet(row, formId, pick)}`;
    return sheet({
        id: sheetId,
        kind: "edit",
        title: row.food.name,
        subtitle: USUALS_EDIT_SUBTITLE,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${esc(formId)}">Save</button>`,
        openOnLoad: open,
    });
}

function addUsualSheet(view: KitchenUsualsV2View): string {
    if ((view.addable?.length ?? 0) === 0) return "";
    const q = view.addSearch?.q ?? "";
    const results = view.addSearch?.results ?? [];
    const resultRows = results
        .map((food) => {
            const chooseHref = `${USUALS_V2_RETURN_TO}?food=${encodeURIComponent(food.id)}${view.selectedStoreId ? `&store=${encodeURIComponent(view.selectedStoreId)}` : ""}`;
            const brand = food.brand
                ? `<span class="fd-kitchen-usual-add__brand">${esc(food.brand)}</span>`
                : "";
            return `<li class="fd-kitchen-usual-add__result"><a class="fd-kitchen-usual-add__choose" href="${esc(chooseHref)}"><span class="fd-kitchen-usual-add__name">${esc(food.name)}</span>${brand}</a></li>`;
        })
        .join("");
    const searchOutcome =
        view.addSearch == null
            ? ""
            : results.length === 0
              ? `<p class="fd-kitchen-usual-add__empty">No matching food.</p>`
              : `<ul class="fd-kitchen-usual-add__results">${resultRows}</ul>${view.addSearch.truncated ? `<p class="fd-kitchen-usual-add__hint">Showing the first 20. Type more to narrow it.</p>` : ""}`;
    const body = `<form method="get" action="${esc(USUALS_V2_RETURN_TO)}" class="fd-kitchen-usual-add-form">
<label class="fd-kitchen-sheet-label">Food<input id="fd-usual-add-q" name="q" type="search" autocomplete="off" value="${esc(q)}" /></label>
<button type="submit" class="fd-btn fd-btn--primary">Search</button>
</form>
<p class="fd-kitchen-usual-add__hint">Scanned products aren't listed. File them under a food with Belongs to… on <a href="/settings/household/items">Items</a>.</p>
${searchOutcome}`;
    return sheet({
        id: USUAL_ADD_SHEET_ID,
        kind: "edit",
        title: "Add a usual",
        body,
        openOnLoad: view.addSearch != null,
    });
}

function addUsualTrigger(view: KitchenUsualsV2View): string {
    if ((view.addable?.length ?? 0) === 0) return "";
    return String(
        sheetTrigger({
            target: USUAL_ADD_SHEET_ID,
            label: "Add a usual",
            className: "fd-kitchen-usual-add-btn",
        }),
    );
}

function renderUsualsDesktopHead(view: KitchenUsualsV2View): string {
    const itemCount = esc(kitchenUsualsHeaderSubtitle(view.rows.length));
    return `<header class="fd-kitchen-overview-head fd-kitchen-usual-head">
<div class="fd-kitchen-overview-head__title">
<h1 class="fd-kitchen-fridge-title">Kitchen<span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--phone">${itemCount}</span><span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--desktop">${itemCount}</span></h1>
</div>
<div class="fd-kitchen-overview-head__tools">
${renderKitchenDesktopSeg("usuals")}
</div>
</header>`;
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
    const itemCount = esc(kitchenUsualsHeaderSubtitle(view.rows.length));
    const addTrigger = addUsualTrigger(view);
    const addSheet = addUsualSheet(view);
    return `<h1 class="fd-kitchen-grocery-title fd-kitchen-usual-title fd-kitchen-fridge-title--phone">Kitchen<span class="fd-kitchen-grocery-count fd-kitchen-usual-count">${itemCount}</span></h1>
${renderUsualsDesktopHead(view)}
<div class="fd-kitchen-usuals-page">
${pageError}
<p class="fd-kitchen-usual-intro">${esc(USUALS_INTRO)}</p>
${view.stores.length > 0 ? storeFilterChips(view) : ""}
${rows.length > 0 ? String(sectionHeader({ title: "Usuals", count: rows.length })) : ""}
${list}
<div class="fd-kitchen-usual-add-wrap">${addTrigger}</div>
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
        selectedStoreId: null,
        openGroceriesCount: 3,
        addable: [],
        ...view,
    };
}
