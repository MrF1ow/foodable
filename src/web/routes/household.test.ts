import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { legacyRedirects } from "../legacy-redirects.js";
import * as actualDbFoods from "../../db/foods.js";
import * as actualDbFridge from "../../db/fridge.js";
import * as actualDbGrocery from "../../db/grocery.js";
import * as actualDbHousehold from "../../db/household.js";
import * as actualDbProfiles from "../../db/profiles.js";
import * as actualDbRecipes from "../../db/recipes.js";
import * as actualDbRules from "../../db/rules.js";
import * as actualDbSettings from "../../db/settings.js";
import * as actualDbStock from "../../db/stock.js";
import * as actualDbNoticeDismissals from "../../db/notice-dismissals.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import * as actualFoods from "../../foods.js";
import { createMemoryFoodsStore, newFood } from "../../domain/foods.js";
import { addLocation, createMemoryFridgeStore } from "../../domain/fridge.js";
import {
    addGroceryFoodById,
    addGroceryManualFood,
    createMemoryGroceryStore,
} from "../../domain/grocery.js";
import { createGroceryStore } from "../../domain/settings.js";
import { createMemoryRecipesStore } from "../../domain/recipes.js";
import { createMemoryRulesStore } from "../../domain/rules.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import { createMemoryStockStore } from "../../domain/stock.js";
import type { FoodResult } from "../../foods.js";
import { LINK_PRODUCT_MODAL_ID } from "../components/link-product-prompt.js";
import {
    DEFAULT_RESTOCK,
    EMPTY_HOUSEHOLD_PREFERENCES,
    type HouseholdConfig,
    type HouseholdMember,
} from "../../household.js";
import { setSocialReaderEnabled } from "../../household.js";
import { createMemorySocialReaderStatusStore } from "../../domain/social-readers.js";
import * as actualDbSocialReaders from "../../db/social-readers.js";
import * as actualDbFetchMemory from "../../db/fetch-memory.js";
import { createMemoryFetchMemoryStore } from "../../domain/fetch-memory.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { USUALS_INTRO } from "../pages/v2/kitchen-usuals.js";

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const realDbFoods = { ...actualDbFoods };
const realDbFridge = { ...actualDbFridge };
const realDbGrocery = { ...actualDbGrocery };
const realDbHousehold = { ...actualDbHousehold };
const realDbProfiles = { ...actualDbProfiles };
const realDbRecipes = { ...actualDbRecipes };
const realDbRules = { ...actualDbRules };
const realDbSettings = { ...actualDbSettings };
const realDbStock = { ...actualDbStock };
const realDbNoticeDismissals = { ...actualDbNoticeDismissals };
const realFoods = { ...actualFoods };
const realDbSocialReaders = { ...actualDbSocialReaders };
const realDbFetchMemory = { ...actualDbFetchMemory };

const ALICE = "11111111-1111-4111-8111-111111111111";
const HH = "hh-1";

const PROFILE: actualDbProfiles.Profile = {
    user_id: ALICE,
    timezone: "UTC",
    preferred_weight_unit: null,
    widgets_enabled: true,
    alcohol_tracking_enabled: false,
    preferred_drink_unit: null,
    theme: "light",
    nutrition_layout: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
};

const db: {
    profile: actualDbProfiles.Profile;
    members: HouseholdMember[];
    household: HouseholdConfig;
    configWrites: number;
    dismissalsStore: ReturnType<typeof createMemoryNoticeDismissalsStore>;
    socialReaderStatusStore: ReturnType<
        typeof createMemorySocialReaderStatusStore
    >;
    foodsStore: ReturnType<typeof createMemoryFoodsStore>;
    fridgeStore: ReturnType<typeof createMemoryFridgeStore>;
    stockStore: ReturnType<typeof createMemoryStockStore>;
    groceryStore: ReturnType<typeof createMemoryGroceryStore>;
    recipesStore: ReturnType<typeof createMemoryRecipesStore>;
    settingsStore: ReturnType<typeof createMemorySettingsStore>;
    rulesStore: ReturnType<typeof createMemoryRulesStore>;
    barcodeFoods: Record<string, FoodResult>;
} = {
    profile: PROFILE,
    members: [
        {
            householdId: HH,
            userId: ALICE,
            role: "owner",
            displayName: "Alice",
        },
    ] as HouseholdMember[],
    household: {
        name: "Home",
        recipeSearchPlaces: [],
        preferences: {
            ...EMPTY_HOUSEHOLD_PREFERENCES,
            restock: { ...DEFAULT_RESTOCK, lastRunOn: "2026-09-15" },
        },
    } as HouseholdConfig,
    configWrites: 0,
    socialReaderStatusStore: createMemorySocialReaderStatusStore(),
    foodsStore: createMemoryFoodsStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    fridgeStore: createMemoryFridgeStore(),
    stockStore: createMemoryStockStore(),
    groceryStore: createMemoryGroceryStore(),
    recipesStore: createMemoryRecipesStore(),
    settingsStore: createMemorySettingsStore(),
    rulesStore: createMemoryRulesStore(),
    barcodeFoods: {} as Record<string, FoodResult>,
};

