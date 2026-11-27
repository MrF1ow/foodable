import { describe, expect, test } from "bun:test";
import type { FridgeItem, FridgeLocation } from "../../../domain/fridge.js";
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
    kitchenFridgeItemCountLabel,
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

const chrome = {
    theme: "dark" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
    displayName: "Alex",
};
const fridgeLocation: FridgeLocation = {
    id: "loc-fridge",
    householdId: "hh",
    name: "Fridge",
    sortOrder: 0,
};
const pantryLocation: FridgeLocation = {
    id: "loc-pantry",
    householdId: "hh",
    name: "Pantry",
    sortOrder: 1,
};
const body = (
    extra: Parameters<typeof buildPreviewKitchenFridgeView>[2] = {},
) =>
    renderKitchenFridgeBody(
        buildPreviewKitchenFridgeView(chrome, today, {
            locations: [fridgeLocation],
            ...extra,
        }),
    );

describe("kitchenFridgeItemCountLabel", () => {
    test("counts items", () => {
        expect(kitchenFridgeItemCountLabel(1)).toBe("1 item");
        expect(kitchenFridgeItemCountLabel(24)).toBe("24 items");
    });
});

describe("renderKitchenFridgeV2Page", () => {
    test("escapes hostile item names in the list", () => {
        const html = renderKitchenFridgeV2Page(
            buildPreviewKitchenFridgeView(chrome, today, {
                items: [
                    item({
                        id: "x",
                        displayName: '<script>alert("x")</script>',
                    }),
                ],
                locations: [fridgeLocation],
            }),
        );
        // The hostile name never reaches the markup raw. (The head's own
        // one-line script that sets html.fx is the only script tag.)
        expect(html).not.toContain('<script>alert("x")');
        expect(html).toContain("&lt;script&gt;");
    });

    test("the header is the Page header, with the shell's tabs right under it", () => {
        const html = renderKitchenFridgeV2Page(
            buildPreviewKitchenFridgeView(chrome, today, {
                items: [item({ id: "a", displayName: "Eggs" })],
                locations: [fridgeLocation],
            }),
        );
        expect(html).toMatch(
            /<header class="fd-page-header fd-kitchen-head" data-fd-kitchen-tab="fridge"><div class="fd-page-header__titles"><h1 class="fd-page-header__title">Kitchen<\/h1><p class="fd-page-header__subtitle">1 item<\/p><\/div>[\s\S]*?<\/header><nav class="fd-kitchen-tabs"/,
        );
        // No segmented switch of its own: the sidebar lists the sections.
        expect(html).not.toContain("fd-kitchen-overview-seg");
        expect(html).not.toContain("fd-kitchen-overview-head");
    });

    test("the header's Actions slot holds only add, and so does the phone's tab row", () => {
        const html = body({
            items: [item({ id: "a", displayName: "Eggs" })],
        });
        const actions = html.match(
            /<div class="fd-page-header__actions">([\s\S]*?)<\/div><\/div><\/header>/,
        )?.[1];
        expect(actions).not.toContain("fd-menu");
        expect(actions).not.toContain("data-fd-select-toggle");
        expect(actions).toContain('aria-label="Add item"');
        expect(actions).toContain('commandfor="fd-fridge-add"');
        const top = html.match(
            /<div class="fd-kitchen-fridge-top">([\s\S]*?)<\/div>\n/,
        )?.[1];
        expect(top).not.toContain("fd-menu");
        expect(top).not.toContain("data-fd-select-toggle");
        expect(top).toContain('aria-label="Add item"');
    });

    test("an empty fridge has no Select, only add", () => {
        const html = body({ items: [] });
        expect(html).not.toContain("fd-menu");
        expect(html).not.toContain("data-fd-select-toggle");
        expect(html).not.toContain("fd-selection-bar");
        expect(html).toContain('aria-label="Add item"');
        expect(html).toContain("Nothing in the fridge yet");
    });

    test("no places: says so", () => {
        const html = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, today, {
                items: [],
                locations: [],
            }),
        );
        expect(html).toContain("No places yet");
        expect(html).not.toContain('id="fd-fridge-add"');
        // The way out is the Fridge places page, not a hint about agents.
        expect(html).toContain('href="/settings/household/places"');
        expect(html).toContain("Fridge places");
    });

    test("places that hold something are sections with a count, in order, none for an empty one", () => {
        const html = body({
            locations: [
                fridgeLocation,
                {
                    ...pantryLocation,
                    id: "loc-freezer",
                    name: "Freezer",
                    sortOrder: 1,
                },
                { ...pantryLocation, sortOrder: 2 },
            ],
            items: [
                item({ id: "a", displayName: "Eggs" }),
                item({
                    id: "b",
                    displayName: "Rice",
                    locationId: "loc-pantry",
                    expiresOn: null,
                }),
            ],
        });
        const labels = [
            ...html.matchAll(
                /<h2 class="fd-section-header__label">([^<]+)<\/h2><span class="fd-section-header__count">(\d+)<\/span>/g,
            ),
        ]
            .map((m) => [m[1], m[2]])
            .filter(([label]) => label !== "Use soon");
        expect(labels).toEqual([
            ["Fridge", "1"],
            ["Pantry", "1"],
        ]);
        // Every place takes the right column; Use soon keeps the left (629226).
        const left = html.match(
            /<div class="fd-page-layout__column">([\s\S]*?)<\/div><div class="fd-page-layout__column">/,
        )?.[1];
        expect(left).not.toContain('aria-label="Fridge"');
        expect(left).not.toContain('aria-label="Pantry"');
        const right = html.split('<div class="fd-page-layout__column">')[2];
        expect(right).toContain('aria-label="Fridge"');
        expect(right).toContain('aria-label="Pantry"');
    });

    test("a row: name, amount, date at the end, score, a menu and both swipe beds", () => {
        const html = body({
            items: [
                item({
                    id: "a",
                    displayName: "Cheddar",
                    foodId: "f-ch",
                    expiresOn: "2026-12-02",
                }),
            ],
            scores: new Map([["f-ch", 52]]),
        });
        const row =
            html.match(
                /<li tabindex="0" class="fd-item-row[^"]*"[^>]*id="fd-fridge-row-a"[\s\S]*?<\/li>/,
            )?.[0] ?? "";
        expect(row).toContain(
            '<span class="fd-item-row__title" title="Cheddar">Cheddar</span>',
        );
        expect(row).toContain('<span class="fd-item-row__meta">2</span>');
        expect(row).toContain("fd-score-pill fd-score-pill--");
        expect(row).toContain('<span class="fd-item-row__value">Dec 2</span>');
        expect(row).not.toContain("fd-item-row--warning");
        expect(row).toContain('data-fd-sheet-row=""');
        expect(row).toContain(`data-sheet-id="${fridgeItemSheetId("a")}"`);
        expect(row).toContain("fd-item-row__bed--again");
        expect(row).toContain("fd-item-row__bed--delete");
        expect(row).toContain('aria-label="Ate some"');
        expect(row).toContain('aria-label="Discard"');
        expect(row).not.toContain('name="ids[]"');
    });

    test("a row's menu: Eat, Add to grocery list, Edit amount or expiry, Discard confirmed in place", () => {
        const html = body({
            items: [item({ id: "a", displayName: "Eggs", foodId: "f-eggs" })],
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
        });
        const menu =
            html.match(
                /<div class="fd-menu[^"]*" data-fd-menu data-anchor="more"><button[^>]*aria-label="Actions for Eggs"[\s\S]*?<\/div><\/div><\/div><\/div>/,
            )?.[0] ?? "";
        expect(menu).toContain('action="/kitchen/fridge/items/a/eat"');
        expect(menu).toContain(
            '<input type="hidden" name="qty_amount" value="2">',
        );
        expect(menu).toContain(
            '<input type="hidden" name="return_to" value="/kitchen/fridge">',
        );
        expect(menu).toContain("Eat");
        expect(menu).toContain(
            'action="/kitchen/fridge/items/a/add-to-grocery"',
        );
        expect(menu).toContain(
            '<input type="hidden" name="from" value="/kitchen/fridge">',
        );
        expect(menu).toContain("Add to grocery list");
        expect(menu).toContain(`commandfor="${fridgeItemSheetId("a")}"`);
        expect(menu).toContain("Edit amount or expiry");
        expect(menu).toContain("data-fd-menu-arm");
        expect(menu).toContain('action="/kitchen/fridge/items/a/discard"');
        expect(menu).toContain("Discard");
    });

    test("warnings: expired and soon go under the title in the warning state", () => {
        const html = body({
            items: [
                item({
                    id: "old",
                    displayName: "Old milk",
                    expiresOn: "2026-11-09",
                }),
                item({
                    id: "soon",
                    displayName: "Salmon",
                    expiresOn: "2026-11-11",
                }),
                item({
                    id: "far",
                    displayName: "Rice",
                    expiresOn: "2026-12-01",
                }),
            ],
        });
        const row = (id: string) =>
            html.match(
                new RegExp(
                    `<li tabindex="0" class="[^"]*"[^>]*id="fd-fridge-row-${id}"[\\s\\S]*?</li>`,
                ),
            )?.[0] ?? "";
        expect(row("old")).toContain("fd-item-row--warning");
        expect(row("old")).toContain(
            '<span class="fd-item-row__subtitle">Expired</span>',
        );
        expect(row("soon")).toContain(
            '<span class="fd-item-row__subtitle">Tomorrow</span>',
        );
        expect(row("far")).not.toContain("fd-item-row--warning");
        expect(row("far")).toContain(
            '<span class="fd-item-row__value">Dec 1</span>',
        );
    });

    test("use soon lists expiring and expired items as cards that open the item", () => {
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
            locations: [fridgeLocation],
        });
        expect(
            listExpiring(view.items, today, 3)
                .map((i) => i.id)
                .sort(),
        ).toEqual(["exp", "soon"]);
        const html = renderKitchenFridgeBody(view);
        const strip = html.slice(
            html.indexOf('class="fd-kitchen-use-soon"'),
            html.indexOf('class="fd-kitchen-loc"'),
        );
        expect(strip).toContain("Use soon");
        expect(strip).toContain("Salmon");
        expect(strip).toContain("Old milk");
        expect(strip).not.toContain("Fresh");
        expect(strip).toContain('fd-mini-card__label--over">Expired');
        expect(strip).toContain(
            `data-fd-open-item="${fridgeItemSheetId("soon")}"`,
        );
        expect(strip).toContain('href="/kitchen/fridge?item=soon"');
    });

    test("hides use soon when nothing qualifies", () => {
        expect(
            body({
                items: [
                    item({
                        id: "ok",
                        displayName: "Rice",
                        expiresOn: "2026-12-01",
                    }),
                ],
            }),
        ).not.toContain("Use soon");
    });

    test("the item sheet: amount, the four actions, kept in and expires chips, usually buy", () => {
        const html = renderKitchenFridgeV2Page(
            buildPreviewKitchenFridgeView(chrome, today, {
                openItemId: "it-1",
                items: [
                    item({
                        id: "it-1",
                        displayName: "Eggs",
                        foodId: "f-eggs",
                        expiresOn: "2026-11-11",
                    }),
                ],
                locations: [fridgeLocation, pantryLocation],
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
                freezeDefaultExpiry: "2027-02-10",
            }),
        );
        const sheetId = fridgeItemSheetId("it-1");
        expect(html).toMatch(
            new RegExp(
                `<dialog class="fd-sheet fd-sheet--side fd-kitchen-sheet" id="${sheetId}"[^>]* data-sheet-open-on-load`,
            ),
        );
        expect(html).toContain("Fridge · expires tomorrow");
        expect(html).toContain("How much is left");
        // The one form the Save button posts: amount, unit, place, date.
        const form =
            html.match(
                /<form id="[^"]*qty-form" method="post" action="\/kitchen\/fridge\/items\/it-1">[\s\S]*?<\/form>/,
            )?.[0] ?? "";
        expect(form).toContain('name="return_to" value="/kitchen/fridge"');
        expect(form).toContain('name="qty_amount"');
        expect(form).toContain('name="qty_unit" value="each"');
        expect(form).toContain(
            'type="radio" name="location_id" value="loc-fridge" checked',
        );
        expect(form).toContain(
            'type="radio" name="location_id" value="loc-pantry"',
        );
        expect(form).toContain('name="expires_mode" value="keep" checked');
        expect(form).toContain('<span class="fd-chip__label">Nov 11</span>');
        expect(form).toContain("No date");
        expect(form).toContain('type="date" value="2026-11-11"');
        expect(form).toContain('name="expires_on"');
        expect(form).toContain('href="/kitchen/usuals/f-eggs"');
        // The four actions post their own forms, with the fields main sends.
        for (const [label, action, fields] of [
            [
                "Ate some",
                "eat",
                [
                    'name="qty_amount" value="2"',
                    'name="return_to" value="/kitchen/fridge"',
                ],
            ],
            [
                "Add to grocery list",
                "add-to-grocery",
                ['name="from" value="/kitchen/fridge"'],
            ],
            [
                "Freeze",
                "freeze",
                [
                    'name="expires_on" value="2027-02-10"',
                    'name="return_to" value="/kitchen/fridge"',
                ],
            ],
            [
                "Discard",
                "discard",
                ['name="return_to" value="/kitchen/fridge"'],
            ],
        ] as const) {
            expect(html).toContain(`aria-label="${label}" form="`);
            const post =
                html.match(
                    new RegExp(
                        `<form id="[^"]*" method="post" action="/kitchen/fridge/items/it-1/${action}"[^>]*>[\\s\\S]*?</form>`,
                    ),
                )?.[0] ?? "";
            for (const field of fields) expect(post).toContain(field);
        }
        expect(html).toContain(">Save</span></button>");
    });

    test("an item with no date offers No date chosen and Pick a date", () => {
        const html = body({
            items: [item({ id: "a", displayName: "Rice", expiresOn: null })],
        });
        expect(html).toContain('name="expires_mode" value="none" checked');
        expect(html).not.toContain('name="expires_mode" value="keep"');
        expect(html).toContain('value="pick"');
    });

    test("the item sheet says which recipe uses the item", () => {
        const view = buildPreviewKitchenFridgeView(chrome, today, {
            items: [
                item({
                    id: "soon",
                    displayName: "Salmon",
                    expiresOn: "2026-11-11",
                }),
                item({
                    id: "also",
                    displayName: "Rice",
                    expiresOn: "2026-11-11",
                }),
                item({
                    id: "no",
                    displayName: "Milk",
                    expiresOn: "2026-11-11",
                }),
            ],
            locations: [fridgeLocation],
            useSoonUses: [
                use("soon", "Salmon", "Salmon & <rice>"),
                use("also", "Rice", "Salmon & <rice>"),
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
        const html = renderKitchenFridgeBody(view);
        const sheet = (id: string) =>
            html.match(
                new RegExp(
                    `<dialog[^>]*id="${fridgeItemSheetId(id)}"[\\s\\S]*?</dialog>`,
                ),
            )?.[0] ?? "";
        expect(sheet("soon")).toContain(">Use in</h3>");
        expect(sheet("soon")).toContain("Salmon &amp; &lt;rice&gt;");
        expect(sheet("soon")).toContain("Uses 2 things expiring");
        expect(sheet("soon")).toContain('href="/recipes/r1"');
        expect(sheet("no")).not.toContain("Use in");
        // The cards no longer carry the recipe.
        expect(html).not.toContain("Use in:");
    });

    test("an error reopens the sheet it came from", () => {
        const html = renderKitchenFridgeBody(
            buildPreviewKitchenFridgeView(chrome, today, {
                openItemId: "a",
                error: "That item is no longer in the fridge.",
                items: [item({ id: "a", displayName: "Eggs" })],
                locations: [fridgeLocation],
            }),
        );
        expect(html).toContain(
            'role="alert">That item is no longer in the fridge.',
        );
        expect(html.match(/role="alert"/g)).toHaveLength(1);
    });

    test("an item id or name made of $-patterns stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const html = body({
                items: [item({ id: payload, displayName: payload })],
            });
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(html, "li[data-fd-sheet-row]", "id"),
            ).toEqual([`fd-fridge-row-${payload}`]);
            expect(
                await attributeValues(
                    html,
                    "li[data-fd-sheet-row]",
                    "data-sheet-id",
                ),
            ).toEqual([fridgeItemSheetId(payload)]);
        }
    });
});

