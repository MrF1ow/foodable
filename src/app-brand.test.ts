import { test, expect } from "bun:test";
import { getAppCss, getWidgetHtml, WIDGET_TEMPLATES } from "./widgets.js";

// v1 chat widgets keep the NEUTRAL palette; v2 widgets use the Theme palette
// with a system font. The household app carries Geist and Bricolage in brand.css
// only — never in a widget partial or assembly.

const WEB_FONT_MARKERS = ["Geist", "Bricolage", "/fonts/"];
const WIDGET_V2_TOKENS = "public/widgets/src/shared/v2/tokens.css";
const WIDGET_V2_MARKER = "MCP chat widgets v2";

test("v1 chat widgets carry no web fonts or app font URLs", async () => {
    for (const key of Object.keys(WIDGET_TEMPLATES)) {
        const html = await getWidgetHtml(key);
        for (const marker of WEB_FONT_MARKERS) {
            expect(html, `${key} contains ${marker}`).not.toContain(marker);
        }
        expect(html, `${key} contains --accent-soft`).not.toContain(
            "--accent-soft",
        );
    }
});

test("the v2 widget token partial carries no web fonts", async () => {
    const css = await Bun.file(WIDGET_V2_TOKENS).text();
    for (const marker of WEB_FONT_MARKERS) {
        expect(css, marker).not.toContain(marker);
    }
    expect(css).not.toContain("@font-face");
});

test("the household app never loads widget v2 partials", async () => {
    for (const [label, css] of [
        ["getAppCss", await getAppCss()],
        ["brand.css", await Bun.file("./public/app/brand.css").text()],
    ] as const) {
        expect(css, label).not.toContain("shared/v2/");
        expect(css, label).not.toContain(WIDGET_V2_MARKER);
    }
});

test("app.css applies the brand layer after the shared tokens", async () => {
    const css = await getAppCss();
    const brand = (await Bun.file("./public/app/brand.css").text()).trim();
    const tokens = (
        await Bun.file("./public/widgets/src/shared/tokens.css").text()
    ).trim();
    expect(css).toContain(brand);
    expect(css.indexOf(brand)).toBeGreaterThan(css.indexOf(tokens));
});

test("the brand layer never redefines the accent or a nutrient colour", async () => {
    const brand = await Bun.file("./public/app/brand.css").text();
    for (const token of [
        "--accent:",
        "--on-accent:",
        "--calories:",
        "--protein:",
        "--carbs:",
        "--fat:",
        "--water:",
    ]) {
        expect(brand, token).not.toContain(token);
    }
});
