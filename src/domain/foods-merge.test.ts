import { expect, test } from "bun:test";
import { addLocation, createMemoryFridgeStore, listFridge } from "./fridge.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
    mergedFoodFields,
    mergeFoodPair,
    mergeFoods,
    newFood,
    type Food,
} from "./foods.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
    ledgerMatchesStock,
} from "./stock.js";

const HH = "hh-merge";
const OTHER_HH = "hh-other-merge";

test("mergeFoods: ledger stays consistent when fridge and stock are linked", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);

    const keep = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Keep oats" }),
    );
    const drop = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Drop oats" }),
    );
    const loc = await addLocation(fridge, HH, "Pantry");

    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: keep.id,
        amount: 200,
        unit: "g",
        locationId: loc.id,
    });
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: drop.id,
        amount: 150,
        unit: "g",
        locationId: loc.id,
    });

    const itemsBefore = (await listFridge(fridge, HH)).items;
    const movementsBefore = await stock.listMovements(HH);
    const keepFood = (await foods.getFood(HH, keep.id))!;
    const dropFood = (await foods.getFood(HH, drop.id))!;
    expect(ledgerMatchesStock(itemsBefore, movementsBefore, keepFood)).toBe(
        true,
    );
    expect(ledgerMatchesStock(itemsBefore, movementsBefore, dropFood)).toBe(
        true,
    );

    await mergeFoods(foods, HH, keep.id, drop.id);

    const kept = (await foods.getFood(HH, keep.id))!;
    const itemsAfter = (await listFridge(fridge, HH)).items;
    const movementsAfter = await stock.listMovements(HH);
    // Nothing was lost: both items and both movements now name the kept food.
    expect(itemsAfter).toHaveLength(2);
    expect(movementsAfter).toHaveLength(2);
    expect(itemsAfter.every((i) => i.foodId === keep.id)).toBe(true);
    expect(movementsAfter.every((m) => m.foodId === keep.id)).toBe(true);
    expect(movementsAfter.reduce((sum, m) => sum + m.delta, 0)).toBe(350);
    expect(ledgerMatchesStock(itemsAfter, movementsAfter, kept)).toBe(true);
});

test("mergeFoods: meal-item ref repoints with snapshot extra fields unchanged", async () => {
    const store = createMemoryFoodsStore();
    const keep = await findOrCreateManualFood(store, HH, "food", "Keep item");
    const drop = await findOrCreateManualFood(store, HH, "food", "Drop item");
    const extra = {
        calories: 123,
        proteinG: 4.5,
        grams: 80,
        label: "Drop",
    };
    const ref = store.trackRef(drop.id, HH, extra);
    await mergeFoods(store, HH, keep.id, drop.id);
    expect(ref.foodId).toBe(keep.id);
    expect(ref.calories).toBe(123);
    expect(ref.proteinG).toBe(4.5);
    expect(ref.grams).toBe(80);
    expect(ref.label).toBe("Drop");
});

test("mergeFoods: other household refs and stock are untouched", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);

    const keep = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Keep cross" }),
    );
    const drop = await foods.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Drop cross" }),
    );

    const locHh = await addLocation(fridge, HH, "H");
    const locOther = await addLocation(fridge, OTHER_HH, "O");

    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: keep.id,
        amount: 1,
        unit: "g",
        locationId: locHh.id,
    });

    await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: OTHER_HH,
        locationId: locOther.id,
        kind: "food",
        displayName: "Other row",
        quantity: { amount: 5, unit: "g" },
        foodId: drop.id,
    });
    await stock.insertMovement({
        id: crypto.randomUUID(),
        householdId: OTHER_HH,
        foodId: drop.id,
        fridgeItemId: null,
        delta: 3,
        unit: "g",
        reason: "adjust",
        groceryLineId: null,
        recipeId: null,
        mealId: null,
        actorUserId: null,
        createdAt: new Date().toISOString(),
    });

    const otherRef = { calories: 9, proteinG: 1 };
    const tracked = foods.trackRef(drop.id, OTHER_HH, otherRef);

    await mergeFoods(foods, HH, keep.id, drop.id);

    const otherItems = (await listFridge(fridge, OTHER_HH)).items;
    expect(otherItems[0]?.foodId).toBe(drop.id);
    const otherMovements = await stock.listMovements(OTHER_HH);
    expect(otherMovements.some((m) => m.foodId === drop.id)).toBe(true);
    expect(tracked.foodId).toBe(drop.id);
    expect(tracked.calories).toBe(9);
});

