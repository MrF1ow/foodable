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
    type PlanRepeat,
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
import { chipGroup } from "../../components/v2/chip.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, menuRow, type MenuItem } from "../../components/v2/menu.js";
import { miniCard } from "../../components/v2/mini-card.js";
import { monthPicker } from "../../components/v2/month-picker.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
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
    /** How the entry repeats (`once` for a one-off): what the edit sheet's Repeat row starts on. */
    repeat?: PlanRepeat;
    /** The weekdays of a "pick days" repeat, 0 = Sunday. */
    days?: number[];
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
    /** The food the line adds; null for a line that names none (no checkbox). */
    foodId: string | null;
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
    recipeId?: string;
    date: string;
    slot: string;
    servings?: number;
    repeat?: string;
    days?: readonly number[];
    error: string;
};

export type WeekPlanView = {
    today: string;
    days: WeekPlanDayView[];
    plannedCount: number;
    missing: WeekMissingLine[];
    /** The household's saved recipes: what a planned entry's Recipe menu offers. */
    recipeChoices?: { id: string; name: string }[];
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
    /** The household's saved recipes; without them the Recipe menu lists the planned ones. */
    savedRecipes?: readonly { id: string; name: string }[];
    /** How each repeat repeats, by its id; an entry on one not listed reads as a one-off. */
    rules?: ReadonlyMap<string, { repeat: PlanRepeat; days: number[] }>;
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
                        repeat:
                            (p.ruleId && input.rules?.get(p.ruleId)?.repeat) ||
                            "once",
                        days: [
                            ...((p.ruleId &&
                                input.rules?.get(p.ruleId)?.days) ||
                                []),
                        ],
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
            foodId: line.foodId,
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
    const recipeChoices = (
        input.savedRecipes ??
        input.recipes.map((r) => ({ id: r.id, name: r.name }))
    )
        .map((r) => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    return { today: input.today, days, plannedCount, missing, recipeChoices };
}

/* ---- Markup ---- */

function hidden(name: string, value: string): string {
    return `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`;
}

function servingsUnit(servings: number): string {
    return servings === 1 ? "serving" : "servings";
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
    /** How it repeats from `date` (`once` when absent). */
    repeat?: string;
    /** The weekdays of a "pick days" repeat, 0 = Sunday. */
    days?: readonly number[];
    /** A failed add re-renders the page with the sheet open. */
    open?: boolean;
    error?: string;
};

/** The repeat choices, in the order the Repeat pull-down lists them. */
const REPEAT_CHOICES = [
    { value: "once", label: "Once" },
    { value: "weekly", label: "Every week" },
    { value: "daily", label: "Every day" },
    { value: "weekdays", label: "Weekdays" },
    { value: "days", label: "Pick days" },
] as const;

/** The meal choices the Plan sheet's pull-down lists. */
const MEAL_CHOICES = [
    { value: "breakfast", label: "Breakfast" },
    { value: "lunch", label: "Lunch" },
    { value: "dinner", label: "Dinner" },
    { value: "snack", label: "Snacks" },
] as const;

const WEEKDAY_NAMES = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
] as const;

/**
 * The Repeat row and the weekday chips a repeat of "Pick days" shows under it,
 * as the Plan sheet and a planned entry's edit sheet both draw them.
 * `client/v2/recipes.js` shows the chips for "days" and keeps the form's one
 * `days` field per picked weekday in step with them.
 */
function repeatControls(
    value: string | undefined,
    pickedDays: readonly number[] | undefined,
): { row: Html; pickDays: Html } {
    const repeat = REPEAT_CHOICES.some((c) => c.value === value)
        ? value!
        : "once";
    const days = (pickedDays ?? []).filter(
        (d) => Number.isInteger(d) && d >= 0 && d <= 6,
    );
    const row = pickRow({
        title: "Repeat",
        name: "repeat",
        options: REPEAT_CHOICES,
        // "Pick days" stays the row's word while the weekday chips are showing
        // (frame 409279); the chips hold the days.
        selected: repeat,
    });
    const chips = chipGroup({
        label: "Repeat on",
        select: "multiple",
        className: "fd-plan-days__chips",
        chips: WEEKDAY_NAMES.map((name, day) => ({
            label: name.slice(0, 1),
            ariaLabel: name,
            value: String(day),
            selected: days.includes(day),
        })),
    });
    // One hidden `days` per picked weekday: the chips are buttons, so the
    // script keeps these in step with them.
    const fields = days
        .map((d) => `<input type="hidden" name="days" value="${d}">`)
        .join("");
    return {
        row,
        pickDays: raw(
            `<div class="fd-plan-days" data-fd-plan-days${repeat === "days" ? "" : " hidden"}>${chips}<span data-fd-plan-days-fields>${repeat === "days" ? fields : ""}</span></div>`,
        ),
    };
}

