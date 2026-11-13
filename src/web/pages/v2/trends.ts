import {
    buildDailyBuckets,
    type GoalsByDate,
} from "../../../domain/insights.js";
import { MACRO_ORDER, type MacroKey } from "../../../domain/geometry.js";
import {
    trendsDayFromBucket,
    trendsView,
    type MonthGrid,
    type MonthGridCell,
    type TrendsRange,
    type TrendsView,
    type TrendsDay,
    type TrendsDayRing,
    type TrendsWeightInput,
} from "../../../domain/trends-view.js";
import {
    getGoalsForRange,
    getMealsInRange,
    getWaterInRange,
    getWeightInRange,
} from "../../../db/nutrition.js";
import {
    getProfile,
    preferredWeightUnitFromProfile,
} from "../../../db/profiles.js";
import {
    dateInTz,
    shiftLocalDate,
    todayInTz,
    validateTz,
} from "../../../domain/tz.js";
import type { WeightUnit } from "../../../domain/units.js";
import type { AppChromeBase } from "../../attention.js";
import { dashboardAccess, type HouseholdMember } from "../../../household.js";
import {
    getHouseholdMembership,
    listHouseholdMembers,
} from "../../../db/household.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import {
    deltaStat,
    statStrip,
    type StatDelta,
    type StatTile,
} from "../../components/v2/stat-tiles.js";
import { renderAppShell } from "../../shell.js";

export const TRENDS_RANGES = [7, 30, 90, 365] as const;
export const DEFAULT_TRENDS_RANGE: TrendsRange = 30;
const TRENDS_HISTORY_DAYS = 365;

export type TrendsPageChrome = AppChromeBase & {
    subjectLabel?: string;
};

export type TrendsCalendarMonth = { year: number; month: number };

export type TrendsPageData = {
    chrome: TrendsPageChrome;
    defaultRange: TrendsRange;
    today: string;
    views: Record<string, TrendsView>;
    monthGrid: MonthGrid;
    displayMonth: TrendsCalendarMonth;
    memberQuery?: string;
    empty: boolean;
};

function monthOf(date: string): TrendsCalendarMonth {
    const [y, m] = date.split("-").map(Number);
    return { year: y!, month: m! };
}

export function parseTrendsMonthParam(
    raw: string | undefined,
    today: string,
): TrendsCalendarMonth {
    const fallback = monthOf(today);
    const s = raw?.trim();
    if (!s || !/^\d{4}-\d{2}$/.test(s)) return fallback;
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(5, 7));
    if (month < 1 || month > 12) return fallback;
    // Same window as the Today date: older years break the range arithmetic.
    if (year < 1970 || year > 2999) return fallback;
    const dt = new Date(Date.UTC(year, month - 1, 1));
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month) {
        return fallback;
    }
    // A month after the current one has nothing to show.
    if (year * 12 + month > fallback.year * 12 + fallback.month) {
        return fallback;
    }
    return { year, month };
}

export function parseTrendsRangeParam(raw: string | undefined): TrendsRange {
    if (raw === "7" || raw === "30" || raw === "90" || raw === "365") {
        return Number(raw) as TrendsRange;
    }
    return DEFAULT_TRENDS_RANGE;
}

export function canAdvanceTrendsMonth(
    display: TrendsCalendarMonth,
    today: string,
): boolean {
    const t = monthOf(today);
    if (display.year < t.year) return true;
    if (display.year > t.year) return false;
    return display.month < t.month;
}

export function trendsMonthKey(year: number, month: number): string {
    return `${year}-${String(month).padStart(2, "0")}`;
}

export function trendsMonthHref(opts: {
    year: number;
    month: number;
    range: TrendsRange;
    member?: string;
}): string {
    const q = new URLSearchParams();
    q.set("month", trendsMonthKey(opts.year, opts.month));
    q.set("range", String(opts.range));
    if (opts.member?.trim()) q.set("member", opts.member.trim());
    return `/trends?${q.toString()}`;
}

