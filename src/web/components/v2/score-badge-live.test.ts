/**
 * The live score badge builder's markup, pinned byte for byte. The design's new
 * component has its own module and class; this output must not move until the
 * pages that call it switch over.
 */
import { expect, test } from "bun:test";
import { raw } from "./html.js";
import { scoreBadge, scoreBig, scoreVerdict } from "./score-badge.js";

test("scoreBadge: the live badge is unchanged, and empty without a score", () => {
    expect(scoreBadge(74)).toBe(
        raw(
            '<span class="fd-score fd-score--good" role="img" aria-label="Product score 74 of 100, good"><span class="fd-score__dot" aria-hidden="true"></span><span class="fd-score__num" aria-hidden="true">74</span></span>',
        ),
    );
    expect(scoreBadge(null)).toBe(raw(""));
});

test("scoreVerdict and scoreBig: the live output is unchanged", () => {
    expect(scoreVerdict(41)).toBe(
        raw(
            '<span class="fd-verdict fd-verdict--middling"><span class="fd-verdict__dot" aria-hidden="true"></span><span class="fd-verdict__word">Middling</span></span>',
        ),
    );
    expect(scoreBig(96)).toBe(
        raw(
            '<p class="fd-score-big fd-score-big--good" role="img" aria-label="Product score 96 of 100, good"><span class="fd-score-big__num" aria-hidden="true">96</span><span class="fd-score-big__max" aria-hidden="true">/ 100</span></p>',
        ),
    );
});
