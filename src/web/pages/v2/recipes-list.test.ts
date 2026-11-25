import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { IMPORT_MESSAGES } from "../../../copy/recipe-import.js";
import type { Recipe } from "../../../domain/recipes.js";
import {
    recipesListV2Href,
    renderRecipesListBody,
    type RecipesListV2View,
} from "./recipes-list.js";
import { buildWeekPlanView } from "./recipes-plan.js";

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
    flags: FIXTURE_APP_CHROME_FLAGS,
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

const FLAGS = {
    cookable: true,
    highProtein: false,
    quick: true,
    missingCount: 0,
    hasIngredients: true,
};

const card = (
    id: string,
    name: string,
    over: Partial<RecipesListV2View["cards"][number]> = {},
) => ({
    recipe: { ...RECIPE, id, name },
    flags: FLAGS,
    macrosPerPortion: MACROS,
    missingNames: [],
    ...over,
});

const base = (over: Partial<RecipesListV2View> = {}): RecipesListV2View => ({
    chrome,
    query: "",
    filters: [],
    cards: [],
    totalCount: 0,
    ...over,
});

/** A week with two planned dinners, the beans of the chili missing. */
function week() {
    const plan = (id: string, recipeId: string, date: string) => ({
        id,
        householdId: "hh",
        recipeId,
        date,
        slot: "dinner" as const,
        servings: 2,
        createdBy: null,
        createdAt: "2026-11-09T10:00:00.000Z",
    });
    const recipe = (id: string, name: string) => ({
        id,
        name,
        yieldPortions: 2,
        ingredients: [
            {
                displayName: "Kidney beans",
                foodId: "f-beans",
                quantity: { amount: 400, unit: "g" },
            },
        ],
    });
    return buildWeekPlanView({
        today: "2026-11-10",
        plans: [
            plan("pl1", "r-salmon", "2026-11-10"),
            plan("pl2", "r-chili", "2026-11-11"),
        ],
        recipes: [
            recipe("r-salmon", "Salmon, rice & spinach"),
            recipe("r-chili", "Beef chili"),
        ],
        stock: [],
        foodsById: new Map(),
    });
}

/** The items of every menu panel on the page, one array per menu. */
function menuItems(html: string): string[][] {
    const out: string[][] = [];
    const panel = /<div class="fd-menu__panel"[^>]*>([\s\S]*?)<\/div><\/div>/g;
    for (const match of html.matchAll(panel)) {
        const labels = [
            ...(match[1] ?? "").matchAll(
                /<span class="fd-menu__label">([^<]*)<\/span>/g,
            ),
        ].map((m) => m[1] ?? "");
        out.push(labels);
    }
    return out;
}

