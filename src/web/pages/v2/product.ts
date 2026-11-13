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
import { esc } from "../../components/v2/html.js";
import { iconCart } from "../../components/v2/icons.js";
import { foodRow, rowList, sectionHeader } from "../../components/v2/rows.js";
import { renderAppShell } from "../../shell.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { APP_PATHS } from "../../route-map.js";
import { formatBarcodeDisplay } from "./format-barcode-display.js";
import {
    PRODUCT_MACRO_ROWS,
    productNutrition,
    subtitleServingLabel,
    type ProductNutritionHead,
    type ProductNutritionTable,
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
    nutrition: ProductNutritionTable;
    nutritionHead: ProductNutritionHead;
    score: ProductScoreSection | null;
    backHref: string;
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
    const lines: ProductStockLine[] = [];
    for (const [locationId, items] of byLocation) {
        const loc = locById.get(locationId);
        const locationName = loc?.name ?? "Kitchen";
        const parts = items.map((row) =>
            formatQuantityDisplayParts(row.quantity.amount, row.quantity.unit),
        );
        const quantityLabel = parts.length === 1 ? parts[0]! : parts.join(", ");
        lines.push({ locationName, quantityLabel });
    }
    lines.sort((a, b) => a.locationName.localeCompare(b.locationName));
    return lines;
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

function productNutritionView(
    food: Food,
): Pick<ProductPageView, "nutrition" | "nutritionHead"> {
    const { table, head } = productNutrition(food);
    return { nutrition: table, nutritionHead: head };
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

function productBackIcon(): string {
    return `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 18 9 12 15 6"/></svg>`;
}

function productTopBar(backHref: string): string {
    const cart = String(iconCart());
    return `<header class="fd-product-top fd-settings-phone-top">
<a class="fd-settings-phone-back fd-product-top__back" href="${esc(backHref)}" data-turbo="false" aria-label="Back">${productBackIcon()}</a>
<span class="fd-settings-phone-top__balance" aria-hidden="true"></span>
<a class="fd-settings-phone-back fd-product-top__cart" href="${esc(APP_PATHS.kitchenGroceries)}" aria-label="Groceries">${cart}</a>
</header>`;
}

/** "Per portion" over "30 ml"; a screen reader hears "Per portion · 30 ml". */
function servingHeadCell(serving: { name: string; amount: string | null }) {
    if (serving.amount == null) return `<span>${esc(serving.name)}</span>`;
    return `<span><span class="fd-product-nutrition__head-name">${esc(serving.name)}</span><span class="visually-hidden"> · </span><span class="fd-product-nutrition__head-amount">${esc(serving.amount)}</span></span>`;
}

function nutritionSection(view: ProductPageView): string {
    const { serving, per100, servingNote } = view.nutritionHead;
    const hasServing = serving != null;
    const head = hasServing
        ? `<div class="fd-product-nutrition__head"><span class="fd-product-nutrition__head-spacer" aria-hidden="true"></span>${servingHeadCell(serving)}<span>${esc(per100)}</span></div>`
        : `<div class="fd-product-nutrition__head fd-product-nutrition__head--one"><span class="fd-product-nutrition__head-spacer" aria-hidden="true"></span><span>${esc(per100)}</span></div>`;
    const rowClass = hasServing
        ? "fd-product-nutrition__row"
        : "fd-product-nutrition__row fd-product-nutrition__row--one";
    const rows = PRODUCT_MACRO_ROWS.map((row) => {
        const col = view.nutrition[row.key];
        const lead = hasServing
            ? `<span class="fd-product-nutrition__val">${esc(col.perServing ?? "–")}</span>`
            : "";
        return `<div class="${rowClass}"><span class="fd-product-nutrition__label">${esc(row.label)}</span>${lead}<span class="fd-product-nutrition__val">${esc(col.per100g)}</span></div>`;
    }).join("");
    const note = servingNote
        ? `<p class="fd-product-nutrition__serving">${esc(servingNote)}</p>`
        : "";
    return `${String(sectionHeader({ title: "Nutrition", level: 2 }))}<section class="fd-product-nutrition" aria-label="Nutrition">${note}${head}${rows}</section>`;
}

function stockSection(stock: ProductStockLine[]): string {
    if (stock.length === 0) return "";
    const rows = stock.map((line) =>
        foodRow({
            title: line.locationName,
            trailing: line.quantityLabel,
        }),
    );
    return `${String(sectionHeader({ title: "In the kitchen", level: 2 }))}${String(rowList(rows))}`;
}

function scoreBlock(view: ProductPageView): string {
    if (!view.score) return "";
    return renderProductScoreSection(view.food, view.score);
}

function productActions(view: ProductPageView): string {
    const pick = esc(
        JSON.stringify(productLogPickPayload(view.food, view.barcodes[0])),
    );
    const grocery = productGroceryPostPath(view.food.id);
    const cart = String(iconCart());
    return `<div class="fd-product-actions">
<form class="fd-product-actions__grocery" method="post" action="${esc(grocery)}">
<button type="submit" class="fd-btn fd-product-actions__add">${cart}<span>Add to groceries</span></button>
</form>
<button type="button" class="fd-btn fd-btn--primary fd-product-actions__log" data-fd-log-pick="${pick}">Log it</button>
</div>`;
}

export function renderProductBody(view: ProductPageView): string {
    const subtitle = productSubtitle(view.food, view.barcodes);
    const error = view.error
        ? `<p class="fd-product-error" role="alert">${esc(view.error)}</p>`
        : "";
    const stockFirst = view.stock.length > 0 ? stockSection(view.stock) : "";
    return `<article class="fd-product-page">
${productTopBar(view.backHref)}
<header class="fd-product-header">
<h1 class="fd-product-title">${esc(view.food.name)}</h1>
${subtitle ? `<p class="fd-product-subtitle">${esc(subtitle)}</p>` : ""}
</header>
${error}
${stockFirst}
${scoreBlock(view)}
${nutritionSection(view)}
${productActions(view)}
</article>`;
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

export function renderProductBarcodeUnknownPage(
    view: ProductBarcodeUnknownView,
): string {
    const error = view.error
        ? `<p class="fd-product-error" role="alert">${esc(view.error)}</p>`
        : "";
    const action = productBarcodeUnknownPostPath(view.barcode);
    const copy = view.lookupFailed
        ? "Could not look up this barcode right now. Try again, or add it as a new food."
        : "Open Food Facts does not know this barcode yet. Add it as a new food and the barcode will stay attached.";
    const body = `<article class="fd-product-page fd-product-page--unknown">
${productTopBar(view.backHref)}
<header class="fd-product-header">
<h1 class="fd-product-title">Unknown barcode</h1>
<p class="fd-product-subtitle">${esc(formatBarcodeDisplay(view.barcode))}</p>
</header>
${error}
<p class="fd-product-unknown-copy">${esc(copy)}</p>
<form class="fd-product-unknown-form native" method="post" action="${esc(action)}">
<label class="field">Name<input name="name" required autocomplete="off" placeholder="Food name" /></label>
<button type="submit" class="fd-btn fd-btn--primary">Add as a new food</button>
</form>
</article>`;
    return renderAppShell({
        ...view.chrome,
        title: "Unknown barcode",
        active: "none",
        v2Active: "none",
        body,
    });
}

export function renderProductBarcodeInvalidPage(
    view: ProductBarcodeInvalidView,
): string {
    const body = `<article class="fd-product-page fd-product-page--unknown">
${productTopBar(view.backHref)}
<header class="fd-product-header">
<h1 class="fd-product-title">Invalid barcode</h1>
<p class="fd-product-subtitle">${esc(view.barcode)}</p>
</header>
<p class="fd-product-unknown-copy">Enter 8–14 digits.</p>
<p><a class="fd-text-link" href="${esc(view.backHref)}">Back</a></p>
</article>`;
    return renderAppShell({
        ...view.chrome,
        title: "Invalid barcode",
        active: "none",
        v2Active: "none",
        body,
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
    const score = await loadProductScoreSection(
        member.householdId,
        food,
        userId,
    );
    return {
        chrome,
        food,
        barcodes,
        stock,
        ...productNutritionView(food),
        score,
        backHref,
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
    return { chrome, barcode, backHref: PRODUCT_DEFAULT_BACK };
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
