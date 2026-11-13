import type { GroceryLine } from "../../../domain/grocery.js";
import type { AppChromeBase } from "../../attention.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { chipLink, chipNav, choiceGroup } from "../../components/v2/chips.js";
import { renderFoodPicker } from "../../components/food-picker.js";
import { noticeList } from "../../components/notices.js";
import {
    didYouMeanModalBlock,
    type DidYouMeanModal,
} from "../../components/did-you-mean.js";
import type { Notice } from "../../../domain/notices.js";
import type { GroceryAllergenRetry } from "../grocery.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import {
    groceryRow,
    rowList,
    sectionHeader,
} from "../../components/v2/rows.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import { confirmSheet } from "../../components/v2/sheet.js";
import {
    iconCheck,
    iconChevronRight,
    iconPlus,
} from "../../components/v2/icons.js";
import type { GroceryLineView, GroceryStoreView } from "../grocery.js";
import { renderAppShell } from "../../shell.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { renderKitchenHead } from "./kitchen-head.js";
import { selectMode } from "./select-mode.js";
import { UNKNOWN_ALLERGEN_TEXT } from "../../../copy/notices.js";
import {
    GROCERY_SHARE_SHEET_ID,
    renderShareSheet,
    renderShareTrigger,
} from "./share-sheet.js";

export const GROCERY_V2_RETURN_TO = "/kitchen/groceries";
export const FD_GROCERY_PUT_AWAY_SHEET_ID = "fd-grocery-put-away";
export const FD_GROCERY_ADD_SHEET_ID = "fd-grocery-add";
const GROCERY_ADD_FOOD_PREFIX = "grocery-add-food-";
const GROCERY_FOOD_PICKER_ID = "fd-grocery-food-picker";

export function groceryV2ReturnTo(selectedStoreId?: string | null): string {
    if (!selectedStoreId) return GROCERY_V2_RETURN_TO;
    return `${GROCERY_V2_RETURN_TO}?store=${encodeURIComponent(selectedStoreId)}`;
}
export const FD_GROCERY_CLEAR_SHEET_ID = "fd-grocery-clear-checked";

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
    selectedStoreId?: string | null;
    error?: string;
    unknownAllergen?: boolean;
    openLineId?: string;
    openPutAway?: boolean;
    putAwayDraft?: PutAwayDraft;
    openAdd?: boolean;
    /** A refused Share post re-renders the page with the Share sheet open. */
    openShare?: boolean;
    addStoreId?: string | null;
    allergenNotices?: Notice[];
    allergenRetry?: GroceryAllergenRetry;
    didYouMean?: DidYouMeanModal;
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

export function addStoreIdFromModal(
    openModalId?: string | null,
): string | null {
    if (!openModalId?.startsWith(GROCERY_ADD_FOOD_PREFIX)) return null;
    const id = openModalId.slice(GROCERY_ADD_FOOD_PREFIX.length);
    return id || null;
}

function addStoreFor(view: KitchenGroceriesV2View): GroceryStoreView | null {
    const pick =
        view.addStoreId ?? view.selectedStoreId ?? view.stores[0]?.id ?? null;
    if (!pick) return view.stores[0] ?? null;
    return view.stores.find((store) => store.id === pick) ?? null;
}

function defaultSectionId(store: GroceryStoreView): string {
    const other = store.sections.find((section) => section.isOther);
    if (other) return other.id;
    const sec =
        store.sections.find((section) => !section.hidden && !section.isOther) ??
        store.sections[0];
    return sec?.id ?? "";
}

