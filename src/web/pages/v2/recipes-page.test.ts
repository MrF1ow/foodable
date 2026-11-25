import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
import { findMissingMentions } from "../../../domain/recipe-mentions.js";
import type { Recipe, RecipeMacros } from "../../../domain/recipes.js";
import {
    groupRecipeIngredientsByPlace,
    ingredientVersionNote,
    RECIPE_NOT_IN_STOCK_ID,
    renderRecipeDetailBody,
    type RecipeVersionPicker,
} from "./recipes-page.js";

const HH = "hh-1";

const RECIPE: Recipe = {
    id: "r1",
    householdId: HH,
    creatorId: "u1",
    name: "Pancakes",
    yieldPortions: 4,
    instructions: "Mix.\n\nCook.",
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

describe("groupRecipeIngredientsByPlace", () => {
    const pantry: FridgeLocation = {
        id: "loc-pantry",
        householdId: HH,
        name: "Pantry",
        sortOrder: 0,
    };
    const fridge: FridgeLocation = {
        id: "loc-fridge",
        householdId: HH,
        name: "Fridge",
        sortOrder: 1,
    };
    const flourId = "food-flour";
    const milkId = "food-milk";
    const familyFoodMap = new Map([
        [flourId, { id: flourId, genericFoodId: null }],
        [milkId, { id: milkId, genericFoodId: null }],
    ]);

    test("groups by location and puts missing stock last", () => {
        const ingredients = [
            {
                id: "ing1",
                foodId: flourId,
                displayName: "Flour",
                quantity: { amount: 200, unit: "g" } as const,
                note: null,
            },
            {
                id: "ing2",
                foodId: milkId,
                displayName: "Milk",
                quantity: { amount: 1, unit: "cup" } as const,
                note: null,
            },
        ];
        const items: FridgeItem[] = [
            {
                id: "fi1",
                householdId: HH,
                locationId: pantry.id,
                kind: "food",
                displayName: "Flour",
                quantity: { amount: 500, unit: "g" },
                foodId: flourId,
                expiresOn: "2026-12-01",
            },
        ];
        const groups = groupRecipeIngredientsByPlace(
            ingredients,
            items,
            [pantry, fridge],
            familyFoodMap,
        );
        expect(groups.map((g) => g.placeName)).toEqual([
            "Pantry",
            "Not in stock",
        ]);
        expect(groups[1]?.placeId).toBe(RECIPE_NOT_IN_STOCK_ID);
        expect(groups[0]?.lines[0]?.expiresOn).toBe("2026-12-01");
    });

    test("shows soonest expiry in a location", () => {
        const groups = groupRecipeIngredientsByPlace(
            [
                {
                    id: "ing1",
                    foodId: flourId,
                    displayName: "Flour",
                    quantity: { amount: 50, unit: "g" },
                    note: null,
                },
            ],
            [
                {
                    id: "a",
                    householdId: HH,
                    locationId: pantry.id,
                    kind: "food",
                    displayName: "Flour",
                    quantity: { amount: 100, unit: "g" },
                    foodId: flourId,
                    expiresOn: "2026-11-20",
                },
                {
                    id: "b",
                    householdId: HH,
                    locationId: pantry.id,
                    kind: "food",
                    displayName: "Flour bag",
                    quantity: { amount: 200, unit: "g" },
                    foodId: flourId,
                    expiresOn: "2026-11-05",
                },
            ],
            [pantry],
            familyFoodMap,
        );
        expect(groups[0]?.lines[0]?.expiresOn).toBe("2026-11-05");
    });

    test("product-stocked food groups under its place", () => {
        const plainFlour = "food-plain-flour";
        const productFlour = "food-product-flour";
        const map = new Map([
            [plainFlour, { id: plainFlour, genericFoodId: null }],
            [productFlour, { id: productFlour, genericFoodId: plainFlour }],
        ]);
        const groups = groupRecipeIngredientsByPlace(
            [
                {
                    id: "ing1",
                    foodId: plainFlour,
                    displayName: "Flour",
                    quantity: { amount: 100, unit: "g" },
                    note: null,
                },
            ],
            [
                {
                    id: "fi-product",
                    householdId: HH,
                    locationId: pantry.id,
                    kind: "food",
                    displayName: "Brand flour",
                    quantity: { amount: 500, unit: "g" },
                    foodId: productFlour,
                    expiresOn: "2026-12-15",
                },
            ],
            [pantry],
            map,
        );
        expect(groups.map((g) => g.placeName)).toEqual(["Pantry"]);
        expect(groups[0]?.lines[0]?.expiresOn).toBe("2026-12-15");
    });
});

const MACROS: RecipeMacros = {
    calories: 200,
    protein_g: 8,
    carbs_g: 30,
    fat_g: 5,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    incomplete: false,
};

const PLAN = {
    recipeId: "r1",
    recipeName: "Pancakes",
    yieldPortions: 4,
    today: "2026-11-12",
    date: "2026-11-12",
    slot: "dinner",
    servings: 4,
};

const COOK = {
    recipeId: "r1",
    recipeName: "Pancakes",
    servings: 4,
    yieldPortions: 4,
    preview: {
        totalPortions: 4,
        lines: [],
        movements: [],
        shortfalls: [],
        unmeasured: [],
    },
    slot: "dinner" as const,
    viewerName: "Alice",
    submitKey: "k1",
};

const FLOUR = {
    id: "ing1",
    foodId: "food-flour",
    displayName: "Flour",
    quantity: { amount: 200, unit: "g" } as const,
    note: null,
};
const BUTTERMILK = {
    id: "ing2",
    foodId: "food-buttermilk",
    displayName: "Buttermilk",
    quantity: { amount: 200, unit: "ml" } as const,
    note: null,
};

const viewBase = {
    chrome,
    recipe: RECIPE,
    ingredients: [],
    ingredientGroups: [],
    macrosPerPortion: MACROS,
    gapReasons: [],
};

/** The text of the first element a pattern finds; the test fails when none is. */
function first(html: string, pattern: RegExp): string {
    const found = html.match(pattern);
    expect(found).not.toBeNull();
    return found![0];
}

describe("renderRecipeDetailBody", () => {
    test("Plan and Cook sit in the bar, Cook last, and open their sheets", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            cook: COOK,
            plan: PLAN,
        });
        const bar = first(
            html,
            /<div class="fd-recipe-bar" id="fd-recipe-cook-heading">[\s\S]*?<\/div>/,
        );
        const plan = bar.indexOf('commandfor="fd-recipe-plan-sheet"');
        const cook = bar.indexOf('commandfor="fd-recipe-cook-sheet"');
        expect(plan).toBeGreaterThan(-1);
        expect(cook).toBeGreaterThan(plan);
        expect(bar).not.toContain("Share");
        expect(html).toContain('id="fd-recipe-cook-sheet"');
        expect(html).toContain('action="/recipes/r1/cook/confirm"');
        expect(html).not.toContain('name="portion:u1"');
        expect(html).toContain('id="fd-recipe-method-heading"');
        expect(html).toContain(">Steps</h2>");
        expect(html).toContain("fd-dot--protein");
    });

    test("the Detail bar goes back to Recipes, and a page with nothing else to offer has no empty menu", () => {
        const html = renderRecipeDetailBody({ ...viewBase });
        const bar = first(
            html,
            /<header class="fd-detail-bar[\s\S]*?<\/header>/,
        );
        expect(bar).toContain('href="/recipes"');
        expect(bar).toContain('aria-label="Back to recipes"');
        // The star is an item of the ⋯, so a saved recipe's ⋯ is never empty.
        expect(bar).toContain("Add to favourites");
        const draft = renderRecipeDetailBody({
            ...viewBase,
            draft: {
                problems: [],
                expiresOn: null,
                canSave: false,
                canDiscard: false,
            },
        });
        const draftBar = first(
            draft,
            /<header class="fd-detail-bar[\s\S]*?<\/header>/,
        );
        expect(draftBar).not.toContain("fd-menu");
        expect(draftBar).not.toContain("more");
        expect(draftBar).toContain("fd-detail-bar__balance");
    });

    test("Share is an item of the Detail bar's ⋯ only while the share view is there", () => {
        const on = renderRecipeDetailBody({ ...viewBase, share: {} });
        const bar = first(on, /<header class="fd-detail-bar[\s\S]*?<\/header>/);
        expect(bar).toContain('commandfor="fd-recipe-share-sheet"');
        expect(bar).toContain("Share");
        const off = renderRecipeDetailBody({ ...viewBase });
        expect(off).not.toContain("fd-recipe-share");
        expect(off).not.toContain("/share");
        expect(off).not.toContain("Share");
    });

    test("the share sheet asks how long the link works and posts to this recipe's route", () => {
        const html = renderRecipeDetailBody({ ...viewBase, share: {} });
        const sheet = first(
            html,
            /<dialog[^>]*id="fd-recipe-share-sheet"[\s\S]*?<\/dialog>/,
        );
        expect(sheet).toContain('action="/recipes/r1/share"');
        expect(sheet).toContain("Share Pancakes");
        expect(sheet).toContain("Link works for");
        for (const label of [
            "1 week",
            "1 month",
            "3 months",
            "Never expires",
        ]) {
            expect(sheet).toContain(`>${label}<`);
        }
        expect(sheet).toContain('name="expires" value="never" checked');
        expect(sheet).toContain(">Make link<");
    });

    test("a refused share shows its error in the open sheet, not above the page", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            error: "Choose how long the link should work.",
            share: { open: true },
        });
        expect(html).toContain('id="fd-recipe-share-sheet"');
        expect(html).toContain("data-sheet-open-on-load");
        expect(
            html.split("Choose how long the link should work.").length - 1,
        ).toBe(1);
    });

    test("without a cook view there is no Cook button or sheet", () => {
        const html = renderRecipeDetailBody({ ...viewBase, plan: PLAN });
        expect(html).not.toContain("fd-recipe-cook-sheet");
        expect(html).not.toContain(">Cook<");
    });

    test("the star is an item of the ⋯ that posts back to the recipe, and says which way it moves", () => {
        const off = renderRecipeDetailBody({ ...viewBase });
        const form = first(
            off,
            /<form[^>]*action="\/recipes\/r1\/favourite"[\s\S]*?<\/form>/,
        );
        expect(form).toContain('name="on" value="1"');
        expect(form).toContain('name="back" value="recipe"');
        expect(form).toContain("Add to favourites");
        const on = renderRecipeDetailBody({ ...viewBase, favourite: true });
        const unstar = first(
            on,
            /<form[^>]*action="\/recipes\/r1\/favourite"[\s\S]*?<\/form>/,
        );
        expect(unstar).toContain('name="on" value="0"');
        expect(unstar).toContain("Remove from favourites");
    });

    test("a recipe with no upcoming plan shows no Planned line", () => {
        const html = renderRecipeDetailBody({ ...viewBase });
        expect(html).not.toContain("fd-recipe-planned");
        expect(html).not.toContain("Planned");
        expect(
            renderRecipeDetailBody({ ...viewBase, planned: [] }),
        ).not.toContain("fd-recipe-planned");
    });

    test("one upcoming plan reads Planned · day · meal under the title", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            planned: [{ date: "2026-11-26", slot: "dinner" }],
        });
        expect(html).toContain("Planned · Thu 26 Nov · dinner");
        expect(html.indexOf("fd-recipe-planned")).toBeGreaterThan(
            html.indexOf("fd-page-header__title"),
        );
        expect(html.indexOf("fd-recipe-planned")).toBeLessThan(
            html.indexOf("fd-page-layout__columns"),
        );
    });

    test("two upcoming plans are listed compactly in order", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            planned: [
                { date: "2026-11-26", slot: "dinner" },
                { date: "2026-11-28", slot: "lunch" },
            ],
        });
        expect(html).toContain(
            "Planned · Thu 26 Nov · dinner, Sat 28 Nov · lunch",
        );
    });

    test("more than four plans show the first four and a count", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            planned: ["01", "02", "03", "04", "05", "06"].map((d) => ({
                date: `2026-12-${d}`,
                slot: "dinner" as const,
            })),
        });
        expect(html).toContain("Tue 1 Dec · dinner");
        expect(html).toContain("Fri 4 Dec · dinner");
        expect(html).not.toContain("Sat 5 Dec");
        expect(html).toContain("+2 more");
    });

    test("the title carries the servings, time and source, and no portions-for-you line", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: { ...RECIPE, sourceUrl: "https://www.example.com/p/1" },
        });
        expect(html).toContain("4 servings · 25 min · from example.com");
        expect(html).not.toContain("for you");
    });

    test("ingredients are Item rows in the recipe's order, each with its place and a ⋯", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [BUTTERMILK, FLOUR],
            ingredientGroups: [
                {
                    placeId: "loc-pantry",
                    placeName: "Pantry",
                    lines: [
                        {
                            ingredientId: "ing1",
                            displayName: "Flour",
                            amountLabel: "200 g",
                            expiresOn: "2026-12-01",
                        },
                    ],
                },
                {
                    placeId: RECIPE_NOT_IN_STOCK_ID,
                    placeName: "Not in stock",
                    lines: [
                        {
                            ingredientId: "ing2",
                            displayName: "Buttermilk",
                            amountLabel: "200 ml",
                            expiresOn: null,
                        },
                    ],
                },
            ],
        });
        expect(html).toContain('id="fd-recipe-ingredients-heading"');
        expect(html.indexOf("Buttermilk")).toBeLessThan(
            html.indexOf(">Flour<"),
        );
        expect(html).toContain("Pantry · expires 2026-12-01");
        expect(html).toContain("Not in stock");
        expect(html).toContain('aria-label="Actions for Flour"');
        const menu = first(
            html,
            /<[^>]*aria-label="Actions for Flour"[\s\S]*?<\/div>\s*<\/div>/,
        );
        expect(menu).toContain("/foods/food-flour?from=%2Frecipes%2Fr1");
        // The add posts to the recipe's own route, so the person stays on it.
        expect(menu).toContain(
            'action="/recipes/r1/ingredients/food-flour/add-to-grocery"',
        );
        expect(menu).not.toContain('action="/foods/');
        // No group headings by place any more: one flat list.
        expect(html).not.toContain("fd-recipe-place");
    });

    test("an ingredient already on the list says so and offers no second add", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [FLOUR, BUTTERMILK],
            onList: [FLOUR.foodId],
        });
        const rows = html.split('<li class="fd-item-row').slice(1);
        const flour = rows.find((row) => row.includes("Flour"))!;
        const other = rows.find((row) => row.includes("Buttermilk"))!;
        expect(flour).toContain("On the list");
        expect(flour).not.toContain("add-to-grocery");
        expect(other).not.toContain("On the list");
        expect(other).toContain("add-to-grocery");
    });

    test("a draft's ingredient menu has no Add to grocery list, only Open food", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: { ...RECIPE, verification: "unverified" },
            ingredients: [FLOUR],
            draft: {
                problems: [],
                expiresOn: null,
                canSave: true,
                canDiscard: true,
            },
        });
        const menu = first(
            html,
            /<[^>]*aria-label="Actions for Flour"[\s\S]*?<\/div>\s*<\/div>/,
        );
        expect(menu).toContain("Open food");
        expect(menu).not.toContain("Add to grocery list");
        expect(menu).not.toContain("add-to-grocery");
    });

    test("the viewer's own portion count stays on the page under the per-serving tiles", () => {
        const html = renderRecipeDetailBody({ ...viewBase, portionCount: 2 });
        const macros = first(
            html,
            /<section class="fd-recipe-macros"[\s\S]*?<\/section>/,
        );
        expect(macros).toContain("2 portions for you");
        expect(macros.indexOf("fd-recipe-macro-tiles")).toBeLessThan(
            macros.indexOf("2 portions for you"),
        );
        expect(
            renderRecipeDetailBody({ ...viewBase, portionCount: 1 }),
        ).toContain("1 portion for you");
        expect(renderRecipeDetailBody({ ...viewBase })).not.toContain(
            "for you",
        );
    });

    test("an ingredient in two places says both", () => {
        const line = (name: string) => ({
            ingredientId: "ing1",
            displayName: "Flour",
            amountLabel: name,
            expiresOn: null,
        });
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [FLOUR],
            ingredientGroups: [
                { placeId: "a", placeName: "Pantry", lines: [line("200 g")] },
                { placeId: "b", placeName: "Fridge", lines: [line("200 g")] },
            ],
        });
        expect(html).toContain("Pantry, Fridge");
    });

    test("no ingredients says so", () => {
        expect(renderRecipeDetailBody({ ...viewBase })).toContain(
            "No ingredients yet.",
        );
    });

    test("Per serving shows four tiles, and a figure the recipe cannot give is a dash", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            macrosPerPortion: { ...MACROS, carbs_g: null },
        });
        expect(html).toContain("fd-recipe-macro-tiles");
        expect(html).toContain("Per serving");
        const tiles = first(html, /<dl class="fd-tiles[\s\S]*?<\/dl>/);
        expect(tiles).toContain("Carbs");
        expect(tiles.match(/—/g)).toHaveLength(1);
        expect(tiles).toContain("Protein");
    });

    test("incomplete macros show their reasons under dashed tiles", () => {
        const macros: RecipeMacros = {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: true,
        };
        const html = renderRecipeDetailBody({
            ...viewBase,
            macrosPerPortion: macros,
            gapReasons: ["Buttermilk: set grams per millilitre"],
        });
        expect(html).toContain("grams per millilitre");
        expect(html).toContain("fd-recipe-caption--warn");
        expect(
            first(html, /<dl class="fd-tiles[\s\S]*?<\/dl>/).match(/—/g),
        ).toHaveLength(4);
    });
});

