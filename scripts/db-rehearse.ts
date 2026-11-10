// Rehearse the pending migrations on a copy of production's data.
//
//   bun run db:rehearse                       dump production, dry-run what it has not applied
//   bun run db:rehearse --list                only say what is pending; no dump
//   bun run db:rehearse --key ~/.ssh/other    ssh identity for `railway ssh`
//
// Production Postgres is internal-only, so everything goes through
// `railway ssh` into the Postgres service container, which has psql and
// pg_dump. Two read-only calls: the applied versions from
// foodable_migrations.schema_migrations, then a data-only dump of the public
// schema. The dump is the household's real data. It is streamed into a fresh
// private directory outside the repo (0700, file 0600), and so is the
// throwaway cluster `db:dryrun` builds from it (TMPDIR points there). The
// directory is removed when the run ends: on success, failure, Ctrl-C or kill.

import { closeSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
    binPrefix,
    findPgBin,
    PG_BIN_HINT,
} from "../src/db/testing/pg-shared.js";

export const DEFAULTS = {
    project: "5c73bffd-c005-4e7f-8c92-57db06aed483",
    service: "Postgres",
    environment: "production",
    key: "~/.ssh/id_github_personal",
} as const;

export const APPLIED_SQL =
    "select version from foodable_migrations.schema_migrations order by version";

// Runs inside the Postgres container, where DATABASE_URL is its own URL.
export const APPLIED_COMMAND = `psql "$DATABASE_URL" -XAtq -v ON_ERROR_STOP=1 -c '${APPLIED_SQL}'`;
export const DUMP_COMMAND =
    'pg_dump "$DATABASE_URL" --data-only --schema=public --no-owner --no-privileges';

export type Options = {
    project: string;
    service: string;
    environment: string;
    key: string;
    list: boolean;
};

const USAGE = `usage: bun run db:rehearse [--list] [--key <path>]
                           [--project <id>] [--service <name>] [--environment <name>]`;

export function parseArgs(argv: string[]): Options {
    const opts: Options = { ...DEFAULTS, list: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--list") {
            opts.list = true;
            continue;
        }
        const name = {
            "--key": "key",
            "--project": "project",
            "--service": "service",
            "--environment": "environment",
        }[arg] as keyof Options | undefined;
        const value = argv[i + 1];
        if (!name) throw new Error(`unknown argument ${arg}\n${USAGE}`);
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`${arg} needs a value\n${USAGE}`);
        }
        (opts as Record<string, unknown>)[name] = value;
        i++;
    }
    return opts;
}

export function expandHome(path: string, home: string): string {
    return path === "~" || path.startsWith("~/")
        ? join(home, path.slice(1))
        : path;
}

export function sshArgs(opts: Options, remote: string, home: string): string[] {
    return [
        "railway",
        "ssh",
        "-p",
        opts.project,
        "-s",
        opts.service,
        "-e",
        opts.environment,
        "-i",
        expandHome(opts.key, home),
        "--",
        remote,
    ];
}

/** Migration versions from file names, in order. */
export function localVersions(files: string[]): string[] {
    return files
        .map((f) => /^(\d{14})_.+\.sql$/.exec(f)?.[1])
        .filter((v): v is string => v !== undefined)
        .sort();
}

/**
 * The versions psql printed, one per line. Anything else on the stream (a
 * CLI notice, a blank line) is ignored; the caller checks the result is not
 * empty, since production always has history.
 */
export function parseAppliedVersions(stdout: string): string[] {
    return stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d{14}$/.test(l))
        .sort();
}

export type Plan =
    | { kind: "up-to-date"; applied: number }
    | { kind: "pending"; pendingFrom: string; pending: string[] };

/**
 * What production has not applied. `db:dryrun --pending-from` treats every
 * file before the version as already applied and every one from it as
 * pending, so the pending set must be a suffix of the local files. A branch
 * behind production, or a new migration numbered before one production has,
 * cannot be rehearsed honestly, so both fail with what to do.
 */
export function planRehearsal(local: string[], applied: string[]): Plan {
    const onDisk = new Set(local);
    const missing = applied.filter((v) => !onDisk.has(v));
    if (missing.length > 0) {
        throw new Error(
            `production has applied ${missing.join(", ")}, which this checkout does not have; rebase on origin/main`,
        );
    }
    const done = new Set(applied);
    const pending = local.filter((v) => !done.has(v));
    if (pending.length === 0) {
        return { kind: "up-to-date", applied: applied.length };
    }
    const latest = applied.at(-1);
    const early = latest ? pending.filter((v) => v < latest) : [];
    if (early.length > 0) {
        throw new Error(
            `pending ${early.join(", ")} sorts before ${latest}, which production already has; renumber it later than every applied migration`,
        );
    }
    return { kind: "pending", pendingFrom: pending[0]!, pending };
}

