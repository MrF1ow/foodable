import { beforeAll, expect, test } from "bun:test";
import type { SQL } from "bun";
import { GROCERY_LINE_COLS } from "./grocery.js";
import { PLAN_COLS, PLAN_ORDER } from "./plans.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import {
    seedHouseholdReadsBench,
    type HouseholdReadsBench,
} from "./testing/household-reads-bench.js";
import { findPgBin } from "./testing/pg-temp.js";

const FRIDGE_ITEM_COLS =
    "id, household_id, location_id, kind, display_name, amount, unit, food_id, purchased_on, opened_on, expires_on";
const RECIPE_COLS =
    "id, household_id, creator_id, name, yield_portions, instructions, source_url, tags, notes, prep_minutes, cook_minutes, verification, updated_at";
const RECIPE_INGREDIENT_COLS =
    "id, household_id, recipe_id, kind, display_name, amount, unit, food_id, sort_order, note";
const FOOD_LIST_COLS =
    "id, household_id, kind, name, normalized_name, brand, archived_at";

const pgAvailable = await findPgBin();

// foods_household_idx and the unique foods_household_name_uniq lead with the
// same columns under the same predicate and take the same pages, so their
// plans cost the same to within a page. Which one the planner names depends on
// how the pages happened to fill, and a household read is right with either.
const FOODS_HOUSEHOLD_INDEXES = [
    "foods_household_idx",
    "foods_household_name_uniq",
] as const;

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
    fridge_items_household_location_idx:
        "ON public.fridge_items USING btree (household_id, location_id)",
    grocery_lines_household_store_idx:
        "ON public.grocery_lines USING btree (household_id, store_id, section_id)",
    recipes_household_idx: "ON public.recipes USING btree (household_id, name)",
    recipe_ingredients_recipe_idx:
        "ON public.recipe_ingredients USING btree (household_id, recipe_id, sort_order)",
    foods_household_idx:
        "ON public.foods USING btree (household_id, kind, normalized_name) WHERE (archived_at IS NULL)",
    grocery_sections_household_id_idx:
        "ON public.grocery_sections USING btree (household_id)",
    store_rules_household_id_idx:
        "ON public.store_rules USING btree (household_id)",
    meal_items_household_id_idx:
        "ON public.meal_items USING btree (household_id)",
    household_members_user_id_idx:
        "ON public.household_members USING btree (user_id)",
    household_members_one_household_per_user:
        "ON public.household_members USING btree (user_id)",
    household_invites_household_id_idx:
        "ON public.household_invites USING btree (household_id)",
    recipe_favourites_household_user_idx:
        "ON public.recipe_favourites USING btree (household_id, user_id)",
    recipe_favourites_recipe_id_idx:
        "ON public.recipe_favourites USING btree (recipe_id)",
    share_links_household_id_idx:
        "ON public.share_links USING btree (household_id, created_at DESC)",
    member_score_settings_household_id_idx:
        "ON public.member_score_settings USING btree (household_id)",
    recipe_plans_household_date_idx:
        "ON public.recipe_plans USING btree (household_id, date)",
    recipe_plans_recipe_id_idx:
        "ON public.recipe_plans USING btree (recipe_id)",
    nutrition_goal_days_user_id_idx:
        "ON public.nutrition_goal_days USING btree (user_id, date)",
};

async function planOf(
    sql: SQL,
    query: string,
    sessionSql?: string[],
): Promise<string> {
    for (const stmt of sessionSql ?? []) {
        await sql.unsafe(stmt);
    }
    const rows = (await sql.unsafe(`explain (costs off) ${query}`)) as {
        "QUERY PLAN": string;
    }[];
    if (sessionSql?.length) {
        await sql.unsafe("reset all");
    }
    return rows.map((r) => r["QUERY PLAN"]).join("\n");
}

