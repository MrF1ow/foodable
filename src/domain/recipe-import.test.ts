import { join } from "node:path";
import { test, expect, describe } from "bun:test";
import { TOASTS } from "../copy/toasts.js";
import type { FetchFailure, SafeFetcher } from "../fetch-safe.js";
import { createMemoryFoodsStore, findOrCreateManualFood } from "./foods.js";
import {
    importOutcomeMessage,
    importOutcomeToastKey,
    importRecipeFromUrl,
    importRecipeFromSharedText,
    importRecipeFromUrlAnalyticsOutcome,
    importReviewCount,
    isNotMeasuredNote,
    outcomeFromFetchFailure,
    recheckRecipe,
    resolveUnresolvedLines,
    safeSourceUrl,
    recipeDisplaySource,
    recipeImportFromRow,
    recipeImportToRow,
    sweepUnverifiedRecipes,
    type RecipeImportOutcome,
    type RecipeImportStatus,
    verifyRecipe,
    prepareImportedRecipe,
} from "./recipe-import.js";
import {
    createMemoryRecipesStore,
    createRecipe,
    RecipeInputError,
    updateRecipe,
    type Recipe,
    type RecipeIngredient,
} from "./recipes.js";
import { createMemorySocialReaderStatusStore } from "./social-readers.js";
import { createMemoryFetchMemoryStore, deadLinkHash } from "./fetch-memory.js";
import {
    readerFailureSentence,
    readerNoRecipeSentence,
} from "../copy/social-readers.js";

