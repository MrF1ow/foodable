import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { SQL } from "bun";
import { resetFlagsForTests } from "../../flags.js";
import { createProduct } from "../../domain/foods.js";
import { createRecipe } from "../../domain/recipes.js";
import { liveFoodsStore } from "../../db/foods.js";
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

    const ids = (list: string[]): [string, string][] =>
        list.map((id) => ["ids[]", id]);

    async function seedLines(names: string[]): Promise<string[]> {
        const storeId = await seedGroceryStore(sql, householdId);
        const sectionId = await seedGrocerySection(sql, householdId, storeId);
        const out: string[] = [];
        for (const name of names) {
            const foodId = await seedFood(sql, householdId, { name });
            const id = crypto.randomUUID();
            await sql`
                insert into public.grocery_lines (
                    id, household_id, store_id, section_id, kind,
                    display_name, amount, unit, food_id, checked
                )
                values (
                    ${id}, ${householdId}, ${storeId}, ${sectionId}, ${"food"},
                    ${name}, ${2}, ${"each"}, ${foodId}, ${false}
                )
            `;
            out.push(id);
        }
        return out;
    }

    const lines = async () =>
        (await sql`
            select display_name, checked from public.grocery_lines
            where household_id = ${householdId} order by display_name
        `) as { display_name: string; checked: boolean }[];

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

    describe("groceries", () => {
        test("check off ticks the selected lines and answers with a toast", async () => {
            const [milk, eggs, bread] = await seedLines([
                "Milk",
                "Eggs",
                "Bread",
            ]);
            const res = await post("/kitchen/groceries/bulk/check", [
                ...ids([milk!, bread!]),
                ["return_to", "/kitchen/groceries?store=abc"],
            ]);
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(
                "/kitchen/groceries?store=abc",
            );
            expect(toastKey(res)).toBe("grocery.line.checked");
            expect(await lines()).toEqual([
                { display_name: "Bread", checked: true },
                { display_name: "Eggs", checked: false },
                { display_name: "Milk", checked: true },
            ]);
            expect(eggs).toBeDefined();
        });

        test("delete removes the lines, and the same post again still redirects", async () => {
            const [milk, eggs] = await seedLines(["Milk", "Eggs"]);
            const fields = [
                ...ids([milk!, eggs!]),
                ["return_to", "/kitchen/groceries"],
            ] as [string, string][];
            const first = await post("/kitchen/groceries/bulk/remove", fields);
            const second = await post("/kitchen/groceries/bulk/remove", fields);
            expect([first.status, second.status]).toEqual([303, 303]);
            expect(toastKey(first)).toBe("grocery.lines.removed");
            // Nothing changed the second time, so nothing is announced.
            expect(toastKey(second)).toBeNull();
            expect(second.headers.get("location")).toBe("/kitchen/groceries");
            expect(await lines()).toEqual([]);
        });

        test("an id that is not there answers 400 with the page and changes nothing", async () => {
            const [milk] = await seedLines(["Milk"]);
            const res = await post(
                "/kitchen/groceries/bulk/remove",
                ids([milk!, crypto.randomUUID()]),
            );
            expect(res.status).toBe(400);
            const html = await res.text();
            expect(html).toContain("Reload the page and select again.");
            expect(html).toContain('role="alert"');
            expect(await lines()).toHaveLength(1);
        });

        test("an empty or malformed selection answers 400", async () => {
            const none = await post("/kitchen/groceries/bulk/check", []);
            expect(none.status).toBe(400);
            expect(await none.text()).toContain("Select at least one item.");
            const bad = await post("/kitchen/groceries/bulk/check", [
                ["ids[]", "not-a-uuid"],
            ]);
            expect(bad.status).toBe(400);
        });

        test("a return_to that leaves the app falls back to the list", async () => {
            const [milk] = await seedLines(["Milk"]);
            const res = await post("/kitchen/groceries/bulk/check", [
                ...ids([milk!]),
                ["return_to", "https://evil.example/"],
            ]);
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/kitchen/groceries");
        });

        test("no session is sent to sign in and writes nothing", async () => {
            const [milk] = await seedLines(["Milk"]);
            const res = await post(
                "/kitchen/groceries/bulk/remove",
                ids([milk!]),
                null,
            );
            expect(res.status).not.toBe(303);
            expect(await lines()).toHaveLength(1);
        });
    });

    describe("fridge", () => {
        async function seedFridge(names: string[]): Promise<string[]> {
            const locationId = await seedFridgeLocation(sql, householdId);
            const out: string[] = [];
            for (const name of names) {
                const foodId = await seedFood(sql, householdId, { name });
                out.push(
                    await seedFridgeItem(sql, householdId, locationId, foodId, {
                        displayName: name,
                        amount: 3,
                        unit: "each",
                    }),
                );
            }
            return out;
        }

        test("discard writes a discard movement per item as the member", async () => {
            const [yogurt, spinach, cheese] = await seedFridge([
                "Yogurt",
                "Spinach",
                "Cheese",
            ]);
            const res = await post("/kitchen/fridge/bulk/discard", [
                ...ids([yogurt!, spinach!]),
                ["return_to", "/kitchen/fridge"],
            ]);
            expect(res.status).toBe(303);
            expect(toastKey(res)).toBe("fridge.items.discarded");
            const left = await sql`
                select id from public.fridge_items where household_id = ${householdId}
            `;
            expect(left.map((r: { id: string }) => r.id)).toEqual([cheese!]);
            const moves = await sql`
                select actor_user_id from public.stock_movements
                where household_id = ${householdId} and reason = 'discard'
            `;
            expect(moves).toHaveLength(2);
            expect(
                moves.every(
                    (m: { actor_user_id: string }) =>
                        m.actor_user_id === userId,
                ),
            ).toBe(true);
        });

        test("one item gone answers 400 and discards none", async () => {
            const [yogurt] = await seedFridge(["Yogurt"]);
            const res = await post(
                "/kitchen/fridge/bulk/discard",
                ids([yogurt!, crypto.randomUUID()]),
            );
            expect(res.status).toBe(400);
            expect(await res.text()).toContain("select again");
            const [row] = await sql`
                select count(*)::int as n from public.fridge_items
                where household_id = ${householdId}
            `;
            expect(row.n).toBe(1);
        });
    });

    describe("usuals", () => {
        test("remove unlinks the products of the selected usuals", async () => {
            const plainId = await seedFood(sql, householdId, { name: "Milk" });
            const product = await createProduct(
                liveFoodsStore(),
                householdId,
                plainId,
                { name: "Milk (store brand)", makeUsual: true },
            );
            const res = await post("/kitchen/usuals/bulk/remove", [
                ...ids([plainId]),
                ["return_to", "/kitchen/usuals"],
            ]);
            expect(res.status).toBe(303);
            expect(toastKey(res)).toBe("usuals.removed");
            const [row] = await sql`
                select generic_food_id from public.foods where id = ${product.id}
            `;
            expect(row.generic_food_id).toBeNull();
        });

        test("a food that is not a usual, picked with a usual, answers 400 and removes nothing", async () => {
            const plainId = await seedFood(sql, householdId, { name: "Milk" });
            const product = await createProduct(
                liveFoodsStore(),
                householdId,
                plainId,
                { name: "Milk (store brand)", makeUsual: true },
            );
            const salt = await seedFood(sql, householdId, { name: "Salt" });
            const res = await post(
                "/kitchen/usuals/bulk/remove",
                ids([plainId, salt]),
            );
            expect(res.status).toBe(400);
            const [row] = await sql`
                select generic_food_id from public.foods where id = ${product.id}
            `;
            expect(row.generic_food_id).toBe(plainId);
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
            expect(toastKey(res)).toBe("settings.saved.deleted");
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
