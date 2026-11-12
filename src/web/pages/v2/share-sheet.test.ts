import { describe, expect, test } from "bun:test";
import type { AppChromeBase } from "../../attention.js";
import {
    GROCERY_SHARE_SHEET_ID,
    parseShareExpiry,
    renderShareCreatedBody,
    renderShareSheet,
    renderShareTrigger,
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

    test("offers Never (selected), 7, 30 and 90 days", () => {
        expect(html).toContain('<option value="never" selected>Never</option>');
        for (const days of ["7", "30", "90"]) {
            expect(html).toContain(
                `<option value="${days}">${days} days</option>`,
            );
        }
        expect(html).toContain('name="expires"');
    });

    test("the submit button is outside the form and names it", () => {
        expect(html).toMatch(
            /<button type="submit" class="fd-btn fd-btn--primary" form="fd-grocery-share-sheet-form">Create link<\/button>/,
        );
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

test("the trigger opens its sheet", () => {
    expect(String(renderShareTrigger("my-sheet", "btn"))).toContain(
        'commandfor="my-sheet" command="show-modal"',
    );
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
        expect(html).toContain(
            'readonly spellcheck="false" autocomplete="off" value="https://foodable.test/s/TOKEN-ABC_123"',
        );
        expect(html.split("TOKEN-ABC_123").length - 1).toBe(1);
        expect(html).toContain("data-fd-share-copy");
        expect(html).toContain('href="/recipes/r1"');
    });

    test("names the recipe (escaped) or the list, and the expiry", () => {
        expect(renderShareCreatedBody(view)).toContain(
            "<strong>Dal &lt;tadka&gt;</strong>",
        );
        const list = renderShareCreatedBody({
            ...view,
            name: null,
            what: "grocery list",
            expiresAt: "2027-01-02T00:00:00.000Z",
        });
        expect(list).toContain("the grocery list");
        expect(list).toContain("Expires 2 Jan 2027");
    });
});
