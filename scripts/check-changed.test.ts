import { describe, expect, test } from "bun:test";
import {
    changedChecks,
    parseArgs,
    resolveImport,
    type Check,
} from "./check-changed.ts";

// A small stand-in for the working tree: what exists on disk. The pure seam
// never reads it, so these tests need no git and no disk.
const FILES = [
    "src/domain/fridge.ts",
    "src/domain/fridge.test.ts",
    "src/domain/units.ts", // no sibling test
    "src/widgets.ts",
    "src/widgets.test.ts",
    "src/widget-frames.test.ts",
    "src/brand.ts",
    "src/brand.test.ts",
    "src/app-assets.test.ts",
    "src/tokens.ts",
    "src/tokens.test.ts",
    "src/tokens-v2.test.ts",
    "src/mcp.test.ts",
    "src/mcp.format.test.ts",
    "src/mcp/tools/fridge.ts",
    "src/mcp/notices-wire.test.ts",
    "src/copy/tools.ts",
    "src/copy/notices.test.ts",
    "src/db/fridge.ts",
    "public/widgets/src/templates/fridge.html",
    "public/widgets/macros.test.ts",
    "public/widgets/import-run.test.ts",
    "scripts/check-changed.ts",
    "scripts/check-changed.test.ts",
    "scripts/nav-check.ts",
    "scripts/conventions/conventions.test.ts",
    "scripts/conventions/planner.test.ts",
    "scripts/conventions/skills.test.ts",
    "src/fetch-safe.test.ts",
    "src/flags.test.ts",
    "src/web/routes/fridge.test.ts",
    "src/web/routes/fridge.ts",
    "src/db/household-stores.contract.test.ts",
    "src/domain/recipe-text.test.ts",
    "src/domain/recipe-import.test.ts",
    "src/domain/fixtures/captions/prose.txt",
    "src/domain/fixtures/social/tiktok.vtt",
    "src/misc/data.txt", // an asset nothing maps
    "docs/self-hosting.md",
    "docs/fetcher.md",
    "README.md",
    "CONTRIBUTING.md",
    "CLAUDE.md",
    "AGENTS.md",
    ".claude/skills/foodable-test/SKILL.md",
    ".prettierignore",
    ".prettierrc",
    "bun.lock",
    "package.json",
    "db/migrations/20261110000000_add_thing.sql",
    "db/bootstrap.sql",
];

// A small fake import graph (file → files it imports). fridge.ts is imported
// by its own test, by the MCP tool module (which src/mcp.test.ts imports), and
// by a route module with its own test; the db contract test imports it too.
const IMPORTS: Record<string, string[]> = {
    "src/domain/fridge.test.ts": ["src/domain/fridge.ts"],
    "src/mcp/tools/fridge.ts": ["src/domain/fridge.ts"],
    "src/mcp.test.ts": ["src/mcp/tools/fridge.ts", "src/widgets.ts"],
    "src/web/routes/fridge.ts": ["src/domain/fridge.ts"],
    "src/web/routes/fridge.test.ts": ["src/web/routes/fridge.ts"],
    "src/db/household-stores.contract.test.ts": ["src/domain/fridge.ts"],
    "src/widgets.test.ts": ["src/widgets.ts"],
    "src/brand.test.ts": ["src/brand.ts"],
};

const run = (
    paths: string[],
    opts: {
        all?: boolean;
        base?: string;
        imports?: Record<string, string[]>;
    } = {},
) => changedChecks(paths, { files: FILES, imports: IMPORTS, ...opts });
const ids = (checks: Check[]) => checks.map((c) => c.id);
const byId = (checks: Check[], id: string) => {
    const check = checks.find((c) => c.id === id);
    if (!check) throw new Error(`no ${id} check in ${ids(checks).join(",")}`);
    return check;
};

