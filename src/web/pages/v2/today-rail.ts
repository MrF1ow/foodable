import type { WeightEntry } from "../../../db/nutrition.js";
import type { FridgeItem } from "../../../domain/fridge.js";
import type { Notice } from "../../../domain/notices.js";
import { panelGroupKey } from "../../../domain/notices-for.js";
import {
    daysUntilExpiry,
    expiryLevel,
    type ExpiryLevel,
} from "../../../domain/stock.js";
import {
    formatWeight,
    fromGrams,
    type WeightUnit,
} from "../../../domain/units.js";
import { formatQuantityDisplayParts } from "../../display-quantity.js";
import {
    noticeHref,
    type NoticeRouteContext,
} from "../../components/notices.js";
import {
    noticeActionFor,
    noticeDismissPair,
    noticeSentence,
} from "../../../copy/notices.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { sparklineSvg } from "../../components/v2/sparkline.js";
import type { TodayView, TodayWeightPoint } from "../../loaders-today.js";
import { FD_LOG_HREF } from "../../shell-v2.js";
import { FD_LOG_WEIGH_IN_SHEET_ID } from "./log-sheet.js";
import { renderWeekMissingLine, renderWeekRows } from "./recipes-plan.js";
import type { TodayPageData } from "./today.js";

function isReadOnlyPeer(data: TodayPageData): boolean {
    return data.chrome.subjectLabel != null;
}

function cardHeader(
    title: string,
    opts?: { count?: number; action?: { href: string; label: string } },
): string {
    const count =
        opts?.count != null && opts.count > 0
            ? `<span class="fd-today-card__count">${esc(String(opts.count))}</span>`
            : "";
    const action = opts?.action
        ? `<a class="fd-today-card__action" href="${esc(opts.action.href)}">${esc(opts.action.label)}</a>`
        : "";
    return `<header class="fd-today-card__head"><h2 class="fd-today-card__title">${esc(title)}</h2>${count}${action}</header>`;
}

function railCard(title: string, body: string, headExtra?: string): string {
    const head = headExtra ?? cardHeader(title);
    return `<section class="fd-today-card" aria-label="${esc(title)}">${head}<div class="fd-today-card__body">${body}</div></section>`;
}

export function railNoticesListed(notices: readonly Notice[]): Notice[] {
    const seen = new Set<string>();
    const out: Notice[] = [];
    for (const notice of notices) {
        const sentence = noticeSentence(notice);
        const dedupeKey = noticeDismissPair(notice.code)
            ? `${notice.code}|${notice.subject.id}|${notice.related.map((r) => r.id).join(",")}`
            : sentence;
        // Same scope as the Needs attention page: identical sentences fold
        // only within one panel group, never across groups.
        const scopedKey = `${panelGroupKey(notice)}|${dedupeKey}`;
        if (seen.has(scopedKey)) continue;
        seen.add(scopedKey);
        out.push(notice);
    }
    return out;
}

export function expiryToneClass(level: ExpiryLevel): string {
    if (level === "expired" || level === "high")
        return "fd-today-rail-row__when--high";
    if (level === "medium") return "fd-today-rail-row__when--medium";
    return "fd-today-rail-row__when--low";
}

function dotToneClass(level: ExpiryLevel): string {
    if (level === "expired" || level === "high")
        return "fd-today-rail-dot--high";
    if (level === "medium") return "fd-today-rail-dot--medium";
    return "fd-today-rail-dot--low";
}

export function formatExpiryWhen(today: string, expiresOn: string): string {
    const days = daysUntilExpiry(today, expiresOn);
    if (days < 0) return "Expired";
    if (days === 1) return "Tomorrow";
    if (days === 0) return "Today";
    if (days <= 7) return `${days} days`;
    return expiresOn;
}

function noticeDotClass(notice: Notice): string {
    if (notice.severity === "block") {
        return "fd-today-rail-dot--high";
    }
    if (notice.severity === "warn") return "fd-today-rail-dot--medium";
    return "fd-today-rail-dot--low";
}

function noticeActionLink(
    notice: Notice,
    foods: TodayView["attention"]["noticeFoods"],
): string {
    const ctx: NoticeRouteContext = { from: "/", foods };
    const action = noticeActionFor(notice);
    if (!action) return "";
    const href = noticeHref(notice, ctx);
    if (href == null) return "";
    if (action.method === "post") {
        return `<form class="fd-today-rail-row__action-form" method="post" action="${esc(href)}"><input type="hidden" name="from" value="/" /><button type="submit" class="fd-today-rail-row__action">${esc(action.label)}</button></form>`;
    }
    return `<a class="fd-today-rail-row__action" href="${esc(href)}">${esc(action.label)}</a>`;
}

