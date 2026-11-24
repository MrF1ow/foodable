import { expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { raw } from "../../components/v2/html.js";
import { renderHouseholdLayout } from "./settings-household-layout.js";

const chrome = { theme: "light" as const, flags: FIXTURE_APP_CHROME_FLAGS };

test("the layout is the Settings layout with the household marked current", () => {
    const html = renderHouseholdLayout({
        chrome,
        title: "Sam",
        body: raw("<p>body</p>"),
    });
    expect(html).toContain('data-fd-settings-page="household"');
    expect(html).toContain("fd-page-layout--settings");
    expect(html).toContain('<h1 class="fd-detail-bar__title">Sam</h1>');
    expect(html).toContain('<h1 class="fd-settings-page-title">Sam</h1>');
    expect(html).toContain(
        '<div class="fd-settings-content"><p>body</p></div>',
    );
    expect(html).toContain('aria-label="Back" href="/settings/household"');
    expect(html).toContain('href="/settings/household" aria-current="page"');
});

test("with no control the Detail bar keeps a balance cell and the header has no actions", () => {
    const html = renderHouseholdLayout({ chrome, title: "Sam", body: "" });
    expect(html).toContain("fd-detail-bar__balance");
    expect(html).not.toContain("fd-settings-page-head__actions");
});

test("a control ends the Detail bar and the desktop header, so it shows at either width", () => {
    const control = raw('<button type="button">⋯</button>');
    const html = renderHouseholdLayout({
        chrome,
        title: "Sam",
        actions: control,
        body: "",
    });
    expect(html).toContain(
        '<div class="fd-detail-bar__end"><button type="button">⋯</button></div>',
    );
    expect(html).toContain(
        '<div class="fd-settings-page-head__actions"><button type="button">⋯</button></div>',
    );
    expect(html).not.toContain("fd-detail-bar__balance");
});

test("backHref sets where the phone arrow goes", () => {
    expect(
        renderHouseholdLayout({
            chrome,
            title: "Household",
            backHref: "/settings",
            body: "",
        }),
    ).toContain('aria-label="Back" href="/settings"');
});

test("the title is escaped", () => {
    const html = renderHouseholdLayout({
        chrome,
        title: "<img src=x onerror=alert(1)>",
        body: "",
    });
    expect(html).not.toContain("<img src=x");
});
