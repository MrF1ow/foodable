import { describe, expect, test } from "bun:test";
import { statCard } from "./stat-tiles-card.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("statCard (Stat tile, FigCraft 381522)", () => {
    test("a value over its label", () => {
        expect(String(statCard({ value: "2,057", label: "Avg kcal" }))).toBe(
            '<div class="fd-stat-card"><span class="fd-stat-card__value">2,057</span><span class="fd-stat-card__label">Avg kcal</span></div>',
        );
    });

    test("a number is shown as given", () => {
        expect(String(statCard({ value: 0, label: "Streak" }))).toContain(
            '__value">0<',
        );
    });

    test("an unknown value is a dash, never zero", () => {
        const html = String(statCard({ value: null, label: "Avg kcal" }));
        expect(html).toContain("—");
        expect(html).toContain("no data");
        expect(html).not.toContain('__value">0<');
    });

    test("escapes the value, label and class", () => {
        const html = String(
            statCard({ value: XSS, label: XSS, className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(3);
    });
});
