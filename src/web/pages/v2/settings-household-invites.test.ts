import { expect, test } from "bun:test";
import {
    INVITE_CREATE_MODAL_ID,
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
            attention: { count: 0, tabs: {} },
            flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
        },
        flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
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

test("a new code is shown once in its own panel with a copy button", () => {
    const html = renderHouseholdInvitesPage(
        view({ createdCode: "plain-code-<123>" }),
    );
    expect(html).toContain(
        '<code id="household-invite-code">plain-code-&lt;123&gt;</code>',
    );
    expect(html).toContain('data-copy-target="household-invite-code"');
    expect(html).toContain('class="panel invite-code-once"');
    expect(renderHouseholdInvitesPage(view())).not.toContain(
        "invite-code-once",
    );
});

test("the page opens with its header, then the household sub-nav", () => {
    const html = renderHouseholdInvitesPage(view());
    const header = html.indexOf('<header class="dash-head">');
    const nav = html.indexOf('aria-label="Household sections"');
    expect(header).toBeGreaterThan(-1);
    expect(nav).toBeGreaterThan(header);
    expect(html).toContain("<h1>Invite codes</h1>");
    // The page body, not the shell around it (the shell's log sheet uses fd-btn).
    const body = html.slice(header, html.indexOf("</main>"));
    expect(body).not.toMatch(
        /fd-(page-title|panel|mono|banner|btn|invite-row)/,
    );
});

test("create opens a modal whose form opts out of Turbo", () => {
    const html = renderHouseholdInvitesPage(view());
    expect(html).toContain(`commandfor="${INVITE_CREATE_MODAL_ID}"`);
    expect(html).toMatch(
        /<form method="post" action="\/settings\/household\/invites" class="invite-create" data-turbo="false">/,
    );
    expect(html).toContain(
        '<button type="submit" class="btn-primary">Create invite</button>',
    );
});

test("only an active invite can be revoked", () => {
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
    expect(html).toContain('commandfor="household-invite-revoke-active"');
    // The same red trash as shared links, named after the invite, no text button.
    expect(html).toContain("fd-icon-btn--danger");
    expect(html).toContain(
        'aria-label="Revoke invite code (expires 2026-11-16)"',
    );
    expect(html).not.toContain("btn-sm btn-danger");
    expect(html).toContain('id="household-invite-revoke-active"');
    expect(html).not.toContain("household-invite-revoke-used");
    expect(html).not.toContain("household-invite-revoke-old");
    expect(html).toContain("Expires 2026-11-16");
    expect(html).toContain("Used 2026-11-09");
    expect(html).toContain("Expired 2026-11-01");
    expect(html).toContain('name="invite_id" value="active"');
});

test("an error reopens the create modal", () => {
    const html = renderHouseholdInvitesPage(view({ error: "Nope" }));
    expect(html).toContain(
        `id="${INVITE_CREATE_MODAL_ID}" aria-labelledby="${INVITE_CREATE_MODAL_ID}-title" data-modal-open-on-load`,
    );
    expect(html).toContain('<p class="error-banner">Nope</p>');
});
