import { afterEach, expect, test } from "bun:test";
import type { FoodResult } from "../foods.js";
import { liveFoodsStore } from "./foods.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import {
    applyHitQualityToFood,
    findOrCreateFoodByBarcodeFromHit,
    findOrCreateFoodByBarcodeResult,
    refreshFoodQualityByBarcode,
} from "../domain/foods.js";
import { sampleFood } from "./contract/helpers.js";

const pgAvailable = await findPgBin();

const FETCHED = "2026-11-07T12:00:00.000Z";

function offHit(
    over: Partial<FoodResult> & Pick<FoodResult, "name" | "barcode">,
): FoodResult {
    return {
        brand: null,
        serving: "100 g",
        calories: 200,
        protein_g: 10,
        carbs_g: 20,
        fat_g: 8,
        fiber_g: 2,
        sugar_g: 5,
        saturated_fat_g: 3.2,
        nutrient_levels: {
            fat: "moderate",
            "saturated-fat": "high",
            sugars: "low",
            salt: "low",
        },
        alcohol_g: null,
        nutriscore_grade: "c",
        nova_group: 3,
        source: `off:${over.barcode}`,
        source_name: "openfoodfacts",
        quality: {
            nutriscore_grade: "c",
            nova_group: 3,
            ecoscore_grade: null,
            additives_tags: [],
            allergens_tags: null,
            traces_tags: null,
            ingredients_analysis_tags: null,
            labels_tags: null,
            fetched_at: FETCHED,
        },
        ...over,
    };
}

