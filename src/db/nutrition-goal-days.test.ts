import { afterEach, beforeEach, expect, test } from "bun:test";
import {
    clearGoalDays,
    getGoalsForDate,
    getGoalsForRange,
    pgGoalDayStore,
    upsertGoalDays,
    upsertNutritionGoals,
} from "./nutrition.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { pgCode, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "nutrition_goal_days (live)", (getCtx) => {
    test("partial daily_* columns read back null", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        const { householdId, userId } = await seedHousehold(sql);
        const date = "2026-11-08";
        await sql`
            insert into public.nutrition_goal_days (
                household_id,
                user_id,
                date,
                daily_calories,
                daily_protein_g
            )
            values (${householdId}, ${userId}, ${date}, ${2000}, ${150})
        `;
        const [row] = (await sql`
            select
                daily_calories,
                daily_protein_g,
                daily_carbs_g,
                daily_fat_g,
                daily_water_ml,
                daily_fiber_g,
                daily_sugar_g,
                daily_alcohol_g,
                daily_caffeine_mg
            from public.nutrition_goal_days
            where
                household_id = ${householdId}
                and user_id = ${userId}
                and date = ${date}
        `) as {
            daily_calories: number;
            daily_protein_g: string;
            daily_carbs_g: null;
            daily_fat_g: null;
            daily_water_ml: null;
            daily_fiber_g: null;
            daily_sugar_g: null;
            daily_alcohol_g: null;
            daily_caffeine_mg: null;
        }[];
        expect(row!.daily_calories).toBe(2000);
        expect(Number(row!.daily_protein_g)).toBe(150);
        expect(row!.daily_carbs_g).toBeNull();
        expect(row!.daily_fat_g).toBeNull();
        expect(row!.daily_water_ml).toBeNull();
        expect(row!.daily_fiber_g).toBeNull();
        expect(row!.daily_sugar_g).toBeNull();
        expect(row!.daily_alcohol_g).toBeNull();
        expect(row!.daily_caffeine_mg).toBeNull();
    });

    test("unique (household_id, user_id, date); other dates allowed", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        const { householdId, userId } = await seedHousehold(sql);
        const date = "2026-06-01";
        await sql`
            insert into public.nutrition_goal_days (household_id, user_id, date)
            values (${householdId}, ${userId}, ${date})
        `;
        const dup = await sql`
            insert into public.nutrition_goal_days (household_id, user_id, date)
            values (${householdId}, ${userId}, ${date})
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(dup)).toBe("23505");

        await sql`
            insert into public.nutrition_goal_days (household_id, user_id, date)
            values (${householdId}, ${userId}, ${"2026-06-02"})
        `;
        const rows = (await sql`
            select date::text as date
            from public.nutrition_goal_days
            where household_id = ${householdId} and user_id = ${userId}
            order by date
        `) as { date: string }[];
        expect(rows.map((r) => r.date)).toEqual(["2026-06-01", "2026-06-02"]);
    });

    test("negative daily_calories rejected by check", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        const { householdId, userId } = await seedHousehold(sql);
        const err = await sql`
            insert into public.nutrition_goal_days (
                household_id,
                user_id,
                date,
                daily_calories
            )
            values (${householdId}, ${userId}, ${"2026-07-01"}, ${-1})
        `.then(
            () => null,
            (e: unknown) => e,
        );
        expect(pgCode(err)).toBe("23514");
    });

    test("deleting household cascades goal-day rows", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        const { householdId, userId } = await seedHousehold(sql);
        await sql`
            insert into public.nutrition_goal_days (household_id, user_id, date)
            values (${householdId}, ${userId}, ${"2026-08-01"})
        `;
        await sql`delete from public.households where id = ${householdId}`;
        const left = (await sql`
            select count(*)::int as n from public.nutrition_goal_days
        `) as { n: number }[];
        expect(left[0]!.n).toBe(0);
    });

    test("RLS enabled and service_role has table privileges", async () => {
        const { sql } = getCtx();
        const [rls] = (await sql`
            select c.relrowsecurity
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = 'nutrition_goal_days'
        `) as { relrowsecurity: boolean }[];
        expect(rls!.relrowsecurity).toBe(true);

        const [priv] = (await sql`
            select
                has_table_privilege(
                    'service_role',
                    'public.nutrition_goal_days',
                    'SELECT'
                ) as sel,
                has_table_privilege(
                    'service_role',
                    'public.nutrition_goal_days',
                    'INSERT'
                ) as ins,
                has_table_privilege(
                    'service_role',
                    'public.nutrition_goal_days',
                    'UPDATE'
                ) as upd,
                has_table_privilege(
                    'service_role',
                    'public.nutrition_goal_days',
                    'DELETE'
                ) as del
        `) as { sel: boolean; ins: boolean; upd: boolean; del: boolean }[];
        expect(priv!.sel).toBe(true);
        expect(priv!.ins).toBe(true);
        expect(priv!.upd).toBe(true);
        expect(priv!.del).toBe(true);
    });

    let storeUserId: string;
    let storeHouseholdId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId: storeUserId, householdId: storeHouseholdId } =
            await seedHousehold(sql));
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("overrideForDate returns typed row", async () => {
        const date = "2026-09-10";
        const { sql } = getCtx();
        await sql`
                insert into public.nutrition_goal_days (
                    household_id,
                    user_id,
                    date,
                    daily_calories,
                    daily_protein_g
                )
                values (${storeHouseholdId}, ${storeUserId}, ${date}, ${2200}, ${160})
            `;
        const row = await pgGoalDayStore.overrideForDate(storeUserId, date);
        expect(row!.date).toBe(date);
        expect(row!.daily_calories).toBe(2200);
        expect(typeof row!.daily_protein_g).toBe("number");
        expect(
            await pgGoalDayStore.overrideForDate(storeUserId, "2026-09-11"),
        ).toBeNull();
    });

    test("overridesInRange is inclusive, ordered, user-scoped", async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        const seeded = await seedHousehold(sql);
        const other = crypto.randomUUID();
        await sql`
                insert into public.users (id, email)
                values (${other}, ${`x-${other}@t.test`})
            `;
        for (const [d, cals] of [
            ["2026-10-01", 2000],
            ["2026-10-05", 2100],
            ["2026-10-07", 2200],
        ] as const) {
            await sql`
                    insert into public.nutrition_goal_days (
                        household_id,
                        user_id,
                        date,
                        daily_calories
                    )
                    values (${seeded.householdId}, ${seeded.userId}, ${d}, ${cals})
                `;
        }
        await sql`
                insert into public.nutrition_goal_days (
                    household_id,
                    user_id,
                    date,
                    daily_calories
                )
                values (${seeded.householdId}, ${other}, ${"2026-10-05"}, ${9999})
            `;
        const range = await pgGoalDayStore.overridesInRange(
            seeded.userId,
            "2026-10-05",
            "2026-10-07",
        );
        expect(range.map((r) => r.date)).toEqual(["2026-10-05", "2026-10-07"]);
        expect(range[0]!.daily_calories).toBe(2100);
    });

    test("getGoalsForDate merges override with defaults", async () => {
        await upsertNutritionGoals(storeUserId, {
            daily_calories: 2000,
            daily_protein_g: 150,
        });
        const { sql } = getCtx();
        const date = "2026-11-15";
        await sql`
            insert into public.nutrition_goal_days (
                household_id,
                user_id,
                date,
                daily_calories
            )
            values (${storeHouseholdId}, ${storeUserId}, ${date}, ${2400})
        `;
        const merged = await getGoalsForDate(storeUserId, date);
        expect(merged!.daily_calories).toBe(2400);
        expect(merged!.daily_protein_g).toBe(150);
    });

    test("getGoalsForDate ignores impossible calendar dates", async () => {
        await upsertNutritionGoals(storeUserId, {
            daily_calories: 2000,
            daily_protein_g: 150,
        });
        const merged = await getGoalsForDate(storeUserId, "2026-02-31");
        expect(merged!.daily_calories).toBe(2000);
        expect(merged!.daily_protein_g).toBe(150);
    });

    test("getGoalsForRange ignores impossible calendar bounds", async () => {
        await upsertNutritionGoals(storeUserId, { daily_calories: 2000 });
        const { forDate } = await getGoalsForRange(
            storeUserId,
            "2026-02-31",
            "2026-03-01",
        );
        expect(forDate("2026-03-01")!.daily_calories).toBe(2000);
        await expect(
            getGoalsForRange(storeUserId, "2026-03-01", "2026-13-01"),
        ).resolves.toMatchObject({
            forDate: expect.any(Function),
        });
    });

    test("getGoalsForRange exposes forDate", async () => {
        await upsertNutritionGoals(storeUserId, { daily_calories: 2000 });
        const { sql } = getCtx();
        await sql`
            insert into public.nutrition_goal_days (
                household_id,
                user_id,
                date,
                daily_calories
            )
            values (
                ${storeHouseholdId},
                ${storeUserId},
                ${"2026-12-01"},
                ${2500}
            )
        `;
        const { forDate } = await getGoalsForRange(
            storeUserId,
            "2026-12-01",
            "2026-12-02",
        );
        expect(forDate("2026-12-01")!.daily_calories).toBe(2500);
        expect(forDate("2026-12-02")!.daily_calories).toBe(2000);
    });

    test("upsertGoalDays sets three days; clearGoalDays removes one", async () => {
        await upsertNutritionGoals(storeUserId, {
            daily_calories: 2000,
            daily_protein_g: 150,
        });
        const days = ["2026-11-20", "2026-11-21", "2026-11-22"] as const;
        const written = await upsertGoalDays(
            storeUserId,
            storeHouseholdId,
            [...days],
            {
                daily_calories: 2400,
            },
        );
        expect(written.map((r) => r.date).sort()).toEqual([...days].sort());
        expect(written.every((r) => r.daily_calories === 2400)).toBe(true);

        const removed = await clearGoalDays(storeUserId, storeHouseholdId, [
            "2026-11-21",
        ]);
        expect(removed).toBe(1);

        const { sql } = getCtx();
        const left = (await sql`
            select date::text as date
            from public.nutrition_goal_days
            where household_id = ${storeHouseholdId} and user_id = ${storeUserId}
            order by date
        `) as { date: string }[];
        expect(left.map((r) => r.date)).toEqual(["2026-11-20", "2026-11-22"]);

        expect(
            (await getGoalsForDate(storeUserId, "2026-11-20"))!.daily_calories,
        ).toBe(2400);
        expect(
            (await getGoalsForDate(storeUserId, "2026-11-21"))!.daily_calories,
        ).toBe(2000);
        expect(
            (await getGoalsForDate(storeUserId, "2026-11-22"))!.daily_calories,
        ).toBe(2400);
    });

    test("upsertGoalDays null clears one field; undefined preserves on update", async () => {
        await upsertNutritionGoals(storeUserId, {
            daily_calories: 2000,
            daily_protein_g: 150,
        });
        const date = "2026-11-25";
        await upsertGoalDays(storeUserId, storeHouseholdId, [date], {
            daily_calories: 2200,
            daily_protein_g: 160,
        });
        await upsertGoalDays(storeUserId, storeHouseholdId, [date], {
            daily_protein_g: null,
        });
        let row = await pgGoalDayStore.overrideForDate(storeUserId, date);
        expect(row!.daily_calories).toBe(2200);
        expect(row!.daily_protein_g).toBeNull();
        expect(
            (await getGoalsForDate(storeUserId, date))!.daily_protein_g,
        ).toBe(150);

        await upsertGoalDays(storeUserId, storeHouseholdId, [date], {
            daily_calories: 2300,
        });
        row = await pgGoalDayStore.overrideForDate(storeUserId, date);
        expect(row!.daily_calories).toBe(2300);
        expect(row!.daily_protein_g).toBeNull();
    });

    test("upsertGoalDays is idempotent", async () => {
        const date = "2026-11-26";
        const fields = { daily_calories: 2100, daily_protein_g: 140 };
        const first = await upsertGoalDays(
            storeUserId,
            storeHouseholdId,
            [date],
            fields,
        );
        const second = await upsertGoalDays(
            storeUserId,
            storeHouseholdId,
            [date],
            fields,
        );
        expect(second[0]!.daily_calories).toBe(first[0]!.daily_calories);
        expect(second[0]!.daily_protein_g).toBe(first[0]!.daily_protein_g);
        expect(second[0]!.date).toBe(first[0]!.date);
        const { sql } = getCtx();
        const [count] = (await sql`
            select count(*)::int as n
            from public.nutrition_goal_days
            where
                household_id = ${storeHouseholdId}
                and user_id = ${storeUserId}
                and date = ${date}::date
        `) as { n: number }[];
        expect(count!.n).toBe(1);
    });

    test("upsertGoalDays does not touch another user's rows", async () => {
        const { sql } = getCtx();
        const otherId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${otherId}, ${`other-${otherId}@t.test`})
        `;
        await sql`
            insert into public.nutrition_goal_days (
                household_id,
                user_id,
                date,
                daily_calories
            )
            values (${storeHouseholdId}, ${otherId}, ${"2026-11-27"}, ${9999})
        `;
        await upsertGoalDays(storeUserId, storeHouseholdId, ["2026-11-28"], {
            daily_calories: 1800,
        });
        const other = await pgGoalDayStore.overrideForDate(
            otherId,
            "2026-11-27",
        );
        expect(other!.daily_calories).toBe(9999);
    });

    test("upsertGoalDays rejects invalid dates before SQL", async () => {
        await expect(
            upsertGoalDays(storeUserId, storeHouseholdId, ["2026-02-31"], {
                daily_calories: 2000,
            }),
        ).rejects.toThrow(/invalid calendar date/);
        await expect(
            clearGoalDays(storeUserId, storeHouseholdId, ["not-a-date"]),
        ).rejects.toThrow(/invalid calendar date/);
    });

    test("all-null upsert removes the row", async () => {
        const date = "2026-11-29";
        await upsertGoalDays(storeUserId, storeHouseholdId, [date], {
            daily_calories: 2500,
        });
        const cleared = await upsertGoalDays(
            storeUserId,
            storeHouseholdId,
            [date],
            {
                daily_calories: null,
            },
        );
        expect(cleared).toEqual([]);
        expect(
            await pgGoalDayStore.overrideForDate(storeUserId, date),
        ).toBeNull();
    });

    test("upsertGoalDays keeps both of two overlapping partial updates", async () => {
        const date = "2026-09-01";
        await upsertGoalDays(storeUserId, storeHouseholdId, [date], {
            daily_calories: 2000,
            daily_protein_g: 100,
        });
        await Promise.all([
            upsertGoalDays(storeUserId, storeHouseholdId, [date], {
                daily_calories: 2100,
            }),
            upsertGoalDays(storeUserId, storeHouseholdId, [date], {
                daily_protein_g: 180,
            }),
        ]);
        const row = await pgGoalDayStore.overrideForDate(storeUserId, date);
        expect(row?.daily_calories).toBe(2100);
        expect(row?.daily_protein_g).toBe(180);
    });

    test("upsertGoalDays writes a repeated date once", async () => {
        const written = await upsertGoalDays(
            storeUserId,
            storeHouseholdId,
            ["2026-05-01", "2026-05-01", "2026-05-02"],
            { daily_calories: 1800 },
        );
        expect(written.map((r) => r.date)).toEqual([
            "2026-05-01",
            "2026-05-02",
        ]);
    });
});
