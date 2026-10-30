import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    APP_TABS,
    appHead,
    bottomNav,
    comingSoonPage,
    parseAppearanceInput,
    renderBarePage,
    resolveTheme,
    themeColorMeta,
} from "./shell.js";
import { THEME_COLOR, THEME_NAV_COLOR } from "../tokens.js";

const SHELL_JS = readFileSync(join(import.meta.dir, "client/shell.js"), "utf8");

test("bottom nav hrefs and tab order", () => {
    expect(APP_TABS.map((tab) => tab.id)).toEqual([
        "fridge",
        "grocery",
        "nutrition",
        "recipes",
        "settings",
    ]);
    expect(APP_TABS.map((tab) => tab.href)).toEqual([
        "/fridge",
        "/grocery",
        "/",
        "/recipes",
        "/settings",
    ]);
    expect(APP_TABS.map((tab) => tab.label)).toEqual([
        "Fridge",
        "Groceries",
        "Nutrition",
        "Recipes",
        "Settings",
    ]);

    const html = bottomNav("nutrition");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
        "/fridge",
        "/grocery",
        "/",
        "/recipes",
        "/settings",
    ]);
    expect(html).toContain('href="/" aria-current="page"');
    expect(html).not.toContain('href="/fridge" aria-current="page"');
    expect(html.match(/<svg\b/g)?.length).toBe(5);
    expect([...html.matchAll(/\stitle="([^"]+)"/g)].map((m) => m[1])).toEqual([
        "Fridge",
        "Groceries",
        "Nutrition",
        "Recipes",
        "Settings",
    ]);
    const inner = html.replace(/^<nav[^>]*>/, "").replace(/<\/nav>$/, "");
    expect(inner.replace(/<[^>]+>/g, "").trim()).toBe("");
});

test("unset theme follows the system", () => {
    expect(resolveTheme(null)).toBe("system");
    expect(resolveTheme("nope")).toBe("system");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("light")).toBe("light");
});

test("fridge stub uses the shell and marks Fridge active", () => {
    const html = comingSoonPage("fridge");
    expect(html).toContain("<h1>Fridge</h1>");
    expect(html).toContain("Coming soon.");
    expect(html).toContain('href="/fridge" aria-current="page"');
    expect(html).toContain('href="/logout"');
    expect(html).toContain('aria-label="Log out"');
    expect(html).toContain('href="/logout" data-turbo="false"');
    expect(html).toContain('class="app-bar-logo"');
    expect(html).toContain('href="/"');
    expect(html).toMatch(
        /<link rel="stylesheet" href="\/app\.css\?v=[a-f0-9]{12}" data-turbo-track="reload" \/>/,
    );
    expect(html).toMatch(
        /<script src="\/app\.js\?v=[a-f0-9]{12}" defer data-turbo-track="reload"><\/script>/,
    );
    expect(html).toContain(
        '<meta name="turbo-refresh-method" content="morph" />',
    );
});

test("system theme leaves data-theme off and offers both theme colors", () => {
    const html = comingSoonPage("fridge");
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain("data-theme");
    expect(html).toContain('<meta name="foodable-theme" content="system" />');
    expect(html).toContain(
        `<meta name="theme-color" content="${THEME_NAV_COLOR.dark}" media="(prefers-color-scheme: dark)" />`,
    );
    expect(html).toContain(
        '<meta name="foodable-theme-chrome" content="nav" />',
    );
    expect(html).toContain('class="has-bottom-nav"');
    expect(html).not.toContain("--accent");
});

