import { describe, expect, test } from "bun:test";
import { expiryToneClass, formatExpiryWhen } from "./expiry-format.js";

describe("formatExpiryWhen", () => {
    const today = "2026-11-10";

    test("says Expired for a day gone by", () => {
        expect(formatExpiryWhen(today, "2026-11-09")).toBe("Expired");
    });

    test("says Today and Tomorrow for the next two days", () => {
        expect(formatExpiryWhen(today, "2026-11-10")).toBe("Today");
        expect(formatExpiryWhen(today, "2026-11-11")).toBe("Tomorrow");
    });

    test("counts days up to a week, then shows the date", () => {
        expect(formatExpiryWhen(today, "2026-11-12")).toBe("2 days");
        expect(formatExpiryWhen(today, "2026-11-17")).toBe("7 days");
        expect(formatExpiryWhen(today, "2026-11-18")).toBe("2026-11-18");
    });
});

describe("expiryToneClass", () => {
    test("expired and high share the high tone", () => {
        expect(expiryToneClass("expired")).toBe("fd-expiry--high");
        expect(expiryToneClass("high")).toBe("fd-expiry--high");
    });

    test("medium and low have their own", () => {
        expect(expiryToneClass("medium")).toBe("fd-expiry--medium");
        expect(expiryToneClass("low")).toBe("fd-expiry--low");
    });
});
