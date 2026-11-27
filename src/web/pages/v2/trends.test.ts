import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { goalsResolver } from "../../../domain/insights.js";
import type { NutritionGoals } from "../../../db/nutrition.js";
import type { TrendsDay } from "../../../domain/trends-view.js";
import {
    buildPreviewTrendsPageData,
    buildTrendsViews,
    parseTrendsRangeParam,
    renderTrendsV2Page,
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

const chrome = { theme: "light" as const, flags: FIXTURE_APP_CHROME_FLAGS };

function dataFor(
    today: string,
    opts: {
        days?: TrendsDay[];
        weights?: { date: string; weight_g: number }[];
        member?: string;
        range?: 7 | 30 | 90 | 365;
    } = {},
) {
    return buildPreviewTrendsPageData(
        { ...chrome },
        opts.days ?? fixtureDays(today),
        goalsResolver(baseGoals, []),
        opts.weights ?? [{ date: "2026-08-10", weight_g: 75_000 }],
        today,
        "kg",
        { range: opts.range, member: opts.member },
    );
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
        );
        expect(Object.keys(views).sort()).toEqual(["30", "365", "7", "90"]);
        expect(views["7"]!.range).toBe(7);
        expect(views["365"]!.bars.length).toBe(365);
    });
});

describe("parseTrendsRangeParam", () => {
    test("takes the four ranges and falls back to 30", () => {
        expect(parseTrendsRangeParam("7")).toBe(7);
        expect(parseTrendsRangeParam("365")).toBe(365);
        expect(parseTrendsRangeParam("12")).toBe(30);
        expect(parseTrendsRangeParam(undefined)).toBe(30);
    });
});

