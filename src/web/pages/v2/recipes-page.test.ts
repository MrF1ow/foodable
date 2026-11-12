import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
import type { Recipe, RecipeMacros } from "../../../domain/recipes.js";
import {
    groupRecipeIngredientsByPlace,
    RECIPE_NOT_IN_STOCK_ID,
    renderRecipeDetailBody,
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
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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

describe("renderRecipeDetailBody", () => {
    const viewBase = {
        chrome,
        recipe: RECIPE,
        ingredients: [],
        ingredientGroups: [],
        macrosPerPortion: {
            calories: 200,
            protein_g: 8,
            carbs_g: 30,
            fat_g: 5,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: false,
        },
        gapReasons: [],
        members: [{ userId: "u1", displayName: "Alice" }],
        viewerId: "u1",
        portionCount: 2,
    };

    const cook = {
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
        macrosPerPortion: viewBase.macrosPerPortion,
        submitKey: "k1",
    };

    test("Cook opens the cook sheet instead of an inline form", () => {
        const html = renderRecipeDetailBody({ ...viewBase, cook });
        expect(html).toContain(
            'commandfor="fd-recipe-cook-sheet" command="show-modal"',
        );
        expect(html).toContain('id="fd-recipe-cook-sheet"');
        expect(html).toContain('action="/recipes/r1/cook/confirm"');
        expect(html).not.toContain('action="/recipes/r1/cook"');
        expect(html).not.toContain('name="portion:u1"');
        expect(html).toContain('id="fd-recipe-cook-heading"');
        expect(html).toContain("fd-recipe-macro-tiles");
        expect(html).toContain("fd-recipe-macros-kicker");
        expect(html).toContain("Per serving");
        expect(html).toContain('id="fd-recipe-method-heading">Steps</');
        expect(html).toContain("fd-recipe-back__btn");
        expect(html).toContain("fd-dot--protein");
    });

    test("the header actions run Share, Add to plan, Cook, with Cook last", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            cook,
            plan: {
                recipeId: "r1",
                recipeName: "Pancakes",
                yieldPortions: 4,
                today: "2026-11-12",
                date: "2026-11-12",
                slot: "dinner",
                servings: 4,
            },
        });
        const row = html.match(
            /<div class="fd-recipe-actions"[\s\S]*?<\/div>/,
        )![0];
        const share = row.indexOf('commandfor="fd-recipe-share-sheet"');
        const plan = row.indexOf("fd-recipe-plan-sheet");
        const cookAt = row.indexOf('commandfor="fd-recipe-cook-sheet"');
        expect(share).toBeGreaterThan(-1);
        expect(plan).toBeGreaterThan(share);
        expect(cookAt).toBeGreaterThan(plan);
    });

    test("Share opens a sheet that posts to this recipe's share route", () => {
        const html = renderRecipeDetailBody({ ...viewBase });
        expect(html).toContain(
            'commandfor="fd-recipe-share-sheet" command="show-modal"',
        );
        expect(html).toContain('id="fd-recipe-share-sheet"');
        expect(html).toContain('action="/recipes/r1/share"');
        expect(html).toContain("Share recipe");
    });

    test("a refused share shows its error in the open sheet, not above the page", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            error: "Choose how long the link should work.",
            share: { open: true },
        });
        expect(html).toContain('id="fd-recipe-share-sheet"');
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).not.toContain("fd-recipe-error");
        expect(
            html.split("Choose how long the link should work.").length - 1,
        ).toBe(1);
    });

    test("without a cook view there is no Cook button or sheet", () => {
        const html = renderRecipeDetailBody({ ...viewBase });
        expect(html).not.toContain("fd-recipe-cook-sheet");
        expect(html).not.toContain("fd-recipe-cook-btn");
    });

    test("the star sits in the back row, outside the heading, and posts back to the recipe", () => {
        const html = renderRecipeDetailBody({ ...viewBase });
        const form = html.match(/<form[^>]*fd-star-form[\s\S]*?<\/form>/)![0];
        expect(form).toContain('action="/recipes/r1/favourite"');
        expect(form).toContain('name="on" value="1"');
        expect(form).toContain('name="back" value="recipe"');
        expect(form).toContain('aria-label="Add Pancakes to favourites"');
        expect(form).not.toContain("fd-star--on");
        const back = html.match(/<p class="fd-recipe-back">[\s\S]*?<\/p>/);
        expect(back?.[0] ?? "").not.toContain("<form");
        expect(html.indexOf("fd-recipe-back")).toBeLessThan(
            html.indexOf("fd-star-form"),
        );
        expect(html.indexOf("fd-star-form")).toBeLessThan(
            html.indexOf("fd-recipe-title"),
        );
    });

    test("a starred recipe shows a filled star that removes itself", () => {
        const html = renderRecipeDetailBody({ ...viewBase, favourite: true });
        const form = html.match(/<form[^>]*fd-star-form[\s\S]*?<\/form>/)![0];
        expect(form).toContain('name="on" value="0"');
        expect(form).toContain('aria-label="Remove Pancakes from favourites"');
        expect(form).toContain("fd-star--on");
    });

    test("incomplete macros show missing-factor copy", () => {
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
            chrome,
            recipe: RECIPE,
            ingredients: [],
            ingredientGroups: [
                {
                    placeId: RECIPE_NOT_IN_STOCK_ID,
                    placeName: "Not in stock",
                    lines: [
                        {
                            ingredientId: "ing1",
                            displayName: "Buttermilk",
                            amountLabel: "200 ml",
                            expiresOn: null,
                        },
                    ],
                },
            ],
            macrosPerPortion: macros,
            gapReasons: ["Buttermilk: set grams per millilitre"],
            members: [{ userId: "u1", displayName: "Alice" }],
            viewerId: "u1",
            portionCount: 1,
        });
        expect(html).toContain("Macros incomplete per portion");
        expect(html).toContain("grams per millilitre");
        expect(html).toContain("Not in stock");
    });
});
