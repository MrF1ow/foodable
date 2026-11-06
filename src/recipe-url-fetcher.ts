import { createSafeFetcher, type SafeFetcher } from "./fetch-safe.js";

let singleton: SafeFetcher | null = null;

/** One process-wide fetcher so robots.txt cache persists across imports. */
export function recipeImportFetcher(): SafeFetcher {
    if (!singleton) {
        singleton = createSafeFetcher();
    }
    return singleton;
}
