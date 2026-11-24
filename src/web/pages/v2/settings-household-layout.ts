import type { AppChromeBase } from "../../attention.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { esc, raw, type Html } from "../../components/v2/html.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { APP_PATHS } from "../../route-map.js";
import { renderAppShell } from "../../shell.js";
import { settingsMenu } from "./settings-shared.js";

/**
 * The frame the Household pages share: the Settings page layout (menu beside
 * a 640 column from 1024 px) with the one thing the plain Settings layout has
 * no slot for, a round control at the end of the bar: the ⋯ menu on the
 * household and a member, the + that creates an invite. On the phone it ends
 * the Detail bar; on desktop it ends the page header, in line with the title.
 * The control is drawn twice and CSS shows one, so each copy is a complete
 * form or menu.
 */
export type HouseholdLayout = {
    chrome: AppChromeBase;
    title: string;
    /** Where the phone back arrow goes; default the Household page. */
    backHref?: string;
    /** The round control at the end of the bar; none keeps the title centred. */
    actions?: Html;
    /** Under the desktop title (a search field); on a phone under the bar. */
    headerExtra?: Html;
    /** Extra classes on the page root. */
    className?: string;
    body: Html | string;
};

export function renderHouseholdLayout(layout: HouseholdLayout): string {
    const detail = detailBar({
        title: layout.title,
        back: { href: layout.backHref ?? APP_PATHS.settingsHousehold },
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
        menu: settingsMenu("household"),
        content: raw(
            `<div class="fd-settings-main"><div class="fd-settings-content">${String(layout.body)}</div></div>`,
        ),
    });
    return renderAppShell({
        ...layout.chrome,
        title: layout.title,
        active: "household",
        v2Active: "settings",
        body: `<div class="${esc(["fd-settings fd-settings--flat fd-settings--household", layout.className].filter(Boolean).join(" "))}" data-fd-settings-page="household">${String(detail)}${String(page)}</div>`,
    });
}
