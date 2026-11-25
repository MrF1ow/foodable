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
import { KCAL_PER_GRAM } from "../../../domain/geometry.js";
import type { SlotSuggestion } from "../../../domain/suggestions.js";
import { shiftLocalDate } from "../../../domain/tz.js";
import type { AppChromeBase } from "../../attention.js";
import { calorieGauge } from "../../components/v2/calorie-gauge.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { macroBar } from "../../components/v2/macro-bar.js";
import { menu } from "../../components/v2/menu.js";
import { button } from "../../components/v2/button.js";
import { nutrientLine } from "../../components/v2/nutrient-line.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { weekStrip } from "../../components/v2/week-strip.js";
import type { Macros } from "../../components/v2/rows.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { goalName } from "./settings-goals-label.js";
import { FD_LOG_HREF } from "../../shell-v2.js";
import {
    FD_LOG_SEARCH_SHEET_ID,
    type CopyYesterdayOpts,
    type RenderLogSheetsOpts,
} from "./log-sheet.js";
import type { TodayView } from "../../loaders-today.js";
import { renderAppShell } from "../../shell.js";
import { renderTodayEditSheets } from "./today-edit-sheet.js";
import { todayEditSheetId } from "../../../domain/today-edit.js";
import {
    renderMissingSheet,
    renderPlanEditSheets,
    renderWeekSection,
    type WeekPlanView,
} from "./recipes-plan.js";

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
    openEditMealId?: string;
    editError?: string;
    /** The household's week plan: This week, its sheets. */
    plan?: WeekPlanView;
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
    // Dates far outside any real log (year 9999's last day steps into year
    // 10000) break the day arithmetic downstream; treat them as no date.
    if (y! < 1970 || y! > 2999) return today;
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

function fmtLiters(ml: number): string {
    const liters = ml / 1000;
    return Math.abs(liters - Math.round(liters)) < 0.05
        ? String(Math.round(liters))
        : (Math.round(liters * 10) / 10).toFixed(1);
}

function fmtWater(ml: number, goalMl: number | null): string {
    if (goalMl == null || goalMl <= 0) return `${fmtLiters(ml)} L`;
    return `${fmtLiters(ml)} / ${fmtLiters(goalMl)} L`;
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
    const weekday = formatCalendarWeekday(view.date);
    const dateLine = formatCalendarDayMonth(view.date);
    const streakPart = view.streak > 0 ? ` · ${view.streak}-day streak` : "";
    // The goals' own name sits in the subtitle between the date and the
    // streak; nameless goals add nothing.
    const name = goalName(view.goals);
    const namePart = name != null ? ` · ${name}` : "";
    const header = pageHeader({
        title: weekday,
        subtitle: `${dateLine}${namePart}${streakPart}`,
        className: "fd-today-header",
    });
    const peer =
        data.chrome.subjectLabel != null
            ? `<p class="fd-today-peer" role="status">${esc(`Viewing ${data.chrome.subjectLabel}`)}</p>`
            : "";
    return raw(`${header}${peer}`);
}

function isReadOnlyPeer(data: TodayPageData): boolean {
    return data.chrome.subjectLabel != null;
}

function weekStripMarkup(data: TodayPageData): Html {
    const { view, memberQuery } = data;
    const { week } = view;
    const prev = todayHref({ date: week.prevWeekStart, member: memberQuery });
    const next = todayHref({ date: week.nextWeekStart, member: memberQuery });
    const dotsByDate = new Map(week.dots.map((d) => [d.date, d.state]));
    const strip = weekStrip({
        label: "Week",
        className: "fd-today-week",
        previous: { label: "Previous week", href: prev },
        next: { label: "Next week", href: next },
        days: week.days.map((day) => ({
            weekday:
                WEEKDAY_LETTERS[new Date(`${day.date}T12:00:00Z`).getUTCDay()]!,
            day: Number(day.date.slice(8, 10)),
            label: `${formatCalendarWeekday(day.date)} ${formatCalendarDayMonth(day.date)}`,
            selected: day.isSelected,
            marked: (dotsByDate.get(day.date) ?? "empty") !== "empty",
            href: todayHref({ date: day.date, member: memberQuery }),
        })),
    });
    // The swipe script reads the neighbouring weeks off these.
    return raw(
        String(strip).replace(
            "<nav ",
            () =>
                `<nav data-fd-week-strip data-fd-week-prev="${esc(prev)}" data-fd-week-next="${esc(next)}" `,
        ),
    );
}

function viewHasMealRows(view: TodayView): boolean {
    return view.meals.some((g) => g.rows.length > 0);
}

