import {
    fridgeItemFromRow,
    fridgeItemToRow,
    fridgeLocationFromRow,
    fridgeLocationToRow,
    type FridgeStore,
} from "../domain/fridge.js";
import { cleanupDismissalsForSubjectTx } from "./notice-dismissals.js";
import {
    definedColumns,
    insertReturning,
    maybeOne,
    pgError,
    rows,
    run,
    type Tx,
} from "./sql.js";

const FRIDGE_LOCATIONS = "fridge_locations";
const FRIDGE_ITEMS = "fridge_items";
const FRIDGE_LOCATION_COLS = "id, household_id, name, sort_order";
const FRIDGE_ITEM_COLS =
    "id, household_id, location_id, kind, display_name, amount, unit, food_id, purchased_on, opened_on, expires_on";

function patchKeys(
    patch: Record<string, unknown>,
    keys: string[],
): [string, ...string[]] {
    return keys as [string, ...string[]];
}

export function liveFridgeStore(): FridgeStore {
    return {
        async listLocations(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(FRIDGE_LOCATION_COLS)}
                            from ${tx.unsafe(FRIDGE_LOCATIONS)}
                            where household_id = ${householdId}
                            order by sort_order asc, name asc
                        `,
                    );
                    return data.map((row) =>
                        fridgeLocationFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list fridge locations", err);
                }
            });
        },
        async insertLocation(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    FRIDGE_LOCATIONS,
                    fridgeLocationToRow(row),
                    FRIDGE_LOCATION_COLS,
                    "add fridge location",
                );
                return fridgeLocationFromRow(data as never);
            });
        },
        async updateLocation(row) {
            return run(async (tx) => {
                try {
                    const { row: patch, keys } = definedColumns(
                        fridgeLocationToRow(row),
                    );
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(FRIDGE_LOCATIONS)} set ${tx(patch, ...patchKeys(patch, keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(FRIDGE_LOCATION_COLS)}
                        `,
                        "update fridge location",
                    );
                    return data ? fridgeLocationFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update fridge location", err);
                }
            });
        },
        async deleteLocation(householdId, id) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(FRIDGE_LOCATIONS)}
                            where id = ${id}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete fridge location", err);
                }
            });
        },
        async listItems(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(FRIDGE_ITEM_COLS)}
                            from ${tx.unsafe(FRIDGE_ITEMS)}
                            where household_id = ${householdId}
                            order by created_at asc
                        `,
                    );
                    return data.map((row) => fridgeItemFromRow(row as never));
                } catch (err) {
                    throw pgError("list fridge items", err);
                }
            });
        },
        async insertItem(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    FRIDGE_ITEMS,
                    fridgeItemToRow(row),
                    FRIDGE_ITEM_COLS,
                    "add fridge item",
                );
                return fridgeItemFromRow(data as never);
            });
        },
        async updateItem(row) {
            return run(async (tx) => {
                try {
                    const payload = {
                        ...fridgeItemToRow(row),
                        updated_at: new Date().toISOString(),
                    };
                    const { row: patch, keys } = definedColumns(payload);
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(FRIDGE_ITEMS)} set ${tx(patch, ...patchKeys(patch, keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(FRIDGE_ITEM_COLS)}
                        `,
                        "update fridge item",
                    );
                    return data ? fridgeItemFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update fridge item", err);
                }
            });
        },
        async deleteItem(householdId, id) {
            return run(async (tx) => {
                try {
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(FRIDGE_ITEMS)}
                            where id = ${id}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    if (data.length > 0) {
                        await cleanupDismissalsForSubjectTx(
                            tx,
                            householdId,
                            "fridge_item",
                            id,
                        );
                    }
                    return data.length > 0;
                } catch (err) {
                    throw pgError("delete fridge item", err);
                }
            });
        },
    };
}

export type { FridgeStore };
