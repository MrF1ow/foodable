import { test, expect, describe, mock, beforeEach, afterAll } from "bun:test";
import {
    formatProgress,
    sumMeals,
    totalsPayloadOf,
    nutrientPresence,
    registerTools,
    START_IMPORT_OUTPUT_SCHEMA,
    TOTALS_ITEM,
    MAX_CALORIES,
    MAX_MACRO_G,
    MAX_ALCOHOL_G,
    MAX_CAFFEINE_MG,
    MAX_GOAL_G,
    MAX_GOAL_MG,
    handleMcp,
} from "./mcp.js";
import {
    Client,
    StreamableHTTPClientTransport,
    type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { Hono } from "hono";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import * as actualClient from "./db/client.js";
import * as actualNutrition from "./db/nutrition.js";
import * as actualProfiles from "./db/profiles.js";
import * as actualHousehold from "./db/household.js";
import * as actualDbFridge from "./db/fridge.js";
import * as actualDbGrocery from "./db/grocery.js";
import * as actualDbRecipes from "./db/recipes.js";
import * as actualDbSettings from "./db/settings.js";
import * as actualDbRules from "./db/rules.js";
import * as actualDbFoods from "./db/foods.js";
import * as actualDbStock from "./db/stock.js";
import * as actualFoods from "./foods.js";
import * as actualFoodSearch from "./food-search.js";

// Snapshot BEFORE mock.module runs: Bun patches a mocked module's namespace
// in place, so restoring from the live import afterwards would hand the next
// file the mock again. Restore from these copies.
const realClient = { ...actualClient };
const realNutrition = { ...actualNutrition };
const realProfiles = { ...actualProfiles };
const realHousehold = { ...actualHousehold };
const realDbFridge = { ...actualDbFridge };
const realDbGrocery = { ...actualDbGrocery };
const realDbRecipes = { ...actualDbRecipes };
const realDbSettings = { ...actualDbSettings };
const realDbRules = { ...actualDbRules };
const realDbFoods = { ...actualDbFoods };
const realDbStock = { ...actualDbStock };
const realFoods = { ...actualFoods };
const realFoodSearch = { ...actualFoodSearch };
import { DELETED_ACCOUNT_ANALYTICS_ID } from "./analytics.js";
import {
    HOUSEHOLD_CANNOT_DELETE_ACCOUNT,
    OAUTH_USER_MISMATCH,
} from "./auth-context.js";
import { HOUSEHOLD_TOKEN_PREFIX } from "./household-token.js";
import {
    EMPTY_HOUSEHOLD_PREFERENCES,
    HouseholdAlreadyExistsError,
    type HouseholdConfig,
} from "./household.js";
import { createMemoryFridgeStore } from "./domain/fridge.js";
import { createMemoryStockStore, ledgerMatchesStock } from "./domain/stock.js";
import { createMemoryFoodsStore } from "./domain/foods.js";
import { findOrCreateManualFood, updateFood } from "./domain/foods.js";
import { createMemoryGroceryStore } from "./domain/grocery.js";
import { createMemoryRecipesStore } from "./domain/recipes.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
} from "./domain/settings.js";
import { addAllergen, createMemoryRulesStore } from "./domain/rules.js";
import {
    TOOLS,
    HOUSEHOLD_SCOPED_TOOL_NAMES,
    NUTRITION_WRITE_TOOL_NAMES,
    OAUTH_ONLY_TOOL_NAMES,
} from "./copy/tools.js";
import type { FoodResult } from "./foods.js";
import type {
    Meal,
    MealInput,
    NutritionGoals,
    WaterEntry,
    WeightEntry,
} from "./db/nutrition.js";
import { dateInTz, formatLocalDateTime, weekdayInTz } from "./domain/tz.js";
import { getWidgetHtml } from "./widgets.js";

function meal(over: Partial<Meal> = {}): Meal {
    return {
        id: "m1",
        user_id: "u1",
        logged_at: "2026-07-26T12:00:00.000Z",
        meal_type: "dinner",
        description: "Pasta and a beer",
        calories: 700,
        protein_g: 25,
        carbs_g: 90,
        fat_g: 20,
        fiber_g: 6,
        sugar_g: 12,
        alcohol_g: 14,
        // NULL on the base fixture on purpose: caffeine is the partial nutrient
        // where absence is the norm rather than a relic of pre-feature history,
        // and a pasta-and-beer dinner genuinely carries none. Giving every
        // fixture meal a milligram figure would hide the suppression this whole
        // feature turns on — the tests that want caffeine ask for it.
        caffeine_mg: null,
        notes: null,
        idempotency_key: null,
        ...over,
    };
}

function goals(over: Partial<NutritionGoals> = {}): NutritionGoals {
    return {
        user_id: "u1",
        daily_calories: 2000,
        daily_protein_g: 120,
        daily_carbs_g: 220,
        daily_fat_g: 70,
        daily_fiber_g: 30,
        daily_sugar_g: 40,
        daily_alcohol_g: 28,
        // Milligrams, and the EFSA/FDA figure the tool description offers.
        daily_caffeine_mg: 400,
        daily_water_ml: 2500,
        target_weight_g: null,
        updated_at: "2026-07-26T00:00:00.000Z",
        ...over,
    };
}

// #99: the pure startImportPayload/runImport functions in mcp.format.test.ts
// take tzConfigured as an already-computed boolean, so they can't catch a bug
// in HOW mcp.ts computes it. These drive the real tools to cover that
// derivation: a profile row (created by some other set_* tool) with no
// timezone must count as unconfigured, the same as no profile at all.
describe("start_meal_import and bulk_import_meals treat a timezone-less profile as unconfigured", () => {
    test("start_meal_import reports tz_configured=false and warns", async () => {
        db.profile = { ...PROFILE_BASE, timezone: null };
        await withTools(null, async (call) => {
            const r = await call("start_meal_import");
            const sc = r.structuredContent as unknown as {
                tz_configured: boolean;
            };
            expect(sc.tz_configured).toBe(false);
            expect(textOf(r)).toContain("this account has no timezone set");
        });
    });

    test("bulk_import_meals warns that the timezone is unset", async () => {
        db.profile = { ...PROFILE_BASE, timezone: null };
        await withTools(null, async (call) => {
            const r = await call("bulk_import_meals", {
                meals: [
                    {
                        source_line: 2,
                        description: "Oatmeal",
                        meal_type: "breakfast",
                        logged_at: "2026-07-20 08:30:00",
                    },
                ],
                expected_row_count: 1,
                dry_run: true,
            });
            const sc = r.structuredContent as unknown as {
                warnings: string[];
            };
            expect(sc.warnings.join(" ")).toContain("Your timezone is not set");
        });
    });
});

// ---------- Tool-level integration harness ----------
//
// Pure formatters live in mcp.format.test.ts (no mock.module). Some things
// have no pure core to reach that way: set_alcohol_tracking and
// get_alcohol_tracking ARE their handler — read or write one profile column,
// then pick a sentence — and a mutation audit found that inverting either
// tool's enabled state failed nothing. So the tools below are registered on a
// real McpServer and driven through a real client over an in-memory transport,
// with the db modules stubbed. That also puts the input schemas under test
// end-to-end, which is the only way to prove a bad argument is rejected BEFORE
// the handler runs.
//
// mock.module swaps the module for the whole test *process*, not just this
// file, so the real exports are spread back in (replacing it wholesale would
// break every other suite) and restored in afterAll. Same pattern as
// middleware.test.ts. One mock window per module, restore from the snapshot
// taken before mock.module. Do not open a second mock of these paths.

const PROFILE_BASE: actualProfiles.Profile = {
    user_id: "u1",
    timezone: "UTC",
    preferred_weight_unit: null,
    widgets_enabled: true,
    alcohol_tracking_enabled: false,
    preferred_drink_unit: null,
    locale: null,
    theme: null,
    accent_swatch: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
};

/** What the DB would hand back after a write: every nutrient absent unless the
 *  caller sent it. Building on the `meal()` fixture instead would silently give
 *  every write its 14 g of alcohol, hiding exactly the gating this tests. */
function storedMeal(input: Record<string, unknown>): Meal {
    const defined = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Partial<Meal>;
    return meal({
        calories: null,
        protein_g: null,
        carbs_g: null,
        fat_g: null,
        fiber_g: null,
        sugar_g: null,
        alcohol_g: null,
        caffeine_mg: null,
        ...defined,
    });
}

const db = {
    profile: null as actualProfiles.Profile | null,
    goals: null as NutritionGoals | null,
    meals: [] as Meal[],
    water: [] as WaterEntry[],
    inserted: [] as Record<string, unknown>[],
    // Same capture as `inserted`, for the non-meal write paths. Each one
    // resolves logged_at independently, so each needs its own witness.
    mealUpdates: [] as Record<string, unknown>[],
    waterInserted: [] as Record<string, unknown>[],
    weightInserted: [] as Record<string, unknown>[],
    weightUpdates: [] as Record<string, unknown>[],
    profilePatches: [] as Record<string, unknown>[],
    // Ids the delete stubs consider to exist. Deleting one removes it, so a
    // second delete of the same id reports "not found" like the real table.
    rowIds: new Set<string>(),
    analyticsRows: [] as Record<string, unknown>[],
    accountWipes: 0,
    // Who deleteAllUserData erased, in order.
    wipedUsers: [] as string[],
    ownershipTransfers: [] as { from: string; to: string }[],
    profileReads: [] as string[],
    membershipReads: [] as string[],
    members: [] as actualHousehold.HouseholdMembership[],
    addedLogins: [] as string[],
    tokenRotations: [] as {
        householdId: string;
        tokenHashHex: string;
        issuedBy: string | null;
    }[],
    household: null as HouseholdConfig | null,
    fridgeStore: createMemoryFridgeStore(),
    stockStore: createMemoryStockStore(),
    groceryStore: createMemoryGroceryStore(),
    recipesStore: createMemoryRecipesStore(),
    settingsStore: createMemorySettingsStore(),
    rulesStore: createMemoryRulesStore(),
    foodsStore: createMemoryFoodsStore(),
    barcodeFoods: {} as Record<string, FoodResult>,
    foodSearchHits: [] as FoodResult[],
    foodSearchError: null as Error | null,
};

mock.module("./db/client.js", () => ({
    ...actualClient,
    // analytics.ts persists every tool call through getSupabase(); intercept it
    // so a test never depends on Supabase env vars being present, and so the
    // rows it would have written can be asserted on.
    getSupabase: () => ({
        from: (table: string) => ({
            insert: async (row: Record<string, unknown>) => {
                if (table === "tool_analytics") db.analyticsRows.push(row);
                return { error: null };
            },
        }),
    }),
}));

mock.module("./db/nutrition.js", () => ({
    ...actualNutrition,
    deleteAllUserData: async (userId: string) => {
        db.accountWipes += 1;
        db.wipedUsers.push(userId);
        // The real auth delete cascades the membership row away.
        db.members = db.members.filter((member) => member.userId !== userId);
    },
    getNutritionGoals: async () => db.goals,
    getMealsByDate: async () => db.meals,
    getWaterByDate: async () => [],
    getWeightByDate: async () => [],
    // The range readers behind get_nutrition_summary. They ignore the dates and
    // hand back whatever the test staged: the fixtures below already sit inside
    // the window they ask for, and filtering here would only re-implement the
    // query under test.
    getMealsInRange: async () => db.meals,
    getWaterInRange: async () => db.water,
    insertMeal: async (userId: string, input: Record<string, unknown>) => {
        db.inserted.push({ ...input, user_id: userId });
        const saved = storedMeal({ ...input, user_id: userId });
        db.meals = [saved];
        return { meal: saved, deduplicated: false };
    },
    updateMeal: async (
        _userId: string,
        id: string,
        fields: Record<string, unknown>,
    ) => {
        db.mealUpdates.push(fields);
        const saved = storedMeal({ ...fields, id });
        db.meals = [saved];
        return saved;
    },
    insertWater: async (_userId: string, input: Record<string, unknown>) => {
        db.waterInserted.push(input);
        return {
            entry: {
                id: "w1",
                user_id: "u1",
                amount_ml: (input.amount_ml as number) ?? 0,
                logged_at:
                    (input.logged_at as string | undefined) ??
                    "2026-08-07T00:00:00.000Z",
                notes: (input.notes as string | undefined) ?? null,
                created_at: "2026-08-07T00:00:00.000Z",
                idempotency_key: null,
            } as WaterEntry,
            deduplicated: false,
        };
    },
    insertWeight: async (_userId: string, input: Record<string, unknown>) => {
        db.weightInserted.push(input);
        return {
            entry: {
                id: "k1",
                user_id: "u1",
                weight_g: (input.weight_g as number) ?? 0,
                logged_at:
                    (input.logged_at as string | undefined) ??
                    "2026-08-07T00:00:00.000Z",
                notes: (input.notes as string | undefined) ?? null,
                created_at: "2026-08-07T00:00:00.000Z",
                idempotency_key: null,
            } as WeightEntry,
            deduplicated: false,
        };
    },
    updateWeight: async (
        _userId: string,
        id: string,
        fields: Record<string, unknown>,
    ) => {
        db.weightUpdates.push(fields);
        return {
            id,
            user_id: "u1",
            weight_g: (fields.weight_g as number | undefined) ?? 70_000,
            logged_at:
                (fields.logged_at as string | undefined) ??
                "2026-08-07T00:00:00.000Z",
            notes: (fields.notes as string | undefined) ?? null,
            created_at: "2026-08-07T00:00:00.000Z",
            idempotency_key: null,
        } as WeightEntry;
    },
    deleteMeal: async (_userId: string, id: string) => {
        const before = db.meals.length;
        db.meals = db.meals.filter((m) => m.id !== id);
        return db.meals.length < before;
    },
    deleteWater: async (_userId: string, id: string) => db.rowIds.delete(id),
    deleteWeight: async (_userId: string, id: string) => db.rowIds.delete(id),
    countMeals: async () => db.meals.length,
    existingIdempotencyKeys: async () => new Set<string>(),
    existingMealIds: async (_userId: string, ids: string[]) =>
        new Set(ids.filter((id) => db.meals.some((m) => m.id === id))),
    upsertNutritionGoals: async (
        userId: string,
        patch: Record<string, unknown>,
    ) => {
        db.goals = { ...goals(), user_id: userId, ...patch } as NutritionGoals;
        return db.goals;
    },
    getLatestWeight: async () => null,
    getWeightInRange: async () => [],
}));

mock.module("./db/profiles.js", () => ({
    ...actualProfiles,
    getProfile: async (userId: string) => {
        db.profileReads.push(userId);
        return db.profile;
    },
    getUserTimezone: async () => db.profile?.timezone ?? "UTC",
    getPreferredWeightUnit: async () =>
        db.profile?.preferred_weight_unit ?? null,
    upsertProfile: async (userId: string, patch: Record<string, unknown>) => {
        db.profilePatches.push(patch);
        db.profile = {
            ...(db.profile ?? { ...PROFILE_BASE, user_id: userId }),
            ...patch,
        } as actualProfiles.Profile;
        return db.profile;
    },
}));

mock.module("./db/household.js", () => ({
    ...actualHousehold,
    getHouseholdMembership: async (userId: string, householdId?: string) => {
        db.membershipReads.push(userId);
        return (
            db.members.find(
                (member) =>
                    member.userId === userId &&
                    (householdId == null || member.householdId === householdId),
            ) ?? null
        );
    },
    householdExists: async () => db.household != null,
    createHouseholdForCaller: async (
        userId: string,
        name: string,
        displayName: string,
    ) => {
        if (db.household != null) {
            throw new HouseholdAlreadyExistsError();
        }
        db.household = {
            name,
            fridgeLocations: [],
            recipeSearchPlaces: [],
            preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
        };
        db.members.push({
            householdId: "hh-1",
            userId,
            role: "owner",
            displayName,
        });
        return "hh-1";
    },
    listHouseholdMembers: async (householdId: string) =>
        db.members
            .filter((member) => member.householdId === householdId)
            .slice()
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    addHouseholdMemberForHousehold: async (
        householdId: string,
        draft: {
            displayName: string;
            login:
                | { kind: "email"; email: string }
                | { kind: "username"; username: string };
        },
    ) => {
        const email =
            draft.login.kind === "email"
                ? draft.login.email
                : `${draft.login.username}@household.invalid`;
        if (db.addedLogins.includes(email)) {
            return { ok: false, error: "That login is already in use." };
        }
        const userId = "55555555-5555-4555-8555-555555555555";
        db.addedLogins.push(email);
        db.members.push({
            householdId,
            userId,
            role: "member",
            displayName: draft.displayName,
        });
        return { ok: true, userId };
    },
    getHouseholdConfig: async () => {
        if (db.household == null) {
            throw new Error("Failed to load household config");
        }
        return structuredClone(db.household);
    },
    updateHouseholdConfig: async (
        _householdId: string,
        config: HouseholdConfig,
    ) => {
        db.household = structuredClone(config);
        return structuredClone(db.household);
    },
    transferHouseholdOwnership: async (
        householdId: string,
        fromUserId: string,
        toUserId: string,
    ) => {
        db.ownershipTransfers.push({ from: fromUserId, to: toUserId });
        db.members = db.members.map((member) =>
            member.householdId !== householdId
                ? member
                : member.userId === fromUserId
                  ? { ...member, role: "member" }
                  : member.userId === toUserId
                    ? { ...member, role: "owner" }
                    : member,
        );
    },
    rotateHouseholdMcpToken: async (args: {
        householdId: string;
        tokenHashHex: string;
        issuedBy: string | null;
    }) => {
        db.tokenRotations.push(args);
        return "2026-09-19T12:00:00.000Z";
    },
    updateMemberDisplayName: async (
        householdId: string,
        userId: string,
        displayName: string,
    ) => {
        const member = db.members.find(
            (row) => row.householdId === householdId && row.userId === userId,
        );
        if (member) member.displayName = displayName;
    },
}));

mock.module("./db/fridge.js", () => ({
    ...actualDbFridge,
    liveFridgeStore: () => db.fridgeStore,
}));

mock.module("./db/stock.js", () => ({
    ...actualDbStock,
    liveStockStore: () => db.stockStore,
}));

mock.module("./db/grocery.js", () => ({
    ...actualDbGrocery,
    liveGroceryStore: () => db.groceryStore,
}));

mock.module("./db/recipes.js", () => ({
    ...actualDbRecipes,
    liveRecipesStore: () => db.recipesStore,
}));

mock.module("./db/settings.js", () => ({
    ...actualDbSettings,
    liveSettingsStore: () => db.settingsStore,
}));

mock.module("./db/rules.js", () => ({
    ...actualDbRules,
    liveRulesStore: () => db.rulesStore,
}));

mock.module("./db/foods.js", () => ({
    ...actualDbFoods,
    liveFoodsStore: () => db.foodsStore,
}));

mock.module("./foods.js", () => ({
    ...actualFoods,
    lookupBarcode: async (barcode: string) => db.barcodeFoods[barcode] ?? null,
}));

mock.module("./food-search.js", () => ({
    ...actualFoodSearch,
    searchFoodsByName: async () => {
        if (db.foodSearchError) throw db.foodSearchError;
        return db.foodSearchHits;
    },
}));

afterAll(() => {
    mock.module("./db/client.js", () => realClient);
    mock.module("./db/nutrition.js", () => realNutrition);
    mock.module("./db/profiles.js", () => realProfiles);
    mock.module("./db/household.js", () => realHousehold);
    mock.module("./db/fridge.js", () => realDbFridge);
    mock.module("./db/stock.js", () => realDbStock);
    mock.module("./db/grocery.js", () => realDbGrocery);
    mock.module("./db/recipes.js", () => realDbRecipes);
    mock.module("./db/settings.js", () => realDbSettings);
    mock.module("./db/rules.js", () => realDbRules);
    mock.module("./db/foods.js", () => realDbFoods);
    mock.module("./foods.js", () => realFoods);
    mock.module("./food-search.js", () => realFoodSearch);
});

