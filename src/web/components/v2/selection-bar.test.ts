import { expect, test } from "bun:test";
import { selectionBar } from "./selection-bar.js";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";

const ACTIONS = [
    { label: "Cancel" },
    { label: "Discard", variant: "danger" as const },
] as const;

test("Floating is a toolbar with the count, then the actions", () => {
    const html = selectionBar({
        placement: "floating",
        count: 3,
        actions: ACTIONS,
    });
    expect(html).toStartWith(
        '<div class="fd-selection-bar fd-selection-bar--floating" role="toolbar" aria-label="Selection">',
    );
    expect(html.indexOf("fd-selection-bar__count")).toBeLessThan(
        html.indexOf("fd-selection-bar__actions"),
    );
    expect(html).toContain(
        '<span class="fd-selection-bar__count" aria-live="polite">3 selected</span>',
    );
});

test("the toolbar is named Selection, not the live count, whatever the count text", () => {
    const html = selectionBar({
        placement: "floating",
        count: 7,
        countLabel: "7 items picked",
        actions: ACTIONS,
    });
    expect(html).toContain('role="toolbar" aria-label="Selection"');
    expect(html).not.toContain('aria-label="7 items picked"');
    expect(html).toContain(
        '<span class="fd-selection-bar__count" aria-live="polite">7 items picked</span>',
    );
});

test("Inline takes its own class and is otherwise the same bar", () => {
    const html = selectionBar({
        placement: "inline",
        count: 3,
        actions: ACTIONS,
    });
    expect(html).toContain("fd-selection-bar fd-selection-bar--inline");
    expect(html).not.toContain("fd-selection-bar--floating");
});

test("each action is a Small button: Cancel is secondary, Discard is danger", () => {
    const html = selectionBar({
        placement: "floating",
        count: 2,
        actions: ACTIONS,
    });
    expect(html.match(/<button /g)?.length).toBe(2);
    expect(html).toContain("fd-btn--danger");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Discard<");
    expect(html.match(/fd-btn--sm/g)?.length).toBe(2);
});

test("an action can be a link or carry data attributes for a page script", () => {
    const html = selectionBar({
        placement: "inline",
        count: 1,
        actions: [
            { label: "Open", href: "/x" },
            { label: "Clear", attrs: { "data-fd-select-clear": "" } },
        ],
    });
    expect(html).toContain("<a ");
    expect(html).toContain('href="/x"');
    expect(html).toContain("data-fd-select-clear");
});

test("the count text can be changed and a count of one reads naturally", () => {
    expect(
        selectionBar({ placement: "inline", count: 1, actions: ACTIONS }),
    ).toContain("1 selected");
    expect(
        selectionBar({
            placement: "inline",
            count: 4,
            countLabel: "4 items",
            actions: ACTIONS,
        }),
    ).toContain(">4 items<");
});

test("a bar with no actions is a mistake", () => {
    expect(() =>
        selectionBar({ placement: "floating", count: 1, actions: [] }),
    ).toThrow();
});

test("strings are escaped", async () => {
    const html = selectionBar({
        placement: "floating",
        count: 2,
        countLabel: XSS,
        actions: [{ label: XSS, attrs: { "data-x": XSS } }],
    });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
});
