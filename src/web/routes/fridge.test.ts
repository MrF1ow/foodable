import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import {
    createMemoryFridgeStore,
    defaultFreezeExpiry,
    type FridgeItem,
    type FridgeLocation,
} from "../../domain/fridge.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
} from "../../domain/stock.js";
import {
    createMemoryFoodsStore,
    findOrCreateManualFood,
} from "../../domain/foods.js";
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
import * as actualAttention from "../attention.js";
import { gatedRoutesOf } from "../../test-support/flag-harness.js";
import { mintSiteSession, SITE_COOKIE } from "../../site-session.js";

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
const realAttention = { ...actualAttention };

let fridgeStore = createMemoryFridgeStore();
let foodsStore = createMemoryFoodsStore();
let stockStore = createMemoryStockStore();
const today = "2026-11-10";

async function seedFridge() {
    fridgeStore = createMemoryFridgeStore();
    const fridge: FridgeLocation = {
        id: "loc-fridge",
        householdId: HH,
        name: "Fridge",
        sortOrder: 0,
    };
    const freezer: FridgeLocation = {
        id: "loc-freezer",
        householdId: HH,
        name: "Freezer",
        sortOrder: 1,
    };
    await fridgeStore.insertLocation(fridge);
    await fridgeStore.insertLocation(freezer);
    const item: FridgeItem = {
        id: "it-berries",
        householdId: HH,
        locationId: fridge.id,
        kind: "food",
        displayName: "Berries",
        quantity: { amount: 2, unit: "cup" },
        foodId: "f-berries",
        expiresOn: "2026-11-12",
        purchasedOn: "2026-10-01",
        openedOn: null,
    };
    await fridgeStore.insertItem(item);
}

mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE ? member : null,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns fridge db stub
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

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stock db stub
mock.module("../../db/stock.js", () => ({
    ...realStock,
    liveStockStore: () => stockStore,
}));

mock.module("../../db/grocery.js", () => ({
    ...realGrocery,
    liveGroceryStore: () => ({
        listLines: async () => [],
    }),
}));

