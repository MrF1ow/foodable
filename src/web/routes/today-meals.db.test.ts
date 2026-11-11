import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { SQL } from "bun";
import { Hono } from "hono";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import {
    deleteMeal,
    getMealById,
    insertMeal,
    mealIdempotencyKey,
    updateMeal,
} from "../../db/nutrition.js";
import { upsertProfile } from "../../db/profiles.js";
import { describeDb } from "../../db/testing/pg.js";
import { seedHousehold } from "../../db/testing/fixtures.js";
import { findPgBin } from "../../db/testing/pg-temp.js";
import { setSqlForTests } from "../../db/sql.js";
import {
    mealUndoSnapshot,
    mintUndoFlash,
    parseUndoSnapshot,
    verifyUndoToken,
} from "../../domain/meal-undo.js";
import {
    itemSpecsFromStoredItems,
    mealLoggedAtFromLocalTime,
    scaleMealTotals,
} from "../../domain/today-edit.js";
import { itemListDigest } from "../../domain/meals.js";
import { dateInTz } from "../../domain/tz.js";
import { mealWriteFromItems, resolveWriteTimestamp } from "../../meal-write.js";
import { nutritionRoutes } from "./nutrition.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { TOAST_COOKIE } from "../components/toast.js";
import { UNDO_COOKIE } from "../../domain/meal-undo.js";
import { UNDO_SNAPSHOT_COOKIE } from "../meal-undo-flash.js";

const SESSION = "01234567890123456789012345678901";
process.env.SESSION_SECRET ||= SESSION;
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret-thirty-two-chars-min";

const pgAvailable = await findPgBin();

