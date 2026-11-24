/**
 * Settings › Goals (FigCraft 414420, 419204): the standing daily targets as
 * Item rows whose number is the value, edited in place. Each number is its own
 * form that saves when it is left (`autosave.js`; the route answers 303, or a
 * 4xx with the refusal under the number). The goal's name and note sit in a
 * card at the top, or as a "Name this goal" row until there is a name. Days
 * with their own goals follow, each with a ⋯ that clears the day (confirmed in
 * place).
 */
import type { AppChromeBase } from "../../attention.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { WeightUnit } from "../../../domain/units.js";
import type { DrinkUnit } from "../../../alcohol.js";
import { formatWeight } from "../../../domain/units.js";
import { toDrinks } from "../../../alcohol.js";
import { GOAL_NAME_MAX, GOAL_NOTE_MAX } from "../../../domain/goal-label.js";
import type { GoalDayOverride } from "../../../domain/insights.js";
import { autosaveInput } from "../../components/v2/autosave-input.js";
import { card } from "../../components/v2/card.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";
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

/** A figure with the list's thousands separator ("2,421"). */
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
    unit: string;
};

const MACRO_FIELDS: FieldSpec[] = [
    { name: "daily_calories", label: "Calories", unit: "kcal" },
    { name: "daily_protein_g", label: "Protein", unit: "g" },
    { name: "daily_carbs_g", label: "Carbs", unit: "g" },
    { name: "daily_fat_g", label: "Fat", unit: "g" },
];

/** What follows the alcohol number (FigCraft 414420: "2 drinks"). */
const DRINK_UNIT_NAME: Record<DrinkUnit, string> = {
    us: "drinks",
    uk: "units",
};

