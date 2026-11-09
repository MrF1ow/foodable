import { afterEach, expect, test } from "bun:test";
import { createMemorySocialReaderStatusStore } from "./domain/social-readers.js";
import { createMemoryFoodsStore } from "./domain/foods.js";
import { createMemoryRecipesStore } from "./domain/recipes.js";
import { importRecipeFromUrl } from "./domain/recipe-import.js";
import { importOutcomeShowsPasteStep } from "./domain/recipe-import.js";
import { createMemoryFlags, resetFlagsForTests } from "./flags.js";
import {
    buildRecipeLinkReaderPausedOutcome,
    linkImportPaused,
    recipeImportFetcher,
    recipeLinkReaderEnabled,
} from "./recipe-url-fetcher.js";

afterEach(() => {
    resetFlagsForTests();
});

test("recipeImportFetcher with recipe-link-reader off makes no fetch calls", async () => {
    const householdId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const flags = createMemoryFlags({ "recipe-link-reader": false });
    let fetchCalls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
        fetchCalls += 1;
        return originalFetch(...args);
    }) as typeof fetch;

    try {
        const fetcher = recipeImportFetcher({
            householdId,
            isEnabled: flags.isEnabled.bind(flags),
        });
        const result = await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher,
            },
            {
                householdId,
                creatorId: "user-1",
                url: "https://example.com/recipe/soup",
            },
        );
        expect(fetchCalls).toBe(0);
        expect(importOutcomeShowsPasteStep(result.status)).toBe(true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("callers with recipe-link-reader off use paused outcome without recording TikTok reader failure", async () => {
    const householdId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const flags = createMemoryFlags({ "recipe-link-reader": false });
    const readerStatus = createMemorySocialReaderStatusStore();
    const url = "https://www.tiktok.com/@chef/video/1234567890";

    if (!recipeLinkReaderEnabled(householdId, flags.isEnabled.bind(flags))) {
        const paused = buildRecipeLinkReaderPausedOutcome(url);
        expect(paused.status).toBe("paste_needed");
        expect(paused.readerFailure).toBeNull();
    } else {
        await importRecipeFromUrl(
            {
                recipes: createMemoryRecipesStore(),
                foods: createMemoryFoodsStore(),
                fetcher: recipeImportFetcher({
                    householdId,
                    isEnabled: flags.isEnabled.bind(flags),
                }),
                readers: { tiktok: true, facebook: false },
                readerStatus,
            },
            {
                householdId,
                creatorId: "user-1",
                url,
            },
        );
    }

    const rows = await readerStatus.get(householdId);
    expect(rows.find((r) => r.reader === "tiktok")?.lastFailureAt).toBeNull();
});

test("a link import is paused only when the reader is off and nothing was pasted", () => {
    expect(linkImportPaused({ readerEnabled: false, text: "" })).toBe(true);
    expect(linkImportPaused({ readerEnabled: false })).toBe(true);
    expect(linkImportPaused({ readerEnabled: false, text: "  " })).toBe(true);
    expect(
        linkImportPaused({ readerEnabled: false, text: "2 eggs\nFry." }),
    ).toBe(false);
    expect(linkImportPaused({ readerEnabled: true, text: "" })).toBe(false);
});
