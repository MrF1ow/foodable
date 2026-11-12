import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import {
    createMemoryShareLinkStore,
    createShareLink,
    revokeShareLink,
    type ShareLink,
    type ShareView,
} from "../../domain/sharing.js";
import {
    createMemoryRateLimitStore,
    setRateLimitStore,
    SHARE_LIMIT_PER_WINDOW,
} from "../../rate-limit.js";
import { createShareLinksRoutes, shareLinksEnabledFor } from "./share-links.js";

const HH = "11111111-1111-4111-8111-111111111111";
const USER = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-12T12:00:00.000Z");

const RECIPE_VIEW: ShareView = {
    kind: "recipe",
    recipe: {
        name: "Lentil soup",
        portions: 4,
        instructions: "Simmer.",
        tags: ["dinner"],
        ingredients: [{ name: "Lentils", amount: 300, unit: "g", note: null }],
    },
};

const REQUIRED_HEADERS = {
    "x-robots-tag": "noindex",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
} as const;

function setup(over: { enabled?: boolean; view?: ShareView | null } = {}) {
    const links = createMemoryShareLinkStore();
    const loaded: ShareLink[] = [];
    const app = new Hono().route(
        "/",
        createShareLinksRoutes({
            links,
            now: () => NOW,
            enabled: async () => over.enabled ?? true,
            load: async (link) => {
                loaded.push(link);
                return over.view === undefined ? RECIPE_VIEW : over.view;
            },
        }),
    );
    async function mint(expiresInDays?: number) {
        return createShareLink(
            links,
            {
                householdId: HH,
                kind: "recipe",
                targetId: crypto.randomUUID(),
                createdBy: USER,
                expiresInDays,
            },
            NOW,
            { getRecipe: async () => ({}) },
        );
    }
    return { app, links, mint, loaded };
}

async function snapshot(res: Response) {
    return {
        status: res.status,
        body: await res.text(),
        headers: [...res.headers.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
        ),
    };
}

beforeEach(() => {
    setRateLimitStore(createMemoryRateLimitStore());
});

afterEach(() => {
    resetFlagsForTests();
});

describe("GET /s/:token", () => {
    test("a live recipe token shows the recipe, with the privacy headers", async () => {
        const { app, mint } = setup();
        const { token } = await mint();
        const res = await app.request(`/s/${token}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
            expect(res.headers.get(name)).toBe(value);
        }
        const html = await res.text();
        expect(html).toContain("Lentil soup");
        expect(html).toContain("Lentils");
    });

    test("the object is loaded for the link's own household, once", async () => {
        const { app, mint, loaded } = setup();
        const { token, link } = await mint();
        await app.request(`/s/${token}`);
        expect(loaded.map((l) => l.id)).toEqual([link.id]);
        expect(loaded[0]!.householdId).toBe(HH);
    });

    test("no cookie is read: a stray session cookie changes nothing", async () => {
        const { app, mint } = setup();
        const { token } = await mint();
        const bare = await snapshot(await app.request(`/s/${token}`));
        const withCookie = await snapshot(
            await app.request(`/s/${token}`, {
                headers: {
                    cookie: "foodable_site=v1.someone-else.9999999999.sig; foodable_toast=x",
                },
            }),
        );
        expect(withCookie).toEqual(bare);
    });

    test("unknown, malformed, expired, revoked, deleted-object and flag-off all answer the same 404", async () => {
        const live = setup();
        const revoked = await live.mint();
        await revokeShareLink(live.links, HH, revoked.link.id, NOW);
        const expired = await live.mint(1);
        const later = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
        const expiredApp = new Hono().route(
            "/",
            createShareLinksRoutes({
                links: live.links,
                now: () => later,
                enabled: async () => true,
                load: async () => RECIPE_VIEW,
            }),
        );
        const gone = setup({ view: null });
        const goneToken = (await gone.mint()).token;
        const off = setup({ enabled: false });
        const offToken = (await off.mint()).token;

        const cases = await Promise.all([
            live.app.request(`/s/${"A".repeat(43)}`), // well formed, unknown
            live.app.request("/s/short"), // malformed
            live.app.request(`/s/${"!".repeat(43)}`), // malformed, right length
            live.app.request(`/s/${revoked.token}`),
            expiredApp.request(`/s/${expired.token}`),
            gone.app.request(`/s/${goneToken}`),
            off.app.request(`/s/${offToken}`),
            live.app.request("/s/"),
            live.app.request("/s"),
            live.app.request(`/s/${revoked.token}/extra`),
            live.app.request(`/s/${(await live.mint()).token}`, {
                method: "POST",
            }),
        ]);
        const shots = await Promise.all(cases.map(snapshot));
        for (const shot of shots) {
            expect(shot.status).toBe(404);
            expect(shot.body).toBe("Not found");
            expect(shot).toEqual(shots[0]!);
        }
        const names = shots[0]!.headers.map(([name]) => name);
        for (const name of Object.keys(REQUIRED_HEADERS)) {
            expect(names).toContain(name);
        }
        // a non-token answer must not mention why
        expect(shots[0]!.body).not.toMatch(/revoked|expired|disabled/i);
    });

    test("a refused link never touches the object", async () => {
        const off = setup({ enabled: false });
        const { token } = await off.mint();
        await off.app.request(`/s/${token}`);
        expect(off.loaded).toEqual([]);
    });

    test("429 past the per-IP limit, with Retry-After and the same headers", async () => {
        const { app } = setup();
        const hit = () =>
            app.request(`/s/${"B".repeat(43)}`, {
                headers: { "x-real-ip": "203.0.113.77" },
            });
        let last = await hit();
        for (let i = 1; i < SHARE_LIMIT_PER_WINDOW; i++) last = await hit();
        expect(last.status).toBe(404);
        const blocked = await hit();
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
        for (const [name, value] of Object.entries(REQUIRED_HEADERS)) {
            expect(blocked.headers.get(name)).toBe(value);
        }
    });
});

describe("shareLinksEnabledFor", () => {
    const link: ShareLink = {
        id: crypto.randomUUID(),
        householdId: HH,
        kind: "grocery_list",
        targetId: null,
        createdBy: null,
        createdAt: NOW.toISOString(),
        expiresAt: null,
        revokedAt: null,
    };

    test("follows ui-v2, judged for the link's household when its creator is gone", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        expect(await shareLinksEnabledFor(link)).toBe(true);
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        expect(await shareLinksEnabledFor(link)).toBe(false);
    });

    test("a link stays open with mcp-share-links alone, and closes with both off", async () => {
        setFlagsForTests(
            createMemoryFlags({ "ui-v2": false, "mcp-share-links": true }),
        );
        expect(await shareLinksEnabledFor(link)).toBe(true);
        setFlagsForTests(
            createMemoryFlags({ "ui-v2": false, "mcp-share-links": false }),
        );
        expect(await shareLinksEnabledFor(link)).toBe(false);
    });
});
