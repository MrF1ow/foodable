import { SQL } from "bun";
import { join } from "node:path";

const REPO_ROOT = new URL("../..", import.meta.url).pathname;

export type MigrationFile = { version: string; name: string; path: string };

/**
 * Split SQL into top-level statements the way the server will, skipping
 * quoted strings ('…', E'…'), quoted identifiers ("…"), comments (-- and
 * nested /* *\/) and dollar-quoted bodies ($$…$$, $tag$…$tag$). A single
 * linear pass: no backtracking regex, so a hostile file cannot stall it.
 */
export function splitSqlStatements(sqlText: string): string[] {
    const statements: string[] = [];
    let current = "";
    let i = 0;
    const n = sqlText.length;
    const flush = () => {
        const text = current.trim();
        if (text) statements.push(text);
        current = "";
    };
    while (i < n) {
        const c = sqlText[i];
        const next = sqlText[i + 1];
        if (c === "-" && next === "-") {
            while (i < n && sqlText[i] !== "\n") i++;
            current += " ";
            continue;
        }
        if (c === "/" && next === "*") {
            let depth = 1;
            i += 2;
            while (i < n && depth > 0) {
                if (sqlText[i] === "/" && sqlText[i + 1] === "*") {
                    depth++;
                    i += 2;
                } else if (sqlText[i] === "*" && sqlText[i + 1] === "/") {
                    depth--;
                    i += 2;
                } else {
                    i++;
                }
            }
            current += " ";
            continue;
        }
        if (c === "'") {
            const escapes = /[eE]/.test(sqlText[i - 1] ?? "");
            current += c;
            i++;
            while (i < n) {
                const d = sqlText[i];
                current += d;
                i++;
                if (escapes && d === "\\") {
                    if (i < n) current += sqlText[i++];
                } else if (d === "'") {
                    if (sqlText[i] === "'") current += sqlText[i++];
                    else break;
                }
            }
            continue;
        }
        if (c === '"') {
            current += c;
            i++;
            while (i < n) {
                const d = sqlText[i];
                current += d;
                i++;
                if (d === '"') {
                    if (sqlText[i] === '"') current += sqlText[i++];
                    else break;
                }
            }
            continue;
        }
        if (c === "$" && !/[A-Za-z0-9_]/.test(sqlText[i - 1] ?? "")) {
            let j = i + 1;
            while (j < n && /[A-Za-z0-9_]/.test(sqlText[j] ?? "")) j++;
            const tag = sqlText.slice(i, j + 1);
            if (sqlText[j] === "$" && !/^\$[0-9]/.test(tag)) {
                const closeAt = sqlText.indexOf(tag, j + 1);
                const end = closeAt === -1 ? n : closeAt + tag.length;
                current += sqlText.slice(i, end);
                i = end;
                continue;
            }
        }
        if (c === ";") {
            flush();
            i++;
            continue;
        }
        current += c;
        i++;
    }
    flush();
    return statements;
}

// Leading keywords of a top-level statement that starts, ends or hands off a
// transaction. Inside a migration any of them would commit or abort the
// runner's own per-file transaction early. PL/pgSQL begin/end only ever
// appear inside dollar-quoted bodies, which splitSqlStatements keeps whole.
const TX_CONTROL_FIRST_WORDS = new Set([
    "begin",
    "start",
    "commit",
    "end",
    "rollback",
    "abort",
]);

export function findTransactionControlStatement(
    sqlText: string,
): string | null {
    for (const statement of splitSqlStatements(sqlText)) {
        const [first = "", second = ""] = statement
            .toLowerCase()
            .split(/\s+/, 2);
        if (TX_CONTROL_FIRST_WORDS.has(first)) return statement;
        if (first === "prepare" && second === "transaction") {
            return statement;
        }
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
    const hit = findTransactionControlStatement(sqlText);
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

    const pendingFiles = files.filter((f) => !recorded.has(f.version));
    const pendingText = new Map<string, string>();
    for (const file of pendingFiles) {
        const sqlText = await Bun.file(file.path).text();
        assertNoNestedTransaction(sqlText, file);
        pendingText.set(file.version, sqlText);
    }

    if (!(await authSchemaExists(sql))) {
        const bootstrap = await Bun.file(bootstrapPath).text();
        await sql.unsafe(bootstrap).simple();
        log(`ok bootstrap`);
    }

    await ensureHistoryTable(sql);

    const applied: string[] = [];

    for (const file of pendingFiles) {
        const sqlText = pendingText.get(file.version)!;
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
