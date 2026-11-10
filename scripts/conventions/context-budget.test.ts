import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    baselineProblems,
    budgetCheck,
    budgetKey,
    INCREASE_LABEL,
    overMessage,
    parseBaseline,
    serializeBaseline,
    sizesFromDisk,
    sizesFromTree,
} from "./context-budget.ts";

const baseline = {
    "CLAUDE.md": 1000,
    ".claude/skills/foodable-test": 500,
};

describe("budgetCheck", () => {
    test("at or under the baseline passes", () => {
        const r = budgetCheck(
            { "CLAUDE.md": 1000, ".claude/skills/foodable-test": 100 },
            baseline,
            [],
        );
        expect(r).toEqual({ ok: true, over: [], labelled: false });
    });

    test("CLAUDE.md past the baseline fails", () => {
        const r = budgetCheck(
            { "CLAUDE.md": 1001, ".claude/skills/foodable-test": 500 },
            baseline,
            [],
        );
        expect(r.ok).toBe(false);
        expect(r.over).toEqual([
            { key: "CLAUDE.md", size: 1001, baseline: 1000 },
        ]);
        expect(overMessage(r.over[0]!)).toContain("grew from 1000 to 1001");
    });

    test("a skill past the baseline fails", () => {
        const r = budgetCheck(
            { ".claude/skills/foodable-test": 501 },
            baseline,
            [],
        );
        expect(r.ok).toBe(false);
    });

    test("the label lets an increase through", () => {
        const r = budgetCheck({ "CLAUDE.md": 2000 }, baseline, [
            INCREASE_LABEL,
        ]);
        expect(r.ok).toBe(true);
        expect(r.labelled).toBe(true);
        expect(r.over).toHaveLength(1);
    });

    test("another label does not", () => {
        expect(
            budgetCheck({ "CLAUDE.md": 2000 }, baseline, ["blast:low"]).ok,
        ).toBe(false);
    });

    test("a new skill folder counts as over", () => {
        const r = budgetCheck({ ".claude/skills/new-one": 10 }, baseline, []);
        expect(r.ok).toBe(false);
        expect(r.over).toEqual([
            { key: ".claude/skills/new-one", size: 10, baseline: null },
        ]);
        expect(overMessage(r.over[0]!)).toContain("not in the baseline");
        expect(
            budgetCheck({ ".claude/skills/new-one": 10 }, baseline, [
                INCREASE_LABEL,
            ]).ok,
        ).toBe(true);
    });

    test("a removed skill is fine", () => {
        expect(budgetCheck({ "CLAUDE.md": 900 }, baseline, []).ok).toBe(true);
    });
});

describe("sizesFromTree", () => {
    const blob = (path: string, size: number, mode = "100644") => ({
        path,
        mode,
        type: "blob",
        size,
    });

    test("sums each skill folder, counts CLAUDE.md once", () => {
        const sizes = sizesFromTree([
            blob("CLAUDE.md", 100),
            blob("AGENTS.md", 9, "120000"),
            blob(".agents/skills", 18, "120000"),
            blob("README.md", 5000),
            blob(".claude/settings.json", 40),
            blob(".claude/skills/a/SKILL.md", 10),
            blob(".claude/skills/a/refs/x.md", 5),
            blob(".claude/skills/a/link.md", 99, "120000"),
            blob(".claude/skills/b/SKILL.md", 7),
            { path: ".claude/skills/a", mode: "040000", type: "tree" },
        ]);
        expect(sizes).toEqual({
            "CLAUDE.md": 100,
            ".claude/skills/a": 15,
            ".claude/skills/b": 7,
        });
    });
});

