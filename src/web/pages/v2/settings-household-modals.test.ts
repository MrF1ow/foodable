import { expect, test } from "bun:test";
import type { HouseholdMember } from "../../../household.js";
import { modalTrigger } from "../../components/ui.js";
import {
    HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    HOUSEHOLD_ADD_STORE_MODAL_ID,
    HOUSEHOLD_MANAGE_ID,
    HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID,
    HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
    manageFill,
    memberActionsTemplate,
    renderHouseholdV2OwnerModals,
} from "./settings-household-modals.js";

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

const ownerView = {
    members: [alice, bob],
    isOwner: true,
    canManage: true,
};

function dialogHtml(html: string, id: string): string {
    const dialog = html.match(
        new RegExp(`<dialog class="modal" id="${id}"[\\s\\S]*?</dialog>`),
    )?.[0];
    expect(dialog).toBeDefined();
    return dialog!;
}

function expectErrorOnceInModal(
    html: string,
    modalId: string,
    message: string,
): void {
    expect(html.match(new RegExp(message, "g"))?.length).toBe(1);
    const dialog = dialogHtml(html, modalId);
    expect(dialog).toContain(message);
    expect(dialog.match(/error-banner/g)?.length).toBe(1);
}

test("the owner dialogs are modals: add member, add store, and one shared dialog per member action", () => {
    const html = renderHouseholdV2OwnerModals(ownerView);
    expect(html).toContain(`id="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"`);
    expect(html).toContain(`id="${HOUSEHOLD_ADD_STORE_MODAL_ID}"`);
    expect(html).toContain('action="/settings/household"');
    expect(html).toContain('class="add-member"');
    expect(html).toContain('action="/settings/household/stores"');
    expect(html).not.toContain('id="household-manage-u2"');
    expect(html).not.toContain('id="household-remove-u2"');
    expect(html).not.toContain('id="household-make-owner-u2"');
    expect(html.match(/name="confirm" value="yes" required/g)?.length).toBe(1);
    const remove = dialogHtml(html, "household-remove");
    expect(remove).toContain(
        '<button type="submit" class="btn-danger" data-fill-slot="remove-label" disabled>',
    );
    expect(remove).not.toContain("Bob");
    expect(dialogHtml(html, "household-manage")).toContain("disabled");
    expect(dialogHtml(html, "household-make-owner")).toContain("disabled");
});

test("a member who cannot manage gets no add dialogs, and only the owner gets member actions", () => {
    const admin = renderHouseholdV2OwnerModals({
        members: [alice, bob],
        isOwner: false,
        canManage: true,
    });
    expect(admin).toContain(`id="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"`);
    expect(admin).not.toContain('id="household-manage"');
    const plain = renderHouseholdV2OwnerModals({
        members: [alice, bob],
        isOwner: false,
        canManage: false,
    });
    expect(plain).not.toContain(`id="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"`);
    expect(plain).not.toContain(`id="${HOUSEHOLD_ADD_STORE_MODAL_ID}"`);
    expect(plain).not.toContain('id="household-manage"');
});

