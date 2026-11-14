import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { GoalDayOverride } from "../../../domain/insights.js";
import {
    alcoholLimitText,
    renderSettingsGoalsV2Page,
    type SettingsGoalsV2View,
} from "./settings-goals.js";
import { GOALS_FORM_FIELDS, goalsDraftFrom } from "./settings-goals-form.js";

const chrome = {
    theme: "dark" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

const goals: NutritionGoals = {
    user_id: "11111111-1111-4111-8111-111111111111",
    daily_calories: 2200,
    daily_protein_g: 140,
    daily_carbs_g: 200,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 50,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 200,
    daily_water_ml: 2000,
    target_weight_g: 75000,
    goal_name: "Recomp",
    goal_note: "maintenance minus 5%",
    goals_set_on: "2026-10-02",
    updated_at: "2026-01-01T00:00:00.000Z",
};

function view(over: Partial<SettingsGoalsV2View> = {}): SettingsGoalsV2View {
    return {
        chrome,
        goals,
        today: "2026-11-12",
        weightUnit: "kg",
        alcohol: "us",
        days: [],
        ...over,
    };
}

function day(date: string, over: Partial<GoalDayOverride> = {}) {
    return {
        user_id: goals.user_id,
        date,
        daily_calories: null,
        daily_protein_g: null,
        daily_carbs_g: null,
        daily_fat_g: null,
        daily_fiber_g: null,
        daily_sugar_g: null,
        daily_alcohol_g: null,
        daily_caffeine_mg: null,
        daily_water_ml: null,
        updated_at: "2026-11-01T00:00:00.000Z",
        ...over,
    } satisfies GoalDayOverride;
}

function input(html: string, name: string): string {
    const m = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`));
    expect(m).not.toBeNull();
    return m![0];
}

/** The form that posts one field, and what is in it. */
function fieldForm(html: string, name: string): string {
    const m = html.match(
        new RegExp(
            `<form[^>]*data-fd-autosave[^>]*><input type="hidden" name="field" value="${name}" />[\\s\\S]*?</form>`,
        ),
    );
    expect(m).not.toBeNull();
    return m![0];
}

describe("settings goals v2 in-place fields", () => {
    test("every goal is its own autosave form that posts one field", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).toContain('data-fd-settings-page="goals"');
        // No whole-page form and no goals Save button.
        expect(html).not.toContain('action="/settings/goals"');
        expect(html).not.toContain('form="fd-goals-form"');
        for (const [name, value] of [
            ["goal_name", "Recomp"],
            ["goal_note", "maintenance minus 5%"],
            ["daily_calories", "2200"],
            ["daily_protein_g", "140"],
            ["daily_carbs_g", "200"],
            ["daily_fat_g", "70"],
            ["daily_water_ml", "2000"],
            ["daily_fiber_g", "30"],
            ["daily_sugar_g", "50"],
            ["daily_alcohol_g", "0"],
            ["daily_caffeine_mg", "200"],
        ] as const) {
            const form = fieldForm(html, name);
            expect(form).toContain('method="POST"');
            expect(form).toContain('action="/settings/goals/field"');
            expect(input(form, "value")).toContain(`value="${value}"`);
        }
        expect(html).toContain("Limits and minimums");
    });

    test("the field forms keep Turbo on, so the 303 back is morphed", () => {
        const html = renderSettingsGoalsV2Page(
            view({ days: [day("2026-11-14", { daily_calories: 1800 })] }),
        );
        for (const name of GOALS_FORM_FIELDS) {
            expect(fieldForm(html, name)).not.toContain("data-turbo");
        }
        // Only the Clear confirmation, a destructive one-off, opts out.
        const optedOut = html.match(/<form[^>]*data-turbo="false"[^>]*>/g);
        expect(optedOut).toHaveLength(1);
        expect(optedOut![0]).toContain("/settings/goals/days/clear");
    });

    test("there is no Edit sheet; the rows are labelled, tap-to-edit inputs", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).not.toContain("Edit goals");
        expect(html).not.toContain("fd-goals-edit");
        expect(html).not.toContain("fd-settings-goals-edit");
        const calories = fieldForm(html, "daily_calories");
        // The row is the label, so a tap anywhere on it focuses the input.
        expect(calories).toMatch(
            /<label class="fd-settings-goals-field__row"><span/,
        );
        expect(calories).toContain("Calories");
        expect(calories).toContain("kcal");
        expect(calories).toContain("data-fd-autosave-input");
        expect(calories).toMatch(/<svg/);
        expect(fieldForm(html, "daily_protein_g")).toContain(
            '<span class="fd-dot fd-dot--protein"',
        );
        expect(fieldForm(html, "goal_name")).toContain(
            'aria-label="Goal name"',
        );
        expect(fieldForm(html, "goal_note")).toContain('aria-label="Note"');
    });

    test("the value is a chip with its unit inside, and the hint sits under the limits card (F26)", () => {
        const html = renderSettingsGoalsV2Page(view());
        const calories = fieldForm(html, "daily_calories");
        const entry = calories.match(
            /<span class="fd-settings-goals-field__entry">(.*?)<\/span><\/label>/s,
        );
        expect(entry).not.toBeNull();
        // Input and unit share the one chip; the input holds a plain number.
        expect(entry![1]).toContain("data-fd-autosave-input");
        expect(entry![1]).toContain(
            '<span class="fd-settings-goals-unit">kcal',
        );
        expect(calories).toContain('value="2200"');
        const hint = html.indexOf("fd-settings-goals-hint");
        expect(hint).toBeGreaterThan(html.indexOf("goals-daily-caffeine-mg"));
        expect(html).toContain(
            "Tap a number to change it. It saves when you leave the field.",
        );
    });

    test("no saved goals: blank fields and a hint, no heading line", () => {
        const html = renderSettingsGoalsV2Page(view({ goals: null }));
        expect(html).toContain("No nutrition goals set yet.");
        const calories = input(fieldForm(html, "daily_calories"), "value");
        expect(calories).toContain('value=""');
        expect(calories).toContain('placeholder="Not set"');
        expect(html).not.toContain("Since ");
        expect(html).not.toContain("Target weight");
    });

    test("the alcohol limit is typed in the member's drink unit", () => {
        const us = renderSettingsGoalsV2Page(
            view({ goals: { ...goals, daily_alcohol_g: 28 } }),
        );
        expect(input(fieldForm(us, "daily_alcohol_g"), "value")).toContain(
            'value="2"',
        );
        expect(us).toContain("US drinks");
        expect(us).not.toContain("28 g");
        const uk = renderSettingsGoalsV2Page(
            view({
                alcohol: "uk",
                goals: { ...goals, daily_alcohol_g: 15.79 },
            }),
        );
        expect(input(fieldForm(uk, "daily_alcohol_g"), "value")).toContain(
            'value="2"',
        );
        expect(uk).toContain("UK units");
        expect(uk).not.toContain("15.8 g");
    });

    test("limits the name and note to what the server accepts", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(input(html, "value")).toBeTruthy();
        expect(fieldForm(html, "goal_name")).toContain('maxlength="40"');
        expect(fieldForm(html, "goal_note")).toContain('maxlength="280"');
    });

    test("nothing takes focus on load (no autofocus on touch screens)", () => {
        expect(renderSettingsGoalsV2Page(view())).not.toContain("autofocus");
    });

    test("alcohol limit is only a field when alcohol tracking is on", () => {
        const off = renderSettingsGoalsV2Page(view({ alcohol: null }));
        expect(off).not.toContain('value="daily_alcohol_g"');
        expect(off).not.toContain("Alcohol");
    });

    test("a refused field shows the typed text and the error beside that field only", () => {
        const html = renderSettingsGoalsV2Page(
            view({
                draft: {
                    ...goalsDraftFrom(goals, "us"),
                    daily_calories: "99999",
                },
                error: "Calories must be at most 20000.",
                invalid: ["daily_calories"],
            }),
        );
        const calories = fieldForm(html, "daily_calories");
        expect(input(calories, "value")).toContain('value="99999"');
        expect(input(calories, "value")).toContain('aria-invalid="true"');
        expect(input(calories, "value")).toContain(
            'aria-describedby="goals-daily-calories-error"',
        );
        expect(calories).toContain('role="alert"');
        expect(calories).toContain("Calories must be at most 20000.");
        // The other fields keep their stored values and show no error.
        const protein = fieldForm(html, "daily_protein_g");
        expect(input(protein, "value")).toContain('value="140"');
        expect(protein).not.toContain("aria-invalid");
        expect(html.split("fd-settings-goals-field__error")).toHaveLength(2);
    });

    test("typed text is escaped", () => {
        const html = renderSettingsGoalsV2Page(
            view({
                draft: {
                    ...goalsDraftFrom(goals, "us"),
                    goal_name: "<b>x</b>",
                },
                error: "Goal name must be at most 40 characters.",
                invalid: ["goal_name"],
            }),
        );
        expect(fieldForm(html, "goal_name")).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).not.toContain("<b>x</b>");
    });

    test("a page-level error sits under the header", () => {
        const html = renderSettingsGoalsV2Page(
            view({ error: "Choose a valid day." }),
        );
        expect(html).toContain("Choose a valid day.");
    });

    test("the set day heads the page", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).toContain("Since Oct 2");
        expect(
            renderSettingsGoalsV2Page(
                view({ goals: { ...goals, goals_set_on: null } }),
            ),
        ).not.toContain("Since ");
    });

    test("target weight stays visible, read-only", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).toContain("Target weight");
        expect(html).toContain("75");
        expect(html).not.toContain('name="target_weight');
    });
});

describe("settings goals v2 per-day list", () => {
    test("lists each day with what it overrides and a clear action", () => {
        const html = renderSettingsGoalsV2Page(
            view({
                days: [
                    day("2026-11-14", {
                        daily_calories: 1800,
                        daily_protein_g: 150,
                    }),
                    day("2026-11-20", { daily_water_ml: 3000 }),
                ],
            }),
        );
        expect(html).toContain("Days with their own goals");
        expect(html).toContain("Sat, Nov 14");
        expect(html).toContain("Calories 1,800 kcal");
        expect(html).toContain("Protein 150 g");
        expect(html).toContain("Fri, Nov 20");
        expect(html).toContain("Water 3 L");
        // One tap on Clear only opens a confirmation; nothing posts from the row.
        const rows = [
            ...html.matchAll(
                /<li class="fd-settings-goaldays__row">[\s\S]*?<\/li>/g,
            ),
        ].map((m) => m[0]);
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row).not.toContain("<form");
            expect(row).toMatch(
                /<button type="button"[^>]*command="show-modal"/,
            );
        }
        expect(rows[0]).toContain('commandfor="fd-goals-clear-2026-11-14"');
        expect(rows[0]).toContain('aria-label="Clear goals for Sat, Nov 14"');
        // The confirm sheet holds the form that does.
        const confirm = html.match(
            /<dialog[^>]*id="fd-goals-clear-2026-11-14"[^>]*>[\s\S]*?<\/dialog>/,
        )![0];
        expect(confirm).toContain("Clear Sat, Nov 14?");
        expect(confirm).toContain('action="/settings/goals/days/clear"');
        expect(confirm).toContain('name="date" value="2026-11-14"');
        expect(confirm).toContain("Clear day");
        expect(html).toContain('id="fd-goals-clear-2026-11-20"');
    });

    test("no overrides, no section", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).not.toContain("Days with their own goals");
        expect(html).not.toContain("/settings/goals/days/clear");
    });
});

describe("alcoholLimitText", () => {
    test("reads the same figure the field holds", () => {
        expect(alcoholLimitText(28, "us")).toBe("2 US drinks");
        expect(alcoholLimitText(14, "us")).toBe("1 US drink");
        expect(alcoholLimitText(10, "us")).toBe("0.71 US drinks");
        expect(alcoholLimitText(15.79, "uk")).toBe("2 UK units");
        expect(alcoholLimitText(7.893, "uk")).toBe("1 UK unit");
        expect(alcoholLimitText(10, "uk")).toBe(
            `${goalsDraftFrom({ ...goals, daily_alcohol_g: 10 }, "uk").daily_alcohol_g} UK units`,
        );
    });

    test("a limit of 0 reads None in a day, and is 0 in the field", () => {
        expect(alcoholLimitText(0, "us")).toBe("None");
        const html = renderSettingsGoalsV2Page(
            view({ goals: { ...goals, daily_alcohol_g: 0 } }),
        );
        expect(input(fieldForm(html, "daily_alcohol_g"), "value")).toContain(
            'value="0"',
        );
    });
});

describe("per-day summaries share the card's thousands separator", () => {
    test("2,100 kcal in the day, like 2,421 on the card", () => {
        const html = renderSettingsGoalsV2Page(
            view({
                days: [
                    day("2026-11-14", {
                        daily_calories: 2100,
                        daily_alcohol_g: 28,
                    }),
                ],
            }),
        );
        expect(html).toContain("Calories 2,100 kcal");
        expect(html).toContain("Alcohol 2 US drinks");
    });
});
