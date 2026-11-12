import { describe, expect, test } from "bun:test";
import type { GroceryLine } from "../../../domain/grocery.js";
import type { GrocerySection, GroceryStore } from "../../../domain/settings.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildGroceryV2StoreGroups,
    addStoreIdFromModal,
    groceryCheckedCount,
    groceryHeaderSubtitle,
    groceryLineRowMarkup,
    groceryLineSheetId,
    groceryOpenLineCount,
    groceryRowLabels,
    groceryV2QuantityLabel,
    GROCERY_V2_RETURN_TO,
    groceryV2ReturnTo,
    renderKitchenGroceriesBody,
    renderKitchenGroceriesV2Page,
    type KitchenGroceriesLineMeta,
    type KitchenGroceriesV2View,
    FD_GROCERY_ADD_SHEET_ID,
} from "./kitchen-groceries.js";
import type { GroceryLineView } from "../grocery.js";
import {
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";

const HH = "hh-1";

function line(
    overrides: Partial<GroceryLine> & Pick<GroceryLine, "id" | "displayName">,
): GroceryLine {
    return {
        householdId: HH,
        storeId: "st-1",
        sectionId: "sec-other",
        kind: "food",
        quantity: { amount: 1, unit: "each" },
        foodId: null,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
        ...overrides,
    };
}

function lineView(
    row: GroceryLine,
    extra: Partial<GroceryLineView> = {},
): GroceryLineView {
    return {
        ...row,
        alreadyHave: null,
        ...extra,
    };
}

function store(
    id: string,
    name: string,
    sections: GrocerySection[],
    sortOrder = 0,
): GroceryStore {
    return { id, householdId: HH, name, sortOrder };
}

describe("groceryV2QuantityLabel", () => {
    test("uses note for to-taste lines", () => {
        expect(
            groceryV2QuantityLabel(
                line({ id: "a", displayName: "Salt", note: "to taste" }),
            ),
        ).toBe("to taste");
    });
});

describe("groceryRowLabels", () => {
    test("generic line with a usual product shows the product name and tag", () => {
        const labels = groceryRowLabels(
            lineView(line({ id: "a", displayName: "Eggs", foodId: "eggs" }), {
                usualProductName: "Kirkland Large Eggs",
            }),
            { plainFoodName: "Eggs", isUsual: true },
        );
        expect(labels.tag).toBe("usual");
        expect(labels.title).toBe("Kirkland Large Eggs");
        expect(labels.subtitle).toBe("Eggs");
    });

    test("product line that is the household usual shows the product and tag", () => {
        const labels = groceryRowLabels(
            lineView(
                line({
                    id: "b",
                    displayName: "Kirkland Large Eggs",
                    foodId: "kirkland",
                }),
                { usualProductName: "Kirkland Large Eggs" },
            ),
            { plainFoodName: "Eggs", isUsual: true },
        );
        expect(labels.tag).toBe("usual");
        expect(labels.title).toBe("Kirkland Large Eggs");
        expect(labels.subtitle).toBe("Eggs");
    });

    test("escapes hostile names in output via render, not in labels", () => {
        const labels = groceryRowLabels(
            lineView(
                line({ id: "x", displayName: '<img onerror="alert(1)">' }),
            ),
            { plainFoodName: null, isUsual: false },
        );
        expect(labels.title).toBe('<img onerror="alert(1)">');
    });
});

describe("buildGroceryV2StoreGroups", () => {
    const sections: GrocerySection[] = [
        {
            id: "sec-a",
            householdId: HH,
            storeId: "st-1",
            name: "Produce",
            sortOrder: 0,
            hidden: false,
            isOther: false,
        },
        {
            id: "sec-other",
            householdId: HH,
            storeId: "st-1",
            name: "Other",
            sortOrder: 8,
            hidden: false,
            isOther: true,
        },
    ];
    const stores = [store("st-1", "Safeway", sections, 0)];

    test("orders sections by sortOrder with Other last among equals", () => {
        const groups = buildGroceryV2StoreGroups({
            stores: [
                {
                    ...stores[0]!,
                    sections: [
                        {
                            ...sections[1]!,
                            lines: [
                                lineView(
                                    line({
                                        id: "o",
                                        displayName: "Other item",
                                        sectionId: "sec-other",
                                    }),
                                ),
                            ],
                        },
                        {
                            ...sections[0]!,
                            lines: [
                                lineView(
                                    line({
                                        id: "p",
                                        displayName: "Apples",
                                        sectionId: "sec-a",
                                    }),
                                ),
                            ],
                        },
                    ],
                    rules: [],
                },
            ],
            noStoreLines: [],
        });
        expect(groups[0]!.sections.map((s) => s.section.name)).toEqual([
            "Produce",
            "Other",
        ]);
    });

    test("puts lines with unknown store under No store", () => {
        const orphan = lineView(
            line({
                id: "orphan",
                displayName: "Loose item",
                storeId: "missing",
            }),
        );
        const groups = buildGroceryV2StoreGroups({
            stores: [
                {
                    ...stores[0]!,
                    sections: sections.map((s) => ({ ...s, lines: [] })),
                    rules: [],
                },
            ],
            noStoreLines: [orphan],
        });
        expect(groups.some((g) => g.storeName === "No store")).toBe(true);
        const noStore = groups.find((g) => g.storeName === "No store");
        expect(noStore?.sections[0]?.lines[0]?.displayName).toBe("Loose item");
    });
});

describe("renderKitchenGroceriesV2Page", () => {
    const chrome = {
        theme: "light" as const,
        attention: { count: 0, tabs: {} },
        flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
        identity: {
            viewerName: "Alex",
            viewerRole: "owner" as const,
            householdName: "Home",
            memberCount: 1,
        },
    };

    function baseView(
        overrides: Partial<KitchenGroceriesV2View> = {},
    ): KitchenGroceriesV2View {
        return {
            chrome,
            stores: [
                {
                    id: "st-1",
                    householdId: HH,
                    name: "Shop",
                    sortOrder: 0,
                    rules: [],
                    sections: [
                        {
                            id: "sec-1",
                            householdId: HH,
                            storeId: "st-1",
                            name: "Other",
                            sortOrder: 0,
                            hidden: false,
                            isOther: true,
                            lines: [
                                lineView(
                                    line({ id: "l1", displayName: "Milk" }),
                                ),
                            ],
                        },
                    ],
                },
            ],
            locations: [{ id: "loc-1", name: "Fridge" }],
            lineMeta: new Map<string, KitchenGroceriesLineMeta>(),
            noStoreLines: [],
            checkedLines: [],
            openLineCount: 1,
            ...overrides,
        };
    }

    test("renders store chips and grocery rows", () => {
        const html = renderKitchenGroceriesV2Page(baseView());
        expect(html).toContain("fd-kitchen-groceries-page");
        expect(html).toContain("fd-chip");
        expect(html).toContain("Milk");
        expect(html).toContain('href="/kitchen/groceries"');
    });

    test("checked lines stay in their section with a put-away link below", () => {
        const checked = lineView(
            line({ id: "c1", displayName: "Bread", checked: true }),
        );
        const body = renderKitchenGroceriesBody(
            baseView({
                stores: [
                    {
                        ...baseView().stores[0]!,
                        sections: [
                            {
                                ...baseView().stores[0]!.sections[0]!,
                                lines: [checked],
                            },
                        ],
                    },
                ],
                checkedLines: [checked],
                openLineCount: 0,
            }),
        );
        expect(body).toContain("fd-row__title--done");
        expect(body).not.toContain("Checked off");
        expect(body).toContain("fd-kitchen-grocery-put-link");
        expect(body).toContain("Put 1 away in the kitchen");
        expect(body).toContain('action="/kitchen/groceries/put-away"');
        expect(body).toContain("From the grocery list into the kitchen");
        expect(body).toContain("Clear checked");
    });

    test("header subtitle counts items to get", () => {
        const body = renderKitchenGroceriesBody(baseView({ openLineCount: 8 }));
        expect(body).toContain("8 to get");
    });

    test("add-to-list field opens the grocery add sheet", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).toContain("fd-kitchen-grocery-add");
        expect(body).toContain(
            `data-fd-open-sheet="${FD_GROCERY_ADD_SHEET_ID}"`,
        );
        expect(body).toContain(`id="${FD_GROCERY_ADD_SHEET_ID}"`);
        expect(body).toContain('action="/kitchen/groceries/lines"');
    });

    test("walking-order footnote appears for a single store filter", () => {
        const body = renderKitchenGroceriesBody(
            baseView({ selectedStoreId: "st-1" }),
        );
        expect(body).toContain("fd-kitchen-grocery-footnote");
        expect(body).toContain("Shop&rsquo;s walking order");
        expect(body).toContain('href="/settings/household"');
    });

    test("store headings appear in the All view with multiple stores", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                stores: [
                    {
                        ...baseView().stores[0]!,
                        id: "st-a",
                        name: "Safeway",
                        sections: baseView().stores[0]!.sections,
                    },
                    {
                        ...baseView().stores[0]!,
                        id: "st-b",
                        name: "Costco",
                        sections: [
                            {
                                ...baseView().stores[0]!.sections[0]!,
                                id: "sec-b",
                                storeId: "st-b",
                                lines: [
                                    lineView(
                                        line({
                                            id: "l2",
                                            displayName: "Bananas",
                                            storeId: "st-b",
                                            sectionId: "sec-b",
                                        }),
                                    ),
                                ],
                            },
                        ],
                    },
                ],
                openLineCount: 2,
            }),
        );
        expect(body).toContain("fd-kitchen-grocery-store__title");
        expect(body).toContain("Safeway");
        expect(body).toContain("Costco");
    });

    test("return_to keeps the store chip when a store is selected", () => {
        const body = renderKitchenGroceriesBody(
            baseView({ selectedStoreId: "st-1" }),
        );
        expect(body).toContain(
            `name="return_to" value="${groceryV2ReturnTo("st-1")}"`,
        );
    });

    test("All chip count includes lines with no store", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                noStoreLines: [
                    lineView(
                        line({
                            id: "orphan",
                            displayName: "Loose",
                            storeId: "missing",
                        }),
                    ),
                ],
                openLineCount: 2,
            }),
        );
        expect(body).toContain(
            'fd-chip__label">All</span><span class="fd-chip__count">2</span>',
        );
    });

    test("hostile line name is escaped in markup", () => {
        const hostile = lineView(
            line({ id: "bad", displayName: "<script>alert(1)</script>" }),
        );
        const body = renderKitchenGroceriesBody(
            baseView({
                stores: [
                    {
                        ...baseView().stores[0]!,
                        sections: [
                            {
                                ...baseView().stores[0]!.sections[0]!,
                                lines: [hostile],
                            },
                        ],
                    },
                ],
            }),
        );
        expect(body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(body).not.toContain("<script>alert(1)</script>");
    });
});

