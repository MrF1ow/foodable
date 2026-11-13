import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import { test, expect } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    addFoodByBarcode,
    addLocation,
    createMemoryFridgeStore,
    listFridge,
} from "./fridge.js";
import { createMemoryFoodsStore, findManualFood, newFood } from "./foods.js";
import {
    addGroceryFoodByBarcode,
    addGroceryFoodById,
    addGroceryManualFood,
    addFridgeItemToGrocery,
    addGrocerySupply,
    checkGroceryLine,
    clearCheckedLines,
    createMemoryGroceryStore,
    groceryAllergenWarning,
    GroceryInputError,
    groceryLineFromRow,
    groceryLineToRow,
    listGrocery,
    onGroceryList,
    pickGroceryAmount,
    pickGroceryStore,
    resolveGroceryLineSource,
    resolveGrocerySectionId,
    type GroceryAmountPickReason,
    type GroceryStorePickReason,
} from "./grocery.js";
import { alreadyHaveTag } from "./linking.js";
import { createGroceryStore, createMemorySettingsStore } from "./settings.js";
import { renderGroceryPage } from "../web/pages/grocery.js";
import { addAllergen, createMemoryRulesStore } from "./rules.js";
import { addFridgeItemAdjust, createMemoryStockStore } from "./stock.js";

const HH = "hh-1";
const OTHER_HH = "hh-2";

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

async function seedStore() {
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Safeway");
    const sections = await settings.listSections(store.id);
    const dairy = sections.find((row) => row.name === "Dairy")!;
    const other = sections.find((row) => row.isOther)!;
    return { settings, store, dairy, other };
}

test("pickGroceryStore precedence: chosen, usual, list, default", () => {
    const stores = [
        { id: "a", householdId: HH, name: "A", sortOrder: 0 },
        { id: "b", householdId: HH, name: "B", sortOrder: 1 },
    ];
    expect(
        pickGroceryStore({
            chosenStoreId: "b",
            usualStoreId: "a",
            stores,
            lines: [],
            foodId: null,
        }),
    ).toEqual({ storeId: "b", reason: "chosen" });
    expect(
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: "b",
            stores,
            lines: [],
            foodId: null,
        }),
    ).toEqual({ storeId: "b", reason: "usual" });
    expect(
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: "costco",
            stores,
            lines: [
                {
                    id: "l1",
                    householdId: HH,
                    storeId: "a",
                    sectionId: "s",
                    kind: "food",
                    displayName: "Milk",
                    quantity: { amount: 1, unit: "L" },
                    foodId: "food-plain",
                    checked: false,
                    source: "manual",
                    sourceFridgeItemId: null,
                    note: null,
                },
            ],
            foodId: "food-plain",
        }),
    ).toEqual({ storeId: "a", reason: "list" });
    expect(
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: null,
            stores,
            lines: [],
            foodId: null,
        }),
    ).toEqual({ storeId: "a", reason: "default" });
});

test("pickGroceryStore: family list uses product line for plain food", () => {
    const stores = [
        { id: "a", householdId: HH, name: "A", sortOrder: 0 },
        { id: "b", householdId: HH, name: "B", sortOrder: 1 },
    ];
    const eggsPlain = "food-eggs-plain";
    const kirkland = "food-kirkland";
    const familyById = new Map([
        [kirkland, eggsPlain],
        [eggsPlain, eggsPlain],
    ]);
    expect(
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: null,
            stores,
            lines: [
                {
                    id: "l1",
                    householdId: HH,
                    storeId: "b",
                    sectionId: "s",
                    kind: "food",
                    displayName: "Kirkland Eggs",
                    quantity: { amount: 1, unit: "each" },
                    foodId: kirkland,
                    checked: false,
                    source: "manual",
                    sourceFridgeItemId: null,
                    note: null,
                },
            ],
            foodId: eggsPlain,
            familyById,
        }),
    ).toEqual({ storeId: "b", reason: "list" });
});

test("pickGroceryStore: no stores throws", () => {
    expect(() =>
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: null,
            stores: [],
            lines: [],
            foodId: null,
        }),
    ).toThrow(GroceryInputError);
    expect(() =>
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: null,
            stores: [],
            lines: [],
            foodId: null,
        }),
    ).toThrow("Add a store first.");
});

test("pickGroceryStore: stale usual id falls through to default", () => {
    const stores = [
        { id: "a", householdId: HH, name: "A", sortOrder: 0 },
        { id: "b", householdId: HH, name: "B", sortOrder: 1 },
    ];
    expect(
        pickGroceryStore({
            chosenStoreId: null,
            usualStoreId: "gone",
            stores,
            lines: [],
            foodId: null,
        }),
    ).toEqual({ storeId: "a", reason: "default" });
});

test("pickGroceryAmount: chosen vs usual vs default 1 defaultUnit", () => {
    const food = { defaultUnit: "g" };
    expect(
        pickGroceryAmount({
            amount: 3,
            unit: "lb",
            usual: { amount: 12, unit: "each" },
            food,
        }),
    ).toEqual({
        quantity: { amount: 3, unit: "lb" },
        reason: "chosen",
    });
    expect(
        pickGroceryAmount({
            usual: { amount: 6, unit: "each" },
            food,
        }),
    ).toEqual({
        quantity: { amount: 6, unit: "each" },
        reason: "usual",
    });
    expect(
        pickGroceryAmount({
            usual: { amount: 6, unit: "each" },
            unit: "each",
            food,
        }),
    ).toEqual({
        quantity: { amount: 6, unit: "each" },
        reason: "usual",
    });
    expect(
        pickGroceryAmount({
            usual: { amount: 6, unit: "each" },
            unit: "g",
            food,
        }),
    ).toEqual({
        quantity: { amount: 1, unit: "g" },
        reason: "default",
    });
});

