import { expect, test } from "bun:test";
import {
    dayInZone,
    dayMonthLabel,
    monthDayLabel,
} from "./settings-household-dates.js";

const NOW = new Date("2026-11-10T12:00:00Z");

test("a day is counted in the household's zone, not UTC", () => {
    // 02:30 UTC on Dec 3 is still Dec 2 in Los Angeles.
    const at = "2026-12-03T02:30:00Z";
    expect(monthDayLabel(at, NOW, "UTC")).toBe("Dec 3");
    expect(monthDayLabel(at, NOW, "America/Los_Angeles")).toBe("Dec 2");
    // 23:30 UTC on Dec 2 is already Dec 3 in Tokyo.
    expect(monthDayLabel("2026-12-02T23:30:00Z", NOW, "Asia/Tokyo")).toBe(
        "Dec 3",
    );
    expect(dayMonthLabel(at, NOW, "America/Los_Angeles")).toBe("2 Dec");
});

test("the year shows only when it is not this one, in that zone", () => {
    expect(monthDayLabel("2027-01-05T12:00:00Z", NOW, "UTC")).toBe(
        "Jan 5, 2027",
    );
    expect(dayMonthLabel("2027-01-05T12:00:00Z", NOW, "UTC")).toBe(
        "5 Jan 2027",
    );
    // New Year's Eve in Los Angeles is already next year in UTC.
    expect(
        monthDayLabel(
            "2027-01-01T03:00:00Z",
            new Date("2026-12-20T12:00:00Z"),
            "America/Los_Angeles",
        ),
    ).toBe("Dec 31");
});

test("an unknown zone or a bad date falls back rather than throwing", () => {
    expect(monthDayLabel("2026-12-03T12:00:00Z", NOW, "Not/AZone")).toBe(
        "Dec 3",
    );
    expect(dayInZone("nope", "UTC")).toBeNull();
    expect(monthDayLabel("nope", NOW, "UTC")).toBe("nope");
});
