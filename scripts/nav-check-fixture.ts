/**
 * Fixture server for check:nav: the household app's pages rendered with
 * fixture data in the shell, light and dark, and served next to the real
 * /app.css, /app.js and the shell's own /app-v2.css and /app-v2.js, so Turbo
 * navigation can be driven in a browser without a database. The widget
 * equivalent is scripts/widget-harness.ts.
 *
 *   bun run scripts/nav-check-fixture.ts   # fixture server for check:nav (:4791)
 *
 * The server never imports this file.
 */
import {
    buildPreviewKitchenFridgeView,
    renderKitchenFridgeV2Page,
} from "../src/web/pages/v2/kitchen-fridge.js";
import {
    buildPreviewKitchenGroceriesView,
    renderKitchenGroceriesV2Page,
} from "../src/web/pages/v2/kitchen-groceries.js";
import { renderRecipesListV2Page } from "../src/web/pages/v2/recipes-list.js";
import { renderSettingsHouseholdV2Page } from "../src/web/pages/v2/settings-household.js";
import { renderHouseholdInvitesPage } from "../src/web/pages/v2/settings-household-invites.js";
import {
    renderSharedLinksPage,
    type SharedLinkRow,
} from "../src/web/pages/v2/settings-household-shared-links.js";
import { renderHouseholdTokenPage } from "../src/web/pages/v2/settings-household-token.js";
import { renderSettingsRestockV2Page } from "../src/web/pages/v2/settings-restock.js";
import { renderSettingsStoresV2Page } from "../src/web/pages/v2/settings-stores.js";
import { renderSettingsStoreV2Page } from "../src/web/pages/v2/settings-stores-detail.js";
import { renderSettingsReadersV2Page } from "../src/web/pages/v2/settings-readers.js";
import { renderSettingsMemberV2Page } from "../src/web/pages/v2/settings-member.js";
import {
    createHouseholdFormHtml,
    forbiddenDashboardHtml,
} from "../src/web/loaders.js";
import {
    getAppCss,
    getAppJs,
    getAppV2Css,
    getAppV2Js,
} from "../src/widgets.js";
import { defaultViewerFlags } from "../src/viewer-flags.js";
import {
    buildPreviewTrendsPageData,
    renderTrendsV2Page,
} from "../src/web/pages/v2/trends.js";
import {
    buildPreviewTodayPageData,
    renderTodayV2Page,
} from "../src/web/pages/v2/today.js";
import { renderDevGalleryV2Page } from "../src/web/pages/dev-gallery.js";
import { renderSettingsHomeV2Page } from "../src/web/pages/v2/settings-home.js";
import { renderSettingsAccountV2Page } from "../src/web/pages/v2/settings-account.js";
import { renderSettingsTimezoneV2Page } from "../src/web/pages/v2/settings-account-timezone.js";
import { renderSettingsHelpV2Page } from "../src/web/pages/v2/settings-help.js";
import { renderNotificationsPage } from "../src/web/pages/v2/notifications.js";
import { renderSettingsNotificationsV2Page } from "../src/web/pages/v2/settings-notifications.js";
import type { NotificationRow } from "../src/domain/notifications.js";
import { goalsResolver } from "../src/domain/insights.js";
import type { NutritionGoals } from "../src/db/nutrition.js";
import { legacyRedirectTarget } from "../src/web/route-map.js";
import { viewerChromeFromProfile } from "../src/web/shell.js";

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

// Views are cast with `as never`: this script is typechecked, but the
// fixtures only carry what the renderers read.
const FIXTURE_TRENDS_GOALS: NutritionGoals = {
    user_id: "u1",
    daily_calories: 2200,
    daily_protein_g: 160,
    daily_carbs_g: 220,
    daily_fat_g: 70,
    daily_fiber_g: 30,
    daily_sugar_g: 45,
    daily_alcohol_g: 0,
    daily_caffeine_mg: 400,
    daily_water_ml: 2500,
    target_weight_g: null,
    updated_at: "2026-01-01T00:00:00Z",
};

