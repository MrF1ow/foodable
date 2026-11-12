import {
    test,
    expect,
    mock,
    beforeEach,
    afterEach,
    afterAll,
    beforeAll,
    spyOn,
} from "bun:test";
import { setClientIpConfigForTests } from "./client-ip.js";
import { Hono } from "hono";
import * as actualTokens from "./db/tokens.js";
import * as actualTokenUse from "./token-use.js";
import * as householdDb from "./db/household.js";

// Snapshot before mocking — restoring from the live namespace is a no-op
// because Bun patches it in place (see mcp.test.ts).
const realTokens = { ...actualTokens };

// middleware.ts only reaches the db to resolve a bearer token, so stubbing
// that one export is enough to exercise the whole auth path offline. Counting
// the calls also lets us prove a banned IP is shed *before* any token lookup.
//
// mock.module swaps the module for the whole test *process*, not just this
// file, so the real exports must be spread back in — replacing the module
// wholesale breaks every other suite that imports lookupBearer — and restored
// afterwards so no later file sees the stub.
let tokenLookups = 0;
let tokenStoreAvailable = true;
mock.module("./db/tokens.js", () => ({
    ...actualTokens,
    lookupBearer: async (token: string) => {
        tokenLookups++;
        if (!tokenStoreAvailable) return { status: "unavailable" };
        // An OAuth token issued to a registered app that was never used.
        if (token === "app-token") {
            return {
                status: "valid",
                kind: "user",
                userId: "user-1",
                clientId: "client-1",
                clientName: "Claude",
                lastUsedAt: null,
            };
        }
        // An OAuth token issued before clients were recorded, used a minute ago.
        if (token === "recent-token") {
            return {
                status: "valid",
                kind: "user",
                userId: "user-1",
                clientId: null,
                clientName: null,
                lastUsedAt: new Date(Date.now() - 60_000),
            };
        }
        return token === "valid-token"
            ? { status: "valid", kind: "user", userId: "user-1" }
            : token === "hh-token"
              ? { status: "valid", kind: "household", householdId: "hh-1" }
              : { status: "invalid" };
    },
}));

// The recorder the bearer check uses, wired to a store that only counts. A
// fresh one per test file run keeps its memory of recent writes out of other
// suites that import token-use for real.
const realTokenUse = { ...actualTokenUse };
const touchedTokens: string[] = [];
mock.module("./token-use.js", () => ({
    ...actualTokenUse,
    recordTokenUse: actualTokenUse.createTokenUseRecorder({
        now: () => new Date(),
        touch: async (token: string) => {
            touchedTokens.push(token);
            return true;
        },
    }),
}));
afterAll(() => {
    mock.module("./db/tokens.js", () => realTokens);
    mock.module("./token-use.js", () => realTokenUse);
});

const testClientIpConfig = {
    source: "x-forwarded-for" as const,
    sourceIsDefault: false,
    trustedHops: 1,
    cloudflareOriginSecret: null,
};

const { authenticateBearer, banRepeatAuthFailures, rateLimit } =
    await import("./middleware.js");
const { _resetBuckets, createMemoryRateLimitStore, setRateLimitStore } =
    await import("./rate-limit.js");
type RateLimitStore = import("./rate-limit.js").RateLimitStore;

// A memory store whose ban reads or writes can be switched to fail, standing
// in for a database outage on the ban table.
function flakyBanStore(fail: { read: boolean; write: boolean }) {
    const inner = createMemoryRateLimitStore();
    const store: RateLimitStore = {
        checkBucket: (key, limit, windowMs) =>
            inner.checkBucket(key, limit, windowMs),
        readBan: async (ip) => {
            if (fail.read) throw new Error("connection refused");
            return inner.readBan(ip);
        },
        updateBan: async (ip, fn, opts) => {
            if (fail.write) throw new Error("connection refused");
            return inner.updateBan(ip, fn, opts);
        },
        reset: () => inner.reset(),
    };
    return store;
}

