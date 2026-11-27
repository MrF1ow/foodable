import {
    defaultFreezeExpiry,
    type FridgeItem,
    type FridgeLocation,
    type FridgeSnapshot,
} from "../../../domain/fridge.js";
import { usualLowLevel, type Food } from "../../../domain/foods.js";
import type { Notice } from "../../../domain/notices.js";
import type { ExpiringUse } from "../../../domain/suggestions.js";
import {
    daysUntilExpiry,
    expiryLevel,
    listExpiring,
} from "../../../domain/stock.js";
import type { AppChromeBase } from "../../attention.js";
import {
    type DidYouMeanModal,
    renderDidYouMeanBlock,
} from "../../components/did-you-mean.js";
import { button } from "../../components/v2/button.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { miniCard, type MiniCardTone } from "../../components/v2/mini-card.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { formatAmountText } from "./amount-text.js";
import { quickAction } from "../../components/v2/quick-action.js";
import { searchField } from "../../components/v2/search-field.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { stepperControl } from "../../components/v2/stepper-control.js";
import { APP_PATHS } from "../../route-map.js";
import { renderAppShell } from "../../shell.js";
import { formatExpiryWhen } from "./expiry-format.js";
import { renderKitchenHead, kitchenTopTools } from "./kitchen-head.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const FD_FRIDGE_ADD_SHEET_ID = "fd-fridge-add";

export type KitchenFridgeFoodMeta = Pick<
    Food,
    "id" | "genericFoodId" | "usualAmount"
>;

/** A usual the Add sheet offers first: one tap puts its usual amount away. */
export type FridgeAddUsual = {
    /** The food the item is added as (the usual product, else the plain food). */
    foodId: string;
    /** A supply posts as one: the fridge add route refuses it as a food. */
    kind: "food" | "supply";
    name: string;
    /** "Kirkland 2% · 1 gal": the product and the amount that goes in. */
    subtitle: string;
    amount: number;
    unit: string;
};

export type KitchenFridgeV2View = FridgeSnapshot & {
    chrome: AppChromeBase;
    today: string;
    foodsById?: ReadonlyMap<string, KitchenFridgeFoodMeta>;
    /** For each expiring item, the recipes that use it (Use soon lines). */
    useSoonUses?: readonly ExpiringUse[];
    error?: string;
    openItemId?: string;
    openAdd?: boolean;
    openModalId?: string;
    didYouMean?: DidYouMeanModal;
    freezeDefaultExpiry: string;
    /**
     * The usuals running low, by the usual's food id, with the level they are
     * below ("6"): their rows in the fridge say so in the warning colour.
     */
    lowStock?: ReadonlyMap<string, string>;
    /** The 0-100 product score of a food, by food id: a badge on its row. */
    scores?: ReadonlyMap<string, number>;
    /** The Add sheet's "Your usuals". */
    usuals?: readonly FridgeAddUsual[];
};

export type FridgeLocationGroup = {
    location: FridgeLocation;
    items: FridgeItem[];
};

const FRIDGE_RETURN_TO = "/kitchen/fridge";
const ADD_ITEM_ACTION = "/kitchen/fridge/items";

export function fridgeItemSheetId(itemId: string): string {
    return `fd-fridge-item-${itemId}`;
}

export function kitchenFridgeItemCountLabel(count: number): string {
    return count === 1 ? "1 item" : `${count} items`;
}

export function formatFridgeExpiryLabel(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

export function groupFridgeItemsByLocation(
    locations: readonly FridgeLocation[],
    items: readonly FridgeItem[],
): FridgeLocationGroup[] {
    const sorted = locations
        .slice()
        .sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
        );
    const byLoc = new Map<string, FridgeItem[]>();
    for (const loc of sorted) byLoc.set(loc.id, []);
    for (const row of items) {
        const bucket = byLoc.get(row.locationId);
        if (bucket) bucket.push(row);
    }
    for (const bucket of byLoc.values()) {
        bucket.sort((a, b) => a.displayName.localeCompare(b.displayName));
    }
    return sorted.map((location) => ({
        location,
        items: byLoc.get(location.id) ?? [],
    }));
}

