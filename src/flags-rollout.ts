import { join } from "node:path";
import { FLAGS, FLAGS_EPOCH } from "./flags.js";

export type RolloutFlagEntry = {
    default?: unknown;
    rules?: unknown;
};

export type RolloutFile = {
    internal?: unknown;
    flags?: Record<string, RolloutFlagEntry>;
};

export const DEFAULT_ROLLOUT_PATH = join(
    import.meta.dir,
    "../flags/rollout.yml",
);

export function parseRolloutYaml(text: string): RolloutFile {
    return Bun.YAML.parse(text) as RolloutFile;
}

export async function loadRolloutFile(
    path = DEFAULT_ROLLOUT_PATH,
): Promise<RolloutFile> {
    const text = await Bun.file(path).text();
    return parseRolloutYaml(text);
}

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
