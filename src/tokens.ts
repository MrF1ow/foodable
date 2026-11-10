// The design tokens: every colour, font, type size and radius the UI uses,
// once.
//
// Two surfaces read them. The in-chat widgets use the NEUTRAL palette: they
// render inside someone else's product, so they stay quiet. The household app
// and the login page add the APP brand layer on top: the marketing site's
// palette and type. scripts/gen-tokens.ts writes both stylesheets from here:
//
//   public/widgets/src/shared/tokens.css   NEUTRAL, the shared base
//   public/app/brand.css                   APP, included by app.css and the
//                                          embed skin, never by a widget
//   public/app/v2/tokens.css               FigCraft-aligned v2 shell palette
//   public/widgets/src/shared/v2/tokens.css
//                                          MCP widgets v2 Theme palette
//
// src/tokens.test.ts and src/tokens-v2.test.ts fail when a committed file
// drifts from this module (the v2 test also checks design/figcraft-
// variables.json), so
// a value changes here and nowhere else. --accent is BRAND_GREEN. THEME_COLOR
// is the APP page background, the same value the login head and appHead emit.
// Type (--fs-*) and radius (--r-*) scales stay on the shared base. The
// <meta name="theme-color"> the app and login emit, and the /fonts/ allowlist,
// read this module too.
//
// Each theme's values appear twice in the CSS (once under the media query,
// once under the explicit data-theme override) because an explicit theme must
// win in both directions. The generator repeats them; nobody types them twice.

import { BRAND_GREEN } from "./brand.js";

type Palette = {
    text: string;
    "text-dim": string;
    bg: string;
    panel: string;
    "panel-border": string;
    track: string;
};

type Theme = "light" | "dark";

/** Text and icons on an accent fill; the same in both themes. */
export const ON_ACCENT = "#062c1c";

// Per-metric series colours. Shared by widgets and app alike.
export const NUTRIENTS: Record<Theme, Record<string, string>> = {
    light: {
        calories: "#ff9f0a",
        protein: "#8b5cf6",
        carbs: "#10b981",
        fiber: "#0d9488",
        sugar: "#65a30d",
        fat: "#f43f7e",
        alcohol: "#a21caf",
        caffeine: "#8b5e34",
        water: "#0ea5e9",
        over: "#d0452b",
        warn: "#b26a00",
    },
    dark: {
        calories: "#ffab2e",
        protein: "#a78bfa",
        carbs: "#34d399",
        fiber: "#14b8a6",
        sugar: "#a3e635",
        fat: "#fb7199",
        alcohol: "#e879f9",
        caffeine: "#c69a6d",
        water: "#38bdf8",
        over: "#ff6b52",
        warn: "#e0a030",
    },
};

/** The widgets' neutral surfaces. */
export const NEUTRAL: Record<Theme, Palette & { shadow: string }> = {
    light: {
        text: "#1d1d1f",
        "text-dim": "#6e6e73",
        bg: "#f5f5f7",
        panel: "#ffffff",
        "panel-border": "#e6e6ea",
        track: "#e6e6ea",
        shadow: "0 1px 2px rgba(0, 0, 0, 0.05), 0 8px 22px rgba(0, 0, 0, 0.05)",
    },
    dark: {
        text: "#f5f5f7",
        "text-dim": "#98989d",
        bg: "#000000",
        panel: "#1c1c1e",
        "panel-border": "#2c2c2e",
        track: "#2c2c2e",
        shadow: "none",
    },
};

/** The app's brand surfaces: the marketing site's palette (oklch hue 160). */
export const APP: Record<
    Theme,
    Palette & { shadow: string; "accent-soft": string; "accent-ink": string }
