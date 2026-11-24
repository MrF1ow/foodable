import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { liveFoodsStore } from "./foods.js";
import { importRecipeFromUrl } from "../domain/recipe-import.js";
import {
    addRecipeManualIngredient,
    addRecipeToGrocery,
    createRecipe,
    deleteRecipe,
    removeRecipeIngredient,
    updateRecipeIngredient,
} from "../domain/recipes.js";
import {
    clearRecipeVariant,
    recipeNeeds,
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
import { findPgBin } from "./testing/pg-temp.js";
import { setSqlForTests } from "./sql.js";

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
});
