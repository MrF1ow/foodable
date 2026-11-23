import type { AppChromeBase } from "../../attention.js";
import type {
    HouseholdMember,
    RestockPreferences,
    SocialReadersPreferences,
} from "../../../household.js";
import type { NoticesForResult } from "../../../domain/notices-for.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { rowList, sectionHeader } from "../../components/v2/rows.js";
import { iconChevronRight, iconPlus } from "../../components/v2/icons.js";
import { modalTrigger } from "../../components/ui.js";
import {
    HOUSEHOLD_ADD_MEMBER_MODAL_ID,
    HOUSEHOLD_MANAGE_ID,
    HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
    manageFill,
    memberActionsTemplate,
    renderHouseholdV2OwnerModals,
} from "./settings-household-modals.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";
import { actionRow, STORES_PATH } from "./settings-stores.js";
import {
    renderSharedLinksSection,
    type SharedLinkRow,
} from "./settings-household-shared-links.js";
import { lastActiveLabel } from "../../../domain/last-active.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import {
    householdEditSheet,
    householdRow,
    householdRowCard,
    ROW_ICONS,
    textInputField,
    timeZoneSelect,
} from "./settings-household-rows.js";
import { RESTOCK_PATH, restockSummary } from "./settings-restock.js";
import { READERS_PATH, readersSummary } from "./settings-readers.js";
import { settingsField } from "./settings-shared.js";

export const HOUSEHOLD_NAME_SHEET_ID = "fd-household-name";
export const HOUSEHOLD_LOCATION_SHEET_ID = "fd-household-location";
export const HOUSEHOLD_TIMEZONE_SHEET_ID = "fd-household-timezone";
export const HOUSEHOLD_EXPIRY_SHEET_ID = "fd-household-expiry";

export type SettingsHouseholdV2View = {
    chrome: AppChromeBase;
    householdName: string;
    members: HouseholdMember[];
    /** How many stores the household has (the Stores row shows the count). */
    storeCount: number;
    isOwner: boolean;
    canManage: boolean;
    viewerUserId: string;
    error?: string;
    openModalId?: string;
    issuedToken?: string;
    socialReaders?: SocialReadersPreferences;
    /** Where the household shops, free text; null = not set. */
    location: string | null;
    /** The household's own zone; null = it follows the owner's. */
    householdTimezone: string | null;
    /** The zone in effect (the household's, else the owner's, else UTC). */
    effectiveTimezone: string;
    /** True when neither the household nor its owner has a zone, so UTC is only the fallback. */
    effectiveTimezoneDefaulted?: boolean;
    restock: RestockPreferences;
    unverifiedRecipeExpiryDays: number | null;
    timezone?: string;
    /** When each member was last active, by user id; null = never. Without it the column is left out. */
    lastSeen?: ReadonlyMap<string, Date | null>;
    /** The clock the last-active labels read; defaults to the real one. */
    now?: Date;
    /** The household's active share links; absent leaves the section out. */
    sharedLinks?: readonly SharedLinkRow[];
    noticeResult: NoticesForResult;
};

function roleLabel(role: HouseholdMember["role"]): string {
    // oxlint-disable-next-line foodable/no-raw-role-check -- a display label, not a permission decision
    if (role === "owner") return "Owner";
    // oxlint-disable-next-line foodable/no-raw-role-check -- a display label, not a permission decision
    if (role === "admin") return "Admin";
    return "Member";
}

function pageLevelError(view: SettingsHouseholdV2View): Html {
    if (!view.error) return raw("");
    const modalOnly =
        view.openModalId === HOUSEHOLD_ADD_MEMBER_MODAL_ID ||
        view.openModalId === HOUSEHOLD_ROTATE_TOKEN_MODAL_ID ||
        view.openModalId === HOUSEHOLD_NAME_SHEET_ID ||
        view.openModalId === HOUSEHOLD_LOCATION_SHEET_ID ||
        view.openModalId === HOUSEHOLD_TIMEZONE_SHEET_ID ||
        view.openModalId === HOUSEHOLD_EXPIRY_SHEET_ID;
    if (modalOnly) return raw("");
    return settingsErrorBanner(view.error);
}

/** Whether this row offers Manage. Mirrors `checkManagedMember`: only the
 * owner manages anyone, and never their own row. */
function canManageRow(
    view: SettingsHouseholdV2View,
    member: HouseholdMember,
): boolean {
    return view.isOwner && member.userId !== view.viewerUserId;
}

