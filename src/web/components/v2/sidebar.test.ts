import { expect, test } from "bun:test";
import { raw } from "./html.js";
import { sidebar, type SidebarOptions } from "./sidebar.js";
import { injectedAttributes, XSS, XSS_ESCAPED } from "./test-helpers.js";

const BASE: SidebarOptions = {
    household: { name: "The Flow household", meta: "3 members", href: "/h" },
    links: [
        { label: "Today", href: "/", icon: "calendar", current: true },
        { label: "Kitchen", href: "/k", icon: "fridge" },
        { label: "Recipes", href: "/r", icon: "book" },
        { label: "Trends", href: "/t", icon: "trend" },
    ],
    settings: { label: "Settings", href: "/s" },
    account: { name: "Ethan Flow", role: "Owner", href: "/s" },
};

test("the sidebar is the live .fd-sidebar block, with the design's parts inside", () => {
    const html = sidebar(BASE);
    expect(html).toStartWith('<div class="fd-sidebar fd-sidebar--design">');
    expect(html).toContain('<a class="fd-sidebar__household" href="/h"');
    expect(html).toContain(
        '<nav class="fd-sidebar__nav" aria-label="Main navigation">',
    );
    expect(html).toContain('<a class="fd-sidebar__account" href="/s"');
    // Household, nav, account: in the design's order.
    const at = (s: string) => html.indexOf(s);
    expect(at("fd-sidebar__household")).toBeLessThan(at("fd-sidebar__nav"));
    expect(at("fd-sidebar__nav")).toBeLessThan(at("fd-sidebar__account"));
});

test("the household shows its name, its meta line and an initial in an avatar", () => {
    const html = sidebar(BASE);
    expect(html).toContain(
        '<span class="fd-sidebar__title">The Flow household</span>',
    );
    expect(html).toContain('<span class="fd-sidebar__meta">3 members</span>');
    expect(html).toContain(
        '<span class="fd-avatar-initials" aria-hidden="true">T</span>',
    );
});

test("without a meta line the household has none; the avatar initials can be given", () => {
    const html = sidebar({
        ...BASE,
        household: { name: "Flow", href: "/h", initials: "FH" },
    });
    const household = html.slice(0, html.indexOf("</a>"));
    expect(household).not.toContain("fd-sidebar__meta");
    expect(household).toContain(">FH</span>");
});

test("links are Main side links, the current one marked; Settings is last in the nav, pushed to the foot", () => {
    const html = sidebar(BASE);
    expect(html.match(/fd-side-link--main/g)?.length).toBe(5);
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain(
        '<a class="fd-side-link fd-side-link--main fd-sidebar__settings" href="/s"',
    );
    expect(html.indexOf("Trends")).toBeLessThan(html.indexOf("Settings"));
});

test("Settings can be the current page", () => {
    const html = sidebar({
        ...BASE,
        links: BASE.links.map((l) => ({ ...l, current: false })),
        settings: { label: "Settings", href: "/s", current: true },
    });
    expect(html).toContain("fd-side-link--current fd-sidebar__settings");
});

test("sub links sit under their Main link as Sub side links", () => {
    const html = sidebar({
        ...BASE,
        links: [
            {
                label: "Kitchen",
                href: "/k",
                icon: "fridge",
                current: "group",
                subs: [
                    { label: "Fridge", href: "/k/f", current: true },
                    { label: "Groceries", href: "/k/g" },
                ],
            },
        ],
    });
    expect(html.match(/fd-side-link--sub/g)?.length).toBe(2);
    expect(html.indexOf("Kitchen")).toBeLessThan(html.indexOf("Fridge"));
    expect(html).toContain('aria-current="true"');
});

test("the account row has the avatar, name, role, a chevron and an accessible name", () => {
    const html = sidebar(BASE);
    expect(html).toContain('<span class="fd-sidebar__title">Ethan Flow</span>');
    expect(html).toContain('<span class="fd-sidebar__meta">Owner</span>');
    expect(html).toContain(">EF</span>");
    expect(html).toContain("fd-icon--chevron-right");
    // The row's name says what it is, with the person and role.
    expect(html).toContain('aria-label="Account: Ethan Flow, Owner"');
});

test("inline sits in the page flow (the gallery); the default is the live sticky column", () => {
    expect(sidebar({ ...BASE, inline: true })).toStartWith(
        '<div class="fd-sidebar fd-sidebar--design fd-sidebar--inline">',
    );
    expect(sidebar(BASE)).not.toContain("fd-sidebar--inline");
});

test("every string is escaped and a javascript: link is refused", async () => {
    const html = sidebar({
        household: { name: XSS, meta: XSS, href: `/h?${XSS}` },
        links: [{ label: XSS, href: `/k?${XSS}`, icon: "fridge" }],
        settings: { label: XSS, href: "/s" },
        account: { name: XSS, role: XSS, href: "/s" },
    });
    expect(html).toContain(XSS_ESCAPED);
    expect(html).not.toContain("<script>");
    expect(await injectedAttributes(html)).toEqual([]);
    expect(() =>
        sidebar({
            ...BASE,
            account: { name: "A", role: "B", href: "javascript:1" },
        }),
    ).toThrow();
});

test("the account row can carry its own circle and attributes, or be left out", () => {
    const html = sidebar({
        ...BASE,
        account: {
            name: "Ethan Flow",
            role: "Owner",
            href: "/s",
            avatar: raw('<span class="mine">EF</span>'),
            data: { turbo: "false" },
        },
    });
    expect(html).toContain(
        '<a class="fd-sidebar__account" href="/s" aria-label="Account: Ethan Flow, Owner" data-turbo="false"><span class="mine">EF</span>',
    );
    const without = sidebar({ ...BASE, account: undefined });
    expect(without).not.toContain("fd-sidebar__account");
    expect(without).toContain("fd-sidebar__household");
});
