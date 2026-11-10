import {
    buildDailyBuckets,
    type GoalsByDate,
} from "../../../domain/insights.js";
import { MACRO_ORDER, type MacroKey } from "../../../domain/geometry.js";
import {
    trendsDayFromBucket,
    trendsView,
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
import { statTiles, type StatTile } from "../../components/v2/stat-tiles.js";
import { renderAppShell } from "../../shell.js";

export const TRENDS_RANGES = [7, 30, 90, 365] as const;
export const DEFAULT_TRENDS_RANGE: TrendsRange = 30;
const TRENDS_HISTORY_DAYS = 365;

export type TrendsPageChrome = AppChromeBase & {
    subjectLabel?: string;
};

export type TrendsPageData = {
    chrome: TrendsPageChrome;
    defaultRange: TrendsRange;
    today: string;
    views: Record<string, TrendsView>;
    empty: boolean;
};

function monthOf(date: string): { year: number; month: number } {
    const [y, m] = date.split("-").map(Number);
    return { year: y!, month: m! };
}

export function buildTrendsViews(
    days: readonly TrendsDay[],
    goalsByDay: GoalsByDate,
    weights: readonly TrendsWeightInput[],
    today: string,
    weightUnit: WeightUnit,
): Record<string, TrendsView> {
    const month = monthOf(today);
    const unit = weightUnit ?? "kg";
    const out: Record<string, TrendsView> = {};
    for (const range of TRENDS_RANGES) {
        out[String(range)] = trendsView(
            days,
            goalsByDay,
            weights,
            range,
            unit,
            month,
            today,
        );
    }
    return out;
}

export async function loadTrendsPageData(
    subjectUserId: string,
    chrome: TrendsPageChrome,
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

    const views = buildTrendsViews(days, forDate, weights, today, weightUnit);
    const year = views["365"]!;
    const empty = year.tiles.loggedDays === 0 && weights.length === 0;

    return {
        chrome,
        defaultRange: DEFAULT_TRENDS_RANGE,
        today,
        views,
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

function fmtWeight(value: number | null, unit: string): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return `${(Math.round(value * 10) / 10).toFixed(1)} ${unit}`;
}

function shortDay(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
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

function tilesMarkup(view: TrendsView): Html {
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
    return statTiles(tiles, { label: "Summary for selected range" });
}

function averagesMarkup(view: TrendsView): Html {
    const rows = (
        ["calories", ...MACRO_ORDER] as Array<MacroKey | "calories">
    ).map((key) => {
        const row = view.averagesVsGoals[key];
        const pct =
            row.ratio != null ? Math.min(100, Math.round(row.ratio * 100)) : 0;
        const label =
            key === "calories"
                ? "Calories"
                : key.charAt(0).toUpperCase() + key.slice(1);
        const actual =
            key === "calories" ? fmtKcal(row.actual) : fmtMacro(row.actual);
        const goal =
            key === "calories" ? fmtKcal(row.goal) : fmtMacro(row.goal);
        return `<div class="fd-trends-avg__row"><dt class="fd-trends-avg__label">${esc(label)}</dt><dd class="fd-trends-avg__body"><span class="fd-trends-avg__nums">${esc(actual)}<span class="fd-trends-avg__sep">/</span>${esc(goal)}</span><div class="fd-trends-avg__track"><div class="fd-trends-avg__fill fd-trends-avg__fill--${esc(key)}" style="width:${pct}%"></div></div></dd></div>`;
    });
    return raw(
        `<section class="fd-trends-section fd-trends-averages" aria-label="Averages vs goals"><h2 class="fd-trends-section__title">Averages vs goals</h2><dl class="fd-trends-avg">${rows.join("")}</dl></section>`,
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
    return raw(
        `<section class="fd-trends-section fd-trends-calories" aria-label="Calories by day"><h2 class="fd-trends-section__title">Calories by day</h2><ul class="fd-trends-bars">${bars}</ul><p class="fd-trends-legend"><span class="fd-trends-legend__item fd-trends-legend__item--logged">Logged</span><span class="fd-trends-legend__item fd-trends-legend__item--near">Near goal</span><span class="fd-trends-legend__item fd-trends-legend__item--off">Off by 120+</span><span class="fd-trends-legend__item fd-trends-legend__item--empty">No log</span></p></section>`,
    );
}

function ringsMarkup(view: TrendsView): Html {
    const ringDays = view.rings.slice(-7);
    const days = ringDays
        .map(
            (day) =>
                `<li class="fd-trends-rings__day"><span class="fd-trends-rings__ring">${ringSvg(day)}</span><span class="fd-trends-rings__date">${esc(shortDay(day.date))}</span></li>`,
        )
        .join("");
    return raw(
        `<section class="fd-trends-section fd-trends-rings" aria-label="Macros by day"><h2 class="fd-trends-section__title">Macros by day</h2><ul class="fd-trends-rings__list">${days}</ul></section>`,
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
    const latest = fmtWeight(weight.latest, weight.unit);
    let change = "";
    if (weight.change != null && Number.isFinite(weight.change)) {
        const signed =
            weight.change > 0
                ? `+${(Math.round(weight.change * 10) / 10).toFixed(1)}`
                : (Math.round(weight.change * 10) / 10).toFixed(1);
        change = `<span class="fd-trends-weight__change">${esc(signed)} ${esc(weight.unit)}</span>`;
    }
    const body = chart
        ? `${chart}<p class="fd-trends-weight__summary"><span class="fd-trends-weight__latest">${esc(latest)}</span>${change}</p>`
        : `<p class="fd-trends-weight__empty">No weigh-ins in this range</p>`;
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
    return raw(
        `${tilesMarkup(view)}${ringsMarkup(view)}${averagesMarkup(view)}${caloriesByDayMarkup(view)}${weightMarkup(view)}`,
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
    const buttons = TRENDS_RANGES.map(
        (r) =>
            `<button type="button" class="fd-seg-btn${r === active ? " fd-seg-btn--on" : ""}" data-fd-trends-range="${r}" aria-pressed="${r === active}">${r === 365 ? "Year" : `${r}d`}</button>`,
    ).join("");
    return raw(
        `<div class="fd-seg fd-trends-range" role="group" aria-label="Trends range">${buttons}</div>`,
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
    const body = data.empty
        ? `<p class="fd-trends-empty">Log meals to see trends here.</p>`
        : panels;
    return raw(
        `<div class="fd-trends-page" data-fd-trends-root><header class="fd-trends-header"><div class="fd-trends-header__top"><h1 class="fd-trends-title">Trends</h1>${subject}</div>${rangeToggle(data.defaultRange)}</header>${body}</div>`,
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
export function buildPreviewTrendsPageData(
    chrome: TrendsPageChrome,
    days: TrendsDay[],
    goalsByDay: GoalsByDate,
    weights: TrendsWeightInput[],
    today: string,
    weightUnit: "kg" | "lb" = "kg",
): TrendsPageData {
    const views = buildTrendsViews(
        days,
        goalsByDay,
        weights,
        today,
        weightUnit,
    );
    const year = views["365"]!;
    return {
        chrome,
        defaultRange: DEFAULT_TRENDS_RANGE,
        today,
        views,
        empty: year.tiles.loggedDays === 0 && weights.length === 0,
    };
}
