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
import type { SlotSuggestion } from "../../../domain/suggestions.js";
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
import {
    iconChevronRight,
    iconPlus,
    iconRepeat,
    iconTrash,
} from "../../components/v2/icons.js";
import { settingsErrorBanner } from "./settings-shared.js";
import { goalName } from "./settings-goals-label.js";
import {
    FD_LOG_SEARCH_SHEET_ID,
    type RenderLogSheetsOpts,
} from "./log-sheet.js";
import { FD_LOG_HREF } from "../../shell-v2.js";
import type { TodayView } from "../../loaders-today.js";
import { renderAppShell } from "../../shell.js";
import { renderTodayEditSheets } from "./today-edit-sheet.js";
import { todayEditSheetId } from "../../../domain/today-edit.js";
import { noticeStrip, stripNotices, todayNoticeBack } from "./notice-strip.js";
import { renderTodayRail } from "./today-rail.js";
import {
    renderMissingSheet,
    renderPlanEditSheets,
    renderWeekPhoneSection,
    type WeekPlanView,
} from "./recipes-plan.js";
import type { Notice } from "../../../domain/notices.js";
import type { FridgeItem } from "../../../domain/fridge.js";

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
    /** The household's week plan: the rail card, the phone section, their sheets. */
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
    const weekday = formatCalendarWeekday(view.date);
    const dateLine = formatCalendarDayMonth(view.date);
    const streakPart = view.streak > 0 ? ` · ${view.streak}-day streak` : "";
    // The goals' own name sits in the subtitle between the date and the
    // streak; nameless goals add nothing.
    const name = goalName(view.goals);
    const namePart = name != null ? ` · ${name}` : "";
    const subtitle = `<p class="fd-today-subtitle">${esc(`${dateLine}${namePart}${streakPart}`)}</p>`;
    const peer =
        data.chrome.subjectLabel != null
            ? `<p class="fd-today-peer" role="status">${esc(`Viewing ${data.chrome.subjectLabel}`)}</p>`
            : "";
    return raw(
        `<header class="fd-today-header"><div class="fd-today-header__text"><h1 class="fd-today-title">${esc(weekday)}</h1>${subtitle}${peer}</div></header>`,
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
        `<nav class="fd-today-week" aria-label="Week" data-fd-week-strip data-fd-week-prev="${esc(prev)}" data-fd-week-next="${esc(next)}"><a class="fd-today-week__chev fd-today-week__chev--prev" href="${esc(prev)}" aria-label="Previous week">${iconChevronRight()}</a><div class="fd-today-week__grid"><div class="fd-today-week__labels">${labels}</div><div class="fd-today-week__days">${days}</div></div><a class="fd-today-week__chev fd-today-week__chev--next" href="${esc(next)}" aria-label="Next week">${iconChevronRight()}</a></nav>`,
    );
}

