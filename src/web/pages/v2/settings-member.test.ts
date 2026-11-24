import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { HouseholdMember } from "../../../household.js";
import {
    renderSettingsMemberV2Page,
    SETTINGS_MEMBER_V2_MARKER,
    type SettingsMemberV2View,
} from "./settings-member.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

const alice: HouseholdMember = {
    householdId: "hh-1",
    userId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    displayName: "Alice",
};
const bob: HouseholdMember = {
    householdId: "hh-1",
    userId: "22222222-2222-4222-8222-222222222222",
    role: "member",
    displayName: "Bob",
};

const ALL = { role: true, transfer: true, remove: true };

function view(over: Partial<SettingsMemberV2View> = {}): SettingsMemberV2View {
    return {
        chrome,
        member: bob,
        viewer: alice,
        todayHref: `/?member=${bob.userId}`,
        ...over,
    };
}

describe("settings member v2", () => {
    test("the page is the household's Settings layout with the person's name as the title", () => {
        const html = renderSettingsMemberV2Page(view());
        expect(html).toContain(SETTINGS_MEMBER_V2_MARKER);
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain('<h1 class="fd-detail-bar__title">Bob</h1>');
        expect(html).toContain('<h1 class="fd-settings-page-title">Bob</h1>');
        // Back goes to the household.
        expect(html).toContain('aria-label="Back" href="/settings/household"');
        expect(html).toContain(
            '<h2 class="fd-settings-member-head__name">Bob</h2>',
        );
        expect(html).toContain(">B</span>");
    });

    test("Name, Role and Last active are rows; Today keeps its link", () => {
        const html = renderSettingsMemberV2Page(
            view({
                // 23:30 UTC on the 10th is already the 11th in Auckland.
                lastSeen: new Date("2026-11-10T23:30:00.000Z"),
                now: new Date("2026-11-12T05:00:00.000Z"),
                timezone: "Pacific/Auckland",
            }),
        );
        const titles = [
            ...html.matchAll(/fd-item-row__title" title="([^"]*)"/g),
        ].map((m) => m[1]);
        expect(titles).toEqual(["Name", "Role", "Last active", "Today"]);
        expect(html).toContain('fd-item-row__value">Bob<');
        expect(html).toContain('fd-item-row__value">Member<');
        expect(html).toContain('fd-item-row__value">Yesterday<');
        expect(html).toContain(`href="/?member=${bob.userId}"`);
        // Nothing here is editable, so no row pretends to be.
        expect(html).not.toContain(
            'command="show-modal" commandfor="fd-member-name',
        );
    });

    test("without last-seen data the row is left out; a person never seen reads Not yet", () => {
        expect(renderSettingsMemberV2Page(view())).not.toContain("Last active");
        expect(renderSettingsMemberV2Page(view({ lastSeen: null }))).toContain(
            'fd-item-row__value">Not yet<',
        );
    });

    test("the owner's menu: make admin, make owner, remove, the removal confirming in place", () => {
        const html = renderSettingsMemberV2Page(view({ manage: ALL }));
        const menu = html.match(
            /<div class="fd-menu[^>]*data-fd-menu[^]*?<\/div><\/div><\/div>/,
        )?.[0];
        expect(menu).toBeDefined();
        const labels = [...menu!.matchAll(/fd-menu__label">([^<]*)</g)].map(
            (m) => m[1],
        );
        expect(labels).toEqual([
            "Make admin",
            "Make owner",
            "Remove Bob",
            "Cancel",
            "Remove Bob",
        ]);
        expect(menu).toContain(
            `action="/settings/household/members/${bob.userId}/role"`,
        );
        expect(menu).toContain('name="role" value="admin"');
        expect(menu).toContain('commandfor="fd-member-make-owner"');
        expect(menu).toContain(
            `action="/settings/household/members/${bob.userId}/remove"`,
        );
        expect(menu).toContain('name="confirm" value="yes"');
        expect(menu).toContain("data-fd-menu-confirm");
        // The menu shows on the phone's bar and in the desktop header.
        expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(2);
    });

    test("an admin is offered Make member, not Make admin", () => {
        const html = renderSettingsMemberV2Page(
            view({ member: { ...bob, role: "admin" }, manage: ALL }),
        );
        expect(html).toContain("Make member");
        expect(html).toContain('name="role" value="member"');
        expect(html).not.toContain("Make admin");
        expect(html).toContain('fd-item-row__value">Admin<');
    });

    test("Make owner opens a confirm that asks, says what happens, and posts to make-owner, not a modal", () => {
        const html = renderSettingsMemberV2Page(view({ manage: ALL }));
        const sheet = html.match(
            /<dialog[^>]*id="fd-member-make-owner"[^]*?<\/dialog>/,
        )?.[0];
        expect(sheet).toBeDefined();
        expect(sheet).toContain("Make Bob the owner?");
        expect(sheet).toContain(
            `action="/settings/household/members/${bob.userId}/make-owner"`,
        );
        // The old owner becomes a member, not an admin: the copy says so.
        expect(sheet).toContain("You become a member. Only Bob can undo this.");
        expect(sheet).not.toContain("You become an admin");
        expect(sheet).toMatch(
            /<button type="submit" class="fd-btn fd-btn--danger"[^>]*><span class="fd-btn__label">Make owner<\/span>/,
        );
        expect(sheet).toContain(">Cancel<");
        // A confirm is a centred dialog from 1024 px, a bottom sheet on a phone.
        expect(sheet).toContain("fd-sheet--dialog");
        expect(sheet).not.toContain("fd-sheet--side");
        expect(sheet).not.toContain("Transfer ownership");
        expect(html).not.toContain('<dialog class="modal"');
    });

    test("a viewer who may do none of it gets no menu, no sheet, and a balanced bar", () => {
        for (const manage of [
            undefined,
            { role: false, transfer: false, remove: false },
        ]) {
            const html = renderSettingsMemberV2Page(view({ manage }));
            expect(html).not.toContain("data-fd-menu");
            expect(html).not.toContain("fd-member-make-owner");
            expect(html).not.toContain("Remove Bob");
            expect(html).toContain("fd-detail-bar__balance");
        }
    });

    test("each item follows its own permission", () => {
        const onlyRole = renderSettingsMemberV2Page(
            view({ manage: { role: true, transfer: false, remove: false } }),
        );
        expect(onlyRole).toContain("Make admin");
        expect(onlyRole).not.toContain("Make owner");
        expect(onlyRole).not.toContain("Remove Bob");
    });

    test("a refused action shows its reason as a banner on the page", () => {
        const html = renderSettingsMemberV2Page(
            view({ manage: ALL, error: "You can't remove yourself." }),
        );
        expect(html).toContain(
            `<p class="fd-settings-error" role="alert">You can't remove yourself.</p>`,
        );
    });
});
