import type { Notice } from "../../domain/notices.js";
import {
    panelGroupKey,
    type NoticesForResult,
} from "../../domain/notices-for.js";
import { dismissalKey } from "../../domain/notice-dismissals.js";
import { noticeCodeDismissible } from "../../copy/notices.js";
import type { AppChromeBase } from "../attention.js";
import { escapeHtml, renderAppShell } from "../shell.js";
import {
    emptyState,
    errorBanner,
    pageHeader,
    panel,
} from "../components/ui.js";
import {
    noticeList,
    NOTICE_DISMISS_PATH,
    type NoticeListDismissOpts,
} from "../components/notices.js";
import { isOneTapNotice } from "./v2/notice-strip.js";

export type NeedsAttentionView = {
    chrome: AppChromeBase;
    /** The viewer, for a weigh-in reminder that is theirs (new app only). */
    viewerUserId?: string;
    result: NoticesForResult;
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
            return { href: "/kitchen/fridge", label: "Open fridge" };
        case "grocery_line":
            return { href: "/kitchen/groceries", label: "Open grocery" };
        case "food":
            // A usual running low or a food the plan is missing has its own
            // action on the row; the items list adds nothing.
            if (isOneTapNotice(sample)) return null;
            if (sample.code === "food.possible_duplicate") {
                return {
                    href: "/settings/saved/duplicates",
                    label: "Open possible duplicates",
                };
            }
            return { href: "/settings/household/items", label: "Open items" };
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
        v2: { viewerUserId: view.viewerUserId },
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
            (typeof head.params.name === "string" ? head.params.name : null) ??
            "Item";
        const open = groupOpenLink(key, head);
        const openLink = open
            ? `<p class="psec"><a href="${escapeHtml(open.href)}">${escapeHtml(open.label)}</a></p>`
            : "";
        const list = noticeList(notices, {
            ctx,
            dismiss: (notice): NoticeListDismissOpts | null =>
                noticeCodeDismissible(notice.code)
                    ? isOneTapNotice(notice)
                        ? {
                              // Their dismissal is held for the plan or day
                              // the notice carries, and only the one-tap route
                              // looks them up.
                              action: NOTICE_DISMISS_PATH,
                              hidden: {
                                  code: notice.code,
                                  subject_kind: notice.subject.kind,
                                  subject_id: notice.subject.id,
                                  related_id: dismissalKey(notice).relatedKey,
                                  back: "/needs-attention",
                              },
                          }
                        : {
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

    const body = [
        pageHeader({ title: "Needs attention" }),
        errorBanner(view.error),
        panels.length > 0
            ? panels.join("")
            : emptyState("Nothing needs attention"),
    ].join("");

    return renderAppShell({
        ...view.chrome,
        title: "Needs attention",
        active: "none",
        body,
    });
}
