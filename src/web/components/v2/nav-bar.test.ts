import { expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { FD_LOG_HREF } from "../../shell-v2.js";
import { FD_LOG_SEARCH_SHEET_ID } from "../../pages/v2/log-sheet.js";
import { renderAppShell, type AppChrome } from "../../shell.js";
import { text } from "./test-helpers.js";
import { navBar, NAV_LOG_SHEET_ID } from "./nav-bar.js";

/** The phone nav the live shell writes, cut out of a whole page. */
function liveMarkup(chrome: Partial<AppChrome>): string {
    const html = renderAppShell({
        title: "T",
        active: "none",
        theme: "system",
        body: "<h1>B</h1>",
        flags: FIXTURE_APP_CHROME_FLAGS,
        ...chrome,
    });
    const at = html.indexOf('<nav class="fd-tabs');
    return html.slice(at, html.indexOf("</nav>", at) + "</nav>".length);
}

test("the centre button opens the shell's log search sheet", () => {
    expect(NAV_LOG_SHEET_ID).toBe(FD_LOG_SEARCH_SHEET_ID);
});

/** The markup with each icon cut to `<svg/>`, so a literal can be read. */
function skeleton(html: string): string {
    return html.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");
}

const TAB_HREFS = {
    today: "/",
    kitchen: "/kitchen/fridge",
    recipes: "/recipes",
    trends: "/trends",
} as const;

function expectedSkeleton(current: keyof typeof TAB_HREFS | null): string {
    const tab = (id: keyof typeof TAB_HREFS, label: string) =>
        `<a class="fd-tab" href="${TAB_HREFS[id]}"${current === id ? ' aria-current="page"' : ""} aria-label="${label}"><svg/><span class="fd-tab-dot" aria-hidden="true"></span></a>`;
    return (
        '<nav class="fd-tabs fd-nav-bar" aria-label="Main tabs">' +
        tab("today", "Today") +
        tab("kitchen", "Kitchen") +
        '<a class="fd-log" href="/#nutrition-log-meal" data-fd-open-sheet="fd-log-search" aria-label="Search" title="Search"><svg/></a>' +
        tab("recipes", "Recipes") +
        tab("trends", "Trends") +
        "</nav>"
    );
}

test.each(["today", "kitchen", "recipes", "trends"] as const)(
    "Active=%s: the live shell renders the literal nav markup, with no notice dots",
    (active) => {
        const html = navBar({ active, logHref: FD_LOG_HREF });
        const live = liveMarkup({ v2Active: active });
        expect(text(html)).toBe(live);
        // The shell's own markup against a literal, so a change to either the
        // component or what the shell passes it fails here.
        expect(skeleton(live)).toBe(expectedSkeleton(active));
        expect(html).not.toContain("attention");
        expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    },
);

test("Active=None: a page outside the tabs gets the literal unmarked nav markup in the live shell", () => {
    expect(skeleton(liveMarkup({ active: "none" }))).toBe(
        expectedSkeleton(null),
    );
    expect(skeleton(liveMarkup({ active: "household" }))).toBe(
        expectedSkeleton(null),
    );
    expect(text(navBar({ active: "none", logHref: FD_LOG_HREF }))).toBe(
        liveMarkup({ active: "none" }),
    );
});

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
