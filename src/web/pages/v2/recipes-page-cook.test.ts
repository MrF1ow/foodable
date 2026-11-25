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
        viewerName: "Ethan",
        places: new Map([
            ["i-salmon", "Fridge"],
            ["i-rice", "Pantry"],
        ]),
        submitKey: "key-1",
        ...over,
    };
}

/** The rows of a region, one string each. */
function rows(html: string): string[] {
    return html
        .split('<li class="fd-item-row')
        .slice(1)
        .map((row) => row.slice(0, row.indexOf("</li>")));
}

describe("renderCookPreviewRegion", () => {
    test("lists each ingredient the cook takes with the amount that leaves and where it is kept, ticked", () => {
        const html = renderCookPreviewRegion(
            preview(),
            undefined,
            new Map([
                ["i-salmon", "Fridge"],
                ["i-rice", "Pantry"],
            ]),
        );
        expect(html).toContain("Takes");
        expect(html).toContain("data-fd-cook-region");
        const [salmon, rice, lemon] = rows(html);
        expect(salmon).toContain(">Salmon<");
        expect(salmon).toContain(">1 lb<");
        expect(salmon).toContain(">Fridge<");
        expect(rice).toContain(">0.4 lb<");
        expect(rice).toContain(">Pantry<");
        // An item with no known place has no second line, and a unit-less amount is a count.
        expect(lemon).toContain(">1<");
        expect(lemon).not.toContain("fd-item-row__subtitle");
        // Ticked, and nothing to press: it is not a form field.
        for (const row of [salmon, rice, lemon]) {
            expect(row).toContain("fd-item-row__done");
            expect(row).not.toContain("<input");
        }
    });

    test("a shortfall keeps its box, greyed and unticked, with its words in the warning tone", () => {
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
        const spinach = rows(html).find((row) => row.includes("Baby spinach"))!;
        expect(spinach).toContain("fd-item-row--warning");
        expect(spinach).toContain("Short 100 g");
        const box = spinach.match(/<input[^>]*type="checkbox"[^>]*>/)![0];
        expect(box).toContain("disabled");
        expect(box).not.toContain("checked");
        const garlic = rows(html).find((row) => row.includes("Garlic"))!;
        expect(garlic).toContain("May be short 2");
        expect(garlic).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
    });

    test("a partly stocked ingredient is one Takes row: what it takes and how short it is", () => {
        const html = renderCookPreviewRegion(
            preview({
                shortfalls: [
                    {
                        foodId: "f-lemon",
                        displayName: "Lemon",
                        amount: 2,
                        unit: "each",
                        unknownFactor: false,
                    },
                ],
            }),
        );
        const lemons = rows(html).filter((row) => row.includes("Lemon"));
        expect(lemons).toHaveLength(1);
        expect(lemons[0]).toContain("fd-item-row--warning");
        expect(lemons[0]).toContain("Short 2");
        expect(lemons[0]).toContain('fd-item-row__meta">1</span>');
        const box = lemons[0]!.match(/<input[^>]*type="checkbox"[^>]*>/)![0];
        expect(box).toContain("disabled");
        expect(box).not.toContain("checked");
    });

    test("an ingredient with no amount is a greyed row, not silently dropped", () => {
        const html = renderCookPreviewRegion(
            preview({
                unmeasured: [
                    { foodId: "f-salt", displayName: "Salt" },
                    { foodId: null, displayName: "Pepper" },
                ],
            }),
        );
        for (const name of ["Salt", "Pepper"]) {
            const row = rows(html).find((r) => r.includes(`>${name}<`))!;
            expect(row).toContain("No amount, so nothing is taken");
            expect(row).toMatch(/<input[^>]*type="checkbox"[^>]*disabled/);
        }
    });

    test("says so when nothing leaves the kitchen", () => {
        const html = renderCookPreviewRegion(preview({ lines: [] }));
        expect(html).toContain("Nothing in your kitchen to take");
    });

    test("a preview that could not be built says why", () => {
        const html = renderCookPreviewRegion(null, "Unknown food.");
        expect(html).toContain("data-fd-cook-region");
        expect(html).toContain("Unknown food.");
        expect(html).not.toContain('name="expected"');
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
    test("is a dialog with servings, what it takes, who the portion is for and a Cook button", () => {
        const html = renderCookSheet(view());
        expect(html).toContain(`id="${COOK_SHEET_ID}"`);
        expect(html).toContain('action="/recipes/r1/cook/confirm"');
        expect(html).toContain("Cook Salmon, rice &amp; spinach");
        expect(html).toContain('name="servings"');
        expect(html).toContain('value="2"');
        expect(html).toContain("Servings");
        expect(html).toContain("Takes");
        expect(html).toContain("Log a portion for");
        expect(html).toContain('name="meal_type" value="dinner"');
        expect(html).toContain('name="submit_key" value="key-1"');
        expect(html).toContain('form="fd-recipe-cook-form"');
        expect(html).toContain(">Cook</span>");
        expect(html).toContain("data-fd-cook-form");
    });

    test("the portion is logged for the viewer by default, or for no one", () => {
        const html = renderCookSheet(view());
        const chips = html.slice(html.indexOf('name="log_serving"') - 40);
        expect(chips).toMatch(
            /name="log_serving" value="1" checked[\s\S]*>Ethan<[\s\S]*name="log_serving" value="0"[\s\S]*>No one</,
        );
        expect(html).not.toMatch(/value="0" checked/);
    });

    test("the Log a portion for row names the meal the portion goes to", () => {
        const html = renderCookSheet(view());
        const row = html.slice(html.indexOf("Log a portion for"));
        expect(row).toContain(">to dinner<");
        expect(html).toContain('name="meal_type" value="dinner"');
        expect(renderCookSheet(view({ slot: "breakfast" }))).toContain(
            ">to breakfast<",
        );
    });

    test("focus parks on the panel, not on the stepper's number", () => {
        expect(renderCookSheet(view())).toContain(
            `id="${COOK_SHEET_ID}" data-fd-sheet-focus="panel"`,
        );
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
        expect(html).toContain(">Cook</span>");
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
