import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
    NO_USUAL_SCHEDULE,
    type Food,
    type UsualProductRow,
} from "../../../domain/foods.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";
import { addUsualByHand } from "../../../domain/usual-add.js";
import { createMemoryFoodsStore, newFood } from "../../../domain/foods.js";
import {
    addUsualSheet,
    knownUsualAmounts,
    usualAddFoundView,
} from "./kitchen-usuals-add.js";
import {
    kitchenUsualProductLabel,
    kitchenUsualRowMeta,
    kitchenUsualRowParts,
    kitchenUsualsEmptyMessage,
    parseUsualsStoreFilter,
    usualsReturnTo,
    kitchenUsualsResolvedOpenFoodId,
    renderKitchenUsualsBody,
    renderKitchenUsualsV2Page,
    usualRestockSheetId,
    usualSheetId,
    formatLowLevel,
    kitchenUsualsHeaderSubtitle,
    restockWeekdayLabel,
    usualRestockParts,
    usualRestockView,
    usualScheduleLabel,
    type KitchenUsualsRowMeta,
    type UsualRestockView,
} from "./kitchen-usuals.js";

const HH = "hh-1";

function food(overrides: Partial<Food> & Pick<Food, "id" | "name">): Food {
    return {
        householdId: HH,
        kind: "food",
        normalizedName: overrides.name.toLowerCase(),
        brand: null,
        defaultUnit: "each",
        gramsPerEach: null,
        gramsPerMl: null,
        serving: null,
        nutritionBasis: null,
        calories: null,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        saturatedFatG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        offNutrientLevels: null,
        allergens: [],
        offSourceId: null,
        genericFoodId: null,
        usualProductId: null,
        usualStoreId: null,
        usualAmount: null,
        ...NO_USUAL_SCHEDULE,
        usualAddedAt: null,
        offQuality: null,
        createdBy: null,
        archivedAt: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        ...overrides,
    };
}

function baseRow(): UsualProductRow {
    const eggs = food({ id: "eggs", name: "Eggs" });
    const kirkland = food({
        id: "kirkland",
        name: "Kirkland Large Eggs",
        genericFoodId: "eggs",
        brand: "Kirkland",
        usualStoreId: "st-costco",
        usualAmount: { amount: 24, unit: "each" },
    });
    return {
        food: { ...eggs, usualProductId: "kirkland" },
        products: [kirkland],
        usual: kirkland,
    };
}

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

function baseView(overrides: Record<string, unknown> = {}) {
    const row = baseRow();
    const meta: KitchenUsualsRowMeta = {
        productLabel: "Kirkland Large Eggs · Kirkland",
        storeId: "st-costco",
        storeName: "Costco",
        amountLabel: "24",
        onList: true,
    };
    return {
        chrome,
        rows: [row],
        stores: [
            { id: "st-costco", householdId: HH, name: "Costco", sortOrder: 0 },
            {
                id: "st-tj",
                householdId: HH,
                name: "Trader Joe's",
                sortOrder: 1,
            },
        ],
        rowMeta: new Map([[row.food.id, meta]]),
        addable: [food({ id: "flour", name: "Flour" })],
        openGroceriesCount: 8,
        ...overrides,
    };
}

const plainMeta = (over: Partial<KitchenUsualsRowMeta> = {}) => ({
    productLabel: "Any brand",
    storeId: null,
    storeName: null,
    amountLabel: null,
    onList: false,
    ...over,
});

describe("kitchenUsualProductLabel", () => {
    test('shows "Any brand" when no usual is set', () => {
        const row = baseRow();
        row.usual = null;
        row.food = { ...row.food, usualProductId: null };
        expect(kitchenUsualProductLabel(row)).toBe("Any brand");
    });
});

describe("kitchenUsualRowParts", () => {
    test("store, amount, restock, then low now and on the list", () => {
        const parts = kitchenUsualRowParts({
            productLabel: "x",
            storeId: "s",
            storeName: "Costco",
            amountLabel: "24",
            onList: true,
            lowNow: true,
            restock: {
                schedule: "weekly",
                everyWeeks: null,
                paused: false,
                whenLow: false,
                lowLevel: null,
                effectiveLowLevel: null,
                unit: null,
            },
        });
        expect(parts).toEqual([
            "Costco",
            "24",
            "Every week",
            "low now",
            "on the list",
        ]);
    });
});

describe("kitchenUsualRowMeta", () => {
    const ctx = {
        storesById: new Map([["st-costco", { name: "Costco" }]]),
        groceryLines: [],
        foodsById: new Map([
            ["eggs", { id: "eggs", genericFoodId: null }],
            ["kirkland", { id: "kirkland", genericFoodId: "eggs" }],
        ]),
    };

    test("reads store and amount from the usual product", () => {
        const meta = kitchenUsualRowMeta(baseRow(), ctx);
        expect(meta.storeName).toBe("Costco");
        expect(meta.amountLabel).toBe("24");
        expect(meta.onList).toBe(false);
        expect(meta.lowNow).toBe(false);
    });

    test("a usual with a running-low notice says low now, before on the list", () => {
        const meta = kitchenUsualRowMeta(baseRow(), {
            ...ctx,
            groceryLines: [{ foodId: "eggs", checked: false }],
            lowFoodIds: new Set(["eggs"]),
        });
        const parts = kitchenUsualRowParts(meta);
        expect(parts.slice(-2)).toEqual(["low now", "on the list"]);
    });
});

describe("kitchenUsualsResolvedOpenFoodId", () => {
    test("returns undefined when the food is not listed", () => {
        expect(
            kitchenUsualsResolvedOpenFoodId({
                rows: [baseRow()],
                openFoodId: "nope",
            }),
        ).toBeUndefined();
    });
});

