// recipe_plans against real Postgres, as foodable_app: the checks and cascades
// the migration promises and the household-wide row level security. The
// store's own behaviour is in the plans store contract (plans.contract.test.ts),
// which runs the memory twin too.
import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    PlanInputError,
    PlanRepeatOverlapError,
    createMemoryPlansStore,
    type NewPlanRule,
} from "../domain/plan.js";
import { setFallbackActorForTests, withActor } from "./actor.js";
import type { StoreContractCtx } from "./contract/helpers.js";
import type { PlansHarness } from "./contract/plans.contract.js";
import { loadWeekPlanInputs } from "./plan-week.js";
import { missingForPlan } from "../domain/plan-week.js";
import { addRecipeManualIngredient } from "../domain/recipes.js";
import { setRecipeVariant } from "../domain/recipe-variants.js";
import { liveFoodsStore } from "./foods.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "./recipes.js";
import { liveRecipePlansStore } from "./plans.js";
import { setSqlForTests } from "./sql.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

describeDb(pgAvailable !== null, "recipe plans db", (getCtx) => {
    let householdId: string;
    let ownerId: string;
    let memberId: string;
    let recipeId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        ownerId = seeded.userId;
        memberId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${memberId}, ${`member-${memberId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id, user_id, role, display_name
            )
            values (${householdId}, ${memberId}, ${"member"}, ${"Member"})
        `;
        recipeId = await recipeIn(householdId);
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    async function recipeIn(forHousehold: string): Promise<string> {
        const { sql } = getCtx();
        const id = crypto.randomUUID();
        await sql`
            insert into public.recipes (
                id, household_id, creator_id, name, yield_portions
            )
            values (${id}, ${forHousehold}, ${ownerId}, ${"Soup"}, ${2})
        `;
        return id;
    }

    async function planCount(where = "true"): Promise<number> {
        const { sql } = getCtx();
        const [row] = (await sql`
            select count(*)::int as n
            from public.recipe_plans
            where ${sql.unsafe(where)}
        `) as { n: number }[];
        return row!.n;
    }

    // Awaited by hand: expect().rejects on a lazy Bun.sql query never settles.
    async function refusal(query: PromiseLike<unknown>): Promise<string> {
        const err = await query.then(
            () => null,
            (e: unknown) => e,
        );
        return String(err);
    }

    test("the table refuses a slot or servings the store never sends", async () => {
        const { sql } = getCtx();
        expect(
            await refusal(sql`
                insert into public.recipe_plans (household_id, recipe_id, date, slot)
                values (${householdId}, ${recipeId}, ${"2026-11-12"}, ${"brunch"})
            `),
        ).toContain("recipe_plans_slot_check");
        for (const servings of [0, -1]) {
            expect(
                await refusal(sql`
                    insert into public.recipe_plans (
                        household_id, recipe_id, date, slot, servings
                    )
                    values (
                        ${householdId}, ${recipeId}, ${"2026-11-12"},
                        ${"dinner"}, ${servings}
                    )
                `),
            ).toContain("recipe_plans_servings_check");
        }
        expect(await planCount()).toBe(0);
    });

    test("a plan with no servings given plans one", async () => {
        const { sql } = getCtx();
        const [row] = (await sql`
            insert into public.recipe_plans (household_id, recipe_id, date, slot)
            values (${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"})
            returning servings::float8 as servings, created_by
        `) as { servings: number; created_by: string | null }[];
        expect(row).toEqual({ servings: 1, created_by: null });
    });

    test("deleting a recipe takes its plans, and only those", async () => {
        const store = liveRecipePlansStore();
        const other = await recipeIn(householdId);
        await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
        });
        const kept = await store.addPlan({
            householdId,
            recipeId: other,
            date: "2026-11-12",
            slot: "lunch",
        });
        const { sql } = getCtx();
        await sql`delete from public.recipes where id = ${recipeId}`;
        expect(await planCount()).toBe(1);
        expect(await store.getPlan(householdId, kept!.id)).not.toBeNull();
    });

    test("deleting the household takes its plans", async () => {
        const store = liveRecipePlansStore();
        await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
        });
        const { sql } = getCtx();
        await sql`delete from public.households where id = ${householdId}`;
        expect(await planCount()).toBe(0);
    });

    test("deleting the login that planned keeps the plan and forgets who", async () => {
        const store = liveRecipePlansStore();
        const plan = await asUser(
            memberId,
            () =>
                store.addPlan({
                    householdId,
                    recipeId,
                    date: "2026-11-12",
                    slot: "dinner",
                    createdBy: memberId,
                }),
            householdId,
        );
        expect(plan?.createdBy).toBe(memberId);
        const { sql } = getCtx();
        await sql`delete from public.users where id = ${memberId}`;
        expect(await store.getPlan(householdId, plan!.id)).toMatchObject({
            id: plan!.id,
            createdBy: null,
        });
    });

    test("the whole household shares one plan: members and the bot token alike", async () => {
        const store = liveRecipePlansStore();
        const plan = await asUser(
            memberId,
            () =>
                store.addPlan({
                    householdId,
                    recipeId,
                    date: "2026-11-12",
                    slot: "dinner",
                    createdBy: memberId,
                }),
            householdId,
        );
        expect(plan).not.toBeNull();

        // The owner, a different member, sees and changes the member's plan.
        const seenByOwner = await asUser(
            ownerId,
            () => store.listPlans(householdId, "2026-11-01", "2026-11-30"),
            householdId,
        );
        expect(seenByOwner.map((p) => p.id)).toEqual([plan!.id]);
        const moved = await asUser(
            ownerId,
            () => store.movePlan(householdId, plan!.id, "2026-11-13", "lunch"),
            householdId,
        );
        expect(moved?.plan).toMatchObject({
            date: "2026-11-13",
            slot: "lunch",
        });

        // The household token has no user of its own and reads and writes the same rows.
        const asToken = <T>(fn: () => Promise<T>) =>
            withActor({ kind: "household", householdId }, fn);
        expect(
            (
                await asToken(() =>
                    store.listPlans(householdId, "2026-11-01", "2026-11-30"),
                )
            ).map((p) => p.id),
        ).toEqual([plan!.id]);
        const byToken = await asToken(() =>
            store.addPlan({
                householdId,
                recipeId,
                date: "2026-11-14",
                slot: "snack",
            }),
        );
        expect(byToken).toMatchObject({ createdBy: null, slot: "snack" });
        expect(
            await asToken(() => store.removePlan(householdId, plan!.id)),
        ).toBe(true);
    });

    test("a draft is never planned: the one-off and repeat inserts skip it", async () => {
        const { sql } = getCtx();
        const store = liveRecipePlansStore();
        await sql`update public.recipes set verification = 'unverified' where id = ${recipeId}`;
        expect(
            await store.addPlan({
                householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
            }),
        ).toBeNull();
        expect(
            await store.addRule({
                householdId,
                recipeId,
                slot: "dinner",
                startsOn: "2026-11-12",
                repeat: "daily",
            }),
        ).toBeNull();
        expect(await planCount()).toBe(0);
        const [rules] =
            await sql`select count(*)::int as n from public.plan_rules`;
        expect(rules.n).toBe(0);
    });

    test("a request for another household reaches none of this one's plans", async () => {
        const { sql } = getCtx();
        const store = liveRecipePlansStore();
        const mine = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
        });
        const stranger = await seedHousehold(sql);
        const theirRecipe = await recipeIn(stranger.householdId);
        const theirs = await asUser(
            stranger.userId,
            () =>
                store.addPlan({
                    householdId: stranger.householdId,
                    recipeId: theirRecipe,
                    date: "2026-11-12",
                    slot: "dinner",
                }),
            stranger.householdId,
        );
        expect(theirs).not.toBeNull();

        await asUser(
            stranger.userId,
            async () => {
                // Naming this household's id from the other one finds nothing...
                expect(
                    await store.listPlans(
                        householdId,
                        "2026-01-01",
                        "2026-12-31",
                    ),
                ).toEqual([]);
                expect(await store.getPlan(householdId, mine!.id)).toBeNull();
                // ...and asking for their own household's plans by this id too.
                expect(
                    await store.getPlan(stranger.householdId, mine!.id),
                ).toBeNull();
                expect(
                    await store.removePlan(stranger.householdId, mine!.id),
                ).toBe(false);
                // Planning this household's recipe into theirs finds no such recipe.
                expect(
                    await store.addPlan({
                        householdId: stranger.householdId,
                        recipeId,
                        date: "2026-11-12",
                        slot: "dinner",
                    }),
                ).toBeNull();
            },
            stranger.householdId,
        );

        expect(await planCount()).toBe(2);
        expect(await planCount(`household_id = '${householdId}'`)).toBe(1);
    });

    test("planning a recipe that is deleted mid-flight plans nothing", async () => {
        const { sql, pg } = getCtx();
        const store = liveRecipePlansStore();
        // A second connection holds the delete open, so the insert's foreign
        // key check waits on it and fails once the delete commits.
        const other = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            await other.unsafe("begin").simple();
            await other
                .unsafe(`delete from public.recipes where id = '${recipeId}'`)
                .simple();
            const pending = store.addPlan({
                householdId,
                recipeId,
                date: "2026-11-12",
                slot: "dinner",
            });
            // Wait until the insert is blocked on the delete's row lock.
            let blocked = false;
            for (let i = 0; i < 100 && !blocked; i++) {
                const waiting = (await sql`
                    select count(*)::int as n
                    from pg_stat_activity
                    where wait_event_type = 'Lock'
                      and query ilike '%recipe_plans%'
                `) as { n: number }[];
                blocked = waiting[0]!.n > 0;
                if (!blocked) await sql`select pg_sleep(0.05)`;
            }
            expect(blocked).toBe(true);
            await other.unsafe("commit").simple();
            expect(await pending).toBeNull();
        } finally {
            await other.close();
        }
        expect(await planCount()).toBe(0);
    });

    test("the table refuses a second plan for the same recipe, day and slot", async () => {
        const { sql } = getCtx();
        await sql`
            insert into public.recipe_plans (household_id, recipe_id, date, slot)
            values (${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"})
        `;
        expect(
            await refusal(sql`
                insert into public.recipe_plans (household_id, recipe_id, date, slot)
                values (${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"})
            `),
        ).toContain("recipe_plans_household_recipe_date_slot_key");
        // A different slot or day is a different plan.
        await sql`
            insert into public.recipe_plans (household_id, recipe_id, date, slot)
            values (${householdId}, ${recipeId}, ${"2026-11-12"}, ${"lunch"}),
                   (${householdId}, ${recipeId}, ${"2026-11-13"}, ${"dinner"})
        `;
        expect(await planCount()).toBe(3);
    });

    test("two moves onto an occupied slot at once are both already planned, and nothing changes", async () => {
        const store = liveRecipePlansStore();
        const there = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-14",
            slot: "lunch",
            servings: 1,
        });
        const a = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
            servings: 2,
        });
        const b = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-13",
            slot: "dinner",
            servings: 3,
        });
        const [x, y] = await Promise.all([
            store.movePlan(householdId, a!.id, "2026-11-14", "lunch"),
            store.movePlan(householdId, b!.id, "2026-11-14", "lunch"),
        ]);
        expect(x).toEqual({ plan: there!, alreadyPlanned: true });
        expect(y).toEqual({ plan: there!, alreadyPlanned: true });
        expect(await planCount()).toBe(3);
        expect((await store.getPlan(householdId, there!.id))?.servings).toBe(1);
        expect((await store.getPlan(householdId, a!.id))?.date).toBe(
            "2026-11-12",
        );
    });

    test("two moves onto the same free slot at once: one lands, the other is already planned", async () => {
        const store = liveRecipePlansStore();
        const a = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
            servings: 2,
        });
        const b = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-13",
            slot: "dinner",
            servings: 3,
        });
        const moves = await Promise.all([
            store.movePlan(householdId, a!.id, "2026-11-14", "lunch"),
            store.movePlan(householdId, b!.id, "2026-11-14", "lunch"),
        ]);
        expect(moves.map((m) => m?.alreadyPlanned).sort()).toEqual([
            false,
            true,
        ]);
        expect(await planCount()).toBe(2);
        expect(await planCount("date = '2026-11-14' and slot = 'lunch'")).toBe(
            1,
        );
    });

    test("the collapse migration keeps the earliest duplicate with all the servings", async () => {
        const { sql } = getCtx();
        // Text imports, so the test runs the migration files as they are on disk.
        const text = async (name: string): Promise<string> =>
            (
                await import(`../../db/migrations/${name}`, {
                    with: { type: "text" },
                })
            ).default as string;
        const collapse = await text(
            "20261113100000_collapse_duplicate_recipe_plans.sql",
        );
        const unique = await text("20261113100100_recipe_plans_unique.sql");
        // Production still has the duplicates this migration exists for, so
        // take the index away to recreate them.
        await sql.unsafe(
            "drop index public.recipe_plans_household_recipe_date_slot_key",
        );
        const other = await recipeIn(householdId);
        const ids = Array.from({ length: 5 }, () => crypto.randomUUID());
        await sql`
            insert into public.recipe_plans
                (id, household_id, recipe_id, date, slot, servings, created_at)
            values
                (${ids[0]}, ${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"}, ${2}, ${"2026-11-01T10:00:00Z"}),
                (${ids[1]}, ${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"}, ${3}, ${"2026-11-01T09:00:00Z"}),
                (${ids[2]}, ${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"}, ${4}, ${"2026-11-01T11:00:00Z"}),
                (${ids[3]}, ${householdId}, ${recipeId}, ${"2026-11-12"}, ${"lunch"}, ${2}, ${"2026-11-01T09:00:00Z"}),
                (${ids[4]}, ${householdId}, ${other}, ${"2026-11-12"}, ${"dinner"}, ${1}, ${"2026-11-01T09:00:00Z"})
        `;
        await sql.unsafe(collapse);
        const left = (await sql`
            select id, servings::float8 as servings
            from public.recipe_plans order by id
        `) as { id: string; servings: number }[];
        const byId = new Map(left.map((r) => [r.id, r.servings]));
        expect(left).toHaveLength(3);
        // The earliest (ids[1]) stays and holds 3 + 2 + 4.
        expect(byId.get(ids[1]!)).toBe(9);
        expect(byId.get(ids[3]!)).toBe(2);
        expect(byId.get(ids[4]!)).toBe(1);
        // Running it again changes nothing, and the index then goes back on.
        await sql.unsafe(collapse);
        expect(await planCount()).toBe(3);
        await sql.unsafe(unique);
        expect(
            await refusal(sql`
                insert into public.recipe_plans (household_id, recipe_id, date, slot)
                values (${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"})
            `),
        ).toContain("recipe_plans_household_recipe_date_slot_key");
    });
    // ---------- repeats (plan_rules) ----------

    async function ruleCount(where = "true"): Promise<number> {
        const { sql } = getCtx();
        const [row] = (await sql`
            select count(*)::int as n
            from public.plan_rules
            where ${sql.unsafe(where)}
        `) as { n: number }[];
        return row!.n;
    }

    function rawRule(over: Record<string, unknown> = {}) {
        const { sql } = getCtx();
        const row = {
            meal: "dinner",
            servings: 1,
            rule: "daily",
            days: "{}",
            ...over,
        };
        return sql`
            insert into public.plan_rules (
                household_id, recipe_id, meal, servings, starts_on, rule, days
            )
            values (
                ${householdId}, ${recipeId}, ${row.meal as string},
                ${row.servings as number}, ${"2026-11-12"},
                ${row.rule as string}, ${row.days as string}::smallint[]
            )
        `;
    }

    test("the rules table refuses a meal, servings, repeat or weekdays the store never sends", async () => {
        expect(await refusal(rawRule({ meal: "brunch" }))).toContain(
            "plan_rules_meal_check",
        );
        for (const servings of [0, -1]) {
            expect(await refusal(rawRule({ servings }))).toContain(
                "plan_rules_servings_check",
            );
        }
        expect(await refusal(rawRule({ rule: "monthly" }))).toContain(
            "plan_rules_rule_check",
        );
        // Weekdays are 0 to 6, only a "days" repeat has any, and it needs one.
        expect(
            await refusal(rawRule({ rule: "days", days: "{1,7}" })),
        ).toContain("plan_rules_days_check");
        expect(await refusal(rawRule({ rule: "days", days: "{}" }))).toContain(
            "plan_rules_days_check",
        );
        expect(
            await refusal(rawRule({ rule: "weekly", days: "{1}" })),
        ).toContain("plan_rules_days_check");
        expect(await ruleCount()).toBe(0);
        await rawRule({ rule: "days", days: "{0,6}" });
        expect(await ruleCount()).toBe(1);
    });

    test("deleting a recipe or the household takes its repeats; deleting the login that made one keeps it", async () => {
        const store = liveRecipePlansStore();
        const other = await recipeIn(householdId);
        const rule = await asUser(
            memberId,
            () =>
                store.addRule({
                    householdId,
                    recipeId: other,
                    slot: "dinner",
                    startsOn: "2026-11-12",
                    repeat: "daily",
                    createdBy: memberId,
                }),
            householdId,
        );
        await store.addRule({
            householdId,
            recipeId,
            slot: "lunch",
            startsOn: "2026-11-12",
            repeat: "weekly",
        });
        const { sql } = getCtx();
        await sql`delete from public.users where id = ${memberId}`;
        expect(await store.getRule(householdId, rule!.id)).toMatchObject({
            id: rule!.id,
            createdBy: null,
        });
        await sql`delete from public.recipes where id = ${recipeId}`;
        expect(await ruleCount()).toBe(1);
        await sql`delete from public.households where id = ${householdId}`;
        expect(await ruleCount()).toBe(0);
    });

    test("another household reaches none of this one's repeats, even by its day ids", async () => {
        const { sql } = getCtx();
        const store = liveRecipePlansStore();
        const mine = await store.addRule({
            householdId,
            recipeId,
            slot: "dinner",
            startsOn: "2026-11-12",
            repeat: "daily",
        });
        const stranger = await seedHousehold(sql);
        const theirRecipe = await recipeIn(stranger.householdId);
        await asUser(
            stranger.userId,
            async () => {
                const day = `rule:${mine!.id}:2026-11-13`;
                for (const asHousehold of [householdId, stranger.householdId]) {
                    expect(
                        await store.getRule(asHousehold, mine!.id),
                    ).toBeNull();
                    expect(await store.getPlan(asHousehold, day)).toBeNull();
                    expect(await store.removePlan(asHousehold, day)).toBe(
                        false,
                    );
                    expect(
                        await store.movePlan(
                            asHousehold,
                            day,
                            "2026-11-14",
                            "lunch",
                        ),
                    ).toBeNull();
                    expect(
                        await store.endRuleBefore(
                            asHousehold,
                            mine!.id,
                            "2026-11-13",
                        ),
                    ).toBeNull();
                    expect(
                        await store.listPlans(
                            asHousehold,
                            "2026-11-12",
                            "2026-11-20",
                        ),
                    ).toEqual([]);
                }
                // This household's recipe cannot be planned into theirs.
                expect(
                    await store.addRule({
                        householdId: stranger.householdId,
                        recipeId,
                        slot: "dinner",
                        startsOn: "2026-11-12",
                        repeat: "daily",
                    }),
                ).toBeNull();
                expect(
                    await store.addRule({
                        householdId: stranger.householdId,
                        recipeId: theirRecipe,
                        slot: "dinner",
                        startsOn: "2026-11-12",
                        repeat: "daily",
                    }),
                ).not.toBeNull();
            },
            stranger.householdId,
        );
        expect(await ruleCount(`household_id = '${householdId}'`)).toBe(1);
        expect(await ruleCount()).toBe(2);
    });

    test("the whole household shares one repeat: members and the bot token alike", async () => {
        const store = liveRecipePlansStore();
        const rule = await asUser(
            memberId,
            () =>
                store.addRule({
                    householdId,
                    recipeId,
                    slot: "dinner",
                    startsOn: "2026-11-12",
                    repeat: "daily",
                    createdBy: memberId,
                }),
            householdId,
        );
        const day = `rule:${rule!.id}:2026-11-14`;
        expect(
            await asUser(
                ownerId,
                () => store.removePlan(householdId, day),
                householdId,
            ),
        ).toBe(true);
        const asToken = <T>(fn: () => Promise<T>) =>
            withActor({ kind: "household", householdId }, fn);
        expect(
            (
                await asToken(() =>
                    store.listPlans(householdId, "2026-11-12", "2026-11-16"),
                )
            ).map((p) => p.date),
        ).toEqual(["2026-11-12", "2026-11-13", "2026-11-15", "2026-11-16"]);
        expect(
            (
                await asToken(() =>
                    store.endRuleBefore(householdId, rule!.id, "2026-11-15"),
                )
            )?.endsOn,
        ).toBe("2026-11-14");
    });

    test("if the one-off cannot be written, the day is not skipped", async () => {
        const store = liveRecipePlansStore();
        const rule = await store.addRule({
            householdId,
            recipeId,
            slot: "dinner",
            servings: 2,
            startsOn: "2026-11-12",
            repeat: "daily",
        });
        const { sql } = getCtx();
        await sql.unsafe(`
            create function public.test_refuse_plan() returns trigger
            language plpgsql as $$ begin raise exception 'refused for the test'; end $$
        `);
        await sql.unsafe(`
            create trigger test_refuse_plan before insert on public.recipe_plans
            for each row execute function public.test_refuse_plan()
        `);
        try {
            await expect(
                store.movePlan(
                    householdId,
                    `rule:${rule!.id}:2026-11-13`,
                    "2026-11-14",
                    "lunch",
                ),
            ).rejects.toThrow();
        } finally {
            await sql.unsafe(
                "drop trigger test_refuse_plan on public.recipe_plans",
            );
            await sql.unsafe("drop function public.test_refuse_plan()");
        }
        expect((await store.getRule(householdId, rule!.id))?.skippedOn).toEqual(
            [],
        );
        expect(await planCount()).toBe(0);
    });

    test("moving a day writes the skip and the one-off together, and the skip is stored once", async () => {
        const store = liveRecipePlansStore();
        const rule = await store.addRule({
            householdId,
            recipeId,
            slot: "dinner",
            servings: 2,
            startsOn: "2026-11-12",
            repeat: "daily",
        });
        const moved = await store.movePlan(
            householdId,
            `rule:${rule!.id}:2026-11-13`,
            "2026-11-20",
            "snack",
        );
        expect(moved?.plan).toMatchObject({
            date: "2026-11-20",
            slot: "snack",
        });
        expect((await store.getRule(householdId, rule!.id))?.skippedOn).toEqual(
            ["2026-11-13"],
        );
        expect(await planCount()).toBe(1);
        // Skipping the same day again is a day that is gone, not a second entry.
        expect(
            await store.removePlan(householdId, `rule:${rule!.id}:2026-11-13`),
        ).toBe(false);
        expect((await store.getRule(householdId, rule!.id))?.skippedOn).toEqual(
            ["2026-11-13"],
        );
    });

    test("the week's inputs hold the days of a repeat, so the plan, the missing foods and the notices see them", async () => {
        const store = liveRecipePlansStore();
        await store.addRule({
            householdId,
            recipeId,
            slot: "dinner",
            servings: 2,
            startsOn: "2026-11-12",
            repeat: "weekdays",
        });
        const inputs = await asUser(
            ownerId,
            () => loadWeekPlanInputs(householdId, "2026-11-12"),
            householdId,
        );
        // Thu 12, Fri 13, Mon 16, Tue 17, Wed 18 in the seven days to Wed 18.
        expect(inputs.plans.map((p) => p.date)).toEqual([
            "2026-11-12",
            "2026-11-13",
            "2026-11-16",
            "2026-11-17",
            "2026-11-18",
        ]);
        expect(inputs.recipes.map((r) => r.id)).toEqual([recipeId]);
        expect(await planCount()).toBe(0);
    });

    test("a plan and a repeat keep the people they are for, and a moved day takes them along", async () => {
        const store = liveRecipePlansStore();
        const plan = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
            memberIds: [ownerId, memberId],
        });
        expect(plan?.memberIds).toEqual([ownerId, memberId]);
        expect((await store.getPlan(householdId, plan!.id))?.memberIds).toEqual(
            [ownerId, memberId],
        );
        const none = await store.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "lunch",
        });
        expect(none?.memberIds).toEqual([]);
        const rule = await store.addRule({
            householdId,
            recipeId,
            slot: "snack",
            startsOn: "2026-11-12",
            repeat: "daily",
            memberIds: [memberId],
        });
        expect(rule?.memberIds).toEqual([memberId]);
        const listed = await store.listPlans(
            householdId,
            "2026-11-13",
            "2026-11-13",
        );
        expect(listed.map((p) => p.memberIds)).toEqual([[memberId]]);
        const moved = await store.movePlan(
            householdId,
            `rule:${rule!.id}:2026-11-13`,
            "2026-11-20",
            "breakfast",
        );
        expect(moved?.plan.memberIds).toEqual([memberId]);
        expect(moved?.plan.id.startsWith("rule:")).toBe(false);
    });

    test("the table refuses members that are not ids", async () => {
        const { sql } = getCtx();
        await expect(
            sql`
                insert into public.recipe_plans (
                    household_id, recipe_id, date, slot, member_ids
                )
                values (
                    ${householdId}, ${recipeId}, ${"2026-11-12"}, ${"dinner"},
                    ${"{not-a-uuid}"}
                )
            `,
        ).rejects.toThrow();
        expect(await planCount()).toBe(0);
    });

    test("the week's missing foods total the named members' versions at their portions", async () => {
        const { sql } = getCtx();
        const recipes = liveRecipesStore();
        const foods = liveFoodsStore();
        const variants = liveRecipeVariantsStore();
        const pasta = await addRecipeManualIngredient(recipes, foods, {
            householdId,
            recipeId,
            name: "Pasta",
            amount: 400,
            unit: "g",
        });
        const cheese = await addRecipeManualIngredient(recipes, foods, {
            householdId,
            recipeId,
            name: "Cheese",
            amount: 200,
            unit: "g",
        });
        await sql`
            update public.recipes set yield_portions = 4 where id = ${recipeId}
        `;
        await recipes.upsertPortion({
            recipeId,
            householdId,
            userId: ownerId,
            portionCount: 1,
        });
        await recipes.upsertPortion({
            recipeId,
            householdId,
            userId: memberId,
            portionCount: 2,
        });
        await setRecipeVariant(recipes, foods, variants, {
            householdId,
            recipeId,
            userId: ownerId,
            action: "remove",
            ingredientId: cheese.id,
        });
        await setRecipeVariant(recipes, foods, variants, {
            householdId,
            recipeId,
            userId: memberId,
            action: "amount",
            ingredientId: pasta.id,
            amount: 800,
            unit: "g",
        });
        const plans = liveRecipePlansStore();
        await plans.addPlan({
            householdId,
            recipeId,
            date: "2026-11-12",
            slot: "dinner",
            servings: 3,
            memberIds: [ownerId, memberId],
        });
        // Planned for nobody in particular: the base.
        await plans.addPlan({
            householdId,
            recipeId,
            date: "2026-11-13",
            slot: "dinner",
            servings: 2,
        });
        const inputs = await asUser(
            ownerId,
            () => loadWeekPlanInputs(householdId, "2026-11-12"),
            householdId,
        );
        const lines = missingForPlan(inputs.plans, inputs.recipes, [], {
            from: "2026-11-12",
            days: 7,
        });
        const need = Object.fromEntries(
            lines.map((line) => [
                line.displayName,
                line.neededBy.map((n) => [n.date, n.need]),
            ]),
        );
        expect(need).toEqual({
            Pasta: [
                ["2026-11-12", { amount: 500, unit: "g" }],
                ["2026-11-13", { amount: 200, unit: "g" }],
            ],
            Cheese: [
                ["2026-11-12", { amount: 100, unit: "g" }],
                ["2026-11-13", { amount: 100, unit: "g" }],
            ],
        });
    });
});

