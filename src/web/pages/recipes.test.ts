import { expect, test } from "bun:test";
import type { Recipe } from "../../domain/recipes.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
    type RecipeDetailView,
} from "./recipes.js";

const VIEWER = "11111111-1111-4111-8111-111111111111";

function emptyNoticeCtx(recipeId: string): RecipeDetailView["noticeContext"] {
    return { from: `/recipes/${recipeId}`, foods: new Map() };
}

function detail(recipe: Partial<Recipe>): RecipeDetailView {
    const mergedRecipe = {
        id: "r1",
        householdId: "hh-1",
        creatorId: VIEWER,
        name: "Pasta",
        yieldPortions: 2,
        instructions: null,
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "verified" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...recipe,
    };
    return {
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipe: mergedRecipe,
        ingredients: [],
        notices: [],
        noticeContext: emptyNoticeCtx(mergedRecipe.id),
        members: [{ userId: VIEWER, displayName: "Alice" }],
        stores: [],
        viewerId: VIEWER,
        filterUserId: VIEWER,
        portionCount: 1,
        macros: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: true,
            incompleteReasons: [],
            gaps: [],
        },
        isOwner: true,
    };
}

test("incomplete macros render reasons in recipe-macros-reasons", () => {
    const sentence =
        "Half and half: no nutrition — add it, or pick a usual product";
    const notices = [
        {
            code: "recipe.no_nutrition" as const,
            severity: "warn" as const,
            subject: {
                kind: "recipe_ingredient" as const,
                id: "ing1",
                recipeId: "r1",
            },
            related: [],
            params: { name: "Half and half", foodId: "f-half" },
        },
    ];
    const html = renderRecipeDetailPage({
        ...detail({}),
        notices,
        macros: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: true,
            incompleteReasons: [sentence],
            gaps: [],
        },
        macrosPerPortion: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: true,
            incompleteReasons: [sentence],
            gaps: [],
        },
    });
    expect(html).toContain("recipe-macros-reasons");
    expect(html).toContain(sentence);
});

test("recipe.no_nutrition renders usual-product link from notices", () => {
    const notices = [
        {
            code: "recipe.no_nutrition" as const,
            severity: "warn" as const,
            subject: {
                kind: "recipe_ingredient" as const,
                id: "ing-buttermilk",
                recipeId: "r1",
            },
            related: [],
            params: { name: "Buttermilk", foodId: "f-buttermilk" },
        },
    ];
    const foods = new Map([["f-buttermilk", { genericFoodId: null }]]);
    const html = renderRecipeDetailPage({
        ...detail({}),
        notices,
        noticeContext: { from: "/recipes/r1", foods },
        ingredients: [
            {
                id: "ing-buttermilk",
                recipeId: "r1",
                householdId: "hh-1",
                kind: "food" as const,
                displayName: "Buttermilk",
                quantity: { amount: 200, unit: "ml" },
                foodId: "f-buttermilk",
                sortOrder: 0,
                note: null,
                perPortionAmount: 20,
                personAmount: 20,
            },
        ],
        macros: {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            incomplete: true,
            incompleteReasons: [
                "Buttermilk: no nutrition — add it, or pick a usual product",
            ],
            gaps: [],
        },
    });
    expect(html).toContain(
        '<p class="recipe-ingredient-usual"><a href="/household/usual-products/f-buttermilk?from=%2Frecipes%2Fr1">Pick usual product</a></p>',
    );
});

test("a recipe without steps offers to add them", () => {
    const html = renderRecipeDetailPage(detail({}));
    expect(html).toContain('class="empty-recipe-steps"');
    expect(html).toContain('commandfor="recipe-method-r1"');
    expect(html).toContain(">Add steps</button>");
    expect(html).toContain('action="/recipes/r1/instructions"');
});

