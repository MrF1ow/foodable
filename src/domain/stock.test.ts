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
    newFood,
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
    cookClaimId,
    cookMovementId,
    cookPreview,
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
    previewCookRecipe,
    putAwayGroceryLines,
    updateFridgeItemQuantityAdjust,
    type StockMovement,
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

async function pantryWithFlourAndRecipe() {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Pantry");
    const flour = await findOrCreateManualFood(foods, HH, "food", "Flour");
    await applyMovement(fridge, stock, foods, {
        householdId: HH,
        foodId: flour.id,
        delta: 500,
        unit: "g",
        reason: "purchase",
        locationId: loc.id,
    });
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Pancakes",
        yieldPortions: 2,
    });
    await addRecipeManualIngredient(recipes, foods, {
        householdId: HH,
        recipeId: recipe.id,
        name: "Flour",
        amount: 100,
        unit: "g",
    });
    const flourLeft = async () =>
        (await listFridge(fridge, HH)).items.reduce(
            (sum, item) => sum + item.quantity.amount,
            0,
        );
    return { fridge, stock, foods, recipes, recipeId: recipe.id, flourLeft };
}

test("a second cook under the same submit key takes nothing", async () => {
    const { fridge, stock, foods, recipes, recipeId, flourLeft } =
        await pantryWithFlourAndRecipe();
    const cook = () =>
        cookRecipe(recipes, fridge, stock, foods, {
            householdId: HH,
            recipeId,
            totalPortions: 2,
            submitKey: "sheet-1",
        });

    const first = await cook();
    expect(first.alreadyCooked).toBeUndefined();
    expect(await flourLeft()).toBe(400);

    const second = await cook();
    expect(second).toEqual({
        totalPortions: 2,
        shortfalls: [],
        unmeasured: [],
        alreadyCooked: true,
    });
    expect(await flourLeft()).toBe(400);
    const cooks = (await stock.listMovements(HH)).filter(
        (m) => m.reason === "cook",
    );
    expect(cooks).toHaveLength(1);
    expect(cooks[0]!.id).toBe(cookClaimId(HH, recipeId, "sheet-1"));
});

test("a cook under another submit key, or none, cooks again", async () => {
    const { fridge, stock, foods, recipes, recipeId, flourLeft } =
        await pantryWithFlourAndRecipe();
    const cook = (submitKey?: string) =>
        cookRecipe(recipes, fridge, stock, foods, {
            householdId: HH,
            recipeId,
            totalPortions: 2,
            submitKey,
        });

    await cook("sheet-1");
    await cook("sheet-2");
    await cook();
    await cook();

    // Four cooks of 100 g each from 500 g.
    expect(await flourLeft()).toBe(100);
});

