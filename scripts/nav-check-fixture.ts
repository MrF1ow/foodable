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
    type GroceryLineView,
    type GroceryStoreView,
    type KitchenGroceriesLineMeta,
    type KitchenGroceriesV2View,
} from "../src/web/pages/v2/kitchen-groceries.js";
import {
    buildPreviewKitchenUsualsView,
    kitchenUsualRowMeta,
    renderKitchenUsualsV2Page,
    type KitchenUsualsV2View,
} from "../src/web/pages/v2/kitchen-usuals.js";
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
import { buildWeekPlanView } from "../src/web/pages/v2/recipes-plan.js";
import { renderCookPreviewRegion } from "../src/web/pages/v2/recipes-page-cook.js";
import {
    renderRecipeDetailV2Page,
    RECIPE_NOT_IN_STOCK_ID,
    type RecipeDetailV2View,
} from "../src/web/pages/v2/recipes-page.js";
import { renderRecipeCompareV2Page } from "../src/web/pages/v2/recipes-page-compare.js";
import type { VersionsCompare } from "../src/domain/recipe-variants.js";
import { renderShareCreatedPage } from "../src/web/pages/v2/share-sheet.js";
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
import { newFood, usualProductRows } from "../src/domain/foods.js";
import {
    buildPreviewProductPageView,
    renderProductV2Page,
} from "../src/web/pages/v2/product.js";
import { SCORE_PRESETS } from "../src/domain/product-score.js";
import { renderSettingsGoalsV2Page } from "../src/web/pages/v2/settings-goals.js";
import { goalsDraftFrom } from "../src/web/pages/v2/settings-goals-form.js";
import { renderSettingsSavedV2Page } from "../src/web/pages/v2/settings-saved.js";
import { renderSettingsAiV2Page } from "../src/web/pages/v2/settings-ai.js";
import { renderSettingsNutrientsV2Page } from "../src/web/pages/v2/settings-nutrients.js";
import { renderSettingsUnitsV2Page } from "../src/web/pages/v2/settings-units.js";
import { renderSettingsScoreV2Page } from "../src/web/pages/v2/settings-score.js";
import { legacyRedirectTarget } from "../src/web/route-map.js";
import { renderAppShell, viewerChromeFromProfile } from "../src/web/shell.js";

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
        [
            { date: "2026-10-20", weight_g: 79_400 },
            { date: "2026-11-01", weight_g: 79_000 },
        ],
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

/** The named goals the autosave case edits, with one day of its own. */
const FIXTURE_GOALS: NutritionGoals = {
    ...FIXTURE_TRENDS_GOALS,
    daily_alcohol_g: 28,
    goal_name: "Recomp",
    goal_note: "maintenance minus 5%",
    goals_set_on: "2026-10-02",
};

function goalsFixture(
    chrome: ReturnType<typeof fixtureChrome>,
    over: { refused?: boolean } = {},
) {
    return renderSettingsGoalsV2Page({
        chrome: chrome as never,
        goals: FIXTURE_GOALS,
        today: "2026-11-10",
        weightUnit: "kg",
        alcohol: "us",
        days: [
            {
                user_id: ME.userId,
                date: "2026-11-14",
                daily_calories: 1800,
                daily_protein_g: 170,
                daily_carbs_g: null,
                daily_fat_g: null,
                daily_fiber_g: null,
                daily_sugar_g: null,
                daily_alcohol_g: null,
                daily_caffeine_mg: null,
                daily_water_ml: null,
                updated_at: "2026-11-01T00:00:00.000Z",
            },
        ],
        // A refused save: what the route answers with a 422.
        ...(over.refused
            ? {
                  draft: {
                      ...goalsDraftFrom(FIXTURE_GOALS, "us"),
                      daily_calories: "30000",
                  },
                  error: "Calories must be at most 20000.",
                  invalid: ["daily_calories" as const],
              }
            : {}),
    });
}

function savedFixture(chrome: ReturnType<typeof fixtureChrome>) {
    const food = (name: string, id: string, allergens: string[] = []) => ({
        ...newFood({
            householdId: H,
            kind: "food",
            name,
            defaultUnit: "each",
            gramsPerEach: 50,
            calories: 155,
            allergens,
        }),
        id,
        aliases: [] as string[],
    });
    return renderSettingsSavedV2Page({
        chrome: chrome as never,
        foods: [
            food("Eggs", "f-eggs", ["egg"]),
            food("Milk", "f-milk", ["milk"]),
        ],
        recipes: [],
        duplicateCount: 2,
        searchQuery: "",
    });
}