function expectIndexOnTable(
    plan: string,
    indexName: string | readonly string[],
    table: string,
) {
    const names = typeof indexName === "string" ? [indexName] : indexName;
    expect(names.some((name) => plan.includes(name))).toBe(true);
    expect(plan).toMatch(/Index Scan|Index Only Scan|Bitmap Index Scan/);
    expect(plan).not.toContain(`Seq Scan on ${table}`);
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

    // Mirrors takeSlot in src/db/rate-limits.ts, the one statement every
    // request runs: the window sum and the upsert both use the primary key.
    test("rate limit window check reads and writes through the bucket primary key", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `with slot as (
                 select
                     t,
                     date_trunc('second', t) as cur,
                     t - make_interval(secs => 60::float8) as cutoff
                 from (select now() as t) clock
             ),
             others as (
                 select
                     coalesce(sum(b.count), 0)::int as n,
                     min(b.window_start) as oldest
                 from public.rate_limit_buckets b, slot
                 where b.key = 'plan-key'
                     and b.window_start > slot.cutoff
                     and b.window_start < slot.cur
             ),
             taken as (
                 insert into public.rate_limit_buckets as b (
                     key, window_start, count
                 )
                 select 'plan-key', slot.cur, 1
                 from slot, others
                 where others.n < 60
                 on conflict (key, window_start) do update
                 set count = b.count + 1
                 where b.count + (select n from others) < 60
                 returning b.count
             )
             select (select count from taken) as taken, others.n
             from slot, others`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "rate_limit_buckets_pkey",
            "rate_limit_buckets",
        );
        expect(plan).toContain(
            "Conflict Arbiter Indexes: rate_limit_buckets_pkey",
        );
    });

    test("ban reads use the auth_bans primary key", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select a.strikes
             from (select now() as t) clock
             left join public.auth_bans a on a.ip_key = 'plan-ip'`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(plan, "auth_bans_pkey", "auth_bans");
    });
});

describeDb(pgAvailable !== null, "household page reads", (ctx) => {
    let bench: HouseholdReadsBench;

    beforeAll(async () => {
        const { sql, truncateAll } = ctx();
        await truncateAll();
        bench = await seedHouseholdReadsBench(sql);
        await sql`analyze`;
    });

    test("the fridge list reads the household location index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${FRIDGE_ITEM_COLS}
             from public.fridge_items
             where household_id = '${bench.householdId}'
             order by created_at asc`,
        );
        expectIndexOnTable(
            plan,
            "fridge_items_household_location_idx",
            "public.fridge_items",
        );
    });

    test("the grocery list reads the household store index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${GROCERY_LINE_COLS}
             from public.grocery_lines
             where household_id = '${bench.householdId}'
             order by created_at asc`,
        );
        expectIndexOnTable(
            plan,
            "grocery_lines_household_store_idx",
            "public.grocery_lines",
        );
    });

    test("the recipe list reads the household name index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${RECIPE_COLS}
             from public.recipes
             where household_id = '${bench.householdId}'
             order by name asc`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(plan, "recipes_household_idx", "public.recipes");
    });

    test("the recipe page ingredient list reads its recipe index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${RECIPE_INGREDIENT_COLS}
             from public.recipe_ingredients
             where household_id = '${bench.householdId}'
               and recipe_id = '${bench.recipeId}'
             order by sort_order asc`,
        );
        expectIndexOnTable(
            plan,
            "recipe_ingredients_recipe_idx",
            "public.recipe_ingredients",
        );
    });

    test("the food catalog list behind search reads the household name index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${FOOD_LIST_COLS}
             from public.foods
             where household_id = '${bench.householdId}'
               and archived_at is null
             order by name asc`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(plan, FOODS_HOUSEHOLD_INDEXES, "public.foods");
    });

    test("the food catalog read passes when the planner names the twin index", async () => {
        const { sql } = ctx();
        // Take the usual pick away and the planner names the other one; the
        // assertion has to hold for that plan too, or it flakes on page layout.
        await sql.unsafe("begin");
        try {
            await sql.unsafe("drop index public.foods_household_idx");
            const plan = await planOf(
                sql,
                `select ${FOOD_LIST_COLS}
                 from public.foods
                 where household_id = '${bench.householdId}'
                   and archived_at is null
                 order by name asc`,
                ["set enable_seqscan = off"],
            );
            expect(plan).toContain("foods_household_name_uniq");
            expectIndexOnTable(plan, FOODS_HOUSEHOLD_INDEXES, "public.foods");
            expect(() =>
                expectIndexOnTable(plan, "foods_household_idx", "public.foods"),
            ).toThrow();
        } finally {
            await sql.unsafe("rollback");
        }
    });

    test("normalized food name lookup reads the household name index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${FOOD_LIST_COLS}
             from public.foods
             where household_id = '${bench.householdId}'
               and kind = 'food'
               and normalized_name = '${bench.targetNormalizedName}'
               and archived_at is null
             order by (brand is null) desc, created_at asc, id asc
             limit 1`,
        );
        expectIndexOnTable(plan, FOODS_HOUSEHOLD_INDEXES, "public.foods");
    });

    test("grocery sections for a household read the household index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select id, household_id, store_id, name, sort_order, hidden, is_other
             from public.grocery_sections
             where household_id = '${bench.householdId}'
             order by sort_order asc, name asc`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "grocery_sections_household_id_idx",
            "public.grocery_sections",
        );
    });

    test("store rules for a household read the household index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select id, household_id, store_id, body, sort_order
             from public.store_rules
             where household_id = '${bench.householdId}'
             order by sort_order asc`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "store_rules_household_id_idx",
            "public.store_rules",
        );
    });

    test("meal items scoped to a household read the household index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select id, meal_id, user_id, household_id, label, sort_order
             from public.meal_items
             where household_id = '${bench.householdId}'
             order by sort_order asc
             limit 100`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "meal_items_household_id_idx",
            "public.meal_items",
        );
    });

    test("membership lookup by user reads the user index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select household_id, user_id, role, display_name
             from public.household_members
             where user_id = '${bench.userId}'`,
            ["set enable_seqscan = off"],
        );
        // Two indexes cover user_id since one household per person became a
        // unique index; the planner may read either.
        expect(plan).toMatch(
            /household_members_(user_id_idx|one_household_per_user)/,
        );
        expect(plan).toMatch(/Index Scan|Index Only Scan|Bitmap Index Scan/);
        expect(plan).not.toContain("Seq Scan on public.household_members");
    });

    test("per-day goal overrides read the user and date index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select *
             from public.nutrition_goal_days
             where user_id = '${bench.userId}'
               and date between current_date - 365 and current_date
             order by date`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "nutrition_goal_days_user_id_idx",
            "public.nutrition_goal_days",
        );
    });

    test("a week of plans reads the household and date index", async () => {
        const { sql } = ctx();
        const plan = await planOf(
            sql,
            `select ${PLAN_COLS}
             from public.recipe_plans
             where household_id = '${bench.householdId}'
               and date between '2026-11-09'::date and '2026-11-15'::date
             order by ${PLAN_ORDER}`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "recipe_plans_household_date_idx",
            "public.recipe_plans",
        );
    });

    test("deleting a recipe finds its plans through the recipe index", async () => {
        const { sql } = ctx();
        // The same lookup the foreign-key check runs when the recipe goes.
        const plan = await planOf(
            sql,
            `select 1 from public.recipe_plans
             where recipe_id = '00000000-0000-0000-0000-000000000000'`,
            ["set enable_seqscan = off"],
        );
        expectIndexOnTable(
            plan,
            "recipe_plans_recipe_id_idx",
            "public.recipe_plans",
        );
    });
});
