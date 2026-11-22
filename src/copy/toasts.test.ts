import { expect, test } from "bun:test";
import { TOASTS } from "./toasts.js";

/**
 * A toast shows only when something failed or did not do what it looked like.
 * Every success toast is gone: the screen already shows it. Adding a key here
 * is a decision, so it is listed by name.
 */
const KEEP_LIST = [
    "fridge.item.eaten.unknown",
    "fridge.item.already-on-grocery",
    "nutrition.meal.copy-yesterday.none",
    "recipes.cooked.short",
    "recipes.cooked.changed",
    "recipes.mention.error",
    "plan.notice",
    "plan.already",
    "plan.missing.added.unknown",
    "plan.missing.none",
    "notice.added.check",
    "notice.error",
    "recipes.unverified.blocked",
    "recipes.import.duplicate",
];

test("TOASTS holds exactly the keep list", () => {
    expect(Object.keys(TOASTS).sort()).toEqual([...KEEP_LIST].sort());
});

test("no keep-list toast announces a success", () => {
    for (const [key, entry] of Object.entries(TOASTS)) {
        expect(entry.kind, key).not.toBe("success");
    }
});

test("the blocked-recipe toast names no control the app lacks", () => {
    const text = TOASTS["recipes.unverified.blocked"].text;
    expect(text).not.toContain("check again");
    expect(text).toContain("Ask your AI assistant");
});

test("the cooked-short toast is true for a shortfall and an uncounted ingredient alike", () => {
    // `cookSheetToastFlash` puts both under this one key, so "short" alone
    // would mislabel the ingredients that were never counted.
    expect(TOASTS["recipes.cooked.short"].text).toBe(
        "Recipe cooked, but some ingredients were short or not counted: {names}",
    );
});
