import { describe, expect, test } from "bun:test";
import { TOKEN_USE_INTERVAL_MS, createTokenUseRecorder } from "./token-use.js";

const MINUTE = 60 * 1000;

// A clock the test moves by hand, and a store that behaves like the database
// guard: it writes only when the stored time is older than the interval.
function harness(opts: { failTouch?: () => boolean } = {}) {
    let now = new Date("2026-11-12T10:00:00.000Z").getTime();
    const stored = new Map<string, Date>();
    const writes: Array<{ token: string; at: Date }> = [];
    const touch = async (token: string, at: Date, interval: number) => {
        if (opts.failTouch?.()) throw new Error("connection refused");
        const prev = stored.get(token);
        if (prev && prev.getTime() > at.getTime() - interval) return false;
        stored.set(token, at);
        writes.push({ token, at });
        return true;
    };
    const record = createTokenUseRecorder({
        now: () => new Date(now),
        touch,
    });
    return {
        record,
        writes,
        stored,
        advance: (ms: number) => (now += ms),
    };
}

describe("token use recorder", () => {
    test("two uses inside ten minutes write once", async () => {
        const h = harness();
        // The lookup keeps reporting "never used": the second request may have
        // read before the first write landed.
        await h.record("t1", null);
        h.advance(9 * MINUTE);
        await h.record("t1", null);
        expect(h.writes).toHaveLength(1);
    });

    test("a use after ten minutes writes again", async () => {
        const h = harness();
        await h.record("t1", null);
        h.advance(TOKEN_USE_INTERVAL_MS);
        await h.record("t1", h.stored.get("t1") ?? null);
        expect(h.writes).toHaveLength(2);
    });

    test("a token the lookup saw used recently is not written at all", async () => {
        const h = harness();
        // The lookup reports a use two minutes before the clock's "now".
        await h.record("t2", new Date("2026-11-12T09:58:00.000Z"));
        expect(h.writes).toHaveLength(0);
    });

    test("tokens are throttled independently", async () => {
        const h = harness();
        await h.record("a", null);
        await h.record("b", null);
        await h.record("a", null);
        expect(h.writes.map((w) => w.token)).toEqual(["a", "b"]);
    });

    test("a failed write never rejects and the next use retries it", async () => {
        let fail = true;
        const h = harness({ failTouch: () => fail });
        await expect(h.record("t1", null)).resolves.toBeUndefined();
        expect(h.writes).toHaveLength(0);
        fail = false;
        await h.record("t1", null);
        expect(h.writes).toHaveLength(1);
    });

    test("the interval is ten minutes", () => {
        expect(TOKEN_USE_INTERVAL_MS).toBe(10 * MINUTE);
    });
});