mock.module("../../db/foods.js", () => ({
    ...realDbFoods,
    liveFoodsStore: () => db.foodsStore,
}));
mock.module("../../db/fridge.js", () => ({
    ...realDbFridge,
    liveFridgeStore: () => db.fridgeStore,
}));
mock.module("../../db/stock.js", () => ({
    ...realDbStock,
    liveStockStore: () => db.stockStore,
}));
mock.module("../../db/grocery.js", () => ({
    ...realDbGrocery,
    liveGroceryStore: () => db.groceryStore,
}));
mock.module("../../db/recipes.js", () => ({
    ...realDbRecipes,
    liveRecipesStore: () => db.recipesStore,
}));
mock.module("../../db/settings.js", () => ({
    ...realDbSettings,
    liveSettingsStore: () => db.settingsStore,
}));
mock.module("../../db/rules.js", () => ({
    ...realDbRules,
    liveRulesStore: () => db.rulesStore,
}));
mock.module("../../db/notice-dismissals.js", () => ({
    ...realDbNoticeDismissals,
    liveNoticeDismissalsStore: () => db.dismissalsStore,
}));
mock.module("../../db/household.js", () => ({
    ...realDbHousehold,
    getHouseholdMembership: async (userId: string) =>
        db.members.find((member) => member.userId === userId) ?? null,
    householdExists: async () => db.household != null,
    getHouseholdConfig: async () => structuredClone(db.household),
    getHouseholdOwnerProfile: async () => db.profile,
    updateHouseholdConfig: async (
        _householdId: string,
        config: HouseholdConfig,
    ) => {
        db.configWrites += 1;
        db.household = structuredClone(config);
        return structuredClone(db.household);
    },
    updateSocialReaderEnabled: async (
        _householdId: string,
        reader: "tiktok" | "facebook",
        enabled: boolean,
    ) => {
        db.household = setSocialReaderEnabled(
            structuredClone(db.household),
            reader,
            enabled,
        );
        return structuredClone(db.household);
    },
    listHouseholdMembers: async (householdId: string) =>
        db.members.filter((member) => member.householdId === householdId),
}));
mock.module("../../db/social-readers.js", () => ({
    ...realDbSocialReaders,
    liveSocialReaderStatusStore: () => db.socialReaderStatusStore,
}));
mock.module("../../db/fetch-memory.js", () => ({
    ...realDbFetchMemory,
    recipeFetchMemory: () => createMemoryFetchMemoryStore(),
}));
mock.module("../../db/profiles.js", () => ({
    ...realDbProfiles,
    getProfile: async () => db.profile,
}));
mock.module("../../foods.js", () => ({
    ...realFoods,
    lookupBarcode: async (barcode: string) => db.barcodeFoods[barcode] ?? null,
}));

afterAll(() => {
    mock.module("../../db/foods.js", () => realDbFoods);
    mock.module("../../db/fridge.js", () => realDbFridge);
    mock.module("../../db/stock.js", () => realDbStock);
    mock.module("../../db/grocery.js", () => realDbGrocery);
    mock.module("../../db/recipes.js", () => realDbRecipes);
    mock.module("../../db/settings.js", () => realDbSettings);
    mock.module("../../db/rules.js", () => realDbRules);
    mock.module("../../db/household.js", () => realDbHousehold);
    mock.module("../../db/social-readers.js", () => realDbSocialReaders);
    mock.module("../../db/fetch-memory.js", () => realDbFetchMemory);
    mock.module("../../db/profiles.js", () => realDbProfiles);
    mock.module("../../db/notice-dismissals.js", () => realDbNoticeDismissals);
    mock.module("../../foods.js", () => realFoods);
});

const { householdRoutes } = await import("./household.js");
const { settingsRoutes } = await import("./settings.js");
const { groceryRoutes } = await import("./grocery.js");
const { fridgeRoutes } = await import("./fridge.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function app() {
    const hono = new Hono();
    hono.route("/", householdRoutes);
    hono.route("/", groceryRoutes);
    hono.route("/", fridgeRoutes);
    return hono;
}

async function seedEggsCatalog() {
    const store = db.foodsStore;
    const eggs = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            gramsPerEach: 50,
        }),
    );
    const kirkland = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Kirkland Large Eggs",
            brand: "Kirkland",
            genericFoodId: eggs.id,
            calories: 140,
        }),
    );
    return { eggs, kirkland };
}

beforeEach(() => {
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.foodsStore = createMemoryFoodsStore();
    db.fridgeStore = createMemoryFridgeStore();
    db.stockStore = createMemoryStockStore();
    db.groceryStore = createMemoryGroceryStore();
    db.recipesStore = createMemoryRecipesStore();
    db.settingsStore = createMemorySettingsStore();
    db.rulesStore = createMemoryRulesStore();
    db.fridgeStore.linkDismissals(db.dismissalsStore);
    db.groceryStore.linkDismissals(db.dismissalsStore);
    db.recipesStore.linkDismissals(db.dismissalsStore);
    db.foodsStore.linkDismissals(db.dismissalsStore);
    db.barcodeFoods = {};
    db.profile = { ...PROFILE };
    db.members = [
        {
            householdId: HH,
            userId: ALICE,
            role: "owner",
            displayName: "Alice",
        },
    ];
});

describe("settings household routes", () => {
    function settingsApp() {
        const hono = new Hono();
        hono.route("/", householdRoutes);
        hono.route("/", settingsRoutes);
        return hono;
    }

    beforeEach(() => {
        db.configWrites = 0;
        db.household = {
            name: "Home",
            recipeSearchPlaces: [],
            preferences: {
                ...EMPTY_HOUSEHOLD_PREFERENCES,
                restock: { ...DEFAULT_RESTOCK, lastRunOn: "2026-09-15" },
            },
        };
    });

    test("GET /settings/household-settings is not a legacy redirect", async () => {
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('aria-current="page">Household</a>');
    });

    test("member GET is read-only", async () => {
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "member",
                displayName: "Alice",
            },
        ] as HouseholdMember[];
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).not.toContain("<form");
        expect(html).not.toContain('name="restock_enabled"');
    });

    test("member POST is forbidden", async () => {
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "member",
                displayName: "Alice",
            },
        ] as HouseholdMember[];
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "restock_enabled=true&restock_weekday=6&restock_time=07:00&timezone=",
            },
        );
        expect(r.status).toBe(403);
        expect(db.configWrites).toBe(0);
    });

    test("owner save preserves lastRunOn", async () => {
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "restock_enabled=true&restock_weekday=1&restock_time=08:00&timezone=Europe%2FKyiv&from=%2F",
            },
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/settings/household-settings");
        expect(db.configWrites).toBe(1);
        expect(db.household.preferences.restock.lastRunOn).toBe("2026-09-15");
        expect(db.household.preferences.restock.enabled).toBe(true);
        expect(db.household.preferences.timezone).toBe("Europe/Kyiv");
    });

    test("admin can save", async () => {
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "admin",
                displayName: "Alice",
            },
        ] as HouseholdMember[];
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "restock_enabled=true&restock_weekday=0&restock_time=09:00&timezone=",
            },
        );
        expect(r.status).toBe(303);
        expect(db.configWrites).toBe(1);
    });

    test("invalid POST re-renders with error and does not write", async () => {
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "timezone=&restock_enabled=true&restock_weekday=6&restock_time=24%3A00",
            },
        );
        expect(r.status).toBe(400);
        expect(db.configWrites).toBe(0);
        const html = await r.text();
        expect(html).toContain("Enter a time as HH:MM");
        expect(html).toContain('value="24:00"');
        // A time input would blank "24:00"; text keeps it visible and re-posted.
        expect(html).toMatch(
            /<input type="text" id="restock_time"[^>]*value="24:00"/,
        );
    });

    test("blank or missing weekday POST returns 400 without write", async () => {
        for (const body of [
            "timezone=&restock_enabled=true&restock_time=07%3A00",
            "timezone=&restock_enabled=true&restock_weekday=&restock_time=07%3A00",
            "timezone=&restock_enabled=true&restock_weekday=%20%20&restock_time=07%3A00",
        ]) {
            db.configWrites = 0;
            const r = await settingsApp().request(
                "http://x/settings/household-settings",
                {
                    method: "POST",
                    headers: {
                        cookie: cookieFor(ALICE),
                        "content-type": "application/x-www-form-urlencoded",
                    },
                    body,
                },
            );
            expect(r.status).toBe(400);
            expect(db.configWrites).toBe(0);
            const html = await r.text();
            expect(html).toContain("Pick a day from Sunday to Saturday");
        }
    });

    test("invalid timezone POST keeps submitted timezone selected", async () => {
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "timezone=Mars%2FPhobos&restock_enabled=true&restock_weekday=1&restock_time=07%3A00",
            },
        );
        expect(r.status).toBe(400);
        expect(db.configWrites).toBe(0);
        const html = await r.text();
        expect(html).toContain('value="Mars/Phobos" selected');
    });

    test("invalid weekday POST keeps submitted weekday selected, not Sunday", async () => {
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "timezone=&restock_enabled=true&restock_weekday=9&restock_time=07%3A00",
            },
        );
        expect(r.status).toBe(400);
        expect(db.configWrites).toBe(0);
        const html = await r.text();
        expect(html).toContain('value="9" selected');
        expect(html).not.toMatch(/value="0"[^>]*selected/);
    });
});