function memberRow(
    view: SettingsHouseholdV2View,
    member: HouseholdMember,
): Html {
    const href = `/settings/household/members/${encodeURIComponent(member.userId)}`;
    const manage = canManageRow(view, member)
        ? modalTrigger({
              target: HOUSEHOLD_MANAGE_ID,
              label: "Manage",
              className: "fd-settings-btn fd-settings-btn--sm",
              fill: manageFill(member),
          })
        : "";
    const template = canManageRow(view, member)
        ? memberActionsTemplate(member)
        : "";
    // Without Manage the chevron sits inside the link, so it navigates too.
    const chevron = manage
        ? ""
        : `<span class="fd-row__chevron" aria-hidden="true">${String(iconChevronRight())}</span>`;
    const trailing = manage
        ? `<div class="fd-row__trailing">${manage}</div>`
        : "";
    // Desktop only (CSS): the phone list stays name and role.
    const lastActive = view.lastSeen
        ? `<span class="fd-row__last-active">${esc(
              lastActiveLabel(
                  view.lastSeen.get(member.userId) ?? null,
                  view.now ?? new Date(),
                  view.timezone ?? "UTC",
              ),
          )}</span>`
        : "";
    return raw(
        `${template}<li class="fd-row fd-row--usual fd-row--settings-member"><div class="fd-row__body fd-row__body--with-trailing"><a class="fd-row__link" href="${esc(href)}">${String(memberAvatar({ name: member.displayName, userId: member.userId, version: view.chrome.identity?.avatarVersions?.get(member.userId), enabled: true, className: "fd-settings-member-avatar" }))}<div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(member.displayName)}</span><span class="fd-row__meta fd-row__meta--lg">${esc(roleLabel(member.role))}</span></span></div>${lastActive}${chevron}</a>${trailing}</div></li>`,
    );
}

/** The desktop column titles above the members; hidden on the phone. */
function membersHead(view: SettingsHouseholdV2View): Html {
    if (!view.lastSeen) return raw("");
    return raw(
        `<div class="fd-settings-members-head" aria-hidden="true"><span>Member</span><span>Role</span><span>Last active</span></div>`,
    );
}

/** The members, then (for a viewer who can add members) the Add a member row. */
function memberRows(view: SettingsHouseholdV2View): readonly Html[] {
    const rows = view.members.map((member) => memberRow(view, member));
    if (view.canManage) {
        rows.push(
            actionRow({
                variant: "add-member",
                target: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
                label: "Add a member",
                icon: iconPlus(),
            }),
        );
    }
    return rows;
}

const ADD_MEMBER_HINT =
    "Members sign in with the email or username and password you give them.";

/** The household name as the page title, with the member count under it. */
function householdHead(view: SettingsHouseholdV2View): Html {
    const count = view.members.length;
    const sub = `${count} ${count === 1 ? "member" : "members"} · one fridge, one grocery list`;
    return raw(
        `<header class="fd-settings-hh-head"><h1 class="fd-settings-title fd-settings-hh-title">${esc(view.householdName)}</h1><p class="fd-settings-hh-sub">${esc(sub)}</p></header>`,
    );
}

function errorFor(view: SettingsHouseholdV2View, id: string) {
    return view.openModalId === id ? view.error : undefined;
}

function expiryLabel(days: number | null): string {
    return days == null ? "Never" : `${days} ${days === 1 ? "day" : "days"}`;
}

/** The nine rows of the Household group, as in the design. */
function householdGroup(view: SettingsHouseholdV2View): Html {
    const edit = view.canManage;
    const rows: Html[] = [
        householdRow({
            icon: ROW_ICONS.edit,
            label: "Household name",
            value: view.householdName,
            sheetId: edit ? HOUSEHOLD_NAME_SHEET_ID : undefined,
        }),
        householdRow({
            icon: ROW_ICONS.pin,
            label: "Location",
            value: view.location ?? "Not set",
            sheetId: edit ? HOUSEHOLD_LOCATION_SHEET_ID : undefined,
        }),
        householdRow({
            icon: ROW_ICONS.clock,
            label: "Time zone",
            value:
                view.householdTimezone ??
                (view.effectiveTimezoneDefaulted
                    ? `${view.effectiveTimezone} (default)`
                    : `${view.effectiveTimezone} (owner's)`),
            sheetId: edit ? HOUSEHOLD_TIMEZONE_SHEET_ID : undefined,
        }),
        householdRow({
            icon: ROW_ICONS.cart,
            label: "Stores",
            value: String(view.storeCount),
            href: STORES_PATH,
        }),
        householdRow({
            icon: ROW_ICONS.calendar,
            label: "Restock day",
            value: restockSummary(view.restock),
            href: RESTOCK_PATH,
        }),
        householdRow({
            icon: ROW_ICONS.link,
            label: "Recipe link readers",
            value: readersSummary(
                view.socialReaders ?? { tiktok: false, facebook: false },
            ),
            href: READERS_PATH,
        }),
        householdRow({
            icon: ROW_ICONS.hourglass,
            label: "Unverified recipes",
            value: expiryLabel(view.unverifiedRecipeExpiryDays),
            sheetId: edit ? HOUSEHOLD_EXPIRY_SHEET_ID : undefined,
        }),
    ];
    // Owner only: the one fix for a leaked household bot token.
    if (view.isOwner) {
        rows.push(
            householdRow({
                icon: ROW_ICONS.refresh,
                label: "Rotate join token",
                modalId: HOUSEHOLD_ROTATE_TOKEN_MODAL_ID,
            }),
        );
    }
    return householdRowCard(rows, "Household");
}

