import { expect, test } from "bun:test";
import {
    renderHouseholdInvitesPage,
    type HouseholdInvitesPageView,
} from "./settings-household-invites.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import type { HouseholdInvite } from "../../../db/invites.js";

const NOW = new Date("2026-11-10T12:00:00Z");

function view(
    over: Partial<HouseholdInvitesPageView> = {},
): HouseholdInvitesPageView {
    return {
        chrome: {
            theme: "dark",
            flags: FIXTURE_APP_CHROME_FLAGS,
        },
        flags: FIXTURE_APP_CHROME_FLAGS,
        backHref: "/",
        member: {
            userId: "u1",
            householdId: "h1",
            role: "owner",
            displayName: "Owner",
        },
        invites: [],
        now: NOW,
        ...over,
    };
}

function invite(over: Partial<HouseholdInvite>): HouseholdInvite {
    return {
        id: "i1",
        householdId: "h1",
        createdBy: "u1",
        createdAt: "2026-11-09T12:00:00Z",
        expiresAt: "2026-11-16T12:00:00Z",
        usedAt: null,
        usedBy: null,
        ...over,
    };
}

test("the page is the household's Settings layout: Invite codes, back to the household", () => {
    const html = renderHouseholdInvitesPage(view());
    expect(html).toContain('data-fd-settings-page="household"');
    expect(html).toContain(
        '<h1 class="fd-detail-bar__title">Invite codes</h1>',
    );
    expect(html).toContain(
        '<h1 class="fd-settings-page-title">Invite codes</h1>',
    );
    expect(html).toContain('aria-label="Back" href="/settings/household"');
    expect(html).toContain('<h2 class="fd-section-header__label">Invites</h2>');
    // No old sub-nav, panel, page header or intro line.
    expect(html).not.toContain("dash-head");
    expect(html).not.toContain('class="panel');
    expect(html).not.toContain("Let one person sign up into this household");
});

test("a page reached from elsewhere goes back there", () => {
    const html = renderHouseholdInvitesPage(view({ backHref: "/settings" }));
    expect(html).toContain('aria-label="Back" href="/settings"');
    expect(html).toContain('name="from" value="/settings"');
});

test("a new code is shown once in a card with a copy button and its note", () => {
    const html = renderHouseholdInvitesPage(
        view({ createdCode: "plain-code-<123>" }),
    );
    expect(html).toContain("New invite code");
    expect(html).toContain(
        '<code id="household-invite-code" data-fd-copy-source>plain-code-&lt;123&gt;</code>',
    );
    expect(html).toContain('data-fd-copy-trigger aria-label="Copy code"');
    expect(html).toContain("Works once · expires in 7 days · shown only now");
    expect(html).toContain("data-fd-copy-address");
    expect(renderHouseholdInvitesPage(view())).not.toContain("New invite code");
});

test("+ creates an invite from a form that opts out of Turbo, on the bar and in the header", () => {
    const html = renderHouseholdInvitesPage(view());
    const forms = html.match(
        /<form method="post" action="\/settings\/household\/invites" class="fd-settings-invite-create" data-turbo="false">/g,
    );
    expect(forms).toHaveLength(2);
    expect(html).toContain('aria-label="Create invite"');
    expect(html).toContain("fd-icon--plus");
    // No confirm modal: + makes the code.
    expect(html).not.toContain("household-invite-create");
    expect(html).not.toContain("Create a single-use code");
    expect(html).not.toContain('<dialog class="modal"');
});

test("only an active invite has a menu, and Revoke confirms in place", () => {
    const html = renderHouseholdInvitesPage(
        view({
            invites: [
                invite({ id: "active" }),
                invite({
                    id: "used",
                    usedAt: "2026-11-09T13:00:00Z",
                    usedBy: "u2",
                }),
                invite({ id: "old", expiresAt: "2026-11-01T12:00:00Z" }),
            ],
        }),
    );
    expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(1);
    const menu = html.match(
        /<div class="fd-menu[^>]*data-fd-menu[^]*?<\/form><\/div><\/div><\/div>/,
    )![0];
    expect(menu).toContain('action="/settings/household/invites/revoke"');
    expect(menu).toContain('name="invite_id" value="active"');
    expect(menu).toContain("data-fd-menu-confirm");
    expect(menu).toContain("Revoke invite");
    expect(html).not.toContain('value="used"');
    expect(html).not.toContain('value="old"');
    expect(html).toContain("Expires Nov 16");
    expect(html).toContain("Used Nov 9");
    expect(html).toContain("Expired Nov 1");
    // No sheet or modal for it.
    expect(html).not.toContain("household-invite-revoke");
});

test("an invite list with none says so", () => {
    expect(renderHouseholdInvitesPage(view())).toContain("No invite codes yet");
});

test("a failed create shows its reason as a banner", () => {
    const html = renderHouseholdInvitesPage(view({ error: "Nope" }));
    expect(html).toContain(
        '<p class="fd-settings-error" role="alert">Nope</p>',
    );
});
