import { $ } from "bun";

export type TempPostgres = {
    url: string;
    dir: string;
    psql(args: string[]): Promise<{ ok: boolean; out: string }>;
    applyFile(path: string): Promise<{ ok: boolean; out: string }>;
    scalar(sql: string): Promise<string>;
    stop(opts?: { keep?: boolean }): Promise<void>;
};

async function candidateDirs(): Promise<string[]> {
    const dirs: string[] = [];
    if (process.env.PG_BIN) {
        dirs.push(process.env.PG_BIN.replace(/\/$/, ""));
    }
    const res = await $`pg_config --bindir`.quiet().nothrow();
    if (res.exitCode === 0) {
        dirs.push(res.stdout.toString().trim());
    }
    const initdbPath = Bun.which("initdb");
    if (initdbPath) {
        dirs.push(initdbPath.replace(/\/initdb$/, ""));
    }
    return dirs;
}

export async function findPgBin(): Promise<string | null> {
    for (const dir of await candidateDirs()) {
        const initdb = `${dir}/initdb`;
        if (await Bun.file(initdb).exists()) return dir;
    }
    return null;
}

function binPrefix(dir: string): string {
    return `${dir.replace(/\/$/, "")}/`;
}

async function pickPort(requested?: number): Promise<number> {
    if (requested !== undefined) return requested;
    const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
            open() {},
            data() {},
        },
    });
    const port = server.port;
    server.stop(true);
    return port;
}

export async function startTempPostgres(opts?: {
    port?: number;
}): Promise<TempPostgres> {
    const pgDir = await findPgBin();
    if (!pgDir) {
        throw new Error(
            "initdb not found. Set PG_BIN to the Postgres bin directory.",
        );
    }
    const bin = binPrefix(pgDir);
    const port = await pickPort(opts?.port);
    const tmp = (await $`mktemp -d`.text()).trim();
    const data = `${tmp}/data`;

    const init = await $`${bin}initdb -D ${data} -U postgres -A trust`
        .quiet()
        .nothrow();
    if (init.exitCode !== 0) {
        throw new Error(
            `initdb failed. Set PG_BIN to the Postgres bin directory.\n${init.stderr}`,
        );
    }

    await $`${bin}pg_ctl -D ${data} -l ${tmp}/log -w -o ${`-p ${port} -k ${tmp} -h 127.0.0.1`} start`.quiet();

    const psqlBase = [
        `${bin}psql`,
        "-h",
        tmp,
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

    let stopped = false;

    return {
        url: `postgres://postgres@127.0.0.1:${port}/postgres`,
        dir: tmp,
        psql,
        applyFile(path: string) {
            return psql(["-1", "-f", path]);
        },
        async scalar(sql: string) {
            const res = await psql(["-tA", "-c", sql]);
            if (!res.ok) throw new Error(res.out);
            return res.out;
        },
        async stop(stopOpts?: { keep?: boolean }) {
            if (stopped) return;
            stopped = true;
            await $`${bin}pg_ctl -D ${data} -m fast stop`.quiet().nothrow();
            if (stopOpts?.keep) console.log(`kept ${tmp}`);
            else await $`rm -rf ${tmp}`.quiet().nothrow();
        },
    };
}
