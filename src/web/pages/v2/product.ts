import type { Food } from "../../../domain/foods.js";
import type {
    FridgeItem,
    FridgeLocation,
    FridgeSnapshot,
} from "../../../domain/fridge.js";
import { listFridge } from "../../../domain/fridge.js";
import { foodLogFactors, unitHintsForLog } from "../../../domain/log-search.js";
import type { AppChromeBase } from "../../attention.js";
import { viewerChromeWithAttention } from "../../attention.js";
import { getHouseholdMembership } from "../../../db/household.js";
import { getProfile } from "../../../db/profiles.js";
import { liveFoodsStore } from "../../../db/foods.js";
import { liveFridgeStore } from "../../../db/fridge.js";
import { liveGroceryStore } from "../../../db/grocery.js";
import type { GroceryLine } from "../../../domain/grocery.js";
import { button } from "../../components/v2/button.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { tableRows } from "../../components/v2/table-row.js";
import { renderAppShell } from "../../shell.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { APP_PATHS } from "../../route-map.js";
import { formatBarcodeDisplay } from "./format-barcode-display.js";
import {
    productNutritionTable,
    subtitleServingLabel,
    type ProductNutritionTableData,
} from "./product-nutrition.js";
import type { ProductScoreSection } from "./product-score.js";
import {
    loadProductScoreSection,
    renderProductScoreSection,
} from "./product-score.js";

export type ProductStockLine = {
    locationName: string;
    quantityLabel: string;
};

export type ProductPageView = {
    chrome: AppChromeBase;
    food: Food;
    barcodes: string[];
    stock: ProductStockLine[];
    nutrition: ProductNutritionTableData;
    score: ProductScoreSection | null;
    backHref: string;
    /** The food (or its usual product) has an unchecked grocery line. */
    onGroceryList?: boolean;
    error?: string;
};

export type ProductBarcodeUnknownView = {
    chrome: AppChromeBase;
    barcode: string;
    backHref: string;
    lookupFailed?: boolean;
    error?: string;
};

export type ProductBarcodeInvalidView = {
    chrome: AppChromeBase;
    barcode: string;
    backHref: string;
};

export const PRODUCT_DEFAULT_BACK = APP_PATHS.kitchenFridge;

export function productPagePath(foodId: string): string {
    return `/foods/${encodeURIComponent(foodId)}`;
}

export function productGroceryPostPath(foodId: string): string {
    return `/foods/${encodeURIComponent(foodId)}/add-to-grocery`;
}

export function productBarcodeUnknownPostPath(barcode: string): string {
    return `/foods/by-barcode/${encodeURIComponent(barcode)}`;
}

/**
 * Whether Add to groceries on this page has nothing left to add: an unticked
 * line for this food itself, or for the plain food and its usual product when
 * this page is one of the two. A sibling product's line does not count, so
 * that product stays addable from its own page (`onGroceryList` matches the
 * whole family and is for notices and restock, not for this).
 */
export function productOnGroceryList(
    food: Pick<Food, "id" | "genericFoodId" | "usualProductId">,
    catalog: readonly Pick<Food, "id" | "usualProductId">[],
    lines: readonly Pick<GroceryLine, "foodId" | "checked">[],
): boolean {
    const same = new Set<string>([food.id]);
    if (food.genericFoodId == null) {
        if (food.usualProductId) same.add(food.usualProductId);
    } else {
        const plain = catalog.find((row) => row.id === food.genericFoodId);
        if (plain?.usualProductId === food.id) same.add(plain.id);
    }
    return lines.some(
        (line) => !line.checked && line.foodId != null && same.has(line.foodId),
    );
}

