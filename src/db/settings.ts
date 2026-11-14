import {
    AGENTS_DESTRUCTIVE_ALLOWED_KEY,
    agentDestructiveAllowedFromJson,
    GROCERY_DEFAULT_STORE_KEY,
    GROCERY_USE_USUAL_STORE_KEY,
    SettingsInputError,
    groceryPreferencesFromJson,
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
        async getGroceryPreferences(householdId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ prefs: unknown }>(
                        tx,
                        tx`
                            select household_preferences as prefs
                            from ${tx.unsafe(HOUSEHOLDS)}
                            where id = ${householdId}
                        `,
                        "load grocery preferences",
                    );
                    return groceryPreferencesFromJson(data?.prefs);
                } catch (err) {
                    throw pgError("load grocery preferences", err);
                }
            });
        },
        async setGroceryPreferences(householdId, prefs) {
            return run(async (tx) => {
                try {
                    if (prefs.defaultStoreId !== null) {
                        const known = await maybeOne<{ id: unknown }>(
                            tx,
                            tx`
                                select id
                                from ${tx.unsafe(GROCERY_STORES)}
                                where id = ${prefs.defaultStoreId}
                                  and household_id = ${householdId}
                            `,
                            "check default store",
                        );
                        if (!known)
                            throw new SettingsInputError("Unknown store.");
                    }
                    const data = await maybeOne<{ prefs: unknown }>(
                        tx,
                        tx`
                            update ${tx.unsafe(HOUSEHOLDS)}
                            set household_preferences =
                                (coalesce(household_preferences, '{}'::jsonb)
                                    - ${GROCERY_DEFAULT_STORE_KEY}::text)
                                || jsonb_strip_nulls(jsonb_build_object(
                                    ${GROCERY_DEFAULT_STORE_KEY}::text,
                                    ${prefs.defaultStoreId}::text
                                ))
                                || jsonb_build_object(
                                    ${GROCERY_USE_USUAL_STORE_KEY}::text,
                                    ${prefs.useUsualStore}::boolean
                                )
                            where id = ${householdId}
                            returning household_preferences as prefs
                        `,
                        "save grocery preferences",
                    );
                    if (!data)
                        throw new SettingsInputError("Unknown household.");
                    return groceryPreferencesFromJson(data.prefs);
                } catch (err) {
                    if (err instanceof SettingsInputError) throw err;
                    throw pgError("save grocery preferences", err);
                }
            });
        },
        async getAgentDestructiveAllowed(householdId) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ prefs: unknown }>(
                        tx,
                        tx`
                            select household_preferences as prefs
                            from ${tx.unsafe(HOUSEHOLDS)}
                            where id = ${householdId}
                        `,
                        "load agents switch",
                    );
                    return agentDestructiveAllowedFromJson(data?.prefs);
                } catch (err) {
                    throw pgError("load agents switch", err);
                }
            });
        },
        async setAgentDestructiveAllowed(householdId, allowed) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<{ prefs: unknown }>(
                        tx,
                        tx`
                            update ${tx.unsafe(HOUSEHOLDS)}
                            set household_preferences =
                                coalesce(household_preferences, '{}'::jsonb)
                                || jsonb_build_object(
                                    ${AGENTS_DESTRUCTIVE_ALLOWED_KEY}::text,
                                    ${allowed}::boolean
                                )
                            where id = ${householdId}
                            returning household_preferences as prefs
                        `,
                        "save agents switch",
                    );
                    if (!data)
                        throw new SettingsInputError("Unknown household.");
                    return agentDestructiveAllowedFromJson(data.prefs);
                } catch (err) {
                    if (err instanceof SettingsInputError) throw err;
                    throw pgError("save agents switch", err);
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
        async updateStore(row) {
            return run(async (tx) => {
                try {
                    const data = await maybeOne<Record<string, unknown>>(
                        tx,
                        tx`
                            update ${tx.unsafe(GROCERY_STORES)}
                            set name = ${row.name}
                            where id = ${row.id}
                              and household_id = ${row.householdId}
                            returning ${tx.unsafe(GROCERY_STORE_COLS)}
                        `,
                        "update grocery store",
                    );
                    return data ? groceryStoreFromRow(data as never) : null;
                } catch (err) {
                    throw pgError("update grocery store", err);
                }
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
        async deleteSection(householdId, id) {
            return run(async (tx) => {
                // `grocery_lines.section_id` cascades, so deleting a section
                // deletes any line still in it. This transaction's own delete
                // count for the lines table, read around the delete, says
                // whether one went with it, and a line is never lost that way:
                // the error rolls the delete back.
                const lineDeletes = async () =>
                    Number(
                        (
                            await maybeOne<{ n: string | number }>(
                                tx,
                                tx`select pg_stat_get_xact_tuples_deleted('public.grocery_lines'::regclass) as n`,
                                "count grocery line deletes",
                            )
                        )?.n ?? 0,
                    );
                try {
                    const before = await lineDeletes();
                    const data = await rows<{ id: string }>(
                        tx,
                        tx`
                            delete from ${tx.unsafe(GROCERY_SECTIONS)}
                            where id = ${id}
                              and household_id = ${householdId}
                            returning id
                        `,
                    );
                    if ((await lineDeletes()) !== before) {
                        throw new SettingsInputError(
                            "The list changed. Try again.",
                        );
                    }
                    return data.length > 0;
                } catch (err) {
                    if (err instanceof SettingsInputError) throw err;
                    throw pgError("delete grocery section", err);
                }
            });
        },
    };
}

export type { SettingsStore };
