import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fetchProductFromOFF, type FoodResult } from "../foods.js";
import { formatLogMacroKcal } from "./log-macro-format.js";
import { buildMealFromItems } from "./meals.js";
import {
    catalogNutritionFromOff,
    createMemoryFoodsStore,
    findOrCreateFoodByBarcodeFromHit,
    findOrCreateFoodByBarcodeResult,
    gramsPerEachFromOff,
    type FoodQuality,
    mergeFoods,
    newFood,
    offNutritionPatchFromHit,
    offQualityMissStamp,
    perServingFromFood,
    refreshFoodQualityByBarcode,
    servingFromOff,
    updateFood,
} from "./foods.js";
import { productNutrition } from "../web/pages/v2/product-nutrition.js";

// The Open Food Facts record for Members Mark Half & Half (barcode
// 0193968379117), trimmed to the keys the mapper reads.
const realFetch = globalThis.fetch;

const HALF_AND_HALF_OFF = {
    status: 1,
    product: {
        product_name: "Half & Half",
        brands: "Members Mark",
        serving_size: "1 portion (30 ml)",
        serving_quantity: 30,
        serving_quantity_unit: "ml",
        nutrition_data_per: "100ml",
        nutriments: {
            "energy-kcal_100g": 133.33,
            "energy-kcal_serving": 40,
            proteins_100g: 3.33,
            proteins_serving: 1,
            carbohydrates_100g: 3.33,
            carbohydrates_serving: 1,
            sugars_100g: 3.33,
            sugars_serving: 1,
            fat_100g: 10,
            fat_serving: 3,
            "saturated-fat_100g": 6.67,
            "saturated-fat_serving": 2,
        },
    },
};

function mockFetch(body: unknown) {
    globalThis.fetch = mock(() =>
        Promise.resolve(
            new Response(JSON.stringify(body), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            }),
        ),
    ) as unknown as typeof fetch;
}

beforeEach(() => {
    process.env.OFF_USER_AGENT = "foodable-test (test@example.com)";
});
afterEach(() => {
    globalThis.fetch = realFetch;
});

describe("OFF per-100 basis and pack serving", () => {
    test("Half & Half keeps per-100 ml values beside the per-serving ones", async () => {
        mockFetch(HALF_AND_HALF_OFF);
        const food = await fetchProductFromOFF("0193968379117");
        expect(food?.nutrition_basis).toBe("100ml");
        // One decimal like every other OFF value: the edit form's inputs step
        // by 0.1 and refuse a second decimal.
        expect(food?.per_100?.calories).toBe(133.3);
        expect(food?.per_100?.fat_g).toBe(10);
        expect(food?.per_100?.saturated_fat_g).toBe(6.7);
        expect(food?.per_100?.alcohol_g).toBeNull();
        expect(food?.serving_size).toBe("1 portion (30 ml)");
        // The top-level fields keep their per-serving meaning.
        expect(food?.calories).toBe(40);
        expect(food?.serving).toBe("1 portion (30 ml)");
    });

    test("a product with no serving is per 100 g with the same values", async () => {
        mockFetch({
            status: 1,
            product: {
                product_name: "Oats",
                nutriments: { "energy-kcal_100g": 372, proteins_100g: 13 },
            },
        });
        const food = await fetchProductFromOFF("12345678");
        expect(food?.nutrition_basis).toBe("100g");
        expect(food?.per_100?.calories).toBe(372);
        expect(food?.per_100?.carbs_g).toBeNull();
        expect(food?.serving_size).toBeNull();
    });

    test("a negative per-100 saturated fat from OFF is kept as given here", async () => {
        mockFetch({
            status: 1,
            product: {
                product_name: "Odd",
                nutriments: {
                    "energy-kcal_100g": 100,
                    "saturated-fat_100g": -1,
                },
            },
        });
        const food = await fetchProductFromOFF("12345678");
        expect(food?.per_100?.saturated_fat_g).toBe(-1);
    });
});

const HH = "hh-serving";

const NO_PER_100 = {
    calories: null,
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    fiber_g: null,
    sugar_g: null,
    saturated_fat_g: null,
    alcohol_g: null,
};

