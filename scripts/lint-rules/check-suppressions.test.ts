// The suppression policy (check-suppressions.ts), against fixtures and inline
// cases. The fixtures under fixtures/check-suppressions/ are excluded from the
// repo lint run like the rule fixtures; the bad one holds every form the policy
// rejects, the good one every form it allows.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findBadSuppressions, isIgnored } from "./check-suppressions.ts";

const DIR = join(import.meta.dir, "fixtures/check-suppressions");

async function problemsIn(name: string) {
    const file = join(DIR, name);
    return findBadSuppressions(file, await Bun.file(file).text());
}

describe("findBadSuppressions", () => {
    test("bad.ts: every rejected form is reported on its line", async () => {
        const problems = await problemsIn("bad.ts");
        expect(problems.map((p) => p.line)).toEqual([
            1, // bare block disable
            4, // block disable with rule and reason
            7, // file-wide line-comment disable with rule and reason
            10, // enable
            13, // bare -line
            13, // ... which also has no reason
            15, // -next-line with a reason but no rule
            18, // -next-line with a rule but no reason
            21, // -next-line with an empty reason
        ]);
        expect(problems[0]!.message).toContain("rest of the file");
        expect(problems[3]!.message).toContain("re-enable");
        expect(problems[4]!.message).toContain("names no rule");
        expect(problems[5]!.message).toContain("needs a reason");
    });

    test("good.ts: the allowed forms and look-alikes pass", async () => {
        expect(await problemsIn("good.ts")).toEqual([]);
    });

    test("the exact scratch case: a block disable next to a sleep", () => {
        const text = [
            `import { test } from "bun:test";`,
            `/* eslint-disable */`,
            `test("x", async () => { await Bun.sleep(5); });`,
        ].join("\n");
        expect(findBadSuppressions("x.test.ts", text)).toHaveLength(1);
    });

    test("a malformed rule list is rejected", () => {
        const text = "// oxlint-disable-next-line foodable/a foodable/b -- r\n";
        const [problem] = findBadSuppressions("x.ts", text);
        expect(problem?.message).toContain("malformed rule list");
    });

    test("directives in JSX text and .js files are judged by file kind", () => {
        const jsx = `export const x = <p>// eslint-disable</p>;\n`;
        expect(findBadSuppressions("x.tsx", jsx)).toEqual([]);
        expect(
            findBadSuppressions("x.mjs", "/* oxlint-disable */\nexport {};\n"),
        ).toHaveLength(1);
    });

    test("a directive on the last line without a newline is found", () => {
        expect(findBadSuppressions("x.ts", "// eslint-disable")).toHaveLength(
            1,
        );
    });
});

describe("isIgnored", () => {
    const patterns = [
        "node_modules/**",
        "scripts/lint-rules/fixtures/**",
        "src/domain/additive-risk.ts",
    ];
    test("matches globs and exact paths", () => {
        expect(
            isIgnored("scripts/lint-rules/fixtures/a/bad.ts", patterns),
        ).toBe(true);
        expect(isIgnored("src/domain/additive-risk.ts", patterns)).toBe(true);
        expect(isIgnored("src/domain/other.ts", patterns)).toBe(false);
    });
});
