import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { renderSettingsExportV2Page } from "./settings-export.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
    identity: {
        viewerName: "Ethan Flow",
        viewerRole: "owner" as const,
        householdName: "Flow",
        memberCount: 2,
    },
};

describe("settings export v2", () => {
    test("export form posts to gated route", () => {
        const html = renderSettingsExportV2Page({ chrome });
        expect(html).toContain('data-fd-settings-page="export"');
        expect(html).toContain('action="/settings/export"');
        expect(html).toContain('data-turbo="false"');
        expect(html).toContain("Export data");
    });
});