test("an explicit theme stamps data-theme on html", () => {
    const html = comingSoonPage("settings", { theme: "dark" });
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain(
        `<meta name="theme-color" content="${THEME_NAV_COLOR.dark}" />`,
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
    expect(appHead("T", "light")).toContain(
        '<meta name="foodable-theme" content="light" />',
    );
    expect(appHead("T", "system")).toContain(
        '<meta name="foodable-theme" content="system" />',
    );
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

// The frame-sizing script lives in src/web/client/shell.js (served as /app.js
// with defer). A widget frame can finish loading and post its first
// size-changed before the script attaches a listener. Run the real script
// against a frame that has already loaded and check it is sized without any
// load event or message.
function runFrameSizer(contentHeight: number) {
    const script = SHELL_JS;
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const docEl = {
        style: { height: "" },
        getBoundingClientRect: () => ({
            height: docEl.style.height === "max-content" ? contentHeight : 150,
        }),
    };
    const contentWindow = {};
    const frame = {
        style: { height: "" },
        contentWindow,
        contentDocument: { documentElement: docEl },
        addEventListener() {},
    };
    const document = {
        querySelectorAll: () => [frame],
        addEventListener() {},
    };
    const window = {
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners[type] ??= []).push(fn);
        },
    };
    new Function("document", "window", script)(document, window);
    const post = (source: unknown, height: number) =>
        listeners.message!.forEach((fn) =>
            fn({
                source,
                data: {
                    method: "ui/notifications/size-changed",
                    params: { width: 400, height },
                },
            }),
        );
    return { frame, docEl, post, contentWindow };
}

test("widget frames are sized at once, even if they loaded before the script", () => {
    const { frame, docEl } = runFrameSizer(467);
    expect(frame.style.height).toBe("467px");
    // The max-content probe is undone.
    expect(docEl.style.height).toBe("");
});

test("a frame still on about:blank is left alone until it reports", () => {
    const { frame, post, contentWindow } = runFrameSizer(0);
    expect(frame.style.height).toBe("");
    post({}, 300);
    expect(frame.style.height).toBe("");
    post(contentWindow, 300);
    expect(frame.style.height).toBe("300px");
});

class FakeWidgetFrame {
    classList = { contains: (name: string) => name === "widget-frame" };
    style = { height: "" };
    reloads = 0;
    private attrs: Record<string, string>;
    contentWindow: { location: { reload: () => void } };

    constructor(attrs: Record<string, string>, height = "") {
        this.attrs = { ...attrs };
        this.style.height = height;
        this.contentWindow = {
            location: {
                reload: () => {
                    this.reloads += 1;
                },
            },
        };
    }

    getAttribute(name: string): string | null {
        return Object.prototype.hasOwnProperty.call(this.attrs, name)
            ? this.attrs[name]!
            : null;
    }

    setAttribute(name: string, value: string) {
        this.attrs[name] = value;
    }

    removeAttribute(name: string) {
        delete this.attrs[name];
    }
}

function runWidgetMorph() {
    // shell.js looks up HTMLIFrameElement on the real global. This runtime
    // has no DOM lib, so the test installs the fake constructor there.
    const iframeGlobal = globalThis as typeof globalThis & {
        HTMLIFrameElement?: typeof FakeWidgetFrame;
    };
    const prev = iframeGlobal.HTMLIFrameElement;
    iframeGlobal.HTMLIFrameElement = FakeWidgetFrame;
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const document = {
        documentElement: { classList: { add() {} } },
        querySelectorAll: () => [],
        addEventListener(type: string, fn: (e: unknown) => void) {
            (listeners[type] ??= []).push(fn);
        },
    };
    const window = { addEventListener() {} };
    new Function("document", "window", "Element", SHELL_JS)(
        document,
        window,
        class Element {},
    );
    const fire = (type: string, detail: unknown) => {
        let prevented = false;
        for (const fn of listeners[type] ?? []) {
            fn({
                detail,
                preventDefault() {
                    prevented = true;
                },
            });
        }
        return prevented;
    };
    return {
        fire,
        restore() {
            if (prev) iframeGlobal.HTMLIFrameElement = prev;
            else delete iframeGlobal.HTMLIFrameElement;
        },
    };
}

const FRAME_SRC = "/app/widgets/trends?v=abc123abc123";

test("a widget frame is kept when src, data, and theme all match", () => {
    const { fire, restore } = runWidgetMorph();
    try {
        const current = new FakeWidgetFrame(
            {
                src: FRAME_SRC,
                "data-widget-data": '{"n":1}',
                "data-theme": "light",
            },
            "480px",
        );
        const next = new FakeWidgetFrame({
            src: FRAME_SRC,
            "data-widget-data": '{"n":1}',
            "data-theme": "light",
        });
        const prevented = fire("turbo:before-morph-element", {
            currentElement: current,
            newElement: next,
        });
        expect(prevented).toBe(true);
        fire("turbo:morph-element", { currentElement: current });
        expect(current.reloads).toBe(0);
        expect(current.style.height).toBe("480px");
    } finally {
        restore();
    }
});

test("a same-src widget frame reloads when data or theme changes and keeps its height", () => {
    const { fire, restore } = runWidgetMorph();
    try {
        const current = new FakeWidgetFrame(
            {
                src: FRAME_SRC,
                "data-widget-data": '{"n":1}',
                "data-theme": "dark",
            },
            "480px",
        );
        const next = new FakeWidgetFrame({
            src: FRAME_SRC,
            "data-widget-data": '{"n":2}',
            "data-theme": "light",
        });
        const prevented = fire("turbo:before-morph-element", {
            currentElement: current,
            newElement: next,
        });
        expect(prevented).toBe(false);
        // The morph copies attributes and drops the fitted inline height.
        current.setAttribute("data-widget-data", '{"n":2}');
        current.setAttribute("data-theme", "light");
        current.style.height = "";
        fire("turbo:morph-element", { currentElement: current });
        expect(current.reloads).toBe(1);
        expect(current.style.height).toBe("480px");
    } finally {
        restore();
    }
});

test("a widget frame whose src changed is left for the browser to navigate", () => {
    const { fire, restore } = runWidgetMorph();
    try {
        const current = new FakeWidgetFrame(
            { src: FRAME_SRC, "data-widget-data": '{"n":1}' },
            "480px",
        );
        const next = new FakeWidgetFrame({
            src: "/app/widgets/trends?v=fff000fff000",
            "data-widget-data": '{"n":1}',
        });
        const prevented = fire("turbo:before-morph-element", {
            currentElement: current,
            newElement: next,
        });
        expect(prevented).toBe(false);
        fire("turbo:morph-element", { currentElement: current });
        expect(current.reloads).toBe(0);
    } finally {
        restore();
    }
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
        `const THEME_PAGE_BG = ${JSON.stringify({ light: "#fbfaf7", dark: "#0d0f0e" })};`,
    ).replace(
        "const THEME_NAV_BG = null;",
        `const THEME_NAV_BG = ${JSON.stringify(THEME_NAV_BG)};`,
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
