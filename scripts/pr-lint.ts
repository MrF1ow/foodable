import { readFile } from "node:fs/promises";
import { lintPr, parseBody } from "./conventions/conventions.ts";
import { checkPlannerPr, parsePlanner } from "./conventions/planner.ts";
import { readPlannerAt, readPlannerTree } from "./planner-load.ts";

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
    let prNumber: number | undefined;
    let baseRef = "main";

    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
        const raw = await readFile(eventPath, "utf8");
        const event = JSON.parse(raw) as {
            pull_request: {
                number: number;
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
        prNumber = event.pull_request.number;
        baseRef = event.pull_request.base.ref;
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
        // bun run pr:check [body.md] [--pr <number>]
        const args = process.argv.slice(2);
        const prAt = args.indexOf("--pr");
        if (prAt >= 0) {
            prNumber = Number(args[prAt + 1]);
            args.splice(prAt, 2);
        }
        if (args[0]) {
            body = await readFile(args[0], "utf8");
        }
        title = "";
    }

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
    // The planner check compares planner/ on the base branch with the tree
    // this PR would merge (CI checks out the merge commit). Dependabot PRs
    // carry no body sections, so they are exempt like the other body rules.
    const findings = [...result.findings];
    if (author !== "dependabot[bot]") {
        if (prNumber === undefined || !Number.isInteger(prNumber)) {
            console.log("planner: skipped (no PR number; pass --pr <number>)");
        } else {
            const base = parsePlanner(await readPlannerAt(`origin/${baseRef}`));
            const head = parsePlanner(await readPlannerTree());
            findings.push(...head.findings);
            findings.push(
                ...checkPlannerPr({
                    section: parseBody(body).sections["Planner"],
                    base: base.planner,
                    head: head.planner,
                    prNumber,
                }),
            );
        }
    }

    for (const f of findings) {
        console.log(f.message);
    }

    if (findings.length > 0) {
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