test("pickGroceryAmount: an amount nobody gave is never 1 g or 1 ml", () => {
    const pick = (defaultUnit: string, unit?: string) =>
        pickGroceryAmount({ unit, usual: null, food: { defaultUnit } });
    // A food whose catalog unit is the base mass or volume has no sensible
    // "1": the line says 1 each instead.
    expect(pick("g")).toEqual({
        quantity: { amount: 1, unit: "each" },
        reason: "default",
    });
    expect(pick("ml").quantity).toEqual({ amount: 1, unit: "each" });
    expect(pick("").quantity).toEqual({ amount: 1, unit: "each" });
    // A unit that is a shopping unit on its own is kept.
    expect(pick("each").quantity).toEqual({ amount: 1, unit: "each" });
    expect(pick("lb").quantity).toEqual({ amount: 1, unit: "lb" });
    expect(pick("cup").quantity).toEqual({ amount: 1, unit: "cup" });
    // A unit the caller named stays, whatever it is.
    expect(pick("each", "g").quantity).toEqual({ amount: 1, unit: "g" });
    // An amount the caller chose is theirs: 3 with no unit is 3 of the catalog unit.
    expect(
        pickGroceryAmount({
            amount: 3,
            usual: null,
            food: { defaultUnit: "g" },
        }).quantity,
    ).toEqual({ amount: 3, unit: "g" });
});

test("a restock add for a food with no usual amount lists 1 each, not 1 g", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    // Foods default to "g" when nothing else is set, as Spinach does here.
    const spinach = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Spinach" }),
    );
    expect(spinach.defaultUnit).toBe("g");
    const line = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        foodId: spinach.id,
        source: "restock",
    });
    expect(line.quantity).toEqual({ amount: 1, unit: "each" });
});

test("addGroceryFoodById auto-picks usual store and amount via effectiveFood", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings } = await seedStore();
    const second = await createGroceryStore(settings, HH, "Costco");
    const secondSections = await settings.listSections(second.id);
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualStoreId: second.id,
            usualAmount: { amount: 12, unit: "each" },
        }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Eggs",
            genericFoodId: plain.id,
        }),
    );
    await foods.updateFoodRow({ ...plain, usualProductId: product.id });
    let picked: {
        storeReason: GroceryStorePickReason;
        amountReason: GroceryAmountPickReason;
    } | null = null;
    const line = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        foodId: plain.id,
        onPicked: (p) => {
            picked = {
                storeReason: p.storeReason,
                amountReason: p.amountReason,
            };
        },
    });
    expect(line.storeId).toBe(second.id);
    expect(line.quantity).toEqual({ amount: 12, unit: "each" });
    expect(picked).not.toBeNull();
    expect(picked!).toEqual({
        storeReason: "usual",
        amountReason: "usual",
    });
    expect(line.sectionId).toBeTruthy();
    expect(secondSections.some((s) => s.id === line.sectionId)).toBe(true);
});

test("lines without source default to manual with no fridge item", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const byId = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        foodId: (
            await foods.insertFood(
                newFood({ householdId: HH, kind: "food", name: "Rye" }),
            )
        ).id,
        amount: 1,
        unit: "loaf",
    });
    expect(byId.source).toBe("manual");
    expect(byId.sourceFridgeItemId).toBeNull();

    const manual = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        name: "Quinoa",
        amount: 500,
        unit: "g",
    });
    expect(manual.source).toBe("manual");
    expect(manual.sourceFridgeItemId).toBeNull();
});

test("resolveGroceryLineSource and add reject invalid fridge pairings", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const { settings, store, dairy } = await seedStore();
    await addLocation(fridge, HH, "Pantry");
    const loc = (await fridge.listLocations(HH))[0]!;
    const food = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Probe Food" }),
    );
    const item = await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: HH,
        locationId: loc.id,
        kind: "food",
        displayName: "Probe",
        quantity: { amount: 1, unit: "g" },
        foodId: food.id,
    });

    await expect(
        resolveGroceryLineSource(undefined, HH, {
            source: "manual",
            sourceFridgeItemId: item.id,
        }),
    ).rejects.toBeInstanceOf(GroceryInputError);

    await expect(
        resolveGroceryLineSource(fridge, HH, {
            source: "recipe",
            sourceFridgeItemId: item.id,
        }),
    ).rejects.toBeInstanceOf(GroceryInputError);

    await expect(
        resolveGroceryLineSource(fridge, HH, {
            source: "restock",
            sourceFridgeItemId: item.id,
        }),
    ).resolves.toEqual({
        source: "restock",
        sourceFridgeItemId: item.id,
    });

    await expect(
        resolveGroceryLineSource(fridge, HH, {
            source: "restock",
            sourceFridgeItemId: "00000000-0000-0000-0000-00000000dead",
        }),
    ).rejects.toBeInstanceOf(GroceryInputError);

    await addLocation(fridge, OTHER_HH, "Other");
    const otherLoc = (await fridge.listLocations(OTHER_HH))[0]!;
    const otherItem = await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: OTHER_HH,
        locationId: otherLoc.id,
        kind: "food",
        displayName: "Other",
        quantity: { amount: 1, unit: "g" },
        foodId: food.id,
    });

    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Reject Name A",
            fridge,
            source: "restock",
            sourceFridgeItemId: otherItem.id,
        }),
    ).rejects.toBeInstanceOf(GroceryInputError);

    // A restock id with no fridge store to check it against is refused, not
    // a TypeError, and before any catalog row is created.
    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Reject Name C",
            source: "restock",
            sourceFridgeItemId: item.id,
        }),
    ).rejects.toBeInstanceOf(GroceryInputError);
    expect(await findManualFood(foods, HH, "food", "Reject Name C")).toBeNull();

    const before = await foods.listFoods(HH);
    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Reject Name B",
            source: "manual",
            sourceFridgeItemId: item.id,
            fridge,
        }),
    ).rejects.toBeInstanceOf(GroceryInputError);
    const after = await foods.listFoods(HH);
    expect(after.length).toBe(before.length);
    expect(await findManualFood(foods, HH, "food", "Reject Name B")).toBeNull();
});

test("restock and notice lines store a same-household fridge item id", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const { settings, store, dairy } = await seedStore();
    await addLocation(fridge, HH, "Shelf");
    const loc = (await fridge.listLocations(HH))[0]!;
    const food = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Stocked" }),
    );
    const item = await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: HH,
        locationId: loc.id,
        kind: "food",
        displayName: "Stocked",
        quantity: { amount: 2, unit: "kg" },
        foodId: food.id,
    });

    const restock = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        foodId: food.id,
        amount: 1,
        unit: "kg",
        fridge,
        source: "restock",
        sourceFridgeItemId: item.id,
    });
    expect(restock.source).toBe("restock");
    expect(restock.sourceFridgeItemId).toBe(item.id);

    const notice = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        name: "Stocked",
        amount: 0.5,
        unit: "kg",
        fridge,
        source: "notice",
        sourceFridgeItemId: item.id,
    });
    expect(notice.source).toBe("notice");
    expect(notice.sourceFridgeItemId).toBe(item.id);
});