describe("the store filter", () => {
    const stores = [{ id: "a" }, { id: "b" }];

    test("parseUsualsStoreFilter keeps known ids once, in order", () => {
        expect(parseUsualsStoreFilter("b,a,b,zzz,", stores)).toEqual([
            "b",
            "a",
        ]);
        expect(parseUsualsStoreFilter(undefined, stores)).toEqual([]);
        expect(parseUsualsStoreFilter("", stores)).toEqual([]);
    });

    test("usualsReturnTo carries every store in one value", () => {
        expect(usualsReturnTo()).toBe("/kitchen/usuals");
        expect(usualsReturnTo([])).toBe("/kitchen/usuals");
        expect(usualsReturnTo(["a", "b"])).toBe("/kitchen/usuals?store=a%2Cb");
    });

    test("kitchenUsualsEmptyMessage names the stores when the filter is empty but other usuals exist", () => {
        expect(
            kitchenUsualsEmptyMessage({
                rows: [baseRow()],
                selectedStoreIds: ["st-tj"],
                stores: [
                    {
                        id: "st-tj",
                        householdId: HH,
                        name: "Trader Joe's",
                        sortOrder: 1,
                    },
                ],
                filteredCount: 0,
            }),
        ).toBe("No usuals at Trader Joe's");
        expect(
            kitchenUsualsEmptyMessage({
                rows: [],
                selectedStoreIds: [],
                stores: [],
                filteredCount: 0,
            }),
        ).toBe("No usual products yet.");
    });

    test("with two stores the tab row has a filter with a count; with one it has none", () => {
        const two = renderKitchenUsualsBody(
            baseView({ selectedStoreIds: ["st-costco"] }) as never,
        );
        expect(two).toContain('data-anchor="filter"');
        expect(two).toContain('aria-label="Filter by store"');
        // A tick per store, Clear while one is chosen; a tick posts to no form.
        expect(two).toContain('href="/kitchen/usuals?store=st-costco%2Cst-tj"');
        // Unticking the one shown goes back to every store.
        expect(two).toMatch(
            /aria-checked="true" href="\/kitchen\/usuals">[\s\S]*?Costco/,
        );
        expect(two).toContain(">Clear<");
        const one = renderKitchenUsualsBody(
            baseView({ stores: [baseView().stores[0]] }) as never,
        );
        expect(one).not.toContain('data-anchor="filter"');
    });

    test("only the usuals at a chosen store are listed", () => {
        const eggs = baseRow();
        const milk = {
            ...baseRow(),
            food: food({ id: "milk", name: "Milk" }),
            usual: null,
            products: [],
        };
        const body = renderKitchenUsualsBody(
            baseView({
                rows: [eggs, milk],
                rowMeta: new Map([
                    [
                        "eggs",
                        plainMeta({
                            storeId: "st-costco",
                            storeName: "Costco",
                        }),
                    ],
                    [
                        "milk",
                        plainMeta({
                            storeId: "st-tj",
                            storeName: "Trader Joe's",
                        }),
                    ],
                ]),
                selectedStoreIds: ["st-tj"],
            }) as never,
        );
        expect(body).toContain('id="fd-usual-row-milk"');
        expect(body).not.toContain('id="fd-usual-row-eggs"');
    });
});

describe("renderKitchenUsualsV2Page", () => {
    test("renders Kitchen chrome: tabs, groceries count, Usuals selected", () => {
        const html = renderKitchenUsualsV2Page(baseView() as never);
        expect(html).toContain("fd-kitchen-usuals-page");
        expect(html).toContain("fd-kitchen-tabs");
        expect(html).toContain("Groceries · 8");
        expect(html).toMatch(
            /fd-side-link--sub[^>]*href="\/kitchen\/usuals"[^>]*aria-current="page"/,
        );
        const kitchenTab = html.match(
            /<nav class="fd-kitchen-tabs"[\s\S]*?<\/nav>/,
        )?.[0];
        expect(kitchenTab).toMatch(/aria-current="page"[^>]*>Usuals/);
    });

    test("a row is the usual's name, its product beside it, then store, amount, restock", () => {
        const body = renderKitchenUsualsBody(baseView() as never);
        expect(body).toContain("fd-page-layout--single");
        expect(body).toContain("fd-section-header");
        expect(body).toContain('id="fd-usual-row-eggs"');
        expect(body).toContain(
            '<span class="fd-item-row__meta">Kirkland Large Eggs · Kirkland</span>',
        );
        expect(body).toContain("Costco · 24 · on the list");
        // The row opens its sheet and says so with a chevron; no text cut back.
        expect(body).toContain('data-sheet-id="fd-usual-eggs"');
        expect(body).toContain("fd-item-row__chevron");
        // Nothing explains the page.
        expect(body).not.toContain("What you usually buy");
        expect(body).not.toContain("fd-kitchen-usual-intro");
        expect(body).not.toContain("Your usual product, store and amount");
    });

    test("a usual with no product says so on its row", () => {
        const row = baseRow();
        row.usual = null;
        row.food = { ...row.food, usualProductId: null };
        const body = renderKitchenUsualsBody(
            baseView({
                rows: [row],
                rowMeta: new Map([[row.food.id, plainMeta()]]),
            }) as never,
        );
        expect(body).toContain("No usual product yet");
    });

    test("a low usual reads 'low now' in the warning tone, and nothing else does", () => {
        const body = renderKitchenUsualsBody(
            baseView({
                rowMeta: new Map([
                    [
                        "eggs",
                        {
                            ...plainMeta({
                                storeName: "Costco",
                                storeId: "st-costco",
                            }),
                            lowNow: true,
                        },
                    ],
                ]),
            }) as never,
        );
        expect(body).toMatch(
            /fd-item-row--warning"[^>]*id="fd-usual-row-eggs"|id="fd-usual-row-eggs"[^>]*>/,
        );
        expect(body).toContain("fd-item-row--warning");
        expect(body).toContain("Costco · low now");
        const calm = renderKitchenUsualsBody(baseView() as never);
        expect(calm).not.toContain("fd-item-row--warning");
        expect(calm).not.toContain("low now");
    });

    test("select mode: the tab row's ⋯ holds Select, and the Selection bars remove in place", () => {
        const body = renderKitchenUsualsBody(baseView() as never);
        expect(body).toContain(
            'class="fd-kitchen-usuals-page" data-fd-select="usuals"',
        );
        expect(body).toContain('aria-label="Usuals options"');
        expect(body).toContain('data-fd-select-toggle="usuals"');
        expect(body).toMatch(
            /<input type="checkbox" class="fd-item-row__select-input" data-fd-select-item name="ids\[\]" value="eggs"/,
        );
        expect(body).toContain('action="/kitchen/usuals/bulk/remove"');
        // Asks in place: the verb arms, Cancel and "Remove N" take its place.
        expect(body).toContain("data-fd-select-ask");
        expect(body).toContain("data-fd-select-unask");
        expect(body).toContain("fd-select-bar-slot--phone");
        expect(body).toContain("fd-select-bar-slot--desktop");
        // No confirm sheet for it any more.
        expect(body).not.toContain("fd-sheet--confirm");
        expect(body).not.toContain("data-fd-select-message");
    });

    test("select mode: an empty list has no Select and no empty ⋯", () => {
        const body = renderKitchenUsualsBody(
            baseView({ rows: [], rowMeta: new Map(), stores: [] }) as never,
        );
        expect(body).not.toContain("data-fd-select-toggle");
        expect(body).not.toContain('aria-label="Usuals options"');
        expect(body).not.toContain("fd-select-bar-slot");
        expect(body).toContain("No usual products yet.");
    });

    test("escaping in names, and the add row", () => {
        const nasty = baseView({
            rows: [
                {
                    ...baseRow(),
                    food: food({
                        id: 'egg"x',
                        name: `<img src=x onerror=alert(1)>`,
                    }),
                },
            ],
            rowMeta: new Map([
                ['egg"x', plainMeta({ productLabel: `<b>bad</b>` })],
            ]),
        });
        const html = renderKitchenUsualsBody(nasty as never);
        expect(html).toContain("Add a usual");
        expect(html).toContain("data-fd-usual-add-row");
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
        expect(html).toContain('id="fd-usual-row-egg&quot;x"');
    });

    test("a product id or name made of $-patterns stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const view = baseView({
                rows: [
                    {
                        ...baseRow(),
                        food: food({ id: payload, name: payload }),
                        usual: null,
                        products: [],
                    },
                ],
                rowMeta: new Map([
                    [payload, plainMeta({ productLabel: payload })],
                ]),
            });
            const html = renderKitchenUsualsBody(view as never);
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(html, "li[data-fd-sheet-row]", "id"),
            ).toEqual([`fd-usual-row-${payload}`]);
        }
    });

    test("shows unknown-food errors on the page, not inside a sheet", () => {
        const body = renderKitchenUsualsBody(
            baseView({
                openFoodId: "does-not-exist",
                error: "Unknown food.",
            }) as never,
        );
        expect(body).toContain("Unknown food.");
        expect(body).toContain('class="fd-settings-error"');
        expect(body).not.toContain("data-sheet-open-on-load");
    });
});

