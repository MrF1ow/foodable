import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildSharedLinkRows,
    renderSharedLinksPage,
    sharedLinkRevokePath,
    type SharedLinkRow,
} from "./settings-household-shared-links.js";

const base = {
    createdAt: "2026-11-12T10:00:00.000Z",
    expiresAt: null,
};

describe("buildSharedLinkRows", () => {
    test("names each recipe and each maker, and leaves a gone one nameless", () => {
        const rows = buildSharedLinkRows(
            [
                {
                    id: "a",
                    kind: "recipe",
                    targetId: "r1",
                    createdBy: "u1",
                    ...base,
                },
                {
                    id: "b",
                    kind: "recipe",
                    targetId: "r-gone",
                    createdBy: "u-left",
                    ...base,
                },
                {
                    id: "c",
                    kind: "grocery_list",
                    targetId: null,
                    createdBy: null,
                    ...base,
                },
            ],
            new Map([["u1", "Ada"]]),
            new Map([["r1", "Dal tadka"]]),
        );
        expect(rows.map((r) => [r.recipeName, r.createdByName])).toEqual([
            ["Dal tadka", "Ada"],
            [null, null],
            [null, null],
        ]);
    });
});

const chrome = { theme: "light" as const, flags: FIXTURE_APP_CHROME_FLAGS };
const NOW = new Date("2026-11-10T12:00:00Z");

describe("renderSharedLinksPage", () => {
    const rows: SharedLinkRow[] = [
        {
            id: "11111111-1111-1111-1111-111111111111",
            kind: "recipe",
            recipeName: "Dal <tadka>",
            createdByName: "Ada",
            createdAt: "2026-11-02T10:00:00.000Z",
            expiresAt: "2026-12-12T10:00:00.000Z",
        },
        {
            id: "22222222-2222-2222-2222-222222222222",
            kind: "grocery_list",
            recipeName: null,
            createdByName: null,
            createdAt: "2026-11-01T10:00:00.000Z",
            expiresAt: null,
        },
        {
            id: "33333333-3333-3333-3333-333333333333",
            kind: "recipe",
            recipeName: null,
            createdByName: "Ada",
            createdAt: "2026-11-02T10:00:00.000Z",
            expiresAt: "2026-11-30T10:00:00.000Z",
        },
    ];
    const page = (
        over: Partial<Parameters<typeof renderSharedLinksPage>[0]> = {},
    ) => renderSharedLinksPage({ chrome, links: rows, now: NOW, ...over });

    test("the page is the household's Settings layout: Shared links, back to the household", () => {
        const html = page();
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain(
            '<h1 class="fd-detail-bar__title">Shared links</h1>',
        );
        expect(html).toContain(
            '<h1 class="fd-settings-page-title">Shared links</h1>',
        );
        expect(html).toContain('aria-label="Back" href="/settings/household"');
        // No section header, intro or old rows.
        expect(html).not.toContain("fd-settings-household-empty");
        expect(html).not.toContain("fd-row--shared-link");
    });

    test("one row per link, as the design words it", () => {
        const html = page();
        expect(html).toContain("Dal &lt;tadka&gt;");
        expect(html).toContain("Recipe · expires 12 Dec");
        expect(html).toContain("Grocery list");
        expect(html).toContain("Never expires");
        expect(html).toContain("Recipe (deleted)");
        expect(html).toContain("Expires 30 Nov");
        expect(html).not.toContain("Shared by");
    });

    test("each row has a ⋯ whose only item is Revoke, confirmed in place", () => {
        const html = page();
        expect(html.match(/data-fd-menu-trigger/g)).toHaveLength(3);
        expect(html.match(/data-fd-menu-confirm/g)).toHaveLength(3);
        for (const row of rows) {
            expect(html).toContain(`action="${sharedLinkRevokePath(row.id)}"`);
        }
        expect(html).toContain("Revoke link");
        // Not a sheet: no dialog holds it, and no trash icon button.
        expect(html).not.toContain("fd-shared-link-revoke");
        expect(html).not.toContain("Anyone who has this link will no longer");
        expect(html).not.toContain("fd-icon-btn");
        // No Copy link: the address is never stored, so it cannot be copied.
        expect(html).not.toContain("Copy link");
    });

    test("an expiry is the day in the household's zone", () => {
        const late = [{ ...rows[0]!, expiresAt: "2026-12-13T02:30:00.000Z" }];
        expect(page({ links: late })).toContain("expires 13 Dec");
        expect(
            page({ links: late, timezone: "America/Los_Angeles" }),
        ).toContain("expires 12 Dec");
    });

    test("with no links it says so and has no menu", () => {
        const html = page({ links: [] });
        expect(html).toContain("No shared links");
        expect(html).not.toContain("data-fd-menu-trigger");
        expect(html).not.toContain("revoke");
    });

    test("a refused revoke is a banner", () => {
        expect(page({ error: "That link was not found." })).toContain(
            'role="alert">That link was not found.',
        );
    });
});
