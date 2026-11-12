import { afterEach, expect, test } from "bun:test";
import { getCachedFood, putCachedFood, type FoodResult } from "../foods.js";
import { liveFoodsStore } from "./foods.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import {
    findOrCreateFoodByBarcodeFromHit,
    findOrCreateFoodByBarcodeResult,
    findOrCreateManualFood,
    mergeFoods,
    offNutritionPatchFromHit,
    perServingFromFood,
    updateFood,
} from "../domain/foods.js";
import { sampleFood } from "./contract/helpers.js";

const pgAvailable = await findPgBin();

const BARCODE = "0193968379117";

/** The text of the error a statement fails with, or null if it succeeds. */
async function failure(
    statement: PromiseLike<unknown>,
): Promise<string | null> {
    try {
        await statement;
        return null;
    } catch (err) {
        const e = err as { message?: string; constraint?: string };
        return `${e.constraint ?? ""} ${e.message ?? String(err)}`;
    }
}

function halfAndHalf(over: Partial<FoodResult> = {}): FoodResult {
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
        source: `off:${BARCODE}`,
        source_name: "openfoodfacts",
        barcode: BARCODE,
        ...over,
    };
}

describeDb(pgAvailable !== null, "foods serving and basis", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("a created food round-trips serving, basis and per-100 nutrition", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();

        const { food, created } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        expect(created).toBe(true);
        expect(food.calories).toBe(133.3);

        const read = await store.getFood(householdId, food.id);
        expect(read?.serving).toEqual({
            label: "1 portion (30 ml)",
            amount: 30,
            unit: "ml",
        });
        expect(read?.nutritionBasis).toBe("100ml");
        expect(read?.gramsPerEach).toBeNull();
        expect(perServingFromFood(read!)?.calories).toBe(39.99);

        const [row] = await sql`
            select serving_label, serving_amount, serving_unit, nutrition_basis
            from public.foods where id = ${food.id}
        `;
        expect(row.serving_label).toBe("1 portion (30 ml)");
        expect(Number(row.serving_amount)).toBe(30);
        expect(row.serving_unit).toBe("ml");
        expect(row.nutrition_basis).toBe("100ml");
    });

    test("a food with no serving stores nulls", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf({ serving_size: null, serving_quantity: null }),
        );
        const [row] = await sql`
            select serving_label, serving_amount, serving_unit
            from public.foods where id = ${food.id}
        `;
        expect(row.serving_label).toBeNull();
        expect(row.serving_amount).toBeNull();
        expect(row.serving_unit).toBeNull();
    });

    test("the refresh patch fills null columns and leaves set ones alone", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const legacy = await store.insertFood(
            sampleFood(householdId, {
                name: "Half & Half",
                normalizedName: "half & half",
                nutritionSource: "openfoodfacts",
                offSourceId: BARCODE,
                calories: 130,
                proteinG: 0,
            }),
        );
        await store.setBarcode(householdId, BARCODE, legacy.id);

        const { food, created } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        expect(created).toBe(false);
        expect(food.calories).toBe(130);
        expect(food.proteinG).toBe(0);
        expect(food.fatG).toBe(10);
        expect(food.saturatedFatG).toBe(6.7);
        expect(food.serving?.amount).toBe(30);
        expect(food.nutritionBasis).toBe("100ml");

        // A second hit with a different serving changes nothing.
        const again = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf({
                serving_size: "1 cup (240 ml)",
                serving_quantity: 240,
            }),
        );
        expect(again.food.serving).toEqual({
            label: "1 portion (30 ml)",
            amount: 30,
            unit: "ml",
        });
        expect(again.food.calories).toBe(130);
    });

    test("the check constraints reject a bad unit, amount and basis", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const id = await seedFood(sql, householdId, { name: "Check me" });
        const cases: [string, PromiseLike<unknown>, string][] = [
            [
                "unknown unit",
                sql`update public.foods set serving_amount = 5, serving_unit = 'oz' where id = ${id}`,
                "foods_serving_unit_known",
            ],
            [
                "zero amount",
                sql`update public.foods set serving_amount = 0, serving_unit = 'g' where id = ${id}`,
                "foods_serving_amount_positive",
            ],
            [
                "unit without amount",
                sql`update public.foods set serving_unit = 'g' where id = ${id}`,
                "foods_serving_amount_unit_pair",
            ],
            [
                "unknown basis",
                sql`update public.foods set nutrition_basis = '100oz' where id = ${id}`,
                "foods_nutrition_basis_known",
            ],
        ];
        for (const [label, statement, constraint] of cases) {
            const message = await failure(statement);
            expect(message, label).not.toBeNull();
            expect(message, label).toContain(constraint);
        }
        const [row] = await sql`
            select serving_amount, serving_unit, nutrition_basis
            from public.foods where id = ${id}
        `;
        expect(row.serving_amount).toBeNull();
        expect(row.serving_unit).toBeNull();
        expect(row.nutrition_basis).toBeNull();
    });

    test("an OFF cache payload without per_100 is a miss", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const old: FoodResult = halfAndHalf();
        delete old.per_100;
        delete old.nutrition_basis;
        await putCachedFood("openfoodfacts", BARCODE, old);
        expect(await getCachedFood("openfoodfacts", BARCODE, 1e12)).toBeNull();
        expect(
            (
                await getCachedFood("openfoodfacts", BARCODE, 1e12, {
                    allowLegacy: true,
                })
            )?.name,
        ).toBe("Half & Half");
        // A row stamped after OFF stopped returning the product counts as looked up.
        await putCachedFood("openfoodfacts", BARCODE, {
            ...old,
            per_100: null,
        });
        expect(
            (await getCachedFood("openfoodfacts", BARCODE, 1e12))?.name,
        ).toBe("Half & Half");
        await putCachedFood("openfoodfacts", BARCODE, halfAndHalf());
        expect(
            (await getCachedFood("openfoodfacts", BARCODE, 1e12))?.per_100
                ?.calories,
        ).toBe(133.3);
    });

    test("editing nutrition resets the stored basis; resubmitting does not", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        await updateFood(store, householdId, food.id, {
            calories: food.calories,
            fatG: food.fatG,
        });
        const [same] = await sql`
            select nutrition_basis from public.foods where id = ${food.id}
        `;
        expect(same.nutrition_basis).toBe("100ml");
        await updateFood(store, householdId, food.id, { calories: 120 });
        const [edited] = await sql`
            select nutrition_basis, serving_unit from public.foods
            where id = ${food.id}
        `;
        expect(edited.nutrition_basis).toBeNull();
        expect(edited.serving_unit).toBe("ml");
    });

    test("an edit marks the nutrition manual, so the next refresh keeps the basis null", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        await updateFood(store, householdId, food.id, { calories: 120 });
        await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        const [row] = await sql`
            select nutrition_basis, nutrition_source, calories
            from public.foods where id = ${food.id}
        `;
        expect(row.nutrition_source).toBe("manual");
        expect(row.nutrition_basis).toBeNull();
        expect(Number(row.calories)).toBe(120);
    });

    test("a nutrient the user cleared stays cleared after the next refresh", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        const edited = await updateFood(store, householdId, food.id, {
            sugarG: null,
        });
        // The refresh patch OFF would build from the food as it was before
        // the edit, landing after it: the row guard must stop it.
        const patch = offNutritionPatchFromHit(
            {
                ...edited,
                nutritionSource: "openfoodfacts",
                nutritionBasis: "100ml",
            },
            halfAndHalf(),
        );
        expect(patch?.sugarG).toBe(3.3);
        await store.setFoodOffNutrition(householdId, food.id, patch!);
        await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        const [row] = await sql`
            select sugar_g, calories, nutrition_source
            from public.foods where id = ${food.id}
        `;
        expect(row.nutrition_source).toBe("manual");
        expect(row.sugar_g).toBeNull();
        expect(Number(row.calories)).toBe(133.3);
    });

    test("an OFF-sourced food with null macros still backfills them", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const old = await store.insertFood(
            sampleFood(householdId, {
                name: "Half & Half",
                normalizedName: "half & half",
                nutritionSource: "openfoodfacts",
                offSourceId: BARCODE,
            }),
        );
        await store.setBarcode(householdId, BARCODE, old.id);
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        expect(food.calories).toBe(133.3);
        expect(food.sugarG).toBe(3.3);
    });

    test("adding caffeine to an OFF food keeps its basis and source", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        await updateFood(store, householdId, food.id, { caffeineMg: 10 });
        const [row] = await sql`
            select nutrition_basis, nutrition_source, caffeine_mg
            from public.foods where id = ${food.id}
        `;
        expect(row.nutrition_basis).toBe("100ml");
        expect(row.nutrition_source).toBe("openfoodfacts");
        expect(Number(row.caffeine_mg)).toBe(10);
    });

    test("a stale refresh landing after an edit does not stamp a basis on typed values", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        // Made before per-100 capture: OFF-sourced, no basis yet.
        const { food } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf({ per_100: undefined, nutrition_basis: undefined }),
        );
        expect(food.nutritionBasis).toBeNull();
        const stale = offNutritionPatchFromHit(food, halfAndHalf());
        expect(stale?.nutritionBasis).toBe("100ml");
        await updateFood(store, householdId, food.id, { calories: 120 });
        await store.setFoodOffNutrition(householdId, food.id, stale!);
        const [row] = await sql`
            select nutrition_basis, nutrition_source, calories
            from public.foods where id = ${food.id}
        `;
        expect(row.nutrition_source).toBe("manual");
        expect(row.nutrition_basis).toBeNull();
        expect(Number(row.calories)).toBe(120);
    });

    test("a food an older build refreshed today gets its serving and basis on the next scan, once", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const old = await store.insertFood(
            sampleFood(householdId, {
                name: "Half & Half",
                normalizedName: "half & half",
                nutritionSource: "openfoodfacts",
                offSourceId: BARCODE,
                offNutrientLevels: { fat: "high" },
                calories: 133.3,
                saturatedFatG: 6.7,
                offQuality: {
                    nutriscoreGrade: "d",
                    novaGroup: 3,
                    ecoscoreGrade: null,
                    additives: [],
                    allergensTags: [],
                    tracesTags: [],
                    ingredientsAnalysisTags: [],
                    labelsTags: [],
                    fetchedAt: new Date().toISOString(),
                },
            }),
        );
        await store.setBarcode(householdId, BARCODE, old.id);
        let lookups = 0;
        const lookup = async () => {
            lookups++;
            return halfAndHalf();
        };
        const first = await findOrCreateFoodByBarcodeResult(
            store,
            householdId,
            BARCODE,
            lookup,
        );
        expect(first.food.serving?.amount).toBe(30);
        expect(first.food.nutritionBasis).toBe("100ml");
        await findOrCreateFoodByBarcodeResult(
            store,
            householdId,
            BARCODE,
            lookup,
        );
        expect(lookups).toBe(1);
    });

    test("a hit with a negative per-100 value creates the food with that value null", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const base = halfAndHalf();
        const { food, created } = await findOrCreateFoodByBarcodeFromHit(
            liveFoodsStore(),
            householdId,
            BARCODE,
            {
                ...base,
                per_100: { ...base.per_100!, protein_g: -0.1, fat_g: -2 },
            },
        );
        expect(created).toBe(true);
        const [row] = await sql`
            select protein_g, fat_g, calories from public.foods
            where id = ${food.id}
        `;
        expect(row.protein_g).toBeNull();
        expect(row.fat_g).toBeNull();
        expect(Number(row.calories)).toBe(133.3);
    });

    test("a merge carries the dropped food's basis and serving with its nutrition", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const store = liveFoodsStore();
        const keep = await findOrCreateManualFood(
            store,
            householdId,
            "food",
            "Half and half",
        );
        const { food: drop } = await findOrCreateFoodByBarcodeFromHit(
            store,
            householdId,
            BARCODE,
            halfAndHalf(),
        );
        const merged = await mergeFoods(store, householdId, keep.id, drop.id);
        expect(merged.calories).toBe(133.3);
        expect(merged.nutritionBasis).toBe("100ml");
        const [row] = await sql`
            select nutrition_basis, serving_label, serving_amount, serving_unit
            from public.foods where id = ${keep.id}
        `;
        expect(row.nutrition_basis).toBe("100ml");
        expect(row.serving_label).toBe("1 portion (30 ml)");
        expect(Number(row.serving_amount)).toBe(30);
        expect(row.serving_unit).toBe("ml");
    });
});
