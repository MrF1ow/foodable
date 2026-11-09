import { describe, expect, test } from "bun:test";
import {
    checkPathsNotice,
    evaluatePolicy,
    toMigrationChanges,
    type PolicyInput,
} from "./policy.ts";

const BODY = [
    "## Summary",
    "x",
    "## Blast radius",
    "Level: high",
    "Rollback: revert-safe",
    "## Changes",
    "x",
    "## Migrations",
    "None",
    "## Contracts",
    "None",
    "## Testing",
    "bun test",
    "## Links",
    "",
].join("\n");

const MIG_BODY = BODY.replace(
    "## Migrations\nNone",
    "## Migrations\nadds a column",
);

function input(over: Partial<PolicyInput> = {}): PolicyInput {
    return {
        title: "chore(repo): tidy",
        branch: "chore/repo-tidy",
        body: BODY,
        author: "someone",
        files: ["README.md"],
        prFiles: [{ filename: "README.md", status: "modified" }],
        contents: {},
        newestBaseTimestamp: "20260101000000",
        ...over,
    };
}

const NEW_MIG = "db/migrations/20270101000000_add_x.sql";

describe("evaluatePolicy", () => {
    test("a clean docs PR passes", () => {
        const r = evaluatePolicy(input());
        expect(r.ok).toBe(true);
        expect(r.findings).toEqual([]);
    });

    test("convention findings fail the policy", () => {
        const r = evaluatePolicy(
            input({ title: "Tidy things", branch: "tidy" }),
        );
        expect(r.ok).toBe(false);
        expect(r.findings.some((f) => f.includes("Invalid title"))).toBe(true);
    });

    test("a declared blast level below the floor fails", () => {
        const r = evaluatePolicy(
            input({
                body: BODY.replace("Level: high", "Level: low"),
                files: ["package.json"],
                prFiles: [{ filename: "package.json", status: "modified" }],
            }),
        );
        expect(r.findings.some((f) => f.includes("below the floor"))).toBe(
            true,
        );
    });

    test("a destructive migration without a contract marker fails", () => {
        const r = evaluatePolicy(
            input({
                body: MIG_BODY,
                files: [NEW_MIG],
                prFiles: [{ filename: NEW_MIG, status: "added" }],
                contents: { [NEW_MIG]: "alter table t drop column c;\n" },
            }),
        );
        expect(r.ok).toBe(false);
        expect(r.findings.some((f) => f.startsWith("contract "))).toBe(true);
    });

    test("with the marker the same migration passes", () => {
        const r = evaluatePolicy(
            input({
                body: MIG_BODY,
                files: [NEW_MIG],
                prFiles: [{ filename: NEW_MIG, status: "added" }],
                contents: {
                    [NEW_MIG]:
                        "-- foodable:contract nothing reads c any more\nalter table t drop column c;\n",
                },
            }),
        );
        expect(r.findings).toEqual([]);
    });

    test("editing a merged migration fails as immutable", () => {
        const path = "db/migrations/20250101000000_old.sql";
        const r = evaluatePolicy(
            input({
                body: MIG_BODY,
                files: [path],
                prFiles: [{ filename: path, status: "modified" }],
            }),
        );
        expect(r.findings.some((f) => f.startsWith("immutable "))).toBe(true);
    });

    test("a migration older than main's newest fails the timestamp rule", () => {
        const path = "db/migrations/20250101000000_late.sql";
        const r = evaluatePolicy(
            input({
                body: MIG_BODY,
                files: [path],
                prFiles: [{ filename: path, status: "added" }],
                contents: { [path]: "select 1;\n" },
            }),
        );
        expect(r.findings.some((f) => f.startsWith("timestamp "))).toBe(true);
    });

    test("a new table needs grants for service_role", () => {
        const r = evaluatePolicy(
            input({
                body: MIG_BODY,
                files: [NEW_MIG],
                prFiles: [{ filename: NEW_MIG, status: "added" }],
                contents: {
                    [NEW_MIG]:
                        "create table public.t (id int);\nalter table public.t enable row level security;\n",
                },
            }),
        );
        expect(r.findings.some((f) => f.startsWith("grant "))).toBe(true);
    });

    test("names the changed files that run from main", () => {
        const files = [
            "scripts/conventions/policy.ts",
            ".claude/skills/foodable-test/SKILL.md",
            "README.md",
        ];
        const r = evaluatePolicy(
            input({
                files,
                prFiles: files.map((filename) => ({
                    filename,
                    status: "modified",
                })),
            }),
        );
        expect(r.policyPaths).toEqual([
            ".claude/skills/foodable-test/SKILL.md",
            "scripts/conventions/policy.ts",
        ]);
    });
});

