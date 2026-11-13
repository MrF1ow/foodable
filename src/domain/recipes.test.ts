import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import { test, expect, setSystemTime } from "bun:test";
import {
    addFoodByBarcode,
    addFoodById,
    addLocation,
    createMemoryFridgeStore,
    listFridge,
} from "./fridge.js";
import { createMemoryGroceryStore, listGrocery } from "./grocery.js";
import { recipeToGroceryRemainder } from "./linking.js";
import { RecipeUnverifiedError } from "./recipe-import.js";
import { cookRecipe, createMemoryStockStore } from "./stock.js";
import {
    addRecipeIngredientByBarcode,
    addRecipeManualIngredient,
    addRecipeToGrocery,
    amountForPortion,
    createMemoryRecipesStore,
    createRecipe,
    deleteRecipe,
    getRecipeView,
    importRecipeFromText,
    listRecipes,
    listRecipesFiltered,
    gapFromNotice,
    macrosForPerson,
    perPortionAmount,
    recipeIngredientGaps,
    recipeNotices,
    RecipeForbiddenError,
    RecipeInputError,
    recipeSteps,
    resolveTotalPortions,
    removeRecipeIngredient,
    reorderRecipeIngredients,
    recipeCanMakeNow,
    recipeFilters,
    recipeHighProtein,
    recipeTotalMinutes,
    recipeMatchesFilter,
    setPersonPortion,
    updateRecipe,
    updateRecipeIngredient,
    recipeIngredientFromRow,
    recipeIngredientToRow,
    type RecipeIngredient,
} from "./recipes.js";
import {
    createMemoryFoodsStore,
    createProduct,
    effectiveFoodsByIds,
    findOrCreateManualFood,
    newFood,
    setUsualProduct,
    updateFood,
} from "./foods.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
} from "../web/pages/recipes.js";
import { getAppCss } from "../widgets.js";
import type { FoodResult } from "../foods.js";
import type { Notice } from "./notices.js";

const HH = "hh-1";
const ALICE = "alice";
const BOB = "bob";

const BOB_PEA_RECIPE_ALLERGEN_NOTICE: Notice = {
    code: "recipe.allergen",
    severity: "block",
    subject: { kind: "recipe", id: "r1" },
    related: [{ kind: "member", id: BOB, name: "Bob" }],
    params: { allergens: ["peanut"] },
};

function emptyRecipeNotices(recipeId: string) {
    return {
        notices: [],
        noticeContext: {
            from: `/recipes/${recipeId}`,
            foods: new Map(),
        },
    };
}

function food(
    over: Partial<FoodResult> & Pick<FoodResult, "name" | "barcode">,
): FoodResult {
    return {
        brand: null,
        serving: "100 g",
        calories: 98,
        protein_g: 11,
        carbs_g: 3,
        fat_g: 4.3,
        fiber_g: 0,
        sugar_g: 3,
        alcohol_g: null,
        nutriscore_grade: null,
        nova_group: null,
        source: `off:${over.barcode}`,
        source_name: "openfoodfacts",
        ...over,
    };
}

test("yield math splits batch totals into per-portion amounts", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Mac",
        yieldPortions: 4,
    });
    const ingredient = await addRecipeManualIngredient(
        store,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            recipeId: recipe.id,
            name: "Pasta",
            amount: 400,
        },
    );
    expect(perPortionAmount(ingredient.quantity!.amount, 4)).toBe(100);
    expect(amountForPortion(ingredient.quantity!.amount, 4, 1)).toBe(100);
});

test("person portion override scales that person's amounts and macros", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Mac",
        yieldPortions: 4,
    });
    await addRecipeIngredientByBarcode(
        store,
        foods,
        {
            householdId: HH,
            recipeId: recipe.id,
            barcode: "070852010016",
            amount: 400,
        },
        {
            lookup: async () =>
                food({
                    name: "Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    await setPersonPortion(store, {
        householdId: HH,
        recipeId: recipe.id,
        userId: ALICE,
        portionCount: 2,
    });
    const view = await getRecipeView(store, HH, recipe.id, ALICE);
    expect(view.portionCount).toBe(2);
    expect(view.ingredients[0]?.personAmount).toBe(200);
    const macros = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        2,
        new Map((await foods.listFoods(HH)).map((row) => [row.id, row])),
    );
    expect(macros.incomplete).toBe(false);
    expect(macros.calories).toBe(196);
    expect(macros.protein_g).toBe(22);
});

test("creator can delete and a non-creator member cannot", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Soup",
        yieldPortions: 2,
    });
    await expect(
        deleteRecipe(store, HH, recipe.id, { userId: BOB, isOwner: false }),
    ).rejects.toBeInstanceOf(RecipeForbiddenError);
    expect(await listRecipes(store, HH)).toHaveLength(1);
    expect(
        await deleteRecipe(store, HH, recipe.id, {
            userId: ALICE,
            isOwner: false,
        }),
    ).toBe(true);
    expect(await listRecipes(store, HH)).toEqual([]);
});

test("household owner can delete a member-created recipe", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: BOB,
        name: "Salad",
        yieldPortions: 1,
    });
    expect(
        await deleteRecipe(store, HH, recipe.id, {
            userId: ALICE,
            isOwner: true,
        }),
    ).toBe(true);
    expect(await listRecipes(store, HH)).toEqual([]);
});

test("memory deleteRecipe removes recipe import row", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Imported",
        yieldPortions: 2,
        sourceUrl: "https://example.com/x",
    });
    await store.upsertImport({
        recipeId: recipe.id,
        householdId: HH,
        sourceKind: "website",
        sourceUrl: "https://example.com/x",
        sourceText: null,
        sourceTextOrigin: null,
        transcript: null,
        credit: null,
        unresolvedLines: [],
        problems: [],
        importedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await store.getImport(HH, recipe.id)).not.toBeNull();
    await store.deleteRecipe(HH, recipe.id);
    expect(await store.getImport(HH, recipe.id)).toBeNull();
});

test("manual ingredients without nutrition mark macros incomplete", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Mystery",
        yieldPortions: 2,
    });
    await addRecipeManualIngredient(store, createMemoryFoodsStore(), {
        householdId: HH,
        recipeId: recipe.id,
        name: "Whatever",
        amount: 50,
    });
    const view = await getRecipeView(store, HH, recipe.id, ALICE);
    const macros = macrosForPerson(view.ingredients, view.yieldPortions, 1);
    expect(macros.incomplete).toBe(true);
    expect(macros.calories).toBeNull();
});

test("filling food nutrition completes recipe macros", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Eggs",
        yieldPortions: 1,
    });
    const ingredient = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 100,
    });
    const view = await getRecipeView(store, HH, recipe.id, ALICE);
    const before = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        1,
        new Map((await foods.listFoods(HH)).map((row) => [row.id, row])),
    );
    expect(before.incomplete).toBe(true);
    await updateFood(foods, HH, ingredient.foodId!, {
        calories: 155,
        proteinG: 13,
        carbsG: 1.1,
        fatG: 11,
        nutritionSource: "manual",
    });
    const after = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        1,
        new Map((await foods.listFoods(HH)).map((row) => [row.id, row])),
    );
    expect(after.incomplete).toBe(false);
    expect(after.calories).toBe(155);
});

test("each without grams_per_each marks macros incomplete with a named reason", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Eggs",
        yieldPortions: 1,
    });
    const ingredient = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 3,
        unit: "each",
    });
    await updateFood(foods, HH, ingredient.foodId!, {
        calories: 155,
        proteinG: 13,
        carbsG: 1.1,
        fatG: 11,
        nutritionSource: "manual",
    });
    const view = await getRecipeView(store, HH, recipe.id, ALICE);
    const macros = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        1,
        new Map((await foods.listFoods(HH)).map((row) => [row.id, row])),
    );
    expect(macros.incomplete).toBe(true);
    expect(macros.calories).toBeNull();
    const gapNotices = recipeNotices(
        recipe.id,
        view.ingredients,
        new Map((await foods.listFoods(HH)).map((row) => [row.id, row])),
    );
    expect(gapNotices.map((n) => n.code)).toEqual([
        "recipe.missing_grams_per_each",
    ]);
    await updateFood(foods, HH, ingredient.foodId!, { gramsPerEach: 50 });
    const complete = macrosForPerson(
        view.ingredients,
        view.yieldPortions,
        1,
        new Map((await foods.listFoods(HH)).map((row) => [row.id, row])),
    );
    expect(complete.incomplete).toBe(false);
    expect(complete.calories).toBe(232.5);
});

