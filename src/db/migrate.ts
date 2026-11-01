import { SQL } from "bun";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

export type MigrationFile = { version: string; name: string; path: string };

/** Matches a full-line SQL transaction control statement (after comment/dollar-quote strip). */
const TX_CONTROL_LINE =
    /^\s*(?:(?:begin(?:\s+(?:work|transaction))?|start\s+transaction)(?:\s+(?:isolation\s+level\s+\S+(?:\s+\S+)?|read\s+(?:only|write)|(?:not\s+)?deferrable|[\w,]+))*\s*;|(?:commit|end|rollback)(?:\s+(?:work|transaction))?\s*;|abort\s*;)\s*$/i;

function stripDollarQuotedBodies(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        if (sql[i] === "$") {
            const head = sql.slice(i).match(/^\$([A-Za-z0-9_]*)\$/);
            if (head) {
                const tag = head[1];
                const open = head[0];
                const bodyStart = i + open.length;
                const close = `$${tag}$`;
                const closeAt = sql.indexOf(close, bodyStart);
                if (closeAt === -1) {
                    out += sql[i];
                    i++;
                    continue;
                }
                const body = sql.slice(bodyStart, closeAt);
                out +=
                    " ".repeat(open.length) +
                    body.replace(/[^\n]/g, " ") +
                    " ".repeat(close.length);
                i = closeAt + close.length;
                continue;
            }
        }
        out += sql[i];
        i++;
    }
    return out;
}

function stripSqlComments(sql: string): string {
    let out = "";
    let i = 0;
    while (i < sql.length) {
        if (sql[i] === "-" && sql[i + 1] === "-") {
            while (i < sql.length && sql[i] !== "\n") i++;
            continue;
        }
        if (sql[i] === "/" && sql[i + 1] === "*") {
            i += 2;
            while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
                i++;
            }
            i += 2;
            continue;
        }
        out += sql[i];
        i++;
    }
    return out;
}

function sqlTextForTxScan(sqlText: string): string {
    return stripSqlComments(stripDollarQuotedBodies(sqlText));
}

function findTransactionControlLine(scannable: string): string | null {
    for (const line of scannable.split("\n")) {
        if (TX_CONTROL_LINE.test(line)) return line.trim();
    }
    return null;
}

export function listMigrationFiles(dir?: string): MigrationFile[] {
    const migrationsDir = dir ?? join(REPO_ROOT, "supabase/migrations");
    const files = [...new Bun.Glob("*.sql").scanSync(migrationsDir)].sort();
    return files.map((file) => {
        const base = file.replace(/\.sql$/, "");
        const version = base.slice(0, 14);
        const name = base.slice(15);
        return {
            version,
            name,
            path: join(migrationsDir, file),
        };
    });
}

function migrationLabel(file: MigrationFile): string {
    return `${file.version}_${file.name}`;
}

async function authSchemaExists(sql: SQL): Promise<boolean> {
    const rows = await sql`
        select 1 from pg_namespace where nspname = 'auth' limit 1
    `;
    return rows.length > 0;
}

async function historyTableExists(sql: SQL): Promise<boolean> {
    const rows = await sql`
        select 1
        from information_schema.tables
        where table_schema = 'supabase_migrations'
          and table_name = 'schema_migrations'
        limit 1
    `;
    return rows.length > 0;
}

async function ensureHistoryTable(sql: SQL): Promise<void> {
    await sql`
        create schema if not exists supabase_migrations
    `.simple();
    await sql`
        create table if not exists supabase_migrations.schema_migrations (
            version text primary key,
            statements text[],
            name text
        )
    `.simple();
}

async function recordedVersions(sql: SQL): Promise<Map<string, string>> {
    if (!(await historyTableExists(sql))) return new Map();
    const rows = (await sql`
        select version, name
        from supabase_migrations.schema_migrations
        order by version
    `) as { version: string; name: string }[];
    return new Map(rows.map((r) => [r.version, r.name]));
}

function splitAppliedPending(
    files: MigrationFile[],
    recorded: Map<string, string>,
): { applied: string[]; pending: string[] } {
    const fileByVersion = new Map(files.map((f) => [f.version, f]));
    for (const version of recorded.keys()) {
        if (!fileByVersion.has(version)) {
            throw new Error(
                `Migration history diverged: recorded version ${version} has no file on disk`,
            );
        }
    }
    const applied: string[] = [];
    const pending: string[] = [];
    for (const file of files) {
        const label = migrationLabel(file);
        if (recorded.has(file.version)) applied.push(label);
        else pending.push(label);
    }
    return { applied, pending };
}

function assertNoNestedTransaction(sqlText: string, file: MigrationFile): void {
    const hit = findTransactionControlLine(sqlTextForTxScan(sqlText));
    if (hit) {
        throw new Error(
            `Migration ${migrationLabel(file)} contains begin/commit; nested transactions are not supported`,
        );
    }
}

export async function migrate(
    sql: SQL,
    opts: {
        dir?: string;
        bootstrapPath?: string;
        dryRun?: boolean;
        log?: (line: string) => void;
    } = {},
): Promise<{ applied: string[]; pending: string[] }> {
    const bootstrapPath =
        opts.bootstrapPath ?? join(REPO_ROOT, "db/bootstrap.sql");
    const files = listMigrationFiles(opts.dir);
    const log = opts.log ?? (() => {});

    const recorded = await recordedVersions(sql);
    const { applied: alreadyApplied, pending: toApply } = splitAppliedPending(
        files,
        recorded,
    );

    if (opts.dryRun) {
        return { applied: alreadyApplied, pending: toApply };
    }

    if (!(await authSchemaExists(sql))) {
        const bootstrap = await Bun.file(bootstrapPath).text();
        await sql.unsafe(bootstrap).simple();
        log(`ok bootstrap`);
    }

    await ensureHistoryTable(sql);

    const applied: string[] = [];

    for (const file of files.filter((f) => !recorded.has(f.version))) {
        const sqlText = await Bun.file(file.path).text();
        assertNoNestedTransaction(sqlText, file);
        const label = migrationLabel(file);

        try {
            await sql.begin(async (tx) => {
                await tx.unsafe(sqlText).simple();
                await tx.unsafe(
                    `insert into supabase_migrations.schema_migrations (
                        version,
                        name,
                        statements
                    )
                    values ($1, $2, ARRAY[$3::text])`,
                    [file.version, file.name, sqlText],
                );
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Migration ${label} failed: ${message}`, {
                cause: err,
            });
        }

        applied.push(label);
        log(`ok ${label}`);
    }

    return { applied, pending: toApply.filter((p) => !applied.includes(p)) };
}
