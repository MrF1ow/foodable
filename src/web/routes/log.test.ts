import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    mock,
    test,
} from "bun:test";
import type { HouseholdMember } from "../../household.js";
import {
    createMemoryFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "../../flags.js";
import * as actualHousehold from "../../db/household.js";
import * as actualProfiles from "../../db/profiles.js";
import * as actualFoodsDb from "../../db/foods.js";
import * as actualFridgeDb from "../../db/fridge.js";
import * as actualRecipesDb from "../../db/recipes.js";
import * as actualMealsDb from "../../db/meals.js";
import * as actualScoreSettingsDb from "../../db/score-settings.js";
import * as actualNutritionDb from "../../db/nutrition.js";
import * as actualFoodSearch from "../../food-search.js";
import { TOASTS } from "../../copy/toasts.js";
import type { FoodResult } from "../../foods.js";
import * as actualFoods from "../../foods.js";
import {
    catalogNutritionFromOff,
    createMemoryFoodsStore,
    matchFoodsByWords,
    newFood,
    updateFood,
    type FoodQuality,
} from "../../domain/foods.js";
import { foodDisplayScore } from "../../domain/product-screen.js";
import { createMemoryFridgeStore } from "../../domain/fridge.js";
import {
    createMemoryScoreSettingsStore,
    updateMemberScoreSettings,
} from "../../domain/score-settings.js";
import {
    createMemoryRecipesStore,
    createRecipe,
} from "../../domain/recipes.js";
import {
    checkRateLimit,
    checkWebSearchRateLimit,
    _resetBuckets,
} from "../../rate-limit.js";
import * as actualAttention from "../attention.js";
import * as actualDashboardData from "../../dashboard-data.js";
import * as actualLoadersToday from "../loaders-today.js";
import * as actualLoadersPlan from "../loaders-plan.js";
import { buildWeekPlanView } from "../pages/v2/recipes-plan.js";
import { buildPreviewTodayView } from "../pages/v2/today.js";

const realHousehold = { ...actualHousehold };
const realProfiles = { ...actualProfiles };
const realFoodsDb = { ...actualFoodsDb };
const realFridgeDb = { ...actualFridgeDb };
const realRecipesDb = { ...actualRecipesDb };
const realMealsDb = { ...actualMealsDb };
const realScoreSettingsDb = { ...actualScoreSettingsDb };
const realNutritionDb = { ...actualNutritionDb };
const realFoodSearch = { ...actualFoodSearch };
// Snapshots taken before mock.module: Bun patches the namespace in place.
const realAttention = { ...actualAttention };
const realFoods = { ...actualFoods };
const realDashboardData = { ...actualDashboardData };
const realLoadersToday = { ...actualLoadersToday };
const realLoadersPlan = { ...actualLoadersPlan };

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const HH = "hh-1";
const BARCODE = "1111111111111";

const member: HouseholdMember = {
    userId: ALICE,
    householdId: HH,
    role: "owner",
    displayName: "Alice",
};

const db = {
    foodsStore: createMemoryFoodsStore(),
    fridgeStore: createMemoryFridgeStore(),
    recipesStore: createMemoryRecipesStore(),
    scoreSettingsStore: createMemoryScoreSettingsStore(),
};

let offThrows = false;
let offServing = "30 g";
let offCalls = 0;
const rangeCalls: Array<{
    userId: string;
    start: string;
    end: string;
    tz: string;
}> = [];
const recentLogsCalls: Array<{ userId: string; limit: number }> = [];
let listFoodsCalls = 0;
let listRecipesCalls = 0;
let listFridgeItemsCalls = 0;
const mealsInserted: Array<Record<string, unknown>> = [];
let rangeMealsOverride: Awaited<
    ReturnType<typeof realNutritionDb.getMealsInRange>
> | null = null;
let recentLogsOverride: Awaited<
    ReturnType<typeof realMealsDb.recentLogs>
> | null = null;

function defaultRecentHistoryMeals(): Awaited<
    ReturnType<typeof realMealsDb.recentLogs>
> {
    return [
        {
            id: "meal-recipe",
            user_id: ALICE,
            logged_at: "2026-11-01T19:00:00.000Z",
            meal_type: "dinner",
            description: "Chili night",
            calories: 400,
            protein_g: 20,
            carbs_g: 30,
            fat_g: 10,
            fiber_g: null,
            sugar_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            notes: null,
            idempotency_key: null,
            items: [
                {
                    id: "item-1",
                    meal_id: "meal-recipe",
                    user_id: ALICE,
                    household_id: HH,
                    food_id: null,
                    recipe_id: "recipe-chili",
                    label: "Chili",
                    amount: 1,
                    unit: "portion",
                    grams: null,
                    portions: 1,
                    calories: 400,
                    protein_g: 20,
                    carbs_g: 30,
                    fat_g: 10,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                    caffeine_mg: null,
                    sort_order: 0,
                    created_at: "2026-11-01T19:00:00.000Z",
                },
            ],
        },
    ];
}
const waterInserted: Array<Record<string, unknown>> = [];
const weightsInserted: Array<Record<string, unknown>> = [];

function offHit(query: string): FoodResult {
    return {
        name: `OFF ${query}`,
        brand: "OE",
        serving: offServing,
        serving_quantity: offServing === "30 g" ? 30 : 100,
        serving_quantity_unit: "g",
        calories: 150,
        protein_g: 3,
        carbs_g: 20,
        fat_g: 6,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        nutriscore_grade: null,
        nova_group: null,
        source: `off:${BARCODE}`,
        source_name: "openfoodfacts" as const,
        barcode: BARCODE,
    };
}

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/household.js", () => ({
    ...realHousehold,
    getHouseholdMembership: async (userId: string) =>
        userId === ALICE ? member : null,
    householdExists: async () => true,
    listHouseholdMembers: async () => [member],
    getHouseholdConfig: async () => ({
        household_id: HH,
        name: "Test",
        preferences: { timezone: null },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
    }),
    getHouseholdOwnerProfile: async () => ({
        timezone: "America/Los_Angeles",
    }),
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/profiles.js", () => ({
    ...realProfiles,
    getProfile: async (userId: string) => {
        if (userId === ALICE) {
            return {
                user_id: ALICE,
                theme: "light",
                timezone: "America/Los_Angeles",
                preferred_weight_unit: "lb",
                widgets_enabled: true,
                alcohol_tracking_enabled: false,
                preferred_drink_unit: null,
                nutrition_layout: null,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
            };
        }
        if (userId === BOB) {
            return {
                user_id: BOB,
                theme: "light",
                timezone: "America/Los_Angeles",
                preferred_weight_unit: "kg",
                widgets_enabled: true,
                alcohol_tracking_enabled: false,
                preferred_drink_unit: null,
                nutrition_layout: null,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
            };
        }
        return null;
    },
}));

// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/foods.js", () => ({
    ...realFoodsDb,
    liveFoodsStore: () => db.foodsStore,
}));
// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/fridge.js", () => ({
    ...realFridgeDb,
    liveFridgeStore: () => db.fridgeStore,
}));
// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/recipes.js", () => ({
    ...realRecipesDb,
    liveRecipesStore: () => db.recipesStore,
}));
// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/score-settings.js", () => ({
    ...realScoreSettingsDb,
    liveScoreSettingsStore: () => db.scoreSettingsStore,
}));
// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/meals.js", () => ({
    ...realMealsDb,
    recentLogs: async (userId: string, limit: number) => {
        recentLogsCalls.push({ userId, limit });
        if (recentLogsOverride != null) return recentLogsOverride;
        return defaultRecentHistoryMeals().slice(0, limit);
    },
}));
// oxlint-disable-next-line foodable/no-db-mock-outside-windows -- route test owns stubs in this file
mock.module("../../db/nutrition.js", () => ({
    ...realNutritionDb,
    insertMeal: async (userId: string, input: Record<string, unknown>) => {
        mealsInserted.push({ userId, ...input });
        return {
            meal: {
                id: `meal-${mealsInserted.length}`,
                user_id: userId,
                ...input,
            },
            deduplicated: false,
        };
    },
    insertWater: async (userId: string, input: Record<string, unknown>) => {
        waterInserted.push({ userId, ...input });
        return {
            entry: {
                id: `water-${waterInserted.length}`,
                user_id: userId,
                ...input,
            },
            deduplicated: false,
        };
    },
    insertWeight: async (userId: string, input: Record<string, unknown>) => {
        weightsInserted.push({ userId, ...input });
        return {
            entry: {
                id: `weight-${weightsInserted.length}`,
                user_id: userId,
                ...input,
            },
            deduplicated: false,
        };
    },
    searchMeals: async () => [],
    getMealsByDate: async () => [],
    getWaterByDate: async () => [],
    getGoalsForDate: async () => null,
    getLatestWeight: async (userId: string) => {
        if (userId === ALICE) {
            return {
                weight_g: 83007,
                logged_at: "2026-11-04T12:00:00.000Z",
            };
        }
        if (userId === BOB) {
            return {
                weight_g: 90000,
                logged_at: "2026-11-03T12:00:00.000Z",
            };
        }
        return null;
    },
    getWaterInRange: async () => [],
    getGoalsForRange: async () => ({
        forDate: () => null,
    }),
    getWeightInRange: async () => [],
    getNutritionGoals: async () => null,
    getMealsInRange: async (
        userId: string,
        start: string,
        end: string,
        tz: string,
    ) => {
        rangeCalls.push({ userId, start, end, tz });
        if (rangeMealsOverride != null) return rangeMealsOverride;
        return [
            {
                id: "meal-recipe",
                user_id: ALICE,
                logged_at: "2026-11-01T19:00:00.000Z",
                meal_type: "dinner",
                description: "Chili night",
                calories: 400,
                protein_g: 20,
                carbs_g: 30,
                fat_g: 10,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
                notes: null,
                idempotency_key: null,
                items: [
                    {
                        id: "item-1",
                        meal_id: "meal-recipe",
                        user_id: ALICE,
                        household_id: HH,
                        food_id: null,
                        recipe_id: "recipe-chili",
                        label: "Chili",
                        amount: 1,
                        unit: "portion",
                        grams: null,
                        portions: 1,
                        calories: 400,
                        protein_g: 20,
                        carbs_g: 30,
                        fat_g: 10,
                        fiber_g: null,
                        sugar_g: null,
                        alcohol_g: null,
                        caffeine_mg: null,
                        sort_order: 0,
                        created_at: "2026-11-01T19:00:00.000Z",
                    },
                ],
            },
        ];
    },
}));
mock.module("../../food-search.js", () => ({
    ...realFoodSearch,
    searchFoodsByName: async (query: string) => {
        offCalls += 1;
        if (offThrows) throw new Error("off down");
        return [offHit(query)];
    },
}));

