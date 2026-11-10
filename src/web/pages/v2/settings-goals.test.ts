import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import {
    renderSettingsGoalsV2Page,
    settingsGoalRows,
} from "./settings-goals.js";

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
    updated_at: "2026-01-01T00:00:00.000Z",
};

describe("settings goals v2", () => {
    test("shows today's goals read-only", () => {
        const html = renderSettingsGoalsV2Page({
            chrome,
            goals,
            goalDate: "2026-11-10",
            weightUnit: "kg",
            alcohol: "us",
        });
        expect(html).toContain('data-fd-settings-page="goals"');
        expect(html).toContain("2200 kcal");
        expect(html).toContain("Read-only");
    });

    test("empty goals message", () => {
        const html = renderSettingsGoalsV2Page({
            chrome,
            goals: null,
            goalDate: "2026-11-10",
            weightUnit: "kg",
            alcohol: null,
        });
        expect(html).toContain("No nutrition goals set yet");
    });

    test("settingsGoalRows omits alcohol row when tracking off", () => {
        const withAlcohol = settingsGoalRows({
            chrome,
            goals: { ...goals, daily_alcohol_g: 14 },
            goalDate: "2026-11-10",
            weightUnit: "kg",
            alcohol: "us",
        });
        expect(withAlcohol.some((r) => r.label.startsWith("Alcohol"))).toBe(
            true,
        );
        const without = settingsGoalRows({
            chrome,
            goals,
            goalDate: "2026-11-10",
            weightUnit: "kg",
            alcohol: null,
        });
        expect(without.some((r) => r.label.startsWith("Alcohol"))).toBe(false);
    });
});
