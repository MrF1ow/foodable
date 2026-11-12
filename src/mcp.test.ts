import {
    test,
    expect,
    describe,
    mock,
    beforeAll,
    beforeEach,
    afterAll,
    afterEach,
} from "bun:test";
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
import type { FetchOutcome } from "./fetch-safe.js";
import { Hono } from "hono";
import pkg from "../package.json" with { type: "json" };
import { ADD_FRIDGE_ITEM_OUTPUT_SCHEMA } from "./mcp/tools/fridge.js";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import * as actualNutrition from "./db/nutrition.js";
import * as actualProfiles from "./db/profiles.js";
import * as actualHousehold from "./db/household.js";
import * as actualDbFridge from "./db/fridge.js";
import * as actualDbGrocery from "./db/grocery.js";
import * as actualDbRecipes from "./db/recipes.js";
import * as actualDbShareLinks from "./db/share-links.js";
import * as actualDbSettings from "./db/settings.js";
import * as actualDbRules from "./db/rules.js";
import * as actualDbScoreSettings from "./db/score-settings.js";
import * as actualDbFoods from "./db/foods.js";
import * as actualDbStock from "./db/stock.js";
import * as actualDbAnalytics from "./db/analytics.js";
import * as actualDbSql from "./db/sql.js";
import * as actualDbSocialReaders from "./db/social-readers.js";
import * as actualDbFetchMemory from "./db/fetch-memory.js";
import * as actualRecipeUrlFetcher from "./recipe-url-fetcher.js";
import * as actualFoods from "./foods.js";
import * as actualFoodSearch from "./food-search.js";
import * as actualExports from "./db/exports.js";
import * as actualDbUsers from "./db/users.js";
import {
    GOAL_DAY_FIELDS,
    goalsForDate,
    goalsResolver,
    type GoalDayOverride,
} from "./domain/insights.js";
import { SET_NUTRITION_GOALS_OUTPUT_SCHEMA } from "./mcp/tools/goals.js";
import { createMemoryExportArchiveStore } from "./db/exports.js";
import { verifyExportToken } from "./domain/export-link.js";
import { resolveSessionSigningSecret } from "./site-session.js";
import { z } from "zod";
import {
    allFlagsOff,
    allFlagsOn,
    buildFlagContext,
    createMemoryFlags,
    defaultFlags,
    resetFlagsForTests,
    setFlagsForTests,
} from "./flags.js";
import { evaluateViewerFlags, type ViewerFlags } from "./viewer-flags.js";
import {
    createToolContext,
    MEAL_LOGGED_WIDGET_URI,
    widgetUri,
} from "./mcp/shared.js";
import { gatedTool } from "./mcp/gated.js";
import { toolNamesFor } from "./test-support/flag-harness.js";

// Snapshot BEFORE mock.module runs: Bun patches a mocked module's namespace
// in place, so restoring from the live import afterwards would hand the next
// file the mock again. Restore from these copies.
const realNutrition = { ...actualNutrition };
const realProfiles = { ...actualProfiles };
const realHousehold = { ...actualHousehold };
const realDbFridge = { ...actualDbFridge };
const realDbGrocery = { ...actualDbGrocery };
const realDbRecipes = { ...actualDbRecipes };
const realDbShareLinks = { ...actualDbShareLinks };
const realDbSettings = { ...actualDbSettings };
const realDbRules = { ...actualDbRules };
const realDbScoreSettings = { ...actualDbScoreSettings };
const realDbFoods = { ...actualDbFoods };
const realDbStock = { ...actualDbStock };
const realDbAnalytics = { ...actualDbAnalytics };
const realDbSql = { ...actualDbSql };
const realDbSocialReaders = { ...actualDbSocialReaders };
const realDbFetchMemory = { ...actualDbFetchMemory };
const realRecipeUrlFetcher = { ...actualRecipeUrlFetcher };
const realFoods = { ...actualFoods };
const realFoodSearch = { ...actualFoodSearch };
const realExports = { ...actualExports };
const realDbNoticeDismissals = { ...actualDbNoticeDismissals };
const realDbPlans = { ...actualDbPlans };
const realDbWeighIns = { ...actualDbWeighIns };
const realDbUsers = { ...actualDbUsers };
const exportMemoryStore = createMemoryExportArchiveStore();
import { DELETED_ACCOUNT_ANALYTICS_ID } from "./analytics.js";
import {
    HOUSEHOLD_CANNOT_DELETE_ACCOUNT,
    OAUTH_USER_MISMATCH,
} from "./auth-context.js";
import { HOUSEHOLD_TOKEN_PREFIX } from "./household-token.js";
import {
    DEFAULT_RESTOCK,
    EMPTY_HOUSEHOLD_PREFERENCES,
    HouseholdAlreadyExistsError,
    type HouseholdConfig,
} from "./household.js";
import { createMemoryFridgeStore } from "./domain/fridge.js";
import { createMemoryStockStore, ledgerMatchesStock } from "./domain/stock.js";
import { createMemoryFoodsStore, type Food } from "./domain/foods.js";
import {
    findOrCreateFoodByBarcode,
    findOrCreateManualFood,
    mergeFoods,
    newFood,
    updateFood,
} from "./domain/foods.js";
import { RATE_PRODUCT_OUTPUT_SCHEMA } from "./mcp/tools/product-score.js";
import { HOUSEHOLD_DIGEST_OUTPUT_SCHEMA } from "./mcp/tools/household-digest.js";
import {
    FOOD_OUTPUT,
    GET_FOOD_OUTPUT,
    UPSERT_FOOD_OUTPUT,
} from "./mcp/tools/food.js";
import {
    ADD_GROCERY_LINE_OUTPUT_SCHEMA,
    GROCERY_LIST_OUTPUT_SCHEMA,
} from "./mcp/tools/grocery.js";
import {
    ADD_RECIPE_INGREDIENT_OUTPUT_SCHEMA,
    IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA,
    MACROS_ITEM_OUTPUT_SCHEMA,
} from "./mcp/tools/recipes.js";
import { MEAL_PROGRESS_OUTPUT_SCHEMA } from "./mcp/shared.js";
import { NOTICE_SCHEMA } from "./mcp/shared.js";
import { LIST_NOTICES_OUTPUT_SCHEMA } from "./mcp/tools/notices.js";
import { createMemoryGroceryStore } from "./domain/grocery.js";
import { utcTodayFromDate } from "./domain/stock.js";
import { createMemoryFetchMemoryStore } from "./domain/fetch-memory.js";
import {
    createMemoryRecipesStore,
    createRecipe,
    importRecipeFromText,
} from "./domain/recipes.js";
import {
    createMemoryShareLinkStore,
    resolveShareToken,
} from "./domain/sharing.js";
import { SHARE_LINK_OUTPUT_SCHEMAS } from "./mcp/tools/sharing.js";
import {
    createGroceryStore,
    createMemorySettingsStore,
} from "./domain/settings.js";
import { addAllergen, createMemoryRulesStore } from "./domain/rules.js";
import {
    createMemoryScoreSettingsStore,
    updateHouseholdScoreDefault,
    updateMemberScoreSettings,
} from "./domain/score-settings.js";
import { createMemoryNoticeDismissalsStore } from "./domain/notice-dismissals.js";
import * as actualDbNoticeDismissals from "./db/notice-dismissals.js";
import { createMemoryPlansStore } from "./domain/plan.js";
import {
    createMemoryWeighInStore,
    type LatestWeighIn,
} from "./domain/notices-actionable.js";
import * as actualDbPlans from "./db/plans.js";
import * as actualDbWeighIns from "./db/weigh-ins.js";
import { createMemorySocialReaderStatusStore } from "./domain/social-readers.js";
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
import {
    dateInTz,
    formatLocalDateTime,
    todayInTz,
    weekdayInTz,
} from "./domain/tz.js";
import { getAppCss, getAppJs, getWidgetHtml } from "./widgets.js";

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
        goal_name: null,
        goal_note: null,
        goals_set_on: null,
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
    theme: null,
    nutrition_layout: null,
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
    goalDays: [] as GoalDayOverride[],
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
    profileUpsertUserIds: [] as string[],
    // Ids the delete stubs consider to exist. Deleting one removes it, so a
    // second delete of the same id reports "not found" like the real table.
    rowIds: new Set<string>(),
    analyticsRows: [] as Record<string, unknown>[],
    accountWipes: 0,
    // Who deleteAllUserData erased, in order.
    wipedUsers: [] as string[],
    ownershipTransfers: [] as { from: string; to: string }[],
    profileReads: [] as string[],
    profilesByUserId: {} as Record<string, actualProfiles.Profile>,
    membershipReads: [] as string[],
    members: [] as actualHousehold.HouseholdMembership[],
    addedLogins: [] as string[],
    tokenRotations: [] as {
        householdId: string;
        tokenHashHex: string;
        issuedBy: string | null;
    }[],
    household: null as HouseholdConfig | null,
    pluralsSameFood: false,
    pluralsSameFoodWrites: 0,
    householdConfigWrites: 0,
    fridgeStore: createMemoryFridgeStore(),
    stockStore: createMemoryStockStore(),
    groceryStore: createMemoryGroceryStore(),
    recipesStore: createMemoryRecipesStore(),
    shareLinksStore: createMemoryShareLinkStore(),
    settingsStore: createMemorySettingsStore(),
    rulesStore: createMemoryRulesStore(),
    scoreSettingsStore: createMemoryScoreSettingsStore(),
    foodsStore: createMemoryFoodsStore(),
    dismissalsStore: createMemoryNoticeDismissalsStore(),
    plansStore: createMemoryPlansStore(),
    weighInRows: [] as LatestWeighIn[],
    barcodeFoods: {} as Record<string, FoodResult>,
    // Off by default so no test reaches Open Food Facts or depends on
    // OFF_USER_AGENT; the kill-switch tests turn it on (with fetch stubbed or
    // the switch off) to exercise the real lookup's gate.
    realBarcodeLookup: false,
    lookupBarcodeCalls: [] as {
        barcode: string;
        options?: actualFoods.FoodLookupHooks;
    }[],
    foodSearchHits: [] as FoodResult[],
    foodSearchError: null as Error | null,
    recipeImportFetcher: null as import("./fetch-safe.js").SafeFetcher | null,
    fetchMemoryStore: createMemoryFetchMemoryStore(),
    socialReaderStatusStore: createMemorySocialReaderStatusStore(),
};

mock.module("./db/analytics.js", () => ({
    ...realDbAnalytics,
    insertToolAnalytics: (row: Record<string, unknown>) => {
        db.analyticsRows.push(row);
    },
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
    getGoalsForDate: async (_u: string, date: string) =>
        goalsForDate(db.goals, db.goalDays, date),
    getGoalsForRange: async () => ({
        defaults: db.goals,
        forDate: goalsResolver(db.goals, db.goalDays),
    }),
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
        // The real upsert drops undefined keys (an omitted field keeps its
        // stored value), so the stand-in must not spread them over the row.
        const defined = Object.fromEntries(
            Object.entries(patch).filter(([, v]) => v !== undefined),
        );
        db.goals = {
            ...(db.goals ?? goals()),
            user_id: userId,
            ...defined,
        } as NutritionGoals;
        return db.goals;
    },
    upsertGoalDays: async (
        userId: string,
        _householdId: string,
        dates: string[],
        input: Record<string, number | null | undefined>,
    ) => {
        const provided = GOAL_DAY_FIELDS.filter((f) => input[f] !== undefined);
        if (provided.length === 0 || dates.length === 0) return [];
        const saved: GoalDayOverride[] = [];
        for (const date of [...new Set(dates)]) {
            let row = db.goalDays.find(
                (o) => o.user_id === userId && o.date === date,
            );
            if (!row) {
                row = {
                    user_id: userId,
                    date,
                    updated_at: new Date().toISOString(),
                    daily_calories: null,
                    daily_protein_g: null,
                    daily_carbs_g: null,
                    daily_fat_g: null,
                    daily_fiber_g: null,
                    daily_sugar_g: null,
                    daily_alcohol_g: null,
                    daily_caffeine_mg: null,
                    daily_water_ml: null,
                };
                db.goalDays.push(row);
            }
            for (const field of provided) {
                row[field] = input[field] ?? null;
            }
            row.updated_at = new Date().toISOString();
            if (GOAL_DAY_FIELDS.every((f) => row![f] == null)) {
                db.goalDays = db.goalDays.filter(
                    (o) => !(o.user_id === userId && o.date === date),
                );
            } else {
                saved.push({ ...row });
            }
        }
        return saved;
    },
    clearGoalDays: async (
        userId: string,
        _householdId: string,
        dates: string[],
    ) => {
        let removed = 0;
        for (const date of dates) {
            const before = db.goalDays.length;
            db.goalDays = db.goalDays.filter(
                (o) => !(o.user_id === userId && o.date === date),
            );
            if (db.goalDays.length < before) removed += 1;
        }
        return removed;
    },
    getLatestWeight: async () => null,
    getWeightInRange: async () => [],
    getAllMeals: async () => db.meals,
    searchMeals: async () => db.meals,
    getAllMealItems: async () => [],
    getAllWater: async () => db.water,
    getAllWeight: async () => [],
    getAllGoalDays: async () => db.goalDays,
}));

mock.module("./db/exports.js", () => ({
    ...realExports,
    liveExportArchiveStore: () => exportMemoryStore,
}));

mock.module("./db/profiles.js", () => ({
    ...actualProfiles,
    getProfile: async (userId: string) => {
        db.profileReads.push(userId);
        if (db.profilesByUserId[userId]) {
            return db.profilesByUserId[userId];
        }
        return db.profile;
    },
    getUserTimezone: async () => db.profile?.timezone ?? "UTC",
    getPreferredWeightUnit: async () =>
        db.profile?.preferred_weight_unit ?? null,
    upsertProfile: async (userId: string, patch: Record<string, unknown>) => {
        db.profilePatches.push(patch);
        db.profileUpsertUserIds.push(userId);
        db.profile = {
            ...(db.profile ?? { ...PROFILE_BASE, user_id: userId }),
            user_id: userId,
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
    getHouseholdOwnerProfile: async () => db.profile,
    updateHouseholdConfig: async (
        _householdId: string,
        config: HouseholdConfig,
    ) => {
        db.householdConfigWrites += 1;
        db.household = structuredClone(config);
        return structuredClone(db.household);
    },
    getPluralsSameFood: async () => db.pluralsSameFood,
    setPluralsSameFood: async (_householdId: string, enabled: boolean) => {
        db.pluralsSameFoodWrites += 1;
        db.pluralsSameFood = enabled;
        return enabled;
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
    // The real one checks membership as the system, then runs
    // deleteAllUserData, whose stub above records the wipe.
    removeHouseholdMemberAccount: async (
        householdId: string,
        userId: string,
    ) => {
        const member = db.members.find(
            (m) => m.householdId === householdId && m.userId === userId,
        );
        if (!member || member.role === "owner") {
            throw new Error(
                "Only a member other than the owner can be removed.",
            );
        }
        db.accountWipes += 1;
        db.wipedUsers.push(userId);
        db.members = db.members.filter((m) => m.userId !== userId);
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

mock.module("./db/share-links.js", () => ({
    ...actualDbShareLinks,
    liveShareLinkStore: () => db.shareLinksStore,
}));

mock.module("./db/settings.js", () => ({
    ...actualDbSettings,
    liveSettingsStore: () => db.settingsStore,
}));

mock.module("./db/rules.js", () => ({
    ...actualDbRules,
    liveRulesStore: () => db.rulesStore,
}));

mock.module("./db/score-settings.js", () => ({
    ...actualDbScoreSettings,
    liveScoreSettingsStore: () => db.scoreSettingsStore,
}));

mock.module("./db/foods.js", () => ({
    ...actualDbFoods,
    liveFoodsStore: () => db.foodsStore,
    mergeLiveFoods: (
        householdId: string,
        keepId: string,
        dropId: string,
        store = db.foodsStore,
    ) => mergeFoods(store, householdId, keepId, dropId),
}));

mock.module("./db/notice-dismissals.js", () => ({
    ...actualDbNoticeDismissals,
    liveNoticeDismissalsStore: () => db.dismissalsStore,
}));

mock.module("./db/plans.js", () => ({
    ...actualDbPlans,
    liveRecipePlansStore: () => db.plansStore,
}));

mock.module("./db/weigh-ins.js", () => ({
    ...actualDbWeighIns,
    liveWeighInStore: () => createMemoryWeighInStore(db.weighInRows),
}));

mock.module("./db/social-readers.js", () => ({
    ...actualDbSocialReaders,
    liveSocialReaderStatusStore: () => db.socialReaderStatusStore,
}));

mock.module("./foods.js", () => ({
    ...actualFoods,
    lookupBarcode: async (
        barcode: string,
        options?: actualFoods.FoodLookupHooks,
    ) => {
        db.lookupBarcodeCalls.push({ barcode, options });
        if (Object.hasOwn(db.barcodeFoods, barcode)) {
            return db.barcodeFoods[barcode];
        }
        if (!db.realBarcodeLookup) return null;
        return realFoods.lookupBarcode(barcode, options);
    },
}));

mock.module("./food-search.js", () => ({
    ...actualFoodSearch,
    searchFoodsByName: async () => {
        if (db.foodSearchError) throw db.foodSearchError;
        return db.foodSearchHits;
    },
}));

mock.module("./db/sql.js", () => ({
    ...actualDbSql,
    run: async <T>(fn: (tx: unknown) => Promise<T>) => fn({}),
}));

mock.module("./db/users.js", () => ({
    ...actualDbUsers,
    authUserCount: async () => 1,
    signInUser: async () => "11111111-1111-4111-8111-111111111111",
    signUpUser: async () => {
        throw new Error("signUp disabled in mcp.test mock");
    },
}));

mock.module("./recipe-url-fetcher.js", () => ({
    ...actualRecipeUrlFetcher,
    recipeImportFetcher: () => {
        if (!db.recipeImportFetcher) {
            throw new Error("recipeImportFetcher not configured in test");
        }
        return db.recipeImportFetcher;
    },
    recipeFetchMemory: () => db.fetchMemoryStore,
}));

mock.module("./db/fetch-memory.js", () => ({
    ...actualDbFetchMemory,
    recipeFetchMemory: () => db.fetchMemoryStore,
}));

afterAll(() => {
    mock.module("./db/analytics.js", () => realDbAnalytics);
    mock.module("./db/nutrition.js", () => realNutrition);
    mock.module("./db/profiles.js", () => realProfiles);
    mock.module("./db/household.js", () => realHousehold);
    mock.module("./db/fridge.js", () => realDbFridge);
    mock.module("./db/stock.js", () => realDbStock);
    mock.module("./db/grocery.js", () => realDbGrocery);
    mock.module("./db/recipes.js", () => realDbRecipes);
    mock.module("./db/share-links.js", () => realDbShareLinks);
    mock.module("./db/settings.js", () => realDbSettings);
    mock.module("./db/rules.js", () => realDbRules);
    mock.module("./db/score-settings.js", () => realDbScoreSettings);
    mock.module("./db/foods.js", () => realDbFoods);
    mock.module("./db/notice-dismissals.js", () => realDbNoticeDismissals);
    mock.module("./db/plans.js", () => realDbPlans);
    mock.module("./db/weigh-ins.js", () => realDbWeighIns);
    mock.module("./db/social-readers.js", () => realDbSocialReaders);
    mock.module("./foods.js", () => realFoods);
    mock.module("./food-search.js", () => realFoodSearch);
    mock.module("./db/exports.js", () => realExports);
    mock.module("./db/sql.js", () => realDbSql);
    mock.module("./db/users.js", () => realDbUsers);
    mock.module("./db/fetch-memory.js", () => realDbFetchMemory);
    mock.module("./recipe-url-fetcher.js", () => realRecipeUrlFetcher);
});

beforeEach(() => {
    db.profile = { ...PROFILE_BASE };
    db.goals = null;
    db.goalDays = [];
    db.meals = [];
    db.water = [];
    db.inserted = [];
    db.mealUpdates = [];
    db.waterInserted = [];
    db.weightInserted = [];
    db.weightUpdates = [];
    db.profilePatches = [];
    db.profileUpsertUserIds = [];
    db.rowIds = new Set<string>();
    db.analyticsRows = [];
    db.accountWipes = 0;
    db.wipedUsers = [];
    db.ownershipTransfers = [];
    db.profileReads = [];
    db.profilesByUserId = {};
    db.membershipReads = [];
    db.addedLogins = [];
    db.tokenRotations = [];
    db.household = {
        name: "Home",
        recipeSearchPlaces: [],
        preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
    };
    db.pluralsSameFood = false;
    db.pluralsSameFoodWrites = 0;
    db.householdConfigWrites = 0;
    db.members = [
        {
            householdId: "hh-1",
            userId: "u1",
            role: "owner",
            displayName: "U1",
        },
    ];
    db.dismissalsStore = createMemoryNoticeDismissalsStore();
    db.plansStore = createMemoryPlansStore();
    db.weighInRows = [];
    db.fridgeStore = createMemoryFridgeStore();
    db.stockStore = createMemoryStockStore();
    db.groceryStore = createMemoryGroceryStore();
    db.recipesStore = createMemoryRecipesStore();
    db.shareLinksStore = createMemoryShareLinkStore();
    db.settingsStore = createMemorySettingsStore();
    db.rulesStore = createMemoryRulesStore();
    db.scoreSettingsStore = createMemoryScoreSettingsStore();
    db.foodsStore = createMemoryFoodsStore();
    db.fridgeStore.linkDismissals(db.dismissalsStore);
    db.groceryStore.linkDismissals(db.dismissalsStore);
    db.recipesStore.linkDismissals(db.dismissalsStore);
    db.foodsStore.linkDismissals(db.dismissalsStore);
    db.barcodeFoods = {};
    db.realBarcodeLookup = false;
    db.lookupBarcodeCalls = [];
    db.foodSearchHits = [];
    db.foodSearchError = null;
    db.recipeImportFetcher = null;
    db.fetchMemoryStore = createMemoryFetchMemoryStore();
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

const SIMILAR_WRITE_TOOLS = new Set([
    "upsert_food",
    "add_fridge_item",
    "add_grocery_line",
    "add_recipe_ingredient",
    "import_recipe_from_text",
    "log_meal",
]);

function callToolArguments(
    name: string,
    args: Record<string, unknown>,
): Record<string, unknown> {
    const next = { ...args };
    // Existing fixtures predate "did you mean" and expect a create, so they
    // get on_similar "create". A test that passes the key (even as undefined,
    // which serializes away) runs the tool's real default, "ask".
    if (
        SIMILAR_WRITE_TOOLS.has(name) &&
        !("on_similar" in next) &&
        next.new_food !== true
    ) {
        next.on_similar = "create";
    }
    return next;
}

/** Register the real tools for a user whose alcohol gate is `alcohol`, then
 *  drive them through a client. `alcohol` is the whole opt-in: null = off. */
async function withTools(
    alcohol: "us" | "uk" | null,
    run: (call: CallTool) => Promise<void>,
    baseUrl = "http://localhost",
): Promise<void> {
    const server = new McpServer(
        { name: "foodable-test", version: "0.0.0" },
        { capabilities: { tools: {}, resources: {} } },
    );
    registerTools(
        server,
        { kind: "user", userId: "u1" },
        true,
        alcohol,
        undefined,
        baseUrl,
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
                    arguments: callToolArguments(name, args),
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
    // drift test because there is nothing to drift: src/domain/import.ts owns the three
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
    // src/db/nutrition.ts and src/domain/import.ts). Adding caffeine_mg to it would orphan
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

describe("search_meals groups food-backed variations by food set", () => {
    test("returns one variation for differently worded meals with the same foods", async () => {
        const eggs = "11111111-1111-4111-8111-111111111101";
        const toast = "11111111-1111-4111-8111-111111111102";
        const item = (food_id: string): NonNullable<Meal["items"]>[number] => ({
            id: `i-${food_id}`,
            meal_id: "m",
            user_id: "u1",
            household_id: "hh-1",
            food_id,
            recipe_id: null,
            label: "Item",
            amount: 1,
            unit: "each",
            grams: 50,
            portions: null,
            calories: 100,
            protein_g: 10,
            carbs_g: 1,
            fat_g: 5,
            fiber_g: 0,
            sugar_g: 0,
            alcohol_g: null,
            caffeine_mg: null,
            sort_order: 0,
            created_at: "2026-06-20T14:30:00.000Z",
        });
        db.meals = [
            meal({
                id: "m1",
                description: "Eggs and toast",
                logged_at: "2026-06-20T08:00:00.000Z",
                items: [item(eggs), item(toast)],
            }),
            meal({
                id: "m2",
                description: "Breakfast plate",
                logged_at: "2026-06-21T08:00:00.000Z",
                items: [item(toast), item(eggs)],
            }),
        ];
        await withTools(null, async (call) => {
            const text = textOf(
                await call("search_meals", { queries: ["eggs"] }),
            );
            expect(text).toContain("Found 2 past meals");
            expect(text).toContain("logged 2×");
            expect(text).toContain("Breakfast plate");
            expect(text).not.toMatch(/2\.\s/);
        });
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

describe("set_nutrition_goals names the goals", () => {
    const parsed = (r: ToolResult) =>
        SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(r.structuredContent);

    test("a name and note are stored, echoed and stamped with today's date", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "Asia/Tokyo" };
        db.goals = null;
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_calories: 2100,
                goal_name: "  Recomp  ",
                goal_note: "Since the October check-in",
            });
            expect(r.isError).toBeFalsy();
            expect(db.goals!.goal_name).toBe("Recomp");
            expect(db.goals!.goal_note).toBe("Since the October check-in");
            expect(db.goals!.goals_set_on).toBe(todayInTz("Asia/Tokyo"));
            const out = parsed(r);
            expect(out.goals).toMatchObject({
                goal_name: "Recomp",
                goal_note: "Since the October check-in",
                goals_set_on: todayInTz("Asia/Tokyo"),
            });
            expect(textOf(r)).toContain("Recomp");
        });
    });

    test("a write without goal_name keeps the stored name and note", async () => {
        db.goals = goals({
            goal_name: "Recomp",
            goal_note: "Slow and steady",
            goals_set_on: "2026-10-02",
        });
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_protein_g: 150,
            });
            expect(r.isError).toBeFalsy();
            expect(db.goals!.goal_name).toBe("Recomp");
            expect(db.goals!.goal_note).toBe("Slow and steady");
            expect(parsed(r).goals?.goal_name).toBe("Recomp");
            // Changing a target is a save, so the date moves to today.
            expect(db.goals!.goals_set_on).not.toBe("2026-10-02");
        });
    });

    test("renaming alone keeps the set date; null or blank clears", async () => {
        db.goals = goals({
            goal_name: "Recomp",
            goal_note: "Slow and steady",
            goals_set_on: "2026-10-02",
        });
        await withTools(null, async (call) => {
            await call("set_nutrition_goals", { goal_name: "Cut" });
            expect(db.goals!.goal_name).toBe("Cut");
            expect(db.goals!.goals_set_on).toBe("2026-10-02");
            await call("set_nutrition_goals", { goal_note: null });
            expect(db.goals!.goal_note).toBeNull();
            await call("set_nutrition_goals", { goal_name: "   " });
            expect(db.goals!.goal_name).toBeNull();
            expect(db.goals!.goals_set_on).toBe("2026-10-02");
        });
    });

    test("a 41-character name is refused, 40 is accepted", async () => {
        db.goals = goals({ goal_name: "Recomp" });
        await withTools(null, async (call) => {
            const long = await call("set_nutrition_goals", {
                goal_name: "x".repeat(41),
            });
            expect(long.isError).toBe(true);
            expect(textOf(long)).toContain("at most 40 characters");
            expect(db.goals!.goal_name).toBe("Recomp");
            const ok = await call("set_nutrition_goals", {
                goal_name: "x".repeat(40),
            });
            expect(ok.isError).toBeFalsy();
            expect(db.goals!.goal_name).toBe("x".repeat(40));
            const note = await call("set_nutrition_goals", {
                goal_note: "n".repeat(281),
            });
            expect(note.isError).toBe(true);
            expect(textOf(note)).toContain("at most 280 characters");
        });
    });

    test("a name cannot be set on a per-day override", async () => {
        db.goals = goals();
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                date: "2026-07-04",
                daily_calories: 2800,
                goal_name: "Rest day",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("default goals only");
        });
    });

    test("get_goal_progress returns the name, note and set date", async () => {
        db.goals = goals({
            goal_name: "Recomp",
            goal_note: "Slow and steady",
            goals_set_on: "2026-10-02",
        });
        await withTools(null, async (call) => {
            const r = await call("get_goal_progress", {});
            const sc = r.structuredContent as {
                goals: {
                    goal_name: string | null;
                    goal_note: string | null;
                    goals_set_on: string | null;
                };
            };
            expect(sc.goals).toMatchObject({
                goal_name: "Recomp",
                goal_note: "Slow and steady",
                goals_set_on: "2026-10-02",
            });
        });
    });
});

describe("per-day nutrition goal overrides (read path)", () => {
    test("get_goal_progress uses override calories; target weight stays default", async () => {
        db.goals = goals({
            daily_calories: 2000,
            daily_protein_g: 150,
            target_weight_g: 80000,
        });
        db.goalDays = [
            {
                user_id: "u1",
                date: "2026-07-04",
                updated_at: "2026-07-04T00:00:00Z",
                daily_calories: 2500,
                daily_protein_g: null,
                daily_carbs_g: null,
                daily_fat_g: null,
                daily_fiber_g: null,
                daily_sugar_g: null,
                daily_alcohol_g: null,
                daily_caffeine_mg: null,
                daily_water_ml: null,
            },
        ];
        await withTools(null, async (call) => {
            const r = await call("get_goal_progress", { date: "2026-07-04" });
            const text = textOf(r);
            expect(text).toContain("2500");
            expect(text).not.toMatch(/Calories:.*2000 kcal target/);
            expect(text).toContain("80 kg");
            const sc = r.structuredContent as {
                goals: { calories: number | null };
            };
            expect(sc.goals?.calories).toBe(2500);
        });
    });

    test("get_trends text shows varies by day when overrides differ", async () => {
        db.goals = goals({ daily_calories: 2000 });
        db.meals = [
            meal({ logged_at: "2026-06-01T12:00:00Z", calories: 2000 }),
            meal({ logged_at: "2026-06-02T12:00:00Z", calories: 2000 }),
        ];
        db.goalDays = [
            {
                user_id: "u1",
                date: "2026-06-02",
                updated_at: "2026-06-02T00:00:00Z",
                daily_calories: 3000,
                daily_protein_g: null,
                daily_carbs_g: null,
                daily_fat_g: null,
                daily_fiber_g: null,
                daily_sugar_g: null,
                daily_alcohol_g: null,
                daily_caffeine_mg: null,
                daily_water_ml: null,
            },
        ];
        await withTools(null, async (call) => {
            const text = textOf(
                await call("get_trends", {
                    days: 2,
                    end_date: "2026-06-02",
                }),
            );
            expect(text).toContain("varies by day");
        });
    });
});

describe("set_nutrition_goals per-day overrides", () => {
    const bob = "22222222-2222-4222-8222-222222222222";
    const otherDay = "2026-07-05";

    test("override on one day; another day keeps the default", async () => {
        db.goals = goals({ daily_calories: 2000 });
        await withTools(null, async (call) => {
            const set = await call("set_nutrition_goals", {
                date: "2026-07-04",
                daily_calories: 2800,
            });
            expect(set.isError).toBeFalsy();
            SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(set.structuredContent);
            expect(set.structuredContent?.scope).toBe("days");
            const onDay = await call("get_goal_progress", {
                date: "2026-07-04",
            });
            expect(textOf(onDay)).toContain("2800");
            const other = await call("get_goal_progress", { date: otherDay });
            expect(textOf(other)).toContain("2000");
        });
    });

    test("a three-day range writes each day", async () => {
        db.goals = goals({ daily_calories: 2000 });
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                from: "2026-08-01",
                to: "2026-08-03",
                daily_protein_g: 180,
            });
            expect(r.isError).toBeFalsy();
            const sc = SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(
                r.structuredContent,
            );
            expect(sc.days).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
            expect(
                db.goalDays
                    .filter((o) => o.user_id === "u1")
                    .map((o) => o.date),
            ).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
        });
    });

    test("clear removes an override", async () => {
        db.goals = goals({ daily_calories: 2000 });
        await withTools(null, async (call) => {
            await call("set_nutrition_goals", {
                date: "2026-07-04",
                daily_calories: 2800,
            });
            await call("set_nutrition_goals", {
                date: "2026-07-04",
                clear: true,
            });
            expect(db.goalDays).toHaveLength(0);
            const r = await call("get_goal_progress", { date: "2026-07-04" });
            expect(textOf(r)).toContain("2000");
            expect(textOf(r)).not.toContain("2800");
        });
    });

    test("null on one field clears only that override field", async () => {
        db.goals = goals({ daily_calories: 2000, daily_protein_g: 150 });
        await withTools(null, async (call) => {
            await call("set_nutrition_goals", {
                date: "2026-07-04",
                daily_calories: 2800,
                daily_protein_g: 200,
            });
            await call("set_nutrition_goals", {
                date: "2026-07-04",
                daily_protein_g: null,
            });
            const row = db.goalDays.find(
                (o) => o.date === "2026-07-04" && o.user_id === "u1",
            );
            expect(row?.daily_calories).toBe(2800);
            expect(row?.daily_protein_g).toBeNull();
            const r = await call("get_goal_progress", { date: "2026-07-04" });
            expect(textOf(r)).toContain("2800");
            expect(textOf(r)).toContain("150");
        });
    });

    test("an empty date is refused instead of writing the defaults", async () => {
        db.goals = goals({ daily_calories: 2000 });
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                date: "",
                daily_calories: 2100,
            });
            expect(r.isError).toBe(true);
            expect(db.goals?.daily_calories).toBe(2000);
            expect(db.goalDays).toHaveLength(0);
        });
    });

    test("standing defaults do not need a household membership", async () => {
        db.goals = goals({ daily_calories: 2000 });
        db.members = [];
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                daily_calories: 2200,
            });
            expect(r.isError).toBeFalsy();
            expect(db.goals?.daily_calories).toBe(2200);
        });
    });

    test("a 93-day range is refused without writing", async () => {
        db.goals = goals({ daily_calories: 2000 });
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                from: "2026-01-01",
                to: "2026-04-03",
                daily_calories: 2500,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("92");
            expect(db.goalDays).toHaveLength(0);
        });
    });

    test("date and from together is refused", async () => {
        await withTools(null, async (call) => {
            const r = await call("set_nutrition_goals", {
                date: "2026-07-04",
                from: "2026-07-01",
                to: "2026-07-02",
                daily_calories: 2500,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("not both");
            expect(db.goalDays).toHaveLength(0);
        });
    });

    test("target_member writes the other member's override", async () => {
        db.goals = goals({ daily_calories: 2000 });
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
            const r = await call("set_nutrition_goals", {
                target_member: bob,
                date: "2026-07-04",
                daily_calories: 2800,
            });
            expect(r.isError).toBeFalsy();
            expect(
                db.goalDays.some(
                    (o) => o.user_id === bob && o.daily_calories === 2800,
                ),
            ).toBe(true);
        });
    });
});

