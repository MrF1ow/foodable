// Throwaway Postgres for tests and the migration dry run.
//
// Two ways to get a database:
//   - createTestDatabase(): a database on one server shared by the whole
//     process, created from a template and dropped on stop(). Cheap: no
//     initdb, no server start. Use it unless the test needs a cluster to
//     itself.
//   - startTempPostgres(): a fresh cluster of its own. Roles are cluster-wide
//     and db/bootstrap.sql creates them, so a test of bootstrap on a cluster
//     that has never seen it, or the dry run, needs this.
//
// Clusters are throwaway: initdb -N and a server with fsync, synchronous
// commit and full page writes off. They live on disk under pgTestRoot(), not
// in /tmp, which is often a RAM-backed tmpfs. Each cluster folder records the
// pid that owns it; on the first cluster of a process, folders whose owner is
// gone (or that never got one and are over an hour old) are stopped and
// removed. Nothing outside pgTestRoot() is touched.

import { $ } from "bun";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { binPrefix, findPgBin, PG_BIN_HINT, pickPort } from "./pg-shared.js";

export type TempPostgres = {
    url: string;
    dir: string;
    psql(args: string[]): Promise<{ ok: boolean; out: string }>;
    psqlAs(role: string, args: string[]): Promise<{ ok: boolean; out: string }>;
    applyFile(path: string): Promise<{ ok: boolean; out: string }>;
    scalar(sql: string): Promise<string>;
    stop(opts?: { keep?: boolean }): Promise<void>;
};

export { findPgBin } from "./pg-shared.js";

const RUN_PREFIX = "run-";
const OWNER_FILE = "owner.pid";
const KEEP_FILE = "KEEP";
const STALE_MS = 60 * 60 * 1000;

// Durability is pointless for a cluster that is deleted at the end of the run.
const SERVER_OPTIONS = [
    "-c fsync=off",
    "-c synchronous_commit=off",
    "-c full_page_writes=off",
    "-c shared_buffers=32MB",
];

export function pgTestRoot(
    env: Record<string, string | undefined> = process.env,
): string {
    // Absolute, because postgres resolves its socket and lock paths after
    // changing into the data directory.
    if (env.FOODABLE_PG_TEST_DIR) return resolve(env.FOODABLE_PG_TEST_DIR);
    const cache = env.XDG_CACHE_HOME || join(homedir(), ".cache");
    return resolve(cache, "foodable", "pg-test");
}

type Cluster = {
    bin: string;
    dir: string;
    data: string;
    port: number;
    reaper?: ReturnType<typeof Bun.spawn>;
};

const live = new Set<Cluster>();
let exitHookInstalled = false;
let sharedCluster: Promise<Cluster> | undefined;
const templates = new Map<string, Promise<void>>();

function stopClusterSync(bin: string, data: string): void {
    if (!statSyncSafe(join(data, "postmaster.pid"))) return;
    Bun.spawnSync([`${bin}pg_ctl`, "-D", data, "-m", "immediate", "stop"], {
        stdout: "ignore",
        stderr: "ignore",
    });
}

function statSyncSafe(path: string) {
    try {
        return statSync(path);
    } catch {
        return null;
    }
}

/**
 * Stop and delete every cluster this process still has running. `bun test`
 * fires no `exit` event, so the test preload (`test-teardown.ts`) calls this
 * from a global afterAll; scripts get it from the exit hook.
 */
export function stopAllTempPostgres(): void {
    for (const cluster of [...live]) stopCluster(cluster, false);
    sharedCluster = undefined;
    templates.clear();
}

// Waits for the owning process to die, however it dies (kill -9 included),
// then stops the server and deletes the folder unless it was kept. It ignores
// the terminal's signals so a Ctrl-C that kills the run does not kill it too.
const REAPER = `trap '' INT TERM HUP
while kill -0 "$1" 2>/dev/null; do sleep 1; done
[ -e "$2/${KEEP_FILE}" ] && exit 0
[ -e "$2/data/postmaster.pid" ] && "$3" -D "$2/data" -m immediate stop
rm -rf "$2"`;

