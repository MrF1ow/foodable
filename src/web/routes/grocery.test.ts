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
    updateFood,
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
import * as actualScoreSettings from "../../db/score-settings.js";
import { createMemoryScoreSettingsStore } from "../../domain/score-settings.js";
import * as actualNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualAttention from "../attention.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
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
const realSettings = { ...actualSettings };
const realRules = { ...actualRules };
const realScoreSettings = { ...actualScoreSettings };
const realNoticeDismissals = { ...actualNoticeDismissals };
const realAttention = { ...actualAttention };

let groceryStore = createMemoryGroceryStore();
let settingsStore = createMemorySettingsStore();
let foodsStore = createMemoryFoodsStore();
let fridgeStore = createMemoryFridgeStore();
let stockStore = createMemoryStockStore();
const today = "2026-11-10";

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

mock.module("../../db/score-settings.js", () => ({
    ...realScoreSettings,
    liveScoreSettingsStore: () => createMemoryScoreSettingsStore(),
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
    mock.module("../../db/restock.js", () => realRestock);
    mock.module("../../db/stock.js", () => realStock);
    mock.module("../../db/settings.js", () => realSettings);
    mock.module("../../db/rules.js", () => realRules);
    mock.module("../../db/score-settings.js", () => realScoreSettings);
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
    test("GET /kitchen/groceries serves the groceries page", async () => {
        await seedGroceryLines();
        const res = await app.request("http://x/kitchen/groceries", {
            headers: { cookie: cookie(ALICE) },
        });
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain("fd-kitchen-groceries-page");
        expect(html).not.toContain("grocery-store panel");
    });

    test("Share is offered on Groceries only while mcp-share-links is on", async () => {
        await seedGroceryLines();
        const fetchPage = async () => {
            const res = await app.request("http://x/kitchen/groceries", {
                headers: { cookie: cookie(ALICE) },
            });
            expect(res.status).toBe(200);
            return res.text();
        };
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
        const off = await fetchPage();
        expect(off).toContain("fd-kitchen-groceries-page");
        expect(off).not.toContain("Share list");
        expect(off).not.toContain("fd-grocery-share-sheet");
        setFlagsForTests(createMemoryFlags({ "mcp-share-links": true }));
        const on = await fetchPage();
        expect(on).toContain("Share list");
        expect(on).toContain('action="/kitchen/groceries/share"');
    });

    test("POST put-away writes each checked line to its own location and date", async () => {
        const { fridge, pantry, lineA, lineB } = await seedGroceryLines();
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

describe("grocery line routes", () => {
    function post(path: string, fields: Record<string, string | string[]>) {
        const body = new URLSearchParams();
        for (const [name, value] of Object.entries(fields)) {
            for (const v of Array.isArray(value) ? value : [value]) {
                body.append(name, v);
            }
        }
        return app.request(`http://x${path}`, {
            method: "POST",
            headers: {
                cookie: cookie(ALICE),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });
    }

    async function seedTwoStores() {
        const seeded = await seedGroceryLines();
        const other = await createGroceryStore(settingsStore, HH, "Market");
        return { ...seeded, other };
    }

    test("GET with two store params shows only those stores and keeps them for the actions", async () => {
        const { store, other } = await seedTwoStores();
        await addGroceryManualFood(groceryStore, settingsStore, foodsStore, {
            householdId: HH,
            storeId: other.id,
            name: "Plums",
            amount: 2,
            unit: "each",
        });
        const get = async (query: string) => {
            const res = await app.request(
                `http://x/kitchen/groceries${query}`,
                { headers: { cookie: cookie(ALICE) } },
            );
            expect(res.status).toBe(200);
            return res.text();
        };
        const mine = await get(`?store=${store.id}`);
        expect(mine).toContain("Oats");
        expect(mine).not.toContain("Plums");
        expect(mine).toContain(
            `name="return_to" value="/kitchen/groceries?store=${store.id}"`,
        );
        const both = await get(`?store=${store.id}&store=${other.id}`);
        expect(both).toContain("Oats");
        expect(both).toContain("Plums");
        expect(both).toContain(
            `value="/kitchen/groceries?store=${store.id}&amp;store=${other.id}"`,
        );
        // A store that is not the household's is not a filter.
        const unknown = await get("?store=nope");
        expect(unknown).toContain("Oats");
        expect(unknown).toContain("Plums");
    });

    test("POST edit changes the amount, unit and note, and lands back on the list", async () => {
        const { lineA, store } = await seedTwoStores();
        const res = await post(`/kitchen/groceries/lines/${lineA.id}/edit`, {
            qty_amount: "2.5",
            qty_unit: "kg",
            note: " the big bag ",
            return_to: `/kitchen/groceries?store=${store.id}`,
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(
            `/kitchen/groceries?store=${store.id}`,
        );
        const line = (await groceryStore.listLines(HH)).find(
            (row) => row.id === lineA.id,
        )!;
        expect(line.quantity).toEqual({ amount: 2.5, unit: "kg" });
        expect(line.note).toBe("the big bag");
        // The other line is untouched.
        expect(
            (await groceryStore.listLines(HH)).find(
                (r) => r.displayName === "Oil",
            )?.quantity,
        ).toEqual({ amount: 1, unit: "bottle" });
    });

    test("POST edit with a blank note removes it, and a store move keeps the aisle by name or Other", async () => {
        const { lineA, other } = await seedTwoStores();
        await post(`/kitchen/groceries/lines/${lineA.id}/edit`, {
            note: "tasty",
        });
        expect(
            (await groceryStore.listLines(HH)).find((r) => r.id === lineA.id)
                ?.note,
        ).toBe("tasty");
        const res = await post(`/kitchen/groceries/lines/${lineA.id}/edit`, {
            note: "",
            store_id: other.id,
            return_to: `/kitchen/groceries?line=${lineA.id}`,
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(
            `/kitchen/groceries?line=${lineA.id}`,
        );
        const moved = (await groceryStore.listLines(HH)).find(
            (r) => r.id === lineA.id,
        )!;
        expect(moved.note).toBeNull();
        expect(moved.storeId).toBe(other.id);
        const sections = await settingsStore.listSections(other.id);
        expect(sections.some((s) => s.id === moved.sectionId)).toBe(true);
    });

    test("POST edit into a section of the store, by id", async () => {
        const { lineA, store } = await seedTwoStores();
        const sections = await settingsStore.listSections(store.id);
        const target = sections.find((s) => s.id !== lineA.sectionId);
        expect(target).toBeDefined();
        const res = await post(`/kitchen/groceries/lines/${lineA.id}/edit`, {
            section: target!.id,
        });
        expect(res.status).toBe(303);
        expect(
            (await groceryStore.listLines(HH)).find((r) => r.id === lineA.id)
                ?.sectionId,
        ).toBe(target!.id);
    });

    test("POST edit with a bad amount answers 400 with the sheet open and writes nothing", async () => {
        const { lineA } = await seedTwoStores();
        const res = await post(`/kitchen/groceries/lines/${lineA.id}/edit`, {
            qty_amount: "0",
            qty_unit: "kg",
        });
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain("Enter an amount greater than zero.");
        expect(html).toContain("data-sheet-open-on-load");
        expect(
            (await groceryStore.listLines(HH)).find((r) => r.id === lineA.id)
                ?.quantity.amount,
        ).toBe(1);
    });

    test("POST edit keeps update_grocery_line's caps: a note over 500 or a unit over 40 answers 400 and writes nothing", async () => {
        const { lineA } = await seedTwoStores();
        const longNote = await post(
            `/kitchen/groceries/lines/${lineA.id}/edit`,
            {
                note: "x".repeat(501),
            },
        );
        expect(longNote.status).toBe(400);
        const html = await longNote.text();
        expect(html).toContain("500 characters or fewer");
        expect(html).toContain("data-sheet-open-on-load");
        const longUnit = await post(
            `/kitchen/groceries/lines/${lineA.id}/edit`,
            {
                qty_unit: "u".repeat(41),
            },
        );
        expect(longUnit.status).toBe(400);
        expect(await longUnit.text()).toContain("40 characters or fewer");
        const line = (await groceryStore.listLines(HH)).find(
            (row) => row.id === lineA.id,
        )!;
        expect(line.note).toBeNull();
        expect(line.quantity).toEqual({ amount: 1, unit: "kg" });
        // The caps themselves are allowed.
        const edge = await post(`/kitchen/groceries/lines/${lineA.id}/edit`, {
            note: "x".repeat(500),
            qty_unit: "u".repeat(40),
        });
        expect(edge.status).toBe(303);
    });

    test("POST add from the Add sheet with no store lands in the usual's own store, and an explicit store beats it", async () => {
        const { store, other } = await seedTwoStores();
        const coffee = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Coffee",
        );
        await updateFood(
            foodsStore,
            HH,
            coffee.id,
            { usualStoreId: other.id },
            { stores: settingsStore },
        );
        const bean = (id: string) => ({
            kind: "food",
            food_id: id,
            qty_amount: "1",
            qty_unit: "bag",
            return_to: "/kitchen/groceries",
        });
        // No store_id (and so no section_id): the second store, which the usual names.
        const res = await post("/kitchen/groceries/lines", bean(coffee.id));
        expect(res.status).toBe(303);
        const added = (await groceryStore.listLines(HH)).find(
            (row) => row.foodId === coffee.id,
        );
        expect(added?.storeId).toBe(other.id);

        // Posting the filtered store (the one-store filter) is a choice: it wins.
        const tea = await findOrCreateManualFood(foodsStore, HH, "food", "Tea");
        await updateFood(
            foodsStore,
            HH,
            tea.id,
            { usualStoreId: other.id },
            { stores: settingsStore },
        );
        const chosen = await post("/kitchen/groceries/lines", {
            ...bean(tea.id),
            store_id: store.id,
        });
        expect(chosen.status).toBe(303);
        expect(
            (await groceryStore.listLines(HH)).find(
                (row) => row.foodId === tea.id,
            )?.storeId,
        ).toBe(store.id);

        // A food with no store of its own goes where the household's list sends it (the first store).
        const rice = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Rice",
        );
        const plain = await post("/kitchen/groceries/lines", bean(rice.id));
        expect(plain.status).toBe(303);
        expect(
            (await groceryStore.listLines(HH)).find(
                (row) => row.foodId === rice.id,
            )?.storeId,
        ).toBe(store.id);
    });

    test("POST add by hand with no store files it under a store, not an error", async () => {
        await seedTwoStores();
        const res = await post("/kitchen/groceries/lines", {
            kind: "food",
            food_name: "Pears",
            qty_amount: "3",
            qty_unit: "each",
            section_id: "a-section-of-no-store",
            return_to: "/kitchen/groceries",
        });
        expect(res.status).toBe(303);
        expect(
            (await groceryStore.listLines(HH)).some(
                (row) => row.displayName === "Pears",
            ),
        ).toBe(true);
    });

    test("POST edit of a line that is gone is a plain 303", async () => {
        await seedTwoStores();
        const res = await post("/kitchen/groceries/lines/not-a-line/edit", {
            qty_amount: "2",
        });
        expect(res.status).toBe(303);
    });

    test("POST add lands on the page it was posted from, store filter included", async () => {
        const { store } = await seedTwoStores();
        const rice = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Rice",
        );
        const filtered = `/kitchen/groceries?store=${store.id}`;
        const res = await post("/kitchen/groceries/lines", {
            kind: "food",
            food_id: rice.id,
            store_id: store.id,
            qty_amount: "1",
            qty_unit: "bag",
            return_to: filtered,
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(filtered);
        // No return_to: the whole list, as before.
        const beans = await findOrCreateManualFood(
            foodsStore,
            HH,
            "food",
            "Beans",
        );
        const plain = await post("/kitchen/groceries/lines", {
            kind: "food",
            food_id: beans.id,
            qty_amount: "1",
            qty_unit: "can",
        });
        expect(plain.headers.get("location")).toBe("/kitchen/groceries");
    });

    test("POST delete removes one line and lands where it was told", async () => {
        const { lineA, lineB } = await seedTwoStores();
        const res = await post(`/kitchen/groceries/lines/${lineA.id}/delete`, {
            return_to: "/kitchen/groceries?store=x",
        });
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/kitchen/groceries?store=x");
        const left = await groceryStore.listLines(HH);
        expect(left.map((r) => r.id)).toEqual([lineB.id]);
        // A repeat (a double tap) is the same answer.
        const again = await post(
            `/kitchen/groceries/lines/${lineA.id}/delete`,
            {},
        );
        expect(again.status).toBe(303);
    });

    test("put away goes through the stock ledger as before", async () => {
        const { fridge, lineA, lineB } = await seedTwoStores();
        const res = await post("/kitchen/groceries/put-away", {
            line_ids: `${lineA.id},${lineB.id}`,
            [`location_id_${lineA.id}`]: fridge.id,
            [`location_id_${lineB.id}`]: fridge.id,
            return_to: "/kitchen/groceries",
        });
        expect(res.status).toBe(303);
        const movements = await stockStore.listMovements(HH);
        expect(movements.length).toBeGreaterThanOrEqual(2);
    });
});