test("add-to-grocery writes remainder lines and skips full fridge cover", async () => {
    const recipes = createMemoryRecipesStore();
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Safeway");
    const loc = await addLocation(fridge, HH, "Fridge");
    const lookup = async (barcode: string) =>
        barcode === "070852010016"
            ? food({ name: "Cottage Cheese", barcode: "070852010016" })
            : food({ name: "Pasta", barcode: "8076809513388" });
    await addFoodByBarcode(
        fridge,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "070852010016",
            amount: 50,
        },
        { lookup },
    );
    await addFoodByBarcode(
        fridge,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "8076809513388",
            amount: 200,
        },
        { lookup },
    );
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ALICE,
        name: "Mac",
        yieldPortions: 4,
    });
    await addRecipeIngredientByBarcode(
        recipes,
        foods,
        {
            householdId: HH,
            recipeId: recipe.id,
            barcode: "070852010016",
            amount: 400,
        },
        { lookup },
    );
    await addRecipeIngredientByBarcode(
        recipes,
        foods,
        {
            householdId: HH,
            recipeId: recipe.id,
            barcode: "8076809513388",
            amount: 200,
        },
        { lookup },
    );
    const fridgeItems = (await fridge.listItems(HH)).map((item) => ({
        quantity: item.quantity,
        foodId: item.foodId,
    }));
    const recipeRow = (await listRecipes(recipes, HH))[0]!;
    const ingredients = (await getRecipeView(recipes, HH, recipe.id, ALICE))
        .ingredients;
    const plan = recipeToGroceryRemainder({
        ingredients: ingredients.map((row) => ({
            displayName: row.displayName,
            quantity: row.quantity,
            foodId: row.foodId,
        })),
        yieldPortions: recipeRow.yieldPortions,
        portionCounts: [1],
        stock: fridgeItems,
    });
    const cottageLine = plan.find(
        (row) => row.displayName === "Cottage Cheese",
    );
    const pastaLine = plan.find((row) => row.displayName === "Pasta");
    expect(cottageLine?.skipped).toBe(false);
    expect(cottageLine?.remainder).toEqual({ amount: 50, unit: "g" });
    expect(pastaLine?.skipped).toBe(true);
    expect(pastaLine?.remainder).toBeNull();

    const result = await addRecipeToGrocery({
        recipes,
        grocery,
        settings,
        fridgeItems,
        householdId: HH,
        recipeId: recipe.id,
        storeId: store.id,
        portionCounts: [1],
    });
    expect(result.added).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines).toHaveLength(1);
    expect(listed.lines[0]?.displayName).toBe("Cottage Cheese");
    expect(listed.lines[0]?.quantity).toEqual({ amount: 50, unit: "g" });
    expect(listed.lines[0]?.foodId).toBe(cottageLine?.foodId);
    expect(listed.lines[0]?.source).toBe("recipe");
    expect(listed.lines[0]?.sourceFridgeItemId).toBeNull();
    const section = listed.sections.find(
        (row) => row.id === listed.lines[0]?.sectionId,
    );
    expect(section?.name).toBe("Dairy");
});

test("create recipe requires a name and a positive yield", async () => {
    const store = createMemoryRecipesStore();
    await expect(
        createRecipe(store, {
            householdId: HH,
            creatorId: ALICE,
            name: "  ",
            yieldPortions: 4,
        }),
    ).rejects.toBeInstanceOf(RecipeInputError);
    await expect(
        createRecipe(store, {
            householdId: HH,
            creatorId: ALICE,
            name: "Mac",
            yieldPortions: 0,
        }),
    ).rejects.toBeInstanceOf(RecipeInputError);
});

test("recipes list page is not a stub and detail reuses shared picker", () => {
    const list = renderRecipesPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        recipes: [
            {
                id: "r1",
                householdId: HH,
                creatorId: ALICE,
                name: "Mac",
                yieldPortions: 4,
                instructions: null,
                sourceUrl: null,
                tags: [],
                notes: null,
                prepMinutes: null,
                cookMinutes: null,
                verification: "verified",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
        members: [{ userId: ALICE, displayName: "Alice" }],
        viewerId: ALICE,
    });
    expect(list).toContain("<h1>Recipes</h1>");
    expect(list).not.toContain("Coming soon.");
    expect(list).toContain("Mac");
    expect(list).toContain('href="/recipes" aria-current="page"');
    expect(list).toContain('action="/recipes"');

    const detail = renderRecipeDetailPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        ...emptyRecipeNotices("r1"),
        recipe: {
            id: "r1",
            householdId: HH,
            creatorId: ALICE,
            name: "Mac",
            yieldPortions: 4,
            instructions: "Boil pasta.",
            sourceUrl: "https://example.com/mac",
            tags: ["dinner"],
            notes: "Use the blue pot.",
            prepMinutes: 10,
            cookMinutes: 20,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
        ingredients: [
            {
                id: "i1",
                householdId: HH,
                recipeId: "r1",
                kind: "food",
                displayName: "Cottage Cheese",
                quantity: { amount: 400, unit: "g" },
                foodId: null,
                sortOrder: 0,
                note: "diced",
                perPortionAmount: 100,
                personAmount: 100,
            },
        ],
        members: [
            { userId: ALICE, displayName: "Alice" },
            { userId: BOB, displayName: "Bob" },
        ],
        stores: [{ id: "st-1", name: "Safeway" }],
        viewerId: ALICE,
        filterUserId: ALICE,
        portionCount: 1,
        macros: {
            calories: 98,
            protein_g: 11,
            carbs_g: 3,
            fat_g: 4.3,
            fiber_g: 0,
            sugar_g: 3,
            alcohol_g: null,
            incomplete: false,
        },
        allergenNotices: [BOB_PEA_RECIPE_ALLERGEN_NOTICE],
        dislikeNote: "Bob dislikes cilantro.",
        isOwner: true,
    });
    expect(detail).toContain("Log a portion");
    expect(detail).toContain('action="/recipes/r1/log-portion"');
    expect(detail).toContain('class="quantity-field"');
    expect(detail).toContain('class="food-picker"');
    expect(detail).toContain('class="member-multi-select"');
    expect(detail).toContain("For who");
    expect(detail).toContain(`value="${ALICE}"`);
    expect(detail).toMatch(new RegExp(`value="${ALICE}"[^>]*checked`));
    expect(detail).toContain("100 g");
    expect(detail).not.toContain("Macros incomplete");
    expect(detail).toContain('data-calories="98"');
    expect(detail).toContain('data-blocking="true"');
    expect(detail).toContain("Contains peanut — Bob.");
    expect(detail).toContain('class="dislike-note"');
    expect(detail).toContain("Bob dislikes cilantro.");
    expect(detail).toContain('action="/recipes/r1/add-to-grocery"');
    expect(detail).toContain('action="/recipes/r1/delete"');
    expect(detail).toContain('commandfor="recipe-edit-r1"');
    expect(detail).toContain('id="recipe-add-ingredient-r1"');
});

