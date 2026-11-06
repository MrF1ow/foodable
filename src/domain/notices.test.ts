import { expect, test } from "bun:test";
import { type Notice, sortNotices } from "./notices.js";

function n(
    code: Notice["code"],
    severity: Notice["severity"],
    id: string,
): Notice {
    return {
        code,
        severity,
        subject: { kind: "recipe_ingredient", id, recipeId: "r" },
        related: [],
        params: { name: "x" },
    };
}

test("sortNotices orders block, warn, info and is stable", () => {
    const input: Notice[] = [
        n("recipe.unknown_unit", "info", "a"),
        n("recipe.no_food", "block", "b"),
        n("recipe.no_nutrition", "warn", "c"),
        n("recipe.missing_grams_per_ml", "warn", "d"),
        n("recipe.partial_nutrition", "block", "e"),
    ];
    const sorted = sortNotices(input);
    expect(sorted.map((x) => x.subject.id)).toEqual(["b", "e", "c", "d", "a"]);
    const tie: Notice[] = [
        n("recipe.no_food", "warn", "first"),
        n("recipe.no_nutrition", "warn", "second"),
    ];
    expect(sortNotices(tie).map((x) => x.subject.id)).toEqual([
        "first",
        "second",
    ]);
});
