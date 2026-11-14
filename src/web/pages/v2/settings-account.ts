import type { AppChromeBase } from "../../attention.js";
import { DRINK_UNITS, isDrinkUnit, type DrinkUnit } from "../../../alcohol.js";
import {
    WEIGHT_UNITS,
    isWeightUnit,
    type WeightUnit,
} from "../../../domain/units.js";
import { memberAvatar } from "../../components/v2/avatar.js";
import { esc } from "../../components/v2/html.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsField,
    settingsPageHeader,
    settingsPrimarySubmit,
} from "./settings-shared.js";

export type SettingsAccountV2View = {
    chrome: AppChromeBase;
    backHref: string;
    displayName: string;
    timezone: string;
    weightUnit: WeightUnit | "";
    widgetsEnabled: boolean;
    alcoholTrackingEnabled: boolean;
    drinkUnit: DrinkUnit | "";
    error?: string;
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

function optionList(
    values: readonly string[],
    selected: string,
    labels?: Record<string, string>,
): string {
    const blank =
        selected === ""
            ? `<option value="" selected>Not set</option>`
            : `<option value="">Not set</option>`;
    const opts = values
        .map((value) => {
            const sel = value === selected ? " selected" : "";
            const label = labels?.[value] ?? value;
            return `<option value="${esc(value)}"${sel}>${esc(label)}</option>`;
        })
        .join("");
    return `${blank}${opts}`;
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

export function renderSettingsAccountV2Body(
    view: SettingsAccountV2View,
): string {
    const widgetsChecked = view.widgetsEnabled ? " checked" : "";
    const alcoholChecked = view.alcoholTrackingEnabled ? " checked" : "";
    const fromField = hiddenFrom(view.backHref);
    const accountForm = `<form method="POST" action="/settings" class="fd-settings-form fd-settings-form--sheet" data-turbo="false">
<input type="hidden" name="group" value="account" />
${fromField}
${String(
    settingsField({
        id: "display_name",
        label: "Display name",
        control: `<input class="fd-settings-input" id="display_name" name="display_name" value="${esc(view.displayName)}" maxlength="80" autocomplete="nickname" />`,
    }),
)}
${settingsPrimarySubmit("Save account")}
</form>`;
    const nutritionForm = `<p class="fd-settings-section-label">Nutrition</p><form method="POST" action="/settings" class="fd-settings-form fd-settings-form--sheet fd-settings-form--prefs" data-turbo="false">
<input type="hidden" name="group" value="nutrition" />
${fromField}
${String(
    settingsField({
        id: "timezone",
        label: "Timezone",
        control: `<input class="fd-settings-input" id="timezone" name="timezone" value="${esc(view.timezone)}" placeholder="America/Los_Angeles" autocomplete="off" />`,
    }),
)}
${String(
    settingsField({
        id: "preferred_weight_unit",
        label: "Weight unit",
        control: `<select class="fd-settings-select" id="preferred_weight_unit" name="preferred_weight_unit">${optionList(WEIGHT_UNITS, view.weightUnit)}</select>`,
    }),
)}
<span class="fd-settings-check"><input type="checkbox" name="widgets_enabled" value="true" id="widgets_enabled"${widgetsChecked} /><span class="fd-settings-check__text">Show in-chat widgets</span></span>
<span class="fd-settings-check"><input type="checkbox" name="alcohol_tracking_enabled" value="true" id="alcohol_tracking_enabled"${alcoholChecked} /><span class="fd-settings-check__text">Alcohol tracking</span></span>
${String(
    settingsField({
        id: "preferred_drink_unit",
        label: "Drink unit",
        control: `<select class="fd-settings-select" id="preferred_drink_unit" name="preferred_drink_unit">${optionList(DRINK_UNITS, view.drinkUnit, { us: "US drinks", uk: "UK units" })}</select>`,
    }),
)}
${settingsPrimarySubmit("Save nutrition prefs")}
</form>`;
    const logout = `<p class="fd-settings-session"><a href="/logout" data-turbo="false">Log out</a></p><p class="fd-settings-footnote">Your data stays on this household&apos;s server. Export it any time from Settings.</p>`;
    return `${String(settingsPageHeader("Account"))}${String(settingsErrorBanner(view.error))}${photoSection(view, fromField)}${accountForm}${nutritionForm}${logout}`;
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
