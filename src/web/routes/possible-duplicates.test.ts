import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import { Hono } from "hono";
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
import * as actualDbSocialReaders from "../../db/social-readers.js";
import * as actualDbFetchMemory from "../../db/fetch-memory.js";
import { createMemorySocialReaderStatusStore } from "../../domain/social-readers.js";
import { createMemoryFetchMemoryStore } from "../../domain/fetch-memory.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import * as actualFoods from "../../foods.js";
import {
    createMemoryFoodsStore,
    mergeFoodPair,
    newFood,
} from "../../domain/foods.js";
import { addLocation, createMemoryFridgeStore } from "../../domain/fridge.js";
import { applyMovement } from "../../domain/stock.js";
import {
    addGroceryFoodById,
    createMemoryGroceryStore,
} from "../../domain/grocery.js";
import {
    addRecipeIngredientById,
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import { createGroceryStore } from "../../domain/settings.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import { createMemoryRulesStore } from "../../domain/rules.js";
import {
    createMemoryStockStore,
    ledgerMatchesStock,
} from "../../domain/stock.js";
import { DUP_MERGE_MODAL_ID } from "../pages/possible-duplicates.js";
import { noticesFor } from "../../domain/notices-for.js";

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const realDbFoods = { ...actualDbFoods };
const realDbFridge = { ...actualDbFridge };
const realDbGrocery = { ...actualDbGrocery };
const realDbHousehold = { ...actualDbHousehold };
const realDbProfiles = { ...actualDbProfiles };
const realDbSocialReaders = { ...actualDbSocialReaders };
const realDbFetchMemory = { ...actualDbFetchMemory };
const realDbRecipes = { ...actualDbRecipes };
const realDbRules = { ...actualDbRules };
const realDbSettings = { ...actualDbSettings };
const realDbStock = { ...actualDbStock };
const realDbNoticeDismissals = { ...actualDbNoticeDismissals };
const realFoods = { ...actualFoods };

const ALICE = "11111111-1111-4111-8111-111111111111";
const HH = "hh-1";
const HH_OTHER = "hh-other";

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

const db = {
    profile: PROFILE,
    members: [
        {
            householdId: HH,
            userId: ALICE,
            role: "owner" as const,
            displayName: "Alice",
        },
    ],
    household: {
        name: "Home",
        recipeSearchPlaces: [] as string[],
        preferences: {
            drink_unit: null,
            grocery_default_store_id: null,
        },
    },
    foodsStore: createMemoryFoodsStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    fridgeStore: createMemoryFridgeStore(),
    stockStore: createMemoryStockStore(),
    groceryStore: createMemoryGroceryStore(),
    recipesStore: createMemoryRecipesStore(),
    settingsStore: createMemorySettingsStore(),
    rulesStore: createMemoryRulesStore(),
    barcodeFoods: {} as Record<string, unknown>,
};

mock.module("../../db/foods.js", () => ({
    ...realDbFoods,
    liveFoodsStore: () => db.foodsStore,
    mergeLiveFoodPair: (
        householdId: string,
        input: Parameters<typeof mergeFoodPair>[2],
    ) => mergeFoodPair(db.foodsStore, householdId, input),
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
    listHouseholdMembers: async (householdId: string) =>
        db.members.filter((member) => member.householdId === householdId),
}));
// The Members page reads recipe-fetch memory and social reader status (#175).
mock.module("../../db/social-readers.js", () => ({
    ...realDbSocialReaders,
    liveSocialReaderStatusStore: () => createMemorySocialReaderStatusStore(),
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
    lookupBarcode: async () => null,
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
    mock.module("../../db/profiles.js", () => realDbProfiles);
    mock.module("../../db/social-readers.js", () => realDbSocialReaders);
    mock.module("../../db/fetch-memory.js", () => realDbFetchMemory);
    mock.module("../../db/notice-dismissals.js", () => realDbNoticeDismissals);
    mock.module("../../foods.js", () => realFoods);
});

const { householdRoutes } = await import("./household.js");
const { recipesRoutes } = await import("./recipes.js");
const { groceryRoutes } = await import("./grocery.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function app() {
    const hono = new Hono();
    hono.route("/", householdRoutes);
    hono.route("/", recipesRoutes);
    hono.route("/", groceryRoutes);
    return hono;
}

async function seedDuplicatePair() {
    const store = db.foodsStore;
    const egg = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "chicken egg",
            calories: 100,
            proteinG: 11,
            allergens: ["egg"],
        }),
    );
    const eggs = await store.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggs",
            calories: 140,
            proteinG: 12,
            allergens: ["egg", "milk"],
        }),
    );
    return { egg, eggs };
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
    db.foodsStore.linkRefs(db.fridgeStore);
    db.foodsStore.linkRefs(db.stockStore);
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

