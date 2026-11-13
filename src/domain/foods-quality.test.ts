import { expect, test } from "bun:test";
import type { FoodResult } from "../foods.js";
import {
    applyHitQualityToFood,
    createMemoryFoodsStore,
    findOrCreateFoodByBarcodeResult,
    foodQualityFromHit,
    newFood,
    refreshFoodQualityByBarcode,
    type FoodQuality,
} from "./foods.js";

const HH = "hh-quality";
const BARCODE = "3017624010701";
const FETCHED = "2026-11-07T12:00:00.000Z";

function hitWithQuality(
    overrides: Partial<NonNullable<FoodResult["quality"]>> = {},
): FoodResult {
    return {
        name: "Nutella",
        brand: "Ferrero",
        serving: "100 g",
        calories: 539,
        protein_g: 6.3,
        carbs_g: 57.5,
        fat_g: 30.9,
        fiber_g: null,
        sugar_g: 56.3,
        alcohol_g: null,
        nutriscore_grade: "e",
        nova_group: 4,
        source: `off:${BARCODE}`,
        source_name: "openfoodfacts",
        barcode: BARCODE,
        quality: {
            nutriscore_grade: "e",
            nova_group: 4,
            ecoscore_grade: "d",
            additives_tags: ["en:e322"],
            allergens_tags: ["en:nuts"],
            traces_tags: ["en:milk"],
            ingredients_analysis_tags: null,
            labels_tags: [],
            fetched_at: FETCHED,
            ...overrides,
        },
    };
}

test("foodQualityFromHit returns null without quality", () => {
    const hit = hitWithQuality();
    delete hit.quality;
    expect(foodQualityFromHit(hit)).toBeNull();
});

test("created-from-hit carries offQuality", async () => {
    const store = createMemoryFoodsStore();
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => hitWithQuality(),
    );
    expect(created).toBe(true);
    expect(food.offQuality?.nutriscoreGrade).toBe("e");
    expect(food.offQuality?.additives?.[0]?.tag).toBe("en:e322");
});

test("existing barcode with null offQuality refetches once", async () => {
    const store = createMemoryFoodsStore();
    const base = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Nutella",
            brand: "Ferrero",
        }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    let lookups = 0;
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => {
            lookups++;
            return hitWithQuality();
        },
    );
    expect(created).toBe(false);
    expect(lookups).toBe(1);
    expect(food.offQuality?.nutriscoreGrade).toBe("e");
});

test("existing with offQuality and OFF nutrition filled does not call lookup", async () => {
    const store = createMemoryFoodsStore();
    const q: FoodQuality = {
        nutriscoreGrade: "c",
        novaGroup: 3,
        ecoscoreGrade: null,
        additives: null,
        allergensTags: null,
        tracesTags: null,
        ingredientsAnalysisTags: null,
        labelsTags: null,
        fetchedAt: FETCHED,
    };
    const base = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Nutella",
            offQuality: q,
            saturatedFatG: 1.0,
            offNutrientLevels: { sugars: "low" },
            serving: { label: "15 g", amount: 15, unit: "g" },
        }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    let lookups = 0;
    await findOrCreateFoodByBarcodeResult(store, HH, BARCODE, async () => {
        lookups++;
        return hitWithQuality();
    });
    expect(lookups).toBe(0);
});

test("existing with quality but null OFF nutrition refetches once", async () => {
    const store = createMemoryFoodsStore();
    const q: FoodQuality = {
        nutriscoreGrade: "c",
        novaGroup: 3,
        ecoscoreGrade: null,
        additives: null,
        allergensTags: null,
        tracesTags: null,
        ingredientsAnalysisTags: null,
        labelsTags: null,
        fetchedAt: FETCHED,
    };
    const base = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Nutella",
            offQuality: q,
            saturatedFatG: null,
            offNutrientLevels: null,
        }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    let lookups = 0;
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => {
            lookups++;
            return {
                ...hitWithQuality(),
                saturated_fat_g: 2.5,
                nutrient_levels: {
                    sugars: "low",
                    "saturated-fat": "moderate",
                },
            };
        },
    );
    expect(created).toBe(false);
    expect(lookups).toBe(1);
    expect(food.saturatedFatG).toBe(2.5);
    expect(food.offNutrientLevels?.sugars).toBe("low");
});

