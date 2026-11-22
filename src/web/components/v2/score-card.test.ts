import { describe, expect, test } from "bun:test";
import { scoreCard } from "./score-card.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("scoreCard (FigCraft 381529)", () => {
    test("the score, its band word, the note and the scale", () => {
        const html = String(
            scoreCard({ score: 96, note: "Your weights: Balanced" }),
        );
        expect(html).toContain("fd-score-card fd-score-card--good");
        expect(html).toContain('role="group"');
        expect(html).toContain('aria-label="Product score 96 of 100, good"');
        expect(html).toContain(
            '<span class="fd-score-card__num" aria-hidden="true">96</span>',
        );
        expect(html).toContain(
            '<span class="fd-score-card__verdict">Good</span>',
        );
        expect(html).toContain(
            '<span class="fd-score-card__note">Your weights: Balanced</span>',
        );
        expect(html).toContain(
            '<span class="fd-score-card__max" aria-hidden="true">/ 100</span>',
        );
    });

    test("each band takes its own class and word", () => {
        expect(String(scoreCard({ score: 50 }))).toContain(
            "fd-score-card--middling",
        );
        expect(String(scoreCard({ score: 50 }))).toContain(">Middling<");
        expect(String(scoreCard({ score: 12 }))).toContain(
            "fd-score-card--poor",
        );
        expect(String(scoreCard({ score: 12 }))).toContain(">Poor<");
    });

    test("the number is the rounded, clamped score", () => {
        expect(String(scoreCard({ score: 69.5 }))).toContain(
            'aria-hidden="true">70<',
        );
        expect(String(scoreCard({ score: 140 }))).toContain(
            'aria-hidden="true">100<',
        );
    });

    test("no score is a dash with no band, never zero", () => {
        for (const score of [null, undefined, Number.NaN]) {
            const html = String(scoreCard({ score }));
            expect(html).toContain("fd-score-card--unknown");
            expect(html).toContain('aria-label="Product score: no score yet"');
            expect(html).toContain("—");
            expect(html).toContain(">No score<");
            expect(html).not.toContain(">0<");
        }
    });

    test("escapes the note and the class", () => {
        const html = String(
            scoreCard({ score: 50, note: XSS, className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(2);
    });
});
