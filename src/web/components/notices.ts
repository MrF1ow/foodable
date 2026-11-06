import type { Food } from "../../domain/foods.js";
import type { Notice } from "../../domain/notices.js";
import type { NoticeRoute } from "../../copy/notices.js";
import { NOTICE_COPY, noticeSentence } from "../../copy/notices.js";
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
};

export function noticeHref(
    notice: Notice,
    ctx: NoticeRouteContext,
): string | null {
    const copy = NOTICE_COPY[notice.code];
    const action = copy.action;
    if (!action) return null;
    return NOTICE_ROUTES[action.to](notice, ctx);
}

const PILL_CLASS: Record<"block" | "warn" | "info", string> = {
    block: "pill-bad",
    warn: "pill-warn",
    info: "pill-dim",
};

export function noticeBadge(notice: Notice): string {
    const badge = NOTICE_COPY[notice.code].badge;
    const cls = PILL_CLASS[notice.severity];
    return `<span class="pill ${cls}" data-notice="${escapeHtml(notice.code)}">${escapeHtml(badge)}</span>`;
}

export function noticeAction(notice: Notice, ctx: NoticeRouteContext): string {
    const copy = NOTICE_COPY[notice.code];
    const action = copy.action;
    if (!action) return "";
    const href = NOTICE_ROUTES[action.to](notice, ctx);
    if (href == null) return "";
    return `<a href="${escapeHtml(href)}">${escapeHtml(action.label)}</a>`;
}

export function noticeList(
    notices: readonly Notice[],
    opts?: { className?: string; ctx?: NoticeRouteContext },
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
        let li = `<li>${escapeHtml(sentence)}`;
        if (action) li += ` ${action}`;
        li += "</li>";
        items.push(li);
    }
    return `<ul class="${escapeHtml(baseClass)}">${items.join("")}</ul>`;
}
