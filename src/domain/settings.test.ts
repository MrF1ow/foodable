import { test, expect } from "bun:test";
import {
    createGroceryStore,
    createMemorySettingsStore,
    DEFAULT_STORE_SECTIONS,
    renameSection,
    SettingsInputError,
} from "./settings.js";
import { renderSettingsPage } from "../web/pages/settings.js";
import { renderHouseholdSettingsPage } from "../web/pages/household.js";
import type { HouseholdMember } from "../household.js";

const HH = "hh-1";

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

const chrome = { theme: "light" as const };

test("theme save form posts account fields to /settings", () => {
    const html = renderSettingsPage({
        chrome: { theme: "dark" },
        displayName: "Alice",
        timezone: "America/Los_Angeles",
        weightUnit: "lb",
        widgetsEnabled: true,
        alcoholTrackingEnabled: false,
        drinkUnit: "",
    });
    expect(html).toContain("<h1>Settings</h1>");
    expect(html).toContain('href="/settings/household"');
    expect(html).toContain('href="/settings/foods"');
    expect(html).toContain('name="theme" value="dark" checked');
    expect(html).toContain('name="theme" value="system"');
    expect(html).toContain('name="theme" value="light"');
    expect(html).not.toContain('name="accent_swatch"');
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).not.toContain("coming-soon");
});

test("a cleared theme preference checks System", () => {
    const html = renderSettingsPage({
        chrome: { theme: "system" },
        displayName: "Alice",
        timezone: "",
        weightUnit: "",
        widgetsEnabled: true,
        alcoholTrackingEnabled: false,
        drinkUnit: "",
    });
    expect(html).toContain('name="theme" value="system" checked');
    expect(html).not.toContain("data-theme");
});

test("creating a store seeds default sections including Other", async () => {
    const store = createMemorySettingsStore();
    const created = await createGroceryStore(store, HH, "Safeway");
    expect(created.name).toBe("Safeway");
    const sections = await store.listSections(created.id);
    expect(sections.map((row) => row.name)).toEqual([
        ...DEFAULT_STORE_SECTIONS,
    ]);
    expect(sections.some((row) => row.isOther && row.name === "Other")).toBe(
        true,
    );
});

test("creating a store refuses a duplicate name", async () => {
    const store = createMemorySettingsStore();
    await createGroceryStore(store, HH, "Safeway");
    await expect(createGroceryStore(store, HH, "Safeway")).rejects.toThrow(
        SettingsInputError,
    );
});

test("section rename updates the stored name", async () => {
    const store = createMemorySettingsStore();
    const created = await createGroceryStore(store, HH, "Safeway");
    const produce = (await store.listSections(created.id)).find(
        (row) => row.name === "Produce",
    )!;
    const renamed = await renameSection(
        store,
        HH,
        produce.id,
        "Household goods",
    );
    expect(renamed.name).toBe("Household goods");
    const names = (await store.listSections(created.id)).map((row) => row.name);
    expect(names).toContain("Household goods");
    expect(names).toContain("Household");
    await expect(
        renameSection(store, HH, produce.id, "Household"),
    ).rejects.toThrow(/already exists/i);
});

test("owner household page has add-member form on /settings/household only", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [],
        memberRules: [
            { member: alice, rules: [], allergens: [], dislikes: [] },
            { member: bob, rules: [], allergens: [], dislikes: [] },
        ],
        isOwner: true,
        canManage: true,
        viewerUserId: alice.userId,
    });
    expect(html).toContain("<h1>Household</h1>");
    expect(html).toContain('href="/settings/foods"');
    expect(html).toContain('action="/settings/household"');
    expect(html).toContain('commandfor="household-add-member"');
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).not.toContain('action="/add-household-member"');
    // Manage controls on Bob's row only: the owner never manages themselves.
    // The make-owner and remove triggers live in that member's template.
    expect(html).toContain(
        `<template id="household-member-actions-${bob.userId}">`,
    );
    expect(html).toContain(
        `data-fill-action="/settings/household/members/${bob.userId}/make-owner"`,
    );
    expect(html).toContain(
        `data-fill-action="/settings/household/members/${bob.userId}/remove"`,
    );
    expect(html).not.toContain(
        `/settings/household/members/${alice.userId}/remove`,
    );
    expect(html).not.toContain(
        `/settings/household/members/${alice.userId}/make-owner`,
    );
    expect(html).toContain('name="confirm" value="yes" required');
});

