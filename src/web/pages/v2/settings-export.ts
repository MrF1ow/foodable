import type { AppChromeBase } from "../../attention.js";
import { esc } from "../../components/v2/html.js";
import {
    renderSettingsV2Page,
    settingsPageHeader,
    settingsPrimarySubmit,
} from "./settings-shared.js";

export type SettingsExportV2View = {
    chrome: AppChromeBase;
    error?: string;
};

export function renderSettingsExportV2Body(view: SettingsExportV2View): string {
    const error = view.error
        ? `<p class="fd-settings-error" role="alert">${esc(view.error)}</p>`
        : "";
    return `${settingsPageHeader("Export data")}${error}<p class="fd-settings-export-lead">Download a ZIP of your meals, water, weight, goals, and profile. The link is valid for 60 minutes.</p><form method="POST" action="/settings/export" class="fd-settings-form" data-turbo="false">${settingsPrimarySubmit("Export data")}</form>`;
}

export function renderSettingsExportV2Page(view: SettingsExportV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "export",
        title: "Export data",
        body: renderSettingsExportV2Body(view),
    });
}