test("recipe pages use modals for create and detail actions", async () => {
    const recipe = {
        id: "r1",
        householdId: "hh-1",
        creatorId: "u1",
        name: "Mac",
        yieldPortions: 4,
        instructions: null,
        sourceUrl: null,
        tags: ["dinner"],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "verified",
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const list = renderRecipesPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        recipes: [recipe],
        members: [],
        viewerId: "u1",
    } as never);
    expect(list).toContain('<ul class="recipe-list list">');
    expect(list).toContain(
        '<span class="recipe-tag pill pill-dim">dinner</span>',
    );
    expect(list).toContain("<summary>Filter</summary>");
    expect(list).not.toContain("<summary>New recipe</summary>");
    expect(list).toContain('commandfor="recipe-new"');
    expect(list).toContain('id="recipe-new"');
    const cardLinks = list.match(/class="recipe-card"[\s\S]*?<\/li>/g) ?? [];
    expect(cardLinks).toHaveLength(1);
    expect(cardLinks[0]!.match(/<a /g)?.length).toBe(1);
    expect(cardLinks[0]).toContain('class="row-title"');
    const css = await getAppCss();
    expect(css).toMatch(
        /\.recipe-card a\.row-title::after[\s\S]*position:\s*absolute;[\s\S]*inset:\s*0;/,
    );

    const detail = renderRecipeDetailPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        ...emptyRecipeNotices("r1"),
        recipe,
        ingredients: [
            {
                id: "ing1",
                recipeId: "r1",
                foodId: "f1",
                displayName: "Pasta",
                quantity: { amount: 400, unit: "g" },
                note: null,
                sortOrder: 0,
                perPortionAmount: 100,
                personAmount: 100,
            },
        ],
        members: [{ userId: "u1", displayName: "Ethan" }],
        stores: [{ id: "s1", name: "Safeway" }],
        viewerId: "u1",
        filterUserId: "u1",
        portionCount: 1,
        macros: {
            calories: 300,
            protein_g: 10,
            carbs_g: 50,
            fat_g: 5,
            fiber_g: 3,
            sugar_g: 2,
            alcohol_g: 0,
            incomplete: false,
        },
        isOwner: true,
    } as never);
    expect(detail).toContain("<h2>Nutrition</h2>");
    expect(detail).toContain('<h2 class="row-title">Ingredients</h2>');
    expect(detail).toContain('<h2 class="row-title">Cook and log</h2>');
    expect(detail).toContain("<h2>Groceries</h2>");
    expect(detail).toContain('<ul class="recipe-ingredients list">');
    expect(detail).toContain('aria-label="Move Pasta up"');
    expect(detail).not.toMatch(/<details class="more">[\s\S]*Edit recipe/);
    expect(detail).not.toMatch(/<details class="more">[\s\S]*Add ingredient/);
    expect(detail).not.toMatch(/<details class="more">[\s\S]*Cooked it/);
    expect(detail).toContain('commandfor="recipe-edit-r1"');
    expect(detail).toContain('commandfor="recipe-delete-r1"');
    expect(detail).toContain('commandfor="recipe-add-ingredient-r1"');
    expect(detail).toContain('commandfor="recipe-cook-r1"');
    expect(detail).toContain('commandfor="recipe-edit-ingredient"');
    expect(detail).toContain('commandfor="recipe-delete-ingredient"');
    expect(detail).not.toContain('commandfor="recipe-edit-ingredient-ing1"');
    expect(detail).toContain('data-fill-action="/recipes/r1/ingredients/ing1"');
    expect(detail).toContain('data-fill-field-ing_amount="400"');
    expect(detail).toContain('data-fill-field-ing_unit="g"');
    expect(detail).toContain('action="/recipes/r1/delete"');
    expect(detail).toContain('action="/recipes/r1/ingredients/ing1/delete"');
});

test("a server error reopens the recipe modal that submitted the form", () => {
    const list = renderRecipesPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        recipes: [],
        members: [],
        viewerId: "u1",
        error: "Enter a recipe name.",
        openModalId: "recipe-new",
    });
    expect(list).toMatch(
        /<dialog class="modal" id="recipe-new"[^>]*data-modal-open-on-load/,
    );
    expect(list).toContain("Enter a recipe name.");
    expect(list.match(/Enter a recipe name\./g)?.length).toBe(1);
    const newDialogStart = list.indexOf('id="recipe-new"');
    const newDialogEnd = list.indexOf("</dialog>", newDialogStart);
    expect(list.indexOf("Enter a recipe name.")).toBeGreaterThan(
        newDialogStart,
    );
    expect(list.indexOf("Enter a recipe name.")).toBeLessThan(newDialogEnd);

    const detail = renderRecipeDetailPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        ...emptyRecipeNotices("r1"),
        recipe: {
            id: "r1",
            householdId: "hh-1",
            creatorId: "u1",
            name: "Mac",
            yieldPortions: 4,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
        ingredients: [
            {
                id: "ing1",
                recipeId: "r1",
                foodId: "f1",
                displayName: "Pasta",
                quantity: { amount: 400, unit: "g" },
                note: null,
                sortOrder: 0,
                perPortionAmount: 100,
                personAmount: 100,
            },
        ],
        members: [],
        stores: [],
        viewerId: "u1",
        filterUserId: "u1",
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
        },
        isOwner: true,
        error: "Only the creator or household owner can delete this recipe.",
        openModalId: "recipe-delete-r1",
    } as never);
    expect(detail).toMatch(
        /<dialog class="modal" id="recipe-delete-r1"[^>]*data-modal-open-on-load/,
    );
    const deleteMsg =
        "Only the creator or household owner can delete this recipe.";
    expect(detail).toContain(deleteMsg);
    expect(
        detail.match(
            new RegExp(deleteMsg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        )?.length,
    ).toBe(1);
    const deleteDialogStart = detail.indexOf('id="recipe-delete-r1"');
    const deleteDialogEnd = detail.indexOf("</dialog>", deleteDialogStart);
    expect(detail.indexOf(deleteMsg)).toBeGreaterThan(deleteDialogStart);
    expect(detail.indexOf(deleteMsg)).toBeLessThan(deleteDialogEnd);

    const editIng = renderRecipeDetailPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        ...emptyRecipeNotices("r1"),
        recipe: {
            id: "r1",
            householdId: "hh-1",
            creatorId: "u1",
            name: "Mac",
            yieldPortions: 4,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
        ingredients: [
            {
                id: "ing1",
                recipeId: "r1",
                foodId: "f1",
                displayName: "Pasta",
                quantity: { amount: 400, unit: "g" },
                note: null,
                sortOrder: 0,
                perPortionAmount: 100,
                personAmount: 100,
            },
        ],
        members: [],
        stores: [],
        viewerId: "u1",
        filterUserId: "u1",
        portionCount: 1,
        macros: {
            calories: 300,
            protein_g: 10,
            carbs_g: 50,
            fat_g: 5,
            fiber_g: 3,
            sugar_g: 2,
            alcohol_g: 0,
            incomplete: false,
        },
        isOwner: true,
        error: "Amount must be positive.",
        openModalId: "recipe-edit-ingredient-ing1",
    } as never);
    expect(editIng).toMatch(
        /<dialog class="modal" id="recipe-edit-ingredient"[^>]*data-modal-open-on-load/,
    );
    const amountMsg = "Amount must be positive.";
    expect(editIng).toContain(amountMsg);
    expect(editIng.match(/Amount must be positive\./g)?.length).toBe(1);
    const editIngDialogStart = editIng.indexOf('id="recipe-edit-ingredient"');
    const editIngDialogEnd = editIng.indexOf("</dialog>", editIngDialogStart);
    expect(editIng.indexOf(amountMsg)).toBeGreaterThan(editIngDialogStart);
    expect(editIng.indexOf(amountMsg)).toBeLessThan(editIngDialogEnd);
});

test("recipe detail shows a page banner when openModalId does not match a dialog", () => {
    const html = renderRecipeDetailPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        ...emptyRecipeNotices("r1"),
        recipe: {
            id: "r1",
            householdId: "hh-1",
            creatorId: "u1",
            name: "Mac",
            yieldPortions: 4,
            instructions: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        },
        ingredients: [],
        members: [],
        stores: [],
        viewerId: "u1",
        filterUserId: "u1",
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
        },
        isOwner: true,
        error: "Unknown ingredient.",
        openModalId: "recipe-delete-ingredient-gone",
    } as never);
    expect(html).toContain('class="error-banner"');
    expect(html).toContain("Unknown ingredient.");
    expect(html).not.toMatch(/data-modal-open-on-load/);
});

test("updateRecipe writes fuller fields and updateRecipeIngredient stores a note", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Mac",
        yieldPortions: 4,
    });
    const updated = await updateRecipe(store, HH, recipe.id, {
        name: "Baked mac",
        instructions: "Boil, then bake.",
        sourceUrl: "https://example.com/mac",
        tags: ["Dinner", " dinner ", "comfort"],
        notes: "Blue pot",
        prepMinutes: 15,
        cookMinutes: 30,
    });
    expect(updated.name).toBe("Baked mac");
    expect(updated.instructions).toBe("Boil, then bake.");
    expect(updated.sourceUrl).toBe("https://example.com/mac");
    expect(updated.tags).toEqual(["dinner", "comfort"]);
    expect(updated.notes).toBe("Blue pot");
    expect(updated.prepMinutes).toBe(15);
    expect(updated.cookMinutes).toBe(30);
    const ingredient = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Cheddar",
        amount: 100,
    });
    const noted = await updateRecipeIngredient(
        store,
        HH,
        recipe.id,
        ingredient.id,
        { note: "grated", amount: 120 },
    );
    expect(noted.note).toBe("grated");
    expect(noted.quantity!.amount).toBe(120);
});

