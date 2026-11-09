// Agent context budget. CLAUDE.md and every skill are read into an agent's
// context on each session, so they only get to grow on purpose. The baseline
// (.github/agent-context-budget.json) records their size in bytes: CLAUDE.md as
// one file, and each .claude/skills/<name> folder as the sum of the files in
// it. A pull request that pushes an entry it changes past the baseline fails
// (entries it does not touch are not judged, so a stale branch is not blamed
// for a trim on main), unless it carries the `agent-context-increase` label. A new skill folder is not in the
// baseline, so it counts as over. With the label, the PR must also commit a
// baseline that covers its sizes, or the next PR would start from the old one
// and fail for growth it did not cause.
//
//   bun run scripts/conventions/context-budget.ts          check
//   bun run scripts/conventions/context-budget.ts --write  rewrite the baseline
//
// In CI (policy.yml, `pull_request_target`) it runs from the base checkout:
// the baseline is the base's, so a PR cannot raise its own budget, and the
// sizes at the PR head come from the git tree through the API (GH_TOKEN, REPO,
// PR_NUMBER), so no PR code runs. Locally the sizes come from the working tree
// and the label from `--label agent-context-increase`. Only tracked files
// count, locally as in CI, so scratch files never reach the baseline.
//
// AGENTS.md is a symlink to CLAUDE.md and .agents/skills one to .claude/skills,
// so neither is counted again; symlinks inside a skill folder are skipped too.

import { lstatSync } from "node:fs";
import { join } from "node:path";
import {
    changedPaths,
    getFileText,
    getPr,
    getPrFiles,
    getTree,
    hasPrEnv,
    readPrEnv,
    type TreeEntry,
} from "./github.ts";
import { baseFromArgs, gatherChangedPaths } from "./local-changes.ts";

export const INCREASE_LABEL = "agent-context-increase";
export const BASELINE_PATH = ".github/agent-context-budget.json";
export const CLAUDE_MD = "CLAUDE.md";
export const SKILLS_DIR = ".claude/skills";

/** key (`CLAUDE.md` or `.claude/skills/<name>`) → bytes. */
export type Sizes = Record<string, number>;

export type Over = {
    key: string;
    size: number;
    /** null when the entry is not in the baseline (a new skill). */
    baseline: number | null;
};

/** The budget key a path counts toward, or null when it counts toward none. */
export function budgetKey(path: string): string | null {
    if (path === CLAUDE_MD) return CLAUDE_MD;
    const skills = `${SKILLS_DIR}/`;
    if (!path.startsWith(skills)) return null;
    const rest = path.slice(skills.length);
    if (!rest.includes("/")) return null;
    return `${skills}${rest.split("/")[0]}`;
}

/**
 * `touched`, when given, limits the check to the keys the PR changes a file
 * under: a branch that never edited CLAUDE.md is not blamed for a CLAUDE.md
 * that main has since trimmed below the size the branch still carries.
 */
export function budgetCheck(
    sizes: Sizes,
    baseline: Sizes,
    labels: readonly string[],
    touched?: ReadonlySet<string>,
): { ok: boolean; over: Over[]; labelled: boolean } {
    const over: Over[] = [];
    for (const key of Object.keys(sizes).sort()) {
        if (touched && !touched.has(key)) continue;
        const size = sizes[key]!;
        const limit = baseline[key];
        if (limit === undefined) over.push({ key, size, baseline: null });
        else if (size > limit) over.push({ key, size, baseline: limit });
    }
    const labelled = labels.includes(INCREASE_LABEL);
    return { ok: over.length === 0 || labelled, over, labelled };
}

export function overMessage(o: Over): string {
    return o.baseline === null
        ? `${o.key} is new (${o.size} bytes) and is not in the baseline`
        : `${o.key} grew from ${o.baseline} to ${o.size} bytes (+${o.size - o.baseline})`;
}

/** Sizes from tree entries (the API's git tree, or any equivalent list). */
export function sizesFromTree(entries: readonly TreeEntry[]): Sizes {
    const sizes: Sizes = {};
    const skills = `${SKILLS_DIR}/`;
    for (const e of entries) {
        // Blobs only; mode 120000 is a symlink, whose "size" is its target text.
        if (e.type !== "blob" || e.mode === "120000") continue;
        const size = e.size ?? 0;
        if (e.path === CLAUDE_MD) {
            sizes[CLAUDE_MD] = size;
        } else if (e.path.startsWith(skills)) {
            const name = e.path.slice(skills.length).split("/")[0]!;
            // A loose file directly under skills/ is not a skill folder.
            if (!e.path.slice(skills.length).includes("/")) continue;
            const key = `${skills}${name}`;
            sizes[key] = (sizes[key] ?? 0) + size;
        }
    }
    return sizes;
}

/**
 * Sizes of the tracked files under `root` (`git ls-files`, so untracked and
 * ignored scratch files never count), measured in the working tree. The same
 * rules as `sizesFromTree`: symlinks skipped, a skill folder summed.
 */
