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
import { emptyState } from "../../components/v2/empty-state.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { pageHeader } from "../../components/v2/page-header.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { statCard } from "../../components/v2/stat-tiles-card.js";
import { tableRows } from "../../components/v2/table-row.js";
import { tabs } from "../../components/v2/tabs.js";
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
    memberQuery?: string;
    empty: boolean;
};

function monthOf(date: string): { year: number; month: number } {
    const [y, m] = date.split("-").map(Number);
    return { year: y!, month: m! };
}

export function parseTrendsRangeParam(raw: string | undefined): TrendsRange {
    if (raw === "7" || raw === "30" || raw === "90" || raw === "365") {
        return Number(raw) as TrendsRange;
    }
    return DEFAULT_TRENDS_RANGE;
}

export function buildTrendsViews(
    days: readonly TrendsDay[],
    goalsByDay: GoalsByDate,
    weights: readonly TrendsWeightInput[],
    today: string,
    weightUnit: WeightUnit,
): { views: Record<string, TrendsView> } {
    const unit = weightUnit ?? "kg";
    const out: Record<string, TrendsView> = {};
    for (const range of TRENDS_RANGES) {
        out[String(range)] = trendsView(
            days,
            goalsByDay,
            weights,
            range,
            unit,
            monthOf(today),
            today,
        );
    }
    return { views: out };
}

export async function loadTrendsPageData(
    subjectUserId: string,
    chrome: TrendsPageChrome,
    // The route may still pass `month`: the page has no month card.
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

    const defaultRange = parseTrendsRangeParam(query?.range);
    const { views } = buildTrendsViews(
        days,
        forDate,
        weights,
        today,
        weightUnit,
    );
    const year = views["365"]!;
    const empty = year.tiles.loggedDays === 0 && weights.length === 0;

    return {
        chrome,
        defaultRange,
        today,
        views,
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
            const { notAllowedHtml } = await import("../../loaders.js");
            return { ok: false, status: 403, html: notAllowedHtml() };
        }
        subject = requested;
    }
    const access = dashboardAccess(viewer, subject);
    if (!access.ok) {
        const { notAllowedHtml } = await import("../../loaders.js");
        return { ok: false, status: 403, html: notAllowedHtml() };
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
    return Math.round(value).toLocaleString("en-US");
}

function fmtGrams(value: number | null): string {
    if (value == null || !Number.isFinite(value)) return "—";
    return `${Math.round(value).toLocaleString("en-US")} g`;
}

function shortDay(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
    });
}

function weekdayLetter(date: string): string {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
        weekday: "narrow",
        timeZone: "UTC",
    });
}

/** "Wed 25 Nov": the day the Go to a day row starts from. */
function dayLine(date: string): string {
    const d = new Date(`${date}T12:00:00Z`);
    const weekday = d.toLocaleDateString("en-US", {
        weekday: "short",
        timeZone: "UTC",
    });
    const month = d.toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
    });
    return `${weekday} ${d.getUTCDate()} ${month}`;
}

function trendsRangeSubtitle(range: TrendsRange): string {
    return range === 365 ? "Last year" : `Last ${range} days`;
}

function tilesMarkup(view: TrendsView): Html {
    const { tiles } = view;
    return raw(
        `<div class="fd-trends-tiles" role="group" aria-label="Summary for selected range">${[
            statCard({
                value: fmtKcal(tiles.avgKcal),
                label: "Avg kcal",
            }),
            statCard({
                value: fmtGrams(tiles.avgProtein),
                label: "Avg protein",
            }),
            statCard({ value: tiles.loggedDays, label: "Logged days" }),
            statCard({
                value: `${tiles.currentStreak} ${tiles.currentStreak === 1 ? "day" : "days"}`,
                label: "Streak",
            }),
        ].join("")}</div>`,
    );
}