function gaugeMarkup(view: TodayView): Html {
    const goal = activeCalorieGoal(view.goals);
    const hasMeals = viewHasMealRows(view);
    const eatenRaw = view.totals.calories;
    const eatenForGauge =
        eatenRaw == null && !hasMeals && goal != null ? 0 : eatenRaw;
    const g = calorieGauge(
        {
            goal,
            eaten: eatenForGauge ?? 0,
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
    } else if (eatenForGauge == null) {
        center = `<div class="fd-today-gauge__center"><span class="fd-today-gauge__hero">—</span></div>`;
    } else if (g.remaining != null && g.remaining < 0) {
        center = `<div class="fd-today-gauge__center"><span class="fd-today-gauge__hero fd-today-gauge__hero--over">${esc(fmtKcal(Math.abs(g.remaining)))}</span><span class="fd-today-gauge__caption fd-today-gauge__caption--over">kcal over ${esc(fmtKcal(goal))}</span></div>`;
    } else {
        const remaining = g.remaining ?? 0;
        center = `<div class="fd-today-gauge__center"><span class="fd-today-gauge__hero">${esc(fmtKcal(remaining))}</span><span class="fd-today-gauge__caption">kcal left of ${esc(fmtKcal(goal))}</span></div>`;
    }
    // The accessible name says what the hero number says.
    const ariaEaten = eatenForGauge == null ? null : eatenForGauge;
    const ariaLabel =
        ariaEaten == null
            ? "Calories unknown"
            : goal == null
              ? `${fmtKcal(ariaEaten)} kcal eaten`
              : g.remaining != null && g.remaining < 0
                ? `${fmtKcal(Math.abs(g.remaining))} kcal over ${fmtKcal(goal)}`
                : `${fmtKcal(g.remaining ?? 0)} kcal left of ${fmtKcal(goal)}`;
    return raw(
        `<div class="fd-today-gauge" role="img" aria-label="${esc(ariaLabel)}"><svg class="fd-today-gauge__svg" viewBox="0 0 ${box.width} ${box.height}" width="${box.width}" height="${box.height}" aria-hidden="true">${track}${segments}</svg>${center}</div>`,
    );
}

function macroDeltaHint(
    actual: number | null,
    goal: number | null,
): { text: string; over: boolean } | null {
    if (goal == null || !Number.isFinite(goal)) return null;
    const eaten = actual != null && Number.isFinite(actual) ? actual : 0;
    const delta = goal - eaten;
    if (delta > 0) {
        return { text: `${Math.round(delta)} g to go`, over: false };
    }
    if (delta < 0) {
        return { text: `${Math.round(Math.abs(delta))} g over`, over: true };
    }
    return null;
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
    const hint = key !== "calories" ? macroDeltaHint(actual, goal) : null;
    const hintHtml = hint
        ? `<p class="fd-today-macro__hint${hint.over ? " fd-today-macro__hint--over" : ""}">${esc(hint.text)}</p>`
        : "";
    return `<article class="fd-today-macro fd-today-macro--${key}"><span class="fd-today-macro__label">${dotHtml}${esc(label)}</span><span class="fd-today-macro__nums${over}"><span class="fd-today-macro__actual">${esc(actualFmt)}</span>${goal != null ? `<span class="fd-today-macro__goal">${esc(goalText)}</span>` : ""}</span><div class="fd-today-macro__track" style="--fd-bar-h:${BAR_SPECS.today.height}px"><span class="fd-today-macro__fill" style="width:${pct}%"></span>${marker}</div>${hintHtml}</article>`;
}

function macroBarsMarkup(view: TodayView): Html {
    const goals = view.goals;
    const hasMeals = viewHasMealRows(view);
    const rows = MACRO_ORDER.map((key) => {
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const goalKey = `daily_${key}_g` as const;
        return macroBarRow(
            key,
            label,
            emptyDayZero(view.totals[`${key}_g`], hasMeals),
            goals?.[goalKey] ?? null,
        );
    });
    return raw(`<div class="fd-today-macros">${rows.join("")}</div>`);
}

function alsoBarFill(actual: number | null, goal: number | null): number {
    if (goal == null || goal <= 0) return 0;
    const v = actual != null && Number.isFinite(actual) ? actual : 0;
    return Math.min(100, Math.round((v / goal) * 100));
}

function alsoTrackedColumn(opts: {
    key: string;
    label: string;
    nums: string;
    pct: number;
}): string {
    return `<article class="fd-today-also-col fd-today-also-col--${opts.key}"><span class="fd-today-also-col__label">${esc(opts.label)}</span><span class="fd-today-also-col__nums">${opts.nums}</span><div class="fd-today-also-col__track"><span class="fd-today-also-col__fill" style="width:${opts.pct}%"></span></div></article>`;
}

function fmtAlsoWater(
    ml: number,
    goalMl: number | null,
): { nums: string; pct: number } {
    const liters = ml / 1000;
    const lit =
        Math.abs(liters - Math.round(liters)) < 0.05
            ? String(Math.round(liters))
            : (Math.round(liters * 10) / 10).toFixed(1);
    if (goalMl == null || goalMl <= 0) {
        return { nums: esc(`${lit} L`), pct: 0 };
    }
    const goalL =
        Math.abs(goalMl / 1000 - Math.round(goalMl / 1000)) < 0.05
            ? String(Math.round(goalMl / 1000))
            : (Math.round((goalMl / 1000) * 10) / 10).toFixed(1);
    return {
        nums: `${esc(lit)} / ${esc(goalL)} L`,
        pct: alsoBarFill(ml, goalMl),
    };
}

function viewHasMealRows(view: TodayView): boolean {
    return view.meals.some((g) => g.rows.length > 0);
}

/** Empty days show numeric zero; logged unknown macros stay null → em dash. */
function emptyDayZero(value: number | null, hasMeals: boolean): number | null {
    return !hasMeals && value == null ? 0 : value;
}

function fmtAlsoGrams(
    actual: number | null,
    goal: number | null,
): { nums: string; pct: number } {
    const a = fmtWholeGrams(actual);
    if (goal == null || goal <= 0) return { nums: esc(`${a} g`), pct: 0 };
    return {
        nums: `${esc(a)} / ${esc(String(Math.round(goal)))} g`,
        pct: alsoBarFill(actual, goal),
    };
}

function alsoTrackedMarkup(view: TodayView): Html {
    const { totals, goals } = view;
    const hasMeals = viewHasMealRows(view);
    const fiber = emptyDayZero(totals.fiber_g, hasMeals);
    const sugar = emptyDayZero(totals.sugar_g, hasMeals);
    const caffeine = emptyDayZero(totals.caffeine_mg, hasMeals);
    const bits: string[] = [
        esc(fmtWater(totals.water_ml, goals?.daily_water_ml ?? null)),
    ];
    if (fiber != null) {
        bits.push(`Fiber ${esc(fmtGrams(fiber))}`);
    }
    if (sugar != null) {
        bits.push(`Sugar ${esc(fmtGrams(sugar))}`);
    }
    if (view.alcoholTrackingEnabled && totals.alcohol_g != null) {
        bits.push(`Alcohol ${esc(fmtGrams(totals.alcohol_g))}`);
    }
    if (caffeine != null) {
        bits.push(`Caffeine ${esc(fmtWholeMg(caffeine))} mg`);
    }
    const line = bits
        .map(
            (bit, i) =>
                `<span class="fd-today-also__item${i === 0 ? " fd-today-also__item--water" : ""}">${bit}</span>`,
        )
        .join("");
    const phone = `<div class="fd-today-also fd-today-also--phone"><span class="fd-today-also__line">${line}</span><a class="fd-today-also__link" href="/trends" aria-label="Open trends">${iconChevronRight()}</a></div>`;

    const water = fmtAlsoWater(totals.water_ml, goals?.daily_water_ml ?? null);
    const cols = [
        alsoTrackedColumn({
            key: "water",
            label: "Water",
            nums: water.nums,
            pct: water.pct,
        }),
        alsoTrackedColumn({
            key: "fiber",
            label: "Fiber",
            ...fmtAlsoGrams(fiber, goals?.daily_fiber_g ?? null),
        }),
        alsoTrackedColumn({
            key: "sugar",
            label: "Sugar",
            ...fmtAlsoGrams(sugar, goals?.daily_sugar_g ?? null),
        }),
        alsoTrackedColumn({
            key: "caffeine",
            label: "Caffeine",
            nums:
                goals?.daily_caffeine_mg != null && goals.daily_caffeine_mg > 0
                    ? `${esc(fmtWholeMg(caffeine))} / ${esc(fmtWholeMg(goals.daily_caffeine_mg))} mg`
                    : esc(`${fmtWholeMg(caffeine)} mg`),
            pct: alsoBarFill(caffeine, goals?.daily_caffeine_mg ?? null),
        }),
    ];
    if (view.alcoholTrackingEnabled) {
        cols.push(
            alsoTrackedColumn({
                key: "alcohol",
                label: "Alcohol",
                ...fmtAlsoGrams(
                    totals.alcohol_g,
                    goals?.daily_alcohol_g ?? null,
                ),
            }),
        );
    }
    const desktop = `<div class="fd-today-also-grid fd-today-also--desk">${cols.join("")}</div>`;
    return raw(`${phone}${desktop}`);
}

function rowMacros(row: MealRow): Macros {
    return {
        protein: fmtWholeGrams(row.protein_g),
        carbs: fmtWholeGrams(row.carbs_g),
        fat: fmtWholeGrams(row.fat_g),
    };
}

function mealRowMarkup(row: MealRow, data: TodayPageData): Html {
    const readOnly = isReadOnlyPeer(data);
    const sheetId = todayEditSheetId(row.mealId);
    const returnTo = todayHref({
        date: data.view.date,
        member: data.memberQuery,
    });
    const rowHtml = String(
        foodRow({
            id: row.mealId,
            className: "fd-today-meal",
            title: row.title,
            meta: row.inlineMeta ?? undefined,
            subtitle: row.subtitle ?? undefined,
            macros: rowMacros(row),
            trailing: fmtKcal(row.calories),
            swipe: readOnly
                ? undefined
                : {
                      lead: {
                          label: "Again",
                          icon: iconRepeat(),
                          form: {
                              action: `/meals/${row.mealId}/again`,
                              fields: {
                                  return_to: returnTo,
                                  date: data.view.date,
                              },
                          },
                      },
                      trail: {
                          label: "Delete",
                          icon: iconTrash(),
                          form: {
                              action: `/meals/${row.mealId}/delete`,
                              fields: {
                                  return_to: returnTo,
                                  date: data.view.date,
                              },
                          },
                      },
                      sheetId,
                  },
        }),
    );
    const attrs = readOnly
        ? ""
        : ` data-fd-meal-row data-sheet-id="${esc(sheetId)}" tabindex="0"`;
    return raw(
        rowHtml.replace(
            "<li ",
            `<li data-fd-meal-id="${esc(row.mealId)}"${attrs} `,
        ),
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
    const meta =
        macroHtml || kcal
            ? `<span class="fd-today-section__head-meta">${macroHtml}${macroHtml && kcal ? `<span class="fd-today-section__head-sep" aria-hidden="true"> · </span>` : ""}${kcal}</span>`
            : "";
    return `<div class="fd-today-section__head"><h2 id="fd-today-${mealType}" class="fd-today-section__title">${esc(MEAL_SECTION_LABEL[mealType])}</h2>${meta}</div>`;
}

function mealSectionAddRow(readOnly: boolean): string {
    if (readOnly) return "";
    return `<a class="fd-today-section__add-food" href="${esc(FD_LOG_HREF)}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}">${iconPlus()}<span>Add food</span></a>`;
}

function yesterdayCopyMarkup(
    mealType: MealTypeSlot,
    data: TodayPageData,
): string {
    const hint = data.view.yesterdayCopy?.[mealType];
    if (!hint) return "";
    const returnTo = todayHref({
        date: data.view.date,
        member: data.memberQuery,
    });
    const kcal =
        hint.kcal != null && Number.isFinite(hint.kcal)
            ? ` · ${esc(fmtKcal(hint.kcal))}`
            : "";
    return `<form class="fd-today-yesterday" method="post" action="/log/copy-yesterday"><input type="hidden" name="slot" value="${esc(mealType)}" /><input type="hidden" name="return_to" value="${esc(returnTo)}" /><button type="submit" class="fd-today-yesterday__btn">Same as yesterday? ${esc(hint.label)}${kcal}</button></form>`;
}

/** "Salmon & rice fits · uses 2 things expiring" for one suggestion. */
export function slotSuggestionText(suggestion: SlotSuggestion): string {
    const used = suggestion.usesExpiring.length;
    if (used === 0) return `${suggestion.name} fits`;
    return `${suggestion.name} fits · uses ${used} ${used === 1 ? "thing" : "things"} expiring`;
}

function slotSuggestionsMarkup(
    mealType: MealTypeSlot,
    data: TodayPageData,
): string {
    const picked = data.view.slotSuggestions?.[mealType] ?? [];
    return picked
        .map(
            (suggestion) =>
                `<a class="fd-today-suggest" href="/recipes/${esc(suggestion.recipeId)}">${esc(slotSuggestionText(suggestion))}</a>`,
        )
        .join("");
}

function mealsMarkup(data: TodayPageData): Html {
    const { view } = data;
    const readOnly = isReadOnlyPeer(data);
    const groups = view.meals;
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
        const yesterdayHint =
            rows.length === 0 && !readOnly
                ? yesterdayCopyMarkup(mealType, data)
                : "";
        const suggestions =
            rows.length === 0 && !readOnly
                ? slotSuggestionsMarkup(mealType, data)
                : "";
        const emptyLabel = suggestions
            ? `<div class="fd-today-empty-stack">${yesterdayHint}${suggestions}</div>`
            : yesterdayHint ||
              `<span class="fd-today-section__empty">Nothing yet</span>`;
        const list =
            rows.length > 0
                ? rowList(
                      rows.map((r) => mealRowMarkup(r, data)),
                      {
                          label: MEAL_SECTION_LABEL[mealType],
                      },
                  )
                : readOnly
                  ? `<p class="fd-today-section__empty">Nothing yet</p>`
                  : `<div class="fd-today-section__empty-row">${emptyLabel}<a class="fd-icon-btn fd-today-section__add" href="${esc(FD_LOG_HREF)}" data-fd-open-sheet="${FD_LOG_SEARCH_SHEET_ID}" aria-label="Log food">${iconPlus()}</a></div>`;
        const addFood = mealSectionAddRow(readOnly);
        return `<section class="fd-today-section" aria-labelledby="fd-today-${mealType}">${head}${list}${addFood}</section>`;
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
    const summary = `<section class="fd-today-summary" aria-label="Day summary"><div class="fd-today-summary__layout">${gaugeMarkup(view)}<div class="fd-today-summary__side">${macroBarsMarkup(view)}${alsoTrackedMarkup(view)}</div></div></section>`;
    // The week plan is the household's, not the day's: a peer's day has none.
    const plan = isReadOnlyPeer(data) ? undefined : data.plan;
    const planPhone = plan ? renderWeekPhoneSection(plan) : "";
    // The desktop Needs attention card carries these; the phone has no card, so
    // the weigh-in and what the plan is missing show in place. A peer's day is
    // read-only, and the plan is the household's, not theirs.
    const phoneNotices = (
        codes: Parameters<typeof stripNotices>[1],
        label: string,
    ) =>
        isReadOnlyPeer(data)
            ? ""
            : String(
                  noticeStrip(
                      stripNotices(
                          view.attention.notices,
                          codes,
                          view.attention.viewerUserId,
                      ),
                      {
                          back: todayNoticeBack(view),
                          viewerUserId: view.attention.viewerUserId,
                          label,
                          className: "fd-today-notices",
                      },
                  ),
              );
    const weighInPhone = phoneNotices(["nutrition.weigh_in_due"], "Weigh-in");
    const planMissingPhone = phoneNotices(
        ["plan.missing_ingredient"],
        "Missing for the plan",
    );
    const planSheets = plan
        ? `${renderPlanEditSheets(plan, "today")}\n${renderMissingSheet(plan, "today")}`
        : "";
    const main = `${banner}<div class="fd-today-top">${headerMarkup(data)}${weekStripMarkup(data)}</div>${summary}${weighInPhone}<div class="fd-today-meals">${mealsMarkup(data)}</div>${planPhone}${planMissingPhone}`;
    const rail = renderTodayRail(data);
    return raw(
        `<div class="fd-today-page"><div class="fd-today-main">${main}</div>${rail}${sheets}${planSheets}</div>`,
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
        householdDate: today,
        fridgeLocationNames: new Map([
            ["loc-fridge", "Fridge"],
            ["loc-freezer", "Freezer"],
        ]),
        timezone: "UTC",
        preferredWeightUnit: "kg",
        alcoholTrackingEnabled: true,
        totals: todayDayTotals(meals, waterMl),
        goals: PREVIEW_GOALS,
        editMeals: meals,
        meals: mealRows(meals),
        week,
        streak: 4,
        expiringFridge: [],
        attention: { count: 0, notices: [], noticeFoods: new Map() },
        weight: { latest: null, series30d: [] },
        yesterdayCopy: {},
        slotSuggestions: {},
        useSoonUses: [],
        useSoonHighlight: null,
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

const PREVIEW_FRIDGE: FridgeItem[] = [
    {
        id: "fr-salmon",
        householdId: "hh",
        locationId: "loc-fridge",
        kind: "food",
        displayName: "Salmon",
        quantity: { amount: 1, unit: "lb" },
        foodId: "f-salmon",
        expiresOn: "2026-11-08",
    },
    {
        id: "fr-spinach",
        householdId: "hh",
        locationId: "loc-fridge",
        kind: "food",
        displayName: "Baby <spinach>",
        quantity: { amount: 0.5, unit: "bag" },
        foodId: "f-spinach",
        expiresOn: "2026-11-09",
    },
];

function previewAttentionNotices(today: string): {
    count: number;
    notices: Notice[];
    noticeFoods: Map<string, { genericFoodId: string | null }>;
} {
    const notices: Notice[] = [
        {
            code: "fridge.expiring",
            severity: "info",
            subject: { kind: "fridge_item", id: "fr-eggs" },
            related: [],
            params: {
                name: "Eggs",
                amount: 6,
                unit: "each",
                expiresOn: today,
                daysLeft: 0,
                onGroceryList: "no",
            },
        },
        {
            code: "recipe.no_nutrition",
            severity: "warn",
            subject: {
                kind: "recipe_ingredient",
                id: "ing-lemon",
                recipeId: "r1",
            },
            related: [],
            params: { name: "Lemon", foodId: "f-lemon" },
        },
    ];
    return {
        count: notices.length,
        notices,
        noticeFoods: new Map([["f-lemon", { genericFoodId: null }]]),
    };
}

function previewWeightSeries(): TodayView["weight"] {
    const series30d = [
        { date: "2026-10-12", weight_g: 83_000 },
        { date: "2026-10-20", weight_g: 82_600 },
        { date: "2026-11-01", weight_g: 82_300 },
        { date: "2026-11-09", weight_g: 82_600 },
    ];
    return {
        latest: {
            id: "w1",
            user_id: "preview",
            weight_g: 82_600,
            logged_at: "2026-11-09T08:00:00.000Z",
            created_at: "2026-11-09T08:00:00.000Z",
            idempotency_key: null,
            notes: null,
        },
        series30d,
    };
}

/** App-preview fixture with rail cards populated (expiring, notices, weight). */
export function buildPreviewTodayViewWithRail(today: string): TodayView {
    return {
        ...buildPreviewTodayView(today),
        preferredWeightUnit: "lb",
        expiringFridge: PREVIEW_FRIDGE.map((item) => ({
            ...item,
            expiresOn:
                item.id === "fr-salmon"
                    ? shiftLocalDate(today, 1)
                    : shiftLocalDate(today, 2),
        })),
        attention: previewAttentionNotices(today),
        weight: previewWeightSeries(),
    };
}

/** Preview: dinner empty with a fitting recipe, and Use soon with recipe lines. */
export function buildPreviewTodayViewWithSuggestions(today: string): TodayView {
    const view = buildPreviewTodayViewWithRail(today);
    view.meals = view.meals.filter((g) => g.mealType !== "dinner");
    view.editMeals = view.editMeals.filter((m) => m.meal_type !== "dinner");
    view.yesterdayCopy = { breakfast: { label: "Eggs & toast", kcal: 432 } };
    view.meals = view.meals.filter((g) => g.mealType !== "breakfast");
    view.editMeals = view.editMeals.filter((m) => m.meal_type !== "breakfast");
    const used = view.expiringFridge.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        expiresOn: item.expiresOn ?? today,
    }));
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
    view.useSoonUses = used.map((item, i) => ({
        item,
        recipes: [
            {
                recipeId: "r-salmon-rice",
                name: "Salmon & rice",
                incomplete: false,
            },
            ...(i === 0
                ? [
                      {
                          recipeId: "r-salmon-bowl",
                          name: "Salmon bowl",
                          incomplete: false,
                      },
                  ]
                : []),
        ],
    }));
    view.useSoonHighlight = {
        recipeId: "r-salmon-rice",
        name: "Salmon & rice",
        itemCount: used.length,
        totalItems: used.length,
        minutes: 25,
        kcalPerPortion: 640,
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
