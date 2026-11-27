import { describe, expect, test } from "bun:test";
import { esc } from "../../components/v2/html.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { newFood } from "../../../domain/foods.js";
import type { Recipe } from "../../../domain/recipes.js";
import {
    renderSettingsSavedV2Body,
    renderSettingsSavedV2Page,
    SAVED_EDIT_SHEET_ID,
    SETTINGS_SAVED_MERGE_SHEET_ID,
} from "./settings-saved.js";

const chrome = {
    theme: "light" as const,
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

/** The ⋯ of the row that names a food or recipe. */
function rowOf(html: string, title: string): string {
    const m = html.match(
        new RegExp(
            `<li class="fd-item-row[^"]*"[^>]*>(?:(?!</li>)[\\s\\S])*?title="${esc(title)}"[\\s\\S]*?</li>`,
        ),
    );
    expect(m, title).not.toBeNull();
    return m![0];
}

describe("settings saved v2", () => {
    test("links to Possible duplicates, with the count when there are pairs", () => {
        const base = { chrome, foods: [], recipes: [], searchQuery: "" };
        const none = renderSettingsSavedV2Page(base);
        expect(none).toContain('href="/settings/saved/duplicates"');
        expect(none).not.toContain("fd-item-row__value");
        const some = renderSettingsSavedV2Page({ ...base, duplicateCount: 2 });
        expect(some).toMatch(
            /Possible duplicates<\/span><\/span><\/span><span class="fd-item-row__value">2<\/span>/,
        );
    });

    test("a divider sits between Possible duplicates and the search", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [],
            recipes: [],
            searchQuery: "",
        });
        const duplicates = html.indexOf('href="/settings/saved/duplicates"');
        const divider = html.indexOf('<hr class="fd-settings-divider">');
        const search = html.indexOf(
            '<form method="get" action="/settings/saved" role="search">',
        );
        expect(duplicates).toBeGreaterThan(-1);
        expect(divider).toBeGreaterThan(duplicates);
        expect(search).toBeGreaterThan(divider);
    });

    test("the page is the Settings layout with a ⋯ in the Detail bar that has Select", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs")],
            recipes: [recipe()],
            searchQuery: "",
        });
        expect(html).toContain('data-fd-settings-page="saved"');
        expect(html).toContain("fd-page-layout--settings");
        expect(html).toContain('aria-label="Saved foods actions"');
        expect(html).toContain(
            'data-fd-menu-close data-fd-select-toggle="saved"',
        );
        // The old Select button row is gone.
        expect(html).not.toContain("fd-select-tools");
    });

    test("a food's ⋯ has Edit, Merge and Delete; Delete confirms in the menu", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs"), food("Milk", "f-milk")],
            recipes: [recipe()],
            searchQuery: "",
        });
        const eggs = rowOf(html, "Eggs");
        expect(eggs).toContain('aria-label="Actions for Eggs"');
        expect(eggs).toContain(`commandfor="${SAVED_EDIT_SHEET_ID}"`);
        expect(eggs).toContain(`commandfor="${SETTINGS_SAVED_MERGE_SHEET_ID}"`);
        expect(eggs).toContain("data-fd-menu-confirm");
        expect(eggs).toContain(
            'action="/settings/household/items/f-eggs/archive"',
        );
        // The shared sheets are filled from the item that opens them.
        expect(eggs).toContain("data-fd-menu-set=");
        expect(eggs).toContain("&quot;drop_id&quot;:&quot;f-eggs&quot;");
        expect(eggs).toContain(
            "&quot;@action&quot;:&quot;/settings/household/items/f-eggs&quot;",
        );
        // No sheet per food: one edit and one merge sheet in all.
        expect(html.match(/<dialog[^>]*id="fd-saved-edit"/g)).toHaveLength(1);
        expect(html.match(/<dialog[^>]*id="foods-merge"/g)).toHaveLength(1);
        expect(html).not.toContain("fd-settings-saved-delete-food");
    });

    test("the merge sheet keeps the household's merge route and holds Keep and Merge in", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs"), food("Milk", "f-milk")],
            recipes: [],
            searchQuery: "",
        });
        expect(html).toContain('action="/settings/household/items/merge"');
        expect(html).toContain('name="keep_id"');
        expect(html).toContain('name="drop_id"');
        // One food alone has nothing to merge into: no Merge item, no sheet.
        const alone = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs")],
            recipes: [],
            searchQuery: "",
        });
        expect(alone).not.toContain('id="foods-merge"');
        expect(rowOf(alone, "Eggs")).not.toContain("Merge");
    });

    test("a product has no Merge; an archived food has no ⋯ at all", () => {
        const eggs = food("Eggs", "f-eggs");
        const kirkland = {
            ...food("Large eggs", "f-k"),
            brand: "Kirkland",
            genericFoodId: "f-eggs",
        };
        const old = {
            ...food("Old milk", "f-old"),
            archivedAt: "2026-01-01T00:00:00.000Z",
        };
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [eggs, food("Milk", "f-milk"), kirkland, old],
            recipes: [],
            searchQuery: "",
        });
        expect(rowOf(html, "Large eggs")).toContain("Edit");
        expect(rowOf(html, "Large eggs")).not.toContain("Merge");
        expect(rowOf(html, "Old milk")).not.toContain("data-fd-menu");
        expect(rowOf(html, "Old milk")).not.toContain("f-old");
    });

    test("a recipe's ⋯ has Delete only, confirmed in the menu, back to Saved", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [],
            recipes: [recipe({ yieldPortions: 2 })],
            searchQuery: "",
        });
        const row = rowOf(html, "Omelet");
        expect(row).toContain("2 servings");
        expect(row).toContain('action="/recipes/r-omelet/delete"');
        expect(row).toContain('name="from" value="/settings/saved"');
        expect(row).toContain("data-fd-menu-confirm");
        expect(row).not.toContain("Edit");
        expect(
            rowOf(
                renderSettingsSavedV2Page({
                    chrome,
                    foods: [],
                    recipes: [recipe({ yieldPortions: 1 })],
                    searchQuery: "",
                }),
                "Omelet",
            ),
        ).toContain("1 serving<");
    });

    test("the edit sheet posts every field the household route reads, so nothing is cleared", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs")],
            recipes: [],
            searchQuery: "",
        });
        const sheet = html.match(
            /<dialog[^>]*id="fd-saved-edit"[\s\S]*?<\/dialog>/,
        )![0];
        for (const name of [
            "name",
            "brand",
            "alias_lines",
            "default_unit",
            "grams_per_each",
            "grams_per_ml",
            "calories",
            "protein_g",
            "carbs_g",
            "fat_g",
            "fiber_g",
            "sugar_g",
            "alcohol_g",
            "caffeine_mg",
        ]) {
            expect(sheet, name).toContain(`name="${name}"`);
        }
        expect(sheet).toContain('name="archived" value="0"');
        expect(sheet).toContain('name="allergens" value="milk"');
        expect(sheet).toContain('name="allergens" value="other"');
        expect(sheet).toMatch(/<input[^>]*name="name"[^>]*required/);
    });

    test("a refused edit reopens the sheet with that food and the refusal in it", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [
                { ...food("Eggs", "f-eggs"), allergens: ["egg"], brand: "B" },
            ],
            recipes: [],
            searchQuery: "",
            error: "Name is required.",
            openModalId: "food-edit-f-eggs",
        });
        const sheet = html.match(
            /<dialog[^>]*id="fd-saved-edit"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain("Name is required.");
        expect(sheet).toContain('action="/settings/household/items/f-eggs"');
        expect(sheet).toContain('value="Eggs"');
        expect(sheet).toMatch(/name="allergens" value="egg" checked/);
        // The refusal is in the sheet, not also at the top of the page.
        expect(html.split("Name is required.")).toHaveLength(2);
    });

    test("a refused merge reopens the merge sheet with the refusal in it", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs"), food("Milk", "f-milk")],
            recipes: [],
            searchQuery: "",
            error: "Choose two different foods.",
            openModalId: "foods-merge",
        });
        const sheet = html.match(
            /<dialog[^>]*id="foods-merge"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain("Choose two different foods.");
        expect(html.split("Choose two different foods.")).toHaveLength(2);
    });

    test("another refusal is a banner on the page", () => {
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food("Eggs", "f-eggs")],
            recipes: [],
            searchQuery: "",
            error: "Could not update foods.",
        });
        expect(html).toContain("Could not update foods.");
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
        expect(html).toContain(
            'class="fd-item-row__select-input" data-fd-select-item name="food_ids[]" value="f-eggs" aria-label="Select Eggs"',
        );
        expect(html).toContain(
            'class="fd-item-row__select-input" data-fd-select-item name="recipe_ids[]" value="r-omelet" aria-label="Select Omelet"',
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
        expect(html).not.toContain('aria-label="Saved foods actions"');
        expect(html).toContain("No foods match");
        expect(html).toContain("No recipes match");
    });

    test("products are rows of their own with their brand, counted with the foods", () => {
        const eggs = { ...food("Eggs", "f-eggs"), gramsPerEach: 50 };
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
        expect(html).toContain("Cage Free Eggs");
        expect(html).not.toContain("fd-settings-saved-products");
        expect(html).toMatch(
            /Foods<\/h2><span class="fd-section-header__count">2</,
        );
        expect(html).toContain('value="cage"');
    });

    test("a long name stays whole in the markup for the one-line ellipsis row", () => {
        const long =
            "Member's Mark Colombian Single Serve Cups (100 count, Medium-Dark Roast)";
        const html = renderSettingsSavedV2Page({
            chrome,
            foods: [food(long, "f-long")],
            recipes: [],
            searchQuery: "",
        });
        expect(html).toContain(esc(long));
        expect(html).toContain(`title="${esc(long)}"`);
        expect(html).toContain(`aria-label="Actions for ${esc(long)}"`);
    });

    test("the brand and the Archived marker ride on the subtitle, and the ⋯ label tells same-name products apart", () => {
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
        expect(html).toContain('aria-label="Actions for Eggs (Kirkland)"');
        expect(html).toContain('aria-label="Actions for Eggs"');
        // Archived leads the subtitle so a long brand cannot cut it off; no ⋯.
        expect(html).toContain("Archived · Old Farm · 155 kcal / 100 g");
        expect(html).not.toContain("Actions for Eggs (Old Farm)");
    });

    test("no `kcal unknown` guesses and no lead-in text", () => {
        const html = renderSettingsSavedV2Body({
            chrome,
            foods: [{ ...food("Buttermilk", "f-b"), calories: null }],
            recipes: [],
            searchQuery: "",
        });
        expect(html).toContain("kcal unknown");
        expect(html).not.toContain("Search</button>");
    });

    test("a product is listed directly under its plain food, not by its own name", () => {
        const eggs = food("Eggs", "f-eggs");
        const kirkland = {
            ...food("Kirkland Large Eggs", "f-kirkland"),
            brand: "Kirkland",
            genericFoodId: "f-eggs",
        };
        const html = renderSettingsSavedV2Body({
            chrome,
            foods: [
                food("Buttermilk", "f-buttermilk"),
                eggs,
                kirkland,
                food("Milk", "f-milk"),
            ],
            recipes: [],
            searchQuery: "",
        });
        const order = [...html.matchAll(/value="(f-[a-z]+)"/g)].map(
            (m) => m[1],
        );
        expect([...new Set(order)]).toEqual([
            "f-buttermilk",
            "f-eggs",
            "f-kirkland",
            "f-milk",
        ]);
    });
});