describe("changedChecks", () => {
    test("nothing changed means no checks", () => {
        expect(run([])).toEqual([]);
    });

    test("one domain source file: format it, typecheck, run its sibling test", () => {
        const checks = run(["src/domain/fridge.ts"]);
        expect(ids(checks)).toEqual(["format", "typecheck", "test"]);
        expect(byId(checks, "format").cmd).toEqual([
            "bunx",
            "prettier",
            "--check",
            "--ignore-unknown",
            "src/domain/fridge.ts",
        ]);
        expect(byId(checks, "typecheck").cmd).toEqual([
            "bun",
            "run",
            "typecheck",
        ]);
        expect(byId(checks, "test").cmd).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            "src/db/household-stores.contract.test.ts",
            "src/domain/fridge.test.ts",
            "src/flags.test.ts",
            "src/mcp.test.ts",
            "src/web/routes/fridge.test.ts",
        ]);
    });

    test("a changed test file runs itself, once, even with its source", () => {
        const checks = run([
            "src/domain/fridge.ts",
            "src/domain/fridge.test.ts",
        ]);
        const cmd = byId(checks, "test").cmd;
        expect(
            cmd.filter((a) => a === "src/domain/fridge.test.ts"),
        ).toHaveLength(1);
    });

    test("migrations add migration safety against the base, and the dry run", () => {
        const checks = run(["db/migrations/20261110000000_add_thing.sql"], {
            base: "origin/main",
        });
        expect(ids(checks)).toEqual([
            "format",
            "test",
            "migration-safety",
            "db-dryrun",
        ]);
        expect(byId(checks, "migration-safety").cmd).toEqual([
            "bun",
            "run",
            "scripts/migration-safety.ts",
            "--base",
            "origin/main",
        ]);
        expect(byId(checks, "db-dryrun").cmd).toEqual([
            "bun",
            "run",
            "db:dryrun",
        ]);
    });

    test("the base reaches the migration safety command", () => {
        const checks = run(["db/migrations/20261110000000_add_thing.sql"], {
            base: "abc123",
        });
        expect(byId(checks, "migration-safety").cmd.slice(-2)).toEqual([
            "--base",
            "abc123",
        ]);
    });

    test("other db files only need the dry run", () => {
        expect(ids(run(["db/bootstrap.sql"]))).toEqual([
            "format",
            "test",
            "db-dryrun",
        ]);
    });

    test("docs-only changes are format only", () => {
        const checks = run(["README.md", "docs/self-hosting.md"]);
        expect(ids(checks)).toEqual(["format"]);
        expect(byId(checks, "format").cmd.slice(4)).toEqual([
            "README.md",
            "docs/self-hosting.md",
        ]);
    });

    test("src/db changes run the full suite", () => {
        const checks = run(["src/db/fridge.ts"]);
        expect(byId(checks, "test").cmd).toEqual(["bun", "test"]);
    });

    test.each([
        "scripts/conventions/conventions.ts",
        "package.json",
        "bun.lock",
        "tsconfig.json",
        "bunfig.toml",
        "public/widgets/src/shared/base.css",
        "src/mcp/tools-list.snapshot.json",
    ])("%s runs the full suite", (path) => {
        expect(byId(run([path]), "test").cmd).toEqual(["bun", "test"]);
    });

    test("a source file with no mapped test falls back to the full suite", () => {
        // src/flags.test.ts scans every source file, but does not cover it
        expect(byId(run(["src/domain/units.ts"]), "test").cmd).toEqual([
            "bun",
            "test",
        ]);
    });

    test("scripts with no test do not trigger the full suite", () => {
        const checks = run(["scripts/nav-check.ts"]);
        expect(ids(checks)).toEqual(["format", "typecheck", "test"]);
        expect(byId(checks, "test").cmd).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            "src/flags.test.ts",
        ]);
    });

    test("widget templates map to the widget tests", () => {
        const cmd = byId(
            run(["public/widgets/src/templates/fridge.html"]),
            "test",
        ).cmd;
        expect(cmd).toEqual([
            "bun",
            "test",
            "public/widgets/import-run.test.ts",
            "public/widgets/macros.test.ts",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            "src/widget-frames.test.ts",
            "src/widgets.test.ts",
        ]);
        // html is not typechecked
        expect(
            ids(run(["public/widgets/src/templates/fridge.html"])),
        ).not.toContain("typecheck");
    });

    test("src/tokens.ts and src/brand.ts map to their tests", () => {
        expect(byId(run(["src/tokens.ts"]), "test").cmd).toEqual(
            expect.arrayContaining([
                "src/tokens.test.ts",
                "src/tokens-v2.test.ts",
            ]),
        );
        expect(byId(run(["src/brand.ts"]), "test").cmd).toEqual(
            expect.arrayContaining([
                "src/brand.test.ts",
                "src/app-assets.test.ts",
            ]),
        );
    });

    test("src/copy and src/mcp map to the MCP tests", () => {
        for (const path of ["src/copy/tools.ts", "src/mcp/tools/fridge.ts"]) {
            expect(byId(run([path]), "test").cmd).toEqual(
                expect.arrayContaining([
                    "src/mcp.test.ts",
                    "src/mcp.format.test.ts",
                ]),
            );
        }
    });

    test("a deleted file is not formatted and its missing sibling is not run", () => {
        const checks = changedChecks(["src/domain/gone.ts"], { files: FILES });
        expect(ids(checks)).toEqual(["typecheck", "test"]);
        expect(byId(checks, "test").cmd).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            "src/flags.test.ts",
        ]);
    });

    test("a deleted test file is not run", () => {
        const checks = changedChecks(["src/domain/gone.test.ts"], {
            files: FILES,
        });
        expect(ids(checks)).toEqual(["typecheck", "test"]);
        expect(byId(checks, "test").cmd).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            "src/flags.test.ts",
        ]);
    });

    test("duplicate paths are collapsed", () => {
        const checks = run(["src/domain/fridge.ts", "src/domain/fridge.ts"]);
        expect(byId(checks, "format").cmd.slice(4)).toEqual([
            "src/domain/fridge.ts",
        ]);
    });

    test("--all returns every check, whatever changed", () => {
        const checks = changedChecks([], { all: true, base: "abc" });
        expect(checks.map((c) => c.cmd.join(" "))).toEqual([
            "bun run format:check",
            "bun run typecheck",
            "bun test",
            "bun run scripts/migration-safety.ts --base abc",
            "bun run db:dryrun",
        ]);
    });

    test("without a file list the changed files are taken to exist", () => {
        const checks = changedChecks(["src/foo.ts"]);
        expect(ids(checks)).toEqual(["format", "typecheck", "test"]);
        // nothing maps src/foo.ts to a test, so everything runs
        expect(byId(checks, "test").cmd).toEqual(["bun", "test"]);
    });
});

