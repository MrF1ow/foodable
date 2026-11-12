import { Hono, type Context } from "hono";
import crypto from "node:crypto";
import {
    storeToken,
    storeAuthCode,
    consumeAuthCode,
    storeRefreshToken,
    consumeRefreshToken,
    withRefreshExchange,
    registerClient,
    isRegisteredClient,
} from "./db/tokens.js";
import {
    signUpUser,
    signInUser,
    authAccountExists,
    authUserCount,
} from "./db/users.js";
import { householdExists } from "./db/household.js";
import { peekInviteCode, signUpWithInvite } from "./db/invites.js";
import {
    canSignUp,
    getSignupPolicy,
    signupPolicyForRoutes,
} from "./domain/signup.js";
import { runAsSystem } from "./db/actor.js";
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
import {
    appScriptHref,
    appStylesheetHref,
    getAppCss,
    getAppJs,
    getAppV2Css,
    getAppV2Js,
} from "./widgets.js";
import { isSafeShareReturnPath } from "./domain/share.js";
import {
    getLoginSessionStore,
    MAX_SITE_LOGIN_SESSIONS_POSTGRES,
    siteLoginSessionCountSync,
    type OAuthSessionPayload,
} from "./oauth-login-sessions.js";

const SESSION_TTL_MS = 10 * 60 * 1000;
/** Bounds memory held by signed-out site logins (each up to 64 KiB). */
export const MAX_SITE_LOGIN_SESSIONS = 32;

type OAuthSession = OAuthSessionPayload;

/** Test hook: how many site-login sessions are held (in-memory store only). */
export function siteLoginSessionCount(): number {
    return siteLoginSessionCountSync();
}

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
    await getAppCss();
    await getAppJs();
    // The signed-in app may be on the new shell after this login; have its
    // pair hashed too, so the first page carries ?v= hrefs.
    await getAppV2Css();
    await getAppV2Js();
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
    const policy = getSignupPolicy();
    const inviteFields =
        policy === "invite"
            ? `<label for="invite_code">${escapeHtml(LOGIN.inviteCodeLabel)}</label>
                    <input type="text" id="invite_code" name="invite_code" autocomplete="off" autocapitalize="none" spellcheck="false" />
                    <p class="auth-note">${escapeHtml(LOGIN.inviteCodeHint)}</p>`
            : "";
    return template
        .replaceAll("{{SESSION_ID}}", () => escapeHtml(sessionId))
        .replaceAll("{{ERROR}}", () => errorHtml)
        .replaceAll("{{CONNECT_HINT}}", () => connectHint)
        .replaceAll("{{INVITE_FIELDS}}", () => inviteFields)
        .replaceAll("{{APP_CSS_HREF}}", () => appStylesheetHref())
        .replaceAll("{{APP_JS_HREF}}", () => appScriptHref());
}

function displayNameFromLogin(email: string): string {
    const local = email.includes("@") ? email.split("@")[0]! : email;
    const trimmed = local.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 80) : "Member";
}

async function finishAuthorization(
    c: Context,
    session: OAuthSession,
    userId: string,
): Promise<Response> {
    if (session.purpose === "site") {
        const secure =
            getBaseUrl(c).startsWith("https://") ||
            c.req.header("x-forwarded-proto") === "https";
        c.header(
            "Set-Cookie",
            siteCookieHeader(mintSiteSession(userId), secure),
        );
        const dest = isSafeShareReturnPath(session.redirectUri) ?? "/";
        return c.redirect(dest);
    }

    const authCode = crypto.randomUUID();
    await runAsSystem("oauth authorization code", () =>
        storeAuthCode(
            authCode,
            session.redirectUri,
            userId,
            session.codeChallenge,
            // The deploy-wide id names no single app, so a token issued under
            // it records no client and reads as an unknown app.
            session.clientId === process.env.OAUTH_CLIENT_ID
                ? null
                : session.clientId,
        ),
    );

    const redirectUrl = new URL(session.redirectUri);
    redirectUrl.searchParams.set("code", authCode);
    redirectUrl.searchParams.set("state", session.state);

    return c.redirect(redirectUrl.toString());
}

