import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import {
    clearBan,
    dbNow,
    hit,
    loadBan,
    saveBan,
    sweepStale,
    withBanLock,
    type BanEntry,
} from "./rate-limits.js";

const pgAvailable = await findPgBin();

const WINDOW_MS = 60_000;
const ESCALATION_DECAY_MS = 6 * 60 * 60 * 1000;

function banEntry(over: Partial<BanEntry> = {}): BanEntry {
    const now = Date.now();
    return {
        strikes: 0,
        lastFailureAt: now,
        bannedUntil: 0,
        escalation: 0,
        ...over,
    };
}

describeDb(pgAvailable !== null, "rate limits db", (getCtx) => {
    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("dbNow tracks Postgres clock", async () => {
        const wall = Date.now();
        const pg = await dbNow();
        expect(pg).toBeGreaterThanOrEqual(wall - 2000);
        expect(pg).toBeLessThanOrEqual(wall + 2000);
    });

    test("hit increments count within the same window", async () => {
        const key = "user:1";
        const first = await hit(key, WINDOW_MS);
        const second = await hit(key, WINDOW_MS);
        expect(first.count).toBe(1);
        expect(second.count).toBe(2);
        expect(second.windowStartMs).toBe(first.windowStartMs);
        expect(second.windowEndMs).toBe(first.windowStartMs + WINDOW_MS);
    });

    test("concurrent hits on the same key return distinct counts", async () => {
        const { pg } = getCtx();
        const key = "race-key";
        const sql1 = new SQL(pg.url, { prepare: false, max: 1 });
        const sql2 = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            setSqlForTests(sql1);
            const p1 = hit(key, WINDOW_MS);
            setSqlForTests(sql2);
            const p2 = hit(key, WINDOW_MS);
            const [a, b] = await Promise.all([p1, p2]);
            const counts = [a.count, b.count].sort((x, y) => x - y);
            expect(counts).toEqual([1, 2]);
        } finally {
            await sql1.close();
            await sql2.close();
            setSqlForTests(getCtx().sql);
        }
    });

    test("loadBan saveBan clearBan round trip", async () => {
        const ip = "203.0.113.1";
        const entry = banEntry({ strikes: 3, escalation: 1, bannedUntil: 0 });
        await saveBan(ip, entry);
        expect(await loadBan(ip)).toEqual(entry);
        await clearBan(ip);
        expect(await loadBan(ip)).toBeNull();
    });

    test("withBanLock serialises concurrent updates", async () => {
        const { pg } = getCtx();
        const ip = "203.0.113.9";
        const sqlA = new SQL(pg.url, { prepare: false, max: 1 });
        const sqlB = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const runLocked = async (sql: SQL) => {
                setSqlForTests(sql);
                return withBanLock(ip, async (existing) => {
                    const base = existing ?? banEntry();
                    const next = {
                        ...base,
                        strikes: base.strikes + 1,
                        lastFailureAt: Date.now(),
                    };
                    await saveBan(ip, next);
                    return next.strikes;
                });
            };
            setSqlForTests(sqlA);
            const pA = runLocked(sqlA);
            setSqlForTests(sqlB);
            const pB = runLocked(sqlB);
            const [a, b] = await Promise.all([pA, pB]);
            expect([a, b].sort()).toEqual([1, 2]);
            expect((await loadBan(ip))?.strikes).toBe(2);
        } finally {
            await sqlA.close();
            await sqlB.close();
            setSqlForTests(getCtx().sql);
        }
    });

    test("sweepStale drops old buckets and idle bans", async () => {
        const { sql } = getCtx();
        const key = "sweep-key";
        const ip = "203.0.113.2";
        await hit(key, WINDOW_MS);
        await saveBan(ip, banEntry({ strikes: 1, bannedUntil: 0 }));

        await sql`
            update public.rate_limit_buckets
            set window_start = now() - interval '2 hours'
            where key = ${key}
        `;
        await sql`
            update public.auth_bans
            set
                last_failure_at = now()
                    - (${ESCALATION_DECAY_MS}::double precision / 1000
                        * interval '1 second')
                    - interval '1 minute',
                banned_until = null
            where ip_key = ${ip}
        `;

        const swept = await sweepStale(WINDOW_MS);
        expect(swept.buckets).toBe(1);
        expect(swept.bans).toBe(1);
    });

    test("sweepStale keeps live bans", async () => {
        const { sql } = getCtx();
        const ip = "203.0.113.3";
        const until = new Date(Date.now() + 60_000).toISOString();
        await sql`
            insert into public.auth_bans (
                ip_key,
                strikes,
                escalation,
                last_failure_at,
                banned_until
            )
            values (
                ${ip},
                0,
                1,
                now() - interval '12 hours',
                ${until}::timestamptz
            )
        `;
        const swept = await sweepStale(WINDOW_MS);
        expect(swept.bans).toBe(0);
        expect(await loadBan(ip)).not.toBeNull();
    });
});
