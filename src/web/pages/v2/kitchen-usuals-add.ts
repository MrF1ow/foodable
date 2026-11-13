/**
 * Kitchen › Usuals › Add a usual: one sheet with three ways in. Scan hands a
 * barcode to the shared scanner and, once it resolves, asks "What is it?";
 * Search lists foods that are not usuals yet; Type it takes a name and its
 * macros. The sheet only renders what it is given: the routes decide the
 * state, the domain (`src/domain/usual-add.ts`) does the work.
 */
import { escapeHtml } from "../../../html.js";
import type { Food } from "../../../domain/foods.js";
import {
    isPlainFoodRow,
    nameWithoutBrand,
    suggestUsualFoods,
} from "../../../domain/usual-add.js";
import { FOOD_QUANTITY_UNITS } from "../../../domain/quantity.js";
import type { GroceryStore } from "../../../domain/settings.js";
import { quantityUnitOptionLabel } from "../../display-quantity.js";
import { field } from "../../components/ui.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import { FD_BARCODE_SCAN_SHEET_ID } from "./scanner-sheet.js";

export const USUAL_ADD_SHEET_ID = "fd-usual-add";
export const USUAL_ADD_SCAN_PATH = "/kitchen/usuals/add/barcode";
/** What the shared scanner navigates to; `{code}` is the digits it read. */
export const USUAL_ADD_SCAN_TARGET = `${USUAL_ADD_SCAN_PATH}/{code}`;
export const USUAL_ADD_PRODUCT_PATH = "/kitchen/usuals/add/product";
export const USUAL_ADD_MANUAL_PATH = "/kitchen/usuals/add/manual";

export type UsualAddTab = "scan" | "search" | "type";

/** A food the scanned product could be filed under. */
export type UsualAddOption = {
    id: string;
    name: string;
    brand: string | null;
    /** "Filed under this" and the like, shown beside the name. */
    note?: string | null;
};

export type UsualAddScanView =
    | {
          kind: "found";
          code: string;
          product: { id: string; name: string; brand: string | null };
          /** The scanned row is a plain food itself: nothing to choose. */
          self: boolean;
          options: UsualAddOption[];
          /** A food id from `options`, or "new". Empty when `self`. */
          choice: string;
          newName: string;
          /** The food search in this step. */
          query: string;
          /** Store and amount as posted, kept across an error. */
          purchase: Record<string, string>;
      }
    | {
          kind: "miss";
          code: string;
          lookupFailed: boolean;
          /** Online lookups are switched off, so nothing was asked. */
          paused?: boolean;
      }
    | { kind: "invalid"; code: string };

export type UsualAddView = {
    tab: UsualAddTab;
    search?: { q: string; results: Food[]; truncated: boolean };
    scan?: UsualAddScanView;
    /** What the person typed, by form input name, kept across an error. */
    type?: { values: Record<string, string> };
    /** `field` is the form input name the message belongs under, or null. */
    error?: { message: string; field: string | null };
};

export type UsualAddCtx = {
    add?: UsualAddView;
    addable: readonly Food[];
    stores: readonly GroceryStore[];
    selectedStoreId?: string | null;
    returnTo: string;
    barcodeCamera: boolean;
};

const TABS: ReadonlyArray<{ id: UsualAddTab; label: string }> = [
    { id: "scan", label: "Scan" },
    { id: "search", label: "Search" },
    { id: "type", label: "Type it" },
];

const MACRO_FIELDS: ReadonlyArray<{
    name: string;
    label: string;
    placeholder: string;
}> = [
    { name: "calories", label: "Calories", placeholder: "kcal" },
    { name: "protein_g", label: "Protein (g)", placeholder: "g" },
    { name: "carbs_g", label: "Carbs (g)", placeholder: "g" },
    { name: "fat_g", label: "Fat (g)", placeholder: "g" },
];

const BASES: ReadonlyArray<{ value: string; label: string }> = [
    { value: "per_100g", label: "Per 100 g" },
    { value: "per_100ml", label: "Per 100 ml" },
    { value: "per_serving", label: "Per serving" },
];

const e = escapeHtml;

function sortedStores(stores: readonly GroceryStore[]): GroceryStore[] {
    return [...stores].sort((a, b) => a.name.localeCompare(b.name));
}

function errorId(name: string): string {
    return `${USUAL_ADD_SHEET_ID}-${name.replace(/_/g, "-")}-error`;
}

