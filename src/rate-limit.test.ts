import { SQL } from "bun";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    setSystemTime,
    spyOn,
    test,
} from "bun:test";
import { findPgBin } from "./db/testing/pg-temp.js";
import { describeDb } from "./db/testing/pg.js";
import { setSqlForTests } from "./db/sql.js";
import {
    _resetBuckets,
    BanStoreUnavailableError,
    checkAuthRateLimit,
    checkRateLimit,
    checkShareRateLimit,
    checkWebSearchRateLimit,
    clearAuthFailures,
    createMemoryRateLimitStore,
    createPostgresRateLimitStore,
    getBanState,
    noteAuthFailure,
    setRateLimitStore,
    slotCheckResult,
} from "./rate-limit.js";

const T0 = new Date("2026-01-01T00:00:00Z").getTime();
const MINUTE = 60_000;

const pgAvailable = await findPgBin();

type Clock = {
    at: (ms: number) => void;
    advance: (ms: number) => void;
};

function registerSharedRateLimitTests(bindClock: () => Clock) {
    let clock: Clock;

    async function fail(ip: string, times: number) {
        let last = { banned: false } as Awaited<
            ReturnType<typeof noteAuthFailure>
        >;
        for (let i = 0; i < times; i++) {
            last = await noteAuthFailure(ip);
        }
        return last;
    }

    beforeEach(async () => {
        clock = bindClock();
        await _resetBuckets();
        clock.at(T0);
    });

    test("19 consecutive failures do not ban, the 20th does", async () => {
        const ip = "203.0.113.7";
        for (let i = 0; i < 19; i++) {
            expect((await noteAuthFailure(ip)).banned).toBe(false);
        }
        expect((await getBanState(ip)).banned).toBe(false);

        const twentieth = await noteAuthFailure(ip);
        expect(twentieth.banned).toBe(true);
        expect(twentieth.retryAfterSeconds).toBe(5 * 60);
        expect((await getBanState(ip)).banned).toBe(true);
    });

    test("a success resets the run, so a shared NAT IP never accumulates a ban", async () => {
        const ip = "198.51.100.42";
        for (let round = 0; round < 10; round++) {
            expect((await fail(ip, 19)).banned).toBe(false);
            await clearAuthFailures(ip);
            expect((await getBanState(ip)).banned).toBe(false);
        }
        expect((await getBanState(ip)).banned).toBe(false);

        expect((await fail(ip, 19)).banned).toBe(false);
    });

    test("clearAuthFailures lifts an active ban", async () => {
        const ip = "198.51.100.9";
        expect((await fail(ip, 20)).banned).toBe(true);

        await clearAuthFailures(ip);
        expect((await getBanState(ip)).banned).toBe(false);
        expect((await fail(ip, 19)).banned).toBe(false);
    });

    test("ban durations escalate 5, 10, 20, 40, 60, then cap at 60 minutes", async () => {
        const ip = "203.0.113.99";
        const expectedMinutes = [5, 10, 20, 40, 60, 60];

        for (const minutes of expectedMinutes) {
            const result = await fail(ip, 20);
            expect(result.banned).toBe(true);
            expect(result.retryAfterSeconds).toBe(minutes * 60);

            clock.advance(minutes * MINUTE + 1000);
            expect((await getBanState(ip)).banned).toBe(false);
        }
    });

    test("the ban lifts once its duration elapses", async () => {
        const ip = "203.0.113.11";
        expect((await fail(ip, 20)).banned).toBe(true);

        clock.advance(5 * MINUTE - 1000);
        expect((await getBanState(ip)).banned).toBe(true);

        clock.advance(1000);
        expect((await getBanState(ip)).banned).toBe(false);
        expect((await noteAuthFailure(ip)).banned).toBe(false);
    });

    test("hammering while banned does not extend the ban", async () => {
        const ip = "203.0.113.12";
        expect((await fail(ip, 20)).banned).toBe(true);

        for (let i = 0; i < 5; i++) {
            clock.advance(30_000);
            const result = await fail(ip, 100);
            expect(result.banned).toBe(true);
            expect(result.retryAfterSeconds).toBe(5 * 60 - (i + 1) * 30);
        }

        clock.advance(2.5 * MINUTE + 1000);
        expect((await getBanState(ip)).banned).toBe(false);
    });

    test("strikes decay after 10 idle minutes", async () => {
        const ip = "203.0.113.13";
        expect((await fail(ip, 19)).banned).toBe(false);

        clock.advance(10 * MINUTE);
        expect((await fail(ip, 19)).banned).toBe(false);
        expect((await noteAuthFailure(ip)).banned).toBe(true);
    });

    test("a slow trickle of failures never trips a ban", async () => {
        const ip = "203.0.113.14";
        for (let i = 0; i < 100; i++) {
            expect((await noteAuthFailure(ip)).banned).toBe(false);
            clock.advance(11 * MINUTE);
        }
    });

    test("retryAfterSeconds counts down accurately and never drops below 1", async () => {
        const ip = "203.0.113.15";
        expect((await fail(ip, 20)).retryAfterSeconds).toBe(5 * 60);

        clock.advance(60_000);
        expect((await getBanState(ip)).retryAfterSeconds).toBe(4 * 60);

        clock.advance(3 * MINUTE + 59_500);
        expect((await getBanState(ip)).retryAfterSeconds).toBe(1);

        clock.advance(499);
        expect((await getBanState(ip)).retryAfterSeconds).toBe(1);

        clock.advance(1);
        expect((await getBanState(ip)).banned).toBe(false);
        expect((await getBanState(ip)).retryAfterSeconds).toBeUndefined();
    });

    test("getBanState is read-only and does not count as an attempt", async () => {
        const ip = "203.0.113.16";
        await fail(ip, 19);
        for (let i = 0; i < 50; i++) {
            expect((await getBanState(ip)).banned).toBe(false);
        }
        expect((await noteAuthFailure(ip)).banned).toBe(true);
    });

    test("bans are per-IP and independent", async () => {
        const banned = "203.0.113.20";
        const innocent = "203.0.113.21";

        await fail(innocent, 15);
        expect((await fail(banned, 20)).banned).toBe(true);

        expect((await getBanState(innocent)).banned).toBe(false);
        expect((await fail(innocent, 4)).banned).toBe(false);
        expect((await getBanState(banned)).banned).toBe(true);

        expect((await noteAuthFailure(innocent)).retryAfterSeconds).toBe(
            5 * 60,
        );
    });

    test("escalation decays after 6 quiet hours", async () => {
        const ip = "203.0.113.22";
        expect((await fail(ip, 20)).retryAfterSeconds).toBe(5 * 60);
        clock.advance(5 * MINUTE + 1000);
        expect((await fail(ip, 20)).retryAfterSeconds).toBe(10 * 60);

        clock.advance(6 * 60 * MINUTE);
        expect((await fail(ip, 20)).retryAfterSeconds).toBe(5 * 60);
    });

    test("unknown IPs report no ban", async () => {
        expect(await getBanState("203.0.113.30")).toEqual({ banned: false });
        await clearAuthFailures("203.0.113.30");
        expect((await getBanState("203.0.113.30")).banned).toBe(false);
    });

    test("checkRateLimit allows 60 requests per user per minute, then blocks", async () => {
        const user = "user-abc";
        for (let i = 0; i < 60; i++) {
            const result = await checkRateLimit(user);
            expect(result.allowed).toBe(true);
            expect(result.limit).toBe(60);
            expect(result.remaining).toBe(59 - i);
        }

        const blocked = await checkRateLimit(user);
        expect(blocked.allowed).toBe(false);
        expect(blocked.remaining).toBe(0);
        expect(blocked.retryAfterSeconds).toBe(60);

        clock.advance(60_000);
        expect((await checkRateLimit(user)).allowed).toBe(true);
    });

    test("checkShareRateLimit is its own per-IP bucket: 60 a minute, then blocks", async () => {
        const ip = "203.0.113.50";
        for (let i = 0; i < 60; i++) {
            const result = await checkShareRateLimit(ip);
            expect(result.allowed).toBe(true);
        }
        const blocked = await checkShareRateLimit(ip);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
        // not the sign-in bucket, and other IPs are untouched
        expect((await checkAuthRateLimit(ip)).allowed).toBe(true);
        expect((await checkShareRateLimit("203.0.113.51")).allowed).toBe(true);
    });

    test("checkAuthRateLimit allows 30 requests per IP per minute, then blocks", async () => {
        const ip = "203.0.113.40";
        for (let i = 0; i < 30; i++) {
            const result = await checkAuthRateLimit(ip);
            expect(result.allowed).toBe(true);
            expect(result.limit).toBe(30);
        }
        expect((await checkAuthRateLimit(ip)).allowed).toBe(false);

        expect((await checkAuthRateLimit("203.0.113.41")).allowed).toBe(true);
        expect((await checkRateLimit(ip)).allowed).toBe(true);
    });

    test("window boundaries: a full minute is denied until its requests age out", async () => {
        const user = "edge-user";
        for (let i = 0; i < 60; i++) {
            expect((await checkRateLimit(user)).allowed).toBe(true);
        }

        // +0 s: full, and the oldest request leaves in a minute.
        let r = await checkRateLimit(user);
        expect(r).toEqual({
            allowed: false,
            retryAfterSeconds: 60,
            remaining: 0,
            limit: 60,
        });

        // +59.9 s: still full; Retry-After rounds up to 1, never 0.
        clock.at(T0 + 59_900);
        r = await checkRateLimit(user);
        expect(r.allowed).toBe(false);
        expect(r.retryAfterSeconds).toBe(1);

        // +60 s: the first minute's requests have left the window, and the
        // refused ones above were never counted.
        clock.at(T0 + 60_000);
        r = await checkRateLimit(user);
        expect(r).toEqual({ allowed: true, remaining: 59, limit: 60 });

        clock.at(T0 + 61_000);
        r = await checkRateLimit(user);
        expect(r).toEqual({ allowed: true, remaining: 58, limit: 60 });

        clock.at(T0 + 119_000);
        r = await checkRateLimit(user);
        expect(r).toEqual({ allowed: true, remaining: 57, limit: 60 });
        for (let i = 0; i < 57; i++) {
            expect((await checkRateLimit(user)).allowed).toBe(true);
        }
        r = await checkRateLimit(user);
        expect(r.allowed).toBe(false);
        // The oldest counted request (+60 s) leaves at +120 s.
        expect(r.retryAfterSeconds).toBe(1);

        clock.at(T0 + 120_000);
        r = await checkRateLimit(user);
        expect(r).toEqual({ allowed: true, remaining: 0, limit: 60 });
        r = await checkRateLimit(user);
        expect(r.allowed).toBe(false);
        expect(r.retryAfterSeconds).toBe(1);
    });

    test("the auth limit reopens after a minute with a sane Retry-After", async () => {
        const ip = "203.0.113.60";
        for (let i = 0; i < 30; i++) await checkAuthRateLimit(ip);
        expect((await checkAuthRateLimit(ip)).retryAfterSeconds).toBe(60);

        clock.at(T0 + 61_000);
        const reopened = await checkAuthRateLimit(ip);
        expect(reopened).toEqual({ allowed: true, remaining: 29, limit: 30 });
        for (let i = 0; i < 29; i++) await checkAuthRateLimit(ip);
        const full = await checkAuthRateLimit(ip);
        expect(full.allowed).toBe(false);
        expect(full.retryAfterSeconds).toBe(60);
    });

    test("refused requests do not count against the window", async () => {
        const user = "hammer-user";
        for (let i = 0; i < 60; i++) await checkRateLimit(user);
        clock.at(T0 + 30_000);
        for (let i = 0; i < 200; i++) {
            expect((await checkRateLimit(user)).allowed).toBe(false);
        }
        clock.at(T0 + 60_000);
        expect((await checkRateLimit(user)).remaining).toBe(59);
    });

    test("checkWebSearchRateLimit is independent of checkRateLimit", async () => {
        const user = "user-web";
        for (let i = 0; i < 60; i++) {
            expect((await checkRateLimit(user)).allowed).toBe(true);
        }
        expect((await checkRateLimit(user)).allowed).toBe(false);
        for (let i = 0; i < 120; i++) {
            const result = await checkWebSearchRateLimit(user);
            expect(result.allowed).toBe(true);
            if (i === 0) expect(result.limit).toBe(120);
        }
        expect((await checkWebSearchRateLimit(user)).allowed).toBe(false);
        expect((await checkRateLimit(user)).allowed).toBe(false);
    });

    test("_resetBuckets clears rate-limit windows and ban state together", async () => {
        const ip = "203.0.113.50";
        for (let i = 0; i < 30; i++) await checkAuthRateLimit(ip);
        expect((await checkAuthRateLimit(ip)).allowed).toBe(false);
        expect((await fail(ip, 20)).banned).toBe(true);

        await _resetBuckets();

        expect((await checkAuthRateLimit(ip)).allowed).toBe(true);
        expect((await getBanState(ip)).banned).toBe(false);
    });
}

