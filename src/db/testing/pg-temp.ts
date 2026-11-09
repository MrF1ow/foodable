import { $ } from "bun";
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

export async function startTempPostgres(opts?: {
    port?: number;
}): Promise<TempPostgres> {
    const pgDir = await findPgBin();
    if (!pgDir) {
        throw new Error(PG_BIN_HINT);
    }
    const bin = binPrefix(pgDir);
    const port = await pickPort(opts?.port);
    const tmp = (await $`mktemp -d`.text()).trim();
    const data = `${tmp}/data`;

    const init = await $`${bin}initdb -D ${data} -U postgres -A trust`
        .quiet()
        .nothrow();
    if (init.exitCode !== 0) {
        throw new Error(`${PG_BIN_HINT}\n${init.stderr}`);
    }

    await $`${bin}pg_ctl -D ${data} -l ${tmp}/log -w -o ${`-p ${port} -k ${tmp} -h 127.0.0.1`} start`.quiet();

    function psqlBaseFor(role: string): string[] {
        return [
            `${bin}psql`,
            "-h",
            tmp,
            "-p",
            String(port),
            "-U",
            role,
            "-d",
            "postgres",
            "-q",
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
        ];
    }

    async function psql(args: string[]): Promise<{ ok: boolean; out: string }> {
        const res = await $`${[...psqlBaseFor("postgres"), ...args]}`
            .quiet()
            .nothrow();
        return {
            ok: res.exitCode === 0,
            out: (res.stdout.toString() + res.stderr.toString()).trim(),
        };
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

    let stopped = false;

    return {
        url: `postgres://postgres@127.0.0.1:${port}/postgres`,
        dir: tmp,
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
        async stop(stopOpts?: { keep?: boolean }) {
            if (stopped) return;
            stopped = true;
            await $`${bin}pg_ctl -D ${data} -m fast stop`.quiet().nothrow();
            if (stopOpts?.keep) console.log(`kept ${tmp}`);
            else await $`rm -rf ${tmp}`.quiet().nothrow();
        },
    };
}
