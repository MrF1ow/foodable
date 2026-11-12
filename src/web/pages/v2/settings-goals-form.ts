import type {
    NutritionGoals,
    NutritionGoalsInput,
} from "../../../db/nutrition.js";
import { fromDrinks, toDrinks, type DrinkUnit } from "../../../alcohol.js";
import { cleanGoalLabel } from "../../../domain/goal-label.js";
import { MAX_CALORIES } from "../../../domain/import.js";
import { toStoredInteger } from "../../../domain/units.js";
import {
    hasActiveTarget,
    MAX_GOAL_G,
    MAX_GOAL_MG,
} from "../../../mcp/shared.js";

/** The two text fields, then the targets in the order the form shows them. */
export const GOALS_FORM_FIELDS = [
    "goal_name",
    "goal_note",
    "daily_calories",
    "daily_protein_g",
    "daily_carbs_g",
    "daily_fat_g",
    "daily_water_ml",
    "daily_fiber_g",
    "daily_sugar_g",
    "daily_alcohol_g",
    "daily_caffeine_mg",
] as const;
export type GoalsFormField = (typeof GOALS_FORM_FIELDS)[number];

/** What the form holds: every field exactly as typed, blank for none. */
export type GoalsFormDraft = Record<GoalsFormField, string>;

type TargetField = Exclude<GoalsFormField, "goal_name" | "goal_note">;

// Each target's label in an error message and its ceiling. The ceilings are
// the ones set_nutrition_goals enforces, imported rather than repeated. Water
// has none there, so it gets the largest value its integer column holds.
const MAX_WATER_ML = 2_147_483_647;
// `direction` is how the rest of the app reads the target: a floor of 0 is
// "unset" (hasActiveTarget), a ceiling of 0 is a real "none at all".
const TARGETS: {
    field: TargetField;
    label: string;
    max: number;
    direction: "floor" | "ceiling";
}[] = [
    {
        field: "daily_calories",
        label: "Calories",
        max: MAX_CALORIES,
        direction: "floor",
    },
    {
        field: "daily_protein_g",
        label: "Protein",
        max: MAX_GOAL_G,
        direction: "floor",
    },
    {
        field: "daily_carbs_g",
        label: "Carbs",
        max: MAX_GOAL_G,
        direction: "floor",
    },
    { field: "daily_fat_g", label: "Fat", max: MAX_GOAL_G, direction: "floor" },
    {
        field: "daily_water_ml",
        label: "Water",
        max: MAX_WATER_ML,
        direction: "floor",
    },
    {
        field: "daily_fiber_g",
        label: "Fiber",
        max: MAX_GOAL_G,
        direction: "floor",
    },
    {
        field: "daily_sugar_g",
        label: "Sugar",
        max: MAX_GOAL_G,
        direction: "ceiling",
    },
    {
        field: "daily_alcohol_g",
        label: "Alcohol",
        max: MAX_GOAL_G,
        direction: "ceiling",
    },
    {
        field: "daily_caffeine_mg",
        label: "Caffeine",
        max: MAX_GOAL_MG,
        direction: "ceiling",
    },
];

// The store rounds these two to whole numbers (upsertNutritionGoals).
const STORED_AS_INTEGER: ReadonlySet<TargetField> = new Set([
    "daily_calories",
    "daily_water_ml",
]);

/**
 * The largest drink count, at the 2 decimals the field takes, that still
 * converts to at most `maxGrams`. Rounding the ratio to nearest instead can
 * land a hair over the column's ceiling (714.29 US drinks is 10000.06 g).
 */
function maxDrinks(maxGrams: number, unit: DrinkUnit): number {
    let drinks = toDrinks(maxGrams, unit);
    while (drinks > 0 && fromDrinks(drinks, unit) > maxGrams) {
        drinks = Math.round((drinks - 0.01) * 100) / 100;
    }
    return drinks;
}

// A plain number, or one with comma thousands separators ("2,000").
const NUMBER_TEXT = /^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/;

function shown(value: number | string | null | undefined): string {
    if (value == null || value === "") return "";
    const n = Number(value);
    return Number.isFinite(n) ? String(n) : "";
}

/**
 * The form as it opens: the saved goals, blank where none is set. The alcohol
 * limit is stored in grams and typed in the member's drink unit, so it opens
 * converted; with tracking off (`null`) the field is not on the form.
 */
