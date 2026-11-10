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
