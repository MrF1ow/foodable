import type { AppChromeBase } from "../../attention.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { WeightUnit } from "../../../domain/units.js";
import type { DrinkUnit } from "../../../alcohol.js";
import { formatWeight } from "../../../domain/units.js";
import { formatAlcohol } from "../../../alcohol.js";
import { hasActiveTarget } from "../../../mcp/shared.js";
import { esc } from "../../components/v2/html.js";
import { renderSettingsV2Page, settingsPageHeader } from "./settings-shared.js";

export type SettingsGoalsV2View = {
    chrome: AppChromeBase;
    goals: NutritionGoals | null;
    goalDate: string;
    weightUnit: WeightUnit;
    alcohol: DrinkUnit | null;
};

type GoalRow = { label: string; value: string };

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
            value: floorGoal(goals.daily_calories, (n) => `${n} kcal`),
        },
        {
            label: "Protein",
            value: floorGoal(goals.daily_protein_g, (n) => `${n} g`),
        },
        {
            label: "Carbs",
            value: floorGoal(goals.daily_carbs_g, (n) => `${n} g`),
        },
        { label: "Fat", value: floorGoal(goals.daily_fat_g, (n) => `${n} g`) },
        {
            label: "Fiber",
            value: floorGoal(goals.daily_fiber_g, (n) => `${n} g`),
        },
        {
            label: "Sugar (max)",
            value: ceilingGoal(goals.daily_sugar_g, (n) => `${n} g`),
        },
    ];
    if (view.alcohol) {
        rows.push({
            label: "Alcohol (max)",
            value: ceilingGoal(goals.daily_alcohol_g, (n) =>
                formatAlcohol(n, view.alcohol!),
            ),
        });
    }
    rows.push({
        label: "Caffeine (max)",
        value: ceilingGoal(goals.daily_caffeine_mg, (n) => `${n} mg`),
    });
    rows.push({
        label: "Water",
        value: floorGoal(goals.daily_water_ml, (n) => `${n} ml`),
    });
    rows.push({
        label: "Target weight",
        value:
            goals.target_weight_g != null
                ? formatWeight(goals.target_weight_g, view.weightUnit)
                : "Not set",
    });
    return rows;
}

export function renderSettingsGoalsV2Body(view: SettingsGoalsV2View): string {
    const rows = settingsGoalRows(view);
    const intro =
        rows.length === 0
            ? `<p class="fd-settings-goals-empty">No nutrition goals set yet.</p>`
            : `<p class="fd-settings-goals-date muted">For ${esc(view.goalDate)}</p><dl class="fd-settings-member-dl fd-settings-goals-dl">${rows
                  .map(
                      (row) =>
                          `<div class="fd-settings-member-dl__row"><dt>${esc(row.label)}</dt><dd>${esc(row.value)}</dd></div>`,
                  )
                  .join(
                      "",
                  )}</dl><p class="fd-settings-goals-note muted">Read-only. Goal editing is coming later.</p>`;
    return `${settingsPageHeader("Goals")}${intro}`;
}

export function renderSettingsGoalsV2Page(view: SettingsGoalsV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "goals",
        title: "Goals",
        body: renderSettingsGoalsV2Body(view),
    });
}