describe("changedChecks: import graph", () => {
    test("a source file selects its sibling and every transitive importer", () => {
        const cmd = byId(run(["src/domain/fridge.ts"]), "test").cmd.slice(2);
        // direct importers
        expect(cmd).toContain("src/domain/fridge.test.ts");
        expect(cmd).toContain("src/db/household-stores.contract.test.ts");
        // through src/web/routes/fridge.ts
        expect(cmd).toContain("src/web/routes/fridge.test.ts");
        // through src/mcp/tools/fridge.ts, two hops
        expect(cmd).toContain("src/mcp.test.ts");
        // unrelated tests stay out
        expect(cmd).not.toContain("src/brand.test.ts");
        expect(cmd).not.toContain("src/widgets.test.ts");
    });

    test("a mid-chain module selects the tests above it only", () => {
        const cmd = byId(run(["src/web/routes/fridge.ts"]), "test").cmd.slice(
            2,
        );
        expect(cmd).toContain("src/web/routes/fridge.test.ts");
        expect(cmd).not.toContain("src/domain/fridge.test.ts");
        expect(cmd).not.toContain("src/mcp.test.ts");
    });

    test("a source with no importing test and no rule still runs everything", () => {
        // src/domain/units.ts is imported by no test in the graph
        expect(byId(run(["src/domain/units.ts"]), "test").cmd).toEqual([
            "bun",
            "test",
        ]);
        // ...but one imported by a test does not
        const cmd = byId(
            run(["src/domain/units.ts"], {
                imports: {
                    ...IMPORTS,
                    "src/brand.test.ts": ["src/domain/units.ts"],
                },
            }),
            "test",
        ).cmd;
        expect(cmd).toContain("src/brand.test.ts");
        expect(cmd).not.toEqual(["bun", "test"]);
    });

    test("without a graph only siblings and rules select tests", () => {
        const cmd = byId(
            changedChecks(["src/domain/fridge.ts"], { files: FILES }),
            "test",
        ).cmd;
        expect(cmd).toContain("src/domain/fridge.test.ts");
        expect(cmd).not.toContain("src/mcp.test.ts");
    });

    test("a deleted file selects no importers (its edges are stale)", () => {
        const imports = {
            ...IMPORTS,
            "src/brand.test.ts": ["src/domain/gone.ts"],
        };
        const cmd = byId(
            changedChecks(["src/domain/gone.ts"], { files: FILES, imports }),
            "test",
        ).cmd;
        expect(cmd).not.toContain("src/brand.test.ts");
    });

    test("selecting most of the tests just runs the full suite", () => {
        // 20 tests all importing one helper: that is 100% of the suite
        const tests = Array.from({ length: 20 }, (_, i) => `src/t${i}.test.ts`);
        const files = [
            "src/helper.ts",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            ...tests,
        ];
        const imports = Object.fromEntries(
            tests.map((t) => [t, ["src/helper.ts"]]),
        );
        expect(
            byId(changedChecks(["src/helper.ts"], { files, imports }), "test")
                .cmd,
        ).toEqual(["bun", "test"]);

        // 5 of 20 is well under the line
        const few = Object.fromEntries(
            tests.slice(0, 5).map((t) => [t, ["src/helper.ts"]]),
        );
        expect(
            byId(
                changedChecks(["src/helper.ts"], { files, imports: few }),
                "test",
            ).cmd,
        ).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            ...tests.slice(0, 5).sort(),
        ]);
    });

    test("import cycles terminate", () => {
        const imports = {
            "src/a.ts": ["src/b.ts"],
            "src/b.ts": ["src/a.ts"],
            "src/a.test.ts": ["src/a.ts"],
        };
        const files = ["src/a.ts", "src/b.ts", "src/a.test.ts"];
        expect(
            byId(changedChecks(["src/b.ts"], { files, imports }), "test").cmd,
        ).toEqual(["bun", "test", "src/a.test.ts"]);
    });
});