test("cook movement ids are stable, distinct per submit, and uuid-shaped", () => {
    const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const base = cookMovementId("hh-1", "recipe-1", "sheet-1", 0);
    expect(base).toMatch(uuid);
    expect(cookMovementId("hh-1", "recipe-1", "sheet-1", 0)).toBe(base);
    expect(
        new Set([
            base,
            cookMovementId("hh-1", "recipe-1", "sheet-1", 1),
            cookMovementId("hh-1", "recipe-1", "sheet-2", 0),
            cookMovementId("hh-1", "recipe-2", "sheet-1", 0),
            cookMovementId("hh-2", "recipe-1", "sheet-1", 0),
        ]).size,
    ).toBe(5);
    expect(cookClaimId("hh-1", "recipe-1", "sheet-1")).toBe(base);
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

test("discardFridgeItem rejects a non-positive amount", async () => {
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
    for (const amount of [-5, 0, Number.NaN]) {
        await expect(
            discardFridgeItem(fridge, stock, foods, {
                householdId: HH,
                itemId: added.item!.id,
                amount,
            }),
        ).rejects.toThrow(/greater than zero/);
    }
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

test("putAwayGroceryLines puts a repeated line id away once", async () => {
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
    await putAwayGroceryLines(grocery, fridge, stock, foods, {
        householdId: HH,
        lineIds: [milk.id, milk.id],
        locationId: loc.id,
    });
    const items = (await listFridge(fridge, HH)).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.quantity.amount).toBe(1);
    expect(await stock.listMovements(HH)).toHaveLength(1);
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

test("putAwayGroceryLines stamps the usual's last restocked day when given the day", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const store = await createGroceryStore(settings, HH, "Safeway");
    const plain = await findOrCreateManualFood(foods, HH, "food", "Butter");
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kerrygold Butter",
            genericFoodId: plain.id,
        }),
    );
    const add = () =>
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            name: "Butter",
            amount: 1,
            unit: "each",
        });
    const first = await add();
    await putAwayGroceryLines(grocery, fridge, stock, foods, {
        householdId: HH,
        lineIds: [first.id],
        locationId: loc.id,
    });
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBeNull();

    const second = await add();
    await putAwayGroceryLines(grocery, fridge, stock, foods, {
        householdId: HH,
        lineIds: [second.id],
        locationId: loc.id,
        productFoodIds: { [second.id]: product.id },
        restockedOn: "2026-06-06",
    });
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBe(
        "2026-06-06",
    );
    expect((await foods.getFood(HH, product.id))?.lastRestockedOn).toBeNull();
});

test("a failing stamp does not abort a put-away that already saved", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const store = await createGroceryStore(settings, HH, "Safeway");
    await findOrCreateManualFood(foods, HH, "food", "Butter");
    await findOrCreateManualFood(foods, HH, "food", "Jam");
    const add = (name: string) =>
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            name,
            amount: 1,
            unit: "each",
        });
    const a = await add("Butter");
    const b = await add("Jam");
    const broken: typeof foods = {
        ...foods,
        updateFoodRow: async () => {
            throw new Error("db down");
        },
    };
    const original = console.error;
    console.error = () => {};
    let results;
    try {
        results = await putAwayGroceryLines(grocery, fridge, stock, broken, {
            householdId: HH,
            lineIds: [a.id, b.id],
            locationId: loc.id,
            restockedOn: "2026-06-06",
        });
    } finally {
        console.error = original;
    }
    expect(results).toHaveLength(2);
    expect((await listFridge(fridge, HH)).items).toHaveLength(2);
    expect(await grocery.listLines(HH)).toHaveLength(0);
});

// --- cookPreview -----------------------------------------------------------