test("mergedFoodFields: takes drop nutrition block when keep has none", () => {
    const keep = sampleRow({
        calories: null,
        proteinG: null,
        nutritionSource: null,
    });
    const drop = sampleRow({
        calories: 100,
        proteinG: 10,
        carbsG: 20,
        fatG: 3,
        fiberG: 2,
        sugarG: 1,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: "openfoodfacts",
    });
    const m = mergedFoodFields(keep, drop);
    expect(nutritionOf(m)).toEqual({
        calories: 100,
        proteinG: 10,
        carbsG: 20,
        fatG: 3,
        fiberG: 2,
        sugarG: 1,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: "openfoodfacts",
    });
});

test("mergedFoodFields: keeps partial keep block when drop has full nutrition", () => {
    const keep = sampleRow({
        calories: 50,
        proteinG: null,
        carbsG: null,
        nutritionSource: "manual",
    });
    const drop = sampleRow({
        calories: 999,
        proteinG: 99,
        carbsG: 99,
        fatG: 99,
        fiberG: 99,
        sugarG: 99,
        alcoholG: 0,
        caffeineMg: 0,
        nutritionSource: "openfoodfacts",
    });
    const m = mergedFoodFields(keep, drop);
    expect(nutritionOf(m)).toEqual({
        calories: 50,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: "manual",
    });
});

function nutritionOf(m: Partial<Food>) {
    return {
        calories: m.calories,
        proteinG: m.proteinG,
        carbsG: m.carbsG,
        fatG: m.fatG,
        fiberG: m.fiberG,
        sugarG: m.sugarG,
        alcoholG: m.alcoholG,
        caffeineMg: m.caffeineMg,
        nutritionSource: m.nutritionSource,
    };
}

test("mergedFoodFields: fills grams factors field by field", () => {
    const keep = sampleRow({
        gramsPerEach: 50,
        gramsPerMl: null,
    });
    const drop = sampleRow({
        gramsPerEach: 60,
        gramsPerMl: 1.03,
    });
    const m = mergedFoodFields(keep, drop);
    expect(m.gramsPerEach).toBe(50);
    expect(m.gramsPerMl).toBe(1.03);
});

test("mergedFoodFields: unions allergens with keep order first", () => {
    const keep = sampleRow({ allergens: ["milk"] });
    const drop = sampleRow({ allergens: ["egg", "milk"] });
    expect(mergedFoodFields(keep, drop).allergens).toEqual(["milk", "egg"]);
});

test("mergedFoodFields: offQuality keep wins and arrays prefer keep", () => {
    const fetchedKeep = "2026-11-08T00:00:00.000Z";
    const fetchedDrop = "2026-11-07T00:00:00.000Z";
    const keep = sampleRow({
        offQuality: {
            nutriscoreGrade: null,
            novaGroup: 2,
            ecoscoreGrade: "c",
            additives: [],
            allergensTags: ["en:gluten"],
            tracesTags: null,
            ingredientsAnalysisTags: null,
            labelsTags: null,
            fetchedAt: fetchedKeep,
        },
    });
    const drop = sampleRow({
        offQuality: {
            nutriscoreGrade: "e",
            novaGroup: 4,
            ecoscoreGrade: "f",
            additives: [{ tag: "en:e250", risk: "high" }],
            allergensTags: ["en:milk"],
            tracesTags: ["en:nuts"],
            ingredientsAnalysisTags: null,
            labelsTags: ["en:organic"],
            fetchedAt: fetchedDrop,
        },
    });
    const merged = mergedFoodFields(keep, drop);
    expect(merged.offQuality?.nutriscoreGrade).toBe("e");
    expect(merged.offQuality?.novaGroup).toBe(2);
    expect(merged.offQuality?.additives).toEqual([]);
    expect(merged.offQuality?.allergensTags).toEqual(["en:gluten"]);
    expect(merged.offQuality?.tracesTags).toEqual(["en:nuts"]);
    expect(merged.offQuality?.fetchedAt).toBe(fetchedKeep);
});

test("mergedFoodFields: replaces empty default unit only", () => {
    const keep = sampleRow({ defaultUnit: "   " });
    const drop = sampleRow({ defaultUnit: "g" });
    expect(mergedFoodFields(keep, drop).defaultUnit).toBe("g");
    const k2 = sampleRow({ defaultUnit: "each" });
    const d2 = sampleRow({ defaultUnit: "g" });
    expect(mergedFoodFields(k2, d2).defaultUnit).toBe("each");
});

