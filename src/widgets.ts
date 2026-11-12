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

import { fileURLToPath } from "node:url";
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

const WIDGET_JS_MINIFIER = new Bun.Transpiler({
    loader: "js",
    minifyWhitespace: true,
});

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

// Widget keys with a v2 template but no v1 twin (later phases). v1 getWidgetHtml
// does not resolve these keys; MCP v2 URIs may once templates land.
export const WIDGET_TEMPLATES_V2: Record<string, string> = {
    attention: "attention.html",
};

/** Per-widget size caps for assembled MCP widget HTML (bytes = 1024). */
export const WIDGET_BUDGETS: Record<string, { raw: number; gzip: number }> =
    Object.fromEntries(
        [
            ...new Set([
                ...Object.keys(WIDGET_TEMPLATES),
                ...Object.keys(WIDGET_TEMPLATES_V2),
            ]),
        ].map((key) => [
            key,
            key === "import-meals"
                ? { raw: 80 * 1024, gzip: 24 * 1024 }
                : { raw: 60 * 1024, gzip: 20 * 1024 },
        ]),
    );

export type WidgetHtmlOptions = { v2?: boolean };

/** v2 template with no v1 twin — the harness must frame the v2 assembly. */
export function harnessNeedsV2(key: string): boolean {
    return key in WIDGET_TEMPLATES_V2 && !(key in WIDGET_TEMPLATES);
}

/** Every assembly the server can serve: v1 for each v1 template, v2 for every key. */
export function widgetAssemblies(): { key: string; v2: boolean }[] {
    return [
        ...Object.keys(WIDGET_TEMPLATES).map((key) => ({ key, v2: false })),
        ...[
            ...new Set([
                ...Object.keys(WIDGET_TEMPLATES),
                ...Object.keys(WIDGET_TEMPLATES_V2),
            ]),
        ].map((key) => ({ key, v2: true })),
    ];
}

function cacheKey(key: string, v2: boolean): string {
    return v2 ? `${key}:v2` : key;
}

// Per instance by design: assembled widget HTML keyed by widget key and variant; identical bytes on every instance for the same build.
const cache = new Map<string, string>();

async function resolveTemplateRelPath(
    key: string,
    v2: boolean,
): Promise<string> {
    if (v2) {
        const v2Only = WIDGET_TEMPLATES_V2[key];
        if (v2Only) return `templates/v2/${v2Only}`;
        const v1File = WIDGET_TEMPLATES[key];
        if (!v1File) throw new Error(`unknown widget: ${key}`);
        const v2Rel = `templates/v2/${v1File}`;
        if (await Bun.file(`${SRC_DIR}/${v2Rel}`).exists()) return v2Rel;
        return `templates/${v1File}`;
    }
    const v1File = WIDGET_TEMPLATES[key];
    if (!v1File) throw new Error(`unknown widget: ${key}`);
    return `templates/${v1File}`;
}

/** Template filename (no v2/ prefix) for a widget key — used for ui:// URIs. */
export function widgetTemplateName(
    key: string,
    opts?: WidgetHtmlOptions,
): string {
    const v2 = opts?.v2 === true;
    if (v2) {
        return WIDGET_TEMPLATES_V2[key] ?? WIDGET_TEMPLATES[key] ?? "";
    }
    return WIDGET_TEMPLATES[key] ?? "";
}

async function readSrc(
    relPath: string,
    baseDir: string = SRC_DIR,
): Promise<string> {
    const file = Bun.file(`${baseDir}/${relPath}`);
    if (!(await file.exists())) {
        throw new Error(`widget source partial not found: ${relPath}`);
    }
    return file.text();
}

// Expand every @include marker in `text`, recursively, guarding against cycles.
// Markers resolve against `baseDir` (public/widgets/src/ unless a caller names
// another root, as /app-v2.css does with public/app/v2/).
async function resolveIncludes(
    text: string,
    fromPath: string,
    stack: string[],
    baseDir: string = SRC_DIR,
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
        const raw = await readSrc(rel, baseDir);
        resolved.set(
            rel,
            await resolveIncludes(raw, rel, [...stack, rel], baseDir),
        );
    }
    return text.replace(INCLUDE_RE, (_full, rel) => resolved.get(rel) ?? "");
}

