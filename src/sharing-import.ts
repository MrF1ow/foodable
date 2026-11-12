// The live side of importing a shared recipe, used by the household app
// (POST /recipes/import-shared) and by the import_shared_recipe tool alike:
// the stores, the transaction, the safe fetcher and the link-reader kill
// switch. The rules are in domain/sharing-source.ts (what may be fetched) and
// domain/sharing-import.ts (how it is matched and written).

import { liveFoodsStore } from "./db/foods.js";
import { liveRecipesStore } from "./db/recipes.js";
import { pgCode, run } from "./db/sql.js";
import { FoodsInputError } from "./domain/foods.js";
import { RecipeInputError } from "./domain/recipes.js";
import {
    importSharedRecipe,
    type SharedImportResult,
} from "./domain/sharing-import.js";
import {
    parseSharedRecipeInput,
    readSharedRecipe,
    SharedRecipeImportError,
    type SharedRecipeErrorCode,
    type SharedRecipeFetcher,
} from "./domain/sharing-source.js";
import {
    recipeImportFetcher,
    recipeLinkReaderEnabled,
} from "./recipe-url-fetcher.js";

let fetcherForTests: SharedRecipeFetcher | null = null;

/** Hands the importer a fetcher of a test's own; null restores the live one. */
export function setSharedRecipeFetcherForTests(
    fetcher: SharedRecipeFetcher | null,
): void {
    fetcherForTests = fetcher;
}

/**
 * What a failed import means to the person: the code (which cause) and the
 * message (what to do). A pasted link and a pasted document fail the same way
 * in the app and for an agent.
 */
export type SharedImportFailure = {
    code: SharedRecipeErrorCode;
    message: string;
};

const NO_FETCHER: SharedRecipeFetcher = {
    fetchPage: () => {
        throw new Error("A pasted recipe document is not fetched.");
    },
};

const PAUSED_MESSAGE =
    "Reading links is paused. Paste the recipe's JSON instead of its link.";

/**
 * Imports the recipe `input` names (a share link or the document's JSON) into
 * the household, or throws `SharedRecipeImportError`. Reading the link is
 * switched off with the link reader kill switch; a pasted document never
 * touches the network, so it still works then.
 */
export async function importSharedRecipeForHousehold(args: {
    householdId: string;
    creatorId: string;
    input: string;
}): Promise<SharedImportResult> {
    const { householdId, creatorId, input } = args;
    const source = parseSharedRecipeInput(input);
    if (
        source.kind === "url" &&
        !(await recipeLinkReaderEnabled(householdId))
    ) {
        throw new SharedRecipeImportError("unreachable", PAUSED_MESSAGE);
    }
    // Only a link needs the fetcher; a pasted document never reaches for it.
    const fetcher: SharedRecipeFetcher =
        source.kind === "url"
            ? (fetcherForTests ?? (await recipeImportFetcher()))
            : NO_FETCHER;
    const document = await readSharedRecipe(input, { fetcher });
    return importSharedRecipe(
        { foods: liveFoodsStore(), recipes: liveRecipesStore() },
        { householdId, creatorId, document },
        {
            // One import per household at a time: the second waits, then plans
            // against what the first committed, so a food both documents need
            // is matched instead of colliding on the household's food names.
            transaction: (fn) =>
                run(async (tx) => {
                    await tx`select pg_advisory_xact_lock(hashtextextended(${`shared-recipe-import:${householdId}`}, 0))`;
                    return fn();
                }),
        },
    );
}

/**
 * The failure to show for an error from `importSharedRecipeForHousehold`, or
 * null for one that is ours to let through (a database error is not the
 * person's to fix).
 */
export function sharedImportFailure(err: unknown): SharedImportFailure | null {
    if (err instanceof SharedRecipeImportError) {
        return { code: err.code, message: err.message };
    }
    if (err instanceof RecipeInputError || err instanceof FoodsInputError) {
        return {
            code: "not_recipe",
            message: `That recipe couldn't be imported. ${err.message}`,
        };
    }
    if (isUniqueViolation(err)) {
        // Something else added the same food or recipe while this ran.
        return {
            code: "not_recipe",
            message:
                "Your foods changed while that recipe was being imported. Try again.",
        };
    }
    return null;
}

function isUniqueViolation(err: unknown): boolean {
    for (let e: unknown = err, depth = 0; e && depth < 4; depth += 1) {
        if (pgCode(e) === "23505") return true;
        e = e instanceof Error ? e.cause : undefined;
    }
    return false;
}
