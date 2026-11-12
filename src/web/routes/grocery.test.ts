import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import {
    addGroceryManualFood,
    checkGroceryLine,
    createMemoryGroceryStore,
} from "../../domain/grocery.js";
import { addLocation, createMemoryFridgeStore } from "../../domain/fridge.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
} from "../../domain/foods.js";
import { createMemoryStockStore } from "../../domain/stock.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
} from "../../domain/settings.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualFridgeDb from "../../db/fridge.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualFoods from "../../db/foods.js";
import * as actualGrocery from "../../db/grocery.js";
import * as actualRestock from "../../db/restock.js";
import * as actualStock from "../../db/stock.js";
import * as actualSettings from "../../db/settings.js";
import * as actualRules from "../../db/rules.js";
import * as actualNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualAttention from "../attention.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import { gatedRoutesOf } from "../../test-support/flag-harness.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";
import { renderGroceryPage, type GroceryPageView } from "../pages/grocery.js";
import { renderGroceryListPage } from "../loaders.js";
import { FIXTURE_APP_CHROME_FLAGS } from "../../test-support/chrome-flags.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const HH = "hh-1";

const member: HouseholdMember = {
    userId: ALICE,
    householdId: HH,
    role: "owner",
    displayName: "Alice",
};

const realHousehold = { ...actualHousehold };
const realFridgeDb = { ...actualFridgeDb };
const realProfiles = { ...actualProfiles };
const realFoods = { ...actualFoods };
const realGrocery = { ...actualGrocery };
const realRestock = { ...actualRestock };
const realStock = { ...actualStock };
const realSettings = { ...actualSettings };
const realRules = { ...actualRules };
const realNoticeDismissals = { ...actualNoticeDismissals };
const realAttention = { ...actualAttention };

let groceryStore = createMemoryGroceryStore();
let settingsStore = createMemorySettingsStore();
let foodsStore = createMemoryFoodsStore();
let fridgeStore = createMemoryFridgeStore();
let stockStore = createMemoryStockStore();
const today = "2026-11-10";

const legacyGroceryHtml = renderGroceryPage({
    chrome: {
        theme: "light",
        attention: { count: 0, tabs: {} },
        flags: FIXTURE_APP_CHROME_FLAGS,
    },
    stores: [],
    locations: [],
} satisfies GroceryPageView);

async function seedGroceryLines() {
    groceryStore = createMemoryGroceryStore();
    settingsStore = createMemorySettingsStore();
    foodsStore = createMemoryFoodsStore();
    fridgeStore = createMemoryFridgeStore();
    stockStore = createMemoryStockStore();
    const store = await createGroceryStore(settingsStore, HH, "Shop");
    const fridge = await addLocation(fridgeStore, HH, "Fridge");
    const pantry = await addLocation(fridgeStore, HH, "Pantry");
    await findOrCreateManualFood(foodsStore, HH, "food", "Oats");
    const lineA = await addGroceryManualFood(
        groceryStore,
        settingsStore,
        foodsStore,
        {
            householdId: HH,
            storeId: store.id,
            name: "Oats",
            amount: 1,
            unit: "kg",
        },
    );
    const lineB = await addGroceryManualFood(
        groceryStore,
        settingsStore,
        foodsStore,
        {
            householdId: HH,
            storeId: store.id,
            name: "Oil",
            amount: 1,
            unit: "bottle",
        },
    );
    await checkGroceryLine(groceryStore, HH, lineA.id, true);
    await checkGroceryLine(groceryStore, HH, lineB.id, true);
    return { store, fridge, pantry, lineA, lineB };
}

mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE ? member : null,
    listHouseholdMembers: async () => [member],
    getHouseholdConfig: async () => ({
        name: "Home",
        recipeSearchPlaces: [],
        preferences: {
            restock: { enabled: false, cadenceDays: 7, lastRunOn: null },
            socialReaders: { tiktok: false, facebook: false },
        },
    }),
    householdExists: async () => true,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns db stubs
mock.module("../../db/fridge.js", () => ({
    ...realFridgeDb,
    liveFridgeStore: () => fridgeStore,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test fixtures
mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) => ({
        user_id: userId,
        timezone: "UTC",
        preferred_weight_unit: "kg",
        widgets_enabled: true,
        alcohol_tracking_enabled: false,
        preferred_drink_unit: null,
        theme: "light",
        nutrition_layout: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    }),
}));

mock.module("../../db/foods.js", () => ({
    ...realFoods,
    liveFoodsStore: () => foodsStore,
}));

mock.module("../../db/grocery.js", () => ({
    ...realGrocery,
    liveGroceryStore: () => groceryStore,
}));

mock.module("../../db/settings.js", () => ({
    ...realSettings,
    liveSettingsStore: () => settingsStore,
}));