let memoryNow = T0;

describe("rate limits (memory store)", () => {
    beforeEach(() => {
        setRateLimitStore(createMemoryRateLimitStore({ now: () => memoryNow }));
    });

    afterEach(() => {
        setSystemTime();
    });

    registerSharedRateLimitTests(() => ({
        at(ms: number) {
            memoryNow = ms;
            setSystemTime(new Date(memoryNow));
        },
        advance(ms: number) {
            memoryNow += ms;
            setSystemTime(new Date(memoryNow));
        },
    }));
});

describeDb(pgAvailable !== null, "rate limits (postgres store)", (getCtx) => {
    let pgNow = T0;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setRateLimitStore(createPostgresRateLimitStore({ now: () => pgNow }));
    });

    afterEach(() => {
        setSqlForTests(null);
        memoryNow = T0;
        setRateLimitStore(createMemoryRateLimitStore({ now: () => memoryNow }));
    });

    registerSharedRateLimitTests(() => ({
        at(ms: number) {
            pgNow = ms;
        },
        advance(ms: number) {
            pgNow += ms;
        },
    }));

    test("exhausting a limit through one store is visible on another", async () => {
        const user = "shared-user";
        const storeA = createPostgresRateLimitStore({ now: () => pgNow });
        const storeB = createPostgresRateLimitStore({ now: () => pgNow });

        setRateLimitStore(storeA);
        for (let i = 0; i < 60; i++) {
            expect((await checkRateLimit(user)).allowed).toBe(true);
        }
        expect((await checkRateLimit(user)).allowed).toBe(false);

        setRateLimitStore(storeB);
        expect((await checkRateLimit(user)).allowed).toBe(false);
    });

    test("a ban tripped through one store is enforced by another", async () => {
        const ip = "203.0.113.70";
        setRateLimitStore(createPostgresRateLimitStore({ now: () => pgNow }));
        for (let i = 0; i < 20; i++) await noteAuthFailure(ip);
        setRateLimitStore(createPostgresRateLimitStore({ now: () => pgNow }));
        expect(await getBanState(ip)).toEqual({
            banned: true,
            retryAfterSeconds: 5 * 60,
        });
    });

    test("instances racing for the last slot never both get it", async () => {
        const { pg } = getCtx();
        const user = "race-user";
        for (let i = 0; i < 58; i++) await checkRateLimit(user);

        const conns = Array.from(
            { length: 6 },
            () => new SQL(pg.url, { prepare: false, max: 1 }),
        );
        try {
            const results = await Promise.all(
                conns.map((conn) => {
                    setSqlForTests(conn);
                    return checkRateLimit(user);
                }),
            );
            const allowed = results.filter((r) => r.allowed).length;
            expect(allowed).toBe(2);
        } finally {
            setSqlForTests(getCtx().sql);
            await Promise.all(conns.map((conn) => conn.close()));
        }
        expect((await checkRateLimit(user)).allowed).toBe(false);
    });

    test("without a pinned clock, the window follows Postgres time", async () => {
        setRateLimitStore(createPostgresRateLimitStore());
        const first = await checkRateLimit("live-user");
        expect(first).toEqual({ allowed: true, remaining: 59, limit: 60 });
        const { sql } = getCtx();
        const [row] = await sql`
            select extract(epoch from now() - window_start) as age
            from public.rate_limit_buckets
            where key = 'user:live-user'
        `;
        expect(Number(row.age)).toBeGreaterThanOrEqual(0);
        expect(Number(row.age)).toBeLessThan(5);
    });

    // The Postgres window is counted per second: a request part-way through a
    // second leaves the window up to one second earlier than the memory
    // store's exact log would let it.
    test("requests within a second age out with that second", async () => {
        const user = "subsecond-user";
        pgNow = T0 + 500;
        for (let i = 0; i < 60; i++) await checkRateLimit(user);
        pgNow = T0 + 59_999;
        expect((await checkRateLimit(user)).allowed).toBe(false);
        pgNow = T0 + 60_000;
        expect((await checkRateLimit(user)).allowed).toBe(true);
    });

    test("database errors fail open on bucket checks", async () => {
        setRateLimitStore(createPostgresRateLimitStore());
        setSqlForTests(null);
        const errors = spyOn(console, "error").mockImplementation(() => {});
        const prevUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            expect(await checkRateLimit("user-x")).toEqual({
                allowed: true,
                remaining: 60,
                limit: 60,
            });
            expect(await checkAuthRateLimit("203.0.113.80")).toEqual({
                allowed: true,
                remaining: 30,
                limit: 30,
            });
            expect(errors).toHaveBeenCalled();
        } finally {
            if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
            errors.mockRestore();
        }
    });

    test("database errors fail closed on bans", async () => {
        setRateLimitStore(createPostgresRateLimitStore());
        setSqlForTests(null);
        const errors = spyOn(console, "error").mockImplementation(() => {});
        const prevUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        try {
            await expect(getBanState("203.0.113.81")).rejects.toBeInstanceOf(
                BanStoreUnavailableError,
            );
            await expect(
                noteAuthFailure("203.0.113.81"),
            ).rejects.toBeInstanceOf(BanStoreUnavailableError);
            // A success that cannot clear strikes is logged, not raised.
            await clearAuthFailures("203.0.113.81");
            expect(errors).toHaveBeenCalled();
        } finally {
            if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
            errors.mockRestore();
        }
    });
});

describe("slotCheckResult", () => {
    const base = { nowMs: T0, others: 0, taken: 1, oldestMs: T0 };

    test("an allowed check reports what is left of the window", () => {
        expect(
            slotCheckResult({ ...base, others: 40, taken: 5 }, 60, MINUTE),
        ).toEqual({ allowed: true, remaining: 15, limit: 60 });
    });

    test("a refused check waits for the oldest second to leave", () => {
        expect(
            slotCheckResult(
                { ...base, taken: null, nowMs: T0 + 59_900 },
                60,
                MINUTE,
            ),
        ).toEqual({
            allowed: false,
            retryAfterSeconds: 1,
            remaining: 0,
            limit: 60,
        });
        expect(
            slotCheckResult({ ...base, taken: null }, 60, MINUTE)
                .retryAfterSeconds,
        ).toBe(60);
    });
});