test("remove and reorder recipe ingredients", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Soup",
        yieldPortions: 2,
    });
    const first = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Onion",
        amount: 50,
    });
    const second = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Carrot",
        amount: 80,
    });
    const reordered = await reorderRecipeIngredients(store, HH, recipe.id, [
        second.id,
        first.id,
    ]);
    expect(reordered.map((row) => row.displayName)).toEqual([
        "Carrot",
        "Onion",
    ]);
    expect(await removeRecipeIngredient(store, HH, recipe.id, first.id)).toBe(
        true,
    );
    const left = await store.listIngredients(HH, recipe.id);
    expect(left).toHaveLength(1);
    expect(left[0]?.displayName).toBe("Carrot");
});

test("listRecipesFiltered matches tag, can-make-now, and safe-for", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const pasta = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ALICE,
        name: "Pasta",
        yieldPortions: 1,
        tags: ["dinner"],
    });
    const salad = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ALICE,
        name: "Salad",
        yieldPortions: 1,
        tags: ["lunch"],
    });
    const lookup = async (barcode: string) =>
        food({ name: "Cottage Cheese", barcode });
    await addRecipeIngredientByBarcode(
        recipes,
        foods,
        {
            householdId: HH,
            recipeId: pasta.id,
            barcode: "070852010016",
            amount: 50,
        },
        { lookup },
    );
    await addFoodByBarcode(
        fridge,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "070852010016",
            amount: 50,
        },
        { lookup },
    );
    const peanut = await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: salad.id,
        name: "peanut butter",
        amount: 20,
    });
    await updateFood(foods, HH, peanut.foodId!, {
        allergens: ["peanut"],
        nutritionSource: "manual",
    });
    const catalog = new Map(
        (await foods.listFoods(HH)).map((row) => [row.id, row]),
    );
    const stock = (await fridge.listItems(HH)).map((item) => ({
        quantity: item.quantity,
        foodId: item.foodId,
    }));
    const byTag = await listRecipesFiltered(recipes, HH, catalog, stock, {
        tag: "Dinner",
    });
    expect(byTag.map((row) => row.name)).toEqual(["Pasta"]);
    const canMake = await listRecipesFiltered(recipes, HH, catalog, stock, {
        canMakeNow: true,
    });
    expect(canMake.map((row) => row.name)).toEqual(["Pasta"]);
    const safe = await listRecipesFiltered(recipes, HH, catalog, stock, {
        safeFor: {
            allergens: [
                {
                    id: "a1",
                    householdId: HH,
                    userId: BOB,
                    allergen: "peanut",
                    otherLabel: null,
                },
            ],
            dislikes: [],
        },
    });
    expect(safe.map((row) => row.name)).toEqual(["Pasta"]);
});

test("importRecipeFromText links prep-sized ingredient lines via lookup variants", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    foods.setPluralsSameFood(HH, true);
    const eggs = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const mozzarella = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Fresh mozzarella" }),
    );

    const result = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Caprese",
            instructions: "Assemble.",
            name: "Caprese",
            ingredients: [
                { name: "large eggs (beaten)" },
                { name: "chopped fresh mozzarella" },
            ],
        },
        { lookup: async () => null },
    );

    expect(result.ingredients).toHaveLength(2);
    const eggRow = result.ingredients.find(
        (row) => row.displayName === eggs.name,
    );
    const mozRow = result.ingredients.find(
        (row) => row.displayName === mozzarella.name,
    );
    expect(eggRow?.foodId).toBe(eggs.id);
    expect(mozRow?.foodId).toBe(mozzarella.id);
    expect((await foods.getFood(HH, eggs.id))?.name).toBe("Eggs");
    expect((await foods.getFood(HH, mozzarella.id))?.name).toBe(
        "Fresh mozzarella",
    );
    expect(
        (await foods.listFoods(HH)).filter((f) => !f.archivedAt),
    ).toHaveLength(2);
});

test("importRecipeFromText find-or-creates foods and reports nutrition gaps", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const result = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Pancakes\nMix and fry.",
            instructions: "Mix and fry.",
            sourceUrl: "https://example.com/pancakes",
            name: "Pancakes",
            yieldPortions: 4,
            tags: ["breakfast"],
            ingredients: [
                { name: "Flour", amount: 120, unit: "g", note: "sifted" },
                { name: "Milk", amount: 200, unit: "ml" },
            ],
        },
        { lookup: async () => null },
    );
    expect(result.recipe.name).toBe("Pancakes");
    expect(result.recipe.instructions).toBe("Mix and fry.");
    expect(result.recipe.sourceUrl).toBe("https://example.com/pancakes");
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[0]?.note).toBe("sifted");
    expect(result.ingredients[0]?.foodId).toBeTruthy();
    expect(result.ingredients[1]?.quantity!.unit).toBe("ml");
    expect(
        result.gaps.find((row) => row.displayName === "Flour")?.missing,
    ).toContain("nutrition");
    expect(
        result.gaps.find((row) => row.displayName === "Milk")?.missing,
    ).toEqual(["nutrition", "grams_per_ml"]);
    const again = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "More pancakes",
            name: "Pancakes 2",
            ingredients: [{ name: "flour", amount: 50 }],
        },
        { lookup: async () => null },
    );
    expect(again.ingredients[0]?.foodId).toBe(result.ingredients[0]?.foodId);
});

function sampleIngredient(
    over: Partial<{
        id: string;
        displayName: string;
        foodId: string | null;
        amount: number;
        unit: string;
    }> = {},
) {
    return {
        id: over.id ?? "ing-1",
        householdId: HH,
        recipeId: "r1",
        kind: "food" as const,
        displayName: over.displayName ?? "Item",
        quantity: { amount: over.amount ?? 100, unit: over.unit ?? "g" },
        foodId: over.foodId === undefined ? "f1" : over.foodId,
        sortOrder: 0,
        note: null,
    };
}

