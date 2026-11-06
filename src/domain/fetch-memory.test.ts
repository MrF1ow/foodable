import { describe, expect, test } from "bun:test";
import {
    DEAD_404_DAYS,
    REFUSAL_DAYS,
    createCachedFetchMemory,
    createMemoryFetchMemoryStore,
    deadLinkExpiry,
    deadLinkHash,
    normalizeMemoryHost,
    refusalExpiry,
} from "./fetch-memory.js";

test("normalizeMemoryHost", () => {
    expect(normalizeMemoryHost("WWW.Example.COM.")).toBe("example.com");
    expect(normalizeMemoryHost("sub.Example.com")).toBe("sub.example.com");
});

test("deadLinkHash is stable 64 hex", () => {
    const u = "https://example.com/a?x=1";
    expect(deadLinkHash(u)).toMatch(/^[0-9a-f]{64}$/);
    expect(deadLinkHash(u)).toBe(deadLinkHash(u));
});

test("refusalExpiry and deadLinkExpiry", () => {
    const now = new Date("2026-06-01T12:00:00.000Z");
    expect(refusalExpiry(now).toISOString()).toBe("2026-06-08T12:00:00.000Z");
    expect(deadLinkExpiry(404, now)?.toISOString()).toBe(
        "2026-07-01T12:00:00.000Z",
    );
    expect(deadLinkExpiry(410, now)).toBeNull();
    expect(DEAD_404_DAYS).toBe(30);
    expect(REFUSAL_DAYS).toBe(7);
});

describe("memory store", () => {
    test("refusal round-trip and expiry", async () => {
        const s = createMemoryFetchMemoryStore();
        const hh = "11111111-1111-1111-1111-111111111111";
        const now = new Date("2026-01-01T00:00:00.000Z");
        await s.recordRefusal(hh, "example.com", 403, now);
        const row = await s.getRefusal(hh, "example.com", now);
        expect(row?.status).toBe(403);
        const later = new Date("2030-01-01T00:00:00.000Z");
        expect(await s.getRefusal(hh, "example.com", later)).toBeNull();
    });

    test("dead link 404 then 410 upgrade", async () => {
        const s = createMemoryFetchMemoryStore();
        const hh = "11111111-1111-1111-1111-111111111111";
        const now = new Date("2026-01-01T00:00:00.000Z");
        const h = deadLinkHash("https://ex.com/a");
        await s.recordDeadLink(hh, h, "https://ex.com/a", 404, now);
        const r404 = await s.getDeadLink(hh, h, now);
        expect(r404?.status).toBe(404);
        expect(r404?.expiresAt).not.toBeNull();
        await s.recordDeadLink(hh, h, "https://ex.com/a", 410, now);
        const r410 = await s.getDeadLink(hh, h, now);
        expect(r410?.status).toBe(410);
        expect(r410?.expiresAt).toBeNull();
        await s.recordDeadLink(
            hh,
            h,
            "https://ex.com/a",
            404,
            new Date("2026-06-01T00:00:00.000Z"),
        );
        const still = await s.getDeadLink(
            hh,
            h,
            new Date("2026-06-02T00:00:00.000Z"),
        );
        expect(still?.status).toBe(410);
    });

    test("listRefusals keyset", async () => {
        const s = createMemoryFetchMemoryStore();
        const hh = "11111111-1111-1111-1111-111111111111";
        const t0 = new Date("2026-01-01T00:00:00.000Z");
        await s.recordRefusal(hh, "a.com", 403, t0);
        await s.recordRefusal(
            hh,
            "b.com",
            401,
            new Date("2026-01-02T00:00:00.000Z"),
        );
        const first = await s.listRefusals(hh, {
            limit: 1,
            now: new Date("2026-01-05T00:00:00.000Z"),
        });
        expect(first).toHaveLength(1);
        const second = await s.listRefusals(hh, {
            limit: 10,
            after: { refusedAt: first[0]!.refusedAt, host: first[0]!.host },
            now: new Date("2026-01-05T00:00:00.000Z"),
        });
        expect(second).toHaveLength(1);
        expect(second[0]!.host).not.toBe(first[0]!.host);
    });
});

