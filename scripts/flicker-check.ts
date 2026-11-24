/**
 * Flicker check: drives the household app's navigations at phone width (390)
 * in both themes through a remote Chromium (browserless over CDP) and fails on
 * a document reload, a blank frame, or a flash that withholding the entrance
 * fade removes. Not part of `bun run test`; run it by hand against an isolated
 * stack (see the foodable-test skill) that is reachable from the browserless
 * host, so it loads the stack by this machine's Tailscale IPv4.
 *
 *   bun scripts/flicker-check.ts --base http://<tailscale-ip>:<port> [--out report.md]
 *
 * Options (flags, or the matching env var):
 *   --base <url>      the stack (FLICKER_BASE). Default: http://<tailscale ip -4>:$APP_PORT
 *   --browser <host>  ironhide (default) or sideswipe: the browserless host (FLICKER_BROWSER)
 *   --reps <n>        runs of every navigation and variant (FLICKER_REPS, default 2)
 *   --only <text>     only navigations whose name contains the text
 *   --out <file>      write the report there as well as to stdout (+ .json beside it)
 *   --db <url>        the stack's Postgres (FLICKER_DB): seeds a small household
 *                     (fridge, groceries, two recipes, meals) once, so the main
 *                     tabs have content to render. Without it the stack is
 *                     used as it is (empty tabs).
 *   --baseline        the commit under test predates a page some navigation
 *                     needs: such a navigation is "not present" (n/a), not a
 *                     failure. Without it a navigation whose control is missing fails.
 *
 * It reads the browserless token from ~/.config/browserless/token and loads
 * playwright-core from the bun install cache; it never installs a browser and
 * never launches one locally. No machine has a WebKit build, so Safari's
 * toolbar tint is not seen here: the user's iPhone check covers it.
 *
 * Every navigation and the first full load run three ways:
 *   motion      everything on
 *   no-fade     motion on, only the entrance fade withheld (an injected
 *               `html.fx .app-main > * { animation: none !important }`)
 *   reduced     `prefers-reduced-motion: reduce` emulated (every animation and
 *               transition off)
 * A flash seen with motion on is blamed on the fade when `no-fade` is clean,
 * on another animation when only `reduced` is clean (recorded, not failing),
 * and is a real blank frame or flip when `reduced` shows it too (failing).
 *
 * What a frame is: a requestAnimationFrame tick sampled inside the page, so it
 * sees every frame the main thread produced. Per frame it records the page's
 * main content opacity (the entrance fade is `html.fx .app-main > *`), whether
 * `.app-main` has content, the document, the body generation (Turbo swaps the
 * body), the theme attribute and the page background. The samples survive a
 * full load through sessionStorage.
 */
declare const document: any;
declare const window: any;
declare const sessionStorage: any;
declare const performance: any;
declare const getComputedStyle: any;
declare const location: any;
declare const requestAnimationFrame: any;
declare const PerformanceObserver: any;
declare const WeakMap: any;
declare const DOMParser: any;
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Scheme = "light" | "dark";
type VariantId = "motion" | "no-fade" | "reduced";
const VARIANTS: readonly VariantId[] = ["motion", "no-fade", "reduced"];
const SCHEMES: readonly Scheme[] = ["light", "dark"];

const NO_FADE_CSS = "html.fx .app-main > * { animation: none !important }";

/** A recipe the seed creates under a fixed id, so a navigation can start on its page. */
const SEED_RECIPE = "00000000-0000-4000-8000-0000000000a1";

/** A small household for the main tabs: two locations, a store, eight foods in
 *  the fridge, three grocery lines, two recipes, a week of meals and forty future days with their own
 *  calorie goal (the Goals navigation clears one per run). */