// Why a sign-in failed, as far as the login page should say.
// - "credentials": signIn throws SignInError with code invalid_credentials
//   (GoTrue's message kept for parity). A 400 with no code is read the same way.
// - "account": any other 4xx with a code (email_not_confirmed, user_banned).
//   Retyping will not help, so the adapter's message is shown.
// - "unavailable": no status (database unreachable, timeout, network), 429 or
//   5xx. Not the person's fault, so it must never read as a wrong password.
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
    inviteCode?: string;
    authUserCount: () => Promise<number>;
    householdExists: () => Promise<boolean>;
    signInUser: (email: string, password: string) => Promise<string>;
    signUpUser: (email: string, password: string) => Promise<string>;
    messages: typeof LOGIN_ERRORS;
    signupPolicy?: ReturnType<typeof getSignupPolicy>;
    accountExists?: (email: string) => Promise<boolean>;
    peekInvite?: (code: string) => Promise<{ valid: true } | { valid: false }>;
    signUpWithInvite?: typeof signUpWithInvite;
}): Promise<string> {
    const count = await args.authUserCount();
    const policy = signupPolicyForRoutes(
        args.signupPolicy ?? getSignupPolicy(),
    );
    if (count === 0) {
        const first = canSignUp(policy, {
            userCount: 0,
            householdExists: await args.householdExists(),
            mode: "register",
            callerHasHousehold: false,
        });
        if (first.ok) {
            try {
                return await args.signInUser(args.email, args.password);
            } catch {
                return await args.signUpUser(args.email, args.password);
            }
        }
    }
    try {
        return await args.signInUser(args.email, args.password);
    } catch (err) {
        const failure = classifySignInFailure(err);
        if (failure === "account") {
            const { code } = err as { code?: string };
            console.warn(`[auth] sign-in refused: ${JSON.stringify(code)}`);
            throw err as Error;
        }
        if (failure === "unavailable") {
            console.error(
                `[auth] sign-in unavailable: ${JSON.stringify(err instanceof Error ? err.message : String(err))}`,
            );
            throw new Error(args.messages.signInUnavailable);
        }
        return registerAfterFailedSignIn(args, count, policy);
    }
}

// The password did not match, or no login has this email. An existing login
// always gets the plain wrong-credentials answer, whatever the invite field
// holds; only a new email can sign up, and only as the policy allows.
async function registerAfterFailedSignIn(
    args: Parameters<typeof resolveApproveUser>[0],
    count: number,
    policy: ReturnType<typeof getSignupPolicy>,
): Promise<string> {
    const invalidCredentials = (): Error => {
        console.warn("[auth] sign-in refused: invalid credentials");
        return new Error(args.messages.invalidCredentials);
    };
    const inviteCode = args.inviteCode?.trim() ?? "";
    // Closed: nobody can register, so every failed sign-in gets the same
    // answer whatever the invite field holds, and no account lookup runs; a
    // different answer for unknown emails would tell who has an account.
    if (policy === "closed") throw invalidCredentials();
    let exists: boolean;
    try {
        exists = await (args.accountExists ?? authAccountExists)(args.email);
    } catch (err) {
        console.error(
            `[auth] account lookup unavailable: ${JSON.stringify(err instanceof Error ? err.message : String(err))}`,
        );
        throw new Error(args.messages.signInUnavailable);
    }
    if (exists) throw invalidCredentials();
    const invite =
        policy === "invite" && inviteCode
            ? await (args.peekInvite ?? peekInviteCode)(inviteCode)
            : undefined;
    const register = canSignUp(
        policy,
        {
            userCount: count,
            householdExists: true,
            mode: "register",
            callerHasHousehold: false,
        },
        invite,
    );
    if (!register.ok) {
        if (register.reason === "invite-required") {
            throw new Error(
                inviteCode
                    ? args.messages.invalidInvite
                    : args.messages.inviteRequired,
            );
        }
        throw invalidCredentials();
    }
    if (register.joins === "existing-household") {
        const result = await (args.signUpWithInvite ?? signUpWithInvite)({
            code: inviteCode,
            email: args.email,
            password: args.password,
            displayName: displayNameFromLogin(args.email),
        });
        if (result.ok) return result.userId;
        if (result.reason === "invalid-invite") {
            throw new Error(args.messages.invalidInvite);
        }
        throw invalidCredentials();
    }
    return args.signUpUser(args.email, args.password);
}

