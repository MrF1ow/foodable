import { test, expect, mock, afterAll } from "bun:test";
import { Hono } from "hono";
import * as actualTokens from "./db/tokens.js";

const realTokens = { ...actualTokens };

const VALID_CHALLENGE = "a".repeat(43);
const ALLOWED_REDIRECT = "http://localhost:8080/callback";

let authCodeStub: actualTokens.AuthCodeData | null = null;

mock.module("./db/tokens.js", () => ({
    ...actualTokens,
    lookupBearer: async (token: string) =>
        token === "valid-token"
            ? { status: "valid", kind: "user", userId: "user-1" }
            : token === "hh-token"
              ? { status: "valid", kind: "household", householdId: "hh-1" }
              : { status: "invalid" },
    consumeAuthCode: async () => authCodeStub,
    storeToken: async () => {},
    storeRefreshToken: async () => {},
    registerClient: async () => {},
}));
afterAll(() => {
    mock.module("./db/tokens.js", () => realTokens);
});

const {
    OAUTH_PATHS,
    beginSiteLogin,
    createOAuthRouter,
    renderLoginPage,
    resolveApproveUser,
    classifySignInFailure,
} = await import("./oauth.js");
const { _resetBuckets } = await import("./rate-limit.js");

// createOAuthRouter() refuses to build without these; the values are never
// exercised by the rate-limit tests below.
process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

// Minimal fake session — every renderLoginPage call needs one now that the
// language switcher's links are reconstructed from its fields.
function fakeSession() {
    return {
        state: "state-xyz",
        redirectUri: ALLOWED_REDIRECT,
        clientId: "test-client-id",
        purpose: "mcp" as const,
    };
}

function authorizeUrl(redirectUri: string, overrides?: Record<string, string>) {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.OAUTH_CLIENT_ID!,
        redirect_uri: redirectUri,
        state: "state-xyz",
        code_challenge: VALID_CHALLENGE,
        code_challenge_method: "S256",
        ...overrides,
    });
    return `/authorize?${params}`;
}

test("renderLoginPage substitutes every {{SESSION_ID}} occurrence", async () => {
    const sessionId = "session-abc-123";
    const html = await renderLoginPage(sessionId, fakeSession());

    expect(html).not.toContain("{{SESSION_ID}}");
    expect(html).toContain(`value="${sessionId}"`);
    expect(html).not.toContain("/authorize/google");
});

test("renderLoginPage shows MCP redirect host hint", async () => {
    const html = await renderLoginPage("s1", fakeSession());
    expect(html).toContain("Signing in to connect");
    expect(html).toContain("<strong>localhost</strong>");
    expect(html).not.toContain("{{CONNECT_HINT}}");
});

test("renderLoginPage renders the error banner only when given an error", async () => {
    const clean = await renderLoginPage("s1", fakeSession());
    expect(clean).not.toContain("{{ERROR}}");
    expect(clean).not.toContain("error-banner");

    const withError = await renderLoginPage(
        "s1",
        fakeSession(),
        "Bad <stuff> & things",
    );
    expect(withError).toContain("error-banner");
    // Error text is HTML-escaped.
    expect(withError).toContain("Bad &lt;stuff&gt; &amp; things");
});

test("renderLoginPage has no language switcher or translation notice", async () => {
    const html = await renderLoginPage("s1", fakeSession());
    expect(html).not.toContain("{{LANG_SWITCHER}}");
    expect(html).not.toContain("{{TRANSLATION_NOTICE}}");
    expect(html).not.toContain('class="lang-switch"');
    expect(html).not.toContain('class="translation-notice"');
    expect(html).not.toContain("/?locale=");
    expect(html).toContain('<html lang="en">');
});

test("generated login uses the shared app stylesheet and no web fonts", async () => {
    const html = await renderLoginPage("s1", fakeSession());
    expect(html).toContain('<link rel="stylesheet" href="/app.css" />');
    expect(html).toContain('<script src="/app.js" defer></script>');
    expect(html).toContain('class="auth-stage native"');
    expect(html).toContain('class="btn-primary"');
    expect(html).not.toContain("/styles.css");
    expect(html).not.toContain("/site.js");
    expect(html).not.toContain("/fonts/");
    expect(html).not.toContain("#2f8fd4");
    expect(html).not.toContain("auth-btn");
});