const SEED_SQL = `
do $$
declare hh uuid; usr uuid; loc_f uuid; loc_p uuid; st uuid; sec uuid; r uuid;
begin
  select household_id, user_id into hh, usr from household_members limit 1;
  insert into fridge_locations (household_id, name) values (hh, 'Fridge') returning id into loc_f;
  insert into fridge_locations (household_id, name) values (hh, 'Pantry') returning id into loc_p;
  insert into grocery_stores (household_id, name) values (hh, 'Corner Shop') returning id into st;
  insert into grocery_sections (household_id, store_id, name, sort_order, is_other) values (hh, st, 'Other', 99, true) returning id into sec;
  insert into foods (household_id, kind, name, normalized_name)
    select hh, 'food', n, lower(n) from unnest(array['Eggs','Milk','Butter','Spinach','Rice','Chicken thighs','Tomatoes','Cheddar']) n;
  insert into fridge_items (household_id, location_id, kind, display_name, amount, unit, food_id)
    select hh, case when f.name = 'Rice' then loc_p else loc_f end, 'food', f.name, v.amt, v.unit, f.id
    from foods f join (values ('Eggs',12,'each'),('Milk',1,'l'),('Butter',250,'g'),('Spinach',200,'g'),('Rice',900,'g'),('Chicken thighs',600,'g'),('Tomatoes',4,'each'),('Cheddar',200,'g')) v(name,amt,unit) on v.name = f.name
    where f.household_id = hh;
  insert into grocery_lines (household_id, store_id, section_id, kind, display_name, amount, unit, food_id)
    select hh, st, sec, 'food', f.name, v.amt, v.unit, f.id
    from foods f join (values ('Eggs',6,'each'),('Spinach',300,'g'),('Cheddar',100,'g')) v(name,amt,unit) on v.name = f.name
    where f.household_id = hh;
  insert into recipes (id, household_id, creator_id, name, yield_portions, instructions, prep_minutes, cook_minutes)
    values ('${SEED_RECIPE}', hh, usr, 'Spinach omelette', 2, E'Whisk the eggs.\\nWilt the spinach in butter.\\nFold in the cheddar.', 5, 10) returning id into r;
  insert into recipe_ingredients (household_id, recipe_id, kind, display_name, amount, unit, sort_order, food_id)
    select hh, r, 'food', f.name, v.amt, v.unit, v.ord, f.id
    from foods f join (values ('Eggs',4,'each',0),('Spinach',100,'g',1),('Butter',10,'g',2),('Cheddar',40,'g',3)) v(name,amt,unit,ord) on v.name = f.name
    where f.household_id = hh;
  insert into recipes (household_id, creator_id, name, yield_portions, instructions, prep_minutes, cook_minutes)
    values (hh, usr, 'Tomato rice', 4, E'Fry the tomatoes.\\nAdd the rice and water.\\nSimmer.', 10, 25) returning id into r;
  insert into recipe_ingredients (household_id, recipe_id, kind, display_name, amount, unit, sort_order, food_id)
    select hh, r, 'food', f.name, v.amt, v.unit, v.ord, f.id
    from foods f join (values ('Rice',300,'g',0),('Tomatoes',3,'each',1),('Butter',20,'g',2)) v(name,amt,unit,ord) on v.name = f.name
    where f.household_id = hh;
  insert into meals (logged_at, meal_type, description, calories, protein_g, carbs_g, fat_g, user_id) values
    (now() - interval '1 hour', 'breakfast', 'Spinach omelette', 420, 28, 6, 30, usr),
    (now() - interval '1 day', 'lunch', 'Tomato rice', 610, 14, 98, 15, usr),
    (now() - interval '1 day 4 hours', 'dinner', 'Chicken and rice', 720, 48, 70, 22, usr),
    (now() - interval '2 days', 'dinner', 'Chicken and rice', 700, 46, 68, 21, usr),
    (now() - interval '3 days', 'breakfast', 'Omelette', 400, 26, 5, 28, usr),
    (now() - interval '5 days', 'lunch', 'Tomato rice', 600, 13, 96, 14, usr);
  insert into nutrition_goal_days (household_id, user_id, date, daily_calories)
    select hh, usr, current_date + d, 1800 + d from generate_series(1, 40) d;
end $$;
`;

/** Seed the stack's database once (the seed recipe's id says it is there). */
async function seedStack(url: string): Promise<boolean> {
    // Seed only a local stack's database, never a remote one.
    const host = new URL(url).hostname;
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host))
        throw new Error(`--db must be a local stack's Postgres, not ${host}`);
    const sql = new Bun.SQL(url);
    try {
        const [row] =
            await sql`select count(*)::int as n from recipes where id = ${SEED_RECIPE}`;
        if (row.n > 0) return false;
        await sql.unsafe(SEED_SQL);
        return true;
    } finally {
        await sql.close();
    }
}

// ---------------------------------------------------------------- arguments

function arg(name: string, env: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    if (i >= 0) return process.argv[i + 1];
    return process.env[env];
}

function tailscaleIp(): string {
    const r = Bun.spawnSync(["tailscale", "ip", "-4"]);
    const ip = r.stdout.toString().trim().split("\n")[0];
    if (!ip) throw new Error("tailscale ip -4 printed nothing");
    return ip;
}

function findPlaywrightCore(): string {
    const env = process.env.PLAYWRIGHT_CORE;
    if (env && existsSync(join(env, "index.js"))) return env;
    const cache = join(homedir(), ".bun/install/cache");
    const hit = readdirSync(cache)
        .filter((n) => /^playwright-core@1\.\d+\.\d+(@@@1)?$/.test(n))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .pop();
    if (!hit || !existsSync(join(cache, hit, "index.js"))) {
        throw new Error(
            "playwright-core is not in the bun install cache (set PLAYWRIGHT_CORE)",
        );
    }
    return join(cache, hit);
}

// ------------------------------------------------------- the in-page sampler

/** Installed before any page script on every document. Kept self-contained: it
 *  is serialised into the page. */
function installSampler(): void {
    if (window.__fc) return;
    const KEY = "__fc";
    let prev: { frames: unknown[]; marks: unknown[] } = {
        frames: [],
        marks: [],
    };
    try {
        const raw = sessionStorage.getItem(KEY);
        if (raw) prev = JSON.parse(raw);
        sessionStorage.removeItem(KEY);
    } catch {
        // storage blocked: samples from the previous document are lost
    }
    const docId = `${Math.round(performance.timeOrigin)}`;
    const fc: any = (window.__fc = {
        frames: prev.frames,
        marks: prev.marks,
        docId,
        paints: [] as unknown[],
        shifts: [] as unknown[],
    });
    const bodies = new WeakMap();
    let bodyGen = 0;
    const effective = (el: any) => {
        // opacity of an element and its ancestors up to <html>
        let o = 1;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            o *= parseFloat(getComputedStyle(n).opacity);
        }
        return o;
    };
    const tick = () => {
        const html = document.documentElement;
        const body = document.body;
        let gen = -1;
        if (body) {
            if (!bodies.has(body)) bodies.set(body, ++bodyGen);
            gen = bodies.get(body);
        }
        const main = body ? body.querySelector(".app-main") : null;
        let kids = 0;
        let opMax = 0;
        let opMin = 1;
        if (main) {
            for (const child of Array.from(main.children) as any[]) {
                const cs = getComputedStyle(child);
                if (cs.display === "none" || cs.visibility === "hidden")
                    continue;
                if (child.classList.contains("fd-cluster")) continue;
                kids++;
                const o = effective(child);
                if (o > opMax) opMax = o;
                if (o < opMin) opMin = o;
            }
        }
        fc.frames.push({
            t: performance.timeOrigin + performance.now(),
            doc: docId,
            gen,
            ready: document.readyState,
            main: !!main,
            kids,
            opMax: Math.round(opMax * 100) / 100,
            opMin: Math.round(opMin * 100) / 100,
            fx: html.classList.contains("fx"),
            theme: html.getAttribute("data-theme") || "",
            bg: body ? getComputedStyle(body).backgroundColor : "",
            path: location.pathname,
        });
        if (fc.frames.length > 1500) fc.frames.splice(0, 300);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
        new PerformanceObserver((list: any) => {
            for (const e of list.getEntries())
                fc.paints.push({
                    name: e.name,
                    t: performance.timeOrigin + e.startTime,
                });
        }).observe({ type: "paint", buffered: true });
    } catch {
        // paint timing unsupported
    }
    const flush = () => {
        try {
            sessionStorage.setItem(
                KEY,
                JSON.stringify({ frames: fc.frames, marks: fc.marks }),
            );
        } catch {
            // storage blocked
        }
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    });
    fc.mark = (label: string) =>
        fc.marks.push({
            label,
            t: performance.timeOrigin + performance.now(),
        });
    fc.read = () => ({
        frames: fc.frames,
        marks: fc.marks,
        paints: fc.paints,
        docId,
    });
}

