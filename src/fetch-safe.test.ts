import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import {
    FOODABLE_USER_AGENT,
    createSafeFetcher,
    isPublicAddress,
} from "./fetch-safe.js";

/** Host check for fake fetchers: the exact host or a subdomain of it. */
function onHost(href: string, domain: string): boolean {
    const host = new URL(href).hostname;
    return host === domain || host.endsWith(`.${domain}`);
}

const PUBLIC = "93.184.216.34";

function okResponse(
    body: string,
    init?: { status?: number; headers?: Record<string, string> },
): Response {
    return new Response(body, {
        status: init?.status ?? 200,
        headers: {
            "content-type": "text/html",
            ...init?.headers,
        },
    });
}

describe("FOODABLE_USER_AGENT", () => {
    test("matches the plan format exactly", () => {
        expect(FOODABLE_USER_AGENT).toBe(
            `Mozilla/5.0 (compatible; Foodable/${pkg.version}; +https://github.com/MrF1ow/foodable/blob/main/docs/fetcher.md)`,
        );
    });

    test("links to docs/fetcher.md in the repo", () => {
        const doc = join(import.meta.dir, "..", "docs", "fetcher.md");
        expect(existsSync(doc)).toBe(true);
    });
});

test("6to4 addresses are not public", () => {
    expect(isPublicAddress("2002:7f00:1::")).toBe(false);
    expect(isPublicAddress("2002:808:808::")).toBe(false);
});

describe("isPublicAddress", () => {
    const privateV4 = [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.1.1",
        "172.16.0.1",
        "192.0.0.1",
        "192.0.2.1",
        "192.168.0.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
    ];
    for (const ip of privateV4) {
        test(`rejects ${ip}`, () => {
            expect(isPublicAddress(ip)).toBe(false);
        });
    }
    test("rejects IPv6 private", () => {
        expect(isPublicAddress("::")).toBe(false);
        expect(isPublicAddress("::1")).toBe(false);
        expect(isPublicAddress("fd00::1")).toBe(false);
        expect(isPublicAddress("fe80::1")).toBe(false);
        expect(isPublicAddress("ff00::1")).toBe(false);
        expect(isPublicAddress("2001:db8::1")).toBe(false);
        expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
    });
    test("accepts a public address", () => {
        expect(isPublicAddress(PUBLIC)).toBe(true);
        expect(isPublicAddress("2606:4700::")).toBe(true);
        expect(isPublicAddress("[2606:4700::1]")).toBe(true);
    });

    test("classifies bracketed and mapped IPv6 forms", () => {
        expect(isPublicAddress("[::1]")).toBe(false);
        expect(isPublicAddress("::7f00:1")).toBe(false);
        expect(isPublicAddress("::ffff:10.0.0.1")).toBe(false);
        expect(isPublicAddress("::ffff:93.184.216.34")).toBe(true);
    });
});

describe("isPublicAddress: tunnelled and reserved IPv6 ranges", () => {
    const refused = [
        // ::ffff:0:0:0/96 (IPv4-translated), public and private embedded v4
        "::ffff:0:8.8.8.8",
        "::ffff:0:10.0.0.1",
        "::ffff:0:808:808",
        // 64:ff9b::/96 (NAT64) and 64:ff9b:1::/48 (local-use NAT64)
        "64:ff9b::8.8.8.8",
        "64:ff9b::a00:1",
        "64:ff9b:1::1",
        "64:ff9b:1:0:0:0:808:808",
        // fec0::/10 (site-local)
        "fec0::1",
        "feff::1",
        // 2001::/32 (Teredo)
        "2001::1",
        "2001:0:4136:e378:8000:63bf:3fff:fdd2",
        // 100::/64 (discard-only)
        "100::1",
        "100::8.8.8.8",
        // 2002::/16 (6to4), public and private embedded v4
        "2002:808:808::1",
        "2002:a00:1::1",
        // ::a.b.c.d (IPv4-compatible), public and private embedded v4
        "::8.8.8.8",
        "::10.0.0.1",
        "::808:808",
        // unspecified, loopback, multicast, documentation, ULA, link-local
        "::",
        "::1",
        "ff02::1",
        "ff00::",
        "2001:db8::1",
        "fc00::1",
        "fd12:3456::1",
        "fe80::1",
    ];
    for (const ip of refused) {
        test(`rejects ${ip}`, () => {
            expect(isPublicAddress(ip)).toBe(false);
        });
    }

    test("still accepts neighbours of the refused ranges", () => {
        expect(isPublicAddress("2001:4860:4860::8888")).toBe(true);
        expect(isPublicAddress("2001:1::1")).toBe(true);
        expect(isPublicAddress("100:0:0:1::1")).toBe(true);
        expect(isPublicAddress("64:ff9b:2::1")).toBe(true);
        expect(isPublicAddress("2606:4700::1111")).toBe(true);
        expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true);
    });
});