test("add grocery line then lists it under the chosen section", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const line = await addGroceryFoodByBarcode(
        grocery,
        settings,
        foods,
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            barcode: "070852010016",
            amount: 1360.8,
        },
        {
            lookup: async () =>
                food({
                    name: "Good Culture Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    expect(line.displayName).toBe("Good Culture Cottage Cheese");
    expect(line.checked).toBe(false);
    expect(line.quantity).toEqual({ amount: 1360.8, unit: "g" });
    expect(line.foodId).toBeTruthy();
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines).toHaveLength(1);
    expect(listed.lines[0]?.sectionId).toBe(dairy.id);
});

test("check line stays on the list and does not insert into fridge", async () => {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const { settings, store, dairy } = await seedStore();
    await addLocation(fridge, HH, "Fridge");
    const line = await addGrocerySupply(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Foil",
            amount: 1,
            unit: "roll",
        },
    );
    const checked = await checkGroceryLine(grocery, HH, line.id, true);
    expect(checked?.checked).toBe(true);
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines).toHaveLength(1);
    expect(listed.lines[0]?.checked).toBe(true);
    expect((await listFridge(fridge, HH)).items).toEqual([]);
});

test("clear checked removes only checked rows", async () => {
    const grocery = createMemoryGroceryStore();
    const { settings, store, dairy } = await seedStore();
    const keep = await addGrocerySupply(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Wipes",
            amount: 1,
            unit: "pack",
        },
    );
    const drop = await addGrocerySupply(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Foil",
            amount: 1,
            unit: "roll",
        },
    );
    await checkGroceryLine(grocery, HH, drop.id, true);
    const removed = await clearCheckedLines(grocery, HH);
    expect(removed).toBe(1);
    const listed = await listGrocery(grocery, settings, HH);
    expect(listed.lines.map((row) => row.id)).toEqual([keep.id]);
});

test("unknown section files the line under Other", async () => {
    const grocery = createMemoryGroceryStore();
    const { settings, store, other } = await seedStore();
    expect(await resolveGrocerySectionId(settings, store.id, "")).toBe(
        other.id,
    );
    const line = await addGroceryManualFood(
        grocery,
        settings,
        createMemoryFoodsStore(),
        {
            householdId: HH,
            storeId: store.id,
            name: "Zorblax",
            amount: 1,
        },
    );
    expect(line.sectionId).toBe(other.id);
});

test("a line with no section lands in the aisle its name suggests", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const sections = await settings.listSections(store.id);
    const named = (id: string) => sections.find((row) => row.id === id)!.name;
    const cases: [string, string][] = [
        ["Butter", "Dairy"],
        ["Eggs", "Dairy"],
        ["All-purpose flour", "Pantry"],
        ["Peanut butter", "Pantry"],
        ["Ripe bananas", "Produce"],
        ["Chicken broth", "Pantry"],
        ["Chicken thighs", "Meat & seafood"],
        ["Frozen peas", "Frozen"],
        ["Ice cream", "Frozen"],
    ];
    for (const [name, section] of cases) {
        const line = await addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            name,
            amount: 1,
        });
        expect([name, named(line.sectionId)]).toEqual([name, section]);
    }
    const supply = await addGrocerySupply(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "Batteries",
        amount: 4,
        unit: "each",
    });
    expect(named(supply.sectionId)).toBe("Household");
});

test("a food already on the list keeps its section, here and at another store", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const sections = await settings.listSections(store.id);
    const bakery = sections.find((row) => row.name === "Bakery")!;
    const first = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: bakery.id,
        name: "Zorblax",
        amount: 1,
    });
    expect(first.sectionId).toBe(bakery.id);
    const again = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "zorblax",
        amount: 2,
    });
    expect(again.sectionId).toBe(bakery.id);
    const costco = await createGroceryStore(settings, HH, "Costco");
    const costcoBakery = (await settings.listSections(costco.id)).find(
        (row) => row.name === "Bakery",
    )!;
    const there = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: costco.id,
        name: "Zorblax",
        amount: 1,
    });
    expect(there.sectionId).toBe(costcoBakery.id);
});

test("hidden sections are never suggested", async () => {
    const grocery = createMemoryGroceryStore();
    const { settings, store, dairy, other } = await seedStore();
    await settings.updateSection({ ...dairy, hidden: true });
    const line = await addGroceryManualFood(
        grocery,
        settings,
        createMemoryFoodsStore(),
        { householdId: HH, storeId: store.id, name: "Butter", amount: 1 },
    );
    expect(line.sectionId).toBe(other.id);
});

