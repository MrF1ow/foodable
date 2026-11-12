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

        test("setFavourite and listFavourites: star, unstar, idempotent, per member", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const asMember =
                c.asMember ?? (<T>(_: string, fn: () => Promise<T>) => fn());
            const other = c.ensureMember
                ? await c.ensureMember()
                : crypto.randomUUID();
            const alpha = sampleRecipe(c, { name: "Alpha" });
            const beta = sampleRecipe(c, { name: "Beta" });
            await store.insertRecipe(alpha);
            await store.insertRecipe(beta);
            expect(await store.listFavourites(c.householdId, c.userId)).toEqual(
                [],
            );

            expect(
                await store.setFavourite(
                    c.householdId,
                    c.userId,
                    alpha.id,
                    true,
                ),
            ).toBe(true);
            // Starring twice is the same as starring once.
            expect(
                await store.setFavourite(
                    c.householdId,
                    c.userId,
                    alpha.id,
                    true,
                ),
            ).toBe(true);
            expect(await store.listFavourites(c.householdId, c.userId)).toEqual(
                [alpha.id],
            );

            // Another member's stars are theirs alone.
            await asMember(other, () =>
                store.setFavourite(c.householdId, other, beta.id, true),
            );
            expect(await store.listFavourites(c.householdId, c.userId)).toEqual(
                [alpha.id],
            );
            expect(
                await asMember(other, () =>
                    store.listFavourites(c.householdId, other),
                ),
            ).toEqual([beta.id]);

            // Unstarring is idempotent too, and leaves the other member's star.
            expect(
                await store.setFavourite(
                    c.householdId,
                    c.userId,
                    alpha.id,
                    false,
                ),
            ).toBe(true);
            expect(
                await store.setFavourite(
                    c.householdId,
                    c.userId,
                    alpha.id,
                    false,
                ),
            ).toBe(true);
            expect(await store.listFavourites(c.householdId, c.userId)).toEqual(
                [],
            );
            expect(
                await asMember(other, () =>
                    store.listFavourites(c.householdId, other),
                ),
            ).toEqual([beta.id]);
        });

        test("setFavourite: a recipe that is not in the household cannot be starred", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const stray = crypto.randomUUID();
            expect(
                await store.setFavourite(c.householdId, c.userId, stray, true),
            ).toBe(false);
            expect(await store.listFavourites(c.householdId, c.userId)).toEqual(
                [],
            );
            // Un-starring what was never starred is a no-op, but the recipe is
            // still not there.
            expect(
                await store.setFavourite(c.householdId, c.userId, stray, false),
            ).toBe(false);
        });

        test("deleteRecipe takes its favourites with it", async () => {
            await reset();
            const c = ctx();
            const store = createStore();
            const gone = sampleRecipe(c, { name: "Gone" });
            const kept = sampleRecipe(c, { name: "Kept" });
            await store.insertRecipe(gone);
            await store.insertRecipe(kept);
            await store.setFavourite(c.householdId, c.userId, gone.id, true);
            await store.setFavourite(c.householdId, c.userId, kept.id, true);
            expect(await store.deleteRecipe(c.householdId, gone.id)).toBe(true);
            expect(await store.listFavourites(c.householdId, c.userId)).toEqual(
                [kept.id],
            );
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
