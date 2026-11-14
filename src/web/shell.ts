import { escapeHtml } from "../html.js";
import { THEME_COLOR, THEME_NAV_COLOR } from "../tokens.js";
import { appScriptHref, appStylesheetHref } from "../widgets.js";
import type { MemberRole } from "../household.js";
import type { ViewerFlags } from "../viewer-flags.js";
import type { AttentionChrome } from "./attention.js";
import { iconLogOut } from "./components/icons.js";
import { renderAppShellV2 } from "./shell-v2.js";

export { escapeHtml };

import { APP_PATHS } from "./route-map.js";

export const APP_TABS = [
    { id: "fridge", href: APP_PATHS.kitchenFridge, label: "Fridge" },
    { id: "grocery", href: APP_PATHS.kitchenGroceries, label: "Groceries" },
    { id: "nutrition", href: APP_PATHS.nutrition, label: "Nutrition" },
    { id: "recipes", href: APP_PATHS.recipes, label: "Recipes" },
    { id: "household", href: APP_PATHS.settingsHousehold, label: "Household" },
] as const;

export type AppTabId = (typeof APP_TABS)[number]["id"];

/** The viewer's saved theme. "system" is a null `profiles.theme` and follows
 *  the OS through prefers-color-scheme. There is no accent preference: the
 *  app, the login page and the widgets share one brand green (tokens.css). */
export type ThemePref = "light" | "dark" | "system";

export type ViewerChrome = {
    theme: ThemePref;
};

/** The shell's navigation ids. Settings is the sidebar item (no phone tab). */
export type V2NavId =
    "today" | "kitchen" | "recipes" | "trends" | "settings" | "none";

/** The Kitchen text tabs under the page header (design: Kitchen tabs). */
export type V2KitchenTab = "fridge" | "groceries" | "usuals";

/** Who is looking and which household, for the shell's sidebar and account
 *  chip (loaded by `viewerChromeWithAttention`). */
export type ShellIdentity = {
    /** The viewer's user id, so their picture can be addressed. */
    viewerUserId?: string;
    viewerName: string;
    viewerRole: MemberRole;
    householdName: string;
    memberCount: number;
    /** When each member's picture last changed, by user id. Only set when the
     *  profile-pictures flag is on (read once per page); absent means no
     *  pictures are shown anywhere on the page. */
    avatarVersions?: ReadonlyMap<string, Date>;
};

export type AppChrome = ViewerChrome & {
    title: string;
    active: AppTabId | "none";
    body: string;
    attention: AttentionChrome;
    flags: ViewerFlags;
    /** Set by `viewerChromeWithAttention`. */
    identity?: ShellIdentity;
    /** Overrides the tab derived from `active` (the usual products pages are
     *  `active: "household"` but belong to Kitchen). */
    v2Active?: V2NavId;
    /** Which Kitchen text tab is current. Defaults from `active` (grocery →
     *  groceries, anything else → fridge); the usual products pages set
     *  "usuals". */
    v2Kitchen?: V2KitchenTab;
    /** Open grocery line count for the Groceries kitchen tab. */
    v2KitchenGroceriesCount?: number;
    /** Profile timezone for the log sheet defaults. */
    v2Timezone?: string;
    /** Log sheet open state after validation errors. */
    v2LogSheet?: Omit<
        import("./pages/v2/log-sheet.js").RenderLogSheetsOpts,
        "timezone"
    >;
};

export function resolveTheme(theme: string | null | undefined): ThemePref {
    return theme === "light" || theme === "dark" ? theme : "system";
}

export function viewerChromeFromProfile(
    profile: { theme?: string | null } | null,
): ViewerChrome {
    return { theme: resolveTheme(profile?.theme) };
}

/** The `<html>` opener. An explicit theme stamps data-theme, which the token
 *  blocks in tokens.css prefer over prefers-color-scheme in both directions;
 *  "system" leaves it off so the media query decides. */
export function htmlOpen(theme: ThemePref): string {
    const attr = theme === "system" ? "" : ` data-theme="${theme}"`;
    return `<html lang="en"${attr}>`;
}

export type ThemeChromeKind = "page" | "nav";

/** Browser chrome meta tags. "page" is the page background (--bg), which the
 *  shell, login and bare pages all use; "nav" is the nav surface. */
export function themeColorMeta(
    theme: ThemePref,
    kind: ThemeChromeKind,
): string {
    const colors = kind === "nav" ? THEME_NAV_COLOR : THEME_COLOR;
    if (theme !== "system") {
        return `<meta name="theme-color" content="${colors[theme]}" />`;
    }
    return `<meta name="theme-color" content="${colors.light}" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="${colors.dark}" media="(prefers-color-scheme: dark)" />`;
}

/** The top bar of the bare pages (create-household, forbidden, not found): the
 *  logo and Log out, with no nav and no search. Log out opts out of Turbo so
 *  the login form that follows is a real page load. */
export function appBar(): string {
    return `<header class="app-bar"><a class="app-bar-logo" href="/"><img src="/brand/mark.svg" width="27" height="26" alt="" />Foodable</a><a class="btn-icon app-bar-action" href="/logout" data-turbo="false" aria-label="Log out" title="Log out">${iconLogOut()}</a></header>`;
}

/** Everything in `<head>` before the stylesheet and script tags, which differ
 *  between the app shell and the bare pages. */
export function appHeadMeta(
    title: string,
    theme: ThemePref,
    themeChrome: ThemeChromeKind,
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
<link rel="manifest" href="/manifest.webmanifest" />`;
}

export function appHead(
    title: string,
    theme: ThemePref,
    themeChrome: ThemeChromeKind,
): string {
    return `${appHeadMeta(title, theme, themeChrome)}
<link rel="stylesheet" href="${appStylesheetHref()}" data-turbo-track="reload" />
<script src="${appScriptHref()}" defer data-turbo-track="reload"></script>`;
}

/** The household shell (shell-v2.ts). */
export function renderAppShell(chrome: AppChrome): string {
    return renderAppShellV2(chrome);
}

/** Create-household, forbidden and not found: a bare page with the logo and
 *  Log out on top and none of the shell around it. There is no saved theme
 *  yet, so production leaves it as "system". Preview stamps light/dark so a
 *  shot of each is not the same bytes. */
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
${appBar()}
<main class="app-main native">${body}</main>
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