function averagesMarkup(view: TrendsView): Html {
    const rows = (
        ["calories", ...MACRO_ORDER] as Array<MacroKey | "calories">
    ).map((key) => {
        const row = view.averagesVsGoals[key];
        const label =
            key === "calories"
                ? "Calories"
                : key.charAt(0).toUpperCase() + key.slice(1);
        const fmt = key === "calories" ? fmtKcal : fmtGrams;
        return {
            label,
            cols: [fmt(row.actual), fmt(row.goal)],
        };
    });
    return raw(
        `<section class="fd-trends-section" aria-label="Averages vs goals">${sectionHeader({ label: "Averages", rule: false })}${tableRows(
            {
                label: "Averages against goals",
                rows: [
                    { kind: "header", label: "", cols: ["Avg", "Goal"] },
                    ...rows,
                ],
            },
        )}</section>`,
    );
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
            // A week is lettered by weekday; a longer range gets its two ends.
            const letter =
                view.range === 7
                    ? `<span class="fd-trends-bar__day" aria-hidden="true">${esc(weekdayLetter(bar.date))}</span>`
                    : "";
            return `<li class="fd-trends-bar fd-trends-bar--${esc(bar.status)}" title="${esc(title)}"><span class="fd-trends-bar__fill" style="height:${height}%"></span>${letter}<span class="fd-sr">${esc(title)}</span></li>`;
        })
        .join("");
    const first = view.bars[0]?.date;
    const last = view.bars[view.bars.length - 1]?.date;
    const ends =
        view.range !== 7 && first && last
            ? `<p class="fd-trends-bars__ends" aria-hidden="true"><span>${esc(shortDay(first))}</span><span>${esc(shortDay(last))}</span></p>`
            : "";
    return raw(
        `<section class="fd-trends-section" aria-label="Calories by day">${sectionHeader({ label: "Calories by day", rule: false })}<ul class="fd-trends-bars" tabindex="0" aria-label="Calories by day, one bar a day">${bars}</ul>${ends}</section>`,
    );
}

function weightChartSvg(view: TrendsView): string {
    const { weight } = view;
    const pts = weight.points;
    if (pts.length === 0) return "";
    const W = 320;
    const H = 120;
    const padL = 2;
    const padR = 2;
    const padT = 12;
    const padB = 8;
    const ymin = weight.axisMin ?? pts[0]!.value;
    const ymax = weight.axisMax ?? pts[0]!.value;
    const span = ymax - ymin || 1;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const n = pts.length;
    const x = (i: number) =>
        n === 1 ? padL + plotW / 2 : padL + (plotW * i) / (n - 1);
    const y = (v: number) => padT + plotH - ((v - ymin) / span) * plotH;
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
    // One weigh-in is a dot; two or more are the line.
    const dot =
        n === 1
            ? `<circle cx="${coords[0]![0].toFixed(1)}" cy="${coords[0]![1].toFixed(1)}" r="3"/>`
            : "";
    return `<svg class="fd-trends-weight__chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Weight trend"><path class="fd-trends-weight__line" d="${line}"/>${dot}</svg>`;
}

function weightMarkup(view: TrendsView): Html {
    const { weight } = view;
    const head = sectionHeader({ label: "Weight", rule: false });
    if (weight.points.length === 0) {
        return raw(
            `<section class="fd-trends-section" aria-label="Weight">${head}<p class="fd-trends-weight__empty">No weigh-ins in this range</p></section>`,
        );
    }
    const context =
        view.range === 365
            ? "this year"
            : view.range === 90
              ? "last 90 days"
              : view.range === 30
                ? "this month"
                : "last 7 days";
    let delta = "";
    if (weight.change != null && Number.isFinite(weight.change)) {
        const magnitude = Math.abs(Math.round(weight.change * 10) / 10).toFixed(
            1,
        );
        const arrow = weight.change > 0 ? "↑" : weight.change < 0 ? "↓" : "→";
        delta = `<span class="fd-trends-weight__delta">${arrow} ${esc(magnitude)} ${esc(context)}</span>`;
    }
    const value =
        weight.latest != null && Number.isFinite(weight.latest)
            ? (Math.round(weight.latest * 10) / 10).toFixed(1)
            : "—";
    return raw(
        `<section class="fd-trends-section" aria-label="Weight">${head}<div class="fd-trends-weight__head"><span class="fd-trends-weight__value">${esc(value)} ${esc(weight.unit)}</span>${delta}</div>${weightChartSvg(view)}</section>`,
    );
}

