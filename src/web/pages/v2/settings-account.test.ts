import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { renderSettingsAccountV2Page } from "./settings-account.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

describe("settings account v2", () => {
    test("account form keeps turbo off and nutrition prefs", () => {
        const html = renderSettingsAccountV2Page({
            chrome,
            backHref: "/kitchen/fridge",
            displayName: "Ethan",
            timezone: "America/Los_Angeles",
            weightUnit: "kg",
            widgetsEnabled: true,
            alcoholTrackingEnabled: false,
            drinkUnit: "",
        });
        expect(html).toContain('data-fd-settings-page="account"');
        expect(html).toContain('data-turbo="false"');
        expect(html).toContain('action="/settings"');
        expect(html).toContain('name="group" value="account"');
        expect(html).toContain('name="group" value="nutrition"');
        expect(html).toContain('name="display_name"');
        expect(html).not.toContain('name="theme"');
        expect(html).toContain('class="fd-settings-back"');
        expect(html).toContain('href="/settings"');
        expect(html).toContain('class="fd-settings-phone-top"');
        expect(html).toMatch(
            /class="fd-settings-phone-back"[^>]*href="\/settings"/,
        );
    });
});
