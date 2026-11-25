import { describe, expect, test } from "bun:test";
import type { AppChromeBase } from "../../attention.js";
import {
    GROCERY_SHARE_SHEET_ID,
    parseShareExpiry,
    renderShareCreatedBody,
    renderShareSheet,
    shareDateLabel,
    shareExpiryLabel,
} from "./share-sheet.js";

describe("parseShareExpiry", () => {
    test("accepts only the choices the sheet offers", () => {
        expect(parseShareExpiry("never")).toEqual({ ok: true, days: null });
        expect(parseShareExpiry("7")).toEqual({ ok: true, days: 7 });
        expect(parseShareExpiry(" 30 ")).toEqual({ ok: true, days: 30 });
        expect(parseShareExpiry("90")).toEqual({ ok: true, days: 90 });
        for (const bad of ["", "5", "0", "-7", "7.5", "365", "forever"]) {
            expect(parseShareExpiry(bad)).toEqual({ ok: false });
        }
    });
});

describe("renderShareSheet", () => {
    const html = renderShareSheet({
        id: GROCERY_SHARE_SHEET_ID,
        action: "/kitchen/groceries/share",
        title: "Share grocery list",
        subtitle: "The whole list",
        what: "grocery list",
    });

    test("posts to its action with Turbo off, so the 200 page is shown", () => {
        expect(html).toContain(
            'method="post" action="/kitchen/groceries/share" data-turbo="false"',
        );
    });

    test("asks how long the link works with chips, Never expires picked", () => {
        expect(html).toContain("Link works for");
        const chips = [
            ["7", "1 week"],
            ["30", "1 month"],
            ["90", "3 months"],
            ["never", "Never expires"],
        ] as const;
        for (const [value, label] of chips) {
            expect(html).toContain(`name="expires" value="${value}"`);
            expect(html).toContain(`>${label}<`);
        }
        expect(html).toContain('name="expires" value="never" checked');
        expect(html).not.toContain("<select");
    });

    test("the submit button is outside the form and names it", () => {
        expect(html).toMatch(
            /<button type="submit" class="fd-btn fd-btn--primary" data-fd-btn form="fd-grocery-share-sheet-form"><span class="fd-btn__label">Make link<\/span><\/button>/,
        );
    });

    test("a recipe's sheet has a title and no line under it", () => {
        const recipe = renderShareSheet({
            id: "s",
            action: "/x",
            title: "Share Dal",
            what: "recipe",
        });
        expect(recipe).toContain("Share Dal");
        expect(recipe).not.toContain("fd-sheet__subtitle");
    });

    test("an error shows in the sheet, escaped, and the sheet reopens", () => {
        const open = renderShareSheet({
            id: "s",
            action: "/x",
            title: "t",
            subtitle: "<b>",
            what: "recipe",
            open: true,
            error: "Pick <one>",
        });
        expect(open).toContain("data-sheet-open-on-load");
        expect(open).toContain("Pick &lt;one&gt;");
        expect(open).toContain("&lt;b&gt;");
    });
});

describe("dates", () => {
    test("a UTC day, month name and year", () => {
        expect(shareDateLabel("2026-12-14T23:59:00.000Z")).toBe("14 Dec 2026");
        expect(shareDateLabel("nonsense")).toBe("nonsense");
    });
    test("never, or the day it stops", () => {
        expect(shareExpiryLabel(null)).toBe("Never expires");
        expect(shareExpiryLabel("2026-12-14T00:00:00.000Z")).toBe(
            "Expires 14 Dec 2026",
        );
    });
});

describe("renderShareCreatedBody", () => {
    const view = {
        chrome: {} as AppChromeBase,
        url: "https://foodable.test/s/TOKEN-ABC_123",
        what: "recipe",
        name: "Dal <tadka>",
        expiresAt: null,
        backHref: "/recipes/r1",
        active: "recipes" as const,
    };

    test("the address is in one read-only field and nowhere else", () => {
        const html = renderShareCreatedBody(view);
        const input = html.match(
            /<input[^>]*value="https:\/\/foodable.test\/s\/TOKEN-ABC_123"[^>]*>/,
        );
        expect(input?.[0]).toContain("readonly");
        expect(html.split("TOKEN-ABC_123").length - 1).toBe(1);
        expect(html).toContain("data-fd-share-url");
    });

    test("is a Link ready sheet, open over the page it belongs to", () => {
        const html = renderShareCreatedBody(view);
        expect(html).toMatch(/<dialog[^>]*data-sheet-open-on-load/);
        expect(html).toContain(">Link ready</h2>");
        // The recipe's name under the title, escaped.
        expect(html).toContain("Dal &lt;tadka&gt;");
        expect(html).not.toContain("<tadka>");
        // The page behind: a Detail bar back to it, and its title.
        expect(html).toContain('href="/recipes/r1"');
        expect(html).toContain("fd-detail-bar");
    });

    test("Copy is an icon button in the box, and Done goes back to the page", () => {
        const html = renderShareCreatedBody(view);
        expect(html).toMatch(
            /<button[^>]*aria-label="Copy link"[^>]*data-fd-share-copy/,
        );
        expect(html).toContain('data-fd-share-back="/recipes/r1"');
        // Done closes the sheet, and closing goes to the page itself: no GET
        // form, which would land on the address with a stray "?".
        expect(html).not.toContain("<form");
        expect(html).toMatch(
            /<button[^>]*command="close"[^>]*commandfor="fd-share-made-sheet"[^>]*>(?:(?!<\/button>)[\s\S])*Done/,
        );
        expect(html).toContain(">Done</span>");
    });

    test("says anyone with the link can read it, and where to revoke it", () => {
        const html = renderShareCreatedBody(view);
        expect(html).toContain(
            "Anyone with the link can read this recipe. Revoke it in Settings › Household.",
        );
        expect(
            renderShareCreatedBody({
                ...view,
                name: null,
                what: "grocery list",
            }),
        ).toContain("Anyone with the link can read this grocery list.");
    });

    test("says when it expires, and that it is shown only once", () => {
        expect(renderShareCreatedBody(view)).toContain(
            "Never expires · shown only once",
        );
        const list = renderShareCreatedBody({
            ...view,
            name: null,
            what: "grocery list",
            expiresAt: "2027-01-02T00:00:00.000Z",
        });
        expect(list).toContain("Grocery list");
        expect(list).toContain("Expires 2 Jan 2027 · shown only once");
    });
});
