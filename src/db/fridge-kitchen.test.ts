import { afterEach, expect, test } from "bun:test";
import { putAwayGroceryLines } from "../domain/stock.js";
import { freezeFridgeItem } from "../domain/fridge.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { liveStockStore } from "./stock.js";
import { describeDb } from "./testing/pg.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "kitchen domain db", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("putAwayGroceryLines writes per-line location and expiry", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const fridgeLoc = await seedFridgeLocation(sql, householdId, "Fridge");
        const pantryLoc = await seedFridgeLocation(sql, householdId, "Pantry");
        const foodA = await seedFood(sql, householdId, { name: "Apples" });
        const foodB = await seedFood(sql, householdId, { name: "Oats" });
        const storeId = await seedGroceryStore(sql, householdId);
        const sectionId = await seedGrocerySection(sql, householdId, storeId);
        const lineA = crypto.randomUUID();
        const lineB = crypto.randomUUID();
        await sql`
            insert into public.grocery_lines (
                id, household_id, store_id, section_id, kind, display_name,
                amount, unit, food_id, checked
            )
            values
                (${lineA}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Apples"}, ${3}, ${"each"}, ${foodA}, ${false}),
                (${lineB}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Oats"}, ${500}, ${"g"}, ${foodB}, ${false})
        `;
        const grocery = liveGroceryStore();
        const fridge = liveFridgeStore();
        const stock = liveStockStore();
        const foods = liveFoodsStore();
        await putAwayGroceryLines(grocery, fridge, stock, foods, {
            householdId,
            lineIds: [lineA, lineB],
            perLine: {
                [lineA]: {
                    locationId: fridgeLoc,
                    expiresOn: "2026-07-01",
                },
                [lineB]: {
                    locationId: pantryLoc,
                    expiresOn: "2026-12-31",
                },
            },
        });
        const items = await sql`
            select location_id::text, expires_on::text, food_id::text
            from public.fridge_items
            where household_id = ${householdId}
            order by display_name asc
        `;
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            location_id: fridgeLoc,
            expires_on: "2026-07-01",
            food_id: foodA,
        });
        expect(items[1]).toMatchObject({
            location_id: pantryLoc,
            expires_on: "2026-12-31",
            food_id: foodB,
        });
        const lines = await sql`
            select id from public.grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(0);
    });

    test("putAwayGroceryLines rejects a bad line without partial writes", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const fridgeLoc = await seedFridgeLocation(sql, householdId);
        const foodA = await seedFood(sql, householdId, { name: "Milk" });
        const foodB = await seedFood(sql, householdId, { name: "Bread" });
        const storeId = await seedGroceryStore(sql, householdId);
        const sectionId = await seedGrocerySection(sql, householdId, storeId);
        const lineA = crypto.randomUUID();
        const lineB = crypto.randomUUID();
        await sql`
            insert into public.grocery_lines (
                id, household_id, store_id, section_id, kind, display_name,
                amount, unit, food_id, checked
            )
            values
                (${lineA}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Milk"}, ${1}, ${"l"}, ${foodA}, ${false}),
                (${lineB}, ${householdId}, ${storeId}, ${sectionId}, ${"food"}, ${"Bread"}, ${1}, ${"each"}, ${foodB}, ${false})
        `;
        const grocery = liveGroceryStore();
        const fridge = liveFridgeStore();
        const stock = liveStockStore();
        const foods = liveFoodsStore();
        await expect(
            putAwayGroceryLines(grocery, fridge, stock, foods, {
                householdId,
                lineIds: [lineA, lineB],
                perLine: {
                    [lineA]: { locationId: fridgeLoc },
                    [lineB]: { locationId: crypto.randomUUID() },
                },
            }),
        ).rejects.toThrow();
        const items = await sql`
            select id from public.fridge_items where household_id = ${householdId}
        `;
        expect(items).toHaveLength(0);
        const movements = await sql`
            select id from public.stock_movements where household_id = ${householdId}
        `;
        expect(movements).toHaveLength(0);
        const lines = await sql`
            select id from public.grocery_lines where household_id = ${householdId}
        `;
        expect(lines).toHaveLength(2);
    });

    test("freezeFridgeItem updates location and expiry on the row", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const fridgeLoc = await seedFridgeLocation(sql, householdId, "Fridge");
        await seedFridgeLocation(sql, householdId, "Freezer");
        const foodId = await seedFood(sql, householdId, { name: "Berries" });
        const itemId = await seedFridgeItem(
            sql,
            householdId,
            fridgeLoc,
            foodId,
            {
                amount: 2,
                unit: "cup",
            },
        );
        await sql`
            update public.fridge_items
            set purchased_on = ${"2026-02-01"},
                opened_on = ${"2026-02-10"},
                expires_on = ${"2026-02-15"}
            where id = ${itemId}
        `;
        const freezerLoc = (
            await sql`
                select id::text from public.fridge_locations
                where household_id = ${householdId} and lower(name) = 'freezer'
            `
        )[0]!.id as string;
        const fridge = liveFridgeStore();
        const frozen = await freezeFridgeItem(
            fridge,
            householdId,
            itemId,
            "2026-06-01",
        );
        expect(frozen.locationId).toBe(freezerLoc);
        expect(frozen.expiresOn).toBe("2026-06-01");
        expect(frozen.purchasedOn).toBe("2026-02-01");
        expect(frozen.openedOn).toBe("2026-02-10");
        expect(frozen.quantity).toEqual({ amount: 2, unit: "cup" });
        const [row] = await sql`
            select location_id::text, expires_on::text, purchased_on::text, opened_on::text, amount, unit
            from public.fridge_items
            where id = ${itemId}
        `;
        expect(row).toMatchObject({
            location_id: freezerLoc,
            expires_on: "2026-06-01",
            purchased_on: "2026-02-01",
            opened_on: "2026-02-10",
            unit: "cup",
        });
        expect(Number(row!.amount)).toBe(2);
    });
});
