import { describe, expect, test } from "bun:test";
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
import {
    USUALS_EDIT_SUBTITLE,
    USUALS_INTRO,
    kitchenUsualProductLabel,
    kitchenUsualRowMeta,
    kitchenUsualRowParts,
    kitchenUsualsEmptyMessage,
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
    usualTableCells,
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
    attention: { count: 0, tabs: {} },
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

describe("kitchenUsualProductLabel", () => {
    test('shows "Any brand" when no usual is set', () => {
        const row = baseRow();
        row.usual = null;
        row.food = { ...row.food, usualProductId: null };
        expect(kitchenUsualProductLabel(row)).toBe("Any brand");
    });
});

describe("kitchenUsualRowParts", () => {
    test("includes on the list tone part", () => {
        const parts = kitchenUsualRowParts({
            productLabel: "X",
            storeId: "s",
            storeName: "Costco",
            amountLabel: "2",
            onList: true,
        });
        expect(parts).toContainEqual({
            text: "on the list",
            tone: "accent",
        });
    });
});

describe("kitchenUsualRowMeta", () => {
    test("reads store and amount from the usual product", () => {
        const row = baseRow();
        const meta = kitchenUsualRowMeta(row, {
            storesById: new Map([["st-costco", { name: "Costco" }]]),
            groceryLines: [{ foodId: "eggs", checked: false }],
            foodsById: new Map([
                ["eggs", { id: "eggs", genericFoodId: null }],
                ["kirkland", { id: "kirkland", genericFoodId: "eggs" }],
            ]),
        });
        expect(meta.storeName).toBe("Costco");
        expect(meta.amountLabel).toBe("24");
        expect(meta.onList).toBe(true);
        expect(meta.lowNow).toBe(false);
    });

    test("a usual with a running-low notice says low now, before on the list", () => {
        const row = baseRow();
        const meta = kitchenUsualRowMeta(row, {
            storesById: new Map([["st-costco", { name: "Costco" }]]),
            groceryLines: [],
            foodsById: new Map([["eggs", { id: "eggs", genericFoodId: null }]]),
            lowFoodIds: new Set([row.food.id]),
        });
        expect(meta.lowNow).toBe(true);
        expect(kitchenUsualRowParts(meta)).toContainEqual({
            text: "low now",
            tone: "warn",
        });
    });
});

describe("kitchenUsualsResolvedOpenFoodId", () => {
    test("returns undefined when the food is not listed", () => {
        expect(
            kitchenUsualsResolvedOpenFoodId({
                rows: baseView().rows as UsualProductRow[],
                openFoodId: "nope",
            }),
        ).toBeUndefined();
    });
});

describe("kitchenUsualsEmptyMessage", () => {
    test("names the store when the filter is empty but other usuals exist", () => {
        const msg = kitchenUsualsEmptyMessage({
            rows: baseView().rows as UsualProductRow[],
            stores: baseView().stores as never,
            selectedStoreId: "st-tj",
            filteredCount: 0,
        });
        expect(msg).toBe("No usuals at Trader Joe's");
    });
});

describe("renderKitchenUsualsV2Page", () => {
    test("renders Kitchen chrome: tabs, seg, groceries count, Usuals selected", () => {
        const html = renderKitchenUsualsV2Page(baseView() as never);
        expect(html).toContain("fd-kitchen-tabs");
        expect(html).toContain("fd-kitchen-overview-seg");
        expect(html).toContain("Groceries · 8");
        expect(html).toContain('href="/kitchen/usuals"');
        expect(html).not.toMatch(
            /fd-sidelink fd-sidelink-settings[^>]*aria-current/,
        );
        expect(html).toMatch(
            /fd-sidesub[^>]*href="\/kitchen\/usuals"[^>]*aria-current="page"/,
        );
        const kitchenTab = html.match(
            /<nav class="fd-kitchen-tabs"[\s\S]*?<\/nav>/,
        )?.[0];
        expect(kitchenTab).toContain('href="/kitchen/usuals"');
        expect(kitchenTab).toMatch(/aria-current="page"[^>]*>Usuals/);
    });

    test("select mode: every usual has a checkbox, with a confirmed Remove", () => {
        const body = renderKitchenUsualsBody(baseView() as never);
        expect(body).toContain(
            'class="fd-kitchen-usuals-page" data-fd-select="usuals"',
        );
        expect(body).toContain('data-fd-select-toggle="usuals"');
        expect(body).toMatch(
            /<input type="checkbox" class="fd-row__select-input" data-fd-select-item name="ids\[\]" value="[^"]+" aria-label="Select [^"]+">/,
        );
        expect(body).toContain('action="/kitchen/usuals/bulk/remove"');
        expect(body).toContain('data-one="Remove 1 usual from the list?"');
        expect(body).toContain('data-many="Remove {n} usuals from the list?"');
    });

    test("select mode: an empty list has no Select", () => {
        const body = renderKitchenUsualsBody(
            baseView({ rows: [], rowMeta: new Map() }) as never,
        );
        expect(body).not.toContain("data-fd-select-toggle");
    });

    test("renders intro, add control, and escaping in names", () => {
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
                [
                    'egg"x',
                    {
                        productLabel: `<b>bad</b>`,
                        storeId: null,
                        storeName: null,
                        amountLabel: null,
                        onList: false,
                    },
                ],
            ]),
        });
        const html = renderKitchenUsualsBody(nasty as never);
        expect(html).toContain(USUALS_INTRO);
        expect(html).toContain("Add a usual");
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
        expect(html).toContain('id="fd-usual-row-egg&quot;x"');
        expect(html).not.toContain("fd-row__body--link");
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
                    [
                        payload,
                        {
                            productLabel: payload,
                            storeId: null,
                            storeName: null,
                            amountLabel: null,
                            onList: false,
                        },
                    ],
                ]),
            });
            const html = renderKitchenUsualsBody(view as never);
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(html, "li[data-fd-usual-row]", "id"),
            ).toEqual([`fd-usual-row-${payload}`]);
        }
    });

    test("opens the edit sheet when openFoodId matches a row", () => {
        const body = renderKitchenUsualsBody(
            baseView({ openFoodId: "eggs", error: "Bad unit" }) as never,
        );
        expect(body).toContain(`id="${usualSheetId("eggs")}"`);
        expect(body).toContain("data-sheet-open-on-load");
        expect(body).toContain("Bad unit");
        expect(body).toContain(USUALS_EDIT_SUBTITLE);
        expect(body).toContain("Any store");
        expect(body).not.toMatch(/type="radio"[^>]*name="usual_unit"/);
        expect(body).toContain('type="hidden" name="usual_unit"');
        expect(body).toContain('name="usual_amount"');
        expect(body).toContain('name="usual_store_id"');
        expect(body).toContain('commandfor="fd-usual-eggs-product"');
        expect(body).toContain('form="fd-usual-eggs-form"');
        // The amount can be left unset.
        expect(body).toContain(">No amount</option>");
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

    test("shows Any brand in the row meta when cleared", () => {
        const row = baseRow();
        row.usual = null;
        row.food = { ...row.food, usualProductId: null };
        const meta = new Map([
            [
                row.food.id,
                {
                    productLabel: "Any brand",
                    storeId: null,
                    storeName: null,
                    amountLabel: null,
                    onList: false,
                },
            ],
        ]);
        const html = renderKitchenUsualsBody(
            baseView({ rows: [row], rowMeta: meta }) as never,
        );
        expect(html).toContain("Any brand");
    });
});