/**
 * What a plans store does with repeats, run against the memory store and
 * Postgres alike.
 */
function runRepeatsContract(
    label: string,
    createHarness: () => PlansHarness,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} plan repeats`, () => {
        async function weeklyDinner(
            h: PlansHarness,
            c: StoreContractCtx,
            over: Partial<NewPlanRule> = {},
        ) {
            const recipeId = await h.newRecipe();
            const rule = await h.store.addRule({
                householdId: c.householdId,
                recipeId,
                slot: "dinner",
                servings: 3,
                startsOn: "2026-11-02", // a Monday
                repeat: "weekly",
                createdBy: c.userId,
                ...over,
            });
            expect(rule).not.toBeNull();
            return { recipeId, rule: rule! };
        }

        const listAll = (h: PlansHarness, c: StoreContractCtx) =>
            h.store.listPlans(c.householdId, "2026-11-01", "2026-11-30");

        test("a repeat keeps what it was given and lists its days with the one-off plans", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule } = await weeklyDinner(h, c);
            expect(rule).toMatchObject({
                householdId: c.householdId,
                recipeId,
                slot: "dinner",
                servings: 3,
                startsOn: "2026-11-02",
                repeat: "weekly",
                days: [],
                endsOn: null,
                skippedOn: [],
                createdBy: c.userId,
            });
            const other = await h.newRecipe();
            await h.store.addPlan({
                householdId: c.householdId,
                recipeId: other,
                date: "2026-11-10",
                slot: "lunch",
            });

            const week = await listAll(h, c);
            expect(week.map((p) => `${p.date} ${p.slot}`)).toEqual([
                "2026-11-02 dinner",
                "2026-11-09 dinner",
                "2026-11-10 lunch",
                "2026-11-16 dinner",
                "2026-11-23 dinner",
                "2026-11-30 dinner",
            ]);
            expect(week[0]).toMatchObject({
                id: `rule:${rule.id}:2026-11-02`,
                ruleId: rule.id,
                recipeId,
                servings: 3,
            });
            expect(week[2]!.ruleId).toBeUndefined();
            // A range that misses the repeat's days has none of them.
            expect(
                await h.store.listPlans(
                    c.householdId,
                    "2026-11-03",
                    "2026-11-08",
                ),
            ).toEqual([]);
            expect(await h.store.getRule(c.householdId, rule.id)).toEqual(rule);
        });

        test("pick days stores the weekdays and expands them", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c, {
                repeat: "days",
                days: [6, 0],
            });
            expect(rule.days).toEqual([0, 6]);
            expect(
                (
                    await h.store.listPlans(
                        c.householdId,
                        "2026-11-02",
                        "2026-11-15",
                    )
                ).map((p) => p.date),
            ).toEqual(["2026-11-07", "2026-11-08", "2026-11-14", "2026-11-15"]);
            await expect(
                weeklyDinner(h, c, { repeat: "days", days: [] }),
            ).rejects.toThrow();
            await expect(
                weeklyDinner(h, c, { repeat: "days", days: [7] }),
            ).rejects.toThrow();
            await expect(
                weeklyDinner(h, c, { repeat: "monthly" as never }),
            ).rejects.toThrow();
        });

        test("a recipe from another household is not planned on a repeat", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const foreign = await h.newRecipe(c.otherHouseholdId);
            expect(
                await h.store.addRule({
                    householdId: c.householdId,
                    recipeId: foreign,
                    slot: "dinner",
                    startsOn: "2026-11-02",
                    repeat: "daily",
                }),
            ).toBeNull();
            expect(await h.store.listRules(c.householdId)).toEqual([]);
        });

        test("removing one day skips it and leaves the rest of the series", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c);
            const day = `rule:${rule.id}:2026-11-09`;
            expect(await h.store.getPlan(c.householdId, day)).toMatchObject({
                id: day,
                date: "2026-11-09",
                ruleId: rule.id,
            });

            expect(await h.store.removePlan(c.householdId, day)).toBe(true);
            expect((await listAll(h, c)).map((p) => p.date)).toEqual([
                "2026-11-02",
                "2026-11-16",
                "2026-11-23",
                "2026-11-30",
            ]);
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual(["2026-11-09"]);
            // The day is gone: nothing to read, skip or move again, and a
            // date the repeat never covered is no day of it either.
            expect(await h.store.getPlan(c.householdId, day)).toBeNull();
            expect(await h.store.removePlan(c.householdId, day)).toBe(false);
            expect(
                await h.store.getPlan(
                    c.householdId,
                    `rule:${rule.id}:2026-11-10`,
                ),
            ).toBeNull();
        });

        test("ending the series keeps the days before the chosen one", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c);
            const ended = await h.store.endRuleBefore(
                c.householdId,
                rule.id,
                "2026-11-16",
            );
            expect(ended?.endsOn).toBe("2026-11-15");
            expect((await listAll(h, c)).map((p) => p.date)).toEqual([
                "2026-11-02",
                "2026-11-09",
            ]);
            // Ending again from a later day never brings days back.
            expect(
                (
                    await h.store.endRuleBefore(
                        c.householdId,
                        rule.id,
                        "2026-11-23",
                    )
                )?.endsOn,
            ).toBe("2026-11-15");
            expect(await h.store.listRules(c.householdId)).toEqual([]);
            expect(
                await h.store.endRuleBefore(
                    c.householdId,
                    crypto.randomUUID(),
                    "2026-11-16",
                ),
            ).toBeNull();
        });

        test("removing a repeat deletes it and the days it shows, and keeps one-offs and other repeats", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule } = await weeklyDinner(h, c);
            const { rule: kept } = await weeklyDinner(h, c);
            // a day moved off the repeat is a one-off now, and stays
            await h.store.movePlan(
                c.householdId,
                `rule:${rule.id}:2026-11-09`,
                "2026-11-10",
                "dinner",
            );
            const oneOff = await h.store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-12",
                slot: "lunch",
            });
            expect(await h.store.removeRule(c.householdId, rule.id)).toBe(true);
            expect(await h.store.getRule(c.householdId, rule.id)).toBeNull();
            expect(
                await h.store.getPlan(
                    c.householdId,
                    `rule:${rule.id}:2026-11-16`,
                ),
            ).toBeNull();
            expect(
                (await h.store.listRules(c.householdId)).map((r) => r.id),
            ).toEqual([kept.id]);
            const left = await listAll(h, c);
            expect(left.filter((p) => p.ruleId === rule.id)).toEqual([]);
            expect(left.filter((p) => p.ruleId === kept.id)).not.toEqual([]);
            expect(left.map((p) => p.id)).toEqual(
                expect.arrayContaining([oneOff!.id]),
            );
            expect(left.some((p) => p.date === "2026-11-10" && !p.ruleId)).toBe(
                true,
            );
            // gone is gone: a second removal, an unknown id and another household find nothing
            expect(await h.store.removeRule(c.householdId, rule.id)).toBe(
                false,
            );
            expect(
                await h.store.removeRule(c.householdId, crypto.randomUUID()),
            ).toBe(false);
            expect(await h.store.removeRule(c.otherHouseholdId, kept.id)).toBe(
                false,
            );
            expect(await h.store.getRule(c.householdId, kept.id)).toEqual(kept);
        });

        test("a repeat can start with days already taken off and a last day, and both are kept as given", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c, {
                // out of order and twice: stored once each, in order
                skippedOn: ["2026-11-16", "2026-11-09", "2026-11-16"],
                endsOn: "2026-11-30",
            });
            expect(rule.skippedOn).toEqual(["2026-11-09", "2026-11-16"]);
            expect(rule.endsOn).toBe("2026-11-30");
            expect(await h.store.getRule(c.householdId, rule.id)).toEqual(rule);
            expect((await listAll(h, c)).map((p) => p.date)).toEqual([
                "2026-11-02",
                "2026-11-23",
                "2026-11-30",
            ]);
            // a repeat made without them has none, and goes on
            const { rule: plain } = await weeklyDinner(h, c, {
                startsOn: "2026-12-07",
            });
            expect(plain.skippedOn).toEqual([]);
            expect(plain.endsOn).toBeNull();
            // a day that is not a day is refused and nothing is stored
            await expect(
                weeklyDinner(h, c, { skippedOn: ["2026-02-30"] }),
            ).rejects.toThrow(PlanInputError);
            await expect(
                weeklyDinner(h, c, { endsOn: "soon" }),
            ).rejects.toThrow(PlanInputError);
        });

        test("a repeat's last day counts when it is checked against the others: it may start after another ends, not before", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule } = await weeklyDinner(h, c);
            await h.store.endRuleBefore(c.householdId, rule.id, "2026-11-16");
            const next = (startsOn: string, endsOn?: string) =>
                h.store.addRule({
                    householdId: c.householdId,
                    recipeId,
                    slot: "dinner",
                    startsOn,
                    repeat: "weekly",
                    endsOn,
                });
            // the old one still holds Mon 9 Nov
            await expect(next("2026-11-09", "2026-11-15")).rejects.toThrow(
                PlanRepeatOverlapError,
            );
            // from the 16th on is free, with or without a last day
            expect(await next("2026-11-16", "2026-12-14")).not.toBeNull();
            expect((await listAll(h, c)).map((p) => p.date)).toEqual([
                "2026-11-02",
                "2026-11-09",
                "2026-11-16",
                "2026-11-23",
                "2026-11-30",
            ]);
        });

        test("moving one day skips it and makes a one-off on the new day", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule } = await weeklyDinner(h, c);
            const out = await h.store.movePlan(
                c.householdId,
                `rule:${rule.id}:2026-11-09`,
                "2026-11-11",
                "lunch",
            );
            expect(out?.alreadyPlanned).toBe(false);
            const moved = out!.plan;
            expect(moved).toMatchObject({
                recipeId,
                date: "2026-11-11",
                slot: "lunch",
                servings: 3,
                createdBy: c.userId,
            });
            expect(moved!.ruleId).toBeUndefined();
            expect(moved!.id).not.toContain("rule:");
            expect(
                (await listAll(h, c)).map((p) => `${p.date} ${p.slot}`),
            ).toEqual([
                "2026-11-02 dinner",
                "2026-11-11 lunch",
                "2026-11-16 dinner",
                "2026-11-23 dinner",
                "2026-11-30 dinner",
            ]);
            // The one-off is a plan of its own now.
            expect(await h.store.getPlan(c.householdId, moved!.id)).toEqual(
                moved,
            );

            // Another day of the series onto the day the recipe is already on,
            // with other servings: already planned, and nothing changes.
            const again = await h.store.movePlan(
                c.householdId,
                `rule:${rule.id}:2026-11-16`,
                "2026-11-11",
                "lunch",
                2,
            );
            expect(again).toEqual({ plan: moved, alreadyPlanned: true });
            expect(
                (await listAll(h, c)).filter((p) => p.date === "2026-11-11"),
            ).toEqual([moved]);
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual(["2026-11-09"]);
        });

        test("a day moved onto another day of the series is already planned, and both days stay as they are", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c, { repeat: "daily" });
            const target = await h.store.getPlan(
                c.householdId,
                `rule:${rule.id}:2026-11-10`,
            );
            const out = await h.store.movePlan(
                c.householdId,
                `rule:${rule.id}:2026-11-09`,
                "2026-11-10",
                "dinner",
                8,
            );
            expect(out).toEqual({ plan: target!, alreadyPlanned: true });
            const week = await h.store.listPlans(
                c.householdId,
                "2026-11-09",
                "2026-11-11",
            );
            expect(week.map((p) => `${p.date} ${p.servings}`)).toEqual([
                "2026-11-09 3",
                "2026-11-10 3",
                "2026-11-11 3",
            ]);
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual([]);
        });

        test("a one-off planned on a repeat's day is already planned: that day's entry comes back and nothing is written", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule } = await weeklyDinner(h, c, {
                repeat: "daily",
            });
            const there = await h.store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-04",
                slot: "dinner",
                servings: 8,
            });
            expect(there).toMatchObject({
                id: `rule:${rule.id}:2026-11-04`,
                servings: 3,
            });
            const week = await h.store.listPlans(
                c.householdId,
                "2026-11-03",
                "2026-11-05",
            );
            expect(week.map((p) => `${p.date} ${p.servings}`)).toEqual([
                "2026-11-03 3",
                "2026-11-04 3",
                "2026-11-05 3",
            ]);
            expect(week.every((p) => p.ruleId === rule.id)).toBe(true);
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual([]);
            expect(await listAll(h, c)).toHaveLength(29);
            // Another meal on that day is free.
            const lunch = await h.store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-04",
                slot: "lunch",
                servings: 8,
            });
            expect(lunch).toMatchObject({ slot: "lunch", servings: 8 });
            expect(lunch!.ruleId).toBeUndefined();
        });

        test("removing the one-off a day was moved to leaves the day it came from skipped", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c, {
                repeat: "daily",
                servings: 2,
            });
            const out = await h.store.movePlan(
                c.householdId,
                `rule:${rule.id}:2026-11-09`,
                "2026-11-10",
                "lunch",
            );
            expect(out?.plan).toMatchObject({ servings: 2, slot: "lunch" });
            expect(out!.plan.id).not.toContain("rule:");
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual(["2026-11-09"]);
            expect(await h.store.removePlan(c.householdId, out!.plan.id)).toBe(
                true,
            );
            expect(
                (
                    await h.store.listPlans(
                        c.householdId,
                        "2026-11-09",
                        "2026-11-10",
                    )
                ).map((p) => `${p.date} ${p.slot}`),
            ).toEqual(["2026-11-10 dinner"]);
        });

        test("a one-off moved onto a repeat's day is already planned and the repeat keeps the day, and onto another meal it moves", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule } = await weeklyDinner(h, c, {
                servings: 2,
            });
            const one = await h.store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-07", // a Saturday
                slot: "dinner",
                servings: 3,
            });
            const lunch = await h.store.movePlan(
                c.householdId,
                one!.id,
                "2026-11-09",
                "lunch",
            );
            expect(lunch).toEqual({
                plan: { ...one!, date: "2026-11-09", slot: "lunch" },
                alreadyPlanned: false,
            });
            // Back to the Saturday, then onto the Monday's dinner of the repeat.
            await h.store.movePlan(
                c.householdId,
                one!.id,
                "2026-11-07",
                "dinner",
            );
            const refused = await h.store.movePlan(
                c.householdId,
                one!.id,
                "2026-11-09",
                "dinner",
                9,
            );
            expect(refused?.alreadyPlanned).toBe(true);
            expect(refused?.plan).toMatchObject({
                id: `rule:${rule.id}:2026-11-09`,
                servings: 2,
            });
            expect(await h.store.getPlan(c.householdId, one!.id)).toEqual({
                ...one!,
            });
            const monday = await h.store.listPlans(
                c.householdId,
                "2026-11-09",
                "2026-11-09",
            );
            expect(monday.map((p) => `${p.slot} ${p.servings}`)).toEqual([
                "dinner 2",
            ]);
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual([]);
        });

        test("a repeat over days another repeat of the recipe and meal holds is refused", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule: daily } = await weeklyDinner(h, c, {
                repeat: "daily",
                servings: 2,
            });
            const again = (
                repeat: "weekly" | "weekdays" | "days",
                startsOn: string,
                days?: number[],
                slot: "dinner" | "lunch" = "dinner",
            ) =>
                h.store.addRule({
                    householdId: c.householdId,
                    recipeId,
                    slot,
                    servings: 3,
                    startsOn,
                    repeat,
                    days,
                    createdBy: c.userId,
                });
            // Any weekly, weekdays or picked day the daily one shows.
            await expect(again("weekly", "2026-11-02")).rejects.toBeInstanceOf(
                PlanRepeatOverlapError,
            );
            await expect(again("weekdays", "2026-11-20")).rejects.toThrow(
                "That recipe is already planned at dinner on Mon, Tue, Wed, Thu and Fri by the repeat every day. End that series first, or pick other days.",
            );
            await expect(again("days", "2026-11-02", [0, 6])).rejects.toThrow(
                PlanInputError,
            );
            // Another meal, another recipe and another household are free.
            expect(
                await again("weekly", "2026-11-02", undefined, "lunch"),
            ).not.toBeNull();
            expect(
                await h.store.addRule({
                    householdId: c.householdId,
                    recipeId: await h.newRecipe(),
                    slot: "dinner",
                    startsOn: "2026-11-02",
                    repeat: "daily",
                }),
            ).not.toBeNull();
            // Nothing was written for the refused ones.
            expect(
                (await h.store.listRules(c.householdId)).map((r) => r.id),
            ).toHaveLength(3);

            // Once the daily one ends, a repeat from the next day is fine, and
            // one that reaches back into the days it still covers is not.
            await h.store.endRuleBefore(c.householdId, daily.id, "2026-11-16");
            await expect(again("weekly", "2026-11-09")).rejects.toThrow(
                PlanInputError,
            );
            // The series is over: the error says so and names its last day.
            await expect(again("weekly", "2026-11-09")).rejects.toMatchObject({
                endedOn: "2026-11-15",
            });
            const later = await again("weekly", "2026-11-16");
            expect(later).not.toBeNull();
            // A repeat still running keeps asking to be ended.
            await expect(
                h.store.addRule({
                    householdId: c.householdId,
                    recipeId,
                    slot: "dinner",
                    startsOn: "2026-11-20",
                    repeat: "daily",
                }),
            ).rejects.toMatchObject({ endedOn: null });
            // Each day names exactly the repeat it shows, and ending that
            // series on it ends that repeat and no other.
            const [monday] = (
                await h.store.listPlans(
                    c.householdId,
                    "2026-11-23",
                    "2026-11-23",
                )
            ).filter((p) => p.recipeId === recipeId && p.slot === "dinner");
            expect(monday).toMatchObject({
                id: `rule:${later!.id}:2026-11-23`,
                servings: 3,
            });
            await h.store.endRuleBefore(c.householdId, later!.id, monday!.date);
            expect(
                (
                    await h.store.listPlans(
                        c.householdId,
                        "2026-11-23",
                        "2026-11-30",
                    )
                ).filter((p) => p.recipeId === recipeId && p.slot === "dinner"),
            ).toEqual([]);
        });

        test("repeats of one recipe and meal on different weekdays live side by side", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { recipeId, rule: weekly } = await weeklyDinner(h, c);
            // The weekly rule is on Mondays (2026-11-02).
            const other = (repeat: "weekdays" | "days", days?: number[]) =>
                h.store.addRule({
                    householdId: c.householdId,
                    recipeId,
                    slot: "dinner",
                    startsOn: "2026-11-02",
                    repeat,
                    days,
                });
            expect(await other("days", [0, 6])).not.toBeNull();
            expect(await other("days", [2, 3])).not.toBeNull();
            await expect(other("weekdays")).rejects.toThrow(PlanInputError);
            expect(weekly.repeat).toBe("weekly");
        });

        test("saving a repeat's day with nothing changed writes nothing and keeps it on the series", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c, {
                repeat: "daily",
                servings: 2,
            });
            const day = (await listAll(h, c))[2]!;
            const saved = await h.store.movePlan(
                c.householdId,
                day.id,
                day.date,
                day.slot,
                day.servings,
            );
            expect(saved).toEqual({ plan: day, alreadyPlanned: false });
            expect(saved!.plan.ruleId).toBe(rule.id);
            // Without servings, and through the servings write, the same.
            expect(
                await h.store.movePlan(
                    c.householdId,
                    day.id,
                    day.date,
                    day.slot,
                ),
            ).toEqual({ plan: day, alreadyPlanned: false });
            expect(
                await h.store.updatePlanServings(
                    c.householdId,
                    day.id,
                    day.servings,
                ),
            ).toEqual(day);
            expect(
                (await h.store.getRule(c.householdId, rule.id))?.skippedOn,
            ).toEqual([]);
            expect(await listAll(h, c)).toHaveLength(
                (await listAll(h, c)).length,
            );
            expect((await listAll(h, c)).every((p) => p.ruleId)).toBe(true);
            // Other servings make it a plan of its own.
            const other = await h.store.movePlan(
                c.householdId,
                day.id,
                day.date,
                day.slot,
                day.servings + 1,
            );
            expect(other!.plan.ruleId).toBeUndefined();
        });

        test("a repeat's day id names its plan in any letter case", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c);
            const upper = `rule:${rule.id.toUpperCase()}:2026-11-09`;
            expect((await h.store.getPlan(c.householdId, upper))?.id).toBe(
                `rule:${rule.id}:2026-11-09`,
            );
        });

        test("one day of a repeat can take other servings without touching the rest", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c, { repeat: "daily" });
            const changed = await h.store.updatePlanServings(
                c.householdId,
                `rule:${rule.id}:2026-11-04`,
                5,
            );
            expect(changed).toMatchObject({
                date: "2026-11-04",
                servings: 5,
            });
            const week = await h.store.listPlans(
                c.householdId,
                "2026-11-03",
                "2026-11-05",
            );
            expect(week.map((p) => p.servings)).toEqual([3, 5, 3]);
        });

        test("another household sees and changes none of a repeat", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c);
            const day = `rule:${rule.id}:2026-11-09`;
            expect(
                await h.store.listPlans(
                    c.otherHouseholdId,
                    "2026-11-01",
                    "2026-11-30",
                ),
            ).toEqual([]);
            expect(await h.store.getPlan(c.otherHouseholdId, day)).toBeNull();
            expect(
                await h.store.getRule(c.otherHouseholdId, rule.id),
            ).toBeNull();
            expect(await h.store.listRules(c.otherHouseholdId)).toEqual([]);
            expect(await h.store.removePlan(c.otherHouseholdId, day)).toBe(
                false,
            );
            expect(
                await h.store.movePlan(
                    c.otherHouseholdId,
                    day,
                    "2026-11-11",
                    "lunch",
                ),
            ).toBeNull();
            expect(
                await h.store.endRuleBefore(
                    c.otherHouseholdId,
                    rule.id,
                    "2026-11-09",
                ),
            ).toBeNull();
            expect((await listAll(h, c)).map((p) => p.date)).toHaveLength(5);
        });

        test("a repeat started over a one-off skips that day and leaves its servings alone", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const recipeId = await h.newRecipe();
            const other = await h.newRecipe();
            const oneOff = (
                recipe: string,
                date: string,
                slot: "dinner" | "lunch",
                servings: number,
            ) =>
                h.store.addPlan({
                    householdId: c.householdId,
                    recipeId: recipe,
                    date,
                    slot,
                    servings,
                    createdBy: c.userId,
                });
            const monday = await oneOff(recipeId, "2026-11-02", "dinner", 3);
            // Other recipe, other meal and a day before the start stay as they are.
            await oneOff(other, "2026-11-02", "dinner", 1);
            await oneOff(recipeId, "2026-11-02", "lunch", 1);
            await oneOff(recipeId, "2026-11-01", "dinner", 1);

            const rule = await h.store.addRule({
                householdId: c.householdId,
                recipeId,
                slot: "dinner",
                servings: 2,
                startsOn: "2026-11-02",
                repeat: "daily",
                createdBy: c.userId,
            });
            expect(rule!.skippedOn).toEqual(["2026-11-02"]);
            expect(
                (await h.store.getRule(c.householdId, rule!.id))?.skippedOn,
            ).toEqual(["2026-11-02"]);

            const day = (date: string) =>
                h.store.listPlans(c.householdId, date, date);
            // The one-off holds the day with its own servings: the repeat's
            // are not added, so ending the series leaves none behind.
            const shown = (await day("2026-11-02")).filter(
                (p) => p.recipeId === recipeId && p.slot === "dinner",
            );
            expect(shown.map((p) => `${p.id} ${p.servings}`)).toEqual([
                `${monday!.id} 3`,
            ]);
            // The other recipe, meal and the earlier day are untouched.
            expect((await day("2026-11-02")).map((p) => p.servings)).toEqual(
                expect.arrayContaining([1]),
            );
            expect((await day("2026-11-01")).map((p) => p.servings)).toEqual([
                1,
            ]);
            // The next day is the repeat's own.
            expect(
                (await day("2026-11-03")).map(
                    (p) => `${p.ruleId} ${p.servings}`,
                ),
            ).toEqual([`${rule!.id} 2`]);

            // Removing the day leaves it empty rather than bringing the repeat back.
            expect(await h.store.removePlan(c.householdId, monday!.id)).toBe(
                true,
            );
            expect(
                (await day("2026-11-02")).filter(
                    (p) => p.recipeId === recipeId && p.slot === "dinner",
                ),
            ).toEqual([]);
            expect((await day("2026-11-03")).map((p) => p.servings)).toEqual([
                2,
            ]);
        });

        test("a repeat started over a one-off on a day it does not cover leaves that day alone", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const recipeId = await h.newRecipe();
            const tuesday = await h.store.addPlan({
                householdId: c.householdId,
                recipeId,
                date: "2026-11-10",
                slot: "dinner",
                servings: 3,
                createdBy: c.userId,
            });
            const rule = await h.store.addRule({
                householdId: c.householdId,
                recipeId,
                slot: "dinner",
                servings: 2,
                startsOn: "2026-11-02",
                repeat: "weekly",
                createdBy: c.userId,
            });
            expect(rule!.skippedOn).toEqual([]);
            expect(
                await h.store.getPlan(c.householdId, tuesday!.id),
            ).toMatchObject({ servings: 3 });
        });

        test("a malformed or unknown day id names nothing", async () => {
            await reset();
            const c = ctx();
            const h = createHarness();
            const { rule } = await weeklyDinner(h, c);
            for (const id of [
                "rule:not-a-uuid:2026-11-09",
                `rule:${rule.id}:2026-13-09`,
                `rule:${rule.id}`,
                `rule:${crypto.randomUUID()}:2026-11-09`,
            ]) {
                expect(await h.store.getPlan(c.householdId, id)).toBeNull();
                expect(await h.store.removePlan(c.householdId, id)).toBe(false);
                expect(
                    await h.store.movePlan(
                        c.householdId,
                        id,
                        "2026-11-11",
                        "lunch",
                    ),
                ).toBeNull();
            }
        });
    });
}

describe("recipe plans store (memory)", () => {
    let ctx: StoreContractCtx;
    let known: Set<string>;

    beforeEach(() => {
        known = new Set();
        ctx = {
            householdId: crypto.randomUUID(),
            userId: crypto.randomUUID(),
            otherHouseholdId: crypto.randomUUID(),
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
        };
    });

    runRepeatsContract(
        "memory",
        () => ({
            store: createMemoryPlansStore({
                recipeInHousehold: (householdId, recipeId) =>
                    known.has(`${householdId}|${recipeId}`),
            }),
            newRecipe: async (householdId = ctx.householdId) => {
                const id = crypto.randomUUID();
                known.add(`${householdId}|${id}`);
                return id;
            },
        }),
        async () => {},
        () => ctx,
    );
});

describeDb(pgAvailable !== null, "recipe plans store (live)", (getCtx) => {
    let ctx: StoreContractCtx;

    afterEach(() => {
        setSqlForTests(null);
        setFallbackActorForTests(null);
    });

    async function reseed(): Promise<void> {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const primary = await seedHousehold(sql);
        const other = await seedHousehold(sql);
        // Two households exist; pin the actor so it is not a coin flip.
        setFallbackActorForTests({
            kind: "user",
            userId: primary.userId,
            householdId: primary.householdId,
        });
        ctx = {
            householdId: primary.householdId,
            userId: primary.userId,
            otherHouseholdId: other.householdId,
            storeId: crypto.randomUUID(),
            sectionId: crypto.randomUUID(),
            foodId: crypto.randomUUID(),
            locationId: crypto.randomUUID(),
            sql,
        };
    }

    beforeEach(reseed);

    runRepeatsContract(
        "live",
        () => ({
            store: liveRecipePlansStore(),
            newRecipe: async (householdId = ctx.householdId) => {
                const id = crypto.randomUUID();
                await getCtx().sql`
                    insert into public.recipes (
                        id, household_id, creator_id, name, yield_portions
                    )
                    values (${id}, ${householdId}, ${ctx.userId}, ${"Soup"}, ${2})
                `;
                return id;
            },
        }),
        reseed,
        () => ctx,
    );
});
