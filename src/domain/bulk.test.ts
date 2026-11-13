import { expect, spyOn, test } from "bun:test";
import {
    BULK_MAX_IDS,
    BulkSelectionError,
    deleteSavedItems,
    discardFridgeItems,
    parseBulkIds,
    removeGroceryLines,
    removeUsuals,
    tickOffGroceryLines,
} from "./bulk.js";
import { isUsualFood } from "./restock.js";
import {
    addLocation,
    createMemoryFridgeStore,
    listFridge,
    type FridgeStore,
} from "./fridge.js";
import {
    createMemoryFoodsStore,
    createProduct,
    findOrCreateManualFood,
    NO_USUAL_SCHEDULE,
    setUsualSchedule,
    updateFood,
    type FoodsStore,
} from "./foods.js";
import {
    addGroceryManualFood,
    createMemoryGroceryStore,
    type GroceryListStore,
} from "./grocery.js";
import { RecipeForbiddenError } from "./recipes.js";
import { createMemoryRecipesStore, createRecipe } from "./recipes.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
    ledgerMatchesStock,
    type StockStore,
} from "./stock.js";

const HH = "hh-1";
const TODAY = "2026-11-13";

async function groceryWith(names: string[]) {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Safeway");
    const sections = await settings.listSections(store.id);
    const other = sections.find((row) => row.isOther)!;
    const lines = [];
    for (const name of names) {
        lines.push(
            await addGroceryManualFood(grocery, settings, foods, {
                householdId: HH,
                storeId: store.id,
                sectionId: other.id,
                name,
                amount: 2,
                unit: "each",
            }),
        );
    }
    return { grocery, foods, lines };
}

async function fridgeWith(names: string[]) {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const items = [];
    const made = [];
    for (const name of names) {
        const food = await findOrCreateManualFood(foods, HH, "food", name);
        made.push(food);
        const added = await addFridgeItemAdjust(fridge, stock, foods, {
            householdId: HH,
            foodId: food.id,
            amount: 3,
            unit: "each",
            locationId: loc.id,
        });
        items.push(added.item!);
    }
    return { fridge, stock, foods, items, made };
}

const lineOf = async (grocery: GroceryListStore, id: string) =>
    (await grocery.listLines(HH)).find((row) => row.id === id);

test("parseBulkIds keeps each uuid once and refuses anything else", () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(parseBulkIds([a, b, a, ` ${b} `])).toEqual([a, b]);
    expect(parseBulkIds(a)).toEqual([a]);
    expect(() => parseBulkIds(undefined)).toThrow(BulkSelectionError);
    expect(() => parseBulkIds([])).toThrow(BulkSelectionError);
    expect(() => parseBulkIds([a, "not-a-uuid"])).toThrow(BulkSelectionError);
    expect(() => parseBulkIds([a, new File([], "x")])).toThrow(
        BulkSelectionError,
    );
    const many = Array.from({ length: BULK_MAX_IDS + 1 }, () =>
        crypto.randomUUID(),
    );
    expect(() => parseBulkIds(many)).toThrow(BulkSelectionError);
    expect(parseBulkIds(many.slice(0, BULK_MAX_IDS))).toHaveLength(
        BULK_MAX_IDS,
    );
});

test("tickOffGroceryLines ticks every selected line and leaves the others", async () => {
    const { grocery, foods, lines } = await groceryWith([
        "Milk",
        "Eggs",
        "Bread",
    ]);
    const result = await tickOffGroceryLines(grocery, foods, {
        householdId: HH,
        lineIds: [lines[0]!.id, lines[2]!.id],
        today: TODAY,
    });
    expect(result).toEqual({ status: "applied", count: 2 });
    expect((await lineOf(grocery, lines[0]!.id))?.checked).toBe(true);
    expect((await lineOf(grocery, lines[1]!.id))?.checked).toBe(false);
    expect((await lineOf(grocery, lines[2]!.id))?.checked).toBe(true);
});

