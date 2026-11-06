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

    test("list keyset tie-break: same refused_at, host desc, paginate", async () => {
        const t = new Date("2026-05-01T12:00:00.000Z");
        const now = new Date("2026-05-05T00:00:00.000Z");
        await store.recordRefusal(householdId, "a.tie", 403, t);
        await store.recordRefusal(householdId, "m.tie", 401, t);
        await store.recordRefusal(householdId, "z.tie", 429, t);
        const p1 = await store.listRefusals(householdId, { limit: 2, now });
        expect(p1.map((r) => r.host)).toEqual(["z.tie", "m.tie"]);
        const p2 = await store.listRefusals(householdId, {
            limit: 10,
            after: { refusedAt: p1[1]!.refusedAt, host: p1[1]!.host },
            now,
        });
        expect(p2.map((r) => r.host)).toEqual(["a.tie"]);
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

    test("indexes present and lookup uses expected index (no Sort)", async () => {
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
        const cursorTs = now.toISOString();
        const cursorHost = "bulk100.example";
        const planPkey = (await sql`
            explain (format text)
            select host, status, refused_at, expires_at
            from public.fetch_host_refusals
            where
                household_id = ${householdId}
                and host = ${"bulk1.example"}
                and expires_at > ${now.toISOString()}::timestamptz
        `) as { "QUERY PLAN": string }[];
        const planList = (await sql`
            explain (format text)
            select host, status, refused_at, expires_at
            from public.fetch_host_refusals
            where
                household_id = ${householdId}
                and expires_at > ${now.toISOString()}::timestamptz
                and (refused_at, host) < (${cursorTs}::timestamptz, ${cursorHost})
            order by refused_at desc, host desc
            limit 20
        `) as { "QUERY PLAN": string }[];
        const planDeadPkey = (await sql`
            explain (format text)
            select url_hash, url, status, seen_at, expires_at
            from public.dead_links
            where
                household_id = ${householdId}
                and url_hash = ${"0".repeat(64)}
                and (expires_at is null or expires_at > ${now.toISOString()}::timestamptz)
        `) as { "QUERY PLAN": string }[];
        const planRefusalSweep = (await sql`
            explain (format text)
            delete from public.fetch_host_refusals
            where ctid in (
                select ctid
                from public.fetch_host_refusals
                where expires_at <= ${now.toISOString()}::timestamptz
                limit 100
            )
        `) as { "QUERY PLAN": string }[];
        const planDeadSweep = (await sql`
            explain (format text)
            delete from public.dead_links
            where ctid in (
                select ctid
                from public.dead_links
                where
                    expires_at is not null
                    and expires_at <= ${now.toISOString()}::timestamptz
                limit 100
            )
        `) as { "QUERY PLAN": string }[];
        await sql`rollback`;

        const join = (rows: { "QUERY PLAN": string }[]) =>
            rows.map((r) => r["QUERY PLAN"]).join("\n");
        const low = (s: string) => s.toLowerCase();
        const assertNoSort = (s: string) => {
            expect(low(s)).not.toContain("sort");
        };
        const tp = join(planPkey);
        expect(low(tp)).toContain("fetch_host_refusals_pkey");
        assertNoSort(tp);
        const tl = join(planList);
        expect(low(tl)).toContain("fetch_host_refusals_list_idx");
        assertNoSort(tl);
        const td = join(planDeadPkey);
        expect(low(td)).toContain("dead_links_pkey");
        assertNoSort(td);
        const trs = join(planRefusalSweep);
        expect(low(trs)).toContain("fetch_host_refusals_expires_idx");
        assertNoSort(trs);
        const tds = join(planDeadSweep);
        expect(low(tds)).toContain("dead_links_expires_idx");
        assertNoSort(tds);
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