describe("legacy redirect middleware", () => {
    const legacyApp = new Hono();
    legacyApp.use("*", legacyRedirects());
    legacyApp.get("/kitchen/fridge", (c) => c.text("ok"));

    test("GET /fridge?x=1 → 301 /kitchen/fridge?x=1", async () => {
        const r = await legacyApp.request("http://x/fridge?x=1");
        expect(r.status).toBe(301);
        expect(r.headers.get("location")).toBe("/kitchen/fridge?x=1");
    });

    test("POST /household/name → 308 /settings/household/name", async () => {
        const r = await legacyApp.request("http://x/household/name", {
            method: "POST",
        });
        expect(r.status).toBe(308);
        expect(r.headers.get("location")).toBe("/settings/household/name");
    });

    test("HEAD → 301 without session", async () => {
        const r = await legacyApp.request("http://x/grocery", {
            method: "HEAD",
        });
        expect(r.status).toBe(301);
        expect(r.headers.get("location")).toBe("/kitchen/groceries");
    });

    test("GET /kitchen/fridge falls through", async () => {
        const r = await legacyApp.request("http://x/kitchen/fridge");
        expect(r.status).toBe(200);
    });
});

describe("household usual products and items routes", () => {
    test("liveFoodsStore mock shares the test memory store", async () => {
        const { liveFoodsStore } = await import("../../db/foods.js");
        expect(liveFoodsStore()).toBe(db.foodsStore);
    });

    function post(path: string, body: string) {
        return app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body,
        });
    }

    test("GET list starts empty, then Add usual product opens the picker", async () => {
        const get = (path: string) =>
            app().request(`http://x${path}`, {
                headers: { cookie: cookieFor(ALICE) },
            });
        const cilantro = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Cilantro" }),
        );
        const list = await get("/kitchen/usuals");
        expect(list.status).toBe(200);
        const html = await list.text();
        expect(html).toContain("No usual products yet.");
        expect(html).not.toContain("Needs a usual product");
        expect(html).toContain('name="q"');
        const add = await get(`/kitchen/usuals?food=${cilantro.id}`);
        expect(add.status).toBe(302);
        expect(add.headers.get("location")).toBe(
            `/kitchen/usuals/${cilantro.id}`,
        );
    });

    test("GET usual-products search lists addable foods and excludes scanned products", async () => {
        const get = (path: string) =>
            app().request(`http://x${path}`, {
                headers: { cookie: cookieFor(ALICE) },
            });
        const flourA = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "All purpose flour",
            }),
        );
        const flourB = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "all-purpose flour",
            }),
        );
        const carton = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Cage Free Grade A Large Eggs",
                offSourceId: "070852010016",
            }),
        );
        await db.foodsStore.setBarcode(HH, "1234567890123", carton.id);
        // A scanned flour must not be offered either, whether it came from
        // Open Food Facts or only carries a barcode.
        await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Gold Medal flour",
                offSourceId: "016000196100",
            }),
        );
        const barcodedFlour = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Pillsbury flour" }),
        );
        await db.foodsStore.setBarcode(HH, "051500255162", barcodedFlour.id);

        const r = await get("/kitchen/usuals?q=flour");
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toMatch(
            /id="usual-product-add"[^>]*data-modal-open-on-load/,
        );
        expect(html).toContain("All purpose flour");
        expect(html).toContain("all-purpose flour");
        expect(html).toContain(`?food=${flourA.id}`);
        expect(html).toContain(`?food=${flourB.id}`);
        expect(html).toContain("Choose");
        expect(html).not.toContain("Gold Medal flour");
        expect(html).not.toContain("Pillsbury flour");
        const eggs = await get("/kitchen/usuals?q=large+eggs");
        expect(await eggs.text()).not.toContain("Cage Free Grade A Large Eggs");

        const none = await get("/kitchen/usuals?q=zzz");
        expect(none.status).toBe(200);
        expect(await none.text()).toContain("No matching food.");

        const pick = await get(`/kitchen/usuals?food=${flourA.id}`);
        expect(pick.status).toBe(302);
        expect(pick.headers.get("location")).toBe(
            `/kitchen/usuals/${flourA.id}`,
        );
    });

    test("POST set usual redirects and updates state", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const r = await post(
            `/kitchen/usuals/${eggs.id}`,
            `product_food_id=${kirkland.id}`,
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/usuals");
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBe(kirkland.id);
    });

    test("POST clear usual accepts empty product_food_id", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...eggs,
            usualProductId: kirkland.id,
        });
        const r = await post(`/kitchen/usuals/${eggs.id}`, "product_food_id=");
        expect(r.status).toBe(303);
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBeNull();
    });

    test("POST add product by hand creates product and sets usual", async () => {
        const { eggs } = await seedEggsCatalog();
        const r = await post(
            `/kitchen/usuals/${eggs.id}/products`,
            "name=Store+brand+eggs&brand=Safeway&calories=130&grams_per_each=50",
        );
        expect(r.status).toBe(303);
        const foods = await db.foodsStore.listFoods(HH);
        const product = foods.find(
            (row) =>
                row.genericFoodId === eggs.id &&
                row.name === "Store brand eggs",
        );
        expect(product?.name).toBe("Store brand eggs");
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBe(product?.id);
    });

    test("POST pick with food_id sets usual", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const r = await post(
            `/kitchen/usuals/${eggs.id}/pick`,
            `food_id=${solo.id}`,
        );
        expect(r.status).toBe(303);
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBe(solo.id);
        expect(kirkland.id).not.toBe(solo.id);
    });

    test("GET ?food= shortcut carries a pre-move from as its new path", async () => {
        const { eggs } = await seedEggsCatalog();
        const get = (path: string) =>
            app().request(`http://x${path}`, {
                headers: { cookie: cookieFor(ALICE) },
            });
        for (const [from, want] of [
            ["/grocery", "%2Fkitchen%2Fgroceries"],
            ["/settings/foods", "%2Fsettings%2Fhousehold%2Fitems"],
        ] as const) {
            const r = await get(
                `/kitchen/usuals?food=${eggs.id}&from=${encodeURIComponent(from)}`,
            );
            expect(r.status).toBe(302);
            expect(r.headers.get("location")).toBe(
                `/kitchen/usuals/${eggs.id}?from=${want}`,
            );
        }
    });

    test("POST pick adds a product to the list and keeps the current usual", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...eggs,
            usualProductId: kirkland.id,
        });
        const solo = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Farm eggs" }),
        );
        const r = await post(
            `/kitchen/usuals/${eggs.id}/pick`,
            `food_id=${solo.id}&from=%2Fgrocery`,
        );
        expect(r.status).toBe(303);
        // Back to the list, with the return path kept.
        expect(r.headers.get("location")).toBe(
            `/kitchen/usuals/${eggs.id}?from=%2Fkitchen%2Fgroceries`,
        );
        expect((await db.foodsStore.getFood(HH, solo.id))?.genericFoodId).toBe(
            eggs.id,
        );
        expect((await db.foodsStore.getFood(HH, eggs.id))?.usualProductId).toBe(
            kirkland.id,
        );
    });

    test("POST add product by hand keeps the current usual", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...eggs,
            usualProductId: kirkland.id,
        });
        const r = await post(
            `/kitchen/usuals/${eggs.id}/products`,
            "name=Farm+eggs",
        );
        expect(r.status).toBe(303);
        const foods = await db.foodsStore.listFoods(HH);
        expect(
            foods.some(
                (row) =>
                    row.genericFoodId === eggs.id && row.name === "Farm eggs",
            ),
        ).toBe(true);
        expect((await db.foodsStore.getFood(HH, eggs.id))?.usualProductId).toBe(
            kirkland.id,
        );
    });

    test("POST remove takes the product off the list, keeps it as a food, and clears it as usual", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...eggs,
            usualProductId: kirkland.id,
        });
        const r = await post(
            `/kitchen/usuals/${eggs.id}/products/${kirkland.id}/remove`,
            "from=%2Fgrocery",
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe(
            `/kitchen/usuals/${eggs.id}?from=%2Fkitchen%2Fgroceries`,
        );
        const product = await db.foodsStore.getFood(HH, kirkland.id);
        expect(product?.genericFoodId).toBeNull();
        expect(product?.archivedAt).toBeNull();
        expect(
            (await db.foodsStore.getFood(HH, eggs.id))?.usualProductId,
        ).toBeNull();
    });

    test("POST remove a product of another food returns 400 and changes nothing", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const flour = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Flour" }),
        );
        const before = await db.foodsStore.listFoods(HH);
        const r = await post(
            `/kitchen/usuals/${flour.id}/products/${kirkland.id}/remove`,
            "",
        );
        expect(r.status).toBe(400);
        expect(await r.text()).toContain(
            "That product is not on this food's list.",
        );
        expect(await db.foodsStore.listFoods(HH)).toEqual(before);
        expect(
            (await db.foodsStore.getFood(HH, kirkland.id))?.genericFoodId,
        ).toBe(eggs.id);
    });

    test("POST pick with barcode creates from OFF stub", async () => {
        const { eggs } = await seedEggsCatalog();
        db.barcodeFoods["012345678905"] = {
            name: "Scanned Eggs",
            brand: "Brand",
            serving: "100 g",
            calories: 120,
            protein_g: 12,
            carbs_g: 1,
            fat_g: 8,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
            nutriscore_grade: null,
            nova_group: null,
            source: "off:012345678905",
            source_name: "openfoodfacts",
            barcode: "012345678905",
        };
        const r = await post(
            `/kitchen/usuals/${eggs.id}/pick`,
            "barcode=012345678905",
        );
        expect(r.status).toBe(303);
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBeTruthy();
    });

    test("POST link and unlink product", async () => {
        const { eggs } = await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
                brand: "Kirkland",
            }),
        );
        const link = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${eggs.id}&from=/settings/household/items`,
        );
        expect(link.status).toBe(303);
        expect((await db.foodsStore.getFood(HH, solo.id))?.genericFoodId).toBe(
            eggs.id,
        );
        const unlink = await post(
            `/settings/household/items/${solo.id}/link`,
            "food_id=&from=/settings/household/items",
        );
        expect(unlink.status).toBe(303);
        expect(
            (await db.foodsStore.getFood(HH, solo.id))?.genericFoodId,
        ).toBeNull();
    });

    test("POST link with make_usual sets usual on plain food", async () => {
        const { eggs } = await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${eggs.id}&make_usual=1&from=/settings/household/items`,
        );
        expect(r.status).toBe(303);
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBe(solo.id);
    });

    test("POST link validation error reopens prompt with fields on items", async () => {
        await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${solo.id}&from=/settings/household/items`,
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain(`id="${LINK_PRODUCT_MODAL_ID}"`);
        expect(html).toContain("data-modal-open-on-load");
        expect(html).toContain('name="food_id"');
    });

    test("POST link from recipe returns to recipe on success", async () => {
        const { eggs } = await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const recipe = await db.recipesStore.insertRecipe({
            id: "r1",
            householdId: HH,
            creatorId: ALICE,
            name: "Test",
            yieldPortions: 1,
            instructions: null,
            prepMinutes: null,
            cookMinutes: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${eggs.id}&from=/recipes/${recipe.id}`,
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe(`/recipes/${recipe.id}`);
    });

    test("POST link rejects unsafe from and falls back to items", async () => {
        const { eggs } = await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${eggs.id}&from=${encodeURIComponent("//evil.com")}`,
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/settings/household/items");
    });

    test("POST link rejects https evil from and falls back to items", async () => {
        const { eggs } = await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${eggs.id}&from=${encodeURIComponent("https://evil.com/x")}`,
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/settings/household/items");
    });

    test("POST items archive keeps nutrition and archives (v2 saved delete)", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        try {
            const store = db.foodsStore;
            const food = await store.insertFood(
                newFood({
                    householdId: HH,
                    kind: "food",
                    name: "Eggs",
                    defaultUnit: "each",
                    gramsPerEach: 50,
                    calories: 155,
                    proteinG: 13,
                    allergens: ["egg"],
                }),
            );
            const r = await post(
                `/settings/household/items/${food.id}/archive`,
                "",
            );
            expect(r.status).toBe(303);
            expect(r.headers.get("location")).toBe("/settings/saved");
            const row = await store.getFood(HH, food.id);
            expect(row?.archivedAt).not.toBeNull();
            expect(row?.calories).toBe(155);
            expect(row?.proteinG).toBe(13);
            expect(row?.gramsPerEach).toBe(50);
            expect(row?.allergens).toEqual(["egg"]);
        } finally {
            resetFlagsForTests();
        }
    });

    test("POST items edit invalid patch leaves usual unchanged", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const r = await post(
            `/settings/household/items/${eggs.id}`,
            [
                "name=Eggs",
                "brand=",
                "aliases=",
                "default_unit=each",
                "grams_per_each=0",
                "grams_per_ml=",
                "calories=",
                `usual_product_id=${kirkland.id}`,
            ].join("&"),
        );
        expect(r.status).toBe(400);
        const plain = await db.foodsStore.getFood(HH, eggs.id);
        expect(plain?.usualProductId).toBeNull();
        const html = await r.text();
        expect(html).toContain('name="usual_product_id"');
    });

    test("POST usual-products saves usual store and amount on product", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const costco = await createGroceryStore(db.settingsStore, HH, "Costco");
        const r = await post(
            `/kitchen/usuals/${eggs.id}`,
            `product_food_id=${kirkland.id}&usual_amount=18&usual_unit=each&usual_store_id=${costco.id}`,
        );
        expect(r.status).toBe(303);
        const prod = await db.foodsStore.getFood(HH, kirkland.id);
        expect(prod?.usualStoreId).toBe(costco.id);
        expect(prod?.usualAmount).toEqual({ amount: 18, unit: "each" });
    });

    test("POST items edit saves usual purchase fields", async () => {
        const { eggs } = await seedEggsCatalog();
        const costco = await createGroceryStore(db.settingsStore, HH, "Costco");
        const r = await post(
            `/settings/household/items/${eggs.id}`,
            [
                "name=Eggs",
                "brand=",
                "aliases=",
                "default_unit=each",
                "grams_per_each=50",
                "grams_per_ml=",
                "calories=",
                "usual_amount=6",
                "usual_unit=each",
                `usual_store_id=${costco.id}`,
            ].join("&"),
        );
        expect(r.status).toBe(303);
        const row = await db.foodsStore.getFood(HH, eggs.id);
        expect(row?.usualStoreId).toBe(costco.id);
        expect(row?.usualAmount).toEqual({ amount: 6, unit: "each" });
    });

    test("POST items saves usual purchase on a standalone food", async () => {
        const store = db.foodsStore;
        const milk = await store.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Oat milk",
            }),
        );
        const costco = await createGroceryStore(db.settingsStore, HH, "Costco");
        const r = await post(
            `/settings/household/items/${milk.id}`,
            [
                "name=Oat milk",
                "brand=",
                "aliases=",
                "default_unit=ml",
                "grams_per_each=",
                "grams_per_ml=",
                "calories=",
                "usual_amount=1000",
                "usual_unit=ml",
                `usual_store_id=${costco.id}`,
            ].join("&"),
        );
        expect(r.status).toBe(303);
        const row = await store.getFood(HH, milk.id);
        expect(row?.genericFoodId).toBeNull();
        expect(row?.usualStoreId).toBe(costco.id);
        expect(row?.usualAmount).toEqual({ amount: 1000, unit: "ml" });
    });

    test("POST items amount without usual unit returns 400, reopens modal, unchanged", async () => {
        const { eggs } = await seedEggsCatalog();
        const before = await db.foodsStore.getFood(HH, eggs.id);
        const r = await post(
            `/settings/household/items/${eggs.id}`,
            [
                "name=Eggs",
                "brand=",
                "aliases=",
                "default_unit=each",
                "grams_per_each=50",
                "grams_per_ml=",
                "calories=",
                "usual_amount=3",
                "usual_unit=",
            ].join("&"),
        );
        expect(r.status).toBe(400);
        expect(await db.foodsStore.getFood(HH, eggs.id)).toEqual(before);
        const html = await r.text();
        expect(html).toContain("Enter a usual amount with its unit.");
        expect(html).toContain('id="food-edit"');
        expect(html).toContain("data-modal-open-on-load");
    });

    test("POST usual-products picker rejects amount without unit and leaves rows unchanged", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, eggs.id))!,
            usualProductId: kirkland.id,
        });
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, kirkland.id))!,
            usualStoreId: null,
            usualAmount: { amount: 12, unit: "each" },
        });
        const beforePlain = await db.foodsStore.getFood(HH, eggs.id);
        const beforeProd = await db.foodsStore.getFood(HH, kirkland.id);
        const r = await post(
            `/kitchen/usuals/${eggs.id}`,
            `product_food_id=${kirkland.id}&usual_amount=2&usual_unit=`,
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("Enter a usual amount with its unit.");
        expect(html).toContain('method="post"');
        expect(html).toContain(`kitchen/usuals/${eggs.id}`);
        expect(await db.foodsStore.getFood(HH, eggs.id)).toEqual(beforePlain);
        expect(await db.foodsStore.getFood(HH, kirkland.id)).toEqual(
            beforeProd,
        );
    });

    test("POST usual-products zero usual amount returns 400 without writing", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, eggs.id))!,
            usualProductId: kirkland.id,
        });
        const beforePlain = await db.foodsStore.getFood(HH, eggs.id);
        const beforeProd = await db.foodsStore.getFood(HH, kirkland.id);
        const r = await post(
            `/kitchen/usuals/${eggs.id}`,
            `product_food_id=${kirkland.id}&usual_amount=0&usual_unit=g`,
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("The usual amount must be greater than zero.");
        expect(await db.foodsStore.getFood(HH, eggs.id)).toEqual(beforePlain);
        expect(await db.foodsStore.getFood(HH, kirkland.id)).toEqual(
            beforeProd,
        );
    });

    test("POST items edit bad usual unit returns 400 without writing", async () => {
        const { eggs } = await seedEggsCatalog();
        const before = await db.foodsStore.getFood(HH, eggs.id);
        const r = await post(
            `/settings/household/items/${eggs.id}`,
            [
                "name=Eggs",
                "brand=",
                "aliases=",
                "default_unit=each",
                "grams_per_each=50",
                "grams_per_ml=",
                "calories=",
                "usual_amount=1",
                "usual_unit=nope",
            ].join("&"),
        );
        expect(r.status).toBe(400);
        expect(await db.foodsStore.getFood(HH, eggs.id)).toEqual(before);
    });

    test("POST link error from recipe reopens link prompt", async () => {
        await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        await db.recipesStore.insertRecipe({
            id: "r1",
            householdId: HH,
            creatorId: ALICE,
            name: "Test",
            yieldPortions: 1,
            instructions: null,
            prepMinutes: null,
            cookMinutes: null,
            sourceUrl: null,
            tags: [],
            notes: null,
            verification: "verified",
            updatedAt: "2026-01-01T00:00:00.000Z",
        });
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${solo.id}&from=/recipes/r1`,
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain(`id="${LINK_PRODUCT_MODAL_ID}"`);
        expect(html).toContain('name="food_id"');
    });

    test("POST link error from fridge reopens link prompt", async () => {
        await seedEggsCatalog();
        const solo = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Loose Large Eggs",
            }),
        );
        const r = await post(
            `/settings/household/items/${solo.id}/link`,
            `food_id=${solo.id}&from=/kitchen/fridge`,
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain(`id="${LINK_PRODUCT_MODAL_ID}"`);
        expect(html).not.toContain("<h1>Items</h1>");
    });

    test("fridge barcode create with plain match redirects with link_product", async () => {
        await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        db.barcodeFoods["9990001112222"] = {
            name: "Kirkland Large Eggs",
            brand: "Kirkland",
            serving: "100 g",
            calories: 120,
            protein_g: 12,
            carbs_g: 1,
            fat_g: 8,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
            nutriscore_grade: null,
            nova_group: null,
            source: "off:9990001112222",
            source_name: "openfoodfacts",
            barcode: "9990001112222",
        };
        await db.fridgeStore.insertLocation({
            id: "loc1",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        const r = await post(
            "/kitchen/fridge/items",
            "kind=food&location_id=loc1&barcode=9990001112222&qty_amount=6&qty_unit=each",
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toMatch(/link_product=/);
    });

    test("fridge barcode create with no plain suggestion skips link_product", async () => {
        db.barcodeFoods["7770001112222"] = {
            name: "Obscure imported cheese",
            brand: "Import",
            serving: "100 g",
            calories: 300,
            protein_g: 20,
            carbs_g: 0,
            fat_g: 25,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
            nutriscore_grade: null,
            nova_group: null,
            source: "off:777",
            source_name: "openfoodfacts",
            barcode: "7770001112222",
        };
        await db.fridgeStore.insertLocation({
            id: "loc2",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        const r = await post(
            "/kitchen/fridge/items",
            "kind=food&location_id=loc2&barcode=7770001112222&qty_amount=100&qty_unit=g",
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/fridge");
    });

    test("POST put-away with product_food_id records that product on fridge item", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...eggs,
            usualProductId: kirkland.id,
        });
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        const store = await createGroceryStore(db.settingsStore, HH, "Shop");
        const line = await addGroceryManualFood(
            db.groceryStore,
            db.settingsStore,
            db.foodsStore,
            {
                householdId: HH,
                storeId: store.id,
                name: "Eggs",
                amount: 1,
                unit: "each",
            },
        );
        const r = await post(
            `/kitchen/groceries/lines/${line.id}/put-away`,
            `location_id=${loc.id}&product_food_id=${kirkland.id}`,
        );
        expect(r.status).toBe(303);
        const items = await db.fridgeStore.listItems(HH);
        expect(items.some((item) => item.foodId === kirkland.id)).toBe(true);
    });

    test("fridge barcode with existing food does not add link_product", async () => {
        const existing = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Known",
                offSourceId: "off:888",
            }),
        );
        await db.foodsStore.setBarcode(HH, "8880001112222", existing.id);
        db.barcodeFoods["8880001112222"] = {
            name: "Known",
            brand: null,
            serving: "100 g",
            calories: 1,
            protein_g: 0,
            carbs_g: 0,
            fat_g: 0,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
            nutriscore_grade: null,
            nova_group: null,
            source: "off:888",
            source_name: "openfoodfacts",
            barcode: "8880001112222",
        };
        await db.fridgeStore.insertLocation({
            id: "loc1",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        const r = await post(
            "/kitchen/fridge/items",
            "kind=food&location_id=loc1&barcode=8880001112222&qty_amount=1&qty_unit=each",
        );
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/fridge");
    });
});

describe("fridge notice add-to-grocery route", () => {
    function post(path: string, body: string) {
        return app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body,
        });
    }

    function get(path: string) {
        return app().request(`http://x${path}`, {
            headers: { cookie: cookieFor(ALICE) },
        });
    }

    async function seedExpiredFridgeItem(opts?: {
        foodId?: string;
        expiresOn?: string;
        groceryFoodId?: string;
    }) {
        const { utcTodayFromDate } = await import("../../domain/stock.js");
        const { addFridgeItemAdjust } = await import("../../domain/stock.js");
        const existingStores = await db.settingsStore.listStores(HH);
        const store =
            existingStores[0] ??
            (await createGroceryStore(db.settingsStore, HH, "Shop"));
        const milk = opts?.foodId
            ? { id: opts.foodId }
            : await db.foodsStore.insertFood(
                  newFood({ householdId: HH, kind: "food", name: "Milk" }),
              );
        const locations = await db.fridgeStore.listLocations(HH);
        const loc =
            locations[0] ?? (await addLocation(db.fridgeStore, HH, "Fridge"));
        const today = utcTodayFromDate();
        const expiresOn =
            opts?.expiresOn ??
            new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        const row = await addFridgeItemAdjust(
            db.fridgeStore,
            db.stockStore,
            db.foodsStore,
            {
                householdId: HH,
                foodId: milk.id,
                amount: 1,
                unit: "l",
                locationId: loc.id,
                expiresOn,
                actorUserId: ALICE,
            },
        );
        if (opts?.groceryFoodId) {
            await addGroceryFoodById(
                db.groceryStore,
                db.settingsStore,
                db.foodsStore,
                {
                    householdId: HH,
                    storeId: store.id,
                    foodId: opts.groceryFoodId,
                    amount: 1,
                    unit: "l",
                },
            );
        }
        return { item: row.item!, store, today };
    }

    test("POST add-to-grocery creates a notice line and is idempotent", async () => {
        const { item } = await seedExpiredFridgeItem();
        const r1 = await post(
            `/kitchen/fridge/items/${item.id}/add-to-grocery`,
            "from=%2Ffridge",
        );
        expect(r1.status).toBe(303);
        const lines = await db.groceryStore.listLines(HH);
        const noticeLine = lines.find((l) => l.sourceFridgeItemId === item.id);
        expect(noticeLine).toBeDefined();
        expect(noticeLine!.source).toBe("notice");
        const r2 = await post(
            `/kitchen/fridge/items/${item.id}/add-to-grocery`,
            "from=%2Ffridge",
        );
        expect(r2.status).toBe(303);
        expect((await db.groceryStore.listLines(HH)).length).toBe(lines.length);
    });

    test("POST add-to-grocery respects safe from redirect", async () => {
        const { item } = await seedExpiredFridgeItem();
        const safe = await post(
            `/kitchen/fridge/items/${item.id}/add-to-grocery`,
            `from=${encodeURIComponent("/kitchen/groceries")}`,
        );
        expect(safe.headers.get("location")).toMatch(/^\/kitchen\/groceries/);
        const bad = await post(
            `/kitchen/fridge/items/${item.id}/add-to-grocery`,
            `from=${encodeURIComponent("https://evil.example/")}`,
        );
        expect(bad.headers.get("location")).toMatch(/^\/kitchen\/fridge/);
        const dot = await post(
            `/kitchen/fridge/items/${item.id}/add-to-grocery`,
            `from=${encodeURIComponent("//evil")}`,
        );
        expect(dot.headers.get("location")).toMatch(/^\/kitchen\/fridge/);
    });

    test("GET fridge shows add form and on-list text", async () => {
        const eggs = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Eggs" }),
        );
        const milk = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const withButton = await seedExpiredFridgeItem({ foodId: eggs.id });
        const onList = await seedExpiredFridgeItem({
            foodId: milk.id,
            groceryFoodId: milk.id,
        });
        const { utcTodayFromDate } = await import("../../domain/stock.js");
        const { addFridgeItemAdjust } = await import("../../domain/stock.js");
        const loc =
            (await db.fridgeStore.listLocations(HH))[0] ??
            (await addLocation(db.fridgeStore, HH, "Fridge"));
        const expiring = await addFridgeItemAdjust(
            db.fridgeStore,
            db.stockStore,
            db.foodsStore,
            {
                householdId: HH,
                foodId: eggs.id,
                amount: 2,
                unit: "each",
                locationId: loc.id,
                expiresOn: utcTodayFromDate(),
                actorUserId: ALICE,
            },
        );
        const page = await get("/kitchen/fridge");
        expect(page.status).toBe(200);
        const html = await page.text();
        expect(html).toContain(
            `action="/kitchen/fridge/items/${withButton.item.id}/add-to-grocery"`,
        );
        expect(html).toContain(
            `action="/kitchen/fridge/items/${expiring.item!.id}/add-to-grocery"`,
        );
        const milkRow = html.match(
            new RegExp(
                `<li class="fridge-item" data-item-id="${onList.item.id}"[\\s\\S]*?</li>`,
            ),
        )?.[0];
        expect(milkRow).toBeDefined();
        expect(milkRow!).toContain("fridge-on-list");
        expect(milkRow!).not.toContain("notice-action");
        const expiredRow = html.match(
            new RegExp(
                `<li class="fridge-item" data-item-id="${withButton.item.id}"[\\s\\S]*?</li>`,
            ),
        )?.[0];
        expect(expiredRow).toBeDefined();
        expect(expiredRow!).toContain("notice-action");
        expect(expiredRow!).not.toContain("fridge-on-list");
    });

    test("POST add-to-grocery 4xx for unknown item", async () => {
        const r = await post(
            "/kitchen/fridge/items/missing-id/add-to-grocery",
            "from=%2Ffridge",
        );
        expect(r.status).toBe(400);
    });

    test("POST add-to-grocery 4xx for another household item", async () => {
        const OTHER_HH = "hh-2";
        const { addFridgeItemAdjust } = await import("../../domain/stock.js");
        const otherFood = await db.foodsStore.insertFood(
            newFood({ householdId: OTHER_HH, kind: "food", name: "Other" }),
        );
        const otherLoc = await addLocation(db.fridgeStore, OTHER_HH, "Fridge");
        const otherItem = await addFridgeItemAdjust(
            db.fridgeStore,
            db.stockStore,
            db.foodsStore,
            {
                householdId: OTHER_HH,
                foodId: otherFood.id,
                amount: 1,
                unit: "each",
                locationId: otherLoc.id,
                actorUserId: "other",
            },
        );
        const before = (await db.groceryStore.listLines(HH)).length;
        const r = await post(
            `/kitchen/fridge/items/${otherItem.item!.id}/add-to-grocery`,
            "from=%2Ffridge",
        );
        expect(r.status).toBeGreaterThanOrEqual(400);
        expect(r.status).toBeLessThan(500);
        expect((await db.groceryStore.listLines(HH)).length).toBe(before);
    });
});

