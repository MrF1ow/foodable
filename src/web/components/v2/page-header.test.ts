import { expect, test } from "bun:test";
import { pageHeader } from "./page-header.js";
import { raw } from "./html.js";
import { injectedAttributes, XSS } from "./test-helpers.js";

test("the header is a title in an h1, nothing else by default", () => {
    const html = pageHeader({ title: "Kitchen" });
    expect(html).toStartWith('<header class="fd-page-header">');
    expect(html).toContain('<h1 class="fd-page-header__title">Kitchen</h1>');
    expect(html).not.toContain("fd-page-header__subtitle");
    expect(html).not.toContain("fd-page-header__end");
    expect(html).not.toContain("fd-bell");
});

test("subtitle, actions slot, bell and avatar come in the design's order", () => {
    const html = pageHeader({
        title: "Kitchen",
        subtitle: "24 items",
        actions: raw('<button class="x">Act</button>'),
        bell: { unread: true },
        avatar: { initials: "EF", label: "Ethan" },
    });
    expect(html).toContain('<p class="fd-page-header__subtitle">24 items</p>');
    const order = [
        "fd-page-header__titles",
        "fd-page-header__actions",
        "fd-bell",
        "fd-page-header__avatar",
    ].map((c) => html.indexOf(c));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<button class="x">Act</button>');
    expect(html).toContain('aria-label="Ethan"');
    expect(html).toContain(">EF<");
});

test("an avatar with a href is a link, without one a plain circle", () => {
    expect(
        pageHeader({ title: "T", avatar: { initials: "A", href: "/s" } }),
    ).toContain('<a class="fd-page-header__avatar" href="/s"');
    expect(pageHeader({ title: "T", avatar: { initials: "A" } })).toContain(
        '<span class="fd-page-header__avatar"',
    );
});

test("every string is escaped", async () => {
    const html = pageHeader({
        title: XSS,
        subtitle: XSS,
        avatar: { initials: XSS, label: XSS, href: `/a?${XSS}` },
        className: XSS,
        data: { k: XSS },
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
});
