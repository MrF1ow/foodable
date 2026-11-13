import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    GLOSSARY,
    HELP_GLOSSARY_IDS,
    renderSettingsHelpV2Page,
} from "./settings-help.js";

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

    test("no entry describes a control the new app does not have", () => {
        const text = (id: string) => GLOSSARY.find((e) => e.id === id)!.answer;
        // Card arranging is gone with the old Nutrition page.
        expect(HELP_GLOSSARY_IDS).not.toContain("nutrition-arrange");
        // Locations and restock are set by asking the assistant, not in a form.
        expect(text("locations")).toContain("add_fridge_location");
        expect(text("locations")).not.toContain("Add location");
        expect(text("restock")).toContain("update_household_config");
        expect(text("restock")).not.toContain("Settings › Household");
        // The attention indicator is a dot, not a number beside Settings.
        expect(text("needs-attention")).toContain("A dot on a tab");
        expect(text("needs-attention")).not.toContain("The number beside");
        // The old fridge and recipe controls are gone with the old pages.
        for (const entry of GLOSSARY) {
            for (const gone of [
                "pencil",
                "Add household item",
                "Household › Usual",
                "Log a portion",
                "Expiring soon",
            ]) {
                expect(entry.answer, `${entry.id}: ${gone}`).not.toContain(
                    gone,
                );
            }
        }
        expect(text("usual-products")).toContain("Kitchen › Usuals");
    });

    test("the Help page renders from the structured GLOSSARY entries", () => {
        expect(GLOSSARY.map((e) => e.id)).toEqual([...HELP_GLOSSARY_IDS]);
        const html = renderSettingsHelpV2Page({ chrome });
        for (const entry of GLOSSARY) {
            expect(html).toContain(entry.answer);
        }
        // Answers are HTML (a paragraph, plus the prompt block on one entry);
        // titles are plain text, escaped by the renderer.
        expect(GLOSSARY.every((e) => e.answer.startsWith("<p>"))).toBe(true);
        expect(GLOSSARY.some((e) => e.title.includes("<"))).toBe(false);
        expect(
            GLOSSARY.filter((e) => e.answer.includes("<textarea")).map(
                (e) => e.id,
            ),
        ).toEqual(["unverified-recipes"]);
    });
});