describe("a draft's page", () => {
    const draft = {
        problems: ["Add the steps.", "Resolve every ingredient line."],
        expiresOn: "2026-12-01",
        canSave: true,
        canDiscard: true,
    };
    const draftRecipe: Recipe = { ...RECIPE, verification: "unverified" };

    test("the draft bar is Save and how many things are left, in place of Plan and Cook", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft,
            // A draft never gets these, even when the loader passes them.
            cook: COOK,
            plan: PLAN,
            share: {},
        });
        const bar = first(
            html,
            /<div class="fd-recipe-bar fd-recipe-bar--draft"[\s\S]*?<\/form><\/div>/,
        );
        expect(bar).toContain('action="/recipes/r1/save"');
        expect(bar).toContain(">Save<");
        expect(bar).toContain("2 things to fix");
        expect(html).not.toContain("fd-recipe-cook-sheet");
        expect(html).not.toContain("fd-recipe-plan-sheet");
        expect(html).not.toContain("fd-recipe-share-sheet");
        expect(html).not.toContain(">Plan<");
        expect(html).not.toContain(">Cook<");
        expect(html).not.toContain("Add to list");
        expect(html).not.toContain("Share");
        expect(html).not.toContain("favourites");
    });

    test("it names what is left, when it goes, and says Draft under the title", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft,
        });
        const card = first(
            html,
            /<section class="fd-recipe-draft"[\s\S]*?<\/section>/,
        );
        expect(card).toContain("Add the steps.");
        expect(card).toContain("Resolve every ingredient line.");
        expect(card).toContain("deleted on Tue 1 Dec unless you save it");
        expect(html).toContain("Draft · 4 servings");
    });

    test("one thing left, or none, reads right", () => {
        const one = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft: { ...draft, problems: ["Add the steps."] },
        });
        expect(one).toContain("1 thing to fix");
        const ready = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft: { ...draft, problems: [] },
        });
        expect(ready).toContain("Ready to save");
        expect(ready).toContain("It passes the check and is ready to save.");
    });

    test("Discard is a ⋯ item that confirms in place, only for who may discard", () => {
        const mine = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft,
        });
        const bar = first(
            mine,
            /<header class="fd-detail-bar[\s\S]*?<\/header>/,
        );
        expect(bar).toContain("Discard draft");
        expect(bar).toContain('action="/recipes/r1/discard"');
        const theirs = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft: { ...draft, canDiscard: false },
        });
        expect(theirs).not.toContain("Discard");
        expect(theirs).not.toContain("/recipes/r1/discard");
    });

    test("someone who may not save sees no Save", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft: { ...draft, canSave: false },
        });
        expect(html).not.toContain("/recipes/r1/save");
        expect(html).not.toContain("fd-recipe-bar");
    });

    test("a refused Save shows its reason on the page, in place", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: draftRecipe,
            draft,
            error: "Not saved yet. Fix what is listed below, then save it again.",
        });
        expect(html).toContain('role="alert">Not saved yet.');
    });

    test("no screen says unverified", () => {
        const pages = [
            renderRecipeDetailBody({
                ...viewBase,
                recipe: draftRecipe,
                draft,
            }),
            renderRecipeDetailBody({
                ...viewBase,
                recipe: { ...RECIPE, verification: "verified" },
                cook: COOK,
                plan: PLAN,
                share: {},
            }),
        ];
        for (const html of pages) {
            expect(html.toLowerCase()).not.toContain("unverified");
        }
    });

    test("a saved recipe never shows the draft bar, or Save", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            cook: COOK,
            plan: PLAN,
        });
        expect(html).not.toContain("fd-recipe-draft");
        expect(html).not.toContain("/save");
    });
});