function scheduled(
    over: Partial<Food>,
    amount: { amount: number; unit: string } | null = {
        amount: 24,
        unit: "each",
    },
): UsualProductRow {
    const row = baseRow();
    row.usual = { ...row.usual!, usualAmount: amount };
    row.food = { ...row.food, ...over };
    return row;
}

function partTexts(view: UsualRestockView): string[] {
    return usualRestockParts(view).map((part) =>
        typeof part === "object" ? String(part.text) : String(part),
    );
}

describe("usual restock row meta", () => {
    test("no schedule and not when-low shows nothing", () => {
        expect(usualRestockParts(usualRestockView(baseRow()))).toEqual([]);
    });

    test("each schedule reads as the design words it", () => {
        const label = (over: Partial<Food>) =>
            usualScheduleLabel(usualRestockView(scheduled(over)));
        expect(label({ restockSchedule: "weekly" })).toBe("Every week");
        expect(
            label({ restockSchedule: "every_n_weeks", restockEveryWeeks: 2 }),
        ).toBe("Every 2 weeks");
        expect(
            label({ restockSchedule: "every_n_weeks", restockEveryWeeks: 1 }),
        ).toBe("Every week");
        expect(label({ restockSchedule: "monthly" })).toBe("Every month");
        expect(label({})).toBeNull();
    });

    test("a schedule alone names no level; when-low adds 'below N' (default a quarter)", () => {
        expect(
            partTexts(
                usualRestockView(scheduled({ restockSchedule: "weekly" })),
            ),
        ).toEqual(["Every week"]);
        expect(
            partTexts(
                usualRestockView(
                    scheduled({
                        restockSchedule: "weekly",
                        restockWhenLow: true,
                    }),
                ),
            ),
        ).toEqual(["Every week", "below 6"]);
    });

    test("when-low without a schedule reads 'When low · below N' with the stored level", () => {
        expect(
            partTexts(
                usualRestockView(
                    scheduled({ restockWhenLow: true, restockLowLevel: 2 }),
                ),
            ),
        ).toEqual(["When low", "below 2"]);
    });

    test("when-low with no usual amount and no level names no 'below'", () => {
        expect(
            partTexts(
                usualRestockView(scheduled({ restockWhenLow: true }, null)),
            ),
        ).toEqual(["When low"]);
    });

    test("paused wins and is muted; paused with nothing to pause shows nothing", () => {
        const parts = usualRestockParts(
            usualRestockView(
                scheduled({ restockSchedule: "monthly", restockPaused: true }),
            ),
        );
        expect(parts).toEqual([{ text: "Paused", tone: "muted" }]);
        expect(
            usualRestockParts(
                usualRestockView(scheduled({ restockPaused: true })),
            ),
        ).toEqual([]);
    });

    test("the row carries the parts after store and amount, before 'on the list'", () => {
        const row = scheduled({ restockSchedule: "weekly" });
        const meta = kitchenUsualRowMeta(row, {
            storesById: new Map([["st-costco", { name: "Costco" }]]),
            groceryLines: [{ foodId: "eggs", checked: false }],
            foodsById: new Map([
                ["eggs", { id: "eggs", genericFoodId: null }],
                ["kirkland", { id: "kirkland", genericFoodId: "eggs" }],
            ]),
        });
        expect(
            kitchenUsualRowParts(meta).map((part) =>
                typeof part === "object" ? String(part.text) : String(part),
            ),
        ).toEqual(["Costco", "24", "Every week", "on the list"]);
    });
});

