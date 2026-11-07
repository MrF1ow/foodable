import { expect, test } from "bun:test";
import type { Notice } from "../../domain/notices.js";
import type { NoticeDismissal } from "../../domain/notice-dismissals.js";
import { renderNeedsAttentionPage } from "./needs-attention.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 3, tabs: { fridge: true, recipes: true } },
};

function expiring(id: string): Notice {
    return {
        code: "fridge.expiring",
        severity: "info",
        subject: { kind: "fridge_item", id },
        related: [],
        params: { name: id, amount: 1, unit: "g", expiresOn: "2026-11-09" },
    };
}

function render(
    notices: Notice[],
    names: [string, string][],
    times: [string, number][],
    dismissals: NoticeDismissal[] = [],
    showDismissed = false,
): string {
    return renderNeedsAttentionPage({
        chrome,
        showDismissed,
        result: {
            notices,
            dismissals,
            subjectNames: new Map(names),
            subjectTimes: new Map(times),
            noticeFoods: new Map(),
        },
    } as never);
}

test("groups are newest first, whatever their severity, and undated groups go last", () => {
    // The warn recipe gap comes first in severity order, but its recipe is
    // the oldest; the info fridge item is the newest; the grocery line has no
    // timestamp and must render after both.
    const recipeGap: Notice = {
        code: "recipe.no_food",
        severity: "warn",
        subject: { kind: "recipe_ingredient", id: "ing", recipeId: "r-old" },
        related: [],
        params: { name: "Gap" },
    };
    const undated = expiring("line");
    undated.subject = { kind: "grocery_line", id: "line" };
    const html = render(
        [recipeGap, expiring("fresh"), undated],
        [
            ["recipe:r-old", "Old recipe"],
            ["fridge_item:fresh", "Fresh yogurt"],
            ["grocery_line:line", "Undated line"],
        ],
        [
            ["recipe:r-old", Date.parse("2020-01-01T00:00:00Z")],
            ["fridge_item:fresh", Date.parse("2030-01-01T00:00:00Z")],
        ],
    );
    const fresh = html.indexOf("<h2>Fresh yogurt</h2>");
    const old = html.indexOf("<h2>Old recipe</h2>");
    const undatedAt = html.indexOf("<h2>Undated line</h2>");
    expect(fresh).toBeGreaterThanOrEqual(0);
    expect(fresh).toBeLessThan(old);
    expect(old).toBeLessThan(undatedAt);
});

test("show dismissed escapes a subject name once", () => {
    const html = render(
        [],
        [["fridge_item:ice", "Ben & Jerry's"]],
        [],
        [
            {
                id: "d1",
                householdId: "h",
                code: "fridge.expiring",
                subjectKind: "fridge_item",
                subjectId: "ice",
                relatedKey: "",
                dismissedBy: null,
                createdAt: "2026-11-07T00:00:00Z",
            },
        ],
        true,
    );
    expect(html).toContain("Ben &amp; Jerry's");
    expect(html).toContain('<ul class="list"><li><div class="row">');
    expect(html).not.toContain("&amp;amp;");
});

test("a food group links to the household items page", () => {
    const n = expiring("f1");
    n.subject = { kind: "food", id: "f1" };
    const html = render([n], [["food:f1", "Eggs"]], []);
    expect(html).toContain('href="/household/items"');
    expect(html).not.toContain("/settings/foods");
});
