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
import { noticeHref } from "../../components/notices.js";
import {
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";
import type { Notice } from "../../../domain/notices.js";
import {
    buildPreviewTodayPageData,
    buildPreviewTodayView,
    buildPreviewTodayViewWithRail,
    buildPreviewTodayViewWithSuggestions,
    buildPreviewTodayViewWithYesterdayHint,
    parseTodayDateParam,
    renderTodayBody,
    renderTodayV2Page,
    todayHref,
} from "./today.js";
import { buildWeekPlanView } from "./recipes-plan.js";
import {
    formatExpiryWhen,
    renderTodayRail,
    weightChange30d,
} from "./today-rail.js";

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

describe("Today header goal name", () => {
    const today = "2026-11-10";
    const base = buildPreviewTodayPageData(
        {
            theme: "light",
            flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
            attention: { count: 0, tabs: {} },
        },
        today,
    );
    function withGoals(
        goal_name: string | null,
        goals_set_on: string | null,
    ): typeof base {
        return {
            ...base,
            view: {
                ...base.view,
                goals: { ...base.view.goals!, goal_name, goals_set_on },
            },
        };
    }
    function header(html: string): string {
        return html.match(
            /<header class="fd-today-header">[\s\S]*?<\/header>/,
        )![0];
    }

    test("the name sits in the subtitle between the date and the streak", () => {
        const html = renderTodayV2Page(withGoals("Recomp", "2026-10-02"));
        expect(header(html)).toContain(
            '<p class="fd-today-subtitle">10 November · Recomp · 4-day streak</p>',
        );
        // One h1 (the day) and one subtitle, on every width: no second desktop line.
        expect(header(html)).toContain(
            '<h1 class="fd-today-title">Tuesday</h1>',
        );
        expect(header(html)).not.toContain("fd-today-title-desk");
        // "Since" belongs to Settings › Goals only, and there is no extra line.
        expect(header(html)).not.toContain("Since");
        expect(header(html)).not.toContain("fd-today-goal");
    });

    test("no name leaves the subtitle as it was", () => {
        for (const name of [null, "", "  "]) {
            const html = renderTodayV2Page(withGoals(name, "2026-10-02"));
            expect(header(html)).toContain(
                '<p class="fd-today-subtitle">10 November · 4-day streak</p>',
            );
            expect(header(html)).not.toContain("Since");
        }
    });

    test("no goals at all adds nothing either", () => {
        const html = renderTodayV2Page({
            ...base,
            view: { ...base.view, goals: null },
        });
        expect(header(html)).toContain(
            '<p class="fd-today-subtitle">10 November · 4-day streak</p>',
        );
    });

    test("escapes the name", () => {
        const html = renderTodayV2Page(withGoals("<i>Cut</i>", null));
        expect(header(html)).toContain("&lt;i&gt;Cut&lt;/i&gt;");
        expect(header(html)).not.toContain("<i>");
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

    test("a meal id or description made of $-patterns stays inert", async () => {
        for (const payload of DOLLAR_PAYLOADS) {
            const view = buildPreviewTodayView(today);
            view.meals = mealRows([
                {
                    id: payload,
                    user_id: "u",
                    logged_at: "2026-11-10T12:00:00.000Z",
                    meal_type: "lunch",
                    description: payload,
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
            expect(await injectedAttributes(html)).toEqual([]);
            expect(
                await attributeValues(
                    html,
                    "li[data-fd-meal-row]",
                    "data-fd-meal-id",
                ),
            ).toEqual([payload]);
        }
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

    test("desktop rail escapes expiring item names", () => {
        const view = buildPreviewTodayViewWithRail("2026-11-10");
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            "2026-11-10",
        );
        const rail = String(renderTodayRail({ ...data, view }));
        expect(rail).not.toContain("<spinach>");
        expect(rail).toContain("&lt;spinach&gt;");
        expect(rail).toContain("Salmon");
        expect(rail).toContain('href="/kitchen/fridge"');
    });

    test("notice action href matches needs-attention routes", () => {
        const notice: Notice = {
            code: "fridge.expiring",
            severity: "info",
            subject: { kind: "fridge_item", id: "fr-eggs" },
            related: [],
            params: {
                name: "Eggs",
                amount: 6,
                unit: "each",
                expiresOn: "2026-11-10",
                daysLeft: 0,
                onGroceryList: "no",
            },
        };
        const href = noticeHref(notice, { from: "/", foods: new Map() });
        const view = buildPreviewTodayView("2026-11-10");
        view.attention = {
            count: 1,
            notices: [notice],
            noticeFoods: new Map(),
        };
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 1, tabs: {} },
            },
            "2026-11-10",
        );
        const rail = String(renderTodayRail({ ...data, view }));
        expect(href).toBe("/kitchen/fridge/items/fr-eggs/add-to-grocery");
        expect(rail).toContain("/kitchen/fridge/items/fr-eggs/add-to-grocery");
    });

    test("weight card uses lb and includes sparkline", () => {
        const view = buildPreviewTodayViewWithRail("2026-11-10");
        view.preferredWeightUnit = "lb";
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            "2026-11-10",
        );
        const rail = String(renderTodayRail({ ...data, view }));
        expect(rail).toContain("fd-today-weight__chart");
        expect(rail).toContain('fd-today-weight__unit">lb</');
        expect(rail).toContain("182.1");
        expect(weightChange30d(view.weight.series30d, "lb")).not.toBeNull();
    });

    test("rail empty states and this week placeholder", () => {
        const view = buildPreviewTodayView("2026-11-10");
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            "2026-11-10",
        );
        const rail = String(renderTodayRail({ ...data, view }));
        expect(rail).toContain("Nothing expiring soon");
        expect(rail).toContain("Nothing needs attention");
        expect(rail).toContain("Nothing planned");
        expect(rail).toContain("No weigh-ins yet");
    });

    test("peer view shows weight only", () => {
        const view = buildPreviewTodayViewWithRail("2026-11-10");
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
                subjectLabel: "Sam",
            },
            "2026-11-10",
        );
        const rail = String(renderTodayRail({ ...data, view }));
        expect(rail).toContain("fd-today-card--weight");
        expect(rail).not.toContain("Use soon");
        expect(rail).not.toContain("Needs attention");
        expect(rail).not.toContain("This week");
    });

    test("meal section titles are title case in markup", () => {
        const html = String(renderTodayBody(data));
        expect(html).toContain('fd-today-section__title">Breakfast</');
        expect(html).not.toContain(">BREAKFAST</");
    });

    test("phone layout keeps fd-today-top and section gap wrapper", () => {
        const body = String(renderTodayBody(data));
        expect(body).toContain("fd-today-top");
        expect(body).toContain("fd-today-main");
        const page = body.indexOf("fd-today-page");
        const main = body.indexOf("fd-today-main");
        const header = body.indexOf("fd-today-header");
        const week = body.indexOf("fd-today-week");
        expect(page).toBeLessThan(main);
        expect(main).toBeLessThan(header);
        expect(header).toBeLessThan(week);
    });

    test("body keeps phone structure with rail wrapper", () => {
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            "2026-11-10",
        );
        const body = String(renderTodayBody(data));
        expect(body).toContain("fd-today-main");
        expect(body).toContain("fd-today-week");
        expect(body).toContain("fd-today-gauge");
        expect(body).toContain("fd-today-rail");
    });

    test("formatExpiryWhen labels tomorrow", () => {
        expect(formatExpiryWhen("2026-11-10", "2026-11-11")).toBe("Tomorrow");
    });

    test("empty day still renders meal sections and remaining calories", () => {
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
        expect(html).not.toContain("fd-today-empty");
        expect(html).toContain('id="fd-today-breakfast"');
        expect(html).toContain('id="fd-today-lunch"');
        expect(html).toContain('id="fd-today-dinner"');
        expect(html).toContain('id="fd-today-snack"');
        expect(html).toContain("Nothing yet");
        const hero = html.match(/fd-today-gauge__hero">([^<]+)</)?.[1];
        expect(hero).not.toBe("—");
        expect(html).toContain('fd-today-macro__actual">0</');
    });

    test("meal row swipe exposes Again", () => {
        const html = String(renderTodayBody(data));
        expect(html).toMatch(/data-swipe-right="\/meals\/[^"]+\/again\tAgain"/);
        expect(html).toContain("fd-swipe-btn--accent");
    });

    test("empty slot shows copy-yesterday when hinted", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const html = String(
            renderTodayBody({
                ...data,
                view: hinted,
            }),
        );
        expect(html).toContain("fd-today-yesterday");
        expect(html).toContain("/log/copy-yesterday");
        expect(html).toContain('name="slot" value="dinner"');
        expect(html).toContain("Same as yesterday?");
        expect(html).toContain("Eggs &amp; toast");
        expect(html).toContain("· 432");
    });

    test("copy-yesterday hint replaces Nothing yet in the slot row", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const html = String(renderTodayBody({ ...data, view: hinted }));
        const row = html.match(
            /<div class="fd-today-section__empty-row"><form class="fd-today-yesterday"[\s\S]*?<\/form><a class="fd-icon-btn fd-today-section__add"/,
        );
        expect(row).not.toBeNull();
        expect(row![0]).not.toContain("Nothing yet");
    });

    test("copy-yesterday hint is hidden in a read-only peer view", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const peer = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
                subjectLabel: "Sam",
            },
            today,
        );
        const html = String(renderTodayBody({ ...peer, view: hinted }));
        expect(html).not.toContain("fd-today-yesterday");
        expect(html).not.toContain("/log/copy-yesterday");
    });

    test("the log sheet gets the Copy yesterday tile on the member's own today", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const html = renderTodayV2Page({ ...data, view: hinted });
        const form = html.match(
            /<form[^>]*data-fd-copy-yesterday[^>]*>[\s\S]*?<\/form>/,
        );
        expect(form).not.toBeNull();
        // The slots are exactly the ones the Today prompt offers.
        expect(form![0]).toContain('data-fd-copy-yesterday-slots="dinner"');
        // Back to the same page the Today prompt returns to.
        expect(form![0]).toContain(
            `name="return_to" value="${todayHref({ date: hinted.date })}"`,
        );
    });

    test("the log sheet has no tile in a peer's view or on a past day", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const peer = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
                subjectLabel: "Sam",
            },
            today,
        );
        expect(renderTodayV2Page({ ...peer, view: hinted })).not.toContain(
            "data-fd-copy-yesterday",
        );
        const past = {
            ...hinted,
            week: {
                ...hinted.week,
                days: hinted.week.days.map((day) => ({
                    ...day,
                    isSelected: !day.isToday && day.isSelected,
                })),
            },
        };
        expect(renderTodayV2Page({ ...data, view: past })).not.toContain(
            "data-fd-copy-yesterday",
        );
    });

    test("copy-yesterday hint hidden when slot has rows", () => {
        const html = String(renderTodayBody(data));
        expect(html).not.toContain("fd-today-yesterday");
    });
});

