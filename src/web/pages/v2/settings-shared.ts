import type { AppChromeBase } from "../../attention.js";
import { detailBar } from "../../components/v2/detail-bar.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import type { IconName } from "../../components/v2/icon.js";
import { pageLayout } from "../../components/v2/page-layout.js";
import { sideLink } from "../../components/v2/side-link.js";
import { renderAppShell } from "../../shell.js";
import { APP_PATHS } from "../../route-map.js";

/** Which settings screen is active (menu highlight and layout). */
export type SettingsV2Section =
    | "home"
    | "account"
    | "timezone"
    | "help"
    | "household"
    | "stores"
    | "units"
    | "nutrients"
    | "goals"
    | "score"
    | "notifications"
    | "saved"
    | "ai";

/** One link of the Settings menu on desktop (the design's list of ten): flat
 *  Side links, the current page told by type. `covers` lists the sections that
 *  make it current: Stores belongs to Household. */
type DesktopNavRow = {
    label: string;
    href: string;
    icon: IconName;
    covers: readonly SettingsV2Section[];
};

const SETTINGS_DESKTOP_NAV: readonly DesktopNavRow[] = [
    {
        label: "Account",
        href: APP_PATHS.settingsAccount,
        icon: "user",
        covers: ["account", "timezone"],
    },
    {
        label: "Household & members",
        href: APP_PATHS.settingsHousehold,
        icon: "users",
        covers: ["household", "stores"],
    },
    {
        label: "Goals",
        href: APP_PATHS.settingsGoals,
        icon: "target",
        covers: ["goals"],
    },
    {
        label: "Saved foods & recipes",
        href: APP_PATHS.settingsSaved,
        icon: "bookmark",
        covers: ["saved"],
    },
    {
        label: "Units",
        href: APP_PATHS.settingsUnits,
        icon: "ruler",
        covers: ["units"],
    },
    {
        label: "Nutrients shown",
        href: APP_PATHS.settingsNutrients,
        icon: "drop",
        covers: ["nutrients"],
    },
    {
        label: "Product score",
        href: APP_PATHS.settingsScore,
        icon: "gauge",
        covers: ["score"],
    },
    {
        label: "Notifications",
        href: APP_PATHS.settingsNotifications,
        icon: "bell",
        covers: ["notifications"],
    },
    {
        label: "AI connections",
        href: APP_PATHS.settingsAi,
        icon: "code",
        covers: ["ai"],
    },
    {
        label: "Help",
        href: APP_PATHS.settingsHelp,
        icon: "help",
        covers: ["help"],
    },
];

export const SETTINGS_DESKTOP_NAV_LABELS = SETTINGS_DESKTOP_NAV.map(
    (r) => r.label,
);

/** The Settings menu beside a sub page, from 1024 px (hidden below): Side
 *  links in the design's order. */
export function settingsMenu(active: SettingsV2Section): Html {
    const links = SETTINGS_DESKTOP_NAV.map((row) =>
        sideLink({
            kind: "main",
            label: row.label,
            href: row.href,
            icon: row.icon,
            current: row.covers.includes(active),
        }),
    );
    return raw(
        `<nav class="fd-settings-menu" aria-label="Settings">${join(links)}</nav>`,
    );
}

export type SettingsV2Layout = {
    chrome: AppChromeBase;
    page: SettingsV2Section;
    title: string;
    /** Where the phone back arrow goes. Default: Settings. */
    backHref?: string;
    /** The back arrow's accessible name. Default "Back". */
    backLabel?: string;
    /** Extra header content under the desktop title (a search field). On
     *  phones it sits right under the Detail bar. */
    headerExtra?: Html;
    /** Class on the page root, for the page's own rules. */
    className?: string;
} & (
    | {
          /** A sub page: the menu beside this content (Settings 240 + 640). */
          body: Html | string;
          home?: undefined;
      }
    | {
          /** Settings home: two columns, no menu. */
          home: { left: Html | string; right: Html | string };
          body?: undefined;
      }
);

function settingsLayoutMarkup(layout: SettingsV2Layout): string {
    const isHome = layout.page === "home";
    // The phone's Detail bar: back, the title centred. Home goes back to
    // Today, a sub page to Settings (or to where the page says). Desktop has
    // the title in the page header instead.
    const detail = detailBar({
        title: layout.title,
        back: {
            label: layout.backLabel,
            href:
                layout.backHref ??
                (isHome ? APP_PATHS.nutrition : APP_PATHS.settings),
        },
        balance: true,
        className: "fd-settings-detail",
    });
    const title = `<h1 class="fd-settings-page-title">${esc(layout.title)}</h1>`;
    const header = raw(`${title}${layout.headerExtra ?? ""}`);
    const page = layout.home
        ? pageLayout({
              layout: "two-columns",
              header: raw(title),
              left: raw(String(layout.home.left)),
              right: raw(String(layout.home.right)),
          })
        : pageLayout({
              layout: "settings",
              header,
              menu: settingsMenu(layout.page),
              content: raw(
                  `<div class="fd-settings-main"><div class="fd-settings-content">${String(layout.body)}</div></div>`,
              ),
          });
    return `<div class="${esc(["fd-settings", layout.className].filter(Boolean).join(" "))}" data-fd-settings-page="${esc(layout.page)}">${String(detail)}${String(page)}</div>`;
}

export function renderSettingsV2Page(layout: SettingsV2Layout): string {
    return renderAppShell({
        ...layout.chrome,
        title: layout.title,
        active: "household",
        v2Active: "settings",
        body: settingsLayoutMarkup(layout),
    });
}

export function settingsPageHeader(title: string, actions?: string): Html {
    const extra = actions
        ? `<div class="fd-settings-head-actions">${actions}</div>`
        : "";
    return raw(
        `<header class="fd-settings-head fd-settings-head--phone"><h1 class="fd-settings-title">${esc(title)}</h1>${extra}</header>`,
    );
}

export function settingsErrorBanner(message: string | undefined): Html {
    if (!message) return raw("");
    return raw(`<p class="fd-settings-error" role="alert">${esc(message)}</p>`);
}

export function settingsPrimarySubmit(label: string): string {
    return `<button type="submit" class="fd-settings-submit">${esc(label)}</button>`;
}

export function joinFields(parts: readonly Html[]): Html {
    return join(parts);
}