export function sizesFromDisk(root: string): Sizes {
    const proc = Bun.spawnSync(
        ["git", "ls-files", "-s", "-z", "--", CLAUDE_MD, SKILLS_DIR],
        { cwd: root, stdout: "pipe", stderr: "pipe" },
    );
    if (proc.exitCode !== 0) {
        throw new Error(
            `git ls-files failed: ${proc.stderr.toString().trim()}`,
        );
    }
    const entries: TreeEntry[] = [];
    for (const line of proc.stdout.toString().split("\0")) {
        // `<mode> <sha> <stage>\t<path>`
        const m = line.match(/^(\d+) \S+ \d+\t(.+)$/);
        if (!m) continue;
        const [, mode, path] = m as unknown as [string, string, string];
        if (mode === "120000" || mode === "160000") continue;
        // A tracked file deleted in the working tree has no size to count.
        const st = lstatSync(join(root, path), { throwIfNoEntry: false });
        if (!st || !st.isFile()) continue;
        entries.push({ path, mode, type: "blob", size: st.size });
    }
    return sizesFromTree(entries);
}

export const REGENERATE_HINT =
    "Run `bun run scripts/conventions/context-budget.ts --write` and commit the result, so the next PR starts from the new sizes.";

/**
 * Problems with the baseline a labelled PR committed at its head (null = the
 * file is missing there): it must cover every size, or the next PR starts from
 * the old numbers and fails for growth it did not cause. Empty when it does.
 */
export function baselineProblems(
    sizes: Sizes,
    committed: Sizes | null,
): string[] {
    if (committed === null) {
        return [
            `${BASELINE_PATH} is missing at the PR head. ${REGENERATE_HINT}`,
        ];
    }
    const gaps = budgetCheck(sizes, committed, []).over;
    if (gaps.length === 0) return [];
    return [
        ...gaps.map(
            (o) =>
                `${BASELINE_PATH} at the PR head is behind: ${
                    o.baseline === null
                        ? `${o.key} is not in it (${o.size} bytes)`
                        : `${o.key} is ${o.size} bytes, it allows ${o.baseline}`
                }`,
        ),
        REGENERATE_HINT,
    ];
}

export function serializeBaseline(sizes: Sizes): string {
    const sorted = Object.fromEntries(
        Object.entries(sizes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    return JSON.stringify({ bytes: sorted }, null, 4) + "\n";
}

export function parseBaseline(text: string): Sizes {
    const data = JSON.parse(text) as { bytes?: Sizes };
    if (!data.bytes || typeof data.bytes !== "object") {
        throw new Error(`${BASELINE_PATH}: expected {"bytes": {…}}`);
    }
    for (const [key, value] of Object.entries(data.bytes)) {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`${BASELINE_PATH}: ${key} is not a byte count`);
        }
    }
    return data.bytes;
}

function argValues(argv: readonly string[], flag: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === flag && argv[i + 1]) out.push(argv[++i]!);
        else if (argv[i]!.startsWith(`${flag}=`))
            out.push(argv[i]!.slice(flag.length + 1));
    }
    return out;
}

function touchedKeys(paths: readonly string[]): Set<string> {
    const keys = new Set<string>();
    for (const p of paths) {
        const k = budgetKey(p);
        if (k) keys.add(k);
    }
    return keys;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const root = process.cwd();

    if (argv.includes("--write")) {
        const sizes = sizesFromDisk(root);
        await Bun.write(join(root, BASELINE_PATH), serializeBaseline(sizes));
        console.log(`Wrote ${BASELINE_PATH}:`);
        for (const [k, v] of Object.entries(sizes)) console.log(`  ${k} ${v}`);
        return;
    }

    const baseline = parseBaseline(
        await Bun.file(join(root, BASELINE_PATH)).text(),
    );
    let sizes: Sizes;
    let labels: string[];
    let touched: Set<string>;
    let headBaseline: () => Promise<Sizes | null> = async () => null;
    if (hasPrEnv()) {
        const env = readPrEnv();
        const pr = await getPr(env);
        sizes = sizesFromTree(await getTree(env, pr.headSha));
        labels = pr.labels;
        touched = touchedKeys(changedPaths(await getPrFiles(env)));
        headBaseline = async () => {
            const text = await getFileText(env, BASELINE_PATH, pr.headSha);
            return text === null ? null : parseBaseline(text);
        };
        console.log(
            `context-budget: sizes at ${pr.headSha.slice(0, 7)} from the API, baseline from the base checkout`,
        );
    } else {
        sizes = sizesFromDisk(root);
        labels = argValues(argv, "--label");
        touched = touchedKeys(gatherChangedPaths(baseFromArgs(argv)));
        console.log(
            "context-budget: sizes from the working tree, baseline from the working tree",
        );
    }

    const result = budgetCheck(sizes, baseline, labels, touched);
    for (const [k, v] of Object.entries(sizes)) {
        const limit = baseline[k];
        console.log(`  ${k}: ${v} bytes (baseline ${limit ?? "none"})`);
    }
    for (const o of result.over) console.log(overMessage(o));
    if (result.over.length === 0) {
        console.log("Within the agent context budget.");
    } else if (result.labelled) {
        console.log(`Over budget, allowed by the ${INCREASE_LABEL} label.`);
        if (hasPrEnv()) {
            const problems = baselineProblems(sizes, await headBaseline());
            for (const line of problems) console.log(line);
            if (problems.length > 0) process.exit(1);
            console.log(
                `${BASELINE_PATH} at the PR head covers the new sizes.`,
            );
        } else {
            console.log(`Locally: ${REGENERATE_HINT}`);
        }
    } else {
        console.log(
            `Over the agent context budget. Trim the text, or ask for the ${INCREASE_LABEL} label and regenerate the baseline in the same PR (bun run scripts/conventions/context-budget.ts --write).`,
        );
    }
    if (!result.ok) process.exit(1);
}

if (import.meta.main) {
    try {
        await main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
