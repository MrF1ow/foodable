import { describe, expect, test } from "bun:test";
import type { CookPreview } from "../../../domain/stock.js";
import {
    COOK_SHEET_ID,
    cookPreviewChanges,
    parseExpectedCook,
    renderCookPreviewRegion,
    renderCookSheet,
    serializeExpectedCook,
    type CookSheetView,
} from "./recipes-page-cook.js";

const MACROS = {
    calories: 640,
    protein_g: 48,
    carbs_g: 62,
    fat_g: 22,
    fiber_g: null,
    sugar_g: null,
    alcohol_g: null,
    incomplete: false,
};

function preview(over: Partial<CookPreview> = {}): CookPreview {
    return {
        totalPortions: 2,
        lines: [
            {
                foodId: "f-salmon",
                displayName: "Salmon",
                fromItemId: "i-salmon",
                unit: "lb",
                before: 1,
                after: 0,
            },
            {
                foodId: "f-rice",
                displayName: "Jasmine rice",
                fromItemId: "i-rice",
                unit: "lb",
                before: 2,
                after: 1.6,
            },
            {
                foodId: "f-lemon",
                displayName: "Lemon",
                fromItemId: "i-lemon",
                unit: "each",
                before: 3,
                after: 2,
            },
        ],
        movements: [],
        shortfalls: [],
        unmeasured: [],
        ...over,
    };
}

function view(over: Partial<CookSheetView> = {}): CookSheetView {
    return {
        recipeId: "r1",
        recipeName: "Salmon, rice & spinach",
        servings: 2,
        yieldPortions: 2,
        preview: preview(),
        slot: "dinner",
        macrosPerPortion: MACROS,
        submitKey: "key-1",
        ...over,
    };
}

describe("renderCookPreviewRegion", () => {
    test("lists each fridge item as before → after, zero without a unit", () => {
        const html = renderCookPreviewRegion(preview());
        expect(html).toContain("Takes from your kitchen");
        expect(html).toContain("Salmon");
        expect(html).toContain("1 lb → 0<");
        expect(html).toContain("2 lb → 1.6 lb<");
        expect(html).toContain("3 → 2<");
        expect(html).toContain("data-fd-cook-region");
    });

    test("a shortfall is named in the warning style", () => {
        const html = renderCookPreviewRegion(
            preview({
                shortfalls: [
                    {
                        foodId: "f-spinach",
                        displayName: "Baby spinach",
                        amount: 100,
                        unit: "g",
                        unknownFactor: false,
                    },
                    {
                        foodId: "f-garlic",
                        displayName: "Garlic",
                        amount: 2,
                        unit: "each",
                        unknownFactor: true,
                    },
                ],
            }),
        );
        expect(html).toContain("fd-recipe-cook-use--short");
        expect(html).toContain("Baby spinach");
        expect(html).toContain("short 100 g");
        expect(html).toContain("may be short 2");
    });

    test("unmeasured ingredients are noted, not silently dropped", () => {
        const html = renderCookPreviewRegion(
            preview({
                unmeasured: [
                    { foodId: "f-salt", displayName: "Salt" },
                    { foodId: null, displayName: "Pepper" },
                ],
            }),
        );
        expect(html).toContain("Salt, Pepper");
        expect(html).toContain("no amount");
    });

    test("says so when nothing leaves the kitchen", () => {
        const html = renderCookPreviewRegion(preview({ lines: [] }));
        expect(html).toContain("Nothing in your kitchen to take");
    });

    test("escapes names", () => {
        const html = renderCookPreviewRegion(
            preview({
                lines: [
                    {
                        foodId: "f",
                        displayName: "<b>Bad</b>",
                        fromItemId: "i",
                        unit: "g",
                        before: 5,
                        after: 0,
                    },
                ],
            }),
        );
        expect(html).not.toContain("<b>Bad</b>");
        expect(html).toContain("&lt;b&gt;Bad&lt;/b&gt;");
    });

    test("carries the preview as the expected state the confirm compares", () => {
        const p = preview();
        const html = renderCookPreviewRegion(p);
        expect(html).toContain('name="expected"');
        const raw = /name="expected" value="([^"]*)"/.exec(html)?.[1] ?? "";
        const text = raw.replaceAll("&quot;", '"');
        expect(parseExpectedCook(text)).toEqual(
            parseExpectedCook(serializeExpectedCook(p)),
        );
    });
});