test("household server error reopens add-member and remove confirm modals", () => {
    const addHtml = renderHouseholdV2OwnerModals({
        ...ownerView,
        error: "Password must be at least 12 characters.",
        openModalId: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    });
    expect(addHtml).toMatch(
        new RegExp(
            `<dialog class="modal" id="${HOUSEHOLD_ADD_MEMBER_MODAL_ID}"[^>]*data-modal-open-on-load`,
        ),
    );
    const removeHtml = renderHouseholdV2OwnerModals({
        ...ownerView,
        error: "Tick the box to confirm removing Bob.",
        openModalId: "household-remove-u2",
    });
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

test("household modal errors render inside the reopening dialog", () => {
    const addStore = renderHouseholdV2OwnerModals({
        ...ownerView,
        error: "Enter a store name.",
        openModalId: HOUSEHOLD_ADD_STORE_MODAL_ID,
    });
    expectErrorOnceInModal(
        addStore,
        HOUSEHOLD_ADD_STORE_MODAL_ID,
        "Enter a store name.",
    );
    const makeOwner = renderHouseholdV2OwnerModals({
        ...ownerView,
        error: "Cannot transfer ownership.",
        openModalId: "household-make-owner-u2",
    });
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
    const manage = renderHouseholdV2OwnerModals({
        ...ownerView,
        error: "Could not change the role.",
        openModalId: "household-manage-u2",
    });
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
    expect(manageDialog).toContain(
        'data-filled-template="household-member-actions-u2"',
    );
    expect(manageDialog).toContain("Delete Bob's login");
    expect(manage).not.toContain('id="household-manage-u2"');
});

test("an unknown open modal id opens nothing and shows no error in a dialog", () => {
    const html = renderHouseholdV2OwnerModals({
        ...ownerView,
        error: "Could not remove that member.",
        openModalId: "household-remove-missing",
    });
    expect(html).not.toMatch(/data-modal-open-on-load/);
    expect(dialogHtml(html, "household-remove")).not.toContain("Bob");
});

test("member dialog count does not grow with the household", () => {
    function modals(count: number) {
        const members: HouseholdMember[] = [
            alice,
            ...Array.from({ length: count }, (_, index) => ({
                householdId: "hh-1",
                userId: `u-${index + 2}`,
                role: index === 0 ? ("member" as const) : ("admin" as const),
                displayName: `Member ${index + 2}`,
            })),
        ];
        return renderHouseholdV2OwnerModals({ ...ownerView, members });
    }
    const one = modals(1);
    const six = modals(6);
    const dialogs = (html: string) => html.match(/<dialog\b/g)?.length ?? 0;
    expect(dialogs(one)).toBe(dialogs(six));
    // Add member, add store, manage, make owner, remove, and the two readers.
    expect(dialogs(six)).toBe(7);
    expect(six.match(/id="household-manage"/g)?.length).toBe(1);
    expect(six.match(/id="household-remove"/g)?.length).toBe(1);
    expect(six.match(/id="household-make-owner"/g)?.length).toBe(1);
    expect(six).not.toContain('id="household-manage-u-2"');
    expect(six).not.toContain('id="household-remove-u-2"');
    expect(six).not.toContain('id="household-make-owner-u-2"');
    expect(dialogHtml(six, "household-manage")).toContain("disabled");
    expect(dialogHtml(six, "household-remove")).toContain(
        'name="confirm" value="yes" required',
    );
    expect(dialogHtml(six, "household-remove")).not.toContain("Member 7");
    expect(dialogHtml(six, "household-make-owner")).toContain("disabled");
});

test("member action template and trigger fill escape a hostile display name", () => {
    const hostile = `"><img src=x onerror=alert(1)>`;
    const member: HouseholdMember = {
        householdId: "hh-1",
        userId: "u-hostile",
        role: "member",
        displayName: hostile,
    };
    const html =
        memberActionsTemplate(member) +
        modalTrigger({
            target: HOUSEHOLD_MANAGE_ID,
            label: "Manage",
            fill: manageFill(member),
        });
    expect(html).toContain(
        "Make &quot;&gt;&lt;img src=x onerror=alert(1)&gt; the owner",
    );
    expect(html).toContain(
        'data-fill-title="Manage &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"',
    );
    expect(html).toContain(
        '<template id="household-member-actions-u-hostile">',
    );
    expect(html).toContain(
        'data-fill-template-member-actions="household-member-actions-u-hostile"',
    );
    expect(html).not.toContain('"><img src=x');
    expect(html).not.toContain("onerror=alert(1)>");
});

test("the social reader dialogs carry the risk text and the research link", () => {
    const html = renderHouseholdV2OwnerModals(ownerView);
    expect(html).toContain(`id="${HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID}"`);
    expect(html).toContain(`id="${HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID}"`);
    expect(html).toContain("Turn on TikTok reader");
    expect(html).toContain("Turn on Facebook reader");
    expect(html).toContain("Facebook doesn't document");
    expect(
        html.match(/goes against that platform's terms of service/g)?.length,
    ).toBeGreaterThanOrEqual(2);
    expect(
        html.match(/recipe-import-terms-2026-11\.md/g)?.length,
    ).toBeGreaterThanOrEqual(2);
});
