import { escapeHtml } from "../../shell.js";
import { MIN_PASSWORD_LENGTH } from "../../../domain/auth.js";
import type { HouseholdMember } from "../../../household.js";
import { sharedDialogItem } from "../../components/shared-dialog.js";
import {
    confirmModal,
    errorBanner,
    modal,
    modalTrigger,
    field,
    type ModalFill,
} from "../../components/ui.js";
import {
    SOCIAL_READER_FACEBOOK_CAVEAT,
    SOCIAL_READER_LABELS,
    SOCIAL_READER_RESEARCH_URL,
    SOCIAL_READER_RISK_INTRO,
    socialReaderConfirmLabel,
    socialReaderTurnOnLabel,
    type SocialReaderId,
} from "../../../copy/social-readers.js";

/** What the owner and admin dialogs need from the Household page. */
export type HouseholdOwnerModalsView = {
    members: HouseholdMember[];
    /** Owner only: roles, removal, transfer. */
    isOwner: boolean;
    /** Owner or admin: add a member, add a store. */
    canManage: boolean;
    error?: string;
    openModalId?: string;
};

export const HOUSEHOLD_ADD_MEMBER_MODAL_ID = "household-add-member";
export const HOUSEHOLD_ADD_STORE_MODAL_ID = "household-add-store";
export const HOUSEHOLD_ROTATE_TOKEN_MODAL_ID = "household-rotate-token";
export const HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID =
    "household-social-reader-tiktok";
export const HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID =
    "household-social-reader-facebook";

function socialReaderRiskBlock(): string {
    return `<p class="hint">${escapeHtml(SOCIAL_READER_RISK_INTRO)} <a href="${SOCIAL_READER_RESEARCH_URL}" target="_blank" rel="noopener noreferrer">Terms research</a>.</p>`;
}

function socialReaderEnableModal(
    reader: SocialReaderId,
    modalId: string,
    view: HouseholdOwnerModalsView,
): string {
    const open = view.openModalId === modalId;
    const label = SOCIAL_READER_LABELS[reader];
    const extra =
        reader === "facebook"
            ? `<p class="hint">${escapeHtml(SOCIAL_READER_FACEBOOK_CAVEAT)}</p>`
            : "";
    return modal({
        id: modalId,
        title: `Turn on ${label} reader`,
        openOnLoad: open,
        body: `${open && view.error ? errorBanner(view.error) : ""}<form method="post" action="/settings/household/social-readers" class="modal-confirm social-reader-enable">
<input type="hidden" name="reader" value="${reader}" />
<input type="hidden" name="enabled" value="1" />
<p class="modal-message">Enable automatic reading of ${escapeHtml(label)} captions for recipe imports?</p>
${socialReaderRiskBlock()}
${extra}
<label><input type="checkbox" name="confirm" value="1" required /> ${escapeHtml(socialReaderConfirmLabel(reader))}</label>
<div class="modal-actions">
<button type="button" command="close" commandfor="${escapeHtml(modalId)}">Cancel</button>
<button type="submit" class="btn-primary">${escapeHtml(socialReaderTurnOnLabel(reader))}</button>
</div>
</form>`,
    });
}

/** One manage, make-owner, and remove dialog for every member. */
export const HOUSEHOLD_MANAGE_ID = "household-manage";
const HOUSEHOLD_REMOVE_ID = "household-remove";
const HOUSEHOLD_MAKE_OWNER_ID = "household-make-owner";
const MANAGE_PREFIX = "household-manage-";
const REMOVE_PREFIX = "household-remove-";
const OWNER_PREFIX = "household-make-owner-";

function modalOpen(view: HouseholdOwnerModalsView, id: string): boolean {
    return view.openModalId === id;
}

function managedMembers(view: HouseholdOwnerModalsView): HouseholdMember[] {
    if (!view.isOwner) return [];
    return view.members.filter((member) => member.role !== "owner");
}

function findManagedMember(
    view: HouseholdOwnerModalsView,
    id: string,
): HouseholdMember | null {
    return managedMembers(view).find((member) => member.userId === id) ?? null;
}

function memberMatch(view: HouseholdOwnerModalsView, prefix: string) {
    return sharedDialogItem({
        openModalId: view.openModalId,
        prefix,
        lookup: (id) => findManagedMember(view, id),
    });
}

function addMemberFormBody(error?: string): string {
    return `${errorBanner(error)}
${field({ id: "add_display_name", label: "Name", control: `<input id="add_display_name" name="display_name" required maxlength="80" />` })}
${field({ id: "add_login", label: "Email or username", control: `<input id="add_login" name="login" required autocomplete="off" autocapitalize="none" spellcheck="false" />` })}
<p class="hint">A username has no @: 2–31 letters, digits, dots, dashes or underscores. They sign in with it on the same login page.</p>
${field({ id: "add_password", label: "Password", control: `<input id="add_password" name="password" type="password" required minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password" />` })}
<button type="submit" class="btn-primary">Add member</button>`;
}

function addMemberModal(view: HouseholdOwnerModalsView): string {
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

export function manageFill(member: HouseholdMember): ModalFill {
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

export function memberActionsTemplate(member: HouseholdMember): string {
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

function sharedMemberDialogs(view: HouseholdOwnerModalsView): string {
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

/** Owner/admin dialogs for the household settings page (add member, stores, token, roles). */
export function renderHouseholdV2OwnerModals(
    view: HouseholdOwnerModalsView,
): string {
    return [
        view.canManage ? addMemberModal(view) : "",
        view.canManage
            ? modal({
                  id: HOUSEHOLD_ADD_STORE_MODAL_ID,
                  title: "Add store",
                  openOnLoad: modalOpen(view, HOUSEHOLD_ADD_STORE_MODAL_ID),
                  body: `${view.error && modalOpen(view, HOUSEHOLD_ADD_STORE_MODAL_ID) ? errorBanner(view.error) : ""}<form method="post" action="/settings/household/stores" class="add-store">
${field({ id: "store_name", label: "Grocery store", control: `<input id="store_name" name="name" required maxlength="80" autocomplete="off" />` })}
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
                  // The route answers 200 HTML carrying the one-time secret.
                  turboFalse: true,
                  openOnLoad: modalOpen(view, HOUSEHOLD_ROTATE_TOKEN_MODAL_ID),
              })
            : "",
        sharedMemberDialogs(view),
        socialReaderEnableModal(
            "tiktok",
            HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
            view,
        ),
        socialReaderEnableModal(
            "facebook",
            HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID,
            view,
        ),
    ].join("");
}
