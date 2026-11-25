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
        const help = readFileSync("./public/app/v2/item-row.css", "utf8");
        const at = help.indexOf(".fd-item-row__disclosure > summary {");
        expect(at).toBeGreaterThanOrEqual(0);
        expect(help.slice(at, help.indexOf("}", at))).not.toContain(
            "uppercase",
        );
        const kitchen = readFileSync("./public/app/v2/kitchen.css", "utf8");
        expect(kitchen).not.toContain("fd-kitchen-grocery-title");
        expect(kitchen).not.toContain("fd-kitchen-usual-title");
        expect(kitchen).not.toContain("fd-kitchen-usual-head");
    });

    test("a row's ⋯ in the household layout is the design's 24 px glyph in the secondary tone", () => {
        const css = readFileSync("./public/app/v2/settings.css", "utf8");
        const at = css.indexOf(
            ".fd-settings--household .fd-item-row__control > .fd-menu > .fd-btn--icon,",
        );
        expect(at).toBeGreaterThanOrEqual(0);
        const rule = css.slice(at, css.indexOf("}", at));
        expect(rule).toContain("--fd-btn-icon: var(--space-2xl)");
        expect(rule).toContain("color: var(--text-secondary)");
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
        // +~11 KB Settings autosave: a marked form submits when a field is left; one save at a time, an edit in progress survives the response, a rejected or failed field keeps its text, leaving mid-save posts with keepalive.
        // +~5.2 KB Settings autosave: whole forms (Product score) save on any control's change, keep an unsaved edit through the refresh, and queue their reset buttons; a refreshed form forgets what it last sent.
        // +~0.7 KB Item row: the swipe client also drives the Item row's face and beds.
        // +~2.0 KB Sheets: a dialog or side sheet keeps Tab inside it (rendered, enabled controls only), and its header is a drag grip.
        // +~9.4 KB Menu: an anchored menu opens, closes on Escape and a tap outside, moves by arrow keys, confirms in place and returns focus; its panel flips or clamps to stay inside the screen.
        // +~7.5 KB Segmented and chip groups: arrow-key radio selection, toggles, and a change event, on the new markup only. Each script keeps its own roving-focus helper rather than a shared one, so the two stay independent.
        // +~0.8 KB Segmented and chip groups: a named Segmented is native radios, so its script only adds a change detail; a modifier on an arrow key is left to the browser.
        // +~0.3 KB Select mode: Escape that an open menu took leaves the selection on.
        // +~1.1 KB Log link: `?log=meal:<id>` opens the log form prefilled from that past meal.
        // +~0.6 KB Log search: a past meal with several items has an Add button that logs it again whole.
        // +~1.2 KB Log link: a past meal with no single food shows its own row first in the search sheet, never twice.
        // +~0.5 KB Recipes: typing in the search box hides the cards whose name misses it.
        // +~0.5 KB Top bar: the search field is a trigger, so typing into it moves the text into the log search and opens it.
        // +~1.3 KB Top bar: Enter, ArrowDown and ⌘K work from the field, and focus returns to its input.
        // +~1.4 KB Settings: a menu item that opens a sheet closes the menu and the sheet hands focus back to the ⋯; choosing a photo sends it and Change photo opens the picker.
        // +~0.1 KB Menu: a tick that posts a form (a pull-down on a row) just submits.
        // +~0.2 KB Stores: after a section's ⋯ Move up or down, focus goes back to that section's ⋯.
        // +~1.4 KB Menu: a shared sheet filled for the item that opens it (Edit and Merge on Saved foods), and a button item that closes the menu (Select).
        // +~3.5 KB Menu and Select: a refusal a shared sheet showed goes when another row opens it, the food going in is left out of Keep, a menu panel that is longer than the screen scrolls inside it, and a Select in a ⋯ reads Cancel selection while picking (focus to the ⋯ that shows); a confirm words itself for the kind of row picked.
        // +~0.9 KB Today: the edit sheet's Time chips put the meal's time back, and a plan sheet's pull-down row shows the list's choice.
        // +~1.2 KB Log sheet: a search row is the Item row (open link, plus), a pasted recipe link shows Go, the unit is a Segmented (a piece names its weight) and the macro tiles are the Macro tiles.
        // +~1.1 KB Log sheet: a meal's plus opens the search with that meal checked, and Quick calories and Weigh in replace the search sheet.
        expect(js.length).toBeLessThan(211_100);
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

describe("chat widgets never get the app shell", () => {
    // Widgets share the Theme token names with the shell by design (their own
    // generated shared/v2/tokens.css), but never the shell's fd- components or
    // its stylesheet.
    test("no widget carries fd- classes or the app-v2 stylesheet", async () => {
        for (const key of Object.keys(WIDGET_TEMPLATES)) {
            const html = await getWidgetHtml(key);
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

// Settings autosave (src/web/client/v2/autosave.js), run against a fake page:
// a document with capture listeners and a few marked forms.

type AutosaveEvent = {
    target?: unknown;
    detail?: unknown;
    defaultPrevented?: boolean;
    preventDefault?: () => void;
    stopImmediatePropagation?: () => void;
};
type AutosaveListener = (event: AutosaveEvent) => void;

type FakeInput = {
    value: string;
    defaultValue: string;
    form: FakeForm;
    selectionStart: number;
    selectionEnd: number;
    hasAttribute: (name: string) => boolean;
    focus: () => void;
    setSelectionRange: (a: number, b: number) => void;
};
type FakeForm = {
    name: string;
    input: FakeInput;
    hasAttribute: (name: string) => boolean;
    querySelector: (sel: string) => unknown;
    requestSubmit: () => void;
};

async function autosaveSetup(names = ["daily_carbs_g", "daily_water_ml"]) {
    const map: Record<string, AutosaveListener[]> = {};
    const timers: { id: number; fn: () => void }[] = [];
    let timerId = 0;
    const doc: {
        activeElement: unknown;
        addEventListener: (t: string, fn: AutosaveListener) => void;
        querySelectorAll: (sel: string) => FakeForm[];
    } = {
        activeElement: null,
        addEventListener: (t, fn) => {
            (map[t] ??= []).push(fn);
        },
        querySelectorAll: (sel) =>
            sel === "form[data-fd-autosave]" ? forms : [],
    };
    // Returns true when the event got past every listener unstopped, which is
    // when Turbo's own (later, bubbling) listener would see it.
    function fire(type: string, event: AutosaveEvent): boolean {
        let stopped = false;
        let prevented = false;
        event.preventDefault = () => {
            prevented = true;
            event.defaultPrevented = true;
        };
        event.stopImmediatePropagation = () => {
            stopped = true;
        };
        for (const fn of map[type] ?? []) {
            if (stopped) break;
            fn(event);
        }
        return !stopped && !prevented;
    }
    let reached = 0;
    function makeForm(name: string, initial: string): FakeForm {
        const field = { value: name };
        const form: FakeForm = {
            name,
            hasAttribute: (n) => n === "data-fd-autosave",
            querySelector: (sel) =>
                sel === "[data-fd-autosave-input]"
                    ? form.input
                    : sel === 'input[name="field"]'
                      ? field
                      : null,
            // requestSubmit fires the form's own submit event, as a browser does.
            requestSubmit() {
                if (fire("submit", { target: form })) reached += 1;
            },
            input: undefined as unknown as FakeInput,
        };
        form.input = {
            value: initial,
            defaultValue: initial,
            form,
            selectionStart: initial.length,
            selectionEnd: initial.length,
            hasAttribute: (n) => n === "data-fd-autosave-input",
            focus() {
                doc.activeElement = form.input;
            },
            setSelectionRange(a, b) {
                form.input.selectionStart = a;
                form.input.selectionEnd = b;
            },
        };
        return form;
    }
    const forms: FakeForm[] = names.map((n) => makeForm(n, ""));
    const src = await Bun.file("./src/web/client/v2/autosave.js").text();
    new Function("document", "setTimeout", "clearTimeout", "WeakMap", src)(
        doc,
        (fn: () => void) => {
            timerId += 1;
            timers.push({ id: timerId, fn });
            return timerId;
        },
        (id: number) => {
            const at = timers.findIndex((x) => x.id === id);
            if (at >= 0) timers.splice(at, 1);
        },
        WeakMap,
    );
    const [a, b] = forms as [FakeForm, FakeForm];
    const t = {
        a,
        b,
        doc,
        reached: () => reached,
        // Edit `form`'s field and leave it, as Tab does.
        leave(form: FakeForm, value: string) {
            form.input.value = value;
            doc.activeElement = null;
            fire("change", { target: form.input });
            fire("focusout", { target: form.input });
        },
        enter: (form: FakeForm) => {
            if (fire("submit", { target: form })) reached += 1;
        },
        // The response arrives: submit-end, then the page renders it.
        end(form: FakeForm, fetchResponse: unknown = {}) {
            fire("turbo:submit-end", {
                target: form,
                detail: { fetchResponse },
            });
        },
        render: () => fire("turbo:render", {}),
        // Run the timers a release queued (the drain), oldest first.
        flush() {
            while (timers.length > 0) timers.shift()!.fn();
        },
        // Run the safety timer of a submit that never reported back.
        expire() {
            timers.shift()!.fn();
            while (timers.length > 0) timers.shift()!.fn();
        },
        morph(input: FakeInput, serverValue: string): boolean {
            return fire("turbo:before-morph-element", {
                target: input,
                detail: { newElement: { value: serverValue } },
            });
        },
        fire,
    };
    return t;
}

describe("autosave.js", () => {
    test("a changed field submits once, however change and blur interleave", async () => {
        const t = await autosaveSetup();
        t.a.input.value = "180";
        t.fire("change", { target: t.a.input });
        t.fire("focusout", { target: t.a.input });
        expect(t.reached()).toBe(1);
    });

    test("an unchanged field submits nothing", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "");
        expect(t.reached()).toBe(0);
    });

    test("blur alone submits an edited field (no change event)", async () => {
        const t = await autosaveSetup();
        t.a.input.value = "150";
        t.fire("focusout", { target: t.a.input });
        expect(t.reached()).toBe(1);
    });

    test("Enter after change is not a second submit while one is in flight", async () => {
        const t = await autosaveSetup();
        t.a.input.value = "180";
        t.fire("change", { target: t.a.input });
        t.enter(t.a);
        expect(t.reached()).toBe(1);
    });

    test("after the save has rendered, a later edit submits again", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "180");
        t.end(t.a);
        t.render();
        t.flush();
        t.a.input.defaultValue = "180";
        t.leave(t.a, "190");
        expect(t.reached()).toBe(2);
    });

    test("events from other controls are ignored", async () => {
        const t = await autosaveSetup();
        const other = {
            value: "x",
            defaultValue: "",
            hasAttribute: () => false,
        };
        t.fire("change", { target: other });
        expect(t.reached()).toBe(0);
    });

    test("a second field left while the first saves is queued, then sent after its render (F24)", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.b, "2500");
        // Turbo only saw the first: a second submit would stop it and its render.
        expect(t.reached()).toBe(1);
        t.end(t.a);
        expect(t.reached()).toBe(1);
        t.render();
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("a render that lands before submit-end also releases the queue", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.b, "2500");
        t.render();
        t.end(t.a);
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("a failed request (no response) releases the queue at once", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.b, "2500");
        t.end(t.a, undefined);
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("a timer releases a submit that never reports back", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.b, "2500");
        t.expire();
        expect(t.reached()).toBe(2);
    });

    test("the same field edited again while its save is in flight is sent after", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.a, "260");
        expect(t.reached()).toBe(1);
        t.end(t.a);
        t.render();
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("a queued field already back at its stored value is not sent", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.b, "2500");
        t.b.input.value = "";
        t.end(t.a);
        t.render();
        t.flush();
        expect(t.reached()).toBe(1);
    });

    test("the morph leaves a focused, edited field alone (F25)", async () => {
        const t = await autosaveSetup();
        t.b.input.value = "45";
        t.doc.activeElement = t.b.input;
        // The server sent the stored (empty) value: cancelled, so it is kept.
        expect(t.morph(t.b.input, "")).toBe(false);
    });

    test("the morph leaves a queued field alone even when it lost the focus", async () => {
        const t = await autosaveSetup();
        t.leave(t.a, "250");
        t.leave(t.b, "2500");
        expect(t.morph(t.b.input, "")).toBe(false);
    });

    test("the morph still updates a field that is not being edited", async () => {
        const t = await autosaveSetup();
        t.a.input.value = "250";
        expect(t.morph(t.a.input, "250")).toBe(true);
        t.b.input.value = "9";
        // Not focused, not queued: the server's value wins.
        expect(t.morph(t.b.input, "")).toBe(true);
        // Focused but not changed: nothing to protect.
        t.doc.activeElement = t.a.input;
        expect(t.morph(t.a.input, "250")).toBe(true);
    });

    test("a 422 body gets the typed text and the focus back, and leaving saves it (F25)", async () => {
        const t = await autosaveSetup();
        // The new page's forms, as the server rendered them.
        const next = await autosaveSetup();
        const newBody = {
            querySelectorAll: (sel: string) =>
                sel === "form[data-fd-autosave]" ? [next.a, next.b] : [],
        };
        t.leave(t.a, "abc");
        t.b.input.value = "45";
        t.b.input.selectionStart = 1;
        t.b.input.selectionEnd = 2;
        t.doc.activeElement = t.b.input;
        t.fire("turbo:before-render", { detail: { newBody } });
        // The focused field's text is carried; the one that was sent is not.
        expect(next.b.input.value).toBe("45");
        expect(next.a.input.value).toBe("");
        // The body is swapped: the new page's document is what the module sees.
        t.doc.querySelectorAll = () => [next.a, next.b];
        t.doc.activeElement = null;
        t.fire("turbo:render", {});
        expect(next.doc.activeElement).toBe(next.b.input);
        expect(next.b.input.selectionStart).toBe(1);
        // It still differs from the stored value, so leaving it submits.
        t.end(t.a);
        t.flush();
        t.leave(next.b, "45");
        expect(t.reached() + next.reached()).toBeGreaterThanOrEqual(2);
    });

    test("a rejected field keeps its text and error through the next field's morph", async () => {
        const t = await autosaveSetup();
        (
            t.a.input as unknown as {
                getAttribute: (n: string) => string | null;
            }
        ).getAttribute = (n) => (n === "aria-invalid" ? "true" : null);
        (t.a as unknown as { getAttribute: () => null }).getAttribute = () =>
            null;
        // Water is the save being answered; carbs was refused earlier.
        t.leave(t.b, "2600");
        const skipped = !t.fire("turbo:before-morph-element", {
            target: t.a,
            detail: { newElement: {} },
        });
        expect(skipped).toBe(true);
        // The answered form itself morphs.
        expect(
            t.fire("turbo:before-morph-element", {
                target: t.b,
                detail: { newElement: {} },
            }),
        ).toBe(true);
    });

    test("a save with no answer keeps its text, says so, and is retried after the next answer", async () => {
        const shown: unknown[] = [];
        const g = globalThis as unknown as { window?: unknown };
        const had = g.window;
        g.window = {
            FoodableApp: { toast: { show: (m: unknown) => shown.push(m) } },
        };
        try {
            const t = await autosaveSetup();
            t.leave(t.a, "31");
            t.fire("turbo:submit-end", {
                target: t.a,
                detail: { error: new Error("offline") },
            });
            t.flush();
            expect(shown.length).toBe(1);
            // The wording fits every control, not only a text field.
            expect((shown[0] as { text: string }).text).toBe(
                "Couldn't save. Check your connection and try again.",
            );
            // A later morph does not reset the failed field's text.
            expect(t.morph(t.a.input, "")).toBe(false);
            // The next save gets an answer: the failed field goes again after it.
            t.leave(t.b, "2500");
            t.end(t.b);
            t.render();
            t.flush();
            expect(t.reached()).toBe(3);
        } finally {
            g.window = had;
        }
    });

    test("leaving the page mid-save posts in-flight and queued fields with keepalive, without requestSubmit", async () => {
        const g = globalThis as unknown as {
            fetch: unknown;
            FormData: unknown;
        };
        const realFetch = g.fetch;
        const realFormData = g.FormData;
        const posts: { url: unknown; keepalive: unknown }[] = [];
        g.fetch = (url: unknown, init: { keepalive?: unknown }) => {
            posts.push({ url, keepalive: init.keepalive });
            return Promise.resolve();
        };
        g.FormData = function FakeFormData() {};
        try {
            const t = await autosaveSetup();
            (t.a as unknown as { action: string }).action =
                "/settings/goals/field";
            (t.b as unknown as { action: string }).action =
                "/settings/goals/field";
            t.leave(t.a, "250");
            t.leave(t.b, "2500");
            expect(t.reached()).toBe(1);
            t.fire("turbo:before-visit", { detail: { url: "/" } });
            expect(posts.length).toBe(2);
            expect(posts.every((p) => p.keepalive === true)).toBe(true);
            // The aborted submission ends with nothing to drain.
            t.fire("turbo:submit-end", { target: t.a, detail: {} });
            t.flush();
            expect(t.reached()).toBe(1);
        } finally {
            g.fetch = realFetch;
            g.FormData = realFormData;
        }
    });

    test("a full page load (pagehide) mid-save posts in-flight and queued fields with keepalive", async () => {
        const g = globalThis as unknown as {
            fetch: unknown;
            FormData: unknown;
            window?: unknown;
        };
        const realFetch = g.fetch;
        const realFormData = g.FormData;
        const hadWindow = g.window;
        const posts: unknown[] = [];
        const onWindow: Record<string, () => void> = {};
        g.fetch = (_url: unknown, init: { keepalive?: unknown }) => {
            posts.push(init.keepalive);
            return Promise.resolve();
        };
        g.FormData = function FakeFormData() {};
        g.window = {
            addEventListener: (type: string, fn: () => void) => {
                onWindow[type] = fn;
            },
        };
        try {
            const t = await autosaveSetup();
            t.leave(t.a, "250");
            t.leave(t.b, "2500");
            onWindow.pagehide!();
            expect(posts).toEqual([true, true]);
            // Nothing is left to drain into a page that is gone.
            t.fire("turbo:submit-end", { target: t.a, detail: {} });
            t.flush();
            expect(t.reached()).toBe(1);
        } finally {
            g.fetch = realFetch;
            g.FormData = realFormData;
            g.window = hadWindow;
        }
    });

    test("binding is page-wide: no per-form listeners to double up", async () => {
        const t = await autosaveSetup();
        const before = t.a.input;
        t.leave(t.a, "1");
        expect(before.form).toBe(t.a);
        expect(t.reached()).toBe(1);
    });
});

