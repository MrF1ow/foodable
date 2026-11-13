import { PRODUCT_DEFAULT_BACK } from "../pages/v2/product.js";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import { legacyRedirects } from "../legacy-redirects.js";
import { legacyRedirectTarget } from "../route-map.js";
import * as actualDbFoods from "../../db/foods.js";
import * as actualDbFridge from "../../db/fridge.js";
import * as actualDbGrocery from "../../db/grocery.js";
import * as actualDbGroceryStores from "../../db/grocery-stores.js";
import * as actualDbHousehold from "../../db/household.js";
import * as actualDbProfiles from "../../db/profiles.js";
import * as actualDbRecipes from "../../db/recipes.js";
import * as actualDbRules from "../../db/rules.js";
import * as actualDbScoreSettings from "../../db/score-settings.js";
import { createMemoryScoreSettingsStore } from "../../domain/score-settings.js";
import * as actualDbSettings from "../../db/settings.js";
import * as actualDbShareLinks from "../../db/share-links.js";
import { createMemoryShareLinkStore } from "../../domain/sharing.js";
import * as actualDbStock from "../../db/stock.js";
import * as actualDbNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualDbPlans from "../../db/plans.js";
import * as actualDbWeighIns from "../../db/weigh-ins.js";
import { createMemoryWeighInStore } from "../../domain/notices-actionable.js";
import { createMemoryPlansStore } from "../../domain/plan.js";
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
import { createMemoryStoreManagement } from "../../domain/grocery-stores.js";
import { createMemoryRecipesStore } from "../../domain/recipes.js";
import { createMemoryRulesStore } from "../../domain/rules.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import { createMemoryStockStore } from "../../domain/stock.js";
import type { FoodResult } from "../../foods.js";
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
import { resetFlagsForTests } from "../../flags.js";
import { USUALS_INTRO } from "../pages/v2/kitchen-usuals.js";

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const realDbFoods = { ...actualDbFoods };
const realDbFridge = { ...actualDbFridge };
const realDbGrocery = { ...actualDbGrocery };
const realDbGroceryStores = { ...actualDbGroceryStores };
const realDbHousehold = { ...actualDbHousehold };
const realDbProfiles = { ...actualDbProfiles };
const realDbRecipes = { ...actualDbRecipes };
const realDbRules = { ...actualDbRules };
const realDbScoreSettings = { ...actualDbScoreSettings };
const realDbSettings = { ...actualDbSettings };
const realDbShareLinks = { ...actualDbShareLinks };
const realDbStock = { ...actualDbStock };
const realDbNoticeDismissals = { ...actualDbNoticeDismissals };
const realDbPlans = { ...actualDbPlans };
const realDbWeighIns = { ...actualDbWeighIns };
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
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
};

