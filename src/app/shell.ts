import { tabIcon } from "../web/components/bottom-nav.js";

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

// The page background (--bg in public/widgets/src/shared/tokens.css), so the
// mobile browser bar blends into the page.
const THEME_COLOR = { light: "#f5f5f7", dark: "#000000" } as const;

export function resolveTheme(theme: string | null | undefined): ThemePref {
    return theme === "light" || theme === "dark" ? theme : "system";
}

export function escapeHtml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function bottomNav(active: AppTabId): string {
    const links = APP_TABS.map((tab) => {
        const current = tab.id === active ? ' aria-current="page"' : "";
        const label = escapeHtml(tab.label);
        return `<a href="${tab.href}"${current} title="${label}" aria-label="${label}">${tabIcon(tab.id)}</a>`;
    }).join("");
    return `<nav class="bottom-nav" aria-label="App">${links}</nav>`;
}

/** The `<html>` opener. An explicit theme stamps data-theme, which the token
 *  blocks in tokens.css prefer over prefers-color-scheme in both directions;
 *  "system" leaves it off so the media query decides. */
export function htmlOpen(theme: ThemePref): string {
    const attr = theme === "system" ? "" : ` data-theme="${theme}"`;
    return `<html lang="en"${attr}>`;
}

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
<link rel="icon" href="/favicon.ico" />
<link rel="stylesheet" href="/app.css" />`;
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
<script>
document.querySelectorAll(".widget-frame").forEach((frame) => {
    // Same max-content measure as the bridge's size-changed report.
    // scrollHeight never drops below the frame's own height, so it could
    // only grow a frame, never shrink one back to its content.
    const fit = () => {
        try {
            const doc = frame.contentDocument;
            if (!doc) return;
            const el = doc.documentElement;
            const prev = el.style.height;
            el.style.height = "max-content";
            const height = Math.ceil(el.getBoundingClientRect().height);
            el.style.height = prev;
            if (height) frame.style.height = height + "px";
        } catch (_) {}
    };
    // This script waits for /app.css, and a srcdoc frame does not: by the
    // time it runs, a frame may already have loaded and posted its first
    // size-changed, both missed. So measure now as well as on load; a frame
    // still on its initial about:blank measures 0 and is left alone.
    fit();
    frame.addEventListener("load", fit);
    window.addEventListener("message", (e) => {
        if (e.source !== frame.contentWindow) return;
        const d = e.data;
        if (d && d.method && String(d.method).endsWith("size-changed") && d.params && d.params.height) {
            frame.style.height = d.params.height + "px";
        }
    });
});
</script>
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
        body: `<h1>${escapeHtml(label)}</h1><p class="coming-soon">Coming soon.</p>`,
    });
}
