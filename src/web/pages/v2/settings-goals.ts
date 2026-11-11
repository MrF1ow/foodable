import type { AppChromeBase } from "../../attention.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { WeightUnit } from "../../../domain/units.js";
import type { DrinkUnit } from "../../../alcohol.js";
import { formatWeight } from "../../../domain/units.js";
import { formatAlcohol } from "../../../alcohol.js";
import { hasActiveTarget } from "../../../mcp/shared.js";
import { esc } from "../../components/v2/html.js";
import { dot } from "../../components/v2/dot.js";
import { renderSettingsV2Page, settingsPageHeader } from "./settings-shared.js";

export type SettingsGoalsV2View = {
    chrome: AppChromeBase;
    goals: NutritionGoals | null;
    goalDate: string;
    weightUnit: WeightUnit;
    alcohol: DrinkUnit | null;
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
                formatAlcohol(n, view.alcohol!),
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
const LIMIT_GOAL_LABELS = new Set([
    "Water",
    "Fiber, at least",
    "Sugar, at most",
    "Caffeine, at most",
]);

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

export function renderSettingsGoalsV2Body(view: SettingsGoalsV2View): string {
    const rows = settingsGoalRows(view);
    const macroRows = rows.filter((r) => MACRO_GOAL_LABELS.has(r.label));
    const limitRows = rows.filter((r) => LIMIT_GOAL_LABELS.has(r.label));
    const extraRows = rows.filter(
        (r) =>
            !MACRO_GOAL_LABELS.has(r.label) && !LIMIT_GOAL_LABELS.has(r.label),
    );
    const intro =
        rows.length === 0
            ? `<p class="fd-settings-goals-empty">No nutrition goals set yet.</p>`
            : `<p class="fd-settings-goals-date muted">For ${esc(view.goalDate)}</p>${goalsCard("Macros", macroRows, { hideTitle: true })}${goalsCard("Limits and minimums", limitRows)}${
                  extraRows.length > 0
                      ? goalsCard("Other targets", extraRows)
                      : ""
              }<p class="fd-settings-goals-note muted">Read-only. Goal editing is coming later.</p>`;
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
