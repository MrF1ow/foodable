import { expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    HOUSEHOLD_ROTATE_TOKEN_SHEET_ID,
    renderHouseholdTokenPage,
    rotateTokenSheet,
} from "./settings-household-token.js";

const chrome = { theme: "dark" as const, flags: FIXTURE_APP_CHROME_FLAGS };

test("the rotate sheet is a confirm: its title asks, one line says what happens, Cancel and a danger Rotate token", () => {
    const html = rotateTokenSheet();
    expect(html).toContain(`id="${HOUSEHOLD_ROTATE_TOKEN_SHEET_ID}"`);
    expect(html).toContain("fd-sheet--dialog");
    expect(html).toContain("Rotate household token?");
    expect(html).toContain("Agents using the old token stop working.");
    expect(html).toContain("fd-sheet__actions--destructive");
    expect(html).toMatch(
        /<button type="submit" class="fd-btn fd-btn--danger"[^>]*form="[^"]+"[^>]*><span class="fd-btn__label">Rotate token<\/span>/,
    );
    expect(html).toContain(">Cancel<");
    // Not the old centred modal.
    expect(html).not.toContain('class="modal');
    expect(html).not.toContain("Issue a new household bot token");
});

test("the rotate form posts to the route and opts out of Turbo: its 200 answer carries the one-time token", () => {
    const html = rotateTokenSheet();
    expect(html).toMatch(
        /<form id="([^"]+)" method="post" action="\/settings\/household\/rotate-token" data-turbo="false">/,
    );
    const id = html.match(/<form id="([^"]+)"/)![1];
    expect(html).toContain(`form="${id}"`);
});

test("the token page shows the token once with a copy button, a note and Done", () => {
    const html = renderHouseholdTokenPage({
        chrome,
        token: "fdh_<7Qm2xR9vYb1KcN8dFhJ3sGaE5uOi>",
    });
    expect(html).toContain('data-fd-settings-page="household"');
    expect(html).toContain(
        '<h1 class="fd-detail-bar__title">Household token</h1>',
    );
    expect(html).toContain('aria-label="Back" href="/settings/household"');
    expect(html).toContain(
        '<code id="household-token" data-fd-copy-source>fdh_&lt;7Qm2xR9vYb1KcN8dFhJ3sGaE5uOi&gt;</code>',
    );
    expect(html).toContain("data-fd-copy-address");
    expect(html).toContain('data-fd-copy-trigger aria-label="Copy token"');
    expect(html).toContain("Shown only now");
    expect(html).toMatch(
        /<a class="fd-btn fd-btn--primary"[^>]*href="\/settings\/household"[^>]*><span class="fd-btn__label">Done<\/span><\/a>/,
    );
    // The token is in the markup once.
    expect(html.match(/7Qm2xR9vYb1KcN8dFhJ3sGaE5uOi/g)).toHaveLength(1);
    // The old banner is gone.
    expect(html).not.toContain("Household bot token (shown once)");
});

test("the token page keeps itself out of Turbo's snapshot cache and blanks the token on the way out", () => {
    const html = renderHouseholdTokenPage({ chrome, token: "fdh_abc" });
    expect(html).toContain('m.name="turbo-cache-control"');
    expect(html).toContain('m.content="no-cache"');
    expect(html).toContain("turbo:before-cache");
    expect(html).toContain('getElementById("household-token")');
    // The sheet that leads here is an ordinary page and stays cacheable.
    expect(rotateTokenSheet()).not.toContain("turbo-cache-control");
});