test("recipeNotices and gapFromNotice align with recipeIngredientGaps", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const eff = catalog.get(plain.id)!;
    const ing = sampleIngredient({
        displayName: "Half and half",
        foodId: plain.id,
        amount: 60,
        unit: "ml",
    });

    const rId = "r-gap-test";
    expect(recipeNotices(rId, [{ ...ing, foodId: null }], catalog)).toEqual([
        expect.objectContaining({
            code: "recipe.no_food",
            subject: { kind: "recipe_ingredient", id: ing.id, recipeId: rId },
            related: [],
            params: { name: ing.displayName },
        }),
    ]);

    const noFoodGaps = recipeIngredientGaps(
        { ...ing, foodId: null },
        undefined,
    );
    expect(
        gapFromNotice(
            recipeNotices(rId, [{ ...ing, foodId: null }], catalog)[0]!,
        ),
    ).toEqual(noFoodGaps[0]!);

    const effNotices = recipeNotices(rId, [ing], catalog);
    expect(effNotices.map((n) => n.code)).toEqual(["recipe.no_nutrition"]);
    expect(effNotices[0]).toMatchObject({
        subject: { kind: "recipe_ingredient", id: ing.id, recipeId: rId },
        related: [],
        params: { name: ing.displayName, foodId: plain.id },
    });
    expect(gapFromNotice(effNotices[0]!)).toEqual(
        recipeIngredientGaps(ing, eff)[0]!,
    );

    const product = await createProduct(foods, HH, plain.id, {
        name: "Store Half and Half",
        defaultUnit: "ml",
        nutritionSource: "manual",
    });
    await setUsualProduct(foods, HH, plain.id, product.id);
    const withUsual = (await effectiveFoodsByIds(foods, HH, [plain.id])).get(
        plain.id,
    )!;
    const usualN = recipeNotices(
        rId,
        [ing],
        await effectiveFoodsByIds(foods, HH, [plain.id]),
    )[0]!;
    expect(usualN).toMatchObject({
        code: "recipe.no_nutrition",
        related: [
            { kind: "food", id: product.id, name: "Store Half and Half" },
        ],
    });
    expect(gapFromNotice(usualN)).toEqual(
        recipeIngredientGaps(ing, withUsual)[0]!,
    );

    await updateFood(foods, HH, product.id, {
        calories: 100,
        proteinG: 2,
        carbsG: 3,
        fatG: 4,
        nutritionSource: "manual",
    });
    const completeCatalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    expect(recipeNotices(rId, [ing], completeCatalog)).toEqual([]);

    const partial = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await updateFood(foods, HH, partial.id, {
        calories: 80,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const partialIng = sampleIngredient({
        displayName: "Yogurt",
        foodId: partial.id,
        unit: "g",
    });
    const partialCat = await effectiveFoodsByIds(foods, HH, [partial.id]);
    const pNotices = recipeNotices(rId, [partialIng], partialCat);
    expect(pNotices[0]).toMatchObject({
        code: "recipe.partial_nutrition",
        params: {
            name: "Yogurt",
            foodId: partial.id,
            missing: ["protein_g", "fat_g"],
        },
    });
    expect(gapFromNotice(pNotices[0]!)).toEqual(
        recipeIngredientGaps(partialIng, partialCat.get(partial.id)!)[0]!,
    );

    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggIng = sampleIngredient({
        displayName: "Eggs",
        foodId: eggs.id,
        amount: 2,
        unit: "each",
    });
    const eggCat = await effectiveFoodsByIds(foods, HH, [eggs.id]);
    const eggFood = eggCat.get(eggs.id)!;
    const eggNotes = recipeNotices(rId, [eggIng], eggCat);
    expect(eggNotes.map((n) => n.code)).toEqual([
        "recipe.no_nutrition",
        "recipe.missing_grams_per_each",
    ]);
    expect(gapFromNotice(eggNotes[0]!)).toEqual(
        recipeIngredientGaps(eggIng, eggFood)[0]!,
    );
    expect(gapFromNotice(eggNotes[1]!)).toEqual(
        recipeIngredientGaps(eggIng, eggFood)[1]!,
    );

    const badUnit = sampleIngredient({
        displayName: "Spice",
        foodId: plain.id,
        unit: "pinch",
    });
    const spiceNotices = recipeNotices(rId, [badUnit], catalog);
    expect(spiceNotices.some((n) => n.code === "recipe.unknown_unit")).toBe(
        true,
    );
    const unknown = spiceNotices.find((n) => n.code === "recipe.unknown_unit")!;
    expect(gapFromNotice(unknown)).toEqual(
        recipeIngredientGaps(badUnit, eff).find(
            (g) => g.reason === "unknown_unit",
        )!,
    );
});

test("macrosForPerson incomplete mirrors recipe gap notices", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const ing = sampleIngredient({
        displayName: "Half and half",
        foodId: plain.id,
        amount: 60,
        unit: "ml",
    });

    const yogurt = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await updateFood(foods, HH, yogurt.id, {
        calories: 80,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const yogurtIng = sampleIngredient({
        displayName: "Yogurt",
        foodId: yogurt.id,
        unit: "g",
    });

    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggIng = sampleIngredient({
        displayName: "Eggs",
        foodId: eggs.id,
        amount: 2,
        unit: "each",
    });

    const combos: RecipeIngredient[][] = [
        [{ ...ing, foodId: null }],
        [ing],
        [yogurtIng],
        [eggIng],
    ];
    for (const list of combos) {
        const ids = list
            .map((i) => i.foodId)
            .filter((id): id is string => id != null);
        const cat = await effectiveFoodsByIds(foods, HH, ids);
        const macros = macrosForPerson(list, 1, 1, cat);
        const gapNotices = recipeNotices("r1", list, cat);
        expect(macros.incomplete).toBe(gapNotices.length > 0);
    }
});

test("recipeIngredientGaps reports every reason in order", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const eff = catalog.get(plain.id)!;
    const ing = sampleIngredient({
        displayName: "Half and half",
        foodId: plain.id,
        amount: 60,
        unit: "ml",
    });
    expect(recipeIngredientGaps(ing, undefined)).toEqual([
        expect.objectContaining({
            reason: "no_food",
            message: "Half and half: not linked to a food",
        }),
    ]);
    expect(recipeIngredientGaps(ing, eff).map((g) => g.reason)).toEqual([
        "no_nutrition",
    ]);
    expect(recipeIngredientGaps(ing, eff)[0]?.message).toBe(
        "Half and half: no nutrition — add it, or pick a usual product",
    );

    const product = await createProduct(foods, HH, plain.id, {
        name: "Store Half and Half",
        defaultUnit: "ml",
        nutritionSource: "manual",
    });
    await setUsualProduct(foods, HH, plain.id, product.id);
    const withUsual = (await effectiveFoodsByIds(foods, HH, [plain.id])).get(
        plain.id,
    )!;
    expect(recipeIngredientGaps(ing, withUsual)[0]?.message).toBe(
        "Half and half: no nutrition — its usual product, Store Half and Half, has none either",
    );

    await updateFood(foods, HH, product.id, {
        calories: 100,
        proteinG: 2,
        carbsG: 3,
        fatG: 4,
        nutritionSource: "manual",
    });
    const completeCatalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    expect(recipeIngredientGaps(ing, completeCatalog.get(plain.id)!)).toEqual(
        [],
    );

    const partial = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    await updateFood(foods, HH, partial.id, {
        calories: 80,
        proteinG: null,
        carbsG: 6,
        fatG: null,
        nutritionSource: "manual",
    });
    const partialIng = sampleIngredient({
        displayName: "Yogurt",
        foodId: partial.id,
        unit: "g",
    });
    const partialGaps = recipeIngredientGaps(
        partialIng,
        (await effectiveFoodsByIds(foods, HH, [partial.id])).get(partial.id),
    );
    expect(partialGaps[0]).toMatchObject({
        reason: "partial_nutrition",
        missingNutrients: ["protein_g", "fat_g"],
        message: "Yogurt: missing protein and fat",
    });

    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggIng = sampleIngredient({
        displayName: "Eggs",
        foodId: eggs.id,
        amount: 2,
        unit: "each",
    });
    const both = recipeIngredientGaps(
        eggIng,
        (await effectiveFoodsByIds(foods, HH, [eggs.id])).get(eggs.id),
    );
    expect(both.map((g) => g.reason)).toEqual([
        "no_nutrition",
        "missing_grams_per_each",
    ]);

    expect(
        recipeIngredientGaps(
            sampleIngredient({
                displayName: "Flour",
                foodId: plain.id,
                unit: "g",
            }),
            (await effectiveFoodsByIds(foods, HH, [plain.id])).get(plain.id),
        ),
    ).toEqual([]);

    const badUnit = sampleIngredient({
        displayName: "Spice",
        foodId: plain.id,
        unit: "pinch",
    });
    expect(recipeIngredientGaps(badUnit, eff).map((g) => g.reason)).toContain(
        "unknown_unit",
    );
});

test("macrosForPerson names Half and half nutrition gap and completes with usual product", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const plain = await findOrCreateManualFood(
        foods,
        HH,
        "food",
        "Half and half",
    );
    await updateFood(foods, HH, plain.id, { gramsPerMl: 1 });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ALICE,
        name: "Coffee",
        yieldPortions: 1,
    });
    const ingredient = await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Half and half",
        amount: 60,
        unit: "ml",
    });
    let catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const incomplete = macrosForPerson([ingredient], 1, 1, catalog);
    expect(incomplete.incomplete).toBe(true);
    expect(
        recipeIngredientGaps(ingredient, catalog.get(plain.id)!)[0]?.reason,
    ).toBe("no_nutrition");

    const product = await createProduct(foods, HH, plain.id, {
        name: "Member's Mark Half and Half",
        defaultUnit: "ml",
        calories: 130,
        proteinG: 2,
        carbsG: 4,
        fatG: 11,
        nutritionSource: "manual",
        gramsPerMl: 1,
    });
    await setUsualProduct(foods, HH, plain.id, product.id);
    catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const complete = macrosForPerson([ingredient], 1, 1, catalog);
    expect(complete.incomplete).toBe(false);
    expect(complete.calories).toBe(78);
});

