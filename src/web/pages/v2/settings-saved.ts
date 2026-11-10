import type { AppChromeBase } from "../../attention.js";
import type { Food } from "../../../domain/foods.js";
import type { Recipe } from "../../../domain/recipes.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { rowList, sectionHeader } from "../../components/v2/rows.js";
import {
    confirmSheet,
    sheet,
    sheetTrigger,
} from "../../components/v2/sheet.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsPageHeader,
} from "./settings-shared.js";
import { FOODS_MERGE_MODAL_ID } from "../foods.js";

export const SETTINGS_SAVED_MERGE_SHEET_ID = FOODS_MERGE_MODAL_ID;

export function savedFoodDeleteSheetId(foodId: string): string {
    return `fd-settings-saved-delete-food-${foodId}`;
}

export function savedRecipeDeleteSheetId(recipeId: string): string {
    return `fd-settings-saved-delete-recipe-${recipeId}`;
}

export type SavedFoodRow = Food & { aliases: string[] };

export type SettingsSavedV2View = {
    chrome: AppChromeBase;
    foods: SavedFoodRow[];
    recipes: Recipe[];
    searchQuery: string;
    error?: string;
    openModalId?: string;
};

function isTopLevelFood(food: SavedFoodRow): boolean {
    if (food.archivedAt) return true;
    if (!food.genericFoodId) return true;
    return false;
}

function liveProducts(
    view: SettingsSavedV2View,
    plainId: string,
): SavedFoodRow[] {
    return view.foods.filter(
        (row) => row.genericFoodId === plainId && !row.archivedAt,
    );
}

function kcalLabel(food: Food): string {
    return food.calories == null
        ? "kcal unknown"
        : `${food.calories} kcal / 100 g`;
}

function foodDeleteActions(
    view: SettingsSavedV2View,
    food: SavedFoodRow,
): string {
    if (food.archivedAt) return "";
    const deleteId = savedFoodDeleteSheetId(food.id);
    return `<div class="fd-settings-saved-actions">${sheetTrigger({
        target: deleteId,
        label: "Delete",
        className: "fd-btn fd-btn--sm fd-btn--danger",
    })}</div>`;
}

function foodRowInner(food: SavedFoodRow, actions: string): string {
    const archived = food.archivedAt ? " · Archived" : "";
    const brand = food.brand ? ` · ${esc(food.brand)}` : "";
    return `<div class="fd-settings-saved-row__main"><p class="fd-settings-saved-row__title">${esc(food.name)}${brand}${archived}</p><p class="fd-settings-saved-row__meta">${esc(kcalLabel(food))}</p></div>${actions}`;
}

function productRowMarkup(
    view: SettingsSavedV2View,
    product: SavedFoodRow,
): Html {
    const actions = foodDeleteActions(view, product);
    return raw(
        `<li class="fd-settings-saved-row fd-settings-saved-row--product">${foodRowInner(product, actions)}</li>`,
    );
}

function foodRowMarkup(view: SettingsSavedV2View, food: SavedFoodRow): Html {
    const products = liveProducts(view, food.id);
    const nested =
        products.length === 0
            ? ""
            : `<ul class="fd-settings-saved-products">${products.map((p) => String(productRowMarkup(view, p))).join("")}</ul>`;
    const actions = foodDeleteActions(view, food);
    return raw(
        `<li class="fd-settings-saved-row fd-settings-saved-row--plain">${foodRowInner(food, actions)}${nested}</li>`,
    );
}

function recipeRowMarkup(view: SettingsSavedV2View, recipe: Recipe): Html {
    const deleteId = savedRecipeDeleteSheetId(recipe.id);
    return raw(
        `<li class="fd-settings-saved-row"><div class="fd-settings-saved-row__main"><p class="fd-settings-saved-row__title">${esc(recipe.name)}</p><p class="fd-settings-saved-row__meta">${esc(recipe.tags[0] ?? "Recipe")}</p></div><div class="fd-settings-saved-actions">${sheetTrigger(
            {
                target: deleteId,
                label: "Delete",
                className: "fd-btn fd-btn--sm fd-btn--danger",
            },
        )}</div></li>`,
    );
}

