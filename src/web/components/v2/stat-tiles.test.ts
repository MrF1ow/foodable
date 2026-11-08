import { expect, test } from "bun:test";
import { XSS, text } from "./test-helpers.js";
import {
    delta,
    deltaStat,
    statStrip,
    statTile,
    statTiles,
} from "./stat-tiles.js";

test("a boxed tile pairs the dotted label with the value and unit", () => {
    const html = statTile({
        label: "Protein",
        value: 46,
        unit: "g",
        dot: "protein",
    });
    expect(text(html)).toBe(
        `<div class="fd-tile"><dt class="fd-tile__label"><span class="fd-dot fd-dot--protein fd-dot--sm" aria-hidden="true"></span>Protein</dt><dd class="fd-tile__value">46<span class="fd-stat__unit"> g</span></dd></div>`,
    );
});

test("a tile with no dot or unit renders just label and value", () => {
    const html = statTile({ label: "kcal", value: "248" });
    expect(html).not.toContain("fd-dot");
    expect(html).not.toContain("fd-stat__unit");
});

test("statTiles is one dl of tiles, optionally labelled", () => {
    const html = statTiles(
        [
            { label: "kcal", value: 248, dot: "calories" },
            { label: "Fat", value: 5, unit: "g", dot: "fat" },
        ],
        { label: "This amount" },
    );
    expect(html).toStartWith(`<dl class="fd-tiles" aria-label="This amount">`);
    expect(html.match(/class="fd-tile"/g)?.length).toBe(2);
    expect(html).toEndWith("</dl>");
});

test("statStrip puts the label first in the DOM (read as 'day streak, 4')", () => {
    const html = statStrip([
        { label: "day streak", value: 4 },
        { label: "days logged", value: "86%" },
    ]);
    expect(html).toContain(
        `<div class="fd-strip__cell"><dt class="fd-strip__label">day streak</dt><dd class="fd-strip__value">4</dd></div>`,
    );
    expect(html.match(/fd-strip__cell/g)?.length).toBe(2);
});

test("delta direction and tone classes", () => {
    expect(delta({ text: "1.2", direction: "down", tone: "good" })).toContain(
        "fd-delta fd-delta--good fd-delta--down",
    );
    expect(delta({ text: "1.2", direction: "up", tone: "bad" })).toContain(
        "fd-delta--bad fd-delta--up",
    );
    expect(delta({ text: "0", direction: "flat", tone: "neutral" })).toContain(
        "fd-delta--neutral fd-delta--flat",
    );
});

test("delta glyph is hidden and the spoken text names the direction", () => {
    const down = delta({ text: "1.2", direction: "down", tone: "good" });
    expect(down).toContain(`<span aria-hidden="true">↓ 1.2</span>`);
    expect(down).toContain(`<span class="fd-sr">down 1.2</span>`);
    expect(delta({ text: 3, direction: "up", tone: "bad" })).toContain(
        `<span class="fd-sr">up 3</span>`,
    );
    expect(
        delta({ text: "0.0", direction: "flat", tone: "neutral" }),
    ).toContain(`<span class="fd-sr">no change 0.0</span>`);
});

test("deltaStat shows value, unit, delta and context in order", () => {
    const html = deltaStat(
        {
            label: "Weight",
            value: "182.4",
            unit: "lb",
            context: "this month",
            delta: { text: "1.2", direction: "down", tone: "good" },
        },
        { label: "Weight" },
    );
    const order = [
        "fd-delta-stat__value",
        "fd-delta-stat__unit",
        "fd-delta--good",
        "fd-delta-stat__context",
    ].map((s) => html.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`<span class="fd-sr">Weight: </span>`);
});

test("every string is escaped", () => {
    const tile = {
        label: XSS,
        value: XSS,
        unit: XSS,
        context: XSS,
        delta: { text: XSS, direction: "up", tone: "bad" },
    } as const;
    for (const html of [
        statTile(tile),
        statTiles([tile], { label: XSS, className: XSS }),
        statStrip([tile], { label: XSS, className: XSS }),
        deltaStat(tile, { label: XSS, className: XSS }),
        delta(tile.delta),
    ]) {
        expect(html).not.toContain("<script");
    }
});