const FIXTURE_DIR = join(import.meta.dir, "fixtures/recipe-pages");
const FIXTURES = new Map<string, string>();
for await (const file of new Bun.Glob("*.html").scan(FIXTURE_DIR)) {
    FIXTURES.set(file, await Bun.file(join(FIXTURE_DIR, file)).text());
}
const CAPTION_DIR = join(import.meta.dir, "fixtures/captions");
function loadFixture(name: string): string {
    const html = FIXTURES.get(`${name}.html`);
    if (html == null) throw new Error(`Missing fixture ${name}.html`);
    return html;
}
const CAPTIONS = new Map<string, string>();
for await (const file of new Bun.Glob("*.txt").scan(CAPTION_DIR)) {
    CAPTIONS.set(file, await Bun.file(join(CAPTION_DIR, file)).text());
}
function loadCaption(name: string): string {
    const text = CAPTIONS.get(`${name}.txt`);
    if (text == null) throw new Error(`Missing caption ${name}.txt`);
    return text;
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
                status:
                    result.reason === "not_found"
                        ? 404
                        : result.reason === "site_refused"
                          ? 403
                          : result.reason === "timeout"
                            ? null
                            : result.reason === "http_error"
                              ? 500
                              : null,
                detail: result.reason,
                url: typeof url === "string" ? url : url.href,
                host: (() => {
                    try {
                        return new URL(typeof url === "string" ? url : url.href)
                            .hostname;
                    } catch {
                        return "";
                    }
                })(),
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

test("importOutcomeToastKey uses paste_needed_reader when reader failed", () => {
    const key = importOutcomeToastKey({
        status: "paste_needed",
        recipeId: null,
        recipeName: null,
        verification: "unverified",
        problems: [],
        source: {
            kind: "instagram",
            url: "https://www.instagram.com/p/x/",
            label: "Instagram",
        },
        unresolvedLines: [],
        readerFailure: "Could not read caption.",
        fromMemory: false,
        rememberedUntil: null,
    });
    expect(key).toBe("recipes.import.paste_needed_reader");
    const msg = importOutcomeMessage({
        status: "paste_needed",
        recipeId: null,
        recipeName: null,
        verification: "unverified",
        problems: [],
        source: {
            kind: "instagram",
            url: "https://www.instagram.com/p/x/",
            label: "Instagram",
        },
        unresolvedLines: [],
        readerFailure: "Could not read caption.",
        fromMemory: false,
        rememberedUntil: null,
    });
    expect(msg).toContain("Could not read caption.");
    expect(msg).not.toMatch(/\{reason\}/);
});

test("importRecipeFromUrlAnalyticsOutcome treats paste_needed and no_recipe_in_text as success", () => {
    expect(importRecipeFromUrlAnalyticsOutcome("paste_needed")).toEqual({
        success: true,
    });
    expect(importRecipeFromUrlAnalyticsOutcome("no_recipe_in_text")).toEqual({
        success: true,
    });
    expect(importRecipeFromUrlAnalyticsOutcome("invalid_link")).toEqual({
        success: false,
        errorCategory: "recipe_import",
    });
    expect(importRecipeFromUrlAnalyticsOutcome("no_recipe_on_page")).toEqual({
        success: false,
        errorCategory: "recipe_import",
    });
});

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
            fromMemory: false,
            rememberedUntil: null,
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

    test("tiktok reader off leaves vm.tiktok.com unexpanded", async () => {
        const fetcher = fakeFetcher({});
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                readers: { tiktok: false, facebook: false },
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://vm.tiktok.com/ZM1/",
            },
        );
        expect(result.status).toBe("paste_needed");
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("tiktok reader on imports with read origin and records success", async () => {
        const tiktokHtml = await Bun.file(
            join(import.meta.dir, "fixtures/social/tiktok-no-subtitles.html"),
        ).text();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: true, body: tiktokHtml }),
        });
        const status = createMemorySocialReaderStatusStore();
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher,
                readers: { tiktok: true, facebook: false },
                readerStatus: status,
                now: () => new Date("2026-11-05T12:00:00.000Z"),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.tiktok.com/@chef/video/123",
            },
        );
        expect(result.status).toMatch(/imported|unverified_needs_review/);
        expect(fetcher.calls.fetch).toBeGreaterThan(0);
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceTextOrigin).toBe("read");
        const rows = await status.get(HH);
        expect(rows.find((r) => r.reader === "tiktok")?.lastSuccessAt).toBe(
            "2026-11-05T12:00:00.000Z",
        );
    });

    test("tiktok reader failure falls through with readerFailure sentence", async () => {
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: true, body: "<html></html>" }),
        });
        const status = createMemorySocialReaderStatusStore();
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                readers: { tiktok: true, facebook: false },
                readerStatus: status,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.tiktok.com/@chef/video/123",
            },
        );
        expect(result.status).toBe("paste_needed");
        expect(result.readerFailure).toBe(
            readerFailureSentence("tiktok", "format_changed"),
        );
        const rows = await status.get(HH);
        expect(rows.find((r) => r.reader === "tiktok")?.lastFailureReason).toBe(
            "format_changed",
        );
    });

    test("text given skips reader even when enabled", async () => {
        const fetcher = fakeFetcher({
            fetch: () => {
                throw new Error("reader should not run");
            },
        });
        const caption = loadCaption("clean-headers");
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                readers: { tiktok: true, facebook: true },
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.tiktok.com/@chef/video/123",
                text: caption,
            },
        );
        expect(result.status).toMatch(/imported|unverified_needs_review/);
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("instagram never reads when flags are set", async () => {
        const fetcher = fakeFetcher({
            fetch: () => {
                throw new Error("reader should not run");
            },
        });
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                readers: { tiktok: true, facebook: true },
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/abc/",
            },
        );
        expect(result.status).toBe("paste_needed");
        expect(fetcher.calls.fetch).toBe(0);
    });

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

    test("fetch uses cleaned URL without tracking params", async () => {
        let robotsUrl = "";
        let fetchUrl = "";
        const fetcher = fakeFetcher({
            fetch: (url) => {
                fetchUrl = url;
                return { ok: true, body: loadFixture("array-top-level") };
            },
        });
        const origRobots = fetcher.robotsAllows.bind(fetcher);
        fetcher.robotsAllows = async (url) => {
            robotsUrl = typeof url === "string" ? url : url.href;
            return origRobots(url);
        };
        await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/soup?utm_source=x&fbclid=abc",
            },
        );
        expect(robotsUrl).not.toMatch(/utm_|fbclid/);
        expect(fetchUrl).not.toMatch(/utm_|fbclid/);
        expect(fetchUrl).toBe("https://example.com/soup");
    });

    test("throws when an ingredient insert fails inside the transaction", async () => {
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
                    transaction: (fn) => fn(),
                },
                {
                    householdId: HH,
                    creatorId: USER,
                    url: "https://example.com/rollback",
                },
            ),
        ).rejects.toThrow("insert failed");
    });

    test("Instagram link with clean caption imports verified without fetch", async () => {
        const fetcher = fakeFetcher({});
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const caption = loadCaption("clean-headers");
        const result = await importRecipeFromUrl(
            { recipes, foods, fetcher, transaction: (fn) => fn() },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/abc123/",
                text: caption,
                credit: "Test Creator",
            },
        );
        expect(result.status).toBe("imported");
        expect(result.verification).toBe("verified");
        expect(fetcher.calls.fetch).toBe(0);
        expect(fetcher.calls.robots).toBe(0);
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceKind).toBe("instagram");
        expect(imp?.sourceText).toBe(caption.trim());
        expect(imp?.sourceTextOrigin).toBe("pasted");
        expect(imp?.credit).toBe("Test Creator");
    });

    test("run-together caption imports unverified with unresolved lines", async () => {
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.tiktok.com/@x/video/1",
                text: loadCaption("run-together"),
            },
        );
        expect(result.status).toBe("unverified_needs_review");
        expect(result.unresolvedLines.length).toBeGreaterThan(0);
    });

    test("no-recipe caption returns no_recipe_in_text and saves nothing", async () => {
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/norecipe/",
                text: loadCaption("no-recipe"),
            },
        );
        expect(result.status).toBe("no_recipe_in_text");
        expect(await recipes.listRecipes(HH)).toHaveLength(0);
    });

    test("yield-only caption returns no_recipe_in_text", async () => {
        const recipes = createMemoryRecipesStore();
        const fetcher = fakeFetcher({});
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/yield-only/",
                text: "Serves 4",
            },
        );
        expect(result.status).toBe("no_recipe_in_text");
        expect(await recipes.listRecipes(HH)).toHaveLength(0);
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("caption yield is stored on imported recipe", async () => {
        const recipes = createMemoryRecipesStore();
        const text = [
            "Sunday cake",
            "Serves 8",
            "Ingredients:",
            "2 eggs",
            "Method:",
            "Mix",
        ].join("\n");
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/yield/",
                text,
            },
        );
        expect(result.status).toBe("imported");
        const recipe = await recipes.getRecipe(HH, result.recipeId!);
        expect(recipe?.yieldPortions).toBe(8);
        expect(recipe?.name).toBe("Sunday cake");
    });

    test("ig.me and youtube-nocookie links never call fetcher without text", async () => {
        const fetcher = fakeFetcher({});
        for (const url of [
            "https://ig.me/ReelABC",
            "https://www.youtube-nocookie.com/embed/abc123",
        ]) {
            const result = await importRecipeFromUrl(
                {
                    recipes: createMemoryRecipesStore(),
                    foods: createMemoryFoodsStore(),
                    fetcher,
                },
                {
                    householdId: HH,
                    creatorId: USER,
                    url,
                },
            );
            expect(result.status).toBe("paste_needed");
        }
        expect(fetcher.calls.fetch).toBe(0);
        expect(fetcher.calls.robots).toBe(0);
    });

    test("website JSON-LD import stores credit", async () => {
        const recipes = createMemoryRecipesStore();
        const fetcher = fakeFetcher({
            robots: true,
            fetch: () => ({
                ok: true as const,
                body: loadFixture("array-top-level"),
            }),
        });
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher,
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/from-pin",
                credit: "Pin Creator",
            },
        );
        expect(result.status).toBe("imported");
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.credit).toBe("Pin Creator");
        expect(fetcher.calls.fetch).toBe(1);
    });

    test("website link with pasted text skips fetch and stores source text", async () => {
        const fetcher = fakeFetcher({});
        const recipes = createMemoryRecipesStore();
        const caption = loadCaption("clean-headers");
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher,
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/blocked-page",
                text: caption,
            },
        );
        expect(result.status).toBe("imported");
        expect(fetcher.calls.fetch).toBe(0);
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceKind).toBe("website");
        expect(imp?.sourceText).toBe(caption.trim());
    });

    test("Pinterest link with text saves pinterest source kind", async () => {
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.pinterest.com/pin/123/",
                text: loadCaption("clean-headers"),
            },
        );
        expect(result.status).toBe("imported");
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceKind).toBe("pinterest");
    });

    test("duplicate link still wins when text is supplied", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const fetcher = fakeFetcher({});
        const first = await importRecipeFromUrl(
            { recipes, foods, fetcher, transaction: (fn) => fn() },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.youtube.com/watch?v=abc",
                text: loadCaption("clean-headers"),
            },
        );
        expect(first.status).toBe("imported");
        const dup = await importRecipeFromUrl(
            { recipes, foods, fetcher },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.youtube.com/watch?v=abc",
                text: loadCaption("clean-headers"),
            },
        );
        expect(dup.status).toBe("duplicate");
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("YouTube without text is paste_needed with zero fetcher calls", async () => {
        const fetcher = fakeFetcher({});
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.youtube.com/watch?v=xyz",
            },
        );
        expect(result.status).toBe("paste_needed");
        expect(fetcher.calls.fetch).toBe(0);
        expect(fetcher.calls.robots).toBe(0);
    });

    test("importRecipeFromSharedText saves sourceKind text", async () => {
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromSharedText(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                text: loadCaption("clean-headers"),
                textOrigin: "shared",
            },
        );
        expect(result.status).toBe("imported");
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceKind).toBe("text");
        expect(imp?.sourceUrl).toBeNull();
        expect(imp?.sourceTextOrigin).toBe("shared");
    });

    test("textOrigin shared is stored on import row", async () => {
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/shared/",
                text: loadCaption("clean-headers"),
                textOrigin: "shared",
            },
        );
        expect(result.status).toBe("imported");
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.sourceTextOrigin).toBe("shared");
    });

    test("credit longer than 120 chars is clipped", async () => {
        const longCredit = `Chef ${"x".repeat(130)}`;
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/credit/",
                text: loadCaption("to-taste"),
                credit: longCredit,
            },
        );
        const imp = await recipes.getImport(HH, result.recipeId!);
        expect(imp?.credit).not.toBeNull();
        expect(imp!.credit!.length).toBeLessThanOrEqual(120);
        expect(imp!.credit!.endsWith("…")).toBe(true);
    });
});

