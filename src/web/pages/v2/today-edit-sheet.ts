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
import { field } from "../../components/v2/field.js";
import { esc, raw } from "../../components/v2/html.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
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
    // The script rewrites the tiles' figures as an amount changes.
    return String(
        statTiles(tiles, { className: "fd-today-edit-macros" }),
    ).replace("<dl ", "<dl data-fd-edit-macros ");
}

/** "Lunch · 852 kcal": the meal and what it comes to, as the design reads. */
function mealSubtitle(meal: Meal): string {
    const type = MEAL_TYPE_LABEL[resolveMealType(meal.meal_type)] ?? "Meal";
    const kcal = initialMacros(meal).calories;
    const total =
        kcal == null || !Number.isFinite(Number(kcal))
            ? ""
            : `${formatLogMacroKcal(kcal)} kcal`;
    return [type, total].filter(Boolean).join(" · ");
}

/** "12:30" → "12:30 PM": the chip's face. */
function clockLabel(time: string): string {
    const [h, m] = time.split(":");
    const hour = Number(h);
    if (!Number.isInteger(hour) || m == null) return time;
    const suffix = hour >= 12 ? "PM" : "AM";
    return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${suffix}`;
}

/**
 * Time as two chips: the meal's own time, kept, and "Pick a time", which shows
 * the time field (by CSS, so it works with no script). The field always posts
 * `logged_time`; it holds the meal's time until a new one is picked.
 */
function timeChoice(
    sheetId: string,
    meal: Meal,
    opts: { day: string; tz: string },
): string {
    const time = mealLocalTimeValue(meal.logged_at, opts.day, opts.tz);
    const group = choiceGroup({
        name: "time_mode",
        legend: "Time",
        options: [
            { value: "keep", label: clockLabel(time), selected: true },
            { value: "pick", label: "Pick a time" },
        ],
        required: true,
    });
    const timeField = field({
        id: `${sheetId}-time`,
        label: "Time",
        labelHidden: true,
        name: "logged_time",
        type: "time",
        value: time,
        required: true,
    });
    return String(
        sheetSection({
            kind: "chips",
            label: "Time",
            content: raw(
                `<div class="fd-today-edit-time" data-fd-edit-time>${String(group)}<div class="fd-today-edit-time__field">${String(timeField)}</div></div>`,
            ),
        }),
    );
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
            const label = item.label.trim() || "Item";
            const control = `<div class="fd-today-edit-item" data-fd-edit-item data-fd-item-index="${index}" data-fd-base-amount="${esc(String(q.value))}" data-fd-calories="${esc(String(item.calories ?? ""))}" data-fd-protein="${esc(String(item.protein_g ?? ""))}" data-fd-carbs="${esc(String(item.carbs_g ?? ""))}" data-fd-fat="${esc(String(item.fat_g ?? ""))}">${String(
                stepper({
                    name: `item_amount_${item.id}`,
                    label,
                    value: q.value,
                    min: 0.01,
                    step,
                    inputStep: "any",
                    unit: q.unit,
                    id: `fd-stepper-${item.id}`,
                }),
            )}<input type="hidden" name="item_id_${index}" value="${esc(item.id)}" /></div>`;
            return String(
                sheetSection({
                    kind: "amount",
                    label,
                    content: raw(control),
                }),
            );
        })
        .join("\n");
}

function freeTextStepper(mealId: string): string {
    const control = `<div class="fd-today-edit-item" data-fd-edit-servings>${String(
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
    )}</div>`;
    return String(sheetSection({ kind: "amount", content: raw(control) }));
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
    const group = choiceGroup({
        name,
        legend: "Move to",
        options,
        required: true,
        className: "fd-today-edit-meals",
    });
    return String(
        sheetSection({ kind: "chips", label: "Move to", content: group }),
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
    const formId = `${sheetId}-form`;
    const againId = `${sheetId}-again`;
    const returnTo = todayHref({
        date: opts.day,
        member: opts.memberQuery,
    });
    const items = meal.items ?? [];
    const hasItems = items.length > 0;
    const error = opts.error
        ? `<p class="fd-today-edit-error" role="alert">${esc(opts.error)}</p>`
        : "";
    // Free text has no items: its one stepper scales the meal's own totals,
    // which the script reads off the host.
    const servings = freeTextStepper(meal.id).replace(
        "data-fd-edit-servings",
        () =>
            `data-fd-edit-servings data-fd-calories="${esc(String(meal.calories ?? ""))}" data-fd-protein="${esc(String(meal.protein_g ?? ""))}" data-fd-carbs="${esc(String(meal.carbs_g ?? ""))}" data-fd-fat="${esc(String(meal.fat_g ?? ""))}"`,
    );
    const form = `${error}<form id="${esc(formId)}" class="fd-today-edit-form" method="post" action="/meals/${esc(meal.id)}/edit">
<input type="hidden" name="return_to" value="${esc(returnTo)}" />
<input type="hidden" name="date" value="${esc(opts.day)}" />
${hasItems ? itemSteppers(meal) : servings}
${String(
    sheetSection({
        kind: "custom",
        content: raw(macroTiles(initialMacros(meal))),
    }),
)}
${mealTypeChoice("meal_type", resolveMealType(meal.meal_type))}
${timeChoice(sheetId, meal, opts)}
</form>
<form id="${esc(againId)}" class="fd-inline-form" method="post" action="/meals/${esc(meal.id)}/again"><input type="hidden" name="return_to" value="${esc(returnTo)}" /><input type="hidden" name="date" value="${esc(opts.day)}" /><input type="hidden" name="submit_key" value="${esc(crypto.randomUUID())}" /></form>`;
    return sheet({
        id: sheetId,
        placement: "side",
        header: {
            kind: "title",
            title: meal.description.trim() || "Meal",
            subtitle: mealSubtitle(meal),
        },
        body: raw(form),
        // Delete is the row's menu and swipe; here a meal is repeated or saved.
        actions: {
            kind: "pair",
            cancel: { label: "Again", type: "submit", form: againId },
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: opts.openOnLoad,
        focus: "panel",
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
