import { test, expect } from "bun:test";
import { addLocation, createMemoryFridgeStore, listFridge } from "./fridge.js";
import {
    createMemoryFoodsStore,
    createProduct,
    effectiveFoodsByIds,
    findOrCreateManualFood,
    newFood,
    setUsualProduct,
    type Food,
} from "./foods.js";
import {
    addGroceryManualFood,
    createMemoryGroceryStore,
    suggestGrocerySection,
} from "./grocery.js";
import { alreadyHaveTag } from "./linking.js";
import { resolveAndBuildMeal } from "./meals.js";
import {
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createMemoryRecipesStore,
    createRecipe,
    ingredientGaps,
    listRecipesFiltered,
    macrosForPerson,
    recipeCanMakeNow,
    recipeIsSafeFor,
} from "./recipes.js";
import { groceryAllergenWarning } from "./grocery.js";
import { addAllergen, createMemoryRulesStore } from "./rules.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    addFridgeItemAdjust,
    applyMovement,
    cookRecipe,
    createMemoryStockStore,
    ledgerMatchesStock,
    putAwayGroceryLines,
    eatFridgeItem,
    updateFridgeItemQuantityAdjust,
} from "./stock.js";

const HH = "hh-usual";

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

async function plainEggs(store: ReturnType<typeof createMemoryFoodsStore>) {
    return findOrCreateManualFood(store, HH, "food", "Eggs");
}

async function productEggs(
    store: ReturnType<typeof createMemoryFoodsStore>,
    plain: Food,
    over: {
        name: string;
        calories?: number;
        proteinG?: number;
        gramsPerEach?: number | null;
    },
) {
    return createProduct(store, HH, plain.id, {
        name: over.name,
        defaultUnit: "each",
        calories: over.calories ?? 140,
        proteinG: over.proteinG ?? 12,
        carbsG: 1,
        fatG: 10,
        nutritionSource: "manual",
        gramsPerEach: over.gramsPerEach ?? 50,
    });
}

test("switching the usual changes recipe macros", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const plain = await plainEggs(foods);
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Scramble",
        yieldPortions: 1,
    });
    const ingredient = await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 2,
        unit: "each",
    });
    let catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    expect(ingredientGaps(ingredient, catalog.get(plain.id))).toContain(
        "nutrition",
    );
    const incomplete = macrosForPerson([ingredient], 1, 1, catalog);
    expect(incomplete.incomplete).toBe(true);

    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland Large Eggs",
        calories: 140,
        proteinG: 12,
        gramsPerEach: 50,
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const withKirkland = macrosForPerson([ingredient], 1, 1, catalog);
    expect(withKirkland.incomplete).toBe(false);
    expect(withKirkland.calories).toBe(140);

    const greatValue = await productEggs(foods, plain, {
        name: "Great Value Eggs",
        calories: 160,
        proteinG: 14,
        gramsPerEach: 55,
    });
    await setUsualProduct(foods, HH, plain.id, greatValue.id);
    catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const withGv = macrosForPerson([ingredient], 1, 1, catalog);
    expect(withGv.calories).toBe(176);
    expect(withGv.protein_g).toBe(15.4);
});

test("logged meal snapshot keeps numbers after usual product switches", async () => {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        calories: 140,
        proteinG: 12,
        gramsPerEach: 50,
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);

    const { built: logged } = await resolveAndBuildMeal({
        householdId: HH,
        foods,
        recipes,
        items: [{ foodId: plain.id, amount: 2, unit: "each" }],
    });

    const greatValue = await productEggs(foods, plain, {
        name: "Great Value",
        calories: 90,
        proteinG: 8,
        gramsPerEach: 60,
    });
    await setUsualProduct(foods, HH, plain.id, greatValue.id);

    expect(logged.totals.calories).toBe(140);
    expect(logged.items[0]?.calories).toBe(140);
    expect(logged.items[0]?.protein_g).toBe(12);
});

test("fridge product covers plain food need while another product is usual", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        gramsPerEach: 50,
    });
    const greatValue = await productEggs(foods, plain, {
        name: "Great Value",
        gramsPerEach: 50,
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    const catalog = await effectiveFoodsByIds(foods, HH, [
        plain.id,
        greatValue.id,
    ]);
    const stock = [
        {
            foodId: greatValue.id,
            quantity: { amount: 12, unit: "each" },
        },
    ];
    const tag = alreadyHaveTag(
        {
            foodId: plain.id,
            quantity: { amount: 6, unit: "each" },
        },
        stock,
        catalog,
    );
    expect(tag).toEqual({ cover: "full" });
    expect(
        recipeCanMakeNow(
            { verification: "verified" } as import("./recipes.js").Recipe,
            [
                {
                    id: "i1",
                    householdId: HH,
                    recipeId: "r1",
                    kind: "food",
                    displayName: "Eggs",
                    quantity: { amount: 6, unit: "each" },
                    foodId: plain.id,
                    sortOrder: 0,
                    note: null,
                },
            ],
            stock,
            catalog,
        ),
    ).toBe(true);
});

