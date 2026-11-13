import { test, expect } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    addFoodByBarcode,
    addLocation,
    addSupply,
    createMemoryFridgeStore,
    defaultFreezeExpiry,
    deleteItem,
    findFreezerLocation,
    freezeFridgeItem,
    freezeItem,
    listFridge,
    moveItem,
    updateItemQuantity,
} from "./fridge.js";
import { createMemoryFoodsStore, findOrCreateManualFood } from "./foods.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
    ledgerMatchesStock,
} from "./stock.js";

const HH = "hh-1";

function food(
    over: Partial<FoodResult> & Pick<FoodResult, "name" | "barcode">,
): FoodResult {
    return {
        brand: null,
        serving: "100 g",
        calories: 80,
        protein_g: 11,
        carbs_g: 3,
        fat_g: 2,
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

test("add location Pantry then lists it", async () => {
    const store = createMemoryFridgeStore();
    const loc = await addLocation(store, HH, "Pantry");
    expect(loc.name).toBe("Pantry");
    const listed = await listFridge(store, HH);
    expect(listed.locations.map((l) => l.name)).toEqual(["Pantry"]);
    expect(listed.items).toEqual([]);
});

test("defaultFreezeExpiry adds three months with month-end clamp", () => {
    expect(defaultFreezeExpiry("2026-01-31")).toBe("2026-04-30");
    expect(defaultFreezeExpiry("2026-05-15")).toBe("2026-08-15");
    expect(() => defaultFreezeExpiry("2026-02-30")).toThrow();
    expect(() => defaultFreezeExpiry("2026-13-01")).toThrow();
});

test("freezeItem keeps purchased and opened dates and amount", async () => {
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const foods = createMemoryFoodsStore();
    const fridgeLoc = await addLocation(fridge, HH, "Fridge");
    const freezerLoc = await addLocation(fridge, HH, "Freezer");
    const berries = await findOrCreateManualFood(foods, HH, "food", "Berries");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: berries.id,
        amount: 2,
        unit: "cup",
        locationId: fridgeLoc.id,
        purchasedOn: "2026-02-01",
        openedOn: "2026-02-10",
        expiresOn: "2026-02-15",
    });
    const item = added.item!;
    const movementsBefore = await stock.listMovements(HH, berries.id);
    const frozen = await freezeFridgeItem(fridge, HH, item.id, "2026-06-01");
    expect(frozen).toEqual(freezeItem(item, freezerLoc.id, "2026-06-01"));
    expect(frozen.purchasedOn).toBe("2026-02-01");
    expect(frozen.openedOn).toBe("2026-02-10");
    expect(frozen.quantity).toEqual({ amount: 2, unit: "cup" });
    const listed = await listFridge(fridge, HH);
    expect(ledgerMatchesStock(listed.items, movementsBefore, berries)).toBe(
        true,
    );
    expect(await stock.listMovements(HH, berries.id)).toHaveLength(
        movementsBefore.length,
    );
});

test("findFreezerLocation matches Freezer by name", async () => {
    const store = createMemoryFridgeStore();
    await addLocation(store, HH, "Fridge");
    const freezer = await addLocation(store, HH, "Freezer");
    const locations = await store.listLocations(HH);
    expect(findFreezerLocation(locations)?.id).toBe(freezer.id);
});

test("findFreezerLocation falls back to a name containing freezer", async () => {
    const store = createMemoryFridgeStore();
    await addLocation(store, HH, "Pantry");
    const chest = await addLocation(store, HH, "Chest freezer");
    expect(findFreezerLocation(await store.listLocations(HH))?.id).toBe(
        chest.id,
    );
    const exact = await addLocation(store, HH, "Freezer");
    expect(findFreezerLocation(await store.listLocations(HH))?.id).toBe(
        exact.id,
    );
});

test("add location refuses a duplicate name", async () => {
    const store = createMemoryFridgeStore();
    await addLocation(store, HH, "Pantry");
    await expect(addLocation(store, HH, "Pantry")).rejects.toThrow(
        /already exists/i,
    );
});

test("add food by barcode mock stores grams", async () => {
    const store = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(store, HH, "Fridge");
    const hit = food({
        name: "Good Culture Cottage Cheese",
        barcode: "070852010016",
    });
    const item = await addFoodByBarcode(
        store,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "0708-5201 0016",
            amount: 1360.8,
        },
        {
            lookup: async (barcode) => {
                expect(barcode).toBe("070852010016");
                return hit;
            },
        },
    );
    expect(item.displayName).toBe("Good Culture Cottage Cheese");
    expect(item.kind).toBe("food");
    expect(item.quantity).toEqual({ amount: 1360.8, unit: "g" });
    expect(item.foodId).toBeTruthy();
});

test("add supply manual requires amount and unit", async () => {
    const store = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const loc = await addLocation(store, HH, "Pantry");
    await expect(
        addSupply(store, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "Foil",
            amount: 1,
            unit: "",
        }),
    ).rejects.toThrow(/unit/i);
    await expect(
        addSupply(store, foods, {
            householdId: HH,
            locationId: loc.id,
            name: "Foil",
            amount: 0,
            unit: "roll",
        }),
    ).rejects.toThrow(/amount/i);

    const item = await addSupply(store, foods, {
        householdId: HH,
        locationId: loc.id,
        name: "Foil",
        amount: 2,
        unit: "roll",
    });
    expect(item.kind).toBe("supply");
    expect(item.displayName).toBe("Foil");
    expect(item.quantity).toEqual({ amount: 2, unit: "roll" });
    expect(item.foodId).toBeTruthy();
});

test("edit quantity updates the stored amount", async () => {
    const store = createMemoryFridgeStore();
    const loc = await addLocation(store, HH, "Fridge");
    const item = await addSupply(store, createMemoryFoodsStore(), {
        householdId: HH,
        locationId: loc.id,
        name: "Foil",
        amount: 2,
        unit: "roll",
    });
    const updated = await updateItemQuantity(store, HH, item.id, {
        amount: 1,
        unit: "roll",
    });
    expect(updated?.quantity).toEqual({ amount: 1, unit: "roll" });
    const listed = await listFridge(store, HH);
    expect(listed.items[0]?.quantity.amount).toBe(1);
});

test("delete item removes the row", async () => {
    const store = createMemoryFridgeStore();
    const loc = await addLocation(store, HH, "Fridge");
    const item = await addSupply(store, createMemoryFoodsStore(), {
        householdId: HH,
        locationId: loc.id,
        name: "Foil",
        amount: 1,
        unit: "roll",
    });
    expect(await deleteItem(store, HH, item.id)).toBe(true);
    expect((await listFridge(store, HH)).items).toEqual([]);
    expect(await deleteItem(store, HH, item.id)).toBe(false);
});

test("move item changes location", async () => {
    const store = createMemoryFridgeStore();
    const fridge = await addLocation(store, HH, "Fridge");
    const pantry = await addLocation(store, HH, "Pantry");
    const item = await addSupply(store, createMemoryFoodsStore(), {
        householdId: HH,
        locationId: fridge.id,
        name: "Foil",
        amount: 1,
        unit: "roll",
    });
    const moved = await moveItem(store, HH, item.id, pantry.id);
    expect(moved?.locationId).toBe(pantry.id);
});
