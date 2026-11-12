import { describe, expect, test } from "bun:test";
import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
import { defaultFreezeExpiry } from "../../../domain/fridge.js";
import { listExpiring } from "../../../domain/stock.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildPreviewKitchenFridgeView,
    eatPortionAmount,
    fridgeItemSheetId,
    formatFridgeExpiryLabel,
    formatSheetExpiryLine,
    groupFridgeItemsByLocation,
    renderKitchenFridgeBody,
    renderKitchenFridgeV2Page,
} from "./kitchen-fridge.js";

const today = "2026-11-10";

function item(
    overrides: Partial<FridgeItem> & Pick<FridgeItem, "id" | "displayName">,
): FridgeItem {
    return {
        householdId: "hh",
        locationId: "loc-fridge",
        kind: "food",
        quantity: { amount: 2, unit: "each" },
        foodId: "f-1",
        expiresOn: "2026-11-12",
        ...overrides,
    };
}

describe("formatFridgeExpiryLabel", () => {
    test("formats ISO as short month day", () => {
        expect(formatFridgeExpiryLabel("2026-11-19")).toBe("Nov 19");
    });
});

describe("formatSheetExpiryLine", () => {
    test("words expiry relative to today", () => {
        expect(formatSheetExpiryLine("2026-11-10", "2026-11-15")).toBe(
            "Expires in 5 days",
        );
    });
});

describe("eatPortionAmount", () => {
    test("prefills one cup when no usual amount", () => {
        const amount = eatPortionAmount(
            item({
                id: "a",
                displayName: "Berries",
                quantity: { amount: 2, unit: "cup" },
            }),
            undefined,
        );
        expect(amount).toBe(1);
    });
});

describe("groupFridgeItemsByLocation", () => {
    const locations: FridgeLocation[] = [
        {
            id: "loc-pantry",
            householdId: "hh",
            name: "Pantry",
            sortOrder: 2,
        },
        {
            id: "loc-fridge",
            householdId: "hh",
            name: "Fridge",
            sortOrder: 0,
        },
        {
            id: "loc-freezer",
            householdId: "hh",
            name: "Freezer",
            sortOrder: 1,
        },
    ];

    test("orders locations by sortOrder then name", () => {
        const groups = groupFridgeItemsByLocation(locations, [
            item({ id: "a", displayName: "A", locationId: "loc-pantry" }),
            item({ id: "b", displayName: "B", locationId: "loc-fridge" }),
        ]);
        expect(groups.map((g) => g.location.name)).toEqual([
            "Fridge",
            "Freezer",
            "Pantry",
        ]);
        expect(
            groups.find((g) => g.location.id === "loc-fridge")!.items,
        ).toHaveLength(1);
    });
});