test("unit conversion across family uses product factors with plain fallback", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await storeWithPlainFallback(foods);
    const withFactor = await createProduct(foods, HH, plain.id, {
        name: "Carton A",
        defaultUnit: "each",
        gramsPerEach: 55,
        calories: 70,
        nutritionSource: "manual",
    });
    const noFactor = await createProduct(foods, HH, plain.id, {
        name: "Carton B",
        defaultUnit: "each",
        calories: 70,
        nutritionSource: "manual",
    });
    const catalog = await effectiveFoodsByIds(foods, HH, [
        plain.id,
        withFactor.id,
        noFactor.id,
    ]);
    expect(
        alreadyHaveTag(
            {
                foodId: plain.id,
                quantity: { amount: 100, unit: "g" },
            },
            [
                {
                    foodId: withFactor.id,
                    quantity: { amount: 2, unit: "each" },
                },
            ],
            catalog,
        ),
    ).toEqual({ cover: "full" });
    expect(
        alreadyHaveTag(
            {
                foodId: plain.id,
                quantity: { amount: 100, unit: "g" },
            },
            [
                {
                    foodId: noFactor.id,
                    quantity: { amount: 2, unit: "each" },
                },
            ],
            catalog,
        ),
    ).toEqual({ cover: "full" });
});

async function storeWithPlainFallback(
    store: ReturnType<typeof createMemoryFoodsStore>,
) {
    return store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            gramsPerEach: 50,
        }),
    );
}

test("grocery aisle suggests section from family member line", () => {
    const dairyId = "sec-dairy";
    const sections = [
        {
            id: dairyId,
            householdId: HH,
            storeId: "store-1",
            name: "Dairy",
            sortOrder: 0,
            hidden: false,
            isOther: false,
        },
        {
            id: "sec-other",
            householdId: HH,
            storeId: "store-1",
            name: "Other",
            sortOrder: 1,
            hidden: false,
            isOther: true,
        },
    ];
    const kirklandId = "food-kirkland";
    const plainId = "food-eggs";
    const familyById = new Map([
        [kirklandId, plainId],
        [plainId, plainId],
    ]);
    const lines = [
        {
            id: "line-1",
            householdId: HH,
            storeId: "store-1",
            sectionId: dairyId,
            kind: "food" as const,
            displayName: "Kirkland Large Eggs",
            quantity: { amount: 1, unit: "each" },
            foodId: kirklandId,
            checked: false,
            source: "manual" as const,
            sourceFridgeItemId: null,
            note: null,
        },
    ];
    const section = suggestGrocerySection({
        sections,
        lines,
        kind: "food",
        foodId: plainId,
        displayName: "Eggs",
        familyById,
    });
    expect(section?.id).toBe(dairyId);
});

test("cook draws across family oldest expiry first with per-food ledger", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await storeWithPlainFallback(foods);
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        gramsPerEach: 50,
    });
    const greatValue = await productEggs(foods, plain, {
        name: "Great Value",
        gramsPerEach: 50,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: kirkland.id,
        amount: 6,
        unit: "each",
        locationId: loc.id,
        expiresOn: "2026-12-01",
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: greatValue.id,
        amount: 4,
        unit: "each",
        locationId: loc.id,
        expiresOn: "2026-06-01",
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 2,
        unit: "each",
        locationId: loc.id,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Big scramble",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 8,
        unit: "each",
    });
    const result = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    expect(result.shortfalls).toEqual([]);
    const listed = await listFridge(fridge, HH);
    const gv = listed.items.find((i) => i.foodId === greatValue.id);
    const k = listed.items.find((i) => i.foodId === kirkland.id);
    const p = listed.items.find((i) => i.foodId === plain.id);
    expect(gv).toBeUndefined();
    expect(k?.quantity).toEqual({ amount: 2, unit: "each" });
    expect(p?.quantity).toEqual({ amount: 2, unit: "each" });
    const movements = await stock.listMovements(HH);
    for (const foodId of [plain.id, kirkland.id, greatValue.id]) {
        const food = (await foods.getFood(HH, foodId))!;
        expect(ledgerMatchesStock(listed.items, movements, food)).toBe(true);
    }
});