const db: {
    profile: actualDbProfiles.Profile;
    members: HouseholdMember[];
    household: HouseholdConfig;
    pluralsSameFood: boolean;
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
    barcodeLookupThrows: boolean;
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
    pluralsSameFood: false,
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
    barcodeLookupThrows: false,
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
mock.module("../../db/grocery-stores.js", () => ({
    ...realDbGroceryStores,
    liveStoreManagement: () =>
        createMemoryStoreManagement(db.settingsStore, db.groceryStore, {
            foods: db.foodsStore,
            dismissals: db.dismissalsStore,
        }),
}));
mock.module("../../db/recipes.js", () => ({
    ...realDbRecipes,
    liveRecipesStore: () => db.recipesStore,
}));
mock.module("../../db/settings.js", () => ({
    ...realDbSettings,
    liveSettingsStore: () => db.settingsStore,
}));
mock.module("../../db/share-links.js", () => ({
    ...realDbShareLinks,
    liveShareLinkStore: () => createMemoryShareLinkStore(),
}));
mock.module("../../db/score-settings.js", () => ({
    ...realDbScoreSettings,
    liveScoreSettingsStore: () => createMemoryScoreSettingsStore(),
}));
mock.module("../../db/rules.js", () => ({
    ...realDbRules,
    liveRulesStore: () => db.rulesStore,
}));
// The new app's notices read plans and weigh-ins; none exist in these tests.
mock.module("../../db/plans.js", () => ({
    ...realDbPlans,
    liveRecipePlansStore: () => createMemoryPlansStore(),
}));
mock.module("../../db/weigh-ins.js", () => ({
    ...realDbWeighIns,
    liveWeighInStore: () => createMemoryWeighInStore([]),
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
    getPluralsSameFood: async () => db.pluralsSameFood,
    setPluralsSameFood: async (_householdId: string, enabled: boolean) => {
        db.pluralsSameFood = enabled;
        return enabled;
    },
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
    lookupBarcode: async (barcode: string) => {
        if (db.barcodeLookupThrows) {
            throw new Error("Network down");
        }
        return db.barcodeFoods[barcode] ?? null;
    },
}));

afterAll(() => {
    mock.module("../../db/foods.js", () => realDbFoods);
    mock.module("../../db/fridge.js", () => realDbFridge);
    mock.module("../../db/stock.js", () => realDbStock);
    mock.module("../../db/grocery.js", () => realDbGrocery);
    mock.module("../../db/grocery-stores.js", () => realDbGroceryStores);
    mock.module("../../db/recipes.js", () => realDbRecipes);
    mock.module("../../db/settings.js", () => realDbSettings);
    mock.module("../../db/share-links.js", () => realDbShareLinks);
    mock.module("../../db/rules.js", () => realDbRules);
    mock.module("../../db/score-settings.js", () => realDbScoreSettings);
    mock.module("../../db/household.js", () => realDbHousehold);
    mock.module("../../db/social-readers.js", () => realDbSocialReaders);
    mock.module("../../db/fetch-memory.js", () => realDbFetchMemory);
    mock.module("../../db/profiles.js", () => realDbProfiles);
    mock.module("../../db/notice-dismissals.js", () => realDbNoticeDismissals);
    mock.module("../../db/plans.js", () => realDbPlans);
    mock.module("../../db/weigh-ins.js", () => realDbWeighIns);
    mock.module("../../foods.js", () => realFoods);
});

const { householdRoutes } = await import("./household.js");
const { settingsRoutes } = await import("./settings.js");
const { groceryRoutes } = await import("./grocery.js");
const { fridgeRoutes } = await import("./fridge.js");
const { foodsRoutes } = await import("./foods.js");
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
    db.barcodeLookupThrows = false;
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

describe("retired household preferences page", () => {
    function settingsApp() {
        const hono = new Hono();
        hono.route("/", householdRoutes);
        hono.route("/", settingsRoutes);
        return hono;
    }

    test("GET /settings/household-settings is not a legacy redirect but lands on the household page", async () => {
        expect(legacyRedirectTarget("/settings/household-settings")).toBeNull();
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
        );
        expect(r.status).toBe(301);
        expect(r.headers.get("location")).toBe("/settings/household");
    });

    test("POST /settings/household-settings is gone and writes nothing", async () => {
        db.configWrites = 0;
        const r = await settingsApp().request(
            "http://x/settings/household-settings",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "timezone=&restock_enabled=true&restock_weekday=3&restock_time=18:00",
            },
        );
        expect(r.status).toBe(404);
        expect(db.configWrites).toBe(0);
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

    test("GET list starts empty", async () => {
        const get = (path: string) =>
            app().request(`http://x${path}`, {
                headers: { cookie: cookieFor(ALICE) },
            });
        await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Cilantro" }),
        );
        const list = await get("/kitchen/usuals");
        expect(list.status).toBe(200);
        const html = await list.text();
        expect(html).toContain("fd-kitchen-usuals-page");
        expect(html).not.toContain("Needs a usual product");
        expect(html).not.toContain("data-sheet-open-on-load");
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

    test("POST items archive keeps nutrition and archives (v2 saved delete)", async () => {
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

    test("fridge barcode create with a plain-food match goes back to the fridge with no link prompt", async () => {
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
        expect(r.headers.get("location")).toBe("/kitchen/fridge");
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

describe("household members page", () => {
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

    test("GET /settings/household renders the members page", async () => {
        const r = await app().request("http://x/settings/household", {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).not.toContain("<h1>Household</h1>");
        expect(html).toContain('action="/settings/household/name"');
    });

    test("member GET /settings/household is read-only", async () => {
        const r = await app().request("http://x/settings/household", {
            headers: { cookie: cookieFor(BOB) },
        });
        const html = await r.text();
        expect(html).not.toContain('action="/settings/household/name"');
        expect(html).not.toContain('commandfor="household-add-member"');
    });

    test("member POST to manager-only name change is refused", async () => {
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

    test("owner can toggle plurals_same_food", async () => {
        db.pluralsSameFood = false;
        const r = await app().request(
            "http://x/settings/household/plurals-same-food",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "plurals_same_food=true",
            },
        );
        expect(r.status).toBe(303);
        expect(db.pluralsSameFood).toBe(true);
    });

    test("member POST plurals_same_food is refused", async () => {
        const r = await app().request(
            "http://x/settings/household/plurals-same-food",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(BOB),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "plurals_same_food=true",
            },
        );
        expect(r.status).toBe(403);
    });

    test("GET member page shows Today link for a peer", async () => {
        const r = await app().request(
            `http://x/settings/household/members/${BOB}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain(`href="/?member=${BOB}"`);
    });

    test("another household member id is forbidden", async () => {
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

describe("kitchen usuals", () => {
    test("GET /kitchen/usuals serves the usuals page", async () => {
        await seedEggsCatalog();
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

    test("GET picker redirects to the list with food query", async () => {
        const { eggs } = await seedEggsCatalog();
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

describe("kitchen usuals restock", () => {
    function restockApp() {
        const hono = new Hono();
        hono.route("/", householdRoutes);
        hono.route("/", foodsRoutes);
        return hono;
    }
    function postSchedule(foodId: string, body: string) {
        return restockApp().request(
            `http://x/kitchen/usuals/${foodId}/schedule`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body,
            },
        );
    }
    async function getUsuals(path = "/kitchen/usuals") {
        const res = await restockApp().request(`http://x${path}`, {
            headers: { cookie: cookieFor(ALICE) },
        });
        return { status: res.status, html: await res.text() };
    }
    async function seedUsual() {
        const seeded = await seedEggsCatalog();
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, seeded.eggs.id))!,
            usualProductId: seeded.kirkland.id,
        });
        await db.foodsStore.updateFoodRow({
            ...(await db.foodsStore.getFood(HH, seeded.kirkland.id))!,
            usualAmount: { amount: 24, unit: "each" },
        });
        return seeded;
    }
    const RESTORE_RESTOCK = { ...DEFAULT_RESTOCK, lastRunOn: "2026-09-15" };
    beforeEach(() => {
        db.household.preferences.restock = { ...RESTORE_RESTOCK };
    });

    test("POST saves the schedule, paused and low level, then the row shows them", async () => {
        const { eggs } = await seedUsual();
        const r = await postSchedule(
            eggs.id,
            "scope=schedule&restock_schedule=every_n_weeks&restock_every_weeks=3&restock_low_level=5&return_to=%2Fkitchen%2Fusuals",
        );
        expect(r.status).toBe(303);
        // Back to the edit sheet the Restock sheet sits in.
        expect(r.headers.get("location")).toBe(
            `/kitchen/usuals?food=${eggs.id}`,
        );
        expect(r.headers.get("set-cookie") ?? "").toContain("foodable_toast");
        const food = await db.foodsStore.getFood(HH, eggs.id);
        expect(food).toMatchObject({
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 3,
            restockPaused: false,
            restockLowLevel: 5,
        });
        const { html } = await getUsuals();
        expect(html).toContain("Every 3 weeks");
        resetFlagsForTests();
    });

    test("POST with the paused box ticked pauses, and blank clears the low level", async () => {
        const { eggs } = await seedUsual();
        await postSchedule(
            eggs.id,
            "scope=schedule&restock_schedule=weekly&restock_low_level=5",
        );
        const r = await postSchedule(
            eggs.id,
            "scope=schedule&restock_schedule=weekly&restock_paused=1&restock_low_level=",
        );
        expect(r.status).toBe(303);
        const food = await db.foodsStore.getFood(HH, eggs.id);
        expect(food).toMatchObject({
            restockSchedule: "weekly",
            restockEveryWeeks: null,
            restockPaused: true,
            restockLowLevel: null,
        });
        const { html } = await getUsuals();
        expect(html).toContain("Paused");
        resetFlagsForTests();
    });

    function postEdit(foodId: string, body: string) {
        return restockApp().request(`http://x/kitchen/usuals/${foodId}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body,
        });
    }

    test("the edit sheet's Save commits the switch with the rest, and an unchecked box turns it off", async () => {
        const { eggs } = await seedUsual();
        await postSchedule(
            eggs.id,
            "scope=schedule&restock_schedule=monthly&restock_low_level=",
        );
        const on = await postEdit(
            eggs.id,
            `product_food_id=&usual_amount=3&usual_unit=each&restock_when_low_present=1&restock_when_low=1&return_to=${encodeURIComponent("/kitchen/usuals?store=s1")}`,
        );
        expect(on.status).toBe(303);
        expect(on.headers.get("location")).toBe("/kitchen/usuals?store=s1");
        let food = await db.foodsStore.getFood(HH, eggs.id);
        expect(food).toMatchObject({
            restockSchedule: "monthly",
            restockWhenLow: true,
        });
        // An unchecked checkbox posts nothing; the marker alone means off.
        await postEdit(
            eggs.id,
            "product_food_id=&usual_amount=3&usual_unit=each&restock_when_low_present=1",
        );
        food = await db.foodsStore.getFood(HH, eggs.id);
        expect(food).toMatchObject({
            restockSchedule: "monthly",
            restockWhenLow: false,
        });
        resetFlagsForTests();
    });

    test("an edit post without the marker (the old app) leaves when-low alone", async () => {
        const { eggs } = await seedUsual();
        await postEdit(
            eggs.id,
            "product_food_id=&usual_amount=3&usual_unit=each&restock_when_low_present=1&restock_when_low=1",
        );
        const r = await postEdit(
            eggs.id,
            "product_food_id=&usual_amount=4&usual_unit=each",
        );
        expect(r.status).toBe(303);
        const food = await db.foodsStore.getFood(HH, eggs.id);
        expect(food?.restockWhenLow).toBe(true);
        resetFlagsForTests();
    });

    test("an invalid N re-renders 400 with the Restock sheet open and nothing saved", async () => {
        const { eggs } = await seedUsual();
        const r = await postSchedule(
            eggs.id,
            "scope=schedule&restock_schedule=every_n_weeks&restock_every_weeks=0&return_to=%2Fkitchen%2Fusuals",
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("whole number of weeks");
        expect(html).toMatch(
            new RegExp(
                `id="fd-usual-${eggs.id}-restock"[^>]*data-sheet-open-on-load`,
            ),
        );
        const food = await db.foodsStore.getFood(HH, eggs.id);
        expect(food?.restockSchedule).toBeNull();
        resetFlagsForTests();
    });

    test("a product is refused with a 400 and keeps its row untouched", async () => {
        const { kirkland } = await seedUsual();
        const r = await postSchedule(
            kirkland.id,
            "scope=schedule&restock_schedule=weekly",
        );
        expect(r.status).toBe(400);
        expect(await r.text()).toContain("product of another food");
        const food = await db.foodsStore.getFood(HH, kirkland.id);
        expect(food?.restockSchedule).toBeNull();
        resetFlagsForTests();
    });

    test("the header names the household restock day only when restocking is on", async () => {
        await seedUsual();
        const off = await getUsuals();
        expect(off.html).not.toContain("restock on");
        db.household.preferences.restock = {
            ...RESTORE_RESTOCK,
            enabled: true,
            weekday: 0,
        };
        const on = await getUsuals();
        expect(on.html).toContain("1 usual · restock on Sundays");
        resetFlagsForTests();
    });
});

const PRODUCT_BARCODE = "737628064502";

function productApp() {
    const hono = new Hono();
    hono.route("/", foodsRoutes);
    return hono;
}

function offProduct(): FoodResult {
    return {
        name: "OFF Greek Yogurt",
        brand: "Fage",
        serving: "170 g",
        serving_quantity: 170,
        serving_quantity_unit: "g",
        calories: 59,
        protein_g: 10,
        carbs_g: 4,
        fat_g: 0.4,
        fiber_g: 0,
        sugar_g: 4,
        alcohol_g: null,
        nutriscore_grade: "a",
        nova_group: 1,
        source: `off:${PRODUCT_BARCODE}`,
        source_name: "openfoodfacts" as const,
        barcode: PRODUCT_BARCODE,
    };
}

describe("product routes (v2 foods)", () => {
    beforeEach(async () => {
        await createGroceryStore(db.settingsStore, HH, "Safeway");
    });

    test("GET /foods/:id 404 for archived food", async () => {
        const food = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Archived" }),
        );
        await db.foodsStore.updateFoodRow({
            ...food,
            archivedAt: "2026-01-01T00:00:00.000Z",
        });
        const res = await productApp().request(`http://x/foods/${food.id}`, {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(res.status).toBe(404);
        resetFlagsForTests();
    });

    test("GET /foods/:id back link uses only a same-origin page, never a script", async () => {
        const food = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Yogurt" }),
        );
        const backFor = async (referer: string) => {
            const res = await productApp().request(
                `http://x/foods/${food.id}`,
                {
                    headers: { cookie: cookieFor(ALICE), referer },
                },
            );
            expect(res.status).toBe(200);
            const html = await res.text();
            return /fd-product-top__back" href="([^"]*)"/.exec(html)?.[1];
        };
        // iOS Safari: the service worker's script URL as the referrer.
        expect(await backFor("http://x/sw.js")).toBe(PRODUCT_DEFAULT_BACK);
        expect(await backFor("http://x/app-v2.js?v=1")).toBe(
            PRODUCT_DEFAULT_BACK,
        );
        expect(await backFor("http://x/api/log/search?q=a")).toBe(
            PRODUCT_DEFAULT_BACK,
        );
        expect(await backFor("https://evil.example/recipes")).toBe(
            PRODUCT_DEFAULT_BACK,
        );
        expect(await backFor("http://x/recipes")).toBe("/recipes");
        resetFlagsForTests();
    });

    test("POST add-to-grocery returns 400 when no store", async () => {
        db.settingsStore = createMemorySettingsStore();
        const food = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Milk" }),
        );
        const res = await productApp().request(
            `http://x/foods/${food.id}/add-to-grocery`,
            {
                method: "POST",
                headers: { cookie: cookieFor(ALICE) },
            },
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Add a store first");
        resetFlagsForTests();
    });

    test("GET by-barcode lookup error shows retry copy not OFF empty", async () => {
        db.barcodeLookupThrows = true;
        const res = await productApp().request(
            `http://x/foods/by-barcode/${PRODUCT_BARCODE}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("Could not look up this barcode");
        expect(html).not.toContain("Open Food Facts does not know");
        resetFlagsForTests();
    });

    test("POST by-barcode twice is duplicate-safe", async () => {
        const code = "8880001112222";
        const post = () =>
            productApp().request(`http://x/foods/by-barcode/${code}`, {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "name=Trail+mix",
            });
        const first = await post();
        const second = await post();
        expect(first.status).toBe(303);
        expect(second.status).toBe(303);
        expect(first.headers.get("location")).toBe(
            second.headers.get("location"),
        );
        expect((await db.foodsStore.listFoods(HH)).length).toBe(1);
        resetFlagsForTests();
    });

    test("GET by-barcode known food redirects without duplicating catalog", async () => {
        const existing = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Household food" }),
        );
        await db.foodsStore.setBarcode(HH, PRODUCT_BARCODE, existing.id);
        db.barcodeFoods[PRODUCT_BARCODE] = offProduct();
        const res = await productApp().request(
            `http://x/foods/by-barcode/${PRODUCT_BARCODE}`,
            { headers: { cookie: cookieFor(ALICE) } },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/foods/${existing.id}`);
        expect((await db.foodsStore.listFoods(HH)).length).toBe(1);
        resetFlagsForTests();
    });
});

describe("settings stores routes", () => {
    const STORES = "http://x/settings/household/stores";
    const FORM = "application/x-www-form-urlencoded";

    afterAll(() => {
        resetFlagsForTests();
    });

    beforeEach(() => {
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

    function post(path: string, user: string, body: string) {
        return app().request(`${STORES}${path}`, {
            method: "POST",
            headers: { cookie: cookieFor(user), "content-type": FORM },
            body,
            redirect: "manual",
        });
    }

    async function seed() {
        const costco = await createGroceryStore(db.settingsStore, HH, "Costco");
        const trader = await createGroceryStore(
            db.settingsStore,
            HH,
            "Trader Joe's",
        );
        return { costco, trader };
    }

    async function addLines(storeId: string, names: string[]) {
        for (const name of names) {
            await addGroceryManualFood(
                db.groceryStore,
                db.settingsStore,
                db.foodsStore,
                { householdId: HH, storeId, name, amount: 1, unit: "each" },
            );
        }
    }

    async function storeNames() {
        return (await db.settingsStore.listStores(HH)).map((row) => row.name);
    }

    test("a member reads the list and a store but cannot write", async () => {
        const { costco } = await seed();
        const list = await app().request(STORES, {
            headers: { cookie: cookieFor(BOB) },
        });
        expect(list.status).toBe(200);
        const html = await list.text();
        expect(html).toContain("Costco");
        expect(html).not.toContain(`${"/settings/household/stores"}/add`);
        expect(html).not.toContain("fd-stores-add");
        const one = await app().request(`${STORES}/${costco.id}`, {
            headers: { cookie: cookieFor(BOB) },
        });
        expect(one.status).toBe(200);
        expect(await one.text()).not.toContain("Delete store");
        for (const [path, body] of [
            ["/add", "name=Aldi"],
            ["/order", `order=${costco.id}`],
            ["/preferences", "use_usual_store=1"],
            [`/${costco.id}/rename`, "name=Nope"],
            [`/${costco.id}/delete`, "mode=delete"],
            [`/${costco.id}/sections`, "name=Deli"],
            [`/${costco.id}/rules/add`, "body=Bring+bags"],
        ] as const) {
            const res = await post(path, BOB, body);
            expect([path, res.status]).toEqual([path, 403]);
        }
        expect(await storeNames()).toEqual(["Costco", "Trader Joe's"]);
    });

    test("the list shows sections, lines on the list and the default store", async () => {
        const { costco, trader } = await seed();
        await addLines(costco.id, ["Oats", "Rice"]);
        await addLines(trader.id, ["Beans"]);
        await post("/preferences", ALICE, `default_store_id=${costco.id}`);
        const res = await app().request(STORES, {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await res.text();
        expect(html).toContain("9 sections");
        expect(html).toContain("2 on the list");
        expect(html).toContain("1 on the list");
        expect(html).toContain(
            `href="/settings/household/stores/${costco.id}"`,
        );
        expect(html).toContain('class="fd-stores-pref__value">Costco<');
    });

    test("add a store, and a repeated name is an error in the sheet", async () => {
        await seed();
        const ok = await post("/add", ALICE, "name=Aldi");
        expect(ok.status).toBe(303);
        expect(ok.headers.get("location")).toBe("/settings/household/stores");
        expect(await storeNames()).toEqual(["Costco", "Trader Joe's", "Aldi"]);
        const dup = await post("/add", ALICE, "name=Aldi");
        expect(dup.status).toBe(400);
        const html = await dup.text();
        expect(html).toContain("That store already exists.");
        expect(html).toContain("data-sheet-open-on-load");
    });

    test("rename a store, refusing a repeated or empty name", async () => {
        const { costco } = await seed();
        const ok = await post(
            `/${costco.id}/rename`,
            ALICE,
            "name=Costco+Wholesale",
        );
        expect(ok.status).toBe(303);
        expect(ok.headers.get("location")).toBe(
            `/settings/household/stores/${costco.id}`,
        );
        expect(await storeNames()).toEqual([
            "Costco Wholesale",
            "Trader Joe's",
        ]);
        const dup = await post(
            `/${costco.id}/rename`,
            ALICE,
            "name=Trader+Joe%27s",
        );
        expect(dup.status).toBe(400);
        expect(await dup.text()).toContain("That store already exists.");
        const empty = await post(`/${costco.id}/rename`, ALICE, "name=+");
        expect(empty.status).toBe(400);
        expect(await empty.text()).toContain("Enter a store name.");
    });

    test("reorder writes the posted order; up and down move one step", async () => {
        const { costco, trader } = await seed();
        const aldi = await createGroceryStore(db.settingsStore, HH, "Aldi");
        const drag = await post(
            "/order",
            ALICE,
            `order=${aldi.id}&order=${costco.id}&order=${trader.id}`,
        );
        expect(drag.status).toBe(303);
        expect(drag.headers.get("location")).toBe(
            "/settings/household/stores?reorder=1",
        );
        expect(await storeNames()).toEqual(["Aldi", "Costco", "Trader Joe's"]);
        const down = await post(
            "/order",
            ALICE,
            `order=${aldi.id}&order=${costco.id}&order=${trader.id}&move=${aldi.id}%3Adown`,
        );
        expect(down.status).toBe(303);
        expect(await storeNames()).toEqual(["Costco", "Aldi", "Trader Joe's"]);
        // An arrow press comes back to the same arrow, with the sheet open.
        expect(down.headers.get("location")).toBe(
            `/settings/household/stores?reorder=1&focus=${aldi.id}%3Adown`,
        );
    });

    test("a stale order is an error banner and writes nothing", async () => {
        const { costco, trader } = await seed();
        const res = await post("/order", ALICE, `order=${trader.id}`);
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("List every store once.");
        expect(html).toContain("data-sheet-open-on-load");
        expect(await storeNames()).toEqual(["Costco", "Trader Joe's"]);
        const gone = await post(
            "/order",
            ALICE,
            `order=${costco.id}&order=${trader.id}&order=${crypto.randomUUID()}`,
        );
        expect(gone.status).toBe(400);
        expect(await gone.text()).toContain("Unknown store.");
    });

    test("preferences: default store and the switch save apart and a foreign store is refused", async () => {
        const { trader } = await seed();
        const def = await post(
            "/preferences",
            ALICE,
            `default_store_id=${trader.id}`,
        );
        expect(def.status).toBe(303);
        expect(await db.settingsStore.getGroceryPreferences(HH)).toEqual({
            defaultStoreId: trader.id,
            useUsualStore: false,
        });
        const on = await post("/preferences", ALICE, "use_usual_store=1");
        expect(on.status).toBe(303);
        expect(await db.settingsStore.getGroceryPreferences(HH)).toEqual({
            defaultStoreId: trader.id,
            useUsualStore: true,
        });
        const off = await post("/preferences", ALICE, "use_usual_store=0");
        expect(off.status).toBe(303);
        const none = await post("/preferences", ALICE, "default_store_id=");
        expect(none.status).toBe(303);
        expect(await db.settingsStore.getGroceryPreferences(HH)).toEqual({
            defaultStoreId: null,
            useUsualStore: false,
        });
        const foreign = await post(
            "/preferences",
            ALICE,
            `default_store_id=${crypto.randomUUID()}`,
        );
        expect(foreign.status).toBe(400);
        expect(await foreign.text()).toContain("Unknown store.");
    });

    test("deleting a store with lines moves them to the chosen store", async () => {
        const { costco, trader } = await seed();
        await addLines(costco.id, ["Oats", "Rice"]);
        const res = await post(
            `/${costco.id}/delete`,
            ALICE,
            `mode=move&move_to=${trader.id}`,
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/settings/household/stores");
        expect(await storeNames()).toEqual(["Trader Joe's"]);
        const lines = await db.groceryStore.listLines(HH);
        expect(lines.map((row) => row.storeId)).toEqual([trader.id, trader.id]);
    });

    test("deleting a store can delete its lines with it", async () => {
        const { costco, trader } = await seed();
        await addLines(costco.id, ["Oats", "Rice"]);
        await addLines(trader.id, ["Beans"]);
        const res = await post(`/${costco.id}/delete`, ALICE, "mode=delete");
        expect(res.status).toBe(303);
        expect(await storeNames()).toEqual(["Trader Joe's"]);
        expect(
            (await db.groceryStore.listLines(HH)).map((r) => r.displayName),
        ).toEqual(["Beans"]);
    });

    test("a store with no lines is deleted after a plain confirm", async () => {
        const { costco } = await seed();
        const res = await post(`/${costco.id}/delete`, ALICE, "");
        expect(res.status).toBe(303);
        expect(await storeNames()).toEqual(["Trader Joe's"]);
    });

    test("a delete decided on a stale line count is refused with the new count", async () => {
        const { costco, trader } = await seed();
        await addLines(costco.id, ["Oats", "Rice"]);
        // The dialog quoted 1 line; a second one arrived before the press.
        for (const mode of [
            `mode=delete&lines=1`,
            `mode=move&move_to=${trader.id}&lines=1`,
        ]) {
            const res = await post(`/${costco.id}/delete`, ALICE, mode);
            expect(res.status).toBe(400);
            const html = await res.text();
            expect(html).toContain("now has 2 lines on the list, not 1");
            expect(html).toContain("Delete the store and its 2 lines");
            expect(html).toContain('name="lines" value="2"');
            expect(html).toContain("data-sheet-open-on-load");
            expect(await storeNames()).toEqual(["Costco", "Trader Joe's"]);
        }
        const ok = await post(
            `/${costco.id}/delete`,
            ALICE,
            "mode=delete&lines=2",
        );
        expect(ok.status).toBe(303);
        expect(await storeNames()).toEqual(["Trader Joe's"]);
    });

    test("a plain confirm quoting 0 lines refuses once lines arrive", async () => {
        const { costco } = await seed();
        await addLines(costco.id, ["Oats"]);
        const res = await post(`/${costco.id}/delete`, ALICE, "lines=0");
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("now has 1 line on the list, not 0");
        expect(await storeNames()).toEqual(["Costco", "Trader Joe's"]);
    });

    test("a plain confirm on a store that gained lines asks again and deletes nothing", async () => {
        const { costco } = await seed();
        await addLines(costco.id, ["Oats"]);
        const res = await post(`/${costco.id}/delete`, ALICE, "");
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Choose what to do with it.");
        expect(html).toContain("data-sheet-open-on-load");
        expect(await storeNames()).toEqual(["Costco", "Trader Joe's"]);
    });

    test("deleting the default store clears the default; the delete dialog offers the move", async () => {
        const { costco, trader } = await seed();
        await addLines(costco.id, ["Oats", "Rice", "Beans"]);
        await post("/preferences", ALICE, `default_store_id=${trader.id}`);
        const page = await app().request(`${STORES}/${costco.id}`, {
            headers: { cookie: cookieFor(ALICE) },
        });
        const html = await page.text();
        expect(html).toContain("Move 3 lines to Trader Joe's");
        expect(html).toContain("Delete the store and its 3 lines");
        const res = await post(`/${trader.id}/delete`, ALICE, "mode=delete");
        expect(res.status).toBe(303);
        expect(await db.settingsStore.getGroceryPreferences(HH)).toEqual({
            defaultStoreId: null,
            useUsualStore: false,
        });
    });

    test("an unknown store page is 404 and deleting it is an error", async () => {
        await seed();
        const id = crypto.randomUUID();
        const page = await app().request(`${STORES}/${id}`, {
            headers: { cookie: cookieFor(ALICE) },
        });
        expect(page.status).toBe(404);
        const res = await post(`/${id}/delete`, ALICE, "mode=delete");
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Unknown store.");
    });

    test("sections: add, rename, reorder, hide and show on a store's page", async () => {
        const { costco } = await seed();
        const added = await post(`/${costco.id}/sections`, ALICE, "name=Deli");
        expect(added.status).toBe(303);
        const sections = () => db.settingsStore.listSections(costco.id);
        expect((await sections()).at(-2)!.name).toBe("Deli");
        const dup = await post(`/${costco.id}/sections`, ALICE, "name=Deli");
        expect(dup.status).toBe(400);
        expect(await dup.text()).toContain("That section already exists.");

        const produce = (await sections()).find((s) => s.name === "Produce")!;
        const renamed = await post(
            `/${costco.id}/sections/${produce.id}/rename`,
            ALICE,
            "name=Fruit+and+veg",
        );
        expect(renamed.status).toBe(303);
        expect((await sections())[0]!.name).toBe("Fruit and veg");

        const movable = (await sections())
            .filter((s) => !s.isOther)
            .map((s) => s.id);
        const reversed = [...movable].reverse();
        const ordered = await post(
            `/${costco.id}/sections/order`,
            ALICE,
            reversed.map((id) => `order=${id}`).join("&"),
        );
        expect(ordered.status).toBe(303);
        expect((await sections())[0]!.id).toBe(reversed[0]!);
        expect((await sections()).at(-1)!.isOther).toBe(true);

        const hide = await post(
            `/${costco.id}/sections/${produce.id}/visibility`,
            ALICE,
            "hidden=1",
        );
        expect(hide.status).toBe(303);
        const page = await (
            await app().request(`${STORES}/${costco.id}`, {
                headers: { cookie: cookieFor(ALICE) },
            })
        ).text();
        expect(page).toContain("Hidden sections");
        const show = await post(
            `/${costco.id}/sections/${produce.id}/visibility`,
            ALICE,
            "hidden=0",
        );
        expect(show.status).toBe(303);
        expect(
            (await sections()).find((s) => s.id === produce.id)!.hidden,
        ).toBe(false);
    });

    test("a section arrow press redirects back to the same arrow", async () => {
        const { costco } = await seed();
        const movable = (await db.settingsStore.listSections(costco.id))
            .filter((s) => !s.isOther)
            .map((s) => s.id);
        const first = movable[0]!;
        const ids = movable.map((id) => `order=${id}`).join("&");
        const press = await post(
            `/${costco.id}/sections/order`,
            ALICE,
            `${ids}&move=${first}%3Adown`,
        );
        expect(press.status).toBe(303);
        expect(press.headers.get("location")).toBe(
            `/settings/household/stores/${costco.id}?focus=${first}%3Adown`,
        );
        const drag = await post(`/${costco.id}/sections/order`, ALICE, ids);
        expect(drag.headers.get("location")).toBe(
            `/settings/household/stores/${costco.id}`,
        );
    });

    test("a stale section order is an error banner and writes nothing", async () => {
        const { costco } = await seed();
        const before = (await db.settingsStore.listSections(costco.id)).map(
            (s) => s.id,
        );
        const res = await post(
            `/${costco.id}/sections/order`,
            ALICE,
            `order=${before[1]}&order=${before[0]}`,
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("List every section once.");
        expect(
            (await db.settingsStore.listSections(costco.id)).map((s) => s.id),
        ).toEqual(before);
    });

    test("another store's section id is refused", async () => {
        const { costco, trader } = await seed();
        const foreign = (await db.settingsStore.listSections(trader.id))[0]!;
        const res = await post(
            `/${costco.id}/sections/${foreign.id}/rename`,
            ALICE,
            "name=Hijack",
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Unknown section.");
        expect(
            (await db.settingsStore.getSection(HH, foreign.id))!.name,
        ).not.toBe("Hijack");
    });

    test("store rules are added on the store's page and shown there", async () => {
        const { costco } = await seed();
        const ok = await post(
            `/${costco.id}/rules/add`,
            ALICE,
            "body=Bring+your+own+bags",
        );
        expect(ok.status).toBe(303);
        const empty = await post(`/${costco.id}/rules/add`, ALICE, "body=+");
        expect(empty.status).toBe(400);
        expect(await empty.text()).toContain("Enter a store rule.");
        const page = await (
            await app().request(`${STORES}/${costco.id}`, {
                headers: { cookie: cookieFor(ALICE) },
            })
        ).text();
        expect(page).toContain("Bring your own bags");
        const stranger = await post(
            `/${crypto.randomUUID()}/rules/add`,
            ALICE,
            "body=Hi",
        );
        expect(stranger.status).toBe(400);
        expect(await stranger.text()).toContain("Unknown store.");
    });
});