function fieldError(view: UsualAddView | undefined, name: string): string {
    if (view?.error?.field !== name) return "";
    return `<p class="fd-kitchen-sheet-error" id="${errorId(name)}" role="alert">${e(view.error.message)}</p>`;
}

/** The input names the form of the active step can show a message under. */
function fieldNames(view: UsualAddView): ReadonlySet<string> {
    if (view.scan?.kind === "found") return new Set(["food"]);
    if (view.tab === "type") {
        return new Set([
            "name",
            "calories",
            "protein_g",
            "carbs_g",
            "fat_g",
            "basis",
            "serving_amount",
            "serving_unit",
            "barcode",
        ]);
    }
    return new Set();
}

function sheetLevelError(view: UsualAddView | undefined): string {
    const error = view?.error;
    if (!error) return "";
    if (error.field && fieldNames(view).has(error.field)) return "";
    return `<p class="fd-kitchen-sheet-error" role="alert">${e(error.message)}</p>`;
}

function hidden(name: string, value: string): string {
    return `<input type="hidden" name="${e(name)}" value="${e(value)}" />`;
}

function textField(opts: {
    view: UsualAddView | undefined;
    name: string;
    label: string;
    value: string;
    inputmode?: "decimal";
    required?: boolean;
    placeholder?: string;
    type?: string;
}): string {
    const id = `${USUAL_ADD_SHEET_ID}-${opts.name.replace(/_/g, "-")}`;
    const invalid = opts.view?.error?.field === opts.name;
    const attrs = [
        `id="${id}"`,
        `name="${e(opts.name)}"`,
        `type="${opts.type ?? "text"}"`,
        opts.inputmode ? `inputmode="${opts.inputmode}"` : "",
        `autocomplete="off"`,
        `value="${e(opts.value)}"`,
        opts.placeholder ? `placeholder="${e(opts.placeholder)}"` : "",
        invalid
            ? `aria-invalid="true" aria-describedby="${errorId(opts.name)}"`
            : "",
        opts.required ? "required" : "",
    ]
        .filter(Boolean)
        .join(" ");
    return `<div class="fd-usual-add-field">${field({
        id,
        label: opts.label,
        control: `<input ${attrs} />`,
    })}${fieldError(opts.view, opts.name)}</div>`;
}

function choiceChip(opts: {
    name: string;
    value: string;
    label: string;
    checked: boolean;
    note?: string | null;
}): string {
    const note = opts.note
        ? `<span class="fd-usual-add-chip-note">${e(opts.note)}</span>`
        : "";
    return `<label class="fd-chip fd-chip--choice"><input class="fd-chip__input" type="radio" name="${e(opts.name)}" value="${e(opts.value)}"${opts.checked ? " checked" : ""}><span class="fd-chip__face"><span class="fd-chip__label">${e(opts.label)}</span>${note}</span></label>`;
}

/** Store chips and a "usually buy" amount: the same two the edit sheet has. */
function purchaseControls(
    stores: readonly GroceryStore[],
    values: Record<string, string>,
): string {
    const selected = values.usual_store_id ?? "";
    const chips = [
        { value: "", label: "Any store" },
        ...sortedStores(stores).map((s) => ({ value: s.id, label: s.name })),
    ]
        .map((o) =>
            choiceChip({
                name: "usual_store_id",
                value: o.value,
                label: o.label,
                checked: o.value === selected,
            }),
        )
        .join("");
    const unit = values.usual_unit ?? "";
    const units = [
        `<option value=""${unit === "" ? " selected" : ""}>No amount</option>`,
        ...FOOD_QUANTITY_UNITS.map(
            (u) =>
                `<option value="${e(u)}"${unit === u ? " selected" : ""}>${e(quantityUnitOptionLabel(u))}</option>`,
        ),
    ].join("");
    return `<p class="fd-kitchen-sheet-label">Store</p>
<fieldset class="fd-choice-group"><legend class="fd-sr">Store</legend><div class="fd-chips">${chips}</div></fieldset>
<p class="fd-kitchen-sheet-label">Usually buy</p>
<div class="fd-usual-add-amount">
<input class="fd-usual-add-amount__input" type="text" inputmode="decimal" autocomplete="off" name="usual_amount" value="${e(values.usual_amount ?? "")}" aria-label="Amount" placeholder="Amount" />
<select class="fd-kitchen-usual-unit" name="usual_unit" aria-label="Unit">${units}</select>
</div>`;
}

