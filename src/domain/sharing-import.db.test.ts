// Importing a shared recipe against real Postgres: the recipe, its new foods
// and its ingredients land in the importing household only, a food that
// household already has is left exactly as it was, and a failure part-way
// leaves nothing behind. The in-memory stores cannot show the last two
// (row level security, a transaction that rolls back).
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { SQL } from "bun";
import { liveFoodsStore } from "../db/foods.js";
import { liveRecipesStore } from "../db/recipes.js";
import { run, setSqlForTests } from "../db/sql.js";
import { asUser, seedHousehold } from "../db/testing/fixtures.js";
import { describeDb } from "../db/testing/pg.js";
import { findPgBin } from "../db/testing/pg-temp.js";
import { newFood } from "./foods.js";
import { createRecipe, type RecipesStore } from "./recipes.js";
import {
    parseShareDocument,
    recipeShareDocument,
    type ShareDocument,
} from "./sharing-document.js";
import { importSharedRecipe } from "./sharing-import.js";

const pgAvailable = await findPgBin();

const transaction = <T>(fn: () => Promise<T>) => run(async () => fn());

describeDb(pgAvailable !== null, "importing a shared recipe", (getCtx) => {
    let sql: SQL;
    let sharer: { userId: string; householdId: string };
    let importer: { userId: string; householdId: string };
    let document: ShareDocument;

    beforeEach(async () => {
        const ctx = getCtx();
        sql = ctx.sql;
        await ctx.truncateAll();
        setSqlForTests(sql);
        sharer = await seedHousehold(sql);
        importer = await seedHousehold(sql);

        // The sharing household: lentils with a brand, eggs with a unit
        // factor, and a recipe using both plus an unmeasured line.
        document = await asUser(
            sharer.userId,
            async () => {
                const foods = liveFoodsStore();
                const recipes = liveRecipesStore();
                const lentils = await foods.insertFood(
                    newFood({
                        householdId: sharer.householdId,
                        kind: "food",
                        name: "Red lentils",
                        brand: "Sharer brand",
                        calories: 352,
                        proteinG: 24.6,
                        carbsG: 63,
                        fatG: 1.1,
                        fiberG: 10.7,
                        gramsPerMl: 0.85,
                    }),
                );
                const egg = await foods.insertFood(
                    newFood({
                        householdId: sharer.householdId,
                        kind: "food",
                        name: "Egg",
                        calories: 143,
                        proteinG: 12.6,
                        carbsG: 0.7,
                        fatG: 9.5,
                        gramsPerEach: 50,
                    }),
                );
                const recipe = await createRecipe(recipes, {
                    householdId: sharer.householdId,
                    creatorId: sharer.userId,
                    name: "Lentil soup",
                    yieldPortions: 4,
                    instructions: "1. Rinse.\n2. Simmer.",
                    tags: ["soup"],
                    notes: "private",
                });
                const lines = [
                    { food: lentils, quantity: { amount: 300, unit: "g" } },
                    { food: egg, quantity: { amount: 3, unit: "each" } },
                ];
                for (const [index, line] of lines.entries()) {
                    await recipes.insertIngredient({
                        id: crypto.randomUUID(),
                        householdId: sharer.householdId,
                        recipeId: recipe.id,
                        kind: "food",
                        displayName: line.food.name,
                        quantity: line.quantity,
                        foodId: line.food.id,
                        sortOrder: index,
                        note: null,
                    });
                }
                // A food with no nutrition at all, used "to taste".
                const spice = await foods.insertFood(
                    newFood({
                        householdId: sharer.householdId,
                        kind: "food",
                        name: "Mystery spice",
                    }),
                );
                await recipes.insertIngredient({
                    id: crypto.randomUUID(),
                    householdId: sharer.householdId,
                    recipeId: recipe.id,
                    kind: "food",
                    displayName: spice.name,
                    quantity: null,
                    foodId: spice.id,
                    sortOrder: 2,
                    note: "to taste",
                });
                const built = recipeShareDocument(
                    {
                        ...recipe,
                        ingredients: await recipes.listIngredients(
                            sharer.householdId,
                            recipe.id,
                        ),
                    },
                    await foods.getFoodsByIds(sharer.householdId, [
                        lentils.id,
                        egg.id,
                        spice.id,
                    ]),
                );
                if (!built) throw new Error("expected a document");
                // As the importer reads it: text over the wire.
                return parseShareDocument(JSON.stringify(built));
            },
            sharer.householdId,
        );
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    async function count(table: string, householdId: string): Promise<number> {
        const [row] = await sql.unsafe(
            `select count(*)::int as n from public.${table} where household_id = $1`,
            [householdId],
        );
        return Number((row as { n: number }).n);
    }

    function importAs(
        who: { userId: string; householdId: string },
        recipes: RecipesStore = liveRecipesStore(),
    ) {
        return asUser(
            who.userId,
            () =>
                importSharedRecipe(
                    { foods: liveFoodsStore(), recipes },
                    {
                        householdId: who.householdId,
                        creatorId: who.userId,
                        document,
                    },
                    { transaction },
                ),
            who.householdId,
        );
    }

    test("creates the recipe, new foods and ingredients in the importing household, and leaves an existing food untouched", async () => {
        const theirEgg = await asUser(
            importer.userId,
            () =>
                liveFoodsStore().insertFood(
                    newFood({
                        householdId: importer.householdId,
                        kind: "food",
                        name: "egg",
                        calories: 150,
                        proteinG: 13,
                        gramsPerEach: 60,
                        nutritionSource: "manual",
                    }),
                ),
            importer.householdId,
        );
        const [eggBefore] = await sql`
            select * from public.foods where id = ${theirEgg.id}`;
        const sharerFoods = await count("foods", sharer.householdId);
        const sharerRecipes = await count("recipes", sharer.householdId);

        const result = await importAs(importer);

        expect(result.matched).toBe(1);
        expect(result.created).toBe(2);
        expect(result.ingredients.map((i) => [i.name, i.status])).toEqual([
            ["Red lentils", "created"],
            ["egg", "matched"],
            ["Mystery spice", "created"],
        ]);

        // The recipe, as a copy in the importing household.
        const [recipe] = await sql`
            select * from public.recipes where id = ${result.recipe.id}`;
        expect(recipe).toMatchObject({
            household_id: importer.householdId,
            creator_id: importer.userId,
            name: "Lentil soup",
            instructions: "1. Rinse.\n2. Simmer.",
            verification: "verified",
            source_url: null,
            notes: null,
        });
        expect(Number(recipe!.yield_portions)).toBe(4);

        const ingredients = await sql`
            select display_name, amount, unit, food_id,
                   sort_order, household_id, note
            from public.recipe_ingredients
            where recipe_id = ${result.recipe.id}
            order by sort_order`;
        expect(
            ingredients.map((r: Record<string, unknown>) => [
                r.display_name,
                r.amount === null ? null : Number(r.amount),
                r.unit,
            ]),
        ).toEqual([
            ["Red lentils", 300, "g"],
            ["egg", 3, "each"],
            ["Mystery spice", null, null],
        ]);
        expect(
            ingredients.every(
                (r: Record<string, unknown>) =>
                    r.household_id === importer.householdId &&
                    r.food_id !== null,
            ),
        ).toBe(true);
        expect(ingredients[1]!.food_id).toBe(theirEgg.id);
        expect(ingredients[2]!.note).toBe("to taste");

        // The importer's egg is byte for byte what it was.
        const [eggAfter] = await sql`
            select * from public.foods where id = ${theirEgg.id}`;
        expect(eggAfter).toEqual(eggBefore);

        // The new foods carry the shipped nutrition; unknown stays NULL.
        const created = await sql`
            select name, normalized_name, brand, kind, calories, protein_g,
                   carbs_g, fat_g, fiber_g, sugar_g, saturated_fat_g,
                   alcohol_g, caffeine_mg, grams_per_ml, grams_per_each,
                   nutrition_source, created_by, off_source_id, archived_at
            from public.foods
            where household_id = ${importer.householdId}
              and id <> ${theirEgg.id}
            order by name`;
        expect(created.map((r: Record<string, unknown>) => r.name)).toEqual([
            "Mystery spice",
            "Red lentils",
        ]);
        const lentils = created[1] as Record<string, unknown>;
        expect(lentils).toMatchObject({
            normalized_name: "red lentils",
            brand: null,
            kind: "food",
            alcohol_g: null,
            caffeine_mg: null,
            grams_per_each: null,
            nutrition_source: "manual",
            created_by: importer.userId,
            off_source_id: null,
            archived_at: null,
        });
        expect(Number(lentils.calories)).toBe(352);
        expect(Number(lentils.protein_g)).toBe(24.6);
        expect(Number(lentils.fiber_g)).toBe(10.7);
        expect(Number(lentils.grams_per_ml)).toBe(0.85);
        const spice = created[0] as Record<string, unknown>;
        expect(spice.calories).toBeNull();
        expect(spice.protein_g).toBeNull();
        expect(spice.nutrition_source).toBeNull();

        // Nothing about the sharer changed, and nothing of theirs came over.
        expect(await count("foods", sharer.householdId)).toBe(sharerFoods);
        expect(await count("recipes", sharer.householdId)).toBe(sharerRecipes);
        expect(await count("recipe_ingredients", sharer.householdId)).toBe(3);
        const [leak] = await sql`
            select count(*)::int as n from public.recipe_ingredients
            where household_id = ${importer.householdId}
              and food_id in (
                  select id from public.foods where household_id = ${sharer.householdId})`;
        expect((leak as { n: number }).n).toBe(0);
    });

    test("another household's foods are never matched, even with the same name", async () => {
        // The sharer has "Red lentils" and "Egg"; the importer has neither,
        // and cannot see the sharer's rows (row level security).
        const result = await importAs(importer);
        expect(result.matched).toBe(0);
        expect(result.created).toBe(3);
        expect(await count("foods", importer.householdId)).toBe(3);
    });

    test("importing the same document again makes a second recipe and no new foods", async () => {
        const first = await importAs(importer);
        const foodsAfterFirst = await count("foods", importer.householdId);
        const second = await importAs(importer);
        expect(first.recipe.name).toBe("Lentil soup");
        expect(second.recipe.name).toBe("Lentil soup (2)");
        expect(second.renamedFrom).toBe("Lentil soup");
        expect(second.created).toBe(0);
        expect(second.matched).toBe(3);
        expect(await count("foods", importer.householdId)).toBe(
            foodsAfterFirst,
        );
        expect(await count("recipes", importer.householdId)).toBe(2);
    });

    test("a failure part-way leaves no recipe and no new foods", async () => {
        const real = liveRecipesStore();
        let inserted = 0;
        const failing: RecipesStore = {
            ...real,
            insertIngredient: async (row) => {
                inserted += 1;
                if (inserted === 2) throw new Error("disk on fire");
                return real.insertIngredient(row);
            },
        };
        await expect(importAs(importer, failing)).rejects.toThrow(
            "disk on fire",
        );
        expect(inserted).toBe(2);
        expect(await count("recipes", importer.householdId)).toBe(0);
        expect(await count("recipe_ingredients", importer.householdId)).toBe(0);
        expect(await count("foods", importer.householdId)).toBe(0);
    });
});
