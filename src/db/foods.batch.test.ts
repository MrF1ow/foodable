import type { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { liveFoodsStore } from "./foods.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "foods batch load", (getCtx) => {
    let householdId: string;
    let sql: SQL;

    beforeEach(async () => {
        const ctx = getCtx();
        sql = ctx.sql;
        await ctx.truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("getFoodsByIds returns matching rows in one round trip", async () => {
        const store = liveFoodsStore();
        const a = await seedFood(sql, householdId, { name: "A" });
        const b = await seedFood(sql, householdId, { name: "B" });
        const map = await store.getFoodsByIds(householdId, [a, b, a]);
        expect(map.size).toBe(2);
        expect(map.get(a)?.name).toBe("A");
        expect(map.get(b)?.name).toBe("B");
    });
});
