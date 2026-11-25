import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import { THEME_COLOR } from "../tokens.js";
import { getAppCss, getAppJs, getAppV2Css, getAppV2Js } from "../widgets.js";
import { FD_ICON_PATHS } from "./components/fd-icons.js";
import {
    FD_LOG_HREF,
    FD_LOG_MEAL_HASH,
    FD_TRENDS_HASH,
    FD_TRENDS_HREF,
    householdInitial,
    initialsOf,
    kitchenTabFor,
    v2ActiveFor,
} from "./shell-v2.js";
import { FD_BARCODE_SCAN_SHEET_ID } from "./pages/v2/log-sheet.js";
import { NAV_BAR_TABS } from "./components/v2/nav-bar.js";
import {
    renderAppShell,
    renderBarePage,
    type AppChrome,
    type AppTabId,
    type ShellIdentity,
    type ThemePref,
    type V2NavId,
} from "./shell.js";

const IDENTITY: ShellIdentity = {
    viewerName: "Ethan Flow",
    viewerRole: "owner",
    householdName: "The Flow household",
    memberCount: 3,
};

function v2Chrome(over: Partial<AppChrome> = {}): AppChrome {
    return {
        title: "Fridge",
        active: "nutrition",
        theme: "system",
        body: "<h1>Body</h1>",
        flags: FIXTURE_APP_CHROME_FLAGS,
        identity: IDENTITY,
        ...over,
    };
}

function v2Html(over: Partial<AppChrome> = {}): string {
    return renderAppShell(v2Chrome(over));
}

function between(html: string, open: RegExp, close: string): string {
    const m = open.exec(html);
    if (!m) throw new Error(`missing ${open}`);
    const start = m.index;
    return html.slice(start, html.indexOf(close, start) + close.length);
}

const tabsNav = (html: string) =>
    between(html, /<nav class="fd-tabs fd-nav-bar"/, "</nav>");
const sideNav = (html: string) =>
    between(html, /<nav class="fd-sidebar__nav"/, "</nav>");

