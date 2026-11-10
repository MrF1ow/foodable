import type { NutritionGoals } from "../../../db/nutrition.js";
import type { Meal } from "../../../db/nutrition.js";
import { activeCalorieGoal } from "../../../domain/insights.js";
import {
    type MealRow,
    type MealTypeGroup,
    type MealTypeSlot,
    type WeekDotState,
    annotateWeekDays,
    mealRows,
    sundayWeekStart,
    todayDayTotals,
    weekDates,
    type WeekStripLayout,
} from "../../../domain/today.js";
import {
    BAR_SPECS,
    GAUGE_SPECS,
    MACRO_ORDER,
    barFill,
    calorieGauge,
    type MacroKey,
} from "../../../domain/geometry.js";
import { shiftLocalDate } from "../../../domain/tz.js";
import type { AppChromeBase } from "../../attention.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { dot } from "../../components/v2/dot.js";
import {
    foodRow,
    macroLine,
    rowList,
    type Macros,
} from "../../components/v2/rows.js";
import { iconChevronRight, iconPlus } from "../../components/v2/icons.js";
import { settingsErrorBanner } from "./settings-shared.js";
import {
    FD_LOG_SEARCH_SHEET_ID,
    type RenderLogSheetsOpts,
} from "./log-sheet.js";
import { FD_LOG_HREF } from "../../shell-v2.js";
import type { TodayView } from "../../loaders-today.js";
import { renderAppShell } from "../../shell.js";

export type TodayPageChrome = AppChromeBase & {
    subjectLabel?: string;
};

export type TodayPageData = {
    chrome: TodayPageChrome;
    view: TodayView;
    today: string;
    memberQuery?: string;
    logSheet?: Omit<RenderLogSheetsOpts, "timezone">;
    error?: string;
};

const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"] as const;

const MEAL_TYPE_ORDER = [
    "breakfast",
    "lunch",
    "dinner",
    "snack",
] as const satisfies readonly MealTypeSlot[];

const MEAL_SECTION_LABEL: Record<MealTypeSlot, string> = {
    breakfast: "Breakfast",
    lunch: "Lunch",
    dinner: "Dinner",
    snack: "Snacks",
};

export function parseTodayDateParam(
    raw: string | undefined,
    today: string,
): string {
    const s = raw?.trim();
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return today;
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    if (
        dt.getUTCFullYear() !== y ||
        dt.getUTCMonth() + 1 !== m ||
        dt.getUTCDate() !== d
    ) {
        return today;
    }
    return s;
}

export function todayHref(opts: { date?: string; member?: string }): string {
    const params = new URLSearchParams();
    if (opts.date?.trim()) params.set("date", opts.date.trim());
    if (opts.member?.trim()) {
        params.set("member", opts.member.trim());
    }
    const q = params.toString();
    return q ? `/?${q}` : "/";
}

function fmtKcal(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat("en-US").format(Math.round(value));
}

function fmtWholeGrams(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return String(Math.round(value));
}

function fmtGrams(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return `${fmtWholeGrams(value)} g`;
}

function fmtWholeMg(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return String(Math.round(value));
}

function fmtWater(ml: number, goalMl: number | null): string {
    const liters = ml / 1000;
    const lit =
        Math.abs(liters - Math.round(liters)) < 0.05
            ? String(Math.round(liters))
            : (Math.round(liters * 10) / 10).toFixed(1);
    if (goalMl == null || goalMl <= 0) return `${lit} L`;
    const goalL =
        Math.abs(goalMl / 1000 - Math.round(goalMl / 1000)) < 0.05
            ? String(Math.round(goalMl / 1000))
            : (Math.round((goalMl / 1000) * 10) / 10).toFixed(1);
    return `${lit} / ${goalL} L`;
}

function dayNumber(date: string): string {
    return String(Number(date.slice(8, 10)));
}

function formatCalendarWeekday(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "long",
        timeZone: "UTC",
    });
}

function formatCalendarDayMonth(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    const day = d.getUTCDate();
    const month = d.toLocaleDateString("en-US", {
        month: "long",
        timeZone: "UTC",
    });
    return `${day} ${month}`;
}

function headerMarkup(data: TodayPageData): Html {
    const { view } = data;
    const title = formatCalendarWeekday(view.date);
    const dateLine = formatCalendarDayMonth(view.date);
    const streakPart = view.streak > 0 ? ` · ${view.streak}-day streak` : "";
    const subtitle = `<p class="fd-today-subtitle">${esc(`${dateLine}${streakPart}`)}</p>`;
    const peer =
        data.chrome.subjectLabel != null
            ? `<p class="fd-today-peer" role="status">${esc(`Viewing ${data.chrome.subjectLabel}`)}</p>`
            : "";
    return raw(
        `<header class="fd-today-header"><div class="fd-today-header__text"><h1 class="fd-today-title">${esc(title)}</h1>${subtitle}${peer}</div></header>`,
    );
}

