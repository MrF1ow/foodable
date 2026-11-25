import type { GroceryLine } from "../../../domain/grocery.js";
import type { AppChromeBase } from "../../attention.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import {
    didYouMeanModalBlock,
    type DidYouMeanModal,
} from "../../components/did-you-mean.js";
import type { Notice } from "../../../domain/notices.js";
import { button } from "../../components/v2/button.js";
import { chip } from "../../components/v2/chip.js";
import { choiceGroup } from "../../components/v2/chips.js";
import {
    CONFIRM_ARM_ATTRS,
    CONFIRM_IDLE_ATTRS,
    confirmButtons,
} from "../../components/v2/confirm-row.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepperControl } from "../../components/v2/stepper-control.js";
import type { AlreadyHaveTag } from "../../../domain/linking.js";
import type { StoreRule } from "../../../domain/rules.js";
import type { GrocerySection, GroceryStore } from "../../../domain/settings.js";
import { renderAppShell } from "../../shell.js";
import { settingsErrorBanner } from "./settings-shared.js";
import {
    kitchenAddButton,
    kitchenTopTools,
    renderKitchenHead,
} from "./kitchen-head.js";
import { selectionBars } from "./select-mode.js";
import {
    noticeSentence,
    UNKNOWN_ALLERGEN_TEXT,
} from "../../../copy/notices.js";
import { GROCERY_SHARE_SHEET_ID, renderShareSheet } from "./share-sheet.js";
import type { FridgeAddUsual } from "./kitchen-fridge.js";

export type GroceryLineView = GroceryLine & {
    notices?: Notice[];
    alreadyHave: AlreadyHaveTag | null;
    lastLocationId?: string | null;
    usualProductName?: string | null;
    usualPickerHref?: string | null;
    putAwayProducts?: Array<{ id: string; label: string }> | null;
    putAwayProductId?: string | null;
};

export type GrocerySectionView = GrocerySection & {
    lines: GroceryLineView[];
};

export type GroceryStoreView = GroceryStore & {
    sections: GrocerySectionView[];
    rules: StoreRule[];
};

/** Fields to replay on "Add anyway" after a blocking allergen warning. */
export type GroceryAllergenRetry = {
    storeId: string;
    fields: Record<string, string>;
    /** The food the add was for, so the warning can name it. */
    foodName?: string;
};

/** A usual the Add sheet offers: one tap puts its usual amount on the list. */
export type GroceryAddUsual = FridgeAddUsual & {
    /** The level it is running low below ("6"), when it is. */
    lowBelow?: string;
    /** What is left of it ("3 left"), when the stock is known. */
    lowLeft?: string;
    /** The store its own settings send it to, when it has one. */
    storeName?: string;
};

export const GROCERY_V2_RETURN_TO = "/kitchen/groceries";
export const FD_GROCERY_PUT_AWAY_SHEET_ID = "fd-grocery-put-away";
export const FD_GROCERY_ADD_SHEET_ID = "fd-grocery-add";
const GROCERY_ADD_FOOD_PREFIX = "grocery-add-food-";
const CLEAR_CHECKED_ACTION = "/kitchen/groceries/clear-checked";
const ADD_LINE_ACTION = "/kitchen/groceries/lines";
const CLEAR_FORM_ID = "fd-grocery-clear-form";

/**
 * Where an action comes back to: the list with the stores it was filtered to
 * (a store id each) and, for a pull-down in a line's sheet, the line, so the
 * sheet is open again on the new value.
 */
export function groceryV2ReturnTo(
    selected?: readonly string[] | string | null,
    lineId?: string | null,
): string {
    const ids = typeof selected === "string" ? [selected] : (selected ?? []);
    const query = [
        ...ids.filter(Boolean).map((id) => `store=${encodeURIComponent(id)}`),
        ...(lineId ? [`line=${encodeURIComponent(lineId)}`] : []),
    ];
    return query.length === 0
        ? GROCERY_V2_RETURN_TO
        : `${GROCERY_V2_RETURN_TO}?${query.join("&")}`;
}

export type KitchenGroceriesLineMeta = {
    plainFoodName: string | null;
    isUsual: boolean;
    allergenWarning: string | null;
    storeName: string;
    sectionName: string;
    productScore?: number | null;
};

export type PutAwayDraft = Record<
    string,
    {
        locationId?: string;
        expiresOn?: string;
        putAwayAmount?: string;
        productFoodId?: string;
    }
>;