function startReaper(cluster: Cluster): void {
    try {
        cluster.reaper = Bun.spawn(
            [
                "sh",
                "-c",
                REAPER,
                "reaper",
                String(process.pid),
                cluster.dir,
                `${cluster.bin}pg_ctl`,
            ],
            { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
        );
        cluster.reaper.unref();
    } catch {
        // No sh: the sweep on the next run still cleans up.
    }
}

function pidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        return (err as NodeJS.ErrnoException).code === "EPERM";
    }
}

/**
 * Stop and remove cluster folders left behind by runs that were killed.
 * Only direct `run-*` children of `root` are considered. A folder is left
 * alone when it is marked KEEP, when its owner pid is still alive, or when it
 * has no owner yet and is younger than an hour (another process may be
 * creating it right now).
 */
export function sweepPgTestRoot(
    root: string,
    bin: string,
    opts: { now?: number; staleMs?: number } = {},
): string[] {
    const now = opts.now ?? Date.now();
    const staleMs = opts.staleMs ?? STALE_MS;
    let entries: string[];
    try {
        entries = readdirSync(root);
    } catch {
        return [];
    }
    const removed: string[] = [];
    for (const name of entries) {
        if (!name.startsWith(RUN_PREFIX)) continue;
        const dir = join(root, name);
        const st = statSyncSafe(dir);
        if (!st?.isDirectory()) continue;
        if (statSyncSafe(join(dir, KEEP_FILE))) continue;
        let owner: number | null = null;
        try {
            const text = readFileSync(join(dir, OWNER_FILE), "utf8").trim();
            owner = /^\d+$/.test(text) ? Number(text) : null;
        } catch {
            owner = null;
        }
        if (owner === process.pid) continue;
        if (owner !== null && pidAlive(owner)) continue;
        if (owner === null && now - st.mtimeMs < staleMs) continue;
        stopClusterSync(bin, join(dir, "data"));
        rmSync(dir, { recursive: true, force: true });
        removed.push(dir);
    }
    return removed;
}

let swept = false;

async function createCluster(port?: number): Promise<Cluster> {
    const pgDir = await findPgBin();
    if (!pgDir) {
        throw new Error(PG_BIN_HINT);
    }
    const bin = binPrefix(pgDir);
    const root = pgTestRoot();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (!swept) {
        swept = true;
        sweepPgTestRoot(root, bin);
    }
    if (!exitHookInstalled) {
        exitHookInstalled = true;
        process.on("exit", stopAllTempPostgres);
    }

    const dir = mkdtempSync(join(root, RUN_PREFIX));
    writeFileSync(join(dir, OWNER_FILE), `${process.pid}\n`);
    const cluster: Cluster = {
        bin,
        dir,
        data: join(dir, "data"),
        port: await pickPort(port),
    };
    live.add(cluster);
    startReaper(cluster);

    try {
        const init =
            await $`${bin}initdb -N -D ${cluster.data} -U postgres -A trust`
                .quiet()
                .nothrow();
        if (init.exitCode !== 0) {
            throw new Error(`${PG_BIN_HINT}\n${init.stderr}`);
        }
        const serverOpts = [
            `-p ${cluster.port}`,
            `-k ${dir}`,
            "-h 127.0.0.1",
            ...SERVER_OPTIONS,
        ].join(" ");
        const start =
            await $`${bin}pg_ctl -D ${cluster.data} -l ${dir}/log -w -o ${serverOpts} start`
                .quiet()
                .nothrow();
        if (start.exitCode !== 0) {
            const log = await Bun.file(`${dir}/log`)
                .text()
                .catch(() => "");
            throw new Error(`pg_ctl start failed:\n${start.stderr}\n${log}`);
        }
        return cluster;
    } catch (err) {
        stopCluster(cluster, false);
        throw err;
    }
}

function stopCluster(cluster: Cluster, keep: boolean): void {
    live.delete(cluster);
    cluster.reaper?.kill("SIGKILL");
    stopClusterSync(cluster.bin, cluster.data);
    if (keep) {
        writeFileSync(join(cluster.dir, KEEP_FILE), "");
        console.log(`kept ${cluster.dir}`);
    } else {
        rmSync(cluster.dir, { recursive: true, force: true });
    }
}