describe("recipes list: header and search", () => {
    test("the page header names the saved count; no cookable-now suffix, no tab chips", () => {
        const html = renderRecipesListBody(base({ totalCount: 42 }));
        expect(html).toContain('class="fd-page-header fd-recipes-head"');
        expect(html).toContain(
            '<h1 class="fd-page-header__title">Recipes</h1>',
        );
        expect(html).toContain(
            '<p class="fd-page-header__subtitle">42 saved</p>',
        );
        expect(html).not.toContain("cookable now");
        expect(html).not.toContain("fd-chip");
    });

    test("the search field is the design's, with the filter pull-down, and no Import a link block", () => {
        const html = renderRecipesListBody(base({ totalCount: 3 }));
        expect(html).toContain("fd-search-field--boxed");
        expect(html).toContain('placeholder="Search recipes or paste a link"');
        expect(html).toContain('data-anchor="filter"');
        expect(html).not.toContain("Import a link");
        expect(html).not.toContain("fd-recipes-import-link");
    });

    test("the filter pull-down ticks the filters in force; each item toggles only itself", () => {
        const html = renderRecipesListBody(
            base({
                query: "egg",
                filters: ["cookable", "quick"],
                totalCount: 3,
            }),
        );
        // cookable is on: its item drops it, keeping quick.
        expect(html).toContain('href="/recipes?q=egg&amp;filter=quick"');
        // quick is on: its item drops it, keeping cookable.
        expect(html).toContain('href="/recipes?q=egg&amp;filter=cookable"');
        // protein is off: its item adds it to the end.
        expect(html).toContain(
            'href="/recipes?q=egg&amp;filter=cookable,quick,protein"',
        );
        expect(html.match(/aria-checked="true"/g)?.length).toBe(2);
        expect(html).toContain('data-fd-recipes-filter-count="2"');
        expect(html).toContain('name="filter" value="cookable,quick"');
        // Clear drops every filter and keeps the search.
        expect(html).toContain('href="/recipes?q=egg"');
        expect(menuItems(html)[0]).toEqual([
            "Cookable now",
            "High protein",
            "Under 30 min",
            "Favourites",
            "Clear",
        ]);
    });

    test("with no filter on there is no Clear and no count", () => {
        const html = renderRecipesListBody(base({ totalCount: 3 }));
        expect(menuItems(html)[0]).toEqual([
            "Cookable now",
            "High protein",
            "Under 30 min",
            "Favourites",
        ]);
        expect(html).toContain('data-fd-recipes-filter-count="0"');
        expect(html).not.toContain("fd-btn__badge");
        expect(html).not.toContain('name="filter"');
    });

    test("recipesListV2Href writes the filters as one comma list", () => {
        expect(recipesListV2Href({ q: "a", filters: ["quick"] })).toBe(
            "/recipes?q=a&filter=quick",
        );
        expect(recipesListV2Href({ filters: ["quick", "cookable"] })).toBe(
            "/recipes?filter=quick,cookable",
        );
        expect(recipesListV2Href({ filters: [] })).toBe("/recipes");
    });

    test("a search shows Clear and the 'N of M recipes' header", () => {
        const html = renderRecipesListBody(
            base({
                query: "chick",
                totalCount: 42,
                cards: [card("r1", "Chicken alfredo")],
            }),
        );
        expect(html).toContain("data-fd-search-clear");
        expect(html).toContain("1 of 42 recipes");
        expect(html).not.toContain(">All recipes<");
    });

    test("a pasted link shows the link state and Go; plain text hides Go", () => {
        const link = renderRecipesListBody(
            base({ query: "https://example.com/dish", totalCount: 3 }),
        );
        expect(link).toContain("data-link-detected");
        expect(link).toMatch(
            /<button[^>]*data-fd-recipes-import-go(?![^>]*hidden)/,
        );
        expect(link).toContain('action="/recipes/import"');
        const text = renderRecipesListBody(
            base({ query: "egg", totalCount: 3 }),
        );
        expect(text).not.toContain("data-link-detected");
        expect(text).toMatch(
            /<button[^>]*data-fd-recipes-import-go[^>]*hidden/,
        );
    });

    test("a failed import keeps its link in the field", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 3,
                importUrl: "https://example.com/dish",
                importError: "Could not read that page",
            }),
        );
        expect(html).toContain('value="https://example.com/dish"');
        expect(html).toContain("data-link-detected");
    });

    test("a website link that asks for the page text stays in the search field, so it can be fixed", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 3,
                importUrl: "https://example.com/dish",
                importPasteStep: true,
                importError: "That page has no recipe we can read",
            }),
        );
        const input = html.slice(html.indexOf('id="fd-recipes-q"'));
        expect(input.slice(0, input.indexOf(">"))).toContain(
            'value="https://example.com/dish"',
        );
        expect(html).toContain("data-link-detected");
        // The text-only step has a link box of its own and leaves the field alone.
        const textOnly = renderRecipesListBody(
            base({
                totalCount: 3,
                importUrl: "https://example.com/dish",
                importPasteStep: true,
                importTextOnly: true,
            }),
        );
        expect(textOnly).not.toContain("data-link-detected");
    });
});