export function productStockForFood(
    snapshot: FridgeSnapshot,
    foodId: string,
): ProductStockLine[] {
    const locById = new Map<string, FridgeLocation>(
        snapshot.locations.map((loc) => [loc.id, loc]),
    );
    const byLocation = new Map<string, FridgeItem[]>();
    for (const item of snapshot.items) {
        if (item.foodId !== foodId) continue;
        const bucket = byLocation.get(item.locationId) ?? [];
        bucket.push(item);
        byLocation.set(item.locationId, bucket);
    }
    const lines: (ProductStockLine & { order: number })[] = [];
    for (const [locationId, items] of byLocation) {
        const loc = locById.get(locationId);
        const locationName = loc?.name ?? "Kitchen";
        const parts = items.map((row) =>
            formatQuantityDisplayParts(row.quantity.amount, row.quantity.unit),
        );
        const quantityLabel = parts.length === 1 ? parts[0]! : parts.join(", ");
        lines.push({
            locationName,
            quantityLabel,
            order: loc?.sortOrder ?? Number.MAX_SAFE_INTEGER,
        });
    }
    // The household's own order of places, as the fridge lists them.
    lines.sort(
        (a, b) =>
            a.order - b.order || a.locationName.localeCompare(b.locationName),
    );
    return lines.map(({ locationName, quantityLabel }) => ({
        locationName,
        quantityLabel,
    }));
}

export function productLogPickPayload(
    food: Food,
    barcode: string | undefined,
): Record<string, unknown> {
    const factors = foodLogFactors(food);
    const hints = unitHintsForLog(factors);
    const unit = hints[0] ?? "g";
    return {
        id: food.id,
        name: food.name,
        brand: food.brand,
        food_id: food.id,
        kcal_per_100g: food.calories,
        protein_per_100g: food.proteinG,
        carbs_per_100g: food.carbsG,
        fat_per_100g: food.fatG,
        // The same basis, serving and hints the log search gives this food,
        // so the first hint (the portion, when there is one) leads.
        ...factors,
        unit_hints: hints,
        source: "food",
        barcode: barcode ?? undefined,
        amount: unit === "portion" ? 1 : 100,
        unit,
    };
}

function productNutritionView(food: Food): Pick<ProductPageView, "nutrition"> {
    return { nutrition: productNutritionTable(food) };
}

function productSubtitle(food: Food, barcodes: string[]): string {
    const bits: string[] = [];
    if (food.brand?.trim()) bits.push(food.brand.trim());
    const serving = subtitleServingLabel(food);
    if (serving) bits.push(serving);
    const code = barcodes[0];
    if (code) bits.push(formatBarcodeDisplay(code));
    return bits.join(" · ");
}

/**
 * The page: a Detail bar and the title block over the content, in the single
 * 720 column. The bar's back button goes where the person came from.
 */
function productPage(opts: {
    detail: Html;
    content: string;
    className?: string;
}): string {
    return `<article class="fd-product-page${opts.className ? ` ${opts.className}` : ""}">${pageLayout({ layout: "single", header: opts.detail, content: raw(opts.content) })}</article>`;
}

/** A header and its list, kept 12 px apart; the page spaces the groups. */
function productGroup(...parts: string[]): string {
    return `<div class="fd-product-group">${parts.join("")}</div>`;
}

function productError(message: string | undefined): string {
    return message
        ? `<p class="fd-product-error" role="alert">${esc(message)}</p>`
        : "";
}

/** "In the fridge" for a plain place, the household's own words otherwise. */
export function stockPlaceTitle(locationName: string): string {
    const name = locationName.trim().replace(/^the\s+/i, "");
    const plain = /^[A-Z]?[a-z]+$/.test(name) ? name.toLowerCase() : name;
    return `In the ${plain}`;
}

function stockSection(stock: ProductStockLine[]): string {
    if (stock.length === 0) return "";
    const rows = stock.map((line) =>
        itemRow({
            title: stockPlaceTitle(line.locationName),
            meta: line.quantityLabel,
            lead: {
                kind: "icon",
                name: /freez/i.test(line.locationName) ? "snowflake" : "fridge",
            },
            href: APP_PATHS.kitchenFridge,
            trailing: { kind: "chevron" },
        }),
    );
    return String(listGroup({ rows, label: "In the kitchen" }));
}

