import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { renderSettingsHomeV2Page } from "./settings-home.js";
import { SETTINGS_V2_MENU_LABELS } from "./settings-shared.js";

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
        expect(html).toContain('href="/settings/help"');
        expect(html).toContain('href="/settings/goals"');
        expect(html).toContain('href="/settings/saved"');
        expect(html).toContain('href="/settings/export"');
        for (const label of SETTINGS_V2_MENU_LABELS) {
            const needle =
                label === "Saved foods & recipes"
                    ? "Saved foods &amp; recipes"
                    : label;
            expect(html).toContain(needle);
        }
        expect(html).not.toContain("nav subnav");
        expect(html).toContain("fd-account-chip");
    });

    test("household card is hidden on phone in settings.css", () => {
        expect(settingsCss).toMatch(
            /\.fd-settings\[data-fd-settings-page="home"\][\s\S]*?\.fd-settings-main[\s\S]*?\.fd-settings-card--household\s*\{[^}]*display:\s*none/,
        );
    });
});
