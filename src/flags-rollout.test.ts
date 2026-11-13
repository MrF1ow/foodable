import { join } from "node:path";
import { test, expect, describe } from "bun:test";
import { parseRolloutYaml, validateRolloutFile } from "./flags-rollout.js";

const ROLLOUT_PATH = join(import.meta.dir, "../flags/rollout.yml");

describe("flags/rollout.yml registry consistency", () => {
    test("matches FLAGS and validates shape", async () => {
        const text = await Bun.file(ROLLOUT_PATH).text();
        const doc = parseRolloutYaml(text);
        const errors = validateRolloutFile(doc);
        expect(errors).toEqual([]);
    });

    test("reports missing registry flags", async () => {
        const text = await Bun.file(ROLLOUT_PATH).text();
        const doc = parseRolloutYaml(text);
        delete doc.flags!["mcp-widgets-v2"];
        const errors = validateRolloutFile(doc);
        expect(errors).toContain(
            'rollout: registry flag "mcp-widgets-v2" missing from file',
        );
    });
});
