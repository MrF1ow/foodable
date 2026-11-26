import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    disclosure,
    emptyState,
    errorBanner,
    pageHeader,
    panel,
    row,
} from "./ui.js";
import { renderAppShell } from "../shell.js";
import { createHouseholdFormHtml, forbiddenDashboardHtml } from "../loaders.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../test-support/chrome-flags.js";

// A bare tab page: the shell around one heading, with no tab content.
function shellPage(
    active: "fridge" | "household" = "fridge",
    theme: "system" | "light" | "dark" = "system",
): string {
    const title = active === "fridge" ? "Fridge" : "Settings";
    return renderAppShell({
        title,
        active,
        theme,
        body: `<h1>${title}</h1>`,
        flags: FIXTURE_APP_CHROME_FLAGS,
    });
}

/** Fails when any `<form>` opens before its parent form closes. */
export function assertNoNestedForms(html: string): void {
    const tagRe = /<\/?form\b/gi;
    let depth = 0;
    for (const match of html.matchAll(tagRe)) {
        const isClose = match[0].startsWith("</");
        if (isClose) {
            depth -= 1;
            expect(depth).toBeGreaterThanOrEqual(0);
        } else {
            expect(depth, "nested <form>").toBe(0);
            depth += 1;
        }
    }
    expect(depth).toBe(0);
}

const pagesDir = join(import.meta.dir, "../pages");

test("pageHeader is an h1, wrapped in dash-head when there is a sub or actions", () => {
    expect(pageHeader({ title: "Fridge" })).toBe("<h1>Fridge</h1>");
    expect(pageHeader({ title: "A & B" })).toBe("<h1>A &amp; B</h1>");
    expect(
        pageHeader({
            title: "Create household",
            sub: `<p class="muted">Name it.</p>`,
        }),
    ).toBe(`<header class="dash-head">
<h1>Create household</h1>
<p class="muted">Name it.</p>
</header>`);
    const withTitleActions = pageHeader({
        title: "Fridge",
        titleActions: `<button type="button" class="btn-sm btn-primary">Add</button>`,
    });
    expect(withTitleActions).toContain('<header class="dash-head">');
    expect(withTitleActions).toContain('<div class="dash-head-title-row">');
    expect(withTitleActions).toContain("<h1>Fridge</h1>");
    expect(withTitleActions).toContain('<div class="dash-head-title-actions">');
    expect(withTitleActions).not.toContain('<div class="page-actions">');
    const withNav = pageHeader({
        title: "Alice",
        titleActions: `<nav class="member-switch">x</nav>`,
        actions: `<button type="button" class="btn-sm">Log meal</button>`,
    });
    expect(withNav).toContain('<header class="dash-head">');
    expect(withNav).toContain("<h1>Alice</h1>");
    const titleActionsBlock = withNav.match(
        /<div class="dash-head-title-actions">\n([\s\S]*?)\n<\/div>/,
    )?.[1];
    expect(titleActionsBlock).toContain('<nav class="member-switch">x</nav>');
    expect(titleActionsBlock).not.toContain("Log meal");
    const pageActionsBlock = withNav.match(
        /<div class="page-actions">\n([\s\S]*?)\n<\/div>/,
    )?.[1];
    expect(pageActionsBlock).toContain("Log meal");
    expect(pageActionsBlock).not.toContain("member-switch");
});

test("errorBanner, emptyState, disclosure, panel, and row markup", () => {
    expect(errorBanner()).toBe("");
    expect(errorBanner("Enter a name.")).toBe(
        '<p class="error-banner">Enter a name.</p>',
    );
    expect(errorBanner("A <b>x</b>")).toBe(
        '<p class="error-banner">A &lt;b&gt;x&lt;/b&gt;</p>',
    );

    expect(emptyState("Add a recipe.", "empty-recipes")).toBe(
        '<p class="empty-recipes">Add a recipe.</p>',
    );
    expect(
        emptyState("Add a location, then add an item.", "empty-fridge"),
    ).toBe('<p class="empty-fridge">Add a location, then add an item.</p>');
    expect(
        emptyState(
            "Add a grocery store under Household, then add a line.",
            "empty-grocery",
        ),
    ).toBe(
        '<p class="empty-grocery">Add a grocery store under Household, then add a line.</p>',
    );
    expect(
        emptyState(
            "Add a grocery store under Household, then add this recipe to the list.",
            "empty-recipe-store",
        ),
    ).toBe(
        '<p class="empty-recipe-store">Add a grocery store under Household, then add this recipe to the list.</p>',
    );
    expect(emptyState("No foods in the catalog yet.")).toBe(
        '<p class="empty">No foods in the catalog yet.</p>',
    );

    expect(
        disclosure({
            summary: "Add location",
            body: "<form></form>",
            open: true,
        }),
    ).toBe(`<details class="more" open>
<summary>Add location</summary>
<form></form>
</details>`);
    expect(disclosure({ summary: "<h3>Add food</h3>", body: "x" })).toContain(
        "<summary><h3>Add food</h3></summary>",
    );

    expect(panel({ body: "<p>x</p>" })).toBe(`<section class="panel">
<p>x</p>
</section>`);
    expect(panel({ title: "Members", body: "<ul></ul>" })).toContain(
        "<h2>Members</h2>",
    );
    expect(panel({ body: "x", className: "log-panel" })).toContain(
        'class="panel log-panel"',
    );

    expect(row({ title: "Alice", meta: "owner" })).toBe(
        '<div class="row"><span class="row-title">Alice</span><span class="row-meta">owner</span></div>',
    );
    expect(row({ title: "Bob", actions: "<form></form>" })).toContain(
        '<div class="row-actions">\n<form></form>\n</div>',
    );
});

test("no page module contains a raw <h1", () => {
    const files = readdirSync(pagesDir)
        .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
        .map((name) => join(pagesDir, name));
    files.push(join(pagesDir, "../loaders.ts"));
    // dev-gallery, share-view and loaders.ts.
    expect(files.length).toBeGreaterThan(2);
    for (const file of files) {
        // The public share page draws its title as the design does, plain
        // text, with no Page header (that is the signed-in app's).
        if (file.endsWith("share-view.ts")) continue;
        const src = readFileSync(file, "utf8");
        expect(src, file).not.toContain("<h1");
        // loaders.ts only loads: its pages come from pages/.
        if (!file.endsWith("loaders.ts"))
            expect(src, file).toContain("pageHeader");
    }
});

test("every page's h1 comes from pageHeader once", () => {
    const pages: Array<[string, string]> = [["app-shell", shellPage()]];
    for (const [name, html] of pages) {
        const headings = html.match(/<h1>.*?<\/h1>/g) ?? [];
        expect(headings, name).toHaveLength(1);
        expect(html, name).toContain(headings[0]!);
        assertNoNestedForms(html);
    }
    // A gate's one heading is the page's name for a screen reader; the Brand
    // hero draws the name.
    for (const html of [createHouseholdFormHtml(), forbiddenDashboardHtml()]) {
        expect(html.match(/<h1[ >]/g)).toHaveLength(1);
        expect(html).toContain('<h1 class="fd-visually-hidden">');
    }
});