function railRow(opts: {
    dotClass: string;
    title: string;
    meta?: string;
    when?: string;
    whenClass?: string;
    href?: string;
    trail?: string;
    /** Markup under the row, inside the same list item (a second line). */
    below?: string;
}): string {
    const dot = `<span class="fd-today-rail-dot ${opts.dotClass}" aria-hidden="true"></span>`;
    const meta = opts.meta
        ? `<span class="fd-today-rail-row__meta">${esc(opts.meta)}</span>`
        : "";
    const when = opts.when
        ? `<span class="fd-today-rail-row__when${opts.whenClass ? ` ${opts.whenClass}` : ""}">${esc(opts.when)}</span>`
        : "";
    const trail = opts.trail ?? "";
    const inner = `<span class="fd-today-rail-row__main">${dot}<span class="fd-today-rail-row__title">${esc(opts.title)}</span>${meta}</span>${when}${trail}`;
    if (opts.href) {
        const below = opts.below ?? "";
        const cls = below
            ? "fd-today-rail-row fd-today-rail-row--with-use"
            : "fd-today-rail-row";
        return `<li class="${cls}"><a class="fd-today-rail-row__link" href="${esc(opts.href)}">${inner}</a>${below}</li>`;
    }
    return `<li class="fd-today-rail-row">${inner}</li>`;
}

function quantityLabel(item: FridgeItem): string {
    return formatQuantityDisplayParts(item.quantity.amount, item.quantity.unit);
}

function fridgeLocationLabel(view: TodayView, locationId: string): string {
    return view.fridgeLocationNames.get(locationId) ?? "";
}

/** "Use in: Salmon & rice", a link to the recipe; empty when none uses the item. */
export function useInLine(
    recipe: { recipeId: string; name: string } | undefined,
): string {
    if (!recipe) return "";
    return `<a class="fd-today-rail-row__use" href="/recipes/${esc(recipe.recipeId)}">Use in: ${esc(recipe.name)}</a>`;
}

function usesAllLabel(itemCount: number, totalItems: number): string {
    if (itemCount < totalItems) return `Uses ${itemCount} of ${totalItems}`;
    if (totalItems === 2) return "Uses both";
    if (totalItems === 3) return "Uses all three";
    return `Uses all ${totalItems}`;
}

function useSoonHighlightMarkup(view: TodayView): string {
    const hit = view.useSoonHighlight;
    if (!hit) return "";
    const facts = [
        hit.minutes != null ? `${hit.minutes} min` : "",
        hit.kcalPerPortion != null
            ? `${Math.round(hit.kcalPerPortion)} kcal per serving`
            : "",
    ].filter(Boolean);
    const meta = facts.length
        ? `<p class="fd-today-useall__meta">${esc(facts.join(" · "))}</p>`
        : "";
    return `<div class="fd-today-useall"><p class="fd-today-useall__eyebrow">${esc(usesAllLabel(hit.itemCount, hit.totalItems))}</p><p class="fd-today-useall__name">${esc(hit.name)}</p>${meta}<a class="fd-today-useall__cook" href="/recipes/${esc(hit.recipeId)}#fd-recipe-cook-heading">Cook it</a></div>`;
}

function useSoonMarkup(view: TodayView): string {
    const items = view.expiringFridge;
    if (items.length === 0) {
        return `<p class="fd-today-card__empty">Nothing expiring soon</p>`;
    }
    const expiryToday = view.householdDate;
    const usesByItem = new Map(
        (view.useSoonUses ?? []).map((use) => [use.item.id, use.recipes[0]]),
    );
    const rows = items
        .map((item) => {
            const expiresOn = item.expiresOn ?? "";
            const level = expiryLevel(expiresOn, expiryToday) ?? "medium";
            const place = fridgeLocationLabel(view, item.locationId);
            return railRow({
                dotClass: dotToneClass(level),
                title: item.displayName,
                meta: place || undefined,
                when: formatExpiryWhen(expiryToday, expiresOn),
                whenClass: expiryToneClass(level),
                href: "/kitchen/fridge",
                below: useInLine(usesByItem.get(item.id)),
            });
        })
        .join("");
    const head = cardHeader("Use soon", { count: items.length });
    return `<section class="fd-today-card" aria-label="Use soon">${head}<ul class="fd-today-rail-list">${rows}</ul>${useSoonHighlightMarkup(view)}</section>`;
}

