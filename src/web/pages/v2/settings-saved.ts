/**
 * Settings › Saved foods & recipes (FigCraft 415264): a link to Possible
 * duplicates, a search, then the household's foods and recipes as Item rows
 * with a ⋯ each. A food's ⋯ has Edit, Merge and Delete; a recipe's has Delete
 * (a confirm in the menu, no sheet). The Detail bar's ⋯ has Select, which turns
 * the lists into picks with a bar that deletes several at once.
 *
 * Edit and Merge open one sheet each, shared by every row: the item that opens
 * it says what it holds (`set`, applied by `client/v2/menu.js`), so the page
 * does not carry a sheet per food. Merging goes through the household's merge
 * route as before; Delete archives a food (its logs keep their snapshots).
 */
import type { AppChromeBase } from "../../attention.js";
import type { Food } from "../../../domain/foods.js";
import type { Recipe } from "../../../domain/recipes.js";
import {
    ALLERGEN_LABELS,
    ALLERGEN_OTHER,
    NAMED_ALLERGENS,
} from "../../../domain/rules.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { searchField } from "../../components/v2/search-field.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { selectMode } from "./select-mode.js";
import { DUPLICATES_PATH } from "./settings-duplicates.js";

export const FOODS_MERGE_MODAL_ID = "foods-merge";
export const SETTINGS_SAVED_MERGE_SHEET_ID = FOODS_MERGE_MODAL_ID;
export const SAVED_EDIT_SHEET_ID = "fd-saved-edit";
const SAVED_PATH = "/settings/saved";

export type SavedFoodRow = Food & { aliases: string[] };

export type SettingsSavedV2View = {
    chrome: AppChromeBase;
    foods: SavedFoodRow[];
    recipes: Recipe[];
    /** Pairs on Possible duplicates; 0 leaves the count off. */
    duplicateCount?: number;
    searchQuery: string;
    error?: string;
    openModalId?: string;
    /** What was posted when a save or merge was refused, so the sheet reopens with it. */
    typed?: Readonly<Record<string, string | string[]>>;
};

function kcalLabel(food: Food): string {
    return food.calories == null
        ? "kcal unknown"
        : `${food.calories} kcal / 100 g`;
}

const text = (n: number | null): string => (n == null ? "" : String(n));

/** What the shared edit sheet holds for a food (its route reads every one of these). */
function editValues(food: SavedFoodRow): Record<string, string | string[]> {
    return {
        "@action": `/settings/household/items/${food.id}`,
        name: food.name,
        brand: food.brand ?? "",
        // One per line: an alias may hold a comma ("salt, kosher").
        alias_lines: food.aliases.join("\n"),
        default_unit: food.defaultUnit,
        grams_per_each: text(food.gramsPerEach),
        grams_per_ml: text(food.gramsPerMl),
        calories: text(food.calories),
        protein_g: text(food.proteinG),
        carbs_g: text(food.carbsG),
        fat_g: text(food.fatG),
        fiber_g: text(food.fiberG),
        sugar_g: text(food.sugarG),
        alcohol_g: text(food.alcoholG),
        caffeine_mg: text(food.caffeineMg),
        allergens: food.allergens,
    };
}

function foodLabel(food: Food): string {
    return food.brand ? `${food.name} (${food.brand})` : food.name;
}

function foodMenu(
    food: SavedFoodRow,
    mergeable: readonly SavedFoodRow[],
): { control: Html; items: MenuItem[] } {
    const items: MenuItem[] = [
        {
            kind: "opens",
            label: "Edit",
            sheetId: SAVED_EDIT_SHEET_ID,
            set: editValues(food),
        },
    ];
    // Merge sets both ends every time it opens: this food goes in and no Keep
    // is chosen, so a Keep picked from another row never carries over and the
    // person says which food stays.
    const hasOther = mergeable.some((f) => f.id !== food.id);
    if (hasOther && !food.genericFoodId) {
        items.push({
            kind: "opens",
            label: "Merge",
            sheetId: SETTINGS_SAVED_MERGE_SHEET_ID,
            set: {
                drop_id: food.id,
                drop_label: foodLabel(food),
                keep_id: "",
            },
        });
    }
    items.push({
        kind: "destructive",
        label: "Delete",
        action: `/settings/household/items/${food.id}/archive`,
    });
    return {
        items,
        control: menu({
            label: `Actions for ${foodLabel(food)}`,
            anchor: "more",
            items,
        }),
    };
}

