import { test, expect } from "bun:test";
import {
    getAppCss,
    getEmbedCss,
    getWidgetHtml,
    WIDGET_TEMPLATES,
    withWidgetData,
} from "./widgets.js";

// The app carries the marketing site's look through an app-only brand layer;
// the in-chat widgets keep their neutral look. These pin that split.

const BRAND_MARKERS = ["Geist", "Bricolage", "--accent-soft", "/fonts/"];

test("chat widgets carry none of the app's brand layer", async () => {
    for (const key of Object.keys(WIDGET_TEMPLATES)) {
        const html = await getWidgetHtml(key);
        for (const marker of BRAND_MARKERS) {
            expect(html, `${key} contains ${marker}`).not.toContain(marker);
        }
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

test("the embed skin is the brand layer plus a transparent frame", async () => {
    const skin = await getEmbedCss();
    expect(skin).not.toContain("/*@include");
    expect(skin).toContain(
        (await Bun.file("./public/app/brand.css").text()).trim(),
    );
    expect(skin).toMatch(/background:\s*transparent/);
});

test("withWidgetData injects a skin as the frame's last style, only when asked", () => {
    const html =
        "<html><head><style>:root{--bg:#000}</style></head><script>initWidget({})</script></html>";
    const plain = withWidgetData(html, {}, { theme: "system" });
    expect(plain).not.toContain("<style>body");

    const skinned = withWidgetData(
        html,
        {},
        { theme: "dark", skin: "body{content:'$&'}" },
    );
    // Last style in <head>, so it wins over the widget's own tokens; `$&`
    // survives literally rather than being read as a replacement pattern.
    expect(skinned).toContain("<style>body{content:'$&'}</style></head>");
    expect(skinned.indexOf("--bg:#000")).toBeLessThan(
        skinned.indexOf("body{content"),
    );
    expect(skinned).toContain('<html data-theme="dark">');
});
