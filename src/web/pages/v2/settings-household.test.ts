import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { DEFAULT_RESTOCK, type HouseholdMember } from "../../../household.js";
import {
    renderSettingsHouseholdV2Page,
    SETTINGS_HOUSEHOLD_V2_MARKER,
} from "./settings-household.js";

const HH = "hh-1";
const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

const alice: HouseholdMember = {
    householdId: HH,
    userId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    displayName: "Alice",
};
const bob: HouseholdMember = {
    householdId: HH,
    userId: "22222222-2222-4222-8222-222222222222",
    role: "member",
    displayName: "Bob",
};

function baseView(
    overrides: Partial<
        Parameters<typeof renderSettingsHouseholdV2Page>[0]
    > = {},
) {
    return {
        chrome,
        householdName: "Home",
        members: [alice, bob],
        storeCount: 3,
        placeCount: 2,
        pluralsSameFood: false,
        location: "Denver, CO",
        householdTimezone: "America/Denver",
        effectiveTimezone: "America/Denver",
        restock: {
            ...DEFAULT_RESTOCK,
            enabled: true,
            weekday: 0 as const,
            time: "09:00",
        },
        socialReaders: { tiktok: true, facebook: false },
        isOwner: true,
        canManage: true,
        canInvite: true,
        viewerUserId: alice.userId,
        ...overrides,
    };
}

const asAdmin = () =>
    baseView({
        isOwner: false,
        canManage: true,
        canInvite: false,
        viewerUserId: bob.userId,
    });
const asMember = () =>
    baseView({
        isOwner: false,
        canManage: false,
        canInvite: false,
        viewerUserId: bob.userId,
    });

