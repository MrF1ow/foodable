// The week plan tools against real Postgres, through the real /mcp handler on
// both protocol eras. The in-memory tool tests are in the plan block of
// src/mcp.test.ts; what they cannot show is two calls at once: plan_recipe says
// planning the same slot twice is one plan, and add_plan_missing_to_groceries
// says a second call adds nothing, so parallel calls (an agent firing several,
// the chat card beside an agent, the web app) have to hold to that too.
import {
    Client,
    StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import { liveRecipePlansStore, planTransaction } from "../../db/plans.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { householdClock } from "../../db/restock.js";
import { liveSettingsStore } from "../../db/settings.js";
import { pairAppSqlForTests, setSqlForTests } from "../../db/sql.js";
import {
    asUser,
    seedGroceryStore,
    seedHousehold,
} from "../../db/testing/fixtures.js";
import { describeDb } from "../../db/testing/pg.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { actOnNotice } from "../../domain/notice-actions.js";
import { planRecipe } from "../../domain/plan.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { handleMcp } from "../server.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests skipped: no initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

type Era = "legacy" | { pin: "2026-07-28" };
const ERAS: Era[] = ["legacy", { pin: "2026-07-28" }];

type Result = {
    isError?: boolean;
    structuredContent?: Record<string, any>;
    content: { type: string; text: string }[];
};
type Call = (name: string, args?: Record<string, unknown>) => Promise<Result>;

async function withClient<T>(
    userId: string,
    era: Era,
    run: (call: Call) => Promise<T>,
): Promise<T> {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId });
        return handleMcp(c);
    });
    const client = new Client(
        { name: "t", version: "0" },
        { versionNegotiation: { mode: era } },
    );
    await client.connect(
        new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
            fetch: async (url, init) =>
                app.request(new Request(String(url), init)),
        }),
    );
    try {
        return await run(
            async (name, args) =>
                (await client.callTool({
                    name,
                    arguments: args ?? {},
                })) as Result,
        );
    } finally {
        await client.close();
    }
}

