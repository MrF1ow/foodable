import { $ } from "bun";
import { SQL } from "bun";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { devDatabaseUrl, devPgPort } from "./dev-db-config.js";
import { binPrefix, findPgBin, PG_BIN_HINT } from "./pg-shared.js";

export type ImportResult = {
    ok: boolean;
    tableCounts: { table: string; source: number; target: number }[];
    passwordHashOk: boolean;
    error?: string;
};

async function migrationVersions(url: string): Promise<Set<string>> {
    const sql = new SQL(url, { prepare: false, max: 1 });
    try {
        const rows = (await sql`
            select version
            from supabase_migrations.schema_migrations
            order by version
        `) as { version: string }[];
        return new Set(rows.map((r) => r.version));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not read schema_migrations: ${msg}`);
    } finally {
        await sql.close();
    }
}

export function migrationDiff(
    source: Set<string>,
    target: Set<string>,
): { onlySource: string[]; onlyTarget: string[] } {
    const onlySource = [...source].filter((v) => !target.has(v)).sort();
    const onlyTarget = [...target].filter((v) => !source.has(v)).sort();
    return { onlySource, onlyTarget };
}

export async function assertMigrationParity(
    fromUrl: string,
    toUrl: string,
): Promise<void> {
    const [from, to] = await Promise.all([
        migrationVersions(fromUrl),
        migrationVersions(toUrl),
    ]);
    const diff = migrationDiff(from, to);
    if (diff.onlySource.length || diff.onlyTarget.length) {
        const lines = [
            "Migration history mismatch (supabase_migrations.schema_migrations).",
            "Apply the same migrations on both databases before importing.",
        ];
        if (diff.onlySource.length) {
            lines.push(
                `Only on source (${diff.onlySource.length}): ${diff.onlySource.join(", ")}`,
            );
        }
        if (diff.onlyTarget.length) {
            lines.push(
                `Only on target (${diff.onlyTarget.length}): ${diff.onlyTarget.join(", ")}`,
            );
        }
        throw new Error(lines.join("\n"));
    }
}

export async function assertTargetPublicEmpty(toUrl: string): Promise<void> {
    const counts = await publicTableCounts(toUrl);
    const nonEmpty = [...counts.entries()].filter(([, n]) => n > 0);
    if (nonEmpty.length === 0) return;
    const detail = nonEmpty.map(([t, n]) => `${t}: ${n}`).join(", ");
    throw new Error(
        `Target public schema is not empty (${detail}). Refusing to merge.`,
    );
}

async function publicTableCounts(url: string): Promise<Map<string, number>> {
    const sql = new SQL(url, { prepare: false, max: 1 });
    try {
        const tables = (await sql`
            select tablename
            from pg_tables
            where schemaname = 'public'
            order by tablename
        `) as { tablename: string }[];
        const counts = new Map<string, number>();
        for (const { tablename } of tables) {
            const rows = (await sql.unsafe(
                `select count(*)::bigint as c from public."${tablename.replace(/"/g, '""')}"`,
            )) as { c: bigint }[];
            const row = rows[0];
            if (!row) throw new Error(`count failed for ${tablename}`);
            counts.set(tablename, Number(row.c));
        }
        return counts;
    } finally {
        await sql.close();
    }
}

async function passwordHashParity(
    fromUrl: string,
    toUrl: string,
): Promise<boolean> {
    const fromSql = new SQL(fromUrl, { prepare: false, max: 1 });
    const toSql = new SQL(toUrl, { prepare: false, max: 1 });
    try {
        const fromRows = (await fromSql`
            select id, password_hash
            from public.users
        `) as { id: string; password_hash: string | null }[];
        for (const row of fromRows) {
            if (row.password_hash == null) continue;
            const [target] = (await toSql`
                select password_hash
                from public.users
                where id = ${row.id}
            `) as { password_hash: string | null }[];
            if (!target || target.password_hash == null) return false;
        }
        return true;
    } finally {
        await fromSql.close();
        await toSql.close();
    }
}

/**
 * Copy public data from one Postgres to another. Source is read-only:
 * pg_dump never writes to the source; optional read-only transactions are
 * not required because pg_dump takes a consistent snapshot read.
 */
export async function importSupabasePublicData(
    fromUrl: string,
    toUrl: string,
): Promise<ImportResult> {
    await assertMigrationParity(fromUrl, toUrl);
    await assertTargetPublicEmpty(toUrl);

    const pgBin = await findPgBin();
    if (!pgBin) {
        return {
            ok: false,
            tableCounts: [],
            passwordHashOk: false,
            error: PG_BIN_HINT,
        };
    }
    const bin = binPrefix(pgBin);
    const work = await mkdtemp(join(tmpdir(), "foodable-import-"));
    const dumpPath = join(work, "public-data.sql");

    try {
        const dump =
            await $`${bin}pg_dump ${fromUrl} --data-only --schema=public --no-owner --no-privileges -f ${dumpPath}`
                .quiet()
                .nothrow();
        if (dump.exitCode !== 0) {
            return {
                ok: false,
                tableCounts: [],
                passwordHashOk: false,
                error: dump.stderr.toString() || dump.stdout.toString(),
            };
        }

        const wrapper = join(work, "load.sql");
        await writeFile(
            wrapper,
            "set session_replication_role = replica;\n\\i public-data.sql\n",
        );

        const load =
            await $`${bin}psql ${toUrl} -v ON_ERROR_STOP=1 --single-transaction -q -f ${wrapper}`
                .cwd(work)
                .quiet()
                .nothrow();
        if (load.exitCode !== 0) {
            return {
                ok: false,
                tableCounts: [],
                passwordHashOk: false,
                error: load.stderr.toString() || load.stdout.toString(),
            };
        }

        const [sourceCounts, targetCounts] = await Promise.all([
            publicTableCounts(fromUrl),
            publicTableCounts(toUrl),
        ]);
        const tableCounts: ImportResult["tableCounts"] = [];
        let countsOk = true;
        for (const [table, source] of sourceCounts) {
            const target = targetCounts.get(table) ?? 0;
            tableCounts.push({ table, source, target });
            if (source !== target) countsOk = false;
        }
        for (const [table, target] of targetCounts) {
            if (!sourceCounts.has(table)) {
                tableCounts.push({ table, source: 0, target });
                if (target !== 0) countsOk = false;
            }
        }
        tableCounts.sort((a, b) => a.table.localeCompare(b.table));

        const passwordHashOk = await passwordHashParity(fromUrl, toUrl);
        const ok = countsOk && passwordHashOk;
        return { ok, tableCounts, passwordHashOk };
    } finally {
        await rm(work, { recursive: true, force: true });
    }
}

export function defaultImportTargetUrl(): string {
    return devDatabaseUrl(devPgPort());
}

export function printImportReport(result: ImportResult): void {
    if (result.error) {
        console.error(result.error);
        return;
    }
    console.log("table\tsource\ttarget\tok");
    for (const row of result.tableCounts) {
        const match = row.source === row.target ? "yes" : "NO";
        console.log(`${row.table}\t${row.source}\t${row.target}\t${match}`);
    }
    console.log(
        `password_hash parity: ${result.passwordHashOk ? "ok" : "FAILED"}`,
    );
}