// ------------------------------------------------------------------ analysis

type Frame = {
    t: number;
    doc: string;
    gen: number;
    ready: string;
    main: boolean;
    kids: number;
    opMax: number;
    opMin: number;
    fx: boolean;
    theme: string;
    bg: string;
    path: string;
};

type Trace = {
    frames: Frame[];
    marks: { label: string; t: number }[];
    paints: { name: string; t: number }[];
};

type Finding = { kind: string; detail: string };

type RunResult = {
    nav: string;
    variant: VariantId;
    scheme: Scheme;
    rep: number;
    docs: number;
    bodies: number;
    frames: number;
    /** A frame whose main content was absent, invisible (opacity < 0.05) or,
     *  on a Turbo visit, not yet at full strength, after the new body had
     *  rendered; the first full load may fade in from blank once. */
    blank: Finding[];
    /** Content shown (opacity >= 0.95) and then dimmed again in the same body. */
    doublePaint: Finding[];
    /** The page background or theme attribute changed more than once, or back. */
    flips: Finding[];
    reload: boolean;
    fadeFrames: number;
    minOp: number;
    error?: string;
    checks: string[];
    checkFailures: string[];
};

const VISIBLE = 0.95;
const BLANK = 0.05;

/** Compress consecutive duplicates. */
function runs<T>(xs: T[]): T[] {
    const out: T[] = [];
    for (const x of xs)
        if (out.length === 0 || out[out.length - 1] !== x) out.push(x);
    return out;
}

/** `firstLoad`: the first full load of a window (it may fade in from blank
 *  once). A window that never leaves the start body is a morph refresh (the
 *  theme change, a form post back to its own page): the start body's frames
 *  after the mark are analysed, and one background and theme change is allowed. */
export function analyse(
    trace: Trace,
    startLabel: string,
    opts: { firstLoad: boolean },
): Omit<
    RunResult,
    "nav" | "variant" | "scheme" | "rep" | "error" | "checks" | "checkFailures"
> {
    const start = trace.marks.filter((m) => m.label === startLabel).pop();
    const t0 = start?.t ?? 0;
    // /health is the blank page a first-load window starts from.
    const all = trace.frames.filter((f) => f.path !== "/health");
    const before = all.filter((f) => f.t < t0).pop();
    const startKey = before ? `${before.doc}:${before.gen}` : null;
    const frames = all.filter((f) => f.t >= t0);
    const docs = [...new Set(frames.map((f) => f.doc))];
    const reload =
        !opts.firstLoad && before != null && docs.some((d) => d !== before.doc);
    const blank: Finding[] = [];
    const doublePaint: Finding[] = [];
    const flips: Finding[] = [];
    let fadeFrames = 0;
    let minOp = 1;
    const bodyKeys = [...new Set(frames.map((f) => `${f.doc}:${f.gen}`))];
    // The page the window started on is not part of it; every body after it is.
    const refresh =
        !opts.firstLoad && bodyKeys.length === 1 && bodyKeys[0] === startKey;
    const rendered = bodyKeys.filter(
        (k) =>
            !k.endsWith(":-1") && (opts.firstLoad || refresh || k !== startKey),
    );
    for (const key of rendered) {
        const fs = frames.filter((f) => `${f.doc}:${f.gen}` === key);
        // A first full load may fade in from blank once, with html.fx set
        // before first paint; a Turbo visit may not.
        const firstOfLoad = opts.firstLoad && key === rendered[0];
        let shown = false;
        for (const f of fs) {
            const invisible = !f.main || f.kids === 0 || f.opMax < BLANK;
            // Still parsing: not a rendered page yet.
            if (f.ready === "loading" && invisible) continue;
            // How strongly the page shows: its most visible child on a first
            // load (the fade may stagger), but its least visible one on a Turbo
            // visit or refresh, where every child must be at full strength.
            const level = opts.firstLoad ? f.opMax : Math.min(f.opMax, f.opMin);
            minOp = Math.min(minOp, level);
            if (f.opMin < VISIBLE) fadeFrames++;
            if (level >= VISIBLE) {
                shown = true;
                continue;
            }
            // A Turbo visit's new page must be there at full strength from its
            // first frame: a fade in (opacity under 0.95) is a flash, whether
            // it starts from nothing or from partway.
            if (!opts.firstLoad && f.main && f.kids > 0) {
                blank.push({
                    kind: "blank frame",
                    detail: `${f.path}: main content dimmed to opacity ${level} on a Turbo render (fx ${f.fx})`,
                });
                break;
            }
            if (shown) {
                doublePaint.push({
                    kind: "double paint",
                    detail: `${f.path}: content shown, then opacity ${f.opMax} (fx ${f.fx})`,
                });
                break;
            }
            if (invisible && !(firstOfLoad && f.main && f.fx)) {
                blank.push({
                    kind: "blank frame",
                    detail: `${f.path}: ${!f.main ? "no .app-main" : f.kids === 0 ? "empty .app-main" : `main opacity ${f.opMax}`} (fx ${f.fx})`,
                });
                break;
            }
        }
    }
    // The page background and the theme attribute must settle at once: a
    // first colour that is not the last is a flash of the wrong theme.
    const inBodies = frames.filter(
        (f) => rendered.includes(`${f.doc}:${f.gen}`) && f.ready !== "loading",
    );
    // A theme change on the same body is one change, so two values in a row.
    const allowed = refresh ? 2 : 1;
    const bgs = runs(inBodies.filter((f) => f.bg).map((f) => f.bg));
    const themes = runs(inBodies.map((f) => f.theme));
    if (bgs.length > allowed)
        flips.push({
            kind: "background flip",
            detail: `${bgs.length} colours in a row: ${bgs.join(" -> ")}`,
        });
    if (themes.length > allowed)
        flips.push({
            kind: "theme attribute flip",
            detail: `${themes.length} values in a row: ${themes.map((t) => t || "(none)").join(" -> ")}`,
        });
    return {
        docs: docs.length,
        bodies: rendered.length,
        frames: frames.length,
        blank,
        doublePaint,
        flips,
        reload,
        fadeFrames,
        minOp,
    };
}