test("matching fridge stock tags the grocery line already-have", async () => {
    const grocery = createMemoryGroceryStore();
    const fridge = createMemoryFridgeStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const loc = await addLocation(fridge, HH, "Fridge");
    const fridgeItem = await addFoodByBarcode(
        fridge,
        foods,
        {
            householdId: HH,
            locationId: loc.id,
            barcode: "070852010016",
            amount: 1360.8,
        },
        {
            lookup: async () =>
                food({
                    name: "Good Culture Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    const line = await addGroceryFoodByBarcode(
        grocery,
        settings,
        foods,
        {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            barcode: "070852010016",
            amount: 1360.8,
        },
        {
            lookup: async () =>
                food({
                    name: "Good Culture Cottage Cheese",
                    barcode: "070852010016",
                }),
        },
    );
    expect(alreadyHaveTag(line, [fridgeItem])).toEqual({ cover: "full" });
});

test("groceryAllergenWarning two-member blocking text matches MCP warning literal", async () => {
    const rules = createMemoryRulesStore();
    await addAllergen(rules, {
        householdId: HH,
        userId: "bob",
        allergen: "peanut",
    });
    await addAllergen(rules, {
        householdId: HH,
        userId: "ann",
        allergen: "peanut",
    });
    const bobAllergens = await rules.listAllergens(HH, "bob");
    const annAllergens = await rules.listAllergens(HH, "ann");
    const members = [
        { displayName: "Bob", userId: "bob", allergens: bobAllergens },
        { displayName: "Ann", userId: "ann", allergens: annAllergens },
    ];
    expect(
        groceryAllergenWarning("Peanut Snack", members, ["peanut"])?.text,
    ).toBe("Contains peanut — Bob, Ann.");
});

test("grocery allergen warning uses catalog allergens before the name", async () => {
    const rules = createMemoryRulesStore();
    await addAllergen(rules, {
        householdId: HH,
        userId: "bob",
        allergen: "peanut",
    });
    const allergens = await rules.listAllergens(HH, "bob");
    const members = [{ displayName: "Bob", allergens }];
    const byName = groceryAllergenWarning("Peanut Butter", members);
    expect(byName?.blocking).toBe(true);
    expect(byName?.text.toLowerCase()).toContain("peanut");
    expect(
        groceryAllergenWarning("Skippy", members, ["peanut"])?.blocking,
    ).toBe(true);
    expect(groceryAllergenWarning("Peanut Butter", members, [])).toBeNull();
    expect(groceryAllergenWarning("Apples", members, null)?.text).toBe(
        "unknown allergen data",
    );
});

test("grocery page groups by store then section and shows already-have", () => {
    const html = renderGroceryPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Safeway",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-dairy",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Dairy",
                        sortOrder: 1,
                        hidden: false,
                        isOther: false,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-dairy",
                                kind: "food",
                                displayName: "Cottage Cheese",
                                quantity: { amount: 1360.8, unit: "g" },
                                foodId: null,
                                checked: false,
                                source: "manual",
                                sourceFridgeItemId: null,
                                note: null,
                                alreadyHave: { cover: "full" },
                            },
                        ],
                    },
                ],
            },
        ],
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).not.toContain("Coming soon.");
    expect(html).toContain("Safeway");
    expect(html).toContain("Dairy");
    expect(html).toContain("Cottage Cheese");
    expect(html).toContain('class="already-have-tag"');
    expect(html).toContain("already have");
    expect(html).toContain('class="quantity-field"');
    expect(html).toContain('class="food-picker"');
    expect(html).toContain('href="/kitchen/groceries" aria-current="page"');
    expect(html).toContain('action="/kitchen/groceries/lines"');
    expect(html).not.toContain('action="/kitchen/groceries/clear-checked"');
    expect(html).toContain('commandfor="grocery-add-food"');
    expect(html).toContain('data-fill-field-store_id="st-1"');
    expect(html).not.toMatch(/<details class="more"/);
    expect(html).not.toContain("<h3>Add supply</h3>");
    expect(html).not.toContain("grocery-add-supply");
    expect(html).not.toContain('name="kind" value="supply"');
    expect(html).not.toContain('data-kind="supply"');
    expect(html).not.toContain("grocery-add-store");
    expect(html).not.toContain('action="/kitchen/groceries/stores"');
});

const groceryChrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

test("owner grocery page has a short add-store form and no add-supply", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).toContain('class="grocery-add-store"');
    expect(html).toContain('action="/kitchen/groceries/stores"');
    expect(html).toContain('id="grocery_store_name"');
    expect(html).toContain('name="name"');
    expect(html).toContain("Add store");
    expect(html).toContain('href="/settings/household">Household</a>');
    expect(html).toContain("under Household");
    expect(html).not.toContain("<h3>Add supply</h3>");
    expect(html).not.toContain("grocery-add-supply");
    expect(html).not.toContain('name="kind" value="supply"');
});

test("owner grocery page keeps the add-store form when a store already exists", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [],
            },
        ],
    });
    expect(html).toContain('<h2 class="row-title">Corner</h2>');
    expect(html).toContain('class="grocery-add-store"');
    expect(html).toContain('action="/kitchen/groceries/stores"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("member grocery page does not get the add-store form", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: false,
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).toContain('href="/settings/household">Household</a>');
    expect(html).toContain("under Household");
    expect(html).not.toContain("grocery-add-store");
    expect(html).not.toContain('action="/kitchen/groceries/stores"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("empty store name error re-renders groceries with the banner", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
        error: "Enter a store name.",
    });
    expect(html).toContain("<h1>Groceries</h1>");
    expect(html).toContain('class="error-banner"');
    expect(html).toContain("Enter a store name.");
    expect(html).toContain('action="/kitchen/groceries/stores"');
    expect(html).not.toContain("<h3>Add supply</h3>");
});

test("grocery lines are rows with a labelled round check button", () => {
    const html = renderGroceryPage({
        chrome: {
            theme: "light",
            attention: { count: 0, tabs: {} },
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        canManage: true,
        locations: [{ id: "l1", name: "Fridge" }],
        stores: [
            {
                id: "st-1",
                householdId: "hh-1",
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: "hh-1",
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: "hh-1",
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    } as never);
    expect(html).toContain('<ul class="grocery-lines list">');
    expect(html).toContain(
        '<button type="submit" class="check-btn" aria-pressed="true"><span class="visually-hidden">Uncheck Milk</span></button>',
    );
    expect(html).toContain('<form class="grocery-put-away row-actions"');
    expect(html).toContain(
        '<button type="submit" class="btn-sm btn-primary">Put away</button>',
    );
    expect(html).not.toMatch(/id="put-away-tip-/);
    expect(html).toContain('commandfor="grocery-add-food"');
    expect(html).toContain('data-fill-field-store_id="st-1"');
    expect(html).toContain('id="grocery-add-food"');
    expect(html).not.toContain('id="grocery-add-food-st-1"');
    expect(html).toContain('commandfor="grocery-clear-checked"');
    expect(html).toContain('action="/kitchen/groceries/clear-checked"');
    expect(html).toContain("grocery-clear-checked");
    expect(html).not.toMatch(/<details class="more"/);
});

test("grocery header actions and modals match fridge patterns", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        locations: [{ id: "l1", name: "Fridge" }],
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    } as never);
    expect(html).toContain('<header class="dash-head">');
    expect(html).toContain('commandfor="grocery-add-store"');
    expect(html).toContain('commandfor="grocery-clear-checked"');
    expect(html).toMatch(
        /<button type="button" class="btn-sm btn-danger" commandfor="grocery-clear-checked"/,
    );
    expect(html).toContain('class="grocery-line-put-away row-actions"');
    expect(html).toContain("Remove every checked item from the list?");
    expect(html).toContain('commandfor="grocery-add-food"');
    expect(html).toContain('data-fill-field-store_id="st-1"');
    expect(html).toContain('<form class="grocery-put-away row-actions"');
    expect(html).not.toMatch(/<details class="more"/);
});

test("member grocery page has no add-store trigger or form", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        canManage: false,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
    } as never);
    expect(html).not.toContain('commandfor="grocery-add-store"');
    expect(html).not.toContain("grocery-add-store");
});

