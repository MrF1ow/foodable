import { escapeHtml } from "../html.js";
import { THEME_COLOR } from "../tokens.js";
import { bottomNav } from "./components/bottom-nav.js";
import { pageHeader } from "./components/ui.js";

export { bottomNav, escapeHtml };

export const APP_TABS = [
    { id: "fridge", href: "/fridge", label: "Fridge" },
    { id: "grocery", href: "/grocery", label: "Groceries" },
    { id: "nutrition", href: "/", label: "Nutrition" },
    { id: "recipes", href: "/recipes", label: "Recipes" },
    { id: "settings", href: "/settings", label: "Settings" },
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

// THEME_COLOR is the page background (--bg), so the mobile browser bar
// blends into the page.
function themeColorMeta(theme: ThemePref): string {
    if (theme !== "system") {
        return `<meta name="theme-color" content="${THEME_COLOR[theme]}" />`;
    }
    return `<meta name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)" />`;
}

export function appHead(title: string, theme: ThemePref): string {
    return `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${themeColorMeta(theme)}
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/favicon.ico" sizes="32x32" />
<link rel="icon" href="/brand/icon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="stylesheet" href="/app.css" />
<script src="/app.js" defer></script>`;
}

export function renderAppShell(chrome: AppChrome): string {
    return `<!doctype html>
${htmlOpen(chrome.theme)}
<head>
${appHead(chrome.title, chrome.theme)}
</head>
<body>
<header class="app-bar"><a href="/logout">Log out</a></header>
<main class="app-main native">${chrome.body}</main>
${bottomNav(chrome.active)}
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
${appHead(title, theme)}
</head>
<body>
<header class="app-bar"><a href="/logout">Log out</a></header>
<main class="app-main native">${body}</main>
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

export function comingSoonPage(
    tab: Exclude<AppTabId, "nutrition">,
    chrome: ViewerChrome = { theme: "system" },
): string {
    const label = APP_TABS.find((t) => t.id === tab)!.label;
    return renderAppShell({
        title: label,
        active: tab,
        theme: chrome.theme,
        body: `${pageHeader({ title: label })}<p class="coming-soon">Coming soon.</p>`,
    });
}
