import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    blockedLinksLabel,
    readersSummary,
    renderSettingsReadersV2Body,
    renderSettingsReadersV2Page,
    type SettingsReadersV2View,
} from "./settings-readers.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

const view = (over: Partial<SettingsReadersV2View> = {}) =>
    renderSettingsReadersV2Page({
        chrome,
        socialReaders: { tiktok: true, facebook: false },
        blockedCount: 0,
        isOwner: true,
        canManage: true,
        ...over,
    });

const body = (over: Partial<SettingsReadersV2View> = {}) =>
    renderSettingsReadersV2Body({
        chrome,
        socialReaders: { tiktok: true, facebook: false },
        blockedCount: 0,
        isOwner: true,
        canManage: true,
        ...over,
    });

describe("recipe link readers labels", () => {
    test("summary and blocked count", () => {
        expect(readersSummary({ tiktok: true, facebook: false })).toBe(
            "TikTok on",
        );
        expect(readersSummary({ tiktok: true, facebook: true })).toBe(
            "TikTok, Facebook on",
        );
        expect(readersSummary({ tiktok: false, facebook: false })).toBe("Off");
        expect(blockedLinksLabel(0)).toBe("None");
        expect(blockedLinksLabel(1)).toBe("1");
        expect(blockedLinksLabel(3)).toBe("3");
    });
});

describe("recipe link readers page", () => {
    test("a READERS section label sits above the readers list", () => {
        const html = view();
        const label = html.indexOf(
            '<h2 class="fd-section-header__label">Readers</h2>',
        );
        expect(label).toBeGreaterThan(-1);
        expect(label).toBeLessThan(html.indexOf('aria-label="Readers"'));
    });

    test("no intro and no owner-only note: the rows say it", () => {
        for (const isOwner of [true, false]) {
            const html = view({ isOwner });
            expect(html).not.toContain("When someone shares a TikTok");
            expect(html).not.toContain("Only the household owner can change");
            expect(html).not.toContain("fd-stores-intro");
        }
    });

    test("the owner's switches: on posts the turn-off, off asks to turn on in place", () => {
        const html = body();
        expect(html).toMatch(
            /<form[^>]*method="post"[^>]*action="\/settings\/household\/social-readers"[^>]*><input type="hidden" name="reader" value="tiktok"><input type="hidden" name="enabled" value="0">/,
        );
        // Off: a plain GET back to this page that opens the terms in place,
        // not a dialog.
        expect(html).toMatch(
            /<form[^>]*method="get"[^>]*action="\/settings\/household\/readers"[^>]*><input type="hidden" name="turn_on" value="facebook">/,
        );
        expect(html).not.toContain("<dialog");
        expect(html).not.toContain("household-social-reader");
        expect(html).not.toContain('name="confirm"');
    });

    test("asking to turn a reader on opens its terms in place, under its row", () => {
        const html = body({ confirmReader: "facebook" });
        expect(html).not.toContain("<dialog");
        expect(html).toContain("goes against that platform's terms of service");
        expect(html).toContain("recipe-import-terms-2026-11.md");
        expect(html).toContain("Facebook doesn't document");
        expect(html).toContain(
            "I understand this goes against Facebook's terms",
        );
        expect(html).toMatch(
            /<form[^>]*action="\/settings\/household\/social-readers"[^>]*><input type="hidden" name="reader" value="facebook"><input type="hidden" name="enabled" value="1">/,
        );
        expect(html).toContain('name="confirm" value="1"');
        expect(html).toMatch(
            /<button type="submit"[^>]*><span class="fd-btn__label">Turn on Facebook reader<\/span>/,
        );
        // Cancel goes back to the plain page.
        expect(html).toMatch(
            /<a class="fd-btn"[^>]*href="\/settings\/household\/readers"[^>]*><span class="fd-btn__label">Cancel<\/span><\/a>/,
        );
        // Only one reader's terms are open.
        expect(html).not.toContain("Turn on TikTok reader");
    });

    test("a refused confirm shows its reason inside the open terms", () => {
        const html = view({
            confirmReader: "facebook",
            error: "Confirm you understand the terms before turning this on.",
        });
        expect(
            html.match(/Confirm you understand the terms before/g),
        ).toHaveLength(1);
        expect(html.indexOf("Confirm you understand")).toBeGreaterThan(
            html.indexOf("goes against that platform"),
        );
    });

    test("an error with no confirm open is a banner", () => {
        const html = view({ error: "Unknown reader." });
        expect(html).toContain('role="alert"');
        expect(html).toContain("Unknown reader.");
    });

    test("terms stay closed for a reader that is already on, and for a viewer who is not the owner", () => {
        expect(view({ confirmReader: "tiktok" })).not.toContain(
            "goes against that platform",
        );
        const member = view({ isOwner: false, confirmReader: "facebook" });
        expect(member).not.toContain("goes against that platform");
        expect(member).not.toContain("social-readers");
        expect(member).not.toContain('role="switch"');
        expect(member).toContain(">On<");
        expect(member).toContain(">Off<");
    });

    test("Blocked links is a row with its count and a ⋯ that clears in place", () => {
        const html = view({ blockedCount: 3 });
        expect(html).toContain("Blocked links");
        expect(html).toContain('class="fd-item-row__value">3</span>');
        expect(html).toContain("data-fd-menu-confirm");
        expect(html).toContain(
            'action="/settings/household/fetch-refusals/clear"',
        );
        expect(html).toContain("Clear blocked links");
        expect(html).not.toContain("fd-settings-btn");
    });

    test("no blocked links, or a viewer who cannot manage: a plain row, no empty ⋯", () => {
        const none = view({ blockedCount: 0 });
        expect(none).toContain('class="fd-item-row__value">None</span>');
        expect(none).not.toContain("fetch-refusals/clear");
        expect(none).not.toContain("data-fd-menu-trigger");
        const reader = view({
            isOwner: false,
            canManage: false,
            blockedCount: 4,
        });
        expect(reader).toContain('class="fd-item-row__value">4</span>');
        expect(reader).not.toContain("fetch-refusals/clear");
        expect(reader).not.toContain("data-fd-menu-trigger");
    });

    test("an admin gets Clear but not the switches", () => {
        const html = view({ isOwner: false, canManage: true, blockedCount: 2 });
        expect(html).toContain("fetch-refusals/clear");
        expect(html).not.toContain('role="switch"');
    });
});

test("only TikTok carries the Public post captions line; Facebook has none (412254)", () => {
    const html = body({ socialReaders: { tiktok: true, facebook: true } });
    expect(html.split("Public post captions").length - 1).toBe(1);
    const facebook = html.split("<li").find((li) => li.includes(">Facebook<"));
    expect(facebook).toBeDefined();
    expect(facebook).not.toContain("fd-item-row__subtitle");
});
