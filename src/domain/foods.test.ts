import { test, expect } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    catalogNutritionFromOff,
    createMemoryFoodsStore,
    findFoodByNameAndBrand,
    findOrCreateFoodByBarcode,
    findOrCreateManualFood,
    findUpsertFoodByName,
    looseFoodKey,
    mapOffAllergenTags,
    matchFoodsByWords,
    mergeFoods,
    newFood,
    normalizeFoodName,
    searchFoodCatalog,
    updateFood,
    usualProductRows,
    gramsPerEachFromOff,
} from "./foods.js";

const HH = "hh-1";

function off(
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

test("normalizeFoodName trims, lowercases, and collapses spaces", () => {
    expect(normalizeFoodName("  Eggs  ")).toBe("eggs");
    expect(normalizeFoodName("chicken   thighs")).toBe("chicken thighs");
});

test("findFoodByNameAndBrand matches the full name and brand key", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Half and half" }),
    );
    const laura = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Half and half",
            brand: "Laura Lynn",
        }),
    );
    expect(
        await findFoodByNameAndBrand(store, HH, "food", "Half and half", null),
    ).toEqual(expect.objectContaining({ id: plain.id }));
    expect(
        await findFoodByNameAndBrand(
            store,
            HH,
            "food",
            "Half and half",
            "Laura Lynn",
        ),
    ).toEqual(expect.objectContaining({ id: laura.id }));
    expect(
        await findFoodByNameAndBrand(
            store,
            HH,
            "food",
            "Half and half",
            "Other",
        ),
    ).toBeNull();
});

test("manual Eggs / eggs / EGGS resolve to one food", async () => {
    const store = createMemoryFoodsStore();
    const a = await findOrCreateManualFood(store, HH, "food", "Eggs");
    const b = await findOrCreateManualFood(store, HH, "food", "eggs ");
    const c = await findOrCreateManualFood(store, HH, "food", "EGGS");
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    expect(await store.listFoods(HH)).toHaveLength(1);
});

test("find-or-create by alias reuses the food", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(store, HH, "food", "Eggs");
    await updateFood(store, HH, eggs.id, { aliases: ["oeufs"] });
    const again = await findOrCreateManualFood(store, HH, "food", "Oeufs");
    expect(again.id).toBe(eggs.id);
});

test("find-or-create by barcode looks up OFF then reuses the row", async () => {
    const store = createMemoryFoodsStore();
    const hit = off({
        name: "Good Culture Cottage Cheese",
        barcode: "070852010016",
        brand: "Good Culture",
    });
    const seen: string[] = [];
    const first = await findOrCreateFoodByBarcode(
        store,
        HH,
        "0708-5201 0016",
        async (barcode) => {
            seen.push(barcode);
            return hit;
        },
    );
    const second = await findOrCreateFoodByBarcode(
        store,
        HH,
        "070852010016",
        async () => {
            throw new Error("lookup should not run again");
        },
    );
    expect(seen).toEqual(["070852010016"]);
    expect(first.id).toBe(second.id);
    expect(first.name).toBe("Good Culture Cottage Cheese");
    expect(first.nutritionSource).toBe("openfoodfacts");
    expect(first.calories).toBe(98);
    expect(await store.getBarcodeFoodId(HH, "070852010016")).toBe(first.id);
});

test("unknown barcode is an error", async () => {
    const store = createMemoryFoodsStore();
    await expect(
        findOrCreateFoodByBarcode(store, HH, "070852010016", async () => null),
    ).rejects.toThrow(/unknown barcode/i);
});

test("merge moves barcodes, aliases, and tracked refs, then archives the drop", async () => {
    const store = createMemoryFoodsStore();
    const keep = await findOrCreateManualFood(store, HH, "food", "Eggs");
    const drop = await findOrCreateManualFood(store, HH, "food", "Large Eggs");
    await store.setBarcode(HH, "12345678", drop.id);
    await updateFood(store, HH, drop.id, { aliases: ["jumbo eggs"] });
    const ref = store.trackRef(drop.id);
    const merged = await mergeFoods(store, HH, keep.id, drop.id);
    expect(merged.id).toBe(keep.id);
    expect(await store.getBarcodeFoodId(HH, "12345678")).toBe(keep.id);
    expect(await store.listAliases(HH, keep.id)).toEqual(
        expect.arrayContaining(["jumbo eggs", "large eggs"]),
    );
    expect(ref.foodId).toBe(keep.id);
    expect((await store.getFood(HH, drop.id))?.archivedAt).not.toBeNull();
    expect(await store.listFoods(HH)).toHaveLength(1);
});

test("listAllAliases groups a household in listAliases order", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(store, HH, "food", "Eggs");
    const milk = await findOrCreateManualFood(store, HH, "food", "Milk");
    await store.setAlias(HH, "large eggs", eggs.id);
    await store.setAlias(HH, "dairy", milk.id);
    await store.setAlias(HH, "jumbo eggs", eggs.id);
    await store.setAlias("other-household", "nope", eggs.id);
    const grouped = await store.listAllAliases(HH);
    expect(grouped.get(eggs.id)).toEqual(["jumbo eggs", "large eggs"]);
    expect(grouped.get(milk.id)).toEqual(["dairy"]);
    expect(grouped.has("missing")).toBe(false);
    expect(await store.listAliases(HH, eggs.id)).toEqual([
        "jumbo eggs",
        "large eggs",
    ]);
});

