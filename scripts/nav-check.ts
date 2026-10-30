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

await import("node:fs/promises").then((fs) =>
    fs.mkdir("./tmp", { recursive: true }),
);
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

    await control("post=ok&delay=0&reset=posts");
    await goto("/fridge");
    await setMarker();
    await clickSel('button[aria-label="Edit Eggs"]');
    await sleep(40);
    const eggsEdit = await ev<{
        open: boolean;
        dialogs: number;
        action: string | null;
        amount: string | null;
        unit: string | null;
        location: string | null;
        expires: string | null;
        title: string | null;
        expectedExpires: string | null;
    }>(`(() => {
        const dialog = document.getElementById("fridge-edit-food");
        const form = dialog?.querySelector("form.fridge-item-edit");
        const trigger = document.querySelector('button[aria-label="Edit Eggs"]');
        return {
            open: !!dialog?.open,
            dialogs: document.querySelectorAll("#fridge-edit-food").length,
            action: form?.getAttribute("action") ?? null,
            amount: form?.querySelector("input[name='qty_amount']")?.value ?? null,
            unit: form?.querySelector("select[name='qty_unit']")?.value ?? null,
            location: form?.querySelector("select[name='location_id']")?.value ?? null,
            expires: form?.querySelector("input[name='expires_on']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
            expectedExpires: trigger?.getAttribute("data-fill-field-expires_on") ?? null,
        };
    })()`);
    await ev(`document.getElementById("fridge-edit-food")?.close()`);
    await clickSel('button[aria-label="Edit Paper towels"]');
    await sleep(40);
    const supplyEdit = await ev<{
        open: boolean;
        action: string | null;
        amount: string | null;
        unit: string | null;
        location: string | null;
        expires: string | null;
        title: string | null;
    }>(`(() => {
        const dialog = document.getElementById("fridge-edit-supply");
        const form = dialog?.querySelector("form.fridge-item-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            amount: form?.querySelector("input[name='qty_amount']")?.value ?? null,
            unit: form?.querySelector("select[name='qty_unit']")?.value ?? null,
            location: form?.querySelector("select[name='location_id']")?.value ?? null,
            expires: form?.querySelector("input[name='expires_on']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
        };
    })()`);
    await ev(`document.getElementById("fridge-edit-supply")?.close()`);
    await clickSel('button[aria-label="Edit Yogurt"]');
    await sleep(40);
    const yogurtEdit = await ev<{
        open: boolean;
        action: string | null;
        amount: string | null;
        unit: string | null;
        location: string | null;
        title: string | null;
        error: string | null;
    }>(`(() => {
        const dialog = document.getElementById("fridge-edit-food");
        const form = dialog?.querySelector("form.fridge-item-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            amount: form?.querySelector("input[name='qty_amount']")?.value ?? null,
            unit: form?.querySelector("select[name='qty_unit']")?.value ?? null,
            location: form?.querySelector("select[name='location_id']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
            error: dialog?.querySelector(".error-banner")?.textContent ?? null,
        };
    })()`);
    await ev(`document.getElementById("fridge-edit-food")?.close()`);
    await clickSel('button[aria-label="Edit Eggs"]');
    await sleep(40);
    await ev(`(() => {
        const input = document.querySelector("#fridge-edit-food input[name='qty_amount']");
        if (input) input.value = "12";
    })()`);
    await clickSel("#fridge-edit-food button[type='submit']");
    await sleep(700);
    const afterEdit = await snap();
    const editPosts = await stats();
    const editPost = editPosts.posts.find((p) => p.path === "/fridge/items/i2");
    const eggsQty = await ev<string | null>(
        `document.querySelector('li.fridge-item[data-item-id="i2"] .fridge-item-qty')?.textContent ?? null`,
    );
    await clickSel('button[aria-label="Edit Eggs"]');
    await sleep(40);
    const reopened = await ev<string | null>(
        `document.querySelector("#fridge-edit-food input[name='qty_amount']")?.value ?? null`,
    );
    record(
        "fridge shared edit dialog",
        eggsEdit.open === true &&
            eggsEdit.dialogs === 1 &&
            eggsEdit.action === "/fridge/items/i2" &&
            eggsEdit.amount === "6" &&
            eggsEdit.unit === "each" &&
            eggsEdit.location === "l1" &&
            eggsEdit.title === "Edit Eggs" &&
            eggsEdit.expires === eggsEdit.expectedExpires &&
            !!eggsEdit.expires &&
            supplyEdit.open === true &&
            supplyEdit.action === "/fridge/items/i6" &&
            supplyEdit.amount === "3" &&
            supplyEdit.unit === "roll" &&
            supplyEdit.location === "l2" &&
            supplyEdit.expires === "" &&
            supplyEdit.title === "Edit Paper towels" &&
            yogurtEdit.open === true &&
            yogurtEdit.action === "/fridge/items/i3" &&
            yogurtEdit.amount === "2" &&
            yogurtEdit.unit === "each" &&
            yogurtEdit.location === "l1" &&
            yogurtEdit.title === "Edit Yogurt" &&
            yogurtEdit.error == null &&
            afterEdit.marker === "stay" &&
            afterEdit.href.endsWith("/fridge") &&
            afterEdit.open.length === 0 &&
            editPost !== undefined &&
            editPost.entries.some(
                ([k, v]) => k === "qty_amount" && v === "12",
            ) &&
            editPost.entries.some(
                ([k, v]) => k === "qty_unit" && v === "each",
            ) &&
            eggsQty != null &&
            eggsQty.includes("12 ·") &&
            reopened === "12",
        {
            eggsEdit,
            supplyEdit,
            afterEdit,
            editPost,
            eggsQty,
            reopened,
            yogurtEdit,
            ex: drain(),
        },
    );

    await control("post=fail&modal=fridge-edit-i2&reset=posts&delay=0");
    await goto("/fridge");
    await setMarker();
    await clickSel('button[aria-label="Edit Eggs"]');
    await sleep(40);
    await clickSel("#fridge-edit-food button[type='submit']");
    await sleep(700);
    const editError = await ev<{
        open: boolean;
        action: string | null;
        amount: string | null;
        title: string | null;
        banners: number;
        error: string | null;
    }>(`(() => {
        const dialog = document.getElementById("fridge-edit-food");
        const form = dialog?.querySelector("form.fridge-item-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            amount: form?.querySelector("input[name='qty_amount']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
            banners: document.querySelectorAll(".error-banner").length,
            error: dialog?.querySelector(".error-banner")?.textContent ?? null,
        };
    })()`);
    record(
        "fridge shared edit server error",
        editError.open === true &&
            editError.action === "/fridge/items/i2" &&
            editError.amount === "6" &&
            editError.title === "Edit Eggs" &&
            editError.error === "Name is required" &&
            editError.banners === 1,
        { editError, ex: drain() },
    );
    await control("post=ok&modal=&reset=posts&delay=0");

    await goto("/settings/foods");
    await setMarker();
    await clickSel('button[data-fill-title="Edit Eggs"]');
    await sleep(40);
    await ev(`document.getElementById("food-edit")?.close()`);
    await clickSel('button[data-fill-title="Edit Milk"]');
    await sleep(40);
    const milkEdit = await ev<{
        open: boolean;
        action: string | null;
        name: string | null;
        calories: string | null;
        title: string | null;
        error: string | null;
    }>(`(() => {
        const dialog = document.getElementById("food-edit");
        const form = dialog?.querySelector("form.food-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            name: form?.querySelector("input[name='name']")?.value ?? null,
            calories: form?.querySelector("input[name='calories']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
            error: dialog?.querySelector(".error-banner")?.textContent ?? null,
        };
    })()`);
    record(
        "foods shared edit dialog",
        milkEdit.open === true &&
            milkEdit.action === "/settings/foods/f2" &&
            milkEdit.name === "Milk" &&
            milkEdit.calories === "64" &&
            milkEdit.title === "Edit Milk" &&
            milkEdit.error == null,
        { milkEdit, ex: drain() },
    );
    await ev(`document.getElementById("food-edit")?.close()`);
    await control("post=fail&modal=food-edit-f1&reset=posts&delay=0");
    await goto("/settings/foods");
    await clickSel('button[data-fill-title="Edit Eggs"]');
    await sleep(40);
    await clickSel("#food-edit button[type='submit']");
    await sleep(700);
    const foodEditError = await ev<{
        open: boolean;
        action: string | null;
        name: string | null;
        title: string | null;
        banners: number;
        error: string | null;
    }>(`(() => {
        const dialog = document.getElementById("food-edit");
        const form = dialog?.querySelector("form.food-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            name: form?.querySelector("input[name='name']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
            banners: document.querySelectorAll(".error-banner").length,
            error: dialog?.querySelector(".error-banner")?.textContent ?? null,
        };
    })()`);
    record(
        "foods shared edit server error",
        foodEditError.open === true &&
            foodEditError.action === "/settings/foods/f1" &&
            foodEditError.name === "Eggs" &&
            foodEditError.title === "Edit Eggs" &&
            foodEditError.error === "Name is required" &&
            foodEditError.banners === 1,
        { foodEditError, ex: drain() },
    );
    await control("post=ok&modal=&reset=posts&delay=0");

    await goto("/recipes/r1");
    await setMarker();
    await clickSel('button[aria-label="Edit Eggs"]');
    await sleep(40);
    await ev(`document.getElementById("recipe-edit-ingredient")?.close()`);
    await clickSel('button[aria-label="Edit Milk"]');
    await sleep(40);
    const milkIngredient = await ev<{
        open: boolean;
        action: string | null;
        note: string | null;
        amount: string | null;
        title: string | null;
    }>(`(() => {
        const dialog = document.getElementById("recipe-edit-ingredient");
        const form = dialog?.querySelector("form.recipe-ingredient-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            note: form?.querySelector("input[name='note']")?.value ?? null,
            amount: form?.querySelector("input[name='amount']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
        };
    })()`);
    await ev(`document.getElementById("recipe-edit-ingredient")?.close()`);
    await clickSel('button[aria-label="Remove Eggs"]');
    await sleep(40);
    await ev(`document.getElementById("recipe-delete-ingredient")?.close()`);
    await clickSel('button[aria-label="Remove Milk"]');
    await sleep(40);
    const milkDelete = await ev<{
        open: boolean;
        action: string | null;
        message: string | null;
    }>(`(() => {
        const dialog = document.getElementById("recipe-delete-ingredient");
        const form = dialog?.querySelector("form");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            message: dialog?.querySelector(".modal-message")?.textContent ?? null,
        };
    })()`);
    record(
        "recipe shared ingredient dialogs",
        milkIngredient.open === true &&
            milkIngredient.action === "/recipes/r1/ingredients/ing2" &&
            milkIngredient.note === "" &&
            milkIngredient.amount === "200" &&
            milkIngredient.title === "Edit Milk" &&
            milkDelete.open === true &&
            milkDelete.action === "/recipes/r1/ingredients/ing2/delete" &&
            milkDelete.message === "Remove Milk from this recipe?",
        { milkIngredient, milkDelete, ex: drain() },
    );
    await ev(`document.getElementById("recipe-delete-ingredient")?.close()`);
    await control(
        "post=fail&modal=recipe-edit-ingredient-ing1&reset=posts&delay=0",
    );
    await goto("/recipes/r1");
    await clickSel('button[aria-label="Edit Eggs"]');
    await sleep(40);
    await clickSel("#recipe-edit-ingredient button[type='submit']");
    await sleep(700);
    const ingredientError = await ev<{
        open: boolean;
        action: string | null;
        note: string | null;
        amount: string | null;
        title: string | null;
        banners: number;
        error: string | null;
    }>(`(() => {
        const dialog = document.getElementById("recipe-edit-ingredient");
        const form = dialog?.querySelector("form.recipe-ingredient-edit");
        return {
            open: !!dialog?.open,
            action: form?.getAttribute("action") ?? null,
            note: form?.querySelector("input[name='note']")?.value ?? null,
            amount: form?.querySelector("input[name='amount']")?.value ?? null,
            title: dialog?.querySelector(".modal-title")?.textContent ?? null,
            banners: document.querySelectorAll(".error-banner").length,
            error: dialog?.querySelector(".error-banner")?.textContent ?? null,
        };
    })()`);
    record(
        "recipe shared ingredient server error",
        ingredientError.open === true &&
            ingredientError.action === "/recipes/r1/ingredients/ing1" &&
            ingredientError.note === "large" &&
            ingredientError.amount === "6" &&
            ingredientError.title === "Edit Eggs" &&
            ingredientError.error === "Name is required" &&
            ingredientError.banners === 1,
        { ingredientError, ex: drain() },
    );
    await control("post=ok&modal=&reset=posts&delay=0");

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
    await ev(`new Promise((resolve) => {
        document.addEventListener("turbo:load", resolve, { once: true });
        document.querySelector('nav.bottom-nav a[href="/fridge"]').click();
    })`);
    // A revisit must render once: a cached-snapshot preview followed by the
    // fresh page replays the entrance animation, so the tab "loads twice".
    // Leaving "/" cached it; without that the check passes on a cache miss.
    // The preview waits a frame and a faster response cancels it, so stall
    // the response the way a real network does.
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
        document.querySelector('nav.bottom-nav a[href="/"]').click();
    })`);
    await control("stall=0");
    record(
        "tab revisit renders once (no cached preview)",
        rootCached && renders.length === 1 && renders[0] === false,
        { rootCached, renders },
    );
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
    await clickSel('button[commandfor="nutrition-log-meal"]');
    await sleep(40);
    await ev(`(() => {
        const root = document.querySelector("#nutrition-log-meal [data-meal-items]");
        if (!root) return;
        root.querySelector("[data-add-meal-item]")?.click();
    })()`);
    await sleep(40);
    await ev(`(() => {
        const names = document.querySelectorAll("#nutrition-log-meal [data-meal-item-name]");
        if (names[0]) names[0].value = "Apple";
        if (names[1]) names[1].value = "Banana";
    })()`);
    await ev(`(() => {
        const rows = document.querySelectorAll("#nutrition-log-meal [data-meal-item]");
        const second = rows[1];
        if (second) second.querySelector("[data-meal-item-remove]")?.click();
    })()`);
    await sleep(40);
    await clickSel("#nutrition-log-meal button[type='submit']");
    await sleep(500);
    const mealPosts = await stats();
    const mealPost = mealPosts.posts.find((p) => p.path === "/log-meal");
    const itemNames =
        mealPost?.entries
            .filter(([k]) => k === "item_name")
            .map(([, v]) => v) ?? [];
    record(
        "nutrition log meal add remove row",
        mealPost !== undefined &&
            itemNames.length === 1 &&
            itemNames[0] === "Apple",
        { itemNames, mealPost, ex: drain() },
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

    const NAV_THEME = { light: "#fefefd", dark: "#131615" };

    await control("session=app&theme=dark&reset=posts&post=ok");
    await goto("/settings");
    await setMarker();
    const darkStart = await themeSnap();
    await ev(`(() => {
        const light = document.querySelector('input[name="theme"][value="light"]');
        if (light) light.checked = true;
        document.querySelector("form.appearance.panel")?.requestSubmit();
    })()`);
    await sleep(600);
    const afterLight = await themeSnap();
    await clickSel('nav.bottom-nav a[href="/"]');
    await sleep(250);
    const nutritionLight = await themeSnap();
    await clickSel('nav.bottom-nav a[href="/settings"]');
    await sleep(200);
    await ev(`(() => {
        const system = document.querySelector('input[name="theme"][value="system"]');
        if (system) system.checked = true;
        document.querySelector("form.appearance.panel")?.requestSubmit();
    })()`);
    await sleep(600);
    const afterSystem = await themeSnap();
    const themeMetaBaseline = await ev<{
        count: number;
        ids: number[];
        contents: string[];
    }>(`(() => {
        const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
        metas.forEach((m, i) => { m.__foodableNavCheck = 100 + i; });
        return {
            count: metas.length,
            ids: metas.map((m) => m.__foodableNavCheck),
            contents: metas.map((m) => m.getAttribute("content")),
        };
    })()`);
    await clickSel('nav.bottom-nav a[href="/fridge"]');
    await sleep(200);
    const fridgeTheme = await themeSnap();
    await clickSel('nav.bottom-nav a[href="/settings"]');
    await sleep(200);
    const settingsAgain = await themeSnap();
    const themeMetaAfter = await ev<{
        count: number;
        ids: (number | null)[];
        contents: string[];
        sameNodes: boolean;
    }>(`(() => {
        const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
        return {
            count: metas.length,
            ids: metas.map((m) => m.__foodableNavCheck ?? null),
            contents: metas.map((m) => m.getAttribute("content")),
            sameNodes: metas.every((m, i) => m.__foodableNavCheck === 100 + i),
        };
    })()`);

    record(
        "theme sync across morph refresh and tab visits",
        darkStart.dataTheme === "dark" &&
            darkStart.marker === "stay" &&
            afterLight.dataTheme === "light" &&
            afterLight.meta === "light" &&
            afterLight.bg === "#fbfaf7" &&
            nutritionLight.widgetTheme === "light" &&
            nutritionLight.marker === "stay" &&
            afterLight.marker === "stay" &&
            afterSystem.dataTheme === null &&
            afterSystem.meta === "system" &&
            fridgeTheme.dataTheme === null &&
            settingsAgain.dataTheme === null &&
            settingsAgain.meta === "system" &&
            themeMetaAfter.count === themeMetaBaseline.count &&
            themeMetaAfter.sameNodes &&
            themeMetaAfter.contents.join() ===
                themeMetaBaseline.contents.join(),
        {
            darkStart,
            afterLight,
            nutritionLight,
            afterSystem,
            fridgeTheme,
            settingsAgain,
            themeMetaBaseline,
            themeMetaAfter,
            ex: drain(),
        },
    );

    await control("theme=dark&post=ok");
    await goto("/settings");
    await send("Emulation.setDeviceMetricsOverride", {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: true,
    });
    await ev(`(() => {
        const light = document.querySelector('input[name="theme"][value="light"]');
        if (light) light.checked = true;
        document.querySelector("form.appearance.panel")?.requestSubmit();
    })()`);
    await sleep(700);
    await goto("/");
    await sleep(300);
    const shotLightOk = await ev<boolean>(
        `!!document.querySelector("main.app-main")`,
    );
    await Bun.write(
        "./tmp/nav-theme-light.png",
        Buffer.from(
            (
                (await send("Page.captureScreenshot", {
                    format: "png",
                })) as { data: string }
            ).data,
            "base64",
        ),
    );
    await goto("/settings");
    await sleep(200);
    await ev(`(() => {
        const dark = document.querySelector('input[name="theme"][value="dark"]');
        if (dark) dark.checked = true;
        document.querySelector("form.appearance.panel")?.requestSubmit();
    })()`);
    await sleep(700);
    await goto("/");
    await sleep(300);
    const shotDarkOk = await ev<boolean>(
        `!!document.querySelector("main.app-main")`,
    );
    await Bun.write(
        "./tmp/nav-theme-dark.png",
        Buffer.from(
            (
                (await send("Page.captureScreenshot", {
                    format: "png",
                })) as { data: string }
            ).data,
            "base64",
        ),
    );
    record(
        "theme switch screenshots (nutrition 390x844)",
        shotLightOk && shotDarkOk && (await themeSnap()).dataTheme === "dark",
        { shotLightOk, shotDarkOk, ex: drain() },
    );

    async function scrollBottomShot(
        path: string,
        theme: "light" | "dark",
        file: string,
    ) {
        await control(`theme=${theme}&post=ok`);
        await goto(path);
        await sleep(300);
        const ok = await ev<boolean>(
            `!!document.querySelector("main.app-main")`,
        );
        await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
        await sleep(150);
        await Bun.write(
            file,
            Buffer.from(
                (
                    (await send("Page.captureScreenshot", {
                        format: "png",
                    })) as { data: string }
                ).data,
                "base64",
            ),
        );
        return ok;
    }
    const fridgeDark = await scrollBottomShot(
        "/fridge",
        "dark",
        "./tmp/nav-fridge-dark-bottom.png",
    );
    const fridgeLight = await scrollBottomShot(
        "/fridge",
        "light",
        "./tmp/nav-fridge-light-bottom.png",
    );
    const recipesDark = await scrollBottomShot(
        "/recipes",
        "dark",
        "./tmp/nav-recipes-dark-bottom.png",
    );
    const recipesLight = await scrollBottomShot(
        "/recipes",
        "light",
        "./tmp/nav-recipes-light-bottom.png",
    );
    record(
        "bottom screenshots (fridge and recipes 390x844)",
        fridgeDark && fridgeLight && recipesDark && recipesLight,
        { fridgeDark, fridgeLight, recipesDark, recipesLight, ex: drain() },
    );

    await send("Emulation.setDeviceMetricsOverride", {
        width: 430,
        height: 800,
        deviceScaleFactor: 1,
        mobile: true,
    });

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
