import { test, expect } from "bun:test";
import { addLocation, createMemoryFridgeStore, listFridge } from "./fridge.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    updateFood,
} from "./foods.js";
import {
    addGroceryManualFood,
    createMemoryGroceryStore,
    listGrocery,
} from "./grocery.js";
import {
    addRecipeManualIngredient,
    createMemoryRecipesStore,
    createRecipe,
} from "./recipes.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    addFridgeItemAdjust,
    applyMovement,
    cookRecipe,
    createMemoryStockStore,
    deleteFridgeItemAdjust,
    eatFridgeItem,
    fridgeEatLogsMeal,
    ledgerMatchesStock,
    expiryLevel,
    listExpiring,
    utcTodayFromDate,
    putAwayGroceryLines,
    updateFridgeItemQuantityAdjust,
} from "./stock.js";

const HH = "hh-1";

test("put-away merges into existing stock with a compatible unit", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const milk = await findOrCreateManualFood(foods, HH, "food", "Milk");
    const milkFood = await updateFood(foods, HH, milk.id, {
        defaultUnit: "g",
        gramsPerMl: 1.03,
    });
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: milk.id,
        delta: 500,
        unit: "g",
        reason: "purchase",
        locationId: loc.id,
    });
    const store = await createGroceryStore(settings, HH, "Safeway");
    const line = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Milk",
        amount: 1,
        unit: "cup",
    });
    expect(line.foodId).toBe(milkFood.id);
    await putAwayGroceryLines(grocery, fridge, stock, foods, {
        householdId: HH,
        lineIds: [line.id],
        locationId: loc.id,
    });
    const listed = await listFridge(fridge, HH);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.foodId).toBe(milkFood.id);
    expect(listed.items[0]?.quantity).toEqual({ amount: 747.2, unit: "g" });
    expect((await listGrocery(grocery, settings, HH)).lines).toEqual([]);
    expect(
        ledgerMatchesStock(
            listed.items,
            await stock.listMovements(HH),
            milkFood,
        ),
    ).toBe(true);
});

test("cook deducts oldest-expiry first and reports a shortfall", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggsFood = await updateFood(foods, HH, eggs.id, {
        defaultUnit: "each",
        gramsPerEach: 50,
    });
    const older = await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: eggs.id,
        delta: 4,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        expiresOn: "2026-01-01",
    });
    const newer = await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: eggs.id,
        delta: 4,
        unit: "each",
        reason: "purchase",
        locationId: loc.id,
        expiresOn: "2026-12-01",
    });
    expect(older.item?.id).not.toBe(newer.item?.id);
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Omelette",
        yieldPortions: 1,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Eggs",
        amount: 6,
        unit: "each",
    });
    const first = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    expect(first.shortfalls).toEqual([]);
    const afterFirst = await listFridge(fridge, HH);
    expect(afterFirst.items).toHaveLength(1);
    expect(afterFirst.items[0]?.id).toBe(newer.item?.id);
    expect(afterFirst.items[0]?.quantity).toEqual({ amount: 2, unit: "each" });
    expect(afterFirst.items.some((item) => item.id === older.item?.id)).toBe(
        false,
    );

    const second = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    expect(second.shortfalls).toEqual([
        {
            foodId: eggsFood.id,
            displayName: eggs.name,
            amount: 4,
            unit: "each",
        },
    ]);
    expect((await listFridge(fridge, HH)).items).toEqual([]);
    expect(
        ledgerMatchesStock(
            (await listFridge(fridge, HH)).items,
            await stock.listMovements(HH),
            eggsFood,
        ),
    ).toBe(true);
});

test("ledger sum equals current state across purchases and cooks", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Pantry");
    const oats = await findOrCreateManualFood(foods, HH, "food", "Oats");
    await updateFood(foods, HH, oats.id, { defaultUnit: "g" });
    const purchases = [80, 120, 40, 200, 15];
    const cooks = [30, 90, 50, 10];
    for (const amount of purchases) {
        await applyMovement(fridge, stock, foods, {
            householdId: HH,
            foodId: oats.id,
            delta: amount,
            unit: "g",
            reason: "purchase",
            locationId: loc.id,
        });
    }
    for (const amount of cooks) {
        await applyMovement(fridge, stock, foods, {
            householdId: HH,
            foodId: oats.id,
            delta: -amount,
            unit: "g",
            reason: "cook",
        });
    }
    const items = (await listFridge(fridge, HH)).items;
    const movements = await stock.listMovements(HH, oats.id);
    expect(ledgerMatchesStock(items, movements, oats)).toBe(true);
    const expected =
        purchases.reduce((a, b) => a + b, 0) - cooks.reduce((a, b) => a + b, 0);
    expect(items[0]?.quantity).toEqual({ amount: expected, unit: "g" });
    const ledger = movements.reduce((sum, row) => sum + row.delta, 0);
    expect(ledger).toBe(expected);
});

test("expiryLevel uses UTC-day boundaries", () => {
    const today = utcTodayFromDate(new Date("2026-10-05T12:00:00.000Z"));
    expect(today).toBe("2026-10-05");
    expect(expiryLevel(null, today)).toBe(null);
    expect(expiryLevel("2026-10-03", today)).toBe("expired");
    expect(expiryLevel("2026-10-04", today)).toBe("expired");
    expect(expiryLevel("2026-10-05", today)).toBe("high");
    expect(expiryLevel("2026-10-06", today)).toBe("high");
    expect(expiryLevel("2026-10-07", today)).toBe("medium");
    expect(expiryLevel("2026-10-08", today)).toBe("medium");
    expect(expiryLevel("2026-10-09", today)).toBe("low");
    expect(expiryLevel("2026-10-12", today)).toBe("low");
    expect(expiryLevel("2026-10-13", today)).toBe(null);
});

