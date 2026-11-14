import {
    AGENT_TABLE_KEYS,
    AgentUndoConflictError,
    agentActionFromRow,
    agentKeyString,
    agentRowKey,
    isAgentSnapshotTable,
    type AgentActionDeps,
    type AgentActionsStore,
    type AgentActionsTx,
    type AgentCascadeRow,
    type AgentRowKey,
    type AgentRowReference,
    type AgentSnapshotRow,
    type AgentSnapshotTable,
    type AgentUndoDeps,
    type RestorePatch,
} from "../domain/agent-actions.js";
import { jwtSubAndHouseholdForActor } from "./actor.js";
import { liveFoodsStore } from "./foods.js";
import { liveSettingsStore } from "./settings.js";
import { liveStockStore } from "./stock.js";
import { maybeOne, pgCode, pgError, rows, run, type Tx } from "./sql.js";

const AGENT_ACTIONS = "agent_actions";
const ACTION_COLS =
    "id, household_id, member_id, connection, tool, summary, destructive, snapshot, undoable, created_at, undo_expires_at, undone_at, undone_by";

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const INSUFFICIENT_PRIVILEGE = "42501";

function quote(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

/**
 * The table identifier for undo SQL. It is looked up in the map of undoable
 * tables and quoted, so a snapshot can never put its own text into a statement.
 */
function tableSql(table: AgentSnapshotTable): string {
    if (!isAgentSnapshotTable(table)) {
        throw new Error(`${String(table)} is not an undoable table`);
    }
    const known = Object.keys(AGENT_TABLE_KEYS).find((name) => name === table)!;
    return `public.${quote(known)}`;
}

/** The quoted key columns of a table, from the same map. */
function keyColumns(table: AgentSnapshotTable): readonly string[] {
    tableSql(table);
    return AGENT_TABLE_KEYS[table];
}

/** `t."a" = r."a" and t."b" = r."b"` over the key columns. */
function keyMatch(table: AgentSnapshotTable, left: string, right: string) {
    return keyColumns(table)
        .map((column) => `${left}.${quote(column)} = ${right}.${quote(column)}`)
        .join(" and ");
}

/** The table a foreign key violation names, from its detail line. */
function referencedTable(err: unknown): string | null {
    const detail =
        err && typeof err === "object" && "detail" in err
            ? String((err as { detail: unknown }).detail ?? "")
            : "";
    const missing = /is not present in table "([^"]+)"/.exec(detail);
    return missing ? missing[1]! : null;
}

/**
 * The columns a statement may write: those the table has now and that are not
 * generated. Columns the snapshot lacks are left to their defaults.
 */
async function writableColumns(
    tx: Tx,
    table: AgentSnapshotTable,
): Promise<{ name: string; jsonb: boolean }[]> {
    const found = await rows<{ column_name: string; udt_name: string }>(
        tx,
        tx`
            select column_name, udt_name
            from information_schema.columns
            where table_schema = 'public'
              and table_name = ${table}
              and is_generated = 'NEVER'
              and coalesce(identity_generation, '') <> 'ALWAYS'
            order by ordinal_position
        `,
    );
    return found.map((row) => ({
        name: row.column_name,
        jsonb: row.udt_name === "jsonb",
    }));
}

/**
 * A failed put-back as a conflict: every integrity error (SQLSTATE class 23:
 * a taken name, a missing parent, a required column, a check) says the table
 * no longer takes the row as it was, and "insufficient privilege" (42501, a
 * row policy or a grant) says it will not take it from this account. Anything
 * else is a real failure.
 */
function integrityConflict(
    err: unknown,
    table: AgentSnapshotTable,
    row: AgentSnapshotRow,
    blocked: "put" | "remove",
): AgentUndoConflictError | null {
    const code = pgCode(err);
    if (code === INSUFFICIENT_PRIVILEGE) {
        return new AgentUndoConflictError({ kind: "forbidden" }, table, row);
    }
    if (!code?.startsWith("23")) return null;
    if (blocked === "put" && code === UNIQUE_VIOLATION) {
        return new AgentUndoConflictError({ kind: "unique" }, table, row);
    }
    if (code === FOREIGN_KEY_VIOLATION) {
        return new AgentUndoConflictError(
            blocked === "put"
                ? {
                      kind: "missing_reference",
                      referencedTable: referencedTable(err),
                  }
                : { kind: "in_use" },
            table,
            row,
        );
    }
    return new AgentUndoConflictError({ kind: "refused" }, table, row);
}

