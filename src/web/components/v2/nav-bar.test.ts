import { expect, test } from "bun:test";
import { FD_LOG_HREF, FD_TABS } from "../../shell-v2.js";
import { FD_LOG_SEARCH_SHEET_ID } from "../../pages/v2/log-sheet.js";
import { fdIcon } from "../fd-icons.js";
import { text } from "./test-helpers.js";
import { navBar, NAV_BAR_TABS, NAV_LOG_SHEET_ID } from "./nav-bar.js";

/** The phone nav exactly as the live shell writes it (shell-v2.ts phoneTabs), without notice dots. */
function liveMarkup(active: string): string {
    const tab = (t: (typeof FD_TABS)[number]) =>
        `<a class="fd-tab" href="${t.href}"${t.id === active ? ' aria-current="page"' : ""} aria-label="${t.label}">${fdIcon(t.icon)}<span class="fd-tab-dot" aria-hidden="true"></span></a>`;
    const [today, kitchen, recipes, trends] = FD_TABS;
    const log = `<a class="fd-log" href="${FD_LOG_HREF}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}" aria-label="Search" title="Search">${fdIcon("search", 2)}</a>`;
    return `<nav class="fd-tabs" aria-label="Main tabs">${tab(today!)}${tab(kitchen!)}${log}${tab(recipes!)}${tab(trends!)}</nav>`;
}

test("the tabs and the log sheet are the live shell's", () => {
    expect(NAV_BAR_TABS.map((t) => [t.id, t.href, t.icon])).toEqual(
        FD_TABS.map((t) => [t.id, t.href, t.icon]),
    );
    expect(NAV_LOG_SHEET_ID).toBe(FD_LOG_SEARCH_SHEET_ID);
});

test.each(["today", "kitchen", "recipes", "trends"] as const)(
    "Active=%s is today's .fd-tabs markup, with no notice dots",
    (active) => {
        const html = navBar({ active, logHref: FD_LOG_HREF });
        expect(text(html)).toBe(
            liveMarkup(active).replace(
                '<nav class="fd-tabs"',
                '<nav class="fd-tabs fd-nav-bar"',
            ),
        );
        expect(html).not.toContain("attention");
        expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    },
);

test("Active=None marks no tab", () => {
    const html = navBar({ active: "none", logHref: FD_LOG_HREF });
    expect(html).not.toContain("aria-current");
    expect(html).toContain('class="fd-log"');
});

test("the centre button opens the search sheet", () => {
    expect(navBar({ active: "none", logHref: "/#x" })).toContain(
        `data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}"`,
    );
});

test("inline lets the bar sit in the page flow instead of fixed to the screen", () => {
    expect(navBar({ active: "today", logHref: "/", inline: true })).toContain(
        'class="fd-tabs fd-nav-bar fd-tabs--inline"',
    );
});

test("a log href that could run script is refused", () => {
    expect(() =>
        navBar({ active: "none", logHref: "javascript:alert(1)" }),
    ).toThrow();
});
