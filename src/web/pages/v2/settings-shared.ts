import type { AppChromeBase } from "../../attention.js";
import { initialsOf } from "../../shell-v2.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { renderAppShell } from "../../shell.js";
import { APP_PATHS } from "../../route-map.js";

/** Which settings screen is active (menu highlight and layout). */
export type SettingsV2Section =
    | "home"
    | "account"
    | "display"
    | "help"
    | "household"
    | "goals"
    | "saved"
    | "export";

type MenuIcon =
    "user" | "users" | "target" | "bookmark" | "sun" | "download" | "help";

type MenuRow = {
    id: Exclude<SettingsV2Section, "home">;
    label: string;
    href: string;
    icon: MenuIcon;
};

const MENU_ICON_PATHS: Record<MenuIcon, string> = {
    user: '<path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z"/><path d="M6 19v-1a6 6 0 0 1 12 0v1"/>',
    users: '<path d="M8 13a3 3 0 1 0-3-3"/><path d="M16 12a3 3 0 1 0-3-3"/><path d="M4 19v-1.2a4 4 0 0 1 4-4"/><path d="M12 19v-1.2a4 4 0 0 1 4-4"/><path d="M20 19v-1.2a4 4 0 0 0-3.15-3.88"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none"/>',
    bookmark: '<path d="M8 5h8v14l-4-3-4 3V5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
    download:
        '<path d="M12 5v10"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/>',
    help: '<circle cx="12" cy="12" r="8"/><path d="M9.5 9.2a2.7 2.7 0 0 1 4.8 1.4c0 2-2.8 2.3-2.8 3.9"/><circle cx="12" cy="17.2" r="0.9" fill="currentColor" stroke="none"/>',
};

