import { test, expect } from "bun:test";
import { BRAND_GREEN } from "./brand.js";
import {
    APP,
    APP_FONTS,
    NEUTRAL,
    NUTRIENTS,
    RADIUS_SCALE,
    THEME_COLOR,
    TYPE_SCALE,
    renderBrandCss,
    renderTokensCss,
} from "./tokens.js";

// The token stylesheet is generated: a value lives in src/tokens.ts once.

test("the committed tokens.css matches src/tokens.ts", async () => {
    expect(
        await Bun.file("public/widgets/src/shared/tokens.css").text(),
        "public/widgets/src/shared/tokens.css: run bun run gen:tokens",
    ).toBe(renderTokensCss());
});

test("the committed brand.css matches src/tokens.ts", async () => {
    expect(
        await Bun.file("public/app/brand.css").text(),
        "public/app/brand.css: run bun run gen:tokens",
    ).toBe(renderBrandCss());
});

test("the accent is the logo green", () => {
    expect(renderTokensCss()).toContain(`--accent: ${BRAND_GREEN};`);
});

test("every theme defines the same surface and nutrient keys", () => {
    expect(Object.keys(NEUTRAL.light).sort()).toEqual(
        Object.keys(NEUTRAL.dark).sort(),
    );
    expect(Object.keys(NUTRIENTS.light).sort()).toEqual(
        Object.keys(NUTRIENTS.dark).sort(),
    );
    expect(Object.keys(APP.light).sort()).toEqual(Object.keys(APP.dark).sort());
});

test("browser chrome uses the app background", () => {
    expect(THEME_COLOR).toEqual({
        light: APP.light.bg,
        dark: APP.dark.bg,
    });
    expect(THEME_COLOR).toEqual({ light: "#fbfaf7", dark: "#0d0f0e" });
});

test("APP_FONTS names the committed allowlisted files", () => {
    expect(APP_FONTS.map((f) => f.file)).toEqual([
        "geist-latin.woff2",
        "bricolage-latin.woff2",
    ]);
});

test("tokens.css emits the type and radius scales", () => {
    const css = renderTokensCss();
    for (const [k, v] of Object.entries(TYPE_SCALE)) {
        expect(css).toContain(`--fs-${k}: ${v};`);
    }
    for (const [k, v] of Object.entries(RADIUS_SCALE)) {
        expect(css).toContain(`--r-${k}: ${v};`);
    }
    expect(css).toContain("--radius: var(--r-18);");
    expect(RADIUS_SCALE["18"]).toBe("18px");
});

test("shared CSS and pre-brand app.css have no leftover size or radius px literals", async () => {
    const leftover = /font-size:\s*[0-9.]+px|border-radius:\s*[0-9]+px/;
    const files = ["public/app/app.css"];
    for await (const name of new Bun.Glob("*.css").scan({
        cwd: "public/widgets/src/shared",
    })) {
        files.push(`public/widgets/src/shared/${name}`);
    }
    for (const path of files) {
        let text = await Bun.file(path).text();
        // The U3 brand section uses sizes that are not on the widget scale
        // (17 / 30 / 34 px headings; 14 px nav chips). tokens.css stays
        // byte-identical, so those literals stay out of the shared files.
        if (path === "public/app/app.css") {
            const brand = text.indexOf("/* ---- brand");
            if (brand >= 0) text = text.slice(0, brand);
        }
        const hits = text
            .split("\n")
            .map((line, i) =>
                leftover.test(line) ? `${path}:${i + 1}: ${line.trim()}` : null,
            )
            .filter((hit): hit is string => hit !== null);
        expect(hits, path).toEqual([]);
    }
});