describe("social reader settings", () => {
    const MANAGER = "22222222-2222-4222-8222-222222222222";

    beforeEach(() => {
        db.household = {
            name: "Home",
            recipeSearchPlaces: [],
            preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
        };
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: HH,
                userId: MANAGER,
                role: "admin",
                displayName: "Admin",
            },
        ];
    });

    test("owner enables tiktok reader with confirm", async () => {
        const r = await app().request(
            "http://x/settings/household/social-readers",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "reader=tiktok&enabled=1&confirm=1",
            },
        );
        expect(r.status).toBe(303);
        expect(db.household.preferences.socialReaders.tiktok).toBe(true);
    });

    test("owner cannot enable without confirm", async () => {
        const r = await app().request(
            "http://x/settings/household/social-readers",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "reader=tiktok&enabled=1",
            },
        );
        expect(r.status).toBe(400);
        expect(db.household.preferences.socialReaders.tiktok).toBe(false);
    });

    test("manager gets 403", async () => {
        const r = await app().request(
            "http://x/settings/household/social-readers",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(MANAGER),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "reader=tiktok&enabled=1&confirm=1",
            },
        );
        expect(r.status).toBe(403);
    });
});

const BOB = "22222222-2222-4222-8222-222222222222";
const OUTSIDER = "99999999-9999-4999-8999-999999999999";

