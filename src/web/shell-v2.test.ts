import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";
import {
    legacyShellCases,
    stripAssetHashes,
} from "../test-support/shell-legacy-cases.js";
import { NUTRITION_CARDS } from "../domain/layout.js";
import { THEME_COLOR } from "../tokens.js";
import { getAppCss, getAppJs, getAppV2Css, getAppV2Js } from "../widgets.js";
import { renderSettingsPage as renderSettingsAccountPage } from "./pages/settings.js";
import { renderSettingsHelpPage } from "./pages/settings-help.js";
import { renderHouseholdSettingsPrefsPage } from "./pages/settings-household.js";
import { FD_ICON_PATHS } from "./components/fd-icons.js";
import { NUTRITION_LOG_MEAL_MODAL_ID } from "./pages/nutrition.js";
import {
    FD_LOG_HREF,
    FD_LOG_MEAL_HASH,
    FD_TABS,
    FD_TRENDS_HASH,
    FD_TRENDS_HREF,
    householdInitial,
    initialsOf,
    kitchenTabFor,
    v2ActiveFor,
} from "./shell-v2.js";
import { FD_BARCODE_SCAN_SHEET_ID } from "./pages/v2/log-sheet.js";
import {
    renderAppShell,
    renderBarePage,
    renderLegacyAppShell,
    renderSettingsPage,
    type AppChrome,
    type AppTabId,
    type ShellIdentity,
    type ThemePref,
    type V2NavId,
} from "./shell.js";

const GOLDEN: Record<string, string> = JSON.parse(
    readFileSync(
        join(import.meta.dir, "fixtures/shell-legacy.golden.json"),
        "utf8",
    ),
);

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
        attention: { count: 0, tabs: {} },
        flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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
    between(html, /<nav class="fd-tabs"/, "</nav>");
const sideNav = (html: string) =>
    between(html, /<nav class="fd-sidenav"/, "</nav>");

/** hrefs of the links marked aria-current="page" in a nav's markup. */
function currentHrefs(nav: string): string[] {
    return [...nav.matchAll(/<a [^>]*>/g)]
        .map((m) => m[0])
        .filter((tag) => tag.includes('aria-current="page"'))
        .map((tag) => /href="([^"]+)"/.exec(tag)![1]!);
}

describe("flag off: the old shell is unchanged", () => {
    const cases = legacyShellCases({
        renderAppShell,
        renderBarePage,
        renderSettingsPage,
        renderSettingsAccountPage,
        renderSettingsHelpPage,
        renderHouseholdSettingsPrefsPage,
    });

    test("every golden case renders the exact bytes main rendered", () => {
        expect(Object.keys(cases).sort()).toEqual(Object.keys(GOLDEN).sort());
        for (const [name, html] of Object.entries(cases)) {
            expect(stripAssetHashes(html), name).toBe(GOLDEN[name]!);
        }
    });

    test("renderAppShell with the flag off is renderLegacyAppShell", () => {
        const chrome = v2Chrome({
            flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: false },
        });
        expect(renderAppShell(chrome)).toBe(renderLegacyAppShell(chrome));
    });

    test("the old shell never carries a v2 marker", () => {
        for (const html of Object.values(cases)) {
            expect(html).not.toContain("fd-");
            expect(html).not.toContain("app-v2");
        }
    });
});