// -------------------------------------------------------------- the browser

export type Nav = {
    name: string;
    /** The page the run starts on (a full load, outside the window). */
    start: string;
    /** What to click; an array is tried in order. */
    click: string[];
    /** The path the click lands on; the start path itself for a form post that
     *  comes back to its own page (a morph refresh of the same body). */
    lands?: string;
    themeChange?: boolean;
    /** Not present on a baseline commit (`--baseline`): n/a there, a failure
     *  on the head under test. */
    optional?: boolean;
    /** Steps on the start page before the window opens (open a sheet, type). */
    prepare?: (page: any) => Promise<void>;
};

/** A navigation whose control is missing is skipped (n/a) only on a baseline
 *  commit that predates its page; on the head under test it fails. */
export function skipsMissingNav(nav: Nav, baseline: boolean): boolean {
    return !!nav.optional && baseline;
}

/** A navigation that keeps its document and body: a morph refresh. */
function keepsBody(nav: Nav): boolean {
    return !!nav.themeChange || nav.lands === nav.start;
}

const FIRST_LOADS = [
    "/",
    "/kitchen/fridge",
    "/recipes",
    "/trends",
    "/settings",
] as const;

const TAB = (label: string) => `nav.fd-tabs a.fd-tab[aria-label="${label}"]`;

const NAVS: readonly Nav[] = [
    {
        name: "into Settings: Today -> account chip",
        start: "/",
        click: ["a.fd-account-chip"],
        lands: "/settings",
    },
    {
        name: "main tabs: Today -> Kitchen",
        start: "/",
        click: [TAB("Kitchen")],
        lands: "/kitchen/fridge",
    },
    {
        name: "main tabs: Kitchen -> Recipes",
        start: "/kitchen/fridge",
        click: [TAB("Recipes")],
        lands: "/recipes",
    },
    {
        name: "main tabs: Recipes -> Trends",
        start: "/recipes",
        click: [TAB("Trends")],
        lands: "/trends",
    },
    {
        name: "main tabs: Trends -> Today",
        start: "/trends",
        click: [TAB("Today")],
        lands: "/",
    },
    {
        name: "Kitchen tabs: Fridge -> Groceries",
        start: "/kitchen/fridge",
        click: ['a.fd-kitchen-tab[href="/kitchen/groceries"]'],
        lands: "/kitchen/groceries",
    },
    {
        name: "Kitchen tabs: Groceries -> Usuals",
        start: "/kitchen/groceries",
        click: ['a.fd-kitchen-tab[href="/kitchen/usuals"]'],
        lands: "/kitchen/usuals",
    },
    {
        name: "Kitchen tabs: Usuals -> Fridge",
        start: "/kitchen/usuals",
        click: ['a.fd-kitchen-tab[href="/kitchen/fridge"]'],
        lands: "/kitchen/fridge",
    },
    {
        name: "recipes: open a recipe",
        start: "/recipes",
        click: [`a.fd-recipes-card[href="/recipes/${SEED_RECIPE}"]`],
        lands: `/recipes/${SEED_RECIPE}`,
    },
    {
        name: "recipes: recipe -> back to Recipes",
        start: `/recipes/${SEED_RECIPE}`,
        click: ["a.fd-recipe-back__btn", "a.fd-recipe-back__link"],
        lands: "/recipes",
    },
    {
        name: "inside Settings: home -> Account",
        start: "/settings",
        click: ['main a[href="/settings/account"]'],
        lands: "/settings/account",
    },
    {
        name: "inside Settings: Account -> back",
        start: "/settings/account",
        click: ['a[aria-label="Back"]', "a.fd-settings-back"],
        lands: "/settings",
    },
    {
        name: "inside Settings: Account -> Time zone",
        start: "/settings/account",
        click: ['main a[href="/settings/account/timezone"]'],
        lands: "/settings/account/timezone",
        optional: true,
    },
    {
        name: "inside Settings: save a time zone -> Account",
        start: "/settings/account/timezone",
        click: ["label.fd-item-row__face--choice:has(input:not(:checked))"],
        lands: "/settings/account",
        optional: true,
    },
    {
        name: "inside Settings: save the Name sheet",
        start: "/settings/account",
        click: ['dialog[open] button[form="fd-account-name-form"]'],
        lands: "/settings/account",
        prepare: async (page) => {
            await page
                .locator('button[commandfor="fd-account-name"]')
                .first()
                .click();
            const input = page.locator("dialog[open] #display_name");
            await input.waitFor({ state: "visible", timeout: 5000 });
            await input.fill(`Owner ${Date.now() % 1000}`);
        },
    },
    {
        name: "inside Settings: home -> Household",
        start: "/settings",
        click: ['main a[href="/settings/household"]'],
        lands: "/settings/household",
    },
    {
        name: "inside Settings: Goals autosave a number",
        start: "/settings/goals",
        click: ["#goals-daily-protein-g"],
        lands: "/settings/goals",
        prepare: async (page) => {
            const input = page.locator("#goals-daily-calories");
            await input.waitFor({ state: "visible", timeout: 5000 });
            await input.fill(String(2000 + (Date.now() % 400)));
        },
    },
    {
        // Needs per-day goal overrides from today on (one per run is cleared).
        name: "inside Settings: Goals clear a day",
        start: "/settings/goals",
        click: [".fd-menu__confirm-row button[type=submit]"],
        lands: "/settings/goals",
        prepare: async (page) => {
            const list = page.locator(
                'ul[aria-label="Days with their own goals"]',
            );
            await list
                .locator("[data-fd-menu-trigger]")
                .first()
                .click({ timeout: 5000 });
            await list
                .locator("[data-fd-menu-arm]")
                .first()
                .click({ timeout: 5000 });
        },
    },
    {
        name: "inside Settings: home -> Notifications",
        start: "/settings",
        click: ['main a[href="/settings/notifications"]'],
        lands: "/settings/notifications",
    },
    {
        name: "out of Settings: back arrow -> Today",
        start: "/settings",
        click: ['a[aria-label="Back"]'],
        lands: "/",
    },
    {
        name: "out of Settings: Nav bar -> Kitchen",
        start: "/settings",
        click: ['nav.fd-tabs a.fd-tab[aria-label="Kitchen"]'],
        lands: "/kitchen/fridge",
    },
    {
        name: "out of Settings: Nav bar -> Recipes",
        start: "/settings/account",
        click: ['nav.fd-tabs a.fd-tab[aria-label="Recipes"]'],
        lands: "/recipes",
    },
    {
        name: "theme change: Settings -> other theme",
        start: "/settings",
        click: [],
        themeChange: true,
    },
];