export function buildTrendsViews(
    days: readonly TrendsDay[],
    goalsByDay: GoalsByDate,
    weights: readonly TrendsWeightInput[],
    today: string,
    weightUnit: WeightUnit,
    displayMonth: TrendsCalendarMonth,
): { views: Record<string, TrendsView>; monthGrid: MonthGrid } {
    const unit = weightUnit ?? "kg";
    const out: Record<string, TrendsView> = {};
    for (const range of TRENDS_RANGES) {
        out[String(range)] = trendsView(
            days,
            goalsByDay,
            weights,
            range,
            unit,
            displayMonth,
            today,
        );
    }
    const monthGrid = out[String(DEFAULT_TRENDS_RANGE)]!.monthGrid;
    return { views: out, monthGrid };
}

export async function loadTrendsPageData(
    subjectUserId: string,
    chrome: TrendsPageChrome,
    query?: { month?: string; range?: string; member?: string },
): Promise<TrendsPageData> {
    const subjectProfile = await getProfile(subjectUserId);
    const tz =
        subjectProfile?.timezone && validateTz(subjectProfile.timezone)
            ? subjectProfile.timezone
            : "UTC";
    const today = todayInTz(tz);
    const startDate = shiftLocalDate(today, -(TRENDS_HISTORY_DAYS - 1));
    const weightUnit = preferredWeightUnitFromProfile(subjectProfile) ?? "kg";

    const [meals, water, { forDate }, weightEntries] = await Promise.all([
        getMealsInRange(subjectUserId, startDate, today, tz),
        getWaterInRange(subjectUserId, startDate, today, tz),
        getGoalsForRange(subjectUserId, startDate, today),
        getWeightInRange(subjectUserId, startDate, today, tz),
    ]);

    const buckets = buildDailyBuckets(meals, water, startDate, today, tz);
    const days = buckets.map((b) => trendsDayFromBucket(b));
    const weights: TrendsWeightInput[] = weightEntries.map((e) => ({
        date: dateInTz(e.logged_at, tz),
        weight_g: e.weight_g,
    }));

    const displayMonth = parseTrendsMonthParam(query?.month, today);
    const defaultRange = parseTrendsRangeParam(query?.range);
    const { views, monthGrid } = buildTrendsViews(
        days,
        forDate,
        weights,
        today,
        weightUnit,
        displayMonth,
    );
    const year = views["365"]!;
    const empty = year.tiles.loggedDays === 0 && weights.length === 0;

    return {
        chrome,
        defaultRange,
        today,
        views,
        monthGrid,
        displayMonth,
        memberQuery: query?.member?.trim() || undefined,
        empty,
    };
}

export async function resolveTrendsSubject(
    viewerUserId: string,
    requestedMember?: string,
): Promise<
    | { ok: false; status: 403; html: string }
    | { ok: true; subject: HouseholdMember; chrome: TrendsPageChrome }
> {
    const viewer = await getHouseholdMembership(viewerUserId);
    if (viewer == null) {
        const { forbiddenDashboardHtml } = await import("../../loaders.js");
        return { ok: false, status: 403, html: forbiddenDashboardHtml() };
    }
    let subject = viewer;
    if (requestedMember?.trim()) {
        const requested = await getHouseholdMembership(requestedMember.trim());
        if (requested == null || requested.householdId !== viewer.householdId) {
            const { forbiddenDashboardHtml } = await import("../../loaders.js");
            return { ok: false, status: 403, html: forbiddenDashboardHtml() };
        }
        subject = requested;
    }
    const access = dashboardAccess(viewer, subject);
    if (!access.ok) {
        const { forbiddenDashboardHtml } = await import("../../loaders.js");
        return { ok: false, status: 403, html: forbiddenDashboardHtml() };
    }
    const viewerProfile = await getProfile(viewer.userId);
    const { viewerChromeWithAttention } = await import("../../attention.js");
    const chrome = await viewerChromeWithAttention(viewerProfile, viewer);
    const members = await listHouseholdMembers(viewer.householdId);
    const subjectLabel =
        subject.userId !== viewer.userId
            ? members.find((m) => m.userId === subject.userId)?.displayName
            : undefined;
    return {
        ok: true,
        subject,
        chrome: { ...chrome, subjectLabel },
    };
}

function fmtKcal(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return String(Math.round(value));
}

