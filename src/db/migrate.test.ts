import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { listMigrationFiles, migrate } from "./migrate.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin, startTempPostgres } from "./testing/pg-temp.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

describe("listMigrationFiles", () => {
    test("parses version and name", () => {
        const dir = mkdtempSync(join(tmpdir(), "foodable-mig-"));
        writeFileSync(join(dir, "20260101120000_first_step.sql"), "select 1;");
        const files = listMigrationFiles(dir);
        expect(files).toEqual([
            {
                version: "20260101120000",
                name: "first_step",
                path: join(dir, "20260101120000_first_step.sql"),
            },
        ]);
    });
});

const TX_FORMS = [
    "begin;",
    "BEGIN WORK;",
    "begin transaction;",
    "START TRANSACTION;",
    "START TRANSACTION READ ONLY;",
    "BEGIN ISOLATION LEVEL SERIALIZABLE;",
    "commit;",
    "COMMIT WORK;",
    "commit transaction;",
    "end;",
    "END WORK;",
    "end transaction;",
    "rollback;",
    "ROLLBACK WORK;",
    "rollback transaction;",
    "abort;",
];

describeDb(pgAvailable !== null, "migrate", (ctx) => {
    test("fresh database applies every migration file", async () => {
        const { sql } = ctx();
        const files = listMigrationFiles();
        const rows = (await sql`
            select version, name
            from supabase_migrations.schema_migrations
            order by version
        `) as { version: string; name: string }[];
        expect(rows.length).toBe(files.length);
        for (const file of files) {
            expect(rows.some((r) => r.version === file.version)).toBe(true);
        }
    });

    test("second migrate applies nothing", async () => {
        const { sql } = ctx();
        const second = await migrate(sql);
        expect(second.applied).toEqual([]);
    });

    test("bootstrap is idempotent after migrations", async () => {
        const { sql, pg } = ctx();
        const root = new URL("../..", import.meta.url).pathname;
        const bootstrapPath = join(root, "db/bootstrap.sql");

        const rolesBefore = await pg.scalar(`
            select string_agg(rolname, ',' order by rolname)
            from pg_roles
            where rolname in ('anon', 'authenticated', 'service_role')
        `);
        const uidBefore = await pg.scalar(
            `select pg_get_functiondef('auth.uid()'::regprocedure)`,
        );

        await sql.unsafe(await Bun.file(bootstrapPath).text()).simple();

        const rolesAfter = await pg.scalar(`
            select string_agg(rolname, ',' order by rolname)
            from pg_roles
            where rolname in ('anon', 'authenticated', 'service_role')
        `);
        const uidAfter = await pg.scalar(
            `select pg_get_functiondef('auth.uid()'::regprocedure)`,
        );

        expect(rolesAfter).toBe(rolesBefore);
        expect(uidAfter).toBe(uidBefore);
    });

    test("failing migration leaves earlier files recorded and rolls back", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-fail-"));
            writeFileSync(join(dir, "20260101120000_ok.sql"), "select 1;");
            writeFileSync(
                join(dir, "20260101130000_bad.sql"),
                `create table public.should_roll_back (id int);
select * from table_does_not_exist;`,
            );

            await expect(migrate(sql, { dir, log: () => {} })).rejects.toThrow(
                "20260101130000_bad",
            );

            const recorded = (await sql`
                select version from supabase_migrations.schema_migrations
            `) as { version: string }[];
            expect(recorded.map((r) => r.version)).toEqual(["20260101120000"]);

            const rolledBack = await pg.scalar(
                `select to_regclass('public.should_roll_back') is null`,
            );
            expect(rolledBack).toBe("t");
        } finally {
            await sql.close();
            await pg.stop();
        }
    });

    test("recorded version with no file throws", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            await migrate(sql);

            await sql`
                insert into supabase_migrations.schema_migrations (
                    version,
                    name,
                    statements
                )
                values (
                    '20990101120000',
                    'ghost',
                    array['select 1']
                )
            `;

            await expect(migrate(sql)).rejects.toThrow("history diverged");
        } finally {
            await sql.close();
            await pg.stop();
        }
    });

    test("dryRun makes no changes on an empty database", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const result = await migrate(sql, { dryRun: true });
            expect(result.pending.length).toBeGreaterThan(0);

            const migrationsSchema = await pg.scalar(`
                select count(*)::text
                from information_schema.schemata
                where schema_name = 'supabase_migrations'
            `);
            expect(migrationsSchema).toBe("0");

            const authSchema = await pg.scalar(`
                select count(*)::text
                from information_schema.schemata
                where schema_name = 'auth'
            `);
            expect(authSchema).toBe("0");
        } finally {
            await sql.close();
            await pg.stop();
        }
    });

    test.each(TX_FORMS)(
        "rejects nested transaction form %s before applying",
        async (stmt) => {
            const pg = await startTempPostgres();
            const sql = new SQL(pg.url, { prepare: false, max: 1 });
            try {
                const dir = mkdtempSync(join(tmpdir(), "foodable-mig-tx-"));
                writeFileSync(
                    join(dir, "20260101120000_nested.sql"),
                    `${stmt}
create table public.work_row(id int);
select * from missing_relation;`,
                );

                await expect(
                    migrate(sql, { dir, log: () => {} }),
                ).rejects.toThrow("nested transactions");

                const recorded = (await sql`
                    select version from supabase_migrations.schema_migrations
                `) as { version: string }[];
                expect(recorded).toEqual([]);

                const leaked = await pg.scalar(
                    `select to_regclass('public.work_row') is null`,
                );
                expect(leaked).toBe("t");
            } finally {
                await sql.close();
                await pg.stop();
            }
        },
    );

    test("allows begin/end inside dollar-quoted function bodies", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-fn-"));
            writeFileSync(
                join(dir, "20260101120000_fn.sql"),
                `create or replace function public.tx_guard_probe()
returns int
language plpgsql
as $$
begin
  return 1;
end;
$$;`,
            );

            await migrate(sql, { dir, log: () => {} });

            const recorded = (await sql`
                select version from supabase_migrations.schema_migrations
            `) as { version: string }[];
            expect(recorded.map((r) => r.version)).toEqual(["20260101120000"]);

            const exists = await pg.scalar(
                `select to_regprocedure('public.tx_guard_probe()') is not null`,
            );
            expect(exists).toBe("t");
        } finally {
            await sql.close();
            await pg.stop();
        }
    });
});
