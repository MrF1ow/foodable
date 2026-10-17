import { test, expect, describe } from "bun:test";
import { SITE_COOKIE } from "./site-session.js";

// index.ts calls createOAuthRouter() at module scope, which throws without
// OAuth env. Same dance as src/index.test.ts: set defaults before the
// dynamic import, ||= so a real .env still wins.
process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("./index.js");

const MARKETING_GENERATORS = [
    "scripts/gen-index.ts",
    "scripts/gen-tools.ts",
    "scripts/gen-legal.ts",
    "scripts/gen-alternatives.ts",
    "scripts/gen-sitemap.ts",
] as const;

const MARKETING_PATHS = [
    "/tools",
    "/privacy",
    "/terms",
    "/alternatives",
    "/myfitnesspal-mcp",
    "/de",
    "/de/tools",
    "/llms.txt",
    "/sitemap.xml",
    "/api/stats",
    "/api/patreon-posts",
    "/map-data.json",
    "/og.png",
    "/.well-known/glama.json",
    "/de/login.html",
] as const;

async function expectNotMarketingHtml(path: string): Promise<void> {
    const r = await app.request(`http://x${path}`);
    expect({
        path,
        status: r.status,
        location: r.headers.get("location"),
    }).toEqual({
        path,
        status: 404,
        location: null,
    });
    const body = await r.text();
    expect(body, path).not.toMatch(/<!doctype html/i);
    expect(body, path).not.toContain("Nutrition Facts");
}

describe("marketing HTTP is gone", () => {
    test("former marketing paths 404 and are not a redirect to /authorize", async () => {
        for (const path of MARKETING_PATHS) {
            await expectNotMarketingHtml(path);
        }
    });

    test("GET / without a session is login HTML, not marketing and not /authorize", async () => {
        const r = await app.request("http://x/");
        expect(r.status).toBe(200);
        expect(r.headers.get("location")).toBeNull();
        const body = await r.text();
        expect(body).toMatch(/<!doctype html/i);
        expect(body).toContain('action="/approve"');
        expect(body).toContain("Foodable");
        expect(body).not.toContain("Nutrition MCP");
        expect(body).not.toContain("MCP Tools");
        expect(r.headers.get("location")).toBeNull();
        expect(body).not.toContain("response_type=code");
        expect(body).not.toContain("/authorize/google");
        expect(body).not.toContain("Continue with Google");
        expect(body).not.toContain("created automatically");
        expect(body).toContain('<link rel="stylesheet" href="/app.css" />');
        expect(body).toContain('<script src="/app.js" defer></script>');
        expect(body).not.toContain("/?locale=");
        expect(body).not.toContain("gtag");
        expect(body).not.toContain("googletagmanager");
        expect(body).not.toContain("fonts.googleapis.com");
        expect(body).not.toContain("fonts.gstatic.com");
        expect(body).not.toContain("cdn.jsdelivr.net");
    });

    test("GET / with a bad site cookie is still login HTML", async () => {
        const r = await app.request("http://x/", {
            headers: { cookie: `${SITE_COOKIE}=not-a-session` },
        });
        expect(r.status).toBe(200);
        const body = await r.text();
        expect(body).toContain('action="/approve"');
        expect(body).not.toContain("widget-frame");
    });
});

describe("site session HTTP", () => {
    test("GET /logout clears the site cookie and returns to /", async () => {
        const r = await app.request("http://x/logout");
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/");
        const cookie = r.headers.get("set-cookie") ?? "";
        expect(cookie).toContain(`${SITE_COOKIE}=`);
        expect(cookie).toContain("Max-Age=0");
    });
});

