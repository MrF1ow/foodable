import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { renderSettingsHomeV2Page } from "./settings-home.js";
import { APP_PATHS } from "../../route-map.js";
import { STORES_PATH } from "./settings-stores.js";
import {
    renderSettingsV2Page,
    SETTINGS_V2_MENU_LABELS,
    settingsField,
    settingsMenuIcon,
} from "./settings-shared.js";
import {
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";

const settingsCss = await Bun.file(
    new URL("../../../../public/app/v2/settings.css", import.meta.url),
).text();

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

describe("settings home v2", () => {
    test("inline theme control marks the stored theme and returns home", () => {
        const html = renderSettingsHomeV2Page({
            chrome,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
            storedTheme: "dark",
        });
        expect(html).toMatch(
            /value="dark" class="fd-settings-theme-btn fd-settings-theme-btn--on"/,
        );
        expect(html).not.toMatch(/value="system" class="[^"]*--on/);
        expect(html).toContain('name="return" value="/settings"');
    });

    test("profile card, menu rows, and v2 shell", () => {
        const html = renderSettingsHomeV2Page({
            chrome,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
        });
        expect(html).toContain("fd-settings");
        expect(html).toContain('data-fd-settings-page="home"');
        expect(html).toContain("Ethan Flow");
        expect(html).toContain("ethan@example.com");
        expect(html).toContain('href="/settings/account"');
        expect(html).toContain('href="/settings/display"');
        expect(html).toContain("Household &amp; members");
        expect(html).toContain("fd-settings-menu__icon");
        expect(html).toContain("fd-settings-profile__row");
        expect(html).toContain("fd-settings-phone-top");
        expect(html).toContain('class="fd-settings-phone-back"');
        expect(html).toContain('action="/settings/display"');
        expect(html).toContain("fd-settings-theme-seg");
        expect(html).toContain('href="/settings/help"');
        expect(html).toContain('href="/settings/goals"');
        expect(html).toContain('href="/settings/saved"');
        expect(html).toContain('href="/settings/export"');
        expect(html).toContain('href="/settings/ai-connections"');
        for (const label of SETTINGS_V2_MENU_LABELS) {
            const needle =
                label === "Saved foods & recipes"
                    ? "Saved foods &amp; recipes"
                    : label === "Household & members"
                      ? "Household &amp; members"
                      : label;
            expect(html).toContain(needle);
        }
        expect(html).not.toContain("nav subnav");
        // Settings is where the chip points: it is left out of its own pages.
        expect(html).not.toContain("fd-account-chip");
    });

    test("desktop home pane is hidden on phone in settings.css", () => {
        expect(settingsCss).toMatch(
            /\.fd-settings-home-pane\s*\{[^}]*display:\s*none/,
        );
    });

    test("desktop home pane markup on home", () => {
        const html = renderSettingsHomeV2Page({
            chrome,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
        });
        expect(html).toContain("fd-settings-home-pane");
        expect(html).toContain("fd-settings-desktop-banner");
        expect(html).toContain("Household, people and preferences");
        expect(html).toContain("fd-settings-columns");
    });
});