// Mirrors the /mcp wiring in index.ts: the ban guard runs ahead of the bearer
// check, and the outermost access log honours the suppression flag. Replicated
// rather than importing index.ts, which boots a server and warms widgets on
// import; the ordering asserted here is the thing that matters.
function buildApp() {
    const app = new Hono();
    const logs: string[] = [];
    app.use("*", async (c, next) => {
        await next();
        if (c.get("suppressAccessLog")) return;
        logs.push(`[req] ${c.req.method} ${c.req.path} ${c.res.status}`);
    });
    app.all("/mcp", banRepeatAuthFailures, authenticateBearer, rateLimit, (c) =>
        c.json({ ok: true, auth: c.get("authContext") ?? null }),
    );
    app.all("/client", banRepeatAuthFailures, authenticateBearer, (c) =>
        c.json({ client: c.get("tokenClient") ?? null }),
    );
    return { app, logs };
}

const from = (ip: string, token?: string, path = "/mcp") =>
    new Request(`http://localhost${path}`, {
        method: "POST",
        headers: {
            "x-forwarded-for": ip,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

const fromXff = (xff: string, token?: string) =>
    new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
            "x-forwarded-for": xff,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });

beforeAll(() => setClientIpConfigForTests(testClientIpConfig));
afterAll(() => setClientIpConfigForTests(null));

beforeEach(async () => {
    await _resetBuckets();
    touchedTokens.length = 0;
    tokenLookups = 0;
    tokenStoreAvailable = true;
    setClientIpConfigForTests(testClientIpConfig);
    spyOn(householdDb, "getHouseholdMembership").mockResolvedValue(null);
});
afterEach(async () => {
    await _resetBuckets();
    spyOn(householdDb, "getHouseholdMembership").mockRestore();
});

test("unauthenticated /mcp is shed with 429 after the strike threshold", async () => {
    const { app } = buildApp();

    // The 20th failure trips the ban, but that request is already past the
    // guard, so it still answers 401. Only the next one is shed.
    for (let i = 0; i < 20; i++) {
        expect((await app.fetch(from("1.2.3.4"))).status).toBe(401);
    }

    const shed = await app.fetch(from("1.2.3.4"));
    expect(shed.status).toBe(429);
    expect(Number(shed.headers.get("Retry-After"))).toBeGreaterThan(0);
});

test("shed requests are kept out of the access log", async () => {
    const { app, logs } = buildApp();
    for (let i = 0; i < 20; i++) await app.fetch(from("5.6.7.8"));
    const beforeShedding = logs.length;

    for (let i = 0; i < 50; i++) await app.fetch(from("5.6.7.8"));

    // All 20 pre-ban 401s are logged; none of the 50 shed requests are. This is
    // the whole point of the change — one stuck client must not drown the log.
    expect(beforeShedding).toBe(20);
    expect(logs.length).toBe(20);
});

test("a newly tripped ban is announced exactly once", async () => {
    const { app } = buildApp();
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    try {
        for (let i = 0; i < 60; i++) await app.fetch(from("9.9.9.9"));
        const banLines = logSpy.mock.calls
            .map((args) => String(args[0]))
            .filter((line) => line.startsWith("[ban]"));
        expect(banLines).toHaveLength(1);
        // Masked to the same subnet granularity as the [req] access log.
        expect(banLines[0]).toContain("9.9.9.x");
    } finally {
        logSpy.mockRestore();
    }
});

test("a banned IP is shed without a token lookup", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 20; i++) await app.fetch(from("4.4.4.4", "bad-token"));
    const lookupsBeforeBan = tokenLookups;

    for (let i = 0; i < 25; i++) await app.fetch(from("4.4.4.4", "bad-token"));

    // Shedding happens ahead of authenticateBearer, so the database round trip
    // the ban is meant to save is genuinely never made.
    expect(lookupsBeforeBan).toBe(20);
    expect(tokenLookups).toBe(20);
});

test("a success resets strikes, so a shared IP is never banned", async () => {
    const { app } = buildApp();

    // The NAT case end-to-end: one broken client failing repeatedly alongside a
    // working one. Total failures far exceed the threshold, but never 20 in a
    // row, so the healthy users behind that egress IP keep working.
    for (let round = 0; round < 5; round++) {
        for (let i = 0; i < 19; i++) {
            expect((await app.fetch(from("7.7.7.7"))).status).toBe(401);
        }
        expect((await app.fetch(from("7.7.7.7", "valid-token"))).status).toBe(
            200,
        );
    }

    expect((await app.fetch(from("7.7.7.7"))).status).toBe(401);
});

