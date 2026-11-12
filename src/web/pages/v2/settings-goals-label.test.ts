import { describe, expect, test } from "bun:test";
import { formatGoalSince, goalName } from "./settings-goals-label.js";

describe("formatGoalSince", () => {
    test("a date this year is month and day", () => {
        expect(formatGoalSince("2026-10-02", "2026-11-12")).toBe("Oct 2");
    });

    test("a date from another year carries the year", () => {
        expect(formatGoalSince("2025-12-31", "2026-01-03")).toBe(
            "Dec 31, 2025",
        );
    });

    test("anything that is not a calendar date is nothing", () => {
        expect(formatGoalSince(null, "2026-11-12")).toBeNull();
        expect(formatGoalSince("", "2026-11-12")).toBeNull();
        expect(formatGoalSince("2026-02-31", "2026-11-12")).toBeNull();
    });
});

describe("goalName", () => {
    test("the trimmed name", () => {
        expect(goalName({ goal_name: " Recomp " })).toBe("Recomp");
    });

    test("no name is null", () => {
        expect(goalName({ goal_name: null })).toBeNull();
        expect(goalName({ goal_name: "  " })).toBeNull();
        expect(goalName({})).toBeNull();
        expect(goalName(null)).toBeNull();
    });
});