describe("createSafeFetcher", () => {
    test("sends Foodable user agent on page and robots requests", async () => {
        const seen: string[] = [];
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async (_url, init) => {
                const ua = (init?.headers as Record<string, string>)?.[
                    "User-Agent"
                ];
                seen.push(ua ?? "");
                return okResponse("User-agent: *\nDisallow:");
            },
        });
        await fetcher.fetchPage("https://example.com/page", {
            accept: ["text/html"],
            checkRobots: true,
        });
        expect(seen.length).toBeGreaterThanOrEqual(2);
        expect(seen.every((ua) => ua === FOODABLE_USER_AGENT)).toBe(true);
    });

    test("refuses hosts resolving to private addresses", async () => {
        const fetcher = createSafeFetcher({
            resolve: async (host) =>
                host === "bad.example" ? ["127.0.0.1"] : [PUBLIC],
            fetch: async () => okResponse("ok"),
        });
        const blocked = await fetcher.fetchPage("https://bad.example/", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(blocked).toEqual({
            ok: false,
            reason: "blocked_address",
            status: null,
            detail: "127.0.0.1",
        });
    });

    test("refuses when any resolved address is private", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC, "10.0.0.5"],
            fetch: async () => okResponse("ok"),
        });
        const blocked = await fetcher.fetchPage("https://example.com/", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(blocked.ok).toBe(false);
        if (blocked.ok) return;
        expect(blocked.reason).toBe("blocked_address");
    });

    test("refuses http redirect targets", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async (url) => {
                if (String(url).endsWith("/start")) {
                    return okResponse("", {
                        status: 302,
                        headers: { location: "http://example.com/nope" },
                    });
                }
                return okResponse("ok");
            },
        });
        const out = await fetcher.fetchPage("https://example.com/start", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("invalid_link");
    });

    test("refuses redirect when new host resolves privately", async () => {
        const fetcher = createSafeFetcher({
            resolve: async (host) =>
                host === "evil.example" ? ["10.0.0.1"] : [PUBLIC],
            fetch: async (url) => {
                if (String(url).includes("start")) {
                    return okResponse("", {
                        status: 302,
                        headers: {
                            location: "https://evil.example/target",
                        },
                    });
                }
                return okResponse("ok");
            },
        });
        const out = await fetcher.fetchPage("https://example.com/start", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("blocked_address");
    });

    test("redirectAllowed vetoes a hop before it is requested or even resolved", async () => {
        const requested: string[] = [];
        const resolved: string[] = [];
        const fetcher = createSafeFetcher({
            pinAddresses: false, // these fakes route on the hostname
            resolve: async (host) => {
                resolved.push(host);
                return [PUBLIC];
            },
            fetch: async (url) => {
                requested.push(String(url));
                if (String(url).includes("start")) {
                    return okResponse("", {
                        status: 302,
                        headers: { location: "https://other.example/else" },
                    });
                }
                return okResponse("{}", {
                    headers: { "content-type": "application/json" },
                });
            },
        });
        const out = await fetcher.fetchPage("https://example.com/start", {
            accept: ["application/json"],
            checkRobots: false,
            redirectAllowed: (next) => next.pathname === "/start",
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("invalid_link");
        expect(requested).toEqual(["https://example.com/start"]);
        expect(resolved).toEqual(["example.com"]);
    });

    test("redirectAllowed lets a hop it accepts through", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async (url) => {
                if (String(url).includes("start")) {
                    return okResponse("", {
                        status: 301,
                        headers: { location: "https://other.example/ok" },
                    });
                }
                return okResponse("{}", {
                    headers: { "content-type": "application/json" },
                });
            },
        });
        const out = await fetcher.fetchPage("https://example.com/start", {
            accept: ["application/json"],
            checkRobots: false,
            redirectAllowed: (next) => next.pathname === "/ok",
        });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.url).toBe("https://other.example/ok");
    });

    test("checks robots on redirect target host", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async (url) => {
                const href = String(url);
                if (href.includes("robots.txt")) {
                    return okResponse("User-agent: Foodable\nDisallow: /");
                }
                if (href.includes("start")) {
                    return okResponse("", {
                        status: 302,
                        headers: {
                            location: "https://other.example/target",
                        },
                    });
                }
                return okResponse("<html></html>");
            },
        });
        const out = await fetcher.fetchPage("https://example.com/start", {
            accept: ["text/html"],
            checkRobots: true,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("robots_disallowed");
    });

    test("too many redirects", async () => {
        let n = 0;
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async () => {
                n += 1;
                return okResponse("", {
                    status: 302,
                    headers: { location: "/next" },
                });
            },
        });
        const out = await fetcher.fetchPage("https://example.com/0", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("too_many_redirects");
        expect(n).toBe(4);
    });

    test("streamed body over cap without content-length is too_large", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array(1024 * 1024));
                controller.enqueue(new Uint8Array(1024 * 1024));
                controller.enqueue(new Uint8Array(1024 * 1024));
                controller.enqueue(new Uint8Array(1));
                controller.close();
            },
        });
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async () =>
                new Response(stream, {
                    status: 200,
                    headers: { "content-type": "text/html" },
                }),
        });
        const out = await fetcher.fetchPage("https://example.com/big", {
            accept: ["text/html"],
            checkRobots: false,
            maxBytes: 3 * 1024 * 1024,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("too_large");
    });

    test("content-length over cap rejects without reading body", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async () =>
                new Response(null, {
                    status: 200,
                    headers: {
                        "content-type": "text/html",
                        "content-length": String(4 * 1024 * 1024),
                    },
                }),
        });
        const out = await fetcher.fetchPage("https://example.com/len", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("too_large");
    });

    test("timeout when body read exceeds deadline after fast headers", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("partial"));
            },
            pull(controller) {
                return new Promise(() => {});
            },
        });
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async () =>
                new Response(stream, {
                    status: 200,
                    headers: { "content-type": "text/html" },
                }),
        });
        const out = await fetcher.fetchPage("https://example.com/slow-body", {
            accept: ["text/html"],
            checkRobots: false,
            timeoutMs: 20,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("timeout");
    });

    test("timeout spans redirect hops on one deadline", async () => {
        let hop = 0;
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async (url) => {
                hop += 1;
                if (hop < 4) {
                    // oxlint-disable-next-line foodable/no-wall-clock-waits -- simulates a slow upstream to exercise the fetcher's wall-clock deadline
                    await new Promise((r) => setTimeout(r, 40));
                    return okResponse("", {
                        status: 302,
                        headers: { location: `/hop${hop}` },
                    });
                }
                return okResponse("<html></html>");
            },
        });
        const out = await fetcher.fetchPage("https://example.com/hop0", {
            accept: ["text/html"],
            checkRobots: false,
            timeoutMs: 50,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("timeout");
    });

    test("a redirect hop's slow robots.txt shares the page deadline", async () => {
        const started = Date.now();
        const fetcher = createSafeFetcher({
            pinAddresses: false, // these fakes route on the hostname
            resolve: async () => [PUBLIC],
            fetch: async (url) => {
                const href = String(url);
                if (href.startsWith("https://other.example/robots.txt")) {
                    // oxlint-disable-next-line foodable/no-wall-clock-waits -- simulates a slow upstream to exercise the fetcher's wall-clock deadline
                    await new Promise((r) => setTimeout(r, 400));
                    return okResponse("User-agent: *\nAllow: /");
                }
                if (href.endsWith("/robots.txt")) {
                    return okResponse("User-agent: *\nAllow: /");
                }
                if (href.startsWith("https://example.com/")) {
                    return okResponse("", {
                        status: 302,
                        headers: { location: "https://other.example/r" },
                    });
                }
                return okResponse("<html></html>");
            },
        });
        const out = await fetcher.fetchPage("https://example.com/start", {
            accept: ["text/html"],
            timeoutMs: 60,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("timeout");
        expect(Date.now() - started).toBeLessThan(350);
    });

    test("slow robots body is treated as disallow", async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("User-agent:"));
            },
            pull() {
                return new Promise(() => {});
            },
        });
        const fetcher = createSafeFetcher({
            defaultTimeoutMs: 20,
            resolve: async () => [PUBLIC],
            fetch: async (url) => {
                if (String(url).includes("robots.txt")) {
                    return new Response(stream, {
                        status: 200,
                        headers: { "content-type": "text/plain" },
                    });
                }
                return okResponse("<html></html>");
            },
        });
        expect(await fetcher.robotsAllows("https://example.com/page")).toBe(
            false,
        );
    });

    test("timeout on slow response", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => {
                        reject(new DOMException("Aborted", "AbortError"));
                    });
                }),
        });
        const out = await fetcher.fetchPage("https://example.com/slow", {
            accept: ["text/html"],
            checkRobots: false,
            timeoutMs: 5,
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("timeout");
    });

    test("bad content type", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async () =>
                okResponse("%PDF", {
                    headers: { "content-type": "application/pdf" },
                }),
        });
        const out = await fetcher.fetchPage("https://example.com/pdf", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(out).toMatchObject({
            ok: false,
            reason: "bad_content_type",
        });
    });

    test("401/403/429 are site_refused with one fetch attempt", async () => {
        for (const status of [401, 403, 429]) {
            let calls = 0;
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => {
                    calls += 1;
                    return okResponse("nope", { status });
                },
            });
            const out = await fetcher.fetchPage("https://example.com/x", {
                accept: ["text/html"],
                checkRobots: false,
            });
            expect(out.ok).toBe(false);
            if (out.ok) continue;
            expect(out.reason).toBe("site_refused");
            expect(calls).toBe(1);
        }
    });

    test("allowedHosts refuses redirect to a host outside the list", async () => {
        const fetcher = createSafeFetcher({
            pinAddresses: false, // these fakes route on the hostname
            resolve: async (host) =>
                host === "graph.example" || host === "example.com"
                    ? [PUBLIC]
                    : [PUBLIC],
            fetch: async (url) => {
                const href = String(url);
                if (href.includes("graph.example")) {
                    return okResponse("", {
                        status: 302,
                        headers: {
                            location: "https://www.facebook.com/nope",
                        },
                    });
                }
                return okResponse("ok");
            },
        });
        const out = await fetcher.fetchPage("https://graph.example/start", {
            accept: ["text/html"],
            checkRobots: false,
            allowedHosts: ["graph.example"],
        });
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("host_not_allowed");
    });

    test("404 is not_found", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: async () => okResponse("missing", { status: 404 }),
        });
        const out = await fetcher.fetchPage("https://example.com/missing", {
            accept: ["text/html"],
            checkRobots: false,
        });
        expect(out).toMatchObject({ ok: false, reason: "not_found" });
    });

    describe("robotsAllows", () => {
        const allowAll = "User-agent: *\nDisallow:";
        const denyFoodable = "User-agent: Foodable\nDisallow: /";
        const pathRule = "User-agent: *\nDisallow: /recipes/";
        const wildcardQuery = "User-agent: *\nDisallow: /*?print=";

        test("allows when Foodable is not blocked", async () => {
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => okResponse(allowAll),
            });
            expect(await fetcher.robotsAllows("https://example.com/any")).toBe(
                true,
            );
        });

        test("denies when Foodable is fully disallowed", async () => {
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => okResponse(denyFoodable),
            });
            expect(await fetcher.robotsAllows("https://example.com/")).toBe(
                false,
            );
        });

        test("honours path rules", async () => {
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => okResponse(pathRule),
            });
            expect(
                await fetcher.robotsAllows("https://example.com/recipes/1"),
            ).toBe(false);
            expect(
                await fetcher.robotsAllows("https://example.com/blog/1"),
            ).toBe(true);
        });

        test("404 robots means allow all", async () => {
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => okResponse("missing", { status: 404 }),
            });
            expect(await fetcher.robotsAllows("https://example.com/x")).toBe(
                true,
            );
        });

        test("500 robots means disallow", async () => {
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => okResponse("error", { status: 500 }),
            });
            expect(await fetcher.robotsAllows("https://example.com/x")).toBe(
                false,
            );
        });

        test("wildcard query disallow rule", async () => {
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: async () => okResponse(wildcardQuery),
            });
            expect(
                await fetcher.robotsAllows("https://example.com/page?print=1"),
            ).toBe(false);
        });

        test("caches robots within TTL", async () => {
            let now = 0;
            let fetches = 0;
            const fetcher = createSafeFetcher({
                now: () => now,
                robotsTtlMs: 60_000,
                resolve: async () => [PUBLIC],
                fetch: async () => {
                    fetches += 1;
                    return okResponse(allowAll);
                },
            });
            expect(await fetcher.robotsAllows("https://cache.example/a")).toBe(
                true,
            );
            expect(await fetcher.robotsAllows("https://cache.example/b")).toBe(
                true,
            );
            expect(fetches).toBe(1);
            now = 61_000;
            expect(await fetcher.robotsAllows("https://cache.example/c")).toBe(
                true,
            );
            expect(fetches).toBe(2);
        });
    });
});

