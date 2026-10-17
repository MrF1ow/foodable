import { Hono, type Context } from "hono";
import crypto from "node:crypto";
import {
    storeToken,
    storeAuthCode,
    consumeAuthCode,
    storeRefreshToken,
    consumeRefreshToken,
    registerClient,
} from "./db/tokens.js";
import { signUpUser, signInUser, authUserCount } from "./db/client.js";
import { escapeHtml } from "./html.js";
import { getBaseUrl } from "./url.js";
import { rateLimitAuth } from "./middleware.js";
import { LOGIN, LOGIN_ERRORS } from "./copy/login.js";
import { mintSiteSession, siteCookieHeader } from "./site-session.js";
import { authEmailForSignIn } from "./household.js";
import {
    extraRedirectUris,
    isAllowedRedirectUri,
    isValidPkceChallenge,
} from "./oauth-redirect.js";

const SESSION_TTL_MS = 10 * 60 * 1000;

interface OAuthSession {
    state: string;
    redirectUri: string;
    codeChallenge?: string;
    clientId: string;
    purpose: "mcp" | "site";
}

// In-memory session store (sessions are short-lived, 10min TTL)
const sessions = new Map<
    string,
    { session: OAuthSession; expiresAt: number }
>();

function cleanExpiredSessions() {
    const now = Date.now();
    for (const [key, value] of sessions) {
        if (value.expiresAt < now) sessions.delete(key);
    }
}

setInterval(cleanExpiredSessions, 60 * 1000);