test("a token lookup outage never bans anyone", async () => {
    const { app } = buildApp();
    tokenStoreAvailable = false;

    // Every token looks unverifiable while the database is down. If those
    // counted as strikes, the outage would ban the entire active user base and
    // keep them shed for 5-60 minutes after recovery.
    for (let i = 0; i < 100; i++) {
        expect((await app.fetch(from("3.3.3.3", "valid-token"))).status).toBe(
            401,
        );
    }

    tokenStoreAvailable = true;
    expect((await app.fetch(from("3.3.3.3", "valid-token"))).status).toBe(200);
});

test("an unreadable ban store answers 503 with Retry-After, before any token lookup", async () => {
    const fail = { read: true, write: false };
    setRateLimitStore(flakyBanStore(fail));
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
        const { app } = buildApp();
        for (const token of [undefined, "valid-token", "nope"]) {
            const res = await app.fetch(from("4.4.4.4", token));
            expect(res.status).toBe(503);
            expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
        }
        expect(tokenLookups).toBe(0);

        fail.read = false;
        expect((await app.fetch(from("4.4.4.4", "valid-token"))).status).toBe(
            200,
        );
    } finally {
        errors.mockRestore();
        setRateLimitStore(createMemoryRateLimitStore());
    }
});

test("a failed strike write answers 503, not 401", async () => {
    const fail = { read: false, write: true };
    setRateLimitStore(flakyBanStore(fail));
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
        const { app } = buildApp();
        const bad = await app.fetch(from("4.4.4.5", "nope"));
        expect(bad.status).toBe(503);
        expect(Number(bad.headers.get("Retry-After"))).toBeGreaterThan(0);
        expect((await app.fetch(from("4.4.4.5"))).status).toBe(503);

        // A valid token still gets through: clearing strikes is best effort.
        expect((await app.fetch(from("4.4.4.5", "valid-token"))).status).toBe(
            200,
        );

        fail.write = false;
        expect((await app.fetch(from("4.4.4.5", "nope"))).status).toBe(401);
    } finally {
        errors.mockRestore();
        setRateLimitStore(createMemoryRateLimitStore());
    }
});

test("bans are per-IP and do not affect other clients", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 21; i++) await app.fetch(from("8.8.8.8"));

    expect((await app.fetch(from("8.8.8.8"))).status).toBe(429);
    expect((await app.fetch(from("8.8.4.4"))).status).toBe(401);
    expect((await app.fetch(from("8.8.4.4", "valid-token"))).status).toBe(200);
});

test("OAuth still maps to its userId", async () => {
    const { app } = buildApp();
    const res = await app.fetch(from("10.0.0.1", "valid-token"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
        ok: true,
        auth: { kind: "user", userId: "user-1" },
    });
});

test("household PAT authenticates with no userId", async () => {
    const { app } = buildApp();
    const res = await app.fetch(from("10.0.0.2", "hh-token"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
        ok: true,
        auth: { kind: "household", householdId: "hh-1" },
    });
});

test("an unknown token is 401", async () => {
    const { app } = buildApp();
    expect((await app.fetch(from("10.0.0.3", "nope"))).status).toBe(401);
    expect((await app.fetch(from("10.0.0.3", "nt_hh_truncated"))).status).toBe(
        401,
    );
});

test("PAT traffic is rate-limited on householdId", async () => {
    const { app } = buildApp();
    const ip = "10.0.0.4";
    for (let i = 0; i < 60; i++) {
        expect((await app.fetch(from(ip, "hh-token"))).status).toBe(200);
    }
    expect((await app.fetch(from(ip, "hh-token"))).status).toBe(429);
    expect(
        (await app.fetch(from("10.0.0.5", "hh-token"))).status,
        "same household PAT shares the householdId bucket across IPs",
    ).toBe(429);
    expect((await app.fetch(from(ip, "valid-token"))).status).toBe(200);
});