describe("formatLowLevel", () => {
    test("whole numbers, fractions and decimals", () => {
        expect(formatLowLevel(6)).toBe("6");
        expect(formatLowLevel(0.25)).toBe("¼");
        expect(formatLowLevel(0.5)).toBe("½");
        expect(formatLowLevel(1.75)).toBe("1¾");
        expect(formatLowLevel(2.333)).toBe("2.33");
        expect(formatLowLevel(0)).toBe("0");
    });
});

describe("header subtitle", () => {
    test("names the restock day only when given", () => {
        expect(kitchenUsualsHeaderSubtitle(7)).toBe("7 usuals");
        expect(kitchenUsualsHeaderSubtitle(1, "Sundays")).toBe(
            "1 usual · restock on Sundays",
        );
        expect(restockWeekdayLabel(0)).toBe("Sundays");
        expect(restockWeekdayLabel(6)).toBe("Saturdays");
        expect(restockWeekdayLabel(9)).toBeNull();
    });
});

describe("page header", () => {
    test("is the same as on Fridge and Groceries", () => {
        expect(renderKitchenUsualsBody(baseView())).toMatch(
            /^<h1 class="fd-kitchen-fridge-title fd-kitchen-fridge-title--phone">Kitchen<span class="fd-kitchen-fridge-count">[^<]+<\/span><\/h1>\n<header class="fd-kitchen-overview-head">\n<div class="fd-kitchen-overview-head__title">\n<h1 class="fd-kitchen-fridge-title">Kitchen<span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--phone">[^<]+<\/span><span class="fd-kitchen-fridge-count fd-kitchen-fridge-count--desktop">[^<]+<\/span><\/h1>\n<\/div>\n<div class="fd-kitchen-overview-head__tools">\n<nav class="fd-seg fd-kitchen-overview-seg" aria-label="Kitchen sections">/,
        );
    });
});