test("cook across family with mixed units", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            defaultUnit: "each",
            gramsPerEach: 50,
        }),
    );
    const product = await createProduct(foods, HH, plain.id, {
        name: "Loose",
        defaultUnit: "g",
        calories: 1,
        nutritionSource: "manual",
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: product.id,
        amount: 150,
        unit: "g",
        locationId: loc.id,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 2,
        unit: "each",
        locationId: loc.id,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Mix",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 5,
        unit: "each",
    });
    const result = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    expect(result.shortfalls).toEqual([]);
});

test("cook shortfall reports need unit against decremented food", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    const product = await productEggs(foods, plain, {
        name: "Brand",
        gramsPerEach: 50,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: product.id,
        amount: 2,
        unit: "each",
        locationId: loc.id,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Need many",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 6,
        unit: "each",
    });
    const result = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    expect(result.shortfalls[0]?.amount).toBe(4);
    expect(result.shortfalls[0]?.unit).toBe("each");
});

test("single-food cook still writes one movement", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const oats = await findOrCreateManualFood(foods, HH, "food", "Oats");
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: oats.id,
        amount: 200,
        unit: "g",
        locationId: loc.id,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Porridge",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Oats",
        amount: 50,
        unit: "g",
    });
    await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    const cookMovements = (await stock.listMovements(HH, oats.id)).filter(
        (m) => m.reason === "cook",
    );
    expect(cookMovements).toHaveLength(1);
    expect(cookMovements[0]).toMatchObject({
        foodId: oats.id,
        delta: -50,
        unit: "g",
        reason: "cook",
    });
});

test("targeted eat touches only the chosen item", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        gramsPerEach: 50,
    });
    const other = await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: kirkland.id,
        delta: 6,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: kirkland.id,
        delta: 4,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        expiresOn: "2027-01-01",
    });
    await eatFridgeItem(fridge, stock, foods, {
        householdId: HH,
        itemId: other.item!.id,
        amount: 1,
    });
    const listed = await listFridge(fridge, HH);
    expect(listed.items).toHaveLength(2);
    const touched = listed.items.find((i) => i.id === other.item!.id);
    expect(touched?.quantity.amount).toBe(5);
});

test("put-away uses usual product by default and honors override", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, { name: "Kirkland" });
    const greatValue = await productEggs(foods, plain, {
        name: "Great Value",
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    const store = await createGroceryStore(settings, HH, "Shop");
    const line = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Eggs",
        amount: 1,
        unit: "each",
    });
    const defaultPut = (
        await putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [line.id],
            locationId: loc.id,
        })
    )[0]!;
    expect(defaultPut.productFoodId).toBe(kirkland.id);
    expect(defaultPut.item?.foodId).toBe(kirkland.id);

    const line2 = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Eggs",
        amount: 1,
        unit: "each",
    });
    const overridePut = (
        await putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [line2.id],
            locationId: loc.id,
            productFoodIds: { [line2.id]: greatValue.id },
        })
    )[0]!;
    expect(overridePut.productFoodId).toBe(greatValue.id);
});

test("put-away without usual records plain food; wrong family rejected", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    await productEggs(foods, plain, { name: "Kirkland" });
    const milk = await findOrCreateManualFood(foods, HH, "food", "Milk");
    const store = await createGroceryStore(settings, HH, "Shop");
    const line = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Eggs",
        amount: 1,
        unit: "each",
    });
    const noUsual = (
        await putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [line.id],
            locationId: loc.id,
        })
    )[0]!;
    expect(noUsual.productFoodId).toBe(plain.id);

    const line2 = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Eggs",
        amount: 1,
        unit: "each",
    });
    await expect(
        putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [line2.id],
            locationId: loc.id,
            productFoodIds: { [line2.id]: milk.id },
        }),
    ).rejects.toThrow("not one of");
    expect((await grocery.listLines(HH)).some((l) => l.id === line2.id)).toBe(
        true,
    );
});

