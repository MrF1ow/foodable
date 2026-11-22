/**
 * The design's Score badge (FigCraft 171563): a small pill with a band-coloured
 * dot and the number, padded 2 / 8 / 2 / 6 and set in weight 500. It owns the
 * look that rows currently force onto the live `.fd-score`.
 *
 * Bands, rounding and the spoken name come from the live `score-badge.ts`; the
 * live badge is untouched. No finite score draws nothing.
 *
 * Styles: `public/app/v2/badges.css`.
 */
import { cls, esc, raw, type Html } from "./html.js";
import { scoreAriaLabel, scoreBand, scoreValue } from "./score-badge.js";

export function scorePill(
    score: number | null | undefined,
    opts: { className?: string } = {},
): Html {
    const value = scoreValue(score);
    const band = scoreBand(score);
    if (value == null || band == null) return raw("");
    return raw(
        `<span class="${cls("fd-score-pill", `fd-score-pill--${band}`, opts.className)}" role="img" aria-label="${esc(scoreAriaLabel(value, band))}"><span class="fd-score-pill__dot" aria-hidden="true"></span><span class="fd-score-pill__num" aria-hidden="true">${value}</span></span>`,
    );
}
