import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { didYouMeanView } from "../../../domain/foods.js";
import type {
    Recipe,
    RecipeGap,
    RecipeMacros,
} from "../../../domain/recipes.js";
import type { DidYouMeanModal } from "../../components/did-you-mean.js";
import { renderRecipeDetailBody } from "./recipes-page.js";
import {
    ingredientWarnings,
    INGREDIENT_ADD_SHEET_ID,
    ingredientSheetId,
    resolveSheetId,
    warnSheetId,
} from "./recipes-page-ingredients.js";

const RECIPE: Recipe = {
    id: "r1",
    householdId: "hh-1",
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
const DRAFT: Recipe = { ...RECIPE, verification: "unverified" };

const MACROS: RecipeMacros = {
    calories: 300,
    protein_g: 10,
    carbs_g: 40,
    fat_g: 8,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    incomplete: false,
};

const FLOUR = {
    id: "ing1",
    foodId: "food-flour",
    displayName: "Flour",
    foodName: "Flour",
    quantity: { amount: 200, unit: "g" } as const,
    note: "sifted",
};
const AVOCADO = {
    id: "ing2",
    foodId: "food-avocado",
    displayName: "Avocado",
    foodName: "Avocado",
    quantity: { amount: 2, unit: "each" } as const,
    note: null,
};
const SALT = {
    id: "ing3",
    foodId: "food-salt",
    displayName: "Salt",
    foodName: "Salt",
    quantity: null,
    note: "to taste",
    defaultUnit: "g",
};

const NO_NUTRITION: RecipeGap = {
    ingredientId: "ing2",
    displayName: "Avocado",
    foodId: "food-avocado",
    reason: "no_nutrition",
    missingNutrients: [],
    usualProduct: null,
    message: "Avocado: no nutrition — add it, or pick a usual product",
};

const viewBase = {
    chrome: { theme: "light" as const, flags: FIXTURE_APP_CHROME_FLAGS },
    recipe: RECIPE,
    ingredients: [FLOUR, AVOCADO, SALT],
    ingredientGroups: [],
    macrosPerPortion: MACROS,
    editable: true,
};

/** The text of the first element a pattern finds; the test fails when none is. */
function first(html: string, pattern: RegExp): string {
    const found = html.match(pattern);
    expect(found).not.toBeNull();
    return found![0];
}

/** One `<dialog>` by id. */
function dialog(html: string, id: string): string {
    return first(
        html,
        new RegExp(`<dialog [^>]*id="${id}"[\\s\\S]*?</dialog>`),
    );
}

/** The row of the ingredient named `name`. */
function row(html: string, name: string): string {
    const rows = html.split('<li class="fd-item-row').slice(1);
    const found = rows.find((r) =>
        r.includes(`<span class="fd-item-row__title" title="${name}">`),
    );
    expect(found).toBeDefined();
    return found!;
}

describe("an ingredient row on an editable recipe", () => {
    test("opens its edit sheet, shows a chevron and holds no ⋯ of its own", () => {
        const html = renderRecipeDetailBody(viewBase);
        const flour = row(html, "Flour");
        expect(flour).toContain('href="/recipes/r1?ingredient=ing1"');
        expect(flour).toContain(
            `data-fd-open-item="${ingredientSheetId("ing1")}"`,
        );
        expect(flour).toContain("fd-item-row__chevron");
        expect(flour).not.toContain("Actions for Flour");
    });

    test("the sheet's Food field holds the food's own name, not the row title that carries its usual product", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [
                {
                    ...FLOUR,
                    displayName: "Flour · Kirkland Flour",
                    foodName: "Flour",
                },
            ],
        });
        expect(row(html, "Flour · Kirkland Flour")).toContain(
            "Flour · Kirkland Flour",
        );
        const sheet = dialog(html, ingredientSheetId("ing1"));
        expect(sheet).toMatch(/name="food_name"[^>]*value="Flour"/);
        expect(sheet).not.toMatch(/name="food_name"[^>]*Kirkland/);
    });

    test("the sheet edits amount, unit, note and food, and posts to the ingredient's route", () => {
        const html = renderRecipeDetailBody(viewBase);
        const sheet = dialog(html, ingredientSheetId("ing1"));
        expect(sheet).toContain('action="/recipes/r1/ingredients/ing1"');
        expect(sheet).toContain('name="amount"');
        expect(sheet).toContain('value="200"');
        expect(sheet).toContain('name="unit"');
        expect(sheet).toContain("data-fd-menu-field");
        expect(sheet).toContain('value="g" data-fd-menu-field');
        expect(sheet).toContain('name="food_name"');
        expect(sheet).toContain('value="Flour"');
        expect(sheet).toContain('name="note"');
        expect(sheet).toContain('value="sifted"');
        expect(sheet).toContain(">Save<");
        expect(sheet).not.toContain("data-sheet-open-on-load");
    });

    test("its ⋯ opens the food, adds it to the list and removes the line, which confirms in place", () => {
        const html = renderRecipeDetailBody(viewBase);
        const sheet = dialog(html, ingredientSheetId("ing1"));
        expect(sheet).toContain("Open food");
        expect(sheet).toContain("/foods/food-flour");
        expect(sheet).toContain(
            'action="/recipes/r1/ingredients/food-flour/add-to-grocery"',
        );
        expect(sheet).toContain('action="/recipes/r1/ingredients/ing1/remove"');
        expect(sheet).toContain("data-fd-menu-confirm");
    });

    test("a draft's sheet has no Add to grocery list and a food already on the list is not offered again", () => {
        const draft = renderRecipeDetailBody({
            ...viewBase,
            recipe: DRAFT,
            draft: {
                problems: [],
                expiresOn: null,
                canSave: true,
                canDiscard: true,
                leaveGuard: false,
            },
        });
        expect(dialog(draft, ingredientSheetId("ing1"))).not.toContain(
            "add-to-grocery",
        );
        const listed = renderRecipeDetailBody({
            ...viewBase,
            onList: ["food-flour"],
        });
        expect(dialog(listed, ingredientSheetId("ing1"))).not.toContain(
            "add-to-grocery",
        );
        expect(dialog(listed, ingredientSheetId("ing2"))).toContain(
            "add-to-grocery",
        );
    });

    test("a line with no amount opens at 0 in the food's own unit", () => {
        const html = renderRecipeDetailBody(viewBase);
        const sheet = dialog(html, ingredientSheetId("ing3"));
        expect(sheet).toContain('value="0"');
        expect(sheet).toContain('value="g" data-fd-menu-field');
    });

    test("a unit outside the list stays a choice so the form posts it", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [{ ...FLOUR, quantity: { amount: 2, unit: "clove" } }],
        });
        const sheet = dialog(html, ingredientSheetId("ing1"));
        expect(sheet).toContain('value="clove" data-fd-menu-field');
        expect(sheet).toContain('data-fd-menu-value="clove"');
    });

    test("an ingredient with a food nobody linked has no Open food", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            ingredients: [{ ...FLOUR, foodId: null }],
        });
        const sheet = dialog(html, ingredientSheetId("ing1"));
        expect(sheet).not.toContain("Open food");
        expect(sheet).toContain("/remove");
    });
});