function foodRow(food: SavedFoodRow, mergeable: readonly SavedFoodRow[]): Html {
    // The title is the name alone, so it is what ends in "…"; the Archived
    // marker leads the subtitle, so a long brand can never cut it off.
    const subtitle = [
        food.archivedAt ? "Archived" : null,
        food.brand,
        kcalLabel(food),
    ]
        .filter(Boolean)
        .join(" · ");
    // An archived food has nothing left to edit, merge or delete.
    if (food.archivedAt) {
        return itemRow({ title: food.name, subtitle });
    }
    return itemRow({
        title: food.name,
        subtitle,
        select: { name: "food_ids[]", value: food.id },
        trailing: { kind: "control", html: foodMenu(food, mergeable).control },
        className: "fd-saved-row",
    });
}

function recipeRow(recipe: Recipe): Html {
    const servings = recipe.yieldPortions;
    return itemRow({
        title: recipe.name,
        subtitle: `${servings} ${servings === 1 ? "serving" : "servings"}`,
        select: { name: "recipe_ids[]", value: recipe.id },
        className: "fd-saved-row",
        trailing: {
            kind: "control",
            html: menu({
                label: `Actions for ${recipe.name}`,
                anchor: "more",
                items: [
                    {
                        kind: "destructive",
                        label: "Delete",
                        action: `/recipes/${recipe.id}/delete`,
                        fields: { from: SAVED_PATH },
                    },
                ],
            }),
        },
    });
}

function allergenRows(checked: readonly string[]): Html {
    const codes = [...NAMED_ALLERGENS, ALLERGEN_OTHER];
    return listGroup({
        label: "Allergens",
        rows: codes.map((code) =>
            itemRow({
                title: ALLERGEN_LABELS[code],
                lead: {
                    kind: "checkbox",
                    label: ALLERGEN_LABELS[code],
                    name: "allergens",
                    value: code,
                    checked: checked.includes(code),
                },
            }),
        ),
    });
}

const NUTRIENT_FIELDS = [
    "calories",
    "protein_g",
    "carbs_g",
    "fat_g",
    "fiber_g",
    "sugar_g",
    "alcohol_g",
    "caffeine_mg",
] as const;

/**
 * The field a refusal is about, so the sheet can put it under that field; null
 * when it is about the food as a whole (it stays under the title).
 */
function refusedField(
    error: string | undefined,
    typed: Readonly<Record<string, string | string[]>>,
): string | null {
    if (!error) return null;
    if (error === "Enter a food name." || error === "That food already exists.")
        return "name";
    if (error === "That alias is already used.") return "alias_lines";
    if (error.startsWith("Grams per item")) {
        const each = Number(typed.grams_per_each);
        return typed.grams_per_each !== "" && !(each > 0)
            ? "grams_per_each"
            : "grams_per_ml";
    }
    if (error === "Nutrition values cannot be negative.") {
        return (
            NUTRIENT_FIELDS.find((name) => {
                const raw = String(typed[name] ?? "").trim();
                return raw !== "" && !(Number(raw) >= 0);
            }) ?? "calories"
        );
    }
    return null;
}

/**
 * The one edit sheet. Posts every field the household route reads, so nothing
 * it does not show is cleared: the sheet is filled from the row that opens it.
 * A refused save reopens it with what the person typed, the refusal under the
 * field it is about (or under the title when it is about the whole food).
 */
