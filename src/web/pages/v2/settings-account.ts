import type { AppChromeBase } from "../../attention.js";
import { isDrinkUnit, type DrinkUnit } from "../../../alcohol.js";
import { isWeightUnit, type WeightUnit } from "../../../domain/units.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import { button } from "../../components/v2/button.js";
import { field } from "../../components/v2/field.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { sheet, sheetSection } from "../../components/v2/sheet.js";
import { APP_PATHS } from "../../route-map.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";

export const ACCOUNT_NAME_SHEET_ID = "fd-account-name";

export type SettingsAccountV2View = {
    chrome: AppChromeBase;
    backHref: string;
    displayName: string;
    /** The sign-in email, read-only. Null (unknown) shows no Email row. */
    email: string | null;
    /** The stored IANA zone, "" when none is set yet. */
    timezone: string;
    error?: string;
    /** The sheet `error` belongs to; it reopens on load. Without it the error is a page banner. */
    openSheetId?: string;
    /** Present only when the profile-pictures flag is on: the viewer's own
     *  picture (null version = none yet) and the control to change it. */
    photo?: { userId: string; version: Date | null };
};

export type NutritionPrefsPatch = {
    timezone?: string;
    preferred_weight_unit?: WeightUnit | null;
    widgets_enabled?: boolean;
    alcohol_tracking_enabled?: boolean;
    preferred_drink_unit?: DrinkUnit | null;
};

export function parseNutritionPrefsInput(input: {
    timezone?: unknown;
    preferred_weight_unit?: unknown;
    widgets_enabled?: unknown;
    alcohol_tracking_enabled?: unknown;
    preferred_drink_unit?: unknown;
}): NutritionPrefsPatch {
    const patch: NutritionPrefsPatch = {};
    if (typeof input.timezone === "string") {
        patch.timezone = input.timezone.trim();
    }
    if (typeof input.preferred_weight_unit === "string") {
        const unit = input.preferred_weight_unit.trim();
        patch.preferred_weight_unit = isWeightUnit(unit) ? unit : null;
    }
    if (input.widgets_enabled !== undefined) {
        patch.widgets_enabled =
            input.widgets_enabled === "on" ||
            input.widgets_enabled === "true" ||
            input.widgets_enabled === true;
    }
    if (input.alcohol_tracking_enabled !== undefined) {
        patch.alcohol_tracking_enabled =
            input.alcohol_tracking_enabled === "on" ||
            input.alcohol_tracking_enabled === "true" ||
            input.alcohol_tracking_enabled === true;
    }
    if (typeof input.preferred_drink_unit === "string") {
        const unit = input.preferred_drink_unit.trim();
        patch.preferred_drink_unit = isDrinkUnit(unit) ? unit : null;
    }
    return patch;
}

function hiddenFrom(backHref: string): string {
    return `<input type="hidden" name="from" value="${esc(backHref)}" />`;
}

/** "Photo": the member's own picture and the forms to change or remove it.
 *  The file input posts straight to the server; `data-fd-avatar-upload` lets
 *  the browser shrink the picture first (app-v2.js), and without it the raw
 *  file is posted and the server enforces the same limits. Both forms are
 *  Turbo forms: each answers 303 back here, or 4xx with this page. */
function photoSection(view: SettingsAccountV2View, fromField: string): string {
    const photo = view.photo;
    if (!photo) return "";
    const avatar = memberAvatar({
        name: view.displayName,
        userId: photo.userId,
        version: photo.version,
        enabled: true,
        className: "fd-settings-photo__avatar",
    });
    const change = `<form method="POST" action="/settings/account/photo" enctype="multipart/form-data" class="fd-settings-photo__form" data-fd-avatar-upload>
${fromField}
<input type="file" id="photo" name="photo" class="fd-settings-photo__input" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo" required />
${button({ label: "Change photo", variant: "primary", size: "md", type: "submit" })}
</form>`;
    const remove = photo.version
        ? `<form method="POST" action="/settings/account/photo/remove" class="fd-settings-photo__remove">
${fromField}
${button({ label: "Remove photo", variant: "danger", size: "md", type: "submit" })}
</form>`
        : "";
    return `<div class="fd-settings-photo">${String(avatar)}<div class="fd-settings-photo__forms">${change}${remove}</div></div>`;
}

/** The Name sheet: one text field, saved with the rest of the profile post.
 *  It posts over Turbo and comes back to Account (303). A name that is left
 *  blank is not saved (the field is `required`). */
function nameSheet(view: SettingsAccountV2View, fromField: string): string {
    const formId = `${ACCOUNT_NAME_SHEET_ID}-form`;
    const error =
        view.openSheetId === ACCOUNT_NAME_SHEET_ID ? view.error : undefined;
    const form = `<form id="${formId}" method="post" action="/settings">
<input type="hidden" name="group" value="account" />
<input type="hidden" name="return" value="${esc(APP_PATHS.settingsAccount)}" />
${fromField}
${field({
    id: "display_name",
    label: "Name",
    name: "display_name",
    value: view.displayName,
    autocomplete: "name",
    required: true,
    error,
})}
</form>`;
    return sheet({
        id: ACCOUNT_NAME_SHEET_ID,
        placement: "bottom",
        header: { kind: "title", title: "Name" },
        body: sheetSection({ kind: "fields", content: raw(form) }),
        actions: {
            kind: "pair",
            primary: { label: "Save", type: "submit", form: formId },
        },
        openOnLoad: view.openSheetId === ACCOUNT_NAME_SHEET_ID,
    });
}

export function renderSettingsAccountV2Body(
    view: SettingsAccountV2View,
): string {
    const fromField = hiddenFrom(view.backHref);
    const rows: Html[] = [
        itemRow({
            title: "Name",
            value: view.displayName,
            trailing: { kind: "chevron" },
            opens: ACCOUNT_NAME_SHEET_ID,
        }),
    ];
    if (view.email) rows.push(itemRow({ title: "Email", value: view.email }));
    rows.push(
        itemRow({
            title: "Time zone",
            value: view.timezone || "Not set",
            trailing: { kind: "chevron" },
            href: APP_PATHS.settingsTimezone,
        }),
    );
    // Log out answers with the sign-in page, so it is a full page load.
    const logout = itemRow({
        title: "Log out",
        href: "/logout",
        linkData: { turbo: "false" },
        className: "fd-item-row--danger",
    });
    // A sheet's own error sits inside it; any other (a photo upload) is a banner.
    const banner = view.openSheetId
        ? ""
        : String(settingsErrorBanner(view.error));
    return `${banner}${photoSection(view, fromField)}${String(listGroup({ rows, label: "Account" }))}${String(sectionHeader({ label: "Security", rule: false }))}${String(listGroup({ rows: [logout], label: "Security" }))}${nameSheet(view, fromField)}`;
}

export function renderSettingsAccountV2Page(
    view: SettingsAccountV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "account",
        title: "Account",
        className: "fd-settings--flat",
        body: renderSettingsAccountV2Body(view),
    });
}
