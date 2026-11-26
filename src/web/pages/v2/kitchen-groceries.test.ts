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
    isGroceryAddModal,
    lowLeftFromReason,
    renderKitchenGroceriesBody,
    renderKitchenGroceriesV2Page,
    type GroceryLineView,
    type GroceryStoreView,
    type KitchenGroceriesLineMeta,
    type KitchenGroceriesV2View,
    FD_GROCERY_ADD_SHEET_ID,
} from "./kitchen-groceries.js";
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

    test("a typed usual with no product keeps the food's name and gets the tag", () => {
        const labels = groceryRowLabels(
            lineView(
                line({ id: "c", displayName: "Half & Half", foodId: "hh" }),
            ),
            { plainFoodName: null, isUsual: true },
        );
        expect(labels.tag).toBe("usual");
        expect(labels.title).toBe("Half & Half");
        expect(labels.subtitle).toBeUndefined();
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
        flags: FIXTURE_APP_CHROME_FLAGS,
        identity: {
            viewerName: "Alex",
            viewerRole: "owner" as const,
            householdName: "Home",
            memberCount: 1,
        },
    };

    function section(
        id: string,
        storeId: string,
        name: string,
        lines: GroceryLineView[],
        isOther = false,
    ): GroceryStoreView["sections"][number] {
        return {
            id,
            householdId: HH,
            storeId,
            name,
            sortOrder: 0,
            hidden: false,
            isOther,
            lines,
        };
    }

    function storeView(
        id: string,
        name: string,
        sections: GroceryStoreView["sections"],
    ): GroceryStoreView {
        return {
            id,
            householdId: HH,
            name,
            sortOrder: 0,
            rules: [],
            sections,
        };
    }

    function baseView(
        overrides: Partial<KitchenGroceriesV2View> = {},
    ): KitchenGroceriesV2View {
        return {
            chrome,
            stores: [
                storeView("st-1", "Shop", [
                    section(
                        "sec-1",
                        "st-1",
                        "Other",
                        [lineView(line({ id: "l1", displayName: "Milk" }))],
                        true,
                    ),
                ]),
            ],
            locations: [
                { id: "loc-1", name: "Fridge" },
                { id: "loc-2", name: "Pantry" },
            ],
            lineMeta: new Map<string, KitchenGroceriesLineMeta>(),
            noStoreLines: [],
            checkedLines: [],
            openLineCount: 1,
            ...overrides,
        };
    }

    /** Two stores, each with a Dairy, one line apiece. */
    function twoStores(
        overrides: Partial<KitchenGroceriesV2View> = {},
    ): KitchenGroceriesV2View {
        return baseView({
            stores: [
                storeView("st-a", "Costco", [
                    section("sec-a", "st-a", "Dairy", [
                        lineView(
                            line({
                                id: "la",
                                displayName: "Milk",
                                storeId: "st-a",
                                sectionId: "sec-a",
                            }),
                        ),
                    ]),
                ]),
                storeView("st-b", "Trader Joe's", [
                    section("sec-b", "st-b", "Dairy", [
                        lineView(
                            line({
                                id: "lb",
                                displayName: "Yogurt",
                                storeId: "st-b",
                                sectionId: "sec-b",
                            }),
                        ),
                    ]),
                ]),
            ],
            openLineCount: 2,
            ...overrides,
        });
    }

    function checkedView(): KitchenGroceriesV2View {
        const checked = lineView(
            line({ id: "c1", displayName: "Bread", checked: true }),
        );
        const base = baseView();
        return baseView({
            stores: [
                {
                    ...base.stores[0]!,
                    sections: [
                        { ...base.stores[0]!.sections[0]!, lines: [checked] },
                    ],
                },
            ],
            checkedLines: [checked],
            openLineCount: 0,
        });
    }

    test("a row is a check ring, the name, what it is, the amount and a ⋯", () => {
        const view = baseView({
            stores: [
                storeView("st-1", "Shop", [
                    section(
                        "sec-1",
                        "st-1",
                        "Other",
                        [
                            lineView(
                                line({
                                    id: "l1",
                                    displayName: "Kirkland milk",
                                }),
                            ),
                        ],
                        true,
                    ),
                ]),
            ],
            lineMeta: new Map([
                [
                    "l1",
                    {
                        plainFoodName: "Milk",
                        isUsual: true,
                        allergenWarning: null,
                        storeName: "Shop",
                        sectionName: "Other",
                    },
                ],
            ]),
        });
        const body = renderKitchenGroceriesBody(view);
        expect(body).toContain('class="fd-kitchen-groceries-page"');
        // The ring posts the check route with its fields.
        expect(body).toMatch(
            /<form class="fd-inline-form" method="post" action="\/kitchen\/groceries\/lines\/l1\/check"><input type="hidden" name="checked" value="1"><input type="hidden" name="return_to" value="\/kitchen\/groceries"><button[^>]*role="checkbox" aria-checked="false"/,
        );
        expect(body).toContain("Milk · usual");
        expect(body).toContain("fd-item-row__value");
        // The row's ⋯: check off, edit in the sheet, delete confirmed in place.
        expect(body).toContain('aria-label="Actions for Kirkland milk"');
        expect(body).toMatch(/>Check off<\/span>/);
        expect(body).toContain('commandfor="fd-grocery-line-l1"');
        expect(body).toContain('action="/kitchen/groceries/lines/l1/delete"');
        expect(body).toContain("data-fd-menu-arm");
        // The row opens its sheet from its face.
        expect(body).toContain('data-sheet-id="fd-grocery-line-l1"');
        expect(body).toContain('id="fd-grocery-row-l1"');
    });

    test("swiping right checks, swiping left deletes, each posting its route", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).toContain("fd-item-row__bed--again");
        expect(body).toContain("fd-item-row__bed--delete");
        expect(body).toMatch(
            /fd-item-row__bed--delete"><form[^>]*action="\/kitchen\/groceries\/lines\/l1\/delete"/,
        );
        expect(body).toMatch(
            /fd-item-row__bed--again"><form[^>]*action="\/kitchen\/groceries\/lines\/l1\/check"/,
        );
    });

    test("a checked line stays in its section, ringed and offered Uncheck", () => {
        const body = renderKitchenGroceriesBody(checkedView());
        expect(body).toContain('aria-checked="true"');
        expect(body).toContain('name="checked" value="0"');
        expect(body).toContain('aria-label="Uncheck Bread"');
        expect(body).not.toContain("fd-row__title--done");
    });

    test("checked lines add the dock: Clear checked beside a grey Put N away in the kitchen, which opens the sheet (394511)", () => {
        const body = renderKitchenGroceriesBody(checkedView());
        const dock = body.match(
            /<div class="fd-kitchen-grocery-dock"[\s\S]*?<\/div>/,
        )?.[0];
        expect(dock).toContain("Clear checked");
        expect(dock).toContain("Put 1 away in the kitchen");
        expect(dock).toContain(
            'command="show-modal" commandfor="fd-grocery-put-away"',
        );
        // The frame's grey button: nothing on the dock is the green primary.
        expect(dock).not.toContain("fd-btn--primary");
        expect(renderKitchenGroceriesBody(baseView())).not.toContain(
            "fd-kitchen-grocery-dock",
        );
    });

    /** A fragment's text: every character inside a tag skipped. */
    function textOf(html: string): string {
        let out = "";
        let inTag = false;
        for (const ch of html) {
            if (ch === "<") inTag = true;
            else if (ch === ">") inTag = false;
            else if (!inTag) out += ch;
        }
        return out.trim();
    }

    /** The buttons of a markup fragment: each tag, with its label. */
    function buttonsOf(html: string): { tag: string; label: string }[] {
        return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
            (m) => ({
                tag: m[1]!,
                label: textOf(m[2]!),
            }),
        );
    }

    test("Clear checked on the dock only arms: Cancel and Clear N take the row, nothing posts on the first tap", () => {
        const body = renderKitchenGroceriesBody(checkedView());
        const dock = body.match(
            /<div class="fd-kitchen-grocery-dock"[\s\S]*?<\/div>/,
        )![0];
        expect(dock).toContain("data-fd-confirm");
        const [arm, put, cancel, go] = buttonsOf(dock);
        // The tap that shows on the first look posts nothing: no form, not a submit.
        expect(arm!.label).toBe("Clear checked");
        expect(arm!.tag).toContain("data-fd-confirm-arm");
        expect(arm!.tag).not.toContain("form=");
        expect(arm!.tag).toContain('type="button"');
        expect(put!.label).toBe("Put 1 away in the kitchen");
        expect(put!.tag).toContain("data-fd-confirm-idle");
        // The confirm step: hidden until armed, the verb names the count and posts the clear form.
        expect(cancel!.label).toBe("Cancel");
        expect(cancel!.tag).toContain("data-fd-confirm-cancel");
        expect(cancel!.tag).toMatch(/\bhidden\b/);
        expect(go!.label).toBe("Clear 1");
        expect(go!.tag).toContain('type="submit"');
        expect(go!.tag).toContain('form="fd-grocery-clear-form"');
        expect(go!.tag).toMatch(/\bhidden\b/);
        // No other button of the dock posts the clear form.
        expect(
            buttonsOf(dock).filter((b) =>
                b.tag.includes("fd-grocery-clear-form"),
            ),
        ).toHaveLength(1);
    });

    test("Clear checked in the put away sheet confirms in place as well", () => {
        const body = renderKitchenGroceriesBody(checkedView());
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-put-away"[\s\S]*?<\/dialog>/,
        )![0];
        const actions = sheetHtml.match(
            /<div class="fd-sheet__actions[\s\S]*?<\/div>/,
        )![0];
        expect(actions).toContain("data-fd-confirm");
        const [arm, put, cancel, go] = buttonsOf(actions);
        expect(arm!.label).toBe("Clear checked");
        expect(arm!.tag).toContain("data-fd-confirm-arm");
        expect(arm!.tag).not.toContain("fd-grocery-clear-form");
        expect(put!.label).toBe("Put away");
        expect(put!.tag).toContain('form="fd-grocery-put-away-form"');
        expect(cancel!.label).toBe("Cancel");
        expect(go!.label).toBe("Clear 1");
        expect(go!.tag).toContain('form="fd-grocery-clear-form"');
        expect(go!.tag).toMatch(/\bhidden\b/);
    });

    test("put away: where each line is kept and when it expires, posting the same fields", () => {
        const view = checkedView();
        const body = renderKitchenGroceriesBody({
            ...view,
            checkedLines: [
                {
                    ...view.checkedLines[0]!,
                    lastLocationId: "loc-2",
                    putAwayProducts: [
                        { id: "p-1", label: "Bread" },
                        { id: "p-2", label: "Rye bread · Acme" },
                    ],
                    putAwayProductId: "p-2",
                },
            ],
            putAwayDraft: { c1: { expiresOn: "2026-12-01" } },
            openPutAway: true,
            error: "Pick a place.",
        });
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-put-away"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheetHtml).toContain("Put away 1 item");
        expect(sheetHtml).toContain("data-sheet-open-on-load");
        expect(sheetHtml).toContain('action="/kitchen/groceries/put-away"');
        expect(sheetHtml).toContain('name="line_ids" value="c1"');
        expect(sheetHtml).toContain("Kept in");
        expect(sheetHtml).toMatch(
            /name="location_id_c1" value="loc-2" checked/,
        );
        expect(sheetHtml).toContain('name="expires_on_c1"');
        expect(sheetHtml).toContain('value="2026-12-01"');
        expect(sheetHtml).toMatch(
            /name="expires_mode_c1" value="pick" checked/,
        );
        expect(sheetHtml).toMatch(
            /name="product_food_id_c1" value="p-2" checked/,
        );
        expect(sheetHtml).toContain("Pick a place.");
        // Put away posts its own form; Clear checked posts the clear form
        // only once confirmed.
        expect(sheetHtml).toContain('form="fd-grocery-clear-form"');
        expect(sheetHtml).toContain('form="fd-grocery-put-away-form"');
        expect(body).toContain(
            'id="fd-grocery-clear-form" method="post" action="/kitchen/groceries/clear-checked"',
        );
    });

    test("put away asks how much for a to-taste line", () => {
        const view = checkedView();
        const noted = { ...view.checkedLines[0]!, note: "to taste" };
        const body = renderKitchenGroceriesBody({
            ...view,
            checkedLines: [noted],
            putAwayDraft: { c1: { putAwayAmount: "3" } },
        });
        expect(body).toContain('name="put_away_amount_c1"');
        expect(body).toContain('value="3"');
    });

    test("a noted line's put away row reads How much did you buy in the line's unit, starting from its amount, the note as the row's subtitle", () => {
        const view = checkedView();
        const noted = {
            ...view.checkedLines[0]!,
            note: "to taste",
            quantity: { amount: 3, unit: "bunch" },
        };
        const body = renderKitchenGroceriesBody({
            ...view,
            checkedLines: [noted],
        });
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-put-away"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheetHtml).toContain("How much did you buy");
        expect(sheetHtml).not.toContain("to taste: how much");
        expect(sheetHtml).toMatch(
            /<span class="fd-item-row__subtitle">to taste<\/span>/,
        );
        const stepper = sheetHtml.match(
            /<input[^>]*name="put_away_amount_c1"[^>]*>/,
        )![0];
        expect(stepper).toContain('value="3"');
        expect(sheetHtml).toContain("bunch");
        // No amount of its own: it starts at 1.
        const bare = renderKitchenGroceriesBody({
            ...view,
            checkedLines: [{ ...noted, quantity: { amount: 0, unit: "each" } }],
        });
        expect(
            bare.match(/<input[^>]*name="put_away_amount_c1"[^>]*>/)![0],
        ).toContain('value="1"');
    });

    test("every Add sheet form posts the filtered list as return_to, so an add lands back on it", () => {
        const usuals = [
            {
                foodId: "f-eggs",
                kind: "food" as const,
                name: "Eggs",
                subtitle: "12 each",
                amount: 12,
                unit: "each",
                lowBelow: "6",
            },
        ];
        const sheetOf = (view: KitchenGroceriesV2View) =>
            renderKitchenGroceriesBody(view).match(
                /<dialog[^>]*id="fd-grocery-add"[\s\S]*?<\/dialog>/,
            )![0];
        const filtered = sheetOf(
            twoStores({ usuals, selectedStoreIds: ["st-a"] }),
        );
        const returns = [
            ...filtered.matchAll(/name="return_to" value="([^"]*)"/g),
        ].map((m) => m[1]);
        // The Running low chip, the suggestion's add and the hand form.
        expect(returns.length).toBe(3);
        for (const value of returns) {
            expect(value).toBe("/kitchen/groceries?store=st-a");
        }
        const unfiltered = sheetOf(twoStores({ usuals }));
        for (const m of unfiltered.matchAll(
            /name="return_to" value="([^"]*)"/g,
        )) {
            expect(m[1]).toBe("/kitchen/groceries");
        }
    });

    test("the allergen warning names the food", () => {
        const view = (foodName?: string) =>
            baseView({
                openAdd: true,
                addStoreId: "st-1",
                error: "Could not add.",
                allergenNotices: [
                    {
                        code: "grocery.allergen",
                        severity: "warning",
                        subject: { kind: "grocery_line", id: "" },
                        related: [{ kind: "member", id: "u-max", name: "Max" }],
                        params: { allergens: ["milk"] },
                    } as never,
                ],
                allergenRetry: {
                    storeId: "st-1",
                    fields: { store_id: "st-1", food_name: "Cheddar" },
                    foodName,
                },
            });
        expect(renderKitchenGroceriesBody(view("Cheddar"))).toContain(
            "Cheddar contains milk — Max.",
        );
        expect(renderKitchenGroceriesBody(view())).toContain(
            "Contains milk — Max.",
        );
    });

    test("the line sheet: amount, store and section pull-downs, a note, Check off and Save", () => {
        const body = renderKitchenGroceriesBody(
            twoStores({ openLineId: "la", error: "No." }),
        );
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-line-la"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheetHtml).toContain("data-sheet-open-on-load");
        expect(sheetHtml).toContain("No.");
        // The figure and the note belong to the edit form that Save posts.
        expect(sheetHtml).toMatch(
            /name="qty_amount"[^>]*form="fd-grocery-line-la-edit"/,
        );
        expect(sheetHtml).toMatch(
            /name="note"[^>]*form="fd-grocery-line-la-edit"/,
        );
        expect(sheetHtml).toContain(
            'id="fd-grocery-line-la-edit" method="post" action="/kitchen/groceries/lines/la/edit"',
        );
        expect(sheetHtml).toContain('name="qty_unit" value="each"');
        // Store: every store, the line's own ticked, each posting the edit
        // route and coming back with this sheet open.
        expect(sheetHtml).toMatch(
            /aria-checked="true"[^>]*data-fd-menu-close[^>]*>[\s\S]*?Costco/,
        );
        expect(sheetHtml).toContain('name="store_id" value="st-b"');
        expect(sheetHtml).toContain(
            'name="return_to" value="/kitchen/groceries?line=la"',
        );
        expect(sheetHtml).toContain("Section");
        expect(sheetHtml).toContain(">Check off<");
        expect(sheetHtml).toContain(">Save<");
        expect(sheetHtml).toContain('form="fd-grocery-line-la-check"');
    });

    test("the line sheet's Check off reads Uncheck on a checked line", () => {
        const body = renderKitchenGroceriesBody(checkedView());
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-line-c1"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheetHtml).toContain(">Uncheck<");
        expect(sheetHtml).toContain('name="checked" value="0"');
    });

    test("a line with no store gets a sheet too, with no store ticked", () => {
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
        expect(body).toContain('id="fd-grocery-line-orphan"');
        expect(body).toContain("No store");
    });

    test("header subtitle counts items to get", () => {
        const body = renderKitchenGroceriesBody(baseView({ openLineCount: 8 }));
        expect(body).toContain("8 to get");
    });

    test("the header is the same as on Fridge and Usuals", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).toMatch(
            /^<header class="fd-page-header fd-kitchen-head" data-fd-kitchen-tab="groceries"><div class="fd-page-header__titles"><h1 class="fd-page-header__title">Kitchen<\/h1><p class="fd-page-header__subtitle">[^<]+<\/p><\/div>/,
        );
    });

    test("the store filter is a pull-down of ticks with a count and Clear, for two stores or more", () => {
        const all = renderKitchenGroceriesBody(twoStores());
        expect(all).toContain('data-anchor="filter"');
        expect(all).toContain('aria-label="Filter by store"');
        // Nothing is filtered: no ticks, no Clear, a plain pull-down.
        const header = all
            .split('data-anchor="filter"')[1]!
            .split("</header>")[0]!;
        expect(header).not.toContain('aria-checked="true"');
        expect(header).not.toContain(">Clear<");
        // Choosing a store shows only it.
        expect(all).toContain('href="/kitchen/groceries?store=st-a"');
        expect(all).toContain('href="/kitchen/groceries?store=st-b"');

        const one = renderKitchenGroceriesBody(
            twoStores({ selectedStoreIds: ["st-a"] }),
        );
        expect(one).toContain('role="menuitemcheckbox" aria-checked="true"');
        // Ticking the other adds it; ticking the one that is on takes it off.
        expect(one).toContain(
            'href="/kitchen/groceries?store=st-a&amp;store=st-b"',
        );
        expect(one).toContain('href="/kitchen/groceries"');
        expect(one).toContain(">Clear<");
        expect(one).toContain('<span class="fd-btn__badge">1</span>');
        expect(one).not.toContain("Yogurt");
        expect(one).toContain("Milk");
        // Actions come back to the same filter.
        expect(one).toContain(
            'name="return_to" value="/kitchen/groceries?store=st-a"',
        );
    });

    test("one store has nothing to filter, so no filter", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).not.toContain('data-anchor="filter"');
    });

    test("two stores that both have a Dairy name the store on each section", () => {
        const body = renderKitchenGroceriesBody(twoStores());
        expect(body).toContain("Dairy · Costco");
        expect(body).toMatch(/Dairy · Trader Joe(&#39;|&#039;|')s/);
        const one = renderKitchenGroceriesBody(
            twoStores({ selectedStoreIds: ["st-b"] }),
        );
        expect(one).not.toContain("Dairy · ");
    });

    test("the tab row ⋯ holds Share list (flag on), Select (rows) and Clear checked (checked), never empty", () => {
        const none = renderKitchenGroceriesBody(
            baseView({
                stores: [storeView("st-1", "Shop", [])],
                openLineCount: 0,
            }),
        );
        expect(none).not.toContain("Groceries options");
        expect(none).not.toContain("Share list");

        const rows = renderKitchenGroceriesBody(baseView());
        expect(rows).toContain('aria-label="Groceries options"');
        expect(rows).toContain('data-fd-select-toggle="groceries"');
        expect(rows).not.toContain("Share list");
        expect(rows).not.toContain("Clear checked");

        const shared = renderKitchenGroceriesBody(
            baseView({ shareEnabled: true }),
        );
        expect(shared).toMatch(
            />Share list<\/span>[\s\S]*?data-fd-select-toggle="groceries"/,
        );
        expect(shared).toContain(
            'command="show-modal" commandfor="fd-grocery-share-sheet"',
        );

        // With only Share on (no rows, flag on) the ⋯ is still there with it.
        const shareOnly = renderKitchenGroceriesBody(
            baseView({
                stores: [storeView("st-1", "Shop", [])],
                openLineCount: 0,
                shareEnabled: true,
            }),
        );
        expect(shareOnly).toContain("Share list");
        expect(shareOnly).not.toContain("data-fd-select-toggle");

        const cleared = renderKitchenGroceriesBody(checkedView());
        expect(cleared).toContain(">Clear checked<");
        expect(cleared).toMatch(
            /data-fd-menu-confirm[\s\S]*?action="\/kitchen\/groceries\/clear-checked"/,
        );
    });

    test("the ⋯ and the plus ride the tab row on the phone and the header from 1024px", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).toMatch(
            /<div class="fd-kitchen-fridge-top"><div class="fd-menu[^>]*>[\s\S]*?<\/div><button[^>]*fd-kitchen-fridge-add/,
        );
        expect(body).toMatch(
            /fd-page-header__actions">\n?<div class="fd-menu[\s\S]*?fd-kitchen-overview-add/,
        );
    });

    test("without mcp-share-links there is no Share list, sheet or share post", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).not.toContain("fd-grocery-share-sheet");
        expect(body).not.toContain("/kitchen/groceries/share");
        expect(body).not.toContain("Share");
        const on = renderKitchenGroceriesBody(baseView({ shareEnabled: true }));
        expect(on).toContain('action="/kitchen/groceries/share"');
    });

    test("a refused share shows its error in the open sheet only", () => {
        const body = renderKitchenGroceriesBody(
            baseView({ error: "Nope.", shareEnabled: true, openShare: true }),
        );
        expect(body).toContain("data-sheet-open-on-load");
        expect(body.split("Nope.").length - 1).toBe(1);
    });

    test("Select uses the Selection bar and deletes what is picked, confirmed in place", () => {
        const body = renderKitchenGroceriesBody(twoStores());
        expect(body).toContain(
            'class="fd-kitchen-groceries-page" data-fd-select="groceries"',
        );
        expect(body).toContain('class="fd-selection-bar');
        expect(body).toContain('data-fd-select-bar="groceries"');
        expect(body).toContain('data-fd-select-head="groceries"');
        expect(body).toContain(
            'action="/kitchen/groceries/bulk/delete" data-fd-select-form',
        );
        expect(body).toContain('name="return_to" value="/kitchen/groceries"');
        expect(body).toContain("data-fd-select-ask");
        // Each row carries its pick box under ids[].
        expect(body).toMatch(/data-fd-select-item name="ids\[\]" value="la"/);
        expect(body).not.toContain("fd-select-bar__count");
    });

    test("the plus opens the add sheet; with no store there is no plus", () => {
        const body = renderKitchenGroceriesBody(baseView());
        expect(body).toContain(
            `class="fd-icon-btn fd-kitchen-fridge-add" commandfor="${FD_GROCERY_ADD_SHEET_ID}" command="show-modal" title="Add to list" aria-label="Add to list"`,
        );
        expect(body).toContain(`id="${FD_GROCERY_ADD_SHEET_ID}"`);
        // The Add to list row opens it too.
        expect(body).toContain(
            `commandfor="${FD_GROCERY_ADD_SHEET_ID}" command="show-modal"`,
        );
        const empty = renderKitchenGroceriesBody(
            baseView({ stores: [], openLineCount: 0 }),
        );
        expect(empty).not.toContain(FD_GROCERY_ADD_SHEET_ID);
    });

    test("the add sheet lists the usuals, the low ones as chips, and posts the same fields", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                usuals: [
                    {
                        foodId: "f-eggs",
                        kind: "food",
                        name: "Eggs",
                        subtitle: "12 each",
                        amount: 12,
                        unit: "each",
                        lowBelow: "6",
                    },
                    {
                        foodId: "f-salt",
                        kind: "supply",
                        name: "Salt",
                        subtitle: "1 each",
                        amount: 1,
                        unit: "each",
                    },
                ],
            }),
        );
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-add"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheetHtml).toContain("Running low");
        expect(sheetHtml).toContain("Suggestions");
        expect(sheetHtml).toContain("Low, below 6");
        expect(sheetHtml).toContain("Usual · 1 each");
        expect(sheetHtml).toContain('action="/kitchen/groceries/lines"');
        expect(sheetHtml).toContain('name="food_id" value="f-eggs"');
        // Nothing narrowed the list to one store: the add names none, and
        // the domain applies the usual's own.
        expect(sheetHtml).not.toContain('name="store_id"');
        expect(sheetHtml).not.toContain('name="section_id"');
        expect(sheetHtml).toContain('name="qty_amount" value="12"');
        // A supply posts as one, under its name.
        expect(sheetHtml).toContain('name="kind" value="supply"');
        expect(sheetHtml).toContain('name="name" value="Salt"');
        expect(sheetHtml).toContain('name="food_name"');
        expect(sheetHtml).toContain("Not here? Add it by hand");
    });

    test("the add sheet names a store only when exactly one is filtered, and says where a usual goes when it is known", () => {
        const usuals = [
            {
                foodId: "f-coffee",
                kind: "food" as const,
                name: "Coffee",
                subtitle: "1 bag",
                amount: 1,
                unit: "bag",
                storeName: "Trader Joe's",
            },
            {
                foodId: "f-eggs",
                kind: "food" as const,
                name: "Eggs",
                subtitle: "12 each",
                amount: 12,
                unit: "each",
            },
        ];
        const sheetOf = (view: KitchenGroceriesV2View) =>
            renderKitchenGroceriesBody(view).match(
                /<dialog[^>]*id="fd-grocery-add"[\s\S]*?<\/dialog>/,
            )![0];
        const none = sheetOf(twoStores({ usuals }));
        expect(none).not.toContain('name="store_id"');
        expect(none).not.toContain('name="section_id"');
        expect(none).toContain("Usual · 1 bag · Trader Joe's");
        // A usual with no store of its own says no store.
        expect(none).toContain("Usual · 12 each<");
        // Both stores filtered is not one store: still none named.
        const both = sheetOf(
            twoStores({ usuals, selectedStoreIds: ["st-a", "st-b"] }),
        );
        expect(both).not.toContain('name="store_id"');
        // One store filtered: every add goes there, and says so.
        const one = sheetOf(twoStores({ usuals, selectedStoreIds: ["st-a"] }));
        expect(one).toContain('name="store_id" value="st-a"');
        expect(one).not.toContain('name="store_id" value="st-b"');
        expect(one).toContain('name="section_id" value="sec-a"');
        expect(one).toContain("Usual · 1 bag · Costco");
        // The hand form follows the same rule.
        expect(
            none.match(/id="fd-grocery-add-form"[\s\S]*?<\/form>/)![0],
        ).not.toContain('name="store_id"');
        expect(
            one.match(/id="fd-grocery-add-form"[\s\S]*?<\/form>/)![0],
        ).toContain('name="store_id" value="st-a"');
    });

    test("a low suggestion reads Low · N left when the stock is known, else the threshold", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                usuals: [
                    {
                        foodId: "f-eggs",
                        kind: "food",
                        name: "Eggs",
                        subtitle: "12 each",
                        amount: 12,
                        unit: "each",
                        lowBelow: "12",
                        lowLeft: "9 left",
                    },
                    {
                        foodId: "f-milk",
                        kind: "food",
                        name: "Milk",
                        subtitle: "1 L",
                        amount: 1,
                        unit: "L",
                        lowBelow: "2",
                    },
                ],
            }),
        );
        expect(body).toContain("Low · 9 left");
        expect(body).not.toContain("Low, below 12");
        expect(body).toContain("Low, below 2");
    });

    test("a usual on a schedule reads its cadence, one without its amount (394843)", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                usuals: [
                    {
                        foodId: "f-bananas",
                        kind: "food",
                        name: "Bananas",
                        subtitle: "6 each",
                        amount: 6,
                        unit: "each",
                        cadence: "every week",
                    },
                    {
                        foodId: "f-rice",
                        kind: "food",
                        name: "Rice",
                        subtitle: "1 bag",
                        amount: 1,
                        unit: "bag",
                    },
                ],
            }),
        );
        expect(body).toContain("Usual · every week");
        expect(body).not.toContain("Usual · 6 each");
        expect(body).toContain("Usual · 1 bag");
    });

    test("the stock that is left comes out of the running-low reason", () => {
        expect(lowLeftFromReason("9 left, below 12")).toBe("9 left");
        expect(lowLeftFromReason("0.5 left, below 2")).toBe("0.5 left");
        expect(lowLeftFromReason("weekly, last bought 8 days ago")).toBeNull();
        expect(lowLeftFromReason(undefined)).toBeNull();
    });

    test("a refused add with no store posted opens the sheet, and its warning and retry still show", () => {
        expect(isGroceryAddModal("grocery-add-food-")).toBe(true);
        expect(isGroceryAddModal("grocery-add-food-st-1")).toBe(true);
        expect(isGroceryAddModal("fd-grocery-share-sheet")).toBe(false);
        const body = renderKitchenGroceriesBody(
            twoStores({
                openAdd: true,
                addStoreId: null,
                error: "Could not add.",
                allergenNotices: [
                    {
                        code: "grocery.allergen",
                        severity: "warning",
                        subject: { kind: "grocery_line", id: "" },
                        related: [{ kind: "member", id: "u-sam", name: "Sam" }],
                        params: { allergens: ["peanuts"] },
                    } as never,
                ],
                allergenRetry: {
                    storeId: "",
                    fields: { food_name: "Peanut butter" },
                },
            }),
        );
        expect(body).toContain("Add anyway");
        expect(body).toContain('name="food_name" value="Peanut butter"');
        expect(body).not.toContain('name="store_id" value=""');
    });

    test("the line sheet's pull-downs find the edit form to carry the amount and note", () => {
        const body = renderKitchenGroceriesBody(twoStores());
        const sheetHtml = body.match(
            /<dialog[^>]*id="fd-grocery-line-la"[\s\S]*?<\/dialog>/,
        )![0];
        expect(sheetHtml).toContain(
            'id="fd-grocery-line-la-edit" method="post" action="/kitchen/groceries/lines/la/edit" data-fd-line-edit',
        );
        expect(sheetHtml).toContain('class="fd-menu__form"');
    });

    test("a blocked add shows the warning with Add anyway, replaying the fields", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                openAdd: true,
                addStoreId: "st-1",
                error: "Could not add.",
                allergenNotices: [
                    {
                        code: "grocery.allergen",
                        severity: "warning",
                        subject: { kind: "grocery_line", id: "" },
                        related: [{ kind: "member", id: "u-sam", name: "Sam" }],
                        params: { allergens: ["peanuts"] },
                    } as never,
                ],
                allergenRetry: {
                    storeId: "st-1",
                    fields: { store_id: "st-1", food_name: "Peanut butter" },
                },
            }),
        );
        expect(body).toContain("data-sheet-open-on-load");
        expect(body).toContain("Contains peanuts — Sam.");
        expect(body).toContain("Add anyway");
        expect(body).toContain('name="confirm_allergen" value="1"');
        expect(body).toContain('name="food_name" value="Peanut butter"');
    });

    test("a row says a member's allergen in words, in the warning tone; unknown data is not a mark", () => {
        const row = lineView(line({ id: "pb", displayName: "Peanut butter" }));
        const meta = (allergenWarning: string | null) => ({
            lineMeta: new Map<string, KitchenGroceriesLineMeta>([
                [
                    "pb",
                    {
                        plainFoodName: null,
                        isUsual: true,
                        allergenWarning,
                        storeName: "Shop",
                        sectionName: "Other",
                    },
                ],
            ]),
        });
        const hit = String(
            groceryLineRowMarkup(
                row,
                meta("Contains peanuts (Sam)"),
                GROCERY_V2_RETURN_TO,
            ),
        );
        expect(hit).toContain("fd-item-row--warning");
        expect(hit).toContain("usual · Contains peanuts (Sam)");
        const unknown = String(
            groceryLineRowMarkup(
                row,
                meta("unknown allergen data"),
                GROCERY_V2_RETURN_TO,
            ),
        );
        expect(unknown).not.toContain("fd-item-row--warning");
        expect(unknown).not.toContain("unknown allergen data");
    });

    test("unknown allergen data is one line for the page", () => {
        const body = renderKitchenGroceriesBody(
            baseView({ unknownAllergen: true }),
        );
        expect(body).toContain("fd-kitchen-grocery-unknown-allergen");
    });

    test("an empty list says so, with no intro, footnote or old chips", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                stores: [storeView("st-1", "Shop", [])],
                openLineCount: 0,
            }),
        );
        expect(body).toContain("Nothing on the list yet");
        expect(body).not.toContain("walking order");
        expect(body).not.toContain("fd-kitchen-grocery-stores");
        expect(body).not.toContain("fd-kitchen-grocery-put-link");
    });

    test("the list is two columns: the first section left, the rest right", () => {
        const body = renderKitchenGroceriesBody(
            baseView({
                stores: [
                    storeView("st-1", "Shop", [
                        section("s1", "st-1", "Dairy", [
                            lineView(
                                line({
                                    id: "a",
                                    displayName: "A",
                                    sectionId: "s1",
                                }),
                            ),
                        ]),
                        section("s2", "st-1", "Meat", [
                            lineView(
                                line({
                                    id: "b",
                                    displayName: "B",
                                    sectionId: "s2",
                                }),
                            ),
                        ]),
                    ]),
                ],
            }),
        );
        const columns = body.match(
            /fd-page-layout__column">([\s\S]*?)<\/div><div class="fd-page-layout__column">([\s\S]*?)<\/div><\/div><\/div>/,
        );
        expect(columns?.[1]).toContain("Dairy");
        expect(columns?.[1]).not.toContain("Meat");
        expect(columns?.[2]).toContain("Meat");
    });

    test("return_to keeps the stores the list was filtered to", () => {
        const body = renderKitchenGroceriesBody(
            twoStores({ selectedStoreIds: ["st-a", "st-b"] }),
        );
        expect(body).toContain(
            'name="return_to" value="/kitchen/groceries?store=st-a&amp;store=st-b"',
        );
        expect(groceryV2ReturnTo(["st-a", "st-b"])).toBe(
            "/kitchen/groceries?store=st-a&store=st-b",
        );
        expect(groceryV2ReturnTo(["st-a"], "l 1")).toBe(
            "/kitchen/groceries?store=st-a&line=l%201",
        );
        expect(groceryV2ReturnTo()).toBe("/kitchen/groceries");
    });

    test("hostile line name is escaped in markup", () => {
        const hostile = lineView(
            line({ id: "bad", displayName: "<script>alert(1)</script>" }),
        );
        const base = baseView();
        const body = renderKitchenGroceriesBody(
            baseView({
                stores: [
                    {
                        ...base.stores[0]!,
                        sections: [
                            {
                                ...base.stores[0]!.sections[0]!,
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
        expect(html).toContain("fd-score-pill--middling");
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
                await attributeValues(html, "li[data-fd-select-row]", "id"),
            ).toEqual([`fd-grocery-row-${payload}`]);
        }
    });
});
