import { test, expect } from "bun:test";
import {
    addFoodById,
    addLocation,
    createMemoryFridgeStore,
    listFridge,
} from "./fridge.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    updateFood,
} from "./foods.js";
import {
    addGroceryManualFood,
    createMemoryGroceryStore,
    listGrocery,
    onGroceryList,
} from "./grocery.js";
import { noticeActionFor } from "../copy/notices.js";
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
    discardFridgeItem,
    eatFridgeItem,
    fridgeEatLogsMeal,
    fridgeNotices,
    ledgerMatchesStock,
    expiryLevel,
    listExpiring,
    utcTodayFromDate,
    putAwayGroceryLines,
    updateFridgeItemQuantityAdjust,
} from "./stock.js";
import { fridgeExpiryLine } from "../copy/notices.js";
import { householdTodayAt } from "../household.js";

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

test("cookRecipe skips unmeasured ingredients and lists them", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Soup",
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
    const loc = await addLocation(fridge, HH, "Pantry");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: salt.id,
        delta: 100,
        unit: "g",
        reason: "purchase",
        locationId: loc.id,
    });
    const movementsBefore = await stock.listMovements(HH);
    const cooked = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
    });
    expect(cooked.unmeasured).toEqual([
        { foodId: salt.id, displayName: salt.name },
    ]);
    const listed = await listFridge(fridge, HH);
    const item = listed.items.find((row) => row.foodId === salt.id);
    expect(item?.quantity.amount).toBe(100);
    expect(await stock.listMovements(HH)).toHaveLength(movementsBefore.length);
    expect(
        ledgerMatchesStock(listed.items, await stock.listMovements(HH), salt),
    ).toBe(true);
});

test("cookRecipe with deductStock false still lists unmeasured ingredients", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Soup",
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
    const cooked = await cookRecipe(recipes, fridge, stock, foods, {
        householdId: HH,
        recipeId: recipe.id,
        totalPortions: 1,
        deductStock: false,
    });
    expect(cooked.unmeasured).toEqual([
        { foodId: salt.id, displayName: salt.name },
    ]);
});

test("putAwayGroceryLines requires an amount for to-taste lines", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    const store = await createGroceryStore(settings, HH, "Shop");
    const sections = await settings.listSections(store.id);
    const line = await grocery.insertLine({
        id: crypto.randomUUID(),
        householdId: HH,
        storeId: store.id,
        sectionId: sections[0]!.id,
        kind: "food",
        displayName: "Salt",
        quantity: { amount: 1, unit: "g" },
        foodId: salt.id,
        checked: false,
        note: "to taste",
        source: "manual",
        sourceFridgeItemId: null,
    });
    await expect(
        putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [line.id],
        }),
    ).rejects.toThrow(/to taste/);
    for (const amount of [0, -500, Number.NaN]) {
        await expect(
            putAwayGroceryLines(grocery, fridge, stock, foods, {
                householdId: HH,
                lineIds: [line.id],
                amountOverrides: { [line.id]: { amount } },
            }),
        ).rejects.toThrow(/greater than zero/);
    }
    expect(await grocery.listLines(HH)).toHaveLength(1);
    expect(await stock.listMovements(HH, salt.id)).toHaveLength(0);
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

test("listExpiring horizon is today through today+days inclusive", () => {
    const today = "2026-10-05";
    const items = [
        {
            id: "edge",
            householdId: HH,
            locationId: "loc",
            kind: "food" as const,
            displayName: "Edge",
            quantity: { amount: 1, unit: "each" },
            foodId: "f1",
            expiresOn: "2026-10-08",
        },
        {
            id: "past",
            householdId: HH,
            locationId: "loc",
            kind: "food" as const,
            displayName: "Past",
            quantity: { amount: 1, unit: "each" },
            foodId: "f2",
            expiresOn: "2026-10-09",
        },
    ];
    const listed = listExpiring(items, today, 3);
    expect(listed.map((i) => i.id)).toEqual(["edge"]);
});

test("list_expiring includes items within the window, oldest first", () => {
    const today = "2026-10-05";
    const listed = listExpiring(
        [
            {
                id: "later",
                householdId: HH,
                locationId: "loc",
                kind: "food",
                displayName: "Yogurt",
                quantity: { amount: 1, unit: "each" },
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
                foodId: "f3",
            },
        ],
        today,
        3,
    );
    expect(listed.map((item) => item.id)).toEqual(["soon"]);
});

test("fridgeNotices respects household today not UTC midnight", () => {
    const item = {
        id: "i-la",
        kind: "food" as const,
        foodId: "f-milk",
        displayName: "Milk",
        quantity: { amount: 1, unit: "l" },
        expiresOn: "2026-11-07",
    };
    const laNow = new Date("2026-11-08T05:00:00.000Z");
    const householdToday = householdTodayAt(
        { timezone: "America/Los_Angeles" },
        null,
        laNow,
    );
    expect(householdToday).toBe("2026-11-07");
    const householdNotice = fridgeNotices([item], householdToday)[0];
    expect(householdNotice?.code).toBe("fridge.expiring");
    const utcToday = utcTodayFromDate(laNow);
    expect(utcToday).toBe("2026-11-08");
    const utcNotice = fridgeNotices([item], utcToday)[0];
    expect(utcNotice?.code).toBe("fridge.expired");

    const aucklandToday = householdTodayAt(
        { timezone: "Pacific/Auckland" },
        null,
        new Date("2026-11-07T12:00:00.000Z"),
    );
    expect(aucklandToday).toBe("2026-11-08");
    const aucklandNotice = fridgeNotices(
        [{ ...item, expiresOn: "2026-11-07" }],
        aucklandToday,
    )[0];
    expect(aucklandNotice?.code).toBe("fridge.expired");
});

