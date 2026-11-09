// Read-only GitHub API helpers for the policy checks. They run in
// `pull_request_target` workflows, which hold a token but must never execute
// pull request code, so everything about the PR (its file list, file contents,
// tree sizes, labels) is fetched through the API instead of a checkout.
//
// The client takes an injectable `fetch`, so tests run without a network and
// without `mock.module`.

export type Github = {
    /** GET `path` (relative to the API root). 404 is returned, other errors throw. */
    get(path: string): Promise<Response>;
    /** Every page of a list endpoint. */
    paginate<T>(path: string): Promise<T[]>;
};

export function createGithub(opts: {
    token: string;
    fetch?: typeof fetch;
}): Github {
    const doFetch = opts.fetch ?? fetch;
    const get = async (path: string): Promise<Response> => {
        const res = await doFetch(`https://api.github.com/${path}`, {
            headers: {
                Authorization: `Bearer ${opts.token}`,
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
    };
    const paginate = async <T>(path: string): Promise<T[]> => {
        const rows: T[] = [];
        for (let page = 1; ; page++) {
            const sep = path.includes("?") ? "&" : "?";
            const res = await get(`${path}${sep}per_page=100&page=${page}`);
            if (res.status === 404) {
                throw new Error(`GitHub API ${path} returned 404`);
            }
            const chunk = (await res.json()) as T[];
            rows.push(...chunk);
            if (chunk.length < 100) return rows;
        }
    };
    return { get, paginate };
}

export type PrFile = {
    filename: string;
    previous_filename?: string;
    status: string;
    changes?: number;
    /** Blob sha of the file at the head commit. */
    sha?: string;
};

export type PrInfo = {
    title: string;
    body: string;
    headRef: string;
    headSha: string;
    baseSha: string;
    author: string;
    labels: string[];
};

export type PrEnv = { gh: Github; repo: string; prNumber: string };

/** `GH_TOKEN`, `REPO` and `PR_NUMBER` from the environment, or an error naming the first missing one. */
export function readPrEnv(
    env: Record<string, string | undefined> = process.env,
): PrEnv {
    const need = (name: string): string => {
        const value = env[name];
        if (!value) throw new Error(`${name} is not set`);
        return value;
    };
    return {
        gh: createGithub({ token: need("GH_TOKEN") }),
        repo: need("REPO"),
        prNumber: need("PR_NUMBER"),
    };
}

/** True when the PR environment variables are all present. */
export function hasPrEnv(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return Boolean(env.GH_TOKEN && env.REPO && env.PR_NUMBER);
}

export async function getPr(env: PrEnv): Promise<PrInfo> {
    const res = await env.gh.get(`repos/${env.repo}/pulls/${env.prNumber}`);
    if (res.status === 404) {
        throw new Error(`pull request ${env.prNumber} not found`);
    }
    const pr = (await res.json()) as {
        title: string;
        body: string | null;
        user: { login: string } | null;
        head: { ref: string; sha: string };
        base: { sha: string };
        labels: Array<{ name: string }>;
    };
    return {
        title: pr.title,
        body: pr.body ?? "",
        headRef: pr.head.ref,
        headSha: pr.head.sha,
        baseSha: pr.base.sha,
        author: pr.user?.login ?? "",
        labels: pr.labels.map((l) => l.name),
    };
}

/**
 * The most files GitHub's `pulls/{n}/files` lists for one PR. A list this long
 * may have been cut off, and a check that judges a cut-off list can miss the
 * file that mattered (a migration, a policy script).
 */
export const PR_FILES_CAP = 3000;

/** Throws when the PR's file list may be truncated by GitHub's cap. */
export function assertFilesComplete(files: readonly PrFile[]): void {
    if (files.length >= PR_FILES_CAP) {
        throw new Error(
            `This PR changes ${files.length} files, and GitHub lists at most ${PR_FILES_CAP} per PR, so the list may be truncated and cannot be judged. Split the PR into smaller ones.`,
        );
    }
}

export async function getPrFiles(env: PrEnv): Promise<PrFile[]> {
    const files = await env.gh.paginate<PrFile>(
        `repos/${env.repo}/pulls/${env.prNumber}/files`,
    );
    assertFilesComplete(files);
    return files;
}

/** Every path the PR touches; a rename counts as its old and its new path. */
export function changedPaths(files: readonly PrFile[]): string[] {
    return [
        ...new Set(
            files.flatMap((f) =>
                f.previous_filename
                    ? [f.filename, f.previous_filename]
                    : [f.filename],
            ),
        ),
    ];
}

/** The text of a git blob, by sha. */
export async function getBlobText(env: PrEnv, sha: string): Promise<string> {
    const res = await env.gh.get(`repos/${env.repo}/git/blobs/${sha}`);
    if (res.status === 404) throw new Error(`blob ${sha} not found`);
    const blob = (await res.json()) as { content: string; encoding: string };
    if (blob.encoding !== "base64") {
        throw new Error(`blob ${sha}: unexpected encoding ${blob.encoding}`);
    }
    return Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString(
        "utf8",
    );
}

export type TreeEntry = {
    path: string;
    mode: string;
    type: string;
    size?: number;
};

/** The whole git tree at a commit. Throws when GitHub truncated it. */
export async function getTree(
    env: PrEnv,
    commitSha: string,
): Promise<TreeEntry[]> {
    const res = await env.gh.get(
        `repos/${env.repo}/git/trees/${commitSha}?recursive=1`,
    );
    if (res.status === 404) throw new Error(`tree ${commitSha} not found`);
    const data = (await res.json()) as {
        tree: TreeEntry[];
        truncated: boolean;
    };
    if (data.truncated) {
        throw new Error(
            `the tree at ${commitSha} is too large for the API; sizes would be incomplete`,
        );
    }
    return data.tree;
}

/**
 * A file's text at a commit, or null when the path does not exist there.
 * Uses the contents API, which inlines files up to 1 MB; a larger one throws
 * rather than returning an empty string that would read as "changed".
 */
export async function getFileText(
    env: PrEnv,
    path: string,
    ref: string,
): Promise<string | null> {
    const res = await env.gh.get(
        `repos/${env.repo}/contents/${path
            .split("/")
            .map(encodeURIComponent)
            .join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    if (res.status === 404) return null;
    const file = (await res.json()) as {
        type?: string;
        content?: string;
        encoding?: string;
    };
    if (file.type !== "file" || file.encoding !== "base64") {
        throw new Error(
            `${path} at ${ref}: the contents API did not inline it (type ${file.type}, encoding ${file.encoding})`,
        );
    }
    return Buffer.from(
        (file.content ?? "").replace(/\n/g, ""),
        "base64",
    ).toString("utf8");
}

/**
 * The commit the PR branched from. The PR's file list is a diff against it, so
 * comparing contents against the base branch's current tip would blame the PR
 * for whatever main changed since.
 */
export async function getMergeBase(
    env: PrEnv,
    baseSha: string,
    headSha: string,
): Promise<string> {
    const res = await env.gh.get(
        `repos/${env.repo}/compare/${baseSha}...${headSha}?per_page=1`,
    );
    if (res.status === 404) {
        throw new Error(`cannot compare ${baseSha}...${headSha}`);
    }
    const data = (await res.json()) as { merge_base_commit?: { sha: string } };
    const sha = data.merge_base_commit?.sha;
    if (!sha) throw new Error(`no merge base for ${baseSha}...${headSha}`);
    return sha;
}
