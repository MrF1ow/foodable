import { createSafeFetcher, type SafeFetcher } from "./fetch-safe.js";
import { recipeFetchMemory as recipeFetchMemoryFromDb } from "./db/fetch-memory.js";
import type { FetchMemoryStore } from "./domain/fetch-memory.js";

let singleton: SafeFetcher | null = null;

/** One process-wide fetcher so robots.txt cache persists across imports. */
export function recipeImportFetcher(): SafeFetcher {
    if (!singleton) {
        singleton = createSafeFetcher();
    }
    return singleton;
}

/** In-process LRU read-through cache over Postgres; one household per process is assumed. */
export function recipeFetchMemory(): FetchMemoryStore {
    return recipeFetchMemoryFromDb();
}
