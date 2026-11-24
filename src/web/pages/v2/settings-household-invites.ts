import type { HouseholdInvite } from "../../../db/invites.js";
import type { HouseholdMember } from "../../../household.js";
import type { AppChromeBase } from "../../attention.js";
import { button } from "../../components/v2/button.js";
import { card } from "../../components/v2/card.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { icon } from "../../components/v2/icon.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { APP_PATHS } from "../../route-map.js";
import type { ViewerFlags } from "../../../viewer-flags.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { settingsErrorBanner } from "./settings-shared.js";

export type HouseholdInvitesPageView = {
    chrome: AppChromeBase;
    flags?: ViewerFlags;
    /** Where the phone back arrow goes; "/" (nothing asked for) means the Household page. */
    backHref: string;
    member: HouseholdMember;
    invites: HouseholdInvite[];
    /** The plaintext code just created: shown on this response only. */
    createdCode?: string;
    error?: string;
    /** For tests and previews; defaults to the current time. */
    now?: Date;
};

const CODE_ID = "household-invite-code";

const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/** "Nov 24"; with the year when it is not this one. */
function fmtDay(iso: string, now: Date): string {
    const at = new Date(iso);
    const day = `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}`;
    return at.getUTCFullYear() === now.getUTCFullYear()
        ? day
        : `${day}, ${at.getUTCFullYear()}`;
}

function isActive(invite: HouseholdInvite, nowMs: number): boolean {
    return !invite.usedAt && Date.parse(invite.expiresAt) > nowMs;
}

function inviteTitle(invite: HouseholdInvite, nowMs: number): string {
    if (invite.usedAt) return "Used";
    return isActive(invite, nowMs) ? "Active" : "Expired";
}

function inviteMeta(invite: HouseholdInvite, now: Date): string {
    if (invite.usedAt) return `Used ${fmtDay(invite.usedAt, now)}`;
    const verb = isActive(invite, now.getTime()) ? "Expires" : "Expired";
    return `${verb} ${fmtDay(invite.expiresAt, now)}`;
}

function fromFields(backHref: string): Record<string, string> {
    return backHref !== "/" ? { from: backHref } : {};
}

/**
 * The + that makes a code. The success response is a 200 page carrying the
 * one-time code, which Turbo would drop, so the form is a full page load.
 */
function createControl(backHref: string): Html {
    const from = Object.entries(fromFields(backHref))
        .map(
            ([name, value]) =>
                `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`,
        )
        .join("");
    return raw(
        `<form method="post" action="/settings/household/invites" class="fd-settings-invite-create" data-turbo="false">${from}${button({ label: "Create invite", round: true, icon: "plus", type: "submit" })}</form>`,
    );
}

/** The code just made, with a copy button; shown on this response only. */
function newCode(code: string): Html {
    return card({
        children: raw(
            `<div class="fd-settings-invite-code" data-fd-copy-address><span class="fd-settings-invite-code__label">New invite code</span><div class="fd-settings-invite-code__box"><code id="${CODE_ID}" data-fd-copy-source>${esc(code)}</code><button type="button" class="fd-settings-invite-code__copy" data-fd-copy-trigger aria-label="Copy code">${icon("copy", 20)}</button></div><p class="fd-settings-invite-code__note">Works once · expires in 7 days · shown only now</p></div><p class="fd-visually-hidden" role="status" aria-live="polite" data-fd-copy-status></p>`,
        ),
    });
}

function inviteRow(invite: HouseholdInvite, now: Date, backHref: string): Html {
    const nowMs = now.getTime();
    const control = isActive(invite, nowMs)
        ? {
              kind: "control" as const,
              html: menu({
                  label: "Actions for this invite code",
                  anchor: "more",
                  items: [
                      {
                          kind: "destructive",
                          label: "Revoke",
                          confirmLabel: "Revoke invite",
                          action: "/settings/household/invites/revoke",
                          fields: {
                              invite_id: invite.id,
                              ...fromFields(backHref),
                          },
                      },
                  ],
              }),
          }
        : undefined;
    return itemRow({
        title: inviteTitle(invite, nowMs),
        subtitle: inviteMeta(invite, now),
        trailing: control,
    });
}

export function renderHouseholdInvitesPage(
    view: HouseholdInvitesPageView,
): string {
    const now = view.now ?? new Date();
    const rows = view.invites.map((invite) =>
        inviteRow(invite, now, view.backHref),
    );
    const body = join([
        settingsErrorBanner(view.error),
        view.createdCode ? newCode(view.createdCode) : "",
        sectionHeader({ label: "Invites", rule: false }),
        rows.length > 0
            ? listGroup({ rows, label: "Invites" })
            : emptyState({ title: "No invite codes yet" }),
    ]);
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: "Invite codes",
        backHref:
            view.backHref !== "/" ? view.backHref : APP_PATHS.settingsHousehold,
        actions: createControl(view.backHref),
        body,
    });
}
