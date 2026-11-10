import { expect, test } from "bun:test";
import { XSS, text } from "./test-helpers.js";
import {
    scoreAriaLabel,
    scoreBadge,
    scoreBand,
    scoreBig,
    scoreValue,
    scoreVerdict,
} from "./score-badge.js";

test("bands: good ≥ 70, middling 40–69, poor < 40", () => {
    expect(scoreBand(0)).toBe("poor");
    expect(scoreBand(39)).toBe("poor");
    expect(scoreBand(40)).toBe("middling");
    expect(scoreBand(69)).toBe("middling");
    expect(scoreBand(70)).toBe("good");
    expect(scoreBand(100)).toBe("good");
});

test("scores are rounded half up, then clamped, and the band follows the shown number", () => {
    expect(scoreValue(69.5)).toBe(70);
    expect(scoreBand(69.5)).toBe("good");
    expect(scoreValue(39.4)).toBe(39);
    expect(scoreBand(39.4)).toBe("poor");
    expect(scoreBand(39.5)).toBe("middling");
    expect(scoreValue(-5)).toBe(0);
    expect(scoreBand(-5)).toBe("poor");
    expect(scoreValue(140)).toBe(100);
    expect(scoreBand(140)).toBe("good");
});

test("a score that is not a finite number has no band, value or badge", () => {
    for (const bad of [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        null,
        undefined,
        "41" as unknown as number,
    ]) {
        expect(scoreValue(bad)).toBeNull();
        expect(scoreBand(bad)).toBeNull();
        expect(text(scoreBadge(bad))).toBe("");
        expect(text(scoreVerdict(bad))).toBe("");
        expect(text(scoreBig(bad))).toBe("");
    }
});

test("small badge is one role=img named with the score and band", () => {
    const html = scoreBadge(41);
    expect(html).toContain(`class="fd-score fd-score--middling"`);
    expect(html).toContain(`role="img"`);
    expect(html).toContain(`aria-label="Product score 41 of 100, middling"`);
    expect(html).toContain(
        `<span class="fd-score__num" aria-hidden="true">41</span>`,
    );
    expect(scoreBadge(82)).toContain("fd-score--good");
    expect(scoreBadge(12)).toContain("fd-score--poor");
    expect(scoreAriaLabel(12, "poor")).toBe("Product score 12 of 100, poor");
});

test("verdict shows the band word as visible text", () => {
    expect(scoreVerdict(82)).toContain(
        `<span class="fd-verdict__word">Good</span>`,
    );
    expect(scoreVerdict(55)).toContain(">Middling<");
    expect(scoreVerdict(10)).toContain(">Poor<");
    expect(scoreVerdict(82)).toContain("fd-verdict--good");
    expect(scoreVerdict(82)).not.toContain("role=");
});

test("big score is one role=img with the number and / 100 hidden from readers", () => {
    const html = scoreBig(82);
    expect(html).toContain("fd-score-big--good");
    expect(html).toContain(`aria-label="Product score 82 of 100, good"`);
    expect(html).toContain(
        `<span class="fd-score-big__num" aria-hidden="true">82</span>`,
    );
    expect(html).toContain(`/ 100`);
});

test("className is escaped", () => {
    expect(scoreBadge(50, { className: XSS })).not.toContain("<script");
    expect(scoreVerdict(50, { className: XSS })).not.toContain("<script");
    expect(scoreBig(50, { className: XSS })).not.toContain("<script");
});