/** Go to a day: the row is a date picker; picking a day opens Today on it. */
function goToDayMarkup(data: TrendsPageData): Html {
    const member = data.memberQuery
        ? `<input type="hidden" name="member" value="${esc(data.memberQuery)}">`
        : "";
    const row = itemRow({
        title: "Go to a day",
        value: dayLine(data.today),
        lead: { kind: "icon", name: "calendar" },
        trailing: { kind: "chevron" },
        overlay: raw(
            `<input class="fd-trends-goto__input" type="date" name="date" max="${esc(data.today)}" value="${esc(data.today)}" aria-label="Go to a day" data-fd-trends-goto>`,
        ),
    });
    return raw(
        `<form class="fd-trends-goto" method="get" action="/">${member}${listGroup({ rows: [row], label: "Go to a day" })}</form>`,
    );
}

function rangePanelBody(view: TrendsView, data: TrendsPageData): Html {
    if (view.tiles.loggedDays === 0 && view.weight.points.length === 0) {
        return raw(
            `<p class="fd-trends-range-empty">No meals logged in this range.</p>`,
        );
    }
    return pageLayout({
        layout: "two-columns",
        left: raw(`${tilesMarkup(view)}${averagesMarkup(view)}`),
        right: raw(
            `${caloriesByDayMarkup(view)}${weightMarkup(view)}${goToDayMarkup(data)}`,
        ),
        className: "fd-trends-layout",
    });
}

function rangePanel(
    range: TrendsRange,
    data: TrendsPageData,
    visible: boolean,
): Html {
    const hidden = visible ? "" : " hidden";
    return raw(
        `<div class="fd-trends-panel" data-fd-trends-panel="${range}"${hidden}>${rangePanelBody(data.views[String(range)]!, data)}</div>`,
    );
}

/** The range as text tabs: links, so no script still works; the script flips them in place. */
function rangeTabs(data: TrendsPageData): Html {
    return tabs({
        label: "Trends range in days",
        className: "fd-trends-range",
        tabs: TRENDS_RANGES.map((range) => {
            const q = new URLSearchParams({ range: String(range) });
            if (data.memberQuery) q.set("member", data.memberQuery);
            return {
                label: `${range} days`,
                href: `/trends?${q.toString()}`,
                active: range === data.defaultRange,
                className: range === 365 ? "fd-trends-tab--desktop" : undefined,
                data: { "fd-trends-range": String(range) },
            };
        }),
    });
}

export function renderTrendsBody(data: TrendsPageData): Html {
    const header = pageHeader({
        title: "Trends",
        subtitle: trendsRangeSubtitle(data.defaultRange),
        className: "fd-trends-header",
    });
    const subject =
        data.chrome.subjectLabel != null
            ? `<p class="fd-trends-subject" role="status">${esc(`Viewing ${data.chrome.subjectLabel}`)}</p>`
            : "";
    const body = data.empty
        ? String(emptyState({ title: "Log meals to see trends here." }))
        : `<div class="fd-trends-panels">${TRENDS_RANGES.map((range) =>
              rangePanel(range, data, range === data.defaultRange),
          ).join("")}</div>`;
    return raw(
        `<div class="fd-trends-page" data-fd-trends-root data-fd-trends-active="${data.defaultRange}">${header}${subject}${rangeTabs(data)}${body}</div>`,
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
    const defaultRange = opts?.range ?? DEFAULT_TRENDS_RANGE;
    const { views } = buildTrendsViews(
        days,
        goalsByDay,
        weights,
        today,
        weightUnit,
    );
    const year = views["365"]!;
    return {
        chrome,
        defaultRange,
        today,
        views,
        memberQuery: opts?.member,
        empty: year.tiles.loggedDays === 0 && weights.length === 0,
    };
}
