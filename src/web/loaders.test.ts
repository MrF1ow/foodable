import { test, expect } from "bun:test";
import { createHouseholdFormHtml, forbiddenDashboardHtml } from "./loaders.js";

test("create-household form posts name fields and has no widgets", () => {
    const html = createHouseholdFormHtml();
    expect(html).toContain('action="/create-household"');
    expect(html).toContain('name="household_name"');
    expect(html).toContain('name="display_name"');
    expect(html).toContain("<h1>Create household</h1>");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="/logout"');
    expect(html).toContain('data-turbo="false"');
});

test("bare pages use the app stylesheet, not the deleted marketing one", () => {
    const html = createHouseholdFormHtml("Enter a household name.");
    expect(html).toMatch(
        /<link rel="stylesheet" href="\/app\.css\?v=[a-f0-9]{12}" data-turbo-track="reload" \/>/,
    );
    expect(html).toMatch(
        /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
    );
    expect(html).not.toContain("/styles.css");
    expect(html).not.toContain("<style>");
    expect(html).toContain('<main class="app-main native">');
    expect(html).toContain(
        '<form method="POST" action="/create-household" class="create-household panel">',
    );
    expect(html).toContain(
        '<button type="submit" class="btn-primary">Create household</button>',
    );
    expect(html).toContain('class="app-bar-logo"');
    expect(html).toContain('aria-label="Log out"');
    expect(html).toContain('class="error-banner"');
    expect(html).not.toContain('class="logout"');
    expect(html).not.toContain("bottom-nav");
});

test("bare pages stamp data-theme when preview asks, and always show the top bar", () => {
    const light = createHouseholdFormHtml(undefined, "light");
    const dark = createHouseholdFormHtml(undefined, "dark");
    expect(light).toContain('data-theme="light"');
    expect(dark).toContain('data-theme="dark"');
    expect(light).not.toBe(dark);
    const forbidden = forbiddenDashboardHtml("light");
    expect(forbidden).toContain('<header class="app-bar">');
    expect(forbidden).toContain('data-theme="light"');
    expect(forbidden).toContain('class="empty"');
    expect(forbidden).not.toContain("bottom-nav");
});