beforeEach(() => {
    db.profile = { ...PROFILE_BASE };
    db.goals = null;
    db.meals = [];
    db.water = [];
    db.inserted = [];
    db.mealUpdates = [];
    db.waterInserted = [];
    db.weightInserted = [];
    db.weightUpdates = [];
    db.profilePatches = [];
    db.rowIds = new Set<string>();
    db.analyticsRows = [];
    db.accountWipes = 0;
    db.wipedUsers = [];
    db.ownershipTransfers = [];
    db.profileReads = [];
    db.membershipReads = [];
    db.addedLogins = [];
    db.tokenRotations = [];
    db.household = {
        name: "Home",
        fridgeLocations: [],
        recipeSearchPlaces: [],
        preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
    };
    db.members = [
        {
            householdId: "hh-1",
            userId: "u1",
            role: "owner",
            displayName: "U1",
        },
    ];
    db.fridgeStore = createMemoryFridgeStore();
    db.stockStore = createMemoryStockStore();
    db.groceryStore = createMemoryGroceryStore();
    db.recipesStore = createMemoryRecipesStore();
    db.settingsStore = createMemorySettingsStore();
    db.rulesStore = createMemoryRulesStore();
    db.foodsStore = createMemoryFoodsStore();
    db.barcodeFoods = {};
    db.foodSearchHits = [];
    db.foodSearchError = null;
});

interface ToolResult {
    content: { type: string; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: boolean;
}

type CallTool = (
    name: string,
    args?: Record<string, unknown>,
) => Promise<ToolResult>;

/** Register the real tools for a user whose alcohol gate is `alcohol`, then
 *  drive them through a client. `alcohol` is the whole opt-in: null = off. */
async function withTools(
    alcohol: "us" | "uk" | null,
    run: (call: CallTool) => Promise<void>,
): Promise<void> {
    const server = new McpServer(
        { name: "foodable-test", version: "0.0.0" },
        { capabilities: { tools: {}, resources: {} } },
    );
    registerTools(server, { kind: "user", userId: "u1" }, true, alcohol);
    const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
    ]);
    try {
        await run(
            (name, args = {}) =>
                client.callTool({
                    name,
                    arguments: args,
                }) as Promise<ToolResult>,
        );
    } finally {
        await client.close();
        await server.close();
    }
}

const textOf = (r: ToolResult) => r.content.map((c) => c.text).join("\n");

// ---------- (1) numeric bounds ----------

describe("write-tool numeric bounds", () => {
    // These bounds must equal the ones bulk_import_meals enforces, or the same
    // figure is accepted through one door and refused at the other. There is no
    // drift test because there is nothing to drift: src/import.ts owns the three
    // constants and src/mcp.ts re-exports them, so both doors read one value.

    // numeric(6,2) — one more digit is a Postgres "numeric field overflow",
    // which is not something a model should have to learn by hitting it.
    test("the goal ceiling is what numeric(6,2) can hold", () => {
        expect(MAX_GOAL_G).toBe(9999.99);
    });

    // Was: -1 sailed through Zod, hit the migration's `check (fiber_g >= 0)`
    // and surfaced a raw Postgres constraint error to the model.
    test("log_meal rejects a negative gram figure before touching the DB", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "Oatmeal",
                meal_type: "breakfast",
                fiber_g: -1,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("fiber_g");
            expect(db.inserted).toHaveLength(0);
        });
    });

    // WHY the upper bound exists, demonstrated on the payload builder: zod 4
    // accepts 1e308 (it only refuses Infinity), and the rounding every totals
    // path does turns 1e308 into Infinity. One such row therefore broke every
    // LATER get_nutrition_summary / get_goal_progress / log_meal for that date
    // on outputSchema validation, until someone deleted it by hand.
    test("an unbounded 1e308 figure would poison every later read of that date", () => {
        const payload = totalsPayloadOf(
            sumMeals([meal({ fiber_g: 1e308 })]),
            null,
            false,
        );
        expect(payload.fiber_g).toBe(Infinity);
        expect(TOTALS_ITEM.safeParse(payload).success).toBe(false);
    });

    test("...and log_meal now refuses to create that row in the first place", async () => {
        await withTools(null, async (call) => {
            for (const field of [
                "calories",
                "protein_g",
                "carbs_g",
                "fat_g",
                "fiber_g",
                "sugar_g",
                "alcohol_g",
                "caffeine_mg",
            ]) {
                const r = await call("log_meal", {
                    description: "Oatmeal",
                    meal_type: "breakfast",
                    [field]: 1e308,
                });
                expect(r.isError).toBe(true);
                expect(textOf(r)).toContain(field);
            }
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("update_meal is bounded the same way", async () => {
        await withTools(null, async (call) => {
            expect(
                (await call("update_meal", { id: "m1", sugar_g: -0.5 }))
                    .isError,
            ).toBe(true);
            expect(
                (await call("update_meal", { id: "m1", alcohol_g: 1e308 }))
                    .isError,
            ).toBe(true);
        });
    });

    // 500 g of ethanol is already ~36 US drinks in one entry; the import path
    // has drawn the line there since it shipped.
    test("alcohol has a tighter ceiling than the other macros", async () => {
        await withTools("us", async (call) => {
            const ok = await call("log_meal", {
                description: "Wine",
                meal_type: "dinner",
                alcohol_g: MAX_ALCOHOL_G,
            });
            expect(ok.isError).toBeFalsy();
            const tooMuch = await call("log_meal", {
                description: "Wine",
                meal_type: "dinner",
                alcohol_g: MAX_ALCOHOL_G + 1,
            });
            expect(tooMuch.isError).toBe(true);
        });
    });

    // 5,000 mg is ~50 espressos and well past a lethal single dose, so anything
    // above it is a unit slip (grams read as mg, or a coffee-bean weight) rather
    // than a drink. The rejection has to name the field, because the useful
    // correction is "you sent grams" and only `caffeine_mg` says so.
    test("caffeine has its own milligram ceiling, named in the rejection", async () => {
        await withTools(null, async (call) => {
            const ok = await call("log_meal", {
                description: "A pot of coffee",
                meal_type: "snack",
                caffeine_mg: MAX_CAFFEINE_MG,
            });
            expect(ok.isError).toBeFalsy();
            expect(db.inserted[0]!.caffeine_mg).toBe(MAX_CAFFEINE_MG);

            const tooMuch = await call("log_meal", {
                description: "Coffee",
                meal_type: "snack",
                caffeine_mg: MAX_CAFFEINE_MG + 1,
            });
            expect(tooMuch.isError).toBe(true);
            expect(textOf(tooMuch)).toContain("caffeine_mg");
            expect(db.inserted).toHaveLength(1);
        });
    });

    test("a negative caffeine figure is refused before the DB check fires", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "Coffee",
                meal_type: "snack",
                caffeine_mg: -1,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("caffeine_mg");
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("the top of each range is still accepted", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "A very large day",
                meal_type: "dinner",
                calories: MAX_CALORIES,
                fiber_g: MAX_MACRO_G,
                sugar_g: 0,
            });
            expect(r.isError).toBeFalsy();
            expect(db.inserted).toHaveLength(1);
        });
    });

    test("set_nutrition_goals rejects negatives and numeric(6,2) overflow", async () => {
        await withTools(null, async (call) => {
            expect(
                (await call("set_nutrition_goals", { daily_fiber_g: -1 }))
                    .isError,
            ).toBe(true);
            expect(
                (
                    await call("set_nutrition_goals", {
                        daily_sugar_g: MAX_GOAL_G + 1,
                    })
                ).isError,
            ).toBe(true);
            expect(
                (await call("set_nutrition_goals", { daily_alcohol_g: 1e308 }))
                    .isError,
            ).toBe(true);
        });
    });

    // daily_caffeine_mg is numeric(7,2), not the (6,2) every gram target uses —
    // milligram figures run three orders larger, so it needs a ceiling of its
    // own or a legitimate limit would be refused by a bound sized for grams.
    test("the caffeine goal ceiling is what numeric(7,2) can hold", async () => {
        expect(MAX_GOAL_MG).toBe(99999.99);
        expect(MAX_GOAL_MG).toBeGreaterThan(MAX_GOAL_G);
        await withTools(null, async (call) => {
            expect(
                (
                    await call("set_nutrition_goals", {
                        daily_caffeine_mg: MAX_GOAL_MG,
                    })
                ).isError,
            ).toBeFalsy();
            expect(
                (
                    await call("set_nutrition_goals", {
                        daily_caffeine_mg: MAX_GOAL_MG + 1,
                    })
                ).isError,
            ).toBe(true);
            expect(
                (await call("set_nutrition_goals", { daily_caffeine_mg: -1 }))
                    .isError,
            ).toBe(true);
        });
    });

    // Clearing a target must survive the bounds: null is not a number and must
    // not be caught by .min(0).
    test("null still clears a goal", async () => {
        db.goals = null;
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_fiber_g: null,
            });
            expect(r.isError).toBeFalsy();
        });
    });
});

// ---------- (2) the alcohol discovery nudge ----------

describe("log_meal / update_meal surface hidden alcohol", () => {
    const beer = {
        description: "Two beers",
        meal_type: "dinner",
        alcohol_g: 26,
    };

    // The whole point: with tracking off, alcohol is stored but appears in no
    // meal line, no goal line and no widget stat, so without this note the user
    // has no way to learn the feature exists.
    test("log_meal nudges when alcohol is stored but hidden", async () => {
        await withTools(null, async (call) => {
            const text = textOf(await call("log_meal", beer));
            expect(text).toContain("set_alcohol_tracking");
            expect(db.inserted[0]!.alcohol_g).toBe(26);
        });
    });

    // REPORT ONLY. Auto-enabling would surface alcohol to a user who never
    // asked for it — the exact harm the opt-in exists to prevent.
    test("the nudge never turns tracking on by itself", async () => {
        await withTools(null, async (call) => {
            await call("log_meal", beer);
            expect(db.profilePatches).toHaveLength(0);
            expect(db.profile!.alcohol_tracking_enabled).toBe(false);
        });
    });

    test("no nudge once the user tracks alcohol — it is already on screen", async () => {
        await withTools("us", async (call) => {
            const text = textOf(await call("log_meal", beer));
            expect(text).not.toContain("set_alcohol_tracking");
            expect(text).toContain("Alcohol:");
        });
    });

    test("no nudge for a meal with no alcohol, or with exactly zero", async () => {
        await withTools(null, async (call) => {
            const plain = textOf(
                await call("log_meal", {
                    description: "Oatmeal",
                    meal_type: "breakfast",
                    calories: 300,
                }),
            );
            expect(plain).not.toContain("set_alcohol_tracking");
            const zero = textOf(
                await call("log_meal", {
                    description: "Alcohol-free beer",
                    meal_type: "snack",
                    alcohol_g: 0,
                }),
            );
            expect(zero).not.toContain("set_alcohol_tracking");
        });
    });

    test("update_meal nudges on the same terms", async () => {
        await withTools(null, async (call) => {
            const text = textOf(
                await call("update_meal", { id: "m1", alcohol_g: 14 }),
            );
            expect(text).toContain("set_alcohol_tracking");
        });
        await withTools("uk", async (call) => {
            const text = textOf(
                await call("update_meal", { id: "m1", alcohol_g: 14 }),
            );
            expect(text).not.toContain("set_alcohol_tracking");
        });
    });
});

// ---------- (3) the fiber/sugar completeness nudge ----------
//
// The asymmetry under test is the whole design: fiber and sugar are chased
// because they are estimable for every food and a null costs the whole DAY in
// every average, while caffeine is deliberately left alone because most meals
// really do carry none and its display gate is `!= null`, so chasing it would
// manufacture the "0 mg / 400 mg limit" row the suppression exists to avoid.

describe("log_meal / update_meal chase missing fiber and sugar", () => {
    test("log_meal without them says so and points at update_meal", async () => {
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    description: "Chicken salad",
                    meal_type: "lunch",
                    calories: 400,
                }),
            );
            expect(text).toContain("fiber_g, sugar_g");
            expect(text).toContain("update_meal");
        });
    });

    test("log_meal with both — including zeros — says nothing", async () => {
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    description: "Ribeye steak",
                    meal_type: "dinner",
                    calories: 700,
                    fiber_g: 0,
                    sugar_g: 0,
                }),
            );
            expect(text).not.toContain("update_meal");
        });
    });

    test("a caffeine-free meal is never nagged about caffeine", async () => {
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    description: "Ribeye steak",
                    meal_type: "dinner",
                    fiber_g: 0,
                    sugar_g: 0,
                }),
            );
            expect(text).not.toContain("caffeine");
            expect(text).not.toContain("Caffeine");
        });
    });

    // The repair loop has to converge: backfilling one field must leave a note
    // naming only the other, not the same pair again.
    test("update_meal re-checks the meal it just wrote", async () => {
        await withTools(null, async (call) => {
            const text = textOf(
                await call("update_meal", { id: "m1", fiber_g: 6 }),
            );
            expect(text).toContain("sugar_g");
            expect(text).not.toContain("fiber_g");
        });
    });
});

// ---------- caffeine, end to end through the real tools ----------

describe("log_meal and update_meal round-trip caffeine_mg", () => {
    const coffee = {
        description: "Flat white",
        meal_type: "snack",
        calories: 120,
        caffeine_mg: 95,
    };

    test("the milligram figure reaches the DB layer, the text and the widget", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", coffee);
            expect(r.isError).toBeFalsy();
            expect(db.inserted[0]!.caffeine_mg).toBe(95);
            expect(textOf(r)).toContain("Caffeine: 95 mg");
            const sc = r.structuredContent as unknown as {
                logged_meal: { caffeine_mg: number | null };
                totals: { caffeine_mg: number | null };
            };
            expect(sc.logged_meal.caffeine_mg).toBe(95);
            expect(sc.totals.caffeine_mg).toBe(95);
        });
    });

    // z.coerce, for the same reason log_meal's other numbers have it: models
    // emit "95" as a string often enough that refusing it is a worse failure
    // than coercing it.
    test("a stringified figure is coerced like every other number", async () => {
        await withTools(null, async (call) => {
            await call("log_meal", { ...coffee, caffeine_mg: "95" });
            expect(db.inserted[0]!.caffeine_mg).toBe(95);
        });
    });

    test("omitting it stores nothing at all, rather than a 0", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "Oatmeal",
                meal_type: "breakfast",
                calories: 300,
            });
            expect(db.inserted[0]).not.toHaveProperty("caffeine_mg");
            expect(textOf(r)).not.toContain("Caffeine");
            const sc = r.structuredContent as unknown as {
                logged_meal: { caffeine_mg: number | null };
                totals: { caffeine_mg: number | null };
            };
            // The key is present and null — a .nullable() outputSchema field is
            // REQUIRED, so omitting it would fail validation, not default.
            expect(sc.logged_meal.caffeine_mg).toBeNull();
            expect(sc.totals.caffeine_mg).toBeNull();
        });
    });

    test("update_meal passes a corrected figure through", async () => {
        await withTools(null, async (call) => {
            const r = await call("update_meal", { id: "m1", caffeine_mg: 126 });
            expect(r.isError).toBeFalsy();
            expect(db.mealUpdates[0]!.caffeine_mg).toBe(126);
            expect(textOf(r)).toContain("Caffeine: 126 mg");
        });

        await withTools(null, async (call) => {
            const r = await call("update_meal", {
                id: "m1",
                caffeine_mg: MAX_CAFFEINE_MG + 1,
            });
            expect(r.isError).toBe(true);
            // Still just the accepted write above — the rejection never
            // reached the DB layer.
            expect(db.mealUpdates).toHaveLength(1);
        });
    });

    // CONTRACT: no caffeine_tracking_enabled, no tool pair, no nudge. Alcohol
    // has all three because surfacing trace alcohol to someone in recovery is a
    // real harm; caffeine has no equivalent, and inventing a settings surface
    // for it would be a second thing to keep in sync forever.
    test("there is no caffeine opt-in anywhere on the tool surface", async () => {
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        expect(
            tools.map((t) => t.name).filter((n) => n.includes("caffeine")),
        ).toEqual([]);
        await client.close();
        await server.close();

        await withTools(null, async (call) => {
            const text = textOf(await call("log_meal", coffee));
            expect(text).not.toContain("caffeine_tracking");
            expect(text).not.toContain("set_caffeine_tracking");
        });
    });

    // The digest is frozen (CONTRACT, and the "DO NOT ADD" comments in
    // src/supabase.ts and src/import.ts). Adding caffeine_mg to it would orphan
    // every `auto:` key already stored, so the same meal logged with and
    // without a caffeine figure must still derive one key — and that key must
    // still be the literal value the pre-caffeine code produced.
    test("caffeine does not enter the derived idempotency key", async () => {
        const PRE_CAFFEINE_KEY =
            "auto:ce32507d8d98f40ce37b9dcd4161d18dfb5628f1c97316342dda1f0d02ce95c6";
        const at = "2026-07-20T12:00:00.000Z";
        await withTools(null, async (call) => {
            await call("log_meal", { ...coffee, logged_at: at });
            await call("log_meal", {
                ...coffee,
                caffeine_mg: undefined,
                logged_at: at,
            });
        });
        const keys = db.inserted.map((input) =>
            actualNutrition.mealIdempotencyKey(
                "u1",
                input as unknown as MealInput,
                at,
            ),
        );
        expect(keys[0]).toBe(keys[1]!);
        expect(keys[0]).toBe(PRE_CAFFEINE_KEY);
    });
});

describe("log_meal with food items", () => {
    test("computes totals from snapshots and ignores caller-sent totals", async () => {
        const eggs = await findOrCreateManualFood(
            db.foodsStore,
            "hh-1",
            "food",
            "Eggs",
        );
        await updateFood(db.foodsStore, "hh-1", eggs.id, {
            defaultUnit: "each",
            gramsPerEach: 50,
            calories: 155,
            proteinG: 13,
            carbsG: 1.1,
            fatG: 11,
            fiberG: 0,
            sugarG: 1.1,
        });
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "Breakfast",
                meal_type: "breakfast",
                calories: 9999,
                items: [{ food_id: eggs.id, amount: 2, unit: "each" }],
            });
            expect(r.isError).toBeFalsy();
            expect(textOf(r)).toContain(
                "Item nutrition was computed from the food list",
            );
            expect(db.inserted[0]!.calories).toBe(155);
            expect(db.inserted[0]!.item_digest).toBeTruthy();
            expect(textOf(r)).toContain("Item: Eggs");
        });
    });
});

describe("set_nutrition_goals accepts a caffeine limit", () => {
    test("the limit is stored in milligrams and echoed back", async () => {
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_caffeine_mg: 400,
            });
            expect(r.isError).toBeFalsy();
            expect(db.goals!.daily_caffeine_mg).toBe(400);
            expect(textOf(r)).toContain("- Caffeine (max): 400 mg");
            expect(textOf(await call("get_goal_progress"))).toContain("400 mg");
        });
    });

    // The whole reason caffeine is a ceiling rather than a floor: 0 is the goal
    // someone cutting it out entirely sets, and a floor would file that as
    // "unset" — stored, echoed, then silently ignored, which is how the 0 g
    // alcohol limit bug went.
    test("a limit of 0 is stored, echoed and honoured", async () => {
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_caffeine_mg: 0,
            });
            expect(db.goals!.daily_caffeine_mg).toBe(0);
            expect(textOf(r)).toContain("- Caffeine (max): 0 mg");
            expect(textOf(r)).not.toContain("Caffeine (max): not set");
        });
        // ...and the progress line then reports anything at all as over it.
        expect(
            formatProgress(
                sumMeals([meal({ caffeine_mg: 95 })]),
                goals({ daily_caffeine_mg: 0 }),
                null,
                nutrientPresence([meal({ caffeine_mg: 95 })]),
            ),
        ).toContain("Caffeine: 95 / 0 mg limit (95 mg over)");
    });

    test("null clears it, and an omitted field keeps the stored value", async () => {
        await withTools(null, async (call) => {
            await call("set_nutrition_goals", { daily_caffeine_mg: 400 });
            await call("set_nutrition_goals", { daily_protein_g: 130 });
            expect(db.goals!.daily_caffeine_mg).toBe(400);
            await call("set_nutrition_goals", { daily_caffeine_mg: null });
            expect(db.goals!.daily_caffeine_mg).toBeNull();
        });
    });
});

