import { escapeHtml, renderAppShell } from "../shell.js";
import type { ViewerChrome } from "../shell.js";
import type { HouseholdMember } from "../../household.js";
import type { GrocerySection, GroceryStore } from "../../domain/settings.js";
import {
    ALLERGEN_LABELS,
    NAMED_ALLERGENS,
    type MemberAllergen,
    type MemberDislike,
    type PersonRule,
    type StoreRule,
} from "../../domain/rules.js";
import { renderSettingsNav } from "../components/settings-nav.js";
import { sharedDialogItem } from "../components/shared-dialog.js";
import {
    confirmModal,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    pageLevelErrorBanner,
    panel,
    row,
    type ModalFill,
} from "../components/ui.js";

export type HouseholdStoreView = GroceryStore & {
    sections: GrocerySection[];
    rules: StoreRule[];
};

export type HouseholdMemberRulesView = {
    member: HouseholdMember;
    rules: PersonRule[];
    allergens: MemberAllergen[];
    dislikes: MemberDislike[];
};

export type HouseholdSettingsView = {
    chrome: ViewerChrome;
    householdName: string;
    location: string;
    members: HouseholdMember[];
    stores: HouseholdStoreView[];
    memberRules: HouseholdMemberRulesView[];
    /** Owner only: roles, removal, transfer, the bot token. */
    isOwner: boolean;
    /** Owner or admin: household settings, stores, everyone's rules. */
    canManage: boolean;
    viewerUserId: string;
    error?: string;
    issuedToken?: string;
    openModalId?: string;
};

export const HOUSEHOLD_ADD_MEMBER_MODAL_ID = "household-add-member";
export const HOUSEHOLD_ADD_STORE_MODAL_ID = "household-add-store";
export const HOUSEHOLD_ROTATE_TOKEN_MODAL_ID = "household-rotate-token";

/** One manage, make-owner, and remove dialog for every member. */
const HOUSEHOLD_MANAGE_ID = "household-manage";
const HOUSEHOLD_REMOVE_ID = "household-remove";
const HOUSEHOLD_MAKE_OWNER_ID = "household-make-owner";
const MANAGE_PREFIX = "household-manage-";
const REMOVE_PREFIX = "household-remove-";
const OWNER_PREFIX = "household-make-owner-";

function modalOpen(view: HouseholdSettingsView, id: string): boolean {
    return view.openModalId === id;
}

function managedMembers(view: HouseholdSettingsView): HouseholdMember[] {
    if (!view.isOwner) return [];
    return view.members.filter((member) => member.role !== "owner");
}

function findManagedMember(
    view: HouseholdSettingsView,
    id: string,
): HouseholdMember | null {
    return managedMembers(view).find((member) => member.userId === id) ?? null;
}

function memberMatch(view: HouseholdSettingsView, prefix: string) {
    return sharedDialogItem({
        openModalId: view.openModalId,
        prefix,
        lookup: (id) => findManagedMember(view, id),
    });
}

function storeRuleModalId(storeId: string): string {
    return `household-store-rule-${storeId}`;
}

export function householdMemberRulesModalId(userId: string): string {
    return `household-member-rules-${userId}`;
}

function addMemberFormBody(error?: string): string {
    return `${errorBanner(error)}
<label for="add_display_name">Name</label>
<input id="add_display_name" name="display_name" required maxlength="80" />
<label for="add_login">Email or username</label>
<input id="add_login" name="login" required autocomplete="off" autocapitalize="none" spellcheck="false" />
<p class="hint">A username has no @: 2–31 letters, digits, dots, dashes or underscores. They sign in with it on the same login page.</p>
<label for="add_password">Password</label>
<input id="add_password" name="password" type="password" required minlength="8" autocomplete="new-password" />
<button type="submit" class="btn-primary">Add member</button>`;
}

