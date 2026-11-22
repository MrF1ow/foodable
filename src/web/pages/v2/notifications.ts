/**
 * The Notifications inbox (FigCraft Screens › Notifications and Desktop ›
 * Notifications): a Detail bar, All / Just me / Household, then TODAY, EARLIER
 * and SNOOZED lists of Item rows, each with a ⋯ menu. A member's menu offers
 * Open, the two Snoozes, Dismiss and Turn off "<kind>"; an admin or owner sees Dismiss
 * for me and Dismiss for everyone on a household row; an Allergens row offers
 * only Open, since it cannot be dismissed or snoozed.
 *
 * Built from the phase 1 components only. Every action is a POST form in the
 * menu; the routes answer 303 back here.
 */
import { NOTICE_COPY, noticeSentence } from "../../../copy/notices.js";
import {
    NOTIFICATIONS_PAGE as COPY,
    NOTIFICATION_AGO,
    NOTIFICATION_EVENT_TITLES,
    NOTIFICATION_BUCKET_LABELS,
    NOTIFICATION_KIND_AREAS,
    NOTIFICATION_KIND_LABELS,
    NOTIFICATION_TITLES,
} from "../../../copy/notifications.js";
import { NOTICE_CODES, NOTICE_SEVERITY } from "../../../domain/notices.js";
import type { Notice, NoticeCode } from "../../../domain/notices.js";
import { NOTIFICATION_KINDS } from "../../../domain/notification-kinds.js";
import type { Inbox, NotificationRow } from "../../../domain/notifications.js";
import { dateInTz, shiftLocalDate } from "../../../domain/tz.js";
import type { AppChromeBase } from "../../attention.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { emptyState } from "../../components/v2/empty-state.js";
import { cls, esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu, type MenuItem } from "../../components/v2/menu.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import { APP_PATHS } from "../../route-map.js";
import { renderAppShell } from "../../shell.js";

export type InboxBucket = "all" | "personal" | "household";

export const NOTIFICATIONS_PATH = APP_PATHS.notifications;
export const NOTIFICATIONS_SETTINGS_ACTION = APP_PATHS.settingsNotifications;

export function parseInboxBucket(value: string | undefined): InboxBucket {
    return value === "personal" || value === "household" ? value : "all";
}

/** The inbox's address for a filter: the default (All) has none. */
export function inboxHref(bucket: InboxBucket): string {
    return bucket === "all"
        ? NOTIFICATIONS_PATH
        : `${NOTIFICATIONS_PATH}?bucket=${bucket}`;
}

export type NotificationsPageView = {
    chrome: AppChromeBase;
    inbox: Inbox;
    bucket: InboxBucket;
    /** Whether the viewer may dismiss a household row for everyone (an admin
     * or the owner). */
    canDismissEveryone: boolean;
    /** IANA zone the "Back …" time of a snoozed row is told in. */
    timezone: string;
    now: Date;
    /** Member display names by user id, for the "Sarah removed …" rows. A
     * missing or removed member reads "Someone". */
    memberNames?: ReadonlyMap<string, string>;
    /** A refused action, said in place. */
    error?: string;
};

const isNoticeCode = (value: unknown): value is NoticeCode =>
    typeof value === "string" &&
    (NOTICE_CODES as readonly string[]).includes(value);

/** A condition row's notice, rebuilt from the payload it stored. */
function noticeOf(row: NotificationRow): Notice | null {
    const code = row.payload.code;
    if (row.source !== "condition" || !isNoticeCode(code)) return null;
    if (!(code in NOTICE_COPY)) return null;
    const params = row.payload.params;
    const related = row.payload.related;
    return {
        code,
        severity: NOTICE_SEVERITY[code],
        subject: {
            kind: row.subjectKind ?? "food",
            id: row.subjectId ?? "",
        } as Notice["subject"],
        related: Array.isArray(related) ? (related as Notice["related"]) : [],
        params:
            params !== null && typeof params === "object"
                ? (params as Notice["params"])
                : {},
    };
}

