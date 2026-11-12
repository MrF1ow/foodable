import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { runAsSystem } from "../../db/actor.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    listConnections,
    lookupBearer,
    storeAuthCode,
    storeRefreshToken,
    storeToken,
} from "../../db/tokens.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../../mcp/server.js";
import { authenticateBearer } from "../../middleware.js";
import { _resetBuckets } from "../../rate-limit.js";
import { createOAuthRouter } from "../../oauth.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_ID ||= "test-client";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const CLAUDE = "7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f";
const GROK = "2b1c0d9e-8f7a-4b6c-8d5e-4f3a2b1c0d9e";

// The web routes and the real bearer check in front of the real /mcp handler,
// over one real database: Disconnect on the Settings page must stop the app's
// token at once.
const app = new Hono();
app.route("/", settingsRoutes);
app.all("/mcp", authenticateBearer, handleMcp);
// The token endpoint an AI app refreshes against, on its own router so the
// routes above are untouched.
const oauthApp = new Hono();
oauthApp.route("/", createOAuthRouter());

const MCP_ERAS = [
    {
        name: "2025-11-25",
        headers: {} as Record<string, string>,
        body: {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "c", version: "0" },
            },
        },
    },
    {
        name: "2026-07-28",
        headers: {
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "server/discover",
        } as Record<string, string>,
        body: {
            jsonrpc: "2.0",
            id: 1,
            method: "server/discover",
            params: {
                _meta: {
                    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                    "io.modelcontextprotocol/clientCapabilities": {},
                },
            },
        },
    },
];

function mcp(token: string, era: (typeof MCP_ERAS)[number], ip: string) {
    return app.request("http://test/mcp", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${token}`,
            "x-forwarded-for": ip,
            ...era.headers,
        },
        body: JSON.stringify(era.body),
    });
}

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function disconnect(userId: string, client: string | null) {
    return app.request("http://test/settings/ai-connections/disconnect", {
        method: "POST",
        headers: {
            cookie: cookie(userId),
            "content-type": "application/x-www-form-urlencoded",
        },
        body: client === null ? "" : `client=${encodeURIComponent(client)}`,
    });
}

function refresh(token: string) {
    return oauthApp.request("http://test/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=refresh_token&refresh_token=${token}&client_id=${CLAUDE}`,
    });
}

const CODE_VERIFIER = "v".repeat(50);
const CODE_REDIRECT = "http://localhost/callback";

async function exchangeCode(code: string): Promise<Response> {
    return oauthApp.request("http://test/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: CODE_REDIRECT,
            code_verifier: CODE_VERIFIER,
            client_id: CLAUDE,
        }).toString(),
    });
}

function seedAuthCode(code: string, userId: string) {
    const challenge = createHash("sha256")
        .update(CODE_VERIFIER)
        .digest("base64url");
    return runAsSystem("seed auth code", () =>
        storeAuthCode(code, CODE_REDIRECT, userId, challenge, CLAUDE),
    );
}

async function lockWaiters(observer: SQL): Promise<number> {
    const [row] = await observer`
        select count(*)::int as n
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
    `;
    return row.n;
}

/** Polls until `ready` holds; Postgres emits no event for "a session is now waiting". */
async function until(ready: () => Promise<boolean>, what: string) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        if (await ready()) return;
        // oxlint-disable-next-line foodable/no-wall-clock-waits -- polls pg_stat_activity for a session blocked on a lock; Postgres emits no event to await
        await Bun.sleep(10);
    }
    throw new Error(`timed out waiting for ${what}`);
}

