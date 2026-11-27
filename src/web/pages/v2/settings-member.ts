import type { AppChromeBase } from "../../attention.js";
import type { HouseholdMember } from "../../../household.js";
import { lastActiveLabel } from "../../../domain/last-active.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menuRow, type MenuItem } from "../../components/v2/menu.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { roleLabel } from "./settings-household.js";
import { settingsErrorBanner } from "./settings-shared.js";

/** The dialog the Make owner menu item opens. */
export const MEMBER_MAKE_OWNER_SHEET_ID = "fd-member-make-owner";

/** The dialog the Remove row opens. */
export const MEMBER_REMOVE_SHEET_ID = "fd-member-remove";

export type SettingsMemberV2View = {
    chrome: AppChromeBase;
    member: HouseholdMember;
    viewer: HouseholdMember;
    todayHref?: string;
    error?: string;
    /**
     * What the viewer may do to this person, each as the route will decide it
     * (`checkManagedMember`). Without it, or with none true, the page has no
     * Role drop-down and no Remove row.
     */
    manage?: { role: boolean; transfer: boolean; remove: boolean };
    /** When this person was last active; null = never; absent leaves the row out. */
    lastSeen?: Date | null;
    /** The clock the label reads; defaults to the real one. */
    now?: Date;
    /** The viewer's zone, for "Today" and "Yesterday". */
    timezone?: string;
    /** Opens the Make owner or Remove confirm on load (previews). */
    openModalId?: string;
};

function memberPath(member: HouseholdMember): string {
    return `/settings/household/members/${encodeURIComponent(member.userId)}`;
}

/**
 * The Role row. The owner gets a drop-down (Member, Admin, Owner); Member and
 * Admin post the role route and Owner opens its confirm sheet. Anyone else sees
 * the plain value. The routes decide again (`checkManagedMember`); this only
 * follows what they will allow.
 */
function roleRow(view: SettingsMemberV2View): Html {
    const { member, manage } = view;
    const value = roleLabel(member.role);
    const items: MenuItem[] = [];
    if (manage?.role) {
        for (const choice of ["member", "admin"] as const) {
            items.push({
                kind: "checked",
                label: roleLabel(choice),
                checked: member.role === choice,
                current: member.role === choice,
                action: `${memberPath(member)}/role`,
                fields: { role: choice },
            });
        }
    }
    if (manage?.transfer) {
        items.push({
            kind: "opens",
            label: roleLabel("owner"),
            sheetId: MEMBER_MAKE_OWNER_SHEET_ID,
        });
    }
    if (items.length === 0) return itemRow({ title: "Role", value });
    return menuRow({
        label: `Role of ${member.displayName}`,
        row: { title: "Role", value },
        items,
    });
}

/** The red row at the bottom, like Log out: it opens the confirm sheet. */
function removeRow(member: HouseholdMember): Html {
    return itemRow({
        title: `Remove ${member.displayName}`,
        opens: MEMBER_REMOVE_SHEET_ID,
        className: "fd-item-row--danger",
    });
}

function makeOwnerSheet(member: HouseholdMember, open: boolean): string {
    const formId = `${MEMBER_MAKE_OWNER_SHEET_ID}-form`;
    return sheet({
        id: MEMBER_MAKE_OWNER_SHEET_ID,
        placement: "dialog",
        header: {
            kind: "title",
            title: `Make ${member.displayName} the owner?`,
        },
        body: sheetSection({
            kind: "custom",
            content: raw(
                `<form id="${formId}" method="post" action="${esc(memberPath(member))}/make-owner"><p class="fd-sheet__text">You become a member. Only ${esc(member.displayName)} can undo this.</p></form>`,
            ),
        }),
        actions: {
            kind: "destructive",
            danger: { label: "Make owner", type: "submit", form: formId },
        },
        openOnLoad: open,
    });
}

function removeSheet(member: HouseholdMember, open: boolean): string {
    const formId = `${MEMBER_REMOVE_SHEET_ID}-form`;
    return sheet({
        id: MEMBER_REMOVE_SHEET_ID,
        placement: "dialog",
        header: { kind: "title", title: `Remove ${member.displayName}?` },
        body: sheetSection({
            kind: "custom",
            content: raw(
                `<form id="${formId}" method="post" action="${esc(memberPath(member))}/remove"><input type="hidden" name="confirm" value="yes"><p class="fd-sheet__text">${esc(member.displayName)} loses access, and their login, meals, water, weight, goals, allergens, dislikes and own rules are erased for good. The household's fridge, groceries, recipes and foods stay.</p></form>`,
            ),
        }),
        actions: {
            kind: "destructive",
            danger: { label: "Remove", type: "submit", form: formId },
        },
        openOnLoad: open,
    });
}

export function renderSettingsMemberV2Body(view: SettingsMemberV2View): string {
    const { member } = view;
    const version = view.chrome.identity?.avatarVersions?.get(member.userId);
    const rows: Html[] = [
        itemRow({ title: "Name", value: member.displayName }),
        roleRow(view),
    ];
    if (view.lastSeen !== undefined) {
        rows.push(
            itemRow({
                title: "Last active",
                value: lastActiveLabel(
                    view.lastSeen,
                    view.now ?? new Date(),
                    view.timezone ?? "UTC",
                ),
            }),
        );
    }
    if (view.todayHref != null) {
        rows.push(
            itemRow({
                title: "Today",
                trailing: { kind: "chevron" },
                href: view.todayHref,
            }),
        );
    }
    const head = raw(
        `<div class="fd-settings-member-head">${memberAvatar({ name: member.displayName, userId: member.userId, version, enabled: true, className: "fd-settings-member-head__avatar" })}<h2 class="fd-settings-member-head__name">${esc(member.displayName)}</h2></div>`,
    );
    const sheets = view.manage?.transfer
        ? makeOwnerSheet(
              member,
              view.openModalId === MEMBER_MAKE_OWNER_SHEET_ID,
          )
        : "";
    const remove = view.manage?.remove
        ? listGroup({ rows: [removeRow(member)], label: "Remove" })
        : "";
    return `${String(join([settingsErrorBanner(view.error), head, listGroup({ rows, label: "Member" }), remove]))}${sheets}${view.manage?.remove ? removeSheet(member, view.openModalId === MEMBER_REMOVE_SHEET_ID) : ""}`;
}

export function renderSettingsMemberV2Page(view: SettingsMemberV2View): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: view.member.displayName,
        body: renderSettingsMemberV2Body(view),
    });
}

export const SETTINGS_MEMBER_V2_MARKER = "fd-settings-member-head";
