import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { getMealById, insertMeal } from "../../db/nutrition.js";
import { upsertProfile } from "../../db/profiles.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { setSqlForTests } from "../../db/sql.js";
import { mealWriteFromItems } from "../../meal-write.js";
import { nutritionRoutes } from "./nutrition.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";

const SESSION = "01234567890123456789012345678901";
process.env.SESSION_SECRET ||= SESSION;
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "today again db", (getCtx) => {
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
            values (${otherUserId}, ${`peer-${otherUserId}@foodable.test`})
        `;
        await sql`
            insert into public.household_members (
                household_id,
                user_id,
                role,
                display_name
            )
            values (${householdId}, ${otherUserId}, ${"member"}, ${"Peer"})
        `;
        await upsertProfile(userId, {
            timezone: "America/Los_Angeles",
        });
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    async function seedFood(
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

    const hono = new Hono();
    hono.route("/", nutritionRoutes);

    function cookie(uid: string): string {
        return `${SITE_COOKIE}=${mintSiteSession(uid)}`;
    }

    test("again logs a copy with the same items when flag on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const foodId = await seedFood(sql, "Egg", 80, 6);
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 2, unit: "each" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        const countBefore = await sql`
            select count(*)::int as n from public.meals where user_id = ${userId}
        `;
        const res = await hono.request(`http://test/meals/${meal.id}/again`, {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/&date=2026-03-15",
        });
        expect(res.status).toBe(303);
        const countAfter = await sql`
            select count(*)::int as n from public.meals where user_id = ${userId}
        `;
        expect(countAfter[0]!.n).toBe(countBefore[0]!.n + 1);
        const meals = await sql`
            select id from public.meals
            where user_id = ${userId}
            order by logged_at desc
        `;
        const newest = await getMealById(userId, meals[0]!.id as string);
        expect(newest?.meal_type).toBe("lunch");
        expect(newest?.items).toHaveLength(1);
        expect(newest?.items?.[0]?.label).toBe(computed.items![0]!.label);
        expect(newest?.calories).toBe(computed.totals.calories);
    });

    test("again 404 without flag and does not write", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const { sql } = getCtx();
        const { meal } = await insertMeal(userId, {
            meal_type: "snack",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: "Apple",
            calories: 95,
        });
        const countBefore = await sql`
            select count(*)::int as n from public.meals where user_id = ${userId}
        `;
        const res = await hono.request(`http://test/meals/${meal.id}/again`, {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/&date=2026-03-01",
        });
        expect(res.status).toBe(404);
        const countAfter = await sql`
            select count(*)::int as n from public.meals where user_id = ${userId}
        `;
        expect(countAfter[0]!.n).toBe(countBefore[0]!.n);
    });

    test("another household meal id returns 404", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { meal } = await insertMeal(otherUserId, {
            meal_type: "dinner",
            logged_at: "2026-03-01T18:00:00.000Z",
            description: "Peer meal",
            calories: 400,
        });
        const res = await hono.request(`http://test/meals/${meal.id}/again`, {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/&date=2026-03-01",
        });
        expect(res.status).toBe(404);
    });
});
