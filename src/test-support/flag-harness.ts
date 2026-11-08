import { expect } from "bun:test";
import type { Hono } from "hono";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
    type FlagName,
} from "../flags.js";
import { registerTools } from "../mcp/server.js";
import type { AuthContext } from "../auth-context.js";
import type { GatedToolEntry } from "../mcp/shared.js";
import { gatedRouteInfo, type GatedRouteMeta } from "../web/gated.js";
import type { ViewerFlags } from "../viewer-flags.js";

export type GatedRouteRef = { method: string; path: string } & GatedRouteMeta;

export function gatedRoutesOf(app: Hono): GatedRouteRef[] {
    const found: GatedRouteRef[] = [];
    for (const route of app.routes) {
        const info = gatedRouteInfo(route.handler);
        if (!info) continue;
        const path =
            route.path === "/*" && route.basePath !== "/"
                ? route.basePath.replace(/\/$/, "")
                : route.path;
        found.push({
            method: route.method,
            path,
            ...info,
        });
    }
    return found;
}

function pathForRequest(template: string): string {
    return template.replace(/:[^/]+/g, "test-id");
}

export type AssertGatedRoutesOpts = {
    /** Signed site session cookie header value (`foodable_site=…`). */
    cookie: string;
};

export async function assertGatedRoutesOff(
    app: Hono,
    opts: AssertGatedRoutesOpts,
): Promise<GatedRouteRef[]> {
    const routes = gatedRoutesOf(app);
    for (const route of routes) {
        setFlagsForTests(
            createMemoryFlags({ [route.flag]: false } as Record<
                FlagName,
                boolean
            >),
        );
        const url = `http://test${pathForRequest(route.path)}`;
        const headers = { cookie: opts.cookie };
        try {
            if (route.method === "ALL" || route.method === "GET") {
                const get = await app.request(url, { method: "GET", headers });
                expectGateOffGet(get, route);
            }
            if (route.method === "ALL" || route.method === "HEAD") {
                const head = await app.request(url, {
                    method: "HEAD",
                    headers,
                });
                expectGateOffGet(head, route);
            }
            // Only routes registered for POST: a GET-only gate never sees a
            // POST, and the same path may carry an ungated write.
            if (route.method === "ALL" || route.method === "POST") {
                const post = await app.request(url, {
                    method: "POST",
                    headers,
                });
                expect(post.status).toBe(404);
            }
        } finally {
            resetFlagsForTests();
        }
    }
    return routes;
}

function expectGateOffGet(res: Response, route: GatedRouteRef): void {
    if (!("redirectTo" in route)) {
        expect(res.status).toBe(404);
        return;
    }
    // The exact target, so a login redirect from a bad cookie (which runs
    // before the gate) cannot pass for the gate's own redirect.
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(route.redirectTo);
}

export async function toolNamesFor(
    flags: ViewerFlags,
    register?: (
        server: McpServer,
        auth: AuthContext,
        flags: ViewerFlags,
    ) => GatedToolEntry[] | void,
    auth: AuthContext = { kind: "user", userId: "u1" },
): Promise<{ names: string[]; gated: GatedToolEntry[] }> {
    const server = new McpServer(
        { name: "foodable-test", version: "0.0.0" },
        { capabilities: { tools: {}, resources: {} } },
    );
    let gated: GatedToolEntry[] = [];
    if (register) {
        const custom = register(server, auth, flags);
        gated = custom ?? [];
    } else {
        const ctx = registerTools(
            server,
            auth,
            true,
            null,
            undefined,
            "http://localhost",
            true,
            flags,
        );
        gated = ctx.gatedTools;
    }
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);
    try {
        const { tools } = await client.listTools();
        return { names: tools.map((t) => t.name), gated };
    } finally {
        await client.close();
        await server.close();
    }
}
