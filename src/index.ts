import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { createOAuthRouter } from "./oauth.js";
import {
    authenticateBearer,
    rateLimit,
    banRepeatAuthFailures,
} from "./middleware.js";
import { handleMcp, closeMcpHandler } from "./mcp.js";
import { startExportCleanup } from "./domain/export.js";
import { registerDiscoveryRoutes } from "./discovery.js";
import { maskIp } from "./net.js";
import {
    appScriptHref,
    appStylesheetHref,
    getAppCss,
    getAppJs,
    warmWidgets,
} from "./widgets.js";
import { BRAND_SVGS } from "./brand.js";
import { APP_FONTS } from "./tokens.js";
import { clearSiteCookieHeader } from "./site-session.js";
import { foodsRoutes } from "./web/routes/foods.js";
import { fridgeRoutes } from "./web/routes/fridge.js";
import { groceryRoutes } from "./web/routes/grocery.js";
import { nutritionRoutes } from "./web/routes/nutrition.js";
import { recipesRoutes } from "./web/routes/recipes.js";
import { settingsRoutes } from "./web/routes/settings.js";

const app = new Hono();

// Access log — records every non-health HTTP request (method, path, status,
// duration, masked client subnet) so traffic that never reaches a tool handler
// — and is therefore invisible to tool analytics — is still attributable in the
// runtime logs: unauthenticated /mcp probes (401), rate-limited hits (429),
// OAuth discovery crawls, vuln scanners. Registered first so it runs outermost
// and observes the final response status. /health is skipped to keep the
// platform's frequent health checks from evicting real traffic from the buffer.
// Requests from IPs banned for repeated auth failures are skipped too — they are
// announced once by a [ban] line and would otherwise dominate the log.
app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/health") return next();
    const start = performance.now();
    await next();
    if (c.get("suppressAccessLog")) return;
    const ms = Math.round(performance.now() - start);
    const ip = maskIp(c.req.header("x-forwarded-for"));
    // /mcp serves two protocol eras from one endpoint, and the only way to know
    // when the 2025-11-25 leg can be retired is to count who still uses it.
    // handleMcp publishes the era the SDK actually negotiated (not a guess from
    // headers); requests refused before the factory runs carry none, and simply
    // omit the field.
    const era = c.get("mcpEra");
    // Which client is on which era. The era alone cannot tell a Claude surface
    // from a third-party MCP client sharing an IP range, and that is the
    // question the legacy retirement actually turns on. Absent when the
    // protocol did not carry it — see the note on mcpClient in middleware.ts.
    const client = c.get("mcpClient");
    console.log(
        `[req] ${c.req.method} ${path} ${c.res.status} ${ms}ms ip=${ip}${era ? ` era=${era}` : ""}${client ? ` client=${client}` : ""}`,
    );
});

// Security headers
app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    if (!c.res.headers.get("Content-Security-Policy")) {
        // img-src data: — form.css draws the <select> chevron as an inline
        // SVG data URI; srcdoc widget frames inherit this policy too.
        // script-src keeps 'unsafe-inline' because those same srcdoc frames
        // inherit this policy and run the assembled widget's inline script.
        c.header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        );
    }
    c.header("Referrer-Policy", "no-referrer");
});

// Body limit
app.use(
    "*",
    bodyLimit({
        maxSize: 1024 * 1024,
        onError: (c) => c.json({ error: "payload_too_large" }, 413),
    }),
);

// CORS
app.use(
    "*",
    cors({
        origin: (origin) => {
            if (!origin) return null;
            if (
                origin.match(/^https?:\/\/localhost(:\d+)?$/) ||
                origin.match(/^https?:\/\/127\.0\.0\.1(:\d+)?$/)
            ) {
                return origin;
            }
            const allowed =
                process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ??
                [];
            return allowed.includes(origin) ? origin : null;
        },
        allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
        // allowHeaders is deliberately omitted so Hono reflects the preflight's
        // Access-Control-Request-Headers verbatim (and appends
        // Vary: Access-Control-Request-Headers). A static list structurally
        // cannot work here: the 2026-07-28 revision defines an open-ended
        // Mcp-Param-* family (sent whenever a tool declares x-mcp-header), and
        // CORS allow-lists match exact names, not prefixes — so a pinned list
        // silently breaks any such tool for browser clients. Reflection adds no
        // exposure in this configuration: `origin` above is a strict allowlist,
        // so only origins we already trust get an Allow-Origin at all, and
        // credentials is false, so no cookies or Authorization are attached by
        // the browser on our behalf.
        exposeHeaders: [
            "Mcp-Session-Id",
            "Mcp-Protocol-Version",
            "Content-Type",
        ],
        credentials: false,
        maxAge: 86400,
    }),
);