test("a server error reopens the grocery modal that submitted the form", () => {
    const addStore = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
        error: "Enter a store name.",
        openModalId: "grocery-add-store",
    });
    expect(addStore).toMatch(
        /<dialog class="modal" id="grocery-add-store"[^>]*data-modal-open-on-load/,
    );
    const clearChecked = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        locations: [{ id: "l1", name: "Fridge" }],
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: HH,
                                storeId: "st-1",
                                sectionId: "sec-other",
                                kind: "food",
                                displayName: "Milk",
                                quantity: { amount: 1, unit: "each" },
                                foodId: "f-1",
                                checked: true,
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
            },
        ],
        error: "Could not clear.",
        openModalId: "grocery-clear-checked",
    } as never);
    expect(clearChecked).toMatch(
        /<dialog class="modal" id="grocery-clear-checked"[^>]*data-modal-open-on-load/,
    );
    const addFood = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
        ],
        error: "Pick a food.",
        openModalId: "grocery-add-food-st-1",
    } as never);
    expect(addFood).toMatch(
        /<dialog class="modal" id="grocery-add-food"[^>]*data-modal-open-on-load/,
    );
    expect(addFood).not.toContain('id="grocery-add-food-st-1"');
    const foodDialog = dialogHtml(addFood, "grocery-add-food");
    expect(foodDialog).toContain('name="store_id" value="st-1"');
    expect(foodDialog).toContain("data-grocery-section");
    expect(foodDialog).toContain('data-infer-section="sec-other"');
    expect(foodDialog).toContain('<label for="grocery-add-section">');
    expect(foodDialog).toContain("error-banner");
    expect(foodDialog).toContain("Pick a food.");
    expect(addFood.match(/Pick a food\./g)?.length).toBe(1);
    expect(foodDialog).toContain('<button type="submit" class="btn-primary">');
    expect(foodDialog).not.toContain('name="section_id"');
});

test("add-food modal contains the section select with picker forms", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-produce",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Produce",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [],
                    },
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
        ],
    } as never);
    const modal = dialogHtml(html, "grocery-add-food");
    expect(modal).toContain('class="food-picker"');
    expect(modal).toContain('action=""');
    expect(modal).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(modal).not.toContain("data-grocery-section");
    expect(modal).not.toContain('name="section_id"');
    expect(html).toContain(
        'data-fill-template-sections="grocery-sections-st-1"',
    );
    expect(html).toContain('<template id="grocery-sections-st-1">');
    expect(html).toContain("data-grocery-section");
    expect(html).toContain('data-infer-section="sec-other"');
    expect(html).toContain('value="sec-produce"');
    expect(html).toContain('for="grocery-add-section"');
    expect(html).not.toContain("popovertarget=");
    expect(html).toContain('data-fill-action="/kitchen/groceries/lines"');
});

test("owner with no stores does not auto-open the add-store modal", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [],
        canManage: true,
    });
    expect(html).toContain('id="grocery-add-store"');
    expect(html).not.toMatch(
        /<dialog class="modal" id="grocery-add-store"[^>]*data-modal-open-on-load/,
    );
    expect(html).toContain('commandfor="grocery-add-store"');
});

test("blocking allergen warning and Add anyway form render inside the reopened add-food modal", () => {
    const html = renderGroceryPage({
        chrome: groceryChrome,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Corner",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
        ],
        allergenNotices: [
            {
                code: "grocery.allergen",
                severity: "block",
                subject: { kind: "grocery_line", id: "" },
                related: [{ kind: "member", id: "stub-user", name: "Bob" }],
                params: { allergens: ["peanut"] },
            },
        ],
        openModalId: "grocery-add-food-st-1",
        allergenRetry: {
            storeId: "st-1",
            fields: {
                kind: "food",
                store_id: "st-1",
                food_name: "Peanut Butter",
                qty_amount: "1",
                qty_unit: "each",
            },
        },
    } as never);
    const modal = dialogHtml(html, "grocery-add-food");
    // The warning sits only in the reopened modal, not as a page banner.
    expect(html.replace(modal, "")).not.toContain("allergen-warning");
    expect(modal).toContain('class="notice-list allergen-warning"');
    expect(modal).toContain("data-fill-transient");
    expect(modal).toContain('name="confirm_allergen" value="1"');
    expect(modal).toContain("Add anyway");
    expect(modal).toContain('name="food_name" value="Peanut Butter"');
    expect(modal).toContain('name="store_id" value="st-1"');
    expect(html).not.toContain('id="grocery-add-food-st-1"');
});

function dialogHtml(html: string, id: string): string {
    const dialog = html.match(
        new RegExp(`<dialog class="modal" id="${id}"[\\s\\S]*?</dialog>`),
    )?.[0];
    expect(dialog).toBeDefined();
    return dialog!;
}

