import { expect, test } from "bun:test";
import { renderGroceryPage, type GroceryPageView } from "./grocery.js";

test("to-taste grocery line shows note instead of placeholder amount", () => {
    const html = renderGroceryPage({
        chrome: { theme: "light" },
        stores: [
            {
                id: "st-1",
                householdId: "hh-1",
                name: "Shop",
                sortOrder: 0,
                sections: [
                    {
                        id: "sec-1",
                        householdId: "hh-1",
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 0,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: "hh-1",
                                storeId: "st-1",
                                sectionId: "sec-1",
                                kind: "food",
                                displayName: "Salt",
                                quantity: { amount: 1, unit: "g" },
                                foodId: "food-salt",
                                checked: false,
                                note: "to taste",
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
                rules: [],
            },
        ],
        locations: [],
    } satisfies GroceryPageView);
    expect(html).toContain("Salt");
    expect(html).toContain("to taste");
    expect(html).not.toMatch(/Salt[\s\S]{0,40}1\s*g/);
});

test("to-taste put-away asks for an amount prefilled with 1 and shows the unit", () => {
    const html = renderGroceryPage({
        chrome: { theme: "light" },
        stores: [
            {
                id: "st-1",
                householdId: "hh-1",
                name: "Shop",
                sortOrder: 0,
                sections: [
                    {
                        id: "sec-1",
                        householdId: "hh-1",
                        storeId: "st-1",
                        name: "Other",
                        sortOrder: 0,
                        hidden: false,
                        isOther: true,
                        lines: [
                            {
                                id: "line-1",
                                householdId: "hh-1",
                                storeId: "st-1",
                                sectionId: "sec-1",
                                kind: "food",
                                displayName: "Salt",
                                quantity: { amount: 1, unit: "g" },
                                foodId: "food-salt",
                                checked: true,
                                note: "to taste",
                                alreadyHave: null,
                            },
                        ],
                    },
                ],
                rules: [],
            },
        ],
        locations: [{ id: "loc-1", name: "Pantry" }],
    } as unknown as GroceryPageView);
    expect(html).toMatch(/name="put_away_amount"[^>]*value="1"[^>]*required/);
    expect(html).toContain('class="muted grocery-put-away-unit"');
});
