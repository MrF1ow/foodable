import { expect, test } from "bun:test";
import { topBar } from "./top-bar.js";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";

const BASE = { logFood: { href: "/#log" } };

test("the top bar is a header with search, a spacer, the bell and the Log food button, in that order", () => {
    const html = topBar(BASE);
    expect(html).toStartWith('<header class="fd-top-bar">');
    const at = (s: string) => html.indexOf(s);
    expect(at("fd-top-bar__search")).toBeGreaterThan(-1);
    expect(at("fd-top-bar__search")).toBeLessThan(at("fd-top-bar__spacer"));
    expect(at("fd-top-bar__spacer")).toBeLessThan(at("fd-bell"));
    expect(at("fd-bell")).toBeLessThan(at("Log food"));
});

test("the search is the boxed Search field with the placeholder and a ⌘K hint", () => {
    const html = topBar(BASE);
    expect(html).toContain("fd-search-field fd-search-field--boxed");
    expect(html).toContain('placeholder="Search foods, recipes, barcodes"');
    expect(html).toContain('aria-label="Search foods, recipes, barcodes"');
    expect(html).toContain(">⌘K</kbd>");
});

test("there is no scan button: scanning is a phone thing (rule 25)", () => {
    const html = topBar(BASE);
    expect(html).not.toContain("fd-icon--scan");
    expect(html).not.toContain("Scan");
});

test("Log food is the Small primary button with a plus, a link to the href", () => {
    const html = topBar(BASE);
    expect(html).toContain('href="/#log"');
    expect(html).toContain("fd-btn--primary");
    expect(html).toContain("fd-icon--plus");
    expect(html).toContain("Log food");
    expect(html).not.toContain("fd-btn--sm fd-btn--sm");
});

test("the bell shows a dot, never a number, when something is new", () => {
    expect(topBar(BASE)).not.toContain("fd-bell--unread");
    const html = topBar({ ...BASE, bell: { unread: true } });
    expect(html).toContain("fd-bell--unread");
    expect(html).not.toMatch(/fd-bell__dot[^>]*>\s*\d/);
});

test("the search shortcut is the shared keyboard hint, decorative", () => {
    const html = topBar(BASE);
    expect(html).toContain(
        '<kbd class="fd-keyboard-hint fd-search-field__shortcut" aria-hidden="true">⌘K</kbd>',
    );
});

test("the labels and the shortcut can be changed; the hint can be dropped", () => {
    const html = topBar({
        logFood: { href: "/x", label: "Add food" },
        search: { label: "Find", placeholder: "Find a thing", shortcut: false },
    });
    expect(html).toContain("Add food");
    expect(html).toContain('placeholder="Find a thing"');
    expect(html).not.toContain("⌘K");
});

test("data attributes ride on the search and on Log food (they open the log sheet)", () => {
    const html = topBar({
        logFood: { href: "/x", attrs: { "data-fd-open-sheet": "log" } },
        search: { data: { "fd-open-sheet": "log" } },
    });
    expect(html).toContain('data-fd-open-sheet="log"');
    expect(html.match(/data-fd-open-sheet="log"/g)?.length).toBe(2);
});

test("strings are escaped and a javascript: href is refused", async () => {
    const html = topBar({
        logFood: { href: `/x?${XSS}`, label: XSS },
        search: { label: XSS, placeholder: XSS },
    });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
    expect(() => topBar({ logFood: { href: "javascript:1" } })).toThrow();
});