function hit(over: Partial<FoodResult> = {}): FoodResult {
    return {
        name: "Half & Half",
        brand: "Members Mark",
        serving: "1 portion (30 ml)",
        serving_size: "1 portion (30 ml)",
        serving_quantity: 30,
        serving_quantity_unit: "ml",
        calories: 40,
        protein_g: 1,
        carbs_g: 1,
        fat_g: 3,
        fiber_g: null,
        sugar_g: 1,
        saturated_fat_g: 2,
        alcohol_g: null,
        nutriscore_grade: null,
        nova_group: null,
        nutrition_basis: "100ml",
        per_100: {
            calories: 133.3,
            protein_g: 3.3,
            carbs_g: 3.3,
            fat_g: 10,
            fiber_g: null,
            sugar_g: 3.3,
            saturated_fat_g: 6.7,
            alcohol_g: null,
        },
        source: "off:0193968379117",
        source_name: "openfoodfacts",
        barcode: "0193968379117",
        ...over,
    };
}

function cookies(): FoodResult {
    return hit({
        name: "Cookies",
        serving: "2 cookies (30 g)",
        serving_size: "2 cookies (30 g)",
        serving_quantity: 30,
        serving_quantity_unit: "g",
        nutrition_basis: "100g",
        per_100: { ...NO_PER_100, calories: 480 },
        barcode: "99999999",
        source: "off:99999999",
    });
}

describe("servingFromOff", () => {
    test("keeps the pack label, the amount and the ml unit", () => {
        expect(servingFromOff(hit())).toEqual({
            label: "1 portion (30 ml)",
            amount: 30,
            unit: "ml",
        });
    });

    test("normalises gram spellings", () => {
        for (const unit of ["g", "gr", "gram", "Grams"]) {
            expect(
                servingFromOff(hit({ serving_quantity_unit: unit }))?.unit,
            ).toBe("g");
        }
        expect(servingFromOff(hit({ serving_quantity_unit: "mL" }))?.unit).toBe(
            "ml",
        );
    });

    test("no serving: missing label, bad amount or other unit give null", () => {
        expect(servingFromOff(hit({ serving_size: null }))).toBeNull();
        expect(servingFromOff(hit({ serving_size: "  " }))).toBeNull();
        expect(servingFromOff(hit({ serving_quantity: 0 }))).toBeNull();
        expect(servingFromOff(hit({ serving_quantity: null }))).toBeNull();
        expect(servingFromOff(hit({ serving_quantity: -5 }))).toBeNull();
        expect(servingFromOff(hit({ serving_quantity_unit: "oz" }))).toBeNull();
        expect(servingFromOff(hit({ serving_quantity_unit: null }))).toBeNull();
    });

    test("a payload from before the pack label was kept has no serving", () => {
        const old = hit();
        delete old.serving_size;
        expect(servingFromOff(old)).toBeNull();
    });
});

describe("catalogNutritionFromOff", () => {
    test("a per-serving hit returns its per-100 values", () => {
        const n = catalogNutritionFromOff(hit());
        expect(n.calories).toBe(133.3);
        expect(n.fatG).toBe(10);
        expect(n.saturatedFatG).toBe(6.7);
    });

    test("a negative per-100 saturated fat is dropped", () => {
        const h = hit();
        h.per_100 = { ...h.per_100!, saturated_fat_g: -1 };
        expect(catalogNutritionFromOff(h).saturatedFatG).toBeNull();
    });

    test("without per_100 it is the old behaviour", () => {
        const base = hit();
        delete base.per_100;
        expect(catalogNutritionFromOff(base).calories).toBeNull();
        const per100g = { ...base, serving: "100 g", calories: 372 };
        expect(catalogNutritionFromOff(per100g).calories).toBe(372);
    });
});

describe("creating a food from an OFF hit", () => {
    test("Half & Half stores 100 ml nutrition and a 30 ml serving", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.calories).toBe(133.3);
        expect(food.serving).toEqual({
            label: "1 portion (30 ml)",
            amount: 30,
            unit: "ml",
        });
        expect(food.nutritionBasis).toBe("100ml");
        expect(food.gramsPerEach).toBeNull();
        expect(food.gramsPerMl).toBeNull();
        // 133.3 kcal per 100 ml over a 30 ml serving: 39.99, shown as 40.
        const perServing = perServingFromFood(food);
        expect(perServing?.calories).toBe(39.99);
        expect(formatLogMacroKcal(perServing?.calories ?? null)).toBe("40");
    });

    test("a count serving still sets grams per each and keeps its serving", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "99999999",
            async () => cookies(),
        );
        expect(food.gramsPerEach).toBe(15);
        expect(gramsPerEachFromOff(cookies())).toBe(15);
        expect(food.serving).toEqual({
            label: "2 cookies (30 g)",
            amount: 30,
            unit: "g",
        });
        expect(food.nutritionBasis).toBe("100g");
    });

    test("a hit with no serving stores serving null", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit({ serving_size: null, serving_quantity: null }),
        );
        expect(food.serving).toBeNull();
        expect(perServingFromFood(food)).toBeNull();
    });
});