function editSheet(view: SettingsSavedV2View): string {
    const failing = view.openModalId?.startsWith("food-edit-")
        ? view.foods.find((f) => `food-edit-${f.id}` === view.openModalId)
        : undefined;
    const stored = failing ? editValues(failing) : undefined;
    const typed = failing ? { ...stored, ...view.typed } : undefined;
    const at = refusedField(view.error, typed ?? {});
    const formId = `${SAVED_EDIT_SHEET_ID}-form`;
    const f = (
        name: string,
        label: string,
        opts: { required?: boolean; rows?: number; hint?: string } = {},
    ) =>
        field({
            id: `${SAVED_EDIT_SHEET_ID}-${name}`,
            label,
            name,
            value: typed ? String(typed[name] ?? "") : "",
            required: opts.required,
            rows: opts.rows,
            hint: opts.hint,
            error: failing && at === name ? view.error : undefined,
            autocomplete: "off",
        });
    const banner =
        failing && at == null ? settingsErrorBanner(view.error) : raw("");
    const ticked = typed?.allergens;
    const form = `<form id="${formId}" method="post" action="${esc(String(stored?.["@action"] ?? SAVED_PATH))}" class="fd-settings-sheet-form">${banner}${join(
        [
            f("name", "Name", { required: true }),
            f("brand", "Brand"),
            f("alias_lines", "Also called", { rows: 3, hint: "One per line" }),
            f("default_unit", "Default unit"),
            f("grams_per_each", "Grams per each"),
            f("grams_per_ml", "Grams per ml"),
            f("calories", "Calories per 100 g"),
            f("protein_g", "Protein, g"),
            f("carbs_g", "Carbs, g"),
            f("fat_g", "Fat, g"),
            f("fiber_g", "Fiber, g"),
            f("sugar_g", "Sugar, g"),
            f("alcohol_g", "Alcohol, g"),
            f("caffeine_mg", "Caffeine, mg"),
        ],
    )}<input type="hidden" name="archived" value="0">${allergenRows(Array.isArray(ticked) ? ticked : ticked ? [ticked] : [])}</form>`;
    return String(
        sheet({
            id: SAVED_EDIT_SHEET_ID,
            placement: "bottom",
            header: { kind: "title", title: "Edit food" },
            body: sheetSection({ kind: "fields", content: raw(form) }),
            actions: {
                kind: "pair",
                primary: { label: "Save", type: "submit", form: formId },
            },
            openOnLoad: failing != null,
        }),
    );
}

/**
 * The merge sheet: the food going in (set by the row's Merge, shown as a
 * read-only field) and a radio row for each food that can be kept. The food
 * going in is hidden from the choices by `data-fd-menu-not` (menu.js).
 */
function mergeSheet(view: SettingsSavedV2View): string {
    const mergeable = view.foods.filter(
        (f) => !f.genericFoodId && !f.archivedAt,
    );
    if (mergeable.length < 2) return "";
    const open = view.openModalId === SETTINGS_SAVED_MERGE_SHEET_ID;
    const dropId = open ? String(view.typed?.drop_id ?? "") : "";
    const keepId = open ? String(view.typed?.keep_id ?? "") : "";
    const dropFood = mergeable.find((f) => f.id === dropId);
    const formId = `${SETTINGS_SAVED_MERGE_SHEET_ID}-form`;
    const rows = mergeable
        .filter((food) => food.id !== dropId)
        .map((food) =>
            itemRow({
                title: food.name,
                subtitle: food.brand ?? undefined,
                lead: {
                    kind: "radio",
                    label: `Keep ${foodLabel(food)}`,
                    name: "keep_id",
                    value: food.id,
                    checked: food.id === keepId,
                },
            }),
        );
    const body = `<form id="${formId}" method="post" action="/settings/household/items/merge" class="fd-settings-sheet-form">${open ? settingsErrorBanner(view.error) : ""}<input type="hidden" name="drop_id" value="${esc(dropId)}">${field(
        {
            id: `${SETTINGS_SAVED_MERGE_SHEET_ID}-drop`,
            label: "Merge in",
            name: "drop_label",
            value: dropFood ? foodLabel(dropFood) : "",
            disabled: true,
        },
    )}${sectionHeader({ label: "Keep", rule: false })}<div role="radiogroup" aria-label="Food to keep" data-fd-menu-not="drop_id">${listGroup({ rows })}</div></form>`;
    return String(
        sheet({
            id: SETTINGS_SAVED_MERGE_SHEET_ID,
            placement: "bottom",
            header: { kind: "title", title: "Merge foods" },
            body: sheetSection({ kind: "fields", content: raw(body) }),
            actions: {
                kind: "destructive",
                danger: { label: "Merge", type: "submit", form: formId },
            },
            openOnLoad: open,
        }),
    );
}