mock.module("../../db/rules.js", () => ({
    ...realRules,
    liveRulesStore: () => ({
        listAllergens: async () => [],
        listStoreRules: async () => [],
    }),
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stock db stub
mock.module("../../db/stock.js", () => ({
    ...realStock,
    liveStockStore: () => stockStore,
}));

mock.module("../../db/restock.js", () => ({
    ...realRestock,
    householdToday: async () => today,
}));

mock.module("../../db/notice-dismissals.js", () => ({
    ...realNoticeDismissals,
    liveNoticeDismissalsStore: () => createMemoryNoticeDismissalsStore(),
}));

const emptyNotices = {
    notices: [],
    dismissals: [],
    subjectNames: new Map(),
    subjectTimes: new Map(),
    noticeFoods: new Map(),
    catalogFoods: [],
    aliasMap: new Map(),
    barcodedIds: new Set(),
    possibleDuplicatePairs: [],
    recipesListPrefetch: {
        recipes: [],
        allIngredients: [],
        fridgeItems: [],
        foodsById: new Map(),
    },
};

mock.module("../attention.js", () => ({
    ...realAttention,
    loadHouseholdNotices: async () => emptyNotices,
    viewerChromeWithAttention: async (
        profile: { theme?: string | null } | null,
        viewer: HouseholdMember,
    ) => {
        const flags = await realAttention.viewerFlagsFor(viewer);
        return {
            theme:
                profile?.theme === "light" || profile?.theme === "dark"
                    ? profile.theme
                    : "light",
            attention: { count: 0, tabs: {} },
            flags,
            ...(flags.uiV2
                ? {
                      identity: {
                          viewerName: viewer.displayName,
                          viewerRole: viewer.role,
                          householdName: "Test household",
                          memberCount: 1,
                      },
                  }
                : {}),
        };
    },
}));

afterAll(() => {
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../../db/fridge.js", () => realFridgeDb);
    mock.module("../../db/profiles.js", () => realProfiles);
    mock.module("../../db/foods.js", () => realFoods);
    mock.module("../../db/grocery.js", () => realGrocery);
    mock.module("../../db/restock.js", () => realRestock);
    mock.module("../../db/stock.js", () => realStock);
    mock.module("../../db/settings.js", () => realSettings);
    mock.module("../../db/rules.js", () => realRules);
    mock.module("../../db/notice-dismissals.js", () => realNoticeDismissals);
    mock.module("../attention.js", () => realAttention);
});

afterEach(() => {
    resetFlagsForTests();
});

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("../../index.js");

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("grocery routes", () => {
    test("put-away route is ui-v2 gated", () => {
        const gated = gatedRoutesOf(app).find(
            (r) =>
                r.method === "POST" && r.path === "/kitchen/groceries/put-away",
        );
        expect(gated).toEqual({
            method: "POST",
            path: "/kitchen/groceries/put-away",
            flag: "ui-v2",
            notFound: true,
        });
    });

    test("GET /kitchen/groceries serves v2 markup when ui-v2 is on", async () => {
        await seedGroceryLines();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request("http://x/kitchen/groceries", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("fd-kitchen-groceries-page");
        expect(html).not.toContain("grocery-store panel");
    });

    test("GET /kitchen/groceries keeps legacy page when ui-v2 is off", async () => {
        await seedGroceryLines();
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const direct = await renderGroceryListPage(ALICE);
        const res = await app.request("http://x/kitchen/groceries", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await res.text();
        expect(html).toBe(direct.html);
        expect(html).toContain("grocery-store");
        expect(html).not.toContain("fd-kitchen-groceries-page");
    });

    test("POST put-away writes each checked line to its own location and date", async () => {
        const { fridge, pantry, lineA, lineB } = await seedGroceryLines();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request("http://x/kitchen/groceries/put-away", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                line_ids: `${lineA.id},${lineB.id}`,
                [`location_id_${lineA.id}`]: fridge.id,
                [`location_id_${lineB.id}`]: pantry.id,
                [`expires_on_${lineA.id}`]: "2026-12-01",
                [`expires_on_${lineB.id}`]: "2026-12-15",
                return_to: "/kitchen/groceries",
            }).toString(),
        });
        expect(res.status).toBe(303);
        const items = await fridgeStore.listItems(HH);
        expect(items).toHaveLength(2);
        const a = items.find((row) => row.displayName === "Oats");
        const b = items.find((row) => row.displayName === "Oil");
        expect(a?.locationId).toBe(fridge.id);
        expect(b?.locationId).toBe(pantry.id);
        expect(a?.expiresOn).toBe("2026-12-01");
        expect(b?.expiresOn).toBe("2026-12-15");
        expect((await groceryStore.listLines(HH)).length).toBe(0);
    });

    test("POST put-away with a bad line returns 4xx and keeps draft values", async () => {
        const { lineA, lineB } = await seedGroceryLines();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const before = await groceryStore.listLines(HH);
        const res = await app.request("http://x/kitchen/groceries/put-away", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                line_ids: `${lineA.id},missing-line`,
                [`location_id_${lineA.id}`]: "loc-1",
                [`expires_on_${lineA.id}`]: "2026-12-01",
                [`location_id_missing-line`]: "loc-2",
                return_to: "/kitchen/groceries?put-away=1",
            }).toString(),
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain('id="fd-grocery-put-away"');
        expect(html).toContain('value="2026-12-01"');
        expect(html).toContain("Unknown grocery line");
        expect(await groceryStore.listLines(HH)).toHaveLength(before.length);
    });

    test("check POST stamps the usual's last restocked day", async () => {
        const { lineA } = await seedGroceryLines();
        await checkGroceryLine(groceryStore, HH, lineA.id, false);
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const oats = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Oats",
        );
        expect(oats.lastRestockedOn).toBeNull();
        const res = await app.request(
            `http://x/kitchen/groceries/lines/${lineA.id}/check`,
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({ checked: "1" }).toString(),
            },
        );
        expect(res.status).toBe(303);
        expect((await foodsStore.getFood(HH, oats.id))?.lastRestockedOn).toBe(
            today,
        );
    });

    test("check POST honors return_to on the v2 tab", async () => {
        const { lineA } = await seedGroceryLines();
        await checkGroceryLine(groceryStore, HH, lineA.id, false);
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request(
            `http://x/kitchen/groceries/lines/${lineA.id}/check`,
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    checked: "1",
                    return_to: "/kitchen/groceries?store=ignored",
                }).toString(),
            },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toContain("/kitchen/groceries");
    });
});