describe("perServingFromFood", () => {
    test("g serving on a 100 g basis scales by amount / 100", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Cookies",
            calories: 480,
            fatG: 20,
            serving: { label: "2 cookies (30 g)", amount: 30, unit: "g" },
            nutritionBasis: "100g",
        });
        const s = perServingFromFood(food);
        expect(s?.calories).toBe(144);
        expect(s?.fatG).toBe(6);
        expect(s?.proteinG).toBeNull();
    });

    test("a null basis reads as per 100 g", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Oats",
            calories: 400,
            serving: { label: "40 g", amount: 40, unit: "g" },
        });
        expect(perServingFromFood(food)?.calories).toBe(160);
    });

    test("an ml serving on a 100 g basis derives nothing: no density guess", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Milk",
            calories: 60,
            serving: { label: "250 ml", amount: 250, unit: "ml" },
            nutritionBasis: "100g",
        });
        expect(perServingFromFood(food)).toBeNull();
    });

    test("a g serving on a 100 ml basis derives nothing", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Syrup",
            calories: 300,
            serving: { label: "30 g", amount: 30, unit: "g" },
            nutritionBasis: "100ml",
        });
        expect(perServingFromFood(food)).toBeNull();
    });

    test("no serving gives null", () => {
        const food = newFood({
            householdId: HH,
            kind: "food",
            name: "Rice",
            calories: 130,
        });
        expect(perServingFromFood(food)).toBeNull();
    });
});

describe("refresh from an OFF hit", () => {
    test("fills null serving, basis and macros on an existing barcode food", async () => {
        const store = createMemoryFoodsStore();
        const existing = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                offSourceId: "0193968379117",
                nutritionSource: "openfoodfacts",
            }),
        );
        await store.setBarcode(HH, "0193968379117", existing.id);
        const { food, created } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(created).toBe(false);
        expect(food.id).toBe(existing.id);
        expect(food.serving?.amount).toBe(30);
        expect(food.nutritionBasis).toBe("100ml");
        expect(food.calories).toBe(133.3);
        expect(food.fatG).toBe(10);
        expect(food.saturatedFatG).toBe(6.7);
    });

    test("never overwrites a non-null value", async () => {
        const store = createMemoryFoodsStore();
        const existing = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                offSourceId: "0193968379117",
                calories: 120,
                proteinG: 0,
                serving: { label: "1 tbsp (15 g)", amount: 15, unit: "g" },
                nutritionBasis: "100ml",
                nutritionSource: "openfoodfacts",
            }),
        );
        expect(offNutritionPatchFromHit(existing, hit())).not.toHaveProperty(
            "serving",
        );
        await store.setBarcode(HH, "0193968379117", existing.id);
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.calories).toBe(120);
        expect(food.proteinG).toBe(0);
        expect(food.serving).toEqual({
            label: "1 tbsp (15 g)",
            amount: 15,
            unit: "g",
        });
        expect(food.nutritionBasis).toBe("100ml");
        // The null columns still fill.
        expect(food.fatG).toBe(10);
    });

    test("does not mix a different basis into the stored numbers", async () => {
        const store = createMemoryFoodsStore();
        const existing = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                offSourceId: "0193968379117",
                calories: 120,
                nutritionBasis: "100g",
            }),
        );
        await store.setBarcode(HH, "0193968379117", existing.id);
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.fatG).toBeNull();
        expect(food.nutritionBasis).toBe("100g");
        // The serving does not depend on the basis.
        expect(food.serving?.unit).toBe("ml");
    });

    test("typed-in nutrition with no basis is not relabelled per 100 ml", async () => {
        const store = createMemoryFoodsStore();
        const existing = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                offSourceId: "0193968379117",
                calories: 120,
                nutritionSource: "manual",
            }),
        );
        await store.setBarcode(HH, "0193968379117", existing.id);
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.nutritionBasis).toBeNull();
        expect(food.fatG).toBeNull();
        expect(food.calories).toBe(120);
    });

    test("a manual food with only protein typed is not relabelled or filled", () => {
        const cream = newFood({
            householdId: HH,
            kind: "food",
            name: "Cream",
            proteinG: 3,
            nutritionSource: "manual",
        });
        const patch = offNutritionPatchFromHit(cream, hit());
        expect(patch?.nutritionBasis).toBeUndefined();
        expect(patch?.calories).toBeUndefined();
        expect(patch?.fatG).toBeUndefined();
        expect(patch?.saturatedFatG).toBeUndefined();
    });

    test("a food OFF made with no nutrition at all adopts the hit's basis and fills", () => {
        const empty = newFood({
            householdId: HH,
            kind: "food",
            name: "Cream",
            nutritionSource: "openfoodfacts",
        });
        const patch = offNutritionPatchFromHit(empty, hit());
        expect(patch?.nutritionBasis).toBe("100ml");
        expect(patch?.calories).toBe(133.3);
    });

    test("a manual food with no nutrition is not filled: the values were cleared on purpose", () => {
        const empty = newFood({
            householdId: HH,
            kind: "food",
            name: "Cream",
            nutritionSource: "manual",
        });
        const patch = offNutritionPatchFromHit(empty, hit());
        expect(patch?.calories).toBeUndefined();
        expect(patch?.sugarG).toBeUndefined();
        // Saturated fat keeps filling, as it did before per-100 capture.
        expect(patch?.saturatedFatG).toBe(6.7);
    });

    test("a nutrient the user cleared stays cleared after the next refresh", async () => {
        // A per-100 g hit, so the cleared food's null basis (per 100 g) matches
        // it and only the source guard stands between it and a refill.
        const hit100g = () => hit({ nutrition_basis: "100g" });
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit100g(),
        );
        expect(food.sugarG).toBe(3.3);
        const edited = await updateFood(store, HH, food.id, { sugarG: null });
        expect(edited.sugarG).toBeNull();
        expect(edited.nutritionSource).toBe("manual");
        const refreshed = await refreshFoodQualityByBarcode(
            store,
            HH,
            "0193968379117",
            hit100g(),
        );
        expect(refreshed?.sugarG).toBeNull();
        const again = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit100g(),
        );
        expect(again.food.sugarG).toBeNull();
        expect(again.food.calories).toBe(133.3);
    });

    test("an OFF-sourced food made per serving, with null macros, still backfills", async () => {
        const store = createMemoryFoodsStore();
        const old = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                offSourceId: "0193968379117",
                nutritionSource: "openfoodfacts",
            }),
        );
        await store.setBarcode(HH, "0193968379117", old.id);
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.calories).toBe(133.3);
        expect(food.sugarG).toBe(3.3);
        expect(food.nutritionBasis).toBe("100ml");
    });
});

