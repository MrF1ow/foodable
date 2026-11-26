/**
 * Kitchen › Usuals › Add a usual: one sheet with three ways in, the design's
 * three quick actions. Scan a barcode hands the number to the shared scanner
 * (or, with `barcode-camera` off, its number field) and, once it resolves, asks
 * "What is it?"; Search your foods lists foods that are not usuals yet; Type it
 * takes a name and its macros. The sheet only renders what it is given: the
 * routes decide the state, the domain (`src/domain/usual-add.ts`) does the work.
 */
import type { Food, UsualAmount } from "../../../domain/foods.js";
import {
    isPlainFoodRow,
    nameWithoutBrand,
    suggestUsualFoods,
} from "../../../domain/usual-add.js";
import { FOOD_QUANTITY_UNITS } from "../../../domain/quantity.js";
import type { GroceryStore } from "../../../domain/settings.js";
import { quantityUnitOptionLabel } from "../../display-quantity.js";
import { button } from "../../components/v2/button.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { field } from "../../components/v2/field.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menuRow } from "../../components/v2/menu.js";
import { quickAction } from "../../components/v2/quick-action.js";
import { searchField } from "../../components/v2/search-field.js";
import { segmented } from "../../components/v2/segmented.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepperControl } from "../../components/v2/stepper-control.js";
import { kitchenAddButton } from "./kitchen-head.js";
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
    /** The usual amount the food has now; null when it has none. */
    usualAmount?: UsualAmount | null;
    /** The store its usual is bought at now; null when it has none. */
    usualStoreId?: string | null;
};

export type UsualAddScanView =
    | {
          kind: "found";
          code: string;
          product: {
              id: string;
              name: string;
              brand: string | null;
              usualAmount?: UsualAmount | null;
              usualStoreId?: string | null;
          };
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
    selectedStoreIds?: readonly string[];
    /**
     * The foods Type it can name again, by lower-cased name, with the usual
     * amount each has (null when it has none).
     */
    known?: Readonly<Record<string, UsualAmount | null>>;
    returnTo: string;
    barcodeCamera: boolean;
};

/** How many foods the Search list shows before it is narrowed. */
const FIRST_FOODS = 20;

const MACRO_FIELDS: ReadonlyArray<{
    name: string;
    label: string;
    placeholder: string;
}> = [
    { name: "calories", label: "Calories", placeholder: "kcal" },
    { name: "protein_g", label: "Protein g", placeholder: "g" },
    { name: "carbs_g", label: "Carbs g", placeholder: "g" },
    { name: "fat_g", label: "Fat g", placeholder: "g" },
];

const BASES: ReadonlyArray<{ value: string; label: string }> = [
    { value: "per_100g", label: "Per 100 g" },
    { value: "per_100ml", label: "Per 100 ml" },
    { value: "per_serving", label: "Per serving" },
];

const e = esc;

/**
 * The amount and unit the sheet offers. A food that already has a usual amount
 * offers that one, so adding it never changes what a person set without their
 * seeing it; a food without one offers none; only a new food starts at one
 * each.
 */
export function usualPurchaseDefaults(
    existing: { usualAmount: UsualAmount | null } | null,
): Record<string, string> {
    if (!existing) return { usual_amount: "1", usual_unit: "each" };
    const usual = existing.usualAmount;
    return usual
        ? { usual_amount: String(usual.amount), usual_unit: usual.unit }
        : { usual_amount: "", usual_unit: "" };
}