test("confirmed miss stamps all-null quality and skips later lookups", async () => {
    const store = createMemoryFoodsStore();
    const base = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    let lookups = 0;
    const miss = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => {
            lookups++;
            return null;
        },
    );
    expect(lookups).toBe(1);
    expect(miss.food.offQuality?.nutriscoreGrade).toBeNull();
    expect(miss.food.offQuality?.additives).toBeNull();
    expect(miss.food.offQuality?.labelsTags).toBeNull();
    expect(miss.food.offQuality?.fetchedAt).toBeTruthy();
    await findOrCreateFoodByBarcodeResult(store, HH, BARCODE, async () => {
        lookups++;
        return hitWithQuality();
    });
    expect(lookups).toBe(1);
});

test("miss stamp never replaces quality written while the lookup ran", async () => {
    const store = createMemoryFoodsStore();
    const base = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    // lookup_barcode lands real data (older fetchedAt than the stamp would
    // carry) while this scan's own lookup is still in flight, then misses.
    const result = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => {
            await refreshFoodQualityByBarcode(
                store,
                HH,
                BARCODE,
                hitWithQuality(),
            );
            return null;
        },
    );
    expect(result.food.offQuality?.nutriscoreGrade).toBe("e");
    expect(result.food.offQuality?.fetchedAt).toBe(FETCHED);
    const saved = await store.getFood(HH, base.id);
    expect(saved?.offQuality?.nutriscoreGrade).toBe("e");
});

test("lookup throw on existing does not stamp and retries next scan", async () => {
    const store = createMemoryFoodsStore();
    const base = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    let lookups = 0;
    const thrown = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => {
            lookups++;
            throw new Error("off down");
        },
    );
    expect(thrown.food.offQuality).toBeNull();
    await findOrCreateFoodByBarcodeResult(store, HH, BARCODE, async () => {
        lookups++;
        throw new Error("off down");
    });
    expect(lookups).toBe(2);
});

test("new barcode with throwing lookup surfaces FoodsInputError", async () => {
    const store = createMemoryFoodsStore();
    await expect(
        findOrCreateFoodByBarcodeResult(store, HH, BARCODE, async () => {
            throw new Error("off down");
        }),
    ).rejects.toMatchObject({
        message: expect.stringMatching(/Couldn't reach Open Food Facts/i),
        code: "foods_input",
    });
});

test("new barcode with null still throws Unknown barcode", async () => {
    const store = createMemoryFoodsStore();
    await expect(
        findOrCreateFoodByBarcodeResult(store, HH, BARCODE, async () => null),
    ).rejects.toThrow(/unknown barcode/i);
});

test("setFoodQuality keeps concurrent rename", async () => {
    const store = createMemoryFoodsStore();
    const base = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Before rename",
            calories: 50,
        }),
    );
    await store.setBarcode(HH, BARCODE, base.id);
    const stale = (await store.getFood(HH, base.id))!;
    await store.updateFoodRow({
        ...stale,
        name: "After rename",
        normalizedName: "after rename",
        updatedAt: new Date().toISOString(),
    });
    await applyHitQualityToFood(store, stale, hitWithQuality());
    const current = await store.getFood(HH, base.id);
    expect(current?.name).toBe("After rename");
    expect(current?.calories).toBe(50);
    expect(current?.offQuality?.nutriscoreGrade).toBe("e");
});

test("setFoodQuality does not write archived food", async () => {
    const store = createMemoryFoodsStore();
    const stamp = "2026-11-09T12:00:00.000Z";
    const base = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    const archived = await store.updateFoodRow({
        ...base,
        archivedAt: stamp,
        updatedAt: stamp,
    });
    expect(archived).not.toBeNull();
    const q: FoodQuality = {
        nutriscoreGrade: "b",
        novaGroup: 2,
        ecoscoreGrade: null,
        additives: null,
        allergensTags: null,
        tracesTags: null,
        ingredientsAnalysisTags: null,
        labelsTags: null,
        fetchedAt: stamp,
    };
    const out = await store.setFoodQuality(HH, base.id, q);
    expect(out).toBeNull();
    const row = await store.getFood(HH, base.id);
    expect(row?.offQuality).toBeNull();
});

