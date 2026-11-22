import { describe, expect, test } from "bun:test";
import { macroBar } from "./macro-bar.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("macroBar (FigCraft 382028)", () => {
    test("the label, value over target, and a filled bar", () => {
        const html = String(
            macroBar({ kind: "protein", value: 96, target: 210 }),
        );
        expect(html).toContain("fd-macro-bar fd-macro-bar--protein");
        expect(html).toContain("fd-dot--protein");
        expect(html).toContain(
            '<span class="fd-macro-bar__name">Protein</span>',
        );
        expect(html).toContain('<span class="fd-macro-bar__value">96</span>');
        expect(html).toContain(
            '<span class="fd-macro-bar__target">/ 210 g</span>',
        );
        expect(html).toContain('style="--fd-fill:45.7%"');
    });

    test("the bar is a named meter with its range", () => {
        const html = String(
            macroBar({ kind: "carbs", value: 96, target: 210 }),
        );
        expect(html).toContain('role="meter"');
        expect(html).toContain('aria-label="Carbs"');
        expect(html).toContain(
            'aria-valuemin="0" aria-valuemax="210" aria-valuenow="96"',
        );
        expect(html).toContain('aria-valuetext="96 of 210 g"');
    });

    test("each kind has its own name", () => {
        expect(
            String(macroBar({ kind: "carbs", value: 1, target: 2 })),
        ).toContain(">Carbs<");
        expect(
            String(macroBar({ kind: "fat", value: 1, target: 2 })),
        ).toContain(">Fat<");
    });

    test("over the target the fill stops at the full bar", () => {
        expect(
            String(macroBar({ kind: "fat", value: 300, target: 210 })),
        ).toContain("--fd-fill:100%");
    });

    test("no target: the value alone, an empty bar and no meter", () => {
        const html = String(macroBar({ kind: "fat", value: 12, target: null }));
        expect(html).not.toContain("__target");
        expect(html).not.toContain("role=");
        expect(html).toContain("--fd-fill:0%");
    });

    test("an unknown value is a dash and an empty bar, never zero", () => {
        const html = String(
            macroBar({ kind: "protein", value: null, target: 210 }),
        );
        expect(html).toContain("—");
        expect(html).toContain("no data");
        expect(html).toContain("--fd-fill:0%");
        expect(html).not.toContain("aria-valuenow");
    });

    test("a zero value is a zero, with an empty bar", () => {
        const html = String(
            macroBar({ kind: "protein", value: 0, target: 210 }),
        );
        expect(html).toContain('__value">0<');
        expect(html).toContain("--fd-fill:0%");
    });

    test("over the target or negative, the meter value stays in range and the text keeps the figure", () => {
        const over = String(
            macroBar({ kind: "carbs", value: 300, target: 250 }),
        );
        expect(over).toContain(
            'aria-valuemin="0" aria-valuemax="250" aria-valuenow="250"',
        );
        expect(over).toContain('aria-valuetext="300 of 250 g"');
    });

    test("a negative or non-finite value is unknown: a dash, spoken as no data, no meter", () => {
        for (const value of [-5, -0.4, Number.NaN, Infinity]) {
            const html = String(
                macroBar({ kind: "carbs", value, target: 250 }),
            );
            expect(html).toContain("—");
            expect(html).toContain("no data");
            expect(html).not.toContain("role=");
            expect(html).not.toContain("aria-valuenow");
            expect(html).not.toContain("-5 of");
            expect(html).toContain("--fd-fill:0%");
        }
    });

    test("a target that rounds below 1 counts as no target", () => {
        for (const target of [0.3, 0.49, 0, -2]) {
            const html = String(macroBar({ kind: "fat", value: 4, target }));
            expect(html).not.toContain("__target");
            expect(html).not.toContain("role=");
            expect(html).not.toContain('aria-valuemax="0"');
        }
        expect(
            String(macroBar({ kind: "fat", value: 4, target: 0.5 })),
        ).toContain("/ 1 g");
    });

    test("a unit and a label can be given", () => {
        const html = String(
            macroBar({
                kind: "protein",
                value: 5,
                target: 10,
                unit: "oz",
                label: "Prot",
            }),
        );
        expect(html).toContain("/ 10 oz");
        expect(html).toContain(">Prot<");
    });

    test("escapes the unit, label and class", () => {
        const html = String(
            macroBar({
                kind: "fat",
                value: 1,
                target: 2,
                unit: XSS,
                label: XSS,
                className: XSS,
            }),
        );
        expect(html).not.toContain("<script>");
    });
});