export function eatPortionAmount(
    item: FridgeItem,
    food: KitchenFridgeFoodMeta | undefined,
): number {
    const usual = food?.usualAmount;
    if (usual && usual.unit === item.quantity.unit && usual.amount > 0) {
        return Math.min(usual.amount, item.quantity.amount);
    }
    const unit = item.quantity.unit;
    if (unit === "each" || unit === "portion") {
        return Math.min(1, item.quantity.amount);
    }
    if (unit === "g" || unit === "ml") {
        return Math.min(100, item.quantity.amount);
    }
    return Math.min(1, item.quantity.amount);
}

/** "expired", "expires today", "expires in 3 days": the sheet's subtitle. */
export function formatSheetExpiryLine(
    today: string,
    expiresOn: string,
): string {
    const days = daysUntilExpiry(today, expiresOn);
    if (days < 0) return "Expired";
    if (days === 0) return "Expires today";
    if (days === 1) return "Expires tomorrow";
    return `Expires in ${days} days`;
}

function locationName(
    locations: readonly FridgeLocation[],
    locationId: string,
): string {
    return locations.find((loc) => loc.id === locationId)?.name ?? "Fridge";
}

/** Whether an expiry is near enough that its words are a warning. */
function isUrgent(expiresOn: string | null | undefined, today: string) {
    if (!expiresOn?.trim()) return false;
    const level = expiryLevel(expiresOn, today);
    return level === "expired" || level === "high" || level === "medium";
}

/**
 * The usuals running low and the level each is below, for the fridge rows. The
 * level is the one the running-low notice compares with (`usualLowLevel`),
 * written the way its "3 left, below 6" reason writes it.
 */
export function lowStockLevels(
    notices: readonly Notice[],
    foods: readonly Pick<Food, "id" | "restockLowLevel" | "usualAmount">[],
): Map<string, string> {
    const byId = new Map(foods.map((food) => [food.id, food]));
    const out = new Map<string, string>();
    for (const notice of notices) {
        if (notice.code !== "grocery.running_low") continue;
        const food = byId.get(notice.subject.id);
        const level = food ? usualLowLevel(food) : null;
        if (food && level != null) {
            out.set(food.id, String(Math.round(level * 100) / 100));
        }
    }
    return out;
}

/** What a low row says: "<expiry> · low, below <level>", the expiry left out when it has none. */
export function fridgeLowSubtitle(
    expiry: string | null,
    below: string,
): string {
    const low = `low, below ${below}`;
    return expiry ? `${expiry} · ${low}` : low;
}

/** The level a fridge item's usual is below, when that usual is running low. */
function lowStockLevel(
    item: FridgeItem,
    food: KitchenFridgeFoodMeta | undefined,
    view: KitchenFridgeV2View,
): string | null {
    if (!item.foodId || !view.lowStock) return null;
    return view.lowStock.get(food?.genericFoodId ?? item.foodId) ?? null;
}

const MINI_TONE: Record<string, MiniCardTone> = {
    expired: "over",
    high: "over",
    medium: "warn",
};

function useSoonStrip(view: KitchenFridgeV2View): Html {
    const primary = listExpiring(view.items, view.today, 3);
    const extra = listExpiring(view.items, view.today, 7)
        .filter((item) => !primary.some((row) => row.id === item.id))
        .slice(0, Math.max(0, 5 - primary.length));
    const items = [...primary, ...extra];
    if (items.length === 0) return raw("");
    const cards = items.map((item, index) => {
        const expiresOn = item.expiresOn ?? "";
        const level = expiryLevel(expiresOn, view.today) ?? "medium";
        const sheetId = fridgeItemSheetId(item.id);
        return String(
            miniCard({
                label: formatExpiryWhen(view.today, expiresOn),
                title: item.displayName,
                meta: formatAmountText(
                    item.quantity.amount,
                    item.quantity.unit,
                ),
                tone: MINI_TONE[level] ?? "muted",
                href: `${FRIDGE_RETURN_TO}?item=${encodeURIComponent(item.id)}`,
                className:
                    index >= primary.length
                        ? "fd-kitchen-use-card fd-kitchen-use-card--desktop-only"
                        : "fd-kitchen-use-card",
                data: { "fd-open-item": sheetId },
            }),
        );
    });
    return raw(
        `<section class="fd-kitchen-use-soon" aria-label="Use soon">${String(sectionHeader({ label: "Use soon", count: items.length, rule: false }))}<div class="fd-kitchen-use-soon__scroll">${cards.join("")}</div></section>`,
    );
}