test("add-food dialog count does not grow with stores", () => {
    function page(count: number) {
        const stores = Array.from({ length: count }, (_, index) => ({
            id: `st-${index + 1}`,
            householdId: HH,
            name: `Store ${index + 1}`,
            sortOrder: index,
            rules: [],
            sections: [
                {
                    id: `sec-st-${index + 1}`,
                    householdId: HH,
                    storeId: `st-${index + 1}`,
                    name:
                        index === count - 1
                            ? `"><img src=x onerror=alert(1)>`
                            : "Produce",
                    sortOrder: 0,
                    hidden: false,
                    isOther: false,
                    lines: [],
                },
            ],
        }));
        return renderGroceryPage({
            chrome: groceryChrome,
            canManage: true,
            stores,
        } as never);
    }
    const one = page(1);
    const six = page(6);
    const dialogs = (html: string) => html.match(/<dialog\b/g)?.length ?? 0;
    expect(dialogs(one)).toBe(dialogs(six));
    // 2 on the page, 5 from the shell's log sheets.
    expect(dialogs(one)).toBe(7);
    expect(six.match(/id="grocery-add-food"/g)?.length).toBe(1);
    expect(six.match(/data-food-picker/g)?.length).toBe(1);
    expect(six.match(/commandfor="grocery-add-food"/g)?.length).toBe(7);
    expect(six).toContain('data-fill-field-store_id="st-6"');
    expect(six).toContain(
        'data-fill-template-sections="grocery-sections-st-6"',
    );
    expect(six).toContain('<template id="grocery-sections-st-6">');
    expect(six).toContain('value="sec-st-6"');
    expect(six).not.toContain('id="grocery-add-food-st-1"');
    expect(six).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(six).not.toContain('"><img src=x');
    expect(six).not.toContain("onerror=alert(1)>");
    expect(dialogHtml(six, "grocery-add-food")).toContain(
        '<button type="submit" class="btn-primary" disabled>',
    );
    expect(dialogHtml(six, "grocery-add-food")).not.toContain(
        "data-grocery-section",
    );

    const reopened = renderGroceryPage({
        chrome: groceryChrome,
        canManage: true,
        stores: [
            {
                id: "st-1",
                householdId: HH,
                name: "Safeway",
                sortOrder: 0,
                rules: [],
                sections: [
                    {
                        id: "sec-produce",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Produce",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [],
                    },
                    {
                        id: "sec-other",
                        householdId: HH,
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 8,
                        hidden: false,
                        isOther: true,
                        lines: [],
                    },
                ],
            },
            {
                id: "st-2",
                householdId: HH,
                name: "Costco",
                sortOrder: 1,
                rules: [],
                sections: [
                    {
                        id: "sec-dairy",
                        householdId: HH,
                        storeId: "st-2",
                        name: "Dairy",
                        sortOrder: 0,
                        hidden: false,
                        isOther: false,
                        lines: [],
                    },
                ],
            },
        ],
        error: "Pick a food.",
        openModalId: "grocery-add-food-st-2",
    } as never);
    const costco = dialogHtml(reopened, "grocery-add-food");
    expect(costco).toMatch(/data-modal-open-on-load/);
    expect(costco).toContain('data-filled-template="grocery-sections-st-2"');
    expect(costco).toContain('value="sec-dairy"');
    expect(costco).toContain(">Dairy</option>");
    expect(costco).not.toContain("sec-produce");
    expect(costco).not.toContain("data-infer-section");
    expect(costco).toContain(
        '<input type="hidden" name="section_id" value="sec-dairy" data-grocery-section-field />',
    );
    expect(costco).toContain('name="store_id" value="st-2"');
    expect(costco).toContain("Pick a food.");
    expect(reopened.match(/Pick a food\./g)?.length).toBe(1);
    expect(reopened).toContain('<template id="grocery-sections-st-1">');
    expect(reopened).toContain('value="sec-produce"');
    expect(reopened).toContain(
        'data-fill-template-sections="grocery-sections-st-1"',
    );
});

test("addGroceryFoodById explicit store+amount matches legacy line shape", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const food = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            defaultUnit: "each",
        }),
    );
    const line = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        foodId: food.id,
        amount: 12,
        unit: "each",
    });
    expect(line.storeId).toBe(store.id);
    expect(line.sectionId).toBe(dairy.id);
    expect(line.quantity).toEqual({ amount: 12, unit: "each" });
    expect(line.foodId).toBe(food.id);
    expect(line.displayName).toBe("Eggs");
});

test("addGroceryManualFood with bad amount creates no new food", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const before = await foods.listFoods(HH);
    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            name: `Soap-${crypto.randomUUID()}`,
            amount: 0,
        }),
    ).rejects.toThrow("Enter an amount greater than zero.");
    expect(await foods.listFoods(HH)).toEqual(before);
});

test("addGroceryManualFood with NaN amount creates no new food", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const before = await foods.listFoods(HH);
    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            name: `NaNy-${crypto.randomUUID()}`,
            amount: Number.NaN,
        }),
    ).rejects.toThrow("Enter an amount greater than zero.");
    expect(await foods.listFoods(HH)).toEqual(before);
});

test("addGrocerySupply with whitespace-only store id throws Unknown store", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings } = await seedStore();
    await expect(
        addGrocerySupply(grocery, settings, foods, {
            householdId: HH,
            storeId: "   ",
            name: "Foil",
            amount: 1,
            unit: "roll",
        }),
    ).rejects.toThrow("Unknown store.");
});

test("addGrocerySupply without amount or unit and no usual pair throws Enter a unit", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    await expect(
        addGrocerySupply(grocery, settings, foods, {
            householdId: HH,
            storeId: store.id,
            sectionId: dairy.id,
            name: "Sponges",
        }),
    ).rejects.toThrow("Enter a unit.");
    expect(await foods.listFoods(HH)).toEqual([]);
    expect(await grocery.listLines(HH)).toEqual([]);
});

test("addGrocerySupply without amount or unit uses an existing supply's usual pair", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const foil = await foods.insertFood({
        ...newFood({ householdId: HH, kind: "supply", name: "Foil" }),
        usualAmount: { amount: 2, unit: "each" },
    });
    const line = await addGrocerySupply(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        name: "foil",
    });
    expect(line.foodId).toBe(foil.id);
    expect(line.quantity).toEqual({ amount: 2, unit: "each" });
    expect(await foods.listFoods(HH)).toHaveLength(1);
});

test("a line with no store in a household with no stores creates no food", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const settings = createMemorySettingsStore();
    await expect(
        addGroceryManualFood(grocery, settings, foods, {
            householdId: HH,
            name: "Sourdough",
            amount: 1,
        }),
    ).rejects.toThrow("Add a store first.");
    await expect(
        addGrocerySupply(grocery, settings, foods, {
            householdId: HH,
            name: "Sponges",
            amount: 1,
            unit: "each",
        }),
    ).rejects.toThrow("Add a store first.");
    expect(await foods.listFoods(HH)).toEqual([]);
});

test("addGroceryFoodById no store no amount uses usual store and name-based section", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const sections = await settings.listSections(store.id);
    const dairy = sections.find((row) => row.name === "Dairy")!;
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualStoreId: store.id,
            usualAmount: { amount: 12, unit: "each" },
        }),
    );
    const line = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        foodId: plain.id,
    });
    expect(line.storeId).toBe(store.id);
    expect(line.sectionId).toBe(dairy.id);
    expect(line.quantity).toEqual({ amount: 12, unit: "each" });
});

