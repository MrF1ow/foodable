import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { Recipe } from "../../../domain/recipes.js";
import {
    applyV2RecipeListFilters,
    renderRecipesListBody,
    renderRecipesListV2Page,
    recipesListV2Href,
} from "./recipes-list.js";

const RECIPE: Recipe = {
    id: "r1",
    householdId: "hh",
    creatorId: "u1",
    name: "Shakshuka",
    yieldPortions: 2,
    instructions: null,
    sourceUrl: null,
    tags: [],
    notes: null,
    prepMinutes: 10,
    cookMinutes: 15,
    verification: "verified",
    updatedAt: "2026-01-01T00:00:00.000Z",
};

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
};

const MACROS = {
    calories: 640,
    protein_g: 48,
    carbs_g: 62,
    fat_g: 22,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    incomplete: false,
    incompleteReasons: [],
    gaps: [],
};

describe("recipes list v2 page", () => {
    test("chips link with filter query params", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "egg",
            filter: "cookable",
            cards: [],
            totalCount: 0,
        });
        expect(html).toContain('href="/recipes?q=egg&amp;filter=cookable"');
        expect(html).toContain('href="/recipes?q=egg&amp;filter=protein"');
        expect(html).toContain('aria-current="true"');
        expect(html).toContain(
            "Only recipes with a known total time; unknown time is excluded.",
        );
    });

    test("cards show stock labels", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            totalCount: 2,
            cards: [
                {
                    recipe: RECIPE,
                    flags: {
                        cookable: true,
                        highProtein: false,
                        quick: true,
                        missingCount: 0,
                        hasIngredients: true,
                    },
                    macrosPerPortion: MACROS,
                    missingNames: [],
                },
                {
                    recipe: { ...RECIPE, id: "r2", name: "Stew" },
                    flags: {
                        cookable: false,
                        highProtein: false,
                        quick: false,
                        missingCount: 2,
                        hasIngredients: true,
                    },
                    macrosPerPortion: MACROS,
                    missingNames: ["Avocado", "Lime"],
                },
            ],
        });
        expect(html).toContain("You have everything");
        expect(html).toContain("Missing 2 · Avocado, Lime");
        expect(html).toContain("fd-macro--protein");
        expect(html).toContain('href="/recipes/r1"');
        expect(html).toContain('class="fd-list fd-recipes-list"');
    });

    test("cookable chip shows count when provided", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 0,
            cookableCount: 5,
        });
        expect(html).toContain('fd-chip__count">5</span>');
        expect(html).toContain("Cookable now");
    });

    test("header and search expose link-import affordances", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 3,
            cookableCount: 2,
        });
        expect(html).toContain("fd-recipes-add-link");
        expect(html).toContain("data-fd-recipes-add-link");
        expect(html).toContain("fd-recipes-search-link");
        expect(html).toContain("fd-recipes-subtitle__cookable");
        expect(html).toContain("2 cookable now");
        expect(html).toContain('placeholder="Search or paste a link"');
        expect(html).toContain('placeholder="Search recipes or paste a link"');
        expect(html).toContain("fd-recipes-toolbar");
        expect(html).toContain("fd-recipes-search-input--desk");
    });

    test("recipe cards expose desktop kcal line", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            totalCount: 1,
            cards: [
                {
                    recipe: RECIPE,
                    flags: {
                        cookable: true,
                        highProtein: false,
                        quick: true,
                        missingCount: 0,
                        hasIngredients: true,
                    },
                    macrosPerPortion: MACROS,
                    missingNames: [],
                },
            ],
        });
        expect(html).toContain('class="fd-recipes-card__kcal"');
        expect(html).toContain("640 kcal");
    });

    test("empty states for no recipes and no matches", () => {
        const none = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 0,
        });
        expect(none).toContain("No recipes yet");
        const nomatch = renderRecipesListBody({
            chrome,
            query: "xyz",
            filter: "",
            cards: [],
            totalCount: 2,
        });
        expect(nomatch).toContain("No recipes match");
    });

    test("import link form works without JS", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 0,
        });
        expect(html).toContain("data-fd-recipes-import");
        expect(html).toContain('action="/recipes/import"');
        expect(html).not.toMatch(
            /<form[^>]*data-fd-recipes-import[^>]*\shidden/,
        );
        expect(html).toContain("Import a link");
    });

    test("empty ingredient recipe shows no stock-ok label", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            totalCount: 1,
            cards: [
                {
                    recipe: RECIPE,
                    flags: {
                        cookable: false,
                        highProtein: false,
                        quick: true,
                        missingCount: 0,
                        hasIngredients: false,
                    },
                    macrosPerPortion: MACROS,
                    missingNames: [],
                },
            ],
        });
        expect(html).toContain("No ingredients yet");
        expect(html).not.toContain("You have everything");
    });

    test("duplicate import shows open link", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 0,
            importDuplicateRecipeId: "r-dup",
        });
        expect(html).toContain("You already have this recipe");
        expect(html).toContain('href="/recipes/r-dup"');
    });

    test("social paste step posts text and credit not website_url", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 0,
            importPasteStep: true,
            importUrl: "https://www.instagram.com/p/abc",
            importPasteText: "Caption",
            importCredit: "Chef",
            importSourceKind: "instagram",
        });
        expect(html).toContain('name="text"');
        expect(html).toContain("Caption");
        expect(html).toContain('name="credit"');
        expect(html).not.toContain('name="website_url"');
    });

    test("link-only share prefill fills search field", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            cards: [],
            totalCount: 0,
            importUrl: "https://example.com/dish",
        });
        expect(html).toContain('value="https://example.com/dish"');
    });

    test("recipesListV2Href and applyV2RecipeListFilters", () => {
        expect(recipesListV2Href({ q: "a", filter: "quick" })).toBe(
            "/recipes?q=a&filter=quick",
        );
        const cards = [
            {
                recipe: RECIPE,
                flags: {
                    cookable: true,
                    highProtein: true,
                    quick: true,
                    missingCount: 0,
                    hasIngredients: true,
                },
                macrosPerPortion: MACROS,
                missingNames: [],
            },
            {
                recipe: { ...RECIPE, id: "r2", name: "Oatmeal" },
                flags: {
                    cookable: false,
                    highProtein: false,
                    quick: true,
                    missingCount: 1,
                    hasIngredients: true,
                },
                macrosPerPortion: MACROS,
                missingNames: ["Milk"],
            },
        ];
        expect(
            applyV2RecipeListFilters(cards, "shak", "").map((c) => c.recipe.id),
        ).toEqual(["r1"]);
        expect(
            applyV2RecipeListFilters(cards, "", "cookable").map(
                (c) => c.recipe.id,
            ),
        ).toEqual(["r1"]);
    });
});