function fmtMacro(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return (Math.round(value * 10) / 10).toFixed(1);
}

function shortDay(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function ringDayLabel(date: string, range: TrendsRange): string {
    if (range === 7) {
        const d = new Date(`${date}T12:00:00Z`);
        return d.toLocaleDateString("en-US", {
            weekday: "narrow",
            timeZone: "UTC",
        });
    }
    return shortDay(date);
}

function trendsAveragesTitle(range: TrendsRange): string {
    const span = range === 365 ? "Last year" : `Last ${range} days`;
    return `Averages · ${span}`;
}

function ringSvg(day: TrendsDayRing): string {
    const { box, stroke, rings } = day.rings;
    const arcs = rings
        .map((ring) => {
            const strokeW = stroke;
            const track = `<path class="fd-trends-ring__track fd-trends-ring__track--${ring.key}" d="${ring.track.d}" fill="none" stroke-width="${strokeW}"/>`;
            const fill = ring.fill
                ? `<path class="fd-trends-ring__fill fd-trends-ring__fill--${ring.key}" d="${ring.fill.d}" fill="none" stroke-width="${strokeW}"/>`
                : "";
            return track + fill;
        })
        .join("");
    return `<svg class="fd-trends-ring" viewBox="0 0 ${box.width} ${box.height}" width="${box.width}" height="${box.height}" role="img" aria-hidden="true">${arcs}</svg>`;
}

function phoneTilesMarkup(view: TrendsView): Html {
    const tiles: StatTile[] = [
        {
            label: "Avg calories",
            value: fmtKcal(view.tiles.avgKcal),
            unit: "kcal",
            dot: "calories",
        },
        {
            label: "Avg protein",
            value: fmtMacro(view.tiles.avgProtein),
            unit: "g",
            dot: "protein",
        },
        {
            label: "Logged days",
            value: view.tiles.loggedDays,
        },
        {
            label: "Current streak",
            value: view.tiles.currentStreak,
            unit: "days",
        },
    ];
    return statStrip(tiles, {
        className: "fd-trends-summary fd-trends-summary--phone",
        label: "Summary for selected range",
    });
}

type TileMetaTone = "good" | "over" | "neutral";

function desktopTileCard(opts: {
    label: string;
    value: string;
    meta?: string;
    metaTone?: TileMetaTone;
}): string {
    const meta =
        opts.meta != null && opts.meta !== ""
            ? `<p class="fd-trends-tile__meta fd-trends-tile__meta--${opts.metaTone ?? "neutral"}">${esc(opts.meta)}</p>`
            : "";
    return `<div class="fd-tile"><dt class="fd-tile__label">${esc(opts.label)}</dt><dd class="fd-tile__value">${esc(opts.value)}</dd>${meta}</div>`;
}

function desktopTilesMarkup(view: TrendsView): Html {
    const { tiles, range } = view;
    const loggedPct =
        range > 0 ? Math.round((tiles.loggedDays / range) * 100) : 0;
    const calRow = view.averagesVsGoals.calories;
    const fatRow = view.averagesVsGoals.fat;
    let calMeta = "";
    let calTone: TileMetaTone = "neutral";
    if (calRow.ratio != null && calRow.goal != null && calRow.goal > 0) {
        const pct = Math.round(calRow.ratio * 100);
        calMeta = `${pct}% of goal`;
        calTone = calRow.ratio > 1 ? "over" : "good";
    }
    let fatMeta = "";
    let fatTone: TileMetaTone = "neutral";
    if (fatRow.ratio != null && fatRow.goal != null && fatRow.goal > 0) {
        const overPct = Math.round((fatRow.ratio - 1) * 100);
        if (overPct > 0) {
            fatMeta = `${overPct}% over goal`;
            fatTone = "over";
        } else if (overPct < 0) {
            fatMeta = `${Math.abs(overPct)}% under goal`;
            fatTone = "good";
        } else {
            fatMeta = "At goal";
            fatTone = "good";
        }
    }
    const cards = [
        desktopTileCard({
            label: "Day streak",
            value: String(tiles.currentStreak),
            meta: `Best: ${tiles.longestStreak} days`,
        }),
        desktopTileCard({
            label: "Days logged",
            value: `${loggedPct}%`,
            meta: `${tiles.loggedDays} of ${range}`,
        }),
        desktopTileCard({
            label: "Average calories",
            value: fmtKcal(tiles.avgKcal),
            meta: calMeta,
            metaTone: calTone,
        }),
        desktopTileCard({
            label: "Average fat",
            value: fatRow.actual != null ? `${fmtMacro(fatRow.actual)}g` : "—",
            meta: fatMeta,
            metaTone: fatTone,
        }),
    ];
    return raw(
        `<dl class="fd-tiles fd-trends-summary fd-trends-summary--desktop" aria-label="Summary for selected range">${cards.join("")}</dl>`,
    );
}

function averagesMarkup(view: TrendsView): Html {
    const rows = (
        ["calories", ...MACRO_ORDER] as Array<MacroKey | "calories">
    ).map((key) => {
        const row = view.averagesVsGoals[key];
        const pct =
            row.ratio != null ? Math.min(100, Math.round(row.ratio * 100)) : 0;
        const over =
            row.ratio != null &&
            row.goal != null &&
            row.goal > 0 &&
            row.ratio > 1;
        const label =
            key === "calories"
                ? "Calories"
                : key.charAt(0).toUpperCase() + key.slice(1);
        const actual =
            key === "calories" ? fmtKcal(row.actual) : fmtMacro(row.actual);
        const goal =
            key === "calories" ? fmtKcal(row.goal) : fmtMacro(row.goal);
        const numsClass = over ? " fd-trends-avg__nums--over" : "";
        const tick =
            row.goal != null
                ? `<span class="fd-trends-avg__tick" aria-hidden="true"></span>`
                : "";
        return `<div class="fd-trends-avg__row"><dt class="fd-trends-avg__label">${esc(label)}</dt><dd class="fd-trends-avg__track-wrap"><div class="fd-trends-avg__track"><div class="fd-trends-avg__fill fd-trends-avg__fill--${esc(key)}" style="width:${pct}%"></div>${tick}</div></dd><dd class="fd-trends-avg__nums${numsClass}">${esc(actual)}<span class="fd-trends-avg__sep">/</span>${esc(goal)}</dd></div>`;
    });
    return raw(
        `<section class="fd-trends-section fd-trends-averages" aria-label="Averages vs goals"><h2 class="fd-trends-section__title"><span class="fd-trends-section__title-phone">${esc(trendsAveragesTitle(view.range))}</span><span class="fd-trends-section__title-desktop">Averages vs goals</span></h2><dl class="fd-trends-avg">${rows.join("")}</dl></section>`,
    );
}

function barStatusClass(status: string): string {
    return `fd-trends-bar--${status}`;
}

function caloriesByDayMarkup(view: TrendsView): Html {
    const bars = view.bars
        .map((bar) => {
            const goal = bar.goal;
            const height =
                goal != null && goal > 0
                    ? Math.min(100, Math.round((bar.calories / goal) * 100))
                    : bar.status !== "empty"
                      ? 50
                      : 8;
            const title = `${shortDay(bar.date)}: ${bar.calories} kcal`;
            return `<li class="fd-trends-bar ${barStatusClass(bar.status)}" title="${esc(title)}"><span class="fd-trends-bar__fill" style="height:${height}%"></span><span class="fd-sr">${esc(title)}</span></li>`;
        })
        .join("");
    const goal = view.bars.find((b) => b.goal != null && b.goal > 0)?.goal;
    const goalMarkup =
        goal != null
            ? `<div class="fd-trends-bars__goal" aria-hidden="true"><span class="fd-trends-bars__goal-line"></span><span class="fd-trends-bars__goal-label">Goal ${fmtKcal(goal)}</span></div>`
            : "";
    const first = view.bars[0]?.date;
    const last = view.bars[view.bars.length - 1]?.date;
    const rangeMarkup =
        first && last
            ? `<p class="fd-trends-bars__range" aria-hidden="true"><span>${esc(shortDay(first))}</span><span>${esc(shortDay(last))}</span></p>`
            : "";
    return raw(
        `<section class="fd-trends-section fd-trends-calories" aria-label="Calories by day"><h2 class="fd-trends-section__title">Calories by day</h2><div class="fd-trends-bars-wrap"><ul class="fd-trends-bars">${bars}</ul>${goalMarkup}${rangeMarkup}</div><p class="fd-trends-legend"><span class="fd-trends-legend__item fd-trends-legend__item--logged">Logged</span><span class="fd-trends-legend__item fd-trends-legend__item--near">Near goal</span><span class="fd-trends-legend__item fd-trends-legend__item--off">Off by 120+</span><span class="fd-trends-legend__item fd-trends-legend__item--empty">No log</span></p></section>`,
    );
}

function ringsMarkup(view: TrendsView): Html {
    const ringDays = view.rings.slice(-7);
    const days = ringDays
        .map(
            (day) =>
                `<li class="fd-trends-rings__day"><span class="fd-trends-rings__ring">${ringSvg(day)}</span><span class="fd-trends-rings__date">${esc(ringDayLabel(day.date, view.range))}</span></li>`,
        )
        .join("");
    return raw(
        `<section class="fd-trends-section fd-trends-rings" aria-label="Macros by day"><h2 class="fd-trends-section__title">Macros by day<span class="fd-trends-section__range" aria-hidden="true">This week</span></h2><ul class="fd-trends-rings__list">${days}</ul><p class="fd-trends-legend fd-trends-rings__legend"><span class="fd-trends-legend__item fd-trends-legend__item--protein">Protein</span><span class="fd-trends-legend__item fd-trends-legend__item--carbs">Carbs</span><span class="fd-trends-legend__item fd-trends-legend__item--fat">Fat</span></p></section>`,
    );
}

function weightChartSvg(view: TrendsView): string {
    const { weight } = view;
    const pts = weight.points;
    if (pts.length === 0) return "";
    const W = 320;
    const H = 120;
    const padL = 8;
    const padR = 8;
    const padT = 12;
    const padB = 8;
    const ymin = weight.axisMin ?? pts[0]!.value;
    const ymax = weight.axisMax ?? pts[0]!.value;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const base = padT + plotH;
    const n = pts.length;
    const x = (i: number) =>
        n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1);
    const y = (v: number) =>
        padT + plotH - ((v - ymin) / (ymax - ymin)) * plotH;
    const coords = pts.map((p, i) => [x(i), y(p.value)] as const);
    const line =
        n >= 2
            ? coords
                  .map(
                      (p, i) =>
                          `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`,
                  )
                  .join(" ")
            : "";
    const area =
        n >= 2
            ? `M${coords[0]![0].toFixed(1)} ${base} ` +
              coords
                  .map((p) => `L${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
                  .join(" ") +
              ` L${coords[n - 1]![0].toFixed(1)} ${base} Z`
            : "";
    const dots = coords
        .map(
            (p) =>
                `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5"/>`,
        )
        .join("");
    return `<svg class="fd-trends-weight__chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight trend"><path class="fd-trends-weight__area" d="${area}"/><path class="fd-trends-weight__line" d="${line}"/>${dots}</svg>`;
}

