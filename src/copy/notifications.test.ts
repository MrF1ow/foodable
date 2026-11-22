import { describe, expect, test } from "bun:test";
import { NOTICE_SEVERITY } from "../domain/notices.js";
import { NOTIFICATION_KIND_IDS } from "../domain/notification-kinds.js";
import type { NotificationRow } from "../domain/notifications.js";
import {
    eventSentence,
    NOTIFICATION_KIND_LABELS,
    notificationSentence,
} from "./notifications.js";
import { noticeSentence } from "./notices.js";

function row(
    kind: NotificationRow["kind"],
    payload: Record<string, unknown>,
    over: Partial<NotificationRow> = {},
): NotificationRow {
    return {
        id: "n1",
        householdId: "hh",
        recipientUserId: "u1",
        kind,
        bucket: "household",
        source: "event",
        noticeKey: "event:e1",
        subjectKind: null,
        subjectId: null,
        actorUserId: "u2",
        payload,
        createdAt: "2026-12-01T12:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        ...over,
    };
}

describe("NOTIFICATION_KIND_LABELS", () => {
    test("every kind has a label, and Allergens reads as it does in Settings", () => {
        for (const kind of NOTIFICATION_KIND_IDS) {
            expect(NOTIFICATION_KIND_LABELS[kind].length).toBeGreaterThan(0);
        }
        expect(NOTIFICATION_KIND_LABELS.food_expiring).toBe("Food expiring");
        expect(NOTIFICATION_KIND_LABELS.recipe_changes).toBe(
            "Recipe changes by others",
        );
        expect(NOTIFICATION_KIND_LABELS.allergens).toBe("Allergens");
    });
});

describe("eventSentence", () => {
    test("a removed recipe names who removed it and keeps the frozen name", () => {
        expect(
            eventSentence(
                row("recipe_changes", { recipeName: "Beef chili" }),
                "Sarah",
            ),
        ).toBe("Sarah removed Beef chili.");
    });

    test("a planned, unplanned and moved recipe name the day and the slot", () => {
        const base = {
            recipeName: "Lasagna",
            date: "2026-12-01",
            slot: "dinner",
        };
        expect(
            eventSentence(
                row("week_plan_changes", { ...base, change: "planned" }),
                "Sarah",
            ),
        ).toBe("Sarah planned Lasagna for dinner on Tue, Dec 1.");
        expect(
            eventSentence(
                row("week_plan_changes", { ...base, change: "unplanned" }),
                "Sarah",
            ),
        ).toBe("Sarah took Lasagna off dinner on Tue, Dec 1.");
        expect(
            eventSentence(
                row("week_plan_changes", {
                    ...base,
                    change: "moved",
                    fromDate: "2026-11-30",
                    fromSlot: "lunch",
                }),
                "Sarah",
            ),
        ).toBe(
            "Sarah moved Lasagna from lunch on Mon, Nov 30 to dinner on Tue, Dec 1.",
        );
    });

    test("a plan event whose recipe is gone from the payload still reads", () => {
        expect(
            eventSentence(
                row("week_plan_changes", {
                    recipeName: null,
                    date: "2026-12-01",
                    slot: "dinner",
                    change: "planned",
                }),
                "Sarah",
            ),
        ).toBe("Sarah planned a recipe for dinner on Tue, Dec 1.");
    });

    test("a moved plan without its old place says only where it went", () => {
        expect(
            eventSentence(
                row("week_plan_changes", {
                    recipeName: "Lasagna",
                    date: "2026-12-01",
                    slot: "dinner",
                    change: "moved",
                }),
                "Sarah",
            ),
        ).toBe("Sarah moved Lasagna to dinner on Tue, Dec 1.");
    });

    test("a new usual names the food and, when there is one, the product", () => {
        expect(
            eventSentence(
                row("new_usuals", {
                    foodName: "Eggs",
                    productName: "Kirkland Large Eggs",
                }),
                "Sarah",
            ),
        ).toBe("Sarah added Eggs to the usuals with Kirkland Large Eggs.");
        expect(
            eventSentence(
                row("new_usuals", { foodName: "Eggs", productName: null }),
                "Sarah",
            ),
        ).toBe("Sarah added Eggs to the usuals.");
    });

    test("a kind that is not an event is refused rather than guessed", () => {
        expect(() => eventSentence(row("food_expiring", {}), "Sarah")).toThrow(
            "food_expiring is not an event",
        );
    });
});

