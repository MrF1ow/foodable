import { describe, expect, test } from "bun:test";
import { miniCard } from "./mini-card.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("miniCard (FigCraft 172377)", () => {
    test("label, title and meta, the label in the over colour by default", () => {
        expect(
            String(
                miniCard({ label: "Tomorrow", title: "Salmon", meta: "1 lb" }),
            ),
        ).toBe(
            '<div class="fd-mini-card"><span class="fd-mini-card__label fd-mini-card__label--over">Tomorrow</span><span class="fd-mini-card__title">Salmon</span><span class="fd-mini-card__meta">1 lb</span></div>',
        );
    });

    test("the meta line is optional, as Show meta off", () => {
        expect(
            String(miniCard({ label: "Today", title: "Milk" })),
        ).not.toContain("__meta");
    });

    test("every tone has its own class", () => {
        for (const tone of ["over", "warn", "muted"] as const) {
            expect(
                String(miniCard({ label: "x", title: "y", tone })),
            ).toContain(`fd-mini-card__label--${tone}`);
        }
    });

    test("a link when it has a href, with an unsafe href refused", () => {
        const html = String(
            miniCard({ label: "x", title: "y", href: "/kitchen#a" }),
        );
        expect(
            html.startsWith('<a class="fd-mini-card" href="/kitchen#a">'),
        ).toBe(true);
        expect(() =>
            miniCard({ label: "x", title: "y", href: "javascript:alert(1)" }),
        ).toThrow();
    });

    test("escapes every string", () => {
        const html = String(
            miniCard({ label: XSS, title: XSS, meta: XSS, className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(4);
    });

    test("data attributes go on the card, link or not", () => {
        const link = String(
            miniCard({
                label: "x",
                title: "y",
                href: "/a",
                data: { "fd-open-item": "sheet-1" },
            }),
        );
        expect(link).toContain('href="/a" data-fd-open-item="sheet-1">');
        expect(
            String(miniCard({ label: "x", title: "y", data: { "fd-a": "1" } })),
        ).toContain('<div class="fd-mini-card" data-fd-a="1">');
    });
});
