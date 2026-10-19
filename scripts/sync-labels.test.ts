import { describe, expect, test } from "bun:test";
import { planSync } from "./sync-labels.ts";

describe("planSync", () => {
    test("create missing catalog labels", () => {
        const plan = planSync(["bug"], ["bug", "type:feat"], false);
        expect(plan.create).toEqual(["type:feat"]);
        expect(plan.update).toEqual(["bug"]);
        expect(plan.delete).toEqual([]);
    });

    test("delete only when prune", () => {
        const plan = planSync(["bug", "orphan"], ["bug"], false);
        expect(plan.delete).toEqual([]);
        const pruned = planSync(["bug", "orphan"], ["bug"], true);
        expect(pruned.delete).toEqual(["orphan"]);
    });
});