describe("recipes list: rows", () => {
    test("a row is a link with a star, its words, macros and a ⋯ with Plan", () => {
        const html = renderRecipesListBody(
            base({ totalCount: 1, cards: [card("r1", "Shakshuka")] }),
        );
        expect(html).toContain('id="recipe-r1"');
        expect(html).toContain('href="/recipes/r1"');
        expect(html).toContain("2 servings · 25 min");
        expect(html).toContain("fd-macros");
        expect(html).toContain('action="/recipes/r1/favourite"');
        expect(html).toContain("Add Shakshuka to favourites");
        expect(menuItems(html).slice(-1)[0]).toEqual(["Plan"]);
        expect(html).toContain('href="/recipes/r1?plan=1"');
        // The star and the ⋯ sit beside the link, not inside it.
        expect(html).toMatch(/<\/form><a class="fd-item-row__anchor"/);
        expect(html).not.toContain("kcal");
    });

    test("a short recipe says what is missing, in the warning state", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [
                    card("r2", "Oatmeal", {
                        flags: { ...FLAGS, cookable: false, missingCount: 2 },
                        missingNames: ["Avocado", "Lime"],
                    }),
                ],
            }),
        );
        expect(html).toContain("Missing 2 · Avocado, Lime");
        expect(html).toContain("fd-item-row--warning");
        expect(html).not.toContain("You have everything");
    });

    test("a recipe with no ingredients says nothing about stock", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [
                    card("r3", "Plain", {
                        flags: {
                            ...FLAGS,
                            cookable: false,
                            hasIngredients: false,
                        },
                    }),
                ],
            }),
        );
        expect(html).not.toContain("Missing");
        expect(html).not.toContain("No ingredients yet");
    });

    test("an unknown macro is a dash, never a zero", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [
                    card("r4", "Mystery", {
                        macrosPerPortion: { ...MACROS, carbs_g: null },
                    }),
                ],
            }),
        );
        expect(html).toContain("–");
    });

    test("the star offers to remove a favourite and is filled", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [card("r1", "Shakshuka", { favourite: true })],
            }),
        );
        expect(html).toContain("Remove Shakshuka from favourites");
        expect(html).toContain("fd-star--on");
        expect(html).toContain('name="on" value="0"');
    });

    test("the recipe name is escaped in the star label and the ⋯ name", () => {
        const html = renderRecipesListBody(
            base({ totalCount: 1, cards: [card("r5", `Mac "n" <cheese>`)] }),
        );
        expect(html).not.toContain("<cheese>");
        expect(html).toContain(
            "Add Mac &quot;n&quot; &lt;cheese&gt; to favourites",
        );
        expect(html).toContain("Actions for Mac &quot;n&quot; &lt;cheese&gt;");
    });

    test("the star's form carries the search and filter back to the list", () => {
        const html = renderRecipesListBody(
            base({
                query: "egg",
                filters: ["quick"],
                totalCount: 1,
                cards: [card("r1", "Shakshuka")],
            }),
        );
        expect(html).toContain('name="back" value="list"');
        expect(html).toContain('name="q" value="egg"');
        expect(html).toContain('name="filter" value="quick"');
    });

    test("every ⋯ on the page has at least one item", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 2,
                cards: [card("r1", "A"), card("r2", "B")],
                week: week(),
            }),
        );
        const menus = menuItems(html);
        expect(menus.length).toBeGreaterThan(0);
        for (const items of menus) expect(items.length).toBeGreaterThan(0);
    });

    test("empty states for no recipes, no matches and no favourites", () => {
        expect(renderRecipesListBody(base())).toContain("No recipes yet");
        expect(
            renderRecipesListBody(base({ totalCount: 3, query: "zzz" })),
        ).toContain("No recipes match");
        const fav = renderRecipesListBody(
            base({ totalCount: 3, filters: ["favourites"] }),
        );
        expect(fav).toContain("No favourites yet");
        expect(fav).toContain("Tap the star on a recipe to keep it here.");
    });
});

