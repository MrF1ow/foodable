import { $ } from "bun";
import { SQL } from "bun";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { binPrefix, findPgBin, PG_BIN_HINT } from "./pg-shared.js";

/**
 * Tables excluded from e2e snapshot/restore:
 * - OAuth tables: Phase 3 repointed their user_id FKs to public.users with
 *   NO ACTION, so truncate (no CASCADE) cannot clear public.users while OAuth
 *   rows still reference them; restoring stale OAuth tokens would sign Grok out.
 * - public.users: kept live so OAuth references stay valid across restore.
 * - tool_analytics: ephemeral per-run telemetry, not part of seed data.
 * - export_archives: no FK issues if omitted (nothing references it), but
 *   exports created mid-run would survive restore; excluding them keeps runs
 *   from leaving stale download blobs behind.
 */
export const E2E_NOT_SNAPSHOTTED = [
    "oauth_tokens",
    "refresh_tokens",
    "registered_clients",
    "auth_codes",
    "tool_analytics",
    "users",
    "export_archives",
] as const;

export async function e2eSnapshot(
    dbUrl: string,
    outFile: string,
): Promise<void> {
    const pgBin = await findPgBin();
    if (!pgBin) throw new Error(PG_BIN_HINT);
    const bin = binPrefix(pgBin);
    await mkdir(dirname(outFile), { recursive: true });

    const excludes = E2E_NOT_SNAPSHOTTED.map(
        (t) => `--exclude-table-data=public.${t}`,
    );
    const dump =
        await $`${bin}pg_dump ${dbUrl} --data-only --schema=public --disable-triggers --no-owner --no-privileges ${excludes} -f ${outFile}`
            .quiet()
            .nothrow();
    if (dump.exitCode !== 0) {
        throw new Error(dump.stderr.toString() || dump.stdout.toString());
    }
}

export async function e2eRestore(
    dbUrl: string,
    snapshotFile: string,
): Promise<void> {
    const pgBin = await findPgBin();
    if (!pgBin) throw new Error(PG_BIN_HINT);
    const bin = binPrefix(pgBin);
    const sql = new SQL(dbUrl, { prepare: false, max: 1 });
    try {
        const tableRows = (await sql`
            select tablename from pg_tables where schemaname = 'public'
        `) as { tablename: string }[];
        const tables = tableRows
            .map((r) => r.tablename)
            .filter(
                (t: string) =>
                    !E2E_NOT_SNAPSHOTTED.includes(
                        t as (typeof E2E_NOT_SNAPSHOTTED)[number],
                    ),
            )
            .map((t: string) => `public.${t}`)
            .join(", ");
        const restore =
            await $`${bin}psql ${dbUrl} -v ON_ERROR_STOP=1 --single-transaction -q -c ${"set session_replication_role = replica"} -c ${`truncate ${tables}`} -f ${snapshotFile}`
                .quiet()
                .nothrow();
        if (restore.exitCode !== 0) {
            throw new Error(
                restore.stderr.toString() || restore.stdout.toString(),
            );
        }
    } finally {
        await sql.close();
    }
}

export async function publicRowFingerprint(dbUrl: string): Promise<string> {
    const sql = new SQL(dbUrl, { prepare: false, max: 1 });
    try {
        const tables =
            (await sql`select tablename from pg_tables where schemaname = 'public' order by tablename`) as {
                tablename: string;
            }[];
        const parts: string[] = [];
        for (const { tablename } of tables) {
            if (
                E2E_NOT_SNAPSHOTTED.includes(
                    tablename as (typeof E2E_NOT_SNAPSHOTTED)[number],
                )
            ) {
                continue;
            }
            const rows = (await sql.unsafe(
                `select count(*)::text as c from public."${tablename.replace(/"/g, '""')}"`,
            )) as { c: string }[];
            const row = rows[0];
            if (!row) throw new Error(`count failed for ${tablename}`);
            parts.push(`${tablename}:${row.c}`);
        }
        return parts.join("|");
    } finally {
        await sql.close();
    }
}
