import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { liveFoodsStore } from "./foods.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import * as sql from "./sql.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "foods listAllAliases guard", (getCtx) => {
    afterEach(() => {
        setSqlForTests(null);
    });

    test("short-read guard keeps its message without pgError wrapping", async () => {
        const { sql: client, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(client);
        const { householdId } = await seedHousehold(client);
        await seedFood(client, householdId);

        let calls = 0;
        const rowsSpy = spyOn(sql, "rows").mockImplementation(
            async (tx, query) => {
                calls++;
                if (calls === 1) {
                    return [{ count: 2 }] as never;
                }
                return [{ food_id: crypto.randomUUID(), alias: "a" }] as never;
            },
        );

        try {
            const err = await liveFoodsStore()
                .listAllAliases(householdId)
                .then(
                    () => null,
                    (e: unknown) => e,
                );
            // Exact text, not a substring: the old adapter threw the guard
            // unwrapped, never as "Failed to list aliases: …".
            expect((err as Error).message).toBe(
                "listAllAliases: fetched 1 aliases but count reported 2",
            );
        } finally {
            rowsSpy.mockRestore();
        }
    });
});