describe("renderTrendsV2Page", () => {
    test("is the Page header, the range tabs, then four range panels of the design's sections", () => {
        const html = renderTrendsV2Page(dataFor("2026-08-15"));
        expect(html).toContain("fd-trends-page");
        expect(html).toMatch(/<header class="fd-page-header fd-trends-header"/);
        expect(html).toContain(">Trends</h1>");
        expect(html).toContain("Last 30 days");
        for (const range of [7, 30, 90, 365]) {
            expect(html).toContain(`data-fd-trends-panel="${range}"`);
        }
        // Only the shown range is visible.
        expect(html).toMatch(/data-fd-trends-panel="7" hidden/);
        expect(html).not.toMatch(/data-fd-trends-panel="30" hidden/);
        // The sections, each from a phase 1 builder.
        expect(html).toContain("fd-stat-card");
        expect(html).toContain("fd-table-rows");
        expect(html).toContain("fd-section-header");
        expect(html).toContain("Averages");
        expect(html).toContain("Calories by day");
        expect(html).toContain("fd-trends-weight__chart");
        expect(html).toContain("fd-page-layout--two-columns");
        // What the design does not draw is gone.
        for (const gone of [
            "fd-trends-rings",
            "fd-trends-month",
            "fd-trends-legend",
            "Near goal",
            "fd-trends-summary",
            "fd-utab",
            "fd-trends-section__title",
        ]) {
            expect(html).not.toContain(gone);
        }
    });

    test("the summary is four tiles and the averages a table of avg against goal", () => {
        const html = renderTrendsV2Page(dataFor("2026-08-15"));
        const panel = html.slice(
            html.indexOf('data-fd-trends-panel="30"'),
            html.indexOf('data-fd-trends-panel="90"'),
        );
        for (const label of [
            "Avg kcal",
            "Avg protein",
            "Logged days",
            "Streak",
        ]) {
            expect(panel).toContain(`>${label}</span>`);
        }
        expect(panel.match(/fd-stat-card"/g)?.length).toBe(4);
        expect(panel).toContain(">Avg</span>");
        expect(panel).toContain(">Goal</span>");
        for (const row of ["Calories", "Protein", "Carbs", "Fat"]) {
            expect(panel).toContain(`>${row}</span>`);
        }
        // The goal is the day's own: 2,200 kcal and 160 g.
        expect(panel).toContain("2,200");
        expect(panel).toContain("160 g");
    });

    test("range tabs are links to the page with that range; the active one is current; 365 is desktop-only", () => {
        const html = renderTrendsV2Page(
            dataFor("2026-08-15", { member: "sam-id" }),
        );
        const tabs = [
            ...html.matchAll(
                /<a class="([^"]*fd-tab-row__tab[^"]*)" href="([^"]*)"([^>]*)data-fd-trends-range="(\d+)">([^<]*)<\/a>/g,
            ),
        ].map((m) => ({
            cls: m[1]!,
            href: m[2]!,
            attrs: m[3]!,
            range: m[4]!,
            label: m[5]!,
        }));
        expect(tabs.map((t) => t.label)).toEqual([
            "7 days",
            "30 days",
            "90 days",
            "365 days",
        ]);
        expect(tabs.map((t) => t.href)).toEqual([
            "/trends?range=7&amp;member=sam-id",
            "/trends?range=30&amp;member=sam-id",
            "/trends?range=90&amp;member=sam-id",
            "/trends?range=365&amp;member=sam-id",
        ]);
        expect(
            tabs
                .filter((t) => t.attrs.includes('aria-current="page"'))
                .map((t) => t.range),
        ).toEqual(["30"]);
        expect(
            tabs
                .filter((t) => t.cls.includes("fd-trends-tab--desktop"))
                .map((t) => t.range),
        ).toEqual(["365"]);
        // The title row carries no range control: the tabs come after it.
        const header = html.slice(
            html.indexOf("<header"),
            html.indexOf("</header>"),
        );
        expect(header).not.toContain("data-fd-trends-range");
    });

    test("the range the query asks for is the one shown", () => {
        const html = renderTrendsV2Page(dataFor("2026-08-15", { range: 7 }));
        expect(html).toContain("Last 7 days");
        expect(html).toContain('data-fd-trends-active="7"');
        expect(html).not.toMatch(/data-fd-trends-panel="7" hidden/);
        expect(html).toMatch(/data-fd-trends-panel="30" hidden/);
    });

    test("a week's bars are lettered by weekday; a longer range names its two ends", () => {
        const html = renderTrendsV2Page(dataFor("2026-08-15"));
        const week = html.slice(
            html.indexOf('data-fd-trends-panel="7"'),
            html.indexOf('data-fd-trends-panel="30"'),
        );
        expect(week.match(/fd-trends-bar__day/g)?.length).toBe(7);
        expect(week).not.toContain("fd-trends-bars__ends");
        const month = html.slice(
            html.indexOf('data-fd-trends-panel="30"'),
            html.indexOf('data-fd-trends-panel="90"'),
        );
        expect(month).not.toContain("fd-trends-bar__day");
        expect(month).toContain("fd-trends-bars__ends");
        expect(month.match(/<li class="fd-trends-bar /g)?.length).toBe(30);
    });

    test("weight shows the latest figure and its change; with none, it says so", () => {
        const withWeights = renderTrendsV2Page(
            dataFor("2026-08-15", {
                weights: [
                    { date: "2026-08-01", weight_g: 76_000 },
                    { date: "2026-08-10", weight_g: 75_000 },
                ],
            }),
        );
        const panel = withWeights.slice(
            withWeights.indexOf('data-fd-trends-panel="30"'),
            withWeights.indexOf('data-fd-trends-panel="90"'),
        );
        expect(panel).toContain("75.0 kg");
        expect(panel).toContain("↓ 1.0 this month");
        const none = renderTrendsV2Page(dataFor("2026-08-15", { weights: [] }));
        expect(none).toContain("No weigh-ins in this range");
    });

    test("Go to a day is a date picker that opens Today, with the member kept", () => {
        const html = renderTrendsV2Page(
            dataFor("2026-08-15", { member: "sam-id" }),
        );
        const form =
            html.match(/<form class="fd-trends-goto"[\s\S]*?<\/form>/)?.[0] ??
            "";
        expect(form).toContain('method="get" action="/"');
        expect(form).toContain('name="member" value="sam-id"');
        expect(form).toContain(
            'type="date" name="date" max="2026-08-15" value="2026-08-15"',
        );
        expect(form).toContain("data-fd-trends-goto");
        expect(form).toContain("Go to a day");
        expect(form).toContain("Sat 15 Aug");
        // The row is a date field, not a link into another page: no chevron.
        expect(form).not.toContain("fd-item-row__chevron");
        expect(form).not.toContain("fd-icon--chevron-right");
    });

    test("member subject label is shown when set", () => {
        const data = dataFor("2026-08-15");
        data.chrome.subjectLabel = "Sam";
        const html = renderTrendsV2Page(data);
        expect(html).toContain("fd-trends-subject");
        expect(html).toContain("Viewing Sam");
    });

    test("weights without meals still render panels", () => {
        const days = fixtureDays("2026-08-15").map((d) => ({
            ...d,
            logged: false,
            calories: 0,
        }));
        const data = dataFor("2026-08-15", { days });
        expect(data.empty).toBe(false);
        const html = renderTrendsV2Page(data);
        expect(html).toContain('data-fd-trends-panel="30"');
        expect(html).not.toContain("Log meals to see trends here.");
    });

    test("an empty user sees the empty state and no panels", () => {
        const days = fixtureDays("2026-08-15").map((d) => ({
            ...d,
            logged: false,
            calories: 0,
        }));
        const data = dataFor("2026-08-15", { days, weights: [] });
        expect(data.empty).toBe(true);
        const html = renderTrendsV2Page(data);
        expect(html).toContain("Log meals to see trends here.");
        expect(html).not.toContain("data-fd-trends-panel");
    });
});

test("Calories by day bars are drawn in the accent, with no off-goal colour", () => {
    const css = readFileSync("./public/app/v2/trends.css", "utf8");
    expect(css).toContain("background: var(--accent-fill)");
    expect(css).not.toContain("--status-warn");
    expect(css).not.toContain("bar--off");
});

test("Calories by day can be scrolled from the keyboard", () => {
    const html = renderTrendsV2Page(dataFor("2026-08-15", { range: 90 }));
    expect(html).toMatch(
        /<ul class="fd-trends-bars" tabindex="0" aria-label="[^"]+"/,
    );
});
