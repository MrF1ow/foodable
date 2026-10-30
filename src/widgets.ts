// Assembles the self-contained widget HTML from shared source partials at
// server startup, so the shared design tokens, components, and MCP Apps host
// bridge live in exactly one place instead of being copy-pasted into five files.
//
// Nothing generated is committed: sources live under public/widgets/src/
// (templates/ + shared/), and each widget is stitched together on first use
// (and warmed at boot) into a single inlined HTML string, then cached. The
// iframe CSP forbids external CSS/JS, so "reuse" means inlining the partials —
// which is exactly what the `@include` markers below do.
//
// Template syntax: a partial is pulled in with a marker that is a valid CSS *and*
// JS comment, so a template still parses on its own:
//
//     /*@include shared/tokens.css@*/
//     /*@include shared/bridge.js@*/
//
// Markers resolve relative to public/widgets/src/ and expand recursively.

import { WIDGET_STRINGS } from "./copy/widgets.js";
import { TOASTS } from "./copy/toasts.js";
import { isNutritionCard, NUTRITION_CARDS } from "./domain/layout.js";
import { THEME_COLOR, THEME_NAV_COLOR } from "./tokens.js";

const SRC_DIR = "./public/widgets/src";
const INCLUDE_RE = /\/\*@include\s+([^\s@]+)\s*@\*\//g;

// Second marker: inline a TypeScript module from src/ as plain JS.
//
//     /*@inlinets src/domain/csv.ts@*/
//
// Exists so a widget can use tested server-side code instead of a hand-copied
// twin. The CSV parser is the case in point: it faces arbitrary user files, so it
// belongs in src/ with fixture tests, but the widget needs it inside the iframe
// where nothing can be imported. Transpiling the real module keeps the two from
// drifting. Only works for modules with NO runtime imports (csv.ts has none) —
// there is no bundler here, just type-stripping.
const INLINE_TS_RE = /\/\*@inlinets\s+([^\s@]+)\s*@\*\//g;

async function inlineTs(relPath: string): Promise<string> {
    const file = Bun.file(`./${relPath}`);
    if (!(await file.exists())) {
        throw new Error(`@inlinets source not found: ${relPath}`);
    }
    const ts = await file.text();
    if (/^\s*import\s/m.test(ts)) {
        throw new Error(
            `@inlinets ${relPath} has runtime imports; only self-contained modules can be inlined`,
        );
    }
    const js = new Bun.Transpiler({ loader: "ts" }).transformSync(ts);
    // Strip module syntax: the result is spliced into a plain <script>, where a
    // bare `export` is a syntax error.
    return js
        .replace(/^export\s+default\s+/gm, "")
        .replace(/^export\s+/gm, "")
        .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "");
}

// Third marker: inline the widget UI-string dictionary as a plain-data JS
// const.
//
//     /*@i18n@*/
//
// Lives once, in shared/i18n.js (see that file for the runtime locale-pick/
// lookup helpers it defines around this data). Unlike @inlinets this has no
// source-file argument — WIDGET_STRINGS is a single, fixed, already-imported
// object (src/copy/widgets.ts) covering every locale, not a per-marker path.
// Plain JSON.stringify is enough because that dictionary is data-only (no
// functions) by design — see the doc comment on WidgetStrings.
const I18N_RE = /\/\*@i18n@\*\//g;

// ui:// resource name → template file under src/templates/.
export const WIDGET_TEMPLATES: Record<string, string> = {
    "nutrition-summary": "nutrition-summary.html",
    "goal-progress": "goal-progress.html",
    "meal-logged": "meal-logged.html",
    trends: "trends.html",
    "weight-trends": "weight-trends.html",
    "import-meals": "import-meals.html",
    "grocery-list": "grocery-list.html",
    fridge: "fridge.html",
    // Dev-only visual reference for the shared components. Listed here so it is
    // assembled and covered by widgets.test.ts, but NO ui:// resource and no
    // tool reference it, so no client can reach it. View via `bun run harness`.
    "component-gallery": "component-gallery.html",
};

const cache = new Map<string, string>();

async function readSrc(relPath: string): Promise<string> {
    const file = Bun.file(`${SRC_DIR}/${relPath}`);
    if (!(await file.exists())) {
        throw new Error(`widget source partial not found: ${relPath}`);
    }
    return file.text();
}

// Expand every @include marker in `text`, recursively, guarding against cycles.
async function resolveIncludes(
    text: string,
    fromPath: string,
    stack: string[],
): Promise<string> {
    const matches = [...text.matchAll(INCLUDE_RE)];
    if (matches.length === 0) return text;

    // Resolve each unique partial once, then substitute.
    const resolved = new Map<string, string>();
    for (const m of matches) {
        const rel = m[1];
        if (!rel || resolved.has(rel)) continue;
        if (stack.includes(rel)) {
            throw new Error(`@include cycle: ${[...stack, rel].join(" -> ")}`);
        }
        const raw = await readSrc(rel);
        resolved.set(rel, await resolveIncludes(raw, rel, [...stack, rel]));
    }
    return text.replace(INCLUDE_RE, (_full, rel) => resolved.get(rel) ?? "");
}