mock.module("../attention.js", () => ({
    ...realAttention,
    viewerChromeWithAttention: async (
        profile: { timezone?: string | null } | null,
        viewer: HouseholdMember,
    ) => {
        const flags = await realAttention.viewerFlagsFor(viewer);
        const tz =
            profile?.timezone && profile.timezone.trim()
                ? profile.timezone
                : "America/Los_Angeles";
        return {
            theme: "light" as const,
            attention: { count: 0, tabs: {} },
            householdPossibleDuplicates: 0,
            flags,
            ...(flags.uiV2 ? { v2Timezone: tz } : {}),
            identity: {
                viewerName: viewer.displayName,
                viewerRole: viewer.role,
                householdName: "Test",
                memberCount: 1,
            },
        };
    },
}));

const widgetStub = { locale: "en" };
mock.module("../../dashboard-data.js", () => ({
    ...realDashboardData,
    getNutritionSummaryPayload: async () => widgetStub,
    getGoalProgressPayload: async () => widgetStub,
    getTrendsPayload: async () => widgetStub,
    getWeightTrendsPayload: async () => widgetStub,
}));

// This week reads the plans table; these tests do not run against one.
mock.module("../loaders-plan.js", () => ({
    ...realLoadersPlan,
    loadWeekPlanView: async () =>
        buildWeekPlanView({
            today: "2026-11-10",
            plans: [],
            recipes: [],
            stock: [],
            foodsById: new Map(),
        }),
}));

mock.module("../loaders-today.js", () => ({
    ...realLoadersToday,
    loadToday: async () => buildPreviewTodayView("2026-11-10"),
}));

// The barcode path must never reach the live Open Food Facts API.
mock.module("../../foods.js", () => ({
    ...realFoods,
    lookupBarcode: async (barcode: string) =>
        barcode === BARCODE ? offHit("barcode") : null,
}));

afterAll(() => {
    mock.module("../../foods.js", () => realFoods);
    mock.module("../attention.js", () => realAttention);
    mock.module("../../dashboard-data.js", () => realDashboardData);
    mock.module("../loaders-today.js", () => realLoadersToday);
    mock.module("../loaders-plan.js", () => realLoadersPlan);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/household.js", () => realHousehold);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/profiles.js", () => realProfiles);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/foods.js", () => realFoodsDb);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/fridge.js", () => realFridgeDb);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/recipes.js", () => realRecipesDb);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/score-settings.js", () => realScoreSettingsDb);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/meals.js", () => realMealsDb);
    // oxlint-disable-next-line foodable/no-db-mock-outside-windows -- restores stubs taken before mock
    mock.module("../../db/nutrition.js", () => realNutritionDb);
    mock.module("../../food-search.js", () => realFoodSearch);
});

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";
process.env.OFF_USER_AGENT ||= "Foodable (test@example.com)";

const { app } = await import("../../index.js");
const { mintSiteSession, SITE_COOKIE } = await import("../../site-session.js");

function sessionCookie(userId: string): string {
    return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
}

const searchUrl = "http://x/api/log/search";

type Body = {
    groups: Array<{
        kind: string;
        items: Array<Record<string, unknown>>;
    }>;
};

async function search(q: string, extra = ""): Promise<Body> {
    const res = await app.request(
        `${searchUrl}?q=${encodeURIComponent(q)}${extra}`,
        { headers: { cookie: sessionCookie(ALICE) } },
    );
    expect(res.status).toBe(200);
    return (await res.json()) as Body;
}

function names(body: Body): string[] {
    return body.groups.flatMap((g) => g.items.map((i) => String(i.name)));
}

afterEach(async () => {
    resetFlagsForTests();
    await _resetBuckets();
});

