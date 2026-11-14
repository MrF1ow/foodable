import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveStockStore } from "../../db/stock.js";
import { BULK_MAX_IDS } from "../../domain/bulk.js";
import {
    FridgeInputError,
    moveItem,
    type FridgeItem,
    type FridgeStore,
} from "../../domain/fridge.js";
import { deleteFridgeItemAdjust, StockInputError } from "../../domain/stock.js";
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

export const MOVE_FRIDGE_ITEMS_OUTPUT_SCHEMA = z.object({
    location_id: z.string(),
    location: z.string(),
    moved: z.array(
        z.object({
            id: z.string(),
            display_name: z.string(),
            /** Where the item was before this call. */
            from_location_id: z.string(),
            from_location: z.string(),
        }),
    ),
    /** Items that were already at the destination. */
    unchanged: z.array(z.string()),
});

export const DELETE_FRIDGE_ITEMS_OUTPUT_SCHEMA = z.object({
    deleted: z.array(
        z.object({
            id: z.string(),
            display_name: z.string(),
            amount: z.number(),
            unit: z.string(),
        }),
    ),
});

const FRIDGE_ITEM_IDS = z
    .array(z.uuid("each id must be a fridge item id from get_fridge"))
    .min(1)
    .max(BULK_MAX_IDS);

function itemCount(count: number): string {
    return `${count} fridge ${count === 1 ? "item" : "items"}`;
}

function asToolError(err: unknown): never {
    if (err instanceof FridgeInputError || err instanceof StockInputError) {
        throw new Error(err.message);
    }
    throw err;
}

/** The tool names this module registers, in registration order. */
export const FRIDGE_ADMIN_TOOL_NAMES = [
    "move_fridge_items",
    "delete_fridge_items",
] as const;

/** The ids as asked, each once, in order. */
function uniqueIds(ids: readonly string[]): string[] {
    return [...new Set(ids)];
}

/**
 * The fridge store with a tripwire: `expect(item)` arms it, and the next time
 * the domain re-reads the items it must find that item exactly as it was
 * recorded. The domain functions (moveItem, deleteFridgeItemAdjust) re-list the
 * items themselves, so a change that lands between the capture and that read
 * would otherwise be folded into the agent's action and reversed or missed by
 * undo. A mismatch throws, the guard rolls the call back, and nothing changes.
 */
function watchedFridge(fridge: FridgeStore, doing: string) {
    let armed: FridgeItem | null = null;
    const store: FridgeStore = {
        ...fridge,
        async listItems(householdId) {
            const items = await fridge.listItems(householdId);
            if (armed) {
                const before = armed;
                armed = null;
                const now = items.find((item) => item.id === before.id);
                if (!now || JSON.stringify(now) !== JSON.stringify(before)) {
                    throw new FridgeInputError(
                        `Fridge item ${before.displayName} changed while it was being ${doing}. Nothing was changed. Try again.`,
                    );
                }
            }
            return items;
        },
    };
    return {
        store,
        expect(item: FridgeItem) {
            armed = item;
        },
    };
}

/**
 * Move and delete fridge items several at a time. Behind `mcp-household-admin`
 * with the grocery and store admin tools: each goes through the destructive
 * guard, so what it changed is recorded and the household can undo it.
 */
