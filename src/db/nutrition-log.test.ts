import { SQL } from "bun";
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
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

async function raceInsertWater(opts: {
    url: string;
    sql: SQL;
    userId: string;
    key: string;
}) {
    const holder = new SQL(opts.url, { prepare: false, max: 1 });
    const left = new SQL(opts.url, { prepare: false, max: 1 });
    const right = new SQL(opts.url, { prepare: false, max: 1 });
    let releaseLock!: () => void;
    const lockReleased = new Promise<void>((r) => (releaseLock = r));
    let lockTaken!: () => void;
    const lockHeld = new Promise<void>((r) => (lockTaken = r));
    const holding = holder.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(515151)`;
        lockTaken();
        await lockReleased;
    });
    const input = {
        amount_ml: 250,
        idempotency_key: opts.key,
        logged_at: "2024-06-01T08:00:00.000Z",
    };
    try {
        await lockHeld;
        setSqlForTests(left);
        const first = insertWater(opts.userId, input);
        setSqlForTests(right);
        const second = insertWater(opts.userId, input);
        setSqlForTests(opts.sql);
        releaseLock();
        await holding;
        return await Promise.all([first, second]);
    } finally {
        releaseLock();
        await Promise.allSettled([holding]);
        setSqlForTests(opts.sql);
        await Promise.all([holder.close(), left.close(), right.close()]);
    }
}

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
            insert into auth.users (id, email)
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
        const [a, b] = await raceInsertWater({
            url: pg.url,
            sql,
            userId,
            key: "water-race",
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
        await expect(
            updateWeight(userId, crypto.randomUUID(), { weight_g: 1 }),
        ).rejects.toThrow("Failed to update weight: entry not found");

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
