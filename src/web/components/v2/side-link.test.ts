import { expect, test } from "bun:test";
import { sideLink } from "./side-link.js";
import { icon } from "./icon.js";
import { injectedAttributes, text, XSS, XSS_ESCAPED } from "./test-helpers.js";

test("Main, Default: an <a> with the icon, the label and no current mark", () => {
    const html = sideLink({
        kind: "main",
        label: "Kitchen",
        href: "/kitchen",
        icon: "fridge",
    });
    expect(text(html)).toBe(
        `<a class="fd-side-link fd-side-link--main" href="/kitchen">${icon("fridge", 18)}<span class="fd-side-link__label">Kitchen</span></a>`,
    );
    expect(html).not.toContain("aria-current");
});

test("Main, Current marks the page and takes the current class; it has no background of its own", () => {
    const html = sideLink({
        kind: "main",
        label: "Today",
        href: "/",
        icon: "calendar",
        current: true,
    });
    expect(html).toContain(
        "fd-side-link fd-side-link--main fd-side-link--current",
    );
    expect(html).toContain('aria-current="page"');
});

test("Sub, Default: an indent then the label, no icon", () => {
    const html = sideLink({ kind: "sub", label: "Overview", href: "/o" });
    expect(text(html)).toBe(
        '<a class="fd-side-link fd-side-link--sub" href="/o"><span class="fd-side-link__indent" aria-hidden="true"></span><span class="fd-side-link__label">Overview</span></a>',
    );
});

test("Sub, Current", () => {
    const html = sideLink({
        kind: "sub",
        label: "Overview",
        href: "/o",
        current: true,
    });
    expect(html).toContain("fd-side-link--sub fd-side-link--current");
    expect(html).toContain('aria-current="page"');
});

test('a group that holds the current page is current with aria-current="true"', () => {
    const html = sideLink({
        kind: "main",
        label: "Kitchen",
        href: "/k",
        icon: "fridge",
        current: "group",
    });
    expect(html).toContain("fd-side-link--current");
    expect(html).toContain('aria-current="true"');
});

test("a Main link needs an icon, a Sub link takes none", () => {
    expect(() =>
        sideLink({ kind: "main", label: "Kitchen", href: "/k" }),
    ).toThrow();
    expect(
        sideLink({
            kind: "sub",
            label: "Overview",
            href: "/o",
            icon: "fridge",
        }),
    ).not.toContain("fd-icon");
});

test("a class and data attributes are carried", () => {
    const html = sideLink({
        kind: "main",
        label: "Settings",
        href: "/settings",
        icon: "sun",
        className: "fd-sidebar__settings",
        data: { turbo: "false" },
    });
    expect(html).toContain("fd-side-link--main fd-sidebar__settings");
    expect(html).toContain(' data-turbo="false"');
});

test("the label, href, class and data are escaped; a javascript: href is refused", async () => {
    const html = sideLink({
        kind: "main",
        label: XSS,
        href: `/x?q=${XSS}`,
        icon: "sun",
        className: XSS,
        data: { x: XSS },
    });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
    expect(() =>
        sideLink({
            kind: "sub",
            label: "x",
            href: "javascript:alert(1)",
        }),
    ).toThrow();
});