// A client whose callback is not allow-listed fails before anyone signs in,
// and its callback is published nowhere, so the log line is how an operator
// learns the exact value to put in ALLOWED_REDIRECT_URIS. The values are
// caller-supplied: JSON.stringify keeps them on one line and each is capped.
export function logRejectedRedirect(
    route: "register" | "authorize",
    uris: unknown,
    clientName?: unknown,
): void {
    const list = (Array.isArray(uris) ? uris : [uris])
        .slice(0, 5)
        .map((uri) => (typeof uri === "string" ? uri.slice(0, 300) : uri));
    const name =
        typeof clientName === "string" ? clientName.slice(0, 100) : null;
    console.warn(
        `[auth] ${route}: redirect_uri rejected ${JSON.stringify(list)} client_name=${JSON.stringify(name)}`,
    );
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
            const rejected = Array.isArray(redirectUris)
                ? redirectUris.filter(
                      (uri) =>
                          typeof uri !== "string" ||
                          !isAllowedRedirectUri(uri, extra),
                  )
                : redirectUris;
            logRejectedRedirect("register", rejected, body.client_name);
            return c.json({ error: "invalid_redirect_uri" }, 400);
        }

        // The registration's own id is the client_id, so a token can name the
        // app it was issued to. When it cannot be stored the deploy-wide id
        // still works: registration never fails on a database hiccup.
        const registeredId = await runAsSystem(
            "oauth client registration",
            async () => registerClient(body.client_name ?? null, redirectUris),
        );

        return c.json({
            client_id: registeredId ?? clientId,
            token_endpoint_auth_method: "none",
            redirect_uris: redirectUris,
        });
    });

    // The deploy-wide client id, or the id a dynamic registration was given.
    const isKnownClient = async (id: string): Promise<boolean> =>
        id === clientId ||
        runAsSystem("oauth client check", () => isRegisteredClient(id));

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
        if (!(await isKnownClient(reqClientId))) {
            return c.json({ error: "invalid_client" }, 400);
        }

        const extra = extraRedirectUris();
        if (!isAllowedRedirectUri(redirectUri, extra)) {
            logRejectedRedirect("authorize", [redirectUri]);
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

        const store = getLoginSessionStore();
        const sessionId = crypto.randomUUID();
        const session: OAuthSession = {
            state,
            redirectUri,
            codeChallenge,
            clientId: reqClientId,
            purpose: "mcp",
        };
        await store.put(sessionId, session, SESSION_TTL_MS);

        return c.html(await renderLoginPage(sessionId, session));
    });

    // Login/register endpoint — user submits email + password
    oauth.post("/approve", async (c) => {
        const body = await c.req.parseBody();
        const sessionId = body.session_id as string;
        const email = authEmailForSignIn(String(body.email ?? ""));
        const password = body.password as string;
        const inviteCode =
            typeof body.invite_code === "string" ? body.invite_code : undefined;

        if (!sessionId || !email || !password) {
            return c.json({ error: "invalid_request" }, 400);
        }

        const store = getLoginSessionStore();
        const session = await store.get(sessionId);
        if (!session) {
            await store.del(sessionId);
            return c.json({ error: "session_expired" }, 400);
        }

        let userId: string;
        try {
            // Nobody is signed in yet: the credential check is the system's.
            userId = await runAsSystem("sign in", () =>
                resolveApproveUser({
                    email,
                    password,
                    inviteCode,
                    authUserCount,
                    householdExists,
                    signInUser,
                    signUpUser,
                    messages: LOGIN_ERRORS,
                }),
            );
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "Authentication failed";
            return c.html(
                await renderLoginPage(sessionId, session, message),
                400,
            );
        }

        const consumed = await store.take(sessionId);
        if (!consumed) {
            return c.json({ error: "session_expired" }, 400);
        }

        return finishAuthorization(c, consumed, userId);
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
            const newAccessToken = crypto.randomUUID();
            const newRefreshToken = crypto.randomUUID();
            // Consume and store are one transaction that excludes a
            // Disconnect for the member, so a refresh racing one cannot leave
            // a live pair behind.
            const userId = await withRefreshExchange(refreshToken, async () => {
                const owner = await consumeRefreshToken(refreshToken);
                if (!owner) return null;
                // A refresh token belongs to the client it was issued to.
                if (
                    reqClientId &&
                    owner.clientId &&
                    reqClientId !== owner.clientId
                ) {
                    return null;
                }
                // The new tokens belong to the same app as the old one.
                await storeToken(newAccessToken, owner.userId, owner.clientId);
                await storeRefreshToken(
                    newRefreshToken,
                    owner.userId,
                    owner.clientId,
                );
                return owner.userId;
            });
            if (!userId) {
                return c.json({ error: "invalid_grant" }, 400);
            }

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
        if (reqClientId && !(await isKnownClient(reqClientId))) {
            return c.json({ error: "invalid_client" }, 401);
        }
        if (reqClientSecret && reqClientSecret !== clientSecret) {
            return c.json({ error: "invalid_client" }, 401);
        }

        // Atomically consume the auth code
        const authCodeData = await runAsSystem(
            "oauth authorization code exchange",
            () => consumeAuthCode(code),
        );
        if (!authCodeData) {
            return c.json({ error: "invalid_grant" }, 400);
        }

        if (!redirectUri) {
            return c.json({ error: "invalid_request" }, 400);
        }
        if (redirectUri !== authCodeData.redirect_uri) {
            return c.json({ error: "invalid_grant" }, 400);
        }

        // A code belongs to the client it was issued to.
        if (
            reqClientId &&
            authCodeData.client_id &&
            reqClientId !== authCodeData.client_id
        ) {
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
        await runAsSystem("oauth token exchange", async () => {
            await storeToken(
                accessToken,
                authCodeData.user_id,
                authCodeData.client_id,
            );
            await storeRefreshToken(
                refreshToken,
                authCodeData.user_id,
                authCodeData.client_id,
            );
        });

        return c.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: 365 * 24 * 60 * 60,
            refresh_token: refreshToken,
        });
    });

    return oauth;
}