function weightMarkup(view: TrendsView): Html {
    const { weight } = view;
    const chart = weightChartSvg(view);
    if (weight.points.length === 0) {
        return raw(
            `<section class="fd-trends-section fd-trends-weight" aria-label="Weight"><h2 class="fd-trends-section__title">Weight</h2><p class="fd-trends-weight__empty">No weigh-ins in this range</p></section>`,
        );
    }
    let delta: StatDelta | undefined;
    const weightContext =
        view.range === 365
            ? "this year"
            : view.range === 90
              ? "last 90 days"
              : view.range === 30
                ? "this month"
                : "last 7 days";
    if (weight.change != null && Number.isFinite(weight.change)) {
        const magnitude = Math.abs(Math.round(weight.change * 10) / 10).toFixed(
            1,
        );
        delta = {
            text: magnitude,
            direction:
                weight.change > 0 ? "up" : weight.change < 0 ? "down" : "flat",
            tone: "neutral",
        };
    }
    const value =
        weight.latest != null && Number.isFinite(weight.latest)
            ? (Math.round(weight.latest * 10) / 10).toFixed(1)
            : "—";
    const headline =
        delta != null
            ? deltaStat(
                  {
                      label: "Weight",
                      value,
                      unit: weight.unit,
                      delta,
                      context: weightContext,
                  },
                  { className: "fd-trends-weight__headline" },
              )
            : raw(
                  `<p class="fd-delta-stat fd-trends-weight__headline">${esc(value)}<span class="fd-delta-stat__unit">${esc(weight.unit)}</span></p>`,
              );
    const body = `${headline}${chart}`;
    return raw(
        `<section class="fd-trends-section fd-trends-weight" aria-label="Weight"><h2 class="fd-trends-section__title">Weight</h2>${body}</section>`,
    );
}

