/**
 * Generates every icon file from src/brand.ts:
 *
 *   public/brand/*.svg         the mark, the light/dark tiles, the favicon
 *   public/favicon.ico         16/32/48px light tile, for browsers without SVG favicons
 *   public/apple-touch-icon.png 180px square light tile (iOS rounds it itself)
 *   public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png (PWA)
 *
 * Re-run after editing src/brand.ts:
 *   bun run scripts/gen-icons.ts
 *
 * Rasterizing needs rsvg-convert (librsvg) and ImageMagick on PATH. The SVGs
 * are what src/brand.test.ts checks; the rasters are committed as built.
 */

import { $ } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRAND_SVGS, TILE, maskableTileSvg, tileSvg } from "../src/brand.js";

for (const [name, render] of Object.entries(BRAND_SVGS)) {
    await Bun.write(`public/brand/${name}`, render());
}

const tmp = await mkdtemp(join(tmpdir(), "foodable-icons-"));
try {
    const tile = join(tmp, "tile.svg");
    const square = join(tmp, "square.svg");
    await Bun.write(tile, tileSvg("light"));
    await Bun.write(square, tileSvg("light", { square: true }));

    const sizes = [16, 32, 48];
    for (const size of sizes) {
        await $`rsvg-convert -w ${size} -h ${size} ${tile} -o ${join(tmp, `${size}.png`)}`;
    }
    const pngs = sizes.map((size) => join(tmp, `${size}.png`));
    await $`magick ${pngs} public/favicon.ico`;

    // iOS shows transparency as black, so the touch icon is opaque and square.
    await $`rsvg-convert -w 180 -h 180 ${square} -o ${join(tmp, "touch.png")}`;
    await $`magick ${join(tmp, "touch.png")} -background ${TILE.light.tile} -alpha remove -alpha off -strip public/apple-touch-icon.png`;

    const pwaSquare = join(tmp, "pwa-square.svg");
    const pwaMaskable = join(tmp, "pwa-maskable.svg");
    await Bun.write(pwaSquare, tileSvg("light", { square: true }));
    await Bun.write(pwaMaskable, maskableTileSvg());
    for (const [size, out] of [
        [192, "public/icon-192.png"],
        [512, "public/icon-512.png"],
    ] as const) {
        await $`rsvg-convert -w ${size} -h ${size} ${pwaSquare} -o ${out}`;
        await $`magick ${out} -background ${TILE.light.tile} -alpha remove -alpha off -strip ${out}`;
    }
    await $`rsvg-convert -w 512 -h 512 ${pwaMaskable} -o public/icon-maskable-512.png`;
    await $`magick public/icon-maskable-512.png -background ${TILE.light.tile} -alpha remove -alpha off -strip public/icon-maskable-512.png`;
} finally {
    await rm(tmp, { recursive: true, force: true });
}

console.log(
    "Wrote public/brand/*.svg, public/favicon.ico, public/apple-touch-icon.png, public/icon-*.png",
);