export function registerFridgeAdminTools(server: McpServer, ctx: ToolContext) {
    const { analytics, runDestructive } = ctx;

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "move_fridge_items",
        {
            title: "Move Fridge Items",
            description: `Move several fridge items to one location (ids from get_fridge, location_id from get_fridge locations). Quantities and dates stay as they are. An id that is no fridge item refuses the whole call and moves nothing. ${ADMIN_UNDO_NOTE}`,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                ids: FRIDGE_ITEM_IDS,
                location_id: z.uuid(
                    "location_id must be a location id from get_fridge",
                ),
            }),
            outputSchema: MOVE_FRIDGE_ITEMS_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "move_fridge_items",
                async () => {
                    try {
                        const run = await runDestructive(
                            "move_fridge_items",
                            async (rec, householdId) => {
                                const fridge = liveFridgeStore();
                                const locations =
                                    await fridge.listLocations(householdId);
                                const target = locations.find(
                                    (row) => row.id === args.location_id,
                                );
                                if (!target) {
                                    throw new FridgeInputError(
                                        `No fridge location found with id ${args.location_id}. Nothing was changed.`,
                                    );
                                }
                                const ids = uniqueIds(args.ids);
                                const items =
                                    await fridge.listItems(householdId);
                                const byId = new Map(
                                    items.map((item) => [item.id, item]),
                                );
                                const missing = ids.filter(
                                    (id) => !byId.has(id),
                                );
                                if (missing.length > 0) {
                                    throw new FridgeInputError(
                                        `No fridge item found with id ${missing.join(", ")}. Nothing was changed.`,
                                    );
                                }
                                const found = ids.map((id) => byId.get(id)!);
                                const moving = found.filter(
                                    (item) => item.locationId !== target.id,
                                );
                                // Exactly the items recorded here are moved.
                                await rec.captureByIds(
                                    "fridge_items",
                                    moving.map((item) => item.id),
                                    "updated",
                                );
                                const placeName = (id: string) =>
                                    locations.find((row) => row.id === id)
                                        ?.name ?? "";
                                const moved: {
                                    id: string;
                                    display_name: string;
                                    from_location_id: string;
                                    from_location: string;
                                }[] = [];
                                const watched = watchedFridge(fridge, "moved");
                                for (const item of moving) {
                                    watched.expect(item);
                                    const saved = await moveItem(
                                        watched.store,
                                        householdId,
                                        item.id,
                                        target.id,
                                    );
                                    if (!saved) {
                                        throw new FridgeInputError(
                                            `Fridge item ${item.displayName} changed while it was being moved. Nothing was changed. Try again.`,
                                        );
                                    }
                                    moved.push({
                                        id: item.id,
                                        display_name: item.displayName,
                                        from_location_id: item.locationId,
                                        from_location: placeName(
                                            item.locationId,
                                        ),
                                    });
                                }
                                return {
                                    value: {
                                        location_id: target.id,
                                        location: target.name,
                                        moved,
                                        unchanged: found
                                            .filter(
                                                (item) =>
                                                    item.locationId ===
                                                    target.id,
                                            )
                                            .map((item) => item.id),
                                    },
                                    summary: `Moved ${itemCount(moved.length)} to ${target.name}`,
                                    changed: moved.length > 0,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { value } = run;
                        const said = [
                            value.moved.length > 0
                                ? `Moved ${itemCount(value.moved.length)} to ${value.location}: ${value.moved.map((row) => row.display_name).join(", ")}.`
                                : `Nothing moved: everything is already in ${value.location}.`,
                            value.moved.length > 0 && value.unchanged.length > 0
                                ? `${itemCount(value.unchanged.length)} already there.`
                                : "",
                        ].filter(Boolean);
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(said.join(" "), run.undo),
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
        "delete_fridge_items",
        {
            title: "Delete Fridge Items",
            description: `Remove several fridge items (ids from get_fridge), each exactly as delete_fridge_item does: the stock ledger records the removal. An id that is no fridge item refuses the whole call and removes nothing. ${ADMIN_UNDO_NOTE}`,
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                ids: FRIDGE_ITEM_IDS,
            }),
            outputSchema: DELETE_FRIDGE_ITEMS_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "delete_fridge_items",
                async () => {
                    try {
                        const run = await runDestructive(
                            "delete_fridge_items",
                            async (rec, householdId) => {
                                const fridge = liveFridgeStore();
                                const ids = uniqueIds(args.ids);
                                const items =
                                    await fridge.listItems(householdId);
                                const byId = new Map(
                                    items.map((item) => [item.id, item]),
                                );
                                const missing = ids.filter(
                                    (id) => !byId.has(id),
                                );
                                if (missing.length > 0) {
                                    throw new FridgeInputError(
                                        `No fridge item found with id ${missing.join(", ")}. Nothing was changed.`,
                                    );
                                }
                                const found = ids.map((id) => byId.get(id)!);
                                // Captured before the write, so the stock
                                // movements it adds are recorded too.
                                const report = await rec.captureCascade(
                                    "fridge_items",
                                    found.map((item) => ({ id: item.id })),
                                );
                                await captureDismissals(
                                    rec,
                                    householdId,
                                    dismissedOn("fridge_item", ids),
                                );
                                const stock = liveStockStore();
                                const foods = liveFoodsStore();
                                // Exactly the items recorded above: one that
                                // went away since is refused, not skipped.
                                const watched = watchedFridge(
                                    fridge,
                                    "removed",
                                );
                                for (const item of found) {
                                    watched.expect(item);
                                    const deleted =
                                        await deleteFridgeItemAdjust(
                                            watched.store,
                                            stock,
                                            foods,
                                            { householdId, itemId: item.id },
                                        );
                                    if (!deleted) {
                                        throw new FridgeInputError(
                                            `Fridge item ${item.displayName} changed while it was being removed. Nothing was changed. Try again.`,
                                        );
                                    }
                                }
                                return {
                                    value: {
                                        deleted: found.map((item) => ({
                                            id: item.id,
                                            display_name: item.displayName,
                                            amount: item.quantity.amount,
                                            unit: item.quantity.unit,
                                        })),
                                    },
                                    summary: `Deleted ${itemCount(found.length)}: ${found.map((item) => item.displayName).join(", ")}${uncapturedNote(report.uncaptured)}`,
                                    changed: found.length > 0,
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
                                        `Deleted ${itemCount(value.deleted.length)}: ${value.deleted.map((row) => `${row.display_name} (${row.amount} ${row.unit})`).join(", ")}.`,
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
}