describe("household members page ui-v2", () => {
    afterAll(() => {
        resetFlagsForTests();
    });

    beforeEach(() => {
        resetFlagsForTests();
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: HH,
                userId: BOB,
                role: "member",
                displayName: "Bob",
            },
        ];
    });

    test("GET /settings/household renders v2 when ui-v2 is on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const r = await app().request("http://x/settings/household", {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).not.toContain("<h1>Household</h1>");
        expect(html).toContain('action="/settings/household/name"');
    });

    test("GET /settings/household stays legacy when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const r = await app().request("http://x/settings/household", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await r.text();
        expect(html).toContain("<h1>Household</h1>");
        expect(html).not.toContain('data-fd-settings-page="household"');
    });

    test("member GET /settings/household is read-only under ui-v2", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const r = await app().request("http://x/settings/household", {
            headers: { cookie: cookieFor(BOB) },
        });
        const html = await r.text();
        expect(html).not.toContain('action="/settings/household/name"');
        expect(html).not.toContain('commandfor="household-add-member"');
    });

    test("member POST to manager-only name change is refused", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const r = await app().request("http://x/settings/household/name", {
            method: "POST",
            headers: {
                cookie: cookieFor(BOB),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Nope",
        });
        expect(r.status).toBe(403);
    });

    test("GET member page shows Today link for a peer", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const r = await app().request(
            `http://x/settings/household/members/${BOB}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain(`href="/?member=${BOB}"`);
    });

    test("member page 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const r = await app().request(
            `http://x/settings/household/members/${BOB}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(404);
    });

    test("any member id is not found when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: HH,
                userId: BOB,
                role: "member",
                displayName: "Bob",
            },
            {
                householdId: "hh-other",
                userId: OUTSIDER,
                role: "member",
                displayName: "Outsider",
            },
        ];
        const r = await app().request(
            `http://x/settings/household/members/${OUTSIDER}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(404);
    });

    test("another household member id is forbidden under ui-v2", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        db.members = [
            {
                householdId: HH,
                userId: ALICE,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: HH,
                userId: BOB,
                role: "member",
                displayName: "Bob",
            },
            {
                householdId: "hh-other",
                userId: OUTSIDER,
                role: "member",
                displayName: "Outsider",
            },
        ];
        const r = await app().request(
            `http://x/settings/household/members/${OUTSIDER}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(403);
    });
});

