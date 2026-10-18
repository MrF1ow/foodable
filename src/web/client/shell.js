// Client bootstrap: FoodableApp.onLoad registry, Turbo lifecycle, motion, widgets.
window.FoodableApp = window.FoodableApp || {
    _hooks: [],
    onLoad(fn) {
        if (typeof fn !== "function") return;
        this._hooks.push(fn);
        try {
            fn(document);
        } catch (err) {
            console.error(err);
        }
    },
    reinit(root) {
        const scope = root && root.querySelectorAll ? root : document;
        for (let i = 0; i < this._hooks.length; i++) {
            try {
                this._hooks[i](scope);
            } catch (err) {
                console.error(err);
            }
        }
    },
};

let scrollRestoreY = null;

function onTurboPage() {
    window.FoodableApp.reinit(document);
    if (scrollRestoreY != null) {
        const y = scrollRestoreY;
        scrollRestoreY = null;
        const restore = () => window.scrollTo(0, y);
        restore();
        window.requestAnimationFrame(() => {
            restore();
            window.requestAnimationFrame(restore);
        });
    }
}
document.addEventListener("turbo:load", onTurboPage);
document.addEventListener("turbo:morph", onTurboPage);

function rememberScrollForFormSubmit() {
    const body = document.body;
    if (body && body.style.position === "fixed" && body.style.top) {
        const locked = parseInt(body.style.top, 10);
        scrollRestoreY = Number.isFinite(locked) ? -locked : 0;
    } else {
        scrollRestoreY = window.scrollY ?? window.pageYOffset ?? 0;
    }
}
document.addEventListener("turbo:submit-start", rememberScrollForFormSubmit);
document.addEventListener("submit", rememberScrollForFormSubmit, true);
document.addEventListener("foodable:scroll-lock-release", (event) => {
    const y = event.detail?.y;
    if (typeof y === "number" && Number.isFinite(y)) scrollRestoreY = y;
});

// Turbo morphs/replaces <body> and merges provisional <head> nodes; it never
// copies data-theme onto <html>. The server stamps the viewer theme in
// meta[name=foodable-theme] (merged on visits and morph refreshes); sync html
// and theme-color before the new body paints.
const THEME_PAGE_BG = { light: "#fbfaf7", dark: "#0d0f0e" };

function readFoodableTheme() {
    const v = document
        .querySelector('meta[name="foodable-theme"]')
        ?.getAttribute("content");
    return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function syncThemeColorMeta(theme) {
    document
        .querySelectorAll('meta[name="theme-color"]')
        .forEach((el) => el.remove());
    if (theme === "system") {
        for (const [scheme, bg] of [
            ["(prefers-color-scheme: light)", THEME_PAGE_BG.light],
            ["(prefers-color-scheme: dark)", THEME_PAGE_BG.dark],
        ]) {
            const m = document.createElement("meta");
            m.name = "theme-color";
            m.content = bg;
            m.setAttribute("media", scheme);
            document.head.appendChild(m);
        }
    } else {
        const m = document.createElement("meta");
        m.name = "theme-color";
        m.content = THEME_PAGE_BG[theme];
        document.head.appendChild(m);
    }
}

function syncDocumentTheme() {
    if (typeof document.querySelector !== "function") return;
    const theme = readFoodableTheme();
    const html = document.documentElement;
    if (!html) return;
    if (theme === "system") {
        if (typeof html.removeAttribute === "function")
            html.removeAttribute("data-theme");
    } else if (typeof html.setAttribute === "function") {
        html.setAttribute("data-theme", theme);
    }
    if (typeof document.createElement === "function" && document.head) {
        syncThemeColorMeta(theme);
    }
}

function onTurboThemeSync() {
    syncDocumentTheme();
}

document.addEventListener("turbo:before-render", onTurboThemeSync);
document.addEventListener("turbo:render", onTurboThemeSync);
document.addEventListener("turbo:load", onTurboThemeSync);
document.addEventListener("turbo:morph", onTurboThemeSync);
if (typeof document.querySelector === "function") syncDocumentTheme();

// Login during an in-app visit must full-load (never morph into app chrome).
// preventDefault() stops Turbo from rendering; reload() replaces the visit.
document.addEventListener("turbo:before-render", (event) => {
    const newBody = event.detail?.newBody;
    if (
        newBody &&
        newBody.querySelector("form.auth-form") &&
        document.querySelector("nav.bottom-nav")
    ) {
        event.preventDefault();
        window.location.reload();
    }
});

document.addEventListener("turbo:before-morph-element", (event) => {
    const { currentElement, newElement } = event.detail || {};
    if (
        currentElement instanceof HTMLIFrameElement &&
        currentElement.classList.contains("widget-frame") &&
        newElement instanceof HTMLIFrameElement
    ) {
        const oldDoc = currentElement.getAttribute("srcdoc") || "";
        const newDoc = newElement.getAttribute("srcdoc") || "";
        if (oldDoc === newDoc) event.preventDefault();
    }
});

// html.fx is set inside a frame, never under prefers-reduced-motion, so a
// renderer that never ticks keeps the static page. Guard matchMedia: tests
// run this script against a fake window without it. The pointer glow on
// panels (magic-card) only reads --mx / --my.
const mq = (q) =>
    typeof window.matchMedia === "function" && window.matchMedia(q).matches;
if (
    typeof window.matchMedia === "function" &&
    !mq("(prefers-reduced-motion: reduce)")
) {
    window.requestAnimationFrame(() =>
        document.documentElement.classList.add("fx"),
    );
}
if (mq("(hover: hover) and (pointer: fine)")) {
    document.addEventListener(
        "pointermove",
        (e) => {
            const panel =
                e.target instanceof Element &&
                e.target.closest(".app-main .panel");
            if (!panel) return;
            const r = panel.getBoundingClientRect();
            panel.style.setProperty("--mx", e.clientX - r.left + "px");
            panel.style.setProperty("--my", e.clientY - r.top + "px");
        },
        { passive: true },
    );
}

const widgetFramesInit = new WeakSet();

function initWidgetFrames(root) {
    root.querySelectorAll(".widget-frame").forEach((frame) => {
        if (widgetFramesInit.has(frame)) return;
        widgetFramesInit.add(frame);
        const fit = () => {
            try {
                const doc = frame.contentDocument;
                if (!doc) return;
                const el = doc.documentElement;
                const prev = el.style.height;
                el.style.height = "max-content";
                const height = Math.ceil(el.getBoundingClientRect().height);
                el.style.height = prev;
                if (height) frame.style.height = height + "px";
            } catch (_) {}
        };
        fit();
        frame.addEventListener("load", fit);
        window.addEventListener("message", (e) => {
            if (e.source !== frame.contentWindow) return;
            const d = e.data;
            if (
                d &&
                d.method &&
                String(d.method).endsWith("size-changed") &&
                d.params &&
                d.params.height
            ) {
                frame.style.height = d.params.height + "px";
            }
        });
    });
}

window.FoodableApp.onLoad(initWidgetFrames);