const DAY_MS = 86_400_000;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days from the local date `from` to `to` (both YYYY-MM-DD). */
function daysBetween(from: string, to: string): number {
    return Math.round(
        (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
            DAY_MS,
    );
}

/** The short, relative title of a condition the design words ("Greek yogurt
 * expires tomorrow", "Milk is running low", "Weigh-in due"); null for any
 * other notice, which reads as its full sentence. */
function shortTitle(
    notice: Notice,
    ctx: { now: Date; timezone: string },
): string | null {
    const name =
        typeof notice.params.name === "string" ? notice.params.name : "";
    switch (notice.code) {
        case "fridge.expired":
            return name ? NOTIFICATION_TITLES.expired(name) : null;
        case "fridge.expiring": {
            const on = notice.params.expiresOn;
            if (!name || typeof on !== "string" || !LOCAL_DATE.test(on)) {
                return null;
            }
            return NOTIFICATION_TITLES.expires(
                name,
                daysBetween(dateInTz(ctx.now, ctx.timezone), on),
            );
        }
        case "grocery.running_low":
            return name ? NOTIFICATION_TITLES.runningLow(name) : null;
        case "nutrition.weigh_in_due":
            return NOTIFICATION_TITLES.weighInDue;
        default:
            return null;
    }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
] as const;

/** A short date in the design's words, from `today` in the household's zone:
 * "today", "tomorrow", a weekday for the days after, else "Mon 30 Nov". */
function dayText(date: string, today: string): string {
    const ahead = daysBetween(today, date);
    if (ahead === 0) return "today";
    if (ahead === 1) return "tomorrow";
    const at = new Date(`${date}T00:00:00Z`);
    const weekday = WEEKDAYS[at.getUTCDay()]!;
    if (ahead >= 2 && ahead <= 6) return weekday;
    return `${weekday} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;

/** An event row's sentence, or null when its payload lacks what the sentence
 * needs (the caller then shows the kind's name). */
function eventTitle(
    row: NotificationRow,
    ctx: {
        now: Date;
        timezone: string;
        memberNames?: ReadonlyMap<string, string>;
    },
): string | null {
    const p = row.payload;
    const who =
        (row.actorUserId
            ? text(ctx.memberNames?.get(row.actorUserId))
            : null) ?? NOTIFICATION_EVENT_TITLES.someone;
    switch (row.kind) {
        case "recipe_changes": {
            const recipe = text(p.recipeName);
            return recipe
                ? NOTIFICATION_EVENT_TITLES.recipeRemoved(who, recipe)
                : null;
        }
        case "week_plan_changes": {
            const recipe = text(p.recipeName);
            if (!recipe) return null;
            if (p.change === "unplanned") {
                return NOTIFICATION_EVENT_TITLES.unplanned(who, recipe);
            }
            const date = p.date;
            if (typeof date !== "string" || !LOCAL_DATE.test(date)) return null;
            const day = dayText(date, dateInTz(ctx.now, ctx.timezone));
            if (p.change === "planned") {
                return NOTIFICATION_EVENT_TITLES.planned(who, recipe, day);
            }
            if (p.change === "moved") {
                return NOTIFICATION_EVENT_TITLES.moved(who, recipe, day);
            }
            return null;
        }
        case "new_usuals": {
            const food = text(p.foodName);
            return food ? NOTIFICATION_EVENT_TITLES.newUsual(who, food) : null;
        }
        default:
            return null;
    }
}

/** What a row says: a condition the design words, short and relative to
 * today; any other condition its notice's sentence; an event who did what; and
 * whatever does not read (an older payload) the kind's name. */
export function notificationTitle(
    row: NotificationRow,
    ctx: {
        now: Date;
        timezone: string;
        memberNames?: ReadonlyMap<string, string>;
    },
): string {
    if (row.source === "event") {
        const sentence = eventTitle(row, ctx);
        if (sentence) return sentence;
        return NOTIFICATION_KIND_LABELS[row.kind];
    }
    const notice = noticeOf(row);
    if (notice) {
        try {
            return shortTitle(notice, ctx) ?? noticeSentence(notice);
        } catch {
            // A payload from an older shape: fall back to the kind.
        }
    }
    return NOTIFICATION_KIND_LABELS[row.kind];
}

/** Where Open goes: the part of the app the notification is about. */
export function notificationOpenHref(row: NotificationRow): string {
    const code = row.payload.code;
    switch (row.kind) {
        case "allergens":
            if (code === "recipe.allergen" && row.subjectKind === "recipe") {
                return `/recipes/${encodeURIComponent(row.subjectId ?? "")}`;
            }
            if (code === "food.product_allergen" && row.subjectId) {
                return `${APP_PATHS.product}/${encodeURIComponent(row.subjectId)}`;
            }
            return APP_PATHS.kitchenGroceries;
        case "food_expiring":
            return APP_PATHS.kitchenFridge;
        case "running_low":
            return APP_PATHS.kitchenGroceries;
        case "weigh_in_due":
            return APP_PATHS.nutrition;
        case "recipe_changes":
        case "week_plan_changes":
            return APP_PATHS.recipes;
        case "new_usuals":
            return APP_PATHS.kitchenUsuals;
    }
}

const pad2 = (n: string): string => n.padStart(2, "0");

/** "tomorrow 9:00", "today 17:30" or "Mon 30 Nov 9:00": when a snooze ends,
 * in the household's zone. */
export function backAtText(until: string, now: Date, timezone: string): string {
    const at = new Date(until);
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
    }).formatToParts(at);
    const part = (type: string) =>
        parts.find((p) => p.type === type)?.value ?? "";
    const clock = `${Number(part("hour"))}:${pad2(part("minute"))}`;
    const day = dateInTz(at, timezone);
    const today = dateInTz(now, timezone);
    if (day === today) return `today ${clock}`;
    if (day === shiftLocalDate(today, 1)) return `tomorrow ${clock}`;
    return `${part("weekday")} ${part("day")} ${part("month")} ${clock}`;
}

/** "just now", "12 min ago", "2 h ago", "yesterday", "3 days ago", then a
 * date: how long ago an event row happened. */
export function agoText(
    createdAt: string,
    now: Date,
    timezone: string,
): string {
    const at = new Date(createdAt);
    const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
    if (!Number.isFinite(minutes) || minutes < 1)
        return NOTIFICATION_AGO.justNow;
    if (minutes < 60) return NOTIFICATION_AGO.minutes(minutes);
    if (minutes < 24 * 60)
        return NOTIFICATION_AGO.hours(Math.floor(minutes / 60));
    const days = daysBetween(dateInTz(at, timezone), dateInTz(now, timezone));
    if (days <= 1) return NOTIFICATION_AGO.yesterday;
    if (days <= 6) return NOTIFICATION_AGO.days(days);
    const when = new Date(`${dateInTz(at, timezone)}T00:00:00Z`);
    return `${when.getUTCDate()} ${MONTHS[when.getUTCMonth()]}`;
}

function subtitleOf(
    row: NotificationRow,
    view: Pick<NotificationsPageView, "now" | "timezone">,
    snoozed: boolean,
): string {
    const who = NOTIFICATION_BUCKET_LABELS[row.bucket];
    if (snoozed && row.snoozedUntil) {
        return `Back ${backAtText(row.snoozedUntil, view.now, view.timezone)} · ${who}`;
    }
    const area = `${NOTIFICATION_KIND_AREAS[row.kind]} · ${who}`;
    // An event says how long ago it happened, as the design's row does.
    return row.source === "event"
        ? `${agoText(row.createdAt, view.now, view.timezone)} · ${area}`
        : area;
}

/** The ⋯ menu of one row, by what the viewer may do with it. */
export function notificationMenuItems(
    row: NotificationRow,
    opts: { canDismissEveryone: boolean; bucket: InboxBucket },
): MenuItem[] {
    const open: MenuItem = {
        kind: "link",
        label: COPY.open,
        href: notificationOpenHref(row),
    };
    // Allergens are always on and never put away: fix the cause instead.
    if (!NOTIFICATION_KINDS[row.kind].canDisable) return [open];
    const back: Record<string, string> =
        opts.bucket === "all" ? {} : { bucket: opts.bucket };
    const id = encodeURIComponent(row.id);
    const snooze = (until: "tomorrow" | "week", label: string): MenuItem => ({
        kind: "post",
        label,
        action: `${NOTIFICATIONS_PATH}/${id}/snooze`,
        fields: { until, ...back },
    });
    const dismiss = (scope: "me" | "everyone", label: string): MenuItem => ({
        kind: "post",
        label,
        action: `${NOTIFICATIONS_PATH}/${id}/dismiss`,
        fields: { scope, ...back },
    });
    const dismissals: MenuItem[] =
        opts.canDismissEveryone && row.bucket === "household"
            ? [
                  dismiss("me", COPY.dismissForMe),
                  dismiss("everyone", COPY.dismissForEveryone),
              ]
            : [dismiss("me", COPY.dismiss)];
    return [
        open,
        snooze("tomorrow", COPY.snoozeTomorrow),
        snooze("week", COPY.snoozeWeek),
        ...dismissals,
        {
            kind: "post",
            label: COPY.turnOff(NOTIFICATION_KIND_LABELS[row.kind]),
            action: NOTIFICATIONS_SETTINGS_ACTION,
            fields: { kind: row.kind, enabled: "false", ...back },
        },
    ];
}

function rowOf(
    row: NotificationRow,
    view: NotificationsPageView,
    snoozed: boolean,
): Html {
    const title = notificationTitle(row, view);
    return itemRow({
        id: `notification-${row.id}`,
        title,
        subtitle: subtitleOf(row, view, snoozed),
        trailing: {
            kind: "control",
            html: menu({
                label: COPY.actionsFor(title),
                anchor: "more",
                items: notificationMenuItems(row, view),
            }),
        },
    });
}

function section(
    label: string,
    rows: readonly NotificationRow[],
    view: NotificationsPageView,
    snoozed = false,
): Html {
    if (rows.length === 0) return raw("");
    return raw(
        `<section class="fd-notifications__section" aria-label="${esc(label)}">${sectionHeader({ label, rule: false })}${listGroup({ rows: rows.map((r) => rowOf(r, view, snoozed)) })}</section>`,
    );
}

/** All / Just me / Household. Links, so the filter is a plain address with no
 * script behind it; it is drawn with the Segmented's own classes. Never
 * prefetched: a prefetched inbox marks nothing read, and a click soon after
 * would reuse it and leave the dot on. */
function bucketFilter(bucket: InboxBucket): Html {
    const choices: readonly { value: InboxBucket; label: string }[] = [
        { value: "all", label: COPY.filterAll },
        { value: "personal", label: COPY.filterPersonal },
        { value: "household", label: COPY.filterHousehold },
    ];
    const links = choices.map((c) => {
        const on = c.value === bucket;
        return `<a class="${cls("fd-segmented__segment", on && "fd-segmented__segment--selected")}" href="${esc(inboxHref(c.value))}"${on ? ' aria-current="page"' : ""}>${esc(c.label)}</a>`;
    });
    return raw(
        `<nav class="fd-segmented fd-segmented--regular fd-notifications__filter" aria-label="${esc(COPY.filterLabel)}" data-turbo-prefetch="false">${links.join("")}</nav>`,
    );
}

export function renderNotificationsBody(view: NotificationsPageView): string {
    const { today, earlier, snoozed } = view.inbox;
    const empty = today.length + earlier.length + snoozed.length === 0;
    const error = view.error
        ? `<p class="fd-notifications__error" role="alert">${esc(view.error)}</p>`
        : "";
    const content = join([
        bucketFilter(view.bucket),
        error,
        empty
            ? emptyState({ title: COPY.emptyTitle, body: COPY.emptyBody })
            : join([
                  section(COPY.today, today, view),
                  section(COPY.earlier, earlier, view),
                  section(COPY.snoozed, snoozed, view, true),
              ]),
    ]);
    return String(
        pageLayout({
            layout: "single",
            className: "fd-notifications",
            header: detailBar({
                title: COPY.title,
                back: { label: COPY.back, href: APP_PATHS.nutrition },
                balance: true,
            }),
            content,
        }),
    );
}

export function renderNotificationsPage(view: NotificationsPageView): string {
    return renderAppShell({
        ...view.chrome,
        title: COPY.title,
        active: "none",
        v2Active: "none",
        v2Detail: true,
        body: renderNotificationsBody(view),
    });
}
