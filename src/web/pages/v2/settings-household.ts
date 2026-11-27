import type { AppChromeBase } from "../../attention.js";
import type {
    HouseholdMember,
    RestockPreferences,
    SocialReadersPreferences,
} from "../../../household.js";
import { card } from "../../components/v2/card.js";
import { field } from "../../components/v2/field.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { initialsOf } from "../../initials.js";
import { APP_PATHS } from "../../route-map.js";
import {
    addMemberSheet,
    HOUSEHOLD_ADD_MEMBER_SHEET_ID,
} from "./settings-household-add-member.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import {
    SHARED_LINKS_PATH,
    type SharedLinkRow,
} from "./settings-household-shared-links.js";
import {
    HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
    rotateTokenSheet,
} from "./settings-household-token.js";
import { HOUSEHOLD_TIMEZONE_PATH } from "./settings-account-timezone.js";
import { READERS_PATH, readersSummary } from "./settings-readers.js";
import { RESTOCK_PATH, restockDayLabel } from "./settings-restock.js";
import { settingsErrorBanner } from "./settings-shared.js";

export const HOUSEHOLD_NAME_SHEET_ID = "fd-household-name";
export const HOUSEHOLD_LOCATION_SHEET_ID = "fd-household-location";

export const HOUSEHOLD_INVITES_PATH = "/settings/household/invites";

export type SettingsHouseholdV2View = {
    chrome: AppChromeBase;
    householdName: string;
    members: HouseholdMember[];
    /** How many stores the household has (the Stores row shows the count). */
    storeCount: number;
    /** How many fridge places the household has (the Fridge places row shows the count). */
    placeCount: number;
    /** Whether 'avocado' and 'Avocados' are one food when names are matched. */
    pluralsSameFood: boolean;
    isOwner: boolean;
    /** Owner or admin: edit the rows and add members. */
    canManage: boolean;
    /** Make and revoke invite codes (`member.manage`, the owner's today). */
    canInvite: boolean;
    viewerUserId: string;
    error?: string;
    /** The sheet `error` belongs to; it reopens on load. */
    openModalId?: string;
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
    /** The household's active share links; absent (the flag is off) leaves the row out. */
    sharedLinks?: readonly SharedLinkRow[];
};

export function roleLabel(role: HouseholdMember["role"]): string {
    // oxlint-disable-next-line foodable/no-raw-role-check -- a display label, not a permission decision
    if (role === "owner") return "Owner";
    // oxlint-disable-next-line foodable/no-raw-role-check -- a display label, not a permission decision
    if (role === "admin") return "Admin";
    return "Member";
}

/** The sheets an error can belong to; any other error is a banner. */
const SHEET_IDS: readonly string[] = [
    HOUSEHOLD_ADD_MEMBER_SHEET_ID,
    HOUSEHOLD_NAME_SHEET_ID,
    HOUSEHOLD_LOCATION_SHEET_ID,
];

function errorFor(view: SettingsHouseholdV2View, id: string) {
    return view.openModalId === id ? view.error : undefined;
}

function memberRow(
    view: SettingsHouseholdV2View,
    member: HouseholdMember,
): Html {
    const version = view.chrome.identity?.avatarVersions?.get(member.userId);
    return itemRow({
        title: member.displayName,
        value: roleLabel(member.role),
        lead: {
            kind: "avatar",
            initials: initialsOf(member.displayName),
            picture:
                version != null
                    ? { userId: member.userId, version }
                    : undefined,
        },
        trailing: { kind: "chevron" },
        href: `/settings/household/members/${encodeURIComponent(member.userId)}`,
    });
}

/** The Household rows. A viewer who cannot change a setting sees its value only. */
function householdRows(view: SettingsHouseholdV2View): Html[] {
    const edit = view.canManage;
    const timezone =
        view.householdTimezone ??
        (view.effectiveTimezoneDefaulted
            ? `${view.effectiveTimezone} (default)`
            : `${view.effectiveTimezone} (owner's)`);
    const editable = (sheetId: string) =>
        edit ? { trailing: { kind: "chevron" as const }, opens: sheetId } : {};
    const rows: Html[] = [
        itemRow({
            title: "Location",
            value: view.location ?? "Not set",
            ...editable(HOUSEHOLD_LOCATION_SHEET_ID),
        }),
        itemRow({
            title: "Time zone",
            value: timezone,
            ...(edit
                ? {
                      trailing: { kind: "chevron" as const },
                      href: HOUSEHOLD_TIMEZONE_PATH,
                  }
                : {}),
        }),
        itemRow({
            title: "Stores",
            value: String(view.storeCount),
            trailing: { kind: "chevron" },
            href: APP_PATHS.settingsStores,
        }),
        itemRow({
            title: "Fridge places",
            value: String(view.placeCount),
            trailing: { kind: "chevron" },
            href: APP_PATHS.settingsPlaces,
        }),
        itemRow({
            title: "Restock day",
            value: restockDayLabel(view.restock),
            trailing: { kind: "chevron" },
            href: RESTOCK_PATH,
        }),
    ];
    if (view.canInvite) {
        rows.push(
            itemRow({
                title: "Invite codes",
                trailing: { kind: "chevron" },
                href: HOUSEHOLD_INVITES_PATH,
            }),
        );
    }
    if (view.sharedLinks) {
        rows.push(
            itemRow({
                title: "Shared links",
                value: String(view.sharedLinks.length),
                trailing: { kind: "chevron" },
                href: SHARED_LINKS_PATH,
            }),
        );
    }
    rows.push(
        itemRow({
            title: "Recipe link readers",
            value: readersSummary(
                view.socialReaders ?? { tiktok: false, facebook: false },
            ),
            trailing: { kind: "chevron" },
            href: READERS_PATH,
        }),
    );
    rows.push(pluralsRow(view));
    return rows;
}

