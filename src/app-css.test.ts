import { test, expect } from "bun:test";
import { getAppCss } from "./widgets.js";
import { comingSoonPage } from "./app/shell.js";

const SHARED = ["tokens.css", "base.css", "form.css", "table.css", "seg.css"];

test("app.css assembles with no unresolved include markers", async () => {
    const css = await getAppCss();
    expect(css.match(/\/\*@include/g)).toBeNull();
    expect(css).toContain(".bottom-nav");
});

test("app.css inlines each shared partial in full", async () => {
    const css = await getAppCss();
    for (const partial of SHARED) {
        const src = await Bun.file(
            `./public/widgets/src/shared/${partial}`,
        ).text();
        expect(css, partial).toContain(src.trim());
    }
});

test("app.css carries the widget brand green and none of the old per-form rules", async () => {
    const css = await getAppCss();
    expect(css).toContain("--accent: #28cf8b");
    expect(css).not.toContain("#2f8fd4");
    expect(css).not.toContain(".grocery-add-store button");
    expect(css).not.toContain(".recipe-create input");
});

test("the hidden attribute beats component display rules", async () => {
    const css = await getAppCss();
    expect(css).toMatch(
        /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/,
    );
});

test("native control hooks have zero specificity so component classes win", async () => {
    const form = await Bun.file("./public/widgets/src/shared/form.css").text();
    expect(form).toContain(":where(.native button)");
    expect(form).toContain(":where(.native select)");
    // A bare `.native button` (one not wrapped in :where) would outrank
    // `.btn-primary` and repaint it.
    expect(form).not.toMatch(
        /(?<!:where\(\s*)\.native\s+(button|select|input|textarea)/,
    );
});

test("seg buttons accept aria-selected as the active state", async () => {
    const seg = await Bun.file("./public/widgets/src/shared/seg.css").text();
    expect(seg).toContain('.seg-btn[aria-selected="true"]');
});

test("the app shell opts its main element into native control styling", () => {
    expect(comingSoonPage("fridge")).toContain(
        '<main class="app-main native">',
    );
});

test("page element defaults never outrank component classes", async () => {
    const css = await getAppCss();
    expect(css).not.toMatch(/^\.app-main (h1|h2|h3|p|a) \{/m);
    expect(css).toContain(":where(.app-main) p {");
});
