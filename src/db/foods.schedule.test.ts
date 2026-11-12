import { afterEach, expect, test } from "bun:test";
import {
    markUsualRestocked,
    NO_USUAL_SCHEDULE,
    setUsualPurchase,
    setUsualSchedule,
    updateFood,
} from "../domain/foods.js";
import { liveFoodsStore } from "./foods.js";
import { sampleFood } from "./contract/helpers.js";
import { setSqlForTests } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import {
    seedFood,
    seedGroceryStore,
    seedHousehold,
} from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

/** The text of the error a statement fails with, or null if it succeeds. */
async function failure(
    statement: PromiseLike<unknown>,
): Promise<string | null> {
    try {
        await statement;
        return null;
    } catch (err) {
        const e = err as { message?: string; constraint?: string };
        return `${e.constraint ?? ""} ${e.message ?? String(err)}`;
    }
}

describeDb(pgAvailable !== null, "foods restock schedule columns", (getCtx) => {
    afterEach(() => setSqlForTests(null));

    async function setup() {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const { householdId } = await seedHousehold(sql);
        return { sql, householdId, store: liveFoodsStore() };
    }

    test("a food inserted without the columns reads as no schedule", async () => {
        const { sql, householdId, store } = await setup();
        const id = await seedFood(sql, householdId, { name: "Milk" });
        const food = await store.getFood(householdId, id);
        expect(food).not.toBeNull();
        expect({
            restockSchedule: food!.restockSchedule,
            restockEveryWeeks: food!.restockEveryWeeks,
            restockPaused: food!.restockPaused,
            restockWhenLow: food!.restockWhenLow,
            restockLowLevel: food!.restockLowLevel,
            lastRestockedOn: food!.lastRestockedOn,
        }).toEqual(NO_USUAL_SCHEDULE);
        const [row] = await sql`
                select restock_paused, restock_when_low
                from public.foods where id = ${id}
            `;
        expect(row.restock_paused).toBe(false);
        expect(row.restock_when_low).toBe(false);
    });

    test("the columns have the shapes the domain reads", async () => {
        const { sql } = await setup();
        const cols = await sql`
                select column_name, data_type, is_nullable, column_default
                from information_schema.columns
                where table_schema = 'public' and table_name = 'foods'
                  and (column_name like 'restock%' or column_name = 'last_restocked_on')
                order by column_name
            `;
        const byName = Object.fromEntries(
            cols.map((c: Record<string, string>) => [c.column_name, c]),
        );
        expect(byName.restock_schedule.data_type).toBe("text");
        expect(byName.restock_every_weeks.data_type).toBe("integer");
        expect(byName.restock_low_level.data_type).toBe("numeric");
        expect(byName.last_restocked_on.data_type).toBe("date");
        expect(byName.restock_paused.data_type).toBe("boolean");
        expect(byName.restock_paused.is_nullable).toBe("NO");
        expect(byName.restock_paused.column_default).toBe("false");
        expect(byName.restock_when_low.is_nullable).toBe("NO");
        expect(byName.restock_when_low.column_default).toBe("false");
        for (const nullable of [
            "restock_schedule",
            "restock_every_weeks",
            "restock_low_level",
            "last_restocked_on",
        ]) {
            expect(byName[nullable].is_nullable).toBe("YES");
        }
    });

    test("every field round trips, and a date comes back as plain text", async () => {
        const { sql, householdId, store } = await setup();
        const food = sampleFood(householdId, {
            name: "Eggs",
            normalizedName: "eggs",
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 3,
            restockPaused: true,
            restockWhenLow: true,
            restockLowLevel: 6.5,
            lastRestockedOn: "2026-11-02",
        });
        await store.insertFood(food);
        const read = await store.getFood(householdId, food.id);
        expect(read?.restockSchedule).toBe("every_n_weeks");
        expect(read?.restockEveryWeeks).toBe(3);
        expect(read?.restockPaused).toBe(true);
        expect(read?.restockWhenLow).toBe(true);
        expect(read?.restockLowLevel).toBe(6.5);
        expect(read?.lastRestockedOn).toBe("2026-11-02");
        expect(typeof read?.lastRestockedOn).toBe("string");
        const [row] = await sql`
                select restock_schedule, restock_every_weeks,
                       restock_paused, restock_when_low,
                       restock_low_level::text as low_level,
                       last_restocked_on::text as restocked_on
                from public.foods where id = ${food.id}
            `;
        expect(row.restock_schedule).toBe("every_n_weeks");
        expect(row.restock_every_weeks).toBe(3);
        expect(row.restock_paused).toBe(true);
        expect(row.restock_when_low).toBe(true);
        expect(row.low_level).toBe("6.5");
        expect(row.restocked_on).toBe("2026-11-02");

        const cleared = await store.updateFoodRow({
            ...read!,
            ...NO_USUAL_SCHEDULE,
        });
        expect(cleared?.restockSchedule).toBeNull();
        expect(cleared?.restockEveryWeeks).toBeNull();
        expect(cleared?.restockPaused).toBe(false);
        expect(cleared?.restockLowLevel).toBeNull();
        expect(cleared?.lastRestockedOn).toBeNull();
    });

    test("a zero low level is kept, not read as unset", async () => {
        const { householdId, store } = await setup();
        const food = await store.insertFood(
            sampleFood(householdId, {
                name: "Salt",
                normalizedName: "salt",
                restockLowLevel: 0,
            }),
        );
        expect(
            (await store.getFood(householdId, food.id))?.restockLowLevel,
        ).toBe(0);
    });

    test("the check constraints reject inconsistent schedules", async () => {
        const { sql, householdId } = await setup();
        const id = await seedFood(sql, householdId, { name: "Milk" });
        const cases: [string, Promise<unknown>, string][] = [
            [
                "unknown schedule",
                sql`update public.foods set restock_schedule = 'daily' where id = ${id}`,
                "foods_restock_schedule_check",
            ],
            [
                "zero weeks",
                sql`update public.foods set restock_schedule = 'every_n_weeks', restock_every_weeks = 0 where id = ${id}`,
                "foods_restock_every_weeks_check",
            ],
            [
                "negative weeks",
                sql`update public.foods set restock_schedule = 'every_n_weeks', restock_every_weeks = -2 where id = ${id}`,
                "foods_restock_every_weeks_check",
            ],
            [
                "every N weeks without N",
                sql`update public.foods set restock_schedule = 'every_n_weeks' where id = ${id}`,
                "foods_restock_every_weeks_pair",
            ],
            [
                "weekly with N",
                sql`update public.foods set restock_schedule = 'weekly', restock_every_weeks = 2 where id = ${id}`,
                "foods_restock_every_weeks_pair",
            ],
            [
                "monthly with N",
                sql`update public.foods set restock_schedule = 'monthly', restock_every_weeks = 2 where id = ${id}`,
                "foods_restock_every_weeks_pair",
            ],
            [
                "N without a schedule",
                sql`update public.foods set restock_every_weeks = 2 where id = ${id}`,
                "foods_restock_every_weeks_pair",
            ],
            [
                "negative low level",
                sql`update public.foods set restock_low_level = -1 where id = ${id}`,
                "foods_restock_low_level_check",
            ],
            [
                "null paused",
                sql`update public.foods set restock_paused = null where id = ${id}`,
                "restock_paused",
            ],
            [
                "null add when low",
                sql`update public.foods set restock_when_low = null where id = ${id}`,
                "restock_when_low",
            ],
        ];
        for (const [label, statement, constraint] of cases) {
            const message = await failure(statement);
            expect(message, label).not.toBeNull();
            expect(message, label).toContain(constraint);
        }
        const [row] = await sql`
                select restock_schedule, restock_every_weeks, restock_low_level
                from public.foods where id = ${id}
            `;
        expect(row.restock_schedule).toBeNull();
        expect(row.restock_every_weeks).toBeNull();
        expect(row.restock_low_level).toBeNull();
    });

    test("the check constraints accept every consistent schedule", async () => {
        const { sql, householdId } = await setup();
        const id = await seedFood(sql, householdId, { name: "Milk" });
        const statements = [
            sql`update public.foods set restock_schedule = 'weekly', restock_every_weeks = null where id = ${id}`,
            sql`update public.foods set restock_schedule = 'monthly' where id = ${id}`,
            sql`update public.foods set restock_schedule = 'every_n_weeks', restock_every_weeks = 6 where id = ${id}`,
            sql`update public.foods set restock_schedule = null, restock_every_weeks = null where id = ${id}`,
            sql`update public.foods set restock_low_level = 0 where id = ${id}`,
            sql`update public.foods set last_restocked_on = '2026-11-09', restock_paused = true where id = ${id}`,
        ];
        for (const statement of statements) {
            expect(await failure(statement)).toBeNull();
        }
    });

    test("the store refuses an inconsistent record instead of writing it", async () => {
        const { householdId, store } = await setup();
        const food = await store.insertFood(
            sampleFood(householdId, { name: "Milk", normalizedName: "milk" }),
        );
        await expect(
            store.updateFoodRow({
                ...food,
                restockSchedule: "weekly",
                restockEveryWeeks: 2,
            }),
        ).rejects.toThrow();
        const after = await store.getFood(householdId, food.id);
        expect(after?.restockSchedule).toBeNull();
    });

    test("writes through the domain keep the schedule in Postgres", async () => {
        const { sql, householdId, store } = await setup();
        const storeId = await seedGroceryStore(sql, householdId, "Costco");
        const lookup = { listStores: async () => [{ id: storeId }] };
        const food = await store.insertFood(
            sampleFood(householdId, { name: "Eggs", normalizedName: "eggs" }),
        );
        await setUsualSchedule(store, householdId, food.id, {
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 2,
            restockWhenLow: true,
            restockLowLevel: 6,
        });
        await markUsualRestocked(store, householdId, food.id, "2026-11-09");
        const expected = {
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 2,
            restockPaused: false,
            restockWhenLow: true,
            restockLowLevel: 6,
            lastRestockedOn: "2026-11-09",
        };

        const purchase = await setUsualPurchase(
            store,
            householdId,
            food.id,
            {
                usualStoreId: storeId,
                usualAmount: { amount: 24, unit: "each" },
            },
            { stores: lookup },
        );
        expect(purchase.usualStoreId).toBe(storeId);
        expect(purchase).toMatchObject(expected);

        const renamed = await updateFood(
            store,
            householdId,
            food.id,
            { name: "Free range eggs" },
            { stores: lookup },
        );
        expect(renamed).toMatchObject(expected);

        const read = await store.getFood(householdId, food.id);
        expect(read).toMatchObject(expected);
        expect(read?.usualAmount).toEqual({ amount: 24, unit: "each" });
    });
});
