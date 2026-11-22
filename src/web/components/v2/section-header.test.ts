import { expect, test } from "bun:test";
import { sectionHeader } from "./section-header.js";
import { XSS, XSS_ESCAPED, text } from "./test-helpers.js";

test("a header is the label alone with the rule on by default", () => {
    expect(text(sectionHeader({ label: "Fridge" }))).toBe(
        `<div class="fd-section-header fd-section-header--rule"><h2 class="fd-section-header__label">Fridge</h2></div>`,
    );
});

test("Rule Off drops the modifier", () => {
    const html = sectionHeader({ label: "Fridge", rule: false });
    expect(html).toContain(`class="fd-section-header"`);
    expect(html).not.toContain("--rule");
});

test("a count shows after the label, a zero too", () => {
    expect(sectionHeader({ label: "Fridge", count: 5 })).toContain(
        `<span class="fd-section-header__count">5</span>`,
    );
    expect(sectionHeader({ label: "Fridge", count: 0 })).toContain(
        `<span class="fd-section-header__count">0</span>`,
    );
    expect(sectionHeader({ label: "Fridge" })).not.toContain("__count");
});

test("an action with an href is a link, without one a button", () => {
    expect(
        sectionHeader({
            label: "Fridge",
            action: { label: "See all", href: "/kitchen" },
        }),
    ).toContain(
        `<a class="fd-section-header__action" href="/kitchen">See all</a>`,
    );
    expect(
        sectionHeader({
            label: "Fridge",
            action: { label: "See all", data: { "fd-open": "all" } },
        }),
    ).toContain(
        `<button type="button" class="fd-section-header__action" data-fd-open="all">See all</button>`,
    );
});

test("the heading level and an id are options", () => {
    const html = sectionHeader({ label: "Fridge", level: 3, id: "fridge" });
    expect(html).toContain(`id="fridge"`);
    expect(html).toContain(`<h3 class="fd-section-header__label">`);
});

test("every string is escaped and a script URL is refused", () => {
    const html = sectionHeader({
        label: XSS,
        count: XSS,
        action: { label: XSS, href: "/x" },
        id: XSS,
        className: XSS,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain(XSS_ESCAPED);
    expect(() =>
        sectionHeader({
            label: "x",
            action: { label: "y", href: "javascript:alert(1)" },
        }),
    ).toThrow();
});
