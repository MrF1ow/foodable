import type { Food } from "../../domain/foods.js";
import type { Notice } from "../../domain/notices.js";
import type { NoticeRoute } from "../../copy/notices.js";
import {
    noticeActionFor,
    noticeDismissLabel,
    noticeDismissPair,
    noticeSentence,
} from "../../copy/notices.js";
import { normalizePairIds } from "../../domain/notice-dismissals.js";
import { escapeHtml } from "../shell.js";
import { FD_LOG_HREF } from "../shell-v2.js";
import {
    plainFoodIdForUsualPicker,
    usualProductsPickerHref,
} from "../usual-products-path.js";

export type NoticeRouteContext = {
    from: string;
    foods: ReadonlyMap<string, Pick<Food, "genericFoodId">>;
    /**
     * Set by the new app's pages, the only ones that act on running low,
     * missing for the plan and weigh-in due. The weigh-in sheet is the
     * viewer's own, so a reminder about another member has no action.
     */
    v2?: { viewerUserId?: string };
};

/** Where the one-tap action of a notice code posts to. */
export function noticeActPath(code: string): string {
    return `/notices/${encodeURIComponent(code)}/act`;
}

/** Where dismissing a one-tap notice posts to. */
export const NOTICE_DISMISS_PATH = "/notices/dismiss";

export const NOTICE_ROUTES: Record<
    NoticeRoute,
    (notice: Notice, ctx: NoticeRouteContext) => string | null
> = {
    usualProductPicker(notice, ctx) {
        const foodIdParam = notice.params.foodId;
        const foodId = typeof foodIdParam === "string" ? foodIdParam : null;
        if (foodId == null) return null;
        return usualProductsPickerHref(
            plainFoodIdForUsualPicker(foodId, ctx.foods.get(foodId)),
            ctx.from,
        );
    },
    addFridgeItemToGrocery(notice) {
        const subject = notice.subject;
        if (subject.kind !== "fridge_item") return null;
        return `/kitchen/fridge/items/${encodeURIComponent(subject.id)}/add-to-grocery`;
    },
    // These notices act from the new app only; the old Needs attention
    // page never produces them, so it has nothing to link.
    actOnNotice: (notice, ctx) => (ctx.v2 ? noticeActPath(notice.code) : null),
    // The sheet is on the page already; the link is what a tap with no script
    // falls back to.
    weighInSheet: (notice, ctx) =>
        ctx.v2 && notice.subject.id === ctx.v2.viewerUserId
            ? FD_LOG_HREF
            : null,
    possibleDuplicatePair(notice, _ctx) {
        const foodRel = notice.related.find((r) => r.kind === "food");
        if (notice.subject.kind !== "food" || !foodRel) return null;
        const pair = normalizePairIds(notice.subject.id, foodRel.id);
        return `/settings/household/possible-duplicates#dup-${encodeURIComponent(pair.subjectId)}-${encodeURIComponent(pair.relatedKey)}`;
    },
};

export function noticeHref(
    notice: Notice,
    ctx: NoticeRouteContext,
): string | null {
    const action = noticeActionFor(notice);
    if (!action) return null;
    return NOTICE_ROUTES[action.to](notice, ctx);
}

export function noticeAction(notice: Notice, ctx: NoticeRouteContext): string {
    const action = noticeActionFor(notice);
    if (!action) return "";
    const href = NOTICE_ROUTES[action.to](notice, ctx);
    if (href == null) return "";
    if (action.to === "actOnNotice") {
        // The new app's one-tap action names the food and the page to return to.
        return `<form class="notice-action" method="post" action="${escapeHtml(href)}"><input type="hidden" name="subject_id" value="${escapeHtml(notice.subject.id)}" /><input type="hidden" name="back" value="${escapeHtml(ctx.from)}" /><button type="submit" class="btn-sm">${escapeHtml(action.label)}</button></form>`;
    }
    if (action.method === "post") {
        return `<form class="notice-action" method="post" action="${escapeHtml(href)}"><input type="hidden" name="from" value="${escapeHtml(ctx.from)}" /><button type="submit" class="btn-sm">${escapeHtml(action.label)}</button></form>`;
    }
    return `<a href="${escapeHtml(href)}">${escapeHtml(action.label)}</a>`;
}

export type NoticeListDismissOpts = {
    action: string;
    hidden: Record<string, string>;
};

export function noticeList(
    notices: readonly Notice[],
    opts?: {
        className?: string;
        ctx?: NoticeRouteContext;
        dismiss?: (notice: Notice) => NoticeListDismissOpts | null;
    },
): string {
    if (notices.length === 0) return "";
    const baseClass = opts?.className
        ? `notice-list ${escapeHtml(opts.className)}`
        : "notice-list";
    const ctx = opts?.ctx;
    const seen = new Set<string>();
    const items: string[] = [];
    for (const notice of notices) {
        const sentence = noticeSentence(notice);
        // Pair notices are told apart by their foods, not their wording: two
        // pairs can read alike ("Milk may be the same as Milk") and both count.
        const dedupeKey = noticeDismissPair(notice.code)
            ? `${notice.code}|${notice.subject.id}|${notice.related.map((r) => r.id).join(",")}`
            : sentence;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const action = ctx ? noticeAction(notice, ctx) : "";
        const dismiss = opts?.dismiss?.(notice);
        let li = `<li class="notice-row">${escapeHtml(sentence)}`;
        if (action) li += ` ${action}`;
        if (dismiss) {
            const hidden = Object.entries(dismiss.hidden)
                .map(
                    ([k, v]) =>
                        `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
                )
                .join("");
            li += `<form method="post" action="${escapeHtml(dismiss.action)}" class="notice-dismiss-form">${hidden}<button type="submit" class="btn-sm">${escapeHtml(noticeDismissLabel(notice.code))}</button></form>`;
        }
        li += "</li>";
        items.push(li);
    }
    const allBlock =
        notices.length > 0 && notices.every((n) => n.severity === "block");
    const blockingAttr = allBlock ? ' data-blocking="true"' : "";
    return `<ul class="${escapeHtml(baseClass)}"${blockingAttr}>${items.join("")}</ul>`;
}