test("tickOffGroceryLines stamps a usual's restock day like ticking it alone", async () => {
    const { grocery, foods, lines } = await groceryWith(["Milk"]);
    const milk = (await foods.listFoods(HH)).find((f) => f.name === "Milk")!;
    expect(milk.lastRestockedOn ?? null).toBeNull();
    await tickOffGroceryLines(grocery, foods, {
        householdId: HH,
        lineIds: [lines[0]!.id],
        today: TODAY,
    });
    const after = await foods.getFood(HH, milk.id);
    expect(after?.lastRestockedOn).toBe(TODAY);
});

test("tickOffGroceryLines runs each restock stamp through isolate and keeps the tick when the stamp fails", async () => {
    const { grocery, foods, lines } = await groceryWith(["Milk", "Eggs"]);
    let isolated = 0;
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
        const result = await tickOffGroceryLines(grocery, foods, {
            householdId: HH,
            lineIds: lines.map((l) => l.id),
            today: TODAY,
            isolate: async (work) => {
                isolated += 1;
                await work();
                throw new Error("stamp refused");
            },
        });
        expect(result).toEqual({ status: "applied", count: 2 });
        expect(errors).toHaveBeenCalledTimes(2);
    } finally {
        errors.mockRestore();
    }
    expect(isolated).toBe(2);
    for (const line of lines) {
        expect((await lineOf(grocery, line.id))?.checked).toBe(true);
    }
});

test("tickOffGroceryLines on lines that are already ticked says already and writes nothing", async () => {
    // A tick leaves the line on the list, so select mode can pick it again. A
    // replay has nothing left to do, like the other bulk actions.
    const { grocery, foods, lines } = await groceryWith(["Milk"]);
    const input = {
        householdId: HH,
        lineIds: [lines[0]!.id],
        today: TODAY,
    };
    await tickOffGroceryLines(grocery, foods, input);
    expect(await tickOffGroceryLines(grocery, foods, input)).toEqual({
        status: "already",
        count: 0,
    });
    expect((await lineOf(grocery, lines[0]!.id))?.checked).toBe(true);
});

test("tickOffGroceryLines leaves the restock day of a line that was already ticked", async () => {
    const { grocery, foods, lines } = await groceryWith(["Milk", "Eggs"]);
    const foodOf = async (name: string) =>
        (await foods.listFoods(HH)).find((f) => f.name === name)!;
    // Milk was bought on Monday, ticked the ordinary way.
    await tickOffGroceryLines(grocery, foods, {
        householdId: HH,
        lineIds: [lines[0]!.id],
        today: "2026-11-09",
    });
    // On Friday the person selects both rows and checks off.
    const result = await tickOffGroceryLines(grocery, foods, {
        householdId: HH,
        lineIds: [lines[0]!.id, lines[1]!.id],
        today: TODAY,
    });
    expect(result).toEqual({ status: "applied", count: 1 });
    expect(
        (await foods.getFood(HH, (await foodOf("Milk")).id))?.lastRestockedOn,
    ).toBe("2026-11-09");
    expect(
        (await foods.getFood(HH, (await foodOf("Eggs")).id))?.lastRestockedOn,
    ).toBe(TODAY);
    // Only ticked lines, with one gone: nothing to do either, so still already.
    expect(
        await tickOffGroceryLines(grocery, foods, {
            householdId: HH,
            lineIds: [lines[0]!.id, crypto.randomUUID()],
            today: TODAY,
        }),
    ).toEqual({ status: "already", count: 0 });
});

test("a selection with a line that is gone changes nothing", async () => {
    const { grocery, foods, lines } = await groceryWith(["Milk", "Eggs"]);
    await expect(
        tickOffGroceryLines(grocery, foods, {
            householdId: HH,
            lineIds: [lines[0]!.id, crypto.randomUUID()],
            today: TODAY,
        }),
    ).rejects.toBeInstanceOf(BulkSelectionError);
    expect((await lineOf(grocery, lines[0]!.id))?.checked).toBe(false);
    await expect(
        removeGroceryLines(grocery, {
            householdId: HH,
            lineIds: [lines[0]!.id, crypto.randomUUID()],
        }),
    ).rejects.toBeInstanceOf(BulkSelectionError);
    expect(await grocery.listLines(HH)).toHaveLength(2);
});

