import type { AppChromeBase } from "../../attention.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { WeightUnit } from "../../../domain/units.js";
import type { DrinkUnit } from "../../../alcohol.js";
import { formatWeight } from "../../../domain/units.js";
import { toDrinks } from "../../../alcohol.js";
import { GOAL_NAME_MAX, GOAL_NOTE_MAX } from "../../../domain/goal-label.js";
import type { GoalDayOverride } from "../../../domain/insights.js";
import { hasActiveTarget } from "../../../mcp/shared.js";
import { esc } from "../../components/v2/html.js";
import { dot } from "../../components/v2/dot.js";
import {
    confirmSheet,
    sheet,
    sheetTrigger,
} from "../../components/v2/sheet.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsPageHeader,
} from "./settings-shared.js";
import {
    goalsDraftFrom,
    type GoalsFormDraft,
    type GoalsFormField,
} from "./settings-goals-form.js";
import { formatGoalSince } from "./settings-goals-label.js";

export type SettingsGoalsV2View = {
    chrome: AppChromeBase;
    /** The standing goals (never a day's override). */
    goals: NutritionGoals | null;
    /** Today in the member's timezone: the per-day list starts here. */
    today: string;
    weightUnit: WeightUnit;
    alcohol: DrinkUnit | null;
    /** Per-day overrides from today on. */
    days: readonly GoalDayOverride[];
    /** What the form holds after a refused save; the saved goals otherwise. */
    draft?: GoalsFormDraft;
    error?: string;
    invalid?: readonly GoalsFormField[];
};

type GoalRow = {
    label: string;
    value: string;
    dotKey?:
        | "calories"
        | "protein"
        | "carbs"
        | "fat"
        | "fiber"
        | "sugar"
        | "caffeine";
};

const DRINK_NOUN: Record<DrinkUnit, [one: string, many: string]> = {
    us: ["US drink", "US drinks"],
    uk: ["UK unit", "UK units"],
};

/**
 * The alcohol limit in the member's drink unit, the same figure the edit sheet
 * opens with ("2 US drinks"); a limit of 0 is "None".
 */
export function alcoholLimitText(grams: number, unit: DrinkUnit): string {
    const drinks = toDrinks(grams, unit);
    if (drinks === 0) return "None";
    const [one, many] = DRINK_NOUN[unit];
    return `${drinks.toLocaleString("en-US")} ${drinks === 1 ? one : many}`;
}

/** A figure with the card's thousands separator ("2,421"). */
function num(n: number): string {
    return n.toLocaleString("en-US");
}

function floorGoal(
    value: number | null,
    render: (n: number) => string,
): string {
    if (!hasActiveTarget(value, "floor")) return "Not set";
    return render(value!);
}

function ceilingGoal(
    value: number | null,
    render: (n: number) => string,
): string {
    if (!hasActiveTarget(value, "ceiling")) return "Not set";
    return render(value!);
}

export function settingsGoalRows(view: SettingsGoalsV2View): GoalRow[] {
    const goals = view.goals;
    if (!goals) return [];
    const rows: GoalRow[] = [
        {
            label: "Calories",
            value: floorGoal(goals.daily_calories, (n) => `${num(n)} kcal`),
            dotKey: "calories",
        },
        {
            label: "Protein",
            value: floorGoal(goals.daily_protein_g, (n) => `${n} g`),
            dotKey: "protein",
        },
        {
            label: "Carbs",
            value: floorGoal(goals.daily_carbs_g, (n) => `${n} g`),
            dotKey: "carbs",
        },
        {
            label: "Fat",
            value: floorGoal(goals.daily_fat_g, (n) => `${n} g`),
            dotKey: "fat",
        },
    ];
    rows.push(
        {
            label: "Water",
            value: floorGoal(goals.daily_water_ml, formatWaterGoal),
        },
        {
            label: "Fiber, at least",
            value: floorGoal(goals.daily_fiber_g, (n) => `${n} g`),
            dotKey: "fiber",
        },
        {
            label: "Sugar, at most",
            value: ceilingGoal(goals.daily_sugar_g, (n) => `${n} g`),
            dotKey: "sugar",
        },
        {
            label: "Caffeine, at most",
            value: ceilingGoal(goals.daily_caffeine_mg, (n) => `${n} mg`),
            dotKey: "caffeine",
        },
    );
    if (view.alcohol) {
        rows.push({
            label: "Alcohol, at most",
            value: ceilingGoal(goals.daily_alcohol_g, (n) =>
                alcoholLimitText(n, view.alcohol!),
            ),
        });
    }
    rows.push({
        label: "Target weight",
        value:
            goals.target_weight_g != null
                ? formatWeight(goals.target_weight_g, view.weightUnit)
                : "Not set",
    });
    return rows;
}

