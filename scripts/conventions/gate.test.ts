import { describe, expect, test } from "bun:test";
import {
    APPROVAL_LABEL,
    evaluateGate,
    isGatePath,
    ownersOf,
    parseCodeOwners,
    type GateInput,
} from "./gate.ts";

const PUSHED = "2026-10-31T12:00:00Z";
const AFTER = "2026-10-31T12:05:00Z";
const BEFORE = "2026-10-31T11:55:00Z";

function input(overrides: Partial<GateInput> = {}): GateInput {
    return {
        files: ["package.json"],
        codeOwners: "* @MrF1ow\n",
        approval: { actor: "MrF1ow", at: AFTER },
        headPushedAt: PUSHED,
        ...overrides,
    };
}

describe("isGatePath", () => {
    test.each([
        ".github/workflows/ci.yml",
        ".github/rulesets/main-checks.json",
        ".github/CODEOWNERS",
        "scripts/conventions/gate.ts",
        "scripts/migration-safety/check.ts",
        "scripts/migration-dryrun.ts",
        "scripts/migration-dryrun/seed.sql",
        "package.json",
    ])("%s is a gate path", (path) => {
        expect(isGatePath(path)).toBe(true);
    });

    test.each([
        "bun.lock",
        "Dockerfile",
        "src/package.json",
        "scripts/data-api-grants.ts",
        ".github/dependabot.yml",
        "supabase/migrations/20261031180000_phase8_contract.sql",
    ])("%s is not a gate path", (path) => {
        expect(isGatePath(path)).toBe(false);
    });
});

describe("CODEOWNERS", () => {
    test("the last matching rule wins", () => {
        const rules = parseCodeOwners(
            "# owners\n* @alice\n/.github/ @bob @Carol\n",
        );
        expect(ownersOf(rules, "src/index.ts")).toEqual(["alice"]);
        expect(ownersOf(rules, ".github/workflows/ci.yml")).toEqual([
            "bob",
            "carol",
        ]);
    });

    test("a pattern with no inner slash matches at any depth", () => {
        const rules = parseCodeOwners("*.json @alice\n");
        expect(ownersOf(rules, "package.json")).toEqual(["alice"]);
        expect(ownersOf(rules, ".github/rulesets/main.json")).toEqual([
            "alice",
        ]);
        expect(ownersOf(rules, "src/index.ts")).toEqual([]);
    });

    test("an anchored pattern does not match deeper paths", () => {
        const rules = parseCodeOwners("/package.json @alice\n");
        expect(ownersOf(rules, "package.json")).toEqual(["alice"]);
        expect(ownersOf(rules, "src/package.json")).toEqual([]);
    });

    test("teams and emails are not approvers", () => {
        const rules = parseCodeOwners("* @org/team dev@example.com @alice\n");
        expect(ownersOf(rules, "package.json")).toEqual(["alice"]);
    });
});

describe("evaluateGate", () => {
    test("passes without approval when no gate file changed", () => {
        const r = evaluateGate(
            input({ files: ["src/index.ts", "bun.lock"], approval: null }),
        );
        expect(r.ok).toBe(true);
        expect(r.gated).toEqual([]);
    });

    test("fails when a gate file changed and the label is absent", () => {
        const r = evaluateGate(input({ approval: null }));
        expect(r.ok).toBe(false);
        expect(r.gated).toEqual(["package.json"]);
        expect(r.message).toContain(APPROVAL_LABEL);
    });

    test("passes when a code owner labeled after the latest push", () => {
        const r = evaluateGate(input());
        expect(r.ok).toBe(true);
        expect(r.message).toContain("MrF1ow");
    });

    test("owner matching ignores case", () => {
        expect(
            evaluateGate(input({ approval: { actor: "mrf1ow", at: AFTER } }))
                .ok,
        ).toBe(true);
    });

    test("fails when the label predates the latest push", () => {
        const r = evaluateGate(
            input({ approval: { actor: "MrF1ow", at: BEFORE } }),
        );
        expect(r.ok).toBe(false);
        expect(r.message).toContain("before the latest push");
    });

    test("fails closed when the push time is unknown", () => {
        expect(evaluateGate(input({ headPushedAt: null })).ok).toBe(false);
    });

    test("fails when the labeler is not a code owner", () => {
        const r = evaluateGate(
            input({ approval: { actor: "dependabot[bot]", at: AFTER } }),
        );
        expect(r.ok).toBe(false);
        expect(r.message).toContain("not a code owner");
    });

    test("needs the labeler to own every gate file", () => {
        const r = evaluateGate(
            input({
                files: ["package.json", ".github/workflows/ci.yml"],
                codeOwners: "* @MrF1ow\n/.github/ @someone-else\n",
            }),
        );
        expect(r.ok).toBe(false);
        expect(r.message).toContain(".github/workflows/ci.yml");
        expect(r.message).not.toContain("package.json,");
    });

    test("fails when CODEOWNERS is missing", () => {
        expect(evaluateGate(input({ codeOwners: "" })).ok).toBe(false);
    });
});
