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
import { renderFridgePage } from "../pages/fridge.js";
import { renderGroceryPage } from "../pages/grocery.js";
import { renderRecipesPage } from "../pages/recipes.js";
import { renderSettingsPage } from "../pages/settings.js";
import { renderFoodsSettingsPage } from "../pages/foods.js";
import { renderHouseholdSettingsPage } from "../pages/household.js";
import { renderNutritionPage } from "../pages/nutrition.js";
import { comingSoonPage } from "../shell.js";
import { createHouseholdFormHtml, forbiddenDashboardHtml } from "../loaders.js";

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
    const withNav = pageHeader({
        title: "Alice",
        actions: `<nav class="member-switch">x</nav>`,
    });
    expect(withNav).toContain('<header class="dash-head">');
    expect(withNav).toContain("<h1>Alice</h1>");
    expect(withNav).toContain('<nav class="member-switch">x</nav>');
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
            "Add a grocery store in Settings, then add a line.",
            "empty-grocery",
        ),
    ).toBe(
        '<p class="empty-grocery">Add a grocery store in Settings, then add a line.</p>',
    );
    expect(
        emptyState(
            "Add a grocery store in Settings, then add this recipe to the list.",
            "empty-recipe-store",
        ),
    ).toBe(
        '<p class="empty-recipe-store">Add a grocery store in Settings, then add this recipe to the list.</p>',
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
    expect(files.length).toBeGreaterThan(6);
    for (const file of files) {
        const src = readFileSync(file, "utf8");
        expect(src, file).not.toContain("<h1");
        expect(src, file).toContain("pageHeader");
    }
});

test("every page's h1 comes from pageHeader once", async () => {
    const chrome = { theme: "light" as const };
    const member = {
        householdId: "hh",
        userId: "u1",
        role: "owner" as const,
        displayName: "Alice",
    };
    const nutrition = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [member],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome,
    });
    const pages: Array<[string, string]> = [
        ["nutrition", nutrition],
        ["fridge", renderFridgePage({ locations: [], items: [], chrome })],
        ["grocery", renderGroceryPage({ chrome, stores: [] })],
        [
            "recipes",
            renderRecipesPage({
                chrome,
                recipes: [],
                members: [],
                viewerId: "u1",
            }),
        ],
        [
            "settings",
            renderSettingsPage({
                chrome,
                displayName: "Alice",
                timezone: "",
                weightUnit: "",
                widgetsEnabled: true,
                alcoholTrackingEnabled: false,
                drinkUnit: "",
            }),
        ],
        ["foods", renderFoodsSettingsPage({ chrome, foods: [] })],
        [
            "household",
            renderHouseholdSettingsPage({
                chrome,
                householdName: "House",
                location: "",
                members: [],
                stores: [],
                memberRules: [],
                isOwner: true,
            }),
        ],
        ["create-household", createHouseholdFormHtml()],
        ["coming-soon", comingSoonPage("fridge")],
    ];
    for (const [name, html] of pages) {
        const headings = html.match(/<h1>.*?<\/h1>/g) ?? [];
        expect(headings, name).toHaveLength(1);
        expect(html, name).toContain(headings[0]!);
    }
    expect(nutrition).toContain(pageHeader({ title: "Alice" }));
    const withError = await renderNutritionPage({
        access: {
            ok: true,
            mode: "self",
            viewer: member,
            subject: member,
        },
        members: [],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome,
        error: "Enter a meal description or add a food.",
    });
    expect(withError.indexOf("<h1>Alice</h1>")).toBeLessThan(
        withError.indexOf("error-banner"),
    );
    expect(withError).toContain(
        errorBanner("Enter a meal description or add a food."),
    );
    expect(forbiddenDashboardHtml()).not.toContain("<h1");
});