const MACRO_GOAL_LABELS = new Set(["Calories", "Protein", "Carbs", "Fat"]);
const OTHER_GOAL_LABELS = new Set(["Target weight"]);

/** Water goals read in litres, like the Today water line (2500 → "2.5 L"). */
function formatWaterGoal(ml: number): string {
    return `${Math.round(ml / 100) / 10} L`;
}

function goalRowMarkup(row: GoalRow): string {
    const dt =
        row.dotKey != null
            ? `<dt>${String(dot(row.dotKey, { size: "sm" }))}${esc(row.label)}</dt>`
            : `<dt>${esc(row.label)}</dt>`;
    return `<div class="fd-settings-member-dl__row">${dt}<dd>${esc(row.value)}</dd></div>`;
}

/**
 * One white card of goal rows under a section label (FigCraft 23562). The
 * macros card has no visible label in the frame, so its title is screen-reader
 * only.
 */
function goalsCard(
    title: string,
    rows: GoalRow[],
    opts: { hideTitle?: boolean } = {},
): string {
    if (rows.length === 0) return "";
    const titleClass = opts.hideTitle
        ? "fd-settings-goals-card__title fd-sr"
        : "fd-settings-goals-card__title";
    return `<section class="fd-settings-goals-card" aria-label="${esc(title)}"><h2 class="${titleClass}">${esc(title)}</h2><dl class="fd-settings-member-dl fd-settings-goals-dl">${rows.map((row) => goalRowMarkup(row)).join("")}</dl></section>`;
}

type FieldSpec = {
    name: GoalsFormField;
    label: string;
    dotKey?:
        | "calories"
        | "protein"
        | "carbs"
        | "fat"
        | "fiber"
        | "sugar"
        | "caffeine";
    unit?: string;
    text?: { max: number; placeholder: string };
};

const NAME_FIELDS: FieldSpec[] = [
    {
        name: "goal_name",
        label: "Name",
        text: { max: GOAL_NAME_MAX, placeholder: "Recomp" },
    },
    {
        name: "goal_note",
        label: "Note",
        text: { max: GOAL_NOTE_MAX, placeholder: "Optional" },
    },
];

const TARGET_FIELDS: FieldSpec[] = [
    {
        name: "daily_calories",
        label: "Calories",
        dotKey: "calories",
        unit: "kcal",
    },
    { name: "daily_protein_g", label: "Protein", dotKey: "protein", unit: "g" },
    { name: "daily_carbs_g", label: "Carbs", dotKey: "carbs", unit: "g" },
    { name: "daily_fat_g", label: "Fat", dotKey: "fat", unit: "g" },
    { name: "daily_water_ml", label: "Water", unit: "ml" },
];

const DRINK_UNIT_NAME: Record<DrinkUnit, string> = {
    us: "US drinks",
    uk: "UK units",
};

function limitFields(alcohol: DrinkUnit | null): FieldSpec[] {
    const fields: FieldSpec[] = [
        {
            name: "daily_fiber_g",
            label: "Fiber, at least",
            dotKey: "fiber",
            unit: "g",
        },
        {
            name: "daily_sugar_g",
            label: "Sugar, at most",
            dotKey: "sugar",
            unit: "g",
        },
    ];
    if (alcohol) {
        // Typed in the member's drink unit; the route converts to grams.
        fields.push({
            name: "daily_alcohol_g",
            label: "Alcohol, at most",
            unit: DRINK_UNIT_NAME[alcohol],
        });
    }
    fields.push({
        name: "daily_caffeine_mg",
        label: "Caffeine, at most",
        dotKey: "caffeine",
        unit: "mg",
    });
    return fields;
}