describe("renderCookSheet", () => {
    test("is a dialog with servings, the preview, the log switch and a Cook button", () => {
        const html = renderCookSheet(view());
        expect(html).toContain(`id="${COOK_SHEET_ID}"`);
        expect(html).toContain('action="/recipes/r1/cook/confirm"');
        expect(html).toContain('name="servings"');
        expect(html).toContain('value="2"');
        expect(html).toContain("servings");
        expect(html).toContain("Takes from your kitchen");
        expect(html).toContain("Log 1 serving to dinner");
        expect(html).toContain("640 kcal · P 48 C 62 F 22");
        expect(html).toContain('name="log_serving"');
        expect(html).toContain('role="switch"');
        expect(html).toContain('name="meal_type" value="dinner"');
        expect(html).toContain('name="submit_key" value="key-1"');
        expect(html).toContain(">Cook</button>");
        expect(html).toContain("data-fd-cook-form");
    });

    test("focus parks on the panel, not on the stepper's number", () => {
        expect(renderCookSheet(view())).toContain(
            `id="${COOK_SHEET_ID}" data-fd-sheet-focus="panel"`,
        );
    });

    test("the log switch starts on", () => {
        const html = renderCookSheet(view());
        expect(/name="log_serving"[^>]*checked/.test(html)).toBe(true);
    });

    test("opens on load with its error after a failed confirm", () => {
        const html = renderCookSheet(
            view({ open: true, error: "Unknown food." }),
        );
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain("Unknown food.");
        expect(html).toContain('role="alert"');
    });

    test("a preview that could not be built says so and still lets you cook", () => {
        const html = renderCookSheet(
            view({ preview: null, previewError: "Unknown food." }),
        );
        expect(html).toContain("Unknown food.");
        expect(html).toContain(">Cook</button>");
    });

    test("no subline when the recipe has no macros", () => {
        const html = renderCookSheet(
            view({
                macrosPerPortion: {
                    ...MACROS,
                    calories: null,
                    protein_g: null,
                    carbs_g: null,
                    fat_g: null,
                    incomplete: true,
                },
            }),
        );
        expect(html).toContain("Log 1 serving to dinner");
        expect(html).not.toContain("kcal ·");
    });
});

describe("cookPreviewChanges", () => {
    test("is empty when the stock is what the preview showed", () => {
        const p = preview();
        const expected = parseExpectedCook(serializeExpectedCook(p));
        expect(cookPreviewChanges(expected, p)).toEqual([]);
    });

    test("names an item whose amounts moved", () => {
        const expected = parseExpectedCook(serializeExpectedCook(preview()));
        const now = preview({
            lines: preview().lines.map((line) =>
                line.fromItemId === "i-rice"
                    ? { ...line, before: 1.5, after: 1.1 }
                    : line,
            ),
        });
        expect(cookPreviewChanges(expected, now)).toEqual(["Jasmine rice"]);
    });

    test("names an item that appeared, vanished or became short", () => {
        const expected = parseExpectedCook(serializeExpectedCook(preview()));
        const now = preview({
            lines: preview().lines.filter((l) => l.fromItemId !== "i-lemon"),
            shortfalls: [
                {
                    foodId: "f-lemon",
                    displayName: "Lemon",
                    amount: 1,
                    unit: "each",
                    unknownFactor: false,
                },
            ],
        });
        expect(cookPreviewChanges(expected, now).sort()).toEqual(["Lemon"]);
    });

    test("ignores sub-tenth rounding noise", () => {
        const expected = parseExpectedCook(serializeExpectedCook(preview()));
        const now = preview({
            lines: preview().lines.map((line) => ({
                ...line,
                after: line.after + 0.01,
            })),
        });
        expect(cookPreviewChanges(expected, now)).toEqual([]);
    });

    test("a preview for other servings than are cooked is not compared", () => {
        const expected = parseExpectedCook(
            serializeExpectedCook(preview({ totalPortions: 2 })),
        );
        const now = preview({
            totalPortions: 4,
            lines: preview().lines.map((l) => ({ ...l, after: 0 })),
        });
        expect(cookPreviewChanges(expected, now)).toEqual([]);
    });

    test("no expected state means nothing to compare", () => {
        expect(cookPreviewChanges(null, preview())).toEqual([]);
        expect(parseExpectedCook("not json")).toBeNull();
        expect(parseExpectedCook('{"v":2,"l":"x","s":[]}')).toBeNull();
        expect(parseExpectedCook('{"l":[],"s":[]}')).toBeNull();
        expect(parseExpectedCook("")).toBeNull();
    });
});
