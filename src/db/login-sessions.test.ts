import { afterEach, beforeEach, expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import { del, get, put, sweepExpired, take } from "./login-sessions.js";

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
