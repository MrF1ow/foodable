import {
    createSafeFetcher,
    type FetchOutcome,
    type SafeFetcher,
} from "./fetch-safe.js";
import { recipeFetchMemory as recipeFetchMemoryFromDb } from "./db/fetch-memory.js";
import type { FetchMemoryStore } from "./domain/fetch-memory.js";
import type { RecipeImportOutcome } from "./domain/recipe-import.js";
import {
    cleanRecipeLink,
    recipeSource,
    validateRecipeLink,
} from "./domain/recipe-link.js";
import {
    buildBackgroundFlagContext,
    isEnabled as defaultIsEnabled,
    type FlagContext,
    type FlagName,
} from "./flags.js";

export const RECIPE_LINK_READER_PAUSED_WEB_MESSAGE =
    "Recipe link reading is paused. Paste the recipe instead.";

export const RECIPE_LINK_READER_PAUSED_AGENT_MESSAGE =
    "Recipe link reading is paused. Ask the user to paste the recipe text and call import_recipe_from_url again with the text parameter.";

export function recipeLinkReaderEnabled(
    householdId: string,
    enabled: typeof defaultIsEnabled = defaultIsEnabled,
): boolean {
    return enabled(
        "recipe-link-reader",
        buildBackgroundFlagContext(householdId),
    );
}

/**
 * A link import is paused only when there is no pasted text to import
 * instead: pasted text never reaches the network, so it still works while
 * the reader is switched off.
 */
export function linkImportPaused(args: {
    text?: string | null;
    readerEnabled: boolean;
}): boolean {
    return !args.readerEnabled && (args.text ?? "").trim() === "";
}

export function buildRecipeLinkReaderPausedOutcome(
    url: string,
): RecipeImportOutcome {
    const validated = validateRecipeLink(url);
    if (!validated.ok) {
        return {
            status: "paste_needed",
            recipeId: null,
            recipeName: null,
            verification: null,
            problems: [],
            source: null,
            unresolvedLines: [],
            readerFailure: null,
            fromMemory: false,
            rememberedUntil: null,
        };
    }
    const cleaned = cleanRecipeLink(validated.url);
    const info = recipeSource(validated.url);
    return {
        status: "paste_needed",
        recipeId: null,
        recipeName: null,
        verification: null,
        problems: [],
        source: {
            kind: info.kind,
            url: cleaned,
            label: info.label,
        },
        unresolvedLines: [],
        readerFailure: null,
        fromMemory: false,
        rememberedUntil: null,
    };
}

// Per instance by design: stateless fetcher handles; one per process avoids reallocating clients.
let singleton: SafeFetcher | null = null;
let disabledSingleton: SafeFetcher | null = null;

export type RecipeImportFetcherOptions = {
    householdId?: string;
    isEnabled?: (flag: FlagName, ctx: FlagContext) => boolean;
};

function createDisabledRecipeImportFetcher(): SafeFetcher {
    return {
        robotsAllows: async () => false,
        fetchPage: async (): Promise<FetchOutcome> => ({
            ok: false,
            reason: "network_error",
            status: null,
            detail: "recipe link reader disabled",
        }),
    };
}

function disabledRecipeImportFetcher(): SafeFetcher {
    if (!disabledSingleton) {
        disabledSingleton = createDisabledRecipeImportFetcher();
    }
    return disabledSingleton;
}

function readerEnabledForHousehold(
    opts: RecipeImportFetcherOptions | undefined,
): boolean {
    if (!opts?.householdId) return true;
    const ctx = buildBackgroundFlagContext(opts.householdId);
    const enabled = opts.isEnabled ?? defaultIsEnabled;
    return enabled("recipe-link-reader", ctx);
}

/** One process-wide fetcher so robots.txt cache persists across imports. */
export function recipeImportFetcher(
    opts?: RecipeImportFetcherOptions,
): SafeFetcher {
    if (opts && !readerEnabledForHousehold(opts)) {
        return disabledRecipeImportFetcher();
    }
    if (!singleton) {
        singleton = createSafeFetcher();
    }
    return singleton;
}

/** In-process LRU read-through cache over Postgres; one household per process is assumed. */
export function recipeFetchMemory(): FetchMemoryStore {
    return recipeFetchMemoryFromDb();
}
