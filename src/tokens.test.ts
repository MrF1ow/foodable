import { test, expect } from "bun:test";
import { BRAND_GREEN } from "./brand.js";
import {
    NEUTRAL,
    NUTRIENTS,
    RADIUS_SCALE,
    THEME_COLOR,
    TYPE_SCALE,
    renderTokensCss,
} from "./tokens.js";

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

test("shared CSS and app.css have no leftover size or radius px literals", async () => {
    const leftover = /font-size:\s*[0-9.]+px|border-radius:\s*[0-9]+px/;
    const files = ["public/app/app.css"];
    for await (const name of new Bun.Glob("*.css").scan({
        cwd: "public/widgets/src/shared",
    })) {
        files.push(`public/widgets/src/shared/${name}`);
    }
    for (const path of files) {
        const text = await Bun.file(path).text();
        const hits = text
            .split("\n")
            .map((line, i) =>
                leftover.test(line) ? `${path}:${i + 1}: ${line.trim()}` : null,
            )
            .filter((hit): hit is string => hit !== null);
        expect(hits, path).toEqual([]);
    }
});