/** hrefs of the links marked aria-current="page" in a nav's markup. */
function currentHrefs(nav: string): string[] {
    return [...nav.matchAll(/<a [^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => tag.includes('aria-current="page"'))
        .map((tag) => /href="([^"]+)"/.exec(tag)![1]!);
}

describe("the shell", () => {
    test("landmarks and roles", () => {
        const html = v2Html();
        expect(html.match(/<main\b/g)?.length).toBe(1);
        expect(html).toContain('<main class="app-main native fd-main">');
        expect(html).toContain("<h1>Body</h1></main>");
        const navs = [...html.matchAll(/<nav [^>]*aria-label="([^"]+)"/g)].map(
            (m) => m[1],
        );
        expect(navs).toEqual(["Main navigation", "Main tabs"]);
        expect(new Set(navs).size).toBe(navs.length);
        // The desktop top bar is the only page-level header; log sheets add
        // `<header class="fd-sheet-head">` inside their dialogs.
        expect(html).toContain('<header class="fd-top-bar">');
        const pageHeaders = [...html.matchAll(/<header class="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((cls) => cls === "fd-top-bar");
        expect(pageHeaders).toEqual(["fd-top-bar"]);
        expect(html).not.toContain("fd-phonebar");
        expect(html).not.toContain("<aside");
        expect(html).toContain('<div class="fd-sidebar fd-sidebar--design">');
        expect(html).toContain(
            '<main class="app-main native fd-main"><div class="fd-cluster">',
        );
    });

    test("toast region survives, permanent", () => {
        expect(v2Html()).toContain(
            '<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>',
        );
    });

    test("no logo, no app title, no old app bar or bottom nav", () => {
        const html = v2Html();
        const body = html.slice(html.indexOf("<body"));
        for (const old of [
            "app-bar",
            "bottom-nav",
            "has-bottom-nav",
            "/brand/mark.svg",
            ">Foodable<",
            "Foodable</a>",
        ]) {
            expect(body, old).not.toContain(old);
        }
    });

    test("pinned fd- class names", () => {
        const html = v2Html();
        for (const cls of [
            "fd-body",
            "fd-shell",
            "fd-column",
            "fd-sidebar",
            "fd-sidebar__household",
            "fd-sidebar__nav",
            "fd-side-link",
            "fd-sidebar__settings",
            "fd-sidebar__account",
            "fd-account-chip",
            "fd-cluster",
            "fd-bell",
            "fd-top-bar",
            "fd-search-field",
            "fd-btn",
            "fd-tabs",
            "fd-nav-bar",
            "fd-tab",
            "fd-tab-dot",
            "fd-log",
            "fd-main",
        ]) {
            expect(html, cls).toMatch(new RegExp(`class="[^"]*\\b${cls}\\b`));
        }
    });

    test("phone nav: Today, Kitchen, search button, Recipes, Trends", () => {
        const nav = tabsNav(v2Html());
        const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        expect(hrefs).toEqual([
            "/",
            "/kitchen/fridge",
            FD_LOG_HREF,
            "/recipes",
            FD_TRENDS_HREF,
        ]);
        const labels = [...nav.matchAll(/aria-label="([^"]+)"/g)].map(
            (m) => m[1],
        );
        expect(labels).toEqual([
            "Main tabs",
            "Today",
            "Kitchen",
            "Search",
            "Recipes",
            "Trends",
        ]);
        expect(nav).toContain('class="fd-log"');
        expect(nav.match(/class="fd-tab"/g)?.length).toBe(4);
        // The tabs are the Nav bar component's, which the shell does not copy.
        expect(NAV_BAR_TABS.map((t) => t.href)).toEqual([
            "/",
            "/kitchen/fridge",
            "/recipes",
            FD_TRENDS_HREF,
        ]);
    });

    test("the nav icons are the design's geometry", () => {
        const nav = tabsNav(v2Html());
        for (const name of [
            "cal",
            "fridge",
            "search",
            "book",
            "trend",
        ] as const) {
            expect(nav, name).toContain(`d="${FD_ICON_PATHS[name]}"`);
        }
        // The search glyph on the green button is stroked 2, the rest 1.7.
        expect(nav).toMatch(/stroke-width="2"[^>]*><path d="M16 16L20.5/);
        expect(nav.match(/stroke-width="1.7"/g)?.length).toBe(4);
    });

    const ACTIVE_CASES: {
        active: AppTabId | "none";
        v2Active?: V2NavId;
        tabs: string[];
        side: string[];
        nav: V2NavId;
    }[] = [
        { active: "nutrition", tabs: ["/"], side: ["/"], nav: "today" },
        {
            active: "fridge",
            tabs: ["/kitchen/fridge"],
            side: ["/kitchen/fridge"],
            nav: "kitchen",
        },
        {
            active: "grocery",
            tabs: ["/kitchen/fridge"],
            // The sidebar's current page is the Groceries section link.
            side: ["/kitchen/groceries"],
            nav: "kitchen",
        },
        {
            active: "household",
            v2Active: "kitchen",
            tabs: ["/kitchen/fridge"],
            side: ["/kitchen/fridge"],
            nav: "kitchen",
        },
        {
            active: "recipes",
            tabs: ["/recipes"],
            side: ["/recipes"],
            nav: "recipes",
        },
        { active: "household", tabs: [], side: ["/settings"], nav: "settings" },
        { active: "none", tabs: [], side: [], nav: "none" },
    ];
    for (const c of ACTIVE_CASES) {
        test(`active ${c.active}${c.v2Active ? ` (v2 ${c.v2Active})` : ""} → ${c.nav}`, () => {
            const html = v2Html({ active: c.active, v2Active: c.v2Active });
            expect(
                v2ActiveFor({ active: c.active, v2Active: c.v2Active }),
            ).toBe(c.nav);
            expect(currentHrefs(tabsNav(html))).toEqual(c.tabs);
            expect(currentHrefs(sideNav(html))).toEqual(c.side);
        });
    }

    test("a settings page leaves every phone tab unmarked", () => {
        expect(tabsNav(v2Html({ active: "household" }))).not.toContain(
            "aria-current",
        );
    });

    test("settings pages have no account chip; every other page keeps it", () => {
        expect(v2Html({ active: "household" })).not.toContain(
            "fd-account-chip",
        );
        expect(
            v2Html({ active: "household", v2Active: "settings" }),
        ).not.toContain("fd-account-chip");
        expect(v2Html({ active: "nutrition" })).toContain("fd-account-chip");
        expect(v2Html({ active: "household", v2Active: "kitchen" })).toContain(
            "fd-account-chip",
        );
    });

    describe("the bell", () => {
        const phoneBell = (html: string) =>
            between(html, /<div class="fd-cluster">/, "</div>");
        const topBar = (html: string) =>
            between(html, /<header class="fd-top-bar"/, "</header>");

        test("a link to the inbox in the phone cluster, beside the account chip", () => {
            const cluster = phoneBell(v2Html());
            expect(cluster).toContain(
                '<a class="fd-bell" href="/notifications" aria-label="Notifications" data-turbo-prefetch="false">',
            );
            expect(cluster.indexOf("fd-bell")).toBeLessThan(
                cluster.indexOf("fd-account-chip"),
            );
        });

        test("neither bell is prefetched on hover, since opening the inbox marks it read", () => {
            const html = v2Html();
            const bells = html.match(/<a class="fd-bell[^>]*>/g) ?? [];
            expect(bells).toHaveLength(2);
            for (const tag of bells) {
                expect(tag).toContain('data-turbo-prefetch="false"');
            }
            // Prefetch stays on everywhere else.
            expect(html).not.toContain('name="turbo-prefetch"');
        });

        test("in the desktop top bar, left of Log food", () => {
            const top = topBar(v2Html());
            expect(top).toContain('href="/notifications"');
            expect(top.indexOf("fd-bell")).toBeLessThan(
                top.indexOf("Log food"),
            );
            // After the search field.
            expect(top.indexOf("fd-search-field")).toBeLessThan(
                top.indexOf("fd-bell"),
            );
        });

        test("no dot until something is new, then a dot and ', new' on both bells", () => {
            const off = v2Html();
            expect(off).not.toContain("fd-bell--unread");
            expect(off).not.toContain("fd-bell__dot");
            expect(v2Html({ notificationsUnread: false })).not.toContain(
                "fd-bell--unread",
            );
            const on = v2Html({ notificationsUnread: true });
            expect(on.match(/fd-bell--unread/g)).toHaveLength(2);
            expect(on.match(/fd-bell__dot/g)).toHaveLength(2);
            expect(phoneBell(on)).toContain('aria-label="Notifications, new"');
            expect(topBar(on)).toContain('aria-label="Notifications, new"');
            // A dot, never a number.
            expect(on).not.toMatch(/fd-bell[^>]*>[^<]*\d/);
        });

        test("settings pages and Detail-bar pages have no phone cluster; the top bar keeps its bell", () => {
            for (const over of [
                { active: "household" } as const,
                { active: "household", v2Active: "settings" } as const,
                { active: "none", v2Detail: true } as const,
            ]) {
                const html = v2Html(over);
                expect(html, JSON.stringify(over)).not.toContain("fd-cluster");
                expect(topBar(html)).toContain("fd-bell");
            }
        });

        test("never on a bare page", () => {
            const html = renderBarePage("Not found", "<p>x</p>");
            expect(html).not.toContain("fd-bell");
            expect(html).not.toContain("/notifications");
        });
    });

    test("account chip links to Settings, with the viewer's initials", () => {
        const html = v2Html();
        const chip = between(html, /<a class="fd-account-chip"/, "</a>");
        expect(chip).toContain('href="/settings"');
        expect(chip).not.toContain("data-turbo");
        expect(chip).toContain(
            'aria-label="Settings, signed in as Ethan Flow"',
        );
        expect(chip).toContain(">EF</a>");
    });

    test("sidebar: Kitchen sections show under Kitchen only while it is active", () => {
        const subs = (html: string) =>
            [
                ...sideNav(html).matchAll(
                    /<a class="fd-side-link fd-side-link--sub( fd-side-link--current)?" href="([^"]+)"( aria-current="page")?>[^]*?<span class="fd-side-link__label">([^<]+)</g,
                ),
            ].map((m) => [m[2], m[4], m[3] ? "current" : ""]);
        expect(subs(v2Html({ active: "nutrition" }))).toEqual([]);
        expect(subs(v2Html({ active: "recipes" }))).toEqual([]);
        expect(subs(v2Html({ active: "fridge" }))).toEqual([
            ["/kitchen/fridge", "Fridge", "current"],
            ["/kitchen/groceries", "Groceries", ""],
            ["/kitchen/usuals", "Usuals", ""],
        ]);
        expect(subs(v2Html({ active: "grocery" }))[1]).toEqual([
            "/kitchen/groceries",
            "Groceries",
            "current",
        ]);
        expect(
            subs(
                v2Html({
                    active: "household",
                    v2Active: "kitchen",
                    v2Kitchen: "usuals",
                }),
            )[2],
        ).toEqual(["/kitchen/usuals", "Usuals", "current"]);
        // Kitchen is the current group, not the current page.
        expect(sideNav(v2Html({ active: "grocery" }))).toContain(
            '<a class="fd-side-link fd-side-link--main fd-side-link--current" href="/kitchen/fridge" aria-current="true">',
        );
        // Directly after the Kitchen link, before Recipes.
        expect(sideNav(v2Html({ active: "fridge" }))).toMatch(
            />Kitchen<\/span><\/a><a class="fd-side-link fd-side-link--sub[^]*?Usuals<\/span><\/a><a class="fd-side-link fd-side-link--main" href="\/recipes"/,
        );
    });

    test("sidebar: household block, nav, Settings, account", () => {
        const html = v2Html();
        const household = between(
            html,
            /<a class="fd-sidebar__household"/,
            "</a>",
        );
        expect(household).toContain('href="/settings/household"');
        expect(household).toContain(
            'class="fd-sidebar__title">The Flow household<',
        );
        expect(household).toContain('class="fd-sidebar__meta">3 members<');
        expect(household).toContain(
            'class="fd-avatar-initials" aria-hidden="true">F<',
        );
        const side = sideNav(html);
        expect(
            [...side.matchAll(/class="fd-side-link__label">([^<]+)</g)].map(
                (m) => m[1],
            ),
        ).toEqual(["Today", "Kitchen", "Recipes", "Trends", "Settings"]);
        const settings = between(
            side,
            /<a class="fd-side-link fd-side-link--main fd-sidebar__settings"/,
            "</a>",
        );
        expect(settings).toContain('href="/settings"');
        expect(settings).not.toContain("data-turbo");
        const account = between(html, /<a class="fd-sidebar__account"/, "</a>");
        expect(account).toContain('href="/settings"');
        expect(account).not.toContain("data-turbo");
        expect(account).toContain('class="fd-sidebar__title">Ethan Flow<');
        expect(account).toContain('class="fd-sidebar__meta">Owner<');
        expect(account).toContain(">EF<");
    });

    test("a single-member household says 1 member; roles read Admin and Member", () => {
        expect(
            v2Html({
                identity: { ...IDENTITY, memberCount: 1, viewerRole: "admin" },
            }),
        ).toContain(">1 member<");
        expect(
            v2Html({ identity: { ...IDENTITY, viewerRole: "member" } }),
        ).toContain('class="fd-sidebar__meta">Member<');
    });

    test("no identity: the sidebar has no account row", () => {
        const html = v2Html({ identity: undefined });
        expect(html).not.toContain("fd-sidebar__account");
        expect(html).toContain("fd-sidebar__household");
    });

    // The shell has no scan button: scanning is a phone action (rule 25), so
    // the barcode-camera flag changes the scan sheet only, never the top bar.
    for (const barcodeCamera of [true, false]) {
        test(`top bar has no scan with barcode-camera ${barcodeCamera ? "on" : "off"}`, () => {
            const html = v2Html({
                flags: { ...FIXTURE_APP_CHROME_FLAGS, barcodeCamera },
            });
            const top = between(
                html,
                /<header class="fd-top-bar"/,
                "</header>",
            );
            expect(top).not.toContain("Scan");
            expect(top).not.toContain("fd-icon--scan");
            expect(top).not.toContain(FD_BARCODE_SCAN_SHEET_ID);
            // The scan sheet stays for pages that open it, camera or not.
            expect(html).toContain(`id="${FD_BARCODE_SCAN_SHEET_ID}"`);
            // No menu of the shell can come out empty: there is none.
            expect(html).not.toContain("fd-menu");
        });
    }

    test("top bar: the search field and Log food open the search sheet, ⌘K hinted", () => {
        const html = v2Html();
        const top = between(html, /<header class="fd-top-bar"/, "</header>");
        const search = between(top, /<div class="fd-search-field/, "</div>");
        expect(search).toContain('data-fd-open-sheet="fd-log-search"');
        expect(search).toContain(
            'placeholder="Search foods, recipes, barcodes"',
        );
        expect(search).toContain(">⌘K</kbd>");
        expect(search).toContain('aria-keyshortcuts="Control+K Meta+K"');
        const log = between(top, /<a class="fd-btn[^"]*"/, "</a>");
        expect(log).toContain(`href="${FD_LOG_HREF}"`);
        expect(log).toContain('data-fd-open-sheet="fd-log-search"');
        expect(log).toContain("Log food");
        expect(top).not.toContain("disabled");
        expect(top).not.toContain("aria-disabled");
    });

    describe("Kitchen text tabs", () => {
        const kitchenNav = (html: string) =>
            between(html, /<nav class="fd-kitchen-tabs"/, "</nav>");

        test("Groceries tab shows the open-line count when chrome carries it", () => {
            const nav = between(
                v2Html({
                    active: "grocery",
                    v2Kitchen: "groceries",
                    v2KitchenGroceriesCount: 8,
                    body: "<h1>Groceries</h1>",
                }),
                /<nav class="fd-kitchen-tabs"/,
                "</nav>",
            );
            expect(nav).toContain("Groceries · 8");
        });

        test("Fridge tab shows the groceries count from chrome", () => {
            const nav = between(
                v2Html({
                    active: "fridge",
                    v2Kitchen: "fridge",
                    v2KitchenGroceriesCount: 4,
                    body: "<h1>Fridge</h1>",
                }),
                /<nav class="fd-kitchen-tabs"/,
                "</nav>",
            );
            expect(nav).toContain("Groceries · 4");
        });

        test("Fridge, Groceries, Usuals as links; the current one is marked", () => {
            const cases: [Partial<AppChrome>, string][] = [
                [{ active: "fridge" }, "/kitchen/fridge"],
                [{ active: "grocery" }, "/kitchen/groceries"],
                [
                    {
                        active: "household",
                        v2Active: "kitchen",
                        v2Kitchen: "usuals",
                    },
                    "/kitchen/usuals",
                ],
            ];
            for (const [over, current] of cases) {
                const nav = kitchenNav(v2Html(over));
                expect(nav).toContain('aria-label="Kitchen sections"');
                expect(
                    [...nav.matchAll(/<a [^>]*href="([^"]+)"/g)].map(
                        (m) => m[1],
                    ),
                ).toEqual([
                    "/kitchen/fridge",
                    "/kitchen/groceries",
                    "/kitchen/usuals",
                ]);
                expect(
                    [...nav.matchAll(/class="fd-kitchen-tab"/g)].length,
                ).toBe(3);
                expect(currentHrefs(nav)).toEqual([current]);
                expect(
                    [...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]),
                ).toEqual(["Fridge", "Groceries", "Usuals"]);
            }
        });

        test("only the Kitchen tab shows them", () => {
            for (const active of [
                "nutrition",
                "recipes",
                "household",
                "none",
            ] as const) {
                expect(v2Html({ active }), active).not.toContain(
                    "fd-kitchen-tab",
                );
            }
        });

        test("they sit directly under the page header, else first in <main>", () => {
            const header = '<header class="dash-head"><h1>Fridge</h1></header>';
            const withHeader = v2Html({
                active: "fridge",
                body: `\n  ${header}\n<p>rest</p>`,
            });
            expect(withHeader).toMatch(
                /<\/header><nav class="fd-kitchen-tabs"[\s\S]*<\/nav>\n<p>rest<\/p><\/main>/,
            );
            const bareH1 = v2Html({
                active: "grocery",
                body: "<h1>Groceries</h1><section>x</section>",
            });
            expect(bareH1).toContain(
                '<h1>Groceries</h1><nav class="fd-kitchen-tabs"',
            );
            expect(bareH1).toContain("</nav><section>x</section></main>");
            const pageHeaderBody = v2Html({
                active: "fridge",
                body: '<header class="fd-page-header fd-x"><div class="fd-page-header__titles"><h1 class="fd-page-header__title">Kitchen</h1></div></header><p>rest</p>',
            });
            expect(pageHeaderBody).toMatch(
                /<\/h1><\/div><\/header><nav class="fd-kitchen-tabs"[\s\S]*<\/nav><p>rest<\/p><\/main>/,
            );
            const none = v2Html({ active: "fridge", body: "<p>x</p>" });
            expect(none).toContain('</a></div><nav class="fd-kitchen-tabs"');
        });
    });

    test("kitchenTabFor defaults from active", () => {
        expect(kitchenTabFor({ active: "grocery" })).toBe("groceries");
        expect(kitchenTabFor({ active: "fridge" })).toBe("fridge");
        expect(
            kitchenTabFor({ active: "household", v2Kitchen: "usuals" }),
        ).toBe("usuals");
    });

    test("fragments name real targets on the nutrition page", () => {
        expect(FD_LOG_MEAL_HASH).toBe("nutrition-log-meal");
        expect(FD_TRENDS_HASH).toBe("trends");
        expect(NAV_BAR_TABS.find((t) => t.id === "trends")?.href).toBe(
            FD_TRENDS_HREF,
        );
    });

    test("no tab or sidebar link carries a notice dot: the bell does", () => {
        const html = v2Html({
            active: "nutrition",
            notificationsUnread: true,
        });
        expect(html).not.toContain("has notices");
        expect(html).not.toContain("-attention");
        expect(html).not.toContain("needs-attention");
        expect(tabsNav(html)).not.toContain("fd-tab-dot-");
        expect(sideNav(html)).not.toContain("fd-side-dot-");
        expect(sideNav(html)).not.toContain("dot");
        // The bell is the one place a new notification shows.
        expect(html).toContain("fd-bell");
    });

    test("untrusted names are escaped", () => {
        const html = v2Html({
            identity: {
                ...IDENTITY,
                viewerName: '<img src=x onerror="a">',
                householdName: "<b>Home</b>",
            },
        });
        expect(html).not.toContain("<img src=x");
        expect(html).not.toContain("<b>Home</b>");
        expect(html).toContain("&lt;b&gt;Home&lt;/b&gt;");
    });

    test("household initial skips a leading The", () => {
        expect(householdInitial("The Flow household")).toBe("F");
        expect(householdInitial("Flows")).toBe("F");
        expect(householdInitial("the")).toBe("T");
        expect(householdInitial("")).toBe("?");
    });

    test("initials", () => {
        expect(initialsOf("Ethan Flow")).toBe("EF");
        expect(initialsOf("ethan")).toBe("E");
        expect(initialsOf("  Mary Jane  Watson ")).toBe("MW");
        expect(initialsOf("")).toBe("?");
        expect(initialsOf("émile zola")).toBe("ÉZ");
    });
});

