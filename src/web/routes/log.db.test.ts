import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { copyYesterdayIdempotencyKey } from "../../domain/meals.js";
import { recentHistoryStart } from "../../domain/log-search.js";
import { getMealsByDate, insertMeal } from "../../db/nutrition.js";
import { upsertProfile } from "../../db/profiles.js";
import { todayInTz, zonedDayStartUtc } from "../../domain/tz.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { setSqlForTests } from "../../db/sql.js";
import { mealWriteFromItems } from "../../meal-write.js";
import { decodeToastFlash, TOAST_COOKIE } from "../components/toast.js";
import { logRoutes } from "./log.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";

const SESSION = "01234567890123456789012345678901";
process.env.SESSION_SECRET ||= SESSION;
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "log copy-yesterday db", (getCtx) => {
    let userId: string;
    let householdId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        ({ userId, householdId } = await seedHousehold(sql));
        await upsertProfile(userId, { timezone: "Pacific/Kiritimati" });
    });

    afterEach(() => {
        setSqlForTests(null);
        resetFlagsForTests();
    });

    const hono = new Hono();
    hono.route("/", logRoutes);

    function cookie(uid: string): string {
        return `${SITE_COOKIE}=${mintSiteSession(uid)}`;
    }

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

    test("two copy-yesterday posts write one meal", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const tz = "Pacific/Kiritimati";
        const today = todayInTz(tz);
        const yesterday = recentHistoryStart(today, 1);
        const foodId = await seedFood(sql, "Egg", 80, 6);
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 2, unit: "each" },
        ]);
        const yesterdayMorning = new Date(
            zonedDayStartUtc(yesterday, tz).getTime() + 6 * 3_600_000,
        ).toISOString();
        await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: yesterdayMorning,
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        const countBefore = await sql`
            select count(*)::int as n from public.meals where user_id = ${userId}
        `;
        const post = () =>
            hono.request("http://test/log/copy-yesterday", {
                method: "POST",
                headers: {
                    cookie: cookie(userId),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "slot=breakfast&return_to=/",
            });
        const first = await post();
        const second = await post();
        expect(first.status).toBe(303);
        expect(second.status).toBe(303);
        const toastLine = second.headers
            .getSetCookie()
            .find((c) => c.startsWith(`${TOAST_COOKIE}=`));
        expect(toastLine).toBeDefined();
        const encoded = toastLine!.split(";")[0]!.split("=")[1]!;
        expect(decodeToastFlash(decodeURIComponent(encoded))?.key).toBe(
            "nutrition.meal.copy-yesterday.noop",
        );
        const countAfter = await sql`
            select count(*)::int as n from public.meals where user_id = ${userId}
        `;
        expect(countAfter[0]!.n).toBe(countBefore[0]!.n + 1);
        const key = copyYesterdayIdempotencyKey(userId, today, "breakfast");
        const keyed = await sql`
            select idempotency_key from public.meals
            where user_id = ${userId}
              and idempotency_key = ${key}
        `;
        expect(keyed).toHaveLength(1);
    });

    test("404 without ui-v2", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await hono.request("http://test/log/copy-yesterday", {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "slot=breakfast&return_to=/",
        });
        expect(res.status).toBe(404);
    });

    test("yesterday follows the member timezone", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const tz = "Pacific/Kiritimati";
        const today = todayInTz(tz);
        const yesterday = recentHistoryStart(today, 1);
        const yesterdayNoon = new Date(
            zonedDayStartUtc(yesterday, tz).getTime() + 12 * 3_600_000,
        ).toISOString();
        const todayNoon = new Date(
            zonedDayStartUtc(today, tz).getTime() + 8 * 3_600_000,
        ).toISOString();
        await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: yesterdayNoon,
            description: "Leftovers",
            calories: 500,
        });
        await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: todayNoon,
            description: "Early today",
            calories: 200,
        });
        const res = await hono.request("http://test/log/copy-yesterday", {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "slot=lunch&return_to=/",
        });
        expect(res.status).toBe(303);
        const todayMeals = await getMealsByDate(userId, today, tz);
        const lunch = todayMeals.filter((row) => row.meal_type === "lunch");
        expect(lunch).toHaveLength(1);
        expect(lunch[0]!.description).toBe("Leftovers");
    });

    test("404 when yesterday had nothing in the slot", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await hono.request("http://test/log/copy-yesterday", {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "slot=breakfast&return_to=/",
        });
        expect(res.status).toBe(404);
    });

    test("copy-yesterday includes null meal_type rows in the snack slot", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const tz = "Pacific/Kiritimati";
        const today = todayInTz(tz);
        const yesterday = recentHistoryStart(today, 1);
        const yesterdayNoon = new Date(
            zonedDayStartUtc(yesterday, tz).getTime() + 15 * 3_600_000,
        ).toISOString();
        const mealId = crypto.randomUUID();
        await sql`
            insert into public.meals (
                id,
                user_id,
                logged_at,
                description,
                calories,
                idempotency_key
            )
            values (
                ${mealId},
                ${userId},
                ${yesterdayNoon}::timestamptz,
                ${"Trail mix"},
                ${180},
                ${`auto:${mealId}`}
            )
        `;
        const res = await hono.request("http://test/log/copy-yesterday", {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "slot=snack&return_to=/",
        });
        expect(res.status).toBe(303);
        const todayMeals = await getMealsByDate(userId, today, tz);
        const snack = todayMeals.filter((row) => row.meal_type === "snack");
        expect(snack.some((row) => row.description === "Trail mix")).toBe(true);
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

    test("copy-yesterday matches fresh usual-product nutrition", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const tz = "Pacific/Kiritimati";
        const today = todayInTz(tz);
        const yesterday = recentHistoryStart(today, 1);
        const plainId = await seedUsualEggs(sql, 80, 140);
        const fresh = await mealWriteFromItems(householdId, [
            { foodId: plainId, amount: 2, unit: "each" },
        ]);
        const yesterdayMorning = new Date(
            zonedDayStartUtc(yesterday, tz).getTime() + 7 * 3_600_000,
        ).toISOString();
        await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: yesterdayMorning,
            description: fresh.description,
            ...fresh.totals,
            items: fresh.items,
            item_digest: fresh.item_digest,
        });
        const res = await hono.request("http://test/log/copy-yesterday", {
            method: "POST",
            headers: {
                cookie: cookie(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "slot=breakfast&return_to=/",
        });
        expect(res.status).toBe(303);
        const todayMeals = await getMealsByDate(userId, today, tz);
        const copied = todayMeals.find((row) => row.meal_type === "breakfast");
        expect(copied?.calories).toBe(fresh.totals.calories);
    });
});
