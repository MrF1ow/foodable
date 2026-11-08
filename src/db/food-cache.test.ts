import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    selectFoodCacheRow,
    selectFoodCacheRowsBySource,
    upsertFoodCacheRow,
} from "./food-cache.js";
import { describeDb } from "./testing/pg.js";
import { lookupBarcode } from "../foods.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "food-cache db", (getCtx) => {
    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("select miss and hit with jsonb round-trip", async () => {
        expect(await selectFoodCacheRow("openfoodfacts", "123")).toBeNull();
        const payload = { name: "Test", nested: { k: 1 }, tags: ["a"] };
        const fetchedAt = "2026-03-01T12:00:00.000Z";
        await upsertFoodCacheRow({
            source: "openfoodfacts",
            source_id: "123",
            payload,
            fetched_at: fetchedAt,
        });
        const hit = await selectFoodCacheRow("openfoodfacts", "123");
        expect(hit?.payload).toEqual(payload);
        expect(hit?.fetched_at).toMatch(/2026-03-01T12:00:00/);
    });

    test("upsert conflict updates payload and fetched_at", async () => {
        await upsertFoodCacheRow({
            source: "openfoodfacts",
            source_id: "999",
            payload: { v: 1 },
            fetched_at: "2026-01-01T00:00:00.000Z",
        });
        await upsertFoodCacheRow({
            source: "openfoodfacts",
            source_id: "999",
            payload: { v: 2 },
            fetched_at: "2026-06-01T00:00:00.000Z",
        });
        const row = await selectFoodCacheRow("openfoodfacts", "999");
        expect(row?.payload).toEqual({ v: 2 });
        expect(row?.fetched_at).toMatch(/2026-06-01/);
    });

    test("selectFoodCacheRowsBySource lists source rows", async () => {
        await upsertFoodCacheRow({
            source: "usda",
            source_id: "a",
            payload: { id: "a" },
            fetched_at: new Date().toISOString(),
        });
        await upsertFoodCacheRow({
            source: "usda",
            source_id: "b",
            payload: { id: "b" },
            fetched_at: new Date().toISOString(),
        });
        await upsertFoodCacheRow({
            source: "other",
            source_id: "x",
            payload: {},
            fetched_at: new Date().toISOString(),
        });
        const rows = await selectFoodCacheRowsBySource("usda");
        expect(rows).toHaveLength(2);
    });

    describe("lookupBarcode with a cache row from before quality data", () => {
        const realFetch = globalThis.fetch;
        const realUa = process.env.OFF_USER_AGENT;
        const barcode = "3017624010701";
        const legacy = {
            name: "Cached Nutella",
            brand: "Ferrero",
            serving: "100 g",
            calories: 539,
            protein_g: 6.3,
            carbs_g: 57.5,
            fat_g: 30.9,
            source: `off:${barcode}`,
            source_name: "openfoodfacts",
            barcode,
        };

        beforeEach(async () => {
            process.env.OFF_USER_AGENT = "Foodable-test (test@example.com)";
            await upsertFoodCacheRow({
                source: "openfoodfacts",
                source_id: barcode,
                payload: legacy,
                fetched_at: new Date().toISOString(),
            });
        });

        afterEach(() => {
            globalThis.fetch = realFetch;
            if (realUa === undefined) delete process.env.OFF_USER_AGENT;
            else process.env.OFF_USER_AGENT = realUa;
        });

        test("serves the cached row when the refetch throws", async () => {
            globalThis.fetch = (async () => {
                throw new Error("network down");
            }) as unknown as typeof fetch;
            const hit = await lookupBarcode(barcode);
            expect(hit?.name).toBe("Cached Nutella");
            expect(hit?.quality).toBeUndefined();
        });

        test("serves the cached row when the refetch misses", async () => {
            globalThis.fetch = (async () =>
                new Response("{}", {
                    status: 404,
                })) as unknown as typeof fetch;
            const hit = await lookupBarcode(barcode);
            expect(hit?.name).toBe("Cached Nutella");
        });

        test("replaces the cached row when the refetch has quality", async () => {
            globalThis.fetch = (async () =>
                Response.json({
                    status: 1,
                    product: {
                        product_name: "Fresh Nutella",
                        nutriments: { "energy-kcal_100g": 539 },
                        nutriscore_grade: "e",
                        additives_tags: [],
                    },
                })) as unknown as typeof fetch;
            const hit = await lookupBarcode(barcode);
            expect(hit?.name).toBe("Fresh Nutella");
            expect(hit?.quality?.nutriscore_grade).toBe("e");
            const row = await selectFoodCacheRow("openfoodfacts", barcode);
            expect(
                (row?.payload as { quality?: unknown }).quality,
            ).toBeDefined();
        });
    });
});