function brandSuffix(brand: string | null): string {
    return brand?.trim() ? ` · ${brand}` : "";
}

function tabButton(
    tab: { id: UsualAddTab; label: string },
    active: UsualAddTab,
) {
    const selected = tab.id === active;
    return `<button type="button" role="tab" class="fd-usual-add-tab" id="${USUAL_ADD_SHEET_ID}-tab-${tab.id}" data-fd-usual-add-tab="${tab.id}" aria-selected="${selected}" aria-controls="${USUAL_ADD_SHEET_ID}-panel-${tab.id}"${selected ? "" : ' tabindex="-1"'}>${e(tab.label)}</button>`;
}

function panel(id: UsualAddTab, active: UsualAddTab, body: string): string {
    return `<div class="fd-usual-add-panel" role="tabpanel" id="${USUAL_ADD_SHEET_ID}-panel-${id}" data-fd-usual-add-panel="${id}" aria-labelledby="${USUAL_ADD_SHEET_ID}-tab-${id}"${id === active ? "" : " hidden"}>
${body}
</div>`;
}

function scanTargetFor(ctx: UsualAddCtx): string {
    return ctx.selectedStoreId
        ? `${USUAL_ADD_SCAN_TARGET}?store=${encodeURIComponent(ctx.selectedStoreId)}`
        : USUAL_ADD_SCAN_TARGET;
}

function scanOpener(
    ctx: UsualAddCtx,
    opts: { label?: string; primary?: boolean } = {},
): string {
    const text =
        opts.label ??
        (ctx.barcodeCamera ? "Scan a barcode" : "Enter a barcode");
    const cls = opts.primary === false ? "fd-btn" : "fd-btn fd-btn--primary";
    return `<button type="button" class="${cls} fd-usual-add-scan" data-fd-open-sheet="${FD_BARCODE_SCAN_SHEET_ID}" data-fd-scanner-target="${e(scanTargetFor(ctx))}">${e(text)}</button>`;
}

function whatIsIt(
    ctx: UsualAddCtx,
    scan: Extract<UsualAddScanView, { kind: "found" }>,
): string {
    const view = ctx.add;
    const formId = `${USUAL_ADD_SHEET_ID}-what-form`;
    const product = `<div class="fd-usual-add-product"><p class="fd-usual-add-product__name">${e(scan.product.name)}</p>${scan.product.brand?.trim() ? `<p class="fd-usual-add-product__brand">${e(scan.product.brand)}</p>` : ""}<p class="fd-usual-add-product__code">${e(scan.code)}</p></div>`;
    const find = `<form method="get" action="${e(`${USUAL_ADD_SCAN_PATH}/${encodeURIComponent(scan.code)}`)}" class="fd-usual-add-find">
${ctx.selectedStoreId ? hidden("store", ctx.selectedStoreId) : ""}
<input type="search" name="fq" autocomplete="off" value="${e(scan.query)}" placeholder="Search your foods" aria-label="Search your foods" />
<button type="submit" class="fd-btn">Find</button>
</form>`;
    let choose = "";
    if (scan.self) {
        choose = `<p class="fd-usual-add-note">This is already one of your foods. It will be added as it is.</p>`;
    } else {
        const chips = [
            ...scan.options.map((o) =>
                choiceChip({
                    name: "food_choice",
                    value: o.id,
                    label: `${o.name}${brandSuffix(o.brand)}`,
                    checked: scan.choice === o.id,
                    note: o.note,
                }),
            ),
            choiceChip({
                name: "food_choice",
                value: "new",
                label: "A new food",
                checked: scan.choice === "new",
            }),
        ].join("");
        choose = `<p class="fd-kitchen-sheet-label">Which food is it?</p>
<fieldset class="fd-choice-group" aria-describedby="${errorId("food")}"><legend class="fd-sr">Which food is it?</legend><div class="fd-chips fd-chips--stack">${chips}</div></fieldset>
${fieldError(view, "food")}
<div class="fd-usual-add-field"><input type="text" name="new_food_name" autocomplete="off" value="${e(scan.newName)}" aria-label="Name for a new food" placeholder="Name for a new food" data-fd-usual-add-newname /></div>`;
    }
    const values = scan.purchase;
    return `<h3 class="fd-usual-add-step">What is it?</h3>
${product}
${scan.self ? "" : find}
<form id="${formId}" method="post" action="${USUAL_ADD_PRODUCT_PATH}" class="fd-kitchen-usual-sheet-form">
${hidden("return_to", ctx.returnTo)}
${hidden("product_id", scan.product.id)}
${hidden("scan_code", scan.code)}
${choose}
${purchaseControls(ctx.stores, values)}
<button type="submit" class="fd-btn fd-btn--primary">Add usual</button>
</form>
<p class="fd-usual-add-hint">${scanOpener(ctx, { label: "Scan another", primary: false })}</p>`;
}

