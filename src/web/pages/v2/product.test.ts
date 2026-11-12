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
    servingHeading,
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
        ...(over.serving ? { serving: over.serving } : {}),
        ...(over.nutritionBasis ? { nutritionBasis: over.nutritionBasis } : {}),
    });
}

/**
 * The text content of each top-level `<span>` in the nth element carrying
 * `cls`, with nested tags stripped (what a screen reader reads).
 */
function spans(html: string, cls: string, nth = 0): string[] {
    const found = [
        ...html.matchAll(
            new RegExp(`class="${cls}[^"]*"[^>]*>([\\s\\S]*?)</div>`, "g"),
        ),
    ];
    const inner = found[nth]?.[1] ?? "";
    const cells: string[] = [];
    let depth = 0;
    let cur = "";
    for (const tok of inner.split(/(<\/?span[^>]*>)/)) {
        if (tok.startsWith("</span")) {
            depth -= 1;
            if (depth === 0) {
                cells.push(cur);
                cur = "";
            }
        } else if (tok.startsWith("<span")) {
            depth += 1;
        } else if (depth > 0) {
            cur += tok.replace(/<[^>]+>/g, "");
        }
    }
    return cells;
}

const HALF_AND_HALF = {
    name: "Half & Half",
    brand: "Member's Mark",
    calories: 133.3,
    proteinG: 3.3,
    carbsG: 4.7,
    fatG: 10,
    serving: { label: "1 portion (30 ml)", amount: 30, unit: "ml" as const },
    nutritionBasis: "100ml" as const,
};

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

