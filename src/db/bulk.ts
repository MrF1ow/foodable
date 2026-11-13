/**
 * The live side of `src/domain/bulk.ts`: each bulk action runs as one database
 * transaction, so a batch commits whole or not at all.
 *
 * Every batch first takes a transaction advisory lock named for the household
 * and the action. A second submit of the same batch (a double tap, a retry)
 * waits for the first to commit, then reads the state it left: for discard,
 * remove and delete the rows are gone or done, and the domain answers
 * `already` instead of acting twice. A tick-off leaves its lines in place, so
 * its retry ticks them again (a no-op) and answers `applied`. Batches of
 * different actions do not wait for each other.
 */
import {
    deleteSavedItems,
    discardFridgeItems,
    removeGroceryLines,
    removeUsuals,
    tickOffGroceryLines,
    type BulkResult,
} from "../domain/bulk.js";
import { liveFoodsStore } from "./foods.js";
import { liveFridgeStore } from "./fridge.js";
import { liveGroceryStore } from "./grocery.js";
import { liveRecipesStore } from "./recipes.js";
import { householdToday } from "./restock.js";
import { run, type Tx } from "./sql.js";
import { liveStockStore } from "./stock.js";

export type BulkAction =
    | "grocery-tick"
    | "grocery-remove"
    | "fridge-discard"
    | "usuals-remove"
    | "saved-delete";

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
    fn: (scope: BulkScope) => Promise<T>,
): Promise<T> {
    return run(async (tx) => {
        await tx`
            select pg_advisory_xact_lock(
                hashtextextended(${bulkLockKey(householdId, action)}, 0)
            )
        `;
        return fn({ isolate: (work) => inSavepoint(tx, work) });
    });
}

/** What a batch gets from its transaction. */
export type BulkScope = {
    /**
     * Runs `work` behind a savepoint: if it throws, only its own writes are
     * undone and the transaction stays usable; the error is rethrown.
     */
    isolate: <T>(work: () => Promise<T>) => Promise<T>;
};

async function inSavepoint<T>(tx: Tx, work: () => Promise<T>): Promise<T> {
    await tx`savepoint bulk_step`;
    try {
        const out = await work();
        await tx`release savepoint bulk_step`;
        return out;
    } catch (err) {
        await tx`rollback to savepoint bulk_step`;
        throw err;
    }
}

export async function bulkTickOffGroceryLines(input: {
    householdId: string;
    lineIds: readonly string[];
}): Promise<BulkResult> {
    // The household's day is read before the transaction opens.
    const today = await householdToday(input.householdId);
    return inBulkTransaction(input.householdId, "grocery-tick", (scope) =>
        tickOffGroceryLines(liveGroceryStore(), liveFoodsStore(), {
            ...input,
            today,
            isolate: scope.isolate,
        }),
    );
}

export function bulkRemoveGroceryLines(input: {
    householdId: string;
    lineIds: readonly string[];
}): Promise<BulkResult> {
    return inBulkTransaction(input.householdId, "grocery-remove", () =>
        removeGroceryLines(liveGroceryStore(), input),
    );
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
