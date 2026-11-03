import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import {
    findTransactionControlStatement,
    listMigrationFiles,
    migrate,
    splitSqlStatements,
} from "./migrate.js";
import { describeDb } from "./testing/pg.js";
import { findPgBin, startTempPostgres } from "./testing/pg-temp.js";
import { rows, run, setSqlForTests } from "./sql.js";

const pgAvailable = await findPgBin();
if (!pgAvailable) {
    if (process.env.CI) {
        throw new Error(
            "database tests require initdb (install postgresql and set PG_BIN)",
        );
    }
    console.warn("database tests skipped: no initdb (set PG_BIN)");
}

describe("splitSqlStatements", () => {
    test("splits on top-level semicolons only", () => {
        expect(
            splitSqlStatements(`select 'a;b'; select "x;y" from t; select 1`),
        ).toEqual([`select 'a;b'`, `select "x;y" from t`, "select 1"]);
    });

    test("keeps dollar-quoted bodies whole, including custom tags", () => {
        const fn = `create function f() returns int language plpgsql as $fn$
begin
  commit;
  return 1;
end;
$fn$`;
        expect(splitSqlStatements(`${fn}; select 2;`)).toEqual([
            fn,
            "select 2",
        ]);
    });

    test("drops comments, including nested block comments", () => {
        expect(
            splitSqlStatements(`-- commit;
/* outer /* inner */ commit; */ select 1;`),
        ).toEqual(["select 1"]);
    });

    test("handles doubled quotes and E-string escapes", () => {
        expect(
            splitSqlStatements(`select 'it''s;'; select E'a\\';b'; select 3`),
        ).toEqual([`select 'it''s;'`, `select E'a\\';b'`, "select 3"]);
    });

    test("does not treat positional parameters as dollar quotes", () => {
        expect(splitSqlStatements("select $1; select 2")).toEqual([
            "select $1",
            "select 2",
        ]);
    });
});

