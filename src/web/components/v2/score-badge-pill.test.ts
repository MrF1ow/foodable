import { describe, expect, test } from "bun:test";
import { scorePill } from "./score-badge-pill.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("scorePill (Score badge, FigCraft 171563)", () => {
    test("a dot and the number, named in full for a screen reader", () => {
        expect(String(scorePill(74))).toBe(
            '<span class="fd-score-pill fd-score-pill--good" role="img" aria-label="Product score 74 of 100, good"><span class="fd-score-pill__dot" aria-hidden="true"></span><span class="fd-score-pill__num" aria-hidden="true">74</span></span>',
        );
    });

    test("the band follows the live score bands", () => {
        expect(String(scorePill(70))).toContain("--good");
        expect(String(scorePill(69))).toContain("--middling");
        expect(String(scorePill(40))).toContain("--middling");
        expect(String(scorePill(39))).toContain("--poor");
    });

    test("rounds half up and clamps, like the live badge", () => {
        expect(String(scorePill(69.5))).toContain('aria-hidden="true">70<');
        expect(String(scorePill(-5))).toContain('aria-hidden="true">0<');
        expect(String(scorePill(140))).toContain('aria-hidden="true">100<');
    });

    test("no score draws nothing", () => {
        for (const score of [null, undefined, Number.NaN, Infinity]) {
            expect(String(scorePill(score))).toBe("");
        }
    });

    test("escapes the class", () => {
        const html = String(scorePill(50, { className: XSS }));
        expect(html).toContain(XSS_ESCAPED);
        expect(html).not.toContain("<script>");
    });
});
