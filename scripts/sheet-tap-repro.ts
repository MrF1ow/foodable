/**
 * Real-engine check that tapping the dimmed page behind a sheet closes it.
 * Drives the assembled /app-v2.css and /app-v2.js (the real files, no fakes)
 * in Playwright WebKit with touch (iOS Safari's engine) and in Chromium with a
 * mouse (phone width, and a 1280px desktop panel; CHROME_BIN overrides
 * /usr/bin/chromium). Not a production route and not part of `bun run test`'s default run;
 * src/web/client/v2/sheet-touch.test.ts wraps it as an opt-in test.
 *
 *   PLAYWRIGHT_CORE=<dir of playwright-core 1.65.x> bun scripts/sheet-tap-repro.ts [webkit|chromium|all]
 *
 * Playwright is not a dependency of this repo. WebKit build webkit-2388 under
 * ~/.cache/ms-playwright is the one playwright-core 1.65.x launches; the bun
 * install cache usually holds it (the default below). On a host whose system
 * libraries differ from the build's (Arch: ICU 74, libxml2.so.2), point
 * WEBKIT_BIN at a wrapper script that execs the build's MiniBrowser with the
 * missing libraries on LD_LIBRARY_PATH.
 */
declare const document: any;
declare const MouseEvent: any;
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
    confirmSheet,
    sheet,
    sheetTrigger,
} from "../src/web/components/v2/sheet.js";
import { getAppV2Css, getAppV2Js } from "../src/widgets.js";

export function findPlaywrightCore(): string | null {
    const env = process.env.PLAYWRIGHT_CORE;
    if (env && existsSync(join(env, "index.js"))) return env;
    const cache = join(homedir(), ".bun/install/cache");
    try {
        const hit = readdirSync(cache)
            .filter((n) => n.startsWith("playwright-core@1.65."))
            .sort()
            .pop();
        if (hit && existsSync(join(cache, hit, "index.js")))
            return join(cache, hit);
    } catch {
        // no cache
    }
    return null;
}

export function webkitInstalled(): boolean {
    const root = join(homedir(), ".cache/ms-playwright");
    try {
        return readdirSync(root).some((n) => n.startsWith("webkit-"));
    } catch {
        return false;
    }
}

const CLEAR_ID = "tap-sheet";
const TALL_ID = "tap-tall";
const CONFIRM_ID = "tap-confirm";

export function fixturePage(): string {
    const filler = Array.from(
        { length: 40 },
        (_, i) => `<p class="row">Row ${i + 1}</p>`,
    ).join("");
    return `<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Sheet tap</title>
<link rel="stylesheet" href="/app-v2.css">
</head><body style="margin:0;padding:24px">
<h1>Today</h1>
${sheetTrigger({ target: CLEAR_ID, label: "Open" })}
${sheetTrigger({ target: TALL_ID, label: "Open tall" })}
${sheet({
    id: CLEAR_ID,
    kind: "edit",
    title: "Chicken rice bowl",
    body: '<p id="inside-body">Inside the sheet</p>',
    actions:
        '<button type="button" class="fd-btn fd-btn--primary">Save</button>',
})}
${sheet({
    id: TALL_ID,
    kind: "edit",
    title: "Tall",
    body: `<div id="tall-scroll">${filler}</div>`,
})}
${confirmSheet({
    id: "tap-confirm",
    title: "Delete?",
    message: "Sure?",
    action: "/x",
    confirmLabel: "Delete",
})}
<script>window.FoodableApp = window.FoodableApp || { onLoad(fn) { fn(document); document.addEventListener("turbo:load", () => fn(document)); } };</script>
<script src="/app-v2.js"></script>
</body></html>`;
}

type Check = { name: string; ok: boolean; detail: string };

type Variant = {
    label: string;
    kind: "webkit" | "chromium";
    width: number;
    height: number;
    touch: boolean;
};

