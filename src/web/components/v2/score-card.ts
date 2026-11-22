/**
 * The design's Score card (FigCraft 381529): the product score in its band
 * colour, the band word with a note under it, and the "/ 100" scale.
 *
 * Bands, rounding and the spoken name come from the live `score-badge.ts`, so
 * the number and the colour agree everywhere. No finite score is a dash with
 * no band, never a zero.
 *
 * Styles: `public/app/v2/cards.css`.
 */
import { cls, esc, raw, type Html } from "./html.js";
import {
    SCORE_BAND_LABEL,
    scoreAriaLabel,
    scoreBand,
    scoreValue,
} from "./score-badge.js";

export type ScoreCardOptions = {
    score: number | null | undefined;
    /** The line under the verdict ("Your weights: Balanced"). */
    note?: string;
    className?: string;
};

export function scoreCard(opts: ScoreCardOptions): Html {
    const value = scoreValue(opts.score);
    const band = scoreBand(opts.score);
    const known = value != null && band != null;
    const note =
        opts.note != null
            ? `<span class="fd-score-card__note">${esc(opts.note)}</span>`
            : "";
    return raw(
        `<div class="${cls("fd-score-card", `fd-score-card--${known ? band : "unknown"}`, opts.className)}" role="group" aria-label="${esc(known ? scoreAriaLabel(value, band) : "Product score: no score yet")}"><span class="fd-score-card__num" aria-hidden="true">${known ? value : "—"}</span><span class="fd-score-card__text"><span class="fd-score-card__verdict">${known ? SCORE_BAND_LABEL[band] : "No score"}</span>${note}</span><span class="fd-score-card__max" aria-hidden="true">/ 100</span></div>`,
    );
}