function fixtureTrendsDays(today: string) {
    const days = [];
    for (let i = 364; i >= 0; i--) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        const logged = i % 9 !== 0;
        days.push({
            date,
            calories: logged ? 2100 : 0,
            protein_g: logged ? 150 : 0,
            carbs_g: logged ? 200 : 0,
            fat_g: logged ? 65 : 0,
            logged,
        });
    }
    return days;
}

function previewTrendsPage(chrome: ReturnType<typeof fixtureChrome>) {
    const today = "2026-11-09";
    const data = buildPreviewTrendsPageData(
        chrome as Parameters<typeof buildPreviewTrendsPageData>[0],
        fixtureTrendsDays(today),
        goalsResolver(FIXTURE_TRENDS_GOALS, []),
        [{ date: "2026-11-01", weight_g: 79_000 }],
        today,
        "kg",
    );
    return renderTrendsV2Page(data);
}

function fixtureChrome(theme: "light" | "dark", unread: boolean) {
    return {
        ...viewerChromeFromProfile({ theme }),
        attention: { count: 0, tabs: {} },
        flags: defaultViewerFlags(),
        notificationsUnread: unread,
        identity: {
            viewerName: "Ethan Flow",
            viewerRole: "owner",
            householdName: "The Flow household",
            memberCount: 2,
        },
    };
}

function notificationRow(
    over: Partial<NotificationRow> & Pick<NotificationRow, "id">,
): NotificationRow {
    return {
        householdId: H,
        recipientUserId: ME.userId,
        kind: "food_expiring",
        bucket: "household",
        source: "condition",
        noticeKey: over.id,
        subjectKind: "fridge_item",
        subjectId: "fi-1",
        actorUserId: null,
        payload: {},
        createdAt: "2026-11-10T08:00:00.000Z",
        readAt: null,
        snoozedUntil: null,
        snoozedBy: null,
        dismissedAt: null,
        dismissedBy: null,
        resolvedAt: null,
        ...over,
    };
}

/** The inbox as its owner sees it: an expiring row (every menu item), a
 * personal weigh-in, an Allergens row (Open only) and a snoozed row. */
function notificationsPage(chrome: ReturnType<typeof fixtureChrome>) {
    const today = [
        notificationRow({
            id: "n-yogurt",
            payload: {
                code: "fridge.expiring",
                params: {
                    name: "Greek yogurt",
                    amount: 1,
                    unit: "each",
                    expiresOn: "2026-11-11",
                    daysLeft: 1,
                    onGroceryList: "no",
                },
                related: [],
            },
        }),
        notificationRow({
            id: "n-weigh",
            kind: "weigh_in_due",
            bucket: "personal",
            subjectKind: "member",
            subjectId: ME.userId,
            payload: {
                code: "nutrition.weigh_in_due",
                params: { name: "Ethan", days: 8 },
                related: [],
            },
        }),
        notificationRow({
            id: "n-allergen",
            kind: "allergens",
            subjectKind: "recipe",
            subjectId: "r1",
            payload: {
                code: "recipe.allergen",
                params: { name: "Peanut noodles", allergens: ["peanut"] },
                related: [],
            },
        }),
    ];
    const snoozed = [
        notificationRow({
            id: "n-spinach",
            snoozedUntil: "2026-11-11T09:00:00.000Z",
            payload: {
                code: "fridge.expiring",
                params: {
                    name: "Spinach",
                    amount: 1,
                    unit: "bag",
                    expiresOn: "2026-11-12",
                    daysLeft: 2,
                    onGroceryList: "no",
                },
                related: [],
            },
        }),
    ];
    return renderNotificationsPage({
        chrome: chrome as never,
        inbox: { unread: 0, today, earlier: [], snoozed },
        bucket: "all",
        canDismissEveryone: true,
        timezone: "UTC",
        now: new Date("2026-11-10T12:00:00.000Z"),
    });
}

const FIXTURE_LINKS: SharedLinkRow[] = [
    {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "recipe",
        recipeName: "Chicken alfredo",
        createdByName: "Ethan",
        createdAt: "2026-11-02T10:00:00.000Z",
        expiresAt: "2026-12-12T10:00:00.000Z",
    },
    {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "grocery_list",
        recipeName: null,
        createdByName: null,
        createdAt: "2026-11-01T10:00:00.000Z",
        expiresAt: null,
    },
];