describe("Add ingredient", () => {
    test("is an action on the Ingredients header and opens its own sheet", () => {
        const html = renderRecipeDetailBody(viewBase);
        const header = first(
            html,
            /<div class="fd-section-header" id="fd-recipe-ingredients-heading">[\s\S]*?<\/div>/,
        );
        expect(header).toContain('href="/recipes/r1?add=1"');
        expect(header).toContain(
            `data-fd-open-item="${INGREDIENT_ADD_SHEET_ID}"`,
        );
        expect(header).toContain(">Add ingredient<");
        const sheet = dialog(html, INGREDIENT_ADD_SHEET_ID);
        expect(sheet).toContain('action="/recipes/r1/ingredients"');
        expect(sheet).toContain('name="food_name"');
        expect(sheet).toContain('name="amount"');
        expect(sheet).toContain('name="unit"');
        expect(sheet).toContain(">Add<");
    });

    test("an empty recipe can still add its first ingredient", () => {
        const html = renderRecipeDetailBody({ ...viewBase, ingredients: [] });
        expect(html).toContain("No ingredients yet.");
        expect(html).toContain(">Add ingredient<");
        expect(html).toContain(`id="${INGREDIENT_ADD_SHEET_ID}"`);
    });

    test("is not offered when the lines are not editable (a version with changes, or no right to edit)", () => {
        const html = renderRecipeDetailBody({ ...viewBase, editable: false });
        expect(html).not.toContain(">Add ingredient<");
        expect(html).not.toContain(INGREDIENT_ADD_SHEET_ID);
        expect(html).not.toContain(ingredientSheetId("ing1"));
        // The row is the old one: no link, a ⋯ with its food.
        const flour = row(html, "Flour");
        expect(flour).not.toContain("data-fd-open-item");
        expect(flour).toContain("Actions for Flour");
    });
});

