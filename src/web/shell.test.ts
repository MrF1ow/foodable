import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    APP_TABS,
    appBar,
    appHead,
    renderAppShell,
    parseAppearanceInput,
    renderBarePage,
    resolveTheme,
    themeColorMeta,
} from "./shell.js";
import { THEME_COLOR, THEME_NAV_COLOR } from "../tokens.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../test-support/chrome-flags.js";

// A bare tab page: the shell around one heading, with no tab content.
function shellPage(
    active: "fridge" | "household" = "fridge",
    theme: "system" | "light" | "dark" = "system",
): string {
    const title = active === "fridge" ? "Fridge" : "Household";
    return renderAppShell({
        title,
        active,
        theme,
        body: `<h1>${title}</h1>`,
        attention: { count: 0, tabs: {} },
        flags: FIXTURE_APP_CHROME_FLAGS,
    });
}

const SHELL_JS = readFileSync(join(import.meta.dir, "client/shell.js"), "utf8");

test("app tab hrefs and order", () => {
    expect(APP_TABS.map((tab) => tab.id)).toEqual([
        "fridge",
        "grocery",
        "nutrition",
        "recipes",
        "household",
    ]);
    expect(APP_TABS.map((tab) => tab.href)).toEqual([
        "/kitchen/fridge",
        "/kitchen/groceries",
        "/",
        "/recipes",
        "/settings/household",
    ]);
    expect(APP_TABS.map((tab) => tab.label)).toEqual([
        "Fridge",
        "Groceries",
        "Nutrition",
        "Recipes",
        "Household",
    ]);
});

test("unset theme follows the system", () => {
    expect(resolveTheme(null)).toBe("system");
    expect(resolveTheme("nope")).toBe("system");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
});

test("a tab page uses the shell and marks its tab active", () => {
    const html = shellPage();
    expect(html).toContain("<h1>Fridge</h1>");
    expect(html).toMatch(
        /<a class="fd-tab" href="\/kitchen\/fridge" aria-current="page"/,
    );
    expect(html).toContain('href="/settings" data-turbo="false"');
    expect(html).not.toContain('href="/logout"');
    expect(html).not.toContain("app-bar");
    expect(html).toMatch(
        /<link rel="stylesheet" href="\/app\.css\?v=[a-f0-9]{12}" data-turbo-track="reload" \/>/,
    );
    expect(html).toMatch(
        /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
    );
    expect(html).toMatch(
        /<link rel="stylesheet" href="\/app-v2\.css\?v=[a-f0-9]{12}" data-turbo-track="reload" \/>/,
    );
    expect(html).toContain(
        '<meta name="turbo-refresh-method" content="morph" />',
    );
});

test("system theme leaves data-theme off and offers both theme colors", () => {
    const html = shellPage();
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain("data-theme");
    expect(html).toContain('<meta name="foodable-theme" content="system" />');
    expect(html).toContain(
        `<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)" />`,
    );
    expect(html).toContain(
        '<meta name="foodable-theme-chrome" content="page" />',
    );
    expect(html).not.toContain("has-bottom-nav");
    expect(html).not.toContain("--accent");
});

test("an explicit theme stamps data-theme on html", () => {
    const html = shellPage("household", "dark");
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain(
        `<meta name="theme-color" content="${THEME_COLOR.dark}" />`,
    );
    expect(html).toContain('<meta name="foodable-theme" content="dark" />');
    expect(html).not.toContain("--accent");
});

test("themeColorMeta uses page bg on bare pages and nav chrome on tabs", () => {
    expect(themeColorMeta("dark", "page")).toContain(THEME_COLOR.dark);
    expect(themeColorMeta("dark", "nav")).toContain(THEME_NAV_COLOR.dark);
    expect(themeColorMeta("system", "nav")).toContain(THEME_NAV_COLOR.light);
    expect(themeColorMeta("system", "page")).toContain(THEME_COLOR.light);
});

test("bare pages stamp page chrome and omit the bottom nav", () => {
    const html = renderBarePage("Household", "<p>x</p>", "dark");
    expect(html).toContain(
        '<meta name="foodable-theme-chrome" content="page" />',
    );
    expect(html).toContain(
        `<meta name="theme-color" content="${THEME_COLOR.dark}" />`,
    );
    expect(html).not.toContain("has-bottom-nav");
    expect(html).toContain(
        '<div id="toast-region" class="toast-region" role="status" aria-live="polite" data-turbo-permanent></div>',
    );
});

