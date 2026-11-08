import { esc, raw, type Html } from "./html.js";

/**
 * The fixed palette a dot may take. Each name maps to one token in
 * `components.css` (`fd-dot--<name>`), so a caller can never pass a free colour.
 * Macro / nutrient names are the data colours; `good` / `warn` / `over` are the
 * status colours (accent fill, `--status-warn`, `--status-over`).
 */
export const DOT_COLORS = [
    "protein",
    "carbs",
    "fat",
    "calories",
    "water",
    "fiber",
    "sugar",
    "caffeine",
    "good",
    "warn",
    "over",
] as const;

export type DotColor = (typeof DOT_COLORS)[number];

export function isDotColor(value: string): value is DotColor {
    return (DOT_COLORS as readonly string[]).includes(value);
}

/**
 * A round colour dot: 6px (`sm`, stat-tile header, FigCraft 20602) or 8px (`md`,
 * row leading slot and part-row status, FigCraft 21113).
 * Decorative unless `label` is given (then `role="img"` with that name).
 */
export function dot(
    color: DotColor,
    opts: { size?: "sm" | "md"; label?: string } = {},
): Html {
    if (!isDotColor(color)) throw new Error(`unknown dot colour: ${color}`);
    const size = opts.size === "sm" ? " fd-dot--sm" : "";
    const a11y = opts.label
        ? ` role="img" aria-label="${esc(opts.label)}"`
        : ` aria-hidden="true"`;
    return raw(`<span class="fd-dot fd-dot--${color}${size}"${a11y}></span>`);
}
