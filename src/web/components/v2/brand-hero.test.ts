import { describe, expect, test } from "bun:test";
import { brandHero } from "./brand-hero.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("brandHero (FigCraft 383401)", () => {
    const html = String(
        brandHero({
            title: "Foodable",
            tagline: "Your household's kitchen, in one place.",
        }),
    );

    test("a glow, the mark, the name and the tagline", () => {
        expect(html).toContain('<div class="fd-brand-hero">');
        expect(html).toContain(
            '<span class="fd-brand-hero__glow" aria-hidden="true"></span>',
        );
        expect(html).toContain('<p class="fd-brand-hero__title">Foodable</p>');
        expect(html).toContain("Your household's kitchen, in one place.");
    });

    test("the mark is the brand geometry, in the current colour, hidden from a screen reader", () => {
        expect(html).toContain(
            '<span class="fd-brand-hero__mark" aria-hidden="true"><svg',
        );
        expect(html).toContain('viewBox="0 0 858 810"');
        expect(html).toContain('fill="currentColor"');
        expect(html).not.toMatch(/#[0-9a-f]{6}/i);
    });

    test("the tagline is optional", () => {
        expect(String(brandHero({ title: "Foodable" }))).not.toContain(
            "__tagline",
        );
    });

    test("escapes the text and the class", () => {
        const out = String(
            brandHero({ title: XSS, tagline: XSS, className: XSS }),
        );
        expect(out).not.toContain("<script>");
        expect(out.split(XSS_ESCAPED).length - 1).toBe(3);
    });
});