/** Four connected apps (the first with a name and id the Disconnect case posts), two undoable changes. */
function aiFixture(
    chrome: ReturnType<typeof fixtureChrome>,
    opts: { appFilter?: string } = {},
) {
    const at = (iso: string) => new Date(iso);
    return renderSettingsAiV2Page({
        chrome: chrome as never,
        appFilter: opts.appFilter,
        connections: [
            {
                clientId: "7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f",
                clientName: "Claude",
                firstConnectedAt: at("2026-10-03T12:00:00.000Z"),
                lastUsedAt: at("2026-11-10T08:00:00.000Z"),
            },
            {
                clientId: "2b1c0d9e-8f7a-4b6c-8d5e-4f3a2b1c0d9e",
                clientName: "Grok CLI",
                firstConnectedAt: at("2026-11-01T08:00:00.000Z"),
                lastUsedAt: at("2026-11-08T08:00:00.000Z"),
            },
            {
                clientId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
                clientName: "ChatGPT",
                firstConnectedAt: at("2026-11-09T18:30:00.000Z"),
                lastUsedAt: null,
            },
            {
                clientId: null,
                clientName: null,
                firstConnectedAt: at("2026-09-14T09:00:00.000Z"),
                lastUsedAt: at("2026-10-20T09:00:00.000Z"),
            },
        ],
        destructive: { allowed: true, canChange: true },
        personal: { canDelete: true, householdOffBy: null },
        showCards: true,
        activity: [
            {
                id: "a1000000-0000-4000-8000-000000000001",
                summary: "Cleared 20 grocery lines",
                connection: "Claude",
                memberId: "0b6c4d2e-7a1f-4c3b-9e5d-2f8a6b1c3d4e",
                actor: { kind: "viewer" },
                when: "2 hours ago",
                createdAt: "2026-11-10T13:04:00.000Z",
                state: { kind: "undo" },
            },
            {
                id: "a1000000-0000-4000-8000-000000000002",
                summary: "Logged Chicken rice bowl",
                connection: "Grok CLI",
                memberId: "0b6c4d2e-7a1f-4c3b-9e5d-2f8a6b1c3d4e",
                actor: { kind: "viewer" },
                when: "2 days ago",
                createdAt: "2026-11-08T18:30:00.000Z",
                state: { kind: "undo" },
            },
        ],
        now: new Date("2026-11-10T15:00:00.000Z"),
        timezone: "UTC",
        mcpUrl: "https://food.flow.home/mcp",
    });
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

/** This week on Today: a one-off dinner and a day of a weekly repeat. Moved,
 * the one-off sits on the day after the repeat's day, so a save re-orders the
 * two rows and each row ends up under the other's sheet. */
function fixtureWeekPlan(moved = false, three = false) {
    const plan = (
        id: string,
        recipeId: string,
        date: string,
        ruleId?: string,
    ) => ({
        id,
        householdId: "hh",
        recipeId,
        date,
        slot: "dinner" as const,
        servings: 2,
        createdBy: null,
        createdAt: "2026-11-09T10:00:00.000Z",
        ...(ruleId ? { ruleId } : {}),
    });
    const recipe = (id: string, name: string) => ({
        id,
        name,
        yieldPortions: 2,
        ingredients: [
            {
                displayName: "Kidney beans",
                foodId: "f-beans",
                quantity: { amount: 400, unit: "g" },
            },
        ],
    });
    return buildWeekPlanView({
        today: "2026-11-10",
        plans: [
            plan("pl1", "r-salmon", moved ? "2026-11-12" : "2026-11-10"),
            plan("rule:rl1:2026-11-11", "r-chili", "2026-11-11", "rl1"),
            ...(three ? [plan("pl3", "r-tacos", "2026-11-12")] : []),
        ],
        recipes: [
            recipe("r-salmon", "Salmon, rice & spinach"),
            recipe("r-chili", "Beef chili"),
            recipe("r-tacos", "Chicken thigh tacos"),
        ],
        stock: [],
        foodsById: new Map(),
    });
}

/**
 * Kitchen › Fridge with enough in it to drive: three places, a low usual, an
 * expired and an expiring item, scores, a use-soon recipe and the Add sheet's
 * usuals. The day is 2026-11-10.
 */
function fixtureFridgeView(chrome: unknown) {
    const row = (
        id: string,
        displayName: string,
        locationId: string,
        amount: number,
        unit: string,
        expiresOn: string | null,
        foodId: string,
    ) => ({
        id,
        householdId: H,
        locationId,
        kind: "food" as const,
        displayName,
        quantity: { amount, unit },
        foodId,
        expiresOn,
    });
    const items = [
        row(
            "it-cheese",
            "Cheese",
            "l-fridge",
            200,
            "g",
            "2026-11-23",
            "f-cheese",
        ),
        row("it-eggs", "Eggs", "l-fridge", 2, "each", "2026-11-11", "f-eggs"),
        row(
            "it-milk",
            "Expired milk",
            "l-fridge",
            1,
            "l",
            "2026-11-09",
            "f-milk",
        ),
        row("it-lime", "Lime", "l-fridge", 3, "each", "2026-11-23", "f-lime"),
        row(
            "it-cremini",
            "Cremini mushrooms",
            "l-fridge",
            250,
            "g",
            "2026-11-09",
            "f-cremini",
        ),
        row(
            "it-towels",
            "Paper towels",
            "l-pantry",
            3,
            "roll",
            null,
            "f-towels",
        ),
    ];
    const uses = ["it-cremini", "it-milk"].map((id) => ({
        item: {
            id,
            displayName: items.find((i) => i.id === id)!.displayName,
            expiresOn: "2026-11-09",
        },
        recipes: [
            {
                recipeId: "r-salmon-rice",
                name: "Salmon & rice",
                incomplete: false,
            },
        ],
    }));
    return buildPreviewKitchenFridgeView(chrome as never, "2026-11-10", {
        locations: [
            { id: "l-fridge", householdId: H, name: "Fridge", sortOrder: 0 },
            { id: "l-freezer", householdId: H, name: "Freezer", sortOrder: 1 },
            { id: "l-pantry", householdId: H, name: "Pantry", sortOrder: 2 },
        ],
        items,
        lowStock: new Map([["f-eggs", "6"]]),
        scores: new Map([
            ["f-cheese", 52],
            ["f-eggs", 74],
        ]),
        useSoonUses: uses,
        usuals: [
            {
                foodId: "p-milk",
                kind: "food",
                name: "Milk",
                subtitle: "Kirkland 2% · 1 gal",
                amount: 1,
                unit: "gal",
            },
            {
                foodId: "f-eggs",
                kind: "food",
                name: "Eggs",
                subtitle: "Vital Farms Large · 24",
                amount: 24,
                unit: "each",
            },
            {
                foodId: "f-towels",
                kind: "supply",
                name: "Paper towels",
                subtitle: "1 each",
                amount: 1,
                unit: "each",
            },
        ],
    });
}

/**
 * The grocery list as the design draws it: two stores, a checked egg and
 * spinach (so the dock and the put away sheet show), usuals to add, and a
 * product choice on the eggs. `overrides` makes the other states (a store
 * filtered to, Share off, a line's sheet open).
 */
function fixtureGroceriesView(
    chrome: unknown,
    overrides: Partial<KitchenGroceriesV2View> = {},
) {
    const line = (
        id: string,
        displayName: string,
        storeId: string,
        sectionId: string,
        amount: number,
        unit: string,
        extra: Partial<GroceryLineView> = {},
    ): GroceryLineView => ({
        id,
        householdId: H,
        storeId,
        sectionId,
        kind: "food",
        displayName,
        quantity: { amount, unit },
        foodId: `f-${id}`,
        checked: false,
        source: "manual",
        sourceFridgeItemId: null,
        note: null,
        alreadyHave: null,
        lastLocationId: "l-fridge",
        ...extra,
    });
    const section = (
        id: string,
        storeId: string,
        name: string,
        sortOrder: number,
        lines: GroceryLineView[],
    ) => ({
        id,
        householdId: H,
        storeId,
        name,
        sortOrder,
        hidden: false,
        isOther: false,
        lines,
    });
    const costco: GroceryStoreView = {
        id: "s-costco",
        householdId: H,
        name: "Costco",
        sortOrder: 0,
        rules: [],
        sections: [
            section("sec-dairy", "s-costco", "Dairy & eggs", 0, [
                line(
                    "gl-milk",
                    "Kirkland 2% milk",
                    "s-costco",
                    "sec-dairy",
                    1,
                    "gal",
                    {
                        note: null,
                    },
                ),
                line(
                    "gl-eggs",
                    "Vital Farms large eggs",
                    "s-costco",
                    "sec-dairy",
                    24,
                    "each",
                    {
                        checked: true,
                        putAwayProducts: [
                            { id: "f-eggs", label: "Eggs" },
                            { id: "p-eggs", label: "Vital Farms large eggs" },
                        ],
                        putAwayProductId: "p-eggs",
                    },
                ),
            ]),
            section("sec-produce", "s-costco", "Produce", 1, [
                line(
                    "gl-spinach",
                    "Spinach",
                    "s-costco",
                    "sec-produce",
                    300,
                    "g",
                    {
                        checked: true,
                    },
                ),
            ]),
            section("sec-meat", "s-costco", "Meat", 2, [
                line(
                    "gl-chicken",
                    "Kirkland chicken thighs",
                    "s-costco",
                    "sec-meat",
                    4,
                    "lb",
                ),
            ]),
        ],
    };
    const tj: GroceryStoreView = {
        id: "s-tj",
        householdId: H,
        name: "Trader Joe's",
        sortOrder: 1,
        rules: [],
        sections: [
            section("sec-pantry", "s-tj", "Pantry", 0, [
                line("gl-rice", "Jasmine rice", "s-tj", "sec-pantry", 5, "lb"),
                line(
                    "gl-oil",
                    "California Olive Ranch",
                    "s-tj",
                    "sec-pantry",
                    1,
                    "bottle",
                ),
            ]),
        ],
    };
    const meta = (
        plainFoodName: string | null,
        isUsual: boolean,
        storeName: string,
        sectionName: string,
        extra: Partial<KitchenGroceriesLineMeta> = {},
    ): KitchenGroceriesLineMeta => ({
        plainFoodName,
        isUsual,
        allergenWarning: null,
        storeName,
        sectionName,
        ...extra,
    });
    const lineMeta = new Map<string, KitchenGroceriesLineMeta>([
        ["gl-milk", meta("Milk", true, "Costco", "Dairy & eggs")],
        [
            "gl-eggs",
            meta("Eggs", true, "Costco", "Dairy & eggs", { productScore: 74 }),
        ],
        ["gl-spinach", meta(null, false, "Costco", "Produce")],
        [
            "gl-chicken",
            meta("Chicken thighs", true, "Costco", "Meat", {
                allergenWarning: "Contains poultry — Sam.",
            }),
        ],
        ["gl-rice", meta("Any brand", false, "Trader Joe's", "Pantry")],
        ["gl-oil", meta("Olive oil", true, "Trader Joe's", "Pantry")],
    ]);
    const stores = overrides.stores ?? [costco, tj];
    const lines = stores.flatMap((st) =>
        st.sections.flatMap((sec) => sec.lines),
    );
    return buildPreviewKitchenGroceriesView(chrome as never, {
        stores,
        lineMeta,
        checkedLines: lines.filter((l) => l.checked),
        openLineCount: lines.filter((l) => !l.checked).length,
        locations: [
            { id: "l-fridge", name: "Fridge" },
            { id: "l-freezer", name: "Freezer" },
            { id: "l-pantry", name: "Pantry" },
        ],
        usuals: [
            {
                foodId: "p-eggs",
                kind: "food",
                name: "Eggs",
                subtitle: "Vital Farms · 12 each",
                amount: 12,
                unit: "each",
                lowBelow: "6",
                lowLeft: "3 left",
            },
            {
                foodId: "p-milk",
                kind: "food",
                name: "Milk 2%",
                subtitle: "Kirkland · 1 gal",
                amount: 1,
                unit: "gal",
                storeName: "Costco",
            },
            {
                foodId: "f-towels",
                kind: "supply",
                name: "Paper towels",
                subtitle: "1 each",
                amount: 1,
                unit: "each",
            },
        ],
        shareEnabled: true,
        ...overrides,
    });
}

/**
 * Kitchen › Usuals with a catalog to drive: Milk with two products, Eggs
 * running low, Bananas with no usual product and Olive oil paused, over two
 * stores, and three foods that are not usuals yet for the Add a usual sheet.
 */
const USUAL_STORES = [
    { id: "s-costco", householdId: H, name: "Costco", sortOrder: 0 },
    { id: "s-tj", householdId: H, name: "Trader Joe's", sortOrder: 1 },
];

function fixtureUsualsCatalog() {
    const make = (id: string, over: Parameters<typeof newFood>[0]) => ({
        ...newFood(over),
        id,
    });
    const usualOf = (
        id: string,
        name: string,
        product: string | null,
        store: string,
        amount: { amount: number; unit: string },
        plain: Partial<Parameters<typeof newFood>[0]> = {},
    ) => [
        make(id, {
            householdId: H,
            kind: "food",
            name,
            ...(product
                ? { usualProductId: `${id}-p` }
                : { usualAddedAt: "2026-10-01" }),
            usualStoreId: store,
            usualAmount: amount,
            ...plain,
        }),
        ...(product
            ? [
                  make(`${id}-p`, {
                      householdId: H,
                      kind: "food",
                      name: product,
                      genericFoodId: id,
                      usualStoreId: store,
                      usualAmount: amount,
                  }),
              ]
            : []),
    ];
    const catalog = [
        ...usualOf(
            "u-milk",
            "Milk",
            "Kirkland 2% milk",
            "s-costco",
            { amount: 64, unit: "fl oz" },
            { restockSchedule: "weekly" },
        ),
        make("u-milk-q", {
            householdId: H,
            kind: "food",
            name: "Organic Valley whole milk",
            genericFoodId: "u-milk",
        }),
        ...usualOf(
            "u-eggs",
            "Eggs",
            "Vital Farms large",
            "s-costco",
            { amount: 24, unit: "each" },
            { restockSchedule: "weekly", restockWhenLow: true },
        ),
        ...usualOf(
            "u-bananas",
            "Bananas",
            null,
            "s-tj",
            { amount: 6, unit: "each" },
            { restockWhenLow: true, restockLowLevel: 2 },
        ),
        ...usualOf(
            "u-oil",
            "Olive oil",
            "California Olive Ranch",
            "s-costco",
            { amount: 1, unit: "each" },
            { restockSchedule: "monthly", restockPaused: true },
        ),
        make("f-butter", { householdId: H, kind: "food", name: "Butter" }),
        make("f-bread", {
            householdId: H,
            kind: "food",
            name: "Sourdough bread",
        }),
        make("f-spinach", { householdId: H, kind: "food", name: "Spinach" }),
    ];
    return { catalog, usual: usualProductRows({ foods: catalog }) };
}

function fixtureUsualsView(
    chrome: unknown,
    overrides: Partial<KitchenUsualsV2View> = {},
): KitchenUsualsV2View {
    const { catalog, usual } = fixtureUsualsCatalog();
    const storesById = new Map(USUAL_STORES.map((row) => [row.id, row]));
    const foodsById = new Map(
        catalog.map((row) => [
            row.id,
            { id: row.id, genericFoodId: row.genericFoodId },
        ]),
    );
    const rowMeta = new Map(
        usual.rows.map((row) => [
            row.food.id,
            kitchenUsualRowMeta(row, {
                storesById,
                groceryLines: [],
                foodsById,
                lowFoodIds: new Set(["u-eggs"]),
            }),
        ]),
    );
    return buildPreviewKitchenUsualsView({
        chrome: chrome as never,
        rows: usual.rows,
        stores: USUAL_STORES,
        rowMeta,
        addable: usual.addable,
        restockDay: "Sundays",
        openGroceriesCount: 3,
        ...overrides,
    });
}

/** The saved recipes the Recipes list pages show: one cookable, one short of two foods. */
function fixtureRecipeCards() {
    const macros = {
        calories: 320,
        protein_g: 26,
        carbs_g: 0,
        fat_g: 11,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        incomplete: false,
        incompleteReasons: [] as string[],
        gaps: [],
    };
    const card = (
        id: string,
        name: string,
        missing: string[],
        favourite = false,
    ) => ({
        recipe: {
            id,
            householdId: "hh",
            name,
            yieldPortions: 4,
            prepMinutes: 10,
            cookMinutes: 20,
        } as never,
        flags: {
            cookable: missing.length === 0,
            highProtein: id === "r-alfredo",
            quick: true,
            missingCount: missing.length,
            hasIngredients: true,
        },
        macrosPerPortion: macros,
        missingNames: missing,
        favourite,
    });
    return [
        card("r-alfredo", "Chicken alfredo", [], true),
        card("r-chili", "Beef chili", ["Kidney beans", "Cumin"]),
        card("r-tacos", "Chicken thigh tacos", []),
    ];
}

function fixtureRecipesList(
    chrome: unknown,
    extra: Partial<Parameters<typeof renderRecipesListV2Page>[0]> = {},
) {
    return renderRecipesListV2Page({
        chrome: chrome as never,
        query: "",
        filters: [],
        totalCount: 3,
        cards: fixtureRecipeCards(),
        week: fixtureWeekPlan(),
        sharedImportEnabled: true,
        ...extra,
    });
}

const FIXTURE_COOK_PREVIEW = {
    totalPortions: 4,
    lines: [
        {
            foodId: "f-fettuccine",
            displayName: "Fettuccine",
            fromItemId: "fi-fettuccine",
            unit: "oz",
            before: 16,
            after: 8,
        },
        {
            foodId: "f-chicken",
            displayName: "Chicken breast",
            fromItemId: "fi-chicken",
            unit: "lb",
            before: 2,
            after: 1,
        },
        {
            foodId: "f-parmesan",
            displayName: "Parmesan",
            fromItemId: "fi-parmesan",
            unit: "g",
            before: 200,
            after: 150,
        },
    ],
    movements: [],
    shortfalls: [
        {
            foodId: "f-cream",
            displayName: "Heavy cream",
            amount: 120,
            unit: "ml",
            unknownFactor: false,
        },
    ],
    unmeasured: [],
};

const FIXTURE_COOK_PLACES = new Map([
    ["fi-fettuccine", "Pantry"],
    ["fi-chicken", "Fridge"],
    ["fi-parmesan", "Fridge"],
]);

/** The household as the version pull-down lists it. */
const FIXTURE_PEOPLE = [
    { userId: "u-ethan", name: "Ethan" },
    { userId: "u-sarah", name: "Sarah" },
    { userId: "u-mia", name: "Mia" },
    { userId: "u-leo", name: "Leo" },
];

/**
 * Compare versions for the draft-named "Simple Pad See Ew" of the design:
 * Ethan has one change, Mia two and an added line, Sarah and Leo none.
 */
function fixtureComparePage(chrome: unknown): string {
    const oz = (amount: number) => ({ amount, unit: "oz" });
    const thighs = {
        ingredientId: "i-thighs",
        displayName: "Chicken thighs",
        base: oz(6),
    };
    const compare: VersionsCompare = {
        recipeId: "r-draft",
        base: [
            { ...thighs, foodId: "f-thighs", quantity: oz(6) },
            {
                ingredientId: "i-fish",
                displayName: "Fish sauce",
                foodId: "f-fish",
                quantity: { amount: 1, unit: "tbsp" },
            },
        ],
        versions: [
            {
                userId: "u-ethan",
                overrideCount: 1,
                differences: [
                    {
                        kind: "amount",
                        ref: "i-thighs",
                        rowKey: "o-ethan-thighs@2026-11-10",
                        ...thighs,
                        version: oz(8),
                    },
                ],
            },
            {
                userId: "u-mia",
                overrideCount: 3,
                differences: [
                    {
                        kind: "amount",
                        ref: "i-thighs",
                        rowKey: "o-mia-thighs@2026-11-10",
                        ...thighs,
                        version: oz(10),
                    },
                    {
                        kind: "removed",
                        ref: "i-fish",
                        rowKey: "o-mia-fish@2026-11-10",
                        ingredientId: "i-fish",
                        displayName: "Fish sauce",
                        base: { amount: 1, unit: "tbsp" },
                    },
                    {
                        kind: "added",
                        ref: "o-mia-chili",
                        rowKey: "o-mia-chili@2026-11-10",
                        ingredientId: null,
                        displayName: "Chili flakes",
                        foodId: "f-chili",
                        version: { amount: 1, unit: "tsp" },
                    },
                ],
            },
        ],
        usingBase: ["u-sarah", "u-leo"],
    };
    return renderRecipeCompareV2Page({
        chrome: chrome as never,
        recipeId: "r-alfredo",
        recipeName: "Simple Pad See Ew",
        compare,
        people: FIXTURE_PEOPLE.map((p) => ({
            ...p,
            resetRowKeys:
                p.userId === "u-ethan"
                    ? ["o-ethan-thighs@2026-11-10"]
                    : p.userId === "u-mia"
                      ? [
                            "o-mia-thighs@2026-11-10",
                            "o-mia-fish@2026-11-10",
                            "o-mia-chili@2026-11-10",
                        ]
                      : undefined,
        })),
    });
}

/**
 * The recipe page: Chicken alfredo, a saved recipe with a cook that falls
 * short on cream, or Simple Pad See Ew, an import still a draft. Each takes a
 * sheet to open on load and `mcp-share-links` on or off.
 */
function fixtureRecipePage(
    chrome: unknown,
    opts: {
        open?: "plan" | "cook";
        share?: boolean;
        draft?: boolean;
        /** The draft is the importer's first landing after the import (`?imported=1`): the leave guard is on. */
        landing?: boolean;
        saved?: boolean;
        error?: string;
        /** Whose version is shown: Ethan's own (default), the base, or Mia's. */
        version?: "base" | "mia";
        /** A member sees the pull-down without Compare versions. */
        member?: boolean;
    } = {},
): string {
    const draft = opts.draft === true;
    const recipe = draft
        ? {
              id: "r-draft",
              householdId: "hh",
              creatorId: "u1",
              name: "Simple Pad See Ew",
              yieldPortions: 2,
              instructions: opts.saved
                  ? "Soak the noodles.\nSear the chicken."
                  : null,
              sourceUrl: "https://www.slowfoodmama.com/simple-pad-see-ew",
              tags: [],
              notes: null,
              prepMinutes: 15,
              cookMinutes: 10,
              verification: opts.saved ? "verified" : "unverified",
              updatedAt: "2026-11-10T00:00:00.000Z",
          }
        : {
              id: "r-alfredo",
              householdId: "hh",
              creatorId: "u1",
              name: "Chicken alfredo",
              yieldPortions: 4,
              instructions:
                  "Cook the fettuccine until al dente.\nSear the chicken six minutes a side, then slice.\nToss with garlic, add cream and parmesan.",
              sourceUrl: "https://www.seriouseats.com/chicken-alfredo",
              tags: [],
              notes: null,
              prepMinutes: 10,
              cookMinutes: 20,
              verification: "verified",
              updatedAt: "2026-11-10T00:00:00.000Z",
          };
    const ingredient = (
        id: string,
        foodId: string,
        displayName: string,
        amount: number,
        unit: string,
    ) => ({
        id,
        foodId,
        displayName,
        quantity: { amount, unit } as const,
        note: null,
    });
    const ingredients = draft
        ? [
              ingredient("i1", "f-noodles", "Wide rice noodles", 7, "oz"),
              ingredient("i2", "f-soy", "Dark soy sauce", 1, "tbsp"),
          ]
        : [
              ingredient("i1", "f-fettuccine", "Fettuccine", 8, "oz"),
              ingredient(
                  "i2",
                  "f-chicken",
                  "Chicken breast",
                  opts.version === "base" ? 6 : opts.version === "mia" ? 10 : 8,
                  "oz",
              ),
              ingredient("i3", "f-cream", "Heavy cream", 1, "cup"),
              ingredient("i4", "f-parmesan", "Parmesan", 50, "g"),
          ];
    const line = (id: string, name: string, amountLabel: string) => ({
        ingredientId: id,
        displayName: name,
        amountLabel,
        expiresOn: null,
    });
    const ingredientGroups = draft
        ? [
              {
                  placeId: "l-pantry",
                  placeName: "Pantry",
                  lines: [
                      line("i1", "Wide rice noodles", "7 oz"),
                      line("i2", "Dark soy sauce", "1 tbsp"),
                  ],
              },
          ]
        : [
              {
                  placeId: "l-pantry",
                  placeName: "Pantry",
                  lines: [line("i1", "Fettuccine", "8 oz")],
              },
              {
                  placeId: "l-fridge",
                  placeName: "Fridge",
                  lines: [
                      line(
                          "i2",
                          "Chicken breast",
                          opts.version === "base"
                              ? "6 oz"
                              : opts.version === "mia"
                                ? "10 oz"
                                : "8 oz",
                      ),
                      line("i4", "Parmesan", "50 g"),
                  ],
              },
              {
                  placeId: RECIPE_NOT_IN_STOCK_ID,
                  placeName: "Not in stock",
                  lines: [line("i3", "Heavy cream", "1 cup")],
              },
          ];
    const macros = {
        calories: draft && !opts.saved ? null : 690,
        protein_g: draft && !opts.saved ? null : 42,
        carbs_g: draft && !opts.saved ? null : 58,
        fat_g: draft && !opts.saved ? null : 31,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        incomplete: draft && !opts.saved,
    };
    const who = opts.version === "mia" ? "Mia's" : "Yours";
    const view: RecipeDetailV2View = {
        chrome: chrome as never,
        recipe: recipe as never,
        ingredients:
            draft || opts.version === "base"
                ? ingredients
                : ingredients.map((row) =>
                      row.id === "i2"
                          ? { ...row, versionNote: `${who} · base 6 oz` }
                          : row,
                  ),
        ingredientGroups,
        macrosPerPortion: macros,
        gapReasons: draft && !opts.saved ? ["Counts 1 of 11 ingredients"] : [],
        favourite: false,
        error: opts.error,
        ...(opts.share === false ? {} : { share: { open: false } }),
        ...(draft
            ? {}
            : {
                  versions: {
                      viewerId: "u-ethan",
                      viewing:
                          opts.version === "base"
                              ? "base"
                              : opts.version === "mia"
                                ? "u-mia"
                                : "u-ethan",
                      viewingName:
                          opts.version === "base"
                              ? "Base"
                              : opts.version === "mia"
                                ? "Mia"
                                : "Ethan",
                      changeCount:
                          opts.version === "base"
                              ? 0
                              : opts.version === "mia"
                                ? 2
                                : 1,
                      people: FIXTURE_PEOPLE,
                      canCompare: opts.member !== true,
                  },
              }),
    };
    if (draft && !opts.saved) {
        view.draft = {
            problems: ["Add the steps."],
            expiresOn: "2026-12-01",
            canSave: true,
            canDiscard: true,
            leaveGuard: opts.landing === true,
        };
    } else {
        view.cook = {
            recipeId: recipe.id,
            recipeName: recipe.name,
            servings: recipe.yieldPortions,
            yieldPortions: recipe.yieldPortions,
            preview: draft
                ? { ...FIXTURE_COOK_PREVIEW, shortfalls: [] }
                : FIXTURE_COOK_PREVIEW,
            slot: "dinner",
            viewerName: "Ethan",
            version:
                opts.version === "base"
                    ? undefined
                    : opts.version === "mia"
                      ? "u-mia"
                      : "u-ethan",
            places: FIXTURE_COOK_PLACES,
            submitKey: "fixture",
            open: opts.open === "cook",
        };
        view.plan = {
            recipeId: recipe.id,
            recipeName: recipe.name,
            yieldPortions: recipe.yieldPortions,
            today: "2026-11-10",
            date: "2026-11-10",
            slot: "dinner",
            servings: recipe.yieldPortions,
            open: opts.open === "plan",
        };
    }
    return renderRecipeDetailV2Page(view);
}

async function pages(
    theme: "light" | "dark",
    unread: boolean,
): Promise<Record<string, string>> {
    const chrome = fixtureChrome(theme, unread);
    return {
        nutrition: renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            plan: fixtureWeekPlan(),
        }),
        // `barcode-camera` off: the log sheet draws no Scan barcode tile, no
        // barcode button and no scan link.
        "nutrition-camera-off": renderTodayV2Page({
            ...buildPreviewTodayPageData(
                {
                    ...chrome,
                    flags: { ...chrome.flags, barcodeCamera: false },
                } as never,
                "2026-11-10",
            ),
            plan: fixtureWeekPlan(),
        }),
        "nutrition-plan-moved": renderTodayV2Page({
            ...buildPreviewTodayPageData(chrome as never, "2026-11-10"),
            plan: fixtureWeekPlan(true),
        }),
        // /foods/f-chicken: a product with a serving from its piece weight,
        // stock in the fridge and no score, built here so the page exists
        // without a preview run.
        "product-full": renderProductV2Page(
            buildPreviewProductPageView(
                chrome as never,
                {
                    ...newFood({
                        householdId: H,
                        kind: "food",
                        name: "Greek yogurt, plain 2%",
                        brand: "Fage",
                        calories: 59,
                        proteinG: 10,
                        carbsG: 4,
                        fatG: 0.4,
                        fiberG: 0,
                        sugarG: 4,
                        gramsPerEach: 170,
                    }),
                    id: "f-product-full",
                },
                {
                    barcodes: ["5201054017463"],
                    stock: [{ locationName: "Fridge", quantityLabel: "2" }],
                    score: null,
                },
            ),
        ),
        fridge: renderKitchenFridgeV2Page(fixtureFridgeView(chrome)),
        grocery: renderKitchenGroceriesV2Page(fixtureGroceriesView(chrome)),
        // The list filtered to one store, to both, and with Share off or a
        // line's sheet open on it.
        "grocery-costco": renderKitchenGroceriesV2Page(
            fixtureGroceriesView(chrome, { selectedStoreIds: ["s-costco"] }),
        ),
        "grocery-both": renderKitchenGroceriesV2Page(
            fixtureGroceriesView(chrome, {
                selectedStoreIds: ["s-costco", "s-tj"],
            }),
        ),
        "grocery-share-off": renderKitchenGroceriesV2Page(
            fixtureGroceriesView(chrome, { shareEnabled: false }),
        ),
        "grocery-line-open": renderKitchenGroceriesV2Page(
            fixtureGroceriesView(chrome, { openLineId: "gl-milk" }),
        ),
        // The Add sheet after "chicken egg" came back with a question.
        "grocery-did-you-mean": renderKitchenGroceriesV2Page(
            fixtureGroceriesView(chrome, {
                openAdd: true,
                didYouMean: {
                    modalId: "grocery-add-food-",
                    action: "/kitchen/groceries/lines",
                    view: {
                        name: "chicken egg",
                        heading: "Did you mean one of these?",
                        candidates: [
                            { foodId: "f-eggs", label: "Eggs" },
                            {
                                foodId: "p-eggs",
                                label: "Vital Farms large eggs",
                            },
                        ],
                        aliasLabel:
                            "Remember chicken egg as another name for the food you pick",
                        newFoodLabel: "Add chicken egg as a new food",
                        hiddenFields: {
                            kind: "food",
                            food_name: "chicken egg",
                            qty_amount: "1",
                            qty_unit: "each",
                            return_to: "/kitchen/groceries",
                        },
                    },
                },
            }),
        ),
        // The line sheet of a store with ten sections: its Section pull-down is
        // longer than the sheet's room, so every item has to stay reachable.
        "grocery-many-sections": (() => {
            const view = fixtureGroceriesView(chrome, {
                openLineId: "gl-milk",
            });
            const costco = view.stores.find((st) => st.id === "s-costco")!;
            const more = [
                "Bakery",
                "Frozen",
                "Pantry",
                "Snacks",
                "Drinks",
                "Household",
                "Pets",
            ].map((name, i) => ({
                id: `sec-x${i + 1}`,
                householdId: H,
                storeId: costco.id,
                name,
                sortOrder: 10 + i,
                hidden: false,
                isOther: false,
                lines: [],
            }));
            costco.sections.push(...more);
            return renderKitchenGroceriesV2Page(view);
        })(),
        // Kitchen › Usuals: the list, one store, both stores, a usual's sheet,
        // a search of foods, and with `barcode-camera` off.
        usuals: renderKitchenUsualsV2Page(fixtureUsualsView(chrome)),
        "usuals-costco": renderKitchenUsualsV2Page(
            fixtureUsualsView(chrome, { selectedStoreIds: ["s-costco"] }),
        ),
        "usuals-both": renderKitchenUsualsV2Page(
            fixtureUsualsView(chrome, {
                selectedStoreIds: ["s-costco", "s-tj"],
            }),
        ),
        "usual-open": renderKitchenUsualsV2Page(
            fixtureUsualsView(chrome, { openFoodId: "u-milk" }),
        ),
        "usuals-search": renderKitchenUsualsV2Page(
            fixtureUsualsView(chrome, {
                add: {
                    tab: "search",
                    search: {
                        q: "but",
                        results: fixtureUsualsCatalog().usual.addable.filter(
                            (food) => food.name === "Butter",
                        ),
                        truncated: false,
                    },
                },
            }),
        ),
        "usuals-camera-off": renderKitchenUsualsV2Page(
            fixtureUsualsView({
                ...chrome,
                flags: { ...chrome.flags, barcodeCamera: false },
            }),
        ),
        recipes: fixtureRecipesList(chrome),
        "recipes-protein": fixtureRecipesList(chrome, {
            filters: ["protein"],
            cards: fixtureRecipeCards().filter(
                (c) => (c.recipe as { id: string }).id === "r-alfredo",
            ),
        }),
        "recipes-pick": fixtureRecipesList(chrome, { planDate: "2026-11-12" }),
        "recipes-failed-link": fixtureRecipesList(chrome, {
            // Three planned cards are wider than the phone: the row scrolls
            // inside its own box, never the page.
            week: fixtureWeekPlan(false, true),
            importUrl:
                "https://kitchen.example/s/q7Wm4xTz2LpR9vYb1KcN8dFhJ3sGaE5uOiXt6ZeBnVw",
            sharedImport: {
                error: "That share link doesn't work any more",
                reason: "Revoked, expired, or not a recipe link",
                input: "https://kitchen.example/s/q7Wm4xTz2LpR9vYb1KcN8dFhJ3sGaE5uOiXt6ZeBnVw",
            },
        }),
        "recipes-share-off": fixtureRecipesList(chrome, {
            sharedImportEnabled: false,
        }),
        // The recipe page, and the pages its sheets and states lead to.
        recipe: fixtureRecipePage(chrome),
        "recipe-plan": fixtureRecipePage(chrome, { open: "plan" }),
        "recipe-cook": fixtureRecipePage(chrome, { open: "cook" }),
        "recipe-share-off": fixtureRecipePage(chrome, { share: false }),
        // Whose version: the base, Mia's, and a member (no Compare versions).
        "recipe-base": fixtureRecipePage(chrome, { version: "base" }),
        "recipe-mia": fixtureRecipePage(chrome, { version: "mia" }),
        "recipe-member": fixtureRecipePage(chrome, { member: true }),
        "recipe-compare": fixtureComparePage(chrome),
        // A later visit to the draft (and the owner on a member's draft): no guard.
        "recipe-draft": fixtureRecipePage(chrome, { draft: true }),
        // The importer's first landing straight after the import: the guard.
        "recipe-draft-landing": fixtureRecipePage(chrome, {
            draft: true,
            landing: true,
        }),
        "recipe-draft-refused": fixtureRecipePage(chrome, {
            draft: true,
            error: "Not saved yet. Fix what is listed below, then save it again.",
        }),
        "recipe-saved": fixtureRecipePage(chrome, { draft: true, saved: true }),
        // The one screen that shows a new link's address.
        "recipe-share-made": renderShareCreatedPage({
            chrome: chrome as never,
            url: "https://foodable.example.com/s/Qk3vZ8mXr1TnY0aLw5uHc9DfJ2bEeSgPiVoN7xRzA4M",
            what: "recipe",
            name: "Chicken alfredo",
            expiresAt: "2026-12-12T10:00:00.000Z",
            backHref: "/recipes/r-alfredo",
            active: "recipes",
        }),
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
        "settings-units": renderSettingsUnitsV2Page({
            chrome: chrome as never,
            weightUnit: "lb",
            drinkUnit: "us",
        }),
        "settings-nutrients": renderSettingsNutrientsV2Page({
            chrome: chrome as never,
            hidden: [],
            alcoholTrackingEnabled: true,
        }),
        "settings-ai": aiFixture(chrome),
        "settings-ai-changes": aiFixture(chrome, { appFilter: "Claude" }),
        "help-search": renderSettingsHelpV2Page({
            chrome: chrome as never,
            query: "zip",
        }),
        "settings-goals": goalsFixture(chrome),
        "settings-goals-refused": goalsFixture(chrome, { refused: true }),
        "settings-saved": savedFixture(chrome),
        "settings-score": renderSettingsScoreV2Page({
            chrome: chrome as never,
            preset: "balanced",
            weights: SCORE_PRESETS.balanced,
            followsHousehold: false,
            householdPresetLabel: "Balanced",
            canEditHousehold: false,
            warnTraces: true,
            compareGoals: true,
            allergensText: "Milk",
            allergensHref: `/settings/household/members/${ME.userId}`,
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
    "/?camera=off": "nutrition-camera-off",
    "/kitchen/fridge": "fridge",
    "/kitchen/groceries": "grocery",
    "/kitchen/groceries?store=s-costco": "grocery-costco",
    "/kitchen/groceries?store=s-costco&store=s-tj": "grocery-both",
    "/kitchen/groceries?share=off": "grocery-share-off",
    "/kitchen/groceries?line=gl-milk": "grocery-line-open",
    "/kitchen/groceries?line=gl-milk&sections=10": "grocery-many-sections",
    "/kitchen/groceries?add=did-you-mean": "grocery-did-you-mean",
    "/kitchen/usuals": "usuals",
    "/kitchen/usuals?store=s-costco": "usuals-costco",
    "/kitchen/usuals?store=s-costco%2Cs-tj": "usuals-both",
    "/kitchen/usuals?food=u-milk": "usual-open",
    "/kitchen/usuals?q=but": "usuals-search",
    "/kitchen/usuals?camera=off": "usuals-camera-off",
    "/recipes": "recipes",
    "/recipes?filter=protein": "recipes-protein",
    "/recipes?plan_date=2026-11-12": "recipes-pick",
    "/recipes?failed=1": "recipes-failed-link",
    "/recipes?share=off": "recipes-share-off",
    "/recipes/r-alfredo": "recipe",
    "/recipes/r-alfredo?cook=1": "recipe-cook",
    "/recipes/r-alfredo?share=off": "recipe-share-off",
    "/recipes/r-alfredo?member=base": "recipe-base",
    "/recipes/r-alfredo?member=u-mia": "recipe-mia",
    "/recipes/r-alfredo?role=member": "recipe-member",
    "/recipes/r-alfredo/compare": "recipe-compare",
    "/recipes/r-draft": "recipe-draft",
    "/recipes/r-draft?imported=1": "recipe-draft-landing",
    "/recipes/r-draft?theirs=1": "recipe-draft",
    "/recipes/r-draft?saved=1": "recipe-saved",
    "/recipes/r-alfredo?plan=1": "recipe-plan",
    "/recipes/r-alfredo?plan=1&date=2026-11-12": "recipe-plan",
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
    "/settings/goals": "settings-goals",
    "/settings/saved": "settings-saved",
    "/settings/product-score": "settings-score",
    "/settings/units": "settings-units",
    "/settings/nutrients": "settings-nutrients",
    "/settings/ai-connections": "settings-ai",
    "/settings/ai-connections?app=7d3f6c2e-5b1a-4e8f-9a3d-1c2b3a4d5e6f":
        "settings-ai-changes",
    "/settings/help?q=zip": "help-search",
    "/create-household": "create-household",
    "/foods/f-chicken": "product-full",
};

/** Saved appearance from Settings › Account (null = system). */
let accountTheme: "light" | "dark" | null = "dark";
// How many times the draft's Save has posted: the first is refused.
let draftSaves = 0;

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
        if (path === "/api/log/search") {
            // What the log search answers: a few foods, a recipe and a past
            // meal for "chick", the latest logs for the empty query.
            const q = (url.searchParams.get("q") ?? "").toLowerCase();
            const chicken = {
                id: "f-chicken",
                name: "Chicken breast, grilled",
                food_id: "f-chicken",
                unit_hints: ["g"],
                kcal_per_100g: 165,
                protein_per_100g: 31,
                carbs_per_100g: 0,
                fat_per_100g: 3.3,
                source: "food",
                open: "/foods/f-chicken",
                loggable: true,
            };
            const alfredo = {
                id: "r-alfredo",
                name: "Chicken alfredo",
                recipe_id: "r-alfredo",
                unit_hints: ["portion"],
                kcal: 690,
                source: "recipe",
                open: "/recipes/r-alfredo",
                loggable: true,
            };
            const wrap = {
                id: "m-wrap",
                meal_id: "m-wrap",
                name: "Chicken caesar wrap",
                food_id: "f-wrap",
                unit_hints: ["g"],
                log_count: 3,
                meal_kcal: 540,
                source: "meal",
                open: "/?log=meal:m-wrap",
                loggable: true,
            };
            const eggs = {
                id: "m-eggs",
                meal_id: "m-eggs",
                name: "Scrambled eggs",
                food_id: "f-eggs",
                unit_hints: ["g"],
                meal_kcal: 216,
                source: "meal",
                open: "/?log=meal:m-eggs",
                loggable: true,
            };
            return Response.json({
                groups: q.includes("chick")
                    ? [
                          { kind: "food", items: [chicken] },
                          { kind: "recipe", items: [alfredo] },
                          { kind: "history", items: [wrap] },
                      ]
                    : q === ""
                      ? [{ kind: "history", items: [eggs] }]
                      : [],
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
        if (path === "/recipes/r-alfredo/cook/preview") {
            // The cook sheet's re-read of what the cook takes.
            return new Response(
                renderCookPreviewRegion(
                    FIXTURE_COOK_PREVIEW,
                    undefined,
                    FIXTURE_COOK_PLACES,
                ),
                { headers: { "content-type": "text/html; charset=utf-8" } },
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
            if (path === "/recipes/r-alfredo/share") {
                // Like the route: a 200 page with the link's address, never cached.
                const html = applyAccountTheme(
                    await fileHtml(
                        `recipe-share-made-${themeFileSuffix()}${inboxUnread ? "" : "-read"}.html`,
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
            if (path === "/recipes/r-draft/save") {
                draftSaves += 1;
                if (draftSaves === 1) {
                    // Like the route: the check fails, so the draft's own page
                    // answers 422 in place with what is left.
                    const html = applyAccountTheme(
                        await fileHtml(
                            `recipe-draft-refused-${themeFileSuffix()}${inboxUnread ? "" : "-read"}.html`,
                            path + "#refused",
                        ),
                    );
                    return new Response(html, {
                        status: 422,
                        headers: { "content-type": "text/html; charset=utf-8" },
                    });
                }
                // The check passes: saved, and the page reloads as a recipe.
                return new Response(null, {
                    status: 303,
                    headers: { Location: "/recipes/r-draft?saved=1" },
                });
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
            if (
                path === "/settings/goals/field" &&
                entries.some(([k, v]) => k === "value" && v === "30000")
            ) {
                // Like the route: a value out of bounds is a 422 with the page
                // in place, the typed text and the refusal under that field.
                const html = applyAccountTheme(
                    await fileHtml(
                        `settings-goals-refused-${themeFileSuffix()}${inboxUnread ? "" : "-read"}.html`,
                        path + "#refused",
                    ),
                );
                return new Response(html, {
                    status: 422,
                    headers: { "content-type": "text/html; charset=utf-8" },
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
            if (path === "/recipes/r-draft/discard") {
                // Like the route: a discarded draft is gone, and Recipes is next.
                destKey = "/recipes";
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
            let file = routeHtmlFile(
                ROUTE_BASE[destKey] ? destKey : destKey.split("?")[0]!,
            );
            if (path === "/recipes/plan/pl1/move") {
                // Like the route: the one-off is moved a day on, and Today
                // lists it after the repeat's day.
                file = file.replace(/^nutrition-/, "nutrition-plan-moved-");
            }
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
            // A fresh look at the draft: its Save is refused once again.
            if (routeKey === "/recipes/r-draft") draftSaves = 0;
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