/** Small deterministic PRNG (mulberry32): the same seed always builds the same world. */
function seeded(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

type Cell = { rnd: () => number };
const pick = <T>({ rnd }: Cell, list: readonly T[]): T =>
    list[Math.floor(rnd() * list.length)]!;
const tenths = ({ rnd }: Cell, lo: number, hi: number): number =>
    Math.round((lo + rnd() * (hi - lo)) * 10) / 10;

const PREVIEW_UNITS = ["g", "kg", "each", "ml", "cup", "oz", "tbsp"] as const;

async function buildPreviewWorld(seed: number) {
    const cell: Cell = { rnd: seeded(seed) };
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const foodIds: string[] = [];
    const allFoodIds: string[] = [];
    const productIds: string[] = [];
    const plainCount = 1 + Math.floor(cell.rnd() * 3);
    for (let i = 0; i < plainCount; i++) {
        const plain = await foods.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: `Plain ${seed}-${i}`,
                defaultUnit: pick(cell, ["g", "each", "ml"]),
                gramsPerEach: pick(cell, [null, 50, 120]),
                gramsPerMl: pick(cell, [null, 1, 0.9]),
            }),
        );
        foodIds.push(plain.id);
        allFoodIds.push(plain.id);
        if (cell.rnd() < 0.3) {
            const product = await foods.insertFood(
                newFood({
                    householdId: HH,
                    kind: "food",
                    name: `Product ${seed}-${i}`,
                    defaultUnit: plain.defaultUnit,
                    gramsPerEach: pick(cell, [null, 60]),
                    gramsPerMl: pick(cell, [null, 1.1]),
                    genericFoodId: plain.id,
                }),
            );
            allFoodIds.push(product.id);
            productIds.push(product.id);
            if (cell.rnd() < 0.5) {
                await foods.updateFoodRow({
                    ...plain,
                    usualProductId: product.id,
                });
            }
        }
    }
    let itemSeq = 0;
    for (const foodId of allFoodIds) {
        const count = Math.floor(cell.rnd() * 4);
        for (let i = 0; i < count; i++) {
            await fridge.insertItem({
                id: `item-${seed}-${itemSeq++}`,
                householdId: HH,
                locationId: loc.id,
                kind: "food",
                displayName: `Stock ${foodId.slice(0, 4)}`,
                quantity: {
                    amount: tenths(cell, 0.5, 400),
                    unit: pick(cell, PREVIEW_UNITS),
                },
                foodId,
                expiresOn: pick(cell, [
                    null,
                    "2026-12-01",
                    "2026-12-15",
                    "2027-01-10",
                ]),
            });
        }
    }
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: `Recipe ${seed}`,
        yieldPortions: 1 + Math.floor(cell.rnd() * 4),
    });
    const ingredientCount = 1 + Math.floor(cell.rnd() * 4);
    for (let i = 0; i < ingredientCount; i++) {
        const linked = cell.rnd() > 0.05;
        const measured = cell.rnd() > 0.08;
        await recipes.insertIngredient({
            id: `ing-${seed}-${i}`,
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: `Ingredient ${i}`,
            quantity: measured
                ? {
                      amount: tenths(cell, 0.5, 300),
                      unit: pick(cell, PREVIEW_UNITS),
                  }
                : null,
            foodId: linked
                ? pick(
                      cell,
                      productIds.length > 0 && cell.rnd() < 0.3
                          ? productIds
                          : foodIds,
                  )
                : null,
            sortOrder: i,
            note: null,
        });
    }
    // Sometimes archive a food an ingredient names, which the cook treats as unknown.
    let archivedIngredientFood = false;
    if (cell.rnd() < 0.15) {
        const named = (await recipes.listIngredients(HH, recipe.id))
            .map((ingredient) => ingredient.foodId)
            .filter((id): id is string => Boolean(id));
        const target = named.length > 0 ? pick(cell, named) : null;
        const row = target ? await foods.getFood(HH, target) : null;
        if (row) {
            await foods.updateFoodRow({
                ...row,
                archivedAt: "2026-06-01T00:00:00.000Z",
            });
            archivedIngredientFood = true;
        }
    }
    const servings = pick(cell, [0.5, 1, 2, 3, 6]);
    return {
        fridge,
        stock,
        foods,
        recipes,
        recipe,
        servings,
        archivedIngredientFood,
    };
}