beforeEach(async () => {
    rangeMealsOverride = null;
    recentLogsOverride = null;
    mealsInserted.length = 0;
    waterInserted.length = 0;
    weightsInserted.length = 0;
    offThrows = false;
    offServing = "30 g";
    offCalls = 0;
    rangeCalls.length = 0;
    recentLogsCalls.length = 0;
    listFoodsCalls = 0;
    listRecipesCalls = 0;
    listFridgeItemsCalls = 0;
    db.foodsStore = createMemoryFoodsStore();
    db.scoreSettingsStore = createMemoryScoreSettingsStore();
    db.fridgeStore = createMemoryFridgeStore();
    db.recipesStore = createMemoryRecipesStore();
    const foodsList = db.foodsStore.listFoods.bind(db.foodsStore);
    db.foodsStore.listFoods = async (householdId: string) => {
        listFoodsCalls += 1;
        return foodsList(householdId);
    };
    const recipesList = db.recipesStore.listRecipes.bind(db.recipesStore);
    db.recipesStore.listRecipes = async (householdId: string) => {
        listRecipesCalls += 1;
        return recipesList(householdId);
    };
    const fridgeItems = db.fridgeStore.listItems.bind(db.fridgeStore);
    db.fridgeStore.listItems = async (householdId: string) => {
        listFridgeItemsCalls += 1;
        return fridgeItems(householdId);
    };
    await db.foodsStore.insertFood(
        newFood({ householdId: HH, kind: "food", name: "Egg", calories: 155 }),
    );
    await db.foodsStore.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Eggplant",
            calories: 25,
        }),
    );
    const rice = await db.foodsStore.insertFood(
        newFood({
            householdId: HH,
            kind: "food",
            name: "Fried rice",
            calories: 160,
        }),
    );
    await db.foodsStore.setAlias(HH, "aubergine", rice.id);
    const plant = (await db.foodsStore.listFoods(HH)).find(
        (row) => row.name === "Eggplant",
    )!;
    await db.foodsStore.setAlias(HH, "aubergine", plant.id);
    await createRecipe(db.recipesStore, {
        householdId: HH,
        creatorId: ALICE,
        name: "Omelette",
        yieldPortions: 2,
    });
    listFoodsCalls = 0;
    listRecipesCalls = 0;
    listFridgeItemsCalls = 0;
    setFlagsForTests(createMemoryFlags({ "ui-v2": true, "off-lookups": true }));
});

