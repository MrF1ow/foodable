import { expect, test } from "bun:test";
import { detailBar } from "./detail-bar.js";
import { raw } from "./html.js";
import { injectedAttributes, XSS } from "./test-helpers.js";

test("back, centred title and a trailing icon button", () => {
    const html = detailBar({
        title: "Settings",
        back: { href: "/settings" },
        trailing: { label: "More" },
    });
    expect(html).toStartWith('<header class="fd-detail-bar">');
    expect(html).toContain('<div class="fd-detail-bar__start">');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('aria-label="Back"');
    expect(html).toContain("fd-icon--chevron-left");
    expect(html).toContain('<h1 class="fd-detail-bar__title">Settings</h1>');
    expect(html).toContain('aria-label="More"');
    expect(html).toContain("fd-icon--more");
    expect(html).not.toContain("fd-detail-bar__balance");
});

test("balance keeps the title centred when there is no trailing control", () => {
    const html = detailBar({
        title: "Add a usual",
        back: { label: "Close" },
        balance: true,
    });
    expect(html).toContain(
        '<span class="fd-detail-bar__balance" aria-hidden="true"></span>',
    );
    expect(html).toContain('aria-label="Close"');
    expect(html).not.toContain("fd-icon--more");
});

test("a trailing control wins over the balance, and the title may be left out", () => {
    const html = detailBar({
        back: {},
        trailing: { label: "Share", icon: "share" },
        balance: true,
    });
    expect(html).toContain("fd-icon--share");
    expect(html).not.toContain("fd-detail-bar__balance");
    expect(html).not.toContain("<h1");
});

test("a trailing slot is a control the page built, in the end cell", () => {
    const html = detailBar({
        title: "Invite codes",
        back: { href: "/settings/household" },
        trailing: { slot: raw('<button type="submit">New</button>') },
        balance: true,
    });
    expect(html).toContain(
        '<div class="fd-detail-bar__end"><button type="submit">New</button></div>',
    );
    expect(html).not.toContain("fd-detail-bar__balance");
    expect(html).not.toContain("fd-icon--more");
});

test("every string is escaped", async () => {
    const html = detailBar({
        title: XSS,
        back: { label: XSS, href: `/b?${XSS}` },
        trailing: { label: XSS, href: `/t?${XSS}` },
        className: XSS,
        data: { k: XSS },
    });
    expect(await injectedAttributes(html)).toEqual([]);
    expect(html).not.toContain("<script>");
});

test("a back button that is not a link carries the attributes of a dialog's close hook", () => {
    const html = String(
        detailBar({
            title: "Scan a barcode",
            back: {
                label: "Close scanner",
                attrs: { "data-fd-scanner-close": "" },
            },
        }),
    );
    expect(html).toContain('aria-label="Close scanner"');
    expect(html).toContain("data-fd-scanner-close");
});