test("rotating a forged left-most XFF entry does not escape a ban", async () => {
    const { app } = buildApp();
    const trusted = "11.22.33.44";
    for (let i = 0; i < 21; i++) {
        await app.fetch(fromXff(`9.9.9.${i}, ${trusted}`));
    }
    expect((await app.fetch(fromXff(`1.2.3.4, ${trusted}`))).status).toBe(429);
});

test("with x-real-ip source a forged XFF has no effect", async () => {
    setClientIpConfigForTests({
        source: "x-real-ip",
        sourceIsDefault: false,
        trustedHops: 1,
        cloudflareOriginSecret: null,
    });
    const { app } = buildApp();
    const req = (xff: string) =>
        new Request("http://localhost/mcp", {
            method: "POST",
            headers: {
                "x-real-ip": "55.66.77.88",
                "x-forwarded-for": xff,
            },
        });
    for (let i = 0; i < 21; i++) await app.fetch(req(`forged-${i}, ignored`));
    expect((await app.fetch(req("other-forged"))).status).toBe(429);
});

test("socket source without a Bun socket shares the unknown bucket", async () => {
    setClientIpConfigForTests({
        source: "socket",
        sourceIsDefault: false,
        trustedHops: 1,
        cloudflareOriginSecret: null,
    });
    const { app } = buildApp();
    for (let i = 0; i < 21; i++) {
        await app.fetch(
            new Request("http://localhost/mcp", {
                method: "POST",
                headers: { "x-forwarded-for": `1.2.3.${i}` },
            }),
        );
    }
    expect(
        (
            await app.fetch(
                new Request("http://localhost/mcp", {
                    method: "POST",
                    headers: { "x-forwarded-for": "9.9.9.9" },
                }),
            )
        ).status,
    ).toBe(429);
});

test("two IPv6 addresses in one /64 share a ban", async () => {
    setClientIpConfigForTests(testClientIpConfig);
    const { app } = buildApp();
    const prefix = "2001:db8:1:2";
    for (let i = 0; i < 21; i++) {
        await app.fetch(fromXff(`${prefix}::${i + 1}`));
    }
    expect((await app.fetch(fromXff(`${prefix}::beef`))).status).toBe(429);
});

test("two appended X-Forwarded-For headers pick the right-most trusted hop", async () => {
    setClientIpConfigForTests(testClientIpConfig);
    const { app } = buildApp();
    const post = (...xff: string[]) => {
        const headers = new Headers({ "content-type": "application/json" });
        for (const v of xff) headers.append("x-forwarded-for", v);
        return app.fetch(
            new Request("http://localhost/mcp", { method: "POST", headers }),
        );
    };
    for (let i = 0; i < 21; i++) await post("1.1.1.1", "203.0.113.90");
    // The strikes landed on the second header line, not the first.
    expect((await post("203.0.113.90")).status).toBe(429);
    expect((await post("1.1.1.1")).status).not.toBe(429);
});

test("an app's token names its client for the request and records its use once", async () => {
    const { app } = buildApp();

    const first = await app.fetch(from("2.2.2.2", "app-token"));
    expect(first.status).toBe(200);
    const named = await app.fetch(from("2.2.2.2", "app-token", "/client"));
    expect(await named.json()).toEqual({ client: "Claude" });
    // A second request in the same window reads "never used" again, because
    // the write is not awaited; the recorder still writes only once.
    expect((await app.fetch(from("2.2.2.2", "app-token"))).status).toBe(200);

    expect(touchedTokens).toEqual(["app-token"]);
});

test("a token used a minute ago is not written again", async () => {
    const { app } = buildApp();
    expect((await app.fetch(from("2.2.2.3", "recent-token"))).status).toBe(200);
    expect(touchedTokens).toEqual([]);
});

test("a token with no recorded client leaves the request's client unset", async () => {
    const { app } = buildApp();
    const res = await app.fetch(from("2.2.2.4", "recent-token", "/client"));
    expect(await res.json()).toEqual({ client: null });
});