describe("recipes list: the plan", () => {
    test("planned recipes are Mini cards that open their edit sheet, with the missing link under them", () => {
        const html = renderRecipesListBody(
            base({ totalCount: 2, cards: [card("r1", "A")], week: week() }),
        );
        expect(html).toContain("Planned this week");
        expect(html).toContain("fd-mini-card");
        expect(html).toContain('commandfor="fd-plan-edit-pl1"');
        expect(html).toContain('commandfor="fd-plan-edit-pl2"');
        expect(html).toContain("Salmon, rice &amp; spinach");
        expect(html).toContain('commandfor="fd-plan-missing-sheet"');
        expect(html).toContain("1 ingredient missing");
        expect(html).toContain('id="fd-plan-missing-sheet"');
    });

    test("the plan-missing notice strip is gone", () => {
        const html = renderRecipesListBody(
            base({ totalCount: 2, cards: [card("r1", "A")], week: week() }),
        );
        expect(html).not.toContain("fd-notice-strip");
        expect(html).not.toContain("Dismiss");
    });

    test("nothing planned: no planned section and no missing link", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [card("r1", "A")],
                week: buildWeekPlanView({
                    today: "2026-11-10",
                    plans: [],
                    recipes: [],
                    stock: [],
                    foodsById: new Map(),
                }),
            }),
        );
        expect(html).not.toContain("Planned this week");
        expect(html).not.toContain("ingredient");
    });

    test("picking a day: the subtitle names it, Cancel leaves, each row's plus plans it", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [card("r1", "Shakshuka")],
                week: week(),
                planDate: "2026-11-14",
            }),
        );
        expect(html).toContain("Pick one for Sat 14 Nov");
        expect(html).toContain('href="/recipes">Cancel</a>');
        expect(html).toContain('href="/recipes/r1?plan=1&amp;date=2026-11-14"');
        expect(html).toContain('aria-label="Plan Shakshuka"');
        expect(html).toContain('name="plan_date" value="2026-11-14"');
        // No planned cards, star or ⋯ while a day is being picked.
        expect(html).not.toContain("Planned this week");
        expect(html).not.toContain("fd-star-form");
        expect(html).not.toContain("Actions for Shakshuka");
    });

    test("picking a day: the filter pull-down's links and Clear keep the day", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 3,
                cards: [card("r1", "Shakshuka")],
                planDate: "2026-11-14",
                filters: ["quick"],
            }),
        );
        const menuHtml = html.match(
            /data-anchor="filter"[\s\S]*?role="menu"[\s\S]*?<\/div>/,
        )?.[0];
        expect(menuHtml).toBeDefined();
        const hrefs = [...menuHtml!.matchAll(/href="([^"]+)"/g)].map(
            (m) => m[1]!,
        );
        // One link per filter, and Clear while one is in force.
        expect(hrefs.length).toBeGreaterThan(1);
        for (const href of hrefs)
            expect(href).toContain("plan_date=2026-11-14");
        expect(hrefs.at(-1)).toBe("/recipes?plan_date=2026-11-14");
        // Out of picking mode the links carry no day.
        const plain = renderRecipesListBody(
            base({ totalCount: 3, cards: [card("r1", "Shakshuka")] }),
        );
        expect(plain).not.toContain("plan_date");
    });

    test("picking a day leaves the drafts out, since a draft cannot be planned", () => {
        const drafts = [{ id: "d1", name: "Imported soup", expiresOn: null }];
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [card("r1", "Shakshuka")],
                drafts,
                planDate: "2026-11-14",
            }),
        );
        expect(html).not.toContain("Imported soup");
        expect(html).not.toContain("fd-recipes-drafts");
        expect(html).toContain("Shakshuka");
        // Not picking: the draft is there.
        expect(
            renderRecipesListBody(
                base({
                    totalCount: 1,
                    cards: [card("r1", "Shakshuka")],
                    drafts,
                }),
            ),
        ).toContain("Imported soup");
        // With only drafts and a day to pick, the list says there is nothing to pick.
        const none = renderRecipesListBody(
            base({ totalCount: 0, cards: [], drafts, planDate: "2026-11-14" }),
        );
        expect(none).not.toContain("Imported soup");
        expect(none).toContain("No recipes yet");
    });

    test("picking a day with no saved recipes still offers Cancel", () => {
        const html = renderRecipesListBody(
            base({ totalCount: 0, cards: [], planDate: "2026-11-14" }),
        );
        expect(html).toContain('href="/recipes">Cancel</a>');
        expect(html).toContain("No recipes yet");
        // Not picking: no Cancel.
        expect(
            renderRecipesListBody(base({ totalCount: 0, cards: [] })),
        ).not.toContain(">Cancel<");
    });
});

