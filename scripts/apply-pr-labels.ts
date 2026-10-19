import { lintPr } from "./conventions/conventions.ts";
import { catalogNames } from "./conventions/labels.ts";

const PROTECTED_LABELS = new Set([
    "security",
    "needs-decision",
    "blocked",
    "agent",
    "bug",
    "enhancement",
    "documentation",
    "good first issue",
    "help wanted",
    "question",
    "duplicate",
    "wontfix",
]);

export function isManagedLabel(name: string): boolean {
    if (
        name === "breaking" ||
        name === "migration" ||
        name === "migration:contract" ||
        name === "dependencies"
    ) {
        return true;
    }
    return (
        name.startsWith("type:") ||
        name.startsWith("area:") ||
        name.startsWith("blast:")
    );
}

export function reconcile(
    current: string[],
    desired: string[],
    managedPredicate: (name: string) => boolean,
): { add: string[]; remove: string[] } {
    const currentSet = new Set(current);
    const desiredSet = new Set(desired);
    const add: string[] = [];
    for (const name of desired) {
        if (!currentSet.has(name)) {
            add.push(name);
        }
    }
    const remove: string[] = [];
    for (const name of current) {
        if (!managedPredicate(name)) continue;
        if (PROTECTED_LABELS.has(name)) continue;
        if (!desiredSet.has(name)) {
            remove.push(name);
        }
    }
    add.sort();
    remove.sort();
    return { add, remove };
}

type GhFileRow = {
    filename: string;
    status?: string;
    previous_filename?: string;
};

async function ghApi(
    token: string,
    path: string,
    query?: Record<string, string>,
): Promise<unknown> {
    const url = new URL(`https://api.github.com/${path}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            url.searchParams.set(k, v);
        }
    }
    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`GitHub API ${path} failed (${res.status}): ${body}`);
    }
    return res.json();
}

async function ghApiPaginateFiles(
    token: string,
    repo: string,
    prNumber: string,
): Promise<string[]> {
    const paths: string[] = [];
    let page = 1;
    for (;;) {
        const chunk = (await ghApi(
            token,
            `repos/${repo}/pulls/${prNumber}/files`,
            { per_page: "100", page: String(page) },
        )) as GhFileRow[];
        if (chunk.length === 0) break;
        for (const row of chunk) {
            paths.push(row.filename);
            if (row.previous_filename) {
                paths.push(row.previous_filename);
            }
        }
        if (chunk.length < 100) break;
        page += 1;
    }
    return [...new Set(paths)];
}

async function fetchMigrationContents(
    token: string,
    repo: string,
    paths: string[],
    headSha: string,
): Promise<Record<string, string>> {
    const fileContents: Record<string, string> = {};
    for (const path of paths) {
        if (!path.startsWith("supabase/migrations/")) continue;
        const data = (await ghApi(token, `repos/${repo}/contents/${path}`, {
            ref: headSha,
        })) as { content?: string; encoding?: string };
        if (data.encoding === "base64" && data.content) {
            const normalized = data.content.replace(/\n/g, "");
            fileContents[path] = Buffer.from(normalized, "base64").toString(
                "utf8",
            );
        }
    }
    return fileContents;
}

async function addLabels(
    token: string,
    repo: string,
    issueNumber: string,
    names: string[],
): Promise<void> {
    if (names.length === 0) return;
    const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ labels: names }),
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(
            `GitHub API add labels failed (${res.status}): ${body}`,
        );
    }
}

async function removeLabel(
    token: string,
    repo: string,
    issueNumber: string,
    name: string,
): Promise<void> {
    const encoded = encodeURIComponent(name);
    const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/labels/${encoded}`;
    const res = await fetch(url, {
        method: "DELETE",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(
            `GitHub API remove label ${name} failed (${res.status}): ${body}`,
        );
    }
}

async function listCurrentLabels(
    token: string,
    repo: string,
    issueNumber: string,
): Promise<string[]> {
    const rows = (await ghApi(
        token,
        `repos/${repo}/issues/${issueNumber}/labels`,
    )) as Array<{ name: string }>;
    return rows.map((r) => r.name);
}

async function main(): Promise<void> {
    const repo = process.env.REPO;
    const prNumber = process.env.PR_NUMBER;
    const token = process.env.GH_TOKEN;
    if (!repo || !prNumber || !token) {
        throw new Error("REPO, PR_NUMBER, and GH_TOKEN are required");
    }

    const pr = (await ghApi(token, `repos/${repo}/pulls/${prNumber}`)) as {
        title: string;
        body: string | null;
        user: { login: string };
        head: { ref: string; sha: string };
    };

    const files = await ghApiPaginateFiles(token, repo, prNumber);
    const fileContents = await fetchMigrationContents(
        token,
        repo,
        files,
        pr.head.sha,
    );

    const linted = lintPr({
        title: pr.title,
        branch: pr.head.ref,
        body: pr.body ?? "",
        files,
        author: pr.user.login,
        fileContents:
            Object.keys(fileContents).length > 0 ? fileContents : undefined,
    });

    const allowed = catalogNames();
    const desired = linted.labels.filter((l) => allowed.has(l));

    const current = await listCurrentLabels(token, repo, prNumber);
    const { add, remove } = reconcile(current, desired, isManagedLabel);

    for (const name of remove) {
        await removeLabel(token, repo, prNumber, name);
    }
    await addLabels(token, repo, prNumber, add);

    console.log(`desired: ${desired.join(", ") || "none"}`);
    console.log(`added: ${add.join(", ") || "none"}`);
    console.log(`removed: ${remove.join(", ") || "none"}`);
    if (linted.findings.length > 0) {
        console.log(`lint findings: ${linted.findings.length} (not blocking)`);
    }
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
