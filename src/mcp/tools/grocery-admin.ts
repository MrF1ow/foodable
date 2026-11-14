import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { BULK_MAX_IDS } from "../../domain/bulk.js";
import { FoodsInputError, type FoodsStore } from "../../domain/foods.js";
import { GroceryInputError } from "../../domain/grocery.js";
import { removeUsual } from "../../domain/usual-add.js";
import { gatedTool } from "../gated.js";
import {
    captureDismissals,
    destructiveOutcome,
    dismissedOn,
    uncapturedNote,
    withUndo,
    type ToolContext,
} from "../shared.js";
import { ADMIN_UNDO_NOTE } from "./grocery.js";
import { HOUSEHOLD_ADMIN_FLAG } from "./stores.js";

/** The tool names this module registers, in registration order. */
export const GROCERY_ADMIN_TOOL_NAMES = [
    "delete_grocery_lines",
    "remove_usual",
] as const;

export const DELETE_GROCERY_LINES_OUTPUT_SCHEMA = z.object({
    deleted: z.array(
        z.object({
            id: z.string(),
            display_name: z.string(),
            amount: z.number(),
            unit: z.string(),
        }),
    ),
});

export const REMOVE_USUAL_OUTPUT_SCHEMA = z.object({
    food_id: z.string(),
    name: z.string(),
    /** False when the food was not a usual and had no schedule: nothing was changed. */
    changed: z.boolean(),
    /** The products that came off the food's list. */
    products_removed: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
        }),
    ),
});

function lineCount(count: number): string {
    return `${count} grocery ${count === 1 ? "line" : "lines"}`;
}

function asToolError(err: unknown): never {
    if (err instanceof FoodsInputError || err instanceof GroceryInputError) {
        throw new Error(err.message);
    }
    throw err;
}

/**
 * Delete several grocery lines and take a food off the Usuals list. Behind
 * `mcp-household-admin` with the other admin tools: each goes through the
 * destructive guard, so what it changed is recorded and can be undone.
 */
