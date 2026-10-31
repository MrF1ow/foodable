/**
 * Renders every household-app page with fixture data, in light and dark, and
 * serves the result next to the real /app.css so the pages can be looked at
 * without Supabase. The widget equivalent is scripts/widget-harness.ts.
 *
 *   bun run scripts/nav-check-fixture.ts   # fixture server for check:nav (:4791)
 *
 * --shots needs Chromium on PATH (google-chrome-stable, chromium, or
 * chromium-browser — not the PATH google-chrome wrapper, which pins the GUI
 * profile). Shots pass --force-prefers-reduced-motion so --virtual-time-budget
 * does not freeze page entrances half-done, a throwaway --user-data-dir, and
 * an emulated prefers-color-scheme so bare pages (OS theme) render light and
 * dark as different bytes.
 * The server never imports this file.
 */
import { utcTodayFromDate } from "../src/domain/stock.js";
import { escapeHtml } from "../src/html.js";
import { formatQuantityDisplayParts } from "../src/web/display-quantity.js";
import { renderFridgePage } from "../src/web/pages/fridge.js";
import { renderGroceryPage } from "../src/web/pages/grocery.js";
import {
    renderRecipeDetailPage,
    renderRecipesPage,
} from "../src/web/pages/recipes.js";
import { renderSettingsPage } from "../src/web/pages/settings.js";
import { renderFoodsSettingsPage } from "../src/web/pages/foods.js";
import { renderHouseholdSettingsPage } from "../src/web/pages/household.js";
import { renderSettingsHelpPage } from "../src/web/pages/settings-help.js";
import {
    renderNutritionPage,
    viewerChromeFromProfile,
} from "../src/web/pages/nutrition.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
} from "../src/web/loaders.js";
import { isNutritionCard } from "../src/domain/layout.js";
import { getAppCss, getAppJs, getEmbedWidgetHtml } from "../src/widgets.js";

const OUT = "./tmp/app-preview";
const PORT = 4791;
const H = "hh-1";
const ME = {
    householdId: H,
    userId: "u1",
    role: "owner",
    displayName: "Ethan",
};
const SAM = { ...ME, userId: "u2", role: "member", displayName: "Sam" };
const RILEY = { ...ME, userId: "u3", role: "admin", displayName: "Riley" };

// The widget templates carry a SAMPLE payload for standalone preview; reuse it
// so the nutrition page shows real cards.
async function widgetSample(key: string): Promise<unknown> {
    const src = await Bun.file(
        `./public/widgets/src/templates/${key}.html`,
    ).text();
    const m = src.match(/const SAMPLE = (\{[\s\S]*?\n {12}\});/);
    return m ? new Function(`return (${m[1]})`)() : { locale: "en" };
}