function isReadOnlyPeer(data: TodayPageData): boolean {
    return data.chrome.subjectLabel != null;
}

function weekDotAttr(state: WeekDotState): string {
    return ` data-fd-dot="${state}"`;
}

function weekStripMarkup(data: TodayPageData): Html {
    const { view, memberQuery } = data;
    const { week } = view;
    const prev = todayHref({
        date: week.prevWeekStart,
        member: memberQuery,
    });
    const next = todayHref({
        date: week.nextWeekStart,
        member: memberQuery,
    });
    const dotsByDate = new Map(week.dots.map((d) => [d.date, d.state]));
    const labels = WEEKDAY_LETTERS.map(
        (letter) =>
            `<span class="fd-today-week__label" aria-hidden="true">${letter}</span>`,
    ).join("");
    const days = week.days
        .map((day) => {
            const state = dotsByDate.get(day.date) ?? "empty";
            const href = todayHref({ date: day.date, member: memberQuery });
            const current = day.isSelected ? ` aria-current="date"` : "";
            const todayClass = day.isToday ? " fd-today-week__day--today" : "";
            const selectedClass = day.isSelected
                ? " fd-today-week__day--selected"
                : "";
            return `<a class="fd-today-week__day${todayClass}${selectedClass}" href="${esc(href)}"${current}><span class="fd-today-week__num">${esc(dayNumber(day.date))}</span><span class="fd-today-week__dot"${weekDotAttr(state)} aria-hidden="true"></span></a>`;
        })
        .join("");
    return raw(
        `<nav class="fd-today-week" aria-label="Week"><a class="fd-today-week__chev fd-today-week__chev--prev" href="${esc(prev)}" aria-label="Previous week">${iconChevronRight()}</a><div class="fd-today-week__grid"><div class="fd-today-week__labels">${labels}</div><div class="fd-today-week__days">${days}</div></div><a class="fd-today-week__chev fd-today-week__chev--next" href="${esc(next)}" aria-label="Next week">${iconChevronRight()}</a></nav>`,
    );
}

function gaugeMarkup(view: TodayView): Html {
    const goal = activeCalorieGoal(view.goals);
    const eatenRaw = view.totals.calories;
    const g = calorieGauge(
        {
            goal,
            eaten: eatenRaw ?? 0,
            protein_g: view.totals.protein_g,
            carbs_g: view.totals.carbs_g,
            fat_g: view.totals.fat_g,
        },
        GAUGE_SPECS.today,
    );
    const track = `<path class="fd-today-gauge__track" d="${g.track.d}" fill="none" stroke-width="${g.stroke}"/>`;
    const segments = g.segments
        .map(
            (seg) =>
                `<path class="fd-today-gauge__seg fd-today-gauge__seg--${seg.key}" d="${seg.d}" fill="none" stroke-width="${g.stroke}"/>`,
        )
        .join("");
    const { box } = g;
    let center: string;
    if (goal == null) {
        center = `<div class="fd-today-gauge__center fd-today-gauge__center--solo"><span class="fd-today-gauge__hero">${esc(fmtKcal(eatenRaw))}</span><span class="fd-today-gauge__caption">kcal eaten</span></div>`;
    } else if (eatenRaw == null) {
        center = `<div class="fd-today-gauge__center"><span class="fd-today-gauge__hero">—</span></div>`;
    } else if (g.remaining != null && g.remaining < 0) {
        center = `<div class="fd-today-gauge__center"><span class="fd-today-gauge__hero fd-today-gauge__hero--over">${esc(fmtKcal(Math.abs(g.remaining)))}</span><span class="fd-today-gauge__caption fd-today-gauge__caption--over">kcal over ${esc(fmtKcal(goal))}</span></div>`;
    } else {
        const remaining = g.remaining ?? 0;
        center = `<div class="fd-today-gauge__center"><span class="fd-today-gauge__hero">${esc(fmtKcal(remaining))}</span><span class="fd-today-gauge__caption">kcal left of ${esc(fmtKcal(goal))}</span></div>`;
    }
    // The accessible name says what the hero number says.
    const ariaLabel =
        eatenRaw == null
            ? "Calories unknown"
            : goal == null
              ? `${fmtKcal(eatenRaw)} kcal eaten`
              : g.remaining != null && g.remaining < 0
                ? `${fmtKcal(Math.abs(g.remaining))} kcal over ${fmtKcal(goal)}`
                : `${fmtKcal(g.remaining ?? 0)} kcal left of ${fmtKcal(goal)}`;
    return raw(
        `<div class="fd-today-gauge" role="img" aria-label="${esc(ariaLabel)}"><svg class="fd-today-gauge__svg" viewBox="0 0 ${box.width} ${box.height}" width="${box.width}" height="${box.height}" aria-hidden="true">${track}${segments}</svg>${center}</div>`,
    );
}

