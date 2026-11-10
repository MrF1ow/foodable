import { describe, expect, test } from "bun:test";
import type { Meal } from "../../../db/nutrition.js";
import { mealRows, todayDayTotals } from "../../../domain/today.js";
import {
    sundayWeekStart,
    weekDates,
    annotateWeekDays,
} from "../../../domain/today.js";
import { shiftLocalDate } from "../../../domain/tz.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../../test-support/chrome-flags.js";
import {
    buildPreviewTodayPageData,
    buildPreviewTodayView,
    parseTodayDateParam,
    renderTodayBody,
    renderTodayV2Page,
    todayHref,
} from "./today.js";

describe("parseTodayDateParam", () => {
    test("invalid date falls back to today", () => {
        expect(parseTodayDateParam("2026-02-30", "2026-11-10")).toBe(
            "2026-11-10",
        );
        expect(parseTodayDateParam("nope", "2026-11-10")).toBe("2026-11-10");
    });

    test("valid date is kept", () => {
        expect(parseTodayDateParam("2026-08-03", "2026-11-10")).toBe(
            "2026-08-03",
        );
    });
});

describe("todayHref", () => {
    test("builds member and date query", () => {
        expect(todayHref({ date: "2026-08-03", member: "u2" })).toBe(
            "/?date=2026-08-03&member=u2",
        );
    });
});

describe("renderTodayV2Page", () => {
    const today = "2026-11-10";
    const data = buildPreviewTodayPageData(
        {
            theme: "light",
            flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
            attention: { count: 0, tabs: {} },
        },
        today,
    );

    test("pins fd- classes and semantic structure", () => {
        const html = renderTodayV2Page(data);
        expect(html).toContain("fd-today-page");
        expect(html).toContain("fd-today-week");
        expect(html).toContain("fd-today-gauge");
        expect(html).toContain("fd-today-macros");
        expect(html).toContain("fd-today-also");
        expect(html).toContain("fd-today-section");
        expect(html).toContain('aria-current="date"');
        expect(html).toContain("fd-account-chip");
    });

    test("gauge's accessible name matches its hero number", () => {
        const html = renderTodayV2Page(data);
        const hero = html.match(/fd-today-gauge__hero">([^<]+)</)?.[1];
        const label = html.match(
            /class="fd-today-gauge" role="img" aria-label="([^"]+)"/,
        )?.[1];
        expect(hero).toBeTruthy();
        expect(label?.startsWith(`${hero} kcal`)).toBe(true);
    });

    test("renders week dot states", () => {
        const body = String(renderTodayBody(data));
        expect(body).toContain('data-fd-dot="hit"');
        expect(body).toContain('data-fd-dot="off"');
        expect(body).toContain('data-fd-dot="empty"');
    });

    test("null macros render as em dash", () => {
        const view = buildPreviewTodayView(today);
        const meal: Meal = {
            id: "x",
            user_id: "u",
            logged_at: "2026-11-10T12:00:00.000Z",
            meal_type: "snack",
            description: "Mystery",
            calories: 100,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: null,
            idempotency_key: null,
            items: [],
        };
        view.meals = mealRows([meal]);
        const html = String(
            renderTodayBody({
                ...data,
                view,
            }),
        );
        expect(html).toContain("—");
        expect(html).not.toMatch(/fd-macro[^>]+>P 0/);
    });

    test("escapes hostile meal text", () => {
        const view = buildPreviewTodayView(today);
        view.meals = mealRows([
            {
                id: "bad",
                user_id: "u",
                logged_at: "2026-11-10T12:00:00.000Z",
                meal_type: "lunch",
                description: '<img src=x onerror="alert(1)">',
                calories: 50,
                protein_g: 1,
                carbs_g: 2,
                fat_g: 3,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
                notes: null,
                idempotency_key: null,
                items: [],
            },
        ]);
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });

    test("multi-item meal shows item list subtitle", () => {
        const html = String(renderTodayBody(data));
        expect(html).toContain("Chicken breast");
        expect(html).toContain("data-fd-meal-id=");
    });

    test("selected calendar date uses UTC weekday title regardless of member tz", () => {
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            "2026-11-10",
        );
        const view = buildPreviewTodayView("2026-11-10");
        view.date = "2026-11-09";
        view.timezone = "Pacific/Auckland";
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain('fd-today-title">Monday</');
        expect(html).not.toContain("Tuesday");
    });

    test("gauge shows em dash when calories are unknown", () => {
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            "2026-11-10",
        );
        const view = buildPreviewTodayView("2026-11-10");
        view.totals = { ...view.totals, calories: null };
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain('fd-today-gauge__hero">—</');
        expect(html).not.toContain("2,421 left");
    });

    test("multi-item meal list uses fd-row__sub not fd-row__meta", () => {
        const html = String(renderTodayBody(data));
        expect(html).toContain("fd-row__sub");
        expect(html).toContain("Chicken breast");
    });

    test("empty day shows log action", () => {
        const weekStart = sundayWeekStart(today);
        const dates = weekDates(weekStart);
        const view = {
            ...buildPreviewTodayView(today),
            meals: [],
            totals: todayDayTotals([], 0),
            week: {
                ...annotateWeekDays(dates, today, today, {
                    prevWeekStart: shiftLocalDate(weekStart, -7),
                    nextWeekStart: shiftLocalDate(weekStart, 7),
                }),
                dots: dates.map((date) => ({ date, state: "empty" as const })),
            },
        };
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain("fd-today-empty");
        expect(html).toContain('data-fd-open-sheet="fd-log-search"');
        expect(html).toContain("Log food");
    });
});