function addUtcDays(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function fridgeView(chrome: unknown) {
    const today = utcTodayFromDate();
    const loc = (id: string, name: string, sortOrder: number) => ({
        id,
        householdId: H,
        name,
        sortOrder,
    });
    const item = (
        id: string,
        locationId: string,
        displayName: string,
        amount: number,
        unit: string,
        expiresOn: string | null,
        food = true,
    ) => ({
        id,
        householdId: H,
        locationId,
        kind: food ? "food" : "supply",
        displayName,
        quantity: { amount, unit },
        foodId: food ? `f-${id}` : `f-sup-${id}`,
        expiresOn,
    });
    return {
        chrome,
        locations: [loc("l1", "Fridge", 0), loc("l2", "Pantry", 1)],
        items: [
            item("i1", "l1", "Expired milk", 1, "l", addUtcDays(today, -1)),
            item("i2", "l1", "Eggs", 6, "each", addUtcDays(today, 1)),
            item("i3", "l1", "Yogurt", 2, "each", addUtcDays(today, 3)),
            item("i4", "l1", "Cheese", 200, "g", addUtcDays(today, 5)),
            item("i5", "l1", "Butter", 250, "g", addUtcDays(today, 14)),
            item("i6", "l2", "Paper towels", 3, "roll", null, false),
            ...Array.from({ length: 42 }, (_, i) =>
                item(
                    `i-scroll-${i}`,
                    "l2",
                    `Pantry filler ${i + 1}`,
                    1,
                    "each",
                    addUtcDays(today, 30 + (i % 14)),
                ),
            ),
        ],
    };
}

function groceryView(chrome: unknown) {
    const section = (
        storeId: string,
        id: string,
        name: string,
        isOther: boolean,
        lines: unknown[],
    ) => ({
        id,
        householdId: H,
        storeId,
        name,
        sortOrder: isOther ? 8 : 0,
        hidden: false,
        isOther,
        lines,
    });
    const line = (
        storeId: string,
        sectionId: string,
        id: string,
        name: string,
        amount: number,
        unit: string,
        checked: boolean,
        alreadyHave: unknown = null,
    ) => ({
        id,
        householdId: H,
        storeId,
        sectionId,
        kind: "food",
        displayName: name,
        quantity: { amount, unit },
        foodId: `f-${id}`,
        checked,
        alreadyHave,
    });
    return {
        chrome,
        isOwner: true,
        locations: [
            { id: "l1", name: "Fridge" },
            { id: "l2", name: "Pantry" },
        ],
        stores: [
            {
                id: "s1",
                householdId: H,
                name: "Safeway",
                sortOrder: 0,
                rules: [{ id: "r1", body: "Prefer store brand." }],
                sections: [
                    section("s1", "sec1", "Produce", false, [
                        line("s1", "sec1", "g1", "Bananas", 6, "each", false),
                        line("s1", "sec1", "g2", "Spinach", 300, "g", true),
                    ]),
                    section("s1", "sec2", "Other", true, [
                        line("s1", "sec2", "g3", "Eggs", 12, "each", false, {
                            cover: "partial",
                            have: { amount: 6, unit: "each" },
                            need: { amount: 12, unit: "each" },
                        }),
                    ]),
                ],
            },
            {
                id: "s2",
                householdId: H,
                name: "Costco",
                sortOrder: 1,
                rules: [],
                sections: [
                    section("s2", "sec3", "Dairy", false, [
                        line("s2", "sec3", "g4", "Milk", 2, "l", false),
                    ]),
                ],
            },
        ],
    };
}

const RECIPE = {
    id: "r1",
    householdId: H,
    creatorId: "u1",
    name: "Shakshuka",
    yieldPortions: 4,
    instructions: "Simmer tomatoes, crack eggs, cover.",
    sourceUrl: null,
    tags: ["dinner", "vegetarian"],
    notes: null,
    prepMinutes: 10,
    cookMinutes: 20,
};

const RECIPE_TWO = {
    id: "r2",
    householdId: H,
    creatorId: "u1",
    name: "Oatmeal",
    yieldPortions: 2,
    instructions: "Simmer oats.",
    sourceUrl: null,
    tags: ["breakfast"],
    notes: null,
    prepMinutes: 5,
    cookMinutes: 10,
};

const MACROS = {
    calories: 320,
    protein_g: 18,
    carbs_g: 22,
    fat_g: 17,
    fiber_g: 5,
    sugar_g: 9,
    alcohol_g: 0,
    incomplete: false,
    incompleteReasons: [],
};

function food(id: string, name: string, calories: number | null) {
    return {
        id,
        householdId: H,
        kind: "food",
        name,
        normalizedName: name.toLowerCase(),
        brand: null,
        defaultUnit: "g",
        gramsPerEach: null,
        gramsPerMl: null,
        calories,
        proteinG: null,
        carbsG: null,
        fatG: null,
        fiberG: null,
        sugarG: null,
        alcoholG: null,
        caffeineMg: null,
        nutritionSource: null,
        allergens: [],
        offSourceId: null,
        createdBy: null,
        archivedAt: null,
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        aliases: [],
    };
}

// Views are cast with `as never`: this script is not typechecked (CI's
// typecheck covers src/ only) and the fixtures only carry what renderers read.
async function pages(theme: "light" | "dark"): Promise<Record<string, string>> {
    const chrome = viewerChromeFromProfile({ theme });
    const nutrition = await renderNutritionPage({
        access: { ok: true, mode: "self", viewer: ME, subject: ME },
        members: [ME, SAM],
        summary: await widgetSample("nutrition-summary"),
        goals: await widgetSample("goal-progress"),
        trends: await widgetSample("trends"),
        weight: await widgetSample("weight-trends"),
        chrome,
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
    } as never);
    const nutritionPeer = await renderNutritionPage({
        access: { ok: true, mode: "peer", viewer: ME, subject: SAM },
        members: [ME, SAM],
        summary: await widgetSample("nutrition-summary"),
        goals: await widgetSample("goal-progress"),
        trends: await widgetSample("trends"),
        weight: await widgetSample("weight-trends"),
        chrome,
        cardOrder: [
            "nutrition-summary",
            "goal-progress",
            "trends",
            "weight-trends",
        ],
        viewMemberId: SAM.userId,
    } as never);
    return {
        nutrition,
        "nutrition-peer": nutritionPeer,
        fridge: renderFridgePage(fridgeView(chrome) as never),
        grocery: renderGroceryPage(groceryView(chrome) as never),
        recipes: renderRecipesPage({
            chrome,
            recipes: [RECIPE, RECIPE_TWO],
            members: [ME, SAM],
            viewerId: "u1",
        } as never),
        recipe: renderRecipeDetailPage(recipeDetailFixture(chrome) as never),
        settings: renderSettingsPage({
            chrome,
            displayName: "Ethan",
            timezone: "America/Los_Angeles",
            weightUnit: "kg",
            widgetsEnabled: true,
            alcoholTrackingEnabled: false,
            drinkUnit: "",
        } as never),
        household: renderHouseholdSettingsPage({
            chrome,
            householdName: "Flow house",
            location: "Portland",
            members: [ME, SAM, RILEY],
            stores: [
                {
                    id: "s1",
                    householdId: H,
                    name: "Safeway",
                    sortOrder: 0,
                    sections: [
                        {
                            id: "sec1",
                            householdId: H,
                            storeId: "s1",
                            name: "Produce",
                            sortOrder: 0,
                            hidden: false,
                            isOther: false,
                        },
                    ],
                    rules: [{ id: "r1", body: "Prefer store brand." }],
                },
            ],
            memberRules: [
                { member: ME, rules: [], allergens: [], dislikes: [] },
            ],
            isOwner: true,
        } as never),
        foods: renderFoodsSettingsPage(foodsSettingsFixture(chrome) as never),
        help: renderSettingsHelpPage({ chrome } as never),
        "create-household": createHouseholdFormHtml(undefined, theme),
        forbidden: forbiddenDashboardHtml(theme),
    };
}

function findChromium(): string | null {
    // Prefer the real binary. PATH `google-chrome` is often a wrapper that
    // pins --user-data-dir to the GUI profile and hangs headless shots.
    for (const bin of [
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
    ]) {
        if (bin.startsWith("/")) {
            try {
                if (Bun.file(bin).size > 0) return bin;
            } catch {
                // missing
            }
            continue;
        }
        const path = Bun.which(bin);
        if (path) return path;
    }
    return null;
}

// Warm the asset hashes before writing pages. A later re-render (a shared
// dialog's server-error response) goes through renderAppShell, which stamps
// /app.css?v= and /app.js?v= once the bundles exist. If the page the browser
// loaded omitted those queries, Turbo treats the 400 as a tracked-element
// mismatch and full-reloads the unfilled page.
await getAppCss();
await getAppJs();

const names: string[] = [];
for (const theme of ["light", "dark"] as const) {
    for (const [name, html] of Object.entries(await pages(theme))) {
        const file = `${name}-${theme}`;
        await Bun.write(`${OUT}/${file}.html`, html);
        names.push(file);
    }
}

const ROUTE_BASE: Record<string, string> = {
    "/": "nutrition",
    "/fridge": "fridge",
    "/grocery": "grocery",
    "/recipes": "recipes",
    "/settings": "settings",
    "/settings/help": "help",
    "/settings/household": "household",
    "/settings/foods": "foods",
    "/create-household": "create-household",
};

/** Saved appearance from Settings › Account (null = system). */
let accountTheme: "light" | "dark" | null = "dark";

function themeFileSuffix(): "light" | "dark" {
    return accountTheme ?? "light";
}

function routeHtmlFile(pathname: string): string {
    const base = ROUTE_BASE[pathname] || "fridge";
    return `${base}-${themeFileSuffix()}.html`;
}

function applyAccountTheme(html: string): string {
    if (accountTheme === "light" || accountTheme === "dark") return html;
    // System follows the OS. The light render stamps data-theme on <html>
    // and on each widget frame; every stamp has to come off or the cards
    // stay light while the page does not.
    return html
        .replace(/\sdata-theme="(light|dark)"/g, "")
        .replace(
            /<meta name="foodable-theme" content="[^"]+" \/>/,
            '<meta name="foodable-theme" content="system" />',
        )
        .replace(
            /<meta name="theme-color" content="[^"]+" \/>/,
            `<meta name="theme-color" content="#fefefd" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#131615" media="(prefers-color-scheme: dark)" />`,
        );
}

