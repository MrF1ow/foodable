import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { renderSettingsHomeV2Page } from "./settings-home.js";
import {
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
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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
        expect(html).toContain("fd-account-chip");
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
