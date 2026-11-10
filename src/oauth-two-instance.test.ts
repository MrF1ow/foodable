import crypto from "node:crypto";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { setClientIpConfigForTests } from "./client-ip.js";
import { runAsSystem } from "./db/actor.js";
import { describeDb } from "./db/testing/pg.js";
import { findPgBin } from "./db/testing/pg-temp.js";
import { setSqlForTests } from "./db/sql.js";
import { signUpUser } from "./db/users.js";
import {
    resetLoginSessionStoreForTests,
    useLiveLoginSessionStore,
} from "./oauth-login-sessions.js";
import { _resetBuckets } from "./rate-limit.js";

const pgAvailable = await findPgBin();

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { createOAuthRouter } = await import("./oauth.js");

const ALLOWED_REDIRECT = "http://localhost:8080/callback";
const PASSWORD = "password12345678";
const EMAIL = "oauth-two@test.local";

function base64URLEncode(buffer: Buffer): string {
    return buffer
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

const CODE_VERIFIER = "d".repeat(43);
const CODE_CHALLENGE = base64URLEncode(
    Buffer.from(crypto.createHash("sha256").update(CODE_VERIFIER).digest()),
);

function authorizeUrl() {
    const params = new URLSearchParams({
        response_type: "code",
        client_id: process.env.OAUTH_CLIENT_ID!,
        redirect_uri: ALLOWED_REDIRECT,
        state: "state-two-instance",
        code_challenge: CODE_CHALLENGE,
        code_challenge_method: "S256",
    });
    return `/authorize?${params}`;
}

function makeOAuthApp() {
    const app = new Hono();
    app.route("/", createOAuthRouter());
    return app;
}

function sessionIdFromLoginHtml(html: string): string {
    const match = html.match(/name="session_id" value="([^"]+)"/);
    expect(match).not.toBeNull();
    return match![1]!;
}

describeDb(
    pgAvailable !== null,
    "oauth login sessions across instances",
    (getCtx) => {
        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            useLiveLoginSessionStore();
            _resetBuckets();
            setClientIpConfigForTests({
                source: "x-forwarded-for",
                sourceIsDefault: false,
                trustedHops: 1,
                cloudflareOriginSecret: null,
            });
            await runAsSystem("seed oauth test user", () =>
                signUpUser(EMAIL, PASSWORD),
            );
        });

        afterEach(() => {
            setSqlForTests(null);
            resetLoginSessionStoreForTests();
            setClientIpConfigForTests(null);
        });

        test("login started on one app finishes on another and yields tokens", async () => {
            const appA = makeOAuthApp();
            const appB = makeOAuthApp();

            const authorizeRes = await appA.request(
                `http://localhost${authorizeUrl()}`,
            );
            expect(authorizeRes.status).toBe(200);
            const sessionId = sessionIdFromLoginHtml(await authorizeRes.text());

            const approveRes = await appB.request("http://localhost/approve", {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    "x-forwarded-for": "203.0.113.1",
                },
                body: new URLSearchParams({
                    session_id: sessionId,
                    email: EMAIL,
                    password: PASSWORD,
                }).toString(),
                redirect: "manual",
            });
            expect(approveRes.status).toBe(302);
            const location = approveRes.headers.get("location");
            expect(location).toBeTruthy();
            const redirect = new URL(location!, ALLOWED_REDIRECT);
            expect(redirect.searchParams.get("state")).toBe(
                "state-two-instance",
            );
            const code = redirect.searchParams.get("code");
            expect(code).toBeTruthy();

            const tokenRes = await appB.request("http://localhost/token", {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                    "x-forwarded-for": "203.0.113.2",
                },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: code!,
                    redirect_uri: ALLOWED_REDIRECT,
                    code_verifier: CODE_VERIFIER,
                }).toString(),
            });
            expect(tokenRes.status).toBe(200);
            const body = (await tokenRes.json()) as {
                access_token?: string;
                token_type?: string;
            };
            expect(body.token_type).toBe("Bearer");
            expect(body.access_token).toBeTruthy();
        });

        test("concurrent approve on two apps yields one authorization code", async () => {
            const appA = makeOAuthApp();
            const appB = makeOAuthApp();

            const authorizeRes = await appA.request(
                `http://localhost${authorizeUrl()}`,
            );
            const sessionId = sessionIdFromLoginHtml(await authorizeRes.text());

            const approveBody = new URLSearchParams({
                session_id: sessionId,
                email: EMAIL,
                password: PASSWORD,
            }).toString();

            const [resA, resB] = await Promise.all([
                appA.request("http://localhost/approve", {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "x-forwarded-for": "203.0.113.10",
                    },
                    body: approveBody,
                    redirect: "manual",
                }),
                appB.request("http://localhost/approve", {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                        "x-forwarded-for": "203.0.113.11",
                    },
                    body: approveBody,
                    redirect: "manual",
                }),
            ]);

            const winners = [resA, resB].filter((r) => r.status === 302);
            const losers = [resA, resB].filter((r) => r.status !== 302);
            expect(winners).toHaveLength(1);
            expect(losers).toHaveLength(1);
            expect(losers[0]!.status).toBe(400);
            const err = (await losers[0]!.json()) as { error?: string };
            expect(err.error).toBe("session_expired");

            const code = new URL(
                winners[0]!.headers.get("location")!,
                ALLOWED_REDIRECT,
            ).searchParams.get("code");
            expect(code).toBeTruthy();

            const tokenRes = await appA.request("http://localhost/token", {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    grant_type: "authorization_code",
                    code: code!,
                    redirect_uri: ALLOWED_REDIRECT,
                    code_verifier: CODE_VERIFIER,
                }).toString(),
            });
            expect(tokenRes.status).toBe(200);
        });

        test("wrong password leaves session retryable across instances", async () => {
            const appA = makeOAuthApp();
            const appB = makeOAuthApp();

            const authorizeRes = await appA.request(
                `http://localhost${authorizeUrl()}`,
            );
            const sessionId = sessionIdFromLoginHtml(await authorizeRes.text());

            const bad = await appB.request("http://localhost/approve", {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    session_id: sessionId,
                    email: EMAIL,
                    password: "not-the-password",
                }).toString(),
            });
            expect(bad.status).toBe(400);
            expect(await bad.text()).toContain("Wrong email");

            const good = await appA.request("http://localhost/approve", {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    session_id: sessionId,
                    email: EMAIL,
                    password: PASSWORD,
                }).toString(),
                redirect: "manual",
            });
            expect(good.status).toBe(302);
        });

        test("expired login session is rejected on either app", async () => {
            const { sql } = getCtx();
            const appA = makeOAuthApp();
            const appB = makeOAuthApp();

            const authorizeRes = await appA.request(
                `http://localhost${authorizeUrl()}`,
            );
            const sessionId = sessionIdFromLoginHtml(await authorizeRes.text());

            await sql`
                update public.oauth_login_sessions
                set expires_at = now() - interval '1 second'
                where id = ${sessionId}
            `;

            for (const app of [appA, appB]) {
                const res = await app.request("http://localhost/approve", {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                        session_id: sessionId,
                        email: EMAIL,
                        password: PASSWORD,
                    }).toString(),
                });
                expect(res.status).toBe(400);
                const body = (await res.json()) as { error?: string };
                expect(body.error).toBe("session_expired");
            }
        });
    },
    { actor: null },
);