// IMPORT_ROW_SCHEMA is a plain z.object, so zod STRIPS any key it does not
// declare — exactly the silent failure the source_id block below pins. Drop
// caffeine_mg from that schema and src/domain/import.ts's unit tests all still pass
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

describe("the notice tool descriptions match what the tools do", () => {
    test("dismiss_notice says to pass related_id back; list_notices does not promise the badge", async () => {
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
        const dismiss = tools.find((t) => t.name === "dismiss_notice");
        expect(dismiss?.description).toContain("related_id");
        expect(dismiss?.description).not.toContain("info-level");
        const list = tools.find((t) => t.name === "list_notices");
        expect(list?.description).not.toContain("badge");
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
    test("structuredContent locale is English", async () => {
        stage(1);
        db.profile = PROFILE_BASE;
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
        db.profile = PROFILE_BASE;
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
            "goal_days.csv",
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

    test("returns a signed /exports/ link for the caller", async () => {
        const exportUser = "11111111-1111-4111-8111-111111111111";
        const prevSecret = process.env.SESSION_SECRET;
        process.env.SESSION_SECRET = "mcp-export-test-secret-32chars!!";
        db.meals = [meal({ user_id: exportUser })];
        db.profile = { ...PROFILE_BASE, user_id: exportUser };
        try {
            const server = new McpServer(
                { name: "foodable-test", version: "0.0.0" },
                { capabilities: { tools: {}, resources: {} } },
            );
            registerTools(
                server,
                { kind: "user", userId: exportUser },
                true,
                null,
                undefined,
                "http://localhost",
            );
            const [clientTransport, serverTransport] =
                InMemoryTransport.createLinkedPair();
            const client = new Client({
                name: "test-client",
                version: "0.0.0",
            });
            await Promise.all([
                server.connect(serverTransport),
                client.connect(clientTransport),
            ]);
            try {
                const r = (await client.callTool({
                    name: "export_all_data",
                    arguments: {},
                })) as ToolResult;
                const text = textOf(r);
                expect(text).toContain(
                    "Download (link valid for 60 minutes): http://localhost/exports/",
                );
                const urlLine = text
                    .split("\n")
                    .find((l) => l.includes("/exports/"));
                expect(urlLine).toBeDefined();
                const token = urlLine!.split("/exports/")[1]!;
                expect(
                    verifyExportToken(
                        token,
                        Date.now(),
                        resolveSessionSigningSecret(),
                    ),
                ).toBe(exportUser);
            } finally {
                await client.close();
                await server.close();
            }
        } finally {
            if (prevSecret === undefined) delete process.env.SESSION_SECRET;
            else process.env.SESSION_SECRET = prevSecret;
        }
    });

    test("uses baseUrl from tool context (PUBLIC_ORIGIN path)", async () => {
        const exportUser = "22222222-2222-4222-8222-222222222222";
        const prevSecret = process.env.SESSION_SECRET;
        process.env.SESSION_SECRET = "mcp-export-test-secret-32chars!!";
        db.meals = [meal({ user_id: exportUser })];
        db.profile = { ...PROFILE_BASE, user_id: exportUser };
        try {
            const server = new McpServer(
                { name: "foodable-test", version: "0.0.0" },
                { capabilities: { tools: {}, resources: {} } },
            );
            registerTools(
                server,
                { kind: "user", userId: exportUser },
                true,
                null,
                undefined,
                "https://exports.example",
            );
            const [clientTransport, serverTransport] =
                InMemoryTransport.createLinkedPair();
            const client = new Client({
                name: "test-client",
                version: "0.0.0",
            });
            await Promise.all([
                server.connect(serverTransport),
                client.connect(clientTransport),
            ]);
            try {
                const r = (await client.callTool({
                    name: "export_all_data",
                    arguments: {},
                })) as ToolResult;
                expect(textOf(r)).toContain("https://exports.example/exports/");
            } finally {
                await client.close();
                await server.close();
            }
        } finally {
            if (prevSecret === undefined) delete process.env.SESSION_SECRET;
            else process.env.SESSION_SECRET = prevSecret;
        }
    });

    // The archive is a write — it upserts Postgres and the signed link differs
    // on every call — so despite reading like a query none of this is read-only
    // or idempotent.
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
                        arguments: callToolArguments(name, args),
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
                                  password: "password1234",
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
                        arguments: callToolArguments(name, args),
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
        const flags = evaluateViewerFlags(
            buildFlagContext({
                auth: { kind: "household", householdId: "hh-1" },
                householdId: "hh-1",
            }),
            createMemoryFlags(allFlagsOn()),
        );
        registerTools(
            server,
            { kind: "household", householdId: "hh-1" },
            true,
            null,
            undefined,
            "http://localhost",
            true,
            flags,
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
                        arguments: callToolArguments(name, args),
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
                    unverified_recipe_expiry_days: null,
                    social_readers: { tiktok: false, facebook: false },
                },
                timezone: null,
                effective_timezone: "UTC",
                restock_enabled: false,
                restock_weekday: 6,
                restock_time: "07:00",
                restock_last_run_on: null,
                plurals_same_food: false,
            });
        });
    });

    test("plurals_same_food round-trips through config tools", async () => {
        await withHousehold(async (call) => {
            const written = await call("update_household_config", {
                plurals_same_food: true,
            });
            expect(written.isError).toBeFalsy();
            expect(written.structuredContent?.plurals_same_food).toBe(true);
            expect(db.pluralsSameFood).toBe(true);
            const got = await call("get_household_config");
            expect(got.structuredContent?.plurals_same_food).toBe(true);
        });
    });

    test("plurals_only update does not write household config", async () => {
        await withHousehold(async (call) => {
            db.household!.name = "Concurrent";
            db.householdConfigWrites = 0;
            await call("update_household_config", { plurals_same_food: true });
            expect(db.householdConfigWrites).toBe(0);
            expect(db.household!.name).toBe("Concurrent");
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
            recipeSearchPlaces: [],
            preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
        };
        await withHousehold(async (call) => {
            const r = await call("update_household_config", {
                recipe_search_places: [{ name: "X", kind: "warehouse" }],
            });
            expect(r.isError).toBe(true);
        });
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

    test("PAT restock and timezone fields round-trip", async () => {
        await withHousehold(async (call) => {
            const written = await call("update_household_config", {
                timezone: "Europe/Kyiv",
                restock_enabled: true,
                restock_weekday: 3,
                restock_time: "08:30",
            });
            expect(written.isError).toBeFalsy();
            expect(written.structuredContent).toMatchObject({
                timezone: "Europe/Kyiv",
                effective_timezone: "Europe/Kyiv",
                restock_enabled: true,
                restock_weekday: 3,
                restock_time: "08:30",
            });
        });
    });

    test("invalid timezone weekday and time error without write", async () => {
        await withHousehold(async (call) => {
            const before = structuredClone(db.household);
            for (const args of [
                { timezone: "Mars/Phobos" },
                { restock_weekday: 7 },
                { restock_weekday: 1.5 },
                { restock_time: "24:00" },
            ]) {
                const r = await call("update_household_config", args);
                expect(r.isError).toBe(true);
                if (
                    args.restock_weekday === 7 ||
                    args.restock_weekday === 1.5
                ) {
                    expect(textOf(r)).toContain(
                        "Pick a day from Sunday to Saturday",
                    );
                }
                expect(db.household).toEqual(before);
            }
            expect(db.household?.preferences.restock.enabled).toBe(false);
        });
    });

    test("restock_last_run_on in input is ignored", async () => {
        db.household = {
            name: "Home",
            recipeSearchPlaces: [],
            preferences: {
                ...EMPTY_HOUSEHOLD_PREFERENCES,
                restock: {
                    ...DEFAULT_RESTOCK,
                    lastRunOn: "2026-10-01",
                },
            },
        };
        await withHousehold(async (call) => {
            await call("update_household_config", {
                restock_enabled: true,
                restock_last_run_on: "2026-12-01",
            });
            const got = await call("get_household_config");
            expect(got.structuredContent?.restock_last_run_on).toBe(
                "2026-10-01",
            );
        });
    });

    test("get effective_timezone uses owner when household timezone null", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "America/Los_Angeles" };
        await withHousehold(async (call) => {
            const r = await call("get_household_config");
            expect(r.structuredContent?.effective_timezone).toBe(
                "America/Los_Angeles",
            );
        });
    });

    test("member update of restock settings is refused", async () => {
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
                restock_enabled: true,
            });
            expect(r.isError).toBe(true);
        });
        expect(db.household?.preferences.restock.enabled).toBe(false);
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

    describe("gated tools and flag-off tool list", () => {
        const snapshot = (async () =>
            (await Bun.file(
                new URL("./mcp/tools-list.snapshot.json", import.meta.url),
            ).json()) as string[])();

        function viewerFlagCtx() {
            return buildFlagContext({
                auth: { kind: "user", userId: "u1" },
                member: {
                    userId: "u1",
                    householdId: "hh-1",
                    role: "owner",
                    displayName: "Owner",
                },
            });
        }

        // The snapshot is the all-flags-on list. With a flag off, tools/list
        // is the snapshot minus exactly the gated tools left unregistered, in
        // the same order.
        async function listAgainstSnapshot(flags: ViewerFlags) {
            const { names, gated } = await toolNamesFor(flags);
            const hidden = new Set(
                gated.filter((e) => !e.registered).map((e) => e.name),
            );
            return {
                names,
                expected: (await snapshot).filter((name) => !hidden.has(name)),
            };
        }

        test("all flags off is the snapshot minus gated tools", async () => {
            const flags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags(allFlagsOff()),
            );
            const { names, expected } = await listAgainstSnapshot(flags);
            expect(names).toEqual(expected);
        });

        test("all flags on matches snapshot", async () => {
            const flags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags(allFlagsOn()),
            );
            const { names } = await toolNamesFor(flags);
            expect(names).toEqual(await snapshot);
        });

        test("registry defaults match snapshot", async () => {
            const flags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags(defaultFlags()),
            );
            const { names, expected } = await listAgainstSnapshot(flags);
            expect(names).toEqual(expected);
        });

        test("gatedTool stays out of tools/list when off and keeps neighbor order", async () => {
            const offFlags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags({ "ui-v2": false }),
            );
            const { names, gated } = await toolNamesFor(
                offFlags,
                (server, auth) => {
                    const ctx = createToolContext(
                        auth,
                        true,
                        null,
                        undefined,
                        "http://localhost",
                        true,
                        offFlags,
                    );
                    server.registerTool(
                        "test_tool_a",
                        {
                            title: "A",
                            description: "test",
                            inputSchema: z.object({
                                _ping: z.string().optional(),
                            }),
                        },
                        async (_args) => ({
                            content: [{ type: "text" as const, text: "a" }],
                        }),
                    );
                    gatedTool(
                        server,
                        ctx,
                        "ui-v2",
                        "test_gated_tool",
                        {
                            title: "Gated",
                            description: "test",
                            inputSchema: z.object({
                                _ping: z.string().optional(),
                            }),
                        },
                        async (_args) => ({
                            content: [{ type: "text" as const, text: "gated" }],
                        }),
                    );
                    server.registerTool(
                        "test_tool_b",
                        {
                            title: "B",
                            description: "test",
                            inputSchema: z.object({
                                _ping: z.string().optional(),
                            }),
                        },
                        async (_args) => ({
                            content: [{ type: "text" as const, text: "b" }],
                        }),
                    );
                    return ctx.gatedTools;
                },
            );
            expect(names).toEqual(["test_tool_a", "test_tool_b"]);
            expect(gated).toEqual([
                { name: "test_gated_tool", flag: "ui-v2", registered: false },
            ]);
        });

        test("gated tool off answers unknown-tool; on is listed and callable", async () => {
            const offFlags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags({ "ui-v2": false }),
            );
            const server = new McpServer(
                { name: "foodable-test", version: "0.0.0" },
                { capabilities: { tools: {}, resources: {} } },
            );
            const ctx = createToolContext(
                { kind: "user", userId: "u1" },
                true,
                null,
                undefined,
                "http://localhost",
                true,
                offFlags,
            );
            gatedTool(
                server,
                ctx,
                "ui-v2",
                "test_gated_tool",
                {
                    title: "Gated",
                    description: "test",
                    inputSchema: z.object({ _ping: z.string().optional() }),
                },
                async (_args) => ({
                    content: [{ type: "text" as const, text: "gated" }],
                }),
            );
            const [clientTransport, serverTransport] =
                InMemoryTransport.createLinkedPair();
            const client = new Client({
                name: "test-client",
                version: "0.0.0",
            });
            await Promise.all([
                server.connect(serverTransport),
                client.connect(clientTransport),
            ]);
            try {
                await expect(
                    client.callTool({
                        name: "test_gated_tool",
                        arguments: {},
                    }),
                ).rejects.toThrow(/not found/i);
            } finally {
                await client.close();
                await server.close();
            }

            const onFlags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags({ "ui-v2": true }),
            );
            const { names } = await toolNamesFor(onFlags, (server, auth) => {
                const ctxOn = createToolContext(
                    auth,
                    true,
                    null,
                    undefined,
                    "http://localhost",
                    true,
                    onFlags,
                );
                gatedTool(
                    server,
                    ctxOn,
                    "ui-v2",
                    "test_gated_tool",
                    {
                        title: "Gated",
                        description: "test",
                        inputSchema: z.object({ _ping: z.string().optional() }),
                    },
                    async () => ({
                        content: [{ type: "text", text: "gated" }],
                    }),
                );
                return ctxOn.gatedTools;
            });
            expect(names).toEqual(["test_gated_tool"]);
            const onServer = new McpServer(
                { name: "foodable-test", version: "0.0.0" },
                { capabilities: { tools: {}, resources: {} } },
            );
            const ctxOn = createToolContext(
                { kind: "user", userId: "u1" },
                true,
                null,
                undefined,
                "http://localhost",
                true,
                onFlags,
            );
            gatedTool(
                onServer,
                ctxOn,
                "ui-v2",
                "test_gated_tool",
                {
                    title: "Gated",
                    description: "test",
                    inputSchema: z.object({ _ping: z.string().optional() }),
                },
                async () => ({
                    content: [{ type: "text", text: "gated" }],
                }),
            );
            const [ct, st] = InMemoryTransport.createLinkedPair();
            const onClient = new Client({
                name: "test-client",
                version: "0.0.0",
            });
            await Promise.all([onServer.connect(st), onClient.connect(ct)]);
            try {
                const r = (await onClient.callTool({
                    name: "test_gated_tool",
                    arguments: {},
                })) as ToolResult;
                expect(r.isError).not.toBe(true);
                expect(textOf(r)).toBe("gated");
            } finally {
                await onClient.close();
                await onServer.close();
            }
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

    async function withRateProductFlag(
        on: boolean,
        run: (call: CallTool) => Promise<void>,
    ) {
        const member = db.members[0];
        const flagCtx = buildFlagContext({
            auth: { kind: "user", userId: "u1" },
            member: member
                ? {
                      userId: member.userId,
                      householdId: member.householdId,
                      role: member.role,
                      displayName: member.displayName,
                  }
                : undefined,
        });
        const flags = evaluateViewerFlags(
            flagCtx,
            createMemoryFlags({ "mcp-rate-product": on }),
        );
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            { kind: "user", userId: "u1" },
            true,
            null,
            undefined,
            "http://localhost",
            true,
            flags,
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
                        arguments: callToolArguments(name, args),
                    }) as Promise<ToolResult>,
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    async function seedMilkProduct(): Promise<string> {
        const food = newFood({
            householdId: "hh-1",
            kind: "food",
            name: "Milk Yogurt",
            brand: "Test",
            calories: 60,
            sugarG: 8,
            saturatedFatG: 2,
            offQuality: {
                nutriscoreGrade: "b",
                novaGroup: 3,
                ecoscoreGrade: "c",
                additives: null,
                allergensTags: ["en:milk"],
                tracesTags: null,
                ingredientsAnalysisTags: null,
                labelsTags: null,
                fetchedAt: "2026-11-09T12:00:00.000Z",
            },
        });
        await db.foodsStore.insertFood(food);
        return food.id;
    }

    describe("rate_product", () => {
        test("a gluten-only product warns the same in the catalog and by barcode", async () => {
            await addAllergen(db.rulesStore, {
                householdId: "hh-1",
                userId: "u1",
                allergen: "wheat",
            });
            const { findOrCreateFoodByBarcodeFromHit } =
                await import("./domain/foods.js");
            const hitFor = (barcode: string) => ({
                name: "Wheat Crackers",
                brand: "Test",
                serving: "100 g",
                serving_quantity: null,
                serving_quantity_unit: null,
                calories: 450,
                protein_g: 10,
                carbs_g: 70,
                fat_g: 12,
                fiber_g: 3,
                sugar_g: 2,
                saturated_fat_g: 1,
                alcohol_g: null,
                nutriscore_grade: "c",
                nova_group: 3,
                source: `off:${barcode}`,
                source_name: "openfoodfacts",
                barcode,
                allergens_tags: ["en:gluten"],
                nutrient_levels: null,
                quality: {
                    nutriscore_grade: "c",
                    nova_group: 3,
                    ecoscore_grade: null,
                    additives_tags: [],
                    allergens_tags: ["en:gluten"],
                    traces_tags: null,
                    ingredients_analysis_tags: null,
                    labels_tags: null,
                    fetched_at: "2026-11-09T12:00:00.000Z",
                },
            });
            const inCatalog = "4000000000017";
            const notInCatalog = "4000000000024";
            await findOrCreateFoodByBarcodeFromHit(
                db.foodsStore,
                "hh-1",
                inCatalog,
                hitFor(inCatalog) as never,
            );
            db.barcodeFoods[notInCatalog] = hitFor(notInCatalog) as never;
            await withRateProductFlag(true, async (call) => {
                for (const barcode of [inCatalog, notInCatalog]) {
                    const r = await call("rate_product", { barcode });
                    const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        r.structuredContent,
                    );
                    expect(
                        out.checks[0]!.notices.map((n) => [n.code, n.severity]),
                    ).toEqual([["food.product_gluten", "warn"]]);
                }
            });
        });

        test("flag off hides tool and rejects calls", async () => {
            const server = new McpServer(
                { name: "foodable-test", version: "0.0.0" },
                { capabilities: { tools: {}, resources: {} } },
            );
            const flagCtx = buildFlagContext({
                auth: { kind: "user", userId: "u1" },
            });
            const flags = evaluateViewerFlags(
                flagCtx,
                createMemoryFlags({ "mcp-rate-product": false }),
            );
            registerTools(
                server,
                { kind: "user", userId: "u1" },
                true,
                null,
                undefined,
                "http://localhost",
                true,
                flags,
            );
            const [ct, st] = InMemoryTransport.createLinkedPair();
            const client = new Client({
                name: "test-client",
                version: "0.0.0",
            });
            await Promise.all([server.connect(st), client.connect(ct)]);
            try {
                const list = (await client.listTools()).tools.map(
                    (t) => t.name,
                );
                expect(list).not.toContain("rate_product");
                await expect(
                    client.callTool({
                        name: "rate_product",
                        arguments: { barcode: "12345678" },
                    }),
                ).rejects.toThrow(/not found/i);
            } finally {
                await client.close();
                await server.close();
            }
        });

        test("a household-scoped off-lookups kill switch stops Open Food Facts requests", async () => {
            const barcode = "4000000000031";
            // A catalog food with no nutrition of its own looks its
            // barcode up too.
            const bare = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Bare Biscuits",
            });
            await db.foodsStore.insertFood(bare);
            await db.foodsStore.setBarcode("hh-1", "4000000000048", bare.id);
            db.realBarcodeLookup = true;
            const offRequests: string[] = [];
            const realFetch = globalThis.fetch;
            const realAgent = process.env.OFF_USER_AGENT;
            process.env.OFF_USER_AGENT = "Foodable (test@example.invalid)";
            globalThis.fetch = (async (input: string | URL | Request) => {
                const url = String(
                    input instanceof Request ? input.url : input,
                );
                if (url.includes("openfoodfacts")) offRequests.push(url);
                return new Response("{}", { status: 404 });
            }) as typeof fetch;
            try {
                // Off only for this household: a deploy-wide check would
                // still see it on and call Open Food Facts.
                for (const [offFor, expected] of [
                    ["hh-1", 0],
                    ["hh-other", 2],
                ] as const) {
                    offRequests.length = 0;
                    setFlagsForTests(
                        createMemoryFlags({
                            "off-lookups": (ctx) => ctx.household_id !== offFor,
                        }),
                    );
                    await withRateProductFlag(true, async (call) => {
                        const r = await call("rate_product", { barcode });
                        const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                            r.structuredContent,
                        );
                        expect(out.found).toBe(false);
                        const byFood = await call("rate_product", {
                            food_id: bare.id,
                        });
                        RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                            byFood.structuredContent,
                        );
                    });
                    expect({ offFor, requests: offRequests.length }).toEqual({
                        offFor,
                        requests: expected,
                    });
                }
            } finally {
                globalThis.fetch = realFetch;
                if (realAgent === undefined) delete process.env.OFF_USER_AGENT;
                else process.env.OFF_USER_AGENT = realAgent;
                resetFlagsForTests();
            }
        });

        test("food_id returns schema output with milk allergen block", async () => {
            await addAllergen(db.rulesStore, {
                householdId: "hh-1",
                userId: "u1",
                allergen: "milk",
            });
            const foodId = await seedMilkProduct();
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { food_id: foodId });
                expect(r.isError).toBeFalsy();
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.found).toBe(true);
                expect(out.checks).toHaveLength(1);
                expect(
                    out.checks[0]!.notices.some((n) => n.severity === "block"),
                ).toBe(true);
            });
        });

        test("catalogued per-serving product uses off cache for goal notices", async () => {
            db.goals = goals({ daily_calories: 2000, daily_sugar_g: 40 });
            const barcode = "5449000000996";
            const colaHit = {
                name: "Cola",
                brand: null,
                serving: "330 ml",
                serving_quantity: 330,
                serving_quantity_unit: "ml",
                calories: 139,
                protein_g: 0,
                carbs_g: 35,
                fat_g: 0,
                fiber_g: 0,
                sugar_g: 35,
                saturated_fat_g: 0,
                alcohol_g: null,
                nutriscore_grade: "e",
                nova_group: 4,
                source: `off:${barcode}`,
                source_name: "openfoodfacts",
                barcode,
                nutrient_levels: null,
                quality: {
                    nutriscore_grade: "e",
                    nova_group: 4,
                    ecoscore_grade: null,
                    additives_tags: [],
                    allergens_tags: [],
                    traces_tags: null,
                    ingredients_analysis_tags: null,
                    labels_tags: null,
                    fetched_at: "2026-11-09T12:00:00.000Z",
                },
            };
            db.barcodeFoods[barcode] = colaHit as never;
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Cola",
                calories: null,
                proteinG: null,
                carbsG: null,
                fatG: null,
                fiberG: null,
                sugarG: null,
                alcoholG: null,
                offQuality: colaHit.quality as never,
            });
            await db.foodsStore.insertFood(food);
            await db.foodsStore.setBarcode("hh-1", barcode, food.id);
            await withRateProductFlag(true, async (call) => {
                for (const args of [
                    { barcode },
                    { food_id: food.id },
                ] as const) {
                    const r = await call("rate_product", args);
                    const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        r.structuredContent,
                    );
                    const messages = out.checks[0]!.notices.map(
                        (n) => n.message,
                    );
                    expect(messages).toContain("35 g sugar, 40 g left today");
                }
            });
        });

        test("a per-serving barcode in ml still gives goal notices", async () => {
            db.goals = goals({ daily_calories: 2000, daily_sugar_g: 40 });
            const barcode = "5449000000996";
            db.barcodeFoods[barcode] = {
                name: "Cola",
                brand: null,
                serving: "330 ml",
                serving_quantity: 330,
                serving_quantity_unit: "ml",
                calories: 139,
                protein_g: 0,
                carbs_g: 35,
                fat_g: 0,
                fiber_g: 0,
                sugar_g: 35,
                saturated_fat_g: 0,
                alcohol_g: null,
                nutriscore_grade: "e",
                nova_group: 4,
                source: `off:${barcode}`,
                source_name: "openfoodfacts",
                barcode,
                nutrient_levels: null,
                quality: {
                    nutriscore_grade: "e",
                    nova_group: 4,
                    ecoscore_grade: null,
                    additives_tags: [],
                    allergens_tags: [],
                    traces_tags: null,
                    ingredients_analysis_tags: null,
                    labels_tags: null,
                    fetched_at: "2026-11-09T12:00:00.000Z",
                },
            } as never;
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { barcode });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                const messages = out.checks[0]!.notices.map((n) => n.message);
                expect(messages).toContain("35 g sugar, 40 g left today");
            });
        });

        test("barcode resolves off cache without creating a food", async () => {
            const barcode = "4006381333931";
            db.barcodeFoods[barcode] = {
                name: "Nutella",
                brand: "Ferrero",
                serving: "15 g",
                serving_quantity: 15,
                serving_quantity_unit: "g",
                calories: 80,
                protein_g: 1,
                carbs_g: 8.5,
                fat_g: 4.6,
                fiber_g: 0.5,
                sugar_g: 8.4,
                saturated_fat_g: 1.5,
                alcohol_g: null,
                nutriscore_grade: "e",
                nova_group: 4,
                source: `off:${barcode}`,
                source_name: "openfoodfacts",
                barcode,
                nutrient_levels: { sugars: "high" },
                quality: {
                    nutriscore_grade: "e",
                    nova_group: 4,
                    ecoscore_grade: "d",
                    additives_tags: ["en:e322"],
                    allergens_tags: ["en:nuts", "en:milk"],
                    traces_tags: null,
                    ingredients_analysis_tags: null,
                    labels_tags: null,
                    fetched_at: "2026-11-09T12:00:00.000Z",
                },
            };
            const before = (await db.foodsStore.listFoods("hh-1")).length;
            db.goals = goals({ daily_sugar_g: 40 });
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { barcode });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.found).toBe(true);
                expect(out.product.food_id).toBeNull();
                expect(out.product.barcode).toBe(barcode);
                expect(out.info_rows[0]!.per_100g).toBeNull();
                expect(out.info_rows[0]!.level).toBe("high");
                const sugarGoal = out.checks[0]!.notices.find(
                    (n) =>
                        n.code === "food.product_goal" &&
                        n.message.includes("sugar"),
                );
                expect(sugarGoal).toBeDefined();
                expect(sugarGoal!.message).toContain("8.4 g sugar");
            });
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(before);
        });

        test("catalog milk allergen blocks when offQuality is missing", async () => {
            await addAllergen(db.rulesStore, {
                householdId: "hh-1",
                userId: "u1",
                allergen: "milk",
            });
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Creamer",
                allergens: ["milk"],
                offQuality: null,
            });
            await db.foodsStore.insertFood(food);
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { food_id: food.id });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(
                    out.checks[0]!.notices.some((n) => n.severity === "block"),
                ).toBe(true);
            });
        });

        test("gramsPerEach drives goal notice from per-100g macros", async () => {
            db.goals = goals({ daily_sugar_g: 30 });
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Sweet Bar",
                sugarG: 50,
                gramsPerEach: 40,
            });
            await db.foodsStore.insertFood(food);
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { food_id: food.id });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                const goal = out.checks[0]!.notices.find(
                    (n) => n.code === "food.product_goal",
                );
                expect(goal?.message).toContain("20 g sugar");
                expect(goal?.message).toContain("30 g left today");
            });
        });

        test("no alcohol goal notice while alcohol display is off", async () => {
            db.goals = goals({ daily_calories: 2000, daily_alcohol_g: 20 });
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Lager",
                alcoholG: 4,
                gramsPerEach: 330,
            });
            await db.foodsStore.insertFood(food);
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { food_id: food.id });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                const messages = out.checks[0]!.notices.map((n) => n.message);
                expect(messages.some((m) => m.includes("alcohol"))).toBe(false);
            });
        });

        test("missing food_id returns found false", async () => {
            const missing = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { food_id: missing });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.found).toBe(false);
            });
        });

        test("archived household barcode falls through to off cache", async () => {
            const barcode = "3017620422003";
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Archived Jar",
            });
            food.archivedAt = "2026-11-09T12:00:00.000Z";
            await db.foodsStore.insertFood(food);
            await db.foodsStore.setBarcode("hh-1", barcode, food.id);
            db.barcodeFoods[barcode] = {
                name: "Off Jar",
                brand: "Test",
                serving: "15 g",
                serving_quantity: 15,
                serving_quantity_unit: "g",
                calories: 80,
                protein_g: 1,
                carbs_g: 8.5,
                fat_g: 4.6,
                fiber_g: 0.5,
                sugar_g: 8.4,
                saturated_fat_g: 1.5,
                alcohol_g: null,
                nutriscore_grade: "e",
                nova_group: 4,
                source: `off:${barcode}`,
                source_name: "openfoodfacts",
                barcode,
            };
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", { barcode });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.found).toBe(true);
                expect(out.product.name).toBe("Off Jar");
                expect(out.product.food_id).toBeNull();
            });
        });

        test("user_id narrows checks to one member", async () => {
            db.members = [
                {
                    householdId: "hh-1",
                    userId: "u1",
                    role: "owner",
                    displayName: "Alex",
                },
                {
                    householdId: "hh-1",
                    userId: "u2",
                    role: "member",
                    displayName: "Bob",
                },
            ];
            await addAllergen(db.rulesStore, {
                householdId: "hh-1",
                userId: "u1",
                allergen: "milk",
            });
            const foodId = await seedMilkProduct();
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", {
                    food_id: foodId,
                    user_id: "u2",
                });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.checks).toHaveLength(1);
                expect(out.checks[0]!.user_id).toBe("u2");
                expect(
                    out.checks[0]!.notices.some((n) => n.severity === "block"),
                ).toBe(false);
            });
        });

        describe("the viewer's score weights", () => {
            const PROCESSING_ONLY = {
                nutrition: 0,
                processing: 100,
                additives: 0,
                environment: 0,
            };

            async function seedProcessedProduct(): Promise<string> {
                const food = newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name: "Fizzy Bar",
                    offQuality: {
                        nutriscoreGrade: "a",
                        novaGroup: 4,
                        ecoscoreGrade: "b",
                        additives: null,
                        allergensTags: null,
                        tracesTags: ["en:peanuts"],
                        ingredientsAnalysisTags: null,
                        labelsTags: null,
                        fetchedAt: "2026-11-09T12:00:00.000Z",
                    },
                });
                await db.foodsStore.insertFood(food);
                return food.id;
            }

            function twoMembers() {
                db.members = [
                    {
                        householdId: "hh-1",
                        userId: "u1",
                        role: "owner",
                        displayName: "Alex",
                    },
                    {
                        householdId: "hh-1",
                        userId: "u2",
                        role: "member",
                        displayName: "Bob",
                    },
                ];
            }

            test("the caller's own weights score the product", async () => {
                const foodId = await seedProcessedProduct();
                let byDefault: number | null = null;
                await withRateProductFlag(true, async (call) => {
                    const r = await call("rate_product", { food_id: foodId });
                    const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        r.structuredContent,
                    );
                    expect(out.preset).toBe("balanced");
                    byDefault = out.score;
                });
                await updateMemberScoreSettings(
                    db.scoreSettingsStore,
                    "hh-1",
                    "u1",
                    {
                        choice: {
                            preset: "custom",
                            weights: PROCESSING_ONLY,
                        },
                    },
                );
                await withRateProductFlag(true, async (call) => {
                    const r = await call("rate_product", { food_id: foodId });
                    const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        r.structuredContent,
                    );
                    expect(out.preset).toBe("custom");
                    expect(out.score).not.toBe(byDefault);
                    expect(
                        out.breakdown.find((row) => row.part === "processing")
                            ?.weight,
                    ).toBe(1);
                });
            });

            test("a member without a choice gets the household default", async () => {
                const foodId = await seedProcessedProduct();
                await updateHouseholdScoreDefault(
                    db.scoreSettingsStore,
                    "hh-1",
                    { preset: "planet", weights: null },
                );
                await withRateProductFlag(true, async (call) => {
                    const r = await call("rate_product", { food_id: foodId });
                    const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        r.structuredContent,
                    );
                    expect(out.preset).toBe("planet");
                });
            });

            test("user_id uses that member's weights and switches, not the caller's", async () => {
                twoMembers();
                await addAllergen(db.rulesStore, {
                    householdId: "hh-1",
                    userId: "u2",
                    allergen: "peanut",
                });
                const foodId = await seedProcessedProduct();
                await updateMemberScoreSettings(
                    db.scoreSettingsStore,
                    "hh-1",
                    "u2",
                    {
                        choice: {
                            preset: "custom",
                            weights: PROCESSING_ONLY,
                        },
                    },
                );
                await withRateProductFlag(true, async (call) => {
                    const own = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        (await call("rate_product", { food_id: foodId }))
                            .structuredContent,
                    );
                    const bob = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        (
                            await call("rate_product", {
                                food_id: foodId,
                                user_id: "u2",
                            })
                        ).structuredContent,
                    );
                    expect(own.preset).toBe("balanced");
                    expect(bob.preset).toBe("custom");
                    expect(bob.score).not.toBe(own.score);
                    const traces = (out: typeof bob): string[] =>
                        out.checks
                            .flatMap((c) => c.notices)
                            .map((n) => n.code)
                            .filter((code) => code === "food.product_trace");
                    expect(traces(bob)).toHaveLength(1);
                });
                await updateMemberScoreSettings(
                    db.scoreSettingsStore,
                    "hh-1",
                    "u2",
                    { warnTraces: false },
                );
                await withRateProductFlag(true, async (call) => {
                    const bob = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        (
                            await call("rate_product", {
                                food_id: foodId,
                                user_id: "u2",
                            })
                        ).structuredContent,
                    );
                    expect(
                        bob.checks
                            .flatMap((c) => c.notices)
                            .some((n) => n.code === "food.product_trace"),
                    ).toBe(false);
                    // the choice is kept when only a switch changes
                    expect(bob.preset).toBe("custom");
                });
            });

            test("compare with today's goals off drops the goals notice", async () => {
                db.goals = goals({ daily_sugar_g: 30 });
                const food = newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name: "Sweet Bar",
                    sugarG: 50,
                    gramsPerEach: 40,
                });
                await db.foodsStore.insertFood(food);
                const goalNotices = async () => {
                    let found = 0;
                    await withRateProductFlag(true, async (call) => {
                        const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                            (await call("rate_product", { food_id: food.id }))
                                .structuredContent,
                        );
                        found = out.checks
                            .flatMap((c) => c.notices)
                            .filter(
                                (n) => n.code === "food.product_goal",
                            ).length;
                    });
                    return found;
                };
                expect(await goalNotices()).toBe(1);
                await updateMemberScoreSettings(
                    db.scoreSettingsStore,
                    "hh-1",
                    "u1",
                    { compareGoals: false },
                );
                expect(await goalNotices()).toBe(0);
            });
        });

        test("rejects user_id from another household", async () => {
            const other = "22222222-2222-4222-8222-222222222222";
            db.members.push({
                householdId: "hh-2",
                userId: other,
                role: "owner",
                displayName: "Elsewhere",
            });
            const foodId = await seedMilkProduct();
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", {
                    food_id: foodId,
                    user_id: other,
                });
                expect(r.isError).toBe(true);
                expect(textOf(r)).toContain("not a household member");
            });
        });

        test("unknown barcode returns found false", async () => {
            await withRateProductFlag(true, async (call) => {
                const r = await call("rate_product", {
                    barcode: "9999888877776",
                });
                const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.found).toBe(false);
            });
        });
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
                        arguments: callToolArguments(name, args),
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
                        arguments: callToolArguments(name, args),
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

    test("add_fridge_item returns similar_foods without writing", async () => {
        await withPat(async (call) => {
            await call("upsert_food", { name: "Eggs" });
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const foodBefore = (await db.foodsStore.listFoods("hh-1")).length;
            const before = (await db.fridgeStore.listItems("hh-1")).length;
            const r = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                name: "egg",
                amount: 2,
                on_similar: "ask",
            });
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.status).toBe("similar_foods");
            ADD_FRIDGE_ITEM_OUTPUT_SCHEMA.parse(r.structuredContent);
            expect((await db.fridgeStore.listItems("hh-1")).length).toBe(
                before,
            );
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(
                foodBefore,
            );
            const created = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                name: "egg",
                amount: 2,
                on_similar: "ask",
                new_food: true,
            });
            expect(created.structuredContent?.status).toBe("ok");
            expect(created.structuredContent?.similar_foods).toEqual([]);
            ADD_FRIDGE_ITEM_OUTPUT_SCHEMA.parse(created.structuredContent);
            const forced = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                name: "egg white",
                amount: 1,
                on_similar: "create",
            });
            expect(forced.structuredContent?.status).toBe("ok");
            ADD_FRIDGE_ITEM_OUTPUT_SCHEMA.parse(forced.structuredContent);
        });
    });

    test("similar_foods on grocery, recipe, meal, upsert, and import tools", async () => {
        await withPat(async (call) => {
            await call("upsert_food", { name: "Eggs" });
            await call("upsert_food", { name: "Milk" });
            await createGroceryStore(db.settingsStore, "hh-1", "Store");
            const foodBefore = (await db.foodsStore.listFoods("hh-1")).length;
            const groceryBefore = (await db.groceryStore.listLines("hh-1"))
                .length;
            const groceryAsk = await call("add_grocery_line", {
                kind: "food",
                name: "whole milk",
                on_similar: "ask",
            });
            expect(groceryAsk.isError).toBeFalsy();
            expect(groceryAsk.structuredContent?.status).toBe("similar_foods");
            ADD_GROCERY_LINE_OUTPUT_SCHEMA.parse(groceryAsk.structuredContent);
            expect((await db.groceryStore.listLines("hh-1")).length).toBe(
                groceryBefore,
            );
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(
                foodBefore,
            );

            const recipe = await call("create_recipe", {
                name: "Test",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            const ingBefore = (
                await db.recipesStore.listIngredients("hh-1", recipeId)
            ).length;
            const ingAsk = await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                name: "chicken egg",
                on_similar: "ask",
            });
            expect(ingAsk.structuredContent?.status).toBe("similar_foods");
            ADD_RECIPE_INGREDIENT_OUTPUT_SCHEMA.parse(ingAsk.structuredContent);
            expect(
                (await db.recipesStore.listIngredients("hh-1", recipeId))
                    .length,
            ).toBe(ingBefore);
            const ingNew = await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                name: "egg",
                on_similar: "ask",
                new_food: true,
            });
            expect(ingNew.structuredContent?.status).toBe("ok");
            ADD_RECIPE_INGREDIENT_OUTPUT_SCHEMA.parse(ingNew.structuredContent);

            const groceryNew = await call("add_grocery_line", {
                kind: "food",
                name: "egg",
                on_similar: "ask",
                new_food: true,
            });
            expect(groceryNew.structuredContent?.status).toBe("ok");
            ADD_GROCERY_LINE_OUTPUT_SCHEMA.parse(groceryNew.structuredContent);

            const recipeBefore = (await db.recipesStore.listRecipes("hh-1"))
                .length;
            const foodBeforeImport = (await db.foodsStore.listFoods("hh-1"))
                .length;
            const importAsk = await call("import_recipe_from_text", {
                name: "Dup",
                text: "Dup",
                ingredients: [{ name: "chicken egg" }, { name: "whole milk" }],
                on_similar: "ask",
            });
            expect(importAsk.structuredContent?.status).toBe("similar_foods");
            const parsedImport = IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA.parse(
                importAsk.structuredContent,
            );
            expect(parsedImport.similar_foods.map((e) => e.name)).toEqual([
                "chicken egg",
                "whole milk",
            ]);
            expect((await db.recipesStore.listRecipes("hh-1")).length).toBe(
                recipeBefore,
            );
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(
                foodBeforeImport,
            );
        });
        await withPat(async (call) => {
            const branded = await call("upsert_food", {
                name: "All-purpose flour",
                brand: "King Arthur",
            });
            const foodBefore = (await db.foodsStore.listFoods("hh-1")).length;
            // No on_similar value: the tool's own default ("ask") applies.
            const upsertAsk = await call("upsert_food", {
                name: "all purpose flour",
                on_similar: undefined,
            });
            expect(upsertAsk.isError).toBeFalsy();
            expect(upsertAsk.structuredContent?.status).toBe("similar_foods");
            const parsedAsk = UPSERT_FOOD_OUTPUT.parse(
                upsertAsk.structuredContent,
            );
            expect(
                parsedAsk.similar_foods[0]?.candidates.map((c) => c.food_id),
            ).toEqual([branded.structuredContent?.id as string]);
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(
                foodBefore,
            );
            const upsertCreate = await call("upsert_food", {
                name: "all purpose flour",
                on_similar: "create",
            });
            expect(upsertCreate.structuredContent?.status).toBe("ok");
            UPSERT_FOOD_OUTPUT.parse(upsertCreate.structuredContent);
        });
        await withUser(alice, async (call) => {
            await call("upsert_food", { name: "Eggs" });
            const mealsBefore = db.inserted.length;
            const foodBeforeMeal = (await db.foodsStore.listFoods("hh-1"))
                .length;
            const mealAsk = await call("log_meal", {
                description: "Snack",
                meal_type: "snack",
                items: [{ name: "chicken egg" }],
                on_similar: "ask",
            });
            expect(mealAsk.isError).toBeFalsy();
            expect(mealAsk.structuredContent?.status).toBe("similar_foods");
            expect(mealAsk.structuredContent?.similar_foods).not.toEqual([]);
            MEAL_PROGRESS_OUTPUT_SCHEMA.parse(mealAsk.structuredContent);
            expect(db.inserted.length).toBe(mealsBefore);
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(
                foodBeforeMeal,
            );
            const mealNew = await call("log_meal", {
                description: "Snack",
                meal_type: "snack",
                items: [{ name: "egg", new_food: true }],
                on_similar: "ask",
            });
            expect(mealNew.structuredContent?.status).toBe("ok");
            expect(mealNew.structuredContent?.similar_foods).toEqual([]);
            MEAL_PROGRESS_OUTPUT_SCHEMA.parse(mealNew.structuredContent);
            const mealCreate = await call("log_meal", {
                description: "Snack 2",
                meal_type: "snack",
                items: [{ name: "egg salad" }],
                on_similar: "create",
            });
            expect(mealCreate.structuredContent?.status).toBe("ok");
            MEAL_PROGRESS_OUTPUT_SCHEMA.parse(mealCreate.structuredContent);
            await call("log_meal", {
                description: "Base",
                meal_type: "lunch",
                calories: 100,
            });
            const updated = await call("update_meal", {
                id: "m1",
                description: "Base edit",
            });
            expect(updated.structuredContent?.status).toBe("ok");
            MEAL_PROGRESS_OUTPUT_SCHEMA.parse(updated.structuredContent);
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

    test("get_recipe lists macro gaps for no-nutrition ingredients", async () => {
        await withUser(alice, async (call) => {
            const plain = await call("upsert_food", { name: "Half and half" });
            const plainId = plain.structuredContent?.id as string;
            await call("upsert_food", {
                food_id: plainId,
                grams_per_ml: 1,
            });
            const recipe = await call("create_recipe", {
                name: "Coffee",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: plainId,
                amount: 60,
                unit: "ml",
            });
            const got = await call("get_recipe", { id: recipeId });
            expect(got.isError).toBeFalsy();
            MACROS_ITEM_OUTPUT_SCHEMA.parse(
                got.structuredContent?.macros_per_portion,
            );
            const sc = got.structuredContent as {
                notices: Array<{ code: string }>;
                macros_per_portion: { incomplete: boolean };
            };
            expect(sc.macros_per_portion.incomplete).toBe(true);
            expect(
                sc.notices.some((n) => n.code === "recipe.no_nutrition"),
            ).toBe(true);
            expect(textOf(got)).toContain(
                "Half and half: no nutrition — add it, or pick a usual product",
            );
        });
    });

    test("get_recipe names gaps when some ingredients have nutrition", async () => {
        await withUser(alice, async (call) => {
            const oats = await call("upsert_food", {
                name: "Rolled oats",
                calories: 389,
                protein_g: 17,
                carbs_g: 66,
                fat_g: 7,
            });
            const half = await call("upsert_food", {
                name: "Half and half",
                grams_per_ml: 1,
            });
            const recipe = await call("create_recipe", {
                name: "Porridge",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            for (const [food, amount, unit] of [
                [oats, 50, "g"],
                [half, 60, "ml"],
            ] as const) {
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: food.structuredContent?.id as string,
                    amount,
                    unit,
                });
            }
            const got = await call("get_recipe", { id: recipeId });
            const macros = MACROS_ITEM_OUTPUT_SCHEMA.parse(
                got.structuredContent?.macros_per_portion,
            );
            expect(macros.calories).toBe(194.5);
            expect(macros.incomplete).toBe(true);
            expect(textOf(got)).toContain(
                "Per portion: 194.5 kcal, incomplete (Half and half: no nutrition — add it, or pick a usual product)",
            );
        });
    });

    test("get_recipe returns instructions as numbered steps", async () => {
        await withUser(alice, async (call) => {
            const recipe = await call("create_recipe", {
                name: "Toast",
                yield_portions: 1,
                instructions: "1. Toast the bread\n2. Butter it",
            });
            const recipeId = recipe.structuredContent?.id as string;
            const got = await call("get_recipe", { id: recipeId });
            expect(got.isError).toBeFalsy();
            expect(got.structuredContent?.steps).toEqual([
                "Toast the bread",
                "Butter it",
            ]);
            expect(textOf(got)).toContain(
                "Method:\n1. Toast the bread\n2. Butter it",
            );
            const cleared = await call("update_recipe", {
                id: recipeId,
                instructions: null,
            });
            expect(cleared.isError).toBeFalsy();
            const empty = await call("get_recipe", { id: recipeId });
            expect(empty.structuredContent?.steps).toEqual([]);
            expect(textOf(empty)).not.toContain("Method:");
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
                    generic_food_id: null,
                    generic_food_name: null,
                }),
            ]);
        });
    });

    test("upsert_food by name reuses a punctuation variant without renaming it", async () => {
        await withPat(async (call) => {
            const flour = await call("upsert_food", {
                name: "All-purpose flour",
            });
            const flourId = flour.structuredContent?.id as string;
            const before = (await db.foodsStore.listFoods("hh-1")).length;
            const again = await call("upsert_food", {
                name: "All purpose flour",
                calories: 364,
            });
            expect(again.isError).toBeFalsy();
            expect(again.structuredContent?.id).toBe(flourId);
            expect(again.structuredContent?.name).toBe("All-purpose flour");
            expect(again.structuredContent?.calories).toBe(364);
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(before);
            const renamed = await call("upsert_food", {
                food_id: flourId,
                name: "All purpose flour",
            });
            expect(renamed.structuredContent?.name).toBe("All purpose flour");
        });
    });

    test("search_food word-matches household foods across punctuation and brand", async () => {
        await withPat(async (call) => {
            await call("upsert_food", {
                name: "Half & Half",
                brand: "Members Mark",
            });
            const r = await call("search_food", {
                query: "Member's Mark half and half",
            });
            expect(r.isError).toBeFalsy();
            expect(r.structuredContent?.foods).toEqual([
                expect.objectContaining({
                    name: "Half & Half",
                    brand: "Members Mark",
                    source: "household",
                }),
            ]);
        });
    });

    test("set_usual_product links a standalone product and sets the usual", async () => {
        await withPat(async (call) => {
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const brand = await call("upsert_food", {
                name: "Kirkland Large Eggs",
                brand: "Kirkland",
                calories: 140,
                protein_g: 12,
            });
            const productId = brand.structuredContent?.id as string;
            FOOD_OUTPUT.parse(brand.structuredContent);
            expect(brand.structuredContent?.generic_food_id).toBeNull();
            const set = await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: productId,
            });
            expect(set.isError).toBeFalsy();
            FOOD_OUTPUT.parse(set.structuredContent);
            expect(set.structuredContent?.usual_product_id).toBe(productId);
            const linked = await call("get_food", { food_id: productId });
            expect(linked.structuredContent?.generic_food_id).toBe(eggsId);
        });
    });

    test("link_product with food_id null unlinks", async () => {
        await withPat(async (call) => {
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const brand = await call("upsert_food", {
                name: "Store Eggs",
                calories: 130,
            });
            const productId = brand.structuredContent?.id as string;
            await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: productId,
            });
            const unlinked = await call("link_product", {
                product_food_id: productId,
                food_id: null,
            });
            expect(unlinked.isError).toBeFalsy();
            FOOD_OUTPUT.parse(unlinked.structuredContent);
            expect(unlinked.structuredContent?.generic_food_id).toBeNull();
            const plain = await call("get_food", { food_id: eggsId });
            expect(plain.structuredContent?.usual_product_id).toBeNull();
        });
    });

    test("link_product rejects linking a product to a product", async () => {
        await withPat(async (call) => {
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const a = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Brand A",
                calories: 100,
            });
            const b = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Brand B",
                calories: 110,
            });
            const r = await call("link_product", {
                product_food_id: b.structuredContent?.id as string,
                food_id: a.structuredContent?.id as string,
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("product of another food");
        });
    });

    test("get_food returns products, usual_product_id, and effective nutrition", async () => {
        await withPat(async (call) => {
            const eggs = await call("upsert_food", {
                name: "Eggs",
                calories: 10,
            });
            const eggsId = eggs.structuredContent?.id as string;
            const brand = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Kirkland Eggs",
                calories: 155,
                protein_g: 13,
            });
            const productId = brand.structuredContent?.id as string;
            await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: productId,
            });
            const got = await call("get_food", { food_id: eggsId });
            expect(got.isError).toBeFalsy();
            const payload = GET_FOOD_OUTPUT.parse(got.structuredContent);
            expect(payload.calories).toBe(10);
            expect(payload.usual_product_id).toBe(productId);
            expect(payload.effective.calories).toBe(155);
            expect(payload.effective.protein_g).toBe(13);
            expect(payload.products).toEqual([
                expect.objectContaining({
                    id: productId,
                    usual: true,
                }),
            ]);
        });
    });

    test("usual purchase: set_usual_product, upsert_food, get_food effective, add_grocery_line pick text", async () => {
        await withPat(async (call) => {
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Safeway",
            );
            const second = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Costco",
            );
            const eggs = await call("upsert_food", {
                name: "Milk",
                default_unit: "ml",
            });
            const milkId = eggs.structuredContent?.id as string;
            const patch = await call("upsert_food", {
                food_id: milkId,
                usual_store_id: store.id,
                usual_amount: 2000,
                usual_unit: "ml",
            });
            expect(patch.isError).toBeFalsy();
            const patched = FOOD_OUTPUT.parse(patch.structuredContent);
            expect(patched.usual_store_id).toBe(store.id);
            expect(patched.usual_amount).toBe(2000);
            expect(patched.usual_unit).toBe("ml");

            const brand = await call("upsert_food", {
                generic_food_id: milkId,
                name: "Organic Milk",
                calories: 50,
            });
            const productId = brand.structuredContent?.id as string;
            const set = await call("set_usual_product", {
                food_id: milkId,
                product_food_id: productId,
                store_id: second.id,
                amount: 1890,
                unit: "ml",
            });
            expect(set.isError).toBeFalsy();
            const prodRow = await db.foodsStore.getFood("hh-1", productId);
            expect(prodRow?.usualStoreId).toBe(second.id);
            expect(prodRow?.usualAmount).toEqual({ amount: 1890, unit: "ml" });

            const got = await call("get_food", { food_id: milkId });
            const full = GET_FOOD_OUTPUT.parse(got.structuredContent);
            expect(full.usual_store_id).toBe(store.id);
            expect(full.effective.usual_store_id).toBe(second.id);
            expect(full.effective.usual_amount).toBe(1890);
            expect(full.effective.usual_unit).toBe("ml");

            const line = await call("add_grocery_line", {
                kind: "food",
                food_id: milkId,
            });
            expect(line.isError).toBeFalsy();
            expect(textOf(line)).toContain("usual store");
            expect(textOf(line)).toContain("usual amount");
            expect(line.structuredContent?.store_id).toBe(second.id);
        });
    });

    test("upsert_food create saves a usual store and amount, on a new food and a new product", async () => {
        await withPat(async (call) => {
            const shop = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Trader Joe's",
            );
            const created = await call("upsert_food", {
                name: `Oat milk ${crypto.randomUUID()}`,
                calories: 40,
                usual_store_id: shop.id,
                usual_amount: 1000,
                usual_unit: "ml",
            });
            expect(created.isError).toBeFalsy();
            const food = FOOD_OUTPUT.parse(created.structuredContent);
            expect(food.calories).toBe(40);
            expect(food.usual_store_id).toBe(shop.id);
            expect(food.usual_amount).toBe(1000);
            expect(food.usual_unit).toBe("ml");

            const product = await call("upsert_food", {
                generic_food_id: food.id,
                name: `Oatly ${crypto.randomUUID()}`,
                calories: 46,
                usual_store_id: shop.id,
                usual_amount: 2,
                usual_unit: "each",
            });
            expect(product.isError).toBeFalsy();
            const row = await db.foodsStore.getFood(
                "hh-1",
                product.structuredContent?.id as string,
            );
            expect(row?.genericFoodId).toBe(food.id);
            expect(row?.calories).toBe(46);
            expect(row?.usualStoreId).toBe(shop.id);
            expect(row?.usualAmount).toEqual({ amount: 2, unit: "each" });
        });
    });

    test("upsert_food create with bad usual unit creates no food", async () => {
        await withPat(async (call) => {
            const before = await db.foodsStore.listFoods("hh-1");
            const r = await call("upsert_food", {
                name: `Badusual-${crypto.randomUUID()}`,
                usual_amount: 1,
                usual_unit: "nope",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain(
                "Pick a known unit for the usual amount.",
            );
            expect(await db.foodsStore.listFoods("hh-1")).toEqual(before);
        });
    });

    test("get_food: stored usual null on plain, effective from usual product", async () => {
        await withPat(async (call) => {
            const costco = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Costco",
            );
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const brand = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "K Eggs",
                calories: 100,
            });
            const productId = brand.structuredContent?.id as string;
            await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: productId,
                store_id: costco.id,
                amount: 12,
                unit: "each",
            });
            const plainRow = await db.foodsStore.getFood("hh-1", eggsId);
            expect(plainRow?.usualStoreId).toBeNull();
            expect(plainRow?.usualAmount).toBeNull();
            const got = await call("get_food", { food_id: eggsId });
            const full = GET_FOOD_OUTPUT.parse(got.structuredContent);
            expect(full.usual_store_id).toBeNull();
            expect(full.usual_amount).toBeNull();
            expect(full.usual_unit).toBeNull();
            expect(full.effective.usual_store_id).toBe(costco.id);
            expect(full.effective.usual_amount).toBe(12);
            expect(full.effective.usual_unit).toBe("each");
        });
    });

    test("list_grocery_lines returns manual and recipe source on each line", async () => {
        await withPat(async (call) => {
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Safeway",
            );
            const recipe = await call("create_recipe", {
                name: "Pancakes",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            const flour = await call("upsert_food", { name: "Flour" });
            const flourId = flour.structuredContent?.id as string;
            const butter = await call("upsert_food", { name: "Butter" });
            const butterId = butter.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: flourId,
                amount: 100,
                unit: "g",
            });
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: butterId,
                amount: 10,
                unit: "g",
            });
            await call("add_grocery_line", {
                kind: "food",
                food_id: butterId,
            });
            const added = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: store.id,
                total_portions: 1,
            });
            expect(added.isError).toBeFalsy();
            const listed = await call("list_grocery_lines");
            expect(listed.isError).toBeFalsy();
            const body = GROCERY_LIST_OUTPUT_SCHEMA.parse(
                listed.structuredContent,
            );
            const lines = body.stores.flatMap((s) =>
                s.sections.flatMap((sec) => sec.lines),
            );
            expect(lines.length).toBeGreaterThanOrEqual(2);
            const manual = lines.find((row) => row.source === "manual");
            const fromRecipe = lines.find((row) => row.source === "recipe");
            expect(manual).toBeDefined();
            expect(fromRecipe).toBeDefined();
            for (const row of lines) {
                expect(row.source_fridge_item_id).toBeNull();
            }
        });
    });

    test("add_grocery_line with only food: structured content and store name", async () => {
        await withPat(async (call) => {
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Safeway",
            );
            const created = await call("upsert_food", { name: "Oats" });
            expect(created.isError).toBeFalsy();
            const foodId = created.structuredContent?.id as string;
            const patched = await call("upsert_food", {
                food_id: foodId,
                usual_store_id: store.id,
                usual_amount: 500,
                usual_unit: "g",
            });
            expect(patched.isError).toBeFalsy();
            const line = await call("add_grocery_line", {
                kind: "food",
                food_id: foodId,
            });
            expect(line.isError).toBeFalsy();
            expect(line.structuredContent?.store_id).toBe(store.id);
            expect(line.structuredContent?.amount).toBe(500);
            expect(line.structuredContent?.unit).toBe("g");
            const t = textOf(line);
            expect(t).toContain("Safeway");
            expect(t).toContain("500");
            expect(t).toContain("g");
        });
    });

    test("set_usual_product text mentions saved store and amount", async () => {
        await withPat(async (call) => {
            const st = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Walmart",
            );
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const brand = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Brand A",
                calories: 100,
            });
            const productId = brand.structuredContent?.id as string;
            const set = await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: productId,
                store_id: st.id,
                amount: 18,
                unit: "each",
            });
            expect(set.isError).toBeFalsy();
            const txt = textOf(set);
            expect(txt).toContain("Walmart");
            expect(txt).toContain("18");
            expect(txt).toContain("each");
        });
    });

    test("the usual tools keep the usual's schedule", async () => {
        await withPat(async (call) => {
            const costco = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Costco",
            );
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const kirkland = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Kirkland Large Eggs",
                brand: "Kirkland",
                calories: 140,
            });
            const productId = kirkland.structuredContent?.id as string;
            const plain = (await db.foodsStore.getFood("hh-1", eggsId))!;
            await db.foodsStore.updateFoodRow({ ...plain, ...USUAL_SCHEDULED });
            const keptSchedule = async () => {
                const row = await db.foodsStore.getFood("hh-1", eggsId);
                return {
                    restockSchedule: row?.restockSchedule,
                    restockEveryWeeks: row?.restockEveryWeeks,
                    restockPaused: row?.restockPaused,
                    restockWhenLow: row?.restockWhenLow,
                    restockLowLevel: row?.restockLowLevel,
                    lastRestockedOn: row?.lastRestockedOn,
                } satisfies Partial<Food>;
            };
            expect(await keptSchedule()).toEqual(USUAL_SCHEDULED);

            const steps: [string, Record<string, unknown>][] = [
                [
                    "upsert_food",
                    {
                        food_id: eggsId,
                        usual_store_id: costco.id,
                        usual_amount: 24,
                        usual_unit: "each",
                    },
                ],
                ["upsert_food", { food_id: eggsId, name: "Free range eggs" }],
                ["upsert_food", { food_id: eggsId, allergens: ["egg"] }],
                [
                    "set_usual_product",
                    {
                        food_id: eggsId,
                        product_food_id: productId,
                        store_id: costco.id,
                        amount: 18,
                        unit: "each",
                    },
                ],
                [
                    "set_usual_product",
                    { food_id: eggsId, product_food_id: null, amount: null },
                ],
                ["link_product", { product_food_id: productId, food_id: null }],
                [
                    "link_product",
                    { product_food_id: productId, food_id: eggsId },
                ],
                [
                    "upsert_food",
                    {
                        food_id: eggsId,
                        usual_store_id: null,
                        usual_amount: null,
                        usual_unit: null,
                    },
                ],
            ];
            for (const [tool, args] of steps) {
                const result = await call(tool, args);
                expect(
                    result.isError,
                    `${tool} ${JSON.stringify(args)}`,
                ).toBeFalsy();
                expect(
                    await keptSchedule(),
                    `${tool} ${JSON.stringify(args)}`,
                ).toEqual(USUAL_SCHEDULED);
            }
            const got = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: eggsId })).structuredContent,
            );
            expect(got.name).toBe("Free range eggs");
            expect(got.usual_store_id).toBeNull();
        });
    });

    test("upsert_food with generic_food_id creates a product", async () => {
        await withPat(async (call) => {
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const created = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Hand-entered Eggs",
                calories: 148,
            });
            expect(created.isError).toBeFalsy();
            const payload = FOOD_OUTPUT.parse(created.structuredContent);
            expect(payload.generic_food_id).toBe(eggsId);
            expect(payload.name).toBe("Hand-entered Eggs");
        });
    });

    test("upsert_food with generic_food_id inherits a supply's kind", async () => {
        await withPat(async (call) => {
            const foil = await call("upsert_food", {
                name: "Foil",
                kind: "supply",
            });
            const foilId = foil.structuredContent?.id as string;
            const created = await call("upsert_food", {
                generic_food_id: foilId,
                name: "Reynolds Wrap",
            });
            expect(created.isError).toBeFalsy();
            const payload = FOOD_OUTPUT.parse(created.structuredContent);
            expect(payload.kind).toBe("supply");
            expect(payload.generic_food_id).toBe(foilId);
            const mismatched = await call("upsert_food", {
                generic_food_id: foilId,
                name: "Foil sandwich",
                kind: "food",
            });
            expect(mismatched.isError).toBe(true);
        });
    });

    test("put_away_grocery_lines with product_food_ids records the chosen product", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const eggs = await call("upsert_food", { name: "Eggs" });
            const eggsId = eggs.structuredContent?.id as string;
            const usual = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Usual Eggs",
                calories: 140,
            });
            const usualId = usual.structuredContent?.id as string;
            const other = await call("upsert_food", {
                generic_food_id: eggsId,
                name: "Sale Eggs",
                calories: 120,
            });
            const otherId = other.structuredContent?.id as string;
            await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: usualId,
            });
            const line = await call("add_grocery_line", {
                store_id: store.id,
                kind: "food",
                food_id: eggsId,
                amount: 12,
                unit: "each",
            });
            const lineId = (line.structuredContent as { id?: string })?.id!;
            const put = await call("put_away_grocery_lines", {
                line_ids: [lineId],
                location_id: locationId,
                product_food_ids: { [lineId]: otherId },
            });
            expect(put.isError).toBeFalsy();
            expect(put.structuredContent?.put_away).toEqual([
                expect.objectContaining({
                    line_id: lineId,
                    product_food_id: otherId,
                }),
            ]);
            const fridge = await call("get_fridge");
            expect(textOf(fridge)).toContain("Sale Eggs");
        });
    });

    test("upsert_food without food_id matches name and brand separately", async () => {
        await withPat(async (call) => {
            const branded = await call("upsert_food", {
                name: "Half and half",
                brand: "Laura Lynn",
                calories: 100,
            });
            expect(branded.isError).toBeFalsy();
            const brandedId = branded.structuredContent?.id as string;
            FOOD_OUTPUT.parse(branded.structuredContent);
            const plain = await call("upsert_food", { name: "Half and half" });
            expect(plain.isError).toBeFalsy();
            expect(plain.structuredContent?.id).not.toBe(brandedId);
            expect(plain.structuredContent?.brand).toBeNull();
            const lauraStill = await call("get_food", { food_id: brandedId });
            expect(lauraStill.structuredContent?.calories).toBe(100);
            const edited = await call("upsert_food", {
                name: "Half and half",
                brand: "Laura Lynn",
                calories: 130,
            });
            expect(edited.isError).toBeFalsy();
            expect(edited.structuredContent?.id).toBe(brandedId);
            expect(edited.structuredContent?.calories).toBe(130);
        });
    });

    test("upsert_food create path attaches barcode and rejects duplicates", async () => {
        await withPat(async (call) => {
            const plain = await call("upsert_food", { name: "Half and half" });
            const plainId = plain.structuredContent?.id as string;
            const created = await call("upsert_food", {
                generic_food_id: plainId,
                name: "Member's Mark Half and Half",
                brand: "Member's Mark",
                barcode: "193968379117",
                calories: 130,
            });
            expect(created.isError).toBeFalsy();
            const payload = FOOD_OUTPUT.parse(created.structuredContent);
            expect(payload.barcodes).toEqual(["193968379117"]);
            const before = (await db.foodsStore.listFoods("hh-1")).length;
            const dup = await call("upsert_food", {
                generic_food_id: plainId,
                name: "Other Half and Half",
                brand: "Other",
                barcode: "193968379117",
                calories: 120,
            });
            expect(dup.isError).toBe(true);
            expect(textOf(dup)).toContain("That barcode already belongs to");
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(before);
        });
    });

    test("upsert_food edit path attaches barcode and rejects conflicts", async () => {
        await withPat(async (call) => {
            const a = await call("upsert_food", { name: "Barcode food A" });
            const b = await call("upsert_food", { name: "Barcode food B" });
            const aId = a.structuredContent?.id as string;
            const bId = b.structuredContent?.id as string;
            const attached = await call("upsert_food", {
                food_id: aId,
                barcode: "737628064502",
            });
            expect(attached.isError).toBeFalsy();
            expect(attached.structuredContent?.barcodes).toEqual([
                "737628064502",
            ]);
            const conflict = await call("upsert_food", {
                food_id: bId,
                barcode: "737628064502",
            });
            expect(conflict.isError).toBe(true);
            expect(textOf(conflict)).toContain(
                "That barcode already belongs to",
            );
        });
    });

    test("upsert_food rejects invalid barcodes without writing", async () => {
        await withPat(async (call) => {
            const before = (await db.foodsStore.listFoods("hh-1")).length;
            const r = await call("upsert_food", {
                name: "Bad barcode food",
                barcode: "12ab",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("Enter a valid barcode");
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(before);
        });
    });

    test("a rejected upsert_food leaves no row and no barcode behind", async () => {
        await withPat(async (call) => {
            const barcodeOwner = async (barcode: string) =>
                db.foodsStore.getBarcodeFoodId("hh-1", barcode);
            const plain = await call("upsert_food", { name: "Milk" });
            const plainId = plain.structuredContent?.id as string;
            await call("upsert_food", { name: "Milk", brand: "A" });
            const pear = await call("upsert_food", {
                name: "Pear",
                aliases: ["nashi"],
            });
            const pearId = pear.structuredContent?.id as string;
            const before = (await db.foodsStore.listFoods("hh-1")).length;

            const collide = await call("upsert_food", {
                food_id: plainId,
                name: "Milk",
                brand: "A",
                barcode: "012345678905",
            });
            expect(collide.isError).toBe(true);
            expect(await barcodeOwner("012345678905")).toBeNull();
            expect(
                (await db.foodsStore.getFood("hh-1", plainId))?.brand,
            ).toBeNull();

            const blankName = await call("upsert_food", {
                food_id: pearId,
                name: "   ",
                barcode: "193968379117",
            });
            expect(blankName.isError).toBe(true);
            expect(await barcodeOwner("193968379117")).toBeNull();

            const badGrams = await call("upsert_food", {
                name: "Bad grams",
                barcode: "737628064502",
                grams_per_each: 0,
            });
            expect(badGrams.isError).toBe(true);
            expect(await barcodeOwner("737628064502")).toBeNull();

            const badProduct = await call("upsert_food", {
                generic_food_id: plainId,
                name: "Bad product",
                barcode: "737628064502",
                aliases: ["nashi"],
            });
            expect(badProduct.isError).toBe(true);
            expect(await barcodeOwner("737628064502")).toBeNull();
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(before);
        });
    });

    test("upsert_food by name re-saves a food with its own barcode", async () => {
        await withPat(async (call) => {
            const first = await call("upsert_food", {
                name: "Oat milk",
                brand: "Oatly",
                barcode: "7394376616037",
            });
            expect(first.isError).toBeFalsy();
            const again = await call("upsert_food", {
                name: "Oat milk",
                brand: "Oatly",
                barcode: "7394376616037",
                calories: 46,
            });
            expect(again.isError).toBeFalsy();
            expect(again.structuredContent?.id).toBe(
                first.structuredContent?.id,
            );
            expect(again.structuredContent?.calories).toBe(46);
        });
    });

    test("upsert_food barcode resolves through findOrCreateFoodByBarcode", async () => {
        await withPat(async (call) => {
            const plain = await call("upsert_food", { name: "Half and half" });
            const plainId = plain.structuredContent?.id as string;
            const product = await call("upsert_food", {
                generic_food_id: plainId,
                name: "Member's Mark Half and Half",
                brand: "Member's Mark",
                barcode: "193968379117",
                calories: 130,
            });
            const productId = product.structuredContent?.id as string;
            const before = (await db.foodsStore.listFoods("hh-1")).length;
            const resolved = await findOrCreateFoodByBarcode(
                db.foodsStore,
                "hh-1",
                "193968379117",
                async () => null,
            );
            expect(resolved.id).toBe(productId);
            expect((await db.foodsStore.listFoods("hh-1")).length).toBe(before);
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

    test("unmeasured ingredient validates on recipe and grocery tool outputs", async () => {
        await withUser(alice, async (call) => {
            const salt = await call("upsert_food", {
                name: "Salt",
                default_unit: "g",
            });
            const saltId = salt.structuredContent?.id as string;
            const recipe = await call("create_recipe", {
                name: "Scrambled eggs",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: saltId,
            });
            const got = await call("get_recipe", { id: recipeId });
            expect(got.isError).toBeFalsy();
            const ingredients = got.structuredContent?.ingredients as Array<{
                amount: number | null;
                unit: string | null;
                per_portion_amount: number | null;
            }>;
            expect(ingredients[0]?.amount).toBeNull();
            expect(ingredients[0]?.unit).toBeNull();
            expect(ingredients[0]?.per_portion_amount).toBeNull();
            expect(textOf(got)).toContain("to taste");
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Safeway",
            );
            const added = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: store.id,
                member_ids: [alice],
            });
            expect(added.isError).toBeFalsy();
            const remainder = added.structuredContent?.remainder as Array<{
                unmeasured: boolean;
                note: string | null;
            }>;
            expect(remainder.some((row) => row.unmeasured)).toBe(true);
            const listed = await call("list_grocery_lines");
            const lines = (
                listed.structuredContent?.stores as Array<{
                    sections: Array<{
                        lines: Array<{ note: string | null }>;
                    }>;
                }>
            ).flatMap((s) => s.sections.flatMap((sec) => sec.lines));
            expect(lines.some((row) => row.note === "to taste")).toBe(true);
            expect(textOf(listed)).toContain("Salt · to taste");
            expect(textOf(listed)).not.toMatch(/Salt 1 g/);
            const cooked = await call("cook_recipe", {
                recipe_id: recipeId,
                portions_by_member: [{ user_id: alice, portions: 1 }],
                deduct_stock: true,
                log_meals: false,
            });
            expect(cooked.isError).toBeFalsy();
            const unmeasured = cooked.structuredContent?.unmeasured as Array<{
                display_name: string;
            }>;
            expect(unmeasured[0]?.display_name).toBe("Salt");
            expect(textOf(cooked)).toContain("Not deducted (no amount)");
        });
    });

    test("import_recipe_from_url output validates and never sets isError", async () => {
        const { IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA } =
            await import("./mcp/tools/recipes.js");
        const { join } = await import("node:path");
        const yoast = await Bun.file(
            join(
                import.meta.dir,
                "domain/fixtures/recipe-pages/array-top-level.html",
            ),
        ).text();
        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                return {
                    ok: true as const,
                    url: "https://example.com/soup",
                    status: 200,
                    contentType: "text/html",
                    body: yoast,
                };
            },
        };
        await withUser(alice, async (call) => {
            const imported = await call("import_recipe_from_url", {
                url: "https://example.com/soup",
            });
            expect(imported.isError).toBeUndefined();
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                imported.structuredContent,
            );
            expect(imported.structuredContent?.status).toBe("imported");
            expect(imported.structuredContent?.from_memory).toBe(false);
            expect(imported.structuredContent?.remembered_until).toBeNull();

            db.recipeImportFetcher = {
                async robotsAllows() {
                    return true;
                },
                async fetchPage() {
                    return {
                        ok: false as const,
                        reason: "site_refused" as const,
                        status: 403,
                        detail: "Forbidden",
                        url: "https://mem.example.com/recipe",
                        host: "mem.example.com",
                    };
                },
            };
            const refusedFirst = await call("import_recipe_from_url", {
                url: "https://mem.example.com/recipe",
            });
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                refusedFirst.structuredContent,
            );
            expect(refusedFirst.structuredContent?.from_memory).toBe(false);
            const refusedMem = await call("import_recipe_from_url", {
                url: "https://mem.example.com/other",
            });
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                refusedMem.structuredContent,
            );
            expect(refusedMem.structuredContent?.from_memory).toBe(true);
            expect(
                refusedMem.structuredContent?.remembered_until,
            ).not.toBeNull();
            db.recipeImportFetcher = {
                async robotsAllows() {
                    return true;
                },
                async fetchPage() {
                    return {
                        ok: true as const,
                        url: "https://mem.example.com/other",
                        status: 200,
                        contentType: "text/html",
                        body: yoast,
                    };
                },
            };
            const retried = await call("import_recipe_from_url", {
                url: "https://mem.example.com/other",
                retry: true,
            });
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                retried.structuredContent,
            );
            expect(retried.structuredContent?.from_memory).toBe(false);

            const paste = await call("import_recipe_from_url", {
                url: "https://www.instagram.com/p/abc/",
            });
            expect(paste.isError).toBeUndefined();
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(paste.structuredContent);
            expect(paste.structuredContent?.status).toBe("paste_needed");

            const fromText = await call("import_recipe_from_text", {
                text: "x",
                instructions: "1. Mix",
                name: "Dup",
                source_url: "https://example.com/dup-recipe",
                ingredients: [{ name: "flour", amount: 1, unit: "g" }],
            });
            const dupId = (fromText.structuredContent?.recipe as { id: string })
                .id;
            await db.recipesStore.updateRecipe({
                ...(await db.recipesStore.getRecipe("hh-1", dupId))!,
                sourceUrl: "https://example.com/dup-recipe",
            });
            const dup = await call("import_recipe_from_url", {
                url: "https://example.com/dup-recipe?utm_source=x",
            });
            expect(dup.isError).toBeUndefined();
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(dup.structuredContent);
            expect(dup.structuredContent?.status).toBe("duplicate");
            expect(dup.structuredContent?.recipe_id).toBe(dupId);

            const caption = await Bun.file(
                join(
                    import.meta.dir,
                    "domain/fixtures/captions/clean-headers.txt",
                ),
            ).text();
            const fromCaption = await call("import_recipe_from_url", {
                url: "https://www.instagram.com/p/import-caption/",
                text: caption,
            });
            expect(fromCaption.isError).toBeUndefined();
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                fromCaption.structuredContent,
            );
            expect(fromCaption.structuredContent?.status).toBe("imported");

            const noRecipe = await call("import_recipe_from_url", {
                url: "https://www.instagram.com/p/empty-caption/",
                text: await Bun.file(
                    join(
                        import.meta.dir,
                        "domain/fixtures/captions/no-recipe.txt",
                    ),
                ).text(),
            });
            IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                noRecipe.structuredContent,
            );
            expect(noRecipe.structuredContent?.status).toBe(
                "no_recipe_in_text",
            );
        });
    });

    test("import_recipe_from_url catalog lists text and credit params", () => {
        const tool = TOOLS.find(
            (item) => item.name === "import_recipe_from_url",
        );
        expect(tool?.params.map((row) => row.name)).toEqual(
            expect.arrayContaining(["url", "text", "credit", "retry"]),
        );
    });

    test("verify_recipe output validates for verified, unverified, and not_found", async () => {
        const { VERIFY_RECIPE_OUTPUT_SCHEMA } =
            await import("./mcp/tools/recipes.js");
        await withUser(alice, async (call) => {
            const complete = await call("import_recipe_from_text", {
                text: "caption",
                instructions: "1. Mix",
                name: "Verified soup",
                ingredients: [{ name: "water", amount: 100, unit: "g" }],
            });
            const completeId = (
                complete.structuredContent?.recipe as { id: string }
            ).id;
            const ok = await call("verify_recipe", { recipe_id: completeId });
            expect(ok.isError).toBeFalsy();
            VERIFY_RECIPE_OUTPUT_SCHEMA.parse(ok.structuredContent);
            expect(ok.structuredContent?.status).toBe("verified");

            const incomplete = await call("import_recipe_from_text", {
                text: "caption",
                instructions: "",
                name: "Still open",
                ingredients: [{ name: "salt", amount: 1, unit: "g" }],
            });
            const openId = (
                incomplete.structuredContent?.recipe as { id: string }
            ).id;
            const open = await call("verify_recipe", { recipe_id: openId });
            VERIFY_RECIPE_OUTPUT_SCHEMA.parse(open.structuredContent);
            expect(open.structuredContent?.status).toBe("unverified");

            const missing = await call("verify_recipe", {
                recipe_id: "00000000-0000-4000-8000-000000000099",
            });
            VERIFY_RECIPE_OUTPUT_SCHEMA.parse(missing.structuredContent);
            expect(missing.structuredContent?.status).toBe("not_found");
        });
    });

    test("verify_recipe resolved_lines clears handled import lines", async () => {
        await withUser(alice, async (call) => {
            const imported = await call("import_recipe_from_text", {
                text: "caption",
                instructions: "1. Mix",
                name: "Lines soup",
                ingredients: [{ name: "water", amount: 100, unit: "g" }],
            });
            const id = (imported.structuredContent?.recipe as { id: string })
                .id;
            const row = await db.recipesStore.getImport("hh-1", id);
            await db.recipesStore.upsertImport({
                ...row!,
                unresolvedLines: ["1 x 400g tin tomatoes"],
            });
            const blocked = await call("verify_recipe", { recipe_id: id });
            expect(blocked.structuredContent?.status).toBe("unverified");
            const fixed = await call("verify_recipe", {
                recipe_id: id,
                resolved_lines: ["1 x 400g tin tomatoes"],
            });
            expect(fixed.isError).toBeFalsy();
            expect(fixed.structuredContent?.status).toBe("verified");
        });
    });

    test("list_recipes filters by verification", async () => {
        await withUser(alice, async (call) => {
            await call("import_recipe_from_text", {
                text: "a",
                instructions: "",
                name: "Open recipe",
                ingredients: [{ name: "flour", amount: 1, unit: "g" }],
            });
            const verifiedOnly = await call("list_recipes", {
                verification: "verified",
            });
            expect(textOf(verifiedOnly)).not.toContain("Open recipe");
            const unverifiedOnly = await call("list_recipes", {
                verification: "unverified",
            });
            expect(textOf(unverifiedOnly)).toContain("Open recipe");
        });
    });

    test("unverified recipe refuses cook and add_recipe_to_grocery", async () => {
        await withUser(alice, async (call) => {
            const imported = await call("import_recipe_from_text", {
                text: "x",
                instructions: "",
                name: "Blocked",
                ingredients: [{ name: "rice", amount: 50, unit: "g" }],
            });
            const recipeId = (
                imported.structuredContent?.recipe as { id: string }
            ).id;
            const cooked = await call("cook_recipe", {
                recipe_id: recipeId,
                total_portions: 1,
            });
            expect(cooked.isError).toBeTruthy();
            expect(textOf(cooked).toLowerCase()).toContain("unverified");
            const added = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: (
                    await createGroceryStore(db.settingsStore, "hh-1", "Shop")
                ).id,
                total_portions: 1,
            });
            expect(added.isError).toBeTruthy();
            expect(textOf(added).toLowerCase()).toContain("unverified");
        });
    });

    test("get_recipe returns import metadata and problems for imports", async () => {
        await withUser(alice, async (call) => {
            const imported = await call("import_recipe_from_text", {
                text: "Pasted body",
                instructions: "",
                name: "Import meta",
                ingredients: [{ name: "oats", amount: 40, unit: "g" }],
            });
            const recipeId = (
                imported.structuredContent?.recipe as { id: string }
            ).id;
            const detail = await call("get_recipe", { id: recipeId });
            expect(detail.isError).toBeFalsy();
            expect(detail.structuredContent?.verification).toBe("unverified");
            expect(textOf(detail)).toContain("Verification: unverified");
            expect(textOf(detail)).toContain("Source text:\nPasted body");
            const imp = detail.structuredContent?.import as {
                source_text: string | null;
            } | null;
            expect(imp?.source_text).toBe("Pasted body");
            expect(
                (detail.structuredContent?.problems as unknown[])?.length,
            ).toBeGreaterThan(0);
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
            expect(textOf(line).toLowerCase()).toContain("peanut");
            const sc = ADD_GROCERY_LINE_OUTPUT_SCHEMA.parse(
                line.structuredContent,
            );
            expect(sc.notices.map((n) => n.code)).toEqual(["grocery.allergen"]);
            expect(sc.notices[0]!.severity).toBe("block");
        });
    });

    test("get_recipe wires recipe.no_nutrition notices", async () => {
        await withUser(alice, async (call) => {
            const plain = await call("upsert_food", { name: "Half and half" });
            const plainId = plain.structuredContent?.id as string;
            await call("upsert_food", {
                food_id: plainId,
                grams_per_ml: 1,
            });
            const recipe = await call("create_recipe", {
                name: "Coffee",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: plainId,
                amount: 60,
                unit: "ml",
            });
            const got = await call("get_recipe", { id: recipeId });
            expect(got.isError).toBeFalsy();
            const sc = got.structuredContent as {
                notices: Array<{
                    code: string;
                    severity: string;
                    subject: {
                        kind: string;
                        recipe_id: string | null;
                    };
                    message: string;
                    action: { label: string } | null;
                }>;
                macros_per_portion: { incomplete: boolean };
            };
            for (const n of sc.notices) NOTICE_SCHEMA.parse(n);
            const nn = sc.notices.find((n) => n.code === "recipe.no_nutrition");
            expect(nn?.severity).toBe("warn");
            expect(nn?.subject.kind).toBe("recipe_ingredient");
            expect(nn?.subject.recipe_id).toBe(recipeId);
            expect(nn?.action).toEqual({ label: "Pick usual product" });
            expect(sc.macros_per_portion.incomplete).toBe(true);
            expect(nn?.message).toContain("no nutrition");
        });
    });

    test("get_recipe wires recipe.allergen block notice for viewing member", async () => {
        await withUser(alice, async (call) => {
            await call("set_household_rules", {
                person: [
                    { user_id: alice, allergens: [{ allergen: "peanut" }] },
                ],
            });
            const pb = await call("upsert_food", {
                name: "Peanut Butter",
                allergens: ["peanut"],
                calories: 100,
                protein_g: 1,
                carbs_g: 1,
                fat_g: 1,
            });
            const pbId = pb.structuredContent?.id as string;
            const recipe = await call("create_recipe", {
                name: "Toast",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: pbId,
                amount: 10,
                unit: "g",
            });
            const got = await call("get_recipe", { id: recipeId });
            const notices = (got.structuredContent as { notices: unknown[] })
                .notices;
            for (const n of notices) NOTICE_SCHEMA.parse(n);
            const hit = notices.find(
                (n) => (n as { code: string }).code === "recipe.allergen",
            ) as { severity: string } | undefined;
            expect(hit?.severity).toBe("block");
            expect(textOf(got)).toContain("Allergen:");
            expect(textOf(got)).toContain("Allergen: Contains peanut");
        });
    });

    test("list_grocery_lines returns grocery.restocked on restock lines", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        const sections = await db.settingsStore.listSections(store.id);
        const sectionId = sections[0]!.id;
        await withPat(async (call) => {
            const milk = await call("upsert_food", { name: "Restock Milk" });
            const foodId = (milk.structuredContent as { id: string }).id;
            const itemId = crypto.randomUUID();
            await db.fridgeStore.insertItem({
                id: itemId,
                householdId: "hh-1",
                kind: "food",
                foodId,
                displayName: "Milk pint",
                quantity: { amount: 1, unit: "l" },
                locationId: "loc-1",
                expiresOn: "2030-06-03",
                openedOn: null,
                purchasedOn: null,
            });
            await db.groceryStore.insertLine({
                id: "line-restock",
                householdId: "hh-1",
                storeId: store.id,
                sectionId,
                kind: "food",
                displayName: "Restock Milk",
                quantity: { amount: 1, unit: "l" },
                foodId,
                checked: false,
                source: "restock",
                sourceFridgeItemId: itemId,
                note: null,
            });
            const listed = await call("list_grocery_lines");
            const lines = (
                listed.structuredContent as {
                    stores: Array<{
                        sections: Array<{
                            lines: Array<{
                                id: string;
                                notices: unknown[];
                            }>;
                        }>;
                    }>;
                }
            ).stores.flatMap((s) => s.sections.flatMap((sec) => sec.lines));
            const hit = lines.find((l) => l.id === "line-restock");
            expect(hit).toBeTruthy();
            const notice = (
                hit!.notices as Array<{ code: string; message: string }>
            ).find((n) => n.code === "grocery.restocked");
            expect(notice).toBeTruthy();
            expect(notice!.message).toContain(
                "Added because Milk pint expires",
            );
            for (const n of hit!.notices) NOTICE_SCHEMA.parse(n);
            const text = (listed.content as Array<{ text: string }>)[0]!.text;
            expect(text).toContain("— Added because Milk pint expires");
        });
    });

    test("list_grocery_lines wires grocery.allergen notices on lines", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        await withPat(async (call) => {
            await call("set_household_rules", {
                person: [{ user_id: bob, allergens: [{ allergen: "peanut" }] }],
            });
            await call("upsert_food", {
                name: "Peanut Butter",
                allergens: ["peanut"],
            });
            const added = await call("add_grocery_line", {
                store_id: store.id,
                kind: "food",
                name: "Peanut Butter",
                amount: 1,
            });
            ADD_GROCERY_LINE_OUTPUT_SCHEMA.parse(added.structuredContent);
            expect(textOf(added)).toContain("Contains peanut — Bob.");
            await call("add_grocery_line", {
                store_id: store.id,
                kind: "food",
                name: "Rolled oats",
                amount: 1,
            });
            const listed = await call("list_grocery_lines");
            const lines = (
                listed.structuredContent as {
                    stores: Array<{
                        sections: Array<{
                            lines: Array<{
                                display_name: string;
                                notices: Array<{
                                    code: string;
                                    severity: string;
                                    message: string;
                                    related: Array<{
                                        kind: string;
                                        name: string;
                                    }>;
                                }>;
                            }>;
                        }>;
                    }>;
                }
            ).stores.flatMap((s) => s.sections.flatMap((sec) => sec.lines));
            const pean = lines.find((l) =>
                l.display_name.toLowerCase().includes("peanut"),
            );
            expect(pean).toBeTruthy();
            for (const n of pean!.notices) NOTICE_SCHEMA.parse(n);
            expect(pean!.notices[0]?.code).toBe("grocery.allergen");
            expect(pean!.notices[0]?.severity).toBe("block");
            expect(
                pean!.notices[0]?.related.some(
                    (r) => r.kind === "member" && r.name === "Bob",
                ),
            ).toBe(true);
            expect(pean!.notices[0]?.message).toBe("Contains peanut — Bob.");
            expect(textOf(listed)).toContain(" — Contains peanut — Bob.");
            const oats = lines.find((l) =>
                l.display_name.toLowerCase().includes("oats"),
            )!;
            expect(oats.notices).toEqual([]);
        });
    });

    test("get_fridge wires expiry notices per item", async () => {
        function addDaysUtc(iso: string, delta: number): string {
            const [y, m, d] = iso.split("-").map(Number);
            return new Date(Date.UTC(y!, m! - 1, d! + delta))
                .toISOString()
                .slice(0, 10);
        }
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const today = utcTodayFromDate();
            for (const [name, expiresOn] of [
                ["Expired milk", addDaysUtc(today, -1)],
                ["Soon yogurt", addDaysUtc(today, 4)],
                ["No date flour", null],
            ] as const) {
                const added = await call("add_fridge_item", {
                    location_id: locationId,
                    kind: "food",
                    name,
                    amount: 1,
                    unit: "g",
                });
                if (expiresOn != null) {
                    const row = (await db.fridgeStore.listItems("hh-1")).find(
                        (r) => r.id === added.structuredContent?.id,
                    );
                    await db.fridgeStore.updateItem({
                        ...row!,
                        expiresOn,
                    });
                }
            }
            const listed = await call("get_fridge");
            const items = (
                listed.structuredContent as {
                    locations: Array<{
                        items: Array<{
                            display_name: string;
                            notices: Array<{
                                code: string;
                                severity: string;
                                action: { label: string } | null;
                                message: string;
                            }>;
                        }>;
                    }>;
                }
            ).locations.flatMap((l) => l.items);
            for (const item of items) {
                for (const n of item.notices) NOTICE_SCHEMA.parse(n);
            }
            const expired = items.find((i) =>
                i.display_name.includes("Expired"),
            )!;
            expect(expired.notices[0]?.code).toBe("fridge.expired");
            expect(expired.notices[0]?.severity).toBe("warn");
            expect(expired.notices[0]?.action).toEqual({
                label: "Add to grocery list",
            });
            const soonItem = items.find((i) =>
                i.display_name.includes("Soon"),
            )!;
            expect(soonItem.notices[0]?.code).toBe("fridge.expiring");
            expect(soonItem.notices[0]?.severity).toBe("info");
            expect(soonItem.notices[0]?.action).toEqual({
                label: "Add to grocery list",
            });
            const plain = items.find((i) =>
                i.display_name.includes("No date"),
            )!;
            expect(plain.notices).toEqual([]);

            const expiredRow = (await db.fridgeStore.listItems("hh-1")).find(
                (r) => r.displayName.includes("Expired"),
            )!;
            await db.groceryStore.insertLine({
                id: "line-on-list",
                householdId: "hh-1",
                storeId: "store-1",
                sectionId: "sec-1",
                kind: "food",
                displayName: "Expired milk",
                quantity: { amount: 1, unit: "g" },
                foodId: expiredRow.foodId,
                checked: false,
                source: "manual",
                sourceFridgeItemId: null,
                note: null,
            });
            const relisted = await call("get_fridge");
            const relistedItems = (
                relisted.structuredContent as {
                    locations: Array<{
                        items: Array<{
                            display_name: string;
                            notices: Array<{
                                action: { label: string } | null;
                                message: string;
                            }>;
                        }>;
                    }>;
                }
            ).locations.flatMap((l) => l.items);
            const onList = relistedItems.find((i) =>
                i.display_name.includes("Expired"),
            )!;
            expect(onList.notices[0]?.action).toBeNull();
            expect(onList.notices[0]?.message).toContain("on the grocery list");
        });
    });

    test("get_food includes empty notices", async () => {
        await withPat(async (call) => {
            const made = await call("upsert_food", { name: "Rice" });
            const got = await call("get_food", {
                food_id: made.structuredContent?.id as string,
            });
            const payload = GET_FOOD_OUTPUT.parse(got.structuredContent);
            expect(payload.notices).toEqual([]);
        });
    });

    test("get_food emits quality null or full literal", async () => {
        await withPat(async (call) => {
            const plain = await call("upsert_food", { name: "Oats" });
            const plainId = plain.structuredContent?.id as string;
            const without = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: plainId }))
                    .structuredContent,
            );
            expect(without.quality).toBeNull();

            await db.foodsStore.updateFoodRow({
                ...(await db.foodsStore.getFood("hh-1", plainId))!,
                offQuality: {
                    nutriscoreGrade: "a",
                    novaGroup: 1,
                    ecoscoreGrade: "b",
                    additives: [{ tag: "en:e250", risk: "high" }],
                    allergensTags: ["en:gluten"],
                    tracesTags: [],
                    ingredientsAnalysisTags: null,
                    labelsTags: null,
                    fetchedAt: "2026-11-07T12:00:00.000Z",
                },
            });
            const withQ = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: plainId }))
                    .structuredContent,
            );
            expect(withQ.quality?.nutriscore_grade).toBe("a");
            expect(withQ.quality?.additives).toEqual([
                { tag: "en:e250", risk: "high" },
            ]);
        });
    });

    test("list_notices count matches household notices; filters narrow notices only", async () => {
        function addDaysUtc(iso: string, delta: number): string {
            const [y, m, d] = iso.split("-").map(Number);
            return new Date(Date.UTC(y!, m! - 1, d! + delta))
                .toISOString()
                .slice(0, 10);
        }
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const today = utcTodayFromDate();
            const added = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                name: "Soon kefir",
                amount: 1,
                unit: "g",
            });
            const itemId = added.structuredContent?.id as string;
            const row = (await db.fridgeStore.listItems("hh-1")).find(
                (r) => r.id === itemId,
            );
            await db.fridgeStore.updateItem({
                ...row!,
                expiresOn: addDaysUtc(today, 4),
            });
            const plain = await call("upsert_food", { name: "Half and half" });
            const plainId = plain.structuredContent?.id as string;
            const recipe = await call("create_recipe", {
                name: "Coffee",
                yield_portions: 1,
            });
            const recipeId = recipe.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: plainId,
                amount: 60,
                unit: "ml",
            });

            const listed = await call("list_notices", {});
            expect(listed.isError).toBeFalsy();
            const sc = listed.structuredContent as {
                count: number;
                notices: unknown[];
            };
            expect(sc.count).toBeGreaterThanOrEqual(2);
            for (const n of sc.notices) NOTICE_SCHEMA.parse(n);
            expect(sc.count).toBeGreaterThanOrEqual(sc.notices.length);

            const byCode = await call("list_notices", {
                code: "fridge.expiring",
            });
            const codeSc = byCode.structuredContent as {
                count: number;
                notices: Array<{ code: string }>;
            };
            expect(codeSc.count).toBe(sc.count);
            expect(
                codeSc.notices.every((n) => n.code === "fridge.expiring"),
            ).toBe(true);

            const bySeverity = await call("list_notices", { severity: "info" });
            const sevSc = bySeverity.structuredContent as {
                count: number;
                notices: Array<{ severity: string }>;
            };
            expect(sevSc.count).toBe(sc.count);
            expect(sevSc.notices.every((n) => n.severity === "info")).toBe(
                true,
            );

            const byKind = await call("list_notices", {
                subject_kind: "recipe_ingredient",
            });
            const kindSc = byKind.structuredContent as {
                count: number;
                notices: Array<{ subject: { kind: string } }>;
            };
            expect(kindSc.count).toBe(sc.count);
            expect(
                kindSc.notices.every(
                    (n) => n.subject.kind === "recipe_ingredient",
                ),
            ).toBe(true);
        });
    });

    test("dismiss_notice on info then list; warn and unknown subject error", async () => {
        function addDaysUtc(iso: string, delta: number): string {
            const [y, m, d] = iso.split("-").map(Number);
            return new Date(Date.UTC(y!, m! - 1, d! + delta))
                .toISOString()
                .slice(0, 10);
        }
        await withUser(alice, async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const today = utcTodayFromDate();
            const added = await call("add_fridge_item", {
                location_id: locationId,
                kind: "food",
                name: "Soon butter",
                amount: 1,
                unit: "g",
            });
            const itemId = added.structuredContent?.id as string;
            const row = (await db.fridgeStore.listItems("hh-1")).find(
                (r) => r.id === itemId,
            );
            await db.fridgeStore.updateItem({
                ...row!,
                expiresOn: addDaysUtc(today, 3),
            });

            const ok = await call("dismiss_notice", {
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: itemId,
            });
            expect(ok.isError).toBeFalsy();
            const after = await call("list_notices", {});
            const notices = (
                after.structuredContent as {
                    notices: Array<{ code: string; subject: { id: string } }>;
                }
            ).notices;
            expect(
                notices.some(
                    (n) =>
                        n.subject.id === itemId && n.code === "fridge.expiring",
                ),
            ).toBe(false);

            const warn = await call("dismiss_notice", {
                code: "fridge.expired",
                subject_kind: "fridge_item",
                subject_id: itemId,
            });
            expect(warn.isError).toBe(true);
            expect(textOf(warn)).toContain("This notice can't be dismissed");

            const missing = await call("dismiss_notice", {
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: crypto.randomUUID(),
            });
            expect(missing.isError).toBe(true);
            expect(textOf(missing).toLowerCase()).toContain("not open");
        });
    });

    test("food.possible_duplicate list, dismiss pair either order, merge, get_food", async () => {
        await withUser(alice, async (call) => {
            const a = await call("upsert_food", { name: "chicken egg" });
            const b = await call("upsert_food", {
                name: "Eggs",
                calories: 140,
            });
            const idA = a.structuredContent?.id as string;
            const idB = b.structuredContent?.id as string;
            await call("upsert_food", {
                food_id: idA,
                calories: 100,
            });

            const byCode = await call("list_notices", {
                code: "food.possible_duplicate",
            });
            const notices = (
                byCode.structuredContent as {
                    notices: Array<{
                        code: string;
                        subject: { id: string };
                        related: Array<{ id: string }>;
                    }>;
                }
            ).notices.filter((n) => n.code === "food.possible_duplicate");
            expect(
                notices.some(
                    (n) =>
                        (n.subject.id === idA &&
                            n.related.some((r) => r.id === idB)) ||
                        (n.subject.id === idB &&
                            n.related.some((r) => r.id === idA)),
                ),
            ).toBe(true);
            for (const n of notices) NOTICE_SCHEMA.parse(n);

            const oat = await call("upsert_food", { name: "rolled oat" });
            const oats = await call("upsert_food", { name: "rolled oats" });
            const oatId = oat.structuredContent?.id as string;
            const oatsId = oats.structuredContent?.id as string;

            const dismissSwapped = await call("dismiss_notice", {
                code: "food.possible_duplicate",
                subject_kind: "food",
                subject_id: oatsId,
                related_id: oatId,
            });
            expect(dismissSwapped.isError).toBeFalsy();
            const afterSwapped = await call("list_notices", {
                code: "food.possible_duplicate",
            });
            expect(
                (
                    afterSwapped.structuredContent as {
                        notices: Array<{ subject: { id: string } }>;
                    }
                ).notices.some(
                    (n) => n.subject.id === oatId || n.subject.id === oatsId,
                ),
            ).toBe(false);

            const dismissDirect = await call("dismiss_notice", {
                code: "food.possible_duplicate",
                subject_kind: "food",
                subject_id: idA,
                related_id: idB,
            });
            expect(dismissDirect.isError).toBeFalsy();

            const pita = await call("upsert_food", { name: "pita" });
            const pitas = await call("upsert_food", { name: "pitas" });
            const pitaId = pita.structuredContent?.id as string;
            const pitasId = pitas.structuredContent?.id as string;
            const gotFood = await call("get_food", { food_id: pitaId });
            const withNotice = GET_FOOD_OUTPUT.parse(gotFood.structuredContent);
            expect(
                withNotice.notices.some(
                    (n) => n.code === "food.possible_duplicate",
                ),
            ).toBe(true);
            for (const n of withNotice.notices) NOTICE_SCHEMA.parse(n);

            await call("merge_foods", {
                keep_id: pitaId,
                drop_id: pitasId,
            });
            const afterMerge = await call("list_notices", {
                code: "food.possible_duplicate",
            });
            expect(
                (
                    afterMerge.structuredContent as {
                        notices: Array<{
                            code: string;
                            subject: { id: string };
                        }>;
                    }
                ).notices.some(
                    (n) =>
                        n.code === "food.possible_duplicate" &&
                        (n.subject.id === pitaId || n.subject.id === pitasId),
                ),
            ).toBe(false);
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
                    password: "password1234",
                }),
            ).rejects.toThrow(/not found/);
            expect(db.tokenRotations).toHaveLength(0);
            expect(db.addedLogins).toHaveLength(0);
        });
    });
});

