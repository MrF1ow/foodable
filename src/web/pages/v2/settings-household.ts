import type { AppChromeBase } from "../../attention.js";
import type { HouseholdMember } from "../../../household.js";
import {
    DEFAULT_SOCIAL_READERS,
    type SocialReadersPreferences,
} from "../../../household.js";
import type { GroceryStore } from "../../../domain/settings.js";
import type { SocialReaderStatusRow } from "../../../domain/social-readers.js";
import type { PossibleDuplicatePair } from "../../../domain/foods.js";
import type { NoticeDismissal } from "../../../domain/notice-dismissals.js";
import {
    dismissalSubjectLabel,
    type NoticesForResult,
} from "../../../domain/notices-for.js";
import { dismissalKey } from "../../../domain/notice-dismissals.js";
import { NOTICE_COPY } from "../../../copy/notices.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { rowList, sectionHeader } from "../../components/v2/rows.js";
import { iconChevronRight } from "../../components/v2/icons.js";
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
} from "../household.js";
import {
    DUP_MERGE_MODAL_ID,
    renderPossibleDuplicatesBlock,
} from "../possible-duplicates.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
    settingsPageHeader,
    settingsPrimarySubmit,
} from "./settings-shared.js";
import {
    SOCIAL_READER_OWNER_ONLY,
    socialReaderTurnOffLabel,
    socialReaderTurnOnLabel,
    type SocialReaderId,
} from "../../../copy/social-readers.js";
import { sourceIcon } from "../../components/source-icon.js";
import { SOCIAL_READER_LABELS } from "../../../copy/social-readers.js";

export type SettingsHouseholdV2View = {
    chrome: AppChromeBase;
    householdName: string;
    members: HouseholdMember[];
    stores: GroceryStore[];
    isOwner: boolean;
    canManage: boolean;
    viewerUserId: string;
    error?: string;
    openModalId?: string;
    issuedToken?: string;
    socialReaders?: SocialReadersPreferences;
    socialReaderStatus?: SocialReaderStatusRow[];
    timezone?: string;
    noticeResult: NoticesForResult;
    duplicatePairs: PossibleDuplicatePair[];
    refCounts: ReadonlyMap<string, number>;
    mergePost?: {
        foodA: string;
        foodB: string;
        keepId: string;
        picks: Partial<Record<string, string>>;
    };
    pluralsSameFood?: boolean;
};

function roleLabel(role: HouseholdMember["role"]): string {
    if (role === "owner") return "Owner";
    if (role === "admin") return "Admin";
    return "Member";
}

function pageLevelError(view: SettingsHouseholdV2View): Html {
    if (!view.error) return raw("");
    const modalOnly =
        view.openModalId === HOUSEHOLD_ADD_MEMBER_MODAL_ID ||
        view.openModalId === HOUSEHOLD_ADD_STORE_MODAL_ID ||
        view.openModalId === HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID ||
        view.openModalId === HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID ||
        // The merge modal only renders while a pair is left to merge.
        (view.openModalId === DUP_MERGE_MODAL_ID &&
            view.duplicatePairs.length > 0);
    if (modalOnly) return raw("");
    return settingsErrorBanner(view.error);
}

function dismissedNoticesSection(result: NoticesForResult): Html {
    const openKeys = new Set(
        result.notices.map((n) => {
            const k = dismissalKey(n);
            return `${k.code}|${k.subjectKind}|${k.subjectId}|${k.relatedKey}`;
        }),
    );
    const rows = result.dismissals
        .filter((d) => {
            const key = `${d.code}|${d.subjectKind}|${d.subjectId}|${d.relatedKey}`;
            return !openKeys.has(key);
        })
        .map((d) => dismissedRow(d, result.subjectNames));
    if (rows.length === 0) {
        return raw(
            `<p class="fd-settings-household-empty">No dismissed notices.</p>`,
        );
    }
    return rowList(rows, { label: "Dismissed notices" });
}

function dismissedRow(
    d: NoticeDismissal,
    subjectNames: Map<string, string>,
): Html {
    const badge = NOTICE_COPY[d.code]?.badge ?? d.code;
    const label = dismissalSubjectLabel(d, subjectNames);
    return raw(
        `<li class="fd-row fd-row--dismissed"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(`${badge} — ${label}`)}</span></span></div><form method="post" action="/needs-attention/undo" class="fd-row__actions"><input type="hidden" name="dismissal_id" value="${esc(d.id)}" /><input type="hidden" name="return_to" value="/settings/household" /><button type="submit" class="fd-settings-btn fd-settings-btn--sm">Undo</button></form></div></li>`,
    );
}