describe("edit-usual sheet restock controls", () => {
    function bodyFor(over: Partial<Food>, extra: Record<string, unknown> = {}) {
        const row = scheduled(over);
        const view = baseView({
            rows: [row],
            rowMeta: new Map([
                [
                    row.food.id,
                    {
                        productLabel: "x",
                        storeId: null,
                        storeName: null,
                        amountLabel: null,
                        onList: false,
                    },
                ],
            ]),
            ...extra,
        });
        return renderKitchenUsualsBody(view as never);
    }

    test("the Restock row shows the schedule and the switch is a field of the edit form", () => {
        const html = bodyFor({
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 4,
        });
        expect(html).toContain(
            `commandfor="${usualRestockSheetId("eggs")}" command="show-modal"`,
        );
        expect(html).toContain("Every 4 weeks");
        expect(html).toContain("Add when it runs low");
        expect(html).toContain(`action="/kitchen/usuals/eggs/schedule"`);
        const editForm = `fd-usual-eggs-form`;
        // The checkbox belongs to the edit sheet's own form, next to its marker.
        expect(html).toMatch(
            new RegExp(
                `role="switch" form="${editForm}" name="restock_when_low" value="1"(?! checked)`,
            ),
        );
        expect(html).toMatch(
            new RegExp(
                `<form id="${editForm}"[^>]*>\\s*<input type="hidden" name="return_to"[^>]*/>\\s*<input type="hidden" name="restock_when_low_present" value="1" />`,
            ),
        );
        expect(html).not.toContain('name="scope" value="when_low"');
        const on = bodyFor({ restockWhenLow: true });
        expect(on).toMatch(
            new RegExp(
                `form="${editForm}" name="restock_when_low" value="1" checked`,
            ),
        );
        expect(on).toContain("No schedule");
    });

    test("the Restock sheet says what Paused does", () => {
        expect(bodyFor({})).toContain(
            "Paused: not added on schedule or when it runs low.",
        );
    });

    test("the Restock sheet has the picker, the weeks stepper, paused and the level", () => {
        const html = bodyFor({
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 3,
            restockPaused: true,
            restockLowLevel: 5,
        });
        expect(html).toContain(`id="${usualRestockSheetId("eggs")}"`);
        for (const value of ["", "weekly", "every_n_weeks", "monthly"]) {
            expect(html).toContain(`name="restock_schedule" value="${value}"`);
        }
        expect(html).toMatch(
            /name="restock_schedule" value="every_n_weeks" checked/,
        );
        expect(html).toMatch(/name="restock_every_weeks"[^>]*value="3"/);
        expect(html).toMatch(/name="restock_paused" value="1" checked/);
        expect(html).toMatch(/name="restock_low_level"[^>]*value="5"/);
    });

    test("an unset level shows the default quarter as the placeholder", () => {
        const html = bodyFor({});
        expect(html).toMatch(
            /name="restock_low_level"[^>]*value=""[^>]*placeholder="6"/,
        );
        expect(html).toContain("count");
    });

    test("openRestock reopens the Restock sheet and puts the error in it", () => {
        const open = bodyFor(
            {},
            {
                openFoodId: "eggs",
                error: "Enter a whole number of weeks.",
                openRestock: true,
            },
        );
        expect(open).toMatch(
            new RegExp(
                `id="${usualRestockSheetId("eggs")}"[^>]*data-sheet-open-on-load`,
            ),
        );
        const restockStart = open.indexOf(
            `id="${usualRestockSheetId("eggs")}"`,
        );
        expect(open.indexOf("Enter a whole number")).toBeGreaterThan(
            restockStart,
        );
        const mainOnly = bodyFor({}, { openFoodId: "eggs", error: "Boom." });
        expect(mainOnly).not.toMatch(
            new RegExp(
                `id="${usualRestockSheetId("eggs")}"[^>]*data-sheet-open-on-load`,
            ),
        );
    });
});

describe("usualTableCells", () => {
    const meta: KitchenUsualsRowMeta = {
        productLabel: "Vital Farms large",
        storeId: "s",
        storeName: "Costco",
        amountLabel: "24",
        onList: false,
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
    };

    test("the desktop row has product, store, amount and restock cells", () => {
        const html = usualTableCells({ ...meta, lowNow: false });
        expect(html).toContain(
            '<span class="fd-usual-cell fd-usual-cell--product">Vital Farms large</span>',
        );
        expect(html).toContain(
            '<span class="fd-usual-cell fd-usual-cell--store">Costco</span>',
        );
        expect(html).toContain(
            '<span class="fd-usual-cell fd-usual-cell--amount">24</span>',
        );
        expect(html).toContain("<span>Every week</span>");
    });

    test("low now tones the whole restock cell, as the frame does", () => {
        expect(usualTableCells(meta)).toContain(
            '<span class="fd-usual-cell fd-usual-cell--restock fd-tone fd-tone--warn">Every week · low now</span>',
        );
    });

    test("any brand reads muted", () => {
        expect(
            usualTableCells({ ...meta, productLabel: "Any brand" }),
        ).toContain("fd-usual-cell--muted");
    });
});