test("first Auth user may sign up after a failed sign-in", async () => {
    let signUps = 0;
    const userId = await resolveApproveUser({
        email: "founder@example.com",
        password: "secret12",
        authUserCount: async () => 0,
        signInUser: async () => {
            throw new Error("Invalid login credentials");
        },
        signUpUser: async (email, password) => {
            signUps += 1;
            expect(email).toBe("founder@example.com");
            expect(password).toBe("secret12");
            return "11111111-1111-4111-8111-111111111111";
        },
        messages: MESSAGES,
    });
    expect(userId).toBe("11111111-1111-4111-8111-111111111111");
    expect(signUps).toBe(1);
});

const MESSAGES = {
    invalidCredentials: "Wrong email, username or password.",
    signInUnavailable: "Couldn't sign in right now. Try again in a minute.",
};

// Shaped like the SignInError src/db/client.ts throws for a Supabase refusal.
function supabaseError(status: number | undefined, code?: string): Error {
    return Object.assign(new Error("Invalid login credentials"), {
        status,
        code,
    });
}

test("a wrong password after the owner exists says so and never signs up", async () => {
    let signUps = 0;
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warns.push(String(args[0]));
    };
    try {
        await expect(
            resolveApproveUser({
                email: "stranger@example.com",
                password: "wrong-password",
                authUserCount: async () => 1,
                signInUser: async () => {
                    throw supabaseError(400, "invalid_credentials");
                },
                signUpUser: async () => {
                    signUps += 1;
                    return "should-not-create";
                },
                messages: MESSAGES,
            }),
        ).rejects.toThrow(MESSAGES.invalidCredentials);
    } finally {
        console.warn = originalWarn;
    }
    expect(signUps).toBe(0);
    expect(warns).toContain("[auth] sign-in refused: invalid credentials");
});

for (const [label, err] of [
    ["a timeout with no status", supabaseError(undefined)],
    ["a rate limit", supabaseError(429, "over_request_rate_limit")],
    ["a Supabase 500", supabaseError(500, "unexpected_failure")],
] as const) {
    test(`${label} is not reported as a wrong password`, async () => {
        const originalError = console.error;
        console.error = () => {};
        try {
            await expect(
                resolveApproveUser({
                    email: "founder@example.com",
                    password: "right-password",
                    authUserCount: async () => 1,
                    signInUser: async () => {
                        throw err;
                    },
                    signUpUser: async () => "should-not-create",
                    messages: MESSAGES,
                }),
            ).rejects.toThrow(MESSAGES.signInUnavailable);
        } finally {
            console.error = originalError;
        }
    });
}

test("classifySignInFailure separates typos, account states and outages", () => {
    expect(
        classifySignInFailure(supabaseError(400, "invalid_credentials")),
    ).toBe("credentials");
    expect(classifySignInFailure(supabaseError(400))).toBe("credentials");
    // An unconfirmed email is not a wrong password and not an outage.
    expect(
        classifySignInFailure(supabaseError(400, "email_not_confirmed")),
    ).toBe("account");
    expect(classifySignInFailure(supabaseError(403, "user_banned"))).toBe(
        "account",
    );
    expect(
        classifySignInFailure(supabaseError(429, "over_request_rate_limit")),
    ).toBe("unavailable");
    expect(classifySignInFailure(supabaseError(503))).toBe("unavailable");
    expect(classifySignInFailure(new Error("network down"))).toBe(
        "unavailable",
    );
    expect(classifySignInFailure("nope")).toBe("unavailable");
});