// A whole form (`data-fd-autosave="form"`, Settings › Product score): several
// controls, saved when any of them changes.
type WholeControl = {
    name: string;
    type: string;
    value: string;
    defaultValue: string;
    checked: boolean;
    defaultChecked: boolean;
    hasAttribute: () => boolean;
};
type WholeForm = {
    elements: WholeControl[];
    requestSubmit: () => void;
    hasAttribute: (n: string) => boolean;
    getAttribute: (n: string) => string | null;
    querySelector: (sel: string) => unknown;
};

async function wholeSetup() {
    const map: Record<string, AutosaveListener[]> = {};
    const timers: { fn: () => void; ms: number }[] = [];
    const doc = {
        activeElement: null as unknown,
        addEventListener: (t: string, fn: AutosaveListener) => {
            (map[t] ??= []).push(fn);
        },
        querySelectorAll: (sel: string): WholeForm[] =>
            sel === "form[data-fd-autosave]" ? forms : [],
    };
    function fire(type: string, event: AutosaveEvent): boolean {
        let stopped = false;
        event.preventDefault = () => {
            stopped = true;
        };
        event.stopImmediatePropagation = () => {
            stopped = true;
        };
        for (const fn of map[type] ?? []) fn(event);
        return !stopped;
    }
    let reached = 0;
    let lastSent: WholeForm | null = null;
    const control = (
        name: string,
        type: string,
        value: string,
        checked = false,
    ): WholeControl => ({
        name,
        type,
        value,
        defaultValue: value,
        checked,
        defaultChecked: checked,
        hasAttribute: () => false,
    });
    function makeForm(
        intent: string,
        field = "intent",
        action = "/settings/product-score",
    ): WholeForm {
        const hidden = control(field, "hidden", intent);
        const form: WholeForm = {
            elements: [hidden],
            hasAttribute: (n) => n === "data-fd-autosave",
            getAttribute: (n) =>
                n === "data-fd-autosave"
                    ? "form"
                    : n === "action"
                      ? action
                      : null,
            querySelector: (sel) =>
                sel.includes(`input[name="${field}"]`) ? hidden : null,
            requestSubmit() {
                if (fire("submit", { target: form })) {
                    reached += 1;
                    lastSent = form;
                }
            },
        };
        return form;
    }
    const choice = makeForm("choice");
    const preset = ["balanced", "planet", "custom"].map((v) =>
        control("preset", "radio", v, v === "balanced"),
    );
    const slider = control("weight_nutrition", "range", "40");
    choice.elements.push(...preset, slider);
    const sw = makeForm("warn_traces");
    const reset = makeForm("household");
    // Two rows of one list of switches (Settings › Notifications): one action,
    // told apart by the kind each posts.
    const kindA = makeForm("food_expiring", "kind", "/settings/notifications");
    const kindB = makeForm("running_low", "kind", "/settings/notifications");
    const forms = [choice, sw, reset, kindA, kindB];
    const src = await Bun.file("./src/web/client/v2/autosave.js").text();
    new Function("document", "setTimeout", "clearTimeout", "WeakMap", src)(
        doc,
        (fn: () => void, ms = 0) => {
            timers.push({ fn, ms });
            return timers.length;
        },
        () => {},
        WeakMap,
    );
    return {
        choice,
        sw,
        reset,
        kindA,
        kindB,
        preset,
        slider,
        reached: () => reached,
        last: () => lastSent,
        // Run the zero-delay timers (change handlers settling, the drain); the
        // safety timer stays pending.
        flush() {
            for (;;) {
                const at = timers.findIndex((x) => x.ms === 0);
                if (at < 0) break;
                timers.splice(at, 1)[0]!.fn();
            }
        },
        fire,
        end(form: WholeForm) {
            fire("turbo:submit-end", {
                target: form,
                detail: { fetchResponse: {} },
            });
        },
    };
}

