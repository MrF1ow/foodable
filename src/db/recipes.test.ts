import { join } from "node:path";
import { SQL } from "bun";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { liveFoodsStore } from "./foods.js";
import { deleteAuthUser } from "./users.js";
import {
    importRecipeFromUrl,
    sweepUnverifiedRecipes,
} from "../domain/recipe-import.js";
import {
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createRecipe,
    deleteRecipe,
    removeRecipeIngredient,
    updateRecipeIngredient,
} from "../domain/recipes.js";
import {
    alignChange,
    clearRecipeVariant,
    overrideKey,
    previewReset,
    recipeNeeds,
    resetVariant,
    variantFor,
    setRecipeVariant,
} from "../domain/recipe-variants.js";
import { cookRecipe, previewCookRecipe } from "../domain/stock.js";
import { createGroceryStore } from "../domain/settings.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { liveSettingsStore } from "./settings.js";
import { inStockTransaction, liveStockStore } from "./stock.js";
import { recipeImportToRow } from "../domain/recipe-import.js";
import type { SafeFetcher } from "../fetch-safe.js";
import {
    liveRecipesStore,
    liveRecipeVariantsStore,
    recipeAlignTransaction,
    recipeImportSqlValues,
} from "./recipes.js";
import { run } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import {
    seedFood,
    seedFridgeItem,
    seedFridgeLocation,
    seedHousehold,
    seedMember,
} from "./testing/fixtures.js";
import { waitForLockWaiters } from "./testing/lock-race.js";
import { findPgBin } from "./testing/pg-temp.js";
import { pairAppSqlForTests, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();

test("recipeImportSqlValues JSON-stringifies array columns", () => {
    const row = recipeImportToRow({
        recipeId: "r1",
        householdId: "hh-1",
        sourceKind: "text",
        sourceUrl: null,
        sourceText: "paste",
        sourceTextOrigin: null,
        transcript: null,
        credit: null,
        unresolvedLines: ["line one", "line two"],
        problems: [
            {
                code: "no_instructions",
                message: "Add the steps.",
                ingredientId: null,
                line: null,
            },
        ],
        dismissedMentions: [],
        importedAt: "2026-01-01T00:00:00.000Z",
    });
    const sql = recipeImportSqlValues(row);
    expect(sql.unresolvedLinesJson).toBe(
        JSON.stringify(["line one", "line two"]),
    );
    expect(sql.problemsJson).toBe(
        JSON.stringify([
            {
                code: "no_instructions",
                message: "Add the steps.",
                ingredientId: null,
                line: null,
            },
        ]),
    );
    expect(() => JSON.parse(sql.unresolvedLinesJson)).not.toThrow();
    expect(() => JSON.parse(sql.problemsJson)).not.toThrow();
});

describeDb(pgAvailable !== null, "recipes db import", (getCtx) => {
    let householdId: string;
    let userId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        userId = seeded.userId;
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    test("upsertImport persists jsonb unresolved_lines and problems", async () => {
        const store = liveRecipesStore();
        const recipe = await createRecipe(store, {
            householdId,
            creatorId: userId,
            name: "Import row",
            yieldPortions: 2,
            verification: "unverified",
        });
        const saved = await store.upsertImport({
            recipeId: recipe.id,
            householdId,
            sourceKind: "text",
            sourceUrl: null,
            sourceText: "raw",
            sourceTextOrigin: "pasted",
            transcript: null,
            credit: null,
            unresolvedLines: ["mystery line"],
            problems: [
                {
                    code: "no_instructions",
                    message: "Add the steps.",
                    ingredientId: null,
                    line: null,
                },
            ],
            dismissedMentions: [],
            importedAt: "2026-01-01T12:00:00.000Z",
        });
        expect(saved.unresolvedLines).toEqual(["mystery line"]);
        expect(saved.problems).toHaveLength(1);
        const loaded = await store.getImport(householdId, recipe.id);
        expect(loaded?.unresolvedLines).toEqual(["mystery line"]);
        expect(loaded?.problems[0]?.code).toBe("no_instructions");
    });

    test("dismissed_mentions defaults to [] and round-trips quotes and unicode", async () => {
        const { sql } = getCtx();
        const store = liveRecipesStore();
        const recipe = await createRecipe(store, {
            householdId,
            creatorId: userId,
            name: "Dismissals",
            yieldPortions: 2,
            verification: "unverified",
        });
        // A row written before the column existed: the default fills it in.
        await sql`
            insert into public.recipe_imports
                (recipe_id, household_id, source_kind, imported_at)
            values (${recipe.id}, ${householdId}, 'text', now())
        `;
        const fresh = await store.getImport(householdId, recipe.id);
        expect(fresh?.dismissedMentions).toEqual([]);

        const keys = ["egg", 'pickled "beets"', "it's", "jalapeño", "豆腐"];
        for (const key of keys) {
            await store.addDismissedMention(householdId, recipe.id, key);
        }
        expect(
            (await store.getImport(householdId, recipe.id))?.dismissedMentions,
        ).toEqual(keys);
        const [{ kind }] = await sql`
            select jsonb_typeof(dismissed_mentions) as kind
            from public.recipe_imports where recipe_id = ${recipe.id}
        `;
        expect(kind).toBe("array");
    });

    test("findRecipeBySourceUrl and listImports round-trip", async () => {
        const store = liveRecipesStore();
        const recipe = await createRecipe(store, {
            householdId,
            creatorId: userId,
            name: "Linked",
            yieldPortions: 2,
            sourceUrl: "https://example.com/recipe",
        });
        await store.upsertImport({
            recipeId: recipe.id,
            householdId,
            sourceKind: "website",
            sourceUrl: "https://example.com/recipe",
            sourceText: null,
            sourceTextOrigin: null,
            transcript: null,
            credit: null,
            unresolvedLines: [],
            problems: [],
            dismissedMentions: [],
            importedAt: "2026-01-01T12:00:00.000Z",
        });
        const found = await store.findRecipeBySourceUrl(householdId, [
            "https://example.com/recipe?utm=x",
            "https://example.com/recipe",
        ]);
        expect(found?.id).toBe(recipe.id);
        const listed = await store.listImports(householdId);
        expect(listed.some((row) => row.recipeId === recipe.id)).toBe(true);
    });

    test("website import through live stores persists recipe import and ingredients", async () => {
        const yoast = await Bun.file(
            join(
                import.meta.dir,
                "../domain/fixtures/recipe-pages/array-top-level.html",
            ),
        ).text();
        const fetcher: SafeFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                return {
                    ok: true,
                    url: "https://example.com/db-soup",
                    status: 200,
                    contentType: "text/html",
                    body: yoast,
                };
            },
        };
        const recipes = liveRecipesStore();
        const foods = liveFoodsStore();
        let recipeId = "";
        await run(async () => {
            const outcome = await importRecipeFromUrl(
                {
                    recipes,
                    foods,
                    fetcher,
                    transaction: (fn) => run(async () => fn()),
                },
                {
                    householdId,
                    creatorId: userId,
                    url: "https://example.com/db-soup",
                },
            );
            expect(outcome.status).toBe("imported");
            recipeId = outcome.recipeId!;
        });
        const recipe = await recipes.getRecipe(householdId, recipeId);
        expect(recipe?.sourceUrl).toBe("https://example.com/db-soup");
        const ingredients = await recipes.listIngredients(
            householdId,
            recipeId,
        );
        expect(ingredients.length).toBeGreaterThan(0);
        const imp = await recipes.getImport(householdId, recipeId);
        expect(imp?.sourceKind).toBe("website");
        expect(imp?.sourceText).toBeNull();
        expect(imp?.sourceTextOrigin).toBeNull();
    });

    test("caption import through live stores persists source text origin and credit", async () => {
        const caption = await Bun.file(
            join(
                import.meta.dir,
                "../domain/fixtures/captions/clean-headers.txt",
            ),
        ).text();
        const fetcher: SafeFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                throw new Error("fetch should not run for social paste");
            },
        };
        const recipes = liveRecipesStore();
        const foods = liveFoodsStore();
        let recipeId = "";
        await run(async () => {
            const outcome = await importRecipeFromUrl(
                {
                    recipes,
                    foods,
                    fetcher,
                    transaction: (fn) => run(async () => fn()),
                },
                {
                    householdId,
                    creatorId: userId,
                    url: "https://www.instagram.com/p/db-caption/",
                    text: caption,
                    credit: "Studio Kitchen",
                    textOrigin: "pasted",
                },
            );
            expect(outcome.status).toBe("imported");
            recipeId = outcome.recipeId!;
        });
        const imp = await recipes.getImport(householdId, recipeId);
        expect(imp?.sourceText).toBe(caption.trim());
        expect(imp?.sourceTextOrigin).toBe("pasted");
        expect(imp?.credit).toBe("Studio Kitchen");
        expect(imp?.sourceKind).toBe("instagram");
    });

    test("importRecipeFromUrl rolls back recipe ingredients import row and new foods on failure", async () => {
        const { sql } = getCtx();
        const yoast = await Bun.file(
            join(
                import.meta.dir,
                "../domain/fixtures/recipe-pages/yoast-graph.html",
            ),
        ).text();
        const fetcher: SafeFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                return {
                    ok: true,
                    url: "https://example.com/rollback-db",
                    status: 200,
                    contentType: "text/html",
                    body: yoast,
                };
            },
        };
        const baseRecipes = liveRecipesStore();
        let ingredientInserts = 0;
        const recipes = {
            ...baseRecipes,
            async insertIngredient(
                row: Parameters<typeof baseRecipes.insertIngredient>[0],
            ) {
                ingredientInserts += 1;
                if (ingredientInserts === 3) {
                    throw new Error("insert failed");
                }
                return baseRecipes.insertIngredient(row);
            },
        };
        const foods = liveFoodsStore();
        const foodCountBefore = (
            (await sql`
            select count(*)::int as c from foods where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        const recipeCountBefore = (
            (await sql`
            select count(*)::int as c from recipes where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        const importCountBefore = (
            (await sql`
            select count(*)::int as c from recipe_imports where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        await expect(
            run(async () =>
                importRecipeFromUrl(
                    {
                        recipes,
                        foods,
                        fetcher,
                        transaction: (fn) => run(async () => fn()),
                    },
                    {
                        householdId,
                        creatorId: userId,
                        url: "https://example.com/rollback-db",
                    },
                ),
            ),
        ).rejects.toThrow("insert failed");
        const foodCountAfter = (
            (await sql`
            select count(*)::int as c from foods where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        const recipeCountAfter = (
            (await sql`
            select count(*)::int as c from recipes where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        const importCountAfter = (
            (await sql`
            select count(*)::int as c from recipe_imports where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        const ingredientCountAfter = (
            (await sql`
            select count(*)::int as c from recipe_ingredients where household_id = ${householdId}
        `) as { c: number }[]
        )[0]!.c;
        expect(foodCountAfter).toBe(foodCountBefore);
        expect(recipeCountAfter).toBe(recipeCountBefore);
        expect(importCountAfter).toBe(importCountBefore);
        expect(ingredientCountAfter).toBe(0);
    });
});

describeDb(pgAvailable !== null, "recipe versions db", (getCtx) => {
    let householdId: string;
    let userId: string;
    let memberId: string;

    beforeEach(async () => {
        const { sql, truncateAll } = getCtx();
        await truncateAll();
        setSqlForTests(sql);
        const seeded = await seedHousehold(sql);
        householdId = seeded.householdId;
        userId = seeded.userId;
        memberId = await seedMember(sql, householdId);
    });

    afterEach(() => {
        setSqlForTests(null);
    });

    async function kitchen() {
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
        const pasta = await addRecipeManualIngredient(recipes, foods, {
            householdId,
            recipeId: recipe.id,
            name: "Pasta",
            amount: 400,
            unit: "g",
        });
        const cheese = await addRecipeManualIngredient(recipes, foods, {
            householdId,
            recipeId: recipe.id,
            name: "Cheese",
            amount: 200,
            unit: "g",
        });
        const peas = await seedFood(sql, householdId, { name: "Peas" });
        return { sql, recipes, foods, variants, recipe, pasta, cheese, peas };
    }

    /** The key the compare read gives one person's change. */
    const keyFor = async (recipeId: string, who: string, ref: string) => {
        const row = (
            await liveRecipeVariantsStore().listOverrides(householdId, recipeId)
        ).find(
            (r) => r.userId === who && (r.id === ref || r.ingredientId === ref),
        );
        return row ? overrideKey(row) : "";
    };

    const countRows = async (recipeId: string) =>
        (await liveRecipeVariantsStore().listOverrides(householdId, recipeId))
            .length;

    test("a retried add, through setRecipeVariant, is one row and one need; another person's add of the food is their own", async () => {
        const k = await kitchen();
        const call = {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "add" as const,
            foodId: k.peas,
            amount: 40,
            unit: "g",
        };
        await setRecipeVariant(k.recipes, k.foods, k.variants, call);
        await setRecipeVariant(k.recipes, k.foods, k.variants, call);
        expect(await countRows(k.recipe.id)).toBe(1);
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...call,
            userId: memberId,
        });
        expect(await countRows(k.recipe.id)).toBe(2);
        const needs = recipeNeeds({
            ingredients: await k.recipes.listIngredients(
                householdId,
                k.recipe.id,
            ),
            yieldPortions: 4,
            overrides: await k.variants.listOverrides(householdId, k.recipe.id),
            members: [{ userId, portions: 4 }],
            totalPortions: 4,
            recipeId: k.recipe.id,
        });
        expect(needs.find((n) => n.displayName === "Peas")?.quantity).toEqual({
            amount: 40,
            unit: "g",
        });
    });

    test("a swap keeps its unit when the base's unit is edited later, and an amount on it keeps the swap", async () => {
        const k = await kitchen();
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "food",
            ingredientId: k.cheese.id,
            foodId: k.peas,
            amount: 300,
        });
        await updateRecipeIngredient(
            k.recipes,
            householdId,
            k.recipe.id,
            k.cheese.id,
            { amount: 1, unit: "kg" },
            k.foods,
        );
        const [saved] = await k.variants.listOverrides(
            householdId,
            k.recipe.id,
        );
        expect(saved).toMatchObject({ action: "food", amount: 300, unit: "g" });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "amount",
            ingredientId: k.cheese.id,
            amount: 250,
            unit: "g",
        });
        const rows = await k.variants.listOverrides(householdId, k.recipe.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            action: "food",
            foodId: k.peas,
            amount: 250,
            unit: "g",
        });
    });

    test("saves, replaces one per person and ingredient, and lists oldest first", async () => {
        const k = await kitchen();
        const save = (amount: number, user = userId) =>
            k.variants.saveOverride({
                householdId,
                recipeId: k.recipe.id,
                userId: user,
                ingredientId: k.cheese.id,
                action: "amount",
                amount,
                unit: "g",
            });
        const first = await save(50);
        const again = await save(75);
        expect(again.id).toBe(first.id);
        expect(again.amount).toBe(75);
        await save(10, memberId);
        const added = await k.variants.saveOverride({
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: null,
            action: "add",
            amount: 40,
            unit: "g",
            foodId: k.peas,
            displayName: "Peas",
        });
        // The same food added again replaces that add: one row per person,
        // recipe and added food, so a retried add does not double it.
        const addedAgain = await k.variants.saveOverride({
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: null,
            action: "add",
            amount: 20,
            unit: "g",
            foodId: k.peas,
            displayName: "Peas",
        });
        expect(addedAgain.id).toBe(added.id);
        expect(addedAgain.amount).toBe(20);
        const rows = await k.variants.listOverrides(householdId, k.recipe.id);
        expect(rows).toHaveLength(3);
        expect(rows.map((row) => row.id)).toContain(added.id);
        expect(rows[0]).toMatchObject({
            userId,
            ingredientId: k.cheese.id,
            amount: 75,
            unit: "g",
            action: "amount",
        });
        expect(
            await k.variants.listOverridesForRecipes(householdId, [
                k.recipe.id,
            ]),
        ).toHaveLength(3);
        expect(
            await k.variants.listOverridesForRecipes(householdId, []),
        ).toEqual([]);
    });

    test("the database refuses a row that does not fit its action", async () => {
        const k = await kitchen();
        await expect(
            k.variants.saveOverride({
                householdId,
                recipeId: k.recipe.id,
                userId,
                ingredientId: null,
                action: "remove",
            }),
        ).rejects.toThrow();
        await expect(
            k.variants.saveOverride({
                householdId,
                recipeId: k.recipe.id,
                userId,
                ingredientId: k.cheese.id,
                action: "amount",
                amount: 0,
                unit: "g",
            }),
        ).rejects.toThrow();
        expect(await countRows(k.recipe.id)).toBe(0);
    });

    test("another household's recipe cannot be given a version", async () => {
        const k = await kitchen();
        const { sql } = getCtx();
        const other = await seedHousehold(sql);
        await expect(
            k.variants.saveOverride({
                householdId: other.householdId,
                recipeId: k.recipe.id,
                userId: other.userId,
                ingredientId: k.cheese.id,
                action: "remove",
            }),
        ).rejects.toThrow();
        expect(await countRows(k.recipe.id)).toBe(0);
    });

    test("an id that is not a uuid names no recipe and no versions", async () => {
        const k = await kitchen();
        expect(
            await k.variants.listOverrides(householdId, "not-a-uuid"),
        ).toEqual([]);
        await expect(
            clearRecipeVariant(k.recipes, k.variants, {
                householdId,
                recipeId: "not-a-uuid",
                userId,
            }),
        ).rejects.toThrow("Unknown recipe.");
    });

    test("deleting an ingredient, a recipe or a person takes their rows, and nothing else's", async () => {
        const k = await kitchen();
        for (const user of [userId, memberId]) {
            await k.variants.saveOverride({
                householdId,
                recipeId: k.recipe.id,
                userId: user,
                ingredientId: k.cheese.id,
                action: "remove",
            });
            await k.variants.saveOverride({
                householdId,
                recipeId: k.recipe.id,
                userId: user,
                ingredientId: null,
                action: "add",
                amount: 40,
                unit: "g",
                foodId: k.peas,
                displayName: "Peas",
            });
        }
        await removeRecipeIngredient(
            k.recipes,
            householdId,
            k.recipe.id,
            k.cheese.id,
        );
        // The overrides of the ingredient went; the added lines stayed.
        expect(await countRows(k.recipe.id)).toBe(2);
        const { sql } = getCtx();
        await sql`delete from public.household_members where user_id = ${memberId}`;
        await sql`delete from public.users where id = ${memberId}`;
        expect(
            (await k.variants.listOverrides(householdId, k.recipe.id)).map(
                (row) => row.userId,
            ),
        ).toEqual([userId]);
        await deleteRecipe(k.recipes, householdId, k.recipe.id, {
            userId,
            isOwner: true,
        });
        const [left] = (await sql`
            select count(*)::int as n from public.recipe_variant_overrides
        `) as { n: number }[];
        expect(left!.n).toBe(0);
    });

    test("deletes one change by its id or its ingredient, or a whole version", async () => {
        const k = await kitchen();
        const remove = await k.variants.saveOverride({
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: k.cheese.id,
            action: "remove",
        });
        const add = await k.variants.saveOverride({
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: null,
            action: "add",
            amount: 40,
            unit: "g",
            foodId: k.peas,
            displayName: "Peas",
        });
        expect(
            await k.variants.deleteOverride(
                householdId,
                k.recipe.id,
                memberId,
                k.cheese.id,
            ),
        ).toBe(false);
        expect(
            await k.variants.deleteOverride(
                householdId,
                k.recipe.id,
                userId,
                k.cheese.id,
            ),
        ).toBe(true);
        expect(
            await k.variants.deleteOverride(
                householdId,
                k.recipe.id,
                userId,
                "not-a-uuid",
            ),
        ).toBe(false);
        expect(
            await k.variants.deleteOverride(
                householdId,
                k.recipe.id,
                userId,
                add.id,
            ),
        ).toBe(true);
        expect(remove.id).not.toBe(add.id);
        await k.variants.saveOverride({
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: k.pasta.id,
            action: "remove",
        });
        await k.variants.saveOverride({
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            ingredientId: k.pasta.id,
            action: "remove",
        });
        expect(
            await k.variants.clearVariant(householdId, k.recipe.id, userId),
        ).toBe(1);
        expect(await countRows(k.recipe.id)).toBe(1);
    });

    test("cook takes each member's version of the stock, against Postgres", async () => {
        const k = await kitchen();
        const { sql } = getCtx();
        const location = await seedFridgeLocation(sql, householdId);
        await seedFridgeItem(sql, householdId, location, k.pasta.foodId!, {
            displayName: "Pasta",
            amount: 1000,
        });
        await seedFridgeItem(sql, householdId, location, k.cheese.foodId!, {
            displayName: "Cheese",
            amount: 1000,
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "remove",
            ingredientId: k.cheese.id,
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "amount",
            ingredientId: k.pasta.id,
            amount: 800,
            unit: "g",
        });
        const input = {
            householdId,
            recipeId: k.recipe.id,
            totalPortions: 3,
            memberPortions: [
                { userId, portions: 1 },
                { userId: memberId, portions: 2 },
            ],
            variants: k.variants,
        };
        const preview = await previewCookRecipe(
            k.recipes,
            liveFridgeStore(),
            k.foods,
            input,
        );
        expect(
            preview.lines.map((line) => [
                line.displayName,
                line.before - line.after,
            ]),
        ).toEqual([
            ["Pasta", 500],
            ["Cheese", 100],
        ]);
        const cooked = await inStockTransaction(() =>
            cookRecipe(
                k.recipes,
                liveFridgeStore(),
                liveStockStore(),
                k.foods,
                input,
            ),
        );
        expect(cooked.shortfalls).toEqual([]);
        const left = (await sql`
            select display_name, amount::float8 as amount
            from public.fridge_items
            where household_id = ${householdId}
            order by display_name
        `) as { display_name: string; amount: number }[];
        expect(left.map((row) => [row.display_name, row.amount])).toEqual([
            ["Cheese", 900],
            ["Pasta", 500],
        ]);
    });

    test("a grocery add totals each member's version, against Postgres", async () => {
        const k = await kitchen();
        const settings = liveSettingsStore();
        const store = await createGroceryStore(settings, householdId, "Shop");
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "remove",
            ingredientId: k.cheese.id,
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "add",
            foodId: k.peas,
            amount: 80,
            unit: "g",
        });
        const result = await addRecipeToGrocery({
            recipes: k.recipes,
            grocery: liveGroceryStore(),
            settings,
            foods: k.foods,
            fridgeItems: [],
            householdId,
            recipeId: k.recipe.id,
            storeId: store.id,
            portionCounts: [1, 2],
            members: [
                { userId, portions: 1 },
                { userId: memberId, portions: 2 },
            ],
            variants: k.variants,
        });
        expect(
            Object.fromEntries(
                result.added.map((line) => [line.displayName, line.quantity]),
            ),
        ).toEqual({
            Pasta: { amount: 300, unit: "g" },
            Cheese: { amount: 100, unit: "g" },
            Peas: { amount: 40, unit: "g" },
        });
    });

    test("a swap and an amount saved at once on one ingredient both land", async () => {
        const k = await kitchen();
        const vegan = await seedFood(k.sql, householdId, {
            name: "Vegan cheese",
        });
        for (let i = 0; i < 12; i++) {
            const made = await createRecipe(k.recipes, {
                householdId,
                creatorId: userId,
                name: `Mac ${i}`,
                yieldPortions: 4,
            });
            const cheese = await addRecipeManualIngredient(k.recipes, k.foods, {
                householdId,
                recipeId: made.id,
                name: "Cheese",
                amount: 200,
                unit: "g",
            });
            const mine = {
                householdId,
                recipeId: made.id,
                userId,
                ingredientId: cheese.id,
            };
            await Promise.all([
                setRecipeVariant(k.recipes, k.foods, k.variants, {
                    ...mine,
                    action: "food",
                    foodId: vegan,
                }),
                setRecipeVariant(k.recipes, k.foods, k.variants, {
                    ...mine,
                    action: "amount",
                    amount: 50,
                    unit: "g",
                }),
            ]);
            const [row] = await k.variants.listOverrides(householdId, made.id);
            // Whichever lands first, the swap and the amount are both in the row.
            expect(row).toMatchObject({
                action: "food",
                foodId: vegan,
                amount: 50,
                unit: "g",
            });
        }
    });

    test("a swap with no amount after the person's amount keeps that amount", async () => {
        const k = await kitchen();
        const vegan = await seedFood(k.sql, householdId, {
            name: "Vegan cheese",
        });
        const mine = {
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: k.cheese.id,
        };
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "amount",
            amount: 50,
            unit: "g",
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "food",
            foodId: vegan,
        });
        const rows = await k.variants.listOverrides(householdId, k.recipe.id);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            action: "food",
            foodId: vegan,
            amount: 50,
            unit: "g",
        });
    });

    test("a swap with no amount keeps the amount, or to taste, an earlier swap kept", async () => {
        const k = await kitchen();
        const vegan = await seedFood(k.sql, householdId, {
            name: "Vegan cheese",
        });
        const goat = await seedFood(k.sql, householdId, {
            name: "Goat cheese",
        });
        const mine = {
            householdId,
            recipeId: k.recipe.id,
            userId,
            ingredientId: k.cheese.id,
        };
        const lineOf = async () =>
            variantFor(
                {
                    id: k.recipe.id,
                    ingredients: await k.recipes.listIngredients(
                        householdId,
                        k.recipe.id,
                    ),
                },
                await k.variants.listOverrides(householdId, k.recipe.id),
                userId,
            ).ingredients[1]!;
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "amount",
            amount: 50,
            unit: "g",
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "food",
            foodId: vegan,
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "food",
            foodId: goat,
        });
        expect(await lineOf()).toMatchObject({
            displayName: "Goat cheese",
            quantity: { amount: 50, unit: "g" },
        });
        // To taste survives a swap and a second swap; the base's 200 g does not come back.
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "amount",
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "food",
            foodId: vegan,
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            ...mine,
            action: "food",
            foodId: goat,
        });
        expect(await lineOf()).toMatchObject({
            displayName: "Goat cheese",
            quantity: null,
        });
        expect(await countRows(k.recipe.id)).toBe(1);
    });

    test("a supply is refused in a version and nothing is stored", async () => {
        const k = await kitchen();
        const soap = await seedFood(k.sql, householdId, {
            name: "Dish soap",
            kind: "supply",
        });
        await expect(
            setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "add",
                foodId: soap,
                amount: 1,
                unit: "each",
            }),
        ).rejects.toThrow("That catalog item is a supply.");
        await expect(
            setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "food",
                ingredientId: k.cheese.id,
                foodId: soap,
            }),
        ).rejects.toThrow("That catalog item is a supply.");
        expect(await countRows(k.recipe.id)).toBe(0);
    });

    test("align changes the base and removes the redundant rows in one transaction, against Postgres", async () => {
        const k = await kitchen();
        for (const who of [userId, memberId]) {
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: who,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
        }
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "add",
            foodId: k.peas,
            amount: 90,
            unit: "g",
        });
        const added = await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "add",
            foodId: k.peas,
            amount: 40,
            unit: "g",
        });
        const deps = {
            recipes: k.recipes,
            foods: k.foods,
            variants: k.variants,
            transaction: recipeAlignTransaction(k.recipe.id),
        };
        const first = await alignChange(deps, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            ref: k.cheese.id,
            rowKey: await keyFor(k.recipe.id, userId, k.cheese.id),
        });
        expect(first).toMatchObject({ kind: "amount", removed: 2 });
        const second = await alignChange(deps, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            ref: added.id,
            rowKey: await keyFor(k.recipe.id, userId, added.id),
        });
        expect(second).toMatchObject({
            kind: "added",
            removed: 1,
            converted: 1,
        });
        const ingredients = await k.recipes.listIngredients(
            householdId,
            k.recipe.id,
        );
        expect(
            ingredients.map((row) => [row.displayName, row.quantity]),
        ).toEqual([
            ["Pasta", { amount: 400, unit: "g" }],
            ["Cheese", { amount: 50, unit: "g" }],
            ["Peas", { amount: 40, unit: "g" }],
        ]);
        const left = await k.variants.listOverrides(householdId, k.recipe.id);
        expect(left).toHaveLength(1);
        expect(left[0]).toMatchObject({
            userId: memberId,
            action: "amount",
            ingredientId: ingredients[2]!.id,
            amount: 90,
        });
    });

    test("a failed align leaves the base and every row as they were", async () => {
        const k = await kitchen();
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId,
            action: "add",
            foodId: k.peas,
            amount: 40,
            unit: "g",
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "add",
            foodId: k.peas,
            amount: 90,
            unit: "g",
        });
        const mine = (
            await k.variants.listOverrides(householdId, k.recipe.id)
        ).find((row) => row.userId === userId)!;
        // The last store write fails after the base ingredient was inserted
        // and the person's own row deleted: all of it rolls back.
        const failing = {
            ...k.variants,
            async saveOverride(): Promise<never> {
                throw new Error("boom");
            },
        };
        await expect(
            alignChange(
                {
                    recipes: k.recipes,
                    foods: k.foods,
                    variants: failing,
                    transaction: recipeAlignTransaction(k.recipe.id),
                },
                {
                    householdId,
                    recipeId: k.recipe.id,
                    userId,
                    ref: mine.id,
                    rowKey: await keyFor(k.recipe.id, userId, mine.id),
                },
            ),
        ).rejects.toThrow("boom");
        expect(
            await k.recipes.listIngredients(householdId, k.recipe.id),
        ).toHaveLength(2);
        expect(await countRows(k.recipe.id)).toBe(2);
    });

    test("a version saved while an align is deciding waits for it and is not deleted as redundant, against Postgres", async () => {
        const k = await kitchen();
        // The harness pool is one connection, which would queue the save
        // behind the align by itself: this test needs several, as the app has.
        const url = getCtx().pg.url;
        const appUrl = new URL(url);
        appUrl.username = "foodable_app";
        const wide = new SQL(url, { prepare: false, max: 4 });
        const wideApp = new SQL(appUrl.toString(), {
            prepare: false,
            max: 4,
        });
        pairAppSqlForTests(wide, wideApp);
        setSqlForTests(wide);
        try {
            for (const who of [userId, memberId]) {
                await setRecipeVariant(k.recipes, k.foods, k.variants, {
                    householdId,
                    recipeId: k.recipe.id,
                    userId: who,
                    action: "amount",
                    ingredientId: k.cheese.id,
                    amount: 50,
                    unit: "g",
                });
            }
            // The align has read both rows (so the member's reads as 50 g) and is
            // held there while the member saves 90 g on another connection.
            let release: () => void = () => {};
            const held = new Promise<void>((resolve) => (release = resolve));
            let reading: () => void = () => {};
            const hasRead = new Promise<void>((resolve) => (reading = resolve));
            const paused = {
                ...k.variants,
                async listOverrides(hh: string, recipeId: string) {
                    const snapshot = await k.variants.listOverrides(
                        hh,
                        recipeId,
                    );
                    reading();
                    await held;
                    return snapshot;
                },
            };
            const aligned = alignChange(
                {
                    recipes: k.recipes,
                    foods: k.foods,
                    variants: paused,
                    transaction: recipeAlignTransaction(k.recipe.id),
                },
                {
                    householdId,
                    recipeId: k.recipe.id,
                    userId,
                    ref: k.cheese.id,
                    rowKey: await keyFor(k.recipe.id, userId, k.cheese.id),
                },
            );
            await hasRead;
            let saved = false;
            const saving = setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 90,
                unit: "g",
            }).then((row) => {
                saved = true;
                return row;
            });
            // The save is queued on the align's lock: Postgres says a session
            // is waiting for an advisory lock. Without the lock it commits
            // at once and nothing ever waits.
            let waiting = 0;
            for (
                let attempt = 0;
                attempt < 200 && !saved && !waiting;
                attempt++
            ) {
                const [row] = (await getCtx().sql`
                    select count(*)::int as n from pg_locks
                    where locktype = 'advisory' and not granted
                `) as { n: number }[];
                waiting = row!.n;
            }
            expect(waiting).toBe(1);
            expect(saved).toBe(false);
            release();
            await aligned;
            await saving;
            const left = await k.variants.listOverrides(
                householdId,
                k.recipe.id,
            );
            expect(left.map((row) => [row.userId, row.amount])).toEqual([
                [memberId, 90],
            ]);
            expect(
                (await k.recipes.listIngredients(householdId, k.recipe.id))[1]!
                    .quantity,
            ).toEqual({ amount: 50, unit: "g" });
        } finally {
            setSqlForTests(getCtx().sql);
            await wide.close();
            await wideApp.close();
        }
    });

    /** Several connections, as the app has; the harness pool is one. */
    async function withWidePool(body: () => Promise<void>) {
        const url = getCtx().pg.url;
        const appUrl = new URL(url);
        appUrl.username = "foodable_app";
        const wide = new SQL(url, { prepare: false, max: 4 });
        const wideApp = new SQL(appUrl.toString(), {
            prepare: false,
            max: 4,
        });
        pairAppSqlForTests(wide, wideApp);
        setSqlForTests(wide);
        try {
            await body();
        } finally {
            setSqlForTests(getCtx().sql);
            await wide.close();
            await wideApp.close();
        }
    }

    const settle = <T>(work: Promise<T>) =>
        work.then(
            (value) => ({ ok: true as const, value }),
            (err) => ({
                ok: false as const,
                message: String((err as Error)?.message ?? err),
            }),
        );

    /** An align held just before it updates the base ingredient. */
    function alignHeldAtBaseEdit(
        k: Awaited<ReturnType<typeof kitchen>>,
        ref: string,
        rowKey: string,
    ) {
        let release: () => void = () => {};
        const held = new Promise<void>((resolve) => (release = resolve));
        let reached: () => void = () => {};
        const atEdit = new Promise<void>((resolve) => (reached = resolve));
        const paused = {
            ...k.recipes,
            async updateIngredient(
                row: Parameters<typeof k.recipes.updateIngredient>[0],
            ) {
                reached();
                await held;
                return k.recipes.updateIngredient(row);
            },
        };
        const aligned = settle(
            alignChange(
                {
                    recipes: paused,
                    foods: k.foods,
                    variants: k.variants,
                    transaction: recipeAlignTransaction(k.recipe.id),
                },
                { householdId, recipeId: k.recipe.id, userId, ref, rowKey },
            ),
        );
        return { aligned, atEdit, release };
    }

    test("an align and removing the same ingredient both finish, whichever starts first, against Postgres", async () => {
        await withWidePool(async () => {
            // The align is held after it has started and before its base edit.
            const first = await kitchen();
            await setRecipeVariant(first.recipes, first.foods, first.variants, {
                householdId,
                recipeId: first.recipe.id,
                userId,
                action: "amount",
                ingredientId: first.cheese.id,
                amount: 50,
                unit: "g",
            });
            const a = alignHeldAtBaseEdit(
                first,
                first.cheese.id,
                await keyFor(first.recipe.id, userId, first.cheese.id),
            );
            await a.atEdit;
            const removing = settle(
                removeRecipeIngredient(
                    first.recipes,
                    householdId,
                    first.recipe.id,
                    first.cheese.id,
                ),
            );
            await waitForLockWaiters(getCtx().sql, 1);
            a.release();
            const [aligned, removed] = await Promise.all([a.aligned, removing]);
            expect(aligned).toMatchObject({ ok: true });
            expect(removed).toEqual({ ok: true, value: true });
            expect(
                (
                    await first.recipes.listIngredients(
                        householdId,
                        first.recipe.id,
                    )
                ).map((row) => row.displayName),
            ).toEqual(["Pasta"]);
        });
    });

    test("removing an ingredient that is in flight when an align starts makes the align say it is gone, and nothing deadlocks, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
            let release: () => void = () => {};
            const held = new Promise<void>((resolve) => (release = resolve));
            let reached: () => void = () => {};
            const removedRow = new Promise<void>(
                (resolve) => (reached = resolve),
            );
            const pausedRemove = {
                ...k.recipes,
                deleteIngredient: (hh: string, id: string) =>
                    run(async () => {
                        const done = await k.recipes.deleteIngredient(hh, id);
                        reached();
                        await held;
                        return done;
                    }),
            };
            const removing = settle(
                removeRecipeIngredient(
                    pausedRemove,
                    householdId,
                    k.recipe.id,
                    k.cheese.id,
                ),
            );
            await removedRow;
            const aligned = settle(
                alignChange(
                    {
                        recipes: k.recipes,
                        foods: k.foods,
                        variants: k.variants,
                        transaction: recipeAlignTransaction(k.recipe.id),
                    },
                    {
                        householdId,
                        recipeId: k.recipe.id,
                        userId,
                        ref: k.cheese.id,
                        rowKey: await keyFor(k.recipe.id, userId, k.cheese.id),
                    },
                ),
            );
            await waitForLockWaiters(getCtx().sql, 1);
            release();
            const [removed, result] = await Promise.all([removing, aligned]);
            expect(removed).toEqual({ ok: true, value: true });
            expect(result).toEqual({
                ok: false,
                message: "That change no longer exists.",
            });
        });
    });

    test("a base edit that commits while an align waits on the ingredient's row decides what the align pins others to, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            // Alice: 50 g. Bob: peas, following the base amount.
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                action: "food",
                ingredientId: k.cheese.id,
                foodId: k.peas,
            });
            const rowKey = await keyFor(k.recipe.id, userId, k.cheese.id);
            // Someone edits the base cheese to 300 g and has not committed.
            const holder = new SQL(getCtx().pg.url, {
                prepare: false,
                max: 1,
            });
            const reserved = await holder.reserve();
            await reserved`begin`;
            await reserved`update public.recipe_ingredients set amount = 300 where id = ${k.cheese.id}::uuid`;
            const aligned = settle(
                alignChange(
                    {
                        recipes: k.recipes,
                        foods: k.foods,
                        variants: k.variants,
                        transaction: recipeAlignTransaction(k.recipe.id),
                    },
                    {
                        householdId,
                        recipeId: k.recipe.id,
                        userId,
                        ref: k.cheese.id,
                        rowKey,
                    },
                ),
            );
            await waitForLockWaiters(getCtx().sql, 1);
            await reserved`commit`;
            reserved.release();
            await holder.close();
            expect(await aligned).toMatchObject({ ok: true });
            const base = await k.recipes.listIngredients(
                householdId,
                k.recipe.id,
            );
            expect(
                base.find((row) => row.id === k.cheese.id)?.quantity,
            ).toEqual({ amount: 50, unit: "g" });
            // Bob cooked peas at the base amount he saw last, 300 g, and
            // still does.
            const bob = variantFor(
                { id: k.recipe.id, ingredients: base },
                await k.variants.listOverrides(householdId, k.recipe.id),
                memberId,
            ).ingredients.find(
                (line) => line.baseIngredientId === k.cheese.id,
            )!;
            expect({ foodId: bob.foodId, quantity: bob.quantity }).toEqual({
                foodId: k.peas,
                quantity: { amount: 300, unit: "g" },
            });
        });
    });

    test("an align and deleting the recipe both finish, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
            const a = alignHeldAtBaseEdit(
                k,
                k.cheese.id,
                await keyFor(k.recipe.id, userId, k.cheese.id),
            );
            await a.atEdit;
            const deleting = settle(
                deleteRecipe(k.recipes, householdId, k.recipe.id, {
                    userId,
                    isOwner: true,
                }),
            );
            await waitForLockWaiters(getCtx().sql, 1);
            a.release();
            const [aligned, deleted] = await Promise.all([a.aligned, deleting]);
            expect(aligned).toMatchObject({ ok: true });
            expect(deleted).toMatchObject({ ok: true });
            expect(
                await k.recipes.getRecipe(householdId, k.recipe.id),
            ).toBeNull();
        });
    });

    test("an align and a food merge's repoint both finish, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            const other = await seedFood(k.sql, householdId, {
                name: "Cheddar",
            });
            // Alice's row names the food the base ingredient already is, so
            // the merge of that food reaches the ingredient and her row.
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "food",
                ingredientId: k.cheese.id,
                foodId: k.cheese.foodId!,
                amount: 150,
                unit: "g",
            });
            const a = alignHeldAtBaseEdit(
                k,
                k.cheese.id,
                await keyFor(k.recipe.id, userId, k.cheese.id),
            );
            await a.atEdit;
            const merging = settle(
                k.foods.repointFoodRefs(householdId, k.cheese.foodId!, other),
            );
            await waitForLockWaiters(getCtx().sql, 1);
            a.release();
            const [aligned, merged] = await Promise.all([a.aligned, merging]);
            expect(aligned).toMatchObject({ ok: true });
            expect(merged).toMatchObject({ ok: true });
        });
    });

    test("an align named by an upper-case recipe id waits on the same lock as every version write, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            const holder = new SQL(getCtx().pg.url, {
                prepare: false,
                max: 1,
            });
            try {
                // What a version save holds while it writes: the shared lock
                // on the recipe's (lower-case) id.
                let release: () => void = () => {};
                const released = new Promise<void>((r) => (release = r));
                let held: () => void = () => {};
                const isHeld = new Promise<void>((r) => (held = r));
                const holding = holder.begin(async (tx) => {
                    await tx`select pg_advisory_xact_lock_shared(hashtextextended(${`recipe-align:${k.recipe.id}`}, 0))`;
                    held();
                    await released;
                });
                await isHeld;
                const ran = recipeAlignTransaction(k.recipe.id.toUpperCase())(
                    async () => "ran",
                );
                // It queues behind the save; under a different key it would
                // not wait and this would time out.
                await waitForLockWaiters(getCtx().sql, 1);
                release();
                await holding;
                expect(await ran).toBe("ran");
            } finally {
                await holder.close();
            }
        });
    });

    test("an align on an unverified recipe and the stale-unverified sweep both finish, whichever reaches the recipe first, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
            await getCtx()
                .sql`update public.recipes set verification = 'unverified', updated_at = now() - interval '40 days' where id = ${k.recipe.id}`;
            const row = (
                await k.variants.listOverrides(householdId, k.recipe.id)
            )[0]!;
            let release: () => void = () => {};
            const held = new Promise<void>((r) => (release = r));
            let reached: () => void = () => {};
            const atEdit = new Promise<void>((r) => (reached = r));
            const paused = {
                ...k.recipes,
                async updateIngredient(
                    r: Parameters<typeof k.recipes.updateIngredient>[0],
                ) {
                    reached();
                    await held;
                    return k.recipes.updateIngredient(r);
                },
            };
            const aligned = settle(
                alignChange(
                    {
                        recipes: paused,
                        foods: k.foods,
                        variants: k.variants,
                        transaction: recipeAlignTransaction(k.recipe.id),
                    },
                    {
                        householdId,
                        recipeId: k.recipe.id,
                        userId,
                        ref: k.cheese.id,
                        rowKey: overrideKey(row),
                    },
                ),
            );
            await atEdit;
            const sweeping = settle(
                sweepUnverifiedRecipes({
                    households: [
                        {
                            id: householdId,
                            preferences: { unverifiedRecipeExpiryDays: 30 },
                        },
                    ],
                    recipes: k.recipes,
                    now: new Date(),
                }),
            );
            await waitForLockWaiters(getCtx().sql, 1);
            release();
            const [a, s] = await Promise.all([aligned, sweeping]);
            expect(a).toMatchObject({ ok: true });
            expect(s).toMatchObject({ ok: true });
        });
    });

    test("an align that rewrites a person's row and that person's account deletion both finish, whichever reaches the person first, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            const gouda = (
                await addRecipeManualIngredient(k.recipes, k.foods, {
                    householdId,
                    recipeId: k.recipe.id,
                    name: "Gouda",
                    amount: 1,
                    unit: "g",
                })
            ).foodId!;
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "food",
                ingredientId: k.cheese.id,
                foodId: gouda,
                amount: 150,
                unit: "g",
            });
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
            const row = (
                await k.variants.listOverrides(householdId, k.recipe.id)
            ).find((r) => r.userId === userId)!;
            let release: () => void = () => {};
            const held = new Promise<void>((r) => (release = r));
            let reached: () => void = () => {};
            const atSave = new Promise<void>((r) => (reached = r));
            const paused = {
                ...k.variants,
                async saveOverride(
                    r: Parameters<typeof k.variants.saveOverride>[0],
                ) {
                    reached();
                    await held;
                    return k.variants.saveOverride(r);
                },
            };
            const aligned = settle(
                alignChange(
                    {
                        recipes: k.recipes,
                        foods: k.foods,
                        variants: paused,
                        transaction: recipeAlignTransaction(k.recipe.id),
                    },
                    {
                        householdId,
                        recipeId: k.recipe.id,
                        userId,
                        ref: k.cheese.id,
                        rowKey: overrideKey(row),
                    },
                ),
            );
            await atSave;
            const other = new SQL(getCtx().pg.url, { prepare: false, max: 1 });
            try {
                const deleting = settle(
                    (async () => {
                        await other.begin((tx) => deleteAuthUser(memberId, tx));
                    })(),
                );
                await waitForLockWaiters(getCtx().sql, 1);
                release();
                const [a, d] = await Promise.all([aligned, deleting]);
                expect(a).toMatchObject({ ok: true });
                expect(d).toMatchObject({ ok: true });
            } finally {
                await other.close();
            }
        });
    });

    test("an account deletion that is under way holds an align back, and neither deadlocks, against Postgres", async () => {
        await withWidePool(async () => {
            const k = await kitchen();
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 50,
                unit: "g",
            });
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                action: "amount",
                ingredientId: k.cheese.id,
                amount: 20,
                unit: "g",
            });
            const row = (
                await k.variants.listOverrides(householdId, k.recipe.id)
            ).find((r) => r.userId === userId)!;
            const other = new SQL(getCtx().pg.url, { prepare: false, max: 1 });
            let release: () => void = () => {};
            const held = new Promise<void>((r) => (release = r));
            let deletedRow: () => void = () => {};
            const isDeleted = new Promise<void>((r) => (deletedRow = r));
            try {
                const deleting = settle(
                    other.begin(async (tx) => {
                        await deleteAuthUser(memberId, tx);
                        deletedRow();
                        await held;
                    }),
                );
                await isDeleted;
                const aligned = settle(
                    alignChange(
                        {
                            recipes: k.recipes,
                            foods: k.foods,
                            variants: k.variants,
                            transaction: recipeAlignTransaction(k.recipe.id),
                        },
                        {
                            householdId,
                            recipeId: k.recipe.id,
                            userId,
                            ref: k.cheese.id,
                            rowKey: overrideKey(row),
                        },
                    ),
                );
                await waitForLockWaiters(getCtx().sql, 1);
                release();
                const [a, d] = await Promise.all([aligned, deleting]);
                expect(d).toMatchObject({ ok: true });
                expect(a).toMatchObject({ ok: true });
            } finally {
                release();
                await other.close();
            }
        });
    });

    test("deleteOverrideIfUnchanged deletes a row only while it says what was read, against Postgres", async () => {
        const k = await kitchen();
        const row = await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "amount",
            ingredientId: k.cheese.id,
            amount: 12.345678,
            unit: "g",
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "amount",
            ingredientId: k.cheese.id,
            amount: 50,
            unit: "g",
        });
        expect(
            await k.variants.deleteOverrideIfUnchanged(householdId, row),
        ).toBe(false);
        expect(await countRows(k.recipe.id)).toBe(1);
        const [current] = await k.variants.listOverrides(
            householdId,
            k.recipe.id,
        );
        expect(
            await k.variants.deleteOverrideIfUnchanged(householdId, current!),
        ).toBe(true);
        expect(await countRows(k.recipe.id)).toBe(0);
        expect(
            await k.variants.deleteOverrideIfUnchanged(householdId, current!),
        ).toBe(false);
    });

    test("reset removes one person's rows on the recipe and no one else's, against Postgres", async () => {
        const k = await kitchen();
        for (const who of [userId, memberId]) {
            await setRecipeVariant(k.recipes, k.foods, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: who,
                action: "remove",
                ingredientId: k.cheese.id,
            });
        }
        const { rowKeys } = await previewReset(k.recipes, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
        });
        expect(
            await resetVariant(k.recipes, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                rowKeys,
                transaction: recipeAlignTransaction(k.recipe.id),
            }),
        ).toBe(1);
        const left = await k.variants.listOverrides(householdId, k.recipe.id);
        expect(left.map((row) => row.userId)).toEqual([userId]);
    });

    test("a reset confirm takes only the rows the preview showed: one saved since is refused and kept, against Postgres", async () => {
        const k = await kitchen();
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "amount",
            ingredientId: k.cheese.id,
            amount: 50,
            unit: "g",
        });
        const { rowKeys } = await previewReset(k.recipes, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
        });
        expect(rowKeys).toHaveLength(1);
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "amount",
            ingredientId: k.pasta.id,
            amount: 100,
            unit: "g",
        });
        await expect(
            resetVariant(k.recipes, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                rowKeys,
                transaction: recipeAlignTransaction(k.recipe.id),
            }),
        ).rejects.toThrow("Their version changed; look again.");
        expect(await countRows(k.recipe.id)).toBe(2);
        // The same row saved again (same content) is a different row to a confirm.
        const fresh = await previewReset(k.recipes, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
        });
        await setRecipeVariant(k.recipes, k.foods, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
            action: "amount",
            ingredientId: k.pasta.id,
            amount: 100,
            unit: "g",
        });
        await expect(
            resetVariant(k.recipes, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                rowKeys: fresh.rowKeys,
            }),
        ).rejects.toThrow("Their version changed; look again.");
        const now = await previewReset(k.recipes, k.variants, {
            householdId,
            recipeId: k.recipe.id,
            userId: memberId,
        });
        expect(
            await resetVariant(k.recipes, k.variants, {
                householdId,
                recipeId: k.recipe.id,
                userId: memberId,
                rowKeys: now.rowKeys,
            }),
        ).toBe(2);
    });
});
