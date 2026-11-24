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
        setFlagsForTests(createMemoryFlags({}));
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

    async function ruleCount(): Promise<number> {
        const [row] = await getCtx().sql`
            select count(*)::int as n from public.plan_rules
        `;
        return Number(row.n);
    }

    test.each(ERAS)(
        "plan_recipe refuses a repeat over days another repeat of the recipe and meal holds, and writes nothing (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                const plan = (args: Record<string, unknown>) =>
                    call("plan_recipe", {
                        recipe_id: recipeId,
                        date: DAY,
                        slot: "dinner",
                        ...args,
                    });
                expect((await plan({ repeat: "weekly" })).isError).toBeFalsy();
                for (const clash of [
                    { repeat: "daily" },
                    { repeat: "weekdays" },
                    { repeat: "days", days: [5, 6] },
                ]) {
                    const refused = await plan(clash);
                    expect(refused.isError).toBe(true);
                    expect(refused.content[0]!.text).toContain(
                        // 2099-01-02 is a Friday, the only day the weekly one
                        // shares with each of them.
                        "Soup is already planned at dinner on Fri by the repeat every week on Friday. End that series first, or pick other days.",
                    );
                }
                expect(await ruleCount()).toBe(1);
                // The same repeat again is the one that is there.
                const again = await plan({ repeat: "weekly" });
                expect(again.structuredContent?.already_planned).toBe(true);
                // Other days are free, and another meal.
                expect(
                    (await plan({ repeat: "days", days: [6] })).isError,
                ).toBeFalsy();
                expect(
                    (await plan({ repeat: "daily", slot: "lunch" })).isError,
                ).toBeFalsy();
                expect(await ruleCount()).toBe(3);
            });
        },
    );

    test.each(ERAS)(
        "plan_recipe refuses a blank or non-number weekday instead of reading it as Sunday (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                for (const days of [[""], [" "], [null], [true]]) {
                    const refused = await call("plan_recipe", {
                        recipe_id: recipeId,
                        date: DAY,
                        slot: "dinner",
                        repeat: "days",
                        days,
                    });
                    expect(refused.isError).toBe(true);
                }
                expect(await ruleCount()).toBe(0);
                const ok = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: DAY,
                    slot: "dinner",
                    repeat: "days",
                    days: ["3", 5],
                });
                expect(ok.isError).toBeFalsy();
                expect(await ruleCount()).toBe(1);
            });
        },
    );

    test.each(ERAS)(
        "a repeat's plan_id is its own, with its own servings, and removing its series ends that repeat only (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                const first = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: DAY,
                    slot: "dinner",
                    repeat: "days",
                    days: [5],
                    servings: 2,
                });
                const second = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: DAY,
                    slot: "dinner",
                    repeat: "days",
                    days: [6],
                    servings: 1,
                });
                const plan = second.structuredContent!.plan;
                expect(second.structuredContent!.already_planned).toBe(false);
                expect(plan.servings).toBe(1);
                expect(plan.plan_id).not.toBe(
                    first.structuredContent!.plan.plan_id,
                );
                const out = await call("unplan_recipe", {
                    plan_id: plan.plan_id,
                    scope: "series",
                });
                expect(out.isError).toBeFalsy();
                const week = await call("get_week_plan", { from: DAY });
                const days = (week.structuredContent!.days as any[]).flatMap(
                    (d) => d.plans.map((p: any) => `${d.date} ${p.servings}`),
                );
                expect(days).toEqual(["2099-01-02 2"]);
            });
        },
    );

    test.each(ERAS)(
        "asking again for a running repeat from a day taken off it plans that day once (%p)",
        async (era) => {
            const thursday = "2099-01-08";
            await withClient(ownerId, era, async (call) => {
                const plan = () =>
                    call("plan_recipe", {
                        recipe_id: recipeId,
                        date: thursday,
                        slot: "dinner",
                        repeat: "daily",
                    });
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: DAY,
                    slot: "dinner",
                    repeat: "daily",
                });
                await getCtx().sql`
                    update public.plan_rules
                    set skipped_on = array[${thursday}::date]
                    where household_id = ${householdId}
                `;
                const again = await plan();
                expect(again.structuredContent?.already_planned).toBe(false);
                expect((again.structuredContent?.plan as any).date).toBe(
                    thursday,
                );
                const oneOffs = await getCtx().sql<{ date: string }[]>`
                    select to_char(date, 'YYYY-MM-DD') as date
                    from public.recipe_plans
                    where household_id = ${householdId}
                `;
                expect(oneOffs.map((r) => r.date)).toEqual([thursday]);
                expect((await plan()).structuredContent?.already_planned).toBe(
                    true,
                );
            });
        },
    );

    test.each(ERAS)(
        "a one-off and a daily repeat never add up: the day keeps whichever was planned first, with its own servings (%p)",
        async (era) => {
            const wednesday = "2099-01-07";
            const other = crypto.randomUUID();
            await getCtx().sql`
                insert into public.recipes (
                    id, household_id, creator_id, name, yield_portions
                )
                values (${other}, ${householdId}, ${ownerId}, ${"Stew"}, ${2})
            `;
            await withClient(ownerId, era, async (call) => {
                const plan = (
                    id: string,
                    repeat: string,
                    date: string,
                    servings: number,
                ) =>
                    call("plan_recipe", {
                        recipe_id: id,
                        date,
                        slot: "dinner",
                        servings,
                        repeat,
                    });
                // Soup: the one-off first (2), then the repeat (5) skips its
                // day. Stew: the repeat first (2), then a one-off (5) asks for
                // a day it already holds.
                await plan(recipeId, "once", wednesday, 2);
                await plan(recipeId, "daily", DAY, 5);
                await plan(other, "daily", DAY, 2);
                const late = await plan(other, "once", wednesday, 5);
                expect(late.structuredContent?.already_planned).toBe(true);
                // The entry that is there, not one with the servings asked for.
                expect((late.structuredContent?.plan as any).servings).toBe(2);
                expect(late.content[0]!.text).toContain(
                    "Already planned, nothing changed",
                );
                expect(late.content[0]!.text).toContain("edit that plan");
                const week = await call("get_week_plan", { from: DAY });
                const onDay = (week.structuredContent!.days as any[])
                    .filter((d) => d.date === wednesday)
                    .flatMap((d) => d.plans)
                    .map((p: any) => [p.recipe_id, p.servings]);
                expect(onDay).toEqual(
                    expect.arrayContaining([
                        [recipeId, 2],
                        [other, 2],
                    ]),
                );
                expect(onDay).toHaveLength(2);
            });
        },
    );

    test.each(ERAS)(
        "a repeat that starts at the end of the calendar plans its last days, or says it has none (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                const last = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: "9999-12-30",
                    slot: "dinner",
                    repeat: "daily",
                });
                expect(last.isError).toBeFalsy();
                expect(last.structuredContent!.plan.date).toBe("9999-12-30");
                // 9999-12-30 is a Thursday: no Monday is left.
                const none = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: "9999-12-30",
                    slot: "lunch",
                    repeat: "days",
                    days: [1],
                });
                expect(none.isError).toBe(true);
                expect(none.content[0]!.text).toContain(
                    "no day before the calendar ends",
                );
                expect(await ruleCount()).toBe(1);
            });
        },
    );

    test.each(ERAS)(
        "parallel plan_recipe calls for overlapping repeats make one repeat (%p)",
        async (era) => {
            await withRacePools(() =>
                withClient(ownerId, era, async (call) => {
                    const out = await Promise.all(
                        [
                            { repeat: "daily" },
                            { repeat: "weekly" },
                            { repeat: "weekdays" },
                            { repeat: "days", days: [5] },
                        ].map((args) =>
                            call("plan_recipe", {
                                recipe_id: recipeId,
                                date: DAY,
                                slot: "dinner",
                                ...args,
                            }),
                        ),
                    );
                    expect(out.filter((r) => !r.isError)).toHaveLength(1);
                    expect(await ruleCount()).toBe(1);
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
    async function rules(): Promise<Record<string, any>[]> {
        // Plain JSON: the driver's arrays are not plain arrays to toMatchObject.
        const found = await getCtx().sql`
            select
                id, recipe_id, meal, servings::float8 as servings,
                starts_on::text as starts_on, rule, days::int[] as days,
                ends_on::text as ends_on, skipped_on::text[] as skipped_on
            from public.plan_rules
            order by created_at, id
        `;
        return JSON.parse(JSON.stringify(found)) as Record<string, any>[];
    }

    async function seedStoreAndFlour(call: Call): Promise<void> {
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
        const flour = await call("upsert_food", { name: "Flour" });
        await call("add_recipe_ingredient", {
            recipe_id: recipeId,
            food_id: flour.structuredContent!.id,
            amount: 200,
            unit: "g",
        });
    }

    test.each(ERAS)(
        "plan_recipe repeat stores one rule, and the week plan and the missing-for-the-plan read see every day of it (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                await seedStoreAndFlour(call);
                const today = (await call("get_week_plan")).structuredContent!
                    .today as string;
                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "dinner",
                    repeat: "daily",
                    servings: 2,
                });
                expect(planned.isError).toBeFalsy();
                expect(planned.structuredContent!.plan.repeats).toBe(true);
                // One rule, no stored one-off.
                expect(await planCount()).toBe(0);
                expect(await rules()).toMatchObject([
                    {
                        recipe_id: recipeId,
                        meal: "dinner",
                        servings: 2,
                        starts_on: today,
                        rule: "daily",
                        days: [],
                        ends_on: null,
                        skipped_on: [],
                    },
                ]);

                const week = await call("get_week_plan");
                expect(week.structuredContent!.planned_count).toBe(7);
                expect(
                    week.structuredContent!.days.every(
                        (d: any) =>
                            d.plans.length === 1 && d.plans[0].repeats === true,
                    ),
                ).toBe(true);
                // 200 g of flour a day for the seven days of the week.
                expect(week.structuredContent!.missing).toMatchObject([
                    { display_name: "Flour", amount: 1400, unit: "g" },
                ]);
                const added = await call("add_plan_missing_to_groceries");
                expect(added.structuredContent!.added).toMatchObject([
                    { display_name: "Flour", amount: 1400, unit: "g" },
                ]);
            });
        },
    );

    test.each(ERAS)(
        "unplan_recipe skips one day of a repeat, or ends the series, and says what it did (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                const today = (await call("get_week_plan")).structuredContent!
                    .today as string;
                const day = (n: number) =>
                    new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000)
                        .toISOString()
                        .slice(0, 10);
                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "dinner",
                    repeat: "daily",
                });
                const ruleId = (
                    planned.structuredContent!.plan.plan_id as string
                ).split(":")[1]!;

                const skipped = await call("unplan_recipe", {
                    plan_id: `rule:${ruleId}:${day(2)}`,
                });
                expect(skipped.isError).toBeFalsy();
                expect(skipped.content[0]!.text).toContain("can undo");
                expect((await rules())[0]).toMatchObject({
                    skipped_on: [day(2)],
                    ends_on: null,
                });
                // Gone is gone: the day cannot be removed twice.
                expect(
                    (
                        await call("unplan_recipe", {
                            plan_id: `rule:${ruleId}:${day(2)}`,
                        })
                    ).isError,
                ).toBe(true);

                const ended = await call("unplan_recipe", {
                    plan_id: `rule:${ruleId}:${day(4)}`,
                    scope: "series",
                });
                expect(ended.isError).toBeFalsy();
                expect((await rules())[0]).toMatchObject({
                    skipped_on: [day(2)],
                    ends_on: day(3),
                });
                const week = await call("get_week_plan");
                expect(
                    week
                        .structuredContent!.days.filter(
                            (d: any) => d.plans.length > 0,
                        )
                        .map((d: any) => d.date),
                ).toEqual([day(0), day(1), day(3)]);
                // A series is only a repeat's: a one-off has none to end.
                const once = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "snack",
                });
                const refused = await call("unplan_recipe", {
                    plan_id: once.structuredContent!.plan.plan_id,
                    scope: "series",
                });
                expect(refused.isError).toBe(true);
                expect(await planCount()).toBe(1);
            });
        },
    );

    test.each(ERAS)(
        "a plan for a named person follows their saved portions as they change, and a servings given with them is ignored (%p)",
        async (era) => {
            await withClient(ownerId, era, async (call) => {
                const food = async (name: string) =>
                    (
                        await call("upsert_food", {
                            name,
                            on_similar: "create",
                        })
                    ).structuredContent!.id as string;
                const pasta = await food("Pasta");
                const nuts = await food("Peanuts");
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: pasta,
                    amount: 400,
                    unit: "g",
                });
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: nuts,
                    amount: 200,
                    unit: "g",
                });
                const [nutRow] = await getCtx().sql`
                    select id from public.recipe_ingredients
                    where recipe_id = ${recipeId} and food_id = ${nuts}
                `;
                await call("set_recipe_portion", {
                    recipe_id: recipeId,
                    member_id: ownerId,
                    portion_count: 2,
                });
                await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: ownerId,
                    action: "remove",
                    ingredient_id: (nutRow as { id: string }).id,
                });
                const today = (await call("get_week_plan")).structuredContent!
                    .today as string;
                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "dinner",
                    servings: 6,
                    member_ids: [ownerId],
                });
                expect(planned.isError).toBeFalsy();
                // Stored as the person's 2 portions, not the 6 asked for.
                expect(planned.structuredContent!.plan.servings).toBe(2);
                const [stored] = await getCtx().sql`
                    select servings::int as servings from public.recipe_plans
                `;
                expect(Number(stored!.servings)).toBe(2);
                const need = async () => {
                    const week = await call("get_week_plan");
                    return {
                        missing: Object.fromEntries(
                            week.structuredContent!.missing.map((m: any) => [
                                m.display_name,
                                m.amount,
                            ]),
                        ),
                        servings: week
                            .structuredContent!.days.flatMap(
                                (d: any) => d.plans,
                            )
                            .map((p: any) => p.servings),
                        text: week.content[0]!.text,
                    };
                };
                const before = await need();
                // 2 portions of a yield-2 recipe: all the pasta, none of the
                // peanuts the person leaves out.
                expect(before.missing).toEqual({ Pasta: 400 });
                expect(before.servings).toEqual([2]);
                expect(before.text).toContain("(2 portions)");

                // The person lowers their portions: the plan follows, the
                // stored 2 does not hold the excess at the base.
                await call("set_recipe_portion", {
                    recipe_id: recipeId,
                    member_id: ownerId,
                    portion_count: 1,
                });
                const after = await need();
                expect(after.missing).toEqual({ Pasta: 200 });
                expect(after.servings).toEqual([1]);
                expect(after.text).toContain("(1 portion)");
            });
        },
    );
});
