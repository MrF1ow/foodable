/**
 * PostgREST-shaped reads: every row set is wrapped with
 * `with w as (<query>) select coalesce(json_agg(w), '[]'::json) as rows from w`.
 * Bun.sql fragments nest in the `w as (...)` slot; a plain `from (<select>) r` subquery
 * fails for data-modifying `returning` statements, so the CTE form is used for all reads.
 */
import { SQL, type TransactionSQL } from "bun";
import { AsyncLocalStorage } from "node:async_hooks";

export type Tx = TransactionSQL;

let cached: SQL | undefined;
let testSql: SQL | undefined;

// `open` flips to false before the transaction commits. Async work started
// inside a run callback inherits this store and can outlive the transaction
// (a fire-and-forget write); it must then open its own transaction instead of
// reusing a connection Bun has already released.
const activeTx = new AsyncLocalStorage<{ tx: Tx; open: boolean }>();

export function getSql(): SQL {
    if (testSql) return testSql;
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Missing DATABASE_URL");
    if (!cached) {
        cached = new SQL(url, {
            prepare: false,
            max: 10,
            idleTimeout: 30,
            connectionTimeout: 15,
        });
    }
    return cached;
}

export function setSqlForTests(sql: SQL | null): void {
    testSql = sql ?? undefined;
}

export async function closeSql(): Promise<void> {
    if (cached) {
        await cached.close();
        cached = undefined;
    }
}

export async function run<T>(
    fn: (tx: Tx) => Promise<T>,
    opts?: { timeoutMs?: number },
): Promise<T> {
    const outer = activeTx.getStore();
    // Phase 2 multi-step writes call run from inside run; reusing the outer tx
    // keeps one atomic unit and avoids opening another pool connection.
    if (outer?.open) return fn(outer.tx);

    const sql = getSql();
    return sql.begin(async (tx) => {
        const store = { tx, open: true };
        return activeTx.run(store, async () => {
            try {
                await tx`
                select set_config('statement_timeout', ${String(opts?.timeoutMs ?? 15_000)}, true),
                       set_config('TimeZone', 'UTC', true)
            `;
                // TimeZone UTC: timestamptz inside json_agg must match PostgREST (+00:00).
                return await fn(tx);
            } finally {
                store.open = false;
            }
        });
    });
}

function parseRowsPayload(rows: unknown): unknown[] {
    if (rows == null) return [];
    if (Array.isArray(rows)) return rows;
    if (typeof rows === "string") return JSON.parse(rows) as unknown[];
    return [];
}

export async function rows<T = Record<string, unknown>>(
    tx: Tx,
    query: SQL.Query<unknown>,
): Promise<T[]> {
    const [row] = await tx`
        with w as (${query})
        select coalesce(json_agg(w), '[]'::json) as rows
        from w
    `;
    return parseRowsPayload(row.rows) as T[];
}

export async function one<T = Record<string, unknown>>(
    tx: Tx,
    query: SQL.Query<unknown>,
    what: string,
): Promise<T> {
    const got = await rows<T>(tx, query);
    if (got.length !== 1) {
        throw new Error(`${what}: expected 1 row, got ${got.length}`);
    }
    return got[0]!;
}

export async function maybeOne<T = Record<string, unknown>>(
    tx: Tx,
    query: SQL.Query<unknown>,
    what: string,
): Promise<T | null> {
    const got = await rows<T>(tx, query);
    if (got.length === 0) return null;
    if (got.length !== 1) {
        throw new Error(`${what}: expected 1 row, got ${got.length}`);
    }
    return got[0]!;
}

export function pgError(context: string, err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err);
    return new Error(`Failed to ${context}: ${message}`, { cause: err });
}

/** Postgres SQLSTATE from Bun.sql (e.g. `"23505"`), not `err.code`. */
export function pgCode(err: unknown): string | undefined {
    if (err && typeof err === "object" && "errno" in err) {
        const errno = (err as { errno: unknown }).errno;
        if (typeof errno === "string") return errno;
    }
    return undefined;
}

/** PostgREST / supabase-js omit `undefined` keys on insert and update. */
export function definedColumns(obj: Record<string, unknown>): {
    row: Record<string, unknown>;
    keys: string[];
} {
    const keys: string[] = [];
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (val !== undefined) {
            keys.push(key);
            row[key] = val;
        }
    }
    return { row, keys };
}

function asColumnTuple(keys: string[]): [string, ...string[]] {
    if (keys.length === 0) {
        throw new Error("definedColumns: no columns to write");
    }
    return keys as [string, ...string[]];
}

export async function insertReturning<T>(
    tx: Tx,
    table: string,
    payload: Record<string, unknown>,
    returningCols: string,
    what: string,
): Promise<T> {
    const { row, keys } = definedColumns(payload);
    try {
        return await one<T>(
            tx,
            tx`
                insert into ${tx.unsafe(table)} ${tx(row, ...asColumnTuple(keys))}
                returning ${tx.unsafe(returningCols)}
            `,
            what,
        );
    } catch (err) {
        throw pgError(what, err);
    }
}