function memberRow(
    view: SettingsHouseholdV2View,
    member: HouseholdMember,
): Html {
    const href = `/settings/household/members/${encodeURIComponent(member.userId)}`;
    const manage =
        view.isOwner && member.role !== "owner"
            ? modalTrigger({
                  target: HOUSEHOLD_MANAGE_ID,
                  label: "Manage",
                  className: "fd-settings-btn fd-settings-btn--sm",
                  fill: manageFill(member),
              })
            : "";
    const template =
        view.isOwner && member.role !== "owner"
            ? memberActionsTemplate(member)
            : "";
    // Without Manage the chevron sits inside the link, so it navigates too.
    const chevron = manage
        ? ""
        : `<span class="fd-row__chevron" aria-hidden="true">${String(iconChevronRight())}</span>`;
    const trailing = manage
        ? `<div class="fd-row__trailing">${manage}</div>`
        : "";
    return raw(
        `${template}<li class="fd-row fd-row--usual fd-row--settings-member"><div class="fd-row__body fd-row__body--with-trailing"><a class="fd-row__link" href="${esc(href)}"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(member.displayName)}</span><span class="fd-row__meta fd-row__meta--lg">${esc(roleLabel(member.role))}</span></span></div>${chevron}</a>${trailing}</div></li>`,
    );
}

function memberRows(view: SettingsHouseholdV2View): readonly Html[] {
    return view.members.map((member) => memberRow(view, member));
}

function storeRows(stores: GroceryStore[]): Html {
    if (stores.length === 0) {
        return raw(
            `<p class="fd-settings-household-empty">No grocery stores yet.</p>`,
        );
    }
    const items = stores.map((store) =>
        raw(
            `<li class="fd-row fd-row--store"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(store.name)}</span></span></div></div></li>`,
        ),
    );
    return rowList(items, {
        label: "Grocery stores",
        className: "fd-list--stores",
    });
}

const PLURALS_SAME_FOOD_LABEL = "Treat singular and plural as the same food";

function pluralsSameFoodBlock(view: SettingsHouseholdV2View): Html {
    const enabled = view.pluralsSameFood === true;
    if (view.canManage) {
        const checked = enabled ? " checked" : "";
        return raw(
            `<form method="post" action="/settings/household/plurals-same-food" class="fd-settings-form fd-settings-form--inline fd-settings-form--prefs"><span class="fd-settings-check"><input type="checkbox" name="plurals_same_food" value="true" id="plurals_same_food"${checked} /><span class="fd-settings-check__text">${esc(PLURALS_SAME_FOOD_LABEL)}</span></span>${settingsPrimarySubmit("Save")}</form>`,
        );
    }
    const state = enabled ? "On" : "Off";
    return raw(
        `<li class="fd-row fd-row--prefs"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(PLURALS_SAME_FOOD_LABEL)}</span><span class="fd-row__meta">${esc(state)}</span></span></div></div></li>`,
    );
}

function socialReaderV2Rows(view: SettingsHouseholdV2View): Html {
    const readers: SocialReaderId[] = ["tiktok", "facebook"];
    const socialReaders = view.socialReaders ?? DEFAULT_SOCIAL_READERS;
    const rows = readers.map((reader) => {
        const label = SOCIAL_READER_LABELS[reader];
        const enabled = socialReaders[reader];
        const state = enabled ? "On" : "Off";
        const kind = reader === "tiktok" ? "tiktok" : "facebook";
        let action = "";
        if (view.isOwner) {
            const modalId =
                reader === "tiktok"
                    ? HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID
                    : HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID;
            action = enabled
                ? `<form method="post" action="/settings/household/social-readers" class="fd-settings-inline-form"><input type="hidden" name="reader" value="${reader}" /><input type="hidden" name="enabled" value="0" /><button type="submit" class="fd-settings-btn fd-settings-btn--sm">${esc(socialReaderTurnOffLabel(reader))}</button></form>`
                : modalTrigger({
                      target: modalId,
                      label: socialReaderTurnOnLabel(reader),
                      className: "fd-settings-btn fd-settings-btn--sm",
                  });
        }
        return raw(
            `<li class="fd-row fd-row--social"><div class="fd-row__body"><span class="fd-row__lead">${sourceIcon(kind, { label, decorative: true })}</span><div class="fd-row__main"><span class="fd-row__title">${esc(label)}</span><span class="fd-row__meta">${esc(state)}</span></div>${action}</div></li>`,
        );
    });
    const ownerNote = view.isOwner
        ? ""
        : `<p class="fd-settings-muted">${esc(SOCIAL_READER_OWNER_ONLY)}</p>`;
    return raw(
        `${String(rowList(rows, { label: "Social readers" }))}${ownerNote}`,
    );
}

