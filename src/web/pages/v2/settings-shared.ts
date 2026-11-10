import type { AppChromeBase } from "../../attention.js";
import { initialsOf } from "../../shell-v2.js";
import { esc, join, raw, type Html } from "../../components/v2/html.js";
import { iconChevronRight } from "../../components/v2/icons.js";
import { sectionHeader } from "../../components/v2/rows.js";
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

type MenuRow = {
    id: Exclude<SettingsV2Section, "home">;
    label: string;
    href: string;
};

const SETTINGS_MENU: readonly MenuRow[] = [
    { id: "account", label: "Account", href: "/settings/account" },
    { id: "household", label: "Household", href: APP_PATHS.settingsHousehold },
    { id: "display", label: "Display", href: "/settings/display" },
    { id: "goals", label: "Goals", href: "/settings/goals" },
    {
        id: "saved",
        label: "Saved foods & recipes",
        href: "/settings/saved",
    },
    { id: "export", label: "Export data", href: "/settings/export" },
    { id: "help", label: "Help", href: APP_PATHS.settingsHelp },
];

export const SETTINGS_V2_MENU_LABELS = SETTINGS_MENU.map((r) => r.label);

function menuLink(row: MenuRow, active: SettingsV2Section): Html {
    const current = row.id === active ? ' aria-current="page"' : "";
    return raw(
        `<li class="fd-settings-menu__item"><a class="fd-settings-menu__link" href="${esc(row.href)}"${current}><span class="fd-settings-menu__label">${esc(row.label)}</span><span class="fd-settings-menu__chev" aria-hidden="true">${iconChevronRight()}</span></a></li>`,
    );
}

export function settingsMenuNav(active: SettingsV2Section): Html {
    const items = SETTINGS_MENU.map((row) => menuLink(row, active));
    return raw(
        `<nav class="fd-settings-menu" aria-label="Settings sections">${rowListMarkup(items)}</nav>`,
    );
}

function rowListMarkup(items: readonly Html[]): string {
    return `<ul class="fd-settings-menu__list">${items.join("")}</ul>`;
}

export function settingsProfileCard(view: {
    displayName: string;
    email: string;
}): Html {
    return raw(
        `<section class="fd-settings-profile" aria-label="Your profile"><span class="fd-avatar fd-settings-profile__avatar" aria-hidden="true">${esc(initialsOf(view.displayName))}</span><p class="fd-settings-profile__name">${esc(view.displayName)}</p><p class="fd-settings-profile__email">${esc(view.email)}</p></section>`,
    );
}

/** Desktop Settings home only: Household card with a Display shortcut (UI-30). */
export function settingsHouseholdHomeCard(active: SettingsV2Section): Html {
    const displayCurrent = active === "display" ? ' aria-current="page"' : "";
    return raw(
        `<section class="fd-settings-card fd-settings-card--household" aria-labelledby="fd-settings-household-title">${String(sectionHeader({ title: "Household", level: 2, id: "fd-settings-household-title" }))}<ul class="fd-settings-menu__list fd-settings-menu__list--inset"><li class="fd-settings-menu__item"><a class="fd-settings-menu__link" href="${esc(APP_PATHS.settingsHousehold)}"><span class="fd-settings-menu__label">Members and stores</span><span class="fd-settings-menu__chev" aria-hidden="true">${iconChevronRight()}</span></a></li><li class="fd-settings-menu__item"><a class="fd-settings-menu__link" href="/settings/display"${displayCurrent}><span class="fd-settings-menu__label">Display</span><span class="fd-settings-menu__chev" aria-hidden="true">${iconChevronRight()}</span></a></li></ul></section>`,
    );
}

export function settingsBackLink(): Html {
    return raw(
        `<a class="fd-settings-back" href="/settings" data-turbo="false">Back</a>`,
    );
}

export type SettingsV2Layout = {
    chrome: AppChromeBase;
    page: SettingsV2Section;
    title: string;
    body: Html | string;
    profile?: { displayName: string; email: string };
    homeHouseholdCard?: boolean;
};

function settingsLayoutMarkup(layout: SettingsV2Layout): string {
    const isHome = layout.page === "home";
    const menu = settingsMenuNav(isHome ? "home" : layout.page);
    const profileMain =
        isHome && layout.profile
            ? settingsProfileCard(layout.profile)
            : raw("");
    const profilePhone =
        isHome && layout.profile
            ? `<div class="fd-settings-profile-phone">${String(settingsProfileCard(layout.profile))}</div>`
            : "";
    const householdCard =
        isHome && layout.homeHouseholdCard
            ? settingsHouseholdHomeCard(layout.page)
            : raw("");
    const back = isHome ? raw("") : settingsBackLink();
    const mainInner =
        typeof layout.body === "string" ? layout.body : String(layout.body);
    return `<div class="fd-settings" data-fd-settings-page="${esc(layout.page)}"><aside class="fd-settings-aside">${profilePhone}${String(menu)}</aside><div class="fd-settings-main">${String(back)}<div class="fd-settings-content">${String(profileMain)}${mainInner}</div>${isHome ? String(householdCard) : ""}</div></div>`;
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
        `<header class="fd-settings-head"><h1 class="fd-settings-title">${esc(title)}</h1>${extra}</header>`,
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