function editSheets(view: SettingsHouseholdV2View): string {
    if (!view.canManage) return "";
    const tz = settingsField({
        id: "household_timezone",
        label: "Time zone",
        control: timeZoneSelect({
            id: "household_timezone",
            name: "timezone",
            stored: view.householdTimezone,
            emptyLabel: "Use the owner's time zone",
        }),
    });
    return [
        householdEditSheet({
            id: HOUSEHOLD_NAME_SHEET_ID,
            title: "Household name",
            action: "/settings/household/name",
            fields: textInputField({
                id: "household_name",
                label: "Household name",
                name: "name",
                value: view.householdName,
                maxlength: 80,
                required: true,
            }),
            error: errorFor(view, HOUSEHOLD_NAME_SHEET_ID),
            open: view.openModalId === HOUSEHOLD_NAME_SHEET_ID,
        }),
        householdEditSheet({
            id: HOUSEHOLD_LOCATION_SHEET_ID,
            title: "Location",
            subtitle:
                "Where the household shops, such as a city or a postcode.",
            action: "/settings/household/location",
            fields: textInputField({
                id: "household_location",
                label: "Location",
                name: "location",
                value: view.location ?? "",
                maxlength: 120,
            }),
            error: errorFor(view, HOUSEHOLD_LOCATION_SHEET_ID),
            open: view.openModalId === HOUSEHOLD_LOCATION_SHEET_ID,
        }),
        householdEditSheet({
            id: HOUSEHOLD_TIMEZONE_SHEET_ID,
            title: "Time zone",
            subtitle: "Days, the restock time and notices count in this zone.",
            action: "/settings/household/timezone",
            fields: String(tz),
            error: errorFor(view, HOUSEHOLD_TIMEZONE_SHEET_ID),
            open: view.openModalId === HOUSEHOLD_TIMEZONE_SHEET_ID,
        }),
        householdEditSheet({
            id: HOUSEHOLD_EXPIRY_SHEET_ID,
            title: "Unverified recipes",
            subtitle:
                "Imported recipes that were never verified are removed after this many days. Leave it empty to keep them.",
            action: "/settings/household/recipe-settings",
            fields: textInputField({
                id: "unverified_recipe_expiry_days",
                label: "Remove after (days)",
                name: "unverified_recipe_expiry_days",
                value:
                    view.unverifiedRecipeExpiryDays == null
                        ? ""
                        : String(view.unverifiedRecipeExpiryDays),
                inputmode: "numeric",
            }),
            error: errorFor(view, HOUSEHOLD_EXPIRY_SHEET_ID),
            open: view.openModalId === HOUSEHOLD_EXPIRY_SHEET_ID,
        }),
    ].join("");
}

export function renderSettingsHouseholdV2Body(
    view: SettingsHouseholdV2View,
): string {
    const token = view.issuedToken
        ? `<p class="fd-settings-token">Household bot token (shown once): <code>${esc(view.issuedToken)}</code></p>`
        : "";

    const modals = renderHouseholdV2OwnerModals(view);

    const sections = join([
        raw(token),
        raw(
            `<div class="fd-settings-members-card">${String(membersHead(view))}${String(rowList(memberRows(view), { label: "Members" }))}</div>${view.canManage ? `<p class="fd-stores-hint">${esc(ADD_MEMBER_HINT)}</p>` : ""}`,
        ),
        raw(
            `${String(sectionHeader({ title: "Household", level: 2 }))}<div class="fd-settings-hh">${String(householdGroup(view))}</div>`,
        ),
        view.sharedLinks ? raw(renderSharedLinksSection(view.sharedLinks)) : "",
    ]);

    return `${String(householdHead(view))}${String(pageLevelError(view))}<div class="fd-settings-household">${String(sections)}</div>${editSheets(view)}<div class="native fd-settings-household-modals">${modals}</div>`;
}

export function renderSettingsHouseholdV2Page(
    view: SettingsHouseholdV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: "Household",
        body: renderSettingsHouseholdV2Body(view),
    });
}

export const SETTINGS_HOUSEHOLD_V2_MARKER = 'data-fd-settings-page="household"';