export function renderSettingsHouseholdV2Body(
    view: SettingsHouseholdV2View,
): string {
    const token = view.issuedToken
        ? `<p class="fd-settings-token">Household bot token (shown once): <code>${esc(view.issuedToken)}</code></p>`
        : "";
    const nameField = view.canManage
        ? `<form method="post" action="/settings/household/name" class="fd-settings-form fd-settings-form--inline">${String(
              settingsField({
                  id: "household_name",
                  label: "Household name",
                  control: `<input class="fd-settings-input" id="household_name" name="name" value="${esc(view.householdName)}" required maxlength="80" />`,
              }),
          )}${settingsPrimarySubmit("Save")}</form>`
        : `<p class="fd-settings-household-name">${esc(view.householdName)}</p>`;

    const addMemberTrigger = view.canManage
        ? modalTrigger({
              target: HOUSEHOLD_ADD_MEMBER_MODAL_ID,
              label: "Add member",
              className: "fd-settings-btn fd-settings-btn--primary",
          })
        : "";

    const addStoreTrigger = view.canManage
        ? modalTrigger({
              target: HOUSEHOLD_ADD_STORE_MODAL_ID,
              label: "Add store",
              className: "fd-settings-btn fd-settings-btn--primary",
          })
        : "";

    const dupBlock = renderPossibleDuplicatesBlock(
        {
            chrome: view.chrome,
            pairs: view.duplicatePairs,
            refCounts: view.refCounts,
            error: view.error,
            openModalId: view.openModalId,
            mergePost: view.mergePost,
        },
        { v2: true },
    );

    const modals = renderHouseholdV2OwnerModals({
        ...view,
        location: "",
        members: view.members,
        stores: [],
        memberRules: [],
        unverifiedRecipeExpiryDays: null,
        socialReaders: view.socialReaders,
    });

    const pluralsBlock = view.canManage
        ? pluralsSameFoodBlock(view)
        : raw(
              `${String(sectionHeader({ title: "Food names", level: 2 }))}${String(rowList([pluralsSameFoodBlock(view)], { label: PLURALS_SAME_FOOD_LABEL }))}`,
          );

    const sections = join([
        raw(`${nameField}${token}`),
        view.canManage
            ? raw(
                  `${String(sectionHeader({ title: "Food names", level: 2 }))}${String(pluralsBlock)}`,
              )
            : pluralsBlock,
        raw(
            `${String(sectionHeader({ title: "Members", level: 2 }))}${addMemberTrigger ? `<div class="fd-settings-household-actions">${addMemberTrigger}</div>` : ""}${String(rowList(memberRows(view), { label: "Members" }))}`,
        ),
        raw(
            `${String(sectionHeader({ title: "Grocery stores", level: 2 }))}${addStoreTrigger ? `<div class="fd-settings-household-actions">${addStoreTrigger}</div>` : ""}${String(storeRows(view.stores))}`,
        ),
        raw(
            `${String(sectionHeader({ title: "Dismissed notices", level: 2 }))}${String(dismissedNoticesSection(view.noticeResult))}`,
        ),
        raw(
            `${String(sectionHeader({ title: "Possible duplicates", level: 2, id: "fd-dup-section" }))}<div class="fd-settings-household-dups native">${dupBlock.listHtml}${dupBlock.modalsHtml}</div>`,
        ),
        raw(
            `${String(sectionHeader({ title: "Social post readers", level: 2 }))}${String(socialReaderV2Rows(view))}`,
        ),
    ]);

    return `${String(settingsPageHeader("Household"))}${String(pageLevelError(view))}<div class="fd-settings-household">${String(sections)}</div><div class="native fd-settings-household-modals">${modals}</div>`;
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
export const SETTINGS_HOUSEHOLD_DUP_MERGE = DUP_MERGE_MODAL_ID;