// A usual with every schedule field set to something other than its default.
const USUAL_SCHEDULED = {
    restockSchedule: "every_n_weeks",
    restockEveryWeeks: 3,
    restockPaused: true,
    restockWhenLow: true,
    restockLowLevel: 6,
    lastRestockedOn: "2026-11-02",
} as const;

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

describe("household config plurals_same_food over HTTP", () => {
    test.each(ERAS)("update and get round-trip (%p)", async (era) => {
        db.pluralsSameFood = false;
        await withHttpClient("u1", era, async (client) => {
            const written = (await client.callTool({
                name: "update_household_config",
                arguments: { plurals_same_food: true },
            })) as ToolResult;
            expect(written.isError).toBeFalsy();
            expect(written.structuredContent).toMatchObject({
                plurals_same_food: true,
            });
            const got = (await client.callTool({
                name: "get_household_config",
            })) as ToolResult;
            expect(got.structuredContent).toMatchObject({
                plurals_same_food: true,
            });
        });
    });
});

describe("household notices with actions over HTTP", () => {
    afterEach(() => resetFlagsForTests());

    function addUtcDays(iso: string, delta: number): string {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d! + delta))
            .toISOString()
            .slice(0, 10);
    }

    const CODES = [
        "grocery.running_low",
        "plan.missing_ingredient",
        "nutrition.weigh_in_due",
    ];

    // A usual with nothing in stock, a recipe planned for tomorrow that needs
    // flour, and a member whose last weigh-in was nine days ago.
    async function seed(call: CallTool) {
        const today = utcTodayFromDate();
        await db.foodsStore.insertFood(
            newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Eggs",
                defaultUnit: "each",
                restockWhenLow: true,
                usualAmount: { amount: 12, unit: "each" },
            }),
        );
        const flour = await call("upsert_food", { name: "Flour" });
        const recipe = await call("create_recipe", {
            name: "Bread",
            yield_portions: 1,
        });
        const recipeId = recipe.structuredContent?.id as string;
        await call("add_recipe_ingredient", {
            recipe_id: recipeId,
            food_id: flour.structuredContent?.id as string,
            amount: 200,
            unit: "g",
        });
        await db.plansStore.addPlan({
            householdId: "hh-1",
            recipeId,
            date: addUtcDays(today, 1),
            slot: "dinner",
            servings: 1,
        });
        db.weighInRows.push({
            userId: "u1",
            displayName: "U1",
            lastLoggedAt: `${addUtcDays(today, -9)}T12:00:00Z`,
        });
    }

    type Wire = {
        code: string;
        message: string;
        action: { label: string } | null;
        can_dismiss: boolean;
        dismiss: {
            code: string;
            subject_kind: string;
            subject_id: string;
            related_id: string | null;
        } | null;
    };

    async function listed(call: CallTool, args: Record<string, unknown> = {}) {
        const out = await call("list_notices", args);
        expect(out.isError).toBeFalsy();
        const sc = out.structuredContent as { count: number; notices: Wire[] };
        for (const n of sc.notices) NOTICE_SCHEMA.parse(n);
        return sc;
    }

    test.each(ERAS)(
        "with ui-v2 on, list_notices carries the three with their actions and each can be dismissed (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({ "ui-v2": true }));
            await withHttpClient("u1", era, async (client) => {
                const call: CallTool = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                await seed(call);
                const sc = await listed(call);
                const mine = sc.notices.filter((n) => CODES.includes(n.code));
                expect(mine.map((n) => n.code).sort()).toEqual(
                    [...CODES].sort(),
                );
                const byCode = Object.fromEntries(mine.map((n) => [n.code, n]));
                expect(byCode["grocery.running_low"]).toMatchObject({
                    message: "Running low: Eggs (0 left, below 3)",
                    action: { label: "Add to list" },
                });
                expect(byCode["plan.missing_ingredient"]).toMatchObject({
                    message: "Flour, 200 g, missing for Bread, tomorrow",
                    action: { label: "Add" },
                });
                expect(byCode["nutrition.weigh_in_due"]).toMatchObject({
                    message: "U1 hasn't weighed in for 9 days",
                    action: { label: "Weigh in" },
                });
                expect(sc.count).toBeGreaterThanOrEqual(3);

                const narrowed = await listed(call, {
                    code: "plan.missing_ingredient",
                });
                expect(narrowed.notices).toHaveLength(1);

                for (const n of mine) {
                    expect(n.can_dismiss).toBe(true);
                    const d = n.dismiss!;
                    const out = await call("dismiss_notice", {
                        code: d.code,
                        subject_kind: d.subject_kind,
                        subject_id: d.subject_id,
                        ...(d.related_id ? { related_id: d.related_id } : {}),
                    });
                    expect(out.isError).toBeFalsy();
                }
                const after = await listed(call);
                expect(
                    after.notices.filter((n) => CODES.includes(n.code)),
                ).toEqual([]);
            });
        },
    );

    test.each(ERAS)(
        "with ui-v2 off, none of the three is listed or dismissable (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({ "ui-v2": false }));
            await withHttpClient("u1", era, async (client) => {
                const call: CallTool = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                await seed(call);
                const sc = await listed(call);
                expect(
                    sc.notices.filter((n) => CODES.includes(n.code)),
                ).toEqual([]);
                const out = await call("dismiss_notice", {
                    code: "nutrition.weigh_in_due",
                    subject_kind: "member",
                    subject_id: "u1",
                    related_id: "2026-01-01",
                });
                expect(out.isError).toBe(true);
            });
        },
    );
});

