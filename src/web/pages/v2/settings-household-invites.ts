import type { HouseholdInvite } from "../../../db/invites.js";
import type { HouseholdMember } from "../../../household.js";
import { escapeHtml, renderAppShell } from "../../shell.js";
import type { AppChromeBase } from "../../attention.js";
import { renderHouseholdNav } from "../../components/settings-nav.js";
import {
    confirmModal,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
    pageHeader,
    panel,
    row,
} from "../../components/ui.js";
import type { ViewerFlags } from "../../../viewer-flags.js";

export const INVITE_CREATE_MODAL_ID = "household-invite-create";
const CODE_ID = "household-invite-code";

export function inviteRevokeModalId(inviteId: string): string {
    return `household-invite-revoke-${inviteId}`;
}

export type HouseholdInvitesPageView = {
    chrome: AppChromeBase;
    flags?: ViewerFlags;
    backHref: string;
    member: HouseholdMember;
    invites: HouseholdInvite[];
    /** The plaintext code just created: shown on this response only. */
    createdCode?: string;
    error?: string;
    /** For tests and previews; defaults to the current time. */
    now?: Date;
};

function fmtDay(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10);
}

function isActive(invite: HouseholdInvite, nowMs: number): boolean {
    return !invite.usedAt && Date.parse(invite.expiresAt) > nowMs;
}

function inviteTitle(invite: HouseholdInvite, nowMs: number): string {
    if (invite.usedAt) return "Used";
    return isActive(invite, nowMs) ? "Active" : "Expired";
}

function inviteMeta(invite: HouseholdInvite, nowMs: number): string {
    if (invite.usedAt) return `Used ${fmtDay(invite.usedAt)}`;
    const verb = isActive(invite, nowMs) ? "Expires" : "Expired";
    return `${verb} ${fmtDay(invite.expiresAt)}`;
}

function fromField(backHref: string): Record<string, string> {
    return backHref !== "/" ? { from: backHref } : {};
}

export function renderHouseholdInvitesPage(
    view: HouseholdInvitesPageView,
): string {
    const nowMs = (view.now ?? new Date()).getTime();
    const revokeModals: string[] = [];
    const rows = view.invites.map((invite) => {
        let actions = "";
        if (isActive(invite, nowMs)) {
            const id = inviteRevokeModalId(invite.id);
            actions = modalTrigger({
                target: id,
                label: "Revoke",
                className: "btn-sm btn-danger",
            });
            revokeModals.push(
                confirmModal({
                    id,
                    title: "Revoke invite",
                    message:
                        "Revoke this invite code? Nobody can sign up with it afterwards.",
                    action: "/settings/household/invites/revoke",
                    confirmLabel: "Revoke",
                    hiddenFields: {
                        invite_id: invite.id,
                        ...fromField(view.backHref),
                    },
                }),
            );
        }
        return `<li class="household-invite">${row({
            title: inviteTitle(invite, nowMs),
            meta: inviteMeta(invite, nowMs),
            actions,
        })}</li>`;
    });

    const revealed = view.createdCode
        ? panel({
              title: "New invite code",
              className: "invite-code-once",
              body: `<p><code id="${CODE_ID}">${escapeHtml(view.createdCode)}</code></p>
<p class="muted">Send this code to the person joining. It works once, expires in 7 days, and is not shown again.</p>
<button type="button" class="btn-primary" data-copy-target="${CODE_ID}">Copy code</button>`,
          })
        : "";

    const fromInput =
        view.backHref !== "/"
            ? `<input type="hidden" name="from" value="${escapeHtml(view.backHref)}" />\n`
            : "";
    // The success response carries the one-time code as a 200 page, so this
    // form opts out of Turbo (like rotating the household token).
    const createModal = modal({
        id: INVITE_CREATE_MODAL_ID,
        title: "Create invite",
        openOnLoad: Boolean(view.error),
        body: `${errorBanner(view.error)}<form method="post" action="/settings/household/invites" class="invite-create" data-turbo="false">
${fromInput}<p class="modal-message">Create a single-use code that lets one person sign up into this household. It expires in 7 days.</p>
<div class="modal-actions">
<button type="button" command="close" commandfor="${INVITE_CREATE_MODAL_ID}">Cancel</button>
<button type="submit" class="btn-primary">Create invite</button>
</div>
</form>`,
    });

    const body = `
        ${pageHeader({
            title: "Invite codes",
            sub: `<p class="muted">Let one person sign up into this household.</p>`,
            actions: modalTrigger({
                target: INVITE_CREATE_MODAL_ID,
                label: "Create invite",
                className: "btn-primary",
            }),
        })}
        ${renderHouseholdNav("members", {
            possibleDuplicates: view.chrome.householdPossibleDuplicates,
        })}
        ${revealed}
        ${panel({
            title: "Invites",
            body: rows.length
                ? `<ul class="household-invites list">${rows.join("")}</ul>`
                : emptyState("No invite codes yet."),
        })}
        ${createModal}
        ${revokeModals.join("")}
    `;

    return renderAppShell({
        ...view.chrome,
        title: "Invite codes",
        active: "household",
        body,
    });
}
