import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { HouseholdMember } from "../../../household.js";
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
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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
        stores: [{ id: "s1", householdId: HH, name: "Safeway", sortOrder: 0 }],
        isOwner: true,
        canManage: true,
        viewerUserId: alice.userId,
        noticeResult: EMPTY_NOTICES,
        duplicatePairs: [],
        refCounts: new Map<string, number>(),
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

    test("owner page shows household menu and management targets", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(SETTINGS_HOUSEHOLD_V2_MARKER);
        expect(html).toContain(
            'href="/settings/household" aria-current="page"',
        );
        expect(html).toContain('action="/settings/household/name"');
        expect(html).toContain('commandfor="household-add-member"');
        expect(html).toContain(`/settings/household/members/${bob.userId}`);
        expect(html).toContain('id="fd-dup-section"');
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

    test("add store trigger sits in the grocery stores section", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        const storesIdx = html.indexOf(">Grocery stores</");
        const addStoreIdx = html.indexOf('commandfor="household-add-store"');
        const membersIdx = html.indexOf(">Members</");
        expect(storesIdx).toBeGreaterThan(-1);
        expect(addStoreIdx).toBeGreaterThan(storesIdx);
        expect(addStoreIdx).toBeLessThan(
            html.indexOf("Social post readers", storesIdx),
        );
        const memberAddIdx = html.indexOf('commandfor="household-add-member"');
        expect(memberAddIdx).toBeGreaterThan(membersIdx);
        expect(memberAddIdx).toBeLessThan(storesIdx);
    });

    test("each store links to its page and every member can open the stores page", () => {
        for (const canManage of [true, false]) {
            const html = renderSettingsHouseholdV2Page(
                baseView({ canManage, isOwner: canManage }),
            );
            expect(html).toContain('href="/settings/household/stores/s1"');
            expect(html).toContain(
                'href="/settings/household/stores">Manage stores</a>',
            );
        }
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

    test("merge error with no pair left shows on the page", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                error: "Keep must be one of the two foods in this pair.",
                openModalId: "dup-merge",
                duplicatePairs: [],
            }) as never,
        );
        expect(html).toContain(
            "Keep must be one of the two foods in this pair.",
        );
    });

    test("a member row without Manage has its chevron inside the link", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({ isOwner: false, canManage: false }) as never,
        );
        expect(html).toMatch(
            /<a class="fd-row__link"[^>]*>(?:(?!<\/a>).)*fd-row__chevron/,
        );
    });

    test("owner sees plurals_same_food control", () => {
        const html = renderSettingsHouseholdV2Page(baseView());
        expect(html).toContain(
            'action="/settings/household/plurals-same-food"',
        );
        expect(html).toContain("Treat singular and plural as the same food");
    });

    test("member viewer sees plurals_same_food as read-only", () => {
        const html = renderSettingsHouseholdV2Page(
            baseView({
                isOwner: false,
                canManage: false,
                pluralsSameFood: true,
            }),
        );
        expect(html).not.toContain(
            'action="/settings/household/plurals-same-food"',
        );
        expect(html).toContain(">On</span>");
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
        expect(html).not.toContain('commandfor="household-add-store"');
        expect(html).not.toContain('action="/settings/household/stores"');
    });
});
