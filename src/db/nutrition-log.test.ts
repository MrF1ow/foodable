import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
    deleteWater,
    deleteWeight,
    getLatestWeight,
    getNutritionGoals,
    getWaterByDate,
    getWaterInRange,
    getWeightByDate,
    getWeightInRange,
    insertWater,
    insertWeight,
    updateWeight,
    upsertNutritionGoals,
} from "./nutrition.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { raceOnUniqueKey } from "./testing/lock-race.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "nutrition log db", (getCtx) => {
    let userId: string;
    let otherUserId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId } = await seedHousehold(sql));
        otherUserId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${otherUserId}, ${`other-${otherUserId}@foodable.test`})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("upsertNutritionGoals insert then partial update", async () => {
        const first = await upsertNutritionGoals(userId, {
            daily_calories: 2000.6,
            daily_protein_g: 150,
            daily_water_ml: 2500.2,
        });
        expect(first.daily_calories).toBe(2001);
        expect(first.daily_water_ml).toBe(2500);
        expect(first.daily_carbs_g).toBeNull();
        expect(first.updated_at).toMatch(/\+00:00$/);

        const second = await upsertNutritionGoals(userId, {
            daily_carbs_g: 200,
        });
        expect(second.daily_calories).toBe(2001);
        expect(second.daily_carbs_g).toBe(200);
    });

    test("goal name, note and set date persist and read back", async () => {
        const saved = await upsertNutritionGoals(userId, {
            daily_calories: 2100,
            goal_name: "Recomp",
            goal_note: "Since the October check-in",
            goals_set_on: "2026-10-02",
        });
        expect(saved.goal_name).toBe("Recomp");
        expect(saved.goal_note).toBe("Since the October check-in");
        expect(saved.goals_set_on).toBe("2026-10-02");
        const read = await getNutritionGoals(userId);
        expect(read?.goal_name).toBe("Recomp");
        expect(read?.goal_note).toBe("Since the October check-in");
        expect(read?.goals_set_on).toBe("2026-10-02");
    });

    test("a goals write without a name keeps the stored name, note and date", async () => {
        await upsertNutritionGoals(userId, {
            daily_calories: 2100,
            goal_name: "Recomp",
            goal_note: "Slow and steady",
            goals_set_on: "2026-10-02",
        });
        const after = await upsertNutritionGoals(userId, {
            daily_protein_g: 150,
        });
        expect(after.daily_protein_g).toBe(150);
        expect(after.goal_name).toBe("Recomp");
        expect(after.goal_note).toBe("Slow and steady");
        expect(after.goals_set_on).toBe("2026-10-02");
        const cleared = await upsertNutritionGoals(userId, {
            goal_name: null,
            goal_note: null,
        });
        expect(cleared.goal_name).toBeNull();
        expect(cleared.goal_note).toBeNull();
        expect(cleared.goals_set_on).toBe("2026-10-02");
    });

    test("a goals row with no name reads back null name, note and date", async () => {
        const saved = await upsertNutritionGoals(userId, {
            daily_calories: 1800,
        });
        expect(saved.goal_name).toBeNull();
        expect(saved.goal_note).toBeNull();
        expect(saved.goals_set_on).toBeNull();
    });

    test("getNutritionGoals null when missing", async () => {
        expect(await getNutritionGoals(crypto.randomUUID())).toBeNull();
    });

    test("insertWater shape and dedupe race", async () => {
        const { entry, deduplicated } = await insertWater(userId, {
            amount_ml: 500,
            notes: "bottle",
            logged_at: "2024-07-10T10:00:00+00:00",
            idempotency_key: "w1",
        });
        expect(deduplicated).toBe(false);
        expect(entry).toEqual({
            id: entry.id,
            user_id: userId,
            amount_ml: 500,
            logged_at: "2024-07-10T10:00:00+00:00",
            notes: "bottle",
            created_at: entry.created_at,
            idempotency_key: "w1",
        });
        expect(entry.created_at).toMatch(/\+00:00$/);

        const { pg, sql } = getCtx();
        const key = "water-race";
        const loggedAt = "2024-06-01T08:00:00.000Z";
        const input = {
            amount_ml: 250,
            idempotency_key: key,
            logged_at: loggedAt,
        };
        const [a, b] = await raceOnUniqueKey({
            url: pg.url,
            restoreSql: sql,
            blockInsert: (tx) =>
                tx`
                    insert into water_log (
                        user_id,
                        amount_ml,
                        logged_at,
                        idempotency_key
                    )
                    values (${userId}, ${250}, ${loggedAt}, ${key})
                `,
            run: () => insertWater(userId, input),
        });
        expect([a.deduplicated, b.deduplicated].sort()).toEqual([false, true]);
        expect(a.entry.id).toBe(b.entry.id);
    });

    test("concurrent insertWeight with same key yields one winner", async () => {
        const { pg, sql } = getCtx();
        const key = "weight-race";
        const loggedAt = "2024-06-01T09:00:00.000Z";
        const input = {
            weight_g: 71000,
            idempotency_key: key,
            logged_at: loggedAt,
        };
        const [a, b] = await raceOnUniqueKey({
            url: pg.url,
            restoreSql: sql,
            blockInsert: (tx) =>
                tx`
                    insert into weight_log (
                        user_id,
                        weight_g,
                        logged_at,
                        idempotency_key
                    )
                    values (${userId}, ${71000}, ${loggedAt}, ${key})
                `,
            run: () => insertWeight(userId, input),
        });
        expect([a.deduplicated, b.deduplicated].sort()).toEqual([false, true]);
        expect(a.entry.id).toBe(b.entry.id);
    });

    test("getWaterByDate and getWaterInRange ordering", async () => {
        await insertWater(userId, {
            amount_ml: 200,
            logged_at: "2024-08-01T18:00:00.000Z",
        });
        await insertWater(userId, {
            amount_ml: 100,
            logged_at: "2024-08-01T08:00:00.000Z",
        });
        const day = await getWaterByDate(userId, "2024-08-01", "UTC");
        expect(day.map((e) => e.amount_ml)).toEqual([100, 200]);
        const range = await getWaterInRange(
            userId,
            "2024-08-01",
            "2024-08-01",
            "UTC",
        );
        expect(range).toHaveLength(2);
    });

    test("deleteWater respects user scope", async () => {
        const { entry } = await insertWater(userId, {
            amount_ml: 300,
            logged_at: "2024-08-02T12:00:00.000Z",
        });
        expect(await deleteWater(otherUserId, entry.id)).toBe(false);
        expect(await deleteWater(userId, entry.id)).toBe(true);
    });

    test("insertWeight and getLatestWeight", async () => {
        await insertWeight(userId, {
            weight_g: 72000,
            logged_at: "2024-09-01T08:00:00.000Z",
        });
        await insertWeight(userId, {
            weight_g: 71500,
            logged_at: "2024-09-02T08:00:00.000Z",
        });
        const latest = await getLatestWeight(userId);
        expect(latest?.weight_g).toBe(71500);
        expect(await getLatestWeight(crypto.randomUUID())).toBeNull();
    });

    test("getWeightByDate range edges", async () => {
        await insertWeight(userId, {
            weight_g: 71000,
            logged_at: "2024-10-01T00:00:00.000Z",
        });
        await insertWeight(userId, {
            weight_g: 71100,
            logged_at: "2024-10-02T00:00:00.000Z",
        });
        const day = await getWeightByDate(userId, "2024-10-01", "UTC");
        expect(day).toHaveLength(1);
        const range = await getWeightInRange(
            userId,
            "2024-10-01",
            "2024-10-02",
            "UTC",
        );
        expect(range).toHaveLength(2);
    });

    test("updateWeight not found and null notes", async () => {
        const err = await updateWeight(userId, crypto.randomUUID(), {
            weight_g: 1,
        }).then(
            () => null,
            (e: unknown) => e,
        );
        expect((err as Error).message).toBe(
            "Failed to update weight: entry not found",
        );

        const { entry } = await insertWeight(userId, {
            weight_g: 70000,
            logged_at: "2024-11-01T12:00:00.000Z",
            notes: "morning",
        });
        const updated = await updateWeight(userId, entry.id, { notes: null });
        expect(updated.notes).toBeNull();
    });

    test("deleteWeight", async () => {
        const { entry } = await insertWeight(userId, {
            weight_g: 69000,
            logged_at: "2024-11-02T12:00:00.000Z",
        });
        expect(await deleteWeight(userId, entry.id)).toBe(true);
    });
});
