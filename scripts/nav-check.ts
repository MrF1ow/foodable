/**
 * Headless browser check for Turbo-driven in-app navigation (P8).
 * Starts the fixture server, drives Chromium over CDP, exits non-zero on failure.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";

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
    "bun",
    ["run", join(import.meta.dir, "nav-check-fixture.ts")],
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
    CHROME,
    [
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
        active: document.querySelector("nav.bottom-nav a[aria-current='page']")?.getAttribute("aria-label") ?? null,
        scrollY: Math.round(window.scrollY || 0),
        bodyPos: document.body ? (document.body.style.position || "") : "",
        open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
        error: document.querySelector("#p8-error")?.textContent ?? null,
        auth: !!document.querySelector("form.auth-form"),
    }))()`);
}
async function clickSel(sel: string) {
    await ev(
        `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); })()`,
    );
}
async function setMarker() {
    await ev(`window.__marker = "stay"`);
}
async function prepScroll() {
    await ev(`window.scrollTo(0, 900)`);
    await sleep(50);
}

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
    width: 430,
    height: 800,
    deviceScaleFactor: 1,
    mobile: true,
});

try {
    await goto("/");
    await setMarker();
    await prepScroll();
    await clickSel('nav.bottom-nav a[href="/fridge"]');
    await sleep(200);
    const fridge = await snap();
    await clickSel('nav.bottom-nav a[href="/recipes"]');
    await sleep(200);
    await setMarker();
    await clickSel('a[href="/recipes/r1"]');
    await sleep(200);
    const recipe = await snap();
    await goto("/recipes");
    await setMarker();
    await ev(`(() => {
        const form = document.querySelector("form.recipe-list-filters");
        const tag = form.querySelector("input[name='tag']");
        tag.value = "dinner";
        form.querySelector("button[type='submit']").click();
    })()`);
    await sleep(250);
    const filtered = await snap();
    await goto("/");
    await setMarker();
    await clickSel('a[href="/?member=u2"]');
    await sleep(200);
    const member = await snap();
    await goto("/fridge");
    await setMarker();
    await prepScroll();
    const yFridge = (await snap()).scrollY;
    await clickSel('nav.bottom-nav a[href="/grocery"]');
    await sleep(150);
    await ev(`history.back()`);
    await sleep(250);
    const back = await snap();
    record(
        "nav, recipe link, member switch, GET filter, back+scroll",
        fridge.marker === "stay" &&
            fridge.active === "Fridge" &&
            /fridge/i.test(fridge.h1 || "") &&
            recipe.marker === "stay" &&
            /shakshuka/i.test(recipe.h1 || "") &&
            filtered.marker === "stay" &&
            filtered.href.includes("tag=dinner") &&
            member.marker === "stay" &&
            member.href.includes("member=u2") &&
            back.marker === "stay" &&
            back.href.endsWith("/fridge") &&
            Math.abs(back.scrollY - yFridge) < 80,
        { fridge, recipe, filtered, member, back, yFridge, ex: drain() },
    );

    await control("post=ok&delay=0&reset=posts&modal=");
    await goto("/fridge");
    await setMarker();
    await prepScroll();
    const yDel = (await snap()).scrollY;
    await clickSel('button[aria-label="Delete Expired milk"]');
    await sleep(40);
    await clickSel("dialog[open] button.btn-danger");
    await sleep(1200);
    const afterDel = await snap();
    const postsDel = await stats();
    const delPosts = postsDel.posts.filter((p) => p.path.includes("/delete"));
    const itemAfter = await ev<number>(
        `document.querySelectorAll('li.fridge-item[data-item-id="i1"]').length`,
    );
    record(
        "fridge delete confirm",
        afterDel.marker === "stay" &&
            delPosts.length === 1 &&
            afterDel.open.length === 0 &&
            afterDel.bodyPos === "" &&
            Math.abs(afterDel.scrollY - yDel) < 80 &&
            itemAfter === 0,
        {
            afterDel,
            yDel,
            itemAfter,
            delPosts: delPosts.map((p) => p.path),
            ex: drain(),
        },
    );

    await goto("/fridge");
    await setMarker();
    await control("post=fail&modal=fridge-add-location&reset=posts&delay=0");
    await clickSel('button[commandfor="fridge-add-location"]');
    await sleep(40);
    await ev(`(() => {
        const name = document.querySelector("#fridge-add-location input[name='name']");
        if (name) { name.removeAttribute("required"); name.value = ""; }
    })()`);
    await clickSel("#fridge-add-location button[type='submit']");
    await sleep(500);
    const addLoc = await snap();
    record(
        "add location empty name 400",
        addLoc.marker === "stay" &&
            addLoc.href.endsWith("/fridge") &&
            addLoc.open.includes("fridge-add-location") &&
            addLoc.error === "Name is required",
        { addLoc, ex: drain() },
    );

    await goto("/grocery");
    await control("post=ok&reset=posts");
    await clickSel('button[commandfor="grocery-add-food-s1"]');
    await sleep(40);
    await clickSel(
        '#grocery-add-food-s1 button[role="tab"][data-tab="manual"]',
    );
    await sleep(30);
    await ev(`(() => {
        const sel = document.querySelector("#grocery-add-food-s1 [data-grocery-section]");
        if (sel) {
            sel.value = "sec1";
            sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const name = document.querySelector("#grocery-add-food-s1 .food-picker-manual input[name='food_name']");
        const amt = document.querySelector("#grocery-add-food-s1 .food-picker-manual input[name='qty_amount']");
        if (name) name.value = "Kale";
        if (amt) amt.value = "2";
    })()`);
    await clickSel(
        "#grocery-add-food-s1 .food-picker-manual button[type='submit']",
    );
    await sleep(400);
    const groceryPosts = await stats();
    const linePost = groceryPosts.posts.find(
        (p) => p.path === "/grocery/lines",
    );
    record(
        "grocery add with Produce section_id",
        !!linePost &&
            linePost.entries.some(
                ([k, v]) => k === "section_id" && v === "sec1",
            ),
        { entries: linePost?.entries ?? [], ex: drain() },
    );

    await goto("/grocery");
    await control("post=ok&reset=posts");
    await clickSel('button[commandfor="grocery-add-food-s1"]');
    await sleep(40);
    await clickSel(
        '#grocery-add-food-s1 button[role="tab"][data-tab="manual"]',
    );
    await sleep(30);
    await ev(`(() => {
        const sel = document.querySelector("#grocery-add-food-s1 [data-grocery-section]");
        if (sel) {
            sel.value = "sec1";
            sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const name = document.querySelector("#grocery-add-food-s1 .food-picker-manual input[name='food_name']");
        const amt = document.querySelector("#grocery-add-food-s1 .food-picker-manual input[name='qty_amount']");
        if (name) name.value = "Carrots";
        if (amt) amt.value = "3";
    })()`);
    await clickSel(
        "#grocery-add-food-s1 .food-picker-manual button[type='submit']",
    );
    await sleep(500);
    await clickSel('button[commandfor="grocery-add-food-s1"]');
    await sleep(40);
    await clickSel(
        '#grocery-add-food-s1 button[role="tab"][data-tab="manual"]',
    );
    await sleep(30);
    await ev(`(() => {
        const sel = document.querySelector("#grocery-add-food-s1 [data-grocery-section]");
        if (sel) {
            sel.value = "sec1";
            sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const name = document.querySelector("#grocery-add-food-s1 .food-picker-manual input[name='food_name']");
        const amt = document.querySelector("#grocery-add-food-s1 .food-picker-manual input[name='qty_amount']");
        if (name) name.value = "Celery";
        if (amt) amt.value = "2";
    })()`);
    await clickSel(
        "#grocery-add-food-s1 .food-picker-manual button[type='submit']",
    );
    await sleep(500);
    const groceryPosts2 = await stats();
    const linePosts = groceryPosts2.posts.filter(
        (p) => p.path === "/grocery/lines",
    );
    record(
        "grocery two adds after morph both carry section_id",
        linePosts.length >= 2 &&
            linePosts.every((p) =>
                p.entries.some(([k, v]) => k === "section_id" && v === "sec1"),
            ),
        { linePosts: linePosts.map((p) => p.entries), ex: drain() },
    );

    await goto("/");
    await clickSel('nav.bottom-nav a[href="/fridge"]');
    await sleep(200);
    await clickSel('nav.bottom-nav a[href="/"]');
    await sleep(200);
    const orderBefore = await ev<string[]>(
        `[...document.querySelectorAll("#nutrition-arrange .arrange-row")].map(r => r.getAttribute("data-card"))`,
    );
    await clickSel('button[commandfor="nutrition-arrange"]');
    await sleep(50);
    await clickSel("#nutrition-arrange .arrange-row .arrange-down");
    const orderAfter = await ev<string[]>(
        `[...document.querySelectorAll("#nutrition-arrange .arrange-row")].map(r => r.getAttribute("data-card"))`,
    );
    await control("reset=posts");
    await clickSel(
        "form.nutrition-arrange-form button.btn-primary[type='submit']",
    );
    await sleep(600);
    const layoutPosts = await stats();
    const layoutPost = layoutPosts.posts.find(
        (p) => p.path === "/nutrition/layout",
    );
    const orderFields =
        layoutPost?.entries.filter(([k]) => k === "order") ?? [];
    const movedOnce =
        orderAfter[0] === orderBefore[1] &&
        orderAfter[1] === orderBefore[0] &&
        orderAfter[2] === orderBefore[2];
    record(
        "arrange after two nutrition visits",
        movedOnce &&
            layoutPost !== undefined &&
            orderFields.length === orderBefore.length,
        { orderBefore, orderAfter, orderFields, ex: drain() },
    );

    await control("post=fail&modal=nutrition-log-meal&reset=posts&delay=0");
    await goto("/");
    await setMarker();
    const hrefBeforeMeal = (await snap()).href;
    await clickSel('button[commandfor="nutrition-log-meal"]');
    await sleep(40);
    await clickSel("#nutrition-log-meal button[type='submit']");
    await sleep(500);
    const badMeal = await snap();
    record(
        "nutrition log meal invalid 400",
        badMeal.marker === "stay" &&
            badMeal.href === hrefBeforeMeal &&
            badMeal.open.includes("nutrition-log-meal") &&
            badMeal.error === "Name is required",
        { badMeal, hrefBeforeMeal, ex: drain() },
    );

    await control("post=ok&reset=posts&delay=0");
    await goto("/");
    await setMarker();
    await clickSel('button[commandfor="nutrition-log-water"]');
    await sleep(40);
    await ev(`(() => {
        const input = document.querySelector("#nutrition-log-water input[name='amount_ml']");
        if (input) input.value = "250";
    })()`);
    await clickSel("#nutrition-log-water button[type='submit']");
    await sleep(500);
    const okWater = await snap();
    record(
        "nutrition log water valid 303",
        okWater.marker === "stay" &&
            okWater.open.length === 0 &&
            okWater.href.endsWith("/"),
        { okWater, ex: drain() },
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

    await goto("/fridge");
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
        `!!document.querySelector("nav.bottom-nav")`,
    );
    record(
        "expired session GET login full reload",
        expiredGet.auth === true && expiredGet.marker == null && !hasAppNavGet,
        { expiredGet, hasAppNavGet, ex: drain() },
    );

    await goto("/fridge");
    await setMarker();
    await control("post=login&reset=posts&session=guest");
    await clickSel('button[aria-label="Delete Expired milk"]');
    await sleep(40);
    await clickSel("dialog[open] button.btn-danger");
    await sleep(1500);
    const expiredPost = await snap();
    const hasAppNavPost = await ev<boolean>(
        `!!document.querySelector("nav.bottom-nav")`,
    );
    record(
        "expired session POST login full reload",
        expiredPost.auth === true &&
            expiredPost.marker == null &&
            !hasAppNavPost &&
            expiredPost.open.length === 0,
        { expiredPost, hasAppNavPost, ex: drain() },
    );

    await goto("/login-test");
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

    await control("session=app");
    await goto("/fridge");
    await setMarker();
    await clickSel('a[href="/logout"]');
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
