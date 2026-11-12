import { test, expect, mock, afterAll, beforeAll } from "bun:test";
import { setClientIpConfigForTests } from "./client-ip.js";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import * as actualTokens from "./db/tokens.js";

const realTokens = { ...actualTokens };

const VALID_CHALLENGE = "a".repeat(43);
const ALLOWED_REDIRECT = "http://localhost:8080/callback";

let authCodeStub: actualTokens.AuthCodeData | null = null;
let refreshStub: { userId: string; clientId: string | null } | null = null;
let registeredStub: string | null = null;
const REGISTERED_CLIENT = "11111111-2222-4333-8444-555555555555";
const issued: Array<{
    kind: "access" | "refresh";
    userId: string;
    clientId: string | null;
}> = [];

mock.module("./db/tokens.js", () => ({
    ...actualTokens,
    lookupBearer: async (token: string) =>
        token === "valid-token"
            ? { status: "valid", kind: "user", userId: "user-1" }
            : token === "hh-token"
              ? { status: "valid", kind: "household", householdId: "hh-1" }
              : { status: "invalid" },
    consumeAuthCode: async () => authCodeStub,
    consumeRefreshToken: async () => refreshStub,
    storeToken: async (
        _t: string,
        userId: string,
        clientId?: string | null,
    ) => {
        issued.push({ kind: "access", userId, clientId: clientId ?? null });
    },
    storeRefreshToken: async (
        _t: string,
        userId: string,
        clientId?: string | null,
    ) => {
        issued.push({ kind: "refresh", userId, clientId: clientId ?? null });
    },
    registerClient: async () => registeredStub,
    isRegisteredClient: async (id: string) => id === REGISTERED_CLIENT,
}));
afterAll(() => {
    mock.module("./db/tokens.js", () => realTokens);
});

const {
    OAUTH_PATHS,
    beginSiteLogin,
    MAX_SITE_LOGIN_SESSIONS,
    siteLoginSessionCount,
    createOAuthRouter,
    renderLoginPage,
    resolveApproveUser,
    classifySignInFailure,
    logRejectedRedirect,
    siteLoginReturnPath,
} = await import("./oauth.js");
const { _resetBuckets } = await import("./rate-limit.js");

beforeAll(() =>
    setClientIpConfigForTests({
        source: "x-forwarded-for",
        sourceIsDefault: false,
        trustedHops: 1,
        cloudflareOriginSecret: null,
    }),
);
afterAll(() => setClientIpConfigForTests(null));

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
    expect(html).not.toContain("{{APP_CSS_HREF}}");
    expect(html).not.toContain("{{APP_JS_HREF}}");
    expect(html).toMatch(
        /<link rel="stylesheet" href="\/app\.css\?v=[a-f0-9]{12}" data-turbo-track="reload" \/>/,
    );
    expect(html).toContain('data-turbo="false"');
    expect(html).toContain(
        '<meta name="turbo-visit-control" content="reload" />',
    );
    expect(html).toMatch(
        /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
    );
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
        password: "secret123456",
        authUserCount: async () => 0,
        householdExists: async () => false,
        signInUser: async () => {
            throw new Error("Invalid login credentials");
        },
        signUpUser: async (email, password) => {
            signUps += 1;
            expect(email).toBe("founder@example.com");
            expect(password).toBe("secret123456");
            return "11111111-1111-4111-8111-111111111111";
        },
        messages: MESSAGES,
    });
    expect(userId).toBe("11111111-1111-4111-8111-111111111111");
    expect(signUps).toBe(1);
});

const { LOGIN_ERRORS: MESSAGES } = await import("./copy/login.js");

// Shaped like SignInError from src/domain/auth.ts (legacy GoTrue status/code).
function signInError(status: number | undefined, code?: string): Error {
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
                householdExists: async () => true,
                signInUser: async () => {
                    throw signInError(400, "invalid_credentials");
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
    ["a timeout with no status", signInError(undefined)],
    ["a rate limit", signInError(429, "over_request_rate_limit")],
    ["a server 500", signInError(500, "unexpected_failure")],
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
                    householdExists: async () => true,
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
    expect(classifySignInFailure(signInError(400, "invalid_credentials"))).toBe(
        "credentials",
    );
    expect(classifySignInFailure(signInError(400))).toBe("credentials");
    // An unconfirmed email is not a wrong password and not an outage.
    expect(classifySignInFailure(signInError(400, "email_not_confirmed"))).toBe(
        "account",
    );
    expect(classifySignInFailure(signInError(403, "user_banned"))).toBe(
        "account",
    );
    expect(
        classifySignInFailure(signInError(429, "over_request_rate_limit")),
    ).toBe("unavailable");
    expect(classifySignInFailure(signInError(503))).toBe("unavailable");
    expect(classifySignInFailure(new Error("network down"))).toBe(
        "unavailable",
    );
    expect(classifySignInFailure("nope")).toBe("unavailable");
});