test("a line of another household counts as gone", async () => {
    const { grocery, foods, lines } = await groceryWith(["Milk"]);
    await expect(
        tickOffGroceryLines(grocery, foods, {
            householdId: "hh-other",
            lineIds: [lines[0]!.id],
            today: TODAY,
        }),
    ).resolves.toEqual({ status: "already", count: 0 });
    expect((await lineOf(grocery, lines[0]!.id))?.checked).toBe(false);
});

test("removeGroceryLines deletes the selected lines, and a repeat is a no-op", async () => {
    const { grocery, lines } = await groceryWith(["Milk", "Eggs", "Bread"]);
    const ids = [lines[0]!.id, lines[1]!.id];
    expect(
        await removeGroceryLines(grocery, { householdId: HH, lineIds: ids }),
    ).toEqual({ status: "applied", count: 2 });
    expect((await grocery.listLines(HH)).map((l) => l.id)).toEqual([
        lines[2]!.id,
    ]);
    expect(
        await removeGroceryLines(grocery, { householdId: HH, lineIds: ids }),
    ).toEqual({ status: "already", count: 0 });
    expect(await grocery.listLines(HH)).toHaveLength(1);
});

async function ledgerOk(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    foodId: string,
) {
    const items = (await listFridge(fridge, HH)).items;
    const food = (await foods.getFood(HH, foodId))!;
    return ledgerMatchesStock(
        items,
        await stock.listMovements(HH, foodId),
        food,
    );
}

test("discardFridgeItems writes a discard movement per item and the ledger matches", async () => {
    const { fridge, stock, foods, items, made } = await fridgeWith([
        "Yogurt",
        "Spinach",
        "Cheese",
    ]);
    const result = await discardFridgeItems(fridge, stock, foods, {
        householdId: HH,
        itemIds: [items[0]!.id, items[1]!.id],
        actorUserId: "u1",
    });
    expect(result).toEqual({ status: "applied", count: 2 });
    const left = (await listFridge(fridge, HH)).items;
    expect(left.map((i) => i.displayName)).toEqual(["Cheese"]);
    const movements = await stock.listMovements(HH);
    const discards = movements.filter((m) => m.reason === "discard");
    expect(discards).toHaveLength(2);
    expect(
        discards.every((m) => m.delta === -3 && m.actorUserId === "u1"),
    ).toBe(true);
    for (const food of made) {
        expect(await ledgerOk(fridge, stock, foods, food.id)).toBe(true);
    }
});

test("discardFridgeItems writes nothing when one item is gone or unlinked", async () => {
    const { fridge, stock, foods, items } = await fridgeWith([
        "Yogurt",
        "Spinach",
    ]);
    await expect(
        discardFridgeItems(fridge, stock, foods, {
            householdId: HH,
            itemIds: [items[0]!.id, crypto.randomUUID()],
        }),
    ).rejects.toBeInstanceOf(BulkSelectionError);
    expect((await listFridge(fridge, HH)).items).toHaveLength(2);
    const before = (await stock.listMovements(HH)).length;

    const orphan = await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: HH,
        locationId: items[0]!.locationId,
        kind: "food",
        displayName: "Mystery jar",
        quantity: { amount: 1, unit: "each" },
        foodId: null,
        expiresOn: null,
    });
    await expect(
        discardFridgeItems(fridge, stock, foods, {
            householdId: HH,
            itemIds: [items[0]!.id, orphan.id],
        }),
    ).rejects.toThrow("Mystery jar");
    expect((await listFridge(fridge, HH)).items).toHaveLength(3);
    expect((await stock.listMovements(HH)).length).toBe(before);
});

