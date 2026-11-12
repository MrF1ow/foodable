import { describe, expect, test } from "bun:test";
import {
    buildSharedLinkRows,
    renderSharedLinksSection,
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

describe("renderSharedLinksSection", () => {
    const rows: SharedLinkRow[] = [
        {
            id: "11111111-1111-1111-1111-111111111111",
            kind: "recipe",
            recipeName: "Dal <tadka>",
            createdByName: "Ada",
            createdAt: "2026-11-12T10:00:00.000Z",
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
            expiresAt: null,
        },
    ];

    test("one row per link: what, who and when, expiry, a Revoke that opens its sheet", () => {
        const html = renderSharedLinksSection(rows);
        expect(html).toContain("Shared links");
        expect(html).toContain("Dal &lt;tadka&gt;");
        expect(html).toContain(
            "Shared by Ada on 12 Nov 2026 · Expires 12 Dec 2026",
        );
        expect(html).toContain("Grocery list");
        expect(html).toContain("Shared on 1 Nov 2026 · Never expires");
        expect(html).toContain("Recipe (deleted)");
        expect(html.match(/command="show-modal"/g)).toHaveLength(3);
    });

    test("each Revoke posts to its own link, in a confirm sheet", () => {
        const html = renderSharedLinksSection(rows);
        for (const row of rows) {
            expect(html).toContain(`action="${sharedLinkRevokePath(row.id)}"`);
        }
        expect(html).toContain("Anyone who has this link will no longer");
    });

    test("with no links it says so and has no Revoke", () => {
        const html = renderSharedLinksSection([]);
        expect(html).toContain("No shared links");
        expect(html).not.toContain("revoke");
    });
});