test("an account-state refusal shows the sign-in error's own message", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        await expect(
            resolveApproveUser({
                email: "sam@example.com",
                password: "right-password",
                authUserCount: async () => 1,
                householdExists: async () => true,
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
        password: "secret123456",
        authUserCount: async () => 1,
        householdExists: async () => true,
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

function failedSignIn(): never {
    throw Object.assign(new Error("Invalid login credentials"), {
        status: 400,
        code: "invalid_credentials",
    });
}

// A deploy with an owner, where every sign-in attempt fails on credentials.
function inviteArgs(over: Partial<Parameters<typeof resolveApproveUser>[0]>) {
    return {
        email: "newbie@example.com",
        password: "secret123456",
        authUserCount: async () => 1,
        householdExists: async () => true,
        signupPolicy: "invite" as const,
        accountExists: async () => false,
        signInUser: async () => failedSignIn(),
        signUpUser: async (): Promise<string> => {
            throw new Error("plain sign-up must not run under invite");
        },
        signUpWithInvite: async () => {
            throw new Error("invite sign-up must not run");
        },
        messages: MESSAGES,
        ...over,
    };
}

test("invite policy signs up once with a valid code", async () => {
    const calls: unknown[] = [];
    const userId = await resolveApproveUser(
        inviteArgs({
            inviteCode: " test-invite-code ",
            peekInvite: async () => ({ valid: true }),
            signUpWithInvite: async (args) => {
                calls.push(args);
                return {
                    ok: true,
                    userId: "22222222-2222-4222-8222-222222222222",
                    householdId: "hh-invite-1",
                };
            },
        }),
    );
    expect(userId).toBe("22222222-2222-4222-8222-222222222222");
    expect(calls).toEqual([
        {
            code: "test-invite-code",
            email: "newbie@example.com",
            password: "secret123456",
            displayName: "newbie",
        },
    ]);
});

test("invite policy: a new email with no code is told a code is needed", async () => {
    await expect(resolveApproveUser(inviteArgs({}))).rejects.toThrow(
        MESSAGES.inviteRequired,
    );
    await expect(
        resolveApproveUser(inviteArgs({ inviteCode: "   " })),
    ).rejects.toThrow(MESSAGES.inviteRequired);
});

test("invite policy: a new email with a bad, expired or used code is told so", async () => {
    await expect(
        resolveApproveUser(
            inviteArgs({
                inviteCode: "nope",
                peekInvite: async () => ({ valid: false }),
            }),
        ),
    ).rejects.toThrow(MESSAGES.invalidInvite);
    // Valid when peeked, used by someone else before the claim.
    await expect(
        resolveApproveUser(
            inviteArgs({
                inviteCode: "raced",
                peekInvite: async () => ({ valid: true }),
                signUpWithInvite: async () => ({
                    ok: false,
                    reason: "invalid-invite",
                }),
            }),
        ),
    ).rejects.toThrow(MESSAGES.invalidInvite);
});

test("invite policy: an existing account with a wrong password gets the plain answer", async () => {
    let peeks = 0;
    for (const inviteCode of [undefined, "", "some-code"]) {
        await expect(
            resolveApproveUser(
                inviteArgs({
                    inviteCode,
                    accountExists: async () => true,
                    peekInvite: async () => {
                        peeks += 1;
                        return { valid: true };
                    },
                }),
            ),
        ).rejects.toThrow(MESSAGES.invalidCredentials);
    }
    expect(peeks).toBe(0);
});

test("invite policy: an account created between the checks gets the plain answer", async () => {
    await expect(
        resolveApproveUser(
            inviteArgs({
                inviteCode: "good",
                peekInvite: async () => ({ valid: true }),
                signUpWithInvite: async () => ({
                    ok: false,
                    reason: "already-registered",
                }),
            }),
        ),
    ).rejects.toThrow(MESSAGES.invalidCredentials);
});

test("closed policy: known and unknown emails get the same answer, with no lookup, whatever the invite field holds", async () => {
    for (const inviteCode of [undefined, "", "   ", "x", "junk-code"]) {
        for (const known of [false, true]) {
            let lookups = 0;
            let peeks = 0;
            await expect(
                resolveApproveUser(
                    inviteArgs({
                        signupPolicy: "closed",
                        inviteCode,
                        accountExists: async () => {
                            lookups += 1;
                            return known;
                        },
                        peekInvite: async () => {
                            peeks += 1;
                            return { valid: true };
                        },
                    }),
                ),
            ).rejects.toThrow(MESSAGES.invalidCredentials);
            expect(lookups).toBe(0);
            expect(peeks).toBe(0);
        }
    }
});

test("closed by default: with FOODABLE_SIGNUP_POLICY unset, a junk invite code reveals nothing", async () => {
    const { resetSignupPolicyCache } = await import("./domain/signup.js");
    const saved = process.env.FOODABLE_SIGNUP_POLICY;
    delete process.env.FOODABLE_SIGNUP_POLICY;
    resetSignupPolicyCache();
    try {
        let lookups = 0;
        for (const known of [false, true]) {
            await expect(
                resolveApproveUser(
                    inviteArgs({
                        signupPolicy: undefined,
                        inviteCode: "junk",
                        accountExists: async () => {
                            lookups += 1;
                            return known;
                        },
                    }),
                ),
            ).rejects.toThrow(MESSAGES.invalidCredentials);
        }
        expect(lookups).toBe(0);
    } finally {
        if (saved === undefined) delete process.env.FOODABLE_SIGNUP_POLICY;
        else process.env.FOODABLE_SIGNUP_POLICY = saved;
        resetSignupPolicyCache();
    }
});

test("open policy allows a second sign-up", async () => {
    let signUps = 0;
    const userId = await resolveApproveUser(
        inviteArgs({
            email: "solo@example.com",
            signupPolicy: "open",
            signUpUser: async () => {
                signUps += 1;
                return "33333333-3333-4333-8333-333333333333";
            },
        }),
    );
    expect(userId).toBe("33333333-3333-4333-8333-333333333333");
    expect(signUps).toBe(1);
});

test("open policy: an existing account with a wrong password gets the plain answer", async () => {
    await expect(
        resolveApproveUser(
            inviteArgs({
                signupPolicy: "open",
                accountExists: async () => true,
            }),
        ),
    ).rejects.toThrow(MESSAGES.invalidCredentials);
});

test("closed policy refuses a second sign-up", async () => {
    let signUps = 0;
    await expect(
        resolveApproveUser({
            email: "stranger@example.com",
            password: "secret123456",
            authUserCount: async () => 1,
            householdExists: async () => true,
            signupPolicy: "closed",
            signInUser: async () => {
                throw Object.assign(new Error("Invalid login credentials"), {
                    status: 400,
                    code: "invalid_credentials",
                });
            },
            signUpUser: async () => {
                signUps += 1;
                return "should-not-create";
            },
            messages: MESSAGES,
        }),
    ).rejects.toThrow(MESSAGES.invalidCredentials);
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
    // touching the database; swallow the resulting throws instead of logging 30 of
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
    await _resetBuckets();
    const { app, mcpHits } = buildTestApp();

    // Read the per-IP auth limit off a real OAuth response instead of hardcoding
    // it, so this stays correct if the limit is retuned.
    const probe = await fire(app, "GET", "/authorize", "203.0.113.9");
    const authLimit = Number(probe.headers.get("X-RateLimit-Limit"));
    expect(authLimit).toBeGreaterThan(0);
    await _resetBuckets();

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
        await _resetBuckets();
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

    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warns.push(String(args[0]));
    };
    let bad: Response;
    try {
        bad = await app.request("http://localhost/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                client_name: "Some App",
                redirect_uris: [ALLOWED_REDIRECT, "https://evil.example/cb"],
            }),
        });
    } finally {
        console.warn = originalWarn;
    }
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error?: string }).error).toBe(
        "invalid_redirect_uri",
    );
    // Only the rejected callback is logged, so an operator can allow-list it.
    expect(warns).toEqual([
        '[auth] register: redirect_uri rejected ["https://evil.example/cb"] client_name="Some App"',
    ]);
});