test("discardFridgeItems answers a repeat as already done", async () => {
    const { fridge, stock, foods, items } = await fridgeWith(["Yogurt"]);
    const input = {
        householdId: HH,
        itemIds: [items[0]!.id],
        actorUserId: "u1",
    };
    await discardFridgeItems(fridge, stock, foods, input);
    const movements = (await stock.listMovements(HH)).length;
    expect(await discardFridgeItems(fridge, stock, foods, input)).toEqual({
        status: "already",
        count: 0,
    });
    expect((await stock.listMovements(HH)).length).toBe(movements);
});

async function usualsWith(names: string[]) {
    const foods = createMemoryFoodsStore();
    const plains = [];
    for (const name of names) {
        const plain = await findOrCreateManualFood(foods, HH, "food", name);
        const product = await createProduct(foods, HH, plain.id, {
            name: `${name} (store brand)`,
            makeUsual: true,
        });
        plains.push({ plain, product });
    }
    return { foods, plains };
}

test("removeUsuals unlinks every product of each selected usual", async () => {
    const { foods, plains } = await usualsWith(["Milk", "Eggs", "Butter"]);
    const second = await createProduct(foods, HH, plains[0]!.plain.id, {
        name: "Milk (organic)",
    });
    const result = await removeUsuals(foods, {
        householdId: HH,
        foodIds: [plains[0]!.plain.id, plains[1]!.plain.id],
    });
    expect(result).toEqual({ status: "applied", count: 2 });
    for (const productId of [
        plains[0]!.product.id,
        second.id,
        plains[1]!.product.id,
    ]) {
        expect((await foods.getFood(HH, productId))?.genericFoodId).toBeNull();
    }
    expect(
        (await foods.getFood(HH, plains[0]!.plain.id))?.usualProductId,
    ).toBeNull();
    // The one not selected keeps its product.
    expect(
        (await foods.getFood(HH, plains[2]!.product.id))?.genericFoodId,
    ).toBe(plains[2]!.plain.id);
});

test("removeUsuals stops a scheduled usual being a usual: the restock settings go with the products", async () => {
    const { foods, plains } = await usualsWith(["Milk", "Eggs"]);
    const [milk, eggs] = [plains[0]!.plain.id, plains[1]!.plain.id];
    await setUsualSchedule(foods, HH, milk, {
        restockSchedule: "weekly",
        restockPaused: true,
        restockWhenLow: true,
        restockLowLevel: 2,
        lastRestockedOn: "2026-11-01",
    });
    await setUsualSchedule(foods, HH, eggs, { restockWhenLow: true });
    expect(isUsualFood((await foods.getFood(HH, milk))!)).toBe(true);
    expect(isUsualFood((await foods.getFood(HH, eggs))!)).toBe(true);
    await removeUsuals(foods, { householdId: HH, foodIds: [milk] });
    const gone = (await foods.getFood(HH, milk))!;
    expect(isUsualFood(gone)).toBe(false);
    expect({
        restockSchedule: gone.restockSchedule,
        restockEveryWeeks: gone.restockEveryWeeks,
        restockPaused: gone.restockPaused,
        restockWhenLow: gone.restockWhenLow,
        restockLowLevel: gone.restockLowLevel,
        lastRestockedOn: gone.lastRestockedOn,
    }).toEqual(NO_USUAL_SCHEDULE);
    // The one not selected keeps its settings.
    const kept = (await foods.getFood(HH, eggs))!;
    expect(isUsualFood(kept)).toBe(true);
    expect(kept.restockWhenLow).toBe(true);
});

test("removeUsuals refuses a food that is not a usual and writes nothing", async () => {
    const { foods, plains } = await usualsWith(["Milk"]);
    const lone = await findOrCreateManualFood(foods, HH, "food", "Salt");
    await expect(
        removeUsuals(foods, {
            householdId: HH,
            foodIds: [plains[0]!.plain.id, lone.id],
        }),
    ).rejects.toBeInstanceOf(BulkSelectionError);
    expect(
        (await foods.getFood(HH, plains[0]!.product.id))?.genericFoodId,
    ).toBe(plains[0]!.plain.id);
});

