import { describe, expect, test } from "bun:test";
import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
import { defaultFreezeExpiry } from "../../../domain/fridge.js";
import { listExpiring } from "../../../domain/stock.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";
import { newFood } from "../../../domain/foods.js";
import type { Notice } from "../../../domain/notices.js";
import {
    buildPreviewKitchenFridgeView,
    eatPortionAmount,
    fridgeLowSubtitle,
    lowStockLevels,
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
        flags: FIXTURE_APP_CHROME_FLAGS,
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

    test("select mode: every item has a checkbox, with a confirmed Discard", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({ id: "a", displayName: "Eggs" }),
                item({ id: "b", displayName: "Spinach" }),
            ],
        });
        const body = renderKitchenFridgeBody(view);
        expect(body).toContain(
            'class="fd-kitchen-fridge-page" data-fd-select="fridge"',
        );
        expect(body).toContain('data-fd-select-toggle="fridge"');
        for (const [id, name] of [
            ["a", "Eggs"],
            ["b", "Spinach"],
        ]) {
            expect(body).toContain(
                `<input type="checkbox" class="fd-row__select-input" data-fd-select-item name="ids[]" value="${id}" aria-label="Select ${name}">`,
            );
        }
        expect(body).toContain('action="/kitchen/fridge/bulk/discard"');
        expect(body).toContain('data-one="Discard 1 item?"');
        expect(body).toContain('data-many="Discard {n} items?"');
        expect(body).toContain(
            '<input type="hidden" name="return_to" value="/kitchen/fridge">',
        );
    });

    test("select mode: an empty fridge has no Select", () => {
        const body = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, today, { items: [] }),
        );
        expect(body).not.toContain("data-fd-select-toggle");
    });

    test("the header is the same as on Groceries and Usuals", () => {
        const body = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, today, { items: [] }),
        );
        expect(body).toMatch(
            /^<h1 class="fd-kitchen-fridge-title fd-kitchen-fridge-title--phone">Kitchen<span class="fd-kitchen-fridge-count">[^<]+<\/span><\/h1>\n<header class="fd-kitchen-overview-head">\n<div class="fd-kitchen-overview-head__title">\n<h1 class="fd-kitchen-fridge-title">Kitchen<span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--phone">[^<]+<\/span><span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--desktop">[^<]+<\/span><\/h1>\n<\/div>\n<div class="fd-kitchen-overview-head__tools">\n<nav class="fd-seg fd-kitchen-overview-seg" aria-label="Kitchen sections">/,
        );
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

    test("an item id or name made of $-patterns stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const view = buildPreviewKitchenFridgeView(chrome, today, {
                items: [item({ id: payload, displayName: payload })],
                locations: [
                    {
                        id: "loc-fridge",
                        householdId: "hh",
                        name: "Fridge",
                        sortOrder: 0,
                    },
                ],
            });
            const html = renderKitchenFridgeBody(view);
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(html, "li[data-fd-fridge-row]", "id"),
            ).toEqual([`fd-fridge-row-${payload}`]);
            expect(
                await attributeValues(
                    html,
                    "li[data-fd-fridge-row]",
                    "data-sheet-id",
                ),
            ).toEqual([fridgeItemSheetId(payload)]);
        }
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

describe("a usual running low shows on its fridge row", () => {
    const chrome = {
        theme: "dark" as const,
        flags: FIXTURE_APP_CHROME_FLAGS,
        displayName: "Alex",
    };
    const locations = [
        { id: "loc-fridge", householdId: "hh", name: "Fridge", sortOrder: 0 },
    ];
    const eggs = item({
        id: "it-eggs",
        displayName: "Eggs",
        foodId: "f-eggs",
        quantity: { amount: 2, unit: "each" },
        expiresOn: "2026-11-11",
    });
    const view = (extra = {}) =>
        buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                eggs,
                item({ id: "it-milk", displayName: "Milk", foodId: "f-milk" }),
            ],
            locations,
            ...extra,
        });

    test("'<expiry> · low, below <level>' in the warning tone, with no strip", () => {
        const html = renderKitchenFridgeBody(
            view({ lowStock: new Map([["f-eggs", "6"]]) }),
        );
        expect(html).toContain(
            '<span class="fd-row__sub fd-tone fd-tone--warn">Tomorrow · low, below 6</span>',
        );
        expect(html).not.toContain("fd-notice-strip");
        expect(html).not.toContain('aria-label="Running low"');
        // Only the low item: the other row keeps its date and has no subtitle.
        expect(html.match(/low, below/g)).toHaveLength(1);
        expect(html.match(/fd-row__sub/g)).toHaveLength(1);
        expect(html).toContain('class="fd-row__date');
    });

    test("an item with no expiry says only that it is low", () => {
        const html = renderKitchenFridgeBody(
            view({
                items: [{ ...eggs, expiresOn: null }],
                lowStock: new Map([["f-eggs", "6"]]),
            }),
        );
        expect(html).toContain(
            '<span class="fd-row__sub fd-tone fd-tone--warn">low, below 6</span>',
        );
        // The row itself carries no date cell: its line says all it has to.
        expect(html).not.toContain("fd-row__date");
    });

    test("a product in the usual's family is low with it", () => {
        const html = renderKitchenFridgeBody(
            view({
                items: [{ ...eggs, foodId: "f-kirkland-eggs" }],
                foodsById: new Map([
                    [
                        "f-kirkland-eggs",
                        {
                            id: "f-kirkland-eggs",
                            genericFoodId: "f-eggs",
                            usualAmount: null,
                        },
                    ],
                ]),
                lowStock: new Map([["f-eggs", "6"]]),
            }),
        );
        expect(html).toContain("low, below 6");
    });

    test("nothing low: no subtitle on any row", () => {
        const html = renderKitchenFridgeBody(view());
        expect(html).not.toContain("fd-row__sub");
        expect(html).not.toContain("low, below");
    });

    test("fridgeLowSubtitle words the line", () => {
        expect(fridgeLowSubtitle("Nov 23", "6")).toBe("Nov 23 · low, below 6");
        expect(fridgeLowSubtitle(null, "2.5")).toBe("low, below 2.5");
    });
});

describe("lowStockLevels", () => {
    const low = (foodId: string): Notice => ({
        code: "grocery.running_low",
        severity: "warn",
        subject: { kind: "food", id: foodId },
        related: [],
        params: { name: "x", foodId, reason: "", dismissScope: "" },
    });
    const usual = (
        id: string,
        extra: Parameters<typeof newFood>[0] extends infer P
            ? Partial<P>
            : never,
    ) => ({
        ...newFood({ householdId: "hh", kind: "food", name: id }),
        id,
        ...extra,
    });

    test("the level is the one the notice compares with: its own, else a quarter of the usual amount", () => {
        const foods = [
            usual("f-own", { restockLowLevel: 6.5 }),
            usual("f-quarter", { usualAmount: { amount: 10, unit: "each" } }),
            usual("f-none", {}),
        ];
        const levels = lowStockLevels(
            [low("f-own"), low("f-quarter"), low("f-none"), low("f-unknown")],
            foods,
        );
        expect([...levels]).toEqual([
            ["f-own", "6.5"],
            ["f-quarter", "2.5"],
        ]);
    });

    test("only running-low notices count", () => {
        const other: Notice = { ...low("f-own"), code: "fridge.expiring" };
        expect(
            lowStockLevels([other], [usual("f-own", { restockLowLevel: 6 })])
                .size,
        ).toBe(0);
    });
});