describe("nutrition heads lead with the pack serving", () => {
    test("100 ml product with a ml serving: serving first, then per 100 ml", () => {
        const html = renderProductBody(
            buildPreviewProductPageView(chrome, food(HALF_AND_HALF)),
        );
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per portion · 30 ml",
            "Per 100 ml",
        ]);
        expect(spans(html, "fd-product-nutrition__row")).toEqual([
            "Calories",
            "40",
            "133",
        ]);
        expect(html).not.toContain("fd-product-nutrition__serving");
        expect(html).not.toContain("Per 100 g");
    });

    test("100 g product with a g serving scales the values", () => {
        const f = food({
            name: "Cookies",
            calories: 480,
            proteinG: 6,
            serving: { label: "2 cookies (30 g)", amount: 30, unit: "g" },
            nutritionBasis: "100g",
        });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per 2 cookies · 30 g",
            "Per 100 g",
        ]);
        expect(spans(html, "fd-product-nutrition__row")).toEqual([
            "Calories",
            "144",
            "480",
        ]);
        expect(spans(html, "fd-product-nutrition__row", 1)).toEqual([
            "Protein",
            "1.8",
            "6",
        ]);
    });

    test("a g serving on a per-100 ml product is not scaled (no density guess)", () => {
        const f = food({
            name: "Juice",
            calories: 45,
            serving: { label: "250 g", amount: 250, unit: "g" },
            nutritionBasis: "100ml",
        });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(html).toContain("fd-product-nutrition__head--one");
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per 100 ml",
        ]);
        expect(html).not.toContain("Per serving");
        expect(html).not.toContain("Per 250");
    });

    test("per-100 ml values are not scaled by gramsPerEach either", () => {
        const f = food({
            name: "Drink",
            calories: 45,
            gramsPerEach: 330,
            nutritionBasis: "100ml",
        });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per 100 ml",
        ]);
    });

    test("per-100 ml values scale by a usual amount in ml, with no density", () => {
        const f = food({
            name: "Milk",
            calories: 60,
            usualAmount: { amount: 250, unit: "ml" },
            nutritionBasis: "100ml",
        });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per serving",
            "Per 100 ml",
        ]);
        expect(spans(html, "fd-product-nutrition__row")).toEqual([
            "Calories",
            "150",
            "60",
        ]);
    });

    test("per-100 ml values are not scaled by a usual amount in grams or each", () => {
        for (const usualAmount of [
            { amount: 250, unit: "g" },
            { amount: 2, unit: "each" },
        ] as const) {
            const f = food({
                name: "Milk",
                calories: 60,
                usualAmount,
                gramsPerMl: 1,
                nutritionBasis: "100ml",
            });
            const html = renderProductBody(
                buildPreviewProductPageView(chrome, f),
            );
            expect(spans(html, "fd-product-nutrition__head")).toEqual([
                "",
                "Per 100 ml",
            ]);
        }
    });

    test("no serving at all: one per 100 g column", () => {
        const f = food({ name: "Salt", calories: 0.5 });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per 100 g",
        ]);
    });

    test("a gramsPerEach food with no pack serving renders as before", () => {
        const f = food({ name: "Yogurt", calories: 59, gramsPerEach: 170 });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per serving",
            "Per 100 g",
        ]);
        expect(spans(html, "fd-product-nutrition__row")).toEqual([
            "Calories",
            "100",
            "59",
        ]);
        expect(html).toContain(
            '<p class="fd-product-nutrition__serving">170 g serving</p>',
        );
    });

    test("servingHeading names the serving from the pack label", () => {
        const h = (label: string, amount: number, unit: "g" | "ml") =>
            servingHeading({ label, amount, unit });
        expect(h("1 portion (30 ml)", 30, "ml")).toBe("Per portion · 30 ml");
        expect(h("2 cookies (30 g)", 30, "g")).toBe("Per 2 cookies · 30 g");
        expect(h("30 g", 30, "g")).toBe("Per serving · 30 g");
        expect(h("30ml", 30, "ml")).toBe("Per serving · 30 ml");
        expect(h("", 30, "g")).toBe("Per serving · 30 g");
        expect(h("(30 g)", 30, "g")).toBe("Per serving · 30 g");
        expect(h("1 serving (28.5 g)", 28.5, "g")).toBe("Per serving · 28.5 g");
    });

    test("servingHeading rounds the printed amount", () => {
        const h = (label: string, amount: number, unit: "g" | "ml") =>
            servingHeading({ label, amount, unit });
        expect(h("2 tbsp (1 fl oz)", 29.5735, "ml")).toBe(
            "Per 2 tbsp · 29.6 ml",
        );
        expect(h("1 cup (8 fl oz)", 236.588, "ml")).toBe("Per cup · 236.6 ml");
        expect(h("1 bar (40g)", 40.04, "g")).toBe("Per bar · 40 g");
    });

    test("servingHeading keeps the whole part of a mixed number", () => {
        const h = (label: string, amount: number) =>
            servingHeading({ label, amount, unit: "ml" });
        expect(h("1 1/2 cups (360 ml)", 360)).toBe("Per 1 1/2 cups · 360 ml");
        expect(h("1 ½ cups (360 ml)", 360)).toBe("Per 1 ½ cups · 360 ml");
        expect(h("1 2/3 cup (400 ml)", 400)).toBe("Per 1 2/3 cup · 400 ml");
        expect(h("1/2 cup (120 ml)", 120)).toBe("Per 1/2 cup · 120 ml");
    });

    test("servingHeading treats a bare unit word as no name and lowercases", () => {
        const h = (label: string, amount: number, unit: "g" | "ml") =>
            servingHeading({ label, amount, unit });
        expect(h("1 l", 1000, "ml")).toBe("Per serving · 1000 ml");
        expect(h("1 kg", 1000, "g")).toBe("Per serving · 1000 g");
        expect(h("1 fl oz", 30, "ml")).toBe("Per serving · 30 ml");
        expect(h("1 SERVING (30 G)", 30, "g")).toBe("Per serving · 30 g");
        expect(h("1 Portion (30 ml)", 30, "ml")).toBe("Per portion · 30 ml");
    });

    test("servingHeading cuts at '=' and reads a count form as a serving", () => {
        const h = (label: string, amount: number, unit: "g" | "ml") =>
            servingHeading({ label, amount, unit });
        expect(h("1 bottle = 500 ml", 500, "ml")).toBe("Per bottle · 500 ml");
        expect(h("1 x 25 g", 25, "g")).toBe("Per serving · 25 g");
        expect(h("2 x 15 g", 30, "g")).toBe("Per serving · 30 g");
    });

    test("servingHeading does not say 'Per' twice when the pack label starts with it", () => {
        const h = (label: string, amount: number, unit: "g" | "ml") =>
            servingHeading({ label, amount, unit });
        expect(h("Per serving (30g)", 30, "g")).toBe("Per serving · 30 g");
        expect(h("PER Portion (30 ml)", 30, "ml")).toBe("Per portion · 30 ml");
        expect(h("per 100g", 100, "g")).toBe("Per serving · 100 g");
        expect(h("Per cup (240 ml)", 240, "ml")).toBe("Per cup · 240 ml");
        expect(h("Personal pizza (100 g)", 100, "g")).toBe(
            "Per personal pizza · 100 g",
        );
    });

    test("the serving head is a name line and an amount line, read as one", () => {
        const html = renderProductBody(
            buildPreviewProductPageView(chrome, food(HALF_AND_HALF)),
        );
        expect(html).toContain(
            '<span class="fd-product-nutrition__head-name">Per portion</span>',
        );
        expect(html).toContain(
            '<span class="fd-product-nutrition__head-amount">30 ml</span>',
        );
        expect(spans(html, "fd-product-nutrition__head")[1]).toBe(
            "Per portion · 30 ml",
        );
    });

    test("a null-basis food with an ml serving has one per 100 g column", () => {
        const f = food({
            name: "Mystery",
            calories: 50,
            serving: { label: "1 cup (240 ml)", amount: 240, unit: "ml" },
        });
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(html).toContain("fd-product-nutrition__head--one");
        expect(spans(html, "fd-product-nutrition__head")).toEqual([
            "",
            "Per 100 g",
        ]);
        expect(spans(html, "fd-product-nutrition__row")).toEqual([
            "Calories",
            "50",
        ]);
    });

    test("subtitle carries no serving bit when the head names the pack serving", () => {
        const sub = (over: Parameters<typeof food>[0]) =>
            renderProductBody(
                buildPreviewProductPageView(chrome, food(over), {
                    barcodes: ["0193968379117"],
                }),
            ).match(/<p class="fd-product-subtitle">([^<]*)<\/p>/)?.[1];
        expect(
            sub({
                name: "Bar",
                brand: "Acme",
                calories: 400,
                gramsPerEach: 40,
                serving: { label: "1 bar (40g)", amount: 40, unit: "g" },
                nutritionBasis: "100g",
            }),
        ).not.toContain("serving");
        expect(
            sub({
                name: "Cookies",
                calories: 480,
                usualAmount: { amount: 15, unit: "g" },
                serving: { label: "2 cookies (30 g)", amount: 30, unit: "g" },
                nutritionBasis: "100g",
            }),
        ).not.toContain("15 g");
        expect(sub(HALF_AND_HALF)).toBe("Member's Mark · 0 193968 379117");
        // A derived serving keeps its subtitle.
        expect(
            sub({
                name: "Yogurt",
                brand: "Acme",
                calories: 59,
                gramsPerEach: 170,
            }),
        ).toContain("170 g serving");
    });

    test("head and table agree on whether there is a serving column", () => {
        const foods = [
            food(HALF_AND_HALF),
            food({ name: "Yogurt", calories: 59, gramsPerEach: 170 }),
            food({ name: "Salt", calories: 1 }),
            food({
                name: "Drink",
                calories: 45,
                gramsPerEach: 330,
                nutritionBasis: "100ml",
            }),
            food({
                name: "Mystery",
                calories: 50,
                serving: { label: "1 cup (240 ml)", amount: 240, unit: "ml" },
            }),
        ];
        for (const f of foods) {
            const html = renderProductBody(
                buildPreviewProductPageView(chrome, f),
            );
            const two = spans(html, "fd-product-nutrition__head").length === 3;
            const rowCells = spans(html, "fd-product-nutrition__row").length;
            expect(rowCells).toBe(two ? 3 : 2);
            expect(buildTable(f).calories.perServing != null).toBe(two);
        }
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

    test("log pick amount ignores the pack serving", () => {
        const half = food(HALF_AND_HALF);
        const pick = productLogPickPayload(half, undefined);
        expect(pick.amount).toBe(100);
        expect(pick.unit).toBe("g");
        expect(servingG(half)).toBeNull();
        const each = food({
            name: "Yogurt",
            calories: 59,
            gramsPerEach: 170,
            serving: { label: "1 cup (245 g)", amount: 245, unit: "g" },
            nutritionBasis: "100g",
        });
        expect(productLogPickPayload(each, undefined).amount).toBe(170);
        const usualMl = food({
            name: "Milk",
            calories: 42,
            gramsPerMl: 1.03,
            usualAmount: { amount: 200, unit: "ml" },
            serving: { label: "1 cup (240 ml)", amount: 240, unit: "ml" },
            nutritionBasis: "100ml",
        });
        expect(productLogPickPayload(usualMl, undefined).amount).toBe(206);
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
