import { expect, test } from "bun:test";
import type { Notice } from "../domain/notices.js";
import { productMemberReasonLine } from "./product-member-reason.js";

function notice(over: Partial<Notice> & Pick<Notice, "code">): Notice {
    return {
        severity: "info",
        subject: { kind: "food", id: "f1" },
        related: [{ kind: "member", id: "u1", name: "Alex" }],
        params: {},
        ...over,
    };
}

test("allergen avoid line matches product screen copy", () => {
    const line = productMemberReasonLine([
        notice({
            code: "food.product_allergen",
            severity: "block",
            params: { allergens: ["milk"] },
        }),
    ]);
    expect(line).toBe("Contains Milk · listed as an allergy");
});

test("trace careful line matches product screen copy", () => {
    const line = productMemberReasonLine([
        notice({
            code: "food.product_trace",
            severity: "warn",
            params: { allergens: ["tree nut"] },
        }),
    ]);
    expect(line).toBe("May contain traces of tree nut");
});

test("goal fit line uses daily target", () => {
    const line = productMemberReasonLine([
        notice({
            code: "food.product_goal",
            params: {
                servingAmount: "17",
                remainingAmount: "97",
                word: "protein",
                unit: "g",
            },
        }),
    ]);
    expect(line).toBe("Fits today · 17 g protein toward your 114 g");
});