function formatPutAwayDateLabel(expiresOn: string): string {
    if (!expiresOn.trim()) return "No date";
    const d = new Date(`${expiresOn}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function calendarIcon(): string {
    return `<svg class="fd-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`;
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

export function renderGroceryStoreChips(
    view: Pick<
        KitchenGroceriesV2View,
        "stores" | "noStoreLines" | "selectedStoreId"
    >,
): string {
    const storeCounts = new Map<string, number>();
    for (const store of view.stores) {
        let n = 0;
        for (const section of store.sections) {
            n += section.lines.filter((row) => !row.checked).length;
        }
        storeCounts.set(store.id, n);
    }
    const noStoreCount = view.noStoreLines.filter((row) => !row.checked).length;
    const allCount =
        [...storeCounts.values()].reduce((a, b) => a + b, 0) + noStoreCount;
    const chips = [
        chipLink({
            label: "All",
            href: GROCERY_V2_RETURN_TO,
            count: allCount,
            selected: !view.selectedStoreId,
        }),
        ...view.stores.map((store) =>
            chipLink({
                label: store.name,
                href: `${GROCERY_V2_RETURN_TO}?store=${encodeURIComponent(store.id)}`,
                count: storeCounts.get(store.id) ?? 0,
                selected: view.selectedStoreId === store.id,
            }),
        ),
    ];
    return String(
        chipNav(chips, {
            label: "Grocery stores",
            className: "fd-kitchen-grocery-stores",
        }),
    );
}

function checkForm(line: GroceryLineView, checked: boolean, returnTo: string) {
    return {
        action: `/kitchen/groceries/lines/${line.id}/check`,
        fields: {
            checked: checked ? "0" : "1",
            return_to: returnTo,
        },
    };
}

export function groceryLineRowMarkup(
    line: GroceryLineView,
    view: Pick<KitchenGroceriesV2View, "lineMeta">,
    returnTo: string,
    opts: { overview?: boolean } = {},
): Html {
    const meta = view.lineMeta.get(line.id) ?? {
        plainFoodName: null,
        isUsual: false,
        allergenWarning: null,
        storeName: "",
        sectionName: "",
    };
    const labels = groceryRowLabels(line, meta);
    const amount = groceryV2QuantityLabel(line);
    const sheetId = groceryLineSheetId(line.id);
    const swipe = {
        lead: {
            label: line.checked ? "Uncheck" : "Check off",
            icon: line.checked ? undefined : iconCheck(),
            form: checkForm(line, line.checked, returnTo),
        },
        ...(opts.overview ? {} : { sheetId }),
    };
    const rowHtml = String(
        groceryRow({
            title: labels.title,
            score: meta.productScore,
            subtitle: labels.subtitle,
            tag: labels.tag,
            amount,
            checked: line.checked,
            toggle: { form: checkForm(line, line.checked, returnTo) },
            swipe,
            // The Fridge overview's rows open the line; only this list selects.
            select: opts.overview
                ? undefined
                : { name: "ids[]", value: line.id, label: labels.title },
        }),
    );
    const attrs = opts.overview
        ? ` data-fd-grocery-row-overview tabindex="0" data-fd-grocery-line-href="${esc(`${GROCERY_V2_RETURN_TO}?line=${encodeURIComponent(line.id)}`)}"`
        : ` data-fd-grocery-row data-sheet-id="${esc(sheetId)}" tabindex="0"`;
    return raw(
        // A function replacement: a string would read `$` in an id as a pattern.
        rowHtml.replace(
            "<li ",
            () => `<li id="fd-grocery-row-${esc(line.id)}"${attrs} `,
        ),
    );
}

const KITCHEN_OVERVIEW_RETURN_TO = "/kitchen/fridge";

export function renderGroceryOverviewSections(
    view: Pick<
        KitchenGroceriesV2View,
        "stores" | "noStoreLines" | "lineMeta" | "selectedStoreId"
    >,
): string {
    const groups = buildGroceryV2StoreGroups({
        stores: view.selectedStoreId
            ? view.stores.filter((s) => s.id === view.selectedStoreId)
            : view.stores,
        noStoreLines: view.selectedStoreId ? [] : view.noStoreLines,
    });
    return groups
        .map((store) =>
            store.sections
                .map((section) => {
                    if (section.lines.length === 0) return "";
                    const rows = section.lines.map((line) =>
                        groceryLineRowMarkup(
                            line,
                            view,
                            KITCHEN_OVERVIEW_RETURN_TO,
                            { overview: true },
                        ),
                    );
                    return `<section class="fd-kitchen-grocery-section fd-kitchen-overview-grocery-section" aria-labelledby="fd-overview-grocery-sec-${esc(section.section.id)}">${String(
                        sectionHeader({
                            title: section.section.name,
                            count: section.lines.length,
                            id: `fd-overview-grocery-sec-${section.section.id}`,
                        }),
                    )}${String(rowList(rows, { label: section.section.name }))}</section>`;
                })
                .join(""),
        )
        .join("");
}

function lineSheet(
    line: GroceryLineView,
    view: KitchenGroceriesV2View,
    returnTo: string,
): string {
    const open = view.openLineId === line.id;
    const meta = view.lineMeta.get(line.id);
    const amount = groceryV2QuantityLabel(line);
    const checkLabel = line.checked ? "Uncheck" : "Check off";
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const detail = [
        ["Amount", amount],
        ["Store", meta?.storeName ?? "—"],
        ["Section", meta?.sectionName ?? "—"],
        ...(line.note?.trim() ? [["Note", line.note.trim()] as const] : []),
    ]
        .map(
            ([label, value]) =>
                `<div class="fd-kitchen-sheet-kv"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,
        )
        .join("");
    const body = `${error}<dl class="fd-kitchen-sheet-kvs">${detail}</dl>`;
    const checkFormId = `${groceryLineSheetId(line.id)}-check`;
    const actions = [
        `<button type="submit" class="fd-btn fd-btn--primary" form="${esc(checkFormId)}">${esc(checkLabel)}</button>`,
    ].join("\n");
    return `${sheet({
        id: groceryLineSheetId(line.id),
        kind: "edit",
        title: line.displayName,
        body: `${body}<form id="${esc(checkFormId)}" method="post" action="/kitchen/groceries/lines/${esc(line.id)}/check" class="fd-visually-hidden" aria-hidden="true"><input type="hidden" name="checked" value="${line.checked ? "0" : "1"}" /><input type="hidden" name="return_to" value="${esc(returnTo)}" /></form>`,
        actions,
        openOnLoad: open,
    })}`;
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
    const rows = checked
        .map((line) => {
            const draft = view.putAwayDraft?.[line.id];
            const loc =
                draft?.locationId ??
                line.lastLocationId ??
                view.locations[0]?.id ??
                "";
            const expires = draft?.expiresOn ?? "";
            const labels = groceryRowLabels(
                line,
                view.lineMeta.get(line.id) ?? {
                    plainFoodName: null,
                    isUsual: false,
                },
            );
            const amount = groceryV2QuantityLabel(line);
            const locField = String(
                choiceGroup({
                    name: `location_id_${line.id}`,
                    legend: `Location for ${line.displayName}`,
                    className: "fd-kitchen-put-loc",
                    required: true,
                    options: view.locations.map((location) => ({
                        value: location.id,
                        label: location.name,
                        selected: location.id === loc,
                    })),
                }),
            );
            const dateLabel = formatPutAwayDateLabel(expires);
            const note = line.note?.trim()
                ? `<p class="fd-kitchen-grocery-put-note">${esc(line.note.trim())} — enter the amount you bought</p>`
                : "";
            const amountField = line.note?.trim()
                ? `<p class="fd-kitchen-sheet-label">Amount</p><input id="put-away-amt-${esc(line.id)}" name="put_away_amount_${esc(line.id)}" type="number" min="0" step="any" inputmode="decimal" value="${esc(draft?.putAwayAmount ?? "1")}" required aria-label="Amount for ${esc(line.displayName)}" />`
                : "";
            const productSelect =
                line.putAwayProducts && line.putAwayProducts.length > 0
                    ? `<p class="fd-kitchen-sheet-label">Product</p><select id="put-away-product-${esc(line.id)}" name="product_food_id_${esc(line.id)}" aria-label="Product for ${esc(line.displayName)}">${line.putAwayProducts
                          .map((product) => {
                              const sel =
                                  (draft?.productFoodId ??
                                      line.putAwayProductId) === product.id
                                      ? " selected"
                                      : "";
                              return `<option value="${esc(product.id)}"${sel}>${esc(product.label)}</option>`;
                          })
                          .join("")}</select>`
                    : "";
            return `<article class="fd-kitchen-put-row">
<div class="fd-kitchen-put-row__head">
<span class="fd-kitchen-put-row__title">${esc(labels.title)}</span>
<span class="fd-kitchen-put-row__amount">${esc(amount)}</span>
</div>
<div class="fd-kitchen-put-row__controls">
${locField}
<div class="fd-kitchen-put-date" data-fd-put-date>
<button type="button" class="fd-kitchen-put-date__chip" data-fd-put-date-btn aria-label="Best before date for ${esc(line.displayName)}">${calendarIcon()}<span data-fd-put-date-text>${esc(dateLabel)}</span></button>
<input type="date" class="fd-kitchen-put-date__input" name="expires_on_${esc(line.id)}" value="${esc(expires)}" aria-label="Best before for ${esc(line.displayName)}" />
</div>
</div>
${productSelect}
${amountField}
${note}
</article>`;
        })
        .join("");
    const formId = "fd-grocery-put-away-form";
    const clearBtn = sheetTrigger({
        target: FD_GROCERY_CLEAR_SHEET_ID,
        label: "Clear checked",
        className: "fd-btn fd-kitchen-grocery-clear-quiet",
    });
    const n = checked.length;
    const title = n === 1 ? "Put away 1 item" : `Put away ${n} items`;
    return sheet({
        id: FD_GROCERY_PUT_AWAY_SHEET_ID,
        kind: "edit",
        title,
        subtitle: "From the grocery list into the kitchen",
        body: `${error}<form id="${formId}" method="post" action="/kitchen/groceries/put-away"><input type="hidden" name="return_to" value="${esc(returnTo)}" /><input type="hidden" name="line_ids" value="${esc(lineIds)}" />${rows}</form>`,
        actions: `${clearBtn}<button type="submit" class="fd-btn fd-btn--primary" form="${formId}">Put away</button>`,
        openOnLoad: open,
    });
}

function groceryAddField(view: KitchenGroceriesV2View): string {
    if (view.stores.length === 0) return "";
    return `<button type="button" class="fd-log-search-field fd-kitchen-grocery-add" data-fd-open-sheet="${esc(FD_GROCERY_ADD_SHEET_ID)}" aria-label="Add to list">${String(iconPlus())}<span class="fd-kitchen-grocery-add__label">Add to list</span></button>`;
}

function groceryAddSheet(
    view: KitchenGroceriesV2View,
    returnTo: string,
): string {
    const store = addStoreFor(view);
    if (!store) return "";
    const open = !!view.openAdd;
    const modalId = `${GROCERY_ADD_FOOD_PREFIX}${store.id}`;
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const allergen =
        open &&
        view.allergenNotices?.length &&
        view.allergenRetry?.storeId === store.id
            ? noticeList(view.allergenNotices, {
                  className: "fd-kitchen-sheet-error",
              })
            : "";
    const didYouMean = didYouMeanModalBlock(
        view.didYouMean,
        modalId,
        view.openAdd ? modalId : undefined,
    );
    const sectionId = defaultSectionId(store);
    const hiddenSection =
        sectionId !== ""
            ? `<input type="hidden" name="section_id" value="${esc(sectionId)}" data-grocery-section-field />`
            : "";
    const body = `${error}${allergen}${didYouMean}${renderFoodPicker({
        id: GROCERY_FOOD_PICKER_ID,
        action: "/kitchen/groceries/lines",
        method: "post",
        hiddenFields: {
            kind: "food",
            store_id: store.id,
            return_to: returnTo,
        },
        formExtras: hiddenSection,
        includeQuantity: true,
    })}`;
    return sheet({
        id: FD_GROCERY_ADD_SHEET_ID,
        kind: "edit",
        title: "Add to list",
        subtitle: store.name,
        body,
        openOnLoad: open,
        showClose: true,
    });
}

function walkingOrderNote(view: KitchenGroceriesV2View): string {
    if (!view.selectedStoreId) return "";
    const store = view.stores.find((row) => row.id === view.selectedStoreId);
    if (!store) return "";
    return `<p class="fd-kitchen-grocery-footnote">Sections follow ${esc(store.name)}&rsquo;s walking order. Change it in <a href="/settings/household">Settings › Household › Stores</a>.</p>`;
}

function putAwayLink(view: KitchenGroceriesV2View): string {
    const n = groceryCheckedCount(view);
    if (n === 0) return "";
    const label =
        n === 1 ? "Put 1 away in the kitchen" : `Put ${n} away in the kitchen`;
    return `<button type="button" class="fd-kitchen-grocery-put-link" commandfor="${esc(FD_GROCERY_PUT_AWAY_SHEET_ID)}" command="show-modal"><span>${esc(label)}</span><span class="fd-kitchen-grocery-put-link__chev" aria-hidden="true">${String(iconChevronRight())}</span></button>`;
}

export function renderKitchenGroceriesBody(
    view: KitchenGroceriesV2View,
): string {
    const returnTo = groceryV2ReturnTo(view.selectedStoreId);
    const groups = buildGroceryV2StoreGroups({
        stores: view.selectedStoreId
            ? view.stores.filter((s) => s.id === view.selectedStoreId)
            : view.stores,
        noStoreLines: view.selectedStoreId ? [] : view.noStoreLines,
    });
    const showStoreHeadings = !view.selectedStoreId && groups.length > 1;
    const sections = groups
        .map((store) => {
            const sectionBlocks = store.sections
                .map((section) => {
                    if (section.lines.length === 0) return "";
                    const rows = section.lines.map((line) =>
                        groceryLineRowMarkup(line, view, returnTo),
                    );
                    return `<section class="fd-kitchen-grocery-section" aria-labelledby="fd-grocery-sec-${esc(section.section.id)}">${String(
                        sectionHeader({
                            title: section.section.name,
                            count: section.lines.length,
                            id: `fd-grocery-sec-${section.section.id}`,
                        }),
                    )}${String(rowList(rows, { label: section.section.name }))}</section>`;
                })
                .join("");
            if (!sectionBlocks) return "";
            if (!showStoreHeadings) return sectionBlocks;
            const storeHeadId = store.storeId
                ? `fd-grocery-store-${store.storeId}`
                : "fd-grocery-store-none";
            return `<section class="fd-kitchen-grocery-store" aria-labelledby="${esc(storeHeadId)}"><h2 class="fd-kitchen-grocery-store__title" id="${esc(storeHeadId)}">${esc(store.storeName)}</h2>${sectionBlocks}</section>`;
        })
        .join("");
    const empty =
        view.openLineCount === 0 && groceryCheckedCount(view) === 0
            ? `<p class="fd-kitchen-grocery-empty">Nothing on the grocery list yet.</p>`
            : "";
    const allergenBanner = view.unknownAllergen
        ? `<p class="fd-kitchen-grocery-unknown-allergen">${esc(UNKNOWN_ALLERGEN_TEXT)}</p>`
        : "";
    const pageError =
        view.error && !view.openLineId && !view.openPutAway && !view.openShare
            ? String(settingsErrorBanner(view.error))
            : "";
    const itemCount = groceryHeaderSubtitle(view.openLineCount);
    const allLines = view.stores.flatMap((s) =>
        s.sections.flatMap((sec) => sec.lines),
    );
    const sheets = allLines
        .map((line) => lineSheet(line, view, returnTo))
        .join("");
    const shareButton = String(
        renderShareTrigger(GROCERY_SHARE_SHEET_ID, "fd-kitchen-grocery-share"),
    );
    const select = selectMode({
        scope: "groceries",
        returnTo,
        actions: [
            {
                kind: "submit",
                key: "check",
                label: "Check off",
                action: "/kitchen/groceries/bulk/check",
            },
            {
                kind: "confirm",
                key: "remove",
                label: "Delete",
                action: "/kitchen/groceries/bulk/remove",
                title: "Delete items",
                one: "Delete 1 item from the list?",
                many: "Delete {n} items from the list?",
                confirmLabel: "Delete",
            },
        ],
    });
    const selectable = groups.length > 0;
    const head = renderKitchenHead({
        active: "groceries",
        phoneSubtitle: itemCount,
        desktopSubtitle: itemCount,
        desktopTools: shareButton,
    });
    // On the phone the header is the bare title (as on the other tabs) and
    // Share rides at the right of the first row under the tabs.
    return `${head}
<div class="fd-kitchen-groceries-page"${select.rootAttrs}>
<div class="fd-kitchen-grocery-tools">${shareButton}</div>
${pageError}
${allergenBanner}
${renderGroceryStoreChips(view)}
${groceryAddField(view)}
${selectable ? select.tools + select.bar : ""}
${sections}
${putAwayLink(view)}
${walkingOrderNote(view)}
${empty}
${sheets}
${selectable ? select.sheets : ""}
${groceryAddSheet(view, returnTo)}
${putAwaySheet(view, returnTo)}
${renderShareSheet({
    id: GROCERY_SHARE_SHEET_ID,
    action: "/kitchen/groceries/share",
    title: "Share grocery list",
    subtitle: "The whole list, by store",
    what: "grocery list",
    open: view.openShare,
    error: view.openShare ? view.error : undefined,
})}
${confirmSheet({
    id: FD_GROCERY_CLEAR_SHEET_ID,
    title: "Clear checked",
    message: "Remove every checked item from the list?",
    action: "/kitchen/groceries/clear-checked",
    confirmLabel: "Clear checked",
    hiddenFields: { return_to: returnTo },
})}
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
