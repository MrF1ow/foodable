/**
 * The one-tap notices (a usual running low, what a planned recipe is missing,
 * a weigh-in that is due) as the new app shows them in place: a short list of
 * rows, each a sentence from the notice registry with its action and a
 * dismiss. The desktop Today "Needs attention" card renders the same notices
 * as its own rail rows and uses `noticeActionControl` for the action.
 *
 * FigCraft Desktop › Today (dark 41837, light 50720) has the card with the
 * three actions as plain accent text at the end of the row ("Add to list",
 * "Add", "Weigh in"). The design has no in-place strip on Kitchen, Recipes or
 * the phone Today; these reuse the card's row (dot, sentence, accent action).
 */
import { noticeActionFor, noticeSentence } from "../../../copy/notices.js";
import { dismissalKey } from "../../../domain/notice-dismissals.js";
import type { Notice, NoticeCode } from "../../../domain/notices.js";
import {
    noticeActPath,
    NOTICE_DISMISS_PATH,
    noticeHref,
    type NoticeRouteContext,
} from "../../components/notices.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { FD_LOG_WEIGH_IN_SHEET_ID } from "./log-sheet.js";

/** The pages an action or a dismissal may send the person back to. */
export const NOTICE_BACK_PATHS = [
    "/",
    "/kitchen/usuals",
    "/kitchen/fridge",
    "/recipes",
    "/needs-attention",
] as const;
export type NoticeBack =
    (typeof NOTICE_BACK_PATHS)[number] | `/?date=${string}`;

/**
 * A path from a form, if it is one of ours; never an address taken from the
 * request. Today may carry the day it is showing (`/?date=YYYY-MM-DD`, a real
 * calendar date and nothing else), so acting from another day returns there.
 */
export function parseNoticeBack(value: string | undefined): NoticeBack {
    const known = NOTICE_BACK_PATHS.find((path) => path === value);
    if (known) return known;
    const day = /^\/\?date=(\d{4}-\d{2}-\d{2})$/.exec(value ?? "")?.[1];
    return day && isCalendarDate(day) ? `/?date=${day}` : "/";
}

function isCalendarDate(value: string): boolean {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === value
    );
}

export { noticeActPath, NOTICE_DISMISS_PATH };

/** The notices this app acts on and dismisses in place. */
export const ONE_TAP_NOTICE_CODES = [
    "grocery.running_low",
    "plan.missing_ingredient",
    "nutrition.weigh_in_due",
] as const satisfies readonly NoticeCode[];

export function isOneTapNotice(notice: Notice): boolean {
    return (ONE_TAP_NOTICE_CODES as readonly string[]).includes(notice.code);
}

/** Where Today sends an action back to: the day it is showing, or plain Today. */
export function todayNoticeBack(view: {
    date: string;
    householdDate: string;
}): NoticeBack {
    return view.date === view.householdDate ? "/" : `/?date=${view.date}`;
}

/**
 * The notices of `codes` a viewer can act on here. A weigh-in reminder is kept
 * only for the viewer: the sheet logs their own weight.
 */
export function stripNotices(
    notices: readonly Notice[],
    codes: readonly NoticeCode[],
    viewerUserId: string | undefined,
): Notice[] {
    return notices.filter(
        (notice) =>
            codes.includes(notice.code) &&
            (notice.code !== "nutrition.weigh_in_due" ||
                (viewerUserId != null && notice.subject.id === viewerUserId)),
    );
}

function hidden(name: string, value: string): string {
    return `<input type="hidden" name="${esc(name)}" value="${esc(value)}" />`;
}

/**
 * The action of a notice: a one-tap POST (a button in its own form), or the
 * weigh-in link that opens the weigh-in sheet. Empty when the notice has no
 * action for this viewer.
 */
export function noticeActionControl(
    notice: Notice,
    ctx: NoticeRouteContext,
    back: NoticeBack,
    classes: { button: string; form?: string },
): string {
    const action = noticeActionFor(notice);
    if (!action) return "";
    const href = noticeHref(notice, ctx);
    if (href == null) return "";
    if (action.method === "get") {
        return `<a class="${esc(classes.button)}" href="${esc(href)}" data-fd-open-sheet="${FD_LOG_WEIGH_IN_SHEET_ID}">${esc(action.label)}</a>`;
    }
    const formClass = classes.form ? ` class="${esc(classes.form)}"` : "";
    return `<form${formClass} method="post" action="${esc(href)}">${hidden("subject_id", notice.subject.id)}${hidden("back", back)}<button type="submit" class="${esc(classes.button)}">${esc(action.label)}</button></form>`;
}

/** Dismiss in place: posts the notice's own key and comes back to the same page. */
export function noticeDismissControl(
    notice: Notice,
    back: NoticeBack,
    /** Extra class on the button, for a host that sizes it itself. */
    buttonClass = "",
): string {
    const key = dismissalKey(notice);
    const extra = buttonClass ? ` ${esc(buttonClass)}` : "";
    return `<form class="fd-notice-strip__dismiss-form" method="post" action="${NOTICE_DISMISS_PATH}">${hidden("code", key.code)}${hidden("subject_kind", key.subjectKind)}${hidden("subject_id", key.subjectId)}${hidden("related_id", key.relatedKey)}${hidden("back", back)}<button type="submit" class="fd-notice-strip__dismiss${extra}" aria-label="Dismiss: ${esc(noticeSentence(notice))}" title="Dismiss">&times;</button></form>`;
}

function dotClass(notice: Notice): string {
    return notice.severity === "warn"
        ? "fd-notice-strip__dot fd-notice-strip__dot--warn"
        : "fd-notice-strip__dot";
}

/**
 * The rows of `notices` (already filtered to what belongs on the page). Empty
 * markup when there are none, so a page with nothing to say shows nothing.
 */
export function noticeStrip(
    notices: readonly Notice[],
    opts: {
        back: NoticeBack;
        viewerUserId?: string;
        label: string;
        className?: string;
    },
): Html {
    if (notices.length === 0) return raw("");
    const ctx: NoticeRouteContext = {
        from: opts.back,
        foods: new Map(),
        v2: { viewerUserId: opts.viewerUserId },
    };
    const rows = notices
        .map((notice) => {
            const action = noticeActionControl(notice, ctx, opts.back, {
                button: "fd-notice-strip__action",
                form: "fd-notice-strip__action-form",
            });
            return `<li class="fd-notice-strip__row" data-notice="${esc(notice.code)}"><span class="${dotClass(notice)}" aria-hidden="true"></span><span class="fd-notice-strip__text">${esc(noticeSentence(notice))}</span>${action}${noticeDismissControl(notice, opts.back)}</li>`;
        })
        .join("");
    const extra = opts.className ? ` ${esc(opts.className)}` : "";
    return raw(
        `<section class="fd-notice-strip${extra}" aria-label="${esc(opts.label)}"><ul class="fd-notice-strip__list">${rows}</ul></section>`,
    );
}