describe("changedChecks: docs that tests read", () => {
    test("CONTRIBUTING.md runs the conventions test and formats", () => {
        const checks = run(["CONTRIBUTING.md"]);
        expect(ids(checks)).toEqual(["format", "test"]);
        expect(byId(checks, "test").cmd).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
        ]);
    });

    test("ROADMAP.md and planner/ run the planner test", () => {
        for (const path of ["ROADMAP.md", "planner/calendar/CAL-1-x.md"]) {
            expect(byId(run([path]), "test").cmd).toEqual([
                "bun",
                "test",
                "scripts/conventions/planner.test.ts",
            ]);
        }
    });

    test("CLAUDE.md, AGENTS.md and skills run the skills test", () => {
        for (const path of [
            "CLAUDE.md",
            "AGENTS.md",
            ".claude/skills/foodable-test/SKILL.md",
        ]) {
            const checks = run([path]);
            expect(ids(checks)).toEqual(["format", "test"]);
            expect(byId(checks, "test").cmd).toEqual([
                "bun",
                "test",
                "scripts/conventions/skills.test.ts",
            ]);
        }
    });

    test("docs/fetcher.md runs the fetch-safe test; other docs stay format only", () => {
        expect(byId(run(["docs/fetcher.md"]), "test").cmd).toEqual([
            "bun",
            "test",
            "src/fetch-safe.test.ts",
        ]);
        expect(ids(run(["docs/self-hosting.md"]))).toEqual(["format"]);
    });

    test("a doc next to code does not drop the code's tests", () => {
        const cmd = byId(run(["CONTRIBUTING.md", "src/brand.ts"]), "test").cmd;
        expect(cmd).toEqual(
            expect.arrayContaining([
                "scripts/conventions/conventions.test.ts",
                "scripts/conventions/skills.test.ts",
                "src/brand.test.ts",
            ]),
        );
    });
});

describe("changedChecks: non-code files under src/ and public/", () => {
    test("a caption fixture runs the tests that read the fixtures", () => {
        const cmd = byId(
            run(["src/domain/fixtures/captions/prose.txt"]),
            "test",
        ).cmd;
        expect(cmd).toEqual([
            "bun",
            "test",
            "scripts/conventions/conventions.test.ts",
            "scripts/conventions/skills.test.ts",
            "src/domain/recipe-import.test.ts",
            "src/domain/recipe-text.test.ts",
            "src/mcp.test.ts",
        ]);
    });

    test("a fixture whose reader is gone falls back to the full suite", () => {
        // nothing in FILES reads fixtures/social
        const files = FILES.filter(
            (f) =>
                !/(recipe-text|recipe-import|recipe-jsonld|social-readers|db\/recipes|mcp)\.test\.ts$/.test(
                    f,
                ),
        );
        const checks = changedChecks(
            ["src/domain/fixtures/social/tiktok.vtt"],
            {
                files,
                imports: IMPORTS,
            },
        );
        expect(byId(checks, "test").cmd).toEqual(["bun", "test"]);
    });

    test("an unmapped .txt asset falls back to the full suite", () => {
        const checks = run(["src/misc/data.txt"]);
        expect(byId(checks, "test").cmd).toEqual(["bun", "test"]);
        expect(ids(checks)).not.toContain("typecheck");
    });
});