describe("possible-duplicates routes", () => {
    test("Keep separate removes pair and badge", async () => {
        const { egg, eggs } = await seedDuplicatePair();
        const before = await app().request(
            "http://x/settings/household/possible-duplicates",
            {
                headers: { Cookie: cookieFor(ALICE) },
            },
        );
        expect(before.status).toBe(200);
        expect(await before.text()).toContain("chicken egg");

        const keep = await app().request(
            "http://x/settings/household/possible-duplicates/keep-separate",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `subject_id=${encodeURIComponent(egg.id)}&related_id=${encodeURIComponent(eggs.id)}`,
            },
        );
        expect(keep.status).toBe(303);
        const after = await app().request(
            "http://x/settings/household/possible-duplicates",
            {
                headers: { Cookie: cookieFor(ALICE) },
            },
        );
        const html = await after.text();
        expect(html).toContain("No possible duplicates");
        const items = await app().request("http://x/settings/household/items", {
            headers: { Cookie: cookieFor(ALICE) },
        });
        expect(await items.text()).not.toContain("Possible duplicates");
    });

    test("Keep separate rejects another household's pair", async () => {
        const otherStore = createMemoryFoodsStore();
        const a = await otherStore.insertFood(
            newFood({ householdId: HH_OTHER, kind: "food", name: "egg" }),
        );
        const b = await otherStore.insertFood(
            newFood({ householdId: HH_OTHER, kind: "food", name: "eggs" }),
        );
        const res = await app().request(
            "http://x/settings/household/possible-duplicates/keep-separate",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `subject_id=${encodeURIComponent(a.id)}&related_id=${encodeURIComponent(b.id)}`,
            },
        );
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
        expect((await db.dismissalsStore.listForHousehold(HH)).length).toBe(0);
    });

    test("merge keeps default, swapped keep, conflicting pick, and allergens", async () => {
        const { egg, eggs } = await seedDuplicatePair();
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Omelette",
            yieldPortions: 1,
        });
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: recipe.id,
            foodId: eggs.id,
            amount: 2,
            unit: "each",
        });
        // Stock gives Eggs the most references, so it is the default keep
        // although "chicken egg" is older.
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        await applyMovement(db.fridgeStore, db.stockStore, db.foodsStore, {
            householdId: HH,
            foodId: eggs.id,
            delta: 6,
            unit: "each",
            reason: "purchase",
            locationId: loc.id,
        });
        const page = await app().request(
            "http://x/settings/household/possible-duplicates",
            { headers: { Cookie: cookieFor(ALICE) } },
        );
        const html = await page.text();
        const keepRadio = (id: string) =>
            new RegExp(`name="keep_id" value="${id}"( checked)? />`).exec(
                html,
            )?.[1];
        expect(keepRadio(eggs.id)).toBe(" checked");
        expect(keepRadio(egg.id)).toBeUndefined();

        // Swap the keep to "chicken egg" and take Eggs' calories.
        const body = new URLSearchParams({
            food_a: egg.id,
            food_b: eggs.id,
            keep_id: egg.id,
            pick_calories: eggs.id,
            pick_protein_g: egg.id,
        });
        const merged = await app().request(
            "http://x/settings/household/possible-duplicates/merge",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            },
        );
        expect(merged.status).toBe(303);
        const kept = await db.foodsStore.getFood(HH, egg.id);
        expect(kept!.archivedAt).toBeNull();
        expect(kept!.name).toBe("chicken egg");
        expect(kept!.calories).toBe(140);
        expect(kept!.proteinG).toBe(11);
        expect(kept!.allergens.slice().sort()).toEqual(["egg", "milk"]);
        const dropped = await db.foodsStore.getFood(HH, eggs.id);
        expect(dropped!.archivedAt).not.toBeNull();
        const items = await db.fridgeStore.listItems(HH);
        expect(items.map((item) => item.foodId)).toEqual([egg.id]);
    });

    test("merge with stock keeps ledger balanced", async () => {
        const { egg, eggs } = await seedDuplicatePair();
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        await db.foodsStore.updateFoodRow({
            ...egg,
            defaultUnit: "each",
            gramsPerEach: 50,
        });
        await db.foodsStore.updateFoodRow({
            ...eggs,
            defaultUnit: "each",
            gramsPerEach: 50,
        });
        await applyMovement(db.fridgeStore, db.stockStore, db.foodsStore, {
            householdId: HH,
            foodId: egg.id,
            delta: 3,
            unit: "each",
            reason: "purchase",
            locationId: loc.id,
        });
        await applyMovement(db.fridgeStore, db.stockStore, db.foodsStore, {
            householdId: HH,
            foodId: eggs.id,
            delta: 6,
            unit: "each",
            reason: "purchase",
            locationId: loc.id,
        });
        const res = await app().request(
            "http://x/settings/household/possible-duplicates/merge",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    food_a: egg.id,
                    food_b: eggs.id,
                    keep_id: egg.id,
                    pick_calories: eggs.id,
                }).toString(),
            },
        );
        expect(res.status).toBe(303);
        const items = await db.fridgeStore.listItems(HH);
        const movements = await db.stockStore.listMovements(HH);
        const keptFood = (await db.foodsStore.getFood(HH, egg.id))!;
        expect(ledgerMatchesStock(items, movements, keptFood)).toBe(true);
        expect(items.every((i) => i.foodId === egg.id)).toBe(true);
        expect(items.every((i) => i.foodId !== eggs.id)).toBe(true);
        expect(movements.every((m) => m.foodId === egg.id)).toBe(true);
        expect(movements.every((m) => m.foodId !== eggs.id)).toBe(true);
    });

    test("merge validation error reopens modal without writes", async () => {
        const { egg, eggs } = await seedDuplicatePair();
        const foodsBefore = await db.foodsStore.listFoods(HH);
        const res = await app().request(
            "http://x/settings/household/possible-duplicates/merge",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    food_a: egg.id,
                    food_b: eggs.id,
                    keep_id: egg.id,
                    pick_calories: crypto.randomUUID(),
                }).toString(),
            },
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain(`id="${DUP_MERGE_MODAL_ID}"`);
        expect(html).toContain("data-modal-open-on-load");
        expect(html).toContain("data-filled-template=");
        expect(html).toContain('name="pick_calories"');
        expect(html).toMatch(
            new RegExp(
                `name="pick_protein_g"[\\s\\S]*value="${egg.id}"[\\s\\S]*checked`,
            ),
        );
        const foodsAfter = await db.foodsStore.listFoods(HH);
        expect(foodsAfter.map((f) => f.id).sort()).toEqual(
            foodsBefore.map((f) => f.id).sort(),
        );
    });

    test("merge rejects keep_id outside the pair", async () => {
        const { egg, eggs } = await seedDuplicatePair();
        const solo = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "solo" }),
        );
        const res = await app().request(
            "http://x/settings/household/possible-duplicates/merge",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    food_a: egg.id,
                    food_b: eggs.id,
                    keep_id: solo.id,
                }).toString(),
            },
        );
        expect(res.status).toBe(400);
        expect(await res.text()).toContain("Keep must be one of the two");
    });

    test("sub-nav shows Possible duplicates only when list is non-empty", async () => {
        const empty = await app().request("http://x/settings/household/items", {
            headers: { Cookie: cookieFor(ALICE) },
        });
        expect(await empty.text()).not.toContain("Possible duplicates");
        await seedDuplicatePair();
        const members = await app().request("http://x/settings/household", {
            headers: { Cookie: cookieFor(ALICE) },
        });
        expect(await members.text()).toContain("Possible duplicates");
    });

    test("recipe ingredient and grocery line link to possible duplicates", async () => {
        const { egg, eggs } = await seedDuplicatePair();
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Custard",
            yieldPortions: 2,
        });
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: recipe.id,
            foodId: eggs.id,
            amount: 1,
            unit: "each",
        });
        const store = await createGroceryStore(db.settingsStore, HH, "Shop");
        await addGroceryFoodById(
            db.groceryStore,
            db.settingsStore,
            db.foodsStore,
            {
                householdId: HH,
                storeId: store.id,
                foodId: egg.id,
                amount: 1,
                unit: "each",
            },
        );
        const recipeHtml = await (
            await app().request(`http://x/recipes/${recipe.id}`, {
                headers: { Cookie: cookieFor(ALICE) },
            })
        ).text();
        expect(recipeHtml).toContain("Possible duplicate of");
        expect(recipeHtml).toContain("/settings/household/possible-duplicates");
        const groceryHtml = await (
            await app().request("http://x/kitchen/groceries", {
                headers: { Cookie: cookieFor(ALICE) },
            })
        ).text();
        expect(groceryHtml).toContain("Possible duplicate of");
        const solo = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "solo rice" }),
        );
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: recipe.id,
            foodId: solo.id,
            amount: 1,
            unit: "g",
        });
        const recipeWithSolo = await (
            await app().request(`http://x/recipes/${recipe.id}`, {
                headers: { Cookie: cookieFor(ALICE) },
            })
        ).text();
        expect(recipeWithSolo).toContain("solo rice");
        expect(recipeWithSolo).not.toMatch(
            /solo rice[\s\S]{0,240}Possible duplicate of/,
        );
    });

    test("noticesFor still exposes pair count for chrome", async () => {
        await seedDuplicatePair();
        const result = await noticesFor(
            {
                foods: db.foodsStore,
                fridge: db.fridgeStore,
                recipes: db.recipesStore,
                dismissals: db.dismissalsStore,
                grocery: db.groceryStore,
            },
            HH,
            { today: "2026-01-15" },
        );
        expect(result.possibleDuplicatePairs).toHaveLength(1);
        expect(
            result.notices.some((n) => n.code === "food.possible_duplicate"),
        ).toBe(true);
    });
});