function addMemberModal(view: HouseholdSettingsView): string {
    const modalError =
        view.error && modalOpen(view, HOUSEHOLD_ADD_MEMBER_MODAL_ID)
            ? errorBanner(view.error)
            : "";
    return modal({
        id: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
        title: "Add household member",
        openOnLoad: modalOpen(view, HOUSEHOLD_ADD_MEMBER_MODAL_ID),
        body: `<form method="POST" action="/settings/household" class="add-member">
${modalError}${addMemberFormBody()}
</form>`,
    });
}

function roleBlurb(member: HouseholdMember): string {
    const name = member.displayName;
    return member.role === "admin"
        ? `${name} is an admin: they can change household settings, stores and everyone's rules, and add people. You stay the owner.`
        : `Make ${name} an admin to let them change household settings, stores and everyone's rules, and add people. You stay the owner.`;
}

function roleValue(member: HouseholdMember): string {
    return member.role === "admin" ? "member" : "admin";
}

function roleSubmitLabel(member: HouseholdMember): string {
    return member.role === "admin" ? "Make member" : "Make admin";
}

function roleSubmitClass(member: HouseholdMember): string {
    return member.role === "admin" ? "" : "btn-primary";
}

function ownerMessage(member: HouseholdMember): string {
    return `${member.displayName} becomes the owner. You stay in the household as a member and lose the owner settings.`;
}

function ownerConfirmLabel(member: HouseholdMember): string {
    return `Make ${member.displayName} the owner`;
}

function removeCopy(member: HouseholdMember): string {
    return `Delete ${member.displayName}'s login and their meals, water, weight and goals. This can't be undone.`;
}

function removeConfirmLabel(member: HouseholdMember): string {
    return `Remove ${member.displayName}`;
}

function ownerFill(member: HouseholdMember): ModalFill {
    return {
        action: `/settings/household/members/${member.userId}/make-owner`,
        message: ownerMessage(member),
        text: { "owner-label": ownerConfirmLabel(member) },
    };
}

function removeFill(member: HouseholdMember): ModalFill {
    return {
        action: `/settings/household/members/${member.userId}/remove`,
        title: `Remove ${member.displayName}`,
        fields: { confirm: "" },
        text: {
            "remove-copy": removeCopy(member),
            "remove-label": removeConfirmLabel(member),
        },
    };
}

function memberActionButtons(member: HouseholdMember): string {
    return `${modalTrigger({
        target: HOUSEHOLD_MAKE_OWNER_ID,
        label: ownerConfirmLabel(member),
        fill: ownerFill(member),
    })}
${modalTrigger({
    target: HOUSEHOLD_REMOVE_ID,
    label: "Remove member",
    className: "btn-danger",
    fill: removeFill(member),
})}`;
}

function manageFill(member: HouseholdMember): ModalFill {
    return {
        action: `/settings/household/members/${member.userId}/role`,
        title: `Manage ${member.displayName}`,
        fields: { role: roleValue(member) },
        text: {
            "role-blurb": roleBlurb(member),
            "role-submit": roleSubmitLabel(member),
        },
        classes: { "role-submit": roleSubmitClass(member) },
        templates: {
            "member-actions": memberActionsTemplateId(member.userId),
        },
    };
}

function memberActionsTemplateId(userId: string): string {
    return `household-member-actions-${userId}`;
}

function memberActionsTemplate(member: HouseholdMember): string {
    return `<template id="${escapeHtml(memberActionsTemplateId(member.userId))}">${memberActionButtons(member)}</template>`;
}

function manageFormHtml(member: HouseholdMember | null): string {
    const action = member
        ? `/settings/household/members/${member.userId}/role`
        : "";
    const role = member ? roleValue(member) : "";
    const blurb = member ? roleBlurb(member) : "";
    const label = member ? roleSubmitLabel(member) : "Make admin";
    const cls = member ? roleSubmitClass(member) : "";
    const classAttr = cls ? ` class="${cls}"` : "";
    const disabled = member ? "" : " disabled";
    return `<form method="post" action="${escapeHtml(action)}" class="member-role">
<input type="hidden" name="role" value="${escapeHtml(role)}" />
<p class="muted" data-fill-slot="role-blurb">${escapeHtml(blurb)}</p>
<button type="submit" data-fill-slot="role-submit"${classAttr}${disabled}>${escapeHtml(label)}</button>
</form>`;
}