test("an account-state refusal shows Supabase's own message", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await expect(
            resolveApproveUser({
                email: "sam@example.com",
                password: "right-password",
                authUserCount: async () => 1,
                signInUser: async () => {
                    throw Object.assign(new Error("Email not confirmed"), {
                        status: 400,
                        code: "email_not_confirmed",
                    });
                },
                signUpUser: async () => "should-not-create",
                messages: MESSAGES,
            }),
        ).rejects.toThrow("Email not confirmed");
    } finally {
        console.warn = originalWarn;
    }
});

test("existing users still sign in after signup closes", async () => {
    let signUps = 0;
    const userId = await resolveApproveUser({
        email: "founder@example.com",
        password: "secret12",
        authUserCount: async () => 1,
        signInUser: async () => "11111111-1111-4111-8111-111111111111",
        signUpUser: async () => {
            signUps += 1;
            return "should-not-create";
        },
        messages: MESSAGES,
    });
    expect(userId).toBe("11111111-1111-4111-8111-111111111111");
    expect(signUps).toBe(0);
});

// ---------- OAuth rate-limit scoping ----------

// The HTTP method each OAuth path is registered with, so the table-driven test
// drives the route the router actually serves rather than a 404.
const OAUTH_METHODS: Record<(typeof OAUTH_PATHS)[number], string> = {
    "/register": "POST",
    "/authorize": "GET",
    "/approve": "POST",
    "/token": "POST",
};

// Mirrors how src/index.ts wires things up: the OAuth router is mounted at the
// root (the OAuth paths are spec-fixed there) with /mcp as a sibling route.
function buildTestApp() {
    let mcpHits = 0;
    const app = new Hono();
    app.route("/", createOAuthRouter());
    app.all("/mcp", (c) => {
        mcpHits++;
        return c.text("ok");
    });
    // These tests send deliberately malformed bodies so handlers bail out before
    // touching Supabase; swallow the resulting throws instead of logging 30 of
    // them per path. Status codes are what the assertions look at.
    app.onError((_err, c) => c.text("handler error", 500));
    return { app, mcpHits: () => mcpHits };
}

function fire(app: Hono, method: string, path: string, ip: string) {
    return app.request(`http://localhost${path}`, {
        method,
        headers: { "x-forwarded-for": ip },
    });
}

// The bug this guards: `oauth.use("*", rateLimitAuth)` inside the router. Hono
// applies a sub-app's wildcard middleware to every path of the parent app, so
// the 30/min per-IP OAuth limiter also governed /mcp — capping all authenticated
// MCP traffic behind a shared egress IP well below the intended 60/min per-user
// limit. A structural assertion on OAUTH_PATHS would not have caught this;
// only actually driving /mcp past the auth limit does.
test("the OAuth rate limiter does not leak onto /mcp", async () => {
    _resetBuckets();
    const { app, mcpHits } = buildTestApp();

    // Read the per-IP auth limit off a real OAuth response instead of hardcoding
    // it, so this stays correct if the limit is retuned.
    const probe = await fire(app, "GET", "/authorize", "203.0.113.9");
    const authLimit = Number(probe.headers.get("X-RateLimit-Limit"));
    expect(authLimit).toBeGreaterThan(0);
    _resetBuckets();

    const total = authLimit * 3;
    for (let i = 0; i < total; i++) {
        const res = await fire(app, "POST", "/mcp", "198.51.100.7");
        expect(res.status).not.toBe(429);
        // rateLimitAuth always stamps these; their absence proves it never ran.
        expect(res.headers.get("X-RateLimit-Limit")).toBeNull();
    }
    // Every request reached the handler — none were short-circuited.
    expect(mcpHits()).toBe(total);
});

