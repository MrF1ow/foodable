import { test, expect } from "bun:test";
import { BRAND_GREEN } from "./brand.js";
import { NEUTRAL, NUTRIENTS, THEME_COLOR, renderTokensCss } from "./tokens.js";

// The token stylesheet is generated: a value lives in src/tokens.ts once.

test("the committed tokens.css matches src/tokens.ts", async () => {
    expect(
        await Bun.file("public/widgets/src/shared/tokens.css").text(),
        "public/widgets/src/shared/tokens.css: run bun run gen:tokens",
    ).toBe(renderTokensCss());
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
});

test("browser chrome uses the neutral background", () => {
    expect(THEME_COLOR).toEqual({
        light: NEUTRAL.light.bg,
        dark: NEUTRAL.dark.bg,
    });
});
