import { test, expect } from "bun:test";
import { BRAND_GREEN } from "./brand.js";
import {
    APP,
    APP_FONTS,
    NEUTRAL,
    THEME_COLOR,
    renderBrandCss,
    renderTokensCss,
} from "./tokens.js";

// The token stylesheets are generated: a value lives in src/tokens.ts once.

test("the committed token stylesheets match src/tokens.ts", async () => {
    for (const [path, render] of [
        ["public/widgets/src/shared/tokens.css", renderTokensCss],
        ["public/app/brand.css", renderBrandCss],
    ] as const) {
        expect(
            await Bun.file(path).text(),
            `${path}: run bun run gen:tokens`,
        ).toBe(render());
    }
});

test("the accent is the logo green, in one place", () => {
    expect(renderTokensCss()).toContain(`--accent: ${BRAND_GREEN};`);
    expect(renderBrandCss()).not.toMatch(/--accent:/);
});

test("every theme defines the same surface keys", () => {
    for (const palette of [NEUTRAL, APP]) {
        expect(Object.keys(palette.light).sort()).toEqual(
            Object.keys(palette.dark).sort(),
        );
    }
});

test("browser chrome uses the app background", () => {
    expect(THEME_COLOR).toEqual({ light: APP.light.bg, dark: APP.dark.bg });
});

test("every allowlisted font is committed and declared", async () => {
    const css = renderBrandCss();
    for (const font of APP_FONTS) {
        expect(await Bun.file(`public/fonts/${font.file}`).exists()).toBe(true);
        expect(css).toContain(`url("/fonts/${font.file}")`);
    }
});
