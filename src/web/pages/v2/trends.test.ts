import { describe, expect, test } from "bun:test";
import { goalsResolver } from "../../../domain/insights.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { TrendsDay } from "../../../domain/trends-view.js";
import {
    buildPreviewTrendsPageData,
    buildTrendsViews,
    canAdvanceTrendsMonth,
    parseTrendsMonthParam,
    renderTrendsV2Page,
    trendsMonthHref,
} from "./trends.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";

const baseGoals: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2200,
    daily_protein_g: 160,
    daily_carbs_g: 220,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 45,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

function day(date: string, logged = true): TrendsDay {
    return {
        date,
        calories: logged ? 2100 : 0,
        protein_g: logged ? 150 : 0,
        carbs_g: logged ? 200 : 0,
        fat_g: logged ? 65 : 0,
        logged,
    };
}

function fixtureDays(today: string): TrendsDay[] {
    const out: TrendsDay[] = [];
    for (let i = 364; i >= 0; i--) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        out.push(day(date, i % 11 !== 0));
    }
    return out;
}

describe("buildTrendsViews", () => {
    test("precomputes all four ranges", () => {
        const today = "2026-08-15";
        const { views } = buildTrendsViews(
            fixtureDays(today),
            goalsResolver(baseGoals, []),
            [{ date: "2026-08-10", weight_g: 75_000 }],
            today,
            "kg",
            { year: 2026, month: 8 },
        );
        expect(Object.keys(views).sort()).toEqual(["30", "365", "7", "90"]);
        expect(views["7"]!.range).toBe(7);
        expect(views["365"]!.bars.length).toBe(365);
    });
});

