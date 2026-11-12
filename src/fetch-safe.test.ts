import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
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
