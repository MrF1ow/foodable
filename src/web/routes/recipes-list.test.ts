import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    test,
} from "bun:test";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualRecipesDb from "../../db/recipes.js";
import * as actualFridgeDb from "../../db/fridge.js";
import * as actualFoodsDb from "../../db/foods.js";
import { createMemoryFoodsStore, newFood } from "../../domain/foods.js";
import { addLocation, createMemoryFridgeStore } from "../../domain/fridge.js";
import {
    addRecipeIngredientById,
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import * as actualAttention from "../attention.js";
import * as actualNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualGrocery from "../../db/grocery.js";
import * as actualStock from "../../db/stock.js";
import * as actualRules from "../../db/rules.js";
import * as actualSettings from "../../db/settings.js";
import * as actualNutrition from "../../db/nutrition.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import { createMemoryGroceryStore } from "../../domain/grocery.js";
import {
    addFridgeItemAdjust,
    createMemoryStockStore,
} from "../../domain/stock.js";
import { createMemoryRulesStore } from "../../domain/rules.js";
import { createMemorySettingsStore } from "../../domain/settings.js";
import { Hono } from "hono";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realRecipesDb = { ...actualRecipesDb };
const realFridgeDb = { ...actualFridgeDb };
const realFoodsDb = { ...actualFoodsDb };
const realAttention = { ...actualAttention };
const realNoticeDismissals = { ...actualNoticeDismissals };
const realGrocery = { ...actualGrocery };
const realStock = { ...actualStock };
const realRules = { ...actualRules };
const realSettings = { ...actualSettings };
const realNutrition = { ...actualNutrition };

const ALICE = "11111111-1111-4111-8111-111111111111";
const HH = "hh-1";

process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const db = {
    foodsStore: createMemoryFoodsStore(),
    fridgeStore: createMemoryFridgeStore(),
    recipesStore: createMemoryRecipesStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    groceryStore: createMemoryGroceryStore(),
    stockStore: createMemoryStockStore(),
    rulesStore: createMemoryRulesStore(),
    settingsStore: createMemorySettingsStore(),
    recipeId: "",
    flourId: "",
    profile: {
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
    },
};

mock.module("../../db/foods.js", () => ({
    ...realFoodsDb,
    liveFoodsStore: () => db.foodsStore,
}));
mock.module("../../db/fridge.js", () => ({
    ...realFridgeDb,
    liveFridgeStore: () => db.fridgeStore,
}));
mock.module("../../db/recipes.js", () => ({
    ...realRecipesDb,
    liveRecipesStore: () => db.recipesStore,
}));
mock.module("../../db/grocery.js", () => ({
    ...realGrocery,
    liveGroceryStore: () => db.groceryStore,
}));
mock.module("../../db/stock.js", () => ({
    ...realStock,
    liveStockStore: () => db.stockStore,
}));
mock.module("../../db/rules.js", () => ({
    ...realRules,
    liveRulesStore: () => db.rulesStore,
}));
mock.module("../../db/settings.js", () => ({
    ...realSettings,
    liveSettingsStore: () => db.settingsStore,
}));
mock.module("../../db/nutrition.js", () => ({
    ...realNutrition,
    insertMeal: async () => ({ id: "meal-1" }),
}));
mock.module("../../db/notice-dismissals.js", () => ({
    ...realNoticeDismissals,
    liveNoticeDismissalsStore: () => db.dismissalsStore,
}));
mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) =>
        userId === ALICE ? db.profile : null,
}));
mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE
            ? {
                  userId: ALICE,
                  householdId: HH,
                  role: "owner" as const,
                  displayName: "Alice",
              }
            : null,
    listHouseholdMembers: async () => [
        {
            userId: ALICE,
            householdId: HH,
            role: "owner" as const,
            displayName: "Alice",
        },
    ],
    getHouseholdConfig: async () => ({
        name: "Home",
        recipeSearchPlaces: [],
        preferences: { drink_unit: null, grocery_default_store_id: null },
    }),
    householdExists: async () => true,
    getHouseholdOwnerProfile: async () => ({
        timezone: "UTC",
    }),
}));