describe("sizesFromDisk", () => {
    const git = (root: string, ...args: string[]) => {
        const p = Bun.spawnSync(["git", ...args], { cwd: root });
        if (p.exitCode !== 0) throw new Error(p.stderr.toString());
    };

    test("tracked files only: symlinks skipped, folders summed, scratch ignored", () => {
        const root = mkdtempSync(join(tmpdir(), "budget-"));
        git(root, "init", "-q");
        writeFileSync(join(root, "CLAUDE.md"), "x".repeat(30));
        symlinkSync("CLAUDE.md", join(root, "AGENTS.md"));
        mkdirSync(join(root, ".claude/skills/a/refs"), { recursive: true });
        writeFileSync(join(root, ".claude/skills/a/SKILL.md"), "y".repeat(10));
        writeFileSync(join(root, ".claude/skills/a/refs/x.md"), "z".repeat(5));
        symlinkSync("SKILL.md", join(root, ".claude/skills/a/link.md"));
        mkdirSync(join(root, ".agents"));
        symlinkSync("../.claude/skills", join(root, ".agents/skills"));
        git(root, "add", "-A");
        // Untracked scratch, an untracked new skill, and an ignored file:
        // none of them count.
        writeFileSync(
            join(root, ".claude/skills/a/scratch.md"),
            "q".repeat(99),
        );
        mkdirSync(join(root, ".claude/skills/untracked"), { recursive: true });
        writeFileSync(join(root, ".claude/skills/untracked/SKILL.md"), "u");
        writeFileSync(join(root, ".gitignore"), "ignored.md\n");
        writeFileSync(
            join(root, ".claude/skills/a/ignored.md"),
            "i".repeat(50),
        );
        expect(sizesFromDisk(root)).toEqual({
            "CLAUDE.md": 30,
            ".claude/skills/a": 15,
        });
    });

    test("measures the working tree, and skips a tracked file deleted from it", () => {
        const root = mkdtempSync(join(tmpdir(), "budget-"));
        git(root, "init", "-q");
        mkdirSync(join(root, ".claude/skills/a"), { recursive: true });
        writeFileSync(join(root, ".claude/skills/a/SKILL.md"), "y".repeat(10));
        writeFileSync(join(root, ".claude/skills/a/gone.md"), "g".repeat(7));
        git(root, "add", "-A");
        writeFileSync(join(root, ".claude/skills/a/SKILL.md"), "y".repeat(12));
        Bun.spawnSync(["rm", join(root, ".claude/skills/a/gone.md")]);
        expect(sizesFromDisk(root)).toEqual({ ".claude/skills/a": 12 });
    });
});

describe("baselineProblems (labelled PR)", () => {
    const sizes = { "CLAUDE.md": 1200, ".claude/skills/new": 40 };

    test("a baseline that covers the head sizes: nothing to report", () => {
        expect(
            baselineProblems(sizes, {
                "CLAUDE.md": 1200,
                ".claude/skills/new": 50,
            }),
        ).toEqual([]);
    });

    test("the old baseline (growth not recorded) fails with the fix", () => {
        const problems = baselineProblems(sizes, {
            "CLAUDE.md": 1000,
        });
        expect(problems.join("\n")).toContain(
            "CLAUDE.md is 1200 bytes, it allows 1000",
        );
        expect(problems.join("\n")).toContain(
            ".claude/skills/new is not in it",
        );
        expect(problems.at(-1)).toContain("context-budget.ts --write");
    });

    test("a baseline missing at the head fails", () => {
        expect(baselineProblems(sizes, null)[0]).toContain("is missing");
    });
});

describe("baseline file", () => {
    test("round-trips, sorted, with a trailing newline", () => {
        const text = serializeBaseline({ b: 2, a: 1 });
        expect(text.endsWith("\n")).toBe(true);
        expect(Object.keys(JSON.parse(text).bytes)).toEqual(["a", "b"]);
        expect(parseBaseline(text)).toEqual({ a: 1, b: 2 });
    });

    test("rejects a malformed baseline", () => {
        expect(() => parseBaseline("{}")).toThrow(/bytes/);
        expect(() => parseBaseline('{"bytes":{"a":"x"}}')).toThrow(
            /byte count/,
        );
    });
});

describe("budgetCheck: only the keys the PR touches", () => {
    const baseline = { "CLAUDE.md": 1000, ".claude/skills/a": 100 };

    test("a branch that never edited CLAUDE.md is not blamed for its size", () => {
        const r = budgetCheck({ "CLAUDE.md": 1500 }, baseline, [], new Set());
        expect(r.ok).toBe(true);
    });

    test("a touched key over the baseline still fails", () => {
        const r = budgetCheck(
            { "CLAUDE.md": 1500, ".claude/skills/a": 50 },
            baseline,
            [],
            new Set(["CLAUDE.md"]),
        );
        expect(r.ok).toBe(false);
        expect(r.over.map((o) => o.key)).toEqual(["CLAUDE.md"]);
    });

    test("budgetKey maps paths to their budget entries", () => {
        expect(budgetKey("CLAUDE.md")).toBe("CLAUDE.md");
        expect(budgetKey(".claude/skills/a/SKILL.md")).toBe(".claude/skills/a");
        expect(budgetKey(".claude/skills/a/refs/x.md")).toBe(
            ".claude/skills/a",
        );
        expect(budgetKey(".claude/skills/loose.md")).toBeNull();
        expect(budgetKey("AGENTS.md")).toBeNull();
        expect(budgetKey("docs/x.md")).toBeNull();
    });
});
