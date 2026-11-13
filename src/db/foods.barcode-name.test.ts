import { afterEach, expect, test } from "bun:test";
import type { FoodResult } from "../foods.js";
import { findOrCreateFoodByBarcodeResult } from "../domain/foods.js";
import { liveFoodsStore } from "./foods.js";
import { seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

function hit(barcode: string, brand: string | null): FoodResult {
    return {
        name: "Half & Half",
        brand,
        serving: "30 ml",
        calories: 40,
        protein_g: 1,
        carbs_g: 1,
        fat_g: 3.5,
        fiber_g: null,
        sugar_g: 1,
        alcohol_g: null,
        nutriscore_grade: null,
        nova_group: null,
        source: `off:${barcode}`,
        source_name: "openfoodfacts",
        barcode,
    };
}

describeDb(
    pgAvailable !== null,
    "scanned product rows keep the name and brand key",
    (getCtx) => {
        afterEach(() => setSqlForTests(null));

        test("a second barcode for a branded product joins its row instead of hitting the name key", async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            const { householdId } = await seedHousehold(sql);
            const store = liveFoodsStore();
            const first = await findOrCreateFoodByBarcodeResult(
                store,
                householdId,
                "0193968379117",
                async () => hit("0193968379117", "Member's Mark"),
                { nameMatch: false },
            );
            const second = await findOrCreateFoodByBarcodeResult(
                store,
                householdId,
                "0193968379124",
                async () => hit("0193968379124", "Member's Mark"),
                { nameMatch: false },
            );
            expect(first.created).toBe(true);
            expect(second.created).toBe(false);
            expect(second.food.id).toBe(first.food.id);
            expect(
                await store.getBarcodeFoodId(householdId, "0193968379124"),
            ).toBe(first.food.id);
            expect(await store.listFoods(householdId)).toHaveLength(1);
        });
    },
);