function fieldRow(
    spec: FieldSpec,
    draft: GoalsFormDraft,
    invalid: ReadonlySet<GoalsFormField>,
): string {
    const id = `goals-${spec.name.replace(/_/g, "-")}`;
    const labelId = `${id}-label`;
    const lead =
        spec.dotKey != null ? String(dot(spec.dotKey, { size: "sm" })) : "";
    const label = `${lead}${esc(spec.label)}${spec.unit ? ` <span class="fd-settings-goals-unit">(${esc(spec.unit)})</span>` : ""}`;
    const aria = invalid.has(spec.name) ? ' aria-invalid="true"' : "";
    const control = spec.text
        ? `<input class="fd-settings-input" id="${id}" name="${spec.name}" type="text" value="${esc(draft[spec.name])}" maxlength="${spec.text.max}" placeholder="${esc(spec.text.placeholder)}" autocomplete="off" aria-labelledby="${labelId}"${aria} />`
        : `<input class="fd-settings-input" id="${id}" name="${spec.name}" type="text" inputmode="decimal" value="${esc(draft[spec.name])}" placeholder="Not set" autocomplete="off" aria-labelledby="${labelId}"${aria} />`;
    return `<div class="fd-settings-field"><span class="fd-settings-field__label" id="${labelId}">${label}</span>${control}</div>`;
}

function formSection(
    title: string,
    fields: FieldSpec[],
    draft: GoalsFormDraft,
    invalid: ReadonlySet<GoalsFormField>,
): string {
    return `<h3 class="fd-settings-goals-form__title">${esc(title)}</h3>${fields.map((f) => fieldRow(f, draft, invalid)).join("")}`;
}

/** The saved name, with when it was set and the note (FigCraft 23562). */
function goalsHeading(view: SettingsGoalsV2View): string {
    const name = view.goals?.goal_name?.trim();
    if (!name) return "";
    const since = formatGoalSince(view.goals?.goals_set_on, view.today);
    const note = view.goals?.goal_note?.trim();
    const sub = [since ? `Since ${since}` : null, note || null]
        .filter((part): part is string => part != null)
        .join(" · ");
    return `<h2 class="fd-settings-goals-name">${esc(name)}</h2>${sub ? `<p class="fd-settings-goals-since">${esc(sub)}</p>` : ""}`;
}

export const GOALS_EDIT_SHEET_ID = "fd-goals-edit";
const GOALS_FORM_ID = "fd-goals-form";

/**
 * The edit sheet (FigCraft 48374): labelled filled fields, Save at the bottom.
 * A refused save re-renders it open, with what was typed and the errors.
 */
function editSheet(view: SettingsGoalsV2View): string {
    const draft = view.draft ?? goalsDraftFrom(view.goals, view.alcohol);
    const invalid = new Set(view.invalid ?? []);
    const sections = [
        formSection("Goal", NAME_FIELDS, draft, invalid),
        formSection("Daily targets", TARGET_FIELDS, draft, invalid),
        formSection(
            "Limits and minimums",
            limitFields(view.alcohol),
            draft,
            invalid,
        ),
    ].join("");
    const error = view.draft ? String(settingsErrorBanner(view.error)) : "";
    const body = `${error}<form id="${GOALS_FORM_ID}" method="POST" action="/settings/goals" class="fd-settings-goals-form" data-turbo="false">${sections}</form>`;
    // The panel takes focus on open: a text field focused first would raise
    // the keyboard over the form on a touch screen.
    return sheet({
        id: GOALS_EDIT_SHEET_ID,
        kind: "edit",
        title: "Edit goals",
        subtitle: "Daily targets, limits and minimums",
        body,
        actions: `<button type="submit" class="fd-btn fd-btn--primary" form="${GOALS_FORM_ID}">Save</button>`,
        openOnLoad: view.draft != null,
        focus: "panel",
    });
}

