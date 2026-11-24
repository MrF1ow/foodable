import type { AppChromeBase } from "../../attention.js";
import type { HouseholdMember } from "../../../household.js";
import { lastActiveLabel } from "../../../domain/last-active.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";
import { roleLabel } from "./settings-household.js";
import { settingsErrorBanner } from "./settings-shared.js";

/** The dialog the Make owner menu item opens. */
export const MEMBER_MAKE_OWNER_SHEET_ID = "fd-member-make-owner";

export type SettingsMemberV2View = {
    chrome: AppChromeBase;
    member: HouseholdMember;
    viewer: HouseholdMember;
    todayHref?: string;
    error?: string;
    /**
     * What the viewer may do to this person, each as the route will decide it
     * (`checkManagedMember`). Without it, or with none true, the page has no ⋯ menu.
     */
    manage?: { role: boolean; transfer: boolean; remove: boolean };
    /** When this person was last active; null = never; absent leaves the row out. */
    lastSeen?: Date | null;
    /** The clock the label reads; defaults to the real one. */
    now?: Date;
    /** The viewer's zone, for "Today" and "Yesterday". */
    timezone?: string;
    /** Opens the Make owner confirm on load (previews). */
    openModalId?: string;
};

function memberPath(member: HouseholdMember): string {
    return `/settings/household/members/${encodeURIComponent(member.userId)}`;
}

/** The ⋯ menu: change role, make owner (a confirm sheet), remove (confirms in place). */
function moreMenu(view: SettingsMemberV2View): Html | undefined {
    const manage = view.manage;
    if (!manage) return undefined;
    const { member } = view;
    const items: MenuItem[] = [];
    if (manage.role) {
        // oxlint-disable-next-line foodable/no-raw-role-check -- the item follows the member's current role; not a permission decision
        const toMember = member.role === "admin";
        items.push({
            kind: "post",
            label: toMember ? "Make member" : "Make admin",
            action: `${memberPath(member)}/role`,
            fields: { role: toMember ? "member" : "admin" },
        });
    }
    if (manage.transfer) {
        items.push({
            kind: "opens",
            label: "Make owner",
            sheetId: MEMBER_MAKE_OWNER_SHEET_ID,
        });
    }
    if (manage.remove) {
        items.push({
            kind: "destructive",
            label: `Remove ${member.displayName}`,
            action: `${memberPath(member)}/remove`,
            fields: { confirm: "yes" },
        });
    }
    return items.length > 0
        ? menu({
              label: `Actions for ${member.displayName}`,
              items,
              anchor: "more",
          })
        : undefined;
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

export function renderSettingsMemberV2Body(view: SettingsMemberV2View): string {
    const { member } = view;
    const version = view.chrome.identity?.avatarVersions?.get(member.userId);
    const rows: Html[] = [
        itemRow({ title: "Name", value: member.displayName }),
        itemRow({ title: "Role", value: roleLabel(member.role) }),
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
    return `${String(join([settingsErrorBanner(view.error), head, listGroup({ rows, label: "Member" })]))}${sheets}`;
}

export function renderSettingsMemberV2Page(view: SettingsMemberV2View): string {
    return renderHouseholdLayout({
        chrome: view.chrome,
        title: view.member.displayName,
        actions: moreMenu(view),
        body: renderSettingsMemberV2Body(view),
    });
}

export const SETTINGS_MEMBER_V2_MARKER = "fd-settings-member-head";