describe("findTransactionControlStatement", () => {
    test.each([
        "create table t(id int); commit;",
        "create table t(id int);\ncommit\n;",
        "commit and chain;",
        "end and no chain;",
        "rollback to savepoint s;",
        "prepare transaction 'x';",
        "select '/*'; commit; select '*/';",
        "select '$fn$'; commit; select '$fn$';",
        "BEGIN ISOLATION LEVEL READ COMMITTED, READ ONLY;",
        "  Start Transaction;",
        "abort",
    ])("finds the control statement in %p", (sqlText) => {
        expect(findTransactionControlStatement(sqlText)).not.toBeNull();
    });

    test.each([
        "select 'commit;';",
        "-- commit;\nselect 1;",
        "/* /* nested */ commit; */ select 1;",
        `do $$ begin perform 1; end $$;`,
        "create table public.ending(id int);",
        "alter table t add column begin_at timestamptz;",
    ])("accepts %p", (sqlText) => {
        expect(findTransactionControlStatement(sqlText)).toBeNull();
    });

    test("no current migration contains one", async () => {
        for (const file of listMigrationFiles()) {
            const text = await Bun.file(file.path).text();
            expect([file.name, findTransactionControlStatement(text)]).toEqual([
                file.name,
                null,
            ]);
        }
    });
});

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
            from foodable_migrations.schema_migrations
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
                select version from foodable_migrations.schema_migrations
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
                insert into foodable_migrations.schema_migrations (
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
                where schema_name = 'foodable_migrations'
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

    test("a legacy supabase_migrations history is renamed, not replayed", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-legacy-"));
            writeFileSync(
                join(dir, "20260101120000_first.sql"),
                "create table public.legacy_first(id int);",
            );
            writeFileSync(
                join(dir, "20260101130000_second.sql"),
                "create table public.legacy_second(id int);",
            );
            // A database the Supabase CLI migrated: the first file already
            // ran and is recorded under the old schema name.
            await sql`
                create schema supabase_migrations;
                create table supabase_migrations.schema_migrations (
                    version text primary key,
                    statements text[],
                    name text
                );
                insert into supabase_migrations.schema_migrations (version, name)
                values ('20260101120000', 'first');
                create table public.legacy_first(id int);
            `.simple();

            const dry = await migrate(sql, { dir, dryRun: true });
            expect(dry.applied).toEqual(["20260101120000_first"]);
            expect(dry.pending).toEqual(["20260101130000_second"]);
            expect(
                await pg.scalar(
                    `select to_regnamespace('supabase_migrations') is not null
                        and to_regnamespace('foodable_migrations') is null`,
                ),
            ).toBe("t");

            const lines: string[] = [];
            const result = await migrate(sql, {
                dir,
                log: (line) => lines.push(line),
            });
            expect(result.applied).toEqual(["20260101130000_second"]);
            expect(lines).toContain(
                "ok renamed supabase_migrations to foodable_migrations",
            );

            const recorded = (await sql`
                select version from foodable_migrations.schema_migrations
                order by version
            `) as { version: string }[];
            expect(recorded.map((r) => r.version)).toEqual([
                "20260101120000",
                "20260101130000",
            ]);
            expect(
                await pg.scalar(
                    `select to_regnamespace('supabase_migrations') is null`,
                ),
            ).toBe("t");

            const again = await migrate(sql, { dir, log: () => {} });
            expect(again.applied).toEqual([]);
        } finally {
            await sql.close();
            await pg.stop();
        }
    });

    test("refuses to migrate when both history schemas exist", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            await sql`
                create schema supabase_migrations;
                create schema foodable_migrations;
            `.simple();
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-both-"));
            writeFileSync(join(dir, "20260101120000_ok.sql"), "select 1;");
            await expect(migrate(sql, { dir, log: () => {} })).rejects.toThrow(
                "Both supabase_migrations and foodable_migrations exist",
            );
        } finally {
            await sql.close();
            await pg.stop();
        }
    });

    test.each(TX_FORMS)("guard finds nested transaction form %s", (stmt) => {
        expect(
            findTransactionControlStatement(`${stmt}
create table public.work_row(id int);`),
        ).not.toBeNull();
    });

    test("a nested transaction is rejected before anything runs", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-tx-"));
            writeFileSync(
                join(dir, "20260101120000_nested.sql"),
                `begin work;
create table public.work_row(id int);
commit work;
select * from missing_relation;`,
            );

            await expect(migrate(sql, { dir, log: () => {} })).rejects.toThrow(
                "nested transactions",
            );

            const untouched = await pg.scalar(
                `select to_regclass('public.work_row') is null
                    and to_regclass('foodable_migrations.schema_migrations') is null
                    and to_regnamespace('auth') is null`,
            );
            expect(untouched).toBe("t");
        } finally {
            await sql.close();
            await pg.stop();
        }
    });

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
                select version from foodable_migrations.schema_migrations
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
    test("migrate does not leak session state to the caller connection", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            await migrate(sql);
            setSqlForTests(sql);

            const settings = await run(async (tx) => {
                const [row] = await rows<{
                    search_path: string;
                    row_security: string;
                    statement_timeout: string;
                }>(
                    tx,
                    tx`
                        select current_setting('search_path') as search_path,
                               current_setting('row_security') as row_security,
                               current_setting('statement_timeout') as statement_timeout
                    `,
                );
                return {
                    searchPath: row!.search_path,
                    rowSecurity: row!.row_security,
                    timeout: row!.statement_timeout,
                };
            });

            expect(settings.searchPath).toBe('"$user", public');
            expect(settings.rowSecurity).toBe("on");
            expect(settings.timeout).not.toBe("0");
        } finally {
            setSqlForTests(null);
            await sql.close();
            await pg.stop();
        }
    });

    test("a failing migration still leaves the caller connection clean", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-leak-"));
            // Session-level settings, like the pg_dump preamble: they survive
            // the file's commit, so only discard-on-failure clears them.
            writeFileSync(
                join(dir, "20260101120000_ok.sql"),
                "select set_config('search_path', '', false); set row_security = off;",
            );
            writeFileSync(
                join(dir, "20260101130000_bad.sql"),
                `create table public.leak_probe (id int);
select * from table_does_not_exist;`,
            );

            await expect(migrate(sql, { dir, log: () => {} })).rejects.toThrow(
                "20260101130000_bad",
            );

            setSqlForTests(sql);
            const [searchPath] = await run(async (tx) =>
                rows<{ search_path: string }>(
                    tx,
                    tx`select current_setting('search_path') as search_path`,
                ),
            );
            expect(searchPath!.search_path).toBe('"$user", public');
            const [rls] =
                await sql`select current_setting('row_security') as v`;
            expect(rls.v).toBe("on");
        } finally {
            setSqlForTests(null);
            await sql.close();
            await pg.stop();
        }
    });

    test("rejects a bad pending file before applying any earlier one", async () => {
        const pg = await startTempPostgres();
        const sql = new SQL(pg.url, { prepare: false, max: 1 });
        try {
            const dir = mkdtempSync(join(tmpdir(), "foodable-mig-upfront-"));
            writeFileSync(
                join(dir, "20260101120000_good.sql"),
                "create table public.good_first(id int);",
            );
            writeFileSync(
                join(dir, "20260101120100_bad.sql"),
                "create table public.bad_second(id int); commit;",
            );

            await expect(migrate(sql, { dir, log: () => {} })).rejects.toThrow(
                "nested transactions",
            );

            const created = await pg.scalar(
                `select to_regclass('public.good_first') is null`,
            );
            expect(created).toBe("t");
        } finally {
            await sql.close();
            await pg.stop();
        }
    });
});
