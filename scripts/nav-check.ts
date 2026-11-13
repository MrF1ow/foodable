/**
 * Headless browser check for Turbo-driven in-app navigation (P8): the shell on
 * a phone and on a desktop, session expiry, the legacy redirects and theme
 * sync across Turbo visits and full loads.
 * Starts the fixture server, drives Chromium over CDP, exits non-zero on failure.
 */
import { spawn } from "bun";
import { join } from "node:path";
import { THEME_COLOR } from "../src/tokens.js";

const CDP_PORT = 9223;
const BASE = "http://127.0.0.1:4791";
function findChrome(): string {
    if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
    for (const bin of ["/usr/bin/chromium", "/usr/bin/chromium-browser"]) {
        try {
            if (Bun.file(bin).size > 0) return bin;
        } catch {
            // missing
        }
    }
    throw new Error("Chromium not found; set CHROME_BIN");
}
const CHROME = findChrome();

const results: { name: string; pass: boolean; detail: unknown }[] = [];
function record(name: string, pass: boolean, detail: unknown) {
    results.push({ name, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
    console.log(JSON.stringify(detail).slice(0, 1200));
}

const fixture = spawn(
    ["bun", "run", join(import.meta.dir, "nav-check-fixture.ts")],
    {
        cwd: join(import.meta.dir, ".."),
        stdout: "inherit",
        stderr: "inherit",
    },
);

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function waitFixture() {
    for (let i = 0; i < 120; i++) {
        try {
            const r = await fetch(`${BASE}/__stats`);
            if (r.ok) return;
        } catch {
            // not up
        }
        await sleep(250);
    }
    throw new Error("fixture server did not start on :4791");
}

const chrome = spawn(
    [
        CHROME,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        `--remote-debugging-port=${CDP_PORT}`,
        "--remote-allow-origins=*",
        "--user-data-dir=/tmp/foodable-nav-check-chrome",
        "--window-size=430,900",
        "about:blank",
    ],
    { stdout: "ignore", stderr: "pipe" },
);

async function waitCdp() {
    for (let i = 0; i < 50; i++) {
        try {
            const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
            if (list.ok) {
                const pages = (await list.json()) as {
                    type: string;
                    webSocketDebuggerUrl: string;
                }[];
                const page = pages.find((p) => p.type === "page");
                if (page) return page;
            }
        } catch {
            // not up
        }
        await sleep(100);
    }
    throw new Error("CDP did not come up");
}

type Msg = {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message: string };
};

await waitFixture();
const page = await waitCdp();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws error"));
});

