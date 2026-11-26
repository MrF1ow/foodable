/**
 * Headless browser check for Turbo-driven in-app navigation (P8): the shell on
 * a phone and on a desktop, session expiry, the legacy redirects and theme
 * sync across Turbo visits and full loads.
 * Starts the fixture server, drives Chromium over CDP, exits non-zero on failure.
 */
import { spawn } from "bun";
import { join } from "node:path";
import { THEME_COLOR } from "../src/tokens.js";
import { LEAN_CHROMIUM_FLAGS } from "./app-preview-shots.js";

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
        ...LEAN_CHROMIUM_FLAGS,
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
// The profile is kept between runs: with the cache on, it served an older
// /app-v2.css under the current ?v= and failed a layout check that passed in
// a fresh browser. Every run loads what the fixture serves now.
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
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

    // ---- Sign in, the gates and the public share pages, at 390 and 1440 ----
    // Each is the Brand hero and one column (or the share page's own), never
    // wider than the screen, and the sign-in form keeps its fields.
    await control("session=app&theme=dark&reset=posts&post=ok");
    const authFacts = (width: number) =>
        ev<{
            fits: boolean;
            hero: boolean;
            tagline: string | null;
            fields: string[];
            boxes: { h: number; w: number; fitsScreen: boolean }[];
            button: { h: number; w: number; text: string | null } | null;
            btns: { h: number; w: number }[];
            errorBetween: boolean;
            errors: number;
            action: string | null;
            hidden: string | null;
            complete: string[];
            minlength: number;
            bar: boolean;
            h1: string[];
        }>(`(() => {
            const form = document.querySelector("form.auth-form") ?? document.querySelector(".fd-auth__form");
            const btn = document.querySelector(".fd-auth .fd-btn--primary");
            const err = document.querySelector(".fd-auth__error");
            const last = [...document.querySelectorAll(".fd-field")].pop();
            const rect = (e) => e.getBoundingClientRect();
            return {
                fits: document.documentElement.scrollWidth <= ${width} + 1,
                hero: !!document.querySelector(".fd-auth > .fd-brand-hero"),
                tagline: document.querySelector(".fd-brand-hero__tagline")?.textContent ?? null,
                fields: [...document.querySelectorAll(".fd-field__input")].map((i) => i.name),
                boxes: [...document.querySelectorAll(".fd-field__box")].map((b) => ({ h: Math.round(rect(b).height), w: Math.round(rect(b).width), fitsScreen: rect(b).left >= 0 && rect(b).right <= ${width} })),
                button: btn ? { h: Math.round(rect(btn).height), w: Math.round(rect(btn).width), text: btn.textContent.trim() } : null,
                btns: [...document.querySelectorAll(".fd-auth .fd-btn")].map((b) => ({ h: Math.round(rect(b).height), w: Math.round(rect(b).width) })),
                errorBetween: !!err && !!last && !!btn && !!(last.compareDocumentPosition(err) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(err.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
                errors: document.querySelectorAll(".fd-auth__error").length,
                action: form?.getAttribute("action") ?? null,
                hidden: form?.querySelector("input[type=hidden][name=session_id]")?.value ?? null,
                complete: [...document.querySelectorAll(".fd-auth__form input:not([type=hidden])")].map((i) => i.getAttribute("autocomplete")),
                minlength: document.querySelectorAll("input[minlength]").length,
                bar: !!document.querySelector(".app-bar, .fd-tabs, .fd-sidebar, .fd-bell"),
                h1: [...document.querySelectorAll("h1")].map((h) => h.textContent),
            };
        })()`);
    for (const width of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 600 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: false,
        });
        const column = Math.min(350, width - 40);
        const signIn = [] as Awaited<ReturnType<typeof authFacts>>[];
        for (const state of ["default", "invite", "connect", "error"]) {
            await goto(`/login-test?state=${state}`);
            await sleep(300);
            signIn.push(await authFacts(width));
        }
        const [plain, invite, connect, wrong] = signIn as [
            (typeof signIn)[number],
            (typeof signIn)[number],
            (typeof signIn)[number],
            (typeof signIn)[number],
        ];
        const everyBoxFits = (f: typeof plain) =>
            f.boxes.every((b) => b.h === 48 && b.w === column && b.fitsScreen);
        record(
            `sign in at ${width}: the Brand hero, an email and a password box and Continue, the invite state adds a code box, the connect state names who signs in, a wrong password is said in place; never wider than the screen`,
            signIn.every((f) => f.fits && f.hero && !f.bar) &&
                signIn.every(
                    (f) =>
                        f.action === "/approve" &&
                        f.hidden === "sess-p8" &&
                        f.minlength === 0,
                ) &&
                signIn.every(everyBoxFits) &&
                signIn.every(
                    (f) =>
                        f.button?.h === 48 &&
                        f.button.w === column &&
                        f.button.text === "Continue",
                ) &&
                plain.fields.join() === "email,password" &&
                plain.complete.join() === "username,current-password" &&
                plain.tagline === "Your household's kitchen, in one place." &&
                plain.errors === 0 &&
                invite.fields.join() === "email,password,invite_code" &&
                invite.complete.join() === "username,current-password,off" &&
                connect.tagline === "Sign in to connect claude.ai" &&
                connect.errors === 0 &&
                wrong.errors === 1 &&
                wrong.errorBetween &&
                wrong.fields.join() === "email,password" &&
                signIn.every((f) => f.h1.join() === "Sign in"),
            { width, signIn, ex: drain() },
        );

        const gates = [] as {
            path: string;
            facts: Awaited<ReturnType<typeof authFacts>>;
            links: string[];
            texts: string[];
        }[];
        for (const path of [
            "/create-household",
            "/gate-forbidden",
            "/gate-not-allowed",
            "/gate-not-found",
        ]) {
            await goto(path);
            await sleep(300);
            gates.push({
                path,
                facts: await authFacts(width),
                links: await ev<string[]>(
                    `[...document.querySelectorAll(".fd-auth a.fd-btn")].map((a) => a.getAttribute("href") + (a.dataset.turbo ? ":turbo=" + a.dataset.turbo : ""))`,
                ),
                texts: await ev<string[]>(
                    `[...document.querySelectorAll(".fd-brand-hero__tagline, .fd-auth__caption")].map((e) => e.textContent)`,
                ),
            });
        }
        const [create, forbidden, refused, missing] = gates as [
            (typeof gates)[number],
            (typeof gates)[number],
            (typeof gates)[number],
            (typeof gates)[number],
        ];
        record(
            `gates at ${width}: create household, no household, not allowed and not found are the Brand hero and one column, Log out for someone with no household (and under Create household), Go to Today for a refusal or a missing page; never wider than the screen`,
            gates.every((g) => g.facts.fits && g.facts.hero && !g.facts.bar) &&
                gates.every((g) =>
                    g.facts.boxes.every((b) => b.h === 48 && b.w === column),
                ) &&
                gates.every((g) =>
                    g.facts.btns.every((b) => b.h === 48 && b.w === column),
                ) &&
                create.facts.fields.join() === "household_name,display_name" &&
                create.facts.button?.w === column &&
                create.links.join() === "/logout:turbo=false" &&
                create.texts.join("|") === "Name your household" &&
                forbidden.links.join() === "/logout:turbo=false" &&
                forbidden.texts.join("|") ===
                    "No household yet|Ask the owner for an invite code" &&
                refused.links.join() === "/" &&
                refused.texts.join("|") ===
                    "Not allowed|You don't have access to this page." &&
                missing.links.join() === "/" &&
                missing.texts.join("|") ===
                    "Page not found|It may have moved or been deleted",
            { width, gates, ex: drain() },
        );

        const shares = [] as {
            path: string;
            fits: boolean;
            rows: number;
            sections: string[];
            tags: number;
            pressable: number;
            chrome: boolean;
            menus: number;
            title: string | null;
            kicker: string | null;
        }[];
        for (const path of ["/s/recipe-test", "/s/list-test"]) {
            await goto(path);
            await sleep(300);
            shares.push(
                await ev(`({
                    path: location.pathname,
                    fits: document.documentElement.scrollWidth <= ${width} + 1,
                    rows: document.querySelectorAll(".fd-share .fd-item-row").length,
                    sections: [...document.querySelectorAll(".fd-section-header__label")].map((e) => e.textContent),
                    tags: document.querySelectorAll(".fd-pill-chip-group--static .fd-pill-chip").length,
                    pressable: document.querySelectorAll(".fd-share button, .fd-share input, .fd-share a, .fd-share form").length,
                    chrome: !!document.querySelector(".app-bar, .fd-tabs, .fd-sidebar, .fd-bell, script, #toast-region"),
                    menus: document.querySelectorAll(".fd-menu").length,
                    title: document.querySelector(".fd-share-title")?.textContent ?? null,
                    kicker: document.querySelector(".fd-share-kicker")?.textContent ?? null,
                    column: Math.round(document.querySelector(".fd-page-layout__content").getBoundingClientRect().width),
                })`),
            );
        }
        // `mcp-share-links` off: the route's one plain 404, no page.
        await goto("/s/recipe-test?share=off");
        const off = await ev<{ text: string; page: boolean }>(`({
            text: document.body.textContent.trim(),
            page: !!document.querySelector(".fd-share"),
        })`);
        const share = width === 1440 ? 680 : 350;
        record(
            `public share pages at ${width}: a recipe and a grocery list in the design's rows, nothing to press or sign out of, never wider than the screen, and with mcp-share-links off the route's plain 404`,
            shares.every((p) => p.fits && !p.chrome && p.menus === 0) &&
                shares.every(
                    (p) =>
                        (p as unknown as { column: number }).column === share,
                ) &&
                shares.every((p) => p.pressable === 0) &&
                shares[0]!.title === "Smoky red lentil soup" &&
                shares[0]!.kicker === "Shared recipe" &&
                shares[0]!.sections.join() === "Ingredients,Method" &&
                shares[0]!.tags === 3 &&
                shares[0]!.rows === 6 &&
                shares[1]!.title === "Grocery list" &&
                shares[1]!.kicker === "Shared list" &&
                shares[1]!.sections.join() === "Corner Shop" &&
                shares[1]!.rows === 2 &&
                off.text === "Not found" &&
                !off.page,
            { width, shares, off, ex: drain() },
        );
    }
    // Create household posts its two names to the same route.
    await send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/create-household");
    await control("reset=posts");
    await ev(`(() => {
        document.querySelector("input[name='household_name']").value = "Home";
        document.querySelector("input[name='display_name']").value = "Ethan";
    })()`);
    await clickSel(".fd-auth__form button[type='submit']");
    await sleep(500);
    const createPosts = (await stats()).posts.filter(
        (p) => p.path === "/create-household",
    );
    record(
        "create household: the form posts household_name and display_name to /create-household",
        createPosts.length === 1 &&
            createPosts[0]!.entries.some(
                ([k, v]) => k === "household_name" && v === "Home",
            ) &&
            createPosts[0]!.entries.some(
                ([k, v]) => k === "display_name" && v === "Ethan",
            ),
        { createPosts, ex: drain() },
    );
    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });

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

    // A plan entry's edit sheet: titled with the day and the meal under it;
    // Recipe, Meal and Repeat are rows with pull-downs (the row's value follows
    // the choice), Day is a month calendar that opens under its row.
    await clickSel(".fd-plan-week [data-fd-sheet-row] [data-fd-menu-trigger]");
    await sleep(150);
    await clickSel(
        '.fd-plan-week [data-fd-sheet-row] [commandfor^="fd-plan-edit-"]',
    );
    await sleep(300);
    await clickSel(
        "dialog[id^='fd-plan-edit-'][open] [data-anchor='row'] [data-fd-menu-trigger]",
    );
    await sleep(200);
    const planSheet = await ev<{
        open: boolean;
        side: boolean;
        title: string | null;
        subtitle: string | null;
        rows: string[];
        values: string[];
        recipeChoices: number;
        valueAfter: string | null;
        fieldAfter: string | null;
        form: boolean;
    }>(`(() => {
        const d = document.querySelector("dialog[id^='fd-plan-edit-'][open]");
        const rows = [...(d?.querySelectorAll("[data-anchor='row']") ?? [])];
        const items = [...(rows[0]?.querySelectorAll("[data-fd-menu-value]") ?? [])];
        const values = rows.map((r) => r.querySelector(".fd-item-row__value")?.textContent ?? "");
        // Another recipe than the one the entry is on.
        items.find((i) => i.textContent.trim() !== values[0])?.click();
        return {
            open: !!d,
            side: d?.classList.contains("fd-sheet--side") ?? false,
            title: d?.querySelector(".fd-sheet__title")?.textContent ?? null,
            subtitle: d?.querySelector(".fd-sheet__subtitle")?.textContent ?? null,
            rows: rows.map((r) => r.querySelector(".fd-item-row__title")?.textContent ?? ""),
            values,
            recipeChoices: items.length,
            valueAfter: rows[0]?.querySelector(".fd-item-row__value")?.textContent ?? null,
            fieldAfter: rows[0]?.querySelector("[data-fd-menu-field]")?.value ?? null,
            form: !!d?.querySelector("form[data-fd-plan-form]"),
        };
    })()`);
    // Day: its row opens the calendar, a day picked closes it and reads in the row.
    const planDay = await ev<{
        rowTitle: string | null;
        shown: boolean;
        inside: boolean;
        want: string | null;
        field: string | null;
        value: string | null;
        closed: boolean;
    }>(`(() => {
        const d = document.querySelector("dialog[id^='fd-plan-edit-'][open]");
        const toggle = d.querySelector("[data-fd-month-toggle]");
        toggle.click();
        const p = d.querySelector("[data-fd-month-picker]");
        const panel = d.querySelector(".fd-sheet-panel").getBoundingClientRect();
        const shown = !p.hidden && p.getClientRects().length > 0;
        const days = [...p.querySelectorAll("[data-fd-month-day]")];
        const inside = days.every((b) => { const r = b.getBoundingClientRect(); return r.left >= panel.left - 1 && r.right <= panel.right + 1; });
        const open = days.filter((b) => !b.disabled);
        const pick = open[open.length - 1];
        const want = pick?.getAttribute("data-fd-month-day") ?? null;
        pick?.click();
        return {
            rowTitle: toggle.querySelector(".fd-item-row__title")?.textContent ?? null,
            shown,
            inside,
            want,
            field: d.querySelector("[data-fd-month-field]").value,
            value: toggle.querySelector(".fd-item-row__value")?.textContent ?? null,
            closed: p.hidden,
        };
    })()`);
    await pressEsc();
    record(
        "v2 today: a plan entry's edit sheet is a side sheet titled with the day and the meal under it, with Recipe, Meal and Repeat as pull-down rows whose value follows the choice, Repeat starting on how the entry repeats, and Day opening a month calendar whose pick reads in its row",
        planSheet.open &&
            planSheet.side &&
            planSheet.form &&
            /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/.test(
                planSheet.title ?? "",
            ) &&
            /^(Breakfast|Lunch|Dinner|Snack)$/.test(planSheet.subtitle ?? "") &&
            planSheet.rows.join("|") === "Recipe|Meal|Repeat" &&
            planSheet.values[2] === "Once" &&
            planSheet.recipeChoices >= 3 &&
            planSheet.valueAfter != null &&
            planSheet.valueAfter !== planSheet.values[0] &&
            (planSheet.fieldAfter ?? "") !== "" &&
            planDay.rowTitle === "Day" &&
            planDay.shown &&
            planDay.inside &&
            /^\d{4}-\d{2}-\d{2}$/.test(planDay.field ?? "") &&
            planDay.field === planDay.want &&
            planDay.closed,
        { planSheet, planDay, ex: drain() },
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

    // ---- Recipes: the list, its filters, link import and the plan sheets ----
    // Run at both widths: the page is never wider than the screen, the
    // buttons of each sheet measure as buttons, and every pull-down item is
    // the topmost thing at its centre once scrolled to.
    const recipesAt = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 600 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await control("reset=posts");
        await goto("/recipes");
        await setMarker();
    };
    // Every item of the open pull-down is reachable: scrolled into its panel,
    // it is the topmost thing at its own centre and on the screen.
    const reachItems = (menuSel: string) =>
        ev<{ n: number; bad: string[] }>(`(() => {
            const panel = document.querySelector(${JSON.stringify(menuSel)} + " .fd-menu__panel");
            const bad = [];
            const items = [...panel.querySelectorAll(".fd-menu__item")].filter((i) => i.getClientRects().length > 0);
            for (const i of items) {
                i.scrollIntoView({ block: "nearest" });
                const r = i.getBoundingClientRect();
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                const inView = r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
                if (!(hit && i.contains(hit) && inView)) bad.push(i.textContent.trim());
            }
            return { n: items.length, bad };
        })()`);
    // The buttons in an open sheet's action row: real tap targets inside the
    // screen, their words not clipped, none over another.
    const sheetButtons = () =>
        ev<{ n: number; ok: boolean; boxes: string[] }>(`(() => {
            const d = document.querySelector("dialog[open]");
            const bs = [...(d?.querySelectorAll(".fd-sheet__actions .fd-btn") ?? [])].filter((b) => b.getClientRects().length > 0);
            const rs = bs.map((b) => b.getBoundingClientRect());
            const fits = rs.every((r, i) => r.height >= 40 && r.height <= 60 && r.width >= 64 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && bs[i].scrollWidth <= bs[i].clientWidth + 1);
            const apart = rs.every((r, i) => rs.every((o, j) => i === j || r.right <= o.left + 1 || o.right <= r.left + 1 || r.bottom <= o.top + 1 || o.bottom <= r.top + 1));
            return { n: bs.length, ok: bs.length > 0 && fits && apart, boxes: rs.map((r) => Math.round(r.width) + "x" + Math.round(r.height)) };
        })()`);
    const recipesRes: Record<string, unknown> = {};
    let recipesOk = true;
    for (const width of [390, 1440]) {
        // The width asked for, not innerWidth: a phone's layout viewport grows
        // with content that overflows, so innerWidth would follow it.
        await recipesAt(width);
        const page = await ev<{
            h1: string | null;
            subtitle: string | null;
            rows: number;
            stars: number;
            rowMenus: number;
            cards: number;
            missing: string | null;
            fits: boolean;
            chips: number;
            noticeStrip: number;
        }>(`(() => ({
            h1: document.querySelector("h1")?.textContent ?? null,
            subtitle: document.querySelector(".fd-page-header__subtitle")?.textContent ?? null,
            rows: document.querySelectorAll(".fd-recipes-row").length,
            stars: document.querySelectorAll(".fd-recipes-row .fd-star").length,
            rowMenus: document.querySelectorAll(".fd-recipes-row [data-fd-menu-trigger]").length,
            cards: document.querySelectorAll(".fd-plan-planned .fd-mini-card").length,
            missing: document.querySelector(".fd-plan-planned > .fd-btn")?.textContent?.trim() ?? null,
            fits: document.documentElement.scrollWidth <= ${width} + 1,
            chips: document.querySelectorAll(".fd-recipes-page .fd-chip").length,
            noticeStrip: document.querySelectorAll(".fd-notice-strip").length,
        }))()`);
        // The filter pull-down: ticks, reachable items, a filter is a Turbo visit.
        await clickSel('[data-anchor="filter"] [data-fd-menu-trigger]');
        await sleep(250);
        const open = await reachItems('[data-anchor="filter"]');
        const labels = await ev<string[]>(
            `[...document.querySelectorAll('[data-anchor="filter"] .fd-menu__label')].map((e) => e.textContent)`,
        );
        await clickSel(
            '[data-anchor="filter"] a[href="/recipes?filter=protein"]',
        );
        await sleep(500);
        const filtered = await ev<{
            href: string;
            marker: string | null;
            count: string | null;
            rows: number;
            ticked: string[];
            fits: boolean;
        }>(`({
            href: location.pathname + location.search,
            marker: window.__marker ?? null,
            count: document.querySelector("[data-fd-recipes-filter-count]")?.getAttribute("data-fd-recipes-filter-count") ?? null,
            rows: document.querySelectorAll(".fd-recipes-row").length,
            ticked: [...document.querySelectorAll('[data-anchor="filter"] [aria-checked="true"] .fd-menu__label')].map((e) => e.textContent),
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        // The search field: text filters the rows on the page; a link shows
        // Go and posts the import.
        await goto("/recipes");
        await setMarker();
        await control("reset=posts");
        const clearShown = `(() => { const b = document.querySelector(".fd-recipes-search [data-fd-search-clear]"); return !!b && b.getClientRects().length > 0; })()`;
        const headingOf = `(document.querySelector("#fd-recipes-all-heading .fd-section-header__label")?.textContent ?? "") + "|" + (document.querySelector("#fd-recipes-all-heading .fd-section-header__count")?.getClientRects().length ?? 0)`;
        const beforeTyping = await ev<{ heading: string; clear: boolean }>(
            `({ heading: ${headingOf}, clear: ${clearShown} })`,
        );
        const typed = await ev<{
            hidden: number;
            link: boolean;
            goShown: boolean;
            heading: string;
            clear: boolean;
        }>(`(() => {
            const input = document.querySelector(".fd-recipes-search .fd-search-field__input");
            input.value = "tacos";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return {
                hidden: [...document.querySelectorAll(".fd-recipes-row")].filter((r) => r.hidden).length,
                link: !!document.querySelector(".fd-search-field[data-link-detected]"),
                goShown: !document.querySelector("[data-fd-recipes-import-go]").hidden,
                heading: ${headingOf},
                clear: ${clearShown},
            };
        })()`);
        // Emptying the field puts the heading back and hides the X.
        const emptied = await ev<{ heading: string; clear: boolean }>(`(() => {
            const input = document.querySelector(".fd-recipes-search .fd-search-field__input");
            input.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            return { heading: ${headingOf}, clear: ${clearShown} };
        })()`);
        const pasted = await ev<{
            link: boolean;
            goShown: boolean;
            filterShown: boolean;
        }>(`(() => {
            const input = document.querySelector(".fd-recipes-search .fd-search-field__input");
            input.value = "https://www.instagram.com/reel/C8xYz1AbCdE/";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const filter = document.querySelector("[data-fd-search-filter]");
            return {
                link: !!document.querySelector(".fd-search-field[data-link-detected]"),
                goShown: !document.querySelector("[data-fd-recipes-import-go]").hidden,
                filterShown: !!filter && filter.getClientRects().length > 0,
            };
        })()`);
        await clickSel("[data-fd-recipes-import-go]");
        await sleep(500);
        const importPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/import",
        );
        // Add to plan from the list: a row's ⋯ has Plan, which opens the
        // recipe's sheet; its Add to plan posts day, meal and servings.
        await goto("/recipes");
        await setMarker();
        await control("reset=posts");
        await clickSel(".fd-recipes-row .fd-menu [data-fd-menu-trigger]");
        await sleep(250);
        const rowMenu = await reachItems(".fd-recipes-row .fd-menu");
        await clickSel(
            '.fd-recipes-row .fd-menu a[href="/recipes/r-alfredo?plan=1"]',
        );
        await sleep(600);
        const planOpen = await ev<{
            href: string;
            marker: string | null;
            sheet: boolean;
        }>(`({
            href: location.pathname + location.search,
            marker: window.__marker ?? null,
            sheet: !!document.querySelector("#fd-recipe-plan-sheet[open]"),
        })`);
        const addButtons = await sheetButtons();
        await ev(
            `document.querySelector('#fd-recipe-plan-sheet [type="submit"]').click()`,
        );
        await sleep(500);
        const planPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/plan",
        );
        // Today's This week Plan starts picking a day: the first day with
        // nothing planned (the fixture plans the 10th and the 11th).
        await goto("/");
        await clickSel(".fd-plan-week .fd-section-header__action");
        await sleep(600);
        const fromToday = await ev<{ at: string; subtitle: string | null }>(`({
            at: location.pathname + location.search,
            subtitle: document.querySelector(".fd-page-header__subtitle")?.textContent ?? null,
        })`);
        // Picking a day: each row's plus goes to the recipe's sheet for it.
        await goto("/recipes?plan_date=2026-11-12");
        const pick = await ev<{
            subtitle: string | null;
            plus: string[];
            cancel: string | null;
            stars: number;
            filterLinks: string[];
            fits: boolean;
        }>(`({
            filterLinks: [...document.querySelectorAll('[data-anchor="filter"] a[href]')].map((a) => a.getAttribute("href")),
            subtitle: document.querySelector(".fd-page-header__subtitle")?.textContent ?? null,
            plus: [...document.querySelectorAll(".fd-recipes-row .fd-item-row__add")].map((a) => a.getAttribute("href")),
            cancel: document.querySelector(".fd-section-header__action")?.getAttribute("href") ?? null,
            stars: document.querySelectorAll(".fd-star").length,
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        await clickSel(".fd-recipes-row .fd-item-row__add");
        await sleep(600);
        const pickOpen = await ev<{ href: string; sheet: boolean }>(`({
            href: location.pathname + location.search,
            sheet: !!document.querySelector("#fd-recipe-plan-sheet[open]"),
        })`);
        // A planned card opens its edit sheet: Day and Meal pull-downs reach
        // every item, Save posts the move, Remove asks in place and then posts.
        await goto("/recipes");
        await setMarker();
        await control("reset=posts");
        await clickSel('.fd-plan-planned [commandfor="fd-plan-edit-pl1"]');
        await sleep(350);
        const edit = await ev<{
            title: string | null;
            subtitle: string | null;
            side: boolean;
            gap: number;
        }>(`(() => {
            const d = document.querySelector("#fd-plan-edit-pl1[open]");
            const actions = d?.querySelector(".fd-sheet__actions");
            return {
                gap: d && actions ? Math.round(d.getBoundingClientRect().bottom - actions.getBoundingClientRect().bottom) : -1,
                title: d?.querySelector(".fd-sheet__title")?.textContent ?? null,
                subtitle: d?.querySelector(".fd-sheet__subtitle")?.textContent ?? null,
                side: d?.classList.contains("fd-sheet--side") ?? false,
            };
        })()`);
        const editButtons = await sheetButtons();
        const reach: { recipe: unknown; meal: unknown; repeat: unknown } = {
            recipe: null,
            meal: null,
            repeat: null,
        };
        for (const [key, field] of [
            ["recipe", "recipe_id"],
            ["meal", "slot"],
            ["repeat", "repeat"],
        ] as const) {
            await clickSel(
                `#fd-plan-edit-pl1 [data-anchor="row"]:has([data-fd-menu-field][name="${field}"]) [data-fd-menu-trigger]`,
            );
            await sleep(250);
            reach[key] = await reachItems(
                `#fd-plan-edit-pl1 [data-anchor="row"]:has([data-fd-menu-field][name="${field}"])`,
            );
            await menuEsc();
        }
        // Day is a calendar inside the sheet: every date in the panel and a
        // real tap target, earlier days off.
        await clickSel("#fd-plan-edit-pl1 [data-fd-month-toggle]");
        await sleep(200);
        const editCalendar = await ev<{
            shown: boolean;
            inside: boolean;
            tap: boolean;
            pastDisabled: boolean;
            gapAbove: number;
            gapBelow: number;
        }>(`(() => {
            const d = document.querySelector("#fd-plan-edit-pl1");
            const p = d.querySelector("[data-fd-month-picker]");
            const panel = d.querySelector(".fd-sheet-panel").getBoundingClientRect();
            const days = [...p.querySelectorAll("[data-fd-month-day]")];
            const open = days.filter((b) => !b.disabled);
            const dayGroup = d.querySelector("[data-fd-month-toggle]").closest(".fd-list-group");
            const mealGroup = d.querySelector('[data-fd-menu-field][name="slot"]').closest(".fd-list-group");
            return {
                shown: !p.hidden && p.getClientRects().length > 0,
                inside: days.every((b) => { const r = b.getBoundingClientRect(); return r.left >= panel.left - 1 && r.right <= panel.right + 1; }),
                tap: open.every((b) => { const r = b.getBoundingClientRect(); return r.height >= 40 && r.width >= 32; }),
                pastDisabled: p.querySelector('[data-fd-month-day="2026-11-09"]').disabled && !p.querySelector('[data-fd-month-day="2026-11-10"]').disabled,
                gapAbove: Math.round(p.getBoundingClientRect().top - dayGroup.getBoundingClientRect().bottom),
                gapBelow: Math.round(mealGroup.getBoundingClientRect().top - p.getBoundingClientRect().bottom),
            };
        })()`);
        await clickSel("#fd-plan-edit-pl1 [data-fd-month-toggle]");
        await sleep(100);
        await ev(
            `[...document.querySelectorAll("#fd-plan-edit-pl1 .fd-sheet__actions .fd-btn")].find((b) => b.textContent.trim() === "Save").click()`,
        );
        await sleep(500);
        const savePosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/plan/pl1/move",
        );
        await clickSel('.fd-plan-planned [commandfor="fd-plan-edit-pl1"]');
        await sleep(350);
        await ev(
            `document.querySelector("#fd-plan-edit-pl1 [data-fd-confirm-arm]").click()`,
        );
        await sleep(200);
        const armed = await ev<{ posts: number; labels: string[] }>(`({
            posts: 0,
            labels: [...document.querySelectorAll("#fd-plan-edit-pl1 .fd-sheet__actions .fd-btn")].filter((b) => b.getClientRects().length > 0).map((b) => b.textContent.trim()),
        })`);
        const beforeRemove = (await stats()).posts.filter(
            (p) => p.path === "/recipes/plan/pl1/remove",
        ).length;
        await ev(
            `[...document.querySelectorAll("#fd-plan-edit-pl1 .fd-sheet__actions .fd-btn")].filter((b) => b.getClientRects().length > 0).find((b) => b.textContent.trim() === "Remove").click()`,
        );
        await sleep(500);
        const removePosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/plan/pl1/remove",
        );
        // A failed link import from the box (error card, shared form open) still fits.
        await goto("/recipes?failed=box");
        const failed = await ev<{
            fits: boolean;
            wide: string[];
            errorCard: boolean;
            sharedOpen: boolean;
        }>(`({
            fits: document.documentElement.scrollWidth <= ${width} + 1,
            wide: [...document.querySelectorAll(".fd-recipes-page *")].filter((e) => e.getBoundingClientRect().right > ${width} + 1 && !e.closest(".fd-plan-planned__scroll")).slice(0, 6).map((e) => e.tagName + "." + String(e.className).slice(0, 40) + " " + Math.round(e.getBoundingClientRect().right)),
            errorCard: !!document.querySelector("details.fd-recipes-shared[open] .fd-recipes-import-shared-error"),
            sharedOpen: !!document.querySelector("details.fd-recipes-shared[open]"),
        })`);
        // A share link that failed from the search field answers right under
        // the field, above the planned week, the box closed (403910); at 1440
        // the card and the week take the left column, the list the right.
        await goto("/recipes?failed=1");
        const failedField = await ev<{
            fits: boolean;
            underField: boolean;
            boxClosed: boolean;
            twoColumns: boolean;
        }>(`(() => {
            const card = document.querySelector(".fd-recipes-import-shared-error");
            const field = document.querySelector("#fd-recipes-search-form");
            const week = document.querySelector(".fd-plan-planned");
            const list = document.querySelector(".fd-recipes-all");
            const r = (e) => e ? e.getBoundingClientRect() : null;
            const c = r(card), f = r(field), w = r(week), l = r(list);
            return {
                fits: document.documentElement.scrollWidth <= ${width} + 1,
                underField: !!(c && f && w) && !card.closest("details") && c.top >= f.bottom - 1 && c.top - f.bottom <= 40 && c.bottom <= w.top + 1,
                boxClosed: !document.querySelector("details.fd-recipes-shared[open]"),
                twoColumns: !!(c && l) && (${width} < 1024 ? l.top >= c.bottom : l.left >= c.right),
            };
        })()`);
        // The missing link opens the sheet that adds what the week lacks.
        await goto("/recipes");
        await setMarker();
        await control("reset=posts");
        await clickSel(
            '.fd-plan-planned > [commandfor="fd-plan-missing-sheet"]',
        );
        await sleep(350);
        const missingButtons = await sheetButtons();
        await ev(
            `[...document.querySelectorAll("#fd-plan-missing-sheet .fd-sheet__actions .fd-btn")].find((b) => /^Add \\d+ to groceries$/.test(b.textContent.trim())).click()`,
        );
        await sleep(500);
        const missingPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/plan/add-missing",
        );
        const entry = (
            p: { entries: [string, string][] } | undefined,
            k: string,
        ) => p?.entries.find(([key]) => key === k)?.[1];
        const ok =
            page.h1 === "Recipes" &&
            /saved$/.test(page.subtitle ?? "") &&
            page.rows === 3 &&
            page.stars === 3 &&
            page.rowMenus === 3 &&
            page.cards === 2 &&
            /ingredient/.test(page.missing ?? "") &&
            page.fits &&
            page.chips === 0 &&
            page.noticeStrip === 0 &&
            open.n === 4 &&
            open.bad.length === 0 &&
            labels.join("|") ===
                "Cookable now|High protein|Under 30 min|Favourites" &&
            filtered.href === "/recipes?filter=protein" &&
            filtered.marker === "stay" &&
            filtered.count === "1" &&
            filtered.rows === 1 &&
            filtered.ticked.join("|") === "High protein" &&
            filtered.fits &&
            typed.hidden === 2 &&
            beforeTyping.heading === "All recipes|1" &&
            !beforeTyping.clear &&
            typed.heading === "1 of 3 recipes|0" &&
            typed.clear &&
            emptied.heading === "All recipes|1" &&
            !emptied.clear &&
            !typed.link &&
            !typed.goShown &&
            pasted.link &&
            pasted.goShown &&
            !pasted.filterShown &&
            importPosts.length === 1 &&
            entry(importPosts[0], "url") ===
                "https://www.instagram.com/reel/C8xYz1AbCdE/" &&
            rowMenu.n === 1 &&
            rowMenu.bad.length === 0 &&
            planOpen.href === "/recipes/r-alfredo?plan=1" &&
            planOpen.marker === "stay" &&
            planOpen.sheet &&
            addButtons.ok &&
            planPosts.length === 1 &&
            entry(planPosts[0], "date") != null &&
            entry(planPosts[0], "slot") != null &&
            entry(planPosts[0], "servings") != null &&
            /^Pick one for /.test(pick.subtitle ?? "") &&
            fromToday.at === "/recipes?plan_date=2026-11-12" &&
            fromToday.subtitle === "Pick one for Thu 12 Nov" &&
            pick.plus.length === 3 &&
            pick.plus.every((h) =>
                /^\/recipes\/r-[a-z]+\?plan=1&date=2026-11-12$/.test(h ?? ""),
            ) &&
            pick.filterLinks.length > 0 &&
            pick.filterLinks.every((h) =>
                (h ?? "").includes("plan_date=2026-11-12"),
            ) &&
            pick.cancel === "/recipes" &&
            pick.stars === 0 &&
            pick.fits &&
            pickOpen.sheet &&
            /plan_date|date=2026-11-12/.test(pickOpen.href) &&
            edit.side &&
            (edit.title ?? "") !== "" &&
            // On desktop the side sheet pins Remove and Save to the panel's bottom.
            (width < 1024 || (edit.gap >= 0 && edit.gap <= 32)) &&
            editButtons.ok &&
            editButtons.n === 2 &&
            (reach.recipe as { n: number }).n >= 3 &&
            (reach.recipe as { bad: string[] }).bad.length === 0 &&
            (reach.meal as { n: number }).n === 4 &&
            (reach.meal as { bad: string[] }).bad.length === 0 &&
            (reach.repeat as { n: number }).n === 5 &&
            (reach.repeat as { bad: string[] }).bad.length === 0 &&
            editCalendar.shown &&
            editCalendar.inside &&
            editCalendar.tap &&
            editCalendar.pastDisabled &&
            // Day, its calendar and Meal sit evenly apart.
            editCalendar.gapAbove >= 8 &&
            Math.abs(editCalendar.gapAbove - editCalendar.gapBelow) <= 1 &&
            savePosts.length === 1 &&
            entry(savePosts[0], "back") === "recipes" &&
            entry(savePosts[0], "date") != null &&
            entry(savePosts[0], "recipe_id") != null &&
            entry(savePosts[0], "repeat") === "once" &&
            armed.labels.join("|") === "Cancel|Remove" &&
            beforeRemove === 0 &&
            removePosts.length === 1 &&
            entry(removePosts[0], "back") === "recipes" &&
            failed.fits &&
            failed.wide.length === 0 &&
            failed.errorCard &&
            failed.sharedOpen &&
            failedField.fits &&
            failedField.underField &&
            failedField.boxClosed &&
            failedField.twoColumns &&
            missingButtons.ok &&
            missingPosts.length === 1 &&
            entry(missingPosts[0], "back") === "recipes";
        recipesRes[String(width)] = {
            page,
            open,
            labels,
            filtered,
            beforeTyping,
            typed,
            emptied,
            pasted,
            importPosts,
            rowMenu,
            planOpen,
            addButtons,
            planPosts,
            fromToday,
            pick,
            pickOpen,
            edit,
            editButtons,
            reach,
            editCalendar,
            savePosts,
            armed,
            beforeRemove,
            removePosts,
            missingButtons,
            missingPosts,
            failed,
            failedField,
        };
        recipesOk = recipesOk && ok;
    }
    record(
        "v2 recipes at 390 and 1440: the list, the filter pull-down (a Turbo visit), a pasted link's Go posting the import, a row's ⋯ Plan into the Add to plan sheet, Today's Plan into picking a day (its filter links keep the day), a planned card's edit sheet (Recipe, Meal and Repeat items reachable, Day's calendar inside the sheet with even spacing, Save posting recipe and repeat, Remove asking first) and the missing link; every sheet button measured and the page never wider than the screen",
        recipesOk,
        { ...recipesRes, ex: drain() },
    );
    // Both states of the shared-recipe form (mcp-share-links on and off), and
    // no ⋯ with nothing in it.
    await goto("/recipes");
    const shareOn = await ev<number>(
        `document.querySelectorAll(".fd-recipes-shared [data-fd-recipes-shared]").length`,
    );
    await goto("/recipes?share=off");
    const shareOff = await ev<{ forms: number; emptyMenus: number }>(`({
        forms: document.querySelectorAll("[data-fd-recipes-shared]").length,
        emptyMenus: [...document.querySelectorAll(".fd-menu__panel")].filter((p) => p.querySelectorAll(".fd-menu__item").length === 0).length,
    })`);
    record(
        "v2 recipes: the shared-recipe form is there with mcp-share-links on and gone with it off, and no ⋯ menu is empty",
        shareOn === 1 && shareOff.forms === 0 && shareOff.emptyMenus === 0,
        { shareOn, shareOff, ex: drain() },
    );
    // ---- The recipe page: Detail bar ⋯ (Share), Cook, Plan, the share sheet,
    // the draft bar's Save ----
    // At both widths: the page is never wider than the screen, every button of
    // an open sheet measures as a button, and every ⋯ item is reachable.
    const recipePageRes: Record<string, unknown> = {};
    let recipePageOk = true;
    // Every control of the open dialog is a real tap target inside the screen.
    const dialogControls = () =>
        ev<{ n: number; ok: boolean; boxes: string[] }>(`(() => {
            const d = document.querySelector("dialog[open]");
            const cs = [...(d?.querySelectorAll("[data-fd-btn], .fd-btn") ?? [])].filter((b) => b.getClientRects().length > 0);
            const rs = cs.map((b) => b.getBoundingClientRect());
            const ok = rs.every((r, i) => r.height >= 32 && r.width >= 32 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && cs[i].scrollWidth <= cs[i].clientWidth + 1);
            return { n: cs.length, ok: cs.length > 0 && ok, boxes: rs.map((r) => Math.round(r.width) + "x" + Math.round(r.height)) };
        })()`);
    for (const width of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 600 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await control("reset=posts");
        await goto("/recipes/r-alfredo");
        await setMarker();
        // The entrance fade (a filter on the page's first children) is over.
        await sleep(800);
        const page = await ev<{
            h1: string | null;
            subtitle: string | null;
            rows: number;
            rowMenus: number;
            bar: string[];
            barHeights: number[];
            barClear: boolean;
            fits: boolean;
            steps: number;
            unverified: boolean;
        }>(`(() => {
            const bar = document.querySelector(".fd-recipe-bar");
            const r = bar?.getBoundingClientRect();
            const tabs = document.querySelector(".fd-tabs")?.getBoundingClientRect();
            const phone = ${width} < 1024;
            return {
                h1: document.querySelector("h1")?.textContent ?? null,
                subtitle: document.querySelector(".fd-recipe-head .fd-page-header__subtitle")?.textContent ?? null,
                rows: document.querySelectorAll(".fd-recipe-detail .fd-page-layout .fd-item-row").length,
                rowMenus: document.querySelectorAll(".fd-recipe-detail .fd-page-layout .fd-item-row [data-fd-menu-trigger]").length,
                bar: [...(bar?.querySelectorAll("[data-fd-btn]") ?? [])].map((b) => b.textContent.trim()),
                // Large on the phone's bar, Small in the desktop header (609258).
                barHeights: [...(bar?.querySelectorAll("[data-fd-btn]") ?? [])].map((b) => Math.round(b.getBoundingClientRect().height)),
                // On the phone the bar floats above the nav pill, on screen.
                barClear: !!r && r.left >= 0 && r.right <= ${width} && (!phone || (!!tabs && r.bottom <= tabs.top && r.top >= 0)),
                fits: document.documentElement.scrollWidth <= ${width} + 1,
                steps: document.querySelectorAll(".fd-recipe-steps li").length,
                unverified: /unverified/i.test(document.body.textContent ?? ""),
            };
        })()`);
        // The Detail bar's ⋯: Share first, then the star; Share opens the sheet.
        await clickSel(".fd-detail-bar [data-fd-menu-trigger]");
        await sleep(250);
        const menuReach = await reachItems(".fd-detail-bar .fd-menu");
        const menuLabels = await ev<string[]>(
            `[...document.querySelectorAll(".fd-detail-bar .fd-menu__label")].map((e) => e.textContent)`,
        );
        await clickSel('.fd-detail-bar [commandfor="fd-recipe-share-sheet"]');
        await sleep(500);
        const shareOpen = await ev<{
            open: boolean;
            chips: string[];
            picked: string | null;
            menuClosed: boolean;
        }>(`({
            open: !!document.querySelector("#fd-recipe-share-sheet[open]"),
            chips: [...document.querySelectorAll("#fd-recipe-share-sheet .fd-chip__label")].map((e) => e.textContent),
            picked: document.querySelector('#fd-recipe-share-sheet input[name="expires"]:checked')?.value ?? null,
            menuClosed: !document.querySelector(".fd-detail-bar .fd-menu__panel:not([hidden])"),
        })`);
        const shareControls = await dialogControls();
        const shareButtons = await sheetButtons();
        // Pick 1 month and Make link: the form posts the choice (a full page load answers with the link).
        await clickSel(
            '#fd-recipe-share-sheet .fd-chip:has(input[value="30"])',
        );
        await ev(
            `document.querySelector('#fd-recipe-share-sheet [type="submit"]').click()`,
        );
        await sleep(800);
        const sharePosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/share",
        );
        const made = await ev<{
            open: boolean;
            title: string | null;
            urlValue: string | null;
            urlCopies: number;
            fits: boolean;
        }>(`({
            open: !!document.querySelector("#fd-share-made-sheet[open]"),
            title: document.querySelector("#fd-share-made-sheet .fd-sheet__title")?.textContent ?? null,
            urlValue: document.querySelector("[data-fd-share-url]")?.value ?? null,
            urlCopies: document.querySelectorAll("[data-fd-share-copy]").length,
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        const madeControls = await dialogControls();
        const madeButtons = await sheetButtons();
        // Done goes back to the recipe.
        await ev(
            `document.querySelector('#fd-share-made-sheet [data-fd-btn][command="close"]').click()`,
        );
        await sleep(800);
        const afterDone = await ev<string>(
            `location.pathname + location.search`,
        );
        // Cook: the sheet shows what it takes, the short ingredient greyed, and posts.
        await goto("/recipes/r-alfredo");
        await setMarker();
        await control("reset=posts");
        await clickSel('.fd-recipe-bar [commandfor="fd-recipe-cook-sheet"]');
        await sleep(600);
        const cook = await ev<{
            open: boolean;
            title: string | null;
            rows: number;
            ticked: number;
            greyed: number;
            greyedTitle: string | null;
            logChips: string[];
            fits: boolean;
        }>(`(() => {
            const d = document.querySelector("#fd-recipe-cook-sheet");
            const boxes = [...d.querySelectorAll('.fd-item-row input[type="checkbox"]')];
            return {
                open: d.open,
                title: d.querySelector(".fd-sheet__title")?.textContent ?? null,
                rows: d.querySelectorAll(".fd-item-row").length,
                ticked: d.querySelectorAll(".fd-item-row__done").length,
                greyed: boxes.filter((b) => b.disabled && !b.checked).length,
                greyedTitle: boxes[0]?.closest(".fd-item-row")?.querySelector(".fd-item-row__title")?.textContent ?? null,
                logChips: [...d.querySelectorAll(".fd-choice-group .fd-chip__label")].map((e) => e.textContent),
                fits: document.documentElement.scrollWidth <= ${width} + 1,
            };
        })()`);
        const cookControls = await dialogControls();
        const cookButtons = await sheetButtons();
        await ev(
            `document.querySelector('#fd-recipe-cook-sheet [type="submit"]').click()`,
        );
        await sleep(600);
        const cookPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/cook/confirm",
        );
        const cookEntry = (name: string) =>
            cookPosts[0]?.entries.find(([k]) => k === name)?.[1] ?? null;
        // Plan: the bar's Plan opens the Add to plan sheet.
        await goto("/recipes/r-alfredo");
        await setMarker();
        await clickSel('.fd-recipe-bar [commandfor="fd-recipe-plan-sheet"]');
        await sleep(500);
        const planOpen = await ev<boolean>(
            `!!document.querySelector("#fd-recipe-plan-sheet[open]")`,
        );
        const planButtons = await sheetButtons();
        // `mcp-share-links` off: no Share, and no ⋯ with nothing in it.
        await goto("/recipes/r-alfredo?share=off");
        const shareOff = await ev<{
            labels: string[];
            sheet: boolean;
            emptyMenus: number;
            fits: boolean;
        }>(`({
            labels: [...document.querySelectorAll(".fd-detail-bar .fd-menu__label")].map((e) => e.textContent),
            sheet: !!document.querySelector("#fd-recipe-share-sheet"),
            emptyMenus: [...document.querySelectorAll(".fd-menu__panel")].filter((p) => p.querySelectorAll(".fd-menu__item").length === 0).length,
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        // A draft: Save and what is left in place of Cook and Plan; Save is
        // refused in place, then saved.
        await goto("/recipes/r-draft");
        await setMarker();
        await control("reset=posts");
        await sleep(800);
        const draft = await ev<{
            bar: string[];
            status: string | null;
            left: string[];
            cook: number;
            plan: number;
            menu: string[];
            subtitle: string | null;
            barClear: boolean;
            fits: boolean;
            unverified: boolean;
        }>(`(() => {
            const bar = document.querySelector("#fd-recipe-draft-bar");
            const r = bar?.getBoundingClientRect();
            const tabs = document.querySelector(".fd-tabs")?.getBoundingClientRect();
            return {
                bar: [...(bar?.querySelectorAll("[data-fd-btn]") ?? [])].map((b) => b.textContent.trim()),
                status: bar?.querySelector(".fd-recipe-bar__status")?.textContent ?? null,
                left: [...document.querySelectorAll(".fd-recipe-draft__problems li")].map((e) => e.textContent),
                cook: document.querySelectorAll('[commandfor="fd-recipe-cook-sheet"]').length,
                plan: document.querySelectorAll('[commandfor="fd-recipe-plan-sheet"]').length,
                menu: [...document.querySelectorAll(".fd-detail-bar .fd-menu__label")].map((e) => e.textContent),
                subtitle: document.querySelector(".fd-recipe-head .fd-page-header__subtitle")?.textContent ?? null,
                barClear: !!r && r.left >= 0 && r.right <= ${width} && (${width} >= 1024 || (!!tabs && r.bottom <= tabs.top)),
                fits: document.documentElement.scrollWidth <= ${width} + 1,
                unverified: /unverified/i.test(document.body.textContent ?? ""),
            };
        })()`);
        await clickSel("#fd-recipe-draft-bar button[type=submit]");
        await sleep(700);
        const refused = await ev<{
            error: string | null;
            draftBar: boolean;
            marker: string | null;
            fits: boolean;
        }>(`({
            error: document.querySelector(".fd-recipe-error")?.textContent ?? null,
            draftBar: !!document.querySelector("#fd-recipe-draft-bar"),
            marker: window.__marker ?? null,
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        await clickSel("#fd-recipe-draft-bar button[type=submit]");
        await sleep(700);
        const saved = await ev<{
            at: string;
            draftBar: boolean;
            bar: string[];
            marker: string | null;
        }>(`({
            at: location.pathname + location.search,
            draftBar: !!document.querySelector("#fd-recipe-draft-bar"),
            bar: [...document.querySelectorAll(".fd-recipe-bar [data-fd-btn]")].map((b) => b.textContent.trim()),
            marker: window.__marker ?? null,
        })`);
        const savePosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-draft/save",
        );
        const ok =
            page.h1 === "Chicken alfredo" &&
            page.subtitle === "4 servings · 30 min · from seriouseats.com" &&
            page.rows === 4 &&
            page.rowMenus === 4 &&
            page.bar.join() === "Plan,Cook" &&
            page.barHeights.every((h) => h === (width < 1024 ? 48 : 40)) &&
            page.barClear &&
            page.fits &&
            page.steps === 3 &&
            !page.unverified &&
            menuReach.n === 2 &&
            menuReach.bad.length === 0 &&
            menuLabels.join() === "Share,Add to favourites" &&
            shareOpen.open &&
            shareOpen.menuClosed &&
            shareOpen.chips.join() ===
                "1 week,1 month,3 months,Never expires" &&
            shareOpen.picked === "never" &&
            shareControls.ok &&
            shareButtons.ok &&
            shareButtons.n === 1 &&
            sharePosts.length === 1 &&
            sharePosts[0]!.entries.some(
                ([k, v]) => k === "expires" && v === "30",
            ) &&
            made.open &&
            made.title === "Link ready" &&
            made.urlValue ===
                "https://foodable.example.com/s/Qk3vZ8mXr1TnY0aLw5uHc9DfJ2bEeSgPiVoN7xRzA4M" &&
            made.urlCopies === 1 &&
            made.fits &&
            madeControls.ok &&
            madeButtons.ok &&
            madeButtons.n === 1 &&
            afterDone === "/recipes/r-alfredo" &&
            cook.open &&
            cook.title === "Cook Chicken alfredo" &&
            cook.rows === 4 &&
            cook.ticked === 3 &&
            cook.greyed === 1 &&
            cook.greyedTitle === "Heavy cream" &&
            cook.logChips.join() === "Ethan,No one" &&
            cook.fits &&
            cookControls.ok &&
            cookButtons.ok &&
            cookButtons.n === 1 &&
            cookPosts.length === 1 &&
            cookEntry("servings") === "4" &&
            cookEntry("log_serving") === "1" &&
            cookEntry("meal_type") === "dinner" &&
            planOpen &&
            planButtons.ok &&
            shareOff.labels.join() === "Add to favourites" &&
            !shareOff.sheet &&
            shareOff.emptyMenus === 0 &&
            shareOff.fits &&
            draft.bar.join() === "Save" &&
            draft.status === "1 thing to fix" &&
            draft.left.join() === "Add the steps." &&
            draft.cook === 0 &&
            draft.plan === 0 &&
            draft.menu.join() === "Discard draft,Cancel,Discard" &&
            draft.subtitle ===
                "Draft · 2 servings · 25 min · from slowfoodmama.com" &&
            draft.barClear &&
            draft.fits &&
            !draft.unverified &&
            refused.error ===
                "Not saved yet. Fix what is listed below, then save it again." &&
            refused.draftBar &&
            refused.marker === "stay" &&
            refused.fits &&
            saved.at === "/recipes/r-draft?saved=1" &&
            !saved.draftBar &&
            saved.bar.join() === "Plan,Cook" &&
            saved.marker === "stay" &&
            savePosts.length === 2;
        recipePageRes[String(width)] = {
            page,
            menuReach,
            menuLabels,
            shareOpen,
            shareControls,
            shareButtons,
            sharePosts,
            made,
            madeControls,
            madeButtons,
            afterDone,
            cook,
            cookControls,
            cookButtons,
            cookPosts,
            planOpen,
            planButtons,
            shareOff,
            draft,
            refused,
            saved,
            savePosts,
        };
        recipePageOk = recipePageOk && ok;
    }
    record(
        "v2 recipe page at 390 and 1440: Plan and Cook in the bar, the Detail bar's ⋯ (Share, the star) opening the share sheet whose Make link posts the expiry and answers a Link ready sheet (Copy, Done back to the recipe), Cook's sheet listing what it takes with the short ingredient greyed and posting servings, who it is logged for and the slot, Plan's sheet, Share gone and no ⋯ empty with mcp-share-links off, and a draft's bar: Save refused in place with what is left, then saved over Turbo; every sheet button measured and the page never wider than the screen",
        recipePageOk,
        { ...recipePageRes, ex: drain() },
    );
    // ---- Plan sheet: Starts opens a month picker, Meal and Repeat are
    // pull-downs, Pick days shows the weekday chips; the form posts the same
    // fields the plan route takes ----
    const planSheetRes: Record<string, unknown> = {};
    let planSheetOk = true;
    const planMenu = (name: string) =>
        `#fd-recipe-plan-sheet [data-anchor="row"]:has([data-fd-menu-field][name="${name}"])`;
    const planFacts = (width: number) =>
        ev<{
            open: boolean;
            title: string | null;
            rows: string[];
            values: string[];
            pickerHidden: boolean;
            daysHidden: boolean;
            fits: boolean;
        }>(`(() => {
            const d = document.querySelector("#fd-recipe-plan-sheet");
            return {
                open: !!d?.open,
                title: d?.querySelector(".fd-sheet__title")?.textContent ?? null,
                rows: [...(d?.querySelectorAll(".fd-item-row__title") ?? [])].map((e) => e.textContent.trim()),
                values: [...(d?.querySelectorAll(".fd-item-row__value") ?? [])].map((e) => e.textContent.trim()),
                pickerHidden: !!d?.querySelector("[data-fd-month-picker]")?.hidden,
                daysHidden: !!d?.querySelector("[data-fd-plan-days]")?.hidden,
                fits: document.documentElement.scrollWidth <= ${width} + 1,
            };
        })()`);
    for (const width of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 600 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await control("reset=posts");
        await goto("/recipes/r-alfredo?plan=1");
        await setMarker();
        await sleep(800);
        const start = await planFacts(width);
        const startButtons = await sheetButtons();
        // Starts: the picker opens inside the sheet, every date in the panel
        // and a real tap target; before today cannot be picked; next and
        // previous move a month; a day picked closes it and reads in the row.
        await clickSel("#fd-recipe-plan-sheet [data-fd-month-toggle]");
        await sleep(200);
        const picker = await ev<{
            shown: boolean;
            expanded: string | null;
            label: string | null;
            days: number;
            inside: boolean;
            tap: boolean;
            pastDisabled: boolean;
            prevDisabled: boolean;
            gapAbove: number;
            gapBelow: number;
        }>(`(() => {
            const d = document.querySelector("#fd-recipe-plan-sheet");
            const p = d.querySelector("[data-fd-month-picker]");
            const startsGroup = d.querySelector("[data-fd-month-toggle]").closest(".fd-list-group");
            const mealGroup = d.querySelector('[data-fd-menu-field][name="slot"]').closest(".fd-list-group");
            const panel = d.querySelector(".fd-sheet-panel").getBoundingClientRect();
            const days = [...p.querySelectorAll("[data-fd-month-day]")];
            const open = days.filter((b) => !b.disabled);
            return {
                shown: !p.hidden && p.getClientRects().length > 0,
                expanded: d.querySelector("[data-fd-month-toggle]").getAttribute("aria-expanded"),
                label: p.querySelector("[data-fd-month-label]").textContent,
                days: days.length,
                inside: days.every((b) => { const r = b.getBoundingClientRect(); return r.left >= panel.left - 1 && r.right <= panel.right + 1; }),
                tap: open.every((b) => { const r = b.getBoundingClientRect(); return r.height >= 40 && r.width >= 32; }),
                pastDisabled: p.querySelector('[data-fd-month-day="2026-11-09"]').disabled && !p.querySelector('[data-fd-month-day="2026-11-10"]').disabled,
                prevDisabled: p.querySelector("[data-fd-month-prev]").disabled,
                gapAbove: Math.round(p.getBoundingClientRect().top - startsGroup.getBoundingClientRect().bottom),
                gapBelow: Math.round(mealGroup.getBoundingClientRect().top - p.getBoundingClientRect().bottom),
            };
        })()`);
        await clickSel("#fd-recipe-plan-sheet [data-fd-month-next]");
        await sleep(100);
        const nextMonth = await ev<{
            label: string | null;
            days: number;
            prevDisabled: boolean;
        }>(`({
            label: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-label]").textContent,
            days: document.querySelectorAll("#fd-recipe-plan-sheet [data-fd-month-day]").length,
            prevDisabled: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-prev]").disabled,
        })`);
        await clickSel("#fd-recipe-plan-sheet [data-fd-month-prev]");
        await sleep(100);
        const backMonth = await ev<{
            label: string | null;
            prevDisabled: boolean;
        }>(`({
            label: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-label]").textContent,
            prevDisabled: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-prev]").disabled,
        })`);
        await clickSel(
            '#fd-recipe-plan-sheet [data-fd-month-day="2026-11-20"]',
        );
        await sleep(100);
        const picked = await ev<{
            field: string | null;
            value: string | null;
            hidden: boolean;
            expanded: string | null;
        }>(`({
            field: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-field]").value,
            value: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-toggle] .fd-item-row__value").textContent,
            hidden: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-picker]").hidden,
            expanded: document.querySelector("#fd-recipe-plan-sheet [data-fd-month-toggle]").getAttribute("aria-expanded"),
        })`);
        // Meal and Repeat: every pull-down item is reachable.
        await clickSel(`${planMenu("slot")} [data-fd-menu-trigger]`);
        await sleep(250);
        const mealReach = await reachItems(planMenu("slot"));
        await menuEsc();
        await clickSel(`${planMenu("repeat")} [data-fd-menu-trigger]`);
        await sleep(250);
        const repeatReach = await reachItems(planMenu("repeat"));
        const repeatLabels = await ev<string[]>(
            `[...document.querySelectorAll(${JSON.stringify(planMenu("repeat") + " .fd-menu__label")})].map((e) => e.textContent)`,
        );
        // Pick days: the seven chips show, fit the sheet and toggle; the row
        // reads the days, Monday first.
        await clickSel(`${planMenu("repeat")} [data-fd-menu-value="days"]`);
        await sleep(250);
        const chipsShown = await ev<{
            n: number;
            visible: boolean;
            inside: boolean;
            tall: boolean;
            names: string;
        }>(`(() => {
            const d = document.querySelector("#fd-recipe-plan-sheet");
            const panel = d.querySelector(".fd-sheet-panel").getBoundingClientRect();
            const chips = [...d.querySelectorAll("[data-fd-plan-days] .fd-pill-chip")];
            return {
                n: chips.length,
                visible: !d.querySelector("[data-fd-plan-days]").hidden && chips.every((c) => c.getClientRects().length > 0),
                inside: chips.every((c) => { const r = c.getBoundingClientRect(); return r.left >= panel.left && r.right <= panel.right; }),
                tall: chips.every((c) => c.getBoundingClientRect().height >= 32),
                names: chips.map((c) => c.getAttribute("aria-label")).join(),
            };
        })()`);
        for (const day of ["1", "3", "5"]) {
            await clickSel(
                `#fd-recipe-plan-sheet [data-fd-plan-days] [data-value="${day}"]`,
            );
        }
        await sleep(150);
        const daysPicked = await ev<{
            row: string | null;
            fields: string[];
            pressed: string[];
        }>(`({
            row: document.querySelector(${JSON.stringify(planMenu("repeat"))} + " .fd-item-row__value").textContent,
            fields: [...document.querySelectorAll('#fd-recipe-plan-sheet input[name="days"]')].map((i) => i.value),
            pressed: [...document.querySelectorAll('#fd-recipe-plan-sheet [data-fd-plan-days] [aria-pressed="true"]')].map((c) => c.textContent.trim()),
        })`);
        const planFit = await ev<boolean>(
            `document.documentElement.scrollWidth <= ${width} + 1`,
        );
        const planSheetButtons = await sheetButtons();
        await ev(
            `document.querySelector('#fd-recipe-plan-sheet [type="submit"]').click()`,
        );
        await sleep(500);
        const repeatPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/plan",
        );
        // Another repeat takes the weekdays away: the chips go and no `days` posts.
        await control("reset=posts");
        await goto("/recipes/r-alfredo?plan=1");
        await sleep(600);
        await clickSel(`${planMenu("repeat")} [data-fd-menu-trigger]`);
        await sleep(200);
        await clickSel(`${planMenu("repeat")} [data-fd-menu-value="days"]`);
        await sleep(200);
        await clickSel(
            '#fd-recipe-plan-sheet [data-fd-plan-days] [data-value="2"]',
        );
        await clickSel(`${planMenu("repeat")} [data-fd-menu-trigger]`);
        await sleep(200);
        await clickSel(`${planMenu("repeat")} [data-fd-menu-value="weekly"]`);
        await sleep(200);
        const weekly = await planFacts(width);
        const weeklyDays = await ev<number>(
            `document.querySelectorAll('#fd-recipe-plan-sheet input[name="days"]').length`,
        );
        await ev(
            `document.querySelector('#fd-recipe-plan-sheet [type="submit"]').click()`,
        );
        await sleep(500);
        const weeklyPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/plan",
        );
        const field = (
            p: { entries: [string, string][] } | undefined,
            k: string,
        ) => p?.entries.filter(([key]) => key === k).map(([, v]) => v) ?? [];
        const ok =
            start.open &&
            start.title === "Plan Chicken alfredo" &&
            start.rows.join() === "Starts,Meal,Repeat" &&
            start.values.join() === "Today,Dinner,Once" &&
            start.pickerHidden &&
            start.daysHidden &&
            start.fits &&
            startButtons.ok &&
            startButtons.n === 1 &&
            picker.shown &&
            picker.expanded === "true" &&
            picker.label === "November 2026" &&
            picker.days === 30 &&
            picker.inside &&
            picker.tap &&
            picker.pastDisabled &&
            picker.prevDisabled &&
            // Starts, the open calendar and Meal sit evenly apart.
            picker.gapAbove >= 8 &&
            Math.abs(picker.gapAbove - picker.gapBelow) <= 1 &&
            nextMonth.label === "December 2026" &&
            nextMonth.days === 31 &&
            !nextMonth.prevDisabled &&
            backMonth.label === "November 2026" &&
            backMonth.prevDisabled &&
            picked.field === "2026-11-20" &&
            picked.value === "Fri 20 Nov" &&
            picked.hidden &&
            picked.expanded === "false" &&
            mealReach.n === 4 &&
            mealReach.bad.length === 0 &&
            repeatReach.n === 5 &&
            repeatReach.bad.length === 0 &&
            repeatLabels.join() ===
                "Once,Every week,Every day,Weekdays,Pick days" &&
            chipsShown.n === 7 &&
            chipsShown.visible &&
            chipsShown.inside &&
            chipsShown.tall &&
            chipsShown.names ===
                "Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday" &&
            daysPicked.row === "Pick days" &&
            daysPicked.fields.join() === "1,3,5" &&
            daysPicked.pressed.join() === "M,W,F" &&
            planFit &&
            planSheetButtons.ok &&
            repeatPosts.length === 1 &&
            field(repeatPosts[0], "date").join() === "2026-11-20" &&
            field(repeatPosts[0], "slot").join() === "dinner" &&
            field(repeatPosts[0], "repeat").join() === "days" &&
            field(repeatPosts[0], "days").join() === "1,3,5" &&
            field(repeatPosts[0], "servings").length === 1 &&
            weekly.daysHidden &&
            weeklyDays === 0 &&
            weeklyPosts.length === 1 &&
            field(weeklyPosts[0], "repeat").join() === "weekly" &&
            field(weeklyPosts[0], "days").length === 0;
        planSheetRes[String(width)] = {
            start,
            startButtons,
            picker,
            nextMonth,
            backMonth,
            picked,
            mealReach,
            repeatReach,
            repeatLabels,
            chipsShown,
            daysPicked,
            planFit,
            planSheetButtons,
            repeatPosts,
            weekly,
            weeklyDays,
            weeklyPosts,
        };
        planSheetOk = planSheetOk && ok;
    }
    record(
        "v2 plan sheet at 390 and 1440: Plan <recipe> with Starts opening a month picker (dates inside the sheet, evenly spaced between Starts and Meal, earlier days off, months move, a pick reads in the row), Meal and Repeat pull-downs with every item reachable, Pick days showing the weekday chips that post their days, another repeat posting none; its button measured and the page never wider than the screen",
        planSheetOk,
        { ...planSheetRes, ex: drain() },
    );
    // ---- The leave guard: the importer's first landing on a draft asks
    // "Discard this recipe?" before a link, a Turbo visit or a form leaves it,
    // never for the page's own actions, a later visit, another person's draft
    // or a saved recipe ----
    const leaveRes: Record<string, unknown> = {};
    let leaveOk = true;
    const KEEP = `[...document.querySelectorAll("#fd-recipe-leave-sheet .fd-sheet__actions .fd-btn")].find((b) => b.textContent.trim() === "Keep editing").click()`;
    for (const width of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 600 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await control("reset=posts");
        await goto("/recipes/r-draft?imported=1");
        await setMarker();
        await sleep(800);
        const leaveFacts = () =>
            ev<{
                at: string;
                marker: string | null;
                open: string[];
                title: string | null;
                text: string | null;
                fits: boolean;
            }>(`(() => {
                const d = document.querySelector("#fd-recipe-leave-sheet");
                return {
                    at: location.pathname + location.search,
                    marker: window.__marker ?? null,
                    open: [...document.querySelectorAll("dialog[open]")].map((e) => e.id),
                    title: d?.querySelector(".fd-sheet__title")?.textContent ?? null,
                    text: d?.querySelector(".fd-sheet__text")?.textContent ?? null,
                    fits: document.documentElement.scrollWidth <= ${width} + 1,
                };
            })()`);
        const closed = await leaveFacts();
        // The Detail bar's back link would leave the page: the sheet opens.
        await clickSel('.fd-detail-bar a[href="/recipes"]');
        await sleep(400);
        const byBack = await leaveFacts();
        const leaveButtons = await sheetButtons();
        const leaveLabels = await ev<string[]>(
            `[...document.querySelectorAll("#fd-recipe-leave-sheet .fd-sheet__actions .fd-btn")].map((b) => b.textContent.trim())`,
        );
        // Keep editing stays on the page, with the draft where it was.
        await ev(KEEP);
        await sleep(300);
        const kept = await leaveFacts();
        // Any other link leaving the page asks too (the tab bar, the sidebar).
        await clickSel('.fd-tabs a[href="/"], .fd-sidebar a[href="/"]');
        await sleep(400);
        const byNav = await leaveFacts();
        await ev(KEEP);
        await sleep(300);
        // A Turbo visit that is not a link click is held too.
        await ev(`Turbo.visit("/recipes")`);
        await sleep(400);
        const byVisit = await leaveFacts();
        await ev(KEEP);
        await sleep(300);
        // So are forms that would leave: a search and Log out.
        const postsBefore = (await stats()).posts.length;
        await ev(
            `(() => { const f = document.createElement("form"); f.method = "get"; f.action = "/search"; document.body.appendChild(f); f.requestSubmit(); f.remove(); })()`,
        );
        await sleep(400);
        const bySearch = await leaveFacts();
        await ev(KEEP);
        await sleep(300);
        await ev(
            `(() => { const f = document.createElement("form"); f.method = "post"; f.action = "/logout"; document.body.appendChild(f); f.requestSubmit(); f.remove(); })()`,
        );
        await sleep(400);
        const byLogout = await leaveFacts();
        await ev(KEEP);
        await sleep(300);
        const heldPosts = (await stats()).posts.length - postsBefore;
        // Discard posts the discard route and lands on Recipes.
        await clickSel('.fd-detail-bar a[href="/recipes"]');
        await sleep(400);
        await ev(
            `[...document.querySelectorAll("#fd-recipe-leave-sheet .fd-sheet__actions .fd-btn")].find((b) => b.textContent.trim() === "Discard").click()`,
        );
        await sleep(700);
        const discarded = await leaveFacts();
        const discardPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-draft/discard",
        );
        // Turbo keeps no copy of the deleted draft for the back button.
        const cachedAfterDiscard = await ev<boolean>(
            `Turbo.session.view.snapshotCache.has(new URL("/recipes/r-draft?imported=1", location.href))`,
        );
        // The page's own action goes straight through: Save asks nothing.
        await control("reset=posts");
        await goto("/recipes/r-draft?imported=1");
        await sleep(600);
        await clickSel("#fd-recipe-draft-bar button[type=submit]");
        await sleep(700);
        const savedFacts = await leaveFacts();
        const savePosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-draft/save",
        );
        // A later visit (Recipes › Drafts) and the owner on a member's draft
        // have no guard: the back link just goes.
        const later: Record<string, unknown> = {};
        let laterOk = true;
        for (const address of [
            "/recipes/r-draft",
            "/recipes/r-draft?theirs=1",
        ]) {
            await goto(address);
            await setMarker();
            await sleep(600);
            const hasSheet = await ev<boolean>(
                `!!document.querySelector("#fd-recipe-leave-sheet")`,
            );
            await clickSel('.fd-detail-bar a[href="/recipes"]');
            await sleep(700);
            const left = await leaveFacts();
            later[address] = { hasSheet, left };
            laterOk =
                laterOk &&
                !hasSheet &&
                left.at === "/recipes" &&
                left.marker === "stay" &&
                left.open.length === 0;
        }
        // A saved recipe never asks: its back link just goes.
        await goto("/recipes/r-alfredo");
        await setMarker();
        await sleep(600);
        const savedHasSheet = await ev<boolean>(
            `!!document.querySelector("#fd-recipe-leave-sheet")`,
        );
        await clickSel('.fd-detail-bar a[href="/recipes"]');
        await sleep(700);
        const savedLeft = await leaveFacts();
        const heldAt = (f: {
            at: string;
            marker: string | null;
            open: string[];
        }) =>
            f.at === "/recipes/r-draft?imported=1" &&
            f.marker === "stay" &&
            f.open.join() === "fd-recipe-leave-sheet";
        const ok =
            closed.open.length === 0 &&
            closed.fits &&
            heldAt(byBack) &&
            byBack.title === "Discard this recipe?" &&
            byBack.text ===
                "Discard deletes it now. A draft you leave unsaved is deleted on Tue 1 Dec." &&
            byBack.fits &&
            leaveButtons.ok &&
            leaveButtons.n === 2 &&
            leaveLabels.join() === "Keep editing,Discard" &&
            kept.at === "/recipes/r-draft?imported=1" &&
            kept.marker === "stay" &&
            kept.open.length === 0 &&
            heldAt(byNav) &&
            heldAt(byVisit) &&
            heldAt(bySearch) &&
            heldAt(byLogout) &&
            heldPosts === 0 &&
            discardPosts.length === 1 &&
            discarded.at === "/recipes" &&
            !cachedAfterDiscard &&
            savePosts.length === 1 &&
            savedFacts.open.length === 0 &&
            laterOk &&
            !savedHasSheet &&
            savedLeft.at === "/recipes" &&
            savedLeft.marker === "stay" &&
            savedLeft.open.length === 0;
        leaveRes[String(width)] = {
            closed,
            byBack,
            leaveButtons,
            leaveLabels,
            kept,
            byNav,
            byVisit,
            bySearch,
            byLogout,
            heldPosts,
            discarded,
            discardPosts,
            cachedAfterDiscard,
            savedFacts,
            savePosts,
            later,
            savedHasSheet,
            savedLeft,
        };
        leaveOk = leaveOk && ok;
    }
    record(
        "v2 leave guard at 390 and 1440: the importer's first landing on a draft (?imported=1) asks Discard this recipe? for a back link, another link, a Turbo visit and a leaving form (search, Log out), Keep editing stays with the page where it was, Discard posts the discard route and lands on Recipes with no cached copy of the draft; Save asks nothing; a later visit, the owner on a member's draft and a saved recipe never ask; its buttons measured and the page never wider than the screen",
        leaveOk,
        { ...leaveRes, ex: drain() },
    );
    // ---- Recipe versions: the whose-version pull-down, Compare versions,
    // Make a version the base, and reset ----
    const versionsRes: Record<string, unknown> = {};
    let versionsOk = true;
    for (const width of [390, 1440]) {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 600 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await control("reset=posts");
        await goto("/recipes/r-alfredo");
        await setMarker();
        await sleep(800);
        const own = await ev<{
            link: string | null;
            icon: boolean;
            onScreen: boolean;
            note: string | null;
            fits: boolean;
            cookVersion: string | null;
        }>(`(() => {
            const link = document.querySelector(".fd-recipe-version [data-fd-menu-trigger]");
            const r = link?.getBoundingClientRect();
            return {
                link: link?.textContent.trim() ?? null,
                icon: !!link?.querySelector("svg"),
                onScreen: !!r && r.left >= 0 && r.right <= ${width} && r.width > 0,
                note: document.querySelectorAll(".fd-recipe-detail .fd-page-layout .fd-item-row")[1]?.querySelector(".fd-item-row__subtitle")?.textContent ?? null,
                fits: document.documentElement.scrollWidth <= ${width} + 1,
                cookVersion: document.querySelector("[data-fd-cook-form] [name=version]")?.value ?? null,
            };
        })()`);
        // The pull-down: Base, each person with a tick on the one shown, and
        // Compare versions; every item reachable and on the screen.
        await clickSel(".fd-recipe-version [data-fd-menu-trigger]");
        await sleep(250);
        const pullReach = await reachItems(".fd-recipe-version");
        const pull = await ev<{
            labels: string[];
            ticked: string[];
            inside: boolean;
            fits: boolean;
        }>(`(() => {
            const panel = document.querySelector(".fd-recipe-version .fd-menu__panel");
            const r = panel.getBoundingClientRect();
            return {
                labels: [...panel.querySelectorAll(".fd-menu__label")].map((e) => e.textContent),
                ticked: [...panel.querySelectorAll('[aria-checked="true"]')].map((e) => e.textContent.trim()),
                inside: r.left >= 0 && r.right <= ${width} && r.width > 0,
                fits: document.documentElement.scrollWidth <= ${width} + 1,
            };
        })()`);
        // Pick Mia: a Turbo visit, her amount on the row, and the cook sheet
        // carries her version to the preview and the confirm.
        await clickSel(
            '.fd-recipe-version a[href="/recipes/r-alfredo?member=u-mia"]',
        );
        await sleep(900);
        const mia = await ev<{
            at: string;
            link: string | null;
            note: string | null;
            marker: string | null;
            cookVersion: string | null;
            previewUrl: string | null;
            fits: boolean;
        }>(`({
            at: location.pathname + location.search,
            link: document.querySelector(".fd-recipe-version [data-fd-menu-trigger]")?.textContent.trim() ?? null,
            note: document.querySelectorAll(".fd-recipe-detail .fd-page-layout .fd-item-row")[1]?.querySelector(".fd-item-row__subtitle")?.textContent ?? null,
            marker: window.__marker ?? null,
            cookVersion: document.querySelector("[data-fd-cook-form] [name=version]")?.value ?? null,
            previewUrl: document.querySelector("[data-fd-cook-form]")?.getAttribute("data-fd-cook-preview-url") ?? null,
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        // The base: no change on any row, and the cook is the base's.
        await goto("/recipes/r-alfredo?member=base");
        await sleep(600);
        const base = await ev<{
            link: string | null;
            notes: number;
            cookVersion: string | null;
            ticked: string[];
        }>(`(() => {
            document.querySelector(".fd-recipe-version [data-fd-menu-trigger]").click();
            return {
                link: document.querySelector(".fd-recipe-version [data-fd-menu-trigger]")?.textContent.trim() ?? null,
                notes: [...document.querySelectorAll(".fd-recipe-detail .fd-page-layout .fd-item-row .fd-item-row__subtitle")].filter((e) => /base/i.test(e.textContent)).length,
                cookVersion: document.querySelector("[data-fd-cook-form] [name=version]")?.value ?? null,
                ticked: [...document.querySelectorAll('.fd-recipe-version [aria-checked="true"]')].map((e) => e.textContent.trim()),
            };
        })()`);
        // A member sees the pull-down and never Compare versions.
        await goto("/recipes/r-alfredo?role=member");
        await clickSel(".fd-recipe-version [data-fd-menu-trigger]");
        await sleep(250);
        const memberPull = await ev<string[]>(
            `[...document.querySelectorAll(".fd-recipe-version .fd-menu__label")].map((e) => e.textContent)`,
        );
        // Compare versions, from the owner's pull-down.
        await goto("/recipes/r-alfredo");
        await setMarker();
        await clickSel(".fd-recipe-version [data-fd-menu-trigger]");
        await sleep(250);
        await clickSel(
            '.fd-recipe-version a[href="/recipes/r-alfredo/compare"]',
        );
        await sleep(900);
        const compare = await ev<{
            at: string;
            title: string | null;
            marker: string | null;
            differing: { title: string | null; sub: string | null }[];
            people: {
                title: string | null;
                sub: string | null;
                menu: boolean;
            }[];
            fits: boolean;
        }>(`({
            at: location.pathname + location.search,
            title: document.querySelector(".fd-detail-bar__title")?.textContent ?? null,
            marker: window.__marker ?? null,
            differing: [...document.querySelectorAll(".fd-recipe-compare .fd-page-layout__column:first-child .fd-item-row")].map((r) => ({
                title: r.querySelector(".fd-item-row__title")?.textContent ?? null,
                sub: r.querySelector(".fd-item-row__subtitle")?.textContent ?? null,
            })),
            people: [...document.querySelectorAll(".fd-recipe-compare .fd-page-layout__column:last-child .fd-item-row")].map((r) => ({
                title: r.querySelector(".fd-item-row__title")?.textContent ?? null,
                sub: r.querySelector(".fd-item-row__subtitle")?.textContent ?? null,
                menu: !!r.querySelector("[data-fd-menu-trigger]"),
            })),
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        // Mia's ⋯: Align to base, Make hers the base, Delete her version, all reachable.
        const miaMenu =
            ".fd-recipe-compare .fd-page-layout__column:last-child li:nth-child(3) .fd-menu";
        await clickSel(miaMenu + " [data-fd-menu-trigger]");
        await sleep(250);
        const miaReach = await reachItems(miaMenu);
        // Align to base is drawn plain, Delete in the danger tone.
        const armTones = await ev<boolean[]>(
            `[...document.querySelectorAll(${JSON.stringify(miaMenu + " [data-fd-menu-arm]")})].map((b) => b.classList.contains("fd-menu__item--danger"))`,
        );
        const miaLabels = await ev<string[]>(
            `[...document.querySelectorAll(${JSON.stringify(miaMenu + " .fd-menu__label")})].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent)`,
        );
        // Make Mia's the base: the sheet lists what align can push (not the
        // removal), and Use posts that change, as the compare read named it.
        await control("reset=posts");
        await clickSel(miaMenu + ' [commandfor="fd-compare-base-u-mia"]');
        await sleep(500);
        const makeBase = await ev<{
            open: boolean;
            rows: string[];
            fits: boolean;
        }>(`({
            open: !!document.querySelector("#fd-compare-base-u-mia[open]"),
            rows: [...document.querySelectorAll("#fd-compare-base-u-mia .fd-item-row .fd-item-row__title")].map((e) => e.textContent),
            fits: document.documentElement.scrollWidth <= ${width} + 1,
        })`);
        const makeBaseControls = await dialogControls();
        await ev(
            `document.querySelector('#fd-compare-base-u-mia form[action$="/versions/align"] button[type=submit]').click()`,
        );
        await sleep(700);
        const alignPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/versions/align",
        );
        // Delete Mia's version asks in place, then posts the rows it showed.
        await goto("/recipes/r-alfredo/compare");
        await control("reset=posts");
        await clickSel(miaMenu + " [data-fd-menu-trigger]");
        await sleep(250);
        await ev(
            `[...document.querySelectorAll(${JSON.stringify(miaMenu + " [data-fd-menu-arm]")})].find((b) => /Delete/.test(b.textContent)).click()`,
        );
        await sleep(200);
        const asked = await ev<{ confirm: string[] }>(`({
            confirm: [...document.querySelectorAll(${JSON.stringify(miaMenu + " .fd-menu__confirm-row:not([hidden]) .fd-menu__label")})].map((e) => e.textContent),
        })`);
        const noPostYet = (await stats()).posts.length === 0;
        await ev(
            `document.querySelector(${JSON.stringify(miaMenu + " .fd-menu__confirm-row:not([hidden]) form button[type=submit]")}).click()`,
        );
        await sleep(700);
        const resetPosts = (await stats()).posts.filter(
            (p) => p.path === "/recipes/r-alfredo/versions/reset",
        );
        const entry = (
            posts: { entries: [string, string][] }[],
            name: string,
        ) => posts[0]?.entries.filter(([k]) => k === name).map(([, v]) => v);
        const ok =
            own.link === "Per serving · Ethan · 1 change from base" &&
            own.icon &&
            own.onScreen &&
            own.note?.startsWith("Yours · base 6 oz") === true &&
            own.fits &&
            own.cookVersion === "u-ethan" &&
            pullReach.n === 6 &&
            pullReach.bad.length === 0 &&
            pull.labels.join() ===
                "Base,Ethan,Sarah,Mia,Leo,Compare versions" &&
            pull.ticked.join() === "Ethan" &&
            pull.inside &&
            pull.fits &&
            mia.at === "/recipes/r-alfredo?member=u-mia" &&
            mia.link === "Per serving · Mia · 2 changes from base" &&
            mia.note?.startsWith("Mia's · base 6 oz") === true &&
            mia.marker === "stay" &&
            mia.cookVersion === "u-mia" &&
            mia.previewUrl === "/recipes/r-alfredo/cook/preview/u-mia" &&
            mia.fits &&
            base.link === "Per serving · Base" &&
            base.notes === 0 &&
            base.cookVersion === null &&
            base.ticked.join() === "Base" &&
            memberPull.join() === "Base,Ethan,Sarah,Mia,Leo" &&
            compare.at === "/recipes/r-alfredo/compare" &&
            compare.title === "Compare versions" &&
            compare.marker === "stay" &&
            compare.differing.map((d) => d.title).join() ===
                "Chicken thighs,Fish sauce,Chili flakes" &&
            compare.differing.map((d) => d.sub).join("|") ===
                "Base 6 oz · Ethan 8 oz · Mia 10 oz|Base 1 tbsp · Mia none|Not in base · Mia 1 tsp" &&
            compare.people
                .map((p) => `${p.title}:${p.sub}:${p.menu}`)
                .join("|") ===
                "Ethan:1 change:true|Sarah:No version yet:false|Mia:2 changes · 1 added:true|Leo:No version yet:false" &&
            compare.fits &&
            miaReach.n === 3 &&
            miaReach.bad.length === 0 &&
            miaLabels.join() ===
                "Align Mia to base,Make Mia's the base,Delete Mia's version" &&
            makeBase.open &&
            makeBase.rows.join() === "Chicken thighs,Chili flakes" &&
            makeBase.fits &&
            makeBaseControls.ok &&
            armTones.join() === "false,true" &&
            alignPosts.length === 1 &&
            entry(alignPosts, "back")?.join() === "compare" &&
            entry(alignPosts, "user_id")?.join() === "u-mia" &&
            entry(alignPosts, "ingredient_id")?.join() === "i-thighs" &&
            entry(alignPosts, "row_key")?.join() ===
                "o-mia-thighs@2026-11-10" &&
            asked.confirm.join() === "Cancel,Delete" &&
            noPostYet &&
            resetPosts.length === 1 &&
            entry(resetPosts, "user_id")?.join() === "u-mia" &&
            entry(resetPosts, "confirm")?.join() === "1" &&
            entry(resetPosts, "back")?.join() === "compare" &&
            entry(resetPosts, "row_keys")?.join() ===
                "o-mia-thighs@2026-11-10,o-mia-fish@2026-11-10,o-mia-chili@2026-11-10";
        versionsRes[String(width)] = {
            own,
            pullReach,
            pull,
            mia,
            base,
            memberPull,
            compare,
            miaReach,
            miaLabels,
            armTones,
            makeBase,
            makeBaseControls,
            alignPosts,
            asked,
            resetPosts,
        };
        versionsOk = versionsOk && ok;
    }
    record(
        "v2 recipe versions at 390 and 1440: the Per serving link opens the whose-version pull-down (Base, each person with a tick, Compare versions for the owner, all reachable and on the screen), picking Mia is a Turbo visit with her amounts on the rows and the cook sheet carrying her version, the base shows no change, a member never sees Compare versions, Compare versions lists what differs and each person's changes, Mia's ⋯ (Align to base, Make hers the base, Delete her version) is reachable, Make hers the base posts the change it names, Delete asks in place and posts the rows it showed; every sheet button measured and the page never wider than the screen",
        versionsOk,
        { ...versionsRes, ex: drain() },
    );
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
    });
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
    // A tap on a row opens its edit sheet: tapped first, on the fresh page,
    // and closed again before the swipes.
    const tapY = await ev<number>(
        `(() => { const r = document.querySelector('li[data-fd-meal-id="m1"] .fd-item-row__face').getBoundingClientRect(); return r.top + r.height / 2; })()`,
    );
    await send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 120, y: tapY }],
    });
    await sleep(60);
    await send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
    });
    let tapped: string[] = [];
    for (let i = 0; i < 20 && tapped.length === 0; i++) {
        await sleep(100);
        tapped = await ev<string[]>(
            `[...document.querySelectorAll("dialog[open]")].map((d) => d.id)`,
        );
    }
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
    await sleep(300);
    await swipeRow("m2", 0.15, 0.85);
    await swipeRow("m3", 0.85, 0.15);
    const swipePosts = (await stats()).posts.map((p) => p.path);
    const beds = await ev<{ again: boolean; del: boolean; swipe: boolean }>(`({
        again: !!document.querySelector('li[data-fd-meal-id="m2"] .fd-item-row__bed--again form[action="/meals/m2/again"]'),
        del: !!document.querySelector('li[data-fd-meal-id="m3"] .fd-item-row__bed--delete form[action="/meals/m3/delete"]'),
        swipe: document.querySelectorAll("li[data-fd-meal-id].fd-item-row--swipe").length >= 3,
    })`);
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

    // On a touch screen at 1024 px or wider the Top bar's field is still the
    // opener, but closing the sheet must not focus its text input (the
    // keyboard would rise): focus goes to the field's wrapper.
    await send("Emulation.setTouchEmulationEnabled", {
        enabled: true,
        maxTouchPoints: 1,
    });
    await goto("/");
    const touchField = await ev<{ coarse: boolean; wide: boolean }>(`({
        coarse: matchMedia("(pointer: coarse)").matches,
        wide: innerWidth >= 1024 && getComputedStyle(document.querySelector(".fd-top-bar")).display !== "none",
    })`);
    await focusField();
    await tap("Enter", "Enter", 13);
    const touchOpen = await fieldState();
    await tap("Escape", "Escape", 27);
    const touchClosed = await ev<{
        open: number;
        tag: string;
        onInput: boolean;
        onWrapper: boolean;
    }>(`(() => {
        const a = document.activeElement;
        return {
            open: document.querySelectorAll("dialog[open]").length,
            tag: a ? a.tagName : "none",
            onInput: a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement,
            onWrapper: a === document.querySelector(".fd-top-bar .fd-search-field"),
        };
    })()`);
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await goto("/");
    record(
        "v2 top bar search field on a touch screen at 1024 px or wider: closing the sheet returns focus to the field's wrapper, never its text input",
        touchField.coarse &&
            touchField.wide &&
            touchOpen.open.includes("fd-log-search") &&
            touchClosed.open === 0 &&
            !touchClosed.onInput &&
            touchClosed.onWrapper,
        { touchField, touchOpen, touchClosed, ex: drain() },
    );

    // ---- The log sheets: a result row opens its thing, its plus logs it ----
    // The rows are the Item row: the face is a link with a chevron that opens
    // the food or recipe, the plus beside it opens the amount sheet and Add
    // posts /log with the fields the route reads. A past meal has no link.
    const openLogSearch = async () => {
        await ev(
            `(() => { const d = document.getElementById("fd-log-search"); if (!d.open) d.showModal(); })()`,
        );
        await sleep(300);
    };
    const typeIntoSearch = async (text: string) => {
        await ev(`(() => {
            const i = document.getElementById("fd-log-search-q");
            i.value = ${JSON.stringify(text)};
            i.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await sleep(900);
    };
    await goto("/");
    await setMarker();
    await control("reset=posts");
    await openLogSearch();
    await typeIntoSearch("chick");
    const logRows = await ev<{
        rows: {
            title: string | null;
            href: string | null;
            chevron: boolean;
            add: boolean;
            option: string | null;
        }[];
        filters: number;
        filtersShown: boolean;
        listbox: string | null;
    }>(`({
        rows: [...document.querySelectorAll("#fd-log-search .fd-item-row")].map((r) => ({
            title: r.querySelector(".fd-item-row__title")?.textContent ?? null,
            href: r.querySelector("a.fd-item-row__anchor")?.getAttribute("href") ?? null,
            chevron: !!r.querySelector(".fd-item-row__chevron"),
            add: !!r.querySelector(".fd-item-row__add"),
            option: r.getAttribute("role"),
        })),
        filters: document.querySelectorAll('#fd-log-search input[name="fd_log_filter"]').length,
        filtersShown: !document.querySelector("[data-fd-log-filters]").hidden,
        listbox: document.querySelector("#fd-log-search [data-fd-log-result-list]")?.getAttribute("role") ?? null,
    })`);
    // The plus of the first row opens the amount sheet; Add posts what main posts.
    await clickSel("#fd-log-search .fd-item-row .fd-item-row__add");
    await sleep(500);
    const amountOpen = await ev<{
        open: boolean;
        title: string | null;
        searchOpen: boolean;
        amount: string | null;
        macros: number;
    }>(`({
        open: document.getElementById("fd-log-amount").open,
        title: document.querySelector("#fd-log-amount .fd-sheet__title")?.textContent ?? null,
        searchOpen: document.getElementById("fd-log-search").open,
        amount: document.getElementById("fd-log-amount-value")?.value ?? null,
        macros: document.querySelectorAll("#fd-log-amount .fd-macro-tile").length,
    })`);
    await clickSel("[data-fd-log-submit]");
    await sleep(600);
    const logPost = (await stats()).posts.find((p) => p.path === "/log");
    const logFields = Object.fromEntries(logPost?.entries ?? []);
    record(
        "v2 log search: rows open their food, recipe or fridge item and a plus logs it; the plus opens the amount sheet and Add posts /log",
        logRows.rows.length === 3 &&
            logRows.rows[0]!.title === "Chicken breast, grilled" &&
            logRows.rows[0]!.href === "/foods/f-chicken" &&
            logRows.rows[0]!.chevron &&
            logRows.rows[0]!.add &&
            logRows.rows[1]!.href === "/recipes/r-alfredo" &&
            // A past meal only logs: no link, no chevron, a plus.
            logRows.rows[2]!.href === null &&
            !logRows.rows[2]!.chevron &&
            logRows.rows[2]!.add &&
            logRows.rows.every((r) => r.option === "option") &&
            logRows.listbox === "listbox" &&
            logRows.filters === 4 &&
            logRows.filtersShown &&
            amountOpen.open &&
            amountOpen.title === "Chicken breast, grilled" &&
            !amountOpen.searchOpen &&
            amountOpen.amount === "100" &&
            amountOpen.macros === 4 &&
            logFields.food_id === "f-chicken" &&
            logFields.amount === "100" &&
            logFields.unit === "g" &&
            logFields.return_to === "/" &&
            logFields.display_name === "Chicken breast, grilled" &&
            ["breakfast", "lunch", "dinner", "snack"].includes(
                logFields.meal_type ?? "",
            ) &&
            !("logged_at" in logFields),
        { logRows, amountOpen, logFields, ex: drain() },
    );

    // A row's face opens its page.
    await goto("/");
    await setMarker();
    await openLogSearch();
    await typeIntoSearch("chick");
    await clickSel("#fd-log-search a.fd-item-row__anchor");
    await sleep(500);
    const rowOpened = await ev<string>(`location.pathname`);
    record(
        "v2 log search: tapping a result row opens its page",
        rowOpened === "/foods/f-chicken",
        { rowOpened, ex: drain() },
    );

    // The product page: a Detail bar with Back and a ⋯, a nutrition Table, and
    // two actions that go where they always went.
    await goto("/foods/f-chicken");
    await setMarker();
    await control("reset=posts");
    const productPage = await ev<{
        back: string | null;
        title: string | null;
        header: string[];
        rows: number;
        buttons: string[];
        widths: number[];
        gap: number;
    }>(`({
        back: document.querySelector(".fd-product-page .fd-detail-bar a[aria-label='Back']")?.getAttribute("href") ?? null,
        title: document.querySelector(".fd-product-page .fd-page-header__title")?.textContent ?? null,
        header: [...document.querySelectorAll(".fd-product-page .fd-table-row--header [role='columnheader']")].map((c) => c.textContent.trim()).filter(Boolean),
        rows: document.querySelectorAll(".fd-product-page .fd-table-row:not(.fd-table-row--header)").length,
        buttons: [...document.querySelectorAll(".fd-product-actions [data-fd-btn]")].map((b) => b.textContent.trim()),
        widths: [...document.querySelectorAll(".fd-product-actions [data-fd-btn]")].map((b) => Math.round(b.getBoundingClientRect().width)),
        gap: (() => { const [a, b] = [...document.querySelectorAll(".fd-product-actions [data-fd-btn]")].map((x) => x.getBoundingClientRect()); return a && b ? Math.round(b.left - a.right) : -1; })(),
    })`);
    await clickSel(".fd-product-detail [data-fd-menu-trigger]");
    await sleep(150);
    const productMenu = await ev<{ items: string[]; hrefs: string[] }>(`({
        items: [...document.querySelectorAll(".fd-product-detail [role='menuitem']")].map((i) => i.textContent.trim()),
        hrefs: [...document.querySelectorAll(".fd-product-detail [role='menuitem']")].map((i) => i.getAttribute("href") ?? ""),
    })`);
    await clickSel("[data-fd-log-pick]");
    await sleep(400);
    const productLog = await ev<{ open: boolean; title: string | null }>(`({
        open: document.getElementById("fd-log-amount").open,
        title: document.querySelector("#fd-log-amount .fd-sheet__title")?.textContent ?? null,
    })`);
    await ev(`document.getElementById("fd-log-amount").close()`);
    await clickSel(".fd-product-actions form button");
    await sleep(500);
    const productPosts = (await stats()).posts.filter((p) =>
        p.path.startsWith("/foods/"),
    );
    record(
        "v2 product page: Back and a ⋯ in the Detail bar, the Table reads '1 serving' beside '100 g', the ⋯ edits in Saved foods, Log it opens the amount sheet and Add to groceries posts its route; the two actions are equal with a gap",
        productPage.back !== null &&
            productPage.title === "Greek yogurt, plain 2%" &&
            productPage.header.join("|") === "1 serving · 170 g|100 g" &&
            productPage.rows === 6 &&
            productPage.buttons.join("|") === "Add to groceries|Log it" &&
            productPage.widths.length === 2 &&
            Math.abs(productPage.widths[0]! - productPage.widths[1]!) <= 1 &&
            productPage.gap >= 8 &&
            productMenu.items.join("|") === "Edit in Saved foods" &&
            productMenu.hrefs[0]!.startsWith("/settings/saved?q=") &&
            productLog.open &&
            productLog.title === "Greek yogurt, plain 2%" &&
            productPosts.length === 1 &&
            productPosts[0]!.path === "/foods/f-product-full/add-to-grocery" &&
            productPosts[0]!.entries.length === 0,
        { productPage, productMenu, productLog, productPosts, ex: drain() },
    );

    // Kitchen › Fridge on the phone: rows, the row ⋯ and its posts, swipe, and
    // the + beside the tabs (no ⋯, no select mode).
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
    await goto("/kitchen/fridge");
    await setMarker();
    await control("reset=posts");
    const fridgePhone = await ev<{
        rows: number;
        sections: string[];
        cards: number;
        eggs: string;
        cheeseValue: string;
        scores: number;
        topTools: string[];
        toolsLevel: number;
        tabsHidden: boolean;
        headActions: string;
    }>(`({
        rows: document.querySelectorAll("li[id^='fd-fridge-row-']").length,
        sections: [...document.querySelectorAll(".fd-kitchen-loc .fd-section-header__label")].map((h) => h.textContent),
        cards: document.querySelectorAll(".fd-kitchen-use-soon .fd-mini-card").length,
        eggs: document.querySelector("#fd-fridge-row-it-eggs .fd-item-row__subtitle")?.textContent ?? "",
        cheeseValue: document.querySelector("#fd-fridge-row-it-cheese .fd-item-row__value")?.textContent ?? "",
        scores: document.querySelectorAll(".fd-kitchen-loc .fd-score-pill").length,
        topTools: [...document.querySelectorAll(".fd-kitchen-fridge-top button[aria-label]")].map((b) => b.getAttribute("aria-label")),
        toolsLevel: (() => {
            const t = document.querySelector(".fd-kitchen-fridge-top").getBoundingClientRect();
            const row = document.querySelector(".fd-kitchen-tabs").getBoundingClientRect();
            return Math.round(Math.abs((t.top + t.height / 2) - (row.top + row.height / 2)));
        })(),
        tabsHidden: getComputedStyle(document.querySelector(".fd-kitchen-tabs")).display === "none",
        headActions: getComputedStyle(document.querySelector(".fd-kitchen-head .fd-page-header__actions")).display,
    })`);
    await clickSel("#fd-fridge-row-it-eggs .fd-menu [data-fd-menu-trigger]");
    await sleep(150);
    const fridgeRowMenu = await ev<string[]>(
        `[...document.querySelectorAll("#fd-fridge-row-it-eggs [role='menuitem']")].map((i) => i.textContent.trim())`,
    );
    await clickSel("#fd-fridge-row-it-eggs [data-fd-menu-arm]");
    await sleep(100);
    const fridgeConfirm = await ev<string[]>(
        `[...document.querySelectorAll("#fd-fridge-row-it-eggs .fd-menu__confirm-row [role='menuitem']")].filter((i) => i.offsetParent !== null).map((i) => i.textContent.trim())`,
    );
    await clickSel(
        '#fd-fridge-row-it-eggs form[action="/kitchen/fridge/items/it-eggs/discard"] [type="submit"]',
    );
    await sleep(500);
    await clickSel(
        '#fd-fridge-row-it-eggs form[action="/kitchen/fridge/items/it-eggs/eat"] [type="submit"]',
    );
    await sleep(500);
    const fridgeSwipe = async (id: string, from: number, to: number) => {
        const box = await ev<{ x: number; y: number; w: number }>(`(() => {
            const r = document.querySelector('#fd-fridge-row-${id} .fd-item-row__face').getBoundingClientRect();
            return { x: r.left, y: r.top + r.height / 2, w: r.width };
        })()`);
        const x0 = box.x + box.w * from;
        const x1 = box.x + box.w * to;
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
    await fridgeSwipe("it-cheese", 0.15, 0.85);
    await fridgeSwipe("it-lime", 0.85, 0.15);
    const fridgePosts = (await stats()).posts.map(
        (p) => `${p.path} ${p.entries.map((e) => e.join("=")).join("&")}`,
    );
    record(
        "v2 fridge on the phone: Use soon cards, rows by place with the date at the end, the low words and a score, only + beside the tabs; a row's ⋯ is Eat, Add to grocery list, Edit amount or expiry and Discard (confirmed in place); Eat and Discard and both swipes post the routes and fields they always did",
        fridgePhone.rows === 6 &&
            fridgePhone.sections.join("|") === "Fridge|Pantry" &&
            fridgePhone.cards === 3 &&
            fridgePhone.eggs === "Tomorrow · low, below 6" &&
            fridgePhone.cheeseValue === "Nov 23" &&
            fridgePhone.scores === 2 &&
            fridgePhone.topTools.join("|") === "Add item" &&
            fridgePhone.toolsLevel <= 8 &&
            !fridgePhone.tabsHidden &&
            fridgePhone.headActions === "none" &&
            fridgeRowMenu.slice(0, 4).join("|") ===
                "Eat|Add to grocery list|Edit amount or expiry|Discard" &&
            fridgeConfirm.join("|") === "Cancel|Discard" &&
            fridgePosts.join("\n") ===
                [
                    "/kitchen/fridge/items/it-eggs/discard return_to=/kitchen/fridge",
                    "/kitchen/fridge/items/it-eggs/eat qty_amount=1&return_to=/kitchen/fridge",
                    "/kitchen/fridge/items/it-cheese/eat qty_amount=100&return_to=/kitchen/fridge",
                    "/kitchen/fridge/items/it-lime/discard return_to=/kitchen/fridge",
                ].join("\n"),
        { fridgePhone, fridgeRowMenu, fridgeConfirm, fridgePosts, ex: drain() },
    );

    // Kitchen › Fridge at 1440: the sections are the sidebar's sub-links, the
    // header's Actions slot holds only +, and the two columns sit side by side.
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/kitchen/fridge");
    await setMarker();
    await control("reset=posts");
    const fridgeDesk = await ev<{
        subs: string[];
        current: string;
        tabs: string;
        actions: string[];
        phoneTools: string;
        leftHas: string[];
        rightHas: string[];
        sideBySide: boolean;
        cards: number;
        cardWidths: number[];
    }>(`({
        cardWidths: [...document.querySelectorAll(".fd-kitchen-use-soon .fd-mini-card")].filter((c) => c.offsetParent !== null).map((c) => Math.round(c.getBoundingClientRect().width)),
        subs: [...document.querySelectorAll(".fd-sidebar a.fd-side-link--sub")].map((a) => a.textContent.trim()),
        current: document.querySelector(".fd-sidebar a.fd-side-link--sub[aria-current='page']")?.textContent.trim() ?? "",
        tabs: getComputedStyle(document.querySelector(".fd-kitchen-tabs")).display,
        actions: [...document.querySelectorAll(".fd-kitchen-head .fd-page-header__actions button[aria-label]")].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute("aria-label")),
        phoneTools: getComputedStyle(document.querySelector(".fd-kitchen-fridge-top")).display,
        leftHas: [...document.querySelectorAll(".fd-page-layout__column:first-child .fd-section-header__label")].map((h) => h.textContent),
        rightHas: [...document.querySelectorAll(".fd-page-layout__column:last-child .fd-section-header__label")].map((h) => h.textContent),
        sideBySide: (() => {
            const [a, b] = [...document.querySelectorAll(".fd-kitchen-fridge-layout .fd-page-layout__column")].map((c) => c.getBoundingClientRect());
            return !!a && !!b && b.left >= a.right && Math.abs(a.top - b.top) < 2;
        })(),
        cards: [...document.querySelectorAll(".fd-kitchen-use-soon .fd-mini-card")].filter((c) => c.offsetParent !== null).length,
    })`);
    record(
        "v2 fridge at 1440px: Kitchen's sections are the sidebar's sub-links (Fridge current, no tab row), only + sits in the header, Use soon (cards at their 150px) and the first place are the left column",
        fridgeDesk.subs.join("|") === "Fridge|Groceries|Usuals" &&
            fridgeDesk.current === "Fridge" &&
            fridgeDesk.tabs === "none" &&
            fridgeDesk.actions.join("|") === "Add item" &&
            fridgeDesk.phoneTools === "none" &&
            fridgeDesk.leftHas.join("|") === "Use soon" &&
            fridgeDesk.rightHas.join("|") === "Fridge|Pantry" &&
            fridgeDesk.sideBySide &&
            fridgeDesk.cards === 3 &&
            fridgeDesk.cardWidths.every((w) => w === 150),
        {
            fridgeDesk,
            ex: drain(),
        },
    );

    // The item sheet from a row and from a Use soon card, and Save and the add
    // sheet post what they always did.
    await goto("/kitchen/fridge");
    await setMarker();
    await control("reset=posts");
    await clickSel("[data-fd-open-item='fd-fridge-item-it-cremini']");
    await sleep(300);
    const fridgeSheet = await ev<{
        open: string[];
        title: string;
        sub: string;
        actions: string[];
        useIn: string;
        kept: string[];
        expires: string[];
        fieldShown: boolean;
    }>(`({
        open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
        title: document.querySelector("#fd-fridge-item-it-cremini .fd-sheet__title")?.textContent ?? "",
        sub: document.querySelector("#fd-fridge-item-it-cremini .fd-sheet__subtitle")?.textContent ?? "",
        actions: [...document.querySelectorAll("#fd-fridge-item-it-cremini .fd-kitchen-item-actions .fd-quick-action")].map((b) => b.getAttribute("aria-label")),
        useIn: document.querySelector("#fd-fridge-item-it-cremini .fd-sheet__section--rows")?.textContent.replace(/\\s+/g, " ").trim() ?? "",
        kept: [...document.querySelectorAll("#fd-fridge-item-it-cremini input[name='location_id']")].map((i) => i.value + (i.checked ? "*" : "")),
        expires: [...document.querySelectorAll("#fd-fridge-item-it-cremini input[name='expires_mode']")].map((i) => i.value + (i.checked ? "*" : "")),
        fieldShown: document.querySelector("#fd-fridge-item-it-cremini .fd-kitchen-item-expires__field").offsetParent !== null,
    })`);
    await ev(`document.getElementById("fd-fridge-item-it-cremini").close()`);
    await clickSel("#fd-fridge-row-it-eggs .fd-item-row__face");
    await sleep(300);
    await clickSel(
        "#fd-fridge-item-it-eggs input[name='location_id'][value='l-freezer']",
    );
    await clickSel(
        "#fd-fridge-item-it-eggs input[name='expires_mode'][value='none']",
    );
    await sleep(100);
    const fridgeExpires = await ev<string>(
        `document.querySelector("#fd-fridge-item-it-eggs input[name='expires_on']").value`,
    );
    await clickSel(
        "#fd-fridge-item-it-eggs .fd-sheet__actions button[type='submit']",
    );
    await sleep(600);
    const fridgeSave = (await stats()).posts.map(
        (p) => `${p.path} ${p.entries.map((e) => e.join("=")).join("&")}`,
    );
    record(
        "v2 fridge item sheet: a Use soon card opens its item with the four actions, the recipe that uses it, Kept in and Expires chips; Save posts the amount, unit, place and the cleared date to the item's route",
        fridgeSheet.open.join() === "fd-fridge-item-it-cremini" &&
            fridgeSheet.title === "Cremini mushrooms" &&
            fridgeSheet.sub === "Fridge · expired" &&
            fridgeSheet.actions.join("|") ===
                "Ate some|Add to grocery list|Freeze|Discard" &&
            fridgeSheet.useIn.includes("Salmon & rice") &&
            fridgeSheet.useIn.includes("Uses 2 things expiring") &&
            fridgeSheet.kept.join("|") === "l-fridge*|l-freezer|l-pantry" &&
            fridgeSheet.expires.join("|") === "keep*|none|pick" &&
            !fridgeSheet.fieldShown &&
            fridgeExpires === "" &&
            fridgeSave.join("\n") ===
                "/kitchen/fridge/items/it-eggs return_to=/kitchen/fridge&qty_amount=2&qty_unit=each&location_id=l-freezer&expires_mode=none&expires_on=",
        { fridgeSheet, fridgeExpires, fridgeSave, ex: drain() },
    );

    // Add to fridge: the usuals first, the search narrows them, a plus posts
    // the add route with that food.
    await goto("/kitchen/fridge");
    await setMarker();
    await control("reset=posts");
    await clickSel(
        ".fd-kitchen-head .fd-page-header__actions [aria-label='Add item']",
    );
    await sleep(300);
    const fridgeAdd0 = await ev<{
        open: boolean;
        usuals: string[];
        title: string;
        close: boolean;
        searchBelow: boolean;
    }>(`({
        open: document.getElementById("fd-fridge-add").open,
        usuals: [...document.querySelectorAll("#fd-fridge-add [data-fd-fridge-usual]")].map((r) => r.querySelector(".fd-item-row__title").textContent),
        title: document.querySelector("#fd-fridge-add .fd-sheet__title")?.textContent ?? "",
        close: !!document.querySelector("#fd-fridge-add .fd-sheet__header [command='close']"),
        searchBelow: document.getElementById("fd-fridge-add-q").getBoundingClientRect().top >= document.querySelector("#fd-fridge-add .fd-sheet__header").getBoundingClientRect().bottom,
    })`);
    await ev(`(() => {
        const input = document.getElementById("fd-fridge-add-q");
        input.value = "mil";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    const fridgeAddFiltered = await ev<string[]>(
        `[...document.querySelectorAll("#fd-fridge-add [data-fd-fridge-usual]")].filter((r) => !r.hidden).map((r) => r.querySelector(".fd-item-row__title").textContent)`,
    );
    const fridgeAddSupply = await ev<string>(
        `[...document.querySelectorAll("#fd-fridge-add [data-fd-fridge-usual='paper towels'] input[type=hidden]")].map((i) => i.name + "=" + i.value).join("&")`,
    );
    const fridgeAddName = await ev<string>(
        `document.getElementById("fd-fridge-add-name").value`,
    );
    await clickSel(
        "#fd-fridge-add [data-fd-fridge-usual='milk'] .fd-item-row__add",
    );
    await sleep(600);
    const fridgeAddPosts = (await stats()).posts.map(
        (p) => `${p.path} ${p.entries.map((e) => e.join("=")).join("&")}`,
    );
    record(
        "v2 fridge Add to fridge: the + in the header opens the search sheet with the usuals first, typing narrows them and fills the hand form's Name, and a usual's plus posts the add route with its food, place and usual amount (a supply usual posts as a supply)",
        fridgeAdd0.open &&
            fridgeAdd0.title === "Add to fridge" &&
            fridgeAdd0.close &&
            fridgeAdd0.searchBelow &&
            fridgeAdd0.usuals.join("|") === "Milk|Eggs|Paper towels" &&
            fridgeAddSupply.includes("kind=supply") &&
            fridgeAddSupply.includes("name=Paper towels") &&
            fridgeAddFiltered.join("|") === "Milk" &&
            fridgeAddName === "mil" &&
            fridgeAddPosts.join("\n") ===
                "/kitchen/fridge/items kind=food&food_id=p-milk&location_id=l-fridge&qty_amount=1&qty_unit=gal",
        {
            fridgeAdd0,
            fridgeAddFiltered,
            fridgeAddSupply,
            fridgeAddName,
            fridgeAddPosts,
            ex: drain(),
        },
    );

    // Not here? Add it by hand: the form's Add button keeps its height and the
    // sheet's width on the phone and at 1440, and posts what the route takes.
    const handCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await goto("/kitchen/fridge");
        await setMarker();
        await control("reset=posts");
        await ev(`document.getElementById("fd-fridge-add").showModal()`);
        await sleep(300);
        await ev(
            `document.querySelector("#fd-fridge-add .fd-kitchen-hand").open = true`,
        );
        await sleep(100);
        await ev(`(() => {
            const name = document.getElementById("fd-fridge-add-name");
            name.value = "Basil";
            name.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        const box = await ev<{ h: number; w: number; formW: number }>(`(() => {
            const b = document.querySelector("#fd-fridge-add-form button[type=submit]").getBoundingClientRect();
            return { h: Math.round(b.height), w: Math.round(b.width), formW: Math.round(document.getElementById("fd-fridge-add-form").getBoundingClientRect().width) };
        })()`);
        const steppers = await ev<number[]>(
            `[...document.querySelectorAll("#fd-fridge-add-form [data-fd-step]")].map((b) => Math.round(b.getBoundingClientRect().width))`,
        );
        await clickSel("#fd-fridge-add-form button[type=submit]");
        await sleep(600);
        const posts = (await stats()).posts.map(
            (p) => `${p.path} ${p.entries.map((e) => e.join("=")).join("&")}`,
        );
        return { box, steppers, posts };
    };
    const handPhone = await handCase(390);
    const handDesk = await handCase(1440);
    const handPost =
        "/kitchen/fridge/items kind=food&food_name=Basil&location_id=l-fridge&qty_amount=1&qty_unit=each";
    record(
        "v2 fridge Add by hand: the form's Add button is at least 40px tall and as wide as the form, the stepper's buttons stay 48px, and a click posts the add route with the name, place and amount, on the phone and at 1440",
        [handPhone, handDesk].every(
            (c) =>
                c.box.h >= 40 &&
                c.box.w >= c.box.formW - 1 &&
                c.steppers.length === 2 &&
                c.steppers.every((w) => w === 48) &&
                c.posts.join("\n") === handPost,
        ),
        { handPhone, handDesk, ex: drain() },
    );
    await goto("/");
    await setMarker();

    // Kitchen › Groceries on the phone: rows by section with the check ring,
    // the allergen words and the amount, the filter, ⋯ and + beside the tabs,
    // the dock for the checked lines, and a row's ⋯ and swipes posting the
    // routes they post.
    const asPosts = async () =>
        (await stats()).posts.map(
            (p) => `${p.path} ${p.entries.map((e) => e.join("=")).join("&")}`,
        );
    const visible = (sel: string) =>
        `[...document.querySelectorAll(${JSON.stringify(sel)})].filter((b) => b.offsetParent !== null)`;
    const swipeGrocery = async (id: string, from: number, to: number) => {
        const box = await ev<{ x: number; y: number; w: number }>(`(() => {
            const r = document.querySelector('#fd-grocery-row-${id} .fd-item-row__face').getBoundingClientRect();
            return { x: r.left, y: r.top + r.height / 2, w: r.width };
        })()`);
        const x0 = box.x + box.w * from;
        const x1 = box.x + box.w * to;
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
    await goto("/kitchen/groceries");
    await setMarker();
    await control("reset=posts");
    // The page's entrance (a blur that is a containing block for the fixed
    // dock) has played before anything is measured: headless only advances an
    // animation as frames are drawn, so it is finished by hand.
    await ev(`document.getAnimations().forEach((a) => a.finish())`);
    const grocPhone = await ev<{
        sections: string[];
        rows: number;
        milkSub: string;
        milkValue: string;
        chickenSub: string;
        chickenWarn: boolean;
        eggsScore: boolean;
        rings: string[];
        topTools: string[];
        toolsLevel: number;
        tabsShown: boolean;
        headActions: string;
        dock: string[];
        dockFixed: boolean;
        dockAboveNav: boolean;
        rects: unknown;
        dockWidths: number[];
        addRow: boolean;
        oldBits: number;
    }>(`({
        sections: [...document.querySelectorAll(".fd-kitchen-grocery-section .fd-section-header__label")].map((h) => h.textContent),
        rows: document.querySelectorAll("li[id^='fd-grocery-row-']").length,
        milkSub: document.querySelector("#fd-grocery-row-gl-milk .fd-item-row__subtitle")?.textContent ?? "",
        milkValue: document.querySelector("#fd-grocery-row-gl-milk .fd-item-row__value")?.textContent ?? "",
        chickenSub: document.querySelector("#fd-grocery-row-gl-chicken .fd-item-row__subtitle")?.textContent ?? "",
        chickenWarn: document.querySelector("#fd-grocery-row-gl-chicken").classList.contains("fd-item-row--warning"),
        eggsScore: !!document.querySelector("#fd-grocery-row-gl-eggs .fd-score-pill"),
        rings: [...document.querySelectorAll("li[id^='fd-grocery-row-'] [role='checkbox']")].map((b) => b.getAttribute("aria-checked")),
        topTools: [...document.querySelectorAll(".fd-kitchen-fridge-top button[aria-label]")].map((b) => b.getAttribute("aria-label")),
        toolsLevel: (() => {
            const t = document.querySelector(".fd-kitchen-fridge-top").getBoundingClientRect();
            const row = document.querySelector(".fd-kitchen-tabs").getBoundingClientRect();
            return Math.round(Math.abs((t.top + t.height / 2) - (row.top + row.height / 2)));
        })(),
        tabsShown: getComputedStyle(document.querySelector(".fd-kitchen-tabs")).display !== "none",
        headActions: getComputedStyle(document.querySelector(".fd-kitchen-head .fd-page-header__actions")).display,
        dock: [...document.querySelectorAll(".fd-kitchen-grocery-dock .fd-btn")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()),
        dockFixed: getComputedStyle(document.querySelector(".fd-kitchen-grocery-dock")).position === "fixed",
        dockAboveNav: (() => {
            const dock = document.querySelector(".fd-kitchen-grocery-dock").getBoundingClientRect();
            const nav = document.querySelector(".fd-tabs").getBoundingClientRect();
            return dock.bottom <= nav.top + 1 && dock.width > 0;
        })(),
        rects: (() => {
            const r = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.width)].join(","); };
            const page = getComputedStyle(document.querySelector(".fd-kitchen-groceries-page"));
            return { dock: r(".fd-kitchen-grocery-dock"), nav: r(".fd-tabs"), win: innerHeight, anim: page.animationName + "|" + page.filter + "|" + page.transform + "|" + document.documentElement.className, bottom: getComputedStyle(document.querySelector(".fd-kitchen-grocery-dock")).bottom };
        })(),
        dockWidths: [...document.querySelectorAll(".fd-kitchen-grocery-dock .fd-btn")].filter((b) => b.offsetParent !== null).map((b) => Math.round(b.getBoundingClientRect().width)),
        addRow: !!document.querySelector("[data-fd-grocery-add-row] [commandfor='fd-grocery-add']"),
        oldBits: document.querySelectorAll(".fd-kitchen-grocery-stores, .fd-kitchen-grocery-put-link, .fd-kitchen-grocery-footnote").length,
    })`);
    await clickSel("#fd-grocery-row-gl-milk .fd-menu [data-fd-menu-trigger]");
    await sleep(150);
    const grocRowMenu = await ev<string[]>(
        `[...document.querySelectorAll("#fd-grocery-row-gl-milk [role='menuitem']")].map((i) => i.textContent.trim())`,
    );
    await clickSel("#fd-grocery-row-gl-milk [data-fd-menu-arm]");
    await sleep(100);
    const grocConfirm = await ev<string[]>(
        `[...document.querySelectorAll("#fd-grocery-row-gl-milk .fd-menu__confirm-row [role='menuitem']")].filter((i) => i.offsetParent !== null).map((i) => i.textContent.trim())`,
    );
    await clickSel(
        '#fd-grocery-row-gl-milk form[action="/kitchen/groceries/lines/gl-milk/delete"] [type="submit"]',
    );
    await sleep(500);
    await clickSel(
        '#fd-grocery-row-gl-rice form[action="/kitchen/groceries/lines/gl-rice/check"] [role="checkbox"]',
    );
    await sleep(500);
    await swipeGrocery("gl-chicken", 0.15, 0.85);
    await swipeGrocery("gl-milk", 0.85, 0.15);
    const grocPosts = await asPosts();
    record(
        "v2 groceries on the phone: rows by section (the store named when two show), the check ring, usual and allergen words in the warning tone, the amount and a score; the filter, ⋯ and + sit level with the tabs; checked lines add a fixed dock above the nav; a row's ⋯ is Check off, Edit and Delete (confirmed in place); Delete, the ring and both swipes post the routes and fields they should",
        grocPhone.sections.join("|") ===
            "Dairy & eggs · Costco|Produce · Costco|Meat · Costco|Pantry · Trader Joe's" &&
            grocPhone.rows === 6 &&
            grocPhone.milkSub === "Milk · usual" &&
            grocPhone.milkValue === "1 gal" &&
            grocPhone.chickenSub ===
                "Chicken thighs · usual · Contains poultry — Sam." &&
            grocPhone.chickenWarn &&
            grocPhone.eggsScore &&
            grocPhone.rings.join("|") === "false|true|true|false|false|false" &&
            grocPhone.topTools.join("|") === "Filter by store|Add to list" &&
            grocPhone.toolsLevel <= 8 &&
            grocPhone.tabsShown &&
            grocPhone.headActions === "none" &&
            grocPhone.dock.join("|") ===
                "Clear checked|Put 2 away in the kitchen" &&
            grocPhone.dockFixed &&
            grocPhone.dockAboveNav &&
            grocPhone.dockWidths.every((w) => w >= 120) &&
            !grocPhone.addRow &&
            grocPhone.oldBits === 0 &&
            grocRowMenu.slice(0, 3).join("|") === "Check off|Edit|Delete" &&
            grocConfirm.join("|") === "Cancel|Delete" &&
            grocPosts.join("\n") ===
                [
                    "/kitchen/groceries/lines/gl-milk/delete return_to=/kitchen/groceries",
                    "/kitchen/groceries/lines/gl-rice/check checked=1&return_to=/kitchen/groceries",
                    "/kitchen/groceries/lines/gl-chicken/check checked=1&return_to=/kitchen/groceries",
                    "/kitchen/groceries/lines/gl-milk/delete return_to=/kitchen/groceries",
                ].join("\n"),
        { grocPhone, grocRowMenu, grocConfirm, grocPosts, ex: drain() },
    );

    // The store filter is a pull-down of ticks: each choice is a Turbo visit
    // to the list with those stores, the badge counts them, Clear shows all.
    await goto("/kitchen/groceries");
    await setMarker();
    const filterTrigger =
        ".fd-kitchen-fridge-top [data-anchor='filter'] [data-fd-menu-trigger]";
    const filterItems = () =>
        ev<string[]>(
            `[...document.querySelectorAll(".fd-kitchen-fridge-top [data-anchor='filter'] [role^='menuitem']")].map((i) => i.textContent.trim() + (i.getAttribute("aria-checked") === "true" ? "*" : ""))`,
        );
    const grocShown = () =>
        ev<{
            href: string;
            sections: string;
            badge: string;
            marker: string;
        }>(`({
            href: location.pathname + location.search,
            sections: [...document.querySelectorAll(".fd-kitchen-grocery-section .fd-section-header__label")].map((h) => h.textContent).join("|"),
            badge: document.querySelector(".fd-kitchen-fridge-top [data-anchor='filter'] .fd-btn__badge")?.textContent ?? "",
            marker: window.__marker ?? "gone",
        })`);
    await clickSel(filterTrigger);
    await sleep(150);
    const filter0 = await filterItems();
    await clickSel(
        ".fd-kitchen-fridge-top [data-anchor='filter'] [role='menuitemcheckbox']",
    );
    await sleep(700);
    const filterOne = await grocShown();
    await clickSel(filterTrigger);
    await sleep(150);
    const filter1 = await filterItems();
    await clickSel(
        ".fd-kitchen-fridge-top [data-anchor='filter'] [role='menuitemcheckbox'][aria-checked='false']",
    );
    await sleep(700);
    const filterBoth = await grocShown();
    await clickSel(filterTrigger);
    await sleep(150);
    await clickSel(
        ".fd-kitchen-fridge-top [data-anchor='filter'] a[href='/kitchen/groceries']",
    );
    await sleep(700);
    const filterCleared = await grocShown();
    record(
        "v2 groceries store filter: a pull-down of the stores (none ticked, no Clear), choosing one shows only it with a badge of 1 over Turbo, the second adds it (badge 2, Clear offered), and Clear shows every store again",
        filter0.join("|") === "Costco|Trader Joe's" &&
            filterOne.href === "/kitchen/groceries?store=s-costco" &&
            filterOne.marker === "stay" &&
            filterOne.badge === "1" &&
            filterOne.sections === "Dairy & eggs|Produce|Meat" &&
            filter1.join("|") === "Costco*|Trader Joe's|Clear" &&
            filterBoth.href ===
                "/kitchen/groceries?store=s-costco&store=s-tj" &&
            filterBoth.badge === "2" &&
            filterCleared.href === "/kitchen/groceries" &&
            filterCleared.badge === "" &&
            filterCleared.marker === "stay",
        { filter0, filterOne, filter1, filterBoth, filterCleared, ex: drain() },
    );

    // The tab row has no ⋯, with the share flag on or off: Clear checked lives
    // on the checked bar (its own record below), and Share list has no entry.
    await goto("/kitchen/groceries");
    const tabMenuOn = await ev<number>(
        `document.querySelectorAll(".fd-kitchen-fridge-top [data-anchor='more'], [aria-label='Groceries options']").length`,
    );
    await goto("/kitchen/groceries?share=off");
    const tabMenuOff = await ev<number>(
        `document.querySelectorAll(".fd-kitchen-fridge-top [data-anchor='more'], [aria-label='Groceries options']").length`,
    );
    record(
        "v2 groceries tab row has no ⋯ (share flag on or off): Clear checked is only on the checked bar",
        tabMenuOn === 0 && tabMenuOff === 0,
        { tabMenuOn, tabMenuOff, ex: drain() },
    );

    // The line sheet from a row: amount, Store and Section pull-downs, Note,
    // Check off and Save, each posting the edit route's fields; its buttons
    // are measured on the phone and at 1440.
    const lineCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
        await goto("/kitchen/groceries");
        await setMarker();
        await control("reset=posts");
        await clickSel("#fd-grocery-row-gl-milk .fd-item-row__face");
        await sleep(400);
        const sheet = await ev<{
            open: string[];
            title: string;
            sub: string;
            amount: string;
            unit: string;
            rows: string[];
            note: string;
            actions: string[];
            actionBoxes: { w: number; h: number }[];
        }>(`({
            open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id),
            title: document.querySelector("#fd-grocery-line-gl-milk .fd-sheet__title")?.textContent ?? "",
            sub: document.querySelector("#fd-grocery-line-gl-milk .fd-sheet__subtitle")?.textContent ?? "",
            amount: document.querySelector("#fd-grocery-line-gl-milk input[name='qty_amount']").value,
            unit: document.querySelector("#fd-grocery-line-gl-milk .fd-stepper-control__unit")?.textContent ?? "",
            rows: [...document.querySelectorAll("#fd-grocery-line-gl-milk .fd-menu--row .fd-item-row__face")].map((r) => r.textContent.replace(/\\s+/g, " ").trim()),
            note: document.querySelector("#fd-grocery-line-gl-milk input[name='note']").value,
            actions: [...document.querySelectorAll("#fd-grocery-line-gl-milk .fd-sheet__actions .fd-btn")].map((b) => b.textContent.trim()),
            actionBoxes: [...document.querySelectorAll("#fd-grocery-line-gl-milk .fd-sheet__actions .fd-btn")].map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
        })`);
        // The Store pull-down's panel is not clipped by the sheet and lists
        // every store with the line's own ticked.
        await clickSel(
            "#fd-grocery-line-gl-milk .fd-menu--row [data-fd-menu-trigger]",
        );
        await sleep(200);
        const storeMenu = await ev<{
            items: string[];
            inside: boolean;
            hit: boolean;
        }>(`(() => {
            const menu = document.querySelector("#fd-grocery-line-gl-milk .fd-menu--row");
            const panel = menu.querySelector(".fd-menu__panel");
            const r = panel.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return {
                items: [...panel.querySelectorAll("[role^='menuitem']")].map((i) => i.textContent.trim() + (i.getAttribute("aria-checked") === "true" ? "*" : "")),
                inside: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight,
                hit: !!hit && panel.contains(hit),
            };
        })()`);
        // An amount and a note typed and not yet saved ride the pick along.
        await clickSel("#fd-grocery-line-gl-milk [data-fd-step='1']");
        await ev(`(() => {
            const n = document.querySelector("#fd-grocery-line-gl-milk input[name='note']");
            n.value = "The big one";
            n.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await clickSel(
            "#fd-grocery-line-gl-milk .fd-menu--row [role='menuitemcheckbox'][aria-checked='false']",
        );
        await sleep(600);
        const afterStore = await asPosts();
        // Save: bump the amount, write a note.
        await goto("/kitchen/groceries?line=gl-milk");
        await setMarker();
        await control("reset=posts");
        await ev(`(() => {
            const d = document.getElementById("fd-grocery-line-gl-milk");
            if (!d.open) d.showModal();
        })()`);
        await sleep(300);
        await clickSel("#fd-grocery-line-gl-milk [data-fd-step='1']");
        await ev(`(() => {
            const n = document.querySelector("#fd-grocery-line-gl-milk input[name='note']");
            n.value = "The big one";
            n.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await clickSel(
            "#fd-grocery-line-gl-milk .fd-sheet__actions button[type='submit'][form$='-edit']",
        );
        await sleep(600);
        const afterSave = await asPosts();
        await goto("/kitchen/groceries?line=gl-milk");
        await control("reset=posts");
        await ev(`(() => {
            const d = document.getElementById("fd-grocery-line-gl-milk");
            if (!d.open) d.showModal();
        })()`);
        await sleep(300);
        await clickSel(
            "#fd-grocery-line-gl-milk .fd-sheet__actions button[type='submit'][form$='-check']",
        );
        await sleep(600);
        const afterCheck = await asPosts();
        return { sheet, storeMenu, afterStore, afterSave, afterCheck };
    };
    const linePhone = await lineCase(390);
    const lineDesk = await lineCase(1440);
    const lineOk = (c: Awaited<ReturnType<typeof lineCase>>) =>
        c.sheet.open.join() === "fd-grocery-line-gl-milk" &&
        c.sheet.title === "Kirkland 2% milk" &&
        c.sheet.sub === "Milk · usual" &&
        c.sheet.amount === "1" &&
        c.sheet.unit === "gal" &&
        c.sheet.rows.join("|") === "StoreCostco|SectionDairy & eggs" &&
        c.sheet.note === "" &&
        c.sheet.actions.join("|") === "Check off|Save" &&
        c.sheet.actionBoxes.every((b) => b.w >= 120 && b.h >= 44) &&
        c.storeMenu.items.join("|") === "Costco*|Trader Joe's" &&
        c.storeMenu.inside &&
        c.storeMenu.hit &&
        c.afterStore.join("\n") ===
            "/kitchen/groceries/lines/gl-milk/edit store_id=s-tj&return_to=/kitchen/groceries?line=gl-milk&qty_amount=2&note=The big one&qty_unit=gal" &&
        c.afterSave.join("\n") ===
            "/kitchen/groceries/lines/gl-milk/edit qty_amount=2&note=The big one&qty_unit=gal&return_to=/kitchen/groceries" &&
        c.afterCheck.join("\n") ===
            "/kitchen/groceries/lines/gl-milk/check checked=1&return_to=/kitchen/groceries";
    record(
        "v2 groceries line sheet: a row opens it with the amount, Store and Section pull-downs (not clipped by the sheet) and a Note; choosing a store posts the edit route with that store and the amount and note typed so far, and comes back with the sheet open; Save posts the amount, unit and note; Check off posts the check route; both buttons are full-size on the phone and at 1440",
        lineOk(linePhone) && lineOk(lineDesk),
        { linePhone, lineDesk, ex: drain() },
    );

    // A pull-down inside a sheet shows every item at the phone width and at
    // 1440: its panel is placed on the screen (not clipped by the sheet), so
    // each of the ten Section items hit-tests to itself and the last one,
    // which the sheet used to cut off, posts its section.
    const sheetMenuCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
        await goto("/kitchen/groceries?line=gl-milk&sections=10");
        await setMarker();
        await control("reset=posts");
        await ev(`(() => {
            const d = document.getElementById("fd-grocery-line-gl-milk");
            if (!d.open) d.showModal();
        })()`);
        await sleep(400);
        const section =
            "#fd-grocery-line-gl-milk .fd-list-group > li:nth-child(2) .fd-menu--row";
        await clickSel(section + " [data-fd-menu-trigger]");
        await sleep(250);
        const menu = await ev<{
            count: number;
            misses: string[];
            inScreen: boolean;
        }>(`(() => {
            const panel = document.querySelector(${JSON.stringify(section)} + " .fd-menu__panel");
            const items = [...panel.querySelectorAll("[role^='menuitem']")];
            const pr = panel.getBoundingClientRect();
            return {
                count: items.length,
                misses: items.filter((i) => {
                    const r = i.getBoundingClientRect();
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    return !(hit && i.contains(hit));
                }).map((i) => i.textContent.trim()),
                inScreen: pr.top >= 0 && pr.bottom <= window.innerHeight && pr.left >= 0 && pr.right <= window.innerWidth,
            };
        })()`);
        await clickSel(
            section +
                " .fd-menu__panel > .fd-menu__form:last-child [role='menuitemcheckbox']",
        );
        await sleep(600);
        const posts = await asPosts();
        return { menu, posts };
    };
    const sheetMenuPhone = await sheetMenuCase(390);
    const sheetMenuDesk = await sheetMenuCase(1440);
    const sheetMenuOk = (c: Awaited<ReturnType<typeof sheetMenuCase>>) =>
        c.menu.count === 10 &&
        c.menu.misses.length === 0 &&
        c.menu.inScreen &&
        c.posts.length === 1 &&
        c.posts[0]!.startsWith(
            "/kitchen/groceries/lines/gl-milk/edit section=sec-x7&",
        );
    record(
        "v2 sheet pull-downs: the line sheet's Section pull-down with ten sections shows every item inside the screen (each item's centre hits that item) on the phone and at 1440, and the last item posts its section",
        sheetMenuOk(sheetMenuPhone) && sheetMenuOk(sheetMenuDesk),
        { sheetMenuPhone, sheetMenuDesk, ex: drain() },
    );

    // The did-you-mean question in the Add sheet is the shared buttons and an
    // Item row with a Toggle: every button takes the card's width and is full
    // height on the phone and at 1440, and one tap posts the food with the
    // alias choice and the page it came from.
    const dymCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
        await goto("/kitchen/groceries?add=did-you-mean");
        await setMarker();
        await control("reset=posts");
        await ev(`(() => {
            const d = document.getElementById("fd-grocery-add");
            if (!d.open) d.showModal();
        })()`);
        await sleep(400);
        const card = await ev<{
            heading: string;
            buttons: { t: string; w: number; h: number }[];
            cardW: number;
            row: string;
            toggle: boolean;
        }>(`(() => {
            const b = document.querySelector("#fd-grocery-add .fd-did-you-mean-block");
            return {
                heading: b.querySelector(".fd-did-you-mean-heading").textContent,
                buttons: [...b.querySelectorAll(".fd-btn")].map((x) => { const r = x.getBoundingClientRect(); return { t: x.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }),
                cardW: Math.round(b.getBoundingClientRect().width),
                row: b.querySelector(".fd-item-row .fd-item-row__title")?.textContent ?? "",
                toggle: !!b.querySelector(".fd-item-row input[role='switch'][name='remember_alias']"),
            };
        })()`);
        await clickSel("#fd-grocery-add .fd-did-you-mean-block .fd-toggle");
        await clickSel(
            "#fd-grocery-add .fd-did-you-mean-block button[name='food_id'][value='p-eggs']",
        );
        await sleep(600);
        const posts = await asPosts();
        return { card, posts };
    };
    const dymPhone = await dymCase(390);
    const dymDesk = await dymCase(1440);
    const dymOk = (c: Awaited<ReturnType<typeof dymCase>>) =>
        c.card.heading === "Did you mean one of these?" &&
        c.card.buttons.map((b) => b.t).join("|") ===
            "Eggs|Vital Farms large eggs|Add chicken egg as a new food" &&
        c.card.buttons.every(
            (b) => b.w <= c.card.cardW && b.w >= c.card.cardW - 40 && b.h >= 44,
        ) &&
        c.card.row === "Remember this name" &&
        c.card.toggle &&
        c.posts.length === 1 &&
        c.posts[0]!.includes("remember_alias=1") &&
        c.posts[0]!.includes("food_id=p-eggs") &&
        c.posts[0]!.includes("return_to=/kitchen/groceries");
    record(
        "v2 groceries Add to list: the did-you-mean question is the shared buttons (the card's width, at least 44px tall) and an Item row with a Toggle, on the phone and at 1440, and a candidate posts the food with the alias choice and the page it came from",
        dymOk(dymPhone) && dymOk(dymDesk),
        { dymPhone, dymDesk, ex: drain() },
    );

    // Clear checked on the dock confirms in place: a tap only arms it, Cancel
    // and Clear 2 take the row (full-size buttons), Cancel puts it back, and
    // only Clear 2 posts the route.
    const dockCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
        await goto("/kitchen/groceries");
        await setMarker();
        await control("reset=posts");
        const dockRow = () =>
            ev<{
                labels: string[];
                boxes: { w: number; h: number }[];
                fits: boolean;
            }>(`(() => {
                const shown = [...document.querySelectorAll(".fd-kitchen-grocery-dock .fd-btn")].filter((b) => b.offsetParent !== null);
                return {
                    labels: shown.map((b) => b.textContent.trim()),
                    boxes: shown.map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
                    // No label is clipped: "Put 2 away in the kitchen" fits beside Clear checked.
                    fits: shown.every((b) => b.scrollWidth <= b.clientWidth + 1),
                };
            })()`);
        const idle = await dockRow();
        await clickSel(".fd-kitchen-grocery-dock [data-fd-confirm-arm]");
        await sleep(100);
        const armed = await dockRow();
        const armedPosts = await asPosts();
        await clickSel(".fd-kitchen-grocery-dock [data-fd-confirm-cancel]");
        await sleep(100);
        const cancelled = await dockRow();
        const cancelledPosts = await asPosts();
        await clickSel(".fd-kitchen-grocery-dock [data-fd-confirm-arm]");
        await sleep(100);
        await clickSel(".fd-kitchen-grocery-dock [data-fd-confirm-go]");
        await sleep(600);
        const posts = await asPosts();
        return { idle, armed, armedPosts, cancelled, cancelledPosts, posts };
    };
    const dockPhone = await dockCase(390);
    const dockDesk = await dockCase(1440);
    const dockOk = (c: Awaited<ReturnType<typeof dockCase>>) =>
        c.idle.labels.join("|") === "Clear checked|Put 2 away in the kitchen" &&
        c.idle.fits &&
        c.armed.labels.join("|") === "Cancel|Clear 2" &&
        c.armed.boxes.every((b) => b.w >= 80 && b.h >= 44) &&
        c.armedPosts.length === 0 &&
        c.cancelled.labels.join("|") ===
            "Clear checked|Put 2 away in the kitchen" &&
        c.cancelledPosts.length === 0 &&
        c.posts.join("\n") ===
            "/kitchen/groceries/clear-checked return_to=/kitchen/groceries";
    record(
        "v2 groceries dock: Clear checked only arms (Cancel and Clear 2 take the row, full-size), Cancel puts it back and posts nothing, and Clear 2 posts the route, on the phone and at 1440",
        dockOk(dockPhone) && dockOk(dockDesk),
        { dockPhone, dockDesk, ex: drain() },
    );

    // Put away from the dock: one block per checked line with where it is
    // kept and when it expires, the product choice, and the same fields.
    const putCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
        await goto("/kitchen/groceries");
        await setMarker();
        await control("reset=posts");
        await clickSel(
            `.fd-kitchen-grocery-dock [commandfor="fd-grocery-put-away"]`,
        );
        await sleep(400);
        const sheet = await ev<{
            open: boolean;
            title: string;
            lines: string[];
            kept: string[];
            products: string[];
            expires: string[];
            fieldShown: boolean;
            actions: string[];
            actionBoxes: { w: number; h: number }[];
        }>(`({
            open: document.getElementById("fd-grocery-put-away").open,
            title: document.querySelector("#fd-grocery-put-away .fd-sheet__title")?.textContent ?? "",
            lines: [...document.querySelectorAll("#fd-grocery-put-away .fd-kitchen-put-line .fd-item-row__title")].map((t) => t.textContent),
            kept: [...document.querySelectorAll("#fd-grocery-put-away input[name^='location_id_']")].map((i) => i.name.slice(12) + ":" + i.value + (i.checked ? "*" : "")),
            products: [...document.querySelectorAll("#fd-grocery-put-away input[name^='product_food_id_']")].map((i) => i.value + (i.checked ? "*" : "")),
            expires: [...document.querySelectorAll("#fd-grocery-put-away input[name^='expires_mode_gl-eggs']")].map((i) => i.value + (i.checked ? "*" : "")),
            fieldShown: document.querySelector("#fd-grocery-put-away .fd-kitchen-item-expires__field").offsetParent !== null,
            actions: [...document.querySelectorAll("#fd-grocery-put-away .fd-sheet__actions .fd-btn")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()),
            actionBoxes: [...document.querySelectorAll("#fd-grocery-put-away .fd-sheet__actions .fd-btn")].filter((b) => b.offsetParent !== null).map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
        })`);
        await clickSel(
            "#fd-grocery-put-away input[name='location_id_gl-spinach'][value='l-freezer']",
        );
        await clickSel(
            "#fd-grocery-put-away input[name='expires_mode_gl-eggs'][value='pick']",
        );
        await sleep(100);
        const fieldAfter = await ev<boolean>(
            `document.querySelector("#fd-grocery-put-away input[name='expires_on_gl-eggs']").offsetParent !== null`,
        );
        await ev(`(() => {
            const i = document.querySelector("#fd-grocery-put-away input[name='expires_on_gl-eggs']");
            i.value = "2026-12-01";
            i.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await clickSel(
            "#fd-grocery-put-away .fd-sheet__actions button[form='fd-grocery-put-away-form']",
        );
        await sleep(600);
        const put = (await asPosts()).map((p) =>
            p
                .split("&")
                .filter((e) => !e.startsWith("expires_mode_"))
                .join("&"),
        );
        await goto("/kitchen/groceries");
        await control("reset=posts");
        await clickSel(
            `.fd-kitchen-grocery-dock [commandfor="fd-grocery-put-away"]`,
        );
        await sleep(300);
        // Clear checked in the sheet only arms: Cancel and Clear 2 take the
        // row, Cancel puts it back, and only Clear 2 posts.
        const sheetRow = () =>
            ev<{
                labels: string[];
                boxes: { w: number; h: number }[];
            }>(`(() => {
                const shown = [...document.querySelectorAll("#fd-grocery-put-away .fd-sheet__actions .fd-btn")].filter((b) => b.offsetParent !== null);
                return {
                    labels: shown.map((b) => b.textContent.trim()),
                    boxes: shown.map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
                };
            })()`);
        await clickSel("#fd-grocery-put-away [data-fd-confirm-arm]");
        await sleep(100);
        const armed = await sheetRow();
        const armedPosts = await asPosts();
        await clickSel("#fd-grocery-put-away [data-fd-confirm-cancel]");
        await sleep(100);
        const cancelled = await sheetRow();
        await clickSel("#fd-grocery-put-away [data-fd-confirm-arm]");
        await sleep(100);
        await clickSel("#fd-grocery-put-away [data-fd-confirm-go]");
        await sleep(600);
        const clear = await asPosts();
        return { sheet, fieldAfter, put, armed, armedPosts, cancelled, clear };
    };
    const putPhone = await putCase(390);
    const putDesk = await putCase(1440);
    const putOk = (c: Awaited<ReturnType<typeof putCase>>) =>
        c.sheet.open &&
        c.sheet.title === "Put away 2 items" &&
        c.sheet.lines.join("|") === "Vital Farms large eggs|Spinach" &&
        c.sheet.kept.join("|") ===
            "gl-eggs:l-fridge*|gl-eggs:l-freezer|gl-eggs:l-pantry|gl-spinach:l-fridge*|gl-spinach:l-freezer|gl-spinach:l-pantry" &&
        c.sheet.products.join("|") === "f-eggs|p-eggs*" &&
        c.sheet.expires.join("|") === "none*|pick" &&
        !c.sheet.fieldShown &&
        c.fieldAfter &&
        c.sheet.actions.join("|") === "Clear checked|Put away" &&
        c.sheet.actionBoxes.every((b) => b.w >= 120 && b.h >= 44) &&
        c.put.join("\n") ===
            "/kitchen/groceries/put-away return_to=/kitchen/groceries&line_ids=gl-eggs,gl-spinach&location_id_gl-eggs=l-fridge&product_food_id_gl-eggs=p-eggs&expires_on_gl-eggs=2026-12-01&location_id_gl-spinach=l-freezer&expires_on_gl-spinach=" &&
        c.armed.labels.join("|") === "Cancel|Clear 2" &&
        c.armed.boxes.every((b) => b.w >= 120 && b.h >= 44) &&
        c.armedPosts.length === 0 &&
        c.cancelled.labels.join("|") === "Clear checked|Put away" &&
        c.clear.join("\n") ===
            "/kitchen/groceries/clear-checked return_to=/kitchen/groceries";
    record(
        "v2 groceries put away: the dock's Put N away in the kitchen (unclipped) opens the sheet with each checked line, where it is kept, when it expires (a date field only on Pick a date) and the product; Put away posts the route's fields for each line, Clear checked only arms (Cancel and Clear 2 take the row, Cancel puts it back) and Clear 2 posts its own route, and the buttons are full-size on the phone and at 1440",
        putOk(putPhone) && putOk(putDesk),
        { putPhone, putDesk, ex: drain() },
    );

    // Add to list: the + opens the sheet with the running-low chips and the
    // usuals, typing narrows them, a plus or a chip posts the add route, and
    // the hand form keeps its button size at both widths.
    const addCase = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
        await goto("/kitchen/groceries");
        await setMarker();
        await control("reset=posts");
        await ev(
            `${visible("[aria-label='Add to list'][commandfor='fd-grocery-add']")}[0].click()`,
        );
        await sleep(400);
        const add0 = await ev<{
            open: boolean;
            low: string[];
            usuals: string[];
            lowSubtitle: string;
            title: string;
        }>(`({
            open: document.getElementById("fd-grocery-add").open,
            low: [...document.querySelectorAll("#fd-grocery-add .fd-kitchen-add-low .fd-pill-chip")].map((c) => c.textContent),
            usuals: [...document.querySelectorAll("#fd-grocery-add .fd-item-row[data-fd-grocery-usual]")].map((r) => r.querySelector(".fd-item-row__title").textContent),
            lowSubtitle: document.querySelector("#fd-grocery-add .fd-item-row[data-fd-grocery-usual] .fd-item-row__subtitle")?.textContent ?? "",
            title: document.getElementById("fd-grocery-add-title")?.textContent ?? "",
        })`);
        await ev(`(() => {
            const input = document.getElementById("fd-grocery-add-q");
            input.value = "mil";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        const filtered = await ev<string[]>(
            `[...document.querySelectorAll("#fd-grocery-add .fd-item-row[data-fd-grocery-usual]")].filter((r) => !r.hidden).map((r) => r.querySelector(".fd-item-row__title").textContent)`,
        );
        const handName = await ev<string>(
            `document.getElementById("fd-grocery-add-name").value`,
        );
        await clickSel(
            "#fd-grocery-add .fd-item-row[data-fd-grocery-usual='milk 2%'] .fd-item-row__add",
        );
        await sleep(600);
        const usualPost = await asPosts();
        await goto("/kitchen/groceries");
        await control("reset=posts");
        await ev(
            `${visible("[aria-label='Add to list'][commandfor='fd-grocery-add']")}[0].click()`,
        );
        await sleep(300);
        await clickSel("#fd-grocery-add .fd-kitchen-add-low .fd-pill-chip");
        await sleep(600);
        const chipPost = await asPosts();
        await goto("/kitchen/groceries");
        await control("reset=posts");
        await ev(`document.getElementById("fd-grocery-add").showModal()`);
        await sleep(300);
        await ev(
            `document.querySelector("#fd-grocery-add .fd-kitchen-hand").open = true`,
        );
        await sleep(100);
        await ev(`(() => {
            const name = document.getElementById("fd-grocery-add-name");
            name.value = "Basil";
            name.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        const hand = await ev<{
            h: number;
            w: number;
            formW: number;
            steppers: number[];
        }>(`(() => {
            const b = document.querySelector("#fd-grocery-add-form button[type=submit]").getBoundingClientRect();
            return {
                h: Math.round(b.height),
                w: Math.round(b.width),
                formW: Math.round(document.getElementById("fd-grocery-add-form").getBoundingClientRect().width),
                steppers: [...document.querySelectorAll("#fd-grocery-add-form [data-fd-step]")].map((s) => Math.round(s.getBoundingClientRect().width)),
            };
        })()`);
        await clickSel("#fd-grocery-add-form button[type=submit]");
        await sleep(600);
        const handPost = await asPosts();
        // With the list filtered to one store, every add names that store; a
        // usual that names its own store says so while none is chosen.
        await goto("/kitchen/groceries?store=s-costco");
        await control("reset=posts");
        await ev(
            `${visible("[aria-label='Add to list'][commandfor='fd-grocery-add']")}[0].click()`,
        );
        await sleep(300);
        const oneSubtitle = await ev<string>(
            `document.querySelector("#fd-grocery-add .fd-item-row[data-fd-grocery-usual='milk 2%'] .fd-item-row__subtitle")?.textContent ?? ""`,
        );
        await clickSel(
            "#fd-grocery-add .fd-item-row[data-fd-grocery-usual='milk 2%'] .fd-item-row__add",
        );
        await sleep(600);
        const onePost = await asPosts();
        return {
            add0,
            filtered,
            handName,
            usualPost,
            chipPost,
            hand,
            handPost,
            oneSubtitle,
            onePost,
        };
    };
    const addPhone = await addCase(390);
    const addDesk = await addCase(1440);
    const addOk = (c: Awaited<ReturnType<typeof addCase>>) =>
        c.add0.open &&
        c.add0.title === "Add to list" &&
        c.add0.low.join("|") === "Eggs" &&
        c.add0.usuals.join("|") === "Eggs|Milk 2%|Paper towels" &&
        c.add0.lowSubtitle === "Low · 3 left" &&
        c.filtered.join("|") === "Milk 2%" &&
        c.handName === "mil" &&
        c.usualPost.join("\n") ===
            "/kitchen/groceries/lines kind=food&food_id=p-milk&qty_amount=1&qty_unit=gal&return_to=/kitchen/groceries" &&
        c.chipPost.join("\n") ===
            "/kitchen/groceries/lines kind=food&food_id=p-eggs&qty_amount=12&qty_unit=each&return_to=/kitchen/groceries" &&
        c.hand.h >= 40 &&
        c.hand.w >= c.hand.formW - 1 &&
        c.hand.steppers.length === 2 &&
        c.hand.steppers.every((w) => w === 48) &&
        c.handPost.join("\n") ===
            "/kitchen/groceries/lines kind=food&return_to=/kitchen/groceries&food_name=Basil&qty_amount=1&qty_unit=each" &&
        c.oneSubtitle === "Usual · Kirkland · 1 gal · Costco" &&
        c.onePost.join("\n") ===
            "/kitchen/groceries/lines kind=food&food_id=p-milk&store_id=s-costco&section_id=sec-dairy&qty_amount=1&qty_unit=gal&return_to=/kitchen/groceries?store=s-costco";
    record(
        "v2 groceries Add to list: the + opens the search sheet with the running-low chips and the usuals not on the list; typing narrows them and fills the hand form's Name; a usual's plus and a chip post the add route with the food and usual amount and no store (the usual's own applies), or the one filtered store and its section; a low usual reads Low · N left; the hand form's Add button is at least 40px tall and as wide as the form and the stepper's buttons stay 48px, on the phone and at 1440",
        addOk(addPhone) && addOk(addDesk),
        { addPhone, addDesk, ex: drain() },
    );

    // Kitchen › Groceries at 1440: Groceries is the sidebar's current
    // sub-link, the header holds the filter and Add to list (no ⋯), the first
    // section is the left column and the rest the right, and the dock is a
    // row under the header.
    await send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 960,
        deviceScaleFactor: 1,
        mobile: false,
    });
    await goto("/kitchen/groceries");
    await setMarker();
    await control("reset=posts");
    const grocDesk = await ev<{
        current: string;
        tabs: string;
        actions: string[];
        phoneTools: string;
        leftHas: string[];
        rightHas: string[];
        sideBySide: boolean;
        dockStatic: boolean;
        dockRight: boolean;
        dockBelowHeader: boolean;
        rowMenuVisible: boolean;
    }>(`({
        current: document.querySelector(".fd-sidebar a.fd-side-link--sub[aria-current='page']")?.textContent.replace(/\\s+/g, " ").trim() ?? "",
        tabs: getComputedStyle(document.querySelector(".fd-kitchen-tabs")).display,
        actions: [...document.querySelectorAll(".fd-kitchen-head .fd-page-header__actions [aria-label]")].filter((b) => b.offsetParent !== null).map((b) => b.getAttribute("aria-label")),
        phoneTools: getComputedStyle(document.querySelector(".fd-kitchen-fridge-top")).display,
        leftHas: [...document.querySelectorAll(".fd-page-layout__column:first-child .fd-section-header__label")].map((h) => h.textContent),
        rightHas: [...document.querySelectorAll(".fd-page-layout__column:last-child .fd-section-header__label")].map((h) => h.textContent),
        sideBySide: (() => {
            const [a, b] = [...document.querySelectorAll(".fd-kitchen-groceries-layout .fd-page-layout__column")].map((c) => c.getBoundingClientRect());
            return !!a && !!b && b.left >= a.right && Math.abs(a.top - b.top) < 2;
        })(),
        dockStatic: getComputedStyle(document.querySelector(".fd-kitchen-grocery-dock")).position === "static",
        dockRight: (() => {
            const last = [...document.querySelectorAll(".fd-kitchen-grocery-dock .fd-btn")].filter((b) => b.offsetParent !== null).pop().getBoundingClientRect();
            const page = document.querySelector(".fd-kitchen-groceries-page").getBoundingClientRect();
            return Math.abs(last.right - page.right) <= 2 && last.left > page.left + page.width / 2;
        })(),
        dockBelowHeader: document.querySelector(".fd-kitchen-grocery-dock").getBoundingClientRect().top >= document.querySelector(".fd-kitchen-head").getBoundingClientRect().bottom,
        rowMenuVisible: document.querySelector("#fd-grocery-row-gl-milk .fd-menu").offsetParent !== null,
    })`);
    record(
        "v2 groceries at 1440px: Groceries is the sidebar's current sub-link (no tab row), the filter and Add to list sit in the header (no ⋯), the first section is the left column and the rest the right, and the dock is a right-aligned row under the header",
        grocDesk.current.startsWith("Groceries") &&
            grocDesk.tabs === "none" &&
            grocDesk.actions.join("|") === "Filter by store|Add to list" &&
            grocDesk.phoneTools === "none" &&
            grocDesk.leftHas.join("|") === "Dairy & eggs · Costco" &&
            grocDesk.rightHas.join("|") ===
                "Produce · Costco|Meat · Costco|Pantry · Trader Joe's" &&
            grocDesk.sideBySide &&
            grocDesk.dockStatic &&
            grocDesk.dockRight &&
            grocDesk.dockBelowHeader &&
            grocDesk.rowMenuVisible,
        { grocDesk, ex: drain() },
    );
    await goto("/");
    await setMarker();

    // Quick add and water post the routes they always did.
    await goto("/");
    await setMarker();
    await control("reset=posts");
    await openLogSearch();
    await clickSel('#fd-log-search [data-fd-open-sheet="fd-log-quick-cal"]');
    await sleep(400);
    const quickOpen = await ev<{ open: boolean; searchOpen: boolean }>(`({
        open: document.getElementById("fd-log-quick-cal").open,
        searchOpen: document.getElementById("fd-log-search").open,
    })`);
    await clickSel("[data-fd-quick-cal-submit]");
    await sleep(600);
    const quickPost = (await stats()).posts.find(
        (p) => p.path === "/log/quick",
    );
    const quickFields = Object.fromEntries(quickPost?.entries ?? []);
    await goto("/");
    await control("reset=posts");
    await openLogSearch();
    await clickSel('#fd-log-search form[action="/log/water"] button');
    await sleep(600);
    const waterPost = (await stats()).posts.find(
        (p) => p.path === "/log/water",
    );
    record(
        "v2 log sheet: Quick calories posts /log/quick and Water +250 ml posts /log/water",
        quickOpen.open &&
            !quickOpen.searchOpen &&
            quickFields.calories === "350" &&
            quickFields.description === "Quick calories" &&
            quickFields.return_to === "/" &&
            waterPost !== undefined &&
            Object.fromEntries(waterPost.entries).amount_ml === "250",
        { quickOpen, quickFields, waterPost, ex: drain() },
    );

    // A meal's plus on Today opens the search with that meal under ADD TO; the
    // Top bar or the Search tab opens it on the default meal again.
    await goto("/");
    const mealPlus = await ev<{
        meal: string | null;
        dflt: string | null;
    }>(`(() => {
        const plusses = [...document.querySelectorAll("a[data-fd-log-meal]")];
        const dflt = [...document.querySelectorAll('#fd-log-search input[name="search_meal_type"]')].find((r) => r.defaultChecked)?.value ?? null;
        const other = plusses.find((a) => a.getAttribute("data-fd-log-meal") !== dflt) ?? plusses[0];
        other?.setAttribute("data-fd-nav-probe", "");
        return { meal: other?.getAttribute("data-fd-log-meal") ?? null, dflt };
    })()`);
    await ev(`document.querySelector("[data-fd-nav-probe]")?.click()`);
    await sleep(400);
    const fromPlus = await ev<{ open: boolean; checked: string | null }>(`({
        open: document.getElementById("fd-log-search").open,
        checked: document.querySelector('#fd-log-search input[name="search_meal_type"]:checked')?.value ?? null,
    })`);
    await ev(`document.getElementById("fd-log-search").close()`);
    await ev(`(() => {
        const open = [...document.querySelectorAll("a.fd-log[data-fd-open-sheet], .fd-top-bar [data-fd-open-sheet]")].find((el) => el.offsetParent !== null);
        open?.click();
    })()`);
    await sleep(400);
    const fromBar = await ev<{ open: boolean; checked: string | null }>(`({
        open: document.getElementById("fd-log-search").open,
        checked: document.querySelector('#fd-log-search input[name="search_meal_type"]:checked')?.value ?? null,
    })`);
    record(
        "v2 today: a meal's plus opens the search with that meal checked under ADD TO; the Top bar and Search tab keep the default",
        mealPlus.meal !== null &&
            fromPlus.open &&
            fromPlus.checked === mealPlus.meal &&
            fromBar.open &&
            fromBar.checked === mealPlus.dflt,
        { mealPlus, fromPlus, fromBar, ex: drain() },
    );
    await ev(`document.getElementById("fd-log-search")?.close()`);

    // A recipe link pasted into the search: the link icon and Go, which imports.
    await goto("/");
    await control("reset=posts");
    await openLogSearch();
    await typeIntoSearch("https://hot-thai-kitchen.com/pad-see-ew");
    const linkState = await ev<{
        detected: boolean;
        goShown: boolean;
        linkIcon: boolean;
        searchIcon: boolean;
        scanShown: boolean;
        rows: number;
    }>(`(() => {
        const box = document.querySelector("#fd-log-search .fd-sheet__search");
        const shown = (el) => !!el && el.getClientRects().length > 0;
        return {
            detected: box.hasAttribute("data-link-detected"),
            goShown: shown(box.querySelector("[data-fd-log-import-go]")),
            linkIcon: shown(box.querySelector(".fd-sheet__search-icon--link")),
            searchIcon: shown(box.querySelector(".fd-sheet__search-icon--search")),
            scanShown: shown(box.querySelector("[data-fd-open-sheet]")),
            rows: document.querySelectorAll("#fd-log-search [data-fd-log-results]:not([hidden]) .fd-item-row").length,
        };
    })()`);
    await clickSel("[data-fd-log-import-go]");
    await sleep(600);
    const importPost = (await stats()).posts.find(
        (p) => p.path === "/recipes/import",
    );
    record(
        "v2 log search: a pasted recipe link shows the link icon and Go instead of the barcode button, and Go posts /recipes/import",
        linkState.detected &&
            linkState.goShown &&
            linkState.linkIcon &&
            !linkState.searchIcon &&
            !linkState.scanShown &&
            linkState.rows === 0 &&
            importPost !== undefined &&
            Object.fromEntries(importPost.entries).url ===
                "https://hot-thai-kitchen.com/pad-see-ew",
        { linkState, importPost, ex: drain() },
    );

    // The scanner (barcode-camera on): the Scan tile and the field's barcode
    // button open it; it is a Detail bar, a Camera view and the number field,
    // and a typed number looks the product up.
    await goto("/");
    await setMarker();
    await openLogSearch();
    const scanOpeners = await ev<number>(
        `document.querySelectorAll('#fd-log-search [data-fd-open-sheet="fd-barcode-scan"]').length`,
    );
    await clickSel(
        '#fd-log-search .fd-sheet__search [data-fd-open-sheet="fd-barcode-scan"]',
    );
    await sleep(900);
    const scanner = await ev<{
        open: boolean;
        title: string | null;
        camera: number;
        explains: boolean;
        field: boolean;
    }>(`({
        open: document.getElementById("fd-barcode-scan").open,
        title: document.querySelector("#fd-barcode-scan .fd-detail-bar__title")?.textContent ?? null,
        camera: document.querySelectorAll("#fd-barcode-scan [data-fd-camera-view]").length,
        explains: /Hold steady|Point at a barcode|Use your camera/i.test(document.getElementById("fd-barcode-scan").textContent),
        field: !!document.querySelector("#fd-barcode-scan #fd-scanner-manual"),
    })`);
    await ev(`(() => {
        const i = document.getElementById("fd-scanner-manual");
        i.value = "5449000000996";
        i.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickSel("#fd-barcode-scan .fd-btn--go");
    await sleep(600);
    const scanned = await ev<string>(`location.pathname`);
    record(
        "v2 scanner (barcode-camera on): opens from the search field with a title, a camera view and a number field, no instructions, and a typed number opens its product",
        scanOpeners === 3 &&
            scanner.open &&
            scanner.title === "Scan a barcode" &&
            scanner.camera === 1 &&
            !scanner.explains &&
            scanner.field &&
            scanned === "/foods/by-barcode/5449000000996",
        { scanOpeners, scanner, scanned, ex: drain() },
    );

    // barcode-camera off: no Scan tile, no barcode button, no scan link, and
    // the scanner has no camera (it stays for Add a usual's Enter a barcode).
    await goto("/?camera=off");
    await openLogSearch();
    const cameraOff = await ev<{
        openers: number;
        scanTile: boolean;
        video: number;
        typeOnly: boolean;
        menus: number;
    }>(`({
        openers: document.querySelectorAll('[data-fd-open-sheet="fd-barcode-scan"]').length,
        scanTile: /Scan barcode|Not here/.test(document.getElementById("fd-log-search").textContent),
        video: document.querySelectorAll("#fd-barcode-scan video").length,
        typeOnly: document.getElementById("fd-barcode-scan").classList.contains("fd-scanner--type-only"),
        menus: document.querySelectorAll('#fd-log-search [aria-haspopup="menu"]').length,
    })`);
    record(
        "v2 scanner (barcode-camera off): the log sheet draws no Scan tile, barcode button or scan link, and the scanner has no camera",
        cameraOff.openers === 0 &&
            !cameraOff.scanTile &&
            cameraOff.video === 0 &&
            cameraOff.typeOnly &&
            cameraOff.menus === 0,
        { cameraOff, ex: drain() },
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
    // The rows are the sidebar's real labels, so a label that stops matching
    // the filter fails the case instead of passing it for want of a row.
    const kitchenLabels = (rows: string[]) =>
        rows.map((r) => (r.split("|")[0] ?? "").replace(/ · \d+$/, ""));
    const kitchenRows = ["Kitchen", "Fridge", "Groceries", "Usuals"];
    record(
        "v2 sidebar: clicking a Kitchen section keeps the Kitchen group current",
        kitchenLabels(kitchenBefore).join() === kitchenRows.join() &&
            kitchenLabels(kitchenAfter).join() === kitchenRows.join() &&
            groupRow(kitchenBefore) === "Kitchen|true|cur" &&
            groupRow(kitchenAfter) === "Kitchen|true|cur" &&
            kitchenBefore.includes("Fridge|page|cur") &&
            kitchenAfter.some((r) => /^Groceries[^|]*\|page\|cur/.test(r)) &&
            kitchenAfter.includes("Fridge|-|") &&
            kitchenAfter.includes("Usuals|-|"),
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

    // ---- Kitchen › Usuals and Trends (phone and desktop) ----
    // The list and its rows, the tab row's filter, a usual's sheet (its
    // header ⋯ asks in place, every field posts the route it posted before, the
    // unit and Restock pull-downs and the product picker), Add a usual (search,
    // Type it, the camera on and off), and Trends.
    const postFields = (line: string | undefined) => {
        const out: Record<string, string> = {};
        const [, query = ""] = (line ?? "").split(/ (.*)/s);
        for (const part of query.split("&")) {
            const at = part.indexOf("=");
            if (at > 0) out[part.slice(0, at)] = part.slice(at + 1);
        }
        return out;
    };
    const setViewport = async (width: number) => {
        await send("Emulation.setDeviceMetricsOverride", {
            width,
            height: width < 800 ? 844 : 960,
            deviceScaleFactor: 1,
            mobile: width < 800,
        });
        await send("Emulation.setTouchEmulationEnabled", {
            enabled: width < 800,
            maxTouchPoints: 1,
        });
    };
    // Every item of a pull-down is reachable: scrolled into its panel, inside
    // the screen, and the panel itself inside the screen.
    const reachAll = (rootSel: string) => `(() => {
        const root = document.querySelector(${JSON.stringify(rootSel)});
        const panel = root.querySelector(".fd-menu__panel");
        const items = [...panel.querySelectorAll('[role^="menuitem"]')];
        const pr = panel.getBoundingClientRect();
        const bad = [];
        for (const item of items) {
            item.scrollIntoView({ block: "nearest" });
            const r = item.getBoundingClientRect();
            const p = panel.getBoundingClientRect();
            if (r.top < p.top - 1 || r.bottom > p.bottom + 1 || r.top < 0 || r.bottom > innerHeight) bad.push(item.textContent.trim());
        }
        return { count: items.length, bad, panelInside: pr.top >= 0 && pr.bottom <= innerHeight && pr.left >= 0 && pr.right <= innerWidth };
    })()`;
    const usualsCase = async (width: number) => {
        await setViewport(width);
        await goto("/kitchen/usuals");
        await setMarker();
        await control("reset=posts");
        const list = await ev<{
            titles: string[];
            metas: string[];
            subs: string[];
            lowWarn: string[];
            addRow: boolean;
            h1: string;
            sub: string;
            noIntro: boolean;
            filter: boolean;
            more: boolean;
        }>(`({
            titles: [...document.querySelectorAll(".fd-kitchen-usuals-page .fd-item-row[data-fd-sheet-row] .fd-item-row__title")].map((t) => t.textContent),
            metas: [...document.querySelectorAll(".fd-kitchen-usuals-page .fd-item-row[data-fd-sheet-row] .fd-item-row__meta")].map((t) => t.textContent),
            subs: [...document.querySelectorAll(".fd-kitchen-usuals-page .fd-item-row[data-fd-sheet-row] .fd-item-row__subtitle")].map((t) => t.textContent),
            lowWarn: [...document.querySelectorAll(".fd-kitchen-usuals-page .fd-item-row--warning[data-fd-sheet-row] .fd-item-row__title")].map((t) => t.textContent),
            addRow: !!document.querySelector("[data-fd-usual-add-row] .fd-item-row"),
            h1: document.querySelector(".fd-kitchen-head h1")?.textContent ?? "",
            sub: document.querySelector(".fd-kitchen-head .fd-page-header__subtitle")?.textContent ?? "",
            noIntro: !document.body.textContent.includes("What you usually buy"),
            filter: ${visible("[aria-label='Filter by store']")}.length > 0,
            more: ${visible("[aria-label='Usuals options']")}.length > 0,
        })`);
        // The low usual's words are in the warning colour, the rest are not.
        const tone = await ev<{ low: string; calm: string }>(`({
            low: getComputedStyle(document.querySelector("#fd-usual-row-u-eggs .fd-item-row__subtitle")).color,
            calm: getComputedStyle(document.querySelector("#fd-usual-row-u-milk .fd-item-row__subtitle")).color,
        })`);
        // The tab row's filter: a tick per store; there is no ⋯.
        await ev(`${visible("[aria-label='Filter by store']")}[0].click()`);
        await sleep(200);
        const filterMenu = await ev<{
            items: string[];
            reach: { count: number; bad: string[]; panelInside: boolean };
        }>(`({
            items: [...${visible("[data-anchor='filter'] .fd-menu__item")}].map((i) => i.textContent.trim()),
            reach: ${reachAll("[data-anchor='filter']:has(.fd-menu__panel:not([hidden]))")},
        })`);
        await ev(
            `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`,
        );
        await sleep(100);
        // Choosing a store filters over Turbo and keeps the page.
        await ev(`${visible("[aria-label='Filter by store']")}[0].click()`);
        await sleep(150);
        await ev(
            `[...${visible("[data-anchor='filter'] .fd-menu__item")}].find((i) => i.textContent.includes("Costco")).click()`,
        );
        await sleep(600);
        const filtered = await ev<{
            marker: string | null;
            path: string;
            titles: string[];
            badge: string;
        }>(`({
            marker: window.__marker ?? null,
            path: location.pathname + location.search,
            titles: [...document.querySelectorAll(".fd-kitchen-usuals-page .fd-item-row[data-fd-sheet-row] .fd-item-row__title")].map((t) => t.textContent),
            badge: document.querySelector(".fd-btn__badge")?.textContent ?? "",
        })`);
        return { list, tone, filterMenu, filtered };
    };
    const usualsPhone = await usualsCase(390);
    const usualsDesk = await usualsCase(1440);
    const usualsListOk = (c: Awaited<ReturnType<typeof usualsCase>>) =>
        c.list.h1 === "Kitchen" &&
        c.list.sub === "4 usuals · restock on Sundays" &&
        c.list.noIntro &&
        !c.list.addRow &&
        c.list.filter &&
        !c.list.more &&
        // A usual that is low now leads (frame 397013).
        c.list.titles.join("|") === "Eggs|Bananas|Milk|Olive oil" &&
        c.list.metas.join("|") ===
            "Vital Farms large|No usual product yet|Kirkland 2% milk|California Olive Ranch" &&
        c.list.subs.join("|") ===
            "Costco · 24 · Every week · low now|Trader Joe's · 6 · When low|Costco · 64 fl oz · Every week|Costco · 1 · Paused" &&
        c.list.lowWarn.join("|") === "Eggs" &&
        c.tone.low !== c.tone.calm &&
        c.filterMenu.items.join("|") === "Costco|Trader Joe's" &&
        c.filterMenu.reach.bad.length === 0 &&
        c.filterMenu.reach.panelInside &&
        c.filtered.marker === "stay" &&
        c.filtered.path === "/kitchen/usuals?store=s-costco" &&
        c.filtered.titles.join("|") === "Eggs|Milk|Olive oil" &&
        c.filtered.badge === "1";
    record(
        "v2 usuals list: the rows read name, product beside it, then store, amount and restock (a low usual in the warning tone, an unset product as No usual product yet), no intro; the tab row has the store filter (a tick per store) and no ⋯, and the list has no Add a usual row; choosing a store filters over Turbo with the count on the button, on the phone and at 1440",
        usualsListOk(usualsPhone) && usualsListOk(usualsDesk),
        { usualsPhone, usualsDesk, ex: drain() },
    );

    const usualSheetCase = async (width: number) => {
        await setViewport(width);
        await goto("/kitchen/usuals");
        await setMarker();
        await control("reset=posts");
        await clickSel("#fd-usual-row-u-milk .fd-item-row__face");
        await sleep(400);
        const open = await ev<{
            open: boolean;
            title: string;
            hasRemoveButton: boolean;
            rows: string[];
            chips: string[];
            buttons: { name: string; w: number; h: number }[];
            overflow: boolean;
        }>(`(() => {
            const d = document.getElementById("fd-usual-u-milk");
            const sheet = d.querySelector(".fd-sheet-panel");
            return {
                open: d.open,
                title: d.querySelector(".fd-sheet__title")?.textContent ?? "",
                hasRemoveButton: [...d.querySelectorAll(".fd-sheet__actions button")].some((b) => /Remove/.test(b.textContent)),
                rows: [...d.querySelectorAll("form > .fd-sheet__section .fd-item-row")].map((r) => r.querySelector(".fd-item-row__title")?.textContent ?? ""),
                chips: [...d.querySelectorAll(".fd-chip__label")].map((c) => c.textContent),
                buttons: [...d.querySelectorAll("button, a.fd-btn")].filter((b) => b.offsetParent !== null).map((b) => {
                    const r = b.getBoundingClientRect();
                    return { name: (b.getAttribute("aria-label") || b.textContent || "").trim(), w: Math.round(r.width), h: Math.round(r.height) };
                }),
                overflow: sheet.scrollWidth > sheet.clientWidth + 1,
            };
        })()`);
        // The header ⋯ asks in place.
        await ev(
            `document.querySelector("#fd-usual-u-milk .fd-sheet__menu [data-fd-menu-trigger]").click()`,
        );
        await sleep(200);
        const menu0 = await ev<string[]>(
            `[...document.querySelectorAll("#fd-usual-u-milk .fd-sheet__menu .fd-menu__item")].filter((i) => i.offsetParent !== null).map((i) => i.textContent.trim())`,
        );
        await ev(
            `document.querySelector("#fd-usual-u-milk [data-fd-menu-arm]").click()`,
        );
        await sleep(150);
        const menu1 = await ev<string[]>(
            `[...document.querySelectorAll("#fd-usual-u-milk .fd-sheet__menu .fd-menu__item")].filter((i) => i.offsetParent !== null).map((i) => i.textContent.trim())`,
        );
        const noPostYet = (await asPosts()).length === 0;
        await ev(
            `document.querySelector("#fd-usual-u-milk [data-fd-menu-cancel]").click()`,
        );
        await sleep(100);
        const menu2 = await ev<string[]>(
            `[...document.querySelectorAll("#fd-usual-u-milk .fd-sheet__menu .fd-menu__item")].filter((i) => i.offsetParent !== null).map((i) => i.textContent.trim())`,
        );
        await ev(
            `document.querySelector("#fd-usual-u-milk [data-fd-menu-arm]").click()`,
        );
        await sleep(100);
        await ev(
            `[...document.querySelectorAll("#fd-usual-u-milk .fd-sheet__menu .fd-menu__confirm-row .fd-menu__item")].find((i) => i.textContent.trim() === "Remove").click()`,
        );
        await sleep(600);
        const removePost = await asPosts();
        // The unit pull-down: every unit is reachable, choosing one names the stepper.
        await goto("/kitchen/usuals?food=u-milk");
        await control("reset=posts");
        await sleep(300);
        await ev(
            `document.querySelector('#fd-usual-u-milk [data-fd-menu-field][name="usual_unit"]').closest("[data-fd-menu]").querySelector("[data-fd-menu-trigger]").click()`,
        );
        await sleep(250);
        const unitMenu = await ev<{
            count: number;
            bad: string[];
            panelInside: boolean;
        }>(
            reachAll(
                `#fd-usual-u-milk [data-fd-menu]:has([name="usual_unit"])`,
            ),
        );
        await ev(
            `document.querySelector('#fd-usual-u-milk [data-fd-menu-value="g"]').click()`,
        );
        await sleep(200);
        const unitNow = await ev<{
            field: string;
            shown: string;
            stepper: string;
            closed: boolean;
        }>(`({
            field: document.querySelector('#fd-usual-u-milk [name="usual_unit"]').value,
            shown: document.querySelector('#fd-usual-u-milk [data-fd-menu]:has([name="usual_unit"]) .fd-item-row__value').textContent,
            stepper: document.querySelector("#fd-usual-u-milk .fd-stepper-control__unit")?.textContent ?? "",
            closed: document.querySelector('#fd-usual-u-milk [data-fd-menu]:has([name="usual_unit"]) .fd-menu__panel').hidden,
        })`);
        // Store chip, the stepper, the product picker, then Save posts the edit route.
        await ev(
            `[...document.querySelectorAll('#fd-usual-u-milk .fd-chip__input[name="usual_store_id"]')].find((i) => i.value === "s-tj").click()`,
        );
        await ev(
            `document.querySelector('#fd-usual-u-milk [data-fd-step="1"]').click()`,
        );
        await clickSel(
            '#fd-usual-u-milk [commandfor="fd-usual-u-milk-product"]',
        );
        await sleep(300);
        const picker = await ev<{
            open: boolean;
            rows: string[];
            checked: string;
            done: { w: number; h: number };
        }>(`(() => {
            const d = document.getElementById("fd-usual-u-milk-product");
            const done = d.querySelector(".fd-sheet__actions button").getBoundingClientRect();
            return {
                open: d.open,
                rows: [...d.querySelectorAll(".fd-item-row .fd-item-row__title")].map((t) => t.textContent),
                checked: d.querySelector('input[name="product_food_id"]:checked')?.parentElement.parentElement.querySelector(".fd-item-row__title")?.textContent ?? "",
                done: { w: Math.round(done.width), h: Math.round(done.height) },
            };
        })()`);
        await ev(`(() => {
            const i = document.querySelector("#fd-usual-u-milk-product [data-fd-usual-product-search] input");
            i.value = "organic";
            i.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        const narrowed = await ev<string[]>(
            `[...document.querySelectorAll("#fd-usual-u-milk-product [data-fd-usual-product]")].filter((r) => !r.hidden).map((r) => r.querySelector(".fd-item-row__title").textContent)`,
        );
        await ev(`(() => {
            const i = document.querySelector("#fd-usual-u-milk-product [data-fd-usual-product-search] input");
            i.value = "";
            i.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        await ev(
            `document.querySelector('#fd-usual-u-milk-product input[name="product_food_id"][value=""]').click()`,
        );
        await sleep(100);
        const productRow = await ev<string>(
            `document.querySelector('#fd-usual-u-milk [commandfor="fd-usual-u-milk-product"] .fd-item-row__value').textContent`,
        );
        await ev(
            `document.querySelector("#fd-usual-u-milk-product .fd-sheet__actions button").click()`,
        );
        await sleep(300);
        await clickSel(
            '#fd-usual-u-milk-form ~ .fd-sheet__actions, #fd-usual-u-milk .fd-sheet__actions button[type="submit"]',
        );
        await sleep(700);
        const savePost = postFields((await asPosts())[0]);
        const savePath = (await asPosts())[0]?.split(" ")[0];
        // Restock: its sheet opens over this one, posts the schedule route.
        await goto("/kitchen/usuals?food=u-milk");
        await control("reset=posts");
        await sleep(300);
        await clickSel(
            '#fd-usual-u-milk [commandfor="fd-usual-u-milk-restock"]',
        );
        await sleep(300);
        const restock = await ev<{
            open: boolean;
            labels: string[];
            save: { w: number; h: number };
        }>(`(() => {
            const d = document.getElementById("fd-usual-u-milk-restock");
            const save = d.querySelector(".fd-sheet__actions button").getBoundingClientRect();
            return {
                open: d.open,
                labels: [...d.querySelectorAll(".fd-chip__label")].map((l) => l.textContent),
                save: { w: Math.round(save.width), h: Math.round(save.height) },
            };
        })()`);
        await ev(
            `document.querySelector('#fd-usual-u-milk-restock input[name="restock_schedule"][value="monthly"]').click()`,
        );
        await clickSel(
            '#fd-usual-u-milk-restock .fd-sheet__actions button[type="submit"]',
        );
        await sleep(700);
        const restockLine = (await asPosts())[0];
        return {
            open,
            menu0,
            menu1,
            menu2,
            noPostYet,
            removePost,
            unitMenu,
            unitNow,
            picker,
            narrowed,
            productRow,
            savePath,
            savePost,
            restock,
            restockPath: restockLine?.split(" ")[0],
            restockPost: postFields(restockLine),
        };
    };
    const usualSheetPhone = await usualSheetCase(390);
    const usualSheetDesk = await usualSheetCase(1440);
    const usualSheetOk = (c: Awaited<ReturnType<typeof usualSheetCase>>) =>
        c.open.open &&
        c.open.title === "Milk" &&
        !c.open.hasRemoveButton &&
        c.open.rows.join("|") === "Product|Unit|Restock|Add when it runs low" &&
        c.open.chips.join("|") === "Any store|Costco|Trader Joe's" &&
        !c.open.overflow &&
        c.open.buttons.every((b) => b.w >= 36 && b.h >= 36) &&
        c.open.buttons
            .filter((b) => b.name === "Save")
            .every((b) => b.h >= 40 && b.w >= 200) &&
        c.menu0.join("|") === "Remove" &&
        c.menu1.join("|") === "Cancel|Remove" &&
        c.noPostYet &&
        c.menu2.join("|") === "Remove" &&
        c.removePost.join("\n") ===
            "/kitchen/usuals/u-milk/remove return_to=/kitchen/usuals" &&
        c.unitMenu.count > 8 &&
        c.unitMenu.bad.length === 0 &&
        c.unitMenu.panelInside &&
        c.unitNow.field === "g" &&
        c.unitNow.shown === "g" &&
        c.unitNow.stepper === "g" &&
        c.unitNow.closed &&
        c.picker.open &&
        c.picker.rows.join("|") ===
            "Kirkland 2% milk|Organic Valley whole milk|Any brand" &&
        c.picker.checked === "Kirkland 2% milk" &&
        c.picker.done.h >= 40 &&
        c.picker.done.w >= 200 &&
        c.narrowed.join("|") === "Organic Valley whole milk" &&
        c.productRow === "Any brand" &&
        c.savePath === "/kitchen/usuals/u-milk" &&
        c.savePost.usual_store_id === "s-tj" &&
        c.savePost.usual_amount === "65" &&
        c.savePost.usual_unit === "g" &&
        c.savePost.product_food_id === "" &&
        c.savePost.restock_when_low_present === "1" &&
        c.savePost.weights_present === "1" &&
        c.savePost.return_to === "/kitchen/usuals" &&
        c.restock.open &&
        c.restock.labels.join("|") ===
            "No schedule|Every week|Every N weeks|Every month" &&
        c.restock.save.h >= 40 &&
        c.restock.save.w >= 200 &&
        c.restockPath === "/kitchen/usuals/u-milk/schedule" &&
        c.restockPost.restock_schedule === "monthly" &&
        c.restockPost.scope === "schedule" &&
        c.restockPost.return_to === "/kitchen/usuals";
    record(
        "v2 usuals sheet: a row opens it; its header ⋯ holds Remove and asks in place (Cancel puts it back, Remove posts /remove with the return path); the Unit pull-down lists every unit on the screen and names the stepper; the product picker lists the products and Any brand, narrows as typed and shows the pick in the Product row; Save posts the edit route's fields (store, amount, unit, product, markers); Restock posts the schedule route; every sheet button is at least 36px (Save and Done 40px by 200px), on the phone and at 1440",
        usualSheetOk(usualSheetPhone) && usualSheetOk(usualSheetDesk),
        { usualSheetPhone, usualSheetDesk, ex: drain() },
    );

    const addUsualCase = async (width: number) => {
        await setViewport(width);
        await goto("/kitchen/usuals");
        await setMarker();
        await control("reset=posts");
        await ev(
            `${visible("[aria-label='Add a usual'][commandfor='fd-usual-add']")}[0].click()`,
        );
        await sleep(400);
        const open = await ev<{
            open: boolean;
            ways: string[];
            scanTarget: string | null;
            searchShown: boolean;
            typeHidden: boolean;
            foods: string[];
        }>(`(() => {
            const d = document.getElementById("fd-usual-add");
            return {
                open: d.open,
                ways: [...d.querySelectorAll(".fd-quick-action__caption")].map((c) => c.textContent),
                scanTarget: d.querySelector("[data-fd-scanner-target]")?.getAttribute("data-fd-scanner-target") ?? null,
                searchShown: !d.querySelector('[data-fd-usual-add-panel="search"]').hidden,
                typeHidden: d.querySelector('[data-fd-usual-add-panel="type"]').hidden,
                foods: [...d.querySelectorAll("[data-fd-usual-food] .fd-item-row__title")].map((t) => t.textContent),
            };
        })()`);
        // Typing narrows the foods; a plus adds that food as a usual.
        await ev(`(() => {
            const i = document.getElementById("fd-usual-add-q");
            i.value = "spin";
            i.dispatchEvent(new Event("input", { bubbles: true }));
        })()`);
        const narrowed = await ev<string[]>(
            `[...document.querySelectorAll("#fd-usual-add [data-fd-usual-food]")].filter((r) => !r.hidden).map((r) => r.querySelector(".fd-item-row__title").textContent)`,
        );
        await clickSel(
            '#fd-usual-add [data-fd-usual-food="spinach"] .fd-item-row__add',
        );
        await sleep(600);
        const searchPost = (await asPosts())[0];
        // Type it: the other view shows, the form posts the manual route.
        await goto("/kitchen/usuals");
        await control("reset=posts");
        await ev(`document.getElementById("fd-usual-add").showModal()`);
        await sleep(300);
        await clickSel('#fd-usual-add [data-fd-usual-add-tab="type"]');
        await sleep(200);
        const typeView = await ev<{
            typeShown: boolean;
            searchHidden: boolean;
            serving: string;
            submit: { w: number; h: number };
            formW: number;
            pulldowns: string[];
            macros: number;
            tilesHidden: boolean;
        }>(`(() => {
            const d = document.getElementById("fd-usual-add");
            const form = d.querySelector(".fd-usual-add-type");
            const b = form.querySelector('button[type="submit"]').getBoundingClientRect();
            return {
                typeShown: !d.querySelector('[data-fd-usual-add-panel="type"]').hidden,
                searchHidden: d.querySelector('[data-fd-usual-add-panel="search"]').hidden,
                serving: getComputedStyle(form.querySelector(".fd-usual-add-serving")).display,
                submit: { w: Math.round(b.width), h: Math.round(b.height) },
                formW: Math.round(form.getBoundingClientRect().width),
                pulldowns: [...form.querySelectorAll("[data-fd-menu] .fd-item-row__face .fd-item-row__title")].map((t) => t.textContent),
                macros: form.querySelectorAll(".fd-usual-add-macros input").length,
                tilesHidden: d.querySelector("[data-fd-usual-add-tiles]").offsetParent === null,
            };
        })()`);
        // Back returns to the tiles; Type it again for the form below.
        await clickSel("#fd-usual-add .fd-usual-add-back button");
        await sleep(150);
        const backView = await ev<{ tiles: boolean; search: boolean }>(`(() => {
            const d = document.getElementById("fd-usual-add");
            return {
                tiles: d.querySelector("[data-fd-usual-add-tiles]").offsetParent !== null,
                search: !d.querySelector('[data-fd-usual-add-panel="search"]').hidden,
            };
        })()`);
        await clickSel('#fd-usual-add [data-fd-usual-add-tab="type"]');
        await sleep(150);
        await ev(`(() => {
            const set = (n, v) => { const i = document.querySelector('#fd-usual-add .fd-usual-add-type [name="' + n + '"]'); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); };
            set("name", "Oat milk"); set("calories", "46"); set("protein_g", "1"); set("carbs_g", "6.7"); set("fat_g", "1.5");
        })()`);
        await ev(
            `document.querySelector('#fd-usual-add .fd-usual-add-type input[name="basis"][value="per_100ml"]').click()`,
        );
        const servingAfter = await ev<string>(
            `getComputedStyle(document.querySelector("#fd-usual-add .fd-usual-add-serving")).display`,
        );
        await ev(
            `document.querySelector('#fd-usual-add .fd-usual-add-type input[name="basis"][value="per_serving"]').click()`,
        );
        const servingPer = await ev<string>(
            `getComputedStyle(document.querySelector("#fd-usual-add .fd-usual-add-serving")).display`,
        );
        await ev(
            `document.querySelector('#fd-usual-add .fd-usual-add-type input[name="basis"][value="per_100ml"]').click()`,
        );
        // The Store pull-down: every store is reachable, choosing one rides in the field.
        await ev(
            `document.querySelector('#fd-usual-add [data-fd-menu]:has([name="usual_store_id"]) [data-fd-menu-trigger]').click()`,
        );
        await sleep(250);
        const storeMenu = await ev<{
            count: number;
            bad: string[];
            panelInside: boolean;
        }>(
            reachAll(
                `#fd-usual-add [data-fd-menu]:has([name="usual_store_id"])`,
            ),
        );
        await ev(
            `document.querySelector('#fd-usual-add [data-fd-menu-value="s-tj"]').click()`,
        );
        await sleep(150);
        await clickSel(
            '#fd-usual-add .fd-usual-add-type button[type="submit"]',
        );
        await sleep(700);
        const typePost = (await asPosts())[0];
        return {
            open,
            narrowed,
            searchPath: searchPost?.split(" ")[0],
            searchPost: postFields(searchPost),
            typeView,
            backView,
            servingAfter,
            servingPer,
            storeMenu,
            typePath: typePost?.split(" ")[0],
            typePost: postFields(typePost),
        };
    };
    const addUsualPhone = await addUsualCase(390);
    const addUsualDesk = await addUsualCase(1440);
    const addUsualOk = (c: Awaited<ReturnType<typeof addUsualCase>>) =>
        c.open.open &&
        c.open.ways.join("|") === "Scan a barcode|Search your foods|Type it" &&
        c.open.scanTarget === "/kitchen/usuals/add/barcode/{code}" &&
        c.open.searchShown &&
        c.open.typeHidden &&
        c.open.foods.join("|") === "Butter|Sourdough bread|Spinach" &&
        c.narrowed.join("|") === "Spinach" &&
        c.searchPath === "/kitchen/usuals/add/product" &&
        c.searchPost.product_id === "f-spinach" &&
        c.searchPost.food_choice === "f-spinach" &&
        c.searchPost.via === "search" &&
        c.typeView.typeShown &&
        c.typeView.searchHidden &&
        // Type it shows its form alone; Back returns to the tiles.
        c.typeView.tilesHidden &&
        c.backView.tiles &&
        c.backView.search &&
        c.typeView.serving === "none" &&
        c.servingAfter === "none" &&
        c.servingPer !== "none" &&
        c.typeView.submit.h >= 40 &&
        c.typeView.submit.w >= c.typeView.formW - 2 &&
        c.typeView.pulldowns.join("|") === "Unit|Store" &&
        c.typeView.macros === 4 &&
        c.storeMenu.count === 3 &&
        c.storeMenu.bad.length === 0 &&
        c.storeMenu.panelInside &&
        c.typePath === "/kitchen/usuals/add/manual" &&
        c.typePost.name === "Oat milk" &&
        c.typePost.calories === "46" &&
        c.typePost.basis === "per_100ml" &&
        c.typePost.usual_store_id === "s-tj" &&
        c.typePost.usual_unit === "each" &&
        c.typePost.return_to === "/kitchen/usuals";
    record(
        "v2 usuals Add a usual: the + opens one sheet with Scan a barcode, Search your foods and Type it; the foods are listed and typing narrows them, a plus posts the add route with its food; Type it shows its form (serving size only for Per serving), its Store pull-down lists every store on the screen, and Add usual is full width and at least 40px tall and posts the manual route, on the phone and at 1440",
        addUsualOk(addUsualPhone) && addUsualOk(addUsualDesk),
        { addUsualPhone, addUsualDesk, ex: drain() },
    );

    // Restock: Weeks between shows only while "Every N weeks" is chosen.
    await setViewport(390);
    await goto("/kitchen/usuals");
    const weeksToggle = await ev<{
        atLoad: boolean;
        everyN: boolean;
        weekly: boolean;
    }>(`(() => {
        const form = document.querySelector("form:has([data-fd-restock-weeks])");
        const box = form.querySelector("[data-fd-restock-weeks]");
        const pick = (v) => form.querySelector('input[name="restock_schedule"][value="' + v + '"]').click();
        const atLoad = box.hidden;
        pick("every_n_weeks");
        const everyN = box.hidden;
        pick("weekly");
        return { atLoad, everyN, weekly: box.hidden };
    })()`);
    record(
        "v2 usuals Restock sheet: Weeks between is hidden until Every N weeks is chosen, and hides again for another choice",
        weeksToggle.atLoad && !weeksToggle.everyN && weeksToggle.weekly,
        { weeksToggle, ex: drain() },
    );

    // The camera kill switch: the same opener asks for the number by hand.
    await setViewport(390);
    await goto("/kitchen/usuals?camera=off");
    await ev(`document.getElementById("fd-usual-add").showModal()`);
    await sleep(300);
    const usualsCameraOff = await ev<{
        ways: string[];
        opener: string | null;
        menus: number;
    }>(`({
        ways: [...document.querySelectorAll("#fd-usual-add .fd-quick-action__caption")].map((c) => c.textContent),
        opener: document.querySelector("#fd-usual-add [data-fd-open-sheet]")?.getAttribute("data-fd-open-sheet") ?? null,
        menus: [...document.querySelectorAll(".fd-menu__panel")].filter((p) => p.querySelectorAll('[role^="menuitem"]').length === 0).length,
    })`);
    await goto("/kitchen/usuals");
    const usualsCameraOn = await ev<{ menus: number }>(
        `({ menus: [...document.querySelectorAll(".fd-menu__panel")].filter((p) => p.querySelectorAll('[role^="menuitem"]').length === 0).length })`,
    );
    record(
        "v2 usuals with barcode-camera off: Add a usual offers Enter a barcode (the same scanner opener, its number field) in place of Scan a barcode, and no ⋯ menu is empty with it on or off",
        usualsCameraOff.ways.join("|") ===
            "Enter a barcode|Search your foods|Type it" &&
            usualsCameraOff.opener === "fd-barcode-scan" &&
            usualsCameraOff.menus === 0 &&
            usualsCameraOn.menus === 0,
        { usualsCameraOff, usualsCameraOn, ex: drain() },
    );

    // Trends: the Page header, the range tabs (the year only from 1024), the
    // summary tiles, the averages table, the bars, the weight line and Go to a day.
    const trendsCase = async (width: number) => {
        await setViewport(width);
        await goto("/trends");
        await setMarker();
        const base = await ev<{
            title: string;
            subtitle: string;
            tabs: string[];
            active: string | null;
            tiles: number;
            rows: string[];
            bars: number;
            weight: boolean;
            goto: boolean;
            noOverflow: boolean;
            columns: number;
        }>(`(() => {
            const panel = document.querySelector("[data-fd-trends-panel]:not([hidden])");
            return {
                title: document.querySelector(".fd-page-header__title")?.textContent ?? "",
                subtitle: document.querySelector(".fd-page-header__subtitle")?.textContent ?? "",
                tabs: [...${visible(".fd-trends-range .fd-tab-row__tab")}].map((t) => t.textContent),
                active: document.querySelector('[data-fd-trends-range][aria-current="page"]')?.getAttribute("data-fd-trends-range") ?? null,
                tiles: panel.querySelectorAll(".fd-stat-card").length,
                rows: [...panel.querySelectorAll(".fd-table-row .fd-table-row__label")].map((r) => r.textContent),
                bars: panel.querySelectorAll(".fd-trends-bar").length,
                weight: !!panel.querySelector(".fd-trends-weight__line")?.getAttribute("d"),
                goto: !!panel.querySelector("[data-fd-trends-goto]"),
                noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
                columns: new Set([...panel.querySelectorAll(".fd-page-layout__column")].map((c) => Math.round(c.getBoundingClientRect().left))).size,
            };
        })()`);
        await clickSel('[data-fd-trends-range="7"]');
        await sleep(200);
        const seven = await ev<{
            active: string | null;
            panel: string | null;
            hidden30: boolean;
            subtitle: string;
            days: number;
            path: string;
            marker: string | null;
        }>(`({
            active: document.querySelector('[data-fd-trends-range][aria-current="page"]')?.getAttribute("data-fd-trends-range") ?? null,
            panel: document.querySelector("[data-fd-trends-panel]:not([hidden])")?.getAttribute("data-fd-trends-panel") ?? null,
            hidden30: document.querySelector('[data-fd-trends-panel="30"]')?.hasAttribute("hidden") ?? false,
            subtitle: document.querySelector(".fd-page-header__subtitle")?.textContent ?? "",
            days: document.querySelectorAll('[data-fd-trends-panel="7"] .fd-trends-bar__day').length,
            path: location.pathname + location.search,
            marker: window.__marker ?? null,
        })`);
        return { base, seven };
    };
    const trendsPhone = await trendsCase(390);
    const trendsDesk = await trendsCase(1440);
    record(
        "v2 trends: the Page header with Last 30 days, the range tabs (7, 30, 90 days; the year as a fourth from 1024px), four summary tiles, the averages table, a bar a day, the weight line and Go to a day, one column on the phone and two at 1440 with no sideways scroll; 7 days flips the tab, the panel, the subtitle and the weekday letters with no request",
        trendsPhone.base.title === "Trends" &&
            trendsPhone.base.subtitle === "Last 30 days" &&
            trendsPhone.base.tabs.join("|") === "7 days|30 days|90 days" &&
            trendsDesk.base.tabs.join("|") ===
                "7 days|30 days|90 days|365 days" &&
            [trendsPhone, trendsDesk].every(
                (c) =>
                    c.base.active === "30" &&
                    c.base.tiles === 4 &&
                    c.base.rows.join("|") === "|Calories|Protein|Carbs|Fat" &&
                    c.base.bars === 30 &&
                    c.base.weight &&
                    c.base.goto &&
                    c.base.noOverflow &&
                    c.seven.active === "7" &&
                    c.seven.panel === "7" &&
                    c.seven.hidden30 &&
                    c.seven.subtitle === "Last 7 days" &&
                    c.seven.days === 7 &&
                    c.seven.path === "/trends?range=7" &&
                    c.seven.marker === "stay",
            ) &&
            trendsPhone.base.columns === 1 &&
            trendsDesk.base.columns === 2,
        { trendsPhone, trendsDesk, ex: drain() },
    );
    // Calories by day never widens the page: every range, a bar a day, at both
    // widths. A long range scrolls inside its own chart.
    const trendsRanges = async (width: number) => {
        await setViewport(width);
        await goto("/trends");
        const out: {
            range: number;
            bars: number;
            noOverflow: boolean;
            scrollWidth: number;
            viewport: number;
        }[] = [];
        for (const range of [7, 30, 90, 365]) {
            out.push(
                await ev<(typeof out)[number]>(`(() => {
                    for (const p of document.querySelectorAll("[data-fd-trends-panel]")) {
                        p.hidden = p.getAttribute("data-fd-trends-panel") !== "${range}";
                    }
                    const panel = document.querySelector('[data-fd-trends-panel="${range}"]');
                    return {
                        range: ${range},
                        bars: panel.querySelectorAll(".fd-trends-bar").length,
                        // The width asked for, not innerWidth: a phone's layout
                        // viewport grows with content that overflows.
                        noOverflow: document.documentElement.scrollWidth <= ${width} + 1,
                        scrollWidth: document.documentElement.scrollWidth,
                        viewport: ${width},
                    };
                })()`),
            );
        }
        return out;
    };
    const trendsRangesPhone = await trendsRanges(390);
    const trendsRangesDesk = await trendsRanges(1440);
    record(
        "v2 trends: Calories by day draws a bar a day for 7, 30, 90 and 365 days and the page never widens past the viewport, at 390 and 1440",
        [trendsRangesPhone, trendsRangesDesk].every((rows) =>
            rows.every((r) => r.bars === r.range && r.noOverflow),
        ),
        { trendsRangesPhone, trendsRangesDesk, ex: drain() },
    );
    // Calories by day opens on the newest day: a long range is scrolled to its
    // right edge when its tab is pressed and again after a Turbo visit.
    const barsAtEnd = async (width: number, range: number) => {
        await setViewport(width);
        await goto("/trends");
        const read = () =>
            ev<{ overflows: boolean; atEnd: boolean }>(`(() => {
                const el = document.querySelector('[data-fd-trends-panel="${range}"] .fd-trends-bars');
                return {
                    overflows: el.scrollWidth > el.clientWidth + 1,
                    atEnd: el.scrollWidth - el.clientWidth - el.scrollLeft <= 1,
                };
            })()`);
        await clickSel(`[data-fd-trends-range="${range}"]`);
        await sleep(150);
        const afterTab = await read();
        await ev(`window.Turbo.visit("/kitchen/fridge")`);
        await sleep(500);
        await ev(`window.Turbo.visit("/trends")`);
        await sleep(500);
        await clickSel(`[data-fd-trends-range="${range}"]`);
        await sleep(150);
        const afterVisit = await read();
        return { width, range, afterTab, afterVisit };
    };
    const barsEndPhone = await barsAtEnd(390, 90);
    const barsEndDesk = await barsAtEnd(1440, 365);
    record(
        "v2 trends: Calories by day opens scrolled to the newest day (90 days at 390, 365 days at 1440), after a tab press and after a Turbo visit",
        [barsEndPhone, barsEndDesk].every(
            (r) =>
                r.afterTab.overflows &&
                r.afterTab.atEnd &&
                r.afterVisit.overflows &&
                r.afterVisit.atEnd,
        ),
        { barsEndPhone, barsEndDesk, ex: drain() },
    );
    await setViewport(390);

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
        title: document.querySelector(".fd-page-header__title")?.textContent?.trim() ?? null,
    })`);
    await clickSel('[data-fd-trends-range="7"]');
    await sleep(200);
    const trends7d = await ev<{
        pressed: string | null;
        panel: string | null;
        hidden30: boolean;
    }>(`({
        pressed: document.querySelector('[data-fd-trends-range][aria-current="page"]')?.getAttribute("data-fd-trends-range") ?? null,
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
