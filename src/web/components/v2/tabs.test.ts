import { expect, test } from "bun:test";
import { tab, tabs } from "./tabs.js";
import { raw } from "./html.js";
import { injectedAttributes, text, XSS } from "./test-helpers.js";

test("a tab is a link; the active one is the current page", () => {
    expect(text(tab({ label: "Fridge", href: "/f", active: true }))).toBe(
        '<a class="fd-tab-row__tab fd-tab-row__tab--active" href="/f" aria-current="page">Fridge</a>',
    );
    expect(text(tab({ label: "Groceries", href: "/g" }))).toBe(
        '<a class="fd-tab-row__tab" href="/g">Groceries</a>',
    );
});

test("a count follows the label after a middle dot", () => {
    expect(tab({ label: "Groceries", href: "/g", count: 8 })).toContain(
        ">Groceries · 8</a>",
    );
});

test("the row is a named nav of tabs, and the live tab classes are not used", () => {
    const html = tabs({
        label: "Kitchen",
        tabs: [
            { label: "Fridge", href: "/f", active: true },
            { label: "Groceries", href: "/g", count: 8 },
            { label: "Usuals", href: "/u" },
        ],
    });
    expect(html).toStartWith('<div class="fd-tab-row">');
    expect(html).toContain(
        '<nav class="fd-tab-row__tabs" aria-label="Kitchen">',
    );
    expect(html.match(/class="fd-tab-row__tab[" ]/g)?.length).toBe(3);
    expect(html).not.toContain('class="fd-tab"');
    expect(html).not.toContain("fd-tabs");
    expect(html).not.toContain("fd-tab-row__trailing");
});

test("a trailing slot sits after the tabs", () => {
    const html = tabs({
        label: "Kitchen",
        tabs: [{ label: "Fridge", href: "/f", active: true }],
        trailing: raw('<button class="slot">+</button>'),
    });
    expect(html.indexOf("</nav>")).toBeLessThan(html.indexOf("slot"));
    expect(html).toContain(
        '<div class="fd-tab-row__trailing"><button class="slot">+</button></div>',
    );
});

test("every string is escaped and a javascript: href is refused", async () => {
    const html = tabs({
        label: XSS,
        tabs: [{ label: XSS, href: `/x?${XSS}`, count: XSS }],
        className: XSS,
        data: { k: XSS },
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
    expect(() => tab({ label: "x", href: "javascript:alert(1)" })).toThrow();
});
