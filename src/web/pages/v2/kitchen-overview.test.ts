import { describe, expect, test } from "bun:test";
import type { FridgeLocation } from "../../../domain/fridge.js";
import type { GroceryLine, GrocerySnapshot } from "../../../domain/grocery.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeBody,
} from "./kitchen-fridge.js";
import {
    KITCHEN_GROCERIES_TAB_HREF,
    buildKitchenFridgeGroceryOverview,
    kitchenFridgeDesktopSubtitle,
    renderKitchenOverviewGroceriesCard,
    wrapKitchenOverviewColumns,
} from "./kitchen-overview.js";
import { buildPreviewKitchenGroceriesView } from "./kitchen-groceries.js";

const today = "2026-11-10";

function grocerySnapshot(
    lines: GroceryLine[],
    stores: GrocerySnapshot["stores"] = [
        {
            id: "s1",
            householdId: "hh",
            name: "Costco",
            sortOrder: 0,
        },
    ],
): GrocerySnapshot {
    return {
        stores,
        sections: [
            {
                id: "sec1",
                householdId: "hh",
                storeId: "s1",
                name: "Dairy",
                sortOrder: 0,
                hidden: false,
                isOther: false,
            },
        ],
        lines,
    };
}

function groceryLine(
    overrides: Partial<GroceryLine> & Pick<GroceryLine, "id" | "displayName">,
): GroceryLine {
    return {
        householdId: "hh",
        storeId: "s1",
        sectionId: "sec1",
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

describe("kitchenFridgeDesktopSubtitle", () => {
    test("joins item and grocery counts", () => {
        expect(kitchenFridgeDesktopSubtitle(24, 8)).toBe("24 items · 8 to get");
    });
});

describe("renderKitchenOverviewGroceriesCard", () => {
    test("shows store chips, sections, check forms, and put away", () => {
        const overview = buildKitchenFridgeGroceryOverview(
            grocerySnapshot([
                groceryLine({ id: "g1", displayName: "Milk" }),
                groceryLine({
                    id: "g2",
                    displayName: "<img onerror=alert(1)>",
                }),
                groceryLine({
                    id: "g3",
                    displayName: "Bread",
                    checked: true,
                }),
            ]),
        );
        const html = renderKitchenOverviewGroceriesCard(overview);
        expect(html).toContain("Groceries");
        expect(html).toContain("2 to get");
        expect(html).toContain("fd-kitchen-grocery-stores");
        expect(html).toContain("Dairy");
        expect(html).toContain("Milk");
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
        expect(html).toContain("/kitchen/groceries/lines/g1/check");
        expect(html).toContain('name="return_to"');
        expect(html).toContain("/kitchen/fridge");
        expect(html).toContain('href="/kitchen/groceries?put-away=1"');
        expect(html).toContain("Put 1 away");
        expect(html).toContain(`href="${KITCHEN_GROCERIES_TAB_HREF}"`);
    });
});

describe("wrapKitchenOverviewColumns", () => {
    test("wraps locations and groceries without duplicate wrapper ids", () => {
        const html = wrapKitchenOverviewColumns(
            '<section class="fd-kitchen-fridge-loc">A</section>',
            '<aside class="fd-kitchen-overview-groceries">G</aside>',
        );
        expect(html).toContain("fd-kitchen-overview-columns");
        expect(html).toContain("fd-kitchen-overview-locs");
        expect(html.match(/id="/g)?.length ?? 0).toBe(0);
    });
});

describe("desktop overview markup in fridge body", () => {
    const chrome = {
        theme: "dark" as const,
        flags: FIXTURE_APP_CHROME_FLAGS,
        attention: { count: 0, tabs: {} },
        displayName: "Alex",
    };

    const locations: FridgeLocation[] = [
        {
            id: "loc-fridge",
            householdId: "hh",
            name: "Fridge",
            sortOrder: 0,
        },
        {
            id: "loc-pantry",
            householdId: "hh",
            name: "Pantry",
            sortOrder: 2,
        },
        {
            id: "loc-freezer",
            householdId: "hh",
            name: "Freezer",
            sortOrder: 1,
        },
    ];

    const groceries = buildPreviewKitchenGroceriesView(chrome);
    const groceryOverview = buildKitchenFridgeGroceryOverview({
        stores: groceries.stores.map((store) => ({
            id: store.id,
            householdId: store.householdId,
            name: store.name,
            sortOrder: store.sortOrder,
        })),
        sections: groceries.stores.flatMap((store) =>
            store.sections.map((section) => ({
                id: section.id,
                householdId: section.householdId,
                storeId: section.storeId,
                name: section.name,
                sortOrder: section.sortOrder,
                hidden: section.hidden,
                isOther: section.isOther,
            })),
        ),
        lines: groceries.stores.flatMap((store) =>
            store.sections.flatMap((section) => section.lines),
        ),
    });

    test("renders desktop header, columns, and escaped content", () => {
        const body = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, today, {
                locations,
                items: [
                    {
                        id: "it-1",
                        householdId: "hh",
                        locationId: "loc-fridge",
                        kind: "food",
                        displayName: "Eggs",
                        quantity: { amount: 6, unit: "each" },
                        foodId: "f-1",
                        expiresOn: "2026-11-12",
                    },
                ],
                groceryOverview,
            }),
        );
        expect(body).toContain("fd-kitchen-overview-head");
        expect(body).toContain("fd-kitchen-overview-seg");
        expect(body).toContain('href="/kitchen/fridge"');
        expect(body).toContain('href="/kitchen/groceries"');
        expect(body).toContain("Overview");
        expect(body).toContain("Add item");
        expect(body).toContain("fd-kitchen-overview-columns");
        const order = [
            ...body.matchAll(/id="fd-kitchen-loc-(loc-[^"]+)"/g),
        ].map((m) => m[1]);
        expect(order).toEqual(["loc-fridge", "loc-freezer", "loc-pantry"]);
        expect(body).toContain("fd-kitchen-overview-loc--empty");
        expect(body).toContain("fd-kitchen-overview-groceries");
    });

    test("does not duplicate item sheet ids", () => {
        const body = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, today, {
                locations,
                items: [
                    {
                        id: "it-1",
                        householdId: "hh",
                        locationId: "loc-fridge",
                        kind: "food",
                        displayName: "Eggs",
                        quantity: { amount: 6, unit: "each" },
                        foodId: "f-1",
                        expiresOn: "2026-11-12",
                    },
                ],
                groceryOverview,
            }),
        );
        const sheets =
            body.match(/<dialog[^>]*id="fd-fridge-item-it-1"/g) ?? [];
        expect(sheets).toHaveLength(1);
        expect(body).not.toMatch(/id="fd-grocery-line-/);
    });
});
