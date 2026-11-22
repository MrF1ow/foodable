import { describe, expect, test } from "bun:test";
import { card, valueText } from "./card.js";
import { raw } from "./html.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("card (FigCraft 381516)", () => {
    test("wraps its content in the panel and the content frame", () => {
        expect(String(card({ children: raw("<p>Card content</p>") }))).toBe(
            '<div class="fd-card"><div class="fd-card__content"><p>Card content</p></div></div>',
        );
    });

    test("takes several children, a name and an extra class", () => {
        const html = String(
            card({
                children: [raw("<i>a</i>"), raw("<b>b</b>")],
                label: "Totals",
                className: "mine",
            }),
        );
        expect(html).toContain('class="fd-card mine"');
        expect(html).toContain('role="group" aria-label="Totals"');
        expect(html).toContain("<i>a</i><b>b</b>");
    });

    test("escapes the name and the class", () => {
        const html = String(
            card({ children: raw(""), label: XSS, className: XSS }),
        );
        expect(html).toContain(XSS_ESCAPED);
        expect(html).not.toContain("<script>");
    });
});

describe("valueText", () => {
    test("shows a number or a string, escaped", () => {
        expect(valueText(2057)).toBe("2057");
        expect(valueText(XSS)).toBe(XSS_ESCAPED);
    });

    test("unknown is a dash with a spoken name, never zero", () => {
        for (const v of [null, undefined, ""]) {
            const html = valueText(v);
            expect(html).toContain('<span aria-hidden="true">—</span>');
            expect(html).toContain("no data");
            expect(html).not.toBe("0");
        }
        expect(valueText(0)).toBe("0");
    });

    test("a number that is not finite is unknown too", () => {
        for (const v of [NaN, Infinity, -Infinity]) {
            const html = valueText(v);
            expect(html).toContain('<span aria-hidden="true">—</span>');
            expect(html).toContain("no data");
            expect(html).not.toContain("NaN");
            expect(html).not.toContain("Infinity");
        }
        expect(valueText(0)).toBe("0");
    });
});

describe("valueText with whitespace", () => {
    test("a blank string is unknown, like an empty one", () => {
        for (const v of ["  ", "\t\n", " "]) {
            const html = valueText(v);
            expect(html).toContain("—");
            expect(html).toContain("no data");
        }
        expect(valueText(" 4 ")).toBe(" 4 ");
    });
});
