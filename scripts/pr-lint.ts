// The local PR conventions check: `bun run pr:check [body.md] [--title "<title>"]`.
//
// CI judges the conventions in the required `policy` check
// (scripts/conventions/policy.ts, main's copy of the rules). This runs the same
// rules on your working tree before you open the PR: the branch name, the
// files changed against origin/main, the body from a file and a title.
//
// The title is, in order: `--title`, the open PR's title for this branch
// (`gh pr view`), the subject of the latest commit. The one used is printed.

import { readFile } from "node:fs/promises";
import { lintPr } from "./conventions/conventions.ts";

export type PrCheckArgs = { bodyPath?: string; title?: string };

/**
 * `[body.md] [--title <title> | --title=<title>]`, in any order. The first
 * argument that is not a flag is the body file; a flag this script does not
 * know is ignored.
 */
export function parsePrCheckArgs(argv: readonly string[]): PrCheckArgs {
    const out: PrCheckArgs = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--title") {
            const value = argv[++i];
            if (value === undefined) {
                throw new Error("--title needs a value");
            }
            out.title = value;
        } else if (arg.startsWith("--title=")) {
            out.title = arg.slice("--title=".length);
        } else if (!arg.startsWith("--") && out.bodyPath === undefined) {
            out.bodyPath = arg;
        }
    }
    return out;
}

export type TitleSources = {
    /** The open PR's title for the current branch, or null when there is none. */
    prTitle: () => Promise<string | null>;
    /** The subject of the latest commit. */
    commitSubject: () => Promise<string>;
};

export async function resolveTitle(
    explicit: string | undefined,
    sources: TitleSources,
): Promise<{ title: string; from: string }> {
    if (explicit !== undefined) return { title: explicit, from: "--title" };
    const pr = await sources.prTitle();
    if (pr) return { title: pr, from: "the open PR" };
    return { title: await sources.commitSubject(), from: "the latest commit" };
}

async function run(
    cmd: string[],
): Promise<{ code: number; out: string; err: string }> {
    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    return { code, out: out.trim(), err };
}

async function git(args: string[]): Promise<string> {
    const { code, out, err } = await run(["git", ...args]);
    if (code !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${err}`);
    }
    return out;
}

async function openPrTitle(): Promise<string | null> {
    try {
        const { code, out } = await run([
            "gh",
            "pr",
            "view",
            "--json",
            "title,state",
        ]);
        if (code !== 0) return null;
        const pr = JSON.parse(out) as { title?: string; state?: string };
        return pr.state === "OPEN" && pr.title ? pr.title : null;
    } catch {
        // gh missing or not signed in
        return null;
    }
}

async function main(): Promise<void> {
    const args = parsePrCheckArgs(process.argv.slice(2));
    const body = args.bodyPath ? await readFile(args.bodyPath, "utf8") : "";
    const branch = await git(["branch", "--show-current"]);
    const diff = await git(["diff", "--name-only", "origin/main...HEAD"]);
    const files = diff ? diff.split("\n").filter(Boolean) : [];

    const { title, from } = await resolveTitle(args.title, {
        prTitle: openPrTitle,
        commitSubject: () => git(["log", "-1", "--format=%s"]),
    });
    console.log(`title (${from}): ${title}`);

    const fileContents: Record<string, string> = {};
    for (const path of files) {
        if (!path.startsWith("db/migrations/")) continue;
        try {
            fileContents[path] = await readFile(path, "utf8");
        } catch {
            // missing in checkout
        }
    }

    const result = lintPr({
        title,
        branch,
        body,
        files,
        fileContents:
            Object.keys(fileContents).length > 0 ? fileContents : undefined,
    });

    console.log(`floor: ${result.floor}`);
    console.log(
        `areas: ${result.areas.length > 0 ? result.areas.join(",") : "none"}`,
    );
    console.log(
        `labels: ${result.labels.length > 0 ? result.labels.join(",") : "none"}`,
    );

    for (const f of result.findings) {
        console.log(f.message);
    }

    if (result.findings.length > 0) {
        process.exit(1);
    }
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
