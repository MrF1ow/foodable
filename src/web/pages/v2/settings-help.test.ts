import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    GLOSSARY,
    HELP_GLOSSARY_IDS,
    renderSettingsGlossaryHtml,
} from "../settings-help.js";
import { renderSettingsHelpV2Page } from "./settings-help.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
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

    test("one card of rows, each a native details with a plain title and its answer", () => {
        const html = renderSettingsHelpV2Page({ chrome });
        const rows = [
            ...html.matchAll(
                /<details class="fd-settings-help__row" id="([^"]+)">\s*<summary class="fd-settings-help__summary"><span class="fd-settings-help__label">([^<]+)<\/span>[\s\S]*?<\/summary>\s*<div class="fd-settings-help__answer">([\s\S]*?)<\/div>\s*<\/details>/g,
            ),
        ];
        expect(rows.map((m) => m[1])).toEqual([...HELP_GLOSSARY_IDS]);
        expect(rows[0]![2]).toBe("Food vs household item");
        expect(rows[0]![3]).toContain("Foods are things you eat");
        // One card, no per-entry cards, no glossary heading.
        expect(html.match(/<ul class="fd-settings-help"/g)?.length).toBe(1);
        expect(html).not.toContain("fd-settings-help-entry");
        expect(html).not.toContain("Glossary");
        // The agent prompt and its copy button survive inside their row.
        const prompt = rows.find((m) => m[1] === "unverified-recipes")!;
        expect(prompt[3]).toContain("<textarea");
        expect(prompt[3]).toContain("data-copy-target");
    });

    test("both Help pages render from the structured GLOSSARY entries", () => {
        expect(GLOSSARY.map((e) => e.id)).toEqual([...HELP_GLOSSARY_IDS]);
        const v2 = renderSettingsHelpV2Page({ chrome });
        const legacy = renderSettingsGlossaryHtml();
        for (const entry of GLOSSARY) {
            expect(v2).toContain(entry.answer);
            expect(legacy).toContain(entry.answer);
        }
        // Answers are HTML (a paragraph, plus the prompt block on one entry);
        // titles are plain text, escaped by each renderer.
        expect(GLOSSARY.every((e) => e.answer.startsWith("<p>"))).toBe(true);
        expect(GLOSSARY.some((e) => e.title.includes("<"))).toBe(false);
        expect(
            GLOSSARY.filter((e) => e.answer.includes("<textarea")).map(
                (e) => e.id,
            ),
        ).toEqual(["unverified-recipes"]);
    });
});
