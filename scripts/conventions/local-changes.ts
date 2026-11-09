// What changed in the working tree, for the local runs of the policy scripts.
// Same definition `bun run check:changed` uses: committed on this branch since
// `base` ∪ uncommitted ∪ untracked, with renames split into delete + add.

export const DEFAULT_BASE = "origin/main";

function git(args: string[]): string[] {
    const proc = Bun.spawnSync(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
    });
    if (proc.exitCode !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${proc.stderr.toString().trim()}`,
        );
    }
    return proc.stdout
        .toString()
        .split("\n")
        .filter((line) => line !== "");
}

export function gatherChangedPaths(base: string = DEFAULT_BASE): string[] {
    return [
        ...new Set([
            ...git(["diff", "--name-only", "--no-renames", `${base}...HEAD`]),
            ...git(["diff", "--name-only", "--no-renames", "HEAD"]),
            ...git(["ls-files", "--others", "--exclude-standard"]),
        ]),
    ];
}

/** `--base <ref>` / `--base=<ref>` from argv, else the default. */
export function baseFromArgs(argv: readonly string[]): string {
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--base") {
            const value = argv[i + 1];
            if (!value) throw new Error("--base needs a ref");
            return value;
        }
        if (arg.startsWith("--base=")) return arg.slice("--base=".length);
    }
    return DEFAULT_BASE;
}

/** The commit the working branch forked from `base` (what `base...HEAD` diffs against). */
export function mergeBase(base: string = DEFAULT_BASE): string {
    return git(["merge-base", base, "HEAD"])[0] ?? base;
}

/** A file's text at a revision, or null when it does not exist there. */
export function readAtRev(rev: string, path: string): string | null {
    const proc = Bun.spawnSync(["git", "show", `${rev}:${path}`], {
        stdout: "pipe",
        stderr: "pipe",
    });
    return proc.exitCode === 0 ? proc.stdout.toString() : null;
}

/** A file's text in the working tree, or null when it does not exist. */
export async function readWorkingTree(path: string): Promise<string | null> {
    const file = Bun.file(path);
    return (await file.exists()) ? file.text() : null;
}
