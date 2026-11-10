import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { SQL } from "bun";
import * as nutrition from "./nutrition.js";
import {
    countMeals,
    deleteAllUserData,
    getAllMeals,
    getAllWater,
    getAllWeight,
    insertMeal,
} from "./nutrition.js";
import { upsertProfile } from "./profiles.js";
import { describeDb } from "./testing/pg.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

const DELETE_ALL_TABLES = [
    "tool_analytics",
    "water_log",
    "weight_log",
    "nutrition_goals",
    "profiles",
    "recipe_portions",
    "meals",
    // Not deleted by name: it goes with meals through on delete cascade.
    // Counted so a migration that breaks that cascade fails this test.
    "meal_items",
    "oauth_tokens",
    "refresh_tokens",
    "auth_codes",
    "export_archives",
] as const;

async function countDeleteAllTables(
    sql: SQL,
    userId: string,
): Promise<Record<(typeof DELETE_ALL_TABLES)[number], number>> {
    const out = {} as Record<(typeof DELETE_ALL_TABLES)[number], number>;
    for (const table of DELETE_ALL_TABLES) {
        const [row] = await sql`
            select count(*)::int as n
            from ${sql.unsafe(table)}
            where user_id = ${userId}
        `;
        out[table] = row.n;
    }
    return out;
}

async function seedDeleteAllUserRows(
    sql: SQL,
    userId: string,
    householdId: string,
): Promise<void> {
    await asUser(userId, () => upsertProfile(userId, { timezone: "UTC" }));
    await sql`
        insert into nutrition_goals (user_id, daily_calories)
        values (${userId}, ${1800})
    `;
    await sql`
        insert into water_log (user_id, amount_ml, logged_at, idempotency_key)
        values (
            ${userId},
            ${200},
            ${"2024-05-01T12:00:00.000Z"},
            ${`w-${userId}`}
        )
    `;
    await sql`
        insert into weight_log (user_id, weight_g, logged_at, idempotency_key)
        values (
            ${userId},
            ${70000},
            ${"2024-05-01T12:00:00.000Z"},
            ${`wt-${userId}`}
        )
    `;
    await sql`
        insert into meals (user_id, description, meal_type, logged_at, idempotency_key)
        values (
            ${userId},
            ${"Erase"},
            ${"lunch"},
            ${"2024-05-01T13:00:00.000Z"},
            ${`meal-${userId}`}
        )
    `;
    await sql`
        insert into meal_items (meal_id, user_id, label)
        select id, user_id, ${"Erase item"}
        from meals
        where idempotency_key = ${`meal-${userId}`}
    `;
    await sql`
        insert into tool_analytics (
            user_id,
            tool_name,
            success,
            duration_ms,
            error_category
        )
        values (${userId}, ${"log_meal"}, ${true}, ${1}, ${null})
    `;
    const [recipe] = await sql`
        insert into recipes (household_id, creator_id, name, yield_portions)
        values (${householdId}, ${userId}, ${"Test recipe"}, ${4})
        returning id
    `;
    await sql`
        insert into recipe_portions (recipe_id, household_id, user_id, portion_count)
        values (${recipe.id}, ${householdId}, ${userId}, ${1})
    `;
    await sql`
        insert into oauth_tokens (token, user_id, expires_at)
        values (
            ${`oauth-${userId}`},
            ${userId},
            ${"2030-01-01T00:00:00.000Z"}
        )
    `;
    await sql`
        insert into refresh_tokens (token, user_id, expires_at)
        values (
            ${`refresh-${userId}`},
            ${userId},
            ${"2030-01-01T00:00:00.000Z"}
        )
    `;
    await sql`
        insert into auth_codes (
            code,
            redirect_uri,
            user_id,
            code_challenge,
            expires_at
        )
        values (
            ${`code-${userId}`},
            ${"http://localhost/cb"},
            ${userId},
            ${"challenge"},
            ${"2030-01-01T00:00:00.000Z"}
        )
    `;
    await sql`
        insert into export_archives (user_id, archive, expires_at)
        values (
            ${userId},
            ${new Uint8Array([0x50, 0x4b, 0x03, 0x04])},
            ${"2030-01-01T00:00:00.000Z"}
        )
    `;
}

