/**
 * The Foodable mark: an "F" drawn as a stem and two leaves, with a fork cut
 * into the upper leaf. Hand-built geometry (arcs and cubics), fitted to the
 * raster artwork, so it stays sharp from a 16px favicon to a 1024px tile.
 *
 * Every committed icon under public/ is generated from this module by
 * scripts/gen-icons.ts; src/brand.test.ts fails when they drift apart.
 */

/** The brand green. `--accent` in public/widgets/src/shared/tokens.css. */
export const BRAND_GREEN = "#28cf8b";

/** Tile colours of the light and dark app icon. */
export const TILE = {
    light: { tile: "#f1f1f1", mark: BRAND_GREEN },
    dark: { tile: "#383838", mark: "#ffffff" },
} as const;

export type IconTheme = keyof typeof TILE;

const MARK_W = 858;
const MARK_H = 810;

// The stem runs from the bottom of the mark (stemBottom) up into the upper
// leaf; the fork's head and two slots are notches in the same outline. The
// tile icons pass a longer stem so it runs off the tile's bottom edge.
function upperPath(stemBottom: number): string {
    return (
        `M0 ${stemBottom}V458A416 458 0 0 1 416 0H858` +
        "C858 208 716 379 506 379H382A26.5 26.5 0 0 1 382 325H592" +
        "A25 25 0 0 0 592 275H380A26 26 0 0 1 380 222H592" +
        "A24.5 24.5 0 0 0 592 173H316A93 93 0 0 0 240 316" +
        `C146 368 79 458 79 578V${stemBottom}Z`
    );
}

const LOWER_LEAF =
    "M436 477H622C622 658 516 810 336 810H116C116 618 246 477 436 477Z";

function markPaths(stemBottom: number): string {
    return `<path d="${upperPath(stemBottom)}"/><path d="${LOWER_LEAF}"/>`;
}

// width/height give an <img> an intrinsic size; without them it falls back
// to the browser's 300x150 replaced-element default.
function svgOpen(w: number, h: number, attrs = ""): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${attrs}>`;
}

/**
 * The bare mark in brand green. `fill` is a presentation attribute, so an
 * inline copy takes another colour from any CSS rule (`svg { fill:
 * currentColor }`); an <img> has no inherited colour to use, which is why the
 * file is not currentColor itself.
 */
export function markSvg(): string {
    return `${svgOpen(MARK_W, MARK_H, ` fill="${BRAND_GREEN}"`)}${markPaths(MARK_H)}</svg>\n`;
}

// Mark placement on a 1024 tile, measured from the app-icon artwork: inset
// 156 from the top and left, scaled to 740 wide.
const TILE_SIZE = 1024;
const TILE_RADIUS = 228;
const INSET = 156;
const SCALE = 740 / MARK_W;
// Long enough to pass the tile's bottom edge, where the tile clips it.
const TILE_STEM = Math.ceil((TILE_SIZE - INSET) / SCALE) + 4;
const MARK_TRANSFORM = `translate(${INSET} ${INSET}) scale(${SCALE.toFixed(5)})`;

/**
 * The app icon: the mark on a tile. `square` drops the rounded corners for
 * targets that mask the icon themselves (iOS's apple-touch-icon).
 */
export function tileSvg(
    theme: IconTheme,
    opts: { square?: boolean } = {},
): string {
    const { tile, mark } = TILE[theme];
    const r = opts.square ? 0 : TILE_RADIUS;
    return (
        svgOpen(TILE_SIZE, TILE_SIZE) +
        `<defs><clipPath id="t"><rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${r}"/></clipPath></defs>` +
        `<g clip-path="url(#t)"><rect width="${TILE_SIZE}" height="${TILE_SIZE}" fill="${tile}"/>` +
        `<g transform="${MARK_TRANSFORM}" fill="${mark}">${markPaths(TILE_STEM)}</g></g></svg>\n`
    );
}

/**
 * The browser favicon: the light tile, switching to the dark one when the
 * OS is in dark mode. Browsers evaluate prefers-color-scheme inside an SVG
 * favicon; the .ico fallback is the light tile.
 */
export function faviconSvg(): string {
    const { light, dark } = TILE;
    return (
        svgOpen(TILE_SIZE, TILE_SIZE) +
        `<style>.t{fill:${light.tile}}.m{fill:${light.mark}}` +
        `@media (prefers-color-scheme:dark){.t{fill:${dark.tile}}.m{fill:${dark.mark}}}</style>` +
        `<defs><clipPath id="t"><rect width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}"/></clipPath></defs>` +
        `<g clip-path="url(#t)"><rect class="t" width="${TILE_SIZE}" height="${TILE_SIZE}"/>` +
        `<g class="m" transform="${MARK_TRANSFORM}">${markPaths(TILE_STEM)}</g></g></svg>\n`
    );
}

/** The SVG files served under /brand/, keyed by file name. */
export const BRAND_SVGS: Record<string, () => string> = {
    "mark.svg": markSvg,
    "icon.svg": faviconSvg,
    "icon-light.svg": () => tileSvg("light"),
    "icon-dark.svg": () => tileSvg("dark"),
};
