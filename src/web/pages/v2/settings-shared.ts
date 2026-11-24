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

type MenuIcon =
    | "user"
    | "users"
    | "target"
    | "gauge"
    | "bell"
    | "bookmark"
    | "sun"
    | "download"
    | "help"
    | "code"
    | "cart"
    | "ruler"
    | "drop";

const MENU_ICON_PATHS: Record<MenuIcon, string> = {
    user: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/><path d="M6 19v-1a6 6 0 0 1 12 0v1"/>',
    users: '<path d="M8 13a3 3 0 1 0-3-3"/><path d="M16 12a3 3 0 1 0-3-3"/><path d="M4 19v-1.2a4 4 0 0 1 4-4"/><path d="M12 19v-1.2a4 4 0 0 1 4-4"/><path d="M20 19v-1.2a4 4 0 0 0-3.15-3.88"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
    gauge: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
    bell: '<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15Z"/><path d="M10 21h4"/>',
    bookmark: '<path d="M8 5h8v14l-4-3-4 3V5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    download:
        '<path d="M12 5v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
    cart: '<path d="M3 4h2l2 11h11l2-8H6.5"/><path d="M7.6 19a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"/><path d="M14.6 19a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"/>',
    ruler: '<path d="M4 15 15 4l5 5L9 20Z"/><path d="M8 11l2 2M11 8l2 2M14 5l1.5 1.5"/>',
    drop: '<path d="M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Z"/>',
    code: '<path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/>',
    help: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.2a2.7 2.7 0 0 1 4.8 1.4c0 2-2.8 2.3-2.8 3.9"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
};

/** The menu's line icon; `className` is the class the caller's CSS styles it by. */
export function settingsMenuIcon(
    kind: MenuIcon,
    className = "fd-settings-menu__icon",
): string {
    const inner = MENU_ICON_PATHS[kind];
    return `<svg class="fd-icon ${esc(className)}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

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

/** Wraps labelled native controls for v2 settings forms. */
export function settingsField(opts: {
    id: string;
    label: string;
    control: string;
}): Html {
    const labelId = `${opts.id}-label`;
    return raw(
        `<div class="fd-settings-field"><span class="fd-settings-field__label" id="${esc(labelId)}">${esc(opts.label)}</span>${opts.control.replace(/^(<(?:input|select|textarea)\b)/, (_tag, open: string) => `${open} aria-labelledby="${esc(labelId)}"`)}</div>`,
    );
}

export function settingsPrimarySubmit(label: string): string {
    return `<button type="submit" class="fd-settings-submit">${esc(label)}</button>`;
}

export function joinFields(parts: readonly Html[]): Html {
    return join(parts);
}
