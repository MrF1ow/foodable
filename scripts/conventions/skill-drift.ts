// Skill drift. A skill lists the files it describes in its frontmatter
// `watches:`. A pull request that changes one of them without touching the
// skill leaves the skill describing code that moved, so this check fails it.
//
//   bun run scripts/conventions/skill-drift.ts [--base <ref>]
//
// In CI (policy.yml, `pull_request_target`) it runs from the base checkout and
// reads the PR through the API (GH_TOKEN, REPO, PR_NUMBER): the skills'
// `watches:` come from the base tree, so a PR cannot loosen its own watches.
// Locally (no PR env) the changed paths come from git, like check:changed, and
// the skills from the working tree.
//
// A watch can name one top-level JSON key: `package.json#scripts` matches only
// when that key's value differs between the PR's merge base and its head (a
// file added or deleted counts as differing). A release PR that only bumps
// `version` therefore leaves a skill that watches `package.json#scripts` alone.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
    changedPaths,
    getFileText,
    getMergeBase,
    getPr,
    getPrFiles,
    hasPrEnv,
    readPrEnv,
} from "./github.ts";
import {
    baseFromArgs,
    gatherChangedPaths,
    mergeBase,
    readAtRev,
    readWorkingTree,
} from "./local-changes.ts";
import { parseWatches } from "./skill-watches.ts";

export const SKILLS_DIR = ".claude/skills";

export type Skill = {
    name: string;
    /** Repo-relative folder, e.g. `.claude/skills/foodable-test`. */
    dir: string;
    watches: string[];
};

export type DriftFinding = {
    skill: string;
    dir: string;
    /** The changed paths that matched a watch. */
    changed: string[];
};

/** True when `key` of the JSON file at `path` differs between base and head. */
export type KeyChanged = (path: string, key: string) => boolean;

/** A watch entry: a path or glob, optionally `#<json key>`. */
export function splitWatch(entry: string): { glob: string; key?: string } {
    const at = entry.lastIndexOf("#");
    if (at < 0) return { glob: entry };
    return { glob: entry.slice(0, at), key: entry.slice(at + 1) };
}

/**
 * Whether the top-level `key` differs between two file contents (null = the
 * file does not exist on that side). An added or deleted file, or JSON that
 * does not parse, counts as changed: when unsure, ask for the skill update.
 */
export function jsonKeyDiffers(
    base: string | null,
    head: string | null,
    key: string,
): boolean {
    if (base === null || head === null) return base !== head;
    try {
        const a = (JSON.parse(base) as Record<string, unknown> | null)?.[key];
        const b = (JSON.parse(head) as Record<string, unknown> | null)?.[key];
        return !Bun.deepEquals(a, b, true);
    } catch {
        return true;
    }
}

/** Reads a file at the merge base (`"base"`) or the PR head (`"head"`); null when absent. */
export type FileReader = (
    path: string,
    side: "base" | "head",
) => Promise<string | null>;

/**
 * Resolves every `path#key` watch that a changed path matches, reading only
 * those files. The result is the synchronous lookup `skillDrift` takes.
 */
export async function resolveKeyChanges(
    changed: readonly string[],
    skills: readonly Skill[],
    read: FileReader,
): Promise<KeyChanged> {
    const wanted = new Set<string>();
    for (const skill of skills) {
        for (const w of skill.watches) {
            const { glob, key } = splitWatch(w);
            if (key === undefined) continue;
            const matcher = new Bun.Glob(glob);
            for (const path of changed) {
                if (matcher.match(path)) wanted.add(`${path}#${key}`);
            }
        }
    }
    const results = new Map<string, boolean>();
    for (const id of wanted) {
        const at = id.lastIndexOf("#");
        const path = id.slice(0, at);
        const [base, head] = await Promise.all([
            read(path, "base"),
            read(path, "head"),
        ]);
        results.set(id, jsonKeyDiffers(base, head, id.slice(at + 1)));
    }
    return (path, key) => results.get(`${path}#${key}`) ?? true;
}

export function skillDrift(
    changed: readonly string[],
    skills: readonly Skill[],
    keyChanged: KeyChanged = () => true,
): DriftFinding[] {
    const findings: DriftFinding[] = [];
    for (const skill of skills) {
        const matchers = skill.watches.map((w) => {
            const { glob, key } = splitWatch(w);
            return { glob: new Bun.Glob(glob), key };
        });
        const hits = changed.filter((path) =>
            matchers.some(
                (m) =>
                    m.glob.match(path) &&
                    (m.key === undefined || keyChanged(path, m.key)),
            ),
        );
        if (hits.length === 0) continue;
        const touched = changed.some((p) => p.startsWith(`${skill.dir}/`));
        if (!touched) {
            findings.push({
                skill: skill.name,
                dir: skill.dir,
                changed: [...hits].sort(),
            });
        }
    }
    return findings;
}

/**
 * Authors whose PRs skip the drift check. Dependabot bumps files a skill
 * watches (the Dockerfile's base image, package.json, workflow action pins)
 * and cannot edit a skill, so the check would fail every such bump.
 */
const SKIP_AUTHORS: readonly string[] = ["dependabot[bot]"];

export function skipsSkillDrift(author: string): boolean {
    return SKIP_AUTHORS.includes(author);
}

export function driftMessage(f: DriftFinding): string {
    return `skill ${f.skill} watches ${f.changed.join(", ")}, which changed without ${f.dir}/ changing. Update the skill (or its watches: list) in the same PR.`;
}

/** Skills from `<root>/.claude/skills/<name>/SKILL.md`, in name order. */
export async function loadSkills(root: string): Promise<Skill[]> {
    const skillsRoot = join(root, SKILLS_DIR);
    const names = readdirSync(skillsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    const skills: Skill[] = [];
    for (const name of names) {
        const file = Bun.file(join(skillsRoot, name, "SKILL.md"));
        if (!(await file.exists())) continue;
        skills.push({
            name,
            dir: `${SKILLS_DIR}/${name}`,
            watches: parseWatches(await file.text()),
        });
    }
    return skills;
}

async function main(): Promise<void> {
    const skills = await loadSkills(process.cwd());
    let changed: string[];
    let read: FileReader;
    if (hasPrEnv()) {
        const env = readPrEnv();
        const pr = await getPr(env);
        if (skipsSkillDrift(pr.author)) {
            console.log(`skill-drift: skipped for PRs by ${pr.author}`);
            return;
        }
        changed = changedPaths(await getPrFiles(env));
        const base = await getMergeBase(env, pr.baseSha, pr.headSha);
        read = (path, side) =>
            getFileText(env, path, side === "base" ? base : pr.headSha);
        console.log(
            `skill-drift: ${changed.length} changed paths from the API, skills from the base checkout`,
        );
    } else {
        const baseRef = baseFromArgs(process.argv.slice(2));
        changed = gatherChangedPaths(baseRef);
        const base = mergeBase(baseRef);
        read = async (path, side) =>
            side === "base" ? readAtRev(base, path) : readWorkingTree(path);
        console.log(
            `skill-drift: ${changed.length} changed paths vs ${baseRef} (committed, uncommitted, untracked), skills from the working tree`,
        );
    }
    const keyChanged = await resolveKeyChanges(changed, skills, read);
    const findings = skillDrift(changed, skills, keyChanged);
    for (const f of findings) console.log(driftMessage(f));
    if (findings.length === 0) console.log("No skill drift.");
    if (findings.length > 0) process.exit(1);
}

if (import.meta.main) {
    try {
        await main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