/**
 * A complete plain-format pg_dump, not a truncated stream or an error page.
 * pg_dump writes the "complete" line last (newer versions follow it with an
 * \unrestrict line), so a stream cut short never has it.
 */
export function looksLikeDump(text: string): boolean {
    return (
        text.includes("-- PostgreSQL database dump\n") &&
        text.includes("-- PostgreSQL database dump complete\n")
    );
}

/** The private directory must not sit inside the repo, where git could see it. */
export function isInside(dir: string, root: string): boolean {
    const rel = relative(resolve(root), resolve(dir));
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

// ---------------------------------------------------------------- adapters

const ROOT = new URL("..", import.meta.url).pathname;

async function main(): Promise<number> {
    const opts = parseArgs(process.argv.slice(2));
    const home = homedir();

    const files = [...new Bun.Glob("*.sql").scanSync(`${ROOT}db/migrations`)];
    const local = localVersions(files);

    console.log(
        `production: ${opts.project} / ${opts.environment} / ${opts.service}`,
    );
    const appliedRun = Bun.spawnSync(sshArgs(opts, APPLIED_COMMAND, home), {
        stdout: "pipe",
        stderr: "pipe",
    });
    const applied = parseAppliedVersions(appliedRun.stdout.toString());
    if (appliedRun.exitCode !== 0 || applied.length === 0) {
        console.error(
            `reading production's migration history failed (exit ${appliedRun.exitCode}):\n${appliedRun.stderr.toString().trim()}`,
        );
        return 1;
    }

    // There is no --pending-from override on purpose: the dump has
    // production's current schema, so it only loads into a baseline that
    // stops exactly where production does.
    const plan = planRehearsal(local, applied);
    if (plan.kind === "up-to-date") {
        console.log(
            `nothing pending: production has applied all ${plan.applied} migrations in this checkout (latest ${applied.at(-1)})`,
        );
        return 0;
    }
    const { pendingFrom } = plan;
    console.log(
        `pending on production: ${plan.pending.length} (${plan.pending.join(", ")})`,
    );
    if (opts.list) return 0;

    const pgDir = await findPgBin();
    if (!pgDir) {
        console.error(PG_BIN_HINT);
        return 1;
    }
    const pgCtl = `${binPrefix(pgDir)}pg_ctl`;

    process.umask(0o077);
    const dir = mkdtempSync(join(tmpdir(), "foodable-rehearse-"));
    if (isInside(dir, ROOT)) {
        rmSync(dir, { recursive: true, force: true });
        console.error(`refusing to dump into ${dir}: it is inside the repo`);
        return 1;
    }
    const dumpPath = join(dir, "prod-data.sql");

    let child: ReturnType<typeof Bun.spawn> | undefined;
    let interrupted = false;
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        // The dry run's own cluster lives in here too (TMPDIR): stop it
        // before removing its files, in case the run was killed mid-way.
        for (const entry of new Bun.Glob("*/data/postmaster.pid").scanSync({
            cwd: dir,
            onlyFiles: true,
        })) {
            const data = join(dir, entry, "..");
            Bun.spawnSync([pgCtl, "-D", data, "-m", "immediate", "stop"], {
                stdout: "ignore",
                stderr: "ignore",
            });
        }
        rmSync(dir, { recursive: true, force: true });
    };
    const onSignal = (signal: NodeJS.Signals) => {
        interrupted = true;
        child?.kill(signal);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    process.on("SIGHUP", onSignal);
    process.on("exit", cleanup);

    try {
        console.log(`dumping production's public data into a private temp dir`);
        const fd = openSync(dumpPath, "wx", 0o600);
        try {
            child = Bun.spawn(sshArgs(opts, DUMP_COMMAND, home), {
                stdout: fd,
                stderr: "pipe",
            });
            const code = await child.exited;
            const stderr = await new Response(
                child.stderr as ReadableStream,
            ).text();
            if (interrupted) return 130;
            if (code !== 0) {
                console.error(
                    `pg_dump failed (exit ${code}):\n${stderr.trim()}`,
                );
                return 1;
            }
        } finally {
            closeSync(fd);
        }
        const dump = Bun.file(dumpPath);
        if (!looksLikeDump(await dump.text())) {
            console.error(
                "the dump is incomplete (no end marker); not loading it",
            );
            return 1;
        }
        console.log(`dump: ${(dump.size / 1024).toFixed(0)} KiB\n`);

        child = Bun.spawn(
            [
                process.execPath,
                "run",
                `${ROOT}scripts/migration-dryrun.ts`,
                "--data",
                dumpPath,
                "--pending-from",
                pendingFrom,
            ],
            {
                stdio: ["ignore", "inherit", "inherit"],
                env: { ...process.env, TMPDIR: dir },
            },
        );
        const code = await child.exited;
        if (interrupted) return 130;
        return code;
    } finally {
        child = undefined;
        cleanup();
        console.log("\ndump and throwaway cluster removed");
    }
}

if (import.meta.main) {
    try {
        process.exitCode = await main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
    }
}