describeDb(
    pgAvailable !== null,
    "foods saturated fat from OFF lookup",
    (getCtx) => {
        afterEach(() => setSqlForTests(null));

        test("per-100 g hit stores saturated_fat_g and off_nutrient_levels", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "4012345678901";

            const { food, created } = await findOrCreateFoodByBarcodeFromHit(
                store,
                householdId,
                barcode,
                offHit({ name: "Butter croissant", barcode }),
            );
            expect(created).toBe(true);
            expect(food.saturatedFatG).toBe(3.2);
            expect(food.offNutrientLevels).toEqual({
                fat: "moderate",
                "saturated-fat": "high",
                sugars: "low",
                salt: "low",
            });

            const [row] = await sql`
            select saturated_fat_g, off_nutrient_levels
            from public.foods
            where id = ${food.id}
        `;
            expect(Number(row.saturated_fat_g)).toBe(3.2);
            expect(row.off_nutrient_levels).toEqual({
                fat: "moderate",
                "saturated-fat": "high",
                sugars: "low",
                salt: "low",
            });
        });

        test("per-serving-only hit leaves saturated_fat_g null", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "5012345678901";

            const { food, created } = await findOrCreateFoodByBarcodeFromHit(
                store,
                householdId,
                barcode,
                offHit({
                    name: "Yogurt cup",
                    barcode,
                    serving: "150 g",
                    saturated_fat_g: 2.1,
                    calories: 140,
                }),
            );
            expect(created).toBe(true);
            expect(food.saturatedFatG).toBeNull();
            expect(food.offNutrientLevels).toEqual({
                fat: "moderate",
                "saturated-fat": "high",
                sugars: "low",
                salt: "low",
            });

            const [row] = await sql`
            select saturated_fat_g
            from public.foods
            where id = ${food.id}
        `;
            expect(row.saturated_fat_g).toBeNull();
        });

        test("existing barcode row fills null columns on later hit", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "6012345678901";
            const legacy = await store.insertFood(
                sampleFood(householdId, {
                    name: "Legacy bar",
                    normalizedName: "legacy bar",
                    calories: 200,
                    saturatedFatG: null,
                    offNutrientLevels: null,
                    offQuality: {
                        nutriscoreGrade: "c",
                        novaGroup: 3,
                        ecoscoreGrade: null,
                        additives: [],
                        allergensTags: null,
                        tracesTags: null,
                        ingredientsAnalysisTags: null,
                        labelsTags: null,
                        fetchedAt: FETCHED,
                    },
                }),
            );
            await store.setBarcode(householdId, barcode, legacy.id);

            const { food, created } = await findOrCreateFoodByBarcodeFromHit(
                store,
                householdId,
                barcode,
                offHit({ name: "Legacy bar", barcode }),
            );
            expect(created).toBe(false);
            expect(food.saturatedFatG).toBe(3.2);
            expect(food.offNutrientLevels).not.toBeNull();
        });

        test("name attach path fills null columns", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "7012345678901";
            await store.insertFood(
                sampleFood(householdId, {
                    name: "Attach Me",
                    normalizedName: "attach me",
                    calories: 180,
                    saturatedFatG: null,
                    offNutrientLevels: null,
                }),
            );

            const { food, created } = await findOrCreateFoodByBarcodeFromHit(
                store,
                householdId,
                barcode,
                offHit({ name: "Attach Me", barcode }),
            );
            expect(created).toBe(false);
            expect(food.saturatedFatG).toBe(3.2);
            expect(food.offNutrientLevels?.["saturated-fat"]).toBe("high");
        });

        test("refreshFoodQualityByBarcode fills null columns", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "8012345678901";
            const row = await store.insertFood(
                sampleFood(householdId, {
                    name: "Refresh row",
                    normalizedName: "refresh row",
                    calories: 50,
                    saturatedFatG: null,
                    offNutrientLevels: null,
                }),
            );
            await store.setBarcode(householdId, barcode, row.id);

            const out = await refreshFoodQualityByBarcode(
                store,
                householdId,
                barcode,
                offHit({ name: "Refresh row", barcode }),
            );
            expect(out?.saturatedFatG).toBe(3.2);
            expect(out?.offNutrientLevels).not.toBeNull();
        });

        test("findOrCreateFoodByBarcodeResult fills when quality already set", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "1112345678901";
            const legacy = await store.insertFood(
                sampleFood(householdId, {
                    name: "Scan fill",
                    normalizedName: "scan fill",
                    calories: 120,
                    saturatedFatG: null,
                    offNutrientLevels: null,
                    offQuality: {
                        nutriscoreGrade: "b",
                        novaGroup: 2,
                        ecoscoreGrade: null,
                        additives: [],
                        allergensTags: null,
                        tracesTags: null,
                        ingredientsAnalysisTags: null,
                        labelsTags: null,
                        fetchedAt: FETCHED,
                    },
                }),
            );
            await store.setBarcode(householdId, barcode, legacy.id);

            const { food, created } = await findOrCreateFoodByBarcodeResult(
                store,
                householdId,
                barcode,
                async () => offHit({ name: "Scan fill", barcode }),
            );
            expect(created).toBe(false);
            expect(food.saturatedFatG).toBe(3.2);
            expect(food.offNutrientLevels?.["saturated-fat"]).toBe("high");
        });

        test("negative saturated fat patch is ignored", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const row = await store.insertFood(
                sampleFood(householdId, {
                    name: "Neg sat",
                    normalizedName: "neg sat",
                    saturatedFatG: null,
                }),
            );
            const unchanged = await store.setFoodOffNutrition(
                householdId,
                row.id,
                { saturatedFatG: -1.5 },
            );
            expect(unchanged).toBeNull();
            const reread = await store.getFood(householdId, row.id);
            expect(reread?.saturatedFatG).toBeNull();
        });

        test("second hit does not overwrite stored saturated fat", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const barcode = "9012345678901";
            const row = await store.insertFood(
                sampleFood(householdId, {
                    name: "Fixed sat",
                    normalizedName: "fixed sat",
                    calories: 100,
                    saturatedFatG: 1.0,
                    offNutrientLevels: null,
                }),
            );
            await store.setBarcode(householdId, barcode, row.id);

            const refreshed = await applyHitQualityToFood(
                store,
                row,
                offHit({
                    name: "Fixed sat",
                    barcode,
                    saturated_fat_g: 9.9,
                }),
            );
            expect(refreshed.saturatedFatG).toBe(1.0);
        });
    },
);
