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
    attributeValues,
    DOLLAR_PAYLOADS,
    injectedAttributes,
} from "../../components/v2/test-helpers.js";
import type { Notice } from "../../../domain/notices.js";
import {
    buildPreviewTodayPageData,
    buildPreviewTodayView,
    buildPreviewTodayViewWithSuggestions,
    buildPreviewTodayViewWithYesterdayHint,
    parseTodayDateParam,
    renderTodayBody,
    renderTodayV2Page,
    todayHref,
} from "./today.js";
import { buildWeekPlanView } from "./recipes-plan.js";

describe("parseTodayDateParam", () => {
    test("a year outside 1970-2999 falls back to today", () => {
        // 9999-12-31's next day is in year 10000, which broke the day maths.
        expect(parseTodayDateParam("9999-12-31", "2026-11-10")).toBe(
            "2026-11-10",
        );
        expect(parseTodayDateParam("0100-01-01", "2026-11-10")).toBe(
            "2026-11-10",
        );
        expect(parseTodayDateParam("2026-03-01", "2026-11-10")).toBe(
            "2026-03-01",
        );
    });

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

const chrome = {
    theme: "light" as const,
    flags: FIXTURE_APP_CHROME_FLAGS,
};
const today = "2026-11-10";
const peerChrome = { ...chrome, subjectLabel: "Sam" };

describe("Today header goal name", () => {
    const base = buildPreviewTodayPageData(chrome, today);
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
            /<header class="fd-page-header fd-today-header">[\s\S]*?<\/header>/,
        )![0];
    }

    test("the name sits in the subtitle between the date and the streak", () => {
        const html = renderTodayV2Page(withGoals("Recomp", "2026-10-02"));
        expect(header(html)).toContain(
            '<p class="fd-page-header__subtitle">10 November · Recomp · 4-day streak</p>',
        );
        // One h1 (the day) and one subtitle, on every width.
        expect(header(html)).toContain(
            '<h1 class="fd-page-header__title">Tuesday</h1>',
        );
        // "Since" belongs to Settings › Goals only, and there is no extra line.
        expect(header(html)).not.toContain("Since");
    });

    test("no name leaves the subtitle as it was", () => {
        for (const name of [null, "", "  "]) {
            const html = renderTodayV2Page(withGoals(name, "2026-10-02"));
            expect(header(html)).toContain(
                '<p class="fd-page-header__subtitle">10 November · 4-day streak</p>',
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
            '<p class="fd-page-header__subtitle">10 November · 4-day streak</p>',
        );
    });

    test("escapes the name", () => {
        const html = renderTodayV2Page(withGoals("<i>Cut</i>", null));
        expect(header(html)).toContain("&lt;i&gt;Cut&lt;/i&gt;");
        expect(header(html)).not.toContain("<i>");
    });
});

describe("renderTodayV2Page", () => {
    const data = buildPreviewTodayPageData(chrome, today);

    test("is one Two columns Page layout of the shared components", () => {
        const html = renderTodayV2Page(data);
        expect(html).toContain(
            'class="fd-page-layout fd-page-layout--two-columns fd-today-page"',
        );
        expect(html).toContain("fd-page-header");
        expect(html).toContain("fd-week-strip");
        expect(html).toContain("fd-calorie-gauge");
        expect(html).toContain("fd-macro-bar");
        expect(html).toContain("fd-nutrient-line");
        expect(html).toContain("fd-section-header");
        expect(html).toContain("fd-list-group");
        expect(html).toContain("fd-item-row");
        // The day is the left column, the meals the right.
        const left = html.indexOf("fd-today-day");
        const right = html.indexOf("fd-today-meals");
        expect(left).toBeGreaterThan(-1);
        expect(right).toBeGreaterThan(left);
        // The phone's bell and the account chip come from the shell.
        expect(html).toContain("fd-account-chip");
        expect(html).toContain("fd-bell");
        // The old rail and its cards are gone.
        for (const gone of [
            "fd-today-rail",
            "fd-today-card",
            "fd-today-main",
            "fd-today-gauge",
            "fd-today-also",
            "fd-today-week__",
        ]) {
            expect(html).not.toContain(gone);
        }
    });

    test("brings back nothing the bell replaced", () => {
        const withNotices = {
            ...data,
            view: {
                ...data.view,
                notices: [
                    {
                        code: "nutrition.weigh_in_due",
                        severity: "info",
                        subject: { kind: "member", id: "m1" },
                        related: [{ kind: "member", id: "m1", name: "Alex" }],
                        params: { name: "Alex", days: 9, dismissScope: "" },
                    },
                    {
                        code: "grocery.running_low",
                        severity: "info",
                        subject: { kind: "food", id: "f-eggs" },
                        related: [],
                        params: {
                            name: "Eggs",
                            reason: "1 left, wants 6",
                            dismissScope: "",
                        },
                    },
                ] as Notice[],
            },
            plan: buildWeekPlanView({
                today,
                plans: [],
                recipes: [],
                stock: [],
                foodsById: new Map(),
            }),
        };
        const body = String(renderTodayBody(withNotices));
        for (const gone of [
            "Needs attention",
            "needs-attention",
            "Weigh in",
            "weigh-in",
            "Weight",
            "Use soon",
            "fd-today-notices",
            "fd-today-agent",
            "notice-dot",
            "fd-toast",
            "Undo",
            "plan-missing",
        ]) {
            expect(body).not.toContain(gone);
        }
        // Success is never announced on this page: no toast region of its own.
        expect(body).not.toContain("toast-region");
    });

    test("a hidden nutrient is left out of the nutrient line", () => {
        const shown = renderTodayV2Page(data);
        for (const label of ["Fiber", "Sugar", "Caffeine"]) {
            expect(shown).toMatch(new RegExp(`${label} \\d`));
        }
        const hidden = renderTodayV2Page({
            ...data,
            view: { ...data.view, hiddenNutrients: ["sugar", "caffeine"] },
        });
        expect(hidden).not.toMatch(/Sugar \d/);
        expect(hidden).not.toMatch(/Caffeine \d/);
        expect(hidden).toMatch(/Fiber \d/);
        // Water is always there, and the line is still a link to Trends.
        expect(hidden).toContain('<a class="fd-nutrient-line"');
        expect(hidden).toContain('href="/trends"');
        expect(hidden).toContain("1.6 / 3 L");
    });

    test("the gauge says what is left, and its spoken line says what was eaten", () => {
        const html = renderTodayV2Page(data);
        expect(html).toContain('fd-calorie-gauge__figure">1,132<');
        expect(html).toContain("kcal left of 2,421");
        expect(html).toContain("Eaten 1,289 of 2,421 kcal");
    });

    test("three macro bars carry the day's figures and goals", () => {
        const body = String(renderTodayBody(data));
        expect(body.match(/class="fd-macro-bar /g)).toHaveLength(3);
        expect(body).toContain("/ 210 g");
        expect(body).toContain("/ 213 g");
        expect(body).toContain("/ 81 g");
    });

    test("the week strip marks the days with something logged and selects one", () => {
        const body = String(renderTodayBody(data));
        const days = [
            ...body.matchAll(/<a class="fd-week-day[^"]*"[^>]*>[\s\S]*?<\/a>/g),
        ].map((m) => m[0]);
        expect(days.length).toBe(7);
        const selected = days.filter((d) => d.includes('aria-current="date"'));
        expect(selected).toHaveLength(1);
        expect(selected[0]).toContain("fd-week-day--selected");
        // The fixture logs six of the seven days.
        expect(
            days.filter((d) => d.includes("fd-week-day__dot--on")),
        ).toHaveLength(6);
        expect(days.filter((d) => d.includes(", logged"))).toHaveLength(6);
        // The swipe script finds the strip and its neighbouring weeks.
        expect(body).toContain("data-fd-week-strip");
        expect(body).toContain('data-fd-week-prev="/?date=2026-11-01"');
        expect(body).toContain('data-fd-week-next="/?date=2026-11-15"');
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
        const html = String(renderTodayBody({ ...data, view }));
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
                    "li[data-fd-sheet-row]",
                    "data-fd-meal-id",
                ),
            ).toEqual([payload]);
        }
    });

    test("a multi-item meal lists its items under the title", () => {
        const html = String(renderTodayBody(data));
        expect(html).toContain("Chicken breast");
        expect(html).toContain("data-fd-meal-id=");
        expect(html).toContain("fd-item-row__subtitle");
    });

    test("selected calendar date uses UTC weekday title regardless of member tz", () => {
        const view = buildPreviewTodayView(today);
        view.date = "2026-11-09";
        view.timezone = "Pacific/Auckland";
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain('fd-page-header__title">Monday</');
        expect(html).not.toContain('fd-page-header__title">Tuesday<');
    });

    test("the gauge shows an em dash when calories are unknown", () => {
        const view = buildPreviewTodayView(today);
        view.totals = { ...view.totals, calories: null };
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain(
            'fd-calorie-gauge__figure"><span aria-hidden="true">—</',
        );
        expect(html).not.toContain("Eaten");
    });

    test("with no calorie goal and meals logged the gauge still states the day's total", () => {
        const view = buildPreviewTodayView(today);
        view.goals = null;
        const html = String(renderTodayBody({ ...data, view }));
        expect(html).toContain(
            `fd-calorie-gauge__figure">${Math.round(view.totals.calories!).toLocaleString("en-US")}<`,
        );
        expect(html).toContain("kcal eaten · no calorie goal");
        expect(html).toContain('fd-sr">Eaten ');
        expect(html).not.toContain("left of");
    });

    test("meal sections are labelled, with the section's kcal beside the label", () => {
        const html = String(renderTodayBody(data));
        for (const label of ["Breakfast", "Lunch", "Dinner", "Snacks"]) {
            expect(html).toContain(`fd-section-header__label">${label}</`);
            expect(html).toContain(`aria-label="${label}"`);
        }
        expect(html).toContain('fd-section-header__count">437<');
        expect(html).toContain('fd-section-header__count">852<');
        // An empty section has no total.
        const snacks = html.slice(html.indexOf(">Snacks<"));
        expect(snacks).not.toContain("fd-section-header__count");
    });

    test("an empty day still renders every meal section and the calories left", () => {
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
        for (const label of ["Breakfast", "Lunch", "Dinner", "Snacks"]) {
            expect(html).toContain(`aria-label="${label}"`);
        }
        expect(html.match(/>Nothing yet</g)).toHaveLength(4);
        expect(html).toContain('fd-calorie-gauge__figure">2,421<');
        expect(html).not.toContain("fd-week-day__dot--on");
    });

    test("an empty slot offers a plus that opens the log sheet", () => {
        const html = String(renderTodayBody(data));
        expect(html).toContain('aria-label="Log dinner"');
        expect(html).toContain('data-fd-open-sheet="fd-log-search"');
    });

    test("the empty slot's plus is a link to the log, so it works with no script", () => {
        const html = String(renderTodayBody(data));
        expect(html).toMatch(
            /<a class="fd-item-row__trail fd-item-row__add" href="\/#nutrition-log-meal" aria-label="Log dinner" data-fd-open-sheet="fd-log-search" data-fd-log-meal="dinner">/,
        );
    });

    test("each empty slot's plus carries its own meal, for the search's ADD TO", () => {
        const html = String(renderTodayBody(data));
        const plus = (label: string) =>
            html.match(
                new RegExp(
                    `aria-label="${label}"[^>]*data-fd-log-meal="(\\w+)"`,
                ),
            )?.[1];
        expect(plus("Log dinner")).toBe("dinner");
    });
});

