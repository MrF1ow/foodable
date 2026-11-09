import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { lstat, readlink, readdir } from "fs/promises";
import { join, resolve } from "path";
import { parseWatches } from "./skill-watches.js";

const root = join(import.meta.dir, "../..");
const skillsRoot = join(root, ".claude/skills");

function parseFrontmatter(text: string): {
    name?: string;
    description?: string;
} {
    const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
    if (block === undefined) return {};
    const out: { name?: string; description?: string } = {};
    for (const line of block.split("\n")) {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (!m?.[1] || m[2] === undefined) continue;
        const key = m[1];
        let value = m[2].trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (key === "name") out.name = value;
        if (key === "description") out.description = value;
    }
    return out;
}

function extractBunRunScripts(text: string): string[] {
    const scripts = new Set<string>();
    for (const m of text.matchAll(/bun run ([a-zA-Z0-9:_-]+)/g)) {
        if (m[1]) scripts.add(m[1]);
    }
    return [...scripts];
}

function looksLikeRepoPath(candidate: string): boolean {
    if (!candidate || candidate.includes(" ")) return false;
    if (/^https?:\/\//.test(candidate)) return false;
    if (/^[a-z]+:/.test(candidate)) return false;
    if (candidate.startsWith("<") || candidate.includes("*")) return false;
    if (candidate.includes("/")) return true;
    return /\.(md|ts|tsx|js|json|sql|yml|yaml)$/i.test(candidate);
}

function normalizeRepoPath(raw: string): string {
    let p = raw.trim();
    if (p.startsWith("./")) p = p.slice(2);
    p = p.split("#")[0] ?? p;
    while (p.endsWith("/") && p.length > 1) {
        p = p.slice(0, -1);
    }
    return p;
}

function extractRepoPaths(text: string): string[] {
    const paths = new Set<string>();
    for (const m of text.matchAll(/`([^`]+)`/g)) {
        const s = (m[1] ?? "").trim();
        if (s.startsWith("bun ")) continue;
        if (looksLikeRepoPath(s)) paths.add(normalizeRepoPath(s));
    }
    for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const s = (m[1] ?? "").trim();
        if (looksLikeRepoPath(s)) paths.add(normalizeRepoPath(s));
    }
    return [...paths];
}

async function skillMarkdownPaths(): Promise<string[]> {
    const entries = await readdir(skillsRoot, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        files.push(join(skillsRoot, entry.name, "SKILL.md"));
    }
    return files;
}

describe("agent doc symlinks", () => {
    test("AGENTS.md is a symlink to CLAUDE.md", async () => {
        const agentsPath = join(root, "AGENTS.md");
        const st = await lstat(agentsPath);
        expect(st.isSymbolicLink()).toBe(true);
        const target = await readlink(agentsPath);
        const resolved = resolve(root, target);
        expect(resolved).toBe(resolve(root, "CLAUDE.md"));
        expect(existsSync(resolved)).toBe(true);
    });

    test(".agents/skills is a symlink to .claude/skills", async () => {
        const linkPath = join(root, ".agents/skills");
        const st = await lstat(linkPath);
        expect(st.isSymbolicLink()).toBe(true);
        const target = await readlink(linkPath);
        const resolved = resolve(join(root, ".agents"), target);
        expect(resolved).toBe(resolve(skillsRoot));
        expect(existsSync(resolved)).toBe(true);
    });
});

describe("skill frontmatter", () => {
    test("each skill name matches its folder and has a description", async () => {
        const entries = await readdir(skillsRoot, { withFileTypes: true });
        const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
        expect(dirs.length).toBeGreaterThan(0);
        for (const dir of dirs) {
            const text = await Bun.file(
                join(skillsRoot, dir, "SKILL.md"),
            ).text();
            const fm = parseFrontmatter(text);
            expect(fm.name).toBe(dir);
            expect(fm.description?.trim().length).toBeGreaterThan(0);
        }
    });
});

describe("skill references", () => {
    test("every bun run script and repo path in skills exists", async () => {
        const pkg = JSON.parse(
            await Bun.file(join(root, "package.json")).text(),
        ) as { scripts?: Record<string, string> };
        const scripts = pkg.scripts ?? {};

        for (const skillPath of await skillMarkdownPaths()) {
            const text = await Bun.file(skillPath).text();
            for (const script of extractBunRunScripts(text)) {
                expect(scripts[script]).toBeDefined();
            }
            for (const repoPath of extractRepoPaths(text)) {
                const abs = join(root, repoPath);
                expect(existsSync(abs)).toBe(true);
            }
        }
    });
});

function trackedFiles(): string[] {
    const res = Bun.spawnSync(["git", "ls-files"], { cwd: root });
    if (res.exitCode !== 0) throw new Error(res.stderr.toString());
    return res.stdout.toString().split("\n").filter(Boolean);
}

describe("skill watches", () => {
    test("parseWatches reads a block list and nothing else", () => {
        const text = [
            "---",
            "name: x",
            "watches:",
            "    - package.json",
            '    - "scripts/a*.ts"',
            "",
            "    - src/**",
            "other: y",
            "---",
            "- not.a.watch",
        ].join("\n");
        expect(parseWatches(text)).toEqual([
            "package.json",
            "scripts/a*.ts",
            "src/**",
        ]);
        expect(parseWatches("---\nname: x\n---\nbody")).toEqual([]);
        expect(parseWatches("no frontmatter")).toEqual([]);
    });

    test("parseWatches accepts zero-indent, comments, flow style and a BOM", () => {
        const fm = (...l: string[]) =>
            ["---", "name: x", ...l, "---"].join("\n");
        expect(parseWatches(fm("watches:", "- a.ts", "- b/**"))).toEqual([
            "a.ts",
            "b/**",
        ]);
        expect(
            parseWatches(
                fm("watches:", "  - a.ts", "  # note", "", "  - b.ts", "k: v"),
            ),
        ).toEqual(["a.ts", "b.ts"]);
        expect(parseWatches(fm("watches: [a.ts, 'b/*.ts']"))).toEqual([
            "a.ts",
            "b/*.ts",
        ]);
        expect(parseWatches("﻿" + fm("watches:", "  - a.ts"))).toEqual([
            "a.ts",
        ]);
        expect(parseWatches(fm("watches: # why", "  - a.ts"))).toEqual([
            "a.ts",
        ]);
    });

    test("parseWatches throws instead of returning a short list", () => {
        const fm = (...l: string[]) =>
            ["---", "name: x", ...l, "---"].join("\n");
        expect(() => parseWatches(fm("watches:"))).toThrow(/empty/);
        expect(() => parseWatches(fm("watches:", "k: v"))).toThrow(/empty/);
        expect(() => parseWatches(fm("watches: []"))).toThrow(/empty/);
        expect(() => parseWatches(fm("watches: a.ts"))).toThrow(
            /block list or/,
        );
        expect(() => parseWatches(fm("watches:", "  -a.ts"))).toThrow(
            /not "- item"/,
        );
        expect(() =>
            parseWatches(fm("watches:", "  - a.ts", "  b.ts", "  - c.ts")),
        ).toThrow(/stopped at "b.ts"/);
    });

    test("every watched path or glob matches a tracked file", async () => {
        const files = trackedFiles();
        for (const skillPath of await skillMarkdownPaths()) {
            const watches = parseWatches(await Bun.file(skillPath).text());
            for (const entry of watches) {
                const glob = new Bun.Glob(entry);
                const hit = files.some((f) => glob.match(f));
                if (!hit) {
                    throw new Error(
                        `${skillPath}: watches entry "${entry}" matches no tracked file`,
                    );
                }
            }
        }
    });

    test("foodable-test declares a non-empty watches list", async () => {
        const text = await Bun.file(
            join(skillsRoot, "foodable-test", "SKILL.md"),
        ).text();
        expect(parseWatches(text).length).toBeGreaterThan(0);
    });
});