describe("the Fridge has no select mode or ⋯", () => {
    const html = body({
        items: [
            item({ id: "a", displayName: "Eggs" }),
            item({ id: "b", displayName: "Spinach" }),
        ],
    });

    test("no ⋯ more menu, no Select, no selection bar and no pick box", () => {
        expect(html).not.toContain('aria-label="Fridge options"');
        expect(html).not.toContain("data-fd-select");
        expect(html).not.toContain("fd-selection-bar");
        expect(html).not.toContain("fd-select-");
        expect(html).not.toContain("/kitchen/fridge/bulk/");
        expect(html).not.toContain('name="ids[]"');
        expect(html).not.toContain("fd-item-row--select");
    });

    test("the + is the only tool", () => {
        const top = html.match(
            /<div class="fd-kitchen-fridge-top">([\s\S]*?)<\/div>\n/,
        )?.[1];
        expect(top?.match(/<button/g)).toHaveLength(1);
        expect(top).toContain('aria-label="Add item"');
    });
});

describe("Add to fridge", () => {
    const usuals = [
        {
            foodId: "p-milk",
            kind: "food" as const,
            name: "Milk",
            subtitle: "Kirkland 2% · 1 gal",
            amount: 1,
            unit: "gal",
        },
        {
            foodId: "f-eggs",
            kind: "food" as const,
            name: "Eggs",
            subtitle: "12 each",
            amount: 12,
            unit: "each",
        },
        {
            foodId: "f-towels",
            kind: "supply" as const,
            name: "Paper towels",
            subtitle: "1 each",
            amount: 1,
            unit: "each",
        },
    ];
    const sheet = (
        extra: Parameters<typeof buildPreviewKitchenFridgeView>[2] = {},
    ) =>
        body({
            usuals,
            locations: [fridgeLocation, pantryLocation],
            ...extra,
        }).match(/<dialog[^>]*id="fd-fridge-add"[\s\S]*?<\/dialog>/)?.[0] ?? "";

    test("the header is the title and a close button, with the search box in a section under it", () => {
        const html = sheet();
        const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
        expect(header).toContain('class="fd-sheet__title"');
        expect(header).toContain(">Add to fridge</h2>");
        expect(header).toContain('commandfor="fd-fridge-add"');
        expect(header).not.toContain("search");
        expect(html).not.toContain("fd-sheet--search");
        const search = html.match(/<input[^>]*id="fd-fridge-add-q"[^>]*>/)?.[0];
        expect(search).toContain('placeholder="Search foods"');
        expect(html.indexOf("</header>")).toBeLessThan(
            html.indexOf('id="fd-fridge-add-q"'),
        );
    });

    test("a search box, the usuals first with a plus that posts the add route", () => {
        const html = sheet();
        expect(html).toContain("fd-sheet--side");
        expect(html).toContain('placeholder="Search foods"');
        expect(html).toContain(">Your usuals</h3>");
        const milk =
            html.match(
                /<li [^>]*data-fd-fridge-usual="milk"[\s\S]*?<\/li>/,
            )?.[0] ?? "";
        expect(milk).toContain("Kirkland 2% · 1 gal");
        expect(milk).toContain('action="/kitchen/fridge/items"');
        for (const field of [
            'name="kind" value="food"',
            'name="food_id" value="p-milk"',
            'name="location_id" value="loc-fridge"',
            'name="qty_amount" value="1"',
            'name="qty_unit" value="gal"',
        ]) {
            expect(milk).toContain(field);
        }
    });

    test("a supply usual posts as a supply with its name", () => {
        const towels =
            sheet().match(
                /<li [^>]*data-fd-fridge-usual="paper towels"[\s\S]*?<\/li>/,
            )?.[0] ?? "";
        expect(towels).toContain('name="kind" value="supply"');
        expect(towels).toContain('name="name" value="Paper towels"');
        expect(towels).toContain('name="food_id" value="f-towels"');
        expect(towels).toContain('name="qty_unit" value="each"');
    });

    test("not here: the hand form posts the name, place and amount", () => {
        const html = sheet({ openAdd: true });
        expect(html).toContain("Not here? Add it by hand");
        expect(html).not.toContain('<details class="fd-kitchen-hand" open>');
        const form =
            html.match(/<form id="fd-fridge-add-form"[\s\S]*?<\/form>/)?.[0] ??
            "";
        expect(form).toContain('action="/kitchen/fridge/items"');
        for (const field of [
            'name="kind" value="food"',
            'name="food_name"',
            'name="location_id" value="loc-fridge" checked',
            'name="location_id" value="loc-pantry"',
            'name="qty_amount"',
            'name="qty_unit" value="each"',
        ]) {
            expect(form).toContain(field);
        }
    });

    test("a failed add reopens the sheet with the hand form open and the error shown", () => {
        const html = sheet({ openAdd: true, error: "Name is required." });
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain('<details class="fd-kitchen-hand" open>');
        expect(html).toContain('role="alert">Name is required.');
    });

    test("no usuals: only the hand form", () => {
        const html = sheet({ usuals: [] });
        expect(html).not.toContain("Your usuals");
        expect(html).toContain("Not here? Add it by hand");
    });
});