let stallMs = 0;
let postMode = "ok";
let modalId = "";
let loginPath = "";
let postDelay = 0;
let sessionMode: "app" | "guest" = "app";
const posts: { path: string; entries: [string, string][] }[] = [];
const gets: { path: string; n: number }[] = [];
const getCounts = new Map<string, number>();
const searchHits: string[] = [];
let approveCount = 0;
const pending = new Map<string, { html: string; status: number }>();

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

function stamp(html: string, path: string) {
    const n = (getCounts.get(path) || 0) + 1;
    getCounts.set(path, n);
    gets.push({ path, n });
    if (!html.includes('class="app-main')) return html;
    return html.replace(
        '<main class="app-main native">',
        `<main class="app-main native"><p id="p8-rev" data-rev="${n}" hidden></p>`,
    );
}

async function fileHtml(file: string, path: string) {
    const raw = await Bun.file(`${OUT}/${file}`).text();
    return stamp(raw, path);
}

async function loginDocument() {
    const raw = await Bun.file("./public/login.html").text();
    return raw
        .replaceAll("{{SESSION_ID}}", "sess-p8")
        .replaceAll("{{ERROR}}", "")
        .replaceAll("{{CONNECT_HINT}}", "");
}

function foodsSettingsFixture(chrome: unknown) {
    return {
        chrome,
        foods: [food("f1", "Eggs", 143), food("f2", "Milk", 64)],
    };
}

