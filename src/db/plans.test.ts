// recipe_plans against real Postgres, as foodable_app: the checks and cascades
// the migration promises and the household-wide row level security. The
// store's own behaviour is in the plans store contract (plans.contract.test.ts),
// which runs the memory twin too.
import { SQL } from "bun";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { withActor } from "./actor.js";
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
        expect(moved).toMatchObject({ date: "2026-11-13", slot: "lunch" });

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

    test("two moves onto the same slot at once leave one plan with both servings", async () => {
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
        expect(x?.id).toBe(there!.id);
        expect(y?.id).toBe(there!.id);
        expect(await planCount()).toBe(1);
        expect((await store.getPlan(householdId, there!.id))?.servings).toBe(6);
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
});
