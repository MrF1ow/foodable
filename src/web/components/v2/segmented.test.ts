import { expect, test } from "bun:test";
import { segment, segmented } from "./segmented.js";
import { injectedAttributes, text, XSS } from "./test-helpers.js";

test("a segment is a radio button", () => {
    expect(text(segment({ label: "All", selected: true }))).toBe(
        '<button type="button" class="fd-segmented__segment fd-segmented__segment--selected" role="radio" aria-checked="true" tabindex="0">All</button>',
    );
    expect(text(segment({ label: "Just me", value: "me" }))).toBe(
        '<button type="button" class="fd-segmented__segment" role="radio" aria-checked="false" tabindex="-1" data-value="me">Just me</button>',
    );
});

test("a disabled segment is disabled", () => {
    expect(segment({ label: "x", disabled: true })).toContain(" disabled");
});

test("Regular is the default size of a named radio group", () => {
    const html = segmented({
        label: "Whose",
        segments: [
            { label: "All", value: "all", selected: true },
            { label: "Just me", value: "me" },
            { label: "Household", value: "house" },
        ],
    });
    expect(html).toStartWith(
        '<div class="fd-segmented fd-segmented--regular" role="radiogroup" aria-label="Whose" data-fd-segmented>',
    );
    expect(html.match(/role="radio"/g)?.length).toBe(3);
    expect(html.match(/aria-checked="true"/g)?.length).toBe(1);
    // One tab stop: the selected segment.
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
});

test("Small is its own size", () => {
    expect(
        segmented({
            label: "x",
            size: "small",
            segments: [{ label: "a" }, { label: "b" }],
        }),
    ).toContain("fd-segmented fd-segmented--small");
});

test("with nothing selected the first segment is the tab stop", () => {
    const html = segmented({
        label: "x",
        segments: [{ label: "a" }, { label: "b" }],
    });
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html.indexOf('tabindex="0"')).toBeLessThan(
        html.indexOf('tabindex="-1"'),
    );
});

test("a named group is native radios, so a form posts the chosen value without a script", () => {
    const html = segmented({
        label: "x",
        name: "scope",
        segments: [
            { label: "a", value: "a" },
            { label: "b", value: "b", selected: true },
        ],
    });
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("<button");
    expect(html.match(/<input [^>]*type="radio"/g)?.length).toBe(2);
    expect(html.match(/name="scope"/g)?.length).toBe(2);
    // The one checked radio carries the name and the value the form posts.
    const checked = html.match(/<input [^>]*\bchecked\b[^>]*>/g) ?? [];
    expect(checked.length).toBe(1);
    expect(checked[0]).toContain('name="scope"');
    expect(checked[0]).toContain('value="b"');
    // A segment is a label drawn around its radio: the radio is a visually hidden sibling of the face.
    expect(html).toContain(
        '<label class="fd-segmented__option"><input class="fd-segmented__input" type="radio" name="scope" value="a"><span class="fd-segmented__segment">a</span></label>',
    );
    // The face carries no state class: :checked draws it, so picking another
    // radio moves the fill with it and two faces are never filled at once.
    expect(html).toContain('<span class="fd-segmented__segment">b</span>');
    expect(html).not.toContain("fd-segmented__segment--selected");
    // No script role and no tab-stop bookkeeping: the browser owns focus and arrows.
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain("tabindex");
});

test("a selected and disabled segment is not drawn selected and posts nothing", () => {
    const html = segmented({
        label: "x",
        name: "scope",
        segments: [
            { label: "a", value: "a", selected: true, disabled: true },
            { label: "b", value: "b" },
        ],
    });
    expect(html).not.toContain("checked");
    expect(html).not.toContain("--selected");
    expect(html).toContain('value="a" disabled');
    // Unnamed groups agree.
    expect(
        segmented({
            label: "x",
            segments: [
                { label: "a", selected: true, disabled: true },
                { label: "b" },
            ],
        }),
    ).not.toContain('aria-checked="true"');
});

test("an unnamed group stays buttons for the script", () => {
    const html = segmented({
        label: "x",
        segments: [{ label: "a", value: "a", selected: true }],
    });
    expect(html).toContain('<button type="button"');
    expect(html).not.toContain("<input");
});

test("every string is escaped", async () => {
    const html = segmented({
        label: XSS,
        name: XSS,
        className: XSS,
        data: { k: XSS },
        segments: [{ label: XSS, value: XSS, selected: true }],
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
});
