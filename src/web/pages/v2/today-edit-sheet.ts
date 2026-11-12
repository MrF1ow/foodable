import type { Meal } from "../../../db/nutrition.js";
import { resolveMealType } from "../../../domain/today.js";
import {
    editItemQuantity,
    itemMacrosAtAmount,
    mealLocalTimeValue,
    scaleMealTotals,
    sumMacroTiles,
    todayEditSheetId,
    type MacroTileValues,
} from "../../../domain/today-edit.js";
import {
    formatLogMacroGrams,
    formatLogMacroKcal,
} from "../../../domain/log-macro-format.js";
import { esc } from "../../components/v2/html.js";
import { iconRepeat } from "../../components/v2/icons.js";
import { sheet } from "../../components/v2/sheet.js";
import { stepper } from "../../components/v2/stepper.js";
import { statTiles, type StatTile } from "../../components/v2/stat-tiles.js";
import { choiceGroup } from "../../components/v2/chips.js";
import { todayHref } from "./today.js";

const MEAL_TYPE_LABEL: Record<string, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snacks",
};

function macroTiles(markup: MacroTileValues): string {
    const tiles: StatTile[] = [
        {
            label: "kcal",
            value: formatLogMacroKcal(markup.calories),
            dot: "calories",
        },
        {
            label: "Protein",
            value: formatLogMacroGrams(markup.protein_g),
            unit: "g",
            dot: "protein",
        },
        {
            label: "Carbs",
            value: formatLogMacroGrams(markup.carbs_g),
            unit: "g",
            dot: "carbs",
        },
        {
            label: "Fat",
            value: formatLogMacroGrams(markup.fat_g),
            unit: "g",
            dot: "fat",
        },
    ];
    return String(statTiles(tiles));
}

function mealSubtitle(meal: Meal, day: string, tz: string): string {
    const type = MEAL_TYPE_LABEL[resolveMealType(meal.meal_type)] ?? "Meal";
    const time = mealLocalTimeValue(meal.logged_at, day, tz);
    const recipe = meal.items?.some((i) => i.recipe_id != null)
        ? "from your recipe"
        : "";
    const parts = [type, time, recipe].filter(Boolean);
    return parts.join(" · ");
}

function itemSteppers(meal: Meal): string {
    const items = meal.items ?? [];
    return items
        .map((item, index) => {
            const q = editItemQuantity(item);
            const step =
                q.unit === "g" || q.unit === "ml" || q.mode === "portions"
                    ? 1
                    : 0.1;
            return `<div class="fd-today-edit-item" data-fd-edit-item data-fd-item-index="${index}" data-fd-base-amount="${esc(String(q.value))}" data-fd-calories="${esc(String(item.calories ?? ""))}" data-fd-protein="${esc(String(item.protein_g ?? ""))}" data-fd-carbs="${esc(String(item.carbs_g ?? ""))}" data-fd-fat="${esc(String(item.fat_g ?? ""))}">
<p class="fd-today-edit-item__label">${esc(item.label.trim() || "Item")}</p>
${String(
    stepper({
        name: `item_amount_${item.id}`,
        label: item.label.trim() || "Amount",
        value: q.value,
        min: 0.01,
        step,
        inputStep: "any",
        unit: q.unit,
        id: `fd-stepper-${item.id}`,
    }),
)}
<input type="hidden" name="item_id_${index}" value="${esc(item.id)}" />
</div>`;
        })
        .join("");
}

function freeTextStepper(mealId: string): string {
    return String(
        stepper({
            name: "servings",
            label: "Servings",
            value: 1,
            min: 0.25,
            step: 0.25,
            inputStep: "any",
            unit: "Servings",
            id: `fd-stepper-servings-${mealId}`,
        }),
    );
}

function initialMacros(meal: Meal): MacroTileValues {
    const items = meal.items ?? [];
    if (items.length === 0) {
        return {
            calories: meal.calories,
            protein_g: meal.protein_g,
            carbs_g: meal.carbs_g,
            fat_g: meal.fat_g,
        };
    }
    if (items.length === 1) {
        const item = items[0]!;
        return itemMacrosAtAmount(item, editItemQuantity(item).value);
    }
    return sumMacroTiles(
        items.map((item) =>
            itemMacrosAtAmount(item, editItemQuantity(item).value),
        ),
    );
}

