import { $ } from "bun";

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

export function binPrefix(dir: string): string {
    return `${dir.replace(/\/$/, "")}/`;
}

export async function pickPort(requested?: number): Promise<number> {
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

export const PG_BIN_HINT =
    "initdb not found. Set PG_BIN to the Postgres bin directory.";
