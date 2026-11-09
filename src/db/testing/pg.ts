import { SQL } from "bun";
import { describe, afterAll, beforeAll, beforeEach } from "bun:test";
import { setFallbackActorForTests, type Actor } from "../actor.js";
import { migrate } from "../migrate.js";
import { startTempPostgres, type TempPostgres } from "./pg-temp.js";

type DbCtx = {
    sql: SQL;
    pg: TempPostgres;
    truncateAll(): Promise<void>;
};

let shared: DbCtx | undefined;

export async function setupTestDatabase(): Promise<DbCtx> {
    const pg = await startTempPostgres();
    const sql = new SQL(pg.url, { prepare: false, max: 1 });
    try {
        await migrate(sql);

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

        return { sql, pg, truncateAll };
    } catch (err) {
        await sql.close();
        await pg.stop();
        throw err;
    }
}

/** The actor adapter tests run as when they set none themselves. */
export const DB_TEST_ACTOR: Actor = { kind: "system", reason: "database test" };

export type DescribeDbOptions = {
    /**
     * The actor a run() falls back to when the test sets none. Adapter tests
     * call the db helpers directly, the way a request handler would inside its
     * actor, so they default to a system actor; a test about who is acting
     * wraps its calls in withActor. Pass null for tests that drive an entry
     * point (a route, a scheduler): with no fallback, a code path that forgot
     * its own actor throws instead of passing.
     */
    actor?: Actor | null;
};

export function describeDb(
    enabled: boolean,
    name: string,
    fn: (ctx: () => DbCtx) => void,
    opts: DescribeDbOptions = {},
): void {
    const fallback = opts.actor === undefined ? DB_TEST_ACTOR : opts.actor;
    (enabled ? describe : describe.skip)(name, () => {
        // Set before the file's own beforeAll seeding and again before each
        // test, so a describe that opts out never inherits a fallback left by
        // another file (bun runs every file in one process).
        beforeAll(async () => {
            shared = await setupTestDatabase();
            setFallbackActorForTests(fallback);
        });

        beforeEach(() => {
            setFallbackActorForTests(fallback);
        });

        afterAll(async () => {
            setFallbackActorForTests(null);
            if (!shared) return;
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