describe("usual restock row meta", () => {
    const view = (over: Partial<UsualRestockView>): UsualRestockView => ({
        schedule: null,
        everyWeeks: null,
        paused: false,
        whenLow: false,
        lowLevel: null,
        effectiveLowLevel: null,
        unit: null,
        ...over,
    });

    test("no schedule and not when-low shows nothing", () => {
        expect(usualRestockParts(view({}))).toEqual([]);
        expect(usualScheduleLabel(view({}))).toBeNull();
    });

    test("each schedule reads as the design words it", () => {
        expect(usualScheduleLabel(view({ schedule: "weekly" }))).toBe(
            "Every week",
        );
        expect(usualScheduleLabel(view({ schedule: "monthly" }))).toBe(
            "Every month",
        );
        expect(
            usualScheduleLabel(
                view({ schedule: "every_n_weeks", everyWeeks: 2 }),
            ),
        ).toBe("Every 2 weeks");
        expect(
            usualScheduleLabel(
                view({ schedule: "every_n_weeks", everyWeeks: 1 }),
            ),
        ).toBe("Every week");
    });

    test("the row names the schedule, or 'When low' with none; the level stays in the Restock sheet", () => {
        expect(
            usualRestockParts(
                view({
                    schedule: "weekly",
                    whenLow: true,
                    effectiveLowLevel: 6,
                }),
            ),
        ).toEqual(["Every week"]);
        expect(
            usualRestockParts(
                view({ whenLow: true, lowLevel: 2, effectiveLowLevel: 2 }),
            ),
        ).toEqual(["When low"]);
    });

    test("paused wins; paused with nothing to pause shows nothing", () => {
        expect(
            usualRestockParts(view({ schedule: "weekly", paused: true })),
        ).toEqual(["Paused"]);
        expect(usualRestockParts(view({ paused: true }))).toEqual([]);
    });

    test("the row carries the parts after store and amount, before 'on the list'", () => {
        const restock = view({ schedule: "weekly" });
        const parts = kitchenUsualRowParts({
            ...plainMeta({
                storeName: "Costco",
                amountLabel: "24",
                onList: true,
            }),
            restock,
        });
        expect(parts).toEqual(["Costco", "24", "Every week", "on the list"]);
    });

    test("usualRestockView reads the food", () => {
        const row = baseRow();
        row.food = {
            ...row.food,
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 3,
            restockWhenLow: true,
        };
        const view = usualRestockView(row);
        expect(view.schedule).toBe("every_n_weeks");
        expect(view.everyWeeks).toBe(3);
        expect(view.whenLow).toBe(true);
        // A quarter of the usual 24.
        expect(view.effectiveLowLevel).toBe(6);
        expect(view.unit).toBe("each");
    });
});

describe("formatLowLevel", () => {
    test("whole numbers, fractions and decimals", () => {
        expect(formatLowLevel(6)).toBe("6");
        expect(formatLowLevel(1.5)).toBe("1½");
        expect(formatLowLevel(0.25)).toBe("¼");
        expect(formatLowLevel(2.4)).toBe("2.4");
    });
});

describe("header subtitle", () => {
    test("names the restock day only when given", () => {
        expect(kitchenUsualsHeaderSubtitle(1)).toBe("1 usual");
        expect(kitchenUsualsHeaderSubtitle(7, "Sundays")).toBe(
            "7 usuals · restock on Sundays",
        );
        expect(restockWeekdayLabel(0)).toBe("Sundays");
    });
});

describe("page header", () => {
    test("is the same as on Fridge and Groceries", () => {
        const body = renderKitchenUsualsBody(
            baseView({ restockDay: "Sundays" }) as never,
        );
        expect(body).toMatch(/^<header class="fd-page-header fd-kitchen-head"/);
        expect(body).toContain('data-fd-kitchen-tab="usuals"');
        expect(body).toContain("1 usual · restock on Sundays");
    });

    test("the + sits in the tab row on the phone and, labelled, in the header's Actions slot", () => {
        const body = renderKitchenUsualsBody(baseView() as never);
        expect(body).toContain("fd-kitchen-fridge-top");
        expect(body).toContain("fd-kitchen-overview-add");
        expect(
            body.match(/commandfor="fd-usual-add"/g)?.length,
        ).toBeGreaterThanOrEqual(3);
    });
});