// IMPORT_ROW_SCHEMA is a plain z.object, so zod STRIPS any key it does not
// declare — exactly the silent failure the source_id block below pins. Drop
// caffeine_mg from that schema and src/import.ts's unit tests all still pass
// while every imported milligram is discarded on the way in.
describe("bulk_import_meals carries caffeine_mg through the row schema", () => {
    const call = (
        c: CallTool,
        meals: Record<string, unknown>[],
        extra: Record<string, unknown> = {},
    ) =>
        c("bulk_import_meals", {
            meals,
            expected_row_count: meals.length,
            dry_run: false,
            ...extra,
        });

    test("an imported milligram figure reaches insertMeal", async () => {
        await withTools(null, async (c) => {
            const r = await call(c, [
                {
                    source_line: 2,
                    description: "Cold brew",
                    logged_at: "2026-07-20",
                    calories: 5,
                    caffeine_mg: 200,
                },
            ]);
            expect(r.isError).toBeFalsy();
            expect(db.inserted[0]!.caffeine_mg).toBe(200);
        });
    });

    // Bounds live in validateRow, not in Zod: a schema-level rejection happens
    // before the handler runs and discards the structured report, the warnings
    // and the analytics row — for what will be the caller's most common
    // mistake (a grams column mapped straight across).
    test("an out-of-range figure is a per-row error, not a lost batch", async () => {
        await withTools(null, async (c) => {
            const r = await call(c, [
                {
                    source_line: 2,
                    description: "Oatmeal",
                    logged_at: "2026-07-20",
                    calories: 300,
                },
                {
                    source_line: 3,
                    description: "Coffee",
                    logged_at: "2026-07-20",
                    caffeine_mg: MAX_CAFFEINE_MG + 1,
                },
            ]);
            expect(r.isError).toBeFalsy();
            const sc = r.structuredContent as unknown as {
                status: string;
                summary: { created: number; failed: number };
                results: {
                    source_line: number;
                    status: string;
                    error: { field: string; message: string } | null;
                }[];
            };
            // The good row still landed and the bad one is named — the whole
            // point of validating in the handler rather than in Zod.
            expect(sc.status).toBe("partial_success");
            expect(sc.summary.created).toBe(1);
            expect(sc.summary.failed).toBe(1);
            const bad = sc.results.find((row) => row.source_line === 3)!;
            expect(bad.status).toBe("failed");
            expect(bad.error!.field).toBe("caffeine_mg");
            // Milligrams in the message — reporting a gram bound here would
            // send the caller off correcting the wrong thing.
            expect(bad.error!.message).toContain(`${MAX_CAFFEINE_MG} mg`);
            expect(bad.error!.message).not.toContain(" g;");
        });
    });
});

// ---------- (3) the two alcohol-setting tools ----------

describe("set_alcohol_tracking", () => {
    test("enabling writes the flag and confirms it", async () => {
        await withTools(null, async (call) => {
            const r = await call("set_alcohol_tracking", { enabled: true });
            expect(db.profilePatches[0]!.alcohol_tracking_enabled).toBe(true);
            expect(db.profile!.alcohol_tracking_enabled).toBe(true);
            const text = textOf(r);
            expect(text).toContain("enabled");
            expect(text).not.toContain("disabled");
            expect(text).toContain("US standard drinks");
        });
    });

    test("disabling writes false and says so", async () => {
        db.profile = { ...PROFILE_BASE, alcohol_tracking_enabled: true };
        await withTools("us", async (call) => {
            const r = await call("set_alcohol_tracking", { enabled: false });
            expect(db.profilePatches[0]!.alcohol_tracking_enabled).toBe(false);
            expect(db.profile!.alcohol_tracking_enabled).toBe(false);
            expect(textOf(r)).toContain("disabled");
            expect(textOf(r)).toContain("already logged is kept");
        });
    });

    test("drink_unit is stored when given and left alone when omitted", async () => {
        await withTools(null, async (call) => {
            await call("set_alcohol_tracking", {
                enabled: true,
                drink_unit: "uk",
            });
            expect(db.profile!.preferred_drink_unit).toBe("uk");
            // Toggling off and on again must not reset the saved unit, so the
            // patch may not carry preferred_drink_unit at all.
            await call("set_alcohol_tracking", { enabled: false });
            expect(db.profilePatches[1]).not.toHaveProperty(
                "preferred_drink_unit",
            );
            const r = await call("set_alcohol_tracking", { enabled: true });
            expect(textOf(r)).toContain("UK units");
        });
    });

    test("rejects a drink unit that is not us or uk", async () => {
        await withTools(null, async (call) => {
            const r = await call("set_alcohol_tracking", {
                enabled: true,
                drink_unit: "metric",
            });
            expect(r.isError).toBe(true);
            expect(db.profilePatches).toHaveLength(0);
        });
    });

    // The old copy told the user the change landed "from the next
    // conversation" and that an open chat might keep the previous setting.
    // Both were false: handleMcp builds a fresh McpServer per POST
    // (sessionIdGenerator: undefined) and buildMcpServer re-reads the profile
    // each time, and unlike widgets_enabled the gate touches no registration
    // metadata that a host would need a tools/list refresh to pick up.
    test("does not tell the user to start a new chat", async () => {
        await withTools(null, async (call) => {
            const on = textOf(
                await call("set_alcohol_tracking", { enabled: true }),
            );
            const off = textOf(
                await call("set_alcohol_tracking", { enabled: false }),
            );
            for (const text of [on, off]) {
                expect(text).not.toContain("next conversation");
                expect(text).not.toContain("reconnect");
                expect(text).not.toContain("new conversation");
            }
        });
    });

    test("its description does not repeat the reconnect caveat either", async () => {
        await withTools(null, async () => {});
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        const setAlcohol = tools.find((t) => t.name === "set_alcohol_tracking");
        expect(setAlcohol?.description).not.toContain("until it reconnects");
        // set_widget_display KEEPS its caveat: widgets_enabled decides each
        // tool's _meta.ui link, which really does need a tools/list refresh.
        const setWidgets = tools.find((t) => t.name === "set_widget_display");
        expect(setWidgets?.description).toContain("reconnects");
        await client.close();
        await server.close();
    });
});

// The completeness rule is only as good as its reach: it has to be on the two
// tools that write nutrition, and it must not contradict itself between the
// tool-level paragraph and the per-field text (a model reading a specific
// field's description will follow that one).
describe("the nutrient-completeness rule reaches the write tools", () => {
    async function toolsOf() {
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        await client.close();
        await server.close();
        return tools;
    }

    test("log_meal and update_meal both carry it", async () => {
        const tools = await toolsOf();
        for (const name of ["log_meal", "update_meal"]) {
            const desc = tools.find((t) => t.name === name)?.description ?? "";
            expect(desc, name).toContain("send them on EVERY meal");
            expect(desc, name).toContain("a missing value is not a zero");
        }
    });

    test("fiber and sugar are described as mandatory, with a fallback", async () => {
        const tools = await toolsOf();
        const props = tools.find((t) => t.name === "log_meal")?.inputSchema
            .properties as Record<string, { description?: string }>;
        for (const key of ["fiber_g", "sugar_g"]) {
            const d = props[key]?.description ?? "";
            expect(d, key).toContain("every meal");
            // The last-resort anchors: without them "estimate it" is an
            // instruction with nothing behind it.
            expect(d, key).toContain("per 100 g");
            expect(d, key).toContain("do not omit the field");
        }
    });

    // The one field that must keep saying the opposite.
    test("caffeine still says omit rather than zero, on both tools", async () => {
        const tools = await toolsOf();
        for (const name of ["log_meal", "update_meal"]) {
            const props = tools.find((t) => t.name === name)?.inputSchema
                .properties as Record<string, { description?: string }>;
            const d = props.caffeine_mg?.description ?? "";
            expect(d, name).toContain("measured, and it was none");
            expect(d.toLowerCase(), name).not.toContain(
                "send it on every meal",
            );
        }
    });
});

describe("get_profile > alcohol tracking section", () => {
    test("reports enabled with the saved unit", async () => {
        db.profile = {
            ...PROFILE_BASE,
            alcohol_tracking_enabled: true,
            preferred_drink_unit: "uk",
        };
        await withTools("uk", async (call) => {
            const text = textOf(await call("get_profile", {}));
            expect(text).toContain("Alcohol tracking: enabled");
            expect(text).toContain("UK units");
            expect(text).not.toContain("no preference saved");
        });
    });

    test("flags the US fallback as a default, not a choice", async () => {
        db.profile = { ...PROFILE_BASE, alcohol_tracking_enabled: true };
        await withTools("us", async (call) => {
            const text = textOf(await call("get_profile", {}));
            expect(text).toContain("US standard drinks");
            expect(text).toContain("no preference saved");
        });
    });

    test("reports disabled, and that stored alcohol is kept", async () => {
        await withTools(null, async (call) => {
            const text = textOf(await call("get_profile", {}));
            expect(text).toContain("Alcohol tracking: disabled");
            expect(text).toContain("still stored");
            expect(text).toContain("set_alcohol_tracking");
        });
    });

    // A profile row that has never been touched must read as OFF: the fallback
    // is the opt-in itself.
    test("no profile row at all reads as disabled", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            expect(textOf(await call("get_profile", {}))).toContain(
                "Alcohol tracking: disabled",
            );
        });
    });
});

describe("bulk_import_meals surfaces hidden alcohol", () => {
    const oatmeal = {
        source_line: 1,
        description: "Oatmeal",
        logged_at: "2026-07-20",
        calories: 300,
    };
    const beer = {
        source_line: 2,
        description: "Beer",
        logged_at: "2026-07-20",
        calories: 140,
        alcohol_g: 13,
    };
    const call = (
        c: CallTool,
        meals: Record<string, unknown>[],
        extra: Record<string, unknown> = {},
    ) =>
        c("bulk_import_meals", {
            meals,
            expected_row_count: meals.length,
            dry_run: false,
            ...extra,
        });

    // A backfill is where this matters most: dozens of rows of alcohol can land
    // and, with the gate off, none of it appears anywhere afterwards.
    test("nudges once when an imported row carried alcohol", async () => {
        await withTools(null, async (c) => {
            const text = textOf(await call(c, [oatmeal, beer]));
            expect(text).toContain("Alcohol saved with these meals");
            expect(text).toContain("set_alcohol_tracking");
            expect(db.profilePatches).toHaveLength(0);
        });
    });

    test("stays quiet when no row carried alcohol", async () => {
        await withTools(null, async (c) => {
            const text = textOf(await call(c, [oatmeal]));
            expect(text).not.toContain("set_alcohol_tracking");
        });
    });

    test("stays quiet when the user already tracks alcohol", async () => {
        await withTools("us", async (c) => {
            const text = textOf(await call(c, [oatmeal, beer]));
            expect(text).not.toContain("set_alcohol_tracking");
        });
    });

    // The note reads args.meals by the result row's `index`, so it must follow
    // the ROW that landed, not just "some row in the batch had alcohol". A row
    // rejected by validateRow stored nothing to be told about — and an
    // off-by-one here would blame the wrong row's alcohol.
    test("a rejected alcohol row does not trigger it", async () => {
        await withTools(null, async (c) => {
            const text = textOf(
                await call(c, [oatmeal, { ...beer, alcohol_g: 10_000 }]),
            );
            expect(text).not.toContain("set_alcohol_tracking");
        });
    });

    // "saved" would be a lie on a dry run — nothing was written yet.
    test("a dry run says it would be saved, not that it was", async () => {
        await withTools(null, async (c) => {
            const text = textOf(
                await call(c, [oatmeal, beer], { dry_run: true }),
            );
            expect(text).toContain("would be saved");
            expect(text).not.toContain("Alcohol saved with these meals");
            expect(text).toContain("set_alcohol_tracking");
        });
    });
});

// ---------- restoring an export is a no-op, not a second copy ----------

