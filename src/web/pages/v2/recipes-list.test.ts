import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { Recipe } from "../../../domain/recipes.js";
import {
    applyV2RecipeListFilters,
    parseV2RecipeListFilter,
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

describe("recipes list v2 favourites", () => {
    const FLAGS = {
        cookable: true,
        highProtein: false,
        quick: true,
        missingCount: 0,
        hasIngredients: true,
    };
    const card = (id: string, name: string, favourite?: boolean) => ({
        recipe: { ...RECIPE, id, name },
        flags: FLAGS,
        macrosPerPortion: MACROS,
        missingNames: [],
        favourite,
    });

    test("the Favourites chip follows Under 30 min and links to the filter", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "egg",
            filter: "",
            cards: [],
            totalCount: 0,
        });
        expect(html).toContain('href="/recipes?q=egg&amp;filter=favourites"');
        expect(html.indexOf("Under 30 min")).toBeLessThan(
            html.indexOf("Favourites"),
        );
        expect(html).not.toMatch(
            /aria-current="true"[^>]*><span class="fd-chip__label">Favourites/,
        );
    });

    test("the chip is current when the filter is on", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "favourites",
            cards: [],
            totalCount: 3,
        });
        expect(html).toMatch(
            /<a class="fd-chip fd-chip--selected"[^>]*aria-current="true"[^>]*><span class="fd-chip__label">Favourites/,
        );
    });

    test("parseV2RecipeListFilter accepts favourites", () => {
        expect(parseV2RecipeListFilter("favourites")).toBe("favourites");
        expect(parseV2RecipeListFilter("favorites")).toBe("");
    });

    test("applyV2RecipeListFilters keeps only starred cards", () => {
        const cards = [
            card("r1", "Shakshuka", true),
            card("r2", "Oatmeal", false),
            card("r3", "Stew"),
        ];
        expect(
            applyV2RecipeListFilters(cards, "", "favourites").map(
                (c) => c.recipe.id,
            ),
        ).toEqual(["r1"]);
        // Search narrows within the favourites.
        expect(applyV2RecipeListFilters(cards, "oat", "favourites")).toEqual(
            [],
        );
    });

    test("an empty favourites filter says so", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "favourites",
            cards: [],
            totalCount: 4,
        });
        expect(html).toContain("No favourites yet");
        expect(html).not.toContain("No recipes match");
    });

    test("each card carries a star form beside its link, not inside it", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "egg",
            filter: "cookable",
            totalCount: 2,
            cards: [card("r1", "Shakshuka", false)],
        });
        const li = html.match(
            /<li class="fd-row fd-row--recipe"[^>]*>[\s\S]*?<\/li>/,
        )![0];
        expect(li).toContain('id="recipe-r1"');
        const link = li.match(/<a class="fd-recipes-card"[\s\S]*?<\/a>/)![0];
        expect(link).not.toContain("<form");
        expect(link).not.toContain("<button");
        const form = li.match(/<form[\s\S]*?<\/form>/)![0];
        expect(form).toContain('method="post"');
        expect(form).toContain('action="/recipes/r1/favourite"');
        expect(form).toContain('name="on" value="1"');
        expect(form).toContain('name="back" value="list"');
        expect(form).toContain('name="q" value="egg"');
        expect(form).toContain('name="filter" value="cookable"');
        expect(form).toContain('aria-label="Add Shakshuka to favourites"');
        expect(form).not.toContain("fd-star--on");
    });

    test("a starred card offers to remove the star and is filled", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            totalCount: 1,
            cards: [card("r1", "Shakshuka", true)],
        });
        const form = html.match(/<form[^>]*fd-star-form[\s\S]*?<\/form>/)![0];
        expect(form).toContain('name="on" value="0"');
        expect(form).toContain('aria-label="Remove Shakshuka from favourites"');
        expect(form).toContain("fd-star--on");
        expect(form).not.toContain('name="q"');
        expect(form).not.toContain('name="filter"');
    });

    test("the recipe name is escaped in the star label", () => {
        const html = renderRecipesListBody({
            chrome,
            query: "",
            filter: "",
            totalCount: 1,
            cards: [card("r1", 'Mac "n" <cheese>', false)],
        });
        expect(html).toContain(
            'aria-label="Add Mac &quot;n&quot; &lt;cheese&gt; to favourites"',
        );
    });
});
