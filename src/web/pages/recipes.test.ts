import { join } from "node:path";
import { expect, test } from "bun:test";
import type { Recipe } from "../../domain/recipes.js";
import {
    IMPORT_RECIPE_MODAL_ID,
    recipesListHref,
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

test("verification segment links keep list filters", () => {
    const filter = {
        tag: "dinner",
        canMakeNow: true,
        safeFor: VIEWER,
        verification: "verified" as const,
    };
    expect(recipesListHref("unverified", filter)).toBe(
        `/recipes?tag=dinner&can_make_now=1&safe_for=${encodeURIComponent(VIEWER)}&verification=unverified`,
    );
    expect(recipesListHref("", filter)).toBe(
        `/recipes?tag=dinner&can_make_now=1&safe_for=${encodeURIComponent(VIEWER)}`,
    );
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [{ userId: VIEWER, displayName: "Alice" }],
        viewerId: VIEWER,
        filter,
    });
    expect(html).toContain(
        `href="/recipes?tag=dinner&can_make_now=1&safe_for=${VIEWER}&verification=unverified"`,
    );
    expect(html).toContain('name="verification"');
    expect(html).toContain('value="verified"');
});

test("recipes list shows verification filter and unverified badge", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [
            {
                id: "r-open",
                householdId: "hh-1",
                creatorId: VIEWER,
                name: "Imported soup",
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
    expect(html).toContain("Imported soup");
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

test("import from link modal field and busy submit attributes", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
    });
    expect(html).toContain('commandfor="recipe-import-url"');
    expect(html).toContain("Import from link");
    expect(html).toContain('id="import-url"');
    expect(html).toContain("data-busy-form");
    expect(html).toContain('data-busy-label="Importing…"');
    expect(html).toContain(`id="${IMPORT_RECIPE_MODAL_ID}"`);
});

