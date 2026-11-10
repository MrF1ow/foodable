import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import {
    clearBan,
    dbNow,
    loadBan,
    readBan,
    saveBan,
    sweepStale,
    takeSlot,
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

    test("takeSlot counts requests in the current second", async () => {
        const key = "user:1";
        const at = Date.parse("2026-01-01T00:00:10.250Z");
        const first = await takeSlot(key, 60, WINDOW_MS, at);
        const second = await takeSlot(key, 60, WINDOW_MS, at + 500);
        expect(first).toEqual({
            nowMs: at,
            others: 0,
            taken: 1,
            oldestMs: Date.parse("2026-01-01T00:00:10Z"),
        });
        expect(second.taken).toBe(2);
        const third = await takeSlot(key, 60, WINDOW_MS, at + 1000);
        expect(third.others).toBe(2);
        expect(third.taken).toBe(1);
    });

    test("takeSlot refuses without counting once the window is full", async () => {
        const { sql } = getCtx();
        const key = "full-key";
        const at = Date.parse("2026-01-01T00:00:00Z");
        for (let i = 0; i < 3; i++) await takeSlot(key, 3, WINDOW_MS, at);
        const refused = await takeSlot(key, 3, WINDOW_MS, at + 30_000);
        expect(refused.taken).toBeNull();
        expect(refused.others).toBe(3);
        expect(refused.oldestMs).toBe(at);
        const [row] = await sql`
            select coalesce(sum(count), 0)::int as total
            from public.rate_limit_buckets
            where key = ${key}
        `;
        expect(row.total).toBe(3);
        // A second whose start is no longer inside the window stops counting.
        const later = await takeSlot(key, 3, WINDOW_MS, at + 60_000);
        expect(later.others).toBe(0);
        expect(later.taken).toBe(1);
    });

    test("concurrent takeSlot calls on the same key return distinct counts", async () => {
        const { pg } = getCtx();
        const key = "race-key";
        const sql1 = new SQL(pg.url, { prepare: false, max: 1 });
        const sql2 = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            setSqlForTests(sql1);
            const p1 = takeSlot(key, 60, WINDOW_MS);
            setSqlForTests(sql2);
            const p2 = takeSlot(key, 60, WINDOW_MS);
            const [a, b] = await Promise.all([p1, p2]);
            const counts = [a.taken! + a.others, b.taken! + b.others].sort(
                (x, y) => x - y,
            );
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
                return withBanLock(
                    ip,
                    async (existing, now) => {
                        const base = existing ?? banEntry();
                        const next = {
                            ...base,
                            strikes: base.strikes + 1,
                            lastFailureAt: now,
                        };
                        return { entry: next, result: next.strikes };
                    },
                    { create: true },
                );
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

    test("withBanLock without create leaves a missing row missing", async () => {
        const ip = "203.0.113.10";
        const seen = await withBanLock(
            ip,
            async (existing) => ({ entry: null, result: existing }),
            { create: false },
        );
        expect(seen).toBeNull();
        expect(await loadBan(ip)).toBeNull();
    });

    test("withBanLock with create starts from an empty entry at the given time", async () => {
        const ip = "203.0.113.11";
        const at = Date.parse("2026-01-01T00:00:00.123Z");
        const seen = await withBanLock(
            ip,
            async (existing, now) => ({
                entry: null,
                result: { existing, now },
            }),
            { create: true, nowMs: at },
        );
        expect(seen).toEqual({
            existing: {
                strikes: 0,
                escalation: 0,
                lastFailureAt: at,
                bannedUntil: 0,
            },
            now: at,
        });
        // Returning null deletes the placeholder again.
        expect(await loadBan(ip)).toBeNull();
    });

    test("readBan reports the row and the time it was read at", async () => {
        const ip = "203.0.113.12";
        const at = Date.parse("2026-01-01T00:00:00Z");
        expect(await readBan(ip, at)).toEqual({ entry: null, nowMs: at });
        const entry = banEntry({ strikes: 2, bannedUntil: at + 60_000 });
        await saveBan(ip, entry);
        expect(await readBan(ip, at)).toEqual({ entry, nowMs: at });
    });

    test("sweepStale drops old buckets and idle bans", async () => {
        const { sql } = getCtx();
        const key = "sweep-key";
        const ip = "203.0.113.2";
        await takeSlot(key, 60, WINDOW_MS);
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
    test("racing requests in different seconds never both take the last slot", async () => {
        const { pg } = getCtx();
        const t0 = Date.parse("2026-01-01T00:00:00.000Z");
        for (let run = 0; run < 10; run++) {
            const key = `cross-second-${run}`;
            const conns = [0, 1].map(
                () => new SQL(pg.url, { prepare: false, max: 1 }),
            );
            try {
                const results = await Promise.all(
                    conns.map((conn, i) => {
                        setSqlForTests(conn);
                        return takeSlot(key, 1, WINDOW_MS, t0 + i * 1000);
                    }),
                );
                const taken = results.filter((r) => r.taken !== null);
                expect(taken.length).toBe(1);
            } finally {
                setSqlForTests(getCtx().sql);
                await Promise.all(conns.map((conn) => conn.close()));
            }
        }
    });
});