export type KitchenGroceriesV2View = {
    chrome: AppChromeBase;
    stores: GroceryStoreView[];
    noStoreLines: GroceryLineView[];
    checkedLines: GroceryLineView[];
    locations: { id: string; name: string }[];
    lineMeta: ReadonlyMap<string, KitchenGroceriesLineMeta>;
    openLineCount: number;
    /** The stores the list is filtered to; none is every store. */
    selectedStoreIds?: readonly string[];
    error?: string;
    unknownAllergen?: boolean;
    openLineId?: string;
    openPutAway?: boolean;
    putAwayDraft?: PutAwayDraft;
    openAdd?: boolean;
    /**
     * Whether the page offers Share (the `mcp-share-links` flag). Absent or
     * false leaves the menu item and the sheet out.
     */
    shareEnabled?: boolean;
    /** A refused Share post re-renders the page with the Share sheet open. */
    openShare?: boolean;
    addStoreId?: string | null;
    allergenNotices?: Notice[];
    allergenRetry?: GroceryAllergenRetry;
    didYouMean?: DidYouMeanModal;
    /** The usuals not on the list yet, for the Add sheet. */
    usuals?: readonly GroceryAddUsual[];
};

export type GroceryV2SectionGroup = {
    section: { id: string; name: string };
    lines: GroceryLineView[];
};

export type GroceryV2StoreGroup = {
    storeId: string;
    storeName: string;
    sections: GroceryV2SectionGroup[];
};

export function groceryLineSheetId(lineId: string): string {
    return `fd-grocery-line-${lineId}`;
}

export function groceryOpenLineCount(lines: readonly GroceryLine[]): number {
    return lines.filter((row) => !row.checked).length;
}

export function groceryHeaderSubtitle(openLineCount: number): string {
    return openLineCount === 1 ? "1 to get" : `${openLineCount} to get`;
}

export function groceryCheckedCount(
    view: Pick<
        KitchenGroceriesV2View,
        "stores" | "noStoreLines" | "checkedLines"
    >,
): number {
    if (view.checkedLines.length > 0) return view.checkedLines.length;
    const inStores = view.stores
        .flatMap((store) => store.sections.flatMap((section) => section.lines))
        .filter((row) => row.checked).length;
    const orphans = view.noStoreLines.filter((row) => row.checked).length;
    return inStores + orphans;
}

/** Whether the page was asked to open the Add sheet (a refused add came back). */
export function isGroceryAddModal(openModalId?: string | null): boolean {
    return !!openModalId?.startsWith(GROCERY_ADD_FOOD_PREFIX);
}

/** The store a refused add had posted; none when it left the store out. */
export function addStoreIdFromModal(
    openModalId?: string | null,
): string | null {
    if (!openModalId?.startsWith(GROCERY_ADD_FOOD_PREFIX)) return null;
    const id = openModalId.slice(GROCERY_ADD_FOOD_PREFIX.length);
    return id || null;
}

/**
 * "3 left" out of the running-low notice's reason ("3 left, below 6"), the one
 * place the stock that is left is written.
 */
export function lowLeftFromReason(reason: unknown): string | null {
    if (typeof reason !== "string") return null;
    const match = /^(.+) left, below /.exec(reason);
    return match ? `${match[1]} left` : null;
}

/**
 * The store an add names: the one the list is filtered to when it is exactly
 * one, or the one a refused add had posted. With none, the add leaves the
 * store out and the domain picks, as `add_grocery_line` does: a usual's own
 * store, else where the family was last listed, else the first store.
 */
function addStoreFor(view: KitchenGroceriesV2View): GroceryStoreView | null {
    const pick =
        view.addStoreId ??
        (view.selectedStoreIds?.length === 1
            ? view.selectedStoreIds[0]
            : null) ??
        null;
    return pick
        ? (view.stores.find((store) => store.id === pick) ?? null)
        : null;
}

function defaultSectionId(store: GroceryStoreView): string {
    const other = store.sections.find((section) => section.isOther);
    if (other) return other.id;
    const sec =
        store.sections.find((section) => !section.hidden && !section.isOther) ??
        store.sections[0];
    return sec?.id ?? "";
}

export function groceryV2QuantityLabel(line: GroceryLine): string {
    if (line.note?.trim()) return line.note.trim();
    return formatQuantityDisplayParts(line.quantity.amount, line.quantity.unit);
}

export function groceryRowLabels(
    line: GroceryLineView,
    meta: Pick<KitchenGroceriesLineMeta, "plainFoodName" | "isUsual">,
): { title: string; subtitle?: string; tag?: string } {
    const productName = line.usualProductName?.trim() || null;
    const title = meta.isUsual && productName ? productName : line.displayName;
    let subtitle: string | undefined;
    if (meta.plainFoodName && meta.plainFoodName !== title) {
        subtitle = meta.plainFoodName;
    } else if (
        meta.isUsual &&
        line.displayName !== title &&
        line.displayName.trim() !== ""
    ) {
        subtitle = line.displayName;
    }
    const tag = meta.isUsual ? "usual" : undefined;
    return { title, subtitle, tag };
}

/** "Milk · usual": what the row and the sheet say under the name. */
function labelLine(labels: { subtitle?: string; tag?: string }): string {
    return [labels.subtitle, labels.tag].filter(Boolean).join(" · ");
}