test("mergeFoods on memory store: fills unknowns from drop", async () => {
    const store = createMemoryFoodsStore();
    const keep = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Plain",
            calories: null,
            proteinG: null,
            defaultUnit: "g",
            allergens: ["soy"],
        }),
    );
    const drop = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Rich",
            calories: 200,
            proteinG: 15,
            defaultUnit: "each",
            allergens: ["milk"],
        }),
    );
    const merged = await mergeFoods(store, HH, keep.id, drop.id);
    expect(merged.calories).toBe(200);
    expect(merged.proteinG).toBe(15);
    expect(merged.allergens).toEqual(["soy", "milk"]);
});

test("mergeFoods: rejected nesting leaves foods, fridge, stock, refs unchanged", async () => {
    const foods = createMemoryFoodsStore();
    const fridge = createMemoryFridgeStore();
    const stock = createMemoryStockStore();
    foods.linkRefs(fridge);
    foods.linkRefs(stock);

    const x = await findOrCreateManualFood(foods, HH, "food", "X nesting");
    const keep = await insertProduct(foods, x, {
        name: "Keep prod",
        normalizedName: "keep-prod-nest",
    });
    const drop = await findOrCreateManualFood(foods, HH, "food", "Drop nest");
    await insertProduct(foods, drop, {
        name: "Child",
        normalizedName: "child-nest",
    });
    const loc = await addLocation(fridge, HH, "L");
    await addFridgeItemAdjust(fridge, stock, foods, {
        householdId: HH,
        foodId: drop.id,
        amount: 10,
        unit: "g",
        locationId: loc.id,
    });
    const ref = foods.trackRef(drop.id);

    const snapshot = async () =>
        JSON.stringify({
            foodsList: await foods.listFoods(HH),
            fridgeItems: (await listFridge(fridge, HH)).items,
            movements: await stock.listMovements(HH),
            refs: foods.refs.map((r) => ({ ...r })),
        });

    const before = await snapshot();
    await expect(mergeFoods(foods, HH, keep.id, drop.id)).rejects.toThrow(
        /two deep/i,
    );
    expect(await snapshot()).toBe(before);
    expect(ref.foodId).toBe(drop.id);
});

test("mergeFoodPair carries merged offQuality", async () => {
    const store = createMemoryFoodsStore();
    const keep = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Keep qa" }),
    );
    const drop = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Drop qa",
            offQuality: {
                nutriscoreGrade: "c",
                novaGroup: 3,
                ecoscoreGrade: null,
                additives: [{ tag: "en:e250", risk: "high" }],
                allergensTags: null,
                tracesTags: null,
                ingredientsAnalysisTags: null,
                labelsTags: null,
                fetchedAt: "2026-11-07T00:00:00.000Z",
            },
        }),
    );
    const merged = await mergeFoodPair(store, HH, {
        keepId: keep.id,
        dropId: drop.id,
    });
    expect(merged.offQuality?.nutriscoreGrade).toBe("c");
    expect(merged.offQuality?.additives?.[0]?.tag).toBe("en:e250");
});

function sampleRow(over: Partial<Food>): Food {
    const now = "2026-01-01T00:00:00.000Z";
    return {
        id: "id",
        householdId: HH,
        kind: "food",
        name: "N",
        normalizedName: "n",
        brand: null,
        defaultUnit: "g",
        gramsPerEach: null,
        gramsPerMl: null,
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        allergens: [],
        offSourceId: null,
        genericFoodId: null,
        usualProductId: null,
        usualStoreId: null,
        usualAmount: null,
        offQuality: null,
        createdBy: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
        ...over,
    };
}

async function insertProduct(
    store: ReturnType<typeof createMemoryFoodsStore>,
    plain: Food,
    over: Partial<Food> & { name: string; normalizedName: string },
) {
    return store.insertFood(
        newFood({
            householdId: plain.householdId,
            kind: plain.kind,
            name: over.name,
            brand: over.brand,
            genericFoodId: plain.id,
            calories: over.calories,
            proteinG: over.proteinG,
            carbsG: over.carbsG,
            fatG: over.fatG,
            fiberG: over.fiberG,
            sugarG: over.sugarG,
            alcoholG: over.alcoholG,
            caffeineMg: over.caffeineMg,
            nutritionSource: over.nutritionSource,
            gramsPerEach: over.gramsPerEach,
            gramsPerMl: over.gramsPerMl,
            allergens: over.allergens,
        }),
    );
}
