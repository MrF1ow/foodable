import { escapeHtml } from "../html.js";
import { THEME_COLOR, THEME_NAV_COLOR } from "../tokens.js";
import { appScriptHref, appStylesheetHref } from "../widgets.js";
import { bottomNav } from "./components/bottom-nav.js";
import { iconLogOut, iconSettings } from "./components/icons.js";

export { bottomNav, escapeHtml };

export const APP_TABS = [
    { id: "fridge", href: "/fridge", label: "Fridge" },
    { id: "grocery", href: "/grocery", label: "Groceries" },
    { id: "nutrition", href: "/", label: "Nutrition" },
    { id: "recipes", href: "/recipes", label: "Recipes" },
    { id: "household", href: "/household", label: "Household" },
] as const;

export type AppTabId = (typeof APP_TABS)[number]["id"];

/** The viewer's saved theme. "system" is a null `profiles.theme` and follows
 *  the OS through prefers-color-scheme. There is no accent preference: the
 *  app, the login page and the widgets share one brand green (tokens.css). */
export type ThemePref = "light" | "dark" | "system";

export type ViewerChrome = {
    theme: ThemePref;
};

export type AppChrome = ViewerChrome & {
    title: string;
    active: AppTabId;
    body: string;
};

export function resolveTheme(theme: string | null | undefined): ThemePref {
    return theme === "light" || theme === "dark" ? theme : "system";
}

/** The `<html>` opener. An explicit theme stamps data-theme, which the token
 *  blocks in tokens.css prefer over prefers-color-scheme in both directions;
 *  "system" leaves it off so the media query decides. */
export function htmlOpen(theme: ThemePref): string {
    const attr = theme === "system" ? "" : ` data-theme="${theme}"`;
    return `<html lang="en"${attr}>`;
}

export type ThemeChromeKind = "page" | "nav";

/** Browser chrome meta tags. Tabbed app pages use the bottom-nav surface; login
 *  and bare pages use the page background (--bg). */
export function themeColorMeta(
    theme: ThemePref,
    kind: ThemeChromeKind = "nav",
): string {
    const colors = kind === "nav" ? THEME_NAV_COLOR : THEME_COLOR;
    if (theme !== "system") {
        return `<meta name="theme-color" content="${colors[theme]}" />`;
    }
    return `<meta name="theme-color" content="${colors.light}" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="${colors.dark}" media="(prefers-color-scheme: dark)" />`;
}

export type AppBarVariant = "app" | "settings" | "gate";

// Settings uses page theme chrome and the tabs use nav chrome. Turbo's head
// merge replaces a theme-color meta whose colour differs, and iOS Safari only
// retints its toolbar on a page load, so every link between the two (the gear,
// Back, and the Settings logo) opts out of Turbo.
export function appBar(variant: AppBarVariant): string {
    const logoTurbo = variant === "settings" ? ' data-turbo="false"' : "";
    const action =
        variant === "app"
            ? `<a class="btn-icon app-bar-action" href="/settings" data-turbo="false" aria-label="Settings" title="Settings">${iconSettings()}</a>`
            : variant === "gate"
              ? `<a class="btn-icon app-bar-action" href="/logout" data-turbo="false" aria-label="Log out" title="Log out">${iconLogOut()}</a>`
              : "";
    return `<header class="app-bar"><a class="app-bar-logo" href="/"${logoTurbo}><img src="/brand/mark.svg" width="27" height="26" alt="" />Foodable</a>${action}</header>`;
}

export function appHead(
    title: string,
    theme: ThemePref,
    themeChrome: ThemeChromeKind = "nav",
): string {
    return `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="foodable-theme" content="${theme}" />
<meta name="foodable-theme-chrome" content="${themeChrome}" />
<meta name="turbo-refresh-method" content="morph" />
<meta name="turbo-refresh-scroll" content="preserve" />
<meta name="turbo-cache-control" content="no-preview" />
${themeColorMeta(theme, themeChrome)}
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml" data-turbo-track="reload" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="stylesheet" href="${appStylesheetHref()}" data-turbo-track="reload" />
<script src="${appScriptHref()}" defer data-turbo-track="reload"></script>`;
}

export function renderAppShell(chrome: AppChrome): string {
    return `<!doctype html>
${htmlOpen(chrome.theme)}
<head>
${appHead(chrome.title, chrome.theme)}
</head>
<body class="has-bottom-nav">
${appBar("app")}
<main class="app-main native">${chrome.body}</main>
${bottomNav(chrome.active)}
<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>
</body>
</html>`;
}

/** Create-household and forbidden: same top bar as the app, no bottom nav.
 *  There is no saved theme yet, so production leaves it as "system". Preview
 *  stamps light/dark so a shot of each is not the same bytes. */
export function renderBarePage(
    title: string,
    body: string,
    theme: ThemePref = "system",
): string {
    return `<!doctype html>
${htmlOpen(theme)}
<head>
${appHead(title, theme, "page")}
</head>
<body>
${appBar("gate")}
<main class="app-main native">${body}</main>
<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>
</body>
</html>`;
}

export type SettingsPageShell = {
    title: string;
    theme: ThemePref;
    backHref: string;
    body: string;
};

/** Bare Settings / Help chrome: back link, no bottom nav, page theme meta.
 *  Back skips Turbo for the same reason as the gear (see appBar). */
export function renderSettingsPage(shell: SettingsPageShell): string {
    return `<!doctype html>
${htmlOpen(shell.theme)}
<head>
${appHead(shell.title, shell.theme, "page")}
</head>
<body>
${appBar("settings")}
<main class="app-main native"><a class="settings-back" href="${escapeHtml(shell.backHref)}" data-turbo="false">‹ Back</a>${shell.body}</main>
<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>
</body>
</html>`;
}

/** The settings form posts theme=system|light|dark. System, or anything
 *  unrecognised, clears the preference (null) rather than pinning light. */
export function parseAppearanceInput(input: { theme?: unknown }): {
    theme: "light" | "dark" | null;
} {
    return {
        theme:
            input.theme === "light" || input.theme === "dark"
                ? input.theme
                : null,
    };
}
