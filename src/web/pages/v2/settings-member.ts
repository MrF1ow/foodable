import type { AppChromeBase } from "../../attention.js";
import type { HouseholdMember } from "../../../household.js";
import { esc } from "../../components/v2/html.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsPageHeader,
} from "./settings-shared.js";

export type SettingsMemberV2View = {
    chrome: AppChromeBase;
    member: HouseholdMember;
    viewer: HouseholdMember;
    todayHref?: string;
    error?: string;
};

function roleLabel(role: HouseholdMember["role"]): string {
    if (role === "owner") return "Owner";
    if (role === "admin") return "Admin";
    return "Member";
}

export function renderSettingsMemberV2Body(view: SettingsMemberV2View): string {
    const today =
        view.todayHref != null
            ? `<p class="fd-settings-member-today"><a class="fd-settings-link" href="${esc(view.todayHref)}">Today</a></p>`
            : "";
    return `${String(settingsPageHeader(view.member.displayName))}${String(settingsErrorBanner(view.error))}<section class="fd-settings-member-detail"><dl class="fd-settings-member-dl"><div class="fd-settings-member-dl__row"><dt>Name</dt><dd>${esc(view.member.displayName)}</dd></div><div class="fd-settings-member-dl__row"><dt>Role</dt><dd>${esc(roleLabel(view.member.role))}</dd></div></dl>${today}</section>`;
}

export function renderSettingsMemberV2Page(view: SettingsMemberV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: view.member.displayName,
        body: renderSettingsMemberV2Body(view),
    });
}

export const SETTINGS_MEMBER_V2_MARKER = "fd-settings-member-detail";