// Issue #69. The server-side dedup is unit-tested in import.test.ts; what this
// pins is the wiring, and specifically the one link that fails SILENTLY:
// IMPORT_ROW_SCHEMA is a plain z.object, so zod strips any key it does not
// declare. Drop source_id from that schema and every test in import.test.ts
// still passes while the fix stops working in production.
describe("bulk_import_meals honours the id column of our own export", () => {
    const EXPORTED_ID = "aaaaaaaa-1111-4111-8111-000000000001";

    const call = (
        c: CallTool,
        meals: Record<string, unknown>[],
        extra: Record<string, unknown> = {},
    ) =>
        c("bulk_import_meals", {
            meals,
            expected_row_count: meals.length,
            dry_run: false,
            ...extra,
        });

    const exportedRow = {
        source_line: 2,
        source_id: EXPORTED_ID,
        description: "Oatmeal",
        // Wall-clock form, exactly as export.ts renders it.
        logged_at: "2026-07-20 08:30:00",
        meal_type: "breakfast",
        calories: 300,
    };

    test("a row naming an existing meal is deduplicated, not inserted", async () => {
        db.meals = [meal({ id: EXPORTED_ID })];
        await withTools(null, async (c) => {
            const r = await call(c, [exportedRow]);
            const sc = r.structuredContent as unknown as {
                summary: { created: number; deduplicated: number };
                results: { status: string; meal_id: string | null }[];
            };
            expect(sc.summary.created).toBe(0);
            expect(sc.summary.deduplicated).toBe(1);
            expect(sc.results[0]!.status).toBe("deduplicated");
            expect(sc.results[0]!.meal_id).toBe(EXPORTED_ID);
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("a dry run says so up front", async () => {
        db.meals = [meal({ id: EXPORTED_ID })];
        await withTools(null, async (c) => {
            const r = await call(c, [exportedRow], { dry_run: true });
            const sc = r.structuredContent as unknown as {
                summary: { would_create: number; deduplicated: number };
            };
            expect(sc.summary.would_create).toBe(0);
            expect(sc.summary.deduplicated).toBe(1);
        });
    });

    test("an id the user does not have imports normally", async () => {
        await withTools(null, async (c) => {
            const r = await call(c, [exportedRow]);
            const sc = r.structuredContent as unknown as {
                summary: { created: number };
            };
            expect(sc.summary.created).toBe(1);
            expect(db.inserted).toHaveLength(1);
        });
    });
});

// ---------- delete tools report what actually happened ----------

// A delete that matched no row (stale id, typo, or an id belonging to another
// user — filtered out by the `user_id` eq) used to still print "deleted", so
// the model told the user the entry was gone while it kept showing up in every
// summary and total. Each handler must branch on whether a row matched.
describe("delete tools distinguish deleted from not-found", () => {
    const cases: {
        tool: string;
        id: string;
        seed: (id: string) => void;
        deleted: string;
        notFound: string;
    }[] = [
        {
            tool: "delete_meal",
            id: "m1",
            seed: (id) => {
                db.meals = [storedMeal({ id })];
            },
            deleted: "Meal m1 deleted.",
            notFound: "No meal found with id m1.",
        },
        {
            tool: "delete_water",
            id: "w1",
            seed: (id) => db.rowIds.add(id),
            deleted: "Water entry w1 deleted.",
            notFound: "No water entry found with id w1.",
        },
        {
            tool: "delete_weight",
            id: "k1",
            seed: (id) => db.rowIds.add(id),
            deleted: "Weight entry k1 deleted.",
            notFound: "No weight entry found with id k1.",
        },
    ];

    for (const c of cases) {
        test(`${c.tool} confirms a row it removed`, async () => {
            c.seed(c.id);
            await withTools(null, async (call) => {
                expect(textOf(await call(c.tool, { id: c.id }))).toBe(
                    c.deleted,
                );
            });
        });

        test(`${c.tool} does not claim success for an unknown id`, async () => {
            await withTools(null, async (call) => {
                const text = textOf(await call(c.tool, { id: c.id }));
                expect(text).toBe(c.notFound);
                expect(text).not.toContain("deleted.");
            });
        });
    }
});

// ---------- delete_account leaves no trace of the deleted user ----------

// deleteAllUserData deletes tool_analytics first, then withAnalytics inserts a
// fresh row once the handler resolves. tool_analytics.user_id is a plain
// varchar with no FK, so that insert succeeds and puts the just-deleted user's
// id straight back into the table the tool promised it had emptied. The row
// itself is still worth keeping — it must simply not be attributable.
describe("delete_account analytics", () => {
    const rowsFor = (tool: string) =>
        db.analyticsRows.filter((r) => r.tool_name === tool);

    test("a completed deletion is recorded under the sentinel, not the user", async () => {
        await withTools(null, async (call) => {
            expect(
                textOf(await call("delete_account", { confirm: true })),
            ).toContain("permanently deleted");
        });

        expect(db.accountWipes).toBe(1);
        const rows = rowsFor("delete_account");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe(DELETED_ACCOUNT_ANALYTICS_ID);
        expect(rows[0]!.success).toBe(true);
        expect(db.analyticsRows.some((r) => r.user_id === "u1")).toBe(false);
    });

    test("a cancelled deletion stays attributed to the user", async () => {
        await withTools(null, async (call) => {
            expect(
                textOf(await call("delete_account", { confirm: false })),
            ).toContain("cancelled");
        });

        expect(db.accountWipes).toBe(0);
        const rows = rowsFor("delete_account");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe("u1");
    });

    test("other tools still record the real user id", async () => {
        await withTools(null, async (call) => {
            await call("get_profile");
        });

        const rows = rowsFor("get_profile");
        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe("u1");
    });
});

// ---------- the summary states its own denominator (issue #70) ----------
//
// The unit-level pin above proves the two aggregations legitimately disagree.
// This proves get_nutrition_summary SAYS so, which is the actual fix: the
// calendar length of the window rides on the wire next to logged_days, and the
// text warns the model that get_trends will print a smaller figure for the same
// days. Neither is reachable from a pure function — both are assembled in the
// handler — so this goes through the real tool.
describe("get_nutrition_summary discloses its logged-day denominator", () => {
    const START = "2026-06-27";
    const END = "2026-07-26"; // 30 calendar days inclusive
    const dayAt = (i: number) => {
        const d = new Date(`${START}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().slice(0, 10);
    };

    /** `step` 2 logs every other day (15 of 30), `step` 1 logs all 30. */
    function stage(step: number): void {
        db.meals = [];
        db.water = [];
        for (let i = 0; i < 30; i += step) {
            db.meals.push(
                meal({
                    id: `d-${i}`,
                    logged_at: `${dayAt(i)}T12:00:00.000Z`,
                    calories: 2000,
                    protein_g: 100,
                    carbs_g: 200,
                    fat_g: 80,
                    fiber_g: null,
                    sugar_g: null,
                    alcohol_g: null,
                }),
            );
            db.water.push({
                id: `w-${i}`,
                user_id: "u1",
                amount_ml: 2000,
                logged_at: `${dayAt(i)}T12:00:00.000Z`,
                notes: null,
                created_at: `${dayAt(i)}T12:00:00.000Z`,
                idempotency_key: null,
            });
        }
    }

    interface SummaryPayload {
        logged_days: number;
        days_in_range: number;
        averages: Record<string, number>;
        locale: string;
    }

    const summarize = async (call: CallTool) =>
        call("get_nutrition_summary", { start_date: START, end_date: END });

    test("a half-logged window reports 15 logged days out of 30 in range", async () => {
        stage(2);
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(sc.logged_days).toBe(15);
            expect(sc.days_in_range).toBe(30);
            // Per LOGGED day — the same 2000 kcal a user sees on any one of the
            // days they ate, not the 1000 get_trends reports for the month.
            expect(sc.averages.calories).toBe(2000);
            expect(sc.averages.protein_g).toBe(100);
            expect(sc.averages.carbs_g).toBe(200);
            expect(sc.averages.fat_g).toBe(80);
            expect(sc.averages.water_ml).toBe(2000);
        });
    });

    test("...and the text tells the model which denominator that was", async () => {
        stage(2);
        await withTools(null, async (call) => {
            const text = textOf(await summarize(call));
            expect(text).toContain(
                "Daily averages are per logged day — 15 of the 30 days in range.",
            );
            expect(text).toContain(
                "get_trends averages over all 30 calendar days instead",
            );
        });
    });

    // No gap, nothing to disclose: the note would be noise on what is the
    // common case for anyone logging daily.
    test("a fully-logged window stays silent about the denominator", async () => {
        stage(1);
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(sc.logged_days).toBe(30);
            expect(sc.days_in_range).toBe(30);
            expect(sc.averages.calories).toBe(2000);
            expect(textOf(r)).not.toContain("per logged day");
        });
    });

    // days_in_range is a declared outputSchema field, so the early return for a
    // window with nothing in it has to carry it too or the SDK rejects the
    // result outright.
    test("an empty range still reports the size of the window", async () => {
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(r.isError).toBeFalsy();
            expect(sc.logged_days).toBe(0);
            expect(sc.days_in_range).toBe(30);
            // The empty-range branch has its own structuredContent literal,
            // separate from the populated one below — both must carry the
            // widget's resolved locale, not just the common case.
            expect(sc.locale).toBe("en");
        });
    });

    // Widgets are English-only; structuredContent.locale stays "en".
    test("structuredContent locale stays English even if a profile locale is set", async () => {
        stage(1);
        db.profile = { ...PROFILE_BASE, locale: "de" };
        await withTools(null, async (call) => {
            const sc = (await summarize(call))
                .structuredContent as unknown as SummaryPayload;
            expect(sc.locale).toBe("en");
        });
    });

    test("structuredContent defaults locale to English when never set", async () => {
        stage(1);
        db.profile = { ...PROFILE_BASE, locale: null };
        await withTools(null, async (call) => {
            const sc = (await summarize(call))
                .structuredContent as unknown as SummaryPayload;
            expect(sc.locale).toBe("en");
        });
    });

    // A single-day range is 1 day, not 0 — an off-by-one here would make the
    // note read "1 of the 0 days in range" on the most ordinary query there is.
    test("a single-day range spans one day", async () => {
        stage(1);
        await withTools(null, async (call) => {
            const r = (await call("get_nutrition_summary", {
                start_date: START,
                end_date: START,
            })) as ToolResult;
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(sc.days_in_range).toBe(1);
        });
    });
});

// The same covered-days rule as fiber and sugar, but with no opt-in above it
// and with the "never recorded" case as the norm rather than the exception —
// so the summary is where a fabricated "0 mg average" would be most visible.
describe("get_nutrition_summary reports caffeine over its covered days only", () => {
    const START = "2026-07-20";
    const END = "2026-07-24"; // 5 calendar days inclusive

    interface SummaryPayload {
        averages: Record<string, number | null>;
        recorded_days: Record<string, number | null>;
        days: { date: string; caffeine_mg: number | null }[];
    }

    /** One meal a day for five days; `caffeine` gives each day's figure, with
     *  null meaning that day recorded no caffeine at all. */
    function stage(caffeine: (number | null)[]): void {
        db.meals = caffeine.map((mg, i) =>
            meal({
                id: `d-${i}`,
                logged_at: `2026-07-2${i}T12:00:00.000Z`,
                calories: 600,
                fiber_g: null,
                sugar_g: null,
                alcohol_g: null,
                caffeine_mg: mg,
            }),
        );
    }

    const summarize = (call: CallTool) =>
        call("get_nutrition_summary", { start_date: START, end_date: END });

    test("two coffee days out of five average over the two", async () => {
        stage([95, null, null, 105, null]);
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(sc.recorded_days.caffeine_mg).toBe(2);
            expect(sc.averages.caffeine_mg).toBe(100);
            // The wrong answer: 200 / 5 logged days.
            expect(sc.averages.caffeine_mg).not.toBe(40);
            // Per-day, an uncovered day is null rather than a summed 0, so the
            // widget's client-side re-average can tell them apart.
            expect(sc.days.map((d) => d.caffeine_mg)).toEqual([
                95,
                null,
                null,
                105,
                null,
            ]);
            // And the text says which days the figure came from.
            expect(textOf(r)).toContain("caffeine 2");
        });
    });

    // The #78 trap in its most likely form: five logged days, none of them a
    // coffee. Nothing may claim a caffeine figure — not an average, not a
    // per-day zero, not a line in the text.
    test("a window with no caffeine at all reports null, not 0", async () => {
        stage([null, null, null, null, null]);
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(sc.recorded_days.caffeine_mg).toBe(0);
            expect(sc.averages.caffeine_mg).toBeNull();
            expect(sc.days.every((d) => d.caffeine_mg === null)).toBe(true);
            expect(textOf(r)).not.toContain("Caffeine");
            expect(textOf(r)).not.toContain("caffeine");
        });
    });

    // recorded_days.caffeine_mg is a non-nullable declared field and averages
    // is a TOTALS_ITEM, so the empty-window early return has to build both — an
    // omitted key there is a validation error, not a null.
    test("an empty window still emits a complete, valid payload", async () => {
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(r.isError).toBeFalsy();
            expect(sc.recorded_days.caffeine_mg).toBe(0);
            expect(sc.averages.caffeine_mg).toBeNull();
            expect(Object.keys(sc.averages)).toContain("caffeine_mg");
        });
    });

    // Every day covered: the coverage note is for PARTIAL coverage only, so
    // naming caffeine here would be noise on the case of a daily coffee
    // drinker, which is the most common caffeine user there is.
    test("a fully-covered window stays silent about caffeine coverage", async () => {
        stage([95, 95, 95, 95, 95]);
        await withTools(null, async (call) => {
            const r = await summarize(call);
            const sc = r.structuredContent as unknown as SummaryPayload;
            expect(sc.recorded_days.caffeine_mg).toBe(5);
            expect(sc.averages.caffeine_mg).toBe(95);
            expect(textOf(r)).not.toContain("caffeine 5");
        });
    });
});

// ---------- every write path places logged_at in the user's timezone ----------

// Issue #68. Before this, an offset-less `logged_at` went straight into a
// timestamptz column, where Postgres reads it in the session zone (UTC). A Kyiv
// user's 21:00 dinner landed at 21:00Z — midnight the NEXT day locally — so the
// meal vanished from "today" and reappeared on tomorrow's summary, and a bare
// date became UTC midnight, which for every negative-offset zone is the
// PREVIOUS local day. bulk_import_meals had resolved these correctly for
// months; the manual tools had no resolution at all. These tests drive the real
// tools end-to-end and assert on the value handed to the DB layer, because the
// echoed text alone cannot tell a correct instant from a mislabelled one.
describe("manual write tools resolve logged_at in the profile timezone", () => {
    const oatmeal = {
        description: "Oatmeal",
        meal_type: "breakfast",
        calories: 300,
    };
    const loggedAtOf = (row: Record<string, unknown> | undefined) =>
        row?.logged_at as string | undefined;

    // The core case: 08:30 in Kyiv is 05:30Z in July (UTC+3). Storing the raw
    // string instead files the meal three hours late.
    test("an offset-less local time is read as wall-clock time in the saved zone", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            await call("log_meal", {
                ...oatmeal,
                logged_at: "2026-07-20T08:30:00",
            });
            expect(loggedAtOf(db.inserted[0])).toBe("2026-07-20T05:30:00.000Z");
        });
    });

    // The offset must come from the DATE being logged, not from today. Kyiv is
    // UTC+2 in January and UTC+3 in July, so a backfilled winter meal resolved
    // with the current offset would sit an hour off — enough to cross midnight
    // for anything logged late in the evening.
    test("a backfilled winter date uses that date's offset, not today's", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            await call("log_meal", {
                ...oatmeal,
                logged_at: "2026-01-15T08:30",
            });
            expect(loggedAtOf(db.inserted[0])).toBe("2026-01-15T06:30:00.000Z");
        });
    });

    // A date with no time is anchored at local NOON, not local midnight: noon
    // leaves ~12 hours of slack before any offset change could drag the row
    // onto an adjacent calendar day.
    test("a bare date anchors at local noon and reads back as the same day", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            await call("log_meal", { ...oatmeal, logged_at: "2026-07-20" });
            const stored = loggedAtOf(db.inserted[0])!;
            expect(stored).toBe("2026-07-20T09:00:00.000Z");
            expect(dateInTz(stored, "Europe/Kyiv")).toBe("2026-07-20");
        });
    });

    // The exact shape of the bug, in the zone that shows it: UTC midnight on
    // 2026-07-20 is 17:00 on 2026-07-19 in Los Angeles, so the old behaviour
    // filed a bare date one day EARLY for every user west of Greenwich.
    test("a bare date in a negative-offset zone does not slip to the previous day", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "America/Los_Angeles" };
        await withTools(null, async (call) => {
            await call("log_meal", { ...oatmeal, logged_at: "2026-07-20" });
            const stored = loggedAtOf(db.inserted[0])!;
            expect(stored).toBe("2026-07-20T19:00:00.000Z");
            expect(dateInTz(stored, "America/Los_Angeles")).toBe("2026-07-20");
            // The value the old code would have written, for contrast.
            expect(
                dateInTz("2026-07-20T00:00:00.000Z", "America/Los_Angeles"),
            ).toBe("2026-07-19");
        });
    });

    // A value that carries its own offset already names an instant. Applying
    // the profile zone on top of it would shift a correct timestamp.
    test("a value carrying its own offset is untouched by the profile timezone", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            await call("log_meal", {
                ...oatmeal,
                logged_at: "2026-07-20T08:30:00Z",
            });
            await call("log_meal", {
                ...oatmeal,
                logged_at: "2026-07-20T08:30:00+05:00",
            });
            expect(loggedAtOf(db.inserted[0])).toBe("2026-07-20T08:30:00.000Z");
            expect(loggedAtOf(db.inserted[1])).toBe("2026-07-20T03:30:00.000Z");
        });
    });

    // Same offset-carrying string, opposite hemisphere of the prime meridian:
    // the profile zone must make no difference at all.
    test("two profiles resolve the same offset-carrying value identically", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            await call("log_meal", {
                ...oatmeal,
                logged_at: "2026-07-20T08:30:00+05:00",
            });
        });
        const kyiv = loggedAtOf(db.inserted[0]);
        db.inserted = [];
        db.profile = { ...PROFILE_BASE, timezone: "America/Los_Angeles" };
        await withTools(null, async (call) => {
            await call("log_meal", {
                ...oatmeal,
                logged_at: "2026-07-20T08:30:00+05:00",
            });
        });
        expect(loggedAtOf(db.inserted[0])).toBe(kyiv!);
    });

    // The resolver must stay out of the way when the caller said nothing:
    // insertMeal derives its own "now" AND folds logged_at into the content
    // digest, so substituting a value here would change the idempotency key.
    test("an omitted logged_at reaches the DB layer as undefined", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const r = await call("log_meal", oatmeal);
            expect(r.isError).toBeFalsy();
            expect(db.inserted).toHaveLength(1);
            expect(loggedAtOf(db.inserted[0])).toBeUndefined();
            expect(textOf(r)).not.toContain("set_timezone");
        });
    });

    // log_meal, update_meal and log_water validated logged_at not at all, so
    // junk was handed to Postgres and came back as a raw cast error (or, worse,
    // parsed into something plausible). The handler throws, and withAnalytics
    // turns that into an isError result rather than rejecting the call.
    test("log_meal rejects a logged_at it cannot place on the timeline", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                ...oatmeal,
                logged_at: "yesterday evening",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("logged_at is invalid");
            expect(db.inserted).toHaveLength(0);
        });
    });

    // Read as UTC, an ordinary same-day local time from a user east of UTC
    // resolves into the future and is rejected — a call that used to succeed.
    // "logged_at is in the future" alone names the wrong cause, so the failure
    // path has to carry the same unset-timezone hint the success path does.
    test("a future-looking local time on an unconfigured account blames the timezone", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const soon = new Date(Date.now() + 2 * 60 * 60 * 1000)
                .toISOString()
                .slice(0, 19);
            const r = await call("log_meal", { ...oatmeal, logged_at: soon });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("in the future");
            expect(textOf(r)).toContain("set_timezone");
            expect(db.inserted).toHaveLength(0);
        });
    });

    // An unparseable value was never placed anywhere, so the timezone had
    // nothing to do with it and the hint would only misdirect.
    test("an unparseable value on an unconfigured account does not blame the timezone", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                ...oatmeal,
                logged_at: "yesterday evening",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).not.toContain("set_timezone");
        });
    });

    // A day/month swap ("20/07" mapped to month 20) is the realistic version of
    // the same mistake, and it must not roll over into a valid 2027 date.
    test("log_water rejects a calendar date that does not exist", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_water", {
                amount_ml: 250,
                logged_at: "2026-20-07",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("logged_at is invalid");
            expect(db.waterInserted).toHaveLength(0);
        });
    });

    // update_meal took the third route with no validation at all, and it can
    // move an already-correct entry, so a bad value there is a silent
    // corruption rather than a failed write.
    test("update_meal resolves a moved timestamp in the saved zone", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const r = await call("update_meal", {
                id: "m1",
                logged_at: "2026-07-20T08:30:00",
            });
            expect(r.isError).toBeFalsy();
            expect(loggedAtOf(db.mealUpdates[0])).toBe(
                "2026-07-20T05:30:00.000Z",
            );
        });
    });

    // No profiles row is the only reliable "timezone was never configured"
    // signal — a defaulted "UTC" column is indistinguishable from a user who
    // genuinely chose UTC. Falling back silently would file the entry hours off
    // with nothing on screen to explain it, so the tool has to say so.
    test("a never-configured timezone warns that the value was read as UTC", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    ...oatmeal,
                    logged_at: "2026-07-20T08:30:00",
                }),
            );
            expect(text).toContain("set_timezone");
            expect(text).toContain("no timezone set");
            expect(loggedAtOf(db.inserted[0])).toBe("2026-07-20T08:30:00.000Z");
        });
    });

    // #99: a profile row can exist — any of set_weight_unit, set_widget_display
    // or set_alcohol_tracking creates one — without the user ever having called
    // set_timezone. `profile !== null` alone must not read as "configured".
    test("a profile row with no timezone still warns, even though it exists", async () => {
        db.profile = { ...PROFILE_BASE, timezone: null };
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    ...oatmeal,
                    logged_at: "2026-07-20T08:30:00",
                }),
            );
            expect(text).toContain("set_timezone");
            expect(text).toContain("no timezone set");
            expect(loggedAtOf(db.inserted[0])).toBe("2026-07-20T08:30:00.000Z");
        });
    });

    // The warning is about a missing setting, not about the timestamp form: a
    // value carrying its own offset never consulted the timezone, so nagging
    // about it would be noise on every single call.
    test("no warning when the value carried its own offset, even with no profile", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    ...oatmeal,
                    logged_at: "2026-07-20T08:30:00Z",
                }),
            );
            expect(text).not.toContain("set_timezone");
        });
    });

    // And a configured profile must stay quiet, or the note fires on every
    // ordinary log for every user who has done nothing wrong.
    test("no warning when the profile has a timezone", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const text = textOf(
                await call("log_meal", {
                    ...oatmeal,
                    logged_at: "2026-07-20T08:30:00",
                }),
            );
            expect(text).not.toContain("set_timezone");
        });
    });

    // The most common call shape of all: no logged_at, because "I just ate
    // this" never carries one. Found live — a meal logged this way with no
    // profile timezone produced no warning, silently defeating #99's entire
    // point for the overwhelming majority of real calls.
    test("still warns when logged_at is omitted entirely and the timezone is unset", async () => {
        db.profile = { ...PROFILE_BASE, timezone: null };
        await withTools(null, async (call) => {
            const text = textOf(await call("log_meal", oatmeal));
            expect(text).toContain("set_timezone");
            expect(text).toContain("no timezone set");
            expect(loggedAtOf(db.inserted[0])).toBeUndefined();
        });
    });

    test("no warning when logged_at is omitted and the timezone is configured", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const text = textOf(await call("log_meal", oatmeal));
            expect(text).not.toContain("set_timezone");
        });
    });

    // Water is bucketed into local days the same way meals are, so an
    // unresolved offset-less time moves a late-evening glass onto tomorrow's
    // hydration total.
    test("log_water resolves an offset-less time the same way", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const r = await call("log_water", {
                amount_ml: 250,
                logged_at: "2026-07-20T08:30:00",
            });
            expect(r.isError).toBeFalsy();
            expect(loggedAtOf(db.waterInserted[0])).toBe(
                "2026-07-20T05:30:00.000Z",
            );
        });
    });

    // Weight is ordered by logged_at to pick "latest", so a few hours of drift
    // can reorder two readings taken on the same day.
    test("log_weight resolves an offset-less time the same way", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const r = await call("log_weight", {
                weight: 70,
                unit: "kg",
                logged_at: "2026-07-20T08:30:00",
            });
            expect(r.isError).toBeFalsy();
            expect(loggedAtOf(db.weightInserted[0])).toBe(
                "2026-07-20T05:30:00.000Z",
            );
        });
    });

    // update_weight builds a patch object, and only a defined logged_at may
    // appear in it — resolving must not smuggle an undefined key into an update
    // that was only meant to change the notes.
    test("update_weight resolves an offset-less time and omits an absent one", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            await call("update_weight", {
                id: "k1",
                logged_at: "2026-07-20T08:30:00",
            });
            expect(loggedAtOf(db.weightUpdates[0])).toBe(
                "2026-07-20T05:30:00.000Z",
            );
            await call("update_weight", { id: "k1", notes: "morning" });
            expect(db.weightUpdates[1]).not.toHaveProperty("logged_at");
        });
    });

    // The point of the whole change. The two routes do NOT dedupe against each
    // other — the importer stamps `import:` keys and log_meal derives `auto:`
    // ones — so both copies are stored either way. What must not differ is
    // where they land: before the fix the same string went in hours apart, so
    // the hand-logged meal and the imported one could sit on different local
    // days and every read path disagreed with itself.
    test("log_meal and bulk_import_meals resolve the same string identically", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        const LOCAL = "2026-07-20T08:30:00";
        await withTools(null, async (call) => {
            await call("log_meal", { ...oatmeal, logged_at: LOCAL });
            await call("bulk_import_meals", {
                meals: [
                    {
                        source_line: 1,
                        description: "Oatmeal",
                        logged_at: LOCAL,
                        calories: 300,
                    },
                ],
                expected_row_count: 1,
                dry_run: false,
            });
            expect(db.inserted).toHaveLength(2);
            expect(loggedAtOf(db.inserted[1])).toBe(
                loggedAtOf(db.inserted[0])!,
            );
            expect(loggedAtOf(db.inserted[0])).toBe("2026-07-20T05:30:00.000Z");
        });
    });

    // Same invariant for the bare-date form, where the two routes could most
    // easily disagree: one anchoring at noon and the other at midnight would
    // put the manual entry and the imported one on different local days.
    test("log_meal and bulk_import_meals anchor a bare date identically", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "America/Los_Angeles" };
        await withTools(null, async (call) => {
            await call("log_meal", { ...oatmeal, logged_at: "2026-07-20" });
            await call("bulk_import_meals", {
                meals: [
                    {
                        source_line: 1,
                        description: "Oatmeal",
                        logged_at: "2026-07-20",
                        calories: 300,
                    },
                ],
                expected_row_count: 1,
                dry_run: false,
            });
            expect(loggedAtOf(db.inserted[1])).toBe(
                loggedAtOf(db.inserted[0])!,
            );
            expect(loggedAtOf(db.inserted[0])).toBe("2026-07-20T19:00:00.000Z");
        });
    });
});

// ---------- the server is the clock (issue #102) ----------
//
// Several hosts (Claude Desktop among them) keep the wall clock out of the
// model's context. With no clock the model either interrogated the user ("what
// time is it?") on every single log, or guessed — and a guessed time lands on
// the wrong local day for anyone far from UTC. The server always knows both the
// instant and the user's zone, so it says so.
//
// These read the real clock, so they assert SHAPE and ZONE, never a pinned
// value: the date is compared against dateInTz sampled around the call, which
// is both zone-sensitive and immune to a midnight rollover mid-test.
describe("current-time disclosure", () => {
    /** "Local time now: Sunday 2026-08-09 15:04:22 (Europe/Kyiv)." */
    const clockRe = (tz: string) =>
        new RegExp(
            `Local time now: ([A-Z][a-z]+day) (\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2}:\\d{2}) \\(${tz}\\)\\.`,
        );
    const UTC_NOW_RE =
        /UTC now: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\./;

    /** Assert the clock line names `tz`'s local day and weekday right now. */
    function expectClockIn(text: string, tz: string, sampled: string[]): void {
        const m = text.match(clockRe(tz));
        expect(m).not.toBeNull();
        const utc = text.match(UTC_NOW_RE);
        expect(utc).not.toBeNull();
        const instant = utc![1]!;
        // The two halves are one instant rendered twice, so the zone is
        // genuinely applied and not merely printed in the label — this holds at
        // every hour, including the ones where tz and UTC share a date.
        expect(`${m![2]} ${m![3]}`).toBe(formatLocalDateTime(instant, tz));
        expect(m![1]).toBe(weekdayInTz(instant, tz));
        // ...and that instant is now, not a fixture.
        expect(sampled).toContain(dateInTz(instant, tz));
    }

    /** Local dates in `tz` before and after the call, to absorb a rollover. */
    async function around(
        tz: string,
        run: () => Promise<string>,
    ): Promise<{ text: string; sampled: string[] }> {
        const before = dateInTz(new Date(), tz);
        const text = await run();
        const after = dateInTz(new Date(), tz);
        return { text, sampled: [...new Set([before, after])] };
    }

    test("get_profile reports the zone AND the user's current wall clock", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
        await withTools(null, async (call) => {
            const { text, sampled } = await around("Europe/Kyiv", async () =>
                textOf(await call("get_profile")),
            );
            expect(text).toContain("Timezone: Europe/Kyiv.");
            expectClockIn(text, "Europe/Kyiv", sampled);
        });
    });

    test("get_profile still gives a clock when no timezone is set", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const { text, sampled } = await around("UTC", async () =>
                textOf(await call("get_profile")),
            );
            expect(text).toContain("Timezone: not set (defaulting to UTC).");
            expectClockIn(text, "UTC", sampled);
            // Knowing the time must not cost the caller the nudge to configure
            // a zone — UTC is a fallback, not the user's clock.
            expect(text).toContain("set_timezone");
        });
    });

    // #99: a profile row created by some other set_* tool, with timezone still
    // null, must read the same as no profile at all.
    test("get_profile treats a profile with no timezone as unset", async () => {
        db.profile = { ...PROFILE_BASE, timezone: null };
        await withTools(null, async (call) => {
            const { text, sampled } = await around("UTC", async () =>
                textOf(await call("get_profile")),
            );
            expect(text).toContain("Timezone: not set (defaulting to UTC).");
            expectClockIn(text, "UTC", sampled);
            expect(text).toContain("set_timezone");
        });
    });

    test("set_language is not registered", async () => {
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        try {
            const { tools } = await client.listTools();
            expect(tools.map((t) => t.name)).not.toContain("set_language");
        } finally {
            await client.close();
            await server.close();
        }
    });

    test("get_profile does not report a widget language", async () => {
        db.profile = { ...PROFILE_BASE, locale: "fr" };
        await withTools(null, async (call) => {
            const text = textOf(await call("get_profile"));
            expect(text).not.toContain("Language:");
            expect(text).not.toContain("Français");
            expect(text).not.toContain("set_language");
        });
    });

    test("get_profile reports weight unit and widget display together", async () => {
        db.profile = {
            ...PROFILE_BASE,
            preferred_weight_unit: "lb",
            widgets_enabled: false,
        };
        await withTools(null, async (call) => {
            const text = textOf(await call("get_profile"));
            expect(text).toContain("Weight unit: lb.");
            expect(text).toContain("Widgets: disabled.");
        });
    });

    test("get_profile flags weight unit as unset and widgets as enabled by default", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const text = textOf(await call("get_profile"));
            expect(text).toContain("Weight unit: not set.");
            expect(text).toContain("Widgets: enabled.");
        });
    });

    test("get_current_time answers in the profile's zone, and is measured", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Asia/Tokyo" };
        await withTools(null, async (call) => {
            const { text, sampled } = await around("Asia/Tokyo", async () =>
                textOf(await call("get_current_time")),
            );
            expectClockIn(text, "Asia/Tokyo", sampled);
            expect(text).not.toContain("No timezone is set");
        });

        const rows = db.analyticsRows.filter(
            (r) => r.tool_name === "get_current_time",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.user_id).toBe("u1");
        expect(rows[0]!.success).toBe(true);
    });

    // Without this the UTC fallback reads as the user's real local time, and a
    // model would resolve "this morning" against a clock up to 14 hours off.
    test("get_current_time flags that an unset zone means UTC, not local", async () => {
        db.profile = null;
        await withTools(null, async (call) => {
            const { text, sampled } = await around("UTC", async () =>
                textOf(await call("get_current_time")),
            );
            expectClockIn(text, "UTC", sampled);
            expect(text).toContain("No timezone is set for this account");
            expect(text).toContain("set_timezone");
        });
    });

    // #99: same as above, but via a profile row an unrelated set_* tool
    // created — this is the case that used to go quiet forever.
    test("get_current_time flags an unset zone even when the profile row exists", async () => {
        db.profile = { ...PROFILE_BASE, timezone: null };
        await withTools(null, async (call) => {
            const { text, sampled } = await around("UTC", async () =>
                textOf(await call("get_current_time")),
            );
            expectClockIn(text, "UTC", sampled);
            expect(text).toContain("No timezone is set for this account");
            expect(text).toContain("set_timezone");
        });
    });

    // The shipped guidance is the actual fix: the three "log it now" tools used
    // to tell the model to ask the user for the time before calling them. Now
    // they tell it to omit the field and let the server stamp now.
    test("log_meal, log_water and log_weight tell the model to omit logged_at, not to ask", async () => {
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        try {
            const { tools } = await client.listTools();
            for (const name of ["log_meal", "log_water", "log_weight"]) {
                const props = (
                    tools.find((t) => t.name === name)?.inputSchema as {
                        properties?: Record<string, { description?: string }>;
                    }
                )?.properties;
                const desc = props?.logged_at?.description ?? "";
                expect(desc).not.toBe("");
                expect(desc).not.toContain(
                    "ask the user before calling this tool",
                );
                // The only surviving mention of asking is the prohibition.
                expect(
                    desc.replaceAll("Do NOT ask the user what time it is.", ""),
                ).not.toContain("ask the user");
                expect(desc).toContain("omit this field entirely");
                expect(desc).toContain("get_current_time");
            }
            // ...and the tool that replaces the question is actually reachable.
            expect(tools.map((t) => t.name)).toContain("get_current_time");
        } finally {
            await client.close();
            await server.close();
        }
    });
});

// The whole-account archive is the server's ONLY export path — the meals-only
// export_meals tool it replaced is gone, and its meals.csv now lives inside the
// ZIP. So the description has to carry two things a user would otherwise be
// stranded by: where the meal history went, and the asymmetry that five of the
// six files have no way back in.
describe("export_all_data is on the tool surface", () => {
    async function toolsOf() {
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        await client.close();
        await server.close();
        return tools;
    }

    test("it is the only export tool — export_meals is gone", async () => {
        const names = (await toolsOf()).map((t) => t.name);
        expect(names).toContain("export_all_data");
        // Not merely renamed away: leaving the old tool registered beside this
        // one is the thing this decision rejected, so a re-added meals-only
        // export should fail here rather than quietly double the surface.
        expect(names).not.toContain("export_meals");
    });

    test("its description names every file and the import asymmetry", async () => {
        const desc =
            (await toolsOf()).find((t) => t.name === "export_all_data")
                ?.description ?? "";
        for (const file of [
            "meals.csv",
            "meal_items.csv",
            "water.csv",
            "weight.csv",
            "goals.csv",
            "profile.csv",
            "README.txt",
        ]) {
            expect(desc, file).toContain(file);
        }
        expect(desc).toContain("60 minutes");
        expect(desc).toContain("export-only");
        // With no meals-only tool left, "export my meals" lands here. The
        // description has to say so, or the model reads a tool named
        // export_all_data and decides it is the wrong one.
        expect(desc).toContain("meals.csv inside the archive");
    });

    // The archive is a write — it uploads to the exports bucket — and the
    // signed link differs on every call, so despite reading like a query none
    // of this is read-only or idempotent.
    test("it is annotated as the write it is", async () => {
        const all = (await toolsOf()).find((t) => t.name === "export_all_data");
        expect(all?.annotations).toEqual({
            readOnlyHint: false,
            destructiveHint: false,
            idempotentHint: false,
            openWorldHint: false,
        });
    });
});

describe("household PAT has no default user", () => {
    async function withHousehold(
        run: (call: CallTool, list: () => Promise<string[]>) => Promise<void>,
    ): Promise<void> {
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            { kind: "household", householdId: "hh-1" },
            true,
            null,
        );
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "0.0.0" });
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: args,
                    }) as Promise<ToolResult>,
                async () => {
                    const { tools } = await client.listTools();
                    return tools.map((t) => t.name);
                },
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    test("tools/list still advertises person tools but not membership admin tools", async () => {
        await withHousehold(async (_call, list) => {
            const names = await list();
            expect(names).toContain("log_meal");
            expect(names).toContain("get_profile");
            expect(names).not.toContain("rotate_household_token");
            expect(names).toContain("list_members");
            expect(names).not.toContain("add_household_member");
            expect(names).toContain("get_household_config");
            expect(names).toContain("update_household_config");
            expect(names).not.toContain("update_fridge_locations");
        });
    });

    test("log_meal without a user fails and writes nothing", async () => {
        await withHousehold(async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r).toLowerCase()).toContain("user_id");
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("get_profile does not invent a user", async () => {
        await withHousehold(async (call) => {
            const r = await call("get_profile");
            expect(r.isError).toBe(true);
            expect(textOf(r).toLowerCase()).toContain("user_id");
            expect(db.profileReads).toHaveLength(0);
        });
    });

    test("removed membership admin tools are not callable on a household PAT", async () => {
        await withHousehold(async (call) => {
            for (const name of [
                "rotate_household_token",
                "add_household_member",
            ]) {
                await expect(
                    call(
                        name,
                        name === "add_household_member"
                            ? {
                                  display_name: "Sam",
                                  username: "sam",
                                  password: "password1",
                              }
                            : {},
                    ),
                ).rejects.toThrow(/not found/);
            }
            expect(db.tokenRotations).toHaveLength(0);
            expect(db.addedLogins).toHaveLength(0);
        });
    });
});

describe("household person targeting", () => {
    const alice = "11111111-1111-4111-8111-111111111111";
    const bob = "22222222-2222-4222-8222-222222222222";
    const stranger = "33333333-3333-4333-8333-333333333333";

    async function withHousehold(
        run: (call: CallTool) => Promise<void>,
    ): Promise<void> {
        db.members = [
            {
                householdId: "hh-1",
                userId: alice,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            { kind: "household", householdId: "hh-1" },
            true,
            null,
        );
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "0.0.0" });
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: args,
                    }) as Promise<ToolResult>,
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    test("list_members returns every household member", async () => {
        await withHousehold(async (call) => {
            const r = await call("list_members");
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.members).toEqual([
                {
                    user_id: alice,
                    display_name: "Alice",
                    role: "owner",
                },
                {
                    user_id: bob,
                    display_name: "Bob",
                    role: "member",
                },
            ]);
        });
    });

    test("PAT log_meal for a member writes that user_id", async () => {
        await withHousehold(async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                user_id: alice,
            });
            expect(r.isError).toBeFalsy();
            expect(db.inserted[0]!.user_id).toBe(alice);
        });
    });

    test("PAT log_meal for a stranger writes nothing", async () => {
        await withHousehold(async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                user_id: stranger,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("not a household member");
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("OAuth log_meal without user_id still writes the token user", async () => {
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
            });
            expect(r.isError).toBeFalsy();
            expect(db.inserted[0]!.user_id).toBe("u1");
        });
    });

    test("OAuth log_meal with someone else's user_id is not sudo", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                user_id: bob,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain(OAUTH_USER_MISMATCH);
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("OAuth get_nutrition_summary can read a household peer", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("get_nutrition_summary", {
                start_date: "2026-08-01",
                end_date: "2026-08-07",
                user_id: bob,
            });
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent).toBeDefined();
        });
    });

    test("OAuth get_nutrition_summary of a stranger is not a household member", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("get_nutrition_summary", {
                start_date: "2026-08-01",
                end_date: "2026-08-07",
                user_id: stranger,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("not a household member");
        });
    });

    test("member OAuth list_members returns the caller's household", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("list_members");
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.members).toEqual([
                {
                    user_id: bob,
                    display_name: "Bob",
                    role: "member",
                },
                {
                    user_id: "u1",
                    display_name: "U1",
                    role: "owner",
                },
            ]);
        });
    });

    test("PAT set_nutrition_goals for a member writes that user", async () => {
        await withHousehold(async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_calories: 1800,
                user_id: bob,
            });
            expect(r.isError).toBeFalsy();
            expect(db.goals?.user_id).toBe(bob);
            expect(db.goals?.daily_calories).toBe(1800);
        });
    });

    test("PAT log_meal for a member of another household writes nothing", async () => {
        const other = "44444444-4444-4444-8444-444444444444";
        await withHousehold(async (call) => {
            db.members.push({
                householdId: "hh-other",
                userId: other,
                role: "member",
                displayName: "Other",
            });
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                user_id: other,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("not a household member");
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("PAT start_meal_import names the member for the widget", async () => {
        await withHousehold(async (call) => {
            const r = await call("start_meal_import", { user_id: alice });
            expect(r.isError).toBeFalsy();
            const sc = START_IMPORT_OUTPUT_SCHEMA.parse(r.structuredContent);
            expect(sc.user_id).toBe(alice);
            expect(sc.import_tool_name).toBe("bulk_import_meals");
        });
    });

    test("PAT delete_account is refused and deletes nothing", async () => {
        await withHousehold(async (call) => {
            const r = await call("delete_account", { confirm: true });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain(HOUSEHOLD_CANNOT_DELETE_ACCOUNT);
        });
    });

    test("non-member OAuth list_members is refused", async () => {
        db.members = [];
        await withTools(null, async (call) => {
            const r = await call("list_members");
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("not a household member");
        });
    });
});

describe("household config tools", () => {
    const alice = "11111111-1111-4111-8111-111111111111";

    async function withHousehold(
        run: (call: CallTool, list: () => Promise<string[]>) => Promise<void>,
    ): Promise<void> {
        db.members = [
            {
                householdId: "hh-1",
                userId: alice,
                role: "owner",
                displayName: "Alice",
            },
        ];
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            { kind: "household", householdId: "hh-1" },
            true,
            null,
        );
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "0.0.0" });
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: args,
                    }) as Promise<ToolResult>,
                async () => {
                    const { tools } = await client.listTools();
                    return tools.map((t) => t.name);
                },
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    test("PAT get on a fresh household returns the bootstrap name and empty lists", async () => {
        await withHousehold(async (call) => {
            const r = await call("get_household_config");
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent).toEqual({
                name: "Home",
                recipe_search_places: [],
                preferences: {
                    constraints: [],
                    budget: null,
                    shopping_cadence: null,
                },
            });
        });
    });

    test("PAT name replace then get returns that name", async () => {
        await withHousehold(async (call) => {
            const written = await call("update_household_config", {
                name: "Cabin",
            });
            expect(written.isError).toBeFalsy();
            expect(written.structuredContent?.name).toBe("Cabin");
            const got = await call("get_household_config");
            expect(got.structuredContent?.name).toBe("Cabin");
            expect(got.structuredContent).not.toHaveProperty(
                "fridge_locations",
            );
        });
    });

    test("PAT recipe places persist kinds", async () => {
        await withHousehold(async (call) => {
            const r = await call("update_household_config", {
                recipe_search_places: [
                    {
                        name: "Costco",
                        kind: "grocery",
                        url: "https://costco.com",
                    },
                ],
            });
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.recipe_search_places).toEqual([
                {
                    name: "Costco",
                    kind: "grocery",
                    url: "https://costco.com",
                },
            ]);
        });
    });

    test("member OAuth reads the same config the PAT wrote", async () => {
        await withHousehold(async (call) => {
            await call("update_household_config", {
                recipe_search_places: [
                    { name: "Garage freezer", kind: "other" },
                ],
            });
        });
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "member",
                displayName: "U1",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("get_household_config");
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.recipe_search_places).toEqual([
                { name: "Garage freezer", kind: "other", url: null },
            ]);
            expect(r.structuredContent).not.toHaveProperty("fridge_locations");
        });
    });

    test("owner OAuth config write sticks", async () => {
        await withTools(null, async (call) => {
            const r = await call("update_household_config", {
                name: "Crisper",
            });
            expect(r.isError).toBeFalsy();
        });
        expect(db.household?.name).toBe("Crisper");
    });

    test("member OAuth fridge location writes are gone from the wire", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "member",
                displayName: "U1",
            },
        ];
        await withHousehold(async (_call, list) => {
            const names = await list();
            expect(names).not.toContain("update_fridge_locations");
        });
        expect(db.household?.fridgeLocations).toEqual([]);
    });

    test("member OAuth config write is refused", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "member",
                displayName: "U1",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("update_household_config", {
                name: "Taken",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("owner");
        });
        expect(db.household?.name).toBe("Home");
    });

    test("invalid recipe place kind errors and leaves config unchanged", async () => {
        db.household = {
            name: "Home",
            fridgeLocations: ["fridge"],
            recipeSearchPlaces: [],
            preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
        };
        await withHousehold(async (call) => {
            const r = await call("update_household_config", {
                recipe_search_places: [{ name: "X", kind: "warehouse" }],
            });
            expect(r.isError).toBe(true);
        });
        expect(db.household?.fridgeLocations).toEqual(["fridge"]);
        expect(db.household?.recipeSearchPlaces).toEqual([]);
    });

    test("PAT log_meal for Alice still writes after a config update", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: alice,
                role: "owner",
                displayName: "Alice",
            },
        ];
        await withHousehold(async (call) => {
            await call("update_household_config", { name: "After write" });
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                user_id: alice,
            });
            expect(r.isError).toBeFalsy();
            expect(db.inserted[0]!.user_id).toBe(alice);
        });
    });

    test("the last of two config writes wins", async () => {
        await withHousehold(async (call) => {
            await call("update_household_config", { name: "A" });
            await call("update_household_config", { name: "B" });
            const got = await call("get_household_config");
            expect(got.structuredContent?.name).toBe("B");
        });
    });

    test("tools/list includes the two config tools", async () => {
        await withHousehold(async (_call, list) => {
            const names = await list();
            expect(names).toContain("get_household_config");
            expect(names).toContain("update_household_config");
            expect(names).not.toContain("update_fridge_locations");
        });
    });

    test("TOOLS names match the registered tool set", async () => {
        await withHousehold(async (_call, list) => {
            expect((await list()).slice().sort()).toEqual(
                TOOLS.map((tool) => tool.name)
                    .slice()
                    .sort(),
            );
        });
    });

    test("tools/list names and order match the snapshot", async () => {
        const snapshot = (await Bun.file(
            new URL("./mcp/tools-list.snapshot.json", import.meta.url),
        ).json()) as string[];
        await withHousehold(async (_call, list) => {
            expect(await list()).toEqual(snapshot);
        });
    });

    test("person-scoped catalog tools include optional user_id", () => {
        const skip = new Set<string>([
            ...HOUSEHOLD_SCOPED_TOOL_NAMES,
            ...OAUTH_ONLY_TOOL_NAMES,
        ]);
        for (const tool of TOOLS) {
            const param = tool.params.find((item) => item.name === "user_id");
            if (skip.has(tool.name)) {
                expect(param, tool.name).toBeUndefined();
            } else {
                expect(param, tool.name).toEqual({
                    name: "user_id",
                    required: false,
                });
            }
        }
    });

    test("nutrition write catalog tools include optional target_member", () => {
        for (const name of NUTRITION_WRITE_TOOL_NAMES) {
            const tool = TOOLS.find((item) => item.name === name);
            expect(
                tool?.params.find((item) => item.name === "target_member"),
                name,
            ).toEqual({
                name: "target_member",
                required: false,
            });
        }
    });
});

describe("phone-app domain MCP tools", () => {
    const alice = "11111111-1111-4111-8111-111111111111";
    const bob = "22222222-2222-4222-8222-222222222222";
    const cottage: FoodResult = {
        name: "Cottage Cheese",
        brand: "Good Culture",
        serving: "100 g",
        calories: 98,
        protein_g: 14,
        carbs_g: 3,
        fat_g: 4,
        fiber_g: 0,
        sugar_g: 3,
        alcohol_g: null,
        nutriscore_grade: "a",
        nova_group: 3,
        source: "off:070852010016",
        source_name: "openfoodfacts",
        barcode: "070852010016",
    };

    function householdMembers() {
        db.members = [
            {
                householdId: "hh-1",
                userId: alice,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
    }

    async function withPat(run: (call: CallTool) => Promise<void>) {
        householdMembers();
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            { kind: "household", householdId: "hh-1" },
            true,
            null,
        );
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "0.0.0" });
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: args,
                    }) as Promise<ToolResult>,
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    async function withUser(
        userId: string,
        run: (call: CallTool) => Promise<void>,
    ) {
        householdMembers();
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId }, true, null);
        const [clientTransport, serverTransport] =
            InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "0.0.0" });
        await Promise.all([
            server.connect(serverTransport),
            client.connect(clientTransport),
        ]);
        try {
            await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: args,
                    }) as Promise<ToolResult>,
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    test("get_fridge returns seeded locations and items", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            expect(loc.isError).toBeFalsy();
            const locationId = loc.structuredContent?.id as string;
            const added = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                barcode: cottage.barcode,
                amount: 200,
            });
            expect(added.isError).toBeFalsy();
            const listed = await call("get_fridge");
            expect(listed.isError).toBeFalsy();
            expect(textOf(listed)).toContain("Cottage Cheese");
            const locations = listed.structuredContent?.locations as Array<{
                name: string;
                items: Array<{ display_name: string; amount: number }>;
            }>;
            expect(locations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        name: "Fridge",
                        items: expect.arrayContaining([
                            expect.objectContaining({
                                display_name: "Cottage Cheese",
                                amount: 200,
                            }),
                        ]),
                    }),
                ]),
            );
        });
    });

    test("eat_fridge_item links its eat movement to the meal it logs", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const added = await call("add_fridge_item", {
                location_id: loc.structuredContent?.id as string,
                kind: "food",
                barcode: cottage.barcode,
                amount: 200,
            });
            const eaten = await call("eat_fridge_item", {
                id: added.structuredContent?.id as string,
                amount: 50,
                member_id: alice,
            });
            expect(eaten.isError).toBeFalsy();
            const mealId = eaten.structuredContent?.meal_id as string;
            expect(mealId).toBeTruthy();
            const food = (await db.foodsStore.listFoods("hh-1"))[0]!;
            const movements = await db.stockStore.listMovements(
                "hh-1",
                food.id,
            );
            const eat = movements.filter((m) => m.reason === "eat");
            expect(eat).toHaveLength(1);
            expect(eat[0]!.delta).toBe(-50);
            expect(eat[0]!.mealId).toBe(mealId);
            expect(
                ledgerMatchesStock(
                    await db.fridgeStore.listItems("hh-1"),
                    movements,
                    food,
                ),
            ).toBe(true);
        });
    });

    test("add, update, and delete fridge item write adjust movements", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const added = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                barcode: cottage.barcode,
                amount: 200,
            });
            expect(added.isError).toBeFalsy();
            const itemId = added.structuredContent?.id as string;
            const food = (await db.foodsStore.listFoods("hh-1"))[0]!;
            expect(
                ledgerMatchesStock(
                    await db.fridgeStore.listItems("hh-1"),
                    await db.stockStore.listMovements("hh-1", food.id),
                    food,
                ),
            ).toBe(true);

            const updated = await call("update_fridge_item", {
                id: itemId,
                amount: 150,
                unit: "g",
            });
            expect(updated.isError).toBeFalsy();
            expect(
                ledgerMatchesStock(
                    await db.fridgeStore.listItems("hh-1"),
                    await db.stockStore.listMovements("hh-1", food.id),
                    food,
                ),
            ).toBe(true);

            const deleted = await call("delete_fridge_item", { id: itemId });
            expect(deleted.isError).toBeFalsy();
            const movements = await db.stockStore.listMovements(
                "hh-1",
                food.id,
            );
            expect(movements.every((row) => row.reason === "adjust")).toBe(
                true,
            );
            expect(movements.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
            expect(
                ledgerMatchesStock(
                    await db.fridgeStore.listItems("hh-1"),
                    movements,
                    food,
                ),
            ).toBe(true);
        });
    });

    test("add_grocery_line with fridge identity shows already-have", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                barcode: cottage.barcode,
                amount: 200,
            });
            const line = await call("add_grocery_line", {
                store_id: store.id,
                kind: "food",
                barcode: cottage.barcode,
                amount: 400,
            });
            expect(line.isError).toBeFalsy();
            expect(textOf(line)).toContain("already have");
            expect(line.structuredContent?.already_have).toBe(
                "already have: have 200 g, need 200 g",
            );
        });
    });

    test("put_away_grocery_lines stocks the fridge and removes the line", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const line = await call("add_grocery_line", {
                store_id: store.id,
                kind: "food",
                barcode: cottage.barcode,
                amount: 300,
            });
            const lineId = (line.structuredContent as { id?: string })?.id;
            expect(lineId).toBeTruthy();
            const put = await call("put_away_grocery_lines", {
                line_ids: [lineId],
                location_id: locationId,
            });
            expect(put.isError).toBeFalsy();
            expect(textOf(put)).toContain("Put away");
            const listed = await call("get_fridge");
            expect(textOf(listed)).toContain("Cottage Cheese");
            const groceries = await call("list_grocery_lines");
            expect(textOf(groceries)).not.toContain("Cottage Cheese");
        });
    });

    test("cook_recipe deducts stock and logs one meal per member", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        await withUser(alice, async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                barcode: cottage.barcode,
                amount: 200,
            });
            const recipe = await call("create_recipe", {
                name: "Bowl",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: (await db.foodsStore.listFoods("hh-1"))[0]?.id,
                amount: 150,
                unit: "g",
            });
            const cooked = await call("cook_recipe", {
                recipe_id: recipeId,
                portions_by_member: [
                    { user_id: alice, portions: 1 },
                    { user_id: bob, portions: 1 },
                ],
            });
            expect(cooked.isError).toBeFalsy();
            expect(textOf(cooked)).toContain("Shortfall");
            expect(textOf(cooked)).toContain("Logged 2 meals");
            expect(db.inserted).toHaveLength(2);
            const leftover = await call("get_fridge");
            expect(textOf(leftover)).toContain("Fridge is empty.");
        });
    });

    test("add_recipe_to_grocery returns remainder for selected members", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withUser(alice, async (call) => {
            const recipe = await call("create_recipe", {
                name: "Bowl",
                yield_portions: 2,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                barcode: cottage.barcode,
                amount: 200,
            });
            const loc = await call("add_fridge_location", { name: "Fridge" });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                barcode: cottage.barcode,
                amount: 50,
            });
            const added = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: store.id,
                member_ids: [alice, bob],
            });
            expect(added.isError).toBeFalsy();
            const remainder = added.structuredContent?.remainder as Array<{
                display_name: string;
                skipped: boolean;
                remainder: { amount: number; unit: string } | null;
            }>;
            expect(remainder).toHaveLength(1);
            expect(remainder[0]?.display_name).toBe("Cottage Cheese");
            expect(remainder[0]?.skipped).toBe(false);
            expect(remainder[0]?.remainder).toEqual({
                amount: 150,
                unit: "g",
            });
        });
    });

    // A loaf or a casserole is bought and cooked whole, not per eater.
    test("add_recipe_to_grocery shops for total_portions without members", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withUser(alice, async (call) => {
            const recipe = await call("create_recipe", {
                name: "Loaf",
                yield_portions: 10,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                barcode: cottage.barcode,
                amount: 500,
            });
            const added = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: store.id,
                total_portions: 10,
            });
            expect(added.isError).toBeFalsy();
            expect(added.structuredContent?.total_portions).toBe(10);
            const remainder = added.structuredContent?.remainder as Array<{
                remainder: { amount: number; unit: string } | null;
            }>;
            expect(remainder[0]?.remainder).toEqual({ amount: 500, unit: "g" });

            const none = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: store.id,
            });
            expect(none.isError).toBe(true);
            expect(textOf(none)).toContain("total portions");
        });
    });

    test("cook_recipe cooks total_portions but logs only the members' portions", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        await withUser(alice, async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                barcode: cottage.barcode,
                amount: 1000,
            });
            const recipe = await call("create_recipe", {
                name: "Casserole",
                yield_portions: 4,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: (await db.foodsStore.listFoods("hh-1"))[0]?.id,
                amount: 400,
                unit: "g",
            });
            const tooFew = await call("cook_recipe", {
                recipe_id: recipeId,
                portions_by_member: [
                    { user_id: alice, portions: 1 },
                    { user_id: bob, portions: 1 },
                ],
                total_portions: 1,
            });
            expect(tooFew.isError).toBe(true);
            expect(textOf(tooFew)).toContain("can't be less");

            // Cook once, eat twice: the whole batch, two portions eaten now.
            const cooked = await call("cook_recipe", {
                recipe_id: recipeId,
                portions_by_member: [
                    { user_id: alice, portions: 1 },
                    { user_id: bob, portions: 1 },
                ],
                total_portions: 4,
            });
            expect(cooked.isError).toBeFalsy();
            expect(cooked.structuredContent?.total_portions).toBe(4);
            expect(cooked.structuredContent?.meal_ids).toHaveLength(2);
            const items = await db.fridgeStore.listItems("hh-1");
            expect(items[0]?.quantity).toEqual({ amount: 600, unit: "g" });
        });
    });

    // Open Food Facts returns 503s at times. The household catalog must still
    // answer: an agent that gets an error here loses foods it already knows.
    test("search_food still returns household foods when Open Food Facts fails", async () => {
        db.foodSearchError = new Error("Open Food Facts request failed: 503");
        await withPat(async (call) => {
            const made = await call("upsert_food", { name: "Cottage cheese" });
            expect(made.isError).toBeFalsy();
            const r = await call("search_food", { query: "cottage" });
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.foods).toEqual([
                expect.objectContaining({
                    name: "Cottage cheese",
                    source: "household",
                }),
            ]);
            expect(textOf(r)).toContain("Open Food Facts is unavailable");
            expect(textOf(r)).toContain("household foods only");
        });
    });

    test("search_food returns FoodResult shape", async () => {
        db.foodSearchHits = [cottage];
        await withPat(async (call) => {
            const r = await call("search_food", { query: "cottage" });
            expect(r.isError).toBeFalsy();
            expect(textOf(r)).toContain("Cottage Cheese");
            expect(r.structuredContent?.foods).toEqual([
                expect.objectContaining({
                    name: "Cottage Cheese",
                    source: "off:070852010016",
                    barcode: "070852010016",
                    food_id: null,
                    calories: 98,
                }),
            ]);
        });
    });

    test("set_household_rules stores free text", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withPat(async (call) => {
            const r = await call("set_household_rules", {
                store_rules: [
                    { store_id: store.id, body: "dairy is on the back wall" },
                ],
            });
            expect(r.isError).toBeFalsy();
            expect(textOf(r)).toContain("store rule");
            const listed = await call("get_household_rules");
            expect(textOf(listed)).toContain("dairy is on the back wall");
        });
    });

    test("OAuth log_meal with target_member writes the partner", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                target_member: bob,
            });
            expect(r.isError).toBeFalsy();
            expect(db.inserted[0]!.user_id).toBe(bob);
            const today = await call("get_meals", { user_id: bob });
            expect(textOf(today)).toContain("toast");
        });
    });

    test("OAuth user_id still cannot sudo a nutrition write", async () => {
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                user_id: bob,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain(OAUTH_USER_MISMATCH);
            expect(db.inserted).toHaveLength(0);
        });
    });

    test("delete_recipe as non-creator member is refused", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        let recipeId = "";
        await withUser(alice, async (call) => {
            const recipe = await call("create_recipe", {
                name: "Owner oats",
                yield_portions: 2,
            });
            recipeId = recipe.structuredContent?.id as string;
        });
        await withUser(bob, async (call) => {
            const r = await call("delete_recipe", { id: recipeId });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("creator or household owner");
        });
        await withUser(alice, async (call) => {
            const listed = await call("list_recipes");
            expect(textOf(listed)).toContain("Owner oats");
        });
    });

    test("import_recipe_from_text find-or-creates foods and reports gaps", async () => {
        await withUser(alice, async (call) => {
            const imported = await call("import_recipe_from_text", {
                text: "Oats\nSimmer.",
                name: "Overnight oats",
                source_url: "https://example.com/oats",
                yield_portions: 2,
                tags: ["breakfast"],
                ingredients: [
                    { name: "rolled oats", amount: 80, note: "dry" },
                    { name: "milk", amount: 200, unit: "ml" },
                ],
            });
            expect(imported.isError).toBeFalsy();
            expect(textOf(imported)).toContain("Overnight oats");
            expect(textOf(imported)).toContain("missing nutrition");
            const recipe = imported.structuredContent?.recipe as {
                tags: string[];
                source_url: string | null;
            };
            expect(recipe.tags).toEqual(["breakfast"]);
            expect(recipe.source_url).toBe("https://example.com/oats");
            const ingredients = imported.structuredContent
                ?.ingredients as Array<{
                display_name: string;
                note: string | null;
                missing: string[];
            }>;
            expect(ingredients[0]?.note).toBe("dry");
            expect(
                ingredients.find(
                    (row) => row.display_name.toLowerCase() === "milk",
                )?.missing,
            ).toContain("grams_per_ml");
            const listed = await call("list_recipes", { tag: "breakfast" });
            expect(textOf(listed)).toContain("Overnight oats");
        });
    });

    test("set_household_rules allergens then grocery add warns", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withPat(async (call) => {
            const allergen = await call("set_household_rules", {
                person: [{ user_id: bob, allergens: [{ allergen: "peanut" }] }],
            });
            expect(allergen.isError).toBeFalsy();
            const food = await call("upsert_food", {
                name: "peanut butter",
                allergens: ["peanut"],
            });
            expect(food.isError).toBeFalsy();
            const line = await call("add_grocery_line", {
                store_id: store.id,
                kind: "food",
                name: "peanut butter",
                amount: 100,
            });
            expect(line.isError).toBeFalsy();
            expect(line.structuredContent?.warning).toContain("peanut");
            expect(textOf(line).toLowerCase()).toContain("peanut");
        });
    });
});

describe("removed membership admin MCP tools", () => {
    test("owner OAuth cannot call rotate_household_token or add_household_member", async () => {
        await withTools(null, async (call) => {
            await expect(call("rotate_household_token")).rejects.toThrow(
                /not found/,
            );
            await expect(
                call("add_household_member", {
                    display_name: "Sam",
                    username: "sam",
                    password: "password1",
                }),
            ).rejects.toThrow(/not found/);
            expect(db.tokenRotations).toHaveLength(0);
            expect(db.addedLogins).toHaveLength(0);
        });
    });
});

// ---------- /mcp over HTTP: both protocol eras ----------
//
// Kept in this file rather than its own: mock.module is process-wide, and a
// separate file with its own mock/restore of the same db module broke
// middleware.test.ts's mock on Linux CI even with a snapshot-based restore.
// Sharing this file's single mock window is what proved green; see the
// restore note on the afterAll above for the mechanism. Formatter tests that
// do not need these stubs live in mcp.format.test.ts without a second mock.

function appFor(userId: string) {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "user", userId });
        return handleMcp(c);
    });
    return app;
}

function appForHousehold(householdId: string) {
    const app = new Hono();
    app.all("/mcp", (c) => {
        c.set("authContext", { kind: "household", householdId });
        return handleMcp(c);
    });
    return app;
}

// The SDK's mode is wider ({ pin: string }); this endpoint only ever serves the
// one modern revision, so narrow the pin rather than hand-writing a twin of the
// exported union.
type EraMode = Extract<VersionNegotiationMode, string> | { pin: "2026-07-28" };

// One factory backs both legs, so everything a tool call touches — the tool
// surface, the ui:// resources, the structuredContent, the authInfo the factory
// reads the user out of — must answer identically whichever era asked. The
// legacy leg is the one every production client (the Claude connector included)
// is on today, so a test that only ever pins the modern revision leaves the
// deployed path uncovered.
const ERAS: EraMode[] = ["legacy", { pin: "2026-07-28" }];

// Drive the real handler in-process: the URL is never dialled. Extra headers
// stand in for what a proxy in front of us would add.
async function withHttpClient<T>(
    userId: string,
    mode: EraMode,
    run: (client: Client) => Promise<T>,
    headers: Record<string, string> = {},
): Promise<T> {
    const app = appFor(userId);
    const transport = new StreamableHTTPClientTransport(
        new URL("http://test.local/mcp"),
        {
            fetch: async (url, init) => {
                const req = new Request(String(url), init);
                for (const [k, v] of Object.entries(headers))
                    req.headers.set(k, v);
                return app.request(req);
            },
        },
    );
    const client = new Client(
        { name: "t", version: "0" },
        { versionNegotiation: { mode } },
    );
    await client.connect(transport);
    try {
        return await run(client);
    } finally {
        await client.close();
    }
}

// A raw JSON-RPC POST with the headers the v2 entry is strict about.
function rpc(
    app: Hono,
    body: Record<string, unknown>,
    headers: Record<string, string> = {},
) {
    return app.request("http://x/mcp", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    });
}

// The legacy leg answers over SSE; pull the single JSON-RPC frame out.
async function sseFrame(r: Response): Promise<Record<string, unknown>> {
    const line = (await r.text())
        .split("\n")
        .find((l) => l.startsWith("data:"));
    return JSON.parse(line?.slice(5) ?? "{}") as Record<string, unknown>;
}

describe("household PAT over HTTP has no default userId", () => {
    async function withHouseholdHttp<T>(
        mode: EraMode,
        run: (client: Client) => Promise<T>,
    ): Promise<T> {
        const app = appForHousehold("hh-1");
        const transport = new StreamableHTTPClientTransport(
            new URL("http://test.local/mcp"),
            {
                fetch: async (url, init) =>
                    app.request(new Request(String(url), init)),
            },
        );
        const client = new Client(
            { name: "t", version: "0" },
            { versionNegotiation: { mode } },
        );
        await client.connect(transport);
        try {
            return await run(client);
        } finally {
            await client.close();
        }
    }

    test.each(ERAS)(
        "tools/list succeeds for a household PAT (%p)",
        async (mode) => {
            await withHouseholdHttp(mode, async (client) => {
                const { tools } = await client.listTools();
                expect(
                    tools.some((t) => t.name === "rotate_household_token"),
                ).toBe(false);
                expect(
                    tools.some((t) => t.name === "add_household_member"),
                ).toBe(false);
                expect(tools.some((t) => t.name === "list_members")).toBe(true);
                expect(tools.some((t) => t.name === "log_meal")).toBe(true);
            });
        },
    );

    test.each(ERAS)("get_profile does not invent a user (%p)", async (mode) => {
        await withHouseholdHttp(mode, async (client) => {
            const r = await client.callTool({
                name: "get_profile",
                arguments: {},
            });
            expect(r.isError).toBe(true);
            expect(
                (r.content as { type: string; text?: string }[])
                    .map((c) => c.text ?? "")
                    .join("\n")
                    .toLowerCase(),
            ).toContain("user_id");
        });
    });

    test.each(ERAS)("log_meal writes nothing (%p)", async (mode) => {
        await withHouseholdHttp(mode, async (client) => {
            const r = await client.callTool({
                name: "log_meal",
                arguments: {
                    description: "toast",
                    meal_type: "breakfast",
                    calories: 100,
                    protein_g: 4,
                    carbs_g: 18,
                    fat_g: 1,
                },
            });
            expect(r.isError).toBe(true);
            expect(db.inserted).toHaveLength(0);
        });
    });
});

describe("/mcp serves the 2026-07-28 revision", () => {
    test("a negotiating client lands on the modern era", async () => {
        await withHttpClient("u1", "auto", async (client) => {
            expect(client.getProtocolEra()).toBe("modern");
            expect(client.getServerVersion()?.name).toBe("Foodable");
        });
    });

    test("a pinned 2026-07-28 client connects without fallback", async () => {
        await withHttpClient("u1", { pin: "2026-07-28" }, async (client) => {
            expect(client.getProtocolEra()).toBe("modern");
        });
    });

    test("the server is built per request for the authenticated user", async () => {
        // Two users, then the first again: a per-user cache would read each
        // profile once, so the third read is what proves per-request.
        for (const user of ["user-a", "user-b", "user-a"]) {
            await withHttpClient(user, { pin: "2026-07-28" }, (client) =>
                client.listTools(),
            );
        }
        // One read per user per connection, from the tools/list alone:
        // connect()'s server/discover probe is answered from the bare server,
        // which never touches the profile.
        expect(db.profileReads).toEqual(["user-a", "user-b", "user-a"]);
    });

    // server/discover is the first request every negotiating client sends and
    // its response — supportedVersions, capabilities, instructions — contains
    // nothing a tool registration produces. Paying a Supabase round-trip for it
    // made the probe the request that failed first under rate pressure.
    test("server/discover costs no profile read and still answers in full", async () => {
        const r = await rpc(
            appFor("u1"),
            {
                id: 3,
                method: "server/discover",
                params: {
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            },
            {
                "mcp-protocol-version": "2026-07-28",
                "mcp-method": "server/discover",
            },
        );
        expect(r.status).toBe(200);
        expect(db.profileReads).toEqual([]);
        const body = (await r.json()) as {
            result?: {
                supportedVersions?: string[];
                capabilities?: Record<string, unknown>;
                instructions?: string;
            };
        };
        expect(body.result?.supportedVersions).toContain("2026-07-28");

        // ...and advertises exactly what the fully-registered server does. Both
        // paths build from one literal; this is the assertion that would catch
        // them drifting apart.
        const init = await sseFrame(
            await rpc(appFor("u1"), {
                id: 4,
                method: "initialize",
                params: {
                    protocolVersion: "2025-11-25",
                    capabilities: {},
                    clientInfo: { name: "c", version: "0" },
                },
            }),
        );
        const full = init.result as {
            capabilities: Record<string, unknown>;
            instructions: string;
        };
        expect(body.result?.capabilities).toEqual(full.capabilities);
        expect(body.result?.instructions).toBe(full.instructions);
        expect(full.instructions.length).toBeGreaterThan(0);
    });
});

// The product surface, driven end to end over BOTH legs. Everything in here is
// era-agnostic by construction (one server factory), so a difference between
// the two columns is a bug in the handler, not in the tools.
describe("/mcp serves one tool surface on both protocol eras", () => {
    test.each(ERAS)(
        "list_changed is not advertised (%p) — nothing could deliver it",
        async (mode) => {
            await withHttpClient("u1", mode, async (client) => {
                const caps = client.getServerCapabilities();
                expect(caps?.tools).toEqual({ listChanged: false });
                expect(caps?.resources).toEqual({ listChanged: false });
            });
        },
    );

    test.each(ERAS)(
        "tools/list carries the MCP Apps links and output schemas (%p)",
        async (mode) => {
            await withHttpClient("u1", mode, async (client) => {
                const { tools } = await client.listTools();
                expect(tools.length).toBeGreaterThan(30);
                const logMeal = tools.find((t) => t.name === "log_meal");
                expect(logMeal?._meta?.ui).toEqual({
                    resourceUri: "ui://widget/meal-logged.html",
                });
                expect(logMeal?.outputSchema?.type).toBe("object");
            });
        },
    );

    test.each(ERAS)("tools/call returns text content (%p)", async (mode) => {
        await withHttpClient("u1", mode, async (client) => {
            const r = await client.callTool({
                name: "get_profile",
                arguments: {},
            });
            expect(r.isError).toBeFalsy();
            expect((r.content as { type: string }[])[0]?.type).toBe("text");
        });
    });

    // structuredContent is what every widget paints from, and start_meal_import
    // is the tool where an empty one leaves the iframe stuck on its loading
    // state. Parsing the exported schema (rather than eyeballing a field) is
    // what proves the payload the wire carried still satisfies what the tool
    // declares — including the nullable fields that must be present-and-null.
    test.each(ERAS)(
        "structuredContent satisfies the declared outputSchema (%p)",
        async (mode) => {
            // Not UTC: that is both PROFILE_BASE's zone and the null-profile
            // fallback, so only a distinct zone proves the profile was read
            // for THIS user on this leg.
            db.profile = { ...PROFILE_BASE, timezone: "Europe/Kyiv" };
            await withHttpClient("u1", mode, async (client) => {
                const r = await client.callTool({
                    name: "start_meal_import",
                    arguments: {},
                });
                expect(r.isError).toBeFalsy();
                const sc = START_IMPORT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(sc.tz).toBe("Europe/Kyiv");
                expect(sc.tz_configured).toBe(true);
                expect(sc.import_tool_name).toBe("bulk_import_meals");
                expect(sc.user_id).toBe("u1");
            });
        },
    );

    // A widget is only usable if the resource read hands back the assembled,
    // fully-inlined document under the mcp-app mime type: the iframe CSP is
    // deny-all, so anything left un-inlined simply never loads.
    test.each(ERAS)(
        "ui:// widgets read as the assembled mcp-app document (%p)",
        async (mode) => {
            const assembled = await getWidgetHtml("meal-logged");
            await withHttpClient("u1", mode, async (client) => {
                const res = await client.readResource({
                    uri: "ui://widget/meal-logged.html",
                });
                const c = res.contents[0] as {
                    mimeType?: string;
                    text?: string;
                };
                expect(c.mimeType).toBe("text/html;profile=mcp-app");
                expect(c.text).toBe(assembled);
                // Spot-check the served bytes directly too, so a resource that
                // starts serving a template instead of the assembly fails here
                // and not only in widgets.test.ts.
                expect(c.text?.trimStart().startsWith("<!doctype html>")).toBe(
                    true,
                );
                expect(c.text).toContain("function initWidget(config)");
                expect(c.text).not.toMatch(/\/\*@include/);
                expect(c.text).not.toMatch(/<script[^>]+src=/);
            });
        },
    );

    test.each(ERAS)(
        "input validation errors are in-band, not transport failures (%p)",
        async (mode) => {
            await withHttpClient("u1", mode, async (client) => {
                const r = await client.callTool({
                    name: "log_meal",
                    arguments: { description: "x", meal_type: "brunch" },
                });
                expect(r.isError).toBe(true);
            });
        },
    );

    // The tool that writes: a legacy tools/call has to reach insertMeal with
    // the user the bearer middleware authenticated, not with whoever the
    // previous request was for.
    test.each(ERAS)(
        "a write reaches the DB for the authenticated user (%p)",
        async (mode) => {
            await withHttpClient("mode-user", mode, async (client) => {
                const r = await client.callTool({
                    name: "log_meal",
                    arguments: {
                        description: "eggs",
                        meal_type: "breakfast",
                        calories: 200,
                    },
                });
                expect(r.isError).toBeFalsy();
            });
            expect(db.inserted).toHaveLength(1);
            expect(db.inserted[0]?.description).toBe("eggs");
            expect(new Set(db.profileReads)).toEqual(new Set(["mode-user"]));
        },
    );
});

describe("/mcp still serves 2025-era clients unchanged", () => {
    test("a legacy client completes initialize and lists tools", async () => {
        await withHttpClient("u1", "legacy", async (client) => {
            expect(client.getProtocolEra()).toBe("legacy");
            expect(client.getServerVersion()?.name).toBe("Foodable");
            expect(client.getServerCapabilities()?.tools).toBeDefined();
            const { tools } = await client.listTools();
            expect(tools.find((t) => t.name === "log_meal")?._meta?.ui).toEqual(
                { resourceUri: "ui://widget/meal-logged.html" },
            );
        });
    });

    // The legacy leg keeps nothing between requests either: a fresh transport
    // and a fresh server per POST is what makes a deploy invisible to the
    // connector clients that are all on this leg today.
    test("every legacy request builds its own server", async () => {
        await withHttpClient("legacy-user", "legacy", async (client) => {
            const before = db.profileReads.length;
            await client.listTools();
            await client.listTools();
            expect(db.profileReads.length).toBe(before + 2);
        });
        expect(new Set(db.profileReads)).toEqual(new Set(["legacy-user"]));
    });

    // The factory serves the tool-less bare server for the two identity-only
    // methods, gated on `ctx.era === "modern"` because the legacy fallback
    // ignores Mcp-Method entirely. Without that gate a legacy client whose
    // proxy (or whose own header bug) sent a stray Mcp-Method would have been
    // answered by a server with no tools registered at all.
    test("a stray Mcp-Method header cannot strip the tools off a legacy request", async () => {
        await withHttpClient(
            "u1",
            "legacy",
            async (client) => {
                expect(client.getProtocolEra()).toBe("legacy");
                const { tools } = await client.listTools();
                expect(tools.length).toBeGreaterThan(30);
                // The bare server reads no profile, so a profile read is the
                // direct witness that the full-server branch was taken —
                // dropping the era guard makes this the first assertion to go.
                expect(db.profileReads.length).toBeGreaterThan(0);
            },
            { "mcp-method": "server/discover" },
        );
    });

    test("legacy initialize answers in-band and issues no session id", async () => {
        const r = await rpc(appFor("u1"), {
            id: 1,
            method: "initialize",
            params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "c", version: "0" },
            },
        });
        expect(r.status).toBe(200);
        expect(r.headers.get("mcp-session-id")).toBeNull();
        const frame = await sseFrame(r);
        expect(frame.error).toBeUndefined();
        expect(
            (frame.result as { protocolVersion: string }).protocolVersion,
        ).toBe("2025-11-25");
    });
});

describe("/mcp transport posture", () => {
    test.each(["GET", "DELETE"])(
        "%s is refused with 405 and no SSE stream",
        async (method) => {
            const r = await appFor("u1").request("http://x/mcp", { method });
            expect(r.status).toBe(405);
            expect(r.headers.get("allow")).toBe("POST");
        },
    );

    test("subscriptions/listen is refused without opening a stream", async () => {
        const r = await rpc(
            appFor("u1"),
            {
                id: 7,
                method: "subscriptions/listen",
                params: {
                    notifications: { tools: true },
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            },
            {
                "mcp-protocol-version": "2026-07-28",
                "mcp-method": "subscriptions/listen",
            },
        );
        expect(r.headers.get("content-type")).not.toContain(
            "text/event-stream",
        );
        const body = (await r.json()) as {
            id?: unknown;
            error?: { code: number };
        };
        expect(body.id).toBe(7);
        // -32603 "Subscription limit reached" is the SDK's own maxSubscriptions
        // refusal, and it is now the only one: a hand-rolled -32601 pre-check
        // used to answer first off the Mcp-Method header alone, so the endpoint
        // reported two different codes for one condition.
        expect(body.error?.code).toBe(-32603);
    });

    // What the pre-check got wrong. A client that puts the listen method in the
    // header but calls a tool in the body has a header bug, and the SDK says so
    // (-32020, HTTP 400). The pre-check answered 200 "Method not found" echoing
    // the tools/call id, which reads as "this tool does not exist".
    test("a Mcp-Method that disagrees with the body is a header error, not a missing method", async () => {
        const r = await rpc(
            appFor("u1"),
            {
                id: 8,
                method: "tools/call",
                params: {
                    name: "get_profile",
                    arguments: {},
                    _meta: {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            },
            {
                "mcp-protocol-version": "2026-07-28",
                "mcp-method": "subscriptions/listen",
                "mcp-name": "get_profile",
            },
        );
        expect(r.status).toBe(400);
        const body = (await r.json()) as {
            error?: { code: number; message: string };
        };
        expect(body.error?.code).toBe(-32020);
        expect(body.error?.message).toContain("headers and body disagree");
    });

    // The SDK's 415 gate runs before the body is read; the pre-check sat in
    // front of it and answered 200 to a POST that never had a valid body.
    test("a non-JSON Content-Type is refused 415 before anything is parsed", async () => {
        const r = await appFor("u1").request("http://x/mcp", {
            method: "POST",
            headers: {
                "content-type": "text/plain",
                "mcp-method": "subscriptions/listen",
            },
            body: "not json",
        });
        expect(r.status).toBe(415);
    });

    test("the icon URL follows the forwarding headers", async () => {
        await withHttpClient(
            "u1",
            { pin: "2026-07-28" },
            async (client) => {
                expect(client.getServerVersion()?.icons?.[0]?.src).toBe(
                    "https://foodable.test/favicon.ico",
                );
            },
            {
                "x-forwarded-proto": "https",
                "x-forwarded-host": "foodable.test",
            },
        );
    });

    // With no forwarding headers the icon falls back to the request's own
    // origin — the same fallback getBaseUrl gives the OAuth metadata URLs. It
    // used to be a hardcoded "http://localhost", so one request could advertise
    // an icon on one host and its resource metadata on another.
    test("with no forwarding headers the icon URL is the request origin", async () => {
        await withHttpClient("u1", { pin: "2026-07-28" }, async (client) => {
            expect(client.getServerVersion()?.icons?.[0]?.src).toBe(
                "http://test.local/favicon.ico",
            );
        });
    });
});

// The access log in src/index.ts prints `era=…` from what handleMcp publishes on
// the Hono context. It is the instrument for retiring the 2025-11-25 leg: when
// nothing has logged era=legacy for a sustained window, flipping the SDK's
// `legacy: "reject"` is safe. A guess derived from request headers would not be
// trustworthy enough to make that call, so this asserts the value comes from the
// era the SDK actually negotiated.
describe("/mcp records the negotiated era for the access log", () => {
    // Same wiring as appFor, plus the read the access log performs after the
    // route resolves.
    function recordingApp(userId: string, seen: (entry: string) => void) {
        const app = new Hono();
        app.all("/mcp", async (c) => {
            c.set("authContext", { kind: "user", userId });
            const res = await handleMcp(c);
            seen(
                `${c.req.method}:${c.get("mcpEra") ?? "-"}:${c.get("mcpClient") ?? "-"}`,
            );
            return res;
        });
        return app;
    }

    // Each entry is "METHOD:era" so the assertions can distinguish a request
    // the SDK served from one this endpoint refused before the SDK saw it.
    async function traceFor(
        mode: EraMode,
        identity: { name: string; version: string } = {
            name: "t",
            version: "0",
        },
    ): Promise<string[]> {
        const seen: string[] = [];
        const app = recordingApp("era-user", (era) => seen.push(era));
        const transport = new StreamableHTTPClientTransport(
            new URL("http://test.local/mcp"),
            { fetch: async (url, init) => app.request(String(url), init) },
        );
        const client = new Client(identity, {
            versionNegotiation: { mode },
        });
        await client.connect(transport);
        try {
            await client.listTools();
        } finally {
            await client.close();
        }
        return seen;
    }

    test("every served 2025-era request is recorded as legacy", async () => {
        const seen = await traceFor("legacy");
        const eras = seen
            .filter((s) => s.startsWith("POST:"))
            .map((s) => s.split(":")[1]);
        // initialize, notifications/initialized (the 202) and tools/list. The
        // 202 matters most: it is the marker that identifies a legacy client in
        // the log, so it must carry the era like any other request.
        expect(eras.length).toBeGreaterThanOrEqual(3);
        expect(new Set(eras)).toEqual(new Set(["legacy"]));
    });

    test("every served 2026-era request is recorded as modern", async () => {
        const seen = await traceFor({ pin: "2026-07-28" });
        const eras = seen
            .filter((s) => s.startsWith("POST:"))
            .map((s) => s.split(":")[1]);
        expect(eras.length).toBeGreaterThan(0);
        expect(new Set(eras)).toEqual(new Set(["modern"]));
    });

    test("the refused GET stream carries no era, not a guessed one", async () => {
        // A 2025-era client opens the standalone SSE stream with GET, which
        // handleMcp answers 405 before the SDK runs — so nothing negotiates an
        // era and the access log must omit the field.
        const seen = await traceFor("legacy");
        const gets = seen
            .filter((s) => s.startsWith("GET:"))
            .map((s) => s.split(":")[1]);
        expect(gets.length).toBeGreaterThan(0);
        expect(new Set(gets)).toEqual(new Set(["-"]));
    });

    test("a 2026-era client is named on every request, from the envelope", async () => {
        const seen = await traceFor(
            { pin: "2026-07-28" },
            {
                name: "acme-client",
                version: "9.9.9",
            },
        );
        const clients = seen
            .filter((s) => s.startsWith("POST:"))
            .map((s) => s.split(":")[2]);
        expect(clients.length).toBeGreaterThan(0);
        // The modern envelope carries clientInfo on every request, so unlike the
        // legacy leg there is no request that knows the era but not the client.
        expect(new Set(clients)).toEqual(new Set(["acme-client/9.9.9"]));
    });

    test("a 2025-era client is named on initialize, the only request that carries it", async () => {
        const seen = await traceFor("legacy", {
            name: "acme-client",
            version: "9.9.9",
        });
        const clients = seen
            .filter((s) => s.startsWith("POST:"))
            .map((s) => s.split(":")[2]);
        // Documents a real limitation rather than papering over it: on the
        // stateless legacy leg every request builds a fresh server and only
        // `initialize` carries clientInfo, so the rest log no client. One named
        // request per connection is still enough to answer who is on this leg.
        expect(clients).toContain("acme-client/9.9.9");
        expect(clients).toContain("-");
    });

    test("a client name cannot forge a log line", async () => {
        // Same injection surface as the SDK error messages: this value is
        // client-supplied and goes straight into the access line.
        const seen = await traceFor(
            { pin: "2026-07-28" },
            {
                name: "evil\n[req] POST /mcp 200 1ms ip=9.9.9.9",
                version: "1.0",
            },
        );
        const clients = seen
            .filter((s) => s.startsWith("POST:"))
            .map((s) => s.split(":")[2]);
        for (const c of clients) {
            expect(c).not.toContain("\n");
            expect(c).not.toContain(" ");
        }
        expect(clients[0]).toBe("evil_[req]_POST_/mcp_200_1ms_ip=9.9.9.9/1.0");
    });

    test("an over-long client name cannot push the real fields off the line", async () => {
        const seen = await traceFor(
            { pin: "2026-07-28" },
            {
                name: "x".repeat(500),
                version: "y".repeat(500),
            },
        );
        const client = seen
            .filter((s) => s.startsWith("POST:"))
            .map((s) => s.split(":")[2])[0];
        expect(client).toBe(`${"x".repeat(40)}/${"y".repeat(40)}`);
    });

    test.each(ERAS)(
        "tool_analytics rows keep duration and outcome without era columns (%p)",
        async (mode) => {
            db.analyticsRows = [];
            await withHttpClient("u1", mode, (client) =>
                client.callTool({ name: "get_current_time", arguments: {} }),
            );
            const rows = db.analyticsRows.filter(
                (r) => r.tool_name === "get_current_time",
            );
            expect(rows.length).toBe(1);
            expect(rows[0]?.success).toBe(true);
            expect(typeof rows[0]?.duration_ms).toBe("number");
            expect(rows[0]?.protocol_era).toBeUndefined();
            expect(rows[0]?.client_name).toBeUndefined();
        },
    );

    test("a request refused before the factory carries no era", async () => {
        // 415: the SDK rejects on Content-Type before reading the body, so no
        // server is built and nothing stamps the trace. Inventing an era here
        // would corrupt the very count the legacy retirement decision rests on.
        const seen: string[] = [];
        const app = recordingApp("era-user", (era) => seen.push(era));
        const r = await app.request("http://test.local/mcp", {
            method: "POST",
            headers: { "content-type": "text/plain" },
            body: "not json",
        });
        expect(r.status).toBe(415);
        expect(seen).toEqual(["POST:-:-"]);
    });
});

process.env.OAUTH_CLIENT_ID ||= "test-client-id";
process.env.OAUTH_CLIENT_SECRET ||= "test-client-secret";

const { app: siteApp } = await import("./index.js");
const { mintSiteSession, SITE_COOKIE } = await import("./site-session.js");

describe("authenticated dashboard HTTP", () => {
    const alice = "11111111-1111-4111-8111-111111111111";
    const bob = "22222222-2222-4222-8222-222222222222";
    const outsider = "33333333-3333-4333-8333-333333333333";

    function cookieFor(userId: string): string {
        return `${SITE_COOKIE}=${mintSiteSession(userId)}`;
    }

    beforeEach(() => {
        db.members = [
            {
                householdId: "hh-1",
                userId: alice,
                role: "owner",
                displayName: "Alice",
            },
            {
                householdId: "hh-1",
                userId: bob,
                role: "member",
                displayName: "Bob",
            },
        ];
        db.profile = { ...PROFILE_BASE, user_id: alice };
        db.household = {
            name: "Home",
            fridgeLocations: ["fridge"],
            recipeSearchPlaces: [],
            preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
        };
    });

    test("a site cookie renders the viewer's dashboard widgets", async () => {
        const r = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Alice</h1>");
        expect(html).toContain("widget-frame");
        expect(html).toContain("window.__WIDGET_DATA__=");
        expect(html).toContain('title="nutrition-summary"');
        expect(html).not.toContain("You can look, not edit");
        expect(html).not.toContain('action="/approve"');
        expect(html).not.toContain('action="/add-household-member"');
        expect(html).toContain('action="/log-meal"');
        expect(html).not.toContain('name="log_meal"');
        expect(html).not.toContain('class="facts"');
        expect(html).toContain('class="bottom-nav"');
        expect(html).toContain('href="/fridge"');
        expect(html).toContain('href="/app.css"');
        expect(html).toContain('src="/app.js"');
    });

    test("a member dashboard has no add form", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(bob) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Bob</h1>");
        expect(html).not.toContain('action="/add-household-member"');
    });

    test("owner peer view has no add form", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request(`http://x/?member=${bob}`, {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("Viewing Bob");
        expect(html).not.toContain('action="/add-household-member"');
    });

    test("POST /settings/household as owner adds a username member", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=password1&username=kid",
        });
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/settings/household");
        expect(db.members).toContainEqual({
            householdId: "hh-1",
            userId: "55555555-5555-4555-8555-555555555555",
            role: "member",
            displayName: "Kid",
        });
        const home = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(await home.text()).toContain("Kid");
    });

    test("POST /settings/household as a member is 403 and adds nobody", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(bob),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=password1&username=kid",
        });
        expect(r.status).toBe(403);
        expect(db.members.map((m) => m.displayName)).toEqual(["Alice", "Bob"]);
        expect(db.addedLogins).toEqual([]);
    });

    test("POST /settings/household/rotate-token as owner issues a token once", async () => {
        const r = await siteApp.request(
            "http://x/settings/household/rotate-token",
            {
                method: "POST",
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("Household bot token (shown once):");
        expect(html).toContain(HOUSEHOLD_TOKEN_PREFIX);
        expect(db.tokenRotations).toHaveLength(1);
        expect(db.tokenRotations[0]!.householdId).toBe("hh-1");
        expect(db.tokenRotations[0]!.issuedBy).toBe(alice);
        expect(db.tokenRotations[0]!.tokenHashHex).toHaveLength(64);
    });

    function postForm(path: string, userId: string, body = "") {
        return siteApp.request(`http://x${path}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(userId),
                "content-type": "application/x-www-form-urlencoded",
            },
            body,
        });
    }

    test("the owner can make another member the owner", async () => {
        const r = await postForm(
            `/settings/household/members/${bob}/make-owner`,
            alice,
        );
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/settings/household");
        expect(db.ownershipTransfers).toEqual([{ from: alice, to: bob }]);
        expect(
            db.members.map((m) => `${m.displayName}:${m.role}`).sort(),
        ).toEqual(["Alice:member", "Bob:owner"]);
    });

    test("a member cannot take or hand out ownership", async () => {
        const r = await postForm(
            `/settings/household/members/${bob}/make-owner`,
            bob,
        );
        expect(r.status).toBe(403);
        expect(db.ownershipTransfers).toEqual([]);
    });

    test("ownership cannot go to someone outside the household", async () => {
        const r = await postForm(
            `/settings/household/members/${outsider}/make-owner`,
            alice,
        );
        expect(r.status).toBe(400);
        expect(await r.text()).toContain(
            "That person is not in this household.",
        );
        expect(db.ownershipTransfers).toEqual([]);
    });

    test("the owner removes a member after confirming", async () => {
        const r = await postForm(
            `/settings/household/members/${bob}/remove`,
            alice,
            "confirm=yes",
        );
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/settings/household");
        expect(db.wipedUsers).toEqual([bob]);
        expect(db.members.map((m) => m.displayName)).toEqual(["Alice"]);
    });

    test("removing a member without the confirm box erases nothing", async () => {
        const r = await postForm(
            `/settings/household/members/${bob}/remove`,
            alice,
        );
        expect(r.status).toBe(400);
        expect(await r.text()).toContain(
            "Tick the box to confirm removing Bob.",
        );
        expect(db.wipedUsers).toEqual([]);
    });

    test("the owner cannot remove themselves", async () => {
        const r = await postForm(
            `/settings/household/members/${alice}/remove`,
            alice,
            "confirm=yes",
        );
        expect(r.status).toBe(400);
        expect(await r.text()).toContain("You can't remove yourself.");
        expect(db.wipedUsers).toEqual([]);
    });

    test("a member cannot remove anyone", async () => {
        const r = await postForm(
            `/settings/household/members/${alice}/remove`,
            bob,
            "confirm=yes",
        );
        expect(r.status).toBe(403);
        expect(db.wipedUsers).toEqual([]);
    });

    test("removing someone outside the household erases nothing", async () => {
        const r = await postForm(
            `/settings/household/members/${outsider}/remove`,
            alice,
            "confirm=yes",
        );
        expect(r.status).toBe(400);
        expect(db.wipedUsers).toEqual([]);
    });

    test("POST /settings/household/rotate-token as a member is 403", async () => {
        const r = await siteApp.request(
            "http://x/settings/household/rotate-token",
            {
                method: "POST",
                headers: { cookie: cookieFor(bob) },
            },
        );
        expect(r.status).toBe(403);
        expect(db.tokenRotations).toHaveLength(0);
    });

    test("POST /settings/household with a short password stays on the page", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=short&username=kid",
        });
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("Password must be at least 8 characters.");
        expect(html).toContain('action="/settings/household"');
        expect(db.addedLogins).toEqual([]);
        expect(db.members.map((m) => m.displayName)).toEqual(["Alice", "Bob"]);
    });

    test("POST /settings/household logged out does not add a member", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=password1&username=kid",
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('action="/approve"');
        expect(html).not.toContain('action="/settings/household"');
        expect(db.addedLogins).toEqual([]);
        expect(db.members.map((m) => m.displayName)).toEqual(["Alice", "Bob"]);
    });

    test("POST /settings/household duplicate username stays on the page", async () => {
        await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=password1&username=kid",
        });
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid2&password=password1&username=kid",
        });
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("That login is already in use.");
        expect(html).toContain('action="/settings/household"');
        expect(
            db.members.filter((m) => m.displayName.startsWith("Kid")),
        ).toHaveLength(1);
    });

    test("GET /fridge returns the inventory page with Fridge active", async () => {
        const r = await siteApp.request("http://x/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Fridge</h1>");
        expect(html).toContain("Add a location, then add an item.");
        expect(html).toContain('action="/fridge/locations"');
        expect(html).not.toContain("Coming soon.");
        expect(html).toContain('href="/fridge" aria-current="page"');
        expect(html).not.toContain('class="facts"');
    });

    test("POST /fridge/locations adds Pantry for any member", async () => {
        const r = await siteApp.request("http://x/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(bob),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Pantry",
        });
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/fridge");
        const page = await siteApp.request("http://x/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Pantry");
        expect(html).toContain('class="food-picker"');
        expect(html).toContain('class="quantity-field"');
        expect(html).toContain("Add an item to Pantry.");
    });

    test("POST /fridge/items adds a supply with the entered unit", async () => {
        await siteApp.request("http://x/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Pantry",
        });
        const listed = await db.fridgeStore.listLocations("hh-1");
        const locationId = listed[0]!.id;
        const add = await siteApp.request("http://x/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=supply&location_id=${locationId}&name=Foil&qty_amount=2&qty_unit=roll`,
        });
        expect(add.status).toBe(302);
        const page = await siteApp.request("http://x/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Foil");
        expect(html).toContain("2 roll");
        const foil = (await db.foodsStore.listFoods("hh-1"))[0]!;
        expect(
            ledgerMatchesStock(
                await db.fridgeStore.listItems("hh-1"),
                await db.stockStore.listMovements("hh-1", foil.id),
                foil,
            ),
        ).toBe(true);
        expect(
            (await db.stockStore.listMovements("hh-1", foil.id)).every(
                (row) => row.reason === "adjust",
            ),
        ).toBe(true);
    });

    test("POST /fridge/items adds barcode food in grams", async () => {
        db.barcodeFoods["070852010016"] = {
            name: "Good Culture Cottage Cheese",
            brand: "Good Culture",
            serving: "100 g",
            calories: 98,
            protein_g: 11,
            carbs_g: 3.4,
            fat_g: 4.3,
            fiber_g: 0,
            sugar_g: 3.2,
            alcohol_g: null,
            nutriscore_grade: null,
            nova_group: null,
            source: "off:070852010016",
            source_name: "openfoodfacts",
            barcode: "070852010016",
        };
        await siteApp.request("http://x/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Fridge",
        });
        const locationId = (await db.fridgeStore.listLocations("hh-1"))[0]!.id;
        const add = await siteApp.request("http://x/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=food&location_id=${locationId}&barcode=070852010016&qty_amount=1360.8&qty_unit=g`,
        });
        expect(add.status).toBe(302);
        const page = await siteApp.request("http://x/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Good Culture Cottage Cheese");
        expect(html).toContain("1360.8 g");
    });

    test("POST /fridge/items/:id updates quantity and move, then delete removes it", async () => {
        await siteApp.request("http://x/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Fridge",
        });
        await siteApp.request("http://x/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Pantry",
        });
        const locations = await db.fridgeStore.listLocations("hh-1");
        const fridge = locations.find((l) => l.name === "Fridge")!;
        const pantry = locations.find((l) => l.name === "Pantry")!;
        await siteApp.request("http://x/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=supply&location_id=${fridge.id}&name=Foil&qty_amount=2&qty_unit=roll`,
        });
        const item = (await db.fridgeStore.listItems("hh-1"))[0]!;
        const save = await siteApp.request(`http://x/fridge/items/${item.id}`, {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `qty_amount=1&qty_unit=roll&location_id=${pantry.id}`,
        });
        expect(save.status).toBe(302);
        const moved = (await db.fridgeStore.listItems("hh-1"))[0]!;
        expect(moved.quantity.amount).toBe(1);
        expect(moved.locationId).toBe(pantry.id);
        const foil = (await db.foodsStore.listFoods("hh-1"))[0]!;
        expect(
            ledgerMatchesStock(
                await db.fridgeStore.listItems("hh-1"),
                await db.stockStore.listMovements("hh-1", foil.id),
                foil,
            ),
        ).toBe(true);
        const del = await siteApp.request(
            `http://x/fridge/items/${item.id}/delete`,
            {
                method: "POST",
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(del.status).toBe(302);
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        const movements = await db.stockStore.listMovements("hh-1", foil.id);
        expect(movements.every((row) => row.reason === "adjust")).toBe(true);
        expect(movements.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
        expect(
            ledgerMatchesStock(
                await db.fridgeStore.listItems("hh-1"),
                movements,
                foil,
            ),
        ).toBe(true);
    });

    test("GET /fridge is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/fridge", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<h1>Fridge</h1>");
    });

    test("GET /grocery lists by store and GET /recipes is the cookbook", async () => {
        const grocery = await siteApp.request("http://x/grocery", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(grocery.status).toBe(200);
        const groceryHtml = await grocery.text();
        expect(groceryHtml).toContain("<h1>Groceries</h1>");
        expect(groceryHtml).toContain('href="/grocery" aria-current="page"');
        expect(groceryHtml).not.toContain("Coming soon.");
        expect(groceryHtml).toContain("Add a grocery store");
        expect(groceryHtml).toContain('class="grocery-add-store"');
        expect(groceryHtml).toContain('action="/grocery/stores"');
        expect(groceryHtml).not.toContain("<h3>Add supply</h3>");

        const recipes = await siteApp.request("http://x/recipes", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(recipes.status).toBe(200);
        const recipesHtml = await recipes.text();
        expect(recipesHtml).toContain("<h1>Recipes</h1>");
        expect(recipesHtml).toContain('href="/recipes" aria-current="page"');
        expect(recipesHtml).not.toContain("Coming soon.");
        expect(recipesHtml).toContain('action="/recipes"');
        expect(recipesHtml).toContain("Add a recipe.");
    });

    test("POST /recipes creates, member delete is refused, owner deletes member recipe", async () => {
        const create = await siteApp.request("http://x/recipes", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Mac&yield_portions=4",
        });
        expect(create.status).toBe(302);
        const loc = create.headers.get("location") ?? "";
        expect(loc.startsWith("/recipes/")).toBe(true);
        const recipeId = loc.slice("/recipes/".length);
        const addIng = await siteApp.request(
            `http://x/recipes/${recipeId}/ingredients`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "food_name=Pasta&qty_amount=400",
            },
        );
        expect(addIng.status).toBe(302);
        const detail = await siteApp.request(`http://x/recipes/${recipeId}`, {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await detail.text();
        expect(html).toContain("Pasta");
        expect(html).toContain("100 g");
        expect(html).toContain("Macros incomplete");

        const refuse = await siteApp.request(
            `http://x/recipes/${recipeId}/delete`,
            {
                method: "POST",
                headers: { cookie: cookieFor(bob) },
            },
        );
        expect(refuse.status).toBe(403);
        expect(await refuse.text()).toContain(
            "Only the creator or household owner",
        );
        expect(await db.recipesStore.listRecipes("hh-1")).toHaveLength(1);

        const bobCreate = await siteApp.request("http://x/recipes", {
            method: "POST",
            headers: {
                cookie: cookieFor(bob),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Salad&yield_portions=1",
        });
        const bobId = (bobCreate.headers.get("location") ?? "").slice(
            "/recipes/".length,
        );
        const ownerDel = await siteApp.request(
            `http://x/recipes/${bobId}/delete`,
            {
                method: "POST",
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(ownerDel.status).toBe(302);
        const left = await db.recipesStore.listRecipes("hh-1");
        expect(left.map((row) => row.id)).toEqual([recipeId]);
    });

    test("GET /recipes is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/recipes", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<h1>Recipes</h1>");
    });

    test("POST /grocery/lines adds a supply and checking it does not insert fridge stock", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        const sections = await db.settingsStore.listSections(store.id);
        const other = sections.find((row) => row.isOther)!;
        const add = await siteApp.request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=supply&store_id=${store.id}&section_id=${other.id}&name=Foil&qty_amount=1&qty_unit=roll`,
        });
        expect(add.status).toBe(302);
        const lines = await db.groceryStore.listLines("hh-1");
        expect(lines).toHaveLength(1);
        expect(lines[0]?.displayName).toBe("Foil");
        const check = await siteApp.request(
            `http://x/grocery/lines/${lines[0]!.id}/check`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "checked=1",
            },
        );
        expect(check.status).toBe(302);
        expect((await db.groceryStore.listLines("hh-1"))[0]?.checked).toBe(
            true,
        );
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        const page = await siteApp.request("http://x/grocery", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Safeway");
        expect(html).toContain("Foil");
        expect(html).toContain('data-checked="true"');
        expect(html).toContain('commandfor="grocery-clear-checked"');
        expect(html).toContain("Add food</button>");
        expect(html).not.toContain("<h3>Add supply</h3>");
        expect(html).not.toContain("grocery-add-supply");
        const clear = await siteApp.request("http://x/grocery/clear-checked", {
            method: "POST",
            headers: { cookie: cookieFor(alice) },
        });
        expect(clear.status).toBe(302);
        expect(await db.groceryStore.listLines("hh-1")).toEqual([]);
    });

    test("POST /grocery/lines warns on peanut for an affected member", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await addAllergen(db.rulesStore, {
            householdId: "hh-1",
            userId: bob,
            allergen: "peanut",
        });
        const add = await siteApp.request("http://x/grocery/lines", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=food&store_id=${store.id}&food_name=Peanut%20Butter&qty_amount=100`,
        });
        expect(add.status).toBe(400);
        const html = await add.text();
        expect(html).toContain("allergen-warning");
        expect(html.toLowerCase()).toContain("peanut");
        expect(html).toContain("Bob");
        expect(html).toContain('name="confirm_allergen" value="1"');
        expect(html).toContain("Add anyway");
        const modal = html.match(
            new RegExp(
                `<dialog class="modal" id="grocery-add-food-${store.id}"[\\s\\S]*?</dialog>`,
            ),
        )?.[0];
        expect(modal).toContain("allergen-warning");
        expect(await db.groceryStore.listLines("hh-1")).toEqual([]);
    });

    test("GET /grocery is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/grocery", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<h1>Groceries</h1>");
    });

    test("POST /grocery/stores as owner adds Corner on the grocery page", async () => {
        const add = await siteApp.request("http://x/grocery/stores", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Corner",
        });
        expect(add.status).toBe(302);
        expect(add.headers.get("location")).toBe("/grocery");
        const stores = await db.settingsStore.listStores("hh-1");
        expect(stores.map((row) => row.name)).toEqual(["Corner"]);
        const page = await siteApp.request("http://x/grocery", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain('<h2 class="row-title">Corner</h2>');
        expect(html).toContain('class="grocery-add-store"');
        expect(html).not.toContain("<h3>Add supply</h3>");
        expect(html).not.toContain("grocery-add-supply");
    });

    test("POST /grocery/stores with an empty name re-renders grocery with the error", async () => {
        const add = await siteApp.request("http://x/grocery/stores", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=",
        });
        expect(add.status).toBe(400);
        expect(add.headers.get("location")).toBeNull();
        const html = await add.text();
        expect(html).toContain("<h1>Groceries</h1>");
        expect(html).toContain("Enter a store name.");
        expect(html).toContain('action="/grocery/stores"');
        expect(html).not.toContain("<h3>Add supply</h3>");
        expect(await db.settingsStore.listStores("hh-1")).toEqual([]);
    });

    test("GET /grocery as a member has no add-store form", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request("http://x/grocery", {
            headers: { cookie: cookieFor(bob) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Groceries</h1>");
        expect(html).not.toContain("grocery-add-store");
        expect(html).not.toContain('action="/grocery/stores"');
        expect(html).not.toContain("<h3>Add supply</h3>");
    });

    test("POST /grocery/stores as a member is refused", async () => {
        const add = await siteApp.request("http://x/grocery/stores", {
            method: "POST",
            headers: {
                cookie: cookieFor(bob),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Corner",
        });
        expect(add.status).toBe(403);
        expect(await add.text()).toContain("household membership");
        expect(await db.settingsStore.listStores("hh-1")).toEqual([]);
    });

    test("GET /settings is the account page, not a stub", async () => {
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Settings</h1>");
        expect(html).toContain('href="/settings/household"');
        expect(html).toContain('href="/settings/foods"');
        expect(html).toContain('href="/settings" aria-current="page"');
        expect(html).not.toContain("coming-soon");
    });

    test("GET /settings/foods lists the catalog", async () => {
        const r = await siteApp.request("http://x/settings/foods", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Foods</h1>");
        expect(html).toContain('href="/settings"');
        expect(html).toContain('href="/settings/household"');
        expect(html).toContain("No foods in the catalog yet.");
    });

    test("GET /api/foods/search is member-only", async () => {
        const empty = await siteApp.request("http://x/api/foods/search", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(empty.status).toBe(200);
        expect(await empty.json()).toEqual({ foods: [] });
        const outsiderRes = await siteApp.request(
            "http://x/api/foods/search?q=egg",
            { headers: { cookie: cookieFor(outsider) } },
        );
        expect(outsiderRes.status).toBe(403);
    });

    test("GET /settings/household shows owner add-member form", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Household</h1>");
        expect(html).toContain('action="/settings/household"');
        expect(html).toContain("Alice");
        expect(html).toContain("Bob");
    });

    test("GET /settings/household as a member is read-only", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(bob) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Household</h1>");
        expect(html).not.toContain("Add household member");
        expect(html).not.toContain('action="/settings/household/stores"');
    });

    test("POST /settings/household/stores seeds default sections", async () => {
        const add = await siteApp.request(
            "http://x/settings/household/stores",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "name=Safeway",
            },
        );
        expect(add.status).toBe(302);
        const page = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Safeway");
        expect(html).toContain("Produce");
        expect(html).toContain("Other");
    });

    test("GET /settings is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<h1>Settings</h1>");
    });

    test("GET /nutrition redirects to /", async () => {
        const r = await siteApp.request("http://x/nutrition", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/");
    });

    test("POST /settings persists dark theme for the next GET", async () => {
        const save = await siteApp.request("http://x/settings", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "theme=dark",
        });
        expect(save.status).toBe(302);
        expect(save.headers.get("location")).toBe("/settings");
        expect(db.profile?.theme).toBe("dark");
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await r.text();
        expect(html).toContain('<html lang="en" data-theme="dark">');
        expect(html).not.toContain("--accent");
    });

    test("POST /settings with System clears the saved theme", async () => {
        const save = await siteApp.request("http://x/settings", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "theme=system",
        });
        expect(save.status).toBe(302);
        expect(db.profile?.theme).toBeNull();
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await r.text();
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('name="theme" value="system" checked');
    });

    test("?member= shows a household peer read-only", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request(`http://x/?member=${bob}`, {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Bob</h1>");
        expect(html).toContain("Viewing Bob");
        expect(html).toContain("You can look, not edit");
        expect(html).toContain("widget-frame");
    });

    test("?member= of a stranger is 403", async () => {
        const r = await siteApp.request(`http://x/?member=${outsider}`, {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<iframe");
    });

    test("a non-member sees 403 when a household already exists", async () => {
        const r = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain('action="/create-household"');
        expect(html).not.toContain("<iframe");
    });

    test("a memberless user sees create-household when none exists", async () => {
        db.members = [];
        db.household = null;
        const r = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('action="/create-household"');
        expect(html).toContain("Create household");
        expect(html).not.toContain("<iframe");
    });

    test("POST /create-household as the first user creates the owner", async () => {
        db.members = [];
        db.household = null;
        const r = await siteApp.request("http://x/create-household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "household_name=Home&display_name=Alice",
        });
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/");
        expect(db.household).toMatchObject({ name: "Home" });
        expect(db.members).toEqual([
            {
                householdId: "hh-1",
                userId: alice,
                role: "owner",
                displayName: "Alice",
            },
        ]);
    });
});
