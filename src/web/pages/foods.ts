import type { AppChromeBase } from "../attention.js";
import { escapeHtml, renderAppShell } from "../shell.js";
import { ALLERGEN_LABELS, NAMED_ALLERGENS } from "../../domain/rules.js";
import { FOOD_QUANTITY_UNITS } from "../../domain/quantity.js";
import type { GroceryStore } from "../../domain/settings.js";
import type { Food } from "../../domain/foods.js";
import { suggestFoodFor } from "../../domain/foods.js";
import { quantityUnitOptionLabel } from "../display-quantity.js";
import { renderHouseholdNav } from "../components/settings-nav.js";
import { sharedDialogItem } from "../components/shared-dialog.js";
import {
    renderLinkProductPrompt,
    type LinkProductPromptView,
    LINK_PRODUCT_MODAL_ID,
} from "../components/link-product-prompt.js";
import {
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
    type ModalFill,
    field,
} from "../components/ui.js";

export type FoodsSettingsView = {
    chrome: AppChromeBase;
    foods: Array<Food & { aliases: string[] }>;
    stores: GroceryStore[];
    error?: string;
    openModalId?: string;
    linkProductPrompt?: LinkProductPromptView | null;
};

export const FOODS_MERGE_MODAL_ID = "foods-merge";
/** One edit dialog for every food. Triggers fill it; routes still reopen `food-edit-<id>`. */
export const FOOD_EDIT_MODAL_ID = "food-edit";
export const FOOD_BELONGS_MODAL_ID = "food-belongs";
const FOOD_EDIT_PREFIX = "food-edit-";
const FOOD_BELONGS_PREFIX = "food-belongs-";

type FoodRow = Food & { aliases: string[] };

function modalOpen(view: FoodsSettingsView, id: string): boolean {
    return view.openModalId === id;
}

function editReopenFood(view: FoodsSettingsView): FoodRow | null {
    return (
        sharedDialogItem({
            openModalId: view.openModalId,
            prefix: FOOD_EDIT_PREFIX,
            lookup: (id) => view.foods.find((food) => food.id === id) ?? null,
        })?.item ?? null
    );
}

function belongsReopenFood(view: FoodsSettingsView): FoodRow | null {
    return (
        sharedDialogItem({
            openModalId: view.openModalId,
            prefix: FOOD_BELONGS_PREFIX,
            lookup: (id) => view.foods.find((food) => food.id === id) ?? null,
        })?.item ?? null
    );
}

function liveProducts(view: FoodsSettingsView, plainId: string): FoodRow[] {
    return view.foods.filter(
        (row) => row.genericFoodId === plainId && !row.archivedAt,
    );
}

function plainFoodOptions(
    view: FoodsSettingsView,
    product: FoodRow,
): FoodRow[] {
    return view.foods.filter(
        (row) =>
            !row.archivedAt &&
            !row.genericFoodId &&
            row.kind === product.kind &&
            row.id !== product.id,
    );
}

function isTopLevelRow(food: FoodRow, view: FoodsSettingsView): boolean {
    if (food.archivedAt) return true;
    if (!food.genericFoodId) return true;
    return false;
}

function nutrientInput(
    id: string,
    name: string,
    label: string,
    value: number | null | undefined,
): string {
    return `<label>${escapeHtml(label)}
<input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="number" min="0" step="0.1" value="${value == null ? "" : escapeHtml(String(value))}" />
</label>`;
}

function editProductFieldsTemplate(
    view: FoodsSettingsView,
    food: FoodRow,
): string {
    if (food.archivedAt) return "";
    if (food.genericFoodId) {
        const plains = plainFoodOptions(view, food);
        const options = [
            `<option value="">None</option>`,
            ...plains.map((row) => {
                const sel = row.id === food.genericFoodId ? " selected" : "";
                return `<option value="${escapeHtml(row.id)}"${sel}>${escapeHtml(row.name)}</option>`;
            }),
        ].join("");
        return `${field({
            id: `food-edit-belongs-${food.id}`,
            label: "Belongs to",
            control: `<select id="food-edit-belongs-${food.id}" name="generic_food_id">${options}</select>`,
        })}`;
    }
    const products = liveProducts(view, food.id);
    if (products.length === 0) return "";
    const names = products
        .map((p) => `<li>${escapeHtml(p.name)}</li>`)
        .join("");
    const usualOptions = [
        `<option value="">None</option>`,
        ...products.map((p) => {
            const sel = p.id === food.usualProductId ? " selected" : "";
            return `<option value="${escapeHtml(p.id)}"${sel}>${escapeHtml(p.name)}</option>`;
        }),
    ].join("");
    return `<div class="psec">
<p class="subsection-title">Products</p>
<ul class="list">${names}</ul>
</div>
${field({
    id: `food-edit-usual-${food.id}`,
    label: "Usual product",
    control: `<select id="food-edit-usual-${food.id}" name="usual_product_id">${usualOptions}</select>`,
})}`;
}

