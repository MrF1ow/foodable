import { test, expect } from "bun:test";
import { BRAND_GREEN, BRAND_SVGS, TILE, markSvg, tileSvg } from "./brand.js";

test("the committed public/brand SVGs match src/brand.ts", async () => {
    for (const [name, render] of Object.entries(BRAND_SVGS)) {
        const file = Bun.file(`public/brand/${name}`);
        expect(await file.exists(), `${name}: run bun run gen:icons`).toBe(
            true,
        );
        expect(await file.text(), `${name}: run bun run gen:icons`).toBe(
            render(),
        );
    }
});

test("every brand SVG is pure vector: no embedded raster, script or link", () => {
    for (const [name, render] of Object.entries(BRAND_SVGS)) {
        const svg = render();
        expect(
            svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'),
            name,
        ).toBe(true);
        expect(svg, name).not.toMatch(/<image|<script|href=|data:/i);
        expect(svg, name).toMatch(/viewBox="0 0 \d+ \d+"/);
    }
});

test("the bare mark is brand green, so an <img> of it is not black", () => {
    expect(markSvg()).toContain(`fill="${BRAND_GREEN}"`);
});

test("every brand SVG has an intrinsic size for <img>", () => {
    for (const [name, render] of Object.entries(BRAND_SVGS)) {
        expect(render(), name).toMatch(/^<svg [^>]*width="\d+" height="\d+"/);
    }
});

test("the light tile is green on light, the dark tile white on dark", () => {
    expect(TILE.light.mark).toBe(BRAND_GREEN);
    expect(tileSvg("light")).toContain(`fill="${BRAND_GREEN}"`);
    expect(tileSvg("light")).toContain(`fill="${TILE.light.tile}"`);
    expect(tileSvg("dark")).toContain(`fill="${TILE.dark.mark}"`);
    expect(tileSvg("dark")).toContain(`fill="${TILE.dark.tile}"`);
});

test("the square variant drops the corner radius", () => {
    expect(tileSvg("light")).not.toContain('rx="0"');
    expect(tileSvg("light", { square: true })).toContain('rx="0"');
});

test("the favicon switches tiles with the OS theme", () => {
    const svg = BRAND_SVGS["icon.svg"]!();
    expect(svg).toContain("@media (prefers-color-scheme:dark)");
    expect(svg).toContain(TILE.dark.tile);
    expect(svg).toContain(TILE.light.tile);
});

test("the CSS accent is the logo green", async () => {
    const tokens = await Bun.file(
        "public/widgets/src/shared/tokens.css",
    ).text();
    const accents = [...tokens.matchAll(/--accent:\s*(#[0-9a-f]{6})/gi)].map(
        (m) => m[1]!.toLowerCase(),
    );
    expect(accents.length).toBe(4);
    expect(new Set(accents)).toEqual(new Set([BRAND_GREEN]));
});