test("mapOffAllergenTags maps en: tags onto NAMED_ALLERGENS", () => {
    expect(
        mapOffAllergenTags(["en:milk", "en:peanuts", "en:sesame-seeds"]),
    ).toEqual(["milk", "peanut", "sesame"]);
});

test("catalogNutritionFromOff keeps 100 g figures and refuses a serving basis", () => {
    expect(
        catalogNutritionFromOff(
            off({
                name: "Cottage",
                barcode: "070852010016",
                serving: "100 g",
                calories: 98,
            }),
        ).calories,
    ).toBe(98);
    expect(
        catalogNutritionFromOff(
            off({
                name: "Yogurt",
                barcode: "11111111",
                serving: "150 g",
                calories: 140,
            }),
        ).calories,
    ).toBeNull();
});

test("search ranks household foods ahead of OFF hits", async () => {
    const store = createMemoryFoodsStore();
    await findOrCreateManualFood(store, HH, "food", "Cottage leftovers");
    const hits = await searchFoodCatalog(store, HH, "cottage", [
        off({
            name: "Good Culture Cottage Cheese",
            barcode: "070852010016",
        }),
    ]);
    expect(hits[0]?.source).toBe("household");
    expect(hits[0]?.food_id).toBeTruthy();
    expect(hits[1]?.barcode).toBe("070852010016");
    expect(hits[1]?.food_id).toBeNull();
});

test("memory backfill groups barcode and manual names the way the SQL does", async () => {
    const store = createMemoryFoodsStore();
    const barcode = "070852010016";
    const lookup = async () =>
        off({ name: "Cottage Cheese", barcode, serving: "100 g" });
    const fromFridge = await findOrCreateFoodByBarcode(
        store,
        HH,
        barcode,
        lookup,
    );
    const fromRecipe = await findOrCreateFoodByBarcode(
        store,
        HH,
        barcode,
        lookup,
    );
    const eggsA = await findOrCreateManualFood(store, HH, "food", "Eggs");
    const eggsB = await findOrCreateManualFood(store, HH, "food", " eggs");
    expect(fromFridge.id).toBe(fromRecipe.id);
    expect(eggsA.id).toBe(eggsB.id);
    const foods = await store.listFoods(HH);
    expect(foods).toHaveLength(2);
    expect(foods.some((row) => row.offSourceId === barcode)).toBe(true);
});

test("gramsPerEachFromOff prefills when the serving is a count", () => {
    expect(
        gramsPerEachFromOff({
            serving: "1 egg (50 g)",
            serving_quantity: 50,
            serving_quantity_unit: "g",
        }),
    ).toBe(50);
    expect(
        gramsPerEachFromOff({
            serving: "1 cookie (30 g)",
            serving_quantity: 1,
            serving_quantity_unit: "each",
        }),
    ).toBe(30);
    expect(
        gramsPerEachFromOff({
            serving: "100 g",
            serving_quantity: 100,
            serving_quantity_unit: "g",
        }),
    ).toBeNull();
});

test("matchFoodsByWords ranks whole-word matches ahead of prefix matches", () => {
    const named = (name: string) =>
        newFood({ householdId: HH, kind: "food", name });
    const catalog = [
        "Eggplant",
        "Duck eggs",
        "Kirkland Large Eggs",
        "Milkshake",
        "Whole milk",
        "Hamburger",
        "Black forest ham",
    ].map(named);
    const names = (query: string) =>
        matchFoodsByWords(query, catalog, new Map()).map((f) => f.name);
    expect(names("eggs")).toEqual([
        "Duck eggs",
        "Kirkland Large Eggs",
        "Eggplant",
    ]);
    expect(names("milk")).toEqual(["Whole milk", "Milkshake"]);
    expect(names("ham")).toEqual(["Black forest ham", "Hamburger"]);
});