function macroBarRow(
    key: MacroKey | "calories",
    label: string,
    actual: number | null,
    goal: number | null,
): string {
    const fill = barFill(actual, goal);
    const pct = fill.percent != null ? Math.min(100, fill.percent) : 0;
    const over = fill.over ? " fd-today-macro__nums--over" : "";
    const actualFmt =
        key === "calories" ? fmtKcal(actual) : fmtWholeGrams(actual);
    const goalFmt = key === "calories" ? fmtKcal(goal) : fmtWholeGrams(goal);
    const goalText = goal != null ? ` / ${goalFmt} g` : "";
    const marker =
        fill.goalMarker != null
            ? `<span class="fd-today-macro__marker" style="left:${fill.goalMarker * 100}%"></span>`
            : "";
    const dotHtml = String(
        dot(key === "calories" ? "calories" : key, { size: "sm" }),
    );
    return `<article class="fd-today-macro fd-today-macro--${key}"><span class="fd-today-macro__label">${dotHtml}${esc(label)}</span><span class="fd-today-macro__nums${over}"><span class="fd-today-macro__actual">${esc(actualFmt)}</span>${goal != null ? `<span class="fd-today-macro__goal">${esc(goalText)}</span>` : ""}</span><div class="fd-today-macro__track" style="--fd-bar-h:${BAR_SPECS.today.height}px"><span class="fd-today-macro__fill" style="width:${pct}%"></span>${marker}</div></article>`;
}

function macroBarsMarkup(view: TodayView): Html {
    const goals = view.goals;
    const rows = MACRO_ORDER.map((key) => {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const goalKey = `daily_${key}_g` as const;
        return macroBarRow(
            key,
            label,
            view.totals[`${key}_g`],
            goals?.[goalKey] ?? null,
        );
    });
    return raw(`<div class="fd-today-macros">${rows.join("")}</div>`);
}

function alsoTrackedMarkup(view: TodayView): Html {
    const { totals, goals } = view;
    const bits: string[] = [
        esc(fmtWater(totals.water_ml, goals?.daily_water_ml ?? null)),
    ];
    if (totals.fiber_g != null) {
        bits.push(`Fiber ${esc(fmtGrams(totals.fiber_g))}`);
    }
    if (totals.sugar_g != null) {
        bits.push(`Sugar ${esc(fmtGrams(totals.sugar_g))}`);
    }
    if (view.alcoholTrackingEnabled && totals.alcohol_g != null) {
        bits.push(`Alcohol ${esc(fmtGrams(totals.alcohol_g))}`);
    }
    if (totals.caffeine_mg != null) {
        bits.push(`Caffeine ${esc(fmtWholeMg(totals.caffeine_mg))} mg`);
    }
    const line = bits
        .map(
            (bit, i) =>
                `<span class="fd-today-also__item${i === 0 ? " fd-today-also__item--water" : ""}">${bit}</span>`,
        )
        .join("");
    return raw(
        `<div class="fd-today-also"><span class="fd-today-also__line">${line}</span><a class="fd-today-also__link" href="/trends" aria-label="Open trends">${iconChevronRight()}</a></div>`,
    );
}

function rowMacros(row: MealRow): Macros {
    return {
        protein: fmtWholeGrams(row.protein_g),
        carbs: fmtWholeGrams(row.carbs_g),
        fat: fmtWholeGrams(row.fat_g),
    };
}

function mealRowMarkup(row: MealRow): Html {
    const rowHtml = String(
        foodRow({
            id: row.mealId,
            className: "fd-today-meal",
            title: row.title,
            meta: row.inlineMeta ?? undefined,
            subtitle: row.subtitle ?? undefined,
            macros: rowMacros(row),
            trailing: fmtKcal(row.calories),
        }),
    );
    return raw(
        rowHtml.replace("<li ", `<li data-fd-meal-id="${esc(row.mealId)}" `),
    );
}

