import type { AppChromeBase } from "../../attention.js";
import { escapeHtml } from "../../shell.js";
import {
    GLOSSARY,
    HELP_GLOSSARY_IDS,
    type GlossaryEntry,
} from "../settings-help.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { renderSettingsV2Page, settingsPageHeader } from "./settings-shared.js";

export type SettingsHelpV2View = {
    chrome: AppChromeBase;
};

function helpRow(entry: GlossaryEntry): string {
    return `<li class="fd-settings-help__item"><details class="fd-settings-help__row" id="${escapeHtml(entry.id)}">
<summary class="fd-settings-help__summary"><span class="fd-settings-help__label">${escapeHtml(entry.title)}</span><span class="fd-settings-help__chev" aria-hidden="true">${iconChevronRight()}</span></summary>
<div class="fd-settings-help__answer">${entry.answer}</div>
</details></li>`;
}

export function renderSettingsHelpV2Body(): string {
    const rows = GLOSSARY.map(helpRow).join("");
    return `${String(settingsPageHeader("Help"))}<ul class="fd-settings-help" aria-label="Help topics">${rows}</ul>`;
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