test("fridgeNotices maps expiry levels to notice codes", () => {
    const today = "2026-11-06";
    const item = {
        id: "i1",
        kind: "food" as const,
        foodId: "f-eggs",
        displayName: "Eggs",
        quantity: { amount: 6, unit: "each" },
        expiresOn: "2026-11-05" as string,
    };
    const expired = fridgeNotices([item], today);
    expect(expired).toHaveLength(1);
    expect(expired[0]?.code).toBe("fridge.expired");
    expect(expired[0]?.severity).toBe("warn");
    expect(expired[0]?.subject).toEqual({
        kind: "fridge_item",
        id: "i1",
    });
    expect(expired[0]?.params).toEqual({
        name: "Eggs",
        amount: 6,
        unit: "each",
        expiresOn: "2026-11-05",
        level: "expired",
    });
    expect(
        fridgeExpiryLine({
            name: String(expired[0]!.params.name),
            amount: Number(expired[0]!.params.amount),
            unit: String(expired[0]!.params.unit),
            expiresOn: String(expired[0]!.params.expiresOn),
        }),
    ).toBe("Eggs 6 each expires 2026-11-05");

    expect(
        fridgeNotices(
            [
                {
                    ...item,
                    id: "a",
                    expiresOn: today,
                },
            ],
            today,
        )[0]?.code,
    ).toBe("fridge.expiring");
    expect(
        fridgeNotices([{ ...item, id: "a2", expiresOn: today }], today)[0]
            ?.severity,
    ).toBe("info");
    expect(
        fridgeNotices(
            [
                {
                    ...item,
                    id: "b",
                    expiresOn: "2026-11-07",
                },
            ],
            today,
        )[0]?.params.level,
    ).toBe("high");
    expect(
        fridgeNotices(
            [
                {
                    ...item,
                    id: "c",
                    expiresOn: "2026-11-09",
                },
            ],
            today,
        )[0]?.params.level,
    ).toBe("medium");
    expect(
        fridgeNotices(
            [
                {
                    ...item,
                    id: "d",
                    expiresOn: "2026-11-13",
                },
            ],
            today,
        )[0]?.params.level,
    ).toBe("low");
    expect(
        fridgeNotices(
            [
                {
                    ...item,
                    id: "e",
                    expiresOn: "2026-11-14",
                },
            ],
            today,
        ),
    ).toEqual([]);
    expect(
        fridgeNotices([{ ...item, id: "f", expiresOn: null }], today),
    ).toEqual([]);
});

test("fridgeNotices onGroceryList params gate the add action", () => {
    const today = "2026-11-06";
    const item = {
        id: "i1",
        kind: "food" as const,
        foodId: "f-prod",
        displayName: "Kirkland Eggs",
        quantity: { amount: 12, unit: "each" },
        expiresOn: "2026-11-05",
    };
    const foodsById = new Map([
        ["f-plain", { id: "f-plain", genericFoodId: null as string | null }],
        ["f-prod", { id: "f-prod", genericFoodId: "f-plain" as string | null }],
    ]);
    const notOnList = fridgeNotices([item], today, {
        lines: [],
        foodsById,
    })[0]!;
    expect(notOnList.params.onGroceryList).toBe("no");
    expect(noticeActionFor(notOnList)?.label).toBe("Add to grocery list");

    const onList = fridgeNotices([item], today, {
        lines: [{ foodId: "f-plain", checked: false }],
        foodsById,
    })[0]!;
    expect(onList.params.onGroceryList).toBe("yes");
    expect(noticeActionFor(onList)).toBeNull();

    expect(
        onGroceryList(
            { foodId: "f-prod" },
            [{ foodId: "f-plain", checked: false }],
            foodsById,
        ),
    ).toBe(true);
    expect(
        onGroceryList(
            { foodId: "f-prod" },
            [{ foodId: "f-plain", checked: true }],
            foodsById,
        ),
    ).toBe(false);
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

test("discardFridgeItem writes a discard movement and the ledger matches", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const yogurt = await findOrCreateManualFood(foods, HH, "food", "Yogurt");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: yogurt.id,
        amount: 3,
        unit: "g",
        locationId: loc.id,
    });
    const tossed = await discardFridgeItem(fridge, stock, foods, {
        householdId: HH,
        itemId: added.item!.id,
        amount: 2,
        actorUserId: "u1",
    });
    expect(tossed.movement.reason).toBe("discard");
    expect(tossed.movement.delta).toBe(-2);
    const items = (await listFridge(fridge, HH)).items;
    expect(items[0]?.quantity.amount).toBe(1);
    const movements = await stock.listMovements(HH, yogurt.id);
    expect(ledgerMatchesStock(items, movements, yogurt)).toBe(true);
    expect(fridgeEatLogsMeal(yogurt)).toBe(true);
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

test("eatFridgeItem rejects a non-positive amount", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const rice = await findOrCreateManualFood(foods, HH, "food", "Rice");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: rice.id,
        amount: 100,
        unit: "g",
        locationId: loc.id,
    });
    await expect(
        eatFridgeItem(fridge, stock, foods, {
            householdId: HH,
            itemId: added.item!.id,
            amount: -50,
        }),
    ).rejects.toThrow(/greater than zero/);
    const items = (await listFridge(fridge, HH)).items;
    expect(items[0]?.quantity.amount).toBe(100);
    expect(await stock.listMovements(HH)).toHaveLength(1);
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

