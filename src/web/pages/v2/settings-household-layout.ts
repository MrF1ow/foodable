import type { AppChromeBase } from "../../attention.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { APP_PATHS } from "../../route-map.js";
import { renderAppShell } from "../../shell.js";
import { settingsMenu, type SettingsV2Section } from "./settings-shared.js";

/**
 * The frame the Household pages share: the Settings page layout (menu beside
 * a 640 column from 1024 px) with the one thing the plain Settings layout has
 * no slot for, a round control at the end of the bar: the ⋯ menu on the
 * household page, the + that creates an invite. On the phone it ends
 * the Detail bar; on desktop it ends the page header, in line with the title.
 * The control is drawn twice and CSS shows one, so each copy is a complete
 * form or menu.
 *
 * `page` says which Settings menu link is current and what the back arrow
 * defaults to: the Household pages (the default), or another section (Goals,
 * Saved foods, Product score) that wants the same bar.
 */
export type HouseholdLayout = {
    chrome: AppChromeBase;
    title: string;
    /** The Settings section this page belongs to; default "household". */
    page?: SettingsV2Section;
    /** Where the phone back arrow goes; default the Household page, or Settings for another section. */
    backHref?: string;
    /** The back arrow's accessible name; default "Back". */
    backLabel?: string;
    /** The round control at the end of the bar; none keeps the title centred. */
    actions?: Html;
    /** Under the desktop title (a search field); on a phone under the bar. */
    headerExtra?: Html;
    /** Extra classes on the page root. */
    className?: string;
    body: Html | string;
};

export function renderHouseholdLayout(layout: HouseholdLayout): string {
    const section = layout.page ?? "household";
    const detail = detailBar({
        title: layout.title,
        back: {
            label: layout.backLabel,
            href:
                layout.backHref ??
                (section === "household"
                    ? APP_PATHS.settingsHousehold
                    : APP_PATHS.settings),
        },
        trailing: layout.actions ? { slot: layout.actions } : undefined,
        balance: true,
        className: "fd-settings-detail",
    });
    const header = raw(
        `<div class="fd-settings-page-head"><h1 class="fd-settings-page-title">${esc(layout.title)}</h1>${layout.actions ? `<div class="fd-settings-page-head__actions">${layout.actions}</div>` : ""}</div>${layout.headerExtra ?? ""}`,
    );
    const page = pageLayout({
        layout: "settings",
        header,
        menu: settingsMenu(section),
        content: raw(
            `<div class="fd-settings-main"><div class="fd-settings-content">${String(layout.body)}</div></div>`,
        ),
    });
    return renderAppShell({
        ...layout.chrome,
        title: layout.title,
        active: "household",
        v2Active: "settings",
        body: `<div class="${esc(["fd-settings fd-settings--flat fd-settings--household", layout.className].filter(Boolean).join(" "))}" data-fd-settings-page="${section}">${String(detail)}${String(page)}</div>`,
    });
}