describe("editing nutrition resets the basis", () => {
    async function halfAndHalfFood() {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        return { store, food };
    }

    test("changing a per-100 value makes the food per 100 g, as the edit inputs say", async () => {
        const { store, food } = await halfAndHalfFood();
        expect(food.nutritionBasis).toBe("100ml");
        const edited = await updateFood(store, HH, food.id, { calories: 120 });
        expect(edited.calories).toBe(120);
        expect(edited.nutritionBasis).toBeNull();
        // The serving stays: a 30 ml serving on a per-100 g food derives nothing.
        expect(edited.serving?.unit).toBe("ml");
        expect(perServingFromFood(edited)).toBeNull();
    });

    test("resubmitting the stored values keeps the basis", async () => {
        const { store, food } = await halfAndHalfFood();
        const same = await updateFood(store, HH, food.id, {
            calories: food.calories,
            proteinG: food.proteinG,
            carbsG: food.carbsG,
            fatG: food.fatG,
            fiberG: food.fiberG,
            sugarG: food.sugarG,
            alcoholG: food.alcoholG,
            caffeineMg: food.caffeineMg,
            name: "Half & Half (edited)",
        });
        expect(same.nutritionBasis).toBe("100ml");
        expect(same.calories).toBe(133.3);
    });

    test("adding caffeine, which OFF never supplies, keeps the basis and the source", async () => {
        const { store, food } = await halfAndHalfFood();
        const edited = await updateFood(store, HH, food.id, { caffeineMg: 10 });
        expect(edited.caffeineMg).toBe(10);
        expect(edited.nutritionBasis).toBe("100ml");
        expect(edited.nutritionSource).toBe("openfoodfacts");
        expect(edited.calories).toBe(133.3);
    });

    test("an edit that touches no nutrition keeps the basis", async () => {
        const { store, food } = await halfAndHalfFood();
        const renamed = await updateFood(store, HH, food.id, {
            gramsPerMl: 1.03,
        });
        expect(renamed.nutritionBasis).toBe("100ml");
    });
});

