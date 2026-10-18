import { readFile } from "node:fs/promises";
import { lintPr } from "./conventions/conventions.ts";

async function git(args: string[]): Promise<string> {
    const proc = Bun.spawn(["git", ...args], {
        stdout: "pipe",
        stderr: "pipe",
    });
    const code = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    if (code !== 0) {
        throw new Error(`git ${args.join(" ")} failed: ${err}`);
    }
    return out.trim();
}

async function main(): Promise<void> {
    let title = "";
    let body = "";
    let branch = "";
    let author: string | undefined;
    let files: string[] = [];

    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
        const raw = await readFile(eventPath, "utf8");
        const event = JSON.parse(raw) as {
            pull_request: {
                title: string;
                body: string | null;
                user: { login: string };
                head: { ref: string };
                base: { ref: string };
            };
        };
        title = event.pull_request.title;
        body = event.pull_request.body ?? "";
        author = event.pull_request.user.login;
        branch = event.pull_request.head.ref;
        const baseRef = event.pull_request.base.ref;
        await git(["fetch", "origin", baseRef]);
        const diff = await git([
            "diff",
            "--name-only",
            `origin/${baseRef}...HEAD`,
        ]);
        files = diff ? diff.split("\n").filter(Boolean) : [];
    } else {
        branch = await git(["branch", "--show-current"]);
        const diff = await git(["diff", "--name-only", "origin/main...HEAD"]);
        files = diff ? diff.split("\n").filter(Boolean) : [];
        const arg = process.argv[2];
        if (arg) {
            body = await readFile(arg, "utf8");
        }
        title = "";
    }

    const fileContents: Record<string, string> = {};
    for (const path of files) {
        if (!path.startsWith("supabase/migrations/")) continue;
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
        author,
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

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
