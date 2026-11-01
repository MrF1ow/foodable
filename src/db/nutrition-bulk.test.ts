import { mock } from "bun:test";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as actualClient from "./client.js";
import {
    countMeals,
    deleteAllUserData,
    getAllMeals,
    getAllWater,
    getAllWeight,
    insertMeal,
    insertWater,
    insertWeight,
    upsertNutritionGoals,
} from "./nutrition.js";
import { upsertProfile } from "./profiles.js";
import { insertToolAnalytics } from "./analytics.js";
import { storeRefreshToken } from "./tokens.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { run, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

mock.module("./client.js", () => ({
    ...actualClient,
    getSupabase: () => ({
        auth: {
            admin: {
                deleteUser: async () => ({ error: null }),
            },
        },
        storage: {
            from: () => ({
                remove: async () => ({ error: null }),
            }),
        },
    }),
}));

describeDb(pgAvailable !== null, "nutrition bulk db", (getCtx) => {
    let userId: string;
    let otherUserId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId } = await seedHousehold(sql));
        otherUserId = crypto.randomUUID();
        await sql`
            insert into auth.users (id, email)
            values (${otherUserId}, ${`keep-${otherUserId}@foodable.test`})
        `;
        await insertMeal(otherUserId, {
            description: "Keep",
            meal_type: "snack",
            logged_at: "2024-01-01T12:00:00.000Z",
        });
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("getAllMeals pages past 1000 rows", async () => {
        const { sql } = getCtx();
        await sql`
            insert into meals (user_id, description, meal_type, logged_at, idempotency_key)
            select
                ${userId},
                'bulk',
                'snack',
                ${"2024-02-01T12:00:00.000Z"}::timestamptz
                    + (g * interval '1 millisecond'),
                'bulk-meal:' || g::text
            from generate_series(1, 1001) as g
        `;
        expect(await countMeals(userId)).toBe(1001);
        const meals = await getAllMeals(userId);
        expect(meals).toHaveLength(1001);
        expect(meals[0]!.logged_at <= meals[1000]!.logged_at).toBe(true);
    });

    test("getAllWater and getAllWeight return full exports", async () => {
        const { sql } = getCtx();
        await sql`
            insert into water_log (user_id, amount_ml, logged_at, idempotency_key)
            select
                ${userId},
                100,
                ${"2024-04-01T12:00:00.000Z"}::timestamptz
                    + (g * interval '1 millisecond'),
                'w:' || g::text
            from generate_series(1, 1001) as g
        `;
        await sql`
            insert into weight_log (user_id, weight_g, logged_at, idempotency_key)
            select
                ${userId},
                70000,
                ${"2024-04-01T12:00:00.000Z"}::timestamptz
                    + (g * interval '1 millisecond'),
                'wt:' || g::text
            from generate_series(1, 1001) as g
        `;
        expect(await getAllWater(userId)).toHaveLength(1001);
        expect(await getAllWeight(userId)).toHaveLength(1001);
    });

    test("deleteAllUserData clears target user and keeps other user", async () => {
        const { sql } = getCtx();
        await upsertProfile(userId, { timezone: "UTC" });
        await upsertNutritionGoals(userId, { daily_calories: 1800 });
        await insertWater(userId, {
            amount_ml: 200,
            logged_at: "2024-05-01T12:00:00.000Z",
        });
        await insertMeal(userId, {
            description: "Erase",
            meal_type: "lunch",
            logged_at: "2024-05-01T13:00:00.000Z",
        });
        insertToolAnalytics({
            user_id: userId,
            tool_name: "log_meal",
            duration_ms: 1,
            success: true,
            error_category: null,
        } as unknown as import("../analytics.js").AnalyticsRecord);
        await storeRefreshToken("rt-delete-all", userId);
        await new Promise((r) => setTimeout(r, 40));

        await deleteAllUserData(userId);

        expect(await countMeals(userId)).toBe(0);
        expect(await countMeals(otherUserId)).toBe(1);
        const [analytics] = await sql`
            select count(*)::int as n from tool_analytics where user_id = ${userId}
        `;
        expect(analytics.n).toBe(0);
        const [profile] = await sql`
            select count(*)::int as n from profiles where user_id = ${userId}
        `;
        expect(profile.n).toBe(0);
    });

    test("deleteAllUserData rolls back when a delete fails", async () => {
        await insertMeal(userId, {
            description: "Stay if rollback",
            meal_type: "snack",
            logged_at: "2024-06-01T12:00:00.000Z",
        });
        await run(async (tx) => {
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
        await expect(deleteAllUserData(userId)).rejects.toThrow(
            "Failed to delete meals: forced delete failure",
        );
        expect(await countMeals(userId)).toBe(1);
        await run(async (tx) => {
            await tx`drop trigger if exists _foodable_break_meals on meals`;
            await tx`drop function if exists public._foodable_break_meals_delete()`;
        });
    });
});
