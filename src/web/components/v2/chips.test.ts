import { expect, test } from "bun:test";
import { choiceGroup, chipLink, chipNav } from "./chips.js";
import { XSS, XSS_ESCAPED, text } from "./test-helpers.js";

test("a selected chip link is aria-current=true and carries the selected class", () => {
    const html = chipLink({
        label: "Costco",
        href: "?store=1",
        count: 4,
        selected: true,
    });
    expect(text(html)).toBe(
        `<a class="fd-chip fd-chip--selected" href="?store=1" aria-current="true"><span class="fd-chip__label">Costco</span><span class="fd-chip__count">4</span></a>`,
    );
});

test("an unselected chip link has neither the class nor aria-current", () => {
    const html = chipLink({ label: "Foods", href: "/s?kind=foods" });
    expect(html).not.toContain("aria-current");
    expect(html).not.toContain("--selected");
    expect(html).not.toContain("fd-chip__count");
});

test("a zero count still renders", () => {
    expect(chipLink({ label: "Recipes", href: "/", count: 0 })).toContain(
        `<span class="fd-chip__count">0</span>`,
    );
});

test("chipNav is a labelled nav", () => {
    const nav = chipNav([chipLink({ label: "All", href: "/" })], {
        label: "Filter foods",
    });
    expect(nav).toStartWith(`<nav class="fd-chips" aria-label="Filter foods">`);
    expect(nav).toEndWith("</nav>");
});

test("choiceGroup is a fieldset with a legend and one radio per option", () => {
    const html = choiceGroup({
        name: "meal",
        legend: "Add to",
        options: [
            { value: "breakfast", label: "Breakfast" },
            { value: "dinner", label: "Dinner", selected: true },
            { value: "snack", label: "Snacks", disabled: true, count: 2 },
        ],
    });
    expect(html).toStartWith(
        `<fieldset class="fd-choice-group"><legend class="fd-sr">Add to</legend>`,
    );
    expect(html.match(/<input /g)?.length).toBe(3);
    expect(html).toContain(
        `<input class="fd-chip__input" type="radio" name="meal" value="dinner" checked>`,
    );
    expect(html).toContain(`value="breakfast">`);
    expect(html).toContain(`value="snack" disabled>`);
    // Radios share one name so the browser makes them one group.
    expect(html.match(/name="meal"/g)?.length).toBe(3);
    expect(html).toContain(`<span class="fd-chip__count">2</span>`);
    expect(html).toContain(`class="fd-chip fd-chip--choice"`);
});

test("showLegend renders a visible legend", () => {
    const html = choiceGroup({
        name: "meal",
        legend: "Add to",
        showLegend: true,
        options: [{ value: "a", label: "A" }],
    });
    expect(html).toContain(
        `<legend class="fd-choice-group__legend">Add to</legend>`,
    );
    expect(html).not.toContain(`<legend class="fd-sr">`);
});

test("required lands on every radio", () => {
    const html = choiceGroup({
        name: "unit",
        legend: "Unit",
        required: true,
        options: [
            { value: "g", label: "g" },
            { value: "oz", label: "oz" },
        ],
    });
    expect(html.match(/ required>/g)?.length).toBe(2);
});

test("every string is escaped", () => {
    const link = chipLink({
        label: XSS,
        href: `/?${XSS}`,
        count: XSS,
        className: XSS,
    });
    expect(link).not.toContain("<script");
    expect(link).toContain(`href="/?${XSS_ESCAPED}"`);
    const group = choiceGroup({
        name: XSS,
        legend: XSS,
        className: XSS,
        options: [{ value: XSS, label: XSS, count: XSS }],
    });
    expect(group).not.toContain("<script");
    expect(group).toContain(`name="${XSS_ESCAPED}"`);
    expect(group).toContain(`value="${XSS_ESCAPED}"`);
    expect(chipNav([], { label: XSS })).not.toContain("<script");
});

test("chipLink only takes app paths, queries, fragments and http(s) URLs", () => {
    for (const href of [
        "/",
        "?store=1",
        "#top",
        "https://world.openfoodfacts.org/p/1",
    ]) {
        expect(() => chipLink({ label: "x", href })).not.toThrow();
    }
    for (const href of [
        "javascript:alert(1)",
        " javascript:x",
        "//evil.example",
        "data:text/html,x",
    ]) {
        expect(() => chipLink({ label: "x", href })).toThrow("unsafe href");
    }
});