async function assembleTemplateRelPath(templateRel: string): Promise<string> {
    const template = await readSrc(templateRel);
    const withPartials = await resolveIncludes(template, templateRel, [
        templateRel,
    ]);

    // @inlinets runs after @include so a shared partial can pull it in too.
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

    return withTs;
}

/** Unminified widget document (partials expanded). */
export async function assembleSource(
    key: string,
    opts?: WidgetHtmlOptions,
): Promise<string> {
    return assembleTemplateRelPath(
        await resolveTemplateRelPath(key, opts?.v2 === true),
    );
}

function stripCssBlockComments(css: string): string {
    let out = "";
    let i = 0;
    while (i < css.length) {
        const ch = css[i]!;
        if (ch === '"' || ch === "'") {
            const quote = ch;
            out += ch;
            i++;
            while (i < css.length) {
                const c = css[i]!;
                out += c;
                if (c === "\\" && i + 1 < css.length) {
                    out += css[i + 1];
                    i += 2;
                    continue;
                }
                if (c === quote) {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (ch === "/" && css[i + 1] === "*") {
            i += 2;
            while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) {
                i++;
            }
            i += 2;
            continue;
        }
        out += ch;
        i++;
    }
    return out;
}

function minifyCssInStrings(css: string, fn: (s: string) => string): string {
    let out = "";
    let i = 0;
    while (i < css.length) {
        const ch = css[i]!;
        if (ch === '"' || ch === "'") {
            const quote = ch;
            let lit = ch;
            i++;
            while (i < css.length) {
                const c = css[i]!;
                lit += c;
                if (c === "\\" && i + 1 < css.length) {
                    lit += css[i + 1];
                    i += 2;
                    continue;
                }
                if (c === quote) {
                    i++;
                    break;
                }
                i++;
            }
            out += lit;
            continue;
        }
        const rest = css.slice(i);
        const m = rest.match(/^[^{}'"]+/);
        if (m) {
            out += fn(m[0]);
            i += m[0].length;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}

function collapseCssWhitespace(chunk: string): string {
    return chunk
        .replace(/\s*\{\s*/g, "{")
        .replace(/\s*\}\s*/g, "}")
        .replace(/\s*;\s*/g, ";")
        .replace(/,\s+/g, ",");
}

/** Conservative CSS minify for inline widget `<style>` bodies. */
export function minifyCss(css: string): string {
    const noComments = stripCssBlockComments(css);
    const lines = noComments
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const joined = lines.join("\n");
    return minifyCssInStrings(joined, collapseCssWhitespace);
}

function trimHtmlLeadingIndent(html: string): string {
    const lines = html.split("\n");
    let minIndent = Infinity;
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        const m = line.match(/^(\s+)/);
        if (m) minIndent = Math.min(minIndent, m[1]!.length);
        else {
            minIndent = 0;
            break;
        }
    }
    if (!Number.isFinite(minIndent) || minIndent === 0) {
        return lines.map((l) => l.trimEnd()).join("\n");
    }
    return lines
        .map((line) =>
            line.trim().length === 0 ? "" : line.slice(minIndent).trimEnd(),
        )
        .join("\n");
}

// Bun's whitespace minifier also drops directive prologues, which would
// silently turn a strict widget script into a sloppy one. Put it back.
const USE_STRICT_RE = /^\s*(["'])use strict\1\s*;?/;

function minifyScript(js: string): string {
    const min = WIDGET_JS_MINIFIER.transformSync(js);
    return USE_STRICT_RE.test(js) && !USE_STRICT_RE.test(min)
        ? `"use strict";${min}`
        : min;
}

const BLOCK_RE =
    /(<script\b[^>]*>)([\s\S]*?)(<\/script[^>]*>)|(<style\b[^>]*>)([\s\S]*?)(<\/style[^>]*>)/gi;

/** Minify assembled MCP widget HTML (scripts, styles, trim HTML indent). */
export function minifyWidgetHtml(html: string): string {
    const parts: string[] = [];
    let lastIndex = 0;
    for (const m of html.matchAll(BLOCK_RE)) {
        const index = m.index ?? 0;
        if (index > lastIndex) {
            parts.push(trimHtmlLeadingIndent(html.slice(lastIndex, index)));
        }
        if (m[1] !== undefined) {
            const open = m[1];
            const body = m[2] ?? "";
            const close = m[3] ?? "";
            parts.push(`${open}${minifyScript(body)}${close}`);
        } else if (m[4] !== undefined) {
            const open = m[4];
            const body = m[5] ?? "";
            const close = m[6] ?? "";
            parts.push(`${open}${minifyCss(body)}${close}`);
        }
        lastIndex = index + m[0].length;
    }
    if (lastIndex < html.length) {
        parts.push(trimHtmlLeadingIndent(html.slice(lastIndex)));
    }
    return parts.join("");
}

// Return the fully-inlined HTML for a widget, assembling+caching on first use.
export async function getWidgetHtml(
    key: string,
    opts?: WidgetHtmlOptions,
): Promise<string> {
    const v2 = opts?.v2 === true;
    const ck = cacheKey(key, v2);
    const cached = cache.get(ck);
    if (cached !== undefined) return cached;
    const raw = await assembleSource(key, opts);
    const html = minifyWidgetHtml(raw);
    cache.set(ck, html);
    return html;
}

// The household web app's stylesheet, served at /app.css. Assembled from
// public/app/app.css with the widget resolver, so its @include markers resolve
// against public/widgets/src/: the generated shared/tokens.css is the only
// widget partial it shares, and its own partials are ../../app/… paths. It is
// not minified. Cached like a widget and warmed at boot.
export const APP_CSS_SOURCE = "./public/app/app.css";
// Per instance by design: /app.css bytes and content hash; same on every instance after warmWidgets.
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

export function appV2StylesheetHref(): string {
    return appV2CssHash ? `/app-v2.css?v=${appV2CssHash}` : "/app-v2.css";
}

export function appV2ScriptHref(): string {
    return appV2JsHash ? `/app-v2.js?v=${appV2JsHash}` : "/app-v2.js";
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
    "./src/web/client/usual-buy.js",
    // Before modal.js so a shared dialog is filled before focus moves.
    "./src/web/client/dialog-fill.js",
    "./src/web/client/modal.js",
    "./src/web/client/arrange.js",
    "./src/web/client/copy-prompt.js",
    "./src/web/client/busy-submit.js",
    "./src/web/client/sw-register.js",
] as const;
const TURBO_ENTRY = "./src/web/client/turbo-entry.ts";
// Per instance by design: /app.js bundle and hash; built once per process at boot.
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
                    () =>
                        `const THEME_PAGE_BG = ${JSON.stringify(THEME_COLOR)};`,
                )
                .replace(
                    "const THEME_NAV_BG = null;",
                    () =>
                        `const THEME_NAV_BG = ${JSON.stringify(THEME_NAV_COLOR)};`,
                );
        }
        if (path.endsWith("toast.js")) {
            src = src.replace(
                "const TOAST_CATALOG = null;",
                () => `const TOAST_CATALOG = ${JSON.stringify(TOASTS)};`,
            );
        }
        parts.push(`(function () {\n${src}\n})();`);
    }
    appJs = parts.join("\n");
    appJsHash = await shortContentHash(appJs);
    return appJs;
}

// The new shell's stylesheet and script (flag `ui-v2`), served at /app-v2.css
// and /app-v2.js next to the old pair, which the new shell also loads. Both are
// hashed and warmed like the old ones.
//
// app-v2.css is assembled from public/app/v2/app-v2.css. Its @include markers
// resolve against public/app/v2/ (APP_V2_CSS_DIR), not public/widgets/src/:
// that file holds the one include list (tokens.css, then one partial per area),
// so a later item adds its partial with a single line there.
//
// app-v2.js is an ordered list of plain browser files, one IIFE each, like
// APP_JS_SOURCES. There is no Turbo bundle here: /app.js already has it.
export const APP_V2_CSS_DIR = "./public/app/v2";
export const APP_V2_CSS_SOURCE = `${APP_V2_CSS_DIR}/app-v2.css`;
// Per instance by design: /app-v2.css bytes and hash; warmed at boot.
let appV2Css: string | undefined;
let appV2CssHash: string | undefined;

export async function getAppV2Css(): Promise<string> {
    if (appV2Css !== undefined) return appV2Css;
    const file = Bun.file(APP_V2_CSS_SOURCE);
    if (!(await file.exists())) {
        throw new Error(
            `app-v2 stylesheet source not found: ${APP_V2_CSS_SOURCE}`,
        );
    }
    appV2Css = await resolveIncludes(
        await file.text(),
        "app-v2.css",
        ["app-v2.css"],
        APP_V2_CSS_DIR,
    );
    appV2CssHash = await shortContentHash(appV2Css);
    return appV2Css;
}

export const APP_V2_JS_SOURCES = [
    "./src/web/client/v2/shell.js",
    "./src/web/client/v2/sheet.js",
    "./src/web/client/v2/stepper.js",
    "./src/web/client/v2/swipe-rows.js",
    "./src/web/client/v2/scanner-pick.js",
    "./src/web/client/v2/scanner.js",
    "./src/web/client/v2/log-sheet.js",
    "./src/web/client/v2/recipes.js",
    "./src/web/client/v2/cook-sheet.js",
    "./src/web/client/v2/trends.js",
    "./src/web/client/v2/today.js",
    "./src/web/client/v2/kitchen.js",
    "./src/web/client/v2/stores.js",
    "./src/web/client/v2/score-settings.js",
    "./src/web/client/v2/share-link.js",
] as const;

const SCANNER_ZXING_ENTRY = "./src/web/client/v2/scanner-zxing-entry.js";
const SCANNER_WASM_PKG = "zxing-wasm/reader/zxing_reader.wasm";
// Per instance by design: lazy decoder chunk and wasm; built once per process at boot.
let scannerZxingJs: string | undefined;
let scannerZxingJsHash: string | undefined;
let scannerWasmBytes: ArrayBuffer | undefined;
let scannerWasmHash: string | undefined;
let scannerAssetsUnavailable = false;
let scannerWarmFailureLogged = false;

export class ScannerAssetsUnavailable extends Error {
    constructor(message = "scanner assets unavailable") {
        super(message);
        this.name = "ScannerAssetsUnavailable";
    }
}

function scannerWasmPath(): string {
    return fileURLToPath(import.meta.resolve(SCANNER_WASM_PKG));
}

async function buildScannerZxingBundle(): Promise<string> {
    const result = await Bun.build({
        entrypoints: [SCANNER_ZXING_ENTRY],
        format: "iife",
        minify: true,
        target: "browser",
    });
    if (!result.success) {
        throw new Error(
            `scanner zxing bundle failed: ${result.logs.map((l) => l.message).join("; ")}`,
        );
    }
    return await result.outputs[0]!.text();
}

export async function getScannerZxingJs(): Promise<string> {
    if (scannerAssetsUnavailable) {
        throw new ScannerAssetsUnavailable();
    }
    if (scannerZxingJs !== undefined) return scannerZxingJs;
    try {
        scannerZxingJs = await buildScannerZxingBundle();
        scannerZxingJsHash = await shortContentHash(scannerZxingJs);
        return scannerZxingJs;
    } catch (err) {
        scannerAssetsUnavailable = true;
        throw err instanceof ScannerAssetsUnavailable
            ? err
            : new ScannerAssetsUnavailable(
                  err instanceof Error ? err.message : String(err),
              );
    }
}

export async function getScannerWasm(): Promise<ArrayBuffer> {
    if (scannerAssetsUnavailable) {
        throw new ScannerAssetsUnavailable();
    }
    if (scannerWasmBytes !== undefined) return scannerWasmBytes;
    try {
        const file = Bun.file(scannerWasmPath());
        if (!(await file.exists())) {
            throw new Error(
                `scanner wasm missing in zxing-wasm: ${SCANNER_WASM_PKG}`,
            );
        }
        scannerWasmBytes = await file.arrayBuffer();
        scannerWasmHash = await shortContentHash(
            new TextDecoder("latin1").decode(new Uint8Array(scannerWasmBytes)),
        );
        return scannerWasmBytes;
    } catch (err) {
        scannerAssetsUnavailable = true;
        throw err instanceof ScannerAssetsUnavailable
            ? err
            : new ScannerAssetsUnavailable(
                  err instanceof Error ? err.message : String(err),
              );
    }
}

/** Boot-time warm for the lazy scanner chunk; failures are non-fatal. */
export async function warmScannerAssets(): Promise<boolean> {
    if (scannerAssetsUnavailable) return false;
    try {
        await getScannerZxingJs();
        await getScannerWasm();
        return true;
    } catch (err) {
        scannerAssetsUnavailable = true;
        if (!scannerWarmFailureLogged) {
            scannerWarmFailureLogged = true;
            console.error(
                "Scanner assets unavailable; /app-v2-scanner.* will return 503:",
                err instanceof Error ? err.message : err,
            );
        }
        return false;
    }
}

/** Clears cached scanner asset state (tests only). */
export function resetScannerAssetsForTest(): void {
    scannerZxingJs = undefined;
    scannerZxingJsHash = undefined;
    scannerWasmBytes = undefined;
    scannerWasmHash = undefined;
    scannerAssetsUnavailable = false;
    scannerWarmFailureLogged = false;
}

export function scannerZxingScriptHref(): string {
    return scannerZxingJsHash
        ? `/app-v2-scanner.js?v=${scannerZxingJsHash}`
        : "/app-v2-scanner.js";
}

export function scannerWasmHref(): string {
    return scannerWasmHash
        ? `/app-v2-scanner.wasm?v=${scannerWasmHash}`
        : "/app-v2-scanner.wasm";
}
// Per instance by design: /app-v2.js bytes and hash; warmed at boot.
let appV2Js: string | undefined;
let appV2JsHash: string | undefined;

export async function getAppV2Js(): Promise<string> {
    if (appV2Js !== undefined) return appV2Js;
    const parts: string[] = [];
    for (const path of APP_V2_JS_SOURCES) {
        const file = Bun.file(path);
        if (!(await file.exists())) {
            throw new Error(`app-v2 client source not found: ${path}`);
        }
        parts.push(`(function () {\n${(await file.text()).trim()}\n})();`);
    }
    appV2Js = parts.join("\n");
    appV2JsHash = await shortContentHash(appV2Js);
    return appV2Js;
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
// Per instance by design: embed skin CSS for dashboard widget iframes; warmed at boot.
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

// Per instance by design: dashboard embed documents keyed by widget; warmed at boot, no cross-instance sharing needed.
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
        () => `<html data-theme="${chrome.theme}"`,
    );
}

export function withWidgetData(
    html: string,
    data: unknown,
    chrome?: WidgetViewerChrome,
): string {
    const json = JSON.stringify(data).replace(/</g, "\\u003c");
    // A function replacement, so a `$` in the data is not a pattern.
    const seeded = html.replace(
        "<script>",
        () => `<script>window.__WIDGET_DATA__=${json};`,
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
        ...widgetAssemblies().map(({ key, v2 }) => getWidgetHtml(key, { v2 })),
        getAppCss(),
        getEmbedCss(),
        getAppJs(),
        getAppV2Css(),
        getAppV2Js(),
        warmScannerAssets(),
    ]);
    // Hashes of the framed documents. After the widgets and the skin are
    // cached, so boot does not assemble them twice.
    await Promise.all(NUTRITION_CARDS.map((key) => getEmbedWidgetHtml(key)));
}
