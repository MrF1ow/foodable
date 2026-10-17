import { test, expect } from "bun:test";
import {
    APP_TABS,
    bottomNav,
    comingSoonPage,
    parseAppearanceInput,
    resolveTheme,
} from "./shell.js";

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
    expect(html).toContain('<link rel="stylesheet" href="/app.css" />');
});

test("system theme leaves data-theme off and offers both theme colors", () => {
    const html = comingSoonPage("fridge");
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain("data-theme");
    expect(html).toContain(
        '<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />',
    );
    expect(html).not.toContain("--accent");
});

test("an explicit theme stamps data-theme on html", () => {
    const html = comingSoonPage("settings", { theme: "dark" });
    expect(html).toContain('<html lang="en" data-theme="dark">');
    expect(html).toContain('<meta name="theme-color" content="#000000" />');
    expect(html).not.toContain("--accent");
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

// The frame-sizing script waits for /app.css; a srcdoc widget frame does not,
// so it can finish loading and post its first size-changed before the script
// attaches a listener. Run the real script against a frame that has already
// loaded and check it is sized without any load event or message.
function runFrameSizer(contentHeight: number) {
    const html = comingSoonPage("fridge");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
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
    const document = { querySelectorAll: () => [frame] };
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