afterAll(() => {
    mock.module("../../db/foods.js", () => realFoodsDb);
    mock.module("../../db/fridge.js", () => realFridgeDb);
    mock.module("../../db/recipes.js", () => realRecipesDb);
    mock.module("../../db/grocery.js", () => realGrocery);
    mock.module("../../db/notice-dismissals.js", () => realNoticeDismissals);
    mock.module("../../db/profiles.js", () => realProfiles);
    mock.module("../../db/household.js", () => realHousehold);
    mock.module("../attention.js", () => realAttention);
    mock.module("../../db/stock.js", () => realStock);
    mock.module("../../db/rules.js", () => realRules);
    mock.module("../../db/settings.js", () => realSettings);
    mock.module("../../db/nutrition.js", () => realNutrition);
});

const { renderRecipesListPage, renderRecipeDetailRoute } =
    await import("../loaders.js");
const { recipesRoutes } = await import("./recipes.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function cookieFor(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

function recipesApp() {
    const hono = new Hono();
    hono.route("/", recipesRoutes);
    return hono;
}

function movementFingerprint(
    rows: Awaited<ReturnType<typeof db.stockStore.listMovements>>,
) {
    return rows
        .filter((row) => row.reason === "cook")
        .map((row) => ({
            foodId: row.foodId,
            delta: row.delta,
            unit: row.unit,
            reason: row.reason,
        }));
}

beforeEach(async () => {
    resetFlagsForTests();
    db.foodsStore = createMemoryFoodsStore();
    db.fridgeStore = createMemoryFridgeStore();
    db.recipesStore = createMemoryRecipesStore();
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.groceryStore = createMemoryGroceryStore();
    db.stockStore = createMemoryStockStore();
    db.rulesStore = createMemoryRulesStore();
    db.settingsStore = createMemorySettingsStore();
    db.fridgeStore.linkDismissals(db.dismissalsStore);
    db.recipesStore.linkDismissals(db.dismissalsStore);
    db.foodsStore.linkRefs(db.stockStore);
    const flour = await db.foodsStore.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Flour",
            calories: 364,
            proteinG: 10,
            carbsG: 76,
            fatG: 1,
            gramsPerMl: null,
            gramsPerEach: null,
        }),
    );
    const recipe = await createRecipe(db.recipesStore, {
        householdId: HH,
        creatorId: ALICE,
        name: "Pancakes",
        yieldPortions: 2,
        prepMinutes: 10,
        cookMinutes: 5,
    });
    await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
        householdId: HH,
        recipeId: recipe.id,
        foodId: flour.id,
        amount: 100,
        unit: "g",
    });
    const loc = await addLocation(db.fridgeStore, HH, "Pantry");
    await addFridgeItemAdjust(db.fridgeStore, db.stockStore, db.foodsStore, {
        householdId: HH,
        foodId: flour.id,
        amount: 500,
        unit: "g",
        locationId: loc.id,
        actorUserId: ALICE,
    });
    db.recipeId = recipe.id;
    db.flourId = flour.id;
});

function cookFormBodyFromHtml(html: string): string {
    const form = html.match(
        /<form\b[^>]*\bclass="[^"]*\b(?:fd-recipe-cook|recipe-cook)\b[^"]*"[^>]*>[\s\S]*?<\/form>/,
    )?.[0];
    if (!form) throw new Error("cook form not found in page HTML");
    const params = new URLSearchParams();
    for (const m of form.matchAll(/<input\b([^>]*)\/?>/gi)) {
        const attrs = m[1] ?? "";
        const name = /name="([^"]+)"/.exec(attrs)?.[1];
        if (!name) continue;
        const type = (/type="([^"]+)"/.exec(attrs)?.[1] ?? "text")
            .trim()
            .toLowerCase();
        if (type === "checkbox" || type === "radio") {
            if (!/\bchecked\b/.test(attrs)) continue;
            params.append(name, /value="([^"]+)"/.exec(attrs)?.[1] ?? "on");
            continue;
        }
        const value = /value="([^"]*)"/.exec(attrs)?.[1];
        if (value != null) params.append(name, value);
        else params.append(name, "");
    }
    for (const m of form.matchAll(
        /<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi,
    )) {
        const name = m[1]!;
        const options = m[2] ?? "";
        const selected =
            /<option\b[^>]*\bselected\b[^>]*\bvalue="([^"]*)"/i.exec(options) ??
            /<option\b[^>]*\bvalue="([^"]*)"[^>]*\bselected\b/i.exec(options);
        if (selected) params.append(name, selected[1]!);
    }
    return params.toString();
}