test("a robots.txt redirect to another site is never followed", async () => {
    const requested: string[] = [];
    const fetcher = createSafeFetcher({
        pinAddresses: false, // these fakes route on the hostname
        resolve: async () => [PUBLIC],
        fetch: async (url) => {
            const href = String(url);
            requested.push(href);
            if (href === "https://www.tiktok.com/robots.txt") {
                return okResponse("", {
                    status: 302,
                    headers: {
                        location: "https://www.facebook.com/robots.txt",
                    },
                });
            }
            return okResponse("<html></html>");
        },
    });
    expect(
        await fetcher.robotsAllows("https://www.tiktok.com/@a/video/1"),
    ).toBe(false);
    expect(requested.some((href) => onHost(href, "facebook.com"))).toBe(false);
});

test("a robots.txt redirect to the www twin is followed", async () => {
    const fetcher = createSafeFetcher({
        resolve: async () => [PUBLIC],
        fetch: async (url) => {
            const href = String(url);
            if (href === "https://example.com/robots.txt") {
                return okResponse("", {
                    status: 301,
                    headers: { location: "https://www.example.com/robots.txt" },
                });
            }
            return okResponse("User-agent: *\nAllow: /");
        },
    });
    expect(await fetcher.robotsAllows("https://example.com/soup")).toBe(true);
});

