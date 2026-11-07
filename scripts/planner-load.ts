// Reads the planner/ folder's files, either from the working tree or from a
// git commit, as a { path: contents } map for parsePlanner.
import { readdir } from "fs/promises";
import { join, relative } from "path";
import { PLANNER_DIR } from "./conventions/planner.ts";

const root = join(import.meta.dir, "..");

export async function readPlannerTree(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const dir = join(root, PLANNER_DIR);
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true, recursive: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        if (!entry.isFile()) continue;
        const abs = join(entry.parentPath, entry.name);
        out[relative(root, abs)] = await Bun.file(abs).text();
    }
    return out;
}

async function git(args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    if (code !== 0)
        throw new Error(`git ${args.join(" ")} failed: ${err.trim()}`);
    return out;
}

export async function readPlannerAt(
    ref: string,
): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const list = await git([
        "ls-tree",
        "-r",
        "--name-only",
        ref,
        "--",
        `${PLANNER_DIR}/`,
    ]);
    for (const path of list.split("\n").filter(Boolean)) {
        out[path] = await git(["show", `${ref}:${path}`]);
    }
    return out;
}