describe("the warning icon", () => {
    test("an ingredient with a gap has a small warning button beside its row that opens its detail", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            gaps: [NO_NUTRITION],
        });
        const avocado = row(html, "Avocado");
        expect(avocado).toContain("fd-icon--warning");
        expect(avocado).toContain(`commandfor="${warnSheetId("ing2")}"`);
        expect(avocado).toContain('command="show-modal"');
        expect(avocado).toContain('aria-label="What is wrong with Avocado"');
        // The icon is its own control: the face still opens the edit sheet.
        expect(avocado).toContain(
            `data-fd-open-item="${ingredientSheetId("ing2")}"`,
        );
        expect(avocado).toContain("fd-item-row__chevron");
        expect(row(html, "Flour")).not.toContain("fd-icon--warning");
        expect(html).not.toContain("fd-recipe-caption--warn");
    });

    test("the detail says what is wrong and links to the food and to the ingredient's sheet", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            gaps: [NO_NUTRITION],
        });
        const detail = dialog(html, warnSheetId("ing2"));
        expect(detail).toContain(
            "Avocado: no nutrition — add it, or pick a usual product",
        );
        expect(detail).toContain('href="/settings/saved?food=food-avocado"');
        expect(detail).toContain(`commandfor="${ingredientSheetId("ing2")}"`);
        // No warning, no detail sheet.
        expect(html).not.toContain(warnSheetId("ing1"));
    });

    test("a draft's problem about an ingredient is that row's warning, not a line of the card", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: DRAFT,
            ingredients: [FLOUR, SALT],
            draft: {
                problems: [
                    {
                        message:
                            'Salt has no amount. Add one, or note "to taste".',
                        ingredientId: "ing3",
                        line: null,
                    },
                    {
                        message: "Add the steps.",
                        ingredientId: null,
                        line: null,
                    },
                ],
                expiresOn: null,
                canSave: true,
                canDiscard: true,
                leaveGuard: false,
            },
        });
        const card = first(
            html,
            /<section class="fd-recipe-draft"[\s\S]*?<\/section>/,
        );
        expect(card).toContain("Add the steps.");
        expect(card).not.toContain("Salt has no amount");
        expect(card).toContain("marked with a warning");
        expect(row(html, "Salt")).toContain("fd-icon--warning");
        expect(dialog(html, warnSheetId("ing3"))).toContain(
            "Salt has no amount.",
        );
        expect(html).toContain("2 things to fix");
    });

    test("without the right to edit the icon sits beside the row's ⋯ and the detail has only the food link", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            editable: false,
            gaps: [NO_NUTRITION],
        });
        const avocado = row(html, "Avocado");
        expect(avocado).toContain("fd-icon--warning");
        expect(avocado).toContain("Actions for Avocado");
        const detail = dialog(html, warnSheetId("ing2"));
        expect(detail).toContain("/settings/saved?food=food-avocado");
        expect(detail).not.toContain(ingredientSheetId("ing2"));
    });

    test("the food link opens that food's own edit sheet: a usual's on Usuals, any other food's on Saved foods", () => {
        const view = { ...viewBase, gaps: [NO_NUTRITION] };
        const other = dialog(renderRecipeDetailBody(view), warnSheetId("ing2"));
        expect(other).toContain('href="/settings/saved?food=food-avocado"');
        expect(other).not.toContain("/kitchen/usuals/");
        const usual = dialog(
            renderRecipeDetailBody({
                ...view,
                usualFoodIds: ["food-avocado"],
            }),
            warnSheetId("ing2"),
        );
        expect(usual).toContain('href="/kitchen/usuals/food-avocado"');
        expect(usual).not.toContain("/settings/saved");
        // A food that is not this ingredient's does not change the link.
        const unrelated = dialog(
            renderRecipeDetailBody({ ...view, usualFoodIds: ["food-flour"] }),
            warnSheetId("ing2"),
        );
        expect(unrelated).toContain("/settings/saved?food=food-avocado");
    });

    test("a row with a warning is marked so its icon sits before the chevron, and every chevron stays at the row's end", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            gaps: [NO_NUTRITION],
        });
        const warned = row(html, "Avocado");
        expect(warned.split(">")[0]).toContain("fd-recipe-ing--warn");
        expect(row(html, "Flour").split(">")[0]).not.toContain(
            "fd-recipe-ing--warn",
        );
        // The chevron is inside the link; the icon beside it, after it in the markup.
        const anchor = first(
            warned,
            /<a class="fd-item-row__anchor"[\s\S]*?<\/a>/,
        );
        expect(anchor).toContain("fd-item-row__chevron");
        expect(anchor).not.toContain("fd-recipe-warn");
        expect(warned.indexOf("fd-recipe-warn")).toBeGreaterThan(
            warned.indexOf("fd-item-row__chevron"),
        );
        // The stylesheet seats the icon between the words and the chevron.
        const css = readFileSync(
            new URL("../../../../public/app/v2/recipes.css", import.meta.url),
            "utf8",
        );
        // The link keeps its own box (never `display: contents`, which drops
        // it from the focus order in WebKit and Chromium), and the icon sits
        // over the room its words leave at the end.
        expect(css).not.toMatch(
            /\.fd-recipe-ing--warn \.fd-item-row__anchor\s*\{[^}]*display: contents/,
        );
        expect(css).toMatch(
            /\.fd-recipe-ing--warn \.fd-item-row__main\s*\{\s*padding-inline-end:/,
        );
        expect(css).toMatch(
            /\.fd-recipe-ing--warn \.fd-recipe-warn\s*\{\s*position: absolute;/,
        );
    });

    test("ingredientWarnings keys the gaps and the draft's problems by ingredient and never says a thing twice", () => {
        const warnings = ingredientWarnings({
            gaps: [NO_NUTRITION, NO_NUTRITION],
            problems: [
                {
                    message: "Salt has no amount.",
                    ingredientId: "ing3",
                    line: null,
                },
                {
                    message: NO_NUTRITION.message,
                    ingredientId: "ing2",
                    line: null,
                },
                { message: "Add the steps.", ingredientId: null, line: null },
            ],
        });
        expect([...warnings.keys()].sort()).toEqual(["ing2", "ing3"]);
        expect(warnings.get("ing2")).toEqual([NO_NUTRITION.message]);
    });
});

