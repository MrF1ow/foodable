import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import {
    countSiteSessions,
    del,
    get,
    put,
    putSiteSessionWithCap,
    sweepExpired,
    take,
} from "./login-sessions.js";

const pgAvailable = await findPgBin();

const TTL_MS = 10 * 60 * 1000;

describeDb(pgAvailable !== null, "login sessions db", (getCtx) => {
    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("put then get returns payload", async () => {
        const id = crypto.randomUUID();
        const payload = { purpose: "mcp", state: "abc" };
        await put(id, payload, TTL_MS);
        expect(await get(id)).toEqual(payload);
    });

    test("get returns null for missing id", async () => {
        expect(await get("missing")).toBeNull();
    });

    test("take removes and returns payload", async () => {
        const id = crypto.randomUUID();
        const payload = { purpose: "site" };
        await put(id, payload, TTL_MS);
        expect(await take(id)).toEqual(payload);
        expect(await get(id)).toBeNull();
        expect(await take(id)).toBeNull();
    });

    test("del removes without returning", async () => {
        const id = crypto.randomUUID();
        await put(id, { n: 1 }, TTL_MS);
        await del(id);
        expect(await get(id)).toBeNull();
    });

    test("expired session is invisible to get and take", async () => {
        const { sql } = getCtx();
        const id = "expired-1";
        await put(id, { x: 1 }, TTL_MS);
        await sql`
            update public.oauth_login_sessions
            set expires_at = now() - interval '1 second'
            where id = ${id}
        `;
        expect(await get(id)).toBeNull();
        expect(await take(id)).toBeNull();
    });

    test("putSiteSessionWithCap trims live site rows to cap", async () => {
        const { sql } = getCtx();
        const cap = 4;
        const payload = (n: number) => ({
            purpose: "site" as const,
            state: "site",
            redirectUri: `/share?n=${n}`,
            clientId: "site",
        });
        for (let i = 0; i < cap + 3; i++) {
            const id = `site-${i}`;
            await putSiteSessionWithCap(id, payload(i), TTL_MS, cap);
            await sql`
                update public.oauth_login_sessions
                set expires_at = now() + (${i + 1}::int * interval '1 minute')
                where id = ${id}
            `;
        }
        expect(await countSiteSessions()).toBe(cap);
        const newest = await get(`site-${cap + 2}`);
        expect(newest).toEqual(payload(cap + 2));
        expect(await get("site-0")).toBeNull();
    });

    test("concurrent putSiteSessionWithCap stays within cap", async () => {
        const cap = 8;
        const n = 40;
        const payload = {
            purpose: "site" as const,
            state: "site",
            redirectUri: "/",
            clientId: "site",
        };
        await Promise.all(
            Array.from({ length: n }, (_, i) =>
                putSiteSessionWithCap(`race-${i}`, payload, TTL_MS, cap),
            ),
        );
        expect(await countSiteSessions()).toBeLessThanOrEqual(cap);
    });

    test("putSiteSessionWithCap holds the cap across many connections", async () => {
        const { pg, sql } = getCtx();
        const cap = 8;
        const n = 40;
        const payload = {
            purpose: "site" as const,
            state: "site",
            redirectUri: "/",
            clientId: "site",
        };
        const pool = new SQL(pg.url, { prepare: false, max: 8 });
        try {
            for (let round = 0; round < 5; round++) {
                await sql`delete from public.oauth_login_sessions`;
                setSqlForTests(pool);
                await Promise.all(
                    Array.from({ length: n }, (_, i) =>
                        putSiteSessionWithCap(
                            `pool-${round}-${i}`,
                            payload,
                            TTL_MS,
                            cap,
                        ),
                    ),
                );
                setSqlForTests(sql);
                expect(await countSiteSessions()).toBe(cap);
            }
        } finally {
            setSqlForTests(sql);
            await pool.close();
        }
    });

    test("sweepExpired deletes expired rows", async () => {
        const { sql } = getCtx();
        await put("live", { k: 1 }, TTL_MS);
        await put("dead", { k: 2 }, TTL_MS);
        await sql`
            update public.oauth_login_sessions
            set expires_at = now() - interval '1 minute'
            where id = 'dead'
        `;
        expect(await sweepExpired()).toBe(1);
        expect(await get("live")).toEqual({ k: 1 });
        expect(await get("dead")).toBeNull();
    });
});
