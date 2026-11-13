import { test, expect, describe } from "bun:test";

// index.ts throws at import when the OAuth env is unset. Same prelude as
// src/index.test.ts: set the defaults before the dynamic import.
process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("./index.js");

const APP_CSP =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'";

describe("the retired embedded widget route", () => {
    test("GET /app/widgets/:key is gone", async () => {
        for (const key of [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
            "nope",
        ]) {
            const r = await app.request(`http://x/app/widgets/${key}`);
            expect(r.status, key).toBe(404);
            expect(r.headers.get("x-frame-options"), key).toBe("DENY");
        }
    });

    test("no response may be framed", async () => {
        for (const path of ["/", "/app.css"]) {
            const r = await app.request(`http://x${path}`);
            expect(r.status, path).toBe(200);
            expect(r.headers.get("x-frame-options"), path).toBe("DENY");
            expect(r.headers.get("content-security-policy"), path).toBe(
                APP_CSP,
            );
        }
    });
});