/** A refusal for want of a privilege, as the conflict an undo reports. */
function notAllowed(
    err: unknown,
    table: AgentSnapshotTable,
    row: AgentSnapshotRow,
): AgentUndoConflictError | null {
    return pgCode(err) === INSUFFICIENT_PRIVILEGE
        ? new AgentUndoConflictError({ kind: "forbidden" }, table, row)
        : null;
}

async function readKeyedRows(
    tx: Tx,
    table: AgentSnapshotTable,
    keys: AgentRowKey[],
    lock = false,
): Promise<AgentSnapshotRow[]> {
    if (keys.length === 0) return [];
    try {
        const from = tx`
            select t.*
            from ${tx.unsafe(tableSql(table))} t
            join jsonb_populate_recordset(
                null::${tx.unsafe(tableSql(table))},
                ${JSON.stringify(keys)}::jsonb
            ) k on ${tx.unsafe(keyMatch(table, "t", "k"))}
        `;
        return await rows<AgentSnapshotRow>(
            tx,
            lock ? tx`${from} for update of t` : from,
        );
    } catch (err) {
        // A lock is only taken by an undo, which reports a refusal as a conflict.
        throw (
            (lock ? notAllowed(err, table, keys[0] ?? {}) : null) ??
            pgError("read rows for an agent action", err)
        );
    }
}

type ForeignKey = {
    child_schema: string;
    child_table: string;
    child_cols: string[];
    parent_cols: string[];
    /** `confdeltype`: a no action, r restrict, c cascade, n set null, d set default. */
    delete_type: string;
};

/** The foreign keys that point into a table, from the catalog. */
async function foreignKeysInto(
    tx: Tx,
    table: AgentSnapshotTable,
): Promise<ForeignKey[]> {
    return rows<ForeignKey>(
        tx,
        tx`
            select ns.nspname::text as child_schema,
                   cl.relname::text as child_table,
                   (select array_agg(a.attname::text order by k.ord)
                    from unnest(c.conkey) with ordinality as k(attnum, ord)
                    join pg_attribute a
                      on a.attrelid = c.conrelid and a.attnum = k.attnum) as child_cols,
                   (select array_agg(a.attname::text order by k.ord)
                    from unnest(c.confkey) with ordinality as k(attnum, ord)
                    join pg_attribute a
                      on a.attrelid = c.confrelid and a.attnum = k.attnum) as parent_cols,
                   c.confdeltype::text as delete_type
            from pg_constraint c
            join pg_class cl on cl.oid = c.conrelid
            join pg_namespace ns on ns.oid = cl.relnamespace
            where c.contype = 'f'
              and c.confrelid = ${tx.unsafe(`'${tableSql(table)}'::regclass`)}
            order by cl.relname, c.conname
        `,
    );
}

const AUDIT_LINK_TABLE = "stock_movements";

/** `c."a" = p."x" and c."b" = p."y"` over a foreign key's columns. */
function fkMatch(fk: ForeignKey, child: string, parent: string): string {
    return fk.child_cols
        .map(
            (column, i) =>
                `${child}.${quote(column)} = ${parent}.${quote(fk.parent_cols[i]!)}`,
        )
        .join(" and ");
}