test("member household page is read-only without add-member", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "Seattle",
        members: [alice, bob],
        stores: [],
        memberRules: [
            { member: alice, rules: [], allergens: [], dislikes: [] },
            { member: bob, rules: [], allergens: [], dislikes: [] },
        ],
        isOwner: false,
        canManage: false,
        viewerUserId: bob.userId,
    });
    expect(html).toContain("Seattle");
    expect(html).not.toContain('action="/settings/household"');
    expect(html).not.toContain('commandfor="household-add-member"');
    expect(html).not.toContain('action="/settings/household/stores"');
    expect(html).not.toContain("/make-owner");
    expect(html).not.toContain("/remove");
});

test("household settings groups owner tools into cards and modals", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [],
        memberRules: [
            {
                member: alice,
                rules: [],
                allergens: [{ id: "a1", allergen: "peanut", otherLabel: null }],
                dislikes: [{ id: "d1", displayName: "Olives" }],
            },
        ],
        isOwner: true,
        canManage: true,
        viewerUserId: alice.userId,
    } as never);
    expect(html).toContain(
        '<a href="/settings/household" aria-current="page">Household</a>',
    );
    for (const heading of ["Household", "Members", "Grocery stores", "Rules"]) {
        expect(html).toContain(`<h2>${heading}</h2>`);
    }
    expect(html).toContain('id="household-add-member"');
    expect(html).toContain('<li class="allergen pill pill-bad">');
    expect(html).toContain('<li class="dislike pill pill-dim">Olives</li>');
    expect(html).toContain(
        '<form method="post" action="/settings/household/name" class="household-name inline-form">',
    );
});

test("owner can make a member an admin without giving up ownership", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [],
        memberRules: [],
        isOwner: true,
        canManage: true,
        viewerUserId: alice.userId,
    });
    expect(html).toContain(
        `data-fill-action="/settings/household/members/${bob.userId}/role"`,
    );
    expect(html).toContain('data-fill-field-role="admin"');
    expect(html).toContain("You stay the owner.");
});

test("admin manages the household but not roles, removal or the token", () => {
    const admin: HouseholdMember = { ...bob, role: "admin" };
    const carol: HouseholdMember = {
        ...bob,
        userId: "33333333-3333-4333-8333-333333333333",
        displayName: "Carol",
    };
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, admin, carol],
        stores: [],
        memberRules: [
            { member: carol, rules: [], allergens: [], dislikes: [] },
        ],
        isOwner: false,
        canManage: true,
        viewerUserId: admin.userId,
    });
    expect(html).toContain('commandfor="household-add-member"');
    expect(html).toContain('action="/settings/household/name"');
    expect(html).toContain(
        `action="/settings/household/members/${carol.userId}/rules"`,
    );
    expect(html).not.toContain("/role");
    expect(html).not.toContain("/make-owner");
    expect(html).not.toContain("household-rotate-token");
    expect(html).toContain('data-role="admin"');
});

test("member edits their own rules and only their own", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [],
        memberRules: [
            {
                member: alice,
                rules: [],
                allergens: [],
                dislikes: [],
            },
            {
                member: bob,
                rules: [
                    {
                        id: "r1",
                        householdId: HH,
                        userId: bob.userId,
                        body: "No pork",
                        sortOrder: 0,
                    },
                ],
                allergens: [],
                dislikes: [],
            },
        ],
        isOwner: false,
        canManage: false,
        viewerUserId: bob.userId,
    });
    expect(html).toContain(
        `action="/settings/household/members/${bob.userId}/rules"`,
    );
    expect(html).toContain(
        `action="/settings/household/members/${bob.userId}/rules/r1/remove"`,
    );
    expect(html).not.toContain(
        `action="/settings/household/members/${alice.userId}/rules"`,
    );
    expect(html).not.toContain('action="/settings/household/name"');
});
