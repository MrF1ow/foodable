import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, describe } from "bun:test";
import { TOASTS } from "../copy/toasts.js";
import type { FetchFailure, SafeFetcher } from "../fetch-safe.js";
import { createMemoryFoodsStore } from "./foods.js";
import {
    importOutcomeMessage,
    importRecipeFromUrl,
    importReviewCount,
    isNotMeasuredNote,
    outcomeFromFetchFailure,
    recheckRecipe,
    recipeImportFromRow,
    recipeImportToRow,
    sweepUnverifiedRecipes,
    type RecipeImportOutcome,
    type RecipeImportStatus,
    verifyRecipe,
} from "./recipe-import.js";
import {
    createMemoryRecipesStore,
    type Recipe,
    type RecipeIngredient,
} from "./recipes.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures/recipe-pages");
function loadFixture(name: string): string {
    return readFileSync(join(FIXTURE_DIR, `${name}.html`), "utf8");
}

function fakeFetcher(opts: {
    robots?: boolean;
    fetch?: (url: string) =>
        | {
              ok: true;
              body: string;
          }
        | {
              ok: false;
              reason: FetchFailure;
          };
}): SafeFetcher & { calls: { robots: number; fetch: number } } {
    const calls = { robots: 0, fetch: 0 };
    return {
        calls,
        async robotsAllows() {
            calls.robots += 1;
            return opts.robots ?? true;
        },
        async fetchPage(url) {
            calls.fetch += 1;
            const result = opts.fetch?.(
                typeof url === "string" ? url : url.href,
            );
            if (!result) {
                return {
                    ok: true as const,
                    url: typeof url === "string" ? url : url.href,
                    status: 200,
                    contentType: "text/html",
                    body: loadFixture("array-top-level"),
                };
            }
            if (result.ok) {
                return {
                    ok: true as const,
                    url: typeof url === "string" ? url : url.href,
                    status: 200,
                    contentType: "text/html",
                    body: result.body,
                };
            }
            return {
                ok: false as const,
                reason: result.reason,
                status: result.reason === "not_found" ? 404 : 403,
                detail: result.reason,
            };
        },
    } as SafeFetcher & { calls: { robots: number; fetch: number } };
}

const HH = "11111111-1111-1111-1111-111111111111";
const USER = "00000000-0000-0000-0000-0000000000a1";