describe("usual tools keep the usual's schedule over HTTP", () => {
    test.each(ERAS)("upsert_food and set_usual_product (%p)", async (era) => {
        await withHttpClient("u1", era, async (client) => {
            const costco = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                `Costco ${JSON.stringify(era)}`,
            );
            const call = async (name: string, args: Record<string, unknown>) =>
                (await client.callTool({
                    name,
                    arguments: args,
                })) as ToolResult;
            const eggs = await call("upsert_food", {
                name: `Eggs ${JSON.stringify(era)}`,
            });
            const eggsId = eggs.structuredContent?.id as string;
            const product = await call("upsert_food", {
                generic_food_id: eggsId,
                name: `Kirkland ${JSON.stringify(era)}`,
                calories: 140,
            });
            const productId = product.structuredContent?.id as string;
            const plain = (await db.foodsStore.getFood("hh-1", eggsId))!;
            await db.foodsStore.updateFoodRow({ ...plain, ...USUAL_SCHEDULED });

            const usual = await call("upsert_food", {
                food_id: eggsId,
                usual_store_id: costco.id,
                usual_amount: 24,
                usual_unit: "each",
            });
            expect(usual.isError).toBeFalsy();
            const set = await call("set_usual_product", {
                food_id: eggsId,
                product_food_id: productId,
                store_id: costco.id,
                amount: 18,
                unit: "each",
            });
            expect(set.isError).toBeFalsy();
            const row = await db.foodsStore.getFood("hh-1", eggsId);
            expect(row).toMatchObject(USUAL_SCHEDULED);
            expect(row?.usualProductId).toBe(productId);
            expect(row?.usualAmount).toEqual({ amount: 24, unit: "each" });
        });
    });
});