function mergeSheet(view: SettingsSavedV2View): string {
    const mergeable = view.foods.filter(
        (f) => !f.genericFoodId && !f.archivedAt,
    );
    if (mergeable.length < 2) return "";
    const options = mergeable
        .map(
            (food) =>
                `<option value="${esc(food.id)}">${esc(food.name)}</option>`,
        )
        .join("");
    const formId = `${SETTINGS_SAVED_MERGE_SHEET_ID}-form`;
    const body = `<form id="${formId}" method="post" action="/settings/household/items/merge" class="fd-settings-saved-merge-form">
<label class="fd-settings-field"><span class="fd-settings-field__label">Keep</span><select class="fd-settings-select" name="keep_id">${options}</select></label>
<label class="fd-settings-field"><span class="fd-settings-field__label">Drop</span><select class="fd-settings-select" name="drop_id">${options}</select></label>
</form>`;
    const actions = `<button type="submit" class="fd-btn fd-btn--danger" form="${formId}">Merge</button>`;
    return sheet({
        id: SETTINGS_SAVED_MERGE_SHEET_ID,
        kind: "edit",
        title: "Merge foods",
        body,
        actions,
        openOnLoad: view.openModalId === SETTINGS_SAVED_MERGE_SHEET_ID,
    });
}

function deleteFoodSheets(view: SettingsSavedV2View): string {
    return view.foods
        .filter((f) => !f.archivedAt)
        .map((food) =>
            confirmSheet({
                id: savedFoodDeleteSheetId(food.id),
                title: "Delete food",
                message: `Archive ${food.name}? Existing logs keep their snapshots.`,
                action: `/settings/household/items/${food.id}/archive`,
                confirmLabel: "Delete",
                openOnLoad:
                    view.openModalId === savedFoodDeleteSheetId(food.id),
            }),
        )
        .join("");
}

function deleteRecipeSheets(view: SettingsSavedV2View): string {
    return view.recipes
        .map((recipe) =>
            confirmSheet({
                id: savedRecipeDeleteSheetId(recipe.id),
                title: "Delete recipe",
                message: `Delete ${recipe.name}? This cannot be undone.`,
                action: `/recipes/${recipe.id}/delete`,
                confirmLabel: "Delete",
                hiddenFields: { from: "/settings/saved" },
                openOnLoad:
                    view.openModalId === savedRecipeDeleteSheetId(recipe.id),
            }),
        )
        .join("");
}

export function renderSettingsSavedV2Body(view: SettingsSavedV2View): string {
    const q = view.searchQuery.trim();
    const search = `<form method="get" action="/settings/saved" class="fd-settings-saved-search" role="search"><label class="fd-search"><span class="visually-hidden">Search</span><input class="fd-search-text" type="search" name="q" value="${esc(q)}" placeholder="Search foods and recipes" autocomplete="off" /></label><button type="submit" class="fd-btn fd-btn--sm">Search</button></form>`;
    const topFoods = view.foods.filter((f) => isTopLevelFood(f));
    const foodItems = topFoods.map((food) => foodRowMarkup(view, food));
    const recipeItems = view.recipes.map((recipe) =>
        recipeRowMarkup(view, recipe),
    );
    const mergeTrigger =
        view.foods.filter((f) => !f.genericFoodId && !f.archivedAt).length >= 2
            ? sheetTrigger({
                  target: SETTINGS_SAVED_MERGE_SHEET_ID,
                  label: "Merge foods",
                  className: "fd-btn fd-btn--sm fd-btn--danger",
              })
            : "";
    const foodsSection =
        foodItems.length === 0
            ? `<p class="fd-settings-saved-empty">No foods match.</p>`
            : rowList(foodItems, { label: "Foods" });
    const recipesSection =
        recipeItems.length === 0
            ? `<p class="fd-settings-saved-empty">No recipes match.</p>`
            : rowList(recipeItems, { label: "Recipes" });
    const headerActions = mergeTrigger ? String(mergeTrigger) : undefined;
    return `${String(settingsPageHeader("Saved foods & recipes", headerActions))}${String(settingsErrorBanner(view.error))}${search}${String(sectionHeader({ title: "Foods", level: 2 }))}${String(foodsSection)}${String(sectionHeader({ title: "Recipes", level: 2 }))}${String(recipesSection)}${mergeSheet(view)}${deleteFoodSheets(view)}${deleteRecipeSheets(view)}`;
}

export function renderSettingsSavedV2Page(view: SettingsSavedV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "saved",
        title: "Saved foods & recipes",
        body: renderSettingsSavedV2Body(view),
    });
}