describe("edit-usual sheet", () => {
    function sheetHtml(over: Record<string, unknown> = {}): string {
        const html = renderKitchenUsualsBody(
            baseView({ openFoodId: "eggs", ...over }) as never,
        );
        const start = html.indexOf(
            '<dialog class="fd-sheet fd-sheet--side fd-kitchen-sheet" id="fd-usual-eggs"',
        );
        expect(start).toBeGreaterThan(-1);
        return html.slice(start, html.indexOf("</dialog>", start));
    }

    test("opens when openFoodId matches a row, with its error inside it", () => {
        const html = sheetHtml({ error: "Bad unit" });
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain("Bad unit");
    });

    test("one form posts the product, store, amount, unit, switch and weights", () => {
        const html = sheetHtml();
        expect(html).toContain(
            '<form id="fd-usual-eggs-form" method="post" action="/kitchen/usuals/eggs"',
        );
        expect(html).toContain('name="return_to" value="/kitchen/usuals"');
        expect(html).toContain('name="restock_when_low_present" value="1"');
        expect(html).toContain('name="weights_present" value="1"');
        expect(html).toMatch(/name="usual_store_id" value="st-costco" checked/);
        expect(html).toContain('name="usual_store_id" value=""');
        expect(html).toContain('name="usual_amount" value="24"');
        // The unit is a pull-down on a row whose choice rides in a field.
        expect(html).toContain(
            '<input type="hidden" name="usual_unit" value="each" data-fd-menu-field>',
        );
        expect(html).toContain('data-fd-menu-value="g"');
        expect(html).toContain('data-fd-menu-value=""');
        expect(html).toContain('name="restock_when_low" value="1"');
        expect(html).toContain('name="grams_per_ml"');
        expect(html).toContain('name="grams_per_each"');
        // The Save button posts the form from the action row.
        expect(html).toContain('form="fd-usual-eggs-form"');
        expect(html).not.toMatch(/fd-sheet__actions[\s\S]*Remove/);
    });

    test("the product row opens the picker, whose radios belong to the edit form", () => {
        const html = renderKitchenUsualsBody(
            baseView({ openFoodId: "eggs" }) as never,
        );
        expect(html).toContain('commandfor="fd-usual-eggs-product"');
        const picker = html.slice(html.indexOf('id="fd-usual-eggs-product"'));
        expect(picker).toMatch(
            /name="product_food_id" value="kirkland" form="fd-usual-eggs-form" checked/,
        );
        expect(picker).toMatch(
            /name="product_food_id" value="" form="fd-usual-eggs-form"/,
        );
        expect(picker).toContain("Any brand");
        expect(picker).toContain("data-fd-usual-product-search");
    });

    test("Remove is in the header ⋯ and asks in place; there is no remove sheet", () => {
        const html = sheetHtml();
        const head = html.slice(
            html.indexOf("<header"),
            html.indexOf("</header>"),
        );
        expect(head).toContain("fd-sheet__menu");
        expect(head).toContain("data-fd-menu-arm");
        expect(head).toContain('action="/kitchen/usuals/eggs/remove"');
        expect(head).toContain('name="return_to" value="/kitchen/usuals"');
        expect(head).toContain("Confirm Remove");
        const page = renderKitchenUsualsBody(baseView() as never);
        expect(page).not.toContain("fd-usual-eggs-remove");
        expect(page).not.toContain("Remove from usuals");
    });

    test("a refused post comes back to the store the list was filtered to", () => {
        const html = sheetHtml({ selectedStoreIds: ["st-costco", "st-tj"] });
        expect(html).toContain(
            'name="return_to" value="/kitchen/usuals?store=st-costco%2Cst-tj"',
        );
    });

    test("the Restock row shows the schedule and the switch is a field of the edit form", () => {
        const row = baseRow();
        row.food = {
            ...row.food,
            restockSchedule: "weekly",
            restockWhenLow: true,
        };
        const html = sheetHtml({ rows: [row] });
        expect(html).toContain('commandfor="fd-usual-eggs-restock"');
        expect(html).toContain("Every week");
        expect(html).toMatch(/name="restock_when_low" value="1" checked/);
    });

    test("the Restock sheet has the schedule choice, weeks, paused and the level, and posts the schedule route", () => {
        const html = renderKitchenUsualsBody(
            baseView({ openFoodId: "eggs" }) as never,
        );
        const restock = html.slice(html.indexOf('id="fd-usual-eggs-restock"'));
        expect(restock).toContain('action="/kitchen/usuals/eggs/schedule"');
        expect(restock).toContain('name="scope" value="schedule"');
        for (const value of ["", "weekly", "every_n_weeks", "monthly"]) {
            expect(restock).toContain(
                `name="restock_schedule" value="${value}"`,
            );
        }
        expect(restock).toContain('name="restock_every_weeks"');
        expect(restock).toContain('name="restock_paused" value="1"');
        expect(restock).toContain('name="restock_low_level"');
        expect(restock).not.toContain("fd-switch");
    });

    test("an unset level shows the default quarter as the placeholder", () => {
        const html = renderKitchenUsualsBody(
            baseView({ openFoodId: "eggs" }) as never,
        );
        const restock = html.slice(html.indexOf('id="fd-usual-eggs-restock"'));
        expect(restock).toContain('placeholder="6"');
    });

    test("the edit form carries grams per ml and per item for the plain food, the product's as placeholder", () => {
        const row = baseRow();
        row.food = { ...row.food, gramsPerMl: 1.03 };
        row.usual = { ...row.usual!, gramsPerEach: 50 };
        const html = sheetHtml({ rows: [row] });
        expect(html).toMatch(/name="grams_per_ml"[^>]*value="1.03"/);
        expect(html).toMatch(/name="grams_per_each"[^>]*placeholder="50"/);
        // No help text under them.
        expect(html).not.toContain("For cups and spoons");
    });

    test("openRestock reopens the Restock sheet and puts the error in it", () => {
        const html = renderKitchenUsualsBody(
            baseView({
                openFoodId: "eggs",
                openRestock: true,
                error: "Weeks must be 1 to 52.",
            }) as never,
        );
        const restock = html.slice(html.indexOf('id="fd-usual-eggs-restock"'));
        expect(restock.slice(0, restock.indexOf("</dialog>"))).toContain(
            "Weeks must be 1 to 52.",
        );
        const edit = html.slice(
            html.indexOf('id="fd-usual-eggs"'),
            html.indexOf('id="fd-usual-eggs-form"'),
        );
        expect(edit).not.toContain("Weeks must be 1 to 52.");
    });

    test("a typed usual with no product renders as a row with a working edit sheet", () => {
        const typed = food({
            id: "oat",
            name: "Oat milk",
            usualAddedAt: "2026-11-13",
        });
        const html = renderKitchenUsualsBody(
            baseView({
                rows: [{ food: typed, products: [], usual: null }],
                rowMeta: new Map([["oat", plainMeta()]]),
            }) as never,
        );
        expect(html).toContain('id="fd-usual-row-oat"');
        expect(html).toContain('action="/kitchen/usuals/oat"');
        expect(html).toContain('action="/kitchen/usuals/oat/remove"');
    });
});

