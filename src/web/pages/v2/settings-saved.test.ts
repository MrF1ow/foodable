import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { newFood } from "../../../domain/foods.js";
import type { Recipe } from "../../../domain/recipes.js";
import {
    renderSettingsSavedV2Page,
    savedFoodDeleteSheetId,
    SETTINGS_SAVED_MERGE_SHEET_ID,
} from "./settings-saved.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

const food = (name: string, id?: string) => ({
    ...newFood({
        householdId: "hh-1",
        kind: "food",
        name,
        defaultUnit: "each",
        calories: 155,
    }),
    id: id ?? `f-${name.toLowerCase()}`,
    aliases: [] as string[],
});

const recipe = (overrides: Partial<Recipe> = {}): Recipe => ({
    id: "r-omelet",
    householdId: "hh-1",
    creatorId: "user-1",
    name: "Omelet",
    yieldPortions: 1,
    instructions: null,
    sourceUrl: null,
    tags: ["Breakfast"],
    notes: null,
    prepMinutes: 5,
    cookMinutes: 10,
    verification: "unverified",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
});

describe("settings saved v2", () => {
    test("lists foods, recipes, search, and merge", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs"), food("Milk", "f-milk")],
            recipes: [recipe()],
            searchQuery: "",
        });
        expect(html).toContain('data-fd-settings-page="saved"');
        expect(html).toContain("Eggs");
        expect(html).toContain("Omelet");
        expect(html).toContain('action="/settings/household/items/merge"');
        expect(html).toContain(`commandfor="${SETTINGS_SAVED_MERGE_SHEET_ID}"`);
        expect(html).toContain(
            `commandfor="${savedFoodDeleteSheetId("f-eggs")}"`,
        );
        expect(html).toContain('action="/recipes/r-omelet/delete"');
        expect(html).toContain('name="from" value="/settings/saved"');
        expect(html).toContain(
            `action="/settings/household/items/f-eggs/archive"`,
        );
    });

    test("lists product under parent and search finds product", () => {
        const eggs = {
            ...food("Eggs", "f-eggs"),
            gramsPerEach: 50,
        };
        const cage = {
            ...food("Cage Free Eggs", "f-cage"),
            genericFoodId: "f-eggs",
            calories: 120,
        };
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [eggs, cage],
            recipes: [],
            searchQuery: "cage",
        });
        expect(html).toContain("Eggs");
        expect(html).toContain("Cage Free Eggs");
        expect(html).toContain("fd-settings-saved-products");
    });
});
