import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createRecipe } from "../domain/recipes.js";
import { recipeImportToRow } from "../domain/recipe-import.js";
import { liveRecipesStore, recipeImportSqlValues } from "./recipes.js";
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
});