/**
 * Plain foods in name order, each followed by its products; a product whose
 * plain food is not listed (a search that missed it) stands where its name falls.
 */
function inListOrder(foods: readonly SavedFoodRow[]): SavedFoodRow[] {
    const ids = new Set(foods.map((f) => f.id));
    const under = new Map<string, SavedFoodRow[]>();
    for (const food of foods) {
        if (food.genericFoodId && ids.has(food.genericFoodId)) {
            const list = under.get(food.genericFoodId) ?? [];
            list.push(food);
            under.set(food.genericFoodId, list);
        }
    }
    return foods.flatMap((food) =>
        food.genericFoodId && ids.has(food.genericFoodId)
            ? []
            : [food, ...(under.get(food.id) ?? [])],
    );
}

export function renderSettingsSavedV2Body(view: SettingsSavedV2View): string {
    const q = view.searchQuery.trim();
    const mergeable = view.foods.filter(
        (f) => !f.genericFoodId && !f.archivedAt,
    );
    const search = `<form method="get" action="${SAVED_PATH}" role="search">${searchField(
        {
            label: "Search foods and recipes",
            name: "q",
            value: q,
            placeholder: "Search foods and recipes",
        },
    )}</form>`;
    const foods = inListOrder(view.foods).map((food) =>
        foodRow(food, mergeable),
    );
    const recipes = view.recipes.map((recipe) => recipeRow(recipe));
    const select = selectMode({
        scope: "saved",
        returnTo: q ? `${SAVED_PATH}?q=${encodeURIComponent(q)}` : SAVED_PATH,
        actions: [
            {
                kind: "confirm",
                key: "delete",
                label: "Delete",
                action: "/settings/saved/bulk/delete",
                title: "Delete saved items",
                one: "Delete 1 saved item?",
                many: "Delete {n} saved items?",
                ifPicked: {
                    name: "recipe_ids[]",
                    one: "Delete 1 saved item? A recipe cannot be brought back.",
                    many: "Delete {n} saved items? Recipes cannot be brought back.",
                },
                confirmLabel: "Delete",
            },
        ],
    });
    const selectable =
        view.foods.some((f) => !f.archivedAt) || view.recipes.length > 0;
    const duplicates = listGroup({
        label: "Possible duplicates",
        rows: [
            itemRow({
                title: "Possible duplicates",
                value:
                    (view.duplicateCount ?? 0) > 0
                        ? String(view.duplicateCount)
                        : undefined,
                href: DUPLICATES_PATH,
                trailing: { kind: "chevron" },
            }),
        ],
    });
    const list = (label: string, rows: Html[], none: string) =>
        join([
            sectionHeader({ label, count: rows.length, rule: false }),
            rows.length === 0
                ? emptyState({ title: none })
                : listGroup({ label, rows }),
        ]);
    const body = String(
        join([
            settingsErrorBanner(
                view.openModalId?.startsWith("food-edit-") ||
                    view.openModalId === SETTINGS_SAVED_MERGE_SHEET_ID
                    ? undefined
                    : view.error,
            ),
            duplicates,
            raw(`<hr class="fd-settings-divider">`),
            raw(search),
            list("Foods", foods, "No foods match"),
            list("Recipes", recipes, "No recipes match"),
        ]),
    );
    return `<div${select.rootAttrs}>${body}${selectable ? select.bar + select.sheets : ""}${editSheet(view)}${mergeSheet(view)}</div>`;
}

export function renderSettingsSavedV2Page(view: SettingsSavedV2View): string {
    const selectable =
        view.foods.some((f) => !f.archivedAt) || view.recipes.length > 0;
    const select = selectMode({
        scope: "saved",
        returnTo: SAVED_PATH,
        actions: [],
    });
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "saved",
        title: "Saved foods & recipes",
        className: "fd-saved-page",
        actions: selectable
            ? menu({
                  label: "Saved foods actions",
                  anchor: "more",
                  items: [select.menuItem],
              })
            : undefined,
        body: renderSettingsSavedV2Body(view),
    });
}