function memberActionsSlot(member: HouseholdMember | null): string {
    if (!member) {
        return `<div class="modal-actions" data-fill-slot="member-actions"></div>`;
    }
    const id = memberActionsTemplateId(member.userId);
    return `<div class="modal-actions" data-fill-slot="member-actions" data-filled-template="${escapeHtml(id)}">${memberActionButtons(member)}</div>`;
}

function sharedMemberDialogs(view: HouseholdSettingsView): string {
    if (managedMembers(view).length === 0) return "";
    const manage = memberMatch(view, MANAGE_PREFIX);
    const remove = memberMatch(view, REMOVE_PREFIX);
    const owner = memberMatch(view, OWNER_PREFIX);
    const manageMember = manage?.item ?? null;
    const removeMember = remove?.item ?? null;
    const ownerMember = owner?.item ?? null;
    const manageOpen = manage != null;
    const removeOpen = remove != null;
    const ownerOpen = owner != null;
    const removeSentence = removeMember
        ? removeCopy(removeMember)
        : "Delete this member's login and their meals, water, weight and goals. This can't be undone.";
    return (
        modal({
            id: HOUSEHOLD_MANAGE_ID,
            title: manageMember
                ? `Manage ${manageMember.displayName}`
                : "Manage member",
            openOnLoad: manageOpen,
            submitDisabled: manageMember == null,
            body: `${manageOpen ? errorBanner(view.error) : ""}${manageFormHtml(manageMember)}
<p class="muted">Transfer ownership or remove this member from the household.</p>
${memberActionsSlot(manageMember)}`,
        }) +
        confirmModal({
            id: HOUSEHOLD_MAKE_OWNER_ID,
            title: "Transfer ownership",
            message: ownerMember
                ? ownerMessage(ownerMember)
                : "This member becomes the owner. You stay in the household as a member and lose the owner settings.",
            action: ownerMember
                ? `/settings/household/members/${ownerMember.userId}/make-owner`
                : "",
            confirmLabel: ownerMember
                ? ownerConfirmLabel(ownerMember)
                : "Make the owner",
            submitSlot: "owner-label",
            openOnLoad: ownerOpen,
            bodyPrefix: ownerOpen ? errorBanner(view.error) : "",
            submitDisabled: ownerMember == null,
        }) +
        modal({
            id: HOUSEHOLD_REMOVE_ID,
            title: removeMember
                ? `Remove ${removeMember.displayName}`
                : "Remove member",
            openOnLoad: removeOpen,
            submitDisabled: removeMember == null,
            body: `${removeOpen ? errorBanner(view.error) : ""}<form method="post" action="${escapeHtml(removeMember ? `/settings/household/members/${removeMember.userId}/remove` : "")}" class="remove-member">
<label><input type="checkbox" name="confirm" value="yes" required /> <span data-fill-slot="remove-copy">${escapeHtml(removeSentence)}</span></label>
<button type="submit" class="btn-danger" data-fill-slot="remove-label"${removeMember ? "" : " disabled"}>${escapeHtml(removeMember ? removeConfirmLabel(removeMember) : "Remove")}</button>
</form>`,
        })
    );
}

function sectionRow(section: GrocerySection, canEdit: boolean): string {
    if (!canEdit) {
        return `<li class="store-section">${escapeHtml(section.name)}</li>`;
    }
    return `<li class="store-section">
<form class="section-rename inline-form" method="post" action="/settings/household/sections/${escapeHtml(section.id)}">
<label class="visually-hidden" for="section-name-${escapeHtml(section.id)}">Section name</label>
<input id="section-name-${escapeHtml(section.id)}" name="name" value="${escapeHtml(section.name)}" required maxlength="80" />
<button type="submit" class="btn-sm">Rename</button>
</form>
</li>`;
}

