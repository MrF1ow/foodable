import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import {
    getMealById,
    insertMeal,
    snapshotToMealItemWrite,
} from "../../db/nutrition.js";
import { upsertProfile } from "../../db/profiles.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { setSqlForTests } from "../../db/sql.js";
import { dateInTz } from "../../domain/tz.js";
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

    test("again on grams of a per-100 ml food logs the figures it was logged with", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        // As OFF hands over a liquid: per 100 ml, no density, default unit grams.
        const foodId = crypto.randomUUID();
        await sql`
            insert into public.foods (
                id, household_id, kind, name, normalized_name, default_unit,
                nutrition_basis, calories, fat_g, allergens
            )
            values (
                ${foodId}, ${householdId}, ${"food"}, ${"Half & Half"},
                ${"half & half"}, ${"g"}, ${"100ml"}, ${130}, ${11},
                ${sql.array([], "text")}
            )
        `;
        // What the old log sheet wrote for 30 g: 39 kcal.
        const { meal } = await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: "30 g Half & Half",
            calories: 39,
            fat_g: 3.3,
            items: [
                snapshotToMealItemWrite(
                    {
                        foodId,
                        recipeId: null,
                        label: "Half & Half",
                        amount: 30,
                        unit: "g",
                        grams: 30,
                        portions: null,
                        calories: 39,
                        protein_g: null,
                        carbs_g: null,
                        fat_g: 3.3,
                        fiber_g: null,
                        sugar_g: null,
                        alcohol_g: null,
                        caffeine_mg: null,
                        sortOrder: 0,
                    },
                    householdId,
                ),
            ],
        });
        const res = await hono.request(`http://test/meals/${meal.id}/again`, {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/&date=2026-03-15",
        });
        expect(res.status).toBe(303);
        const rows = await sql`
            select id from public.meals
            where user_id = ${userId} and id <> ${meal.id}
        `;
        expect(rows).toHaveLength(1);
        const copy = await getMealById(userId, rows[0]!.id as string);
        expect(copy?.calories).toBe(39);
        expect(copy?.items?.[0]?.calories).toBe(39);
        expect(copy?.items?.[0]?.unit).toBe("g");
    });

    test("the same Again tapped twice logs one meal, a fresh tap logs another", async () => {
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
        const count = async () =>
            (
                await sql`
                    select count(*)::int as n from public.meals
                    where user_id = ${userId}
                `
            )[0]!.n as number;
        // Today logs at the moment of the tap, so only a key can tell a double tap.
        const today = dateInTz(new Date(), "America/Los_Angeles");
        const again = (key: string) =>
            hono.request(`http://test/meals/${meal.id}/again`, {
                method: "POST",
                headers: {
                    cookie: cookie(userId),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `return_to=/&date=${today}&submit_key=${key}`,
            });
        const before = await count();
        // Two taps on one rendered form arrive together, then a late third.
        const taps = await Promise.all([again("tap-1"), again("tap-1")]);
        expect(taps.map((r) => r.status)).toEqual([303, 303]);
        expect((await again("tap-1")).status).toBe(303);
        expect(await count()).toBe(before + 1);
        // The page re-rendered after the redirect carries a new key.
        expect((await again("tap-2")).status).toBe(303);
        expect(await count()).toBe(before + 2);
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

    test("again picks up edited food nutrition", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const foodId = await seedFood(sql, "Egg", 80, 6);
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 1, unit: "each" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: "2026-03-01T08:00:00.000Z",
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        await sql`
            update public.foods
            set calories = ${120}, protein_g = ${10}
            where id = ${foodId}
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
        const meals = await sql`
            select id from public.meals
            where user_id = ${userId}
            order by logged_at desc
            limit 1
        `;
        const newest = await getMealById(userId, meals[0]!.id as string);
        expect(newest?.calories).toBe(60);
        expect(newest?.protein_g).toBe(5);
    });

    async function seedUsualEggs(
        sql: import("bun").SQL,
        plainCal: number,
        productCal: number,
    ): Promise<string> {
        const plainId = await seedFood(sql, "Eggs", plainCal, 6);
        const productId = crypto.randomUUID();
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
                generic_food_id,
                allergens
            )
            values (
                ${productId},
                ${householdId},
                ${"food"},
                ${"Cage Free Eggs"},
                ${"cage free eggs"},
                ${"each"},
                ${50},
                ${productCal},
                ${8},
                ${plainId},
                ${sql.array([], "text")}
            )
        `;
        await sql`
            update public.foods
            set usual_product_id = ${productId}
            where id = ${plainId}
        `;
        return plainId;
    }

    test("again uses usual-product nutrition like a fresh log", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const plainId = await seedUsualEggs(sql, 80, 140);
        const fresh = await mealWriteFromItems(householdId, [
            { foodId: plainId, amount: 2, unit: "each" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: "2026-03-01T08:00:00.000Z",
            description: fresh.description,
            ...fresh.totals,
            items: fresh.items,
            item_digest: fresh.item_digest,
        });
        const res = await hono.request(`http://test/meals/${meal.id}/again`, {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/&date=2026-03-15",
        });
        expect(res.status).toBe(303);
        const meals = await sql`
            select id from public.meals
            where user_id = ${userId}
            order by logged_at desc
            limit 1
        `;
        const newest = await getMealById(userId, meals[0]!.id as string);
        expect(newest?.calories).toBe(fresh.totals.calories);
    });

    test("again keeps logged snapshot when the food was archived", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const foodId = await seedFood(sql, "Eggs", 80, 6);
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 1, unit: "each" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        await sql`
            update public.foods
            set archived_at = now(), calories = ${200}
            where id = ${foodId}
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
        const meals = await sql`
            select id from public.meals
            where user_id = ${userId}
            order by logged_at desc
            limit 1
        `;
        const newest = await getMealById(userId, meals[0]!.id as string);
        expect(newest?.calories).toBe(computed.totals.calories);
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
