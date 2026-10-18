import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    APP_TABS,
    bottomNav,
    comingSoonPage,
    parseAppearanceInput,
    renderBarePage,
    resolveTheme,
} from "./shell.js";

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
    expect(html).toContain(
        '<meta name="theme-color" content="#0d0f0e" media="(prefers-color-scheme: dark)" />',
    );
    expect(html).not.toContain("--accent");
});

test("an explicit theme stamps data-theme on html", () => {
    const html = comingSoonPage("settings", { theme: "dark" });
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain('<meta name="theme-color" content="#0d0f0e" />');
    expect(html).not.toContain("--accent");
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
// with defer). A srcdoc widget frame does not wait for /app.css, so it can
// finish loading and post its first size-changed before the script attaches
// a listener. Run the real script against a frame that has already loaded
// and check it is sized without any load event or message.
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