async function restockFlour() {
    const loc = await addLocation(db.fridgeStore, HH, "Pantry");
    await addFridgeItemAdjust(db.fridgeStore, db.stockStore, db.foodsStore, {
        householdId: HH,
        foodId: db.flourId,
        amount: 500,
        unit: "g",
        locationId: loc.id,
        actorUserId: ALICE,
    });
}

afterEach(() => {
    resetFlagsForTests();
});

describe("renderRecipesListPage", () => {
    test("ui-v2 renders the v2 list body", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.status).toBe(200);
        expect(page.html).toContain("fd-recipes-page");
        expect(page.html).toContain("Pancakes");
        expect(page.html).toContain('action="/recipes/import"');
    });

    test("ui-v2 off keeps the legacy list markup", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const page = await renderRecipesListPage(ALICE, {});
        expect(page.html).toContain("recipe-list");
        expect(page.html).not.toContain("fd-recipes-page");
    });

    test("ui-v2 duplicate import surfaces open link", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const page = await renderRecipesListPage(ALICE, {
            importDuplicateRecipeId: "11111111-1111-4111-8111-111111111112",
        });
        expect(page.html).toContain("You already have this recipe");
        expect(page.html).toContain("11111111-1111-4111-8111-111111111112");
    });

    test("ui-v2 filter query trims the card list", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const eggs = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Eggs",
                calories: 140,
                proteinG: 12,
                carbsG: 1,
                fatG: 10,
                gramsPerMl: null,
                gramsPerEach: 50,
            }),
        );
        const high = await createRecipe(db.recipesStore, {
            householdId: HH,
            creatorId: ALICE,
            name: "Egg whites",
            yieldPortions: 1,
            prepMinutes: 5,
            cookMinutes: 5,
        });
        await addRecipeIngredientById(db.recipesStore, db.foodsStore, {
            householdId: HH,
            recipeId: high.id,
            foodId: eggs.id,
            amount: 2,
            unit: "each",
        });
        const page = await renderRecipesListPage(ALICE, {
            q: "egg",
            filter: "quick",
        });
        expect(page.html).toContain("Egg whites");
        expect(page.html).not.toContain("Pancakes");
    });
});

describe("renderRecipeDetailRoute", () => {
    test("ui-v2 renders the v2 recipe page", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(page.status).toBe(200);
        expect(page.html).toContain("fd-recipe-detail");
        expect(page.html).toContain("fd-recipe-cook");
        expect(page.html).toContain("Pantry");
    });

    test("ui-v2 off keeps legacy recipe detail markup", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        expect(page.html).toContain("recipe-cook");
        expect(page.html).not.toContain("fd-recipe-detail");
    });
});

describe("POST /recipes/:id/cook", () => {
    test("v2 cook form posts the same stock movements as the v1 cook form", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
        const v2Page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const v2Body = cookFormBodyFromHtml(v2Page.html);
        const app = recipesApp();
        const v2Res = await app.request(
            `http://x/recipes/${db.recipeId}/cook`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: v2Body,
            },
        );
        expect(v2Res.status).toBe(303);
        const viaV2 = movementFingerprint(
            await db.stockStore.listMovements(HH),
        );

        db.fridgeStore = createMemoryFridgeStore();
        db.stockStore = createMemoryStockStore();
        db.foodsStore.linkRefs(db.stockStore);
        await restockFlour();

        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const v1Page = await renderRecipeDetailRoute(ALICE, db.recipeId);
        const v1Body = cookFormBodyFromHtml(v1Page.html);
        expect(v2Body).toBe(v1Body);

        const v1Res = await app.request(
            `http://x/recipes/${db.recipeId}/cook`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(ALICE),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: v1Body,
            },
        );
        expect(v1Res.status).toBe(303);
        const viaV1 = movementFingerprint(
            await db.stockStore.listMovements(HH),
        );
        expect(viaV2).toEqual(viaV1);
        expect(viaV2.length).toBeGreaterThan(0);
    });
});