/**
 * The recipe page's "Plan <recipe>" sheet: Starts (a row that opens a month
 * picker), Meal and Repeat (pull-downs; "Pick days" shows a row of weekday
 * chips), then the servings, and Plan. The form posts the day (`date`), `slot`,
 * `repeat`, one `days` per picked weekday and `servings` to the recipe's plan
 * route. `client/v2/recipes.js` runs the picker, the chips and the Repeat row.
 */
export function renderPlanSheet(view: PlanSheetView): string {
    const err = view.error
        ? `<p class="fd-plan-error" role="alert">${esc(view.error)}</p>`
        : "";
    const starts = monthPicker({
        id: "fd-recipe-plan-starts",
        name: "date",
        title: "Starts",
        value: view.date,
        today: view.today,
        min: view.today,
    });
    const mealRow = pickRow({
        title: "Meal",
        name: "slot",
        options: MEAL_CHOICES,
        selected: view.slot,
    });
    const repeating = repeatControls(view.repeat, view.days);
    const when = join([
        listGroup({ rows: [starts.row], label: "Starts" }),
        starts.picker,
        listGroup({
            rows: [mealRow, repeating.row],
            label: "Meal and repeat",
        }),
        repeating.pickDays,
    ]);
    const servings = sheetSection({
        kind: "amount",
        label: "Servings",
        content: stepper({
            name: "servings",
            label: "Servings",
            value: view.servings,
            step: 1,
            inputStep: "any",
            min: Math.min(1, view.yieldPortions),
            unit: servingsUnit(view.servings),
            id: "fd-recipe-plan-servings",
            className: "fd-plan-stepper",
        }),
    });
    const body = `<form id="${PLAN_FORM_ID}" class="fd-plan-form" method="post" action="/recipes/${esc(view.recipeId)}/plan" data-fd-plan-form>
${err}${String(sheetSection({ kind: "rows", content: when }))}
${String(servings)}
</form>`;
    return sheet({
        id: PLAN_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: `Plan ${view.recipeName}` },
        body: raw(body),
        actions: {
            kind: "single",
            primary: {
                label: "Plan",
                type: "submit",
                form: PLAN_FORM_ID,
            },
        },
        openOnLoad: view.open,
        className: "fd-plan-sheet",
        focus: "panel",
    });
}

/**
 * A row whose value is a pull-down (Recipe, Meal, Repeat): an Item row with its
 * title and value that opens the choices, the form's own hidden field
 * carrying the pick as `name`. `client/v2/menu.js` writes the chosen label
 * into the row.
 */