/** The one-time token the rotate route's 200 page shows (not a real token). */
const FIXTURE_HOUSEHOLD_TOKEN = "nt_hh_7Qm2xR9vYb1KcN8dFhJ3sGaE5uOi";

const FIXTURE_RESTOCK = {
    enabled: true,
    weekday: 0 as const,
    time: "09:00",
    lastRunOn: "2026-11-08",
    lastRunAdded: 3,
};

const FIXTURE_STORES = [
    { id: "s-costco", name: "Costco", sectionCount: 4, lineCount: 5 },
    { id: "s-trader", name: "Trader Joe's", sectionCount: 2, lineCount: 3 },
    { id: "s-market", name: "Farmers market", sectionCount: 0, lineCount: 0 },
];

function storesFixture(
    chrome: ReturnType<typeof fixtureChrome>,
    over: { reorder?: boolean } = {},
) {
    return renderSettingsStoresV2Page({
        chrome: chrome as never,
        stores: FIXTURE_STORES,
        defaultStoreId: "s-costco",
        useUsualStore: true,
        canManage: true,
        ...over,
    });
}

const COSTCO_SECTIONS = [
    ["sec-produce", "Produce"],
    ["sec-meat", "Meat"],
    ["sec-dairy", "Dairy"],
] as const;

/** Costco's section order, which a section's ⋯ Move up and Move down change. */
let costcoOrder: string[] = COSTCO_SECTIONS.map(([id]) => id);

/** What the route does with a bare move: the section swaps with its neighbour; the ends stay. */
function moveCostcoSection(move: string) {
    const at = move.lastIndexOf(":");
    const id = move.slice(0, at);
    const from = costcoOrder.indexOf(id);
    const to = move.slice(at + 1) === "up" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= costcoOrder.length) return;
    const next = [...costcoOrder];
    [next[from], next[to]] = [next[to]!, next[from]!];
    costcoOrder = next;
}

function storeFixture(
    chrome: ReturnType<typeof fixtureChrome>,
    over: { rename?: boolean } = {},
) {
    const section = (id: string, name: string, other = false) => ({
        id,
        householdId: H,
        storeId: "s-costco",
        name,
        sortOrder: 0,
        hidden: false,
        isOther: other,
    });
    return renderSettingsStoreV2Page({
        chrome: chrome as never,
        store: { id: "s-costco", householdId: H, name: "Costco", sortOrder: 0 },
        sections: [
            ...costcoOrder.map((id) =>
                section(id, COSTCO_SECTIONS.find(([key]) => key === id)![1]),
            ),
            section("sec-other", "Other", true),
        ],
        sectionLineCounts: new Map([["sec-meat", 1]]),
        lineCount: 0,
        rules: [],
        moveTarget: null,
        canManage: true,
        ...over,
    } as never);
}

function householdPage(chrome: ReturnType<typeof fixtureChrome>) {
    return renderSettingsHouseholdV2Page({
        chrome,
        householdName: "The Flow household",
        members: [ME, SAM, RILEY],
        storeCount: 0,
        location: null,
        householdTimezone: null,
        effectiveTimezone: "UTC",
        restock: {
            enabled: false,
            weekday: 6,
            time: "07:00",
            lastRunOn: null,
        },
        unverifiedRecipeExpiryDays: null,
        isOwner: true,
        canManage: true,
        canInvite: true,
        viewerUserId: ME.userId,
        socialReaders: { tiktok: true, facebook: false },
        sharedLinks: FIXTURE_LINKS,
        duplicatePairs: [],
        refCounts: new Map(),
    } as never);
}

