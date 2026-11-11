import type { AppChromeBase } from "../../attention.js";
import { choiceGroup } from "../../components/v2/chips.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
    settingsPageHeader,
    settingsPrimarySubmit,
    themeChoiceValue,
} from "./settings-shared.js";

export { themeChoiceValue };

export type SettingsDisplayV2View = {
    chrome: AppChromeBase;
    /** Raw `profiles.theme` (null = Auto). */
    storedTheme: "light" | "dark" | null;
    error?: string;
};

const THEME_OPTIONS = [
    { value: "system", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
] as const;

export function renderSettingsDisplayV2Body(
    view: SettingsDisplayV2View,
): string {
    const selected = themeChoiceValue(view.storedTheme);
    const themeField = String(
        choiceGroup({
            name: "theme",
            legend: "Appearance",
            showLegend: true,
            options: THEME_OPTIONS.map((opt) => ({
                ...opt,
                selected: opt.value === selected,
            })),
            required: true,
        }),
    );
    return `${String(settingsPageHeader("Display"))}${String(settingsErrorBanner(view.error))}<form method="POST" action="/settings/display" class="fd-settings-form" data-turbo="false">${themeField}${settingsPrimarySubmit("Save")}</form>`;
}

export function renderSettingsDisplayV2Page(
    view: SettingsDisplayV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "display",
        title: "Display",
        body: renderSettingsDisplayV2Body(view),
    });
}

export function isValidDisplayTheme(
    raw: string,
): raw is (typeof THEME_OPTIONS)[number]["value"] {
    return raw === "system" || raw === "light" || raw === "dark";
}
