import { test, expect, describe } from "bun:test";
import { NUTRITION_CARDS } from "./domain/layout.js";
import { getEmbedCss, getEmbedWidgetHtml, getWidgetHtml } from "./widgets.js";

// index.ts throws at import when the OAuth env is unset. Same prelude as
// src/index.test.ts: set the defaults before the dynamic import.
process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("./index.js");

const APP_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'";

describe("GET /app/widgets/:key", () => {
    test("serves an allowlisted widget unauthenticated and 404s anything else", async () => {
        for (const key of NUTRITION_CARDS) {
            const r = await app.request(`http://x/app/widgets/${key}`);
            expect(r.status, key).toBe(200);
            expect(r.headers.get("content-type")).toBe(
                "text/html; charset=utf-8",
            );
        }
        for (const key of ["meal-logged", "fridge", "nope", "constructor"]) {
            const r = await app.request(`http://x/app/widgets/${key}`);
            expect(r.status, key).toBe(404);
            expect(r.headers.get("x-frame-options")).toBe("DENY");
        }
    });

    test("matching v is immutable and any other v is no-cache", async () => {
        const { hash } = await getEmbedWidgetHtml("trends");
        const fresh = await app.request(
            `http://x/app/widgets/trends?v=${hash}`,
        );
        expect(fresh.status).toBe(200);
        expect(fresh.headers.get("cache-control")).toBe(
            "public, max-age=31536000, immutable",
        );
        const stale = await app.request(
            "http://x/app/widgets/trends?v=deadbeefdead",
        );
        expect(stale.status).toBe(200);
        expect(stale.headers.get("cache-control")).toBe("no-cache");
        const missing = await app.request("http://x/app/widgets/trends");
        expect(missing.headers.get("cache-control")).toBe("no-cache");
    });

    test("framing is same-origin on this route and denied everywhere else", async () => {
        const widget = await app.request(
            "http://x/app/widgets/nutrition-summary",
        );
        expect(widget.headers.get("x-frame-options")).toBe("SAMEORIGIN");
        const widgetCsp = widget.headers.get("content-security-policy") ?? "";
        expect(widgetCsp).toBe(APP_CSP.replace("'none'", "'self'"));
        expect(widgetCsp).toContain("frame-ancestors 'self'");
        expect(widgetCsp).toContain("script-src 'self' 'unsafe-inline'");
        expect(widgetCsp).toContain("style-src 'self' 'unsafe-inline'");

        for (const path of ["/", "/app.css"]) {
            const r = await app.request(`http://x${path}`);
            expect(r.status, path).toBe(200);
            expect(r.headers.get("x-frame-options"), path).toBe("DENY");
            expect(r.headers.get("content-security-policy"), path).toBe(
                APP_CSP,
            );
        }
    });

    test("the framed document seeds from the parent and the MCP document does not", async () => {
        const key = "goal-progress";
        const { html } = await getEmbedWidgetHtml(key);
        const served = await (
            await app.request(`http://x/app/widgets/${key}`)
        ).text();
        expect(served).toBe(html);
        expect(html).toContain("frame.dataset.widgetData");
        expect(html).toContain("window.__WIDGET_DATA__ = JSON.parse(raw)");
        expect(html).not.toContain("__WIDGET_DATA__=");
        expect(html.indexOf("frame.dataset.widgetData")).toBeLessThan(
            html.indexOf("<style"),
        );
        expect(html).toContain(`<style>${await getEmbedCss()}</style></head>`);
        expect(html).toContain("Geist");
        expect(html).not.toMatch(/\sdata-theme="/);

        const mcp = await getWidgetHtml(key);
        expect(mcp).not.toContain("frame.dataset.widgetData");
        expect(mcp).not.toContain("window.frameElement");
        expect(mcp).not.toContain("Geist");
    });
});
