import type { AppChromeBase } from "../../attention.js";
import { isDrinkUnit, type DrinkUnit } from "../../../alcohol.js";
import { isWeightUnit, type WeightUnit } from "../../../domain/units.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import { esc } from "../../components/v2/html.js";
import { raw, type Html } from "../../components/v2/html.js";
import { sheet } from "../../components/v2/sheet.js";
import {
    householdRow,
    householdRowCard,
    ROW_ICONS,
    textInputField,
    timeZoneSelect,
} from "./settings-household-rows.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
    settingsPageHeader,
    settingsPrimarySubmit,
} from "./settings-shared.js";

function lineIcon(inner: string): Html {
    return raw(
        `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`,
    );
}

const ACCOUNT_ICONS = {
    person: lineIcon(
        '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
    ),
    globe: lineIcon(
        '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5M12 3.5C9.4 5.9 8.2 8.7 8.2 12s1.2 6.1 3.8 8.5"/>',
    ),
    logout: lineIcon(
        '<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M9 12h11M16.5 8.5 20 12l-3.5 3.5"/>',
    ),
} as const;

/** The Log out row: a red link row in the Household row-card language. It is a
 *  full page load (`data-turbo="false"`) and has no chevron. */
function logoutRow(): Html {
    return raw(
        `<li class="fd-row fd-row--stores-pref"><a class="fd-row__body fd-stores-pref fd-stores-pref--danger" href="/logout" data-turbo="false"><span class="fd-stores-pref__icon" aria-hidden="true">${String(ACCOUNT_ICONS.logout)}</span><span class="fd-stores-pref__main"><span class="fd-row__title">Log out</span></span></a></li>`,
    );
}

/** An edit sheet holding one Account form. Like Household's edit sheets, but
 *  the form posts with a full page load: Settings forms opt out of Turbo so
 *  iOS Safari re-tints its toolbar. */
function accountEditSheet(opts: {
    id: string;
    title: string;
    subtitle?: string;
    fields: string;
    error?: string;
    open: boolean;
}): string {
    const formId = `${opts.id}-form`;
    const error = opts.error
        ? `<p class="fd-settings-error" role="alert">${esc(opts.error)}</p>`
        : "";
    return sheet({
        id: opts.id,
        kind: "edit",
        title: opts.title,
        subtitle: opts.subtitle,
        body: `<form id="${formId}" method="post" action="/settings" class="fd-stores-form" data-turbo="false">${error}${opts.fields}</form>`,
        actions: `<button type="button" class="fd-btn" command="close" commandfor="${esc(opts.id)}">Cancel</button><button type="submit" class="fd-btn fd-btn--primary" form="${formId}">Save</button>`,
        openOnLoad: opts.open,
    });
}

export const ACCOUNT_NAME_SHEET_ID = "fd-account-name";
export const ACCOUNT_TIMEZONE_SHEET_ID = "fd-account-timezone";

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
 *  file is posted and the server enforces the same limits. */
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
    const change = `<form method="POST" action="/settings/account/photo" enctype="multipart/form-data" class="fd-settings-photo__form" data-turbo="false" data-fd-avatar-upload>
${fromField}
<input type="file" id="photo" name="photo" class="fd-settings-photo__input" accept="image/jpeg,image/png,image/webp" aria-label="Choose a photo" required />
${settingsPrimarySubmit("Change photo")}
</form>`;
    const remove = photo.version
        ? `<form method="POST" action="/settings/account/photo/remove" class="fd-settings-photo__remove" data-turbo="false">
${fromField}
<button type="submit" class="fd-settings-btn fd-settings-btn--danger fd-settings-btn--sm">Remove photo</button>
</form>`
        : "";
    return `<p class="fd-settings-section-label">Photo</p><div class="fd-settings-photo">${String(avatar)}<div class="fd-settings-photo__forms">${change}${remove}</div></div>`;
}

function errorFor(view: SettingsAccountV2View, id: string) {
    return view.openSheetId === id ? view.error : undefined;
}

function accountSheets(view: SettingsAccountV2View): string {
    const fromField = hiddenFrom(view.backHref);
    const nameFields = `<input type="hidden" name="group" value="account" />
${fromField}
${textInputField({
    id: "display_name",
    label: "Name",
    name: "display_name",
    value: view.displayName,
    maxlength: 80,
    required: true,
})}`;
    // Only the zone is posted: the settings handler writes just what the form
    // carries, so units, alcohol and the widget switch keep their values.
    const timeZoneFields = `<input type="hidden" name="group" value="nutrition" />
${fromField}
${String(
    settingsField({
        id: "timezone",
        label: "Time zone",
        control: timeZoneSelect({
            id: "timezone",
            name: "timezone",
            stored: view.timezone || null,
            // "Not set" only while nothing is stored: saving it over a
            // stored zone would change nothing.
            emptyLabel: view.timezone ? undefined : "Not set",
        }),
    }),
)}`;
    return [
        accountEditSheet({
            id: ACCOUNT_NAME_SHEET_ID,
            title: "Name",
            fields: nameFields,
            error: errorFor(view, ACCOUNT_NAME_SHEET_ID),
            open: view.openSheetId === ACCOUNT_NAME_SHEET_ID,
        }),
        accountEditSheet({
            id: ACCOUNT_TIMEZONE_SHEET_ID,
            title: "Time zone",
            subtitle: "Your days and times count in this zone.",
            fields: timeZoneFields,
            error: errorFor(view, ACCOUNT_TIMEZONE_SHEET_ID),
            open: view.openSheetId === ACCOUNT_TIMEZONE_SHEET_ID,
        }),
    ].join("");
}

export function renderSettingsAccountV2Body(
    view: SettingsAccountV2View,
): string {
    const fromField = hiddenFrom(view.backHref);
    const rows: Html[] = [
        householdRow({
            icon: ACCOUNT_ICONS.person,
            label: "Name",
            value: view.displayName,
            sheetId: ACCOUNT_NAME_SHEET_ID,
        }),
    ];
    if (view.email) {
        rows.push(
            householdRow({
                icon: ACCOUNT_ICONS.globe,
                label: "Email",
                value: view.email,
            }),
        );
    }
    rows.push(
        householdRow({
            icon: ROW_ICONS.clock,
            label: "Time zone",
            value: view.timezone || "Not set",
            sheetId: ACCOUNT_TIMEZONE_SHEET_ID,
        }),
    );
    const security = householdRowCard([logoutRow()], "Security");
    // A sheet's own error sits inside it; any other (a photo upload) is a banner.
    const banner = view.openSheetId
        ? ""
        : String(settingsErrorBanner(view.error));
    return `${String(settingsPageHeader("Account"))}${banner}${photoSection(view, fromField)}<div class="fd-settings-hh fd-settings-account">${String(householdRowCard(rows, "Account"))}<p class="fd-settings-section-label">Security</p>${String(security)}<p class="fd-settings-footnote">Your data stays on this household&apos;s server. Export it any time from Settings.</p></div>${accountSheets(view)}`;
}

export function renderSettingsAccountV2Page(
    view: SettingsAccountV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "account",
        title: "Account",
        body: renderSettingsAccountV2Body(view),
    });
}