describe("PR-controlled check files", () => {
    const changed = (files: string[]) =>
        evaluatePolicy(
            input({
                files,
                prFiles: files.map((filename) => ({
                    filename,
                    status: "modified",
                })),
            }),
        ).checkPaths;

    test("lists the files that define the checks run from the PR", () => {
        expect(
            changed([
                ".github/workflows/ci.yml",
                "scripts/check-changed.ts",
                "scripts/typecheck.ts",
                "scripts/lint-rules/lint.ts",
                ".oxlintrc.json",
                "package.json",
                "README.md",
                "src/index.ts",
            ]),
        ).toEqual([
            ".github/workflows/ci.yml",
            ".oxlintrc.json",
            "package.json",
            "scripts/check-changed.ts",
            "scripts/lint-rules/lint.ts",
            "scripts/typecheck.ts",
        ]);
    });

    test("policy.yml and main's own policy scripts are not on the list", () => {
        // They run from main, so a PR edit cannot change how it is judged.
        expect(
            changed([
                ".github/workflows/policy.yml",
                "scripts/conventions/policy.ts",
                ".github/agent-context-budget.json",
            ]),
        ).toEqual([]);
    });

    test("an ordinary PR gets no notice", () => {
        expect(changed(["README.md"])).toEqual([]);
        expect(checkPathsNotice([])).toBeNull();
    });

    test("the notice says to review them as the checks that judge the PR", () => {
        const lines = checkPathsNotice(["package.json"]);
        expect(lines?.join("\n")).toContain(
            "change the checks that judge this PR; review them as such",
        );
        expect(lines).toContain('  "package.json"');
    });

    test("a file name cannot start a log command on its own line", () => {
        const lines = checkPathsNotice([".github/workflows/x\n::error::pwned"]);
        expect(lines?.some((l) => l.startsWith("::"))).toBe(false);
        expect(lines?.every((l) => !l.includes("\n"))).toBe(true);
    });
});

describe("toMigrationChanges", () => {
    test("maps the API statuses like git diff --name-status -M", () => {
        const changes = toMigrationChanges([
            { filename: "db/migrations/a.sql", status: "added" },
            { filename: "db/migrations/b.sql", status: "modified" },
            { filename: "db/migrations/c.sql", status: "changed" },
            { filename: "db/migrations/d.sql", status: "removed" },
            { filename: "src/x.ts", status: "modified" },
        ]);
        expect(changes.map((c) => [c.status, c.path])).toEqual([
            ["added", "db/migrations/a.sql"],
            ["modified", "db/migrations/b.sql"],
            ["modified", "db/migrations/c.sql"],
            ["deleted", "db/migrations/d.sql"],
        ]);
    });

    test("a rename out of the legacy folder with no edits is a relocation", () => {
        const [change] = toMigrationChanges([
            {
                filename: "db/migrations/20240101000000_x.sql",
                previous_filename: "supabase/migrations/20240101000000_x.sql",
                status: "renamed",
                changes: 0,
            },
        ]);
        expect(change).toMatchObject({ status: "renamed", similarity: 100 });
        const [edited] = toMigrationChanges([
            {
                filename: "db/migrations/20240101000000_x.sql",
                previous_filename: "supabase/migrations/20240101000000_x.sql",
                status: "renamed",
                changes: 3,
            },
        ]);
        expect(edited!.similarity).toBeLessThan(100);
    });

    test("a rename in from outside is an add, out of the dir a delete", () => {
        const changes = toMigrationChanges([
            {
                filename: "db/migrations/n.sql",
                previous_filename: "tmp/n.sql",
                status: "renamed",
                changes: 0,
            },
            {
                filename: "tmp/o.sql",
                previous_filename: "db/migrations/o.sql",
                status: "renamed",
                changes: 0,
            },
        ]);
        expect(changes).toEqual([
            { status: "added", path: "db/migrations/n.sql" },
            { status: "deleted", path: "db/migrations/o.sql" },
        ]);
    });
});
