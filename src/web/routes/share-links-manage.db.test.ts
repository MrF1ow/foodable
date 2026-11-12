// The household side of share links, against real Postgres: a member makes a
// link from a recipe or the grocery list and sees its address once, and
// revokes it from Settings. The public page the link opens is covered in
// share-links.db.test.ts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { Hono } from "hono";
import { liveRecipesStore } from "../../db/recipes.js";
import { liveShareLinkStore } from "../../db/share-links.js";
import { setSqlForTests } from "../../db/sql.js";
import { asUser, seedHousehold } from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { createRecipe } from "../../domain/recipes.js";
import { createShareLink } from "../../domain/sharing.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import {
    createMemoryRateLimitStore,
    setRateLimitStore,
} from "../../rate-limit.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { householdRoutes } from "./household.js";
import { createShareLinksRoutes } from "./share-links.js";
import { shareLinkManageRoutes } from "./share-links-manage.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_IN_URL = /https?:\/\/[^\s"'<>]+\/s\/([A-Za-z0-9_-]{43})/g;

describeDb(pgAvailable !== null, "share links from the app", (getCtx) => {
    let sql: SQL;
    let householdId: string;
    let ownerId: string;
    let otherHouseholdId: string;
    let otherOwnerId: string;

    const app = () =>
        new Hono()
            .route("/", shareLinkManageRoutes)
            .route("/", householdRoutes)
            .route("/", createShareLinksRoutes());

    beforeEach(async () => {
        const ctx = getCtx();
        sql = ctx.sql;
        await ctx.truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        setRateLimitStore(createMemoryRateLimitStore());
        const a = await seedHousehold(sql);
        householdId = a.householdId;
        ownerId = a.userId;
        const b = await seedHousehold(sql);
        otherHouseholdId = b.householdId;
        otherOwnerId = b.userId;
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    function post(
        userId: string,
        path: string,
        fields: Record<string, string> = {},
    ) {
        return app().request(`http://test${path}`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(fields).toString(),
        });
    }

    function get(userId: string, path: string) {
        return app().request(`http://test${path}`, {
            headers: { cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}` },
        });
    }

    async function seedRecipe(hh: string, by: string, name = "Lentil soup") {
        return asUser(
            by,
            () =>
                createRecipe(liveRecipesStore(), {
                    householdId: hh,
                    creatorId: by,
                    name,
                    yieldPortions: 4,
                    instructions: "1. Simmer.",
                    tags: [],
                }),
            hh,
        );
    }

    async function storedLinks(hh = householdId) {
        return asUser(
            ownerId,
            () =>
                liveShareLinkStore().listForHousehold(hh, {
                    includeInactive: true,
                }),
            hh,
        );
    }

    async function allStoredCount(): Promise<number> {
        const [row] =
            await sql`select count(*)::int as n from public.share_links`;
        return Number((row as { n: number }).n);
    }

    function tokenOf(html: string): string {
        const found = [...html.matchAll(TOKEN_IN_URL)];
        expect(found.length).toBeGreaterThan(0);
        return found[0]![1]!;
    }

    async function publicStatus(token: string): Promise<number> {
        const res = await app().request(`http://test/s/${token}`);
        return res.status;
    }

    /** Nothing a response carries outside its body may hold the token. */
    function expectTokenOnlyInBody(res: Response, token: string) {
        expect(res.headers.get("location")).toBeNull();
        expect(res.headers.getSetCookie()).toEqual([]);
        for (const [, value] of res.headers) {
            expect(value).not.toContain(token);
        }
    }

    test("a recipe link: 200, the address once, and its token opens the recipe", async () => {
        const recipe = await seedRecipe(householdId, ownerId);
        const res = await post(ownerId, `/recipes/${recipe.id}/share`, {
            expires: "never",
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toContain("no-store");
        const html = await res.text();
        const token = tokenOf(html);
        expect(html.split(token).length - 1).toBe(1);
        expectTokenOnlyInBody(res, token);

        const [link] = await storedLinks();
        expect(link).toMatchObject({
            kind: "recipe",
            targetId: recipe.id,
            createdBy: ownerId,
            expiresAt: null,
            revokedAt: null,
        });
        const page = await publicStatus(token);
        expect(page).toBe(200);
    });

    test("a grocery list link opens the list", async () => {
        const res = await post(ownerId, "/kitchen/groceries/share", {
            expires: "never",
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        const token = tokenOf(html);
        expectTokenOnlyInBody(res, token);
        const [link] = await storedLinks();
        expect(link).toMatchObject({
            kind: "grocery_list",
            targetId: null,
            createdBy: ownerId,
        });
        expect(await publicStatus(token)).toBe(200);
    });

    test("the expiry choices are honoured", async () => {
        const recipe = await seedRecipe(householdId, ownerId);
        const before = Date.now();
        for (const days of [7, 30, 90]) {
            const res = await post(ownerId, `/recipes/${recipe.id}/share`, {
                expires: String(days),
            });
            expect(res.status).toBe(200);
        }
        const links = (await storedLinks()).sort(
            (a, b) =>
                Date.parse(a.expiresAt ?? "") - Date.parse(b.expiresAt ?? ""),
        );
        expect(links.map((l) => l.expiresAt !== null)).toEqual([
            true,
            true,
            true,
        ]);
        [7, 30, 90].forEach((days, i) => {
            const at = Date.parse(links[i]!.expiresAt!);
            expect(at).toBeGreaterThanOrEqual(before + days * DAY_MS - 1000);
            expect(at).toBeLessThanOrEqual(Date.now() + days * DAY_MS + 1000);
        });
    });

    test("an expiry the form does not offer is refused and nothing is stored", async () => {
        const recipe = await seedRecipe(householdId, ownerId);
        for (const expires of ["5", "0", "-1", "abc", "9999"]) {
            const res = await post(ownerId, `/recipes/${recipe.id}/share`, {
                expires,
            });
            expect(res.status).toBe(400);
            expect(await res.text()).not.toMatch(TOKEN_IN_URL);
        }
        expect(await allStoredCount()).toBe(0);
    });

    test("another household's recipe and a non-uuid are refused and nothing is stored", async () => {
        const foreign = await seedRecipe(otherHouseholdId, otherOwnerId);
        const res = await post(ownerId, `/recipes/${foreign.id}/share`, {
            expires: "never",
        });
        expect(res.status).toBe(404);
        expect(await res.text()).not.toMatch(TOKEN_IN_URL);

        for (const id of ["not-a-uuid", "1", "%27%3B--"]) {
            const bad = await post(ownerId, `/recipes/${id}/share`, {
                expires: "never",
            });
            expect(bad.status).toBe(404);
        }
        const missing = await post(
            ownerId,
            `/recipes/${crypto.randomUUID()}/share`,
            { expires: "never" },
        );
        expect(missing.status).toBe(404);
        expect(await allStoredCount()).toBe(0);
    });

    test("the household comes from the session, never the form", async () => {
        const foreign = await seedRecipe(otherHouseholdId, otherOwnerId);
        const res = await post(ownerId, "/kitchen/groceries/share", {
            expires: "never",
            household_id: otherHouseholdId,
            recipe_id: foreign.id,
        });
        expect(res.status).toBe(200);
        expect(await storedLinks(otherHouseholdId)).toEqual([]);
        expect(await storedLinks(householdId)).toHaveLength(1);
    });

    test("a signed-in non-member is refused and nothing is stored", async () => {
        const lonely = crypto.randomUUID();
        await sql`insert into public.users (id, email) values (${lonely}, ${`lonely-${lonely}@foodable.test`})`;
        const recipe = await seedRecipe(householdId, ownerId);
        const a = await post(lonely, `/recipes/${recipe.id}/share`, {
            expires: "never",
        });
        const b = await post(lonely, "/kitchen/groceries/share", {
            expires: "never",
        });
        expect(a.status).toBe(403);
        expect(b.status).toBe(403);
        expect(await allStoredCount()).toBe(0);
    });

    test("with ui-v2 off every handler is a 404 and nothing is stored", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const recipe = await seedRecipe(householdId, ownerId);
        const link = await asUser(
            ownerId,
            () =>
                createShareLink(
                    liveShareLinkStore(),
                    {
                        householdId,
                        kind: "grocery_list",
                        createdBy: ownerId,
                    },
                    new Date(),
                    liveRecipesStore(),
                ),
            householdId,
        );
        const before = await allStoredCount();
        expect(
            (await post(ownerId, `/recipes/${recipe.id}/share`)).status,
        ).toBe(404);
        expect((await post(ownerId, "/kitchen/groceries/share")).status).toBe(
            404,
        );
        expect(
            (
                await post(
                    ownerId,
                    `/settings/household/shared-links/${link.link.id}/revoke`,
                )
            ).status,
        ).toBe(404);
        expect(await allStoredCount()).toBe(before);
        expect((await storedLinks())[0]!.revokedAt).toBeNull();
    });

    async function make(
        by: string,
        hh: string,
        kind: "recipe" | "grocery_list",
        targetId: string | null,
        expiresInDays?: number,
    ) {
        return asUser(
            by,
            () =>
                createShareLink(
                    liveShareLinkStore(),
                    {
                        householdId: hh,
                        kind,
                        targetId,
                        createdBy: by,
                        expiresInDays,
                    },
                    new Date(),
                    liveRecipesStore(),
                ),
            hh,
        );
    }

    test("revoking stops the link, is idempotent, and sends the member back to Settings", async () => {
        const { link, token } = await make(
            ownerId,
            householdId,
            "grocery_list",
            null,
        );
        expect(await publicStatus(token)).toBe(200);
        const path = `/settings/household/shared-links/${link.id}/revoke`;
        const first = await post(ownerId, path);
        expect(first.status).toBe(303);
        expect(first.headers.get("location")).toBe("/settings/household");
        expect(await publicStatus(token)).toBe(404);
        const firstRevokedAt = (await storedLinks())[0]!.revokedAt;
        expect(firstRevokedAt).not.toBeNull();

        const again = await post(ownerId, path);
        expect(again.status).toBe(303);
        expect((await storedLinks())[0]!.revokedAt).toBe(firstRevokedAt);
    });

    test("another household's link, an unknown id and a non-uuid are refused", async () => {
        const { link, token } = await make(
            otherOwnerId,
            otherHouseholdId,
            "grocery_list",
            null,
        );
        for (const id of [link.id, crypto.randomUUID(), "nope"]) {
            const res = await post(
                ownerId,
                `/settings/household/shared-links/${id}/revoke`,
            );
            expect(res.status).toBe(404);
        }
        expect(await publicStatus(token)).toBe(200);
        expect((await storedLinks(otherHouseholdId))[0]!.revokedAt).toBeNull();
    });

    test("Settings lists the active links: what, who, when, expiry; not revoked or expired", async () => {
        const recipe = await seedRecipe(householdId, ownerId, "Dal tadka");
        await sql`update public.household_members set display_name = 'Ada' where user_id = ${ownerId}`;
        const keep = await make(ownerId, householdId, "recipe", recipe.id, 30);
        await make(ownerId, householdId, "grocery_list", null);
        const gone = await make(ownerId, householdId, "grocery_list", null);
        await post(
            ownerId,
            `/settings/household/shared-links/${gone.link.id}/revoke`,
        );
        const expired = await make(
            ownerId,
            householdId,
            "recipe",
            recipe.id,
            1,
        );
        await sql`update public.share_links set expires_at = now() - interval '1 hour' where id = ${expired.link.id}`;
        await make(otherOwnerId, otherHouseholdId, "grocery_list", null);

        const res = await get(ownerId, "/settings/household");
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Shared links");
        expect(html).toContain("Dal tadka");
        expect(html).toContain("Grocery list");
        expect(html).toContain("Ada");
        expect(html).toContain("Never expires");
        expect(html).toMatch(/Expires/);
        // Two active rows, one Revoke each, by link id.
        expect(
            html.match(/shared-links\/[0-9a-f-]{36}\/revoke/g) ?? [],
        ).toHaveLength(2);
        expect(html).toContain(`shared-links/${keep.link.id}/revoke`);
        expect(html).not.toContain(`shared-links/${gone.link.id}/revoke`);
        expect(html).not.toContain(`shared-links/${expired.link.id}/revoke`);
        // Nothing in the list can give a link's address back.
        for (const t of [keep.token]) expect(html).not.toContain(t);
    });

    test("Settings with no links shows an empty state", async () => {
        const res = await get(ownerId, "/settings/household");
        const html = await res.text();
        expect(html).toContain("Shared links");
        expect(html).toContain("No shared links");
        expect(html).not.toMatch(/shared-links\/[0-9a-f-]{36}\/revoke/);
    });
});
