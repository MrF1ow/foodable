import { beforeAll, expect, test } from "bun:test";
import type { SQL } from "bun";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();

// Index definitions as Postgres prints them (pg_indexes.indexdef).
const EXPECTED: Record<string, string> = {
    meals_user_logged_idx:
        "ON public.meals USING btree (user_id, logged_at, id)",
    water_log_user_logged_idx:
        "ON public.water_log USING btree (user_id, logged_at, id)",
    weight_log_user_logged_idx:
        "ON public.weight_log USING btree (user_id, logged_at, id)",
    stock_movements_household_created_idx:
        "ON public.stock_movements USING btree (household_id, created_at DESC)",
    stock_movements_fridge_item_idx:
        "ON public.stock_movements USING btree (fridge_item_id)",
    meal_items_food_idx: "ON public.meal_items USING btree (food_id)",
    meal_items_recipe_idx: "ON public.meal_items USING btree (recipe_id)",
    grocery_lines_source_fridge_item_idx:
        "ON public.grocery_lines USING btree (source_fridge_item_id) WHERE (source_fridge_item_id IS NOT NULL)",
};

async function planOf(sql: SQL, query: string): Promise<string> {
    const rows = (await sql.unsafe(`explain (costs off) ${query}`)) as {
        "QUERY PLAN": string;
    }[];
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

describeDb(pgAvailable !== null, "hot query indexes", (ctx) => {
    let householdId = "";
    let userId = "";

    beforeAll(async () => {
        const { sql, truncateAll } = ctx();
        await truncateAll();
        ({ householdId, userId } = await seedHousehold(sql));
        const foodId = await seedFood(sql, householdId);
        const [location] = await sql`
            insert into public.fridge_locations (household_id, name, sort_order)
            values (${householdId}, ${"Fridge"}, 0)
            returning id
        `;
        const [item] = await sql`
            insert into public.fridge_items (
                household_id, location_id, kind, display_name, amount, unit, food_id
            )
            values (
                ${householdId}, ${location.id}, ${"food"}, ${"Item"}, 1, ${"g"}, ${foodId}
            )
            returning id
        `;
        // Enough rows that a whole-table scan stops being the cheap plan.
        await sql`
            insert into public.meals (user_id, description, meal_type, logged_at, idempotency_key)
            select ${userId}, 'm' || g, 'lunch',
                   now() - (g % 900) * interval '1 day', 'idx:' || g
            from generate_series(1, 20000) g
        `;
        await sql`
            insert into public.stock_movements (
                household_id, food_id, fridge_item_id, delta, unit, reason, created_at
            )
            select ${householdId}, ${foodId}, ${item.id}, -1, 'g', 'eat',
                   now() - g * interval '1 minute'
            from generate_series(1, 20000) g
        `;
        await sql`analyze`;
    });

    test("every index exists with its exact definition", async () => {
        const { sql } = ctx();
        const rows = (await sql`
            select indexname, indexdef from pg_indexes
            where schemaname = 'public' and indexname in ${sql(Object.keys(EXPECTED))}
        `) as { indexname: string; indexdef: string }[];
        const found = Object.fromEntries(
            rows.map((r) => [r.indexname, r.indexdef]),
        );
        for (const [name, def] of Object.entries(EXPECTED)) {
            expect(found[name] ?? `${name} missing`).toEndWith(def);
        }
    });

    test("a day of meals reads the user and time index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select * from public.meals
             where user_id = '${userId}'
               and logged_at >= now() - interval '200 days'
               and logged_at < now() - interval '199 days'
             order by logged_at`,
        );
        expect(plan).toContain("meals_user_logged_idx");
    });

    test("the stock ledger list reads its index, not the whole table", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select * from public.stock_movements
             where household_id = '${householdId}'
             order by created_at desc limit 50`,
        );
        expect(plan).toContain("stock_movements_household_created_idx");
        expect(plan).not.toContain("Seq Scan");
    });

    test("finding a fridge item's movements reads its index", async () => {
        const { sql } = ctx();
        // The same lookup the foreign-key check runs when the item goes.
        const plan = await planOf(
            sql,
            `select 1 from public.stock_movements
             where fridge_item_id = '00000000-0000-0000-0000-000000000000'`,
        );
        expect(plan).toContain("stock_movements_fridge_item_idx");
    });
});