export const PLURALS_PATH = "/settings/household/plurals-same-food";

/** A switch for owners and admins; everyone else sees On or Off. */
function pluralsRow(view: SettingsHouseholdV2View): Html {
    const title = "Plurals are the same food";
    const subtitle = "Importing avocado matches Avocados";
    if (!view.canManage) {
        return itemRow({
            title,
            subtitle,
            value: view.pluralsSameFood ? "On" : "Off",
        });
    }
    return itemRow({
        title,
        subtitle,
        trailing: {
            kind: "toggle",
            on: view.pluralsSameFood,
            label: title,
            form: {
                action: PLURALS_PATH,
                fields: {
                    plurals_same_food: view.pluralsSameFood ? "false" : "true",
                },
            },
        },
    });
}

/** One-field edit sheet: the field in a form, Save in the action row. */
function editSheet(opts: {
    id: string;
    title: string;
    action: string;
    fields: Html;
    open: boolean;
}): string {
    const formId = `${opts.id}-form`;
    return sheet({
        id: opts.id,
        placement: "side",
        header: { kind: "title", title: opts.title },
        body: sheetSection({
            kind: "fields",
            content: raw(
                `<form id="${formId}" method="post" action="${esc(opts.action)}" class="fd-settings-sheet-form">${opts.fields}</form>`,
            ),
        }),
        actions: {
            kind: "pair",
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: opts.open,
    });
}

function editSheets(view: SettingsHouseholdV2View): string {
    if (!view.canManage) return "";
    const sheetFor = (
        id: string,
        title: string,
        action: string,
        fields: Html,
    ) =>
        editSheet({
            id,
            title,
            action,
            fields,
            open: view.openModalId === id,
        });
    return [
        sheetFor(
            HOUSEHOLD_NAME_SHEET_ID,
            "Household name",
            "/settings/household/name",
            field({
                id: "household_name",
                label: "Household name",
                name: "name",
                value: view.householdName,
                required: true,
                autocomplete: "off",
                error: errorFor(view, HOUSEHOLD_NAME_SHEET_ID),
            }),
        ),
        sheetFor(
            HOUSEHOLD_LOCATION_SHEET_ID,
            "Location",
            "/settings/household/location",
            field({
                id: "household_location",
                label: "Location",
                name: "location",
                value: view.location ?? "",
                autocomplete: "off",
                error: errorFor(view, HOUSEHOLD_LOCATION_SHEET_ID),
            }),
        ),
    ].join("");
}

/** The ⋯ menu: only what the viewer may do. No menu at all when they may do none. */
function moreMenu(view: SettingsHouseholdV2View): Html | undefined {
    const items: MenuItem[] = [];
    if (view.canManage) {
        items.push({
            kind: "opens",
            label: "Rename household",
            sheetId: HOUSEHOLD_NAME_SHEET_ID,
        });
    }
    // Owner only: the one fix for a leaked household bot token.
    if (view.isOwner) {
        items.push({
            kind: "opens",
            label: "Rotate household token",
            sheetId: HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
        });
    }
    return items.length > 0
        ? menu({ label: "Household actions", items, anchor: "more" })
        : undefined;
}

export function renderSettingsHouseholdV2Body(
    view: SettingsHouseholdV2View,
): string {
    const count = view.members.length;
    // A sheet's own error sits inside it; any other is a banner.
    const banner =
        view.openModalId && SHEET_IDS.includes(view.openModalId)
            ? ""
            : String(settingsErrorBanner(view.error));
    const memberRows = view.members.map((member) => memberRow(view, member));
    if (view.canManage) {
        memberRows.push(
            itemRow({
                title: "Add a member",
                lead: { kind: "icon", name: "plus" },
                opens: HOUSEHOLD_ADD_MEMBER_SHEET_ID,
            }),
        );
    }
    const parts = join([
        raw(banner),
        card({
            children: raw(
                `<span class="fd-settings-hh-name">${esc(view.householdName)}</span><span class="fd-settings-hh-count">${count} ${count === 1 ? "member" : "members"}</span>`,
            ),
            className: "fd-settings-hh-card",
        }),
        sectionHeader({ label: "Members", count, rule: false }),
        listGroup({ rows: memberRows, label: "Members" }),
        sectionHeader({ label: "Household", rule: false }),
        listGroup({ rows: householdRows(view), label: "Household" }),
    ]);
    const sheets = view.canManage
        ? addMemberSheet({
              canChooseRole: view.isOwner,
              error: errorFor(view, HOUSEHOLD_ADD_MEMBER_SHEET_ID),
              open: view.openModalId === HOUSEHOLD_ADD_MEMBER_SHEET_ID,
          })
        : "";
    const rotate = view.isOwner
        ? rotateTokenSheet({
              open: view.openModalId === HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
          })
        : "";
    return `${String(parts)}${sheets}${editSheets(view)}${rotate}`;
}

export function renderSettingsHouseholdV2Page(
    view: SettingsHouseholdV2View,
): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: "Household",
        backHref: APP_PATHS.settings,
        actions: moreMenu(view),
        body: renderSettingsHouseholdV2Body(view),
    });
}

export const SETTINGS_HOUSEHOLD_V2_MARKER = 'data-fd-settings-page="household"';