describe("groceryOpenLineCount", () => {
    test("counts only unchecked lines", () => {
        expect(
            groceryOpenLineCount([
                line({ id: "a", displayName: "A", checked: false }),
                line({ id: "b", displayName: "B", checked: true }),
            ]),
        ).toBe(1);
    });
});

test("groceryLineSheetId is stable", () => {
    expect(groceryLineSheetId("line-1")).toBe("fd-grocery-line-line-1");
});

describe("groceryHeaderSubtitle", () => {
    test("uses to get wording", () => {
        expect(groceryHeaderSubtitle(1)).toBe("1 to get");
        expect(groceryHeaderSubtitle(4)).toBe("4 to get");
    });
});

describe("groceryCheckedCount", () => {
    test("prefers checkedLines when set", () => {
        const checked = lineView(
            line({ id: "c1", displayName: "Bread", checked: true }),
        );
        expect(
            groceryCheckedCount({
                stores: [],
                noStoreLines: [],
                checkedLines: [checked],
            }),
        ).toBe(1);
    });
});

test("addStoreIdFromModal parses grocery add modal ids", () => {
    expect(addStoreIdFromModal("grocery-add-food-st-1")).toBe("st-1");
    expect(addStoreIdFromModal("grocery-add-store")).toBe(null);
});