function baseRecipe(overrides: Partial<Recipe> = {}): Recipe {
    return {
        id: "r1",
        householdId: HH,
        creatorId: USER,
        name: "Soup",
        yieldPortions: 2,
        instructions: "1. Simmer.",
        sourceUrl: null,
        tags: [],
        notes: null,
        prepMinutes: null,
        cookMinutes: null,
        verification: "unverified",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function ingredient(
    overrides: Partial<RecipeIngredient> = {},
): RecipeIngredient {
    return {
        id: "i1",
        householdId: HH,
        recipeId: "r1",
        kind: "food",
        displayName: "Salt",
        quantity: { amount: 1, unit: "g" },
        foodId: "f1",
        sortOrder: 0,
        note: null,
        ...overrides,
    };
}

test("verifyRecipe passes for a complete recipe without nutrition", () => {
    const result = verifyRecipe(baseRecipe(), [ingredient()], {
        recipeId: "r1",
        householdId: HH,
        sourceKind: "text",
        sourceUrl: null,
        sourceText: "paste",
        sourceTextOrigin: "pasted",
        transcript: null,
        credit: null,
        unresolvedLines: [],
        problems: [],
        importedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(result.verified).toBe(true);
    expect(result.problems).toEqual([]);
});

test("verifyRecipe failing rules", () => {
    expect(
        verifyRecipe(baseRecipe({ name: "  " }), [], null).problems[0]?.code,
    ).toBe("no_name");
    expect(verifyRecipe(baseRecipe(), [], null).problems[0]?.code).toBe(
        "no_ingredients",
    );
    expect(
        verifyRecipe(baseRecipe(), [ingredient({ foodId: null })], null)
            .problems[0]?.code,
    ).toBe("ingredient_no_food");
    expect(
        verifyRecipe(
            baseRecipe(),
            [ingredient({ quantity: null, note: null })],
            null,
        ).problems[0]?.code,
    ).toBe("ingredient_no_amount");
    expect(
        verifyRecipe(
            baseRecipe(),
            [ingredient({ quantity: null, note: "to taste" })],
            null,
        ).verified,
    ).toBe(true);
    expect(
        verifyRecipe(baseRecipe(), [ingredient()], {
            recipeId: "r1",
            householdId: HH,
            sourceKind: "text",
            sourceUrl: null,
            sourceText: null,
            sourceTextOrigin: null,
            transcript: null,
            credit: null,
            unresolvedLines: ["bad line"],
            problems: [],
            importedAt: "2026-01-01T00:00:00.000Z",
        }).problems[0]?.code,
    ).toBe("unresolved_lines");
    expect(
        verifyRecipe(baseRecipe({ instructions: null }), [ingredient()], null)
            .problems[0]?.code,
    ).toBe("no_instructions");
});

test("recipe import row mappers round-trip", () => {
    const row = {
        recipeId: "r1",
        householdId: HH,
        sourceKind: "text" as const,
        sourceUrl: null,
        sourceText: "hello",
        sourceTextOrigin: "pasted" as const,
        transcript: null,
        credit: null,
        unresolvedLines: ["x"],
        problems: [
            {
                code: "no_instructions" as const,
                message: "Add the steps.",
                ingredientId: null,
                line: null,
            },
        ],
        importedAt: "2026-01-01T00:00:00.000Z",
    };
    const mapped = recipeImportFromRow(recipeImportToRow(row) as never);
    expect(mapped.sourceText).toBe("hello");
    expect(mapped.unresolvedLines).toEqual(["x"]);
    expect(mapped.problems[0]?.code).toBe("no_instructions");
});

test("sweepUnverifiedRecipes respects expiry", async () => {
    const store = createMemoryRecipesStore();
    const old = await store.insertRecipe({
        ...baseRecipe({ id: "old", name: "Old", verification: "unverified" }),
        updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const recent = await store.insertRecipe({
        ...baseRecipe({
            id: "recent",
            name: "Recent",
            verification: "unverified",
        }),
        updatedAt: "2026-05-20T00:00:00.000Z",
    });
    const verified = await store.insertRecipe({
        ...baseRecipe({ id: "ok", name: "Verified", verification: "verified" }),
        updatedAt: "2020-01-01T00:00:00.000Z",
    });
    const recipes = store;
    const deleted = await sweepUnverifiedRecipes({
        households: [
            { id: HH, preferences: { unverifiedRecipeExpiryDays: 30 } },
        ],
        recipes,
        now: new Date("2026-06-01T00:00:00.000Z"),
    });
    expect(deleted).toBe(1);
    expect(await recipes.getRecipe(HH, old.id)).toBeNull();
    expect(await recipes.getRecipe(HH, recent.id)).not.toBeNull();
    expect(await recipes.getRecipe(HH, verified.id)).not.toBeNull();
    expect(
        await sweepUnverifiedRecipes({
            households: [
                { id: HH, preferences: { unverifiedRecipeExpiryDays: null } },
            ],
            recipes,
            now: new Date(),
        }),
    ).toBe(0);
});

test("only a not-measured phrase counts as an explicit missing amount", () => {
    expect(isNotMeasuredNote("to taste")).toBe(true);
    expect(isNotMeasuredNote("Salt and pepper, to  taste")).toBe(true);
    expect(isNotMeasuredNote("for garnish")).toBe(true);
    expect(isNotMeasuredNote("boneless")).toBe(false);
    expect(isNotMeasuredNote("awesome")).toBe(false);
    expect(isNotMeasuredNote("")).toBe(false);
    expect(isNotMeasuredNote(null)).toBe(false);
    const prep = verifyRecipe(
        baseRecipe(),
        [ingredient({ quantity: null, note: "boneless" })],
        null,
    );
    expect(prep.verified).toBe(false);
    expect(prep.problems.map((row) => row.code)).toEqual([
        "ingredient_no_amount",
    ]);
});

test("recheckRecipe never demotes a hand-made recipe", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await store.insertRecipe(
        baseRecipe({ instructions: null, verification: "verified" }),
    );
    const result = await recheckRecipe(store, HH, recipe.id);
    expect(result.verified).toBe(false);
    expect(result.verification).toBe("verified");
    expect(result.problems.map((row) => row.code)).toContain("no_ingredients");
    expect((await store.getRecipe(HH, recipe.id))?.verification).toBe(
        "verified",
    );
});

describe("outcomeFromFetchFailure", () => {
    const cases: [FetchFailure, RecipeImportStatus][] = [
        ["robots_disallowed", "robots_disallowed"],
        ["site_refused", "site_refused"],
        ["not_found", "not_found"],
        ["timeout", "timeout"],
        ["network_error", "timeout"],
        ["invalid_link", "invalid_link"],
        ["blocked_address", "invalid_link"],
        ["too_large", "no_recipe_on_page"],
        ["bad_content_type", "no_recipe_on_page"],
        ["http_error", "site_refused"],
        ["too_many_redirects", "site_refused"],
    ];
    for (const [reason, status] of cases) {
        test(`${reason} → ${status}`, () => {
            expect(outcomeFromFetchFailure(reason)).toBe(status);
        });
    }
});

test("importReviewCount phrasing", () => {
    expect(
        importReviewCount([
            {
                code: "ingredient_no_amount",
                message: "a",
                ingredientId: "1",
                line: null,
            },
            {
                code: "ingredient_no_amount",
                message: "b",
                ingredientId: "2",
                line: null,
            },
        ]),
    ).toBe("2 ingredients");
    expect(
        importReviewCount([
            {
                code: "ingredient_no_amount",
                message: "a",
                ingredientId: "1",
                line: null,
            },
        ]),
    ).toBe("1 ingredient");
    expect(
        importReviewCount([
            {
                code: "no_instructions",
                message: "Add the steps.",
                ingredientId: null,
                line: null,
            },
        ]),
    ).toBe("the steps");
});

const ALL_IMPORT_STATUSES: RecipeImportStatus[] = [
    "imported",
    "unverified_needs_review",
    "paste_needed",
    "no_recipe_in_text",
    "no_recipe_on_page",
    "robots_disallowed",
    "site_refused",
    "not_found",
    "timeout",
    "duplicate",
    "invalid_link",
];

test("every import status has toast copy and importOutcomeMessage", () => {
    for (const status of ALL_IMPORT_STATUSES) {
        const outcome: RecipeImportOutcome = {
            status,
            recipeId: status === "duplicate" ? "r-dup" : "r1",
            recipeName: "Test Soup",
            verification: status === "imported" ? "verified" : "unverified",
            problems:
                status === "unverified_needs_review"
                    ? [
                          {
                              code: "ingredient_no_amount",
                              message: "x",
                              ingredientId: "i1",
                              line: null,
                          },
                          {
                              code: "ingredient_no_amount",
                              message: "y",
                              ingredientId: "i2",
                              line: null,
                          },
                      ]
                    : [],
            source: {
                kind: status === "paste_needed" ? "instagram" : "website",
                url: "https://example.com/r",
                label: "example.com",
            },
            unresolvedLines: [],
            readerFailure: status === "paste_needed" ? null : null,
        };
        const msg = importOutcomeMessage(outcome);
        expect(msg.length).toBeGreaterThan(0);
        expect(msg).not.toMatch(/\{[a-z_]+\}/);
    }
    for (const key of Object.keys(TOASTS)) {
        if (key.startsWith("recipes.import.")) {
            expect(
                TOASTS[key as keyof typeof TOASTS].text.length,
            ).toBeGreaterThan(0);
        }
    }
});

describe("importRecipeFromUrl", () => {
    test("imports JSON-LD as verified with ordered ingredients", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const fetcher = fakeFetcher({});
        const result = await importRecipeFromUrl(
            { recipes, foods, fetcher },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://natashaskitchen.com/soup",
            },
        );
        expect(result.status).toBe("imported");
        expect(result.verification).toBe("verified");
        expect(fetcher.calls.fetch).toBe(1);
        const ingredients = await recipes.listIngredients(HH, result.recipeId!);
        expect(ingredients.map((row) => row.displayName)).toEqual(["rice"]);
        expect(ingredients[0]?.quantity?.amount).toBe(1);
        expect(ingredients[0]?.quantity?.unit).toBe("cup");
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceKind).toBe("website");
        expect(imp?.sourceText).toBeNull();
        expect(imp?.sourceUrl).toBe("https://natashaskitchen.com/soup");
    });

    test("run-together line stays unverified with unresolved lines", async () => {
        const html = `<!doctype html><html><head><script type="application/ld+json">{"@type":"Recipe","name":"Run Together","recipeIngredient":["2 cups flour","1.5 lb Chicken Breast 50g Egg Whites"],"recipeInstructions":["Mix"]}</script></head></html>`;
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods,
                fetcher: fakeFetcher({
                    fetch: () => ({ ok: true, body: html }),
                }),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/run-together",
            },
        );
        expect(result.status).toBe("unverified_needs_review");
        expect(result.unresolvedLines).toEqual([
            "1.5 lb Chicken Breast 50g Egg Whites",
        ]);
        expect(result.problems.length).toBeGreaterThan(0);
    });

    test("duplicate skips fetcher", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const fetcher = fakeFetcher({});
        const url = "https://example.com/recipe?utm_source=newsletter";
        const first = await importRecipeFromUrl(
            { recipes, foods, fetcher },
            { householdId: HH, creatorId: USER, url },
        );
        expect(first.status).toBe("imported");
        const dup = await importRecipeFromUrl(
            { recipes, foods, fetcher },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/recipe?utm_medium=email",
            },
        );
        expect(dup.status).toBe("duplicate");
        expect(dup.recipeId).toBe(first.recipeId);
        expect(fetcher.calls.fetch).toBe(1);
        expect(fetcher.calls.robots).toBe(1);
    });

    test.each([
        "https://www.instagram.com/p/abc/?igsh=x",
        "https://vm.tiktok.com/ZM1/",
        "https://pin.it/x",
        "https://fb.watch/x/",
    ] as const)(
        "social %s is paste_needed with zero fetcher calls",
        async (url) => {
            const fetcher = fakeFetcher({});
            const result = await importRecipeFromUrl(
                {
                    recipes: createMemoryRecipesStore(),
                    foods: createMemoryFoodsStore(),
                    fetcher,
                },
                { householdId: HH, creatorId: USER, url },
            );
            expect(result.status).toBe("paste_needed");
            expect(fetcher.calls.robots).toBe(0);
            expect(fetcher.calls.fetch).toBe(0);
        },
    );

    test("paste-only site list is paste_needed without fetch", async () => {
        const fetcher = fakeFetcher({});
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                pasteOnlySites: ["blocked-recipes.test"],
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.blocked-recipes.test/dinner",
            },
        );
        expect(result.status).toBe("paste_needed");
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("robots disallow does not fetch page", async () => {
        const fetcher = fakeFetcher({ robots: false });
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/no-robots",
            },
        );
        expect(result.status).toBe("robots_disallowed");
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("403 site_refused", async () => {
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({
                    fetch: () => ({ ok: false, reason: "site_refused" }),
                }),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/err",
            },
        );
        expect(result.status).toBe("site_refused");
    });

    test("404 not_found", async () => {
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({
                    fetch: () => ({ ok: false, reason: "not_found" }),
                }),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/missing",
            },
        );
        expect(result.status).toBe("not_found");
    });

    test("timeout from fetch failure", async () => {
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: false, reason: "timeout" }),
        });
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/slow",
            },
        );
        expect(result.status).toBe("timeout");
    });

    test("no JSON-LD leaves nothing saved", async () => {
        const recipes = createMemoryRecipesStore();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: true, body: loadFixture("no-recipe") }),
        });
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/empty",
            },
        );
        expect(result.status).toBe("no_recipe_on_page");
        expect(await recipes.listRecipes(HH)).toHaveLength(0);
    });

    test("transaction rollback leaves no recipes foods or import rows", async () => {
        const base = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        let ingredientInserts = 0;
        const recipes = {
            ...base,
            async insertIngredient(
                row: Parameters<typeof base.insertIngredient>[0],
            ) {
                ingredientInserts += 1;
                if (ingredientInserts === 3) {
                    throw new Error("insert failed");
                }
                return base.insertIngredient(row);
            },
        };
        const recipeIdsBefore = new Set(
            (await base.listRecipes(HH)).map((row) => row.id),
        );
        const foodIdsBefore = new Set(
            (await foods.listFoods(HH)).map((row) => row.id),
        );
        const rollback = async <T>(fn: () => Promise<T>): Promise<T> => {
            try {
                return await fn();
            } catch {
                for (const row of await base.listRecipes(HH)) {
                    if (!recipeIdsBefore.has(row.id)) {
                        await base.deleteRecipe(HH, row.id);
                    }
                }
                for (const row of await foods.listFoods(HH)) {
                    if (!foodIdsBefore.has(row.id)) {
                        await foods.updateFoodRow({
                            ...row,
                            archivedAt: new Date().toISOString(),
                        });
                    }
                }
                throw new Error("rolled back");
            }
        };
        await expect(
            importRecipeFromUrl(
                {
                    recipes,
                    foods,
                    fetcher: fakeFetcher({
                        fetch: () => ({
                            ok: true,
                            body: loadFixture("yoast-graph"),
                        }),
                    }),
                    transaction: rollback,
                },
                {
                    householdId: HH,
                    creatorId: USER,
                    url: "https://example.com/rollback",
                },
            ),
        ).rejects.toThrow("rolled back");
        expect((await base.listRecipes(HH)).length).toBe(recipeIdsBefore.size);
        expect(
            (await foods.listFoods(HH)).filter((f) => !foodIdsBefore.has(f.id)),
        ).toHaveLength(0);
    });
});
