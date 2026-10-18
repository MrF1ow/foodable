import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { ALLERGEN_LABELS, NAMED_ALLERGENS } from "../../domain/rules.js";
import type { Food } from "../../domain/foods.js";
import { renderSettingsNav } from "../components/settings-nav.js";
import {
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
} from "../components/ui.js";

export type FoodsSettingsView = {
    chrome: ViewerChrome;
    foods: Array<Food & { aliases: string[] }>;
    error?: string;
    openModalId?: string;
};

export const FOODS_MERGE_MODAL_ID = "foods-merge";

function modalOpen(view: FoodsSettingsView, id: string): boolean {
    return view.openModalId === id;
}

function editModalId(foodId: string): string {
    return `food-edit-${foodId}`;
}

function nutrientInput(
    id: string,
    name: string,
    label: string,
    value: number | null,
): string {
    return `<label>${escapeHtml(label)}
<input id="${escapeHtml(id)}" name="${escapeHtml(name)}" type="number" min="0" step="0.1" value="${value == null ? "" : escapeHtml(String(value))}" />
</label>`;
}

function foodEditForm(
    food: Food & { aliases: string[] },
    modalError?: string,
): string {
    const allergenBoxes = [...NAMED_ALLERGENS, "other" as const]
        .map((code) => {
            const checked = food.allergens.includes(code) ? " checked" : "";
            return `<label><input type="checkbox" name="allergens" value="${escapeHtml(code)}"${checked} /> ${escapeHtml(ALLERGEN_LABELS[code])}</label>`;
        })
        .join("");
    const archived = food.archivedAt ? " checked" : "";
    const id = escapeHtml(food.id);
    return `${modalError ?? ""}<form method="post" action="/settings/foods/${id}" class="food-edit">
<input type="hidden" name="food_id" value="${id}" />
<label for="name-${id}">Name</label>
<input id="name-${id}" name="name" value="${escapeHtml(food.name)}" required maxlength="120" />
<label for="brand-${id}">Brand</label>
<input id="brand-${id}" name="brand" value="${escapeHtml(food.brand ?? "")}" maxlength="80" />
<label for="aliases-${id}">Aliases</label>
<input id="aliases-${id}" name="aliases" value="${escapeHtml(food.aliases.join(", "))}" />
<label for="unit-${id}">Default unit</label>
<input id="unit-${id}" name="default_unit" value="${escapeHtml(food.defaultUnit)}" />
<div class="field-grid">
${nutrientInput(`each-${food.id}`, "grams_per_each", "Grams per item", food.gramsPerEach)}
${nutrientInput(`ml-${food.id}`, "grams_per_ml", "Grams per millilitre", food.gramsPerMl)}
${nutrientInput(`cal-${food.id}`, "calories", "Calories / 100 g", food.calories)}
${nutrientInput(`pro-${food.id}`, "protein_g", "Protein g", food.proteinG)}
${nutrientInput(`carb-${food.id}`, "carbs_g", "Carbs g", food.carbsG)}
${nutrientInput(`fat-${food.id}`, "fat_g", "Fat g", food.fatG)}
${nutrientInput(`fib-${food.id}`, "fiber_g", "Fiber g", food.fiberG)}
${nutrientInput(`sug-${food.id}`, "sugar_g", "Sugar g", food.sugarG)}
${nutrientInput(`alc-${food.id}`, "alcohol_g", "Alcohol g", food.alcoholG)}
${nutrientInput(`caf-${food.id}`, "caffeine_mg", "Caffeine mg", food.caffeineMg)}
</div>
<fieldset class="allergens choice-row"><legend>Allergens</legend>${allergenBoxes}</fieldset>
<label><input type="checkbox" name="archived" value="1"${archived} /> Archived</label>
<button type="submit" class="btn-primary">Save food</button>
</form>`;
}

function foodRow(
    food: Food & { aliases: string[] },
    view: FoodsSettingsView,
): { row: string; modal: string } {
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
    const editId = editModalId(food.id);
    const modalError =
        view.error && modalOpen(view, editId) ? errorBanner(view.error) : "";
    const rowHtml = `<li class="food-row" data-food-id="${escapeHtml(food.id)}">
<div class="row">
<p class="row-title">${escapeHtml(food.name)}${brand}${archivedPill}</p>
<p class="row-meta">${kcal}</p>
<div class="row-actions">${modalTrigger({
        target: editId,
        label: "Edit",
        className: "btn-sm",
    })}</div>
</div>
</li>`;
    const modalHtml = modal({
        id: editId,
        title: `Edit ${food.name}`,
        openOnLoad: modalOpen(view, editId),
        body: foodEditForm(food, modalError),
    });
    return { row: rowHtml, modal: modalHtml };
}

export function renderFoodsSettingsPage(view: FoodsSettingsView): string {
    const modalIds: string[] = [];
    let foodModals = "";
    const rows = view.foods
        .map((food) => {
            const part = foodRow(food, view);
            foodModals += part.modal;
            modalIds.push(editModalId(food.id));
            return part.row;
        })
        .join("");
    const list =
        view.foods.length === 0
            ? ""
            : panel({
                  body: `<ul class="food-list list">${rows}</ul>`,
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
        ${foodModals}
        ${mergeModal}
    `;
    return renderAppShell({
        title: "Foods",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}