describe("empty slot suggestions", () => {
    const today = "2026-11-10";
    const data = buildPreviewTodayPageData(
        {
            theme: "light",
            flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
            attention: { count: 0, tabs: {} },
        },
        today,
    );

    test("an empty slot shows the recipe that fits, linked to it", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain(
            '<a class="fd-today-suggest" href="/recipes/r-salmon-rice">Salmon &amp; rice fits · uses 2 things expiring</a>',
        );
        // It replaces "Nothing yet" in the dinner row.
        const dinner = html.slice(
            html.indexOf('id="fd-today-dinner"'),
            html.indexOf('id="fd-today-snack"'),
        );
        expect(dinner).not.toContain("Nothing yet");
    });

    test("it follows the copy-yesterday hint in the same slot", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        view.slotSuggestions = { breakfast: view.slotSuggestions.dinner! };
        const html = String(renderTodayBody({ ...data, view }));
        const breakfast = html.slice(
            html.indexOf('id="fd-today-breakfast"'),
            html.indexOf('id="fd-today-lunch"'),
        );
        const yesterday = breakfast.indexOf("fd-today-yesterday");
        const suggest = breakfast.indexOf("fd-today-suggest");
        expect(yesterday).toBeGreaterThan(-1);
        expect(suggest).toBeGreaterThan(yesterday);
    });

    test("at most two lines, one per suggestion", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const [first] = view.slotSuggestions.dinner!;
        view.slotSuggestions = {
            dinner: [
                first!,
                {
                    ...first!,
                    recipeId: "r2",
                    name: "Rice bowl",
                    usesExpiring: [],
                },
            ],
        };
        const html = String(renderTodayBody({ ...data, view }));
        expect(html.match(/class="fd-today-suggest"/g)).toHaveLength(2);
        expect(html).toContain("Rice bowl fits</a>");
        expect(html).toContain("Salmon &amp; rice fits · uses 2 things");
    });

    test("one expiring item reads in the singular", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const [first] = view.slotSuggestions.dinner!;
        view.slotSuggestions = {
            dinner: [
                { ...first!, usesExpiring: first!.usesExpiring.slice(0, 1) },
            ],
        };
        expect(String(renderTodayBody({ ...data, view }))).toContain(
            "uses 1 thing expiring",
        );
    });

    test("a slot with nothing that fits shows only Nothing yet", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        view.slotSuggestions = {};
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).not.toContain("fd-today-suggest");
        expect(html).toContain("Nothing yet");
    });

    test("a slot with meals never shows one", () => {
        const view = buildPreviewTodayView(today);
        // Breakfast has meals in the base fixture.
        view.slotSuggestions = {
            breakfast:
                buildPreviewTodayViewWithSuggestions(today).slotSuggestions
                    .dinner!,
        };
        expect(String(renderTodayBody({ ...data, view }))).not.toContain(
            "fd-today-suggest",
        );
    });

    test("a peer's day shows none", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const peer = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
                subjectLabel: "Sam",
            },
            today,
        );
        expect(String(renderTodayBody({ ...peer, view }))).not.toContain(
            "fd-today-suggest",
        );
    });
});