test("/authorize logs a rejected redirect_uri", async () => {
    const { app } = buildTestApp();
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warns.push(String(args[0]));
    };
    let res: Response;
    try {
        res = await app.request(
            `http://localhost${authorizeUrl("https://evil.example/cb")}`,
        );
    } finally {
        console.warn = originalWarn;
    }
    expect(res.status).toBe(400);
    expect(warns).toEqual([
        '[auth] authorize: redirect_uri rejected ["https://evil.example/cb"] client_name=null',
    ]);
});

test("logRejectedRedirect keeps caller input on one capped line", () => {
    const warns: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warns.push(String(args[0]));
    };
    try {
        logRejectedRedirect(
            "register",
            ["https://x.example/a\n[auth] forged", "y".repeat(500)],
            "n".repeat(500),
        );
    } finally {
        console.warn = originalWarn;
    }
    expect(warns).toHaveLength(1);
    expect(warns[0]).not.toContain("\n");
    expect(warns[0]).toContain('"https://x.example/a\\n[auth] forged"');
    expect(warns[0]).toContain(`"${"y".repeat(300)}"`);
    expect(warns[0]).not.toContain("y".repeat(301));
    expect(warns[0]).toContain(`client_name="${"n".repeat(100)}"`);
});

test("/token authorization_code requires redirect_uri and code_verifier", async () => {
    authCodeStub = {
        code: "c",
        redirect_uri: ALLOWED_REDIRECT,
        user_id: "user-1",
        code_challenge: VALID_CHALLENGE,
        client_id: null,
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

// ---------- OAuth clients and the tokens they are issued ----------

const PKCE_VERIFIER = "v".repeat(43);
const PKCE_CHALLENGE = createHash("sha256")
    .update(PKCE_VERIFIER)
    .digest("base64url");

function tokenForm(fields: Record<string, string>) {
    const { app } = buildTestApp();
    return app.request("http://localhost/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
    });
}

function codeGrant(fields: Record<string, string> = {}) {
    return tokenForm({
        grant_type: "authorization_code",
        code: "c",
        redirect_uri: ALLOWED_REDIRECT,
        code_verifier: PKCE_VERIFIER,
        ...fields,
    });
}

function codeFor(clientId: string | null): actualTokens.AuthCodeData {
    return {
        code: "c",
        redirect_uri: ALLOWED_REDIRECT,
        user_id: "user-1",
        code_challenge: PKCE_CHALLENGE,
        client_id: clientId,
    };
}

test("/register hands back the registered client's id", async () => {
    registeredStub = REGISTERED_CLIENT;
    const { app } = buildTestApp();
    const res = await app.request("http://localhost/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            client_name: "Claude",
            redirect_uris: [ALLOWED_REDIRECT],
        }),
    });
    expect(((await res.json()) as { client_id: string }).client_id).toBe(
        REGISTERED_CLIENT,
    );
});