> = {
    light: {
        text: "oklch(0.2 0.01 160)",
        "text-dim": "oklch(0.5 0.015 160)",
        bg: "#fbfaf7",
        panel: "#ffffff",
        "panel-border": "oklch(0.91 0.008 160)",
        track: "oklch(0.94 0.008 160)",
        shadow: "0 0 0 1px rgba(0, 0, 0, 0.03), 0 2px 4px rgba(0, 0, 0, 0.05), 0 12px 24px rgba(0, 0, 0, 0.05)",
        // A pale accent wash for active states, and an accent that passes AA
        // as text on --bg (the logo green itself is ~2:1 on white).
        "accent-soft": "#e6f9f0",
        "accent-ink": "#12875a",
    },
    dark: {
        text: "oklch(0.97 0.005 160)",
        "text-dim": "oklch(0.7 0.012 160)",
        bg: "#0d0f0e",
        panel: "#151817",
        "panel-border": "oklch(1 0 0 / 10%)",
        track: "oklch(0.27 0.008 160)",
        shadow: "inset 0 -20px 80px -20px #ffffff14",
        "accent-soft": "#0f2a1f",
        "accent-ink": "#3ddc9a",
    },
};

/** Browser chrome colour per theme: the page background. */
export const THEME_COLOR: Record<Theme, string> = {
    light: APP.light.bg,
    dark: APP.dark.bg,
};

/** Opaque equivalent of the frosted bottom nav (`color-mix(panel 78%, transparent)`
 *  over `--bg` in public/app/app.css). Used for `<meta name="theme-color">` on
 *  tabbed app pages and for painting below the nav on iOS Safari. */
function navChromeOverBg(
    panel: string,
    bg: string,
    panelWeight = 0.78,
): string {
    const parse = (hex: string) => {
        const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!;
        return [1, 2, 3].map((i) => parseInt(m[i]!, 16));
    };
    const p = parse(panel);
    const b = parse(bg);
    const t = 1 - panelWeight;
    const ch = p.map((v, i) => Math.round(v * panelWeight + b[i]! * t));
    return (
        "#" + ch.map((c) => c.toString(16).padStart(2, "0")).join("")
    ).toLowerCase();
}

export const THEME_NAV_COLOR: Record<Theme, string> = {
    light: navChromeOverBg(APP.light.panel, APP.light.bg),
    dark: navChromeOverBg(APP.dark.panel, APP.dark.bg),
};

/** Self-hosted fonts (SIL OFL 1.1), served from /fonts/ by allowlist. */
export const APP_FONTS = [
    { family: "Geist", file: "geist-latin.woff2", weight: "100 900" },
    {
        family: "Bricolage Grotesque",
        file: "bricolage-latin.woff2",
        weight: "200 800",
    },
] as const;

// The system stack behind the brand fonts; v2 puts V2_FONT.body in front.
const FONT_FALLBACK =
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const FONT_SANS =
    '"Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,\n        Helvetica, Arial, sans-serif';

// Type and radius scales. Every font-size / border-radius px literal in the
// shared partials and public/app/app.css is a step here, so substituting
// var(--fs-*) / var(--r-*) is a no-op on the rendered result. Half-pixel
// steps use a hyphen in the token name (--fs-11-5) because a dot is not a
// valid unescaped ident. --radius stays the panel corner, equal to --r-18.
export const TYPE_SCALE = {
    "8-5": "8.5px",
    "9": "9px",
    "9-5": "9.5px",
    "10": "10px",
    "10-5": "10.5px",
    "11": "11px",
    "11-5": "11.5px",
    "12": "12px",
    "12-5": "12.5px",
    "13": "13px",
    "13-5": "13.5px",
    "14": "14px",
    "15": "15px",
    "16": "16px",
    "18": "18px",
    "19": "19px",
    "21": "21px",
    "24": "24px",
    "26": "26px",
} as const;

export const RADIUS_SCALE = {
    "7": "7px",
    "8": "8px",
    "10": "10px",
    "12": "12px",
    "18": "18px",
    "999": "999px",
} as const;

function scaleDecls(
    prefix: "fs" | "r",
    scale: Record<string, string>,
): [string, string][] {
    return Object.entries(scale)
        .sort((a, b) => parseFloat(a[1]) - parseFloat(b[1]))
        .map(([k, v]) => [`${prefix}-${k}`, v]);
}

// ---- CSS emitters ----------------------------------------------------------