function settingsMenuIcon(kind: MenuIcon): string {
    const inner = MENU_ICON_PATHS[kind];
    return `<svg class="fd-icon fd-settings-menu__icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}

const SETTINGS_MENU_MAIN: readonly MenuRow[] = [
    {
        id: "account",
        label: "Account",
        href: "/settings/account",
        icon: "user",
    },
    {
        id: "household",
        label: "Household & members",
        href: APP_PATHS.settingsHousehold,
        icon: "users",
    },
    { id: "goals", label: "Goals", href: "/settings/goals", icon: "target" },
    {
        id: "saved",
        label: "Saved foods & recipes",
        href: "/settings/saved",
        icon: "bookmark",
    },
];

const SETTINGS_MENU_PREFS: readonly MenuRow[] = [
    { id: "display", label: "Display", href: "/settings/display", icon: "sun" },
];

const SETTINGS_MENU_CONNECT: readonly MenuRow[] = [
    {
        id: "export",
        label: "Export data",
        href: "/settings/export",
        icon: "download",
    },
    { id: "help", label: "Help", href: APP_PATHS.settingsHelp, icon: "help" },
];

export const SETTINGS_V2_MENU_LABELS = [
    ...SETTINGS_MENU_MAIN,
    ...SETTINGS_MENU_PREFS,
    ...SETTINGS_MENU_CONNECT,
].map((r) => r.label);

type MenuGroup = {
    key: string;
    label?: string;
    rows: readonly MenuRow[];
};

const SETTINGS_MENU_GROUPS: readonly MenuGroup[] = [
    { key: "main", rows: SETTINGS_MENU_MAIN },
    { key: "prefs", label: "Preferences", rows: SETTINGS_MENU_PREFS },
    { key: "connect", label: "Connect", rows: SETTINGS_MENU_CONNECT },
];

const THEME_SEG_OPTIONS = [
    { value: "system", label: "Auto" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
] as const;

export function themeChoiceValue(
    stored: string | null | undefined,
): (typeof THEME_SEG_OPTIONS)[number]["value"] {
    if (stored === "light" || stored === "dark") return stored;
    return "system";
}

function settingsThemeSegForm(
    storedTheme: "light" | "dark" | null | undefined,
): string {
    const selected = themeChoiceValue(storedTheme);
    const buttons = THEME_SEG_OPTIONS.map((opt) => {
        const on = opt.value === selected ? " fd-settings-theme-btn--on" : "";
        return `<button type="submit" name="theme" value="${esc(opt.value)}" class="fd-settings-theme-btn${on}">${esc(opt.label)}</button>`;
    }).join("");
    return `<form method="POST" action="/settings/display" class="fd-settings-theme-form" data-turbo="false" aria-label="Theme"><input type="hidden" name="return" value="/settings"><div class="fd-settings-theme-seg" role="group">${buttons}</div></form>`;
}

function settingsDisplayMenuRow(
    active: SettingsV2Section,
    storedTheme?: "light" | "dark" | null,
): Html {
    const current = active === "display" ? ' aria-current="page"' : "";
    const themeForm = settingsThemeSegForm(storedTheme);
    return raw(
        `<li class="fd-settings-menu__item fd-settings-menu__item--display"><a class="fd-settings-menu__link fd-settings-menu__link--display-nav" href="/settings/display"${current}>${settingsMenuIcon("sun")}<span class="fd-settings-menu__label">Display</span><span class="fd-settings-menu__chev" aria-hidden="true">${iconChevronRight()}</span></a><div class="fd-settings-menu__display-row">${settingsMenuIcon("sun")}<span class="fd-settings-menu__label">Display</span>${themeForm}</div></li>`,
    );
}

function settingsPhoneTopBar(title: string, backHref: string): Html {
    const backIcon = `<svg class="fd-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M15 18 9 12 15 6"/></svg>`;
    return raw(
        `<header class="fd-settings-phone-top"><a class="fd-settings-phone-back" href="${esc(backHref)}" data-turbo="false" aria-label="Back">${backIcon}</a><h1 class="fd-settings-phone-title">${esc(title)}</h1><span class="fd-settings-phone-top__balance" aria-hidden="true"></span></header>`,
    );
}

function menuLink(
    row: MenuRow,
    active: SettingsV2Section,
    opts?: { memberCount?: number },
): Html {
    const current = row.id === active ? ' aria-current="page"' : "";
    const badge =
        row.id === "household" &&
        opts?.memberCount != null &&
        opts.memberCount > 0
            ? `<span class="fd-settings-menu__badge">${esc(String(opts.memberCount))}</span>`
            : "";
    return raw(
        `<li class="fd-settings-menu__item"><a class="fd-settings-menu__link" href="${esc(row.href)}"${current}>${settingsMenuIcon(row.icon)}<span class="fd-settings-menu__label">${esc(row.label)}</span>${badge}<span class="fd-settings-menu__chev" aria-hidden="true">${iconChevronRight()}</span></a></li>`,
    );
}

function menuGroupMarkup(
    group: MenuGroup,
    active: SettingsV2Section,
    opts?: {
        memberCount?: number;
        storedTheme?: "light" | "dark" | null;
        inlineDisplayTheme?: boolean;
    },
): string {
    const items = group.rows.map((row) => {
        if (row.id === "display" && opts?.inlineDisplayTheme) {
            return String(settingsDisplayMenuRow(active, opts?.storedTheme));
        }
        return String(menuLink(row, active, opts));
    });
    const label = group.label
        ? `<p class="fd-settings-menu__group-label">${esc(group.label)}</p>`
        : "";
    return `${label}<ul class="fd-settings-menu__list">${items.join("")}</ul>`;
}

export function settingsMenuNav(
    active: SettingsV2Section,
    opts?: {
        memberCount?: number;
        storedTheme?: "light" | "dark" | null;
        inlineDisplayTheme?: boolean;
    },
): Html {
    const groups = SETTINGS_MENU_GROUPS.map((group) =>
        menuGroupMarkup(group, active, opts),
    ).join("");
    return raw(
        `<nav class="fd-settings-menu" aria-label="Settings sections"><div class="fd-settings-menu__groups">${groups}</div></nav>`,
    );
}

export type SettingsProfile = {
    displayName: string;
    email: string;
    roleLabel?: string;
    householdName?: string;
    memberCount?: number;
};

export function settingsProfileCard(view: SettingsProfile): Html {
    const stats: string[] = [];
    if (view.householdName) {
        stats.push(
            `<div class="fd-settings-profile__stat"><span class="fd-settings-profile__stat-label">Household</span><span class="fd-settings-profile__stat-value">${esc(view.householdName)}</span></div>`,
        );
    }
    if (view.memberCount != null && view.memberCount > 0) {
        stats.push(
            `<div class="fd-settings-profile__stat"><span class="fd-settings-profile__stat-label">Members</span><span class="fd-settings-profile__stat-value">${esc(String(view.memberCount))}</span></div>`,
        );
    }
    if (view.roleLabel) {
        stats.push(
            `<div class="fd-settings-profile__stat"><span class="fd-settings-profile__stat-label">Role</span><span class="fd-settings-profile__stat-value">${esc(view.roleLabel)}</span></div>`,
        );
    }
    const statsRow =
        stats.length > 0
            ? `<div class="fd-settings-profile__stats">${stats.join("")}</div>`
            : "";
    return raw(
        `<section class="fd-settings-profile" aria-label="Your profile"><div class="fd-settings-profile__row"><div class="fd-settings-profile__text"><p class="fd-settings-profile__name">${esc(view.displayName)}</p><p class="fd-settings-profile__email">${esc(view.email)}</p></div><span class="fd-avatar fd-settings-profile__avatar" aria-hidden="true">${esc(initialsOf(view.displayName))}</span></div>${statsRow}</section>`,
    );
}

/** Desktop Settings home pane (member table is not loaded on this route). */
export function settingsDesktopHomePane(opts: {
    householdName?: string;
    memberCount?: number;
}): Html {
    const title = opts.householdName ?? "Household";
    const members =
        opts.memberCount != null && opts.memberCount > 0
            ? `${esc(String(opts.memberCount))} member${opts.memberCount === 1 ? "" : "s"}`
            : "";
    const membersMeta = members
        ? `<span class="fd-settings-home-pane__meta">${members}</span>`
        : "";
    const manage = `<a class="fd-settings-home-pane__link" href="${esc(APP_PATHS.settingsHousehold)}">Manage household and stores<span class="fd-settings-menu__chev" aria-hidden="true">${iconChevronRight()}</span></a>`;
    return raw(
        `<section class="fd-settings-home-pane" aria-labelledby="fd-settings-home-pane-title"><header class="fd-settings-home-pane__head"><h2 class="fd-settings-home-pane__title" id="fd-settings-home-pane-title">${esc(title)}</h2>${membersMeta}</header><p class="fd-settings-home-pane__lead">Members, stores, and household preferences live on the household screen.</p>${manage}</section>`,
    );
}

export function settingsBackLink(href = "/settings", label = "Back"): Html {
    return raw(
        `<a class="fd-settings-back" href="${esc(href)}" data-turbo="false">${esc(label)}</a>`,
    );
}

export type SettingsV2Layout = {
    chrome: AppChromeBase;
    page: SettingsV2Section;
    title: string;
    body: Html | string;
    profile?: SettingsProfile;
    /** Raw `profiles.theme` (null = Auto) for the home menu theme control. */
    storedTheme?: "light" | "dark" | null;
    /** Where the phone back arrow and the Back link go. Default: Settings. */
    backHref?: string;
    /** Text of the Back link. Default "Back". */
    backLabel?: string;
};

function roleLabelFromChrome(chrome: AppChromeBase): string | undefined {
    const role = chrome.identity?.viewerRole;
    if (!role) return undefined;
    return role.charAt(0).toUpperCase() + role.slice(1);
}

function settingsLayoutMarkup(layout: SettingsV2Layout): string {
    const isHome = layout.page === "home";
    const memberCount = layout.chrome.identity?.memberCount;
    const menu = settingsMenuNav(isHome ? "home" : layout.page, {
        memberCount,
        storedTheme: layout.storedTheme,
        inlineDisplayTheme: isHome,
    });
    const profileSource =
        layout.profile ??
        (isHome
            ? {
                  displayName: layout.chrome.identity?.viewerName ?? "Member",
                  email: "",
                  roleLabel: roleLabelFromChrome(layout.chrome),
                  householdName: layout.chrome.identity?.householdName,
                  memberCount,
              }
            : undefined);
    const profileMain =
        isHome && profileSource ? settingsProfileCard(profileSource) : raw("");
    const profilePhone =
        isHome && profileSource
            ? `<div class="fd-settings-profile-phone">${String(settingsProfileCard(profileSource))}</div>`
            : "";
    const back = isHome
        ? raw("")
        : settingsBackLink(layout.backHref, layout.backLabel);
    const phoneTop = settingsPhoneTopBar(
        layout.title,
        isHome ? APP_PATHS.nutrition : (layout.backHref ?? APP_PATHS.settings),
    );
    const desktopBanner = settingsDesktopPageBanner();
    const mainInner =
        typeof layout.body === "string" ? layout.body : String(layout.body);
    return `<div class="fd-settings" data-fd-settings-page="${esc(layout.page)}">${String(phoneTop)}${String(desktopBanner)}<div class="fd-settings-columns"><aside class="fd-settings-aside">${profilePhone}${String(menu)}</aside><div class="fd-settings-main">${String(back)}<div class="fd-settings-content">${String(profileMain)}${mainInner}</div></div></div></div>`;
}

const SETTINGS_DESKTOP_SUBTITLE = "Household, people and preferences";

function settingsDesktopPageBanner(): Html {
    return raw(
        `<header class="fd-settings-desktop-banner"><h1 class="fd-settings-desktop-banner__title">Settings</h1><p class="fd-settings-desktop-banner__sub">${esc(SETTINGS_DESKTOP_SUBTITLE)}</p></header>`,
    );
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
        `<div class="fd-settings-field"><span class="fd-settings-field__label" id="${esc(labelId)}">${esc(opts.label)}</span>${opts.control.replace(/^(<(?:input|select|textarea)\b)/, `$1 aria-labelledby="${esc(labelId)}"`)}</div>`,
    );
}

export function settingsPrimarySubmit(label: string): string {
    return `<button type="submit" class="fd-settings-submit">${esc(label)}</button>`;
}

export function joinFields(parts: readonly Html[]): Html {
    return join(parts);
}
