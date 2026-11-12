import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { insertMeal } from "./nutrition.js";
import { recentLogs } from "./meals.js";
import { describeDb } from "./testing/pg.js";
import { asUser, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";
import { mealWriteFromItems } from "../meal-write.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "recentLogs db", (getCtx) => {
    let userId: string;
    let householdId: string;
    let otherUserId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId, householdId } = await seedHousehold(sql));
        otherUserId = crypto.randomUUID();
        await sql`
            insert into public.users (id, email)
            values (${otherUserId}, ${`other-${otherUserId}@foodable.test`})
        `;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    async function seedFoodRow(
        sql: import("bun").SQL,
        name: string,
        calories: number,
        protein_g: number,
    ): Promise<string> {
        const id = crypto.randomUUID();
        await sql`
            insert into public.foods (
                id,
                household_id,
                kind,
                name,
                normalized_name,
                default_unit,
                grams_per_each,
                calories,
                protein_g,
                allergens
            )
            values (
                ${id},
                ${householdId},
                ${"food"},
                ${name},
                ${name.toLowerCase()},
                ${"each"},
                ${50},
                ${calories},
                ${protein_g},
                ${sql.array([], "text")}
            )
        `;
        return id;
    }

    test("returns distinct food-backed logs newest first", async () => {
        const { sql } = getCtx();
        const foodId = await seedFoodRow(sql, "Oats", 150, 5);
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 1, unit: "each" },
        ]);
        await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: "2026-11-01T08:00:00.000Z",
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: "2026-11-02T08:00:00.000Z",
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        const recents = await recentLogs(userId, 10);
        expect(recents).toHaveLength(1);
        expect(new Date(recents[0]!.logged_at).toISOString()).toBe(
            "2026-11-02T08:00:00.000Z",
        );
    });

    test("respects limit and scopes to the requesting user", async () => {
        const { sql } = getCtx();
        const foodA = await seedFoodRow(sql, "Apple", 80, 0);
        const foodB = await seedFoodRow(sql, "Banana", 100, 1);
        for (const [foodId, at] of [
            [foodA, "2026-11-01T08:00:00.000Z"],
            [foodB, "2026-11-02T08:00:00.000Z"],
            [foodA, "2026-11-03T08:00:00.000Z"],
        ] as const) {
            const computed = await mealWriteFromItems(householdId, [
                { foodId, amount: 1, unit: "each" },
            ]);
            await insertMeal(userId, {
                meal_type: "snack",
                logged_at: at,
                description: computed.description,
                ...computed.totals,
                items: computed.items,
                item_digest: computed.item_digest,
            });
        }
        await asUser(otherUserId, () =>
            insertMeal(otherUserId, {
                meal_type: "snack",
                logged_at: "2026-11-04T08:00:00.000Z",
                description: "Peer snack",
                calories: 50,
            }),
        );
        const recents = await recentLogs(userId, 2);
        expect(recents).toHaveLength(2);
        expect(
            recents.map((row) => new Date(row.logged_at).toISOString()),
        ).toEqual(["2026-11-03T08:00:00.000Z", "2026-11-02T08:00:00.000Z"]);
    });

    test("distinct free-text meals by normalized description", async () => {
        await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-11-01T12:00:00.000Z",
            description: "Salad",
            calories: 300,
        });
        await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-11-02T12:00:00.000Z",
            description: "  salad ",
            calories: 320,
        });
        const recents = await recentLogs(userId, 10);
        expect(recents).toHaveLength(1);
        expect(new Date(recents[0]!.logged_at).toISOString()).toBe(
            "2026-11-02T12:00:00.000Z",
        );
    });
});
