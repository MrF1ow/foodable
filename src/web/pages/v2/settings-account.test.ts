import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { renderSettingsAccountV2Page } from "./settings-account.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

const view = {
    chrome,
    backHref: "/kitchen/fridge",
    displayName: "Ethan",
    email: "ethan@example.com" as string | null,
    timezone: "America/Los_Angeles",
    photo: { userId: "u1", version: null },
};

describe("settings account v2", () => {
    test("account page is one card of Name, Email and Time zone rows, a Security card with Log out, and no unit, alcohol or widget fields", () => {
        const html = renderSettingsAccountV2Page(view);
        expect(html).toContain('data-fd-settings-page="account"');
        expect(html).toContain(">Photo<");
        // The rows sit in the card scope that styles them (F19).
        expect(html).toContain("fd-settings-hh");
        expect(html).toContain("fd-list--card");
        // Name and Time zone are rows that open edit sheets.
        expect(html).toMatch(
            /commandfor="fd-account-name" command="show-modal"[\s\S]*?Name[\s\S]*?Ethan/,
        );
        expect(html).toMatch(
            /commandfor="fd-account-timezone" command="show-modal"[\s\S]*?Time zone[\s\S]*?America\/Los_Angeles/,
        );
        expect(html).toContain('name="display_name"');
        // Email: shown as text, never an input, and not a sheet trigger.
        expect(html).toContain(">Email<");
        expect(html).toContain("ethan@example.com");
        expect(html).not.toMatch(/<input[^>]*ethan@example\.com/);
        expect(html).not.toMatch(/name="email"/);
        expect(html).not.toMatch(/commandfor="fd-account-email"/);
        // Time zone: a select that posts group=nutrition + timezone.
        expect(html).toMatch(/<select[^>]*name="timezone"/);
        expect(html).toContain('name="group" value="nutrition"');
        expect(html).toContain('<option value="America/Los_Angeles" selected>');
        // Security card: Log out, red, no Save buttons outside sheets.
        expect(html).toContain(">Security<");
        expect(html).toMatch(/<a [^>]*href="\/logout"[^>]*>[\s\S]*?Log out/);
        expect(html).not.toContain("Save name");
        expect(html).not.toContain("Save time zone");
        expect(html).not.toContain("Change password");
        // The moved fields are gone, markers included.
        for (const gone of [
            "preferred_weight_unit",
            "preferred_drink_unit",
            "widgets_enabled",
            "alcohol_tracking_enabled",
            "has_widgets_enabled",
            "has_alcohol_tracking_enabled",
            "Weight unit",
            "Drink unit",
            "in-chat widgets",
            "Alcohol tracking",
        ]) {
            expect(html).not.toContain(gone);
        }
        expect(html).not.toContain('name="theme"');
        expect(html).toContain('class="fd-settings-back"');
        expect(html).toMatch(
            /class="fd-settings-phone-back"[^>]*href="\/settings"/,
        );
    });

    test("the account forms and the logout link keep data-turbo=false", () => {
        const html = renderSettingsAccountV2Page(view);
        const forms = html.match(/<form [^>]*action="\/settings"[^>]*>/g) ?? [];
        expect(forms).toHaveLength(2);
        for (const form of forms) expect(form).toContain('data-turbo="false"');
        expect(html).toMatch(/<a [^>]*href="\/logout"[^>]*data-turbo="false"/);
    });

    test("no email known shows no Email row", () => {
        const html = renderSettingsAccountV2Page({ ...view, email: null });
        expect(html).not.toContain(">Email<");
    });

    test("time zone picker keeps an alias the runtime does not list", () => {
        const alias = renderSettingsAccountV2Page({
            ...view,
            timezone: "US/Pacific",
        });
        expect(alias).toContain('<option value="US/Pacific" selected>');
    });

    test("Not set is offered only when no zone is stored", () => {
        const none = renderSettingsAccountV2Page({ ...view, timezone: "" });
        expect(none).toContain('<option value="" selected>Not set</option>');
        const stored = renderSettingsAccountV2Page(view);
        expect(stored).not.toContain('<option value=""');
        expect(stored).not.toContain(">Not set<");
    });

    test("an error for a sheet reopens that sheet and shows inside it, not as a page banner", () => {
        const html = renderSettingsAccountV2Page({
            ...view,
            error: "Choose a time zone from the list.",
            openSheetId: "fd-account-timezone",
        });
        expect(html.match(/Choose a time zone from the list\./g)).toHaveLength(
            1,
        );
        expect(html).toMatch(
            /<dialog[^>]*id="fd-account-timezone"[^>]*data-sheet-open-on-load|<dialog[^>]*data-sheet-open-on-load[^>]*id="fd-account-timezone"/,
        );
        const banner = renderSettingsAccountV2Page({
            ...view,
            error: "That photo is too large.",
        });
        expect(banner.match(/That photo is too large\./g)).toHaveLength(1);
    });
});
