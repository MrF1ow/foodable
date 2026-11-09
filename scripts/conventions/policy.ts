// The policy check: PR conventions (title, branch, body sections, blast
// radius) and migration safety, judged by the base branch's copy of the rules.
//
//   bun run scripts/conventions/policy.ts
//
// policy.yml runs this under `pull_request_target` from a checkout of the base
// branch, so a PR that edits these scripts is still judged by the version on
// main; the edit takes effect once it merges. It never checks out or executes
// the PR: the file list, the PR text and the contents of the migration files
// come through the API (GH_TOKEN, REPO, PR_NUMBER). `NEWEST_BASE_TREE`
// (default HEAD) names the base tree to read the newest migration timestamp
// from, for dry runs against an old PR.

import { checkServiceRoleGrants } from "../data-api-grants.ts";
import {
    checkMigrations,
    isRelocation,
    LEGACY_MIGRATIONS_DIR,
    MIGRATIONS_DIR,
    type MigrationChange,
} from "../migration-safety/check.ts";
import {
    isPolicyPath,
    isPrControlledCheckPath,
    lintPr,
} from "./conventions.ts";
import {
    changedPaths,
    getBlobText,
    getPr,
    getPrFiles,
    readPrEnv,
    type PrFile,
} from "./github.ts";

const inMigrationDirs = (path: string | undefined): path is string =>
    path !== undefined &&
    (path.startsWith(`${MIGRATIONS_DIR}/`) ||
        path.startsWith(`${LEGACY_MIGRATIONS_DIR}/`));

/**
 * The API's file rows as the migration changes `git diff --name-status -M --
 * <migration dirs>` would report. Like that pathspec, a rename from outside the
 * dirs is an add, and a rename out of them a delete. The API gives no
 * similarity, but a rename with zero changed lines has identical contents, which
 * is the 100 that `isRelocation` asks for.
 */
export function toMigrationChanges(
    files: readonly PrFile[],
): MigrationChange[] {
    const changes: MigrationChange[] = [];
    for (const f of files) {
        const now = inMigrationDirs(f.filename);
        const before = inMigrationDirs(f.previous_filename);
        if (!now && !before) continue;
        switch (f.status) {
            case "added":
            case "copied":
                if (now) changes.push({ status: "added", path: f.filename });
                break;
            case "removed":
                if (now) changes.push({ status: "deleted", path: f.filename });
                break;
            case "renamed":
                if (now && before) {
                    changes.push({
                        status: "renamed",
                        path: f.filename,
                        previousPath: f.previous_filename,
                        similarity: f.changes === 0 ? 100 : 50,
                    });
                } else if (now) {
                    changes.push({ status: "added", path: f.filename });
                } else {
                    changes.push({
                        status: "deleted",
                        path: f.previous_filename!,
                    });
                }
                break;
            default:
                if (now) changes.push({ status: "modified", path: f.filename });
        }
    }
    return changes;
}

export type PolicyInput = {
    title: string;
    branch: string;
    body: string;
    author: string;
    /** Every changed path; a rename lists old and new. */
    files: string[];
    /** The API's rows, for the migration rules. */
    prFiles: PrFile[];
    /** Contents at the head commit of the migration files the PR adds or renames. */
    contents: Record<string, string>;
    newestBaseTimestamp: string | null;
};

export type PolicyResult = {
    ok: boolean;
    findings: string[];
    /** Changed files that run from main: their edit takes effect after merge. */
    policyPaths: string[];
    /** Changed files that define checks run from the PR itself. */
    checkPaths: string[];
    summary: string[];
};

