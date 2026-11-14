import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
    APP_V2_JS_SOURCES,
    appV2ScriptHref,
    appV2StylesheetHref,
    getAppV2Css,
    getAppV2Js,
    getScannerWasm,
    getScannerZxingJs,
    getWidgetHtml,
    scannerWasmHref,
    scannerZxingScriptHref,
    WIDGET_TEMPLATES,
} from "./widgets.js";

async function shortHash(text: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(text),
    );
    return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .slice(0, 12);
}

function customPropertiesDefined(css: string): Set<string> {
    const names = new Set<string>();
    for (const m of css.matchAll(/--([a-zA-Z0-9-]+)\s*:/g)) {
        names.add(`--${m[1]}`);
    }
    return names;
}

function undefinedVarRefs(css: string): string[] {
    const defined = customPropertiesDefined(css);
    const missing = new Set<string>();
    for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)(\s*,|\s*\))/g)) {
        const name = m[1];
        const tail = m[2];
        if (!name || !tail) continue;
        if (tail.trim().startsWith(",")) continue;
        if (!defined.has(name)) missing.add(name);
    }
    return [...missing].sort();
}

describe("/app-v2.css", () => {
    test("every var() without a fallback references a property defined in the bundle", async () => {
        const css = await getAppV2Css();
        expect(undefinedVarRefs(css)).toEqual([]);
    });

    test("assembles tokens first, then the shell partial, with no unresolved include", async () => {
        const css = await getAppV2Css();
        expect(css).not.toContain("/*@include");
        const tokens = readFileSync("./public/app/v2/tokens.css", "utf8");
        const shell = readFileSync("./public/app/v2/shell.css", "utf8");
        const components = readFileSync(
            "./public/app/v2/components.css",
            "utf8",
        );
        const sheet = readFileSync("./public/app/v2/sheet.css", "utf8");
        expect(css).toContain(tokens.trim());
        expect(css).toContain(shell.trim());
        expect(css).toContain(components.trim());
        expect(css).toContain(sheet.trim());
        expect(css.indexOf(tokens.trim())).toBeLessThan(
            css.indexOf(shell.trim()),
        );
        expect(css.indexOf(shell.trim())).toBeLessThan(
            css.indexOf(components.trim()),
        );
        expect(css).toContain("--surface-bg: #0d0f0e");
        expect(css).toContain(".fd-tabs");
        expect(css).toContain(".fd-row--swipe");
        expect(css).toContain(".fd-sheet");
    });

    test("is content-hashed", async () => {
        const css = await getAppV2Css();
        expect(appV2StylesheetHref()).toBe(
            `/app-v2.css?v=${await shortHash(css)}`,
        );
    });

    test("the shell partial uses tokens, never a literal colour", () => {
        const shell = readFileSync("./public/app/v2/shell.css", "utf8").replace(
            /\/\*[\s\S]*?\*\//g,
            "",
        );
        expect(shell.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
        expect(shell.match(/\b(?:rgba?|hsla?|oklch)\(/g)).toBeNull();
    });

    test("round icon buttons opt out of the old app's 44px button floor", async () => {
        // /app.css gives every `.native button` min-height: 44px (zero
        // specificity). A circle that only sets width and height 32px renders
        // 32 x 44: a tall oval. Each one resets both minimums and stays square.
        const css = (await getAppV2Css()).replace(/\/\*[\s\S]*?\*\//g, "");
        for (const selector of [
            ".fd-sheet .fd-sheet-close",
            ".fd-icon-btn",
            ".fd-scanner-icon-btn",
            ".fd-star",
            ".fd-shell .modal-close",
        ]) {
            const at = css.indexOf(`${selector} {`);
            expect(at, selector).toBeGreaterThanOrEqual(0);
            const block = css.slice(at, css.indexOf("}", at));
            expect(block, selector).toMatch(/min-height:\s*0\b/);
            expect(block, selector).toMatch(/min-width:\s*0\b/);
            expect(block, selector).toMatch(/aspect-ratio:\s*1\b/);
        }
    });

    test("the Trends range tabs share the Kitchen tab CSS and the year shows on desktop only", () => {
        const css = readFileSync("./public/app/v2/trends.css", "utf8").replace(
            /\/\*[\s\S]*?\*\//g,
            "",
        );
        const shell = readFileSync("./public/app/v2/shell.css", "utf8");
        // One rule set for both: Kitchen and Trends tabs share selectors, the
        // track ends at the last tab and the active tab is the green underline.
        expect(shell).toMatch(
            /\.fd-kitchen-tabs,\s*\.fd-utabs\s*{[^}]*width:\s*fit-content/,
        );
        expect(shell).toMatch(
            /\.fd-kitchen-tab\[aria-current="page"\]::after,\s*\.fd-utab\[aria-pressed="true"\]::after\s*{\s*background:\s*var\(--accent-fill\)/,
        );
        expect(css).not.toContain(".fd-seg");
        expect(css).toMatch(/\.fd-utab--desktop-only\s*{\s*display:\s*none/);
        // The year shows on the phone while it is the active range
        // (?range=365), so the row never has no highlighted tab.
        expect(css).toMatch(
            /\.fd-utab--desktop-only\[aria-pressed="true"\]\s*{\s*display:\s*flex/,
        );
        // The single desktop block stays last; no max-width queries.
        expect(css.match(/@media \(min-width: 1024px\)/g)?.length).toBe(1);
        expect(css).not.toMatch(/@media[^{]*max-width/);
    });

    test("Kitchen tab pages sit one 16px step under the tabs and keep Add and Share out of flow", () => {
        const css = readFileSync("./public/app/v2/kitchen.css", "utf8").replace(
            /\/\*[\s\S]*?\*\//g,
            "",
        );
        // The shell's sibling gap (--gap-section) plus the tabs' 16px bottom
        // margin made it 30px; the three pages take that gap back, and the
        // single desktop block puts them back under the header.
        const pull = css.indexOf(
            ".fd-kitchen-usuals-page {\n    position: relative",
        );
        expect(pull).toBeGreaterThanOrEqual(0);
        expect(css.slice(pull, css.indexOf("}", pull))).toMatch(
            /margin-top:\s*calc\(-1 \* var\(--gap-section/,
        );
        const desktop = css.slice(css.indexOf("@media (min-width: 1024px)"));
        expect(desktop).toMatch(
            /\.fd-kitchen-groceries-page {[^}]*margin-top:\s*0/,
        );
        expect(desktop).toMatch(
            /\.fd-kitchen-usuals-page {[^}]*margin-top:\s*0/,
        );
        // Add and Share are absolutely placed beside the tabs: no fixed
        // negative margins pulling a row up into them.
        const tools = css.indexOf(".fd-kitchen-fridge-top {");
        expect(css.slice(tools, css.indexOf("}", tools))).toMatch(
            /position:\s*absolute/,
        );
        expect(css).not.toMatch(/margin-top:\s*calc\(-1 \* \(28px/);
        // Share is the same 34px circle as Add on the phone (icon only), so
        // it cannot cover the end of the Usuals tab on a narrow screen.
        expect(css).toMatch(
            /\.fd-kitchen-fridge-top \.fd-kitchen-grocery-share {[^}]*width:\s*34px/,
        );
    });

    test("Help titles are plain, not capitals; Kitchen has no per-tab title classes", () => {
        const help = readFileSync("./public/app/v2/settings.css", "utf8");
        const at = help.indexOf(".fd-settings-help__summary {");
        expect(at).toBeGreaterThanOrEqual(0);
        expect(help.slice(at, help.indexOf("}", at))).not.toContain(
            "uppercase",
        );
        const kitchen = readFileSync("./public/app/v2/kitchen.css", "utf8");
        expect(kitchen).not.toContain("fd-kitchen-grocery-title");
        expect(kitchen).not.toContain("fd-kitchen-usual-title");
        expect(kitchen).not.toContain("fd-kitchen-usual-head");
    });

    test("one breakpoint: a single 1024px media query", () => {
        const shell = readFileSync("./public/app/v2/shell.css", "utf8");
        expect(shell.match(/@media \(min-width: 1024px\)/g)?.length).toBe(1);
        expect(shell.match(/min-width:\s*\d+px/g)).toEqual([
            "min-width: 1024px",
        ]);
        expect(shell.match(/max-width/g)).toBeNull();
    });

    test("every class defined is fd- prefixed", () => {
        const shell = readFileSync("./public/app/v2/shell.css", "utf8").replace(
            /\/\*[\s\S]*?\*\//g,
            "",
        );
        const selectors = shell.match(/\.[a-zA-Z][\w-]*/g) ?? [];
        const foreign = new Set(
            selectors
                .map((s) => s.slice(1))
                .filter(
                    (c) =>
                        !c.startsWith("fd-") &&
                        ![
                            "app-main",
                            "toast-region",
                            "dash-head",
                            "dash-head-title-row",
                            "modal-close",
                        ].includes(c) &&
                        !/^\d/.test(c),
                ),
        );
        // app-main and toast-region belong to the old stylesheet and are
        // restyled here; dash-head and its title row (components/ui.ts
        // pageHeader) are kept clear of the account chip; modal-close is the
        // old dialog's close, shown round on v2 pages. Nothing else may
        // leak in.
        expect([...foreign]).toEqual([]);
    });
});

describe("/app-v2.js", () => {
    test("is valid JS, one IIFE per listed source, content-hashed", async () => {
        const js = await getAppV2Js();
        expect((js.match(/^\(function \(\) \{/gm) ?? []).length).toBe(
            APP_V2_JS_SOURCES.length,
        );
        // Parses; never run.
        expect(() => new Function(js)).not.toThrow();
        expect(appV2ScriptHref()).toBe(`/app-v2.js?v=${await shortHash(js)}`);
    });

    test("carries no Turbo (app.js has it) and registers through FoodableApp", async () => {
        const js = await getAppV2Js();
        expect(js).toContain("window.FoodableApp.onLoad(");
        expect(js).not.toContain("Turbo.start");
        // +~1.8 KB amount Enter helpers, step-any stepping, listbox rows;
        // +~0.5 KB Trends subtitle and month-link range sync;
        // +~7 KB Today week swipe, edit sheet and live macro tiles;
        // +~1.5 KB Kitchen fridge rows and the Freeze date panel;
        // +~1.2 KB Kitchen groceries put-away date chips.
        // +~0.6 KB Kitchen Overview grocery rows open their line.
        // +~0.9 KB Kitchen usuals rows, unit select and add sheet;
        // +~0.5 KB usual product row sync and "No amount".
        // +~0.8 KB Recipes list desktop/phone search field swap.
        // +~0.4 KB Log search result score badges.
        // +~4 KB scanner UI (ZXing stays in /app-v2-scanner.js).
        // +~1.5 KB scanner session lifecycle, desktop layout sync and navigation guards.
        // +~1 KB Recent chips that log a multi-item or free-text meal again.
        // +~6 KB Stores drag reorder, name autosubmit and arrow focus return.
        // +~3.3 KB Recipe cook sheet: preview refresh on servings change.
        // +~1.3 KB bottom sheets fit above the iOS keyboard.
        // +~0.2 KB log search waits for a tap on touch screens.
        // +~2.9 KB Product score: presets move the sliders, sliders pick Custom.
        // +~3 KB Share link: copy the new link's address.
        // +~1.9 KB Settings AI connections: copy the connect address.
        // +~1.9 KB Log sheet: Copy yesterday tile follows the chosen meal.
        // +~0.6 KB Scanner: no bare BarcodeDetector, detach the video, start-up errors shown.
        // +~4.2 KB Sheets: backdrop dismiss by geometry on document, with a touch-tap fallback.
        // +~0.4 KB Again chips: a submit key per rendered form.
        // +~3 KB Log sheet: ml basis, pack-serving portion, unit change resets.
        // +~0.6 KB Log sheet: Add to groceries opens the Groceries add sheet.
        // +~6.2 KB Select mode: pick several rows on four lists, act once.
        // +~1.9 KB Sheets: a dialog opened over a sheet is not a tap on its backdrop.
        // +~3.2 KB Add a usual: tabs, and the scanner taking a target per opener.
        // +~3.7 KB Profile pictures: shrink the chosen photo before upload.
        // +~1.2 KB Profile pictures: a picture that fails to load shows initials.
        expect(js.length).toBeLessThan(155_000);
        expect(js).not.toContain("readBarcodes");
        expect(js).not.toContain("prepareZXingModule");
    });
});

describe("/app-v2-scanner", () => {
    test("builds a valid IIFE with FoodableScannerZxing and content-hashes", async () => {
        const js = await getScannerZxingJs();
        expect(() => new Function(js)).not.toThrow();
        expect(js).toContain("FoodableScannerZxing");
        expect(scannerZxingScriptHref()).toBe(
            `/app-v2-scanner.js?v=${await shortHash(js)}`,
        );
    });

    test("serves wasm from zxing-wasm with a content hash", async () => {
        const buf = await getScannerWasm();
        expect(buf.byteLength).toBeGreaterThan(100_000);
        expect(scannerWasmHref()).toMatch(
            /^\/app-v2-scanner\.wasm\?v=[0-9a-f]{12}$/,
        );
    });
});

describe("chat widgets never get the v2 layer", () => {
    test("no widget carries v2 tokens or fd- classes", async () => {
        for (const key of Object.keys(WIDGET_TEMPLATES)) {
            const html = await getWidgetHtml(key);
            expect(html, key).not.toContain("--surface-bg");
            expect(html, key).not.toMatch(/\bfd-[a-z]/);
            expect(html, key).not.toContain("app-v2");
        }
    });
});

describe("shell stylesheet sources", () => {
    test("no partial's header names the removed ui-v2 flag", () => {
        const dir = new URL("../public/app/v2/", import.meta.url);
        for (const name of readdirSync(dir)) {
            if (!name.endsWith(".css")) continue;
            const css = readFileSync(new URL(name, dir), "utf8");
            expect(css, name).not.toMatch(/ui-v2/);
        }
    });
});
