import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FIXTURE_APP_CHROME_FLAGS } from "./test-support/chrome-flags.js";
import {
    APP_V2_JS_SOURCES,
    appV2ScriptHref,
    appV2StylesheetHref,
    getAppV2Css,
    getAppV2Js,
    getWidgetHtml,
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
                        ].includes(c) &&
                        !/^\d/.test(c),
                ),
        );
        // app-main and toast-region belong to the old stylesheet and are
        // restyled here; dash-head and its title row (components/ui.ts
        // pageHeader) are kept clear of the account chip. Nothing else may
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
        expect(js.length).toBeLessThan(81_000);
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

test("fixture flags default to the old shell", () => {
    expect(FIXTURE_APP_CHROME_FLAGS.uiV2).toBe(false);
});
