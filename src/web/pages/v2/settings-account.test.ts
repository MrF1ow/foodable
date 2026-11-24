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
    test("a Detail bar, then Name, Email and Time zone rows, then Security with Log out", () => {
        const html = renderSettingsAccountV2Page(view);
        expect(html).toContain('data-fd-settings-page="account"');
        expect(html).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings"[\s\S]*?fd-detail-bar__title">Account</,
        );
        // Desktop: the Settings layout with the title above it.
        expect(html).toContain("fd-page-layout--settings");
        expect(html).toContain('<h1 class="fd-settings-page-title">Account');
        // Name opens its sheet and shows the name, with a chevron.
        expect(html).toMatch(
            /commandfor="fd-account-name" command="show-modal"[\s\S]*?>Name<[\s\S]*?fd-item-row__value">Ethan<[\s\S]*?fd-item-row__chevron/,
        );
        // Email is text: no input, no link, no sheet.
        expect(html).toMatch(
            /<span class="fd-item-row__title" title="Email">Email<\/span>[\s\S]*?fd-item-row__value">ethan@example.com</,
        );
        expect(html).not.toMatch(/<input[^>]*ethan@example\.com/);
        expect(html).not.toMatch(/name="email"/);
        // Time zone is a page now, not a sheet.
        expect(html).toMatch(
            /<a class="fd-item-row__face fd-item-row__face--link" href="\/settings\/account\/timezone">[\s\S]*?>Time zone<[\s\S]*?America\/Los_Angeles/,
        );
        expect(html).not.toContain("fd-account-timezone");
        expect(html).not.toMatch(/<select[^>]*name="timezone"/);
        // Security: the section header, then the red Log out row.
        expect(html).toContain(">Security<");
        expect(html).toMatch(
            /<li class="fd-item-row fd-item-row--danger">[\s\S]*?href="\/logout" data-turbo="false"[\s\S]*?>Log out</,
        );
        for (const gone of [
            "Save name",
            "Save time zone",
            "Change password",
            "preferred_weight_unit",
            "preferred_drink_unit",
            "widgets_enabled",
            "alcohol_tracking_enabled",
            "Weight unit",
            "Drink unit",
            "in-chat widgets",
            "Alcohol tracking",
        ]) {
            expect(html).not.toContain(gone);
        }
        expect(html).not.toContain('name="theme"');
        // No explanation of where the data lives, no sheet subtitle.
        expect(html).not.toContain("Your data stays on this household");
        expect(html).not.toContain("Your days and times count");
    });

    test("only Log out opts out of Turbo; the name and photo forms are Turbo forms", () => {
        const html = renderSettingsAccountV2Page(view);
        const forms = html.match(/<form [^>]*>/g) ?? [];
        expect(forms.length).toBeGreaterThanOrEqual(2);
        for (const form of forms) expect(form).not.toContain("data-turbo");
        expect(html.match(/data-turbo="false"/g)).toHaveLength(1);
        expect(html).toMatch(/<a [^>]*href="\/logout"[^>]*data-turbo="false"/);
    });

    test("the Name sheet is a bottom sheet from parts that posts the name and returns to Account", () => {
        const html = renderSettingsAccountV2Page(view);
        expect(html).toMatch(
            /<dialog class="fd-sheet fd-sheet--bottom" id="fd-account-name"/,
        );
        const form = html.match(
            /<form id="fd-account-name-form"[\s\S]*?<\/form>/,
        )![0];
        expect(form).toContain('action="/settings"');
        expect(form).toContain('name="group" value="account"');
        expect(form).toContain('name="return" value="/settings/account"');
        expect(form).toContain('name="from" value="/kitchen/fridge"');
        expect(form).toContain('name="display_name"');
        expect(form).toContain('value="Ethan"');
        expect(form).toContain('maxlength="80"');
        expect(html).toContain(
            '<button type="submit" class="fd-btn fd-btn--primary" data-fd-btn form="fd-account-name-form"><span class="fd-btn__label">Save</span></button>',
        );
    });

    test("no email known shows no Email row", () => {
        const html = renderSettingsAccountV2Page({ ...view, email: null });
        expect(html).not.toContain(">Email<");
    });

    test("no zone stored reads Not set; an alias is shown as stored", () => {
        const none = renderSettingsAccountV2Page({ ...view, timezone: "" });
        expect(none).toContain('fd-item-row__value">Not set<');
        const alias = renderSettingsAccountV2Page({
            ...view,
            timezone: "US/Pacific",
        });
        expect(alias).toContain('fd-item-row__value">US/Pacific<');
    });

    test("an error for the name sheet reopens it and shows inside the field, not as a page banner", () => {
        const html = renderSettingsAccountV2Page({
            ...view,
            error: "Enter a name.",
            openSheetId: "fd-account-name",
        });
        expect(html.match(/Enter a name\./g)).toHaveLength(1);
        expect(html).toMatch(
            /<dialog[^>]*id="fd-account-name"[^>]*data-sheet-open-on-load|<dialog[^>]*data-sheet-open-on-load[^>]*id="fd-account-name"/,
        );
        expect(html).toContain('aria-invalid="true"');
        const banner = renderSettingsAccountV2Page({
            ...view,
            error: "That photo is too large.",
        });
        expect(banner.match(/That photo is too large\./g)).toHaveLength(1);
        expect(banner).toContain('role="alert"');
    });

    test("the picture and Change photo open the picker through a visually hidden file input; remove only with a picture", () => {
        const without = renderSettingsAccountV2Page(view);
        expect(without).toContain('action="/settings/account/photo"');
        expect(without).not.toContain("Remove photo");
        const withPhoto = renderSettingsAccountV2Page({
            ...view,
            photo: { userId: "u1", version: new Date(1700000000000) },
        });
        expect(withPhoto).toContain('action="/settings/account/photo/remove"');
        expect(withPhoto).toContain(
            '<button type="submit" class="fd-btn fd-btn--danger fd-btn--sm" data-fd-btn><span class="fd-btn__label">Remove photo</span></button>',
        );
        expect(withPhoto).not.toContain("fd-settings-submit");
        // The file input is there for the picker but never drawn: it is
        // visually hidden, and the picture and the button are its labels.
        expect(withPhoto).toMatch(
            /<label class="fd-settings-photo__pick"><input type="file" id="photo" name="photo" class="fd-visually-hidden"/,
        );
        expect(withPhoto).toContain("data-fd-photo-pick");
        expect(withPhoto).toContain("Change photo");
        // The form still resizes in the browser and stays a Turbo form.
        expect(withPhoto).toMatch(
            /<form method="POST" action="\/settings\/account\/photo"[^>]*data-fd-avatar-upload>/,
        );
        expect(withPhoto).not.toMatch(
            /<form method="POST" action="\/settings\/account\/photo"[^>]*data-turbo="false"/,
        );
    });
});