/** Rows of each rendered nav, as [label, href] pairs. */
async function navRows(
    html: string,
    navClass: string,
): Promise<{ label: string; href: string; current: boolean }[]> {
    const nav = html.slice(html.indexOf(`fd-settings-menu ${navClass}`));
    const end = nav.indexOf("</nav>");
    const fragment = nav.slice(0, end);
    const rows: { label: string; href: string; current: boolean }[] = [];
    for (const m of fragment.matchAll(
        /<a class="fd-settings-menu__link[^"]*" href="([^"]+)"( aria-current="page")?>.*?<span class="fd-settings-menu__label">([^<]*)<\/span>/gs,
    )) {
        rows.push({
            href: m[1]!,
            current: m[2] !== undefined,
            label: m[3]!.replaceAll("&amp;", "&"),
        });
    }
    return rows;
}

describe("settings menu groups", () => {
    test("phone menu: ungrouped rows, then Preferences, then Connect", async () => {
        const html = renderSettingsHomeV2Page({
            chrome,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
        });
        const phone = html.slice(
            html.indexOf("fd-settings-menu fd-settings-menu--phone"),
            html.indexOf("fd-settings-menu fd-settings-menu--desktop"),
        );
        // Group labels, in order, once each.
        const labels = [
            ...phone.matchAll(/fd-settings-menu__group-label">([^<]*)<\/p>/g),
        ].map((m) => m[1]);
        expect(labels).toEqual(["Preferences", "Connect"]);
        // Three lists: the ungrouped one, Preferences, Connect.
        const lists = phone
            .split('<ul class="fd-settings-menu__list">')
            .slice(1);
        expect(lists).toHaveLength(3);
        const rowsOf = (chunk: string) =>
            [
                ...chunk.matchAll(
                    /<span class="fd-settings-menu__label">([^<]*)<\/span>/g,
                ),
            ].map((m) => m[1]!.replaceAll("&amp;", "&"));
        expect(rowsOf(lists[0]!)).toEqual([
            "Account",
            "Household & members",
            "Goals",
            "Saved foods & recipes",
        ]);
        expect(rowsOf(lists[1]!)).toEqual([
            "Display",
            "Units",
            "Nutrients shown",
            "Product score",
            "Notifications",
        ]);
        expect(rowsOf(lists[2]!)).toEqual([
            "AI connections",
            "Export data",
            "Help",
        ]);
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
            "/settings/export",
            "/settings/help",
        ]) {
            expect(phone).toContain(`href="${href}"`);
        }
        // Product score left the ungrouped list.
        expect(lists[0]).not.toContain("Product score");
    });

    test("desktop nav lists the rows in the design's order", async () => {
        const html = renderSettingsHomeV2Page({
            chrome,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
        });
        const rows = await navRows(html, "fd-settings-menu--desktop");
        expect(rows.map((r) => r.label)).toEqual([
            "Account",
            "Household",
            "Stores",
            "Goals",
            "Saved foods & recipes",
            "Product score",
            "Display",
            "Units & nutrients",
            "Notifications",
            "AI connections",
            "Export data",
            "Help",
        ]);
        expect(rows.map((r) => r.href)).toEqual([
            "/settings/account",
            "/settings/household",
            "/settings/household/stores",
            "/settings/goals",
            "/settings/saved",
            "/settings/product-score",
            "/settings/display",
            "/settings/units",
            "/settings/notifications",
            "/settings/ai-connections",
            "/settings/export",
            "/settings/help",
        ]);
        expect(rows.some((r) => r.current)).toBe(false);
    });

    test("the Stores nav row points at the Stores page", () => {
        expect(APP_PATHS.settingsStores).toBe(STORES_PATH);
    });

    test("Units & nutrients is current on both of its pages", async () => {
        for (const page of ["units", "nutrients"] as const) {
            const html = renderSettingsV2Page({
                chrome,
                page,
                title: "Units",
                body: "<p>body</p>",
            });
            const rows = await navRows(html, "fd-settings-menu--desktop");
            expect(rows.filter((r) => r.current).map((r) => r.label)).toEqual([
                "Units & nutrients",
            ]);
        }
    });

    test("Notifications is current on its own page, in the phone menu and the desktop nav", async () => {
        const html = renderSettingsV2Page({
            chrome,
            page: "notifications",
            title: "Notifications",
            body: "<p>body</p>",
        });
        const rows = await navRows(html, "fd-settings-menu--desktop");
        expect(rows.filter((r) => r.current).map((r) => r.label)).toEqual([
            "Notifications",
        ]);
        const phone = await navRows(html, "fd-settings-menu--phone");
        expect(phone.filter((r) => r.current).map((r) => r.label)).toEqual([
            "Notifications",
        ]);
    });

    test("Stores is current on the stores section, Household is not", async () => {
        const html = renderSettingsV2Page({
            chrome,
            page: "stores",
            title: "Stores",
            body: "<p>body</p>",
        });
        const rows = await navRows(html, "fd-settings-menu--desktop");
        expect(rows.filter((r) => r.current).map((r) => r.label)).toEqual([
            "Stores",
        ]);
    });

    test("settings.css shows one nav per width and hides the other", () => {
        expect(settingsCss).toMatch(
            /\.fd-settings-menu--desktop\s*\{[^}]*display:\s*none/,
        );
        expect(settingsCss).toMatch(
            /\.fd-settings-aside \.fd-settings-menu--phone\s*\{[^}]*display:\s*none/,
        );
        expect(settingsCss).toMatch(
            /\.fd-settings-aside \.fd-settings-menu--desktop\s*\{[^}]*display:\s*block/,
        );
    });
});

describe("settings shared markup", () => {
    test("settingsField names its control by the label id, whatever the id holds", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            // An id built from a row's own id (a section, a rule) is data.
            const html = String(
                settingsField({
                    id: payload,
                    label: "Name",
                    control: '<input class="x" name="name" />',
                }),
            );
            expect(await injectedAttributes(html)).toEqual([]);
            const control = html.slice(html.indexOf("<input"));
            const names: string[] = [];
            await new HTMLRewriter()
                .on("input", {
                    element(el) {
                        for (const [name] of el.attributes) names.push(name);
                    },
                })
                .transform(new Response(control))
                .text();
            expect(names).toEqual(["aria-labelledby", "class", "name"]);
        }
    });

    test("settingsMenuIcon carries the class its caller styles it by", () => {
        expect(settingsMenuIcon("user")).toContain(
            'class="fd-icon fd-settings-menu__icon"',
        );
        const row = settingsMenuIcon("code", "fd-settings-ai__icon");
        expect(row).toContain('class="fd-icon fd-settings-ai__icon"');
        expect(row).not.toContain("fd-settings-menu__icon");
    });
});