export function siteLoginReturnPath(c: Context): string {
    const reqUrl = new URL(c.req.url);
    const fromRequest = reqUrl.pathname + reqUrl.search;
    const fromShare = isSafeShareReturnPath(fromRequest);
    if (fromShare) return fromShare;
    const next = c.req.query("next")?.trim();
    const fromNext = next ? isSafeShareReturnPath(next) : null;
    if (fromNext) return fromNext;
    return "/";
}

export async function beginSiteLogin(
    c: Context,
    _localeQuery?: string,
    error?: string,
): Promise<Response> {
    const sessionId = crypto.randomUUID();
    const session: OAuthSession = {
        state: "site",
        redirectUri: siteLoginReturnPath(c),
        clientId: process.env.OAUTH_CLIENT_ID ?? "site",
        purpose: "site",
    };
    // A signed-out share keeps up to 64 KiB of return path in memory, and
    // GET /share is not rate limited, so site-login sessions are capped: the
    // oldest one goes first. MCP authorization sessions are never evicted.
    const store = getLoginSessionStore();
    const cap =
        store.kind === "postgres"
            ? MAX_SITE_LOGIN_SESSIONS_POSTGRES
            : MAX_SITE_LOGIN_SESSIONS;
    await store.putSiteSession(sessionId, session, SESSION_TTL_MS, cap);
    const status = error ? 400 : c.req.method === "GET" ? 200 : 401;
    return c.html(await renderLoginPage(sessionId, session, error), status);
}
