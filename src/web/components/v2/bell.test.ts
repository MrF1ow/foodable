import { expect, test } from "bun:test";
import { bell } from "./bell.js";
import { injectedAttributes, XSS } from "./test-helpers.js";

test("a bell is a named button with the bell icon and no dot when nothing is new", () => {
    const html = bell({});
    expect(html).toStartWith('<button type="button" class="fd-bell"');
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain("fd-icon--bell");
    expect(html).not.toContain("fd-bell__dot");
    expect(html).not.toContain("fd-bell--unread");
});

test("something new adds a green dot and says so in the name, never a number", () => {
    const html = bell({ unread: true });
    expect(html).toContain("fd-bell fd-bell--unread");
    expect(html).toContain('<span class="fd-bell__dot" aria-hidden="true">');
    expect(html).toContain('aria-label="Notifications, new"');
    // The dot is empty: no count text anywhere in the markup.
    expect(html).not.toMatch(/>\s*\d+\s*</);
});

test("with a href the bell is a link", () => {
    const html = bell({ href: "/notifications", label: "Inbox" });
    expect(html).toStartWith('<a class="fd-bell" href="/notifications"');
    expect(html).toContain('aria-label="Inbox"');
});

test("the label, href and data are escaped, and a javascript: href is refused", async () => {
    const html = bell({ label: XSS, data: { x: XSS }, href: `/p?x=${XSS}` });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
    expect(() => bell({ href: "javascript:alert(1)" })).toThrow();
});