describeDb(pgAvailable !== null, "settings AI connections", (getCtx) => {
    let userId: string;
    let householdId: string;
    let peerId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        await _resetBuckets();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        ({ userId, householdId } = await seedHousehold(sql));
        peerId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${peerId}, ${`peer-${peerId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${peerId}, ${"member"}, ${"Peer"})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    async function seed(
        token: string,
        user: string,
        clientId: string | null,
        clientName?: string,
    ) {
        const { sql } = getCtx();
        if (clientId && clientName) {
            await sql`
                insert into public.registered_clients (id, client_name, redirect_uris)
                values (${clientId}, ${clientName}, ${sql.array([], "text")})
                on conflict (id) do nothing
            `;
        }
        await runAsSystem("seed token", () =>
            storeToken(token, user, clientId),
        );
    }

    function page(user: string) {
        return app.request("http://test/settings/ai-connections", {
            headers: { cookie: cookie(user) },
        });
    }

    test("the page lists the member's apps and not another member's", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await seed("legacy-tok", userId, null);
        await seed("peer-tok", peerId, GROK, "Grok CLI");

        const res = await page(userId);
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('data-fd-settings-page="ai"');
        expect(html).toContain("Claude");
        expect(html).toContain("Unknown app");
        expect(html).not.toContain("Grok CLI");
        expect(html).toContain("http://test/mcp");
    });

    test("the page says nothing is connected for a member with no tokens", async () => {
        const html = await (await page(userId)).text();
        expect(html).toContain("No AI apps connected yet.");
    });

    for (const era of MCP_ERAS) {
        test(`Disconnect stops the app's token: /mcp answers 401 (${era.name})`, async () => {
            await seed("claude-tok", userId, CLAUDE, "Claude");
            await seed("grok-tok", userId, GROK, "Grok CLI");
            expect((await mcp("claude-tok", era, "10.2.0.1")).status).toBe(200);

            const res = await disconnect(userId, CLAUDE);

            expect(res.status).toBe(303);
            const revoked = await mcp("claude-tok", era, "10.2.0.1");
            expect(revoked.status).toBe(401);
            expect(revoked.headers.get("www-authenticate")).toContain("Bearer");
            // The member's other app is untouched.
            expect((await mcp("grok-tok", era, "10.2.0.2")).status).toBe(200);
        });
    }

    test("Disconnect also removes the app's refresh token", async () => {
        const { sql } = getCtx();
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await runAsSystem("seed refresh", () =>
            storeRefreshToken("claude-refresh", userId, CLAUDE),
        );

        await disconnect(userId, CLAUDE);

        const left = await sql`select token from public.refresh_tokens`;
        expect(left).toHaveLength(0);
    });

    test("Disconnect only touches the session member, never another member's token for the same app", async () => {
        await seed("mine", userId, CLAUDE, "Claude");
        await seed("theirs", peerId, CLAUDE, "Claude");

        // The caller names the app; the member always comes from the session.
        const res = await disconnect(userId, CLAUDE);
        expect(res.status).toBe(303);

        expect(await listConnections(userId)).toHaveLength(0);
        expect(await listConnections(peerId)).toHaveLength(1);
        expect((await mcp("theirs", MCP_ERAS[0]!, "10.2.0.3")).status).toBe(
            200,
        );
    });

    test("a posted user id is ignored", async () => {
        await seed("theirs", peerId, CLAUDE, "Claude");
        const res = await app.request(
            "http://test/settings/ai-connections/disconnect",
            {
                method: "POST",
                headers: {
                    cookie: cookie(userId),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `client=${CLAUDE}&user_id=${peerId}`,
            },
        );
        expect(res.status).toBe(303);
        expect(await listConnections(peerId)).toHaveLength(1);
    });

    test("the unknown-app marker disconnects the tokens with no recorded app", async () => {
        await seed("legacy-tok", userId, null);
        await seed("claude-tok", userId, CLAUDE, "Claude");

        const res = await disconnect(userId, "unknown");

        expect(res.status).toBe(303);
        const left = await listConnections(userId);
        expect(left.map((c) => c.clientId)).toEqual([CLAUDE]);
        expect((await mcp("legacy-tok", MCP_ERAS[0]!, "10.2.0.4")).status).toBe(
            401,
        );
    });

    test("disconnecting an app that is already gone is a harmless no-op", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        expect((await disconnect(userId, CLAUDE)).status).toBe(303);

        const again = await disconnect(userId, CLAUDE);

        expect(again.status).toBe(303);
        expect(again.headers.get("location")).toBe("/settings/ai-connections");
    });

    test("a post with no app named changes nothing", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        const res = await disconnect(userId, null);
        expect(res.status).toBe(400);
        expect(await listConnections(userId)).toHaveLength(1);
    });

    for (const [name, client] of [
        ["a NUL", "a\u0000b"],
        ["only a NUL", "\u0000"],
        ["a C0 control", "a\u0007b"],
        ["a DEL", "a\u007fb"],
        ["a C1 control", "a\u0085b"],
        ["a very long value", "x".repeat(201)],
    ] as const) {
        test(`an app id with ${name} is refused as a bad choice, not a server error`, async () => {
            await seed("claude-tok", userId, CLAUDE, "Claude");
            const res = await disconnect(userId, client);
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Choose an app to disconnect.");
            expect(await listConnections(userId)).toHaveLength(1);
        });
    }

    test("with ui-v2 off the page and the action are 404 and nothing is revoked", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        await seed("claude-tok", userId, CLAUDE, "Claude");

        expect((await page(userId)).status).toBe(404);
        expect((await disconnect(userId, CLAUDE)).status).toBe(404);
        expect(await listConnections(userId)).toHaveLength(1);
    });

    test("Settings shows the menu entry with ui-v2 on and none with it off", async () => {
        const on = await app.request("http://test/settings", {
            headers: { cookie: cookie(userId) },
        });
        const onHtml = await on.text();
        expect(onHtml).toContain('href="/settings/ai-connections"');
        expect(onHtml).toContain("AI connections");

        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const off = await app.request("http://test/settings", {
            headers: { cookie: cookie(userId) },
        });
        expect(await off.text()).not.toContain("/settings/ai-connections");
    });

    test("signed out, the page redirects to login and Disconnect revokes nothing", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        const res = await app.request(
            "http://test/settings/ai-connections/disconnect",
            {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `client=${CLAUDE}`,
            },
        );
        expect(res.status).not.toBe(303);
        expect(await listConnections(userId)).toHaveLength(1);
    });
    async function tokensLeft(user: string) {
        const { sql } = getCtx();
        const [access] = await sql`
            select count(*)::int as n from public.oauth_tokens where user_id = ${user}
        `;
        const [refresh] = await sql`
            select count(*)::int as n from public.refresh_tokens where user_id = ${user}
        `;
        return { access: access.n, refresh: refresh.n };
    }

    test("a Disconnect that lands while a refresh is storing its new pair leaves the app with no tokens", async () => {
        const { pg, sql } = getCtx();
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await runAsSystem("seed refresh", () =>
            storeRefreshToken("claude-refresh", userId, CLAUDE),
        );
        // Its own connections: the shared test client is a single one, which
        // would serialise the two requests by itself and hide the race.
        const pool = new SQL(pg.url, { prepare: false, max: 6 });
        const holder = new SQL(pg.url, { prepare: false, max: 1 });
        const observer = new SQL(pg.url, { prepare: false, max: 1 });
        let release!: () => void;
        const released = new Promise<void>((r) => (release = r));
        let held!: () => void;
        const isHeld = new Promise<void>((r) => (held = r));
        // Holding the member's user row stalls the refresh's insert of the
        // new tokens (their foreign key takes a share lock on it), which is
        // the window between "old token consumed" and "new pair stored".
        const holding = holder.begin(async (tx) => {
            await tx`select 1 from public.users where id = ${userId} for update`;
            held();
            await released;
        });
        try {
            await isHeld;
            setSqlForTests(pool);
            const refreshing = refresh("claude-refresh");
            await until(
                async () => (await lockWaiters(observer)) >= 1,
                "the refresh to reach its insert",
            );
            let disconnected = false;
            const disconnecting = (async () => {
                const res = await disconnect(userId, CLAUDE);
                disconnected = true;
                return res;
            })();
            // Either the Disconnect has already finished (nothing made it
            // wait for the refresh) or it queues behind the refresh.
            await until(
                async () => disconnected || (await lockWaiters(observer)) >= 2,
                "the Disconnect to finish or to queue behind the refresh",
            );
            release();
            await holding;
            const [refreshed, disc] = await Promise.all([
                refreshing,
                disconnecting,
            ]);

            expect(disc.status).toBe(303);
            expect(await tokensLeft(userId)).toEqual({ access: 0, refresh: 0 });
            if (refreshed.status === 200) {
                const body = (await refreshed.json()) as {
                    access_token: string;
                };
                expect((await lookupBearer(body.access_token)).status).toBe(
                    "invalid",
                );
            }
        } finally {
            release();
            await Promise.allSettled([holding]);
            setSqlForTests(sql);
            await Promise.all([pool.close(), holder.close(), observer.close()]);
        }
    });

    test("a Disconnect that lands while an authorization code is storing its pair leaves the app with no tokens", async () => {
        const { pg, sql } = getCtx();
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await seedAuthCode("claude-code", userId);
        const pool = new SQL(pg.url, { prepare: false, max: 6 });
        const holder = new SQL(pg.url, { prepare: false, max: 1 });
        const observer = new SQL(pg.url, { prepare: false, max: 1 });
        let release!: () => void;
        const released = new Promise<void>((r) => (release = r));
        let held!: () => void;
        const isHeld = new Promise<void>((r) => (held = r));
        // As for the refresh: the member's user row held, so the insert of the
        // new tokens stalls between "code consumed" and "pair stored".
        const holding = holder.begin(async (tx) => {
            await tx`select 1 from public.users where id = ${userId} for update`;
            held();
            await released;
        });
        try {
            await isHeld;
            setSqlForTests(pool);
            const exchanging = exchangeCode("claude-code");
            await until(
                async () => (await lockWaiters(observer)) >= 1,
                "the exchange to reach its insert",
            );
            let disconnected = false;
            const disconnecting = (async () => {
                const res = await disconnect(userId, CLAUDE);
                disconnected = true;
                return res;
            })();
            await until(
                async () => disconnected || (await lockWaiters(observer)) >= 2,
                "the Disconnect to finish or to queue behind the exchange",
            );
            release();
            await holding;
            const [exchanged, disc] = await Promise.all([
                exchanging,
                disconnecting,
            ]);

            expect(disc.status).toBe(303);
            expect(await tokensLeft(userId)).toEqual({ access: 0, refresh: 0 });
            if (exchanged.status === 200) {
                const body = (await exchanged.json()) as {
                    access_token: string;
                };
                expect((await lookupBearer(body.access_token)).status).toBe(
                    "invalid",
                );
            }
        } finally {
            release();
            await Promise.allSettled([holding]);
            setSqlForTests(sql);
            await Promise.all([pool.close(), holder.close(), observer.close()]);
        }
    });

    test("an authorization code exchanged after Disconnect is refused", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await seedAuthCode("claude-code", userId);
        await disconnect(userId, CLAUDE);

        const res = await exchangeCode("claude-code");

        expect(res.status).toBe(400);
        expect(await tokensLeft(userId)).toEqual({ access: 0, refresh: 0 });
    });

    test("a failed PKCE check still burns the code", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await seedAuthCode("claude-code", userId);

        const bad = await oauthApp.request("http://test/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code",
                code: "claude-code",
                redirect_uri: CODE_REDIRECT,
                code_verifier: "w".repeat(50),
                client_id: CLAUDE,
            }).toString(),
        });
        expect(bad.status).toBe(400);

        // The code is spent: the right verifier is refused too, and nothing
        // beyond the seeded token exists.
        expect((await exchangeCode("claude-code")).status).toBe(400);
        expect(await tokensLeft(userId)).toEqual({ access: 1, refresh: 0 });
    });

    test("a refresh after Disconnect is refused", async () => {
        await seed("claude-tok", userId, CLAUDE, "Claude");
        await runAsSystem("seed refresh", () =>
            storeRefreshToken("claude-refresh", userId, CLAUDE),
        );
        await disconnect(userId, CLAUDE);

        const res = await refresh("claude-refresh");

        expect(res.status).toBe(400);
        expect(await tokensLeft(userId)).toEqual({ access: 0, refresh: 0 });
    });

    test("apps refreshing in a loop never survive Disconnect", async () => {
        const { pg, sql } = getCtx();
        const pool = new SQL(pg.url, { prepare: false, max: 8 });
        const TRIALS = 40;
        const INSTANCES = 3;
        let survivors = 0;
        try {
            setSqlForTests(pool);
            for (let trial = 0; trial < TRIALS; trial++) {
                await sql`delete from public.oauth_tokens`;
                await sql`delete from public.refresh_tokens`;
                // The Disconnect fires after a few refreshes, while the apps
                // are already asking for the next ones. A survivor of the
                // race keeps refreshing for ever, so the loops stop on the
                // flag once the Disconnect has answered.
                const after = 1 + (trial % 4);
                const gate = Promise.withResolvers<void>();
                let stopped = false;
                const loops = Array.from({ length: INSTANCES }, (_, n) =>
                    (async () => {
                        let token = `seed-${trial}-${n}`;
                        await runAsSystem("seed refresh", () =>
                            storeRefreshToken(token, userId, CLAUDE),
                        );
                        for (let done = 0; !stopped;) {
                            const res = await refresh(token);
                            if (res.status !== 200) return;
                            token = (
                                (await res.json()) as { refresh_token: string }
                            ).refresh_token;
                            if (++done === after && n === 0) gate.resolve();
                        }
                    })(),
                );
                const allDone = Promise.all(loops);
                await Promise.race([gate.promise, allDone]);
                expect((await disconnect(userId, CLAUDE)).status).toBe(303);
                stopped = true;
                await allDone;
                const left = await tokensLeft(userId);
                if (left.access > 0 || left.refresh > 0) survivors += 1;
            }
        } finally {
            setSqlForTests(sql);
            await pool.close();
        }
        expect(survivors).toBe(0);
    });
    test("authorization codes exchanged while a Disconnect lands never leave a pair behind", async () => {
        const { pg, sql } = getCtx();
        const pool = new SQL(pg.url, { prepare: false, max: 8 });
        const TRIALS = 40;
        const CODES = 4;
        let survivors = 0;
        try {
            setSqlForTests(pool);
            await seed("claude-tok", userId, CLAUDE, "Claude");
            for (let trial = 0; trial < TRIALS; trial++) {
                await sql`delete from public.oauth_tokens`;
                await sql`delete from public.refresh_tokens`;
                const codes = Array.from(
                    { length: CODES },
                    (_, n) => `code-${trial}-${n}`,
                );
                for (const code of codes) await seedAuthCode(code, userId);
                // The Disconnect fires once the first exchange has answered,
                // while the rest are already in flight.
                const first = Promise.withResolvers<void>();
                const exchanges = codes.map((code) =>
                    exchangeCode(code).then((res) => {
                        first.resolve();
                        return res;
                    }),
                );
                await first.promise;
                expect((await disconnect(userId, CLAUDE)).status).toBe(303);
                await Promise.all(exchanges);
                const left = await tokensLeft(userId);
                if (left.access > 0 || left.refresh > 0) survivors += 1;
            }
        } finally {
            setSqlForTests(sql);
            await pool.close();
        }
        expect(survivors).toBe(0);
    });
});
