import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
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
    findManualFood,
    newFood,
} from "../../domain/foods.js";
import { addLocation, createMemoryFridgeStore } from "../../domain/fridge.js";
import { createMemoryGroceryStore } from "../../domain/grocery.js";
import {
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
} from "../../domain/settings.js";
import { addAllergen, createMemoryRulesStore } from "../../domain/rules.js";
import { createMemoryStockStore } from "../../domain/stock.js";

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
    listHouseholdMembers: async (householdId: string) =>
        db.members.filter((member) => member.householdId === householdId),
}));
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

const { groceryRoutes } = await import("./grocery.js");
const { fridgeRoutes } = await import("./fridge.js");
const { recipesRoutes } = await import("./recipes.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function app() {
    const hono = new Hono();
    hono.route("/", groceryRoutes);
    hono.route("/", fridgeRoutes);
    hono.route("/", recipesRoutes);
    return hono;
}

async function seedEggs() {
    return db.foodsStore.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Eggs" }),
    );
}

function formBody(fields: Record<string, string>): string {
    return new URLSearchParams(fields).toString();
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

describe("did-you-mean web forms", () => {
    test("grocery manual add", async () => {
        const eggs = await seedEggs();
        const store = await createGroceryStore(db.settingsStore, HH, "Shop");
        const modalId = "grocery-add-food";
        const base = {
            kind: "food",
            store_id: store.id,
            food_name: "chicken egg",
            qty_amount: "2",
            qty_unit: "each",
        };
        const ask = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody(base),
        });
        expect(ask.status).toBe(409);
        const askHtml = await ask.text();
        expect(askHtml).toContain(modalId);
        expect(askHtml).toContain("data-modal-open-on-load");
        expect(askHtml).toContain("Did you mean");
        expect(askHtml).toContain(`name="food_id" value="${eggs.id}"`);
        expect(askHtml).toContain('name="new_food"');
        expect(askHtml).toContain('name="remember_alias"');
        expect(askHtml).toContain('name="qty_amount" value="2"');
        expect((await db.foodsStore.listFoods(HH)).length).toBe(1);
        expect((await db.groceryStore.listLines(HH)).length).toBe(0);

        const createNew = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({ ...base, new_food: "1" }),
        });
        expect(createNew.status).toBe(303);
        expect(
            (await db.foodsStore.listFoods(HH)).some(
                (f) => f.name === "chicken egg",
            ),
        ).toBe(true);
        const extra = (await db.foodsStore.listFoods(HH)).find(
            (f) => f.name === "chicken egg",
        );
        if (extra) {
            await db.foodsStore.updateFoodRow({
                ...extra,
                archivedAt: new Date().toISOString(),
            });
        }
        for (const line of await db.groceryStore.listLines(HH)) {
            await db.groceryStore.deleteLine(HH, line.id);
        }

        const pick = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: eggs.id,
                alias_name: "chicken egg",
            }),
        });
        expect(pick.status).toBe(303);
        const lines = await db.groceryStore.listLines(HH);
        expect(lines).toHaveLength(1);
        expect(lines[0]!.foodId).toBe(eggs.id);
        expect((await db.foodsStore.listAllAliases(HH)).size).toBe(0);

        await db.groceryStore.deleteLine(HH, lines[0]!.id);

        const remember = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: eggs.id,
                alias_name: "chicken egg",
                remember_alias: "1",
            }),
        });
        expect(remember.status).toBe(303);
        const aliasMap = await db.foodsStore.listAllAliases(HH);
        expect([...aliasMap.values()].flat()).toContain("chicken egg");

        const straight = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody(base),
        });
        expect(straight.status).toBe(303);

        const foods = await db.foodsStore.listFoods(HH);
        expect(foods.some((f) => f.name === "chicken egg")).toBe(false);

        const noMatch = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                kind: "food",
                store_id: store.id,
                food_name: "tofu",
                qty_amount: "1",
                qty_unit: "g",
            }),
        });
        expect(noMatch.status).toBe(303);
        expect(
            await findManualFood(db.foodsStore, HH, "food", "tofu"),
        ).not.toBeNull();
    });

    test("fridge manual add", async () => {
        const eggs = await seedEggs();
        const loc = await addLocation(db.fridgeStore, HH, "Fridge");
        const modalId = "fridge-add-food";
        const base = {
            kind: "food",
            location_id: loc.id,
            food_name: "chicken egg",
            qty_amount: "3",
            qty_unit: "each",
        };
        const ask = await app().request("http://x/fridge/items", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody(base),
        });
        expect(ask.status).toBe(409);
        const html = await ask.text();
        expect(html).toContain(modalId);
        expect(html).toContain("data-modal-open-on-load");
        expect(html).toContain(`name="food_id" value="${eggs.id}"`);

        const pick = await app().request("http://x/fridge/items", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: eggs.id,
                alias_name: "chicken egg",
            }),
        });
        expect(pick.status).toBe(303);
        const items = await db.fridgeStore.listItems(HH);
        expect(items).toHaveLength(1);
        expect(items[0]!.foodId).toBe(eggs.id);

        await db.fridgeStore.deleteItem(HH, items[0]!.id);

        const remember = await app().request("http://x/fridge/items", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: eggs.id,
                alias_name: "chicken egg",
                remember_alias: "1",
            }),
        });
        expect(remember.status).toBe(303);
        const direct = await app().request("http://x/fridge/items", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody(base),
        });
        expect(direct.status).toBe(303);

        const newFood = await app().request("http://x/fridge/items", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({ ...base, new_food: "1" }),
        });
        expect(newFood.status).toBe(303);

        const tofu = await app().request("http://x/fridge/items", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                kind: "food",
                location_id: loc.id,
                food_name: "tofu",
                qty_amount: "100",
                qty_unit: "g",
            }),
        });
        expect(tofu.status).toBe(303);
    });

    test("recipe ingredient manual add", async () => {
        const eggs = await seedEggs();
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Omelette",
            yieldPortions: 1,
        });
        const modalId = `recipe-add-ingredient-${recipe.id}`;
        const path = `/recipes/${recipe.id}/ingredients`;
        const base = {
            food_name: "chicken egg",
            qty_amount: "1",
            qty_unit: "each",
        };
        const ask = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody(base),
        });
        expect(ask.status).toBe(409);
        const html = await ask.text();
        expect(html).toContain(modalId);
        expect(html).toContain("data-modal-open-on-load");
        expect(html).toContain(`name="food_id" value="${eggs.id}"`);

        const pick = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: eggs.id,
                alias_name: "chicken egg",
            }),
        });
        expect(pick.status).toBe(303);
        let ings = await db.recipesStore.listIngredients(HH, recipe.id);
        expect(ings).toHaveLength(1);
        expect(ings[0]!.foodId).toBe(eggs.id);
        await db.recipesStore.deleteIngredient(HH, ings[0]!.id);

        const remember = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: eggs.id,
                alias_name: "chicken egg",
                remember_alias: "1",
            }),
        });
        expect(remember.status).toBe(303);
        const direct = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody(base),
        });
        expect(direct.status).toBe(303);

        const newFood = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({ ...base, new_food: "1" }),
        });
        expect(newFood.status).toBe(303);

        const tofu = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                food_name: "tofu",
                qty_amount: "50",
                qty_unit: "g",
            }),
        });
        expect(tofu.status).toBe(303);
        ings = await db.recipesStore.listIngredients(HH, recipe.id);
        const tofuFood = await findManualFood(
            db.foodsStore,
            HH,
            "food",
            "tofu",
        );
        expect(ings.some((row) => row.foodId === tofuFood?.id)).toBe(true);
    });

    test("recipe alias is not saved when ingredient add fails", async () => {
        const eggs = await seedEggs();
        const recipe = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Omelette",
            yieldPortions: 1,
        });
        const path = `/recipes/${recipe.id}/ingredients`;
        const fail = await app().request(`http://x${path}`, {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                food_id: eggs.id,
                food_name: "chicken egg",
                alias_name: "chicken egg",
                remember_alias: "1",
                qty_amount: "0",
                qty_unit: "each",
            }),
        });
        expect(fail.status).toBeGreaterThanOrEqual(400);
        expect(fail.status).toBeLessThan(500);
        const aliasMap = await db.foodsStore.listAllAliases(HH);
        expect([...aliasMap.values()].flat()).not.toContain("chicken egg");
        expect(
            (await db.recipesStore.listIngredients(HH, recipe.id)).length,
        ).toBe(0);
    });
});

