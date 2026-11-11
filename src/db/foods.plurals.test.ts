import { afterEach, expect, test } from "bun:test";
import { findManualFood } from "../domain/foods.js";
import { liveFoodsStore } from "./foods.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "foods plurals_same_food", (getCtx) => {
    afterEach(() => {
        setSqlForTests(null);
    });

    test("the live store reads the household setting", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        const eggsId = await seedFood(sql, householdId, { name: "Eggs" });
        const store = liveFoodsStore();

        expect(await store.pluralsSameFood!(householdId)).toBe(false);
        expect(await findManualFood(store, householdId, "food", "egg")).toBe(
            null,
        );

        await sql`
            update public.households
            set plurals_same_food = true
            where id = ${householdId}
        `;
        expect(await store.pluralsSameFood!(householdId)).toBe(true);
        const found = await findManualFood(store, householdId, "food", "egg");
        expect(found?.id).toBe(eggsId);
        expect(found?.name).toBe("Eggs");
    });

    test("an unknown household reads as off", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        expect(
            await liveFoodsStore().pluralsSameFood!(crypto.randomUUID()),
        ).toBe(false);
    });
});
