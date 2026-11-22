import { expect, test } from "bun:test";
import { raw } from "./html.js";
import { pageLayout } from "./page-layout.js";

const H = raw("<h1>Title</h1>");
const A = raw("<p>a</p>");
const B = raw("<p>b</p>");

test.each([
    ["single", "fd-page-layout--single"],
    ["narrow", "fd-page-layout--narrow"],
] as const)(
    "%s is one centred box with the header, then the content",
    (layout, cls) => {
        const html = pageLayout({ layout, header: H, content: A });
        expect(html).toStartWith(`<div class="fd-page-layout ${cls}">`);
        expect(html).toContain('<div class="fd-page-layout__box">');
        expect(html).toContain(
            `<div class="fd-page-layout__header">${H}</div>`,
        );
        expect(html).toContain(
            `<div class="fd-page-layout__content">${A}</div>`,
        );
        expect(html.indexOf("__header")).toBeLessThan(
            html.indexOf("__content"),
        );
    },
);

test("two columns puts a left and a right column under the header", () => {
    const html = pageLayout({
        layout: "two-columns",
        header: H,
        left: A,
        right: B,
    });
    expect(html).toContain("fd-page-layout fd-page-layout--two-columns");
    expect(html).toContain('<div class="fd-page-layout__columns">');
    expect(html).toContain(`<div class="fd-page-layout__column">${A}</div>`);
    expect(html).toContain(`<div class="fd-page-layout__column">${B}</div>`);
    expect(html.indexOf(String(A))).toBeLessThan(html.indexOf(String(B)));
});

test("settings is a menu column and a content column", () => {
    const html = pageLayout({
        layout: "settings",
        header: H,
        menu: A,
        content: B,
    });
    expect(html).toContain("fd-page-layout fd-page-layout--settings");
    expect(html).toContain(`<div class="fd-page-layout__menu">${A}</div>`);
    expect(html).toContain(`<div class="fd-page-layout__content">${B}</div>`);
    expect(html.indexOf("__menu")).toBeLessThan(html.lastIndexOf("__content"));
});

test("the header slot is optional: no header, no empty box", () => {
    for (const html of [
        pageLayout({ layout: "single", content: A }),
        pageLayout({ layout: "two-columns", left: A, right: B }),
        pageLayout({ layout: "settings", menu: A, content: B }),
    ]) {
        expect(html).not.toContain("fd-page-layout__header");
    }
});

test("a class and a landmark label can be added", () => {
    const html = pageLayout({
        layout: "single",
        content: A,
        className: "fd-x",
    });
    expect(html).toContain("fd-page-layout fd-page-layout--single fd-x");
});