test("appHead emits foodable-theme for every preference", () => {
    expect(appHead("T", "light", "page")).toContain(
        '<meta name="foodable-theme" content="light" />',
    );
    expect(appHead("T", "system", "page")).toContain(
        '<meta name="foodable-theme" content="system" />',
    );
});

test("Log out opts out of Turbo and the logo link does not", () => {
    expect(appBar()).toContain('href="/logout" data-turbo="false"');
    expect(appBar()).toContain('class="app-bar-logo" href="/"');
    expect(appBar()).not.toContain(
        'class="app-bar-logo" href="/" data-turbo="false"',
    );
    expect(appBar()).not.toContain("/settings");
    expect(appBar()).not.toContain("app-bar-attention");
});

test("bare pages get the top bar and can stamp a real data-theme", () => {
    const system = renderBarePage("Household", "<p class='empty'>x</p>");
    expect(system).toContain('class="app-bar-logo"');
    expect(system).toContain('aria-label="Log out"');
    expect(system).not.toContain(">Log out<");
    expect(system).toContain('<main class="app-main native">');
    expect(system).not.toContain("bottom-nav");
    expect(system).toContain('<html lang="en">');
    expect(system).not.toContain("data-theme");

    const light = renderBarePage(
        "Create household",
        "<h1>Create household</h1>",
        "light",
    );
    expect(light).toContain('<html lang="en" data-theme="light">');
    const dark = renderBarePage(
        "Create household",
        "<h1>Create household</h1>",
        "dark",
    );
    expect(dark).toContain('<html lang="en" data-theme="dark">');
    expect(light).not.toBe(dark);
});

test("the appearance form maps System to a cleared preference", () => {
    expect(parseAppearanceInput({ theme: "dark" })).toEqual({ theme: "dark" });
    expect(parseAppearanceInput({ theme: "light" })).toEqual({
        theme: "light",
    });
    expect(parseAppearanceInput({ theme: "system" })).toEqual({ theme: null });
    expect(parseAppearanceInput({ theme: "chartreuse" })).toEqual({
        theme: null,
    });
});

function runShellScript(
    document: unknown,
    window: unknown,
    ElementCtor: unknown = class Element {},
) {
    new Function("document", "window", "Element", SHELL_JS)(
        document,
        window,
        ElementCtor,
    );
}

test("the fx gate is a no-op on a window without matchMedia", () => {
    const html = {
        classList: {
            added: [] as string[],
            add(c: string) {
                this.added.push(c);
            },
        },
    };
    const document = {
        documentElement: html,
        querySelectorAll: () => [],
        addEventListener() {},
    };
    const window = { addEventListener() {} };
    expect(() => runShellScript(document, window)).not.toThrow();
    expect(html.classList.added).toEqual([]);
});

test("html.fx is added on the next frame when reduced motion is not requested", () => {
    const html = {
        classList: {
            added: [] as string[],
            add(c: string) {
                this.added.push(c);
            },
        },
    };
    const raf: Array<(time: number) => void> = [];
    const document = {
        documentElement: html,
        querySelectorAll: () => [],
        addEventListener() {},
    };
    const window = {
        addEventListener() {},
        matchMedia(_q: string) {
            return { matches: false };
        },
        requestAnimationFrame(cb: (time: number) => void) {
            raf.push(cb);
            return raf.length;
        },
    };
    runShellScript(document, window);
    expect(html.classList.added).toEqual([]);
    expect(raf.length).toBe(1);
    raf[0]!(0);
    expect(html.classList.added).toEqual(["fx"]);
});

test("html.fx is not added when reduced motion is requested", () => {
    const html = {
        classList: {
            added: [] as string[],
            add(c: string) {
                this.added.push(c);
            },
        },
    };
    const raf: Array<(time: number) => void> = [];
    const document = {
        documentElement: html,
        querySelectorAll: () => [],
        addEventListener() {},
    };
    const window = {
        addEventListener() {},
        matchMedia(q: string) {
            return { matches: q.includes("prefers-reduced-motion: reduce") };
        },
        requestAnimationFrame(cb: (time: number) => void) {
            raf.push(cb);
            return raf.length;
        },
    };
    runShellScript(document, window);
    expect(raf).toEqual([]);
    expect(html.classList.added).toEqual([]);
});