function scoreBlock(view: ProductPageView): string {
    if (!view.score) return "";
    return renderProductScoreSection(view.food, view.score);
}

/** Every figure the page could show is unknown: nothing to score from. */
function hasNoNutrition(table: ProductNutritionTableData): boolean {
    return table.rows.every((row) => row.cols.every((col) => col == null));
}

function nutritionSection(view: ProductPageView): string {
    const { head, rows } = view.nutrition;
    const table = tableRows({
        label: "Nutrition",
        rows: [
            { kind: "header", label: " ", cols: head },
            ...rows.map((row) => ({ label: row.label, cols: row.cols })),
        ],
    });
    // Nothing to score from: say so under the empty table.
    const noScore =
        !view.score && hasNoNutrition(view.nutrition)
            ? String(
                  emptyState({
                      title: "No score yet",
                      body: "Add nutrition to score it",
                  }),
              )
            : "";
    return `${sectionHeader({ label: "Nutrition", rule: false })}${table}${noScore}`;
}

function productActions(view: ProductPageView): string {
    const pick = JSON.stringify(
        productLogPickPayload(view.food, view.barcodes[0]),
    );
    // On the list already: the control says so and opens the list, so a second
    // press cannot add a duplicate line.
    const add = view.onGroceryList
        ? button({
              label: "On your list",
              icon: "check",
              href: APP_PATHS.kitchenGroceries,
          })
        : raw(
              `<form method="post" action="${esc(productGroceryPostPath(view.food.id))}">${button({ label: "Add to groceries", type: "submit" })}</form>`,
          );
    const log = button({
        label: "Log it",
        variant: "primary",
        attrs: { "data-fd-log-pick": pick },
    });
    return `<div class="fd-product-actions">${add}${log}</div>`;
}

/** The Detail bar's ⋯: the food's own edit, which lives with the saved foods. */
function productMenu(food: Food): Html {
    return menu({
        label: `Actions for ${food.name}`,
        anchor: "more",
        items: [
            {
                kind: "link",
                label: "Edit in Saved foods",
                href: `${APP_PATHS.settingsSaved}?q=${encodeURIComponent(food.name)}`,
            },
        ],
    });
}

export function renderProductBody(view: ProductPageView): string {
    const detail = detailBar({
        back: { href: view.backHref },
        trailing: { slot: productMenu(view.food) },
        className: "fd-product-detail",
    });
    const title = pageHeader({
        title: view.food.name,
        subtitle: productSubtitle(view.food, view.barcodes) || undefined,
    });
    const content = [
        productError(view.error),
        productGroup(String(title), stockSection(view.stock)),
        scoreBlock(view),
        productGroup(nutritionSection(view), productActions(view)),
    ].join("");
    return productPage({ detail, content });
}

export function renderProductV2Page(view: ProductPageView): string {
    return renderAppShell({
        ...view.chrome,
        title: view.food.name,
        active: "none",
        v2Active: "none",
        body: renderProductBody(view),
    });
}

/** A barcode with nothing to open: the code, one line of why, and what comes next. */
function barcodePage(opts: {
    chrome: AppChromeBase;
    title: string;
    /** What the page names: the code as the person should read it. */
    heading: string;
    body: string;
    backHref: string;
    content?: string;
}): string {
    const detail = detailBar({
        title: opts.title,
        back: { href: opts.backHref },
        balance: true,
        className: "fd-product-detail",
    });
    const content = productGroup(
        String(emptyState({ title: opts.heading, body: opts.body })),
        opts.content ?? "",
    );
    return renderAppShell({
        ...opts.chrome,
        title: opts.title,
        active: "none",
        v2Active: "none",
        body: productPage({
            detail,
            content,
            className: "fd-product-page--unknown",
        }),
    });
}

