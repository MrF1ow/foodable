import { test, expect } from "bun:test";
import { withWidgetData } from "../widgets.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
    renderDashboardHtml,
} from "./loaders.js";

import type { HouseholdMember } from "../household.js";
import type { NutritionView } from "./pages/nutrition.js";
import { NUTRITION_CARDS } from "../domain/layout.js";

const defaultCardOrder = [...NUTRITION_CARDS];

const alice: HouseholdMember = {
    householdId: "hh-1",
    userId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    displayName: "Alice",
};
const bob: HouseholdMember = {
    householdId: "hh-1",
    userId: "22222222-2222-4222-8222-222222222222",
    role: "member",
    displayName: "Bob",
};

const lightChrome = { theme: "light" as const };

test("withWidgetData seeds the existing script, not a second tag", () => {
    const html = "<html><script>initWidget({})</script></html>";
    const out = withWidgetData(html, { locale: "en" });
    expect((out.match(/<script>/g) ?? []).length).toBe(1);
    expect(out).toContain("window.__WIDGET_DATA__=");
    expect(out).toContain('"locale":"en"');
});

test("withWidgetData stamps an explicit viewer theme and never overrides the accent", () => {
    const html =
        '<html data-theme="light"><head></head><script>initWidget({})</script></html>';
    const dark = withWidgetData(html, { locale: "en" }, { theme: "dark" });
    expect(dark).toContain('<html data-theme="dark">');
    expect(dark).not.toContain("viewer-accent");
    expect(dark).not.toContain("--accent");

    const system = withWidgetData(html, { locale: "en" }, { theme: "system" });
    expect(system).toContain("<html>");
    expect(system).not.toContain("data-theme");
});

test("self dashboard reuses widget iframes and has no household facts", async () => {
    const html = await renderDashboardHtml({
        access: { ok: true, mode: "self", viewer: alice, subject: alice },
        members: [alice, bob],
        summary: { locale: "en", drink_unit: null },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en", unit: "kg" },
        chrome: lightChrome,
        cardOrder: defaultCardOrder,
    });
    expect(html).toContain("<h1>Alice</h1>");
    expect(html).not.toContain('class="peer-view-tag"');
    expect(html).not.toContain('class="facts"');
    expect(html).not.toContain('action="/add-household-member"');
    expect(html).toContain('title="nutrition-summary"');
    expect(html).toContain('title="goal-progress"');
    expect(html).toContain('title="trends"');
    expect(html).toContain('title="weight-trends"');
    expect(html).toContain("window.__WIDGET_DATA__=");
    expect(html).toContain('href="/logout"');
    expect(html).not.toContain('action="/approve"');
    expect(html).toContain(`href="/?member=${bob.userId}"`);
    expect(html).toContain('class="bottom-nav"');
    expect(html).toContain('href="/" aria-current="page"');
    expect(html).toContain('action="/log-meal"');
    expect(html).toContain('action="/log-water"');
    expect(html).toContain('action="/log-weight"');
    expect(html).not.toContain('class="error-banner"');
});

test("log-weight form follows the viewer's weight unit", async () => {
    const base: NutritionView = {
        access: { ok: true, mode: "self", viewer: alice, subject: alice },
        members: [alice],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: lightChrome,
        cardOrder: defaultCardOrder,
    };
    const lb = await renderDashboardHtml({ ...base, weightUnit: "lb" });
    expect(lb).toContain('<label for="log-weight-amount">Weight (lb)</label>');
    expect(lb).toContain('<input type="hidden" name="unit" value="lb" />');
    const unset = await renderDashboardHtml(base);
    expect(unset).toContain('<input type="hidden" name="unit" value="kg" />');
});

test("self dashboard logs through header modals", async () => {
    const html = await renderDashboardHtml({
        access: { ok: true, mode: "self", viewer: alice, subject: alice },
        members: [alice],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: lightChrome,
        cardOrder: defaultCardOrder,
    });
    expect(html).toContain('commandfor="nutrition-log-meal"');
    expect(html).toContain('commandfor="nutrition-log-water"');
    expect(html).toContain('commandfor="nutrition-log-weight"');
    expect(html).toContain('id="nutrition-log-meal"');
    expect(html).toContain(
        '<label class="meal-item-name">Food<input name="item_name" type="text" autocomplete="off" data-meal-item-name /></label>',
    );
    expect(html).not.toContain("fridge-add-supply");
    expect(html.indexOf("nutrition-log-meal")).toBeLessThan(
        html.indexOf("widget-frame"),
    );
});

test("owner self dashboard has no add-member form", async () => {
    const html = await renderDashboardHtml({
        access: { ok: true, mode: "self", viewer: alice, subject: alice },
        members: [alice],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: lightChrome,
        cardOrder: defaultCardOrder,
    });
    expect(html).not.toContain('action="/add-household-member"');
    expect(html).not.toContain("Add household member");
    expect(html).not.toContain("minlength");
});

test("member self dashboard has no add form", async () => {
    const html = await renderDashboardHtml({
        access: { ok: true, mode: "self", viewer: bob, subject: bob },
        members: [alice, bob],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: lightChrome,
        cardOrder: defaultCardOrder,
    });
    expect(html).toContain("<h1>Bob</h1>");
    expect(html).not.toContain('action="/add-household-member"');
    expect(html).not.toContain("Add household member");
});

test("peer dashboard is read-only", async () => {
    const html = await renderDashboardHtml({
        access: { ok: true, mode: "peer", viewer: alice, subject: bob },
        members: [alice, bob],
        summary: { locale: "en" },
        goals: { locale: "en" },
        trends: { locale: "en" },
        weight: { locale: "en" },
        chrome: lightChrome,
        cardOrder: defaultCardOrder,
    });
    expect(html).toContain("<h1>Bob</h1>");
    expect(html).toContain("Viewing Bob");
    expect(html).toContain('class="peer-view-tag"');
    expect(html).not.toContain("You can look, not edit");
    expect(html).toContain('href="/"');
    expect(html).toContain(`aria-current="page"`);
    expect(html).not.toContain('action="/approve"');
    expect(html).not.toContain('action="/add-household-member"');
    expect(html).not.toContain('class="facts"');
    expect(html).not.toContain('action="/log-meal"');
    expect(html).not.toContain('action="/log-water"');
    expect(html).not.toContain('action="/log-weight"');
});

test("create-household form posts name fields and has no widgets", () => {
    const html = createHouseholdFormHtml();
    expect(html).toContain('action="/create-household"');
    expect(html).toContain('name="household_name"');
    expect(html).toContain('name="display_name"');
    expect(html).toContain("<h1>Create household</h1>");
    expect(html).not.toContain("<iframe");
    expect(html).toContain('href="/logout"');
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