test("macrosForPerson sets incomplete when nutrition gaps exist", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const cases: Array<() => Promise<void>> = [
        async () => {
            const oats = await findOrCreateManualFood(
                foods,
                HH,
                "food",
                "Oats",
            );
            await updateFood(foods, HH, oats.id, {
                calories: 389,
                proteinG: 17,
                carbsG: 66,
                fatG: 7,
                nutritionSource: "manual",
            });
            const recipe = await createRecipe(recipes, {
                householdId: HH,
                creatorId: ALICE,
                name: "Porridge",
                yieldPortions: 1,
            });
            const ing = await addRecipeManualIngredient(recipes, foods, {
                householdId: HH,
                recipeId: recipe.id,
                name: "Oats",
                amount: 50,
                unit: "g",
            });
            const catalog = await effectiveFoodsByIds(foods, HH, [oats.id]);
            const macros = macrosForPerson([ing], 1, 1, catalog);
            expect(macros.incomplete).toBe(false);
        },
        async () => {
            const plain = await findOrCreateManualFood(
                foods,
                HH,
                "food",
                "Milk",
            );
            const recipe = await createRecipe(recipes, {
                householdId: HH,
                creatorId: ALICE,
                name: "Drink",
                yieldPortions: 1,
            });
            const ing = await addRecipeManualIngredient(recipes, foods, {
                householdId: HH,
                recipeId: recipe.id,
                name: "Milk",
                amount: 200,
                unit: "ml",
            });
            const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
            const macros = macrosForPerson([ing], 1, 1, catalog);
            expect(macros.incomplete).toBe(true);
        },
    ];
    for (const run of cases) await run();
});

test("total portions default to the members' sum and may only grow it", () => {
    expect(resolveTotalPortions(3)).toBe(3);
    expect(resolveTotalPortions(3, null)).toBe(3);
    // Whole batch, leftovers, and baking ahead with nobody eating yet.
    expect(resolveTotalPortions(2, 10)).toBe(10);
    expect(resolveTotalPortions(0, 10)).toBe(10);
    expect(() => resolveTotalPortions(0)).toThrow(RecipeInputError);
    expect(() => resolveTotalPortions(3, 2)).toThrow(/can't be less/);
    expect(() => resolveTotalPortions(0, 0)).toThrow(RecipeInputError);
    expect(() => resolveTotalPortions(0, Number.NaN)).toThrow(RecipeInputError);
});

test("recipeSteps splits lines and drops typed numbering", () => {
    expect(recipeSteps(null)).toEqual([]);
    expect(recipeSteps("  \n ")).toEqual([]);
    expect(
        recipeSteps("1. Boil water\n2) Add pasta\n\nStep 3: Drain\n- Serve"),
    ).toEqual(["Boil water", "Add pasta", "Drain", "Serve"]);
    expect(recipeSteps("1.5 cups flour into a bowl\r\nWhisk")).toEqual([
        "1.5 cups flour into a bowl",
        "Whisk",
    ]);
});

test("recipeSteps treats paragraphs as steps when blank lines separate them", () => {
    expect(
        recipeSteps(
            "Heat the oil\nin a large pan.\n\n2. Add onions\nand stir.",
        ),
    ).toEqual(["Heat the oil in a large pan.", "Add onions and stir."]);
});

test("recipeSteps wraps unnumbered lines into the numbered step above", () => {
    expect(recipeSteps("1. Boil the water\nwith salt\n2. Add pasta")).toEqual([
        "Boil the water with salt",
        "Add pasta",
    ]);
});

test("recipe ingredient null quantity round-trips row mappers", () => {
    const ingredient = recipeIngredientFromRow({
        id: "ing-1",
        household_id: HH,
        recipe_id: "rec-1",
        kind: "food",
        display_name: "Salt",
        amount: null,
        unit: null,
        sort_order: 0,
        food_id: "food-salt",
        note: "to taste",
    });
    expect(ingredient.quantity).toBeNull();
    const row = recipeIngredientToRow(ingredient);
    expect(row.amount).toBeNull();
    expect(row.unit).toBeNull();
    expect(recipeIngredientFromRow(row as never).quantity).toBeNull();
});

test("macrosForPerson counts only measured ingredients when one is unmeasured", async () => {
    const foods = createMemoryFoodsStore();
    const flour = await findOrCreateManualFood(foods, HH, "food", "Flour");
    await updateFood(foods, HH, flour.id, {
        calories: 364,
        proteinG: 10,
        carbsG: 76,
        fatG: 1,
    });
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    await updateFood(foods, HH, salt.id, {
        calories: 9999,
        proteinG: 999,
        carbsG: 999,
        fatG: 999,
    });
    const catalog = await effectiveFoodsByIds(foods, HH, [flour.id, salt.id]);
    const measured = recipeIngredientFromRow({
        id: "i-flour",
        household_id: HH,
        recipe_id: "r1",
        kind: "food",
        display_name: "Flour",
        amount: 100,
        unit: "g",
        sort_order: 0,
        food_id: flour.id,
    });
    const unmeasured = recipeIngredientFromRow({
        id: "i-salt",
        household_id: HH,
        recipe_id: "r1",
        kind: "food",
        display_name: "Salt",
        amount: null,
        unit: null,
        sort_order: 1,
        food_id: salt.id,
        note: "to taste",
    });
    const macros = macrosForPerson([measured, unmeasured], 1, 1, catalog);
    expect(macros.incomplete).toBe(true);
    expect(
        recipeIngredientGaps(unmeasured, catalog.get(salt.id)!)?.[0]?.message,
    ).toContain("Salt has no amount");
    expect(macros.calories).toBe(364);
    expect(macros.protein_g).toBe(10);
    expect(macros.carbs_g).toBe(76);
    expect(macros.fat_g).toBe(1);
});

test("updateRecipeIngredient uses food default unit when measuring unmeasured ingredient", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    await updateFood(foods, HH, eggs.id, { defaultUnit: "each" });
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Omelette",
        yieldPortions: 1,
    });
    const ingredient = await store.insertIngredient({
        id: "ing-eggs",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Eggs",
        quantity: null,
        foodId: eggs.id,
        sortOrder: 0,
        note: "to taste",
    });
    const updated = await updateRecipeIngredient(
        store,
        HH,
        recipe.id,
        ingredient.id,
        { amount: 2 },
        foods,
    );
    expect(updated.quantity).toEqual({ amount: 2, unit: "each" });
    // The web form always posts ing_unit; a blank one is "not given", not grams.
    await updateRecipeIngredient(
        store,
        HH,
        recipe.id,
        ingredient.id,
        { amount: null },
        foods,
    );
    const blankUnit = await updateRecipeIngredient(
        store,
        HH,
        recipe.id,
        ingredient.id,
        { amount: 3, unit: "", note: "" },
        foods,
    );
    expect(blankUnit.quantity).toEqual({ amount: 3, unit: "each" });
    // Saving the note alone keeps a measured amount.
    const noteOnly = await updateRecipeIngredient(
        store,
        HH,
        recipe.id,
        ingredient.id,
        { amount: 3, unit: "each", note: "beaten" },
        foods,
    );
    expect(noteOnly.quantity).toEqual({ amount: 3, unit: "each" });
});

test("unmeasured ingredient per-portion and per-person amounts stay null", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Soup",
        yieldPortions: 4,
    });
    await store.insertIngredient({
        id: "ing-salt",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Salt",
        quantity: null,
        foodId: salt.id,
        sortOrder: 0,
        note: "to taste",
    });
    for (const portions of [1, 2, 7] as const) {
        await setPersonPortion(store, {
            householdId: HH,
            recipeId: recipe.id,
            userId: ALICE,
            portionCount: portions,
        });
        const view = await getRecipeView(store, HH, recipe.id, ALICE);
        expect(view.ingredients[0]?.perPortionAmount).toBeNull();
        expect(view.ingredients[0]?.personAmount).toBeNull();
    }
});