describe("possible-duplicates routes ui-v2", () => {
    afterAll(() => {
        resetFlagsForTests();
    });

    test("keep-separate success redirects to household settings when ui-v2 is on", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { egg, eggs } = await seedDuplicatePair();
        const keep = await app().request(
            "http://x/settings/household/possible-duplicates/keep-separate",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `subject_id=${encodeURIComponent(egg.id)}&related_id=${encodeURIComponent(eggs.id)}`,
            },
        );
        expect(keep.status).toBe(303);
        expect(keep.headers.get("location")).toBe("/settings/household");
    });

    test("keep-separate success still goes to the standalone page when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const { egg, eggs } = await seedDuplicatePair();
        const keep = await app().request(
            "http://x/settings/household/possible-duplicates/keep-separate",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: `subject_id=${encodeURIComponent(egg.id)}&related_id=${encodeURIComponent(eggs.id)}`,
            },
        );
        expect(keep.status).toBe(303);
        expect(keep.headers.get("location")).toBe(
            "/settings/household/possible-duplicates",
        );
    });

    test("merge validation with ui-v2 re-renders household settings", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const { egg, eggs } = await seedDuplicatePair();
        const solo = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "solo" }),
        );
        const res = await app().request(
            "http://x/settings/household/possible-duplicates/merge",
            {
                method: "POST",
                headers: {
                    Cookie: cookieFor(ALICE),
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    food_a: egg.id,
                    food_b: eggs.id,
                    keep_id: solo.id,
                }).toString(),
            },
        );
        expect(res.status).toBe(400);
        const html = await res.text();
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain(`id="${DUP_MERGE_MODAL_ID}"`);
        expect(html).toContain("data-modal-open-on-load");
    });
});