describe("groceryLineRowMarkup score badge", () => {
    test("shows score badge only for scored packaged foods", () => {
        const row = lineView(
            line({ id: "soup", displayName: "Chicken soup", foodId: "f-soup" }),
        );
        const view = {
            lineMeta: new Map<string, KitchenGroceriesLineMeta>([
                [
                    "soup",
                    {
                        plainFoodName: null,
                        isUsual: false,
                        allergenWarning: null,
                        storeName: "Costco",
                        sectionName: "Pantry",
                        productScore: 41,
                    },
                ],
            ]),
        };
        const html = String(
            groceryLineRowMarkup(row, view, GROCERY_V2_RETURN_TO),
        );
        expect(html).toContain("fd-score--middling");
        expect(html).toContain(">41<");

        const plain = String(
            groceryLineRowMarkup(
                row,
                {
                    lineMeta: new Map([
                        [
                            "soup",
                            {
                                plainFoodName: null,
                                isUsual: false,
                                allergenWarning: null,
                                storeName: "Costco",
                                sectionName: "Pantry",
                                productScore: null,
                            },
                        ],
                    ]),
                },
                GROCERY_V2_RETURN_TO,
            ),
        );
        expect(plain).not.toContain("fd-score");
    });
});

describe("groceryLineRowMarkup with $-patterns in the line", () => {
    test("a line id or name made of $-patterns stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const row = lineView(line({ id: payload, displayName: payload }));
            const html = String(
                groceryLineRowMarkup(
                    row,
                    { lineMeta: new Map() },
                    GROCERY_V2_RETURN_TO,
                ),
            );
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(html, "li[data-fd-grocery-row]", "id"),
            ).toEqual([`fd-grocery-row-${payload}`]);
            const overview = String(
                groceryLineRowMarkup(
                    row,
                    { lineMeta: new Map() },
                    GROCERY_V2_RETURN_TO,
                    { overview: true },
                ),
            );
            expect(await injectedAttributes(overview)).toEqual([]);
            expect(
                await attributeValues(
                    overview,
                    "li[data-fd-grocery-row-overview]",
                    "id",
                ),
            ).toEqual([`fd-grocery-row-${payload}`]);
        }
    });
});
