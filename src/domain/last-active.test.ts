import { describe, expect, test } from "bun:test";
import { lastActiveLabel } from "./last-active.js";

const NOW = new Date("2026-11-12T15:00:00.000Z");

describe("lastActiveLabel", () => {
    test("never active reads Not yet", () => {
        expect(lastActiveLabel(null, NOW, "UTC")).toBe("Not yet");
    });

    test("earlier the same local day is Today", () => {
        expect(
            lastActiveLabel(new Date("2026-11-12T00:05:00Z"), NOW, "UTC"),
        ).toBe("Today");
    });

    test("the previous local day is Yesterday, even a few minutes before midnight", () => {
        expect(
            lastActiveLabel(new Date("2026-11-11T23:59:00Z"), NOW, "UTC"),
        ).toBe("Yesterday");
    });

    test("two to six days back counts the days", () => {
        expect(
            lastActiveLabel(new Date("2026-11-09T12:00:00Z"), NOW, "UTC"),
        ).toBe("3 days ago");
        expect(
            lastActiveLabel(new Date("2026-11-06T12:00:00Z"), NOW, "UTC"),
        ).toBe("6 days ago");
    });

    test("a week or more back is a date, with the year only when it differs", () => {
        expect(
            lastActiveLabel(new Date("2026-11-05T12:00:00Z"), NOW, "UTC"),
        ).toBe("Nov 5");
        expect(
            lastActiveLabel(new Date("2025-12-30T12:00:00Z"), NOW, "UTC"),
        ).toBe("Dec 30, 2025");
    });

    test("days are the household's local days, not UTC days", () => {
        // 23:30 UTC on the 11th is already the 12th in Auckland (UTC+13).
        const at = new Date("2026-11-11T23:30:00Z");
        const now = new Date("2026-11-12T05:00:00Z");
        expect(lastActiveLabel(at, now, "UTC")).toBe("Yesterday");
        expect(lastActiveLabel(at, now, "Pacific/Auckland")).toBe("Today");
    });

    test("a time slightly ahead of now (clock skew) still reads Today", () => {
        expect(
            lastActiveLabel(new Date("2026-11-12T15:00:30Z"), NOW, "UTC"),
        ).toBe("Today");
    });
});
