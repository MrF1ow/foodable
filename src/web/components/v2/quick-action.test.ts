import { describe, expect, test } from "bun:test";
import { quickAction } from "./quick-action.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("quickAction (FigCraft 303014)", () => {
    test("an icon box over a caption, a link with a href", () => {
        const html = String(
            quickAction({
                label: "Scan barcode",
                icon: "scan",
                href: "/log/scan",
            }),
        );
        expect(
            html.startsWith('<a class="fd-quick-action" href="/log/scan">'),
        ).toBe(true);
        expect(html).toContain('<span class="fd-quick-action__box">');
        expect(html).toContain("fd-icon--scan");
        expect(html).toContain('width="20"');
        expect(html).toContain(
            '<span class="fd-quick-action__caption">Scan barcode</span>',
        );
        expect(html).not.toContain("aria-label");
    });

    test("a button without a href", () => {
        const html = String(
            quickAction({ label: "Scan barcode", icon: "scan" }),
        );
        expect(
            html.startsWith('<button type="button" class="fd-quick-action">'),
        ).toBe(true);
    });

    test("Show caption off keeps the name for a screen reader", () => {
        const html = String(
            quickAction({
                label: "Scan barcode",
                icon: "scan",
                caption: false,
            }),
        );
        expect(html).not.toContain("__caption");
        expect(html).toContain('aria-label="Scan barcode"');
    });

    test("disabled is greyed, not removed", () => {
        expect(
            String(quickAction({ label: "x", icon: "scan", disabled: true })),
        ).toContain(" disabled");
        const link = String(
            quickAction({
                label: "x",
                icon: "scan",
                href: "/a",
                disabled: true,
            }),
        );
        expect(link).toContain('role="link" aria-disabled="true"');
        expect(link).not.toContain("href=");
        expect(
            String(quickAction({ label: "x", icon: "scan", href: "/a" })),
        ).not.toContain("role=");
    });

    test("escapes the label and the class, refuses an unsafe href", () => {
        const html = String(
            quickAction({ label: XSS, icon: "scan", className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(2);
        expect(() =>
            quickAction({
                label: "x",
                icon: "scan",
                href: "javascript:alert(1)",
            }),
        ).toThrow();
    });
});

describe("quick action button style", () => {
    test("sets its own radius and font size so the app's button rule cannot override them", async () => {
        const css = await Bun.file("public/app/v2/quick-action.css").text();
        const rule = css.match(/\.fd-quick-action \{[^}]*\}/)?.[0] ?? "";
        expect(rule).toContain("border-radius: var(--radius-md)");
        expect(rule).toContain("font-size: var(--text-caption-size)");
    });
});
