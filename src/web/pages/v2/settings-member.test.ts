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

    test("the page has no ⋯ menu in its bar, only the Role row's drop-down", () => {
        const html = renderSettingsMemberV2Page(view({ manage: ALL }));
        // One menu on the page (the Role row), no icon button in the bar.
        expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(1);
        expect(html).not.toContain("Actions for Bob");
        expect(html).toContain("fd-detail-bar__balance");
    });

    test("the owner's Role row is a drop-down of Member, Admin and Owner; Owner opens the confirm sheet", () => {
        const html = renderSettingsMemberV2Page(view({ manage: ALL }));
        const menu = html.match(
            /<div class="fd-menu[^>]*data-fd-menu[^]*?<\/div><\/div>/,
        )?.[0];
        expect(menu).toBeDefined();
        expect(menu).toContain('data-anchor="row"');
        const labels = [...menu!.matchAll(/fd-menu__label">([^<]*)</g)].map(
            (m) => m[1],
        );
        expect(labels).toEqual(["Member", "Admin", "Owner"]);
        // The face reads the current role, and draws no chevron (it opens in place).
        expect(menu).toContain('fd-item-row__value">Member<');
        expect(menu).not.toContain("fd-icon--chevron");
        // Member is where the person is: choosing it only closes the menu.
        expect(menu).toMatch(
            /role="menuitemcheckbox" aria-checked="true" data-fd-menu-close>[^]*?Member/,
        );
        expect(menu).toContain(
            `action="/settings/household/members/${bob.userId}/role"`,
        );
        expect(menu).toContain('name="role" value="admin"');
        expect(menu).not.toContain('name="role" value="member"');
        expect(menu).toContain('commandfor="fd-member-make-owner"');
        // The role row is the only Role row.
        expect(html.match(/title="Role"/g)).toHaveLength(1);
    });

    test("an admin's Role row ticks Admin and posts Member", () => {
        const html = renderSettingsMemberV2Page(
            view({ member: { ...bob, role: "admin" }, manage: ALL }),
        );
        expect(html).toContain('fd-item-row__value">Admin<');
        expect(html).toContain('name="role" value="member"');
        expect(html).not.toContain('name="role" value="admin"');
        expect(html).not.toContain("Make admin");
        expect(html).not.toContain("Make member");
    });

    test("Remove is a red row in its own group at the bottom, and keeps its confirm", () => {
        const html = renderSettingsMemberV2Page(view({ manage: ALL }));
        const remove = html.match(
            /<li class="fd-item-row[^"]*fd-item-row--danger[^"]*"[^]*?<\/li>/,
        )?.[0];
        expect(remove).toBeDefined();
        expect(remove).toContain("Remove Bob");
        expect(remove).toContain('commandfor="fd-member-remove"');
        // No chevron: like Log out, the row is the whole control.
        expect(remove).not.toContain("fd-icon");
        // Its own group (one row), after the member's details.
        const group = html.match(
            /<ul class="fd-list-group"[^>]*>(?:(?!<\/ul>)[^])*Remove Bob[^]*?<\/ul>/,
        )?.[0];
        expect(group?.match(/<li /g)).toHaveLength(1);
        expect(html.indexOf(group!)).toBeGreaterThan(html.indexOf("Role"));
        // The confirm is a sheet that posts to remove with the confirm field.
        const sheet = html.match(
            /<dialog[^>]*id="fd-member-remove"[^]*?<\/dialog>/,
        )?.[0];
        expect(sheet).toBeDefined();
        expect(sheet).toContain("Remove Bob?");
        expect(sheet).toContain(
            `action="/settings/household/members/${bob.userId}/remove"`,
        );
        expect(sheet).toContain('name="confirm" value="yes"');
        expect(sheet).toMatch(
            /<button type="submit" class="fd-btn fd-btn--danger"[^>]*><span class="fd-btn__label">Remove<\/span>/,
        );
    });

    test("the Remove sheet says what really goes and what stays, not that their meals stay", () => {
        const html = renderSettingsMemberV2Page(view({ manage: ALL }));
        const text = html.match(
            /<dialog[^>]*id="fd-member-remove"[^]*?<p class="fd-sheet__text">([^<]*)<\/p>/,
        )?.[1];
        expect(text).toBe(
            "Bob loses access, and their login, meals, water, weight, goals, allergens, dislikes and own rules are erased for good. The household's fridge, groceries, recipes and foods stay.",
        );
        expect(text).not.toContain("meals stay");
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

    test("a viewer who may do none of it sees a plain Role value, no menu, no sheet, no Remove", () => {
        for (const manage of [
            undefined,
            { role: false, transfer: false, remove: false },
        ]) {
            const html = renderSettingsMemberV2Page(view({ manage }));
            expect(html).not.toContain("data-fd-menu");
            expect(html).not.toContain("fd-member-make-owner");
            expect(html).not.toContain("fd-member-remove");
            expect(html).not.toContain("Remove Bob");
            expect(html).not.toContain("fd-item-row--danger");
            expect(html).toContain('fd-item-row__value">Member<');
            expect(html).toContain("fd-detail-bar__balance");
        }
    });

    test("each part follows its own permission", () => {
        const onlyRole = renderSettingsMemberV2Page(
            view({ manage: { role: true, transfer: false, remove: false } }),
        );
        expect(onlyRole).toContain("Admin");
        expect(onlyRole).not.toContain('commandfor="fd-member-make-owner"');
        expect(onlyRole).not.toContain("Remove Bob");
        const onlyRemove = renderSettingsMemberV2Page(
            view({ manage: { role: false, transfer: false, remove: true } }),
        );
        expect(onlyRemove).not.toContain("data-fd-menu");
        expect(onlyRemove).toContain("Remove Bob");
        expect(onlyRemove).toContain('fd-item-row__value">Member<');
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