describe("flag on: the new shell", () => {
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
        expect(html).toContain('<header class="fd-topbar">');
        const pageHeaders = [...html.matchAll(/<header class="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((cls) => cls === "fd-topbar");
        expect(pageHeaders).toEqual(["fd-topbar"]);
        expect(html).not.toContain("fd-phonebar");
        expect(html).not.toContain("<aside");
        expect(html).toContain('<div class="fd-sidebar">');
        expect(html).toContain(
            '<main class="app-main native fd-main"><a class="fd-account-chip"',
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
            "fd-household",
            "fd-sidenav",
            "fd-sidelink",
            "fd-sidelink-settings",
            "fd-side-dot",
            "fd-account",
            "fd-account-chip",
            "fd-topbar",
            "fd-search",
            "fd-scan",
            "fd-logfood",
            "fd-tabs",
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
            "Search and log food",
            "Recipes",
            "Trends",
        ]);
        expect(nav).toContain('class="fd-log"');
        expect(nav.match(/class="fd-tab"/g)?.length).toBe(4);
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

    test("account chip links to Settings, with the viewer's initials", () => {
        const html = v2Html();
        const chip = between(html, /<a class="fd-account-chip"/, "</a>");
        expect(chip).toContain('href="/settings"');
        expect(chip).toContain('data-turbo="false"');
        expect(chip).toContain(
            'aria-label="Settings, signed in as Ethan Flow"',
        );
        expect(chip).toContain(">EF</a>");
    });

    test("sidebar: Kitchen sections show under Kitchen only while it is active", () => {
        const subs = (html: string) =>
            [
                ...sideNav(html).matchAll(
                    /<a class="fd-sidesub" href="([^"]+)"( aria-current="page")?>([^<]+)</g,
                ),
            ].map((m) => [m[1], m[3], m[2] ? "current" : ""]);
        expect(subs(v2Html({ active: "nutrition" }))).toEqual([]);
        expect(subs(v2Html({ active: "recipes" }))).toEqual([]);
        expect(subs(v2Html({ active: "fridge" }))).toEqual([
            ["/kitchen/fridge", "Overview", "current"],
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
            '<a class="fd-sidelink" href="/kitchen/fridge" aria-current="true">',
        );
        // Directly after the Kitchen link, before Recipes.
        expect(sideNav(v2Html({ active: "fridge" }))).toMatch(
            />Kitchen<\/span>[^]*?<\/a><a class="fd-sidesub"[^]*?Usuals<\/a><a class="fd-sidelink" href="\/recipes"/,
        );
    });

    test("sidebar: household block, nav, Settings, account", () => {
        const html = v2Html();
        const household = between(html, /<a class="fd-household"/, "</a>");
        expect(household).toContain('href="/settings/household"');
        expect(household).toContain("The Flow household, 3 members");
        expect(html).toContain('class="fd-household-name">The Flow household<');
        expect(html).toContain('class="fd-household-meta">3 members<');
        expect(html).toContain('class="fd-avatar" aria-hidden="true">F<');
        const side = sideNav(html);
        expect(
            [...side.matchAll(/class="fd-sidelink-label">([^<]+)</g)].map(
                (m) => m[1],
            ),
        ).toEqual(["Today", "Kitchen", "Recipes", "Trends", "Settings"]);
        const settings = between(
            side,
            /<a class="fd-sidelink fd-sidelink-settings"/,
            "</a>",
        );
        expect(settings).toContain('href="/settings"');
        expect(settings).toContain('data-turbo="false"');
        const account = between(html, /<a class="fd-account"/, "</a>");
        expect(account).toContain('href="/settings"');
        expect(account).toContain('data-turbo="false"');
        expect(account).toContain('class="fd-account-name">Ethan Flow<');
        expect(account).toContain('class="fd-account-role">Owner<');
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
        ).toContain('class="fd-account-role">Member<');
    });

    test("top bar omits scan when barcode-camera is off", () => {
        const html = v2Html({
            flags: {
                ...FIXTURE_APP_CHROME_FLAGS,
                uiV2: true,
                barcodeCamera: false,
            },
        });
        const top = between(html, /<header class="fd-topbar"/, "</header>");
        expect(top).not.toContain("fd-scan");
    });

    test("top bar: search, scan and Log food are plain links", () => {
        const html = v2Html();
        const top = between(html, /<header class="fd-topbar"/, "</header>");
        const search = between(top, /<a class="fd-search"/, "</a>");
        expect(search).toContain(`href="${FD_LOG_HREF}"`);
        expect(search).toContain("Search foods, recipes, barcodes");
        expect(search).toContain(
            '<kbd class="fd-kbd" aria-hidden="true">⌘K</kbd>',
        );
        const scan = between(top, /<a class="fd-scan"/, "</a>");
        expect(scan).toContain(`href="${FD_LOG_HREF}"`);
        expect(scan).toContain('aria-label="Scan a barcode"');
        expect(scan).toContain(
            `data-fd-open-sheet="${FD_BARCODE_SCAN_SHEET_ID}"`,
        );
        const log = between(top, /<a class="fd-logfood"/, "</a>");
        expect(log).toContain(`href="${FD_LOG_HREF}"`);
        expect(log).toContain('data-fd-open-sheet="fd-log-search"');
        expect(log).toContain("<span>Log food</span>");
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
            const none = v2Html({ active: "fridge", body: "<p>x</p>" });
            expect(none).toContain(
                '"><a class="fd-account-chip" href="/settings" data-turbo="false" aria-label="Settings, signed in as Ethan Flow" title="Settings">EF</a><nav class="fd-kitchen-tabs"',
            );
        });

        test("the old shell never gets them", () => {
            for (const html of Object.values(
                legacyShellCases({
                    renderAppShell,
                    renderBarePage,
                    renderSettingsPage,
                    renderSettingsAccountPage,
                    renderSettingsHelpPage,
                    renderHouseholdSettingsPrefsPage,
                }),
            )) {
                expect(html).not.toContain("fd-kitchen");
            }
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
        expect(FD_LOG_MEAL_HASH).toBe(NUTRITION_LOG_MEAL_MODAL_ID);
        expect(NUTRITION_CARDS as readonly string[]).toContain(FD_TRENDS_HASH);
        expect(FD_TABS.find((t) => t.id === "trends")?.href).toBe(
            FD_TRENDS_HREF,
        );
    });

    test("attention dots: warn dot on the tab, no badge", () => {
        const html = v2Html({
            active: "nutrition",
            attention: { count: 3, tabs: { fridge: true, household: true } },
        });
        const tabs = tabsNav(html);
        expect(tabs).toContain('aria-label="Kitchen, has notices"');
        expect(tabs).toContain('class="fd-tab-dot fd-tab-dot-attention"');
        expect(tabs.match(/fd-tab-dot-attention/g)?.length).toBe(1);
        expect(sideNav(html)).toContain('aria-label="Settings, has notices"');
        expect(html).not.toContain("app-bar-attention");
        expect(html).not.toContain("needs-attention");
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

    test("the old shell's assets are tracked too", () => {
        const html = renderLegacyAppShell(
            v2Chrome({ flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: false } }),
        );
        const tags = [
            ...html.matchAll(/<(?:link rel="stylesheet"|script) [^>]*>/g),
        ].map((m) => m[0]);
        expect(tags.length).toBe(2);
        for (const tag of tags) {
            expect(tag).toContain('data-turbo-track="reload"');
        }
    });

    test("page-coloured browser chrome, and the meta says so", () => {
        const dark = v2Html({ theme: "dark" });
        expect(dark).toContain(
            '<meta name="foodable-theme-chrome" content="page" />',
        );
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

describe("Settings sub-nav under ui-v2", () => {
    const view = {
        chrome: { theme: "dark" as const },
        backHref: "/kitchen/fridge",
        displayName: "Ethan",
        timezone: "",
        weightUnit: "" as const,
        widgetsEnabled: true,
        alcoholTrackingEnabled: false,
        drinkUnit: "" as const,
    };
    const labels = (html: string) =>
        [
            ...between(html, /<nav class="subnav"/, "</nav>").matchAll(
                /<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g,
            ),
        ].map((m) => `${m[2]} ${m[1]}`);
    const on = { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true };

    test("flag on: legacy household prefs still expose v2 sub-nav", () => {
        const expected = [
            "Account /settings?from=%2Fkitchen%2Ffridge",
            "Household /settings/household-settings?from=%2Fkitchen%2Ffridge",
            "Members /settings/household?from=%2Fkitchen%2Ffridge",
            "Help /settings/help?from=%2Fkitchen%2Ffridge",
        ];
        expect(
            labels(
                renderSettingsHelpPage({
                    chrome: view.chrome,
                    backHref: view.backHref,
                    flags: on,
                }),
            ),
        ).toEqual(expected);
        const prefs = renderHouseholdSettingsPrefsPage({
            chrome: view.chrome,
            backHref: view.backHref,
            flags: on,
            member: { userId: "u1", householdId: "h1", role: "owner" } as never,
            preferences: {
                timezone: null,
                restock: { enabled: false, weekday: 0, time: "09:00" },
            } as never,
            ownerTimezoneLabel: "UTC",
        });
        expect(labels(prefs)).toEqual(expected);
    });

    test("flag off, or no flags: the three old entries", () => {
        const old = [
            "Account /settings?from=%2Fkitchen%2Ffridge",
            "Household /settings/household-settings?from=%2Fkitchen%2Ffridge",
            "Help /settings/help?from=%2Fkitchen%2Ffridge",
        ];
        expect(labels(renderSettingsAccountPage(view))).toEqual(old);
        expect(
            labels(
                renderSettingsAccountPage({
                    ...view,
                    flags: FIXTURE_APP_CHROME_FLAGS,
                }),
            ),
        ).toEqual(old);
    });
});