test("manual update rejects an amount that rounds to zero", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const salt = await findOrCreateManualFood(foods, HH, "food", "Salt");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: salt.id,
        amount: 1,
        unit: "g",
        locationId: loc.id,
    });
    await expect(
        updateFridgeItemQuantityAdjust(fridge, stock, foods, {
            householdId: HH,
            itemId: added.item!.id,
            amount: 0.04,
            unit: "g",
        }),
    ).rejects.toThrow("Enter an amount greater than zero.");
    const items = (await listFridge(fridge, HH)).items;
    expect(items.map((item) => item.quantity)).toEqual([
        { amount: 1, unit: "g" },
    ]);
    expect(await stock.listMovements(HH, salt.id)).toHaveLength(1);
});

test("putAwayGroceryLines accepts per-line location and expiry", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const fridgeLoc = await addLocation(fridge, HH, "Fridge");
    const pantryLoc = await addLocation(fridge, HH, "Pantry");
    const apples = await findOrCreateManualFood(foods, HH, "food", "Apples");
    const oats = await findOrCreateManualFood(foods, HH, "food", "Oats");
    const store = await createGroceryStore(settings, HH, "Shop");
    const lineA = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Apples",
        amount: 3,
        unit: "each",
    });
    const lineB = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Oats",
        amount: 500,
        unit: "g",
    });
    await putAwayGroceryLines(grocery, fridge, stock, foods, {
        householdId: HH,
        lineIds: [lineA.id, lineB.id],
        perLine: {
            [lineA.id]: {
                locationId: fridgeLoc.id,
                expiresOn: "2026-07-01",
            },
            [lineB.id]: {
                locationId: pantryLoc.id,
                expiresOn: "2026-12-31",
            },
        },
    });
    const listed = await listFridge(fridge, HH);
    expect(listed.items).toHaveLength(2);
    const byFood = new Map(listed.items.map((item) => [item.foodId, item]));
    expect(byFood.get(apples.id)?.locationId).toBe(fridgeLoc.id);
    expect(byFood.get(apples.id)?.expiresOn).toBe("2026-07-01");
    expect(byFood.get(oats.id)?.locationId).toBe(pantryLoc.id);
    expect(byFood.get(oats.id)?.expiresOn).toBe("2026-12-31");
    expect((await listGrocery(grocery, settings, HH)).lines).toEqual([]);
    const movements = await stock.listMovements(HH);
    expect(ledgerMatchesStock(listed.items, movements, apples)).toBe(true);
    expect(ledgerMatchesStock(listed.items, movements, oats)).toBe(true);
});

test("putAwayGroceryLines rejects sub-tenth-gram amount before any write", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const store = await createGroceryStore(settings, HH, "Shop");
    const milk = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Milk",
        amount: 1,
        unit: "l",
    });
    const salt = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Salt",
        amount: 0.04,
        unit: "g",
    });
    await expect(
        putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [milk.id, salt.id],
            locationId: loc.id,
        }),
    ).rejects.toThrow(/greater than zero/);
    expect((await listGrocery(grocery, settings, HH)).lines).toHaveLength(2);
    expect((await listFridge(fridge, HH)).items).toHaveLength(0);
    expect(await stock.listMovements(HH)).toHaveLength(0);
});

test("putAwayGroceryLines with a bad line in the middle writes nothing", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const store = await createGroceryStore(settings, HH, "Shop");
    const first = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Milk",
        amount: 1,
        unit: "l",
    });
    const second = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Bread",
        amount: 1,
        unit: "each",
    });
    const third = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Butter",
        amount: 200,
        unit: "g",
    });
    await expect(
        putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId: HH,
            lineIds: [first.id, second.id, third.id],
            perLine: {
                [first.id]: { locationId: loc.id },
                [second.id]: { locationId: "missing-loc" },
                [third.id]: { locationId: loc.id },
            },
        }),
    ).rejects.toThrow(/Unknown location/);
    expect((await listGrocery(grocery, settings, HH)).lines).toHaveLength(3);
    expect((await listFridge(fridge, HH)).items).toHaveLength(0);
    expect(await stock.listMovements(HH)).toHaveLength(0);
});
