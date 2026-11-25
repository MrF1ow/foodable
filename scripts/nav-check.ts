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
            navW: number;
            navH: number;
            navGap: number;
            navCentre: number;
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
                topbar: disp(".fd-top-bar"),
                active: q(".fd-tabs a[aria-current='page']")?.getAttribute("aria-label") ?? null,
                side: q(".fd-sidebar__nav a.fd-side-link[aria-current] .fd-side-link__label")?.textContent ?? null,
                h1: q("h1")?.textContent?.trim() ?? null,
                marker: window.__marker ?? null,
                themeColor: q("meta[name='theme-color']")?.getAttribute("content") ?? null,
                navW: Math.round(r.width),
                navH: Math.round(r.height),
                navGap: Math.round(innerHeight - r.bottom),
                navCentre: Math.round(r.left + r.width / 2 - document.documentElement.clientWidth / 2),
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
        `[...document.querySelectorAll("nav.fd-tabs, nav.fd-sidebar__nav")].filter((n) => getComputedStyle(n).display !== "none").length`,
    );
    await clickSel('.fd-sidebar__nav a[href="/kitchen/fridge"]');
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

    await control("reset=posts");
    await goto("/");
    await setMarker();
    const todayDesk = await ev<{
        layout: string;
        direction: string;
        columns: number;
        leftRight: number;
        rightLeft: number;
        topGap: number;
        rail: boolean;
        left: string;
        right: string;
    }>(`(() => {
        const page = document.querySelector(".fd-today-page.fd-page-layout--two-columns");
        const cols = page ? [...page.querySelectorAll(".fd-page-layout__column")] : [];
        const box = (el) => el.getBoundingClientRect();
        return {
            layout: page ? getComputedStyle(page).display : "missing",
            direction: page ? getComputedStyle(page.querySelector(".fd-page-layout__columns")).flexDirection : "missing",
            columns: cols.length,
            leftRight: cols[0] ? Math.round(box(cols[0]).right) : -1,
            rightLeft: cols[1] ? Math.round(box(cols[1]).left) : -1,
            topGap: cols.length === 2 ? Math.abs(Math.round(box(cols[0].querySelector("h1")).top - box(cols[1].querySelector(".fd-section-header")).top)) : -1,
            rail: !!document.querySelector(".fd-today-rail, .fd-today-card"),
            left: cols[0] ? [...cols[0].querySelectorAll("h1, .fd-week-strip, .fd-calorie-gauge, .fd-macro-bar, .fd-nutrient-line")].map((e) => e.className.split(" ")[0] || e.tagName).join("|") : "",
            right: cols[1] ? [...cols[1].querySelectorAll(".fd-section-header__label")].map((e) => e.textContent).join("|") : "",
        };
    })()`);
    record(
        "v2 today at 1440px: Two columns, the title, week strip, gauge, macros and nutrient line on the left and the meals and This week on the right, side by side, with no rail",
        todayDesk.layout === "flex" &&
            todayDesk.direction === "row" &&
            todayDesk.columns === 2 &&
            todayDesk.leftRight <= todayDesk.rightLeft &&
            todayDesk.rightLeft > 600 &&
            todayDesk.topGap <= 30 &&
            !todayDesk.rail &&
            todayDesk.left ===
                "fd-page-header__title|fd-week-strip|fd-calorie-gauge|fd-macro-bar|fd-macro-bar|fd-macro-bar|fd-nutrient-line" &&
            todayDesk.right === "Breakfast|Lunch|Dinner|Snacks|This week",
        { todayDesk, ex: drain() },
    );

    // A meal's ⋯ on the desktop: Again, Edit and Delete; Edit opens the edit
    // sheet beside the page, Again posts, Delete asks in place and then posts.
    const mealRow = 'li[data-fd-meal-id="m1"]';
    await clickSel(`${mealRow} [data-fd-menu-trigger]`);
    await sleep(150);
    const mealMenu = await ev<{
        items: string[];
        open: boolean;
        sheet: boolean;
    }>(`({
        items: [...document.querySelectorAll('li[data-fd-meal-id="m1"] .fd-menu__panel .fd-menu__label')].map((e) => e.textContent),
        open: document.querySelector('li[data-fd-meal-id="m1"] .fd-menu__panel')?.hidden === false,
        sheet: !!document.querySelector("dialog[open]"),
    })`);
    await clickSel(`${mealRow} [commandfor="fd-edit-meal-m1"]`);
    await sleep(300);
    const mealEdit = await ev<{
        open: boolean;
        side: boolean;
        title: string | null;
    }>(`(() => {
        const d = document.getElementById("fd-edit-meal-m1");
        return {
            open: !!d?.open,
            side: d?.classList.contains("fd-sheet--side") ?? false,
            title: d?.querySelector(".fd-sheet__title")?.textContent ?? null,
        };
    })()`);
    await send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
    });
    await send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "Escape",
        code: "Escape",
        windowsVirtualKeyCode: 27,
    });
    await sleep(250);
    await control("reset=posts");
    await clickSel(`${mealRow} [data-fd-menu-trigger]`);
    await sleep(150);
    await clickSel(
        `${mealRow} .fd-menu__panel form[action="/meals/m1/again"] button`,
    );
    await sleep(500);
    const againPosts = (await stats()).posts.filter(
        (p) => p.path === "/meals/m1/again",
    );
    await clickSel(`${mealRow} [data-fd-menu-trigger]`);
    await sleep(150);
    await clickSel(`${mealRow} [data-fd-menu-arm]`);
    await sleep(150);
    const confirming = await ev<string[]>(
        `[...document.querySelectorAll('li[data-fd-meal-id="m1"] .fd-menu__confirm-row:not([hidden]) .fd-menu__label')].map((e) => e.textContent)`,
    );
    const deleteBefore = (await stats()).posts.filter(
        (p) => p.path === "/meals/m1/delete",
    ).length;
    await clickSel(
        `${mealRow} .fd-menu__confirm-row form[action="/meals/m1/delete"] button`,
    );
    await sleep(500);
    const mealDeletePosts = (await stats()).posts.filter(
        (p) => p.path === "/meals/m1/delete",
    );
    const afterMenu = await ev<{ marker: string | null }>(
        `({ marker: window.__marker ?? null })`,
    );
    record(
        "v2 today at 1440px: a meal row's ⋯ is Again, Edit and Delete; Edit opens the side sheet, Again posts, and Delete asks in place (Cancel and Delete) before it posts, all over Turbo",
        mealMenu.items.slice(0, 3).join("|") === "Again|Edit|Delete" &&
            mealMenu.open &&
            !mealMenu.sheet &&
            mealEdit.open &&
            mealEdit.side &&
            mealEdit.title === "Scrambled eggs" &&
            againPosts.length === 1 &&
            confirming.join("|") === "Cancel|Delete" &&
            deleteBefore === 0 &&
            mealDeletePosts.length === 1 &&
            afterMenu.marker === "stay",
        {
            mealMenu,
            mealEdit,
            againPosts,
            confirming,
            mealDeletePosts,
            afterMenu,
            ex: drain(),
        },
    );

    // An open ⋯ menu stands above everything after its row: every item it
    // shows is the topmost thing at its own centre (a later row, its swipe
    // face or a section painting over it would be hit instead), and its
    // Delete asks again in place with the same guarantee.
    const menuEsc = async () => {
        for (const type of ["keyDown", "keyUp"]) {
            await send("Input.dispatchKeyEvent", {
                type,
                key: "Escape",
                code: "Escape",
                windowsVirtualKeyCode: 27,
            });
        }
        await sleep(250);
    };
    const menuOnTop = async (rowSel: string) => {
        const trigger = `${rowSel} [data-fd-menu-trigger]`;
        await ev(
            `document.querySelector(${JSON.stringify(trigger)}).scrollIntoView({ block: "center" })`,
        );
        await sleep(120);
        await clickSel(trigger);
        await sleep(250);
        const probe = () =>
            ev<{
                open: boolean;
                items: {
                    label: string;
                    hit: string;
                    top: boolean;
                    inView: boolean;
                }[];
            }>(`(() => {
                const row = document.querySelector(${JSON.stringify(rowSel)});
                const panel = row.querySelector(".fd-menu__panel");
                const items = [...panel.querySelectorAll(".fd-menu__item")].filter((i) => i.getClientRects().length > 0);
                return {
                    open: !panel.hidden,
                    items: items.map((i) => {
                        const r = i.getBoundingClientRect();
                        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        return {
                            label: i.textContent.trim(),
                            hit: hit ? hit.tagName + "." + String(hit.className).slice(0, 60) : "none",
                            top: !!hit && i.contains(hit),
                            inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
                        };
                    }),
                };
            })()`);
        const menu = await probe();
        await clickSel(`${rowSel} [data-fd-menu-arm]`);
        await sleep(200);
        const confirm = await probe();
        await menuEsc();
        await sleep(150);
        const ok = (p: typeof menu) =>
            p.open &&
            p.items.length >= 2 &&
            p.items.every((i) => i.top && i.inView);
        return { menu, confirm, ok: ok(menu) && ok(confirm) };
    };

    const deskMenu = await menuOnTop(
        `li[data-fd-meal-id="${await ev<string>(`[...document.querySelectorAll("li[data-fd-meal-id]")].find((li) => li.nextElementSibling)?.dataset.fdMealId ?? "m1"`)}"]`,
    );
    record(
        "v2 today at 1440px: a meal row's open ⋯ menu and its Delete confirm sit above the rows after them (each item is the topmost thing at its centre)",
        deskMenu.ok,
        { deskMenu, ex: drain() },
    );

    // The plan entries under This week: a one-off's ⋯ has Remove alone; a day
    // of a repeat has This day and The whole series for that one repeat.
    const planItems = await ev<{
        oneOff: string[];
        repeat: string[];
        rows: number;
    }>(`(() => {
        const labels = (row) => [...row.querySelectorAll(".fd-menu__panel > .fd-menu__item .fd-menu__label, .fd-menu__panel > .fd-menu__confirm > .fd-menu__item .fd-menu__label")].map((e) => e.textContent);
        const rows = [...document.querySelectorAll(".fd-plan-week [data-fd-sheet-row]")];
        const repeat = rows.find((r) => /The whole series/.test(r.textContent));
        const oneOff = rows.find((r) => !/The whole series/.test(r.textContent));
        return { oneOff: oneOff ? labels(oneOff) : [], repeat: repeat ? labels(repeat) : [], rows: rows.length };
    })()`);
    record(
        "v2 today: each plan entry under This week is one row with a ⋯; a one-off offers Remove, and a day of a repeat offers This day and The whole series",
        planItems.rows >= 2 &&
            planItems.oneOff.join("|") === "Edit|Remove" &&
            planItems.repeat.join("|") === "Edit|This day|The whole series",
        { planItems, ex: drain() },
    );

    // The meal's edit sheet: Time is the meal's own time and a Pick a time
    // chip, which shows the time field; the meal's chip puts the field away.
    const pressEsc = async () => {
        for (const type of ["keyDown", "keyUp"]) {
            await send("Input.dispatchKeyEvent", {
                type,
                key: "Escape",
                code: "Escape",
                windowsVirtualKeyCode: 27,
            });
        }
        await sleep(250);
    };
    await clickSel(`${mealRow} [data-fd-menu-trigger]`);
    await sleep(150);
    await clickSel(`${mealRow} [commandfor="fd-edit-meal-m1"]`);
    await sleep(300);
    const timeState = () =>
        ev<{
            chips: string[];
            fieldShown: boolean;
            value: string | null;
        }>(`(() => {
            const sheet = document.getElementById("fd-edit-meal-m1");
            const field = sheet?.querySelector('input[name="logged_time"]');
            return {
                chips: [...(sheet?.querySelectorAll("[data-fd-edit-time] .fd-chip__label") ?? [])].map((e) => e.textContent),
                fieldShown: !!field && field.getClientRects().length > 0,
                value: field?.value ?? null,
            };
        })()`);
    const timeBefore = await timeState();
    await clickSel(
        '#fd-edit-meal-m1 [data-fd-edit-time] .fd-chip--choice:has(input[value="pick"])',
    );
    await sleep(150);
    const timePicking = await timeState();
    await ev(`(() => {
        const f = document.querySelector('#fd-edit-meal-m1 input[name="logged_time"]');
        f.value = "23:15";
        f.dispatchEvent(new Event("input", { bubbles: true }));
        return f.value;
    })()`);
    await clickSel(
        '#fd-edit-meal-m1 [data-fd-edit-time] .fd-chip--choice:has(input[value="keep"])',
    );
    await sleep(150);
    const timeKept = await timeState();
    await pressEsc();
    record(
        "v2 today: the edit sheet's Time is the meal's time and a Pick a time chip; Pick a time shows the time field, the meal's own chip hides it and puts its time back",
        timeBefore.chips.length === 2 &&
            /^\d{1,2}:\d\d (AM|PM)$/.test(timeBefore.chips[0] ?? "") &&
            timeBefore.chips[1] === "Pick a time" &&
            !timeBefore.fieldShown &&
            timePicking.fieldShown &&
            !timeKept.fieldShown &&
            timeKept.value === timeBefore.value,
        { timeBefore, timePicking, timeKept, ex: drain() },
    );

    // A plan entry's edit sheet: titled with the day, the meal under it, Day
    // and Meal as rows with pull-downs (the row's value follows the choice).
    await clickSel(".fd-plan-week [data-fd-sheet-row] [data-fd-menu-trigger]");
    await sleep(150);
    await clickSel(
        '.fd-plan-week [data-fd-sheet-row] [commandfor^="fd-plan-edit-"]',
    );
    await sleep(300);
    const planSheet = await ev<{
        open: boolean;
        side: boolean;
        title: string | null;
        subtitle: string | null;
        rows: string[];
        dayChoices: number;
        valueAfter: string | null;
    }>(`(() => {
        const d = document.querySelector("dialog[id^='fd-plan-edit-'][open]");
        const rows = [...(d?.querySelectorAll(".fd-plan-edit-row") ?? [])];
        const select = rows[0]?.querySelector("select");
        if (select) {
            select.selectedIndex = select.options.length - 1;
            select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return {
            open: !!d,
            side: d?.classList.contains("fd-sheet--side") ?? false,
            title: d?.querySelector(".fd-sheet__title")?.textContent ?? null,
            subtitle: d?.querySelector(".fd-sheet__subtitle")?.textContent ?? null,
            rows: rows.map((r) => r.querySelector(".fd-item-row__title")?.textContent ?? ""),
            dayChoices: select?.options.length ?? 0,
            valueAfter: rows[0]?.querySelector(".fd-item-row__value")?.textContent ?? null,
        };
    })()`);
    await pressEsc();
    record(
        "v2 today: a plan entry's edit sheet is a side sheet titled with the day and the meal, with Day and Meal as rows with pull-downs whose value follows the choice",
        planSheet.open &&
            planSheet.side &&
            /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(
                planSheet.title ?? "",
            ) &&
            ["Breakfast", "Lunch", "Dinner", "Snacks"].includes(
                planSheet.subtitle ?? "",
            ) &&
            planSheet.rows.join("|") === "Day|Meal" &&
            planSheet.dayChoices >= 14 &&
            planSheet.valueAfter != null &&
            planSheet.valueAfter !== planSheet.title,
        { planSheet, ex: drain() },
    );

    // A plan edit saved over Turbo morphs the week: the rows are reused under
    // each other's sheets, and a tap on a row still opens exactly its sheet.
    await goto("/");
    await setMarker();
    const planRowSel = ".fd-plan-week [data-fd-sheet-row]";
    const sheetIdsBefore = await ev<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(planRowSel)})].map((r) => r.dataset.sheetId)`,
    );
    await clickSel(`${planRowSel} [data-fd-menu-trigger]`);
    await sleep(150);
    await clickSel(`${planRowSel} [commandfor^="fd-plan-edit-"]`);
    await sleep(300);
    await ev(
        `[...document.querySelectorAll("dialog[open] button")].find((b) => b.textContent.trim() === "Save").click()`,
    );
    await sleep(700);
    const tapRow = async (index: number) => {
        await ev(
            `document.querySelectorAll(${JSON.stringify(planRowSel)})[${index}].querySelector(".fd-item-row__title").click()`,
        );
        await sleep(300);
        const state = await ev<{ open: string[]; want: string }>(`({
            open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
            want: document.querySelectorAll(${JSON.stringify(planRowSel)})[${index}].dataset.sheetId,
        })`);
        await menuEsc();
        await sleep(100);
        return state;
    };
    const sheetIdsAfter = await ev<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(planRowSel)})].map((r) => r.dataset.sheetId)`,
    );
    const morphDone = await ev<{ done: boolean; marker: string | null }>(
        `({ done: !!document.getElementById("done"), marker: window.__marker ?? null })`,
    );
    const tapSecond = await tapRow(1);
    const tapFirst = await tapRow(0);
    record(
        "v2 today: after a plan edit is saved and the week morphs, a tap on a plan row opens exactly one sheet, the row's own",
        morphDone.done &&
            morphDone.marker === "stay" &&
            sheetIdsBefore.length === 2 &&
            sheetIdsAfter.join("|") !== sheetIdsBefore.join("|") &&
            tapSecond.open.join("|") === tapSecond.want &&
            tapFirst.open.join("|") === tapFirst.want,
        {
            sheetIdsBefore,
            sheetIdsAfter,
            morphDone,
            tapSecond,
            tapFirst,
            ex: drain(),
        },
    );
    await goto("/");
    await setMarker();

    // The phone: a swipe right on a meal row posts Again, a swipe left posts
    // Delete, and a tap opens the edit sheet.
    await send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
    });
    await send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
    });
    await goto("/");
    await setMarker();
    await control("reset=posts");
    const coarse = await ev<boolean>(`matchMedia("(pointer: coarse)").matches`);
    const swipeRow = async (id: string, fromFrac: number, toFrac: number) => {
        const box = await ev<{ x: number; y: number; w: number }>(`(() => {
            const r = document.querySelector('li[data-fd-meal-id="${id}"] .fd-item-row__face').getBoundingClientRect();
            return { x: r.left, y: r.top + r.height / 2, w: r.width };
        })()`);
        const x0 = box.x + box.w * fromFrac;
        const x1 = box.x + box.w * toFrac;
        await send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: x0, y: box.y }],
        });
        for (let i = 1; i <= 8; i++) {
            await send("Input.dispatchTouchEvent", {
                type: "touchMove",
                touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y: box.y }],
            });
            await sleep(16);
        }
        await send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
        });
        await sleep(500);
    };
    await swipeRow("m2", 0.15, 0.85);
    await swipeRow("m3", 0.85, 0.15);
    const swipePosts = (await stats()).posts.map((p) => p.path);
    const beds = await ev<{ again: boolean; del: boolean; swipe: boolean }>(`({
        again: !!document.querySelector('li[data-fd-meal-id="m2"] .fd-item-row__bed--again form[action="/meals/m2/again"]'),
        del: !!document.querySelector('li[data-fd-meal-id="m3"] .fd-item-row__bed--delete form[action="/meals/m3/delete"]'),
        swipe: document.querySelectorAll("li[data-fd-meal-id].fd-item-row--swipe").length >= 3,
    })`);
    await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
            {
                x: 120,
                y: await ev<number>(
                    `(() => { const r = document.querySelector('li[data-fd-meal-id="m1"] .fd-item-row__face').getBoundingClientRect(); return r.top + r.height / 2; })()`,
                ),
            },
        ],
    });
    await send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
    });
    // The swipes' posts may still be morphing the page: wait for the sheet.
    let tapped: string[] = [];
    for (let i = 0; i < 20 && tapped.length === 0; i++) {
        await sleep(100);
        tapped = await ev<string[]>(
            `[...document.querySelectorAll("dialog[open]")].map((d) => d.id)`,
        );
    }
    const afterSwipe = await ev<{ marker: string | null }>(
        `({ marker: window.__marker ?? null })`,
    );
    record(
        "v2 today on the phone: swiping a meal row right posts Again and left posts Delete, over Turbo, and a tap opens its edit sheet",
        coarse &&
            beds.again &&
            beds.del &&
            beds.swipe &&
            swipePosts.includes("/meals/m2/again") &&
            swipePosts.includes("/meals/m3/delete") &&
            swipePosts.length === 2 &&
            tapped.join("|") === "fd-edit-meal-m1" &&
            afterSwipe.marker === "stay",
        { coarse, beds, swipePosts, tapped, afterSwipe, ex: drain() },
    );
    await menuEsc();
    const phoneMenu = await menuOnTop(
        `li[data-fd-meal-id="${await ev<string>(`[...document.querySelectorAll("li[data-fd-meal-id]")].find((li) => li.nextElementSibling)?.dataset.fdMealId ?? "m1"`)}"]`,
    );
    record(
        "v2 today on the phone: a meal row's open ⋯ menu is not clipped by the swipe row, and it and its Delete confirm sit above the rows after it",
        phoneMenu.ok,
        { phoneMenu, ex: drain() },
    );
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/");
    await setMarker();

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

    // The top bar is the Top bar component: the search field (⌘K hinted) and
    // Log food open the search sheet, there is no scan button, and the current
    // sidebar link is told by type alone (no fill).
    const topBarShape = await ev<{
        scan: number;
        hint: string | null;
        searchData: string | null;
        logFood: string | null;
        currentFill: string | null;
        currentWeight: string | null;
        sidebarDots: number;
        hintBox: { w: number; h: number; gapRight: number } | null;
    }>(`(() => {
        const top = document.querySelector(".fd-top-bar");
        const cur = document.querySelector(".fd-sidebar__nav a.fd-side-link[aria-current]");
        return {
            scan: top.querySelectorAll('[aria-label*="can"], .fd-icon--scan').length,
            hint: top.querySelector(".fd-search-field__shortcut")?.textContent ?? null,
            searchData: top.querySelector(".fd-search-field")?.getAttribute("data-fd-open-sheet") ?? null,
            logFood: top.querySelector("a[data-fd-open-sheet]")?.textContent?.trim() ?? null,
            currentFill: cur ? getComputedStyle(cur).backgroundColor : null,
            currentWeight: cur ? getComputedStyle(cur).fontWeight : null,
            sidebarDots: document.querySelectorAll(".fd-sidebar [class*='dot']").length,
            hintBox: (() => {
                const chip = top.querySelector(".fd-search-field__shortcut");
                const field = top.querySelector(".fd-search-field");
                if (!chip || !field) return null;
                const c = chip.getBoundingClientRect();
                const f = field.getBoundingClientRect();
                return { w: c.width, h: c.height, gapRight: f.right - c.right };
            })(),
        };
    })()`);
    await clickSel(".fd-top-bar .fd-search-field__input");
    await sleep(400);
    const topBarSearchOpen = await ev<string[]>(
        `[...document.querySelectorAll("dialog[open]")].map((d) => d.id)`,
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
    await sleep(300);
    await clickSel(".fd-top-bar a[data-fd-open-sheet]");
    await sleep(400);
    const topBarLogOpen = await ev<string[]>(
        `[...document.querySelectorAll("dialog[open]")].map((d) => d.id)`,
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
    await sleep(300);
    record(
        "v2 top bar: search field and Log food open the search sheet, ⌘K hint, no scan; sidebar current link has no fill and no dot",
        topBarShape.scan === 0 &&
            topBarShape.hint === "⌘K" &&
            // The design's Shortcut (593979 › 594028): 35 × 18, 13 px in from the field's right edge.
            topBarShape.hintBox?.w === 35 &&
            topBarShape.hintBox.h === 18 &&
            topBarShape.hintBox.gapRight === 13 &&
            topBarShape.searchData === "fd-log-search" &&
            topBarShape.logFood === "Log food" &&
            topBarShape.currentFill === "rgba(0, 0, 0, 0)" &&
            Number(topBarShape.currentWeight) >= 500 &&
            topBarShape.sidebarDots === 0 &&
            topBarSearchOpen.includes("fd-log-search") &&
            topBarLogOpen.includes("fd-log-search"),
        { topBarShape, topBarSearchOpen, topBarLogOpen, ex: drain() },
    );

    // The search field is a trigger an input stands in for: Enter, ArrowDown
    // and ⌘K/Ctrl+K open the sheet from it, it carries the shortcut, and
    // Escape returns focus to the input (not to its wrapper or the body).
    const tap = async (
        key: string,
        code: string,
        vk: number,
        modifiers = 0,
    ) => {
        for (const type of ["rawKeyDown", "keyUp"]) {
            await send("Input.dispatchKeyEvent", {
                type,
                key,
                code,
                modifiers,
                windowsVirtualKeyCode: vk,
                nativeVirtualKeyCode: vk,
            });
        }
        await sleep(350);
    };
    const FIELD = ".fd-top-bar .fd-search-field__input";
    const fieldState = () =>
        ev<{ open: string[]; onField: boolean }>(`({
            open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
            onField: document.activeElement === document.querySelector(${JSON.stringify(FIELD)}),
        })`);
    const focusField = () =>
        ev(`document.querySelector(${JSON.stringify(FIELD)}).focus()`);
    await goto("/");
    const fieldKeys = await ev<string | null>(
        `document.querySelector(${JSON.stringify(FIELD)})?.getAttribute("aria-keyshortcuts") ?? null`,
    );
    await focusField();
    await tap("Enter", "Enter", 13);
    const afterEnter = await fieldState();
    await tap("Escape", "Escape", 27);
    const escapeAfterEnter = await fieldState();
    await tap("ArrowDown", "ArrowDown", 40);
    const afterArrowDown = await fieldState();
    await tap("Escape", "Escape", 27);
    await focusField();
    await tap("k", "KeyK", 75, modK);
    const afterCtrlKOnField = await fieldState();
    await tap("Escape", "Escape", 27);
    await ev(`document.activeElement?.blur()`);
    await tap("k", "KeyK", 75, modK);
    const afterCtrlKOnBody = await fieldState();
    await tap("Escape", "Escape", 27);
    const escapeAfterCtrlK = await fieldState();
    record(
        "v2 top bar search field: Enter, ArrowDown and ⌘K open the sheet, it names the shortcut, Escape returns focus to the input",
        fieldKeys === "Control+K Meta+K" &&
            afterEnter.open.includes("fd-log-search") &&
            escapeAfterEnter.open.length === 0 &&
            escapeAfterEnter.onField &&
            afterArrowDown.open.includes("fd-log-search") &&
            afterCtrlKOnField.open.includes("fd-log-search") &&
            afterCtrlKOnBody.open.includes("fd-log-search") &&
            escapeAfterCtrlK.open.length === 0 &&
            escapeAfterCtrlK.onField,
        {
            fieldKeys,
            afterEnter,
            escapeAfterEnter,
            afterArrowDown,
            afterCtrlKOnField,
            afterCtrlKOnBody,
            escapeAfterCtrlK,
            ex: drain(),
        },
    );

    // A Kitchen section link keeps the Kitchen group marked the moment it is
    // clicked, before the visit renders (no flash of nothing current).
    await goto("/kitchen/fridge");
    const kitchenMark = () =>
        ev<
            string[]
        >(`[...document.querySelectorAll(".fd-sidebar__nav a")].map((a) =>
            a.querySelector(".fd-side-link__label")?.textContent + "|" + (a.getAttribute("aria-current") ?? "-") + "|" + (a.classList.contains("fd-side-link--current") ? "cur" : "")
        ).filter((row) => /^(Kitchen|Fridge|Groceries|Usuals)\\b/.test(row))`);
    const kitchenBefore = await kitchenMark();
    // Stop the visit after the shell's own listener has run.
    await ev(
        `window.addEventListener("click", (e) => e.preventDefault(), { once: true })`,
    );
    await clickSel(".fd-sidebar__nav a.fd-side-link--sub[href*='groceries']");
    const kitchenAfter = await kitchenMark();
    const groupRow = (rows: string[]) =>
        rows.find((r) => r.startsWith("Kitchen|"));
    record(
        "v2 sidebar: clicking a Kitchen section keeps the Kitchen group current",
        groupRow(kitchenBefore) === "Kitchen|true|cur" &&
            groupRow(kitchenAfter) === "Kitchen|true|cur" &&
            kitchenAfter.some((r) => /^Groceries[^|]*\|page\|cur/.test(r)) &&
            !kitchenAfter.some((r) => r.startsWith("Fridge|page")),
        { kitchenBefore, kitchenAfter, ex: drain() },
    );

    await goto("/recipes");
    await setMarker();
    await clickSel("a.fd-sidebar__household");
    await sleep(500);
    const sidebarHousehold = await ev<{ path: string; side: string | null }>(`({
        path: location.pathname,
        side: document.querySelector(".fd-sidebar__nav a.fd-side-link[aria-current] .fd-side-link__label")?.textContent ?? null,
    })`);
    record(
        "v2 sidebar Household block opens the members page",
        sidebarHousehold.path === "/settings/household" &&
            sidebarHousehold.side === "Settings",
        { sidebarHousehold, ex: drain() },
    );
    await clickSel('.fd-sidebar__nav a[href="/settings"]');
    await sleep(400);
    const v2SidebarSettings = await v2Snap();
    record(
        "v2 sidebar Settings is a Turbo visit (no full load)",
        v2SidebarSettings.marker === "stay" &&
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
        "v2 account chip opens Settings over Turbo (no full load)",
        chipNav.marker === "stay" && chipNav.path === "/settings",
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
        hasMenu: !!document.querySelector(".fd-settings .fd-item-row a[href='/settings/account']"),
        marker: window.__marker ?? null,
    })`);
    await clickSel(".fd-settings .fd-item-row a[href='/settings/account']");
    await sleep(400);
    const accountPage = await ev<{
        path: string;
        backTurbo: string | null;
        marker: string | null;
    }>(`({
        path: location.pathname,
        backTurbo: document.querySelector(".fd-settings-detail a[aria-label='Back']")?.getAttribute("data-turbo") ?? null,
        marker: window.__marker ?? null,
    })`);
    record(
        "v2 Settings home and account row navigation over Turbo",
        settingsHome.page === "home" &&
            settingsHome.hasMenu &&
            accountPage.path === "/settings/account" &&
            accountPage.marker === "stay" &&
            accountPage.backTurbo === null,
        { settingsHome, accountPage, ex: drain() },
    );

    // Account › Time zone: a Turbo visit to a page with search, where a choice
    // saves itself and the 303 comes back to Account with no toast.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/account");
    await setMarker();
    await clickSel(
        ".fd-settings .fd-item-row a[href='/settings/account/timezone']",
    );
    await sleep(400);
    const tzPage = await ev<{
        path: string;
        marker: string | null;
        page: string | null;
        search: boolean;
        radios: number;
        checked: string | null;
        back: string | null;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        page: document.querySelector(".fd-settings")?.getAttribute("data-fd-settings-page") ?? null,
        search: !!document.querySelector("form.fd-settings-tz-search input[type=search][name=q]"),
        radios: document.querySelectorAll(".fd-settings-tz-form input[type=radio][name=timezone]").length,
        checked: document.querySelector(".fd-settings-tz-form input[type=radio]:checked")?.value ?? null,
        back: document.querySelector(".fd-settings-detail a[aria-label='Back']")?.getAttribute("href") ?? null,
    })`);
    await ev(`(() => {
        const radio = document.querySelector('.fd-settings-tz-form input[name="timezone"][value="Europe/London"]');
        radio.checked = true;
        radio.form.requestSubmit();
    })()`);
    await sleep(700);
    const tzSaved = await ev<{
        path: string;
        marker: string | null;
        toasts: number;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    const tzPosts = (await stats()).posts.filter((p) => p.path === "/settings");
    record(
        "Settings › Account › Time zone: Turbo visit, search, a choice saves and returns to Account with no toast",
        tzPage.path === "/settings/account/timezone" &&
            tzPage.marker === "stay" &&
            tzPage.page === "timezone" &&
            tzPage.search &&
            tzPage.radios > 0 &&
            tzPage.checked === "America/Los_Angeles" &&
            tzPage.back === "/settings/account" &&
            tzPosts.length === 1 &&
            tzPosts[0]!.entries.some(
                ([k, v]) => k === "timezone" && v === "Europe/London",
            ) &&
            tzSaved.path === "/settings/account" &&
            tzSaved.marker === "stay" &&
            tzSaved.toasts === 0,
        { tzPage, tzSaved, tzPosts, ex: drain() },
    );

    // Export data answers with a download link, so it stays a full load; every
    // other Settings move above and below is Turbo.
    await goto("/settings");
    await setMarker();
    await control("reset=posts");
    await clickSel('form[action="/settings/export"] button');
    await sleep(500);
    const exportNav = await ev<{ marker: string | null; path: string }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
    })`);
    const exportPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/export",
    );
    record(
        "Settings › Export data stays a full load",
        exportNav.marker == null &&
            exportNav.path === "/settings" &&
            exportPosts.length === 1,
        { exportNav, exportPosts, ex: drain() },
    );

    // Settings › Household on the phone: a member's row opens their page over
    // Turbo, the ⋯ menu holds the member actions, Remove confirms inside the
    // menu (no dialog) and posts over Turbo, and Make owner opens a bottom sheet.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/household");
    await setMarker();
    await clickSel('.fd-settings a[href="/settings/household/members/u2"]');
    await sleep(500);
    const memberPage = await ev<{
        path: string;
        marker: string | null;
        page: string | null;
        rows: string[];
        back: string | null;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        page: document.querySelector(".fd-settings")?.getAttribute("data-fd-settings-page") ?? null,
        rows: [...document.querySelectorAll(".fd-settings .fd-item-row__title")].map((e) => e.textContent),
        back: document.querySelector(".fd-settings-detail a[aria-label='Back']")?.getAttribute("href") ?? null,
    })`);
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(200);
    const memberMenu = await ev<{
        open: boolean;
        items: string[];
        dialogs: number;
    }>(`({
        open: !document.querySelector(".fd-settings-detail .fd-menu__panel").hidden,
        items: [...document.querySelectorAll(".fd-settings-detail .fd-menu__panel > .fd-menu__form .fd-menu__label, .fd-settings-detail .fd-menu__panel > button .fd-menu__label, .fd-settings-detail .fd-menu__panel > .fd-menu__confirm > [data-fd-menu-arm] .fd-menu__label")].map((e) => e.textContent),
        dialogs: document.querySelectorAll("dialog[open]").length,
    })`);
    await clickSel(".fd-settings-detail [data-fd-menu-arm]");
    await sleep(150);
    const removeArmed = await ev<{
        confirm: string[];
        dialogs: number;
    }>(`({
        confirm: [...document.querySelectorAll(".fd-settings-detail .fd-menu__confirm-row:not([hidden]) .fd-menu__label")].map((e) => e.textContent),
        dialogs: document.querySelectorAll("dialog[open]").length,
    })`);
    await control("reset=posts");
    await clickSel(
        ".fd-settings-detail .fd-menu__confirm-row:not([hidden]) button[type=submit]",
    );
    await sleep(500);
    const removePosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/members/u2/remove",
    );
    const afterRemove = await ev<{ marker: string | null; path: string }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
    })`);
    record(
        "Settings › Household: a member row opens their page over Turbo; the ⋯ menu has Make admin, Make owner and Remove, which confirms in the menu and posts over Turbo",
        memberPage.path === "/settings/household/members/u2" &&
            memberPage.marker === "stay" &&
            memberPage.page === "household" &&
            memberPage.rows.join() === "Name,Role,Last active,Today" &&
            memberPage.back === "/settings/household" &&
            memberMenu.open &&
            memberMenu.items.join() === "Make admin,Make owner,Remove Sam" &&
            memberMenu.dialogs === 0 &&
            removeArmed.confirm.join() === "Cancel,Remove Sam" &&
            removeArmed.dialogs === 0 &&
            removePosts.length === 1 &&
            removePosts[0]!.entries.some(
                ([k, v]) => k === "confirm" && v === "yes",
            ) &&
            afterRemove.marker === "stay",
        {
            memberPage,
            memberMenu,
            removeArmed,
            removePosts,
            afterRemove,
            ex: drain(),
        },
    );

    await goto("/settings/household/members/u2");
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(200);
    await clickSel(
        '.fd-settings-detail button[commandfor="fd-member-make-owner"]',
    );
    await sleep(500);
    const makeOwner = await ev<{
        open: boolean;
        width: number;
        bottomGap: number;
        viewport: number;
        text: string;
    }>(`(() => {
        const d = document.getElementById("fd-member-make-owner");
        const r = d.getBoundingClientRect();
        return {
            open: d.open,
            width: Math.round(r.width),
            bottomGap: Math.round(window.innerHeight - r.bottom),
            viewport: window.innerWidth,
            text: d.querySelector(".fd-sheet__text")?.textContent ?? "",
        };
    })()`);
    // Choosing the item closed the ⋯ menu behind the sheet; one Escape closes
    // the sheet, and focus goes back to the ⋯.
    const menuBehind = await ev<{ panelHidden: boolean }>(`({
        panelHidden: document.querySelector(".fd-settings-detail .fd-menu__panel").hidden,
    })`);
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
    await sleep(300);
    const afterEscape = await ev<{
        open: boolean;
        focusOnTrigger: boolean;
    }>(`({
        open: document.getElementById("fd-member-make-owner").open,
        focusOnTrigger: document.activeElement === document.querySelector(".fd-settings-detail [data-fd-menu-trigger]"),
    })`);
    record(
        "Settings › Household: Make owner opens a bottom sheet, not a centred dialog",
        makeOwner.open &&
            makeOwner.width === makeOwner.viewport &&
            makeOwner.bottomGap === 0 &&
            /Only Sam can undo this/.test(makeOwner.text),
        { makeOwner, ex: drain() },
    );
    record(
        "Settings › Household: choosing a menu item that opens a sheet closes the menu, one Escape closes the sheet and focus returns to the ⋯",
        menuBehind.panelHidden &&
            !afterEscape.open &&
            afterEscape.focusOnTrigger,
        { menuBehind, afterEscape, ex: drain() },
    );

    await goto("/settings/household");
    await clickSel('.fd-settings button[commandfor="fd-household-add-member"]');
    await sleep(500);
    const addMember = await ev<{
        open: boolean;
        width: number;
        bottomGap: number;
        viewport: number;
        fields: string[];
        modals: number;
    }>(`(() => {
        const d = document.getElementById("fd-household-add-member");
        const r = d.getBoundingClientRect();
        return {
            open: d.open,
            width: Math.round(r.width),
            bottomGap: Math.round(window.innerHeight - r.bottom),
            viewport: window.innerWidth,
            fields: [...d.querySelectorAll("input")].map((i) => i.name),
            modals: document.querySelectorAll("dialog.modal[open]").length,
        };
    })()`);
    record(
        "Settings › Household: Add a member opens a bottom sheet with name, login, password and, for the owner, a Member or Admin role",
        addMember.open &&
            addMember.width === addMember.viewport &&
            addMember.bottomGap === 0 &&
            addMember.fields.join() ===
                "display_name,login,password,role,role" &&
            addMember.modals === 0,
        { addMember, ex: drain() },
    );

    // Household › Time zone: a page with search, like Account's; a choice saves
    // the household's zone and the 303 comes back to Household with no toast.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/household");
    await setMarker();
    await clickSel(
        ".fd-settings .fd-item-row a[href='/settings/household/timezone']",
    );
    await sleep(400);
    const hhTz = await ev<{
        path: string;
        marker: string | null;
        page: string | null;
        search: string | null;
        first: string | null;
        checked: string | null;
        sheets: number;
        back: string | null;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        page: document.querySelector(".fd-settings")?.getAttribute("data-fd-settings-page") ?? null,
        search: document.querySelector("form.fd-settings-tz-search")?.getAttribute("action") ?? null,
        first: document.querySelector(".fd-settings-tz-form input[type=radio]")?.value ?? null,
        checked: document.querySelector(".fd-settings-tz-form input[type=radio]:checked")?.value ?? null,
        sheets: document.querySelectorAll("dialog").length,
        back: document.querySelector(".fd-settings-detail a[aria-label='Back']")?.getAttribute("href") ?? null,
    })`);
    await ev(`(() => {
        const radio = document.querySelector('.fd-settings-tz-form input[name="timezone"][value="Europe/London"]');
        radio.checked = true;
        radio.form.requestSubmit();
    })()`);
    await sleep(700);
    const hhTzSaved = await ev<{
        path: string;
        marker: string | null;
        toasts: number;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    const hhTzPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/timezone",
    );
    record(
        "Settings › Household › Time zone: a Turbo page with search and the owner's zone as the first choice; a pick saves and returns to Household with no toast",
        hhTz.path === "/settings/household/timezone" &&
            hhTz.marker === "stay" &&
            hhTz.page === "household" &&
            hhTz.search === "/settings/household/timezone" &&
            hhTz.first === "" &&
            hhTz.checked === "" &&
            hhTz.back === "/settings/household" &&
            hhTzPosts.length === 1 &&
            hhTzPosts[0]!.entries.some(
                ([k, v]) => k === "timezone" && v === "Europe/London",
            ) &&
            hhTzSaved.path === "/settings/household" &&
            hhTzSaved.marker === "stay" &&
            hhTzSaved.toasts === 0,
        { hhTz, hhTzSaved, hhTzPosts, ex: drain() },
    );

    // Invite codes: the + makes a code, and the answer carries the code once, so
    // that form is a full page load while the rest of Settings is Turbo.
    await control("reset=posts");
    await goto("/settings/household/invites");
    await setMarker();
    await clickSel(
        '.fd-settings-detail form[action="/settings/household/invites"] button',
    );
    await sleep(600);
    const invitePost = await ev<{ marker: string | null; path: string }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
    })`);
    const invitePosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/invites",
    );
    record(
        "Settings › Household › Invite codes: + is a full page load (no Turbo), the code response cannot be a Turbo visit",
        invitePost.marker == null &&
            invitePost.path === "/settings/household/invites" &&
            invitePosts.length === 1,
        { invitePost, invitePosts, ex: drain() },
    );

    // Settings › Household › Restock: the row opens the page over Turbo; Day is
    // a pull-down on the row and Time saves itself, both over Turbo, with no text
    // under the list but when it last ran.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/household");
    await setMarker();
    await clickSel('.fd-settings a[href="/settings/household/restock"]');
    await sleep(500);
    const restockPage = await ev<{
        path: string;
        marker: string | null;
        page: string | null;
        title: string | null;
        rows: string[];
        intro: boolean;
        lastRun: string | null;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        page: document.querySelector(".fd-settings")?.getAttribute("data-fd-settings-page") ?? null,
        title: document.querySelector(".fd-settings-detail .fd-detail-bar__title")?.textContent ?? null,
        rows: [...document.querySelectorAll(".fd-settings .fd-item-row__title")].map((e) => e.textContent),
        intro: document.body.innerText.includes("On the restock day"),
        lastRun: document.querySelector("[data-fd-restock-last-run]")?.textContent ?? null,
    })`);
    await clickSel(".fd-restock__day [data-fd-menu-trigger]");
    await sleep(200);
    const dayMenu = await ev<{
        open: boolean;
        items: string[];
        checked: string | null;
        inView: boolean;
    }>(`(() => {
        const panel = document.querySelector(".fd-restock__day .fd-menu__panel");
        const r = panel.getBoundingClientRect();
        return {
            open: !panel.hidden,
            items: [...panel.querySelectorAll(".fd-menu__label")].map((e) => e.textContent),
            checked: panel.querySelector('[aria-checked="true"] .fd-menu__label')?.textContent ?? null,
            inView: r.left >= 0 && r.right <= window.innerWidth,
        };
    })()`);
    await control("reset=posts");
    await clickSel(
        '.fd-restock__day .fd-menu__panel form:has(input[value="1"]) button',
    );
    await sleep(600);
    const dayPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/restock",
    );
    const afterDay = await ev<{ marker: string | null; toasts: number }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    await control("reset=posts");
    await ev(`(() => {
        const input = document.querySelector(".fd-restock__time-input");
        input.focus();
        input.value = "18:30";
        input.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await sleep(700);
    const timePosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/restock",
    );
    const afterTime = await ev<{ marker: string | null }>(`({
        marker: window.__marker ?? null,
    })`);
    record(
        "Settings › Household › Restock: a Turbo page with Weekly restock, Day and Time and no intro; Day is a pull-down on the row and Time saves itself, both over Turbo",
        restockPage.path === "/settings/household/restock" &&
            restockPage.marker === "stay" &&
            restockPage.page === "household" &&
            restockPage.title === "Restock" &&
            restockPage.rows.join() === "Weekly restock,Day,Time" &&
            !restockPage.intro &&
            restockPage.lastRun === "Last ran Nov 8 · added 3 usuals" &&
            dayMenu.open &&
            dayMenu.inView &&
            dayMenu.items.length === 7 &&
            dayMenu.items[0] === "Sunday" &&
            dayMenu.checked === "Sunday" &&
            dayPosts.length === 1 &&
            dayPosts[0]!.entries.some(
                ([k, v]) => k === "restock_weekday" && v === "1",
            ) &&
            afterDay.marker === "stay" &&
            afterDay.toasts === 0 &&
            timePosts.length === 1 &&
            timePosts[0]!.entries.some(
                ([k, v]) => k === "restock_time" && v === "18:30",
            ) &&
            afterTime.marker === "stay",
        {
            restockPage,
            dayMenu,
            dayPosts,
            afterDay,
            timePosts,
            afterTime,
            ex: drain(),
        },
    );

    // Settings › Household › Stores: a Turbo page; the default store is a
    // pull-down on the row; Reorder (the Detail bar's ⋯) turns the list into an
    // inline edit mode with a handle per row, a drag posts the whole order, and
    // Done leaves the mode, all with no document load and no toast. A store's
    // page renames in place, adds a section inline and deletes with a confirm
    // in the menu.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/household");
    await setMarker();
    await clickSel('.fd-settings a[href="/settings/household/stores"]');
    await sleep(500);
    const storesPage = await ev<{
        path: string;
        marker: string | null;
        title: string | null;
        rows: string[];
        intro: boolean;
        optOuts: number;
        dialogs: number;
    }>(`({
        path: location.pathname + location.search,
        marker: window.__marker ?? null,
        title: document.querySelector(".fd-settings-detail .fd-detail-bar__title")?.textContent ?? null,
        rows: [...document.querySelectorAll(".fd-settings .fd-item-row__title")].map((e) => e.textContent),
        intro: document.body.innerText.includes("Groceries are grouped"),
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
        dialogs: document.querySelectorAll(".fd-settings dialog").length,
    })`);
    await clickSel(".fd-settings .fd-menu--row [data-fd-menu-trigger]");
    await sleep(200);
    const defaultMenu = await ev<{
        open: boolean;
        items: string[];
        checked: string | null;
    }>(`(() => {
        const panel = document.querySelector(".fd-settings .fd-menu--row .fd-menu__panel");
        return {
            open: !panel.hidden,
            items: [...panel.querySelectorAll(".fd-menu__label")].map((e) => e.textContent),
            checked: panel.querySelector('[aria-checked="true"] .fd-menu__label')?.textContent ?? null,
        };
    })()`);
    await control("reset=posts");
    await clickSel(
        '.fd-settings .fd-menu--row .fd-menu__panel form:has(input[value="s-trader"]) button',
    );
    await sleep(600);
    const defaultPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/stores/preferences",
    );
    const afterDefault = await ev<{ marker: string | null; toasts: number }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    // Reorder: the ⋯ item is a link, so it is a Turbo visit into the mode.
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(200);
    const barMenu = await ev<string[]>(
        `[...document.querySelectorAll(".fd-settings-detail .fd-menu__panel .fd-menu__label")].map((e) => e.textContent)`,
    );
    await clickSel('.fd-settings-detail .fd-menu__panel a[href$="?reorder=1"]');
    await sleep(600);
    const reorderState = () =>
        ev<{
            path: string;
            marker: string | null;
            handles: number;
            names: string[];
            done: string | null;
            prefs: boolean;
            menus: number;
        }>(`({
            path: location.pathname + location.search,
            marker: window.__marker ?? null,
            handles: document.querySelectorAll("[data-fd-order-handle]").length,
            names: [...document.querySelectorAll("[data-fd-order-item] .fd-item-row__title")].map((e) => e.textContent),
            done: document.querySelector('.fd-settings-detail a[aria-label="Done"]')?.getAttribute("href") ?? null,
            prefs: document.body.innerText.toLowerCase().includes("when adding to the list"),
            menus: document.querySelectorAll(".fd-settings-detail [data-fd-menu]").length,
        })`);
    const inReorder = await reorderState();
    // Drag the first handle below the last row, as a finger would.
    await control("reset=posts");
    await ev(`(() => {
        const handle = document.querySelector("[data-fd-order-handle]");
        const rows = [...document.querySelectorAll("[data-fd-order-item]")];
        const last = rows[rows.length - 1].getBoundingClientRect();
        const at = handle.getBoundingClientRect();
        const fire = (target, type, y) =>
            target.dispatchEvent(
                new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: at.left + 4, clientY: y }),
            );
        fire(handle, "pointerdown", at.top + 4);
        fire(window, "pointermove", last.bottom + 10);
        fire(window, "pointerup", last.bottom + 10);
    })()`);
    await sleep(700);
    const orderPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/stores/order",
    );
    const afterDrag = await reorderState();
    await clickSel('.fd-settings-detail a[aria-label="Done"]');
    await sleep(600);
    const afterDone = await ev<{
        path: string;
        marker: string | null;
        handles: number;
        prefs: boolean;
    }>(`({
        path: location.pathname + location.search,
        marker: window.__marker ?? null,
        handles: document.querySelectorAll("[data-fd-order-handle]").length,
        prefs: document.body.innerText.toLowerCase().includes("when adding to the list"),
    })`);
    record(
        "Settings › Household › Stores: a Turbo page with the default store as a pull-down; Reorder (⋯) is an inline mode with a handle per row, a drag posts the whole order and Done leaves it, all over Turbo with no toast",
        storesPage.path === "/settings/household/stores" &&
            storesPage.marker === "stay" &&
            storesPage.title === "Stores" &&
            storesPage.rows.join("|") ===
                "Costco|Trader Joe's|Farmers market|Add a store|Default store|Use each food's usual store" &&
            !storesPage.intro &&
            storesPage.optOuts === 0 &&
            storesPage.dialogs === 0 &&
            defaultMenu.open &&
            defaultMenu.items.join("|") ===
                "None|Costco|Trader Joe's|Farmers market" &&
            defaultMenu.checked === "Costco" &&
            defaultPosts.length === 1 &&
            defaultPosts[0]!.entries.some(
                ([k, v]) => k === "default_store_id" && v === "s-trader",
            ) &&
            afterDefault.marker === "stay" &&
            afterDefault.toasts === 0 &&
            barMenu.join("|") === "Reorder" &&
            inReorder.path === "/settings/household/stores?reorder=1" &&
            inReorder.marker === "stay" &&
            inReorder.handles === 3 &&
            inReorder.names.join("|") ===
                "Costco|Trader Joe's|Farmers market" &&
            inReorder.done === "/settings/household/stores" &&
            !inReorder.prefs &&
            inReorder.menus === 0 &&
            orderPosts.length === 1 &&
            orderPosts[0]!.entries
                .filter(([k]) => k === "order")
                .map(([, v]) => v)
                .join("|") === "s-trader|s-market|s-costco" &&
            afterDrag.marker === "stay" &&
            afterDrag.path === "/settings/household/stores?reorder=1" &&
            afterDone.path === "/settings/household/stores" &&
            afterDone.marker === "stay" &&
            afterDone.handles === 0 &&
            afterDone.prefs,
        {
            storesPage,
            defaultMenu,
            defaultPosts,
            afterDefault,
            barMenu,
            inReorder,
            orderPosts,
            afterDrag,
            afterDone,
            ex: drain(),
        },
    );

    await control("reset=posts");
    await clickSel(
        '.fd-settings a[href="/settings/household/stores/s-costco"]',
    );
    await sleep(500);
    const storeState = () =>
        ev<{
            path: string;
            marker: string | null;
            title: string | null;
            sections: string[];
            nameDisabled: boolean;
            dialogs: number;
            optOuts: number;
        }>(`({
            path: location.pathname + location.search,
            marker: window.__marker ?? null,
            title: document.querySelector(".fd-settings-detail .fd-detail-bar__title")?.textContent ?? null,
            sections: [...document.querySelectorAll(".fd-settings .fd-item-row__title")].map((e) => e.textContent),
            nameDisabled: !!document.querySelector('.fd-settings #fd-store-name[disabled]'),
            dialogs: document.querySelectorAll(".fd-settings dialog").length,
            optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
        })`);
    const storePage = await storeState();
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(200);
    const storeMenuItems = await ev<string[]>(
        `[...document.querySelectorAll(".fd-settings-detail .fd-menu__panel > a .fd-menu__label, .fd-settings-detail .fd-menu__panel > .fd-menu__confirm > [data-fd-menu-arm] .fd-menu__label")].map((e) => e.textContent)`,
    );
    await clickSel('.fd-settings-detail .fd-menu__panel a[href$="?rename=1"]');
    await sleep(600);
    const renaming = await ev<{
        path: string;
        marker: string | null;
        editable: boolean;
        focused: boolean;
    }>(`({
        path: location.pathname + location.search,
        marker: window.__marker ?? null,
        editable: !!document.querySelector('.fd-settings #fd-store-name:not([disabled])'),
        focused: document.activeElement?.id === "fd-store-name",
    })`);
    // Add a section: the row opens a field in place and posts over Turbo.
    await clickSel(".fd-settings details[data-fd-add-row] summary");
    await sleep(200);
    const addOpen = await ev<{ open: boolean; focused: boolean }>(`({
        open: !!document.querySelector(".fd-settings details[data-fd-add-row][open]"),
        focused: document.activeElement?.closest("details[data-fd-add-row]") != null,
    })`);
    await control("reset=posts");
    await ev(`(() => {
        const input = document.querySelector(".fd-settings details[data-fd-add-row][open] input");
        input.value = "Deli";
        input.form.requestSubmit();
    })()`);
    await sleep(600);
    const sectionPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/stores/s-costco/sections",
    );
    const afterAdd = await ev<{ marker: string | null; toasts: number }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    // Delete confirms in the menu: arm, Cancel + the verb, then the post.
    await control("reset=posts");
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(200);
    await clickSel(".fd-settings-detail [data-fd-menu-arm]");
    await sleep(100);
    const armed = await ev<string[]>(
        `[...document.querySelectorAll(".fd-settings-detail .fd-menu__confirm-row:not([hidden]) .fd-menu__label")].map((e) => e.textContent)`,
    );
    await clickSel(
        ".fd-settings-detail .fd-menu__confirm-row:not([hidden]) button[type=submit]",
    );
    await sleep(600);
    const deletePosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/stores/s-costco/delete",
    );
    const afterDelete = await ev<{ marker: string | null; toasts: number }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    record(
        "Settings › Household › a store: a Turbo page; the ⋯ has Rename and Delete; Rename opens the name field in place, Add a section is an inline row, Delete confirms in the menu, all over Turbo with no sheet and no toast",
        storePage.path === "/settings/household/stores/s-costco" &&
            storePage.marker === "stay" &&
            storePage.title === "Costco" &&
            storePage.sections.join("|") ===
                "Produce|Meat|Dairy|Other|Add a section|Add a rule" &&
            storePage.nameDisabled &&
            storePage.dialogs === 0 &&
            storePage.optOuts === 0 &&
            storeMenuItems.join("|") === "Rename|Delete" &&
            renaming.path === "/settings/household/stores/s-costco?rename=1" &&
            renaming.marker === "stay" &&
            renaming.editable &&
            renaming.focused &&
            addOpen.open &&
            addOpen.focused &&
            sectionPosts.length === 1 &&
            sectionPosts[0]!.entries.some(
                ([k, v]) => k === "name" && v === "Deli",
            ) &&
            afterAdd.marker === "stay" &&
            afterAdd.toasts === 0 &&
            armed.join("|") === "Cancel|Delete store" &&
            deletePosts.length === 1 &&
            deletePosts[0]!.entries.some(
                ([k, v]) => k === "lines" && v === "0",
            ) &&
            afterDelete.marker === "stay" &&
            afterDelete.toasts === 0,
        {
            storePage,
            storeMenuItems,
            renaming,
            addOpen,
            sectionPosts,
            afterAdd,
            armed,
            deletePosts,
            afterDelete,
            ex: drain(),
        },
    );

    // A section's ⋯ by keyboard only: Move down twice, and each time focus is
    // back on that section's ⋯ and the stored order has moved.
    {
        await control("reset=sections");
        await goto("/settings/household/stores/s-costco");
        await setMarker();
        const trigger = "#fd-section-sec-produce [data-fd-menu-trigger]";
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
            await sleep(700);
        };
        const order = () =>
            ev<string[]>(
                `[...document.querySelectorAll(".fd-settings .fd-item-row[id^='fd-section-'] .fd-item-row__title")].map((e) => e.textContent)`,
            );
        const focusState = () =>
            ev<{ onTrigger: boolean; path: string; marker: string | null }>(`({
                onTrigger: document.activeElement === document.querySelector(${JSON.stringify(trigger)}),
                path: location.pathname + location.search,
                marker: window.__marker ?? null,
            })`);
        async function moveDown() {
            await ev(
                `document.querySelector(${JSON.stringify(trigger)}).focus()`,
            );
            await pressKey("ArrowDown", "ArrowDown", 40);
            for (let i = 0; i < 5; i++) {
                const label = await ev<string>(
                    `document.activeElement?.textContent?.trim() ?? ""`,
                );
                if (label === "Move down") break;
                await pressKey("ArrowDown", "ArrowDown", 40);
            }
            await control("reset=posts");
            await pressEnter();
        }
        const start = await order();
        await moveDown();
        const once = await focusState();
        const afterOnce = await order();
        await moveDown();
        const twice = await focusState();
        const afterTwice = await order();
        const movePosts = (await stats()).posts.filter(
            (p) =>
                p.path === "/settings/household/stores/s-costco/sections/order",
        );
        record(
            "Settings › Household › a store: a section's ⋯ by keyboard, Move down twice, focus stays on that section's ⋯ and the order changed twice",
            start.join("|") === "Produce|Meat|Dairy|Other" &&
                afterOnce.join("|") === "Meat|Produce|Dairy|Other" &&
                afterTwice.join("|") === "Meat|Dairy|Produce|Other" &&
                once.onTrigger &&
                twice.onTrigger &&
                // The focus hint is dropped from the URL once it is used.
                once.path === "/settings/household/stores/s-costco" &&
                twice.path === "/settings/household/stores/s-costco" &&
                twice.marker === "stay" &&
                movePosts.length === 1 &&
                movePosts[0]!.entries.some(
                    ([k, v]) => k === "move" && v === "sec-produce:down",
                ),
            {
                start,
                afterOnce,
                afterTwice,
                once,
                twice,
                movePosts,
                ex: drain(),
            },
        );
        await control("reset=sections");
    }

    // Settings › Household › Recipe link readers: Turbo page; an off reader's
    // switch opens its terms in place (no dialog) and the confirm posts over
    // Turbo; Blocked links has a ⋯ that clears in place.
    await control("reset=posts");
    await goto("/settings/household");
    await setMarker();
    await clickSel('.fd-settings a[href="/settings/household/readers"]');
    await sleep(500);
    const readersPage = await ev<{
        path: string;
        marker: string | null;
        rows: string[];
        switches: number;
        terms: boolean;
        intro: boolean;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        rows: [...document.querySelectorAll(".fd-settings .fd-item-row__title")].map((e) => e.textContent),
        switches: document.querySelectorAll(".fd-readers [role=switch]").length,
        terms: !!document.querySelector("[data-fd-reader-terms]"),
        intro: document.body.innerText.includes("When someone shares a TikTok"),
    })`);
    await clickSel('.fd-readers form[method="get"] button[role="switch"]');
    await sleep(600);
    const readerTerms = await ev<{
        url: string;
        marker: string | null;
        terms: boolean;
        dialogs: number;
        confirmBox: boolean;
    }>(`({
        url: location.pathname + location.search,
        marker: window.__marker ?? null,
        terms: !!document.querySelector('[data-fd-reader-terms="facebook"]'),
        dialogs: document.querySelectorAll("dialog[open]").length,
        confirmBox: !!document.querySelector('[data-fd-reader-terms] input[name="confirm"]'),
    })`);
    await control("reset=posts");
    await ev(`(() => {
        const form = document.querySelector("[data-fd-reader-terms] form");
        form.querySelector('input[name="confirm"]').checked = true;
        form.requestSubmit();
    })()`);
    await sleep(600);
    const readerPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/social-readers",
    );
    const afterReader = await ev<{ marker: string | null }>(`({
        marker: window.__marker ?? null,
    })`);
    await goto("/settings/household/readers");
    await setMarker();
    await clickSel(".fd-readers [data-fd-menu-trigger]");
    await sleep(200);
    await clickSel(".fd-readers [data-fd-menu-arm]");
    await sleep(150);
    const blockedArmed = await ev<{ confirm: string[]; dialogs: number }>(`({
        confirm: [...document.querySelectorAll(".fd-readers .fd-menu__confirm-row:not([hidden]) .fd-menu__label")].map((e) => e.textContent),
        dialogs: document.querySelectorAll("dialog[open]").length,
    })`);
    await control("reset=posts");
    await clickSel(
        ".fd-readers .fd-menu__confirm-row:not([hidden]) button[type=submit]",
    );
    await sleep(600);
    const blockedPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/fetch-refusals/clear",
    );
    const afterBlocked = await ev<{ marker: string | null }>(`({
        marker: window.__marker ?? null,
    })`);
    record(
        "Settings › Household › Recipe link readers: a Turbo page; an off reader's switch opens its terms in place and the confirm posts; Blocked links clears from its ⋯, confirming in the menu",
        readersPage.path === "/settings/household/readers" &&
            readersPage.marker === "stay" &&
            readersPage.rows.join() === "TikTok,Facebook,Blocked links" &&
            readersPage.switches === 2 &&
            !readersPage.terms &&
            !readersPage.intro &&
            readerTerms.url ===
                "/settings/household/readers?turn_on=facebook" &&
            readerTerms.marker === "stay" &&
            readerTerms.terms &&
            readerTerms.confirmBox &&
            readerTerms.dialogs === 0 &&
            readerPosts.length === 1 &&
            ["reader=facebook", "enabled=1", "confirm=1"].every((pair) =>
                readerPosts[0]!.entries.some(([k, v]) => `${k}=${v}` === pair),
            ) &&
            afterReader.marker === "stay" &&
            blockedArmed.confirm.join() === "Cancel,Clear blocked links" &&
            blockedArmed.dialogs === 0 &&
            blockedPosts.length === 1 &&
            afterBlocked.marker === "stay",
        {
            readersPage,
            readerTerms,
            readerPosts,
            afterReader,
            blockedArmed,
            blockedPosts,
            afterBlocked,
            ex: drain(),
        },
    );

    // Settings › Household › Shared links: the row opens the page over Turbo;
    // each link has a ⋯ whose Revoke confirms in the menu and posts over Turbo.
    await control("reset=posts");
    await goto("/settings/household");
    await setMarker();
    await clickSel('.fd-settings a[href="/settings/household/shared-links"]');
    await sleep(500);
    const linksPage = await ev<{
        path: string;
        marker: string | null;
        title: string | null;
        rows: string[];
        subs: string[];
        menus: number;
        back: string | null;
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        title: document.querySelector(".fd-settings-detail .fd-detail-bar__title")?.textContent ?? null,
        rows: [...document.querySelectorAll(".fd-settings .fd-item-row__title")].map((e) => e.textContent),
        subs: [...document.querySelectorAll(".fd-settings .fd-item-row__subtitle")].map((e) => e.textContent),
        menus: document.querySelectorAll(".fd-settings [data-fd-menu-trigger]").length,
        back: document.querySelector(".fd-settings-detail a[aria-label='Back']")?.getAttribute("href") ?? null,
    })`);
    await clickSel(".fd-settings [data-fd-menu-trigger]");
    await sleep(200);
    await clickSel(".fd-settings [data-fd-menu-arm]");
    await sleep(150);
    const revokeArmed = await ev<{ confirm: string[]; dialogs: number }>(`({
        confirm: [...document.querySelectorAll(".fd-settings .fd-menu__confirm-row:not([hidden]) .fd-menu__label")].map((e) => e.textContent),
        dialogs: document.querySelectorAll("dialog[open]").length,
    })`);
    await control("reset=posts");
    await clickSel(
        ".fd-settings .fd-menu__confirm-row:not([hidden]) button[type=submit]",
    );
    await sleep(600);
    const revokePosts = (await stats()).posts.filter((p) =>
        p.path.endsWith("/revoke"),
    );
    const afterRevoke = await ev<{ marker: string | null; toasts: number }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    record(
        "Settings › Household › Shared links: a Turbo page of links, each with a ⋯ whose Revoke confirms in the menu and posts over Turbo with no toast",
        linksPage.path === "/settings/household/shared-links" &&
            linksPage.marker === "stay" &&
            linksPage.title === "Shared links" &&
            linksPage.rows.join() === "Chicken alfredo,Grocery list" &&
            linksPage.subs.join() === "Recipe · expires 12 Dec,Never expires" &&
            linksPage.menus === 2 &&
            linksPage.back === "/settings/household" &&
            revokeArmed.confirm.join() === "Cancel,Revoke link" &&
            revokeArmed.dialogs === 0 &&
            revokePosts.length === 1 &&
            revokePosts[0]!.path ===
                "/settings/household/shared-links/11111111-1111-4111-8111-111111111111/revoke" &&
            afterRevoke.marker === "stay" &&
            afterRevoke.toasts === 0,
        { linksPage, revokeArmed, revokePosts, afterRevoke, ex: drain() },
    );

    // Rotate household token: a confirm sheet (bottom sheet on the phone) whose
    // form is a full page load, because its answer carries the one-time token.
    await control("reset=posts");
    await goto("/settings/household");
    await setMarker();
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(200);
    await clickSel(
        '.fd-settings-detail button[commandfor="fd-household-rotate-token"]',
    );
    await sleep(500);
    const rotateSheet = await ev<{
        open: boolean;
        width: number;
        bottomGap: number;
        viewport: number;
        title: string;
        text: string;
        turbo: string | null;
        modals: number;
    }>(`(() => {
        const d = document.getElementById("fd-household-rotate-token");
        const r = d.getBoundingClientRect();
        return {
            open: d.open,
            width: Math.round(r.width),
            bottomGap: Math.round(window.innerHeight - r.bottom),
            viewport: window.innerWidth,
            title: d.querySelector(".fd-sheet__title")?.textContent ?? "",
            text: d.querySelector(".fd-sheet__text")?.textContent ?? "",
            turbo: d.querySelector("form")?.getAttribute("data-turbo") ?? null,
            modals: document.querySelectorAll("dialog.modal").length,
        };
    })()`);
    await clickSel("#fd-household-rotate-token .fd-btn--danger");
    await sleep(700);
    const rotated = await ev<{ marker: string | null; path: string }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
    })`);
    const rotatePosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/rotate-token",
    );
    record(
        "Settings › Household › Rotate household token: a confirm sheet at the bottom of the phone; confirming is a full page load (no Turbo), the token response cannot be a Turbo visit",
        rotateSheet.open &&
            rotateSheet.width === rotateSheet.viewport &&
            rotateSheet.bottomGap === 0 &&
            rotateSheet.title === "Rotate household token?" &&
            rotateSheet.text === "Agents using the old token stop working." &&
            rotateSheet.turbo === "false" &&
            rotateSheet.modals === 0 &&
            rotated.marker == null &&
            rotatePosts.length === 1,
        { rotateSheet, rotated, rotatePosts, ex: drain() },
    );

    // The token page is the one place the token is shown. Leaving it by a Turbo
    // visit (Done) and pressing Back must not bring the token back from
    // Turbo's snapshot cache: the page is fetched again and lands on Household.
    const tokenShown = await ev<{
        path: string;
        token: string;
        noCache: string | null;
    }>(`({
        path: location.pathname,
        token: document.getElementById("household-token")?.textContent ?? "",
        noCache: document.querySelector('meta[name="turbo-cache-control"][content="no-cache"]')?.getAttribute("content") ?? null,
    })`);
    await setMarker();
    await clickSel(
        '.fd-settings-main a.fd-btn--primary[href="/settings/household"]',
    );
    await sleep(700);
    const tokenDone = await ev<{ marker: string | null; path: string }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
    })`);
    await ev(`history.back()`);
    await sleep(900);
    const tokenBack = await ev<{
        path: string;
        token: boolean;
        field: boolean;
    }>(`({
        path: location.pathname,
        token: document.body.innerText.includes(${JSON.stringify("nt_hh_")}),
        field: !!document.getElementById("household-token"),
    })`);
    record(
        "Settings › Household › token page: shown once; Done (a Turbo visit) then Back does not restore the token from the snapshot cache",
        tokenShown.path === "/settings/household/rotate-token" &&
            tokenShown.token.startsWith("nt_hh_") &&
            tokenShown.noCache === "no-cache" &&
            tokenDone.marker === "stay" &&
            tokenDone.path === "/settings/household" &&
            tokenBack.path === "/settings/household" &&
            !tokenBack.token &&
            !tokenBack.field,
        { tokenShown, tokenDone, tokenBack, ex: drain() },
    );

    // From 1024 px the Detail bar is gone and the same ⋯ menu ends the page
    // header, in line with the title: it opens on top of the page, in view.
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/settings/household/members/u2");
    await clickSel(".fd-settings-page-head__actions [data-fd-menu-trigger]");
    await sleep(250);
    const desktopMenu = await ev<{
        barShown: boolean;
        items: string[];
        inView: boolean;
        onTop: boolean;
    }>(`(() => {
        const panel = document.querySelector(".fd-settings-page-head__actions .fd-menu__panel");
        const r = panel.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12);
        return {
            barShown: getComputedStyle(document.querySelector(".fd-settings-detail")).display !== "none",
            items: [...panel.querySelectorAll(".fd-menu__label")].slice(0, 3).map((e) => e.textContent),
            inView: !panel.hidden && r.width > 0 && r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
            onTop: !!hit && panel.contains(hit),
        };
    })()`);
    record(
        "Settings › Household: on desktop the ⋯ menu ends the page header (no Detail bar) and opens in view, over the page",
        !desktopMenu.barShown &&
            desktopMenu.items.join() === "Make admin,Make owner,Remove Sam" &&
            desktopMenu.inView &&
            desktopMenu.onTop,
        { desktopMenu, ex: drain() },
    );
    // The same sheets are the 480 px panel from the right at 1440: Add member,
    // Rename household (the value sheets) and Transfer ownership.
    type Panel = {
        open: boolean;
        width: number;
        right: number;
        viewport: number;
    };
    const sidePanel = async (path: string, clicks: string[], id: string) => {
        await goto(path);
        for (const sel of clicks) {
            await clickSel(sel);
            await sleep(250);
        }
        await sleep(200);
        return ev<Panel>(`(() => {
            const d = document.getElementById(${JSON.stringify(id)});
            const r = (d.querySelector(".fd-sheet-panel") || d).getBoundingClientRect();
            return { open: d.open, width: Math.round(r.width), right: Math.round(r.right), viewport: window.innerWidth };
        })()`);
    };
    const headMenu = ".fd-settings-page-head__actions [data-fd-menu-trigger]";
    const sideAdd = await sidePanel(
        "/settings/household",
        ['.fd-settings button[commandfor="fd-household-add-member"]'],
        "fd-household-add-member",
    );
    const sideName = await sidePanel(
        "/settings/household",
        [
            headMenu,
            '.fd-settings-page-head__actions button[commandfor="fd-household-name"]',
        ],
        "fd-household-name",
    );
    const sideOwner = await sidePanel(
        "/settings/household/members/u2",
        [
            headMenu,
            '.fd-settings-page-head__actions button[commandfor="fd-member-make-owner"]',
        ],
        "fd-member-make-owner",
    );
    const sideRotate = await sidePanel(
        "/settings/household",
        [
            headMenu,
            '.fd-settings-page-head__actions button[commandfor="fd-household-rotate-token"]',
        ],
        "fd-household-rotate-token",
    );
    const isSide = (p: Panel) =>
        p.open && p.width === 480 && p.right === p.viewport;
    // The two confirms are a centred 480 px card, as the design draws them.
    const isCentred = (p: Panel) =>
        p.open &&
        p.width === 480 &&
        Math.abs(p.right - p.width / 2 - p.viewport / 2) <= 2;
    record(
        "Settings › Household: at 1440 Add member and Rename household open as the 480 px side panel, Make owner and Rotate household token as a centred 480 px dialog",
        isSide(sideAdd) &&
            isSide(sideName) &&
            isCentred(sideOwner) &&
            isCentred(sideRotate),
        { sideAdd, sideName, sideOwner, sideRotate, ex: drain() },
    );
    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });

    // The entrance fade belongs to a full load: the head script sets html.fx
    // and html.fx-enter before first paint, shell.js ends fx-enter, and a page
    // Turbo swaps in is never faded.
    await goto("/settings");
    const firstLoad = await ev<{
        fx: boolean;
        enter: boolean;
        anim: string;
    }>(`({
        fx: document.documentElement.classList.contains("fx"),
        enter: document.documentElement.classList.contains("fx-enter"),
        anim: getComputedStyle(document.querySelector(".app-main > :nth-child(2), .app-main > :first-child")).animationName,
    })`);
    await sleep(1300);
    const settled = await ev<{ fx: boolean; enter: boolean }>(`({
        fx: document.documentElement.classList.contains("fx"),
        enter: document.documentElement.classList.contains("fx-enter"),
    })`);
    await setMarker();
    await clickSel('.fd-tabs a[href="/kitchen/fridge"]');
    // Sampled the moment the new body is in, not after a settle.
    const turboPage = await ev<{
        enter: boolean;
        anim: string;
        marker: string | null;
    }>(`new Promise((resolve) => {
        const read = () => resolve({
            enter: document.documentElement.classList.contains("fx-enter"),
            anim: getComputedStyle(document.querySelector(".app-main > :first-child")).animationName,
            marker: window.__marker ?? null,
        });
        if (location.pathname === "/kitchen/fridge") read();
        else document.addEventListener("turbo:render", read, { once: true });
    })`);
    record(
        "the entrance fade plays on the first full load only, never on a Turbo visit",
        firstLoad.fx &&
            firstLoad.enter &&
            /fx-blur-in/.test(firstLoad.anim) &&
            settled.fx &&
            !settled.enter &&
            turboPage.marker === "stay" &&
            !turboPage.enter &&
            turboPage.anim === "none",
        { firstLoad, settled, turboPage, ex: drain() },
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
    await goto("/settings");
    await setMarker();
    const darkStart = await themeSnap();
    const darkStartMetas = await themeMetaSig();
    // Settings home's Display control: the choice posts and the 303 back to
    // the same page is a Turbo refresh, not a full load.
    await pickTheme("light");
    const afterLight = await themeSnap();
    const afterLightMetas = await themeMetaSig();
    const displayPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/display",
    );

    // Back from Settings home to the Today tab is a Turbo visit too.
    await clickSel(".fd-settings-detail a[aria-label='Back']");
    await sleep(400);
    const afterBack = await themeSnap();
    const backMetas = await themeMetaSig();
    const backPath = await ev<string>(`location.pathname`);
    record(
        "settings back to the tab is a Turbo visit that keeps the theme",
        backPath === "/" &&
            afterBack.marker === "stay" &&
            afterBack.dataTheme === "light" &&
            afterBack.bg === THEME_COLOR.light &&
            backMetas === expectedMetaSig("light"),
        { backPath, afterBack, backMetas, ex: drain() },
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

    // The account chip is the way into Settings from a tab: a Turbo visit.
    await setMarker();
    await clickSel(".fd-account-chip");
    await sleep(400);
    const afterGear = await themeSnap();
    const gearMetas = await themeMetaSig();
    const gearPath = await ev<string>(`location.pathname`);
    record(
        "settings gear is a Turbo visit from tab",
        gearPath === "/settings" &&
            afterGear.marker === "stay" &&
            afterGear.dataTheme === "light" &&
            afterGear.bg === THEME_COLOR.light &&
            gearMetas === expectedMetaSig("light"),
        { gearPath, afterGear, gearMetas, ex: drain() },
    );

    // Settings home's own Display control: Auto drops data-theme and brings
    // back the media-keyed metas, with no full load.
    await setMarker();
    await pickTheme("system");
    const afterSystem = await themeSnap();
    const systemMetas = await themeMetaSig();
    const systemPath = await ev<string>(`location.pathname`);

    await setMarker();
    await clickSel('main a[href="/settings/help"]');
    await sleep(300);
    const afterHelp = await themeSnap();
    const helpPath = await ev<string>(`location.pathname`);
    const helpMetas = await themeMetaSig();
    record(
        "settings help sub-nav turbo visit",
        helpPath === "/settings/help" &&
            afterHelp.marker === "stay" &&
            afterHelp.dataTheme === null &&
            afterHelp.meta === "system" &&
            helpMetas === expectedMetaSig("system"),
        { helpPath, afterHelp, helpMetas, ex: drain() },
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
            afterLight.marker === "stay" &&
            afterLight.dataTheme === "light" &&
            afterLight.meta === "light" &&
            afterLight.bg === THEME_COLOR.light &&
            afterLightMetas === expectedMetaSig("light") &&
            systemPath === "/settings" &&
            afterSystem.marker === "stay" &&
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
            const logFood = document.querySelector(".fd-top-bar a[data-fd-open-sheet]");
            return {
                visible: bells.length,
                unread: bells.filter((b) => b.classList.contains("fd-bell--unread")).length,
                dotWidth: dot ? Math.round(dot.getBoundingClientRect().width) : 0,
                inCluster: !!bell?.closest(".fd-cluster"),
                inTopBar: !!bell?.closest(".fd-top-bar"),
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
        const r = document.querySelector(".fd-top-bar .fd-bell").getBoundingClientRect();
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

    // Settings › Goals: a Turbo page whose numbers save themselves. A number
    // left with a new value posts alone (no document load, no toast) and the
    // focus stays where the person put it; a refused one stays as typed with
    // the refusal under that number. Day ⋯ clears in place (a confirm in the
    // menu, no sheet).
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings");
    await setMarker();
    await clickSel('a[href="/settings/goals"]');
    await sleep(500);
    // (a destructive item's confirm row is in the markup, hidden, after it)
    const goalsPage = await ev<{
        path: string;
        marker: string | null;
        title: string | null;
        optOuts: number;
        dialogs: number;
        rows: string[];
        dayMenu: string[];
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
        dialogs: document.querySelectorAll(".fd-settings dialog").length,
        rows: [...document.querySelectorAll(".fd-settings-content .fd-autosave-input__label")].map((e) => e.textContent),
        dayMenu: [...document.querySelectorAll(".fd-settings-content .fd-menu__panel .fd-menu__label")].map((e) => e.textContent),
    })`);
    await control("reset=posts");
    // Type a new calories value, then move to Protein: leaving the field saves.
    await ev(`(() => {
        const calories = document.getElementById("goals-daily-calories");
        calories.focus();
        calories.value = "2400";
        calories.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("goals-daily-protein-g").focus();
    })()`);
    await sleep(900);
    const goalPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/goals/field",
    );
    const afterGoal = await ev<{
        marker: string | null;
        focus: string | null;
        toasts: number;
        path: string;
    }>(`({
        marker: window.__marker ?? null,
        focus: document.activeElement?.id ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
        path: location.pathname,
    })`);
    // A refused value (the fixture answers 422 for 30000, as the route does for
    // anything out of bounds): the page stays, the typed text stays, the
    // refusal sits under that number.
    await ev(`(() => {
        const calories = document.getElementById("goals-daily-calories");
        calories.focus();
        calories.value = "30000";
        calories.dispatchEvent(new Event("input", { bubbles: true }));
        document.getElementById("goals-daily-protein-g").focus();
    })()`);
    await sleep(900);
    const refused = await ev<{
        marker: string | null;
        path: string;
        value: string | null;
        invalid: string | null;
        error: string | null;
        errorInRow: boolean;
        errors: number;
    }>(`(() => {
        const calories = document.getElementById("goals-daily-calories");
        const error = document.getElementById("goals-daily-calories-error");
        return {
            marker: window.__marker ?? null,
            path: location.pathname,
            value: calories?.value ?? null,
            invalid: calories?.getAttribute("aria-invalid") ?? null,
            error: error?.textContent ?? null,
            errorInRow: !!error && !!calories && error.closest("li") === calories.closest("li"),
            errors: document.querySelectorAll(".fd-autosave-input__error").length,
        };
    })()`);
    // The day's ⋯: Clear confirms in the menu and posts from there.
    await control("reset=posts");
    await goto("/settings/goals");
    await setMarker();
    await clickSel(".fd-settings-content .fd-menu [data-fd-menu-trigger]");
    await sleep(150);
    await clickSel(".fd-settings-content [data-fd-menu-arm]");
    await sleep(150);
    const clearConfirm = await ev<{ open: boolean; verbs: string[] }>(`({
        open: !document.querySelector(".fd-settings-content .fd-menu__confirm-row")?.hidden,
        verbs: [...document.querySelectorAll(".fd-settings-content .fd-menu__confirm-row .fd-menu__label")].map((e) => e.textContent),
    })`);
    await clickSel(
        '.fd-settings-content .fd-menu__confirm-row form[action="/settings/goals/days/clear"] button',
    );
    await sleep(600);
    const clearPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/goals/days/clear",
    );
    const afterClear = await ev<{ marker: string | null; toasts: number }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    // The header ⋯: Clear all goals confirms in the menu and posts from there.
    await control("reset=posts");
    await goto("/settings/goals");
    await setMarker();
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(150);
    await clickSel(".fd-settings-detail [data-fd-menu-arm]");
    await sleep(150);
    const clearAllConfirm = await ev<{ open: boolean; verbs: string[] }>(`({
        open: !document.querySelector(".fd-settings-detail .fd-menu__confirm-row")?.hidden,
        verbs: [...document.querySelectorAll(".fd-settings-detail .fd-menu__confirm-row .fd-menu__label")].map((e) => e.textContent),
    })`);
    await clickSel(
        '.fd-settings-detail .fd-menu__confirm-row form[action="/settings/goals/clear-all"] button',
    );
    await sleep(600);
    const clearAllPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/goals/clear-all",
    );
    const afterClearAll = await ev<{
        marker: string | null;
        toasts: number;
        path: string;
    }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
        path: location.pathname,
    })`);
    record(
        "Settings › Goals autosave: a Turbo page; a number left with a new value posts alone with no document load or toast and keeps the focus; a refused value keeps its text with the error under that number; a day's ⋯ clears it with a confirm in place; the header ⋯ has Clear all goals, confirmed in place, posting over Turbo with no toast",
        goalsPage.path === "/settings/goals" &&
            goalsPage.marker === "stay" &&
            goalsPage.title === "Goals" &&
            goalsPage.optOuts === 0 &&
            goalsPage.dialogs === 0 &&
            goalsPage.rows.slice(0, 4).join("|") ===
                "Calories|Protein|Carbs|Fat" &&
            goalsPage.dayMenu.join("|") === "Clear|Cancel|Clear" &&
            goalPosts.length === 1 &&
            goalPosts[0]!.entries.some(
                ([k, v]) => k === "field" && v === "daily_calories",
            ) &&
            goalPosts[0]!.entries.some(
                ([k, v]) => k === "value" && v === "2400",
            ) &&
            afterGoal.marker === "stay" &&
            afterGoal.focus === "goals-daily-protein-g" &&
            afterGoal.toasts === 0 &&
            afterGoal.path === "/settings/goals" &&
            refused.marker === "stay" &&
            refused.path === "/settings/goals" &&
            refused.value === "30000" &&
            refused.invalid === "true" &&
            refused.error === "Calories must be at most 20000." &&
            refused.errorInRow &&
            refused.errors === 1 &&
            clearConfirm.open &&
            clearConfirm.verbs.join("|") === "Cancel|Clear" &&
            clearPosts.length === 1 &&
            clearPosts[0]!.entries.some(
                ([k, v]) => k === "date" && v === "2026-11-14",
            ) &&
            afterClear.marker === "stay" &&
            afterClear.toasts === 0 &&
            clearAllConfirm.open &&
            clearAllConfirm.verbs.join("|") === "Cancel|Clear all goals" &&
            clearAllPosts.length === 1 &&
            afterClearAll.marker === "stay" &&
            afterClearAll.toasts === 0 &&
            afterClearAll.path === "/settings/goals",
        {
            goalsPage,
            goalPosts,
            afterGoal,
            refused,
            clearConfirm,
            clearPosts,
            afterClear,
            clearAllConfirm,
            clearAllPosts,
            afterClearAll,
            ex: drain(),
        },
    );

    // Settings › Units: a pull-down on each row, no sheet. A choice posts on
    // its own over Turbo and comes back to the page with no toast.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings");
    await setMarker();
    await clickSel('a[href="/settings/units"]');
    await sleep(500);
    const unitsPage = await ev<{
        path: string;
        marker: string | null;
        title: string | null;
        optOuts: number;
        dialogs: number;
        rows: string[];
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
        dialogs: document.querySelectorAll(".fd-settings dialog").length,
        rows: [...document.querySelectorAll(".fd-settings-content .fd-menu--row .fd-item-row__title")].map((e) => e.textContent),
    })`);
    await clickSel(".fd-settings-content .fd-menu--row [data-fd-menu-trigger]");
    await sleep(150);
    const unitsMenu = await ev<{ open: boolean; choices: string[] }>(`({
        open: !document.querySelector(".fd-settings-content .fd-menu--row .fd-menu__panel")?.hidden,
        choices: [...document.querySelectorAll(".fd-settings-content .fd-menu--row .fd-menu__panel .fd-menu__label")].slice(0, 3).map((e) => e.textContent),
    })`);
    await ev(
        `[...document.querySelectorAll(".fd-settings-content .fd-menu--row .fd-menu__panel button")].find((b) => b.textContent.trim() === "kg").click()`,
    );
    await sleep(600);
    const unitPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/units",
    );
    const afterUnits = await ev<{
        marker: string | null;
        path: string;
        toasts: number;
    }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    record(
        "Settings › Units: a Turbo page with a pull-down on Weight and Drinks and no sheet; choosing a unit posts it alone over Turbo with no toast",
        unitsPage.path === "/settings/units" &&
            unitsPage.marker === "stay" &&
            unitsPage.title === "Units" &&
            unitsPage.optOuts === 0 &&
            unitsPage.dialogs === 0 &&
            unitsPage.rows.join("|") === "Weight|Drinks" &&
            unitsMenu.open &&
            unitsMenu.choices.join("|") === "Not set|kg|lb" &&
            unitPosts.length === 1 &&
            unitPosts[0]!.entries.some(
                ([k, v]) => k === "preferred_weight_unit" && v === "kg",
            ) &&
            afterUnits.marker === "stay" &&
            afterUnits.path === "/settings/units" &&
            afterUnits.toasts === 0,
        { unitsPage, unitsMenu, unitPosts, afterUnits, ex: drain() },
    );

    // Settings › Nutrients shown: each switch posts alone over Turbo.
    await control("reset=posts");
    await goto("/settings");
    await setMarker();
    await clickSel('a[href="/settings/nutrients"]');
    await sleep(500);
    await clickSel('.fd-settings-content button[aria-label="Sugar"]');
    await sleep(600);
    const nutrientPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/nutrients",
    );
    const afterNutrients = await ev<{
        marker: string | null;
        path: string;
        title: string | null;
        optOuts: number;
        toasts: number;
    }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    record(
        "Settings › Nutrients shown: a switch posts alone over Turbo and comes back to the page with no toast",
        afterNutrients.path === "/settings/nutrients" &&
            afterNutrients.marker === "stay" &&
            afterNutrients.title === "Nutrients shown" &&
            afterNutrients.optOuts === 0 &&
            afterNutrients.toasts === 0 &&
            nutrientPosts.length === 1 &&
            nutrientPosts[0]!.entries.some(
                ([k, v]) => k === "nutrient" && v === "sugar",
            ) &&
            nutrientPosts[0]!.entries.some(
                ([k, v]) => k === "shown" && v === "0",
            ),
        { nutrientPosts, afterNutrients, ex: drain() },
    );

    // Settings › AI connections: no form opts out of Turbo and there is no
    // sheet. An app's ⋯ confirms Disconnect in place; the switches and a
    // change's ⋯ Undo post over Turbo, each back to the page with no toast.
    await control("reset=posts");
    await goto("/settings");
    await setMarker();
    await clickSel('a[href="/settings/ai-connections"]');
    await sleep(500);
    const aiPage = await ev<{
        path: string;
        marker: string | null;
        title: string | null;
        optOuts: number;
        dialogs: number;
        apps: number;
        switches: string[];
    }>(`({
        path: location.pathname,
        marker: window.__marker ?? null,
        title: document.querySelector("h1")?.textContent?.trim() ?? null,
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
        dialogs: document.querySelectorAll(".fd-settings dialog").length,
        apps: document.querySelectorAll('.fd-settings-content ul[aria-label="Connected apps"] > li').length,
        switches: [...document.querySelectorAll('.fd-settings-content [data-fd-ai-agents] [role="switch"], .fd-settings-content [data-fd-ai-household] [role="switch"]')].map((e) => e.getAttribute("aria-label")),
    })`);
    await clickSel(
        '.fd-settings-content ul[aria-label="Connected apps"] .fd-menu [data-fd-menu-trigger]',
    );
    await sleep(150);
    await clickSel(".fd-settings-content [data-fd-menu-arm]");
    await sleep(150);
    const disconnectConfirm = await ev<{ open: boolean; verbs: string[] }>(`({
        open: !document.querySelector(".fd-settings-content .fd-menu__confirm-row")?.hidden,
        verbs: [...document.querySelectorAll('.fd-settings-content ul[aria-label="Connected apps"] > li:first-child .fd-menu__confirm-row .fd-menu__label')].map((e) => e.textContent),
    })`);
    await clickSel(
        '.fd-settings-content .fd-menu__confirm-row form[action="/settings/ai-connections/disconnect"] button',
    );
    await sleep(600);
    const disconnectPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/ai-connections/disconnect",
    );
    const afterDisconnect = await ev<{
        marker: string | null;
        path: string;
        toasts: number;
    }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    await control("reset=posts");
    await clickSel(
        '.fd-settings-content button[aria-label="Your agents can delete"]',
    );
    await sleep(500);
    await clickSel(
        '.fd-settings-content button[aria-label="Any agent can delete"]',
    );
    await sleep(500);
    await clickSel(
        ".fd-settings-content [data-fd-ai-activity] .fd-menu [data-fd-menu-trigger]",
    );
    await sleep(150);
    await clickSel(
        '.fd-settings-content [data-fd-ai-activity] .fd-menu form[action$="/undo"] button',
    );
    await sleep(600);
    const aiPosts = (await stats()).posts.map((p) => p.path);
    const afterAi = await ev<{
        marker: string | null;
        path: string;
        toasts: number;
    }>(`({
        marker: window.__marker ?? null,
        path: location.pathname,
        toasts: document.querySelectorAll(".toast-item").length,
    })`);
    record(
        "Settings › AI connections: a Turbo page with no opt-out and no sheet; an app's ⋯ confirms Disconnect in place; the agent switches and a change's Undo post over Turbo with no toast",
        aiPage.path === "/settings/ai-connections" &&
            aiPage.marker === "stay" &&
            aiPage.title === "AI connections" &&
            aiPage.optOuts === 0 &&
            aiPage.dialogs === 0 &&
            aiPage.apps === 4 &&
            aiPage.switches.join("|") ===
                "Show cards in chat|Your agents can delete|Any agent can delete" &&
            disconnectConfirm.open &&
            disconnectConfirm.verbs.join("|") === "Cancel|Disconnect" &&
            disconnectPosts.length === 1 &&
            disconnectPosts[0]!.entries.some(
                ([k, v]) =>
                    k === "client" &&
                    v === "7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f",
            ) &&
            afterDisconnect.marker === "stay" &&
            afterDisconnect.path === "/settings/ai-connections" &&
            afterDisconnect.toasts === 0 &&
            aiPosts.length === 3 &&
            aiPosts[0] === "/settings/ai-connections/agent-delete" &&
            aiPosts[1] === "/settings/ai-connections/destructive" &&
            aiPosts[2]!.startsWith("/settings/ai-connections/actions/") &&
            aiPosts[2]!.endsWith("/undo") &&
            afterAi.marker === "stay" &&
            afterAi.path === "/settings/ai-connections" &&
            afterAi.toasts === 0,
        {
            aiPage,
            disconnectConfirm,
            disconnectPosts,
            afterDisconnect,
            aiPosts,
            afterAi,
            ex: drain(),
        },
    );

    // An app's ⋯ › Changes narrows Recent changes to that app over a Turbo
    // visit that lands on the section; Show all brings every change back.
    await control("reset=posts");
    await goto("/settings/ai-connections");
    await setMarker();
    await clickSel(
        '.fd-settings-content ul[aria-label="Connected apps"] > li:first-child .fd-menu [data-fd-menu-trigger]',
    );
    await sleep(150);
    await clickSel(
        '.fd-settings-content ul[aria-label="Connected apps"] > li:first-child .fd-menu a[href^="/settings/ai-connections?app="]',
    );
    await sleep(600);
    const changesState = `({
        marker: window.__marker ?? null,
        href: location.pathname + location.search + location.hash,
        rows: document.querySelectorAll("[data-fd-ai-activity] > li").length,
        showAll: document.querySelector("#recent-changes .fd-section-header__action")?.textContent?.trim() ?? null,
        scope: document.querySelector(".fd-settings-ai__scope")?.textContent ?? null,
        sideways: document.documentElement.scrollWidth > window.innerWidth,
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
    })`;
    const changesOn = await ev<{
        marker: string | null;
        href: string;
        rows: number;
        showAll: string | null;
        scope: string | null;
        sideways: boolean;
        optOuts: number;
    }>(changesState);
    await clickSel("#recent-changes .fd-section-header__action");
    await sleep(600);
    const changesOff = await ev<{
        marker: string | null;
        href: string;
        rows: number;
        showAll: string | null;
        scope: string | null;
        sideways: boolean;
        optOuts: number;
    }>(changesState);
    record(
        "Settings › AI connections: an app's ⋯ › Changes narrows Recent changes to it over a Turbo visit that lands on the section, and Show all brings every change back",
        changesOn.marker === "stay" &&
            changesOn.href ===
                "/settings/ai-connections?app=7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f#recent-changes" &&
            changesOn.rows === 1 &&
            changesOn.showAll === "Show all" &&
            changesOn.scope === "Changes by Claude among the latest 50" &&
            !changesOn.sideways &&
            changesOn.optOuts === 0 &&
            changesOff.marker === "stay" &&
            changesOff.href === "/settings/ai-connections#recent-changes" &&
            changesOff.rows === 2 &&
            changesOff.showAll === null &&
            changesOff.scope === null,
        { changesOn, changesOff, ex: drain() },
    );

    // Settings › Help: the search field is a GET that Turbo follows in place.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/help");
    await setMarker();
    const helpBefore = await ev<number>(
        `document.querySelectorAll(".fd-item-row__disclosure").length`,
    );
    await ev(`(() => {
        const input = document.querySelector('.fd-settings-help-search input[name="q"]');
        input.value = "zip";
        input.form.requestSubmit();
    })()`);
    await sleep(600);
    const helpSearch = await ev<{
        marker: string | null;
        href: string;
        rows: number;
        typed: string | null;
        optOuts: number;
    }>(`({
        marker: window.__marker ?? null,
        href: location.pathname + location.search,
        rows: document.querySelectorAll(".fd-item-row__disclosure").length,
        typed: document.querySelector('.fd-settings-help-search input[name="q"]')?.value ?? null,
        optOuts: document.querySelectorAll('.fd-settings [data-turbo="false"]').length,
    })`);
    record(
        "Settings › Help: searching lists the matching topics over a Turbo visit, with the typed words kept in the field",
        helpBefore > 5 &&
            helpSearch.marker === "stay" &&
            helpSearch.href === "/settings/help?q=zip" &&
            helpSearch.rows >= 1 &&
            helpSearch.rows < helpBefore &&
            helpSearch.typed === "zip" &&
            helpSearch.optOuts === 0,
        { helpBefore, helpSearch, ex: drain() },
    );

    // Settings › Saved foods & recipes: Select lives in the Detail bar's ⋯ and
    // starts select mode from there (the menu closes, the row ⋯ steps aside);
    // a food's ⋯ has Edit, Merge and Delete, and Edit and Merge open the one
    // shared sheet filled for that food; saving posts every field of the sheet.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/saved");
    await setMarker();
    await clickSel(".fd-settings-detail [data-fd-menu-trigger]");
    await sleep(150);
    const barItems = await ev<string[]>(
        `[...document.querySelectorAll(".fd-settings-detail .fd-menu__panel .fd-menu__label")].map((e) => e.textContent)`,
    );
    await clickSel(".fd-settings-detail [data-fd-select-toggle]");
    await sleep(200);
    const selecting = await ev<{
        on: boolean;
        barShown: boolean;
        menuClosed: boolean;
        rowMenuShown: boolean;
        picks: number;
    }>(`({
        on: !!document.querySelector("[data-fd-select][data-fd-selecting]"),
        barShown: !document.querySelector("[data-fd-select-bar]")?.hidden,
        menuClosed: document.querySelector(".fd-settings-detail .fd-menu__panel")?.hidden === true,
        rowMenuShown: [...document.querySelectorAll(".fd-saved-row .fd-item-row__control")].some((e) => getComputedStyle(e).display !== "none"),
        picks: document.querySelectorAll("input[data-fd-select-item]").length,
    })`);
    await clickSel("[data-fd-select-cancel]");
    await sleep(200);
    const cancelled = await ev<{ on: boolean; focus: boolean }>(`({
        on: !!document.querySelector("[data-fd-select][data-fd-selecting]"),
        focus: !!document.activeElement?.closest(".fd-settings-detail [data-fd-menu]"),
    })`);
    // Edit: the row's ⋯, then Edit; the shared sheet holds that food.
    const rowMenu =
        '.fd-saved-row:has([name="food_ids[]"][value="f-eggs"]) [data-fd-menu]';
    await clickSel(`${rowMenu} [data-fd-menu-trigger]`);
    await sleep(150);
    const foodItems = await ev<string[]>(
        `[...document.querySelectorAll('.fd-saved-row:has([name="food_ids[]"][value="f-eggs"]) .fd-menu__panel .fd-menu__label')].map((e) => e.textContent)`,
    );
    await clickSel(`${rowMenu} [commandfor="fd-saved-edit"]`);
    await sleep(300);
    const editSheet = await ev<{
        open: boolean;
        action: string | null;
        name: string | null;
        calories: string | null;
        egg: boolean;
        milk: boolean;
    }>(`(() => {
        const d = document.getElementById("fd-saved-edit");
        const f = d.querySelector("form");
        return {
            open: d.open,
            action: f.getAttribute("action"),
            name: f.elements["name"].value,
            calories: f.elements["calories"].value,
            egg: f.querySelector('input[name="allergens"][value="egg"]').checked,
            milk: f.querySelector('input[name="allergens"][value="milk"]').checked,
        };
    })()`);
    await ev(`(() => {
        const f = document.querySelector("#fd-saved-edit form");
        f.elements["name"].value = "Large eggs";
    })()`);
    await control("reset=posts");
    await clickSel('#fd-saved-edit button[type="submit"][form]');
    await sleep(700);
    const editPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/household/items/f-eggs",
    );
    const afterEdit = await ev<{ marker: string | null; open: number }>(`({
        marker: window.__marker ?? null,
        open: document.querySelectorAll("dialog[open]").length,
    })`);
    // Merge: the same kind of item, the other shared sheet, filled with the food.
    await clickSel(
        '.fd-saved-row:has([name="food_ids[]"][value="f-milk"]) [data-fd-menu-trigger]',
    );
    await sleep(150);
    await clickSel(
        '.fd-saved-row:has([name="food_ids[]"][value="f-milk"]) [commandfor="foods-merge"]',
    );
    await sleep(300);
    const mergeSheet = await ev<{
        open: boolean;
        drop: string | null;
        keep: string | null;
        dropHidden: boolean;
    }>(`({
        open: document.getElementById("foods-merge").open,
        drop: document.querySelector('#foods-merge input[name="drop_id"]').value,
        keep: document.querySelector('#foods-merge input[name="keep_id"]:checked')?.value ?? null,
        dropHidden: !!document.querySelector('#foods-merge input[name="keep_id"][value="f-milk"]')?.closest("li")?.hidden,
    })`);
    record(
        "Settings › Saved foods & recipes: Select in the Detail bar's ⋯ starts select mode (menu closed, row ⋯ out of the way) and Cancel puts focus back on the ⋯; a food's ⋯ is Edit, Merge, Delete; Edit and Merge open one shared sheet filled for that food, and Save posts every field, over Turbo",
        barItems.join("|") === "Select" &&
            selecting.on &&
            selecting.barShown &&
            selecting.menuClosed &&
            !selecting.rowMenuShown &&
            selecting.picks === 2 &&
            !cancelled.on &&
            cancelled.focus &&
            foodItems.join("|") === "Edit|Merge|Delete|Cancel|Delete" &&
            editSheet.open &&
            editSheet.action === "/settings/household/items/f-eggs" &&
            editSheet.name === "Eggs" &&
            editSheet.calories === "155" &&
            editSheet.egg &&
            !editSheet.milk &&
            editPosts.length === 1 &&
            editPosts[0]!.entries.some(
                ([k, v]) => k === "name" && v === "Large eggs",
            ) &&
            editPosts[0]!.entries.some(
                ([k, v]) => k === "allergens" && v === "egg",
            ) &&
            editPosts[0]!.entries.some(
                ([k, v]) => k === "archived" && v === "0",
            ) &&
            afterEdit.marker === "stay" &&
            afterEdit.open === 0 &&
            mergeSheet.open &&
            mergeSheet.drop === "f-milk" &&
            mergeSheet.keep === null &&
            mergeSheet.dropHidden,
        {
            barItems,
            selecting,
            cancelled,
            foodItems,
            editSheet,
            editPosts,
            afterEdit,
            mergeSheet,
            ex: drain(),
        },
    );

    // Settings › Product score: the preset chips save themselves; a weight is a
    // pull-down on its row that saves the whole choice as Custom.
    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings/product-score");
    await setMarker();
    await ev(
        `document.querySelector('input[name="preset"][value="planet"]').click()`,
    );
    await sleep(800);
    const presetPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/product-score",
    );
    await control("reset=posts");
    await clickSel(
        '[aria-label="Nutrition weight"] [data-fd-menu-trigger], .fd-menu--row:has([aria-label="Nutrition weight"]) [data-fd-menu-trigger]',
    );
    await sleep(150);
    const weightMenu = await ev<{ open: boolean; items: number }>(`(() => {
        const panel = document.querySelector('.fd-menu__panel[aria-label="Nutrition weight"]');
        return { open: !panel.hidden, items: panel.querySelectorAll('[role="menuitemcheckbox"]').length };
    })()`);
    await clickSel(
        '.fd-menu__panel[aria-label="Nutrition weight"] form:has(input[name="weight_nutrition"][value="60"]) button',
    );
    await sleep(700);
    const weightPosts = (await stats()).posts.filter(
        (p) => p.path === "/settings/product-score",
    );
    const afterScore = await ev<{
        marker: string | null;
        toasts: number;
        path: string;
    }>(`({
        marker: window.__marker ?? null,
        toasts: document.querySelectorAll(".toast-item").length,
        path: location.pathname,
    })`);
    record(
        "Settings › Product score autosave: picking a preset chip saves the choice, a weight's pull-down saves Custom with that weight, each as a Turbo form post with no document load or toast",
        presetPosts.length === 1 &&
            presetPosts[0]!.entries.some(
                ([k, v]) => k === "preset" && v === "planet",
            ) &&
            presetPosts[0]!.entries.some(
                ([k, v]) => k === "intent" && v === "choice",
            ) &&
            weightMenu.open &&
            weightMenu.items === 11 &&
            weightPosts.length === 1 &&
            weightPosts[0]!.entries.some(
                ([k, v]) => k === "preset" && v === "custom",
            ) &&
            weightPosts[0]!.entries.some(
                ([k, v]) => k === "weight_nutrition" && v === "60",
            ) &&
            afterScore.marker === "stay" &&
            afterScore.toasts === 0 &&
            afterScore.path === "/settings/product-score",
        { presetPosts, weightMenu, weightPosts, afterScore, ex: drain() },
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
