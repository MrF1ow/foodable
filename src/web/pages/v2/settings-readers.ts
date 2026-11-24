/**
 * Settings › Household › Recipe link readers (FigCraft 412254): a READERS
 * header over TikTok and Facebook, each a switch, then Blocked links with its
 * count and a ⋯ that clears them in place.
 *
 * Only the owner turns a reader on or off; everyone else reads On or Off.
 * Turning one on needs the terms read first, so the switch of a reader that is
 * off is a link back to this page (`?turn_on=<reader>`) that opens the terms
 * under that row, with a checkbox to confirm and Cancel. That form posts to
 * the same route the switch-off does.
 */
import type { AppChromeBase } from "../../attention.js";
import {
    DEFAULT_SOCIAL_READERS,
    type SocialReadersPreferences,
} from "../../../household.js";
import {
    SOCIAL_READER_FACEBOOK_CAVEAT,
    SOCIAL_READER_LABELS,
    SOCIAL_READER_RESEARCH_URL,
    SOCIAL_READER_RISK_INTRO,
    socialReaderConfirmLabel,
    socialReaderTurnOnLabel,
    type SocialReaderId,
} from "../../../copy/social-readers.js";
import { button } from "../../components/v2/button.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { itemRow } from "../../components/v2/item-row.js";
import { listGroup } from "../../components/v2/list-group.js";
import { menu } from "../../components/v2/menu.js";
import { sectionHeader } from "../../components/v2/section-header.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";

export const READERS_PATH = "/settings/household/readers";
export const SOCIAL_READERS_PATH = "/settings/household/social-readers";
export const CLEAR_BLOCKED_PATH = "/settings/household/fetch-refusals/clear";

export type SettingsReadersV2View = {
    chrome: AppChromeBase;
    socialReaders: SocialReadersPreferences;
    /** Links Foodable will not try again yet (unexpired refusals). */
    blockedCount: number;
    isOwner: boolean;
    /** Owners and admins can clear blocked links. */
    canManage: boolean;
    error?: string;
    /** The reader whose terms are open; only for the owner, and only a reader that is off. */
    confirmReader?: SocialReaderId;
};

/** What the Household row shows: `TikTok on`, `TikTok, Facebook on` or `Off`. */
export function readersSummary(readers: SocialReadersPreferences): string {
    const on = (["tiktok", "facebook"] as const).filter((id) => readers[id]);
    if (on.length === 0) return "Off";
    return `${on.map((id) => SOCIAL_READER_LABELS[id]).join(", ")} on`;
}

export function blockedLinksLabel(count: number): string {
    return count === 0 ? "None" : String(count);
}

function readerRow(view: SettingsReadersV2View, reader: SocialReaderId): Html {
    const label = SOCIAL_READER_LABELS[reader];
    const enabled = view.socialReaders[reader];
    const subtitle = enabled ? "Public post captions" : undefined;
    if (!view.isOwner) {
        return itemRow({
            title: label,
            subtitle,
            value: enabled ? "On" : "Off",
        });
    }
    const aria = `${label} reader`;
    return itemRow({
        title: label,
        subtitle,
        trailing: {
            kind: "toggle",
            on: enabled,
            label: aria,
            form: enabled
                ? {
                      action: SOCIAL_READERS_PATH,
                      fields: { reader, enabled: "0" },
                  }
                : {
                      action: READERS_PATH,
                      method: "get",
                      fields: { turn_on: reader },
                  },
        },
    });
}

/** The terms, open under a reader that is being turned on. */
function termsRow(view: SettingsReadersV2View, reader: SocialReaderId): Html {
    const label = SOCIAL_READER_LABELS[reader];
    const caveat =
        reader === "facebook"
            ? `<p class="fd-readers__terms-text">${esc(SOCIAL_READER_FACEBOOK_CAVEAT)}</p>`
            : "";
    const error = view.error
        ? `<p class="fd-settings-error" role="alert">${esc(view.error)}</p>`
        : "";
    return raw(
        `<li class="fd-readers__terms" data-fd-reader-terms="${reader}"><form method="post" action="${SOCIAL_READERS_PATH}"><input type="hidden" name="reader" value="${reader}"><input type="hidden" name="enabled" value="1"><p class="fd-readers__terms-text">${esc(SOCIAL_READER_RISK_INTRO)} <a href="${SOCIAL_READER_RESEARCH_URL}" target="_blank" rel="noopener noreferrer">Terms research</a>.</p>${caveat}<label class="fd-readers__terms-confirm"><input type="checkbox" name="confirm" value="1" required> <span>${esc(socialReaderConfirmLabel(reader))}</span></label>${error}<div class="fd-readers__terms-actions">${button({ label: "Cancel", href: READERS_PATH })}${button({ label: socialReaderTurnOnLabel(reader), variant: "primary", type: "submit" })}</div></form></li>`,
    );
}

function blockedRow(view: SettingsReadersV2View): Html {
    const value = blockedLinksLabel(view.blockedCount);
    if (view.blockedCount === 0 || !view.canManage) {
        return itemRow({ title: "Blocked links", value });
    }
    return itemRow({
        title: "Blocked links",
        value,
        trailing: {
            kind: "control",
            html: menu({
                label: "Actions for blocked links",
                anchor: "more",
                items: [
                    {
                        kind: "destructive",
                        label: "Clear blocked links",
                        action: CLEAR_BLOCKED_PATH,
                    },
                ],
            }),
        },
    });
}

export function renderSettingsReadersV2Body(
    view: SettingsReadersV2View,
): string {
    const readers = view.socialReaders ?? DEFAULT_SOCIAL_READERS;
    const withReaders = { ...view, socialReaders: readers };
    // The terms open only for the owner, and only for a reader that is off.
    const confirming =
        view.isOwner &&
        view.confirmReader != null &&
        !readers[view.confirmReader]
            ? view.confirmReader
            : undefined;
    const rows: Html[] = [];
    for (const reader of ["tiktok", "facebook"] as const) {
        rows.push(readerRow(withReaders, reader));
        if (confirming === reader) rows.push(termsRow(view, reader));
    }
    rows.push(blockedRow(view));
    return String(
        join([
            confirming ? "" : settingsErrorBanner(view.error),
            sectionHeader({ label: "Readers", rule: false }),
            listGroup({ rows, label: "Readers" }),
        ]),
    );
}

export function renderSettingsReadersV2Page(
    view: SettingsReadersV2View,
): string {
    return renderSettingsV2Page({
        chrome: view.chrome,
        page: "household",
        title: "Recipe link readers",
        backHref: "/settings/household",
        backLabel: "Household",
        className: "fd-readers",
        body: renderSettingsReadersV2Body(view),
    });
}

export const SETTINGS_READERS_V2_MARKER = "fd-readers";
