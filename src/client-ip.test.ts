import { test, expect } from "bun:test";
import {
    normalizeIp,
    parseClientIpConfig,
    resolveClientIp,
    isCloudflareIp,
    rateLimitKeyForIp,
    clientIpConfigBootLine,
    type ClientIpConfig,
} from "./client-ip.js";

const TEST_ORIGIN_SECRET = "0123456789abcdef0123456789abcdef";

const xffCfg: ClientIpConfig = {
    source: "x-forwarded-for",
    sourceIsDefault: false,
    trustedHops: 1,
    cloudflareOriginSecret: null,
};

function cfg(overrides: Partial<ClientIpConfig> = {}): ClientIpConfig {
    return { ...xffCfg, ...overrides };
}

function resolve(
    headers: Record<string, string>,
    config: ClientIpConfig,
    socketIp?: string | null,
) {
    return resolveClientIp(
        {
            header: (name) => headers[name.toLowerCase()] ?? headers[name],
            socketIp,
        },
        config,
    );
}

test("normalizeIp handles ports, brackets, zones, mapped v6", () => {
    expect(normalizeIp(" 203.0.113.7 ")).toBe("203.0.113.7");
    expect(normalizeIp("203.0.113.7:443")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    // Unbracketed IPv6 never loses a trailing group as if it were a port.
    expect(normalizeIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(normalizeIp(":::1")).toBeNull();
    expect(normalizeIp("1:2:3:4:5::6:7:8")).toBeNull();
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp('"203.0.113.2"')).toBe("203.0.113.2");
    expect(normalizeIp("2001:DB8::ABCD")).toBe("2001:db8::abcd");
});

test("normalizeIp canonicalizes IPv6 spellings to one form", () => {
    const spellings = ["2001:db8:1:2::3", "2001:db8:1:2:0:0:0:3"];
    const canon = spellings.map((s) => normalizeIp(s));
    expect(new Set(canon).size).toBe(1);
});

test("normalizeIp maps IPv4-mapped spellings to plain IPv4", () => {
    for (const s of ["::ffff:6816:105", "0:0:0:0:0:ffff:104.22.1.5"]) {
        expect(normalizeIp(s)).toBe("104.22.1.5");
    }
    for (const s of [
        "::ffff:1.2.3.4",
        "0:0:0:0:0:ffff:1.2.3.4",
        "::ffff:102:304",
    ]) {
        expect(normalizeIp(s)).toBe("1.2.3.4");
    }
});

test("normalizeIp embeds dotted IPv4 tail in non-mapped v6", () => {
    expect(normalizeIp("2001::a:b:c:192.0.2.1")).toBe("2001::a:b:c:c000:201");
});

test("normalizeIp rejects garbage and obscured values", () => {
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp("unknown")).toBeNull();
    expect(normalizeIp("anonymous")).toBeNull();
    expect(normalizeIp("not-an-ip")).toBeNull();
});