test("onGroceryList family matching", async () => {
    const foods = createMemoryFoodsStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Eggs",
            genericFoodId: plain.id,
        }),
    );
    const foodsById = new Map([
        [plain.id, { id: plain.id, genericFoodId: null }],
        [product.id, { id: product.id, genericFoodId: plain.id }],
    ]);
    expect(
        onGroceryList(
            { foodId: product.id },
            [{ foodId: plain.id, checked: false }],
            foodsById,
        ),
    ).toBe(true);
    expect(
        onGroceryList(
            { foodId: product.id },
            [{ foodId: plain.id, checked: true }],
            foodsById,
        ),
    ).toBe(false);
    const other = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    foodsById.set(other.id, { id: other.id, genericFoodId: null });
    expect(
        onGroceryList(
            { foodId: product.id },
            [{ foodId: other.id, checked: false }],
            foodsById,
        ),
    ).toBe(false);
    expect(
        onGroceryList(
            { foodId: plain.id },
            [{ foodId: null, checked: false }],
            foodsById,
        ),
    ).toBe(false);
    expect(
        onGroceryList(
            { foodId: "ghost-food" },
            [{ foodId: "ghost-food", checked: false }],
            new Map(),
        ),
    ).toBe(true);
    expect(
        onGroceryList(
            { foodId: "ghost-food" },
            [{ foodId: "other-ghost", checked: false }],
            new Map(),
        ),
    ).toBe(false);
});

test("addFridgeItemToGrocery uses fridge item amount when plain has no usual amount", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const { settings } = await seedStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Bananas" }),
    );
    const loc = await addLocation(fridge, HH, "Fridge");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 6,
        unit: "each",
        locationId: loc.id,
        actorUserId: "u1",
    });
    const { line } = await addFridgeItemToGrocery(
        grocery,
        settings,
        foods,
        fridge,
        { householdId: HH, itemId: added.item!.id },
    );
    expect(line.quantity).toEqual({ amount: 6, unit: "each" });
});

test("addFridgeItemToGrocery uses usual on the usual product when plain has none", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const { settings } = await seedStore();
    const costco = await createGroceryStore(settings, HH, "Costco");
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const kirkland = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Eggs",
            genericFoodId: plain.id,
            usualStoreId: costco.id,
            usualAmount: { amount: 24, unit: "each" },
        }),
    );
    await foods.updateFoodRow({
        ...plain,
        usualProductId: kirkland.id,
    });
    const loc = await addLocation(fridge, HH, "Fridge");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: kirkland.id,
        amount: 6,
        unit: "each",
        locationId: loc.id,
        actorUserId: "u1",
    });
    const { line } = await addFridgeItemToGrocery(
        grocery,
        settings,
        foods,
        fridge,
        { householdId: HH, itemId: added.item!.id },
    );
    expect(line.foodId).toBe(plain.id);
    expect(line.storeId).toBe(costco.id);
    expect(line.quantity).toEqual({ amount: 24, unit: "each" });
});

test("addFridgeItemToGrocery uses standalone food usual store and amount", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const { settings } = await seedStore();
    const market = await createGroceryStore(settings, HH, "Market");
    const butter = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Butter",
            usualStoreId: market.id,
            usualAmount: { amount: 2, unit: "each" },
        }),
    );
    const loc = await addLocation(fridge, HH, "Fridge");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: butter.id,
        amount: 1,
        unit: "each",
        locationId: loc.id,
        actorUserId: "u1",
    });
    const { line } = await addFridgeItemToGrocery(
        grocery,
        settings,
        foods,
        fridge,
        { householdId: HH, itemId: added.item!.id },
    );
    expect(line.storeId).toBe(market.id);
    expect(line.quantity).toEqual({ amount: 2, unit: "each" });
});

test("addFridgeItemToGrocery defaults quantity when fridge unit is not a food quantity unit", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const { settings } = await seedStore();
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Wraps",
            defaultUnit: "each",
        }),
    );
    const loc = await addLocation(fridge, HH, "Fridge");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: plain.id,
        amount: 3,
        unit: "roll",
        locationId: loc.id,
        actorUserId: "u1",
    });
    const { line } = await addFridgeItemToGrocery(
        grocery,
        settings,
        foods,
        fridge,
        { householdId: HH, itemId: added.item!.id },
    );
    expect(line.quantity).toEqual({ amount: 1, unit: "each" });
});

test("addFridgeItemToGrocery adds at usual store and amount", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const { settings } = await seedStore();
    const costco = await createGroceryStore(settings, HH, "Costco");
    const plain = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            usualStoreId: costco.id,
            usualAmount: { amount: 12, unit: "each" },
        }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Eggs",
            genericFoodId: plain.id,
        }),
    );
    await foods.updateFoodRow({ ...plain, usualProductId: product.id });
    const loc = await addLocation(fridge, HH, "Fridge");
    const added = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: product.id,
        amount: 6,
        unit: "each",
        locationId: loc.id,
        actorUserId: "u1",
    });
    const first = await addFridgeItemToGrocery(
        grocery,
        settings,
        foods,
        fridge,
        { householdId: HH, itemId: added.item!.id },
    );
    expect(first.added).toBe(true);
    expect(first.line.foodId).toBe(plain.id);
    expect(first.line.storeId).toBe(costco.id);
    expect(first.line.quantity).toEqual({ amount: 12, unit: "each" });
    expect(first.line.source).toBe("notice");
    expect(first.line.sourceFridgeItemId).toBe(added.item!.id);
    const before = (await grocery.listLines(HH)).length;
    const second = await addFridgeItemToGrocery(
        grocery,
        settings,
        foods,
        fridge,
        { householdId: HH, itemId: added.item!.id },
    );
    expect(second.added).toBe(false);
    expect((await grocery.listLines(HH)).length).toBe(before);
});

test("addFridgeItemToGrocery rejects other household and non-food", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    const { settings } = await seedStore();
    const loc = await addLocation(fridge, OTHER_HH, "Fridge");
    const item = await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: OTHER_HH,
        foodId: (
            await foods.insertFood(
                newFood({ householdId: OTHER_HH, kind: "food", name: "X" }),
            )
        ).id,
        amount: 1,
        unit: "g",
        locationId: loc.id,
        actorUserId: "u1",
    });
    await expect(
        addFridgeItemToGrocery(grocery, settings, foods, fridge, {
            householdId: HH,
            itemId: item.item!.id,
        }),
    ).rejects.toThrow(/no longer in the fridge/);
    const supplyLoc = await addLocation(fridge, HH, "Pantry");
    const supply = await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: HH,
        locationId: supplyLoc.id,
        kind: "supply",
        displayName: "Foil",
        quantity: { amount: 1, unit: "roll" },
        foodId: (
            await foods.insertFood(
                newFood({ householdId: HH, kind: "supply", name: "Foil" }),
            )
        ).id,
        expiresOn: "2026-01-01",
    });
    await expect(
        addFridgeItemToGrocery(grocery, settings, foods, fridge, {
            householdId: HH,
            itemId: supply.id,
        }),
    ).rejects.toThrow(/Only food can be added/);
});