describe("Add a usual sheet", () => {
    const scanFound = {
        kind: "found" as const,
        code: "0193968379117",
        product: { id: "p1", name: "Half & Half", brand: "Member's Mark" },
        self: false,
        options: [{ id: "hh", name: "Half & half", brand: null }],
        choice: "hh",
        newName: "Half & Half",
        query: "",
        purchase: {},
    };

    function addSheetHtml(overrides: Record<string, unknown> = {}): string {
        const html = renderKitchenUsualsBody(baseView(overrides) as never);
        const start = html.indexOf(
            '<dialog class="fd-sheet fd-sheet--dialog fd-kitchen-sheet fd-usual-add" id="fd-usual-add"',
        );
        expect(start).toBeGreaterThan(-1);
        return html.slice(start, html.indexOf("</dialog>", start));
    }

    const cameraOff = () => {
        const view = baseView();
        return {
            ...view,
            chrome: {
                ...view.chrome,
                flags: { ...view.chrome.flags, barcodeCamera: false },
            },
        };
    };

    test("opens from a trigger that shows even with nothing searchable", () => {
        const html = renderKitchenUsualsBody(
            baseView({ addable: [], rows: [], rowMeta: new Map() }) as never,
        );
        expect(html).toContain('commandfor="fd-usual-add"');
        expect(html).toContain('id="fd-usual-add"');
    });

    test("has three ways in, as quick actions: Scan, Search your foods and Type it", () => {
        const sheet = addSheetHtml();
        expect(sheet).toContain("fd-quick-action");
        expect(sheet).toContain("Scan a barcode");
        expect(sheet).toContain("Search your foods");
        expect(sheet).toContain("Type it");
        expect(sheet).toContain('data-fd-usual-add-tab="search"');
        expect(sheet).toContain('data-fd-usual-add-tab="type"');
        // Scan is no view: it opens the scanner.
        expect(sheet).not.toContain('data-fd-usual-add-tab="scan"');
        // Search shows; Type it is hidden until chosen.
        expect(sheet).not.toMatch(
            /data-fd-usual-add-panel="search"[^>]*hidden/,
        );
        expect(sheet).toMatch(/data-fd-usual-add-panel="type"[^>]*hidden/);
        expect(sheet).not.toContain('role="tab"');
    });

    test("Scan opens the shared scanner and aims it at this page", () => {
        const sheet = addSheetHtml();
        expect(sheet).toContain('data-fd-open-sheet="fd-barcode-scan"');
        expect(sheet).toContain(
            'data-fd-scanner-target="/kitchen/usuals/add/barcode/{code}"',
        );
    });

    test("the stores the list is filtered to ride along in the scan target and the search", () => {
        const sheet = addSheetHtml({
            selectedStoreIds: ["st-costco", "st-tj"],
        });
        expect(sheet).toContain(
            'data-fd-scanner-target="/kitchen/usuals/add/barcode/{code}?store=st-costco%2Cst-tj"',
        );
        expect(sheet).toContain(
            '<input type="hidden" name="store" value="st-costco,st-tj" />',
        );
    });

    test("with barcode-camera on and off: Scan a barcode or Enter a barcode, the same opener", () => {
        const on = addSheetHtml();
        expect(on).toContain("Scan a barcode");
        expect(on).not.toContain("Enter a barcode");
        const off = addSheetHtml(cameraOff());
        expect(off).toContain("Enter a barcode");
        expect(off).not.toContain("Scan a barcode");
        expect(off).toContain('data-fd-open-sheet="fd-barcode-scan"');
        // The menus do not depend on it: no ⋯ is empty either way.
        for (const html of [
            renderKitchenUsualsBody(baseView() as never),
            renderKitchenUsualsBody(cameraOff() as never),
        ]) {
            expect(html).not.toMatch(/fd-menu__panel"[^>]*hidden><\/div>/);
        }
    });

    test("Search lists foods that are not usuals yet, each with a plus that adds it", () => {
        const sheet = addSheetHtml();
        expect(sheet).toContain('name="q"');
        expect(sheet).toContain("Your foods");
        expect(sheet).toContain('data-fd-usual-food="flour"');
        expect(sheet).toContain('action="/kitchen/usuals/add/product"');
        expect(sheet).toContain('name="product_id" value="flour"');
        expect(sheet).toContain('name="food_choice" value="flour"');
        expect(sheet).toContain('name="via" value="search"');
        expect(sheet).toContain("Add Flour as a usual");
        expect(sheet).not.toContain("data-sheet-open-on-load");
    });

    test("Search says so when nothing is searchable, and a search with no match says so", () => {
        const empty = addSheetHtml({ addable: [] });
        expect(empty).toContain(
            "Nothing to add from your foods. Scan it or type it in.",
        );
        const none = addSheetHtml({
            add: {
                tab: "search",
                search: { q: "zzz", results: [], truncated: false },
            },
        });
        expect(none).toContain("No matching food.");
        expect(none).toContain('value="zzz"');
        expect(none).toContain("data-sheet-open-on-load");
    });

    test("a server search keeps its query and says when it was cut", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "search",
                search: {
                    q: "flo",
                    results: [food({ id: "flour", name: "Flour" })],
                    truncated: true,
                },
            },
        });
        expect(sheet).toContain('name="q" value="flo"');
        expect(sheet).toContain('name="q" value="flo"');
        expect(sheet).toContain("Showing the first 20");
    });

    test("What is it? shows the product and preselects its food", () => {
        const sheet = addSheetHtml({ add: { tab: "scan", scan: scanFound } });
        expect(sheet).toContain("What is it?");
        expect(sheet).toContain("Half &amp; Half");
        expect(sheet).toMatch(/Member(&#0?39;|')s Mark/);
        expect(sheet).toContain('action="/kitchen/usuals/add/product"');
        expect(sheet).toContain('name="product_id" value="p1"');
        expect(sheet).toContain('name="scan_code" value="0193968379117"');
        expect(sheet).toMatch(/name="food_choice" value="hh" checked/);
        expect(sheet).toContain('name="new_food_name"');
        expect(sheet).toContain('value="Half &amp; Half"');
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toMatch(/data-fd-usual-add-panel="scan"(?![^>]*hidden)/);
    });

    test("What is it? offers a search of foods and a new name", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "scan",
                scan: {
                    ...scanFound,
                    options: [],
                    choice: "new",
                    query: "milk",
                },
            },
        });
        expect(sheet).toContain('name="fq"');
        expect(sheet).toContain('value="milk"');
        expect(sheet).toMatch(/name="food_choice" value="new" checked/);
    });

    test("a scanned plain food is added as it is, with nothing to pick", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "scan",
                scan: { ...scanFound, self: true, options: [], choice: "" },
            },
        });
        const scan = sheet.slice(
            sheet.indexOf('data-fd-usual-add-panel="scan"'),
            sheet.indexOf('data-fd-usual-add-panel="search"'),
        );
        expect(scan).toContain('name="product_id" value="p1"');
        expect(scan).not.toContain('name="food_choice"');
        expect(scan).toContain("Add usual");
    });

    test("a scan miss lands on Type it with the barcode carried", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "type",
                scan: {
                    kind: "miss",
                    code: "0123456789012",
                    lookupFailed: false,
                },
            },
        });
        expect(sheet).toContain("0123456789012");
        expect(sheet).toContain('name="barcode" value="0123456789012"');
        expect(sheet).not.toMatch(/data-fd-usual-add-panel="type"[^>]*hidden/);
        expect(sheet).toMatch(/data-fd-usual-add-panel="search"[^>]*hidden/);
        expect(sheet).toContain("data-sheet-open-on-load");
    });

    test("a failed lookup says it could not look the code up, a paused one says it did not", () => {
        const failed = addSheetHtml({
            add: {
                tab: "type",
                scan: {
                    kind: "miss",
                    code: "0123456789012",
                    lookupFailed: true,
                },
            },
        });
        expect(failed).toContain("Could not look this barcode up");
        const paused = addSheetHtml({
            add: {
                tab: "type",
                scan: {
                    kind: "miss",
                    code: "1",
                    lookupFailed: false,
                    paused: true,
                },
            },
        });
        expect(paused).toContain("Online food lookups are paused");
        expect(paused).not.toContain("No product found");
    });

    test("an invalid code is said in the sheet", () => {
        const sheet = addSheetHtml({
            add: { tab: "scan", scan: { kind: "invalid", code: "12" } },
        });
        expect(sheet).toContain("isn't a barcode");
    });

    test("Type it asks for the name and all four macros, per 100 g by default", () => {
        const sheet = addSheetHtml();
        expect(sheet).toContain('action="/kitchen/usuals/add/manual"');
        for (const name of [
            "name",
            "calories",
            "protein_g",
            "carbs_g",
            "fat_g",
        ]) {
            expect(sheet).toMatch(new RegExp(`name="${name}"[^>]*required`));
        }
        expect(sheet).toMatch(/name="calories"[^>]*inputmode="decimal"/);
        expect(sheet).toMatch(/name="basis" value="per_100g" checked/);
        expect(sheet).toContain('name="basis" value="per_100ml"');
        expect(sheet).toContain('name="basis" value="per_serving"');
        expect(sheet).toContain('name="serving_amount"');
        expect(sheet).toContain('name="serving_unit"');
        expect(sheet).toContain('name="usual_amount"');
        // Store and unit are pull-downs whose choice rides in a field.
        expect(sheet).toContain(
            '<input type="hidden" name="usual_store_id" value="" data-fd-menu-field>',
        );
        expect(sheet).toContain(
            '<input type="hidden" name="usual_unit" value="each" data-fd-menu-field>',
        );
        expect(sheet).toContain('data-fd-menu-value="st-costco"');
        expect(sheet).not.toMatch(/name="barcode"/);
    });

    test("a Type it error keeps the values and sits under its field", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "type",
                type: {
                    values: {
                        name: "Oat milk",
                        protein_g: "1",
                        basis: "per_100ml",
                        usual_store_id: "st-tj",
                        usual_amount: "64",
                        usual_unit: "fl oz",
                    },
                },
                error: { message: "Enter the calories.", field: "calories" },
            },
        });
        expect(sheet).toContain('value="Oat milk"');
        expect(sheet).toMatch(/name="basis" value="per_100ml" checked/);
        expect(sheet).toContain("Enter the calories.");
        expect(sheet).toMatch(/name="calories"[^>]*aria-invalid="true"/);
        expect(sheet).toContain('name="usual_store_id" value="st-tj"');
        expect(sheet).toContain('name="usual_amount" value="64"');
        expect(sheet).toContain('name="usual_unit" value="fl oz"');
        expect(sheet).toContain("data-sheet-open-on-load");
    });

    test("an error with no field is a sheet-level message", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "type",
                error: {
                    message: "Oat milk already has different macros.",
                    field: null,
                },
            },
        });
        expect(sheet).toContain(
            '<p class="fd-kitchen-sheet-error" role="alert">Oat milk already has different macros.</p>',
        );
    });

    test("a What is it? error sits under the food choice", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "scan",
                scan: scanFound,
                error: {
                    message: "Pick the food this product is.",
                    field: "food",
                },
            },
        });
        expect(sheet).toContain('id="fd-usual-add-food-error"');
        expect(sheet).toContain("Pick the food this product is.");
    });

    test("What is it? shows the store and amount that were picked", () => {
        const sheet = addSheetHtml({
            add: {
                tab: "scan",
                scan: {
                    ...scanFound,
                    purchase: {
                        usual_store_id: "st-1",
                        usual_amount: "12",
                        usual_unit: "each",
                    },
                },
            },
            stores: [{ id: "st-1", name: "Costco" }],
        });
        expect(sheet).toContain('name="usual_store_id" value="st-1"');
        expect(sheet).toContain('name="usual_amount" value="12"');
        expect(sheet).toContain('name="usual_unit" value="each"');
    });

    /** What the Type it form would post for the usual amount, read off its markup. */
    function postedPurchase(html: string): {
        amount: number;
        unit: string | null;
    } {
        const type = html.slice(html.indexOf('id="fd-usual-add-type-form"'));
        const amount = type.match(/name="usual_amount"[^>]*value="([^"]*)"/);
        const unit = type.match(/name="usual_unit" value="([^"]*)"/);
        return {
            amount: Number(amount?.[1]),
            unit: unit?.[1] ? unit[1] : null,
        };
    }

    test("Type it of a food that has a usual amount offers it, so Add a usual never overwrites it unseen", async () => {
        const store = createMemoryFoodsStore();
        await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Milk",
                usualAmount: { amount: 2, unit: "l" },
            }),
        );
        const html = addUsualSheet({
            addable: [],
            stores: [],
            returnTo: "/kitchen/usuals",
            barcodeCamera: true,
            known: knownUsualAmounts([
                food({
                    id: "milk",
                    name: "Milk",
                    usualAmount: { amount: 2, unit: "l" },
                }),
            ]),
            add: { tab: "type", type: { values: { name: "Milk" } } },
        });
        const posted = postedPurchase(html);
        expect(posted).toEqual({ amount: 2, unit: "l" });
        const saved = await addUsualByHand(store, HH, {
            name: "Milk",
            basis: "per_100ml",
            calories: 60,
            proteinG: 3,
            carbsG: 5,
            fatG: 3,
            stores: { listStores: async () => [] },
            createdBy: null,
            purchase: { usualAmount: posted },
        });
        expect(saved.usualAmount).toEqual({ amount: 2, unit: "l" });
    });

    test("Type it starts a new food at one each, and a known food with no amount at none", () => {
        const known = knownUsualAmounts([
            food({ id: "salt", name: "Salt", usualAmount: null }),
        ]);
        const sheet = (name: string) =>
            addUsualSheet({
                addable: [],
                stores: [],
                returnTo: "/kitchen/usuals",
                barcodeCamera: true,
                known,
                add: { tab: "type", type: { values: { name } } },
            });
        expect(postedPurchase(sheet("Oat milk"))).toEqual({
            amount: 1,
            unit: "each",
        });
        expect(postedPurchase(sheet("salt")).unit).toBeNull();
    });

    test("the scan's choices carry each food's usual amount, and the chosen one is offered", () => {
        const html = addSheetHtml({
            add: {
                tab: "scan",
                scan: {
                    ...scanFound,
                    options: [
                        {
                            id: "hh",
                            name: "Half & half",
                            brand: null,
                            usualAmount: { amount: 3, unit: "each" },
                        },
                    ],
                },
            },
        });
        expect(html).toContain('data-fd-usual-amount="3"');
        expect(html).toContain('data-fd-usual-unit="each"');
        // The "A new food" row starts at one each.
        expect(html).toContain('data-fd-usual-amount="1"');
        expect(html).toMatch(/name="usual_amount"[^>]*value="3"/);
    });

    test("the food list says when it shows only the first foods, for the search that reaches the rest", () => {
        const many = Array.from({ length: 25 }, (_, i) =>
            food({ id: `f${i}`, name: `Food ${i}` }),
        );
        const html = addSheetHtml({ addable: many });
        expect(html).toContain("data-fd-usual-more");
        expect(addSheetHtml({ addable: many.slice(0, 3) })).not.toContain(
            "data-fd-usual-more",
        );
    });

    test("the Add a usual sheet parks focus on the panel, not a hidden field", () => {
        expect(addSheetHtml()).toContain('data-fd-sheet-focus="panel"');
    });

    test("the sheet's buttons keep their size: forms are grids, not flex columns", () => {
        const css = readFileSync("./public/app/v2/kitchen.css", "utf8");
        expect(css).toMatch(/\.fd-usual-add-type,[\s\S]*?display:\s*grid/);
        expect(css).toMatch(
            /\.fd-sheet \.fd-usual-add-type > \.fd-btn\[data-fd-btn\]\s*,[\s\S]*?flex:\s*none/,
        );
        expect(css).not.toContain(".fd-switch");
    });
});