test("/register falls back to the deploy's client id when the registration is not stored", async () => {
    registeredStub = null;
    const { app } = buildTestApp();
    const res = await app.request("http://localhost/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: [ALLOWED_REDIRECT] }),
    });
    expect(((await res.json()) as { client_id: string }).client_id).toBe(
        process.env.OAUTH_CLIENT_ID!,
    );
});

test("/authorize accepts a registered client id and refuses an unknown one", async () => {
    const { app } = buildTestApp();
    const ok = await app.request(
        `http://localhost${authorizeUrl(ALLOWED_REDIRECT, {
            client_id: REGISTERED_CLIENT,
        })}`,
    );
    expect(ok.status).toBe(200);
    const unknown = await app.request(
        `http://localhost${authorizeUrl(ALLOWED_REDIRECT, {
            client_id: "99999999-2222-4333-8444-555555555555",
        })}`,
    );
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: string }).error).toBe(
        "invalid_client",
    );
});

test("a code exchange issues access and refresh tokens that carry the code's client", async () => {
    authCodeStub = codeFor(REGISTERED_CLIENT);
    issued.length = 0;
    const res = await codeGrant({ client_id: REGISTERED_CLIENT });
    expect(res.status).toBe(200);
    expect(issued).toEqual([
        { kind: "access", userId: "user-1", clientId: REGISTERED_CLIENT },
        { kind: "refresh", userId: "user-1", clientId: REGISTERED_CLIENT },
    ]);
});

test("a code from before clients were recorded issues tokens with no client", async () => {
    authCodeStub = codeFor(null);
    issued.length = 0;
    const res = await codeGrant();
    expect(res.status).toBe(200);
    expect(issued.map((t) => t.clientId)).toEqual([null, null]);
});

test("a code exchange under a different client than the code was issued to is refused", async () => {
    authCodeStub = codeFor(REGISTERED_CLIENT);
    issued.length = 0;
    const res = await codeGrant({ client_id: process.env.OAUTH_CLIENT_ID! });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
        "invalid_grant",
    );
    expect(issued).toEqual([]);
});