async function pages(
    theme: "light" | "dark",
    unread: boolean,
): Promise<Record<string, string>> {
    const chrome = fixtureChrome(theme, unread);
    return {
        nutrition: renderTodayV2Page(
            buildPreviewTodayPageData(chrome as never, "2026-11-10"),
        ),
        fridge: renderKitchenFridgeV2Page(
            buildPreviewKitchenFridgeView(chrome as never, "2026-11-10"),
        ),
        grocery: renderKitchenGroceriesV2Page(
            buildPreviewKitchenGroceriesView(chrome as never),
        ),
        recipes: renderRecipesListV2Page({
            chrome,
            query: "",
            filter: "",
            totalCount: 0,
            cards: [],
        } as never),
        trends: previewTrendsPage(chrome),
        settings: renderSettingsHomeV2Page({
            chrome: chrome as never,
            displayName: "Ethan Flow",
            email: "ethan@example.com",
        }),
        "settings-account": renderSettingsAccountV2Page({
            chrome: chrome as never,
            backHref: "/kitchen/fridge",
            displayName: "Ethan Flow",
            email: "ethan@example.com",
            timezone: "America/Los_Angeles",
        }),
        "settings-timezone": renderSettingsTimezoneV2Page({
            chrome: chrome as never,
            backHref: "/kitchen/fridge",
            timezone: "America/Los_Angeles",
            now: new Date("2026-11-10T12:00:00Z"),
        }),
        help: renderSettingsHelpV2Page({ chrome: chrome as never }),
        "dev-gallery-v2": renderDevGalleryV2Page(chrome as never),
        household: householdPage(chrome),
        "household-timezone": renderSettingsTimezoneV2Page({
            chrome: chrome as never,
            household: true,
            backHref: "/settings/household",
            timezone: "",
            now: new Date("2026-11-10T12:00:00Z"),
        }),
        "household-member": renderSettingsMemberV2Page({
            chrome: chrome as never,
            member: SAM as never,
            viewer: ME as never,
            todayHref: `/?member=${SAM.userId}`,
            manage: { role: true, transfer: true, remove: true },
            lastSeen: new Date("2026-11-10T09:00:00Z"),
            now: new Date("2026-11-10T12:00:00Z"),
            timezone: "UTC",
        }),
        "household-invites": renderHouseholdInvitesPage({
            chrome: chrome as never,
            backHref: "/",
            member: ME as never,
            invites: [
                {
                    id: "i-active",
                    householdId: H,
                    createdBy: ME.userId,
                    createdAt: "2026-11-09T12:00:00Z",
                    expiresAt: "2026-11-16T12:00:00Z",
                    usedAt: null,
                    usedBy: null,
                },
            ],
            now: new Date("2026-11-10T12:00:00Z"),
        }),
        "household-token": renderHouseholdTokenPage({
            chrome: chrome as never,
            token: FIXTURE_HOUSEHOLD_TOKEN,
        }),
        "household-restock": renderSettingsRestockV2Page({
            chrome: chrome as never,
            restock: FIXTURE_RESTOCK,
            canManage: true,
        }),
        "household-stores": storesFixture(chrome),
        "household-stores-reorder": storesFixture(chrome, { reorder: true }),
        "household-store": storeFixture(chrome),
        "household-store-rename": storeFixture(chrome, { rename: true }),
        "household-readers": renderSettingsReadersV2Page({
            chrome: chrome as never,
            socialReaders: { tiktok: true, facebook: false },
            blockedCount: 3,
            isOwner: true,
            canManage: true,
        }),
        "household-readers-terms": renderSettingsReadersV2Page({
            chrome: chrome as never,
            socialReaders: { tiktok: true, facebook: false },
            blockedCount: 3,
            isOwner: true,
            canManage: true,
            confirmReader: "facebook",
        }),
        "household-shared-links": renderSharedLinksPage({
            chrome: chrome as never,
            links: FIXTURE_LINKS,
            timezone: "America/Los_Angeles",
            now: new Date("2026-11-10T12:00:00Z"),
        }),
        notifications: notificationsPage(chrome),
        "settings-notifications": renderSettingsNotificationsV2Page({
            chrome: chrome as never,
            prefs: [],
        }),
        "create-household": createHouseholdFormHtml(undefined, theme),
        forbidden: forbiddenDashboardHtml(theme),
    };
}

// Warm the asset hashes before writing pages: renderAppShell stamps
// /app.css?v= and /app.js?v= once the bundles exist. If the page the browser
// loaded omitted those queries, Turbo treats a later response that carries
// them as a tracked-element mismatch and full-reloads.
await getAppCss();
await getAppJs();
await getAppV2Css();
await getAppV2Js();