describe("Use soon recipe lines", () => {
    const today = "2026-11-10";
    const chrome = {
        theme: "light" as const,
        flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
        attention: { count: 0, tabs: {} },
    };

    test("each expiring item with a recipe shows Use in", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, today),
                view,
            }),
        );
        expect(rail.match(/<a class="fd-today-rail-row__use"/g)).toHaveLength(
            2,
        );
        expect(rail).toContain(
            '<a class="fd-today-rail-row__use" href="/recipes/r-salmon-rice">Use in: Salmon &amp; rice</a>',
        );
    });

    test("an item no recipe uses has no line", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        view.useSoonUses = view.useSoonUses.map((use, i) =>
            i === 0 ? { ...use, recipes: [] } : use,
        );
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, today),
                view,
            }),
        );
        expect(rail.match(/<a class="fd-today-rail-row__use"/g)).toHaveLength(
            1,
        );
    });

    test("no recipes at all leaves the rail as it was", () => {
        const view = buildPreviewTodayViewWithRail(today);
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, today),
                view,
            }),
        );
        expect(rail).not.toContain("Use in:");
        expect(rail).not.toContain("fd-today-useall");
    });

    test("the card for a recipe using several items links to its cook step", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const rail = String(
            renderTodayRail({
                ...buildPreviewTodayPageData(chrome, today),
                view,
            }),
        );
        expect(rail).toContain("Uses both");
        expect(rail).toContain("25 min · 640 kcal per serving");
        expect(rail).toContain(
            'href="/recipes/r-salmon-rice#fd-recipe-cook-heading">Cook it</a>',
        );
        expect(rail).not.toContain("Plan");
    });
});

