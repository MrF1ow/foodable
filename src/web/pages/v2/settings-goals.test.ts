import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { GoalDayOverride } from "../../../domain/insights.js";
import {
    alcoholLimitText,
    renderSettingsGoalsV2Page,
    settingsGoalRows,
    type SettingsGoalsV2View,
} from "./settings-goals.js";
import { goalsDraftFrom } from "./settings-goals-form.js";

const chrome = {
    theme: "dark" as const,
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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

describe("settings goals v2 form", () => {
    test("is a form that posts every target with its saved value", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).toContain('data-fd-settings-page="goals"');
        expect(html).toMatch(
            /<form[^>]*method="POST"[^>]*action="\/settings\/goals"/,
        );
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
            expect(input(html, name)).toContain(`value="${value}"`);
        }
        expect(html).toContain("Limits and minimums");
    });

    test("the page reads as cards with an Edit goals pill; the form is in a closed sheet", () => {
        const html = renderSettingsGoalsV2Page(view());
        // The read cards.
        expect(html).toContain("2,200 kcal");
        expect(html).toContain("2 L");
        expect(html).toContain("fd-settings-goals-dl");
        // Calories, water and the limits carry the frame's row icons; the
        // macros keep their dots.
        expect(html).toMatch(
            /<dt><span class="fd-settings-goals-icon"><svg[^>]*>.*?<\/svg><\/span>Water<\/dt>/,
        );
        expect(html).toContain('<dt><span class="fd-dot fd-dot--protein"');
        // The pill opens the sheet that holds the form; Save is in the sheet.
        expect(html).toMatch(
            /<button[^>]*class="fd-settings-goals-edit"[^>]*commandfor="fd-goals-edit"[^>]*>Edit goals<\/button>/,
        );
        const dialog = html.match(
            /<dialog[^>]*id="fd-goals-edit"[^>]*>[\s\S]*?<\/dialog>/,
        )![0];
        expect(dialog).not.toContain("data-sheet-open-on-load");
        expect(dialog).toContain('name="goal_name"');
        expect(dialog).toMatch(
            /<button type="submit" class="fd-btn fd-btn--primary" form="fd-goals-form">Save<\/button>/,
        );
        // The inputs are labelled, filled fields: a label above each.
        expect(dialog).toContain('<span class="fd-settings-field__label"');
        expect(dialog).toContain(
            'aria-labelledby="goals-daily-calories-label"',
        );
        // The name is not repeated as a Name row on the read page.
        expect(html.replace(dialog, "").split(">Recomp<").length - 1).toBe(1);
    });

    test("no goals yet: the pill invites setting them", () => {
        const html = renderSettingsGoalsV2Page(view({ goals: null }));
        expect(html).toContain("No nutrition goals set yet.");
        expect(html).toContain(">Set goals</button>");
    });

    test("the sheet takes focus on its panel, so no keyboard opens over it", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).toMatch(
            /<dialog[^>]*id="fd-goals-edit" data-fd-sheet-focus="panel"/,
        );
    });

    test("the alcohol limit is typed in the member's drink unit", () => {
        const us = renderSettingsGoalsV2Page(
            view({ goals: { ...goals, daily_alcohol_g: 28 } }),
        );
        expect(input(us, "daily_alcohol_g")).toContain('value="2"');
        expect(us).toContain("(US drinks)");
        // The read card shows the figure the sheet opens with, not grams.
        expect(us).toContain("<dd>2 US drinks</dd>");
        expect(us).not.toContain("28 g");
        const uk = renderSettingsGoalsV2Page(
            view({
                alcohol: "uk",
                goals: { ...goals, daily_alcohol_g: 15.79 },
            }),
        );
        expect(input(uk, "daily_alcohol_g")).toContain('value="2"');
        expect(uk).toContain("(UK units)");
        expect(uk).toContain("<dd>2 UK units</dd>");
        expect(uk).not.toContain("15.8 g");
    });

    test("limits the name and note to what the server accepts", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(input(html, "goal_name")).toContain('maxlength="40"');
        expect(input(html, "goal_note")).toContain('maxlength="280"');
    });

    test("nothing takes focus on load (no autofocus on touch screens)", () => {
        expect(renderSettingsGoalsV2Page(view())).not.toContain("autofocus");
    });

    test("alcohol limit is only on the form when alcohol tracking is on", () => {
        const off = renderSettingsGoalsV2Page(view({ alcohol: null }));
        expect(off).not.toContain('name="daily_alcohol_g"');
        expect(off).not.toContain("Alcohol");
    });

    test("no saved goals opens a blank form", () => {
        const html = renderSettingsGoalsV2Page(view({ goals: null }));
        expect(input(html, "daily_calories")).toContain('value=""');
        expect(html).not.toContain("fd-settings-goals-name");
        expect(html).not.toContain("Target weight");
    });

    test("shows the typed values and the errors after a refused save", () => {
        const html = renderSettingsGoalsV2Page(
            view({
                draft: {
                    ...goalsDraftFrom(goals),
                    daily_calories: "99999",
                    goal_name: "<b>x</b>",
                },
                error: "Calories must be at most 20000.",
                invalid: ["daily_calories"],
            }),
        );
        // A refused save reopens the sheet, with the error inside it.
        expect(html).toMatch(
            /<dialog[^>]*id="fd-goals-edit"[^>]*data-sheet-open-on-load/,
        );
        const dialog = html.match(
            /<dialog[^>]*id="fd-goals-edit"[^>]*>[\s\S]*?<\/dialog>/,
        )![0];
        expect(dialog).toContain('role="alert"');
        expect(dialog).toContain("Calories must be at most 20000.");
        expect(html.replace(dialog, "")).not.toContain(
            "Calories must be at most",
        );
        expect(input(html, "daily_calories")).toContain('value="99999"');
        expect(input(html, "daily_calories")).toContain('aria-invalid="true"');
        expect(input(html, "daily_protein_g")).not.toContain("aria-invalid");
        expect(input(html, "goal_name")).toContain("&lt;b&gt;x&lt;/b&gt;");
        expect(html).not.toContain("<b>x</b>");
    });

    test("saved name, set day and note head the page", () => {
        const html = renderSettingsGoalsV2Page(view());
        expect(html).toContain("fd-settings-goals-name");
        expect(html).toContain(">Recomp</");
        expect(html).toContain("Since Oct 2 · maintenance minus 5%");
    });

    test("a nameless goal has no heading, and the set day alone is not shown", () => {
        const html = renderSettingsGoalsV2Page(
            view({ goals: { ...goals, goal_name: null, goal_note: null } }),
        );
        expect(html).not.toContain("fd-settings-goals-name");
        expect(html).not.toContain("Since Oct 2");
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

describe("settingsGoalRows", () => {
    test("omits alcohol row when tracking off", () => {
        const withAlcohol = settingsGoalRows(
            view({ goals: { ...goals, daily_alcohol_g: 14 } }),
        );
        expect(withAlcohol.some((r) => r.label.startsWith("Alcohol"))).toBe(
            true,
        );
        const without = settingsGoalRows(view({ alcohol: null }));
        expect(without.some((r) => r.label.startsWith("Alcohol"))).toBe(false);
    });
});

describe("alcoholLimitText", () => {
    test("reads the same figure the sheet opens with", () => {
        expect(alcoholLimitText(28, "us")).toBe("2 US drinks");
        expect(alcoholLimitText(14, "us")).toBe("1 US drink");
        expect(alcoholLimitText(10, "us")).toBe("0.71 US drinks");
        expect(alcoholLimitText(15.79, "uk")).toBe("2 UK units");
        expect(alcoholLimitText(7.893, "uk")).toBe("1 UK unit");
        expect(alcoholLimitText(10, "uk")).toBe(
            `${goalsDraftFrom({ ...goals, daily_alcohol_g: 10 }, "uk").daily_alcohol_g} UK units`,
        );
    });

    test("a limit of 0 reads None, on the card and in a day", () => {
        expect(alcoholLimitText(0, "us")).toBe("None");
        const html = renderSettingsGoalsV2Page(
            view({ goals: { ...goals, daily_alcohol_g: 0 } }),
        );
        expect(html).toContain("<dd>None</dd>");
        expect(html).not.toContain("(0.0");
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