test("cookPreview plans exactly the movements cookRecipe records, and writes nothing", async () => {
    let withShortfall = 0;
    let withUnknownFactor = 0;
    let withManyMovements = 0;
    let withLines = 0;
    let failedTogether = 0;
    for (let seed = 1; seed <= 200; seed++) {
        const world = await buildPreviewWorld(seed);
        const {
            fridge,
            stock,
            foods,
            recipes,
            recipe,
            servings,
            archivedIngredientFood,
        } = world;
        const itemsBefore = await fridge.listItems(HH);
        const ledgerBefore = await stock.listMovements(HH);

        const failure = async (run: () => Promise<unknown>) => {
            try {
                await run();
                return null;
            } catch (err) {
                return err instanceof Error ? err.message : String(err);
            }
        };
        let preview!: Awaited<ReturnType<typeof previewCookRecipe>>;
        const previewError = await failure(async () => {
            preview = await previewCookRecipe(recipes, fridge, foods, {
                householdId: HH,
                recipeId: recipe.id,
                totalPortions: servings,
            });
        });
        expect(await fridge.listItems(HH), `seed ${seed}`).toEqual(itemsBefore);
        expect(await stock.listMovements(HH), `seed ${seed}`).toEqual(
            ledgerBefore,
        );

        const recorded: StockMovement[] = [];
        const recording = {
            ...stock,
            async insertMovement(row: StockMovement) {
                recorded.push(row);
                return stock.insertMovement(row);
            },
        };
        let cooked!: Awaited<ReturnType<typeof cookRecipe>>;
        const cookError = await failure(async () => {
            cooked = await cookRecipe(recipes, fridge, recording, foods, {
                householdId: HH,
                recipeId: recipe.id,
                totalPortions: servings,
            });
        });

        // Preview and cook either both succeed or both fail the same way, and a
        // failed cook has written nothing.
        expect(previewError, `seed ${seed} outcome`).toBe(cookError);
        if (cookError) {
            expect(cookError).toBe("Unknown food.");
            expect(archivedIngredientFood, `seed ${seed}`).toBe(true);
            expect(recorded, `seed ${seed}`).toEqual([]);
            expect(await fridge.listItems(HH), `seed ${seed}`).toEqual(
                itemsBefore,
            );
            expect(await stock.listMovements(HH), `seed ${seed}`).toEqual(
                ledgerBefore,
            );
            failedTogether++;
            continue;
        }

        expect(preview.movements, `seed ${seed} movements`).toEqual(
            recorded.map((row) => ({
                foodId: row.foodId,
                fridgeItemId: row.fridgeItemId,
                delta: row.delta,
                unit: row.unit,
            })),
        );
        expect(
            preview.shortfalls.map(({ unknownFactor: _u, ...rest }) => rest),
            `seed ${seed} shortfalls`,
        ).toEqual(cooked.shortfalls);
        expect(preview.unmeasured, `seed ${seed} unmeasured`).toEqual(
            cooked.unmeasured,
        );
        expect(preview.totalPortions).toBe(cooked.totalPortions);

        // Each line's after-amount is what the item really holds once cooked.
        const itemsAfter = new Map(
            (await fridge.listItems(HH)).map((item) => [item.id, item]),
        );
        const lastLine = new Map(
            preview.lines.map((line) => [line.fromItemId, line]),
        );
        for (const [id, line] of lastLine) {
            const actual = itemsAfter.get(id);
            if (line.after === 0)
                expect(actual, `seed ${seed} ${id}`).toBeUndefined();
            else
                expect(actual?.quantity.amount, `seed ${seed} ${id}`).toBe(
                    line.after,
                );
        }
        for (const item of itemsBefore) {
            if (!lastLine.has(item.id)) {
                expect(
                    itemsAfter.get(item.id),
                    `seed ${seed} ${item.id}`,
                ).toEqual(item);
            }
        }

        if (cooked.shortfalls.length > 0) withShortfall++;
        if (preview.shortfalls.some((row) => row.unknownFactor)) {
            withUnknownFactor++;
        }
        if (preview.movements.length > 1) withManyMovements++;
        if (preview.lines.length > 0) withLines++;
    }
    // The generator has to reach the interesting cases, or the equality above is hollow.
    expect(withShortfall).toBeGreaterThan(20);
    expect(withUnknownFactor).toBeGreaterThan(5);
    expect(withManyMovements).toBeGreaterThan(20);
    expect(withLines).toBeGreaterThan(50);
    expect(failedTogether).toBeGreaterThan(5);
});