function panelRangeEmpty(view: TrendsView): boolean {
    return view.tiles.loggedDays === 0 && view.weight.points.length === 0;
}

function rangePanelBody(view: TrendsView): Html {
    if (panelRangeEmpty(view)) {
        return raw(
            `<p class="fd-trends-range-empty">No meals logged in this range.</p>`,
        );
    }
    const left = raw(`${ringsMarkup(view)}${caloriesByDayMarkup(view)}`);
    // Weight is its own column item so the desktop grid can place the month
    // card (shared by every range) between Averages and Weight.
    return raw(
        `${phoneTilesMarkup(view)}${desktopTilesMarkup(view)}<div class="fd-trends-col fd-trends-col--left">${left}</div><div class="fd-trends-col fd-trends-col--right">${averagesMarkup(view)}</div><div class="fd-trends-col fd-trends-col--weight">${weightMarkup(view)}</div>`,
    );
}

function trendsRangeSubtitle(range: TrendsRange): string {
    if (range === 7) return "This week";
    if (range === 365) return "How the last year went";
    return `How the last ${range} days went`;
}

const MONTH_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function monthCellClass(cell: MonthGridCell, today: string): string {
    const classes = ["fd-trends-month__day"];
    if (cell.status === "outside-month") {
        classes.push("fd-trends-month__day--outside");
    } else {
        classes.push(`fd-trends-month__day--${cell.status}`);
        if (cell.date === today) classes.push("fd-trends-month__day--today");
    }
    return classes.join(" ");
}