describe("autosave.js whole forms", () => {
    // `change` hands over the control itself: the module reads `target.form`
    // and `target.type`, so give it the real object with a form.
    function edit(
        t: Awaited<ReturnType<typeof wholeSetup>>,
        control: WholeControl,
        value: string,
    ) {
        if (control.type === "radio") {
            for (const r of t.preset) r.checked = r === control;
        } else {
            control.value = value;
        }
        const target = Object.assign(control, {
            form: t.choice,
        }) as WholeControl & { form: WholeForm };
        t.fire("change", { target });
    }

    test("a preset change and a slider change both save, none lost to the one in flight", async () => {
        const t = await wholeSetup();
        edit(t, t.preset[1]!, "");
        t.flush();
        expect(t.reached()).toBe(1);
        // Dragged while the first save is in flight: held, not dropped.
        edit(t, t.slider, "70");
        t.flush();
        expect(t.reached()).toBe(1);
        t.end(t.choice);
        t.fire("turbo:render", {});
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("one change submits once however change and blur interleave", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "55");
        const target = Object.assign(t.slider, { form: t.choice });
        t.fire("focusout", { target });
        t.flush();
        expect(t.reached()).toBe(1);
    });

    test("nothing changed submits nothing", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "40");
        t.flush();
        expect(t.reached()).toBe(0);
    });

    test("a click on another form while one saves is queued and sent", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "70");
        t.flush();
        t.sw.requestSubmit();
        expect(t.reached()).toBe(1);
        t.end(t.choice);
        t.fire("turbo:render", {});
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("the refresh does not revert a form edited after its save was sent", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "70");
        t.flush();
        edit(t, t.slider, "90");
        t.flush();
        const kept = t.fire("turbo:before-morph-element", {
            target: t.choice,
            detail: { newElement: {} },
        });
        expect(kept).toBe(false);
    });

    test("after the refresh renders other values, picking the earlier choice again saves", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "70");
        t.flush();
        expect(t.reached()).toBe(1);
        t.end(t.choice);
        // The server answers with other values (Use household default): the
        // refresh goes ahead and the form shows them.
        expect(
            t.fire("turbo:before-morph-element", {
                target: t.choice,
                detail: { newElement: {} },
            }),
        ).toBe(true);
        t.fire("turbo:render", {});
        t.flush();
        t.slider.value = "40";
        edit(t, t.slider, "70");
        t.flush();
        expect(t.reached()).toBe(2);
    });

    test("a reset form clicked while a choice saves is queued, and it is the last word", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "70");
        t.flush();
        expect(t.reached()).toBe(1);
        // Use household default, clicked mid-save: held, Turbo never sees it.
        t.reset.requestSubmit();
        expect(t.reached()).toBe(1);
        // The person drags again, then the first answer arrives.
        edit(t, t.slider, "90");
        t.flush();
        t.end(t.choice);
        t.fire("turbo:render", {});
        t.flush();
        // The reset goes before the later edit, which then goes after it.
        expect(t.reached()).toBe(2);
        expect(t.last()).toBe(t.reset);
        t.end(t.reset);
        t.fire("turbo:render", {});
        t.flush();
        expect(t.reached()).toBe(3);
        expect(t.last()).toBe(t.choice);
    });

    test("a reset clicked after a queued edit is sent after it", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "70");
        t.flush();
        edit(t, t.slider, "90");
        t.flush();
        t.reset.requestSubmit();
        // The edit is queued first, then the reset; re-edited, it moves behind.
        edit(t, t.slider, "95");
        t.flush();
        t.end(t.choice);
        t.fire("turbo:render", {});
        t.flush();
        expect(t.last()).toBe(t.reset);
        t.end(t.reset);
        t.fire("turbo:render", {});
        t.flush();
        expect(t.last()).toBe(t.choice);
    });

    test("two switches of one list share an action and are told apart by their kind", async () => {
        const t = await wholeSetup();
        t.kindA.requestSubmit();
        expect(t.reached()).toBe(1);
        // The second switch is clicked while the first saves: held, not
        // taken for the first (same action) and dropped.
        t.kindB.requestSubmit();
        expect(t.reached()).toBe(1);
        t.end(t.kindA);
        t.fire("turbo:render", {});
        t.flush();
        expect(t.reached()).toBe(2);
        expect(t.last()).toBe(t.kindB);
    });

    test("a refresh of a saved form goes ahead", async () => {
        const t = await wholeSetup();
        edit(t, t.slider, "70");
        t.flush();
        t.end(t.choice);
        const ok = t.fire("turbo:before-morph-element", {
            target: t.choice,
            detail: { newElement: {} },
        });
        expect(ok).toBe(true);
    });
});