/** "Sat, Nov 14" for a calendar date. */
function dayLabel(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function daySummary(day: GoalDayOverride, alcohol: DrinkUnit | null): string {
    const parts: string[] = [];
    const add = (label: string, value: number | null, unit: string) => {
        if (value != null) parts.push(`${label} ${num(value)} ${unit}`);
    };
    add("Calories", day.daily_calories, "kcal");
    add("Protein", day.daily_protein_g, "g");
    add("Carbs", day.daily_carbs_g, "g");
    add("Fat", day.daily_fat_g, "g");
    if (day.daily_water_ml != null) {
        parts.push(`Water ${formatWaterGoal(day.daily_water_ml)}`);
    }
    add("Fiber", day.daily_fiber_g, "g");
    add("Sugar", day.daily_sugar_g, "g");
    if (alcohol && day.daily_alcohol_g != null) {
        parts.push(`Alcohol ${alcoholLimitText(day.daily_alcohol_g, alcohol)}`);
    }
    add("Caffeine", day.daily_caffeine_mg, "mg");
    return parts.join(" · ");
}

function clearSheetId(date: string): string {
    return `fd-goals-clear-${date}`;
}

function dayRow(day: GoalDayOverride, alcohol: DrinkUnit | null): string {
    const label = dayLabel(day.date);
    const trigger = sheetTrigger({
        target: clearSheetId(day.date),
        label: "Clear",
        className: "fd-settings-goaldays__clear",
        data: { "goals-clear": day.date },
        ariaLabel: `Clear goals for ${label}`,
    });
    return `<li class="fd-settings-goaldays__row"><div class="fd-settings-goaldays__text"><p class="fd-settings-goaldays__date">${esc(label)}</p><p class="fd-settings-goaldays__what">${esc(daySummary(day, alcohol))}</p></div>${trigger}</li>`;
}

function clearSheet(day: GoalDayOverride): string {
    const label = dayLabel(day.date);
    return confirmSheet({
        id: clearSheetId(day.date),
        title: `Clear ${label}?`,
        message: "That day goes back to your daily goals.",
        action: "/settings/goals/days/clear",
        confirmLabel: "Clear day",
        hiddenFields: { date: day.date },
        turboFalse: true,
    });
}

function goalDaysSection(view: SettingsGoalsV2View): string {
    if (view.days.length === 0) return "";
    return `<section class="fd-settings-goaldays" aria-labelledby="goaldays-title"><h2 class="fd-settings-goals-card__title" id="goaldays-title">Days with their own goals</h2><ul class="fd-settings-goaldays__list">${view.days.map((d) => dayRow(d, view.alcohol)).join("")}</ul><p class="fd-settings-goals-note muted">Clearing a day puts it back on your daily goals.</p></section>${view.days.map((d) => clearSheet(d)).join("")}`;
}

export function renderSettingsGoalsV2Body(view: SettingsGoalsV2View): string {
    const rows = settingsGoalRows(view);
    const macroRows = rows.filter((r) => MACRO_GOAL_LABELS.has(r.label));
    const otherRows = rows.filter((r) => OTHER_GOAL_LABELS.has(r.label));
    const limitRows = rows.filter(
        (r) =>
            !MACRO_GOAL_LABELS.has(r.label) && !OTHER_GOAL_LABELS.has(r.label),
    );
    const read =
        rows.length === 0
            ? `<p class="fd-settings-goals-empty">No nutrition goals set yet.</p>`
            : `${goalsHeading(view)}${goalsCard("Macros", macroRows, { hideTitle: true })}${goalsCard("Limits and minimums", limitRows)}${view.goals?.target_weight_g != null ? goalsCard("Other targets", otherRows) : ""}`;
    const edit = sheetTrigger({
        target: GOALS_EDIT_SHEET_ID,
        label: view.goals ? "Edit goals" : "Set goals",
        className: "fd-settings-goals-edit",
    });
    // Errors from a refused save show inside the open sheet; any other sits
    // under the header.
    const pageError = view.draft ? "" : String(settingsErrorBanner(view.error));
    return `${settingsPageHeader("Goals")}${pageError}${read}${edit}${goalDaysSection(view)}${editSheet(view)}`;
}

export function renderSettingsGoalsV2Page(view: SettingsGoalsV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "goals",
        title: "Goals",
        body: renderSettingsGoalsV2Body(view),
    });
}