export function evaluatePolicy(input: PolicyInput): PolicyResult {
    const findings: string[] = [];
    const lint = lintPr({
        title: input.title,
        branch: input.branch,
        body: input.body,
        files: input.files,
        author: input.author,
        fileContents: input.contents,
    });
    findings.push(...lint.findings.map((f) => f.message));

    const changes = toMigrationChanges(input.prFiles);
    for (const change of changes) {
        if (change.status === "added" || change.status === "renamed") {
            change.contents = input.contents[change.path];
        }
    }
    for (const f of checkMigrations({
        changes,
        newestBaseTimestamp: input.newestBaseTimestamp,
    })) {
        findings.push(`${f.rule} ${f.path} ${f.message}`);
    }
    for (const change of changes) {
        if (isRelocation(change)) continue;
        if (
            (change.status === "added" || change.status === "renamed") &&
            change.contents !== undefined
        ) {
            for (const f of checkServiceRoleGrants(
                change.path,
                change.contents,
            )) {
                findings.push(`${f.rule} ${f.path} ${f.message}`);
            }
        }
    }

    return {
        ok: findings.length === 0,
        findings,
        policyPaths: input.files.filter(isPolicyPath).sort(),
        checkPaths: input.files.filter(isPrControlledCheckPath).sort(),
        summary: [
            `floor: ${lint.floor}`,
            `areas: ${lint.areas.length > 0 ? lint.areas.join(",") : "none"}`,
            `labels: ${lint.labels.length > 0 ? lint.labels.join(",") : "none"}`,
            `migration changes: ${changes.length}`,
        ],
    };
}

function newestBaseTimestamp(tree: string): string | null {
    const res = Bun.spawnSync({
        cmd: [
            "git",
            "ls-tree",
            "-r",
            "--name-only",
            tree,
            "--",
            MIGRATIONS_DIR,
            LEGACY_MIGRATIONS_DIR,
        ],
        stdout: "pipe",
        stderr: "pipe",
    });
    if (res.exitCode !== 0) {
        throw new Error(`git ls-tree ${tree} failed: ${res.stderr.toString()}`);
    }
    let max: string | null = null;
    for (const line of res.stdout.toString().split("\n")) {
        const ts = line.match(/(\d{14})_/)?.[1];
        if (ts && (max === null || ts > max)) max = ts;
    }
    return max;
}

/**
 * The notice for changed files that define the PR-controlled checks, or null.
 * Paths are JSON-quoted so a file name with a newline cannot start a workflow
 * command (`::…::`) on a line of its own in the log.
 */
export function checkPathsNotice(
    checkPaths: readonly string[],
): string[] | null {
    if (checkPaths.length === 0) return null;
    return [
        "!!! NOTICE: this PR changes files that define the checks judging it.",
        "!!! These change the checks that judge this PR; review them as such:",
        ...checkPaths.map((path) => `  ${JSON.stringify(path)}`),
    ];
}

async function main(): Promise<void> {
    const env = readPrEnv();
    const pr = await getPr(env);
    const prFiles = await getPrFiles(env);

    const contents: Record<string, string> = {};
    for (const f of prFiles) {
        if (!inMigrationDirs(f.filename) || !f.sha) continue;
        if (f.status === "removed") continue;
        contents[f.filename] = await getBlobText(env, f.sha);
    }

    const result = evaluatePolicy({
        title: pr.title,
        branch: pr.headRef,
        body: pr.body,
        author: pr.author,
        files: changedPaths(prFiles),
        prFiles,
        contents,
        newestBaseTimestamp: newestBaseTimestamp(
            process.env.NEWEST_BASE_TREE || "HEAD",
        ),
    });

    for (const line of result.summary) console.log(line);
    if (result.policyPaths.length > 0) {
        console.log(
            "This PR edits files that run from main. The edit takes effect after it merges; until then this PR is judged by main's copy:",
        );
        for (const path of result.policyPaths) {
            console.log(`  ${JSON.stringify(path)}`);
        }
    }
    for (const line of checkPathsNotice(result.checkPaths) ?? []) {
        console.log(line);
    }
    for (const finding of result.findings) console.log(finding);
    if (result.ok) console.log("Policy checks passed.");
    else process.exit(1);
}

if (import.meta.main) {
    try {
        await main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