describe("a draft's unreadable lines", () => {
    const draft = {
        problems: [
            {
                message:
                    '"a pinch of love" couldn\'t be read as an ingredient.',
                ingredientId: null,
                line: "a pinch of love",
            },
            {
                message: '"salt & pepper" couldn\'t be read as an ingredient.',
                ingredientId: null,
                line: 'salt & "pepper"',
            },
        ],
        expiresOn: null,
        canSave: true,
        canDiscard: true,
        leaveGuard: false,
    };

    test("each line is a row of the card with Resolve and Drop, and not a sentence of the list", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: DRAFT,
            draft,
        });
        const card = first(
            html,
            /<section class="fd-recipe-draft"[\s\S]*?<\/section>/,
        );
        expect(card).not.toContain("Fix these before you save it:");
        expect(card).toContain("fd-recipe-draft__lines");
        expect(card).toContain("a pinch of love");
        expect(card).toContain("Couldn't be read as an ingredient");
        const first1 = row(card, "a pinch of love");
        expect(first1).toContain(`commandfor="${resolveSheetId(0)}"`);
        expect(first1).toContain(">Resolve<");
        expect(first1).toContain('action="/recipes/r1/unresolved/drop"');
        expect(first1).toContain('name="line" value="a pinch of love"');
        expect(first1).toContain(">Drop<");
        expect(html).toContain("2 things to fix");
    });

    test("an unreadable line wraps: it is what the person has to read, so it is never cut short", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: DRAFT,
            draft,
        });
        const card = first(
            html,
            /<section class="fd-recipe-draft"[\s\S]*?<\/section>/,
        );
        const line = row(card, "a pinch of love");
        expect(line.split(">")[0]).toContain("fd-item-row--wrap");
    });

    test("Resolve opens a sheet that adds the line as a food and posts the line with it", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: DRAFT,
            draft,
        });
        const sheet = dialog(html, resolveSheetId(1));
        expect(sheet).toContain('action="/recipes/r1/unresolved/resolve"');
        expect(sheet).toContain(
            'name="line" value="salt &amp; &quot;pepper&quot;"',
        );
        expect(sheet).toContain('name="food_name"');
        expect(sheet).toContain('name="amount"');
        expect(sheet).toContain('name="unit"');
        expect(sheet).toContain("Add as an ingredient");
        expect(sheet).toContain("salt &amp; &quot;pepper&quot;");
    });

    test("without the right to edit the lines are only said, with no buttons or sheets", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            editable: false,
            recipe: DRAFT,
            draft,
        });
        const card = first(
            html,
            /<section class="fd-recipe-draft"[\s\S]*?<\/section>/,
        );
        expect(card).toContain("a pinch of love");
        expect(card).not.toContain(">Resolve<");
        expect(card).not.toContain(">Drop<");
        expect(html).not.toContain(resolveSheetId(0));
    });
});