test("an archived ingredient food fails the preview and the cook alike, before the cook writes anything", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const live = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Rice",
            defaultUnit: "g",
        }),
    );
    const gone = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Salt",
            defaultUnit: "g",
        }),
    );
    for (const food of [live, gone]) {
        await fridge.insertItem({
            id: `item-${food.name}`,
            householdId: HH,
            locationId: loc.id,
            kind: "food",
            displayName: food.name,
            quantity: { amount: 100, unit: "g" },
            foodId: food.id,
        });
    }
    const recipe = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Rice and salt",
        yieldPortions: 1,
    });
    for (const [i, food] of [live, gone].entries()) {
        await recipes.insertIngredient({
            id: `ing-${i}`,
            householdId: HH,
            recipeId: recipe.id,
            kind: "food",
            displayName: food.name,
            quantity: { amount: 10, unit: "g" },
            foodId: food.id,
            sortOrder: i,
            note: null,
        });
    }
    await foods.updateFoodRow({
        ...gone,
        archivedAt: "2026-06-01T00:00:00.000Z",
    });
    const itemsBefore = await fridge.listItems(HH);

    const input = { householdId: HH, recipeId: recipe.id, totalPortions: 1 };
    await expect(
        previewCookRecipe(recipes, fridge, foods, input),
    ).rejects.toThrow("Unknown food.");
    await expect(
        cookRecipe(recipes, fridge, stock, foods, input),
    ).rejects.toThrow("Unknown food.");
    // The live ingredient, listed first, was not drawn down before the failure.
    expect(await fridge.listItems(HH)).toEqual(itemsBefore);
    expect(await stock.listMovements(HH)).toEqual([]);
});

test("cookPreview reports what leaves each item and the shortfall by name", async () => {
    const foods = createMemoryFoodsStore();
    const eggs = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            defaultUnit: "each",
            gramsPerEach: 50,
        }),
    );
    const item = (id: string, amount: number, expiresOn: string) => ({
        id,
        householdId: HH,
        locationId: "loc",
        kind: "food" as const,
        displayName: "Eggs",
        quantity: { amount, unit: "each" },
        foodId: eggs.id,
        expiresOn,
    });
    const preview = cookPreview(
        {
            yieldPortions: 1,
            ingredients: [
                {
                    displayName: "Eggs",
                    foodId: eggs.id,
                    quantity: { amount: 6, unit: "each" },
                },
            ],
        },
        2,
        {
            items: [
                item("late", 4, "2026-12-01"),
                item("early", 4, "2026-01-01"),
            ],
            foods: new Map([[eggs.id, eggs]]),
            effective: new Map([[eggs.id, eggs]]),
        },
    );
    expect(preview.lines).toEqual([
        {
            foodId: eggs.id,
            displayName: "Eggs",
            fromItemId: "early",
            unit: "each",
            before: 4,
            after: 0,
        },
        {
            foodId: eggs.id,
            displayName: "Eggs",
            fromItemId: "late",
            unit: "each",
            before: 4,
            after: 0,
        },
    ]);
    expect(preview.shortfalls).toEqual([
        {
            foodId: eggs.id,
            displayName: "Eggs",
            amount: 4,
            unit: "each",
            unknownFactor: false,
        },
    ]);
});

test("cookPreview flags a shortfall it could not count for want of a unit factor", async () => {
    const foods = createMemoryFoodsStore();
    const flour = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Flour",
            defaultUnit: "g",
        }),
    );
    const preview = cookPreview(
        {
            yieldPortions: 1,
            ingredients: [
                {
                    displayName: "Flour",
                    foodId: flour.id,
                    quantity: { amount: 2, unit: "cup" },
                },
            ],
        },
        1,
        {
            items: [
                {
                    id: "bag",
                    householdId: HH,
                    locationId: "loc",
                    kind: "food",
                    displayName: "Flour",
                    quantity: { amount: 500, unit: "g" },
                    foodId: flour.id,
                },
            ],
            foods: new Map([[flour.id, flour]]),
            effective: new Map([[flour.id, flour]]),
        },
    );
    expect(preview.lines).toEqual([]);
    expect(preview.shortfalls).toEqual([
        {
            foodId: flour.id,
            displayName: "Flour",
            amount: 2,
            unit: "cup",
            unknownFactor: true,
        },
    ]);
});