describe("new component rules that must beat the page's own", () => {
    async function rule(selector: string): Promise<string> {
        const css = (await getAppV2Css()).replace(/\/\*[\s\S]*?\*\//g, "");
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const blocks = [
            ...css.matchAll(
                new RegExp(`(?<![\\w.#-])${escaped}\\s*\\{([^}]*)\\}`, "g"),
            ),
        ];
        return blocks.map((m) => m[1]).join(";");
    }

    test("the Toggle track is its own height inside .native, where a checkbox label is 36 px", async () => {
        const decls = await rule(".fd-toggle");
        expect(decls).toMatch(/min-height:\s*0\b/);
        expect(decls).toContain("height: var(--fd-toggle-h)");
    });

    test("both Bell elements draw the glyph from the box's top left", async () => {
        const decls = await rule(".fd-bell .fd-icon");
        expect(decls).toMatch(/position:\s*absolute/);
        expect(decls).toMatch(/top:\s*0\b/);
        expect(decls).toMatch(/left:\s*0\b/);
    });

    test("a Field's typed text is regular although its label is bold", async () => {
        expect(await rule(".fd-field__input")).toMatch(/font-weight:\s*400/);
    });

    test("a search input's own clear button is hidden, so the design's X is the only one", async () => {
        expect(
            await rule(".fd-search-field__input::-webkit-search-cancel-button"),
        ).toMatch(/display:\s*none/);
        expect(
            await rule(".fd-field__input::-webkit-search-cancel-button"),
        ).toMatch(/display:\s*none/);
    });

    test("the Tabs row can shrink and its tabs scroll instead of overlapping the trailing slot", async () => {
        expect(await rule(".fd-tab-row")).toMatch(/min-width:\s*0/);
        const tabs = await rule(".fd-tab-row__tabs");
        expect(tabs).toMatch(/overflow-x:\s*auto/);
        expect(tabs).toMatch(/scrollbar-width:\s*none/);
        expect(await rule(".fd-tab-row__trailing")).toMatch(/flex:\s*none/);
    });

    test("a small Segmented control sets its labels in the caption size", async () => {
        const decls = await rule(".fd-segmented--small .fd-segmented__segment");
        expect(decls).toContain("font-size: var(--text-caption-size)");
        expect(decls).toContain("line-height: var(--text-caption-line)");
    });

    test("the in-flow Nav bar restores the display the desktop rule hides", async () => {
        expect(await rule(".fd-tabs.fd-tabs--inline")).toMatch(
            /display:\s*flex/,
        );
    });

    test("the page title sets its own tracking instead of inheriting the h1's", async () => {
        expect(await rule(".fd-page-header__title")).toContain(
            "letter-spacing: var(--fd-page-header-tracking)",
        );
        expect(await rule(".fd-page-header")).toContain(
            "--fd-page-header-tracking: -0.5px",
        );
    });
});
