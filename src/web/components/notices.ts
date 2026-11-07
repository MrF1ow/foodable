import type { Food } from "../../domain/foods.js";
import type { Notice } from "../../domain/notices.js";
import type { NoticeRoute } from "../../copy/notices.js";
import {
    NOTICE_COPY,
    noticeActionFor,
    noticeDismissLabel,
    noticeSentence,
} from "../../copy/notices.js";
import { escapeHtml } from "../shell.js";
import {
    plainFoodIdForUsualPicker,
    usualProductsPickerHref,
} from "../usual-products-path.js";

export type NoticeRouteContext = {
    from: string;
    foods: ReadonlyMap<string, Pick<Food, "genericFoodId">>;
};

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
        return `/fridge/items/${encodeURIComponent(subject.id)}/add-to-grocery`;
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

const PILL_CLASS: Record<"block" | "warn" | "info" | "bad" | "dim", string> = {
    block: "pill-bad",
    bad: "pill-bad",
    warn: "pill-warn",
    info: "pill-dim",
    dim: "pill-dim",
};

export function noticeBadge(
    notice: Notice,
    opts?: { className?: string },
): string {
    const copy = NOTICE_COPY[notice.code];
    const badge = copy.badge;
    const tone = copy.badgeTone ?? notice.severity;
    const cls = PILL_CLASS[tone];
    const extra = opts?.className ? ` ${escapeHtml(opts.className)}` : "";
    return `<span class="pill ${cls}${extra}" data-notice="${escapeHtml(notice.code)}">${escapeHtml(badge)}</span>`;
}

export function noticeAction(notice: Notice, ctx: NoticeRouteContext): string {
    const action = noticeActionFor(notice);
    if (!action) return "";
    const href = NOTICE_ROUTES[action.to](notice, ctx);
    if (href == null) return "";
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
        if (seen.has(sentence)) continue;
        seen.add(sentence);
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