function fridgeItemRow(item: FridgeItem, view: KitchenFridgeV2View): Html {
    const food = item.foodId ? view.foodsById?.get(item.foodId) : undefined;
    const sheetId = fridgeItemSheetId(item.id);
    const eatFields = {
        qty_amount: String(eatPortionAmount(item, food)),
        return_to: FRIDGE_RETURN_TO,
    };
    const discard = {
        action: `/kitchen/fridge/items/${item.id}/discard`,
        fields: { return_to: FRIDGE_RETURN_TO },
    };
    const eat = {
        action: `/kitchen/fridge/items/${item.id}/eat`,
        fields: eatFields,
    };
    const items: MenuItem[] = [
        { kind: "post", label: "Eat", ...eat },
        {
            kind: "post",
            label: "Add to grocery list",
            action: `/kitchen/fridge/items/${item.id}/add-to-grocery`,
            fields: { from: FRIDGE_RETURN_TO },
        },
        { kind: "opens", label: "Edit amount or expiry", sheetId },
        { kind: "destructive", label: "Discard", ...discard },
    ];
    const lowBelow = lowStockLevel(item, food, view);
    const hasDate = !!item.expiresOn?.trim();
    const urgent = isUrgent(item.expiresOn, view.today);
    const when = !hasDate
        ? null
        : urgent
          ? formatExpiryWhen(view.today, item.expiresOn!)
          : formatFridgeExpiryLabel(item.expiresOn!);
    // The words of a warning go under the title; a plain date sits at the end.
    const warning = urgent || lowBelow != null;
    const subtitle =
        lowBelow != null ? fridgeLowSubtitle(when, lowBelow) : (when ?? "");
    const score = item.foodId ? view.scores?.get(item.foodId) : undefined;
    const rowHtml = String(
        itemRow({
            title: item.displayName,
            meta: formatAmountText(item.quantity.amount, item.quantity.unit),
            score,
            ...(warning
                ? { state: "warning" as const, subtitle }
                : { value: when ?? undefined }),
            trailing: {
                kind: "control",
                html: menu({
                    label: `Actions for ${item.displayName}`,
                    anchor: "more",
                    items,
                }),
            },
            swipe: {
                left: { label: "Discard", form: discard },
                right: {
                    label: "Ate some",
                    icon: "check",
                    form: eat,
                },
            },
            id: `fd-fridge-row-${item.id}`,
            data: { "fd-sheet-row": "", "sheet-id": sheetId },
        }),
    );
    return raw(
        // A function replacement: a string would read `$` in an id as a pattern.
        rowHtml.replace("<li ", () => `<li tabindex="0" `),
    );
}

function locationSection(
    group: FridgeLocationGroup,
    view: KitchenFridgeV2View,
): Html {
    const locId = `fd-kitchen-loc-${group.location.id}`;
    const head = sectionHeader({
        label: group.location.name,
        count: group.items.length,
        rule: false,
        id: locId,
    });
    const rows = group.items.map((item) => fridgeItemRow(item, view));
    return raw(
        `<section class="fd-kitchen-loc" aria-labelledby="${esc(locId)}">${String(head)}${String(listGroup({ rows, label: group.location.name }))}</section>`,
    );
}

/** The locations that hold something, as their sections, in order. */
export function renderFridgeLocationSections(
    view: KitchenFridgeV2View,
): Html[] {
    return groupFridgeItemsByLocation(view.locations, view.items)
        .filter((group) => group.items.length > 0)
        .map((group) => locationSection(group, view));
}

function itemSheetSubtitle(
    item: FridgeItem,
    view: KitchenFridgeV2View,
): string {
    const place = locationName(view.locations, item.locationId);
    if (item.expiresOn && isUrgent(item.expiresOn, view.today)) {
        return `${place} · ${formatSheetExpiryLine(view.today, item.expiresOn).toLowerCase()}`;
    }
    if (item.purchasedOn) {
        return `${place} · bought ${formatFridgeExpiryLabel(item.purchasedOn)}`;
    }
    return place;
}

