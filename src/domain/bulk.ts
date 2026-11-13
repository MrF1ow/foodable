/**
 * Select several rows, act once: the bulk twins of the single-row actions on
 * the Groceries, Fridge, Usuals and Saved foods & recipes lists. Each one
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
 * refused whole: the page the person selected on is out of date. A line that
 * is already ticked is done: ticking it again would move a usual's restock day
 * from the day it was bought to today, which ticking row by row never does.
 */
import {
    NO_USUAL_SCHEDULE,
    removeProduct,
    setUsualSchedule,
    updateFood,
    usualProductRows,
    type FoodsStore,
} from "./foods.js";
import { type FridgeStore } from "./fridge.js";
import {
    checkGroceryLine,
    type GroceryLine,
    type GroceryListStore,
} from "./grocery.js";
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
 * Tick several grocery lines off, as ticking each alone does. Lines that are
 * already ticked are skipped (select mode lets a person pick them): they are
 * not stamped again and not counted.
 */
export async function tickOffGroceryLines(
    grocery: GroceryListStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        lineIds: readonly string[];
        today: string;
        /** Keeps a failed restock stamp from aborting the batch (see `checkGroceryLine`). */
        isolate?: <T>(work: () => Promise<T>) => Promise<T>;
    },
): Promise<BulkResult> {
    const lines = new Map(
        (await grocery.listLines(input.householdId)).map((l) => [l.id, l]),
    );
    const todo = settle(input.lineIds, (id): Found<GroceryLine> => {
        const line = lines.get(id);
        if (!line) return null;
        return line.checked ? { kind: "done" } : { kind: "todo", item: line };
    });
    if (!todo) return ALREADY;
    for (const line of todo) {
        await checkGroceryLine(grocery, input.householdId, line.id, true, {
            foods,
            today: input.today,
            isolate: input.isolate,
        });
    }
    return { status: "applied", count: todo.length };
}

/** Delete several grocery lines (what Clear checked does to the checked ones). */
export async function removeGroceryLines(
    grocery: GroceryListStore,
    input: { householdId: string; lineIds: readonly string[] },
): Promise<BulkResult> {
    const lines = new Map(
        (await grocery.listLines(input.householdId)).map((l) => [l.id, l]),
    );
    const todo = settle(input.lineIds, (id) => {
        const line = lines.get(id);
        return line ? { kind: "todo", item: line } : null;
    });
    if (!todo) return ALREADY;
    for (const line of todo) {
        await grocery.deleteLine(input.householdId, line.id);
    }
    return { status: "applied", count: todo.length };
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
 * what keeps adding it to Groceries). Each selected food loses its products,
 * as Remove does to one product (`removeProduct` also clears the usual
 * product), and its schedule, paused flag, add-when-low switch, low level and
 * last-restocked day go back to `NO_USUAL_SCHEDULE`.
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
        for (const product of row.products) {
            await removeProduct(
                foods,
                input.householdId,
                row.food.id,
                product.id,
            );
        }
        await setUsualSchedule(
            foods,
            input.householdId,
            row.food.id,
            NO_USUAL_SCHEDULE,
        );
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