test("cook ledger uses per-item movement when merged factors differ from raw food", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        gramsPerEach: 60,
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 2,
        unit: "each",
        locationId: loc.id,
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        delta: -80,
        unit: "g",
        reason: "cook",
        recipeId: "recipe-1",
    });
    const listed = await listFridge(fridge, HH);
    const item = listed.items.find((i) => i.foodId === plain.id);
    expect(item?.quantity.amount).toBe(0.7);
    const movements = (await stock.listMovements(HH)).filter(
        (m) => m.reason === "cook",
    );
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
        foodId: plain.id,
        unit: "each",
        delta: -1.3,
    });
    for (const foodId of [plain.id, kirkland.id]) {
        const food = (await foods.getFood(HH, foodId))!;
        expect(ledgerMatchesStock(listed.items, movements, food)).toBe(true);
    }
});

test("targeted quantity adjust uses merged factors and keeps ledger true", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            defaultUnit: "each",
            gramsPerEach: 40,
        }),
    );
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        gramsPerEach: 60,
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 2,
        unit: "each",
        locationId: loc.id,
    });
    await updateFridgeItemQuantityAdjust(fridge, stock, foods, {
        householdId: HH,
        itemId: added.item!.id,
        amount: 50,
        unit: "g",
    });
    const listed = await listFridge(fridge, HH);
    const item = listed.items.find((i) => i.id === added.item!.id);
    expect(item?.quantity).toEqual({ amount: 1.3, unit: "each" });
    const movements = await stock.listMovements(HH);
    for (const foodId of [plain.id, kirkland.id]) {
        const food = (await foods.getFood(HH, foodId))!;
        expect(ledgerMatchesStock(listed.items, movements, food)).toBe(true);
    }
});

test("per-item cook movement delta matches actual item quantity change", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            defaultUnit: "g",
            gramsPerEach: 60,
        }),
    );
    const loose = await createProduct(foods, HH, plain.id, {
        name: "Loose grams",
        defaultUnit: "g",
        calories: 1,
        nutritionSource: "manual",
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: loose.id,
        amount: 333,
        unit: "g",
        locationId: loc.id,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Each need",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 2,
        unit: "each",
    });
    await setUsualProduct(foods, HH, plain.id, loose.id);
    await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    const listed = await listFridge(fridge, HH);
    const item = listed.items.find((i) => i.foodId === loose.id);
    expect(item).toBeDefined();
    const movements = await stock.listMovements(HH);
    const cookLine = movements.find(
        (m) => m.reason === "cook" && m.foodId === loose.id,
    );
    expect(cookLine?.delta).toBe(
        roundAmount((item?.quantity.amount ?? 0) - 333),
    );
    for (const foodId of [plain.id, loose.id]) {
        const food = (await foods.getFood(HH, foodId))!;
        expect(ledgerMatchesStock(listed.items, movements, food)).toBe(true);
    }
});

test("put-away picks line food location before first fridge location", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const door = await addLocation(fridge, HH, "Door");
    const main = await addLocation(fridge, HH, "Main");
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, { name: "Kirkland" });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 6,
        unit: "each",
        locationId: main.id,
    });
    const store = await createGroceryStore(settings, HH, "Shop");
    const line = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Eggs",
        amount: 1,
        unit: "each",
    });
    const put = (
        await putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [line.id],
        })
    )[0]!;
    expect(put.item?.locationId).toBe(main.id);
    expect(put.item?.locationId).not.toBe(door.id);
});

test("recipe list filters read effective catalog for make-now and allergens", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    const kirkland = await createProduct(foods, HH, plain.id, {
        name: "Kirkland",
        defaultUnit: "each",
        calories: 140,
        proteinG: 12,
        carbsG: 1,
        fatG: 10,
        nutritionSource: "manual",
        gramsPerEach: 50,
        allergens: ["peanut"],
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 100,
        unit: "g",
        locationId: loc.id,
    });
    const rules = createMemoryRulesStore();
    await addAllergen(rules, {
        householdId: HH,
        userId: "bob",
        allergen: "peanut",
    });
    const allergens = await rules.listAllergens(HH, "bob");
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Two eggs",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 2,
        unit: "each",
    });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const stockView = [
        { foodId: plain.id, quantity: { amount: 100, unit: "g" } },
    ];
    const ingredient = (await recipes.listIngredients(HH, recipe.id))[0]!;
    expect(recipeCanMakeNow(recipe, [ingredient], stockView, catalog)).toBe(
        true,
    );
    expect(
        recipeIsSafeFor([ingredient], catalog, {
            allergens,
            dislikes: [],
        }),
    ).toBe(false);
    const filtered = await listRecipesFiltered(
        recipes,
        HH,
        catalog,
        stockView,
        { tag: null, canMakeNow: true, safeFor: null },
    );
    expect(filtered.map((r) => r.id)).toContain(recipe.id);
    const safeFiltered = await listRecipesFiltered(
        recipes,
        HH,
        catalog,
        stockView,
        {
            tag: null,
            canMakeNow: false,
            safeFor: { allergens, dislikes: [] },
        },
    );
    expect(safeFiltered.map((r) => r.id)).not.toContain(recipe.id);
});