describe("today edit sheet Again", () => {
    test("edit sheet posts Again beside save and delete", () => {
        const today = "2026-11-10";
        const data = buildPreviewTodayPageData(
            {
                theme: "light",
                flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
                attention: { count: 0, tabs: {} },
            },
            today,
        );
        data.openEditMealId = "m3";
        const html = renderTodayV2Page(data);
        expect(html).toContain('action="/meals/m3/again"');
        expect(html).toContain("fd-btn--accent");
        expect(html).toMatch(/Again<\/span><\/button>/);
    });
});

describe("This week on Today", () => {
    const today = "2026-11-10";
    const chrome = {
        theme: "light" as const,
        flags: { ...FIXTURE_APP_CHROME_FLAGS, uiV2: true },
        attention: { count: 0, tabs: {} },
    };
    const week = buildWeekPlanView({
        today,
        plans: [
            {
                id: "p1",
                householdId: "hh",
                recipeId: "r1",
                date: "2026-11-11",
                slot: "dinner",
                servings: 2,
                createdBy: null,
                createdAt: "2026-11-09T10:00:00+00:00",
            },
        ],
        recipes: [
            {
                id: "r1",
                name: "Beef chili",
                yieldPortions: 2,
                ingredients: [
                    {
                        displayName: "Kidney beans",
                        foodId: "f1",
                        quantity: { amount: 400, unit: "g" },
                    },
                ],
            },
        ],
        stock: [],
        foodsById: new Map(),
    });

    test("the rail card and the phone section list the seven days with the plan", () => {
        const data = {
            ...buildPreviewTodayPageData(chrome, today),
            plan: week,
        };
        const body = String(renderTodayBody(data));
        const rail = String(renderTodayRail(data));
        for (const html of [body, rail]) {
            expect(html).toContain("Beef chili");
            expect(html).toContain("Nothing planned");
            expect(html).toContain("1 ingredient missing");
        }
        // Once on the phone, once in the rail.
        expect(body.match(/<li class="fd-plan-day/g)).toHaveLength(14);
        expect(body).toContain('class="fd-today-section fd-plan-phone"');
        // The sheets its buttons and links open are on the page once.
        expect(body.match(/id="fd-plan-edit-p1"/g)).toHaveLength(1);
        expect(body.match(/id="fd-plan-missing-sheet"/g)).toHaveLength(1);
        expect(body).toContain('name="back" value="today"');
    });

    test("an empty week says nothing is planned", () => {
        const empty = buildWeekPlanView({
            today,
            plans: [],
            recipes: [],
            stock: [],
            foodsById: new Map(),
        });
        const data = {
            ...buildPreviewTodayPageData(chrome, today),
            plan: empty,
        };
        const body = String(renderTodayBody(data));
        expect(body.match(/Nothing planned/g)!.length).toBeGreaterThanOrEqual(
            14,
        );
        expect(body).not.toContain("fd-plan-missing-sheet");
        expect(body).not.toContain("fd-plan-edit-");
    });

    test("a peer's read-only day has no plan", () => {
        const data = {
            ...buildPreviewTodayPageData(
                { ...chrome, subjectLabel: "Sam" },
                today,
            ),
            plan: week,
        };
        const body = String(renderTodayBody(data));
        expect(body).not.toContain("fd-plan-");
        expect(body).not.toContain("This week");
    });
});
