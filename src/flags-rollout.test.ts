import { join } from "node:path";
import { test, expect, describe } from "bun:test";
import { FLAGS, FLAGS_EPOCH } from "./flags.js";

const ROLLOUT_PATH = join(import.meta.dir, "../flags/rollout.yml");

export type RolloutFlagEntry = {
    default?: unknown;
    rules?: unknown;
};

export type RolloutFile = {
    internal?: unknown;
    flags?: Record<string, RolloutFlagEntry>;
};

export function validateRolloutFile(
    doc: RolloutFile,
    registry: Record<string, { type: "bool"; fallback: boolean }> = FLAGS,
): string[] {
    const errors: string[] = [];

    const fileFlags = doc.flags;
    if (!fileFlags || typeof fileFlags !== "object") {
        errors.push("rollout: missing or invalid flags map");
        return errors;
    }

    for (const name of Object.keys(registry) as (keyof typeof registry)[]) {
        if (!(name in fileFlags)) {
            errors.push(
                `rollout: registry flag "${String(name)}" missing from file`,
            );
        }
    }

    if (!(FLAGS_EPOCH in fileFlags)) {
        errors.push(`rollout: "${FLAGS_EPOCH}" missing from file`);
    }

    const allowed = new Set([...Object.keys(registry), FLAGS_EPOCH]);
    for (const name of Object.keys(fileFlags)) {
        if (!allowed.has(name)) {
            errors.push(`rollout: unknown flag "${name}" in file`);
        }
    }

    for (const [name, entry] of Object.entries(fileFlags)) {
        if (!entry || typeof entry !== "object") {
            errors.push(`rollout: flag "${name}" entry is not an object`);
            continue;
        }

        const { default: def, rules } = entry;

        if (name === FLAGS_EPOCH) {
            if (typeof def !== "number" || !Number.isInteger(def)) {
                errors.push(
                    `rollout: "${FLAGS_EPOCH}" default must be an integer`,
                );
            }
        } else if (name in registry) {
            if (typeof def !== "boolean") {
                errors.push(
                    `rollout: bool flag "${name}" default must be a boolean`,
                );
            }
        }

        if (!Array.isArray(rules)) {
            errors.push(`rollout: flag "${name}" rules must be an array`);
            continue;
        }
        for (const [i, rule] of rules.entries()) {
            if (rule === "internal") continue;
            if (typeof rule === "string") continue;
            errors.push(
                `rollout: flag "${name}" rule[${i}] must be "internal" or a string`,
            );
        }
    }

    return errors;
}

function parseRollout(text: string): RolloutFile {
    return Bun.YAML.parse(text) as RolloutFile;
}

describe("flags/rollout.yml registry consistency", () => {
    test("matches FLAGS and validates shape", async () => {
        const text = await Bun.file(ROLLOUT_PATH).text();
        const doc = parseRollout(text);
        const errors = validateRolloutFile(doc);
        expect(errors).toEqual([]);
    });

    test("reports missing registry flags", async () => {
        const text = await Bun.file(ROLLOUT_PATH).text();
        const doc = parseRollout(text);
        delete doc.flags!["ui-v2"];
        const errors = validateRolloutFile(doc);
        expect(errors).toContain(
            'rollout: registry flag "ui-v2" missing from file',
        );
    });
});