// Shutdown gate. The signal handlers at the bottom of this file flip
// `shuttingDown`, and from that instant every request is refused here — before
// auth, before rate limiting, before any route. This gate, not closeMcpHandler,
// is what makes a deploy clean: closing the SDK handler flips it to "closed"
// while Bun.serve keeps accepting connections, so without the gate every POST
// /mcp in the shutdown window fell through to the onError catch-all as
// {"error":"internal_server_error"} 500 ("This MCP handler has been closed").
// A 500 reads to a connector as a tool failure; 503 + Retry-After reads as
// "this instance is going away, come back" — which is the truth, and during a
// deploy (SIGTERM) that window hits real users.
// Registered after CORS so the refusal still carries Allow-Origin (a browser
// client sees the 503 rather than an opaque CORS error) and is still access
// logged. OPTIONS preflights never reach it: cors() answers those itself.
let shuttingDown = false;

// Exported for src/index.test.ts. The gate's entire value is WHERE it sits — it
// must run before authenticateBearer and before the /mcp route, which only the
// real `app` can demonstrate. The test flips the flag directly rather than
// calling shutdown(), which would exit the test runner.
export function setShuttingDownForTest(value: boolean): void {
    shuttingDown = value;
}

app.use("*", async (c, next) => {
    if (!shuttingDown) return next();
    const path = new URL(c.req.url).pathname;
    if (path === "/mcp") {
        // /mcp clients speak JSON-RPC, and the flat {"error": …} body used
        // elsewhere in this file is not something an MCP client can surface —
        // it reports a bare transport failure with no reason. Mirror the
        // JSON-RPC error envelope handleMcp's own 405 returns so the client
        // gets a readable message. `id` is null because the body is
        // deliberately not read here; the point of the gate is to answer
        // without doing work.
        return c.json(
            {
                jsonrpc: "2.0",
                id: null,
                error: {
                    code: -32000,
                    message: "Server is shutting down, retry shortly",
                },
            },
            503,
            { "Retry-After": "1" },
        );
    }
    // /health is gated too, on purpose: a health check that starts failing is
    // how the platform's load balancer learns to stop routing here, which is
    // exactly what draining wants. Everything else (OAuth, unauthenticated
    // probes) gets the flat {"error": …} shape the 413 and 500 responses in
    // this file already use.
    return c.json({ error: "shutting_down" }, 503, { "Retry-After": "1" });
});

// OAuth discovery metadata (MCP spec requirement) — protected-resource and
// authorization-server documents, served at the root and at the path-folded
// variants clients derive from the /mcp endpoint. See src/discovery.ts.
registerDiscoveryRoutes(app);

// OAuth routes
app.route("/", createOAuthRouter());

// MCP endpoint (protected). banRepeatAuthFailures runs first so a client stuck
// in a failed-auth retry loop is rejected before any token verification.
app.all(
    "/mcp",
    banRepeatAuthFailures,
    authenticateBearer,
    rateLimit,
    handleMcp,
);

app.route("/", nutritionRoutes);
app.route("/", foodsRoutes);
app.route("/", fridgeRoutes);
app.route("/", groceryRoutes);
app.route("/", recipesRoutes);
app.route("/", settingsRoutes);

app.get("/logout", (c) => {
    const secure =
        c.req.header("x-forwarded-proto") === "https" ||
        new URL(c.req.url).protocol === "https:";
    c.header("Set-Cookie", clearSiteCookieHeader(secure));
    return c.redirect("/");
});

// Static assets. Login and the household app share /app.css (assembled from
// the widget partials, src/widgets.ts) and /app.js (the client bundle from
// src/web/client/). Marketing HTML, its stylesheet and site.js are gone;
// leftover files on disk must not become routes (a registered path that
// reads a missing file 500s). App fonts are served from the APP_FONTS
// allowlist below.
app.get("/robots.txt", async (c) => {
    return c.body(await Bun.file("./public/robots.txt").text(), 200, {
        "Content-Type": "text/plain",
    });
});
function appAssetCacheControl(
    c: { req: { query: (k: string) => string | undefined } },
    currentHref: string,
): string {
    const v = c.req.query("v");
    const currentV = new URL(`http://x${currentHref}`).searchParams.get("v");
    if (v && currentV && v === currentV) {
        return "public, max-age=31536000, immutable";
    }
    return "no-cache";
}

