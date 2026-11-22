/**
 * The design's Nutrient line (FigCraft 382047): the small nutrients of the day
 * in one row ("1.6 / 3 L  Fiber 18 g  Sugar 31 g  Caffeine 180 mg"), the first
 * with its dot. With a `href` the whole row is a link with a trailing chevron.
 *
 * No items draws nothing. Each item is "label value"; an item with no label is its value alone
 * ("1.6 / 3 L"). Unknown is a dash, never a zero.
 *
 * Styles: `public/app/v2/nutrition-display.css`.
 */
import { valueText } from "./card.js";
import { dot, type DotColor } from "./dot.js";
import { icon } from "./icon.js";
import { cls, esc, raw, safeHref, type Html } from "./html.js";

export type NutrientLineItem = {
    label?: string;
    value: string | number | null;
    dot?: DotColor;
};

export type NutrientLineOptions = {
    items: readonly NutrientLineItem[];
    href?: string;
    /** The link's accessible name, when its text is not enough. */
    label?: string;
    className?: string;
};

function item(it: NutrientLineItem): string {
    const lead = it.dot ? String(dot(it.dot, { size: "sm" })) : "";
    const label = it.label != null ? `${esc(it.label)} ` : "";
    return `<span class="fd-nutrient-line__item">${lead}${label}${valueText(it.value)}</span>`;
}

export function nutrientLine(opts: NutrientLineOptions): Html {
    const classes = cls("fd-nutrient-line", opts.className);
    const href = opts.href == null ? null : safeHref(opts.href);
    // A link with no text has no accessible name; an empty row draws nothing.
    if (opts.items.length === 0) return raw("");
    const items = opts.items.map(item).join("");
    if (href == null) {
        return raw(`<div class="${classes}">${items}</div>`);
    }
    const name = opts.label != null ? ` aria-label="${esc(opts.label)}"` : "";
    return raw(
        `<a class="${classes}" href="${href}"${name}>${items}<span class="fd-nutrient-line__chevron">${icon("chevron-right", 24)}</span></a>`,
    );
}