describe("renderKitchenFridgeV2Page", () => {
    const chrome = {
        theme: "dark" as const,
        flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
        attention: { count: 0, tabs: {} },
        displayName: "Alex",
    };

    test("escapes hostile item names in the list", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({
                    id: "x",
                    displayName: '<script>alert("x")</script>',
                }),
            ],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
        });
        const html = renderKitchenFridgeV2Page(view);
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    test("use soon lists expiring and expired items", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({
                    id: "exp",
                    displayName: "Old milk",
                    expiresOn: "2026-11-09",
                }),
                item({
                    id: "ok",
                    displayName: "Fresh",
                    expiresOn: "2026-12-01",
                }),
                item({
                    id: "soon",
                    displayName: "Salmon",
                    expiresOn: "2026-11-11",
                }),
            ],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
        });
        const expiring = listExpiring(view.items, today, 3);
        expect(expiring.map((i) => i.id).sort()).toEqual(["exp", "soon"]);
        const body = renderKitchenFridgeBody(view);
        const strip = body.slice(
            body.indexOf("fd-kitchen-use-soon"),
            body.indexOf("fd-kitchen-fridge-loc"),
        );
        expect(strip).toContain("Use soon");
        expect(strip).toContain("Salmon");
        expect(strip).toContain("Old milk");
        expect(strip).not.toContain("Fresh");
    });

    test("use soon cards say which recipe uses the item", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({
                    id: "soon",
                    displayName: "Salmon",
                    expiresOn: "2026-11-11",
                }),
                item({
                    id: "no",
                    displayName: "Milk",
                    expiresOn: "2026-11-11",
                }),
            ],
            useSoonUses: [
                {
                    item: {
                        id: "soon",
                        displayName: "Salmon",
                        expiresOn: "2026-11-11",
                    },
                    recipes: [
                        {
                            recipeId: "r1",
                            name: "Salmon & <rice>",
                            incomplete: false,
                        },
                    ],
                },
                {
                    item: {
                        id: "no",
                        displayName: "Milk",
                        expiresOn: "2026-11-11",
                    },
                    recipes: [],
                },
            ],
        });
        const body = renderKitchenFridgeBody(view);
        const strip = body.slice(
            body.indexOf("fd-kitchen-use-soon"),
            body.indexOf("fd-kitchen-fridge-loc"),
        );
        expect(strip.match(/fd-kitchen-use-card__use"/g)).toHaveLength(1);
        expect(strip).toContain("Use in: Salmon &amp; &lt;rice&gt;");
    });

    test("hides use soon when nothing qualifies", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({
                    id: "ok",
                    displayName: "Rice",
                    expiresOn: "2026-12-01",
                }),
            ],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
        });
        expect(renderKitchenFridgeBody(view)).not.toContain("Use soon");
    });

    test("item sheet exposes member actions with correct form targets", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            openItemId: "it-1",
            items: [
                item({
                    id: "it-1",
                    displayName: "Eggs",
                    foodId: "f-eggs",
                }),
            ],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
            foodsById: new Map([
                [
                    "f-eggs",
                    {
                        id: "f-eggs",
                        usualAmount: { amount: 2, unit: "each" },
                        genericFoodId: null,
                    },
                ],
            ]),
            freezeDefaultExpiry: defaultFreezeExpiry(today),
        });
        const html = renderKitchenFridgeV2Page(view);
        const sheetId = fridgeItemSheetId("it-1");
        expect(html).toContain(`id="${sheetId}"`);
        expect(html).toContain('action="/kitchen/fridge/items/it-1/eat"');
        expect(html).toContain('action="/kitchen/fridge/items/it-1/discard"');
        expect(html).toContain('action="/kitchen/fridge/items/it-1/freeze"');
        expect(html).toContain('action="/kitchen/fridge/items/it-1"');
        expect(html).toContain(
            'action="/kitchen/fridge/items/it-1/add-to-grocery"',
        );
        expect(html).toContain('href="/kitchen/usuals/f-eggs"');
        expect(html).toContain("How much is left");
        expect(html).toContain('name="qty_amount"');
        expect(html).toContain('value="2"');
        expect(html).toContain(">Save</button>");
        // Freeze asks for the date first: a revealed panel with a visible
        // date input holding the default, not a hidden field.
        const freezePanel = html.match(
            /<form id="[^"]*" method="post" action="\/kitchen\/fridge\/items\/it-1\/freeze"[^>]*>[\s\S]*?<\/form>/,
        )?.[0];
        expect(freezePanel).toContain(" hidden>");
        expect(freezePanel).toContain("Freeze until");
        expect(freezePanel).toContain(
            `type="date" name="expires_on" value="${defaultFreezeExpiry(today)}"`,
        );
        expect(html).toMatch(
            /aria-controls="[^"]+" aria-expanded="false" data-fd-reveal=/,
        );
    });

    test("kitchen header and use-soon order", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({
                    id: "exp",
                    displayName: "Old milk",
                    expiresOn: "2026-11-09",
                }),
            ],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
        });
        const html = renderKitchenFridgeV2Page(view);
        const tabs = html.indexOf("fd-kitchen-tabs");
        const title = html.indexOf("fd-kitchen-fridge-title--phone");
        expect(html).toContain(">Kitchen<");
        expect(title).toBeGreaterThan(-1);
        expect(tabs).toBeGreaterThan(title);
        const card = html.slice(
            html.indexOf('class="fd-kitchen-use-card"'),
            html.indexOf(
                "</button>",
                html.indexOf('class="fd-kitchen-use-card"'),
            ),
        );
        expect(card.indexOf("fd-kitchen-use-card__when")).toBeLessThan(
            card.indexOf("fd-kitchen-use-card__title"),
        );
    });

    test("swipe slots on editable rows", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [item({ id: "it-2", displayName: "Yogurt" })],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
        });
        const body = renderKitchenFridgeBody(view);
        expect(body).toContain("data-swipe-right=");
        expect(body).toContain("data-swipe-left=");
        expect(body).toContain("Ate some");
        expect(body).toContain("Toss");
    });

    test("empty locations shows empty state", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [],
            locations: [],
        });
        expect(renderKitchenFridgeBody(view)).toContain(
            "fd-kitchen-fridge-empty",
        );
    });

    test("item sheet nav rows lead with icons", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [item({ id: "it-1", displayName: "Milk" })],
            locations: [
                {
                    id: "loc-fridge",
                    householdId: "hh",
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
            openItemId: "it-1",
        });
        const body = renderKitchenFridgeBody(view);
        expect(body).toContain("fd-kitchen-sheet-row__icon");
        expect(body).toContain('name="expires_on"');
        expect(body).toContain('name="location_id"');
    });
});