describe("a refused ingredient write", () => {
    const refused = {
        open: ingredientSheetId("ing1"),
        error: "That change would break this saved recipe: Add the steps.",
        typed: {
            amount: "9",
            unit: "oz",
            note: "fine",
            food_name: "Wheat flour",
        },
    };

    test("reopens its sheet with the refusal inside it and what was typed, and not above the page", () => {
        const html = renderRecipeDetailBody({ ...viewBase, edit: refused });
        const sheet = dialog(html, ingredientSheetId("ing1"));
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain('role="alert"');
        expect(sheet).toContain("That change would break this saved recipe");
        expect(sheet).toContain('value="9"');
        expect(sheet).toContain('value="oz" data-fd-menu-field');
        expect(sheet).toContain('value="fine"');
        expect(sheet).toContain('value="Wheat flour"');
        expect(html).not.toContain('<p class="fd-recipe-error"');
        // Another ingredient's sheet is untouched.
        const other = dialog(html, ingredientSheetId("ing2"));
        expect(other).not.toContain("data-sheet-open-on-load");
        expect(other).not.toContain("That change would break");
    });

    test("a similar-foods question shows in the sheet, posting back to its route", () => {
        const didYouMean: DidYouMeanModal = {
            modalId: INGREDIENT_ADD_SHEET_ID,
            action: "/recipes/r1/ingredients",
            view: didYouMeanView(
                {
                    name: "Onion",
                    candidates: [
                        {
                            food: {
                                id: "food-red-onion",
                                householdId: "hh-1",
                                kind: "food",
                                name: "Red onion",
                                brand: null,
                            } as never,
                            why: "contains_words",
                        },
                    ],
                },
                { amount: "1", food_name: "Onion" },
            ),
        };
        const html = renderRecipeDetailBody({
            ...viewBase,
            edit: { open: INGREDIENT_ADD_SHEET_ID, didYouMean },
        });
        const sheet = dialog(html, INGREDIENT_ADD_SHEET_ID);
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain("fd-did-you-mean-block");
        expect(sheet).toContain('action="/recipes/r1/ingredients"');
        expect(sheet).toContain('name="food_id" value="food-red-onion"');
        expect(sheet).toContain('name="new_food" value="1"');
        expect(sheet).toContain('name="food_name" value="Onion"');
    });

    test("a refusal with no sheet open stays above the page", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            error: "Nope.",
        });
        expect(html).toContain('<p class="fd-recipe-error"');
    });
});

