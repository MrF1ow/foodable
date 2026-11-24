import { describe, expect, test } from "bun:test";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    COMMON_TIME_ZONES,
    renderSettingsTimezoneV2Page,
    TIME_ZONE_SEARCH_LIMIT,
    timeZonesFor,
    utcOffsetLabel,
} from "./settings-account-timezone.js";

const chrome = { theme: "light" as const, flags: FIXTURE_APP_CHROME_FLAGS };
// A winter day: the offsets are standard time (no daylight saving anywhere
// the list shows).
const now = new Date("2026-01-15T12:00:00Z");

/** The zone list's own form: the page around it holds other radios. */
function tzForm(html: string): string {
    const start = html.indexOf('<form class="fd-settings-tz-form"');
    return html.slice(start, html.indexOf("</form>", start));
}

const view = {
    chrome,
    backHref: "/",
    timezone: "America/Los_Angeles",
    now,
};

describe("utcOffsetLabel", () => {
    test("whole hours, a true minus sign, UTC+0 and half hours", () => {
        expect(utcOffsetLabel("America/Los_Angeles", now)).toBe("UTC−8");
        expect(utcOffsetLabel("America/New_York", now)).toBe("UTC−5");
        expect(utcOffsetLabel("Europe/London", now)).toBe("UTC+0");
        expect(utcOffsetLabel("Europe/Kyiv", now)).toBe("UTC+2");
        expect(utcOffsetLabel("Asia/Tokyo", now)).toBe("UTC+9");
        expect(utcOffsetLabel("Asia/Kolkata", now)).toBe("UTC+5:30");
        expect(utcOffsetLabel("UTC", now)).toBe("UTC+0");
    });

    test("follows daylight saving on the day asked", () => {
        const summer = new Date("2026-07-15T12:00:00Z");
        expect(utcOffsetLabel("America/Los_Angeles", summer)).toBe("UTC−7");
    });

    test("a name the runtime does not know has no offset", () => {
        expect(utcOffsetLabel("Not/AZone", now)).toBe("");
    });
});

describe("timeZonesFor", () => {
    test("nothing typed: the stored zone first, then the common ones once each", () => {
        const list = timeZonesFor("Europe/Paris", "");
        expect(list[0]).toBe("Europe/Paris");
        expect(list.slice(1)).toEqual([...COMMON_TIME_ZONES]);
        const common = timeZonesFor("America/Denver", "");
        expect(common[0]).toBe("America/Denver");
        expect(common).toHaveLength(COMMON_TIME_ZONES.length);
        expect(timeZonesFor("", "")).toEqual([...COMMON_TIME_ZONES]);
    });

    test("typing matches every word, ignoring case, slashes and underscores", () => {
        expect(timeZonesFor("", "new york")).toContain("America/New_York");
        expect(timeZonesFor("", "AMERICA/NEW")).toContain("America/New_York");
        const kyiv = timeZonesFor("", "kyiv");
        expect(kyiv.every((z) => z.toLowerCase().includes("kyiv"))).toBe(true);
        expect(timeZonesFor("", "zzzz nothing")).toEqual([]);
    });

    test("a one-letter search stays a short list", () => {
        expect(timeZonesFor("", "a").length).toBeLessThanOrEqual(
            TIME_ZONE_SEARCH_LIMIT,
        );
    });

    test("a stored alias the runtime does not list is found and kept", () => {
        expect(timeZonesFor("US/Pacific", "")[0]).toBe("US/Pacific");
        expect(timeZonesFor("US/Pacific", "us pacific")).toContain(
            "US/Pacific",
        );
    });
});