// Two renders of every page: with the bell's dot (something unread) and
// without it (the inbox was opened), as the server answers before and after.
for (const theme of ["light", "dark"] as const) {
    for (const unread of [true, false]) {
        for (const [name, html] of Object.entries(await pages(theme, unread))) {
            await Bun.write(
                `${OUT}/${name}-${theme}${unread ? "" : "-read"}.html`,
                html,
            );
        }
    }
}

const ROUTE_BASE: Record<string, string> = {
    "/": "nutrition",
    "/kitchen/fridge": "fridge",
    "/kitchen/groceries": "grocery",
    "/recipes": "recipes",
    "/trends": "trends",
    "/settings": "settings",
    "/settings/account": "settings-account",
    "/settings/account/timezone": "settings-timezone",
    "/settings/help": "help",
    "/dev/gallery-v2": "dev-gallery-v2",
    "/settings/household": "household",
    "/settings/household/timezone": "household-timezone",
    [`/settings/household/members/${SAM.userId}`]: "household-member",
    "/settings/household/invites": "household-invites",
    "/settings/household/restock": "household-restock",
    "/settings/household/stores": "household-stores",
    "/settings/household/stores?reorder=1": "household-stores-reorder",
    "/settings/household/stores/s-costco": "household-store",
    "/settings/household/stores/s-costco?rename=1": "household-store-rename",
    "/settings/household/readers": "household-readers",
    "/settings/household/readers?turn_on=facebook": "household-readers-terms",
    "/settings/household/shared-links": "household-shared-links",
    "/notifications": "notifications",
    "/settings/notifications": "settings-notifications",
    "/create-household": "create-household",
};

/** Saved appearance from Settings › Account (null = system). */
let accountTheme: "light" | "dark" | null = "dark";

function themeFileSuffix(): "light" | "dark" {
    return accountTheme ?? "light";
}

/** The bell's dot is on until the inbox is opened, as on the server, where
 * opening it marks what it shows as read. */
let inboxUnread = true;

function routeHtmlFile(pathname: string): string {
    const base = ROUTE_BASE[pathname] || "fridge";
    if (pathname === "/notifications") inboxUnread = false;
    return `${base}-${themeFileSuffix()}${inboxUnread ? "" : "-read"}.html`;
}

function applyAccountTheme(html: string): string {
    if (accountTheme === "light" || accountTheme === "dark") return html;
    // System follows the OS. The light render stamps data-theme on <html>;
    // the stamp has to come off or the page stays light.
    return html
        .replace(/\sdata-theme="(light|dark)"/g, "")
        .replace(
            /<meta name="foodable-theme" content="[^"]+" \/>/,
            '<meta name="foodable-theme" content="system" />',
        );
}