test("list_expiring includes items within the window, oldest first", () => {
    const now = new Date("2026-10-05T12:00:00.000Z");
    const listed = listExpiring(
        [
            {
                id: "later",
                householdId: HH,
                locationId: "loc",
                kind: "food",
                displayName: "Yogurt",
                quantity: { amount: 1, unit: "each" },
                identity: {
                    kind: "food",
                    via: "catalog",
                    source: "foodable",
                    sourceId: "f1",
                    displayName: "Yogurt",
                },
                foodId: "f1",
                expiresOn: "2026-10-20",
            },
            {
                id: "soon",
                householdId: HH,
                locationId: "loc",
                kind: "food",
                displayName: "Milk",
                quantity: { amount: 1, unit: "l" },
                identity: {
                    kind: "food",
                    via: "catalog",
                    source: "foodable",
                    sourceId: "f2",
                    displayName: "Milk",
                },
                foodId: "f2",
                expiresOn: "2026-10-07",
            },
            {
                id: "none",
                householdId: HH,
                locationId: "loc",
                kind: "food",
                displayName: "Rice",
                quantity: { amount: 500, unit: "g" },
                identity: {
                    kind: "food",
                    via: "catalog",
                    source: "foodable",
                    sourceId: "f3",
                    displayName: "Rice",
                },
                foodId: "f3",
            },
        ],
        3,
        now,
    );
    expect(listed.map((item) => item.id)).toEqual(["soon"]);
});

test("manual add writes an adjust movement and the ledger matches stock", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const milk = await findOrCreateManualFood(foods, HH, "food", "Milk");
    const milkFood = await updateFood(foods, HH, milk.id, { defaultUnit: "g" });
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: milk.id,
        amount: 200,
        unit: "g",
        locationId: loc.id,
        actorUserId: "u1",
    });
    expect(added.item?.quantity).toEqual({ amount: 200, unit: "g" });
    expect(added.movement.reason).toBe("adjust");
    expect(added.movement.delta).toBe(200);
    expect(added.movement.actorUserId).toBe("u1");
    const items = (await listFridge(fridge, HH)).items;
    const movements = await stock.listMovements(HH, milk.id);
    expect(ledgerMatchesStock(items, movements, milkFood)).toBe(true);
});

test("manual update writes an adjust movement and the ledger matches stock", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
    const eggsFood = await updateFood(foods, HH, eggs.id, {
        defaultUnit: "each",
        gramsPerEach: 50,
    });
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: eggs.id,
        amount: 6,
        unit: "each",
        locationId: loc.id,
    });
    const updated = await updateFridgeItemQuantityAdjust(fridge, stock, foods, {
        householdId: HH,
        itemId: added.item!.id,
        amount: 4,
        unit: "each",
        actorUserId: "u1",
    });
    expect(updated?.quantity).toEqual({ amount: 4, unit: "each" });
    const movements = await stock.listMovements(HH, eggs.id);
    expect(movements.every((row) => row.reason === "adjust")).toBe(true);
    expect(movements.reduce((sum, row) => sum + row.delta, 0)).toBe(4);
    expect(
        ledgerMatchesStock(
            (await listFridge(fridge, HH)).items,
            movements,
            eggsFood,
        ),
    ).toBe(true);
});

test("fridgeEatLogsMeal is false for household supplies", () => {
    expect(fridgeEatLogsMeal({ kind: "supply" })).toBe(false);
    expect(fridgeEatLogsMeal({ kind: "food" })).toBe(true);
});

test("eatFridgeItem on a supply writes an eat movement and the ledger matches", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Pantry");
    const towels = await findOrCreateManualFood(
        foods,
        HH,
        "supply",
        "Paper towels",
    );
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: towels.id,
        amount: 2,
        unit: "roll",
        locationId: loc.id,
    });
    const eaten = await eatFridgeItem(fridge, stock, foods, {
        householdId: HH,
        itemId: added.item!.id,
        amount: 1,
        actorUserId: "u1",
    });
    expect(eaten.movement.reason).toBe("eat");
    expect(eaten.movement.delta).toBe(-1);
    const items = (await listFridge(fridge, HH)).items;
    expect(items[0]?.quantity.amount).toBe(1);
    const movements = await stock.listMovements(HH, towels.id);
    expect(ledgerMatchesStock(items, movements, towels)).toBe(true);
    expect(fridgeEatLogsMeal(towels)).toBe(false);
});

test("manual delete writes an adjust movement and the ledger matches stock", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Pantry");
    const foil = await findOrCreateManualFood(foods, HH, "supply", "Foil");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: foil.id,
        amount: 2,
        unit: "roll",
        locationId: loc.id,
    });
    expect(
        await deleteFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            itemId: added.item!.id,
            actorUserId: "u1",
        }),
    ).toBe(true);
    expect((await listFridge(fridge, HH)).items).toEqual([]);
    const movements = await stock.listMovements(HH, foil.id);
    expect(movements.every((row) => row.reason === "adjust")).toBe(true);
    expect(movements.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
    expect(ledgerMatchesStock([], movements, foil)).toBe(true);
    expect(
        await deleteFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            itemId: added.item!.id,
        }),
    ).toBe(false);
});