describe("set_nutrition_goals over HTTP", () => {
    test.each(ERAS)(
        "per-day override and get_goal_progress agree (%p)",
        async (era) => {
            db.goals = goals({ daily_calories: 2000 });
            await withHttpClient("u1", era, async (client) => {
                const set = (await client.callTool({
                    name: "set_nutrition_goals",
                    arguments: {
                        date: "2026-07-04",
                        daily_calories: 2800,
                    },
                })) as ToolResult;
                expect(set.isError).toBeFalsy();
                const out = SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(
                    set.structuredContent,
                );
                expect(out.scope).toBe("days");
                expect(out.days).toEqual(["2026-07-04"]);
                const prog = (await client.callTool({
                    name: "get_goal_progress",
                    arguments: { date: "2026-07-04" },
                })) as ToolResult;
                expect(textOf(prog)).toContain("2800");
            });
        },
    );
});

describe("goal name over HTTP", () => {
    test.each(ERAS)(
        "set_nutrition_goals names the goals and refuses 41 characters (%p)",
        async (era) => {
            db.goals = goals({ daily_calories: 2000 });
            await withHttpClient("u1", era, async (client) => {
                const set = (await client.callTool({
                    name: "set_nutrition_goals",
                    arguments: { goal_name: "Recomp", goal_note: "Autumn" },
                })) as ToolResult;
                expect(set.isError).toBeFalsy();
                const out = SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(
                    set.structuredContent,
                );
                expect(out.goals?.goal_name).toBe("Recomp");
                expect(out.goals?.goal_note).toBe("Autumn");
                const kept = (await client.callTool({
                    name: "set_nutrition_goals",
                    arguments: { daily_protein_g: 140 },
                })) as ToolResult;
                expect(
                    SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(
                        kept.structuredContent,
                    ).goals?.goal_name,
                ).toBe("Recomp");
                const long = (await client.callTool({
                    name: "set_nutrition_goals",
                    arguments: { goal_name: "x".repeat(41) },
                })) as ToolResult;
                expect(long.isError).toBe(true);
                expect(textOf(long)).toContain("at most 40 characters");
                const prog = (await client.callTool({
                    name: "get_goal_progress",
                    arguments: {},
                })) as ToolResult;
                expect(
                    (
                        prog.structuredContent as {
                            goals: { goal_name: string };
                        }
                    ).goals.goal_name,
                ).toBe("Recomp");
            });
        },
    );
});

