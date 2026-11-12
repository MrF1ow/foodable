import { describe, expect, test } from "bun:test";
import {
    NO_USUAL_SCHEDULE,
    type Food,
    type UsualProductRow,
} from "../../../domain/foods.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
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
    usualSheetId,
    type KitchenUsualsRowMeta,
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
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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