describe("changedChecks: prettier inputs", () => {
    test.each([".prettierignore", ".prettierrc", "package.json", "bun.lock"])(
        "%s formats the whole tree",
        (path) => {
            const format = byId(run([path]), "format");
            expect(format.cmd).toEqual(["bun", "run", "format:check"]);
            expect(format.label).toBe("format: whole tree");
        },
    );

    test("whole-tree format still applies when the config was deleted", () => {
        const checks = changedChecks([".prettierrc.json"], { files: FILES });
        expect(byId(checks, "format").cmd).toEqual([
            "bun",
            "run",
            "format:check",
        ]);
    });

    test("ordinary files are still formatted one by one", () => {
        expect(byId(run(["src/brand.ts"]), "format").cmd.slice(0, 4)).toEqual([
            "bunx",
            "prettier",
            "--check",
            "--ignore-unknown",
        ]);
    });
});

describe("resolveImport", () => {
    const set = new Set([
        "src/a.ts",
        "src/b.tsx",
        "src/dir/index.ts",
        "src/x.html",
        "src/util/c.ts",
        "scripts/s.ts",
    ]);
    const r = (from: string, spec: string) => resolveImport(from, spec, set);

    test(".js specifiers resolve to the .ts source", () => {
        expect(r("src/main.ts", "./a.js")).toBe("src/a.ts");
        expect(r("src/main.ts", "./b.js")).toBe("src/b.tsx");
    });

    test("explicit, extensionless and index specifiers", () => {
        expect(r("src/main.ts", "./a.ts")).toBe("src/a.ts");
        expect(r("src/main.ts", "./a")).toBe("src/a.ts");
        expect(r("src/main.ts", "./dir")).toBe("src/dir/index.ts");
        expect(r("src/main.ts", "./x.html")).toBe("src/x.html");
    });

    test("parent directories and nested importers", () => {
        expect(r("src/util/c.ts", "../a.js")).toBe("src/a.ts");
        expect(r("scripts/t.test.ts", "../src/a.ts")).toBe("src/a.ts");
        expect(r("src/main.ts", "./util/../a.js")).toBe("src/a.ts");
    });

    test("packages, missing files and escapes from the root are null", () => {
        expect(r("src/main.ts", "bun:test")).toBeNull();
        expect(r("src/main.ts", "@modelcontextprotocol/server")).toBeNull();
        expect(r("src/main.ts", "./nope.js")).toBeNull();
        expect(r("a.ts", "../../x.ts")).toBeNull();
    });
});

describe("parseArgs", () => {
    test("defaults", () => {
        expect(parseArgs([])).toEqual({
            base: "origin/main",
            list: false,
            all: false,
            json: false,
            paths: null,
        });
    });

    test("flags and both --base spellings", () => {
        expect(
            parseArgs(["--list", "--all", "--json", "--base", "HEAD"]),
        ).toEqual({
            base: "HEAD",
            list: true,
            all: true,
            json: true,
            paths: null,
        });
        expect(parseArgs(["--base=abc"]).base).toBe("abc");
    });

    test("--paths takes a comma-separated list, both spellings", () => {
        expect(parseArgs(["--paths", "a.ts, b.ts,"]).paths).toEqual([
            "a.ts",
            "b.ts",
        ]);
        expect(parseArgs(["--paths=a.ts"]).paths).toEqual(["a.ts"]);
        expect(() => parseArgs(["--paths"])).toThrow("--paths needs");
    });

    test("rejects unknown flags and a missing --base value", () => {
        expect(() => parseArgs(["--nope"])).toThrow("unknown argument");
        expect(() => parseArgs(["--base"])).toThrow("--base needs a ref");
    });
});

describe("changedChecks: edges the import graph cannot see", () => {
    test("a migration runs the full suite (describeDb tests migrate from db/)", () => {
        const checks = run(["db/migrations/20990101000000_x.sql"]);
        expect(byId(checks, "test").cmd).toEqual(["bun", "test"]);
        expect(ids(checks)).toContain("migration-safety");
        expect(ids(checks)).toContain("db-dryrun");
    });

    test("db/bootstrap.sql runs the full suite", () => {
        expect(byId(run(["db/bootstrap.sql"]), "test").cmd).toEqual([
            "bun",
            "test",
        ]);
    });

    test("a deleted watched path still runs the skills test", () => {
        const checks = changedChecks(["Dockerfile"], { files: FILES });
        expect(byId(checks, "test").cmd).toContain(
            "scripts/conventions/skills.test.ts",
        );
    });
});
