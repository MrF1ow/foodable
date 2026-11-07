import { describe, expect, test } from "bun:test";
import type { RecipesStore } from "../../domain/recipes.js";
import {
    sampleIngredient,
    sampleRecipe,
    type StoreContractCtx,
} from "./helpers.js";

export function runRecipesStoreContract(
    label: string,
    createStore: () => RecipesStore,
    reset: () => Promise<void>,
    ctx: () => StoreContractCtx,
): void {
    describe(`${label} recipes store`, () => {
        test("listRecipes, getRecipe, insertRecipe, updateRecipe, deleteRecipe", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const beta = sampleRecipe(c, { name: "Beta" });
            const alpha = sampleRecipe(c, { name: "Alpha" });
            await store.insertRecipe(beta);
            await store.insertRecipe(alpha);
            expect(
                (await store.listRecipes(c.householdId)).map((r) => r.name),
            ).toEqual(["Alpha", "Beta"]);

            expect((await store.getRecipe(c.householdId, alpha.id))?.name).toBe(
                "Alpha",
            );
            expect(
                await store.getRecipe(c.householdId, crypto.randomUUID()),
            ).toBeNull();

            const updated = await store.updateRecipe({
                ...alpha,
                notes: "Revised",
            });
            expect(updated?.notes).toBe("Revised");
            expect(
                await store.updateRecipe({
                    ...alpha,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();

            expect(await store.deleteRecipe(c.householdId, beta.id)).toBe(true);
            expect(
                await store.deleteRecipe(c.householdId, crypto.randomUUID()),
            ).toBe(false);
        });

        test("listIngredients, insertIngredient, updateIngredient, deleteIngredient", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const recipe = sampleRecipe(c);
            await store.insertRecipe(recipe);
            const second = sampleIngredient(c, recipe.id, {
                sortOrder: 1,
                displayName: "Salt",
            });
            const first = sampleIngredient(c, recipe.id, {
                sortOrder: 0,
                displayName: "Pepper",
            });
            await store.insertIngredient(second);
            await store.insertIngredient(first);
            expect(
                (await store.listIngredients(c.householdId, recipe.id)).map(
                    (i) => i.displayName,
                ),
            ).toEqual(["Pepper", "Salt"]);

            const updated = await store.updateIngredient({
                ...first,
                note: "Fresh",
            });
            expect(updated?.note).toBe("Fresh");
            expect(
                await store.updateIngredient({
                    ...first,
                    id: crypto.randomUUID(),
                }),
            ).toBeNull();

            expect(await store.deleteIngredient(c.householdId, second.id)).toBe(
                true,
            );
            expect(
                await store.deleteIngredient(
                    c.householdId,
                    crypto.randomUUID(),
                ),
            ).toBe(false);
        });

        test("getPortion and upsertPortion conflict path", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const recipe = sampleRecipe(c);
            await store.insertRecipe(recipe);
            expect(
                await store.getPortion(c.householdId, recipe.id, c.userId),
            ).toBeNull();

            const first = await store.upsertPortion({
                recipeId: recipe.id,
                householdId: c.householdId,
                userId: c.userId,
                portionCount: 2,
            });
            expect(first.portionCount).toBe(2);
            const again = await store.upsertPortion({
                recipeId: recipe.id,
                householdId: c.householdId,
                userId: c.userId,
                portionCount: 3,
            });
            expect(again.portionCount).toBe(3);
            expect(
                (await store.getPortion(c.householdId, recipe.id, c.userId))
                    ?.portionCount,
            ).toBe(3);
        });

        test("household scoping on listRecipes", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            await store.insertRecipe(sampleRecipe(c));
            expect(await store.listRecipes(c.otherHouseholdId)).toEqual([]);
        });

        test("listIngredientsForHousehold returns every ingredient in one call", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const alpha = sampleRecipe(c, { name: "Alpha" });
            const beta = sampleRecipe(c, { name: "Beta" });
            await store.insertRecipe(alpha);
            await store.insertRecipe(beta);
            const ingA = sampleIngredient(c, alpha.id, { displayName: "A" });
            const ingB = sampleIngredient(c, beta.id, { displayName: "B" });
            await store.insertIngredient(ingA);
            await store.insertIngredient(ingB);
            const all = await store.listIngredientsForHousehold(c.householdId);
            expect(all.map((row) => row.id).sort()).toEqual(
                [ingA.id, ingB.id].sort(),
            );
            expect(
                await store.listIngredientsForHousehold(c.otherHouseholdId),
            ).toEqual([]);
        });
    });
}