let stallMs = 0;
let postMode = "ok";
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
        /<main class="app-main native( fd-main)?">/,
        (open) => `${open}<p id="p8-rev" data-rev="${n}" hidden></p>`,
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

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;
        const legacyTarget = legacyRedirectTarget(path + url.search);
        if (legacyTarget) {
            const status =
                req.method === "GET" || req.method === "HEAD" ? 301 : 308;
            return Response.redirect(legacyTarget, status);
        }
        if (
            path === "/settings/household/rotate-token" &&
            req.method === "GET"
        ) {
            // Like the route: the token is not kept, so a refresh or Back
            // to its page goes to Household.
            return new Response(null, {
                status: 303,
                headers: { Location: "/settings/household" },
            });
        }
        if (path === "/__stats") {
            return Response.json({
                gets,
                posts,
                searchHits,
                approveCount,
                stallMs,
                postMode,
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
            if (url.searchParams.has("loginpath"))
                loginPath = url.searchParams.get("loginpath") || "";
            if (url.searchParams.has("delay"))
                postDelay = Number(url.searchParams.get("delay"));
            if (url.searchParams.has("unread"))
                inboxUnread = url.searchParams.get("unread") !== "0";
            if (url.searchParams.get("reset") === "posts") posts.length = 0;
            if (url.searchParams.get("reset") === "sections") {
                costcoOrder = COSTCO_SECTIONS.map(([id]) => id);
            }
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
                loginPath,
                postDelay,
                sessionMode,
                accountTheme,
                inboxUnread,
            });
        }
        if (
            path === "/app.css" ||
            path === "/app.js" ||
            path === "/app-v2.css" ||
            path === "/app-v2.js"
        ) {
            const css = path.endsWith(".css");
            const v2 = path.startsWith("/app-v2.");
            const widgets = await import("../src/widgets.js");
            const body = v2
                ? css
                    ? await getAppV2Css()
                    : await getAppV2Js()
                : css
                  ? await getAppCss()
                  : await getAppJs();
            const href = v2
                ? css
                    ? widgets.appV2StylesheetHref()
                    : widgets.appV2ScriptHref()
                : css
                  ? widgets.appStylesheetHref()
                  : widgets.appScriptHref();
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
            if (path === "/settings/household/stores/s-costco/sections/order") {
                // Like the route: only a section's ⋯ posts a bare move, and it
                // comes back to the store page with `focus=<section id>`.
                const move = entries.find(([k]) => k === "move")?.[1] ?? "";
                moveCostcoSection(move);
                const key = `/settings/household/stores/s-costco?focus=${encodeURIComponent(move.slice(0, move.lastIndexOf(":")))}`;
                const html = stamp(
                    applyAccountTheme(
                        storeFixture(
                            fixtureChrome(themeFileSuffix(), inboxUnread),
                        ),
                    ),
                    key,
                );
                pending.set(key, { html, status: 200 });
                return new Response(null, {
                    status: 303,
                    headers: { Location: key },
                });
            }
            // The Display control on Settings home saves
            // the appearance, as the real route does; the saved theme is what
            // the next page renders.
            if (path === "/settings/display") {
                const picked = entries.find(([k]) => k === "theme")?.[1];
                accountTheme =
                    picked === "light" || picked === "dark" ? picked : null;
            }
            if (path === "/settings/household/rotate-token") {
                // Like the route: a 200 page with the token, never cached.
                const html = applyAccountTheme(
                    await fileHtml(
                        `household-token-${themeFileSuffix()}${inboxUnread ? "" : "-read"}.html`,
                        path,
                    ),
                );
                return new Response(html, {
                    headers: {
                        "content-type": "text/html; charset=utf-8",
                        "cache-control": "no-store",
                    },
                });
            }
            if (postDelay) await sleep(postDelay);
            const referer =
                req.headers.get("referer") || `http://127.0.0.1:${PORT}/`;
            const dest = new URL(referer);
            let destKey = dest.pathname + dest.search;
            if (path === "/settings/display") {
                // Like the route: the control on Settings comes back to it.
                destKey = "/settings";
            }
            if (path === "/settings/household/timezone") {
                // The household's time zone page comes back to Household.
                destKey = "/settings/household";
            }
            if (
                path === "/settings" &&
                entries.find(([k]) => k === "return")?.[1] ===
                    "/settings/account"
            ) {
                // The time zone page and the name sheet come back to Account.
                destKey = "/settings/account";
            }
            // A page the query changes (reorder mode) has its own entry.
            const file = routeHtmlFile(
                ROUTE_BASE[destKey] ? destKey : destKey.split("?")[0]!,
            );
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
        // A page the query changes (the readers terms) has its own entry.
        const routeKey = ROUTE_BASE[path + url.search]
            ? path + url.search
            : path;
        if (ROUTE_BASE[routeKey]) {
            if (sessionMode === "guest") {
                const login = await loginDocument();
                return new Response(login, {
                    status: 200,
                    headers: { "content-type": "text/html; charset=utf-8" },
                });
            }
            if (stallMs) await sleep(stallMs);
            const html = applyAccountTheme(
                routeKey === "/settings/household/stores/s-costco"
                    ? stamp(
                          storeFixture(
                              fixtureChrome(themeFileSuffix(), inboxUnread),
                          ),
                          path + url.search,
                      )
                    : await fileHtml(
                          routeHtmlFile(routeKey),
                          path + url.search,
                      ),
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