test("addRecipeToGrocery handles unmeasured salt against list and stock", async () => {
    const recipes = createMemoryRecipesStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    await updateFood(foods, HH, salt.id, { defaultUnit: "g" });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ALICE,
        name: "Eggs",
        yieldPortions: 1,
    });
    await recipes.insertIngredient({
        id: "ing-salt",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Salt",
        quantity: null,
        foodId: salt.id,
        sortOrder: 0,
        note: "to taste",
    });
    const store = await createGroceryStore(settings, HH, "Shop");
    const catalog = await effectiveFoodsByIds(foods, HH, [salt.id]);
    const base = {
        recipes,
        grocery,
        settings,
        foods,
        householdId: HH,
        recipeId: recipe.id,
        storeId: store.id,
        portionCounts: [1],
        foodsById: catalog,
    };
    const first = await addRecipeToGrocery({
        ...base,
        fridgeItems: [],
    });
    expect(first.added).toHaveLength(1);
    // The amount is a placeholder under the note: never 1 g of salt.
    expect(first.added[0]?.quantity).toEqual({ amount: 1, unit: "each" });
    expect(first.added[0]?.note).toBe("to taste");
    const again = await addRecipeToGrocery({
        ...base,
        fridgeItems: [],
    });
    expect(again.added).toHaveLength(0);
    await grocery.deleteLine(HH, first.added[0]!.id);
    const loc = await addLocation(fridge, HH, "Pantry");
    await addFoodById(fridge, foods, {
        householdId: HH,
        locationId: loc.id,
        foodId: salt.id,
        amount: 50,
        unit: "g",
    });
    const saltItem = (await listFridge(fridge, HH)).items.find(
        (row) => row.foodId === salt.id,
    );
    const withStock = await addRecipeToGrocery({
        ...base,
        fridgeItems: [{ quantity: saltItem!.quantity, foodId: salt.id }],
    });
    expect(withStock.added).toHaveLength(0);
});

test("addRecipeToGrocery skips unmeasured when usual product is already on the list", async () => {
    const recipes = createMemoryRecipesStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const foods = createMemoryFoodsStore();
    const plain = await findOrCreateManualFood(foods, HH, "food", "Salt");
    const morton = await createProduct(foods, HH, plain.id, {
        name: "Morton Salt",
        brand: "Morton",
    });
    const store = await createGroceryStore(settings, HH, "Shop");
    const sections = await settings.listSections(store.id);
    await grocery.insertLine({
        id: crypto.randomUUID(),
        householdId: HH,
        storeId: store.id,
        sectionId: sections[0]!.id,
        kind: "food",
        displayName: "Morton Salt",
        quantity: { amount: 1, unit: "g" },
        foodId: morton.id,
        checked: false,
        note: "to taste",
        source: "manual",
        sourceFridgeItemId: null,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: ALICE,
        name: "Eggs",
        yieldPortions: 1,
    });
    await recipes.insertIngredient({
        id: "ing-salt",
        householdId: HH,
        recipeId: recipe.id,
        kind: "food",
        displayName: "Salt",
        quantity: null,
        foodId: plain.id,
        sortOrder: 0,
        note: "to taste",
    });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const result = await addRecipeToGrocery({
        recipes,
        grocery,
        settings,
        foods,
        householdId: HH,
        recipeId: recipe.id,
        storeId: store.id,
        portionCounts: [1],
        foodsById: catalog,
        fridgeItems: [],
    });
    expect(result.added).toHaveLength(0);
});

test("importRecipeFromText optional amount instructions and rollback", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const lookup = async () => null;
    const imported = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Raw paste\n\nStep 1: mix",
            instructions: "Step 1: mix\nStep 2: bake",
            name: "Bread",
            ingredients: [
                { name: "Salt" },
                { name: "Flour", amount: 500, unit: "g" },
            ],
        },
        { lookup },
    );
    expect(imported.ingredients[0]?.quantity).toBeNull();
    // No invented note: an import only counts as not measured when it says so.
    expect(imported.ingredients[0]?.note).toBeNull();
    expect(imported.recipe.verification).toBe("unverified");
    expect(imported.recipe.instructions).toBe("Step 1: mix\nStep 2: bake");
    const legacy = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Title\nBody only",
            name: "Legacy",
            ingredients: [],
        },
        { lookup },
    );
    expect(legacy.recipe.instructions).toBeNull();
    expect(legacy.verification).toBe("unverified");
    expect(legacy.problems.some((p) => p.code === "no_instructions")).toBe(
        true,
    );
    const imp = await recipes.getImport(HH, legacy.recipe.id);
    expect(imp?.sourceText).toBe("Title\nBody only");
    const supply = await findOrCreateManualFood(foods, HH, "supply", "Spice");
    const rollback = async <T>(fn: () => Promise<T>): Promise<T> => {
        const recipeIdsBefore = new Set(
            (await recipes.listRecipes(HH)).map((row) => row.id),
        );
        const foodIdsBefore = new Set(
            (await foods.listFoods(HH)).map((row) => row.id),
        );
        try {
            return await fn();
        } catch (err) {
            for (const row of await recipes.listRecipes(HH)) {
                if (!recipeIdsBefore.has(row.id)) {
                    await recipes.deleteRecipe(HH, row.id);
                }
            }
            for (const row of await foods.listFoods(HH)) {
                if (!foodIdsBefore.has(row.id)) {
                    await foods.updateFoodRow({
                        ...row,
                        archivedAt: new Date().toISOString(),
                    });
                }
            }
            throw err;
        }
    };
    await expect(
        importRecipeFromText(
            recipes,
            foods,
            {
                householdId: HH,
                creatorId: ALICE,
                text: "Bad import",
                name: "Bad",
                ingredients: [
                    { name: "Ok", amount: 1, unit: "g" },
                    { name: "Ok2", amount: 1, unit: "g" },
                    { name: "Spice", amount: 1, unit: "g", foodId: supply.id },
                ],
            },
            { lookup, transaction: rollback },
        ),
    ).rejects.toThrow(/supply/);
    expect((await recipes.listRecipes(HH)).some((r) => r.name === "Bad")).toBe(
        false,
    );
    expect((await foods.listFoods(HH)).some((f) => f.name === "Ok")).toBe(
        false,
    );
    expect((await foods.listFoods(HH)).some((f) => f.name === "Ok2")).toBe(
        false,
    );
});

test("createRecipe defaults to verified", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Handmade",
        yieldPortions: 2,
    });
    expect(recipe.verification).toBe("verified");
});

test("importRecipeFromText verifies a complete recipe on import", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const result = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Raw caption",
            instructions: "1. Mix\n2. Bake",
            name: "Complete",
            ingredients: [{ name: "Flour", amount: 200, unit: "g" }],
        },
        { lookup: async () => null },
    );
    expect(result.verification).toBe("verified");
    expect(result.problems).toHaveLength(0);
    const imp = await store.getImport(HH, result.recipe.id);
    expect(imp?.sourceKind).toBe("text");
    expect(imp?.sourceText).toBe("Raw caption");
});

test("importRecipeFromText stays unverified when instructions are missing", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const result = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Caption only",
            instructions: "",
            name: "Incomplete",
            ingredients: [{ name: "Flour", amount: 200, unit: "g" }],
        },
        { lookup: async () => null },
    );
    expect(result.verification).toBe("unverified");
    expect(result.problems.some((p) => p.code === "no_instructions")).toBe(
        true,
    );
});

test("importRecipeFromText without instructions field keeps source text separate", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const result = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Raw caption only",
            name: "No steps param",
            ingredients: [{ name: "Flour", amount: 100, unit: "g" }],
        },
        { lookup: async () => null },
    );
    expect(result.recipe.instructions).toBeNull();
    expect(result.verification).toBe("unverified");
    expect(result.problems.some((p) => p.code === "no_instructions")).toBe(
        true,
    );
    const imp = await store.getImport(HH, result.recipe.id);
    expect(imp?.sourceText).toBe("Raw caption only");
});

test("addRecipeManualIngredient with unmeasured amount stores to taste", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Seasoned",
        yieldPortions: 2,
        instructions: "1. Mix",
    });
    const ingredient = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Salt",
        amount: null,
    });
    expect(ingredient.quantity).toBeNull();
    expect(ingredient.note).toBe("to taste");
    const saved = await store.getRecipe(HH, recipe.id);
    expect(saved?.verification).toBe("verified");
});

test("updateRecipeIngredient clearing amount with blank note stores to taste", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Adjustable",
        yieldPortions: 2,
        instructions: "1. Stir",
    });
    const ingredient = await addRecipeManualIngredient(store, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Pepper",
        amount: 1,
        unit: "g",
    });
    const updated = await updateRecipeIngredient(
        store,
        HH,
        recipe.id,
        ingredient.id,
        { amount: null, note: "" },
        foods,
    );
    expect(updated.quantity).toBeNull();
    expect(updated.note).toBe("to taste");
    const saved = await store.getRecipe(HH, recipe.id);
    expect(saved?.verification).toBe("verified");
});