function foodFill(view: FoodsSettingsView, food: FoodRow): ModalFill {
    const extra = editProductFieldsTemplate(view, food);
    return {
        action: `/household/items/${food.id}`,
        title: `Edit ${food.name}`,
        fields: {
            food_id: food.id,
            name: food.name,
            brand: food.brand ?? "",
            aliases: food.aliases.join(", "),
            default_unit: food.defaultUnit,
            grams_per_each: food.gramsPerEach,
            grams_per_ml: food.gramsPerMl,
            calories: food.calories,
            protein_g: food.proteinG,
            carbs_g: food.carbsG,
            fat_g: food.fatG,
            fiber_g: food.fiberG,
            sugar_g: food.sugarG,
            alcohol_g: food.alcoholG,
            caffeine_mg: food.caffeineMg,
            allergens: food.allergens.join(","),
            archived: Boolean(food.archivedAt),
            usual_amount:
                food.usualAmount != null ? String(food.usualAmount.amount) : "",
            usual_unit: food.usualAmount?.unit ?? "",
            usual_store_id: food.usualStoreId ?? "",
        },
        templates: extra
            ? { product_fields: `food-edit-product-fields-${food.id}` }
            : undefined,
    };
}

function belongsFill(view: FoodsSettingsView, product: FoodRow): ModalFill {
    const plains = plainFoodOptions(view, product);
    const suggested = suggestFoodFor(product.name, plains);
    const options = [
        `<option value="">None</option>`,
        ...plains.map((row) => {
            const sel = row.id === suggested?.id ? " selected" : "";
            return `<option value="${escapeHtml(row.id)}"${sel}>${escapeHtml(row.name)}</option>`;
        }),
    ].join("");
    return {
        action: `/household/items/${product.id}/link`,
        title: "Belongs to",
        templates: {
            belongs_select: `food-belongs-select-${product.id}`,
        },
        fields: {
            belongs_html: options,
        },
    };
}

function belongsSelectTemplate(
    view: FoodsSettingsView,
    product: FoodRow,
): string {
    return `<template id="food-belongs-select-${escapeHtml(product.id)}">${belongsSelectInner(view, product)}</template>`;
}

function productFieldsSlot(
    view: FoodsSettingsView,
    food: FoodRow | null,
): string {
    if (!food) return `<div data-fill-slot="product_fields"></div>`;
    const html = editProductFieldsTemplate(view, food);
    if (!html) return `<div data-fill-slot="product_fields"></div>`;
    const templateId = `food-edit-product-fields-${food.id}`;
    return `<div data-fill-slot="product_fields" data-filled-template="${escapeHtml(templateId)}">${html}</div>`;
}

function belongsSelectInner(view: FoodsSettingsView, product: FoodRow): string {
    const plains = plainFoodOptions(view, product);
    const suggested = suggestFoodFor(product.name, plains);
    const options = [
        `<option value="">None</option>`,
        ...plains.map((row) => {
            const sel = row.id === suggested?.id ? " selected" : "";
            return `<option value="${escapeHtml(row.id)}"${sel}>${escapeHtml(row.name)}</option>`;
        }),
    ].join("");
    return `<form method="post" action="/household/items/${escapeHtml(product.id)}/link">
${field({
    id: `food-belongs-food-${product.id}`,
    label: "Food",
    control: `<select id="food-belongs-food-${product.id}" name="food_id">${options}</select>`,
})}
<label><input type="checkbox" name="make_usual" value="1" /> Make it our usual</label>
<button type="submit" class="btn-primary">Save</button>
</form>`;
}

