import { expect, test } from "bun:test";
import {
    needsAttentionCount,
    tabDotsFromNotices,
    type Notice,
    sortNotices,
} from "./notices.js";

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

test("needsAttentionCount counts warn and info, not block", () => {
    const notices: Notice[] = [
        n("fridge.expired", "warn", "a"),
        n("fridge.expiring", "info", "b"),
        n("recipe.allergen", "block", "c"),
    ];
    expect(needsAttentionCount(notices)).toBe(2);
});

test("tabDotsFromNotices lights only tabs that own the code", () => {
    const fridgeOnly: Notice[] = [
        {
            code: "fridge.expiring",
            severity: "info",
            subject: { kind: "fridge_item", id: "f1" },
            related: [],
            params: { name: "Milk" },
        },
    ];
    expect(tabDotsFromNotices(fridgeOnly)).toEqual({ fridge: true });

    const recipeOnly: Notice[] = [
        {
            code: "recipe.no_food",
            severity: "warn",
            subject: { kind: "recipe_ingredient", id: "i1", recipeId: "r1" },
            related: [],
            params: { name: "Salt" },
        },
    ];
    expect(tabDotsFromNotices(recipeOnly)).toEqual({ recipes: true });

    const both: Notice[] = [...fridgeOnly, ...recipeOnly];
    expect(tabDotsFromNotices(both)).toEqual({
        fridge: true,
        recipes: true,
    });
    expect(tabDotsFromNotices(both).household).toBeUndefined();
});