describe("the basis labels the per-100 columns and does not change logging", () => {
    // A per-100 ml food scales by ml. Grams turn into ml only through the
    // food's own density; none is guessed.
    test("an OFF liquid whose basis becomes 100 ml logs 250 ml like 250 g before", async () => {
        const base = {
            householdId: HH,
            kind: "food" as const,
            name: "Milk",
            calories: 42,
            proteinG: 3.4,
            nutritionSource: "openfoodfacts" as const,
        };
        const before = newFood(base);
        const mealBefore = buildMealFromItems(
            [{ foodId: before.id, amount: 250, unit: "g" }],
            new Map([[before.id, before]]),
        );
        const milk = hit({
            serving: "100 g",
            serving_size: null,
            serving_quantity: null,
            serving_quantity_unit: null,
            calories: 42,
            per_100: {
                calories: 42,
                protein_g: 3.4,
                carbs_g: null,
                fat_g: null,
                fiber_g: null,
                sugar_g: null,
                saturated_fat_g: null,
                alcohol_g: null,
            },
        });
        const patch = offNutritionPatchFromHit(before, milk);
        expect(patch?.nutritionBasis).toBe("100ml");
        const after = { ...before, nutritionBasis: patch!.nutritionBasis! };
        const mealAfter = buildMealFromItems(
            [{ foodId: after.id, amount: 250, unit: "ml" }],
            new Map([[after.id, after]]),
        );
        expect(mealBefore.totals.calories).toBe(105);
        expect(mealAfter.totals).toEqual(mealBefore.totals);
        expect(mealAfter.items[0]?.calories).toBe(105);
        // By weight, with no density, the ml are unknown rather than guessed.
        const byWeight = buildMealFromItems(
            [{ foodId: after.id, amount: 250, unit: "g" }],
            new Map([[after.id, after]]),
        );
        expect(byWeight.items[0]?.unknown).toBe(true);
        expect(byWeight.items[0]?.calories).toBeNull();
    });

    test("a per-100 ml food logged by weight scales through its own density", () => {
        const oil = {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Oil",
                calories: 800,
                gramsPerMl: 0.92,
            }),
            nutritionBasis: "100ml" as const,
        };
        const meal = buildMealFromItems(
            [{ foodId: oil.id, amount: 92, unit: "g" }],
            new Map([[oil.id, oil]]),
        );
        // 92 g at 0.92 g/ml is 100 ml, not 92.
        expect(meal.items[0]?.calories).toBe(800);
    });

    test("a new OFF liquid logged in ml has nutrition, not unknown", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.nutritionBasis).toBe("100ml");
        const meal = buildMealFromItems(
            [{ foodId: food.id, amount: 250, unit: "ml" }],
            new Map([[food.id, food]]),
        );
        // 133.3 per 100 x 250 / 100.
        expect(meal.totals.calories).toBe(333.3);
    });

    test("a food with no basis logs unchanged", () => {
        const f = newFood({
            householdId: HH,
            kind: "food",
            name: "Oats",
            calories: 380,
        });
        const meal = buildMealFromItems(
            [{ foodId: f.id, amount: 50, unit: "g" }],
            new Map([[f.id, f]]),
        );
        expect(meal.totals.calories).toBe(190);
    });
});

const FULL_QUALITY: FoodQuality = {
    nutriscoreGrade: "d",
    novaGroup: 1,
    ecoscoreGrade: null,
    additives: [],
    allergensTags: [],
    tracesTags: [],
    ingredientsAnalysisTags: [],
    labelsTags: [],
    fetchedAt: "2026-11-01T00:00:00.000Z",
};

// Quality, nutrient levels and saturated fat are all set, so the old
// refresh condition saw nothing left to fetch.
async function filledOldFood(
    over: Partial<Parameters<typeof newFood>[0]> = {},
) {
    const store = createMemoryFoodsStore();
    const old = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Half & Half",
            calories: 133.3,
            proteinG: 3.3,
            fatG: 10,
            saturatedFatG: 6.7,
            offNutrientLevels: { fat: "high" },
            offQuality: { ...FULL_QUALITY },
            nutritionSource: "openfoodfacts",
            offSourceId: "0193968379117",
            ...over,
        }),
    );
    await store.setBarcode(HH, "0193968379117", old.id);
    return store;
}