function storeCard(
    store: HouseholdStoreView,
    canEdit: boolean,
    view: HouseholdSettingsView,
): { card: string; modals: string } {
    const sections = store.sections
        .map((section) => sectionRow(section, canEdit))
        .join("");
    const rules = store.rules
        .map((rule) => `<li class="store-rule">${escapeHtml(rule.body)}</li>`)
        .join("");
    const ruleModalId = storeRuleModalId(store.id);
    const ruleModalError =
        view.error && modalOpen(view, ruleModalId)
            ? errorBanner(view.error)
            : "";
    const ruleModal = canEdit
        ? modal({
              id: ruleModalId,
              title: "Add store rule",
              openOnLoad: modalOpen(view, ruleModalId),
              body: `${ruleModalError}<form method="post" action="/settings/household/stores/${escapeHtml(store.id)}/rules" class="store-rule-form">
<label for="store-rule-${escapeHtml(store.id)}">Store rule</label>
<textarea id="store-rule-${escapeHtml(store.id)}" name="body" required maxlength="500"></textarea>
<button type="submit" class="btn-primary">Save store rule</button>
</form>`,
          })
        : "";
    const headRule = canEdit
        ? `<div class="row-actions">${modalTrigger({
              target: ruleModalId,
              label: "Add store rule",
              className: "btn-sm",
          })}</div>`
        : "";
    const card = `<section class="household-store psec" data-store-id="${escapeHtml(store.id)}">
<div class="row">
<h3 class="subsection-title">${escapeHtml(store.name)}</h3>
${headRule}
</div>
<ul class="store-section-list list">${sections}</ul>
<ul class="store-rule-list muted">${rules}</ul>
</section>`;
    return { card, modals: ruleModal };
}

function allergenLabel(row: MemberAllergen): string {
    if (row.allergen === "other") return row.otherLabel ?? "Other";
    return ALLERGEN_LABELS[row.allergen];
}