describe("GET /api/log/search", () => {
    test("returns 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const res = await app.request(`${searchUrl}?q=egg`, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(404);
    });

    test("a NUL byte in the query is dropped, not a Postgres 500", async () => {
        const res = await app.request(`${searchUrl}?q=a%00b`, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(200);
    });

    test("signed out serves the login page like other member JSON routes", async () => {
        const res = await app.request(`${searchUrl}?q=egg`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
    });

    test("q=egg returns the household food first", async () => {
        const body = await search("egg");
        const food = body.groups.find((g) => g.kind === "food");
        expect(food?.items.map((i) => i.name)).toEqual(["Egg", "Eggplant"]);
    });

    test("plural, alias, and word-order household hits are kept", async () => {
        const listed = await db.foodsStore.listFoods(HH);
        const aliases = await db.foodsStore.listAllAliases(HH);
        expect(
            matchFoodsByWords("eggs", listed, aliases).map((f) => f.name),
        ).toEqual(["Egg", "Eggplant"]);
        const eggs = await search("eggs");
        const alias = await search("aubergine");
        const swapped = await search("rice fried");
        expect(names(eggs)).toContain("Egg");
        expect(names(alias)).toContain("Eggplant");
        expect(names(swapped)).toContain("Fried rice");
    });

    test("OFF per-serving calories are not labeled kcal_per_100g", async () => {
        const hit = offHit("cookie");
        expect(catalogNutritionFromOff(hit).calories).toBeNull();
        const body = await search("cookie");
        const off = body.groups.find((g) => g.kind === "off");
        expect(off?.items[0]?.kcal_per_100g).toBeUndefined();
        expect(off?.items[0]?.barcode).toBe(BARCODE);
        expect(listFoodsCalls).toBe(1);
        expect(listRecipesCalls).toBe(1);
        expect(listFridgeItemsCalls).toBe(1);
    });

    test("already-saved barcode is omitted from OFF results", async () => {
        offServing = "100 g";
        const egg = (await db.foodsStore.listFoods(HH)).find(
            (row) => row.name === "Egg",
        )!;
        await db.foodsStore.setBarcode(HH, BARCODE, egg.id);
        const body = await search("egg");
        expect(body.groups.some((g) => g.kind === "off")).toBe(false);
    });

    test("an OFF hit is kept when no household name contains the query", async () => {
        const body = await search("coke");
        const off = body.groups.find((g) => g.kind === "off");
        expect(off?.items.map((i) => i.name)).toEqual(["OFF coke"]);
    });

    test("a saved barcode on a food the query did not match lists that food instead", async () => {
        const oreos = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Oreos" }),
        );
        await db.foodsStore.setBarcode(HH, BARCODE, oreos.id);
        const body = await search("cookie");
        expect(body.groups.some((g) => g.kind === "off")).toBe(false);
        const food = body.groups.find((g) => g.kind === "food");
        expect(food?.items.map((i) => i.food_id)).toContain(oreos.id);
    });

    test("a barcode on an archived food does not hide the OFF product", async () => {
        const oreos = await db.foodsStore.insertFood(
            newFood({ householdId: HH, kind: "food", name: "Oreos" }),
        );
        await db.foodsStore.setBarcode(HH, BARCODE, oreos.id);
        await updateFood(db.foodsStore, HH, oreos.id, { archived: true });
        const body = await search("cookie");
        const off = body.groups.find((g) => g.kind === "off");
        expect(off?.items.map((i) => i.barcode)).toEqual([BARCODE]);
        expect(names(body)).not.toContain("Oreos");
    });

    test("OFF failure still returns household foods", async () => {
        offThrows = true;
        const body = await search("egg");
        expect(names(body)).toEqual(["Egg", "Eggplant"]);
        expect(body.groups.some((g) => g.kind === "off")).toBe(false);
    });

    test("with off-lookups off there is no off group", async () => {
        setFlagsForTests(
            createMemoryFlags({ "ui-v2": true, "off-lookups": false }),
        );
        const body = await search("egg");
        expect(body.groups.some((g) => g.kind === "off")).toBe(false);
        expect(offCalls).toBe(0);
    });

    test("stock and history sources carry product_score when the food scores", async () => {
        const quality: FoodQuality = {
            nutriscoreGrade: "a",
            novaGroup: 1,
            ecoscoreGrade: "b",
            additives: [],
            allergensTags: [],
            tracesTags: null,
            ingredientsAnalysisTags: [],
            labelsTags: [],
            fetchedAt: "2026-01-01T00:00:00.000Z",
        };
        const scored = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Greek yogurt",
                calories: 59,
                proteinG: 10,
                sugarG: 4,
                saturatedFatG: 2,
                gramsPerEach: 170,
                offQuality: quality,
            }),
        );
        const expected = foodDisplayScore(scored);
        expect(expected).not.toBeNull();
        const loc = await db.fridgeStore.insertLocation({
            id: "loc-fridge",
            householdId: HH,
            name: "Fridge",
            sortOrder: 0,
        });
        await db.fridgeStore.insertItem({
            id: "fridge-yogurt",
            householdId: HH,
            locationId: loc.id,
            kind: "food",
            displayName: scored.name,
            quantity: { amount: 2, unit: "each" },
            foodId: scored.id,
        });
        const { buildLogSearchSources } = await import("./log.js");
        const built = await buildLogSearchSources({
            householdId: HH,
            userId: ALICE,
            query: "greek",
            limit: 20,
            timezone: "America/Los_Angeles",
        });
        const stockRow = built.sources.stock?.find(
            (row) => row.food_id === scored.id,
        );
        expect(stockRow?.product_score).toBe(expected);
        const body = await search("greek");
        const history = body.groups.find((g) => g.kind === "history");
        expect(history).toBeUndefined();
        const foodRow = body.groups
            .find((g) => g.kind === "food")
            ?.items.find((i) => i.food_id === scored.id);
        expect(foodRow?.product_score).toBe(expected);

        recentLogsOverride = [
            {
                id: "meal-yogurt",
                user_id: ALICE,
                logged_at: "2026-11-10T12:00:00.000Z",
                meal_type: "snack",
                description: "Yogurt",
                calories: 100,
                protein_g: 17,
                carbs_g: 4,
                fat_g: 1,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: null,
                notes: null,
                idempotency_key: null,
                items: [
                    {
                        id: "item-yogurt",
                        meal_id: "meal-yogurt",
                        user_id: ALICE,
                        household_id: HH,
                        food_id: scored.id,
                        recipe_id: null,
                        label: "Greek yogurt",
                        amount: 1,
                        unit: "each",
                        grams: 170,
                        portions: null,
                        calories: 100,
                        protein_g: 17,
                        carbs_g: 4,
                        fat_g: 1,
                        fiber_g: null,
                        sugar_g: null,
                        alcohol_g: null,
                        caffeine_mg: null,
                        sort_order: 0,
                        created_at: "2026-11-10T12:00:00.000Z",
                    },
                ],
            },
        ];
        const empty = await buildLogSearchSources({
            householdId: HH,
            userId: ALICE,
            query: "",
            limit: 20,
            timezone: "America/Los_Angeles",
        });
        expect(empty.sources.history?.[0]?.product_score).toBe(expected);
    });

    test("score badges use the viewer's weights, in the results and in the source builder", async () => {
        const scored = await db.foodsStore.insertFood(
            newFood({
                householdId: HH,
                kind: "food",
                name: "Greek yogurt",
                gramsPerEach: 170,
                offQuality: {
                    nutriscoreGrade: "a",
                    novaGroup: 4,
                    ecoscoreGrade: "b",
                    additives: [],
                    allergensTags: [],
                    tracesTags: null,
                    ingredientsAnalysisTags: [],
                    labelsTags: [],
                    fetchedAt: "2026-01-01T00:00:00.000Z",
                },
            }),
        );
        const scoreOf = async () =>
            (await search("greek")).groups
                .find((g) => g.kind === "food")
                ?.items.find((i) => i.food_id === scored.id)?.product_score;
        const byDefault = await scoreOf();
        expect(byDefault).toBe(foodDisplayScore(scored));
        await updateMemberScoreSettings(db.scoreSettingsStore, HH, ALICE, {
            choice: {
                preset: "custom",
                weights: {
                    nutrition: 0,
                    processing: 100,
                    additives: 0,
                    environment: 0,
                },
            },
        });
        const custom = await scoreOf();
        expect(custom).not.toBe(byDefault);
        expect(custom).toBe(
            foodDisplayScore(scored, {
                nutrition: 0,
                processing: 100,
                additives: 0,
                environment: 0,
            }),
        );
    });

    test("empty q returns history without OFF and recipe meals carry re-log fields", async () => {
        const empty = await search("");
        expect(offCalls).toBe(0);
        expect(empty.groups.map((g) => g.kind)).toEqual(["history"]);
        expect(recentLogsCalls[0]).toMatchObject({
            userId: ALICE,
            limit: 20,
        });
        const item = empty.groups[0]!.items[0]!;
        expect(item.id).toBe("meal-recipe");
        expect(item.meal_id).toBe("meal-recipe");
        expect(item.recipe_id).toBe("recipe-chili");
        expect(item.kcal).toBe(400);
        expect(item.meal_kcal).toBe(400);
        expect(item.amount).toBe(1);
        expect(item.unit).toBe("portion");
        expect(item.unit_hints).toEqual(["portion"]);
    });

    test("recipe results use portion-only unit hints", async () => {
        const body = await search("omelette");
        const recipe = body.groups.find((g) => g.kind === "recipe");
        expect(recipe?.items[0]).toMatchObject({
            name: "Omelette",
            unit_hints: ["portion"],
            source: "recipe",
        });
        expect(recipe?.items[0]?.kcal_per_100g).toBeUndefined();
    });

    test("five household hits skip OFF unless online=1", async () => {
        for (const name of [
            "Bean one",
            "Bean two",
            "Bean three",
            "Bean four",
            "Bean five",
        ]) {
            await db.foodsStore.insertFood(
                newFood({ householdId: HH, kind: "food", name, calories: 40 }),
            );
        }
        const plain = await search("bean");
        expect(plain.groups.some((g) => g.kind === "off")).toBe(false);
        expect(offCalls).toBe(0);
        const online = await search("bean", "&online=1");
        expect(online.groups.some((g) => g.kind === "off")).toBe(true);
        expect(offCalls).toBe(1);
    });

    test("web search rate limit is independent of the MCP bucket", async () => {
        for (let i = 0; i < 70; i++) await checkRateLimit(ALICE);
        expect((await checkRateLimit(ALICE)).allowed).toBe(false);
        const res = await app.request(`${searchUrl}?q=egg`, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(res.status).toBe(200);
        for (let i = 0; i < 120; i++) await checkWebSearchRateLimit(ALICE);
        const blocked = await app.request(`${searchUrl}?q=egg`, {
            headers: { cookie: sessionCookie(ALICE) },
        });
        expect(blocked.status).toBe(429);
        expect((await checkRateLimit(ALICE)).allowed).toBe(false);
        expect((await checkWebSearchRateLimit(ALICE)).allowed).toBe(false);
        expect((await checkWebSearchRateLimit(ALICE)).limit).toBe(120);
    });
});

