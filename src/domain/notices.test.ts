import { describe, expect, test } from "bun:test";
import {
    needsAttentionCount,
    noticeShortSentence,
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

    const householdDup: Notice[] = [
        {
            code: "food.possible_duplicate",
            severity: "info",
            subject: { kind: "food", id: "f1" },
            related: [{ kind: "food", id: "f2", name: "Eggs" }],
            params: {
                name: "chicken egg",
                rule: "contains_words",
                foodId: "f1",
            },
        },
    ];
    expect(tabDotsFromNotices(householdDup)).toEqual({ household: true });
});

function shortNotice(
    code: Notice["code"],
    params: Notice["params"],
    subject: Notice["subject"] = { kind: "food", id: "f1" },
): Notice {
    return { code, severity: "info", subject, related: [], params };
}

describe("noticeShortSentence", () => {
    test("a usual running low drops the reason", () => {
        expect(
            noticeShortSentence(
                shortNotice("grocery.running_low", {
                    name: "Eggs",
                    reason: "1 left, wants 6",
                }),
            ),
        ).toBe("Eggs running low");
    });

    test("a food missing for the plan names the day", () => {
        const base = {
            name: "Lemon",
            unknown: "no",
            recipeName: "Fish",
            recipeCount: 1,
        };
        // 2026-11-14 is a Saturday.
        expect(
            noticeShortSentence(
                shortNotice("plan.missing_ingredient", {
                    ...base,
                    plannedOn: "2026-11-14",
                    daysLeft: 2,
                }),
            ),
        ).toBe("Lemon missing for Saturday");
        expect(
            noticeShortSentence(
                shortNotice("plan.missing_ingredient", {
                    ...base,
                    plannedOn: "2026-11-13",
                    daysLeft: 1,
                }),
            ),
        ).toBe("Lemon missing for tomorrow");
        expect(
            noticeShortSentence(
                shortNotice("plan.missing_ingredient", {
                    ...base,
                    unknown: "yes",
                    plannedOn: "2026-11-12",
                    daysLeft: 0,
                }),
            ),
        ).toBe("Lemon: can't tell how much you have for today");
    });

    test("a weigh-in due names the last weekday, and whose when it is not the viewer's", () => {
        const weigh = shortNotice(
            "nutrition.weigh_in_due",
            {
                name: "Sam",
                days: 3,
                // 2026-11-10 is a Tuesday.
                lastWeighedOn: "2026-11-10",
            },
            { kind: "member", id: "u-sam" },
        );
        expect(noticeShortSentence(weigh)).toBe("Weigh in · last Tuesday");
        expect(noticeShortSentence(weigh, { viewerUserId: "u-sam" })).toBe(
            "Weigh in · last Tuesday",
        );
        expect(noticeShortSentence(weigh, { viewerUserId: "u-me" })).toBe(
            "Sam: weigh in · last Tuesday",
        );
        const old = shortNotice(
            "nutrition.weigh_in_due",
            { name: "Sam", days: 40, lastWeighedOn: "2026-10-03" },
            { kind: "member", id: "u-sam" },
        );
        expect(noticeShortSentence(old)).toBe("Weigh in · 40 days ago");
    });

    test("a weigh-in names the weekday only within the last week", () => {
        const at = (days: number, lastWeighedOn: string) =>
            noticeShortSentence(
                shortNotice(
                    "nutrition.weigh_in_due",
                    { name: "Sam", days, lastWeighedOn },
                    { kind: "member", id: "u-sam" },
                ),
            );
        // Today is Friday 2026-11-13. 11-10 is the most recent Tuesday.
        expect(at(2, "2026-11-11")).toBe("Weigh in · last Wednesday");
        expect(at(3, "2026-11-10")).toBe("Weigh in · last Tuesday");
        // A week back is the same weekday as today.
        expect(at(7, "2026-11-06")).toBe("Weigh in · last Friday");
        // Past a week, "last Tuesday" would name the wrong Tuesday.
        expect(at(8, "2026-11-05")).toBe("Weigh in · 8 days ago");
        expect(at(10, "2026-11-03")).toBe("Weigh in · 10 days ago");
    });

    test("a kind with no short form returns null", () => {
        expect(
            noticeShortSentence(
                shortNotice("fridge.expired", { name: "Milk" }),
            ),
        ).toBeNull();
    });
});