test("import modal keeps url and shows error on 422 re-render", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        openModalId: IMPORT_RECIPE_MODAL_ID,
        importUrl: "https://example.com/x",
        importError: "That doesn't look like a web link.",
    });
    expect(html).toMatch(
        new RegExp(
            `id="${IMPORT_RECIPE_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
    expect(html).toContain('value="https://example.com/x"');
    expect(html).toContain("That doesn't look like a web link.");
});

test("import paste step shows caption field and creator for Instagram", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        openModalId: IMPORT_RECIPE_MODAL_ID,
        importPasteStep: true,
        importUrl: "https://www.instagram.com/p/abc/",
        importSourceKind: "instagram",
        importSourceLabel: "Instagram",
        importError: "Paste the Instagram caption below.",
    });
    expect(html).toContain("Paste the Instagram caption below.");
    expect(html).toContain("Open the post");
    expect(html).toContain('name="text"');
    expect(html).toContain('name="credit"');
    expect(html).toContain('name="import_step"');
    expect(html).toContain("recipe-import-paste");
});

test("import paste step for Pinterest lists website link first", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        importPasteStep: true,
        importUrl: "https://www.pinterest.com/pin/1/",
        importSourceKind: "pinterest",
        importSourceLabel: "Pinterest",
    });
    expect(html).toContain("Recipe website link");
    expect(html).toContain('name="website_url"');
    expect(html).toContain("Or paste the recipe");
});

test("website failure paste step uses Paste the recipe label", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        importPasteStep: true,
        importUrl: "https://example.com/no-json",
        importSourceKind: "website",
        importSourceLabel: "example.com",
        importError:
            "This page doesn't publish its recipe in a form we can read. Paste the recipe instead.",
    });
    expect(html).toContain("Paste the recipe");
    expect(html).toContain("Open the page");
    expect(html).not.toContain('name="credit"');
});

test("import paste step uses cleaned https link for open post", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        openModalId: IMPORT_RECIPE_MODAL_ID,
        importPasteStep: true,
        importUrl: "https://instagram.com/p/abc",
        importSourceKind: "instagram",
        importSourceLabel: "Instagram",
    });
    expect(html).toContain('href="https://instagram.com/p/abc"');
    expect(html).toContain('value="https://instagram.com/p/abc"');
});

test("no_recipe_in_text re-render keeps pasted text", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        importPasteStep: true,
        importUrl: "https://www.instagram.com/p/x/",
        importSourceKind: "instagram",
        importSourceLabel: "Instagram",
        importPasteText: "Still empty caption",
    });
    expect(html).toContain("Still empty caption");
});

test("duplicate import shows open link in modal", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        openModalId: IMPORT_RECIPE_MODAL_ID,
        importDuplicateRecipeId: "r-dup",
    });
    expect(html).toContain("You already imported this.");
    expect(html).toContain('href="/recipes/r-dup"');
});

test("recipe list shows source icon when import row exists", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [
            {
                id: "r-web",
                householdId: "hh-1",
                creatorId: VIEWER,
                name: "Web soup",
                yieldPortions: 4,
                instructions: null,
                sourceUrl: "https://example.com/soup",
                tags: [],
                notes: null,
                prepMinutes: null,
                cookMinutes: null,
                verification: "verified",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
        members: [],
        viewerId: VIEWER,
        importByRecipeId: {
            "r-web": {
                recipeId: "r-web",
                sourceKind: "website",
                sourceUrl: "https://example.com/soup",
            },
        },
    });
    expect(html).toContain("recipe-source-icon");
});

test("recipe detail links source with credit", () => {
    const html = renderRecipeDetailPage({
        ...detail({
            sourceUrl: "https://example.com/soup",
        }),
        importRow: {
            recipeId: "r1",
            householdId: "hh-1",
            sourceKind: "website",
            sourceUrl: "https://example.com/soup",
            sourceText: null,
            sourceTextOrigin: null,
            transcript: null,
            credit: "Chef Pat",
            unresolvedLines: [],
            problems: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        },
    });
    expect(html).toContain("recipe-source-line");
    expect(html).toMatch(
        /<a[^>]+href="https:\/\/example\.com\/soup"[^>]*>[\s\S]*aria-hidden="true"/,
    );
    expect(html).not.toMatch(
        /recipe-source-line[\s\S]*aria-label="example\.com"[\s\S]*<a/,
    );
    expect(html).toContain("by Chef Pat");
});

test("recipe list source icon is labelled and does not capture clicks above the title link", async () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [
            {
                id: "r-web",
                householdId: "hh-1",
                creatorId: VIEWER,
                name: "Web soup",
                yieldPortions: 4,
                instructions: null,
                sourceUrl: "https://example.com/soup",
                tags: [],
                notes: null,
                prepMinutes: null,
                cookMinutes: null,
                verification: "verified",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
        members: [],
        viewerId: VIEWER,
        importByRecipeId: {
            "r-web": {
                recipeId: "r-web",
                sourceKind: "website",
                sourceUrl: "https://example.com/soup",
            },
        },
    });
    expect(html).toContain("recipe-source-icon-wrap");
    expect(html).toContain('aria-label="example.com"');
    const css = await Bun.file(
        join(import.meta.dir, "../../../public/app/app.css"),
    ).text();
    const wrapRule =
        css.match(/\.recipe-source-icon-wrap\s*\{[^}]+\}/)?.[0] ?? "";
    expect(wrapRule).toContain("pointer-events: none");
    expect(wrapRule).not.toContain("z-index");
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

test("a read import shows its caption and spoken transcript", () => {
    const html = renderRecipeDetailPage({
        ...detail({ verification: "unverified", name: "Pasta" }),
        problems: [],
        importRow: {
            recipeId: "r1",
            householdId: "hh-1",
            sourceKind: "tiktok",
            sourceUrl: "https://www.tiktok.com/@a/video/1",
            sourceText: "Pasta night",
            sourceTextOrigin: "read",
            transcript: "two cups of pasta <then> butter",
            credit: null,
            unresolvedLines: [],
            problems: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        },
    });
    expect(html).toContain("<summary>Caption</summary>");
    expect(html).not.toContain("Pasted text");
    expect(html).toContain("Spoken transcript");
    expect(html).toContain("two cups of pasta &lt;then&gt; butter");
});

test("check again submits the import form on screen with the typed text", () => {
    const html = renderRecipesPage({
        chrome: { theme: "light", attention: { count: 0, tabs: {} } },
        recipes: [],
        members: [],
        viewerId: VIEWER,
        openModalId: "recipe-import-url",
        importUrl: "https://example.com/soup",
        importError:
            "This site refused Foodable recently. Paste the recipe instead.",
        importPasteStep: true,
        importPasteText: "my typed recipe",
        importShowRetry: true,
        importSourceKind: "website",
        importSourceLabel: "example.com",
    } as never);
    expect(html).toContain('id="recipe-import-form"');
    expect(html).toMatch(
        /<button type="submit" form="recipe-import-form" name="retry" value="1" formnovalidate/,
    );
    expect(html).not.toContain("recipe-import-retry-form");
    expect(html).toContain("my typed recipe");
});

test("each unresolved import line can be marked handled", () => {
    const html = renderRecipeDetailPage({
        ...detail({ verification: "unverified", name: "Import" }),
        problems: [],
        importRow: {
            recipeId: "r1",
            householdId: "hh-1",
            sourceKind: "website",
            sourceUrl: "https://example.com/soup",
            sourceText: null,
            sourceTextOrigin: null,
            transcript: null,
            credit: null,
            unresolvedLines: ['1 x 400g "tin" tomatoes'],
            problems: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        },
    });
    expect(html).toContain('action="/recipes/r1/unresolved"');
    expect(html).toContain(
        '<input type="hidden" name="line" value="1 x 400g &quot;tin&quot; tomatoes" />',
    );
    expect(html).toContain(">Handled</button>");
});

test("a stored javascript: source never renders as a link", () => {
    const html = renderRecipeDetailPage({
        ...detail({ sourceUrl: "javascript:alert(document.cookie)" }),
        importRow: null,
    });
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain("recipe-source-line");
});