describe("a usual running low shows on its fridge row", () => {
    const locations = [fridgeLocation];
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
                item({
                    id: "it-milk",
                    displayName: "Milk",
                    foodId: "f-milk",
                    expiresOn: "2026-12-20",
                }),
            ],
            locations,
            ...extra,
        });

    test("'<expiry> · low, below <level>' in the warning tone, with no strip", () => {
        const html = renderKitchenFridgeBody(
            view({ lowStock: new Map([["f-eggs", "6"]]) }),
        );
        expect(html).toContain(
            '<li tabindex="0" class="fd-item-row fd-item-row--warning fd-item-row--swipe"',
        );
        expect(html).toContain(
            '<span class="fd-item-row__subtitle">Tomorrow · low, below 6</span>',
        );
        expect(html).not.toContain("fd-notice-strip");
        // Only the low item: the other row keeps its date and has no subtitle.
        expect(html.match(/low, below/g)).toHaveLength(1);
        expect(html.match(/fd-item-row__subtitle/g)).toHaveLength(1);
        expect(html).toContain(
            '<span class="fd-item-row__value">Dec 20</span>',
        );
    });

    test("an item with no expiry says only that it is low", () => {
        const html = renderKitchenFridgeBody(
            view({
                items: [{ ...eggs, expiresOn: null }],
                lowStock: new Map([["f-eggs", "6"]]),
            }),
        );
        expect(html).toContain(
            '<span class="fd-item-row__subtitle">low, below 6</span>',
        );
        const row =
            html.match(
                /<li tabindex="0"[^>]*id="fd-fridge-row-it-eggs"[\s\S]*?<\/li>/,
            )?.[0] ?? "";
        expect(row).not.toContain("fd-item-row__value");
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

    test("nothing low: no low words on any row", () => {
        const html = renderKitchenFridgeBody(view());
        expect(html).not.toContain("low, below");
    });

    test("fridgeLowSubtitle words the line", () => {
        expect(fridgeLowSubtitle("Nov 23", "6")).toBe("Nov 23 · low, below 6");
        expect(fridgeLowSubtitle(null, "2.5")).toBe("low, below 2.5");
    });
});

function use(itemId: string, itemName: string, recipeName: string) {
    return {
        item: { id: itemId, displayName: itemName, expiresOn: "2026-11-11" },
        recipes: [{ recipeId: "r1", name: recipeName, incomplete: false }],
    };
}

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

test("a count word reads in the plural on its row (396429: Paper towels 3 rolls)", () => {
    const html = body({
        items: [
            item({
                id: "pt",
                displayName: "Paper towels",
                kind: "supply",
                quantity: { amount: 3, unit: "roll" } as never,
                expiresOn: null,
            }),
        ],
    });
    expect(html).toContain(">3 rolls<");
    expect(html).not.toContain(">3 roll<");
});