export function buildGroceryV2StoreGroups(input: {
    stores: GroceryStoreView[];
    noStoreLines: GroceryLineView[];
}): GroceryV2StoreGroup[] {
    const groups: GroceryV2StoreGroup[] = input.stores.map((store) => ({
        storeId: store.id,
        storeName: store.name,
        sections: store.sections
            .filter((section) => section.lines.length > 0)
            .map((section) => ({
                section: { id: section.id, name: section.name },
                lines: section.lines.slice(),
                sortOrder: section.sortOrder,
                isOther: section.isOther,
            }))
            .sort(
                (a, b) =>
                    a.sortOrder - b.sortOrder ||
                    Number(a.isOther) - Number(b.isOther) ||
                    a.section.name.localeCompare(b.section.name),
            )
            .map(({ section, lines }) => ({ section, lines })),
    }));
    if (input.noStoreLines.length > 0) {
        groups.push({
            storeId: "",
            storeName: "No store",
            sections: [
                {
                    section: { id: "no-store", name: "No store" },
                    lines: input.noStoreLines.slice(),
                },
            ],
        });
    }
    return groups.filter((g) => g.sections.some((s) => s.lines.length > 0));
}

function checkForm(line: GroceryLineView, returnTo: string) {
    return {
        action: `/kitchen/groceries/lines/${line.id}/check`,
        fields: {
            checked: line.checked ? "0" : "1",
            return_to: returnTo,
        },
    };
}

function deleteForm(line: GroceryLineView, returnTo: string) {
    return {
        action: `/kitchen/groceries/lines/${line.id}/delete`,
        fields: { return_to: returnTo },
    };
}

/** A row's allergen mark: a hit the household's allergen list makes, in words. */
function allergenMark(
    meta: Pick<KitchenGroceriesLineMeta, "allergenWarning">,
): string | null {
    const text = meta.allergenWarning?.trim();
    // "Unknown allergen data" is one line for the whole page, not a mark.
    return text && text !== UNKNOWN_ALLERGEN_TEXT ? text : null;
}

export function groceryLineRowMarkup(
    line: GroceryLineView,
    view: Pick<KitchenGroceriesV2View, "lineMeta">,
    returnTo: string,
): Html {
    const meta = view.lineMeta.get(line.id) ?? {
        plainFoodName: null,
        isUsual: false,
        allergenWarning: null,
        storeName: "",
        sectionName: "",
    };
    const labels = groceryRowLabels(line, meta);
    const sheetId = groceryLineSheetId(line.id);
    const check = checkForm(line, returnTo);
    const del = deleteForm(line, returnTo);
    const checkLabel = line.checked ? "Uncheck" : "Check off";
    const items: MenuItem[] = [
        { kind: "post", label: checkLabel, ...check },
        { kind: "opens", label: "Edit", sheetId },
        { kind: "destructive", label: "Delete", ...del },
    ];
    const mark = allergenMark(meta);
    const sub = labelLine(labels);
    const rowHtml = String(
        itemRow({
            title: labels.title,
            score: meta.productScore,
            ...(mark
                ? {
                      state: "warning" as const,
                      subtitle: sub ? `${sub} · ${mark}` : mark,
                  }
                : { subtitle: sub }),
            value: groceryV2QuantityLabel(line),
            lead: {
                kind: "check",
                label: `${checkLabel} ${labels.title}`,
                checked: line.checked,
                form: check,
            },
            trailing: {
                kind: "control",
                html: menu({
                    label: `Actions for ${labels.title}`,
                    anchor: "more",
                    items,
                }),
            },
            swipe: {
                left: { label: "Delete", form: del },
                right: {
                    label: checkLabel,
                    icon: "check",
                    form: check,
                },
            },
            select: { name: "ids[]", value: line.id },
            id: `fd-grocery-row-${line.id}`,
            data: { "fd-sheet-row": "", "sheet-id": sheetId },
        }),
    );
    return raw(
        // A function replacement: a string would read `$` in an id as a pattern.
        rowHtml.replace("<li ", () => `<li tabindex="0" `),
    );
}

/** How far a step moves the line sheet's amount, from the unit it is in. */
function amountStep(line: GroceryLine): number {
    const unit = line.quantity.unit.trim().toLowerCase();
    if (unit === "g" || unit === "ml") return 50;
    return line.quantity.amount >= 1 ? 1 : 0.5;
}

