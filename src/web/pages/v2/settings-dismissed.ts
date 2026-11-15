import type { AppChromeBase } from "../../attention.js";
import { NOTICE_COPY } from "../../../copy/notices.js";
import {
    dismissalKey,
    type NoticeDismissal,
} from "../../../domain/notice-dismissals.js";
import {
    dismissalSubjectLabel,
    type NoticesForResult,
} from "../../../domain/notices-for.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { rowList, sectionHeader } from "../../components/v2/rows.js";
import { renderSettingsV2Page } from "./settings-shared.js";

export const DISMISSED_PATH = "/settings/household/dismissed";

function keyOf(d: {
    code: string;
    subjectKind: string;
    subjectId: string;
    relatedKey: string;
}): string {
    return `${d.code}|${d.subjectKind}|${d.subjectId}|${d.relatedKey}`;
}

/** Dismissals whose notice is not showing right now (a still-open one is not "dismissed"). */
export function dismissedNotices(result: NoticesForResult): NoticeDismissal[] {
    const open = new Set(result.notices.map((n) => keyOf(dismissalKey(n))));
    return result.dismissals.filter((d) => !open.has(keyOf(d)));
}

export type SettingsDismissedV2View = {
    chrome: AppChromeBase;
    dismissals: readonly NoticeDismissal[];
    subjectNames: Map<string, string>;
    error?: string;
};

function kindLabel(d: NoticeDismissal): string {
    return NOTICE_COPY[d.code]?.badge ?? d.code;
}

function dismissedRow(
    d: NoticeDismissal,
    subjectNames: Map<string, string>,
): Html {
    const label = dismissalSubjectLabel(d, subjectNames);
    return raw(
        `<li class="fd-row fd-row--dismissed"><div class="fd-row__body"><div class="fd-row__main"><span class="fd-row__line"><span class="fd-row__title">${esc(label)}</span></span></div><form method="post" action="/needs-attention/undo" class="fd-row__actions"><input type="hidden" name="dismissal_id" value="${esc(d.id)}" /><input type="hidden" name="return_to" value="${DISMISSED_PATH}" /><button type="submit" class="fd-settings-btn fd-settings-btn--sm">Undo</button></form></div></li>`,
    );
}

export function renderSettingsDismissedV2Body(
    view: SettingsDismissedV2View,
): string {
    if (view.dismissals.length === 0) {
        return `<div class="fd-dismissed fd-stores" data-fd-dismissed><p class="fd-settings-household-empty">No dismissed notices.</p></div>`;
    }
    const groups = new Map<string, NoticeDismissal[]>();
    for (const d of view.dismissals) {
        const kind = kindLabel(d);
        groups.set(kind, [...(groups.get(kind) ?? []), d]);
    }
    const sections: Html[] = [];
    for (const [kind, items] of groups) {
        sections.push(
            sectionHeader({ title: kind, level: 2 }),
            rowList(
                items.map((d) => dismissedRow(d, view.subjectNames)),
                { label: kind, className: "fd-list--card" },
            ),
        );
    }
    return `<div class="fd-dismissed fd-stores" data-fd-dismissed>${String(join(sections))}</div>`;
}

export function renderSettingsDismissedV2Page(
    view: SettingsDismissedV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: "Dismissed notices",
        backHref: "/settings/household",
        backLabel: "Household",
        body: renderSettingsDismissedV2Body(view),
    });
}

export const SETTINGS_DISMISSED_V2_MARKER = "data-fd-dismissed";
