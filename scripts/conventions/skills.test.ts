import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { lstat, readlink, readdir } from "fs/promises";
import { join, resolve } from "path";

const root = join(import.meta.dir, "../..");
const skillsRoot = join(root, ".claude/skills");

function parseFrontmatter(text: string): {
    name?: string;
    description?: string;
} {
    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const out: { name?: string; description?: string } = {};
    for (const line of match[1].split("\n")) {
        const m = line.match(/^(\w+):\s*(.+)$/);
        if (!m) continue;
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
        scripts.add(m[1]);
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
    p = p.split("#")[0];
    while (p.endsWith("/") && p.length > 1) {
        p = p.slice(0, -1);
    }
    return p;
}

function extractRepoPaths(text: string): string[] {
    const paths = new Set<string>();
    for (const m of text.matchAll(/`([^`]+)`/g)) {
        const s = m[1].trim();
        if (s.startsWith("bun ")) continue;
        if (looksLikeRepoPath(s)) paths.add(normalizeRepoPath(s));
    }
    for (const m of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const s = m[1].trim();
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
