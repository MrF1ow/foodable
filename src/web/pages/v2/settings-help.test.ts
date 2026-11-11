import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { HELP_GLOSSARY_IDS } from "../settings-help.js";
import { renderSettingsHelpV2Page } from "./settings-help.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
};

describe("settings help v2", () => {
    test("glossary anchors and back link turbo off", () => {
        const html = renderSettingsHelpV2Page({ chrome });
        expect(html).toContain('data-fd-settings-page="help"');
        expect(html).toContain("fd-settings-help");
        expect(html).toContain('class="fd-settings-back"');
        expect(html).toContain('data-turbo="false"');
        for (const id of HELP_GLOSSARY_IDS) {
            expect(html).toContain(`id="${id}"`);
        }
    });
});