class Run {
    browser: any = null;

    constructor(
        readonly pw: any,
        readonly ws: string,
        readonly base: string,
        readonly cookie: string,
        readonly baseline: boolean,
    ) {}

    /** A fresh browserless session per run: a long-lived one is closed by the
     *  host after a while, and a closed one fails every later run. */
    async connect() {
        await this.browser?.close().catch(() => {});
        this.browser = await this.pw.chromium.connectOverCDP(this.ws);
    }

    async context(scheme: Scheme, variant: VariantId) {
        await this.connect();
        const ctx = await this.browser.newContext({
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
            colorScheme: scheme,
            reducedMotion: variant === "reduced" ? "reduce" : "no-preference",
        });
        await ctx.addCookies([
            {
                name: "nm_site",
                value: this.cookie,
                url: this.base,
            },
        ]);
        await ctx.addInitScript(installSampler);
        if (variant === "no-fade") {
            // The rule rides on the page's own stylesheet, so it is in place
            // before the first frame of every document and every Turbo visit.
            await ctx.route(/\/app\.css(\?|$)/, async (route: any) => {
                const res = await route.fetch();
                const css = await res.text();
                await route.fulfill({
                    response: res,
                    body: `${css}\n/* flicker-check */\n${NO_FADE_CSS}\n`,
                });
            });
        }
        return ctx;
    }