test("a code exchange under an unknown client id is refused before the code is spent", async () => {
    authCodeStub = codeFor(REGISTERED_CLIENT);
    issued.length = 0;
    const res = await codeGrant({
        client_id: "99999999-2222-4333-8444-555555555555",
    });
    expect(res.status).toBe(401);
    expect(issued).toEqual([]);
});

test("a refresh keeps the client of the token it replaces", async () => {
    refreshStub = { userId: "user-1", clientId: REGISTERED_CLIENT };
    issued.length = 0;
    const res = await tokenForm({
        grant_type: "refresh_token",
        refresh_token: "r",
    });
    expect(res.status).toBe(200);
    expect(issued).toEqual([
        { kind: "access", userId: "user-1", clientId: REGISTERED_CLIENT },
        { kind: "refresh", userId: "user-1", clientId: REGISTERED_CLIENT },
    ]);
});

test("a refresh naming a different client than the token's is refused and issues nothing", async () => {
    refreshStub = { userId: "user-1", clientId: REGISTERED_CLIENT };
    issued.length = 0;
    const res = await tokenForm({
        grant_type: "refresh_token",
        refresh_token: "r",
        client_id: process.env.OAUTH_CLIENT_ID!,
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(
        "invalid_grant",
    );
    expect(issued).toEqual([]);
});

test("a refresh naming the token's own client, or no client, goes through", async () => {
    refreshStub = { userId: "user-1", clientId: REGISTERED_CLIENT };
    expect(
        (
            await tokenForm({
                grant_type: "refresh_token",
                refresh_token: "r",
                client_id: REGISTERED_CLIENT,
            })
        ).status,
    ).toBe(200);
});

test("a refresh of a token with no client accepts any sent client id", async () => {
    refreshStub = { userId: "user-1", clientId: null };
    issued.length = 0;
    const res = await tokenForm({
        grant_type: "refresh_token",
        refresh_token: "r",
        client_id: process.env.OAUTH_CLIENT_ID!,
    });
    expect(res.status).toBe(200);
    expect(issued.map((t) => t.clientId)).toEqual([null, null]);
});

test("a refresh of a token with no client stays with no client", async () => {
    refreshStub = { userId: "user-1", clientId: null };
    issued.length = 0;
    await tokenForm({ grant_type: "refresh_token", refresh_token: "r" });
    expect(issued.map((t) => t.clientId)).toEqual([null, null]);
});

test("siteLoginReturnPath keeps /share query and refuses external next", () => {
    const app = new Hono();
    app.get("/share", (c) => c.text(siteLoginReturnPath(c)));
    app.get("/login-next", (c) => c.text(siteLoginReturnPath(c)));
    const share = app.request("http://localhost/share?text=hello&url=");
    const badNext = app.request(
        "http://localhost/login-next?next=" +
            encodeURIComponent("https://evil.com/share"),
    );
    const traversal = app.request(
        "http://localhost/login-next?next=" +
            encodeURIComponent("/share/../logout"),
    );
    return Promise.all([share, badNext, traversal]).then(async ([s, n, t]) => {
        expect(await s.text()).toBe("/share?text=hello&url=");
        expect(await n.text()).toBe("/");
        expect(await t.text()).toBe("/");
    });
});

test("beginSiteLogin still renders login without MCP connect hint", async () => {
    const app = new Hono();
    app.get("/", (c) => beginSiteLogin(c));
    app.post("/", (c) => beginSiteLogin(c));
    const res = await app.request("http://localhost/");
    expect(res.status).toBe(200);
    const post = await app.request("http://localhost/", { method: "POST" });
    expect(post.status).toBe(401);
    const html = await res.text();
    expect(html).toContain('action="/approve"');
    // One field takes an email or a username, so it cannot be type="email"
    // (the browser would refuse a bare username before it reached /approve).
    expect(html).toContain('<input type="text" id="email" name="email"');
    expect(html).toContain("Email or username");
    expect(html).not.toContain("Signing in to connect");
});

test("signed-out site logins are capped so long shares can't fill memory", async () => {
    const app = new Hono();
    app.get("/share", (c) => beginSiteLogin(c));
    const caption = "x".repeat(20_000);
    for (let i = 0; i < MAX_SITE_LOGIN_SESSIONS + 10; i++) {
        await app.request(`http://localhost/share?text=${caption}${i}`);
    }
    expect(siteLoginSessionCount()).toBeLessThanOrEqual(
        MAX_SITE_LOGIN_SESSIONS,
    );
});