describe("head and theme chrome", () => {
    test("four tracked assets, old pair first", () => {
        const head = between(v2Html(), /<head>/, "</head>");
        const tags = [
            ...head.matchAll(/<(?:link rel="stylesheet"|script) [^>]*>/g),
        ].map((m) => m[0]);
        expect(tags.length).toBe(4);
        for (const tag of tags) {
            expect(tag).toContain('data-turbo-track="reload"');
        }
        expect(tags[0]).toMatch(/href="\/app\.css/);
        expect(tags[1]).toMatch(/href="\/app-v2\.css/);
        expect(tags[2]).toMatch(/src="\/app\.js/);
        expect(tags[3]).toMatch(/src="\/app-v2\.js/);
    });

    test("page-coloured browser chrome", () => {
        const dark = v2Html({ theme: "dark" });
        expect(dark).not.toContain("foodable-theme-chrome");
        expect(dark).toContain(
            `<meta name="theme-color" content="${THEME_COLOR.dark}" />`,
        );
        const light = v2Html({ theme: "light" });
        expect(light).toContain(
            `<meta name="theme-color" content="${THEME_COLOR.light}" />`,
        );
        const system = v2Html({ theme: "system" });
        expect(system).toContain(
            `<meta name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)" />`,
        );
        expect(system).toContain(
            `<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)" />`,
        );
    });

    test("explicit theme stamps data-theme on <html>, system leaves it off", () => {
        const themes: ThemePref[] = ["light", "dark"];
        for (const t of themes) {
            expect(v2Html({ theme: t })).toContain(
                `<html lang="en" data-theme="${t}">`,
            );
        }
        expect(v2Html({ theme: "system" })).toContain('<html lang="en">');
    });

    test("hashed hrefs once the assets are warmed", async () => {
        await Promise.all([
            getAppCss(),
            getAppJs(),
            getAppV2Css(),
            getAppV2Js(),
        ]);
        const head = between(v2Html(), /<head>/, "</head>");
        for (const href of ["app.css", "app-v2.css", "app.js", "app-v2.js"]) {
            expect(head).toMatch(
                new RegExp(`/${href.replace(".", "\\.")}\\?v=[0-9a-f]{12}"`),
            );
        }
    });
});
