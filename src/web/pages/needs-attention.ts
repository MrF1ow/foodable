import type { Notice } from "../../domain/notices.js";
import {
    dismissalSubjectLabel,
    panelGroupKey,
    type NoticesForResult,
} from "../../domain/notices-for.js";
import { dismissalKey } from "../../domain/notice-dismissals.js";
import { NOTICE_COPY } from "../../copy/notices.js";
import { noticeCodeDismissible } from "../../copy/notices.js";
import type { AppChromeBase } from "../attention.js";
import { escapeHtml, renderAppShell } from "../shell.js";
import {
    disclosure,
    emptyState,
    errorBanner,
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

function groupOpenLink(
    panelKey: string,
    sample: Notice,
): { href: string; label: string } | null {
    if (panelKey.startsWith("recipe:")) {
        const recipeId = panelKey.slice("recipe:".length);
        return {
            href: `/recipes/${encodeURIComponent(recipeId)}`,
            label: "Open recipe",
        };
    }
    switch (sample.subject.kind) {
        case "fridge_item":
            return { href: "/fridge", label: "Open fridge" };
        case "grocery_line":
            return { href: "/grocery", label: "Open grocery" };
        case "food":
            return { href: "/household/items", label: "Open items" };
        default:
            return null;
    }
}

function groupNotices(notices: Notice[]): {
    groups: Map<string, Notice[]>;
    order: string[];
} {
    const groups = new Map<string, Notice[]>();
    const order: string[] = [];
    for (const notice of notices) {
        const key = panelGroupKey(notice);
        if (!groups.has(key)) order.push(key);
        const list = groups.get(key) ?? [];
        list.push(notice);
        groups.set(key, list);
    }
    return { groups, order };
}

function sortGroupKeys(
    order: string[],
    subjectTimes: ReadonlyMap<string, number>,
): string[] {
    // Newest activity first. A group with no timestamp goes last, and those
    // keep producer order among themselves (the sort is stable).
    const time = (key: string) =>
        subjectTimes.get(key) ?? Number.NEGATIVE_INFINITY;
    return order.slice().sort((a, b) => {
        const ta = time(a);
        const tb = time(b);
        if (ta === tb) return 0;
        return tb > ta ? 1 : -1;
    });
}

export function renderNeedsAttentionPage(view: NeedsAttentionView): string {
    const { groups, order } = groupNotices(view.result.notices);
    const sortedKeys = sortGroupKeys(order, view.result.subjectTimes);
    const ctx = {
        from: "/needs-attention",
        foods: view.result.noticeFoods,
    };
    const panels: string[] = [];
    for (const key of sortedKeys) {
        const notices = groups.get(key) ?? [];
        const head = notices[0]!;
        const name =
            view.result.subjectNames.get(key) ??
            view.result.subjectNames.get(
                `${head.subject.kind}:${head.subject.id}`,
            ) ??
            "Item";
        const open = groupOpenLink(key, head);
        const openLink = open
            ? `<p class="psec"><a href="${escapeHtml(open.href)}">${escapeHtml(open.label)}</a></p>`
            : "";
        const list = noticeList(notices, {
            ctx,
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
                title: name,
                body: `${openLink}${list || emptyState("Nothing here.")}`,
            }),
        );
    }

    const dismissedNames = view.result.subjectNames;
    const dismissedBody =
        view.showDismissed === true
            ? (() => {
                  const openKeys = new Set(
                      view.result.notices.map((n) => {
                          const k = dismissalKey(n);
                          return `${k.code}|${k.subjectKind}|${k.subjectId}|${k.relatedKey}`;
                      }),
                  );
                  const rows = view.result.dismissals
                      .filter((d) => {
                          const key = `${d.code}|${d.subjectKind}|${d.subjectId}|${d.relatedKey}`;
                          return !openKeys.has(key);
                      })
                      .map((d) => {
                          const badge = NOTICE_COPY[d.code]?.badge ?? d.code;
                          const label = dismissalSubjectLabel(
                              d,
                              dismissedNames,
                          );
                          return `<li>${row({
                              title: `${badge} — ${label}`,
                              meta: "",
                              actions: `<form method="post" action="/needs-attention/undo" class="row-action"><input type="hidden" name="dismissal_id" value="${escapeHtml(d.id)}" /><button type="submit" class="btn-sm">Undo</button></form>`,
                          })}</li>`;
                      });
                  if (rows.length === 0) {
                      return emptyState("No dismissed notices.");
                  }
                  return `<ul class="list">${rows.join("")}</ul>`;
              })()
            : `<p><a href="/needs-attention?show=dismissed">Show dismissed notices</a></p>`;

    const body = [
        pageHeader({ title: "Needs attention" }),
        errorBanner(view.error),
        panels.length > 0
            ? panels.join("")
            : emptyState("Nothing needs attention"),
        disclosure({
            summary: "Show dismissed",
            body: dismissedBody,
            open: view.showDismissed === true,
        }),
    ].join("");

    return renderAppShell({
        ...view.chrome,
        title: "Needs attention",
        active: "none",
        body,
    });
}