function recipeDetailFixture(chrome: unknown) {
    const ingredient = (
        id: string,
        displayName: string,
        amount: number,
        unit: string,
        note: string | null,
    ) => ({
        id,
        recipeId: "r1",
        foodId: id,
        displayName,
        quantity: { amount, unit },
        note,
        sortOrder: 0,
        perPortionAmount: amount,
        personAmount: amount,
    });
    return {
        chrome,
        recipe: RECIPE,
        ingredients: [
            ingredient("ing1", "Eggs", 6, "each", "large"),
            ingredient("ing2", "Milk", 200, "ml", null),
        ],
        members: [ME, SAM],
        stores: [{ id: "s1", name: "Safeway" }],
        viewerId: "u1",
        filterUserId: "u1",
        portionCount: 1,
        macros: MACROS,
        isOwner: true,
    };
}

function renderFailedModal(pathname: string, modalId: string): string | null {
    if (!modalId) return null;
    const chrome = viewerChromeFromProfile({ theme: themeFileSuffix() });
    if (pathname === "/fridge") {
        const view = fridgeView(chrome);
        const itemId = (prefix: string) =>
            modalId.startsWith(prefix) ? modalId.slice(prefix.length) : "";
        const hasItem = (id: string) =>
            id.length > 0 && view.items.some((item) => item.id === id);
        const hasLocation = (id: string) =>
            id.length > 0 &&
            view.locations.some((location) => location.id === id);
        if (
            !hasItem(itemId("fridge-edit-")) &&
            !hasItem(itemId("fridge-delete-")) &&
            !hasLocation(itemId("fridge-add-food-")) &&
            !hasLocation(itemId("fridge-add-supply-")) &&
            !hasLocation(itemId("fridge-remove-location-"))
        ) {
            return null;
        }
        return renderFridgePage({
            ...view,
            error: "Name is required",
            openModalId: modalId,
        } as never);
    }
    if (pathname === "/recipes/r1") {
        const view = recipeDetailFixture(chrome);
        const itemId = (prefix: string) =>
            modalId.startsWith(prefix) ? modalId.slice(prefix.length) : "";
        const known = (id: string) =>
            id.length > 0 &&
            view.ingredients.some((ingredient) => ingredient.id === id);
        if (
            !known(itemId("recipe-edit-ingredient-")) &&
            !known(itemId("recipe-delete-ingredient-"))
        ) {
            return null;
        }
        return renderRecipeDetailPage({
            ...view,
            error: "Name is required",
            openModalId: modalId,
        } as never);
    }
    if (pathname === "/settings/foods" && modalId.startsWith("food-edit-")) {
        const id = modalId.slice("food-edit-".length);
        const view = foodsSettingsFixture(chrome);
        if (!id || !view.foods.some((item) => item.id === id)) return null;
        return renderFoodsSettingsPage({
            ...view,
            error: "Name is required",
            openModalId: modalId,
        } as never);
    }
    return null;
}

