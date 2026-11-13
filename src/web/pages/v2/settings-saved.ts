import type { AppChromeBase } from "../../attention.js";
import type { Food } from "../../../domain/foods.js";
import type { Recipe } from "../../../domain/recipes.js";
import { esc, type Html } from "../../components/v2/html.js";
import {
    manageRow,
    rowDeleteTrigger,
    rowList,
    sectionHeader,
} from "../../components/v2/rows.js";
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
import { selectMode } from "./select-mode.js";

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

function foodRowMarkup(
    view: SettingsSavedV2View,
    food: SavedFoodRow,
    after?: string,
): Html {
    // The title is the name alone, so it is what ends in "…"; the Archived
    // marker leads the meta line, so a long brand can never cut it off.
    const meta = [
        food.archivedAt ? "Archived" : null,
        food.brand,
        kcalLabel(food),
    ]
        .filter(Boolean)
        .join(" · ");
    return manageRow({
        title: food.name,
        meta,
        // An archived food has nothing left to delete.
        select: food.archivedAt
            ? undefined
            : { name: "food_ids[]", value: food.id, label: food.name },
        actions: food.archivedAt
            ? undefined
            : rowDeleteTrigger({
                  target: savedFoodDeleteSheetId(food.id),
                  name: food.brand ? `${food.name} (${food.brand})` : food.name,
              }),
        after,
    });
}

function plainFoodRowMarkup(
    view: SettingsSavedV2View,
    food: SavedFoodRow,
): Html {
    const products = liveProducts(view, food.id);
    const nested =
        products.length === 0
            ? undefined
            : `<ul class="fd-settings-saved-products">${products.map((p) => String(foodRowMarkup(view, p))).join("")}</ul>`;
    return foodRowMarkup(view, food, nested);
}

function recipeRowMarkup(recipe: Recipe): Html {
    return manageRow({
        title: recipe.name,
        meta: recipe.tags[0] ?? "Recipe",
        select: { name: "recipe_ids[]", value: recipe.id, label: recipe.name },
        actions: rowDeleteTrigger({
            target: savedRecipeDeleteSheetId(recipe.id),
            name: recipe.name,
        }),
    });
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
    const foodItems = topFoods.map((food) => plainFoodRowMarkup(view, food));
    const recipeItems = view.recipes.map((recipe) => recipeRowMarkup(recipe));
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
    const select = selectMode({
        scope: "saved",
        returnTo: q
            ? `/settings/saved?q=${encodeURIComponent(q)}`
            : "/settings/saved",
        actions: [
            {
                kind: "confirm",
                key: "delete",
                label: "Delete",
                action: "/settings/saved/bulk/delete",
                title: "Delete saved items",
                one: "Delete 1 saved item? A recipe cannot be brought back.",
                many: "Delete {n} saved items? Recipes cannot be brought back.",
                confirmLabel: "Delete",
            },
        ],
    });
    const selectable =
        view.foods.some((f) => !f.archivedAt) || view.recipes.length > 0;
    const headerActions = mergeTrigger ? String(mergeTrigger) : undefined;
    return `${String(settingsPageHeader("Saved foods & recipes", headerActions))}<div${select.rootAttrs}>${String(settingsErrorBanner(view.error))}${search}${selectable ? select.tools + select.bar : ""}${String(sectionHeader({ title: "Foods", level: 2 }))}${String(foodsSection)}${String(sectionHeader({ title: "Recipes", level: 2 }))}${String(recipesSection)}${mergeSheet(view)}${deleteFoodSheets(view)}${deleteRecipeSheets(view)}${selectable ? select.sheets : ""}</div>`;
}

export function renderSettingsSavedV2Page(view: SettingsSavedV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "saved",
        title: "Saved foods & recipes",
        body: renderSettingsSavedV2Body(view),
    });
}
