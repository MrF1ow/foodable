// The gate check. A pull request that touches a gate file passes only once a
// code owner labels it gate:approved, after its latest push. GitHub refuses an
// approving review from the pull request's author, and in a one-maintainer
// repo the code owner opens almost every pull request, so a review cannot
// carry the approval; the label can.
//
// The workflow runs this file from the base branch (pull_request_target), so a
// pull request cannot rewrite the rule it is judged by, and CODEOWNERS is read
// at the base commit for the same reason.

export const APPROVAL_LABEL = "gate:approved";

const GATE_PREFIXES = [
    ".github/workflows/",
    ".github/rulesets/",
    "scripts/conventions/",
    "scripts/migration-safety/",
    "scripts/migration-dryrun",
];

const GATE_FILES = [".github/CODEOWNERS", "package.json"];

export function isGatePath(path: string): boolean {
    return (
        GATE_FILES.includes(path) ||
        GATE_PREFIXES.some((prefix) => path.startsWith(prefix))
    );
}

type OwnerRule = { pattern: RegExp; owners: string[] };

// CODEOWNERS patterns follow gitignore rules: a leading "/" anchors to the
// root, a trailing "/" means everything below that directory, "**" crosses
// directories, "*" does not, and a pattern with no inner "/" matches at any
// depth.
function patternToRegExp(raw: string): RegExp {
    let pattern = raw;
    const dirOnly = pattern.endsWith("/");
    if (dirOnly) pattern = pattern.slice(0, -1);
    const anchored = pattern.startsWith("/") || pattern.includes("/");
    if (pattern.startsWith("/")) pattern = pattern.slice(1);
    const body = pattern
        .split("**")
        .map((part) =>
            part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*"),
        )
        .join(".*");
    const prefix = anchored ? "^" : "^(?:.*/)?";
    return new RegExp(`${prefix}${body}(?:/.*)?$`);
}

export function parseCodeOwners(text: string): OwnerRule[] {
    const rules: OwnerRule[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [pattern, ...owners] = trimmed.split(/\s+/);
        if (!pattern) continue;
        rules.push({
            pattern: patternToRegExp(pattern),
            // Only users can approve here: a team would need an org lookup the
            // workflow token cannot make, and an email names no login.
            owners: owners
                .filter((o) => o.startsWith("@") && !o.includes("/"))
                .map((o) => o.slice(1).toLowerCase()),
        });
    }
    return rules;
}

// The last matching rule wins, as on GitHub.
export function ownersOf(rules: OwnerRule[], path: string): string[] {
    let owners: string[] = [];
    for (const rule of rules) {
        if (rule.pattern.test(path)) owners = rule.owners;
    }
    return owners;
}

export type Approval = { actor: string; at: string };

export type GateInput = {
    files: string[];
    codeOwners: string;
    // The latest gate:approved labeling, or null when the label is not on the
    // pull request now.
    approval: Approval | null;
    // When the head commit reached the pull request, or null if unknown.
    headPushedAt: string | null;
};

export type GateResult = { ok: boolean; gated: string[]; message: string };

export function evaluateGate(input: GateInput): GateResult {
    const gated = input.files.filter(isGatePath);
    if (gated.length === 0) {
        return { ok: true, gated, message: "No gate files changed." };
    }
    const ask = `A code owner must add the ${APPROVAL_LABEL} label after the latest push.`;
    if (input.approval === null) {
        return { ok: false, gated, message: `Gate files changed. ${ask}` };
    }
    if (input.headPushedAt === null) {
        return {
            ok: false,
            gated,
            message: `Could not tell when the head commit was pushed. ${ask}`,
        };
    }
    if (Date.parse(input.approval.at) <= Date.parse(input.headPushedAt)) {
        return {
            ok: false,
            gated,
            message: `${APPROVAL_LABEL} was added before the latest push. ${ask}`,
        };
    }
    const actor = input.approval.actor.toLowerCase();
    const rules = parseCodeOwners(input.codeOwners);
    const unowned = gated.filter(
        (path) => !ownersOf(rules, path).includes(actor),
    );
    if (unowned.length > 0) {
        return {
            ok: false,
            gated,
            message: `${APPROVAL_LABEL} was added by ${input.approval.actor}, who is not a code owner of ${unowned.join(", ")}. ${ask}`,
        };
    }
    return {
        ok: true,
        gated,
        message: `Approved by code owner ${input.approval.actor}.`,
    };
}

type Env = {
    token: string;
    repo: string;
    prNumber: string;
    action: string;
    headSha: string;
    headRef: string;
    baseSha: string;
};

