import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { DEFAULT_RESTOCK, type HouseholdMember } from "../../../household.js";
import type { NoticesForResult } from "../../../domain/notices-for.js";

const EMPTY_NOTICES: NoticesForResult = {
    notices: [],
    dismissals: [],
    subjectNames: new Map(),
    subjectTimes: new Map(),
    noticeFoods: new Map(),
    catalogFoods: [],
    aliasMap: new Map(),
    barcodedIds: new Set(),
    possibleDuplicatePairs: [],
    recipesListPrefetch: {
        recipes: [],
        allIngredients: [],
        fridgeItems: [],
        foodsById: new Map(),
    },
};
import {
    renderSettingsHouseholdV2Page,
    SETTINGS_HOUSEHOLD_V2_MARKER,
} from "./settings-household.js";

const HH = "hh-1";
const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
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
        location: "Denver, CO",
        householdTimezone: "America/Denver",
        effectiveTimezone: "America/Denver",
        restock: {
            ...DEFAULT_RESTOCK,
            enabled: true,
            weekday: 0 as const,
            time: "09:00",
        },
        unverifiedRecipeExpiryDays: 30,
        dismissedCount: 2,
        socialReaders: { tiktok: true, facebook: false },
        isOwner: true,
        canManage: true,
        viewerUserId: alice.userId,
        noticeResult: EMPTY_NOTICES,
        ...overrides,
    };
}

