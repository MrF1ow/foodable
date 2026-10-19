import { describe, expect, test } from "bun:test";
import { isManagedLabel, reconcile } from "./apply-pr-labels.ts";

describe("isManagedLabel", () => {
    test("managed prefixes and change labels", () => {
        expect(isManagedLabel("type:feat")).toBe(true);
        expect(isManagedLabel("area:fridge")).toBe(true);
        expect(isManagedLabel("blast:high")).toBe(true);
        expect(isManagedLabel("migration")).toBe(true);
        expect(isManagedLabel("bug")).toBe(false);
    });
});

describe("reconcile", () => {
    test("adds missing managed labels", () => {
        const r = reconcile([], ["type:feat", "blast:low"], isManagedLabel);
        expect(r.add).toEqual(["blast:low", "type:feat"]);
        expect(r.remove).toEqual([]);
    });

    test("removes stale managed labels", () => {
        const r = reconcile(
            ["type:fix", "blast:high"],
            ["type:feat", "blast:high"],
            isManagedLabel,
        );
        expect(r.add).toEqual(["type:feat"]);
        expect(r.remove).toEqual(["type:fix"]);
    });

    test("never removes protected hand labels", () => {
        const r = reconcile(
            ["needs-decision", "type:feat"],
            ["type:feat"],
            isManagedLabel,
        );
        expect(r.remove).toEqual([]);
    });

    test("leaves community labels alone", () => {
        const r = reconcile(
            ["bug", "enhancement"],
            ["type:feat"],
            isManagedLabel,
        );
        expect(r.remove).toEqual([]);
        expect(r.add).toEqual(["type:feat"]);
    });
});