    /** The viewer's stored theme is server state: put it back to Auto. */
    async resetTheme() {
        await fetch(`${this.base}/settings/display`, {
            method: "POST",
            redirect: "manual",
            headers: {
                cookie: `nm_site=${this.cookie}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "theme=system",
        });
    }
}

async function settle(page: any, ms = 1300) {
    await page.waitForTimeout(ms);
}

async function readTrace(page: any): Promise<Trace> {
    return await page.evaluate(() => window.__fc.read());
}

async function waitTurbo(page: any) {
    await page.waitForFunction(() => window.Turbo && window.__fc, null, {
        timeout: 15000,
    });
}

async function firstVisible(page: any, selectors: string[]) {
    for (const sel of selectors) {
        const loc = page.locator(`${sel} >> visible=true`).first();
        if ((await loc.count()) > 0) return loc;
    }
    return null;
}

/** Theme chrome of the live document, compared with what a fresh load of the
 *  same URL carries (a Turbo visit must leave the same data-theme and
 *  theme-color metas a full load would). */
async function themeChrome(page: any) {
    return await page.evaluate(async () => {
        const read = (root: any) => ({
            theme:
                root
                    .querySelector('meta[name="foodable-theme"]')
                    ?.getAttribute("content") ?? null,
            colors: [...root.querySelectorAll('meta[name="theme-color"]')].map(
                (m: any) =>
                    `${m.getAttribute("media") ?? ""}|${m.getAttribute("content")}`,
            ),
        });
        const live = {
            ...read(document),
            dataTheme: document.documentElement.getAttribute("data-theme"),
        };
        const res = await fetch(location.href, { credentials: "same-origin" });
        const doc = new DOMParser().parseFromString(
            await res.text(),
            "text/html",
        );
        const fresh = {
            ...read(doc),
            dataTheme: doc.documentElement.getAttribute("data-theme"),
        };
        return { live, fresh };
    });
}

async function runNav(
    run: Run,
    nav: Nav,
    variant: VariantId,
    scheme: Scheme,
    rep: number,
): Promise<RunResult | null> {
    const base: RunResult = {
        nav: nav.name,
        variant,
        scheme,
        rep,
        docs: 0,
        bodies: 0,
        frames: 0,
        blank: [],
        doublePaint: [],
        flips: [],
        reload: false,
        fadeFrames: 0,
        minOp: 1,
        checks: [],
        checkFailures: [],
    };
    await run.resetTheme();
    let ctx: any = null;
    try {
        ctx = await run.context(scheme, variant);
        const page = await ctx.newPage();
        await page.goto(run.base + nav.start, { waitUntil: "load" });
        await waitTurbo(page);
        await settle(page, 900);
        await nav.prepare?.(page);
        let target: any = null;
        let themeTo: string | null = null;
        if (nav.themeChange) {
            themeTo = scheme === "light" ? "dark" : "light";
            target = await firstVisible(page, [
                `button[name="theme"][value="${themeTo}"]`,
                `label:has(input[name="theme"][value="${themeTo}"])`,
            ]);
        } else {
            target = await firstVisible(page, nav.click);
        }
        if (!target) {
            if (skipsMissingNav(nav, run.baseline)) {
                await ctx.close().catch(() => {});
                return null;
            }
            base.error = `nothing to click on ${nav.start} (${nav.click.join(" | ") || "theme control"})`;
            await ctx.close().catch(() => {});
            return base;
        }
        const label = `nav-${Date.now()}`;
        await page.evaluate((l: string) => {
            window.__fcVisits = 0;
            const count = () => window.__fcVisits++;
            document.addEventListener("turbo:load", count);
            document.addEventListener("turbo:morph", count);
            window.__fc.mark(l);
        }, label);
        await target.click();
        if (nav.themeChange) {
            await page
                .waitForFunction(
                    (to: string) =>
                        document.documentElement.getAttribute("data-theme") ===
                        to,
                    themeTo,
                    { timeout: 8000 },
                )
                .catch(() => {
                    base.checkFailures.push(
                        `data-theme never became ${themeTo}`,
                    );
                });
        } else {
            await page
                .waitForURL((u: any) => u.pathname === nav.lands, {
                    timeout: 8000,
                })
                .catch(() => {
                    base.checkFailures.push(`never reached ${nav.lands}`);
                });
            if (keepsBody(nav)) {
                // The URL does not change: wait for Turbo's own refresh.
                await page
                    .waitForFunction(() => window.__fcVisits > 0, null, {
                        timeout: 8000,
                    })
                    .catch(() => {
                        base.checkFailures.push(
                            `Turbo never refreshed ${nav.lands}`,
                        );
                    });
            }
        }
        await settle(page);
        await waitTurbo(page);
        const trace = await readTrace(page);
        Object.assign(base, analyse(trace, label, { firstLoad: false }));
        if (nav.themeChange) {
            const { live, fresh } = await themeChrome(page);
            const same = JSON.stringify(live) === JSON.stringify(fresh);
            base.checks.push(
                `theme chrome after the change equals a fresh load's: ${same ? "yes" : "NO"}`,
            );
            if (!same)
                base.checkFailures.push(
                    `theme chrome differs from a fresh load: live ${JSON.stringify(live)} vs fresh ${JSON.stringify(fresh)}`,
                );
            // And back to Auto through the control.
            const back = await firstVisible(page, [
                `button[name="theme"][value="system"]`,
                `label:has(input[name="theme"][value="system"])`,
            ]);
            if (back) {
                await back.click();
                await page
                    .waitForFunction(
                        () =>
                            !document.documentElement.getAttribute(
                                "data-theme",
                            ),
                        null,
                        { timeout: 8000 },
                    )
                    .catch(() =>
                        base.checkFailures.push(
                            "Auto never cleared data-theme",
                        ),
                    );
                await settle(page, 600);
                const again = await themeChrome(page);
                const ok =
                    JSON.stringify(again.live) === JSON.stringify(again.fresh);
                base.checks.push(
                    `theme chrome after Auto equals a fresh load's: ${ok ? "yes" : "NO"}`,
                );
                if (!ok)
                    base.checkFailures.push(
                        "theme chrome after Auto differs from a fresh load",
                    );
            }
        }
    } catch (err) {
        base.error = String(err instanceof Error ? err.message : err);
    }
    await ctx?.close().catch(() => {});
    return base;
}

async function runFirstLoad(
    run: Run,
    path: string,
    variant: VariantId,
    scheme: Scheme,
    rep: number,
): Promise<RunResult> {
    const out: RunResult = {
        nav: `first full load: ${path}`,
        variant,
        scheme,
        rep,
        docs: 0,
        bodies: 0,
        frames: 0,
        blank: [],
        doublePaint: [],
        flips: [],
        reload: false,
        fadeFrames: 0,
        minOp: 1,
        checks: [],
        checkFailures: [],
    };
    await run.resetTheme();
    let ctx: any = null;
    try {
        ctx = await run.context(scheme, variant);
        const page = await ctx.newPage();
        // Mark before the document exists: the sampler restores marks from
        // sessionStorage, so seed one on a blank same-origin page first.
        await page.goto(run.base + "/health", { waitUntil: "load" });
        await page.evaluate(() => window.__fc.mark("first-load"));
        await page.goto(run.base + path, { waitUntil: "load" });
        await waitTurbo(page);
        await settle(page, 1500);
        const trace = await readTrace(page);
        Object.assign(out, analyse(trace, "first-load", { firstLoad: true }));
    } catch (err) {
        out.error = String(err instanceof Error ? err.message : err);
    }
    await ctx?.close().catch(() => {});
    return out;
}

// ------------------------------------------------------------------ verdicts

type Verdict = {
    nav: string;
    scheme: Scheme;
    status: "pass" | "FAIL" | "recorded" | "n/a";
    notes: string[];
    perVariant: Record<VariantId, string>;
};

function problems(rs: RunResult[]): string[] {
    const set = new Set<string>();
    for (const r of rs) {
        if (r.blank.length) set.add("blank frame");
        if (r.doublePaint.length) set.add("double paint");
        if (r.flips.length) set.add("flip");
    }
    return [...set];
}

function describe(rs: RunResult[]): string {
    if (rs.length === 0) return "n/a";
    const bits: string[] = [];
    for (const kind of ["blank frame", "double paint", "flip"]) {
        const n = rs.filter((r) =>
            kind === "blank frame"
                ? r.blank.length
                : kind === "double paint"
                  ? r.doublePaint.length
                  : r.flips.length,
        ).length;
        if (n) bits.push(`${kind} ${n}/${rs.length}`);
    }
    const reloads = rs.filter((r) => r.reload).length;
    if (reloads) bits.unshift(`document reload ${reloads}/${rs.length}`);
    const fade = rs.filter((r) => r.fadeFrames > 0).length;
    const tail = `fade frames in ${fade}/${rs.length}, min opacity ${Math.min(...rs.map((r) => r.minOp))}`;
    return bits.length ? `${bits.join(", ")}; ${tail}` : `clean; ${tail}`;
}

function verdict(
    nav: string,
    scheme: Scheme,
    by: Record<VariantId, RunResult[]>,
    expectFull: boolean,
): Verdict {
    const notes: string[] = [];
    let status: Verdict["status"] = "pass";
    const all = [...by.motion, ...by["no-fade"], ...by.reduced];
    if (all.length === 0) {
        return {
            nav,
            scheme,
            status: "n/a",
            notes: ["not present on this commit"],
            perVariant: { motion: "n/a", "no-fade": "n/a", reduced: "n/a" },
        };
    }
    const errors = all.filter((r) => r.error);
    if (errors.length) {
        status = "FAIL";
        notes.push(...[...new Set(errors.map((r) => `error: ${r.error}`))]);
    }
    const fails = all.flatMap((r) => r.checkFailures);
    if (fails.length) {
        status = "FAIL";
        notes.push(...[...new Set(fails)]);
    }
    // Reload: a Turbo visit that loaded a new document, in any variant.
    if (!expectFull && all.some((r) => r.reload)) {
        status = "FAIL";
        notes.push(
            "document reload (a full page load where Turbo should visit)",
        );
    }
    const withMotion = problems(by.motion);
    if (withMotion.length) {
        const noFade = problems(by["no-fade"]);
        const reduced = problems(by.reduced);
        for (const p of withMotion) {
            if (!noFade.includes(p)) {
                if (status !== "FAIL") status = "FAIL";
                notes.push(
                    `${p}: the entrance fade is the cause (gone with only the fade withheld)`,
                );
            } else if (!reduced.includes(p)) {
                if (status === "pass") status = "recorded";
                notes.push(
                    `${p}: another animation (stays with the fade withheld, gone with all motion off)`,
                );
            } else {
                status = "FAIL";
                notes.push(
                    `${p}: stays with all motion off, so it is not an animation`,
                );
            }
        }
    }
    // Withheld or reduced runs that show a problem motion does not: still real.
    for (const v of ["no-fade", "reduced"] as const) {
        for (const p of problems(by[v])) {
            if (!withMotion.includes(p)) {
                status = "FAIL";
                notes.push(`${p} appears in the ${v} run only`);
            }
        }
    }
    return {
        nav,
        scheme,
        status,
        notes,
        perVariant: {
            motion: describe(by.motion),
            "no-fade": describe(by["no-fade"]),
            reduced: describe(by.reduced),
        },
    };
}

// ---------------------------------------------------------------------- main

async function ensureSession(base: string): Promise<string> {
    const email = process.env.FLICKER_EMAIL ?? "owner@example.invalid";
    const password = process.env.FLICKER_PASSWORD ?? "flicker-pass-1";
    const home = await fetch(`${base}/`, { redirect: "manual" });
    const page = await home.text();
    const sid = /name="session_id" value="([^"]+)"/.exec(page)?.[1];
    if (!sid) throw new Error("no login page at /: is the stack running?");
    const body = new URLSearchParams({
        session_id: sid,
        email,
        password,
        action: "login",
    });
    const res = await fetch(`${base}/approve`, {
        method: "POST",
        body,
        redirect: "manual",
    });
    const cookie = /nm_site=([^;]+)/.exec(
        res.headers.get("set-cookie") ?? "",
    )?.[1];
    if (!cookie)
        throw new Error(
            `sign-in answered ${res.status} with no session (wrong FLICKER_EMAIL / FLICKER_PASSWORD for this stack?)`,
        );
    const after = await (
        await fetch(`${base}/`, { headers: { cookie: `nm_site=${cookie}` } })
    ).text();
    if (after.includes('action="/create-household"')) {
        const r = await fetch(`${base}/create-household`, {
            method: "POST",
            redirect: "manual",
            headers: {
                cookie: `nm_site=${cookie}`,
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                household_name: "Flicker House",
                display_name: "Owner",
            }),
        });
        if (r.status !== 303)
            throw new Error(`create-household answered ${r.status}`);
    }
    return cookie;
}

