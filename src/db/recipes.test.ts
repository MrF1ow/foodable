import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { liveFoodsStore } from "./foods.js";
import { importRecipeFromUrl } from "../domain/recipe-import.js";
import { createRecipe } from "../domain/recipes.js";
import { recipeImportToRow } from "../domain/recipe-import.js";
import type { SafeFetcher } from "../fetch-safe.js";
import { liveRecipesStore, recipeImportSqlValues } from "./recipes.js";
import { run } from "./sql.js";
import { describeDb } from "./testing/pg.js";
import { seedHousehold } from "./testing/fixtures.js";
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
            importedAt: "2026-01-01T12:00:00.000Z",
        });
        expect(saved.unresolvedLines).toEqual(["mystery line"]);
        expect(saved.problems).toHaveLength(1);
        const loaded = await store.getImport(householdId, recipe.id);
        expect(loaded?.unresolvedLines).toEqual(["mystery line"]);
        expect(loaded?.problems[0]?.code).toBe("no_instructions");
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
        const yoast = readFileSync(
            join(
                import.meta.dir,
                "../domain/fixtures/recipe-pages/array-top-level.html",
            ),
            "utf8",
        );
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
    });

    test("importRecipeFromUrl rolls back recipe ingredients import row and new foods on failure", async () => {
        const { sql } = getCtx();
        const yoast = readFileSync(
            join(
                import.meta.dir,
                "../domain/fixtures/recipe-pages/yoast-graph.html",
            ),
            "utf8",
        );
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