describe("rate_product over HTTP", () => {
    test.each(ERAS)(
        "flag on lists and returns structuredContent (%p)",
        async (era) => {
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Rated Bar",
                offQuality: {
                    nutriscoreGrade: "c",
                    novaGroup: 3,
                    ecoscoreGrade: "b",
                    additives: null,
                    allergensTags: null,
                    tracesTags: null,
                    ingredientsAnalysisTags: null,
                    labelsTags: null,
                    fetchedAt: "2026-11-09T12:00:00.000Z",
                },
            });
            await db.foodsStore.insertFood(food);
            setFlagsForTests(createMemoryFlags({ "mcp-rate-product": true }));
            try {
                await withHttpClient("u1", era, async (client) => {
                    const names = (await client.listTools()).tools.map(
                        (t) => t.name,
                    );
                    expect(names).toContain("rate_product");
                    const r = (await client.callTool({
                        name: "rate_product",
                        arguments: { food_id: food.id },
                    })) as ToolResult;
                    RATE_PRODUCT_OUTPUT_SCHEMA.parse(r.structuredContent);
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );

    test.each(ERAS)(
        "scores with the caller's weights and only adds fields (%p)",
        async (era) => {
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Rated Bar",
                offQuality: {
                    nutriscoreGrade: "a",
                    novaGroup: 4,
                    ecoscoreGrade: "b",
                    additives: null,
                    allergensTags: null,
                    tracesTags: null,
                    ingredientsAnalysisTags: null,
                    labelsTags: null,
                    fetchedAt: "2026-11-09T12:00:00.000Z",
                },
            });
            await db.foodsStore.insertFood(food);
            setFlagsForTests(createMemoryFlags({ "mcp-rate-product": true }));
            try {
                await withHttpClient("u1", era, async (client) => {
                    const rate = async () =>
                        RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                            (
                                (await client.callTool({
                                    name: "rate_product",
                                    arguments: { food_id: food.id },
                                })) as ToolResult
                            ).structuredContent,
                        );
                    const before = await rate();
                    await updateMemberScoreSettings(
                        db.scoreSettingsStore,
                        "hh-1",
                        "u1",
                        {
                            choice: {
                                preset: "custom",
                                weights: {
                                    nutrition: 0,
                                    processing: 100,
                                    additives: 0,
                                    environment: 0,
                                },
                            },
                        },
                    );
                    const after = await rate();
                    expect(before.preset).toBe("balanced");
                    expect(after.preset).toBe("custom");
                    expect(after.score).not.toBe(before.score);
                    // Fields every existing client reads are all still there.
                    for (const field of [
                        "found",
                        "product",
                        "score",
                        "label",
                        "preset",
                        "breakdown",
                        "parts_used",
                        "parts_total",
                        "missing",
                        "info_rows",
                        "checks",
                    ]) {
                        expect(Object.keys(after)).toContain(field);
                    }
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );

    test.each(ERAS)(
        "flag off omits rate_product from tools/list (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({ "mcp-rate-product": false }));
            try {
                await withHttpClient("u1", era, async (client) => {
                    const names = (await client.listTools()).tools.map(
                        (t) => t.name,
                    );
                    expect(names).not.toContain("rate_product");
                    await expect(
                        client.callTool({
                            name: "rate_product",
                            arguments: { barcode: "12345678" },
                        }),
                    ).rejects.toThrow(/not found/i);
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );
});

describe("get_household_digest", () => {
    const bob = "22222222-2222-4222-8222-222222222222";

    async function withHouseholdDigestFlag(
        on: boolean,
        run: (call: CallTool) => Promise<void>,
    ) {
        const member = db.members[0];
        const flagCtx = buildFlagContext({
            auth: { kind: "user", userId: "u1" },
            member: member
                ? {
                      userId: member.userId,
                      householdId: member.householdId,
                      role: member.role,
                      displayName: member.displayName,
                  }
                : undefined,
        });
        const flags = evaluateViewerFlags(
            flagCtx,
            createMemoryFlags({ "mcp-household-digest": on }),
        );
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            { kind: "user", userId: "u1" },
            true,
            null,
            undefined,
            "http://localhost",
            true,
            flags,
        );
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({
            name: "test-client",
            version: "0.0.0",
        });
        await Promise.all([server.connect(st), client.connect(ct)]);
        try {
            const call: CallTool = async (name, args) =>
                (await client.callTool({
                    name,
                    arguments: args ?? {},
                })) as ToolResult;
            await run(call);
        } finally {
            await client.close();
            await server.close();
        }
    }

    test("flag off hides tool and rejects calls", async () => {
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        const flagCtx = buildFlagContext({
            auth: { kind: "user", userId: "u1" },
        });
        const flags = evaluateViewerFlags(
            flagCtx,
            createMemoryFlags({ "mcp-household-digest": false }),
        );
        registerTools(
            server,
            { kind: "user", userId: "u1" },
            true,
            null,
            undefined,
            "http://localhost",
            true,
            flags,
        );
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({
            name: "test-client",
            version: "0.0.0",
        });
        await Promise.all([server.connect(st), client.connect(ct)]);
        try {
            const list = (await client.listTools()).tools.map((t) => t.name);
            expect(list).not.toContain("get_household_digest");
            const resources = await client.listResources();
            expect(
                resources.resources.some(
                    (r) => r.uri === "household://weekly-digest",
                ),
            ).toBe(false);
            await expect(
                client.callTool({
                    name: "get_household_digest",
                    arguments: {},
                }),
            ).rejects.toThrow(/not found/i);
        } finally {
            await client.close();
            await server.close();
        }
    });

    test("flag on returns schema output and respects week_of", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "UTC" };
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
        ];
        await withHouseholdDigestFlag(true, async (call) => {
            const r = await call("get_household_digest", {
                week_of: "2026-08-07",
            });
            expect(r.isError).toBeFalsy();
            const out = HOUSEHOLD_DIGEST_OUTPUT_SCHEMA.parse(
                r.structuredContent,
            );
            expect(out.window).toEqual({
                from: "2026-08-01",
                to: "2026-08-07",
            });
            expect(out.text.length).toBeGreaterThan(0);
        });
    });

    test("invalid week_of is an error", async () => {
        await withHouseholdDigestFlag(true, async (call) => {
            const r = await call("get_household_digest", {
                week_of: "not-a-date",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("week_of");
        });
    });

    test("impossible calendar week_of is an error", async () => {
        await withHouseholdDigestFlag(true, async (call) => {
            for (const bad of ["2026-02-31", "2026-13-01"]) {
                const r = await call("get_household_digest", { week_of: bad });
                expect(r.isError).toBe(true);
                expect(textOf(r)).toMatch(/week_of|calendar/i);
            }
        });
    });

    test("every household member a caller can read appears", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "UTC" };
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
        await withHouseholdDigestFlag(true, async (call) => {
            const r = await call("get_household_digest", {});
            expect(r.isError).toBeFalsy();
            const out = HOUSEHOLD_DIGEST_OUTPUT_SCHEMA.parse(
                r.structuredContent,
            );
            const ids = out.members.map((m) => m.member_id);
            expect(ids).toContain("u1");
            expect(ids).toContain(bob);
        });
    });
});

describe("get_household_digest over HTTP", () => {
    test.each(ERAS)(
        "flag on lists and returns structuredContent (%p)",
        async (era) => {
            db.profile = { ...PROFILE_BASE, timezone: "UTC" };
            db.members = [
                {
                    householdId: "hh-1",
                    userId: "u1",
                    role: "owner",
                    displayName: "U1",
                },
            ];
            setFlagsForTests(
                createMemoryFlags({ "mcp-household-digest": true }),
            );
            try {
                await withHttpClient("u1", era, async (client) => {
                    const names = (await client.listTools()).tools.map(
                        (t) => t.name,
                    );
                    expect(names).toContain("get_household_digest");
                    const r = (await client.callTool({
                        name: "get_household_digest",
                        arguments: {},
                    })) as ToolResult;
                    HOUSEHOLD_DIGEST_OUTPUT_SCHEMA.parse(r.structuredContent);
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );

    test.each(ERAS)(
        "flag off omits get_household_digest from tools/list (%p)",
        async (era) => {
            setFlagsForTests(
                createMemoryFlags({ "mcp-household-digest": false }),
            );
            try {
                await withHttpClient("u1", era, async (client) => {
                    const names = (await client.listTools()).tools.map(
                        (t) => t.name,
                    );
                    expect(names).not.toContain("get_household_digest");
                    const resources = await client.listResources();
                    expect(
                        resources.resources.some(
                            (r) => r.uri === "household://weekly-digest",
                        ),
                    ).toBe(false);
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );
});

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

    test.each(ERAS)(
        "get_household_digest succeeds for household PAT (%p)",
        async (mode) => {
            db.profile = { ...PROFILE_BASE, timezone: "UTC" };
            db.members = [
                {
                    householdId: "hh-1",
                    userId: "u1",
                    role: "owner",
                    displayName: "U1",
                },
            ];
            setFlagsForTests(
                createMemoryFlags({ "mcp-household-digest": true }),
            );
            try {
                await withHouseholdHttp(mode, async (client) => {
                    const r = (await client.callTool({
                        name: "get_household_digest",
                        arguments: {},
                    })) as ToolResult;
                    expect(r.isError).toBeFalsy();
                    HOUSEHOLD_DIGEST_OUTPUT_SCHEMA.parse(r.structuredContent);
                    const resources = await client.listResources();
                    expect(
                        resources.resources.some(
                            (res) => res.uri === "household://weekly-digest",
                        ),
                    ).toBe(true);
                    const payload = await client.readResource({
                        uri: "household://weekly-digest",
                    });
                    const body = payload.contents[0];
                    expect(
                        body && "text" in body && body.text.length,
                    ).toBeGreaterThan(0);
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );
});

describe("off-lookups kill switch over HTTP", () => {
    test.each(ERAS)(
        "lookup_barcode surfaces the paused message (%p)",
        async (mode) => {
            setFlagsForTests(createMemoryFlags({ "off-lookups": false }));
            db.realBarcodeLookup = true;
            try {
                await withHttpClient("u1", mode, async (client) => {
                    const made = await client.callTool({
                        name: "upsert_food",
                        arguments: {
                            name: "Paused lookup food",
                            barcode: "737628064502",
                            calories: 120,
                        },
                    });
                    expect(made.isError).toBeFalsy();
                    const r = await client.callTool({
                        name: "lookup_barcode",
                        arguments: { barcode: "737628064502" },
                    });
                    expect(r.isError).toBeFalsy();
                    const text = (
                        r.content as { type: string; text?: string }[]
                    )
                        .map((c) => c.text ?? "")
                        .join("\n");
                    expect(text).toContain("Online food lookups are paused");
                    expect(text).toContain("Paused lookup food");
                    expect(text).toContain("Source: household catalog");
                    expect(text).not.toContain("Open Food Facts has no fiber");
                    const lookupCall = db.lookupBarcodeCalls.find(
                        (c) => c.barcode === "737628064502",
                    );
                    expect(lookupCall?.options?.householdId).toBe("hh-1");
                });
            } finally {
                resetFlagsForTests();
            }
        },
    );
});

describe("/mcp serves the 2026-07-28 revision", () => {
    test("a negotiating client lands on the modern era", async () => {
        await withHttpClient("u1", "auto", async (client) => {
            expect(client.getProtocolEra()).toBe("modern");
            expect(client.getServerVersion()?.name).toBe("Foodable");
        });
    });

    test("serverInfo.version is the package.json version", async () => {
        await withHttpClient("u1", "auto", async (client) => {
            expect(client.getServerVersion()?.version).toBe(pkg.version);
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
    // nothing a tool registration produces. Paying a database round-trip for it
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
            db.goals = goals({ user_id: "u1" });
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

    // meal-logged is a progress strip against goals: with none it would paint
    // an empty card in the chat, so its three tools drop the link. Every other
    // widget link stays, and the resource itself is still served.
    test.each(ERAS)(
        "without goals the meal tools carry no widget link (%p)",
        async (mode) => {
            db.goals = null;
            await withHttpClient("u1", mode, async (client) => {
                const { tools } = await client.listTools();
                for (const name of [
                    "log_meal",
                    "log_recipe_portion",
                    "update_meal",
                ]) {
                    const tool = tools.find((t) => t.name === name);
                    expect(tool?._meta?.ui).toBeUndefined();
                    expect(
                        tool?._meta?.["openai/outputTemplate"],
                    ).toBeUndefined();
                    expect(tool?.outputSchema?.type).toBe("object");
                }
                expect(
                    tools.find((t) => t.name === "get_goal_progress")?._meta
                        ?.ui,
                ).toEqual({ resourceUri: "ui://widget/goal-progress.html" });
                const res = await client.readResource({
                    uri: "ui://widget/meal-logged.html",
                });
                expect(res.contents).toHaveLength(1);
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

    const MCP_WIDGET_FILES = [
        "nutrition-summary.html",
        "goal-progress.html",
        "meal-logged.html",
        "trends.html",
        "weight-trends.html",
        "import-meals.html",
        "grocery-list.html",
        "fridge.html",
    ] as const;

    const V1_WIDGET_URIS = MCP_WIDGET_FILES.map((f) => widgetUri(f)).sort();
    const ATTENTION_V2_URI = widgetUri("attention.html", true);

    describe("widget-attention flag", () => {
        afterEach(() => resetFlagsForTests());

        test.each(ERAS)(
            "flag off leaves list_notices without ui meta and no attention resource (%p)",
            async (mode) => {
                setFlagsForTests(
                    createMemoryFlags({ "widget-attention": false }),
                );
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const list = tools.find((t) => t.name === "list_notices");
                    expect(list?._meta?.ui).toBeUndefined();
                    expect(
                        list?._meta?.["openai/outputTemplate"],
                    ).toBeUndefined();

                    const { resources } = await client.listResources();
                    const widgetUris = resources
                        .map((r) => r.uri)
                        .filter((u) => u.startsWith("ui://widget/"));
                    expect(widgetUris).not.toContain(ATTENTION_V2_URI);
                });
            },
        );

        test.each(ERAS)(
            "flag on links attention uri, lists and reads the v2 resource (%p)",
            async (mode) => {
                setFlagsForTests(
                    createMemoryFlags({ "widget-attention": true }),
                );
                const assembled = await getWidgetHtml("attention", {
                    v2: true,
                });
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const list = tools.find((t) => t.name === "list_notices");
                    expect(
                        (list?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(ATTENTION_V2_URI);
                    expect(list?._meta?.["openai/outputTemplate"]).toBe(
                        ATTENTION_V2_URI,
                    );

                    const { resources } = await client.listResources();
                    expect(
                        resources.map((r) => r.uri).includes(ATTENTION_V2_URI),
                    ).toBe(true);

                    const res = await client.readResource({
                        uri: ATTENTION_V2_URI,
                    });
                    const c = res.contents[0] as { text?: string };
                    expect(c.text).toBe(assembled);

                    const empty = await client.callTool({
                        name: "list_notices",
                        arguments: {},
                    });
                    const sc0 = empty.structuredContent as {
                        count: number;
                        notices: unknown[];
                    };
                    expect(() =>
                        LIST_NOTICES_OUTPUT_SCHEMA.parse(sc0),
                    ).not.toThrow();
                });
            },
        );

        test.each(ERAS)(
            "flag on list_notices output parses with notices present (%p)",
            async (mode) => {
                setFlagsForTests(
                    createMemoryFlags({ "widget-attention": true }),
                );
                function addDaysUtc(iso: string, delta: number): string {
                    const [y, m, d] = iso.split("-").map(Number);
                    return new Date(Date.UTC(y!, m! - 1, d! + delta))
                        .toISOString()
                        .slice(0, 10);
                }
                await withHttpClient("u1", mode, async (client) => {
                    const loc = await client.callTool({
                        name: "add_fridge_location",
                        arguments: { name: "Fridge" },
                    });
                    const locationId = (loc.structuredContent as { id: string })
                        .id;
                    const today = utcTodayFromDate();
                    const added = await client.callTool({
                        name: "add_fridge_item",
                        arguments: {
                            location_id: locationId,
                            kind: "food",
                            name: "Soon kefir",
                            amount: 1,
                            unit: "g",
                        },
                    });
                    const itemId = (added.structuredContent as { id: string })
                        .id;
                    const row = (await db.fridgeStore.listItems("hh-1")).find(
                        (r) => r.id === itemId,
                    );
                    await db.fridgeStore.updateItem({
                        ...row!,
                        expiresOn: addDaysUtc(today, 4),
                    });

                    const listed = await client.callTool({
                        name: "list_notices",
                        arguments: {},
                    });
                    const sc = listed.structuredContent as {
                        count: number;
                        notices: unknown[];
                    };
                    expect(sc.count).toBeGreaterThanOrEqual(1);
                    for (const n of sc.notices) NOTICE_SCHEMA.parse(n);
                    expect(() =>
                        LIST_NOTICES_OUTPUT_SCHEMA.parse(sc),
                    ).not.toThrow();
                });
            },
        );
    });

    describe("mcp-widgets-v2 flag", () => {
        afterEach(() => resetFlagsForTests());

        test.each(ERAS)(
            "flag off keeps v1 tool _meta URIs and resources/list unchanged (%p)",
            async (mode) => {
                setFlagsForTests(
                    createMemoryFlags({ "mcp-widgets-v2": false }),
                );
                db.goals = goals({ user_id: "u1" });
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const logMeal = tools.find((t) => t.name === "log_meal");
                    expect(logMeal?._meta?.ui).toEqual({
                        resourceUri: MEAL_LOGGED_WIDGET_URI,
                    });
                    expect(logMeal?._meta?.["openai/outputTemplate"]).toBe(
                        MEAL_LOGGED_WIDGET_URI,
                    );
                    const summary = tools.find(
                        (t) => t.name === "get_nutrition_summary",
                    );
                    expect(
                        (summary?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(widgetUri("nutrition-summary.html"));

                    const { resources } = await client.listResources();
                    const widgetUris = resources
                        .map((r) => r.uri)
                        .filter((u) => u.startsWith("ui://widget/"))
                        .sort();
                    expect(widgetUris).toEqual(V1_WIDGET_URIS);
                    expect(widgetUris.some((u) => u.includes("/v2/"))).toBe(
                        false,
                    );
                });
            },
        );

        test.each(ERAS)(
            "flag on links v2 URIs, lists v1 and v2 resources, v2 read matches assembly (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({ "mcp-widgets-v2": true }));
                db.goals = goals({ user_id: "u1" });
                const assembledV2 = await getWidgetHtml("meal-logged", {
                    v2: true,
                });
                const v2Uri = widgetUri("meal-logged.html", true);
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const logMeal = tools.find((t) => t.name === "log_meal");
                    expect(
                        (logMeal?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(v2Uri);
                    expect(logMeal?._meta?.["openai/outputTemplate"]).toBe(
                        v2Uri,
                    );

                    const { resources } = await client.listResources();
                    const widgetUris = resources
                        .map((r) => r.uri)
                        .filter((u) => u.startsWith("ui://widget/"))
                        .sort();
                    const expected = [
                        ...V1_WIDGET_URIS,
                        ...MCP_WIDGET_FILES.map((f) => widgetUri(f, true)),
                    ].sort();
                    expect(widgetUris).toEqual(expected);

                    const res = await client.readResource({ uri: v2Uri });
                    const c = res.contents[0] as {
                        mimeType?: string;
                        text?: string;
                        _meta?: { ui?: { prefersBorder?: boolean } };
                    };
                    expect(c.mimeType).toBe("text/html;profile=mcp-app");
                    expect(c._meta?.ui?.prefersBorder).toBe(true);
                    expect(c.text).toBe(assembledV2);
                    expect(
                        c.text?.trimStart().startsWith("<!doctype html>"),
                    ).toBe(true);
                    expect(c.text).toContain("function initWidget(config)");
                });
            },
        );
    });

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
        db.goals = goals({ user_id: "u1" });
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

    // The ?v= asset hashes exist only once the app CSS and JS are assembled.
    // The server warms them at boot; here nothing does, so without this the
    // hash assertions pass or fail on whichever test file ran first.
    beforeAll(async () => {
        await getAppCss();
        await getAppJs();
    });

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
            recipeSearchPlaces: [],
            preferences: { ...EMPTY_HOUSEHOLD_PREFERENCES },
        };
    });

    test("GET /share opens the import modal prefilled from share params", async () => {
        const r = await siteApp.request(
            "http://x/share?text=https%3A%2F%2Fvm.tiktok.com%2FZM123%2F",
            { headers: { cookie: cookieFor(alice) } },
        );
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('id="recipe-import-url"');
        expect(html).toContain("data-modal-open-on-load");
        expect(html).toContain("vm.tiktok.com/ZM123");
        expect(html).toContain("What arrived");
        expect(html).not.toContain('name="text_origin"');
    });

    test("GET /share with link and caption opens paste step with text_origin", async () => {
        const qs = new URLSearchParams({
            url: "https://www.instagram.com/p/abc/",
            text: "Garlic noodles\n1 lb pasta\nhttps://www.instagram.com/p/abc/",
        });
        const r = await siteApp.request(`http://x/share?${qs}`, {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await r.text();
        expect(html).toContain('name="text_origin" value="shared"');
        expect(html).toContain("Paste the caption");
    });

    test("GET /share does not create recipes", async () => {
        const before = (await db.recipesStore.listRecipes("hh-1")).length;
        const r = await siteApp.request(
            "http://x/share?text=" +
                encodeURIComponent(
                    "Weeknight pasta\n\n1 lb spaghetti\n2 cloves garlic",
                ),
            { headers: { cookie: cookieFor(alice) } },
        );
        expect(r.status).toBe(200);
        const after = (await db.recipesStore.listRecipes("hh-1")).length;
        expect(after).toBe(before);
    });

    test("GET /share/probe escapes raw text", async () => {
        const r = await siteApp.request(
            "http://x/share/probe?text=%3Cscript%3Ealert(1)%3C/script%3E",
            { headers: { cookie: cookieFor(alice) } },
        );
        const html = await r.text();
        expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
        expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    });

    test("signed-out long share survives site login redirect", async () => {
        const longText = "q".repeat(2100);
        const qs = new URLSearchParams({ text: longText });
        const loginRes = await siteApp.request(`http://x/share?${qs}`);
        expect(loginRes.status).toBe(200);
        const loginHtml = await loginRes.text();
        const sessionMatch = loginHtml.match(
            /name="session_id" value="([^"]+)"/,
        );
        expect(sessionMatch).not.toBeNull();
        const approveRes = await siteApp.request("http://x/approve", {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                session_id: sessionMatch![1]!,
                email: "alice@example.com",
                password: "password1234",
            }).toString(),
            redirect: "manual",
        });
        expect(approveRes.status).toBe(302);
        const loc = approveRes.headers.get("location") ?? "";
        expect(loc.startsWith("/share?")).toBe(true);
        const returnedText = new URL(loc, "http://x").searchParams.get("text");
        expect(returnedText).toBe(longText);
    });

    test("a site cookie renders the viewer's dashboard widgets", async () => {
        const r = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Alice</h1>");
        expect(html).toContain("widget-frame");
        expect(html).not.toContain("srcdoc");
        expect(html).not.toContain("window.__WIDGET_DATA__=");
        expect(html).toContain('src="/app/widgets/nutrition-summary?v=');
        expect(html).toContain("data-widget-data=");
        expect(html).toContain('title="nutrition-summary"');
        expect(html).not.toContain("You can look, not edit");
        expect(html).not.toContain('action="/approve"');
        expect(html).not.toContain('action="/add-household-member"');
        expect(html).toContain('action="/log-meal"');
        expect(html).not.toContain('name="log_meal"');
        expect(html).not.toContain('class="facts"');
        expect(html).toContain('class="bottom-nav"');
        expect(html).toContain('href="/kitchen/fridge"');
        expect(html).toMatch(/href="\/app\.css\?v=[a-f0-9]{12}"/);
        expect(html).toMatch(/src="\/app\.js\?v=[a-f0-9]{12}"/);
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
        expect(html).toContain('class="peer-view-tag"');
        expect(html).not.toContain('commandfor="nutrition-arrange"');
        expect(html).not.toContain('commandfor="nutrition-log-meal"');
        expect(html).not.toContain('action="/add-household-member"');
    });

    test("POST /settings/household as owner adds a username member", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=password1234&username=kid",
        });
        expect(r.status).toBe(303);
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
            body: "display_name=Kid&password=password1234&username=kid",
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
        expect(r.status).toBe(303);
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
        expect(r.status).toBe(303);
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
        expect(html).toContain("Password must be at least 12 characters.");
        expect(html).toContain('action="/settings/household"');
        expect(html).toMatch(
            /<dialog class="modal" id="household-add-member"[^>]*data-modal-open-on-load/,
        );
        expect(db.addedLogins).toEqual([]);
        expect(db.members.map((m) => m.displayName)).toEqual(["Alice", "Bob"]);
    });

    test("POST /settings/household logged out does not add a member", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid&password=password1234&username=kid",
        });
        expect(r.status).toBe(401);
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
            body: "display_name=Kid&password=password1234&username=kid",
        });
        const r = await siteApp.request("http://x/settings/household", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "display_name=Kid2&password=password1234&username=kid",
        });
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("That login is already in use.");
        expect(html).toContain('action="/settings/household"');
        expect(
            db.members.filter((m) => m.displayName.startsWith("Kid")),
        ).toHaveLength(1);
    });

    test("GET /kitchen/fridge returns the inventory page with Fridge active", async () => {
        const r = await siteApp.request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Fridge</h1>");
        expect(html).toContain("Add a location, then add an item.");
        expect(html).toContain('action="/kitchen/fridge/locations"');
        expect(html).not.toContain("Coming soon.");
        expect(html).toContain('href="/kitchen/fridge" aria-current="page"');
        expect(html).not.toContain('class="facts"');
    });

    test("POST /kitchen/fridge/locations adds Pantry for any member", async () => {
        const r = await siteApp.request("http://x/kitchen/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(bob),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Pantry",
        });
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/kitchen/fridge");
        const page = await siteApp.request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Pantry");
        expect(html).toContain('class="food-picker"');
        expect(html).toContain('class="quantity-field"');
        expect(html).toContain("Add an item to Pantry.");
    });

    test("POST /kitchen/fridge/items adds a supply with the entered unit", async () => {
        await siteApp.request("http://x/kitchen/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Pantry",
        });
        const listed = await db.fridgeStore.listLocations("hh-1");
        const locationId = listed[0]!.id;
        const add = await siteApp.request("http://x/kitchen/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=supply&location_id=${locationId}&name=Foil&qty_amount=2&qty_unit=roll`,
        });
        expect(add.status).toBe(303);
        const page = await siteApp.request("http://x/kitchen/fridge", {
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

    test("POST /kitchen/fridge/items adds barcode food in grams", async () => {
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
        await siteApp.request("http://x/kitchen/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Fridge",
        });
        const locationId = (await db.fridgeStore.listLocations("hh-1"))[0]!.id;
        const add = await siteApp.request("http://x/kitchen/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=food&location_id=${locationId}&barcode=070852010016&qty_amount=1360.8&qty_unit=g`,
        });
        expect(add.status).toBe(303);
        const page = await siteApp.request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain("Good Culture Cottage Cheese");
        expect(html).toContain("1360.8 g");
    });

    test("POST /kitchen/fridge/items/:id updates quantity and move, then delete removes it", async () => {
        await siteApp.request("http://x/kitchen/fridge/locations", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Fridge",
        });
        await siteApp.request("http://x/kitchen/fridge/locations", {
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
        await siteApp.request("http://x/kitchen/fridge/items", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=supply&location_id=${fridge.id}&name=Foil&qty_amount=2&qty_unit=roll`,
        });
        const item = (await db.fridgeStore.listItems("hh-1"))[0]!;
        const save = await siteApp.request(
            `http://x/kitchen/fridge/items/${item.id}`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `qty_amount=1&qty_unit=roll&location_id=${pantry.id}`,
            },
        );
        expect(save.status).toBe(303);
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
            `http://x/kitchen/fridge/items/${item.id}/delete`,
            {
                method: "POST",
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(del.status).toBe(303);
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

    test("POST /kitchen/fridge/items/:id rejects an item that is already gone", async () => {
        const missing = "00000000-0000-4000-8000-000000000099";
        const edit = await postForm(
            `/kitchen/fridge/items/${missing}`,
            alice,
            "qty_amount=1",
        );
        expect(edit.status).toBe(400);
        expect(edit.headers.get("location")).toBeNull();
        expect(edit.headers.get("set-cookie") ?? "").not.toContain(
            "foodable_toast",
        );
        const html = await edit.text();
        expect(html).toContain('class="error-banner"');
        expect(html).toContain("That item is no longer in the fridge.");
        expect(
            html.match(/That item is no longer in the fridge\./g)?.length,
        ).toBe(1);
        expect(html).not.toContain("Fridge item updated");
        expect(html).not.toMatch(/data-modal-open-on-load/);
        const head = html.indexOf('class="dash-head"');
        const banner = html.indexOf('class="error-banner"');
        expect(head).toBeGreaterThan(-1);
        expect(banner).toBeGreaterThan(head);
        expect(banner).toBeLessThan(html.indexOf("<dialog"));
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        expect(await db.foodsStore.listFoods("hh-1")).toEqual([]);

        const withMove = await postForm(
            `/kitchen/fridge/items/${missing}`,
            alice,
            "qty_amount=1&qty_unit=g&location_id=not-a-location&expires_on=2026-12-01",
        );
        expect(withMove.status).toBe(400);
        expect(withMove.headers.get("location")).toBeNull();
        expect(withMove.headers.get("set-cookie") ?? "").not.toContain(
            "foodable_toast",
        );
        const moveHtml = await withMove.text();
        expect(moveHtml).toContain("That item is no longer in the fridge.");
        expect(moveHtml).not.toContain("Unknown location.");
        expect(moveHtml).not.toContain("Fridge item updated");
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        expect(await db.foodsStore.listFoods("hh-1")).toEqual([]);
        expect(await db.stockStore.listMovements("hh-1")).toEqual([]);
    });

    test("POST /kitchen/fridge/items/:id/delete rejects an item that is already gone", async () => {
        const missing = "00000000-0000-4000-8000-000000000099";
        const del = await postForm(
            `/kitchen/fridge/items/${missing}/delete`,
            alice,
        );
        expect(del.status).toBe(400);
        expect(del.headers.get("location")).toBeNull();
        expect(del.headers.get("set-cookie") ?? "").not.toContain(
            "foodable_toast",
        );
        const html = await del.text();
        expect(html).toContain('class="error-banner"');
        expect(html).toContain("That item is no longer in the fridge.");
        expect(
            html.match(/That item is no longer in the fridge\./g)?.length,
        ).toBe(1);
        expect(html).not.toContain("Removed from the fridge");
        expect(html).not.toMatch(/data-modal-open-on-load/);
        const head = html.indexOf('class="dash-head"');
        const banner = html.indexOf('class="error-banner"');
        expect(head).toBeGreaterThan(-1);
        expect(banner).toBeGreaterThan(head);
        expect(banner).toBeLessThan(html.indexOf("<dialog"));
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        expect(await db.stockStore.listMovements("hh-1")).toEqual([]);
    });

    test("GET /kitchen/fridge is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<h1>Fridge</h1>");
    });

    test("GET /kitchen/groceries lists by store and GET /recipes is the cookbook", async () => {
        const grocery = await siteApp.request("http://x/kitchen/groceries", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(grocery.status).toBe(200);
        const groceryHtml = await grocery.text();
        expect(groceryHtml).toContain("<h1>Groceries</h1>");
        expect(groceryHtml).toContain(
            'href="/kitchen/groceries" aria-current="page"',
        );
        expect(groceryHtml).not.toContain("Coming soon.");
        expect(groceryHtml).toContain("Add a grocery store");
        expect(groceryHtml).toContain('class="grocery-add-store"');
        expect(groceryHtml).toContain('action="/kitchen/groceries/stores"');
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

    test("POST /recipes/import with retry only refetches after remembered refusal", async () => {
        const denied = createMemoryFetchMemoryStore();
        await denied.recordRefusal(
            "hh-1",
            "memroute.example",
            403,
            new Date("2026-06-01T00:00:00.000Z"),
        );
        db.fetchMemoryStore = denied;
        let fetchCalls = 0;
        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage(
                url: string,
                _opts: { accept: string[] },
            ): Promise<FetchOutcome> {
                fetchCalls += 1;
                expect(url).toContain("memroute.example");
                return {
                    ok: false,
                    reason: "site_refused",
                    status: 403,
                    detail: "403",
                    url,
                };
            },
        };
        const r = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                url: "https://memroute.example/recipe",
                retry: "1",
            }).toString(),
        });
        expect(r.status).toBe(422);
        expect(fetchCalls).toBe(1);
    });

    test("shared text_origin survives import 422 retry", async () => {
        const { join } = await import("node:path");
        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                throw new Error("fetch should not run in shared origin test");
            },
        };
        const noRecipe = "Recipe in my bio 👆\n#food #dinner";
        const first = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                text_only: "1",
                text_origin: "shared",
                text: noRecipe,
            }).toString(),
        });
        expect(first.status).toBe(422);
        const firstHtml = await first.text();
        expect(firstHtml).toContain('name="text_origin" value="shared"');

        const caption = await Bun.file(
            join(import.meta.dir, "domain/fixtures/captions/clean-headers.txt"),
        ).text();
        const second = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                text_only: "1",
                text_origin: "shared",
                text: caption,
            }).toString(),
        });
        expect(second.status).toBe(303);
        const recipeId = (second.headers.get("location") ?? "").slice(
            "/recipes/".length,
        );
        const imp = await db.recipesStore.getImport("hh-1", recipeId);
        expect(imp?.sourceTextOrigin).toBe("shared");

        // A bad link beside a shared caption keeps the caption and its origin.
        const badLink = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                text_only: "1",
                text_origin: "shared",
                url: "not a link",
                text: "Keep this caption",
            }).toString(),
        });
        expect(badLink.status).toBe(422);
        const badHtml = await badLink.text();
        expect(badHtml).toContain("Keep this caption");
        expect(badHtml).toContain('name="text_origin" value="shared"');
        expect(badHtml).toContain("That doesn't look like a web link.");
    });

    test("POST /recipes/import paste flow for Instagram and Pinterest website_url", async () => {
        const { join } = await import("node:path");
        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                throw new Error("fetch should not run in paste flow test");
            },
        };
        const caption = await Bun.file(
            join(import.meta.dir, "domain/fixtures/captions/clean-headers.txt"),
        ).text();
        const pasteNeeded = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "url=https%3A%2F%2Fwww.instagram.com%2Fp%2Fweb-import%2F",
        });
        expect(pasteNeeded.status).toBe(422);
        const pasteHtml = await pasteNeeded.text();
        expect(pasteHtml).toContain("Paste the Instagram caption below.");
        expect(pasteHtml).toContain("Open the post");
        expect(pasteHtml).toContain('name="text"');

        const imported = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                url: "https://www.instagram.com/p/web-import/",
                text: caption,
                credit: "Web Chef",
            }).toString(),
        });
        expect(imported.status).toBe(303);
        const recipeId = (imported.headers.get("location") ?? "").slice(
            "/recipes/".length,
        );
        expect(recipeId.length).toBeGreaterThan(0);

        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                return {
                    ok: true as const,
                    url: "https://example.com/pin-target",
                    status: 200,
                    contentType: "text/html",
                    body: await Bun.file(
                        join(
                            import.meta.dir,
                            "domain/fixtures/recipe-pages/array-top-level.html",
                        ),
                    ).text(),
                };
            },
        };
        const pinSite = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                url: "https://www.pinterest.com/pin/site-only/",
                website_url: "https://example.com/pin-target",
                credit: "Pin Chef",
            }).toString(),
        });
        expect(pinSite.status).toBe(303);
        const pinRecipeId = (pinSite.headers.get("location") ?? "").slice(
            "/recipes/".length,
        );
        const pinImport = await db.recipesStore.getImport("hh-1", pinRecipeId);
        expect(pinImport?.credit).toBe("Pin Chef");

        const pinBadSite = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                url: "https://www.pinterest.com/pin/bad-site/",
                website_url: "javascript:alert(1)",
                text: "Saved caption text",
                credit: "Still Here",
            }).toString(),
        });
        expect(pinBadSite.status).toBe(422);
        const pinBadHtml = await pinBadSite.text();
        expect(pinBadHtml).toContain("That doesn't look like a web link.");
        expect(pinBadHtml).toContain("Saved caption text");
        expect(pinBadHtml).toContain('value="Still Here"');

        // A website link that validates but can't be read falls back to the
        // pasted caption under the pin's link; with no caption the Pinterest
        // step stays open with what was typed.
        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                return {
                    ok: false as const,
                    reason: "not_found" as const,
                    status: 404,
                    detail: "gone",
                };
            },
        };
        const pinFallback = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                url: "https://www.pinterest.com/pin/fallback/",
                website_url: "https://example.com/gone",
                text: "Ingredients:\n2 cups flour\nMethod:\n1. Mix",
                credit: "Fallback Chef",
            }).toString(),
        });
        expect(pinFallback.status).toBe(303);
        const fallbackId = (pinFallback.headers.get("location") ?? "").slice(
            "/recipes/".length,
        );
        const fallbackImport = await db.recipesStore.getImport(
            "hh-1",
            fallbackId,
        );
        expect(fallbackImport?.sourceKind).toBe("pinterest");
        expect(fallbackImport?.credit).toBe("Fallback Chef");

        const pinGone = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                url: "https://www.pinterest.com/pin/gone/",
                website_url: "https://example.com/gone-too",
                credit: "Kept Chef",
            }).toString(),
        });
        expect(pinGone.status).toBe(422);
        const pinGoneHtml = await pinGone.text();
        expect(pinGoneHtml).toContain("That page doesn't exist anymore.");
        expect(pinGoneHtml).toContain('value="Kept Chef"');
        expect(pinGoneHtml).toContain("Recipe website link");

        const pinEmpty = await siteApp.request("http://x/recipes/import", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                import_step: "paste",
                url: "https://www.pinterest.com/pin/empty/",
            }).toString(),
        });
        expect(pinEmpty.status).toBe(422);
        expect(await pinEmpty.text()).toContain(
            "Paste the recipe website link or the recipe.",
        );
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
        expect(create.status).toBe(303);
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
        expect(addIng.status).toBe(303);
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
        // From the Settings › Saved page, Delete returns there.
        const ownerDel = await siteApp.request(
            `http://x/recipes/${bobId}/delete`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "from=%2Fsettings%2Fsaved",
            },
        );
        expect(ownerDel.status).toBe(303);
        expect(ownerDel.headers.get("location")).toBe("/settings/saved");
        const left = await db.recipesStore.listRecipes("hh-1");
        expect(left.map((row) => row.id)).toEqual([recipeId]);

        // Any other settings or off-site path falls back to /recipes.
        const offsite = await siteApp.request(
            `http://x/recipes/${recipeId}/delete`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "from=%2F%2Fevil.com",
            },
        );
        expect(offsite.status).toBe(303);
        expect(offsite.headers.get("location")).toBe("/recipes");
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

    test("POST add-to-grocery redirects when recipe is unverified", async () => {
        const imported = await importRecipeFromText(
            db.recipesStore,
            db.foodsStore,
            {
                householdId: "hh-1",
                creatorId: alice,
                text: "paste",
                instructions: "",
                name: "Unverified web",
                ingredients: [{ name: "Flour", amount: 50, unit: "g" }],
            },
            { lookup: async () => null },
        );
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Shop",
        );
        const res = await siteApp.request(
            `http://x/recipes/${imported.recipe.id}/add-to-grocery`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `store_id=${store.id}&total_portions=1`,
            },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(
            `/recipes/${imported.recipe.id}`,
        );
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
    });

    test("POST cook redirects when recipe is unverified", async () => {
        const imported = await importRecipeFromText(
            db.recipesStore,
            db.foodsStore,
            {
                householdId: "hh-1",
                creatorId: alice,
                text: "paste",
                instructions: "",
                name: "Unverified cook",
                ingredients: [{ name: "Flour", amount: 50, unit: "g" }],
            },
            { lookup: async () => null },
        );
        const res = await siteApp.request(
            `http://x/recipes/${imported.recipe.id}/cook`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "total_portions=1",
            },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(
            `/recipes/${imported.recipe.id}`,
        );
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
    });

    test("POST log-portion redirects when recipe is unverified", async () => {
        const imported = await importRecipeFromText(
            db.recipesStore,
            db.foodsStore,
            {
                householdId: "hh-1",
                creatorId: alice,
                text: "paste",
                instructions: "",
                name: "Unverified log",
                ingredients: [{ name: "Flour", amount: 50, unit: "g" }],
            },
            { lookup: async () => null },
        );
        const res = await siteApp.request(
            `http://x/recipes/${imported.recipe.id}/log-portion`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "portions=1&meal_type=lunch",
            },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(
            `/recipes/${imported.recipe.id}`,
        );
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
    });

    test("POST unresolved marks a line handled and rechecks", async () => {
        const recipe = await db.recipesStore.insertRecipe({
            id: crypto.randomUUID(),
            householdId: "hh-1",
            creatorId: alice,
            name: "Line soup",
            yieldPortions: 1,
            instructions: "Simmer.",
            sourceUrl: null,
            tags: [],
            notes: null,
            prepMinutes: null,
            cookMinutes: null,
            verification: "unverified",
            updatedAt: new Date().toISOString(),
        });
        await db.recipesStore.upsertImport({
            recipeId: recipe.id,
            householdId: "hh-1",
            sourceKind: "text",
            sourceUrl: null,
            sourceText: "x",
            sourceTextOrigin: "pasted",
            transcript: null,
            credit: null,
            unresolvedLines: ["2 eggs 1 cup flour", "keep me"],
            problems: [],
            importedAt: new Date().toISOString(),
        });
        const res = await siteApp.request(
            `http://x/recipes/${recipe.id}/unresolved`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    line: "2 eggs 1 cup flour",
                }).toString(),
            },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe(`/recipes/${recipe.id}`);
        expect(
            (await db.recipesStore.getImport("hh-1", recipe.id))
                ?.unresolvedLines,
        ).toEqual(["keep me"]);
    });

    test("POST verify on unknown recipe redirects to list with toast", async () => {
        const res = await siteApp.request(
            `http://x/recipes/${crypto.randomUUID()}/verify`,
            {
                method: "POST",
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(res.status).toBe(303);
        expect(res.headers.get("location")).toBe("/recipes");
        expect(res.headers.get("set-cookie") ?? "").toContain("foodable_toast");
    });

    test("POST /kitchen/groceries/lines adds a supply and checking it does not insert fridge stock", async () => {
        const store = await createGroceryStore(
            db.settingsStore,
            "hh-1",
            "Safeway",
        );
        const sections = await db.settingsStore.listSections(store.id);
        const other = sections.find((row) => row.isOther)!;
        const add = await siteApp.request("http://x/kitchen/groceries/lines", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=supply&store_id=${store.id}&section_id=${other.id}&name=Foil&qty_amount=1&qty_unit=roll`,
        });
        expect(add.status).toBe(303);
        const lines = await db.groceryStore.listLines("hh-1");
        expect(lines).toHaveLength(1);
        expect(lines[0]?.displayName).toBe("Foil");
        const check = await siteApp.request(
            `http://x/kitchen/groceries/lines/${lines[0]!.id}/check`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "checked=1",
            },
        );
        expect(check.status).toBe(303);
        expect((await db.groceryStore.listLines("hh-1"))[0]?.checked).toBe(
            true,
        );
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        const page = await siteApp.request("http://x/kitchen/groceries", {
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
        const clear = await siteApp.request(
            "http://x/kitchen/groceries/clear-checked",
            {
                method: "POST",
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(clear.status).toBe(303);
        expect(await db.groceryStore.listLines("hh-1")).toEqual([]);
    });

    test("POST /kitchen/groceries/lines warns on peanut for an affected member", async () => {
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
        const add = await siteApp.request("http://x/kitchen/groceries/lines", {
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
        expect(html).toContain('data-blocking="true"');
        expect(html.toLowerCase()).toContain("peanut");
        expect(html).toContain("Bob");
        expect(html).toContain('name="confirm_allergen" value="1"');
        expect(html).toContain("Add anyway");
        const modal = html.match(
            /<dialog class="modal" id="grocery-add-food"[\s\S]*?<\/dialog>/,
        )?.[0];
        expect(modal).toContain("allergen-warning");
        expect(modal).toContain(`name="store_id" value="${store.id}"`);
        expect(await db.groceryStore.listLines("hh-1")).toEqual([]);
    });

    test("POST /kitchen/groceries/lines confirm_allergen override succeeds after allergen block", async () => {
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
        const ok = await siteApp.request("http://x/kitchen/groceries/lines", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: `kind=food&store_id=${store.id}&food_name=Peanut%20Butter&qty_amount=100&confirm_allergen=1`,
        });
        expect(ok.status).toBe(303);
        const lines = await db.groceryStore.listLines("hh-1");
        expect(lines).toHaveLength(1);
        expect(lines[0]?.displayName).toBe("Peanut Butter");
    });

    test("GET /kitchen/groceries is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/kitchen/groceries", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("household membership");
        expect(html).not.toContain("<h1>Groceries</h1>");
    });

    test("POST /kitchen/groceries/stores as owner adds Corner on the grocery page", async () => {
        const add = await siteApp.request("http://x/kitchen/groceries/stores", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "name=Corner",
        });
        expect(add.status).toBe(303);
        expect(add.headers.get("location")).toBe("/kitchen/groceries");
        const stores = await db.settingsStore.listStores("hh-1");
        expect(stores.map((row) => row.name)).toEqual(["Corner"]);
        const page = await siteApp.request("http://x/kitchen/groceries", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(html).toContain('<h2 class="row-title">Corner</h2>');
        expect(html).toContain('class="grocery-add-store"');
        expect(html).not.toContain("<h3>Add supply</h3>");
        expect(html).not.toContain("grocery-add-supply");
    });

    test("POST /kitchen/groceries/stores with an empty name re-renders grocery with the error", async () => {
        const add = await siteApp.request("http://x/kitchen/groceries/stores", {
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
        expect(html).toContain('action="/kitchen/groceries/stores"');
        expect(html).not.toContain("<h3>Add supply</h3>");
        expect(await db.settingsStore.listStores("hh-1")).toEqual([]);
    });

    test("GET /kitchen/groceries as a member has no add-store form", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request("http://x/kitchen/groceries", {
            headers: { cookie: cookieFor(bob) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Groceries</h1>");
        expect(html).not.toContain("grocery-add-store");
        expect(html).not.toContain('action="/kitchen/groceries/stores"');
        expect(html).not.toContain("<h3>Add supply</h3>");
    });

    test("POST /kitchen/groceries/stores as a member is refused", async () => {
        const add = await siteApp.request("http://x/kitchen/groceries/stores", {
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
        expect(html).toContain('href="/settings/help"');
        expect(html).toContain('href="/settings" aria-current="page"');
        expect(html).toContain(
            '<a href="/logout" data-turbo="false">Log out</a>',
        );
        expect(html).not.toContain("bottom-nav");
        expect(html).toContain('name="foodable-theme-chrome" content="page"');
        expect(html).not.toContain("coming-soon");
    });

    test("GET /settings/household/items lists the catalog", async () => {
        const r = await siteApp.request("http://x/settings/household/items", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Items</h1>");
        expect(html).toContain(
            'href="/settings/household/items" aria-current="page"',
        );
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

    test("GET /settings/household ignores invalid refusals_after cursor", async () => {
        db.fetchMemoryStore = {
            ...createMemoryFetchMemoryStore(),
            async listRefusals(_hh, opts) {
                expect(opts.after).toBeUndefined();
                return [];
            },
        };
        const r = await siteApp.request(
            "http://x/settings/household?refusals_after=not-a-date%7Cexample.com",
            {
                headers: { cookie: cookieFor(alice) },
            },
        );
        expect(r.status).toBe(200);
    });

    test("GET /settings/household as a member is read-only", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(bob) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Household</h1>");
        expect(html).not.toContain('commandfor="household-add-member"');
        expect(html).not.toContain('action="/settings/household/stores"');
    });

    test("GET /settings/help is available to members", async () => {
        const r = await siteApp.request("http://x/settings/help", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain("<h1>Help</h1>");
        expect(html).toContain('href="/settings/help" aria-current="page"');
        expect(html).toContain('id="food-vs-household-item"');
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
        expect(add.status).toBe(303);
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
        expect(r.status).toBe(303);
        expect(r.headers.get("location")).toBe("/");
    });

    test("POST /nutrition/layout moves a card for the signed-in viewer", async () => {
        db.profile = {
            ...PROFILE_BASE,
            user_id: alice,
            nutrition_layout: null,
        };
        const move = await postForm(
            "/nutrition/layout",
            alice,
            "card=goal-progress&direction=up",
        );
        expect(move.status).toBe(303);
        expect(move.headers.get("location")).toBe("/");
        expect(db.profile?.nutrition_layout).toEqual([
            "goal-progress",
            "nutrition-summary",
            "trends",
            "weight-trends",
        ]);
        const page = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await page.text();
        expect(
            html.indexOf('data-nutrition-card="goal-progress"'),
        ).toBeLessThan(html.indexOf('data-nutrition-card="nutrition-summary"'));
    });

    test("POST /nutrition/layout with a peer member is rejected and saves nothing", async () => {
        db.profile = {
            ...PROFILE_BASE,
            user_id: alice,
            nutrition_layout: null,
        };
        const move = await postForm(
            "/nutrition/layout",
            alice,
            `card=trends&direction=up&member=${encodeURIComponent(bob)}`,
        );
        expect(move.status).toBe(403);
        const html = await move.text();
        expect(html).toContain(
            "You can only arrange your own nutrition dashboard.",
        );
        expect(db.profile?.nutrition_layout).toBeNull();
    });

    test("POST /nutrition/layout rejects an unknown card", async () => {
        const r = await postForm(
            "/nutrition/layout",
            alice,
            "card=not-a-card&direction=up",
        );
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("Unknown card.");
        expect(html).toMatch(
            /<dialog class="modal" id="nutrition-arrange"[^>]*data-modal-open-on-load/,
        );
        expect(db.profilePatches.at(-1)).not.toHaveProperty("nutrition_layout");
    });

    test("POST /nutrition/layout saves a full order list", async () => {
        db.profile = {
            ...PROFILE_BASE,
            user_id: alice,
            nutrition_layout: null,
        };
        const order =
            "order=weight-trends&order=nutrition-summary&order=goal-progress&order=trends";
        const save = await postForm("/nutrition/layout", alice, order);
        expect(save.status).toBe(303);
        expect(db.profile?.nutrition_layout).toEqual([
            "weight-trends",
            "nutrition-summary",
            "goal-progress",
            "trends",
        ]);
    });

    test("POST /nutrition/layout rejects an invalid full order", async () => {
        const bad =
            "order=nutrition-summary&order=nutrition-summary&order=goal-progress&order=trends";
        const r = await postForm("/nutrition/layout", alice, bad);
        expect(r.status).toBe(400);
        const html = await r.text();
        expect(html).toContain("Duplicate card in order.");
        expect(html).toMatch(
            /<dialog class="modal" id="nutrition-arrange"[^>]*data-modal-open-on-load/,
        );
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
        expect(save.status).toBe(303);
        expect(save.headers.get("location")).toBe("/settings");
        expect(db.profile?.theme).toBe("dark");
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await r.text();
        expect(html).toContain('<html lang="en" data-theme="dark">');
        expect(html).not.toContain("--accent");
    });

    test("POST /settings with from=/kitchen/fridge redirects back with query", async () => {
        const save = await siteApp.request("http://x/settings", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "group=account&theme=light&from=%2Fkitchen%2Ffridge",
        });
        expect(save.status).toBe(303);
        expect(save.headers.get("location")).toBe(
            "/settings?from=%2Fkitchen%2Ffridge",
        );
    });

    test("POST /settings ignores unsafe from in redirect", async () => {
        const save = await siteApp.request("http://x/settings", {
            method: "POST",
            headers: {
                cookie: cookieFor(alice),
                "content-type": "application/x-www-form-urlencoded",
            },
            body: "group=account&theme=light&from=//evil.example",
        });
        expect(save.status).toBe(303);
        expect(save.headers.get("location")).toBe("/settings");
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
        expect(save.status).toBe(303);
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
        expect(html).toContain('class="peer-view-tag"');
        expect(html).not.toContain("You can look, not edit");
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
        expect(r.status).toBe(303);
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

// ---------- share links: create_share_link / list_share_links / revoke_share_link ----------

describe("share link tools", () => {
    const TOKEN_URL = /^http:\/\/localhost\/s\/([A-Za-z0-9_-]{43})$/;
    const OTHER_HOUSEHOLD = "hh-2";
    const SHARE_TOOLS = [
        "create_share_link",
        "list_share_links",
        "revoke_share_link",
        "import_shared_recipe",
    ];

    async function withShareLinks(
        on: boolean,
        auth:
            | { kind: "user"; userId: string }
            | {
                  kind: "household";
                  householdId: string;
              },
        run: (call: CallTool, client: Client) => Promise<void>,
    ) {
        const member = db.members[0];
        const flags = evaluateViewerFlags(
            buildFlagContext({
                auth,
                member:
                    auth.kind === "user" && member
                        ? {
                              userId: member.userId,
                              householdId: member.householdId,
                              role: member.role,
                              displayName: member.displayName,
                          }
                        : undefined,
            }),
            createMemoryFlags({ "mcp-share-links": on }),
        );
        const server = new McpServer(
            { name: "foodable-test", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(
            server,
            auth,
            true,
            null,
            undefined,
            "http://localhost",
            true,
            flags,
        );
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "test-client", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        try {
            await run(
                async (name, args) =>
                    (await client.callTool({
                        name,
                        arguments: args ?? {},
                    })) as ToolResult,
                client,
            );
        } finally {
            await client.close();
            await server.close();
        }
    }

    const asU1 = { kind: "user", userId: "u1" } as const;

    async function seedRecipe(householdId: string, name = "Lentil soup") {
        return createRecipe(db.recipesStore, {
            householdId,
            creatorId: "u1",
            name,
            yieldPortions: 4,
        });
    }

    function tokenOf(r: ToolResult): string {
        const url = String(r.structuredContent?.url);
        const m = TOKEN_URL.exec(url);
        if (!m) throw new Error(`unexpected share url: ${url}`);
        return m[1]!;
    }

    test("flag on lists the three tools; flag off hides them and refuses a call", async () => {
        await withShareLinks(true, asU1, async (_call, client) => {
            const names = (await client.listTools()).tools.map((t) => t.name);
            for (const name of SHARE_TOOLS) expect(names).toContain(name);
        });
        await withShareLinks(false, asU1, async (call, client) => {
            const names = (await client.listTools()).tools.map((t) => t.name);
            for (const name of SHARE_TOOLS) expect(names).not.toContain(name);
            await expect(
                client.callTool({
                    name: "create_share_link",
                    arguments: { kind: "grocery_list" },
                }),
            ).rejects.toThrow(/not found/i);
            expect(await db.shareLinksStore.listForHousehold("hh-1")).toEqual(
                [],
            );
            void call;
        });
    });

    test("create_share_link for a recipe returns the url once and the link resolves", async () => {
        const recipe = await seedRecipe("hh-1");
        await withShareLinks(true, asU1, async (call) => {
            const r = await call("create_share_link", {
                kind: "recipe",
                target_id: recipe.id,
                expires_in_days: 7,
            });
            expect(r.isError).toBeFalsy();
            const parsed = SHARE_LINK_OUTPUT_SCHEMAS.create.parse(
                r.structuredContent,
            );
            expect(parsed.kind).toBe("recipe");
            expect(parsed.target_id).toBe(recipe.id);
            expect(parsed.url).toMatch(TOKEN_URL);
            expect(r.content[0]!.text).toContain(parsed.url);
            const expiresMs = Date.parse(parsed.expires_at!);
            expect(expiresMs - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
            expect(expiresMs - Date.now()).toBeLessThan(7.1 * 86_400_000);

            const link = await resolveShareToken(
                db.shareLinksStore,
                tokenOf(r),
                new Date(),
            );
            expect(link).toMatchObject({
                id: parsed.id,
                householdId: "hh-1",
                kind: "recipe",
                targetId: recipe.id,
                createdBy: "u1",
            });
        });
    });

    test("create_share_link for the grocery list needs no target and may never expire", async () => {
        await withShareLinks(true, asU1, async (call) => {
            const r = await call("create_share_link", { kind: "grocery_list" });
            expect(r.isError).toBeFalsy();
            const parsed = SHARE_LINK_OUTPUT_SCHEMAS.create.parse(
                r.structuredContent,
            );
            expect(parsed).toMatchObject({
                kind: "grocery_list",
                target_id: null,
                expires_at: null,
            });
            const link = await resolveShareToken(
                db.shareLinksStore,
                tokenOf(r),
                new Date(),
            );
            expect(link?.kind).toBe("grocery_list");
            const withTarget = await call("create_share_link", {
                kind: "grocery_list",
                target_id: crypto.randomUUID(),
            });
            expect(withTarget.isError).toBe(true);
        });
    });

    test("a household token creates a link with no member behind it", async () => {
        await withShareLinks(
            true,
            { kind: "household", householdId: "hh-1" },
            async (call) => {
                const r = await call("create_share_link", {
                    kind: "grocery_list",
                });
                expect(r.isError).toBeFalsy();
                const link = await resolveShareToken(
                    db.shareLinksStore,
                    tokenOf(r),
                    new Date(),
                );
                expect(link).toMatchObject({
                    householdId: "hh-1",
                    createdBy: null,
                });
                const listed = await call("list_share_links");
                const parsed = SHARE_LINK_OUTPUT_SCHEMAS.list.parse(
                    listed.structuredContent,
                );
                expect(parsed.links[0]).toMatchObject({
                    created_by: null,
                    created_by_name: null,
                });
            },
        );
    });

    test("refuses a recipe from another household, a missing one, and a non-uuid target", async () => {
        const foreign = await seedRecipe(OTHER_HOUSEHOLD, "Secret stew");
        await withShareLinks(true, asU1, async (call) => {
            const crossHousehold = await call("create_share_link", {
                kind: "recipe",
                target_id: foreign.id,
            });
            expect(crossHousehold.isError).toBe(true);
            expect(crossHousehold.content[0]!.text).toMatch(
                /not in your household/i,
            );
            const missing = await call("create_share_link", {
                kind: "recipe",
                target_id: crypto.randomUUID(),
            });
            expect(missing.isError).toBe(true);
            const garbage = await call("create_share_link", {
                kind: "recipe",
                target_id: "not-a-uuid",
            });
            expect(garbage.isError).toBe(true);
            expect(garbage.content[0]!.text).toMatch(/uuid|recipe id/i);
            const noTarget = await call("create_share_link", {
                kind: "recipe",
            });
            expect(noTarget.isError).toBe(true);
            expect(await db.shareLinksStore.listForHousehold("hh-1")).toEqual(
                [],
            );
            expect(
                await db.shareLinksStore.listForHousehold(OTHER_HOUSEHOLD),
            ).toEqual([]);
        });
    });

    test.each([0, 366, 1.5, -3])("refuses expires_in_days %p", async (days) => {
        await withShareLinks(true, asU1, async (call) => {
            const r = await call("create_share_link", {
                kind: "grocery_list",
                expires_in_days: days,
            });
            expect(r.isError).toBe(true);
            expect(r.content[0]!.text).toMatch(/expires_in_days/);
            expect(await db.shareLinksStore.listForHousehold("hh-1")).toEqual(
                [],
            );
        });
    });

    test("list_share_links shows active links with the recipe name and sharer, never a token", async () => {
        const soup = await seedRecipe("hh-1", "Lentil soup");
        await withShareLinks(true, asU1, async (call) => {
            const made = await call("create_share_link", {
                kind: "recipe",
                target_id: soup.id,
            });
            const groceries = await call("create_share_link", {
                kind: "grocery_list",
            });
            const revoked = await call("create_share_link", {
                kind: "grocery_list",
            });
            await call("revoke_share_link", {
                id: String(revoked.structuredContent?.id),
            });

            const r = await call("list_share_links");
            expect(r.isError).toBeFalsy();
            const parsed = SHARE_LINK_OUTPUT_SCHEMAS.list.parse(
                r.structuredContent,
            );
            expect(parsed.links.map((l) => l.id).sort()).toEqual(
                [made.structuredContent?.id, groceries.structuredContent?.id]
                    .map(String)
                    .sort(),
            );
            const recipeLink = parsed.links.find((l) => l.kind === "recipe")!;
            expect(recipeLink).toMatchObject({
                target_id: soup.id,
                recipe_name: "Lentil soup",
                created_by: "u1",
                created_by_name: "U1",
            });
            expect(
                parsed.links.find((l) => l.kind === "grocery_list"),
            ).toMatchObject({ target_id: null, recipe_name: null });
            // Neither the token nor a hash of it can be read back.
            const wire = JSON.stringify(r);
            expect(wire).not.toContain(tokenOf(made));
            expect(wire).not.toContain(tokenOf(groceries));
            expect(wire).not.toMatch(/token|hash|\/s\//i);
        });
    });

    test("list_share_links leaves out expired links and other households' links", async () => {
        await db.shareLinksStore.create({
            householdId: "hh-1",
            kind: "grocery_list",
            targetId: null,
            createdBy: "u1",
            tokenHash: "a".repeat(64),
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        });
        await db.shareLinksStore.create({
            householdId: OTHER_HOUSEHOLD,
            kind: "grocery_list",
            targetId: null,
            createdBy: "u9",
            tokenHash: "b".repeat(64),
            expiresAt: null,
        });
        await withShareLinks(true, asU1, async (call) => {
            const r = await call("list_share_links");
            const parsed = SHARE_LINK_OUTPUT_SCHEMAS.list.parse(
                r.structuredContent,
            );
            expect(parsed.links).toEqual([]);
            expect(r.content[0]!.text).toMatch(/no active share links/i);
        });
    });

    test("revoke_share_link stops the link resolving, and is idempotent", async () => {
        await withShareLinks(true, asU1, async (call) => {
            const made = await call("create_share_link", {
                kind: "grocery_list",
            });
            const token = tokenOf(made);
            const id = String(made.structuredContent?.id);
            expect(
                await resolveShareToken(db.shareLinksStore, token, new Date()),
            ).not.toBeNull();

            const first = await call("revoke_share_link", { id });
            expect(first.isError).toBeFalsy();
            const parsedFirst = SHARE_LINK_OUTPUT_SCHEMAS.revoke.parse(
                first.structuredContent,
            );
            expect(parsedFirst).toMatchObject({ id, kind: "grocery_list" });
            expect(
                await resolveShareToken(db.shareLinksStore, token, new Date()),
            ).toBeNull();

            const second = await call("revoke_share_link", { id });
            expect(second.isError).toBeFalsy();
            expect(
                SHARE_LINK_OUTPUT_SCHEMAS.revoke.parse(second.structuredContent)
                    .revoked_at,
            ).toBe(parsedFirst.revoked_at);
        });
    });

    test("revoke_share_link answers not found for another household's link, an unknown id and a non-uuid", async () => {
        const foreign = await db.shareLinksStore.create({
            householdId: OTHER_HOUSEHOLD,
            kind: "grocery_list",
            targetId: null,
            createdBy: "u9",
            tokenHash: "c".repeat(64),
            expiresAt: null,
        });
        await withShareLinks(true, asU1, async (call) => {
            for (const id of [foreign.id, crypto.randomUUID(), "nope"]) {
                const r = await call("revoke_share_link", { id });
                expect(r.isError).toBe(true);
                expect(r.content[0]!.text).toMatch(/share link not found/i);
            }
            const still =
                await db.shareLinksStore.listForHousehold(OTHER_HOUSEHOLD);
            expect(still).toHaveLength(1);
        });
    });

    test("the raw token appears only in the tool result, never in analytics", async () => {
        await withShareLinks(true, asU1, async (call) => {
            const made = await call("create_share_link", {
                kind: "grocery_list",
            });
            await call("list_share_links");
            expect(db.analyticsRows.length).toBeGreaterThanOrEqual(2);
            const rows = JSON.stringify(db.analyticsRows);
            expect(rows).toContain("create_share_link");
            expect(rows).not.toContain(tokenOf(made));
        });
    });

    describe("import_shared_recipe", () => {
        const TOKEN = "B".repeat(43);
        const LINK = `https://kitchen.example/s/${TOKEN}`;
        const NONE = {
            calories: null,
            protein_g: null,
            carbs_g: null,
            fat_g: null,
            fiber_g: null,
            sugar_g: null,
            saturated_fat_g: null,
            alcohol_g: null,
            caffeine_mg: null,
            grams_per_ml: null,
            grams_per_each: null,
        };
        function documentJson(over: Record<string, unknown> = {}) {
            return JSON.stringify({
                version: 1,
                name: "Lentil soup",
                portions: 4,
                instructions: "Simmer.",
                tags: ["soup"],
                ingredients: [
                    {
                        food_name: "Red lentils",
                        amount: 300,
                        unit: "g",
                        food: {
                            ...NONE,
                            calories: 352,
                            protein_g: 24.6,
                            carbs_g: 63,
                            fat_g: 1.1,
                        },
                    },
                    {
                        food_name: "Salt",
                        amount: null,
                        unit: null,
                        food: { ...NONE },
                    },
                ],
                ...over,
            });
        }
        function fetching(
            outcome: (url: string) => import("./fetch-safe.js").FetchOutcome,
        ) {
            const calls: string[] = [];
            db.recipeImportFetcher = {
                async robotsAllows() {
                    return true;
                },
                async fetchPage(url) {
                    calls.push(String(url));
                    return outcome(String(url));
                },
            };
            return calls;
        }
        const serving = (body: string) =>
            fetching((url) => ({
                ok: true,
                url,
                status: 200,
                contentType: "application/json",
                body,
            }));

        test("a pasted document becomes a recipe in the household, with matched and created foods", async () => {
            const mine = await db.foodsStore.insertFood(
                newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name: "red lentils",
                    calories: 340,
                }),
            );
            const before = JSON.stringify(
                await db.foodsStore.getFood("hh-1", mine.id),
            );
            await withShareLinks(true, asU1, async (call) => {
                const r = await call("import_shared_recipe", {
                    document: documentJson(),
                });
                expect(r.isError).toBeFalsy();
                const out = SHARE_LINK_OUTPUT_SCHEMAS.import.parse(
                    r.structuredContent,
                );
                expect(out).toMatchObject({
                    status: "imported",
                    recipe_name: "Lentil soup",
                    renamed_from: null,
                    matched: 1,
                    created: 1,
                    error_code: null,
                });
                expect(out.ingredients).toEqual([
                    {
                        name: "red lentils",
                        food_id: mine.id,
                        status: "matched",
                    },
                    {
                        name: "Salt",
                        food_id: expect.any(String),
                        status: "created",
                    },
                ]);
                expect(r.content[0]!.text).toContain("Lentil soup");
                expect(r.content[0]!.text).toContain(out.recipe_id!);
                const recipes = await db.recipesStore.listRecipes("hh-1");
                expect(recipes.map((x) => [x.id, x.name, x.creatorId])).toEqual(
                    [[out.recipe_id!, "Lentil soup", "u1"]],
                );
                expect(
                    JSON.stringify(
                        await db.foodsStore.getFood("hh-1", mine.id),
                    ),
                ).toBe(before);
                // Another household got nothing.
                expect(await db.recipesStore.listRecipes("hh-2")).toEqual([]);
                expect(await db.foodsStore.listFoods("hh-2")).toEqual([]);
            });
        });

        test("a share link is fetched through the safe fetcher as its .json", async () => {
            const calls = serving(documentJson({ name: "From a link" }));
            await withShareLinks(true, asU1, async (call) => {
                const r = await call("import_shared_recipe", { url: LINK });
                expect(r.isError).toBeFalsy();
                const out = SHARE_LINK_OUTPUT_SCHEMAS.import.parse(
                    r.structuredContent,
                );
                expect(out.status).toBe("imported");
                expect(out.recipe_name).toBe("From a link");
                expect(calls).toEqual([`${LINK}.json`]);
            });
        });

        test("importing the same recipe twice names the second apart", async () => {
            await withShareLinks(true, asU1, async (call) => {
                await call("import_shared_recipe", {
                    document: documentJson(),
                });
                const again = await call("import_shared_recipe", {
                    document: documentJson(),
                });
                const out = SHARE_LINK_OUTPUT_SCHEMAS.import.parse(
                    again.structuredContent,
                );
                expect(out.recipe_name).toBe("Lentil soup (2)");
                expect(out.renamed_from).toBe("Lentil soup");
                expect(out.created).toBe(0);
                expect(out.matched).toBe(2);
            });
        });

        const refusals: [
            string,
            Record<string, unknown>,
            () => void,
            string,
            RegExp,
        ][] = [
            [
                "neither url nor document",
                {},
                () => {},
                "invalid_input",
                /give a url .* or a document/i,
            ],
            [
                "both url and document",
                { url: LINK, document: documentJson() },
                () => {},
                "invalid_input",
                /not both/i,
            ],
            [
                "text that is not a share link",
                { url: "pasta" },
                () => {},
                "not_share_link",
                /share link/i,
            ],
            [
                "an http link",
                { url: `http://kitchen.example/s/${TOKEN}` },
                () => {},
                "not_share_link",
                /https/i,
            ],
            [
                "a private address",
                { url: `https://169.254.169.254/s/${TOKEN}` },
                () => {},
                "not_share_link",
                /can't import from that address/i,
            ],
            [
                "an unreachable link",
                { url: LINK },
                () =>
                    fetching(() => ({
                        ok: false,
                        reason: "network_error",
                        status: null,
                        detail: "",
                    })),
                "unreachable",
                /couldn't reach/i,
            ],
            [
                "a revoked link",
                { url: LINK },
                () =>
                    fetching(() => ({
                        ok: false,
                        reason: "not_found",
                        status: 404,
                        detail: "",
                    })),
                "not_found",
                /revoked or expired/i,
            ],
            [
                "a too large recipe",
                { url: LINK },
                () =>
                    fetching(() => ({
                        ok: false,
                        reason: "too_large",
                        status: 200,
                        detail: "",
                    })),
                "too_large",
                /too large/i,
            ],
            [
                "a document that is not a recipe",
                { document: '{"hello":"world"}' },
                () => {},
                "not_recipe",
                /isn't a Foodable recipe/i,
            ],
            [
                "a version this deploy does not read",
                { document: documentJson({ version: 3 }) },
                () => {},
                "unsupported_version",
                /version 3/i,
            ],
        ];

        for (const [name, args, setup, code, message] of refusals) {
            test(`${name} is refused with a clear structured message and writes nothing`, async () => {
                setup();
                await withShareLinks(true, asU1, async (call) => {
                    const r = await call("import_shared_recipe", args);
                    // A refusal is a result, not a protocol error.
                    expect(r.isError).toBeFalsy();
                    const out = SHARE_LINK_OUTPUT_SCHEMAS.import.parse(
                        r.structuredContent,
                    );
                    expect(out).toMatchObject({
                        status: "failed",
                        recipe_id: null,
                        recipe_name: null,
                        renamed_from: null,
                        matched: 0,
                        created: 0,
                        ingredients: [],
                        error_code: code,
                    });
                    expect(out.message).toMatch(message);
                    expect(r.content[0]!.text).toBe(out.message);
                    expect(await db.recipesStore.listRecipes("hh-1")).toEqual(
                        [],
                    );
                    expect(await db.foodsStore.listFoods("hh-1")).toEqual([]);
                });
            });
        }

        test("a refused link never reaches the fetcher", async () => {
            const calls = serving(documentJson());
            await withShareLinks(true, asU1, async (call) => {
                for (const url of [
                    "pasta",
                    `http://kitchen.example/s/${TOKEN}`,
                    `https://127.0.0.1/s/${TOKEN}`,
                    "https://kitchen.example/other",
                ]) {
                    const r = await call("import_shared_recipe", { url });
                    expect(r.structuredContent?.status).toBe("failed");
                }
                expect(calls).toEqual([]);
            });
        });

        test("the link reader kill switch pauses links but not a pasted document", async () => {
            const calls = serving(documentJson());
            const member = db.members[0]!;
            const flags = evaluateViewerFlags(
                buildFlagContext({
                    auth: asU1,
                    member: {
                        userId: member.userId,
                        householdId: member.householdId,
                        role: member.role,
                        displayName: member.displayName,
                    },
                }),
                createMemoryFlags({ "mcp-share-links": true }),
            );
            setFlagsForTests(
                createMemoryFlags({
                    "mcp-share-links": true,
                    "recipe-link-reader": false,
                }),
            );
            try {
                const server = new McpServer(
                    { name: "foodable-test", version: "0.0.0" },
                    { capabilities: { tools: {}, resources: {} } },
                );
                registerTools(
                    server,
                    asU1,
                    true,
                    null,
                    undefined,
                    "http://localhost",
                    true,
                    flags,
                );
                const [ct, st] = InMemoryTransport.createLinkedPair();
                const client = new Client({
                    name: "test-client",
                    version: "0.0.0",
                });
                await Promise.all([server.connect(st), client.connect(ct)]);
                try {
                    const paused = (await client.callTool({
                        name: "import_shared_recipe",
                        arguments: { url: LINK },
                    })) as ToolResult;
                    expect(paused.structuredContent?.status).toBe("failed");
                    expect(String(paused.structuredContent?.message)).toMatch(
                        /paused/i,
                    );
                    expect(calls).toEqual([]);
                    const pasted = (await client.callTool({
                        name: "import_shared_recipe",
                        arguments: { document: documentJson() },
                    })) as ToolResult;
                    expect(pasted.structuredContent?.status).toBe("imported");
                } finally {
                    await client.close();
                    await server.close();
                }
            } finally {
                resetFlagsForTests();
            }
        });

        test("analytics records an import as a success and a refusal as a failure, never the link", async () => {
            serving(documentJson());
            await withShareLinks(true, asU1, async (call) => {
                await call("import_shared_recipe", {
                    document: documentJson(),
                });
                await call("import_shared_recipe", { url: "pasta" });
                await call("import_shared_recipe", { url: LINK });
                const rows = db.analyticsRows.filter(
                    (r) => r.tool_name === "import_shared_recipe",
                );
                expect(rows.map((r) => r.success)).toEqual([true, false, true]);
                expect(rows[1]!.error_category).toBe("not_share_link");
                expect(JSON.stringify(db.analyticsRows)).not.toContain(TOKEN);
            });
        });

        test("flag off: the tool is absent and a call changes nothing", async () => {
            await withShareLinks(false, asU1, async (call, client) => {
                const names = (await client.listTools()).tools.map(
                    (t) => t.name,
                );
                expect(names).not.toContain("import_shared_recipe");
                await expect(
                    client.callTool({
                        name: "import_shared_recipe",
                        arguments: { document: documentJson() },
                    }),
                ).rejects.toThrow(/not found/i);
                expect(await db.recipesStore.listRecipes("hh-1")).toEqual([]);
                void call;
            });
        });

        test("the tool is declared as a write that reaches out", async () => {
            await withShareLinks(true, asU1, async (_call, client) => {
                const tool = (await client.listTools()).tools.find(
                    (t) => t.name === "import_shared_recipe",
                );
                expect(tool).toBeDefined();
                expect(tool!.annotations).toMatchObject({
                    readOnlyHint: false,
                    destructiveHint: false,
                    idempotentHint: false,
                    openWorldHint: true,
                });
                expect(tool!.outputSchema).toBeDefined();
            });
        });
    });

    describe("over HTTP", () => {
        test.each(ERAS)(
            "import_shared_recipe works with the flag on and is absent with it off (%p)",
            async (era) => {
                const calls: string[] = [];
                db.recipeImportFetcher = {
                    async robotsAllows() {
                        return true;
                    },
                    async fetchPage(url) {
                        calls.push(String(url));
                        return {
                            ok: true as const,
                            url: String(url),
                            status: 200,
                            contentType: "application/json",
                            body: JSON.stringify({
                                version: 1,
                                name: "Soup over HTTP",
                                portions: 2,
                                instructions: null,
                                tags: [],
                                ingredients: [
                                    {
                                        food_name: "Leek",
                                        amount: 2,
                                        unit: "each",
                                        food: {
                                            calories: 61,
                                            protein_g: 1.5,
                                            carbs_g: 14,
                                            fat_g: 0.3,
                                            fiber_g: 1.8,
                                            sugar_g: 3.9,
                                            saturated_fat_g: 0.1,
                                            alcohol_g: null,
                                            caffeine_mg: null,
                                            grams_per_ml: null,
                                            grams_per_each: null,
                                        },
                                    },
                                ],
                            }),
                        };
                    },
                };
                setFlagsForTests(
                    createMemoryFlags({ "mcp-share-links": true }),
                );
                try {
                    await withHttpClient("u1", era, async (client) => {
                        const names = (await client.listTools()).tools.map(
                            (t) => t.name,
                        );
                        expect(names).toContain("import_shared_recipe");
                        const byUrl = (await client.callTool({
                            name: "import_shared_recipe",
                            arguments: {
                                url: `https://kitchen.example/s/${"C".repeat(43)}`,
                            },
                        })) as ToolResult;
                        const parsed = SHARE_LINK_OUTPUT_SCHEMAS.import.parse(
                            byUrl.structuredContent,
                        );
                        expect(parsed).toMatchObject({
                            status: "imported",
                            recipe_name: "Soup over HTTP",
                            created: 1,
                            matched: 0,
                        });
                        expect(calls).toEqual([
                            `https://kitchen.example/s/${"C".repeat(43)}.json`,
                        ]);
                        expect(
                            (await db.recipesStore.listRecipes("hh-1")).map(
                                (r) => r.name,
                            ),
                        ).toEqual(["Soup over HTTP"]);

                        const byDocument = (await client.callTool({
                            name: "import_shared_recipe",
                            arguments: {
                                document: JSON.stringify({
                                    version: 1,
                                    name: "Pasted over HTTP",
                                    portions: 1,
                                    instructions: null,
                                    tags: [],
                                    ingredients: [],
                                }),
                            },
                        })) as ToolResult;
                        expect(byDocument.structuredContent?.status).toBe(
                            "imported",
                        );

                        const refused = (await client.callTool({
                            name: "import_shared_recipe",
                            arguments: { url: "http://kitchen.example/s/x" },
                        })) as ToolResult;
                        expect(refused.structuredContent).toMatchObject({
                            status: "failed",
                            error_code: "not_share_link",
                        });
                    });
                    setFlagsForTests(
                        createMemoryFlags({ "mcp-share-links": false }),
                    );
                    await withHttpClient("u1", era, async (client) => {
                        const names = (await client.listTools()).tools.map(
                            (t) => t.name,
                        );
                        expect(names).not.toContain("import_shared_recipe");
                        const refused = await client
                            .callTool({
                                name: "import_shared_recipe",
                                arguments: {
                                    document: '{"version":1}',
                                },
                            })
                            .then(
                                (r) => (r as ToolResult).isError === true,
                                () => true,
                            );
                        expect(refused).toBe(true);
                    });
                } finally {
                    resetFlagsForTests();
                }
            },
        );

        test.each(ERAS)(
            "flag on: create, list and revoke (%p)",
            async (era) => {
                const recipe = await seedRecipe("hh-1");
                setFlagsForTests(
                    createMemoryFlags({ "mcp-share-links": true }),
                );
                try {
                    await withHttpClient("u1", era, async (client) => {
                        const names = (await client.listTools()).tools.map(
                            (t) => t.name,
                        );
                        for (const name of SHARE_TOOLS)
                            expect(names).toContain(name);

                        const made = (await client.callTool({
                            name: "create_share_link",
                            arguments: { kind: "recipe", target_id: recipe.id },
                        })) as ToolResult;
                        const parsed = SHARE_LINK_OUTPUT_SCHEMAS.create.parse(
                            made.structuredContent,
                        );
                        expect(parsed.url).toMatch(
                            /^http:\/\/test\.local\/s\/[A-Za-z0-9_-]{43}$/,
                        );
                        const token = parsed.url.split("/s/")[1]!;
                        expect(
                            await resolveShareToken(
                                db.shareLinksStore,
                                token,
                                new Date(),
                            ),
                        ).not.toBeNull();

                        const listed = (await client.callTool({
                            name: "list_share_links",
                            arguments: {},
                        })) as ToolResult;
                        expect(
                            SHARE_LINK_OUTPUT_SCHEMAS.list.parse(
                                listed.structuredContent,
                            ).links,
                        ).toHaveLength(1);

                        const revoked = (await client.callTool({
                            name: "revoke_share_link",
                            arguments: { id: parsed.id },
                        })) as ToolResult;
                        SHARE_LINK_OUTPUT_SCHEMAS.revoke.parse(
                            revoked.structuredContent,
                        );
                        expect(
                            await resolveShareToken(
                                db.shareLinksStore,
                                token,
                                new Date(),
                            ),
                        ).toBeNull();

                        const bad = (await client.callTool({
                            name: "create_share_link",
                            arguments: { kind: "recipe", target_id: "nope" },
                        })) as ToolResult;
                        expect(bad.isError).toBe(true);
                    });
                } finally {
                    resetFlagsForTests();
                }
            },
        );

        test.each(ERAS)("flag off: the tools are absent (%p)", async (era) => {
            setFlagsForTests(createMemoryFlags({ "mcp-share-links": false }));
            try {
                await withHttpClient("u1", era, async (client) => {
                    const names = (await client.listTools()).tools.map(
                        (t) => t.name,
                    );
                    for (const name of SHARE_TOOLS)
                        expect(names).not.toContain(name);
                    const refused = await client
                        .callTool({
                            name: "create_share_link",
                            arguments: { kind: "grocery_list" },
                        })
                        .then(
                            (r) => (r as ToolResult).isError === true,
                            () => true,
                        );
                    expect(refused).toBe(true);
                });
            } finally {
                resetFlagsForTests();
            }
        });
    });
});