let nextId = 0;
const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
const exceptions: string[] = [];
ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data)) as Msg;
    if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
        return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails as {
            text?: string;
            exception?: { description?: string };
        };
        exceptions.push(d?.exception?.description || d?.text || "exception");
    }
};
function send(method: string, params: Record<string, unknown> = {}) {
    const id = ++nextId;
    return new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
    });
}
function drain() {
    const copy = exceptions.slice();
    exceptions.length = 0;
    return copy.map((e) => e.split("\n")[0]!.slice(0, 240));
}
async function ev<T>(expression: string): Promise<T> {
    const res = (await send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
    })) as {
        result?: { value?: T };
        exceptionDetails?: {
            text?: string;
            exception?: { description?: string };
        };
    };
    if (res.exceptionDetails) {
        throw new Error(
            res.exceptionDetails.exception?.description ||
                res.exceptionDetails.text ||
                "eval exception",
        );
    }
    return res.result?.value as T;
}
async function goto(path: string) {
    drain();
    await send("Page.navigate", { url: BASE + path });
    await ev(`new Promise((resolve) => {
        if (document.readyState === "complete") setTimeout(resolve, 50);
        else window.addEventListener("load", () => setTimeout(resolve, 50), { once: true });
    })`);
    await sleep(150);
}
async function control(q: string) {
    const r = await fetch(`${BASE}/__control?${q}`);
    return r.json();
}
async function stats() {
    const r = await fetch(`${BASE}/__stats`);
    return r.json() as Promise<{
        posts: { path: string; entries: [string, string][] }[];
        approveCount: number;
    }>;
}
type Snap = {
    href: string;
    title: string;
    h1: string | null;
    marker: string | null;
    active: string | null;
    scrollY: number;
    bodyPos: string;
    open: string[];
    error: string | null;
    auth: boolean;
};
async function snap(): Promise<Snap> {
    return ev(`(() => ({
        href: location.href,
        title: document.title,
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        marker: window.__marker ?? null,
        active: document.querySelector(".fd-tabs a[aria-current='page']")?.getAttribute("aria-label") ?? null,
        scrollY: Math.round(window.scrollY || 0),
        bodyPos: document.body ? (document.body.style.position || "") : "",
        open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
        error: document.querySelector("#p8-error")?.textContent ?? null,
        auth: !!document.querySelector("form.auth-form"),
    }))()`);
}
// The selector goes in as a call argument, not spliced into evaluated source.
async function clickSel(sel: string) {
    const doc = (await send("Runtime.evaluate", {
        expression: "document",
    })) as { result: { objectId: string } };
    const res = (await send("Runtime.callFunctionOn", {
        objectId: doc.result.objectId,
        functionDeclaration:
            "function (sel) { const el = this.querySelector(sel); if (el) el.click(); return !!el; }",
        arguments: [{ value: sel }],
        returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (!res.result?.value) {
        const where = await ev<string>(
            `location.href + " | " + document.title + " | " + (document.body?.className ?? "") + " | " + (document.body?.innerText ?? "").slice(0, 120)`,
        );
        throw new Error(`clickSel: no element matches ${sel} (at ${where})`);
    }
}
async function setMarker() {
    await ev(`window.__marker = "stay"`);
}
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 800,
    deviceScaleFactor: 1,
    mobile: true,
});

await import("node:fs/promises").then((fs) =>
    fs.mkdir("./tmp", { recursive: true }),
);
try {
    // A bookmarked old path still lands on its new home. This checks only the
    // first hop (the real app then forwards /settings/household/items on to
    // /settings/saved; the fixture does not serve that second page).
    await control("session=app&theme=dark&reset=posts&post=ok");
    const legacyGet = await fetch(`${BASE}/settings/foods?q=eggs`, {
        redirect: "manual",
    });
    const legacyPost = await fetch(`${BASE}/settings/foods`, {
        method: "POST",
        redirect: "manual",
    });
    const legacyGetTo = new URL(legacyGet.headers.get("location") ?? "", BASE);
    const legacyPostTo = new URL(
        legacyPost.headers.get("location") ?? "",
        BASE,
    );
    record(
        "legacy /settings/foods: first hop is a 301 to /settings/household/items (query kept, POST 308)",
        legacyGet.status === 301 &&
            legacyGetTo.pathname === "/settings/household/items" &&
            legacyGetTo.search === "?q=eggs" &&
            legacyPost.status === 308 &&
            legacyPostTo.pathname === "/settings/household/items",
        {
            get: [legacyGet.status, legacyGetTo.pathname + legacyGetTo.search],
            post: [legacyPost.status, legacyPostTo.pathname],
            ex: drain(),
        },
    );

    await control("reset=approve");
    await goto("/login-test");
    await ev(`window.__marker = "stay"`);
    await ev(`(() => {
        document.querySelector("input[name='email']").value = "a@b.co";
        document.querySelector("input[name='password']").value = "secret12";
    })()`);
    await clickSel("form.auth-form button[type='submit']");
    await sleep(600);
    const loginEnd = await snap();
    const approve = (await stats()).approveCount;
    record("login native submit", approve === 1 && loginEnd.marker == null, {
        approve,
        loginEnd,
        ex: drain(),
    });

    await goto("/kitchen/fridge");
    await setMarker();
    await ev(`(() => {
        const a = document.createElement("a");
        a.href = "/session-login";
        document.querySelector("main").appendChild(a);
        a.click();
    })()`);
    await sleep(1500);
    const expiredGet = await snap();
    const hasAppNavGet = await ev<boolean>(
        `!!document.querySelector(".fd-tabs")`,
    );
    record(
        "expired session GET login full reload",
        expiredGet.auth === true && expiredGet.marker == null && !hasAppNavGet,
        { expiredGet, hasAppNavGet, ex: drain() },
    );

    await goto("/");
    await setMarker();
    await control("post=login&reset=posts&session=guest");
    // The log sheet's quick-water form: any signed-in POST will do.
    await clickSel('form[action="/log/water"] button[type="submit"]');
    await sleep(1500);
    const expiredPost = await snap();
    const hasAppNavPost = await ev<boolean>(
        `!!document.querySelector(".fd-tabs")`,
    );
    record(
        "expired session POST login full reload",
        expiredPost.auth === true &&
            expiredPost.marker == null &&
            !hasAppNavPost &&
            expiredPost.open.length === 0,
        { expiredPost, hasAppNavPost, ex: drain() },
    );

    await ev(`(() => {
        document.querySelector("input[name='email']").value = "a@b.co";
        document.querySelector("input[name='password']").value = "secret12";
    })()`);
    await clickSel("form.auth-form button[type='submit']");
    await sleep(600);
    const loginAfterExpired = await snap();
    const approveAfter = (await stats()).approveCount;
    record(
        "login form native submit after session expiry",
        approveAfter >= 2 && loginAfterExpired.auth === false,
        { approveAfter, loginAfterExpired, ex: drain() },
    );

    // ---- The shell: phone nav, desktop chrome, Turbo ----
    await control("session=app&theme=dark&reset=posts&post=ok");
    const v2Snap = () =>
        ev<{
            tabs: string;
            sidebar: string;
            topbar: string;
            active: string | null;
            side: string | null;
            h1: string | null;
            marker: string | null;
            themeColor: string | null;
            themeChrome: string | null;
            navW: number;
            navH: number;
            navGap: number;
            navCentre: number;
            chrome: string | null;
            chip: string | null;
            tracked: number;
            open: string[];
            hash: string;
            bottomNav: boolean;
        }>(`(() => {
            const q = (s) => document.querySelector(s);
            const disp = (s) => (q(s) ? getComputedStyle(q(s)).display : "missing");
            const nav = q(".fd-tabs");
            const r = nav ? nav.getBoundingClientRect() : { width: 0, height: 0, bottom: 0, left: 0 };
            return {
                tabs: disp(".fd-tabs"),
                sidebar: disp(".fd-sidebar"),
                topbar: disp(".fd-topbar"),
                active: q(".fd-tabs a[aria-current='page']")?.getAttribute("aria-label") ?? null,
                side: q(".fd-sidenav a.fd-sidelink[aria-current] .fd-sidelink-label")?.textContent ?? null,
                h1: q("h1")?.textContent?.trim() ?? null,
                marker: window.__marker ?? null,
                themeColor: q("meta[name='theme-color']")?.getAttribute("content") ?? null,
                themeChrome: q("meta[name='foodable-theme-chrome']")?.getAttribute("content") ?? null,
                navW: Math.round(r.width),
                navH: Math.round(r.height),
                navGap: Math.round(innerHeight - r.bottom),
                navCentre: Math.round(r.left + r.width / 2 - document.documentElement.clientWidth / 2),
                chrome: q("meta[name='foodable-theme-chrome']")?.getAttribute("content") ?? null,
                chip: q(".fd-account-chip")?.getAttribute("href") ?? null,
                tracked: document.querySelectorAll("link[rel='stylesheet'][data-turbo-track='reload'], script[data-turbo-track='reload']").length,
                open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
                hash: location.hash,
                bottomNav: !!q("nav.bottom-nav"),
            };
        })()`);

    await goto("/");
    await setMarker();
    const v2Today = await v2Snap();
    await clickSel('.fd-tabs a[href="/kitchen/fridge"]');
    await sleep(250);
    const v2Kitchen = await v2Snap();
    await clickSel('.fd-tabs a[href="/recipes"]');
    await sleep(250);
    const v2Recipes = await v2Snap();
    record(
        "v2 shell phone: floating nav, Turbo tab visits keep the page",
        v2Today.tabs === "flex" &&
            v2Today.sidebar === "none" &&
            v2Today.topbar === "none" &&
            v2Today.active === "Today" &&
            v2Today.navW === 278 &&
            v2Today.navH === 58 &&
            v2Today.navGap >= 24 &&
            Math.abs(v2Today.navCentre) <= 1 &&
            v2Today.tracked === 4 &&
            !v2Today.bottomNav &&
            v2Kitchen.marker === "stay" &&
            v2Kitchen.active === "Kitchen" &&
            /^Kitchen/.test(v2Kitchen.h1 || "") &&
            v2Recipes.marker === "stay" &&
            v2Recipes.active === "Recipes",
        { v2Today, v2Kitchen, v2Recipes, ex: drain() },
    );
    record(
        "v2 shell browser chrome: page colour, honest meta, kept across visits",
        v2Today.themeChrome === "page" &&
            v2Today.themeColor === THEME_COLOR.dark &&
            v2Kitchen.themeColor === THEME_COLOR.dark &&
            v2Recipes.themeColor === THEME_COLOR.dark,
        { v2Today, v2Kitchen, v2Recipes },
    );

    await send("Emulation.setDeviceMetricsOverride", {
        width: 1024,
        height: 800,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/");
    await setMarker();
    const v2Breakpoint = await v2Snap();
    record(
        "v2 shell at 1024px: sidebar and top bar, phone tab bar hidden",
        v2Breakpoint.tabs === "none" &&
            v2Breakpoint.sidebar === "flex" &&
            v2Breakpoint.topbar === "flex" &&
            !v2Breakpoint.bottomNav,
        { v2Breakpoint, ex: drain() },
    );

    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/recipes");
    await setMarker();
    const v2Desktop = await v2Snap();
    const sidebarW = await ev<number>(
        `Math.round(document.querySelector(".fd-sidebar").getBoundingClientRect().width)`,
    );
    const exposedNavs = await ev<number>(
        `[...document.querySelectorAll("nav.fd-tabs, nav.fd-sidenav")].filter((n) => getComputedStyle(n).display !== "none").length`,
    );
    await clickSel('.fd-sidenav a[href="/kitchen/fridge"]');
    await sleep(250);
    const v2DesktopKitchen = await v2Snap();
    record(
        "v2 shell desktop: sidebar and top bar replace the phone nav",
        v2Desktop.tabs === "none" &&
            v2Desktop.sidebar === "flex" &&
            v2Desktop.topbar === "flex" &&
            v2Desktop.side === "Recipes" &&
            sidebarW === 248 &&
            exposedNavs === 1 &&
            v2DesktopKitchen.marker === "stay" &&
            v2DesktopKitchen.side === "Kitchen",
        { v2Desktop, sidebarW, exposedNavs, v2DesktopKitchen, ex: drain() },
    );

    await goto("/");
    await setMarker();
    const v2TodayDesk = await ev<string>(
        `document.querySelector(".fd-today-rail") ? getComputedStyle(document.querySelector(".fd-today-rail")).display : "missing"`,
    );
    const v2TodayGrid = await ev<string>(
        `document.querySelector(".fd-today-page") ? getComputedStyle(document.querySelector(".fd-today-page")).display : "missing"`,
    );
    record(
        "v2 today at 1440px: two-column layout and right-hand rail",
        v2TodayDesk === "flex" && v2TodayGrid === "grid",
        { v2TodayDesk, v2TodayGrid, ex: drain() },
    );

    const modK = process.platform === "darwin" ? 4 : 2;
    await send("Input.dispatchKeyEvent", {
        type: "rawKeyDown",
        modifiers: modK,
        key: "k",
        code: "KeyK",
        windowsVirtualKeyCode: 75,
        nativeVirtualKeyCode: 75,
    });
    await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        modifiers: modK,
        key: "k",
        code: "KeyK",
        windowsVirtualKeyCode: 75,
        nativeVirtualKeyCode: 75,
    });
    await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: modK,
        key: "k",
        code: "KeyK",
        windowsVirtualKeyCode: 75,
        nativeVirtualKeyCode: 75,
    });
    await sleep(400);
    const v2CmdK = await ev<{
        open: string[];
        activeId: string | null;
    }>(`({
        open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
        activeId: document.activeElement?.id ?? null,
    })`);
    record(
        "v2 desktop ⌘K/Ctrl+K opens log search with the query field focused",
        v2CmdK.open.includes("fd-log-search") &&
            v2CmdK.activeId === "fd-log-search-q",
        { v2CmdK, ex: drain() },
    );
    await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
    });
    await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
    });
    await sleep(200);

    await goto("/recipes");
    await setMarker();
    await clickSel("a.fd-household");
    await sleep(500);
    const sidebarHousehold = await ev<{ path: string; side: string | null }>(`({
        path: location.pathname,
        side: document.querySelector(".fd-sidenav a.fd-sidelink[aria-current] .fd-sidelink-label")?.textContent ?? null,
    })`);
    record(
        "v2 sidebar Household block opens the members page",
        sidebarHousehold.path === "/settings/household" &&
            sidebarHousehold.side === "Settings",
        { sidebarHousehold, ex: drain() },
    );
    await clickSel('.fd-sidenav a[href="/settings"]');
    await sleep(400);
    const v2SidebarSettings = await v2Snap();
    record(
        "v2 sidebar Settings opts out of Turbo (full load)",
        v2SidebarSettings.marker == null &&
            (await ev<string>(`location.pathname`)) === "/settings",
        { v2SidebarSettings },
    );
    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });

    await goto("/");
    await setMarker();
    await clickSel(".fd-account-chip");
    await sleep(400);
    const chipNav = await ev<{ marker: string | null; path: string }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
    })`);
    record(
        "v2 account chip opens Settings with a full load",
        chipNav.marker == null && chipNav.path === "/settings",
        chipNav,
    );

    // Groceries and Usuals are reached from the Kitchen text tabs; Household
    // from Settings (phone) or the sidebar's Household block (desktop).
    await goto("/kitchen/fridge");
    await setMarker();
    const kitchenRow = () =>
        ev<{
            tabs: string[];
            current: string | null;
            h1: string | null;
            marker: string | null;
            phoneCurrent: string | null;
        }>(`({
            tabs: [...document.querySelectorAll(".fd-kitchen-tab")].map((a) => a.getAttribute("href")),
            current: document.querySelector(".fd-kitchen-tab[aria-current='page']")?.textContent ?? null,
            h1: document.querySelector("h1")?.textContent?.trim() ?? null,
            marker: window.__marker ?? null,
            phoneCurrent: document.querySelector(".fd-tabs a[aria-current='page']")?.getAttribute("aria-label") ?? null,
        })`);
    const kFridge = await kitchenRow();
    await clickSel('.fd-kitchen-tab[href="/kitchen/groceries"]');
    await sleep(300);
    const kGroceries = await kitchenRow();
    record(
        "v2 Kitchen text tabs reach Groceries over Turbo",
        kFridge.current === "Fridge" &&
            kFridge.tabs.join() ===
                "/kitchen/fridge,/kitchen/groceries,/kitchen/usuals" &&
            kGroceries.marker === "stay" &&
            /^Groceries/.test(kGroceries.current || "") &&
            /^Kitchen/.test(kGroceries.h1 || "") &&
            kGroceries.phoneCurrent === "Kitchen",
        { kFridge, kGroceries, ex: drain() },
    );

    await goto("/settings");
    await setMarker();
    const settingsHome = await ev<{
        page: string | null;
        hasMenu: boolean;
        marker: string | null;
    }>(`({
        page: document.querySelector(".fd-settings")?.getAttribute("data-fd-settings-page") ?? null,
        hasMenu: !!document.querySelector(".fd-settings-menu a[href='/settings/account']"),
        marker: window.__marker ?? null,
    })`);
    await clickSel(".fd-settings-menu a[href='/settings/account']");
    await sleep(400);
    const accountPage = await ev<{
        path: string;
        backTurbo: string | null;
        marker: string | null;
    }>(`({
        path: location.pathname,
        backTurbo: document.querySelector(".fd-settings-back")?.getAttribute("data-turbo") ?? null,
        marker: window.__marker ?? null,
    })`);
    record(
        "v2 Settings home and account menu navigation",
        settingsHome.page === "home" &&
            settingsHome.hasMenu &&
            accountPage.path === "/settings/account" &&
            accountPage.backTurbo === "false",
        { settingsHome, accountPage, ex: drain() },
    );

    await goto("/kitchen/fridge");
    await setMarker();
    await clickSel("a.fd-log");
    await sleep(500);
    const v2Log = await v2Snap();
    await goto("/");
    await setMarker();
    await clickSel('.fd-tabs a[href="/trends"]');
    await sleep(500);
    const v2Trends = await v2Snap();
    const trendsPage = await ev<{ path: string; title: string | null }>(`({
        path: location.pathname,
        title: document.querySelector(".fd-trends-title")?.textContent?.trim() ?? null,
    })`);
    await clickSel('[data-fd-trends-range="7"]');
    await sleep(200);
    const trends7d = await ev<{
        pressed: string | null;
        panel: string | null;
        hidden30: boolean;
    }>(`({
        pressed: document.querySelector('[data-fd-trends-range][aria-pressed="true"]')?.getAttribute("data-fd-trends-range") ?? null,
        panel: document.querySelector("[data-fd-trends-panel]:not([hidden])")?.getAttribute("data-fd-trends-panel") ?? null,
        hidden30: document.querySelector('[data-fd-trends-panel="30"]')?.hasAttribute("hidden") ?? false,
    })`);
    record(
        "v2 Log opens the search sheet; Trends tab reaches /trends",
        v2Log.marker === "stay" &&
            v2Log.open.includes("fd-log-search") &&
            v2Log.hash === "" &&
            v2Trends.active === "Trends" &&
            trendsPage.path === "/trends" &&
            trendsPage.title === "Trends" &&
            trends7d.pressed === "7" &&
            trends7d.panel === "7" &&
            trends7d.hidden30,
        { v2Log, v2Trends, trendsPage, trends7d, ex: drain() },
    );

    // ---- Theme sync: Display form, Turbo visits, Settings entries ----
    // The saved theme reaches <html data-theme>, meta[foodable-theme] and the
    // theme-color metas on every load or Turbo visit (src/web/client/shell.js).
    // The shell's browser chrome is the page colour on every route, so a
    // Settings link and a tab link share one set of metas.
    async function themeSnap() {
        return ev<{
            dataTheme: string | null;
            meta: string | null;
            bg: string;
            widgetTheme: string | null;
            marker: string | null;
            hasMain: boolean;
        }>(`(() => {
            const frame = document.querySelector(".widget-frame");
            let widgetTheme = null;
            try {
                widgetTheme = frame?.contentDocument?.documentElement?.getAttribute("data-theme") ?? null;
            } catch (_) {}
            return {
                dataTheme: document.documentElement.getAttribute("data-theme"),
                meta: document.querySelector('meta[name="foodable-theme"]')?.getAttribute("content") ?? null,
                bg: getComputedStyle(document.body).getPropertyValue("--bg").trim(),
                widgetTheme,
                marker: window.__marker ?? null,
                hasMain: !!document.querySelector("main.app-main"),
            };
        })()`);
    }
    // Every theme-color meta as "content" or "content|media", in document order.
    async function themeMetaSig() {
        return ev<string>(
            `[...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("content") + (m.getAttribute("media") ? "|" + m.getAttribute("media") : "")).join(",")`,
        );
    }
    function expectedMetaSig(theme: "light" | "dark" | "system") {
        return theme === "system"
            ? `${THEME_COLOR.light}|(prefers-color-scheme: light),${THEME_COLOR.dark}|(prefers-color-scheme: dark)`
            : THEME_COLOR[theme];
    }
    async function themeChromeKind() {
        return ev<string | null>(
            `document.querySelector('meta[name="foodable-theme-chrome"]')?.getAttribute("content") ?? null`,
        );
    }
    // Tag each theme-color meta with an expando so a later check can tell a
    // kept node from one Turbo removed and re-created.
    async function tagThemeMetas() {
        return ev<number>(`(() => {
            const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
            metas.forEach((m, i) => { m.__foodableNavCheck = 100 + i; });
            return metas.length;
        })()`);
    }
    async function themeMetaIdentity() {
        return ev<{ count: number; kept: boolean[] }>(`(() => {
            const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
            return {
                count: metas.length,
                kept: metas.map((m, i) => m.__foodableNavCheck === 100 + i),
            };
        })()`);
    }
    async function pickTheme(value: "light" | "dark" | "system") {
        await ev(`(() => {
            const radio = document.querySelector('input[name="theme"][value="${value}"]');
            radio.checked = true;
            radio.form.requestSubmit();
        })()`);
        await sleep(600);
    }

    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/display");
    await setMarker();
    const darkStart = await themeSnap();
    const darkStartMetas = await themeMetaSig();
    await pickTheme("light");
    const afterLight = await themeSnap();
    const afterLightMetas = await themeMetaSig();
    const displayPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/display",
    );

    // Back is a full load, twice over: Display to Settings home, then Settings
    // home to the Today tab.
    await setMarker();
    await clickSel("a.fd-settings-back");
    await sleep(400);
    const backHop1 = await ev<{ path: string; marker: string | null }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
    })`);
    await setMarker();
    await clickSel("a.fd-settings-phone-back");
    await sleep(400);
    const afterBack = await themeSnap();
    const backMetas = await themeMetaSig();
    const backChrome = await themeChromeKind();
    const backPath = await ev<string>(`location.pathname`);
    record(
        "settings back full load to tab",
        backHop1.path === "/settings" &&
            backHop1.marker == null &&
            backPath === "/" &&
            afterBack.marker == null &&
            backChrome === "page" &&
            afterBack.dataTheme === "light" &&
            afterBack.bg === THEME_COLOR.light &&
            backMetas === expectedMetaSig("light"),
        { backHop1, backPath, afterBack, backMetas, backChrome, ex: drain() },
    );

    // A Turbo visit between tabs keeps the very same theme-color nodes.
    await setMarker();
    const themeMetaCount = await tagThemeMetas();
    await clickSel('.fd-tabs a[href="/kitchen/fridge"]');
    await sleep(250);
    const fridgeTheme = await themeSnap();
    const fridgeMetas = await themeMetaSig();
    const fridgeIdentity = await themeMetaIdentity();
    record(
        "fridge tab visit keeps theme-color metas in place",
        fridgeTheme.marker === "stay" &&
            fridgeTheme.dataTheme === "light" &&
            fridgeTheme.bg === THEME_COLOR.light &&
            fridgeMetas === expectedMetaSig("light") &&
            themeMetaCount === 1 &&
            fridgeIdentity.count === themeMetaCount &&
            fridgeIdentity.kept.every(Boolean),
        {
            fridgeTheme,
            fridgeMetas,
            fridgeIdentity,
            themeMetaCount,
            ex: drain(),
        },
    );

    // The account chip is the way into Settings from a tab: also a full load.
    await setMarker();
    await clickSel(".fd-account-chip");
    await sleep(400);
    const afterGear = await themeSnap();
    const gearMetas = await themeMetaSig();
    const gearChrome = await themeChromeKind();
    const gearPath = await ev<string>(`location.pathname`);
    record(
        "settings gear full load from tab",
        gearPath === "/settings" &&
            afterGear.marker == null &&
            gearChrome === "page" &&
            afterGear.dataTheme === "light" &&
            afterGear.bg === THEME_COLOR.light &&
            gearMetas === expectedMetaSig("light"),
        { gearPath, afterGear, gearMetas, gearChrome, ex: drain() },
    );

    // Settings home's own theme buttons: Auto drops data-theme and brings back
    // the media-keyed metas.
    await setMarker();
    await clickSel('button.fd-settings-theme-btn[value="system"]');
    await sleep(600);
    const afterSystem = await themeSnap();
    const systemMetas = await themeMetaSig();
    const systemPath = await ev<string>(`location.pathname`);

    await setMarker();
    await clickSel('.fd-settings-menu a[href^="/settings/help"]');
    await sleep(300);
    const afterHelp = await themeSnap();
    const helpPath = await ev<string>(`location.pathname`);
    const helpMetas = await themeMetaSig();
    const helpChrome = await themeChromeKind();
    record(
        "settings help sub-nav turbo visit",
        helpPath === "/settings/help" &&
            afterHelp.marker === "stay" &&
            helpChrome === "page" &&
            afterHelp.dataTheme === null &&
            afterHelp.meta === "system" &&
            helpMetas === expectedMetaSig("system"),
        { helpPath, afterHelp, helpMetas, helpChrome, ex: drain() },
    );

    record(
        "theme sync across account form and settings chrome",
        darkStart.dataTheme === "dark" &&
            darkStart.marker === "stay" &&
            darkStart.bg === THEME_COLOR.dark &&
            darkStartMetas === expectedMetaSig("dark") &&
            displayPosts.length === 1 &&
            displayPosts[0]!.entries.some(
                ([k, v]) => k === "theme" && v === "light",
            ) &&
            afterLight.marker == null &&
            afterLight.dataTheme === "light" &&
            afterLight.meta === "light" &&
            afterLight.bg === THEME_COLOR.light &&
            afterLightMetas === expectedMetaSig("light") &&
            systemPath === "/settings" &&
            afterSystem.marker == null &&
            afterSystem.dataTheme === null &&
            afterSystem.meta === "system" &&
            afterSystem.bg === THEME_COLOR.light &&
            systemMetas === expectedMetaSig("system"),
        {
            darkStart,
            darkStartMetas,
            afterLight,
            afterLightMetas,
            displayPosts,
            afterSystem,
            systemMetas,
            systemPath,
            ex: drain(),
        },
    );

    // The saved theme changes elsewhere (another device): the next Turbo
    // visit carries it into <html>, the meta and the browser chrome without a
    // reload. Turbo's head merge replaces a theme-color node whose colour
    // changed, so only the end state is pinned here; the in-place update is
    // pinned by the next case. The visit starts on Settings Help under Auto.
    await control("theme=dark");
    await clickSel('.fd-tabs a[href="/kitchen/fridge"]');
    await sleep(300);
    const flipDark = await themeSnap();
    const flipDarkMetas = await themeMetaSig();
    await control("theme=light");
    await clickSel('.fd-tabs a[href="/recipes"]');
    await sleep(300);
    const flipLight = await themeSnap();
    const flipLightMetas = await themeMetaSig();
    await control("theme=system");
    await clickSel('.fd-tabs a[href="/trends"]');
    await sleep(300);
    const flipSystem = await themeSnap();
    const flipSystemMetas = await themeMetaSig();
    record(
        "theme flipped between Turbo visits reaches html and the theme-color metas",
        flipDark.marker === "stay" &&
            flipDark.dataTheme === "dark" &&
            flipDark.meta === "dark" &&
            flipDark.bg === THEME_COLOR.dark &&
            flipDarkMetas === expectedMetaSig("dark") &&
            flipLight.marker === "stay" &&
            flipLight.dataTheme === "light" &&
            flipLight.meta === "light" &&
            flipLight.bg === THEME_COLOR.light &&
            flipLightMetas === expectedMetaSig("light") &&
            flipSystem.marker === "stay" &&
            flipSystem.dataTheme === null &&
            flipSystem.meta === "system" &&
            flipSystemMetas === expectedMetaSig("system"),
        {
            flipDark,
            flipDarkMetas,
            flipLight,
            flipLightMetas,
            flipSystem,
            flipSystemMetas,
            ex: drain(),
        },
    );

    // The sync in shell.js (turbo:before-render, after Turbo's head merge has
    // delivered the new meta[foodable-theme]) updates <html> and the theme-color
    // metas in place: content and media change on the same nodes, and a missing
    // media-keyed meta is added without touching the first. Driven here by
    // changing meta[foodable-theme] and firing the event Turbo fires.
    await control("theme=dark");
    await goto("/");
    await setMarker();
    const inPlaceTags = await tagThemeMetas();
    const inPlaceStart = await themeMetaSig();
    const inPlaceStep = async (theme: "light" | "system" | "dark") => {
        await ev(`(() => {
            document.querySelector('meta[name="foodable-theme"]').setAttribute("content", "${theme}");
            document.dispatchEvent(new CustomEvent("turbo:before-render"));
        })()`);
        return {
            snap: await themeSnap(),
            sig: await themeMetaSig(),
            identity: await themeMetaIdentity(),
            media: await ev<(string | null)[]>(
                `[...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute("media"))`,
            ),
        };
    };
    const inPlaceLight = await inPlaceStep("light");
    const inPlaceSystem = await inPlaceStep("system");
    const inPlaceDark = await inPlaceStep("dark");
    record(
        "theme sync updates theme-color metas in place (same nodes, content and media)",
        inPlaceTags === 1 &&
            inPlaceStart === expectedMetaSig("dark") &&
            inPlaceLight.snap.dataTheme === "light" &&
            inPlaceLight.sig === expectedMetaSig("light") &&
            inPlaceLight.identity.count === 1 &&
            inPlaceLight.identity.kept[0] === true &&
            inPlaceSystem.snap.dataTheme === null &&
            inPlaceSystem.sig === expectedMetaSig("system") &&
            inPlaceSystem.identity.count === 2 &&
            inPlaceSystem.identity.kept[0] === true &&
            inPlaceDark.snap.dataTheme === "dark" &&
            inPlaceDark.identity.kept[0] === true &&
            inPlaceDark.media.every((m) => m == null) &&
            inPlaceDark.sig.split(",").every((c) => c === THEME_COLOR.dark) &&
            inPlaceDark.snap.marker === "stay",
        {
            inPlaceTags,
            inPlaceStart,
            inPlaceLight,
            inPlaceSystem,
            inPlaceDark,
            ex: drain(),
        },
    );

    // A revisit must render once: a cached-snapshot preview followed by the
    // fresh page replays the entrance animation, so the tab "loads twice".
    // Leaving "/" cached it; without that the check passes on a cache miss.
    // The preview waits a frame and a faster response cancels it, so stall
    // the response the way a real network does.
    await control("theme=dark");
    await goto("/");
    await ev(`new Promise((resolve) => {
        document.addEventListener("turbo:load", resolve, { once: true });
        document.querySelector('.fd-tabs a[href="/kitchen/fridge"]').click();
    })`);
    const rootCached = await ev<boolean>(
        `Turbo.session.view.snapshotCache.has(new URL("/", location.href))`,
    );
    await control("stall=300");
    const renders = await ev<boolean[]>(`new Promise((resolve) => {
        const renders = [];
        const onRender = () => renders.push(
            document.documentElement.hasAttribute("data-turbo-preview"));
        document.addEventListener("turbo:render", onRender);
        document.addEventListener("turbo:load", () => {
            document.removeEventListener("turbo:render", onRender);
            resolve(renders);
        }, { once: true });
        document.querySelector('.fd-tabs a[href="/"]').click();
    })`);
    await control("stall=0");
    record(
        "tab revisit renders once (no cached preview)",
        rootCached && renders.length === 1 && renders[0] === false,
        { rootCached, renders },
    );

    await goto("/");

    await control("session=app");
    await goto("/settings/account");
    await setMarker();
    await clickSel('main a[href="/logout"][data-turbo="false"]');
    await sleep(300);
    const logout = await ev<{ marker: string | null; out: string | null }>(`({
        marker: window.__marker ?? null,
        out: document.querySelector("#out")?.textContent ?? null,
    })`);
    record(
        "logout native navigation",
        logout.marker == null && logout.out === "logged out",
        logout,
    );

    const ex = drain();
    record("no uncaught console errors", ex.length === 0, { ex });
} catch (err) {
    record("harness crashed", false, String(err).slice(0, 700));
}

console.log("\n=== SUMMARY ===");
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}\t${r.name}`);
fixture.kill();
chrome.kill();
ws.close();
process.exit(results.some((r) => !r.pass) ? 2 : 0);
