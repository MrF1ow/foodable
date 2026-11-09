import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    spyOn,
    test,
} from "bun:test";
import { Hono } from "hono";
import {
    Client,
    StreamableHTTPClientTransport,
    type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { currentActor, type Actor } from "./db/actor.js";
import * as tokens from "./db/tokens.js";
import * as household from "./db/household.js";
import * as profiles from "./db/profiles.js";
import { authenticateBearer } from "./middleware.js";
import { requireMember, requireSiteUser } from "./web/middleware.js";
import { mintSiteSession, SITE_COOKIE } from "./site-session.js";
import { handleMcp } from "./mcp/server.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "./flags.js";

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const ALICE = "11111111-1111-4111-8111-111111111111";
const HH = "22222222-2222-4222-8222-222222222222";

let toolActor: Actor | undefined;

beforeAll(() => {
    setFlagsForTests(createMemoryFlags());
});

afterAll(() => {
    resetFlagsForTests();
});

beforeEach(() => {
    toolActor = undefined;
    spyOn(tokens, "lookupBearer").mockImplementation(async (token) => {
        if (token === "user-token") {
            return { status: "valid", kind: "user", userId: ALICE };
        }
        if (token === "hh-token") {
            return {
                status: "valid",
                kind: "household",
                householdId: HH,
            };
        }
        return { status: "invalid" };
    });
    spyOn(household, "getHouseholdMembership").mockImplementation(
        async (userId) => {
            expect(currentActor()?.kind).toBe("system");
            if (userId !== ALICE) return null;
            return {
                householdId: HH,
                userId: ALICE,
                role: "owner",
                displayName: "Alice",
            };
        },
    );
    spyOn(household, "listHouseholdMembers").mockImplementation(async () => {
        toolActor = currentActor();
        return [];
    });
    spyOn(profiles, "getProfile").mockResolvedValue(null);
});

afterEach(() => {
    spyOn(tokens, "lookupBearer").mockRestore();
    spyOn(household, "getHouseholdMembership").mockRestore();
    spyOn(household, "listHouseholdMembers").mockRestore();
    spyOn(profiles, "getProfile").mockRestore();
});

function sessionCookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("site entry sets the actor", () => {
    test("requireSiteUser exposes a user actor in the route handler", async () => {
        let seen: Actor | undefined;
        const app = new Hono();
        app.get("/probe", requireSiteUser, (c) => {
            seen = currentActor();
            return c.text("ok");
        });
        const res = await app.request("http://x/probe", {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(seen).toEqual({
            kind: "user",
            userId: ALICE,
            householdId: HH,
        });
    });

    test("requireMember exposes a user actor in the route handler", async () => {
        let seen: Actor | undefined;
        const app = new Hono();
        app.get("/probe", requireMember, (c) => {
            seen = currentActor();
            return c.text("ok");
        });
        const res = await app.request("http://x/probe", {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(seen).toEqual({
            kind: "user",
            userId: ALICE,
            householdId: HH,
        });
    });
});

describe("bearer entry sets the actor", () => {
    test("authenticateBearer exposes a household actor downstream", async () => {
        let seen: Actor | undefined;
        const app = new Hono();
        app.all("/mcp", authenticateBearer, (c) => {
            seen = currentActor();
            return c.json({ ok: true });
        });
        const res = await app.request("http://x/mcp", {
            method: "POST",
            headers: { Authorization: "Bearer hh-token" },
        });
        expect(res.status).toBe(200);
        expect(seen).toEqual({ kind: "household", householdId: HH });
    });

    test("authenticateBearer resolves household on user tokens", async () => {
        let seen: Actor | undefined;
        const app = new Hono();
        app.all("/mcp", authenticateBearer, (c) => {
            seen = currentActor();
            return c.json({ ok: true });
        });
        const res = await app.request("http://x/mcp", {
            method: "POST",
            headers: { Authorization: "Bearer user-token" },
        });
        expect(res.status).toBe(200);
        expect(seen).toEqual({
            kind: "user",
            userId: ALICE,
            householdId: HH,
        });
    });
});

type EraMode = Extract<VersionNegotiationMode, string> | { pin: "2026-07-28" };

async function withHttpHouseholdClient<T>(
    mode: EraMode,
    run: (client: Client) => Promise<T>,
): Promise<T> {
    const app = new Hono();
    app.all("/mcp", authenticateBearer, handleMcp);
    const transport = new StreamableHTTPClientTransport(
        new URL("http://test.local/mcp"),
        {
            fetch: async (url, init) => {
                const req = new Request(String(url), {
                    ...init,
                    headers: {
                        ...Object.fromEntries(new Headers(init?.headers)),
                        Authorization: "Bearer hh-token",
                    },
                });
                return app.request(req);
            },
        },
    );
    const client = new Client(
        { name: "actor-entry", version: "0" },
        { versionNegotiation: { mode } },
    );
    await client.connect(transport);
    try {
        return await run(client);
    } finally {
        await client.close();
    }
}

describe("mcp tool handlers see the actor", () => {
    test.each<EraMode>(["legacy", { pin: "2026-07-28" }])(
        "list_members on %s",
        async (mode) => {
            await withHttpHouseholdClient(mode, async (client) => {
                await client.callTool({ name: "list_members", arguments: {} });
            });
            expect(toolActor).toBeDefined();
            expect(toolActor!).toEqual({
                kind: "household",
                householdId: HH,
            });
        },
    );
});
