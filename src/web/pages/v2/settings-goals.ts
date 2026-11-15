import type { AppChromeBase } from "../../attention.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { WeightUnit } from "../../../domain/units.js";
import type { DrinkUnit } from "../../../alcohol.js";
import { formatWeight } from "../../../domain/units.js";
import { toDrinks } from "../../../alcohol.js";
import { GOAL_NAME_MAX, GOAL_NOTE_MAX } from "../../../domain/goal-label.js";
import type { GoalDayOverride } from "../../../domain/insights.js";
import { esc } from "../../components/v2/html.js";
import { dot } from "../../components/v2/dot.js";
import { iconBolt, iconDrop, iconList } from "../../components/v2/icons.js";
import { confirmSheet, sheetTrigger } from "../../components/v2/sheet.js";
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
    /** The error to show: beside the field in `invalid`, else under the header. */
    error?: string;
    /**
     * A field save the server refused: every field as it was submitted (the
     * stored goals, with the typed text in the one that failed) and that field.
     * The stored value is unchanged; the field shows the typed text with
     * `error` beside it.
     */
    draft?: GoalsFormDraft;
    invalid?: readonly GoalsFormField[];
};

const GOAL_ICONS = { bolt: iconBolt, drop: iconDrop, list: iconList };

const DRINK_NOUN: Record<DrinkUnit, [one: string, many: string]> = {
    us: ["US drink", "US drinks"],
    uk: ["UK unit", "UK units"],
};

/**
 * The alcohol limit in the member's drink unit, the same figure the field
 * holds ("2 US drinks"); a limit of 0 is "None".
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

/** Water goals read in litres, like the Today water line (2500 → "2.5 L"). */
function formatWaterGoal(ml: number): string {
    return `${Math.round(ml / 100) / 10} L`;
}

type FieldSpec = {
    name: GoalsFormField;
    label: string;
    /** The macro dot (FigCraft 23562 protein, carbs and fat rows). */
    dot?: "protein" | "carbs" | "fat";
    /** The row icon the frame gives calories, water and the limits. */
    icon?: "bolt" | "drop" | "list";
    unit?: string;
};

const MACRO_FIELDS: FieldSpec[] = [
    { name: "daily_calories", label: "Calories", icon: "bolt", unit: "kcal" },
    { name: "daily_protein_g", label: "Protein", dot: "protein", unit: "g" },
    { name: "daily_carbs_g", label: "Carbs", dot: "carbs", unit: "g" },
    { name: "daily_fat_g", label: "Fat", dot: "fat", unit: "g" },
];

const DRINK_UNIT_NAME: Record<DrinkUnit, string> = {
    us: "US drinks",
    uk: "UK units",
};

function limitFields(alcohol: DrinkUnit | null): FieldSpec[] {
    const fields: FieldSpec[] = [
        { name: "daily_water_ml", label: "Water", icon: "drop", unit: "ml" },
        {
            name: "daily_fiber_g",
            label: "Fiber, at least",
            icon: "list",
            unit: "g",
        },
        {
            name: "daily_sugar_g",
            label: "Sugar, at most",
            icon: "list",
            unit: "g",
        },
        {
            name: "daily_caffeine_mg",
            label: "Caffeine, at most",
            icon: "bolt",
            unit: "mg",
        },
    ];
    if (alcohol) {
        // Typed in the member's drink unit; the route converts to grams.
        fields.push({
            name: "daily_alcohol_g",
            label: "Alcohol, at most",
            // No frame shows alcohol; the drink shares water's drop.
            icon: "drop",
            unit: DRINK_UNIT_NAME[alcohol],
        });
    }
    return fields;
}

const FIELD_ACTION = "/settings/goals/field";

function fieldId(name: GoalsFormField): string {
    return `goals-${name.replace(/_/g, "-")}`;
}

type FieldCtx = {
    draft: Record<GoalsFormField, string>;
    error:
        { field: GoalsFormField; value: string; message: string } | undefined;
};

/**
 * One goal as its own form: it posts `field` and `value` to the field route,
 * and the autosave module submits it when the input is left. Without script
 * Enter submits it. The form carries no Turbo opt-out: the 303 back to this
 * page is morphed in place.
 */
function fieldForm(
    name: GoalsFormField,
    control: (opts: { id: string; value: string; attrs: string }) => string,
    ctx: FieldCtx,
    cls: string,
    lead = "",
): string {
    const id = fieldId(name);
    const failed = ctx.error?.field === name;
    const value = failed ? ctx.error!.value : ctx.draft[name];
    const attrs = failed
        ? ` aria-invalid="true" aria-describedby="${id}-error"`
        : "";
    const error = failed
        ? `<p class="fd-settings-goals-field__error" id="${id}-error" role="alert">${esc(ctx.error!.message)}</p>`
        : "";
    return `<form class="${cls}" method="POST" action="${FIELD_ACTION}" data-fd-autosave><input type="hidden" name="field" value="${name}" />${lead}${control({ id, value, attrs })}${error}</form>`;
}

