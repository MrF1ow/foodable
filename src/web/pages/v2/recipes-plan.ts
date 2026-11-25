/**
 * The week plan in the new app: "Add to plan" on a recipe, This week on Today
 * (a list of the planned entries) and on Recipes (a strip of seven days), the
 * sheets that move or remove a plan, and the sheet that lists what the plan
 * still needs and puts it on the grocery list.
 *
 * An entry is shown as it is stored, one per recipe, day and meal: nothing is
 * merged, summed or split. An entry that is a day of a repeat names that one
 * repeat, and its menu offers to remove this day or end the whole series.
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
    countedServings,
    missingForPlan,
    WEEK_PLAN_DAYS,
    weekPlan,
    type PlanRecipe,
} from "../../../domain/plan-week.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { iconPlus } from "../../components/v2/icons.js";
import { icon } from "../../components/v2/icon.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import {
    sheet,
    sheetSection,
    sheetTrigger,
} from "../../components/v2/sheet.js";
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
    /** What the plan counts: a named plan's people's portions as saved now. */
    servings: number;
    yieldPortions: number;
    date: string;
    /** The plan is for named people: it has no servings of its own to edit. */
    named: boolean;
    /** The one repeat this entry is a day of; absent on a one-off plan. */
    ruleId?: string;
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
                        servings: countedServings(p, recipe.versions),
                        yieldPortions: recipe.yieldPortions,
                        date: p.date,
                        named: (p.memberIds?.length ?? 0) > 0,
                        ruleId: p.ruleId,
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
    /** A plan for named people has no servings to set: it follows their portions. */
    named?: boolean;
}): string {
    const servingsField = opts.named
        ? `<p class="fd-plan-field__label">Servings</p>
<p class="fd-plan-named">${esc(`${opts.servings} ${servingsUnit(opts.servings)}: the portions of the people it is for. Change their portions to change it.`)}</p>`
        : `<p class="fd-plan-field__label">Servings</p>
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
    return `<label class="fd-plan-field"><span class="fd-plan-field__label">Day</span><input type="date" name="date" value="${esc(opts.date)}" min="${esc(opts.today)}" required /></label>
<label class="fd-plan-field"><span class="fd-plan-field__label">Meal</span><span class="fd-plan-select"><select name="slot">${slotOptions(opts.slot)}</select></span></label>
${servingsField}`;
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

/** How many days ahead the Day pull-down reaches. */
const DAY_CHOICES = 14;

function dayChoiceLabel(date: string): string {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
        !Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())
        ? planDayLabel(date)
        : date;
}

/** `date` moved by `days` calendar days. */
function dayAfter(date: string, days: number): string {
    const at = new Date(`${date}T00:00:00Z`);
    at.setUTCDate(at.getUTCDate() + days);
    return at.toISOString().slice(0, 10);
}

/**
 * A row whose value is a pull-down: an Item row with its title, value and
 * chevron, and the form's own `<select>` laid invisibly over it, so a press
 * anywhere on the row opens the list and the form posts it as `name`. The page
 * script writes the chosen option into the row's value.
 */
function pickRow(opts: {
    title: string;
    name: string;
    options: readonly { value: string; label: string }[];
    selected: string;
}): Html {
    const options = opts.options
        .map(
            (o) =>
                `<option value="${esc(o.value)}"${o.value === opts.selected ? " selected" : ""}>${esc(o.label)}</option>`,
        )
        .join("");
    const select = `<select class="fd-plan-edit-row__select" name="${esc(opts.name)}" aria-label="${esc(opts.title)}">${options}</select>`;
    const chosen = opts.options.find((o) => o.value === opts.selected);
    const row = String(
        itemRow({
            title: opts.title,
            value: chosen?.label ?? opts.selected,
            trailing: { kind: "chevron" },
            className: "fd-plan-edit-row",
        }),
    );
    return raw(row.replace(/<\/div><\/li>$/, () => `${select}</div></li>`));
}

/**
 * One sheet per planned recipe in the week, titled with its day and the meal
 * under it: Day and Meal are rows with pull-downs, Servings a stepper, Remove
 * beside Save. Save posts the day, meal and servings to the move route, Remove
 * to the remove route. Rendered on every page that lists the week, so the
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
            const date = draft ? draft.date : plan.date;
            const slot = draft ? draft.slot : plan.slot;
            const servings =
                draftServings != null && Number.isFinite(draftServings)
                    ? draftServings
                    : plan.servings;
            const err = draft
                ? `<p class="fd-plan-error" role="alert">${esc(draft.error)}</p>`
                : "";
            // Today on, two weeks of days; a day outside them (the plan's own,
            // or one a failed save typed) stays a choice so nothing is lost.
            const days = Array.from({ length: DAY_CHOICES }, (_, i) =>
                dayAfter(view.today, i),
            );
            if (!days.includes(date)) days.push(date);
            const dayRowHtml = pickRow({
                title: "Day",
                name: "date",
                options: days.map((d) => ({
                    value: d,
                    label: dayChoiceLabel(d),
                })),
                selected: date,
            });
            const mealRowHtml = pickRow({
                title: "Meal",
                name: "slot",
                options: PLAN_SLOTS.map((value) => ({
                    value,
                    label: PLAN_SLOT_LABEL[value],
                })),
                selected: slot,
            });
            const servingsSection = plan.named
                ? sheetSection({
                      kind: "message",
                      label: "Servings",
                      text: `${plan.servings} ${servingsUnit(plan.servings)}: the portions of the people it is for. Change their portions to change it.`,
                  })
                : sheetSection({
                      kind: "amount",
                      label: "Servings",
                      content: stepper({
                          name: "servings",
                          label: "Servings",
                          value: servings,
                          step: 1,
                          inputStep: "any",
                          min: Math.min(1, plan.yieldPortions),
                          unit: servingsUnit(servings),
                          id: `${id}-servings`,
                          className: "fd-plan-stepper",
                      }),
                  });
            const body = `<form id="${esc(moveId)}" class="fd-plan-form" method="post" action="/recipes/plan/${esc(plan.id)}/move">
${hidden("back", back)}${err}${String(
                sheetSection({
                    kind: "rows",
                    content: listGroup({
                        rows: [dayRowHtml, mealRowHtml],
                        label: "When",
                    }),
                }),
            )}
${String(servingsSection)}
</form>
<form id="${esc(removeId)}" method="post" action="/recipes/plan/${esc(plan.id)}/remove">${hidden("back", back)}</form>`;
            return sheet({
                id,
                placement: "side",
                header: {
                    kind: "title",
                    title: planDayLabel(plan.date),
                    subtitle: PLAN_SLOT_LABEL[plan.slot],
                },
                body: raw(body),
                actions: {
                    kind: "pair",
                    cancel: {
                        label: "Remove",
                        type: "submit",
                        form: removeId,
                    },
                    primary: { label: "Save", type: "submit", form: moveId },
                },
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
    const rows = view.missing.map((line) => {
        const note = line.unknown
            ? `${line.neededBy} · can't tell what you have, so the full amount is added`
            : line.unmeasured
              ? `${line.neededBy} · no amount, added as to taste`
              : line.neededBy;
        return itemRow({
            title: line.name,
            meta: line.amount ?? undefined,
            subtitle: note,
            lead: { kind: "dot", color: line.unknown ? "warn" : "good" },
        });
    });
    const body = `<form id="${MISSING_FORM_ID}" method="post" action="/recipes/plan/add-missing">
${hidden("back", back)}${String(listGroup({ rows, label: "Missing for the plan", className: "fd-plan-missing-list" }))}
</form>`;
    return sheet({
        id: PLAN_MISSING_SHEET_ID,
        kind: "confirm",
        title: "Missing for the plan",
        subtitle: `${ingredientsMissingText(view.missing.length)} · next 7 days`,
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${MISSING_FORM_ID}">Add ${view.missing.length} to groceries</button>`,
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

/**
 * "5 ingredients missing" under This week: a cart and the count, opening the
 * Missing for the plan sheet. Nothing when nothing is planned or nothing is
 * missing.
 */
function missingRow(view: WeekPlanView): string {
    if (view.plannedCount === 0 || view.missing.length === 0) return "";
    return sheetTrigger({
        target: PLAN_MISSING_SHEET_ID,
        label: ingredientsMissingText(view.missing.length),
        className: "fd-plan-missing-link",
        icon: `${String(icon("cart"))}<span>${esc(ingredientsMissingText(view.missing.length))}</span>`,
    });
}

/** What an entry's menu does: edit it, or take it off the week. */
function entryMenu(plan: WeekPlanEntry, day: WeekPlanDayView, back: PlanBack) {
    const action = `/recipes/plan/${plan.id}/remove`;
    const items: MenuItem[] = [
        {
            kind: "opens",
            label: "Edit",
            sheetId: planEditSheetId(plan.id),
        },
    ];
    if (plan.ruleId == null) {
        items.push({
            kind: "destructive",
            label: "Remove",
            action,
            fields: { back },
        });
    } else {
        // A day of a repeat: this day alone, or the repeat from this day on.
        items.push(
            {
                kind: "destructive",
                label: "This day",
                confirmLabel: "Remove this day",
                action,
                fields: { back, scope: "day" },
            },
            {
                kind: "destructive",
                label: "The whole series",
                confirmLabel: "End the series",
                action,
                fields: { back, scope: "series" },
            },
        );
    }
    return menu({
        label: `Actions for ${plan.recipeName}, ${day.label}`,
        anchor: "more",
        items,
    });
}

/**
 * Today's This week: a section header with Plan, then one row per planned
 * entry in the order the week gives them: the recipe and its meal, the day,
 * and a menu. A row opens the entry's edit sheet. Entries are shown as stored,
 * never merged or summed; a day of a repeat has This day and The whole series
 * in its menu, for that one repeat.
 */
export function renderWeekSection(view: WeekPlanView, back: PlanBack): string {
    const rows = view.days.flatMap((day) =>
        day.plans.map((plan) => {
            const slot = PLAN_SLOT_LABEL[plan.slot];
            const sheetId = planEditSheetId(plan.id);
            const html = String(
                itemRow({
                    title: plan.recipeName,
                    subtitle: slot,
                    value: day.isToday ? "Today" : day.weekday,
                    trailing: {
                        kind: "control",
                        html: entryMenu(plan, day, back),
                    },
                    className: "fd-plan-row",
                }),
            );
            // A function replacement: a string would read `$` in an id as a pattern.
            return raw(
                html.replace(
                    "<li ",
                    () =>
                        `<li data-fd-sheet-row data-sheet-id="${esc(sheetId)}" tabindex="0" `,
                ),
            );
        }),
    );
    const list =
        rows.length > 0
            ? listGroup({ rows, label: "This week" })
            : listGroup({
                  rows: [itemRow({ title: "Nothing planned" })],
                  label: "This week",
              });
    return `<section class="fd-today-section fd-plan-week" aria-label="This week">${String(
        sectionHeader({
            label: "This week",
            rule: false,
            action: { label: "Plan", href: "/recipes" },
        }),
    )}${String(list)}${missingRow(view)}</section>`;
}
