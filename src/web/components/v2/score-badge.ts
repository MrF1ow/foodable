/**
 * Product score badges: a 0-100 score in three
 * bands, shown as a small pill beside a title, a verdict pill and the big
 * score number. Colour is never the only signal: the band is in the accessible
 * name (badge, big score) or in the visible word (verdict).
 */
import { cls, esc, raw, type Html } from "./html.js";

export type ScoreBand = "good" | "middling" | "poor";

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
    good: "Good",
    middling: "Middling",
    poor: "Poor",
};

/**
 * The score as shown: rounded half up to a whole number, then clamped to
 * 0..100 (so 69.5 reads 70, -5 reads 0, 140 reads 100). `null` for anything
 * that is not a finite number (NaN, ±Infinity, null, undefined): there is no
 * score to show, and no badge is rendered.
 */
export function scoreValue(score: number | null | undefined): number | null {
    if (typeof score !== "number" || !Number.isFinite(score)) return null;
    return Math.min(100, Math.max(0, Math.round(score)));
}

/**
 * Band of a score, judged on the displayed (rounded, clamped) value so the
 * number and the colour always agree: good ≥ 70, middling 40–69, poor < 40.
 * `null` when there is no finite score.
 */
export function scoreBand(score: number | null | undefined): ScoreBand | null {
    const value = scoreValue(score);
    if (value == null) return null;
    if (value >= 70) return "good";
    if (value >= 40) return "middling";
    return "poor";
}

/** Accessible name shared by the badge and the big score. */
export function scoreAriaLabel(value: number, band: ScoreBand): string {
    return `Product score ${value} of 100, ${band}`;
}

/**
 * Small badge, FigCraft `#20367`: pill on `--surface-raised`, 7px band dot and
 * the number. `role="img"` with the full name ("Product score 41 of 100,
 * middling"), because the dot colour and bare number mean nothing alone.
 * Returns "" when there is no finite score.
 */
export function scoreBadge(
    score: number | null | undefined,
    opts: { className?: string } = {},
): Html {
    const value = scoreValue(score);
    const band = scoreBand(score);
    if (value == null || band == null) return raw("");
    return raw(
        `<span class="${cls("fd-score", `fd-score--${band}`, opts.className)}" role="img" aria-label="${esc(scoreAriaLabel(value, band))}"><span class="fd-score__dot" aria-hidden="true"></span><span class="fd-score__num" aria-hidden="true">${value}</span></span>`,
    );
}

/**
 * Verdict pill, FigCraft `#21105`: 8px dot and the band word ("Good",
 * "Middling", "Poor"), visible text, so no extra label. Returns "" without a
 * finite score.
 */
export function scoreVerdict(
    score: number | null | undefined,
    opts: { className?: string } = {},
): Html {
    const band = scoreBand(score);
    if (band == null) return raw("");
    return raw(
        `<span class="${cls("fd-verdict", `fd-verdict--${band}`, opts.className)}"><span class="fd-verdict__dot" aria-hidden="true"></span><span class="fd-verdict__word">${SCORE_BAND_LABEL[band]}</span></span>`,
    );
}

/**
 * Big score, FigCraft `#21100`: Bricolage 56 number with "/ 100" beside it, the
 * number in the band colour. One `role="img"` with the full name. Returns ""
 * without a finite score.
 */
export function scoreBig(
    score: number | null | undefined,
    opts: { className?: string } = {},
): Html {
    const value = scoreValue(score);
    const band = scoreBand(score);
    if (value == null || band == null) return raw("");
    return raw(
        `<p class="${cls("fd-score-big", `fd-score-big--${band}`, opts.className)}" role="img" aria-label="${esc(scoreAriaLabel(value, band))}"><span class="fd-score-big__num" aria-hidden="true">${value}</span><span class="fd-score-big__max" aria-hidden="true">/ 100</span></p>`,
    );
}