function base64URLEncode(buffer: Buffer): string {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

export async function renderLoginPage(
    sessionId: string,
    session: OAuthSession,
    error?: string,
): Promise<string> {
    const template = await Bun.file("./public/login.html").text();
    const errorHtml = error
        ? `<div class="error-banner">${escapeHtml(error)}</div>`
        : "";
    let connectHint = "";
    if (session.purpose === "mcp") {
        try {
            const host = new URL(session.redirectUri).hostname;
            connectHint = `<p class="auth-note">${escapeHtml(LOGIN.signingInToConnect)} <strong>${escapeHtml(host)}</strong></p>`;
        } catch {
            connectHint = "";
        }
    }
    return template
        .replaceAll("{{SESSION_ID}}", escapeHtml(sessionId))
        .replaceAll("{{ERROR}}", errorHtml)
        .replaceAll("{{CONNECT_HINT}}", connectHint);
}

async function finishAuthorization(
    c: Context,
    sessionId: string,
    session: OAuthSession,
    userId: string,
): Promise<Response> {
    sessions.delete(sessionId);

    if (session.purpose === "site") {
        const secure =
            getBaseUrl(c).startsWith("https://") ||
            c.req.header("x-forwarded-proto") === "https";
        c.header(
            "Set-Cookie",
            siteCookieHeader(mintSiteSession(userId), secure),
        );
        return c.redirect("/");
    }

    const authCode = crypto.randomUUID();
    await storeAuthCode(
        authCode,
        session.redirectUri,
        userId,
        session.codeChallenge,
    );

    const redirectUrl = new URL(session.redirectUri);
    redirectUrl.searchParams.set("code", authCode);
    redirectUrl.searchParams.set("state", session.state);

    return c.redirect(redirectUrl.toString());
}

// Why a sign-in failed, as far as the login page should say.
// - "credentials": Supabase's invalid_credentials (wrong password or unknown
//   login). A 400 with no code is read the same way, for older Auth servers.
// - "account": any other 4xx with a code (email_not_confirmed, user_banned).
//   Retyping will not help, so Supabase's own message is shown.
// - "unavailable": no status (timeout, network), 429 or 5xx. Not the person's
//   fault, so it must never read as a wrong password.
export type SignInFailure = "credentials" | "account" | "unavailable";

export function classifySignInFailure(err: unknown): SignInFailure {
    if (!(err instanceof Error)) return "unavailable";
    const { status, code } = err as { status?: number; code?: string };
    if (code === "invalid_credentials") return "credentials";
    if (status === 400 && !code) return "credentials";
    if (status != null && status >= 400 && status < 500 && status !== 429) {
        return code ? "account" : "credentials";
    }
    return "unavailable";
}

export async function resolveApproveUser(args: {
    email: string;
    password: string;
    authUserCount: () => Promise<number>;
    signInUser: (email: string, password: string) => Promise<string>;
    signUpUser: (email: string, password: string) => Promise<string>;
    messages: { invalidCredentials: string; signInUnavailable: string };
}): Promise<string> {
    const count = await args.authUserCount();
    if (count === 0) {
        try {
            return await args.signInUser(args.email, args.password);
        } catch {
            return await args.signUpUser(args.email, args.password);
        }
    }
    // Once the owner exists, accounts are only created in Settings →
    // Household, so a failed sign-in never falls through to sign-up.
    try {
        return await args.signInUser(args.email, args.password);
    } catch (err) {
        const failure = classifySignInFailure(err);
        if (failure === "credentials") {
            console.warn("[auth] sign-in refused: invalid credentials");
            throw new Error(args.messages.invalidCredentials);
        }
        if (failure === "account") {
            const { code } = err as { code?: string };
            console.warn(`[auth] sign-in refused: ${JSON.stringify(code)}`);
            throw err as Error;
        }
        console.error(
            `[auth] sign-in unavailable: ${JSON.stringify(err instanceof Error ? err.message : String(err))}`,
        );
        throw new Error(args.messages.signInUnavailable);
    }
}

// Every path this router serves. Kept in sync with the oauth.get/oauth.post
// registrations below — a route added there but missing here is unthrottled.
export const OAUTH_PATHS = [
    "/register",
    "/authorize",
    "/approve",
    "/token",
] as const;

export function createOAuthRouter() {
    const oauth = new Hono();

    // Per-IP rate limit across all OAuth endpoints — these are unauthenticated,
    // so this is the only throttle standing between the internet and signup /
    // sign-in / token issuance.
    //
    // Deliberately NOT `oauth.use("*", ...)`: this router is mounted at the root
    // (`app.route("/", createOAuthRouter())`) because the OAuth paths are
    // spec-fixed there, and Hono applies a sub-app's wildcard middleware to
    // *every* path of the parent app — a wildcard here rate-limited /mcp too,
    // capping authenticated MCP traffic at the 30/min per-IP auth limit. Listing
    // the endpoints explicitly keeps the limiter from leaking beyond OAuth again.
    for (const path of OAUTH_PATHS) {
        oauth.use(path, rateLimitAuth);
    }

    const clientId = process.env.OAUTH_CLIENT_ID;
    const clientSecret = process.env.OAUTH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("Missing OAUTH_CLIENT_ID or OAUTH_CLIENT_SECRET");
    }

    // Dynamic client registration (required by MCP spec)
    oauth.post("/register", async (c) => {
        let body: {
            client_name?: string;
            redirect_uris?: unknown;
        };
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: "invalid_client_metadata" }, 400);
        }

        const extra = extraRedirectUris();
        const redirectUris = body.redirect_uris;
        if (
            !Array.isArray(redirectUris) ||
            redirectUris.length === 0 ||
            !redirectUris.every(
                (uri) =>
                    typeof uri === "string" && isAllowedRedirectUri(uri, extra),
            )
        ) {
            return c.json({ error: "invalid_redirect_uri" }, 400);
        }

        // Fire-and-forget: track who registers
        registerClient(body.client_name ?? null, redirectUris);

        return c.json({
            client_id: clientId,
            token_endpoint_auth_method: "none",
            redirect_uris: redirectUris,
        });
    });

    // Authorization endpoint
    oauth.get("/authorize", async (c) => {
        const responseType = c.req.query("response_type");
        const reqClientId = c.req.query("client_id");
        const redirectUri = c.req.query("redirect_uri");
        const state = c.req.query("state");
        const codeChallenge = c.req.query("code_challenge");
        const codeChallengeMethod = c.req.query("code_challenge_method");

        if (responseType !== "code") {
            return c.json({ error: "unsupported_response_type" }, 400);
        }
        if (!redirectUri || !state || !reqClientId) {
            return c.json(
                {
                    error: "invalid_request",
                    error_description:
                        "client_id, redirect_uri, and state are required",
                },
                400,
            );
        }
        if (reqClientId !== clientId) {
            return c.json({ error: "invalid_client" }, 400);
        }

        const extra = extraRedirectUris();
        if (!isAllowedRedirectUri(redirectUri, extra)) {
            return c.json(
                {
                    error: "invalid_request",
                    error_description: "redirect_uri is not allowed",
                },
                400,
            );
        }

        if (!codeChallenge) {
            return c.json(
                {
                    error: "invalid_request",
                    error_description: "code_challenge is required",
                },
                400,
            );
        }
        if (codeChallengeMethod !== "S256") {
            return c.json(
                {
                    error: "invalid_request",
                    error_description: "code_challenge_method must be S256",
                },
                400,
            );
        }
        if (!isValidPkceChallenge(codeChallenge)) {
            return c.json({ error: "invalid_request" }, 400);
        }

        cleanExpiredSessions();

        // Store session and show login page
        const sessionId = crypto.randomUUID();
        const session: OAuthSession = {
            state,
            redirectUri,
            codeChallenge,
            clientId: reqClientId,
            purpose: "mcp",
        };
        sessions.set(sessionId, {
            session,
            expiresAt: Date.now() + SESSION_TTL_MS,
        });

        return c.html(await renderLoginPage(sessionId, session));
    });

    // Login/register endpoint — user submits email + password
    oauth.post("/approve", async (c) => {
        const body = await c.req.parseBody();
        const sessionId = body.session_id as string;
        const email = authEmailForSignIn(String(body.email ?? ""));
        const password = body.password as string;

        if (!sessionId || !email || !password) {
            return c.json({ error: "invalid_request" }, 400);
        }

        const entry = sessions.get(sessionId);
        if (!entry || entry.expiresAt < Date.now()) {
            sessions.delete(sessionId);
            return c.json({ error: "session_expired" }, 400);
        }

        let userId: string;
        try {
            userId = await resolveApproveUser({
                email,
                password,
                authUserCount,
                signInUser,
                signUpUser,
                messages: LOGIN_ERRORS,
            });
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Authentication failed";
            return c.html(
                await renderLoginPage(sessionId, entry.session, message),
                400,
            );
        }

        return finishAuthorization(c, sessionId, entry.session, userId);
    });

    // Token endpoint
    oauth.post("/token", async (c) => {
        const body = await c.req.parseBody();
        const grantType = body.grant_type as string;
        const code = body.code as string;
        const codeVerifier = body.code_verifier as string | undefined;
        const redirectUri = body.redirect_uri as string;
        const reqClientId = body.client_id as string | undefined;
        const reqClientSecret = body.client_secret as string | undefined;

        if (grantType === "refresh_token") {
            const refreshToken = body.refresh_token as string;
            if (!refreshToken) {
                return c.json({ error: "invalid_request" }, 400);
            }

            // Look up the existing user from the refresh token
            const userId = await consumeRefreshToken(refreshToken);
            if (!userId) {
                return c.json({ error: "invalid_grant" }, 400);
            }

            const newAccessToken = crypto.randomUUID();
            const newRefreshToken = crypto.randomUUID();
            await storeToken(newAccessToken, userId);
            await storeRefreshToken(newRefreshToken, userId);

            return c.json({
                access_token: newAccessToken,
                token_type: "Bearer",
                expires_in: 365 * 24 * 60 * 60,
                refresh_token: newRefreshToken,
            });
        }

        if (grantType !== "authorization_code") {
            return c.json({ error: "unsupported_grant_type" }, 400);
        }

        if (!code) {
            return c.json({ error: "invalid_request" }, 400);
        }

        // Validate client credentials if provided
        if (reqClientId && reqClientId !== clientId) {
            return c.json({ error: "invalid_client" }, 401);
        }
        if (reqClientSecret && reqClientSecret !== clientSecret) {
            return c.json({ error: "invalid_client" }, 401);
        }

        // Atomically consume the auth code
        const authCodeData = await consumeAuthCode(code);
        if (!authCodeData) {
            return c.json({ error: "invalid_grant" }, 400);
        }

        if (!redirectUri) {
            return c.json({ error: "invalid_request" }, 400);
        }
        if (redirectUri !== authCodeData.redirect_uri) {
            return c.json({ error: "invalid_grant" }, 400);
        }

        if (!authCodeData.code_challenge) {
            return c.json({ error: "invalid_grant" }, 400);
        }
        if (!codeVerifier) {
            return c.json(
                {
                    error: "invalid_request",
                    error_description: "code_verifier required",
                },
                400,
            );
        }
        const hash = base64URLEncode(
            Buffer.from(
                crypto.createHash("sha256").update(codeVerifier).digest(),
            ),
        );
        if (hash !== authCodeData.code_challenge) {
            return c.json({ error: "invalid_grant" }, 400);
        }

        // Issue tokens linked to the authenticated user
        const accessToken = crypto.randomUUID();
        const refreshToken = crypto.randomUUID();
        await storeToken(accessToken, authCodeData.user_id);
        await storeRefreshToken(refreshToken, authCodeData.user_id);

        return c.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 365 * 24 * 60 * 60,
            refresh_token: refreshToken,
        });
    });

    return oauth;
}

export async function beginSiteLogin(
    c: Context,
    _localeQuery?: string,
    error?: string,
): Promise<Response> {
    const sessionId = crypto.randomUUID();
    const session: OAuthSession = {
        state: "site",
        redirectUri: "/",
        clientId: process.env.OAUTH_CLIENT_ID ?? "site",
        purpose: "site",
    };
    sessions.set(sessionId, {
        session,
        expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return c.html(
        await renderLoginPage(sessionId, session, error),
        error ? 400 : 200,
    );
}
