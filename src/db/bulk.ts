/**
 * The live side of `src/domain/bulk.ts`: each bulk action runs as one database
 * transaction, so a batch commits whole or not at all.
 *
 * Every batch first takes a transaction advisory lock named for the household
 * and the action. A second submit of the same batch (a double tap, a retry)
 * waits for the first to commit, then reads the state it left: for discard,
 * remove and delete the rows are gone, and the domain answers `already`
 * instead of acting twice. Batches of different actions do not wait for each
 * other.
 */
import {
    deleteSavedItems,
    discardFridgeItems,
    removeUsuals,
    type BulkResult,
} from "../domain/bulk.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveRecipesStore } from "./recipes.js";
import { run } from "./sql.js";
import { liveStockStore } from "./stock.js";

export type BulkAction = "fridge-discard" | "usuals-remove" | "saved-delete";

/** The advisory-lock name of one household's batches of one action. */
export function bulkLockKey(householdId: string, action: BulkAction): string {
    return `bulk:${householdId}:${action}`;
}

/**
 * Runs `fn` as one transaction behind the batch lock. Every store call `fn`
 * makes joins the transaction, so if it throws, none of its writes stay.
 */
export function inBulkTransaction<T>(
    householdId: string,
    action: BulkAction,
    fn: () => Promise<T>,
): Promise<T> {
    return run(async (tx) => {
        await tx`
            select pg_advisory_xact_lock(
                hashtextextended(${bulkLockKey(householdId, action)}, 0)
            )
        `;
        return fn();
    });
}

export function bulkDiscardFridgeItems(input: {
    householdId: string;
    itemIds: readonly string[];
    actorUserId?: string | null;
}): Promise<BulkResult> {
    return inBulkTransaction(input.householdId, "fridge-discard", () =>
        discardFridgeItems(
            liveFridgeStore(),
            liveStockStore(),
            liveFoodsStore(),
            input,
        ),
    );
}

export function bulkRemoveUsuals(input: {
    householdId: string;
    foodIds: readonly string[];
}): Promise<BulkResult> {
    return inBulkTransaction(input.householdId, "usuals-remove", () =>
        removeUsuals(liveFoodsStore(), input),
    );
}

export function bulkDeleteSavedItems(input: {
    householdId: string;
    foodIds: readonly string[];
    recipeIds: readonly string[];
    actor: { userId: string; isOwner: boolean };
}): Promise<BulkResult> {
    return inBulkTransaction(input.householdId, "saved-delete", () =>
        deleteSavedItems(liveFoodsStore(), liveRecipesStore(), input),
    );
}
