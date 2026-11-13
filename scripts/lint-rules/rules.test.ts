// Fixture tests for the foodable lint rules: each rule must fire on its bad
// example (on exactly the expected lines) and stay quiet on its good one.
//
// The fixtures under fixtures/<rule>/ are not tests (no .test.ts suffix) and are
// excluded from the repo lint run; here they are linted with fixtures/oxlintrc.json,
// which enables every rule everywhere (the repo config scopes rules to tests or
// src/mcp with overrides). The pinned oxlint binary runs, so this also proves
// the JS-plugin loader works on this machine.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import plugin from "./plugin.js";

const ROOT = join(import.meta.dir, "../..");
const FIXTURES = "scripts/lint-rules/fixtures";

type Diagnostic = {
    code: string;
    filename: string;
    labels: { span: { line: number } }[];
};

/** rule name → fixture file → lines it fired on (sorted). */
const fired = new Map<string, Map<string, number[]>>();

beforeAll(async () => {
    const proc = Bun.spawn(
        [
            join(ROOT, "node_modules/.bin/oxlint"),
            "-c",
            `${FIXTURES}/oxlintrc.json`,
            "-f",
            "json",
            FIXTURES,
        ],
        { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    let parsed: { diagnostics: Diagnostic[] };
    try {
        parsed = JSON.parse(out);
    } catch {
        throw new Error(`oxlint printed no JSON:\n${out}\n${err}`);
    }
    for (const d of parsed.diagnostics) {
        const rule = /^foodable\((.+)\)$/.exec(d.code)?.[1];
        if (!rule) {
            throw new Error(`unexpected diagnostic ${d.code} in ${d.filename}`);
        }
        const file = d.filename.slice(`${FIXTURES}/`.length);
        const byFile = fired.get(rule) ?? new Map<string, number[]>();
        fired.set(rule, byFile);
        byFile.set(file, [...(byFile.get(file) ?? []), d.labels[0]!.span.line]);
    }
    for (const byFile of fired.values()) {
        for (const lines of byFile.values()) lines.sort((a, b) => a - b);
    }
});

/**
 * rule → the lines its bad.ts must fire on. The fixtures are in the `[fmt] ignorePatterns` of bunfig.toml
 * so these stay put; edit a bad.ts and re-pin its lines here.
 */
const EXPECTED_BAD: Record<string, number[]> = {
    "gated-tool": [9, 12, 13, 18],
    "mcp-schema-object": [14, 17, 20, 21],
    "no-db-mock-outside-windows": [5, 6, 7, 8],
    "no-per-test-timeout": [3, 5, 6, 7, 8, 9, 11],
    "no-restore-from-live-import": [22, 24, 26, 28],
    "no-string-replacement-patterns": [4, 5, 6, 7, 8, 9],
    "no-wall-clock-waits": [6, 7, 8, 9, 13, 16, 17],
    "skip-needs-reason": [3, 4, 5, 8],
};

describe("foodable lint rules", () => {
    const ruleNames = Object.keys(plugin.rules).sort();

    test("every rule has a fixture pair and an expectation", async () => {
        expect(Object.keys(EXPECTED_BAD).sort()).toEqual(ruleNames);
        for (const rule of ruleNames) {
            expect(
                await Bun.file(join(ROOT, FIXTURES, rule, "bad.ts")).exists(),
            ).toBe(true);
            expect(
                await Bun.file(join(ROOT, FIXTURES, rule, "good.ts")).exists(),
            ).toBe(true);
        }
    });

    for (const rule of Object.keys(EXPECTED_BAD)) {
        test(`${rule} fires on bad.ts`, () => {
            expect(fired.get(rule)?.get(`${rule}/bad.ts`)).toEqual(
                EXPECTED_BAD[rule]!,
            );
        });
    }

    test("no rule fires on any good.ts", () => {
        const stray: string[] = [];
        for (const [rule, byFile] of fired) {
            for (const [file, lines] of byFile) {
                if (
                    !file.endsWith("/bad.ts") &&
                    !file.endsWith("/allowed.ts")
                ) {
                    stray.push(`${rule} fired on ${file}:${lines.join(",")}`);
                }
            }
        }
        expect(stray).toEqual([]);
    });

    test("no-db-mock-outside-windows honours its allow list", () => {
        // allowed.ts is listed in fixtures/oxlintrc.json for src/db/tokens only:
        // the tokens mock (line 5) passes, the sql mock (line 7) does not.
        expect(
            fired
                .get("no-db-mock-outside-windows")
                ?.get("no-db-mock-outside-windows/allowed.ts"),
        ).toEqual([7]);
    });

    test("each bad.ts fires only its own rule", () => {
        const foreign: string[] = [];
        for (const [rule, byFile] of fired) {
            for (const file of byFile.keys()) {
                if (!file.startsWith(`${rule}/`))
                    foreign.push(`${rule} on ${file}`);
            }
        }
        expect(foreign).toEqual([]);
    });
});

describe("repo .oxlintrc.json", () => {
    test("enables every plugin rule as an error and ignores the fixtures", async () => {
        const config = JSON.parse(
            await Bun.file(join(ROOT, ".oxlintrc.json")).text(),
        ) as {
            categories?: Record<string, string>;
            ignorePatterns?: string[];
            rules?: Record<string, unknown>;
            overrides?: { rules?: Record<string, unknown> }[];
        };
        const level = (v: unknown) => (Array.isArray(v) ? v[0] : v);
        const enabled = new Set<string>();
        for (const rules of [
            config.rules ?? {},
            ...(config.overrides ?? []).map((o) => o.rules ?? {}),
        ]) {
            for (const [name, value] of Object.entries(rules)) {
                if (level(value) === "error") enabled.add(name);
            }
        }
        for (const rule of Object.keys(plugin.rules)) {
            expect(enabled.has(`foodable/${rule}`)).toBe(true);
        }
        expect(config.ignorePatterns).toContain(`${FIXTURES}/**`);
        expect(config.categories?.correctness).toBe("off");
    });
});
