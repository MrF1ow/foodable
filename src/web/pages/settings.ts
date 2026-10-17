import { escapeHtml, renderAppShell, type ViewerChrome } from "../shell.js";
import { DRINK_UNITS, isDrinkUnit, type DrinkUnit } from "../../alcohol.js";
import {
    WEIGHT_UNITS,
    isWeightUnit,
    type WeightUnit,
} from "../../domain/units.js";
import { renderSettingsNav } from "../components/settings-nav.js";

export type SettingsPageView = {
    chrome: ViewerChrome;
    displayName: string;
    timezone: string;
    weightUnit: WeightUnit | "";
    widgetsEnabled: boolean;
    alcoholTrackingEnabled: boolean;
    drinkUnit: DrinkUnit | "";
    error?: string;
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
            return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(label)}</option>`;
        })
        .join("");
    return `${blank}${opts}`;
}

const THEME_CHOICES = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
] as const;

export function renderSettingsPage(view: SettingsPageView): string {
    const themes = THEME_CHOICES.map(({ value, label }) => {
        const checked = view.chrome.theme === value ? " checked" : "";
        return `<label><input type="radio" name="theme" value="${value}"${checked} /> ${label}</label>`;
    }).join("");
    const error = view.error
        ? `<p class="error-banner">${escapeHtml(view.error)}</p>`
        : "";
    const widgetsChecked = view.widgetsEnabled ? " checked" : "";
    const alcoholChecked = view.alcoholTrackingEnabled ? " checked" : "";
    const body = `
        <h1>Settings</h1>
        ${renderSettingsNav("account")}
        ${error}
        <form method="POST" action="/settings" class="appearance panel">
            <input type="hidden" name="group" value="account" />
            <h2>Account</h2>
            <label for="display_name">Display name</label>
            <input id="display_name" name="display_name" value="${escapeHtml(view.displayName)}" maxlength="80" autocomplete="nickname" />
            <fieldset class="choice-row">
                <legend>Theme</legend>
                ${themes}
            </fieldset>
            <button type="submit" class="btn-primary">Save account</button>
        </form>
        <form method="POST" action="/settings" class="appearance nutrition-prefs panel">
            <input type="hidden" name="group" value="nutrition" />
            <h2>Nutrition prefs</h2>
            <label for="timezone">Timezone</label>
            <input id="timezone" name="timezone" value="${escapeHtml(view.timezone)}" placeholder="America/Los_Angeles" autocomplete="off" />
            <label for="preferred_weight_unit">Weight unit</label>
            <select id="preferred_weight_unit" name="preferred_weight_unit">${optionList(WEIGHT_UNITS, view.weightUnit)}</select>
            <label><input type="checkbox" name="widgets_enabled" value="true"${widgetsChecked} /> Show in-chat widgets</label>
            <label><input type="checkbox" name="alcohol_tracking_enabled" value="true"${alcoholChecked} /> Alcohol tracking</label>
            <label for="preferred_drink_unit">Drink unit</label>
            <select id="preferred_drink_unit" name="preferred_drink_unit">${optionList(DRINK_UNITS, view.drinkUnit, { us: "US drinks", uk: "UK units" })}</select>
            <button type="submit" class="btn-primary">Save nutrition prefs</button>
        </form>
    `;
    return renderAppShell({
        title: "Settings",
        active: "settings",
        theme: view.chrome.theme,
        body,
    });
}
