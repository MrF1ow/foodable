import type { AppChromeBase } from "../../attention.js";
import {
    HELP_GLOSSARY_IDS,
    renderSettingsGlossaryHtml,
} from "../settings-help.js";
import { raw } from "../../components/v2/html.js";
import { sectionHeader } from "../../components/v2/rows.js";
import { renderSettingsV2Page, settingsPageHeader } from "./settings-shared.js";

export type SettingsHelpV2View = {
    chrome: AppChromeBase;
};

function v2GlossaryBody(): string {
    const legacy = renderSettingsGlossaryHtml();
    return legacy
        .replace(/class="help-entry psec"/g, 'class="fd-settings-help-entry"')
        .replace(
            /class="subsection-title"/g,
            'class="fd-settings-help-entry__title"',
        );
}

export function renderSettingsHelpV2Body(): string {
    const glossary = v2GlossaryBody();
    return `${String(settingsPageHeader("Help"))}${String(sectionHeader({ title: "Glossary", level: 2 }))}<div class="fd-settings-help">${glossary}</div>`;
}

export function renderSettingsHelpV2Page(view: SettingsHelpV2View): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "help",
        title: "Help",
        body: renderSettingsHelpV2Body(),
    });
}

export { HELP_GLOSSARY_IDS };