function belongsSelectSlot(
    view: FoodsSettingsView,
    product: FoodRow | null,
): string {
    if (!product) return `<div data-fill-slot="belongs_select"></div>`;
    const templateId = `food-belongs-select-${product.id}`;
    return `<div data-fill-slot="belongs_select" data-filled-template="${escapeHtml(templateId)}">${belongsSelectInner(view, product)}</div>`;
}

function sortStoresByName<T extends { name: string }>(stores: T[]): T[] {
    return [...stores].sort((a, b) => a.name.localeCompare(b.name));
}

function usualBuyFieldsEdit(
    view: FoodsSettingsView,
    food: FoodRow | null,
): string {
    if (food?.archivedAt) return "";
    const amountVal =
        food?.usualAmount != null ? String(food.usualAmount.amount) : "";
    const unitOpts = [
        `<option value="">—</option>`,
        ...FOOD_QUANTITY_UNITS.map((unit) => {
            const label = quantityUnitOptionLabel(unit);
            const sel = food?.usualAmount?.unit === unit ? " selected" : "";
            return `<option value="${escapeHtml(unit)}"${sel}>${escapeHtml(label)}</option>`;
        }),
    ].join("");
    const storeOpts = [
        `<option value="">—</option>`,
        ...sortStoresByName(view.stores).map((s) => {
            const sel = food?.usualStoreId === s.id ? " selected" : "";
            return `<option value="${escapeHtml(s.id)}"${sel}>${escapeHtml(s.name)}</option>`;
        }),
    ].join("");
    return `${field({
        id: "food-edit-usual-amount",
        label: "Usually buy",
        control: `<div class="field-grid">
<label>Amount<input id="food-edit-usual-amount" name="usual_amount" type="number" min="0" step="any" value="${escapeHtml(amountVal)}" /></label>
<label>Unit<select id="food-edit-usual-unit" name="usual_unit">${unitOpts}</select></label>
</div>`,
    })}
${field({
    id: "food-edit-usual-store",
    label: "at",
    control: `<select id="food-edit-usual-store" name="usual_store_id">${storeOpts}</select>`,
})}`;
}

function foodEditForm(
    view: FoodsSettingsView,
    food: FoodRow | null,
    modalError?: string,
    productFields?: string,
): string {
    const allergenBoxes = [...NAMED_ALLERGENS, "other" as const]
        .map((code) => {
            const checked = food?.allergens.includes(code) ? " checked" : "";
            return `<label><input type="checkbox" name="allergens" value="${escapeHtml(code)}"${checked} /> ${escapeHtml(ALLERGEN_LABELS[code])}</label>`;
        })
        .join("");
    const archived = food?.archivedAt ? " checked" : "";
    const id = food ? escapeHtml(food.id) : "";
    return `${modalError ?? ""}<form method="post" action="${food ? `/household/items/${id}` : ""}" class="food-edit">
<input type="hidden" name="food_id" value="${id}" />
${field({ id: "food-edit-name", label: "Name", control: `<input id="food-edit-name" name="name" value="${escapeHtml(food?.name ?? "")}" required maxlength="120" />` })}
${field({ id: "food-edit-brand", label: "Brand", control: `<input id="food-edit-brand" name="brand" value="${escapeHtml(food?.brand ?? "")}" maxlength="80" />` })}
${field({ id: "food-edit-aliases", label: "Aliases", control: `<input id="food-edit-aliases" name="aliases" value="${escapeHtml(food?.aliases.join(", ") ?? "")}" />` })}
${field({ id: "food-edit-unit", label: "Default unit", control: `<input id="food-edit-unit" name="default_unit" value="${escapeHtml(food?.defaultUnit ?? "")}" />` })}
<div class="field-grid">
${nutrientInput("food-edit-each", "grams_per_each", "Grams per item", food?.gramsPerEach)}
${nutrientInput("food-edit-ml", "grams_per_ml", "Grams per millilitre", food?.gramsPerMl)}
${nutrientInput("food-edit-cal", "calories", "Calories / 100 g", food?.calories)}
${nutrientInput("food-edit-pro", "protein_g", "Protein g", food?.proteinG)}
${nutrientInput("food-edit-carb", "carbs_g", "Carbs g", food?.carbsG)}
${nutrientInput("food-edit-fat", "fat_g", "Fat g", food?.fatG)}
${nutrientInput("food-edit-fib", "fiber_g", "Fiber g", food?.fiberG)}
${nutrientInput("food-edit-sug", "sugar_g", "Sugar g", food?.sugarG)}
${nutrientInput("food-edit-alc", "alcohol_g", "Alcohol g", food?.alcoholG)}
${nutrientInput("food-edit-caf", "caffeine_mg", "Caffeine mg", food?.caffeineMg)}
</div>
<fieldset class="allergens choice-row"><legend>Allergens</legend>${allergenBoxes}</fieldset>
${usualBuyFieldsEdit(view, food)}
${productFields ?? `<div data-fill-slot="product_fields"></div>`}
<label><input type="checkbox" name="archived" value="1"${archived} /> Archived</label>
<button type="submit" class="btn-primary">Save food</button>
</form>`;
}