describe("re-scanning a barcode food made before the serving and basis columns", () => {
    test("looks the barcode up again and fills the serving and basis", async () => {
        const store = await filledOldFood();
        let lookups = 0;
        const { food } = await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            async () => {
                lookups++;
                return hit();
            },
        );
        expect(lookups).toBe(1);
        expect(food.serving?.amount).toBe(30);
        expect(food.nutritionBasis).toBe("100ml");
        const nutrition = productNutrition(food);
        expect(nutrition.head.serving).toEqual({
            name: "Per portion",
            amount: "30 ml",
        });
        expect(nutrition.table.calories.perServing).toBe("40");
        expect(nutrition.head.per100).toBe("Per 100 ml");
    });

    test("a food that already has serving and basis is not looked up", async () => {
        const store = await filledOldFood({
            serving: { label: "1 portion (30 ml)", amount: 30, unit: "ml" },
            nutritionBasis: "100ml",
        });
        let lookups = 0;
        await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            async () => {
                lookups++;
                return hit();
            },
        );
        expect(lookups).toBe(0);
    });

    test("typed-in nutrition with a serving never asks for a basis", async () => {
        const store = await filledOldFood({
            nutritionSource: "manual",
            serving: { label: "30 g", amount: 30, unit: "g" },
        });
        let lookups = 0;
        await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            async () => {
                lookups++;
                return hit();
            },
        );
        expect(lookups).toBe(0);
    });

    test("an OFF empty miss is not looked up for a serving it will never have", async () => {
        const store = await filledOldFood({
            offQuality: offQualityMissStamp("2026-11-01T00:00:00.000Z"),
        });
        let lookups = 0;
        await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            async () => {
                lookups++;
                return hit();
            },
        );
        expect(lookups).toBe(0);
    });
});

describe("a barcode food OFF gives no millilitre or gram serving", () => {
    const NO_SERVING = () =>
        hit({
            serving: "1 cup",
            serving_size: "1 cup",
            serving_quantity: null,
            serving_quantity_unit: null,
            quality: {
                nutriscore_grade: "d",
                nova_group: 1,
                ecoscore_grade: null,
                additives_tags: [],
                allergens_tags: [],
                traces_tags: [],
                ingredients_analysis_tags: [],
                labels_tags: [],
                fetched_at: new Date().toISOString(),
            },
        });

    test("is looked up at most once over repeated scans", async () => {
        const store = createMemoryFoodsStore();
        const old = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Oats",
                calories: 380,
                saturatedFatG: 1.2,
                offNutrientLevels: { fat: "low" },
                offQuality: { ...FULL_QUALITY },
                nutritionSource: "openfoodfacts",
                offSourceId: "0193968379117",
            }),
        );
        await store.setBarcode(HH, "0193968379117", old.id);
        let lookups = 0;
        for (let i = 0; i < 5; i++) {
            await findOrCreateFoodByBarcodeResult(
                store,
                HH,
                "0193968379117",
                async () => {
                    lookups++;
                    return NO_SERVING();
                },
            );
        }
        expect(lookups).toBeLessThanOrEqual(1);
    });

    test("a hit with no quality block still closes the fill after one lookup", async () => {
        const store = createMemoryFoodsStore();
        const old = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Oats",
                calories: 380,
                saturatedFatG: 1.2,
                offNutrientLevels: { fat: "low" },
                offQuality: { ...FULL_QUALITY },
                nutritionSource: "openfoodfacts",
                offSourceId: "0193968379117",
            }),
        );
        await store.setBarcode(HH, "0193968379117", old.id);
        let lookups = 0;
        for (let i = 0; i < 5; i++) {
            await findOrCreateFoodByBarcodeResult(
                store,
                HH,
                "0193968379117",
                async () => {
                    lookups++;
                    const { quality: _quality, ...bare } = NO_SERVING();
                    return bare;
                },
            );
        }
        expect(lookups).toBe(1);
    });

    test("a food an older build refreshed today still gets its serving and basis on the next scan", async () => {
        const store = createMemoryFoodsStore();
        const refreshed = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                calories: 133.3,
                proteinG: 3.3,
                fatG: 10,
                saturatedFatG: 6.7,
                offNutrientLevels: { fat: "high" },
                // The old build stamped this at refresh time, with no
                // serving and no basis stored.
                offQuality: {
                    ...FULL_QUALITY,
                    fetchedAt: new Date().toISOString(),
                },
                nutritionSource: "openfoodfacts",
                offSourceId: "0193968379117",
            }),
        );
        await store.setBarcode(HH, "0193968379117", refreshed.id);
        let lookups = 0;
        const lookup = async () => {
            lookups++;
            return hit();
        };
        const { food } = await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            lookup,
        );
        expect(lookups).toBe(1);
        expect(food.serving?.amount).toBe(30);
        expect(food.nutritionBasis).toBe("100ml");
        // The basis it now holds is the signal that the ask is done.
        await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            lookup,
        );
        expect(lookups).toBe(1);
    });

    test("a barcode food with typed-in values is never looked up for a basis", async () => {
        const store = await filledOldFood({ nutritionSource: "manual" });
        let lookups = 0;
        const { food } = await findOrCreateFoodByBarcodeResult(
            store,
            HH,
            "0193968379117",
            async () => {
                lookups++;
                return hit();
            },
        );
        expect(lookups).toBe(0);
        expect(food.nutritionBasis).toBeNull();
    });

    test("a null lookup on an OFF empty miss does not repeat", async () => {
        const store = await filledOldFood({
            offQuality: offQualityMissStamp(new Date().toISOString()),
        });
        let lookups = 0;
        for (let i = 0; i < 5; i++) {
            await findOrCreateFoodByBarcodeResult(
                store,
                HH,
                "0193968379117",
                async () => {
                    lookups++;
                    return null;
                },
            );
        }
        expect(lookups).toBe(0);
    });
});

