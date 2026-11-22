import { describe, expect, test } from "bun:test";
import { nutrientLine } from "./nutrient-line.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

const ITEMS = [
    { value: "1.6 / 3 L", dot: "water" as const },
    { label: "Fiber", value: "18 g" },
    { label: "Sugar", value: "31 g" },
    { label: "Caffeine", value: "180 mg" },
];

describe("nutrientLine (FigCraft 382047)", () => {
    test("items in a row, the first with its dot", () => {
        const html = String(nutrientLine({ items: ITEMS }));
        expect(html.startsWith('<div class="fd-nutrient-line">')).toBe(true);
        expect(html).toContain(
            '<span class="fd-nutrient-line__item"><span class="fd-dot fd-dot--water fd-dot--sm" aria-hidden="true"></span>1.6 / 3 L</span>',
        );
        expect(html).toContain(
            '<span class="fd-nutrient-line__item">Fiber 18 g</span>',
        );
        expect(html).toContain("Caffeine 180 mg");
        expect(html).not.toContain("fd-icon");
    });

    test("with a href the row is a link with a chevron", () => {
        const html = String(nutrientLine({ items: ITEMS, href: "/trends" }));
        expect(
            html.startsWith('<a class="fd-nutrient-line" href="/trends">'),
        ).toBe(true);
        expect(html).toContain("fd-icon--chevron-right");
    });

    test("a link can carry its own name", () => {
        expect(
            String(
                nutrientLine({
                    items: ITEMS,
                    href: "/t",
                    label: "Nutrient details",
                }),
            ),
        ).toContain('aria-label="Nutrient details"');
    });

    test("an unknown value is a dash, never zero", () => {
        const html = String(
            nutrientLine({ items: [{ label: "Fiber", value: null }] }),
        );
        expect(html).toContain("Fiber ");
        expect(html).toContain("—");
        expect(html).toContain("no data");
    });

    test("escapes the text and the class, refuses an unsafe href", () => {
        const html = String(
            nutrientLine({
                items: [{ label: XSS, value: XSS }],
                className: XSS,
            }),
        );
        expect(html).not.toContain("<script>");
        expect(html).toContain(XSS_ESCAPED);
        expect(() =>
            nutrientLine({ items: [], href: "javascript:alert(1)" }),
        ).toThrow();
    });
});

describe("nutrientLine with no items", () => {
    test("draws nothing, with or without a link", () => {
        expect(String(nutrientLine({ items: [] }))).toBe("");
        expect(String(nutrientLine({ items: [], href: "/today" }))).toBe("");
    });
});