describe("notificationSentence", () => {
    test("a condition row reads as its notice does everywhere else", () => {
        const sentence = notificationSentence(
            row(
                "food_expiring",
                {
                    code: "fridge.expiring",
                    params: { name: "Milk", daysLeft: 2 },
                    related: [],
                },
                {
                    source: "condition",
                    noticeKey: "fridge.expiring|fridge_item|fi-1|",
                    subjectKind: "fridge_item",
                    subjectId: "fi-1",
                    actorUserId: null,
                },
            ),
            "Someone",
        );
        expect(sentence).toContain("Milk");
    });

    describe("an Allergens row names its item", () => {
        const allergen = (
            code: string,
            subjectKind: string,
            params: Record<string, unknown>,
            related = [{ kind: "member", id: "m1", name: "Pat" }],
        ) =>
            row(
                "allergens",
                { code, params, related },
                {
                    source: "condition",
                    noticeKey: `${code}|${subjectKind}|s1|`,
                    subjectKind,
                    subjectId: "s1",
                    actorUserId: null,
                },
            );

        test("a grocery line, a recipe and a fridge item each lead with their name", () => {
            expect(
                notificationSentence(
                    allergen("grocery.allergen", "grocery_line", {
                        allergens: ["peanut"],
                        name: "Peanut butter",
                    }),
                    "Someone",
                ),
            ).toBe("Peanut butter contains peanut — Pat.");
            expect(
                notificationSentence(
                    allergen("recipe.allergen", "recipe", {
                        allergens: ["peanut", "milk"],
                        name: "Pad thai",
                        recipeName: "Pad thai",
                    }),
                    "Someone",
                ),
            ).toBe("Pad thai contains peanut and milk — Pat.");
            expect(
                notificationSentence(
                    allergen(
                        "food.product_allergen",
                        "fridge_item",
                        { allergens: ["milk"], name: "Greek yogurt" },
                        [
                            { kind: "member", id: "m1", name: "Pat" },
                            { kind: "member", id: "m2", name: "Sam" },
                        ],
                    ),
                    "Someone",
                ),
            ).toBe("Greek yogurt contains milk — Pat, Sam.");
        });

        test("a row stored without a name keeps the notice's own sentence", () => {
            expect(
                notificationSentence(
                    allergen("grocery.allergen", "grocery_line", {
                        allergens: ["peanut"],
                    }),
                    "Someone",
                ),
            ).toBe("Contains peanut — Pat.");
            expect(
                notificationSentence(
                    allergen("grocery.allergen", "grocery_line", {
                        allergens: ["peanut"],
                        name: "  ",
                    }),
                    "Someone",
                ),
            ).toBe("Contains peanut — Pat.");
        });

        test("only an Allergens row is rewritten: the page sentence of a notice is unchanged", () => {
            const notice = {
                code: "grocery.allergen" as const,
                severity: "block" as const,
                subject: { kind: "grocery_line" as const, id: "s1" },
                related: [{ kind: "member" as const, id: "m1", name: "Pat" }],
                params: { allergens: ["peanut"], name: "Peanut butter" },
            };
            expect(noticeSentence(notice)).toBe("Contains peanut — Pat.");
            const expiring = notificationSentence(
                row(
                    "food_expiring",
                    {
                        code: "fridge.expiring",
                        params: { name: "Milk", daysLeft: 2 },
                        related: [],
                    },
                    {
                        source: "condition",
                        noticeKey: "fridge.expiring|fridge_item|fi-1|",
                        subjectKind: "fridge_item",
                        subjectId: "fi-1",
                        actorUserId: null,
                    },
                ),
                "Someone",
            );
            expect(expiring).toBe(
                noticeSentence({
                    code: "fridge.expiring",
                    severity: NOTICE_SEVERITY["fridge.expiring"],
                    subject: { kind: "fridge_item", id: "fi-1" },
                    related: [],
                    params: { name: "Milk", daysLeft: 2 },
                }),
            );
        });
    });

    test("an event row uses the actor's name", () => {
        expect(
            notificationSentence(
                row("recipe_changes", { recipeName: "Beef chili" }),
                "Sarah",
            ),
        ).toBe("Sarah removed Beef chili.");
    });
});
