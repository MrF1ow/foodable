import { describe, expect, test } from "bun:test";
import { newFood } from "../../../domain/foods.js";
import type { Food } from "../../../domain/foods.js";
import type { FridgeSnapshot } from "../../../domain/fridge.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AppChromeBase } from "../../attention.js";
import {
    buildPreviewProductPageView,
    productLogPickPayload,
    productStockForFood,
    renderProductBody,
    renderProductBarcodeUnknownPage,
    renderProductV2Page,
} from "./product.js";
import {
    buildProductNutritionTable as buildTable,
    servingGramsForFood as servingG,
} from "./product-nutrition.js";

const HH = "hh-1";
const chrome: AppChromeBase = {
    theme: "light",
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

function food(over: Partial<Food> & Pick<Food, "name">): Food {
    return newFood({
        householdId: HH,
        kind: "food",
        name: over.name,
        brand: over.brand ?? null,
        calories: over.calories ?? null,
        proteinG: over.proteinG ?? null,
        carbsG: over.carbsG ?? null,
        fatG: over.fatG ?? null,
        fiberG: over.fiberG ?? null,
        sugarG: over.sugarG ?? null,
        gramsPerEach: over.gramsPerEach ?? null,
        gramsPerMl: over.gramsPerMl ?? null,
        usualAmount: over.usualAmount ?? null,
    });
}

describe("buildProductNutritionTable", () => {
    test("full data shows per 100 g and scaled per serving", () => {
        const f = food({
            name: "Yogurt",
            calories: 59,
            proteinG: 10,
            carbsG: 4,
            fatG: 0.4,
            fiberG: 0,
            sugarG: 4,
            gramsPerEach: 170,
        });
        const table = buildTable(f);
        expect(table.calories.per100g).toBe("59");
        expect(table.proteinG.per100g).toBe("10");
        expect(table.calories.perServing).toBe("100");
        expect(table.proteinG.perServing).toBe("17");
    });

    test("partial nutrition uses em dash for unknowns", () => {
        const f = food({
            name: "Mystery",
            calories: 120,
            proteinG: null,
            carbsG: null,
            fatG: null,
            fiberG: null,
            sugarG: null,
        });
        const table = buildTable(f);
        expect(table.calories.per100g).toBe("120");
        expect(table.proteinG.per100g).toBe("–");
        expect(table.proteinG.perServing).toBeNull();
    });

    test("no serving grams yields single column", () => {
        const f = food({ name: "Salt", calories: null });
        expect(servingG(f)).toBeNull();
        const view = buildPreviewProductPageView(chrome, f);
        const html = renderProductBody(view);
        expect(html).toContain("fd-product-nutrition__head--one");
        expect(html).not.toContain("Per serving");
    });

    test("nutrition header cells align with value columns", () => {
        const f = food({
            name: "Yogurt",
            calories: 59,
            proteinG: 10,
            gramsPerEach: 170,
        });
        const withServing = renderProductBody(
            buildPreviewProductPageView(chrome, f),
        );
        const headServing = (withServing.match(
            /fd-product-nutrition__head[^>]*>[\s\S]*?<\/div>/,
        ) ?? [""])[0];
        expect(headServing.match(/<span/g)?.length).toBe(3);
        const rowServing = (withServing.match(
            /fd-product-nutrition__row[^>]*>[\s\S]*?<\/div>/,
        ) ?? [""])[0];
        expect(rowServing.match(/<span/g)?.length).toBe(3);

        const partial = food({ name: "Salt", calories: 120 });
        const noServing = renderProductBody(
            buildPreviewProductPageView(chrome, partial),
        );
        const headOne = (noServing.match(
            /fd-product-nutrition__head[^>]*>[\s\S]*?<\/div>/,
        ) ?? [""])[0];
        expect(headOne.match(/<span/g)?.length).toBe(2);
    });
});

describe("productStockForFood", () => {
    test("aggregates fridge rows by location", () => {
        const snapshot: FridgeSnapshot = {
            locations: [
                {
                    id: "loc1",
                    householdId: HH,
                    name: "Fridge",
                    sortOrder: 0,
                },
            ],
            items: [
                {
                    id: "it1",
                    householdId: HH,
                    locationId: "loc1",
                    kind: "food",
                    displayName: "Yogurt",
                    quantity: { amount: 2, unit: "each" },
                    foodId: "f1",
                    expiresOn: null,
                    purchasedOn: null,
                    openedOn: null,
                },
            ],
        };
        const lines = productStockForFood(snapshot, "f1");
        expect(lines).toEqual([{ locationName: "Fridge", quantityLabel: "2" }]);
    });
});

describe("renderProductV2Page", () => {
    test("renders stock, nutrition, and actions without score when unscored", () => {
        const f = food({
            name: "Greek yogurt, plain 2%",
            brand: "Fage",
            calories: 59,
            proteinG: 10,
            carbsG: 4,
            fatG: 0.4,
            fiberG: 0,
            sugarG: 4,
            gramsPerEach: 170,
        });
        const view = buildPreviewProductPageView(chrome, f, {
            barcodes: ["5201054017463"],
            stock: [{ locationName: "Fridge", quantityLabel: "2" }],
        });
        const html = renderProductV2Page(view);
        expect(html).toContain("Greek yogurt, plain 2%");
        expect(html).toContain("Fage");
        expect(html).toContain("5 201054 017463");
        expect(html).toContain("fd-product-top");
        expect(html).toContain('href="/kitchen/groceries"');
        expect(html).toContain("fd-btn--primary");
        expect(html).toContain("In the kitchen");
        expect(html).not.toContain("fd-product-score");
        expect(html).toContain("Add to groceries");
        expect(html).toContain("data-fd-log-pick");
        expect(html).toContain(`/foods/${f.id}/add-to-grocery`);
    });

    test("log pick payload carries food id and per-100 g macros", () => {
        const f = food({
            name: "Eggs",
            calories: 143,
            proteinG: 13,
            gramsPerEach: 50,
        });
        const pick = productLogPickPayload(f, "1111111111111");
        expect(pick.food_id).toBe(f.id);
        expect(pick.kcal_per_100g).toBe(143);
        expect(pick.barcode).toBe("1111111111111");
    });
});

describe("renderProductBarcodeUnknownPage", () => {
    test("offers add-as-new form posting to by-barcode path", () => {
        const html = renderProductBarcodeUnknownPage({
            chrome,
            barcode: "9999999999999",
            backHref: "/kitchen/fridge",
        });
        expect(html).toContain("Add as a new food");
        expect(html).toContain('action="/foods/by-barcode/9999999999999"');
        expect(html).toContain('name="name"');
        expect(html).toContain("Open Food Facts does not know");
    });

    test("lookup failure copy does not claim OFF is empty", () => {
        const html = renderProductBarcodeUnknownPage({
            chrome,
            barcode: "8880001112222",
            backHref: "/kitchen/fridge",
            lookupFailed: true,
        });
        expect(html).toContain("Could not look up this barcode");
        expect(html).not.toContain("Open Food Facts does not know");
    });
});