function pickRow(opts: {
    title: string;
    name: string;
    options: readonly { value: string; label: string }[];
    selected: string;
    /** What the row reads instead of the chosen label (the picked weekdays). */
    value?: string;
}): Html {
    const chosen =
        opts.options.find((o) => o.value === opts.selected) ?? opts.options[0]!;
    return menuRow({
        label: opts.title,
        row: { title: opts.title, value: opts.value ?? chosen.label },
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
 * One sheet per planned recipe in the week, titled with its day and the meal
 * under it. Rows: Recipe (the household's saved recipes) and Day (a month
 * calendar), Meal and Repeat (pull-downs; "Pick days" shows the weekday chips),
 * then Servings (a stepper), with Remove beside Save. Save posts `recipe_id`,
 * `date`, `slot`, `repeat`, one `days` per picked weekday and `servings` to the
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
            const recipeId = draft?.recipeId || plan.recipeId;
            const repeat = draft?.repeat ?? plan.repeat;
            const days = draft?.days ?? plan.days;
            const servings =
                draftServings != null && Number.isFinite(draftServings)
                    ? draftServings
                    : plan.servings;
            const err = draft
                ? `<p class="fd-plan-error" role="alert">${esc(draft.error)}</p>`
                : "";
            // Every saved recipe, by name; the entry's own stays a choice
            // even if the list does not hold it.
            const recipes = [...(view.recipeChoices ?? [])];
            if (!recipes.some((r) => r.id === plan.recipeId)) {
                recipes.push({ id: plan.recipeId, name: plan.recipeName });
            }
            recipes.sort((a, b) => a.name.localeCompare(b.name));
            const recipeRow = pickRow({
                title: "Recipe",
                name: "recipe_id",
                options: recipes.map((r) => ({ value: r.id, label: r.name })),
                selected: recipeId,
            });
            const dayPicker = monthPicker({
                id: `${id}-day`,
                name: "date",
                title: "Day",
                value: date,
                today: view.today,
                min: view.today,
            });
            const mealRow = pickRow({
                title: "Meal",
                name: "slot",
                options: PLAN_SLOTS.map((value) => ({
                    value,
                    label: PLAN_SLOT_LABEL[value],
                })),
                selected: slot,
            });
            const repeating = repeatControls(repeat, days);
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
            const when = join([
                listGroup({
                    rows: [recipeRow, dayPicker.row],
                    label: "Recipe and day",
                }),
                dayPicker.picker,
                listGroup({
                    rows: [mealRow, repeating.row],
                    label: "Meal and repeat",
                }),
                repeating.pickDays,
            ]);
            const body = `<form id="${esc(moveId)}" class="fd-plan-form" method="post" action="/recipes/plan/${esc(plan.id)}/move" data-fd-plan-form>
${hidden("back", back)}${err}${String(sheetSection({ kind: "rows", content: when }))}
${String(servingsSection)}
</form>
<form id="${esc(removeId)}" method="post" action="/recipes/plan/${esc(plan.id)}/remove">${hidden("back", back)}</form>`;
            return sheet({
                id,
                placement: "side",
                className: "fd-plan-edit-sheet",
                header: {
                    kind: "title",
                    title: planDayLabel(plan.date),
                    subtitle: PLAN_SLOT_LABEL[plan.slot],
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
 * button that puts it on the grocery list. Each note is one short line, as
 * frame 386617 draws it ("Beef chili · to taste"); an amount the kitchen could
 * not be counted against says the full amount is what gets added.
 */
export function renderMissingSheet(view: WeekPlanView, back: PlanBack): string {
    if (view.missing.length === 0) return "";
    // One checkbox per food: `missingForPlan` can list a food on several lines
    // (one per unit it cannot convert), and the add is per food. The first line
    // of a food carries the box; the others follow it with no lead of their own.
    const boxed = new Set<string>();
    const rows = view.missing.map((line) => {
        const note = line.unknown
            ? `${line.neededBy} · full amount`
            : line.unmeasured
              ? `${line.neededBy} · to taste`
              : line.neededBy;
        const row = itemRow({
            title: line.name,
            meta: line.amount ?? undefined,
            subtitle: note,
            // Every food starts ticked; only the ticked foods are added. A line
            // with no food has nothing to tick: the server skips it.
            lead:
                line.foodId != null && !boxed.has(line.foodId)
                    ? {
                          kind: "checkbox",
                          label: `Add ${line.name}`,
                          name: "food_ids[]",
                          value: line.foodId,
                          checked: true,
                      }
                    : undefined,
        });
        if (line.foodId != null) boxed.add(line.foodId);
        return row;
    });
    const body = `<form id="${MISSING_FORM_ID}" method="post" action="/recipes/plan/add-missing" data-fd-plan-missing>
${hidden("back", back)}${hidden("food_ids_sent", "1")}${String(
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
    const ticked = boxed.size;
    return sheet({
        id: PLAN_MISSING_SHEET_ID,
        // A side panel at 1024 px and up, as 616102 draws it.
        placement: "side",
        header: {
            kind: "title",
            title: "Missing for the plan",
            subtitle: `${count} ${count === 1 ? "ingredient" : "ingredients"} · next 7 days`,
        },
        body: raw(body),
        actions: {
            kind: "single",
            primary: {
                // The count follows the ticks (client/v2/recipes.js).
                label: `Add ${ticked} to groceries`,
                type: "submit",
                form: MISSING_FORM_ID,
                attrs: { "data-fd-plan-missing-add": "" },
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