// Split on commas outside parentheses: the layers of a shadow, say.
function topLevelParts(value: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
        const c = value[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) {
            parts.push(value.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(value.slice(start).trim());
    return parts;
}

// One declaration, wrapped the way the formatter wraps it, so generated files
// are already format-clean: a value too long for 80 columns moves to its own
// lines, layers packed greedily.
function line(indent: string, key: string, value: string): string {
    const flat = `${indent}--${key}: ${value};`;
    if (flat.length <= 80) return flat;
    const inner = `${indent}    `;
    const parts = topLevelParts(value);
    const lines: string[] = [];
    let current = "";
    parts.forEach((part, i) => {
        const piece = i < parts.length - 1 ? `${part},` : `${part};`;
        const next = current ? `${current} ${piece}` : piece;
        if (current && (inner + next).length > 80) {
            lines.push(inner + current);
            current = piece;
        } else {
            current = next;
        }
    });
    lines.push(inner + current);
    return `${indent}--${key}:\n${lines.join("\n")}`;
}

const decl = (indent: string, entries: [string, string][]) =>
    entries.map(([k, v]) => line(indent, k, v)).join("\n");

const neutralSurface = (t: Theme): [string, string][] => {
    const p = NEUTRAL[t];
    return [
        ["text", p.text],
        ["text-dim", p["text-dim"]],
        ["bg", p.bg],
        ["panel", p.panel],
        ["panel-border", p["panel-border"]],
        ["track", p.track],
        ["accent", BRAND_GREEN],
    ];
};

const neutralBlock = (t: Theme, indent: string): string =>
    [
        decl(indent, neutralSurface(t)),
        decl(indent, [["shadow", NEUTRAL[t].shadow]]),
        decl(indent, Object.entries(NUTRIENTS[t])),
        `${indent}color-scheme: ${t};`,
    ].join("\n");

/** public/widgets/src/shared/tokens.css */
export function renderTokensCss(): string {
    return `:root {
    /* Light theme (default). Dark overridden below.
                   Neutral grays/whites with the brand green accent. The
                   accent is the logo green (BRAND_GREEN in src/brand.ts) and
                   is the same in both themes. */
${decl("    ", neutralSurface("light"))}
    /* Text and icons on an accent fill. The green is light, so a light label
       on it falls to ~2:1; this near-black green holds ~7.5:1 in both themes,
       which is why no theme block overrides it. */
    --on-accent: ${ON_ACCENT};
${decl("    ", [["shadow", NEUTRAL.light.shadow]])}

${decl("    ", Object.entries(NUTRIENTS.light))}

    /* Native controls (select, input, scrollbars) follow the theme only when
       color-scheme is declared; without it a dark widget renders light OS
       chrome that ignores every token. */
    color-scheme: light;

${decl("    ", scaleDecls("fs", TYPE_SCALE))}
${decl("    ", scaleDecls("r", RADIUS_SCALE))}
    --radius: var(--r-18);
}

@media (prefers-color-scheme: dark) {
    :root {
${neutralBlock("dark", "        ")}
    }
}

/* Explicit host override wins over the media query in both directions. */
:root[data-theme="light"] {
${neutralBlock("light", "    ")}
}
:root[data-theme="dark"] {
${neutralBlock("dark", "    ")}
}
`;
}

const appEntries = (t: Theme): [string, string][] => {
    const p = APP[t];
    return [
        ["text", p.text],
        ["text-dim", p["text-dim"]],
        ["bg", p.bg],
        ["panel", p.panel],
        ["panel-border", p["panel-border"]],
        ["track", p.track],
        ["shadow", p.shadow],
        ["accent-soft", p["accent-soft"]],
        ["accent-ink", p["accent-ink"]],
        ["nav-chrome", THEME_NAV_COLOR[t]],
    ];
};

/** public/app/brand.css */
export function renderBrandCss(): string {
    const faces = APP_FONTS.map(
        (f) => `@font-face {
    font-family: "${f.family}";
    src: url("/fonts/${f.file}") format("woff2");
    font-weight: ${f.weight};
    font-display: swap;
}`,
    ).join("\n");
    return `/* Generated by scripts/gen-tokens.ts from src/tokens.ts. Edit the values
 * there, then run \`bun run gen:tokens\`; never edit this file.
 *
 * The household app's brand layer: palette and type, app-only. Included by
 * public/app/app.css after shared/tokens.css, and by public/app/embed.css,
 * the skin withWidgetData() injects into the widgets the app embeds. Never
 * included by a widget template, so chat widgets keep the neutral look. Each
 * block mirrors a tokens.css block with the same selector and wins by coming
 * later. The accent and the nutrient colours are not redefined here. */

${faces}

:root {
${decl("    ", appEntries("light"))}
    --radius: 16px;
    --font-sans:
        ${FONT_SANS};
    --font-heading: "${APP_FONTS[1].family}", var(--font-sans);
}

@media (prefers-color-scheme: dark) {
    :root {
${decl("        ", appEntries("dark"))}
    }
}

:root[data-theme="light"] {
${decl("    ", appEntries("light"))}
}
:root[data-theme="dark"] {
${decl("    ", appEntries("dark"))}
}

body {
    font-family: var(--font-sans);
}
`;
}

// ---- v2 design tokens (FigCraft Theme + Tokens collections) ----------------

export type V2ColorName =
    | "surface/bg"
    | "surface/panel"
    | "surface/raised"
    | "surface/track"
    | "line"
    | "text/primary"
    | "text/secondary"
    | "text/tertiary"
    | "accent/fill"
    | "accent/text"
    | "accent/on"
    | "macro/protein"
    | "macro/carbs"
    | "macro/fat"
    | "macro/calories"
    | "nutrient/water"
    | "nutrient/fiber"
    | "nutrient/sugar"
    | "nutrient/caffeine"
    | "status/over"
    | "status/warn"
    | "overlay/glass"
    | "overlay/scrim"
    | "overlay/shadow";

/** FigCraft Theme collection, in design variable order. */
export const V2_THEME: Record<"dark" | "light", Record<V2ColorName, string>> = {
    dark: {
        "surface/bg": "#0d0f0e",
        "surface/panel": "#151817",
        "surface/raised": "#1c201e",
        "surface/track": "#232826",
        line: "#ffffff14",
        "text/primary": "#f2f6f4",
        "text/secondary": "#98a19c",
        "text/tertiary": "#5b6561",
        "accent/fill": "#28cf8b",
        "accent/text": "#28cf8b",
        "accent/on": "#062c1c",
        "macro/protein": "#a78bfa",
        "macro/carbs": "#34d399",
        "macro/fat": "#fb7199",
        "macro/calories": "#ffab2e",
        "nutrient/water": "#38bdf8",
        "nutrient/fiber": "#14b8a6",
        "nutrient/sugar": "#a3e635",
        "nutrient/caffeine": "#c69a6d",
        "status/over": "#ff6b52",
        "status/warn": "#e0a030",
        "overlay/glass": "#1c201ec7",
        "overlay/scrim": "#0000008c",
        "overlay/shadow": "#00000000",
    },
    light: {
        "surface/bg": "#fbfaf7",
        "surface/panel": "#ffffff",
        "surface/raised": "#f1f3f2",
        "surface/track": "#e4eae6",
        line: "#dde3df",
        "text/primary": "#121714",
        "text/secondary": "#5c6660",
        "text/tertiary": "#8c9590",
        "accent/fill": "#28cf8b",
        "accent/text": "#12875a",
        "accent/on": "#062c1c",
        "macro/protein": "#8b5cf6",
        "macro/carbs": "#10b981",
        "macro/fat": "#f43f7e",
        "macro/calories": "#ff9f0a",
        "nutrient/water": "#0ea5e9",
        "nutrient/fiber": "#0d9488",
        "nutrient/sugar": "#65a30d",
        "nutrient/caffeine": "#8b5e34",
        "status/over": "#d0452b",
        "status/warn": "#b26a00",
        "overlay/glass": "#ffffffd1",
        "overlay/scrim": "#141e1940",
        "overlay/shadow": "#0000000f",
    },
};

/** FigCraft Tokens collection: radius/* (px literals in CSS). */
export const V2_RADIUS = {
    sm: 12,
    md: 16,
    lg: 20,
    sheet: 28,
    pill: 999,
} as const;

/** FigCraft Tokens collection: space/* (px literals in CSS). */
export const V2_SPACE = {
    gutter: 20,
    section: 24,
    row: 11,
    gap: 8,
} as const;

/** FigCraft Tokens collection: font/*. */
export const V2_FONT = {
    display: "Bricolage Grotesque",
    body: "Geist",
} as const;

function v2CssKey(designName: string): string {
    return designName.replace(/\//g, "-");
}

function v2ColorDecls(t: "dark" | "light"): [string, string][] {
    return (Object.entries(V2_THEME[t]) as [V2ColorName, string][]).map(
        ([name, value]) => [v2CssKey(name), value],
    );
}

function v2ThemeBlock(t: "dark" | "light", indent: string): string {
    return [decl(indent, v2ColorDecls(t)), `${indent}color-scheme: ${t};`].join(
        "\n",
    );
}

function v2StaticDecls(indent: string): string {
    const radius: [string, string][] = Object.entries(V2_RADIUS).map(
        ([k, v]) => [`radius-${k}`, `${v}px`],
    );
    const space: [string, string][] = Object.entries(V2_SPACE).map(([k, v]) => [
        `space-${k}`,
        `${v}px`,
    ]);
    return [
        decl(indent, radius),
        decl(indent, space),
        line(indent, "font-body", `"${V2_FONT.body}", ${FONT_FALLBACK}`),
        line(indent, "font-display", `"${V2_FONT.display}", var(--font-body)`),
    ].join("\n");
}

const WIDGET_V2_SYSTEM_FONT =
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function v2WidgetStaticDecls(indent: string): string {
    const radius: [string, string][] = Object.entries(V2_RADIUS).map(
        ([k, v]) => [`radius-${k}`, `${v}px`],
    );
    const space: [string, string][] = Object.entries(V2_SPACE).map(([k, v]) => [
        `space-${k}`,
        `${v}px`,
    ]);
    return [
        decl(indent, radius),
        decl(indent, space),
        line(indent, "font-body", WIDGET_V2_SYSTEM_FONT),
        line(indent, "font-display", "var(--font-body)"),
        line(indent, "nutrient-alcohol", "var(--text-tertiary)"),
    ].join("\n");
}

/** public/widgets/src/shared/v2/tokens.css — MCP widgets v2 Theme palette. */
export function renderWidgetV2TokensCss(): string {
    return `/* Generated by scripts/gen-tokens.ts from src/tokens.ts. Edit the values
 * there, then run \`bun run gen:tokens\`; never edit this file.
 *
 * MCP chat widgets v2: FigCraft Theme palette (V2_THEME), system font only.
 * Follows hostContext.theme via data-theme (shared/bridge.js). */

:root {
${v2ThemeBlock("light", "    ")}
${v2WidgetStaticDecls("    ")}
}

@media (prefers-color-scheme: dark) {
    :root {
${v2ThemeBlock("dark", "        ")}
    }
}

:root[data-theme="light"] {
${v2ThemeBlock("light", "    ")}
}
:root[data-theme="dark"] {
${v2ThemeBlock("dark", "    ")}
}
`;
}

/** public/app/v2/tokens.css — v2 shell; not wired until UI-3. */
export function renderV2TokensCss(): string {
    return `/* Generated by scripts/gen-tokens.ts from src/tokens.ts. Edit the values
 * there, then run \`bun run gen:tokens\`; never edit this file.
 *
 * Values mirror design/figcraft-variables.json (FigCraft Theme + Tokens). No
 * @font-face here — brand.css already declares the faces, and the new shell
 * still loads /app.css. Included first by public/app/v2/app-v2.css, which
 * /app-v2.css is assembled from. */

:root {
${v2ThemeBlock("dark", "    ")}
${v2StaticDecls("    ")}
}

@media (prefers-color-scheme: light) {
    :root {
${v2ThemeBlock("light", "        ")}
    }
}

:root[data-theme="dark"] {
${v2ThemeBlock("dark", "    ")}
}
:root[data-theme="light"] {
${v2ThemeBlock("light", "    ")}
}
`;
}
