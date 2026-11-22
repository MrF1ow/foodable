import { expect, test } from "bun:test";
import { searchField } from "./search-field.js";
import { injectedAttributes, XSS } from "./test-helpers.js";

const base = { label: "Search foods" } as const;

test("boxed is the default: a lead icon, a search input and nothing else", () => {
    const html = searchField({ ...base, placeholder: "Search foods, recipes" });
    expect(html).toStartWith(
        '<div class="fd-search-field fd-search-field--boxed" role="search" aria-label="Search foods">',
    );
    expect(html).toContain("fd-icon--search");
    expect(html).toContain('type="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('aria-label="Search foods"');
    expect(html).toContain('placeholder="Search foods, recipes"');
    for (const part of [
        "shortcut",
        "clear",
        "barcode",
        "filter",
        "fd-btn--go",
    ]) {
        expect(html).not.toContain(part);
    }
});

test("line is the same field without a box", () => {
    expect(searchField({ ...base, style: "line" })).toContain(
        "fd-search-field fd-search-field--line",
    );
});

test("a value is written into the input", () => {
    expect(searchField({ ...base, value: "oat milk" })).toContain(
        'value="oat milk"',
    );
});

test("every part shows in the design's order", () => {
    const html = searchField({
        ...base,
        shortcut: "⌘K",
        clear: true,
        barcode: { href: "/scan" },
        filter: { label: "Filters", count: 2 },
        go: true,
    });
    const order = [
        "fd-search-field__lead",
        "fd-search-field__input",
        "fd-search-field__shortcut",
        "data-fd-search-clear",
        'aria-label="Scan a barcode"',
        'aria-label="Filters, 2 on"',
        "fd-btn--go",
    ].map((part) => html.indexOf(part));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(
        '<kbd class="fd-search-field__shortcut" aria-hidden="true">⌘K</kbd>',
    );
    expect(html).toContain('<a class="fd-search-field__action"');
    expect(html).toContain('href="/scan"');
    // The go button submits the form it sits in.
    expect(html).toContain('type="submit"');
});

test("link detected draws the link icon and the go button, from the option alone", () => {
    const html = searchField({ ...base, linkDetected: true });
    expect(html).toContain("data-link-detected");
    expect(html).toContain("fd-icon--link");
    expect(html).not.toContain("fd-icon--search");
    expect(html).toContain("fd-btn--go");
});

test("every string is escaped", async () => {
    const html = searchField({
        label: XSS,
        name: XSS,
        value: XSS,
        placeholder: XSS,
        id: XSS,
        shortcut: XSS,
        clear: true,
        barcode: { label: XSS, href: `/s?${XSS}` },
        filter: { label: XSS, count: 1 },
        go: { label: XSS },
        className: XSS,
        data: { k: XSS },
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
});

test("the search landmark is named with the field's label", () => {
    const html = searchField({ ...base, label: "Search foods" });
    expect(html).toContain('role="search" aria-label="Search foods"');
});