test("editing an unverified recipe until complete verifies it", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const result = await importRecipeFromText(
        store,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "Paste",
            instructions: "",
            name: "Fix me",
            ingredients: [{ name: "Flour", amount: 100, unit: "g" }],
        },
        { lookup: async () => null },
    );
    expect(result.recipe.verification).toBe("unverified");
    await updateRecipe(store, HH, result.recipe.id, {
        instructions: "1. Stir\n2. Serve",
    });
    const saved = await store.getRecipe(HH, result.recipe.id);
    expect(saved?.verification).toBe("verified");
});

test("editing a verified recipe keeps it verified", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Stable",
        yieldPortions: 1,
        instructions: "1. Go",
    });
    await updateRecipe(store, HH, recipe.id, { name: "Stable v2" });
    const saved = await store.getRecipe(HH, recipe.id);
    expect(saved?.verification).toBe("verified");
});

test("ingredient edits bump updatedAt on memory store", async () => {
    const store = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const recipe = await createRecipe(store, {
        householdId: HH,
        creatorId: ALICE,
        name: "Bump",
        yieldPortions: 1,
    });
    const before = recipe.updatedAt;
    setSystemTime(new Date(Date.parse(before) + 5));
    try {
        await addRecipeManualIngredient(store, foods, {
            householdId: HH,
            recipeId: recipe.id,
            name: "Flour",
            amount: 10,
            unit: "g",
        });
    } finally {
        setSystemTime();
    }
    const saved = await store.getRecipe(HH, recipe.id);
    expect(saved!.updatedAt >= before).toBe(true);
    expect(saved!.updatedAt !== before).toBe(true);
});

test("addRecipeToGrocery throws RecipeUnverifiedError when unverified", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Shop");
    const imported = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "x",
            instructions: "",
            name: "Blocked grocery",
            ingredients: [{ name: "Flour", amount: 1, unit: "g" }],
        },
        { lookup: async () => null },
    );
    await expect(
        addRecipeToGrocery({
            recipes,
            grocery,
            settings,
            foods,
            householdId: HH,
            recipeId: imported.recipe.id,
            storeId: store.id,
            portionCounts: [1],
            foodsById: new Map(),
            fridgeItems: [],
        }),
    ).rejects.toBeInstanceOf(RecipeUnverifiedError);
});

test("cookRecipe throws RecipeUnverifiedError when unverified", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const imported = await importRecipeFromText(
        recipes,
        foods,
        {
            householdId: HH,
            creatorId: ALICE,
            text: "x",
            instructions: "",
            name: "Blocked cook",
            ingredients: [{ name: "Flour", amount: 1, unit: "g" }],
        },
        { lookup: async () => null },
    );
    await expect(
        cookRecipe(recipes, fridge, stock, foods, {
            householdId: HH,
            recipeId: imported.recipe.id,
            totalPortions: 1,
            deductStock: false,
        }),
    ).rejects.toBeInstanceOf(RecipeUnverifiedError);
});

test("recipeCanMakeNow and verification filter ignore unverified recipes", async () => {
    const recipe = {
        id: "r1",
        householdId: HH,
        creatorId: ALICE,
        name: "X",
        yieldPortions: 1,
        instructions: "1. Go",
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "unverified" as const,
        updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(recipeCanMakeNow(recipe, [], [], new Map())).toBe(false);
    const base = {
        canMakeNow: false,
        safeFor: null,
    };
    expect(
        recipeMatchesFilter(recipe, [], new Map(), [], {
            ...base,
            verification: "verified",
        }),
    ).toBe(false);
    expect(
        recipeMatchesFilter(recipe, [], new Map(), [], {
            ...base,
            verification: "unverified",
        }),
    ).toBe(true);
});

const verifiedRecipeBase = {
    id: "r-filter",
    householdId: HH,
    creatorId: ALICE,
    name: "Filter test",
    yieldPortions: 2,
    instructions: "Go",
    sourceUrl: null,
    tags: [],
    notes: null,
    prepMinutes: null as number | null,
    cookMinutes: null as number | null,
    verification: "verified" as const,
    updatedAt: "2026-01-01T00:00:00.000Z",
};

const emptyMacros = {
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
};

test("recipeTotalMinutes sums prep and cook when both known", () => {
    expect(
        recipeTotalMinutes({
            ...verifiedRecipeBase,
            prepMinutes: 10,
            cookMinutes: 15,
        }),
    ).toBe(25);
    expect(recipeTotalMinutes({ ...verifiedRecipeBase, prepMinutes: 5 })).toBe(
        null,
    );
    expect(
        recipeTotalMinutes({ ...verifiedRecipeBase, cookMinutes: 20 }),
    ).toBeNull();
    expect(recipeTotalMinutes(verifiedRecipeBase)).toBeNull();
});

test("recipeHighProtein uses 25% kcal from protein boundary", () => {
    expect(
        recipeHighProtein({ ...emptyMacros, calories: 400, protein_g: 25 }),
    ).toBe(true);
    expect(
        recipeHighProtein({ ...emptyMacros, calories: 400, protein_g: 24.9 }),
    ).toBe(false);
    expect(
        recipeHighProtein({ ...emptyMacros, calories: null, protein_g: 30 }),
    ).toBe(false);
    expect(
        recipeHighProtein({ ...emptyMacros, calories: 400, protein_g: null }),
    ).toBe(false);
});

test("recipeFilters cookable, quick, and missing count", () => {
    const flour = recipeIngredientFromRow({
        id: "i1",
        household_id: HH,
        recipe_id: verifiedRecipeBase.id,
        kind: "food",
        display_name: "Flour",
        amount: 200,
        unit: "g",
        sort_order: 0,
        food_id: "f-flour",
    });
    const eggs = recipeIngredientFromRow({
        id: "i2",
        household_id: HH,
        recipe_id: verifiedRecipeBase.id,
        kind: "food",
        display_name: "Eggs",
        amount: 2,
        unit: "each",
        sort_order: 1,
        food_id: "f-eggs",
    });
    const stock = [{ quantity: { amount: 500, unit: "g" }, foodId: "f-flour" }];
    const foods = new Map([
        [
            "f-flour",
            {
                id: "f-flour",
                name: "Flour",
                grams_per_each: null,
                grams_per_ml: null,
            },
        ],
        [
            "f-eggs",
            {
                id: "f-eggs",
                name: "Eggs",
                grams_per_each: 50,
                grams_per_ml: null,
            },
        ],
    ] as const);
    const [flags] = recipeFilters(
        [
            {
                recipe: {
                    ...verifiedRecipeBase,
                    prepMinutes: 10,
                    cookMinutes: 15,
                },
                ingredients: [flour, eggs],
                macrosPerPortion: {
                    ...emptyMacros,
                    calories: 200,
                    protein_g: 10,
                    incomplete: false,
                },
            },
        ],
        stock,
        foods as never,
    );
    expect(flags?.cookable).toBe(false);
    expect(flags?.missingCount).toBe(1);
    expect(flags?.quick).toBe(true);
    expect(flags?.highProtein).toBe(false);

    const [cookable] = recipeFilters(
        [
            {
                recipe: {
                    ...verifiedRecipeBase,
                    prepMinutes: 45,
                    cookMinutes: null,
                },
                ingredients: [flour],
                macrosPerPortion: {
                    ...emptyMacros,
                    calories: 100,
                    protein_g: 30,
                    incomplete: false,
                },
            },
        ],
        stock,
        foods as never,
    );
    expect(cookable?.cookable).toBe(true);
    expect(cookable?.missingCount).toBe(0);
    expect(cookable?.quick).toBe(false);

    const [partialTime] = recipeFilters(
        [
            {
                recipe: {
                    ...verifiedRecipeBase,
                    prepMinutes: 10,
                    cookMinutes: null,
                },
                ingredients: [flour],
                macrosPerPortion: emptyMacros,
            },
        ],
        stock,
        foods as never,
    );
    expect(partialTime?.quick).toBe(false);
    expect(cookable?.quick).toBe(false);
    expect(cookable?.highProtein).toBe(true);
});