describe("prepareImportedRecipe clamps page values to what the editors accept", () => {
    const base = {
        name: "Soup",
        fallbackName: "example.com",
        yieldPortions: 4,
        steps: ["Simmer."],
        prepMinutes: 10,
        cookMinutes: 20,
        parsed: { items: [], unresolved: [] },
    };

    test("yield out of range becomes 1", () => {
        for (const y of [0, 0.4, -3, 1e16, Number.NaN, null]) {
            expect(
                prepareImportedRecipe({ ...base, yieldPortions: y })
                    .yieldPortions,
            ).toBe(1);
        }
        expect(
            prepareImportedRecipe({ ...base, yieldPortions: 6 }).yieldPortions,
        ).toBe(6);
    });

    test("names without letters fall back and long text is clipped", () => {
        expect(prepareImportedRecipe({ ...base, name: "   " }).name).toBe(
            "example.com",
        );
        expect(prepareImportedRecipe({ ...base, name: "​" }).name).toBe(
            "example.com",
        );
        const long = prepareImportedRecipe({ ...base, name: "x".repeat(120) });
        expect(long.name.length).toBeLessThanOrEqual(80);
        const steps = prepareImportedRecipe({
            ...base,
            steps: Array.from({ length: 500 }, () => "y".repeat(100)),
        });
        expect(steps.instructions!.length).toBeLessThanOrEqual(20_000);
    });

    test("absurd durations are dropped", () => {
        const out = prepareImportedRecipe({
            ...base,
            prepMinutes: 2_880_000_000,
            cookMinutes: -5,
        });
        expect(out.prepMinutes).toBeNull();
        expect(out.cookMinutes).toBeNull();
    });

    test("blank names and non-positive amounts go to unresolved", () => {
        const out = prepareImportedRecipe({
            ...base,
            parsed: {
                items: [
                    {
                        line: "1 cup (sifted)",
                        name: "",
                        quantity: { amount: 1, unit: "cup" },
                        note: "sifted",
                        section: null,
                    },
                    {
                        line: "0 g salt",
                        name: "salt",
                        quantity: { amount: 0, unit: "g" },
                        note: null,
                        section: null,
                    },
                    {
                        line: "1 cup flour",
                        name: "flour",
                        quantity: { amount: 1, unit: "cup" },
                        note: "n".repeat(600),
                        section: null,
                    },
                ],
                unresolved: [],
            },
        });
        expect(out.parsed.unresolved).toEqual(["1 cup (sifted)", "0 g salt"]);
        expect(out.parsed.items.map((i) => i.name)).toEqual(["flour"]);
        expect(out.parsed.items[0]!.note!.length).toBeLessThanOrEqual(500);
    });
});

