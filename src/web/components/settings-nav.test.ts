import { test, expect } from "bun:test";
import { renderSettingsNav } from "./settings-nav.js";

test("settings nav links every section and marks the active one", () => {
    const html = renderSettingsNav("household");
    expect(html).toBe(
        '<nav class="subnav" aria-label="Settings sections"><a href="/settings">Account</a><a href="/settings/household" aria-current="page">Household</a><a href="/settings/foods">Foods</a><a href="/settings/help">Help</a></nav>',
    );
});
