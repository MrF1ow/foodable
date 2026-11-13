import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { FLAGS_EPOCH } from "../src/flags.js";
import type { RolloutFile } from "../src/flags-rollout.js";
import {
    DEFAULT_RAILWAY_PROJECT_ID,
    expandInternalRule,
    parseRailwayRules,
    planFlagChanges,
    ruleIdForExpression,
    type RailwayFlag,
} from "./flags-apply.js";

const PROJECT = DEFAULT_RAILWAY_PROJECT_ID;
const SCOPE = `project:${PROJECT}`;

function syncFile(): RolloutFile {
    return {
        internal: ["842478ef-82e8-41c9-b86a-5ce7f5644a0d"],
        flags: {
            "mcp-widgets-v2": { default: false, rules: [] },
            "off-lookups": { default: true, rules: [] },
            "recipe-link-reader": { default: true, rules: [] },
            "barcode-camera": { default: true, rules: [] },
            "restock-runner": { default: true, rules: [] },
            [FLAGS_EPOCH]: { default: 0, rules: [] },
        },
    };
}

function syncRailway(): RailwayFlag[] {
    return [
        {
            name: "mcp-widgets-v2",
            type: "bool",
            default: false,
            rules: [],
        },
        {
            name: "off-lookups",
            type: "bool",
            default: true,
            rules: [],
        },
        {
            name: "recipe-link-reader",
            type: "bool",
            default: true,
            rules: [],
        },
        {
            name: "barcode-camera",
            type: "bool",
            default: true,
            rules: [],
        },
        {
            name: "restock-runner",
            type: "bool",
            default: true,
            rules: [],
        },
        {
            name: FLAGS_EPOCH,
            type: "number",
            default: 0,
            rules: [],
        },
    ];
}

describe("planFlagChanges", () => {
    test("in-sync state plans nothing", () => {
        const plan = planFlagChanges(syncFile(), syncRailway(), PROJECT);
        expect(plan.commands).toEqual([]);
        expect(plan.extraInRailway).toEqual([]);
    });

    test("changed default yields one set command", () => {
        const file = syncFile();
        file.flags!["mcp-widgets-v2"] = { default: true, rules: [] };
        const plan = planFlagChanges(file, syncRailway(), PROJECT);
        expect(plan.commands).toEqual([
            [
                "railway",
                "flag",
                "set",
                "mcp-widgets-v2",
                "true",
                "--scope",
                SCOPE,
            ],
        ]);
    });

    test("missing flag plans create with type", () => {
        const file = syncFile();
        const railway = syncRailway().filter(
            (f) => f.name !== "mcp-widgets-v2",
        );
        const plan = planFlagChanges(file, railway, PROJECT);
        expect(plan.commands).toEqual([
            [
                "railway",
                "flag",
                "set",
                "mcp-widgets-v2",
                "false",
                "--type",
                "bool",
                "--scope",
                SCOPE,
            ],
        ]);
    });

    test("internal rule expands to key expressions", () => {
        const file = syncFile();
        file.flags!["mcp-widgets-v2"] = { default: false, rules: ["internal"] };
        const plan = planFlagChanges(file, syncRailway(), PROJECT);
        const when = expandInternalRule(file.internal ?? []);
        expect(plan.commands).toEqual([
            [
                "railway",
                "flag",
                "set",
                "mcp-widgets-v2",
                "true",
                "--when",
                when,
                "--rule-id",
                "internal",
                "--scope",
                SCOPE,
            ],
        ]);
    });

    test("removed rule plans unset", () => {
        const file = syncFile();
        const railway = syncRailway().map((f) =>
            f.name === "mcp-widgets-v2"
                ? {
                      ...f,
                      rules: [
                          {
                              id: "stale",
                              when: 'env == "local"',
                              value: true,
                          },
                      ],
                  }
                : f,
        );
        const plan = planFlagChanges(file, railway, PROJECT);
        expect(plan.commands).toEqual([
            [
                "railway",
                "flag",
                "unset",
                "mcp-widgets-v2",
                "--rule-id",
                "stale",
                "--scope",
                SCOPE,
            ],
        ]);
    });

    test("extra Railway flag is reported, not deleted", () => {
        const railway: RailwayFlag[] = [
            ...syncRailway(),
            { name: "orphan", type: "bool", default: false, rules: [] },
        ];
        const plan = planFlagChanges(syncFile(), railway, PROJECT);
        expect(plan.extraInRailway).toEqual(["orphan"]);
        expect(
            plan.commands.some(
                (c) => c.includes("delete") && c.includes("orphan"),
            ),
        ).toBe(false);
    });
});

describe("parseRailwayRules", () => {
    test("accepts id, when, and value field variants", () => {
        const rules = parseRailwayRules([
            { ruleId: "a", expression: 'plan == "pro"', serve: true },
            { rule_id: "b", condition: "cohort < 3", value: false },
        ]);
        expect(rules).toEqual([
            { id: "a", when: 'plan == "pro"', value: true },
            { id: "b", when: "cohort < 3", value: false },
        ]);
    });
});

describe("ruleIdForExpression", () => {
    test("uses a short stable hash for non-internal rules", () => {
        const expr = 'env == "staging"';
        const expected = createHash("sha256")
            .update(expr)
            .digest("hex")
            .slice(0, 8);
        expect(ruleIdForExpression(expr)).toBe(expected);
    });
});