function groupForType(
    groups: readonly MealTypeGroup[],
    mealType: MealTypeSlot,
): MealTypeGroup | null {
    return groups.find((g) => g.mealType === mealType) ?? null;
}

function sectionSubtotalMacros(
    sub: MealTypeGroup["subtotals"],
): Macros | undefined {
    if (sub.protein_g == null && sub.carbs_g == null && sub.fat_g == null) {
        return undefined;
    }
    return {
        protein: fmtWholeGrams(sub.protein_g),
        carbs: fmtWholeGrams(sub.carbs_g),
        fat: fmtWholeGrams(sub.fat_g),
    };
}

function mealSectionHead(
    mealType: MealTypeSlot,
    rows: readonly MealRow[],
    sub: MealTypeGroup["subtotals"],
): string {
    const macroSummary = sectionSubtotalMacros(sub);
    const macroHtml = macroSummary
        ? `<span class="fd-today-section__macros">${String(macroLine(macroSummary))}</span>`
        : "";
    const kcal =
        rows.length > 0
            ? `<span class="fd-today-section__kcal">${esc(fmtKcal(sub.calories))}</span>`
            : "";
    return `<div class="fd-today-section__head"><h2 id="fd-today-${mealType}" class="fd-today-section__title">${esc(MEAL_SECTION_LABEL[mealType].toUpperCase())}</h2>${macroHtml}${kcal}</div>`;
}

function mealsMarkup(data: TodayPageData): Html {
    const { view } = data;
    const readOnly = isReadOnlyPeer(data);
    const groups = view.meals;
    const anyMeals = groups.some((g) => g.rows.length > 0);
    if (!anyMeals) {
        const logBtn = readOnly
            ? ""
            : `<a class="fd-btn fd-btn--primary" href="${esc(FD_LOG_HREF)}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}">Log food</a>`;
        return raw(
            `<div class="fd-today-empty"><p class="fd-today-empty__text">Nothing logged yet</p>${logBtn}</div>`,
        );
    }
    const sections = MEAL_TYPE_ORDER.map((mealType) => {
        const group = groupForType(groups, mealType);
        const rows = group?.rows ?? [];
        const sub = group?.subtotals ?? {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
        };
        const head = mealSectionHead(mealType, rows, sub);
        const list =
            rows.length > 0
                ? rowList(
                      rows.map((r) => mealRowMarkup(r)),
                      {
                          label: MEAL_SECTION_LABEL[mealType],
                      },
                  )
                : readOnly
                  ? `<p class="fd-today-section__empty">Nothing yet</p>`
                  : `<div class="fd-today-section__empty-row"><span class="fd-today-section__empty">Nothing yet</span><a class="fd-icon-btn fd-today-section__add" href="${esc(FD_LOG_HREF)}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}" aria-label="Log food">${iconPlus()}</a></div>`;
        return `<section class="fd-today-section" aria-labelledby="fd-today-${mealType}">${head}${list}</section>`;
    });
    return raw(sections.join(""));
}

export function renderTodayBody(data: TodayPageData): Html {
    const { view } = data;
    const banner = data.error ? String(settingsErrorBanner(data.error)) : "";
    return raw(
        `<div class="fd-today-page">${banner}${headerMarkup(data)}${weekStripMarkup(data)}<section class="fd-today-summary" aria-label="Day summary">${gaugeMarkup(view)}${macroBarsMarkup(view)}${alsoTrackedMarkup(view)}</section><div class="fd-today-meals">${mealsMarkup(data)}</div></div>`,
    );
}

export function renderTodayV2Page(data: TodayPageData): string {
    return renderAppShell({
        ...data.chrome,
        title: "Today",
        active: "nutrition",
        v2Active: "today",
        v2Timezone: data.view.timezone,
        v2LogSheet: data.logSheet,
        body: renderTodayBody(data),
    });
}

