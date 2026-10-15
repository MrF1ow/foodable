import { test, expect } from "bun:test";
import type { FoodIdentity } from "./food-identity.js";
import {
    addFoodByBarcode,
    addLocation,
    createMemoryFridgeStore,
} from "./fridge.js";
import { createMemoryGroceryStore, listGrocery } from "./grocery.js";
import { recipeToGroceryRemainder } from "./linking.js";
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
    macrosForPerson,
    perPortionAmount,
    RecipeForbiddenError,
    RecipeInputError,
    resolveTotalPortions,
    removeRecipeIngredient,
    reorderRecipeIngredients,
    setPersonPortion,
    updateRecipe,
    updateRecipeIngredient,
} from "./recipes.js";
import { createMemoryFoodsStore, updateFood } from "./foods.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
} from "../web/pages/recipes.js";
import type { FoodResult } from "../foods.js";

const HH = "hh-1";
const ALICE = "alice";
const BOB = "bob";

const cottage: FoodIdentity = {
    kind: "food",
    via: "barcode",
    barcode: "070852010016",
    displayName: "Cottage Cheese",
};

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
    expect(perPortionAmount(ingredient.quantity.amount, 4)).toBe(100);
    expect(amountForPortion(ingredient.quantity.amount, 4, 1)).toBe(100);
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
    expect(macros.incompleteReasons).toEqual(["Eggs: set grams per each"]);
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
        identity: item.identity,
        quantity: item.quantity,
        foodId: item.foodId,
    }));
    const recipeRow = (await listRecipes(recipes, HH))[0]!;
    const ingredients = (await getRecipeView(recipes, HH, recipe.id, ALICE))
        .ingredients;
    const plan = recipeToGroceryRemainder({
        ingredients: ingredients.map((row) => ({
            identity: row.identity,
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
    expect(listed.lines[0]?.identity.via).toBe("catalog");
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
        chrome: { theme: "light" },
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
        chrome: { theme: "light" },
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
        },
        ingredients: [
            {
                id: "i1",
                householdId: HH,
                recipeId: "r1",
                kind: "food",
                displayName: "Cottage Cheese",
                quantity: { amount: 400, unit: "g" },
                identity: cottage,
                foodId: null,
                nutrition: {
                    calories: 98,
                    protein_g: 11,
                    carbs_g: 3,
                    fat_g: 4.3,
                    fiber_g: 0,
                    sugar_g: 3,
                    alcohol_g: null,
                    basisAmount: 100,
                    basisUnit: "g",
                },
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
            incompleteReasons: [],
        },
        allergenWarning: "Contains peanut — Bob.",
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
});

test("recipe pages group forms into cards and disclosures", () => {
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
    };
    const list = renderRecipesPage({
        chrome: { theme: "light" },
        recipes: [recipe],
        members: [],
        viewerId: "u1",
    } as never);
    expect(list).toContain('<ul class="recipe-list list">');
    expect(list).toContain(
        '<span class="recipe-tag pill pill-dim">dinner</span>',
    );
    expect(list).toContain("<summary>Filter</summary>");
    expect(list).toContain("<summary>New recipe</summary>");

    const detail = renderRecipeDetailPage({
        chrome: { theme: "light" },
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
            incompleteReasons: [],
        },
        isOwner: true,
    } as never);
    for (const heading of [
        "Nutrition",
        "Ingredients",
        "Cook and log",
        "Groceries",
    ]) {
        expect(detail).toContain(`<h2>${heading}</h2>`);
    }
    expect(detail).toContain('<ul class="recipe-ingredients list">');
    expect(detail).toContain('aria-label="Move Pasta up"');
    expect(detail).toContain("<summary>Edit recipe</summary>");
    expect(detail).toContain(
        '<button type="submit" class="btn-danger">Delete recipe</button>',
    );
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
    expect(noted.quantity.amount).toBe(120);
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
        identity: item.identity,
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
    expect(result.recipe.instructions).toBe("Pancakes\nMix and fry.");
    expect(result.recipe.sourceUrl).toBe("https://example.com/pancakes");
    expect(result.ingredients).toHaveLength(2);
    expect(result.ingredients[0]?.note).toBe("sifted");
    expect(result.ingredients[0]?.foodId).toBeTruthy();
    expect(result.ingredients[1]?.quantity.unit).toBe("ml");
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
