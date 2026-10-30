import { expect, test } from "bun:test";
import type { Recipe } from "../../domain/recipes.js";
import { renderRecipeDetailPage, type RecipeDetailView } from "./recipes.js";

const VIEWER = "11111111-1111-4111-8111-111111111111";

function detail(recipe: Partial<Recipe>): RecipeDetailView {
    return {
        chrome: { theme: "light" },
        recipe: {
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
            ...recipe,
        },
        ingredients: [],
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
        },
        isOwner: true,
    };
}

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

test("a failed steps save reopens the Method modal", () => {
    const html = renderRecipeDetailPage({
        ...detail({}),
        error: "Instructions is too long.",
        openModalId: "recipe-method-r1",
    });
    expect(html).toMatch(/id="recipe-method-r1"[^>]*data-modal-open-on-load/);
});
