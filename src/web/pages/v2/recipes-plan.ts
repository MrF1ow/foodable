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
import { button } from "../../components/v2/button.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, menuRow, type MenuItem } from "../../components/v2/menu.js";
import { miniCard } from "../../components/v2/mini-card.js";
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
 * A row whose value is a pull-down (Day, Meal): an Item row with its title,
 * value and chevron that opens the choices, the form's own hidden field
 * carrying the pick as `name`. `client/v2/menu.js` writes the chosen label
 * into the row.
 */
function pickRow(opts: {
    title: string;
    name: string;
    options: readonly { value: string; label: string }[];
    selected: string;
}): Html {
    const chosen =
        opts.options.find((o) => o.value === opts.selected) ?? opts.options[0]!;
    return menuRow({
        label: opts.title,
        row: { title: opts.title, value: chosen.label },
        field: { name: opts.name, value: chosen.value },
        items: opts.options.map((o) => ({
            kind: "checked" as const,
            label: o.label,
            checked: o.value === chosen.value,
            value: o.value,
        })),
    });
}

/**
 * One sheet per planned recipe in the week, titled with its recipe and the day
 * and meal under it: Day and Meal are rows with pull-downs, Servings a
 * stepper, Remove beside Save. Save posts the day, meal and servings to the
 * move route, Remove to the remove route. Rendered on every page that lists
 * the week, so the rows' buttons and cards have something to open.
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
                className: "fd-plan-edit-sheet",
                header: {
                    kind: "title",
                    title: plan.recipeName,
                    subtitle: `${planDayLabel(plan.date)} · ${PLAN_SLOT_LABEL[plan.slot].toLowerCase()}`,
                },
                body: raw(body),
                actions: {
                    kind: "pair",
                    // Remove asks in place: it arms, then Cancel and Remove
                    // take the row.
                    cancel: { label: "Remove" },
                    primary: { label: "Save", type: "submit", form: moveId },
                    confirm: { label: "Remove", form: removeId },
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
            // The design marks each line with the filled ring: all of it is added.
            lead: { kind: "done", label: "Will be added" },
        });
    });
    const body = `<form id="${MISSING_FORM_ID}" method="post" action="/recipes/plan/add-missing">
${hidden("back", back)}${String(
        sheetSection({
            kind: "rows",
            content: listGroup({
                rows,
                label: "Missing for the plan",
                className: "fd-plan-missing-list",
            }),
        }),
    )}
</form>`;
    const count = view.missing.length;
    return sheet({
        id: PLAN_MISSING_SHEET_ID,
        placement: "dialog",
        header: {
            kind: "title",
            title: "Missing for the plan",
            subtitle: `${count} ${count === 1 ? "ingredient" : "ingredients"} · next 7 days`,
        },
        body: raw(body),
        actions: {
            kind: "single",
            primary: {
                label: `Add ${count} to groceries`,
                type: "submit",
                form: MISSING_FORM_ID,
            },
        },
        openOnLoad: view.openSheet === PLAN_MISSING_SHEET_ID,
        focus: "panel",
    });
}

/**
 * "5 ingredients missing": the design's small Link button with a cart, opening
 * the Missing for the plan sheet. Nothing when nothing is planned or nothing
 * is missing.
 */
export function planMissingLink(view: WeekPlanView): string {
    if (view.plannedCount === 0 || view.missing.length === 0) return "";
    return String(
        button({
            variant: "link",
            size: "md",
            icon: "cart",
            label: ingredientsMissingText(view.missing.length),
            attrs: {
                commandfor: PLAN_MISSING_SHEET_ID,
                command: "show-modal",
            },
        }),
    );
}

/**
 * The Recipes page's "Planned this week": a Section header, the planned
 * entries as Mini cards in a row (the weekday over the recipe, each opening
 * its edit sheet), and the missing link under them. Entries are shown as
 * stored, one card each; nothing when nothing is planned.
 */
export function renderPlannedWeek(view: WeekPlanView): string {
    if (view.plannedCount === 0) return "";
    const cards = view.days.flatMap((day) =>
        day.plans.map((plan) =>
            String(
                miniCard({
                    label: day.weekday,
                    title: plan.recipeName,
                    opens: planEditSheetId(plan.id),
                    className: "fd-plan-card",
                }),
            ),
        ),
    );
    return `<section class="fd-plan-week fd-plan-planned" aria-label="Planned this week">${String(
        sectionHeader({ label: "Planned this week", rule: false }),
    )}<div class="fd-plan-planned__scroll">${cards.join("")}</div>${planMissingLink(view)}</section>`;
}

/**
 * Where Today's Plan goes: the Recipes list picking a recipe for the first day
 * of the week with nothing planned (today when every day has something).
 */
export function planPickHref(view: WeekPlanView): string {
    const open = view.days.find((day) => day.plans.length === 0);
    return `/recipes?plan_date=${encodeURIComponent(open?.date ?? view.today)}`;
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
 * and a menu. A row opens the entry's edit sheet; Plan picks a recipe for the
 * first empty day. Entries are shown as stored,
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
            action: { label: "Plan", href: planPickHref(view) },
        }),
    )}${String(list)}${planMissingLink(view)}</section>`;
}
