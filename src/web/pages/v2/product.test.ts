import { describe, expect, test } from "bun:test";
import { newFood } from "../../../domain/foods.js";
import type { Food } from "../../../domain/foods.js";
import type { FridgeSnapshot } from "../../../domain/fridge.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { AppChromeBase } from "../../attention.js";
import {
    buildPreviewProductPageView,
    productLogPickPayload,
    productOnGroceryList,
    productStockForFood,
    renderProductBody,
    renderProductBarcodeInvalidPage,
    renderProductBarcodeUnknownPage,
    renderProductV2Page,
} from "./product.js";
import {
    productNutrition,
    servingGramsForFood as servingG,
} from "./product-nutrition.js";

const buildTable = (f: Food) => productNutrition(f).table;

const HH = "hh-1";
const chrome: AppChromeBase = {
    theme: "light",
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
 * The nutrition Table as a person reads it: one array per row, the label then
 * each cell's text (an unknown cell is "—"). The header row comes first.
 */
function nutritionTable(html: string): string[][] {
    const text = (cell: string) =>
        cell
            .replace(/<span class="fd-sr">[^<]*<\/span>/g, "")
            .replace(/<[^>]+>/g, "")
            // Whatever is left of a tag goes too: the cell is read as text.
            .replace(/[<>]/g, "")
            .trim();
    return [
        ...html.matchAll(
            /<div class="fd-table-row[^"]*" role="row">(.*?)<\/div>/g,
        ),
    ].map((row) =>
        row[1]!
            .split(/(?=<span class="fd-table-row__)/)
            .filter(Boolean)
            .map(text),
    );
}

const page = (
    f: Food,
    opts?: Parameters<typeof buildPreviewProductPageView>[2],
) => renderProductBody(buildPreviewProductPageView(chrome, f, opts));

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

describe("productNutrition per-serving and per-100 values", () => {
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
});

describe("the nutrition Table", () => {
    test("a liquid with a serving: '1 serving (30 ml)' over '100 ml', serving first", () => {
        const html = page(food(HALF_AND_HALF));
        expect(nutritionTable(html).slice(0, 2)).toEqual([
            ["", "1 serving (30 ml)", "100 ml"],
            ["Calories", "40", "133"],
        ]);
        expect(html).not.toContain("100 g");
        expect(html).not.toContain("Per 100");
    });

    test("an unknown figure is a dash with a spoken 'no data', never a zero", () => {
        const html = page(
            food({ name: "Mystery", calories: 120, gramsPerEach: 100 }),
        );
        const rows = nutritionTable(html);
        expect(rows[1]).toEqual(["Calories", "120", "120"]);
        expect(rows[2]).toEqual(["Protein", "—", "—"]);
        expect(html).toContain(">no data<");
        // A real zero stays a zero.
        const zero = nutritionTable(
            page(food({ name: "Water", calories: 0, fiberG: 0 })),
        );
        expect(zero[1]).toEqual(["Calories", "0"]);
        expect(zero[5]).toEqual(["Fiber", "0 g"]);
    });

    test("every macro row of the design is there, in order", () => {
        const rows = nutritionTable(page(food({ name: "Salt", calories: 1 })));
        expect(rows.map((row) => row[0])).toEqual([
            "",
            "Calories",
            "Protein",
            "Carbs",
            "Fat",
            "Fiber",
            "Sugar",
        ]);
    });

    test("100 g product with a g serving scales the values", () => {
        const f = food({
            name: "Cookies",
            calories: 480,
            proteinG: 6,
            serving: { label: "2 cookies (30 g)", amount: 30, unit: "g" },
            nutritionBasis: "100g",
        });
        const rows = nutritionTable(page(f));
        expect(rows[0]).toEqual(["", "2 cookies (30 g)", "100 g"]);
        expect(rows[1]).toEqual(["Calories", "144", "480"]);
        expect(rows[2]).toEqual(["Protein", "1.8 g", "6 g"]);
    });

    test("a g serving on a per-100 ml product is not scaled (no density guess)", () => {
        const f = food({
            name: "Juice",
            calories: 45,
            serving: { label: "250 g", amount: 250, unit: "g" },
            nutritionBasis: "100ml",
        });
        const rows = nutritionTable(page(f));
        expect(rows[0]).toEqual(["", "100 ml"]);
        expect(rows[1]).toEqual(["Calories", "45"]);
    });

    test("per-100 ml values are not scaled by gramsPerEach either", () => {
        const f = food({
            name: "Drink",
            calories: 45,
            gramsPerEach: 330,
            nutritionBasis: "100ml",
        });
        expect(nutritionTable(page(f))[0]).toEqual(["", "100 ml"]);
    });

    test("per-100 ml values scale by a usual amount in ml, with no density", () => {
        const f = food({
            name: "Milk",
            calories: 60,
            usualAmount: { amount: 250, unit: "ml" },
            nutritionBasis: "100ml",
        });
        const rows = nutritionTable(page(f));
        expect(rows[0]).toEqual(["", "1 serving (250 ml)", "100 ml"]);
        expect(rows[1]).toEqual(["Calories", "150", "60"]);
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
            expect(nutritionTable(page(f))[0]).toEqual(["", "100 ml"]);
        }
    });

    test("a per-100 g food served in ml names the ml in its heading, scaled by its density", () => {
        const f = food({
            name: "Soup",
            calories: 40,
            usualAmount: { amount: 250, unit: "ml" },
            gramsPerMl: 1.03,
        });
        const rows = nutritionTable(page(f));
        expect(rows[0]).toEqual(["", "1 serving (250 ml)", "100 g"]);
        expect(rows[1]).toEqual(["Calories", "103", "40"]);
    });

    test("no serving at all: one 100 g column", () => {
        const rows = nutritionTable(
            page(food({ name: "Salt", calories: 0.5 })),
        );
        expect(rows[0]).toEqual(["", "100 g"]);
        expect(rows[1]).toEqual(["Calories", "1"]);
    });

    test("a gramsPerEach food with no pack serving: a derived serving beside 100 g", () => {
        const f = food({ name: "Yogurt", calories: 59, gramsPerEach: 170 });
        const rows = nutritionTable(page(f));
        expect(rows[0]).toEqual(["", "1 serving (170 g)", "100 g"]);
        expect(rows[1]).toEqual(["Calories", "100", "59"]);
    });

    test("a null-basis food with an ml serving has one 100 g column", () => {
        const f = food({
            name: "Mystery",
            calories: 50,
            serving: { label: "1 cup (240 ml)", amount: 240, unit: "ml" },
        });
        const rows = nutritionTable(page(f));
        expect(rows[0]).toEqual(["", "100 g"]);
        expect(rows[1]).toEqual(["Calories", "50"]);
    });

    test("head and rows agree on how many columns there are", () => {
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
            const rows = nutritionTable(page(f));
            const two = rows[0]!.length === 3;
            for (const row of rows) expect(row.length).toBe(two ? 3 : 2);
            expect(buildTable(f).calories.perServing != null).toBe(two);
        }
    });

    test("the serving column is named for the pack's own unit, generic words read as serving", () => {
        const head = (label: string, amount: number, unit: "g" | "ml") =>
            nutritionTable(
                page(
                    food({
                        name: "Thing",
                        calories: 100,
                        serving: { label, amount, unit },
                        nutritionBasis: unit === "ml" ? "100ml" : "100g",
                    }),
                ),
            )[0]![1];
        expect(head("1 portion (30 ml)", 30, "ml")).toBe("1 serving (30 ml)");
        expect(head("Per serving (30g)", 30, "g")).toBe("1 serving (30 g)");
        expect(head("30 g", 30, "g")).toBe("1 serving (30 g)");
        expect(head("", 30, "g")).toBe("1 serving (30 g)");
        expect(head("1 cup (8 fl oz)", 236.588, "ml")).toBe("1 cup (236.6 ml)");
        expect(head("2 tbsp (1 fl oz)", 29.5735, "ml")).toBe(
            "2 tbsp (29.6 ml)",
        );
        expect(head("1 1/2 cups (360 ml)", 360, "ml")).toBe(
            "1 1/2 cups (360 ml)",
        );
        expect(head("1/2 cup (120 ml)", 120, "ml")).toBe("1/2 cup (120 ml)");
        expect(head("1 bottle = 500 ml", 500, "ml")).toBe("1 bottle (500 ml)");
        expect(head("Personal pizza (100 g)", 100, "g")).toBe(
            "1 personal pizza (100 g)",
        );
    });

    test("a food with no serving grams has no serving column to scale", () => {
        expect(servingG(food({ name: "Salt", calories: null }))).toBeNull();
    });

    test("subtitle carries no serving bit when the Table names the pack serving", () => {
        const sub = (over: Parameters<typeof food>[0]) =>
            page(food(over), { barcodes: ["0193968379117"] }).match(
                /<p class="fd-page-header__subtitle">([^<]*)<\/p>/,
            )?.[1];
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

    test("lists places in the household's own order, not by name", () => {
        const place = (id: string, name: string, sortOrder: number) => ({
            id,
            householdId: HH,
            name,
            sortOrder,
        });
        const item = (id: string, locationId: string) => ({
            id,
            householdId: HH,
            locationId,
            kind: "food" as const,
            displayName: "Yogurt",
            quantity: { amount: 1, unit: "each" },
            foodId: "f1",
            expiresOn: null,
            purchasedOn: null,
            openedOn: null,
        });
        const snapshot = {
            locations: [
                place("a", "Costco Shelf", 2),
                place("b", "Fridge", 0),
                place("c", "Freezer", 1),
            ],
            items: [item("i1", "a"), item("i2", "b"), item("i3", "c")],
        } as FridgeSnapshot;
        expect(
            productStockForFood(snapshot, "f1").map((l) => l.locationName),
        ).toEqual(["Fridge", "Freezer", "Costco Shelf"]);
    });
});

describe("renderProductV2Page", () => {
    const yogurt = () =>
        food({
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

    test("a Detail bar with Back and a ⋯, the title and caption, then the sections", () => {
        const f = yogurt();
        const html = renderProductV2Page(
            buildPreviewProductPageView(chrome, f, {
                barcodes: ["5201054017463"],
                stock: [{ locationName: "Fridge", quantityLabel: "2" }],
                backHref: "/kitchen/groceries",
            }),
        );
        expect(html).toContain("fd-detail-bar");
        expect(html).toMatch(
            /<a [^>]*aria-label="Back"[^>]*href="\/kitchen\/groceries"/,
        );
        expect(html).toContain(
            'aria-label="Actions for Greek yogurt, plain 2%"',
        );
        expect(html).toContain(
            '<h1 class="fd-page-header__title">Greek yogurt, plain 2%</h1>',
        );
        expect(html).toContain("Fage · 170 g serving · 5 201054 017463");
        expect(html).toContain("fd-page-layout--single");
        expect(html).not.toContain("fd-product-top");
        expect(html).not.toContain("fd-product-score");
    });

    test("the ⋯ edits the food where the saved foods live", () => {
        const html = renderProductBody(
            buildPreviewProductPageView(chrome, yogurt()),
        );
        expect(html).toContain(
            'href="/settings/saved?q=Greek%20yogurt%2C%20plain%202%25"',
        );
        expect(html).toContain(">Edit in Saved foods<");
    });

    test("stock is one linked row per place, the quantity beside the title", () => {
        const html = renderProductBody(
            buildPreviewProductPageView(chrome, yogurt(), {
                stock: [
                    { locationName: "Fridge", quantityLabel: "2" },
                    { locationName: "Freezer", quantityLabel: "1 box" },
                ],
            }),
        );
        expect(html).toContain('href="/kitchen/fridge"');
        expect(html).toContain(">In the fridge<");
        expect(html).toContain('<span class="fd-item-row__meta">2</span>');
        expect(html).toContain(">In the freezer<");
        expect(html).toContain(">1 box<");
        const none = renderProductBody(
            buildPreviewProductPageView(chrome, yogurt()),
        );
        expect(none).not.toContain("In the fridge");
    });

    test("actions: Add to groceries posts to the same route, Log it opens the log pick", () => {
        const f = yogurt();
        const html = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(html).toContain(
            `<form method="post" action="/foods/${f.id}/add-to-grocery">`,
        );
        expect(html).toMatch(
            /<button type="submit" class="fd-btn"[^>]*>(?:<span[^>]*>)?Add to groceries/,
        );
        expect(html).toMatch(
            /<button type="button" class="fd-btn fd-btn--primary" data-fd-btn data-fd-log-pick="[^"]+"[^>]*>(?:<span[^>]*>)?Log it/,
        );
    });

    test("Add to groceries becomes On your list once the food is on the list", () => {
        const f = food({ name: "Milk" });
        const off = renderProductBody(buildPreviewProductPageView(chrome, f));
        expect(off).toContain("Add to groceries");
        expect(off).toContain(`action="/foods/${f.id}/add-to-grocery"`);
        expect(off).not.toContain("On your list");
        const on = renderProductBody({
            ...buildPreviewProductPageView(chrome, f),
            onGroceryList: true,
        });
        expect(on).toContain("On your list");
        expect(on).not.toContain("Add to groceries");
        expect(on).not.toContain("/add-to-grocery");
        // The control opens the list; it is not a second way to add.
        expect(on).toMatch(/<a class="fd-btn"[^>]*href="\/kitchen\/groceries"/);
    });

    test("a refused add shows the reason in place", () => {
        const html = renderProductBody({
            ...buildPreviewProductPageView(chrome, yogurt()),
            error: "That is already on the list",
        });
        expect(html).toContain(
            '<p class="fd-product-error" role="alert">That is already on the list</p>',
        );
    });

    test("a food with nothing known says so under its empty Table", () => {
        const html = page(food({ name: "Spice blend" }));
        expect(html).toContain("No score yet");
        expect(html).toContain("Add nutrition to score it");
        expect(nutritionTable(html)[1]).toEqual(["Calories", "—"]);
        // Some figures known: the Table alone, no empty state.
        expect(page(food({ name: "Half", calories: 10 }))).not.toContain(
            "No score yet",
        );
    });

    test("no notice dot, attention strip, toast or success banner", () => {
        const html = renderProductBody(
            buildPreviewProductPageView(chrome, yogurt(), {
                stock: [{ locationName: "Fridge", quantityLabel: "2" }],
            }),
        );
        expect(html).not.toContain("fd-notice");
        expect(html).not.toContain("needs-attention");
        expect(html).not.toContain("toast");
    });

    test("log pick opens on one portion when the food has a pack serving", () => {
        const half = food(HALF_AND_HALF);
        const pick = productLogPickPayload(half, undefined);
        expect(pick.unit_hints).toEqual(["portion", "ml"]);
        expect(pick.unit).toBe("portion");
        expect(pick.amount).toBe(1);
        expect(pick.basis).toBe("100ml");
        expect(pick.serving).toEqual(half.serving);
        const yogurtFood = food({
            name: "Yogurt",
            calories: 59,
            gramsPerEach: 170,
            serving: { label: "1 cup (245 g)", amount: 245, unit: "g" },
            nutritionBasis: "100g",
        });
        const yogurtPick = productLogPickPayload(yogurtFood, undefined);
        expect(yogurtPick.unit_hints).toEqual(["portion", "g", "each"]);
        expect(yogurtPick.unit).toBe("portion");
        expect(yogurtPick.amount).toBe(1);
        expect(yogurtPick.basis).toBeUndefined();
        const milk = food({
            name: "Milk",
            calories: 42,
            nutritionBasis: "100ml",
        });
        const milkPick = productLogPickPayload(milk, undefined);
        expect(milkPick.unit).toBe("ml");
        expect(milkPick.amount).toBe(100);
        const eggs = food({ name: "Eggs", calories: 143 });
        const eggPick = productLogPickPayload(eggs, undefined);
        expect(eggPick.unit).toBe("g");
        expect(eggPick.amount).toBe(100);
        expect(eggPick.serving).toBeUndefined();
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
    const unknown = (over: { lookupFailed?: boolean; error?: string } = {}) =>
        renderProductBarcodeUnknownPage({
            chrome,
            barcode: "9999999999999",
            backHref: "/kitchen/fridge",
            ...over,
        });

    test("the Detail bar names it, the code and why sit in an empty state", () => {
        const html = unknown();
        expect(html).toContain(
            '<h1 class="fd-detail-bar__title">Unknown barcode</h1>',
        );
        expect(html).toContain("fd-detail-bar__balance");
        expect(html).toContain("9 999999 999999");
        expect(html).toContain("Not in Open Food Facts yet");
        expect(html).not.toContain("Open Food Facts does not know");
    });

    test("offers add-as-new form posting to by-barcode path", () => {
        const html = unknown();
        expect(html).toContain("Add as a new food");
        expect(html).toContain('action="/foods/by-barcode/9999999999999"');
        expect(html).toContain('name="name"');
        expect(html).toMatch(/<input[^>]*name="name"[^>]*required/);
        expect(html).toContain("fd-btn--primary");
    });

    test("lookup failure copy does not claim OFF is empty", () => {
        const html = unknown({ lookupFailed: true });
        expect(html).toContain("Could not look up this barcode");
        expect(html).not.toContain("Not in Open Food Facts yet");
    });

    test("a refused add shows the reason in place", () => {
        expect(unknown({ error: "Name is too long" })).toContain(
            '<p class="fd-product-error" role="alert">Name is too long</p>',
        );
    });
});

describe("renderProductBarcodeInvalidPage", () => {
    test("names the bad code and what a code looks like, with Back in the bar", () => {
        const html = renderProductBarcodeInvalidPage({
            chrome,
            barcode: "12ab",
            backHref: "/kitchen/fridge",
        });
        expect(html).toContain(
            '<h1 class="fd-detail-bar__title">Invalid barcode</h1>',
        );
        expect(html).toContain("12ab");
        expect(html).toContain("Enter 8–14 digits");
        expect(html).toContain('href="/kitchen/fridge"');
        expect(html).not.toContain("Add as a new food");
        expect(html).not.toContain('name="name"');
    });
});

describe("productOnGroceryList", () => {
    const line = (foodId: string | null, checked = false) => ({
        foodId,
        checked,
    });
    const eggs = {
        id: "eggs",
        genericFoodId: null,
        usualProductId: "egglands",
    };
    const egglands = {
        id: "egglands",
        genericFoodId: "eggs",
        usualProductId: null,
    };
    const kirkland = {
        id: "kirkland",
        genericFoodId: "eggs",
        usualProductId: null,
    };
    const catalog = [eggs, egglands, kirkland];

    test("a sibling product's line does not count", () => {
        expect(
            productOnGroceryList(kirkland, catalog, [line("egglands")]),
        ).toBe(false);
    });

    test("a line for the same product counts", () => {
        expect(
            productOnGroceryList(kirkland, catalog, [line("kirkland")]),
        ).toBe(true);
    });

    test("a plain food counts a line for itself or its usual product, not another product", () => {
        expect(productOnGroceryList(eggs, catalog, [line("eggs")])).toBe(true);
        expect(productOnGroceryList(eggs, catalog, [line("egglands")])).toBe(
            true,
        );
        expect(productOnGroceryList(eggs, catalog, [line("kirkland")])).toBe(
            false,
        );
    });

    test("the usual product counts a line for its plain food, another product does not", () => {
        expect(productOnGroceryList(egglands, catalog, [line("eggs")])).toBe(
            true,
        );
        expect(productOnGroceryList(kirkland, catalog, [line("eggs")])).toBe(
            false,
        );
    });

    test("ticked and food-less lines never count", () => {
        expect(
            productOnGroceryList(eggs, catalog, [
                line("eggs", true),
                line("egglands", true),
                line(null),
            ]),
        ).toBe(false);
    });
});

test("a fridge place reads as the household wrote it, plain places in lower case", async () => {
    const { stockPlaceTitle } = await import("./product.js");
    expect(stockPlaceTitle("Fridge")).toBe("In the fridge");
    expect(stockPlaceTitle("pantry")).toBe("In the pantry");
    expect(stockPlaceTitle("The cellar")).toBe("In the cellar");
    expect(stockPlaceTitle("Costco Shelf")).toBe("In the Costco Shelf");
});
