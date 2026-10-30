import { test, expect } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    catalogNutritionFromOff,
    createMemoryFoodsStore,
    findOrCreateFoodByBarcode,
    findOrCreateManualFood,
    mapOffAllergenTags,
    mergeFoods,
    normalizeFoodName,
    searchFoodCatalog,
    updateFood,
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
    expect(grouped.get(eggs.id)).toEqual(["large eggs", "jumbo eggs"]);
    expect(grouped.get(milk.id)).toEqual(["dairy"]);
    expect(grouped.has("missing")).toBe(false);
    expect(await store.listAliases(HH, eggs.id)).toEqual([
        "large eggs",
        "jumbo eggs",
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