function injectModal(html: string, id: string) {
    if (!id) return html;
    const re = new RegExp(`(<dialog\\b[^>]*\\bid="${id}"[^>]*)>`);
    return html
        .replace(re, (_full, openTag) => {
            const cleaned = String(openTag).replace(
                /\sdata-modal-open-on-load/g,
                "",
            );
            return `${cleaned} data-modal-open-on-load>`;
        })
        .replace(
            new RegExp(
                `(<dialog\\b[^>]*\\bid="${id}"[^>]*>\\s*<div class="modal-sheet">)`,
            ),
            `$1<p class="error-banner" id="p8-error">Name is required</p>`,
        );
}

function stripItem(html: string, id: string) {
    const re = new RegExp(
        `<li\\b[^>]*class="[^"]*fridge-item[^"]*"[^>]*data-item-id="${id}"[\\s\\S]*?</li>`,
    );
    if (!re.test(html)) {
        const re2 = new RegExp(
            `<li\\b[^>]*data-item-id="${id}"[^>]*>[\\s\\S]*?</li>`,
        );
        return html.replace(re2, `<p id="done">Item removed</p>`);
    }
    return html.replace(re, `<p id="done">Item removed</p>`);
}

/** The 303 page is the fixture's next fridge render, with this edit applied. */
function patchFridgeItemQty(
    html: string,
    id: string,
    amount: number,
    unit: string,
): string {
    const label = escapeHtml(formatQuantityDisplayParts(amount, unit));
    const safeId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const liRe = new RegExp(
        `<li\\b[^>]*class="[^"]*fridge-item[^"]*"[^>]*data-item-id="${safeId}"[\\s\\S]*?</li>`,
    );
    return html.replace(liRe, (li) => {
        let next = li.replace(
            /(<p class="fridge-item-qty row-meta">)[^<]*? · /,
            `$1${label} · `,
        );
        next = next.replace(
            /data-fill-field-qty_amount="[^"]*"/g,
            `data-fill-field-qty_amount="${escapeHtml(String(amount))}"`,
        );
        next = next.replace(
            /data-fill-field-qty_unit="[^"]*"/g,
            `data-fill-field-qty_unit="${escapeHtml(unit)}"`,
        );
        return next;
    });
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;
        if (path === "/__stats") {
            return Response.json({
                gets,
                posts,
                searchHits,
                approveCount,
                stallMs,
                postMode,
                modalId,
                loginPath,
                postDelay,
                sessionMode,
                counts: Object.fromEntries(getCounts),
            });
        }
        if (path === "/__control") {
            if (url.searchParams.has("stall"))
                stallMs = Number(url.searchParams.get("stall"));
            if (url.searchParams.has("post"))
                postMode = url.searchParams.get("post") || "ok";
            if (url.searchParams.has("modal"))
                modalId = url.searchParams.get("modal") || "";
            if (url.searchParams.has("loginpath"))
                loginPath = url.searchParams.get("loginpath") || "";
            if (url.searchParams.has("delay"))
                postDelay = Number(url.searchParams.get("delay"));
            if (url.searchParams.get("reset") === "posts") posts.length = 0;
            if (url.searchParams.get("reset") === "search")
                searchHits.length = 0;
            if (url.searchParams.get("reset") === "approve") approveCount = 0;
            if (url.searchParams.has("session")) {
                const mode = url.searchParams.get("session");
                sessionMode = mode === "guest" ? "guest" : "app";
            }
            if (url.searchParams.has("theme")) {
                const t = url.searchParams.get("theme");
                accountTheme =
                    t === "light" || t === "dark"
                        ? t
                        : t === "system"
                          ? null
                          : accountTheme;
            }
            return Response.json({
                ok: true,
                stallMs,
                postMode,
                modalId,
                loginPath,
                postDelay,
                sessionMode,
                accountTheme,
            });
        }
        if (path.startsWith("/app/widgets/")) {
            let key = path.slice("/app/widgets/".length);
            try {
                key = decodeURIComponent(key);
            } catch {
                return new Response("not found", { status: 404 });
            }
            if (!isNutritionCard(key)) {
                return new Response("not found", { status: 404 });
            }
            const doc = await getEmbedWidgetHtml(key);
            return new Response(doc.html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (path === "/app.css" || path === "/app.js") {
            const css = path === "/app.css";
            const body = css ? await getAppCss() : await getAppJs();
            const { appScriptHref, appStylesheetHref } =
                await import("../src/widgets.js");
            const href = css ? appStylesheetHref() : appScriptHref();
            const v = url.searchParams.get("v");
            const expected = new URL(`http://x${href}`).searchParams.get("v");
            const cache =
                v && expected && v === expected
                    ? "public, max-age=31536000, immutable"
                    : "no-cache";
            return new Response(body, {
                headers: {
                    "content-type": css
                        ? "text/css; charset=utf-8"
                        : "text/javascript; charset=utf-8",
                    "cache-control": cache,
                },
            });
        }
        if (path === "/api/foods/search") {
            searchHits.push(url.search);
            return Response.json({
                foods: [
                    {
                        food_id: "f1",
                        name: "Eggs",
                        brand: "Farm",
                        default_unit: "each",
                    },
                ],
            });
        }
        if (path === "/logout") {
            return new Response(null, {
                status: 302,
                headers: { Location: "/logged-out" },
            });
        }
        if (path === "/logged-out") {
            return new Response(
                `<!doctype html><html><head><title>Logged out</title></head><body><p id="out">logged out</p></body></html>`,
                {
                    headers: { "content-type": "text/html; charset=utf-8" },
                },
            );
        }
        if (path === "/login-test") {
            const html = await loginDocument();
            return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (path === "/approve" && req.method === "POST") {
            approveCount += 1;
            if (approveCount === 1) {
                return new Response(null, {
                    status: 302,
                    headers: { Location: "/after-login" },
                });
            }
            return Response.json({ error: "session_expired" }, { status: 400 });
        }
        if (path === "/after-login") {
            const html = await fileHtml("nutrition-light.html", "/after-login");
            return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (req.method === "POST") {
            const form = await req.formData();
            const entries: [string, string][] = [];
            for (const [k, v] of form.entries()) entries.push([k, String(v)]);
            posts.push({ path, entries });
            if (
                path === "/settings" &&
                entries.some(([k, v]) => k === "group" && v === "account")
            ) {
                const picked = entries.find(([k]) => k === "theme")?.[1];
                accountTheme =
                    picked === "light" || picked === "dark" ? picked : null;
            }
            if (postDelay) await sleep(postDelay);
            const referer =
                req.headers.get("referer") || "http://127.0.0.1:4791/fridge";
            const dest = new URL(referer);
            const destKey = dest.pathname + dest.search;
            const file = routeHtmlFile(dest.pathname);
            let html = applyAccountTheme(
                await fileHtml(file, destKey + "#post"),
            );
            if (postMode === "json") {
                return Response.json({ error: "nope" }, { status: 500 });
            }
            if (postMode === "login") {
                const login = await loginDocument();
                return new Response(login, {
                    status: 401,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }
            const item = path.split("/")[3] || "";
            if (postMode === "fail" || postMode === "modal") {
                const rendered = renderFailedModal(dest.pathname, modalId);
                if (rendered) {
                    html = applyAccountTheme(
                        stamp(rendered, destKey + "#post"),
                    );
                } else {
                    html = injectModal(html, modalId);
                }
                html = html.replace(
                    "</main>",
                    `<script>window.__xss=1</script></main>`,
                );
                return new Response(html, {
                    status: 400,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }
            if (path.includes("/delete") && item) html = stripItem(html, item);
            if (postMode === "ok" && /^\/fridge\/items\/[^/]+$/.test(path)) {
                const amount = entries.find(([k]) => k === "qty_amount")?.[1];
                const unit = entries.find(([k]) => k === "qty_unit")?.[1] ?? "";
                const n = amount == null ? Number.NaN : Number(amount);
                if (Number.isFinite(n) && unit) {
                    html = patchFridgeItemQty(html, item, n, unit);
                }
            }
            html = html.replace("</main>", `<p id="done">saved</p></main>`);
            pending.set(destKey, { html, status: 200 });
            return new Response(null, {
                status: 303,
                headers: { Location: destKey },
            });
        }
        if (pending.has(path + url.search)) {
            const hit = pending.get(path + url.search)!;
            pending.delete(path + url.search);
            return new Response(hit.html, {
                status: hit.status,
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (path === "/session-login") {
            const login = await loginDocument();
            return new Response(login, {
                status: req.method === "GET" ? 200 : 401,
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (loginPath && path === loginPath) {
            loginPath = "";
            const login = await loginDocument();
            return new Response(login, {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (path.startsWith("/recipes/")) {
            if (stallMs) await sleep(stallMs);
            const html = await fileHtml("recipe-light.html", path);
            return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        if (ROUTE_BASE[path]) {
            if (sessionMode === "guest") {
                const login = await loginDocument();
                return new Response(login, {
                    status: 200,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }
            if (stallMs) await sleep(stallMs);
            const html = applyAccountTheme(
                await fileHtml(routeHtmlFile(path), path + url.search),
            );
            return new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
            });
        }
        const file = Bun.file(`${OUT}${path}`);
        if (await file.exists()) return new Response(file);
        const pub = Bun.file(`./public${path}`);
        return (await pub.exists())
            ? new Response(pub)
            : new Response("not found", { status: 404 });
    },
});
console.log(`p8 preview: http://127.0.0.1:${server.port}/`);