/** The key Type it looks a typed name up by. */
export function usualNameKey(name: string): string {
    return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Every food of `foods` by name key, for the Type it form's prefill. */
export function knownUsualAmounts(
    foods: readonly Pick<Food, "name" | "usualAmount">[],
): Record<string, UsualAmount | null> {
    const known: Record<string, UsualAmount | null> = {};
    for (const food of foods) known[usualNameKey(food.name)] = food.usualAmount;
    return known;
}

/** The usual amount as a row's `data-*`, for the script that fills the stepper. */
function amountData(values: Record<string, string>): Record<string, string> {
    return {
        "fd-usual-amount": values.usual_amount ?? "",
        "fd-usual-unit": values.usual_unit ?? "",
    };
}

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

/**
 * The store the list is filtered to when it is exactly one, offered as the
 * usual's store so what is added does not vanish from the filtered list. A
 * food that already has a store keeps it (`existing` is that store, if any).
 */
function filterStoreDefault(
    ctx: UsualAddCtx,
    existing: string | null | undefined,
): Record<string, string> {
    const ids = ctx.selectedStoreIds ?? [];
    const only = ids.length === 1 ? ids[0]! : "";
    if (only === "" || existing != null) return {};
    return ctx.stores.some((s) => s.id === only)
        ? { usual_store_id: only }
        : {};
}

/** The stores the list is filtered to, as the one `store` value the routes read. */
function storeParam(ctx: UsualAddCtx): string {
    const ids = (ctx.selectedStoreIds ?? []).join(",");
    return ids === "" ? "" : hidden("store", ids);
}

function textField(opts: {
    view: UsualAddView | undefined;
    name: string;
    label: string;
    value: string;
    inputmode?: "decimal";
    required?: boolean;
    placeholder?: string;
    labelHidden?: boolean;
    inputData?: Readonly<Record<string, string>>;
}): string {
    const id = `${USUAL_ADD_SHEET_ID}-${opts.name.replace(/_/g, "-")}`;
    const invalid = opts.view?.error?.field === opts.name;
    return `<div class="fd-usual-add-field">${field({
        id,
        label: opts.label,
        labelHidden: opts.labelHidden,
        name: opts.name,
        value: opts.value,
        inputmode: opts.inputmode,
        required: opts.required,
        placeholder: opts.placeholder,
        inputData: opts.inputData,
        autocomplete: "off",
        ...(invalid ? { error: opts.view?.error?.message } : {}),
    })}</div>`;
}

/** A radio row the page script reads: the whole row is the label. */
function choiceRow(opts: {
    name: string;
    value: string;
    title: string;
    subtitle?: string;
    checked: boolean;
    attrs?: Record<string, string>;
}): Html {
    return itemRow({
        title: opts.title,
        subtitle: opts.subtitle,
        lead: {
            kind: "radio",
            label: opts.title,
            name: opts.name,
            value: opts.value,
            checked: opts.checked,
        },
        data: opts.attrs,
    });
}

/** Store and "usually buy": the same two the edit sheet has, as pull-downs and a stepper. */
function purchaseControls(
    stores: readonly GroceryStore[],
    values: Record<string, string>,
): string {
    const selected = values.usual_store_id ?? "";
    const storeChoices = [
        { value: "", label: "Any store" },
        ...sortedStores(stores).map((s) => ({ value: s.id, label: s.name })),
    ];
    const storeNow =
        storeChoices.find((c) => c.value === selected) ?? storeChoices[0]!;
    const unit = values.usual_unit ?? "each";
    const unitChoices = [
        { value: "", label: "No amount" },
        ...FOOD_QUANTITY_UNITS.map((u) => ({
            value: u,
            label: quantityUnitOptionLabel(u),
        })),
    ];
    const unitNow =
        unitChoices.find((c) => c.value === unit) ?? unitChoices[1]!;
    const pulldown = (
        title: string,
        name: string,
        now: { value: string; label: string },
        choices: { value: string; label: string }[],
    ) =>
        menuRow({
            label: title,
            row: { title, value: now.label },
            field: { name, value: now.value },
            items: choices.map((choice) => ({
                kind: "checked" as const,
                label: choice.label,
                checked: choice.value === now.value,
                value: choice.value,
            })),
        });
    const amount = Number(values.usual_amount);
    return `${sheetSection({
        kind: "amount",
        label: "Usually buy",
        content: raw(
            `${stepperControl({
                name: "usual_amount",
                label: "Amount",
                value: Number.isFinite(amount) && amount > 0 ? amount : 1,
                min: 0,
                step: 1,
                inputStep: "any",
                unit: unitNow.value === "" ? "" : unitNow.label,
                id: `${USUAL_ADD_SHEET_ID}-amount-${stores.length}`,
            })}`,
        ),
    })}${sheetSection({
        kind: "rows",
        content: listGroup({
            label: "Usual purchase",
            rows: [
                pulldown("Unit", "usual_unit", unitNow, unitChoices),
                pulldown("Store", "usual_store_id", storeNow, storeChoices),
            ],
        }),
    })}`;
}

function brandSuffix(brand: string | null): string {
    return brand?.trim() ? ` · ${brand}` : "";
}

function panel(id: UsualAddTab, active: UsualAddTab, body: string): string {
    return `<div class="fd-usual-add-panel" data-fd-usual-add-panel="${id}"${id === active ? "" : " hidden"}>
${body}
</div>`;
}

function scanTargetFor(ctx: UsualAddCtx): string {
    const ids = (ctx.selectedStoreIds ?? []).join(",");
    return ids === ""
        ? USUAL_ADD_SCAN_TARGET
        : `${USUAL_ADD_SCAN_TARGET}?store=${encodeURIComponent(ids)}`;
}

/** The three ways in, drawn as the design's quick actions. */
function ways(ctx: UsualAddCtx): string {
    return `${[
        quickAction({
            label: ctx.barcodeCamera ? "Scan a barcode" : "Enter a barcode",
            icon: "scan",
            data: {
                "fd-open-sheet": FD_BARCODE_SCAN_SHEET_ID,
                "fd-scanner-target": scanTargetFor(ctx),
            },
        }),
        quickAction({
            label: "Search your foods",
            icon: "search",
            data: { "fd-usual-add-tab": "search" },
        }),
        quickAction({
            label: "Type it",
            icon: "plus",
            data: { "fd-usual-add-tab": "type" },
        }),
    ].join("")}`;
}

/** What the scanned product's food has now: the chosen one, or the product itself. */
function foundDefaults(
    scan: Extract<UsualAddScanView, { kind: "found" }>,
    ctx: UsualAddCtx,
): Record<string, string> {
    const chosen = scan.self
        ? scan.product
        : scan.options.find((o) => o.id === scan.choice);
    return {
        ...usualPurchaseDefaults(
            chosen ? { usualAmount: chosen.usualAmount ?? null } : null,
        ),
        ...filterStoreDefault(ctx, chosen ? chosen.usualStoreId : null),
    };
}

function whatIsIt(
    ctx: UsualAddCtx,
    scan: Extract<UsualAddScanView, { kind: "found" }>,
): string {
    const view = ctx.add;
    const formId = `${USUAL_ADD_SHEET_ID}-what-form`;
    const product = listGroup({
        label: "Scanned product",
        rows: [
            itemRow({
                title: scan.product.name,
                subtitle: [scan.product.brand?.trim(), scan.code]
                    .filter(Boolean)
                    .join(" · "),
                lead: { kind: "icon", name: "scan" },
            }),
        ],
    });
    const find = `<form method="get" action="${e(`${USUAL_ADD_SCAN_PATH}/${encodeURIComponent(scan.code)}`)}">${storeParam(ctx)}${String(
        searchField({
            label: "Search your foods",
            placeholder: "Search your foods",
            name: "fq",
            value: scan.query,
            style: "boxed",
            go: true,
        }),
    )}</form>`;
    let choose = "";
    if (scan.self) {
        choose = `<p class="fd-usual-add-note">This is already one of your foods. It will be added as it is.</p>`;
    } else {
        const rows = [
            ...scan.options.map((o) =>
                choiceRow({
                    name: "food_choice",
                    value: o.id,
                    title: `${o.name}${brandSuffix(o.brand)}`,
                    subtitle: o.note ?? undefined,
                    checked: scan.choice === o.id,
                    attrs: amountData(
                        usualPurchaseDefaults({
                            usualAmount: o.usualAmount ?? null,
                        }),
                    ),
                }),
            ),
            choiceRow({
                name: "food_choice",
                value: "new",
                title: "A new food",
                checked: scan.choice === "new",
                attrs: amountData(usualPurchaseDefaults(null)),
            }),
        ];
        choose = `${String(
            sheetSection({
                kind: "choice",
                label: "Which food is it?",
                content: listGroup({ rows, label: "Which food is it?" }),
            }),
        )}${fieldError(view, "food")}${String(
            sheetSection({
                kind: "fields",
                content: raw(
                    textField({
                        view: undefined,
                        name: "new_food_name",
                        label: "Name for a new food",
                        value: scan.newName,
                        labelHidden: true,
                        placeholder: "Name for a new food",
                        inputData: { "fd-usual-add-newname": "" },
                    }),
                ),
            }),
        )}`;
    }
    return `${sheetSection({ kind: "rows", label: "What is it?", content: product })}
${scan.self ? "" : find}
<form id="${formId}" method="post" action="${USUAL_ADD_PRODUCT_PATH}">
${hidden("return_to", ctx.returnTo)}
${hidden("product_id", scan.product.id)}
${hidden("scan_code", scan.code)}
${choose}
${purchaseControls(ctx.stores, { ...foundDefaults(scan, ctx), ...scan.purchase })}
${String(button({ label: "Add usual", variant: "primary", type: "submit" }))}
</form>`;
}

function scanPanel(ctx: UsualAddCtx): string {
    const scan = ctx.add?.scan;
    if (scan?.kind === "found") return whatIsIt(ctx, scan);
    if (scan?.kind === "invalid") {
        return `<p class="fd-kitchen-sheet-error" role="alert">That isn't a barcode. Check the number and try again.</p>`;
    }
    return "";
}

/** One food of the Search list: its name, and a plus that adds it as a usual. */
function foodRow(food: Food, ctx: UsualAddCtx, q: string): Html {
    return itemRow({
        title: food.name,
        subtitle: food.brand?.trim() || "In your foods",
        trailing: {
            kind: "add",
            label: `Add ${food.name} as a usual`,
            form: {
                action: USUAL_ADD_PRODUCT_PATH,
                fields: {
                    return_to: ctx.returnTo,
                    via: "search",
                    q,
                    product_id: food.id,
                    food_choice: food.id,
                    ...filterStoreDefault(ctx, food.usualStoreId),
                },
            },
        },
        data: {
            "fd-usual-food": `${food.name} ${food.brand ?? ""}`
                .trim()
                .toLowerCase(),
        },
    });
}

function searchPanel(ctx: UsualAddCtx): string {
    const search = ctx.add?.search;
    if (ctx.addable.length === 0) {
        return String(
            sheetSection({
                kind: "empty",
                text: "Nothing to add from your foods. Scan it or type it in.",
            }),
        );
    }
    const form = `<form method="get" action="/kitchen/usuals" class="fd-usual-add-find">${storeParam(ctx)}${String(
        searchField({
            label: "Search your foods",
            placeholder: "Search your foods",
            name: "q",
            id: "fd-usual-add-q",
            value: search?.q ?? "",
            style: "boxed",
        }),
    )}</form>`;
    const foods = search ? search.results : ctx.addable.slice(0, FIRST_FOODS);
    const truncated = search
        ? search.truncated
        : ctx.addable.length > FIRST_FOODS;
    if (search && foods.length === 0) {
        return `${form}${String(sheetSection({ kind: "empty", text: "No matching food." }))}`;
    }
    const rows = foods.map((food) => foodRow(food, ctx, search?.q ?? ""));
    return `${form}${String(
        sheetSection({
            kind: "results",
            content: raw(
                `${sectionHeader({ label: "Your foods", rule: false })}${listGroup({ rows, label: "Your foods" })}<p class="fd-usual-add-none" data-fd-usual-none hidden>No matching food.</p>${truncated ? `<p class="fd-usual-add-hint" data-fd-usual-more>Showing the first ${FIRST_FOODS}. Type more to narrow it.</p>` : ""}`,
            ),
        }),
    )}`;
}

/** What a typed name offers: the amount of the food it names, else one each. */
function typeDefaults(ctx: UsualAddCtx, name: string): Record<string, string> {
    const key = usualNameKey(name);
    const named = ctx.known != null && Object.hasOwn(ctx.known, key);
    return {
        ...usualPurchaseDefaults(
            named ? { usualAmount: ctx.known![key] ?? null } : null,
        ),
        // A name already in the catalog may have a store of its own: leave it.
        ...(named ? {} : filterStoreDefault(ctx, null)),
    };
}

function typePanel(ctx: UsualAddCtx): string {
    const view = ctx.add;
    const values = view?.type?.values ?? {};
    const miss = view?.scan?.kind === "miss" ? view.scan : null;
    const barcode = values.barcode ?? miss?.code ?? "";
    const basis = values.basis || "per_100g";
    // The names a typed name can match, for the script that fills the amount.
    const known =
        ctx.known != null && Object.keys(ctx.known).length > 0
            ? ` data-fd-usual-known="${e(
                  JSON.stringify(
                      Object.fromEntries(
                          Object.entries(ctx.known).map(([name, usual]) => [
                              name,
                              usual ? [usual.amount, usual.unit] : ["", ""],
                          ]),
                      ),
                  ),
              )}"`
            : "";
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
    const bases = segmented({
        label: "The numbers below are",
        name: "basis",
        segments: BASES.map((b) => ({
            label: b.label,
            value: b.value,
            selected: basis === b.value,
        })),
    });
    const servingUnit = values.serving_unit || "g";
    const serving = segmented({
        label: "Serving unit",
        name: "serving_unit",
        size: "small",
        segments: [
            { label: "g", value: "g", selected: servingUnit === "g" },
            { label: "ml", value: "ml", selected: servingUnit === "ml" },
        ],
    });
    const back = `<p class="fd-usual-add-back">${String(button({ label: "Back to the other ways", variant: "link", type: "button", attrs: { "data-fd-usual-add-tab": "search" } }))}</p>`;
    return `${back}${note}<form id="${USUAL_ADD_SHEET_ID}-type-form" method="post" action="${USUAL_ADD_MANUAL_PATH}" class="fd-usual-add-type"${known}>
${hidden("return_to", ctx.returnTo)}
${barcode ? hidden("barcode", barcode) : ""}
${sheetSection({ kind: "fields", label: "What is it?", content: raw(textField({ view, name: "name", label: "Name", value: values.name ?? "", required: true, labelHidden: true })) })}
${sheetSection({ kind: "choice", content: bases })}
${fieldError(view, "basis")}
<div class="fd-usual-add-serving">${sheetSection({
        kind: "fields",
        label: "Serving size",
        content: raw(
            `<div class="fd-usual-add-serving__row">${textField({ view, name: "serving_amount", label: "Serving size", value: values.serving_amount ?? "", inputmode: "decimal", placeholder: "Amount", labelHidden: true })}${serving}</div>`,
        ),
    })}${fieldError(view, "serving_unit")}</div>
${sheetSection({ kind: "fields", content: raw(`<div class="fd-usual-add-macros">${macros}</div>`) })}
${fieldError(view, "barcode")}
${purchaseControls(ctx.stores, { ...typeDefaults(ctx, values.name ?? ""), ...values })}
${String(button({ label: "Add usual", variant: "primary", type: "submit" }))}
</form>`;
}

export function addUsualSheet(ctx: UsualAddCtx): string {
    const active: UsualAddTab = ctx.add?.tab ?? "search";
    const scan = scanPanel(ctx);
    // Type it shows its form alone; the tiles come back with Back.
    const body = `${sheetLevelError(ctx.add)}<div data-fd-usual-add-tiles${active === "type" ? " hidden" : ""}>${sheetSection({ kind: "tiles", content: raw(ways(ctx)) })}</div>
${scan ? panel("scan", active, scan) : ""}
${panel("search", active, searchPanel(ctx))}
${panel("type", active, typePanel(ctx))}`;
    return sheet({
        id: USUAL_ADD_SHEET_ID,
        // A side panel at 1024 px and up, as 663648 and 664580 draw it.
        placement: "side",
        className: "fd-kitchen-sheet fd-usual-add",
        header: { kind: "title", title: "Add a usual" },
        body: raw(body),
        openOnLoad: ctx.add != null,
        focus: "panel",
    });
}

/** The page's add buttons: always shown, even with nothing to search. */
export function addUsualButton() {
    return kitchenAddButton({
        target: USUAL_ADD_SHEET_ID,
        label: "Add a usual",
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
            usualAmount: filed.usualAmount,
            usualStoreId: filed.usualStoreId,
        });
    }
    for (const food of matches) {
        options.push({
            id: food.id,
            name: food.name,
            brand: food.brand,
            usualAmount: food.usualAmount,
            usualStoreId: food.usualStoreId,
        });
    }
    let choice = found.choice;
    if (choice && choice !== "new" && !options.some((o) => o.id === choice)) {
        const chosen = byId.get(choice);
        if (chosen && !chosen.archivedAt && isPlainFoodRow(chosen)) {
            options.unshift({
                id: chosen.id,
                name: chosen.name,
                brand: chosen.brand,
                usualAmount: chosen.usualAmount,
                usualStoreId: chosen.usualStoreId,
            });
        } else {
            choice = undefined;
        }
    }
    return {
        kind: "found",
        code: found.code,
        product: {
            id: product.id,
            name: product.name,
            brand: product.brand,
            usualAmount: product.usualAmount,
            usualStoreId: product.usualStoreId,
        },
        self,
        options,
        choice: self ? "" : (choice ?? options[0]?.id ?? "new"),
        newName: found.newName ?? nameWithoutBrand(product.name, product.brand),
        query,
        purchase: found.purchase ?? {},
    };
}