test("x-forwarded-for picks trusted right-most hop", () => {
    expect(resolve({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" }, xffCfg)).toBe(
        "2.2.2.2",
    );
    expect(
        resolve(
            { "x-forwarded-for": "forged, 2.2.2.2, 3.3.3.3" },
            cfg({ trustedHops: 2 }),
        ),
    ).toBe("2.2.2.2");
    expect(
        resolve(
            { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
            cfg({ trustedHops: 3 }),
        ),
    ).toBe("1.1.1.1");
});

test("x-forwarded-for too few hops falls back to socket", () => {
    expect(
        resolve(
            { "x-forwarded-for": "1.2.3.4" },
            cfg({ trustedHops: 2 }),
            "10.0.0.1",
        ),
    ).toBe("10.0.0.1");
    expect(
        resolve(
            { "x-forwarded-for": "1.2.3.4" },
            cfg({ trustedHops: 2 }),
            null,
        ),
    ).toBe("unknown");
});

test("x-forwarded-for skips empty comma entries", () => {
    expect(resolve({ "x-forwarded-for": ", ,1.2.3.4" }, xffCfg)).toBe(
        "1.2.3.4",
    );
    expect(resolve({ "x-forwarded-for": "1.2.3.4,," }, xffCfg)).toBe("1.2.3.4");
});

test("socket source ignores forged x-real-ip", () => {
    expect(
        resolve(
            { "x-real-ip": "9.9.9.9", "x-forwarded-for": "8.8.8.8" },
            cfg({ source: "socket" }),
            "203.0.113.1",
        ),
    ).toBe("203.0.113.1");
});

test("forged left xff does not change key when hops=1", () => {
    const base = resolve({ "x-forwarded-for": "forged, 5.6.7.8" }, xffCfg);
    const rotated = resolve(
        { "x-forwarded-for": "other-forged, 5.6.7.8" },
        xffCfg,
    );
    expect(base).toBe("5.6.7.8");
    expect(rotated).toBe("5.6.7.8");
});

test("duplicate xff header values join as one list", () => {
    const header = (name: string) => {
        if (name === "x-forwarded-for") return "1.1.1.1, 2.2.2.2, 3.3.3.3";
        return undefined;
    };
    expect(resolveClientIp({ header }, cfg({ trustedHops: 1 }))).toBe(
        "3.3.3.3",
    );
});

test("Railway-shaped request with origin secret", () => {
    const headers = {
        "x-real-ip": "104.22.1.5",
        "x-forwarded-for": "104.22.1.5, 89.222.103.193",
        "cf-connecting-ip": "47.40.248.203",
        "x-foodable-origin-secret": TEST_ORIGIN_SECRET,
    };
    const without = resolve(headers, {
        source: "x-real-ip",
        sourceIsDefault: true,
        trustedHops: 1,
        cloudflareOriginSecret: TEST_ORIGIN_SECRET,
    });
    expect(without).toBe("47.40.248.203");

    const noSecret = resolve(
        {
            "x-real-ip": "104.22.1.5",
            "cf-connecting-ip": "47.40.248.203",
        },
        {
            source: "x-real-ip",
            sourceIsDefault: true,
            trustedHops: 1,
            cloudflareOriginSecret: TEST_ORIGIN_SECRET,
        },
    );
    expect(noSecret).toBe("104.22.1.5");

    const wrongSecret = resolve(
        {
            "x-real-ip": "104.22.1.5",
            "cf-connecting-ip": "47.40.248.203",
            "x-foodable-origin-secret": "wrong-secret-but-still-32-chars-xx",
        },
        {
            source: "x-real-ip",
            sourceIsDefault: true,
            trustedHops: 1,
            cloudflareOriginSecret: TEST_ORIGIN_SECRET,
        },
    );
    expect(wrongSecret).toBe("104.22.1.5");

    const shortWrong = resolve(
        {
            "x-real-ip": "104.22.1.5",
            "cf-connecting-ip": "47.40.248.203",
            "x-foodable-origin-secret": "short",
        },
        {
            source: "x-real-ip",
            sourceIsDefault: true,
            trustedHops: 1,
            cloudflareOriginSecret: TEST_ORIGIN_SECRET,
        },
    );
    expect(shortWrong).toBe("104.22.1.5");
});

test("forged cf-connecting-ip ignored when peer is not Cloudflare", () => {
    expect(
        resolve(
            {
                "x-real-ip": "203.0.113.50",
                "cf-connecting-ip": "1.2.3.4",
                "x-foodable-origin-secret": TEST_ORIGIN_SECRET,
            },
            cfg({
                source: "x-real-ip",
                cloudflareOriginSecret: TEST_ORIGIN_SECRET,
            }),
        ),
    ).toBe("203.0.113.50");
});

test("invalid cf-connecting-ip keeps base address", () => {
    expect(
        resolve(
            {
                "x-real-ip": "104.22.1.5",
                "cf-connecting-ip": "not-ip",
                "x-foodable-origin-secret": TEST_ORIGIN_SECRET,
            },
            cfg({
                source: "x-real-ip",
                cloudflareOriginSecret: TEST_ORIGIN_SECRET,
            }),
        ),
    ).toBe("104.22.1.5");
});

test("parseClientIpConfig defaults", () => {
    expect(parseClientIpConfig({})).toEqual({
        source: "socket",
        sourceIsDefault: true,
        trustedHops: 1,
        cloudflareOriginSecret: null,
    });
    expect(parseClientIpConfig({ RAILWAY_ENVIRONMENT_ID: "abc" })).toEqual({
        source: "x-real-ip",
        sourceIsDefault: true,
        trustedHops: 1,
        cloudflareOriginSecret: null,
    });
    expect(
        parseClientIpConfig({
            CLIENT_IP_SOURCE: "X-FORWARDED-FOR",
            TRUSTED_PROXY_HOPS: "2",
            CLOUDFLARE_ORIGIN_SECRET: TEST_ORIGIN_SECRET,
        }),
    ).toEqual({
        source: "x-forwarded-for",
        sourceIsDefault: false,
        trustedHops: 2,
        cloudflareOriginSecret: TEST_ORIGIN_SECRET,
    });
});

test("parseClientIpConfig throws on bad values", () => {
    expect(() => parseClientIpConfig({ CLIENT_IP_SOURCE: "nope" })).toThrow(
        /CLIENT_IP_SOURCE/,
    );
    expect(() => parseClientIpConfig({ TRUSTED_PROXY_HOPS: "0" })).toThrow(
        /TRUSTED_PROXY_HOPS/,
    );
    expect(() => parseClientIpConfig({ TRUSTED_PROXY_HOPS: "01" })).toThrow(
        /TRUSTED_PROXY_HOPS/,
    );
    expect(() => parseClientIpConfig({ TRUSTED_PROXY_HOPS: "0x10" })).toThrow(
        /TRUSTED_PROXY_HOPS/,
    );
    expect(() => parseClientIpConfig({ TRUSTED_PROXY_HOPS: "11" })).toThrow(
        /maximum/,
    );
    expect(() =>
        parseClientIpConfig({ CLOUDFLARE_ORIGIN_SECRET: "short" }),
    ).toThrow(/32/);
    expect(() => parseClientIpConfig({ TRUST_CLOUDFLARE: "true" })).toThrow(
        /TRUST_CLOUDFLARE/,
    );
});

test("clientIpConfigBootLine", () => {
    expect(
        clientIpConfigBootLine({
            source: "x-real-ip",
            sourceIsDefault: true,
            trustedHops: 1,
            cloudflareOriginSecret: null,
        }),
    ).toBe(
        "[net] client address from x-real-ip (Railway default), cloudflare=off",
    );
    expect(
        clientIpConfigBootLine({
            source: "x-real-ip",
            sourceIsDefault: false,
            trustedHops: 1,
            cloudflareOriginSecret: TEST_ORIGIN_SECRET,
        }),
    ).toBe("[net] client address from x-real-ip, cloudflare=on");
    expect(
        clientIpConfigBootLine({
            source: "x-forwarded-for",
            sourceIsDefault: false,
            trustedHops: 2,
            cloudflareOriginSecret: null,
        }),
    ).toBe("[net] client address from x-forwarded-for, hops=2, cloudflare=off");
});

test("isCloudflareIp range edges and mapped spellings", () => {
    expect(isCloudflareIp("173.245.48.0")).toBe(true);
    expect(isCloudflareIp("173.245.63.255")).toBe(true);
    expect(isCloudflareIp("173.245.47.255")).toBe(false);
    expect(isCloudflareIp("173.245.64.0")).toBe(false);
    expect(isCloudflareIp("2400:cb00::")).toBe(true);
    expect(isCloudflareIp("2400:cb00:ffff:ffff:ffff:ffff:ffff:ffff")).toBe(
        true,
    );
    expect(isCloudflareIp("2400:cb01::")).toBe(false);
    expect(isCloudflareIp("::ffff:6816:105")).toBe(true);
    expect(isCloudflareIp("0:0:0:0:0:ffff:104.22.1.5")).toBe(true);
});

test("rateLimitKeyForIp v4 and v6 /64", () => {
    expect(rateLimitKeyForIp("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitKeyForIp("unknown")).toBe("unknown");
    const a = rateLimitKeyForIp("2001:db8:1:2::1");
    const b = rateLimitKeyForIp("2001:db8:1:2:0:0:0:3");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(b).toBe("2001:db8:1:2::/64");
    expect(rateLimitKeyForIp("2001:db8:1:3::1")).toBe("2001:db8:1:3::/64");
    expect(a).not.toBe(rateLimitKeyForIp("2001:db8:1:3::1"));
});

test("rateLimitKeyForIp agrees across IPv6 spellings", () => {
    const spellings = ["2001:db8:1:2::1", "2001:db8:1:2:0:0:0:3"];
    const keys = spellings.map((s) => rateLimitKeyForIp(s));
    expect(new Set(keys).size).toBe(1);
});
