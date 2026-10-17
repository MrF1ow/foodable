import { expect, test } from "bun:test";
import type { HouseholdMember } from "../household.js";
import {
    HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    HOUSEHOLD_ADD_STORE_MODAL_ID,
    householdMemberRulesModalId,
    renderHouseholdSettingsPage,
} from "../web/pages/household.js";

const chrome = { theme: "light" as const };
const alice: HouseholdMember = {
    householdId: "hh-1",
    userId: "u1",
    role: "owner",
    displayName: "Alice",
};
const bob: HouseholdMember = {
    householdId: "hh-1",
    userId: "u2",
    role: "member",
    displayName: "Bob",
};

test("household settings use modals instead of add/edit disclosures", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [
            {
                id: "s1",
                householdId: "hh-1",
                name: "Safeway",
                sortOrder: 0,
                sections: [],
                rules: [],
            },
        ],
        memberRules: [
            { member: alice, rules: [], allergens: [], dislikes: [] },
        ],
        isOwner: true,
    } as never);
    expect(html).not.toMatch(
        /<details class="more">[\s\S]*(?:Add household member|Add store|Edit rules|Add store rule|Manage)/,
    );
    expect(html).toContain(`commandfor="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"`);
    expect(html).toContain(`commandfor="${HOUSEHOLD_ADD_STORE_MODAL_ID}"`);
    expect(html).toContain('action="/settings/household"');
    expect(html).toContain('class="add-member"');
    expect(html).toContain('commandfor="household-manage-u2"');
    expect(html).toContain('action="/settings/household/members/u2/remove"');
    expect(html).toContain('name="confirm" value="yes" required');
});

test("household server error reopens add-member and remove confirm modals", () => {
    const addHtml = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [],
        memberRules: [],
        isOwner: true,
        error: "Password must be at least 8 characters.",
        openModalId: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    } as never);
    expect(addHtml).toMatch(
        new RegExp(
            `<dialog class="modal" id="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
    const removeHtml = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice, bob],
        stores: [],
        memberRules: [],
        isOwner: true,
        error: "Tick the box to confirm removing Bob.",
        openModalId: "household-remove-u2",
    } as never);
    expect(removeHtml).toMatch(
        /<dialog class="modal" id="household-remove-u2"[^>]*data-modal-open-on-load/,
    );
});

function expectErrorOnceInModal(
    html: string,
    modalId: string,
    message: string,
): void {
    expect(html.match(new RegExp(message, "g"))?.length).toBe(1);
    const dialog = html.match(
        new RegExp(`<dialog class="modal" id="${modalId}"[\\s\\S]*?</dialog>`),
    )?.[0];
    expect(dialog).toBeDefined();
    expect(dialog).toContain(message);
    expect(dialog!.match(/error-banner/g)?.length).toBe(1);
}

const ownerHouseholdBase = {
    chrome,
    householdName: "Home",
    location: "",
    members: [alice, bob],
    stores: [
        {
            id: "s1",
            householdId: "hh-1",
            name: "Safeway",
            sortOrder: 0,
            sections: [],
            rules: [],
        },
    ],
    memberRules: [{ member: bob, rules: [], allergens: [], dislikes: [] }],
    isOwner: true,
} as const;

test("household modal errors render inside the reopening dialog", () => {
    const addStore = renderHouseholdSettingsPage({
        ...ownerHouseholdBase,
        error: "Enter a store name.",
        openModalId: HOUSEHOLD_ADD_STORE_MODAL_ID,
    } as never);
    expectErrorOnceInModal(
        addStore,
        HOUSEHOLD_ADD_STORE_MODAL_ID,
        "Enter a store name.",
    );
    const storeRule = renderHouseholdSettingsPage({
        ...ownerHouseholdBase,
        error: "Enter a store rule.",
        openModalId: "household-store-rule-s1",
    } as never);
    expectErrorOnceInModal(
        storeRule,
        "household-store-rule-s1",
        "Enter a store rule.",
    );
    const makeOwner = renderHouseholdSettingsPage({
        ...ownerHouseholdBase,
        error: "Cannot transfer ownership.",
        openModalId: "household-make-owner-u2",
    } as never);
    expectErrorOnceInModal(
        makeOwner,
        "household-make-owner-u2",
        "Cannot transfer ownership.",
    );
    const rulesModal = householdMemberRulesModalId("u2");
    const memberRules = renderHouseholdSettingsPage({
        ...ownerHouseholdBase,
        error: "Enter an allergen.",
        openModalId: rulesModal,
    } as never);
    expectErrorOnceInModal(memberRules, rulesModal, "Enter an allergen.");
});

test("household page banner when openModalId is unknown", () => {
    const html = renderHouseholdSettingsPage({
        chrome,
        householdName: "Home",
        location: "",
        members: [alice],
        stores: [],
        memberRules: [],
        isOwner: true,
        error: "Could not update household settings.",
        openModalId: "household-gone",
    } as never);
    expect(html).toContain("error-banner");
    expect(html).not.toMatch(/data-modal-open-on-load/);
});