describe("runtime surfaces that stay", () => {
    test("GET /health is ok", async () => {
        const r = await app.request("http://x/health");
        expect(r.status).toBe(200);
        expect(await r.text()).toBe("ok");
    });

    test("GET /app.css serves the assembled app stylesheet", async () => {
        const r = await app.request("http://x/app.css");
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type") ?? "").toContain("text/css");
        const css = await r.text();
        expect(css).not.toContain("/*@include");
        expect(css).toContain(".bottom-nav");
    });

    test("GET /app.js serves the assembled app client bundle", async () => {
        const r = await app.request("http://x/app.js");
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type") ?? "").toContain(
            "text/javascript",
        );
        const js = await r.text();
        expect((js.match(/^\(function \(\) \{/gm) ?? []).length).toBe(4);
        expect(js).toContain('classList.add("fx")');
        expect(js).toContain("[data-food-picker]");
    });

    test("the app serves its fonts from the allowlist; unknown and traversal names are not served", async () => {
        for (const name of ["geist-latin.woff2", "bricolage-latin.woff2"]) {
            const r = await app.request(`http://x/fonts/${name}`);
            expect(r.status, name).toBe(200);
            expect(r.headers.get("content-type")).toBe("font/woff2");
        }
        const stray = await app.request("http://x/fonts/../package.json");
        expect(stray.status).not.toBe(200);
        const unknown = await app.request("http://x/fonts/other.woff2");
        expect(unknown.status).toBe(404);
    });

    test("the marketing stylesheet, site script and old web fonts are gone", async () => {
        for (const path of [
            "/styles.css",
            "/site.js",
            "/fonts/bricolage-grotesque-latin.woff2",
        ]) {
            const r = await app.request(`http://x${path}`);
            expect(r.status, path).toBe(404);
        }
        for (const file of [
            "public/styles.css",
            "public/site.js",
            "public/fonts/bricolage-grotesque-latin.woff2",
            "src/copy/chrome.ts",
        ]) {
            expect(await Bun.file(file).exists(), file).toBe(false);
        }
    });

    test("the brand icons are served", async () => {
        const touch = await app.request("http://x/apple-touch-icon.png");
        expect(touch.status).toBe(200);
        expect(touch.headers.get("content-type")).toBe("image/png");
        for (const file of [
            "icon.svg",
            "icon-light.svg",
            "icon-dark.svg",
            "mark.svg",
        ]) {
            const r = await app.request(`http://x/brand/${file}`);
            expect(r.status, file).toBe(200);
            expect(r.headers.get("content-type") ?? "", file).toContain(
                "image/svg+xml",
            );
            expect(await r.text(), file).toStartWith("<svg");
        }
        for (const path of ["/brand/nope.svg", "/brand/constructor"]) {
            const r = await app.request(`http://x${path}`);
            expect(r.status, path).toBe(404);
        }
    });

    test("login HTML links the SVG favicon and the touch icon", async () => {
        const body = await (await app.request("http://x/")).text();
        expect(body).toContain('href="/brand/icon.svg" type="image/svg+xml"');
        expect(body).toContain('rel="apple-touch-icon"');
        expect(body).toContain('class="auth-mark" src="/brand/mark.svg"');
        expect(body).not.toContain("🍏");
    });

    test("GET /robots.txt disallows crawlers", async () => {
        const r = await app.request("http://x/robots.txt");
        expect(r.status).toBe(200);
        expect(await r.text()).toContain("Disallow: /");
    });

    test("unauthenticated POST /mcp is still 401", async () => {
        const r = await app.request("http://x/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
        });
        expect(r.status).toBe(401);
    });

    test("unauthenticated app routes return login HTML", async () => {
        for (const path of [
            "/",
            "/fridge",
            "/grocery",
            "/recipes",
            "/settings",
            "/settings/foods",
        ]) {
            const r = await app.request(`http://x${path}`);
            expect(r.status).toBe(200);
            const body = await r.text();
            expect(body, path).toContain('action="/approve"');
            expect(body, path).toContain("Foodable");
        }
    });

    test("GET /authorize without OAuth params is JSON 400, not login HTML", async () => {
        const r = await app.request("http://x/authorize");
        expect(r.status).toBe(400);
        expect(r.headers.get("content-type") ?? "").toContain(
            "application/json",
        );
        expect(await r.text()).not.toMatch(/<!doctype html/i);
    });

    test("GET /authorize with a valid OAuth query returns login HTML", async () => {
        const challenge = "a".repeat(43);
        const r = await app.request(
            `http://x/authorize?response_type=code&client_id=${encodeURIComponent(
                process.env.OAUTH_CLIENT_ID!,
            )}&redirect_uri=${encodeURIComponent(
                "http://localhost:8080/cb",
            )}&state=xyz&code_challenge=${challenge}&code_challenge_method=S256`,
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toMatch(/<!doctype html/i);
        expect(html).toContain('action="/approve"');
        expect(html).toContain("Foodable");
        expect(html).not.toContain("Nutrition MCP");
        expect(html).toContain("session_id");
        expect(html).not.toContain("{{SESSION_ID}}");
        expect(html).not.toContain('href="/terms"');
        expect(html).not.toContain('href="/privacy"');
        expect(html).not.toMatch(/<a class="brand"[^>]*href="\/"/);
        expect(html).toContain('<link rel="stylesheet" href="/app.css" />');
        expect(html).toContain('<script src="/app.js" defer></script>');
        expect(html).not.toContain("gtag");
        expect(html).not.toContain("fonts.googleapis.com");
        expect(html).not.toContain("fonts.gstatic.com");
        expect(html).not.toContain("cdn.jsdelivr.net");
        expect(html).not.toContain("/fonts/");
    });

    test("CSP has no third-party hosts", async () => {
        const r = await app.request("http://x/health");
        expect(r.headers.get("content-security-policy") ?? "").not.toContain(
            "fonts.googleapis.com",
        );
        expect(r.headers.get("content-security-policy") ?? "").not.toContain(
            "fonts.gstatic.com",
        );
        expect(r.headers.get("content-security-policy") ?? "").not.toContain(
            "cdn.jsdelivr.net",
        );
        expect(r.headers.get("content-security-policy") ?? "").not.toContain(
            "googletagmanager",
        );
        expect(r.headers.get("content-security-policy") ?? "").toContain(
            "img-src 'self' data:",
        );
        expect(r.headers.get("content-security-policy") ?? "").toContain(
            "script-src 'self' 'unsafe-inline'",
        );
    });
});

describe("cannot republish the marketing site", () => {
    test("gen:all builds the tokens and login only; the marketing generators are gone", async () => {
        const pkg = (await Bun.file("./package.json").json()) as {
            scripts: Record<string, string>;
        };
        expect(pkg.scripts["gen:pages"]).toBe("bun run scripts/gen-login.ts");
        expect(pkg.scripts["gen:tokens"]).toBe("bun run scripts/gen-tokens.ts");
        // Tokens first: the login head reads the theme colours from them.
        expect(pkg.scripts["gen:all"]).toBe(
            "bun run gen:tokens && bun run gen:pages",
        );
        for (const path of MARKETING_GENERATORS) {
            expect(await Bun.file(path).exists(), path).toBe(false);
        }
        const genLogin = await Bun.file("./scripts/gen-login.ts").text();
        expect(genLogin).toContain("removeStaleMarketingHtml");
        expect(genLogin).toContain("public/index.html");
        expect(genLogin).toContain("public/llms.txt");
    });

    test("the English login template is present (CI/dev run gen:all before tests)", async () => {
        expect(await Bun.file("./public/login.html").exists()).toBe(true);
        expect(await Bun.file("./public/de/login.html").exists()).toBe(false);
    });

    test("bun run gen:all does not write marketing HTML", async () => {
        await Bun.write(
            "public/index.html",
            "<!doctype html><title>stale marketing</title>",
        );
        const proc = Bun.spawn(["bun", "run", "gen:all"], {
            stdout: "pipe",
            stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
        ]);
        expect(exitCode, `${stderr}\n${stdout}`).toBe(0);
        for (const file of [
            "public/index.html",
            "public/tools.html",
            "public/privacy.html",
            "public/terms.html",
            "public/alternatives/index.html",
            "public/sitemap.xml",
            "public/llms.txt",
        ]) {
            expect(await Bun.file(file).exists(), file).toBe(false);
        }
        expect(await Bun.file("public/login.html").exists()).toBe(true);
    });
});