function scanPanel(ctx: UsualAddCtx): string {
    const scan = ctx.add?.scan;
    if (scan?.kind === "found") return whatIsIt(ctx, scan);
    const invalid =
        scan?.kind === "invalid"
            ? `<p class="fd-kitchen-sheet-error" role="alert">That isn't a barcode. Check the number and try again.</p>`
            : "";
    const lead = ctx.barcodeCamera
        ? "Point your camera at a product's barcode. Foodable fills in what it is."
        : "Type the number under a product's barcode. Foodable fills in what it is.";
    return `${invalid}<p class="fd-usual-add-lead">${e(lead)}</p>
${scanOpener(ctx)}`;
}

function searchPanel(ctx: UsualAddCtx): string {
    const search = ctx.add?.search;
    if (ctx.addable.length === 0) {
        return `<p class="fd-kitchen-usual-add__empty">Nothing to add from your foods. Scan it or type it in.</p>`;
    }
    const form = `<form method="get" action="/kitchen/usuals" class="fd-kitchen-usual-add-form">
${ctx.selectedStoreId ? hidden("store", ctx.selectedStoreId) : ""}
${field({
    id: "fd-usual-add-q",
    label: "Food",
    control: `<input id="fd-usual-add-q" name="q" type="search" autocomplete="off" value="${e(search?.q ?? "")}" />`,
})}
<button type="submit" class="fd-btn fd-btn--primary">Search</button>
</form>`;
    if (!search) return form;
    if (search.results.length === 0) {
        return `${form}<p class="fd-kitchen-usual-add__empty">No matching food.</p>`;
    }
    const rows = search.results
        .map(
            (food) =>
                `<li class="fd-kitchen-usual-add__result"><span class="fd-kitchen-usual-add__choose"><span class="fd-kitchen-usual-add__name">${e(food.name)}</span>${food.brand ? `<span class="fd-kitchen-usual-add__brand">${e(food.brand)}</span>` : ""}</span><form method="post" action="${USUAL_ADD_PRODUCT_PATH}" class="fd-inline-form">${hidden("return_to", ctx.returnTo)}${hidden("via", "search")}${hidden("q", search.q)}${hidden("product_id", food.id)}${hidden("food_choice", food.id)}<button type="submit" class="fd-btn fd-btn--sm" aria-label="Add ${e(food.name)} as a usual">Add</button></form></li>`,
        )
        .join("");
    return `${form}<ul class="fd-kitchen-usual-add__results">${rows}</ul>${search.truncated ? `<p class="fd-kitchen-usual-add__hint">Showing the first 20. Type more to narrow it.</p>` : ""}`;
}

function typePanel(ctx: UsualAddCtx): string {
    const view = ctx.add;
    const values = view?.type?.values ?? {};
    const miss = view?.scan?.kind === "miss" ? view.scan : null;
    const barcode = values.barcode ?? miss?.code ?? "";
    const basis = values.basis || "per_100g";
    const note = miss
        ? `<p class="fd-usual-add-note">${miss.paused ? "Online food lookups are paused, so this barcode was not looked up." : miss.lookupFailed ? "Could not look this barcode up." : "No product found for this barcode."} Type it in and Foodable will know it by ${e(miss.code)} next time.</p>`
        : "";
    const macros = MACRO_FIELDS.map((m) =>
        textField({
            view,
            name: m.name,
            label: m.label,
            value: values[m.name] ?? "",
            inputmode: "decimal",
            required: true,
            placeholder: m.placeholder,
        }),
    ).join("");
    const bases = BASES.map((b) =>
        choiceChip({
            name: "basis",
            value: b.value,
            label: b.label,
            checked: basis === b.value,
        }),
    ).join("");
    const servingUnit = values.serving_unit || "g";
    return `${note}<form id="${USUAL_ADD_SHEET_ID}-type-form" method="post" action="${USUAL_ADD_MANUAL_PATH}" class="fd-kitchen-usual-sheet-form">
${hidden("return_to", ctx.returnTo)}
${barcode ? hidden("barcode", barcode) : ""}
${textField({ view, name: "name", label: "Name", value: values.name ?? "", required: true })}
<p class="fd-kitchen-sheet-label">The numbers below are</p>
<fieldset class="fd-choice-group"><legend class="fd-sr">The numbers are per</legend><div class="fd-chips">${bases}</div></fieldset>
${fieldError(view, "basis")}
<div class="fd-usual-add-serving">
${textField({ view, name: "serving_amount", label: "Serving size", value: values.serving_amount ?? "", inputmode: "decimal", placeholder: "Only for per serving" })}
<select class="fd-kitchen-usual-unit" name="serving_unit" aria-label="Serving unit"><option value="g"${servingUnit === "g" ? " selected" : ""}>g</option><option value="ml"${servingUnit === "ml" ? " selected" : ""}>ml</option></select>
</div>
${fieldError(view, "serving_unit")}
<div class="fd-usual-add-macros">${macros}</div>
${fieldError(view, "barcode")}
${purchaseControls(ctx.stores, values)}
<button type="submit" class="fd-btn fd-btn--primary">Add usual</button>
</form>`;
}