describe("settings time zone v2", () => {
    test("a Detail bar back to Account, a search field and the zones as round choices", () => {
        const html = renderSettingsTimezoneV2Page(view);
        expect(html).toContain('data-fd-settings-page="timezone"');
        expect(html).toMatch(
            /fd-settings-detail[\s\S]*?aria-label="Back" href="\/settings\/account"[\s\S]*?fd-detail-bar__title">Time zone</,
        );
        expect(html).toContain('<h1 class="fd-settings-page-title">Time zone');
        // The search is a GET form of the Search field component.
        expect(html).toMatch(
            /<form class="fd-settings-tz-search" method="get" action="\/settings\/account\/timezone" role="search"[^>]*>/,
        );
        expect(html).toContain('placeholder="Search time zones"');
        expect(html).toContain('name="q"');
        // One round choice per zone, the stored one picked, with its offset.
        const radios = tzForm(html).match(/<input type="radio"[^>]*>/g) ?? [];
        expect(radios).toHaveLength(COMMON_TIME_ZONES.length);
        expect(html).toContain(
            '<input type="radio" class="fd-item-row__check-input" name="timezone" value="America/Los_Angeles" checked aria-label="America/Los_Angeles, UTC−8">',
        );
        expect(tzForm(html).match(/ checked /g)).toHaveLength(1);
        expect(html).toContain('fd-item-row__value">UTC−8<');
        expect(html).toContain('fd-item-row__value">UTC+9<');
        // The Time zone page is Account's: the menu keeps Account current.
        expect(html).toMatch(
            /aria-current="page"><svg[^>]*>[\s\S]*?<\/svg><span class="fd-side-link__label">Account</,
        );
    });

    test("the list is one Turbo form that returns to Account, saved by a pick, not by arrow keys", () => {
        const html = renderSettingsTimezoneV2Page({
            ...view,
            backHref: "/kitchen/fridge",
        });
        const form = html.match(/<form class="fd-settings-tz-form"[^>]*>/)![0];
        expect(form).toContain('method="post"');
        expect(form).toContain('action="/settings"');
        // Autosave would save on every arrow key (change); a pick form saves
        // on a pointer choice only, and Enter or Save on the rest.
        expect(form).toContain("data-fd-pick");
        expect(form).not.toContain("data-fd-autosave");
        expect(form).not.toContain("data-turbo");
        expect(html).toContain('name="group" value="nutrition"');
        expect(html).toContain('name="return" value="/settings/account"');
        expect(html).toContain('name="from" value="/kitchen/fridge"');
        expect(html).not.toContain('data-turbo="false"');
    });

    test("the zones are a named radio group, each radio named with its offset, and Save shows without script", () => {
        const html = renderSettingsTimezoneV2Page(view);
        const group = tzForm(html);
        expect(group).toMatch(
            /<fieldset class="fd-settings-tz-group"><legend class="fd-visually-hidden">Time zone<\/legend>/,
        );
        expect(group).toContain(
            'aria-label="Asia/Tokyo, UTC+9"><span class="fd-item-row__check-box"',
        );
        for (const radio of group.match(/<input type="radio"[^>]*>/g) ?? [])
            expect(radio).toMatch(/aria-label="[^"]+, UTC[+−][^"]*"/);
        expect(group).toContain(
            '<noscript><button type="submit" class="fd-btn">Save</button></noscript>',
        );
    });

    test("a search shows its matches, and the field keeps what was typed", () => {
        const html = renderSettingsTimezoneV2Page({ ...view, query: "tokyo" });
        expect(html).toContain('value="tokyo"');
        expect(html).toContain('value="Asia/Tokyo"');
        expect(html).not.toContain('value="America/Denver"');
    });

    test("a search with no match says so and keeps the form", () => {
        const html = renderSettingsTimezoneV2Page({
            ...view,
            query: "zzzz nothing",
        });
        expect(html).toContain("No time zone matches");
        expect(tzForm(html)).not.toContain('type="radio"');
        expect(html).toContain('action="/settings"');
    });

    test("a refused save is said above the list, and the page has no toast or intro", () => {
        const html = renderSettingsTimezoneV2Page({
            ...view,
            error: "Choose a time zone from the list.",
        });
        expect(html).toContain('role="alert"');
        expect(html.match(/Choose a time zone from the list\./g)).toHaveLength(
            1,
        );
        expect(html).not.toContain("data-fd-toast");
        expect(html).not.toContain("Your days and times count");
    });

    test("no zone stored: the common zones, none picked", () => {
        const html = renderSettingsTimezoneV2Page({ ...view, timezone: "" });
        expect(tzForm(html)).not.toContain(" checked ");
        expect((tzForm(html).match(/<input type="radio"/g) ?? []).length).toBe(
            COMMON_TIME_ZONES.length,
        );
    });
});