test("foodable-theme meta syncs html data-theme before turbo body paint", () => {
    const THEME_NAV_BG = { light: "#fefefd", dark: "#131615" };
    const htmlEl = {
        attrs: { "data-theme": "light" } as Record<string, string>,
        setAttribute(k: string, v: string) {
            this.attrs[k] = v;
        },
        getAttribute(k: string) {
            return this.attrs[k] ?? null;
        },
        removeAttribute(k: string) {
            delete this.attrs[k];
        },
    };
    let themeContent = "light";
    const themeMeta = {
        getAttribute(n: string) {
            return n === "content" ? themeContent : null;
        },
    };
    const chromeMeta = {
        getAttribute(n: string) {
            return n === "content" ? "nav" : null;
        },
    };
    function metaEl(initial: Record<string, string | null>) {
        const attrs = { ...initial };
        return {
            getAttribute(n: string) {
                return attrs[n] ?? null;
            },
            setAttribute(k: string, v: string) {
                attrs[k] = v;
            },
            removeAttribute(k: string) {
                delete attrs[k];
            },
        };
    }
    const colorMetas = [
        metaEl({ content: THEME_NAV_BG.light, name: "theme-color" }),
    ];
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const document = {
        documentElement: htmlEl,
        head: {
            appendChild(el: (typeof colorMetas)[number]) {
                colorMetas.push(el);
            },
        },
        querySelector(sel: string) {
            if (sel.includes("foodable-theme-chrome")) return chromeMeta;
            if (sel.includes("foodable-theme")) return themeMeta;
            return null;
        },
        querySelectorAll(sel: string) {
            return sel.includes("theme-color") ? colorMetas : [];
        },
        createElement() {
            return metaEl({ name: "theme-color" });
        },
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners[type] ??= []).push(fn);
        },
    };
    const window = {
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners[type] ??= []).push(fn);
        },
        matchMedia: () => ({ matches: false }),
        requestAnimationFrame() {
            return 0;
        },
    };
    const injected = SHELL_JS.replace(
        "const THEME_PAGE_BG = null;",
        () =>
            `const THEME_PAGE_BG = ${JSON.stringify({ light: "#fbfaf7", dark: "#0d0f0e" })};`,
    ).replace(
        "const THEME_NAV_BG = null;",
        () => `const THEME_NAV_BG = ${JSON.stringify(THEME_NAV_BG)};`,
    );
    new Function("document", "window", "Element", injected)(
        document,
        window,
        class Element {},
    );
    expect(htmlEl.getAttribute("data-theme")).toBe("light");
    themeContent = "system";
    listeners["turbo:before-render"]![0]!({});
    expect(htmlEl.getAttribute("data-theme")).toBeNull();
    expect(colorMetas[0]!.getAttribute("content")).toBe(THEME_NAV_BG.light);
    expect(colorMetas[0]!.getAttribute("media")).toBe(
        "(prefers-color-scheme: light)",
    );
    expect(colorMetas[1]!.getAttribute("content")).toBe(THEME_NAV_BG.dark);
    expect(colorMetas[1]!.getAttribute("media")).toBe(
        "(prefers-color-scheme: dark)",
    );
});

test("one passive pointermove listener sets --mx and --my on the panel", () => {
    const panel = {
        style: {
            props: {} as Record<string, string>,
            setProperty(k: string, v: string) {
                this.props[k] = v;
            },
        },
        getBoundingClientRect: () => ({ left: 10, top: 20 }),
    };
    class FakeElement {}
    const target = {
        closest: (sel: string) => (sel === ".app-main .panel" ? panel : null),
    };
    Object.setPrototypeOf(target, FakeElement.prototype);
    let pointerOpts: { passive?: boolean } | boolean | undefined;
    let pointerFn: ((e: unknown) => void) | undefined;
    const document = {
        documentElement: { classList: { add() {} } },
        querySelectorAll: () => [],
        addEventListener(
            type: string,
            fn: (e: unknown) => void,
            opts?: { passive?: boolean } | boolean,
        ) {
            if (type === "pointermove") {
                pointerFn = fn;
                pointerOpts = opts;
            }
        },
    };
    const window = {
        addEventListener() {},
        matchMedia(q: string) {
            return { matches: q.includes("hover: hover") };
        },
        requestAnimationFrame() {
            return 0;
        },
    };
    runShellScript(document, window, FakeElement);
    expect(pointerOpts).toEqual({ passive: true });
    pointerFn!({
        target,
        clientX: 40,
        clientY: 80,
    });
    expect(panel.style.props).toEqual({ "--mx": "30px", "--my": "60px" });
});

test("the toast region has one plain rule, with no bottom-nav variant", () => {
    const css = readFileSync(
        join(import.meta.dir, "../../public/app/app.css"),
        "utf8",
    );
    expect(css).not.toContain("has-bottom-nav");
    expect(css).toMatch(
        /\n\.toast-region \{[^}]*bottom: calc\(16px \+ env\(safe-area-inset-bottom, 0px\)\);/,
    );
});