export function addUsualSheet(ctx: UsualAddCtx): string {
    const active: UsualAddTab = ctx.add?.tab ?? "scan";
    const tabs = `<div class="fd-usual-add-tabs" role="tablist" aria-label="Ways to add a usual">${TABS.map((t) => tabButton(t, active)).join("")}</div>`;
    const body = `${sheetLevelError(ctx.add)}${tabs}
${panel("scan", active, scanPanel(ctx))}
${panel("search", active, searchPanel(ctx))}
${panel("type", active, typePanel(ctx))}`;
    return sheet({
        id: USUAL_ADD_SHEET_ID,
        kind: "edit",
        title: "Add a usual",
        body,
        openOnLoad: ctx.add != null,
        focus: "panel",
    });
}

/** The page's "Add a usual" button: always shown, even with nothing to search. */
export function addUsualTrigger(): string {
    return sheetTrigger({
        target: USUAL_ADD_SHEET_ID,
        label: "Add a usual",
        className: "fd-kitchen-usual-add-btn",
    });
}

/** What the person asked of the What is it? step. */
export type UsualAddFound = {
    code: string;
    productId: string;
    /** A food id or "new", when the person already chose (an error re-render). */
    choice?: string;
    newName?: string;
    /** Their search of foods. */
    query?: string;
    /** The store and amount they picked, by form input name. */
    purchase?: Record<string, string>;
};

/**
 * The What is it? step for a scanned product: the food it is already filed
 * under first, then foods whose names match the search (or, with none, the
 * product's own name), best first, then "a new food". Null when the product is
 * gone from the catalog.
 */
export function usualAddFoundView(
    found: UsualAddFound,
    foods: readonly Food[],
    aliases: ReadonlyMap<string, string[]>,
): Extract<UsualAddScanView, { kind: "found" }> | null {
    const byId = new Map(foods.map((f) => [f.id, f]));
    const product = byId.get(found.productId);
    if (!product || product.archivedAt) return null;
    const self = isPlainFoodRow(product);
    const query = found.query?.trim() ?? "";
    const { filed, matches } = suggestUsualFoods(
        product,
        foods,
        aliases,
        query,
    );
    const options: UsualAddOption[] = [];
    if (filed) {
        options.push({
            id: filed.id,
            name: filed.name,
            brand: filed.brand,
            note: "Filed under this",
        });
    }
    for (const food of matches) {
        options.push({ id: food.id, name: food.name, brand: food.brand });
    }
    let choice = found.choice;
    if (choice && choice !== "new" && !options.some((o) => o.id === choice)) {
        const chosen = byId.get(choice);
        if (chosen && !chosen.archivedAt && isPlainFoodRow(chosen)) {
            options.unshift({
                id: chosen.id,
                name: chosen.name,
                brand: chosen.brand,
            });
        } else {
            choice = undefined;
        }
    }
    return {
        kind: "found",
        code: found.code,
        product: { id: product.id, name: product.name, brand: product.brand },
        self,
        options,
        choice: self ? "" : (choice ?? options[0]?.id ?? "new"),
        newName: found.newName ?? nameWithoutBrand(product.name, product.brand),
        query,
        purchase: found.purchase ?? {},
    };
}
