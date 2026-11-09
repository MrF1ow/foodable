import { describe, expect, test } from "bun:test";
import {
    parsePrCheckArgs,
    resolveTitle,
    type TitleSources,
} from "./pr-lint.ts";

describe("parsePrCheckArgs", () => {
    test("no arguments", () => {
        expect(parsePrCheckArgs([])).toEqual({});
    });

    test("a body file", () => {
        expect(parsePrCheckArgs(["body.md"])).toEqual({ bodyPath: "body.md" });
    });

    test("--title with a separate value, before or after the body", () => {
        expect(parsePrCheckArgs(["body.md", "--title", "fix(web): x"])).toEqual(
            { bodyPath: "body.md", title: "fix(web): x" },
        );
        expect(parsePrCheckArgs(["--title", "fix(web): x", "body.md"])).toEqual(
            { bodyPath: "body.md", title: "fix(web): x" },
        );
    });

    test("--title=value", () => {
        expect(parsePrCheckArgs(["--title=fix(web): a=b"])).toEqual({
            title: "fix(web): a=b",
        });
    });

    test("--title without a value is an error", () => {
        expect(() => parsePrCheckArgs(["body.md", "--title"])).toThrow(
            "--title needs a value",
        );
    });

    test("a flag it does not know is ignored", () => {
        expect(parsePrCheckArgs(["--verbose", "body.md"])).toEqual({
            bodyPath: "body.md",
        });
    });
});

describe("resolveTitle", () => {
    const sources = (pr: string | null): TitleSources => ({
        prTitle: async () => pr,
        commitSubject: async () => "chore(repo): from the commit",
    });

    test("--title wins and asks nothing else", async () => {
        const never: TitleSources = {
            prTitle: async () => {
                throw new Error("must not look up the PR");
            },
            commitSubject: async () => {
                throw new Error("must not read the commit");
            },
        };
        expect(await resolveTitle("fix(web): x", never)).toEqual({
            title: "fix(web): x",
            from: "--title",
        });
    });

    test("the open PR's title comes next", async () => {
        expect(await resolveTitle(undefined, sources("fix(web): pr"))).toEqual({
            title: "fix(web): pr",
            from: "the open PR",
        });
    });

    test("without a PR, the latest commit's subject", async () => {
        expect(await resolveTitle(undefined, sources(null))).toEqual({
            title: "chore(repo): from the commit",
            from: "the latest commit",
        });
    });
});