/** Empty days show numeric zero; logged unknown macros stay null → em dash. */
function emptyDayZero(value: number | null, hasMeals: boolean): number | null {
    return !hasMeals && value == null ? 0 : value;
}

function gaugeMarkup(view: TodayView): Html {
    const goal = activeCalorieGoal(view.goals);
    const hasMeals = viewHasMealRows(view);
    const eatenRaw = view.totals.calories;
    const eaten = eatenRaw == null && !hasMeals && goal != null ? 0 : eatenRaw;
    // The arcs split the eaten share by the calories each macro gave.
    const kcal = (grams: number | null, per: number) =>
        grams == null ? null : grams * per;
    return calorieGauge({
        consumed: eaten,
        target: goal,
        protein: kcal(view.totals.protein_g, KCAL_PER_GRAM.protein),
        carbs: kcal(view.totals.carbs_g, KCAL_PER_GRAM.carbs),
        fat: kcal(view.totals.fat_g, KCAL_PER_GRAM.fat),
    });
}

function macroBarsMarkup(view: TodayView): Html {
    const goals = view.goals;
    const hasMeals = viewHasMealRows(view);
    return raw(
        `<div class="fd-today-macros">${(["protein", "carbs", "fat"] as const)
            .map((kind) =>
                macroBar({
                    kind,
                    value: emptyDayZero(view.totals[`${kind}_g`], hasMeals),
                    target: goals?.[`daily_${kind}_g`] ?? null,
                }),
            )
            .join("")}</div>`,
    );
}

/** Water, then the small nutrients the member has not switched off. */
function nutrientLineMarkup(view: TodayView): Html {
    const { totals, goals } = view;
    const hasMeals = viewHasMealRows(view);
    const fiber = emptyDayZero(totals.fiber_g, hasMeals);
    const sugar = emptyDayZero(totals.sugar_g, hasMeals);
    const caffeine = emptyDayZero(totals.caffeine_mg, hasMeals);
    // What the member switched off under Settings › Nutrients shown.
    const hidden = new Set(view.hiddenNutrients ?? []);
    const items: { label?: string; value: string; dot?: "water" }[] = [
        {
            value: fmtWater(totals.water_ml, goals?.daily_water_ml ?? null),
            dot: "water",
        },
    ];
    if (fiber != null && !hidden.has("fiber")) {
        items.push({ label: "Fiber", value: fmtGrams(fiber) });
    }
    if (sugar != null && !hidden.has("sugar")) {
        items.push({ label: "Sugar", value: fmtGrams(sugar) });
    }
    if (view.alcoholTrackingEnabled && totals.alcohol_g != null) {
        items.push({ label: "Alcohol", value: fmtGrams(totals.alcohol_g) });
    }
    if (caffeine != null && !hidden.has("caffeine")) {
        items.push({ label: "Caffeine", value: `${fmtWholeMg(caffeine)} mg` });
    }
    return nutrientLine({ items, href: "/trends", label: "Open trends" });
}

function rowMacros(row: MealRow): Macros {
    return {
        protein: fmtWholeGrams(row.protein_g),
        carbs: fmtWholeGrams(row.carbs_g),
        fat: fmtWholeGrams(row.fat_g),
    };
}

/** The log sheet's search, opened from a plus. */
const OPEN_LOG = { "fd-open-sheet": FD_LOG_SEARCH_SHEET_ID } as const;

function mealRowMarkup(row: MealRow, data: TodayPageData): Html {
    const base = {
        title: row.title,
        meta: row.inlineMeta ?? undefined,
        subtitle: row.subtitle ?? undefined,
        macros: rowMacros(row),
        value: fmtKcal(row.calories),
        className: "fd-today-meal",
    };
    if (isReadOnlyPeer(data)) return itemRow(base);
    const sheetId = todayEditSheetId(row.mealId);
    const returnTo = todayHref({
        date: data.view.date,
        member: data.memberQuery,
    });
    const again = (key: string) => ({
        action: `/meals/${row.mealId}/again`,
        fields: { return_to: returnTo, date: data.view.date, submit_key: key },
    });
    const del = {
        action: `/meals/${row.mealId}/delete`,
        fields: { return_to: returnTo, date: data.view.date },
    };
    const rowHtml = String(
        itemRow({
            ...base,
            trailing: {
                kind: "control",
                html: menu({
                    label: `Actions for ${row.title}`,
                    anchor: "more",
                    items: [
                        {
                            kind: "post",
                            label: "Again",
                            ...again(crypto.randomUUID()),
                        },
                        { kind: "opens", label: "Edit", sheetId },
                        { kind: "destructive", label: "Delete", ...del },
                    ],
                }),
            },
            swipe: {
                left: { label: "Delete", form: del },
                right: { label: "Again", form: again(crypto.randomUUID()) },
            },
        }),
    );
    return raw(
        // A function replacement: a string would read `$` in an id as a pattern.
        rowHtml.replace(
            "<li ",
            () =>
                `<li data-fd-meal-id="${esc(row.mealId)}" data-fd-sheet-row data-sheet-id="${esc(sheetId)}" tabindex="0" `,
        ),
    );
}

