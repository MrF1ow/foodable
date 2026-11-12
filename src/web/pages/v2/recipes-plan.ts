/**
 * The week plan in the new app: "Add to plan" on a recipe, This week on Today
 * (a card in the desktop rail, a section on the phone) and on Recipes (a strip
 * of seven days), the sheets that move or remove a plan, and the sheet that
 * lists what the plan still needs and puts it on the grocery list.
 *
 * FigCraft Screens › Recipes (desktop dark 48591, light 57474; phone dark
 * 22716, light 27628) and Desktop › Today (dark 41837, light 50720) carry the
 * strip, the rail card and the Plan buttons. The design has no frame for the
 * Add to plan sheet, the edit sheet or the missing list, and no This week
 * section on the phone Today.
 *
 * `buildWeekPlanView` is the pure step between the data and the markup: seven
 * days from today in the household's calendar, each with its plans, and the
 * missing lines from `missingForPlan`. Past plans fall outside the window, so
 * they are hidden, never deleted.
 */
import type { FoodQuantityFactors } from "../../../domain/food-quantity.js";
import type { LinkedNeed } from "../../../domain/linking.js";
import {
    PLAN_SLOTS,
    type PlanSlot,
    type RecipePlan,
} from "../../../domain/plan.js";
import {
    missingForPlan,
    WEEK_PLAN_DAYS,
    weekPlan,
    type PlanRecipe,
} from "../../../domain/plan-week.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconPlus } from "../../components/v2/icons.js";
import { sheet, sheetTrigger } from "../../components/v2/sheet.js";
import { stepper } from "../../components/v2/stepper.js";

export const PLAN_SHEET_ID = "fd-recipe-plan-sheet";
export const PLAN_MISSING_SHEET_ID = "fd-plan-missing-sheet";
const PLAN_FORM_ID = "fd-recipe-plan-form";
const MISSING_FORM_ID = "fd-plan-missing-form";

export function planEditSheetId(planId: string): string {
    return `fd-plan-edit-${planId}`;
}

export const PLAN_SLOT_LABEL: Record<PlanSlot, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snack",
};

/** The page a plan form sends the member back to. Never an address from the form. */
export type PlanBack = "today" | "recipes" | "recipe";

export function parsePlanBack(value: string): PlanBack {
    return value === "today" || value === "recipe" ? value : "recipes";
}

export function planBackPath(back: PlanBack, recipeId?: string): string {
    if (back === "today") return "/";
    if (back === "recipe" && recipeId) return `/recipes/${recipeId}`;
    return "/recipes";
}

/* ---- Data ---- */

export type WeekPlanEntry = {
    id: string;
    recipeId: string;
    recipeName: string;
    slot: PlanSlot;
    servings: number;
    yieldPortions: number;
    date: string;
};

export type WeekPlanDayView = {
    date: string;
    /** "Thu". */
    weekday: string;
    /** "Thu 12 Nov". */
    label: string;
    isToday: boolean;
    /** In slot order. */
    plans: WeekPlanEntry[];
};

export type WeekMissingLine = {
    name: string;
    /** "150 g"; null for an ingredient the recipe gives no amount for. */
    amount: string | null;
    /** What is held could not be counted: `amount` is the recipe's full amount. */
    unknown: boolean;
    unmeasured: boolean;
    /** The planned recipes that need it, "Pancakes, Beef chili". */
    neededBy: string;
};

/** What a failed move re-renders its edit sheet with: the typed values and the reason. */
export type PlanEditDraft = {
    planId: string;
    date: string;
    slot: string;
    servings?: number;
    error: string;
};

export type WeekPlanView = {
    today: string;
    days: WeekPlanDayView[];
    plannedCount: number;
    missing: WeekMissingLine[];
    /** The id of the sheet (the missing list or a plan's) to open on load. */
    openSheet?: string;
    /** A move that did not pass its checks: that plan's sheet shows these, open. */
    editDraft?: PlanEditDraft;
};