function limitFields(alcohol: DrinkUnit | null): FieldSpec[] {
    const fields: FieldSpec[] = [
        { name: "daily_water_ml", label: "Water", unit: "ml" },
        { name: "daily_fiber_g", label: "Fiber, at least", unit: "g" },
        { name: "daily_sugar_g", label: "Sugar, at most", unit: "g" },
        { name: "daily_caffeine_mg", label: "Caffeine, at most", unit: "mg" },
    ];
    if (alcohol) {
        // Typed in the member's drink unit; the route converts to grams.
        fields.push({
            name: "daily_alcohol_g",
            label: "Alcohol, at most",
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

/** A saved number with its thousands separator ("2200" → "2,200"); the route reads it back. */
function shownNumber(name: GoalsFormField, text: string): string {
    if (name === "goal_name" || name === "goal_note") return text;
    return /^\d+(\.\d+)?$/.test(text) ? num(Number(text)) : text;
}

/** One goal's input options: the typed text and refusal when this is the field that failed. */
function inputOf(name: GoalsFormField, ctx: FieldCtx) {
    const failed = ctx.error?.field === name;
    return {
        id: fieldId(name),
        action: FIELD_ACTION,
        fields: { field: name },
        value: failed ? ctx.error!.value : shownNumber(name, ctx.draft[name]),
        error: failed ? ctx.error!.message : undefined,
    };
}

function numberRow(spec: FieldSpec, ctx: FieldCtx): Html {
    return itemRow({
        title: spec.label,
        input: {
            ...inputOf(spec.name, ctx),
            inputmode: "decimal",
            placeholder: "Not set",
            unit: spec.unit,
        },
    });
}

/**
 * The goal's name and note (FigCraft 414420): a card with the name as its
 * title and the note and the day the goals were set under it. With no name or
 * note yet it is the one row "Name this goal", which becomes the card once it
 * is saved.
 */
function goalHeading(view: SettingsGoalsV2View, ctx: FieldCtx): Html {
    const name = (labelHidden: boolean, cls: string) =>
        autosaveInput({
            ...inputOf("goal_name", ctx),
            label: "Goal name",
            labelHidden,
            placeholder: "Name this goal",
            maxlength: GOAL_NAME_MAX,
            className: cls,
        });
    const named = ctx.draft.goal_name !== "" || ctx.draft.goal_note !== "";
    if (!named && ctx.error?.field !== "goal_note") {
        return listGroup({
            label: "Goal name",
            rows: [
                itemRow({
                    title: "Goal name",
                    input: {
                        ...inputOf("goal_name", ctx),
                        labelHidden: true,
                        chevron: true,
                        placeholder: "Name this goal",
                        maxlength: GOAL_NAME_MAX,
                    },
                }),
            ],
        });
    }
    const since = formatGoalSince(view.goals?.goals_set_on, view.today);
    const note = autosaveInput({
        ...inputOf("goal_note", ctx),
        label: "Note",
        labelHidden: true,
        placeholder: "Add a note",
        maxlength: GOAL_NOTE_MAX,
        className: "fd-goals-note",
    });
    return card({
        label: "Goal",
        className: "fd-goals-card",
        children: raw(
            `${name(true, "fd-goals-title")}<div class="fd-goals-caption">${note}${since ? `<span class="fd-goals-since">· since ${esc(since)}</span>` : ""}</div>`,
        ),
    });
}

/** Target weight has no field here; it is set by the agent, shown when set. */
function targetWeightRow(view: SettingsGoalsV2View): Html | null {
    const grams = view.goals?.target_weight_g;
    if (grams == null) return null;
    return itemRow({
        title: "Target weight",
        value: formatWeight(grams, view.weightUnit),
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

/**
 * What a day overrides, the way the design writes it: calories first and
 * without a name ("1,800 kcal"), then each other goal named in lower case
 * ("protein 170 g"), numbers with thousands separators.
 */
function daySummary(day: GoalDayOverride, alcohol: DrinkUnit | null): string {
    const parts: string[] = [];
    if (day.daily_calories != null) {
        parts.push(`${num(day.daily_calories)} kcal`);
    }
    const add = (label: string, value: number | null, unit: string) => {
        if (value != null) parts.push(`${label} ${num(value)} ${unit}`);
    };
    add("protein", day.daily_protein_g, "g");
    add("carbs", day.daily_carbs_g, "g");
    add("fat", day.daily_fat_g, "g");
    if (day.daily_water_ml != null) {
        parts.push(`water ${formatWaterGoal(day.daily_water_ml)}`);
    }
    add("fiber", day.daily_fiber_g, "g");
    add("sugar", day.daily_sugar_g, "g");
    if (alcohol && day.daily_alcohol_g != null) {
        parts.push(`alcohol ${alcoholLimitText(day.daily_alcohol_g, alcohol)}`);
    }
    add("caffeine", day.daily_caffeine_mg, "mg");
    return parts.join(" · ");
}

/** A day with its own goals: the ⋯ clears it, confirmed in the menu. */
function dayRow(day: GoalDayOverride, alcohol: DrinkUnit | null): Html {
    const label = dayLabel(day.date);
    return itemRow({
        title: label,
        subtitle: daySummary(day, alcohol),
        trailing: {
            kind: "control",
            html: menu({
                label: `Actions for ${label}`,
                anchor: "more",
                items: [
                    {
                        kind: "destructive",
                        label: "Clear",
                        action: "/settings/goals/days/clear",
                        fields: { date: day.date },
                    },
                ],
            }),
        },
    });
}

function goalDaysSection(view: SettingsGoalsV2View): Html {
    if (view.days.length === 0) return raw("");
    return join([
        sectionHeader({ label: "Days with their own goals", rule: false }),
        listGroup({
            label: "Days with their own goals",
            rows: view.days.map((d) => dayRow(d, view.alcohol)),
        }),
    ]);
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
    const macros = MACRO_FIELDS.map((spec) => numberRow(spec, ctx));
    const target = targetWeightRow(view);
    if (target) macros.push(target);
    return String(
        join([
            fieldError ? raw("") : settingsErrorBanner(view.error),
            goalHeading(view, ctx),
            listGroup({ label: "Daily goals", rows: macros }),
            sectionHeader({ label: "Limits and minimums", rule: false }),
            listGroup({
                label: "Limits and minimums",
                rows: limitFields(view.alcohol).map((spec) =>
                    numberRow(spec, ctx),
                ),
            }),
            goalDaysSection(view),
        ]),
    );
}

/** What the header ⋯ holds: Clear all goals, confirmed in place in the menu. */
export const CLEAR_ALL_GOALS_ACTION = "/settings/goals/clear-all";

export function renderSettingsGoalsV2Page(view: SettingsGoalsV2View): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        page: "goals",
        title: "Goals",
        className: "fd-goals-page",
        actions: menu({
            label: "Goals actions",
            anchor: "more",
            items: [
                {
                    kind: "destructive",
                    label: "Clear all goals",
                    action: CLEAR_ALL_GOALS_ACTION,
                },
            ],
        }),
        body: renderSettingsGoalsV2Body(view),
    });
}