test("setFoodQuality rejects older fetchedAt", async () => {
    const store = createMemoryFoodsStore();
    const newer = "2026-11-08T12:00:00.000Z";
    const food = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Nutella",
            offQuality: {
                nutriscoreGrade: "a",
                novaGroup: 1,
                ecoscoreGrade: null,
                additives: null,
                allergensTags: null,
                tracesTags: null,
                ingredientsAnalysisTags: null,
                labelsTags: null,
                fetchedAt: newer,
            },
        }),
    );
    const out = await store.setFoodQuality(HH, food.id, {
        nutriscoreGrade: "e",
        novaGroup: 4,
        ecoscoreGrade: null,
        additives: null,
        allergensTags: null,
        tracesTags: null,
        ingredientsAnalysisTags: null,
        labelsTags: null,
        fetchedAt: FETCHED,
    });
    expect(out).toBeNull();
    const same = await store.getFood(HH, food.id);
    expect(same?.offQuality?.nutriscoreGrade).toBe("a");
    expect(same?.offQuality?.fetchedAt).toBe(newer);
});

test("older hit does not overwrite newer stored data", async () => {
    const store = createMemoryFoodsStore();
    const newer = "2026-11-08T12:00:00.000Z";
    const food = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Nutella",
            offQuality: {
                nutriscoreGrade: "a",
                novaGroup: 1,
                ecoscoreGrade: null,
                additives: null,
                allergensTags: null,
                tracesTags: null,
                ingredientsAnalysisTags: null,
                labelsTags: null,
                fetchedAt: newer,
            },
        }),
    );
    const olderHit = hitWithQuality({ fetched_at: FETCHED });
    const same = await applyHitQualityToFood(store, food, olderHit);
    expect(same.offQuality?.nutriscoreGrade).toBe("a");
    expect(same.offQuality?.fetchedAt).toBe(newer);
});

test("hit without quality writes nothing", async () => {
    const store = createMemoryFoodsStore();
    const food = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    const hit = hitWithQuality();
    delete hit.quality;
    const same = await applyHitQualityToFood(store, food, hit);
    expect(same.offQuality).toBeNull();
});

test("refreshFoodQualityByBarcode never creates", async () => {
    const store = createMemoryFoodsStore();
    const before = (await store.listFoods(HH)).length;
    const out = await refreshFoodQualityByBarcode(
        store,
        HH,
        BARCODE,
        hitWithQuality(),
    );
    expect(out).toBeNull();
    expect((await store.listFoods(HH)).length).toBe(before);
});

test("nameMatch: false makes a product row instead of merging into a food of the same name", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => hitWithQuality(),
        { nameMatch: false },
    );
    expect(created).toBe(true);
    expect(food.id).not.toBe(plain.id);
    expect(food).toMatchObject({ brand: "Ferrero", offSourceId: BARCODE });
    expect(await store.getBarcodeFoodId(HH, BARCODE)).toBe(food.id);
    expect((await store.getFood(HH, plain.id))?.offSourceId).toBeNull();
});

test("by default a scanned product still merges into a food of the same name", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => hitWithQuality(),
    );
    expect(created).toBe(false);
    expect(food.id).toBe(plain.id);
});

test("nameMatch: false reuses the row of the same name and brand for another pack size", async () => {
    const store = createMemoryFoodsStore();
    const first = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => hitWithQuality(),
        { nameMatch: false },
    );
    const second = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        "3017620422003",
        async () => hitWithQuality(),
        { nameMatch: false },
    );
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.food.id).toBe(first.food.id);
    expect(await store.getBarcodeFoodId(HH, "3017620422003")).toBe(
        first.food.id,
    );
    expect(await store.getBarcodeFoodId(HH, BARCODE)).toBe(first.food.id);
});

test("nameMatch: false matches an unbranded hit named like a food by name", async () => {
    const store = createMemoryFoodsStore();
    const plain = await store.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Nutella" }),
    );
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => ({ ...hitWithQuality(), brand: null }),
        { nameMatch: false },
    );
    expect(created).toBe(false);
    expect(food.id).toBe(plain.id);
});

test("nameMatch: false still reuses a household barcode and an OFF source id", async () => {
    const store = createMemoryFoodsStore();
    const known = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Spread",
            offSourceId: BARCODE,
        }),
    );
    const { food, created } = await findOrCreateFoodByBarcodeResult(
        store,
        HH,
        BARCODE,
        async () => hitWithQuality(),
        { nameMatch: false },
    );
    expect(created).toBe(false);
    expect(food.id).toBe(known.id);
});
