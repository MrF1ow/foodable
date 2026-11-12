import { homedir } from "node:os";
import { join } from "node:path";

/** Avoid Supabase (54321–54324); dry-run uses a free port unless PG_DRYRUN_PORT is set. */
export const DEFAULT_DEV_PG_PORT = 54330;

export const DEV_DATABASE_NAME = "foodable";

export function defaultPgDataDir(): string {
    const fromEnv = process.env.FOODABLE_PG_DIR?.trim();
    if (fromEnv) return fromEnv.replace(/^~(?=\/|$)/, () => homedir());
    return join(homedir(), ".local", "share", "foodable", "pg");
}

export function devPgPort(): number {
    const raw = process.env.FOODABLE_PG_PORT?.trim();
    if (raw) {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 65535) {
            throw new Error(`Invalid FOODABLE_PG_PORT: ${raw}`);
        }
        return n;
    }
    return DEFAULT_DEV_PG_PORT;
}

export function devDatabaseUrl(
    port: number,
    database = DEV_DATABASE_NAME,
): string {
    return `postgres://postgres@127.0.0.1:${port}/${database}`;
}

export type DevDbCommand =
    "init" | "start" | "stop" | "status" | "url" | "migrate";

export function parseDevDbCommand(argv: string[]): DevDbCommand {
    const cmd = argv[2];
    const allowed: DevDbCommand[] = [
        "init",
        "start",
        "stop",
        "status",
        "url",
        "migrate",
    ];
    if (!cmd || !allowed.includes(cmd as DevDbCommand)) {
        throw new Error(`Usage: bun run db:dev <${allowed.join("|")}>`);
    }
    return cmd as DevDbCommand;
}