function mealTypeChoice(name: string, selected: string): string {
    const options = (["breakfast", "lunch", "dinner", "snack"] as const).map(
        (value) => ({
            value,
            label: MEAL_TYPE_LABEL[value] ?? value,
            selected: value === selected,
        }),
    );
    return String(
        choiceGroup({
            name,
            legend: "Move to",
            showLegend: true,
            options,
            required: true,
            className: "fd-today-edit-meals",
        }),
    );
}

export function renderTodayEditSheet(
    meal: Meal,
    opts: {
        day: string;
        tz: string;
        memberQuery?: string;
        openOnLoad?: boolean;
        error?: string;
    },
): string {
    const sheetId = todayEditSheetId(meal.id);
    const returnTo = todayHref({
        date: opts.day,
        member: opts.memberQuery,
    });
    const items = meal.items ?? [];
    const hasItems = items.length > 0;
    const bodyParts: string[] = [];
    if (opts.error) {
        bodyParts.push(
            `<p class="fd-today-edit-error" role="alert">${esc(opts.error)}</p>`,
        );
    }
    bodyParts.push(
        `<form id="${esc(sheetId)}-form" class="fd-today-edit-form" method="post" action="/meals/${esc(meal.id)}/edit">`,
        `<input type="hidden" name="return_to" value="${esc(returnTo)}" />`,
        `<input type="hidden" name="date" value="${esc(opts.day)}" />`,
    );
    if (hasItems) {
        bodyParts.push(itemSteppers(meal));
    } else {
        bodyParts.push(
            `<div class="fd-today-edit-item" data-fd-edit-servings data-fd-calories="${esc(String(meal.calories ?? ""))}" data-fd-protein="${esc(String(meal.protein_g ?? ""))}" data-fd-carbs="${esc(String(meal.carbs_g ?? ""))}" data-fd-fat="${esc(String(meal.fat_g ?? ""))}">${freeTextStepper(meal.id)}</div>`,
        );
    }
    const macros = initialMacros(meal);
    bodyParts.push(
        `<div class="fd-today-edit-macros" data-fd-edit-macros>${macroTiles(macros)}</div>`,
        `<label class="fd-today-edit-field"><span class="fd-today-edit-field__label">Time</span><input type="time" name="logged_time" value="${esc(mealLocalTimeValue(meal.logged_at, opts.day, opts.tz))}" required /></label>`,
        mealTypeChoice("meal_type", resolveMealType(meal.meal_type)),
        `</form>`,
        `<form id="${esc(sheetId)}-again" class="fd-inline-form" method="post" action="/meals/${esc(meal.id)}/again"><input type="hidden" name="return_to" value="${esc(returnTo)}" /><input type="hidden" name="date" value="${esc(opts.day)}" /></form>`,
        `<form id="${esc(sheetId)}-delete" class="fd-inline-form" method="post" action="/meals/${esc(meal.id)}/delete" hidden><input type="hidden" name="return_to" value="${esc(returnTo)}" /><input type="hidden" name="date" value="${esc(opts.day)}" /></form>`,
    );
    const actions = `<button type="submit" class="fd-btn fd-btn--accent" form="${esc(sheetId)}-again">${iconRepeat()}<span>Again</span></button><button type="submit" class="fd-btn fd-btn--danger" form="${esc(sheetId)}-delete">Delete</button><button type="submit" class="fd-btn fd-btn--primary" form="${esc(sheetId)}-form">Save</button>`;
    return sheet({
        id: sheetId,
        kind: "edit",
        title: meal.description.trim() || "Meal",
        subtitle: mealSubtitle(meal, opts.day, opts.tz),
        body: bodyParts.join("\n"),
        actions,
        openOnLoad: opts.openOnLoad,
    });
}

export function renderTodayEditSheets(
    meals: readonly Meal[],
    opts: {
        day: string;
        tz: string;
        memberQuery?: string;
        openMealId?: string;
        errorByMealId?: Record<string, string>;
    },
): string {
    if (meals.length === 0) return "";
    return meals
        .map((meal) =>
            renderTodayEditSheet(meal, {
                ...opts,
                openOnLoad: opts.openMealId === meal.id,
                error: opts.errorByMealId?.[meal.id],
            }),
        )
        .join("\n");
}

/** Preview helper: scales free-text totals for tests. */
export function previewScaledMacros(
    meal: Meal,
    servings: number,
): MacroTileValues {
    const scaled = scaleMealTotals(meal, servings);
    return scaled;
}
