/**
 * PostgREST-shaped reads: every row set is wrapped with
 * `with w as (<query>) select coalesce(json_agg(w), '[]'::json) as rows from w`.
 * Bun.sql fragments nest in the `w as (...)` slot; a plain `from (<select>) r` subquery
 * fails for data-modifying `returning` statements, so the CTE form is used for all reads.
 */
import { SQL, type TransactionSQL } from "bun";
import { AsyncLocalStorage } from "node:async_hooks";
import {
    actorForRun,
    currentActor,
    jwtSubAndHouseholdForActor,
    type Actor,
} from "./actor.js";

export type Tx = TransactionSQL;

/*
 * Two pools. Requests run as their user or household on the app pool, which
 * connects as foodable_app (DATABASE_APP_URL), so row level security draws the
 * household boundary. Work whose actor is the system (sign-in, OAuth, sweeps,
 * rate limits) runs on the owner pool (DATABASE_URL), which owns the tables
 * and so is not bound by those policies. With DATABASE_APP_URL unset both are
 * the same owner pool: nothing changes until an operator sets it, and
 * unsetting it is the rollback. Migrations never use these pools; they always
 * connect with DATABASE_URL.
 */

// Per instance by design: one Bun.sql pool per role per process; all instances share data through Postgres.
let cachedOwner: SQL | undefined;
// Per instance by design: see cachedOwner. Same object as cachedOwner when DATABASE_APP_URL is unset.
let cachedApp: SQL | undefined;
// Per instance by design: test harness overrides of both pools; never set in production.
let testPools: Pools | undefined;
// Per instance by design: the database test harness pairs its owner connection with a foodable_app one.
const testAppPeers = new WeakMap<SQL, SQL>();
// Per instance by design: the boot log line about which URL the app pool uses, printed once.
let loggedPoolChoice = false;

type Pools = { app: SQL; owner: SQL };

type ActiveTx = {
    tx: Tx;
    open: boolean;
    sql: SQL;
    // The pair the transaction was opened from: a nested run picks its pool
    // from the same pair, even if a test has swapped the pools since.
    pools: Pools;
    actor: Actor;
};

// `open` flips to false before the transaction commits. Async work started
// inside a run callback inherits this store and can outlive the transaction
// (a fire-and-forget write); it must then open its own transaction instead of
// reusing a connection Bun has already released.
// Per instance by design: request-scoped transaction nesting for this process only.
const activeTx = new AsyncLocalStorage<ActiveTx>();

export const APP_RUN_IN_SYSTEM_TX_MESSAGE =
    "run() for a user or household inside a system transaction: the system " +
    "transaction runs on the owner connection, and a separate app transaction " +
    "would neither see its uncommitted rows nor roll back with it. Finish the " +
    "system transaction first, or do the work as the system.";

/** Fail fast at server boot when DATABASE_URL is unset (not at import time). */
export function requireDatabaseUrl(): void {
    const url = process.env.DATABASE_URL;
    if (!url?.trim()) throw new Error("Missing DATABASE_URL");
    logPoolChoiceOnce();
}

function appUrl(): string | undefined {
    const url = process.env.DATABASE_APP_URL?.trim();
    return url ? url : undefined;
}

// Names the variable, never the URL: it carries the password.
function logPoolChoiceOnce(): void {
    if (loggedPoolChoice || testPools) return;
    loggedPoolChoice = true;
    if (appUrl()) {
        console.log(
            "[db] app connections use DATABASE_APP_URL; system work and migrations use DATABASE_URL",
        );
    } else {
        console.log(
            "[db] DATABASE_APP_URL is unset: app connections use DATABASE_URL, so row level security is not enforced",
        );
    }
}

function newPool(url: string): SQL {
    return new SQL(url, {
        prepare: false,
        max: 10,
        idleTimeout: 30,
        connectionTimeout: 15,
    });
}

/** The owner pool (DATABASE_URL): system work. */
export function getSql(): SQL {
    if (testPools) return testPools.owner;
    requireDatabaseUrl();
    cachedOwner ??= newPool(process.env.DATABASE_URL!);
    return cachedOwner;
}

/** The app pool (DATABASE_APP_URL, else DATABASE_URL): user and household work. */
export function getAppSql(): SQL {
    if (testPools) return testPools.app;
    const owner = getSql();
    if (!cachedApp) {
        const url = appUrl();
        cachedApp = url ? newPool(url) : owner;
    }
    return cachedApp;
}

function currentPools(): Pools {
    if (testPools) return testPools;
    return { owner: getSql(), app: getAppSql() };
}

/**
 * Test only: point both pools at `sql`, or clear them with null. When the
 * database test harness paired `sql` (its owner connection) with a
 * foodable_app connection, the app pool uses that one instead, so adapter
 * tests run under row level security exactly like the server with
 * DATABASE_APP_URL set.
 */
export function setSqlForTests(sql: SQL | null): void {
    testPools = sql
        ? { owner: sql, app: testAppPeers.get(sql) ?? sql }
        : undefined;
}

/** Test harness only: run() as a user or household on `owner` uses `app`. */
export function pairAppSqlForTests(owner: SQL, app: SQL): void {
    testAppPeers.set(owner, app);
}

export async function closeSql(): Promise<void> {
    const app = cachedApp;
    const owner = cachedOwner;
    cachedApp = undefined;
    cachedOwner = undefined;
    if (app && app !== owner) await app.close();
    if (owner) await owner.close();
}

/**
 * One transaction with the actor's settings applied (request.jwt.claim.sub and
 * app.household_id), on the owner pool for the system and on the app pool for
 * everyone else.
 *
 * Nested calls reuse the outer transaction when it is on the same pool, which
 * keeps multi-step writes atomic. A system run inside a user or household
 * transaction gets its own owner transaction: it commits on its own and does
 * not see the outer transaction's uncommitted writes, and it must not touch
 * rows the outer one has locked, or it waits on itself until the statement
 * timeout. A user or household run inside a system transaction throws
 * (APP_RUN_IN_SYSTEM_TX_MESSAGE). With DATABASE_APP_URL unset the pools are
 * one, so every nested call reuses the outer transaction, as before.
 */
export async function run<T>(
    fn: (tx: Tx) => Promise<T>,
    opts?: { timeoutMs?: number },
): Promise<T> {
    const outer = activeTx.getStore();
    const open = outer?.open ? outer : undefined;
    // Pools are read before the first await: a test that swaps them with
    // setSqlForTests right after calling run() still gets the ones it set.
    const pools = open?.pools ?? currentPools();
    // Inside a transaction an inner run with no actor of its own is part of
    // the outer work; only a top-level run consults the test fallback.
    const actor = open ? (currentActor() ?? open.actor) : await actorForRun();
    const sql = actor.kind === "system" ? pools.owner : pools.app;
    if (open) {
        if (open.sql === sql) return fn(open.tx);
        if (actor.kind !== "system") {
            throw new Error(APP_RUN_IN_SYSTEM_TX_MESSAGE);
        }
    }

    const { jwtSub, householdId } = jwtSubAndHouseholdForActor(actor);
    return sql.begin(async (tx) => {
        const store: ActiveTx = { tx, open: true, sql, pools, actor };
        return activeTx.run(store, async () => {
            try {
                await tx`
                select set_config('statement_timeout', ${String(opts?.timeoutMs ?? 15_000)}, true),
                       set_config('TimeZone', 'UTC', true),
                       set_config('request.jwt.claim.sub', ${jwtSub}, true),
                       set_config('app.household_id', ${householdId}, true)
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

/** PostgREST omitted `undefined` keys on insert and update; keep that shape. */
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