function productNestedRow(
    view: FoodsSettingsView,
    product: FoodRow,
    usualId: string | null,
): string {
    const brand = product.brand
        ? ` <span class="muted">${escapeHtml(product.brand)}</span>`
        : "";
    const usualPill =
        product.id === usualId
            ? ` <span class="pill pill-dim">Usual</span>`
            : "";
    return `<li><div class="row">
<p class="row-title">${escapeHtml(product.name)}${brand}${usualPill}</p>
<div class="row-actions">${modalTrigger({
        target: FOOD_EDIT_MODAL_ID,
        label: "Edit",
        className: "btn-sm",
        fill: foodFill(view, product),
    })}</div>
</div></li>`;
}

function foodRow(view: FoodsSettingsView, food: FoodRow): string {
    if (food.archivedAt || food.genericFoodId) {
        const brand = food.brand
            ? ` <span class="muted">${escapeHtml(food.brand)}</span>`
            : "";
        const archivedPill = food.archivedAt
            ? ` <span class="pill pill-dim">Archived</span>`
            : "";
        const kcal =
            food.calories == null
                ? "kcal unknown"
                : `${escapeHtml(String(food.calories))} kcal / 100 g`;
        return `<li class="food-row" data-food-id="${escapeHtml(food.id)}">
<div class="row">
<p class="row-title">${escapeHtml(food.name)}${brand}${archivedPill}</p>
<p class="row-meta">${kcal}</p>
<div class="row-actions">${modalTrigger({
            target: FOOD_EDIT_MODAL_ID,
            label: "Edit",
            className: "btn-sm",
            fill: foodFill(view, food),
        })}</div>
</div>
</li>`;
    }

    const brand = food.brand
        ? ` <span class="muted">${escapeHtml(food.brand)}</span>`
        : "";
    const kcal =
        food.calories == null
            ? "kcal unknown"
            : `${escapeHtml(String(food.calories))} kcal / 100 g`;
    const products = liveProducts(view, food.id);
    const nested =
        products.length === 0
            ? ""
            : `<ul class="food-products list">${products
                  .map((p) => productNestedRow(view, p, food.usualProductId))
                  .join("")}</ul>`;
    const belongsBtn =
        products.length === 0
            ? modalTrigger({
                  target: FOOD_BELONGS_MODAL_ID,
                  label: "Belongs to…",
                  className: "btn-sm",
                  fill: belongsFill(view, food),
              })
            : "";
    const actions = `<div class="row-actions">${belongsBtn}${modalTrigger({
        target: FOOD_EDIT_MODAL_ID,
        label: "Edit",
        className: "btn-sm",
        fill: foodFill(view, food),
    })}</div>`;

    return `<li class="food-row" data-food-id="${escapeHtml(food.id)}">
<div class="row">
<p class="row-title">${escapeHtml(food.name)}${brand}</p>
<p class="row-meta">${kcal}</p>
${actions}
</div>
${nested}
</li>`;
}