async function ghFetch(
    env: Env,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const res = await fetch(`https://api.github.com/${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${env.token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    });
    if (!res.ok && res.status !== 404) {
        throw new Error(
            `GitHub API ${path} failed (${res.status}): ${await res.text()}`,
        );
    }
    return res;
}

async function paginate<T>(env: Env, path: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page++) {
        const sep = path.includes("?") ? "&" : "?";
        const res = await ghFetch(
            env,
            `${path}${sep}per_page=100&page=${page}`,
        );
        const chunk = (await res.json()) as T[];
        rows.push(...chunk);
        if (chunk.length < 100) return rows;
    }
}

async function changedFiles(env: Env): Promise<string[]> {
    const rows = await paginate<{
        filename: string;
        previous_filename?: string;
    }>(env, `repos/${env.repo}/pulls/${env.prNumber}/files`);
    return [
        ...new Set(
            rows.flatMap((r) =>
                r.previous_filename
                    ? [r.filename, r.previous_filename]
                    : [r.filename],
            ),
        ),
    ];
}

async function hasApprovalLabel(env: Env): Promise<boolean> {
    const labels = await paginate<{ name: string }>(
        env,
        `repos/${env.repo}/issues/${env.prNumber}/labels`,
    );
    return labels.some((l) => l.name === APPROVAL_LABEL);
}

async function latestApproval(env: Env): Promise<Approval | null> {
    const events = await paginate<{
        event: string;
        created_at: string;
        actor: { login: string } | null;
        label?: { name: string };
    }>(env, `repos/${env.repo}/issues/${env.prNumber}/events`);
    const labeled = events.filter(
        (e) =>
            e.event === "labeled" &&
            e.label?.name === APPROVAL_LABEL &&
            e.actor,
    );
    const last = labeled.at(-1);
    return last ? { actor: last.actor!.login, at: last.created_at } : null;
}

async function baseCodeOwners(env: Env): Promise<string> {
    for (const path of [
        ".github/CODEOWNERS",
        "CODEOWNERS",
        "docs/CODEOWNERS",
    ]) {
        const res = await ghFetch(
            env,
            `repos/${env.repo}/contents/${path}?ref=${env.baseSha}`,
        );
        if (res.status === 404) continue;
        const data = (await res.json()) as { content?: string };
        return Buffer.from(
            (data.content ?? "").replace(/\n/g, ""),
            "base64",
        ).toString("utf8");
    }
    return "";
}

// GitHub Actions opens a check suite for a commit when it is pushed, so the
// earliest one on this branch dates the push. The label is also stripped on
// every push, so this only matters if that strip ever fails.
async function headPushedAt(env: Env): Promise<string | null> {
    const res = await ghFetch(
        env,
        `repos/${env.repo}/commits/${env.headSha}/check-suites?per_page=100`,
    );
    if (res.status === 404) return null;
    const data = (await res.json()) as {
        check_suites: Array<{
            created_at: string;
            head_branch: string | null;
            app: { slug: string } | null;
        }>;
    };
    const times = data.check_suites
        .filter(
            (s) =>
                s.app?.slug === "github-actions" &&
                s.head_branch === env.headRef,
        )
        .map((s) => s.created_at)
        .sort();
    return times[0] ?? null;
}

async function stripApproval(env: Env): Promise<void> {
    const res = await ghFetch(
        env,
        `repos/${env.repo}/issues/${env.prNumber}/labels/${encodeURIComponent(APPROVAL_LABEL)}`,
        { method: "DELETE" },
    );
    if (res.ok) console.log(`New push: removed ${APPROVAL_LABEL}.`);
}

function readEnv(): Env {
    const need = (name: string): string => {
        const value = process.env[name];
        if (!value) throw new Error(`gate: ${name} is not set`);
        return value;
    };
    return {
        token: need("GH_TOKEN"),
        repo: need("REPO"),
        prNumber: need("PR_NUMBER"),
        action: need("EVENT_ACTION"),
        headSha: need("HEAD_SHA"),
        headRef: need("HEAD_REF"),
        baseSha: need("BASE_SHA"),
    };
}

async function main(): Promise<void> {
    const env = readEnv();
    const files = await changedFiles(env);
    if (!files.some(isGatePath)) {
        console.log("No gate files changed.");
        return;
    }
    // A push invalidates an approval given for the previous head.
    if (env.action === "synchronize") await stripApproval(env);
    const approval =
        env.action !== "synchronize" && (await hasApprovalLabel(env))
            ? await latestApproval(env)
            : null;
    const result = evaluateGate({
        files,
        codeOwners: await baseCodeOwners(env),
        approval,
        headPushedAt: await headPushedAt(env),
    });
    for (const path of result.gated) console.log(`gate: ${path}`);
    console.log(result.message);
    if (!result.ok) process.exit(1);
}

if (import.meta.main) {
    await main();
}
