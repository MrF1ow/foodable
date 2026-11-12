import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { runAsSystem } from "./db/actor.js";
import { revokeConnection, storeToken } from "./db/tokens.js";
import { setSqlForTests } from "./db/sql.js";
import { describeDb } from "./db/testing/pg.js";
import { seedHousehold } from "./db/testing/fixtures.js";
import { findPgBin } from "./db/testing/pg-temp.js";
import { handleMcp } from "./mcp/server.js";
import { authenticateBearer } from "./middleware.js";
import { _resetBuckets } from "./rate-limit.js";

const pgAvailable = await findPgBin();

// The real bearer check in front of the real /mcp handler, over a real
// database: a token the member disconnected must stop working at once, on
// whichever protocol era the client speaks.
function mcpApp() {
    const app = new Hono();
    app.all("/mcp", authenticateBearer, handleMcp);
    return app;
}

const LEGACY_INITIALIZE = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "c", version: "0" },
    },
};

const MODERN_DISCOVER = {
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: {
        _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
        },
    },
};

type Era = { name: string; body: unknown; headers: Record<string, string> };

const ERAS: Era[] = [
    {
        name: "2025-11-25",
        body: LEGACY_INITIALIZE,
        headers: {},
    },
    {
        name: "2026-07-28",
        body: MODERN_DISCOVER,
        headers: {
            "mcp-protocol-version": "2026-07-28",
            "mcp-method": "server/discover",
        },
    },
];

function post(app: Hono, token: string, era: Era, ip: string) {
    return app.request("http://x/mcp", {
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

describeDb(pgAvailable !== null, "mcp token revocation", (getCtx) => {
    let userId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        await _resetBuckets();
        ({ userId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    for (const era of ERAS) {
        test(`a disconnected app's token gets 401 on /mcp (${era.name})`, async () => {
            await runAsSystem("seed tokens", async () => {
                await storeToken("app-token", userId, "client-1");
                await storeToken("other-app-token", userId, "client-2");
            });
            const app = mcpApp();

            expect((await post(app, "app-token", era, "10.1.0.1")).status).toBe(
                200,
            );

            expect(await revokeConnection(userId, "client-1")).toBe(1);

            const revoked = await post(app, "app-token", era, "10.1.0.1");
            expect(revoked.status).toBe(401);
            expect(revoked.headers.get("www-authenticate")).toContain("Bearer");
            // Another app of the same member keeps working.
            expect(
                (await post(app, "other-app-token", era, "10.1.0.2")).status,
            ).toBe(200);
        });
    }
});