describeDb(pgAvailable !== null, "nutrition bulk db", (getCtx) => {
    let userId: string;
    let otherUserId: string;
    let householdId: string;
    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId, householdId } = await seedHousehold(sql));
        otherUserId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${otherUserId}, ${`keep-${otherUserId}@foodable.test`})
        `;
        await asUser(otherUserId, () =>
            insertMeal(otherUserId, {
                description: "Keep",
                meal_type: "snack",
                logged_at: "2024-01-01T12:00:00.000Z",
            }),
        );
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("getAllMeals pages past 1000 rows with logged_at tie-breaker", async () => {
        const { sql } = getCtx();
        const loggedAt = "2024-02-01T12:00:00.000Z";
        await sql`
            insert into meals (user_id, description, meal_type, logged_at, idempotency_key)
            select
                ${userId},
                'bulk',
                'snack',
                ${loggedAt}::timestamptz,
                'bulk-meal:' || g::text
            from generate_series(1, 1001) as g
        `;
        expect(await countMeals(userId)).toBe(1001);
        const expected = await sql`
            select id::text as id
            from meals
            where user_id = ${userId}
            order by logged_at asc, id asc
        `;
        const meals = await getAllMeals(userId);
        expect(meals).toHaveLength(1001);
        const ids = meals.map((m) => m.id);
        expect(ids).toEqual(expected.map((r: { id: string }) => r.id));
        expect(new Set(ids).size).toBe(1001);
    });

    test("getAllWater pages with logged_at tie-breaker", async () => {
        const { sql } = getCtx();
        const loggedAt = "2024-04-01T12:00:00.000Z";
        await sql`
            insert into water_log (user_id, amount_ml, logged_at, idempotency_key)
            select
                ${userId},
                100,
                ${loggedAt}::timestamptz,
                'w:' || g::text
            from generate_series(1, 1001) as g
        `;
        const expected = await sql`
            select id::text as id
            from water_log
            where user_id = ${userId}
            order by logged_at asc, id asc
        `;
        const entries = await getAllWater(userId);
        expect(entries).toHaveLength(1001);
        const ids = entries.map((e) => e.id);
        expect(ids).toEqual(expected.map((r: { id: string }) => r.id));
        expect(new Set(ids).size).toBe(1001);
    });

    test("getAllWeight pages with logged_at tie-breaker", async () => {
        const { sql } = getCtx();
        const loggedAt = "2024-04-01T12:00:00.000Z";
        await sql`
            insert into weight_log (user_id, weight_g, logged_at, idempotency_key)
            select
                ${userId},
                70000,
                ${loggedAt}::timestamptz,
                'wt:' || g::text
            from generate_series(1, 1001) as g
        `;
        const expected = await sql`
            select id::text as id
            from weight_log
            where user_id = ${userId}
            order by logged_at asc, id asc
        `;
        const entries = await getAllWeight(userId);
        expect(entries).toHaveLength(1001);
        const ids = entries.map((e) => e.id);
        expect(ids).toEqual(expected.map((r: { id: string }) => r.id));
        expect(new Set(ids).size).toBe(1001);
    });

    test("getAllMeals truncation guard message", async () => {
        const { sql } = getCtx();
        await insertMeal(userId, {
            description: "One",
            meal_type: "snack",
            logged_at: "2024-03-01T12:00:00.000Z",
        });
        const countSpy = spyOn(nutrition, "countMeals").mockResolvedValue(2);
        try {
            const err = await getAllMeals(userId).then(
                () => null,
                (e: unknown) => e,
            );
            expect((err as Error).message).toBe(
                "getAllMeals: fetched 1 meals but countMeals reported 2 — export would be truncated",
            );
        } finally {
            countSpy.mockRestore();
        }
    });

    test("getAllWater truncation guard message", async () => {
        const { sql } = getCtx();
        await sql`
            insert into water_log (user_id, amount_ml, logged_at, idempotency_key)
            values (
                ${userId},
                ${100},
                ${"2024-03-02T12:00:00.000Z"},
                ${"guard-w"}
            )
        `;
        const countSpy = spyOn(nutrition, "countWater").mockResolvedValue(2);
        try {
            const err = await getAllWater(userId).then(
                () => null,
                (e: unknown) => e,
            );
            expect((err as Error).message).toBe(
                "getAllWater: fetched 1 entries but countWater reported 2 — export would be truncated",
            );
        } finally {
            countSpy.mockRestore();
        }
    });

    test("getAllWeight truncation guard message", async () => {
        const { sql } = getCtx();
        await sql`
            insert into weight_log (user_id, weight_g, logged_at, idempotency_key)
            values (
                ${userId},
                ${70000},
                ${"2024-03-03T12:00:00.000Z"},
                ${"guard-wt"}
            )
        `;
        const countSpy = spyOn(nutrition, "countWeight").mockResolvedValue(2);
        try {
            const err = await getAllWeight(userId).then(
                () => null,
                (e: unknown) => e,
            );
            expect((err as Error).message).toBe(
                "getAllWeight: fetched 1 entries but countWeight reported 2 — export would be truncated",
            );
        } finally {
            countSpy.mockRestore();
        }
    });

    test("deleteAllUserData clears every table for target user", async () => {
        const { sql } = getCtx();
        await seedDeleteAllUserRows(sql, userId, householdId);
        await seedDeleteAllUserRows(sql, otherUserId, householdId);
        const beforeOther = await countDeleteAllTables(sql, otherUserId);
        for (const n of Object.values(beforeOther)) {
            expect(n).toBeGreaterThan(0);
        }

        await deleteAllUserData(userId);

        const afterTarget = await countDeleteAllTables(sql, userId);
        for (const n of Object.values(afterTarget)) {
            expect(n).toBe(0);
        }
        const afterOther = await countDeleteAllTables(sql, otherUserId);
        expect(afterOther).toEqual(beforeOther);
    });

    test("deleteAllUserData rolls back when a delete fails", async () => {
        const { sql } = getCtx();
        await seedDeleteAllUserRows(sql, userId, householdId);
        await seedDeleteAllUserRows(sql, otherUserId, householdId);
        const beforeTarget = await countDeleteAllTables(sql, userId);
        const beforeOther = await countDeleteAllTables(sql, otherUserId);
        await sql.begin(async (tx) => {
            await tx`
                create or replace function public._foodable_break_meals_delete()
                returns trigger
                language plpgsql
                as $$
                begin
                    raise exception 'forced delete failure';
                end;
                $$
            `;
            await tx`
                create trigger _foodable_break_meals
                before delete on meals
                for each row
                execute function public._foodable_break_meals_delete()
            `;
        });
        const err = await deleteAllUserData(userId).then(
            () => null,
            (e: unknown) => e,
        );
        expect((err as Error).message).toBe(
            "Failed to delete meals: forced delete failure",
        );
        expect(await countDeleteAllTables(sql, userId)).toEqual(beforeTarget);
        expect(await countDeleteAllTables(sql, otherUserId)).toEqual(
            beforeOther,
        );
        await sql.begin(async (tx) => {
            await tx`drop trigger if exists _foodable_break_meals on meals`;
            await tx`drop function if exists public._foodable_break_meals_delete()`;
        });
    });
});
