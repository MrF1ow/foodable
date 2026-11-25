import { afterAll, describe, expect, mock, test } from "bun:test";
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
    newFood,
} from "../../domain/foods.js";
import type { HouseholdMember } from "../../household.js";
import * as actualHousehold from "../../db/household.js";
import * as actualFridgeDb from "../../db/fridge.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualFoods from "../../db/foods.js";
import * as actualGrocery from "../../db/grocery.js";
import * as actualSettings from "../../db/settings.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import * as actualRestock from "../../db/restock.js";
import * as actualScoreSettings from "../../db/score-settings.js";
import { createMemoryScoreSettingsStore } from "../../domain/score-settings.js";
import * as actualStock from "../../db/stock.js";
import * as actualAttention from "../attention.js";
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
const realSettings = { ...actualSettings };
const realRestock = { ...actualRestock };
const realScoreSettings = { ...actualScoreSettings };
const realStock = { ...actualStock };
const realAttention = { ...actualAttention };

let fridgeStore = createMemoryFridgeStore();
let foodsStore = createMemoryFoodsStore();
let settingsStore = createMemorySettingsStore();
let stockStore = createMemoryStockStore();
const today = "2026-11-10";

async function seedFridge() {
    fridgeStore = createMemoryFridgeStore();
    settingsStore = createMemorySettingsStore();
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

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns db stubs
mock.module("../../db/settings.js", () => ({
    ...realSettings,
    liveSettingsStore: () => settingsStore,
}));

mock.module("../../db/restock.js", () => ({
    ...realRestock,
    householdToday: async () => today,
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns the score weights the fridge rows read
mock.module("../../db/score-settings.js", () => ({
    ...realScoreSettings,
    liveScoreSettingsStore: () => createMemoryScoreSettingsStore(),
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
            flags,
            identity: {
                viewerName: viewer.displayName,
                viewerRole: viewer.role,
                householdName: "Test household",
                memberCount: 1,
            },
        };
    },
}));

afterAll(() => {
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../../db/fridge.js", () => realFridgeDb);
    mock.module("../../db/profiles.js", () => realProfiles);
    mock.module("../../db/foods.js", () => realFoods);
    mock.module("../../db/grocery.js", () => realGrocery);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restore after route test
    mock.module("../../db/settings.js", () => realSettings);
    mock.module("../../db/restock.js", () => realRestock);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restore after route test
    mock.module("../../db/score-settings.js", () => realScoreSettings);
    mock.module("../../db/stock.js", () => realStock);
    mock.module("../attention.js", () => realAttention);
});

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app } = await import("../../index.js");

function cookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

describe("fridge routes", () => {
    test("GET /kitchen/fridge serves the kitchen page", async () => {
        await seedFridge();
        const res = await app.request("http://x/kitchen/fridge", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("fd-kitchen-fridge-page");
        expect(html).not.toContain("fridge-add-location");
    });

    test("GET /kitchen/fridge offers the household's usuals in the Add sheet with their usual amount", async () => {
        await seedFridge();
        foodsStore = createMemoryFoodsStore();
        const eggs = {
            ...newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                calories: 143,
                proteinG: 12.6,
                carbsG: 0.7,
                fatG: 9.5,
            }),
            id: "f-berries",
            usualAddedAt: "2026-11-01T00:00:00.000Z",
            usualAmount: { amount: 12, unit: "each" },
        };
        await foodsStore.insertFood(eggs);
        const res = await app.request("http://x/kitchen/fridge", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        const row = html.match(
            /<li [^>]*data-fd-fridge-usual="eggs"[\s\S]*?<\/li>/,
        )?.[0];
        expect(row).toContain('<span class="fd-item-row__subtitle">12</span>');
        expect(row).toContain('name="food_id" value="f-berries"');
        expect(row).toContain('name="qty_amount" value="12"');
        expect(row).toContain('name="qty_unit" value="each"');
    });

    test("a supply usual in the Add sheet posts the fields the add route accepts and lands in the fridge", async () => {
        await seedFridge();
        stockStore = createMemoryStockStore();
        foodsStore = createMemoryFoodsStore();
        await foodsStore.insertFood({
            ...newFood({
                householdId: HH,
                kind: "supply",
                name: "Paper towels",
            }),
            id: "f-towels",
            usualAddedAt: "2026-11-01T00:00:00.000Z",
        });
        const page = await app.request("http://x/kitchen/fridge", {
            headers: { cookie: cookie(ALICE) },
        });
        const html = await page.text();
        const row = html.match(
            /<li [^>]*data-fd-fridge-usual="paper towels"[\s\S]*?<\/li>/,
        )?.[0];
        expect(row).toBeDefined();
        const fields = new URLSearchParams();
        for (const m of row!.matchAll(
            /<input type="hidden" name="([^"]+)" value="([^"]*)"/g,
        )) {
            fields.set(m[1]!, m[2]!);
        }
        expect(fields.get("kind")).toBe("supply");
        const res = await app.request("http://x/kitchen/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: fields.toString(),
        });
        expect(res.status).toBe(303);
        const items = await fridgeStore.listItems(HH);
        const added = items.find((i) => i.foodId === "f-towels");
        expect(added?.kind).toBe("supply");
        expect(added?.quantity).toEqual({ amount: 1, unit: "each" });
    });

    test("POST freeze moves item to freezer", async () => {
        await seedFridge();
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

    test("POST eat with negative qty_amount is 400 and leaves stock", async () => {
        fridgeStore = createMemoryFridgeStore();
        foodsStore = createMemoryFoodsStore();
        stockStore = createMemoryStockStore();
        const loc = await fridgeStore.insertLocation({
            id: "loc-fridge",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        const food = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Rice",
        );
        const added = await addFridgeItemAdjust(
            fridgeStore,
            stockStore,
            foodsStore,
            {
                householdId: HH,
                foodId: food.id,
                amount: 100,
                unit: "g",
                locationId: loc.id,
            },
        );
        const res = await app.request(
            `http://x/kitchen/fridge/items/${added.item!.id}/eat`,
            {
                method: "POST",
                headers: {
                    cookie: cookie(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    qty_amount: "-50",
                    return_to: "/kitchen/fridge",
                }).toString(),
            },
        );
        expect(res.status).toBe(400);
        const row = (await fridgeStore.listItems(HH)).find(
            (i) => i.id === added.item!.id,
        )!;
        expect(row.quantity.amount).toBe(100);
        const movements = await stockStore.listMovements(HH);
        expect(movements.filter((m) => m.reason === "eat")).toHaveLength(0);
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