test("steps render as a numbered list and edit in their own form", () => {
    const html = renderRecipeDetailPage(
        detail({
            instructions: "1. Boil <water>\n2. Add pasta",
            notes: "Kids like it",
        }),
    );
    expect(html).toContain(
        '<ol class="recipe-steps"><li>Boil &lt;water&gt;</li><li>Add pasta</li></ol>',
    );
    expect(html).toContain(">Edit steps</button>");
    expect(html).toContain("Kids like it");
    // The general edit form must not post instructions, or saving it would
    // overwrite the steps.
    const editForm = html.slice(
        html.indexOf('<form class="recipe-edit"'),
        html.indexOf("</form>", html.indexOf('<form class="recipe-edit"')),
    );
    expect(editForm).not.toContain('name="instructions"');
});

test("ingredient dialog count does not grow with the list", () => {
    const dialogs = (count: number) => {
        const html = renderRecipeDetailPage({
            ...detail({}),
            ingredients: Array.from({ length: count }, (_, i) => ({
                id: `ing${i}`,
                recipeId: "r1",
                foodId: `f${i}`,
                displayName: `Item ${i}`,
                quantity: { amount: i + 1, unit: "g" },
                note: null,
                sortOrder: i,
                perPortionAmount: i + 1,
                personAmount: i + 1,
            })) as RecipeDetailView["ingredients"],
        });
        return (html.match(/<dialog/g) ?? []).length;
    };
    expect(dialogs(2)).toBe(dialogs(20));
    expect(dialogs(20)).toBe(7);
});

test("a failed steps save reopens the Method modal", () => {
    const html = renderRecipeDetailPage({
        ...detail({}),
        error: "Instructions is too long.",
        openModalId: "recipe-method-r1",
    });
    expect(html).toMatch(/id="recipe-method-r1"[^>]*data-modal-open-on-load/);
});

test("recipes list shows verification filter and unverified badge", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [
            {
                id: "r-open",
                householdId: "hh-1",
                creatorId: VIEWER,
                name: "Draft soup",
                yieldPortions: 2,
                instructions: null,
                sourceUrl: null,
                tags: [],
                notes: null,
                prepMinutes: null,
                cookMinutes: null,
                verification: "unverified",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
        members: [{ userId: VIEWER, displayName: "Alice" }],
        viewerId: VIEWER,
        filter: {
            tag: "",
            canMakeNow: false,
            safeFor: "",
            verification: "unverified",
        },
    });
    expect(html).toContain("Unverified");
    expect(html).toContain("recipe-verification-filter");
    expect(html).toContain("Draft soup");
});

test("unverified recipe detail shows problems panel and check again", () => {
    const html = renderRecipeDetailPage({
        ...detail({ verification: "unverified", name: "Import" }),
        problems: [
            {
                code: "no_instructions",
                message: "Add the steps.",
                ingredientId: null,
                line: null,
            },
        ],
        importRow: {
            recipeId: "r1",
            householdId: "hh-1",
            sourceKind: "text",
            sourceUrl: null,
            sourceText: "Raw paste",
            sourceTextOrigin: "pasted",
            transcript: null,
            credit: null,
            unresolvedLines: [],
            problems: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        },
    });
    expect(html).toContain("Unverified");
    expect(html).toContain("Add the steps.");
    expect(html).toContain("Pasted text");
    expect(html).toContain('action="/recipes/r1/verify"');
});

test("unmeasured recipe ingredient renders to taste", () => {
    const html = renderRecipeDetailPage({
        ...detail({}),
        ingredients: [
            {
                id: "ing-salt",
                householdId: "hh-1",
                recipeId: "r1",
                kind: "food",
                foodId: "f-salt",
                displayName: "Salt",
                quantity: null,
                note: "to taste",
                sortOrder: 0,
                perPortionAmount: null,
                personAmount: null,
            },
        ],
    });
    expect(html).toContain("Total to taste");
    expect(html).toContain('placeholder="to taste"');
});
