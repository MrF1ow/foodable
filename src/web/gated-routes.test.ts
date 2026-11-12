import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import type { NoticesForResult } from "../domain/notices-for.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../flags.js";
import type { HouseholdMember } from "../household.js";
import { viewerChromeWithAttention, viewerFlagsFor } from "./attention.js";
import { gatedRoute } from "./gated.js";
import { requireMember, requireSiteUser } from "./middleware.js";
import {
    assertGatedRoutesOff,
    gatedRoutesOf,
} from "../test-support/flag-harness.js";
import * as actualHousehold from "../db/household.js";

const realHousehold = { ...actualHousehold };

const ALICE = "11111111-1111-4111-8111-111111111111";

const member: HouseholdMember = {
    userId: ALICE,
    householdId: "hh-1",
    role: "owner",
    displayName: "Alice",
};

let membershipLookups = 0;

mock.module("../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) => {
        membershipLookups += 1;
        return userId === ALICE ? member : null;
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
    test("gated routes are off while ui-v2 is off", async () => {
        const routes = await assertGatedRoutesOff(app, {
            cookie: sessionCookie(ALICE),
        });
        const invites = routes.filter((r) =>
            r.path.startsWith("/settings/household/invites"),
        );
        expect(invites.map((r) => r.path).sort()).toEqual([
            "/settings/household/invites",
            "/settings/household/invites",
            "/settings/household/invites/revoke",
        ]);
        const stores = routes.filter((r) =>
            r.path.startsWith("/settings/household/stores"),
        );
        expect(stores.map((r) => `${r.method} ${r.path}`).sort()).toEqual(
            [
                "GET /settings/household/stores",
                "GET /settings/household/stores/:id",
                "POST /settings/household/stores/add",
                "POST /settings/household/stores/order",
                "POST /settings/household/stores/preferences",
                "POST /settings/household/stores/:id/rename",
                "POST /settings/household/stores/:id/delete",
                "POST /settings/household/stores/:id/sections",
                "POST /settings/household/stores/:id/sections/order",
                "POST /settings/household/stores/:id/sections/:sectionId/rename",
                "POST /settings/household/stores/:id/sections/:sectionId/visibility",
                "POST /settings/household/stores/:id/rules/add",
            ].sort(),
        );
        expect(
            routes.filter(
                (r) =>
                    !r.path.startsWith("/settings/household/invites") &&
                    !r.path.startsWith("/settings/household/stores"),
            ),
        ).toEqual([
            {
                method: "POST",
                path: "/meals/:id/edit",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/meals/:id/delete",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/meals/undo",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/meals/:id/again",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/foods/:id",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/foods/:id/add-to-grocery",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/foods/by-barcode/:code",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/foods/by-barcode/:code",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/kitchen/usuals/:foodId/schedule",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/kitchen/fridge/items/:id/freeze",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/kitchen/groceries/put-away",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/recipes/:id/cook/preview",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/recipes/:id/cook/confirm",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/recipes/:id/favourite",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/settings/household/plurals-same-food",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/settings/household/items/:id/archive",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/settings/account",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/settings/display",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/settings/goals",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/settings/saved",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/settings/export",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/settings/export",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/settings/display",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/dev/gallery-v2",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/api/log/search",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/log",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/log/quick",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/log/water",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/log/weight",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "POST",
                path: "/log/copy-yesterday",
                flag: "ui-v2",
                notFound: true,
            },
            {
                method: "GET",
                path: "/trends",
                flag: "ui-v2",
                notFound: true,
            },
        ]);
    });
});

describe("invite revoke", () => {
    test("a malformed invite id is a 400, not a uuid cast error", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        let hits = 0;
        const sub = new Hono();
        sub.get(
            "/redirect",
            requireMember,
            gatedRoute("ui-v2", { redirectTo: "/" }),
            () => {
                hits += 1;
                return new Response("ok");
            },
        );
        sub.get(
            "/missing",
            requireMember,
            gatedRoute("ui-v2", { notFound: true }),
            () => {
                hits += 1;
                return new Response("ok");
            },
        );
        sub.post(
            "/redirect",
            requireMember,
            gatedRoute("ui-v2", { redirectTo: "/" }),
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

        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
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
                "ui-v2": (ctx) => ctx.household_id === member.householdId,
            }),
        );
        const sub = new Hono();
        sub.get(
            "/site",
            requireSiteUser,
            gatedRoute("ui-v2", { redirectTo: "/" }),
            (c) => c.text(c.get("viewerFlags").uiV2 ? "on" : "off"),
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
    test("default ui-v2 off; on when memory flag set", async () => {
        setFlagsForTests(createMemoryFlags());
        const off = await viewerChromeWithAttention(
            { theme: "light" },
            member,
            emptyNotices,
        );
        expect(off.flags.uiV2).toBe(false);
        expect(off.identity).toBeUndefined();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        let identityLoads = 0;
        const on = await viewerChromeWithAttention(
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
        expect(on.flags.uiV2).toBe(true);
        expect(identityLoads).toBe(1);
        expect(on.identity?.householdName).toBe("The Test household");
    });

    test("viewerFlagsFor evaluates like the tabbed chrome (loadViewerFlags)", async () => {
        setFlagsForTests(createMemoryFlags());
        expect((await viewerFlagsFor(member)).uiV2).toBe(false);
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        expect((await viewerFlagsFor(member)).uiV2).toBe(true);
    });
});