mock.module("../../db/restock.js", () => ({
    ...realRestock,
    householdToday: async () => today,
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

describe("fridge routes", () => {
    test("freeze route is ui-v2 gated", () => {
        const gated = gatedRoutesOf(app).find(
            (r) =>
                r.method === "POST" &&
                r.path === "/kitchen/fridge/items/:id/freeze",
        );
        expect(gated).toEqual({
            method: "POST",
            path: "/kitchen/fridge/items/:id/freeze",
            flag: "ui-v2",
            notFound: true,
        });
    });

    test("GET /kitchen/fridge serves v2 markup when ui-v2 is on", async () => {
        await seedFridge();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request("http://x/kitchen/fridge", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("fd-kitchen-fridge-page");
        expect(html).not.toContain("fridge-add-location");
    });

    test("GET /kitchen/fridge keeps legacy page when ui-v2 is off", async () => {
        await seedFridge();
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await app.request("http://x/kitchen/fridge", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await res.text();
        expect(html).toContain('action="/kitchen/fridge/locations"');
        expect(html).not.toContain("fd-kitchen-fridge-page");
    });

    test("POST freeze moves item to freezer", async () => {
        await seedFridge();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const expiry = defaultFreezeExpiry(today);
        const res = await app.request(
            "http://x/kitchen/fridge/items/it-berries/freeze",
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    expires_on: expiry,
                    return_to: "/kitchen/fridge",
                }).toString(),
            },
        );
        expect(res.status).toBe(303);
        const items = await fridgeStore.listItems(HH);
        const row = items.find((i) => i.id === "it-berries")!;
        expect(row.locationId).toBe("loc-freezer");
        expect(row.expiresOn).toBe(expiry);
        expect(row.purchasedOn).toBe("2026-10-01");
    });

    test("POST freeze without a freezer location surfaces an error in the sheet", async () => {
        fridgeStore = createMemoryFridgeStore();
        const fridge: FridgeLocation = {
            id: "loc-only",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        };
        await fridgeStore.insertLocation(fridge);
        await fridgeStore.insertItem({
            id: "it-x",
            householdId: HH,
            locationId: fridge.id,
            kind: "food",
            displayName: "Yogurt",
            quantity: { amount: 1, unit: "each" },
            foodId: "f-y",
            expiresOn: null,
        });
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request(
            "http://x/kitchen/fridge/items/it-x/freeze",
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    expires_on: defaultFreezeExpiry(today),
                    return_to: "/kitchen/fridge?item=it-x",
                }).toString(),
            },
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain('id="fd-fridge-item-it-x"');
        expect(html).toContain("Freezer");
    });

    test("add to list error reopens that item's sheet", async () => {
        fridgeStore = createMemoryFridgeStore();
        const loc = await fridgeStore.insertLocation({
            id: "loc-p",
            householdId: HH,
            name: "Pantry",
            sortOrder: 0,
        });
        await fridgeStore.insertItem({
            id: "supply-1",
            householdId: HH,
            locationId: loc.id,
            kind: "supply",
            displayName: "Paper towels",
            quantity: { amount: 3, unit: "roll" },
            foodId: null,
            expiresOn: null,
        });
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request(
            "http://x/kitchen/fridge/items/supply-1/add-to-grocery",
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    from: "/kitchen/fridge",
                }).toString(),
            },
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        const tag =
            html.match(
                /<dialog[^>]* id="fd-fridge-item-supply-1"[^>]*>/,
            )?.[0] ?? "";
        expect(tag).toContain("data-sheet-open-on-load");
    });

    test("POST quantity without expires_on leaves expiry unchanged", async () => {
        fridgeStore = createMemoryFridgeStore();
        foodsStore = createMemoryFoodsStore();
        stockStore = createMemoryStockStore();
        const fridge = await fridgeStore.insertLocation({
            id: "loc-fridge",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        const food = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Berries",
        );
        const added = await addFridgeItemAdjust(
            fridgeStore,
            stockStore,
            foodsStore,
            {
                householdId: HH,
                foodId: food.id,
                amount: 2,
                unit: "cup",
                locationId: fridge.id,
                actorUserId: ALICE,
                expiresOn: "2026-11-12",
            },
        );
        const item = added.item!;
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request(
            `http://x/kitchen/fridge/items/${item.id}`,
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    qty_amount: "5",
                    qty_unit: "cup",
                    return_to: "/kitchen/fridge",
                }).toString(),
            },
        );
        expect(res.status).toBe(303);
        const row = (await fridgeStore.listItems(HH)).find(
            (i) => i.id === item.id,
        )!;
        expect(row.quantity).toEqual({ amount: 5, unit: "cup" });
        expect(row.expiresOn).toBe("2026-11-12");
    });

    test("unknown item query and blank add reopen flows", async () => {
        await seedFridge();
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const unknown = await app.request(
            "http://x/kitchen/fridge?item=does-not-exist",
            { headers: { cookie: cookie(ALICE) } },
        );
        const unknownHtml = await unknown.text();
        expect(unknownHtml).not.toContain("data-sheet-open-on-load");

        const blank = await app.request("http://x/kitchen/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                kind: "food",
                location_id: "loc-fridge",
                food_name: "  ",
                qty_amount: "1",
                qty_unit: "each",
            }).toString(),
        });
        const blankHtml = await blank.text();
        expect(blank.status).toBe(400);
        expect(blankHtml).toContain('id="fd-fridge-add"');
        expect(blankHtml).toContain("data-sheet-open-on-load");
    });

    test("similar food name renders did you mean in the add sheet", async () => {
        fridgeStore = createMemoryFridgeStore();
        foodsStore = createMemoryFoodsStore();
        stockStore = createMemoryStockStore();
        const loc = await fridgeStore.insertLocation({
            id: "loc-fridge",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        await findOrCreateManualFood(foodsStore, HH, "food", "Eggs");
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const res = await app.request("http://x/kitchen/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                kind: "food",
                location_id: loc.id,
                food_name: "egg",
                qty_amount: "1",
                qty_unit: "each",
            }).toString(),
        });
        const html = await res.text();
        expect(res.status).toBe(409);
        expect(html).toContain("Did you mean");
        expect(html).toContain("data-sheet-open-on-load");
    });
});
