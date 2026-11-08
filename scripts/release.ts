// `bun run release [patch|minor|major] [--dry-run] [--yes]`
//
// Opens the release PR: bumps `version` in package.json on a
// chore/repo-release-<version> branch and opens `chore(repo): release
// <version>` with the PRs merged since the last tag. Merging it is the
// release: .github/workflows/release.yml tags and publishes on main.
//
// It runs locally, as you, on purpose. A PR opened by a workflow's
// GITHUB_TOKEN does not trigger the required checks, so it could never merge.

import { lintPr } from "./conventions/conventions.ts";

export type Level = "patch" | "minor" | "major";
export const LEVELS: readonly Level[] = ["patch", "minor", "major"];

export type MergedPr = { number: number; title: string; labels: string[] };

export function parseVersion(v: string): [number, number, number] {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
    if (!m) throw new Error(`Version "${v}" is not x.y.z`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function bumpVersion(v: string, level: Level): string {
    const [major, minor, patch] = parseVersion(v);
    if (level === "major") return `${major + 1}.0.0`;
    if (level === "minor") return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
}

// Areas a deploy never notices. A feature confined to them (a new script, a
// docs page) does not earn a minor bump on its own.
const NON_PRODUCT_AREAS = new Set([
    "area:repo",
    "area:docs",
    "area:test",
    "area:deps",
]);

// A PR with no area labels counts as product: an unlabelled PR is unknown,
// and over-suggesting minor is the safe mistake.
export function touchesProduct(labels: string[]): boolean {
    const areas = labels.filter((l) => l.startsWith("area:"));
    return areas.length === 0 || areas.some((a) => !NON_PRODUCT_AREAS.has(a));
}

// Before 1.0 a breaking change or a contract migration is a minor bump, and
// major is never suggested: 1.0.0 is a deliberate call, not a label count.
// From 1.0 on they are major.
export function suggestLevel(
    current: string,
    prs: MergedPr[],
): { level: Level; reason: string } {
    const [major] = parseVersion(current);
    const breaking = prs.filter(
        (p) =>
            p.labels.includes("breaking") ||
            p.labels.includes("migration:contract"),
    );
    if (breaking.length > 0) {
        const refs = breaking.map((p) => `#${p.number}`).join(", ");
        return {
            level: major === 0 ? "minor" : "major",
            reason: `breaking change or contract migration in ${refs}`,
        };
    }
    const feats = prs.filter(
        (p) => p.labels.includes("type:feat") && touchesProduct(p.labels),
    );
    if (feats.length > 0) {
        const refs = feats.map((p) => `#${p.number}`).join(", ");
        return { level: "minor", reason: `features in ${refs}` };
    }
    return {
        level: "patch",
        reason: "fixes, maintenance and tooling only",
    };
}

// Squash merges end their subject with "(#123)".
export function prNumbersFromLog(log: string): number[] {
    const out: number[] = [];
    for (const line of log.split("\n")) {
        const m = /\(#(\d+)\)\s*$/.exec(line.trim());
        if (m) out.push(Number(m[1]));
    }
    return out;
}

export function releaseBranch(version: string): string {
    return `chore/repo-release-${version.replaceAll(".", "-")}`;
}

export function releaseTitle(version: string): string {
    return `chore(repo): release ${version}`;
}

// Keeps the file's own formatting: only the first "version" value changes.
export function setPackageVersion(json: string, version: string): string {
    const re = /("version"\s*:\s*")[^"]*(")/;
    if (!re.test(json)) throw new Error("package.json has no version field");
    return json.replace(re, `$1${version}$2`);
}

export function releaseBody(input: {
    from: string;
    to: string;
    level: Level;
    reason: string;
    lastTag: string | null;
    prs: MergedPr[];
}): string {
    const { from, to, level, reason, lastTag, prs } = input;
    const has = (p: MergedPr, l: string) => p.labels.includes(l);
    const contracts = prs.filter((p) => has(p, "migration:contract"));
    const migrations = prs.filter((p) => has(p, "migration"));
    const line = (p: MergedPr) => `- ${p.title} (#${p.number})`;
    const since = lastTag ? `since \`${lastTag}\`` : "so far";

    const migrationText =
        migrations.length === 0
            ? "None in this PR or in the release."
            : `None in this PR. The release includes migrations from:\n\n${migrations.map(line).join("\n")}`;
    const contractText =
        contracts.length === 0
            ? "None in this PR or in the release."
            : `None in this PR. The release includes contract migrations; forks should back up before updating:\n\n${contracts.map(line).join("\n")}`;

    return `## Summary

Release ${to}: bumps \`package.json\` from ${from} (${level}: ${reason}). Merging this tags \`v${to}\` and publishes the GitHub release.

## Blast radius

Level: high
Affects: \`package.json\` version only; the MCP \`serverInfo.version\` follows it.
What could break: nothing at runtime. Forks that update to \`v${to}\` take every change listed below.
Rollback: revert-safe

## Changes

${prs.length} PR${prs.length === 1 ? "" : "s"} merged ${since}:

${prs.map(line).join("\n")}

## Migrations

${migrationText}

## Contracts

${contractText}

## Testing

Version bump only. CI runs the full suite on this PR.

## Planner

None.

## Links

None.
`;
}

type GhPr = { number: number; title: string; labels: { name: string }[] };

// Loads the PRs named in the log. One `gh pr list` covers the PRs merged into
// main; a PR merged into a stacked branch that later landed on main is not in
// that list, so each one still missing is fetched on its own.
export async function loadMergedPrs(
    numbers: number[],
    gh: (args: string[]) => Promise<string>,
): Promise<MergedPr[]> {
    const listed = JSON.parse(
        await gh([
            "pr",
            "list",
            "--state",
            "merged",
            "--base",
            "main",
            "--limit",
            String(Math.max(100, numbers.length * 2)),
            "--json",
            "number,title,labels",
        ]),
    ) as GhPr[];
    const byNumber = new Map(listed.map((p) => [p.number, p]));
    const prs: MergedPr[] = [];
    for (const n of numbers) {
        let p = byNumber.get(n);
        if (!p) {
            try {
                p = JSON.parse(
                    await gh([
                        "pr",
                        "view",
                        String(n),
                        "--json",
                        "number,title,labels",
                    ]),
                ) as GhPr;
            } catch {
                throw new Error(`Could not load PR #${n} from GitHub`);
            }
        }
        prs.push({
            number: n,
            title: p.title,
            labels: p.labels.map((l) => l.name),
        });
    }
    return prs;
}

async function run(cmd: string[], opts: { quiet?: boolean } = {}) {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    if (code !== 0) {
        throw new Error(`${cmd.join(" ")} failed:\n${err || out}`);
    }
    if (!opts.quiet && err.trim()) console.error(err.trim());
    return out.trim();
}

async function main(argv: string[]): Promise<void> {
    const dryRun = argv.includes("--dry-run");
    const yes = argv.includes("--yes");
    const positional = argv.filter((a) => !a.startsWith("--"));
    const explicit = positional[0];
    if (explicit && !(LEVELS as readonly string[]).includes(explicit)) {
        throw new Error(`Level must be one of ${LEVELS.join(", ")}`);
    }

    const branch = await run(["git", "branch", "--show-current"]);
    if (branch !== "main") throw new Error(`Run this on main, not ${branch}`);
    if (await run(["git", "status", "--porcelain"])) {
        throw new Error("Working tree is not clean");
    }
    await run(["git", "fetch", "--quiet", "--tags", "origin", "main"], {
        quiet: true,
    });
    const head = await run(["git", "rev-parse", "HEAD"]);
    if (head !== (await run(["git", "rev-parse", "origin/main"]))) {
        throw new Error("Local main is not origin/main; pull first");
    }

    const pkgFile = Bun.file("package.json");
    const pkgText = await pkgFile.text();
    const current = (JSON.parse(pkgText) as { version: string }).version;

    let lastTag: string | null = null;
    try {
        lastTag = await run([
            "git",
            "describe",
            "--tags",
            "--abbrev=0",
            "--match",
            "v[0-9]*",
        ]);
    } catch {
        lastTag = null;
    }
    if (lastTag && lastTag !== `v${current}`) {
        throw new Error(
            `package.json is ${current} but the last tag is ${lastTag}; ` +
                "has the previous release been published?",
        );
    }

    const log = await run([
        "git",
        "log",
        "--format=%s",
        lastTag ? `${lastTag}..HEAD` : "HEAD",
    ]);
    const numbers = prNumbersFromLog(log);
    if (numbers.length === 0) {
        console.log(`Nothing merged since ${lastTag ?? "the start"}.`);
        return;
    }
    const prs = await loadMergedPrs(numbers, (args) => run(["gh", ...args]));

    const suggestion = suggestLevel(current, prs);
    const level = (explicit as Level | undefined) ?? suggestion.level;
    const reason = explicit
        ? `chosen; suggested ${suggestion.level} (${suggestion.reason})`
        : suggestion.reason;
    const next = bumpVersion(current, level);
    const newBranch = releaseBranch(next);
    const title = releaseTitle(next);
    const body = releaseBody({
        from: current,
        to: next,
        level,
        reason,
        lastTag,
        prs,
    });

    const lint = lintPr({
        title,
        branch: newBranch,
        body,
        files: ["package.json"],
    });
    if (lint.findings.length > 0) {
        throw new Error(
            "Release PR would fail pr:check:\n" +
                lint.findings.map((f) => `- ${f.message}`).join("\n"),
        );
    }

    console.log(`${current} → ${next} (${level}: ${reason})`);
    console.log(
        `${prs.length} PR${prs.length === 1 ? "" : "s"} since ${lastTag ?? "the start"}`,
    );
    if (dryRun) {
        console.log(`\n${title}\n${newBranch}\n\n${body}`);
        return;
    }
    if (!yes) {
        const answer = prompt(`Open ${title}? [y/N]`);
        if (answer?.trim().toLowerCase() !== "y") {
            console.log("Aborted.");
            return;
        }
    }

    await run(["git", "switch", "-c", newBranch]);
    await Bun.write(pkgFile, setPackageVersion(pkgText, next));
    await run(["git", "commit", "-q", "-m", title, "--", "package.json"]);
    await run(["git", "push", "-q", "-u", "origin", newBranch]);
    const url = await run([
        "gh",
        "pr",
        "create",
        "--base",
        "main",
        "--title",
        title,
        "--body",
        body,
    ]);
    console.log(url);
    console.log(
        "Add gate:approved and merge; the Release workflow does the rest.",
    );
}

if (import.meta.main) {
    main(process.argv.slice(2)).catch((err: unknown) => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    });
}