test("grocery line note round-trips row mappers and memory store", async () => {
    const line = groceryLineFromRow({
        id: "g1",
        household_id: HH,
        store_id: "s1",
        section_id: "sec1",
        kind: "food",
        display_name: "Salt",
        amount: 1,
        unit: "g",
        checked: false,
        food_id: "food-salt",
        note: "to taste",
    });
    expect(line.note).toBe("to taste");
    expect(groceryLineToRow(line).note).toBe("to taste");
    const grocery = createMemoryGroceryStore();
    const settings = createMemorySettingsStore();
    const store = await createGroceryStore(settings, HH, "Shop");
    const section = (await settings.listSections(store.id))[0]!;
    const saved = await grocery.insertLine({
        id: "line-note",
        householdId: HH,
        storeId: store.id,
        sectionId: section.id,
        kind: "food",
        displayName: "Salt",
        quantity: { amount: 1, unit: "g" },
        foodId: "food-salt",
        checked: false,
        note: "to taste",
        source: "manual",
        sourceFridgeItemId: null,
    });
    expect((await grocery.listLines(HH))[0]?.note).toBe(saved.note);
});

test("ticking a line off stamps the usual's last restocked day, never backwards", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    const plain = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const product = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Oatly Milk",
            genericFoodId: plain.id,
        }),
    );
    const line = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        name: "Milk",
        amount: 1,
        unit: "l",
    });
    // Unticking and a tick without the stamp options leave the date alone.
    await checkGroceryLine(grocery, HH, line.id, true);
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBeNull();
    await checkGroceryLine(grocery, HH, line.id, false, {
        foods,
        today: "2026-06-06",
    });
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBeNull();

    await checkGroceryLine(grocery, HH, line.id, true, {
        foods,
        today: "2026-06-06",
    });
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBe(
        "2026-06-06",
    );
    await checkGroceryLine(grocery, HH, line.id, true, {
        foods,
        today: "2026-06-01",
    });
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBe(
        "2026-06-06",
    );

    // A line naming a product stamps its plain food, not the product.
    const productLine = await grocery.insertLine({
        ...line,
        id: "product-line",
        foodId: product.id,
        checked: false,
    });
    await checkGroceryLine(grocery, HH, productLine.id, true, {
        foods,
        today: "2026-06-13",
    });
    expect((await foods.getFood(HH, plain.id))?.lastRestockedOn).toBe(
        "2026-06-13",
    );
    expect((await foods.getFood(HH, product.id))?.lastRestockedOn).toBeNull();
});

test("a failing stamp does not fail a tick that already saved", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store, dairy } = await seedStore();
    await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const line = await addGroceryManualFood(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        sectionId: dairy.id,
        name: "Milk",
        amount: 1,
        unit: "l",
    });
    const broken: typeof foods = {
        ...foods,
        updateFoodRow: async () => {
            throw new Error("db down");
        },
    };
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
        const updated = await checkGroceryLine(grocery, HH, line.id, true, {
            foods: broken,
            today: "2026-06-06",
        });
        expect(updated?.checked).toBe(true);
    } finally {
        console.error = original;
    }
    expect((await grocery.listLines(HH))[0]?.checked).toBe(true);
    expect(errors).toHaveLength(1);
});

test("a restock add folds into the unticked line the store already has", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const milk = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const reused: string[] = [];
    const first = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        foodId: milk.id,
        source: "restock",
        onReused: (line) => reused.push(line.id),
    });
    const second = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        foodId: milk.id,
        source: "restock",
        onReused: (line) => reused.push(line.id),
    });
    expect(second.id).toBe(first.id);
    expect(reused).toEqual([first.id]);
    expect(await grocery.listLines(HH)).toHaveLength(1);
});

test("reuseListed matches the food's family, not just the exact food", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const oats = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Oats" }),
    );
    const quaker = await foods.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Quaker Oats",
            genericFoodId: oats.id,
        }),
    );
    const product = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        foodId: quaker.id,
    });
    const viaGeneric = await addGroceryFoodById(grocery, settings, foods, {
        householdId: HH,
        storeId: store.id,
        foodId: oats.id,
        reuseListed: true,
    });
    expect(viaGeneric.id).toBe(product.id);
    expect(await grocery.listLines(HH)).toHaveLength(1);
});

test("a ticked line, another store, or no reuse flag still adds a new line", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const other = await createGroceryStore(settings, HH, "Costco");
    const milk = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const add = (over: { storeId: string; reuseListed?: boolean }) =>
        addGroceryFoodById(grocery, settings, foods, {
            householdId: HH,
            foodId: milk.id,
            ...over,
        });
    const first = await add({ storeId: store.id });
    // A manual add keeps today's behaviour unless the caller opts in.
    const plain = await add({ storeId: store.id });
    expect(plain.id).not.toBe(first.id);
    // Another store lists it again.
    const elsewhere = await add({ storeId: other.id, reuseListed: true });
    expect(elsewhere.storeId).toBe(other.id);
    // A ticked line is bought, not on the list.
    await checkGroceryLine(grocery, HH, first.id, true);
    await checkGroceryLine(grocery, HH, plain.id, true);
    const again = await add({ storeId: store.id, reuseListed: true });
    expect([first.id, plain.id]).not.toContain(again.id);
    expect(await grocery.listLines(HH)).toHaveLength(4);
});

test("a supply restock add folds into the line already listed", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const args = {
        householdId: HH,
        storeId: store.id,
        name: "Paper towels",
        amount: 2,
        unit: "roll",
        source: "restock" as const,
    };
    const first = await addGrocerySupply(grocery, settings, foods, args);
    const second = await addGrocerySupply(grocery, settings, foods, args);
    expect(second.id).toBe(first.id);
    expect(await grocery.listLines(HH)).toHaveLength(1);
});

test("two restock adds started together leave one line", async () => {
    const grocery = createMemoryGroceryStore();
    const foods = createMemoryFoodsStore();
    const { settings, store } = await seedStore();
    const milk = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    const lines = await Promise.all(
        [0, 1].map(() =>
            addGroceryFoodById(grocery, settings, foods, {
                householdId: HH,
                storeId: store.id,
                foodId: milk.id,
                source: "restock",
            }),
        ),
    );
    expect(lines[0]!.id).toBe(lines[1]!.id);
    expect(await grocery.listLines(HH)).toHaveLength(1);
});