function client(
    cluster: Cluster,
    database: string,
): Pick<TempPostgres, "url" | "psql" | "psqlAs" | "applyFile" | "scalar"> {
    function psqlBaseFor(role: string): string[] {
        return [
            `${cluster.bin}psql`,
            "-h",
            cluster.dir,
            "-p",
            String(cluster.port),
            "-U",
            role,
            "-d",
            database,
            "-q",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
        ];
    }

    async function psqlAs(
        role: string,
        args: string[],
    ): Promise<{ ok: boolean; out: string }> {
        const res = await $`${[...psqlBaseFor(role), ...args]}`
            .quiet()
            .nothrow();
        return {
            ok: res.exitCode === 0,
            out: (res.stdout.toString() + res.stderr.toString()).trim(),
        };
    }

    function psql(args: string[]): Promise<{ ok: boolean; out: string }> {
        return psqlAs("postgres", args);
    }

    return {
        url: `postgres://postgres@127.0.0.1:${cluster.port}/${database}`,
        psql,
        psqlAs,
        applyFile(path: string) {
            return psql(["-1", "-f", path]);
        },
        async scalar(sql: string) {
            const res = await psql(["-tA", "-c", sql]);
            if (!res.ok) throw new Error(res.out);
            return res.out;
        },
    };
}

/** A fresh cluster of its own; stop() shuts it down and deletes it. */
export async function startTempPostgres(opts?: {
    port?: number;
}): Promise<TempPostgres> {
    const cluster = await createCluster(opts?.port);
    let stopped = false;
    return {
        ...client(cluster, "postgres"),
        dir: cluster.dir,
        async stop(stopOpts?: { keep?: boolean }) {
            if (stopped) return;
            stopped = true;
            stopCluster(cluster, stopOpts?.keep ?? false);
        },
    };
}

function sharedServer(): Promise<Cluster> {
    sharedCluster ??= createCluster().catch((err) => {
        sharedCluster = undefined;
        throw err;
    });
    return sharedCluster;
}

function quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Build a template database on the shared server once per process. `build`
 * gets a URL to the new database; when it resolves, the database is marked
 * as a template and closed to connections, so later copies cannot race it.
 */
export function ensureTemplate(
    name: string,
    build: (url: string) => Promise<void>,
): Promise<void> {
    let ready = templates.get(name);
    if (!ready) {
        ready = (async () => {
            const cluster = await sharedServer();
            const admin = client(cluster, "postgres");
            const ident = quoteIdent(name);
            await admin.scalar(`create database ${ident}`);
            try {
                await build(client(cluster, name).url);
                await admin.scalar(
                    `alter database ${ident} with is_template true allow_connections false`,
                );
            } catch (err) {
                // Drop the half-built database, so the next caller rebuilds
                // it and reports the real error instead of "already exists".
                await admin.psql([
                    "-c",
                    `drop database if exists ${ident} with (force)`,
                ]);
                throw err;
            }
        })().catch((err) => {
            templates.delete(name);
            throw err;
        });
        templates.set(name, ready);
    }
    return ready;
}

/**
 * A new database on the shared server, copied from `template` (an
 * ensureTemplate name, or Postgres's own template1 when omitted). stop()
 * drops it. The server itself is stopped when the process exits.
 */
export async function createTestDatabase(opts?: {
    template?: string;
}): Promise<TempPostgres> {
    const cluster = await sharedServer();
    const admin = client(cluster, "postgres");
    const name = `t_${crypto.randomUUID().replace(/-/g, "")}`;
    const ident = quoteIdent(name);
    const from = opts?.template ? ` template ${quoteIdent(opts.template)}` : "";
    await admin.scalar(`create database ${ident}${from}`);
    const dir = join(cluster.dir, name);
    mkdirSync(dir);
    let stopped = false;
    return {
        ...client(cluster, name),
        dir,
        async stop() {
            if (stopped) return;
            stopped = true;
            await admin.psql([
                "-c",
                `drop database if exists ${ident} with (force)`,
            ]);
            rmSync(dir, { recursive: true, force: true });
        },
    };
}