describe("renderTrendsV2Page", () => {
    test("includes toggle, four range panels, and sections", () => {
        const today = "2026-08-15";
        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            fixtureDays(today),
            goalsResolver(baseGoals, [
                {
                    user_id: "u1",
                    date: "2026-08-01",
                    updated_at: "x",
                    daily_calories: 1800,
                    daily_protein_g: null,
                    daily_carbs_g: null,
                    daily_fat_g: null,
                    daily_fiber_g: null,
                    daily_sugar_g: null,
                    daily_alcohol_g: null,
                    daily_caffeine_mg: null,
                    daily_water_ml: null,
                },
            ]),
            [{ date: "2026-08-10", weight_g: 75_000 }],
            today,
            "kg",
        );
        const html = renderTrendsV2Page(data);
        expect(html).toContain("fd-trends-page");
        expect(html).toContain('data-fd-trends-range="30"');
        // Only the toggle buttons carry data-fd-trends-range: on the page root
        // the client's closest() would swallow every click (month links).
        expect(html).not.toMatch(
            /data-fd-trends-root[^>]*data-fd-trends-range/,
        );
        expect(html).toContain("Near goal");
        expect(html).toContain('data-fd-trends-panel="7"');
        expect(html).toContain('data-fd-trends-panel="30"');
        expect(html).toContain('data-fd-trends-panel="90"');
        expect(html).toContain('data-fd-trends-panel="365"');
        expect(html).not.toContain("fd-trends-data");
        expect(html).toContain("fd-trends-rings");
        expect(html).toContain("fd-trends-weight");
        expect(html).toContain("Logged");
        expect(html).toContain("No log");
        expect(html).toContain("fd-trends-month");
        expect(html).toContain("fd-trends-summary--phone");
        expect(html).toContain("fd-trends-summary--desktop");
        expect(html).toContain("Day streak");
        expect(html).toContain("fd-trends-bars-wrap");
    });

    test("member subject label is shown when set", () => {
        const today = "2026-08-15";
        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            fixtureDays(today),
            goalsResolver(baseGoals, []),
            [],
            today,
            "kg",
        );
        data.chrome.subjectLabel = "Sam";
        data.empty = true;
        const html = renderTrendsV2Page(data);
        expect(html).toContain("fd-trends-subject");
        expect(html).toContain("Sam");
    });

    test("weights without meals still render panels", () => {
        const today = "2026-08-15";
        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            fixtureDays(today).map((d) => ({
                ...d,
                logged: false,
                calories: 0,
            })),
            goalsResolver(baseGoals, []),
            [{ date: "2026-08-10", weight_g: 75_000 }],
            today,
            "kg",
        );
        expect(data.empty).toBe(false);
        const html = renderTrendsV2Page(data);
        expect(html).toContain('data-fd-trends-panel="30"');
        expect(html).not.toContain("fd-trends-empty");
    });

    test("empty user sees empty state", () => {
        const today = "2026-08-15";
        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            fixtureDays(today).map((d) => ({
                ...d,
                logged: false,
                calories: 0,
            })),
            goalsResolver(baseGoals, []),
            [],
            today,
            "kg",
        );
        expect(data.empty).toBe(true);
        const html = renderTrendsV2Page(data);
        expect(html).toContain("fd-trends-empty");
    });

    test("month card grades days and links prev/next with member and range", () => {
        const today = "2026-08-15";
        const days = fixtureDays(today);
        const onTarget = days.find((d) => d.date === "2026-07-10")!;
        onTarget.calories = 2100;
        onTarget.logged = true;
        const loggedOff = days.find((d) => d.date === "2026-07-11")!;
        loggedOff.calories = 2500;
        loggedOff.logged = true;
        const empty = days.find((d) => d.date === "2026-07-12")!;
        empty.logged = false;
        empty.calories = 0;

        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            days,
            goalsResolver(baseGoals, []),
            [],
            today,
            "kg",
            { month: { year: 2026, month: 7 }, range: 30, member: "sam-id" },
        );
        const html = renderTrendsV2Page(data);

        expect(html).toMatch(
            /fd-trends-month__day--on-target[^>]*data-date="2026-07-10"/,
        );
        expect(html).toMatch(
            /fd-trends-month__day--logged[^>]*data-date="2026-07-11"/,
        );
        expect(html).toMatch(
            /fd-trends-month__day--empty[^>]*data-date="2026-07-12"/,
        );
        expect(html).toContain(
            'href="/trends?month=2026-06&amp;range=30&amp;member=sam-id"',
        );
        expect(html).toContain(
            'href="/trends?month=2026-08&amp;range=30&amp;member=sam-id"',
        );
        expect(html).toContain("On target");
        expect(html).toMatch(/fd-trends-month__legend[\s\S]*Logged/);
    });

    test("today is marked in the month card when it is in the displayed month", () => {
        const today = "2026-08-15";
        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            fixtureDays(today),
            goalsResolver(baseGoals, []),
            [],
            today,
            "kg",
            { month: { year: 2026, month: 8 } },
        );
        const html = renderTrendsV2Page(data);
        expect(html).toMatch(
            /fd-trends-month__day--today[^>]*data-date="2026-08-15"/,
        );
    });

    test("no next month link when display month is the current month", () => {
        const today = "2026-08-15";
        const data = buildPreviewTrendsPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            fixtureDays(today),
            goalsResolver(baseGoals, []),
            [],
            today,
            "kg",
            { month: { year: 2026, month: 8 } },
        );
        const html = renderTrendsV2Page(data);
        expect(html).not.toContain('href="/trends?month=2026-09');
        expect(html).toContain('href="/trends?month=2026-07');
    });

    test("a year outside 1970-2999 falls back to the current month", () => {
        expect(parseTrendsMonthParam("0100-01", "2026-08-15")).toEqual({
            year: 2026,
            month: 8,
        });
        expect(parseTrendsMonthParam("2025-03", "2026-08-15")).toEqual({
            year: 2025,
            month: 3,
        });
    });

    test("invalid month query falls back to the current month", () => {
        expect(parseTrendsMonthParam(undefined, "2026-08-15")).toEqual({
            year: 2026,
            month: 8,
        });
        expect(parseTrendsMonthParam("2026-13", "2026-08-15")).toEqual({
            year: 2026,
            month: 8,
        });
        expect(parseTrendsMonthParam("nope", "2026-08-15")).toEqual({
            year: 2026,
            month: 8,
        });
        expect(parseTrendsMonthParam("2026-07", "2026-08-15")).toEqual({
            year: 2026,
            month: 7,
        });
        // A future month falls back to the current one.
        expect(parseTrendsMonthParam("2026-09", "2026-08-15")).toEqual({
            year: 2026,
            month: 8,
        });
        expect(parseTrendsMonthParam("2027-01", "2026-08-15")).toEqual({
            year: 2026,
            month: 8,
        });
    });

    test("canAdvanceTrendsMonth blocks future months", () => {
        expect(
            canAdvanceTrendsMonth({ year: 2026, month: 8 }, "2026-08-15"),
        ).toBe(false);
        expect(
            canAdvanceTrendsMonth({ year: 2026, month: 7 }, "2026-08-15"),
        ).toBe(true);
    });

    test("trendsMonthHref preserves member and range", () => {
        expect(
            trendsMonthHref({
                year: 2026,
                month: 7,
                range: 90,
                member: "x",
            }),
        ).toBe("/trends?month=2026-07&range=90&member=x");
    });
});