describe("settings household v2", () => {
    test("members sit in one card, each with an initials avatar", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain('class="fd-settings-members-card"');
        expect(html).toContain(
            '<span class="fd-avatar fd-settings-member-avatar" aria-hidden="true">B</span>',
        );
    });

    test("the household name is the page title with the member count under it", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain('<h1 class="fd-settings-title');
        expect(html).toMatch(/<h1 class="fd-settings-title[^"]*">Home<\/h1>/);
        expect(html).not.toContain('fd-settings-title">Household</h1>');
        expect(html).toContain("2 members · one fridge, one grocery list");
        expect(html).not.toContain(">Members</h2>");
        const one = renderSettingsHouseholdV2Page(
            baseView({ members: [alice] }),
        );
        expect(one).toContain("1 member · one fridge, one grocery list");
    });

    test("Add a member is the last row of the members card, with the sign-in hint", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        const start = html.indexOf('class="fd-settings-members-card"');
        const card = html.slice(
            start,
            html.indexOf('aria-label="Household"', start),
        );
        expect(card).toContain('commandfor="household-add-member"');
        expect(card).toContain("Add a member");
        // The row follows the last member, inside the card.
        expect(card.indexOf("Add a member")).toBeGreaterThan(
            card.lastIndexOf("fd-row--settings-member"),
        );
        expect(html).not.toContain(
            'commandfor="household-add-member">Add member',
        );
        expect(html).not.toContain("fd-settings-btn--primary");
        const hint =
            "Members sign in with the email or username and password you give them.";
        expect(html).toContain(hint);
        expect(html.indexOf(hint)).toBeGreaterThan(
            html.indexOf("Add a member"),
        );
    });

    test("a viewer who cannot add members gets no Add a member row and no hint", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                isOwner: false,
                canManage: false,
                viewerUserId: bob.userId,
            }),
        );
        expect(html).not.toContain("Add a member");
        expect(html).not.toContain("Members sign in with the email");
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

    test("owner page shows household menu and management targets", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(SETTINGS_HOUSEHOLD_V2_MARKER);
        expect(html).toContain(
            'href="/settings/household" aria-current="page"',
        );
        expect(html).toContain('action="/settings/household/name"');
        expect(html).toContain('commandfor="household-add-member"');
        expect(html).toContain('commandfor="fd-household-name"');
        expect(html).toContain(`/settings/household/members/${bob.userId}`);
        expect(html).not.toContain("Possible duplicates");
    });

    test("the members list shows each member's last active day in the household's timezone", () => {
        const carol: HouseholdMember = {
            ...bob,
            userId: "33333333-3333-4333-8333-333333333333",
            displayName: "Carol",
        };
        const dan: HouseholdMember = {
            ...bob,
            userId: "44444444-4444-4444-8444-444444444444",
            displayName: "Dan",
        };
        const html = renderSettingsHouseholdV2Page(
            baseView({
                members: [alice, bob, carol, dan],
                timezone: "Pacific/Auckland",
                now: new Date("2026-11-12T05:00:00.000Z"),
                lastSeen: new Map<string, Date | null>([
                    // 23:30 UTC on the 11th is already the 12th in Auckland.
                    [alice.userId, new Date("2026-11-11T23:30:00.000Z")],
                    [bob.userId, new Date("2026-11-10T23:30:00.000Z")],
                    [carol.userId, new Date("2026-10-01T12:00:00.000Z")],
                    [dan.userId, null],
                ]),
            }),
        );
        const cell = (name: string) =>
            html.match(
                new RegExp(
                    `${name}</span>.*?fd-row__last-active">([^<]*)</span>`,
                ),
            )?.[1];
        expect(cell("Alice")).toBe("Today");
        expect(cell("Bob")).toBe("Yesterday");
        expect(cell("Carol")).toBe("Oct 2");
        expect(cell("Dan")).toBe("Not yet");
        expect(html).toContain("fd-settings-members-head");
    });

    test("a page loaded without last-seen data leaves the column out", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).not.toContain("fd-row__last-active");
        expect(html).not.toContain("fd-settings-members-head");
    });

    test("manageable members emit member-actions fill templates", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(
            `<template id="household-member-actions-${bob.userId}">`,
        );
        expect(html).not.toContain(
            `<template id="household-member-actions-${alice.userId}">`,
        );
    });

    test("validation error with add-member modal does not duplicate page banner", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                error: "Name is required.",
                openModalId: "household-add-member",
            }),
        );
        expect(html).toContain('class="error-banner"');
        expect(html).not.toContain('class="fd-settings-error"');
    });

    test("a member row without Manage has its chevron inside the link", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({ isOwner: false, canManage: false }) as never,
        );
        expect(html).toMatch(
            /<a class="fd-row__link"[^>]*>(?:(?!<\/a>).)*fd-row__chevron/,
        );
    });

    test("member viewer is read-only for household name and stores", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                isOwner: false,
                canManage: false,
                viewerUserId: bob.userId,
            }),
        );
        expect(html).not.toContain('action="/settings/household/name"');
        expect(html).not.toContain('commandfor="household-add-member"');
        expect(html).not.toContain('action="/settings/household/stores"');
        // The rows still show their values, without a form or a sheet.
        expect(html).toContain("Denver, CO");
        expect(html).not.toContain('commandfor="fd-household-name"');
        expect(html).not.toContain('action="/settings/household/location"');
        expect(html).not.toContain('action="/settings/household/timezone"');
        expect(html).not.toContain(
            'action="/settings/household/recipe-settings"',
        );
        expect(html).not.toContain("Rotate join token");
    });

    const GROUP_ROWS = [
        "Household name",
        "Location",
        "Time zone",
        "Stores",
        "Restock day",
        "Recipe link readers",
        "Unverified recipes",
        "Dismissed notices",
        "Rotate join token",
    ];

    function groupRows(html: string): string[] {
        const group = html.slice(html.indexOf('aria-label="Household"><li'));
        return [
            ...group.matchAll(
                /fd-stores-pref__main"><span class="fd-row__title">([^<]*)</g,
            ),
        ].map((m) => m[1]!);
    }

    test("the Household group shows the nine rows in the design's order with their values", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(groupRows(html)).toEqual(GROUP_ROWS);
        expect(html).toContain("America/Denver");
        expect(html).toContain("Sunday, 9:00 AM");
        expect(html).toContain("TikTok on");
        expect(html).toContain("30 days");
        expect(html).toContain('href="/settings/household/stores"');
        expect(html).toContain('href="/settings/household/restock"');
        expect(html).toContain('href="/settings/household/readers"');
        expect(html).toContain('href="/settings/household/dismissed"');
    });

    test("the store list, plurals block and readers section are gone", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).not.toContain(">Grocery stores</");
        expect(html).not.toContain("Manage stores");
        expect(html).not.toContain('commandfor="household-add-store"');
        expect(html).not.toContain("plurals-same-food");
        expect(html).not.toContain("Treat singular and plural");
        expect(html).not.toContain(">Social post readers</");
        expect(html).not.toContain("/settings/household/social-readers");
        expect(html).not.toContain(">Dismissed notices</h2>");
        // Possible duplicates moved to Saved foods & recipes.
        expect(html).not.toContain('id="fd-dup-section"');
        expect(html).not.toContain("dup-merge");
    });

    test("Shared links sits below the Household group, only when the page has links", () => {
        const withLinks = renderSettingsHouseholdV2Page(
            baseView({ sharedLinks: [] }),
        );
        const groupIdx = withLinks.indexOf('aria-label="Household"><li');
        const linksIdx = withLinks.indexOf("Shared links");
        expect(linksIdx).toBeGreaterThan(groupIdx);
        expect(renderSettingsHouseholdV2Page(baseView())).not.toContain(
            "Shared links",
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

    test("an admin edits household rows but does not see Rotate join token", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({ isOwner: false, canManage: true }),
        );
        expect(html).toContain('commandfor="fd-household-name"');
        expect(html).toContain('action="/settings/household/timezone"');
        expect(groupRows(html)).toEqual(GROUP_ROWS.slice(0, -1));
    });

    test("the time zone picker keeps a stored alias that the runtime list lacks", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({ householdTimezone: "US/Pacific" }),
        );
        expect(html).toContain('<option value="US/Pacific" selected>');
    });

    test("an error from a household sheet reopens it and stays out of the page banner", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                error: "Enter a valid IANA timezone.",
                openModalId: "fd-household-timezone",
            }),
        );
        expect(html).toContain("data-sheet-open-on-load");
        expect(html.match(/Enter a valid IANA timezone\./g)).toHaveLength(1);
    });
});
