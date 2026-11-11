import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as nutrition from "./nutrition.js";
import {
    countMealItems,
    countMeals,
    deleteMeal,
    existingIdempotencyKeys,
    existingMealIds,
    getAllMealItems,
    getMealsByDate,
    getMealLoggedLocalDatesInRange,
    getMealsInRange,
    getMealsInRangeWithoutItems,
    getWaterLoggedLocalDatesInRange,
    insertMeal,
    insertWater,
    listMealItems,
    searchMeals,
    updateMeal,
    updatedMealIdempotencyKey,
    type MealInput,
} from "./nutrition.js";
import { describeDb } from "./testing/pg.js";
import { asUser, seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";
import { raceOnUniqueKey } from "./testing/lock-race.js";
import { setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

describeDb(pgAvailable !== null, "nutrition meals db", (getCtx) => {
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

    test("insertMeal returns full row shape", async () => {
        const { meal, deduplicated } = await insertMeal(userId, {
            description: "Oatmeal",
            meal_type: "breakfast",
            calories: 388.7,
            protein_g: 12.5,
            fat_g: 8,
            fiber_g: 4,
            sugar_g: 1,
            caffeine_mg: 95,
            notes: "with berries",
            logged_at: "2024-05-10T08:30:00+00:00",
            idempotency_key: "client:race-1",
        });
        expect(deduplicated).toBe(false);
        expect(meal).toEqual({
            id: meal.id,
            user_id: userId,
            logged_at: "2024-05-10T08:30:00+00:00",
            meal_type: "breakfast",
            description: "Oatmeal",
            calories: 389,
            protein_g: 12.5,
            carbs_g: null,
            fat_g: 8,
            fiber_g: 4,
            sugar_g: 1,
            alcohol_g: null,
            caffeine_mg: 95,
            notes: "with berries",
            idempotency_key: "client:race-1",
        });
        expect(meal.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
    });

    test("insertMeal deduplicates on idempotency_key", async () => {
        const input = {
            description: "Toast",
            meal_type: "breakfast" as const,
            idempotency_key: "dup-key",
            logged_at: "2024-05-11T09:00:00.000Z",
        };
        const first = await insertMeal(userId, input);
        const second = await insertMeal(userId, input);
        expect(first.deduplicated).toBe(false);
        expect(second.deduplicated).toBe(true);
        expect(second.meal.id).toBe(first.meal.id);
    });

    test("concurrent insertMeal with same key yields one winner", async () => {
        const { pg, sql } = getCtx();
        const key = "concurrent-meal-key";
        const loggedAt = "2024-06-01T12:00:00.000Z";
        const input = {
            description: "Race meal",
            meal_type: "snack" as const,
            idempotency_key: key,
            logged_at: loggedAt,
        };
        const [a, b] = await raceOnUniqueKey({
            url: pg.url,
            restoreSql: sql,
            blockInsert: (tx) =>
                tx`
                    insert into meals (
                        user_id,
                        description,
                        meal_type,
                        logged_at,
                        idempotency_key
                    )
                    values (
                        ${userId},
                        ${"block"},
                        ${"snack"},
                        ${loggedAt},
                        ${key}
                    )
                `,
            run: () => insertMeal(userId, input),
        });
        const flags = [a.deduplicated, b.deduplicated].sort();
        expect(flags).toEqual([false, true]);
        expect(a.meal.id).toBe(b.meal.id);
    });

    test("insertMeal with items keeps meal and items together", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Item meal",
            meal_type: "lunch",
            logged_at: "2024-05-12T12:00:00.000Z",
            items: [
                {
                    household_id: null,
                    food_id: null,
                    recipe_id: null,
                    label: "Apple",
                    amount: 1,
                    unit: "each",
                    grams: 180,
                    portions: null,
                    calories: 95,
                    protein_g: 0.5,
                    carbs_g: 25,
                    fat_g: 0.3,
                    fiber_g: 4,
                    sugar_g: 19,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                },
            ],
        });
        expect(meal.items).toHaveLength(1);
        expect(meal.items![0]!.label).toBe("Apple");
        expect(meal.items![0]!.meal_id).toBe(meal.id);
    });

    test("listMealItems orders by sort_order", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Sorted items",
            meal_type: "dinner",
            logged_at: "2024-05-13T18:00:00.000Z",
            items: [
                {
                    household_id: null,
                    food_id: null,
                    recipe_id: null,
                    label: "Second",
                    amount: null,
                    unit: null,
                    grams: null,
                    portions: null,
                    calories: null,
                    protein_g: null,
                    carbs_g: null,
                    fat_g: null,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 2,
                },
                {
                    household_id: null,
                    food_id: null,
                    recipe_id: null,
                    label: "First",
                    amount: null,
                    unit: null,
                    grams: null,
                    portions: null,
                    calories: null,
                    protein_g: null,
                    carbs_g: null,
                    fat_g: null,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 1,
                },
            ],
        });
        const items = await listMealItems(userId, [meal.id]);
        expect(items.map((i) => i.label)).toEqual(["First", "Second"]);
    });

    test("getMealsByDate uses inclusive start and exclusive end", async () => {
        await insertMeal(userId, {
            description: "Early",
            meal_type: "breakfast",
            logged_at: "2024-06-01T00:00:00.000Z",
        });
        await insertMeal(userId, {
            description: "Late",
            meal_type: "snack",
            logged_at: "2024-06-01T23:59:59.000Z",
        });
        await insertMeal(userId, {
            description: "Next day",
            meal_type: "breakfast",
            logged_at: "2024-06-02T00:00:00.000Z",
        });
        const day = await getMealsByDate(userId, "2024-06-01", "UTC");
        expect(day.map((m) => m.description).sort()).toEqual(["Early", "Late"]);
    });

    test("getMealsInRange spans days", async () => {
        await insertMeal(userId, {
            description: "A",
            meal_type: "breakfast",
            logged_at: "2024-07-01T12:00:00.000Z",
        });
        await insertMeal(userId, {
            description: "B",
            meal_type: "lunch",
            logged_at: "2024-07-02T12:00:00.000Z",
        });
        const range = await getMealsInRange(
            userId,
            "2024-07-01",
            "2024-07-02",
            "UTC",
        );
        expect(range.map((m) => m.description)).toEqual(["A", "B"]);
    });

    test("logged local dates in range without meal_items", async () => {
        await insertMeal(userId, {
            description: "A",
            meal_type: "breakfast",
            logged_at: "2024-07-01T12:00:00.000Z",
        });
        await insertMeal(userId, {
            description: "B",
            meal_type: "lunch",
            logged_at: "2024-07-01T20:00:00.000Z",
        });
        await insertMeal(userId, {
            description: "C",
            meal_type: "dinner",
            logged_at: "2024-07-02T12:00:00.000Z",
        });
        expect(
            await getMealLoggedLocalDatesInRange(
                userId,
                "2024-07-01",
                "2024-07-02",
                "UTC",
            ),
        ).toEqual(["2024-07-01", "2024-07-02"]);
        const without = await getMealsInRangeWithoutItems(
            userId,
            "2024-07-01",
            "2024-07-02",
            "UTC",
        );
        expect(without.every((m) => m.items === undefined)).toBe(true);
        await insertWater(userId, {
            amount_ml: 200,
            logged_at: "2024-07-03T12:00:00.000Z",
        });
        expect(
            await getWaterLoggedLocalDatesInRange(
                userId,
                "2024-07-01",
                "2024-07-03",
                "UTC",
            ),
        ).toEqual(["2024-07-03"]);
    });

    test("meals scoped by user_id", async () => {
        await insertMeal(userId, {
            description: "Mine",
            meal_type: "snack",
            logged_at: "2024-08-01T12:00:00.000Z",
        });
        await asUser(otherUserId, () =>
            insertMeal(otherUserId, {
                description: "Theirs",
                meal_type: "snack",
                logged_at: "2024-08-01T12:00:00.000Z",
            }),
        );
        expect(await countMeals(userId)).toBe(1);
        // Someone outside the household: invisible to its owner.
        expect(await countMeals(otherUserId)).toBe(0);
        expect(await asUser(otherUserId, () => countMeals(otherUserId))).toBe(
            1,
        );
    });

    test("existingIdempotencyKeys and existingMealIds", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Keys",
            meal_type: "snack",
            idempotency_key: "key-a",
            logged_at: "2024-08-02T12:00:00.000Z",
        });
        expect(
            await existingIdempotencyKeys(userId, ["key-a", "missing"]),
        ).toEqual(new Set(["key-a"]));
        expect(
            await existingMealIds(userId, [meal.id, "not-a-uuid", meal.id]),
        ).toEqual(new Set([meal.id.toLowerCase()]));
    });

    test("searchMeals returns item food ids from the same read", async () => {
        const { sql } = getCtx();
        const eggs = await seedFood(sql, householdId, { name: "Eggs" });
        const toast = await seedFood(sql, householdId, { name: "Toast" });
        const item = (food_id: string, label: string) => ({
            household_id: householdId,
            food_id,
            recipe_id: null,
            label,
            amount: 1,
            unit: "each",
            grams: 50,
            portions: null,
            calories: 100,
            protein_g: 10,
            carbs_g: 1,
            fat_g: 5,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
            caffeine_mg: null,
            sort_order: 0,
        });
        const { meal: backed } = await insertMeal(userId, {
            description: "Eggs and toast",
            meal_type: "breakfast",
            logged_at: "2024-09-10T08:00:00.000Z",
            items: [item(eggs, "Eggs"), item(toast, "Toast")],
        });
        const { meal: plain } = await insertMeal(userId, {
            description: "Just eggs",
            meal_type: "breakfast",
            logged_at: "2024-09-09T08:00:00.000Z",
        });
        const hits = await searchMeals(userId, ["eggs"]);
        const foundBacked = hits.find((m) => m.id === backed.id);
        const foundPlain = hits.find((m) => m.id === plain.id);
        expect(foundBacked?.items?.map((i) => i.food_id).sort()).toEqual(
            [eggs, toast].sort(),
        );
        expect(foundPlain?.items).toEqual([]);
    });

    test("searchMeals matches ilike metacharacters literally", async () => {
        await insertMeal(userId, {
            description: "100%_real\\food",
            meal_type: "snack",
            logged_at: "2024-09-01T12:00:00.000Z",
        });
        await insertMeal(userId, {
            description: "100X real food",
            meal_type: "snack",
            logged_at: "2024-09-01T13:00:00.000Z",
        });
        const hits = await searchMeals(userId, ["100%_real\\food"]);
        expect(hits.map((m) => m.description)).toEqual(["100%_real\\food"]);
    });

    test("deleteMeal false for unknown or other user", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Delete me",
            meal_type: "snack",
            logged_at: "2024-09-02T12:00:00.000Z",
        });
        expect(await deleteMeal(userId, crypto.randomUUID())).toBe(false);
        expect(await deleteMeal(otherUserId, meal.id)).toBe(false);
        expect(await deleteMeal(userId, meal.id)).toBe(true);
    });

    test("updateMeal not found", async () => {
        const err = await updateMeal(userId, crypto.randomUUID(), {
            notes: "nope",
        }).then(
            () => null,
            (e: unknown) => e,
        );
        expect((err as Error).message).toBe(
            "Failed to update meal: meal not found",
        );
    });

    test("updateMeal recomputes auto idempotency key and respects fields", async () => {
        const { meal: created } = await insertMeal(userId, {
            description: "Before",
            meal_type: "lunch",
            logged_at: "2024-10-01T12:00:00.000Z",
        });
        expect(created.idempotency_key?.startsWith("auto:")).toBe(true);

        const withKey = await updateMeal(userId, created.id, {
            calories: 500,
        });
        expect(withKey.idempotency_key).toBe(
            updatedMealIdempotencyKey(userId, created, { calories: 500 }),
        );

        const withNotes = await updateMeal(userId, created.id, {
            notes: "keep-me",
        });
        const caloriesOnly = await updateMeal(userId, withNotes.id, {
            protein_g: 20,
        });
        expect(caloriesOnly.notes).toBe("keep-me");

        const cleared = await updateMeal(userId, caloriesOnly.id, {
            notes: null,
        } as unknown as Partial<MealInput>);
        expect(cleared.notes).toBeNull();
    });

    test("updateMeal writes null calories", async () => {
        const { meal } = await insertMeal(userId, {
            description: "Known cals",
            meal_type: "lunch",
            logged_at: "2024-10-03T12:00:00.000Z",
            calories: 100,
        });
        const updated = await updateMeal(userId, meal.id, { calories: null });
        expect(updated.calories).toBeNull();
    });

    test("updateMeal replaces items", async () => {
        const { meal: created } = await insertMeal(userId, {
            description: "Items",
            meal_type: "dinner",
            logged_at: "2024-10-02T18:00:00.000Z",
            items: [
                {
                    household_id: null,
                    food_id: null,
                    recipe_id: null,
                    label: "Old",
                    amount: null,
                    unit: null,
                    grams: null,
                    portions: null,
                    calories: null,
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
        const updated = await updateMeal(userId, created.id, {
            items: [
                {
                    household_id: null,
                    food_id: null,
                    recipe_id: null,
                    label: "New",
                    amount: null,
                    unit: null,
                    grams: null,
                    portions: null,
                    calories: null,
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
        expect(updated.items).toHaveLength(1);
        expect(updated.items![0]!.label).toBe("New");
    });

    test("getAllMealItems crosses page boundary with sort_order tie-breaker", async () => {
        const { sql } = getCtx();
        const [meal] = await sql`
            insert into meals (user_id, description, meal_type, logged_at, idempotency_key)
            values (
                ${userId},
                ${"bulk-meal"},
                ${"snack"},
                ${"2024-01-01T12:00:00.000Z"},
                ${"bulk-meal-anchor"}
            )
            returning id
        `;
        await sql`
            insert into meal_items (meal_id, user_id, label, sort_order)
            select ${meal.id}, ${userId}, 'item', 0
            from generate_series(1, 1001) as g
        `;
        expect(await countMealItems(userId)).toBe(1001);
        const expected = await sql`
            select id::text as id
            from meal_items
            where user_id = ${userId}
            order by meal_id asc, sort_order asc, id asc
        `;
        const all = await getAllMealItems(userId);
        expect(all).toHaveLength(1001);
        const ids = all.map((i) => i.id);
        expect(ids).toEqual(expected.map((r: { id: string }) => r.id));
        expect(new Set(ids).size).toBe(1001);
    });

    test("getAllMealItems truncation guard message", async () => {
        const { sql } = getCtx();
        const [meal] = await sql`
            insert into meals (user_id, description, meal_type, logged_at, idempotency_key)
            values (
                ${userId},
                ${"guard"},
                ${"snack"},
                ${"2024-03-04T12:00:00.000Z"},
                ${"guard-meal"}
            )
            returning id
        `;
        await sql`
            insert into meal_items (meal_id, user_id, label, sort_order)
            values (${meal.id}, ${userId}, ${"one"}, ${0})
        `;
        const countSpy = spyOn(nutrition, "countMealItems").mockResolvedValue(
            2,
        );
        try {
            const err = await getAllMealItems(userId).then(
                () => null,
                (e: unknown) => e,
            );
            expect((err as Error).message).toBe(
                "getAllMealItems: fetched 1 items but countMealItems reported 2 — export would be truncated",
            );
        } finally {
            countSpy.mockRestore();
        }
    });
});
