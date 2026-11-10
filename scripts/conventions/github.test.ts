import { describe, expect, test } from "bun:test";
import {
    assertFilesComplete,
    changedPaths,
    createGithub,
    getFileText,
    getMergeBase,
    getPrFiles,
    getTree,
    PR_FILES_CAP,
    type PrEnv,
    type PrFile,
} from "./github.ts";

function fakeFetch(pages: Record<string, unknown>, seen: string[] = []) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url).replace("https://api.github.com/", "");
        seen.push(u);
        expect((init?.headers as Record<string, string>).Authorization).toBe(
            "Bearer tok",
        );
        if (!(u in pages)) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify(pages[u]), { status: 200 });
    }) as unknown as typeof fetch;
}

describe("createGithub", () => {
    test("paginate follows pages until a short one", async () => {
        const seen: string[] = [];
        const full = Array.from({ length: 100 }, (_, i) => ({ n: i }));
        const gh = createGithub({
            token: "tok",
            fetch: fakeFetch(
                {
                    "x?per_page=100&page=1": full,
                    "x?per_page=100&page=2": [{ n: 100 }],
                },
                seen,
            ),
        });
        const rows = await gh.paginate<{ n: number }>("x");
        expect(rows).toHaveLength(101);
        expect(seen).toEqual([
            "x?per_page=100&page=1",
            "x?per_page=100&page=2",
        ]);
    });

    test("an error status throws, 404 is returned", async () => {
        const gh = createGithub({
            token: "tok",
            fetch: (async () =>
                new Response("boom", {
                    status: 500,
                })) as unknown as typeof fetch,
        });
        await expect(gh.get("y")).rejects.toThrow(/500/);
        const missing = createGithub({ token: "tok", fetch: fakeFetch({}) });
        expect((await missing.get("z")).status).toBe(404);
    });
});

describe("changedPaths", () => {
    test("lists both names of a rename once", () => {
        expect(
            changedPaths([
                { filename: "a", status: "modified" },
                { filename: "b", previous_filename: "a", status: "renamed" },
            ]).sort(),
        ).toEqual(["a", "b"]);
    });
});

describe("getTree", () => {
    const env = (tree: unknown): PrEnv => ({
        gh: createGithub({
            token: "tok",
            fetch: fakeFetch({ "repos/o/r/git/trees/abc?recursive=1": tree }),
        }),
        repo: "o/r",
        prNumber: "1",
    });

    test("returns the entries", async () => {
        const entries = [
            { path: "CLAUDE.md", mode: "100644", type: "blob", size: 3 },
        ];
        expect(
            await getTree(env({ tree: entries, truncated: false }), "abc"),
        ).toEqual(entries);
    });

    test("a truncated tree is an error, never a short answer", async () => {
        await expect(
            getTree(env({ tree: [], truncated: true }), "abc"),
        ).rejects.toThrow(/too large/);
    });
});

describe("getFileText / getMergeBase", () => {
    const b64 = (t: string) => Buffer.from(t).toString("base64");
    const env = (pages: Record<string, unknown>): PrEnv => ({
        gh: createGithub({ token: "tok", fetch: fakeFetch(pages) }),
        repo: "o/r",
        prNumber: "1",
    });

    test("decodes a file at a ref, null when absent", async () => {
        const e = env({
            "repos/o/r/contents/dir/a%20b.json?ref=abc": {
                type: "file",
                encoding: "base64",
                content: b64('{"x":1}').replace(/(.{4})/g, "$1\n"),
            },
        });
        expect(await getFileText(e, "dir/a b.json", "abc")).toBe('{"x":1}');
        expect(await getFileText(e, "gone.json", "abc")).toBeNull();
    });

    test("a file the API does not inline is an error, not empty text", async () => {
        const e = env({
            "repos/o/r/contents/big.json?ref=abc": {
                type: "file",
                encoding: "none",
                content: "",
            },
        });
        await expect(getFileText(e, "big.json", "abc")).rejects.toThrow(
            /did not inline/,
        );
    });

    test("merge base comes from the compare API", async () => {
        const e = env({
            "repos/o/r/compare/b...h?per_page=1": {
                merge_base_commit: { sha: "mb" },
            },
        });
        expect(await getMergeBase(e, "b", "h")).toBe("mb");
        await expect(getMergeBase(e, "x", "y")).rejects.toThrow(
            /cannot compare/,
        );
    });
});

describe("the PR file cap", () => {
    const rows = (n: number): PrFile[] =>
        Array.from({ length: n }, (_, i) => ({
            filename: `f${i}.ts`,
            status: "modified",
        }));

    test("a list under GitHub's cap is complete", () => {
        expect(() => assertFilesComplete(rows(PR_FILES_CAP - 1))).not.toThrow();
        expect(() => assertFilesComplete([])).not.toThrow();
    });

    test("a list at the cap may be truncated: fail with a clear message", () => {
        expect(() => assertFilesComplete(rows(PR_FILES_CAP))).toThrow(
            /3000 files.*truncated.*Split the PR/,
        );
    });

    test("getPrFiles refuses a capped list instead of judging it", async () => {
        const pages: Record<string, unknown> = {};
        for (let page = 1; page <= PR_FILES_CAP / 100; page++) {
            pages[`repos/o/r/pulls/7/files?per_page=100&page=${page}`] =
                rows(100);
        }
        // The page after the cap is empty, which is what ends the pagination.
        pages[
            `repos/o/r/pulls/7/files?per_page=100&page=${PR_FILES_CAP / 100 + 1}`
        ] = [];
        const env: PrEnv = {
            gh: createGithub({ token: "tok", fetch: fakeFetch(pages) }),
            repo: "o/r",
            prNumber: "7",
        };
        await expect(getPrFiles(env)).rejects.toThrow(/truncated/);
    });
});