test("a page with zero yield and a nameless line still imports as an outcome", async () => {
    const recipes = createMemoryRecipesStore();
    const foods = createMemoryFoodsStore();
    const html = `<script type="application/ld+json">${JSON.stringify({
        "@type": "Recipe",
        name: "Soup",
        recipeYield: "0 servings",
        prepTime: "P2000000D",
        recipeIngredient: ["1 cup (sifted)", "0 g salt", "2 cups stock"],
        recipeInstructions: ["Simmer."],
    })}</script>`;
    const fetcher = {
        robotsAllows: async () => true,
        fetchPage: async () => ({
            ok: true as const,
            url: "https://example.com/soup",
            status: 200,
            contentType: "text/html",
            body: html,
        }),
    };
    const out = await importRecipeFromUrl(
        { recipes, foods, fetcher },
        { householdId: HH, creatorId: USER, url: "https://example.com/soup" },
    );
    expect(out.status).toBe("unverified_needs_review");
    expect(out.unresolvedLines).toEqual(["1 cup (sifted)", "0 g salt"]);
    const recipe = await recipes.getRecipe(HH, out.recipeId!);
    expect(recipe?.yieldPortions).toBe(1);
    expect(recipe?.prepMinutes).toBeNull();
});

test("a read caption and transcript with no recipe fall through to paste", async () => {
    const page = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(
        {
            __DEFAULT_SCOPE__: {
                "webapp.video-detail": {
                    itemInfo: {
                        itemStruct: {
                            desc: "link in bio",
                            video: {
                                subtitleInfos: [
                                    {
                                        LanguageCodeName: "eng-US",
                                        Url: "https://v16-webapp.tiktokcdn.com/a.vtt",
                                        Format: "webvtt",
                                        Source: "ASR",
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        },
    )}</script>`;
    const vtt =
        "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nhey guys welcome back today we make pasta";
    const fetcher = fakeFetcher({
        fetch: (url) => ({ ok: true, body: url.endsWith(".vtt") ? vtt : page }),
    });
    const recipes = createMemoryRecipesStore();
    const status = createMemorySocialReaderStatusStore();
    const result = await importRecipeFromUrl(
        {
            recipes,
            foods: createMemoryFoodsStore(),
            fetcher,
            readers: { tiktok: true, facebook: false },
            readerStatus: status,
        },
        {
            householdId: HH,
            creatorId: USER,
            url: "https://www.tiktok.com/@chef/video/9",
        },
    );
    expect(result.status).toBe("paste_needed");
    expect(result.readerFailure).toBe(readerNoRecipeSentence("tiktok"));
    expect(await recipes.listRecipes(HH)).toHaveLength(0);
    const row = (await status.get(HH)).find((r) => r.reader === "tiktok");
    expect(row?.lastSuccessAt).not.toBeNull();
});

describe("importRecipeFromUrl fetch memory (websites)", () => {
    test("403 records host; next page on host skips fetcher", async () => {
        const memory = createMemoryFetchMemoryStore();
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: false, reason: "site_refused" }),
        });
        const first = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/a",
            },
        );
        expect(first.status).toBe("site_refused");
        expect(first.fromMemory).toBe(false);
        expect(fetcher.calls.robots).toBe(1);
        expect(fetcher.calls.fetch).toBe(1);

        const second = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/b",
            },
        );
        expect(second.status).toBe("site_refused");
        expect(second.fromMemory).toBe(true);
        expect(fetcher.calls.fetch).toBe(1);
        expect(fetcher.calls.robots).toBe(1);
    });

    test("www. and bare host share refusal row", async () => {
        const memory = createMemoryFetchMemoryStore();
        await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({
                    fetch: () => ({ ok: false, reason: "site_refused" }),
                }),
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.example.com/a",
            },
        );
        const row = await memory.getRefusal(HH, "example.com", new Date());
        expect(row?.host).toBe("example.com");
        const skip = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({}),
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://example.com/b",
            },
        );
        expect(skip.fromMemory).toBe(true);
    });

    test("after refusal TTL passes, fetch runs again", async () => {
        const memory = createMemoryFetchMemoryStore();
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        let t = new Date("2026-01-01T00:00:00.000Z").getTime();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: false, reason: "site_refused" }),
        });
        await importRecipeFromUrl(
            {
                recipes,
                foods,
                fetcher,
                memory,
                now: () => new Date(t),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://ttl.example/x",
            },
        );
        expect(fetcher.calls.fetch).toBe(1);
        t += 8 * 24 * 60 * 60 * 1000;
        await importRecipeFromUrl(
            {
                recipes,
                foods,
                fetcher,
                memory,
                now: () => new Date(t),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://ttl.example/y",
            },
        );
        expect(fetcher.calls.fetch).toBe(2);
    });

    test("retry clears memory and fetches", async () => {
        const memory = createMemoryFetchMemoryStore();
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: false, reason: "site_refused" }),
        });
        await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://retry.example/p",
            },
        );
        const memBlock = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://retry.example/q",
            },
        );
        expect(memBlock.fromMemory).toBe(true);
        const after = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://retry.example/q",
                retry: true,
            },
        );
        expect(after.fromMemory).toBe(false);
        expect(fetcher.calls.fetch).toBe(2);
    });

    test("a retry that gets through clears the redirect host's refusal too", async () => {
        const memory = createMemoryFetchMemoryStore();
        const now = new Date();
        await memory.recordRefusal(HH, "cdn.example", 403, now);
        await memory.recordRefusal(HH, "start.example", 403, now);
        const fetcher: SafeFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                return {
                    ok: true as const,
                    url: "https://cdn.example/soup",
                    status: 200,
                    contentType: "text/html",
                    body: loadFixture("array-top-level"),
                };
            },
        };
        const out = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://start.example/soup",
                retry: true,
            },
        );
        expect(out.status).toMatch(/imported|unverified_needs_review/);
        expect(await memory.getRefusal(HH, "cdn.example", now)).toBeNull();
        expect(await memory.getRefusal(HH, "start.example", now)).toBeNull();
    });

    test("404 records URL; same link skips fetch; other path still fetches", async () => {
        const memory = createMemoryFetchMemoryStore();
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: false, reason: "not_found" }),
        });
        await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://gone.example/recipe",
            },
        );
        expect(fetcher.calls.fetch).toBe(1);
        const again = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://gone.example/recipe",
            },
        );
        expect(again.status).toBe("not_found");
        expect(again.fromMemory).toBe(true);
        expect(fetcher.calls.fetch).toBe(1);
        const other = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://gone.example/other",
            },
        );
        expect(other.fromMemory).toBe(false);
        expect(fetcher.calls.fetch).toBe(2);
    });

    test("410 is permanent in memory", async () => {
        const memory = createMemoryFetchMemoryStore();
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        await memory.recordDeadLink(
            HH,
            deadLinkHash("https://perm.example/gone"),
            "https://perm.example/gone",
            410,
            new Date(),
        );
        const remembered = await importRecipeFromUrl(
            {
                recipes,
                foods,
                fetcher: fakeFetcher({
                    fetch: () => ({
                        ok: true,
                        body: loadFixture("array-top-level"),
                    }),
                }),
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://perm.example/gone",
            },
        );
        expect(remembered.fromMemory).toBe(true);
        expect(remembered.rememberedUntil).toBeNull();
        const still = await importRecipeFromUrl(
            {
                recipes,
                foods,
                fetcher: fakeFetcher({
                    fetch: () => ({
                        ok: true,
                        body: loadFixture("array-top-level"),
                    }),
                }),
                memory,
                now: () => new Date("2040-01-01T00:00:00.000Z"),
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://perm.example/gone",
            },
        );
        expect(still.fromMemory).toBe(true);
    });

    test("500 does not record in memory", async () => {
        const memory = createMemoryFetchMemoryStore();
        const fetcher = fakeFetcher({
            fetch: () => ({ ok: false, reason: "http_error" }),
        });
        await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://err.example/z",
            },
        );
        expect(
            await memory.getDeadLink(
                HH,
                deadLinkHash("https://err.example/z"),
                new Date(),
            ),
        ).toBeNull();
    });

    test("memory record throws do not break import", async () => {
        const memory = {
            ...createMemoryFetchMemoryStore(),
            async recordRefusal() {
                throw new Error("db down");
            },
        };
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({
                    fetch: () => ({ ok: false, reason: "site_refused" }),
                }),
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://throw.example/t",
            },
        );
        expect(result.status).toBe("site_refused");
    });

    test("memory read throws do not block import", async () => {
        const memory = {
            ...createMemoryFetchMemoryStore(),
            async getRefusal() {
                throw new Error("read down");
            },
            async getDeadLink() {
                throw new Error("read down");
            },
        };
        const fetcher = fakeFetcher({
            fetch: () => ({
                ok: true,
                body: loadFixture("array-top-level"),
            }),
        });
        const recipes = createMemoryRecipesStore();
        const result = await importRecipeFromUrl(
            {
                recipes,
                foods: createMemoryFoodsStore(),
                fetcher,
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://readthrow.example/r",
            },
        );
        expect(result.status).toBe("imported");
        expect(fetcher.calls.robots).toBe(1);
        expect(fetcher.calls.fetch).toBe(1);
    });

    test("retry with pasted text clears memory and fetches before text", async () => {
        const memory = createMemoryFetchMemoryStore();
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        let fetchCalls = 0;
        const fetcher = fakeFetcher({
            fetch: () => {
                fetchCalls += 1;
                if (fetchCalls === 1) {
                    return { ok: false, reason: "site_refused" };
                }
                return { ok: false, reason: "not_found" };
            },
        });
        await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://retrytext.example/a",
            },
        );
        expect(fetchCalls).toBe(1);
        const blocked = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://retrytext.example/b",
            },
        );
        expect(blocked.fromMemory).toBe(true);
        const caption = loadCaption("clean-headers");
        const retry = await importRecipeFromUrl(
            { recipes, foods, fetcher, memory },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://retrytext.example/b",
                text: caption,
                retry: true,
            },
        );
        expect(retry.fromMemory).toBe(false);
        expect(fetchCalls).toBe(2);
        expect(retry.status).toBe("imported");
    });

    test("social links never touch memory", async () => {
        const memory = createMemoryFetchMemoryStore();
        await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: fakeFetcher({
                    fetch: () => ({ ok: false, reason: "site_refused" }),
                }),
                memory,
            },
            {
                householdId: HH,
                creatorId: USER,
                url: "https://www.instagram.com/p/x/",
            },
        );
        expect(
            await memory.listRefusals(HH, { limit: 10, now: new Date() }),
        ).toHaveLength(0);
    });
});

test("handled unresolved lines can be cleared so a fixed recipe verifies", async () => {
    const store = createMemoryRecipesStore();
    const recipe = await store.insertRecipe(baseRecipe());
    await store.insertIngredient(ingredient({ recipeId: recipe.id }));
    await store.upsertImport({
        recipeId: recipe.id,
        householdId: HH,
        sourceKind: "website",
        sourceUrl: "https://example.com/soup",
        sourceText: null,
        sourceTextOrigin: null,
        transcript: null,
        credit: null,
        unresolvedLines: ["1 x 400g tin tomatoes", "2 eggs 1 cup flour"],
        problems: [],
        importedAt: "2026-01-01T00:00:00.000Z",
    });
    // The person added tomatoes by hand; the line still blocks the check.
    expect((await recheckRecipe(store, HH, recipe.id)).verified).toBe(false);
    const partial = await resolveUnresolvedLines(store, HH, recipe.id, [
        " 1 x 400g tin tomatoes ",
    ]);
    expect(partial.removed).toBe(1);
    expect(partial.verified).toBe(false);
    expect((await store.getImport(HH, recipe.id))?.unresolvedLines).toEqual([
        "2 eggs 1 cup flour",
    ]);
    const done = await resolveUnresolvedLines(store, HH, recipe.id, [
        "2 eggs 1 cup flour",
    ]);
    expect(done.verified).toBe(true);
    expect((await store.getRecipe(HH, recipe.id))?.verification).toBe(
        "verified",
    );
});

describe("source links", () => {
    test.each([
        "javascript:alert(1)",
        " JavaScript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "vbscript:msgbox(1)",
        "mailto:a@example.com",
        "",
        "   ",
    ])("safeSourceUrl refuses %p", (raw) => {
        expect(safeSourceUrl(raw)).toBeNull();
        expect(recipeDisplaySource({ sourceUrl: raw }, null)).toBeNull();
    });

    test("an import row's javascript: link is not displayed", () => {
        expect(
            recipeDisplaySource(
                { sourceUrl: null },
                { sourceKind: "website", sourceUrl: "javascript:alert(1)" },
            ),
        ).toBeNull();
    });

    test("a bare host gets https and an http(s) link is kept", () => {
        expect(safeSourceUrl("example.com/soup")?.href).toBe(
            "https://example.com/soup",
        );
        expect(
            recipeDisplaySource({ sourceUrl: "http://example.com/a" }, null)
                ?.url,
        ).toBe("http://example.com/a");
    });

    test("create and update refuse a javascript: source", async () => {
        const store = createMemoryRecipesStore();
        await expect(
            createRecipe(store, {
                householdId: HH,
                creatorId: USER,
                name: "Soup",
                yieldPortions: 2,
                sourceUrl: "javascript:alert(1)",
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
        const recipe = await createRecipe(store, {
            householdId: HH,
            creatorId: USER,
            name: "Soup",
            yieldPortions: 2,
            sourceUrl: "example.com/soup",
        });
        expect(recipe.sourceUrl).toBe("example.com/soup");
        await expect(
            updateRecipe(store, HH, recipe.id, {
                sourceUrl: "javascript:alert(1)",
            }),
        ).rejects.toBeInstanceOf(RecipeInputError);
    });

    test("a bare stored source still reports a duplicate import", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        const recipe = await createRecipe(recipes, {
            householdId: HH,
            creatorId: USER,
            name: "Soup",
            yieldPortions: 2,
            sourceUrl: "example.com/soup",
        });
        const fetcher = fakeFetcher({});
        const dup = await importRecipeFromUrl(
            { recipes, foods, fetcher },
            { householdId: HH, creatorId: USER, url: "example.com/soup" },
        );
        expect(dup.status).toBe("duplicate");
        expect(dup.recipeId).toBe(recipe.id);
        expect(dup.recipeName).toBe("Soup");
        expect(dup.source?.url).toBe("https://example.com/soup");
        expect(fetcher.calls.fetch).toBe(0);
    });

    test("links large eggs to existing Eggs without changing the stored name", async () => {
        const recipes = createMemoryRecipesStore();
        const foods = createMemoryFoodsStore();
        foods.setPluralsSameFood(HH, false);
        const eggs = await findOrCreateManualFood(foods, HH, "food", "Eggs");
        const result = await importRecipeFromSharedText(
            {
                recipes,
                foods,
                fetcher: fakeFetcher({}),
                transaction: (fn) => fn(),
            },
            {
                householdId: HH,
                creatorId: USER,
                text: "Omelette\n\n2 large eggs (beaten)\n\n1. Whisk and cook.",
            },
        );
        expect(result.status).toBe("imported");
        const ingredients = await recipes.listIngredients(HH, result.recipeId!);
        expect(ingredients).toHaveLength(1);
        expect(ingredients[0]?.foodId).toBe(eggs.id);
        expect(ingredients[0]?.displayName).toBe("Eggs");
        expect((await foods.getFood(HH, eggs.id))?.name).toBe("Eggs");
        expect(
            (await foods.listFoods(HH)).filter((f) => !f.archivedAt),
        ).toHaveLength(1);
    });
});