/** The week with one plan's edit sheet open on a failed move, or null when that plan is not in it. */
export function withPlanEditDraft(
    view: WeekPlanView,
    draft: PlanEditDraft,
): WeekPlanView | null {
    const there = view.days.some((day) =>
        day.plans.some((plan) => plan.id === draft.planId),
    );
    if (!there) return null;
    return {
        ...view,
        openSheet: planEditSheetId(draft.planId),
        editDraft: draft,
    };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

function parts(date: string): { weekday: string; day: number; month: string } {
    const at = new Date(`${date}T00:00:00Z`);
    return {
        weekday: WEEKDAYS[at.getUTCDay()]!,
        day: at.getUTCDate(),
        month: MONTHS[at.getUTCMonth()]!,
    };
}

export function planDayLabel(date: string): string {
    const p = parts(date);
    return `${p.weekday} ${p.day} ${p.month}`;
}

export function buildWeekPlanView(input: {
    today: string;
    plans: readonly RecipePlan[];
    recipes: readonly PlanRecipe[];
    stock: readonly LinkedNeed[];
    foodsById: ReadonlyMap<string, FoodQuantityFactors>;
}): WeekPlanView {
    const recipeById = new Map(input.recipes.map((r) => [r.id, r]));
    const days = weekPlan(input.plans, input.today, WEEK_PLAN_DAYS).map(
        (day): WeekPlanDayView => ({
            date: day.date,
            weekday: parts(day.date).weekday,
            label: planDayLabel(day.date),
            isToday: day.date === input.today,
            plans: day.plans.flatMap((p) => {
                const recipe = recipeById.get(p.recipeId);
                if (!recipe) return [];
                return [
                    {
                        id: p.id,
                        recipeId: p.recipeId,
                        recipeName: recipe.name,
                        slot: p.slot,
                        servings: p.servings,
                        yieldPortions: recipe.yieldPortions,
                        date: p.date,
                    },
                ];
            }),
        }),
    );
    const plannedCount = days.reduce((n, d) => n + d.plans.length, 0);
    const missing = missingForPlan(input.plans, input.recipes, input.stock, {
        from: input.today,
        days: WEEK_PLAN_DAYS,
        foodsById: input.foodsById,
    })
        .filter((line) => line.foodId != null)
        .map((line): WeekMissingLine => ({
            name: line.displayName,
            amount: line.missing
                ? formatQuantityDisplayParts(
                      line.missing.amount,
                      line.missing.unit,
                  )
                : null,
            unknown: line.unknown,
            unmeasured: line.unmeasured,
            neededBy: [...new Set(line.neededBy.map((n) => n.recipeName))].join(
                ", ",
            ),
        }));
    return { today: input.today, days, plannedCount, missing };
}

/* ---- Markup ---- */

function hidden(name: string, value: string): string {
    return `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`;
}

function slotOptions(selected: string): string {
    return PLAN_SLOTS.map(
        (slot) =>
            `<option value="${slot}"${slot === selected ? " selected" : ""}>${PLAN_SLOT_LABEL[slot]}</option>`,
    ).join("");
}

function servingsUnit(servings: number): string {
    return servings === 1 ? "serving" : "servings";
}

/** The day, meal and servings fields the add and move forms share. */
function planFields(opts: {
    idPrefix: string;
    today: string;
    date: string;
    slot: string;
    servings: number;
    yieldPortions: number;
}): string {
    return `<label class="fd-plan-field"><span class="fd-plan-field__label">Day</span><input type="date" name="date" value="${esc(opts.date)}" min="${esc(opts.today)}" required /></label>
<label class="fd-plan-field"><span class="fd-plan-field__label">Meal</span><span class="fd-plan-select"><select name="slot">${slotOptions(opts.slot)}</select></span></label>
<p class="fd-plan-field__label">Servings</p>
${String(
    stepper({
        name: "servings",
        label: "Servings",
        value: opts.servings,
        step: 1,
        inputStep: "any",
        min: Math.min(1, opts.yieldPortions),
        unit: servingsUnit(opts.servings),
        id: `${opts.idPrefix}-servings`,
        className: "fd-plan-stepper",
    }),
)}`;
}

export type PlanSheetView = {
    recipeId: string;
    recipeName: string;
    yieldPortions: number;
    /** The household's today: the earliest day the picker offers. */
    today: string;
    date: string;
    slot: string;
    servings: number;
    /** A failed add re-renders the page with the sheet open. */
    open?: boolean;
    error?: string;
};

/** The recipe page's "Add to plan" sheet. */
export function renderPlanSheet(view: PlanSheetView): string {
    const err = view.error
        ? `<p class="fd-plan-error" role="alert">${esc(view.error)}</p>`
        : "";
    const body = `<form id="${PLAN_FORM_ID}" class="fd-plan-form" method="post" action="/recipes/${esc(view.recipeId)}/plan">
${err}${planFields({
        idPrefix: "fd-recipe-plan",
        today: view.today,
        date: view.date,
        slot: view.slot,
        servings: view.servings,
        yieldPortions: view.yieldPortions,
    })}
</form>`;
    return sheet({
        id: PLAN_SHEET_ID,
        kind: "confirm",
        title: "Add to plan",
        subtitle: view.recipeName,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${PLAN_FORM_ID}">Add to plan</button>`,
        openOnLoad: view.open,
        focus: "panel",
    });
}

const CALENDAR_ICON = raw(
    `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>`,
);

/** The Plan button that opens the sheet. */
export function renderPlanTrigger(): Html {
    return raw(
        sheetTrigger({
            target: PLAN_SHEET_ID,
            label: "Plan",
            className: "fd-recipe-plan-btn",
            icon: `${String(CALENDAR_ICON)}<span>Plan</span>`,
        }),
    );
}

/**
 * One sheet per planned recipe in the week: change the day, meal or servings,
 * or take it off the plan. Rendered on every page that lists the week, so the
 * rows' buttons have something to open.
 */
export function renderPlanEditSheets(
    view: WeekPlanView,
    back: PlanBack,
): string {
    return view.days
        .flatMap((day) => day.plans)
        .map((plan) => {
            const id = planEditSheetId(plan.id);
            const moveId = `${id}-move`;
            const removeId = `${id}-remove`;
            const draft =
                view.editDraft?.planId === plan.id ? view.editDraft : null;
            const draftServings = draft?.servings;
            const err = draft
                ? `<p class="fd-plan-error" role="alert">${esc(draft.error)}</p>`
                : "";
            const body = `<form id="${esc(moveId)}" class="fd-plan-form" method="post" action="/recipes/plan/${esc(plan.id)}/move">
${hidden("back", back)}${err}${planFields({
                idPrefix: id,
                today: view.today,
                date: draft ? draft.date : plan.date,
                slot: draft ? draft.slot : plan.slot,
                servings:
                    draftServings != null && Number.isFinite(draftServings)
                        ? draftServings
                        : plan.servings,
                yieldPortions: plan.yieldPortions,
            })}
</form>
<form id="${esc(removeId)}" method="post" action="/recipes/plan/${esc(plan.id)}/remove">${hidden("back", back)}</form>`;
            const actions = `<button type="submit" class="fd-btn fd-btn--danger" form="${esc(removeId)}">Remove</button>
<button type="submit" class="fd-btn fd-btn--primary" form="${esc(moveId)}">Save</button>`;
            return sheet({
                id,
                kind: "confirm",
                title: plan.recipeName,
                subtitle: `${planDayLabel(plan.date)} · ${PLAN_SLOT_LABEL[plan.slot].toLowerCase()}`,
                body,
                actions,
                openOnLoad: view.openSheet === id,
                focus: "panel",
            });
        })
        .join("\n");
}

function ingredientsMissingText(count: number): string {
    return count === 1
        ? "1 ingredient missing"
        : `${count} ingredients missing`;
}

/**
 * "2 ingredients missing · Add to groceries" (it opens the list), or a line
 * saying the kitchen covers the week, or nothing when nothing is planned.
 */
export function renderWeekMissingLine(view: WeekPlanView): string {
    if (view.plannedCount === 0) return "";
    if (view.missing.length === 0) {
        return `<p class="fd-plan-covered">You have everything for this week</p>`;
    }
    return sheetTrigger({
        target: PLAN_MISSING_SHEET_ID,
        label: `${ingredientsMissingText(view.missing.length)} · add to groceries`,
        className: "fd-plan-missing-link",
    });
}

/**
 * "Missing for the plan": what the week needs beyond the kitchen, with the
 * button that puts it on the grocery list. An amount the kitchen could not be
 * counted against says so, and says the full amount is what gets added.
 */
export function renderMissingSheet(view: WeekPlanView, back: PlanBack): string {
    if (view.missing.length === 0) return "";
    const rows = view.missing
        .map((line) => {
            const note = line.unknown
                ? `${line.neededBy} · can't tell what you have, so the full amount is added`
                : line.unmeasured
                  ? `${line.neededBy} · no amount, added as to taste`
                  : line.neededBy;
            return `<li class="fd-plan-missing-row${line.unknown ? " fd-plan-missing-row--unknown" : ""}"><span class="fd-plan-missing-row__main"><span class="fd-plan-missing-row__name">${esc(line.name)}</span><span class="fd-plan-missing-row__note">${esc(note)}</span></span>${line.amount ? `<span class="fd-plan-missing-row__amount">${esc(line.amount)}</span>` : ""}</li>`;
        })
        .join("");
    const body = `<form id="${MISSING_FORM_ID}" method="post" action="/recipes/plan/add-missing">
${hidden("back", back)}<ul class="fd-plan-missing-list">${rows}</ul>
</form>`;
    return sheet({
        id: PLAN_MISSING_SHEET_ID,
        kind: "confirm",
        title: "Missing for the plan",
        subtitle: `${ingredientsMissingText(view.missing.length)} for the next 7 days`,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${MISSING_FORM_ID}">Add to groceries</button>`,
        openOnLoad: view.openSheet === PLAN_MISSING_SHEET_ID,
        focus: "panel",
    });
}

function planAddHref(date: string): string {
    return `/recipes?plan_date=${encodeURIComponent(date)}`;
}

function planButton(plan: WeekPlanEntry, inner: string): string {
    return sheetTrigger({
        target: planEditSheetId(plan.id),
        label: `Change ${plan.recipeName}, ${planDayLabel(plan.date)}`,
        className: "fd-plan-item",
        icon: inner,
    });
}

/**
 * The seven days as rows, for the Today rail card and the phone Today section:
 * the weekday, the planned recipe (a button that opens its sheet) with its
 * meal, or "Nothing planned" and a plus that goes to Recipes to pick one.
 */
export function renderWeekRows(view: WeekPlanView): string {
    const items = view.days.flatMap((day) => {
        const day3 = day.weekday.toUpperCase();
        if (day.plans.length === 0) {
            return [
                `<li class="fd-plan-day fd-plan-day--empty"><span class="fd-plan-day__label">${esc(day3)}</span><span class="fd-plan-day__name">Nothing planned</span><a class="fd-plan-day__add" href="${esc(planAddHref(day.date))}" aria-label="Plan a recipe for ${esc(day.label)}">${String(iconPlus())}</a></li>`,
            ];
        }
        return day.plans.map((plan, i) => {
            const label = i === 0 ? esc(day3) : "";
            const inner = `<span class="fd-plan-item__name">${esc(plan.recipeName)}</span><span class="fd-plan-item__slot">${esc(PLAN_SLOT_LABEL[plan.slot])}</span>`;
            return `<li class="fd-plan-day${day.isToday ? " fd-plan-day--today" : ""}"><span class="fd-plan-day__label">${label}</span>${planButton(plan, inner)}</li>`;
        });
    });
    return `<ul class="fd-plan-days">${items.join("")}</ul>`;
}

/**
 * The Recipes page's This week: seven tiles (a planned day shows its recipes,
 * an open one "+ Plan"), and the missing link in the heading row. On the phone
 * only the planned days show, under a small label.
 */
export function renderWeekStrip(view: WeekPlanView): string {
    const tiles = view.days
        .map((day) => {
            const day3 = esc(day.weekday.toUpperCase());
            if (day.plans.length === 0) {
                return `<li class="fd-plan-tile fd-plan-tile--empty"><a class="fd-plan-tile__add" href="${esc(planAddHref(day.date))}" aria-label="Plan a recipe for ${esc(day.label)}"><span class="fd-plan-tile__day">${day3}</span><span class="fd-plan-tile__name">+ Plan</span></a></li>`;
            }
            const buttons = day.plans
                .map((plan) =>
                    planButton(
                        plan,
                        `<span class="fd-plan-tile__name">${esc(plan.recipeName)}</span>`,
                    ),
                )
                .join("");
            return `<li class="fd-plan-tile"><span class="fd-plan-tile__day">${day3}</span>${buttons}</li>`;
        })
        .join("");
    const empty =
        view.plannedCount === 0
            ? `<p class="fd-plan-empty">Nothing planned yet. Tap Plan on a recipe to put it on a day.</p>`
            : "";
    // Title, then the tiles, then the missing link: on the phone that is the
    // reading order; the desktop grid lifts the link up beside the title.
    return `<section class="fd-plan-strip" aria-labelledby="fd-plan-strip-title">
<h2 class="fd-plan-strip__title" id="fd-plan-strip-title"><span class="fd-plan-strip__title--phone">Planned this week</span><span class="fd-plan-strip__title--desk">This week</span></h2>
${empty}<ul class="fd-plan-tiles">${tiles}</ul>
${renderWeekMissingLine(view)}
</section>`;
}

/** The phone Today's This week section (the desktop has the rail card instead). */
export function renderWeekPhoneSection(view: WeekPlanView): string {
    return `<section class="fd-today-section fd-plan-phone" aria-labelledby="fd-plan-phone-title">
<div class="fd-plan-phone__head"><h2 class="fd-plan-phone__title" id="fd-plan-phone-title">This week</h2><a class="fd-plan-phone__link" href="/recipes">Recipes</a></div>
${renderWeekRows(view)}${renderWeekMissingLine(view)}
</section>`;
}
