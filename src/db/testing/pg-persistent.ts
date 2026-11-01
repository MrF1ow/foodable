import { $ } from "bun";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
    DEV_DATABASE_NAME,
    devDatabaseUrl,
    devPgPort,
    defaultPgDataDir,
} from "./dev-db-config.js";
import { binPrefix, findPgBin, PG_BIN_HINT } from "./pg-shared.js";

export type PersistentPostgres = {
    dataDir: string;
    port: number;
    bin: string;
    logFile: string;
    url: string;
    psql(args: string[]): Promise<{ ok: boolean; out: string }>;
    isInitialized(): Promise<boolean>;
    isRunning(): Promise<boolean>;
    initCluster(): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    ensureDatabase(): Promise<void>;
};

export async function openPersistentPostgres(opts?: {
    dataDir?: string;
    port?: number;
}): Promise<PersistentPostgres> {
    const pgDir = await findPgBin();
    if (!pgDir) {
        throw new Error(PG_BIN_HINT);
    }
    const bin = binPrefix(pgDir);
    const dataDir = opts?.dataDir ?? defaultPgDataDir();
    const port = opts?.port ?? devPgPort();
    const logFile = join(dataDir, "postgres.log");

    const psqlBase = [
        `${bin}psql`,
        "-h",
        "127.0.0.1",
        "-p",
        String(port),
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-q",
        "-X",
        "-v",
        "ON_ERROR_STOP=1",
    ];

    async function psql(args: string[]): Promise<{ ok: boolean; out: string }> {
        const res = await $`${[...psqlBase, ...args]}`.quiet().nothrow();
        return {
            ok: res.exitCode === 0,
            out: (res.stdout.toString() + res.stderr.toString()).trim(),
        };
    }

    async function isInitialized(): Promise<boolean> {
        return Bun.file(join(dataDir, "PG_VERSION")).exists();
    }

    async function isRunning(): Promise<boolean> {
        const res = await $`${bin}pg_ctl -D ${dataDir} status`
            .quiet()
            .nothrow();
        return res.exitCode === 0;
    }

    async function writeLocalConfig(): Promise<void> {
        await mkdir(dataDir, { recursive: true });
        const conf = join(dataDir, "postgresql.conf");
        const lines = [`port = ${port}`, "listen_addresses = '127.0.0.1'"];
        await Bun.write(conf, `${lines.join("\n")}\n`);
    }

    async function initCluster(): Promise<void> {
        await mkdir(dataDir, { recursive: true });
        const init = await $`${bin}initdb -D ${dataDir} -U postgres -A trust`
            .quiet()
            .nothrow();
        if (init.exitCode !== 0) {
            throw new Error(`${PG_BIN_HINT}\n${init.stderr}`);
        }
        await writeLocalConfig();
    }

    async function start(): Promise<void> {
        if (!(await isInitialized())) {
            throw new Error(
                `Postgres data directory is not initialized: ${dataDir}\nRun: bun run db:dev init`,
            );
        }
        if (await isRunning()) return;
        await $`${bin}pg_ctl -D ${dataDir} -l ${logFile} -w -o ${`-p ${port} -h 127.0.0.1`} start`.quiet();
    }

    async function stop(): Promise<void> {
        if (!(await isRunning())) return;
        await $`${bin}pg_ctl -D ${dataDir} -m fast stop`.quiet().nothrow();
    }

    async function ensureDatabase(): Promise<void> {
        const check = await psql([
            "-tA",
            "-c",
            `select 1 from pg_database where datname = '${DEV_DATABASE_NAME}'`,
        ]);
        if (!check.ok) throw new Error(check.out);
        if (check.out === "1") return;
        const created = await psql([
            "-c",
            `create database ${DEV_DATABASE_NAME}`,
        ]);
        if (!created.ok) throw new Error(created.out);
    }

    return {
        dataDir,
        port,
        bin,
        logFile,
        url: devDatabaseUrl(port),
        psql,
        isInitialized,
        isRunning,
        initCluster,
        start,
        stop,
        ensureDatabase,
    };
}