function liveTx(tx: Tx): AgentActionsTx {
    return {
        readRows: (table, keys, opts) =>
            readKeyedRows(tx, table, keys, opts?.lock === true),
        async insertRow(table, row) {
            try {
                const columns = (await writableColumns(tx, table))
                    .map((column) => column.name)
                    .filter((column) => Object.hasOwn(row, column));
                await tx`
                    insert into ${tx.unsafe(tableSql(table))}
                        (${tx.unsafe(columns.map(quote).join(", "))})
                    select ${tx.unsafe(columns.map((c) => `r.${quote(c)}`).join(", "))}
                    from jsonb_populate_record(
                        null::${tx.unsafe(tableSql(table))},
                        ${JSON.stringify(row)}::jsonb
                    ) r
                `;
            } catch (err) {
                throw (
                    integrityConflict(err, table, row, "put") ??
                    pgError("put a row back", err)
                );
            }
        },
        async replaceColumns(table, key, patch: RestorePatch) {
            try {
                const keys = keyColumns(table);
                const writable = new Map(
                    (await writableColumns(tx, table)).map((column) => [
                        column.name,
                        column,
                    ]),
                );
                const whole = Object.entries(patch.set).filter(
                    ([column]) =>
                        writable.has(column) && !keys.includes(column),
                );
                const keyed = Object.entries(patch.json).filter(
                    ([column]) =>
                        writable.get(column)?.jsonb === true &&
                        !keys.includes(column),
                );
                if (whole.length === 0 && keyed.length === 0) {
                    return (await readKeyedRows(tx, table, [key])).length > 0;
                }
                // A jsonb column is patched key by key, in the database, so a
                // key somebody set since is not part of what is written.
                const sets = [
                    ...whole.map(([c]) => `${quote(c)} = r.${quote(c)}`),
                    ...keyed.map(
                        ([c], i) =>
                            `${quote(c)} = (coalesce(t.${quote(c)}, '{}'::jsonb) - ` +
                            `coalesce(array(select jsonb_array_elements_text(pp.p -> ${i} -> 'remove')), '{}'::text[])) ` +
                            `|| coalesce(pp.p -> ${i} -> 'set', '{}'::jsonb)`,
                    ),
                ].join(", ");
                const updated = await rows(
                    tx,
                    tx`
                        update ${tx.unsafe(tableSql(table))} as t
                        set ${tx.unsafe(sets)}
                        from jsonb_populate_record(
                            null::${tx.unsafe(tableSql(table))},
                            ${JSON.stringify({ ...key, ...Object.fromEntries(whole) })}::jsonb
                        ) as r,
                        (select ${JSON.stringify(keyed.map(([, change]) => change))}::jsonb as p) as pp
                        where ${tx.unsafe(keyMatch(table, "t", "r"))}
                        returning ${tx.unsafe(`t.${quote(keys[0]!)}`)}
                    `,
                );
                return updated.length > 0;
            } catch (err) {
                throw (
                    integrityConflict(err, table, key, "put") ??
                    pgError("restore a row", err)
                );
            }
        },
        async deleteRow(table, key) {
            try {
                await tx`
                    delete from ${tx.unsafe(tableSql(table))} as t
                    using jsonb_populate_record(
                        null::${tx.unsafe(tableSql(table))},
                        ${JSON.stringify(key)}::jsonb
                    ) as k
                    where ${tx.unsafe(keyMatch(table, "t", "k"))}
                `;
            } catch (err) {
                throw (
                    integrityConflict(err, table, key, "remove") ??
                    pgError("remove a row", err)
                );
            }
        },
        async referencingRows(table, key) {
            try {
                // Locked, so nothing can start pointing at it (a foreign key
                // insert needs a share lock on it) while it is counted.
                const [parent] = await readKeyedRows(tx, table, [key], true);
                if (!parent) return [];
                const counts = new Map<string, number>();
                for (const fk of await foreignKeysInto(tx, table)) {
                    // Whatever the key does on delete, a row that points here
                    // now was added or set by someone since. Only the ledger's
                    // audit links, which just clear themselves, are let go.
                    const clears =
                        fk.delete_type === "n" || fk.delete_type === "d";
                    if (
                        clears &&
                        fk.child_schema === "public" &&
                        fk.child_table === AUDIT_LINK_TABLE
                    ) {
                        continue;
                    }
                    const [found] = await rows<{ n: number }>(
                        tx,
                        tx`
                            select count(*)::int as n
                            from ${tx.unsafe(`${quote(fk.child_schema)}.${quote(fk.child_table)}`)} c
                            where (${tx.unsafe(fk.child_cols.map(quote).join(", "))}) = (
                                select ${tx.unsafe(fk.parent_cols.map((col) => `p.${quote(col)}`).join(", "))}
                                from jsonb_populate_record(
                                    null::${tx.unsafe(tableSql(table))},
                                    ${JSON.stringify(parent)}::jsonb
                                ) p
                            )
                        `,
                    );
                    if (found && found.n > 0) {
                        counts.set(
                            fk.child_table,
                            (counts.get(fk.child_table) ?? 0) + found.n,
                        );
                    }
                }
                return [...counts].map(
                    ([childTable, count]): AgentRowReference => ({
                        table: childTable,
                        count,
                    }),
                );
            } catch (err) {
                throw (
                    notAllowed(err, table, key) ??
                    pgError("find the rows that point at a row", err)
                );
            }
        },
        async cascadeRows(table, keys) {
            try {
                const parents = await readKeyedRows(tx, table, keys);
                const reached = new Map<string, AgentCascadeRow>();
                const uncaptured = new Set<string>();
                const idOf = (
                    name: AgentSnapshotTable,
                    row: AgentSnapshotRow,
                ) => `${name}:${agentKeyString(name, agentRowKey(name, row))}`;
                const roots = new Set(parents.map((row) => idOf(table, row)));
                let frontier: {
                    table: AgentSnapshotTable;
                    rows: AgentSnapshotRow[];
                }[] = [{ table, rows: parents }];
                while (frontier.length > 0) {
                    const next: typeof frontier = [];
                    for (const parent of frontier) {
                        if (parent.rows.length === 0) continue;
                        for (const fk of await foreignKeysInto(
                            tx,
                            parent.table,
                        )) {
                            // A delete the key refuses is the write's own error.
                            if (
                                fk.delete_type === "a" ||
                                fk.delete_type === "r"
                            ) {
                                continue;
                            }
                            const child = fk.child_table;
                            if (
                                fk.child_schema !== "public" ||
                                !isAgentSnapshotTable(child)
                            ) {
                                uncaptured.add(child);
                                continue;
                            }
                            const op =
                                fk.delete_type === "c" ? "deleted" : "updated";
                            const found = await rows<AgentSnapshotRow>(
                                tx,
                                tx`
                                    select c.*
                                    from ${tx.unsafe(tableSql(child))} c
                                    join jsonb_populate_recordset(
                                        null::${tx.unsafe(tableSql(parent.table))},
                                        ${JSON.stringify(parent.rows)}::jsonb
                                    ) p on ${tx.unsafe(fkMatch(fk, "c", "p"))}
                                `,
                            );
                            const cascading: AgentSnapshotRow[] = [];
                            for (const row of found) {
                                const id = idOf(child, row);
                                if (roots.has(id)) continue;
                                const known = reached.get(id);
                                // A row both cleared and deleted is deleted.
                                if (
                                    known &&
                                    (known.op === "deleted" || op === "updated")
                                ) {
                                    continue;
                                }
                                reached.set(id, { table: child, op, row });
                                if (op === "deleted") cascading.push(row);
                            }
                            if (cascading.length > 0) {
                                next.push({ table: child, rows: cascading });
                            }
                        }
                    }
                    frontier = next;
                }
                return {
                    rows: [...reached.values()],
                    uncaptured: [...uncaptured].sort(),
                };
            } catch (err) {
                throw pgError("find the rows a delete would take with it", err);
            }
        },
        async actAs({ householdId, memberId }) {
            try {
                // The same setting run() makes from an actor; the household
                // is already set for this transaction.
                const { jwtSub } = jwtSubAndHouseholdForActor(
                    memberId
                        ? { kind: "user", userId: memberId, householdId }
                        : { kind: "household", householdId },
                );
                await tx`select set_config('request.jwt.claim.sub', ${jwtSub}, true)`;
            } catch (err) {
                throw pgError("act as the member the agent acted as", err);
            }
        },
        async movementsWrittenHere(ids) {
            if (ids.length === 0) return new Set();
            try {
                // xmin is the transaction that wrote the row; a movement
                // another request committed meanwhile has its own.
                const found = await rows<{ id: string }>(
                    tx,
                    tx`
                        select id
                        from public.stock_movements
                        where id = any(${tx.array(ids, "uuid")})
                          and xmin::text = (pg_current_xact_id()::xid)::text
                    `,
                );
                return new Set(found.map((row) => row.id));
            } catch (err) {
                throw pgError("read the movements this action wrote", err);
            }
        },
        async insertAction(record) {
            try {
                await tx`
                    insert into ${tx.unsafe(AGENT_ACTIONS)} (
                        id, household_id, member_id, connection, tool, summary,
                        destructive, snapshot, undoable, created_at,
                        undo_expires_at, undone_at, undone_by
                    ) values (
                        ${record.id}, ${record.householdId}, ${record.memberId},
                        ${record.connection}, ${record.tool}, ${record.summary},
                        ${record.destructive},
                        ${record.snapshot ? JSON.stringify(record.snapshot) : null}::jsonb,
                        ${record.undoable}, ${record.createdAt}::timestamptz,
                        ${record.undoExpiresAt}::timestamptz,
                        ${record.undoneAt}::timestamptz, ${record.undoneBy}
                    )
                `;
            } catch (err) {
                throw pgError("record an agent action", err);
            }
        },
        async lockAction(householdId, actionId) {
            try {
                const row = await maybeOne<Record<string, unknown>>(
                    tx,
                    tx`
                        select ${tx.unsafe(ACTION_COLS)}
                        from ${tx.unsafe(AGENT_ACTIONS)}
                        where id = ${actionId}
                          and household_id = ${householdId}
                        for update
                    `,
                    "load an agent action",
                );
                return row ? agentActionFromRow(row as never) : null;
            } catch (err) {
                throw pgError("load an agent action", err);
            }
        },
        async markUndone(actionId, userId, at) {
            try {
                await tx`
                    update ${tx.unsafe(AGENT_ACTIONS)}
                    set undone_at = ${at.toISOString()}::timestamptz,
                        undone_by = ${userId}
                    where id = ${actionId}
                `;
            } catch (err) {
                throw pgError("mark an agent action undone", err);
            }
        },
        async isOwner(householdId, userId) {
            try {
                const found = await rows(
                    tx,
                    tx`
                        select user_id
                        from household_members
                        where household_id = ${householdId}
                          and user_id = ${userId}
                          and role = 'owner'
                    `,
                );
                return found.length > 0;
            } catch (err) {
                throw pgError("check the household owner", err);
            }
        },
    };
}

