import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { ALLERGEN_LABELS, NAMED_ALLERGENS } from "../../domain/rules.js";
import type { Food } from "../../domain/foods.js";
import { renderSettingsNav } from "../components/settings-nav.js";
import { sharedDialogItem } from "../components/shared-dialog.js";
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
    chrome: ViewerChrome;
    foods: Array<Food & { aliases: string[] }>;
    error?: string;
    openModalId?: string;
};

export const FOODS_MERGE_MODAL_ID = "foods-merge";
/** One edit dialog for every food. Triggers fill it; routes still reopen `food-edit-<id>`. */
export const FOOD_EDIT_MODAL_ID = "food-edit";
const FOOD_EDIT_PREFIX = "food-edit-";

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

function foodFill(food: FoodRow): ModalFill {
    return {
        action: `/settings/foods/${food.id}`,
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
        },
    };
}

function foodEditForm(food: FoodRow | null, modalError?: string): string {
    const allergenBoxes = [...NAMED_ALLERGENS, "other" as const]
        .map((code) => {
            const checked = food?.allergens.includes(code) ? " checked" : "";
            return `<label><input type="checkbox" name="allergens" value="${escapeHtml(code)}"${checked} /> ${escapeHtml(ALLERGEN_LABELS[code])}</label>`;
        })
        .join("");
    const archived = food?.archivedAt ? " checked" : "";
    const id = food ? escapeHtml(food.id) : "";
    return `${modalError ?? ""}<form method="post" action="${food ? `/settings/foods/${id}` : ""}" class="food-edit">
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
<label><input type="checkbox" name="archived" value="1"${archived} /> Archived</label>
<button type="submit" class="btn-primary">Save food</button>
</form>`;
}

function foodRow(food: FoodRow): string {
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
        fill: foodFill(food),
    })}</div>
</div>
</li>`;
}

export function renderFoodsSettingsPage(view: FoodsSettingsView): string {
    const editFood = editReopenFood(view);
    const editOpen =
        editFood != null &&
        modalOpen(view, `${FOOD_EDIT_PREFIX}${editFood.id}`);
    const modalIds: string[] = [];
    if (editFood && view.error)
        modalIds.push(`${FOOD_EDIT_PREFIX}${editFood.id}`);
    const rows = view.foods.map((food) => foodRow(food)).join("");
    const list =
        view.foods.length === 0
            ? ""
            : panel({
                  body: `<ul class="food-list list">${rows}</ul>`,
              });
    const editModal =
        view.foods.length === 0
            ? ""
            : modal({
                  id: FOOD_EDIT_MODAL_ID,
                  title: editFood ? `Edit ${editFood.name}` : "Edit food",
                  openOnLoad: editOpen,
                  body: foodEditForm(
                      editFood,
                      editOpen ? errorBanner(view.error) : "",
                  ),
                  submitDisabled: editFood == null,
              });
    const options = view.foods
        .map(
            (food) =>
                `<option value="${escapeHtml(food.id)}">${escapeHtml(food.name)}</option>`,
        )
        .join("");
    const mergeModal =
        view.foods.length >= 2
            ? modal({
                  id: FOODS_MERGE_MODAL_ID,
                  title: "Merge foods",
                  openOnLoad: modalOpen(view, FOODS_MERGE_MODAL_ID),
                  body: `${view.error && modalOpen(view, FOODS_MERGE_MODAL_ID) ? errorBanner(view.error) : ""}<form method="post" action="/settings/foods/merge" class="food-merge field-grid">
<label>Keep
<select id="keep_id" name="keep_id">${options}</select>
</label>
<label>Drop
<select id="drop_id" name="drop_id">${options}</select>
</label>
<button type="submit" class="btn-danger">Merge</button>
</form>`,
              })
            : "";
    if (view.foods.length >= 2) {
        modalIds.push(FOODS_MERGE_MODAL_ID);
    }

    const headerActions =
        view.foods.length >= 2
            ? modalTrigger({
                  target: FOODS_MERGE_MODAL_ID,
                  label: "Merge foods",
                  className: "btn-danger",
              })
            : undefined;

    const body = `
        ${pageHeader({ title: "Foods", actions: headerActions })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${renderSettingsNav("foods")}
        ${list || emptyState("No foods in the catalog yet.")}
        ${editModal}
        ${mergeModal}
    `;
    return renderAppShell({
        title: "Foods",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}
