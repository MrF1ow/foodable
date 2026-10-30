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
        canManage: true,
        viewerUserId: alice.userId,
    } as never);
    expect(html).not.toMatch(
        /<details class="more">[\s\S]*(?:Add household member|Add store|Edit rules|Add store rule|Manage)/,
    );
    expect(html).toContain(`commandfor="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"`);
    expect(html).toContain(`commandfor="${HOUSEHOLD_ADD_STORE_MODAL_ID}"`);
    expect(html).toContain('action="/settings/household"');
    expect(html).toContain('class="add-member"');
    expect(html).toContain('commandfor="household-manage"');
    expect(html).not.toContain('commandfor="household-manage-u2"');
    expect(html).not.toContain('id="household-manage-u2"');
    expect(html).not.toContain('id="household-remove-u2"');
    expect(html).not.toContain('id="household-make-owner-u2"');
    expect(html).toContain('data-fill-title="Manage Bob"');
    expect(html).toContain("/settings/household/members/u2/remove");
    expect(html).toContain('name="confirm" value="yes" required');
    expect(html.match(/name="confirm" value="yes" required/g)?.length).toBe(1);
    const remove = dialogHtml(html, "household-remove");
    expect(remove).toContain(
        '<button type="submit" class="btn-danger" data-fill-slot="remove-label" disabled>',
    );
    expect(remove).not.toContain("Bob");
    expect(dialogHtml(html, "household-manage")).toContain("disabled");
    expect(dialogHtml(html, "household-make-owner")).toContain("disabled");
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
        canManage: true,
        viewerUserId: alice.userId,
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
        canManage: true,
        viewerUserId: alice.userId,
        error: "Tick the box to confirm removing Bob.",
        openModalId: "household-remove-u2",
    } as never);
    expect(removeHtml).toMatch(
        /<dialog class="modal" id="household-remove"[^>]*data-modal-open-on-load/,
    );
    expect(removeHtml).not.toContain('id="household-remove-u2"');
    const removeDialog = dialogHtml(removeHtml, "household-remove");
    expect(removeDialog).toContain(
        "Delete Bob's login and their meals, water, weight and goals. This can't be undone.",
    );
    expect(removeDialog).toContain(">Remove Bob</button>");
    expect(removeDialog).toContain('name="confirm" value="yes" required');
    expect(removeDialog).toContain("Tick the box to confirm removing Bob.");
    expect(
        removeHtml.match(/Tick the box to confirm removing Bob\./g)?.length,
    ).toBe(1);
    expect(removeDialog).toContain(
        '<button type="submit" class="btn-danger" data-fill-slot="remove-label">',
    );
    expect(removeDialog).not.toContain("disabled");
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
    canManage: true,
    viewerUserId: alice.userId,
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
        "household-make-owner",
        "Cannot transfer ownership.",
    );
    const ownerDialog = dialogHtml(makeOwner, "household-make-owner");
    expect(ownerDialog).toContain(
        "Bob becomes the owner. You stay in the household as a member and lose the owner settings.",
    );
    expect(ownerDialog).toContain(">Make Bob the owner</button>");
    expect(ownerDialog).not.toContain("disabled");
    const manage = renderHouseholdSettingsPage({
        ...ownerHouseholdBase,
        error: "Could not change the role.",
        openModalId: "household-manage-u2",
    } as never);
    expectErrorOnceInModal(
        manage,
        "household-manage",
        "Could not change the role.",
    );
    const manageDialog = dialogHtml(manage, "household-manage");
    expect(manageDialog).toContain(">Manage Bob</h2>");
    expect(manageDialog).toContain(
        'action="/settings/household/members/u2/role"',
    );
    expect(manageDialog).toContain('name="role" value="admin"');
    expect(manageDialog).toContain("Make Bob an admin");
    expect(manageDialog).toContain(">Make admin</button>");
    expect(manageDialog).toContain('class="btn-primary"');
    expect(manageDialog).toContain('commandfor="household-remove"');
    expect(manageDialog).toContain("Delete Bob's login");
    expect(manage).not.toContain('id="household-manage-u2"');
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
        canManage: true,
        viewerUserId: alice.userId,
        error: "Could not update household settings.",
        openModalId: "household-gone",
    } as never);
    expect(html).toContain("error-banner");
    expect(html).not.toMatch(/data-modal-open-on-load/);
});

function dialogHtml(html: string, id: string): string {
    const dialog = html.match(
        new RegExp(`<dialog class="modal" id="${id}"[\\s\\S]*?</dialog>`),
    )?.[0];
    expect(dialog).toBeDefined();
    return dialog!;
}

test("member dialog count does not grow with the household", () => {
    function page(count: number) {
        const members: HouseholdMember[] = [
            alice,
            ...Array.from({ length: count }, (_, index) => ({
                householdId: "hh-1",
                userId: `u-${index + 2}`,
                role: index === 0 ? ("member" as const) : ("admin" as const),
                displayName: `Member ${index + 2}`,
            })),
        ];
        return renderHouseholdSettingsPage({
            ...ownerHouseholdBase,
            members,
        } as never);
    }
    const one = page(1);
    const six = page(6);
    const dialogs = (html: string) => html.match(/<dialog\b/g)?.length ?? 0;
    expect(dialogs(one)).toBe(dialogs(six));
    expect(dialogs(one)).toBe(8);
    expect(six.match(/id="household-manage"/g)?.length).toBe(1);
    expect(six.match(/id="household-remove"/g)?.length).toBe(1);
    expect(six.match(/id="household-make-owner"/g)?.length).toBe(1);
    expect(six.match(/commandfor="household-manage"/g)?.length).toBe(7);
    expect(six).toContain('data-fill-title="Manage Member 7"');
    expect(six).toContain("Delete Member 7's login");
    expect(six).not.toContain('id="household-manage-u-2"');
    expect(six).not.toContain('id="household-remove-u-2"');
    expect(six).not.toContain('id="household-make-owner-u-2"');
    expect(dialogHtml(six, "household-manage")).toContain("disabled");
    expect(dialogHtml(six, "household-remove")).toContain(
        'name="confirm" value="yes" required',
    );
    expect(dialogHtml(six, "household-remove")).not.toContain("Member 7");
    expect(dialogHtml(six, "household-make-owner")).toContain("disabled");
    const unknown = renderHouseholdSettingsPage({
        ...ownerHouseholdBase,
        error: "Could not remove that member.",
        openModalId: "household-remove-missing",
    } as never);
    expect(unknown).toContain("error-banner");
    expect(unknown).toContain("Could not remove that member.");
    expect(unknown).not.toMatch(/data-modal-open-on-load/);
    expect(dialogHtml(unknown, "household-remove")).not.toContain("Bob");
});
