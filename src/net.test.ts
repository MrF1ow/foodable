import { test, expect, describe } from "bun:test";
import { Hono } from "hono";
import { maskIp, redactPathForAccessLog } from "./net.js";

// All addresses below are IETF-reserved documentation ranges (RFC 5737 for
// IPv4: 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24; RFC 3849 for IPv6:
// 2001:db8::/32). They are never routable to a real host.

test("maskIp drops the host octet of an IPv4 address", () => {
    expect(maskIp("203.0.113.42")).toBe("203.0.113.x");
});

test("maskIp maps unknown to '-'", () => {
    expect(maskIp("unknown")).toBe("-");
});

test("maskIp keeps the /48 prefix of an IPv6 address", () => {
    expect(maskIp("2001:db8:85a3:1:2:3:4:5")).toBe("2001:db8:85a3:x");
});

test("maskIp handles compressed IPv6 without mangling", () => {
    expect(maskIp("2001:db8::1")).toBe("2001:db8:x");
});

test("maskIp never leaks a full address — malformed/loopback collapse to '-'", () => {
    expect(maskIp("::1")).toBe("-");
    expect(maskIp("garbage")).toBe("-");
    expect(maskIp("203.0.113")).toBe("-");
    expect(maskIp("203.0.113.9:extra:stuff:more")).toBe("-");
    expect(maskIp("")).toBe("-");
    expect(maskIp(undefined)).toBe("-");
});

describe("redactPathForAccessLog", () => {
    test("redacts export download paths", () => {
        expect(redactPathForAccessLog("/exports/e1.abc.def.mac")).toBe(
            "/exports/[redacted]",
        );
    });

    test("redacts odd spellings of the export path", () => {
        for (const path of [
            "//exports/e1.abc.def.mac",
            "/Exports/e1.abc.def.mac",
            "/EXPORTS//e1.abc.def.mac",
        ]) {
            expect(redactPathForAccessLog(path)).toBe("/exports/[redacted]");
        }
    });

    test("redacts share link paths, in any spelling", () => {
        for (const path of [
            "/s/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE",
            "//s//AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE",
            "/S/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE",
            "/s/anything-at-all",
        ]) {
            expect(redactPathForAccessLog(path)).toBe("/s/[redacted]");
        }
        expect(redactPathForAccessLog("/s")).toBe("/s");
        expect(redactPathForAccessLog("/settings/help")).toBe("/settings/help");
    });

    test("redacts a token behind a percent-encoded segment, the way the router decodes it", () => {
        const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
        for (const [path, redacted] of [
            [`/%73/${token}`, "/s/[redacted]"],
            [`/%53/${token}`, "/s/[redacted]"],
            [`/s/%41${token}`, "/s/[redacted]"],
            [`/%65xports/e1.abc.def.mac`, "/exports/[redacted]"],
            [`/e%78%70orts/e1.abc.def.mac`, "/exports/[redacted]"],
            [`/%45XPORTS/e1.abc.def.mac`, "/exports/[redacted]"],
            [`//%73//${token}`, "/s/[redacted]"],
            // A malformed escape elsewhere in the path decodes piecewise, as
            // the router does, and must neither throw nor expose the token.
            [`/%73/${token}%E0%A4%A`, "/s/[redacted]"],
            [`/%73/%`, "/s/[redacted]"],
        ] as const) {
            expect(redactPathForAccessLog(path)).toBe(redacted);
        }
    });

    test("leaves a double-encoded segment alone, because the router does not decode it twice", () => {
        for (const path of [
            "/%2573/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE",
            "/%25%37%33/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE",
            "/%2Fs/anything",
            "/%73%2Fanything",
        ]) {
            expect(redactPathForAccessLog(path)).toBe(path);
        }
    });

    test("never logs a token the router handed to a share or export handler", async () => {
        const token = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
        let reached: string | null = null;
        const app = new Hono();
        app.get("/s/:token", (c) => {
            reached = c.req.param("token");
            return c.text("share");
        });
        app.get("/exports/:token", (c) => {
            reached = c.req.param("token");
            return c.text("export");
        });
        const spellings = [
            `/s/${token}`,
            `/%73/${token}`,
            `/%53/${token}`,
            `/S/${token}`,
            `/%2573/${token}`,
            `/s%2F${token}`,
            `/%2Fs/${token}`,
            `//s//${token}`,
            `/s/${token}/`,
            `/s/%41${token}`,
            `/s/${token}%E0`,
            `/%73/${token}%E0%A4%A`,
            `/exports/${token}`,
            `/%65xports/${token}`,
            `/e%78ports/${token}`,
            `/%45xports/${token}`,
            `/%2565xports/${token}`,
            `/exports%2F${token}`,
            `/exports/%${token}`,
        ];
        let routed = 0;
        for (const path of spellings) {
            reached = null;
            await app.request(`http://x${path}`);
            if (reached === null) continue;
            routed += 1;
            expect(
                redactPathForAccessLog(new URL(`http://x${path}`).pathname),
            ).not.toContain(token.slice(0, 20));
        }
        // The spellings that do route must include the encoded ones.
        expect(routed).toBeGreaterThanOrEqual(9);
    });

    test("leaves other paths unchanged", () => {
        expect(redactPathForAccessLog("/mcp")).toBe("/mcp");
        expect(redactPathForAccessLog("/exports")).toBe("/exports");
    });
});