export function registerGroceryAdminTools(server: McpServer, ctx: ToolContext) {
    const { analytics, runDestructive } = ctx;

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "delete_grocery_lines",
        {
            title: "Delete Grocery Lines",
            description: `Remove several grocery lines (ids from list_grocery_lines), each exactly as delete_grocery_line does. An id that is no grocery line refuses the whole call and removes nothing. ${ADMIN_UNDO_NOTE}`,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                ids: z
                    .array(
                        z.uuid(
                            "each id must be a grocery line id from list_grocery_lines",
                        ),
                    )
                    .min(1)
                    .max(BULK_MAX_IDS),
            }),
            outputSchema: DELETE_GROCERY_LINES_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "delete_grocery_lines",
                async () => {
                    try {
                        const run = await runDestructive(
                            "delete_grocery_lines",
                            async (rec, householdId) => {
                                const grocery = liveGroceryStore();
                                const ids = [...new Set(args.ids)];
                                const byId = new Map(
                                    (await grocery.listLines(householdId)).map(
                                        (line) => [line.id, line],
                                    ),
                                );
                                const missing = ids.filter(
                                    (id) => !byId.has(id),
                                );
                                if (missing.length > 0) {
                                    throw new GroceryInputError(
                                        `No grocery line found with id ${missing.join(", ")}. Nothing was changed.`,
                                    );
                                }
                                const lines = ids.map((id) => byId.get(id)!);
                                const report = await rec.captureCascade(
                                    "grocery_lines",
                                    ids.map((id) => ({ id })),
                                );
                                await captureDismissals(
                                    rec,
                                    householdId,
                                    dismissedOn("grocery_line", ids),
                                );
                                // Exactly the lines recorded above: one that
                                // went away since is refused, not skipped.
                                for (const line of lines) {
                                    if (
                                        !(await grocery.deleteLine(
                                            householdId,
                                            line.id,
                                        ))
                                    ) {
                                        throw new GroceryInputError(
                                            `Grocery line ${line.displayName} changed while it was being removed. Nothing was changed; try again.`,
                                        );
                                    }
                                }
                                return {
                                    value: {
                                        deleted: lines.map((line) => ({
                                            id: line.id,
                                            display_name: line.displayName,
                                            amount: line.quantity.amount,
                                            unit: line.quantity.unit,
                                        })),
                                    },
                                    summary: `Deleted ${lineCount(lines.length)}: ${lines.map((line) => line.displayName).join(", ")}${uncapturedNote(report.uncaptured)}`,
                                    changed: lines.length > 0,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { value } = run;
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(
                                        `Deleted ${lineCount(value.deleted.length)}: ${value.deleted.map((row) => row.display_name).join(", ")}.`,
                                        run.undo,
                                    ),
                                },
                            ],
                            structuredContent: value,
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "remove_usual",
        {
            title: "Remove Usual",
            description: `Take a plain food off the Usuals list, as Remove does in the app: its products come off the food (they stay in the catalog as foods of their own), the usual product and the added-by-hand mark clear, and the restock schedule resets. Pass the plain food's id (from list_usuals or search_food), not a product's. ${ADMIN_UNDO_NOTE}`,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                food_id: z.uuid(
                    "food_id must be the id of a plain food from list_usuals or search_food",
                ),
            }),
            outputSchema: REMOVE_USUAL_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "remove_usual",
                async () => {
                    try {
                        const run = await runDestructive(
                            "remove_usual",
                            async (rec, householdId) => {
                                const foods = liveFoodsStore();
                                const food = await foods.getFood(
                                    householdId,
                                    args.food_id,
                                );
                                if (!food || food.archivedAt) {
                                    throw new FoodsInputError(
                                        `No food found with id ${args.food_id}. Nothing was changed.`,
                                    );
                                }
                                if (food.genericFoodId) {
                                    throw new FoodsInputError(
                                        `${food.name} is a product of another food, not a usual. Pass the plain food's id. Nothing was changed.`,
                                    );
                                }
                                const products = (
                                    await foods.listFoods(householdId)
                                ).filter(
                                    (row) =>
                                        row.genericFoodId === food.id &&
                                        !row.archivedAt,
                                );
                                // The food (usual product, stamp, schedule) and
                                // every product that comes off its list: exactly
                                // the rows removeUsual writes.
                                await rec.captureByIds(
                                    "foods",
                                    [food.id, ...products.map((row) => row.id)],
                                    "updated",
                                );
                                // removeUsual lists the foods again and unlinks
                                // every live product it finds: refuse if that
                                // is not exactly what was recorded, before it
                                // writes, and if one was filed under the food
                                // after it listed.
                                const recorded = new Set(
                                    products.map((row) => row.id),
                                );
                                const liveProducts = async (
                                    store: FoodsStore,
                                ) =>
                                    (await store.listFoods(householdId))
                                        .filter(
                                            (row) =>
                                                row.genericFoodId === food.id &&
                                                !row.archivedAt,
                                        )
                                        .map((row) => row.id);
                                const sameProducts = (ids: string[]) =>
                                    ids.length === recorded.size &&
                                    ids.every((id) => recorded.has(id));
                                const changedMidCall = () =>
                                    new FoodsInputError(
                                        `${food.name} changed while it was being removed from Usuals: a product was filed under it or taken off it. Nothing was changed. Try again.`,
                                    );
                                let checked = false;
                                const saved = await removeUsual(
                                    {
                                        ...foods,
                                        async listFoods(hh) {
                                            const listed =
                                                await foods.listFoods(hh);
                                            if (!checked) {
                                                checked = true;
                                                const ids = listed
                                                    .filter(
                                                        (row) =>
                                                            row.genericFoodId ===
                                                                food.id &&
                                                            !row.archivedAt,
                                                    )
                                                    .map((row) => row.id);
                                                if (!sameProducts(ids)) {
                                                    throw changedMidCall();
                                                }
                                            }
                                            return listed;
                                        },
                                    },
                                    householdId,
                                    food.id,
                                );
                                if ((await liveProducts(foods)).length > 0) {
                                    throw changedMidCall();
                                }
                                const same = (a: object, b: object) =>
                                    JSON.stringify({
                                        ...a,
                                        updatedAt: null,
                                    }) ===
                                    JSON.stringify({ ...b, updatedAt: null });
                                const changed =
                                    products.length > 0 || !same(food, saved);
                                return {
                                    value: {
                                        food_id: food.id,
                                        name: food.name,
                                        changed,
                                        products_removed: products.map(
                                            (row) => ({
                                                id: row.id,
                                                name: row.name,
                                            }),
                                        ),
                                    },
                                    summary: `Removed ${food.name} from the Usuals list${products.length > 0 ? ` (${products.length} product${products.length === 1 ? "" : "s"} taken off it)` : ""}`,
                                    changed,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { value } = run;
                        const text = !value.changed
                            ? `${value.name} is not on the Usuals list; nothing changed.`
                            : `Removed ${value.name} from the Usuals list${
                                  value.products_removed.length > 0
                                      ? `; ${value.products_removed.map((row) => row.name).join(", ")} came off its list`
                                      : ""
                              }.`;
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(text, run.undo),
                                },
                            ],
                            structuredContent: value,
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );
}