const PREVIEW_GOALS: NutritionGoals = {
    user_id: "preview",
    daily_calories: 2421,
    daily_protein_g: 210,
    daily_carbs_g: 213,
    daily_fat_g: 81,
    daily_fiber_g: 30,
    daily_sugar_g: 50,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 400,
    daily_water_ml: 3000,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

function previewMeal(
    over: Partial<Meal> & { id: string; meal_type: string },
    items: Meal["items"] = [],
): Meal {
    return {
        user_id: "preview",
        logged_at: "2026-11-10T08:30:00.000Z",
        description: "Meal",
        calories: 400,
        protein_g: 30,
        carbs_g: 40,
        fat_g: 12,
        fiber_g: 5,
        sugar_g: 8,
        alcohol_g: null,
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        items,
        ...over,
    };
}

/** Fixture builder for app-preview and page tests (no database). */
export function buildPreviewTodayView(today: string): TodayView {
    const meals: Meal[] = [
        previewMeal(
            {
                id: "m1",
                meal_type: "breakfast",
                description: "Scrambled eggs",
                calories: 216,
                protein_g: 8,
                carbs_g: 36,
                fat_g: 4,
            },
            [
                {
                    id: "mi-eggs",
                    user_id: "preview",
                    household_id: "hh",
                    meal_id: "m1",
                    food_id: "f-eggs",
                    recipe_id: null,
                    created_at: "2026-11-10T08:00:00.000Z",
                    label: "Eggs",
                    amount: 3,
                    unit: "large",
                    grams: null,
                    portions: null,
                    sort_order: 0,
                    calories: 216,
                    protein_g: 8,
                    carbs_g: 36,
                    fat_g: 4,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                },
            ],
        ),
        previewMeal(
            {
                id: "m2",
                meal_type: "breakfast",
                description: "Sourdough toast",
                calories: 216,
                protein_g: 2,
                carbs_g: 18,
                fat_g: 10,
            },
            [
                {
                    id: "mi-toast",
                    user_id: "preview",
                    household_id: "hh",
                    meal_id: "m2",
                    food_id: "f-toast",
                    recipe_id: null,
                    created_at: "2026-11-10T08:00:00.000Z",
                    label: "Sourdough",
                    amount: 1,
                    unit: "slice",
                    grams: null,
                    portions: null,
                    sort_order: 0,
                    calories: 216,
                    protein_g: 2,
                    carbs_g: 18,
                    fat_g: 10,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                },
            ],
        ),
        previewMeal(
            {
                id: "m2b",
                meal_type: "breakfast",
                description: "Coffee",
                calories: 5,
                protein_g: 0,
                carbs_g: 0,
                fat_g: 0,
                caffeine_mg: 95,
            },
            [],
        ),
        previewMeal(
            {
                id: "m3",
                meal_type: "lunch",
                description: "Chicken bowl",
                calories: 852,
                protein_g: 62,
                carbs_g: 72,
                fat_g: 28,
            },
            [
                {
                    id: "mi1",
                    user_id: "preview",
                    household_id: "hh",
                    meal_id: "m3",
                    food_id: "f1",
                    recipe_id: null,
                    created_at: "2026-11-10T08:00:00.000Z",
                    label: "Chicken breast",
                    amount: 150,
                    unit: "g",
                    grams: 150,
                    portions: null,
                    sort_order: 0,
                    calories: 400,
                    protein_g: 45,
                    carbs_g: 0,
                    fat_g: 10,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                },
                {
                    id: "mi2",
                    user_id: "preview",
                    household_id: "hh",
                    meal_id: "m3",
                    food_id: "f2",
                    recipe_id: null,
                    created_at: "2026-11-10T08:00:00.000Z",
                    label: "Rice",
                    amount: 1,
                    unit: "cup",
                    grams: 180,
                    portions: null,
                    sort_order: 1,
                    calories: 452,
                    protein_g: 17,
                    carbs_g: 72,
                    fat_g: 18,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                },
            ],
        ),
    ];
    const weekStart = sundayWeekStart(today);
    const dates = weekDates(weekStart);
    const bounds = {
        prevWeekStart: shiftLocalDate(weekStart, -7),
        nextWeekStart: shiftLocalDate(weekStart, 7),
    };
    const dotStates: WeekDotState[] = [
        "off",
        "hit",
        "hit",
        "off",
        "off",
        "hit",
        "empty",
    ];
    const week: WeekStripLayout & {
        dots: Array<{ date: string; state: WeekDotState }>;
    } = {
        ...annotateWeekDays(dates, today, today, bounds),
        dots: dates.map((date, i) => ({
            date,
            state: dotStates[i] ?? "empty",
        })),
    };
    const waterMl = 1600;
    return {
        date: today,
        timezone: "UTC",
        preferredWeightUnit: "kg",
        alcoholTrackingEnabled: true,
        totals: todayDayTotals(meals, waterMl),
        goals: PREVIEW_GOALS,
        meals: mealRows(meals),
        week,
        streak: 4,
        expiringFridge: [],
        attention: { count: 0, notices: [], noticeFoods: new Map() },
        weight: { latest: null, series30d: [] },
    };
}

export function buildPreviewTodayPageData(
    chrome: TodayPageChrome,
    today = "2026-11-10",
): TodayPageData {
    return {
        chrome,
        view: buildPreviewTodayView(today),
        today,
    };
}