test("grocery allergen warning uses effective allergens", async () => {
    const foods = createMemoryFoodsStore();
    const rules = createMemoryRulesStore();
    const plain = await plainEggs(foods);
    const kirkland = await createProduct(foods, HH, plain.id, {
        name: "Kirkland",
        defaultUnit: "each",
        calories: 140,
        proteinG: 12,
        carbsG: 1,
        fatG: 10,
        nutritionSource: "manual",
        gramsPerEach: 50,
        allergens: ["peanut"],
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    await addAllergen(rules, {
        householdId: HH,
        userId: "bob",
        allergen: "peanut",
    });
    const allergens = await rules.listAllergens(HH, "bob");
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const warning = groceryAllergenWarning(
        "Eggs",
        [{ displayName: "Bob", allergens }],
        catalog.get(plain.id)?.allergens ?? null,
    );
    expect(warning?.blocking).toBe(true);
});

test("add recipe to grocery matches section from existing family line", async () => {
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const recipes = createMemoryRecipesStore();
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, { name: "Kirkland" });
    const store = await createGroceryStore(settings, HH, "Shop");
    const sections = await settings.listSections(store.id);
    const frozen = sections.find((row) => row.name === "Frozen")!;
    await grocery.insertLine({
        id: crypto.randomUUID(),
        householdId: HH,
        storeId: store.id,
        sectionId: frozen.id,
        kind: "food",
        displayName: "Kirkland Large Eggs",
        quantity: { amount: 1, unit: "each" },
        foodId: kirkland.id,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Scramble",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 6,
        unit: "each",
    });
    const catalog = await effectiveFoodsByIds(foods, HH, [plain.id]);
    const result = await addRecipeToGrocery({
        recipes,
        grocery,
        settings,
        fridgeItems: [],
        householdId: HH,
        recipeId: recipe.id,
        storeId: store.id,
        portionCounts: [1],
        foodsById: catalog,
        foods,
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.sectionId).toBe(frozen.id);
});

test("per-item movement round-trips the ledger in the product's default unit", async () => {
    for (const eggs of [0.1, 1, 2, 5, 5.6]) {
        const fridge = createMemoryFridgeStore();
        const stock = createMemoryStockStore();
        const foods = createMemoryFoodsStore();
        const loc = await addLocation(fridge, HH, "Fridge");
        const plain = await plainEggs(foods);
        const kirkland = await productEggs(foods, plain, {
            name: "Kirkland",
            gramsPerEach: 60,
        });
        await setUsualProduct(foods, HH, plain.id, kirkland.id);
        await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            foodId: kirkland.id,
            amount: 333,
            unit: "g",
            locationId: loc.id,
        });
        await applyMovement(fridge, stock, foods, {
            householdId: HH,
            foodId: plain.id,
            delta: -eggs,
            unit: "each",
            reason: "cook",
        });
        const listed = await listFridge(fridge, HH);
        const movements = await stock.listMovements(HH);
        const cook = movements.find((m) => m.reason === "cook");
        expect(cook?.foodId).toBe(kirkland.id);
        expect(cook?.unit).toBe("each");
        for (const food of [plain, kirkland]) {
            expect(ledgerMatchesStock(listed.items, movements, food)).toBe(
                true,
            );
        }
    }
});

test("a take that rounds away leaves the item and reports a shortfall", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const plain = await plainEggs(foods);
    const kirkland = await productEggs(foods, plain, {
        name: "Kirkland",
        gramsPerEach: 60,
    });
    await setUsualProduct(foods, HH, plain.id, kirkland.id);
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 2,
        unit: "each",
        locationId: loc.id,
    });
    const result = await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        delta: -3,
        unit: "g",
        reason: "cook",
    });
    expect(result.movements).toHaveLength(1);
    expect(result.movement.delta).toBe(0);
    expect(result.shortfall).toEqual({
        foodId: plain.id,
        displayName: plain.name,
        amount: 3,
        unit: "g",
    });
    const listed = await listFridge(fridge, HH);
    expect(listed.items.find((i) => i.foodId === plain.id)?.quantity).toEqual({
        amount: 2,
        unit: "each",
    });
    const movements = await stock.listMovements(HH);
    expect(ledgerMatchesStock(listed.items, movements, plain)).toBe(true);
});