async function assemble(templateFile: string): Promise<string> {
    const template = await readSrc(`templates/${templateFile}`);
    const withPartials = await resolveIncludes(template, templateFile, [
        `templates/${templateFile}`,
    ]);

    // @inlinets and @i18n run after @include so a shared partial can pull
    // either in too.
    const tsMatches = [...withPartials.matchAll(INLINE_TS_RE)];
    const compiled = new Map<string, string>();
    for (const m of tsMatches) {
        const rel = m[1];
        if (!rel || compiled.has(rel)) continue;
        compiled.set(rel, await inlineTs(rel));
    }
    const withTs =
        tsMatches.length === 0
            ? withPartials
            : withPartials.replace(
                  INLINE_TS_RE,
                  (_full, rel) => compiled.get(rel) ?? "",
              );

    if (!I18N_RE.test(withTs)) return withTs;
    I18N_RE.lastIndex = 0;
    const stringsLiteral = `const WIDGET_STRINGS = ${JSON.stringify(WIDGET_STRINGS)};`;
    return withTs.replace(I18N_RE, stringsLiteral);
}

// Return the fully-inlined HTML for a widget, assembling+caching on first use.
export async function getWidgetHtml(key: string): Promise<string> {
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const templateFile = WIDGET_TEMPLATES[key];
    if (!templateFile) throw new Error(`unknown widget: ${key}`);
    const html = await assemble(templateFile);
    cache.set(key, html);
    return html;
}

// The household web app's stylesheet, served at /app.css. Assembled from the
// same shared partials as the widgets so the two surfaces cannot drift: its
// @include markers resolve against public/widgets/src/ exactly like a
// template's. Cached like a widget and warmed at boot.
export const APP_CSS_SOURCE = "./public/app/app.css";
let appCss: string | undefined;
let appCssHash: string | undefined;

async function shortContentHash(text: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
    );
    return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 12);
}

export function appStylesheetHref(): string {
    return appCssHash ? `/app.css?v=${appCssHash}` : "/app.css";
}

export function appScriptHref(): string {
    return appJsHash ? `/app.js?v=${appJsHash}` : "/app.js";
}

export async function getAppCss(): Promise<string> {
    if (appCss !== undefined) return appCss;
    const file = Bun.file(APP_CSS_SOURCE);
    if (!(await file.exists())) {
        throw new Error(`app stylesheet source not found: ${APP_CSS_SOURCE}`);
    }
    appCss = await resolveIncludes(await file.text(), APP_CSS_SOURCE, [
        APP_CSS_SOURCE,
    ]);
    appCssHash = await shortContentHash(appCss);
    return appCss;
}

// The household web app's client bundle, served at /app.js. Each file is
// plain browser JS with no imports; getAppJs wraps one IIFE per file so
// they cannot leak into each other. Cached and warmed like getAppCss.
export const APP_JS_SOURCES = [
    "./src/web/client/shell.js",
    "./src/web/client/toast.js",
    "./src/web/client/food-picker.js",
    "./src/web/client/nutrition-log.js",
    "./src/web/client/grocery.js",
    "./src/web/client/fridge.js",
    "./src/web/client/modal.js",
    "./src/web/client/arrange.js",
] as const;
const TURBO_ENTRY = "./src/web/client/turbo-entry.ts";
let turboBundle: string | undefined;
let appJs: string | undefined;
let appJsHash: string | undefined;

async function getTurboBundle(): Promise<string> {
    if (turboBundle !== undefined) return turboBundle;
    const result = await Bun.build({
        entrypoints: [TURBO_ENTRY],
        format: "iife",
        minify: true,
        target: "browser",
    });
    if (!result.success) {
        throw new Error(
            `Turbo bundle failed: ${result.logs.map((l) => l.message).join("; ")}`,
        );
    }
    turboBundle = await result.outputs[0]!.text();
    return turboBundle;
}

export async function getAppJs(): Promise<string> {
    if (appJs !== undefined) return appJs;
    const parts: string[] = [await getTurboBundle()];
    for (const path of APP_JS_SOURCES) {
        const file = Bun.file(path);
        if (!(await file.exists())) {
            throw new Error(`app client source not found: ${path}`);
        }
        let src = (await file.text()).trim();
        if (path.endsWith("shell.js")) {
            src = src
                .replace(
                    "const THEME_PAGE_BG = null;",
                    `const THEME_PAGE_BG = ${JSON.stringify(THEME_COLOR)};`,
                )
                .replace(
                    "const THEME_NAV_BG = null;",
                    `const THEME_NAV_BG = ${JSON.stringify(THEME_NAV_COLOR)};`,
                );
        }
        if (path.endsWith("toast.js")) {
            src = src.replace(
                "const TOAST_CATALOG = null;",
                `const TOAST_CATALOG = ${JSON.stringify(TOASTS)};`,
            );
        }
        parts.push(`(function () {\n${src}\n})();`);
    }
    appJs = parts.join("\n");
    appJsHash = await shortContentHash(appJs);
    return appJs;
}