/** The recipe that uses an expiring item, and how many expiring things it uses. */
function useIn(
    item: FridgeItem,
    view: KitchenFridgeV2View,
): { recipeId: string; name: string; count: number } | null {
    const uses = view.useSoonUses ?? [];
    const recipe = uses.find((use) => use.item.id === item.id)?.recipes[0];
    if (!recipe) return null;
    const count = uses.filter((use) =>
        use.recipes.some((r) => r.recipeId === recipe.recipeId),
    ).length;
    return { recipeId: recipe.recipeId, name: recipe.name, count };
}

function formRow(id: string, action: string, fields: Record<string, string>) {
    const hidden = Object.entries(fields)
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`,
        )
        .join("");
    return `<form id="${esc(id)}" method="post" action="${esc(action)}" class="fd-visually-hidden" aria-hidden="true">${hidden}</form>`;
}

function itemSheet(item: FridgeItem, view: KitchenFridgeV2View): string {
    const open = view.openItemId === item.id;
    const sheetId = fridgeItemSheetId(item.id);
    const food = item.foodId ? view.foodsById?.get(item.foodId) : undefined;
    const eatId = `${sheetId}-eat`;
    const groceryId = `${sheetId}-grocery`;
    const freezeId = `${sheetId}-freeze`;
    const tossId = `${sheetId}-toss`;
    const qtyId = `${sheetId}-qty-form`;
    const error =
        open && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const amount = sheetSection({
        kind: "amount",
        label: "How much is left",
        content: join([
            stepperControl({
                name: "qty_amount",
                label: "Quantity",
                value: item.quantity.amount,
                min: 0,
                step: item.quantity.amount >= 1 ? 1 : 0.1,
                inputStep: "any",
                unit: item.quantity.unit,
                id: `${sheetId}-qty-amt`,
            }),
            raw(
                `<input type="hidden" name="qty_unit" value="${esc(item.quantity.unit)}" />`,
            ),
        ]),
    });
    const quick = (
        label: string,
        icon: "check" | "cart" | "snowflake" | "trash",
        form: string,
    ) => quickAction({ label, icon, caption: false, submit: true, form });
    const actions = sheetSection({
        kind: "custom",
        content: raw(
            `<div class="fd-kitchen-item-actions" role="group" aria-label="Item actions">${join(
                [
                    quick("Ate some", "check", eatId),
                    quick("Add to grocery list", "cart", groceryId),
                    quick("Freeze", "snowflake", freezeId),
                    quick("Discard", "trash", tossId),
                ],
            )}</div>`,
        ),
    });
    const use = useIn(item, view);
    const useRows = use
        ? sheetSection({
              kind: "rows",
              label: "Use in",
              content: listGroup({
                  label: "Use in",
                  rows: [
                      itemRow({
                          title: use.name,
                          subtitle: `Uses ${use.count} ${use.count === 1 ? "thing" : "things"} expiring`,
                          href: `/recipes/${use.recipeId}`,
                          trailing: { kind: "chevron" },
                      }),
                  ],
              }),
          })
        : "";
    const keptIn = sheetSection({
        kind: "chips",
        label: "Kept in",
        content: choiceGroup({
            name: "location_id",
            legend: "Kept in",
            required: true,
            options: view.locations.map((loc) => ({
                value: loc.id,
                label: loc.name,
                selected: loc.id === item.locationId,
            })),
        }),
    });
    const expiresOn = item.expiresOn ?? "";
    const expiryChoices = expiresOn
        ? [
              {
                  value: "keep",
                  label: formatFridgeExpiryLabel(expiresOn),
                  selected: true,
              },
              { value: "none", label: "No date" },
              { value: "pick", label: "Pick a date" },
          ]
        : [
              { value: "none", label: "No date", selected: true },
              { value: "pick", label: "Pick a date" },
          ];
    const expires = sheetSection({
        kind: "chips",
        label: "Expires",
        content: raw(
            `<div class="fd-kitchen-item-expires" data-fd-expires data-fd-expires-keep="${esc(expiresOn)}">${String(
                choiceGroup({
                    name: "expires_mode",
                    legend: "Expires",
                    required: true,
                    options: expiryChoices,
                }),
            )}<div class="fd-kitchen-item-expires__field">${String(
                field({
                    id: `${sheetId}-expires`,
                    label: "Expires on",
                    labelHidden: true,
                    name: "expires_on",
                    type: "date",
                    value: expiresOn,
                }),
            )}</div></div>`,
        ),
    });
    const usual =
        item.foodId != null
            ? listGroup({
                  label: "Usuals",
                  rows: [
                      itemRow({
                          title: "Usually buy",
                          value: "Usuals",
                          href: `/kitchen/usuals/${item.foodId}`,
                          trailing: { kind: "chevron" },
                      }),
                  ],
              })
            : "";
    const body = `${error}<form id="${esc(qtyId)}" method="post" action="/kitchen/fridge/items/${esc(item.id)}">
<input type="hidden" name="return_to" value="${esc(FRIDGE_RETURN_TO)}" />
${amount}
${actions}
${useRows}
${keptIn}
${expires}
${usual}
</form>
${formRow(eatId, `/kitchen/fridge/items/${item.id}/eat`, {
    qty_amount: String(eatPortionAmount(item, food)),
    return_to: FRIDGE_RETURN_TO,
})}
${formRow(groceryId, `/kitchen/fridge/items/${item.id}/add-to-grocery`, { from: FRIDGE_RETURN_TO })}
${formRow(freezeId, `/kitchen/fridge/items/${item.id}/freeze`, {
    expires_on: view.freezeDefaultExpiry,
    return_to: FRIDGE_RETURN_TO,
})}
${formRow(tossId, `/kitchen/fridge/items/${item.id}/discard`, { return_to: FRIDGE_RETURN_TO })}`;
    return sheet({
        id: sheetId,
        placement: "side",
        className: "fd-kitchen-sheet",
        header: {
            kind: "title",
            title: item.displayName,
            subtitle: itemSheetSubtitle(item, view),
        },
        body: raw(body),
        actions: {
            kind: "single",
            primary: { label: "Save", type: "submit", form: qtyId },
        },
        openOnLoad: open,
        focus: "panel",
    });
}

function didYouMeanBlock(view: KitchenFridgeV2View): string {
    const modal = view.didYouMean;
    if (!modal || !view.openModalId || modal.modalId !== view.openModalId) {
        return "";
    }
    return renderDidYouMeanBlock({
        action: modal.action,
        view: modal.view,
    }).replaceAll("did-you-mean-", "fd-did-you-mean-");
}

function usualRow(usual: FridgeAddUsual, locationId: string): Html {
    return itemRow({
        title: usual.name,
        subtitle: usual.subtitle,
        trailing: {
            kind: "add",
            label: `Add ${usual.name}`,
            form: {
                action: ADD_ITEM_ACTION,
                fields: {
                    kind: usual.kind,
                    ...(usual.kind === "supply" ? { name: usual.name } : {}),
                    food_id: usual.foodId,
                    location_id: locationId,
                    qty_amount: String(usual.amount),
                    qty_unit: usual.unit,
                },
            },
        },
        data: { "fd-fridge-usual": usual.name.toLowerCase() },
    });
}

function addItemSheet(view: KitchenFridgeV2View): string {
    if (view.locations.length === 0) return "";
    const defaultLoc = view.locations[0]!.id;
    const addError =
        view.openAdd && view.error
            ? `<p class="fd-kitchen-sheet-error" role="alert">${esc(view.error)}</p>`
            : "";
    const usuals = view.usuals ?? [];
    const usualsSection =
        usuals.length > 0
            ? String(
                  sheetSection({
                      kind: "results",
                      label: "Your usuals",
                      content: listGroup({
                          label: "Your usuals",
                          rows: usuals.map((u) => usualRow(u, defaultLoc)),
                      }),
                  }),
              ) +
              `<p class="fd-kitchen-add__none" data-fd-fridge-none hidden>No usual matches.</p>`
            : "";
    const searchSection = sheetSection({
        kind: "fields",
        content: searchField({
            name: "q",
            id: "fd-fridge-add-q",
            label: "Search foods",
            placeholder: "Search foods",
        }),
    });
    // A failed add (a 4xx re-render) or a did-you-mean opens the hand form.
    const handOpen =
        (view.openAdd && view.error) || view.didYouMean != null ? " open" : "";
    const hand = `<details class="fd-kitchen-hand"${handOpen}><summary class="fd-kitchen-hand__summary">Not here? Add it by hand</summary>
<form id="fd-fridge-add-form" class="fd-kitchen-hand__form" method="post" action="${ADD_ITEM_ACTION}">
<input type="hidden" name="kind" value="food" />
${String(
    field({
        id: "fd-fridge-add-name",
        label: "Name",
        name: "food_name",
        required: true,
        autocomplete: "off",
    }),
)}
${String(
    choiceGroup({
        name: "location_id",
        legend: "Kept in",
        showLegend: true,
        required: true,
        options: view.locations.map((loc) => ({
            value: loc.id,
            label: loc.name,
            selected: loc.id === defaultLoc,
        })),
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
        id: "fd-fridge-add-qty",
    }),
)}
<input type="hidden" name="qty_unit" value="each" />
${String(button({ label: "Add", variant: "primary", type: "submit" }))}
</form></details>`;
    return sheet({
        id: FD_FRIDGE_ADD_SHEET_ID,
        placement: "side",
        className: "fd-kitchen-sheet",
        header: { kind: "title", title: "Add to fridge" },
        body: raw(
            `${addError}${didYouMeanBlock(view)}${String(searchSection)}${usualsSection}${hand}`,
        ),
        openOnLoad: view.openAdd,
        focus: "panel",
    });
}

function addButton(): string {
    return String(
        button({
            label: "Add item",
            round: true,
            icon: "plus",
            attrs: {
                command: "show-modal",
                commandfor: FD_FRIDGE_ADD_SHEET_ID,
            },
        }),
    );
}

export function renderKitchenFridgeBody(view: KitchenFridgeV2View): string {
    const head = renderKitchenHead({
        active: "fridge",
        phoneSubtitle: kitchenFridgeItemCountLabel(view.items.length),
        desktopTools: addButton(),
    });
    const sections = renderFridgeLocationSections(view);
    const useSoon = useSoonStrip(view);
    // Use soon alone on the left, every place on the right (629226); on the
    // phone the columns stack in that order.
    const left = raw(String(useSoon));
    const right = raw(sections.map(String).join(""));
    const empty =
        view.locations.length === 0
            ? emptyState({
                  title: "No places yet",
                  body: "Add a place in Settings, then add items with the button above.",
                  action: button({
                      label: "Fridge places",
                      variant: "secondary",
                      href: APP_PATHS.settingsPlaces,
                  }),
              })
            : view.items.length === 0
              ? emptyState({ title: "Nothing in the fridge yet" })
              : raw("");
    const layout = pageLayout({
        layout: "two-columns",
        left,
        right,
        className: "fd-kitchen-fridge-layout",
    });
    return `${head}
<div class="fd-kitchen-fridge-page">
${kitchenTopTools(addButton())}
${view.error && !view.openItemId && !view.openAdd ? String(settingsErrorBanner(view.error)) : ""}
${String(layout)}
${String(empty)}
${view.items.map((item) => itemSheet(item, view)).join("")}
${addItemSheet(view)}
</div>`;
}

export function renderKitchenFridgeV2Page(view: KitchenFridgeV2View): string {
    return renderAppShell({
        ...view.chrome,
        title: "Fridge",
        active: "fridge",
        v2Kitchen: "fridge",
        body: renderKitchenFridgeBody(view),
    });
}

export function buildPreviewKitchenFridgeView(
    chrome: KitchenFridgeV2View["chrome"],
    today: string,
    overrides: Partial<KitchenFridgeV2View> = {},
): KitchenFridgeV2View {
    const locations = overrides.locations ?? [
        {
            id: "loc-fridge",
            householdId: "hh",
            name: "Fridge",
            sortOrder: 0,
        },
    ];
    const items = overrides.items ?? [
        {
            id: "it-1",
            householdId: "hh",
            locationId: "loc-fridge",
            kind: "food",
            displayName: "Eggs",
            quantity: { amount: 9, unit: "each" },
            foodId: "f-eggs",
            expiresOn: "2026-11-19",
        },
    ];
    return {
        chrome,
        today,
        locations,
        items,
        foodsById: overrides.foodsById ?? new Map(),
        freezeDefaultExpiry:
            overrides.freezeDefaultExpiry ?? defaultFreezeExpiry(today),
        ...overrides,
    };
}
