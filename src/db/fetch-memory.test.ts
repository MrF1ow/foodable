import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createPostgresFetchMemoryStore } from "./fetch-memory.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { deadLinkHash, refusalExpiry } from "../domain/fetch-memory.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "fetch_memory db", (getCtx) => {
    let householdId: string;
    const store = createPostgresFetchMemoryStore();

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("host refusal upsert and list keyset pagination", async () => {
        const now = new Date("2026-01-10T12:00:00.000Z");
        await store.recordRefusal(householdId, "a.example", 403, now);
        await store.recordRefusal(
            householdId,
            "b.example",
            401,
            new Date("2026-01-11T12:00:00.000Z"),
        );
        const first = await store.listRefusals(householdId, {
            limit: 1,
            now: new Date("2026-01-15T12:00:00.000Z"),
        });
        expect(first).toHaveLength(1);
        const page2 = await store.listRefusals(householdId, {
            limit: 10,
            after: {
                refusedAt: first[0]!.refusedAt,
                host: first[0]!.host,
            },
            now: new Date("2026-01-15T12:00:00.000Z"),
        });
        expect(page2.length).toBeGreaterThanOrEqual(1);
        await store.clearRefusal(householdId, "a.example");
        expect(
            await store.getRefusal(
                householdId,
                "a.example",
                new Date("2026-01-15T12:00:00.000Z"),
            ),
        ).toBeNull();
    });

    test("dead link 404 to 410 upgrade in SQL", async () => {
        const now = new Date("2026-02-01T10:00:00.000Z");
        const url = "https://gone.example/path";
        const h = deadLinkHash(url);
        await store.recordDeadLink(householdId, h, url, 404, now);
        const r404 = await store.getDeadLink(
            householdId,
            h,
            new Date("2026-02-02T00:00:00.000Z"),
        );
        expect(r404?.status).toBe(404);
        await store.recordDeadLink(
            householdId,
            h,
            url,
            410,
            new Date("2026-02-03T00:00:00.000Z"),
        );
        const r410 = await store.getDeadLink(
            householdId,
            h,
            new Date("2099-01-01T00:00:00.000Z"),
        );
        expect(r410?.status).toBe(410);
        expect(r410?.expiresAt).toBeNull();
    });

    test("batch sweep deletes expired rows", async () => {
        const past = new Date("2020-01-01T00:00:00.000Z");
        await store.recordRefusal(householdId, "old.example", 429, past);
        const n = await store.sweepExpired(
            new Date("2025-01-01T00:00:00.000Z"),
            500,
        );
        expect(n).toBeGreaterThanOrEqual(1);
        expect(
            await store.getRefusal(
                householdId,
                "old.example",
                new Date("2026-01-01T00:00:00.000Z"),
            ),
        ).toBeNull();
    });

    test("indexes present and lookup uses index scan", async () => {
        const { sql } = getCtx();
        const idx = (await sql`
            select indexname
            from pg_indexes
            where schemaname = 'public'
              and tablename in ('fetch_host_refusals', 'dead_links')
        `) as { indexname: string }[];
        const names = new Set(idx.map((r) => r.indexname));
        expect(names.has("fetch_host_refusals_pkey")).toBe(true);
        expect(names.has("fetch_host_refusals_expires_idx")).toBe(true);
        expect(names.has("fetch_host_refusals_list_idx")).toBe(true);
        expect(names.has("dead_links_pkey")).toBe(true);
        expect(names.has("dead_links_expires_idx")).toBe(true);

        const now = new Date("2026-03-01T00:00:00.000Z");
        for (let i = 0; i < 5000; i++) {
            await store.recordRefusal(
                householdId,
                `bulk${i}.example`,
                403,
                now,
            );
        }
        await sql`analyze public.fetch_host_refusals`;

        await sql`begin`;
        await sql`set local enable_seqscan = off`;
        const plan1 = (await sql`
            explain (format text)
            select host, status, refused_at, expires_at
            from public.fetch_host_refusals
            where
                household_id = ${householdId}
                and host = ${"bulk1.example"}
                and expires_at > ${now.toISOString()}::timestamptz
        `) as { "QUERY PLAN": string }[];
        const plan2 = (await sql`
            explain (format text)
            select host, status, refused_at, expires_at
            from public.fetch_host_refusals
            where
                household_id = ${householdId}
                and expires_at > ${now.toISOString()}::timestamptz
            order by refused_at desc, host desc
            limit 20
        `) as { "QUERY PLAN": string }[];
        await sql`rollback`;

        const t1 = plan1.map((r) => r["QUERY PLAN"]).join("\n");
        const t2 = plan2.map((r) => r["QUERY PLAN"]).join("\n");
        expect(t1.toLowerCase()).toContain("index");
        expect(t2.toLowerCase()).toContain("index");
    });

    test("lookup treats expired refusal as absent before sweep", async () => {
        const refused = new Date("2026-04-01T00:00:00.000Z");
        await store.recordRefusal(householdId, "exp.example", 403, refused);
        const ex = refusalExpiry(refused);
        expect(
            await store.getRefusal(
                householdId,
                "exp.example",
                new Date(ex.getTime() + 1000),
            ),
        ).toBeNull();
    });
});