export function renderProductBarcodeUnknownPage(
    view: ProductBarcodeUnknownView,
): string {
    const action = productBarcodeUnknownPostPath(view.barcode);
    const form = `<form class="fd-product-unknown-form" method="post" action="${esc(action)}">${field({ id: "product-name", label: "Name", name: "name", required: true, autocomplete: "off", placeholder: "Food name" })}${button({ label: "Add as a new food", variant: "primary", type: "submit" })}</form>`;
    return barcodePage({
        chrome: view.chrome,
        title: "Unknown barcode",
        heading: formatBarcodeDisplay(view.barcode),
        body: view.lookupFailed
            ? "Could not look up this barcode right now"
            : "Not in Open Food Facts yet",
        backHref: view.backHref,
        content: `${productError(view.error)}${form}`,
    });
}

export function renderProductBarcodeInvalidPage(
    view: ProductBarcodeInvalidView,
): string {
    return barcodePage({
        chrome: view.chrome,
        title: "Invalid barcode",
        heading: view.barcode,
        body: "Enter 8–14 digits",
        backHref: view.backHref,
    });
}

export async function loadProductPageData(
    userId: string,
    foodId: string,
    backHref: string = PRODUCT_DEFAULT_BACK,
): Promise<ProductPageView | null> {
    const member = await getHouseholdMembership(userId);
    if (!member) return null;
    const profile = await getProfile(userId);
    const chrome = await viewerChromeWithAttention(profile, member);
    const foods = liveFoodsStore();
    const food = await foods.getFood(member.householdId, foodId);
    if (!food || food.archivedAt) return null;
    const barcodes = await foods.listBarcodes(member.householdId, foodId);
    const fridge = await listFridge(liveFridgeStore(), member.householdId);
    const stock = productStockForFood(fridge, foodId);
    const [catalog, lines] = await Promise.all([
        foods.listFoods(member.householdId),
        liveGroceryStore().listLines(member.householdId),
    ]);
    const onList = productOnGroceryList(food, catalog, lines);
    const score = await loadProductScoreSection(
        member.householdId,
        food,
        userId,
        undefined,
        chrome.identity?.avatarVersions ?? new Map(),
    );
    return {
        chrome,
        food,
        barcodes,
        stock,
        ...productNutritionView(food),
        score,
        backHref,
        onGroceryList: onList,
    };
}

export async function loadProductBarcodeUnknownData(
    userId: string,
    barcode: string,
    backHref: string = PRODUCT_DEFAULT_BACK,
): Promise<ProductBarcodeUnknownView | null> {
    const member = await getHouseholdMembership(userId);
    if (!member) return null;
    const profile = await getProfile(userId);
    const chrome = await viewerChromeWithAttention(profile, member);
    return { chrome, barcode, backHref };
}

export async function loadProductBarcodeInvalidData(
    userId: string,
    barcode: string,
): Promise<ProductBarcodeInvalidView | null> {
    const member = await getHouseholdMembership(userId);
    if (!member) return null;
    const profile = await getProfile(userId);
    const chrome = await viewerChromeWithAttention(profile, member);
    return { chrome, barcode, backHref: PRODUCT_DEFAULT_BACK };
}

/** Fixture builder for app-preview (no database). */
export function buildPreviewProductPageView(
    chrome: AppChromeBase,
    food: Food,
    opts: {
        barcodes?: string[];
        stock?: ProductStockLine[];
        score?: ProductScoreSection | null;
        backHref?: string;
    } = {},
): ProductPageView {
    return {
        chrome,
        food,
        barcodes: opts.barcodes ?? [],
        stock: opts.stock ?? [],
        ...productNutritionView(food),
        score: opts.score ?? null,
        backHref: opts.backHref ?? PRODUCT_DEFAULT_BACK,
    };
}
