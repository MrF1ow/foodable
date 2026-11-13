/**
 * Select several rows, act once: the bulk twins of the single-row actions on
 * the Fridge, Usuals and Saved foods & recipes lists. Each one
 * calls the same domain function the one-row action does, once per selected
 * row, so a bulk and a row-by-row run end in the same state.
 *
 * A batch is all or nothing. Every id is checked before the first write, and
 * the live adapter (`src/db/bulk.ts`) runs the whole batch in one transaction,
 * so a throw part way leaves every row as it was.
 *
 * A repeat is not an error. When none of the ids has anything left to do (a
 * double submit, or a page that was stale), the answer is `already` and
 * nothing is written. A batch where some ids have work and others are gone is
 * refused whole: the page the person selected on is out of date.
 */
import { updateFood, usualProductRows, type FoodsStore } from "./foods.js";
import { removeUsual } from "./usual-add.js";
import { type FridgeStore } from "./fridge.js";
import {
    assertCanDeleteRecipe,
    deleteRecipe,
    type Recipe,
    type RecipesStore,
} from "./recipes.js";
import {
    discardFridgeItem,
    StockInputError,
    type StockStore,
} from "./stock.js";

/** More rows than a person selects by hand; a bigger post is a mistake or abuse. */
export const BULK_MAX_IDS = 200;

export class BulkSelectionError extends Error {
    readonly code = "bulk_selection" as const;

    constructor(message: string) {
        super(message);
        this.name = "BulkSelectionError";
    }
}

export type BulkResult = {
    /** `already`: nothing was left to do, so nothing was written. */
    status: "applied" | "already";
    /** Rows changed. */
    count: number;
};

const ALREADY: BulkResult = { status: "already", count: 0 };

const UUID_SHAPE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STALE_MESSAGE =
    "Some of those are no longer there. Reload the page and select again.";

/**
 * The ids a form posted (`ids`, once or many): each uuid once, in order.
 * Anything that is not a uuid fails the whole batch, so a bad id never reaches
 * a uuid-typed query as a cast error.
 */
export function parseBulkIds(raw: unknown): string[] {
    const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
    const ids: string[] = [];
    for (const value of values) {
        if (typeof value !== "string") {
            throw new BulkSelectionError("That selection is not valid.");
        }
        const id = value.trim();
        if (!UUID_SHAPE.test(id)) {
            throw new BulkSelectionError("That selection is not valid.");
        }
        if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length === 0) {
        throw new BulkSelectionError("Select at least one item.");
    }
    if (ids.length > BULK_MAX_IDS) {
        throw new BulkSelectionError(
            `Select ${BULK_MAX_IDS} items or fewer at a time.`,
        );
    }
    return ids;
}

type Found<T> = { kind: "todo"; item: T } | { kind: "done" } | null;

/**
 * Sorts a batch into what to do. `null` means nothing is left to do (every id
 * is done or gone); a batch that mixes work with ids that are gone throws.
 */
function settle<I, T>(
    items: readonly I[],
    find: (item: I) => Found<T>,
): T[] | null {
    const todo: T[] = [];
    let unknown = 0;
    for (const item of items) {
        const found = find(item);
        if (found === null) unknown += 1;
        else if (found.kind === "todo") todo.push(found.item);
    }
    if (todo.length === 0) return null;
    if (unknown > 0) throw new BulkSelectionError(STALE_MESSAGE);
    return todo;
}

/**
 * Throw away several fridge items, each as a `discard` movement through
 * `applyMovement`, so the stock ledger still adds up for every one.
 */
export async function discardFridgeItems(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        itemIds: readonly string[];
        actorUserId?: string | null;
    },
): Promise<BulkResult> {
    const items = new Map(
        (await fridge.listItems(input.householdId)).map((i) => [i.id, i]),
    );
    const todo = settle(input.itemIds, (id) => {
        const item = items.get(id);
        return item ? { kind: "todo", item } : null;
    });
    if (!todo) return ALREADY;
    // Every item must be discardable before the first one is.
    for (const item of todo) {
        if (!item.foodId) {
            throw new StockInputError(
                `${item.displayName} is not linked to a food.`,
            );
        }
    }
    for (const item of todo) {
        await discardFridgeItem(fridge, stock, foods, {
            householdId: input.householdId,
            itemId: item.id,
            actorUserId: input.actorUserId,
        });
    }
    return { status: "applied", count: todo.length };
}

/**
 * Take several foods off the Usuals list. A food is a usual two ways, and
 * removing one has to end both: it has products (what puts it on the page) and
 * it has restock settings (what the restock runner and `list_usuals` read, and
 * what keeps adding it to Groceries), and one added by hand carries its own
 * stamp. `removeUsual` ends all of them for each selected food: its products
 * come off (which also clears the usual product), the stamp goes, and its
 * schedule, paused flag, add-when-low switch, low level and last-restocked day
 * go back to `NO_USUAL_SCHEDULE`.
 */
export async function removeUsuals(
    foods: FoodsStore,
    input: { householdId: string; foodIds: readonly string[] },
): Promise<BulkResult> {
    const { rows } = usualProductRows({
        foods: await foods.listFoods(input.householdId),
    });
    const byFood = new Map(rows.map((row) => [row.food.id, row]));
    const todo = settle(input.foodIds, (id) => {
        const row = byFood.get(id);
        return row ? { kind: "todo", item: row } : null;
    });
    if (!todo) return ALREADY;
    for (const row of todo) {
        await removeUsual(foods, input.householdId, row.food.id);
    }
    return { status: "applied", count: todo.length };
}

/**
 * Delete saved foods and recipes: a food is archived (existing logs keep their
 * snapshots), a recipe is deleted, as each row's Delete does. A food that is
 * already archived counts as done, so a repeat of a mixed selection (foods
 * archived, recipes gone) is still `already`. A recipe the member may not
 * delete fails the whole batch before anything is written.
 */
export async function deleteSavedItems(
    foods: FoodsStore,
    recipes: RecipesStore,
    input: {
        householdId: string;
        foodIds: readonly string[];
        recipeIds: readonly string[];
        actor: { userId: string; isOwner: boolean };
    },
): Promise<BulkResult> {
    type Target = { kind: "food"; id: string } | { kind: "recipe"; id: string };
    const targets: Target[] = [
        ...input.foodIds.map((id) => ({ kind: "food" as const, id })),
        ...input.recipeIds.map((id) => ({ kind: "recipe" as const, id })),
    ];
    const foodRows = await foods.getFoodsByIds(input.householdId, [
        ...input.foodIds,
    ]);
    const recipeRows = new Map<string, Recipe>();
    for (const id of input.recipeIds) {
        const recipe = await recipes.getRecipe(input.householdId, id);
        if (recipe) recipeRows.set(id, recipe);
    }
    const todo = settle(targets, (target): Found<Target> => {
        if (target.kind === "food") {
            const food = foodRows.get(target.id);
            if (!food) return null;
            return food.archivedAt
                ? { kind: "done" }
                : { kind: "todo", item: target };
        }
        return recipeRows.has(target.id)
            ? { kind: "todo", item: target }
            : null;
    });
    if (!todo) return ALREADY;
    for (const target of todo) {
        if (target.kind !== "recipe") continue;
        assertCanDeleteRecipe(recipeRows.get(target.id)!, input.actor);
    }
    for (const target of todo) {
        if (target.kind === "food") {
            await updateFood(foods, input.householdId, target.id, {
                archived: true,
            });
        } else {
            await deleteRecipe(
                recipes,
                input.householdId,
                target.id,
                input.actor,
            );
        }
    }
    return { status: "applied", count: todo.length };
}