describe("kitchen usuals ui-v2", () => {
    test("GET /kitchen/usuals serves v2 markup when ui-v2 is on", async () => {
        await seedEggsCatalog();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app().request("http://x/kitchen/usuals", {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("fd-kitchen-usuals-page");
        expect(html).not.toContain("usual-product-add");
        expect(html).toContain(USUALS_INTRO);
        expect(html).toContain("fd-kitchen-tabs");
    });

    test("GET /kitchen/usuals keeps legacy page when ui-v2 is off", async () => {
        await seedEggsCatalog();
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await app().request("http://x/kitchen/usuals", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await res.text();
        expect(html).toContain("Usual products");
        expect(html).not.toContain("fd-kitchen-usuals-page");
    });

    test("GET picker redirects to the list with food query when ui-v2 is on", async () => {
        const { eggs } = await seedEggsCatalog();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app().request(`http://x/kitchen/usuals/${eggs.id}`, {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(res.status).toBe(302);
        expect(res.headers.get("location")).toBe(
            `/kitchen/usuals?food=${eggs.id}`,
        );
    });

    test("GET unknown food query shows a page error without opening a sheet", async () => {
        await seedEggsCatalog();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app().request(
            "http://x/kitchen/usuals?food=does-not-exist",
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Unknown food.");
        expect(html).not.toContain("data-sheet-open-on-load");
        resetFlagsForTests();
    });

    test("POST saves product, store and amount then GET shows them", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const costco = await createGroceryStore(db.settingsStore, HH, "Costco");
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const save = await app().request(`http://x/kitchen/usuals/${eggs.id}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `product_food_id=${kirkland.id}&usual_amount=18&usual_unit=each&usual_store_id=${costco.id}&return_to=%2Fkitchen%2Fusuals`,
        });
        expect(save.status).toBe(303);
        const list = await app().request("http://x/kitchen/usuals", {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await list.text();
        expect(html).toContain("Costco");
        expect(html).toContain("18");
        const prod = await db.foodsStore.getFood(HH, kirkland.id);
        expect(prod?.usualStoreId).toBe(costco.id);
        expect(prod?.usualAmount).toEqual({ amount: 18, unit: "each" });
        resetFlagsForTests();
    });

    test("POST validation error re-renders tab with sheet open", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, eggs.id))!,
            usualProductId: kirkland.id,
        });
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const r = await app().request(`http://x/kitchen/usuals/${eggs.id}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `product_food_id=${kirkland.id}&usual_amount=0&usual_unit=g&return_to=%2Fkitchen%2Fusuals`,
        });
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("fd-kitchen-usuals-page");
        expect(html).toContain(`id="fd-usual-${eggs.id}"`);
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain("greater than zero");
        resetFlagsForTests();
    });

    test("POST validation error keeps the store filter", async () => {
        const { eggs, kirkland } = await seedEggsCatalog();
        const costco = await createGroceryStore(db.settingsStore, HH, "Costco");
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, eggs.id))!,
            usualProductId: kirkland.id,
            usualStoreId: costco.id,
        });
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const back = `/kitchen/usuals?store=${costco.id}`;
        const r = await app().request(`http://x/kitchen/usuals/${eggs.id}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `product_food_id=${kirkland.id}&usual_amount=0&usual_unit=g&return_to=${encodeURIComponent(back)}`,
        });
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain(`name="return_to" value="${back}"`);
        resetFlagsForTests();
    });
});
