import { describe, expect, test, afterEach } from "bun:test";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../flags.js";
import type { HouseholdMember } from "../household.js";
import { gatedRoute, gatedRouteInfo, GATED_ROUTE } from "./gated.js";

afterEach(() => {
    resetFlagsForTests();
});

const member: HouseholdMember = {
    userId: "u1",
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

const authMiddleware = createMiddleware(async (c, next) => {
    c.set("userId", member.userId);
    c.set("member", member);
    await next();
});

describe("gatedRoute", () => {
    test("GET flag off redirects", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        let hit = false;
        const app = new Hono();
        app.get(
            "/new",
            authMiddleware,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            (c) => {
                hit = true;
                return c.text("ok", 200);
            },
        );
        const res = await app.request("http://x/new", { method: "GET" });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe("/");
        expect(hit).toBe(false);
    });

    test("GET flag off with notFound", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        const app = new Hono();
        app.get(
            "/hidden",
            authMiddleware,
            gatedRoute("mcp-share-links", { notFound: true }),
            (c) => c.text("ok", 200),
        );
        const res = await app.request("http://x/hidden", { method: "GET" });
        expect(res.status).toBe(404);
    });

    test("HEAD flag off redirects", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        const app = new Hono();
        app.get(
            "/new",
            authMiddleware,
            gatedRoute("mcp-share-links", { redirectTo: "/dash" }),
            () => new Response(null, { status: 200 }),
        );
        const res = await app.request("http://x/new", { method: "HEAD" });
        expect(res.status).toBe(302);
    });

    test("POST flag off is always 404", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        let hit = false;
        const app = new Hono();
        app.post(
            "/new",
            authMiddleware,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            (c) => {
                hit = true;
                return c.text("ok", 200);
            },
        );
        const res = await app.request("http://x/new", { method: "POST" });
        expect(res.status).toBe(404);
        expect(hit).toBe(false);
    });

    test("flag on runs handler for GET and POST", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        const app = new Hono();
        app.get(
            "/new",
            authMiddleware,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            (c) => c.text("ok", 200),
        );
        app.post(
            "/new",
            authMiddleware,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            (c) => c.text("posted", 200),
        );
        expect((await app.request("http://x/new")).status).toBe(200);
        expect(
            (await app.request("http://x/new", { method: "POST" })).status,
        ).toBe(200);
    });

    test("missing userId throws", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        const app = new Hono();
        app.onError((err, c) => c.text(err.message, 500));
        app.get(
            "/new",
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            (c) => c.text("ok", 200),
        );
        const res = await app.request("http://x/new");
        expect(res.status).toBe(500);
    });

    test("gatedRouteInfo returns metadata", () => {
        const gate = gatedRoute("mcp-share-links", { redirectTo: "/a" });
        expect(gatedRouteInfo(gate)).toEqual({
            flag: "mcp-share-links",
            redirectTo: "/a",
        });
        expect(gatedRouteInfo(() => {})).toBeUndefined();
        expect(
            Object.prototype.propertyIsEnumerable.call(gate, GATED_ROUTE),
        ).toBe(false);
    });
});