app.get("/app.css", async (c) => {
    const href = appStylesheetHref();
    return c.body(await getAppCss(), 200, {
        "Content-Type": "text/css; charset=utf-8",
        "Cache-Control": appAssetCacheControl(c, href),
    });
});
app.get("/app.js", async (c) => {
    const href = appScriptHref();
    return c.body(await getAppJs(), 200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": appAssetCacheControl(c, href),
    });
});
app.get("/favicon.ico", async (c) => {
    try {
        const file = Bun.file("./public/favicon.ico");
        return c.body(await file.arrayBuffer(), 200, {
            "Content-Type": "image/x-icon",
        });
    } catch {
        return c.notFound();
    }
});
app.get("/apple-touch-icon.png", async (c) => {
    const file = Bun.file("./public/apple-touch-icon.png");
    if (!(await file.exists())) return c.notFound();
    return c.body(await file.arrayBuffer(), 200, {
        "Content-Type": "image/png",
    });
});
// Rendered from src/brand.ts, the source the committed public/brand/ files
// are generated from, so the served SVG cannot lag behind an edit.
app.get("/brand/:file", (c) => {
    const render = Object.hasOwn(BRAND_SVGS, c.req.param("file"))
        ? BRAND_SVGS[c.req.param("file")]
        : undefined;
    if (!render) return c.notFound();
    return c.body(render(), 200, {
        "Content-Type": "image/svg+xml; charset=utf-8",
    });
});

// Self-hosted web fonts for the app and login (OFL 1.1), listed once in
// src/tokens.ts. An allowlist, so a stray file in public/fonts never becomes
// a route.
const FONTS = new Set<string>(APP_FONTS.map((f) => f.file));
app.get("/fonts/:file", async (c) => {
    const name = c.req.param("file");
    if (!FONTS.has(name)) return c.notFound();
    const file = Bun.file(`./public/fonts/${name}`);
    if (!(await file.exists())) return c.notFound();
    return c.body(await file.arrayBuffer(), 200, {
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=31536000, immutable",
    });
});

// Health check
app.get("/health", (c) => c.text("ok"));

// Error handler
app.onError((_err, c) => {
    console.error("Unhandled error:", _err);
    return c.json({ error: "internal_server_error" }, 500);
});

const port = parseInt(process.env.PORT || "8080");

// Boot side effects run only when this file IS the entrypoint. src/index.test.ts
// imports `app` to pin the shutdown gate's position in the middleware chain, and
// an import must not start the export-sweep interval (which would hit Supabase
// on a timer and hold the test process open) or register signal handlers.
// `bun run src/index.ts` still takes this branch — verified: import.meta.main is
// true for the entrypoint and false under `bun test`.
if (import.meta.main) {
    console.log(`Foodable server listening on 0.0.0.0:${port}`);

    // Assemble every MCP Apps widget from its source partials up front, so a
    // broken @include/partial fails fast at boot rather than on a client's
    // first tool call.
    await warmWidgets();

    // Periodically delete expired meal-export files from the storage bucket.
    startExportCleanup();

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

// Exit cleanly on shutdown signals (e.g. deploys). /mcp is stateless — no
// server-side sessions are held — so the only thing worth sequencing is the
// order of the two steps below.
//
// Setting `shuttingDown` is the load-bearing one: it arms the 503 gate above,
// which is what actually stops new work and what keeps a deploy from serving
// 500s. closeMcpHandler is not a general drain and must not be described as
// one — it aborts only 2026-era exchanges the SDK handler is tracking, so
// legacy-era (2025-11-25) requests in flight are unaffected either way. The
// gate runs first precisely because close() cannot be relied on to cover them.
//
// The 2s bound exists so a single wedged exchange cannot hold the process past
// the platform's grace period and turn a clean stop into a SIGKILL, and the
// .catch is there because a rejected close() would otherwise surface as an
// unhandled rejection on the way out.
function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down...`);
    void Promise.race([
        closeMcpHandler(),
        new Promise((r) => setTimeout(r, 2000)),
    ])
        .catch((err) => console.error("Error closing MCP handler:", err))
        .finally(() => process.exit(0));
}
// Exported for src/index.test.ts, which drives the real route table through
// app.request(). Bun serves from the default export below.
export { app };

export default {
    port,
    hostname: "0.0.0.0",
    // Long-lived MCP streams (StreamableHTTP GET/SSE) can idle between events;
    // Bun's 10s default closes them and logs "request timed out after 10
    // seconds". Raise it so legitimate streaming connections aren't severed.
    idleTimeout: 120,
    fetch: app.fetch,
};
