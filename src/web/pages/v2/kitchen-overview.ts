import type { GrocerySnapshot } from "../../../domain/grocery.js";
import type { GroceryLineView, GroceryStoreView } from "../grocery.js";
import { esc } from "../../components/v2/html.js";
import { APP_PATHS } from "../../route-map.js";
import { sheetTrigger } from "../../components/v2/sheet.js";
import {
    type KitchenGroceriesLineMeta,
    groceryCheckedCount,
    groceryHeaderSubtitle,
    groceryOpenLineCount,
    renderGroceryOverviewSections,
    renderGroceryStoreChips,
} from "./kitchen-groceries.js";
const FD_FRIDGE_ADD_SHEET_ID = "fd-fridge-add";

export const KITCHEN_GROCERIES_TAB_HREF = APP_PATHS.kitchenGroceries;
export const KITCHEN_OVERVIEW_RETURN_TO = "/kitchen/fridge";

const DESKTOP_KITCHEN_TABS = [
    { id: "fridge" as const, label: "Overview", href: APP_PATHS.kitchenFridge },
    {
        id: "groceries" as const,
        label: "Groceries",
        href: APP_PATHS.kitchenGroceries,
    },
    { id: "usuals" as const, label: "Usuals", href: APP_PATHS.kitchenUsuals },
];

export type KitchenFridgeGroceryOverview = {
    stores: GroceryStoreView[];
    noStoreLines: GroceryLineView[];
    lineMeta: ReadonlyMap<string, KitchenGroceriesLineMeta>;
    openLineCount: number;
};

export function kitchenFridgeItemCountLabel(count: number): string {
    return count === 1 ? "1 item" : `${count} items`;
}

export function kitchenFridgeDesktopSubtitle(
    itemCount: number,
    groceryOpenCount: number,
): string {
    return `${kitchenFridgeItemCountLabel(itemCount)} · ${groceryHeaderSubtitle(groceryOpenCount)}`;
}

export function buildKitchenFridgeGroceryOverview(
    snapshot: GrocerySnapshot,
): KitchenFridgeGroceryOverview {
    const lineMeta = new Map<string, KitchenGroceriesLineMeta>();
    const asLineView = (
        line: GrocerySnapshot["lines"][number],
        storeName: string,
        sectionName: string,
    ): GroceryLineView => {
        lineMeta.set(line.id, {
            plainFoodName: null,
            isUsual: false,
            allergenWarning: null,
            storeName,
            sectionName,
        });
        return {
            ...line,
            alreadyHave: null,
            lastLocationId: null,
            usualProductName: null,
            usualPickerHref: null,
            putAwayProducts: null,
            putAwayProductId: null,
        };
    };
    const stores: GroceryStoreView[] = snapshot.stores.map((store) => {
        const storeLines = snapshot.lines.filter(
            (line) => line.storeId === store.id,
        );
        const sections = snapshot.sections
            .filter(
                (section) =>
                    section.storeId === store.id &&
                    (!section.hidden ||
                        storeLines.some(
                            (line) => line.sectionId === section.id,
                        )),
            )
            .map((section) => ({
                ...section,
                lines: storeLines
                    .filter((line) => line.sectionId === section.id)
                    .map((line) => asLineView(line, store.name, section.name)),
            }));
        return { ...store, sections, rules: [] };
    });
    const storeIds = new Set(snapshot.stores.map((store) => store.id));
    const noStoreLines = snapshot.lines
        .filter((line) => !storeIds.has(line.storeId))
        .map((line) => asLineView(line, "No store", "No store"));
    return {
        stores,
        noStoreLines,
        lineMeta,
        openLineCount: groceryOpenLineCount(snapshot.lines),
    };
}

export function renderKitchenDesktopSeg(
    active: (typeof DESKTOP_KITCHEN_TABS)[number]["id"],
): string {
    const links = DESKTOP_KITCHEN_TABS.map((tab) => {
        const on =
            tab.id === active
                ? ' class="fd-seg-btn fd-seg-btn--on" aria-current="page"'
                : ' class="fd-seg-btn"';
        return `<a${on} href="${esc(tab.href)}">${esc(tab.label)}</a>`;
    }).join("");
    return `<nav class="fd-seg fd-kitchen-overview-seg" aria-label="Kitchen sections">${links}</nav>`;
}

function desktopKitchenSeg(): string {
    return renderKitchenDesktopSeg("fridge");
}

export function renderKitchenOverviewDesktopHead(
    itemCount: number,
    groceryOpenCount: number,
): string {
    const phoneCount = esc(kitchenFridgeItemCountLabel(itemCount));
    const desktopCount = esc(
        kitchenFridgeDesktopSubtitle(itemCount, groceryOpenCount),
    );
    const add = sheetTrigger({
        target: FD_FRIDGE_ADD_SHEET_ID,
        label: "Add item",
        className: "fd-btn fd-btn--primary fd-kitchen-overview-add",
    });
    return `<header class="fd-kitchen-overview-head">
<div class="fd-kitchen-overview-head__title">
<h1 class="fd-kitchen-fridge-title">Kitchen<span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--phone">${phoneCount}</span><span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--desktop">${desktopCount}</span></h1>
</div>
<div class="fd-kitchen-overview-head__tools">
${desktopKitchenSeg()}
${add}
</div>
</header>`;
}

export function renderKitchenOverviewGroceriesCard(
    overview: KitchenFridgeGroceryOverview,
): string {
    const openCount = overview.openLineCount;
    const checked = groceryCheckedCount({
        stores: overview.stores,
        noStoreLines: overview.noStoreLines,
        checkedLines: [],
    });
    const chips = renderGroceryStoreChips({
        stores: overview.stores,
        noStoreLines: overview.noStoreLines,
        selectedStoreId: null,
    });
    const sections = renderGroceryOverviewSections({
        stores: overview.stores,
        noStoreLines: overview.noStoreLines,
        lineMeta: overview.lineMeta,
        selectedStoreId: null,
    });
    const empty =
        openCount === 0 && checked === 0
            ? `<p class="fd-kitchen-overview-groceries__empty">Nothing on the list</p>`
            : "";
    const putAway =
        checked > 0
            ? `<a class="fd-btn fd-btn--primary fd-kitchen-overview-grocery-put" href="/kitchen/groceries?put-away=1">Put ${checked === 1 ? "1" : checked} away</a>`
            : "";
    return `<aside class="fd-kitchen-overview-groceries" aria-labelledby="fd-kitchen-overview-groceries-title"><div class="fd-kitchen-overview-groceries__head"><h2 id="fd-kitchen-overview-groceries-title" class="fd-kitchen-overview-groceries__title">Groceries</h2><p class="fd-kitchen-overview-groceries__count">${esc(groceryHeaderSubtitle(openCount))}</p></div>${chips}${sections}${empty}${putAway}</aside>`;
}

export function wrapKitchenOverviewColumns(
    locationsHtml: string,
    groceriesCard: string,
): string {
    return `<div class="fd-kitchen-overview-columns"><div class="fd-kitchen-overview-locs">${locationsHtml}</div>${groceriesCard}</div>`;
}