function monthTitle(year: number, month: number): string {
    const d = new Date(Date.UTC(year, month - 1, 1));
    return d.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
    });
}

function monthCardMarkup(data: TrendsPageData): Html {
    const { monthGrid, defaultRange, today, memberQuery } = data;
    const prevHref = trendsMonthHref({
        year: monthGrid.prev.year,
        month: monthGrid.prev.month,
        range: defaultRange,
        member: memberQuery,
    });
    const showNext = canAdvanceTrendsMonth(data.displayMonth, today);
    const nextHref = showNext
        ? trendsMonthHref({
              year: monthGrid.next.year,
              month: monthGrid.next.month,
              range: defaultRange,
              member: memberQuery,
          })
        : null;
    const nextLink = nextHref
        ? `<a class="fd-trends-month__nav fd-trends-month__nav--next" href="${esc(nextHref)}" aria-label="Next month"><span aria-hidden="true">›</span></a>`
        : "";
    const weekdays = MONTH_WEEKDAYS.map(
        (d) => `<span class="fd-trends-month__wd">${d}</span>`,
    ).join("");
    const rows = monthGrid.weeks
        .map((week) => {
            const cells = week
                .map((cell) => {
                    const dom = cell.date.slice(8, 10).replace(/^0/, "");
                    const inMonth = cell.status !== "outside-month";
                    const label = inMonth ? dom : "";
                    return `<span class="${monthCellClass(cell, today)}" data-date="${esc(cell.date)}">${esc(label)}</span>`;
                })
                .join("");
            return `<div class="fd-trends-month__week">${cells}</div>`;
        })
        .join("");
    return raw(
        `<section class="fd-trends-section fd-trends-month" aria-label="Month"><div class="fd-trends-month__head"><h2 class="fd-trends-section__title fd-trends-month__title">${esc(monthTitle(monthGrid.year, monthGrid.month))}</h2><div class="fd-trends-month__navs"><a class="fd-trends-month__nav fd-trends-month__nav--prev" href="${esc(prevHref)}" aria-label="Previous month"><span aria-hidden="true">‹</span></a>${nextLink}</div></div><div class="fd-trends-month__weekdays">${weekdays}</div><div class="fd-trends-month__grid">${rows}</div><p class="fd-trends-month__legend fd-trends-legend"><span class="fd-trends-legend__item fd-trends-legend__item--month-on">On target</span><span class="fd-trends-legend__item fd-trends-legend__item--month-logged">Logged</span></p></section>`,
    );
}