function numberRow(spec: FieldSpec, ctx: FieldCtx): string {
    const marker =
        spec.icon != null
            ? `<span class="fd-settings-goals-icon">${String(GOAL_ICONS[spec.icon]())}</span>`
            : spec.dot != null
              ? String(dot(spec.dot))
              : "";
    const unit = spec.unit
        ? `<span class="fd-settings-goals-unit">${esc(spec.unit)}</span>`
        : "";
    // The whole row is the label, so a tap anywhere on it edits the number.
    return fieldForm(
        spec.name,
        ({ id, value, attrs }) =>
            `<label class="fd-settings-goals-field__row"><span class="fd-settings-goals-field__label">${marker}${esc(spec.label)}</span><span class="fd-settings-goals-field__entry"><input class="fd-settings-goals-input" id="${id}" name="value" type="text" inputmode="decimal" value="${esc(value)}" placeholder="Not set" autocomplete="off" data-fd-autosave-input${attrs} />${unit}</span></label>`,
        ctx,
        "fd-settings-goals-field",
    );
}

/**
 * One card of number fields under a section label (FigCraft 23562). The
 * macros card has no visible label in the frame, so its title is screen-reader
 * only.
 */
function fieldsCard(
    title: string,
    specs: FieldSpec[],
    ctx: FieldCtx,
    opts: { hideTitle?: boolean } = {},
): string {
    const titleClass = opts.hideTitle
        ? "fd-settings-goals-card__title fd-sr"
        : "fd-settings-goals-card__title";
    return `<section class="fd-settings-goals-card" aria-label="${esc(title)}"><h2 class="${titleClass}">${esc(title)}</h2><div class="fd-settings-goals-fields">${specs.map((s) => numberRow(s, ctx)).join("")}</div></section>`;
}

/**
 * The goal's name and note as plain tap-to-edit text under the page title,
 * with the day the goals were set (FigCraft 23562).
 */
function goalsHeading(view: SettingsGoalsV2View, ctx: FieldCtx): string {
    const since = formatGoalSince(view.goals?.goals_set_on, view.today);
    const text = (
        name: "goal_name" | "goal_note",
        max: number,
        placeholder: string,
        label: string,
        cls: string,
    ) =>
        fieldForm(
            name,
            ({ id, value, attrs }) =>
                `<input class="${cls}" id="${id}" name="value" type="text" value="${esc(value)}" maxlength="${max}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" autocomplete="off" data-fd-autosave-input${attrs} />`,
            ctx,
            "fd-settings-goals-field fd-settings-goals-field--text",
        );
    return `${text("goal_name", GOAL_NAME_MAX, "Name this goal", "Goal name", "fd-settings-goals-name")}${text("goal_note", GOAL_NOTE_MAX, "Add a note", "Note", "fd-settings-goals-note-input")}${since ? `<p class="fd-settings-goals-since">Since ${esc(since)}</p>` : ""}`;
}

/** Target weight has no field here; it is set by the agent, shown when set. */
function targetWeightCard(view: SettingsGoalsV2View): string {
    const grams = view.goals?.target_weight_g;
    if (grams == null) return "";
    return `<section class="fd-settings-goals-card" aria-label="Other targets"><h2 class="fd-settings-goals-card__title">Other targets</h2><dl class="fd-settings-member-dl fd-settings-goals-dl"><div class="fd-settings-member-dl__row"><dt>Target weight</dt><dd>${esc(formatWeight(grams, view.weightUnit))}</dd></div></dl></section>`;
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
    const failed = view.invalid?.[0];
    const fieldError =
        failed && view.draft
            ? {
                  field: failed,
                  value: view.draft[failed],
                  message: view.error ?? "",
              }
            : undefined;
    const ctx: FieldCtx = {
        draft: goalsDraftFrom(view.goals, view.alcohol),
        error: fieldError,
    };
    const empty = view.goals
        ? ""
        : `<p class="fd-settings-goals-empty">No nutrition goals set yet. Fill in a daily target to start.</p>`;
    return `${settingsPageHeader("Goals")}${fieldError ? "" : String(settingsErrorBanner(view.error))}${goalsHeading(view, ctx)}${empty}${fieldsCard("Macros", MACRO_FIELDS, ctx, { hideTitle: true })}${fieldsCard("Limits and minimums", limitFields(view.alcohol), ctx)}<p class="fd-settings-goals-hint">Tap a number to change it. It saves when you leave the field.</p>${targetWeightCard(view)}${goalDaysSection(view)}`;
}

export function renderSettingsGoalsV2Page(view: SettingsGoalsV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "goals",
        title: "Goals",
        body: renderSettingsGoalsV2Body(view),
    });
}