describe("did-you-mean allergen replay", () => {
    async function seedWheatNoodles() {
        return db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Noodles",
                allergens: ["wheat"],
            }),
        );
    }

    test("candidate POST runs catalog allergen check without leaked confirm", async () => {
        const noodles = await seedWheatNoodles();
        await addAllergen(db.rulesStore, {
            householdId: HH,
            userId: ALICE,
            allergen: "wheat",
        });
        const store = await createGroceryStore(db.settingsStore, HH, "Shop");
        const base = {
            kind: "food",
            store_id: store.id,
            food_name: "egg noodles",
            qty_amount: "1",
            qty_unit: "g",
        };
        const ask = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({ ...base, confirm_allergen: "1" }),
        });
        expect(ask.status).toBe(409);
        const askHtml = await ask.text();
        const didYouMean = askHtml.match(
            /<div data-fill-transient class="did-you-mean-block">[\s\S]*?<\/form>\s*<\/div>/,
        )?.[0];
        expect(didYouMean).toBeDefined();
        expect(didYouMean!).not.toContain('name="confirm_allergen"');

        const block = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: noodles.id,
                alias_name: "egg noodles",
            }),
        });
        expect(block.status).toBe(400);
        expect((await block.text()).toLowerCase()).toContain("wheat");
        expect((await db.groceryStore.listLines(HH)).length).toBe(0);
    });

    test("allergen override keeps remember_alias for add anyway", async () => {
        const noodles = await seedWheatNoodles();
        await addAllergen(db.rulesStore, {
            householdId: HH,
            userId: ALICE,
            allergen: "wheat",
        });
        const store = await createGroceryStore(db.settingsStore, HH, "Shop");
        const base = {
            kind: "food",
            store_id: store.id,
            food_name: "egg noodles",
            qty_amount: "1",
            qty_unit: "g",
        };
        const block = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: noodles.id,
                alias_name: "egg noodles",
                remember_alias: "1",
            }),
        });
        expect(block.status).toBe(400);
        const html = await block.text();
        expect(html).toContain('name="remember_alias" value="1"');
        expect(html).toContain('name="alias_name" value="egg noodles"');
        const ok = await app().request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                Cookie: cookieFor(ALICE),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formBody({
                ...base,
                food_id: noodles.id,
                alias_name: "egg noodles",
                remember_alias: "1",
                confirm_allergen: "1",
            }),
        });
        expect(ok.status).toBe(303);
        const aliasMap = await db.foodsStore.listAllAliases(HH);
        expect([...aliasMap.values()].flat()).toContain("egg noodles");
        expect((await db.groceryStore.listLines(HH)).length).toBe(1);
    });
});
