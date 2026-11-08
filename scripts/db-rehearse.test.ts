import { describe, expect, test } from "bun:test";
import {
    APPLIED_COMMAND,
    DEFAULTS,
    DUMP_COMMAND,
    expandHome,
    isInside,
    localVersions,
    looksLikeDump,
    parseAppliedVersions,
    parseArgs,
    planRehearsal,
    sshArgs,
} from "./db-rehearse.ts";

describe("parseArgs", () => {
    test("defaults to production's Postgres service", () => {
        expect(parseArgs([])).toEqual({ ...DEFAULTS, list: false });
    });

    test("reads every flag", () => {
        expect(
            parseArgs([
                "--list",
                "--key",
                "/k",
                "--project",
                "p",
                "--service",
                "s",
                "--environment",
                "e",
            ]),
        ).toEqual({
            project: "p",
            service: "s",
            environment: "e",
            key: "/k",
            list: true,
        });
    });

    test("rejects unknown flags and missing values", () => {
        expect(() => parseArgs(["--keep"])).toThrow("unknown argument");
        expect(() => parseArgs(["--pending-from", "20261108130000"])).toThrow(
            "unknown argument",
        );
        expect(() => parseArgs(["--key"])).toThrow("needs a value");
        expect(() => parseArgs(["--key", "--list"])).toThrow("needs a value");
    });
});

describe("sshArgs", () => {
    test("names project, service and environment, and expands ~", () => {
        expect(
            sshArgs({ ...DEFAULTS, list: false }, DUMP_COMMAND, "/h"),
        ).toEqual([
            "railway",
            "ssh",
            "-p",
            DEFAULTS.project,
            "-s",
            "Postgres",
            "-e",
            "production",
            "-i",
            "/h/.ssh/id_github_personal",
            "--",
            DUMP_COMMAND,
        ]);
    });

    test("expandHome leaves absolute and relative paths alone", () => {
        expect(expandHome("/a/b", "/h")).toBe("/a/b");
        expect(expandHome("a/~b", "/h")).toBe("a/~b");
        expect(expandHome("~", "/h")).toBe("/h");
    });

    test("remote commands only read", () => {
        expect(DUMP_COMMAND).toContain("--data-only --schema=public");
        expect(APPLIED_COMMAND).toMatch(/-c 'select version from /);
    });
});

describe("versions", () => {
    test("localVersions keeps migration files only, sorted", () => {
        expect(
            localVersions([
                "20261108130000_feature_flags.sql",
                "README.md",
                "20261004230000_a.sql",
                "2026_bad.sql",
            ]),
        ).toEqual(["20261004230000", "20261108130000"]);
    });

    test("parseAppliedVersions ignores blank lines and CLI noise", () => {
        expect(
            parseAppliedVersions(
                "\n20261108130000\nwarning: something\n20261108120000\n",
            ),
        ).toEqual(["20261108120000", "20261108130000"]);
    });
});

describe("planRehearsal", () => {
    const local = ["20260101000000", "20260102000000", "20260103000000"];

    test("up to date", () => {
        expect(planRehearsal(local, local)).toEqual({
            kind: "up-to-date",
            applied: 3,
        });
    });

    test("pending suffix starts at the first unapplied version", () => {
        expect(planRehearsal(local, local.slice(0, 1))).toEqual({
            kind: "pending",
            pendingFrom: "20260102000000",
            pending: ["20260102000000", "20260103000000"],
        });
    });

    test("an empty history rehearses everything", () => {
        expect(planRehearsal(local, [])).toMatchObject({
            pendingFrom: "20260101000000",
        });
    });

    test("a checkout behind production fails", () => {
        expect(() =>
            planRehearsal(local, [...local, "20260104000000"]),
        ).toThrow("rebase on origin/main");
    });

    test("a pending version older than an applied one fails", () => {
        expect(() =>
            planRehearsal(local, ["20260101000000", "20260103000000"]),
        ).toThrow("renumber");
    });
});

describe("looksLikeDump", () => {
    const head = "--\n-- PostgreSQL database dump\n--\n\\restrict k\nCOPY x;\n";
    const tail =
        "--\n-- PostgreSQL database dump complete\n--\n\n\\unrestrict k\n";

    test("needs the opening and the closing marker", () => {
        expect(looksLikeDump(head + tail)).toBe(true);
        expect(looksLikeDump(head)).toBe(false);
        expect(looksLikeDump(tail)).toBe(false);
        expect(looksLikeDump("Error: ssh failed")).toBe(false);
    });
});

describe("isInside", () => {
    test("catches the repo and its subdirectories only", () => {
        expect(isInside("/repo", "/repo")).toBe(true);
        expect(isInside("/repo/tmp/x", "/repo/")).toBe(true);
        expect(isInside("/tmp/foodable-rehearse-1", "/repo")).toBe(false);
        expect(isInside("/repo-other", "/repo")).toBe(false);
    });
});
