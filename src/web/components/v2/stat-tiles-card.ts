/**
 * The design's Stat tile (FigCraft 381522): a panel with a figure over its
 * label ("2,057" over "Avg kcal"). It sits two to a row.
 *
 * The live `stat-tiles.ts` (boxed tiles, strip, delta stat) is untouched;
 * this is the card from the Display & data set, under `fd-stat-card`.
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { valueText } from "./card.js";
import { cls, esc, raw, type Html } from "./html.js";

export type StatCardOptions = {
    /** Formatted by the caller; null is unknown and shows a dash. */
    value: string | number | null;
    label: string;
    className?: string;
};

export function statCard(opts: StatCardOptions): Html {
    return raw(
        `<div class="${cls("fd-stat-card", opts.className)}"><span class="fd-stat-card__value">${valueText(opts.value)}</span><span class="fd-stat-card__label">${esc(opts.label)}</span></div>`,
    );
}
