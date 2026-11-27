import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { SQL } from "bun";
import { resetFlagsForTests } from "../../flags.js";
import { createRecipe } from "../../domain/recipes.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { setSqlForTests } from "../../db/sql.js";
import { describeDb } from "../../db/testing/pg.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { TOAST_COOKIE } from "../components/toast.js";
import { bulkRoutes } from "./bulk.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "bulk routes db", (getCtx) => {
    let sql: SQL;
    let householdId: string;
    let userId: string;

    const hono = new Hono();
    hono.route("/", bulkRoutes);

    beforeEach(async () => {
        const ctx = getCtx();
        await ctx.truncateAll();
        sql = ctx.sql;
        setSqlForTests(sql);
        ({ householdId, userId } = await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    function post(
        path: string,
        fields: [string, string][],
        as: string | null = userId,
    ): Promise<Response> {
        const body = new URLSearchParams();
        for (const [k, v] of fields) body.append(k, v);
        return Promise.resolve(
            hono.request(`http://test${path}`, {
                method: "POST",
                headers: {
                    ...(as
                        ? { cookie: `${SITE_COOKIE}=${mintSiteSession(as)}` }
                        : {}),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            }),
        );
    }

    const toastKey = (res: Response): string | null => {
        const cookie = res.headers
            .getSetCookie()
            .find((c) => c.startsWith(`${TOAST_COOKIE}=`));
        if (!cookie) return null;
        const value = cookie.slice(TOAST_COOKIE.length + 1).split(";")[0]!;
        return (
            JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
                k: string;
            }
        ).k;
    };

    describe("the Kitchen tabs have no bulk routes", () => {
        test("posts to the old Kitchen bulk paths are not routed and change nothing", async () => {
            const foodId = await seedFood(sql, householdId, { name: "Milk" });
            const id = crypto.randomUUID();
            const storeId = await seedGroceryStore(sql, householdId);
            const sectionId = await seedGrocerySection(
                sql,
                householdId,
                storeId,
            );
            await sql`
                insert into public.grocery_lines (
                    id, household_id, store_id, section_id, kind,
                    display_name, amount, unit, food_id, checked
                )
                values (
                    ${id}, ${householdId}, ${storeId}, ${sectionId}, ${"food"},
                    ${"Milk"}, ${2}, ${"each"}, ${foodId}, ${false}
                )
            `;
            const locationId = await seedFridgeLocation(sql, householdId);
            const itemId = await seedFridgeItem(
                sql,
                householdId,
                locationId,
                foodId,
                { displayName: "Milk", amount: 3, unit: "each" },
            );
            for (const [path, picked] of [
                ["/kitchen/groceries/bulk/delete", id],
                ["/kitchen/groceries/bulk/check", id],
                ["/kitchen/groceries/bulk/remove", id],
                ["/kitchen/fridge/bulk/discard", itemId],
                ["/kitchen/usuals/bulk/remove", foodId],
            ] as const) {
                const res = await post(path, [
                    ["ids[]", picked],
                    ["return_to", "/kitchen"],
                ]);
                expect(res.status).toBe(404);
            }
            const [lineRow] = await sql`
                select count(*)::int as n from public.grocery_lines
                where household_id = ${householdId}
            `;
            expect(lineRow.n).toBe(1);
            const [itemRow] = await sql`
                select count(*)::int as n from public.fridge_items
                where household_id = ${householdId}
            `;
            expect(itemRow.n).toBe(1);
        });
    });

    describe("saved foods and recipes", () => {
        async function addMember(): Promise<string> {
            const peer = crypto.randomUUID();
            await sql`
                insert into public.users (id, email)
                values (${peer}, ${`peer-${peer}@foodable.test`})
            `;
            await sql`
                insert into public.household_members (
                    household_id, user_id, role, display_name
                )
                values (${householdId}, ${peer}, ${"member"}, ${"Peer"})
            `;
            return peer;
        }

        test("delete archives the foods and deletes the recipes", async () => {
            const oats = await seedFood(sql, householdId, { name: "Oats" });
            const recipe = await createRecipe(liveRecipesStore(), {
                householdId,
                creatorId: userId,
                name: "Porridge",
                yieldPortions: 2,
            });
            const res = await post("/settings/saved/bulk/delete", [
                ["food_ids[]", oats],
                ["recipe_ids[]", recipe.id],
            ]);
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/settings/saved");
            expect(toastKey(res)).toBeNull();
            const [food] = await sql`
                select archived_at from public.foods where id = ${oats}
            `;
            expect(food.archived_at).not.toBeNull();
            const [recipes] = await sql`
                select count(*)::int as n from public.recipes
                where household_id = ${householdId}
            `;
            expect(recipes.n).toBe(0);
        });

        test("a member cannot delete another member's recipe, and nothing is deleted", async () => {
            const peer = await addMember();
            const oats = await seedFood(sql, householdId, { name: "Oats" });
            const theirs = await createRecipe(liveRecipesStore(), {
                householdId,
                creatorId: userId,
                name: "Paella",
                yieldPortions: 4,
            });
            const res = await post(
                "/settings/saved/bulk/delete",
                [
                    ["food_ids[]", oats],
                    ["recipe_ids[]", theirs.id],
                ],
                peer,
            );
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Only the creator");
            const [food] = await sql`
                select archived_at from public.foods where id = ${oats}
            `;
            expect(food.archived_at).toBeNull();
        });

        test("a refused batch comes back with the search it was on", async () => {
            const oats = await seedFood(sql, householdId, { name: "Oats" });
            await seedFood(sql, householdId, { name: "Rice" });
            const res = await post("/settings/saved/bulk/delete", [
                ["food_ids[]", oats],
                ["recipe_ids[]", crypto.randomUUID()],
                ["return_to", "/settings/saved?q=oat"],
            ]);
            expect(res.status).toBe(400);
            const html = await res.text();
            expect(html).toContain("Oats");
            expect(html).not.toContain("Rice");
            expect(html).toContain(
                `name="return_to" value="/settings/saved?q=oat"`,
            );
        });

        test("a done batch goes back to the search it was on, and only to this page", async () => {
            const back = async (returnTo: string) => {
                const oats = await seedFood(sql, householdId, {
                    name: `Oats ${crypto.randomUUID()}`,
                });
                const res = await post("/settings/saved/bulk/delete", [
                    ["food_ids[]", oats],
                    ["return_to", returnTo],
                ]);
                expect(res.status).toBe(303);
                return res.headers.get("location");
            };
            expect(await back("/settings/saved?q=oat")).toBe(
                "/settings/saved?q=oat",
            );
            for (const elsewhere of [
                "//evil.example/settings/saved?q=x",
                "https://evil.example/settings/saved?q=x",
                "/kitchen/groceries?q=x",
                "/settings/saved?q=",
            ]) {
                expect(await back(elsewhere)).toBe("/settings/saved");
            }
        });

        test("nothing selected answers 400", async () => {
            const res = await post("/settings/saved/bulk/delete", []);
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("Select at least one item.");
        });
    });
});