describe("usualAddFoundView", () => {
    const eggs = food({ id: "eggs", name: "Eggs" });
    const kirkland = food({
        id: "k",
        name: "Kirkland Large Eggs",
        brand: "Kirkland",
        offSourceId: "0123456789012",
    });
    const noAliases = new Map<string, string[]>();
    const found = { code: "0123456789012", productId: "k" };

    test("a product with no food yet is offered the foods its name holds, best first", () => {
        const flour = food({ id: "flour", name: "Flour" });
        const view = usualAddFoundView(
            found,
            [eggs, kirkland, flour],
            noAliases,
        )!;
        expect(view.self).toBe(false);
        expect(view.options.map((o) => o.id)).toEqual(["eggs"]);
        expect(view.choice).toBe("eggs");
        expect(view.newName).toBe("Large Eggs");
    });

    test("the new-name prefill collapses the spaces in the product's name", () => {
        const spaced = {
            ...kirkland,
            name: "Kirkland   Large  Eggs ",
        };
        const view = usualAddFoundView(found, [spaced], noAliases)!;
        expect(view.newName).toBe("Large Eggs");
    });

    test("a product filed under a food puts that food first, marked, and keeps it chosen", () => {
        const duck = food({ id: "duck", name: "Duck eggs" });
        const filed = { ...kirkland, genericFoodId: "eggs" };
        const view = usualAddFoundView(found, [eggs, filed, duck], noAliases)!;
        expect(view.options[0]).toMatchObject({
            id: "eggs",
            note: "Filed under this",
        });
        expect(view.choice).toBe("eggs");
    });

    test("nothing close means a new food is the choice", () => {
        const view = usualAddFoundView(found, [kirkland], noAliases)!;
        expect(view.options).toEqual([]);
        expect(view.choice).toBe("new");
    });

    test("a search lists foods that hold its words and keeps a choice already made", () => {
        const flour = food({ id: "flour", name: "Flour" });
        const view = usualAddFoundView(
            { ...found, query: "flo", choice: "flour" },
            [eggs, kirkland, flour],
            noAliases,
        )!;
        expect(view.options.map((o) => o.id)).toEqual(["flour"]);
        expect(view.choice).toBe("flour");
        expect(view.query).toBe("flo");
    });

    test("a food chosen earlier stays on offer when the search no longer lists it", () => {
        const flour = food({ id: "flour", name: "Flour" });
        const view = usualAddFoundView(
            { ...found, query: "eggs", choice: "flour" },
            [eggs, kirkland, flour],
            noAliases,
        )!;
        expect(view.options[0]!.id).toBe("flour");
        expect(view.choice).toBe("flour");
    });

    test("a plain food with no brand is added as it is", () => {
        const view = usualAddFoundView(
            { ...found, productId: "eggs" },
            [eggs],
            noAliases,
        )!;
        expect(view.self).toBe(true);
        expect(view.choice).toBe("");
    });

    test("another brand's product is never a candidate, nor preselected", () => {
        const organic = food({
            id: "ov",
            name: "Eggs",
            brand: "Organic Valley",
            offSourceId: "0093966000016",
        });
        const view = usualAddFoundView(found, [kirkland, organic], noAliases)!;
        expect(view.options).toEqual([]);
        expect(view.choice).toBe("new");
        const searched = usualAddFoundView(
            { ...found, query: "eggs" },
            [kirkland, organic],
            noAliases,
        )!;
        expect(searched.options).toEqual([]);
    });

    test("a product that is gone gives no step", () => {
        expect(usualAddFoundView(found, [eggs], noAliases)).toBeNull();
        expect(
            usualAddFoundView(
                found,
                [{ ...kirkland, archivedAt: "2026-01-01" }],
                noAliases,
            ),
        ).toBeNull();
    });
});