function memberRulesCard(
    view: HouseholdMemberRulesView,
    canEdit: boolean,
    pageView: HouseholdSettingsView,
): { card: string; modals: string } {
    const allergens = view.allergens
        .map(
            (row) =>
                `<li class="allergen pill pill-bad">${escapeHtml(allergenLabel(row))}</li>`,
        )
        .join("");
    const dislikes = view.dislikes
        .map(
            (row) =>
                `<li class="dislike pill pill-dim">${escapeHtml(row.displayName)}</li>`,
        )
        .join("");
    const rules = view.rules
        .map((row) => `<li class="person-rule">${escapeHtml(row.body)}</li>`)
        .join("");
    const allergenOptions = NAMED_ALLERGENS.map(
        (code) =>
            `<option value="${code}">${escapeHtml(ALLERGEN_LABELS[code])}</option>`,
    ).join("");
    const rulesModalId = householdMemberRulesModalId(view.member.userId);
    const base = `/settings/household/members/${escapeHtml(view.member.userId)}`;
    const removeRow = (kind: string, id: string, label: string) =>
        `<li class="row">
<span class="row-title">${escapeHtml(label)}</span>
<div class="row-actions"><form method="post" action="${base}/${kind}/${escapeHtml(id)}/remove"><button type="submit" class="btn-sm btn-danger" aria-label="Remove ${escapeHtml(label)}">Remove</button></form></div>
</li>`;
    const current = [
        ...view.allergens.map((row) =>
            removeRow("allergens", row.id, `Allergen: ${allergenLabel(row)}`),
        ),
        ...view.dislikes.map((row) =>
            removeRow("dislikes", row.id, `Dislike: ${row.displayName}`),
        ),
        ...view.rules.map((row) => removeRow("rules", row.id, row.body)),
    ].join("");
    const currentList = current
        ? `<ul class="person-rule-current list">${current}</ul>`
        : "";
    const rulesModalError =
        pageView.error && modalOpen(pageView, rulesModalId)
            ? errorBanner(pageView.error)
            : "";
    const rulesModal = canEdit
        ? modal({
              id: rulesModalId,
              title: `Rules for ${view.member.displayName}`,
              openOnLoad: modalOpen(pageView, rulesModalId),
              body: `${rulesModalError}${currentList}<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/allergens" class="allergen-form">
<label for="allergen-${escapeHtml(view.member.userId)}">Allergen</label>
<select id="allergen-${escapeHtml(view.member.userId)}" name="allergen">
${allergenOptions}
<option value="other">Other</option>
</select>
<label for="allergen-other-${escapeHtml(view.member.userId)}">Other allergen</label>
<input id="allergen-other-${escapeHtml(view.member.userId)}" name="other_label" maxlength="80" />
<button type="submit" class="btn-primary">Save allergen</button>
</form>
<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/dislikes" class="dislike-form">
<label for="dislike-${escapeHtml(view.member.userId)}">Dislike</label>
<input id="dislike-${escapeHtml(view.member.userId)}" name="display_name" required maxlength="80" />
<button type="submit" class="btn-primary">Save dislike</button>
</form>
<form method="post" action="/settings/household/members/${escapeHtml(view.member.userId)}/rules" class="person-rule-form">
<label for="person-rule-${escapeHtml(view.member.userId)}">Person rule</label>
<textarea id="person-rule-${escapeHtml(view.member.userId)}" name="body" required maxlength="500"></textarea>
<button type="submit" class="btn-primary">Save person rule</button>
</form>`,
          })
        : "";
    const editTrigger = canEdit
        ? `<div class="row-actions">${modalTrigger({
              target: rulesModalId,
              label: "Edit rules",
              className: "btn-sm",
          })}</div>`
        : "";
    const card = `<section class="member-rules psec" data-user-id="${escapeHtml(view.member.userId)}">
<div class="row">
<h3 class="subsection-title">${escapeHtml(view.member.displayName)}</h3>
${editTrigger}
</div>
<ul class="allergen-list pills">${allergens}</ul>
<ul class="dislike-list pills">${dislikes}</ul>
<ul class="person-rule-list muted">${rules}</ul>
</section>`;
    return { card, modals: rulesModal };
}