async function main() {
    const port = process.env.APP_PORT;
    const base = (
        arg("base", "FLICKER_BASE") ??
        (port ? `http://${tailscaleIp()}:${port}` : "")
    ).replace(/\/$/, "");
    if (!base) throw new Error("pass --base http://<tailscale-ip>:<port>");
    const host = arg("browser", "FLICKER_BROWSER") ?? "ironhide";
    const reps = Number(arg("reps", "FLICKER_REPS") ?? 2);
    const baseline = process.argv.includes("--baseline");
    const only = arg("only", "FLICKER_ONLY");
    const out = arg("out", "FLICKER_OUT");
    const tokenFile = join(homedir(), ".config/browserless/token");
    const token = (await Bun.file(tokenFile).text()).trim();
    const pw = await import(join(findPlaywrightCore(), "index.js"));
    const cookie = await ensureSession(base);
    const db = arg("db", "FLICKER_DB");
    if (db)
        console.error(
            (await seedStack(db)) ? "seeded the stack" : "stack already seeded",
        );
    const ws = `ws://${host}.tail4a18ab.ts.net:3000?token=${token}`;
    const run = new Run(pw, ws, base, cookie, baseline);
    const results: RunResult[] = [];
    const log = (s: string) => console.error(s);
    try {
        const jobs: { nav: Nav | null; path?: string }[] = [
            ...FIRST_LOADS.map((path) => ({ nav: null, path })),
            ...NAVS.map((nav) => ({ nav })),
        ];
        for (const job of jobs) {
            const name = job.nav
                ? job.nav.name
                : `first full load: ${job.path}`;
            if (only && !name.includes(only)) continue;
            for (const scheme of SCHEMES) {
                for (const variant of VARIANTS) {
                    for (let rep = 1; rep <= reps; rep++) {
                        log(`${name} | ${scheme} | ${variant} | #${rep}`);
                        let r: RunResult | null = null;
                        for (let attempt = 1; attempt <= 3; attempt++) {
                            r = job.nav
                                ? await runNav(
                                      run,
                                      job.nav,
                                      variant,
                                      scheme,
                                      rep,
                                  )
                                : await runFirstLoad(
                                      run,
                                      job.path!,
                                      variant,
                                      scheme,
                                      rep,
                                  );
                            // A browser that went away is not a result: retry.
                            if (
                                !r?.error ||
                                !/closed|disconnected|Target/i.test(r.error)
                            )
                                break;
                            log(
                                `  browser went away (${r.error.split("\n")[0]}); retry ${attempt}`,
                            );
                        }
                        if (r) results.push(r);
                    }
                }
            }
        }
    } finally {
        await run.resetTheme();
        await run.browser?.close().catch(() => {});
    }
    // Verdicts per navigation and scheme.
    const names = [...new Set(results.map((r) => r.nav))];
    const allNames = [...new Set([...jobsNames(), ...names])].filter(
        (n) => !only || n.includes(only),
    );
    const verdicts: Verdict[] = [];
    for (const nav of allNames) {
        for (const scheme of SCHEMES) {
            const by: Record<VariantId, RunResult[]> = {
                motion: [],
                "no-fade": [],
                reduced: [],
            };
            for (const r of results)
                if (r.nav === nav && r.scheme === scheme) by[r.variant].push(r);
            verdicts.push(verdict(nav, scheme, by, false));
        }
    }
    const report = render(base, host, reps, verdicts, results);
    console.log(report);
    if (out) {
        writeFileSync(out, report);
        writeFileSync(
            out.replace(/\.md$/, "") + ".json",
            JSON.stringify(results, null, 1),
        );
    }
    process.exit(verdicts.some((v) => v.status === "FAIL") ? 1 : 0);
}

