import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { NoticesForResult } from "../domain/notices-for.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../flags.js";
import type { HouseholdMember } from "../household.js";
import {
    loadViewerNotices,
    viewerChromeWithAttention,
    viewerFlagsFor,
} from "./attention.js";
import { gatedRoute } from "./gated.js";
import { requireMember, requireSiteUser } from "./middleware.js";
import {
    assertGatedRoutesOff,
    gatedRoutesOf,
} from "../test-support/flag-harness.js";
import * as actualHousehold from "../db/household.js";

const realHousehold = { ...actualHousehold };

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";

const member: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

const plainMember: HouseholdMember = {
    userId: BOB,
    householdId: "hh-1",
    role: "member",
    displayName: "Bob",
};

let membershipLookups = 0;

mock.module("../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) => {
        membershipLookups += 1;
        if (userId === ALICE) return member;
        return userId === BOB ? plainMember : null;
    },
    householdExists: async () => true,
}));

// mock.module is process-wide: restore from the snapshot taken before it.
afterAll(() => {
    mock.module("../db/household.js", () => realHousehold);
});

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("../index.js");
const { mintSiteSession, SITE_COOKIE } = await import("../site-session.js");

function sessionCookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

const emptyNotices: NoticesForResult = {
    notices: [],
    dismissals: [],
    subjectNames: new Map(),
    subjectTimes: new Map(),
    noticeFoods: new Map(),
    catalogFoods: [],
    aliasMap: new Map(),
    barcodedIds: new Set(),
    possibleDuplicatePairs: [],
    recipesListPrefetch: {
        recipes: [],
        allIngredients: [],
        fridgeItems: [],
        foodsById: new Map(),
    },
};

afterEach(() => {
    resetFlagsForTests();
});

describe("gated route harness on composed app", () => {
    // The household app has no gated routes left but the sharing ones (the
    // share and revoke routes and the shared-recipe import): they follow
    // `mcp-share-links`, which stays off on this deploy.
    test("gated routes are off while their flag is off", async () => {
        const routes = await assertGatedRoutesOff(app, {
            cookie: sessionCookie(ALICE),
        });
        expect(routes).toEqual([
            {
                method: "POST",
                path: "/recipes/import-shared",
                flag: "mcp-share-links",
                notFound: true,
            },
            {
                method: "POST",
                path: "/recipes/:id/share",
                flag: "mcp-share-links",
                notFound: true,
            },
            {
                method: "POST",
                path: "/kitchen/groceries/share",
                flag: "mcp-share-links",
                notFound: true,
            },
            {
                method: "POST",
                path: "/settings/household/shared-links/:id/revoke",
                flag: "mcp-share-links",
                notFound: true,
            },
        ]);
    });
});

describe("household product score, owner and admin only", () => {
    const PATH = "http://test/settings/product-score/household";

    test("a plain member is refused with 403", async () => {
        for (const method of ["GET", "POST"] as const) {
            const res = await app.request(PATH, {
                method,
                headers: { cookie: sessionCookie(BOB) },
            });
            expect(res.status).toBe(403);
        }
    });
});

describe("invite revoke", () => {
    test("a malformed invite id is a 400, not a uuid cast error", async () => {
        const errors: unknown[] = [];
        const realError = console.error;
        console.error = (...args: unknown[]) => void errors.push(args);
        try {
            const res = await app.request(
                "/settings/household/invites/revoke",
                {
                    method: "POST",
                    headers: {
                        cookie: sessionCookie(ALICE),
                        "content-type": "application/x-www-form-urlencoded",
                        origin: "http://localhost",
                    },
                    body: "invite_id=notauuid",
                },
            );
            expect(res.status).toBe(400);
        } finally {
            console.error = realError;
        }
        expect(errors).toEqual([]);
    });
});