describe("on a member's view of the recipe", () => {
    const withLine = {
        problems: [
            {
                message:
                    '"a pinch of love" couldn\'t be read as an ingredient.',
                ingredientId: null,
                line: "a pinch of love",
            },
        ],
        expiresOn: null,
        canSave: true,
        canDiscard: true,
        leaveGuard: false,
    };

    test("every link and form of the ingredient editing carries the view, so an edit lands where it started", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            member: "base",
            recipe: DRAFT,
            draft: withLine,
        });
        const amp = (text: string) => text.replaceAll("&amp;", "&");
        expect(amp(row(html, "Flour"))).toContain(
            'href="/recipes/r1?ingredient=ing1&member=base"',
        );
        expect(amp(html)).toContain('href="/recipes/r1?add=1&member=base"');
        const field = '<input type="hidden" name="member" value="base">';
        expect(dialog(html, ingredientSheetId("ing1"))).toContain(field);
        // Its Remove, in the sheet's ⋯, posts the view with it.
        expect(dialog(html, ingredientSheetId("ing1"))).toMatch(
            /action="\/recipes\/r1\/ingredients\/ing1\/remove"><input type="hidden" name="member" value="base">/,
        );
        // Open food comes back to the same view.
        expect(dialog(html, ingredientSheetId("ing1"))).toContain(
            `from=${encodeURIComponent("/recipes/r1?member=base")}`,
        );
        expect(dialog(html, INGREDIENT_ADD_SHEET_ID)).toContain(field);
        expect(dialog(html, resolveSheetId(0))).toContain(field);
        expect(
            first(
                html,
                /<form class="fd-inline-form"[^>]*unresolved\/drop">[^]*?<\/form>/,
            ),
        ).toContain(field);
    });

    test("with no view in the address there is no member field and the links are the plain ones", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            recipe: DRAFT,
            draft: withLine,
        });
        expect(html).not.toContain('name="member"');
        expect(row(html, "Flour")).toContain(
            'href="/recipes/r1?ingredient=ing1"',
        );
        expect(html).toContain('href="/recipes/r1?add=1"');
    });
});

describe("a refusal with no sheet to hold it", () => {
    test("is said above the page, not lost: the lines are not editable here", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            editable: false,
            edit: {
                open: ingredientSheetId("ing1"),
                error: "That change would break this saved recipe.",
            },
            error: "That change would break this saved recipe.",
        });
        expect(html).toContain(
            '<p class="fd-recipe-error" role="alert">That change would break this saved recipe.</p>',
        );
        expect(html).not.toContain(`id="${ingredientSheetId("ing1")}"`);
    });

    test("with the sheet there, it holds the message and the page does not repeat it", () => {
        const html = renderRecipeDetailBody({
            ...viewBase,
            edit: {
                open: ingredientSheetId("ing1"),
                error: "That change would break this saved recipe.",
            },
            error: "That change would break this saved recipe.",
        });
        expect(html).not.toContain('<p class="fd-recipe-error"');
        expect(dialog(html, ingredientSheetId("ing1"))).toContain(
            "That change would break this saved recipe.",
        );
    });
});