async function run(v: Variant, core: string) {
    const { kind, touch } = v;
    const pw = await import(join(core, "index.js"));
    const css = await getAppV2Css();
    const js = await getAppV2Js();
    const server = Bun.serve({
        port: Number(process.env.REPRO_PORT ?? 0),
        fetch(req) {
            const p = new URL(req.url).pathname;
            const h = (t: string) => ({ headers: { "content-type": t } });
            if (p === "/app-v2.css") return new Response(css, h("text/css"));
            if (p === "/app-v2.js")
                return new Response(js, h("text/javascript"));
            if (/^\/fonts\//.test(p)) {
                const f = Bun.file(`./public${p}`);
                return new Response(f);
            }
            return new Response(fixturePage(), h("text/html; charset=utf-8"));
        },
    });
    const url = `http://127.0.0.1:${server.port}/`;
    const browserType = kind === "webkit" ? pw.webkit : pw.chromium;
    const browser = await browserType.launch(
        kind === "chromium"
            ? {
                  executablePath: process.env.CHROME_BIN ?? "/usr/bin/chromium",
                  args: ["--no-sandbox"],
              }
            : process.env.WEBKIT_BIN
              ? { executablePath: process.env.WEBKIT_BIN }
              : {},
    );
    const ctx = await browser.newContext({
        viewport: { width: v.width, height: v.height },
        hasTouch: touch,
        isMobile: touch,
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
    });
    const page = await ctx.newPage();
    // The callbacks run in the browser, which this file's types do not know.
    const ev = (fn: (arg: any) => any, arg?: any): Promise<any> =>
        page.evaluate(fn, arg);
    const results: Check[] = [];
    // tap/click at a viewport point with the kind's pointer device
    const tap = async (x: number, y: number) => {
        if (touch) await page.touchscreen.tap(x, y);
        else await page.mouse.click(x, y);
    };
    const open = async (id: string) => {
        await page.goto(url);
        await page.waitForFunction(() => document.readyState === "complete");
        await page
            .click(`button[commandfor="${id}"]`, { force: true })
            .catch(() => undefined);
        if (!(await ev((i) => document.getElementById(i)!.open, id)))
            await ev((i) => document.getElementById(i)!.showModal(), id);
        await page.waitForTimeout(150);
    };
    const isOpen = (id: string) =>
        ev((i) => document.getElementById(i)!.open, id);
    const box = (id: string) =>
        ev((i) => {
            const r = document.getElementById(i)!.getBoundingClientRect();
            return {
                top: r.top,
                bottom: r.bottom,
                left: r.left,
                right: r.right,
            };
        }, id);

    // A point on the dimmed page next to a box: above it (a bottom sheet) or
    // to its left or right (the desktop panel).
    const W = v.width;
    const H = v.height;
    type Box = { top: number; bottom: number; left: number; right: number };
    const backdropPoint = (r: Box): [number, number] => {
        if (r.top >= 40) return [W / 2, r.top / 2];
        if (r.left >= 40) return [r.left / 2, H / 2];
        return [(r.right + W) / 2, H / 2];
    };
    const center = (r: Box): [number, number] => [
        (r.left + r.right) / 2,
        (r.top + r.bottom) / 2,
    ];
    // dispatch a synthetic click on the page (document.body), the way iOS may
    // deliver a backdrop tap to the page behind the dialog
    const bodyClick = (x: number, y: number, detail: number) =>
        ev(
            ([cx, cy, d]) => {
                document.body.dispatchEvent(
                    new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        clientX: cx,
                        clientY: cy,
                        detail: d,
                    }),
                );
            },
            [x, y, detail],
        );
    // clicks that reached the page (a bubble-phase listener on body)
    const watchPage = () =>
        ev(() => {
            (window as any).__pageClicks = 0;
            document.body.addEventListener("click", () => {
                (window as any).__pageClicks++;
            });
        });
    const pageClicks = (): Promise<number> =>
        ev(() => (window as any).__pageClicks);

    // 1. tap the dimmed page next to the sheet closes it (the edit sheet and
    //    the confirm dialog)
    for (const id of [CLEAR_ID, CONFIRM_ID]) {
        await open(id);
        const bb = await box(id);
        await tap(...backdropPoint(bb));
        await page.waitForTimeout(250);
        results.push({
            name: `tap on backdrop closes (${id})`,
            ok: !(await isOpen(id)),
            detail: `box top=${Math.round(bb.top)} left=${Math.round(bb.left)}`,
        });
    }

    // 2. tap inside the sheet (body text, padding, panel gutter) keeps it open
    await open(CLEAR_ID);
    let b = await box(CLEAR_ID);
    const bodyY = await ev(
        () =>
            document.getElementById("inside-body")!.getBoundingClientRect()
                .top + 5,
    );
    for (const [label, x, y] of [
        ["body", b.left + 100, bodyY],
        ["gutter", b.left + 3, b.top + 60],
        ["panel bottom padding", center(b)[0], b.bottom - 10],
    ] as const) {
        await tap(x, y);
        await page.waitForTimeout(150);
        results.push({
            name: `tap inside (${label}) keeps open`,
            ok: await isOpen(CLEAR_ID),
            detail: `at ${Math.round(x)},${Math.round(y)}`,
        });
        if (!(await isOpen(CLEAR_ID))) await open(CLEAR_ID);
    }

    // 3. a gesture that starts inside and ends on the backdrop does not close
    await open(CLEAR_ID);
    b = await box(CLEAR_ID);
    const [ex, ey] = backdropPoint(b);
    const [sx, sy] = [b.left + 100, b.top + 80];
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(ex, ey, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    results.push({
        name: "press inside, release on backdrop keeps open",
        ok: await isOpen(CLEAR_ID),
        detail: `from ${Math.round(sx)},${Math.round(sy)} to the backdrop`,
    });

    // 4. scrolled tall sheet: tap inside after scrolling keeps it open
    await open(TALL_ID);
    await ev(() => {
        document.getElementById("tall-scroll")!.parentElement!.scrollTop = 300;
    });
    b = await box(TALL_ID);
    await tap(...center(b));
    await page.waitForTimeout(150);
    results.push({
        name: "tap inside scrolled body keeps open",
        ok: await isOpen(TALL_ID),
        detail: "",
    });

    // 5. iOS Safari does not reliably send the dialog a pointerdown for a
    //    backdrop tap, and may deliver the tap to the page behind it. A click
    //    with no pointerdown before it must still close, and the page must get
    //    no click; a click inside the dialog's own box (padding), or one with
    //    no pointer position (detail 0), must not close.
    await open(CLEAR_ID);
    b = await box(CLEAR_ID);
    const dialogClick = (x: number, y: number, detail: number) =>
        ev(
            ([id, cx, cy, d]) =>
                document.getElementById(id as string)!.dispatchEvent(
                    new MouseEvent("click", {
                        bubbles: true,
                        clientX: cx as number,
                        clientY: cy as number,
                        detail: d as number,
                    }),
                ),
            [CLEAR_ID, x, y, detail],
        );
    await dialogClick(b.left + 3, b.top + 60, 1);
    results.push({
        name: "click on the sheet's own padding, no pointerdown, keeps open",
        ok: await isOpen(CLEAR_ID),
        detail: "",
    });
    const [bx, by] = backdropPoint(b);
    await dialogClick(bx, by, 0);
    results.push({
        name: "click on the backdrop with no pointer (detail 0) keeps open",
        ok: await isOpen(CLEAR_ID),
        detail: "",
    });
    await dialogClick(bx, by, 1);
    await page.waitForTimeout(150);
    results.push({
        name: "click on backdrop with no pointerdown closes",
        ok: !(await isOpen(CLEAR_ID)),
        detail: "",
    });

    // 5b. the same tap delivered to the page behind (target = body)
    await open(CLEAR_ID);
    b = await box(CLEAR_ID);
    await watchPage();
    const [px, py] = backdropPoint(b);
    await bodyClick(px, py, 1);
    await page.waitForTimeout(150);
    results.push({
        name: "click delivered to the page behind closes, page gets no click",
        ok: !(await isOpen(CLEAR_ID)) && (await pageClicks()) === 0,
        detail: `page clicks=${await pageClicks()}`,
    });

    // 6. An engine that never turns the backdrop tap into a click: only the
    //    touch events arrive, on the dialog or on the page behind it. A still
    //    tap behind the sheet closes it.
    for (const onBody of [false, true]) {
        await open(CLEAR_ID);
        b = await box(CLEAR_ID);
        const [tx, ty] = backdropPoint(b);
        await ev(
            ([id, x, y, body]) => {
                const el = body
                    ? document.body
                    : document.getElementById(id as string)!;
                const t = (type: string, list: boolean) => {
                    const e = new Event(type, {
                        bubbles: true,
                        cancelable: true,
                    });
                    const pt = { clientX: x, clientY: y };
                    Object.assign(e, {
                        touches: list ? [pt] : [],
                        changedTouches: [pt],
                    });
                    el.dispatchEvent(e);
                };
                t("touchstart", true);
                t("touchend", false);
            },
            [CLEAR_ID, tx, ty, onBody],
        );
        await page.waitForTimeout(150);
        results.push({
            name: `touch tap on ${onBody ? "the page behind" : "the backdrop"} with no click closes`,
            ok: !(await isOpen(CLEAR_ID)),
            detail: "",
        });
    }

    await browser.close();
    server.stop(true);
    return results;
}

const VARIANTS: Variant[] = [
    {
        label: "webkit phone (touch)",
        kind: "webkit",
        width: 390,
        height: 844,
        touch: true,
    },
    {
        label: "chromium phone (mouse)",
        kind: "chromium",
        width: 390,
        height: 844,
        touch: false,
    },
    {
        label: "chromium desktop panel (mouse)",
        kind: "chromium",
        width: 1280,
        height: 800,
        touch: false,
    },
];

if (import.meta.main) {
    const which = process.argv[2] ?? "all";
    const core = findPlaywrightCore();
    if (!core) {
        console.error("playwright-core 1.65.x not found: set PLAYWRIGHT_CORE");
        process.exit(2);
    }
    const chosen = VARIANTS.filter((v) => which === "all" || v.kind === which);
    let failed = 0;
    for (const v of chosen) {
        console.log(`== ${v.label} ==`);
        for (const r of await run(v, core)) {
            console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}`);
            if (!r.ok) failed++;
        }
    }
    process.exit(failed ? 1 : 0);
}
