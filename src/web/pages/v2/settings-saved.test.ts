import { describe, expect, test } from "bun:test";
import { esc } from "../../components/v2/html.js";
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
    flags: FIXTURE_APP_CHROME_FLAGS,
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

    test("select mode: foods and recipes post under their own field, archived foods are left out", () => {
        const archived = {
            ...food("Old milk", "f-old"),
            archivedAt: "2026-01-01T00:00:00.000Z",
        };
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs"), archived],
            recipes: [recipe()],
            searchQuery: "",
        });
        expect(html).toContain('data-fd-select="saved"');
        expect(html).toContain('data-fd-select-toggle="saved"');
        expect(html).toContain(
            '<input type="checkbox" class="fd-row__select-input" data-fd-select-item name="food_ids[]" value="f-eggs" aria-label="Select Eggs">',
        );
        expect(html).toContain(
            '<input type="checkbox" class="fd-row__select-input" data-fd-select-item name="recipe_ids[]" value="r-omelet" aria-label="Select Omelet">',
        );
        expect(html).not.toContain('value="f-old"');
        expect(html).toContain('action="/settings/saved/bulk/delete"');
        expect(html).toContain('data-one="Delete 1 saved item?');
        expect(html).toContain('data-many="Delete {n} saved items?');
    });

    test("select mode: nothing to select when no food or recipe matches", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [],
            recipes: [],
            searchQuery: "zzz",
        });
        expect(html).not.toContain("data-fd-select-toggle");
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

    test("a long name stays whole in the markup (title + trash label) for the one-line ellipsis row", () => {
        const long =
            "Member's Mark Colombian Single Serve Cups (100 count, Medium-Dark Roast)";
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food(long, "f-long")],
            recipes: [
                recipe({ name: "Spaghetti alla carbonara con guanciale" }),
            ],
            searchQuery: "",
        });
        expect(html).toContain("fd-row--manage");
        expect(html).toContain(esc(long));
        expect(html).toContain(`title="${esc(long)}"`);
        expect(html).toContain(`aria-label="Delete ${esc(long)}"`);
        expect(html).toContain(
            `aria-label="Delete Spaghetti alla carbonara con guanciale"`,
        );
        expect(html).toContain("fd-icon-btn--danger");
        // No text Delete button left in a row; the confirm sheet still has one.
        expect(html).not.toContain("fd-btn--sm fd-btn--danger");
        expect(html).not.toContain("fd-settings-saved-row");
        // Same confirm as before: the trash opens the item's sheet.
        expect(html).toContain(
            `commandfor="${savedFoodDeleteSheetId("f-long")}"`,
        );
        expect(html).toContain('action="/recipes/r-omelet/delete"');
    });

    test("the brand and the Archived marker ride on the meta line, and the trash label tells same-name products apart", () => {
        const plain = food("Eggs", "f-eggs");
        const kirkland = {
            ...food("Eggs", "f-eggs-k"),
            brand: "Kirkland",
            genericFoodId: "f-eggs",
        };
        const old = {
            ...food("Eggs", "f-eggs-old"),
            brand: "Old Farm",
            genericFoodId: "f-eggs",
            archivedAt: "2026-01-01T00:00:00.000Z",
        };
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [plain, kirkland, old],
            recipes: [],
            searchQuery: "",
        });
        // The title is the name alone; the cut-off part never hides the brand.
        expect(html).not.toContain(">Eggs · Kirkland<");
        expect(html).toContain('title="Eggs">Eggs</span>');
        expect(html).toContain("Kirkland · 155 kcal / 100 g");
        expect(html).toContain('aria-label="Delete Eggs (Kirkland)"');
        expect(html).toContain('aria-label="Delete Eggs"');
        // Archived leads the meta so a long brand cannot cut it off; no trash.
        expect(html).toContain("Archived · Old Farm · 155 kcal / 100 g");
        expect(html).not.toContain("Delete Eggs (Old Farm)");
    });
});
