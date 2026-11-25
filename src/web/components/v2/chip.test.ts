import { expect, test } from "bun:test";
import { chip, chipGroup } from "./chip.js";
import { injectedAttributes, text, XSS } from "./test-helpers.js";

test("an Off chip is a toggle button that is not pressed", () => {
    expect(text(chip({ label: "Lunch" }))).toBe(
        '<button type="button" class="fd-pill-chip" aria-pressed="false"><span class="fd-pill-chip__label">Lunch</span></button>',
    );
});

test("an On chip is pressed and carries its count", () => {
    const html = chip({ label: "Dinner", count: 4, selected: true });
    expect(html).toContain("fd-pill-chip fd-pill-chip--on");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('<span class="fd-pill-chip__count">4</span>');
});

test("a chip with a value and a disabled chip", () => {
    const html = chip({ label: "A", value: "a", disabled: true });
    expect(html).toContain('data-value="a"');
    expect(html).toContain(" disabled");
});

test("a chip with a href is a link and the selected one is current", () => {
    const html = chip({ label: "All", href: "/x", selected: true });
    expect(html).toStartWith('<a class="fd-pill-chip fd-pill-chip--on"');
    expect(html).toContain('href="/x"');
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("aria-pressed");
});

test("a multiple group is a named group of pressed toggles", () => {
    const html = chipGroup({
        label: "Meals",
        select: "multiple",
        chips: [
            { label: "Breakfast", value: "b", selected: true },
            { label: "Lunch", value: "l" },
        ],
    });
    expect(html).toStartWith(
        '<div class="fd-pill-chip-group" role="group" aria-label="Meals" data-fd-chips="multiple">',
    );
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(1);
});

test("a single group is a radio group with one tab stop", () => {
    const html = chipGroup({
        label: "Meal",
        select: "single",
        chips: [
            { label: "Breakfast", value: "b" },
            { label: "Lunch", value: "l", selected: true },
            { label: "Dinner", value: "d" },
        ],
    });
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('data-fd-chips="single"');
    expect(html.match(/role="radio"/g)?.length).toBe(3);
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
    expect(html).not.toContain("aria-pressed");
});

test("a single group with nothing selected is reachable through its first chip", () => {
    const html = chipGroup({
        label: "Meal",
        select: "single",
        chips: [{ label: "A" }, { label: "B" }],
    });
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html.indexOf('tabindex="0"')).toBeLessThan(
        html.indexOf('tabindex="-1"'),
    );
});

test("a links group is a nav and is not scripted", () => {
    const html = chipGroup({
        label: "Filter foods",
        select: "links",
        chips: [{ label: "All", href: "/a", selected: true }],
    });
    expect(html).toStartWith('<nav class="fd-pill-chip-group"');
    expect(html).not.toContain("data-fd-chips");
});

test("the old chip classes are not used", () => {
    const html = chipGroup({
        label: "x",
        select: "multiple",
        chips: [{ label: "a", selected: true }],
    });
    expect(html).not.toMatch(/class="[^"]*\bfd-chip\b/);
});

test("every string is escaped", async () => {
    const html = chipGroup({
        label: XSS,
        select: "multiple",
        className: XSS,
        data: { k: XSS },
        chips: [{ label: XSS, count: XSS, value: XSS }],
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
    expect(() => chip({ label: "x", href: "javascript:alert(1)" })).toThrow();
});

test("a chip can submit the form around it", () => {
    expect(String(chip({ label: "Eggs", submit: true }))).toContain(
        '<button type="submit" class="fd-pill-chip"',
    );
    expect(String(chip({ label: "Eggs" }))).toContain(
        '<button type="button" class="fd-pill-chip"',
    );
});
