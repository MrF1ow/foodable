import { expect, test } from "bun:test";
import {
    HELP_GLOSSARY_IDS,
    renderSettingsHelpPage,
} from "../web/pages/settings-help.js";

test("settings help is in nav and exposes glossary anchors", () => {
    const html = renderSettingsHelpPage({
        chrome: { theme: "light" },
        backHref: "/",
    });
    expect(html).toContain("<h1>Help</h1>");
    expect(html).toContain(
        'href="/settings/help" aria-current="page">Help</a>',
    );
    expect(html).not.toContain("bottom-nav");
    expect(html).toContain('name="foodable-theme-chrome" content="page"');
    for (const id of HELP_GLOSSARY_IDS) {
        expect(html).toContain(`id="${id}"`);
    }
});