function attentionMarkup(view: TodayView): string {
    const { count, notices, noticeFoods } = view.attention;
    const listed = railNoticesListed(notices);
    if (listed.length === 0) {
        return railCard(
            "Needs attention",
            `<p class="fd-today-card__empty">Nothing needs attention</p>`,
        );
    }
    const rows = listed
        .map((notice) => {
            const trail = noticeActionLink(notice, noticeFoods);
            return railRow({
                dotClass: noticeDotClass(notice),
                title: noticeSentence(notice),
                trail,
            });
        })
        .join("");
    const head = cardHeader("Needs attention", {
        count,
        action: { href: "/needs-attention", label: "View all" },
    });
    return `<section class="fd-today-card" aria-label="Needs attention">${head}<ul class="fd-today-rail-list">${rows}</ul></section>`;
}

function thisWeekMarkup(data: TodayPageData): string {
    const head = cardHeader("This week", {
        action: { href: "/recipes", label: "Recipes" },
    });
    const body = data.plan
        ? `${renderWeekRows(data.plan)}${renderWeekMissingLine(data.plan)}`
        : `<p class="fd-today-week-empty">Nothing planned</p>`;
    return `<section class="fd-today-card" aria-label="This week">${head}${body}</section>`;
}

export function weightChange30d(
    series: readonly TodayWeightPoint[],
    unit: WeightUnit,
): number | null {
    if (series.length < 2) return null;
    const first = series[0]!.weight_g;
    const last = series[series.length - 1]!.weight_g;
    return fromGrams(last - first, unit);
}

function formatWeightChange(change: number, unit: WeightUnit): string {
    const abs = Math.abs(change);
    const rounded = Math.round(abs * 10) / 10;
    const signed =
        change > 0
            ? `↑ ${rounded.toFixed(1)}`
            : change < 0
              ? `↓ ${rounded.toFixed(1)}`
              : "—";
    return `${signed} this month`;
}

function formatWeighInDate(loggedAt: string, tz: string): string {
    const date = new Date(loggedAt);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: tz,
    });
}

function weightMarkup(view: TodayView, readOnly: boolean): string {
    const unit = view.preferredWeightUnit;
    const { latest, series30d } = view.weight;
    const weighIn = readOnly
        ? ""
        : `<a class="fd-today-card__action" href="${esc(FD_LOG_HREF)}" data-fd-open-sheet="${FD_LOG_WEIGH_IN_SHEET_ID}">Weigh in</a>`;
    const head = `<header class="fd-today-card__head"><h2 class="fd-today-card__title">Weight</h2>${weighIn}</header>`;

    if (latest == null && series30d.length === 0) {
        return `<section class="fd-today-card" aria-label="Weight">${head}<p class="fd-today-card__empty">No weigh-ins yet</p></section>`;
    }

    const values = series30d.map((p) => fromGrams(p.weight_g, unit));
    const chart = sparklineSvg(values, {
        width: 312,
        height: 64,
        padY: 10,
        className: "fd-today-weight__chart",
    });
    const latestVal = latest
        ? fromGrams(latest.weight_g, unit)
        : values[values.length - 1];
    const hero = latestVal != null ? String(latestVal) : "—";
    const unitLabel = unit;
    const change = weightChange30d(series30d, unit);
    const changeHtml =
        change != null && Number.isFinite(change)
            ? `<span class="fd-today-weight__change">${esc(formatWeightChange(change, unit))}</span>`
            : "";
    const dateHtml =
        latest != null
            ? `<p class="fd-today-weight__date">${esc(formatWeighInDate(latest.logged_at, view.timezone))}</p>`
            : "";
    const body = `<div class="fd-today-weight__hero-row"><span class="fd-today-weight__hero">${esc(hero)}</span><span class="fd-today-weight__unit">${esc(unitLabel)}</span>${changeHtml}</div>${dateHtml}${chart}`;
    return `<section class="fd-today-card fd-today-card--weight" aria-label="Weight">${head}${body}</section>`;
}

export function renderTodayRail(data: TodayPageData): Html {
    const { view } = data;
    const readOnly = isReadOnlyPeer(data);
    if (readOnly) {
        return raw(
            `<aside class="fd-today-rail" aria-label="Day sidebar">${weightMarkup(view, true)}</aside>`,
        );
    }
    return raw(
        `<aside class="fd-today-rail" aria-label="Day sidebar">${useSoonMarkup(view)}${attentionMarkup(view)}${thisWeekMarkup(data)}${weightMarkup(view, false)}</aside>`,
    );
}

export function formatLatestWeight(
    latest: WeightEntry | null,
    unit: WeightUnit,
): string {
    if (latest == null) return "—";
    return formatWeight(latest.weight_g, unit);
}