function rangePanel(
    range: TrendsRange,
    view: TrendsView,
    visible: boolean,
): Html {
    const hidden = visible ? "" : " hidden";
    return raw(
        `<div class="fd-trends-panel" data-fd-trends-panel="${range}"${hidden}>${rangePanelBody(view)}</div>`,
    );
}

function rangeToggle(active: TrendsRange): Html {
    // Numbers only, as days. The phone pill has three segments (7 · 30 · 90);
    // the year (365) is the fourth and shows from the desktop breakpoint.
    const buttons = TRENDS_RANGES.map((r) => {
        const cls = [
            "fd-seg-btn",
            r === active ? "fd-seg-btn--on" : "",
            r === 365 ? "fd-seg-btn--desktop-only" : "",
        ]
            .filter(Boolean)
            .join(" ");
        return `<button type="button" class="${cls}" data-fd-trends-range="${r}" aria-pressed="${r === active}" aria-label="${r} days">${r}</button>`;
    }).join("");
    return raw(
        `<div class="fd-seg fd-trends-range" role="group" aria-label="Trends range in days">${buttons}</div>`,
    );
}

export function renderTrendsBody(data: TrendsPageData): Html {
    const subject =
        data.chrome.subjectLabel != null
            ? `<p class="fd-trends-subject">${esc(data.chrome.subjectLabel)}</p>`
            : "";
    const panels = TRENDS_RANGES.map((range) =>
        rangePanel(
            range,
            data.views[String(range)]!,
            range === data.defaultRange,
        ),
    ).join("");
    const month = data.empty ? "" : monthCardMarkup(data);
    const body = data.empty
        ? `<p class="fd-trends-empty">Log meals to see trends here.</p>`
        : `<div class="fd-trends-body"><div class="fd-trends-panels">${panels}${month}</div></div>`;
    return raw(
        `<div class="fd-trends-page" data-fd-trends-root data-fd-trends-active="${data.defaultRange}"><header class="fd-trends-header"><div class="fd-trends-header__top"><h1 class="fd-trends-title">Trends</h1><p class="fd-trends-subtitle">${esc(trendsRangeSubtitle(data.defaultRange))}</p>${subject}</div>${rangeToggle(data.defaultRange)}</header>${body}</div>`,
    );
}

export function renderTrendsV2Page(data: TrendsPageData): string {
    return renderAppShell({
        ...data.chrome,
        title: "Trends",
        active: "nutrition",
        v2Active: "trends",
        body: renderTrendsBody(data),
    });
}

/** Fixture builder for app-preview (no database). */
export type TrendsPreviewOptions = {
    month?: TrendsCalendarMonth;
    range?: TrendsRange;
    member?: string;
};

export function buildPreviewTrendsPageData(
    chrome: TrendsPageChrome,
    days: TrendsDay[],
    goalsByDay: GoalsByDate,
    weights: TrendsWeightInput[],
    today: string,
    weightUnit: "kg" | "lb" = "kg",
    opts?: TrendsPreviewOptions,
): TrendsPageData {
    const displayMonth = opts?.month ?? monthOf(today);
    const defaultRange = opts?.range ?? DEFAULT_TRENDS_RANGE;
    const { views, monthGrid } = buildTrendsViews(
        days,
        goalsByDay,
        weights,
        today,
        weightUnit,
        displayMonth,
    );
    const year = views["365"]!;
    return {
        chrome,
        defaultRange,
        today,
        views,
        monthGrid,
        displayMonth,
        memberQuery: opts?.member,
        empty: year.tiles.loggedDays === 0 && weights.length === 0,
    };
}
