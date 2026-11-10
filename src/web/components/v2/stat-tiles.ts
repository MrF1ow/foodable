/**
 * Stat tiles. Three shapes from the design, one data type:
 * - `statTiles`: a row of boxed tiles (FigCraft `#20599` macro tiles),
 * - `statStrip`: a hairline strip of equal columns (FigCraft `#21274` streaks),
 * - `deltaStat`: one big value with a coloured change (FigCraft `#21316` weight).
 *
 * Numbers are formatted by the caller; this module only escapes. Each tile is a
 * `<dt>` (label) and `<dd>` (value) pair so a screen reader hears "day streak,
 * 4", while the strip reorders them visually.
 */
import { dot, type DotColor } from "./dot.js";
import { cls, esc, raw, srOnly, type Html } from "./html.js";

export type StatValue = string | number;

/**
 * A change next to a value. `direction` is what happened to the number, `tone`
 * whether that is good (accent), bad (over) or neither. The caller states both:
 * a falling weight is good for one goal and bad for another.
 */
export type StatDelta = {
    /** The size of the change, formatted ("1.2"). */
    text: StatValue;
    direction: "up" | "down" | "flat";
    tone: "good" | "bad" | "neutral";
};

export type StatTile = {
    label: string;
    value: StatValue;
    unit?: string;
    /** Boxed tiles only: the 6px dot before the label. */
    dot?: DotColor;
    delta?: StatDelta;
    /** Trailing context in secondary text ("this month"). */
    context?: string;
};

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;
const WORD = { up: "up", down: "down", flat: "no change" } as const;

/**
 * "↓ 1.2" in the tone colour. The arrow glyph is `aria-hidden`; the spoken
 * text is "down 1.2" (or "no change 1.2" for flat).
 */
export function delta(d: StatDelta): Html {
    return raw(
        `<span class="fd-delta fd-delta--${d.tone} fd-delta--${d.direction}"><span aria-hidden="true">${ARROW[d.direction]} ${esc(d.text)}</span>${srOnly(`${WORD[d.direction]} ${d.text}`)}</span>`,
    );
}

function valueMarkup(tile: StatTile): string {
    const unit = tile.unit
        ? `<span class="fd-stat__unit"> ${esc(tile.unit)}</span>`
        : "";
    return `${esc(tile.value)}${unit}`;
}

/** One boxed tile: dot + label above, the value below. Radius is the design's 14. */
export function statTile(tile: StatTile): Html {
    const dotMarkup = tile.dot ? dot(tile.dot, { size: "sm" }) : "";
    return raw(
        `<div class="fd-tile"><dt class="fd-tile__label">${dotMarkup}${esc(tile.label)}</dt><dd class="fd-tile__value">${valueMarkup(tile)}</dd></div>`,
    );
}

/** A row of equal boxed tiles, gap 6, as one `<dl>`. */
export function statTiles(
    tiles: readonly StatTile[],
    opts: { className?: string; label?: string } = {},
): Html {
    const label = opts.label ? ` aria-label="${esc(opts.label)}"` : "";
    return raw(
        `<dl class="${cls("fd-tiles", opts.className)}"${label}>${tiles.map(statTile).join("")}</dl>`,
    );
}

/**
 * Hairline strip of equal columns with a divider before every column but the
 * first. Big number (Bricolage 28) over its label.
 */
export function statStrip(
    tiles: readonly StatTile[],
    opts: { className?: string; label?: string } = {},
): Html {
    const label = opts.label ? ` aria-label="${esc(opts.label)}"` : "";
    const cells = tiles
        .map(
            (tile) =>
                `<div class="fd-strip__cell"><dt class="fd-strip__label">${esc(tile.label)}</dt><dd class="fd-strip__value">${valueMarkup(tile)}</dd></div>`,
        )
        .join("");
    return raw(
        `<dl class="${cls("fd-strip", opts.className)}"${label}>${cells}</dl>`,
    );
}

/**
 * Weight-style headline: big value, unit, a coloured delta and trailing
 * context ("182.4 lb · ↓ 1.2 this month"). A single `<p>`; `label` is the
 * accessible name of the figure ("Weight").
 */
export function deltaStat(
    tile: StatTile & { delta: StatDelta },
    opts: { className?: string; label?: string } = {},
): Html {
    const unit = tile.unit
        ? `<span class="fd-delta-stat__unit">${esc(tile.unit)}</span>`
        : "";
    const context = tile.context
        ? `<span class="fd-delta-stat__context">${esc(tile.context)}</span>`
        : "";
    const lead = opts.label ? srOnly(`${opts.label}: `) : "";
    return raw(
        `<p class="${cls("fd-delta-stat", opts.className)}">${lead}<span class="fd-delta-stat__value">${esc(tile.value)}</span>${unit}<span class="fd-delta-stat__sep" aria-hidden="true">·</span>${delta(tile.delta)}${context}</p>`,
    );
}