function groupForType(
    groups: readonly MealTypeGroup[],
    mealType: MealTypeSlot,
): MealTypeGroup | null {
    return groups.find((g) => g.mealType === mealType) ?? null;
}

/** "Salmon & rice fits" and what it uses up, for one suggestion. */
export function slotSuggestionText(suggestion: SlotSuggestion): string {
    const used = suggestion.usesExpiring.length;
    if (used === 0) return `${suggestion.name} fits`;
    return `${suggestion.name} fits · uses ${used} ${used === 1 ? "thing" : "things"} expiring`;
}

/** Rows that stand in for an empty slot: the copy of yesterday, then what fits. */
function emptySlotRows(mealType: MealTypeSlot, data: TodayPageData): Html[] {
    const rows: Html[] = [];
    const returnTo = todayHref({
        date: data.view.date,
        member: data.memberQuery,
    });
    // A peer's day is read-only: nothing to copy, nothing to plan.
    const hint = isReadOnlyPeer(data)
        ? undefined
        : data.view.yesterdayCopy?.[mealType];
    if (hint) {
        const kcal =
            hint.kcal != null && Number.isFinite(hint.kcal)
                ? ` · ${fmtKcal(hint.kcal)} kcal`
                : "";
        rows.push(
            itemRow({
                title: "Same as yesterday",
                subtitle: `${hint.label}${kcal}`,
                lead: { kind: "icon", name: "repeat" },
                trailing: {
                    kind: "add",
                    label: `Copy yesterday's ${MEAL_SECTION_LABEL[mealType].toLowerCase()}`,
                    form: {
                        action: "/log/copy-yesterday",
                        fields: { slot: mealType, return_to: returnTo },
                    },
                },
                className: "fd-today-yesterday",
            }),
        );
    }
    const fits = isReadOnlyPeer(data)
        ? []
        : (data.view.slotSuggestions?.[mealType] ?? []);
    for (const suggestion of fits) {
        const used = suggestion.usesExpiring.length;
        rows.push(
            itemRow({
                title: `${suggestion.name} fits`,
                subtitle:
                    used > 0
                        ? `Uses ${used} ${used === 1 ? "thing" : "things"} expiring`
                        : undefined,
                lead: { kind: "icon", name: "star" },
                trailing: {
                    kind: "control",
                    html: button({
                        label: `Open ${suggestion.name}`,
                        round: true,
                        icon: "plus",
                        href: `/recipes/${suggestion.recipeId}`,
                    }),
                },
                className: "fd-today-suggest",
            }),
        );
    }
    if (rows.length > 0) return rows;
    const nothing = "Nothing yet";
    return [
        isReadOnlyPeer(data)
            ? itemRow({ title: nothing })
            : itemRow({
                  title: nothing,
                  trailing: {
                      kind: "add",
                      label: `Log ${MEAL_SECTION_LABEL[mealType].toLowerCase()}`,
                      // A link, so it still goes to the log with no script.
                      href: FD_LOG_HREF,
                      data: OPEN_LOG,
                  },
              }),
    ];
}

function mealsMarkup(data: TodayPageData): Html {
    const groups = data.view.meals;
    const sections = MEAL_TYPE_ORDER.map((mealType) => {
        const group = groupForType(groups, mealType);
        const rows = group?.rows ?? [];
        const label = MEAL_SECTION_LABEL[mealType];
        const head = sectionHeader({
            label,
            rule: false,
            count:
                rows.length > 0
                    ? fmtKcal(group!.subtotals.calories)
                    : undefined,
        });
        const items =
            rows.length > 0
                ? rows.map((r) => mealRowMarkup(r, data))
                : emptySlotRows(mealType, data);
        return `<section class="fd-today-section" aria-label="${esc(label)}">${String(head)}${String(listGroup({ rows: items, label }))}</section>`;
    });
    return raw(sections.join(""));
}