// Table-driven so a route added to the router but left out of OAUTH_PATHS fails
// here: dropping the limiter from an unauthenticated endpoint is a security
// regression, and it is the main risk of scoping the middleware by path.
test("every OAuth endpoint is still rate-limited", async () => {
    for (const [i, path] of OAUTH_PATHS.entries()) {
        _resetBuckets();
        const { app } = buildTestApp();
        const method = OAUTH_METHODS[path]!;
        // Distinct IP per path so the buckets can't bleed into each other.
        const ip = `192.0.2.${i + 1}`;

        let limit = 0;
        let saw429 = false;
        for (let n = 0; n <= 200; n++) {
            const res = await fire(app, method, path, ip);
            if (n === 0) {
                limit = Number(res.headers.get("X-RateLimit-Limit"));
                expect(limit).toBeGreaterThan(0);
            }
            if (n < limit) {
                // Within the window: whatever the handler does, it isn't a 429.
                expect(res.status).not.toBe(429);
                continue;
            }
            expect(res.status).toBe(429);
            expect(res.headers.get("Retry-After")).toBeTruthy();
            saw429 = true;
            break;
        }
        expect(saw429).toBe(true);
    }
});

// OAUTH_PATHS is now the list the limiter is attached to, so it must stay in
// sync with the routes the router registers, including their methods.
test("OAUTH_PATHS covers exactly the router's registered routes", () => {
    const registered = new Set(
        createOAuthRouter()
            .routes.filter((r) => r.method !== "ALL")
            .map((r) => r.path),
    );
    expect([...registered].sort()).toEqual([...OAUTH_PATHS].sort());
    expect(Object.keys(OAUTH_METHODS).sort()).toEqual([...OAUTH_PATHS].sort());
});

// ---------- OAuth redirect allow-list and PKCE ----------

test("/authorize rejects disallowed redirect_uri with 400 and no Location", async () => {
    const { app } = buildTestApp();
    const res = await app.request(
        `http://localhost${authorizeUrl("https://evil.example/cb")}`,
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("Location")).toBeNull();
    const body = (await res.json()) as {
        error_description?: string;
    };
    expect(body.error_description).toBe("redirect_uri is not allowed");
});

test("/authorize requires code_challenge", async () => {
    const { app } = buildTestApp();
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.OAUTH_CLIENT_ID!,
        redirect_uri: ALLOWED_REDIRECT,
        state: "x",
        code_challenge_method: "S256",
    });
    const res = await app.request(`http://localhost/authorize?${params}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
        error_description?: string;
    };
    expect(body.error_description).toBe("code_challenge is required");
});

test("/authorize rejects plain PKCE method", async () => {
    const { app } = buildTestApp();
    const res = await app.request(
        `http://localhost${authorizeUrl(ALLOWED_REDIRECT, {
            code_challenge_method: "plain",
        })}`,
    );
    expect(res.status).toBe(400);
});

test("/register omits client_secret and validates redirect_uris", async () => {
    const { app } = buildTestApp();
    const ok = await app.request("http://localhost/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            redirect_uris: [ALLOWED_REDIRECT],
        }),
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as {
        token_endpoint_auth_method?: string;
        client_secret?: string;
    };
    expect(body).not.toHaveProperty("client_secret");
    expect(body.token_endpoint_auth_method).toBe("none");

    const bad = await app.request("http://localhost/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            redirect_uris: ["https://evil.example/cb"],
        }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error?: string }).error).toBe(
        "invalid_redirect_uri",
    );
});

test("/token authorization_code requires redirect_uri and code_verifier", async () => {
    authCodeStub = {
        code: "c",
        redirect_uri: ALLOWED_REDIRECT,
        user_id: "user-1",
        code_challenge: VALID_CHALLENGE,
    };
    const { app } = buildTestApp();
    const form = (fields: Record<string, string>) =>
        app.request("http://localhost/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: "c",
                ...fields,
            }),
        });

    const noRedirect = await form({ code_verifier: "v" });
    expect(noRedirect.status).toBe(400);

    const noVerifier = await form({ redirect_uri: ALLOWED_REDIRECT });
    expect(noVerifier.status).toBe(400);
});

test("beginSiteLogin still renders login without MCP connect hint", async () => {
    const app = new Hono();
    app.get("/", (c) => beginSiteLogin(c));
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('action="/approve"');
    // One field takes an email or a username, so it cannot be type="email"
    // (the browser would refuse a bare username before it reached /approve).
    expect(html).toContain('<input type="text" id="email" name="email"');
    expect(html).toContain("Email or username");
    expect(html).not.toContain("Signing in to connect");
});
