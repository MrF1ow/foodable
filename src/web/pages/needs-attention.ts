import type { Notice } from "../../domain/notices.js";
import type { NoticeDismissal } from "../../domain/notice-dismissals.js";
import type { NoticesForResult } from "../../domain/notices-for.js";
import { dismissalKey } from "../../domain/notice-dismissals.js";
import { NOTICE_COPY } from "../../copy/notices.js";
import { noticeCodeDismissible } from "../../copy/notices.js";
import type { AppChromeBase } from "../attention.js";
import { escapeHtml, renderAppShell } from "../shell.js";
import {
    disclosure,
    emptyState,
    pageHeader,
    panel,
    row,
} from "../components/ui.js";
import { noticeBadge, noticeList } from "../components/notices.js";

export type NeedsAttentionView = {
    chrome: AppChromeBase;
    result: NoticesForResult;
    showDismissed?: boolean;
    error?: string;
};

function subjectHref(notice: Notice): string | null {
    switch (notice.subject.kind) {
        case "recipe":
            return `/recipes/${encodeURIComponent(notice.subject.id)}`;
        case "fridge_item":
            return "/fridge";
        case "grocery_line":
            return "/grocery";
        case "recipe_ingredient": {
            const recipeId =
                notice.subject.kind === "recipe_ingredient"
                    ? notice.subject.recipeId
                    : "";
            return recipeId ? `/recipes/${encodeURIComponent(recipeId)}` : null;
        }
        case "food":
            return `/settings/foods`;
        default:
            return null;
    }
}

function groupNotices(notices: Notice[]): Map<string, Notice[]> {
    const groups = new Map<string, Notice[]>();
    for (const notice of notices) {
        const key = `${notice.subject.kind}:${notice.subject.id}`;
        const list = groups.get(key) ?? [];
        list.push(notice);
        groups.set(key, list);
    }
    return groups;
}

function dismissedRows(dismissals: NoticeDismissal[], open: Notice[]): string {
    const openKeys = new Set(
        open.map((n) => {
            const k = dismissalKey(n);
            return `${k.code}|${k.subjectKind}|${k.subjectId}|${k.relatedKey}`;
        }),
    );
    const rows = dismissals
        .filter((d) => {
            const key = `${d.code}|${d.subjectKind}|${d.subjectId}|${d.relatedKey}`;
            return !openKeys.has(key);
        })
        .map((d) => {
            const badge = NOTICE_COPY[d.code]?.badge ?? d.code;
            return row({
                title: `${escapeHtml(badge)} — Removed item`,
                meta: "",
                actions: `<form method="post" action="/needs-attention/undo" class="row-action"><input type="hidden" name="dismissal_id" value="${escapeHtml(d.id)}" /><button type="submit" class="btn-sm">Undo</button></form>`,
            });
        });
    if (rows.length === 0) {
        return emptyState("No dismissed notices.");
    }
    return `<ul class="list">${rows.join("")}</ul>`;
}

export function renderNeedsAttentionPage(view: NeedsAttentionView): string {
    const groups = groupNotices(view.result.notices);
    const panels: string[] = [];
    for (const [, notices] of groups) {
        const head = notices[0]!;
        const name =
            view.result.subjectNames.get(
                `${head.subject.kind}:${head.subject.id}`,
            ) ?? "Item";
        const href = subjectHref(head);
        const title = href
            ? `<a href="${escapeHtml(href)}">${escapeHtml(name)}</a>`
            : escapeHtml(name);
        const list = noticeList(notices, {
            dismiss: (notice) =>
                noticeCodeDismissible(notice.code)
                    ? {
                          action: "/needs-attention/dismiss",
                          hidden: {
                              code: notice.code,
                              subject_kind: notice.subject.kind,
                              subject_id: notice.subject.id,
                              ...(dismissalKey(notice).relatedKey
                                  ? {
                                        related_id:
                                            dismissalKey(notice).relatedKey,
                                    }
                                  : {}),
                          },
                      }
                    : null,
        });
        panels.push(
            panel({
                title,
                body: list || emptyState("Nothing here."),
            }),
        );
    }

    const body = [
        pageHeader({ title: "Needs attention" }),
        view.error
            ? `<div class="banner-row">${escapeHtml(view.error)}</div>`
            : "",
        panels.length > 0
            ? panels.join("")
            : emptyState("Nothing needs attention"),
        disclosure({
            summary: "Show dismissed",
            body:
                view.showDismissed === true
                    ? dismissedRows(view.result.dismissals, view.result.notices)
                    : `<p><a href="/needs-attention?show=dismissed">Show dismissed notices</a></p>`,
        }),
    ].join("");

    return renderAppShell({
        ...view.chrome,
        title: "Needs attention",
        active: "none",
        body,
    });
}
