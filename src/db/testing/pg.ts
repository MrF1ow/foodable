import { SQL } from "bun";
import { describe, afterAll, beforeAll, beforeEach } from "bun:test";
import { setFallbackActorForTests, type Actor } from "../actor.js";
import { migrate } from "../migrate.js";
import { pairAppSqlForTests } from "../sql.js";
import {
    createTestDatabase,
    ensureTemplate,
    type TempPostgres,
} from "./pg-temp.js";

type DbCtx = {
    /** The owner (superuser) connection: seeding, assertions, system work. */
    sql: SQL;
    /** A foodable_app connection, bound by row level security. */
    appSql: SQL;
    /** Its own connection for working out the default actor, so that lookup never waits on a transaction the test holds open. */
    actorSql: SQL;
    pg: TempPostgres;
    truncateAll(): Promise<void>;
};

// Long enough for the first caller in a process, which starts the shared
// server and migrates the template, on a busy machine.
export const DB_SETUP_TIMEOUT_MS = 120_000;

const MIGRATED_TEMPLATE = "foodable_migrated";

let shared: DbCtx | undefined;

/** Build the migrated template on the shared server (once per process). */
export function prepareMigratedTemplate(): Promise<void> {
    return ensureTemplate(MIGRATED_TEMPLATE, async (url) => {
        const sql = new SQL(url, { prepare: false, max: 1 });
        try {
            await migrate(sql);
        } finally {
            await sql.close();
        }
    });
}

/** A fully migrated database of its own, copied from the template. */
export async function createMigratedDatabase(): Promise<TempPostgres> {
    await prepareMigratedTemplate();
    return createTestDatabase({ template: MIGRATED_TEMPLATE });
}

export async function setupTestDatabase(): Promise<DbCtx> {
    const pg = await createMigratedDatabase();
    const sql = new SQL(pg.url, { prepare: false, max: 1 });
    // The test server trusts local connections, so foodable_app (created by
    // the migrations in the template; roles are cluster-wide) needs no
    // password here.
    const appUrl = new URL(pg.url);
    appUrl.username = "foodable_app";
    const appSql = new SQL(appUrl.toString(), { prepare: false, max: 1 });
    const actorSql = new SQL(pg.url, { prepare: false, max: 1 });
    try {
        // setSqlForTests(sql) now points the app pool at foodable_app.
        pairAppSqlForTests(sql, appSql);

        async function truncateAll(): Promise<void> {
            const rows = (await sql`
                select tablename
                from pg_tables
                where schemaname = 'public'
            `) as { tablename: string }[];
            if (rows.length === 0) return;
            const names = rows
                .map((r) => `"public"."${r.tablename}"`)
                .join(", ");
            await sql
                .unsafe(`truncate ${names} restart identity cascade`)
                .simple();
        }

        return { sql, appSql, actorSql, pg, truncateAll };
    } catch (err) {
        await actorSql.close();
        await appSql.close();
        await sql.close();
        await pg.stop();
        throw err;
    }
}

/** For a describe whose code runs as the system, sign-in, OAuth and the like. */
export const DB_SYSTEM_ACTOR: Actor = {
    kind: "system",
    reason: "database test",
};

/**
 * The default fallback actor: the owner of the deploy's household, acting in
 * it, worked out from the database at each top-level run(). Adapter tests call
 * the db helpers directly, the way a request handler would inside its actor,
 * so they run as foodable_app under row level security: a query that leaves
 * out its household, or a policy that goes missing, fails the test. A deploy
 * holds one household, so there is no choice to make. Before any household is
 * seeded there is nothing household-scoped to protect, and the run falls back
 * to the system.
 */
export async function householdOwnerActor(): Promise<Actor> {
    if (!shared) return DB_SYSTEM_ACTOR;
    const [row] = (await shared.actorSql`
        select h.id as household_id, m.user_id
        from public.households h
        left join public.household_members m
          on m.household_id = h.id and m.role = 'owner'
        limit 1
    `) as { household_id: string; user_id: string | null }[];
    if (!row) {
        return { kind: "system", reason: "database test with no household" };
    }
    if (!row.user_id) {
        return { kind: "household", householdId: row.household_id };
    }
    return {
        kind: "user",
        userId: row.user_id,
        householdId: row.household_id,
    };
}

export type DescribeDbOptions = {
    /**
     * The actor a run() falls back to when the test sets none. By default the
     * household's owner (see householdOwnerActor). Pass DB_SYSTEM_ACTOR for a
     * describe about work the system does, and null for tests that drive an
     * entry point (a route, a scheduler): with no fallback, a code path that
     * forgot its own actor throws instead of passing.
     */
    actor?: Actor | null;
};

export function describeDb(
    enabled: boolean,
    name: string,
    fn: (ctx: () => DbCtx) => void,
    opts: DescribeDbOptions = {},
): void {
    const fallback =
        opts.actor === undefined ? householdOwnerActor : opts.actor;
    (enabled ? describe : describe.skip)(name, () => {
        // Set before the file's own beforeAll seeding and again before each
        // test, so a describe that opts out never inherits a fallback left by
        // another file (bun runs every file in one process).
        beforeAll(async () => {
            shared = await setupTestDatabase();
            setFallbackActorForTests(fallback);
        }, DB_SETUP_TIMEOUT_MS);

        beforeEach(() => {
            setFallbackActorForTests(fallback);
        });

        afterAll(async () => {
            setFallbackActorForTests(null);
            if (!shared) return;
            await shared.actorSql.close();
            await shared.appSql.close();
            await shared.sql.close();
            await shared.pg.stop();
            shared = undefined;
        });

        fn(() => {
            if (!shared) {
                throw new Error("database not initialized");
            }
            return shared;
        });
    });
}
