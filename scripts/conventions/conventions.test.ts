import { describe, expect, test } from "bun:test";
import {
    blastFloor,
    checkBranch,
    classifyPath,
    lintPr,
    parseTitle,
    SCOPES,
    TYPES,
} from "./conventions.ts";

describe("CONTRIBUTING.md", () => {
    test("lists every type and scope as a list item", async () => {
        const path = `${import.meta.dir}/../../CONTRIBUTING.md`;
        const text = await Bun.file(path).text();
        for (const type of TYPES) {
            expect(text).toContain(`- \`${type}\``);
        }
        for (const scope of SCOPES) {
            expect(text).toContain(`- \`${scope}\``);
        }
    });
});

describe("blastFloor", () => {
    test("fridge stack is medium areas [fridge]", () => {
        const paths = [
            "src/domain/fridge.ts",
            "src/mcp/tools/fridge.ts",
            "src/web/routes/fridge.ts",
        ];
        const r = blastFloor(paths);
        expect(r.level).toBe("medium");
        expect(r.areas).toEqual(["fridge"]);
    });

    test("fridge plus grocery is high", () => {
        const paths = [
            "src/domain/fridge.ts",
            "src/mcp/tools/fridge.ts",
            "src/web/routes/fridge.ts",
            "src/domain/grocery.ts",
        ];
        const r = blastFloor(paths);
        expect(r.level).toBe("high");
    });

    test("bun.lock is medium deps", () => {
        const r = blastFloor(["bun.lock"]);
        expect(r.level).toBe("medium");
        expect(r.areas).toEqual(["deps"]);
    });

    test("package.json is high", () => {
        const r = blastFloor(["package.json"]);
        expect(r.level).toBe("high");
    });
});

describe("classifyPath mapped", () => {
    test("every tracked path is mapped", async () => {
        const proc = Bun.spawn(["git", "ls-files"], {
            cwd: import.meta.dir + "/../..",
            stdout: "pipe",
            stderr: "pipe",
        });
        const code = await proc.exited;
        if (code !== 0) {
            const err = await new Response(proc.stderr).text();
            throw new Error(`git ls-files failed: ${err}`);
        }
        const text = await new Response(proc.stdout).text();
        const paths = text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        const unmapped: string[] = [];
        for (const path of paths) {
            const c = classifyPath(path);
            if (!c.mapped) {
                unmapped.push(path);
            }
        }
        expect(unmapped).toEqual([]);
    });

    test("agent skill paths are low", () => {
        expect(classifyPath(".claude/settings.json")).toEqual({
            level: "low",
            area: "repo",
            mapped: true,
        });
        expect(classifyPath(".agents/skills")).toEqual({
            level: "low",
            area: "repo",
            mapped: true,
        });
    });
});

describe("parseTitle", () => {
    test('Revert "feat(fridge): show expiry" succeeds', () => {
        const r = parseTitle('Revert "feat(fridge): show expiry"');
        expect("error" in r).toBe(false);
        if (!("error" in r)) {
            expect(r.type).toBe("feat");
            expect(r.scope).toBe("fridge");
            expect(r.subject).toBe("show expiry");
        }
    });

    test('Revert "not a title" fails', () => {
        const r = parseTitle('Revert "not a title"');
        expect("error" in r).toBe(true);
    });
});

describe("checkBranch", () => {
    test("grandfathered branches have no findings", () => {
        expect(checkBranch("revert-85-title")).toEqual([]);
        expect(checkBranch("dependabot/bun/left-pad")).toEqual([]);
        expect(checkBranch("usability/nav")).toEqual([]);
    });

    test("wip has a finding", () => {
        expect(checkBranch("wip").length).toBeGreaterThan(0);
    });

    test("rejects scope without slug", () => {
        expect(checkBranch("feat/fridge").length).toBeGreaterThan(0);
        expect(checkBranch("feat/fridge-").length).toBeGreaterThan(0);
    });
});

describe("lintPr", () => {
    test("breaking fridge change requires contracts", () => {
        const r = lintPr({
            title: "feat(fridge)!: change the tool result",
            branch: "feat/fridge-change",
            body: [
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
            ].join("\n"),
            files: ["src/domain/fridge.ts"],
        });
        expect(r.findings.some((f) => f.rule === "contracts")).toBe(true);
        expect(r.findings.some((f) => f.rule === "migrations")).toBe(false);
    });

    test("db migration with contract marker", () => {
        const path = "supabase/migrations/20261018120000_add_table.sql";
        const r = lintPr({
            title: "feat(db): add a table",
            branch: "feat/db-add-table",
            body: [
                "## Summary",
                "add table",
                "## Blast radius",
                "Level: high",
                "Rollback: needs a follow-up migration",
                "## Changes",
                "migration",
                "## Migrations",
                "add table",
                "## Contracts",
                "None",
                "## Testing",
                "db:dryrun",
                "## Links",
                "",
            ].join("\n"),
            files: [path],
            fileContents: {
                [path]: "-- foodable:contract add the table\n",
            },
        });
        expect(r.findings.some((f) => f.rule === "contracts")).toBe(false);
        expect(r.labels).toContain("migration");
        expect(r.labels).toContain("migration:contract");
    });

    test("dependabot minimal body", () => {
        const r = lintPr({
            title: "chore(deps): bump left-pad",
            branch: "dependabot/bun/left-pad",
            body: "hello",
            files: ["bun.lock"],
            author: "dependabot[bot]",
        });
        expect(r.findings).toEqual([]);
        expect(r.floor).toBe("medium");
    });

    test("empty Migrations section is a finding", () => {
        const r = lintPr({
            title: "feat(fridge): show expiry",
            branch: "feat/fridge-show",
            body: [
                "## Summary",
                "x",
                "## Blast radius",
                "Level: medium",
                "Rollback: revert-safe",
                "## Changes",
                "x",
                "## Migrations",
                "",
                "## Contracts",
                "None",
                "## Testing",
                "bun test",
                "## Links",
                "",
            ].join("\n"),
            files: ["src/domain/fridge.ts"],
        });
        expect(
            r.findings.some(
                (f) =>
                    f.rule === "body" &&
                    f.message === "Migrations section must not be empty",
            ),
        ).toBe(true);
    });

    test("missing Testing section", () => {
        const r = lintPr({
            title: "feat(fridge): show expiry",
            branch: "feat/fridge-show",
            body: [
                "## Summary",
                "x",
                "## Blast radius",
                "Level: medium",
                "Rollback: revert-safe",
                "## Changes",
                "x",
                "## Migrations",
                "None",
                "## Contracts",
                "None",
                "## Links",
                "",
            ].join("\n"),
            files: ["src/domain/fridge.ts"],
        });
        expect(r.findings.some((f) => f.rule === "body")).toBe(true);
    });

    test("declared low below package.json floor", () => {
        const r = lintPr({
            title: "feat(repo): tweak ci",
            branch: "feat/repo-tweak",
            body: [
                "## Summary",
                "x",
                "## Blast radius",
                "Level: low",
                "Rollback: revert-safe",
                "## Changes",
                "x",
                "## Migrations",
                "None",
                "## Contracts",
                "None",
                "## Testing",
                "pr:check",
                "## Links",
                "",
            ].join("\n"),
            files: ["package.json"],
        });
        const blast = r.findings.find((f) => f.rule === "blast");
        expect(blast).toBeDefined();
        expect(blast!.message).toContain("high");
    });
});
