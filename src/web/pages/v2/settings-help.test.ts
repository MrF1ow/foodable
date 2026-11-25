import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    GLOSSARY,
    HELP_GLOSSARY_IDS,
    HELP_QUERY_MAX,
    renderSettingsHelpV2Page,
    searchGlossary,
} from "./settings-help.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

describe("settings help v2", () => {
    test("glossary anchors, and a Detail bar back to Settings that stays a Turbo visit", () => {
        const html = renderSettingsHelpV2Page({ chrome });
        expect(html).toContain('data-fd-settings-page="help"');
        expect(html).toContain("fd-settings-help");
        expect(html).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings"/,
        );
        expect(html).not.toContain('data-turbo="false"');
        for (const id of HELP_GLOSSARY_IDS) {
            expect(html).toContain(`id="${id}"`);
        }
    });

    test("Possible duplicates help names its new home", () => {
        const entry = GLOSSARY.find((g) => g.id === "possible-duplicates")!;
        expect(entry.answer).toContain(
            "Saved foods &amp; recipes › Possible duplicates",
        );
        expect(entry.answer).not.toContain("Household › Possible duplicates");
        // What the compare page does, and where an unpicked value comes from.
        expect(entry.answer).toContain("Compare and merge");
        expect(entry.answer).toContain(
            "every fridge item, grocery line and recipe that uses the other moves over to it",
        );
        expect(entry.answer).toContain(
            "a value you leave unpicked comes from the food you keep",
        );
        expect(entry.answer).not.toContain("Not the same");
    });

    test("one list of item rows, each a native details with a plain title and its answer", () => {
        const html = renderSettingsHelpV2Page({ chrome });
        const rows = [
            ...html.matchAll(
                /<details class="fd-item-row__disclosure" id="([^"]+)">\s*<summary class="fd-item-row__face fd-item-row__face--link"><span class="fd-item-row__main"><span class="fd-item-row__line"><span class="fd-item-row__title" title="[^"]*">([^<]+)<\/span><\/span><\/span>[\s\S]*?<\/summary>\s*<div class="fd-item-row__answer">([\s\S]*?)<\/div>\s*<\/details>/g,
            ),
        ];
        expect(rows.map((m) => m[1])).toEqual([...HELP_GLOSSARY_IDS]);
        expect(rows[0]![2]).toBe("Food vs household item");
        expect(rows[0]![3]).toContain("Foods are things you eat");
        // One list group, a chevron a row, no glossary heading.
        expect(
            html.match(/<ul class="fd-list-group fd-settings-help"/g),
        ).toHaveLength(1);
        expect(html.match(/fd-item-row__chevron/g)).toHaveLength(rows.length);
        expect(html).not.toContain("fd-settings-help-entry");
        // The row is the item row's own disclosure, with none of its own markup.
        expect(html).not.toContain("fd-settings-help__row");
        expect(html).not.toContain("fd-settings-help__summary");
        expect(
            html.match(/<li class="fd-item-row fd-item-row--disclosure"/g),
        ).toHaveLength(rows.length);
        expect(html).not.toContain("Glossary");
        // The agent prompt and its copy button survive inside their row, built
        // from the Field and Button components.
        const prompt = rows.find((m) => m[1] === "recipe-drafts")!;
        expect(prompt[3]).toContain("<textarea");
        expect(prompt[3]).toContain("readonly");
        expect(prompt[3]).toContain("fd-field__input");
        expect(prompt[3]).toContain("data-copy-target");
        expect(prompt[3]).toContain("data-fd-btn");
    });

    test("a search field above the topics asks for q and keeps what was typed", () => {
        const html = renderSettingsHelpV2Page({ chrome, query: 'put "away"' });
        expect(html).toContain(
            '<form class="fd-settings-help-search" method="get" action="/settings/help" data-turbo-action="replace">',
        );
        // One search landmark: the field's own, not also the form around it.
        const form = html.match(
            /<form class="fd-settings-help-search".*?<\/form>/s,
        )![0];
        expect(form.match(/role="search"/g)).toHaveLength(1);
        expect(form).toMatch(
            /^<form[^>]*>(?:(?!<\/form>).)*?<div class="fd-search-field[^"]*" role="search"/s,
        );
        expect(form.split(">")[0]).not.toContain("role=");
        expect(html).toContain('aria-label="Search help"');
        expect(html).toContain('placeholder="Search help"');
        expect(html).toContain('value="put &quot;away&quot;"');
        // The empty search shows every topic.
        const plain = renderSettingsHelpV2Page({ chrome });
        expect(plain).not.toContain("No topics match");
        expect(plain.match(/<details /g)).toHaveLength(GLOSSARY.length);
    });

    test("typing words lists the topics that hold all of them", () => {
        const ids = (q: string | undefined) =>
            searchGlossary(q).map((e) => e.id);
        expect(ids(undefined)).toEqual([...HELP_GLOSSARY_IDS]);
        expect(ids("")).toEqual([...HELP_GLOSSARY_IDS]);
        expect(ids("   ")).toEqual([...HELP_GLOSSARY_IDS]);
        expect(ids("export")).toEqual(["export-data"]);
        // Case and spacing do not matter; every word must be there.
        expect(ids("  TIME   Zone ")).toContain("time-zone");
        expect(ids("zip readme")).toEqual(["export-data"]);
        expect(ids("zip nonsenseword")).toEqual([]);
        const html = renderSettingsHelpV2Page({ chrome, query: "export" });
        expect(html.match(/<details /g)).toHaveLength(1);
        expect(html).toContain('id="export-data"');
        expect(html).not.toContain('id="locations"');
    });

    test("odd input in q cannot break the page or the search", () => {
        const ids = (q: string) => searchGlossary(q).map((e) => e.id);
        // Regex characters are plain text, not a pattern.
        for (const q of [".*", "(", "[", "\\", "a{2,}", "^$", "+?"]) {
            expect(() => searchGlossary(q)).not.toThrow();
        }
        expect(ids(".*")).toEqual([]);
        // Markup is escaped everywhere it is echoed.
        const hostile = '"><script>alert(1)</script><img src=x onerror=1>';
        const none = renderSettingsHelpV2Page({ chrome, query: hostile });
        expect(none).not.toContain("<script>alert");
        expect(none).not.toContain("<img src=x");
        expect(none).toContain("No topics match");
        expect(none).toContain("&lt;script&gt;alert(1)");
        // A very long query is cut, never searched or echoed whole.
        const long = "a".repeat(5000);
        const cut = renderSettingsHelpV2Page({ chrome, query: long });
        expect(cut).not.toContain(long);
        expect(cut).toContain("a".repeat(HELP_QUERY_MAX));
        // Only the first words count, so a pasted page is cheap to search.
        const manyWords = Array.from({ length: 500 }, () => "food").join(" ");
        expect(ids(manyWords).length).toBeGreaterThan(0);
        // Unicode, curly quotes and control characters are fine.
        expect(() =>
            searchGlossary("café ☕ “quoted” \u0000 \n"),
        ).not.toThrow();
        expect(ids("İ")).toEqual([]);
    });

    test("an unmatched search says so and shows no topic", () => {
        const html = renderSettingsHelpV2Page({ chrome, query: "zzzz" });
        expect(html).toContain("No topics match");
        expect(html).toContain("Nothing in Help has “zzzz”.");
        expect(html).not.toContain("<details ");
        // The search field stays, so the person can try again.
        expect(html).toContain('aria-label="Search help"');
    });

    test("the explanations the earlier pages cut are here", () => {
        const text = (id: string) => GLOSSARY.find((e) => e.id === id)?.answer;
        expect(text("export-data")).toContain("ZIP");
        expect(text("export-data")).toContain("meals");
        expect(text("export-data")).toContain("water");
        expect(text("export-data")).toContain("weight");
        expect(text("export-data")).toContain("goals");
        expect(text("export-data")).toContain("profile");
        expect(text("time-zone")).toContain(
            "Your days and times count in your time zone",
        );
        expect(text("time-zone")).toContain(
            "The household's own time zone, in Settings › Household, sets when the household's day turns over: restock and notices.",
        );
        expect(text("add-member")).toContain("A username has no @");
        expect(text("add-member")).toContain("2–31 letters");
        expect(text("add-member")).toContain("starting with a letter or digit");
        expect(text("store-pick-order")).toContain("usual store");
        expect(text("store-pick-order")).toContain(
            "the default store comes next, then the store the food was last on the list",
        );
        expect(text("goals")).toContain("Tap a number to change it");
        expect(text("goals")).toContain("it saves when you leave the field");
        expect(text("goals")).toContain("puts it back on your daily goals");
        expect(text("product-score")).toContain("household default");
        expect(text("product-score")).toContain("person rules");
        for (const id of ["units", "nutrients-shown", "ai-connections"]) {
            expect(HELP_GLOSSARY_IDS).toContain(id);
        }
        expect(text("ai-connections")).toContain("24 hours");
    });

    test("the entries earlier work wrote are kept as written", () => {
        const text = (id: string) => GLOSSARY.find((e) => e.id === id)!.answer;
        expect(text("recipe-drafts")).toContain(
            "An imported recipe is a draft until you save it.",
        );
        expect(text("recipe-drafts")).toContain(
            "it saves a draft only when you tell it to.",
        );
        expect(text("needs-attention")).toContain(
            "The bell at the top of the page shows a green dot",
        );
        expect(GLOSSARY.find((e) => e.id === "needs-attention")?.title).toBe(
            "Notifications",
        );
        // Nothing that was removed comes back.
        for (const gone of ["unverified recipes", "Dismissed notices"]) {
            for (const entry of GLOSSARY) {
                expect(entry.answer).not.toContain(gone);
            }
        }
    });

    test("the recipe entry speaks of drafts and Save, and no title or answer says unverified", () => {
        const entry = GLOSSARY.find((e) => e.id === "recipe-drafts")!;
        expect(entry.title).toBe("How do I finish an imported recipe?");
        const paragraph = entry.answer.slice(0, entry.answer.indexOf("</p>"));
        expect(paragraph).toContain("draft");
        expect(paragraph).toContain("Save checks the recipe first");
        for (const one of GLOSSARY) {
            expect(one.title.toLowerCase()).not.toContain("unverified");
            expect(
                one.answer.slice(0, one.answer.indexOf("</p>")).toLowerCase(),
            ).not.toContain("unverified");
        }
        // The prompt block carries the agent prompt, which is about drafts too.
        expect(entry.answer).toContain(
            "Help me finish my Foodable recipe drafts.",
        );
        expect(entry.answer).toContain('id="help-recipe-drafts-prompt"');
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
        // The bell shows a green dot, never a number, and nothing is on a tab.
        expect(text("needs-attention")).toContain("green dot");
        expect(text("needs-attention")).toContain("Settings › Notifications");
        // Only kinds that reach the inbox are listed; plan gaps do not.
        expect(text("needs-attention")).not.toContain(
            "what a planned recipe is missing",
        );
        expect(text("needs-attention")).toContain(
            "missing ingredients show on the Recipes page",
        );
        // A dismissal holds while the condition lasts.
        expect(text("needs-attention")).not.toContain(
            "comes back if the thing it is about changes",
        );
        expect(text("needs-attention")).toContain(
            "comes back only if the problem clears and then happens again",
        );
        for (const gone of [
            "dot on a tab",
            "Needs attention",
            "Show dismissed",
            "The number beside",
        ]) {
            expect(text("needs-attention")).not.toContain(gone);
            expect(text("possible-duplicates")).not.toContain(gone);
        }
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
        ).toEqual(["recipe-drafts"]);
    });
});
