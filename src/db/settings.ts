import {
    grocerySectionFromRow,
    grocerySectionToRow,
    groceryStoreFromRow,
    groceryStoreToRow,
    type SettingsStore,
} from "../domain/settings.js";
import {
    definedColumns,
    insertReturning,
    maybeOne,
    pgError,
    rows,
    run,
} from "./sql.js";

const HOUSEHOLDS = "households";
const GROCERY_STORES = "grocery_stores";
const GROCERY_SECTIONS = "grocery_sections";
const GROCERY_STORE_COLS = "id, household_id, name, sort_order";
const GROCERY_SECTION_COLS =
    "id, household_id, store_id, name, sort_order, hidden, is_other";

function patchKeys(keys: string[]): [string, ...string[]] {
    return keys as [string, ...string[]];
}

export function liveSettingsStore(): SettingsStore {
    return {
        async getLocation(householdId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ location: unknown }>(
                        tx,
                        tx`
                            select location
                            from ${tx.unsafe(HOUSEHOLDS)}
                            where id = ${householdId}
                        `,
                        "load household location",
                    );
                    return typeof data?.location === "string" &&
                        data.location.trim()
                        ? data.location
                        : null;
                } catch (err) {
                    throw pgError("load household location", err);
                }
            });
        },
        async setLocation(householdId, location) {
            return run(async (tx) => {
                try {
                    await tx`
                        update ${tx.unsafe(HOUSEHOLDS)}
                        set location = ${location}
                        where id = ${householdId}
                    `;
                } catch (err) {
                    throw pgError("save household location", err);
                }
            });
        },
        async listStores(householdId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(GROCERY_STORE_COLS)}
                            from ${tx.unsafe(GROCERY_STORES)}
                            where household_id = ${householdId}
                            order by sort_order asc, name asc
                        `,
                    );
                    return data.map((row) => groceryStoreFromRow(row as never));
                } catch (err) {
                    throw pgError("list grocery stores", err);
                }
            });
        },
        async insertStore(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    GROCERY_STORES,
                    groceryStoreToRow(row),
                    GROCERY_STORE_COLS,
                    "add grocery store",
                );
                return groceryStoreFromRow(data as never);
            });
        },
        async listSections(storeId) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(GROCERY_SECTION_COLS)}
                            from ${tx.unsafe(GROCERY_SECTIONS)}
                            where store_id = ${storeId}
                            order by sort_order asc, name asc
                        `,
                    );
                    return data.map((row) =>
                        grocerySectionFromRow(row as never),
                    );
                } catch (err) {
                    throw pgError("list grocery sections", err);
                }
            });
        },
        async getSection(householdId, id) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            select ${tx.unsafe(GROCERY_SECTION_COLS)}
                            from ${tx.unsafe(GROCERY_SECTIONS)}
                            where id = ${id}
                              and household_id = ${householdId}
                        `,
                        "load grocery section",
                    );
                    return data ? grocerySectionFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("load grocery section", err);
                }
            });
        },
        async insertSection(row) {
            return run(async (tx) => {
                const data = await insertReturning<Record<string, unknown>>(
                    tx,
                    GROCERY_SECTIONS,
                    grocerySectionToRow(row),
                    GROCERY_SECTION_COLS,
                    "add grocery section",
                );
                return grocerySectionFromRow(data as never);
            });
        },
        async updateSection(row) {
            return run(async (tx) => {
                try {
                    const { row: patch, keys } = definedColumns(
                        grocerySectionToRow(row),
                    );
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(GROCERY_SECTIONS)} set ${tx(patch, ...patchKeys(keys))}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(GROCERY_SECTION_COLS)}
                        `,
                        "update grocery section",
                    );
                    return data ? grocerySectionFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update grocery section", err);
                }
            });
        },
    };
}

export type { SettingsStore };
