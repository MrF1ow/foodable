import { expect, test } from "bun:test";
import { cleanGoalLabel, GOAL_NAME_MAX, GOAL_NOTE_MAX } from "./goal-label.js";

test("trims, and blank or null mean no value", () => {
    expect(cleanGoalLabel("goal_name", "  Recomp ")).toBe("Recomp");
    expect(cleanGoalLabel("goal_name", "   ")).toBeNull();
    expect(cleanGoalLabel("goal_note", null)).toBeNull();
});

test("a name of 40 characters passes and 41 is refused with a clear message", () => {
    expect(cleanGoalLabel("goal_name", "x".repeat(GOAL_NAME_MAX))).toHaveLength(
        GOAL_NAME_MAX,
    );
    expect(() => cleanGoalLabel("goal_name", "x".repeat(41))).toThrow(
        "Goal name must be at most 40 characters.",
    );
});

test("length counts characters, not UTF-16 units", () => {
    expect(
        cleanGoalLabel("goal_name", "🥗".repeat(GOAL_NAME_MAX)),
    ).not.toBeNull();
    expect(() =>
        cleanGoalLabel("goal_note", "n".repeat(GOAL_NOTE_MAX + 1)),
    ).toThrow("Goal note must be at most 280 characters.");
});