function jobsNames(): string[] {
    return [
        ...FIRST_LOADS.map((p) => `first full load: ${p}`),
        ...NAVS.map((n) => n.name),
    ];
}

function render(
    base: string,
    host: string,
    reps: number,
    verdicts: Verdict[],
    results: RunResult[],
): string {
    const lines: string[] = [];
    lines.push(`# Flicker check`);
    lines.push("");
    lines.push(
        `Stack ${base}, remote Chromium on ${host}, 390 px wide, ${reps} run(s) of each navigation, variant and theme. WebKit (Safari's toolbar tint) is not covered.`,
    );
    lines.push("");
    const fail = verdicts.filter((v) => v.status === "FAIL").length;
    const rec = verdicts.filter((v) => v.status === "recorded").length;
    const pass = verdicts.filter((v) => v.status === "pass").length;
    const na = verdicts.filter((v) => v.status === "n/a").length;
    lines.push(
        `Summary: ${fail === 0 ? "PASS" : "FAIL"}: ${pass} pass, ${rec} recorded (another animation, not failing), ${fail} fail, ${na} not present on this commit (${verdicts.length} navigation x theme rows).`,
    );
    lines.push("");
    lines.push(
        "| navigation | theme | result | motion on | fade withheld | reduced motion |",
    );
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const v of verdicts) {
        lines.push(
            `| ${v.nav} | ${v.scheme} | ${v.status} | ${v.perVariant.motion} | ${v.perVariant["no-fade"]} | ${v.perVariant.reduced} |`,
        );
    }
    lines.push("");
    lines.push("## Why a row is not a pass");
    for (const v of verdicts) {
        if (v.status === "pass" || v.status === "n/a") continue;
        lines.push(`- ${v.nav} (${v.scheme}): ${v.status}`);
        for (const n of v.notes) lines.push(`  - ${n}`);
    }
    lines.push("");
    lines.push("## First examples of what was seen");
    const seen = new Set<string>();
    for (const r of results) {
        for (const f of [...r.blank, ...r.doublePaint, ...r.flips]) {
            const key = `${r.nav}|${r.variant}|${f.kind}`;
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push(
                `- ${r.nav} (${r.scheme}, ${r.variant}): ${f.kind}: ${f.detail}`,
            );
        }
    }
    const checks = new Set<string>();
    for (const r of results)
        for (const c of r.checks)
            checks.add(`${r.nav} (${r.scheme}, ${r.variant}): ${c}`);
    if (checks.size) {
        lines.push("");
        lines.push("## Theme chrome");
        for (const c of checks) lines.push(`- ${c}`);
    }
    return lines.join("\n") + "\n";
}

if (import.meta.main) await main();
