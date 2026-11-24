import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import { DEFAULT_RESTOCK } from "../../../household.js";
import {
    renderSettingsRestockV2Page,
    restockDayLabel,
    restockLastRunLabel,
    restockTimeLabel,
} from "./settings-restock.js";

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};

describe("restock labels", () => {
    test("time and day read like the design", () => {
        expect(restockTimeLabel("09:00")).toBe("9:00 AM");
        expect(restockTimeLabel("00:30")).toBe("12:30 AM");
        expect(restockTimeLabel("12:00")).toBe("12:00 PM");
        expect(restockTimeLabel("18:15")).toBe("6:15 PM");
        expect(
            restockDayLabel({ ...DEFAULT_RESTOCK, enabled: true, weekday: 0 }),
        ).toBe("Sunday");
        expect(restockDayLabel(DEFAULT_RESTOCK)).toBe("Off");
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

    test("owners and admins get the switch, the Day pull-down and the Time row; others read", () => {
        const edit = renderSettingsRestockV2Page({
            chrome,
            restock: { ...DEFAULT_RESTOCK, enabled: true, weekday: 0 },
            canManage: true,
        });
        // The switch posts the opposite of what it shows.
        expect(edit).toContain('name="restock_enabled" value="off"');
        // Day is a pull-down on the row: the trigger reads the current day, a
        // tick marks it, each day posts its number.
        expect(edit).toContain('class="fd-item-row__value">Sunday</span>');
        expect(edit).toContain('role="menuitemcheckbox" aria-checked="true"');
        for (let day = 0; day < 7; day++) {
            expect(edit).toContain(`name="restock_weekday" value="${day}"`);
        }
        // Time saves itself.
        expect(edit).toMatch(
            /<form[^>]*action="\/settings\/household\/restock"[^>]*data-fd-autosave[^>]*>(?:(?!<\/form>).)*<input[^>]*type="time"[^>]*name="restock_time"/,
        );
        const read = renderSettingsRestockV2Page({
            chrome,
            restock: { ...DEFAULT_RESTOCK, enabled: true },
            canManage: false,
        });
        expect(read).not.toContain('action="/settings/household/restock"');
        expect(read).not.toContain("data-fd-menu");
        expect(read).not.toContain('type="time"');
        expect(read).toContain("Weekly restock");
        expect(read).toContain(">On<");
        // The time reads like the Day beside it: 6:30 PM, not 18:30.
        const timed = renderSettingsRestockV2Page({
            chrome,
            restock: { ...DEFAULT_RESTOCK, enabled: true, time: "18:30" },
            canManage: false,
        });
        expect(timed).toContain(">6:30 PM<");
        expect(timed).not.toContain("18:30");
    });

    test("no intro and no hint: the page keeps only the rows and the last run", () => {
        for (const canManage of [true, false]) {
            const html = renderSettingsRestockV2Page({
                chrome,
                restock: DEFAULT_RESTOCK,
                canManage,
            });
            expect(html).not.toContain("On the restock day Foodable adds");
            expect(html).not.toContain("Only the owner or an admin");
            expect(html).toContain("t run yet");
            expect(html).not.toContain("fd-stores-intro");
            expect(html).not.toContain("fd-settings-submit");
        }
    });

    test("a refused save shows its reason", () => {
        const html = renderSettingsRestockV2Page({
            chrome,
            restock: DEFAULT_RESTOCK,
            canManage: true,
            error: "Restock time must be HH:MM.",
        });
        expect(html).toContain("Restock time must be HH:MM.");
    });
});