describe("cached fetch memory", () => {
    test("miss then hit uses store once", async () => {
        let getCalls = 0;
        const backing = createMemoryFetchMemoryStore();
        const hh = "11111111-1111-1111-1111-111111111111";
        const now = new Date("2026-01-01T00:00:00.000Z");
        await backing.recordRefusal(hh, "z.com", 403, now);
        const store = {
            ...backing,
            async getRefusal(id: string, host: string, d: Date) {
                getCalls += 1;
                return backing.getRefusal(id, host, d);
            },
        };
        let t = 0;
        const cached = createCachedFetchMemory(store, {
            ttlMs: 60_000,
            maxEntries: 100,
            now: () => t,
        });
        await cached.getRefusal(hh, "z.com", now);
        await cached.getRefusal(hh, "z.com", now);
        expect(getCalls).toBe(1);
    });

    test("TTL expiry refetches", async () => {
        let getCalls = 0;
        const backing = createMemoryFetchMemoryStore();
        const hh = "22222222-2222-2222-2222-222222222222";
        const now = new Date("2026-01-01T00:00:00.000Z");
        await backing.recordRefusal(hh, "y.com", 403, now);
        const store = {
            ...backing,
            async getRefusal(id: string, host: string, d: Date) {
                getCalls += 1;
                return backing.getRefusal(id, host, d);
            },
        };
        let t = 0;
        const cached = createCachedFetchMemory(store, {
            ttlMs: 1000,
            maxEntries: 100,
            now: () => t,
        });
        await cached.getRefusal(hh, "y.com", now);
        t = 2000;
        await cached.getRefusal(hh, "y.com", now);
        expect(getCalls).toBe(2);
    });

    test("row expires before TTL drops cache on read", async () => {
        const backing = createMemoryFetchMemoryStore();
        const hh = "33333333-3333-3333-3333-333333333333";
        const start = new Date("2026-01-01T00:00:00.000Z");
        await backing.recordRefusal(hh, "w.com", 403, start);
        let getCalls = 0;
        const store = {
            ...backing,
            async getRefusal(id: string, host: string, d: Date) {
                getCalls += 1;
                return backing.getRefusal(id, host, d);
            },
        };
        const cached = createCachedFetchMemory(store, {
            ttlMs: 1_000_000,
            maxEntries: 100,
            now: () => 0,
        });
        await cached.getRefusal(hh, "w.com", start);
        const after = new Date("2030-01-01T00:00:00.000Z");
        await cached.getRefusal(hh, "w.com", after);
        expect(getCalls).toBe(2);
    });

    test("LRU evicts oldest", async () => {
        const backing = createMemoryFetchMemoryStore();
        const hh = "44444444-4444-4444-4444-444444444444";
        const now = new Date("2026-01-01T00:00:00.000Z");
        for (let i = 0; i < 3; i++) {
            await backing.recordRefusal(
                hh,
                `h${i}.com`,
                403,
                new Date(now.getTime() + i * 1000),
            );
        }
        let n = 0;
        const counted = {
            ...backing,
            async getRefusal(id: string, host: string, d: Date) {
                n += 1;
                return backing.getRefusal(id, host, d);
            },
        };
        const cached = createCachedFetchMemory(counted, {
            ttlMs: 60_000,
            maxEntries: 2,
            now: () => 0,
        });
        await cached.getRefusal(hh, "h0.com", now);
        await cached.getRefusal(hh, "h1.com", now);
        await cached.getRefusal(hh, "h2.com", now);
        await cached.getRefusal(hh, "h0.com", now);
        expect(n).toBe(4);
    });
});
