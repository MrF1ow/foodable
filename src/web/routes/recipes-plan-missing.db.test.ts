// Missing for the plan · Add to groceries (POST /recipes/plan/add-missing)
// against real Postgres: the ticked foods the sheet posts, with and without its
// `food_ids_sent` marker, against the lines the server works out itself.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { SQL } from "bun";
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveRecipePlansStore } from "../../db/plans.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { householdToday } from "../../db/restock.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedFood,
    seedGroceryStore,
    seedHousehold,
} from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { addPlanDays } from "../../domain/plan-week.js";
import { addRecipeIngredientById } from "../../domain/recipes.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { recipesRoutes } from "./recipes.js";

process.env.SESSION_SECRET ||= "01234567890123456789012345678901";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

describeDb(
    pgAvailable !== null,
    "Missing for the plan, add ticked",
    (getCtx) => {
        let sql: SQL;
        let me: { userId: string; householdId: string };
        let foodIds: string[];

        const app = () => new Hono().route("/", recipesRoutes);
        const as = <T>(fn: () => Promise<T>) =>
            asUser(me.userId, fn, me.householdId);

        beforeEach(async () => {
            const ctx = getCtx();
            sql = ctx.sql;
            await ctx.truncateAll();
            setSqlForTests(sql);
            me = await seedHousehold(sql);
            const storeId = await seedGroceryStore(sql, me.householdId);
            await sql`
            insert into public.grocery_sections (
                id, household_id, store_id, name, sort_order, hidden, is_other
            )
            values (
                ${crypto.randomUUID()}, ${me.householdId}, ${storeId},
                ${"Other"}, ${0}, ${false}, ${true}
            )
        `;
            foodIds = [];
            for (const name of ["Flour", "Rice", "Beans", "Oats", "Salt"]) {
                foodIds.push(await seedFood(sql, me.householdId, { name }));
            }
            const recipeId = crypto.randomUUID();
            await sql`
            insert into public.recipes (
                id, household_id, creator_id, name, yield_portions
            )
            values (${recipeId}, ${me.householdId}, ${me.userId}, ${"Soup"}, ${2})
        `;
            await as(async () => {
                for (const foodId of foodIds) {
                    await addRecipeIngredientById(
                        liveRecipesStore(),
                        liveFoodsStore(),
                        {
                            householdId: me.householdId,
                            recipeId,
                            foodId,
                            amount: 200,
                            unit: "g",
                        },
                    );
                }
                const today = await householdToday(me.householdId);
                await liveRecipePlansStore().addPlan({
                    householdId: me.householdId,
                    recipeId,
                    date: addPlanDays(today, 1),
                    slot: "dinner",
                    servings: 2,
                });
            });
        });

        afterEach(() => setSqlForTests(null));

        function post(fields: [string, string][]) {
            const body = new URLSearchParams([["back", "recipes"], ...fields]);
            return app().request("http://test/recipes/plan/add-missing", {
                method: "POST",
                headers: {
                    cookie: `${SITE_COOKIE}=${mintSiteSession(me.userId)}`,
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });
        }

        const onList = async () =>
            (
                (await sql`
                select food_id, source from public.grocery_lines
                where household_id = ${me.householdId}
            `) as { food_id: string; source: string }[]
            ).sort((a, b) => a.food_id.localeCompare(b.food_id));

        const ticked = (ids: string[]): [string, string][] => [
            ["food_ids_sent", "1"],
            ...ids.map((id): [string, string] => ["food_ids[]", id]),
        ];

        test("two of five ticked, with the marker, add exactly those two", async () => {
            const res = await post(ticked([foodIds[1]!, foodIds[3]!]));
            expect(res.status).toBe(303);
            const rows = await onList();
            expect(rows.map((r) => r.food_id)).toEqual(
                [foodIds[1]!, foodIds[3]!].sort(),
            );
            expect(rows.every((r) => r.source === "plan")).toBe(true);
        });

        test("none ticked, with the marker, adds nothing", async () => {
            const res = await post(ticked([]));
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe("/recipes");
            expect(await onList()).toEqual([]);
        });

        test("an old form without the marker adds every missing food", async () => {
            const res = await post([]);
            expect(res.status).toBe(303);
            expect((await onList()).map((r) => r.food_id)).toEqual(
                [...foodIds].sort(),
            );
        });

        test("an id that is not among the missing foods is ignored", async () => {
            const other = await seedFood(sql, me.householdId, {
                name: "Pepper",
            });
            const res = await post(
                ticked([foodIds[0]!, other, crypto.randomUUID(), "not-an-id"]),
            );
            expect(res.status).toBe(303);
            expect((await onList()).map((r) => r.food_id)).toEqual([
                foodIds[0]!,
            ]);
        });
    },
);