describe("a meal row", () => {
    const data = buildPreviewTodayPageData(chrome, today);
    const html = String(renderTodayBody(data));
    const row = (id: string) =>
        html.match(
            new RegExp(`<li data-fd-meal-id="${id}"[^>]*>[\\s\\S]*?</li>`),
        )![0];

    test("opens its edit sheet when pressed", () => {
        expect(row("m3")).toContain("data-fd-sheet-row");
        expect(row("m3")).toContain('data-sheet-id="fd-edit-meal-m3"');
    });

    test("swipes right to Again and left to Delete, on the phone", () => {
        const r = row("m3");
        expect(r).toContain("fd-item-row--swipe");
        expect(r).toMatch(
            /fd-item-row__bed--again[^]*?action="\/meals\/m3\/again"/,
        );
        expect(r).toMatch(
            /fd-item-row__bed--delete[^]*?action="\/meals\/m3\/delete"/,
        );
    });

    test("its ⋯ menu is Again, Edit and Delete (confirmed in place)", () => {
        const r = row("m3");
        expect(r).toContain('data-anchor="more"');
        expect(r).toContain('aria-label="Actions for Chicken bowl"');
        const items = [
            ...r.matchAll(
                /role="menuitem"[^>]*>[\s\S]*?fd-menu__label">([^<]+)</g,
            ),
        ].map((m) => m[1]);
        expect(items.slice(0, 3)).toEqual(["Again", "Edit", "Delete"]);
        expect(r).toContain('commandfor="fd-edit-meal-m3"');
        expect(r).toContain("data-fd-menu-confirm");
        // Again carries its own submit key and the way back.
        expect(r).toMatch(/name="submit_key" value="[0-9a-f-]{36}"/);
        expect(r).toContain('name="return_to" value="/?date=2026-11-10"');
    });

    test("a peer's row is plain: no menu, no swipe, no sheet", () => {
        const peer = buildPreviewTodayPageData(peerChrome, today);
        const body = String(renderTodayBody(peer));
        expect(body).toContain("Chicken breast");
        for (const gone of [
            "fd-menu",
            "fd-item-row--swipe",
            "data-fd-sheet-row",
            "fd-sheet",
            "/meals/",
            "fd-open-sheet",
        ]) {
            expect(body).not.toContain(gone);
        }
        expect(body).toContain("Viewing Sam");
    });
});

