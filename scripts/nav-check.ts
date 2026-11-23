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

    // The Needs attention page is the inbox now: the exact path moves (301 GET,
    // 308 otherwise, query kept) and its old POST does not.
    const needsGet = await fetch(`${BASE}/needs-attention?x=1`, {
        redirect: "manual",
    });
    const needsPost = await fetch(`${BASE}/needs-attention`, {
        method: "POST",
        redirect: "manual",
    });
    // The redirect table does not look at the method, so a GET is as good as
    // the page's old POST for seeing that nothing under the exact path moves.
    const needsDismiss = await fetch(`${BASE}/needs-attention/dismiss`, {
        redirect: "manual",
    });
    const needsGetTo = new URL(needsGet.headers.get("location") ?? "", BASE);
    const needsPostTo = new URL(needsPost.headers.get("location") ?? "", BASE);
    record(
        "legacy /needs-attention (exact path): 301 to /notifications (query kept, POST 308); /needs-attention/dismiss is not redirected (404)",
        needsGet.status === 301 &&
            needsGetTo.pathname === "/notifications" &&
            needsGetTo.search === "?x=1" &&
            needsPost.status === 308 &&
            needsPostTo.pathname === "/notifications" &&
            needsDismiss.headers.get("location") === null &&
            needsDismiss.status === 404,
        {
            get: [needsGet.status, needsGetTo.pathname + needsGetTo.search],
            post: [needsPost.status, needsPostTo.pathname],
            dismiss: [
                needsDismiss.status,
                needsDismiss.headers.get("location"),
            ],
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
            marker: string | null;
            hasMain: boolean;
        }>(`(() => {
            return {
                dataTheme: document.documentElement.getAttribute("data-theme"),
                meta: document.querySelector('meta[name="foodable-theme"]')?.getAttribute("content") ?? null,
                bg: getComputedStyle(document.body).getPropertyValue("--bg").trim(),
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

    // ---- Sheets from parts on the dev gallery: placement, open and close,
    // Escape, focus back on the trigger. A sheet is a bottom sheet on the
    // phone, a dialog or a side panel from 1024px up.
    async function pressKey(
        key: string,
        code: string,
        vk: number,
        modifiers = 0,
    ) {
        await send("Input.dispatchKeyEvent", {
            type: "rawKeyDown",
            key,
            code,
            modifiers,
            windowsVirtualKeyCode: vk,
            nativeVirtualKeyCode: vk,
        });
        await send("Input.dispatchKeyEvent", {
            type: "keyUp",
            key,
            code,
            modifiers,
            windowsVirtualKeyCode: vk,
            nativeVirtualKeyCode: vk,
        });
        await sleep(120);
    }
    // A real pointer press, so the button takes focus the way it does for a
    // person (el.click() would leave focus on the body).
    async function mouseClick(sel: string) {
        const pt = await ev<{ x: number; y: number } | null>(`(() => {
            const el = document.querySelector(${JSON.stringify(sel)});
            if (!el) return null;
            el.scrollIntoView({ block: "center" });
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()`);
        if (!pt) throw new Error(`mouseClick: no element matches ${sel}`);
        for (const type of ["mousePressed", "mouseReleased"]) {
            await send("Input.dispatchMouseEvent", {
                type,
                x: pt.x,
                y: pt.y,
                button: "left",
                clickCount: 1,
            });
        }
    }
    // Wait for the open or close animation, which a loaded machine runs slowly.
    const settle = (id: string) =>
        ev(
            `Promise.all(document.getElementById(${JSON.stringify(id)}).getAnimations().map((a) => a.finished.catch(() => null)))`,
        );
    const sheetState = (id: string, trigger: string) =>
        ev<{
            open: boolean;
            left: number;
            right: number;
            top: number;
            bottom: number;
            vw: number;
            vh: number;
            width: number;
            triggerFocused: boolean;
            inside: boolean;
        }>(`(() => {
            const d = document.getElementById(${JSON.stringify(id)});
            const t = document.querySelector(${JSON.stringify(trigger)});
            const r = d.getBoundingClientRect();
            return {
                open: d.open,
                left: Math.round(r.left),
                right: Math.round(r.right),
                top: Math.round(r.top),
                bottom: Math.round(r.bottom),
                vw: window.innerWidth,
                vh: window.innerHeight,
                width: Math.round(r.width),
                triggerFocused: document.activeElement === t,
                inside: d.contains(document.activeElement),
            };
        })()`);
    async function sheetCase(
        name: string,
        width: number,
        id: string,
        form: "bottom" | "dialog" | "side",
        wide: number,
    ) {
        const trigger = `[commandfor="${id}"]`;
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width < 1024,
        });
        await goto("/dev/gallery-v2");
        await setMarker();
        await mouseClick(trigger);
        await sleep(100);
        await settle(id);
        const opened = await sheetState(id, trigger);
        // Where it sits: bottom = full width on the bottom edge; dialog =
        // centred at its width; side = its width on the right edge.
        const placed =
            opened.open &&
            (form === "bottom"
                ? opened.width === opened.vw && opened.bottom === opened.vh
                : form === "dialog"
                  ? opened.width === wide &&
                    opened.left === Math.round((opened.vw - wide) / 2)
                  : opened.width === wide &&
                    opened.right === opened.vw &&
                    opened.top === 0 &&
                    opened.bottom === opened.vh);
        await pressKey("Escape", "Escape", 27);
        const afterEsc = await sheetState(id, trigger);
        await mouseClick(trigger);
        await sleep(100);
        await settle(id);
        let trapped = true;
        if (form !== "bottom") {
            // Tab past the last control and Shift+Tab before the first: focus
            // stays inside the sheet, going round both ways.
            const count = await ev<number>(
                `document.getElementById(${JSON.stringify(id)}).querySelectorAll('a[href], button:not([disabled]), input:not([disabled])').length`,
            );
            for (let i = 0; i < count + 2; i++) {
                await pressKey("Tab", "Tab", 9);
                trapped &&= (await sheetState(id, trigger)).inside;
            }
            for (let i = 0; i < count + 2; i++) {
                await pressKey("Tab", "Tab", 9, 8);
                trapped &&= (await sheetState(id, trigger)).inside;
            }
        }
        // The search sheet has no close button (the design's search header is
        // the box alone): Escape is its way out.
        const closer = `#${id} [command="close"]`;
        if (
            await ev<boolean>(
                `!!document.querySelector(${JSON.stringify(closer)})`,
            )
        ) {
            await mouseClick(closer);
        } else {
            await pressKey("Escape", "Escape", 27);
        }
        await sleep(300);
        const afterClose = await sheetState(id, trigger);
        record(
            name,
            placed &&
                !afterEsc.open &&
                afterEsc.triggerFocused &&
                trapped &&
                !afterClose.open &&
                afterClose.triggerFocused,
            { opened, placed, afterEsc, trapped, afterClose, ex: drain() },
        );
    }
    await sheetCase(
        "v2 gallery sheet at 390px: bottom sheet, Escape and close, focus back",
        390,
        "dev-gallery-dialog-sheet",
        "bottom",
        0,
    );
    await sheetCase(
        "v2 gallery sheet at 1440px: dialog, Escape and close, focus kept and back",
        1440,
        "dev-gallery-dialog-sheet",
        "dialog",
        480,
    );
    await sheetCase(
        "v2 gallery search sheet at 1440px: wide dialog, Escape and close, focus kept and back",
        1440,
        "dev-gallery-search-sheet",
        "dialog",
        600,
    );
    await sheetCase(
        "v2 gallery sheet at 1440px: side panel, Escape and close, focus kept and back",
        1440,
        "dev-gallery-side-sheet",
        "side",
        480,
    );
    // ---- Menus on the dev gallery: open from the trigger, Escape and a tap
    // outside close it, confirm in place (Cancel + the verb), focus back on the
    // trigger, arrow keys between items.
    const menuState = (root: string) =>
        ev<{
            open: boolean;
            expanded: string | null;
            triggerFocused: boolean;
            inside: boolean;
            activeLabel: string;
            left: number;
            right: number;
            vw: number;
            armShown: boolean;
            confirmShown: boolean;
            confirmLabels: string[];
            checked: string[];
        }>(`(() => {
            const r = document.querySelector(${JSON.stringify(root)});
            const panel = r.querySelector(".fd-menu__panel");
            const trigger = r.querySelector("[data-fd-menu-trigger]");
            const shown = (el) => !!el && !el.hidden && !el.closest("[hidden]");
            const box = panel.getBoundingClientRect();
            const row = r.querySelector(".fd-menu__confirm-row");
            const active = document.activeElement;
            return {
                open: !panel.hidden,
                expanded: trigger.getAttribute("aria-expanded"),
                triggerFocused: active === trigger,
                inside: panel.contains(active),
                activeLabel: active && panel.contains(active) ? (active.textContent || "").trim() : "",
                left: Math.round(box.left),
                right: Math.round(box.right),
                vw: window.innerWidth,
                armShown: shown(r.querySelector("[data-fd-menu-arm]")),
                confirmShown: shown(row),
                confirmLabels: row ? Array.from(row.querySelectorAll(".fd-menu__item")).map((b) => (b.textContent || "").trim()) : [],
                checked: Array.from(r.querySelectorAll('[aria-checked="true"]')).map((b) => (b.textContent || "").trim()),
            };
        })()`);
    async function menuCase(name: string, width: number) {
        const root = '[data-gallery="menu-more"]';
        const trigger = `${root} [data-fd-menu-trigger]`;
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: width < 1024,
        });
        await goto("/dev/gallery-v2");
        await setMarker();
        // The menu is far down the page: scroll there at once (the page may
        // scroll smoothly), so the click lands where the trigger is.
        await ev(
            `document.querySelector(${JSON.stringify(trigger)}).scrollIntoView({ block: "center", behavior: "instant" })`,
        );
        await sleep(300);
        await mouseClick(trigger);
        await sleep(100);
        const opened = await menuState(root);
        await pressKey("Escape", "Escape", 27);
        const afterEsc = await menuState(root);
        await mouseClick(trigger);
        await sleep(100);
        await mouseClick(".fd-gallery-title");
        await sleep(100);
        const afterOutside = await menuState(root);
        // Confirm in place: arm, see Cancel + the verb, Cancel restores.
        await mouseClick(trigger);
        await sleep(100);
        await mouseClick(`${root} [data-fd-menu-arm]`);
        await sleep(100);
        const armed = await menuState(root);
        await mouseClick(`${root} [data-fd-menu-cancel]`);
        await sleep(100);
        const cancelled = await menuState(root);
        // An armed menu closed with Escape comes back unarmed.
        await mouseClick(`${root} [data-fd-menu-arm]`);
        await pressKey("Escape", "Escape", 27);
        await mouseClick(trigger);
        await sleep(100);
        const reopened = await menuState(root);
        await pressKey("Escape", "Escape", 27);
        const noPopup = await ev<boolean>(
            `!document.querySelector("dialog[open]")`,
        );
        record(
            name,
            opened.open &&
                opened.expanded === "true" &&
                opened.left >= 0 &&
                opened.right <= opened.vw &&
                !afterEsc.open &&
                afterEsc.expanded === "false" &&
                afterEsc.triggerFocused &&
                !afterOutside.open &&
                armed.open &&
                !armed.armShown &&
                armed.confirmShown &&
                armed.confirmLabels.join("|") === "Cancel|Discard 3" &&
                armed.activeLabel === "Cancel" &&
                cancelled.open &&
                cancelled.armShown &&
                !cancelled.confirmShown &&
                cancelled.activeLabel === "Discard" &&
                reopened.armShown &&
                !reopened.confirmShown &&
                noPopup,
            {
                opened,
                afterEsc,
                afterOutside,
                armed,
                cancelled,
                reopened,
                noPopup,
                ex: drain(),
            },
        );
    }
    await menuCase(
        "v2 gallery menu at 390px: open, Escape, tap outside, confirm in place",
        390,
    );
    await menuCase(
        "v2 gallery menu at 1440px: open, Escape, tap outside, confirm in place",
        1440,
    );

    {
        const root = '[data-gallery="menu-filter"]';
        const trigger = `${root} [data-fd-menu-trigger]`;
        await goto("/dev/gallery-v2");
        await setMarker();
        // Keyboard only: the trigger takes focus, ArrowDown opens and lands on
        // the first item, arrows and Home / End move, Escape closes and the
        // focus goes back to the trigger.
        await ev(`document.querySelector(${JSON.stringify(trigger)}).focus()`);
        await pressKey("ArrowDown", "ArrowDown", 40);
        const first = await menuState(root);
        await pressKey("ArrowDown", "ArrowDown", 40);
        const second = await menuState(root);
        await pressKey("ArrowUp", "ArrowUp", 38);
        await pressKey("ArrowUp", "ArrowUp", 38);
        const wrapped = await menuState(root);
        await pressKey("Home", "Home", 36);
        const home = await menuState(root);
        await pressKey("End", "End", 35);
        const end = await menuState(root);
        // A tick toggles and the menu stays open.
        await mouseClick(`${root} [role="menuitemcheckbox"]`);
        await sleep(100);
        const toggled = await menuState(root);
        await pressKey("Escape", "Escape", 27);
        const closed = await menuState(root);
        record(
            "v2 gallery filter menu: arrow keys, Home and End, ticks toggle, Escape returns focus",
            first.open &&
                first.activeLabel === "Cookable now" &&
                second.activeLabel === "High protein" &&
                wrapped.activeLabel === "Clear" &&
                home.activeLabel === "Cookable now" &&
                end.activeLabel === "Clear" &&
                toggled.open &&
                toggled.checked.join("|") === "High protein" &&
                !closed.open &&
                closed.triggerFocused,
            { first, second, wrapped, home, end, toggled, closed, ex: drain() },
        );
    }

    // ---- Menus in other settings: Enter opens and lands on the first item, a
    // trigger near the left edge keeps its panel on screen, Escape inside a
    // sheet closes only the menu, Tab closes it, one menu closes another, the
    // verb posts its fields, and a tick fires fd-menu-select.
    {
        await send("Emulation.setDeviceMetricsOverride", {
            width: 390,
            height: 900,
            deviceScaleFactor: 1,
            mobile: true,
        });
        const pressEnter = async () => {
            for (const type of ["keyDown", "keyUp"]) {
                await send("Input.dispatchKeyEvent", {
                    type,
                    key: "Enter",
                    code: "Enter",
                    text: type === "keyDown" ? "\r" : undefined,
                    windowsVirtualKeyCode: 13,
                    nativeVirtualKeyCode: 13,
                });
            }
            await sleep(120);
        };
        const trigger = (root: string) => `${root} [data-fd-menu-trigger]`;
        const focus = (sel: string) =>
            ev(`document.querySelector(${JSON.stringify(sel)}).focus()`);
        await goto("/dev/gallery-v2");
        await setMarker();

        const near = '[data-gallery="menu-near-left"]';
        await ev(
            `document.querySelector(${JSON.stringify(trigger(near))}).scrollIntoView({ block: "center", behavior: "instant" })`,
        );
        await sleep(300);
        // Put the trigger 190px from the left edge whatever the page padding
        // is: right-aligned the panel would start at -10, and starting at the
        // trigger it would end at 424, so neither side alone fits 390.
        await ev(`(() => {
            const t = document.querySelector(${JSON.stringify(trigger(near))});
            const box = t.closest("[data-gallery]").parentElement;
            const shift = 190 - t.getBoundingClientRect().left;
            box.style.paddingLeft = (parseFloat(getComputedStyle(box).paddingLeft) + shift) + "px";
        })()`);
        await focus(trigger(near));
        await pressEnter();
        const nearOpen = await menuState(near);
        await pressKey("Escape", "Escape", 27);
        record(
            "v2 gallery menu near the left edge at 390px: Enter opens on the first item, the panel stays on screen",
            nearOpen.open &&
                nearOpen.activeLabel === "Edit amount or expiry" &&
                // The emulated width, not innerWidth: a panel hanging off the
                // edge widens the layout viewport and would pass its own check.
                nearOpen.left >= 0 &&
                nearOpen.right <= 390,
            { nearOpen, ex: drain() },
        );

        // One menu closes another, without a pointer press in between.
        const more = '[data-gallery="menu-more"]';
        const filter = '[data-gallery="menu-filter"]';
        await mouseClick(trigger(more));
        await sleep(100);
        const moreOpen = await menuState(more);
        await focus(trigger(filter));
        await pressKey("ArrowDown", "ArrowDown", 40);
        const afterSwap = await menuState(more);
        const filterOpen = await menuState(filter);
        // A tick fires fd-menu-select with its new state, and the menu stays open.
        await ev(`(() => {
            window.__picked = [];
            document.addEventListener("fd-menu-select", (e) => {
                window.__picked.push({
                    label: (e.target.textContent || "").trim(),
                    checked: e.detail.checked,
                });
            });
        })()`);
        await mouseClick(`${filter} [role="menuitemcheckbox"]`);
        await mouseClick(`${filter} [role="menuitemcheckbox"]`);
        const picked =
            await ev<{ label: string; checked: boolean }[]>("window.__picked");
        await pressKey("Escape", "Escape", 27);
        record(
            "v2 gallery menus: opening one closes another, a tick fires fd-menu-select",
            moreOpen.open &&
                !afterSwap.open &&
                afterSwap.expanded === "false" &&
                filterOpen.open &&
                filterOpen.activeLabel === "Cookable now" &&
                JSON.stringify(picked) ===
                    JSON.stringify([
                        { label: "Cookable now", checked: false },
                        { label: "Cookable now", checked: true },
                    ]),
            { moreOpen, afterSwap, filterOpen, picked, ex: drain() },
        );

        // A menu inside a live sheet.
        const sheetId = "dev-gallery-menu-sheet";
        const inSheet = '[data-gallery="menu-in-sheet"]';
        const sheetOpen = () =>
            ev<boolean>(`document.getElementById("${sheetId}").open`);
        await mouseClick(`[commandfor="${sheetId}"]`);
        await sleep(100);
        await settle(sheetId);
        const sheetOpened = await sheetOpen();
        await mouseClick(trigger(inSheet));
        await sleep(100);
        const menuOpen = await menuState(inSheet);
        await pressKey("Escape", "Escape", 27);
        const afterFirst = await menuState(inSheet);
        const sheetAfterFirst = await sheetOpen();
        // Tab leaves the menu closed.
        await mouseClick(trigger(inSheet));
        await sleep(100);
        await pressKey("ArrowDown", "ArrowDown", 40);
        await pressKey("Tab", "Tab", 9);
        const afterTab = await menuState(inSheet);
        // The verb posts its fields (the submit is caught, not followed).
        await ev(`(() => {
            window.__posted = null;
            document.addEventListener(
                "submit",
                (e) => {
                    e.preventDefault();
                    window.__posted = {
                        action: e.target.getAttribute("action"),
                        fields: Array.from(new FormData(e.target)),
                    };
                },
                true,
            );
        })()`);
        await mouseClick(trigger(inSheet));
        await sleep(100);
        await mouseClick(`${inSheet} [data-fd-menu-arm]`);
        await sleep(100);
        await mouseClick(`${inSheet} .fd-menu__confirm-row form button`);
        await sleep(100);
        const posted = await ev<{
            action: string;
            fields: [string, string][];
        } | null>("window.__posted");
        // The caught submit left the menu open: Escape closes it and the sheet
        // stays; Escape again closes the sheet.
        const menuAfterPost = await menuState(inSheet);
        await pressKey("Escape", "Escape", 27);
        const stillOpen = await sheetOpen();
        await pressKey("Escape", "Escape", 27);
        await settle(sheetId);
        const sheetClosed = !(await sheetOpen());
        record(
            "v2 gallery menu in a sheet at 390px: Escape closes the menu then the sheet, Tab closes it, the verb posts its fields",
            sheetOpened &&
                menuOpen.open &&
                menuOpen.right <= 390 &&
                !afterFirst.open &&
                afterFirst.triggerFocused &&
                sheetAfterFirst &&
                !afterTab.open &&
                menuAfterPost.open &&
                posted?.action === "/dev/gallery-v2" &&
                JSON.stringify(posted.fields) ===
                    JSON.stringify([["ids", "a,b,c"]]) &&
                stillOpen &&
                sheetClosed,
            {
                sheetOpened,
                menuOpen,
                afterFirst,
                sheetAfterFirst,
                afterTab,
                posted,
                menuAfterPost,
                stillOpen,
                sheetClosed,
                ex: drain(),
            },
        );
    }

    // The bell and the Notifications inbox: the dot on phone and desktop,
    // opening the inbox clears it (over a Turbo visit, with no full reload),
    // and the ⋯ menu's actions.
    const bellState = () =>
        ev<{
            visible: number;
            unread: number;
            dotWidth: number;
            inCluster: boolean;
            inTopBar: boolean;
            leftOfLogFood: boolean;
            href: string | null;
            label: string | null;
        }>(`(() => {
            const shown = (el) => !!el && el.offsetParent !== null;
            const bells = [...document.querySelectorAll(".fd-bell")].filter(shown);
            const bell = bells[0];
            const dot = bell?.querySelector(".fd-bell__dot");
            const logFood = document.querySelector(".fd-logfood");
            return {
                visible: bells.length,
                unread: bells.filter((b) => b.classList.contains("fd-bell--unread")).length,
                dotWidth: dot ? Math.round(dot.getBoundingClientRect().width) : 0,
                inCluster: !!bell?.closest(".fd-cluster"),
                inTopBar: !!bell?.closest(".fd-topbar"),
                leftOfLogFood: !!bell && shown(logFood)
                    ? bell.getBoundingClientRect().right <= logFood.getBoundingClientRect().left
                    : false,
                href: bell?.getAttribute("href") ?? null,
                label: bell?.getAttribute("aria-label") ?? null,
            };
        })()`);

    // Everything the old notice surfaces drew: a dot or "has notices" on a tab
    // or sidebar link, a Needs attention card, a notice strip. The bell is the
    // one place a notification shows.
    const noticeSurfaces = () =>
        ev<number>(`document.querySelectorAll(
            '[class*="fd-tab-dot-"], [class*="fd-side-dot-"], [aria-label*="has notices"], .fd-notice-strip, [aria-label="Needs attention"], a[href="/needs-attention"]'
        ).length`);

    await control("session=app&theme=dark&reset=posts&post=ok&unread=1");
    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });
    await goto("/");
    const phoneNoticeSurfaces = await noticeSurfaces();
    const phoneBell = await bellState();
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/");
    const desktopNoticeSurfaces = await noticeSurfaces();
    const desktopBell = await bellState();
    record(
        "bell: a green dot on the phone (top-right cluster) and on the desktop (top bar, left of Log food), one bell each, linking to /notifications",
        phoneBell.visible === 1 &&
            phoneBell.unread === 1 &&
            phoneBell.dotWidth === 8 &&
            phoneBell.inCluster &&
            phoneBell.href === "/notifications" &&
            phoneBell.label === "Notifications, new" &&
            desktopBell.visible === 1 &&
            desktopBell.unread === 1 &&
            desktopBell.dotWidth === 8 &&
            desktopBell.inTopBar &&
            desktopBell.leftOfLogFood &&
            desktopBell.href === "/notifications",
        { phoneBell, desktopBell, ex: drain() },
    );
    record(
        "no notice dots: no tab or sidebar dot, no Needs attention card and no notice strip on Today, on the phone and the desktop, while the bell shows the dot",
        phoneNoticeSurfaces === 0 &&
            desktopNoticeSurfaces === 0 &&
            phoneBell.unread === 1 &&
            desktopBell.unread === 1,
        { phoneNoticeSurfaces, desktopNoticeSurfaces, ex: drain() },
    );

    // A pointer resting on the bell must not open the inbox for it: Turbo
    // prefetches a hovered link after 100 ms, and the inbox marks what it
    // shows as read, so the dot would be gone without a visit. (The page is
    // still the desktop one from above.)
    const bellPt = await ev<{ x: number; y: number }>(`(() => {
        const r = document.querySelector(".fd-topbar .fd-bell").getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    await send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: bellPt.x,
        y: bellPt.y,
    });
    await sleep(900);
    const afterHover = (await control("")) as { inboxUnread: boolean };
    const hoverBell = await bellState();
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
    record(
        "bell: hovering the bell does not prefetch the inbox, so the dot stays until it is opened",
        afterHover.inboxUnread === true && hoverBell.unread === 1,
        { afterHover, hoverBell, ex: drain() },
    );

    // Opening the inbox from the bell is a Turbo visit; the dot is gone on the
    // inbox and on the pages after it, on a visit and on a full load.
    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });
    await control("unread=1");
    await goto("/");
    await setMarker();
    await clickSel(".fd-cluster .fd-bell");
    await sleep(700);
    const inbox = await snap();
    // The inbox has no phone cluster, so its bell is the top bar's (hidden at
    // this width): none of the bells in the page carry the dot.
    const inboxBell = await ev<{ bells: number; dots: number }>(`({
        bells: document.querySelectorAll(".fd-bell").length,
        dots: document.querySelectorAll(".fd-bell--unread").length,
    })`);
    await clickSel('.fd-tabs a[href="/recipes"]');
    await sleep(700);
    const afterVisit = await snap();
    const afterBell = await bellState();
    await goto("/kitchen/fridge");
    const afterLoad = await bellState();
    const noNoticeDots = await ev<number>(
        `document.querySelectorAll(".fd-bell--unread").length`,
    );
    record(
        "bell: opening the inbox is a Turbo visit (no full reload) and clears the dot, on that page, the next visit and a fresh load",
        inbox.href.endsWith("/notifications") &&
            inbox.h1 === "Notifications" &&
            inbox.marker === "stay" &&
            inbox.active === null &&
            inboxBell.bells === 1 &&
            inboxBell.dots === 0 &&
            afterVisit.href.endsWith("/recipes") &&
            afterVisit.marker === "stay" &&
            afterBell.unread === 0 &&
            afterLoad.unread === 0 &&
            noNoticeDots === 0,
        {
            inbox,
            inboxBell,
            afterVisit,
            afterBell,
            afterLoad,
            noNoticeDots,
            ex: drain(),
        },
    );

    // The inbox has no phone cluster over its Detail bar; the desktop keeps
    // the bell in the top bar.
    const inboxChrome = async (width: number, mobile: boolean) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: 900,
            deviceScaleFactor: 1,
            mobile,
        });
        await goto("/notifications");
        return ev<{
            cluster: boolean;
            sections: string[];
            rows: number;
            filter: string[];
            bellVisible: number;
        }>(`(() => {
            const shown = (el) => !!el && el.offsetParent !== null;
            return {
                cluster: shown(document.querySelector(".fd-cluster")),
                sections: [...document.querySelectorAll(".fd-notifications .fd-section-header__label")].map((e) => e.textContent.trim()),
                rows: document.querySelectorAll(".fd-notifications .fd-item-row").length,
                filter: [...document.querySelectorAll(".fd-notifications__filter a")].map((a) => a.textContent.trim() + (a.getAttribute("aria-current") ? "*" : "")),
                bellVisible: [...document.querySelectorAll(".fd-bell")].filter(shown).length,
            };
        })()`);
    };
    const phoneInbox = await inboxChrome(430, true);
    const desktopInbox = await inboxChrome(1440, false);
    record(
        "inbox: Today and Snoozed sections, four rows, All / Just me / Household; no phone cluster, the top-bar bell on desktop",
        [phoneInbox, desktopInbox].every(
            (i) =>
                i.sections.join("|") === "Today|Snoozed" &&
                i.rows === 4 &&
                i.filter.join("|") === "All*|Just me|Household",
        ) &&
            !phoneInbox.cluster &&
            phoneInbox.bellVisible === 0 &&
            desktopInbox.bellVisible === 1,
        { phoneInbox, desktopInbox, ex: drain() },
    );

    // The ⋯ menu: an owner's household row offers Open, both Snoozes, Dismiss
    // for me / for everyone; an Allergens row offers only Open.
    // Choosing an action posts its form (the server answers 303 back here).
    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 900,
        deviceScaleFactor: 1,
        mobile: true,
    });
    await control("reset=posts");
    await goto("/notifications");
    await setMarker();
    const menuLabels = (row: string) =>
        ev<string[]>(
            `[...document.querySelectorAll(${JSON.stringify(`#notification-${row} .fd-menu__item`)})].map((e) => e.textContent.trim())`,
        );
    const yogurtItems = await menuLabels("n-yogurt");
    const weighItems = await menuLabels("n-weigh");
    const allergenItems = await menuLabels("n-allergen");
    const yogurtTrigger = "#notification-n-yogurt [data-fd-menu-trigger]";
    await mouseClick(yogurtTrigger);
    await sleep(150);
    const menuOpened = await ev<boolean>(
        `!document.querySelector("#notification-n-yogurt .fd-menu__panel").hidden`,
    );
    await mouseClick(
        '#notification-n-yogurt form[action$="/snooze"]:has(input[value="week"]) button',
    );
    await sleep(700);
    const afterSnooze = await snap();
    await mouseClick(yogurtTrigger);
    await sleep(150);
    await mouseClick(
        '#notification-n-yogurt form[action$="/dismiss"]:has(input[value="everyone"]) button',
    );
    await sleep(700);
    // Turn off the weigh-in kind from its row: the post carries the kind and
    // answers 303 back to the inbox.
    await mouseClick("#notification-n-weigh [data-fd-menu-trigger]");
    await sleep(150);
    await mouseClick(
        '#notification-n-weigh form[action="/settings/notifications"] button',
    );
    await sleep(700);
    const afterTurnOff = await snap();
    const menuPosts = (await stats()).posts.map((p) => [
        p.path,
        Object.fromEntries(p.entries),
    ]);
    record(
        "inbox ⋯ menu: owner and allergens menus, and Snooze 1 week, Dismiss for everyone and Turn off post their forms over Turbo",
        yogurtItems.join("|") ===
            "Open|Snooze until tomorrow|Snooze 1 week|Dismiss for me|Dismiss for everyone|Turn off “Food expiring”" &&
            weighItems.join("|") ===
                "Open|Snooze until tomorrow|Snooze 1 week|Dismiss|Turn off “Weigh-in due”" &&
            allergenItems.join("|") === "Open" &&
            menuOpened &&
            afterSnooze.marker === "stay" &&
            afterTurnOff.marker === "stay" &&
            afterTurnOff.h1 === "Notifications" &&
            JSON.stringify(menuPosts) ===
                JSON.stringify([
                    ["/notifications/n-yogurt/snooze", { until: "week" }],
                    ["/notifications/n-yogurt/dismiss", { scope: "everyone" }],
                    [
                        "/settings/notifications",
                        { kind: "weigh_in_due", enabled: "false" },
                    ],
                ]),
        {
            yogurtItems,
            weighItems,
            allergenItems,
            menuOpened,
            afterSnooze,
            afterTurnOff,
            menuPosts,
            ex: drain(),
        },
    );

    // Settings › Notifications: a toggle saves itself over Turbo, with no
    // toast, and two clicks in a row (the first still in flight) both go.
    await control("reset=posts&delay=250");
    await goto("/settings/notifications");
    await setMarker();
    const notifBefore = await ev<{
        rows: string[];
        sections: string[];
        allergens: boolean;
        checked: Record<string, string | null>;
    }>(`({
        rows: [...document.querySelectorAll(".fd-notification-settings .fd-item-row__title")].map((e) => e.textContent.trim()),
        sections: [...document.querySelectorAll(".fd-notification-settings .fd-section-header__label")].map((e) => e.textContent.trim()),
        allergens: !!document.querySelector("#notification-kind-allergens"),
        checked: Object.fromEntries([...document.querySelectorAll(".fd-notification-settings [role=switch]")].map((e) => [e.closest("li").id, e.getAttribute("aria-checked")])),
    })`);
    await clickSel("#notification-kind-running_low [role=switch]");
    await sleep(40);
    await clickSel("#notification-kind-recipe_changes [role=switch]");
    await sleep(1200);
    const notifAfter = await snap();
    const notifState = await ev<{
        toast: boolean;
        done: boolean;
    }>(`({
        toast: !!document.querySelector("[data-fd-toast], .fd-toast"),
        done: !!document.querySelector("#done"),
    })`);
    const notifPosts = (await stats()).posts.map((p) => [
        p.path,
        Object.fromEntries(p.entries),
    ]);
    await control("delay=0");
    record(
        "Settings › Notifications: base then extras, no Allergens row, and two quick toggles each save over Turbo with no toast",
        notifBefore.sections.join("|") ===
            "Base · on unless you turn them off|Extras · off unless you turn them on" &&
            notifBefore.rows.join("|") ===
                "Food expiring|Running low|Weigh-in due|Recipe changes by others|Week plan changes|New usual products" &&
            !notifBefore.allergens &&
            notifBefore.checked["notification-kind-running_low"] === "true" &&
            notifBefore.checked["notification-kind-recipe_changes"] ===
                "false" &&
            notifAfter.marker === "stay" &&
            notifAfter.href.endsWith("/settings/notifications") &&
            !notifState.toast &&
            JSON.stringify(notifPosts) ===
                JSON.stringify([
                    [
                        "/settings/notifications",
                        {
                            kind: "running_low",
                            enabled: "false",
                            return: "/settings/notifications",
                        },
                    ],
                    [
                        "/settings/notifications",
                        {
                            kind: "recipe_changes",
                            enabled: "true",
                            return: "/settings/notifications",
                        },
                    ],
                ]),
        {
            notifBefore,
            notifAfter,
            notifState,
            notifPosts,
            ex: drain(),
        },
    );

    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });

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
