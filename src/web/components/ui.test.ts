import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
    confirmModal,
    disclosure,
    emptyState,
    errorBanner,
    modal,
    modalTrigger,
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
import { renderSettingsHelpPage } from "../pages/settings-help.js";
import { renderNutritionPage } from "../pages/nutrition.js";
import { comingSoonPage } from "../shell.js";
import { createHouseholdFormHtml, forbiddenDashboardHtml } from "../loaders.js";

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
    const withNav = pageHeader({
        title: "Alice",
        actions: `<nav class="member-switch">x</nav>`,
    });
    expect(withNav).toContain('<header class="dash-head">');
    expect(withNav).toContain("<h1>Alice</h1>");
    expect(withNav).toContain('<div class="page-actions">');
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

test("modal, modalTrigger, and confirmModal markup", () => {
    const m = modal({
        id: "add-food",
        title: "Add food",
        body: "<form></form>",
        size: "wide",
    });
    expect(m).toContain('<dialog class="modal modal--wide" id="add-food"');
    expect(m).toContain('aria-labelledby="add-food-title"');
    expect(m).toContain(
        '<h2 class="modal-title" id="add-food-title">Add food</h2>',
    );
    expect(m).toContain(
        '<button type="button" class="modal-close" command="close" commandfor="add-food"',
    );
    expect(m).toContain('<div class="modal-handle" aria-hidden="true"></div>');
    expect(m).toContain('<div class="modal-body">\n<form></form>\n</div>');

    expect(modal({ id: "x", title: "A & B", body: "<p>y</p>" })).toContain(
        '<h2 class="modal-title" id="x-title">A &amp; B</h2>',
    );

    expect(modalTrigger({ target: "add-food", label: "Add food" })).toBe(
        '<button type="button" class="btn-primary" commandfor="add-food" command="show-modal">Add food</button>',
    );
    expect(
        modalTrigger({
            target: "del",
            label: "Remove",
            className: "btn-sm btn-danger",
        }),
    ).toContain('class="btn-sm btn-danger"');

    const confirm = confirmModal({
        id: "del-item",
        title: "Delete item?",
        message: "Remove <b>eggs</b> from the fridge.",
        action: "/fridge/items/1/delete",
        confirmLabel: "Delete",
        hiddenFields: { csrf: "tok" },
    });
    expect(confirm).toContain('id="del-item"');
    expect(confirm).toContain(
        '<form class="modal-confirm" method="post" action="/fridge/items/1/delete">',
    );
    expect(confirm).toContain(
        '<input type="hidden" name="csrf" value="tok" />',
    );
    expect(confirm).toContain(
        '<p class="modal-message">Remove &lt;b&gt;eggs&lt;/b&gt; from the fridge.</p>',
    );
    expect(confirm).toContain(
        '<button type="button" command="close" commandfor="del-item">Cancel</button>',
    );
    expect(confirm).toContain(
        '<button type="submit" class="btn-danger">Delete</button>',
    );
    expect(
        confirmModal({
            id: "del-open",
            title: "Delete?",
            message: "Sure?",
            action: "/x",
            confirmLabel: "Delete",
            openOnLoad: true,
        }),
    ).toMatch(
        /<dialog class="modal" id="del-open"[^>]*data-modal-open-on-load/,
    );

    expect(
        modalTrigger({
            target: "edit-1",
            label: "Edit Eggs",
            className: "btn-sm btn-icon",
            icon: "<svg></svg>",
        }),
    ).toContain('aria-label="Edit Eggs"');
    expect(
        modalTrigger({
            target: "edit-1",
            label: "Edit Eggs",
            className: "btn-sm btn-icon",
            icon: "<svg></svg>",
        }),
    ).toContain("<svg></svg>");
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
        cardOrder: [
            "log",
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
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
        ["help", renderSettingsHelpPage({ chrome })],
        ["create-household", createHouseholdFormHtml()],
        ["coming-soon", comingSoonPage("fridge")],
    ];
    for (const [name, html] of pages) {
        const headings = html.match(/<h1>.*?<\/h1>/g) ?? [];
        expect(headings, name).toHaveLength(1);
        expect(html, name).toContain(headings[0]!);
        assertNoNestedForms(html);
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
        cardOrder: [
            "log",
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
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