describe("copy yesterday", () => {
    const data = buildPreviewTodayPageData(chrome, today);

    test("an empty slot shows a Same as yesterday row when hinted", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const html = String(renderTodayBody({ ...data, view: hinted }));
        expect(html).toContain("fd-today-yesterday");
        expect(html).toContain("Same as yesterday");
        expect(html).toContain("Eggs &amp; toast · 432 kcal");
        expect(html).toContain('action="/log/copy-yesterday"');
        expect(html).toContain('name="slot" value="dinner"');
        expect(html).toContain('aria-label="Copy yesterday\'s dinner"');
    });

    test("the hint replaces Nothing yet in its slot", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const html = String(renderTodayBody({ ...data, view: hinted }));
        const dinner = html.slice(
            html.indexOf('aria-label="Dinner"'),
            html.indexOf('aria-label="Snacks"'),
        );
        expect(dinner).toContain("fd-today-yesterday");
        expect(dinner).not.toContain("Nothing yet");
    });

    test("is hidden in a read-only peer view", () => {
        const hinted = buildPreviewTodayViewWithYesterdayHint(today);
        const peer = buildPreviewTodayPageData(peerChrome, today);
        const html = String(renderTodayBody({ ...peer, view: hinted }));
        expect(html).not.toContain("fd-today-yesterday");
        expect(html).not.toContain("/log/copy-yesterday");
    });

    test("is hidden when the slot has rows", () => {
        expect(String(renderTodayBody(data))).not.toContain(
            "fd-today-yesterday",
        );
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
        const peer = buildPreviewTodayPageData(peerChrome, today);
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
});

