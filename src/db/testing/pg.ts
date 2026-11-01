import { SQL } from "bun";
import { describe, afterAll, beforeAll } from "bun:test";
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

export function describeDb(
    enabled: boolean,
    name: string,
    fn: (ctx: () => DbCtx) => void,
): void {
    (enabled ? describe : describe.skip)(name, () => {
        beforeAll(async () => {
            shared = await setupTestDatabase();
        });

        afterAll(async () => {
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