describe("createSafeFetcher: the connection goes to the address that was checked", () => {
    const TOKEN_PATH = `/s/${"A".repeat(43)}.json`;
    const JSON_PAGE = { accept: ["application/json"], checkRobots: false };
    const json = (body = "{}") =>
        okResponse(body, { headers: { "content-type": "application/json" } });

    type Seen = { href: string; host: string | undefined; tls: unknown };
    function recorder(answer: (href: string, n: number) => Response) {
        const seen: Seen[] = [];
        const fetch = async (
            input: string | URL,
            init?: BunFetchRequestInit,
        ): Promise<Response> => {
            const headers = (init?.headers ?? {}) as Record<string, string>;
            seen.push({
                href: String(input),
                host: headers["Host"],
                tls: init?.tls,
            });
            return answer(String(input), seen.length);
        };
        return { seen, fetch };
    }

    test("a host that resolves to a public address first and a private one after is connected to by the public address", async () => {
        // What a rebinding DNS server does: the answer the check sees is not
        // the answer a second lookup would give.
        let lookups = 0;
        const { seen, fetch } = recorder(() => json());
        const fetcher = createSafeFetcher({
            resolve: async () => (++lookups === 1 ? [PUBLIC] : ["127.0.0.1"]),
            fetch,
        });
        const out = await fetcher.fetchPage(
            `https://rebind.example.com${TOKEN_PATH}`,
            JSON_PAGE,
        );
        expect(out.ok).toBe(true);
        expect(lookups).toBe(1);
        expect(seen).toEqual([
            {
                href: `https://${PUBLIC}${TOKEN_PATH}`,
                host: "rebind.example.com",
                tls: { serverName: "rebind.example.com" },
            },
        ]);
    });

    test("the outcome still names the page by its hostname", async () => {
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch: recorder(() => json()).fetch,
        });
        const out = await fetcher.fetchPage(
            `https://example.com${TOKEN_PATH}`,
            JSON_PAGE,
        );
        expect(out.ok && out.url).toBe(`https://example.com${TOKEN_PATH}`);
    });

    test("every redirect hop is connected to the address checked for that hop", async () => {
        const addresses: Record<string, string> = {
            "a.example": "93.184.216.34",
            "b.example": "93.184.216.99",
        };
        const lookups: string[] = [];
        const { seen, fetch } = recorder((href) =>
            href.includes("93.184.216.34")
                ? okResponse("", {
                      status: 302,
                      headers: { location: "https://b.example/next.json" },
                  })
                : json(),
        );
        const fetcher = createSafeFetcher({
            resolve: async (host) => {
                lookups.push(host);
                // The hop host would answer 127.0.0.1 to any later lookup.
                return lookups.filter((h) => h === host).length === 1
                    ? [addresses[host]!]
                    : ["127.0.0.1"];
            },
            fetch,
        });
        const out = await fetcher.fetchPage("https://a.example/start", {
            ...JSON_PAGE,
        });
        expect(out.ok).toBe(true);
        expect(
            seen.map(({ href, host, tls }) => ({ href, host, tls })),
        ).toEqual([
            {
                href: "https://93.184.216.34/start",
                host: "a.example",
                tls: { serverName: "a.example" },
            },
            {
                href: "https://93.184.216.99/next.json",
                host: "b.example",
                tls: { serverName: "b.example" },
            },
        ]);
    });

    test("robots.txt is fetched from the checked address too", async () => {
        const { seen, fetch } = recorder((href) =>
            href.endsWith("/robots.txt")
                ? okResponse("User-agent: *\nAllow: /")
                : okResponse("<html></html>"),
        );
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch,
        });
        const out = await fetcher.fetchPage("https://example.com/soup", {
            accept: ["text/html"],
            checkRobots: true,
        });
        expect(out.ok).toBe(true);
        expect(seen.map((s) => s.href)).toEqual([
            `https://${PUBLIC}/robots.txt`,
            `https://${PUBLIC}/soup`,
        ]);
        expect(seen.every((s) => s.host === "example.com")).toBe(true);
    });

    test("an IPv6 address is bracketed in the URL", async () => {
        const { seen, fetch } = recorder(() => json());
        const fetcher = createSafeFetcher({
            resolve: async () => ["2606:4700::1111"],
            fetch,
        });
        const out = await fetcher.fetchPage(
            `https://example.com${TOKEN_PATH}`,
            JSON_PAGE,
        );
        expect(out.ok).toBe(true);
        expect(seen[0]?.href).toBe(`https://[2606:4700::1111]${TOKEN_PATH}`);
        expect(seen[0]?.host).toBe("example.com");
    });

    test("when an address does not connect, the next checked address is tried", async () => {
        const { seen, fetch } = recorder((href, n) => {
            if (n === 1) throw new Error("unreachable");
            return href.includes("93.184.216.99") ? json() : json("{}");
        });
        const fetcher = createSafeFetcher({
            resolve: async () => ["2606:4700::1111", "93.184.216.99"],
            fetch,
        });
        const out = await fetcher.fetchPage(
            `https://example.com${TOKEN_PATH}`,
            JSON_PAGE,
        );
        expect(out.ok).toBe(true);
        expect(seen.map((s) => s.href)).toEqual([
            `https://[2606:4700::1111]${TOKEN_PATH}`,
            `https://93.184.216.99${TOKEN_PATH}`,
        ]);
    });

    test("when no checked address connects it is a network error, not a retry on the hostname", async () => {
        const { seen, fetch } = recorder(() => {
            throw new Error("unreachable");
        });
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC, "93.184.216.99"],
            fetch,
        });
        const out = await fetcher.fetchPage(
            `https://example.com${TOKEN_PATH}`,
            JSON_PAGE,
        );
        expect(out.ok).toBe(false);
        if (out.ok) return;
        expect(out.reason).toBe("network_error");
        expect(seen.map((s) => new URL(s.href).hostname)).toEqual([
            PUBLIC,
            "93.184.216.99",
        ]);
    });

    test("an IP-literal link is requested as written, with no name to pin", async () => {
        const { seen, fetch } = recorder(() => json());
        const fetcher = createSafeFetcher({
            resolve: async (host) => [host],
            fetch,
        });
        const out = await fetcher.fetchPage(`https://${PUBLIC}${TOKEN_PATH}`, {
            ...JSON_PAGE,
        });
        expect(out.ok).toBe(true);
        expect(seen).toEqual([
            {
                href: `https://${PUBLIC}${TOKEN_PATH}`,
                host: undefined,
                tls: undefined,
            },
        ]);
    });

    test("pinAddresses: false hands the fetch the URL as written", async () => {
        const { seen, fetch } = recorder(() => json());
        const fetcher = createSafeFetcher({
            resolve: async () => [PUBLIC],
            fetch,
            pinAddresses: false,
        });
        await fetcher.fetchPage(`https://example.com${TOKEN_PATH}`, JSON_PAGE);
        expect(seen[0]?.href).toBe(`https://example.com${TOKEN_PATH}`);
    });
});