describeDb(pgAvailable !== null, "week plan tools (db)", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let recipeId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        setFlagsForTests(createMemoryFlags({ "mcp-plan-tools": true }));
        ({ householdId, userId: ownerId } = await seedHousehold(sql));
        recipeId = crypto.randomUUID();
        await sql`
            insert into public.recipes (
                id, household_id, creator_id, name, yield_portions
            )
            values (${recipeId}, ${householdId}, ${ownerId}, ${"Soup"}, ${2})
        `;
    });

    afterEach(() => {
        resetFlagsForTests();
        setSqlForTests(null);
    });

    const DAY = "2099-01-02";

    // The shared test pool is one connection, which lines calls up by itself and
    // would let a race test pass without the lock. A race needs connections of
    // its own: an owner pool and an app-role pool of six each, swapped in for
    // the test and closed afterwards.
    async function withRacePools<T>(run: () => Promise<T>): Promise<T> {
        const appUrl = new URL(getCtx().pg.url);
        appUrl.username = "foodable_app";
        const raceOwner = new SQL(getCtx().pg.url, {
            prepare: false,
            max: 6,
        });
        const raceApp = new SQL(appUrl.toString(), {
            prepare: false,
            max: 6,
        });
        pairAppSqlForTests(raceOwner, raceApp);
        setSqlForTests(raceOwner);
        try {
            return await run();
        } finally {
            setSqlForTests(getCtx().sql);
            await raceApp.close();
            await raceOwner.close();
        }
    }

    async function planCount(): Promise<number> {
        const [row] = await getCtx().sql`
            select count(*)::int as n from public.recipe_plans
        `;
        return Number(row.n);
    }

    test("planRecipe with the household lock: parallel calls for one recipe, day and slot make one plan", async () => {
        const once = () =>
            asUser(
                ownerId,
                () =>
                    planRecipe(
                        liveRecipePlansStore(),
                        {
                            householdId,
                            recipeId,
                            recipeYield: 2,
                            date: DAY,
                            slot: "dinner",
                            today: "2099-01-01",
                            createdBy: ownerId,
                        },
                        {
                            transaction: planTransaction(
                                "plan-recipe",
                                householdId,
                            ),
                        },
                    ),
                householdId,
            );
        const out = await withRacePools(() =>
            Promise.all([once(), once(), once(), once()]),
        );
        expect(await planCount()).toBe(1);
        expect(out.filter((o) => o?.alreadyPlanned === false)).toHaveLength(1);
        expect(new Set(out.map((o) => o?.plan.id)).size).toBe(1);
    });

    test.each(ERAS)(
        "parallel plan_recipe calls make one plan (%p)",
        async (era) => {
            await withRacePools(() =>
                withClient(ownerId, era, async (call) => {
                    const args = {
                        recipe_id: recipeId,
                        date: DAY,
                        slot: "lunch",
                    };
                    const out = await Promise.all(
                        [1, 2, 3, 4].map(() => call("plan_recipe", args)),
                    );
                    expect(out.every((r) => !r.isError)).toBe(true);
                    expect(await planCount()).toBe(1);
                    expect(
                        out.filter((r) => r.structuredContent?.already_planned)
                            .length,
                    ).toBe(3);
                    // A different slot is a different plan.
                    await call("plan_recipe", { ...args, slot: "dinner" });
                    expect(await planCount()).toBe(2);
                }),
            );
        },
    );

    test.each(ERAS)(
        "parallel add_plan_missing_to_groceries calls add each missing food once (%p)",
        async (era) => {
            const { sql } = getCtx();
            const storeId = await seedGroceryStore(sql, householdId);
            await sql`
                insert into public.grocery_sections (
                    id, household_id, store_id, name, sort_order, hidden, is_other
                )
                values (
                    ${crypto.randomUUID()}, ${householdId}, ${storeId},
                    ${"Other"}, ${0}, ${false}, ${true}
                )
            `;
            await withRacePools(() =>
                withClient(ownerId, era, async (call) => {
                    const flour = await call("upsert_food", { name: "Flour" });
                    await call("add_recipe_ingredient", {
                        recipe_id: recipeId,
                        food_id: flour.structuredContent!.id,
                        amount: 200,
                        unit: "g",
                    });
                    const today = (await call("get_week_plan"))
                        .structuredContent!.today;
                    await call("plan_recipe", {
                        recipe_id: recipeId,
                        date: today,
                        slot: "lunch",
                    });
                    const out = await Promise.all(
                        [1, 2, 3].map(() =>
                            call("add_plan_missing_to_groceries"),
                        ),
                    );
                    expect(out.every((r) => !r.isError)).toBe(true);
                    // One call added Flour; the others found it on the list.
                    expect(
                        out.reduce(
                            (n, r) =>
                                n +
                                (r.structuredContent!.added.length as number),
                            0,
                        ),
                    ).toBe(1);
                    const [row] = await sql`
                        select count(*)::int as n from public.grocery_lines
                        where household_id = ${householdId}
                    `;
                    expect(Number(row.n)).toBe(1);
                }),
            );
        },
    );

    test.each(ERAS)(
        "a notice action racing add_plan_missing_to_groceries adds each food once (%p)",
        async (era) => {
            const { sql } = getCtx();
            const storeId = await seedGroceryStore(sql, householdId);
            await sql`
                insert into public.grocery_sections (
                    id, household_id, store_id, name, sort_order, hidden, is_other
                )
                values (
                    ${crypto.randomUUID()}, ${householdId}, ${storeId},
                    ${"Other"}, ${0}, ${false}, ${true}
                )
            `;
            await withRacePools(() =>
                withClient(ownerId, era, async (call) => {
                    const flour = await call("upsert_food", { name: "Flour" });
                    const flourId = flour.structuredContent!.id as string;
                    await call("add_recipe_ingredient", {
                        recipe_id: recipeId,
                        food_id: flourId,
                        amount: 200,
                        unit: "g",
                    });
                    const today = (await call("get_week_plan"))
                        .structuredContent!.today;
                    await call("plan_recipe", {
                        recipe_id: recipeId,
                        date: today,
                        slot: "lunch",
                    });
                    const clock = await asUser(
                        ownerId,
                        () => householdClock(householdId),
                        householdId,
                    );
                    const act = () =>
                        asUser(
                            ownerId,
                            () =>
                                actOnNotice(
                                    {
                                        foods: liveFoodsStore(),
                                        fridge: liveFridgeStore(),
                                        recipes: liveRecipesStore(),
                                        dismissals: liveNoticeDismissalsStore(),
                                        grocery: liveGroceryStore(),
                                        plans: liveRecipePlansStore(),
                                        settings: liveSettingsStore(),
                                        transaction: planTransaction(
                                            "plan-missing",
                                            householdId,
                                        ),
                                    },
                                    householdId,
                                    {
                                        code: "plan.missing_ingredient",
                                        subjectId: flourId,
                                    },
                                    clock,
                                ),
                            householdId,
                        );
                    const [acts, calls] = await Promise.all([
                        Promise.all([act(), act(), act()]),
                        Promise.all([
                            call("add_plan_missing_to_groceries"),
                            call("add_plan_missing_to_groceries"),
                            call("add_plan_missing_to_groceries"),
                        ]),
                    ]);
                    expect(calls.every((r) => !r.isError)).toBe(true);
                    const added =
                        acts.filter((r) => r.status === "added").length +
                        calls.reduce(
                            (n, r) =>
                                n +
                                (r.structuredContent!.added.length as number),
                            0,
                        );
                    expect(added).toBe(1);
                    const [row] = await sql`
                    select count(*)::int as n from public.grocery_lines
                    where household_id = ${householdId}
                `;
                    expect(Number(row.n)).toBe(1);
                }),
            );
        },
    );

    test.each(ERAS)(
        "plan_recipe with an id that is not a uuid says the recipe is not found, not a database error (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                for (const bad of ["not-a-uuid", "12", ""]) {
                    const res = await call("plan_recipe", {
                        recipe_id: bad,
                        date: DAY,
                        slot: "lunch",
                    });
                    expect(res.isError).toBe(true);
                    expect(res.content[0]!.text).toMatch(
                        /^(Error: )?Recipe not found\.$/,
                    );
                }
                expect(await planCount()).toBe(0);
            });
        },
    );
});
