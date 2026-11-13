import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    renderSettingsDisplayV2Page,
    themeChoiceValue,
} from "./settings-display.js";

const chrome = {
    theme: "dark" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

describe("settings display v2", () => {
    test("theme choice marks stored value", () => {
        const html = renderSettingsDisplayV2Page({
            chrome,
            storedTheme: "light",
        });
        expect(html).toContain('value="light" checked');
        expect(html).toContain('value="system"');
        expect(html).toContain('action="/settings/display"');
        expect(html).toContain('data-turbo="false"');
    });

    test("null stored theme selects Auto", () => {
        const html = renderSettingsDisplayV2Page({
            chrome,
            storedTheme: null,
        });
        expect(html).toContain('value="system" checked');
    });

    test("themeChoiceValue maps profile null to system", () => {
        expect(themeChoiceValue(null)).toBe("system");
        expect(themeChoiceValue("dark")).toBe("dark");
    });
});