// Real TLS, no fetch double for the handshake: the fetcher's request goes to
// a local server, so what is shown is what Bun's fetch does with the
// `serverName` the fetcher sets while connecting to an IP address.
describe.skipIf(!Bun.which("openssl"))(
    "createSafeFetcher: a pinned connection still verifies the certificate against the hostname",
    () => {
        const PAGE = `/s/${"A".repeat(43)}.json`;
        const names = ["share.test", "other.test"] as const;
        let dir = "";
        const pem = {} as Record<
            (typeof names)[number],
            { cert: string; key: string }
        >;

        beforeAll(async () => {
            dir = await mkdtemp(join(tmpdir(), "fetch-safe-tls-"));
            for (const name of names) {
                const keyPath = join(dir, `${name}.key`);
                const certPath = join(dir, `${name}.crt`);
                await Bun.$`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout ${keyPath} -out ${certPath} -days 2 -subj ${`/CN=${name}`} -addext ${`subjectAltName=DNS:${name}`}`.quiet();
                pem[name] = {
                    cert: await Bun.file(certPath).text(),
                    key: await Bun.file(keyPath).text(),
                };
            }
        });
        afterAll(async () => {
            if (dir) await rm(dir, { recursive: true, force: true });
        });

        /**
         * A TLS server whose only certificate is the one issued to
         * `certName`, and a fetcher that resolves every name to a public
         * address. The seam: the fetch the fetcher is given forwards the
         * request the fetcher built (URL host aside, which it points at the
         * local server) to the real `fetch`, trusting that one certificate.
         * That trust is the test's alone; nothing in the fetcher can turn
         * verification off.
         */
        function setup(certName: (typeof names)[number]) {
            const hostHeaders: (string | null)[] = [];
            const server = Bun.serve({
                port: 0,
                hostname: "127.0.0.1",
                tls: pem[certName],
                fetch(req) {
                    hostHeaders.push(req.headers.get("host"));
                    return Response.json({ host: req.headers.get("host") });
                },
            });
            const connectedTo: string[] = [];
            const fetcher = createSafeFetcher({
                resolve: async () => [PUBLIC],
                fetch: (input, init) => {
                    const url = new URL(String(input));
                    connectedTo.push(url.hostname);
                    url.hostname = "127.0.0.1";
                    url.port = String(server.port);
                    return fetch(url, {
                        ...init,
                        tls: { ...init?.tls, ca: pem[certName].cert },
                    });
                },
            });
            return { server, fetcher, hostHeaders, connectedTo };
        }

        const page = (host: string) => ({
            url: `https://${host}${PAGE}`,
            opts: { accept: ["application/json"], checkRobots: false },
        });

        test("a certificate issued to the page's name is accepted through the pinned address", async () => {
            const { server, fetcher, hostHeaders, connectedTo } =
                setup("share.test");
            try {
                const { url, opts } = page("share.test");
                const out = await fetcher.fetchPage(url, opts);
                expect(out).toMatchObject({ ok: true, status: 200 });
                expect(connectedTo).toEqual([PUBLIC]);
                expect(hostHeaders).toEqual(["share.test"]);
            } finally {
                await server.stop(true);
            }
        });

        test("a certificate issued to another name is refused, and nothing reaches the server", async () => {
            const { server, fetcher, hostHeaders, connectedTo } =
                setup("other.test");
            try {
                const { url, opts } = page("share.test");
                const out = await fetcher.fetchPage(url, opts);
                expect(out.ok).toBe(false);
                if (out.ok) return;
                expect(out.reason).toBe("network_error");
                expect(out.detail).toMatch(/ALTNAME|certificate|altname/i);
                expect(connectedTo).toEqual([PUBLIC]);
                expect(hostHeaders).toEqual([]);

                // Same server, same trust: the name it was issued to passes,
                // so the refusal above is the name check and nothing else.
                const control = page("other.test");
                const accepted = await fetcher.fetchPage(
                    control.url,
                    control.opts,
                );
                expect(accepted).toMatchObject({ ok: true });
                expect(hostHeaders).toEqual(["other.test"]);
            } finally {
                await server.stop(true);
            }
        });
    },
);