test("matchFoodsByWords finds foods by tokens across name, brand, and aliases", () => {
    const half = newFood({
        householdId: HH,
        kind: "food",
        name: "Half & Half",
        brand: "Members Mark",
    });
    const eggs = newFood({ householdId: HH, kind: "food", name: "Eggs" });
    const largeEggs = newFood({
        householdId: HH,
        kind: "food",
        name: "Kirkland Large Eggs",
    });
    const flourA = newFood({
        householdId: HH,
        kind: "food",
        name: "All purpose flour",
    });
    const flourB = newFood({
        householdId: HH,
        kind: "food",
        name: "all-purpose flour",
    });
    const aliasFood = newFood({
        householdId: HH,
        kind: "food",
        name: "Cream",
    });
    const foods = [half, eggs, largeEggs, flourA, flourB, aliasFood];
    const aliases = new Map<string, string[]>([
        [aliasFood.id, ["half and half cream"]],
    ]);

    const markHits = matchFoodsByWords(
        "Member's Mark half and half",
        foods,
        aliases,
    );
    expect(markHits[0]?.id).toBe(half.id);

    const prefixHits = matchFoodsByWords("half and ha", foods, aliases);
    expect(prefixHits.some((row) => row.id === half.id)).toBe(true);

    const eggHits = matchFoodsByWords("eggs", foods, aliases);
    expect(eggHits[0]?.id).toBe(eggs.id);

    const flourHits = matchFoodsByWords("all purpose", foods, aliases);
    expect(flourHits.map((row) => row.id).sort()).toEqual(
        [flourA.id, flourB.id].sort(),
    );

    expect(
        matchFoodsByWords("half and half cream", foods, aliases).some(
            (row) => row.id === aliasFood.id,
        ),
    ).toBe(true);

    expect(matchFoodsByWords("zzzznotfound", foods, aliases)).toEqual([]);
    expect(matchFoodsByWords("", foods, aliases)).toEqual([]);
    expect(matchFoodsByWords("   ", foods, aliases)).toEqual([]);
});

test("looseFoodKey resolves punctuation variants without merging egg and eggs", async () => {
    const store = createMemoryFoodsStore();
    const flour = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "All purpose flour" }),
    );
    const half = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Half & Half",
            brand: "Store",
        }),
    );
    await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "egg" }),
    );

    const hyphenFlour = await findOrCreateManualFood(
        store,
        HH,
        "food",
        "all-purpose flour",
    );
    expect(hyphenFlour.id).toBe(flour.id);
    expect(
        (await store.listFoods(HH)).filter((f) => !f.genericFoodId),
    ).toHaveLength(3);

    const looseHalf = await findOrCreateManualFood(
        store,
        HH,
        "food",
        "half and half",
    );
    expect(looseHalf.id).toBe(half.id);

    const eggs = await findOrCreateManualFood(store, HH, "food", "eggs");
    expect(eggs.name).toBe("eggs");
    expect(looseFoodKey("egg")).not.toBe(looseFoodKey("eggs"));

    const supply = await store.insertFood(
        newFood({ householdId: HH, kind: "supply", name: "Foil" }),
    );
    const foodFoil = await findOrCreateManualFood(store, HH, "food", "foil");
    expect(foodFoil.id).not.toBe(supply.id);
});

test("findUpsertFoodByName loose match respects brand rules", async () => {
    const store = createMemoryFoodsStore();
    await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Half & Half",
            brand: "Members Mark",
        }),
    );
    const withoutBrand = await findUpsertFoodByName(
        store,
        HH,
        "food",
        "half and half",
        null,
    );
    expect(withoutBrand.kind).toBe("create");

    const withBrand = await findUpsertFoodByName(
        store,
        HH,
        "food",
        "half and half",
        "Members Mark",
    );
    expect(withBrand.kind).toBe("existing");
});

test("usualProductRows excludes barcoded and off-linked plain foods from addable", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
    const scanned = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Cage Free Grade A Large Eggs",
            offSourceId: "070852010016",
        }),
    );
    const barcoded = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Milk" }),
    );
    await store.setBarcode(HH, "1234567890123", barcoded.id);
    await productRow(store, plain.id, "Kirkland Large Eggs");

    const barcodedIds = await store.listBarcodedFoodIds(HH);
    expect(barcodedIds.has(barcoded.id)).toBe(true);

    const { addable } = usualProductRows({
        foods: await store.listFoods(HH),
        barcodedFoodIds: barcodedIds,
    });
    expect(addable.map((row) => row.name)).toEqual([]);
    expect(addable.some((row) => row.id === scanned.id)).toBe(false);
    expect(addable.some((row) => row.id === barcoded.id)).toBe(false);
});

async function productRow(
    store: ReturnType<typeof createMemoryFoodsStore>,
    plainId: string,
    name: string,
) {
    return store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name,
            genericFoodId: plainId,
            calories: 100,
            nutritionSource: "manual",
        }),
    );
}

test("searchFoodCatalog household hits use word matching", async () => {
    const store = createMemoryFoodsStore();
    await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Half & Half",
            brand: "Members Mark",
        }),
    );
    const hits = await searchFoodCatalog(
        store,
        HH,
        "Member's Mark half and half",
        [],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.name).toBe("Half & Half");
    expect(hits[0]?.brand).toBe("Members Mark");
});

test("updateFood writes default_unit and gram factors", async () => {
    const store = createMemoryFoodsStore();
    const eggs = await findOrCreateManualFood(store, HH, "food", "Eggs");
    const saved = await updateFood(store, HH, eggs.id, {
        defaultUnit: "each",
        gramsPerEach: 50,
        gramsPerMl: null,
    });
    expect(saved.defaultUnit).toBe("each");
    expect(saved.gramsPerEach).toBe(50);
    expect(saved.gramsPerMl).toBeNull();
});