describe("nutrition_data_per serving with a millilitre serving", () => {
    const MILK = (over: Record<string, unknown> = {}) => ({
        status: 1,
        product: {
            product_name: "Whole Milk",
            serving_size: "1 cup (240 ml)",
            serving_quantity: 240,
            serving_quantity_unit: "ml",
            nutrition_data_per: "serving",
            nutriments: {
                "energy-kcal_100g": 62.5,
                "energy-kcal_serving": 150,
                proteins_100g: 3.3,
                proteins_serving: 8,
                fat_100g: 3.3,
                fat_serving: 8,
                carbohydrates_100g: 5,
                carbohydrates_serving: 12,
            },
            ...over,
        },
    });

    test("is per 100 ml, and the screen leads with the cup", async () => {
        mockFetch(MILK());
        const off = (await fetchProductFromOFF("0041900076641"))!;
        expect(off.nutrition_basis).toBe("100ml");
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0041900076641",
            off,
        );
        const nutrition = productNutrition(food);
        expect(nutrition.head.serving).toEqual({
            name: "Per cup",
            amount: "240 ml",
        });
        expect(nutrition.head.per100).toBe("Per 100 ml");
        expect(nutrition.table.calories.perServing).toBe("150");
        expect(nutrition.table.calories.per100g).toBe("63");
    });

    test("no nutrition_data_per and an ml serving is per 100 ml", async () => {
        mockFetch(MILK({ nutrition_data_per: undefined }));
        expect(
            (await fetchProductFromOFF("0041900076641"))?.nutrition_basis,
        ).toBe("100ml");
    });

    test("a gram serving stays per 100 g", async () => {
        mockFetch(
            MILK({
                serving_size: "2 cookies (30 g)",
                serving_quantity: 30,
                serving_quantity_unit: "g",
            }),
        );
        expect(
            (await fetchProductFromOFF("0041900076641"))?.nutrition_basis,
        ).toBe("100g");
    });

    test("an explicit 100g stays per 100 g whatever the serving unit", async () => {
        mockFetch(MILK({ nutrition_data_per: "100g" }));
        expect(
            (await fetchProductFromOFF("0041900076641"))?.nutrition_basis,
        ).toBe("100g");
    });
});

describe("a typed-in edit is not relabelled by the next OFF refresh", () => {
    test("create from OFF, edit calories, refresh: the basis stays null", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(food.nutritionSource).toBe("openfoodfacts");
        const edited = await updateFood(store, HH, food.id, { calories: 120 });
        expect(edited.nutritionBasis).toBeNull();
        expect(edited.nutritionSource).toBe("manual");
        const refreshed = await refreshFoodQualityByBarcode(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        expect(refreshed?.nutritionBasis).toBeNull();
        expect(refreshed?.calories).toBe(120);
        expect(productNutrition(refreshed!).head.per100).toBe("Per 100 g");
    });

    test("an edit that changes no nutrition keeps the source", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        const renamed = await updateFood(store, HH, food.id, {
            name: "Half & Half 2",
        });
        expect(renamed.nutritionSource).toBe("openfoodfacts");
    });

    test("an explicit nutrition_source in the same patch wins", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            hit(),
        );
        const edited = await updateFood(store, HH, food.id, {
            calories: 120,
            nutritionSource: "estimate",
        });
        expect(edited.nutritionSource).toBe("estimate");
    });
});

