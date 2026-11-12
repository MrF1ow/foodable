import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { runAsSystem } from "../../db/actor.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    listConnections,
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
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { settingsRoutes } from "./settings.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
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
});