describe("recipes list: import answers", () => {
    test("an import error is a card with the headline and, when there is one, the reason", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [card("r1", "A")],
                importError: "We could not read that page",
                importErrorReason: "Paste the recipe text instead.",
            }),
        );
        expect(html).toContain("fd-recipes-import-error__headline");
        expect(html).toContain("We could not read that page");
        expect(html).toContain("Paste the recipe text instead.");
        expect(html).toContain('role="alert"');
        // An answer takes a column beside the list.
        expect(html).toContain("fd-page-layout--two-columns");
    });

    test("with no answer the page is one column", () => {
        expect(renderRecipesListBody(base({ totalCount: 1 }))).toContain(
            "fd-page-layout--single",
        );
    });

    test("a duplicate import says so and links the recipe", () => {
        const html = renderRecipesListBody(
            base({ importDuplicateRecipeId: "r9", importError: "ignored" }),
        );
        expect(html).toContain("You already have this recipe.");
        expect(html).toContain('<a href="/recipes/r9">Open it</a>');
        expect(html).not.toContain("ignored");
    });

    test("the paste step posts text and credit, not website_url", () => {
        const html = renderRecipesListBody(
            base({
                importPasteStep: true,
                importUrl: "https://www.instagram.com/reel/abc/",
                importSourceKind: "instagram",
                importCredit: "Sam",
            }),
        );
        expect(html).toContain('name="import_step" value="paste"');
        expect(html).toContain('name="text"');
        expect(html).toContain('name="credit"');
        expect(html).toContain('value="Sam"');
        expect(html).not.toContain('name="website_url"');
    });

    test("a Pinterest paste asks for the recipe website too", () => {
        const html = renderRecipesListBody(
            base({
                importPasteStep: true,
                importSourceKind: "pinterest",
                importWebsiteError: "That is not a page",
            }),
        );
        expect(html).toContain('name="website_url"');
        expect(html).toContain("That is not a page");
    });

    test("a retry button shows with Check again, disabled when asked", () => {
        const html = renderRecipesListBody(
            base({
                importPasteStep: true,
                importShowRetry: true,
                importRetryDisabled: true,
            }),
        );
        expect(html).toMatch(/<button[^>]*name="retry"[^>]*disabled/);
        expect(html).toContain("Check again");
    });

    test("a text-only paste has the link optional and no creator field", () => {
        const html = renderRecipesListBody(
            base({ importPasteStep: true, importTextOnly: true }),
        );
        expect(html).toContain('name="text_only" value="1"');
        expect(html).not.toContain('name="credit"');
    });
});

describe("recipes list: drafts", () => {
    test("each draft is a row that opens its recipe, shown as a draft with its delete day", () => {
        const html = renderRecipesListBody(
            base({
                totalCount: 1,
                cards: [card("r1", "A")],
                drafts: [
                    {
                        id: "d1",
                        name: "Imported soup",
                        expiresOn: "2026-11-30",
                    },
                ],
            }),
        );
        expect(html).toContain('id="fd-recipes-drafts"');
        expect(html).toContain('href="/recipes/d1"');
        expect(html).toContain("Imported soup");
        expect(html).toContain("Draft · deleted Mon 30 Nov unless saved");
        expect(html.toLowerCase()).not.toContain("unverified");
    });

    test("a draft alone makes the page not empty", () => {
        const html = renderRecipesListBody(
            base({ drafts: [{ id: "d1", name: "Soup", expiresOn: null }] }),
        );
        expect(html).not.toContain("No recipes yet");
        expect(html).toContain("Draft");
    });
});