const logPostUrl = "http://x/log";

function logForm(fields: Record<string, string>): {
    body: URLSearchParams;
    headers: Record<string, string>;
} {
    const body = new URLSearchParams(fields);
    return {
        body,
        headers: {
            cookie: sessionCookie(ALICE),
            "content-type": "application/x-www-form-urlencoded",
        },
    };
}

describe("POST /log", () => {
    test("returns 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const { body, headers } = logForm({
            food_id: "x",
            amount: "100",
            unit: "g",
            meal_type: "lunch",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(404);
    });

    test("logging 150 g of a food writes one meal and scales totals 1.5× per 100 g", async () => {
        const rice = (await db.foodsStore.listFoods(HH)).find(
            (row) => row.name === "Fried rice",
        )!;
        await updateFood(db.foodsStore, HH, rice.id, {
            calories: 100,
            proteinG: 10,
            carbsG: 20,
            fatG: 5,
        });
        const { body, headers } = logForm({
            food_id: rice.id,
            amount: "150",
            unit: "g",
            meal_type: "lunch",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(mealsInserted).toHaveLength(1);
        const row = mealsInserted[0]!;
        expect(row.calories).toBe(150);
        expect(row.protein_g).toBe(15);
        expect(row.carbs_g).toBe(30);
        expect(row.fat_g).toBe(7.5);
        const items = row.items as Array<Record<string, unknown>>;
        expect(items).toHaveLength(1);
        expect(items[0]!.food_id).toBe(rice.id);
    });

    test("recipe portion writes one meal with a recipe item", async () => {
        const recipes = await db.recipesStore.listRecipes(HH);
        const recipe = recipes[0]!;
        const { body, headers } = logForm({
            recipe_id: recipe.id,
            amount: "1",
            unit: "portion",
            meal_type: "dinner",
            logged_at: "2026-11-01T18:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(mealsInserted).toHaveLength(1);
        const items = mealsInserted[0]!.items as Array<Record<string, unknown>>;
        expect(items).toHaveLength(1);
        expect(items[0]!.recipe_id).toBe(recipe.id);
    });

    test("offset-less local time stays on that local day in the profile zone", async () => {
        const egg = (await db.foodsStore.listFoods(HH)).find(
            (row) => row.name === "Egg",
        )!;
        await updateFood(db.foodsStore, HH, egg.id, { gramsPerEach: 50 });
        const { body, headers } = logForm({
            food_id: egg.id,
            amount: "1",
            unit: "each",
            meal_type: "dinner",
            logged_at: "2026-11-01T21:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        const logged = String(mealsInserted[0]!.logged_at);
        expect(logged).toBe("2026-11-02T05:00:00.000Z");
    });

    test("OFF barcode creates the household food and logs it", async () => {
        offServing = "100 g";
        const { body, headers } = logForm({
            barcode: BARCODE,
            amount: "100",
            unit: "g",
            meal_type: "snack",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(mealsInserted).toHaveLength(1);
        const items = mealsInserted[0]!.items as Array<Record<string, unknown>>;
        expect(items).toHaveLength(1);
        expect(items[0]!.food_id).toBeTruthy();
        const barcodes = await db.foodsStore.getBarcodeFoodIds(HH, [BARCODE]);
        expect(barcodes.get(BARCODE)).toBe(String(items[0]!.food_id));
    });

    test("amount above limit returns 400", async () => {
        const egg = (await db.foodsStore.listFoods(HH)).find(
            (row) => row.name === "Egg",
        )!;
        const { body, headers } = logForm({
            food_id: egg.id,
            amount: "5001",
            unit: "g",
            meal_type: "lunch",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(400);
        expect(mealsInserted).toHaveLength(0);
        const html = await res.text();
        expect(html).toContain("fd-log-amount");
        expect(html).not.toContain("Adjust the amount and try again.");
        // The error shows once, inside the reopened sheet, not also as a
        // page-level banner.
        expect(html).not.toContain('class="error-banner');
    });

    test("unknown meal_type returns 400", async () => {
        const egg = (await db.foodsStore.listFoods(HH)).find(
            (row) => row.name === "Egg",
        )!;
        const { body, headers } = logForm({
            food_id: egg.id,
            amount: "50",
            unit: "g",
            meal_type: "brunch",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(400);
        expect(mealsInserted).toHaveLength(0);
    });

    test("invalid unit returns 4xx and does not write", async () => {
        const egg = (await db.foodsStore.listFoods(HH)).find(
            (row) => row.name === "Egg",
        )!;
        const { body, headers } = logForm({
            food_id: egg.id,
            amount: "1",
            unit: "ml",
            meal_type: "lunch",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(logPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(400);
        expect(mealsInserted).toHaveLength(0);
    });
});

const quickPostUrl = "http://x/log/quick";
const waterPostUrl = "http://x/log/water";
const weightPostUrl = "http://x/log/weight";

describe("POST /log/quick", () => {
    test("returns 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const { body, headers } = logForm({
            calories: "350",
            meal_type: "snack",
        });
        const res = await app.request(quickPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(404);
    });

    test("writes quick calories without logged_at", async () => {
        const { body, headers } = logForm({
            calories: "350",
            meal_type: "snack",
        });
        const res = await app.request(quickPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(mealsInserted).toHaveLength(1);
    });

    test("writes a free-text meal with macros and no items", async () => {
        const { body, headers } = logForm({
            calories: "350",
            protein_g: "12",
            carbs_g: "40",
            fat_g: "14",
            description: "Coffee",
            meal_type: "snack",
            logged_at: "2026-11-01T12:00",
        });
        const res = await app.request(quickPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(mealsInserted).toHaveLength(1);
        const row = mealsInserted[0]!;
        expect(row.calories).toBe(350);
        expect(row.protein_g).toBe(12);
        expect(row.description).toBe("Coffee");
        expect(row.items ?? []).toHaveLength(0);
    });

    test("offset-less local time stays on that local day", async () => {
        const { body, headers } = logForm({
            calories: "200",
            meal_type: "dinner",
            logged_at: "2026-11-01T21:00",
        });
        const res = await app.request(quickPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(String(mealsInserted[0]!.logged_at)).toBe(
            "2026-11-02T05:00:00.000Z",
        );
    });

    test("invalid calories returns 400 and does not write", async () => {
        const { body, headers } = logForm({
            calories: "0",
            meal_type: "lunch",
        });
        const res = await app.request(quickPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(400);
        expect(mealsInserted).toHaveLength(0);
    });
});

describe("POST /log/water", () => {
    test("returns 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const { body, headers } = logForm({ amount_ml: "250" });
        const res = await app.request(waterPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(404);
    });

    test("writes water with an explicit local time", async () => {
        const { body, headers } = logForm({
            amount_ml: "250",
            logged_at: "2026-11-01T21:00",
        });
        const res = await app.request(waterPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(waterInserted).toHaveLength(1);
        expect(waterInserted[0]!.amount_ml).toBe(250);
        expect(String(waterInserted[0]!.logged_at)).toBe(
            "2026-11-02T05:00:00.000Z",
        );
    });

    test("writes water without logged_at", async () => {
        const { body, headers } = logForm({ amount_ml: "250" });
        const res = await app.request(waterPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(waterInserted).toHaveLength(1);
        expect(waterInserted[0]!.amount_ml).toBe(250);
    });

    test("invalid amount returns 400", async () => {
        const { body, headers } = logForm({ amount_ml: "0" });
        const res = await app.request(waterPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(400);
        expect(waterInserted).toHaveLength(0);
    });

    test("invalid amount reopens search with the error message", async () => {
        const { body, headers } = logForm({ amount_ml: "0" });
        const res = await app.request(waterPostUrl, {
            method: "POST",
            headers,
            body,
        });
        const html = await res.text();
        expect(res.status).toBe(400);
        expect(html).toContain("Enter a water amount greater than zero.");
        expect(html).toContain("data-sheet-open-on-load");
        expect(html).toContain('id="fd-log-search"');
    });
});

describe("POST /log/weight", () => {
    test("returns 404 when ui-v2 is off", async () => {
        setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
        const { body, headers } = logForm({
            weight: "180",
            unit: "lb",
        });
        const res = await app.request(weightPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(404);
    });

    test("writes weight without logged_at", async () => {
        const { body, headers } = logForm({
            weight: "180",
            unit: "lb",
        });
        const res = await app.request(weightPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(weightsInserted).toHaveLength(1);
    });

    test("stores lb the same way log_weight would", async () => {
        const { body, headers } = logForm({
            weight: "180",
            unit: "lb",
            logged_at: "2026-11-01T08:00",
        });
        const res = await app.request(weightPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(weightsInserted).toHaveLength(1);
        expect(weightsInserted[0]!.weight_g).toBeCloseTo(81646.6, 0);
    });

    test("offset-less local time stays on that local day", async () => {
        const { body, headers } = logForm({
            weight: "75",
            unit: "kg",
            logged_at: "2026-11-01T21:00",
        });
        const res = await app.request(weightPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(303);
        expect(String(weightsInserted[0]!.logged_at)).toBe(
            "2026-11-02T05:00:00.000Z",
        );
    });

    test("invalid weight returns 400", async () => {
        const { body, headers } = logForm({
            weight: "0",
            unit: "kg",
        });
        const res = await app.request(weightPostUrl, {
            method: "POST",
            headers,
            body,
        });
        expect(res.status).toBe(400);
        expect(weightsInserted).toHaveLength(0);
    });

    test("weight validation error keeps the last-weight subtitle", async () => {
        const { body, headers } = logForm({
            weight: "0",
            unit: "kg",
        });
        const res = await app.request(weightPostUrl, {
            method: "POST",
            headers,
            body,
        });
        const html = await res.text();
        expect(res.status).toBe(400);
        expect(html).toMatch(/Last: 183\.0 lb/);
    });
});

test("copy-yesterday noop toast differs from undo noop", () => {
    expect(TOASTS["nutrition.meal.copy-yesterday.noop"].text).toBe(
        "Already copied from yesterday",
    );
    expect(TOASTS["nutrition.meal.copy-yesterday.noop"].text).not.toBe(
        TOASTS["nutrition.meal.undo.noop"].text,
    );
});

describe("weighInPrefillForUser", () => {
    test("uses each viewer's own latest weight and unit", async () => {
        const { weighInPrefillForUser } = await import("../loaders.js");
        const alice = await weighInPrefillForUser(ALICE);
        expect(alice.unit).toBe("lb");
        expect(alice.weight).toBeCloseTo(183, 0);
        expect(alice.lastWeightG).toBe(83007);
        const bob = await weighInPrefillForUser(BOB);
        expect(bob.unit).toBe("kg");
        expect(bob.weight).toBe(90);
        expect(bob.lastWeightG).toBe(90000);
    });
});