describe("empty slot suggestions", () => {
    const data = buildPreviewTodayPageData(chrome, today);
    const dinner = (html: string) =>
        html.slice(
            html.indexOf('aria-label="Dinner"'),
            html.indexOf('aria-label="Snacks"'),
        );

    test("an empty slot shows the recipe that fits, with a plus to it", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        const html = String(renderTodayBody({ ...data, view }));
        expect(dinner(html)).toContain("Salmon &amp; rice fits");
        expect(dinner(html)).toContain("Uses 2 things expiring");
        expect(dinner(html)).toContain('href="/recipes/r-salmon-rice"');
        expect(dinner(html)).toContain('aria-label="Open Salmon &amp; rice"');
        // It replaces "Nothing yet" in the dinner section.
        expect(dinner(html)).not.toContain("Nothing yet");
    });

    test("it follows the copy-yesterday hint in the same slot", () => {
        const view = buildPreviewTodayViewWithSuggestions(today);
        view.slotSuggestions = { breakfast: view.slotSuggestions.dinner! };
        const html = String(renderTodayBody({ ...data, view }));
        const breakfast = html.slice(
            html.indexOf('aria-label="Breakfast"'),
            html.indexOf('aria-label="Lunch"'),
        );
        const yesterday = breakfast.indexOf("fd-today-yesterday");
        const suggest = breakfast.indexOf("fd-today-suggest");
        expect(yesterday).toBeGreaterThan(-1);
        expect(suggest).toBeGreaterThan(yesterday);
    });

    test("one row per suggestion", () => {
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
        expect(html.match(/fd-today-suggest/g)).toHaveLength(2);
        expect(html).toContain("Rice bowl fits");
        expect(html).toContain("Uses 2 things expiring");
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
            "Uses 1 thing expiring",
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
        const peer = buildPreviewTodayPageData(peerChrome, today);
        expect(String(renderTodayBody({ ...peer, view }))).not.toContain(
            "fd-today-suggest",
        );
    });
});