describe("recipes list: mcp-share-links", () => {
    test("the shared-recipe form is there with the flag on and gone with it off", () => {
        const on = renderRecipesListBody(
            base({ totalCount: 1, sharedImportEnabled: true }),
        );
        expect(on).toContain('action="/recipes/import-shared"');
        expect(on).toContain("Import from another Foodable");
        const off = renderRecipesListBody(
            base({ totalCount: 1, sharedImportEnabled: false }),
        );
        expect(off).not.toContain("import-shared");
        expect(off).not.toContain("another Foodable");
    });

    const SHARE = "https://kitchen.example/s/abc";
    const refused = (via?: "field" | "form") =>
        renderRecipesListBody(
            base({
                sharedImportEnabled: true,
                sharedImport: {
                    error: "That share link doesn't work any more",
                    reason: "Revoked, expired, or not a recipe link",
                    input: SHARE,
                    via,
                },
            }),
        );
    const occurrences = (html: string, text: string) =>
        html.split(text).length - 1;

    test("a refused link from the shared-recipe form shows its reason in a card and keeps that form open with the link in it", () => {
        for (const html of [refused("form"), refused()]) {
            expect(html).toContain("fd-recipes-import-shared-error");
            expect(html).toContain("Revoked, expired, or not a recipe link");
            expect(html).toContain('<details class="fd-recipes-shared" open>');
            expect(html).toMatch(
                new RegExp(`<textarea[^>]*>${SHARE}</textarea>`),
            );
            // Once: not in the search field as well.
            expect(occurrences(html, SHARE)).toBe(1);
        }
    });

    test("a refused link from the shared-recipe form answers inside that open form, above the field; one from the search field answers at the top", () => {
        for (const html of [refused("form"), refused()]) {
            const open = html.indexOf('<details class="fd-recipes-shared"');
            const card = html.indexOf("fd-recipes-import-shared-error");
            const field = html.indexOf("<textarea");
            const close = html.indexOf("</details>");
            expect(open).toBeGreaterThan(-1);
            expect(card).toBeGreaterThan(open);
            expect(card).toBeLessThan(field);
            expect(field).toBeLessThan(close);
        }
        const top = refused("field");
        expect(top.indexOf("fd-recipes-import-shared-error")).toBeLessThan(
            top.indexOf('<details class="fd-recipes-shared"'),
        );
    });

    test("a refused link from the search field shows in the field once, and the shared-recipe form stays closed and empty", () => {
        const html = refused("field");
        expect(html).toContain("fd-recipes-import-shared-error");
        expect(html).toContain("Revoked, expired, or not a recipe link");
        expect(html).toContain(`value="${SHARE}"`);
        expect(html).toContain('<details class="fd-recipes-shared">');
        expect(html).not.toContain('<details class="fd-recipes-shared" open>');
        expect(html).toMatch(/<textarea[^>]*><\/textarea>/);
        expect(occurrences(html, SHARE)).toBe(1);
    });

    test("with the flag off a refusal is not shown", () => {
        const html = renderRecipesListBody(
            base({
                sharedImportEnabled: false,
                sharedImport: { error: "nope", input: "x" },
            }),
        );
        expect(html).not.toContain("nope");
    });

    test("no ⋯ renders empty with the flag on or off", () => {
        for (const sharedImportEnabled of [true, false]) {
            const html = renderRecipesListBody(
                base({
                    totalCount: 1,
                    cards: [card("r1", "A")],
                    week: week(),
                    sharedImportEnabled,
                }),
            );
            for (const items of menuItems(html)) {
                expect(items.length).toBeGreaterThan(0);
            }
        }
    });
});

describe("the import flow's copy", () => {
    test("an import that worked says it is a draft and to save it; no message says unverified", () => {
        expect(IMPORT_MESSAGES.imported.headline).toContain("as a draft");
        expect(IMPORT_MESSAGES.imported.reason).toBe("Save it to keep it.");
        for (const key of [
            "unverified_needs_review",
            "unverified_needs_review_one",
        ] as const) {
            expect(IMPORT_MESSAGES[key].headline).toContain(
                "Imported as a draft",
            );
        }
        for (const message of Object.values(IMPORT_MESSAGES)) {
            const text = `${message.headline} ${"reason" in message ? message.reason : ""}`;
            expect(text.toLowerCase()).not.toContain("unverified");
        }
    });

    test("the import sheet on the page says nothing of unverified", () => {
        const html = renderRecipesListBody(
            base({
                importError: "Imported as a draft: 2 need checking.",
                importErrorReason: "Save it to keep it.",
            }),
        );
        expect(html.toLowerCase()).not.toContain("unverified");
    });
});