export type WidgetViewerChrome = {
    theme: "light" | "dark" | "system";
    // CSS appended as the frame's last <style> (the app's embed skin, see
    // getEmbedCss). Chat hosts never pass one.
    skin?: string;
};

// The skin the household app injects into the widgets it embeds: the app's
// brand layer (palette, fonts) on top of the widget's own tokens, so an
// embedded card matches the page while the same widget served over MCP keeps
// its neutral look. Assembled like app.css, cached and warmed at boot.
export const EMBED_CSS_SOURCE = "./public/app/embed.css";
let embedCss: string | undefined;

export async function getEmbedCss(): Promise<string> {
    if (embedCss !== undefined) return embedCss;
    const file = Bun.file(EMBED_CSS_SOURCE);
    if (!(await file.exists())) {
        throw new Error(`embed skin source not found: ${EMBED_CSS_SOURCE}`);
    }
    embedCss = await resolveIncludes(await file.text(), EMBED_CSS_SOURCE, [
        EMBED_CSS_SOURCE,
    ]);
    return embedCss;
}

// First script in the dashboard frame, before any <style>, so an explicit
// theme is on <html> before the first paint. Same-origin, so frameElement is
// the page's <iframe> and dataset.widgetData is the per-request JSON. Opened
// directly, frameElement is null and __WIDGET_DATA__ stays unset: the bridge
// then paints its sample, as a chat widget opened on its own does today.
const WIDGET_FRAME_SEED = `<script>
(function () {
    const frame = window.frameElement;
    if (!frame) return;
    const raw = frame.dataset.widgetData;
    if (raw) {
        try {
            window.__WIDGET_DATA__ = JSON.parse(raw);
        } catch (_) {}
    }
    const theme = frame.getAttribute("data-theme");
    if (theme === "light" || theme === "dark") {
        document.documentElement.setAttribute("data-theme", theme);
    }
})();
</script>`;

// The document GET /app/widgets/:key serves: assembled widget, seed script,
// embed skin. No per-request data and no theme stamp — those ride on the
// framing element. getWidgetHtml (the MCP ui:// resource) never comes through
// here, so chat widgets stay skin-free and unseeded.
export function embedWidgetDocument(html: string, skin: string): string {
    const unthemed = html.replace(/\sdata-theme="[^"]*"/g, "");
    const seeded = unthemed.replace(
        /<head\b[^>]*>/i,
        (open) => `${open}\n${WIDGET_FRAME_SEED}`,
    );
    // A function replacement, so a `$` in the CSS is never read as a pattern.
    return seeded.replace("</head>", () => `<style>${skin}</style></head>`);
}

const embedWidgetCache = new Map<string, { html: string; hash: string }>();

export async function getEmbedWidgetHtml(
    key: string,
): Promise<{ html: string; hash: string }> {
    const cached = embedWidgetCache.get(key);
    if (cached) return cached;
    if (!isNutritionCard(key)) {
        throw new Error(`widget is not embedded on the dashboard: ${key}`);
    }
    const html = embedWidgetDocument(
        await getWidgetHtml(key),
        await getEmbedCss(),
    );
    const entry = { html, hash: await shortContentHash(html) };
    embedWidgetCache.set(key, entry);
    return entry;
}

// withWidgetData still seeds a self-contained document for callers that embed
// via srcdoc. The dashboard does not: it frames /app/widgets/:key and puts
// the JSON on the iframe. An explicit viewer theme is stamped on the widget's
// <html>; "system" leaves the attribute off and the widget follows
// prefers-color-scheme, as the page does. The accent is never overridden:
// there is one brand green.
function applyViewerTheme(html: string, chrome: WidgetViewerChrome): string {
    const withoutTheme = html.replace(/\sdata-theme="[^"]*"/g, "");
    if (chrome.theme === "system") return withoutTheme;
    return withoutTheme.replace(
        /<html\b/i,
        `<html data-theme="${chrome.theme}"`,
    );
}

export function withWidgetData(
    html: string,
    data: unknown,
    chrome?: WidgetViewerChrome,
): string {
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    const seeded = html.replace(
        "<script>",
        `<script>window.__WIDGET_DATA__=${json};`,
    );
    if (!chrome) return seeded;
    // A function replacement, so a `$` in the CSS is never read as a pattern.
    const skinned = chrome.skin
        ? seeded.replace(
              "</head>",
              () => `<style>${chrome.skin}</style></head>`,
          )
        : seeded;
    return applyViewerTheme(skinned, chrome);
}

// Assemble every widget, the app stylesheet, the embed skin, and the app
// client bundle once, so a broken partial or marker fails fast at startup
// rather than on a client's first request.
export async function warmWidgets(): Promise<void> {
    await Promise.all([
        ...Object.keys(WIDGET_TEMPLATES).map((key) => getWidgetHtml(key)),
        getAppCss(),
        getEmbedCss(),
        getAppJs(),
    ]);
    // Hashes of the framed documents. After the widgets and the skin are
    // cached, so boot does not assemble them twice.
    await Promise.all(NUTRITION_CARDS.map((key) => getEmbedWidgetHtml(key)));
}
