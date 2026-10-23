import { checkServiceRoleGrants } from "./data-api-grants.js";
import {
    checkMigrations,
    type MigrationChange,
} from "./migration-safety/check.js";

function usage(): void {
    console.error("usage: bun run scripts/migration-safety.ts --base <ref>");
    process.exit(1);
}

function parseArgs(): string {
    const i = process.argv.indexOf("--base");
    if (i === -1 || !process.argv[i + 1]) usage();
    return process.argv[i + 1]!;
}

function git(
    args: string[],
): { ok: true; stdout: string } | { ok: false; stderr: string } {
    const res = Bun.spawnSync({
        cmd: ["git", ...args],
        stdout: "pipe",
        stderr: "pipe",
    });
    const stdout = new TextDecoder().decode(res.stdout).trimEnd();
    const stderr = new TextDecoder().decode(res.stderr).trimEnd();
    if (res.exitCode !== 0) {
        return {
            ok: false,
            stderr: stderr || stdout || `git exit ${res.exitCode}`,
        };
    }
    return { ok: true, stdout };
}

function parseDiffLine(line: string): MigrationChange | null {
    const parts = line.split("\t");
    if (parts.length < 2) return null;
    const status = parts[0]!;
    if (status === "A") {
        return { status: "added", path: parts[1]! };
    }
    if (status === "M") {
        return { status: "modified", path: parts[1]! };
    }
    if (status === "D") {
        return { status: "deleted", path: parts[1]! };
    }
    if (status.startsWith("R") && parts.length >= 3) {
        return {
            status: "renamed",
            path: parts[2]!,
            previousPath: parts[1]!,
        };
    }
    return null;
}

async function readContents(path: string): Promise<string> {
    return await Bun.file(path).text();
}

function newestBaseTimestamp(base: string): string | null {
    const res = git([
        "ls-tree",
        "-r",
        "--name-only",
        base,
        "--",
        "supabase/migrations",
    ]);
    if (!res.ok) return null;
    let max: string | null = null;
    for (const line of res.stdout.split("\n")) {
        const name = line.trim();
        if (!name) continue;
        const m = name.match(/(\d{14})_/);
        if (!m) continue;
        const ts = m[1]!;
        if (max === null || ts > max) max = ts;
    }
    return max;
}

const base = parseArgs();

const diff = git([
    "diff",
    "--name-status",
    "-M",
    base,
    "--",
    "supabase/migrations",
]);
if (!diff.ok) {
    console.error(diff.stderr);
    process.exit(1);
}

if (!diff.stdout.trim()) {
    process.exit(0);
}

const changes: MigrationChange[] = [];
for (const line of diff.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const change = parseDiffLine(trimmed);
    if (change) changes.push(change);
}

for (const change of changes) {
    if (change.status === "added" || change.status === "renamed") {
        change.contents = await readContents(change.path);
    }
}

const findings: { rule: string; path: string; message: string }[] = [
    ...checkMigrations({
        changes,
        newestBaseTimestamp: newestBaseTimestamp(base),
    }),
];

for (const change of changes) {
    if (
        (change.status === "added" || change.status === "renamed") &&
        change.contents !== undefined
    ) {
        findings.push(...checkServiceRoleGrants(change.path, change.contents));
    }
}

for (const f of findings) {
    console.log(`${f.rule} ${f.path} ${f.message}`);
}

if (findings.length > 0) {
    process.exit(1);
}