describe("the edit sheet", () => {
    test("posts Again beside Save, with its own submit key", () => {
        const data = buildPreviewTodayPageData(chrome, today);
        data.openEditMealId = "m3";
        const html = renderTodayV2Page(data);
        expect(html).toContain('action="/meals/m3/again"');
        const keys = [
            ...html.matchAll(
                /\/meals\/m3\/again"[^]*?name="submit_key" value="([^"]+)"/g,
            ),
        ].map((m) => m[1]);
        expect(keys.length).toBeGreaterThan(0);
        expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
        expect(html).toMatch(
            /<button[^>]*form="fd-edit-meal-m3-again"[^>]*>[\s\S]*?Again/,
        );
        // Delete is the row's menu and swipe; the sheet has Again and Save.
        expect(html).not.toContain('id="fd-edit-meal-m3-delete"');
        expect(html).toContain("fd-sheet--side");
        expect(html).toContain('form="fd-edit-meal-m3-form"');
    });

    test("Time is the meal's own time and a Pick a time chip over a time field that posts logged_time", () => {
        const data = buildPreviewTodayPageData(chrome, today);
        data.openEditMealId = "m3";
        const html = renderTodayV2Page(data);
        const sheet = html.slice(html.indexOf('id="fd-edit-meal-m3"'));
        const time = sheet.slice(sheet.indexOf("data-fd-edit-time"));
        // Two chips: the time as it reads on a clock, and Pick a time.
        expect(time).toMatch(
            /name="time_mode" value="keep" checked[^]*?fd-chip__label">\d{1,2}:\d\d (AM|PM)</,
        );
        expect(time).toMatch(
            /name="time_mode" value="pick"[^>]*>[^]*?fd-chip__label">Pick a time</,
        );
        // The field is still there and posts what it posted before.
        expect(time).toMatch(
            /<input[^>]*type="time"[^>]*name="logged_time"|<input[^>]*name="logged_time"[^>]*type="time"/,
        );
    });

    test("the subtitle reads the meal and its kcal", () => {
        const data = buildPreviewTodayPageData(chrome, today);
        data.openEditMealId = "m3";
        const html = renderTodayV2Page(data);
        const sheet = html.slice(html.indexOf('id="fd-edit-meal-m3"'));
        expect(sheet).toMatch(
            /fd-sheet__subtitle[^>]*>(Breakfast|Lunch|Dinner|Snacks) · \d+ kcal</,
        );
    });
});

describe("This week on Today", () => {
    const plan = (
        id: string,
        date: string,
        slot: "breakfast" | "lunch" | "dinner" | "snack",
        ruleId?: string,
    ) => ({
        id,
        householdId: "hh",
        recipeId: "r1",
        date,
        slot,
        servings: 2,
        createdBy: null,
        createdAt: "2026-11-09T10:00:00+00:00",
        ...(ruleId ? { ruleId } : {}),
    });
    const weekOf = (plans: ReturnType<typeof plan>[]) =>
        buildWeekPlanView({
            today,
            plans,
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
    const body = (week: ReturnType<typeof weekOf>) =>
        String(
            renderTodayBody({
                ...buildPreviewTodayPageData(chrome, today),
                plan: week,
            }),
        );
    const rows = (html: string) =>
        [
            ...html.matchAll(
                /<li data-fd-sheet-row data-sheet-id="fd-plan-edit-[^"]+"[\s\S]*?<\/li>/g,
            ),
        ].map((m) => m[0]);

    test("lists the planned entries under a This week header with Plan", () => {
        const html = body(weekOf([plan("p1", "2026-11-11", "dinner")]));
        expect(html).toContain('fd-section-header__label">This week<');
        expect(html).toContain(
            `<a class="fd-section-header__action" href="/recipes?plan_date=${today}">Plan</a>`,
        );
        const listed = rows(html);
        expect(listed).toHaveLength(1);
        expect(listed[0]).toContain("Beef chili");
        expect(listed[0]).toContain("Dinner");
        expect(listed[0]).toContain(">Wed<");
        expect(listed[0]).toContain('data-sheet-id="fd-plan-edit-p1"');
        // Only the days with something planned are listed.
        expect(html).not.toContain("fd-plan-day");
        expect(html).toContain("1 ingredient missing");
        // The sheets its rows and link open are on the page once each.
        expect(html.match(/ id="fd-plan-edit-p1"/g)).toHaveLength(1);
        expect(html.match(/ id="fd-plan-missing-sheet"/g)).toHaveLength(1);
        expect(html).toContain('name="back" value="today"');
        expect(html).toContain("Add 1 to groceries");
    });

    test("Plan picks a recipe for the first day with nothing planned", () => {
        const day = (n: number) =>
            new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000)
                .toISOString()
                .slice(0, 10);
        const plan1 = (id: string, date: string) => plan(id, date, "dinner");
        const href = (html: string) =>
            html.match(
                /class="fd-section-header__action" href="([^"]+)">Plan</,
            )?.[1];
        // Today and tomorrow are taken: the day after is offered.
        expect(
            href(body(weekOf([plan1("p1", day(0)), plan1("p2", day(1))]))),
        ).toBe(`/recipes?plan_date=${day(2)}`);
        // Nothing planned: today.
        expect(href(body(weekOf([])))).toBe(`/recipes?plan_date=${today}`);
    });

    test("two entries of one recipe on one day in different meals stay two rows", () => {
        const html = body(
            weekOf([
                plan("p1", "2026-11-11", "lunch"),
                plan("p2", "2026-11-11", "dinner"),
            ]),
        );
        const listed = rows(html);
        expect(listed).toHaveLength(2);
        expect(listed[0]).toContain("Lunch");
        expect(listed[1]).toContain("Dinner");
        expect(html.match(/ id="fd-plan-edit-p[12]"/g)).toHaveLength(2);
    });

    test("a one-off entry's ⋯ is Edit and Remove, with no series item", () => {
        const r = rows(body(weekOf([plan("p1", "2026-11-11", "dinner")])))[0]!;
        expect(r).toContain('data-anchor="more"');
        expect(r).toContain("Actions for Beef chili, Wed 11 Nov");
        expect(r).toContain('commandfor="fd-plan-edit-p1"');
        expect(r).toContain('action="/recipes/plan/p1/remove"');
        expect(r).toContain('fd-menu__label">Remove<');
        expect(r).not.toContain("The whole series");
        expect(r).not.toContain("This day");
        expect(r).not.toContain('name="scope"');
    });

    test("an entry that is a day of a repeat offers This day and The whole series", () => {
        const id = "rule:rl1:2026-11-11";
        const r = rows(
            body(weekOf([plan(id, "2026-11-11", "dinner", "rl1")])),
        )[0]!;
        expect(r).toContain(">Dinner<");
        expect(r).not.toContain("repeats");
        expect(r).toContain(`action="/recipes/plan/${id}/remove"`);
        expect(r).toContain('fd-menu__label">This day<');
        expect(r).toContain('fd-menu__label">The whole series<');
        expect(r).toContain('name="scope" value="day"');
        expect(r).toContain('name="scope" value="series"');
        // Both confirm in place.
        expect(r.match(/data-fd-menu-confirm/g)).toHaveLength(2);
        // No heading dressed as a disabled action.
        expect(r).not.toContain("fd-menu__note");
        expect(r).not.toContain('aria-disabled="true"');
    });

    test("entries are shown as stored: a repeat day and a one-off of the same recipe and day are not merged", () => {
        const html = body(
            weekOf([
                plan("rule:rl1:2026-11-11", "2026-11-11", "lunch", "rl1"),
                plan("p2", "2026-11-11", "dinner"),
            ]),
        );
        const listed = rows(html);
        expect(listed).toHaveLength(2);
        expect(listed[0]).toContain("The whole series");
        expect(listed[1]).not.toContain("The whole series");
    });

    test("an empty week says nothing is planned and has no sheets", () => {
        const html = body(weekOf([]));
        expect(html).toContain("Nothing planned");
        expect(html).toContain('fd-section-header__label">This week<');
        expect(html).not.toContain("fd-plan-missing-sheet");
        expect(html).not.toContain("fd-plan-edit-");
        expect(html).not.toContain("ingredient");
    });

    test("a peer's read-only day has no plan", () => {
        const html = String(
            renderTodayBody({
                ...buildPreviewTodayPageData(peerChrome, today),
                plan: weekOf([plan("p1", "2026-11-11", "dinner")]),
            }),
        );
        expect(html).not.toContain("fd-plan-");
        expect(html).not.toContain("This week");
    });
});