test("removeUsuals answers a repeat as already done", async () => {
    const { foods, plains } = await usualsWith(["Milk"]);
    const input = { householdId: HH, foodIds: [plains[0]!.plain.id] };
    await removeUsuals(foods, input);
    expect(await removeUsuals(foods, input)).toEqual({
        status: "already",
        count: 0,
    });
});

async function savedWith() {
    const foods = createMemoryFoodsStore();
    const recipes = createMemoryRecipesStore();
    const oats = await findOrCreateManualFood(foods, HH, "food", "Oats");
    const rice = await findOrCreateManualFood(foods, HH, "food", "Rice");
    const mine = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u1",
        name: "Porridge",
        yieldPortions: 2,
    });
    const theirs = await createRecipe(recipes, {
        householdId: HH,
        creatorId: "u2",
        name: "Paella",
        yieldPortions: 4,
    });
    return { foods, recipes, oats, rice, mine, theirs };
}

const OWNER = { userId: "u1", isOwner: true };
const MEMBER = { userId: "u1", isOwner: false };

test("deleteSavedItems archives foods and deletes recipes in one go", async () => {
    const { foods, recipes, oats, rice, mine, theirs } = await savedWith();
    const result = await deleteSavedItems(foods, recipes, {
        householdId: HH,
        foodIds: [oats.id],
        recipeIds: [mine.id, theirs.id],
        actor: OWNER,
    });
    expect(result).toEqual({ status: "applied", count: 3 });
    expect((await foods.getFood(HH, oats.id))?.archivedAt).not.toBeNull();
    expect((await foods.getFood(HH, rice.id))?.archivedAt).toBeNull();
    expect(await recipes.listRecipes(HH)).toHaveLength(0);
});

test("deleteSavedItems deletes nothing when a recipe is not the member's own", async () => {
    const { foods, recipes, oats, mine, theirs } = await savedWith();
    await expect(
        deleteSavedItems(foods, recipes, {
            householdId: HH,
            foodIds: [oats.id],
            recipeIds: [mine.id, theirs.id],
            actor: MEMBER,
        }),
    ).rejects.toBeInstanceOf(RecipeForbiddenError);
    expect((await foods.getFood(HH, oats.id))?.archivedAt).toBeNull();
    expect(await recipes.listRecipes(HH)).toHaveLength(2);
});

test("deleteSavedItems refuses an id that is not there when something else is", async () => {
    const { foods, recipes, oats, mine } = await savedWith();
    await expect(
        deleteSavedItems(foods, recipes, {
            householdId: HH,
            foodIds: [oats.id],
            recipeIds: [mine.id, crypto.randomUUID()],
            actor: OWNER,
        }),
    ).rejects.toBeInstanceOf(BulkSelectionError);
    expect((await foods.getFood(HH, oats.id))?.archivedAt).toBeNull();
    expect(await recipes.listRecipes(HH)).toHaveLength(2);
});

test("deleteSavedItems answers a repeat of a mixed selection as already done", async () => {
    const { foods, recipes, oats, mine } = await savedWith();
    const input = {
        householdId: HH,
        foodIds: [oats.id],
        recipeIds: [mine.id],
        actor: OWNER,
    };
    await deleteSavedItems(foods, recipes, input);
    expect(await deleteSavedItems(foods, recipes, input)).toEqual({
        status: "already",
        count: 0,
    });
});

test("deleteSavedItems takes an already archived food as done", async () => {
    const { foods, recipes, oats, rice } = await savedWith();
    await updateFood(foods, HH, oats.id, { archived: true });
    const result = await deleteSavedItems(foods, recipes, {
        householdId: HH,
        foodIds: [oats.id, rice.id],
        recipeIds: [],
        actor: OWNER,
    });
    expect(result).toEqual({ status: "applied", count: 1 });
    expect((await foods.getFood(HH, rice.id))?.archivedAt).not.toBeNull();
});