export function renderFoodsSettingsPage(view: FoodsSettingsView): string {
    const editFood = editReopenFood(view);
    const belongsFood = belongsReopenFood(view);
    const editOpen =
        editFood != null &&
        modalOpen(view, `${FOOD_EDIT_PREFIX}${editFood.id}`);
    const belongsOpen =
        belongsFood != null &&
        modalOpen(view, `${FOOD_BELONGS_PREFIX}${belongsFood.id}`);
    const modalIds: string[] = [];
    if (editFood && view.error && !belongsOpen)
        modalIds.push(`${FOOD_EDIT_PREFIX}${editFood.id}`);
    if (belongsFood && view.error && belongsOpen)
        modalIds.push(`${FOOD_BELONGS_PREFIX}${belongsFood.id}`);

    const topLevel = view.foods.filter((food) => isTopLevelRow(food, view));
    const rows = topLevel.map((food) => foodRow(view, food)).join("");
    const editTemplates = view.foods
        .map((food) => {
            const html = editProductFieldsTemplate(view, food);
            if (!html) return "";
            return `<template id="food-edit-product-fields-${escapeHtml(food.id)}">${html}</template>`;
        })
        .join("");
    const belongsTemplates = view.foods
        .filter(
            (food) =>
                !food.archivedAt &&
                !food.genericFoodId &&
                liveProducts(view, food.id).length === 0,
        )
        .map((food) => belongsSelectTemplate(view, food))
        .join("");

    const list =
        topLevel.length === 0
            ? ""
            : panel({
                  body: `<ul class="food-list list">${rows}</ul>${editTemplates}${belongsTemplates}`,
              });
    const editModal =
        view.foods.length === 0
            ? ""
            : modal({
                  id: FOOD_EDIT_MODAL_ID,
                  title: editFood ? `Edit ${editFood.name}` : "Edit food",
                  openOnLoad: editOpen,
                  body: foodEditForm(
                      view,
                      editOpen ? editFood : null,
                      editOpen ? errorBanner(view.error) : "",
                      editOpen && editFood
                          ? productFieldsSlot(view, editFood)
                          : undefined,
                  ),
                  submitDisabled: editFood == null,
              });
    const belongsModal = modal({
        id: FOOD_BELONGS_MODAL_ID,
        title: belongsFood ? "Belongs to" : "Belongs to",
        openOnLoad: belongsOpen,
        body: `${belongsSelectSlot(view, belongsOpen ? belongsFood : null)}${belongsOpen ? errorBanner(view.error) : ""}`,
        submitDisabled: belongsFood == null,
    });
    const mergeOptions = view.foods
        .filter((food) => !food.genericFoodId)
        .map(
            (food) =>
                `<option value="${escapeHtml(food.id)}">${escapeHtml(food.name)}</option>`,
        )
        .join("");
    const mergeModal =
        view.foods.filter((f) => !f.genericFoodId).length >= 2
            ? modal({
                  id: FOODS_MERGE_MODAL_ID,
                  title: "Merge foods",
                  openOnLoad: modalOpen(view, FOODS_MERGE_MODAL_ID),
                  body: `${view.error && modalOpen(view, FOODS_MERGE_MODAL_ID) ? errorBanner(view.error) : ""}<form method="post" action="/household/items/merge" class="food-merge field-grid">
<label>Keep
<select id="keep_id" name="keep_id">${mergeOptions}</select>
</label>
<label>Drop
<select id="drop_id" name="drop_id">${mergeOptions}</select>
</label>
<button type="submit" class="btn-danger">Merge</button>
</form>`,
              })
            : "";
    if (view.foods.filter((f) => !f.genericFoodId).length >= 2) {
        modalIds.push(FOODS_MERGE_MODAL_ID);
    }

    const headerActions =
        view.foods.filter((f) => !f.genericFoodId).length >= 2
            ? modalTrigger({
                  target: FOODS_MERGE_MODAL_ID,
                  label: "Merge foods",
                  className: "btn-danger",
              })
            : undefined;

    const linkPrompt = renderLinkProductPrompt(view.linkProductPrompt ?? null);
    if (view.linkProductPrompt?.openOnLoad) {
        modalIds.push(LINK_PRODUCT_MODAL_ID);
    }

    const body = `
        ${pageHeader({ title: "Items", actions: headerActions })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${renderHouseholdNav("items")}
        ${list || emptyState("No foods in the catalog yet.")}
        ${editModal}
        ${belongsModal}
        ${mergeModal}
        ${linkPrompt}
    `;
    return renderAppShell({
        ...view.chrome,
        title: "Items",
        active: "household",
        body,
    });
}
