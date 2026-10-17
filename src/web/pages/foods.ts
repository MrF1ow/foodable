import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { ALLERGEN_LABELS, NAMED_ALLERGENS } from "../../domain/rules.js";
import type { Food } from "../../domain/foods.js";
import { renderSettingsNav } from "../components/settings-nav.js";

export type FoodsSettingsView = {
    chrome: ViewerChrome;
    foods: Array<Food & { aliases: string[] }>;
    error?: string;
};

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

function foodRow(food: Food & { aliases: string[] }): string {
    const allergenBoxes = [...NAMED_ALLERGENS, "other" as const]
        .map((code) => {
            const checked = food.allergens.includes(code) ? " checked" : "";
            return `<label><input type="checkbox" name="allergens" value="${escapeHtml(code)}"${checked} /> ${escapeHtml(ALLERGEN_LABELS[code])}</label>`;
        })
        .join("");
    const archived = food.archivedAt ? " checked" : "";
    const id = escapeHtml(food.id);
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
    return `<li class="food-row" data-food-id="${id}">
<div class="row">
<p class="row-title">${escapeHtml(food.name)}${brand}${archivedPill}</p>
<p class="row-meta">${kcal}</p>
</div>
<details class="more">
<summary>Edit</summary>
<form method="post" action="/settings/foods/${id}" class="food-edit">
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
${nutrientInput(`each-${food.id}`, "grams_per_each", "Grams per each", food.gramsPerEach)}
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
</form>
</details>
</li>`;
}

export function renderFoodsSettingsPage(view: FoodsSettingsView): string {
    const error = view.error
        ? `<p class="error-banner">${escapeHtml(view.error)}</p>`
        : "";
    const list =
        view.foods.length === 0
            ? ""
            : `<section class="panel"><ul class="food-list list">${view.foods.map(foodRow).join("")}</ul></section>`;
    const options = view.foods
        .map(
            (food) =>
                `<option value="${escapeHtml(food.id)}">${escapeHtml(food.name)}</option>`,
        )
        .join("");
    const merge =
        view.foods.length >= 2
            ? `<details class="more">
<summary>Merge foods</summary>
<form method="post" action="/settings/foods/merge" class="food-merge field-grid">
<label>Keep
<select id="keep_id" name="keep_id">${options}</select>
</label>
<label>Drop
<select id="drop_id" name="drop_id">${options}</select>
</label>
<button type="submit" class="btn-danger">Merge</button>
</form>
</details>`
            : "";
    const body = `
        <h1>Foods</h1>
        ${renderSettingsNav("foods")}
        ${error}
        ${list || `<p class="empty">No foods in the catalog yet.</p>`}
        ${merge}
    `;
    return renderAppShell({
        title: "Foods",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}