export function liveAgentActionsStore(): AgentActionsStore {
    return {
        async atomically(fn) {
            return run(async (tx) => fn(liveTx(tx)));
        },
        async list(householdId, limit) {
            return run(async (tx) => {
                try {
                    const data = await rows(
                        tx,
                        tx`
                            select ${tx.unsafe(ACTION_COLS)}
                            from ${tx.unsafe(AGENT_ACTIONS)}
                            where household_id = ${householdId}
                            order by created_at desc, id desc
                            limit ${Math.max(1, Math.floor(limit))}
                        `,
                    );
                    return data.map((row) => agentActionFromRow(row as never));
                } catch (err) {
                    throw pgError("list agent actions", err);
                }
            });
        },
        async purgeSnapshots(now) {
            return run(async (tx) => {
                try {
                    const purged = await rows(
                        tx,
                        tx`
                            update ${tx.unsafe(AGENT_ACTIONS)}
                            set snapshot = null
                            where snapshot is not null
                              and undo_expires_at < ${now.toISOString()}::timestamptz
                            returning id
                        `,
                    );
                    return purged.length;
                } catch (err) {
                    throw pgError("purge agent action snapshots", err);
                }
            });
        },
    };
}

/** Everything the guard and undo need, wired to Postgres. */
export function liveAgentActionDeps(): AgentActionDeps & AgentUndoDeps {
    return {
        store: liveAgentActionsStore(),
        settings: liveSettingsStore(),
        stock: liveStockStore(),
        foods: liveFoodsStore(),
    };
}