describe("round-two details", () => {
    function addSheet(overrides: Record<string, unknown> = {}): string {
        const html = renderKitchenUsualsBody(baseView(overrides) as never);
        const start = html.indexOf(
            '<dialog class="fd-sheet fd-sheet--dialog fd-kitchen-sheet fd-usual-add" id="fd-usual-add"',
        );
        expect(start).toBeGreaterThan(-1);
        return html.slice(start, html.indexOf("</dialog>", start));
    }
    const typePanel = (sheet: string) =>
        sheet.slice(sheet.indexOf('data-fd-usual-add-panel="type"'));
    const storeField = (html: string) =>
        html.match(/name="usual_store_id"[^>]*>/)?.[0] ?? "";

    test("a usual added under one store filter is added at that store, and returns to it", () => {
        const sheet = addSheet({ selectedStoreIds: ["st-tj"] });
        // Type it of a new food offers the filtered store.
        expect(storeField(typePanel(sheet))).toContain('value="st-tj"');
        // Search adds a food that has no store at that store.
        expect(sheet).toMatch(
            /name="usual_store_id" value="st-tj"[\s\S]*?Add Flour as a usual/,
        );
        expect(sheet).toContain(
            'name="return_to" value="/kitchen/usuals?store=st-tj"',
        );
    });

    test("a food that already has a store keeps it, and no store is posted with no filter", () => {
        const stored = food({
            id: "rice",
            name: "Rice",
            usualStoreId: "st-costco",
        });
        const sheet = addSheet({
            selectedStoreIds: ["st-tj"],
            addable: [stored],
        });
        const row = sheet.slice(sheet.indexOf("Add Rice as a usual") - 900);
        expect(row.slice(0, row.indexOf("Add Rice as a usual"))).not.toContain(
            'name="usual_store_id"',
        );
        const none = addSheet();
        expect(none).not.toMatch(
            /name="usual_store_id" value="st-[a-z]+"[\s\S]*?Add Flour/,
        );
    });

    test("with two stores filtered the add returns to the whole list", () => {
        const sheet = addSheet({ selectedStoreIds: ["st-costco", "st-tj"] });
        expect(sheet).toContain('name="return_to" value="/kitchen/usuals"');
        expect(sheet).not.toContain('name="return_to" value="/kitchen/usuals?');
        expect(storeField(typePanel(sheet))).not.toContain('value="st-');
    });

    test("Type it shows its form alone: the tiles are hidden, and Back is a tab button", () => {
        const search = addSheet();
        expect(search).toMatch(/<div data-fd-usual-add-tiles>/);
        const type = addSheet({ add: { tab: "type" } });
        expect(type).toMatch(/<div data-fd-usual-add-tiles hidden>/);
        expect(typePanel(type)).toMatch(
            /data-fd-usual-add-tab="search"[^>]*><span[^>]*>Back/,
        );
    });

    test("Weeks between sits in its own wrapper the script shows only for Every N weeks, and is still a field of the form", () => {
        const html = renderKitchenUsualsBody(
            baseView({ openFoodId: "eggs" }) as never,
        );
        const restock = html.slice(html.indexOf('id="fd-usual-eggs-restock"'));
        const wrapper = restock.indexOf("<div data-fd-restock-weeks>");
        expect(wrapper).toBeGreaterThan(-1);
        expect(restock.indexOf('name="restock_every_weeks"')).toBeGreaterThan(
            wrapper,
        );
        const script = readFileSync("./src/web/client/v2/kitchen.js", "utf8");
        expect(script).toContain('chosen?.value !== "every_n_weeks"');
    });

    test("picker rows read brand · purchase, the chosen product first", () => {
        const row = baseRow();
        const other = food({
            id: "horizon",
            name: "Horizon Eggs",
            genericFoodId: "eggs",
            brand: "Horizon",
            usualAmount: { amount: 12, unit: "each" },
        });
        row.products = [other, ...row.products];
        const html = renderKitchenUsualsBody(
            baseView({ rows: [row], openFoodId: "eggs" }) as never,
        );
        const picker = html.slice(html.indexOf('id="fd-usual-eggs-product"'));
        const kirkland = picker.indexOf("Kirkland Large Eggs");
        const horizon = picker.indexOf("Horizon Eggs");
        expect(kirkland).toBeGreaterThan(-1);
        expect(kirkland).toBeLessThan(horizon);
        expect(picker).toMatch(/Kirkland · 24/);
        expect(picker).toMatch(/Horizon · 12/);
    });
});