export function renderHouseholdSettingsPage(
    view: HouseholdSettingsView,
): string {
    const modalIds: string[] = [];
    const token = view.issuedToken
        ? `<p class="token-once">Household bot token (shown once): <code>${escapeHtml(view.issuedToken)}</code></p>`
        : "";
    if (view.error) {
        for (const prefix of [MANAGE_PREFIX, REMOVE_PREFIX, OWNER_PREFIX]) {
            const match = memberMatch(view, prefix);
            if (match) modalIds.push(match.openModalId);
        }
    }
    const memberModals = sharedMemberDialogs(view);
    const members = view.members
        .map((member) => {
            const actions =
                view.isOwner && member.role !== "owner"
                    ? `${memberActionsTemplate(member)}${modalTrigger({
                          target: HOUSEHOLD_MANAGE_ID,
                          label: "Manage",
                          className: "btn-sm",
                          fill: manageFill(member),
                      })}`
                    : "";
            return `<li class="household-member" data-role="${escapeHtml(member.role)}">${row(
                {
                    title: member.displayName,
                    meta: member.role,
                    actions,
                },
            )}</li>`;
        })
        .join("");
    const rotateToken = view.isOwner
        ? `<div class="row-actions">${modalTrigger({
              target: HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
              label: "Rotate household token",
              className: "btn-sm",
          })}</div>`
        : "";
    const householdCard = view.canManage
        ? `<form method="post" action="/settings/household/name" class="household-name inline-form">
<label for="household_name">Household name</label>
<input id="household_name" name="name" value="${escapeHtml(view.householdName)}" required maxlength="80" />
<button type="submit">Save</button>
</form>
<form method="post" action="/settings/household/location" class="household-location inline-form">
<label for="household_location">Household location</label>
<input id="household_location" name="location" value="${escapeHtml(view.location)}" maxlength="120" />
<button type="submit">Save</button>
</form>
${rotateToken}`
        : `<p class="household-name">${escapeHtml(view.householdName)}</p>
<p class="household-location muted">${view.location ? escapeHtml(view.location) : "No location set."}</p>`;
    modalIds.push(HOUSEHOLD_ADD_MEMBER_MODAL_ID, HOUSEHOLD_ADD_STORE_MODAL_ID);
    if (view.isOwner) {
        modalIds.push(HOUSEHOLD_ROTATE_TOKEN_MODAL_ID);
    }
    let storeModals = "";
    const stores = view.stores
        .map((store) => {
            const part = storeCard(store, view.canManage, view);
            storeModals += part.modals;
            if (view.canManage) {
                modalIds.push(storeRuleModalId(store.id));
            }
            return part.card;
        })
        .join("");
    let rulesModals = "";
    const memberRules = view.memberRules
        .map((row) => {
            const canEdit =
                view.canManage || row.member.userId === view.viewerUserId;
            const part = memberRulesCard(row, canEdit, view);
            rulesModals += part.modals;
            if (canEdit) {
                modalIds.push(householdMemberRulesModalId(row.member.userId));
            }
            return part.card;
        })
        .join("");

    const headerActions: string[] = [];
    if (view.canManage) {
        headerActions.push(
            modalTrigger({
                target: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
                label: "Add member",
                className: "btn-primary",
            }),
            modalTrigger({
                target: HOUSEHOLD_ADD_STORE_MODAL_ID,
                label: "Add store",
                className: "btn-primary",
            }),
        );
    }

    const pageModals = [
        view.canManage ? addMemberModal(view) : "",
        view.canManage
            ? modal({
                  id: HOUSEHOLD_ADD_STORE_MODAL_ID,
                  title: "Add store",
                  openOnLoad: modalOpen(view, HOUSEHOLD_ADD_STORE_MODAL_ID),
                  body: `${view.error && modalOpen(view, HOUSEHOLD_ADD_STORE_MODAL_ID) ? errorBanner(view.error) : ""}<form method="post" action="/settings/household/stores" class="add-store">
<label for="store_name">Grocery store</label>
<input id="store_name" name="name" required maxlength="80" autocomplete="off" />
<button type="submit" class="btn-primary">Add store</button>
</form>`,
              })
            : "",
        view.isOwner
            ? confirmModal({
                  id: HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
                  title: "Rotate household token",
                  message:
                      "Issue a new household bot token? The old token stops working immediately.",
                  action: "/settings/household/rotate-token",
                  confirmLabel: "Rotate token",
                  formClass: "rotate-token modal-confirm",
                  turboFalse: true,
                  openOnLoad: modalOpen(view, HOUSEHOLD_ROTATE_TOKEN_MODAL_ID),
              })
            : "",
        memberModals,
        storeModals,
        rulesModals,
    ].join("");

    const body = `
        ${pageHeader({
            title: "Household",
            actions: headerActions.length
                ? headerActions.join("\n")
                : undefined,
        })}
        ${pageLevelErrorBanner(view, modalIds)}
        ${renderSettingsNav("household")}
        ${token}
        ${panel({ title: "Household", body: householdCard })}
        ${panel({
            title: "Members",
            body: `<ul class="household-members list">${members}</ul>`,
        })}
        ${panel({
            title: "Grocery stores",
            body: `${stores || emptyState("Add a grocery store.", "empty-stores")}`,
        })}
        ${panel({ title: "Rules", body: memberRules })}
        ${pageModals}
    `;
    return renderAppShell({
        title: "Household",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}

/** @deprecated Use modal markup; kept for tests that import the form fields. */
export function addMemberFormHtml(error?: string): string {
    return `<form method="POST" action="/settings/household" class="add-member">
${addMemberFormBody(error)}
</form>`;
}