/** The titles of one list group's rows, in order. */
function rowTitles(html: string, label: string): string[] {
    const start = html.indexOf(`aria-label="${label}"><li`);
    expect(start).toBeGreaterThan(-1);
    const list = html.slice(start, html.indexOf("</ul>", start));
    return [...list.matchAll(/fd-item-row__title" title="([^"]*)"/g)].map(
        (m) => m[1]!,
    );
}

describe("settings household v2", () => {
    test("the page is the Settings layout: Detail bar, desktop title, menu and the household marked current", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(SETTINGS_HOUSEHOLD_V2_MARKER);
        expect(html).toContain('class="fd-detail-bar fd-settings-detail"');
        expect(html).toContain(
            '<h1 class="fd-detail-bar__title">Household</h1>',
        );
        expect(html).toContain(
            '<h1 class="fd-settings-page-title">Household</h1>',
        );
        expect(html).toContain("fd-page-layout--settings");
        expect(html).toContain(
            'href="/settings/household" aria-current="page"',
        );
        // The phone's back arrow goes to Settings.
        expect(html).toContain('aria-label="Back" href="/settings"');
    });

    test("the household name sits in a card with the member count, no tagline", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(
            '<span class="fd-settings-hh-name">Home</span><span class="fd-settings-hh-count">2 members</span>',
        );
        expect(html).not.toContain("one fridge, one grocery list");
        expect(
            renderSettingsHouseholdV2Page(baseView({ members: [alice] })),
        ).toContain('fd-settings-hh-count">1 member<');
    });

    test("Members has a caps header with the count and a row per person that opens their page", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(
            '<h2 class="fd-section-header__label">Members</h2><span class="fd-section-header__count">2</span>',
        );
        expect(rowTitles(html, "Members")).toEqual([
            "Alice",
            "Bob",
            "Add a member",
        ]);
        const bobRow = html.match(
            new RegExp(
                `<li class="fd-item-row"><a class="fd-item-row__face fd-item-row__face--link" href="/settings/household/members/${bob.userId}">[^]*?</li>`,
            ),
        )?.[0];
        expect(bobRow).toBeDefined();
        expect(bobRow).toContain("fd-item-row__avatar");
        expect(bobRow).toContain(">B<");
        expect(bobRow).toContain('fd-item-row__value">Member<');
        expect(bobRow).toContain("fd-item-row__chevron");
        expect(html).toContain('fd-item-row__value">Owner<');
        // Manage and the old member card are gone: the row opens the page.
        expect(html).not.toContain(">Manage<");
        expect(html).not.toContain("fd-settings-members-card");
        expect(html).not.toContain("fd-row--settings-member");
    });

    test("a member's picture shows over the initials only when they have one", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                chrome: {
                    ...chrome,
                    identity: {
                        viewerUserId: alice.userId,
                        viewerName: "Alice",
                        viewerRole: "owner",
                        householdName: "Home",
                        memberCount: 2,
                        avatarVersions: new Map([
                            [bob.userId, new Date(1700000000000)],
                        ]),
                    },
                },
            }),
        );
        expect(html).toContain(`src="/avatars/${bob.userId}?v=1700000000000"`);
        expect(html.match(/<img /g)).toHaveLength(1);
    });

    test("Add a member is the last row of the list and opens a sheet, not a modal", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(
            'commandfor="fd-household-add-member" command="show-modal"',
        );
        // A bottom sheet on a phone, the 480 px side panel from 1024 px.
        expect(html).toContain('<dialog class="fd-sheet fd-sheet--side"');
        expect(html).not.toContain('commandfor="household-add-member"');
        expect(html).not.toContain(
            "Members sign in with the email or username and password you give them.",
        );
    });

    test("a viewer who cannot add members gets no Add a member row, sheet or menu entry", () => {
        const html = renderSettingsHouseholdV2Page(asMember());
        expect(html).not.toContain("Add a member");
        expect(html).not.toContain("fd-household-add-member");
        expect(rowTitles(html, "Members")).toEqual(["Alice", "Bob"]);
    });

    test("the owner's add-member sheet asks for name, email or username, password and a role", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        const sheet = html.match(
            /<dialog class="fd-sheet[^>]*id="fd-household-add-member"[^]*?<\/dialog>/,
        )?.[0];
        expect(sheet).toBeDefined();
        expect(sheet).toContain('method="post" action="/settings/household"');
        expect(sheet).toContain('name="display_name"');
        // Each field has its caps label.
        expect(sheet!.match(/fd-sheet__label">/g)).toHaveLength(4);
        expect(sheet).toContain('maxlength="80"');
        expect(sheet).toContain('placeholder="Jo"');
        expect(sheet).toContain('fd-sheet__label">Email or username<');
        expect(sheet).toContain('name="login"');
        expect(sheet).toContain('autocapitalize="none"');
        expect(sheet).toContain('name="password"');
        expect(sheet).toContain('type="password"');
        expect(sheet).toContain('minlength="12"');
        expect(sheet).toContain(">Add household member<");
        expect(sheet).toContain(
            'form="fd-household-add-member-form"><span class="fd-btn__label">Add member',
        );
        // The owner picks Member (the default) or Admin.
        expect(sheet).toContain('fd-sheet__label">Role<');
        expect(sheet).toContain(
            '<input class="fd-segmented__input" type="radio" name="role" value="member" checked>',
        );
        expect(sheet).toContain('name="role" value="admin"');
        expect(sheet).not.toContain("A username has no @");
    });

    test("an admin's add-member sheet has no role: whoever they add is a member", () => {
        const html = renderSettingsHouseholdV2Page(asAdmin());
        const sheet = html.match(
            /<dialog class="fd-sheet[^>]*id="fd-household-add-member"[^]*?<\/dialog>/,
        )?.[0];
        expect(sheet).toBeDefined();
        expect(sheet!.match(/fd-sheet__label">/g)).toHaveLength(3);
        expect(sheet).not.toContain('name="role"');
        expect(sheet).not.toContain("Admin");
    });

    test("the value sheets are side panels on desktop, bottom sheets on a phone", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        for (const id of ["fd-household-name", "fd-household-location"]) {
            expect(html).toMatch(
                new RegExp(
                    `<dialog class="fd-sheet fd-sheet--side"[^>]*id="${id}"`,
                ),
            );
        }
        expect(html).not.toContain("fd-sheet--bottom");
    });

    test("a refused add reopens the sheet with the reason inside it, once", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                error: "Name is required.",
                openModalId: "fd-household-add-member",
            }),
        );
        expect(html.match(/Name is required\./g)).toHaveLength(1);
        const sheet = html.match(
            /<dialog[^>]*id="fd-household-add-member"[^]*?<\/dialog>/,
        )![0];
        expect(sheet).toContain("data-sheet-open-on-load");
        expect(sheet).toContain("Name is required.");
    });

    test("an error that belongs to no sheet is a banner above the page", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({ error: "That person is not in this household." }),
        );
        expect(html).toContain(
            '<p class="fd-settings-error" role="alert">That person is not in this household.</p>',
        );
        expect(html).not.toContain("data-sheet-open-on-load");
    });

    test("with no household zone and no owner zone the Time zone row says the zone is a default", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                householdTimezone: null,
                effectiveTimezone: "UTC",
                effectiveTimezoneDefaulted: true,
            }),
        );
        expect(html).toContain("UTC (default)");
        expect(html).not.toMatch(/UTC \(owner/);
        const owners = renderSettingsHouseholdV2Page(
            baseView({
                householdTimezone: null,
                effectiveTimezone: "Europe/Kyiv",
            }),
        );
        expect(owners).toMatch(/Europe\/Kyiv \(owner(?:&#0?39;|')s\)/);
    });

    test("the Household group shows its rows in the design's order with their values", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(rowTitles(html, "Household")).toEqual([
            "Location",
            "Time zone",
            "Stores",
            "Fridge places",
            "Restock day",
            "Invite codes",
            "Recipe link readers",
            "Plurals are the same food",
        ]);
        expect(html).toContain('fd-item-row__value">Denver, CO<');
        expect(html).toContain('fd-item-row__value">America/Denver<');
        expect(html).toContain('fd-item-row__value">Sunday<');
        expect(html).not.toContain("Sunday, 9:00 AM");
        expect(html).toContain("TikTok on");
        // The retired recipe expiry setting has no row, sheet or form.
        expect(html).not.toContain("Unverified recipes");
        expect(html).not.toContain("fd-household-expiry");
        expect(html).not.toContain("recipe-settings");
        expect(html).not.toContain("unverified_recipe_expiry_days");
        expect(html).toContain('href="/settings/household/stores"');
        expect(html).toContain('href="/settings/household/places"');
        expect(html).toContain('href="/settings/household/restock"');
        expect(html).toContain('href="/settings/household/invites"');
        expect(html).toContain('href="/settings/household/readers"');
        // Name and Rotate household token live in the ⋯ menu.
        expect(rowTitles(html, "Household")).not.toContain("Household name");
        expect(rowTitles(html, "Household")).not.toContain(
            "Rotate household token",
        );
        expect(html).not.toContain("/settings/household/dismissed");
    });

    test("the Fridge places row counts the places and links to their page", () => {
        const html = renderSettingsHouseholdV2Page(baseView({ placeCount: 4 }));
        expect(html).toMatch(
            /title="Fridge places">Fridge places<\/span><\/span><\/span><span class="fd-item-row__value">4</,
        );
        const row = html.slice(
            html.indexOf('href="/settings/household/places"'),
        );
        expect(row.slice(0, row.indexOf("</li>"))).toContain(
            "fd-item-row__chevron",
        );
    });

    test("the Plurals are the same food switch posts the opposite value, and draws no chevron", () => {
        const off = renderSettingsHouseholdV2Page(baseView());
        const row = (html: string) => {
            const at = html.indexOf("Plurals are the same food");
            const start = html.lastIndexOf("<li", at);
            return html.slice(start, html.indexOf("</li>", at));
        };
        expect(row(off)).toContain(
            'action="/settings/household/plurals-same-food"',
        );
        expect(row(off)).toContain('name="plurals_same_food" value="true"');
        expect(row(off)).toContain('aria-checked="false"');
        expect(row(off)).not.toContain("fd-item-row__chevron");
        const on = renderSettingsHouseholdV2Page(
            baseView({ pluralsSameFood: true }),
        );
        expect(row(on)).toContain('name="plurals_same_food" value="false"');
        expect(row(on)).toContain('aria-checked="true"');
    });

    test("a member sees the Plurals setting as On or Off, with no form", () => {
        const member = renderSettingsHouseholdV2Page({
            ...asMember(),
            pluralsSameFood: true,
        });
        expect(member).not.toContain("/settings/household/plurals-same-food");
        const at = member.indexOf("Plurals are the same food");
        const row = member.slice(
            member.lastIndexOf("<li", at),
            member.indexOf("</li>", at),
        );
        expect(row).toContain('fd-item-row__value">On<');
    });

    test("an admin edits the rows but has no Invite codes (the owner's); a member sees values only", () => {
        const admin = renderSettingsHouseholdV2Page(asAdmin());
        expect(rowTitles(admin, "Household")).not.toContain("Invite codes");
        expect(admin).not.toContain("/settings/household/invites");
        expect(admin).toContain('commandfor="fd-household-location"');
        // The time zone is a page of its own, for a manager.
        expect(admin).toContain('href="/settings/household/timezone"');
        expect(admin).not.toContain("fd-household-timezone");

        const member = renderSettingsHouseholdV2Page(asMember());
        expect(rowTitles(member, "Household")).toEqual([
            "Location",
            "Time zone",
            "Stores",
            "Fridge places",
            "Restock day",
            "Recipe link readers",
            "Plurals are the same food",
        ]);
        // The rows still show their values, without a form or a sheet.
        expect(member).toContain("Denver, CO");
        expect(member).not.toContain("/settings/household/invites");
        expect(member).not.toContain('commandfor="fd-household-');
        for (const action of ["name", "location", "timezone"]) {
            expect(member).not.toContain(
                `action="/settings/household/${action}"`,
            );
        }
        expect(member).not.toContain('action="/settings/household/stores"');
    });

    test("the ⋯ menu: the owner renames and rotates the token, an admin only renames, a member has none", () => {
        const owner = renderSettingsHouseholdV2Page(baseView());
        const menus = owner.match(
            /<div class="fd-menu[^>]*data-fd-menu[^]*?<\/div><\/div>/g,
        );
        expect(menus).not.toBeNull();
        expect(menus![0]).toContain("Rename household");
        expect(menus![0]).toContain("Rotate household token");
        expect(menus![0]).toContain('commandfor="fd-household-name"');
        expect(menus![0]).toContain('commandfor="fd-household-rotate-token"');

        const admin = renderSettingsHouseholdV2Page(asAdmin());
        expect(admin).toContain("Rename household");
        expect(admin).not.toContain("Rotate household token");
        expect(admin).not.toContain("fd-household-rotate-token");

        const member = renderSettingsHouseholdV2Page(asMember());
        expect(member).not.toContain("data-fd-menu");
        expect(member).not.toContain("Rename household");
        // Without a menu the bar keeps its balance cell, so the title stays centred.
        expect(member).toContain("fd-detail-bar__balance");
        expect(member).not.toContain(
            'action="/settings/household/rotate-token"',
        );
    });

    test("the rotate-token confirm keeps data-turbo=false (the one-time secret is a 200 page)", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        const form = html.match(
            /<form[^>]*action="\/settings\/household\/rotate-token"[^>]*>/,
        )?.[0];
        expect(form).toBeDefined();
        expect(form).toContain('data-turbo="false"');
    });

    test("no old modal on the page: the owner's rotate confirm is a sheet, an admin has none", () => {
        const owner = renderSettingsHouseholdV2Page(baseView());
        expect(owner).not.toContain('<dialog class="modal"');
        expect(owner).toContain('id="fd-household-rotate-token"');
        expect(owner).toContain("Rotate household token?");
        const admin = renderSettingsHouseholdV2Page(asAdmin());
        expect(admin).not.toContain('<dialog class="modal"');
        expect(admin).not.toContain("rotate-token");
    });

    test("the one-time token is not shown here any more: it has a page of its own", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).not.toContain("shown once");
        expect(html).not.toContain("fd-settings-token");
    });

    test("the store list, the old plurals block and the readers section are gone", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).not.toContain(">Grocery stores</");
        expect(html).not.toContain("Manage stores");
        // Only the one switch row posts to the plurals route: no block, no sheet.
        expect(html.split("plurals-same-food")).toHaveLength(2);
        expect(html).not.toContain(">Social post readers</");
        expect(html).not.toContain("/settings/household/social-readers");
        expect(html).not.toContain("Dismissed notices");
        expect(html).not.toContain("Possible duplicates");
    });

    test("Shared links is a row with its count that opens its page, only when the flag gave the page links", () => {
        const rows = (n: number) =>
            Array.from({ length: n }, (_v, i) => ({
                id: `l${i}`,
                kind: "grocery_list" as const,
                recipeName: null,
                createdByName: null,
                createdAt: "2026-11-01T10:00:00.000Z",
                expiresAt: null,
            }));
        const on = renderSettingsHouseholdV2Page(
            baseView({ sharedLinks: rows(2) }),
        );
        expect(rowTitles(on, "Household")).toEqual([
            "Location",
            "Time zone",
            "Stores",
            "Fridge places",
            "Restock day",
            "Invite codes",
            "Shared links",
            "Recipe link readers",
            "Plurals are the same food",
        ]);
        expect(on).toContain('href="/settings/household/shared-links"');
        expect(on).toMatch(
            /title="Shared links">Shared links<\/span><\/span><\/span><span class="fd-item-row__value">2</,
        );
        // The links and their Revoke are on the page behind the row.
        expect(on).not.toContain("/revoke");
        // None yet: the row still shows, with 0.
        expect(
            renderSettingsHouseholdV2Page(baseView({ sharedLinks: [] })),
        ).toContain('href="/settings/household/shared-links"');
        // Flag off: the loader leaves sharedLinks out and the row goes.
        const off = renderSettingsHouseholdV2Page(baseView());
        expect(off).not.toContain("Shared links");
        expect(off).not.toContain("shared-links");
    });

    test("the Time zone row opens a page for a manager and is a plain value for a member", () => {
        const owner = renderSettingsHouseholdV2Page(baseView());
        expect(owner).toContain('href="/settings/household/timezone"');
        expect(owner).not.toContain("<select");
        const member = renderSettingsHouseholdV2Page(asMember());
        expect(member).not.toContain("/settings/household/timezone");
        expect(member).toContain("America/Denver");
    });

    test("an error from a household sheet reopens it and stays out of the page banner", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                error: "Enter a household name.",
                openModalId: "fd-household-name",
            }),
        );
        expect(html).toContain("data-sheet-open-on-load");
        expect(html.match(/Enter a household name\./g)).toHaveLength(1);
        expect(html).not.toContain('class="fd-settings-error"');
    });

    test("the sheets say no more than their title: no subtitles", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).not.toContain("Where the household shops");
        expect(html).not.toContain("count in this zone");
        expect(html).not.toContain("fd-sheet__subtitle");
    });
});