export function renderTodayBody(data: TodayPageData): Html {
    const { view } = data;
    const banner = data.error ? String(settingsErrorBanner(data.error)) : "";
    const sheets =
        isReadOnlyPeer(data) || view.editMeals.length === 0
            ? ""
            : renderTodayEditSheets(view.editMeals, {
                  day: view.date,
                  tz: view.timezone,
                  memberQuery: data.memberQuery,
                  openMealId: data.openEditMealId,
                  errorByMealId:
                      data.openEditMealId && data.editError
                          ? { [data.openEditMealId]: data.editError }
                          : undefined,
              });
    // The week plan is the household's, not the day's: a peer's day has none.
    const plan = isReadOnlyPeer(data) ? undefined : data.plan;
    const planSection = plan ? renderWeekSection(plan, "today") : "";
    const planSheets = plan
        ? `${renderPlanEditSheets(plan, "today")}\n${renderMissingSheet(plan, "today")}`
        : "";
    const left = raw(
        `${banner}<div class="fd-today-day"><div class="fd-today-top">${String(headerMarkup(data))}${String(weekStripMarkup(data))}</div><section class="fd-today-summary" aria-label="Day summary">${String(gaugeMarkup(view))}${String(macroBarsMarkup(view))}${String(nutrientLineMarkup(view))}</section></div>`,
    );
    const right = raw(
        `<div class="fd-today-meals">${String(mealsMarkup(data))}</div>${planSection}`,
    );
    return raw(
        `${String(pageLayout({ layout: "two-columns", left, right, className: "fd-today-page" }))}${sheets}${planSheets}`,
    );
}

/**
 * The log sheet's Copy yesterday tile, on the days the Today prompt can show
 * (the member's own today): the slots with a hint, and back to this page.
 */
function yesterdaySheetOpts(
    data: TodayPageData,
): CopyYesterdayOpts | undefined {
    const hints = data.view.yesterdayCopy;
    const viewingToday = data.view.week.days.some(
        (day) => day.isToday && day.isSelected,
    );
    if (!hints || !viewingToday || isReadOnlyPeer(data)) return undefined;
    return {
        slots: Object.keys(hints),
        returnTo: todayHref({ date: data.view.date, member: data.memberQuery }),
    };
}

export function renderTodayV2Page(data: TodayPageData): string {
    return renderAppShell({
        ...data.chrome,
        title: "Today",
        active: "nutrition",
        v2Active: "today",
        v2Timezone: data.view.timezone,
        v2LogSheet: {
            ...data.logSheet,
            copyYesterday: yesterdaySheetOpts(data),
        },
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
        householdDate: today,
        timezone: "UTC",
        alcoholTrackingEnabled: true,
        totals: todayDayTotals(meals, waterMl),
        goals: PREVIEW_GOALS,
        editMeals: meals,
        meals: mealRows(meals),
        week,
        streak: 4,
        notices: [],
        yesterdayCopy: {},
        slotSuggestions: {},
    };
}

/** Preview: dinner empty with a copy-yesterday hint (FigCraft 19573). */
export function buildPreviewTodayViewWithYesterdayHint(
    today: string,
): TodayView {
    const view = buildPreviewTodayView(today);
    const meals = view.meals.filter((g) => g.mealType !== "dinner");
    view.meals = meals;
    view.editMeals = view.editMeals.filter((m) => m.meal_type !== "dinner");
    view.yesterdayCopy = {
        dinner: { label: "Eggs & toast", kcal: 432 },
    };
    return view;
}

/** Preview: breakfast has a copy-yesterday hint, and dinner a fitting recipe that uses two expiring items. */
export function buildPreviewTodayViewWithSuggestions(today: string): TodayView {
    const view = buildPreviewTodayView(today);
    view.meals = view.meals.filter(
        (g) => g.mealType !== "dinner" && g.mealType !== "breakfast",
    );
    view.editMeals = view.editMeals.filter(
        (m) => m.meal_type !== "dinner" && m.meal_type !== "breakfast",
    );
    view.yesterdayCopy = { breakfast: { label: "Eggs & toast", kcal: 432 } };
    const used = [
        {
            id: "fr-salmon",
            displayName: "Salmon",
            expiresOn: shiftLocalDate(today, 1),
        },
        {
            id: "fr-spinach",
            displayName: "Baby spinach",
            expiresOn: shiftLocalDate(today, 2),
        },
    ];
    view.slotSuggestions = {
        dinner: [
            {
                recipeId: "r-salmon-rice",
                name: "Salmon & rice",
                macrosPerPortion: {
                    calories: 640,
                    protein_g: 48,
                    carbs_g: 62,
                    fat_g: 20,
                },
                usesExpiring: used,
            },
        ],
    };
    return view;
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
