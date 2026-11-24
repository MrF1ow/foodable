import { afterEach, beforeEach, expect, test } from "bun:test";
import { liveFoodsStore, mergeLiveFoods } from "./foods.js";
import { addRecipeManualIngredient, createRecipe } from "../domain/recipes.js";
import { setRecipeVariant } from "../domain/recipe-variants.js";
import { liveRecipesStore, liveRecipeVariantsStore } from "./recipes.js";
import { setSqlForTests } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import { seedFood, seedHousehold } from "./testing/fixtures.js";
import { findPgBin } from "./testing/pg-temp.js";

describeDb(
    findPgBin() !== null,
    "merging foods across recipe versions",
    (getCtx) => {
        let householdId: string;
        let userId: string;
        beforeEach(async () => {
            const { sql, truncateAll } = getCtx();
            await truncateAll();
            setSqlForTests(sql);
            ({ householdId, userId } = await seedHousehold(sql));
        });
        afterEach(() => setSqlForTests(null));

        test("merges two foods one person added to the same recipe, summing the amounts", async () => {
            const { sql } = getCtx();
            const recipes = liveRecipesStore();
            const foods = liveFoodsStore();
            const variants = liveRecipeVariantsStore();
            const recipe = await createRecipe(recipes, {
                householdId,
                creatorId: userId,
                name: "Mac",
                yieldPortions: 4,
            });
            const peas = await seedFood(sql, householdId, { name: "Peas" });
            const greenPeas = await seedFood(sql, householdId, {
                name: "Green peas",
            });
            await setRecipeVariant(recipes, foods, variants, {
                householdId,
                recipeId: recipe.id,
                userId,
                action: "add",
                foodId: peas,
                amount: 40,
                unit: "g",
            });
            await setRecipeVariant(recipes, foods, variants, {
                householdId,
                recipeId: recipe.id,
                userId,
                action: "add",
                foodId: greenPeas,
                amount: 0.06,
                unit: "kg",
            });
            await mergeLiveFoods(householdId, peas, greenPeas);
            const rows = await variants.listOverrides(householdId, recipe.id);
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({
                action: "add",
                foodId: peas,
                amount: 100,
                unit: "g",
            });
        });
    },
);
