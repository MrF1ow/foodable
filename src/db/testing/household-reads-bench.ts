import type { SQL } from "bun";
import {
    seedFood,
    seedFridgeLocation,
    seedGrocerySection,
    seedGroceryStore,
    seedHousehold,
} from "./fixtures.js";

export type HouseholdReadsBench = {
    householdId: string;
    userId: string;
    locationId: string;
    storeId: string;
    sectionId: string;
    recipeId: string;
    targetFoodId: string;
    targetNormalizedName: string;
};

async function insertLinesWithFoods(
    sql: SQL,
    householdId: string,
    table: "fridge_items" | "grocery_lines",
    rowCount: number,
    extraValuesSql: string,
): Promise<void> {
    const cols =
        table === "fridge_items"
            ? "household_id, location_id, kind, display_name, amount, unit, food_id"
            : "household_id, store_id, section_id, kind, display_name, amount, unit, food_id";
    await sql.unsafe(`
        insert into public.${table} (${cols})
        with numbered_foods as (
            select id, row_number() over (order by normalized_name) as rn
            from public.foods
            where household_id = '${householdId}'::uuid
        ),
        food_count as (
            select greatest(count(*)::int, 1) as c from numbered_foods
        )
        select '${householdId}'::uuid,
               ${extraValuesSql},
               'food',
               'row' || g,
               1,
               'g',
               nf.id
        from generate_series(1, ${rowCount}) g
        cross join food_count fc
        join numbered_foods nf on nf.rn = ((g - 1) % fc.c) + 1
    `);
}

async function seedDecoyHousehold(sql: SQL, creatorId: string): Promise<void> {
    const { householdId } = await seedHousehold(sql);
    const locationId = await seedFridgeLocation(sql, householdId, "Decoy");
    const storeId = await seedGroceryStore(sql, householdId, "Decoy store");
    const sectionId = await seedGrocerySection(
        sql,
        householdId,
        storeId,
        "Decoy section",
    );
    await seedFood(sql, householdId, { name: "decoy-base" });
    await sql`
        insert into public.foods (household_id, kind, name, normalized_name, default_unit, allergens)
        select ${householdId}, 'food', 'f' || g, 'f' || g, 'g', '{}'::text[]
        from generate_series(1, 1200) g
    `;
    await insertLinesWithFoods(
        sql,
        householdId,
        "fridge_items",
        2500,
        `'${locationId}'::uuid`,
    );
    await insertLinesWithFoods(
        sql,
        householdId,
        "grocery_lines",
        2500,
        `'${storeId}'::uuid, '${sectionId}'::uuid`,
    );
    await sql`
        insert into public.grocery_sections (
            household_id, store_id, name, sort_order, hidden, is_other
        )
        select ${householdId}, ${storeId}, 'sec' || g, g, false, false
        from generate_series(1, 400) g
    `;
    await sql`
        insert into public.store_rules (household_id, store_id, body, sort_order)
        select ${householdId}, ${storeId}, 'rule' || g, g
        from generate_series(1, 400) g
    `;
    await sql`
        insert into public.recipes (household_id, creator_id, name, yield_portions, source_url)
        select ${householdId}, ${creatorId}, 'recipe' || g, 2, 'https://bench.example/r/' || g
        from generate_series(1, 900) g
    `;
}

/** Large catalog across households so household_id filters prefer btree indexes. */
export async function seedHouseholdReadsBench(
    sql: SQL,
): Promise<HouseholdReadsBench> {
    await sql.unsafe("drop index if exists public.households_singleton");
    await sql.unsafe(
        "drop index if exists public.recipes_household_source_url_idx",
    );
    const target = await seedHousehold(sql);
    const locationId = await seedFridgeLocation(sql, target.householdId);
    const storeId = await seedGroceryStore(sql, target.householdId);
    const sectionId = await seedGrocerySection(
        sql,
        target.householdId,
        storeId,
    );
    const targetFoodId = await seedFood(sql, target.householdId, {
        name: "Target search food",
        normalizedName: "target search food",
    });

    for (let h = 0; h < 4; h++) {
        await seedDecoyHousehold(sql, target.userId);
    }

    await sql`
        insert into public.foods (household_id, kind, name, normalized_name, default_unit, allergens)
        select ${target.householdId}, 'food', 'food' || g, 'food' || g, 'g', '{}'::text[]
        from generate_series(1, 4000) g
    `;
    await insertLinesWithFoods(
        sql,
        target.householdId,
        "fridge_items",
        3000,
        `'${locationId}'::uuid`,
    );
    await insertLinesWithFoods(
        sql,
        target.householdId,
        "grocery_lines",
        3000,
        `'${storeId}'::uuid, '${sectionId}'::uuid`,
    );
    await sql`
        insert into public.grocery_sections (
            household_id, store_id, name, sort_order, hidden, is_other
        )
        select ${target.householdId}, ${storeId}, 'tsec' || g, g, false, false
        from generate_series(1, 500) g
    `;
    await sql`
        insert into public.store_rules (household_id, store_id, body, sort_order)
        select ${target.householdId}, ${storeId}, 'trule' || g, g
        from generate_series(1, 500) g
    `;

    const [meal] = await sql`
        insert into public.meals (user_id, description, meal_type, logged_at, idempotency_key)
        values (${target.userId}, 'bench meal', 'lunch', now(), ${"bench:meal:household-items"})
        returning id
    `;
    await sql`
        insert into public.meal_items (
            meal_id, user_id, household_id, label, sort_order
        )
        select ${meal.id}, ${target.userId}, ${target.householdId}, 'item' || g, g
        from generate_series(1, 2500) g
    `;
    await sql`
        insert into public.nutrition_goal_days (household_id, user_id, date, daily_calories)
        select ${target.householdId}, ${target.userId}, (current_date - g), 2000
        from generate_series(0, 800) g
    `;

    const [recipe] = await sql`
        insert into public.recipes (household_id, creator_id, name, yield_portions)
        values (${target.householdId}, ${target.userId}, ${"Bench recipe"}, 4)
        returning id
    `;
    const recipeId = String(recipe.id);

    await sql`
        insert into public.recipes (household_id, creator_id, name, yield_portions)
        select ${target.householdId}, ${target.userId}, 'trecipe' || g, 2
        from generate_series(1, 800) g
    `;
    await sql`
        insert into public.recipe_ingredients (
            household_id, recipe_id, kind, display_name, amount, unit, food_id, sort_order
        )
        select ${target.householdId}, ${recipeId}::uuid, 'food', 'ing' || g, 1, 'g', ${targetFoodId}::uuid, g
        from generate_series(1, 40) g
    `;
    await sql`
        insert into public.recipe_ingredients (
            household_id, recipe_id, kind, display_name, amount, unit, food_id, sort_order
        )
        select r.household_id, r.id, 'food', 'x' || g, 1, 'g', ${targetFoodId}::uuid, g
        from public.recipes r
        cross join generate_series(1, 8) g
        where r.household_id = ${target.householdId}
          and r.id <> ${recipeId}::uuid
    `;

    return {
        householdId: target.householdId,
        userId: target.userId,
        locationId,
        storeId,
        sectionId,
        recipeId,
        targetFoodId,
        targetNormalizedName: "target search food",
    };
}
