import { afterEach, beforeEach, expect, test } from "bun:test";
import {
    getGoalsForDate,
    getGoalsForRange,
    pgGoalDayStore,
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
});
