import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    isValidDisplayTheme,
    renderSettingsHomeV2Page,
    themeChoiceValue,
} from "./settings-home.js";
import { APP_PATHS } from "../../route-map.js";
import { STORES_PATH } from "./settings-stores.js";
import {
    renderSettingsV2Page,
    SETTINGS_DESKTOP_NAV_LABELS,
} from "./settings-shared.js";

const chrome = {
    theme: "dark" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

const view = {
    chrome,
    displayName: "Ethan Flow",
    email: "ethan@example.com",
};

/** The labels of a list group's rows, in order. */
function rowLabels(html: string): string[] {
    return [
        ...html.matchAll(/<span class="fd-item-row__title"[^>]*>([^<]*)</g),
    ].map((m) => m[1]!.replaceAll("&amp;", "&"));
}

/** The links of the desktop menu, as [label, href, current]. */
function menuRows(html: string) {
    const nav = html.slice(html.indexOf('<nav class="fd-settings-menu"'));
    const fragment = nav.slice(0, nav.indexOf("</nav>"));
    return [
        ...fragment.matchAll(
            /<a class="fd-side-link[^"]*" href="([^"]+)"( aria-current="page")?>.*?<span class="fd-side-link__label">([^<]*)<\/span>/gs,
        ),
    ].map((m) => ({
        href: m[1]!,
        current: m[2] !== undefined,
        label: m[3]!.replaceAll("&amp;", "&"),
    }));
}

describe("settings home v2", () => {
    test("a Detail bar over the profile card, then the rows, inside the shell", () => {
        const html = renderSettingsHomeV2Page(view);
        expect(html).toContain('data-fd-settings-page="home"');
        // Phone: Detail bar back to Today, title centred.
        expect(html).toMatch(
            /<header class="fd-detail-bar fd-settings-detail">[\s\S]*?aria-label="Back" href="\/"[\s\S]*?<h1 class="fd-detail-bar__title">Settings<\/h1>/,
        );
        // Desktop: a Page layout of two columns with the title above them.
        expect(html).toContain("fd-page-layout--two-columns");
        expect(html).toContain('<h1 class="fd-settings-page-title">Settings');
        // The profile card from the component, with the identity fields.
        expect(html).toContain("fd-profile-card");
        expect(html).toContain("Ethan Flow");
        expect(html).toContain("ethan@example.com");
        expect(html).toMatch(/Household<\/dt><dd[^>]*>Flow</);
        expect(html).toMatch(/Members<\/dt><dd[^>]*>2</);
        expect(html).toMatch(/Role<\/dt><dd[^>]*>Owner</);
        // Settings is where the chip points: it is left out of its own pages.
        expect(html).not.toContain("fd-account-chip");
    });

    test("the rows, in the design's three lists", () => {
        // The page's own lists: the search sheet after the shell has a list of
        // its own (the results), which is not one of the three.
        const html =
            renderSettingsHomeV2Page(view).split('id="fd-log-search"')[0]!;
        const lists = html.split('<ul class="fd-list-group"').slice(1);
        expect(lists).toHaveLength(3);
        expect(rowLabels(lists[0]!)).toEqual([
            "Account",
            "Household & members",
            "Goals",
            "Saved foods & recipes",
        ]);
        expect(rowLabels(lists[1]!)).toEqual([
            "Display",
            "Units",
            "Nutrients shown",
            "Product score",
            "Notifications",
        ]);
        expect(rowLabels(lists[2]!)).toEqual([
            "AI connections",
            "Help",
            "Export data",
        ]);
        const headers = [
            ...html.matchAll(/fd-section-header__label">([^<]*)</g),
        ].map((m) => m[1]);
        expect(headers).toEqual(["Preferences", "Connect"]);
        for (const href of [
            "/settings/account",
            "/settings/household",
            "/settings/goals",
            "/settings/saved",
            "/settings/units",
            "/settings/nutrients",
            "/settings/product-score",
            "/settings/notifications",
            "/settings/ai-connections",
            "/settings/help",
        ]) {
            expect(html).toContain(`href="${href}"`);
        }
        // The member count sits on the Household row.
        expect(html).toMatch(
            /Household &amp; members<\/span><\/span><\/span><span class="fd-item-row__value">2</,
        );
        // Display and Export data live here, not on pages of their own.
        expect(html).not.toContain('href="/settings/display"');
        expect(html).not.toContain('href="/settings/export"');
        // Nothing explains itself: no intro, no help under a row.
        expect(html).not.toContain("fd-item-row__subtitle");
        expect(html).not.toContain("Household, people and preferences");
    });

    test("Display is a Segmented control that saves itself over Turbo and returns here", () => {
        const html = renderSettingsHomeV2Page({ ...view, storedTheme: "dark" });
        const form = html.match(
            /<form class="fd-inline-form fd-settings-display"[^>]*>/,
        )?.[0];
        expect(form).toContain('action="/settings/display"');
        expect(form).toContain('data-fd-autosave="form"');
        expect(form).not.toContain("data-turbo");
        // The route always lands on Settings: nothing is posted to say so.
        expect(form).not.toContain("return");
        expect(html).not.toContain('name="return"');
        expect(html).toContain(
            '<input class="fd-segmented__input" type="radio" name="theme" value="dark" checked>',
        );
        expect(html).toContain('type="radio" name="theme" value="system">');
        expect(html).toContain('type="radio" name="theme" value="light">');
        // Auto when nothing is stored.
        const auto = renderSettingsHomeV2Page(view);
        expect(auto).toContain(
            '<input class="fd-segmented__input" type="radio" name="theme" value="system" checked>',
        );
    });

    test("Export data posts and is the one full load on the page", () => {
        const html = renderSettingsHomeV2Page(view);
        expect(html).toContain(
            '<form class="fd-inline-form" method="post" action="/settings/export" data-turbo="false">',
        );
        expect(html).toContain('<span class="fd-item-row__value">ZIP</span>');
        // Every other link and form on the page is Turbo's.
        expect(html.match(/data-turbo="false"/g)).toHaveLength(1);
    });

    test("a refused Display or Export post is said above the lists", () => {
        const html = renderSettingsHomeV2Page({
            ...view,
            error: "Nothing to export yet.",
        });
        expect(html).toContain('role="alert"');
        expect(html.indexOf('role="alert"')).toBeLessThan(
            html.indexOf("fd-list-group"),
        );
    });

    test("the stored theme maps to a choice, and only three are valid", () => {
        expect(themeChoiceValue("light")).toBe("light");
        expect(themeChoiceValue("dark")).toBe("dark");
        expect(themeChoiceValue(null)).toBe("system");
        expect(themeChoiceValue("sepia")).toBe("system");
        expect(isValidDisplayTheme("system")).toBe(true);
        expect(isValidDisplayTheme("sepia")).toBe(false);
    });

    test("the picture, when the member has one, is in the profile card", () => {
        const html = renderSettingsHomeV2Page({
            ...view,
            chrome: {
                ...chrome,
                identity: {
                    ...chrome.identity,
                    viewerUserId: "u1",
                    avatarVersions: new Map([["u1", new Date(1700000000000)]]),
                },
            },
        });
        expect(html).toContain('src="/avatars/u1?v=1700000000000"');
        expect(html).toContain("fd-avatar fd-avatar-initials fd-avatar--photo");
    });
});

describe("the Settings menu beside a sub page", () => {
    const page = (
        section: Parameters<typeof renderSettingsV2Page>[0]["page"],
    ) =>
        renderSettingsV2Page({
            chrome,
            page: section,
            title: "Title",
            body: "<p>body</p>",
        });

    test("lists the design's ten rows in order, with no Display, Export or Stores", () => {
        const rows = menuRows(page("account"));
        expect(rows.map((r) => r.label)).toEqual([
            "Account",
            "Household & members",
            "Goals",
            "Saved foods & recipes",
            "Units",
            "Nutrients shown",
            "Product score",
            "Notifications",
            "AI connections",
            "Help",
        ]);
        expect(rows.map((r) => r.label)).toEqual([
            ...SETTINGS_DESKTOP_NAV_LABELS,
        ]);
        expect(rows.map((r) => r.href)).toEqual([
            "/settings/account",
            "/settings/household",
            "/settings/goals",
            "/settings/saved",
            "/settings/units",
            "/settings/nutrients",
            "/settings/product-score",
            "/settings/notifications",
            "/settings/ai-connections",
            "/settings/help",
        ]);
    });

    test("the page's own row is current: Stores under Household, the time zone under Account", () => {
        const current = (section: Parameters<typeof page>[0]) =>
            menuRows(page(section))
                .filter((r) => r.current)
                .map((r) => r.label);
        expect(current("account")).toEqual(["Account"]);
        expect(current("timezone")).toEqual(["Account"]);
        expect(current("household")).toEqual(["Household & members"]);
        expect(current("stores")).toEqual(["Household & members"]);
        expect(current("units")).toEqual(["Units"]);
        expect(current("nutrients")).toEqual(["Nutrients shown"]);
        expect(current("notifications")).toEqual(["Notifications"]);
        expect(current("help")).toEqual(["Help"]);
    });

    test("the Stores page is the one the Household page links to", () => {
        expect(APP_PATHS.settingsStores).toBe(STORES_PATH);
    });

    test("a Detail bar goes back to Settings, or where the page says", () => {
        expect(page("account")).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings"/,
        );
        const elsewhere = renderSettingsV2Page({
            chrome,
            page: "stores",
            title: "Stores",
            backHref: "/settings/household",
            backLabel: "Back to household",
            body: "<p>body</p>",
        });
        expect(elsewhere).toMatch(
            /aria-label="Back to household" href="\/settings\/household"/,
        );
        // The Settings layout puts the page in the 240 + 640 layout.
        expect(page("account")).toContain("fd-page-layout--settings");
    });

    test("no Settings link, back link or menu link opts out of Turbo", () => {
        expect(page("account")).not.toContain('data-turbo="false"');
    });
});
