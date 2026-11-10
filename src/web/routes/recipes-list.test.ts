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
import { createMemoryFridgeStore } from "../../domain/fridge.js";
import {
    addRecipeIngredientById,
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import * as actualAttention from "../attention.js";
import * as actualNoticeDismissals from "../../db/notice-dismissals.js";
import * as actualGrocery from "../../db/grocery.js";
import { createMemoryNoticeDismissalsStore } from "../../domain/notice-dismissals.js";
import { createMemoryGroceryStore } from "../../domain/grocery.js";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realRecipesDb = { ...actualRecipesDb };
const realFridgeDb = { ...actualFridgeDb };
const realFoodsDb = { ...actualFoodsDb };
const realAttention = { ...actualAttention };
const realNoticeDismissals = { ...actualNoticeDismissals };
const realGrocery = { ...actualGrocery };

const ALICE = "11111111-1111-4111-8111-111111111111";
const HH = "hh-1";

const db = {
    foodsStore: createMemoryFoodsStore(),
    fridgeStore: createMemoryFridgeStore(),
    recipesStore: createMemoryRecipesStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    groceryStore: createMemoryGroceryStore(),
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
});

const { renderRecipesListPage } = await import("../loaders.js");

beforeEach(async () => {
    resetFlagsForTests();
    db.foodsStore = createMemoryFoodsStore();
    db.fridgeStore = createMemoryFridgeStore();
    db.recipesStore = createMemoryRecipesStore();
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.groceryStore = createMemoryGroceryStore();
    db.fridgeStore.linkDismissals(db.dismissalsStore);
    db.recipesStore.linkDismissals(db.dismissalsStore);
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
});

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
