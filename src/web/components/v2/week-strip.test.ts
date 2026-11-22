import { describe, expect, test } from "bun:test";
import { weekDay, weekStrip } from "./week-strip.js";
import { XSS, XSS_ESCAPED } from "./test-helpers.js";

describe("weekDay (FigCraft 381765)", () => {
    test("default: a weekday letter, the date and an empty dot", () => {
        expect(
            String(
                weekDay({ weekday: "S", day: 1, label: "Sunday 1 November" }),
            ),
        ).toBe(
            '<button type="button" class="fd-week-day" aria-pressed="false" aria-label="Sunday 1 November"><span class="fd-week-day__weekday" aria-hidden="true">S</span><span class="fd-week-day__num" aria-hidden="true">1</span><span class="fd-week-day__dot" aria-hidden="true"></span></button>',
        );
    });

    test("selected fills the date", () => {
        const html = String(
            weekDay({ weekday: "S", day: 7, label: "x", selected: true }),
        );
        expect(html).toContain("fd-week-day fd-week-day--selected");
        expect(html).toContain('aria-pressed="true"');
    });

    test("marked shows the dot and says so", () => {
        const html = String(
            weekDay({
                weekday: "M",
                day: 2,
                label: "Monday 2 November",
                marked: true,
            }),
        );
        expect(html).toContain("fd-week-day__dot fd-week-day__dot--on");
        expect(html).toContain('aria-label="Monday 2 November, logged"');
    });

    test("a link with a href, the current day marked as the date", () => {
        const html = String(
            weekDay({
                weekday: "T",
                day: 3,
                label: "Tuesday 3 November",
                href: "/?d=3",
                selected: true,
            }),
        );
        expect(
            html.startsWith(
                '<a class="fd-week-day fd-week-day--selected" href="/?d=3" aria-current="date"',
            ),
        ).toBe(true);
        expect(
            String(weekDay({ weekday: "T", day: 3, label: "x", href: "/a" })),
        ).not.toContain("aria-current");
    });

    test("escapes the text and refuses an unsafe href", () => {
        const html = String(
            weekDay({ weekday: XSS, day: XSS, label: XSS, className: XSS }),
        );
        expect(html).not.toContain("<script>");
        expect(html.split(XSS_ESCAPED).length - 1).toBe(4);
        expect(() =>
            weekDay({
                weekday: "S",
                day: 1,
                label: "x",
                href: "javascript:alert(1)",
            }),
        ).toThrow();
    });
});

describe("weekStrip (FigCraft 381771)", () => {
    const days = Array.from({ length: 7 }, (_, i) => ({
        weekday: "SMTWTFS"[i]!,
        day: i + 1,
        label: `Day ${i + 1}`,
        selected: i === 6,
        marked: i < 6,
    }));

    test("previous, seven days, next, in a named nav", () => {
        const html = String(
            weekStrip({
                label: "Week",
                days,
                previous: { label: "Previous week", href: "/?w=-1" },
                next: { label: "Next week", href: "/?w=1" },
            }),
        );
        expect(
            html.startsWith('<nav class="fd-week-strip" aria-label="Week">'),
        ).toBe(true);
        expect(html).toContain('aria-label="Previous week"');
        expect(html).toContain("fd-icon--chevron-left");
        expect(html).toContain("fd-icon--chevron-right");
        expect(html.match(/class="fd-week-day[ "]/g)?.length).toBe(7);
        expect(html.indexOf("Previous week")).toBeLessThan(
            html.indexOf("Day 1"),
        );
        expect(html.indexOf("Day 7")).toBeLessThan(html.indexOf("Next week"));
    });

    test("an end with no href is a disabled button, not removed", () => {
        const html = String(
            weekStrip({
                label: "Week",
                days,
                previous: { label: "Previous week" },
                next: { label: "Next week" },
            }),
        );
        expect(
            html.match(
                /<button type="button" class="fd-btn fd-btn--sm fd-btn--icon"/g,
            )?.length,
        ).toBe(2);
        expect(html.match(/ disabled/g)?.length).toBe(2);
    });

    test("without previous and next only the days show", () => {
        const html = String(weekStrip({ label: "Week", days }));
        expect(html).not.toContain("fd-icon--chevron");
    });

    test("escapes the name", () => {
        expect(String(weekStrip({ label: XSS, days: [] }))).toContain(
            XSS_ESCAPED,
        );
    });
});

describe("week day button style", () => {
    test("sets its own radius so the app's button rule cannot make the focus ring a pill", async () => {
        const css = await Bun.file("public/app/v2/week-strip.css").text();
        const rule = css.match(/\.fd-week-day \{[^}]*\}/)?.[0] ?? "";
        expect(rule).toContain("border-radius: var(--radius-sm)");
    });
});

describe("weekDay with a day that is not a number", () => {
    test("refuses NaN and infinity rather than drawing them", () => {
        const base = { weekday: "S", label: "Sunday" };
        expect(() => weekDay({ ...base, day: Number.NaN })).toThrow();
        expect(() => weekDay({ ...base, day: Infinity })).toThrow();
        expect(String(weekDay({ ...base, day: 0 }))).toContain(">0<");
    });
});
