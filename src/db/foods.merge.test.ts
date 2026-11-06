import { afterEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { mergeFoods, type FoodsStore } from "../domain/foods.js";
import { liveFoodsStore, mergeLiveFoods } from "./foods.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

// A live store whose last merge step (archiving the dropped row) fails, as a
// dropped connection or a restart would, after every other step has written.
function failingOnArchive(): FoodsStore {
    const live = liveFoodsStore();
    return {
        ...live,
        async updateFoodRow(row) {
            if (row.archivedAt) throw new Error("connection lost");
            return live.updateFoodRow(row);
        },
    };
}

async function seedMerge(sql: SQL) {
    const { householdId } = await seedHousehold(sql);
    const keepId = await seedFood(sql, householdId, { name: "Eggs" });
    const dropId = await seedFood(sql, householdId, { name: "Large eggs" });
    await sql`
        insert into public.food_barcodes (household_id, barcode, food_id)
        values (${householdId}, ${"12345678"}, ${dropId})
    `;
    await sql`
        insert into public.stock_movements (household_id, food_id, delta, unit, reason)
        values (${householdId}, ${dropId}, ${150}, ${"g"}, ${"adjust"})
    `;
    return { householdId, keepId, dropId };
}

async function mergeState(sql: SQL, dropId: string) {
    const [barcode] = await sql`
        select food_id::text as food_id from public.food_barcodes
        where barcode = ${"12345678"}
    `;
    const [movement] = await sql`
        select food_id::text as food_id from public.stock_movements
    `;
    const [drop] = await sql`
        select archived_at from public.foods where id = ${dropId}
    `;
    return {
        barcodeFoodId: barcode?.food_id ?? null,
        movementFoodId: movement?.food_id ?? null,
        dropArchived: drop?.archived_at != null,
    };
}

describeDb(pgAvailable !== null, "mergeLiveFoods transaction", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    test("a failure at the last step rolls the whole merge back", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId, keepId, dropId } = await seedMerge(sql);

        await expect(
            mergeLiveFoods(householdId, keepId, dropId, failingOnArchive()),
        ).rejects.toThrow("connection lost");

        // Nothing moved: the barcode was deleted and re-added and the movement
        // was repointed before the failure, and both were rolled back.
        expect(await mergeState(sql, dropId)).toEqual({
            barcodeFoodId: dropId,
            movementFoodId: dropId,
            dropArchived: false,
        });
    });

    test("without the transaction the same failure leaves a half merge", async () => {
        // Documents the hazard mergeLiveFoods exists for: plain mergeFoods
        // commits each step on its own.
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId, keepId, dropId } = await seedMerge(sql);

        await expect(
            mergeFoods(failingOnArchive(), householdId, keepId, dropId),
        ).rejects.toThrow("connection lost");

        expect(await mergeState(sql, dropId)).toEqual({
            barcodeFoodId: keepId,
            movementFoodId: keepId,
            dropArchived: false,
        });
    });

    test("a successful merge commits every step", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId, keepId, dropId } = await seedMerge(sql);

        const saved = await mergeLiveFoods(householdId, keepId, dropId);
        expect(saved.id).toBe(keepId);
        expect(await mergeState(sql, dropId)).toEqual({
            barcodeFoodId: keepId,
            movementFoodId: keepId,
            dropArchived: true,
        });
    });
});