describe("the steps-mention warnings on the recipe page", () => {
    const STEPS = [
        "Boil the pot.",
        "Push them aside, pour in the lightly beaten egg and scramble.",
    ].join("\n");
    const recipe: Recipe = { ...RECIPE, instructions: STEPS };
    const mentions = () =>
        findMissingMentions({
            instructions: STEPS,
            ingredients: [],
            vocabulary: [],
        }).filter((w) => w.key === "egg");
    const view = (over: Record<string, unknown> = {}) => ({
        ...viewBase,
        recipe,
        ...over,
    });

    test("a warning is a card at the top of Ingredients with Dismiss and Add", () => {
        const html = renderRecipeDetailBody(
            view({
                mentions: mentions(),
                ingredients: [
                    {
                        id: "i1",
                        foodId: "food-noodles",
                        displayName: "Wide rice noodles",
                        quantity: { amount: 7, unit: "oz" },
                        note: null,
                    },
                ],
                ingredientGroups: [
                    {
                        placeId: RECIPE_NOT_IN_STOCK_ID,
                        placeName: "Not in stock",
                        lines: [
                            {
                                ingredientId: "i1",
                                displayName: "Wide rice noodles",
                                amountLabel: "7 oz",
                                expiresOn: null,
                            },
                        ],
                    },
                ],
            }),
        );
        const card = first(
            html,
            /<div class="fd-card fd-mention-card"[\s\S]*?<\/form><\/div><\/div><\/div>/,
        );
        expect(card).toContain(">Steps mention egg</p>");
        expect(card).toContain(
            '<span class="fd-mention-mark">egg</span> and scramble',
        );
        expect(card).toContain('action="/recipes/r1/mentions/add"');
        expect(card).toContain('action="/recipes/r1/mentions/dismiss"');
        expect(card.match(/name="key" value="egg"/g)).toHaveLength(2);
        expect(card).toContain(">Add egg</span>");
        expect(card).toContain(">Dismiss</span>");
        // Dismiss first, Add (the primary) last.
        expect(card.indexOf("Dismiss")).toBeLessThan(card.indexOf("Add egg"));
        // Under the title and its subtitle, above the tiles and the ingredients.
        expect(html.indexOf("fd-mention-card")).toBeGreaterThan(
            html.indexOf("fd-recipe-head"),
        );
        expect(html.indexOf("fd-mention-card")).toBeLessThan(
            html.indexOf("fd-recipe-macros"),
        );
        expect(html.indexOf("fd-mention-card")).toBeLessThan(
            html.indexOf("Wide rice noodles"),
        );
    });

    test("the same food is underlined in its step and only there", () => {
        const html = renderRecipeDetailBody(view({ mentions: mentions() }));
        const steps = first(html, /<ol class="fd-recipe-steps">[\s\S]*?<\/ol>/);
        const items = [...steps.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(
            (m) => m[1],
        );
        expect(items).toEqual([
            "Boil the pot.",
            'Push them aside, pour in the lightly beaten <span class="fd-mention-mark">egg</span> and scramble.',
        ]);
    });

    test("no warnings means no card and plain steps", () => {
        for (const given of [undefined, []]) {
            const html = renderRecipeDetailBody(view({ mentions: given }));
            expect(html).not.toContain("fd-mention");
            expect(html).toContain("<li>Boil the pot.</li>");
        }
    });

    test("a warning card shows even when the recipe lists no ingredients yet", () => {
        const html = renderRecipeDetailBody(
            view({ mentions: mentions(), ingredientGroups: [] }),
        );
        expect(html).toContain("fd-mention-card");
        expect(html).toContain("No ingredients yet.");
    });

    test("food names and excerpts are escaped", () => {
        const [egg] = mentions();
        const hostile = {
            ...egg!,
            food: '<img src=x onerror="a">',
            key: '"><script>x</script>',
            excerpt: "<b>bold</b> egg",
            excerptStart: 12,
            excerptEnd: 15,
            message: "<i>hi</i>",
        };
        const html = renderRecipeDetailBody(view({ mentions: [hostile] }));
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain("<b>bold</b>");
        expect(html).toContain(
            '&lt;b&gt;bold&lt;/b&gt; <span class="fd-mention-mark">egg</span>',
        );
    });

    test("a step with a non-normalized accent is still cut at the mention", () => {
        const steps = "Fold in the jalapen\u0303o and the egg.";
        const found = findMissingMentions({
            instructions: steps,
            ingredients: [],
            vocabulary: [],
        }).filter((w) => w.key === "egg");
        const html = renderRecipeDetailBody(
            view({
                recipe: { ...RECIPE, instructions: steps },
                mentions: found,
            }),
        );
        expect(html).toContain('the <span class="fd-mention-mark">egg</span>.');
    });
});

describe("the whose-version pull-down", () => {
    const people = [
        { userId: "u-ethan", name: "Ethan" },
        { userId: "u-mia", name: "Mia" },
    ];
    const picker = (over: Partial<RecipeVersionPicker> = {}) => ({
        viewerId: "u-ethan",
        viewing: "u-ethan",
        viewingName: "Ethan",
        changeCount: 1,
        people,
        canCompare: true,
        ...over,
    });
    const render = (over: Partial<RecipeVersionPicker> = {}) =>
        renderRecipeDetailBody({ ...viewBase, versions: picker(over) });
    const panel = (html: string) =>
        first(
            html,
            /<div class="fd-menu__panel" role="menu" aria-label="Whose version"[\s\S]*?<\/div><\/div>/,
        );
    const labels = (html: string) =>
        [...html.matchAll(/<span class="fd-menu__label">([^<]*)<\/span>/g)].map(
            (m) => m[1],
        );

    test("without versions the caption is plain words", () => {
        const html = renderRecipeDetailBody({ ...viewBase });
        expect(html).toContain('<p class="fd-recipe-caption">Per serving</p>');
        expect(html).not.toContain("fd-recipe-version");
    });

    test("the caption is a Link button naming whose version and how far it departs", () => {
        const html = render();
        const trigger = first(
            html,
            /<button type="button" class="[^"]*fd-btn--link[^"]*"[^>]*data-fd-menu-trigger[\s\S]*?<\/button>/,
        );
        expect(trigger).toContain("fd-btn--link");
        expect(trigger).toContain("fd-icon--users");
        expect(trigger).toContain("Per serving · Ethan · 1 change from base");
        expect(trigger).toContain('aria-haspopup="menu"');
        expect(render({ changeCount: 2 })).toContain("2 changes from base");
        // A version that is the base says only whose it is.
        expect(render({ changeCount: 0 })).toContain("Per serving · Ethan<");
        expect(
            render({ viewing: "base", viewingName: "Base", changeCount: 0 }),
        ).toContain("Per serving · Base<");
    });

    test("the menu lists Base and every person, ticks the one shown, and links to each", () => {
        const html = render();
        expect(labels(panel(html))).toEqual([
            "Base",
            "Ethan",
            "Mia",
            "Compare versions",
        ]);
        const menu = panel(html);
        expect(menu).toContain('href="/recipes/r1?member=base"');
        // The viewer's own version is the page's plain address.
        expect(menu).toContain('href="/recipes/r1"');
        expect(menu).toContain('href="/recipes/r1?member=u-mia"');
        expect(menu).toContain('href="/recipes/r1/compare"');
        expect(menu.match(/aria-checked="true"/g)).toHaveLength(1);
        const ticked = (markup: string) =>
            markup
                .split("<a ")
                .filter((item) => item.includes('aria-checked="true"'))
                .map((item) => labels(item)[0]);
        expect(ticked(menu)).toEqual(["Ethan"]);
        expect(
            ticked(
                panel(
                    render({
                        viewing: "base",
                        viewingName: "Base",
                        changeCount: 0,
                    }),
                ),
            ),
        ).toEqual(["Base"]);
    });

    test("Compare versions is only there for who may compare", () => {
        const html = render({ canCompare: false });
        expect(labels(panel(html))).toEqual(["Base", "Ethan", "Mia"]);
        expect(html).not.toContain("/compare");
    });

    test("a line the version changed says who changed it and what it was", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [
                { ...FLOUR, versionNote: "Yours · base 6 oz" },
                BUTTERMILK,
            ],
            versions: picker(),
        });
        expect(html).toContain("Yours · base 6 oz · Not in stock");
        // The other line has no note.
        expect(html.match(/base 6 oz/g)).toHaveLength(1);
    });

    test("the portions line names whose portions it counts", () => {
        const others = renderRecipeDetailBody({
            ...viewBase,
            portionCount: 2,
            versions: picker({ viewing: "u-mia", viewingName: "Mia" }),
        });
        expect(others).toContain("2 portions for Mia");
        expect(render()).not.toContain("for Mia");
        expect(
            renderRecipeDetailBody({
                ...viewBase,
                portionCount: 2,
                versions: picker(),
            }),
        ).toContain("2 portions for you");
    });

    test("ingredientVersionNote says what the line was in the base", () => {
        const base = {
            displayName: "Chicken breast",
            quantity: { amount: 6, unit: "oz" } as const,
        };
        expect(ingredientVersionNote("Yours", "amount", base)).toBe(
            "Yours · base 6 oz",
        );
        expect(ingredientVersionNote("Mia's", "food", base)).toBe(
            "Mia's · base Chicken breast 6 oz",
        );
        expect(ingredientVersionNote("Yours", "add", undefined)).toBe(
            "Yours · not in base",
        );
        expect(
            ingredientVersionNote("Yours", "amount", {
                displayName: "Salt",
                quantity: null,
            }),
        ).toBe("Yours · base to taste");
    });

    test("the cook sheet carries the version it cooks", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            cook: { ...COOK, version: "u-mia" },
            plan: PLAN,
        });
        expect(html).toContain(
            'data-fd-cook-preview-url="/recipes/r1/cook/preview/u-mia"',
        );
        expect(html).toContain(
            '<input type="hidden" name="version" value="u-mia">',
        );
        const base = renderRecipeDetailBody({
            ...viewBase,
            cook: COOK,
            plan: PLAN,
        });
        expect(base).toContain(
            'data-fd-cook-preview-url="/recipes/r1/cook/preview"',
        );
        expect(base).not.toContain('name="version"');
    });
});