describe("gated route harness on test routes", () => {
    test("redirect and notFound routes with requireMember", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        let hits = 0;
        const sub = new Hono();
        sub.get(
            "/redirect",
            requireMember,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            () => {
                hits += 1;
                return new Response("ok");
            },
        );
        sub.get(
            "/missing",
            requireMember,
            gatedRoute("mcp-share-links", { notFound: true }),
            () => {
                hits += 1;
                return new Response("ok");
            },
        );
        sub.post(
            "/redirect",
            requireMember,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            () => {
                hits += 1;
                return new Response("ok");
            },
        );
        const routes = gatedRoutesOf(sub);
        expect(routes.map((r) => r.path).sort()).toEqual(
            ["/missing", "/redirect", "/redirect"].sort(),
        );
        await assertGatedRoutesOff(sub, {
            cookie: sessionCookie(ALICE),
        });
        expect(hits).toBe(0);

        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        const on = await sub.request("http://x/redirect", {
            method: "GET",
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(on.status).toBe(200);
        const postOn = await sub.request("http://x/redirect", {
            method: "POST",
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(postOn.status).toBe(200);
    });
});

describe("gatedRoute after requireSiteUser", () => {
    test("looks the member up once and evaluates the flag with it", async () => {
        // On only for a viewer whose household the gate resolved itself.
        setFlagsForTests(
            createMemoryFlags({
                "mcp-share-links": (ctx) =>
                    ctx.household_id === member.householdId,
            }),
        );
        const sub = new Hono();
        sub.get(
            "/site",
            requireSiteUser,
            gatedRoute("mcp-share-links", { redirectTo: "/" }),
            (c) => c.text(c.get("viewerFlags").mcpShareLinks ? "on" : "off"),
        );
        membershipLookups = 0;
        const res = await sub.request("http://x/site", {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe("on");
        expect(membershipLookups).toBe(1);
    });
});

describe("viewerChromeWithAttention flags", () => {
    test("loads the shell identity and carries the viewer's flags", async () => {
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        let identityLoads = 0;
        const chrome = await viewerChromeWithAttention(
            { theme: "light" },
            member,
            emptyNotices,
            async (viewer) => {
                identityLoads++;
                return {
                    viewerName: viewer.displayName,
                    viewerRole: viewer.role,
                    householdName: "The Test household",
                    memberCount: 3,
                };
            },
        );
        expect(chrome.flags.mcpShareLinks).toBe(true);
        expect(identityLoads).toBe(1);
        expect(chrome.identity?.householdName).toBe("The Test household");
    });

    test("picture versions are read once per page", async () => {
        const identity = async (viewer: HouseholdMember) => ({
            viewerUserId: viewer.userId,
            viewerName: viewer.displayName,
            viewerRole: viewer.role,
            householdName: "Home",
            memberCount: 2,
        });
        const stamp = new Date(1700000000000);
        let reads = 0;
        const versions = async (householdId: string) => {
            reads++;
            expect(householdId).toBe("hh-1");
            return new Map([[ALICE, stamp]]);
        };

        const on = await viewerChromeWithAttention(
            { theme: "light" },
            member,
            emptyNotices,
            identity,
            versions,
        );
        expect(reads).toBe(1);
        expect(on.identity?.avatarVersions?.get(ALICE)).toBe(stamp);

        // A failed read leaves initials everywhere rather than failing the page.
        const failed = await viewerChromeWithAttention(
            { theme: "light" },
            member,
            emptyNotices,
            identity,
            async () => {
                throw new Error("db down");
            },
        );
        expect(failed.identity?.avatarVersions?.size).toBe(0);
    });

    test("the one-tap notices light Kitchen, Today and Recipes", async () => {
        const withNotices = (): NoticesForResult => ({
            ...emptyNotices,
            notices: [
                {
                    code: "grocery.running_low",
                    severity: "warn",
                    subject: { kind: "food", id: "f1" },
                    related: [],
                    params: { name: "Eggs", reason: "0 left, below 4" },
                },
                {
                    code: "plan.missing_ingredient",
                    severity: "warn",
                    subject: { kind: "food", id: "f2" },
                    related: [],
                    params: { name: "Flour" },
                },
                {
                    code: "nutrition.weigh_in_due",
                    severity: "info",
                    subject: { kind: "member", id: ALICE },
                    related: [],
                    params: { name: "Alice", days: 9 },
                },
            ],
        });
        setFlagsForTests(createMemoryFlags());
        const on = await viewerChromeWithAttention(
            { theme: "light" },
            member,
            withNotices(),
            async () => ({
                viewerName: "Alice",
                viewerRole: "owner",
                householdName: "Home",
                memberCount: 1,
            }),
        );
        expect(on.attention.tabs).toEqual({
            grocery: true,
            nutrition: true,
            recipes: true,
        });
        // Another member's weigh-in is not Alice's to act on: Today stays quiet.
        const other = withNotices();
        other.notices = other.notices.filter(
            (n) => n.code === "nutrition.weigh_in_due",
        );
        other.notices[0]!.subject = { kind: "member", id: "someone-else" };
        const quiet = await viewerChromeWithAttention(
            { theme: "light" },
            member,
            other,
            async () => ({
                viewerName: "Alice",
                viewerRole: "owner",
                householdName: "Home",
                memberCount: 2,
            }),
        );
        expect(quiet.attention.tabs).toEqual({});
    });

    test("a viewer always loads the one-tap notices", async () => {
        const seen: (boolean | undefined)[] = [];
        const load = async (
            _householdId: string,
            opts?: { actionable?: boolean },
        ) => {
            seen.push(opts?.actionable);
            return emptyNotices;
        };
        setFlagsForTests(createMemoryFlags());
        await loadViewerNotices(member, undefined, load);
        await loadViewerNotices(member, { today: "2026-11-12" }, load);
        expect(seen).toEqual([true, true]);
    });

    test("viewerFlagsFor evaluates like the tabbed chrome (loadViewerFlags)", async () => {
        setFlagsForTests(createMemoryFlags());
        expect((await viewerFlagsFor(member)).mcpShareLinks).toBe(false);
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        expect((await viewerFlagsFor(member)).mcpShareLinks).toBe(true);
    });
});
