import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { DEFAULT_RESTOCK } from "../../../household.js";
import {
    renderSettingsRestockV2Page,
    restockLastRunLabel,
    restockSummary,
    restockTimeLabel,
} from "./settings-restock.js";
import {
    blockedLinksLabel,
    readersSummary,
    renderSettingsReadersV2Page,
} from "./settings-readers.js";

const chrome = {
    theme: "light" as const,
    attention: { count: 0, tabs: {} },
    flags: FIXTURE_APP_CHROME_FLAGS,
};

describe("restock labels", () => {
    test("time and day read like the design", () => {
        expect(restockTimeLabel("09:00")).toBe("9:00 AM");
        expect(restockTimeLabel("00:30")).toBe("12:30 AM");
        expect(restockTimeLabel("12:00")).toBe("12:00 PM");
        expect(restockTimeLabel("18:15")).toBe("6:15 PM");
        expect(
            restockSummary({
                ...DEFAULT_RESTOCK,
                enabled: true,
                weekday: 0,
                time: "09:00",
            }),
        ).toBe("Sunday, 9:00 AM");
        expect(restockSummary(DEFAULT_RESTOCK)).toBe("Off");
    });

    test("last run: date and count, date alone for an older run, or never", () => {
        const base = { ...DEFAULT_RESTOCK, lastRunOn: "2026-11-08" };
        expect(restockLastRunLabel({ ...base, lastRunAdded: 3 })).toBe(
            "Last ran Nov 8 · added 3 usuals",
        );
        expect(restockLastRunLabel({ ...base, lastRunAdded: 1 })).toBe(
            "Last ran Nov 8 · added 1 usual",
        );
        expect(restockLastRunLabel({ ...base, lastRunAdded: 0 })).toBe(
            "Last ran Nov 8 · added 0 usuals",
        );
        expect(restockLastRunLabel(base)).toBe("Last ran Nov 8");
        expect(restockLastRunLabel(DEFAULT_RESTOCK)).toBe("Hasn't run yet");
    });

    test("owners and admins get the switch and the schedule form; others read", () => {
        const edit = renderSettingsRestockV2Page({
            chrome,
            restock: DEFAULT_RESTOCK,
            canManage: true,
        });
        expect(edit).toContain('action="/settings/household/restock"');
        expect(edit).toContain('name="restock_enabled" value="on"');
        expect(edit).toContain('name="restock_weekday"');
        expect(edit).toContain('type="time"');
        const read = renderSettingsRestockV2Page({
            chrome,
            restock: DEFAULT_RESTOCK,
            canManage: false,
        });
        expect(read).not.toContain('action="/settings/household/restock"');
    });
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
        expect(blockedLinksLabel(1)).toBe("1 link");
        expect(blockedLinksLabel(3)).toBe("3 links");
    });

    test("a READERS section label sits above the readers card", () => {
        const html = renderSettingsReadersV2Page({
            chrome,
            socialReaders: { tiktok: true, facebook: false },
            blockedCount: 0,
            isOwner: true,
            canManage: true,
        });
        const label = html.indexOf(
            '<h2 class="fd-section-head__title">Readers</h2>',
        );
        expect(label).toBeGreaterThan(-1);
        expect(label).toBeLessThan(html.indexOf('aria-label="Readers"'));
    });

    test("turning a reader on opens the terms dialog; turning it off posts", () => {
        const html = renderSettingsReadersV2Page({
            chrome,
            socialReaders: { tiktok: true, facebook: false },
            blockedCount: 0,
            isOwner: true,
            canManage: true,
        });
        expect(html).toContain('commandfor="household-social-reader-facebook"');
        expect(html).toMatch(
            /action="\/settings\/household\/social-readers"[^>]*>(?:(?!<\/form>).)*name="enabled" value="0"/,
        );
        expect(html).toContain(">None<");
        expect(html).not.toContain("fetch-refusals/clear");
    });
});