export function goalsDraftFrom(
    goals: NutritionGoals | null,
    alcohol: DrinkUnit | null = null,
): GoalsFormDraft {
    const grams = goals?.daily_alcohol_g;
    return {
        goal_name: goals?.goal_name ?? "",
        goal_note: goals?.goal_note ?? "",
        daily_calories: shown(goals?.daily_calories),
        daily_protein_g: shown(goals?.daily_protein_g),
        daily_carbs_g: shown(goals?.daily_carbs_g),
        daily_fat_g: shown(goals?.daily_fat_g),
        daily_water_ml: shown(goals?.daily_water_ml),
        daily_fiber_g: shown(goals?.daily_fiber_g),
        daily_sugar_g: shown(goals?.daily_sugar_g),
        daily_alcohol_g:
            alcohol != null && grams != null
                ? shown(toDrinks(Number(grams), alcohol))
                : "",
        daily_caffeine_mg: shown(goals?.daily_caffeine_mg),
    };
}

export type GoalsFormResult =
    | {
          ok: true;
          input: NutritionGoalsInput;
          /** True when a target differs from the stored one (or none was stored), after the store's own rounding. */
          changesTargets: boolean;
      }
    | { ok: false; errors: string[]; invalid: GoalsFormField[] };

/**
 * Validate a submitted goals form. A blank target clears it, a blank name or
 * note clears it. The alcohol limit is typed in `opts.alcohol` drinks and
 * stored in grams; with tracking off (`null`) the field is not on the form, so
 * it is left out of the input and keeps its stored value. A form with no
 * active target left at all (by `hasActiveTarget`, so a floor of 0 is not one)
 * is refused: a goals row with nothing set makes the chat widgets render
 * blank.
 */
export function parseGoalsForm(
    values: Readonly<Record<GoalsFormField, string>>,
    opts: { alcohol: DrinkUnit | null; stored: NutritionGoals | null },
): GoalsFormResult {
    const errors: string[] = [];
    const invalid: GoalsFormField[] = [];
    const input: NutritionGoalsInput = {};
    let changesTargets = false;
    let anyTarget = false;

    for (const field of ["goal_name", "goal_note"] as const) {
        try {
            input[field] = cleanGoalLabel(field, values[field]);
        } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
            invalid.push(field);
        }
    }

    for (const { field, label, max, direction } of TARGETS) {
        const stored = opts.stored?.[field];
        const before = stored == null ? null : Number(stored);
        if (field === "daily_alcohol_g" && opts.alcohol == null) {
            // Not on the form: keep what is stored, and count it as a target.
            if (hasActiveTarget(before, direction)) anyTarget = true;
            continue;
        }
        const unit = field === "daily_alcohol_g" ? opts.alcohol : null;
        // Alcohol is typed in drinks, so its bound and message are too.
        const limit = unit ? maxDrinks(max, unit) : max;
        const text = values[field].trim();
        let value: number | null = null;
        if (text !== "") {
            value = NUMBER_TEXT.test(text)
                ? Number(text.replace(/,/g, ""))
                : Number.NaN;
            if (!Number.isFinite(value)) {
                errors.push(`${label} must be a number, 0 or more.`);
                invalid.push(field);
                continue;
            }
            if (value > limit) {
                errors.push(`${label} must be at most ${limit}.`);
                invalid.push(field);
                continue;
            }
        }
        if (unit && value != null && before != null) {
            // The form shows grams as rounded drinks; an untouched field is
            // the stored grams, not the grams of the rounded figure.
            value =
                toDrinks(before, unit) === value
                    ? before
                    : fromDrinks(value, unit);
        } else if (unit && value != null) {
            value = fromDrinks(value, unit);
        }
        input[field] = value;
        if (hasActiveTarget(value, direction)) anyTarget = true;
        // Compare what the store would keep: it rounds calories and water.
        const kept =
            value != null && STORED_AS_INTEGER.has(field)
                ? toStoredInteger(value)
                : value;
        if (before !== kept) changesTargets = true;
    }

    if (errors.length === 0 && !anyTarget) {
        return {
            ok: false,
            errors: ["Set at least one daily target."],
            invalid: [],
        };
    }
    if (errors.length > 0) return { ok: false, errors, invalid };
    return { ok: true, input, changesTargets };
}