async function seedFoodWithNutrition(
    sql: SQL,
    householdId: string,
    opts: {
        name: string;
        calories: number;
        protein_g: number;
        grams_per_each?: number;
        default_unit?: string;
    },
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
            carbs_g,
            fat_g,
            allergens
        )
        values (
            ${id},
            ${householdId},
            ${"food"},
            ${opts.name},
            ${opts.name.toLowerCase()},
            ${opts.default_unit ?? "each"},
            ${opts.grams_per_each ?? 50},
            ${opts.calories},
            ${opts.protein_g},
            ${null},
            ${null},
            ${sql.array([], "text")}
        )
    `;
    return id;
}

describeDb(pgAvailable !== null, "today meal writes db", (getCtx) => {
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
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("getMealById returns items for owner only", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Owner meal",
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            idempotency_key: "test:owner",
            items: [
                {
                    household_id: householdId,
                    food_id: null,
                    recipe_id: null,
                    label: "Banana",
                    amount: 1,
                    unit: "each",
                    grams: 120,
                    portions: null,
                    calories: 105,
                    protein_g: 1,
                    carbs_g: 27,
                    fat_g: 0,
                    fiber_g: 3,
                    sugar_g: 14,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                },
            ],
        });
        const owned = await getMealById(userId, meal.id);
        expect(owned?.items).toHaveLength(1);
        expect(await getMealById(otherUserId, meal.id)).toBeNull();
    });

    test("time-only edit keeps logged_at precision and item idempotency digest", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const foodId = await seedFoodWithNutrition(sql, householdId, {
            name: "Egg",
            calories: 80,
            protein_g: 6,
            grams_per_each: 50,
        });
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 1, unit: "each" },
        ]);
        const loggedAt = "2026-03-01T12:34:56.789Z";
        const mealInput = {
            meal_type: "lunch" as const,
            logged_at: loggedAt,
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        };
        const { meal } = await insertMeal(userId, mealInput);
        const loaded = await getMealById(userId, meal.id);
        const itemId = loaded!.items![0]!.id;
        const relogKey = mealIdempotencyKey(
            userId,
            {
                description: loaded!.description,
                meal_type: loaded!.meal_type as "lunch",
                calories: loaded!.calories ?? undefined,
                protein_g: loaded!.protein_g ?? undefined,
                carbs_g: loaded!.carbs_g ?? undefined,
                fat_g: loaded!.fat_g ?? undefined,
                // The digest a fresh log of the same items writes, not one
                // rebuilt from the stored rows: that is what a re-log compares.
                item_digest: computed.item_digest,
            },
            new Date(loaded!.logged_at).toISOString(),
        );
        expect(loaded!.idempotency_key).toBe(relogKey);
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const edit = await app.request(`http://test/meals/${meal.id}/edit`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                meal_type: "lunch",
                logged_time: "12:34",
                [`item_amount_${itemId}`]: "1",
                date: "2026-03-01",
                return_to: "/?date=2026-03-01",
            }).toString(),
        });
        expect(edit.status).toBe(303);
        const after = await getMealById(userId, meal.id);
        expect(new Date(after!.logged_at).getTime()).toBe(
            new Date(loggedAt).getTime(),
        );
        expect(new Date(after!.logged_at).toISOString().slice(17, 23)).toBe(
            "56.789",
        );
        expect(after!.idempotency_key).toBe(relogKey);
        resetFlagsForTests();
    });

    test("amount edit stores the key a re-log at the new amount writes", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const foodId = await seedFoodWithNutrition(sql, householdId, {
            name: "Egg",
            calories: 80,
            protein_g: 6,
            grams_per_each: 50,
        });
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 1, unit: "each" },
        ]);
        const loggedAt = "2026-03-02T12:34:56.789Z";
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: loggedAt,
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        const loaded = await getMealById(userId, meal.id);
        const itemId = loaded!.items![0]!.id;
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const edit = await app.request(`http://test/meals/${meal.id}/edit`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                meal_type: "lunch",
                logged_time: "12:34",
                [`item_amount_${itemId}`]: "2",
                date: "2026-03-02",
                return_to: "/?date=2026-03-02",
            }).toString(),
        });
        expect(edit.status).toBe(303);
        const relog = await mealWriteFromItems(householdId, [
            { foodId, amount: 2, unit: "each" },
        ]);
        const { deduplicated } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: loggedAt,
            description: relog.description,
            ...relog.totals,
            items: relog.items,
            item_digest: relog.item_digest,
        });
        expect(deduplicated).toBe(true);
        resetFlagsForTests();
    });

    test("partial edit keeps untouched item snapshots when food nutrition changes", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const riceId = await seedFoodWithNutrition(sql, householdId, {
            name: "Rice",
            calories: 100,
            protein_g: 2,
            default_unit: "g",
        });
        const beansId = await seedFoodWithNutrition(sql, householdId, {
            name: "Beans",
            calories: 100,
            protein_g: 7,
            default_unit: "g",
        });
        const built = await mealWriteFromItems(householdId, [
            { foodId: riceId, amount: 100, unit: "g" },
            { foodId: beansId, amount: 100, unit: "g" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: built.description,
            ...built.totals,
            items: built.items,
            item_digest: built.item_digest,
        });
        await sql`
            update public.foods
            set calories = ${300}
            where id = ${beansId}
        `;
        const loaded = await getMealById(userId, meal.id);
        const riceItem = loaded!.items!.find((i) => i.food_id === riceId)!;
        const beansItem = loaded!.items!.find((i) => i.food_id === beansId)!;
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const edit = await app.request(`http://test/meals/${meal.id}/edit`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                meal_type: "lunch",
                logged_time: "12:00",
                [`item_amount_${riceItem.id}`]: "200",
                [`item_amount_${beansItem.id}`]: "100",
                date: "2026-03-01",
                return_to: "/?date=2026-03-01",
            }).toString(),
        });
        expect(edit.status).toBe(303);
        const after = await getMealById(userId, meal.id);
        expect(after?.calories).toBe(300);
        expect(after?.items?.find((i) => i.food_id === beansId)?.calories).toBe(
            100,
        );
        resetFlagsForTests();
    });

    test("partial edit keeps deleted-food snapshot when another amount changes", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const riceId = await seedFoodWithNutrition(sql, householdId, {
            name: "Rice",
            calories: 100,
            protein_g: 2,
            default_unit: "g",
        });
        const beansId = await seedFoodWithNutrition(sql, householdId, {
            name: "Beans",
            calories: 100,
            protein_g: 7,
            default_unit: "g",
        });
        const built = await mealWriteFromItems(householdId, [
            { foodId: riceId, amount: 100, unit: "g" },
            { foodId: beansId, amount: 100, unit: "g" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            description: built.description,
            ...built.totals,
            items: built.items,
            item_digest: built.item_digest,
        });
        const loadedBeforeDelete = await getMealById(userId, meal.id);
        const riceItem = loadedBeforeDelete!.items!.find(
            (i) => i.food_id === riceId,
        )!;
        const beansItem = loadedBeforeDelete!.items!.find(
            (i) => i.food_id === beansId,
        )!;
        await sql`delete from public.foods where id = ${beansId}`;
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const edit = await app.request(`http://test/meals/${meal.id}/edit`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                meal_type: "lunch",
                logged_time: "12:00",
                [`item_amount_${riceItem.id}`]: "200",
                [`item_amount_${beansItem.id}`]: "100",
                date: "2026-03-01",
                return_to: "/?date=2026-03-01",
            }).toString(),
        });
        expect(edit.status).toBe(303);
        const after = await getMealById(userId, meal.id);
        expect(after?.calories).toBe(300);
        const beansRow = after?.items?.find((i) => i.label === "Beans");
        expect(beansRow?.calories).toBe(100);
        expect(beansRow?.food_id).toBeNull();
        resetFlagsForTests();
    });

    test("food-backed edit recomputes totals via mealWriteFromItems", async () => {
        const { sql } = getCtx();
        const foodId = await seedFoodWithNutrition(sql, householdId, {
            name: "Egg",
            calories: 155,
            protein_g: 13,
            grams_per_each: 50,
        });
        const computed = await mealWriteFromItems(householdId, [
            { foodId, amount: 2, unit: "each" },
        ]);
        const { meal } = await insertMeal(userId, {
            meal_type: "breakfast",
            logged_at: "2026-03-01T08:00:00.000Z",
            idempotency_key: "test:food-edit",
            description: computed.description,
            ...computed.totals,
            items: computed.items,
            item_digest: computed.item_digest,
        });
        const editSpecs = [{ foodId, amount: 3, unit: "each" as const }];
        const recomputed = await mealWriteFromItems(householdId, editSpecs);
        await updateMeal(userId, meal.id, {
            description: recomputed.description,
            ...recomputed.totals,
            items: recomputed.items,
            item_digest: recomputed.item_digest,
        });
        const loaded = await getMealById(userId, meal.id);
        expect(loaded?.calories).toBe(
            Math.round(recomputed.totals.calories ?? 0),
        );
        expect(loaded?.protein_g).toBe(recomputed.totals.protein_g);
        expect(loaded?.items?.[0]?.amount).toBe(3);
    });

    test("Pacific/Auckland local time lands on same calendar day", async () => {
        await upsertProfile(userId, { timezone: "Pacific/Auckland" });
        const { meal } = await insertMeal(userId, {
            description: "Tz meal",
            meal_type: "lunch",
            logged_at: "2026-03-01T00:30:00.000Z",
            idempotency_key: "test:tz",
        });
        const day = "2026-03-01";
        const local = mealLoggedAtFromLocalTime(
            day,
            "12:40",
            "Pacific/Auckland",
        );
        const { iso } = await resolveWriteTimestamp(userId, local);
        expect(iso).toBeTruthy();
        await updateMeal(userId, meal.id, { logged_at: iso });
        const updated = await getMealById(userId, meal.id);
        expect(dateInTz(updated!.logged_at, "Pacific/Auckland")).toBe(day);
        const hour = new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "Pacific/Auckland",
        }).format(new Date(updated!.logged_at));
        expect(hour).toBe("12:40");
    });

    test("edit can move meal type", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Move me",
            meal_type: "breakfast",
            logged_at: "2026-03-01T08:00:00.000Z",
            idempotency_key: "test:move",
        });
        await updateMeal(userId, meal.id, { meal_type: "dinner" });
        const loaded = await getMealById(userId, meal.id);
        expect(loaded?.meal_type).toBe("dinner");
    });

    test("free-text servings scale stored totals", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Pasta plate",
            meal_type: "dinner",
            logged_at: "2026-03-01T18:00:00.000Z",
            calories: 400,
            protein_g: 20,
            carbs_g: 50,
            fat_g: 10,
            idempotency_key: "test:free",
        });
        const scaled = scaleMealTotals(meal, 2);
        await updateMeal(userId, meal.id, {
            calories: scaled.calories ?? undefined,
            protein_g: scaled.protein_g ?? undefined,
            carbs_g: scaled.carbs_g ?? undefined,
            fat_g: scaled.fat_g ?? undefined,
        });
        const loaded = await getMealById(userId, meal.id);
        expect(loaded?.calories).toBe(800);
        expect(loaded?.protein_g).toBe(40);
    });

    test("delete undo restores idempotency key and double undo is noop", async () => {
        const key = "test:undo-key";
        const { meal } = await insertMeal(userId, {
            description: "Undo me",
            meal_type: "snack",
            logged_at: "2026-03-01T15:00:00.000Z",
            idempotency_key: key,
            calories: 100,
        });
        const full = await getMealById(userId, meal.id);
        expect(full).not.toBeNull();
        const snapshot = mealUndoSnapshot(full!, householdId);
        const flash = mintUndoFlash(userId, snapshot, SESSION, Date.now());
        expect(
            verifyUndoToken(
                flash.token,
                flash.snapshotPayload,
                userId,
                Date.now(),
                SESSION,
            ),
        ).toBe(true);
        await deleteMeal(userId, meal.id);
        expect(await getMealById(userId, meal.id)).toBeNull();
        const parsed = parseUndoSnapshot(flash.snapshotJson)!;
        const first = await insertMeal(userId, {
            ...parsed.input,
            idempotency_key: parsed.idempotency_key ?? key,
        });
        expect(first.deduplicated).toBe(false);
        expect(first.meal.idempotency_key).toBe(key);
        const second = await insertMeal(userId, {
            ...parsed.input,
            idempotency_key: parsed.idempotency_key ?? key,
        });
        expect(second.deduplicated).toBe(true);
        expect(second.meal.id).toBe(first.meal.id);
    });

    test("POST recipe edit time-only keeps portions and totals", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const [recipe] = await sql`
            insert into recipes (household_id, creator_id, name, yield_portions)
            values (${householdId}, ${userId}, ${"Chili"}, ${4})
            returning id
        `;
        const recipeId = recipe.id as string;
        await sql`
            insert into recipe_portions (recipe_id, household_id, user_id, portion_count)
            values (${recipeId}, ${householdId}, ${userId}, ${1})
        `;
        const { meal } = await insertMeal(userId, {
            description: "Chili bowl",
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            calories: 500,
            protein_g: 35,
            carbs_g: 40,
            fat_g: 18,
            idempotency_key: "test:recipe-time",
            items: [
                {
                    household_id: householdId,
                    food_id: null,
                    recipe_id: recipeId,
                    label: "Chili",
                    amount: null,
                    unit: null,
                    grams: null,
                    portions: 2,
                    calories: 500,
                    protein_g: 35,
                    carbs_g: 40,
                    fat_g: 18,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                },
            ],
        });
        const loaded = await getMealById(userId, meal.id);
        const itemId = loaded!.items![0]!.id;
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const edit = await app.request(`http://test/meals/${meal.id}/edit`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                meal_type: "lunch",
                logged_time: "13:15",
                [`item_amount_${itemId}`]: "2",
                date: "2026-03-01",
                return_to: "/?date=2026-03-01",
            }).toString(),
        });
        expect(edit.status).toBe(303);
        const after = await getMealById(userId, meal.id);
        expect(after?.items?.[0]?.portions).toBe(2);
        expect(after?.calories).toBe(500);
        const hour = new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            timeZone: "UTC",
        }).format(new Date(after!.logged_at));
        expect(hour).toBe("13:15");
        resetFlagsForTests();
    });

    test("edit without a meal type is a 400, not a 500", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { meal } = await insertMeal(userId, {
            description: "No type edit",
            meal_type: "lunch",
            logged_at: "2026-03-01T12:00:00.000Z",
            calories: 300,
        });
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const res = await app.request(`http://test/meals/${meal.id}/edit`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "logged_time=12:00&date=2026-03-01&return_to=/",
        });
        expect(res.status).toBe(400);
        const after = await getMealById(userId, meal.id);
        expect(after?.meal_type).toBe("lunch");
    });

    test("delete then undo through HTTP on real Postgres", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const key = "test:http-undo";
        const { meal } = await insertMeal(userId, {
            description: "Db undo",
            meal_type: "dinner",
            logged_at: "2026-03-01T18:00:00.000Z",
            calories: 250,
            idempotency_key: key,
        });
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const del = await app.request(`http://test/meals/${meal.id}/delete`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(del.status).toBe(303);
        const setCookies = del.headers.getSetCookie();
        expect(setCookies.some((c) => c.startsWith(`${TOAST_COOKIE}=`))).toBe(
            true,
        );
        expect(setCookies.some((c) => c.startsWith(`${UNDO_COOKIE}=`))).toBe(
            true,
        );
        expect(
            setCookies.some((c) => c.startsWith(`${UNDO_SNAPSHOT_COOKIE}=`)),
        ).toBe(true);
        expect(await getMealById(userId, meal.id)).toBeNull();
        const cookiePairs = setCookies
            .map((line) => line.split(";")[0]!)
            .join("; ");
        const undo = await app.request("http://test/meals/undo", {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}; ${cookiePairs}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(undo.status).toBe(303);
        const { sql } = getCtx();
        const [restored] = await sql`
            select idempotency_key, calories
            from meals
            where user_id = ${userId} and idempotency_key = ${key}
        `;
        expect(restored?.idempotency_key).toBe(key);
        expect(Number(restored?.calories)).toBe(250);
        resetFlagsForTests();
    });

    test("undo restores a recipe meal whose recipe was deleted meanwhile", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { sql } = getCtx();
        const [recipe] = await sql`
            insert into recipes (household_id, creator_id, name, yield_portions)
            values (${householdId}, ${userId}, ${"Chili"}, ${4})
            returning id
        `;
        const key = "test:undo-deleted-recipe";
        const { meal } = await insertMeal(userId, {
            description: "2 portions Chili",
            meal_type: "dinner",
            logged_at: "2026-03-01T18:00:00.000Z",
            calories: 500,
            idempotency_key: key,
            items: [
                {
                    household_id: householdId,
                    food_id: null,
                    recipe_id: recipe!.id,
                    label: "Chili",
                    amount: null,
                    unit: null,
                    grams: null,
                    portions: 2,
                    calories: 500,
                    protein_g: null,
                    carbs_g: null,
                    fat_g: null,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                },
            ],
        });
        const app = new Hono();
        app.route("/", nutritionRoutes);
        const del = await app.request(`http://test/meals/${meal.id}/delete`, {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(del.status).toBe(303);
        await sql`delete from recipes where id = ${recipe!.id}`;
        const cookiePairs = del.headers
            .getSetCookie()
            .map((line) => line.split(";")[0]!)
            .join("; ");
        const undo = await app.request("http://test/meals/undo", {
            method: "POST",
            headers: {
                cookie: `${SITE_COOKIE}=${mintSiteSession(userId)}; ${cookiePairs}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "return_to=/?date=2026-03-01&date=2026-03-01",
        });
        expect(undo.status).toBe(303);
        const [restored] = await sql`
            select m.calories, i.recipe_id, i.label, i.calories as item_calories
            from meals m join meal_items i on i.meal_id = m.id
            where m.user_id = ${userId} and m.idempotency_key = ${key}
        `;
        expect(Number(restored?.calories)).toBe(500);
        expect(restored?.recipe_id).toBeNull();
        expect(restored?.label).toBe("Chili");
        expect(Number(restored?.item_calories)).toBe(500);
        resetFlagsForTests();
    });

    test("tampered undo token fails verification", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Tamper",
            meal_type: "snack",
            logged_at: "2026-03-01T15:00:00.000Z",
            idempotency_key: "test:tamper",
        });
        const full = await getMealById(userId, meal.id);
        const snapshot = mealUndoSnapshot(full!, householdId);
        const flash = mintUndoFlash(userId, snapshot, SESSION, Date.now());
        expect(
            verifyUndoToken(
                flash.token,
                `${flash.snapshotPayload}x`,
                userId,
                Date.now(),
                SESSION,
            ),
        ).toBe(false);
    });
});