describe("an edit only relabels OFF nutrition as manual", () => {
    test("an estimate stays an estimate and a null source stays null", async () => {
        const store = createMemoryFoodsStore();
        const est = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Soup",
                calories: 80,
                nutritionSource: "estimate",
            }),
        );
        const plain = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Oat milk" }),
        );
        const estEdited = await updateFood(store, HH, est.id, {
            calories: 90,
        });
        const added = await updateFood(store, HH, plain.id, { calories: 45 });
        expect(estEdited.nutritionSource).toBe("estimate");
        expect(added.nutritionSource).toBeNull();
    });
});

describe("OFF nutrition patch basis", () => {
    test("the memory store sets no basis on a row that is no longer OFF-sourced", async () => {
        const store = createMemoryFoodsStore();
        const food = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
                calories: 120,
                nutritionSource: "manual",
            }),
        );
        const patched = await store.setFoodOffNutrition(HH, food.id, {
            nutritionBasis: "100ml",
            serving: { label: "30 ml", amount: 30, unit: "ml" },
        });
        expect(patched?.serving?.amount).toBe(30);
        expect(patched?.nutritionBasis).toBeNull();
    });

    test("it still adopts a basis on a food with no per-100 nutrition", async () => {
        const store = createMemoryFoodsStore();
        const food = await store.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const patched = await store.setFoodOffNutrition(HH, food.id, {
            nutritionBasis: "100ml",
        });
        expect(patched?.nutritionBasis).toBe("100ml");
    });
});

describe("a negative per-100 value from OFF", () => {
    function negative(): FoodResult {
        const h = hit();
        h.per_100 = { ...h.per_100!, protein_g: -0.1, calories: -5 };
        return h;
    }

    test("catalogNutritionFromOff drops every negative per-100 value", () => {
        const n = catalogNutritionFromOff(negative());
        expect(n.proteinG).toBeNull();
        expect(n.calories).toBeNull();
        expect(n.fatG).toBe(10);
    });

    test("a food created from it holds null there", async () => {
        const store = createMemoryFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            HH,
            "0193968379117",
            negative(),
        );
        expect(food.proteinG).toBeNull();
        expect(food.calories).toBeNull();
        expect(food.fatG).toBe(10);
    });

    test("a refresh of an existing food does not store it either", async () => {
        const store = createMemoryFoodsStore();
        const existing = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Half & Half",
                offSourceId: "0193968379117",
                nutritionSource: "openfoodfacts",
            }),
        );
        await store.setBarcode(HH, "0193968379117", existing.id);
        const refreshed = await refreshFoodQualityByBarcode(
            store,
            HH,
            "0193968379117",
            negative(),
        );
        expect(refreshed?.proteinG).toBeNull();
        expect(refreshed?.calories).toBeNull();
        expect(refreshed?.fatG).toBe(10);
    });
});

describe("a merge pairs the serving with the nutrition it carries", () => {
    test("a gram serving does not land on a per-100 ml block", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
                serving: { label: "1 cup (240 g)", amount: 240, unit: "g" },
            }),
        );
        const drop = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Whole milk",
                calories: 133.3,
                nutritionBasis: "100ml",
                serving: { label: "1 portion (30 ml)", amount: 30, unit: "ml" },
            }),
        );
        const merged = await mergeFoods(store, HH, keep.id, drop.id);
        expect(merged.nutritionBasis).toBe("100ml");
        expect(merged.serving).toEqual({
            label: "1 portion (30 ml)",
            amount: 30,
            unit: "ml",
        });
        expect(perServingFromFood(merged)?.calories).toBeCloseTo(40, 1);
    });

    test("a serving that matches no block basis is dropped", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
                serving: { label: "1 cup (240 g)", amount: 240, unit: "g" },
            }),
        );
        const drop = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Whole milk",
                calories: 133.3,
                nutritionBasis: "100ml",
            }),
        );
        const merged = await mergeFoods(store, HH, keep.id, drop.id);
        expect(merged.nutritionBasis).toBe("100ml");
        expect(merged.serving).toBeNull();
    });

    test("the serving of the food the nutrition came from wins", async () => {
        const store = createMemoryFoodsStore();
        const keep = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
                serving: { label: "1 shot (30 ml)", amount: 30, unit: "ml" },
            }),
        );
        const drop = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Whole milk",
                calories: 133.3,
                nutritionBasis: "100ml",
                serving: { label: "1 cup (240 ml)", amount: 240, unit: "ml" },
            }),
        );
        const merged = await mergeFoods(store, HH, keep.id, drop.id);
        // The nutrition comes from drop, so its serving goes with it.
        expect(merged.serving?.amount).toBe(240);
    });
});
