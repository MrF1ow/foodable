import { describe, expect, test } from "bun:test";
import { USER_SEEN_INTERVAL_MS, createUserSeenRecorder } from "./last-seen.js";

const MINUTE = 60 * 1000;

// A clock the test moves by hand, and a store that behaves like the database
// guard: it writes only when the stored time is older than the interval.
function harness(opts: { failTouch?: () => boolean } = {}) {
    let now = new Date("2026-11-12T10:00:00.000Z").getTime();
    const stored = new Map<string, Date>();
    const writes: Array<{ userId: string; at: Date }> = [];
    const touch = async (userId: string, at: Date, interval: number) => {
        if (opts.failTouch?.()) throw new Error("connection refused");
        const prev = stored.get(userId);
        if (prev && prev.getTime() > at.getTime() - interval) return false;
        stored.set(userId, at);
        writes.push({ userId, at });
        return true;
    };
    const record = createUserSeenRecorder({ now: () => new Date(now), touch });
    return { record, writes, advance: (ms: number) => (now += ms) };
}

describe("user seen recorder", () => {
    test("two page views inside an hour write once", async () => {
        const h = harness();
        await h.record("u1");
        h.advance(59 * MINUTE);
        await h.record("u1");
        expect(h.writes).toHaveLength(1);
    });

    test("a page view after an hour writes again", async () => {
        const h = harness();
        await h.record("u1");
        h.advance(USER_SEEN_INTERVAL_MS);
        await h.record("u1");
        expect(h.writes).toHaveLength(2);
    });

    test("a burst of simultaneous views writes once", async () => {
        const h = harness();
        await Promise.all([h.record("u1"), h.record("u1"), h.record("u1")]);
        expect(h.writes).toHaveLength(1);
    });

    test("users are throttled independently", async () => {
        const h = harness();
        await h.record("a");
        await h.record("b");
        await h.record("a");
        expect(h.writes.map((w) => w.userId)).toEqual(["a", "b"]);
    });

    test("a failed write never rejects and the next view retries it", async () => {
        let fail = true;
        const h = harness({ failTouch: () => fail });
        await expect(h.record("u1")).resolves.toBeUndefined();
        expect(h.writes).toHaveLength(0);
        fail = false;
        await h.record("u1");
        expect(h.writes).toHaveLength(1);
    });

    test("the interval is one hour", () => {
        expect(USER_SEEN_INTERVAL_MS).toBe(60 * MINUTE);
    });
});
