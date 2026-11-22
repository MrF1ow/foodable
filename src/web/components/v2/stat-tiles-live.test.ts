/**
 * The live stat tile builder's markup, pinned byte for byte. The design's new
 * component has its own module and class; this output must not move until the
 * pages that call it switch over.
 */
import { expect, test } from "bun:test";
import { raw } from "./html.js";
import {
    delta,
    deltaStat,
    statStrip,
    statTile,
    statTiles,
} from "./stat-tiles.js";

test("statTile and statTiles: the live output is unchanged", () => {
    expect(
        statTile({ label: "Protein", value: "47", unit: "g", dot: "protein" }),
    ).toBe(
        raw(
            '<div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--protein fd-dot--sm" aria-hidden="true"></span>Protein</dt><dd class="fd-tile__value">47<span class="fd-stat__unit"> g</span></dd></div>',
        ),
    );
    expect(
        statTiles(
            [
                { label: "kcal", value: 248, dot: "calories" },
                { label: "Fat", value: 5, unit: "g" },
            ],
            { label: "Macros" },
        ),
    ).toBe(
        raw(
            '<dl class="fd-tiles" aria-label="Macros"><div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--calories fd-dot--sm" aria-hidden="true"></span>kcal</dt><dd class="fd-tile__value">248</dd></div><div class="fd-tile"><dt class="fd-tile__label">Fat</dt><dd class="fd-tile__value">5<span class="fd-stat__unit"> g</span></dd></div></dl>',
        ),
    );
});

test("statStrip, deltaStat and delta: the live output is unchanged", () => {
    expect(
        statStrip(
            [
                { label: "Streak", value: 4 },
                { label: "Days", value: 12 },
            ],
            { label: "Streaks" },
        ),
    ).toBe(
        raw(
            '<dl class="fd-strip" aria-label="Streaks"><div class="fd-strip__cell"><dt class="fd-strip__label">Streak</dt><dd class="fd-strip__value">4</dd></div><div class="fd-strip__cell"><dt class="fd-strip__label">Days</dt><dd class="fd-strip__value">12</dd></div></dl>',
        ),
    );
    expect(
        deltaStat(
            {
                label: "Weight",
                value: "182.4",
                unit: "lb",
                delta: { text: "1.2", direction: "down", tone: "good" },
                context: "this month",
            },
            { label: "Weight" },
        ),
    ).toBe(
        raw(
            '<p class="fd-delta-stat"><span class="fd-sr">Weight: </span><span class="fd-delta-stat__value">182.4</span><span class="fd-delta-stat__unit">lb</span><span class="fd-delta-stat__sep" aria-hidden="true">·</span><span class="fd-delta fd-delta--good fd-delta--down"><span aria-hidden="true">↓ 1.2</span><span class="fd-sr">down 1.2</span></span><span class="fd-delta-stat__context">this month</span></p>',
        ),
    );
    expect(delta({ text: "3", direction: "up", tone: "bad" })).toBe(
        raw(
            '<span class="fd-delta fd-delta--bad fd-delta--up"><span aria-hidden="true">↑ 3</span><span class="fd-sr">up 3</span></span>',
        ),
    );
});