function hiddenInputs(fields: Readonly<Record<string, string>>): string {
    return Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`,
        )
        .join("");
}

function lineSheet(
    line: GroceryLineView,
    view: KitchenGroceriesV2View,
    returnTo: string,
): string {
    const open = view.openLineId === line.id;
    const sheetId = groceryLineSheetId(line.id);
    const meta = view.lineMeta.get(line.id);
    const labels = groceryRowLabels(
        line,
        meta ?? { plainFoodName: null, isUsual: false },
    );
    const editId = `${sheetId}-edit`;
    const checkId = `${sheetId}-check`;
    const editAction = `/kitchen/groceries/lines/${line.id}/edit`;
    // A pull-down saves what it changed and comes back with this sheet open.
    const comeBack = groceryV2ReturnTo(view.selectedStoreIds, line.id);
    const store = view.stores.find((row) => row.id === line.storeId);
    const sections = (store?.sections ?? []).filter(
        (section) => !section.hidden || section.id === line.sectionId,
    );
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const amount = sheetSection({
        kind: "amount",
        content: stepperControl({
            name: "qty_amount",
            label: "Amount",
            value: line.quantity.amount,
            min: 0,
            step: amountStep(line),
            inputStep: "any",
            unit: line.quantity.unit,
            id: `${sheetId}-amount`,
            form: editId,
        }),
    });
    const pulldown = (
        title: string,
        value: string,
        choices: readonly { id: string; name: string; current: boolean }[],
        name: "store_id" | "section",
    ) =>
        raw(
            `<li class="fd-item-row">${menu({
                label: title,
                anchor: "row",
                row: { title, value },
                items: choices.map((choice) => ({
                    kind: "checked" as const,
                    label: choice.name,
                    checked: choice.current,
                    // The value already chosen only closes the menu.
                    current: choice.current,
                    action: editAction,
                    fields: { [name]: choice.id, return_to: comeBack },
                })),
            })}</li>`,
        );
    const rows: Html[] = [];
    if (view.stores.length > 0) {
        rows.push(
            pulldown(
                "Store",
                meta?.storeName ?? store?.name ?? "No store",
                view.stores.map((row) => ({
                    id: row.id,
                    name: row.name,
                    current: row.id === line.storeId,
                })),
                "store_id",
            ),
        );
    }
    if (sections.length > 0) {
        rows.push(
            pulldown(
                "Section",
                meta?.sectionName ?? "Other",
                sections.map((section) => ({
                    id: section.id,
                    name: section.name,
                    current: section.id === line.sectionId,
                })),
                "section",
            ),
        );
    }
    const where =
        rows.length > 0
            ? sheetSection({
                  kind: "rows",
                  content: listGroup({ rows, label: "Where it is bought" }),
              })
            : "";
    const note = sheetSection({
        kind: "fields",
        label: "Note",
        content: field({
            id: `${sheetId}-note`,
            label: "Note",
            labelHidden: true,
            name: "note",
            value: line.note ?? "",
            maxlength: 500,
            autocomplete: "off",
            form: editId,
        }),
    });
    const body = `${error}${amount}${where}${note}
<form id="${esc(editId)}" method="post" action="${esc(editAction)}" data-fd-line-edit>${hiddenInputs({ qty_unit: line.quantity.unit, return_to: returnTo })}</form>
<form id="${esc(checkId)}" method="post" action="/kitchen/groceries/lines/${esc(line.id)}/check" class="fd-visually-hidden" aria-hidden="true">${hiddenInputs({ checked: line.checked ? "0" : "1", return_to: returnTo })}</form>`;
    return sheet({
        id: sheetId,
        placement: "side",
        className: "fd-kitchen-sheet",
        header: {
            kind: "title",
            title: line.displayName,
            subtitle: labelLine(labels) || undefined,
        },
        body: raw(body),
        actions: {
            kind: "pair",
            cancel: {
                label: line.checked ? "Uncheck" : "Check off",
                type: "submit",
                form: checkId,
            },
            primary: { label: "Save", type: "submit", form: editId },
        },
        openOnLoad: open,
        focus: "panel",
    });
}

/** The first Expires chip the draft or the line has: the chosen date, or none. */
function putAwayExpires(
    lineId: string,
    expiresOn: string,
): { host: Html; field: Html } {
    const choices = expiresOn
        ? [
              { value: "none", label: "No date" },
              { value: "pick", label: "Pick a date", selected: true },
          ]
        : [
              { value: "none", label: "No date", selected: true },
              { value: "pick", label: "Pick a date" },
          ];
    return {
        host: choiceGroup({
            name: `expires_mode_${lineId}`,
            legend: "Expires",
            options: choices,
        }),
        field: field({
            id: `put-away-expires-${lineId}`,
            label: "Expires on",
            labelHidden: true,
            name: `expires_on_${lineId}`,
            type: "date",
            value: expiresOn,
        }),
    };
}

function putAwayLine(
    line: GroceryLineView,
    view: KitchenGroceriesV2View,
): string {
    const draft = view.putAwayDraft?.[line.id];
    const loc =
        draft?.locationId ?? line.lastLocationId ?? view.locations[0]?.id ?? "";
    const expiresOn = draft?.expiresOn ?? "";
    const labels = groceryRowLabels(
        line,
        view.lineMeta.get(line.id) ?? { plainFoodName: null, isUsual: false },
    );
    const note = line.note?.trim();
    const head = itemRow({
        title: labels.title,
        ...(note ? { subtitle: note } : { meta: groceryV2QuantityLabel(line) }),
        lead: { kind: "done", label: "Checked off" },
    });
    const keptIn = sheetSection({
        kind: "chips",
        label: "Kept in",
        content: choiceGroup({
            name: `location_id_${line.id}`,
            legend: `Kept in for ${line.displayName}`,
            required: true,
            options: view.locations.map((location) => ({
                value: location.id,
                label: location.name,
                selected: location.id === loc,
            })),
        }),
    });
    const exp = putAwayExpires(line.id, expiresOn);
    const expires = sheetSection({
        kind: "chips",
        label: "Expires",
        content: raw(
            `<div class="fd-kitchen-item-expires" data-fd-expires data-fd-expires-keep="">${exp.host}<div class="fd-kitchen-item-expires__field">${exp.field}</div></div>`,
        ),
    });
    const product =
        line.putAwayProducts && line.putAwayProducts.length > 0
            ? sheetSection({
                  kind: "chips",
                  label: "Product",
                  content: choiceGroup({
                      name: `product_food_id_${line.id}`,
                      legend: `Product for ${line.displayName}`,
                      options: line.putAwayProducts.map((p) => ({
                          value: p.id,
                          label: p.label,
                          selected:
                              (draft?.productFoodId ??
                                  line.putAwayProductId) === p.id,
                      })),
                  }),
              })
            : "";
    // A to-taste line has no amount of its own: the shopper says what they got,
    // starting from the line's amount when it has one.
    const howMuch = note
        ? sheetSection({
              kind: "amount",
              label: "How much did you buy",
              content: stepperControl({
                  name: `put_away_amount_${line.id}`,
                  label: `Amount for ${line.displayName}`,
                  value:
                      Number(draft?.putAwayAmount) ||
                      (line.quantity.amount > 0 ? line.quantity.amount : 1),
                  min: 0,
                  step: line.quantity.amount > 0 ? amountStep(line) : 1,
                  inputStep: "any",
                  unit: line.quantity.unit,
                  id: `put-away-amt-${line.id}`,
              }),
          })
        : "";
    return `<section class="fd-kitchen-put-line">${String(listGroup({ rows: [head], label: labels.title }))}${howMuch}${keptIn}${product}${expires}</section>`;
}

function putAwaySheet(view: KitchenGroceriesV2View, returnTo: string): string {
    const checked = view.checkedLines;
    if (checked.length === 0) return "";
    const open = !!view.openPutAway;
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const lineIds = checked.map((row) => row.id).join(",");
    const formId = "fd-grocery-put-away-form";
    const n = checked.length;
    return sheet({
        id: FD_GROCERY_PUT_AWAY_SHEET_ID,
        placement: "dialog",
        className: "fd-kitchen-sheet",
        header: {
            kind: "title",
            title: n === 1 ? "Put away 1 item" : `Put away ${n} items`,
        },
        body: raw(
            `${error}<form id="${formId}" method="post" action="/kitchen/groceries/put-away">${hiddenInputs({ return_to: returnTo, line_ids: lineIds })}${checked.map((line) => putAwayLine(line, view)).join("")}</form>`,
        ),
        actions: {
            kind: "pair",
            cancel: { label: "Clear checked" },
            primary: { label: "Put away", type: "submit", form: formId },
            confirm: { label: `Clear ${n}`, form: CLEAR_FORM_ID },
        },
        openOnLoad: open,
        focus: "panel",
    });
}

/** What the retry button re-posts: the add the allergen warning stopped. */
function allergenBlock(view: KitchenGroceriesV2View, storeId: string): string {
    if (
        !view.openAdd ||
        !view.allergenNotices?.length ||
        view.allergenRetry?.storeId !== storeId
    ) {
        return "";
    }
    const food = view.allergenRetry.foodName?.trim();
    const sentences = view.allergenNotices
        .map((notice) => {
            const said = noticeSentence(notice);
            // "Contains milk — Max." reads "Cheddar contains milk — Max."
            const text = food
                ? `${food} ${said.charAt(0).toLowerCase()}${said.slice(1)}`
                : said;
            return `<p class="fd-kitchen-sheet-error" role="alert">${esc(text)}</p>`;
        })
        .join("");
    const retry = view.allergenRetry
        ? `<form class="fd-kitchen-allergen-retry" method="post" action="${ADD_LINE_ACTION}">${hiddenInputs({ ...view.allergenRetry.fields, confirm_allergen: "1" })}${String(button({ label: "Add anyway", type: "submit" }))}</form>`
        : "";
    return `${sentences}${retry}`;
}

function usualAddForm(
    usual: GroceryAddUsual,
    store: GroceryStoreView | null,
    sectionId: string,
    returnTo: string,
): { action: string; fields: Record<string, string> } {
    return {
        action: ADD_LINE_ACTION,
        fields: {
            kind: usual.kind,
            ...(usual.kind === "supply" ? { name: usual.name } : {}),
            food_id: usual.foodId,
            // No store: the domain files it where the usual itself goes.
            ...(store ? { store_id: store.id } : {}),
            ...(store && sectionId ? { section_id: sectionId } : {}),
            qty_amount: String(usual.amount),
            qty_unit: usual.unit,
            return_to: returnTo,
        },
    };
}

/** What a suggestion says it is, and where it goes when that is known. */
function usualSubtitle(
    usual: GroceryAddUsual,
    store: GroceryStoreView | null,
): string {
    const what =
        usual.lowLeft != null
            ? `Low · ${usual.lowLeft}`
            : usual.lowBelow != null
              ? `Low, below ${usual.lowBelow}`
              : `Usual · ${usual.subtitle}`;
    const where = store?.name ?? usual.storeName;
    return where ? `${what} · ${where}` : what;
}

function groceryAddSheet(view: KitchenGroceriesV2View): string {
    if (view.stores.length === 0) return "";
    const store = addStoreFor(view);
    const open = !!view.openAdd;
    const modalId = `${GROCERY_ADD_FOOD_PREFIX}${store?.id ?? ""}`;
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const didYouMean = didYouMeanModalBlock(
        view.didYouMean,
        modalId,
        view.openAdd ? modalId : undefined,
    ).replaceAll("did-you-mean-", "fd-did-you-mean-");
    const sectionId = store ? defaultSectionId(store) : "";
    // An add lands back on the list as it was filtered.
    const returnTo = groceryV2ReturnTo(view.selectedStoreIds);
    const usuals = view.usuals ?? [];
    const low = usuals.filter((usual) => usual.lowBelow != null);
    const lowChips =
        low.length > 0
            ? String(
                  sheetSection({
                      kind: "chips",
                      label: "Running low",
                      content: raw(
                          `<div class="fd-kitchen-add-low">${low
                              .map((usual) => {
                                  const form = usualAddForm(
                                      usual,
                                      store,
                                      sectionId,
                                      returnTo,
                                  );
                                  return `<form class="fd-inline-form" method="post" action="${esc(form.action)}" data-fd-grocery-usual="${esc(usual.name.toLowerCase())}">${hiddenInputs(form.fields)}${String(chip({ label: usual.name, submit: true }))}</form>`;
                              })
                              .join("")}</div>`,
                      ),
                  }),
              )
            : "";
    const suggestions =
        usuals.length > 0
            ? String(
                  sheetSection({
                      kind: "results",
                      label: "Suggestions",
                      content: listGroup({
                          label: "Suggestions",
                          rows: usuals.map((usual) =>
                              itemRow({
                                  title: usual.name,
                                  subtitle: usualSubtitle(usual, store),
                                  trailing: {
                                      kind: "add",
                                      label: `Add ${usual.name}`,
                                      form: usualAddForm(
                                          usual,
                                          store,
                                          sectionId,
                                          returnTo,
                                      ),
                                  },
                                  data: {
                                      "fd-grocery-usual":
                                          usual.name.toLowerCase(),
                                  },
                              }),
                          ),
                      }),
                  }),
              ) +
              `<p class="fd-kitchen-add__none" data-fd-grocery-none hidden>No usual matches.</p>`
            : "";
    // A failed add or a did-you-mean opens the hand form.
    const handOpen = (open && view.error) || view.didYouMean != null;
    const hand = `<details class="fd-kitchen-hand"${handOpen ? " open" : ""}><summary class="fd-kitchen-hand__summary">Not here? Add it by hand</summary>
<form id="fd-grocery-add-form" class="fd-kitchen-hand__form" method="post" action="${ADD_LINE_ACTION}">
${hiddenInputs({ kind: "food", ...(store ? { store_id: store.id } : {}), return_to: returnTo, ...(store && sectionId ? { section_id: sectionId } : {}) })}
${String(
    field({
        id: "fd-grocery-add-name",
        label: "Name",
        name: "food_name",
        required: true,
        autocomplete: "off",
    }),
)}
${String(
    stepperControl({
        name: "qty_amount",
        label: "Amount",
        value: 1,
        min: 0,
        step: 1,
        inputStep: "any",
        unit: "each",
        id: "fd-grocery-add-qty",
    }),
)}
<input type="hidden" name="qty_unit" value="each" />
${String(button({ label: "Add", variant: "primary", type: "submit" }))}
</form></details>`;
    return sheet({
        id: FD_GROCERY_ADD_SHEET_ID,
        placement: "dialog",
        className: "fd-kitchen-sheet",
        header: {
            kind: "search",
            title: "Add to list",
            search: {
                name: "q",
                id: "fd-grocery-add-q",
                label: "Search your usuals",
                placeholder: "Add to list",
            },
        },
        body: raw(
            `${error}${allergenBlock(view, store?.id ?? "")}${didYouMean}${lowChips}${suggestions}${hand}`,
        ),
        openOnLoad: view.openAdd,
        focus: "panel",
    });
}

/** The store filter: a tick for each store shown, Clear to show them all. */
function storeFilter(view: KitchenGroceriesV2View): string {
    if (view.stores.length < 2) return "";
    const selected = new Set(view.selectedStoreIds ?? []);
    const items: MenuItem[] = view.stores.map((store) => {
        const next = view.stores
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
            href: groceryV2ReturnTo(next),
        };
    });
    if (selected.size > 0) {
        items.push({
            kind: "link",
            label: "Clear",
            href: GROCERY_V2_RETURN_TO,
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

/** The groups the page shows: the filtered stores, or all of them. */
function shownGroups(view: KitchenGroceriesV2View): GroceryV2StoreGroup[] {
    const selected = view.selectedStoreIds ?? [];
    return buildGroceryV2StoreGroups({
        stores:
            selected.length > 0
                ? view.stores.filter((store) => selected.includes(store.id))
                : view.stores,
        noStoreLines: selected.length > 0 ? [] : view.noStoreLines,
    });
}

function sectionBlock(
    group: GroceryV2StoreGroup,
    section: GroceryV2SectionGroup,
    view: KitchenGroceriesV2View,
    returnTo: string,
    named: boolean,
): Html {
    const id = `fd-grocery-sec-${group.storeId || "none"}-${section.section.id}`;
    // Two stores each have a Dairy: name the store when more than one shows.
    const label =
        named && group.storeId
            ? `${section.section.name} · ${group.storeName}`
            : section.section.name;
    const rows = section.lines.map((line) =>
        groceryLineRowMarkup(line, view, returnTo),
    );
    return raw(
        `<section class="fd-kitchen-grocery-section" aria-labelledby="${esc(id)}">${String(
            sectionHeader({
                label,
                count: section.lines.length,
                rule: false,
                id,
            }),
        )}${String(listGroup({ rows, label }))}</section>`,
    );
}

/**
 * The phone's dock above the Nav bar and the desktop's row under the header.
 * Clear checked only arms: Cancel and "Clear N" take the row, so nothing is
 * deleted by one tap.
 */
function putAwayDock(view: KitchenGroceriesV2View): string {
    const n = groceryCheckedCount(view);
    if (n === 0) return "";
    return `<div class="fd-kitchen-grocery-dock" data-fd-grocery-dock data-fd-confirm role="group" aria-label="Checked items">${String(
        button({
            label: "Clear checked",
            attrs: CONFIRM_ARM_ATTRS,
        }),
    )}${String(
        button({
            label: `Put away ${n}`,
            variant: "primary",
            attrs: {
                ...CONFIRM_IDLE_ATTRS,
                command: "show-modal",
                commandfor: FD_GROCERY_PUT_AWAY_SHEET_ID,
            },
        }),
    )}${String(confirmButtons({ label: `Clear ${n}`, form: CLEAR_FORM_ID }))}</div>`;
}

export function renderKitchenGroceriesBody(
    view: KitchenGroceriesV2View,
): string {
    const returnTo = groceryV2ReturnTo(view.selectedStoreIds);
    const groups = shownGroups(view);
    const named = groups.filter((group) => group.storeId).length > 1;
    const blocks = groups.flatMap((group) =>
        group.sections.map((section) =>
            sectionBlock(group, section, view, returnTo, named),
        ),
    );
    // Only the lines the list shows: a filtered-out store has no rows to open
    // a sheet or to pick.
    const shownLines = groups.flatMap((group) =>
        group.sections.flatMap((section) => section.lines),
    );
    const checkedCount = groceryCheckedCount(view);
    const select = selectionBars({
        scope: "groceries",
        returnTo,
        actions: [
            {
                kind: "confirm",
                key: "delete",
                label: "Delete",
                action: "/kitchen/groceries/bulk/delete",
            },
        ],
    });
    const selectable = shownLines.length > 0;
    // The ⋯ holds only what applies: Share with the flag on, Select with
    // rows, Clear checked with something checked; with none, no ⋯.
    const menuItems: MenuItem[] = [
        ...(view.shareEnabled
            ? [
                  {
                      kind: "opens" as const,
                      label: "Share list",
                      sheetId: GROCERY_SHARE_SHEET_ID,
                  },
              ]
            : []),
        ...(selectable ? [select.menuItem] : []),
        ...(checkedCount > 0
            ? [
                  {
                      kind: "destructive" as const,
                      label: "Clear checked",
                      action: CLEAR_CHECKED_ACTION,
                      fields: { return_to: returnTo },
                  },
              ]
            : []),
    ];
    const more =
        menuItems.length > 0
            ? String(
                  menu({
                      label: "Groceries options",
                      anchor: "more",
                      items: menuItems,
                  }),
              )
            : "";
    const filter = storeFilter(view);
    // Without a store there is no add sheet, so nothing for a plus to open.
    const add =
        view.stores.length > 0
            ? kitchenAddButton({
                  target: FD_GROCERY_ADD_SHEET_ID,
                  label: "Add to list",
              })
            : null;
    const itemCount = groceryHeaderSubtitle(view.openLineCount);
    const tools = [filter, more].filter(Boolean).join("");
    const head = renderKitchenHead({
        active: "groceries",
        phoneSubtitle: itemCount,
        desktopTools: `${tools}${add?.desktop ?? ""}`,
    });
    const top =
        tools || add ? `${kitchenTopTools(tools, add?.phone ?? "")}\n` : "";
    const addRow = add
        ? listGroup({
              label: "Add to list",
              data: { "fd-grocery-add-row": "" },
              rows: [
                  itemRow({
                      title: "Add to list",
                      lead: { kind: "icon", name: "plus" },
                      opens: FD_GROCERY_ADD_SHEET_ID,
                  }),
              ],
          })
        : raw("");
    const [first, ...rest] = blocks;
    const left = raw(`${String(addRow)}${first ? String(first) : ""}`);
    const right = raw(rest.map(String).join(""));
    const layout = pageLayout({
        layout: "two-columns",
        left,
        right,
        className: "fd-kitchen-groceries-layout",
    });
    const empty =
        view.openLineCount === 0 && checkedCount === 0
            ? emptyState({ title: "Nothing on the list yet" })
            : raw("");
    const allergenBanner = view.unknownAllergen
        ? `<p class="fd-kitchen-grocery-unknown-allergen">${esc(UNKNOWN_ALLERGEN_TEXT)}</p>`
        : "";
    const pageError =
        view.error &&
        !view.openLineId &&
        !view.openPutAway &&
        !view.openShare &&
        !view.openAdd
            ? String(settingsErrorBanner(view.error))
            : "";
    const sheets = shownLines
        .map((line) => lineSheet(line, view, returnTo))
        .join("");
    const clearForm =
        checkedCount > 0
            ? `<form id="${CLEAR_FORM_ID}" method="post" action="${CLEAR_CHECKED_ACTION}" hidden>${hiddenInputs({ return_to: returnTo })}</form>`
            : "";
    return `${head}
<div class="fd-kitchen-groceries-page"${select.rootAttrs}>
${top}${pageError}
${allergenBanner}
${selectable ? `${String(select.bars)}${String(select.head)}` : ""}
${putAwayDock(view)}
${String(layout)}
${String(empty)}
${clearForm}
${sheets}
${groceryAddSheet(view)}
${putAwaySheet(view, returnTo)}
${
    view.shareEnabled
        ? renderShareSheet({
              id: GROCERY_SHARE_SHEET_ID,
              action: "/kitchen/groceries/share",
              title: "Share grocery list",
              subtitle: "The whole list, by store",
              what: "grocery list",
              open: view.openShare,
              error: view.openShare ? view.error : undefined,
          })
        : ""
}
</div>`;
}

export function renderKitchenGroceriesV2Page(
    view: KitchenGroceriesV2View,
): string {
    return renderAppShell({
        ...view.chrome,
        title: "Groceries",
        active: "grocery",
        v2Kitchen: "groceries",
        v2KitchenGroceriesCount: view.openLineCount,
        body: renderKitchenGroceriesBody(view),
    });
}

export function buildPreviewKitchenGroceriesView(
    chrome: KitchenGroceriesV2View["chrome"],
    overrides: Partial<KitchenGroceriesV2View> = {},
): KitchenGroceriesV2View {
    const line = (
        id: string,
        name: string,
        checked = false,
    ): GroceryLineView => ({
        id,
        householdId: "hh",
        storeId: "st-1",
        sectionId: "sec-1",
        kind: "food",
        displayName: name,
        quantity: { amount: 1, unit: "each" },
        foodId: `f-${id}`,
        checked,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
        alreadyHave: null,
        lastLocationId: "loc-1",
    });
    const stores: GroceryStoreView[] = overrides.stores ?? [
        {
            id: "st-1",
            householdId: "hh",
            name: "Costco",
            sortOrder: 0,
            rules: [],
            sections: [
                {
                    id: "sec-1",
                    householdId: "hh",
                    storeId: "st-1",
                    name: "Dairy & eggs",
                    sortOrder: 0,
                    hidden: false,
                    isOther: false,
                    lines: [
                        line("milk", "Kirkland 2% milk"),
                        line("eggs", "Vital Farms large eggs"),
                    ],
                },
            ],
        },
    ];
    const allLines = stores.flatMap((s) =>
        s.sections.flatMap((sec) => sec.lines),
    );
    return {
        chrome,
        stores,
        noStoreLines: overrides.noStoreLines ?? [],
        checkedLines: overrides.checkedLines ?? [],
        locations: overrides.locations ?? [{ id: "loc-1", name: "Fridge" }],
        lineMeta: overrides.lineMeta ?? new Map(),
        openLineCount:
            overrides.openLineCount ?? groceryOpenLineCount(allLines),
        ...overrides,
    };
}
