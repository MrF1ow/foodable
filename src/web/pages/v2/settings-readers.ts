import type { AppChromeBase } from "../../attention.js";
import {
    DEFAULT_SOCIAL_READERS,
    type SocialReadersPreferences,
} from "../../../household.js";
import {
    SOCIAL_READER_LABELS,
    SOCIAL_READER_OWNER_ONLY,
    type SocialReaderId,
} from "../../../copy/social-readers.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { sectionHeader } from "../../components/v2/rows.js";
import { sourceIcon } from "../../components/source-icon.js";
import {
    renderSettingsV2Page,
    settingsErrorBanner,
} from "./settings-shared.js";
import {
    householdRow,
    householdRowCard,
    ROW_ICONS,
} from "./settings-household-rows.js";
import {
    HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID,
    HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID,
    renderSocialReaderModals,
} from "./settings-household-modals.js";

export const READERS_PATH = "/settings/household/readers";
export const READERS_INTRO =
    "When someone shares a TikTok or Facebook post, Foodable reads its caption so the recipe can be imported. Only the owner can turn a reader on.";

export type SettingsReadersV2View = {
    chrome: AppChromeBase;
    socialReaders: SocialReadersPreferences;
    /** Links Foodable will not try again yet (unexpired refusals). */
    blockedCount: number;
    isOwner: boolean;
    /** Owners and admins can clear blocked links. */
    canManage: boolean;
    error?: string;
    openModalId?: string;
};

/** What the Household row shows: `TikTok on`, `TikTok, Facebook on` or `Off`. */
export function readersSummary(readers: SocialReadersPreferences): string {
    const on = (["tiktok", "facebook"] as const).filter((id) => readers[id]);
    if (on.length === 0) return "Off";
    return `${on.map((id) => SOCIAL_READER_LABELS[id]).join(", ")} on`;
}

function readerRow(view: SettingsReadersV2View, reader: SocialReaderId): Html {
    const label = SOCIAL_READER_LABELS[reader];
    const enabled = view.socialReaders[reader];
    const modalId =
        reader === "tiktok"
            ? HOUSEHOLD_SOCIAL_READER_TIKTOK_MODAL_ID
            : HOUSEHOLD_SOCIAL_READER_FACEBOOK_MODAL_ID;
    const lead = `<span class="fd-stores-pref__icon" aria-hidden="true">${sourceIcon(reader, { label, decorative: true })}</span>`;
    const main = `<span class="fd-stores-pref__main"><span class="fd-row__title">${esc(label)}</span><span class="fd-row__sub">${esc(enabled ? "Reads public post captions" : "Off")}</span></span>`;
    const state = enabled ? "true" : "false";
    const aria = `${label} reader`;
    let control: string;
    if (!view.isOwner) {
        control = `<span class="fd-stores-pref__value">${enabled ? "On" : "Off"}</span>`;
    } else if (enabled) {
        control = `<form method="post" action="/settings/household/social-readers" class="fd-inline-form"><input type="hidden" name="reader" value="${reader}" /><input type="hidden" name="enabled" value="0" /><button type="submit" class="fd-switch" role="switch" aria-checked="${state}" aria-label="${esc(aria)}"><span class="fd-switch__knob" aria-hidden="true"></span></button></form>`;
    } else {
        // Turning a reader on needs the terms confirm, so it opens that dialog.
        control = `<button type="button" class="fd-switch" role="switch" aria-checked="${state}" aria-label="${esc(aria)}" commandfor="${esc(modalId)}" command="show-modal"><span class="fd-switch__knob" aria-hidden="true"></span></button>`;
    }
    return raw(
        `<li class="fd-row fd-row--stores-pref fd-row--social"><div class="fd-row__body fd-stores-pref">${lead}${main}${control}</div></li>`,
    );
}

export function blockedLinksLabel(count: number): string {
    return count === 0 ? "None" : `${count} ${count === 1 ? "link" : "links"}`;
}

function blockedRow(view: SettingsReadersV2View): Html {
    const value = blockedLinksLabel(view.blockedCount);
    if (view.blockedCount === 0 || !view.canManage) {
        return householdRow({
            icon: ROW_ICONS.refresh,
            label: "Blocked links",
            value,
        });
    }
    return raw(
        `<li class="fd-row fd-row--stores-pref"><div class="fd-row__body fd-stores-pref"><span class="fd-stores-pref__icon" aria-hidden="true">${ROW_ICONS.refresh}</span><span class="fd-stores-pref__main"><span class="fd-row__title">Blocked links</span><span class="fd-row__sub">${esc(value)}</span></span><form method="post" action="/settings/household/fetch-refusals/clear" class="fd-inline-form"><button type="submit" class="fd-settings-btn fd-settings-btn--sm">Clear blocked links</button></form></div></li>`,
    );
}

export function renderSettingsReadersV2Body(
    view: SettingsReadersV2View,
): string {
    const readers = view.socialReaders ?? DEFAULT_SOCIAL_READERS;
    const rows = [
        readerRow({ ...view, socialReaders: readers }, "tiktok"),
        readerRow({ ...view, socialReaders: readers }, "facebook"),
        blockedRow(view),
    ];
    const ownerNote = view.isOwner
        ? ""
        : `<p class="fd-stores-hint">${esc(SOCIAL_READER_OWNER_ONLY)}</p>`;
    const modals = view.isOwner
        ? `<div class="native fd-settings-household-modals">${renderSocialReaderModals(view)}</div>`
        : "";
    return `<div class="fd-readers fd-stores" data-fd-readers><p class="fd-stores-intro">${esc(READERS_INTRO)}</p>${String(settingsErrorBanner(view.error))}${String(sectionHeader({ title: "Readers", level: 2 }))}${String(householdRowCard(rows, "Readers"))}${ownerNote}${modals}</div>`;
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
        body: renderSettingsReadersV2Body(view),
    });
}

export const SETTINGS_READERS_V2_MARKER = "data-fd-readers";
