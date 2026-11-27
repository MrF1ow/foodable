import {
    test,
    expect,
    describe,
    mock,
    beforeAll,
    beforeEach,
    afterAll,
    afterEach,
    spyOn,
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
import {
    ADD_FRIDGE_ITEM_OUTPUT_SCHEMA,
    GET_FRIDGE_OUTPUT_SCHEMA,
    LIST_EXPIRING_OUTPUT_SCHEMA,
} from "./mcp/tools/fridge.js";
import { GET_RECIPE_OUTPUT_SCHEMA } from "./mcp/tools/recipes.js";
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
    AGENT_ACTIONS_OFF_TEXT,
    AGENT_DESTRUCTIVE_SETTING,
    AGENT_PERSON_OFF_TEXT,
    AGENT_PERSONAL_SETTING,
    createToolContext,
    MEAL_LOGGED_WIDGET_URI,
    widgetUri,
} from "./mcp/shared.js";
import { SERVER_INSTRUCTIONS } from "./mcp/server.js";
import { AgentActionsDisabledError } from "./domain/agent-actions.js";
import { renderSettingsAiV2Body } from "./web/pages/v2/settings-ai.js";
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
import { addLocation, createMemoryFridgeStore } from "./domain/fridge.js";
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
import { CONVERT_QUANTITY_OUTPUT_SCHEMA } from "./mcp/tools/food.js";
import {
    CLEAR_GROCERY_LIST_OUTPUT_SCHEMA,
    LIST_USUALS_OUTPUT_SCHEMA,
    MOVE_GROCERY_LINES_OUTPUT_SCHEMA,
    UPDATE_GROCERY_LINE_OUTPUT_SCHEMA,
} from "./mcp/tools/grocery.js";
import {
    HOUSEHOLD_ADMIN_TOOL_NAMES,
    LIST_STORES_OUTPUT_SCHEMA,
} from "./mcp/tools/stores.js";
import {
    MOVE_FRIDGE_ITEMS_OUTPUT_SCHEMA,
    DELETE_FRIDGE_ITEMS_OUTPUT_SCHEMA,
} from "./mcp/tools/fridge-admin.js";
import {
    DELETE_GROCERY_LINES_OUTPUT_SCHEMA,
    REMOVE_USUAL_OUTPUT_SCHEMA,
} from "./mcp/tools/grocery-admin.js";
import { KITCHEN_ADMIN_TOOL_NAMES } from "./mcp/tools/grocery-admin-names.js";
import {
    ADD_PLAN_MISSING_OUTPUT_SCHEMA,
    PLAN_RECIPE_OUTPUT_SCHEMA,
    UNPLAN_RECIPE_OUTPUT_SCHEMA,
    UPDATE_PLAN_OUTPUT_SCHEMA,
    WEEK_PLAN_OUTPUT_SCHEMA,
} from "./mcp/tools/plan.js";
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
import {
    GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA,
    LIST_NOTICES_OUTPUT_SCHEMA,
    MARK_NOTICES_READ_OUTPUT_SCHEMA,
    SET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA,
    SNOOZE_NOTICE_OUTPUT_SCHEMA,
} from "./mcp/tools/notices.js";
import { createMemoryGroceryStore } from "./domain/grocery.js";
import { utcTodayFromDate } from "./domain/stock.js";
import { WEEKDAY_NAMES } from "./domain/weekdays.js";
import { PLAN_UNKNOWN_LINE_NOTE } from "./copy/toasts.js";
import { fridgeExpiryLine } from "./copy/notices.js";
import { createMemoryFetchMemoryStore } from "./domain/fetch-memory.js";
import { createMemoryAgentActionsStore } from "./domain/agent-actions.js";
import {
    householdAllergenMembers,
    setAgentActionDepsForTests,
    stripIdTags,
} from "./mcp/shared.js";
import { setGoalDayRowsForTests } from "./db/agent-actions-goal-days.js";
import { createMemoryVariantsStore } from "./domain/recipe-variants.js";
import {
    createMemoryRecipesStore,
    addRecipeManualIngredient,
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
import { createMemoryNotificationsStore } from "./domain/notifications.js";
import type { NotificationKind } from "./domain/notification-kinds.js";
import { setNotifyDepsForTests } from "./db/notify.js";
import { setNotificationSyncDepsForTests } from "./db/notifications.js";
import { noticesFor } from "./domain/notices-for.js";
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
    guessMealType,
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
    variantsStore: createMemoryVariantsStore(),
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
    agentActions: createMemoryAgentActionsStore(),
    notificationsStore: createMemoryNotificationsStore(),
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
    getMealById: async (_userId: string, id: string) =>
        db.meals.find((m) => m.id === id) ?? null,
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
    liveRecipeVariantsStore: () => db.variantsStore,
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
    // A tx that can be called as a tagged template (the shared-import advisory
    // lock) and answers with no rows.
    run: async <T>(fn: (tx: unknown) => Promise<T>) =>
        fn(Object.assign(async () => [], {})),
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
    setAgentActionDepsForTests(null);
    setNotifyDepsForTests(null);
    setNotificationSyncDepsForTests(null);
    setGoalDayRowsForTests(null);
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
    db.variantsStore = createMemoryVariantsStore();
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
    // The destructive tools record into this one, on the same memory stores
    // the tools write to.
    db.agentActions = createMemoryAgentActionsStore();
    // The event notifications the write tools send land here, among the
    // household's members as the memory household has them.
    db.notificationsStore = createMemoryNotificationsStore();
    setNotifyDepsForTests({
        store: db.notificationsStore,
        listMembers: async () =>
            db.members.map((m) => ({ userId: m.userId, role: m.role })),
        log: () => {},
    });
    // The inbox tools read and write the same notification rows, on the memory
    // stores the other tools write to; a sync reads the notices from them.
    setNotificationSyncDepsForTests({
        store: db.notificationsStore,
        dismissals: db.dismissalsStore,
        listMembers: async () =>
            db.members.map((m) => ({ userId: m.userId, role: m.role })),
        loadNotices: async (householdId) =>
            (
                await noticesFor(
                    {
                        foods: db.foodsStore,
                        fridge: db.fridgeStore,
                        recipes: db.recipesStore,
                        dismissals: db.dismissalsStore,
                        grocery: db.groceryStore,
                        plans: db.plansStore,
                        weighIns: createMemoryWeighInStore(db.weighInRows),
                        allergenMembers: householdAllergenMembers,
                    },
                    householdId,
                    {
                        today: utcTodayFromDate(),
                        timezone: "UTC",
                        actionable: true,
                        includeDismissed: true,
                        allergens: true,
                    },
                )
            ).notices,
    });
    setAgentActionDepsForTests({
        store: db.agentActions,
        settings: db.settingsStore,
        stock: db.stockStore,
        foods: db.foodsStore,
        recipes: db.recipesStore,
    });
    // The owner's own agents may delete, as in a household that had agents
    // allowed; the tests about the switches turn it (and others') off.
    void db.settingsStore.setMemberAgentsCanDelete("hh-1", "u1", true);
    // Per-day goal overrides live in db.goalDays; the destructive goal write
    // reads and removes them by row id.
    setGoalDayRowsForTests({
        list: async (userId, _householdId, dates) =>
            db.goalDays
                .filter((o) => o.user_id === userId && dates.includes(o.date))
                .map((o) => ({ ...o, id: `${o.user_id}:${o.date}` })),
        remove: async (userId, _householdId, ids) => {
            const before = db.goalDays.length;
            db.goalDays = db.goalDays.filter(
                (o) =>
                    !(
                        o.user_id === userId &&
                        ids.includes(`${o.user_id}:${o.date}`)
                    ),
            );
            return before - db.goalDays.length;
        },
    });
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

    test("merge_foods names where possible duplicates live now", async () => {
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        const description =
            tools.find((t) => t.name === "merge_foods")?.description ?? "";
        expect(description).toContain(
            "Settings › Saved foods & recipes › Possible duplicates",
        );
        expect(description).not.toContain("Household › Possible duplicates");
        await client.close();
        await server.close();
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

    test("null on a stored target is a guarded clear: recorded, and refused while the person's switch is off", async () => {
        await withTools(null, async (call) => {
            await call("set_nutrition_goals", {
                daily_caffeine_mg: 400,
                daily_protein_g: 130,
            });
            const cleared = await call("set_nutrition_goals", {
                daily_caffeine_mg: null,
            });
            expect(cleared.isError).toBeFalsy();
            // This memory store holds no goals row to snapshot, so the entry
            // is not undoable here; the database tests cover the undo.
            expect(textOf(cleared)).toContain(
                "recorded in Settings › AI connections",
            );
            expect(db.goals!.daily_caffeine_mg).toBeNull();
            expect(db.agentActions.__records()).toHaveLength(1);

            await db.settingsStore.setMemberAgentsCanDelete(
                "hh-1",
                "u1",
                false,
            );
            const refused = await call("set_nutrition_goals", {
                daily_protein_g: null,
            });
            expect(refused.isError).toBe(true);
            expect(db.goals!.daily_protein_g).toBe(130);
            expect(db.agentActions.__records()).toHaveLength(1);
            // Naming a target that was never set is no clear at all.
            const nothing = await call("set_nutrition_goals", {
                daily_caffeine_mg: null,
            });
            expect(nothing.isError).toBeFalsy();
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

    test("clear with no date, from or to removes every override on any day and keeps the defaults", async () => {
        db.goals = goals({ daily_calories: 2000, goal_name: "Recomp" });
        await withTools(null, async (call) => {
            for (const date of ["2020-03-01", "2026-07-04", "2099-01-01"]) {
                await call("set_nutrition_goals", {
                    date,
                    daily_calories: 2800,
                });
            }
            expect(db.goalDays).toHaveLength(3);
            const r = await call("set_nutrition_goals", { clear: true });
            expect(r.isError).toBeFalsy();
            expect(textOf(r)).toContain(
                "Cleared 3 per-day goal overrides on every day.",
            );
            expect(db.goalDays).toHaveLength(0);
            const sc = SET_NUTRITION_GOALS_OUTPUT_SCHEMA.parse(
                r.structuredContent,
            );
            expect(sc.scope).toBe("days");
            expect(sc.goals?.calories).toBe(2000);
            const again = await call("get_goal_progress", {
                date: "2026-07-04",
            });
            expect(textOf(again)).toContain("2000");
            expect(db.goals?.goal_name).toBe("Recomp");
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

    test("target_member refuses the other member's override and accepts the caller's", async () => {
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
            const refused = await call("set_nutrition_goals", {
                target_member: bob,
                date: "2026-07-04",
                daily_calories: 2800,
            });
            expect(refused.isError).toBe(true);
            expect(db.goalDays).toHaveLength(0);
            const r = await call("set_nutrition_goals", {
                target_member: "u1",
                date: "2026-07-04",
                daily_calories: 2800,
            });
            expect(r.isError).toBeFalsy();
            expect(
                db.goalDays.some(
                    (o) => o.user_id === "u1" && o.daily_calories === 2800,
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
    test("dismiss_notice names both forms; list_notices sends data-quality marks to their item", async () => {
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
        // The data-quality form keeps its related_id; the inbox form is
        // named with its scope and what the guard does for everyone.
        expect(dismiss?.description).toContain("related_id");
        expect(dismiss?.description).toContain("notification_id");
        expect(dismiss?.description).toContain("everyone");
        // Undo is all or nothing, so neither description promises it
        // unconditionally: a member changing their own copy ends it.
        expect(dismiss?.description).toContain("undoable");
        expect(dismiss?.description).toContain(
            "unless someone has changed their copy since",
        );
        expect(dismiss?.description).toContain("get_week_plan");
        expect(dismiss?.description).not.toContain("info-level");
        const snooze = tools.find((t) => t.name === "snooze_notice");
        expect(snooze?.description).toContain("undoable");
        expect(snooze?.description).toContain(
            "unless someone has changed their copy since",
        );
        const week = tools.find((t) => t.name === "get_week_plan");
        expect(week?.description).toContain("`notices`");
        expect(week?.description).toContain("dismiss_notice");
        const list = tools.find((t) => t.name === "list_notices");
        expect(list?.description).not.toContain("badge");
        expect(list?.description).toContain("get_recipe");
        expect(list?.description).toContain("get_food");
        expect(list?.description).toContain("notification_id");
        for (const name of [
            "snooze_notice",
            "mark_notices_read",
            "get_notification_settings",
            "set_notification_settings",
        ]) {
            expect(
                tools.some((t) => t.name === name),
                name,
            ).toBe(true);
        }
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
                expect(textOf(await call(c.tool, { id: c.id }))).toStartWith(
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

/**
 * The recipe an app import landed on: its 303 goes to the draft with the
 * marker that makes it the importer's first landing (`?imported=1`).
 */
function importedRecipeId(res: Response): string {
    const location = res.headers.get("location") ?? "";
    const marker = "?imported=1";
    expect(location.startsWith("/recipes/")).toBe(true);
    expect(location.endsWith(marker)).toBe(true);
    return location.slice("/recipes/".length, location.length - marker.length);
}

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
            // separate from the populated one below — neither carries a locale.
            expect(sc).not.toHaveProperty("locale");
        });
    });

    // Widgets are English-only and never read a locale, so neither the payload
    // nor the advertised outputSchema carries one.
    test("structuredContent and outputSchema have no locale", async () => {
        stage(1);
        db.profile = PROFILE_BASE;
        await withTools(null, async (call) => {
            const sc = (await summarize(call))
                .structuredContent as unknown as SummaryPayload;
            expect(sc).not.toHaveProperty("locale");
        });
        const server = new McpServer(
            { name: "t", version: "0.0.0" },
            { capabilities: { tools: {}, resources: {} } },
        );
        registerTools(server, { kind: "user", userId: "u1" }, true, null);
        const [ct, st] = InMemoryTransport.createLinkedPair();
        const client = new Client({ name: "c", version: "0.0.0" });
        await Promise.all([server.connect(st), client.connect(ct)]);
        const { tools } = await client.listTools();
        const withSchema = tools.filter((t) => t.outputSchema);
        expect(withSchema.length).toBeGreaterThan(0);
        for (const t of withSchema) {
            expect(t.outputSchema?.properties ?? {}).not.toHaveProperty(
                "locale",
            );
        }
        await client.close();
        await server.close();
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

    test("PAT set_nutrition_goals writes the owner's goals and refuses another member's", async () => {
        await withHousehold(async (call) => {
            const refused = await call("set_nutrition_goals", {
                daily_calories: 1800,
                user_id: bob,
            });
            expect(refused.isError).toBe(true);
            expect(textOf(refused)).toContain(
                "An agent can only add, change or delete the entries of the person it acts for. Nothing was changed. Ask Bob to do it, or their agent. On the household's shared connection that person is the household owner.",
            );
            expect(db.goals).toBeNull();
            const r = await call("set_nutrition_goals", {
                daily_calories: 1800,
                user_id: alice,
            });
            expect(r.isError).toBeFalsy();
            expect(db.goals?.user_id).toBe(alice);
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

    type ListedTools = Awaited<ReturnType<Client["listTools"]>>["tools"];

    async function withHousehold(
        run: (
            call: CallTool,
            list: () => Promise<string[]>,
            listFull: () => Promise<ListedTools>,
        ) => Promise<void>,
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
                async () => (await client.listTools()).tools,
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

    test("the retired recipe expiry preference is an unknown key: update_household_config treats it like any other, and the config no longer returns it", async () => {
        await withHousehold(async (call) => {
            const unknown = await call("update_household_config", {
                preferences: { someUnknownKey: 30 },
            });
            const retired = await call("update_household_config", {
                preferences: {
                    unverifiedRecipeExpiryDays: 30,
                    unverified_recipe_expiry_days: 30,
                },
            });
            expect(retired.isError).toBe(unknown.isError);
            expect(retired.structuredContent).toEqual(
                unknown.structuredContent,
            );
            const got = await call("get_household_config");
            expect(got.structuredContent?.preferences).not.toHaveProperty(
                "unverified_recipe_expiry_days",
            );
            expect(JSON.stringify(got.structuredContent)).not.toContain(
                "expiry",
            );
            expect(JSON.stringify(db.household?.preferences)).not.toContain(
                "xpiry",
            );
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

    test("CLAUDE.md says how many tools there are: as many as the snapshot has names", async () => {
        const snapshot = (await Bun.file(
            new URL("./mcp/tools-list.snapshot.json", import.meta.url),
        ).json()) as string[];
        const claude = await Bun.file(
            new URL("../CLAUDE.md", import.meta.url),
        ).text();
        expect(claude).toContain(`There are ${snapshot.length} tools`);
    });

    // Every tool description is paid for in every conversation's context, so
    // tools/list is budgeted. These are what main measured on ee31a2f2 (before
    // the agent-parity work) with every flag on, the same listing the snapshot
    // test reads: JSON.stringify(tools).length (UTF-16 code units, so
    // characters, not bytes) and tools.length. To re-measure, copy this
    // describe block and the `listFull` argument of `withHousehold` onto that
    // commit (it has neither), add a console.log of both numbers, and run
    //   bun --no-env-file test src/mcp.test.ts -t "tools/list size"
    // Raising either constant is a deliberate, reviewed edit: trim a
    // description first, and say in the PR why the list has to grow.
    describe("tools/list size", () => {
        // +2964: snooze_notice, mark_notices_read and the two notification
        // settings tools, with list_notices and dismiss_notice reworded and
        // reshaped for the inbox.
        // +336: the optional `hidden_nutrients` list in the five card tools'
        // output schemas (Settings › Nutrients shown), after trimming the
        // merge_foods description to pay for its new Settings path.
        // +234: the optional `filters` and `query` inputs on list_recipes (the
        // Recipes page's filter registry), explained in the tool description
        // rather than per field, in as few words as fit.
        // +547: `repeat` and `days` on plan_recipe, `scope` on unplan_recipe
        // and the optional `repeats` flag on a plan in their outputs, with
        // one sentence of each description.
        // +94: plan_recipe says an entry already on that day and slot comes
        // back unchanged whatever the servings, and that repeats of one
        // recipe and slot may not overlap, in place of its one old sentence.
        // +2709: set_recipe_variant and clear_recipe_variant (a person's own
        // version of a recipe), `change` and `variant` in get_recipe's output
        // schema, and `member_ids` on plan_recipe and a plan entry, with
        // their descriptions as short as they go.
        // +2538: save_recipe and discard_recipe_draft (imports are drafts
        // until a person saves them), and `draft`, `ready_to_save` and
        // `draft_expires_at` on the recipe outputs, with no field
        // descriptions and the tool descriptions cut to one line each.
        // +1775: update_plan (change one planned entry: its recipe, day, meal,
        // servings and repeat), with a description cut to what an agent needs
        // and an output that reuses plan_recipe's plan object.
        // +423: the optional `food_ids` input on add_plan_missing_to_groceries
        // (add only the ticked foods of Missing for the plan), with a
        // sentence of its description.
        // +124: the optional `food_id` input on update_recipe_ingredient (swap
        // which food a line is, as the app's ingredient sheet does), with a
        // clause of its description.
        const TOOLS_LIST_MAX_CHARS = 237539;
        const TOOLS_LIST_MAX_COUNT = 107;

        test("all-flags-on tools/list stays within the size budget", async () => {
            const snapshot = (await Bun.file(
                new URL("./mcp/tools-list.snapshot.json", import.meta.url),
            ).json()) as string[];
            await withHousehold(async (_call, _list, listFull) => {
                const tools = await listFull();
                // The measured set is the all-flags-on list, not a subset.
                expect(tools.map((tool) => tool.name)).toEqual(snapshot);
                expect(tools.length).toBeLessThanOrEqual(TOOLS_LIST_MAX_COUNT);
                expect(JSON.stringify(tools).length).toBeLessThanOrEqual(
                    TOOLS_LIST_MAX_CHARS,
                );
            });
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
                createMemoryFlags({ "mcp-share-links": false }),
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
                        "mcp-share-links",
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
                {
                    name: "test_gated_tool",
                    flag: "mcp-share-links",
                    registered: false,
                },
            ]);
        });

        test("gated tool off answers unknown-tool; on is listed and callable", async () => {
            const offFlags = evaluateViewerFlags(
                viewerFlagCtx(),
                createMemoryFlags({ "mcp-share-links": false }),
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
                "mcp-share-links",
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
                createMemoryFlags({ "mcp-share-links": true }),
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
                    "mcp-share-links",
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
                "mcp-share-links",
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

    async function withRateProductClient(
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
        const flags = evaluateViewerFlags(flagCtx, createMemoryFlags({}));
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
            await withRateProductClient(async (call) => {
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
                    await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
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
                await withRateProductClient(async (call) => {
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
                await withRateProductClient(async (call) => {
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
                await withRateProductClient(async (call) => {
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
                await withRateProductClient(async (call) => {
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
                await withRateProductClient(async (call) => {
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
                    await withRateProductClient(async (call) => {
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
            await withRateProductClient(async (call) => {
                const r = await call("rate_product", {
                    food_id: foodId,
                    user_id: other,
                });
                expect(r.isError).toBe(true);
                expect(textOf(r)).toContain("not a household member");
            });
        });

        test("unknown barcode returns found false", async () => {
            await withRateProductClient(async (call) => {
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
        // These tests are not about the agent switch: both people's agents may delete.
        for (const person of [alice, bob]) {
            void db.settingsStore.setMemberAgentsCanDelete(
                "hh-1",
                person,
                true,
            );
        }
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

    test("eat_fridge_item says when a per-100 ml food eaten in grams has no nutrition", async () => {
        db.barcodeFoods[cottage.barcode] = cottage;
        await withPat(async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const added = await call("add_fridge_item", {
                location_id: loc.structuredContent?.id as string,
                kind: "food",
                barcode: cottage.barcode,
                amount: 200,
                unit: "g",
            });
            const food = (await db.foodsStore.listFoods("hh-1"))[0]!;
            await db.foodsStore.updateFoodRow({
                ...food,
                nutritionBasis: "100ml",
                gramsPerMl: null,
            });
            const eaten = await call("eat_fridge_item", {
                id: added.structuredContent?.id as string,
                amount: 50,
                member_id: alice,
            });
            expect(eaten.isError).toBeFalsy();
            const text = (eaten.content as { text: string }[])[0]!.text;
            expect(text).toContain("Nutrition unknown for:");
            expect(text).toContain("log it in ml");
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
            // A saved recipe never loses its steps: the edit is refused with
            // what it would break.
            const cleared = await call("update_recipe", {
                id: recipeId,
                instructions: null,
            });
            expect(cleared.isError).toBe(true);
            expect(textOf(cleared)).toContain("Add the steps.");
            const bare = await call("create_recipe", {
                name: "Plain toast",
                yield_portions: 1,
            });
            const empty = await call("get_recipe", {
                id: bare.structuredContent?.id as string,
            });
            expect(empty.structuredContent?.steps).toEqual([]);
            expect(textOf(empty)).not.toContain("Method:");
        });
    });

    test("cook_recipe deducts stock and logs a meal for the person it acts for", async () => {
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
                portions_by_member: [{ user_id: alice, portions: 2 }],
            });
            expect(cooked.isError).toBeFalsy();
            expect(textOf(cooked)).toContain("Shortfall");
            expect(textOf(cooked)).toContain("Logged 1 meal.");
            expect(db.inserted).toHaveLength(1);
            expect(db.inserted[0]!.user_id).toBe(alice);
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

    test("cook_recipe cooks total_portions but logs only the acting person's portions", async () => {
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
                portions_by_member: [{ user_id: alice, portions: 2 }],
                total_portions: 1,
            });
            expect(tooFew.isError).toBe(true);
            expect(textOf(tooFew)).toContain("can't be less");

            // Cook once, eat twice: the whole batch, two portions eaten now.
            const cooked = await call("cook_recipe", {
                recipe_id: recipeId,
                portions_by_member: [{ user_id: alice, portions: 2 }],
                total_portions: 4,
            });
            expect(cooked.isError).toBeFalsy();
            expect(cooked.structuredContent?.total_portions).toBe(4);
            expect(cooked.structuredContent?.meal_ids).toHaveLength(1);
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

    test("list_grocery_lines text gives each line's id and checked state, so a model without structuredContent can check or delete it", async () => {
        await withPat(async (call) => {
            await createGroceryStore(db.settingsStore, "hh-1", "Safeway");
            const eggs = await call("upsert_food", { name: "Eggs" });
            const milk = await call("upsert_food", { name: "Milk" });
            const eggsLine = await call("add_grocery_line", {
                kind: "food",
                food_id: eggs.structuredContent?.id as string,
            });
            await call("add_grocery_line", {
                kind: "food",
                food_id: milk.structuredContent?.id as string,
            });
            const eggsId = eggsLine.structuredContent?.id as string;
            expect(
                (
                    await call("check_grocery_line", {
                        id: eggsId,
                        checked: true,
                    })
                ).isError,
            ).toBeFalsy();
            const text = textOf(await call("list_grocery_lines"));
            const rows = text.split("\n");
            const eggsRow = rows.find((row) => row.startsWith("Eggs"));
            const milkRow = rows.find((row) => row.startsWith("Milk"));
            expect(eggsRow).toEndWith(`[checked] [id: ${eggsId}]`);
            expect(milkRow).not.toContain("[checked]");
            const milkId = /\[id: ([^\]]+)\]$/.exec(milkRow!)?.[1];
            expect(milkId).toBeTruthy();
            const deleted = await call("delete_grocery_line", { id: milkId });
            expect(deleted.isError).toBeFalsy();
            expect(textOf(await call("list_grocery_lines"))).not.toContain(
                "Milk",
            );
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

    test("OAuth log_meal with target_member refuses the partner and accepts the caller", async () => {
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
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain(
                "An agent can only add, change or delete the entries of the person it acts for. Nothing was changed. Ask Bob to do it, or their agent.",
            );
            expect(db.inserted).toHaveLength(0);

            const own = await call("log_meal", {
                description: "toast",
                meal_type: "breakfast",
                calories: 100,
                protein_g: 4,
                carbs_g: 18,
                fat_g: 1,
                target_member: "u1",
            });
            expect(own.isError).toBeFalsy();
            expect(db.inserted[0]!.user_id).toBe("u1");
            // Reading the partner's day is still allowed.
            const theirs = await call("get_meals", { user_id: bob });
            expect(theirs.isError).toBeFalsy();
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
        const { SAVE_RECIPE_OUTPUT_SCHEMA, VERIFY_RECIPE_OUTPUT_SCHEMA } =
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
            // Passing the check leaves it a draft, ready to save.
            const ok = await call("verify_recipe", { recipe_id: completeId });
            expect(ok.isError).toBeFalsy();
            VERIFY_RECIPE_OUTPUT_SCHEMA.parse(ok.structuredContent);
            expect(ok.structuredContent?.status).toBe("unverified");
            expect(ok.structuredContent).toMatchObject({
                draft: true,
                ready_to_save: true,
            });
            expect(textOf(ok)).toContain(
                "call save_recipe only when they say so",
            );
            const saved = await call("save_recipe", { recipe_id: completeId });
            SAVE_RECIPE_OUTPUT_SCHEMA.parse(saved.structuredContent);
            expect(saved.structuredContent?.status).toBe("saved");
            const again = await call("save_recipe", { recipe_id: completeId });
            expect(again.structuredContent?.status).toBe("already_saved");
            const verified = await call("verify_recipe", {
                recipe_id: completeId,
            });
            expect(verified.structuredContent).toMatchObject({
                status: "verified",
                draft: false,
                ready_to_save: false,
                draft_expires_at: null,
            });

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
            expect(open.structuredContent?.ready_to_save).toBe(false);
            // Save refuses it with what is left to fix.
            const refused = await call("save_recipe", { recipe_id: openId });
            expect(refused.isError).toBeFalsy();
            expect(refused.structuredContent?.status).toBe("not_ready");
            expect(textOf(refused)).toContain("Add the steps.");
            // Save after a discard: the draft is gone, so it is unknown and
            // nothing is saved.
            await call("discard_recipe_draft", { recipe_id: openId });
            const gone = await call("save_recipe", { recipe_id: openId });
            expect(gone.isError).toBe(true);
            expect(textOf(gone)).toContain("Unknown recipe.");

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
            expect(fixed.structuredContent).toMatchObject({
                status: "unverified",
                ready_to_save: true,
            });
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

    test("a draft's expiry reads as the household's local day", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "America/New_York" };
        await withUser(alice, async (call) => {
            const imported = await call("import_recipe_from_text", {
                text: "x",
                instructions: "",
                name: "Late night stew",
                ingredients: [{ name: "rice", amount: 50, unit: "g" }],
            });
            const id = (imported.structuredContent?.recipe as { id: string })
                .id;
            const row = await db.recipesStore.getRecipe("hh-1", id);
            await db.recipesStore.updateRecipe({
                ...row!,
                draftExpiresAt: "2026-12-01T02:00:00.000Z",
            });
            const shown = await call("get_recipe", { id });
            expect(textOf(shown)).toContain("deleted on 2026-11-30");
            expect(textOf(shown)).not.toContain("2026-12-01");
            const listed = await call("list_recipes", {
                verification: "unverified",
            });
            expect(textOf(listed)).toContain(
                "Late night stew yield 1 (draft, deleted 2026-11-30 unless saved)",
            );
        });
    });

    test("a draft refuses cook, the grocery list, the plan and a logged portion, saying it is a draft", async () => {
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
            const DRAFT = "That recipe is a draft; save it first.";
            expect(cooked.isError).toBeTruthy();
            expect(textOf(cooked)).toContain(DRAFT);
            const added = await call("add_recipe_to_grocery", {
                recipe_id: recipeId,
                store_id: (
                    await createGroceryStore(db.settingsStore, "hh-1", "Shop")
                ).id,
                total_portions: 1,
            });
            expect(added.isError).toBeTruthy();
            expect(textOf(added)).toContain(DRAFT);
            for (const repeat of ["once", "weekly"]) {
                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: new Date(Date.now() + 2 * 86_400_000)
                        .toISOString()
                        .slice(0, 10),
                    slot: "dinner",
                    repeat,
                });
                expect(planned.isError).toBeTruthy();
                expect(textOf(planned)).toContain(DRAFT);
            }
            const logged = await call("log_recipe_portion", {
                recipe_id: recipeId,
                portions: 1,
            });
            expect(logged.isError).toBeTruthy();
            expect(textOf(logged)).toContain(DRAFT);
            // delete_recipe points a draft to discard_recipe_draft.
            const deleted = await call("delete_recipe", { id: recipeId });
            expect(deleted.isError).toBeTruthy();
            expect(textOf(deleted)).toContain("discard_recipe_draft");
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
            // A draft: left out of the list, filtered or not, until the
            // drafts themselves are asked for.
            expect(imported.structuredContent).toMatchObject({
                draft: true,
            });
            expect(imported.structuredContent?.draft_expires_at).not.toBeNull();
            for (const args of [{}, { tag: "breakfast" }, { query: "oats" }]) {
                const listed = await call("list_recipes", args);
                expect(textOf(listed)).not.toContain("Overnight oats");
            }
            const drafts = await call("list_recipes", {
                tag: "breakfast",
                verification: "unverified",
            });
            expect(textOf(drafts)).toContain(
                "Overnight oats yield 2 (draft, deleted",
            );
            const [row] = drafts.structuredContent?.recipes as {
                draft_expires_at: string | null;
            }[];
            expect(row?.draft_expires_at).not.toBeNull();
            const shown = await call("get_recipe", {
                id: (imported.structuredContent?.recipe as { id: string }).id,
            });
            expect(shown.structuredContent).toMatchObject({
                draft: true,
                verification: "unverified",
            });
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

    describe("the notification inbox", () => {
        const UTC_DAY = 86_400_000;
        const daysFromNow = (delta: number) =>
            new Date(Date.now() + delta * UTC_DAY).toISOString().slice(0, 10);

        async function listed(
            call: CallTool,
            args: Record<string, unknown> = {},
        ) {
            const out = await call("list_notices", args);
            expect(out.isError).toBeFalsy();
            return {
                text: textOf(out),
                ...LIST_NOTICES_OUTPUT_SCHEMA.parse(out.structuredContent),
            };
        }

        /** A fridge item that expires in `days` days: one food-expiring condition. */
        async function expiring(
            call: CallTool,
            name = "Soon kefir",
            days = 3,
        ): Promise<string> {
            const loc =
                (await db.fridgeStore.listLocations("hh-1"))[0] ??
                ({
                    id: (await call("add_fridge_location", { name: "Fridge" }))
                        .structuredContent?.id,
                } as { id: string });
            const added = await call("add_fridge_item", {
                location_id: loc.id,
                kind: "food",
                name,
                amount: 1,
                unit: "g",
            });
            const id = added.structuredContent?.id as string;
            const row = (await db.fridgeStore.listItems("hh-1")).find(
                (r) => r.id === id,
            );
            await db.fridgeStore.updateItem({
                ...row!,
                expiresOn: daysFromNow(days),
            });
            return id;
        }

        const promote = (userId: string, role: "member" | "admin") => {
            const member = db.members.find((m) => m.userId === userId)!;
            member.role = role;
        };

        test("a condition that just became true is listed with no page load before it", async () => {
            await withUser(alice, async (call) => {
                const itemId = await expiring(call);
                const sc = await listed(call);
                expect(sc.count).toBe(1);
                expect(sc.notifications).toHaveLength(1);
                const n = sc.notifications[0]!;
                expect(n).toMatchObject({
                    kind: "food_expiring",
                    bucket: "household",
                    read: false,
                    snoozed_until: null,
                    can_dismiss_for_everyone: true,
                    subject: { kind: "fridge_item", id: itemId },
                    open: "/kitchen/fridge",
                });
                expect(n.message).toContain("Soon kefir");
                expect(sc.text).toContain(`[notification_id: ${n.id}]`);
                expect(sc.text).toContain(`[id: ${itemId}]`);
            });
        });

        test("every member has their own copy, and only a manager may dismiss for everyone", async () => {
            let aliceId = "";
            await withUser(alice, async (call) => {
                await expiring(call);
                aliceId = (await listed(call)).notifications[0]!.id;
            });
            await withUser(bob, async (call) => {
                const sc = await listed(call);
                expect(sc.count).toBe(1);
                expect(sc.notifications[0]!.id).not.toBe(aliceId);
                expect(sc.notifications[0]!.can_dismiss_for_everyone).toBe(
                    false,
                );
            });
        });

        test("bucket narrows the list and never the unread count", async () => {
            await withUser(alice, async (call) => {
                await expiring(call);
                db.weighInRows.push({
                    userId: alice,
                    displayName: "Alice",
                    lastLoggedAt: `${daysFromNow(-9)}T12:00:00Z`,
                });
                const all = await listed(call);
                expect(all.count).toBe(2);
                expect(all.notifications.map((n) => n.kind).sort()).toEqual([
                    "food_expiring",
                    "weigh_in_due",
                ]);
                const personal = await listed(call, { bucket: "personal" });
                expect(personal.count).toBe(2);
                expect(personal.notifications.map((n) => n.kind)).toEqual([
                    "weigh_in_due",
                ]);
                expect(personal.notifications[0]!.bucket).toBe("personal");
                expect(
                    personal.notifications[0]!.can_dismiss_for_everyone,
                ).toBe(false);
                const household = await listed(call, { bucket: "household" });
                expect(household.count).toBe(2);
                expect(household.notifications.map((n) => n.kind)).toEqual([
                    "food_expiring",
                ]);
            });
            // The weigh-in is personal: no one else's inbox has it.
            await withUser(bob, async (call) => {
                const sc = await listed(call);
                expect(sc.notifications.map((n) => n.kind)).toEqual([
                    "food_expiring",
                ]);
            });
        });

        test("nothing needs attention says so", async () => {
            await withUser(alice, async (call) => {
                const sc = await listed(call);
                expect(sc.count).toBe(0);
                expect(sc.notifications).toEqual([]);
                expect(sc.text).toBe("Nothing needs attention.");
            });
        });

        test("snooze_notice hides a row until its time, for the person alone when a member", async () => {
            await withUser(bob, async (call) => {
                await expiring(call);
                const id = (await listed(call)).notifications[0]!.id;
                const out = await call("snooze_notice", {
                    notification_id: id,
                    until: "week",
                });
                expect(out.isError).toBeFalsy();
                const sc = out.structuredContent as {
                    snoozed: boolean;
                    snoozed_until: string;
                    for_everyone: boolean;
                };
                expect(sc.snoozed).toBe(true);
                expect(sc.for_everyone).toBe(false);
                expect(Date.parse(sc.snoozed_until)).toBeGreaterThan(
                    Date.now() + 6 * UTC_DAY,
                );
                const after = await listed(call);
                expect(after.count).toBe(0);
                expect(after.notifications).toEqual([]);
                const withSnoozed = await listed(call, {
                    include_snoozed: true,
                });
                expect(withSnoozed.notifications).toHaveLength(1);
                expect(withSnoozed.notifications[0]!.snoozed_until).toBe(
                    sc.snoozed_until,
                );
                expect(withSnoozed.text).toContain("snoozed until");
                // The unread count leaves the snoozed row out, and the text
                // says so instead of calling the same row unread.
                expect(withSnoozed.text.split("\n")[0]).toBe(
                    "0 unread (1 snoozed).",
                );
                const line = withSnoozed.text.split("\n")[1]!;
                expect(line).toContain("snoozed until");
                expect(line).not.toContain("unread");
            });
            await withUser(alice, async (call) => {
                const sc = await listed(call);
                expect(sc.count).toBe(1);
            });
        });

        test("with include_snoozed the text counts the snoozed rows apart from the unread ones", async () => {
            await withUser(bob, async (call) => {
                await expiring(call, "Kefir", 3);
                await expiring(call, "Yogurt", 4);
                const rows = (await listed(call)).notifications;
                expect(rows).toHaveLength(2);
                const kefir = rows.find((n) => n.message.includes("Kefir"))!;
                await call("snooze_notice", {
                    notification_id: kefir.id,
                    until: "week",
                });

                // Without include_snoozed the snoozed row is not there to mention.
                const plain = await listed(call);
                expect(plain.text.split("\n")[0]).toBe("1 unread.");

                const both = await listed(call, { include_snoozed: true });
                const [head, ...lines] = both.text.split("\n");
                expect(head).toBe("1 unread (1 snoozed).");
                const kefirLine = lines.find((l) => l.includes("Kefir"))!;
                const yogurtLine = lines.find((l) => l.includes("Yogurt"))!;
                expect(kefirLine).toContain("snoozed until");
                expect(kefirLine).not.toContain("unread");
                expect(yogurtLine).toContain("(unread)");
                expect(yogurtLine).not.toContain("snoozed");

                // A bucket that holds none of them does not claim any.
                const personal = await listed(call, {
                    include_snoozed: true,
                    bucket: "personal",
                });
                expect(personal.text).not.toContain("snoozed)");
            });
        });

        test("an owner's or admin's snooze of a household row covers every member", async () => {
            await withUser(bob, async (call) => {
                await expiring(call);
                await listed(call);
            });
            await withUser(alice, async (call) => {
                const id = (await listed(call)).notifications[0]!.id;
                const out = await call("snooze_notice", {
                    notification_id: id,
                    until: "tomorrow",
                });
                expect(out.structuredContent).toMatchObject({
                    snoozed: true,
                    for_everyone: true,
                });
                expect(textOf(out)).toContain("for every member");
            });
            await withUser(bob, async (call) => {
                const sc = await listed(call);
                expect(sc.notifications).toEqual([]);
            });
        });

        test("snooze_notice refuses a time that makes no sense", async () => {
            await withUser(alice, async (call) => {
                await expiring(call);
                const id = (await listed(call)).notifications[0]!.id;
                for (const until of [
                    "yesterday",
                    "2020-01-01T08:30",
                    "2099-01-01T08:30",
                    "",
                ]) {
                    const out = await call("snooze_notice", {
                        notification_id: id,
                        until,
                    });
                    expect(out.isError, until).toBe(true);
                }
                const none = await call("snooze_notice", {
                    notification_id: crypto.randomUUID(),
                    until: "week",
                });
                expect(none.isError).toBe(true);
                expect(textOf(none)).toContain("No such notification");
                expect((await listed(call)).count).toBe(1);
            });
        });

        test("mark_notices_read marks the ids it is given, then all", async () => {
            await withUser(alice, async (call) => {
                await expiring(call, "First kefir");
                await expiring(call, "Second kefir");
                const sc = await listed(call);
                expect(sc.count).toBe(2);
                const [first, second] = sc.notifications;
                const one = await call("mark_notices_read", {
                    notification_ids: [first!.id],
                });
                expect(one.structuredContent).toEqual({ marked_read: 1 });
                const mid = await listed(call);
                expect(mid.count).toBe(1);
                expect(
                    mid.notifications.find((n) => n.id === first!.id)!.read,
                ).toBe(true);
                const again = await call("mark_notices_read", {
                    notification_ids: [first!.id],
                });
                expect(again.structuredContent).toEqual({ marked_read: 0 });
                const all = await call("mark_notices_read", {
                    notification_ids: "all",
                });
                expect(all.structuredContent).toEqual({ marked_read: 1 });
                expect(textOf(all)).toBe("Marked 1 read.");
                const end = await listed(call);
                expect(end.count).toBe(0);
                expect(end.notifications.every((n) => n.read)).toBe(true);
                expect(second!.read).toBe(false);
            });
        });

        test("an agent acts only for its own person: another member's row is refused", async () => {
            let bobRow = "";
            await withUser(bob, async (call) => {
                await expiring(call);
                bobRow = (await listed(call)).notifications[0]!.id;
            });
            await withUser(alice, async (call) => {
                await listed(call);
                for (const [tool, args] of [
                    ["dismiss_notice", { notification_id: bobRow }],
                    [
                        "dismiss_notice",
                        { notification_id: bobRow, scope: "everyone" },
                    ],
                    [
                        "snooze_notice",
                        { notification_id: bobRow, until: "week" },
                    ],
                    ["mark_notices_read", { notification_ids: [bobRow] }],
                ] as const) {
                    const out = await call(tool, args);
                    expect(out.isError, `${tool} ${JSON.stringify(args)}`).toBe(
                        true,
                    );
                }
                // Nothing of Bob's moved.
                const row = await db.notificationsStore.get("hh-1", bobRow);
                expect(row).toMatchObject({
                    readAt: null,
                    snoozedUntil: null,
                    dismissedAt: null,
                });
            });
        });

        test("the household token acts as the owner", async () => {
            await withPat(async (call) => {
                await expiring(call);
                const sc = await listed(call);
                expect(sc.count).toBe(1);
                const row = await db.notificationsStore.get(
                    "hh-1",
                    sc.notifications[0]!.id,
                );
                expect(row!.recipientUserId).toBe(alice);
                expect(sc.notifications[0]!.can_dismiss_for_everyone).toBe(
                    true,
                );
            });
        });

        test("dismiss_notice for me leaves only the caller's inbox", async () => {
            await withUser(bob, async (call) => {
                await expiring(call);
                const id = (await listed(call)).notifications[0]!.id;
                const out = await call("dismiss_notice", {
                    notification_id: id,
                });
                expect(out.isError).toBeFalsy();
                expect(out.structuredContent).toEqual({ dismissed: true });
                expect(textOf(out)).toBe("Dismissed for you.");
                const again = await call("dismiss_notice", {
                    notification_id: id,
                    scope: "me",
                });
                expect(again.isError).toBeFalsy();
                expect(textOf(again)).toBe("Already dismissed.");
                expect((await listed(call)).notifications).toEqual([]);
                // A guarded delete it is not: nothing is recorded.
                expect(db.agentActions.__records()).toEqual([]);
            });
            await withUser(alice, async (call) => {
                expect((await listed(call)).count).toBe(1);
            });
        });

        test("dismiss_notice for everyone: a manager may, and it is recorded and undoable; a member is refused", async () => {
            let bobId = "";
            await withUser(bob, async (call) => {
                await expiring(call);
                const mine = (await listed(call)).notifications[0]!;
                bobId = mine.id;
                expect(mine.can_dismiss_for_everyone).toBe(false);
                const refused = await call("dismiss_notice", {
                    notification_id: mine.id,
                    scope: "everyone",
                });
                expect(refused.isError).toBe(true);
                expect(textOf(refused)).toContain("owner or an admin");
                expect(refused.structuredContent).toEqual({ dismissed: false });
                expect(db.agentActions.__records()).toEqual([]);
                expect((await listed(call)).count).toBe(1);
            });
            await withUser(alice, async (call) => {
                const mine = (await listed(call)).notifications[0]!;
                const out = await call("dismiss_notice", {
                    notification_id: mine.id,
                    scope: "everyone",
                });
                expect(out.isError).toBeFalsy();
                expect(out.structuredContent).toEqual({ dismissed: true });
                expect(textOf(out)).toContain("Dismissed for everyone.");
                expect(textOf(out)).toContain("undo");
                const records = db.agentActions.__records();
                expect(records).toHaveLength(1);
                expect(records[0]).toMatchObject({
                    tool: "dismiss_notice",
                    destructive: true,
                    undoable: true,
                });
                expect(records[0]!.summary).toContain("Dismissed for everyone");
                expect((await listed(call)).notifications).toEqual([]);
            });
            await withUser(bob, async (call) => {
                // Bob's copy is gone with it, whatever his id was.
                const sc = await listed(call);
                expect(sc.notifications.map((n) => n.id)).not.toContain(bobId);
                expect(sc.notifications).toEqual([]);
            });
        });

        test("an admin may dismiss for everyone; the personal switch and the household's off still apply", async () => {
            await withUser(bob, async (call) => {
                promote(bob, "admin");
                await expiring(call);
                const id = (await listed(call)).notifications[0]!.id;
                // The household's off refuses everyone, an admin too.
                await db.settingsStore.setAgentDestructiveAllowed(
                    "hh-1",
                    false,
                );
                const off = await call("dismiss_notice", {
                    notification_id: id,
                    scope: "everyone",
                });
                expect(off.isError).toBe(true);
                expect(textOf(off)).toContain("Nothing was changed");
                await db.settingsStore.setAgentDestructiveAllowed("hh-1", true);
                // So does the person's own switch.
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    bob,
                    false,
                );
                const personOff = await call("dismiss_notice", {
                    notification_id: id,
                    scope: "everyone",
                });
                expect(personOff.isError).toBe(true);
                expect(db.agentActions.__records()).toEqual([]);
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    bob,
                    true,
                );
                const ok = await call("dismiss_notice", {
                    notification_id: id,
                    scope: "everyone",
                });
                expect(ok.isError).toBeFalsy();
                expect(db.agentActions.__records()).toHaveLength(1);
            });
        });

        test("can_dismiss_for_everyone is true only where the dismiss would be allowed", async () => {
            await withUser(alice, async (call) => {
                await expiring(call);
                const flag = async () =>
                    (await listed(call)).notifications[0]!
                        .can_dismiss_for_everyone;
                expect(await flag()).toBe(true);
                // Their own switch Off: the guard would refuse, so it says no.
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    alice,
                    false,
                );
                expect(await flag()).toBe(false);
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    alice,
                    true,
                );
                expect(await flag()).toBe(true);
                // The household's switch Off stops every person's agent.
                await db.settingsStore.setAgentDestructiveAllowed(
                    "hh-1",
                    false,
                );
                expect(await flag()).toBe(false);
                await db.settingsStore.setAgentDestructiveAllowed("hh-1", true);
                expect(await flag()).toBe(true);
            });
        });

        test("dismiss_notice refuses a notification_id with any field of the data-quality form", async () => {
            await withUser(alice, async (call) => {
                await expiring(call);
                const id = (await listed(call)).notifications[0]!.id;
                for (const extra of [
                    { code: "food.possible_duplicate" },
                    { subject_kind: "food" },
                    { subject_id: crypto.randomUUID() },
                    { related_id: crypto.randomUUID() },
                ]) {
                    const out = await call("dismiss_notice", {
                        notification_id: id,
                        ...extra,
                    });
                    expect(out.isError, JSON.stringify(extra)).toBe(true);
                    expect(out.structuredContent).toEqual({ dismissed: false });
                    expect(textOf(out)).toContain("not both");
                }
                // Nothing moved.
                expect((await listed(call)).count).toBe(1);
                expect(db.agentActions.__records()).toEqual([]);
            });
        });

        test("an owner's or admin's snooze for everyone is guarded: recorded, and refused when a switch is Off", async () => {
            let bobRow = "";
            await withUser(bob, async (call) => {
                await expiring(call);
                bobRow = (await listed(call)).notifications[0]!.id;
                // A member's own snooze is a plain write: nothing recorded.
                const own = await call("snooze_notice", {
                    notification_id: bobRow,
                    until: "tomorrow",
                });
                expect(own.isError).toBeFalsy();
                expect(own.structuredContent).toMatchObject({
                    for_everyone: false,
                });
                expect(db.agentActions.__records()).toEqual([]);
            });
            await withUser(alice, async (call) => {
                const mine = (await listed(call)).notifications[0]!;
                await db.settingsStore.setAgentDestructiveAllowed(
                    "hh-1",
                    false,
                );
                const off = await call("snooze_notice", {
                    notification_id: mine.id,
                    until: "week",
                });
                expect(off.isError).toBe(true);
                expect(textOf(off)).toContain("Nothing was changed");
                await db.settingsStore.setAgentDestructiveAllowed("hh-1", true);
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    alice,
                    false,
                );
                const personOff = await call("snooze_notice", {
                    notification_id: mine.id,
                    until: "week",
                });
                expect(personOff.isError).toBe(true);
                expect(db.agentActions.__records()).toEqual([]);
                expect(
                    (await db.notificationsStore.get("hh-1", bobRow))!
                        .snoozedUntil,
                ).not.toBeNull();
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    alice,
                    true,
                );
                const ok = await call("snooze_notice", {
                    notification_id: mine.id,
                    until: "week",
                });
                expect(ok.isError, textOf(ok)).toBeFalsy();
                expect(ok.structuredContent).toMatchObject({
                    snoozed: true,
                    for_everyone: true,
                });
                expect(textOf(ok)).toContain("for every member");
                // Recorded; whether the rows can be put back needs the real
                // tables (see the guard's database tests).
                expect(textOf(ok)).toContain("recorded in Settings");
                const records = db.agentActions.__records();
                expect(records).toHaveLength(1);
                expect(records[0]).toMatchObject({
                    tool: "snooze_notice",
                    destructive: true,
                });
                expect(records[0]!.summary).toContain("Snoozed for everyone");
            });
        });

        test("dismissing an event for everyone stamps every copy and records them", async () => {
            await withUser(bob, async (call) => {
                // Recipe changes are off until a person turns them on.
                const set = await call("set_notification_settings", {
                    kind: "recipe_changes",
                    enabled: true,
                });
                expect(set.isError).toBeFalsy();
            });
            // Alice removes a recipe: Bob hears of it, Alice does not.
            await withUser(alice, async (call) => {
                const recipe = await call("create_recipe", {
                    name: "Lentil soup",
                    yield_portions: 2,
                });
                const out = await call("delete_recipe", {
                    id: recipe.structuredContent?.id,
                });
                expect(out.isError).toBeFalsy();
                expect((await listed(call)).notifications).toEqual([]);
            });
            let bobNotice = "";
            await withUser(bob, async (call) => {
                const sc = await listed(call);
                expect(sc.notifications).toHaveLength(1);
                const n = sc.notifications[0]!;
                bobNotice = n.id;
                expect(n.kind).toBe("recipe_changes");
                expect(n.message).toBe("Alice removed Lentil soup.");
                expect(n.open).toBe("/recipes");
                expect(n.subject?.kind).toBe("recipe");
            });
            await withUser(bob, async (call) => {
                promote(bob, "admin");
                const out = await call("dismiss_notice", {
                    notification_id: bobNotice,
                    scope: "everyone",
                });
                expect(out.isError).toBeFalsy();
                expect((await listed(call)).notifications).toEqual([]);
                const rows = (
                    await db.notificationsStore.listForHousehold("hh-1")
                ).filter((r) => r.kind === "recipe_changes");
                expect(rows.length).toBeGreaterThan(0);
                expect(rows.every((r) => r.dismissedAt !== null)).toBe(true);
                const records = db.agentActions
                    .__records()
                    .filter((r) => r.tool === "dismiss_notice");
                expect(records).toHaveLength(1);
                expect(records[0]).toMatchObject({ destructive: true });
            });
        });

        test("Allergens cannot be dismissed, snoozed or turned off", async () => {
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Safeway",
            );
            await withPat(async (call) => {
                await call("set_household_rules", {
                    person: [
                        { user_id: bob, allergens: [{ allergen: "peanut" }] },
                    ],
                });
                await call("upsert_food", {
                    name: "Peanut Butter",
                    allergens: ["peanut"],
                });
                await call("add_grocery_line", {
                    store_id: store.id,
                    kind: "food",
                    name: "Peanut Butter",
                    amount: 1,
                });
                const sc = await listed(call);
                const allergen = sc.notifications.find(
                    (n) => n.kind === "allergens",
                );
                expect(allergen).toBeTruthy();
                expect(allergen!.message).toBe(
                    "Peanut Butter contains peanut — Bob.",
                );
                expect(allergen!.can_dismiss_for_everyone).toBe(false);
                expect(allergen!.open).toBe("/kitchen/groceries");
                expect(sc.text).toContain("can't be dismissed or snoozed");
                for (const scope of ["me", "everyone"] as const) {
                    const out = await call("dismiss_notice", {
                        notification_id: allergen!.id,
                        scope,
                    });
                    expect(out.isError, scope).toBe(true);
                    expect(textOf(out)).toContain("Allergen");
                }
                const snooze = await call("snooze_notice", {
                    notification_id: allergen!.id,
                    until: "week",
                });
                expect(snooze.isError).toBe(true);
                expect(textOf(snooze)).toContain("Allergen");
                const off = await call("set_notification_settings", {
                    kind: "allergens",
                    enabled: false,
                });
                expect(off.isError).toBe(true);
                expect(textOf(off)).toContain("Allergen");
                const on = await call("set_notification_settings", {
                    kind: "allergens",
                    enabled: true,
                });
                expect(on.isError).toBeFalsy();
                // It is still there, unread, with nothing recorded.
                const after = await listed(call);
                expect(
                    after.notifications.some((n) => n.id === allergen!.id),
                ).toBe(true);
                expect(db.agentActions.__records()).toEqual([]);
            });
        });

        test("get_notification_settings and set_notification_settings read and change a person's kinds", async () => {
            await withUser(alice, async (call) => {
                const got = await call("get_notification_settings");
                expect(got.isError).toBeFalsy();
                const sc = GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA.parse(
                    got.structuredContent,
                );
                expect(sc.settings.map((s) => s.kind)).toEqual([
                    "allergens",
                    "food_expiring",
                    "running_low",
                    "weigh_in_due",
                    "recipe_changes",
                    "week_plan_changes",
                    "new_usuals",
                ]);
                const byKind = Object.fromEntries(
                    sc.settings.map((s) => [s.kind, s]),
                );
                expect(byKind.allergens).toMatchObject({
                    label: "Allergens",
                    enabled: true,
                    can_turn_off: false,
                });
                expect(byKind.food_expiring).toMatchObject({
                    label: "Food expiring",
                    enabled: true,
                    can_turn_off: true,
                });
                expect(byKind.recipe_changes!.enabled).toBe(false);
                expect(textOf(got)).toContain(
                    "Recipe changes by others [kind: recipe_changes]: off",
                );

                const turnedOn = await call("set_notification_settings", {
                    kind: "recipe_changes",
                    enabled: true,
                });
                expect(
                    SET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA.parse(
                        turnedOn.structuredContent,
                    ),
                ).toEqual({
                    kind: "recipe_changes",
                    label: "Recipe changes by others",
                    enabled: true,
                    can_turn_off: true,
                });
                expect(textOf(turnedOn)).toBe(
                    "Recipe changes by others is on.",
                );

                // A kind that is off leaves the inbox.
                await expiring(call);
                expect((await listed(call)).count).toBe(1);
                await call("set_notification_settings", {
                    kind: "food_expiring",
                    enabled: false,
                });
                const quiet = await listed(call);
                expect(quiet.count).toBe(0);
                expect(quiet.notifications).toEqual([]);
                const settings = GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA.parse(
                    (await call("get_notification_settings")).structuredContent,
                ).settings;
                expect(
                    settings.find((s) => s.kind === "food_expiring")!.enabled,
                ).toBe(false);
                // Someone else's choices are theirs.
            });
            await withUser(bob, async (call) => {
                const settings = GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA.parse(
                    (await call("get_notification_settings")).structuredContent,
                ).settings;
                expect(
                    settings.find((s) => s.kind === "food_expiring")!.enabled,
                ).toBe(true);
                expect(
                    settings.find((s) => s.kind === "recipe_changes")!.enabled,
                ).toBe(false);
            });
        });

        test("set_notification_settings names no kind it does not have", async () => {
            await withUser(alice, async (call) => {
                const out = await call("set_notification_settings", {
                    kind: "everything",
                    enabled: false,
                });
                expect(out.isError).toBe(true);
            });
        });
    });

    test("food.possible_duplicate comes with its food: get_food lists it, the code form dismisses it, a merge clears it", async () => {
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

            // Not in the inbox: it is a mark on the food.
            const inbox = LIST_NOTICES_OUTPUT_SCHEMA.parse(
                (await call("list_notices")).structuredContent,
            );
            expect(inbox.notifications).toEqual([]);
            const got = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: idA })).structuredContent,
            );
            const dupe = got.notices.find(
                (n) => n.code === "food.possible_duplicate",
            );
            expect(dupe).toBeTruthy();
            expect(
                [dupe!.subject.id, ...dupe!.related.map((r) => r.id)].sort(),
            ).toEqual([idA, idB].sort());
            for (const n of got.notices) NOTICE_SCHEMA.parse(n);

            // Dismissed with its own form, pair either way round.
            const dismissSwapped = await call("dismiss_notice", {
                code: "food.possible_duplicate",
                subject_kind: "food",
                subject_id: idB,
                related_id: idA,
            });
            expect(dismissSwapped.isError).toBeFalsy();
            expect(dismissSwapped.structuredContent).toEqual({
                dismissed: true,
            });
            const after = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: idA })).structuredContent,
            );
            expect(
                after.notices.some((n) => n.code === "food.possible_duplicate"),
            ).toBe(false);

            const pita = await call("upsert_food", { name: "pita" });
            const pitas = await call("upsert_food", { name: "pitas" });
            const pitaId = pita.structuredContent?.id as string;
            const pitasId = pitas.structuredContent?.id as string;
            const withNotice = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: pitaId })).structuredContent,
            );
            expect(
                withNotice.notices.some(
                    (n) => n.code === "food.possible_duplicate",
                ),
            ).toBe(true);

            await call("merge_foods", { keep_id: pitaId, drop_id: pitasId });
            const afterMerge = GET_FOOD_OUTPUT.parse(
                (await call("get_food", { food_id: pitaId })).structuredContent,
            );
            expect(
                afterMerge.notices.some(
                    (n) => n.code === "food.possible_duplicate",
                ),
            ).toBe(false);
        });
    });

    test("dismiss_notice with a data-quality code still dismisses, and refuses what the inbox owns", async () => {
        await withUser(alice, async (call) => {
            const itemId = await (async () => {
                const loc = await call("add_fridge_location", {
                    name: "Fridge",
                });
                const added = await call("add_fridge_item", {
                    location_id: loc.structuredContent?.id,
                    kind: "food",
                    name: "Soon butter",
                    amount: 1,
                    unit: "g",
                });
                return added.structuredContent?.id as string;
            })();
            const row = (await db.fridgeStore.listItems("hh-1")).find(
                (r) => r.id === itemId,
            );
            await db.fridgeStore.updateItem({
                ...row!,
                expiresOn: new Date(Date.now() + 3 * 86_400_000)
                    .toISOString()
                    .slice(0, 10),
            });

            // An inbox condition goes by its notification_id, not by code.
            const refused = await call("dismiss_notice", {
                code: "fridge.expiring",
                subject_kind: "fridge_item",
                subject_id: itemId,
            });
            expect(refused.isError).toBe(true);
            expect(textOf(refused)).toContain("notification_id");
            expect(refused.structuredContent).toEqual({ dismissed: false });
            // The fridge's own notice no longer offers the old form.
            const fridge = await call("get_fridge");
            expect(textOf(fridge)).not.toContain("[code: ");

            const neither = await call("dismiss_notice", {});
            expect(neither.isError).toBe(true);
            expect(textOf(neither)).toContain("notification_id");
            const both = await call("dismiss_notice", {
                notification_id: crypto.randomUUID(),
                code: "food.possible_duplicate",
                subject_kind: "food",
                subject_id: crypto.randomUUID(),
            });
            expect(both.isError).toBe(true);
            const scoped = await call("dismiss_notice", {
                scope: "me",
                code: "food.possible_duplicate",
                subject_kind: "food",
                subject_id: crypto.randomUUID(),
            });
            expect(scoped.isError).toBe(true);
            expect(textOf(scoped)).toContain("whole household");
            const missing = await call("dismiss_notice", {
                code: "food.possible_duplicate",
                subject_kind: "food",
                subject_id: crypto.randomUUID(),
            });
            expect(missing.isError).toBe(true);
            expect(textOf(missing).toLowerCase()).toContain("not open");
            const warn = await call("dismiss_notice", {
                code: "fridge.expired",
                subject_kind: "fridge_item",
                subject_id: itemId,
            });
            expect(warn.isError).toBe(true);
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

// ---------- destructive tools: recorded, undoable, switchable ----------
//
// Twelve tools delete, clear, discard, unplan or merge. Each runs through the
// household's agent-action guard: it records an entry (with the rows it
// removed), says in its result that the household can undo it, and is refused
// while the household's switch is Off. These tests run on the memory stores
// this file mocks, and on both protocol eras; the SQL (the snapshot really
// holding the rows, undo putting them back) is tested against Postgres in
// src/mcp/tools/destructive.db.test.ts.

describe("/mcp destructive tools are guarded", () => {
    const UNDO_SENTENCE =
        "The household can undo this for 24 hours in Settings › AI connections.";
    const REFUSAL = "Any agent can delete is Off in Settings › AI connections.";
    const PERSON_REFUSAL =
        "Your agents can delete is Off in Settings › AI connections for the person you act for.";

    test("every place that names the switches names the ones the AI page shows", () => {
        const html = renderSettingsAiV2Body({
            chrome: {} as never,
            connections: [],
            destructive: { allowed: false, canChange: true },
            personal: { canDelete: true, householdOffBy: null },
            showCards: true,
            activity: [],
            now: new Date(),
            timezone: "UTC",
            mcpUrl: "https://example.test/mcp",
        } as never);
        expect(html).toContain("Any agent can delete");
        expect(html).toContain("Your agents can delete");
        expect(AGENT_DESTRUCTIVE_SETTING).toBe("Any agent can delete");
        expect(AGENT_PERSONAL_SETTING).toBe("Your agents can delete");
        expect(AGENT_ACTIONS_OFF_TEXT).toContain(REFUSAL);
        expect(AGENT_PERSON_OFF_TEXT).toContain(PERSON_REFUSAL);
        expect(new AgentActionsDisabledError().message).toContain(
            "Settings › AI connections › Any agent can delete is Off",
        );
        expect(new AgentActionsDisabledError("person_off").message).toContain(
            "Settings › AI connections › Your agents can delete is Off",
        );
        expect(SERVER_INSTRUCTIONS).toContain(
            "(Your agents can delete, in Settings › AI connections, off until they turn it on)",
        );
        expect(SERVER_INSTRUCTIONS).toContain(
            "The household owner's Any agent can delete switch",
        );
        for (const text of [
            AGENT_ACTIONS_OFF_TEXT,
            AGENT_PERSON_OFF_TEXT,
            new AgentActionsDisabledError().message,
            new AgentActionsDisabledError("person_off").message,
            SERVER_INSTRUCTIONS,
        ]) {
            expect(text).not.toContain("Agents may make destructive changes");
            expect(text).not.toContain("Allow destructive changes");
        }
    });

    // unplan_recipe is only registered while the plan tools are on.
    beforeEach(() => setFlagsForTests(createMemoryFlags({})));
    afterEach(() => resetFlagsForTests());

    function appWith(
        auth:
            | { kind: "user"; userId: string }
            | { kind: "household"; householdId: string },
        client?: string,
    ) {
        const app = new Hono();
        app.all("/mcp", (c) => {
            c.set("authContext", auth);
            if (client) c.set("tokenClient", client);
            return handleMcp(c);
        });
        return app;
    }

    async function withClientFor<T>(
        app: Hono,
        mode: EraMode,
        run: (call: CallTool) => Promise<T>,
    ): Promise<T> {
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
            return await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: callToolArguments(name, args),
                    }) as Promise<ToolResult>,
            );
        } finally {
            await client.close();
        }
    }

    test.each(ERAS)(
        "the server instructions name remove among the destructive verbs (%p)",
        async (era) => {
            const app = appWith({ kind: "user", userId: "u1" });
            const client = new Client(
                { name: "t", version: "0" },
                { versionNegotiation: { mode: era } },
            );
            await client.connect(
                new StreamableHTTPClientTransport(
                    new URL("http://test.local/mcp"),
                    {
                        fetch: async (url, init) =>
                            app.request(new Request(String(url), init)),
                    },
                ),
            );
            try {
                expect(client.getInstructions()).toContain(
                    "the ones that delete, remove, discard, clear, unplan or merge",
                );
            } finally {
                await client.close();
            }
        },
    );

    /** The tools over the real /mcp handler on the legacy era, as the owner. */
    const viaHttp = (run: (call: CallTool) => Promise<void>) =>
        withClientFor(appWith({ kind: "user", userId: "u1" }), "legacy", run);

    async function addStore() {
        await db.settingsStore.insertStore({
            id: "store-1",
            householdId: "hh-1",
            name: "Corner",
            sortOrder: 0,
        });
        await db.settingsStore.insertSection({
            id: "section-1",
            householdId: "hh-1",
            storeId: "store-1",
            name: "Other",
            sortOrder: 0,
            hidden: false,
            isOther: true,
        });
    }

    /**
     * The guard records against its own memory store, so what a tool is about
     * to remove is mirrored there by id: that stands in for the database the
     * real guard reads the rows from.
     */
    async function mirror() {
        const agent = db.agentActions;
        const row = (id: string, more: Record<string, unknown> = {}) => ({
            id,
            household_id: "hh-1",
            ...more,
        });
        for (const food of await db.foodsStore.listFoods("hh-1")) {
            agent.__seed("foods", row(food.id));
        }
        for (const line of await db.groceryStore.listLines("hh-1")) {
            agent.__seed("grocery_lines", row(line.id));
        }
        for (const loc of await db.fridgeStore.listLocations("hh-1")) {
            agent.__seed("fridge_locations", row(loc.id));
        }
        for (const item of await db.fridgeStore.listItems("hh-1")) {
            agent.__seed(
                "fridge_items",
                row(item.id, { food_id: item.foodId }),
            );
        }
        for (const recipe of [
            ...(await db.recipesStore.listRecipes("hh-1")),
            ...(await db.recipesStore.listDraftRecipes("hh-1")),
        ]) {
            agent.__seed("recipes", row(recipe.id));
        }
        for (const ingredient of await db.recipesStore.listIngredientsForHousehold(
            "hh-1",
        )) {
            agent.__seed("recipe_ingredients", row(ingredient.id));
        }
        for (const plan of await db.plansStore.listPlans(
            "hh-1",
            "2000-01-01",
            "2999-12-31",
        )) {
            agent.__seed("recipe_plans", row(plan.id));
        }
        for (const meal of db.meals) agent.__seed("meals", row(meal.id));
        for (const id of db.rowIds) {
            agent.__seed("water_log", row(id));
            agent.__seed("weight_log", row(id));
        }
    }

    /** What the tools could have changed, as one comparable value. */
    async function domainState(): Promise<string> {
        return JSON.stringify({
            lines: await db.groceryStore.listLines("hh-1"),
            locations: await db.fridgeStore.listLocations("hh-1"),
            items: await db.fridgeStore.listItems("hh-1"),
            movements: await db.stockStore.listMovements("hh-1"),
            recipes: await db.recipesStore.listRecipes("hh-1"),
            drafts: await db.recipesStore.listDraftRecipes("hh-1"),
            ingredients:
                await db.recipesStore.listIngredientsForHousehold("hh-1"),
            plans: await db.plansStore.listPlans(
                "hh-1",
                "2000-01-01",
                "2999-12-31",
            ),
            foods: await db.foodsStore.listFoods("hh-1"),
            meals: db.meals,
            rowIds: [...db.rowIds],
        });
    }

    type Arranged = {
        tool: string;
        args: Record<string, unknown>;
        summary: string;
        /** Text the tool says first, before the undo sentence. */
        text?: string;
    };

    const scenarios: Record<string, (call: CallTool) => Promise<Arranged>> = {
        delete_grocery_line: async (call) => {
            await addStore();
            const eggs = await call("upsert_food", { name: "Eggs" });
            const line = await call("add_grocery_line", {
                store_id: "store-1",
                kind: "food",
                food_id: eggs.structuredContent?.id,
                amount: 2,
                unit: "each",
            });
            const id = line.structuredContent?.id as string;
            return {
                tool: "delete_grocery_line",
                args: { id },
                summary: "Deleted grocery line",
                text: `Deleted grocery line ${id}.`,
            };
        },
        clear_checked_grocery_lines: async (call) => {
            await addStore();
            for (const name of ["Eggs", "Milk"]) {
                const food = await call("upsert_food", { name });
                const line = await call("add_grocery_line", {
                    store_id: "store-1",
                    kind: "food",
                    food_id: food.structuredContent?.id,
                    amount: 1,
                    unit: "each",
                });
                await call("check_grocery_line", {
                    id: line.structuredContent?.id,
                    checked: true,
                });
            }
            return {
                tool: "clear_checked_grocery_lines",
                args: {},
                summary: "Cleared 2 checked grocery lines",
                text: "Cleared 2 checked lines.",
            };
        },
        delete_fridge_location: async (call) => {
            const loc = await call("add_fridge_location", { name: "Freezer" });
            const peas = await call("upsert_food", { name: "Peas" });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                food_id: peas.structuredContent?.id,
                amount: 100,
                unit: "g",
            });
            return {
                tool: "delete_fridge_location",
                args: { id: loc.structuredContent?.id },
                summary: "Deleted fridge location Freezer and its 1 item",
            };
        },
        delete_fridge_item: async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const eggs = await call("upsert_food", { name: "Eggs" });
            const item = await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                food_id: eggs.structuredContent?.id,
                amount: 300,
                unit: "g",
            });
            return {
                tool: "delete_fridge_item",
                args: { id: item.structuredContent?.id },
                summary: "Deleted fridge item",
            };
        },
        discard_fridge_item: async (call) => {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const eggs = await call("upsert_food", { name: "Eggs" });
            const item = await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                food_id: eggs.structuredContent?.id,
                amount: 10,
                unit: "g",
            });
            return {
                tool: "discard_fridge_item",
                args: { id: item.structuredContent?.id, amount: 4 },
                summary: "Tossed 4 g of",
                text: "Tossed 4 g.",
            };
        },
        delete_meal: async () => {
            db.meals = [storedMeal({ id: "m1", description: "Porridge" })];
            return {
                tool: "delete_meal",
                args: { id: "m1" },
                summary: 'Deleted meal "Porridge"',
                text: "Meal m1 deleted.",
            };
        },
        delete_water: async () => {
            db.rowIds.add("w1");
            return {
                tool: "delete_water",
                args: { id: "w1" },
                summary: "Deleted water entry w1",
                text: "Water entry w1 deleted.",
            };
        },
        delete_weight: async () => {
            db.rowIds.add("k1");
            return {
                tool: "delete_weight",
                args: { id: "k1" },
                summary: "Deleted weight entry k1",
                text: "Weight entry k1 deleted.",
            };
        },
        delete_recipe: async (call) => {
            const recipe = await call("create_recipe", {
                name: "Soup",
                yield_portions: 2,
            });
            return {
                tool: "delete_recipe",
                args: { id: recipe.structuredContent?.id },
                summary: "Deleted recipe Soup",
            };
        },
        remove_recipe_ingredient: async (call) => {
            const flour = await call("upsert_food", { name: "Flour" });
            const recipe = await call("create_recipe", {
                name: "Soup",
                yield_portions: 2,
            });
            const added = await call("add_recipe_ingredient", {
                recipe_id: recipe.structuredContent?.id,
                food_id: flour.structuredContent?.id,
                amount: 200,
                unit: "g",
            });
            // A second line: a saved recipe refuses losing its last one.
            const salt = await call("upsert_food", { name: "Salt" });
            await call("add_recipe_ingredient", {
                recipe_id: recipe.structuredContent?.id,
                food_id: salt.structuredContent?.id,
                amount: 1,
                unit: "g",
            });
            const [ingredient] =
                await db.recipesStore.listIngredientsForHousehold("hh-1");
            expect(added.isError).toBeFalsy();
            return {
                tool: "remove_recipe_ingredient",
                args: {
                    recipe_id: recipe.structuredContent?.id,
                    ingredient_id: ingredient!.id,
                },
                summary: "Removed Flour from recipe Soup",
            };
        },
        discard_recipe_draft: async (call) => {
            const made = await call("import_recipe_from_text", {
                text: "Leek soup",
                name: "Leek soup",
                instructions: "1. Simmer",
                ingredients: [{ name: "Leek", amount: 2, unit: "each" }],
                on_similar: "create",
            });
            expect(made.isError).toBeFalsy();
            return {
                tool: "discard_recipe_draft",
                args: {
                    recipe_id: (
                        made.structuredContent?.recipe as { id: string }
                    ).id,
                },
                summary: "Discarded draft Leek soup",
            };
        },
        unplan_recipe: async (call) => {
            const recipe = await call("create_recipe", {
                name: "Soup",
                yield_portions: 2,
            });
            const planned = await call("plan_recipe", {
                recipe_id: recipe.structuredContent?.id,
                date: addUtcDaysForDestructive(2),
                slot: "dinner",
            });
            expect(planned.isError).toBeFalsy();
            const plan = planned.structuredContent?.plan as { plan_id: string };
            return {
                tool: "unplan_recipe",
                args: { plan_id: plan.plan_id },
                summary: "Removed Soup from the plan for",
            };
        },
        update_plan: async (call) => {
            const recipe = await call("create_recipe", {
                name: "Soup",
                yield_portions: 2,
            });
            const planned = await call("plan_recipe", {
                recipe_id: recipe.structuredContent?.id,
                date: addUtcDaysForDestructive(2),
                slot: "dinner",
            });
            expect(planned.isError).toBeFalsy();
            const plan = planned.structuredContent?.plan as { plan_id: string };
            return {
                tool: "update_plan",
                args: { plan_id: plan.plan_id, slot: "lunch" },
                summary: "Changed the plan for Soup on",
                text: "Updated: Soup",
            };
        },
        merge_foods: async (call) => {
            const keep = await call("upsert_food", { name: "Eggs" });
            const drop = await call("upsert_food", {
                name: "Egg",
                on_similar: "create",
            });
            return {
                tool: "merge_foods",
                args: {
                    keep_id: keep.structuredContent?.id,
                    drop_id: drop.structuredContent?.id,
                },
                summary: "Merged Egg into Eggs",
            };
        },
    };

    function addUtcDaysForDestructive(days: number): string {
        const d = new Date(Date.now() + days * 86_400_000);
        return d.toISOString().slice(0, 10);
    }

    test("every guarded tool has a scenario", () => {
        expect(Object.keys(scenarios).sort()).toEqual(
            [
                "clear_checked_grocery_lines",
                "delete_fridge_item",
                "delete_fridge_location",
                "delete_grocery_line",
                "delete_meal",
                "delete_recipe",
                "delete_water",
                "delete_weight",
                "discard_fridge_item",
                "discard_recipe_draft",
                "merge_foods",
                "remove_recipe_ingredient",
                "unplan_recipe",
                "update_plan",
            ].sort(),
        );
    });

    for (const [tool, arrange] of Object.entries(scenarios)) {
        test(`${tool} records the action and says how to undo it`, async () => {
            await viaHttp(async (call) => {
                const arranged = await arrange(call);
                await mirror();
                const before = await domainState();
                const result = await call(arranged.tool, arranged.args);
                expect(result.isError).toBeFalsy();
                expect(await domainState()).not.toBe(before);
                const text = textOf(result);
                expect(text).toContain(UNDO_SENTENCE);
                if (arranged.text) expect(text).toStartWith(arranged.text);

                const records = db.agentActions.__records();
                expect(records).toHaveLength(1);
                expect(records[0]).toMatchObject({
                    householdId: "hh-1",
                    memberId: "u1",
                    connection: "OAuth app",
                    tool,
                    destructive: true,
                    undoable: true,
                });
                expect(records[0]!.summary).toContain(arranged.summary);
                expect(records[0]!.snapshot).not.toBeNull();
            });
        });

        test(`${tool} is refused while the switch is Off, and changes nothing`, async () => {
            await viaHttp(async (call) => {
                const arranged = await arrange(call);
                await mirror();
                await db.settingsStore.setAgentDestructiveAllowed(
                    "hh-1",
                    false,
                );
                const before = await domainState();
                const result = await call(arranged.tool, arranged.args);
                expect(result.isError).toBe(true);
                expect(textOf(result)).toContain(REFUSAL);
                expect(textOf(result)).toContain("Ask the household owner");
                expect(await domainState()).toBe(before);
                expect(db.agentActions.__records()).toEqual([]);
                // A refusal is a failure with its own category.
                const row = db.analyticsRows.find((r) => r.tool_name === tool);
                expect(row).toMatchObject({
                    success: false,
                    error_category: "agent_actions_disabled",
                });
            });
        });
    }

    test("a call that names nothing records nothing and promises no undo", async () => {
        await viaHttp(async (call) => {
            await addStore();
            const result = await call("delete_grocery_line", { id: "nope" });
            expect(result.isError).toBeFalsy();
            expect(textOf(result)).toBe("No grocery line found with id nope.");
            expect(db.agentActions.__records()).toEqual([]);
        });
    });

    test("an action that cannot be put back says so instead of promising an undo", async () => {
        await viaHttp(async (call) => {
            // Nothing is mirrored: the guard has no rows to snapshot.
            db.rowIds.add("w1");
            const result = await call("delete_water", { id: "w1" });
            expect(result.isError).toBeFalsy();
            expect(textOf(result)).not.toContain(UNDO_SENTENCE);
            expect(textOf(result)).toContain(
                "This change can't be undone, but it is recorded in Settings › AI connections.",
            );
            expect(db.agentActions.__records()).toHaveLength(1);
            expect(db.agentActions.__records()[0]!.undoable).toBe(false);
        });
    });

    describe("over HTTP", () => {
        test.each(ERAS)(
            "a destructive call records an action and says how to undo it (%p)",
            async (era) => {
                await withClientFor(
                    appWith({ kind: "user", userId: "u1" }, "Claude"),
                    era,
                    async (call) => {
                        const arranged =
                            await scenarios.delete_grocery_line!(call);
                        await mirror();
                        const result = await call(arranged.tool, arranged.args);
                        expect(result.isError).toBeFalsy();
                        expect(textOf(result)).toContain(UNDO_SENTENCE);
                        expect(db.agentActions.__records()).toMatchObject([
                            {
                                tool: "delete_grocery_line",
                                memberId: "u1",
                                connection: "Claude",
                            },
                        ]);
                    },
                );
            },
        );

        test.each(ERAS)(
            "the refusal reads the same on both eras (%p)",
            async (era) => {
                await withClientFor(
                    appWith({ kind: "user", userId: "u1" }, "Claude"),
                    era,
                    async (call) => {
                        const arranged = await scenarios.delete_water!(call);
                        await mirror();
                        await db.settingsStore.setAgentDestructiveAllowed(
                            "hh-1",
                            false,
                        );
                        const result = await call(arranged.tool, arranged.args);
                        expect(result.isError).toBe(true);
                        expect(textOf(result)).toContain(REFUSAL);
                        expect(db.rowIds.has("w1")).toBe(true);
                    },
                );
            },
        );

        test.each(ERAS)(
            "a person's own switch Off refuses, naming that switch, and changes nothing (%p)",
            async (era) => {
                await withClientFor(
                    appWith({ kind: "user", userId: "u1" }, "Claude"),
                    era,
                    async (call) => {
                        const arranged = await scenarios.delete_water!(call);
                        await mirror();
                        await db.settingsStore.setMemberAgentsCanDelete(
                            "hh-1",
                            "u1",
                            false,
                        );
                        const result = await call(arranged.tool, arranged.args);
                        expect(result.isError).toBe(true);
                        expect(textOf(result)).toContain(PERSON_REFUSAL);
                        expect(textOf(result)).toContain(
                            "Ask them to turn it on",
                        );
                        // It is not the household's switch that said no.
                        expect(textOf(result)).not.toContain(REFUSAL);
                        expect(db.rowIds.has("w1")).toBe(true);
                        expect(db.agentActions.__records()).toEqual([]);
                        expect(
                            db.analyticsRows.find(
                                (r) => r.tool_name === "delete_water",
                            ),
                        ).toMatchObject({
                            success: false,
                            error_category: "agent_actions_disabled",
                        });
                    },
                );
            },
        );

        test.each(ERAS)(
            "the household's off is the cause named when both are off, and when only it is (%p)",
            async (era) => {
                for (const own of [true, false]) {
                    await withClientFor(
                        appWith({ kind: "user", userId: "u1" }, "Claude"),
                        era,
                        async (call) => {
                            const arranged =
                                await scenarios.delete_water!(call);
                            await mirror();
                            await db.settingsStore.setMemberAgentsCanDelete(
                                "hh-1",
                                "u1",
                                own,
                            );
                            await db.settingsStore.setAgentDestructiveAllowed(
                                "hh-1",
                                false,
                            );
                            const result = await call(
                                arranged.tool,
                                arranged.args,
                            );
                            expect(result.isError).toBe(true);
                            expect(textOf(result)).toContain(REFUSAL);
                            expect(textOf(result)).not.toContain(
                                PERSON_REFUSAL,
                            );
                            expect(db.rowIds.has("w1")).toBe(true);
                        },
                    );
                }
            },
        );

        test("the household token is the owner's agent: their switch decides, not a member's", async () => {
            db.members.push({
                householdId: "hh-1",
                userId: "u2",
                role: "member",
                displayName: "U2",
            });
            await db.settingsStore.setMemberAgentsCanDelete(
                "hh-1",
                "u2",
                false,
            );
            await withClientFor(
                appWith({ kind: "household", householdId: "hh-1" }),
                "legacy",
                async (call) => {
                    const arranged = await scenarios.delete_grocery_line!(call);
                    await mirror();
                    await db.settingsStore.setMemberAgentsCanDelete(
                        "hh-1",
                        "u1",
                        false,
                    );
                    const refused = await call(arranged.tool, arranged.args);
                    expect(refused.isError).toBe(true);
                    expect(textOf(refused)).toContain(PERSON_REFUSAL);
                    expect(db.agentActions.__records()).toEqual([]);
                    await db.settingsStore.setMemberAgentsCanDelete(
                        "hh-1",
                        "u1",
                        true,
                    );
                    const allowed = await call(arranged.tool, arranged.args);
                    expect(allowed.isError).toBeFalsy();
                    expect(db.agentActions.__records()).toMatchObject([
                        { memberId: null, connection: "household token" },
                    ]);
                },
            );
        });

        test("a member's agent is another person: their own switch, not the owner's", async () => {
            db.members.push({
                householdId: "hh-1",
                userId: "u2",
                role: "member",
                displayName: "U2",
            });
            await withClientFor(
                appWith({ kind: "user", userId: "u2" }, "Claude"),
                "legacy",
                async (call) => {
                    // The owner's switch is on (set in reset); the member's is not.
                    const arranged = await scenarios.delete_water!(call);
                    await mirror();
                    const refused = await call(arranged.tool, arranged.args);
                    expect(refused.isError).toBe(true);
                    expect(textOf(refused)).toContain(PERSON_REFUSAL);
                    await db.settingsStore.setMemberAgentsCanDelete(
                        "hh-1",
                        "u2",
                        true,
                    );
                    const allowed = await call(arranged.tool, arranged.args);
                    expect(allowed.isError).toBeFalsy();
                    expect(db.agentActions.__records()).toMatchObject([
                        { memberId: "u2", tool: "delete_water" },
                    ]);
                },
            );
        });

        test("the household token records no member", async () => {
            await withClientFor(
                appWith({ kind: "household", householdId: "hh-1" }),
                "legacy",
                async (call) => {
                    const arranged = await scenarios.delete_grocery_line!(call);
                    await mirror();
                    const result = await call(arranged.tool, arranged.args);
                    expect(result.isError).toBeFalsy();
                    expect(textOf(result)).toContain(UNDO_SENTENCE);
                    expect(db.agentActions.__records()).toMatchObject([
                        { memberId: null, connection: "household token" },
                    ]);
                },
            );
        });

        test("tools/list still pins the guarded tools as destructive", async () => {
            await withHttpClient("u1", "legacy", async (client) => {
                const listed = (await client.listTools()).tools;
                for (const tool of Object.keys(scenarios)) {
                    const found = listed.find((t) => t.name === tool);
                    expect(found?.annotations?.destructiveHint).toBe(true);
                }
            });
        });
    });

    // The grocery and store admin tools go through the same guard. The
    // delete_store / reorder_stores / set_store_sections SQL (a
    // store, its sections and rules, the default store) is tested against
    // Postgres in src/mcp/tools/household-admin.db.test.ts; the memory stores
    // here cover the tool list, the schemas and both protocol eras.
    describe("grocery and store admin tools", () => {
        const STORE_A = "11111111-1111-4111-8111-111111111111";
        const STORE_B = "22222222-2222-4222-8222-222222222222";
        const SECTION_A_PRODUCE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
        const SECTION_A_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
        const SECTION_B_PRODUCE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
        const SECTION_B_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

        beforeEach(() => setFlagsForTests(createMemoryFlags({})));

        async function addStores() {
            for (const [id, name, order, produce, other] of [
                [STORE_A, "Costco", 0, SECTION_A_PRODUCE, SECTION_A_OTHER],
                [STORE_B, "Aldi", 1, SECTION_B_PRODUCE, SECTION_B_OTHER],
            ] as const) {
                await db.settingsStore.insertStore({
                    id,
                    householdId: "hh-1",
                    name,
                    sortOrder: order,
                });
                for (const [sectionId, sectionName, isOther] of [
                    [produce, "Produce", false],
                    [other, "Other", true],
                ] as const) {
                    await db.settingsStore.insertSection({
                        id: sectionId,
                        householdId: "hh-1",
                        storeId: id,
                        name: sectionName,
                        sortOrder: isOther ? 1 : 0,
                        hidden: false,
                        isOther,
                    });
                }
            }
        }

        async function addLines(call: CallTool) {
            const ids: string[] = [];
            for (const [name, store] of [
                ["Eggs", STORE_A],
                ["Milk", STORE_A],
                ["Flour", STORE_B],
            ] as const) {
                const food = await call("upsert_food", { name });
                const line = await call("add_grocery_line", {
                    store_id: store,
                    kind: "food",
                    food_id: food.structuredContent?.id,
                    amount: 1,
                    unit: "each",
                });
                ids.push(line.structuredContent?.id as string);
            }
            return ids;
        }

        test.each(ERAS)(
            "all nine are listed, with the right hints (%p)",
            async (era) => {
                await withHttpClient("u1", era, async (client) => {
                    const listed = (await client.listTools()).tools;
                    const byName = new Map(listed.map((t) => [t.name, t]));
                    for (const name of HOUSEHOLD_ADMIN_TOOL_NAMES) {
                        expect(byName.has(name), name).toBe(true);
                    }
                    for (const name of [
                        "clear_grocery_list",
                        "move_grocery_lines",
                        "update_grocery_line",
                        "update_store",
                        "delete_store",
                        "reorder_stores",
                        "set_store_sections",
                    ]) {
                        expect(
                            byName.get(name)?.annotations?.destructiveHint,
                            name,
                        ).toBe(true);
                    }
                    expect(
                        byName.get("create_store")?.annotations
                            ?.destructiveHint,
                    ).toBe(false);
                    expect(
                        byName.get("list_stores")?.annotations?.readOnlyHint,
                    ).toBe(true);
                    // The tools each name their output.
                    for (const name of HOUSEHOLD_ADMIN_TOOL_NAMES) {
                        expect(
                            byName.get(name)?.outputSchema,
                            name,
                        ).toBeDefined();
                    }
                });
            },
        );

        test.each(ERAS)(
            "list_stores gives the stores, sections, counts and preferences (%p)",
            async (era) => {
                await withHttpClient("u1", era, async (client) => {
                    const call: CallTool = async (name, args = {}) =>
                        (await client.callTool({
                            name,
                            arguments: callToolArguments(name, args),
                        })) as ToolResult;
                    await addStores();
                    await addLines(call);
                    await db.settingsStore.setGroceryPreferences("hh-1", {
                        defaultStoreId: STORE_B,
                        useUsualStore: true,
                    });
                    const result = await call("list_stores");
                    expect(result.isError).toBeFalsy();
                    const body = LIST_STORES_OUTPUT_SCHEMA.parse(
                        result.structuredContent,
                    );
                    expect(body.default_store_id).toBe(STORE_B);
                    expect(body.use_usual_store).toBe(true);
                    expect(
                        body.stores.map((s) => [
                            s.name,
                            s.position,
                            s.is_default,
                            s.line_count,
                        ]),
                    ).toEqual([
                        ["Costco", 1, false, 2],
                        ["Aldi", 2, true, 1],
                    ]);
                    expect(body.stores[0]!.sections.map((s) => s.name)).toEqual(
                        ["Produce", "Other"],
                    );
                    expect(textOf(result)).toContain(
                        "2 stores. Default store: Aldi.",
                    );
                });
            },
        );

        test.each(ERAS)(
            "clear_grocery_list clears every line, records it and says how to undo (%p)",
            async (era) => {
                await withClientFor(
                    appWith({ kind: "user", userId: "u1" }, "Claude"),
                    era,
                    async (call) => {
                        await addStores();
                        await addLines(call);
                        await mirror();
                        const result = await call("clear_grocery_list");
                        expect(result.isError).toBeFalsy();
                        expect(textOf(result)).toStartWith(
                            "Cleared 3 lines from the grocery list (0 ticked, 3 not).",
                        );
                        expect(textOf(result)).toContain(UNDO_SENTENCE);
                        expect(
                            CLEAR_GROCERY_LIST_OUTPUT_SCHEMA.parse(
                                result.structuredContent,
                            ),
                        ).toEqual({
                            removed: 3,
                            checked: 0,
                            unchecked: 3,
                            store_id: null,
                            store: null,
                        });
                        expect(await db.groceryStore.listLines("hh-1")).toEqual(
                            [],
                        );
                        expect(db.agentActions.__records()).toMatchObject([
                            {
                                tool: "clear_grocery_list",
                                memberId: "u1",
                                connection: "Claude",
                                destructive: true,
                                undoable: true,
                                summary:
                                    "Cleared 3 lines from the grocery list",
                            },
                        ]);
                    },
                );
            },
        );

        test.each(ERAS)(
            "clear_grocery_list for one store leaves the others, and the switch Off refuses it while list_grocery_lines and list_stores still work (%p)",
            async (era) => {
                await withClientFor(
                    appWith({ kind: "user", userId: "u1" }, "Claude"),
                    era,
                    async (call) => {
                        await addStores();
                        await addLines(call);
                        await mirror();
                        const one = await call("clear_grocery_list", {
                            store_id: STORE_A,
                        });
                        expect(textOf(one)).toStartWith(
                            "Cleared 2 lines from Costco (0 ticked, 2 not).",
                        );
                        expect(
                            (await db.groceryStore.listLines("hh-1")).map(
                                (l) => l.displayName,
                            ),
                        ).toEqual(["Flour"]);

                        await db.settingsStore.setAgentDestructiveAllowed(
                            "hh-1",
                            false,
                        );
                        const refused = await call("clear_grocery_list");
                        expect(refused.isError).toBe(true);
                        expect(textOf(refused)).toContain(REFUSAL);
                        expect(textOf(refused)).toContain(
                            "Ask the household owner",
                        );
                        expect(
                            await db.groceryStore.listLines("hh-1"),
                        ).toHaveLength(1);
                        expect(
                            textOf(await call("list_grocery_lines")),
                        ).toContain("Flour");
                        expect((await call("list_stores")).isError).toBeFalsy();
                        const row = db.analyticsRows.find(
                            (r) =>
                                r.tool_name === "clear_grocery_list" &&
                                r.success === false,
                        );
                        expect(row).toMatchObject({
                            error_category: "agent_actions_disabled",
                        });
                    },
                );
            },
        );

        test("a bad id is refused before anything runs, and an id that is no store is an error naming it", async () => {
            await viaHttp(async (call) => {
                await addStores();
                const before = await domainState();
                const bad = await call("clear_grocery_list", {
                    store_id: "costco",
                }).catch((err: Error) => err);
                expect(
                    bad instanceof Error ? bad.message : textOf(bad),
                ).toMatch(/store_id must be an id taken from list_stores/);
                const unknown = await call("clear_grocery_list", {
                    store_id: "33333333-3333-4333-8333-333333333333",
                });
                expect(unknown.isError).toBe(true);
                expect(textOf(unknown)).toContain("Unknown store.");
                expect(await domainState()).toBe(before);
                expect(db.agentActions.__records()).toEqual([]);
            });
        });

        test("move_grocery_lines and update_grocery_line answer with their schemas and record each change", async () => {
            await viaHttp(async (call) => {
                await addStores();
                const [eggs, milk] = await addLines(call);
                await mirror();
                const moved = await call("move_grocery_lines", {
                    line_ids: [eggs, milk],
                    store_id: STORE_B,
                });
                expect(moved.isError).toBeFalsy();
                expect(stripIdTags(textOf(moved))).toStartWith(
                    "Moved 2 lines: Aldi (Other).",
                );
                expect(textOf(moved)).toContain(UNDO_SENTENCE);
                const movedBody = MOVE_GROCERY_LINES_OUTPUT_SCHEMA.parse(
                    moved.structuredContent,
                );
                expect(movedBody.moved).toHaveLength(2);

                const edited = await call("update_grocery_line", {
                    id: eggs,
                    amount: 12,
                    note: "large",
                });
                expect(edited.isError).toBeFalsy();
                expect(textOf(edited)).toContain(UNDO_SENTENCE);
                expect(
                    UPDATE_GROCERY_LINE_OUTPUT_SCHEMA.parse(
                        edited.structuredContent,
                    ).line,
                ).toMatchObject({ id: eggs, amount: 12, note: "large" });
                expect(db.agentActions.__records().map((r) => r.tool)).toEqual([
                    "move_grocery_lines",
                    "update_grocery_line",
                ]);

                const none = await call("update_grocery_line", {
                    id: "44444444-4444-4444-8444-444444444444",
                    amount: 1,
                });
                expect(none.isError).toBeFalsy();
                expect(textOf(none)).not.toContain(UNDO_SENTENCE);
                expect(db.agentActions.__records()).toHaveLength(2);
            });
        });

        test.each(ERAS)(
            "create_store works with the switch Off and records nothing (%p)",
            async (era) => {
                await withHttpClient("u1", era, async (client) => {
                    await db.settingsStore.setAgentDestructiveAllowed(
                        "hh-1",
                        false,
                    );
                    const made = (await client.callTool({
                        name: "create_store",
                        arguments: { name: "Lidl", sections: ["Deli"] },
                    })) as ToolResult;
                    expect(made.isError).toBeFalsy();
                    expect(textOf(made)).toContain("Added store Lidl");
                    expect(db.agentActions.__records()).toEqual([]);
                    expect(
                        (await db.settingsStore.listStores("hh-1")).map(
                            (s) => s.name,
                        ),
                    ).toEqual(["Lidl"]);
                });
            },
        );
    });

    // The four kitchen admin tools go through the same guard.
    // The SQL (the fridge ledger, the snapshot of every affected table, undo)
    // is tested against Postgres in src/mcp/tools/kitchen-admin.db.test.ts; the
    // memory stores here cover the tool list, the schemas and both eras.
    describe("kitchen admin tools", () => {
        beforeEach(() => setFlagsForTests(createMemoryFlags({})));

        const asOwner = (
            era: EraMode,
            run: (call: CallTool) => Promise<void>,
        ) => withClientFor(appWith({ kind: "user", userId: "u1" }), era, run);

        async function fridgeWith(call: CallTool, names: string[]) {
            const loc = await call("add_fridge_location", { name: "Fridge" });
            const locationId = loc.structuredContent?.id as string;
            const ids: string[] = [];
            for (const name of names) {
                const food = await call("upsert_food", { name });
                const item = await call("add_fridge_item", {
                    location_id: locationId,
                    kind: "food",
                    food_id: food.structuredContent?.id,
                    amount: 100,
                    unit: "g",
                });
                ids.push(item.structuredContent?.id as string);
            }
            return { locationId, ids };
        }

        test.each(ERAS)(
            "all four are listed, destructive, with an output schema (%p)",
            async (era) => {
                await withHttpClient("u1", era, async (client) => {
                    const byName = new Map(
                        (await client.listTools()).tools.map((t) => [
                            t.name,
                            t,
                        ]),
                    );
                    for (const name of KITCHEN_ADMIN_TOOL_NAMES) {
                        const tool = byName.get(name);
                        expect(tool, name).toBeDefined();
                        expect(tool?.annotations?.destructiveHint, name).toBe(
                            true,
                        );
                        expect(tool?.annotations?.readOnlyHint, name).toBe(
                            false,
                        );
                        expect(tool?.outputSchema, name).toBeDefined();
                    }
                });
            },
        );

        test.each(ERAS)(
            "move_fridge_items moves the items, records the change and keeps the ledger (%p)",
            async (era) => {
                await asOwner(era, async (call) => {
                    const { ids } = await fridgeWith(call, ["Eggs", "Milk"]);
                    const freezer = await call("add_fridge_location", {
                        name: "Freezer",
                    });
                    const target = freezer.structuredContent?.id as string;
                    await mirror();
                    const moved = await call("move_fridge_items", {
                        ids,
                        location_id: target,
                    });
                    expect(moved.isError).toBeFalsy();
                    expect(textOf(moved)).toStartWith(
                        "Moved 2 fridge items to Freezer: Eggs, Milk.",
                    );
                    expect(textOf(moved)).toContain(UNDO_SENTENCE);
                    const body = MOVE_FRIDGE_ITEMS_OUTPUT_SCHEMA.parse(
                        moved.structuredContent,
                    );
                    expect(body.moved.map((row) => row.id)).toEqual(ids);
                    expect(body.moved[0]!.from_location).toBe("Fridge");
                    expect(
                        (await db.fridgeStore.listItems("hh-1")).map(
                            (item) => item.locationId,
                        ),
                    ).toEqual([target, target]);
                    expect(db.agentActions.__records()).toMatchObject([
                        {
                            tool: "move_fridge_items",
                            summary: "Moved 2 fridge items to Freezer",
                        },
                    ]);

                    // Already there: nothing moves, nothing is recorded.
                    const again = await call("move_fridge_items", {
                        ids,
                        location_id: target,
                    });
                    expect(again.isError).toBeFalsy();
                    expect(textOf(again)).toContain("Nothing moved");
                    expect(textOf(again)).not.toContain(UNDO_SENTENCE);
                    expect(db.agentActions.__records()).toHaveLength(1);
                });
            },
        );

        test("move_fridge_items and delete_fridge_items refuse an id that is no item or a location that is none, changing nothing", async () => {
            await viaHttp(async (call) => {
                const { ids, locationId } = await fridgeWith(call, ["Eggs"]);
                await mirror();
                const before = await domainState();
                const stranger = crypto.randomUUID();
                const badItem = await call("move_fridge_items", {
                    ids: [ids[0], stranger],
                    location_id: locationId,
                });
                expect(badItem.isError).toBe(true);
                expect(textOf(badItem)).toContain(
                    `No fridge item found with id ${stranger}`,
                );
                const badPlace = await call("move_fridge_items", {
                    ids,
                    location_id: stranger,
                });
                expect(badPlace.isError).toBe(true);
                expect(textOf(badPlace)).toContain("No fridge location found");
                const badDelete = await call("delete_fridge_items", {
                    ids: [ids[0], stranger],
                });
                expect(badDelete.isError).toBe(true);
                expect(textOf(badDelete)).toContain("Nothing was changed");
                const notUuid = await call("delete_fridge_items", {
                    ids: ["eggs"],
                }).catch((err: Error) => err);
                expect(
                    notUuid instanceof Error
                        ? notUuid.message
                        : textOf(notUuid),
                ).toMatch(/each id must be a fridge item id from get_fridge/);
                expect(await domainState()).toBe(before);
                expect(db.agentActions.__records()).toEqual([]);
            });
        });

        test.each(ERAS)(
            "delete_fridge_items removes every item through the ledger and records one action (%p)",
            async (era) => {
                await asOwner(era, async (call) => {
                    const { ids } = await fridgeWith(call, [
                        "Eggs",
                        "Milk",
                        "Flour",
                    ]);
                    await mirror();
                    const deleted = await call("delete_fridge_items", {
                        ids: [ids[0], ids[1]],
                    });
                    expect(deleted.isError).toBeFalsy();
                    expect(textOf(deleted)).toStartWith(
                        "Deleted 2 fridge items: Eggs (100 g), Milk (100 g).",
                    );
                    expect(textOf(deleted)).toContain(UNDO_SENTENCE);
                    expect(
                        DELETE_FRIDGE_ITEMS_OUTPUT_SCHEMA.parse(
                            deleted.structuredContent,
                        ).deleted.map((row) => row.id),
                    ).toEqual([ids[0]!, ids[1]!]);
                    expect(
                        (await db.fridgeStore.listItems("hh-1")).map(
                            (item) => item.id,
                        ),
                    ).toEqual([ids[2]!]);
                    for (const food of await db.foodsStore.listFoods("hh-1")) {
                        expect(
                            ledgerMatchesStock(
                                (await db.fridgeStore.listItems("hh-1")).filter(
                                    (item) => item.foodId === food.id,
                                ),
                                await db.stockStore.listMovements(
                                    "hh-1",
                                    food.id,
                                ),
                                food,
                            ),
                        ).toBe(true);
                    }
                    expect(db.agentActions.__records()).toMatchObject([
                        { tool: "delete_fridge_items" },
                    ]);
                });
            },
        );

        test.each(ERAS)(
            "delete_grocery_lines removes the lines, records one action and refuses a stranger (%p)",
            async (era) => {
                await asOwner(era, async (call) => {
                    await addStore();
                    const ids: string[] = [];
                    for (const name of ["Eggs", "Milk", "Flour"]) {
                        const food = await call("upsert_food", { name });
                        const line = await call("add_grocery_line", {
                            store_id: "store-1",
                            kind: "food",
                            food_id: food.structuredContent?.id,
                            amount: 1,
                            unit: "each",
                        });
                        ids.push(line.structuredContent?.id as string);
                    }
                    await mirror();
                    const stranger = crypto.randomUUID();
                    const refused = await call("delete_grocery_lines", {
                        ids: [ids[0], stranger],
                    });
                    expect(refused.isError).toBe(true);
                    expect(textOf(refused)).toContain(
                        `No grocery line found with id ${stranger}`,
                    );
                    expect(
                        await db.groceryStore.listLines("hh-1"),
                    ).toHaveLength(3);
                    expect(db.agentActions.__records()).toEqual([]);

                    const deleted = await call("delete_grocery_lines", {
                        ids: [ids[0], ids[1]],
                    });
                    expect(deleted.isError).toBeFalsy();
                    expect(textOf(deleted)).toStartWith(
                        "Deleted 2 grocery lines: Eggs, Milk.",
                    );
                    expect(textOf(deleted)).toContain(UNDO_SENTENCE);
                    expect(
                        DELETE_GROCERY_LINES_OUTPUT_SCHEMA.parse(
                            deleted.structuredContent,
                        ).deleted,
                    ).toHaveLength(2);
                    expect(
                        (await db.groceryStore.listLines("hh-1")).map(
                            (line) => line.id,
                        ),
                    ).toEqual([ids[2]!]);
                    expect(db.agentActions.__records()).toMatchObject([
                        { tool: "delete_grocery_lines" },
                    ]);
                });
            },
        );

        test.each(ERAS)(
            "remove_usual takes the products off the food and records it, and a food that is no usual records nothing (%p)",
            async (era) => {
                await asOwner(era, async (call) => {
                    const eggs = await call("upsert_food", { name: "Eggs" });
                    const brand = await call("upsert_food", {
                        name: "Kirkland Large Eggs",
                    });
                    const plain = eggs.structuredContent?.id as string;
                    const product = brand.structuredContent?.id as string;
                    const set = await call("set_usual_product", {
                        food_id: plain,
                        product_food_id: product,
                    });
                    expect(set.isError).toBeFalsy();
                    await mirror();

                    const removed = await call("remove_usual", {
                        food_id: plain,
                    });
                    expect(removed.isError).toBeFalsy();
                    expect(stripIdTags(textOf(removed))).toContain(
                        "Removed Eggs from the Usuals list; Kirkland Large Eggs came off its list.",
                    );
                    expect(textOf(removed)).toContain(UNDO_SENTENCE);
                    expect(
                        REMOVE_USUAL_OUTPUT_SCHEMA.parse(
                            removed.structuredContent,
                        ),
                    ).toMatchObject({
                        food_id: plain,
                        changed: true,
                        products_removed: [{ id: product }],
                    });
                    const after = await db.foodsStore.listFoods("hh-1");
                    expect(
                        after.find((f) => f.id === plain)?.usualProductId,
                    ).toBeNull();
                    expect(
                        after.find((f) => f.id === product)?.genericFoodId,
                    ).toBeNull();
                    expect(db.agentActions.__records()).toMatchObject([
                        { tool: "remove_usual" },
                    ]);

                    // Nothing left to remove: no entry, no undo sentence.
                    const again = await call("remove_usual", {
                        food_id: plain,
                    });
                    expect(again.isError).toBeFalsy();
                    expect(textOf(again)).toContain(
                        "is not on the Usuals list",
                    );
                    expect(textOf(again)).not.toContain(UNDO_SENTENCE);
                    expect(db.agentActions.__records()).toHaveLength(1);

                    // A product is not a usual, and a stranger is no food.
                    const viaProduct = await call("remove_usual", {
                        food_id: product,
                    });
                    expect(viaProduct.isError).toBeFalsy();
                    const stranger = await call("remove_usual", {
                        food_id: crypto.randomUUID(),
                    });
                    expect(stranger.isError).toBe(true);
                    expect(textOf(stranger)).toContain("No food found");
                });
            },
        );
    });
});

describe("/mcp event notifications", () => {
    const ACTOR = "u1";
    const OTHER = "u2";

    function addUtcDays(iso: string, delta: number): string {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d! + delta))
            .toISOString()
            .slice(0, 10);
    }

    // A second member, with every event kind on for them (and for the actor,
    // to show the actor still gets none). Plan tools are flag-gated.
    beforeEach(async () => {
        setFlagsForTests(createMemoryFlags({}));
        db.members.push({
            householdId: "hh-1",
            userId: OTHER,
            role: "member",
            displayName: "U2",
        });
        for (const userId of [ACTOR, OTHER]) {
            for (const kind of [
                "recipe_changes",
                "week_plan_changes",
                "new_usuals",
            ] as NotificationKind[]) {
                await db.notificationsStore.upsertPref({
                    householdId: "hh-1",
                    userId,
                    kind,
                    enabled: true,
                    updatedAt: "2026-11-22T10:00:00.000Z",
                });
            }
        }
    });
    afterEach(() => resetFlagsForTests());

    async function connect<T>(
        app: Hono,
        mode: EraMode,
        run: (call: CallTool) => Promise<T>,
    ): Promise<T> {
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
            return await run(
                (name, args = {}) =>
                    client.callTool({
                        name,
                        arguments: callToolArguments(name, args),
                    }) as Promise<ToolResult>,
            );
        } finally {
            await client.close();
        }
    }

    const asUser = <T>(
        userId: string,
        mode: EraMode,
        run: (call: CallTool) => Promise<T>,
    ) => connect(appFor(userId), mode, run);

    const events = async () =>
        (await db.notificationsStore.listForHousehold("hh-1")).filter(
            (row) => row.source === "event",
        );

    async function plannedBread(call: CallTool) {
        const recipe = await call("create_recipe", {
            name: "Bread",
            yield_portions: 1,
        });
        const recipeId = recipe.structuredContent?.id as string;
        const planned = await call("plan_recipe", {
            recipe_id: recipeId,
            date: addUtcDays(utcTodayFromDate(), 2),
            slot: "dinner",
        });
        expect(planned.isError).toBeFalsy();
        const planId = (
            planned.structuredContent as { plan: { plan_id: string } }
        ).plan.plan_id;
        return { recipeId, planId };
    }

    test.each(ERAS)(
        "plan_recipe tells the other members, once, and never the person it acts for (%p)",
        async (era) => {
            await asUser(ACTOR, era, async (call) => {
                const recipe = await call("create_recipe", {
                    name: "Bread",
                    yield_portions: 1,
                });
                const recipeId = recipe.structuredContent?.id as string;
                const args = {
                    recipe_id: recipeId,
                    date: addUtcDays(utcTodayFromDate(), 2),
                    slot: "dinner",
                };
                expect((await call("plan_recipe", args)).isError).toBeFalsy();
                // The same plan again is not a change.
                expect((await call("plan_recipe", args)).isError).toBeFalsy();
                const rows = await events();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: OTHER,
                    actorUserId: ACTOR,
                    kind: "week_plan_changes",
                    subjectId: recipeId,
                    payload: {
                        recipeName: "Bread",
                        date: args.date,
                        slot: "dinner",
                        change: "planned",
                    },
                });
            });
        },
    );

    test.each(ERAS)(
        "unplan_recipe tells the others through unplanRecipe, after the guarded transaction commits (%p)",
        async (era) => {
            const real = db.agentActions;
            let committed = false;
            setAgentActionDepsForTests({
                store: {
                    ...real,
                    atomically: async (fn) => {
                        committed = false;
                        const out = await real.atomically(fn);
                        committed = true;
                        return out;
                    },
                },
                settings: db.settingsStore,
                stock: db.stockStore,
                foods: db.foodsStore,
                recipes: db.recipesStore,
            });
            const sentAfterCommit: boolean[] = [];
            setNotifyDepsForTests({
                store: {
                    ...db.notificationsStore,
                    insertMany: async (rows) => {
                        sentAfterCommit.push(committed);
                        return db.notificationsStore.insertMany(rows);
                    },
                },
                listMembers: async () =>
                    db.members.map((m) => ({
                        userId: m.userId,
                        role: m.role,
                    })),
                log: () => {},
            });
            await asUser(ACTOR, era, async (call) => {
                const { planId } = await plannedBread(call);
                const planRows = (await events()).length;
                sentAfterCommit.length = 0;
                const removed = await call("unplan_recipe", {
                    plan_id: planId,
                });
                expect(removed.isError).toBeFalsy();
                const rows = (await events()).slice(planRows);
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: OTHER,
                    actorUserId: ACTOR,
                    kind: "week_plan_changes",
                    payload: { recipeName: "Bread", change: "unplanned" },
                });
                expect(sentAfterCommit).toEqual([true]);
                expect(await db.plansStore.getPlan("hh-1", planId)).toBeNull();
            });
        },
    );

    test.each(ERAS)(
        "a guarded call that is refused, throws or changes nothing sends nothing (%p)",
        async (era) => {
            await asUser(ACTOR, era, async (call) => {
                const { planId } = await plannedBread(call);
                const before = (await events()).length;

                // Refused: the person's own switch is Off.
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    ACTOR,
                    false,
                );
                const refused = await call("unplan_recipe", {
                    plan_id: planId,
                });
                expect(refused.isError).toBe(true);
                expect(
                    await db.plansStore.getPlan("hh-1", planId),
                ).not.toBeNull();
                await db.settingsStore.setMemberAgentsCanDelete(
                    "hh-1",
                    ACTOR,
                    true,
                );

                // The transaction fails after the write has been queued: the
                // action's own record cannot be written, so it rolls back.
                const real = db.agentActions;
                setAgentActionDepsForTests({
                    store: {
                        ...real,
                        atomically: (fn) =>
                            real.atomically((tx) =>
                                fn({
                                    ...tx,
                                    insertAction: async () => {
                                        throw new Error("record refused");
                                    },
                                }),
                            ),
                    },
                    settings: db.settingsStore,
                    stock: db.stockStore,
                    foods: db.foodsStore,
                    recipes: db.recipesStore,
                });
                const failed = await call("unplan_recipe", { plan_id: planId });
                expect(failed.isError).toBe(true);

                // A plan that is not there: nothing changed.
                const gone = await call("unplan_recipe", {
                    plan_id: crypto.randomUUID(),
                });
                expect(gone.isError).toBe(true);

                expect((await events()).length).toBe(before);
            });
        },
    );

    test.each(ERAS)(
        "delete_recipe tells the others once, and a refused or empty delete sends nothing (%p)",
        async (era) => {
            let recipeId = "";
            await asUser(ACTOR, era, async (call) => {
                const recipe = await call("create_recipe", {
                    name: "Beef chili",
                    yield_portions: 4,
                });
                recipeId = recipe.structuredContent?.id as string;
            });
            // A member who did not write it may not delete it, and nothing is sent.
            await db.settingsStore.setMemberAgentsCanDelete(
                "hh-1",
                OTHER,
                true,
            );
            await asUser(OTHER, era, async (call) => {
                const refused = await call("delete_recipe", { id: recipeId });
                expect(refused.isError).toBe(true);
            });
            expect(await events()).toEqual([]);
            await asUser(ACTOR, era, async (call) => {
                const none = await call("delete_recipe", {
                    id: crypto.randomUUID(),
                });
                expect(none.isError).toBeFalsy();
                expect(await events()).toEqual([]);
                const deleted = await call("delete_recipe", { id: recipeId });
                expect(deleted.isError).toBeFalsy();
                const rows = await events();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: OTHER,
                    actorUserId: ACTOR,
                    kind: "recipe_changes",
                    subjectId: recipeId,
                    payload: { recipeName: "Beef chili" },
                });
            });
        },
    );

    test.each(ERAS)(
        "the household token acts as its owner, so the owner gets nothing and the others do (%p)",
        async (era) => {
            await connect(appForHousehold("hh-1"), era, async (call) => {
                const recipe = await call("create_recipe", {
                    name: "Beef chili",
                    yield_portions: 4,
                    user_id: ACTOR,
                });
                const recipeId = recipe.structuredContent?.id as string;
                expect(recipeId).toBeTruthy();
                const deleted = await call("delete_recipe", {
                    id: recipeId,
                });
                expect(deleted.isError).toBeFalsy();
            });
            const rows = await events();
            expect(rows.map((r) => r.recipientUserId)).toEqual([OTHER]);
            expect(rows[0]?.actorUserId).toBe(ACTOR);
        },
    );

    test.each(ERAS)(
        "set_usual_product tells the others when a product becomes the usual, not when it already was (%p)",
        async (era) => {
            await asUser(ACTOR, era, async (call) => {
                const milk = await call("upsert_food", { name: "Milk" });
                const milkId = milk.structuredContent?.id as string;
                const horizon = await call("upsert_food", {
                    name: "Horizon Milk",
                    brand: "Horizon",
                    generic_food_id: milkId,
                });
                const horizonId = horizon.structuredContent?.id as string;
                // Creating the product filed Milk under the Usuals: its own
                // event, which this test is not about.
                const filed = (await events()).length;
                const set = await call("set_usual_product", {
                    food_id: milkId,
                    product_food_id: horizonId,
                });
                expect(set.isError).toBeFalsy();
                await call("set_usual_product", {
                    food_id: milkId,
                    product_food_id: horizonId,
                });
                await call("set_usual_product", {
                    food_id: milkId,
                    product_food_id: null,
                });
                const rows = (await events()).slice(filed);
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: OTHER,
                    actorUserId: ACTOR,
                    kind: "new_usuals",
                    subjectId: milkId,
                    payload: {
                        foodName: "Milk",
                        productName: "Horizon Milk",
                    },
                });
            });
        },
    );

    test.each(ERAS)(
        "link_product tells the others when it files a product under a food that was not a usual, not when it already was (%p)",
        async (era) => {
            await asUser(ACTOR, era, async (call) => {
                const food = async (args: Record<string, unknown>) =>
                    (await call("upsert_food", { new_food: true, ...args }))
                        .structuredContent?.id as string;
                const milk = await food({ name: "Milk" });
                const horizon = await food({
                    name: "Horizon Milk",
                    brand: "Horizon",
                });
                const organic = await food({
                    name: "Organic Valley Milk",
                    brand: "Organic Valley",
                });
                expect(await events()).toEqual([]);
                const linked = await call("link_product", {
                    product_food_id: horizon,
                    food_id: milk,
                });
                expect(linked.isError).toBeFalsy();
                // Milk is a usual now: a second product, the same one again
                // and unfiling it are not new.
                await call("link_product", {
                    product_food_id: organic,
                    food_id: milk,
                });
                await call("link_product", {
                    product_food_id: horizon,
                    food_id: milk,
                });
                await call("link_product", {
                    product_food_id: organic,
                    food_id: null,
                });
                const rows = await events();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: OTHER,
                    actorUserId: ACTOR,
                    kind: "new_usuals",
                    subjectKind: "food",
                    subjectId: milk,
                    payload: {
                        foodName: "Milk",
                        productName: "Horizon Milk",
                    },
                });
            });
        },
    );

    test.each(ERAS)(
        "upsert_food with generic_food_id tells the others for the first product under a food, not for the next (%p)",
        async (era) => {
            await asUser(ACTOR, era, async (call) => {
                const milk = (await call("upsert_food", { name: "Milk" }))
                    .structuredContent?.id as string;
                expect(await events()).toEqual([]);
                const product = (name: string, brand: string) =>
                    call("upsert_food", {
                        name,
                        brand,
                        generic_food_id: milk,
                    });
                expect(
                    (await product("Horizon Milk", "Horizon")).isError,
                ).toBeFalsy();
                await product("Organic Valley Milk", "Organic Valley");
                // A refused one (no name) sends nothing.
                expect((await product("", "Nobody")).isError).toBe(true);
                const rows = await events();
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({
                    recipientUserId: OTHER,
                    actorUserId: ACTOR,
                    kind: "new_usuals",
                    subjectId: milk,
                    payload: {
                        foodName: "Milk",
                        productName: "Horizon Milk",
                    },
                });
            });
        },
    );

    test.each(ERAS)(
        "set_usual_product on a product not filed under the food yet files it and tells once, not twice (%p)",
        async (era) => {
            await asUser(ACTOR, era, async (call) => {
                const food = async (args: Record<string, unknown>) =>
                    (await call("upsert_food", { new_food: true, ...args }))
                        .structuredContent?.id as string;
                const milk = await food({ name: "Milk" });
                const horizon = await food({
                    name: "Horizon Milk",
                    brand: "Horizon",
                });
                const set = await call("set_usual_product", {
                    food_id: milk,
                    product_food_id: horizon,
                });
                expect(set.isError).toBeFalsy();
                const rows = await events();
                expect(rows).toHaveLength(1);
                expect(rows[0]?.payload).toEqual({
                    foodName: "Milk",
                    productName: "Horizon Milk",
                });
            });
        },
    );

    // A JSON-RPC batch is one POST with several calls: the legacy era builds one
    // server, so one tool context, for all of them, and they run side by side.
    // Each guarded call must queue and send its own events and nobody else's.
    test("a call in a real JSON-RPC batch sends its own events, not its neighbours'", async () => {
        const ids: Record<string, string> = {};
        await asUser(ACTOR, "legacy", async (call) => {
            for (const name of ["Stew", "Soup"]) {
                ids[name] = (
                    await call("create_recipe", { name, yield_portions: 1 })
                ).structuredContent?.id as string;
            }
        });
        // The Stew call writes (so its event is queued) and then cannot save
        // its record, so its transaction rolls back and nothing may be sent.
        // The Soup call waits for that, so it flushes after Stew has queued:
        // with one list shared by both, Soup's flush would send Stew's event.
        const stewQueued = Promise.withResolvers<void>();
        const real = db.agentActions;
        setAgentActionDepsForTests({
            store: {
                ...real,
                atomically: (fn) =>
                    real.atomically((tx) =>
                        fn({
                            ...tx,
                            insertAction: async (record) => {
                                if (record.summary.includes("Stew")) {
                                    stewQueued.resolve();
                                    throw new Error("record refused");
                                }
                                await stewQueued.promise;
                                return tx.insertAction(record);
                            },
                        }),
                    ),
            },
            settings: db.settingsStore,
            stock: db.stockStore,
            foods: db.foodsStore,
            recipes: db.recipesStore,
        });
        const batch = ["Stew", "Soup"].map((name, index) => ({
            jsonrpc: "2.0",
            id: index + 1,
            method: "tools/call",
            params: {
                name: "delete_recipe",
                arguments: callToolArguments("delete_recipe", {
                    id: ids[name],
                }),
            },
        }));
        const res = await appFor(ACTOR).request("http://test.local/mcp", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
            },
            body: JSON.stringify(batch),
        });
        expect(res.status).toBe(200);
        const frames = (await res.text())
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map(
                (line) =>
                    JSON.parse(line.slice(5)) as {
                        id: number;
                        result: { isError?: boolean };
                    },
            );
        // Both calls answered, in one response: this was one batch.
        expect(frames.map((f) => f.id).sort()).toEqual([1, 2]);
        const byId = new Map(frames.map((f) => [f.id, f.result]));
        expect(byId.get(1)?.isError).toBe(true);
        expect(byId.get(2)?.isError).toBeFalsy();
        // Stew's guard failed after it queued, Soup's committed: only Soup's
        // event was sent. (The memory recipe store does not roll back, so the
        // Stew row itself is not asserted here; the Postgres guard tests do.)
        expect((await events()).map((r) => r.payload.recipeName)).toEqual([
            "Soup",
        ]);
    });
});

describe("/mcp writes land only on the person the agent acts for", () => {
    const REFUSAL =
        "An agent can only add, change or delete the entries of the person it acts for. Nothing was changed. Ask U2 to do it, or their agent.";

    beforeEach(() => {
        db.members.push({
            householdId: "hh-1",
            userId: "u2",
            role: "member",
            displayName: "U2",
        });
    });

    test.each(ERAS)(
        "a write that names another member is refused and writes nothing; the caller's own goes through (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const write = async (
                    name: string,
                    args: Record<string, unknown>,
                ) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                for (const [name, args] of [
                    [
                        "log_meal",
                        {
                            description: "toast",
                            meal_type: "breakfast",
                            calories: 100,
                            target_member: "u2",
                        },
                    ],
                    ["log_water", { amount_ml: 250, target_member: "u2" }],
                    [
                        "log_weight",
                        { weight: 70, unit: "kg", target_member: "u2" },
                    ],
                    [
                        "set_nutrition_goals",
                        { daily_calories: 1800, target_member: "u2" },
                    ],
                    ["delete_water", { id: "any", target_member: "u2" }],
                ] as const) {
                    const refused = await write(name, args);
                    expect(refused.isError).toBe(true);
                    expect(textOf(refused)).toContain(REFUSAL);
                }
                expect(db.inserted).toHaveLength(0);
                expect(db.waterInserted).toHaveLength(0);
                expect(db.weightInserted).toHaveLength(0);
                expect(db.goals).toBeNull();

                for (const aim of [{}, { target_member: "u1" }]) {
                    const own = await write("log_water", {
                        amount_ml: 250,
                        ...aim,
                    });
                    expect(own.isError).toBeFalsy();
                }
                expect(db.waterInserted).toHaveLength(2);
                // Reading the other member's day is not a write.
                const read = await write("get_water", { user_id: "u2" });
                expect(read.isError).toBeFalsy();
            });
        },
    );

    test.each(ERAS)(
        "the household token writes only the owner's entries (%p)",
        async (era) => {
            const app = new Hono();
            app.all("/mcp", (c) => {
                c.set("authContext", {
                    kind: "household",
                    householdId: "hh-1",
                });
                return handleMcp(c);
            });
            const transport = new StreamableHTTPClientTransport(
                new URL("http://test.local/mcp"),
                {
                    fetch: async (url, init) =>
                        app.request(new Request(String(url), init)),
                },
            );
            const client = new Client(
                { name: "t", version: "0" },
                { versionNegotiation: { mode: era } },
            );
            await client.connect(transport);
            try {
                const call = async (
                    name: string,
                    args: Record<string, unknown>,
                ) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const refused = await call("log_water", {
                    amount_ml: 250,
                    user_id: "u2",
                });
                expect(refused.isError).toBe(true);
                expect(textOf(refused)).toContain(REFUSAL);
                expect(textOf(refused)).toContain(
                    "On the household's shared connection that person is the household owner.",
                );
                expect(db.waterInserted).toHaveLength(0);
                const own = await call("log_water", {
                    amount_ml: 250,
                    user_id: "u1",
                });
                expect(own.isError).toBeFalsy();
                expect(db.waterInserted).toHaveLength(1);
            } finally {
                await client.close();
            }
        },
    );
});

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

describe("the notification tools over HTTP", () => {
    // A notification's undo is all or nothing, so the result says when it is
    // refused: once someone has changed their own copy.
    const UNDO_SENTENCE =
        "The household can undo this for 24 hours in Settings › AI connections, unless someone has changed their copy since.";

    function addUtcDays(iso: string, delta: number): string {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d! + delta))
            .toISOString()
            .slice(0, 10);
    }

    // A usual with nothing in stock, a fridge item that expires in three
    // days, and a member whose last weigh-in was nine days ago.
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
        const loc = await call("add_fridge_location", { name: "Fridge" });
        const added = await call("add_fridge_item", {
            location_id: loc.structuredContent?.id,
            kind: "food",
            name: "Soon kefir",
            amount: 1,
            unit: "g",
        });
        const row = (await db.fridgeStore.listItems("hh-1")).find(
            (r) => r.id === added.structuredContent?.id,
        );
        await db.fridgeStore.updateItem({
            ...row!,
            expiresOn: addUtcDays(today, 3),
        });
        db.weighInRows.push({
            userId: "u1",
            displayName: "U1",
            lastLoggedAt: `${addUtcDays(today, -9)}T12:00:00Z`,
        });
    }

    const KINDS: string[] = ["food_expiring", "running_low", "weigh_in_due"];

    async function inbox(call: CallTool, args: Record<string, unknown> = {}) {
        const out = await call("list_notices", args);
        expect(out.isError).toBeFalsy();
        return {
            text: textOf(out),
            ...LIST_NOTICES_OUTPUT_SCHEMA.parse(out.structuredContent),
        };
    }

    const callOf =
        (client: Client): CallTool =>
        async (name, args = {}) =>
            (await client.callTool({ name, arguments: args })) as ToolResult;

    test.each(ERAS)(
        "a row back from its snooze is unread in list_notices, as on the bell, and mark_notices_read clears it (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await seed(call);
                await call("mark_notices_read", { notification_ids: "all" });
                expect((await inbox(call)).count).toBe(0);
                // Read an hour ago, snoozed, and the snooze ended a minute ago.
                const [row] = await db.notificationsStore.listForRecipient(
                    "hh-1",
                    "u1",
                );
                const now = Date.now();
                await db.notificationsStore.update("hh-1", [row!.id], {
                    readAt: new Date(now - 3_600_000).toISOString(),
                    snoozedUntil: new Date(now - 60_000).toISOString(),
                    snoozedBy: "u1",
                });
                const back = await inbox(call);
                expect(back.count).toBe(1);
                expect(
                    back.notifications.find((n) => n.id === row!.id)!.read,
                ).toBe(false);
                expect(back.text).toContain("1 unread");

                const byId = await call("mark_notices_read", {
                    notification_ids: [row!.id],
                });
                expect(
                    MARK_NOTICES_READ_OUTPUT_SCHEMA.parse(
                        byId.structuredContent,
                    ),
                ).toEqual({ marked_read: 1 });
                expect((await inbox(call)).count).toBe(0);

                // And "all" clears it the same way.
                await db.notificationsStore.update("hh-1", [row!.id], {
                    readAt: new Date(now - 3_600_000).toISOString(),
                });
                expect((await inbox(call)).count).toBe(1);
                const all = await call("mark_notices_read", {
                    notification_ids: "all",
                });
                expect(all.structuredContent).toEqual({ marked_read: 1 });
                expect((await inbox(call)).count).toBe(0);
            });
        },
    );

    test.each(ERAS)(
        "list_notices is the inbox: the three kinds, with their sentences and ids (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await seed(call);
                const sc = await inbox(call);
                expect(
                    sc.notifications.map((n) => n.kind as string).sort(),
                ).toEqual([...KINDS].sort());
                expect(sc.count).toBe(3);
                const byKind = Object.fromEntries(
                    sc.notifications.map((n) => [n.kind, n]),
                );
                expect(byKind.running_low).toMatchObject({
                    message: "Running low: Eggs (0 left, below 3)",
                    bucket: "household",
                    // The same page the inbox's row opens.
                    open: "/kitchen/groceries",
                });
                expect(byKind.weigh_in_due).toMatchObject({
                    message: "U1 hasn't weighed in for 9 days",
                    bucket: "personal",
                    open: "/",
                    subject: { kind: "member", id: "u1" },
                });
                expect(byKind.food_expiring!.message).toContain("Soon kefir");
                // The text names every id the structured result has.
                const lines = sc.text.split("\n").slice(1);
                expect(lines).toHaveLength(3);
                for (const n of sc.notifications) {
                    const line = lines.find((l) =>
                        l.includes(`[notification_id: ${n.id}]`),
                    );
                    expect(line, n.kind).toBeTruthy();
                    expect(line).toContain(n.subject!.id);
                }
            });
        },
    );

    test.each(ERAS)(
        "a notification can be dismissed from the list_notices text alone (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await seed(call);
                const ids = [
                    ...(await inbox(call)).text.matchAll(
                        /\[notification_id: ([^\]]+)\]/g,
                    ),
                ].map((m) => m[1]!);
                expect(ids).toHaveLength(3);
                for (const id of ids) {
                    const out = await call("dismiss_notice", {
                        notification_id: id,
                    });
                    expect(out.isError, textOf(out)).toBeFalsy();
                }
                const after = await inbox(call);
                expect(after.notifications).toEqual([]);
                expect(after.text).toBe("Nothing needs attention.");
            });
        },
    );

    test.each(ERAS)(
        "plan gaps and restocked lines stay out of the inbox (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                const today = utcTodayFromDate();
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
                // The gap is on the plan and the recipe, not in the inbox.
                expect((await inbox(call)).notifications).toEqual([]);
                const week = await call("get_week_plan");
                expect(week.isError).toBeFalsy();
                expect(textOf(week)).toContain("Flour");
            });
        },
    );

    test.each(ERAS)(
        "snooze, mark read and the settings tools answer in their schemas (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await seed(call);
                const sc = await inbox(call);
                const [first, second] = sc.notifications;

                const snoozed = await call("snooze_notice", {
                    notification_id: first!.id,
                    until: "tomorrow",
                });
                expect(snoozed.isError).toBeFalsy();
                const snoozeOut = SNOOZE_NOTICE_OUTPUT_SCHEMA.parse(
                    snoozed.structuredContent,
                );
                expect(snoozeOut.snoozed).toBe(true);
                expect(Date.parse(snoozeOut.snoozed_until!)).toBeGreaterThan(
                    Date.now(),
                );
                expect((await inbox(call)).count).toBe(2);
                const withSnoozed = await inbox(call, {
                    include_snoozed: true,
                });
                expect(withSnoozed.notifications).toHaveLength(3);
                expect(
                    withSnoozed.notifications.find((n) => n.id === first!.id)!
                        .snoozed_until,
                ).toBe(snoozeOut.snoozed_until);

                const read = await call("mark_notices_read", {
                    notification_ids: [second!.id],
                });
                expect(
                    MARK_NOTICES_READ_OUTPUT_SCHEMA.parse(
                        read.structuredContent,
                    ),
                ).toEqual({ marked_read: 1 });
                const readAll = await call("mark_notices_read", {
                    notification_ids: "all",
                });
                expect(readAll.isError).toBeFalsy();
                expect((await inbox(call)).count).toBe(0);

                const settings = GET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA.parse(
                    (await call("get_notification_settings")).structuredContent,
                );
                expect(settings.settings).toHaveLength(7);
                const set = await call("set_notification_settings", {
                    kind: "week_plan_changes",
                    enabled: true,
                });
                expect(
                    SET_NOTIFICATION_SETTINGS_OUTPUT_SCHEMA.parse(
                        set.structuredContent,
                    ),
                ).toMatchObject({ kind: "week_plan_changes", enabled: true });
                const allergens = await call("set_notification_settings", {
                    kind: "allergens",
                    enabled: false,
                });
                expect(allergens.isError).toBe(true);
            });
        },
    );

    test.each(ERAS)(
        "dismiss for everyone as the owner is recorded and says how to undo it (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await seed(call);
                const row = (await inbox(call)).notifications.find(
                    (n) => n.kind === "food_expiring",
                )!;
                expect(row.can_dismiss_for_everyone).toBe(true);
                const out = await call("dismiss_notice", {
                    notification_id: row.id,
                    scope: "everyone",
                });
                expect(out.isError).toBeFalsy();
                expect(textOf(out)).toContain("Dismissed for everyone.");
                expect(textOf(out)).toContain(UNDO_SENTENCE);
                expect(
                    db.agentActions
                        .__records()
                        .filter((r) => r.tool === "dismiss_notice"),
                ).toHaveLength(1);
                expect(
                    (await inbox(call)).notifications.map((n) => n.kind),
                ).not.toContain("food_expiring");
            });
        },
    );

    test.each(ERAS)(
        "snooze for everyone as the owner is recorded, and the household's Off stops it (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await seed(call);
                const row = (await inbox(call)).notifications.find(
                    (n) => n.kind === "food_expiring",
                )!;
                const out = await call("snooze_notice", {
                    notification_id: row.id,
                    until: "week",
                });
                expect(out.isError, textOf(out)).toBeFalsy();
                expect(
                    SNOOZE_NOTICE_OUTPUT_SCHEMA.parse(out.structuredContent),
                ).toMatchObject({ snoozed: true, for_everyone: true });
                expect(textOf(out)).toContain("recorded in Settings");
                expect(
                    db.agentActions
                        .__records()
                        .filter((r) => r.tool === "snooze_notice"),
                ).toHaveLength(1);
                // The household's switch Off stops it, and the inbox says so.
                await db.settingsStore.setAgentDestructiveAllowed(
                    "hh-1",
                    false,
                );
                const other = (await inbox(call)).notifications.find(
                    (n) => n.kind === "running_low",
                )!;
                expect(other.can_dismiss_for_everyone).toBe(false);
                const refused = await call("snooze_notice", {
                    notification_id: other.id,
                    until: "week",
                });
                expect(refused.isError).toBe(true);
                expect(
                    db.agentActions
                        .__records()
                        .filter((r) => r.tool === "snooze_notice"),
                ).toHaveLength(1);
            });
        },
    );

    test.each(ERAS)(
        "a data-quality dismiss over HTTP still works, and the inbox's codes are refused (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = callOf(client);
                await call("upsert_food", { name: "rolled oat" });
                const oats = await call("upsert_food", {
                    name: "rolled oats",
                    on_similar: "create",
                });
                const oatsId = oats.structuredContent?.id as string;
                const food = GET_FOOD_OUTPUT.parse(
                    (await call("get_food", { food_id: oatsId }))
                        .structuredContent,
                );
                const dupe = food.notices.find(
                    (n) => n.code === "food.possible_duplicate",
                )!;
                // get_food's text carries the dismiss form, by its input names.
                const line = textOf(await call("get_food", { food_id: oatsId }))
                    .split("\n")
                    .find((l) =>
                        l.includes("[code: food.possible_duplicate]"),
                    )!;
                expect(line).toContain("[subject_kind: food]");
                expect(line).toContain(
                    `[subject_id: ${dupe.dismiss!.subject_id}]`,
                );
                const out = await call("dismiss_notice", {
                    code: dupe.dismiss!.code,
                    subject_kind: dupe.dismiss!.subject_kind,
                    subject_id: dupe.dismiss!.subject_id,
                    ...(dupe.dismiss!.related_id
                        ? { related_id: dupe.dismiss!.related_id }
                        : {}),
                });
                expect(out.isError, textOf(out)).toBeFalsy();
                const refused = await call("dismiss_notice", {
                    code: "grocery.running_low",
                    subject_kind: "food",
                    subject_id: oatsId,
                });
                expect(refused.isError).toBe(true);
                expect(textOf(refused)).toContain("notification_id");
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

describe("list_grocery_lines and get_fridge carry the Kitchen's fields over HTTP", () => {
    test.each(ERAS)(
        "list_grocery_lines adds store, product_name and usual (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = async (
                    name: string,
                    args: Record<string, unknown> = {},
                ) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const costco = await createGroceryStore(
                    db.settingsStore,
                    "hh-1",
                    "Costco",
                );
                const eggs = await call("upsert_food", { name: "Eggs" });
                const eggsId = eggs.structuredContent?.id as string;
                const product = await call("upsert_food", {
                    generic_food_id: eggsId,
                    name: "Kirkland Eggs",
                });
                const productId = product.structuredContent?.id as string;
                const flour = await call("upsert_food", { name: "Flour" });
                const flourId = flour.structuredContent?.id as string;
                const set = await call("set_usual_product", {
                    food_id: eggsId,
                    product_food_id: productId,
                    store_id: costco.id,
                    amount: 12,
                    unit: "each",
                });
                expect(set.isError).toBeFalsy();
                for (const food_id of [eggsId, flourId]) {
                    const added = await call("add_grocery_line", {
                        kind: "food",
                        food_id,
                        store_id: costco.id,
                    });
                    expect(added.isError).toBeFalsy();
                }

                const listed = await call("list_grocery_lines");
                expect(listed.isError).toBeFalsy();
                const body = GROCERY_LIST_OUTPUT_SCHEMA.parse(
                    listed.structuredContent,
                );
                const lines = body.stores.flatMap((s) =>
                    s.sections.flatMap((sec) => sec.lines),
                );
                const usualLine = lines.find((l) =>
                    /eggs/i.test(l.display_name),
                )!;
                const plainLine = lines.find((l) =>
                    /flour/i.test(l.display_name),
                )!;
                expect(usualLine).toMatchObject({
                    store: "Costco",
                    product_name: "Kirkland Eggs",
                    usual: true,
                });
                expect(plainLine).toMatchObject({
                    store: "Costco",
                    product_name: null,
                    usual: false,
                });
            });
        },
    );

    test.each(ERAS)(
        "a line on the usual product itself is usual (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = async (
                    name: string,
                    args: Record<string, unknown> = {},
                ) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const store = await createGroceryStore(
                    db.settingsStore,
                    "hh-1",
                    "Safeway",
                );
                const oats = await call("upsert_food", { name: "Oats" });
                const oatsId = oats.structuredContent?.id as string;
                const product = await call("upsert_food", {
                    generic_food_id: oatsId,
                    name: "Quaker Oats",
                });
                const productId = product.structuredContent?.id as string;
                const other = await call("upsert_food", {
                    generic_food_id: oatsId,
                    name: "Store Oats",
                });
                const otherId = other.structuredContent?.id as string;
                await call("set_usual_product", {
                    food_id: oatsId,
                    product_food_id: productId,
                    store_id: store.id,
                    amount: 500,
                    unit: "g",
                });
                // Two products of one family at one store would fold into a
                // single line, so the other one is bought elsewhere.
                const elsewhere = await createGroceryStore(
                    db.settingsStore,
                    "hh-1",
                    "Costco",
                );
                for (const [food_id, store_id] of [
                    [productId, store.id],
                    [otherId, elsewhere.id],
                ] as const) {
                    const added = await call("add_grocery_line", {
                        kind: "food",
                        food_id,
                        store_id,
                    });
                    expect(added.isError).toBeFalsy();
                }
                const body = GROCERY_LIST_OUTPUT_SCHEMA.parse(
                    (await call("list_grocery_lines")).structuredContent,
                );
                const lines = body.stores.flatMap((s) =>
                    s.sections.flatMap((sec) => sec.lines),
                );
                const usualLine = lines.find((l) =>
                    /quaker/i.test(l.display_name),
                )!;
                const otherLine = lines.find((l) =>
                    /store oats/i.test(l.display_name),
                )!;
                expect(usualLine.usual).toBe(true);
                expect(usualLine.product_name).toBeNull();
                expect(otherLine.usual).toBe(false);
                expect(otherLine.product_name).toBeNull();
            });
        },
    );

    test.each(ERAS)(
        "a line on a product whose generic is archived is not usual (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = async (
                    name: string,
                    args: Record<string, unknown> = {},
                ) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const store = await createGroceryStore(
                    db.settingsStore,
                    "hh-1",
                    "Aldi",
                );
                const rice = await call("upsert_food", { name: "Rice" });
                const riceId = rice.structuredContent?.id as string;
                const product = await call("upsert_food", {
                    generic_food_id: riceId,
                    name: "Basmati Rice",
                });
                const productId = product.structuredContent?.id as string;
                await call("set_usual_product", {
                    food_id: riceId,
                    product_food_id: productId,
                    store_id: store.id,
                    amount: 1,
                    unit: "g",
                });
                await call("add_grocery_line", {
                    kind: "food",
                    food_id: productId,
                    store_id: store.id,
                });
                const usualOf = async () => {
                    const body = GROCERY_LIST_OUTPUT_SCHEMA.parse(
                        (await call("list_grocery_lines")).structuredContent,
                    );
                    return body.stores
                        .flatMap((s) => s.sections.flatMap((sec) => sec.lines))
                        .find((l) => /basmati/i.test(l.display_name))!.usual;
                };
                expect(await usualOf()).toBe(true);
                const generic = (
                    await db.foodsStore.getFoodsByIds("hh-1", [riceId])
                ).get(riceId)!;
                await db.foodsStore.updateFoodRow({
                    ...generic,
                    archivedAt: "2026-11-09T12:00:00.000Z",
                });
                expect(await usualOf()).toBe(false);
            });
        },
    );

    test.each(ERAS)(
        "get_fridge adds the location name and days left (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call = async (
                    name: string,
                    args: Record<string, unknown> = {},
                ) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const loc = await call("add_fridge_location", {
                    name: "Pantry",
                });
                const locationId = loc.structuredContent?.id as string;
                const today = utcTodayFromDate();
                const [y, m, d] = today.split("-").map(Number);
                const shifted = (days: number) =>
                    new Date(Date.UTC(y!, m! - 1, d! + days))
                        .toISOString()
                        .slice(0, 10);
                const inThree = shifted(3);
                const dated = await call("add_fridge_item", {
                    location_id: locationId,
                    kind: "food",
                    name: "Yogurt",
                    amount: 1,
                    unit: "g",
                });
                await call("add_fridge_item", {
                    location_id: locationId,
                    kind: "food",
                    name: "Rice",
                    amount: 1,
                    unit: "g",
                });
                const row = (await db.fridgeStore.listItems("hh-1")).find(
                    (r) => r.id === dated.structuredContent?.id,
                )!;
                await db.fridgeStore.updateItem({ ...row, expiresOn: inThree });
                const dayEdges: [string, number][] = [
                    ["Milk", -1],
                    ["Butter", 0],
                ];
                for (const [name, days] of dayEdges) {
                    const added = await call("add_fridge_item", {
                        location_id: locationId,
                        kind: "food",
                        name,
                        amount: 1,
                        unit: "g",
                    });
                    const edgeRow = (
                        await db.fridgeStore.listItems("hh-1")
                    ).find((r) => r.id === added.structuredContent?.id)!;
                    await db.fridgeStore.updateItem({
                        ...edgeRow,
                        expiresOn: shifted(days),
                    });
                }

                const listed = await call("get_fridge");
                expect(listed.isError).toBeFalsy();
                const body = GET_FRIDGE_OUTPUT_SCHEMA.parse(
                    listed.structuredContent,
                );
                const items = body.locations.flatMap((l) => l.items);
                expect(
                    items.find((i) => i.display_name === "Yogurt"),
                ).toMatchObject({
                    location: "Pantry",
                    expires_on: inThree,
                    days_left: 3,
                });
                expect(
                    items.find((i) => i.display_name === "Milk")?.days_left,
                ).toBe(-1);
                expect(
                    items.find((i) => i.display_name === "Butter")?.days_left,
                ).toBe(0);
                expect(
                    items.find((i) => i.display_name === "Rice"),
                ).toMatchObject({
                    location: "Pantry",
                    expires_on: null,
                    days_left: null,
                });
            });
        },
    );
});

describe("get_recipe carries the cook preview over HTTP", () => {
    type Call = (
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<ToolResult>;

    // A recipe of 2 portions whose ingredients are one 100 g food each, so one
    // serving takes 50 g of each.
    async function recipeWith(
        call: Call,
        stocked: { name: string; inFridge: number | null }[],
    ) {
        const loc = await call("add_fridge_location", { name: "Pantry" });
        const locationId = loc.structuredContent?.id as string;
        const recipe = await call("create_recipe", {
            name: "Rice bowl",
            yield_portions: 2,
        });
        const recipeId = recipe.structuredContent?.id as string;
        const foodIds: Record<string, string> = {};
        for (const { name, inFridge } of stocked) {
            const food = await call("upsert_food", { name });
            const foodId = food.structuredContent?.id as string;
            foodIds[name] = foodId;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: foodId,
                amount: 100,
                unit: "g",
            });
            if (inFridge != null) {
                const added = await call("add_fridge_item", {
                    location_id: locationId,
                    kind: "food",
                    food_id: foodId,
                    amount: inFridge,
                    unit: "g",
                });
                expect(added.isError).toBeFalsy();
            }
        }
        return { recipeId, foodIds };
    }

    test.each(ERAS)(
        "a fully stocked recipe is cookable with no missing ingredient (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId } = await recipeWith(call, [
                    { name: "Rice", inFridge: 500 },
                    { name: "Spinach", inFridge: 500 },
                ]);
                const got = await call("get_recipe", { id: recipeId });
                expect(got.isError).toBeFalsy();
                const body = GET_RECIPE_OUTPUT_SCHEMA.parse(
                    got.structuredContent,
                );
                expect(body.cook_preview).not.toBeNull();
                expect(body.cook_preview?.cookable).toBe(true);
                expect(body.cook_preview?.total_portions).toBe(1);
                expect(body.cook_preview?.shortfalls).toEqual([]);
                expect(body.cook_preview?.lines.length).toBeGreaterThan(0);
                expect(body.cook_preview?.lines[0]).toMatchObject({
                    unit: "g",
                    before: 500,
                    after: 450,
                });
                expect(body.ingredients.map((i) => i.missing)).toEqual([
                    false,
                    false,
                ]);
            });
        },
    );

    test.each(ERAS)(
        "an ingredient the fridge cannot cover is missing and listed as a shortfall (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId, foodIds } = await recipeWith(call, [
                    { name: "Rice", inFridge: 500 },
                    { name: "Lemon", inFridge: 20 },
                    { name: "Salt", inFridge: null },
                ]);
                const got = await call("get_recipe", { id: recipeId });
                expect(got.isError).toBeFalsy();
                const body = GET_RECIPE_OUTPUT_SCHEMA.parse(
                    got.structuredContent,
                );
                expect(body.cook_preview?.cookable).toBe(false);
                expect(body.cook_preview?.shortfalls).toEqual([
                    {
                        food_id: foodIds["Lemon"]!,
                        display_name: "Lemon",
                        amount: 30,
                        unit: "g",
                        unknown_factor: false,
                    },
                    {
                        food_id: foodIds["Salt"]!,
                        display_name: "Salt",
                        amount: 50,
                        unit: "g",
                        unknown_factor: false,
                    },
                ]);
                const missing = Object.fromEntries(
                    body.ingredients.map((i) => [i.display_name, i.missing]),
                );
                expect(missing).toEqual({
                    Rice: false,
                    Lemon: true,
                    Salt: true,
                });
            });
        },
    );

    test.each(ERAS)(
        "a recipe that cannot be previewed still returns with a null cook_preview (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                // An import is unverified until checked, and the cook refuses it.
                const imported = await call("import_recipe_from_text", {
                    text: "x",
                    instructions: "",
                    name: "Blocked",
                    ingredients: [{ name: "rice", amount: 50, unit: "g" }],
                });
                const recipeId = (
                    imported.structuredContent?.recipe as { id: string }
                ).id;
                const got = await call("get_recipe", { id: recipeId });
                expect(got.isError).toBeFalsy();
                const body = GET_RECIPE_OUTPUT_SCHEMA.parse(
                    got.structuredContent,
                );
                expect(body.verification).toBe("unverified");
                expect(body.cook_preview).toBeNull();
                expect(body.ingredients.every((i) => i.missing === false)).toBe(
                    true,
                );
                expect(textOf(got)).toContain("Blocked");
            });
        },
    );
});

describe("update_recipe_ingredient changes which food a line is, over HTTP", () => {
    type Call = (
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<ToolResult>;

    // A saved recipe of two lines: Onion 100 g (diced) then Rice 50 g, and a
    // second food to swap in.
    async function setup(call: Call) {
        const food = async (name: string) =>
            (await call("upsert_food", { name })).structuredContent
                ?.id as string;
        const onion = await food("Onion");
        const shallot = await food("Shallot");
        const rice = await food("Rice");
        const recipe = await call("create_recipe", {
            name: "Soup",
            yield_portions: 2,
            instructions: "1. Simmer",
        });
        const recipeId = recipe.structuredContent?.id as string;
        await call("add_recipe_ingredient", {
            recipe_id: recipeId,
            food_id: onion,
            amount: 100,
            unit: "g",
        });
        await call("add_recipe_ingredient", {
            recipe_id: recipeId,
            food_id: rice,
            amount: 50,
            unit: "g",
        });
        const lines = async () =>
            GET_RECIPE_OUTPUT_SCHEMA.parse(
                (await call("get_recipe", { id: recipeId })).structuredContent,
            ).ingredients;
        await call("update_recipe_ingredient", {
            recipe_id: recipeId,
            ingredient_id: (await lines())[0]!.id,
            note: "diced",
        });
        return { onion, shallot, recipeId, lines };
    }

    test.each(ERAS)(
        "food_id moves the line to that food and keeps its place and note; amount and unit stay unless sent (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { shallot, recipeId, lines } = await setup(call);
                const [first] = await lines();
                const kept = await call("update_recipe_ingredient", {
                    recipe_id: recipeId,
                    ingredient_id: first!.id,
                    food_id: shallot,
                });
                expect(kept.isError).toBeFalsy();
                expect(textOf(kept)).toContain("Updated Shallot 100 g");
                expect((await lines()).slice(0, 2)).toMatchObject([
                    {
                        id: first!.id,
                        food_id: shallot,
                        display_name: "Shallot",
                        amount: 100,
                        unit: "g",
                        note: "diced",
                    },
                    { display_name: "Rice" },
                ]);
                // A new amount and unit go in with the swap.
                const leek = (await call("upsert_food", { name: "Leek" }))
                    .structuredContent?.id as string;
                await call("update_recipe_ingredient", {
                    recipe_id: recipeId,
                    ingredient_id: first!.id,
                    food_id: leek,
                    amount: 2,
                    unit: "oz",
                    note: null,
                });
                expect((await lines())[0]).toMatchObject({
                    display_name: "Leek",
                    amount: 2,
                    unit: "oz",
                    note: null,
                });
                // Without food_id it is the same update it always was.
                await call("update_recipe_ingredient", {
                    recipe_id: recipeId,
                    ingredient_id: first!.id,
                    amount: 3,
                });
                expect((await lines())[0]).toMatchObject({
                    display_name: "Leek",
                    amount: 3,
                    unit: "oz",
                });
            });
        },
    );

    test.each(ERAS)(
        "a swap that would break the saved recipe is refused and the line stays; an unknown food is refused too (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { shallot, recipeId, lines } = await setup(call);
                const before = await lines();
                // No amount and a note that does not say "to taste": the check fails.
                const refused = await call("update_recipe_ingredient", {
                    recipe_id: recipeId,
                    ingredient_id: before[0]!.id,
                    food_id: shallot,
                    amount: null,
                });
                expect(refused.isError).toBe(true);
                expect(textOf(refused)).toContain(
                    "That change would break this saved recipe",
                );
                expect(await lines()).toEqual(before);
                const unknown = await call("update_recipe_ingredient", {
                    recipe_id: recipeId,
                    ingredient_id: before[0]!.id,
                    food_id: "no-such-food",
                });
                expect(unknown.isError).toBe(true);
                expect(await lines()).toEqual(before);
                // To taste with the words that say so goes through.
                const taste = await call("update_recipe_ingredient", {
                    recipe_id: recipeId,
                    ingredient_id: before[0]!.id,
                    food_id: shallot,
                    amount: null,
                    note: "diced, to taste",
                });
                expect(taste.isError).toBeFalsy();
                expect((await lines())[0]).toMatchObject({
                    display_name: "Shallot",
                    amount: null,
                    note: "diced, to taste",
                });
            });
        },
    );
});

describe("a person's own version of a recipe over HTTP", () => {
    const REFUSAL =
        "An agent can only add, change or delete the entries of the person it acts for. Nothing was changed. Ask U2 to do it, or their agent.";
    type Call = (
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<ToolResult>;

    beforeEach(() => {
        db.members.push({
            householdId: "hh-1",
            userId: "u2",
            role: "member",
            displayName: "U2",
        });
        // The tests below are not about the agent switch.
        void db.settingsStore.setMemberAgentsCanDelete("hh-1", "u1", true);
    });

    // Yield 4: 400 g of rice and 200 g of beans (100 kcal per 100 g each),
    // with 1000 g of each in the fridge.
    async function mealPrep(call: Call) {
        const loc = await call("add_fridge_location", { name: "Pantry" });
        const recipe = await call("create_recipe", {
            name: "Rice bowl",
            yield_portions: 4,
        });
        const recipeId = recipe.structuredContent?.id as string;
        const ids: Record<string, string> = {};
        const lines: Record<string, string> = {};
        for (const [name, amount] of [
            ["Rice", 400],
            ["Beans", 200],
        ] as const) {
            const food = await call("upsert_food", {
                name,
                calories: 100,
                protein_g: 10,
                carbs_g: 10,
                fat_g: 1,
            });
            ids[name] = food.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: ids[name],
                amount,
                unit: "g",
            });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id,
                kind: "food",
                food_id: ids[name],
                amount: 1000,
                unit: "g",
            });
        }
        const got = await call("get_recipe", { id: recipeId });
        for (const row of got.structuredContent?.ingredients as {
            id: string;
            display_name: string;
        }[]) {
            lines[row.display_name] = row.id;
        }
        return { recipeId, ids, lines };
    }

    const stockOf = async (food: string) =>
        (await db.fridgeStore.listItems("hh-1"))
            .filter((item) => item.foodId === food)
            .reduce((sum, item) => sum + item.quantity.amount, 0);

    test.each(ERAS)(
        "get_recipe with member_id shows that member's version, and the caller's own by default (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId, lines } = await mealPrep(call);
                const set = await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                    action: "remove",
                    ingredient_id: lines["Beans"],
                });
                expect(set.isError).toBeFalsy();
                expect(textOf(set)).toContain("leaves it out");
                await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                    action: "amount",
                    ingredient_id: lines["Rice"],
                    amount: 800,
                    unit: "g",
                });
                // Another member's version is a row the app or their agent made.
                await db.variantsStore.saveOverride({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    ingredientId: lines["Rice"]!,
                    action: "amount",
                    amount: 100,
                    unit: "g",
                });

                const mine = GET_RECIPE_OUTPUT_SCHEMA.parse(
                    (await call("get_recipe", { id: recipeId }))
                        .structuredContent,
                );
                expect(mine.ingredients.map((i) => i.display_name)).toEqual([
                    "Rice",
                ]);
                expect(mine.ingredients[0]).toMatchObject({
                    amount: 800,
                    change: "amount",
                });
                expect(mine.variant).toEqual({
                    override_count: 2,
                    removed: [{ id: lines["Beans"]!, display_name: "Beans" }],
                });
                // One serving from the viewing member's version: 800 / 4 g.
                expect(mine.cook_preview?.lines[0]).toMatchObject({
                    before: 1000,
                    after: 800,
                });

                const theirs = await call("get_recipe", {
                    id: recipeId,
                    member_id: "u2",
                });
                const other = GET_RECIPE_OUTPUT_SCHEMA.parse(
                    theirs.structuredContent,
                );
                expect(
                    other.ingredients.map((i) => [i.display_name, i.amount]),
                ).toEqual([
                    ["Rice", 100],
                    ["Beans", 200],
                ]);
                expect(other.variant?.override_count).toBe(1);
                expect(textOf(theirs)).toContain("own version");
            });
        },
    );

    test.each(ERAS)(
        "set_recipe_variant and clear_recipe_variant act only for the caller: another member's is refused (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId, lines } = await mealPrep(call);
                const refused = await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u2",
                    action: "remove",
                    ingredient_id: lines["Beans"],
                });
                expect(refused.isError).toBe(true);
                expect(textOf(refused)).toContain(REFUSAL);
                expect(
                    await db.variantsStore.listOverrides("hh-1", recipeId),
                ).toEqual([]);

                await db.variantsStore.saveOverride({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    ingredientId: lines["Beans"]!,
                    action: "remove",
                });
                const cleared = await call("clear_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u2",
                });
                expect(cleared.isError).toBe(true);
                expect(textOf(cleared)).toContain(REFUSAL);
                expect(
                    await db.variantsStore.listOverrides("hh-1", recipeId),
                ).toHaveLength(1);

                // Your own goes through, and takes only your rows.
                await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                    action: "remove",
                    ingredient_id: lines["Rice"],
                });
                const own = await call("clear_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                });
                expect(own.isError).toBeFalsy();
                expect(textOf(own)).toContain("Cleared 1 change");
                expect(
                    (
                        await db.variantsStore.listOverrides("hh-1", recipeId)
                    ).map((row) => row.userId),
                ).toEqual(["u2"]);
                const nothing = await call("clear_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                });
                expect(nothing.isError).toBeFalsy();
                expect(textOf(nothing)).toContain("no changes");
            });
        },
    );

    test.each(ERAS)(
        "cook sizes the stock from every listed member's version and logs only the acting person's meal (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId, ids, lines } = await mealPrep(call);
                await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                    action: "remove",
                    ingredient_id: lines["Beans"],
                });
                await db.variantsStore.saveOverride({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    ingredientId: lines["Rice"]!,
                    action: "amount",
                    amount: 800,
                    unit: "g",
                });

                // A meal for the other member is refused, and nothing is cooked.
                const refused = await call("cook_recipe", {
                    recipe_id: recipeId,
                    portions_by_member: [
                        { user_id: "u1", portions: 1 },
                        { user_id: "u2", portions: 1 },
                    ],
                });
                expect(refused.isError).toBe(true);
                expect(await stockOf(ids["Rice"]!)).toBe(1000);

                // Without logging, each listed member's version sizes the batch:
                // rice 1/4 x 400 + 2/4 x 800, beans only for u2, 2/4 x 200.
                const batch = await call("cook_recipe", {
                    recipe_id: recipeId,
                    portions_by_member: [
                        { user_id: "u1", portions: 1 },
                        { user_id: "u2", portions: 2 },
                    ],
                    log_meals: false,
                });
                expect(batch.isError).toBeFalsy();
                expect(batch.structuredContent?.total_portions).toBe(3);
                expect(batch.structuredContent?.meal_ids).toEqual([]);
                expect(await stockOf(ids["Rice"]!)).toBe(500);
                expect(await stockOf(ids["Beans"]!)).toBe(900);

                // Logging: the acting person's meal comes from their version
                // (rice only: 100 g = 100 kcal), the other portion is the base.
                const cooked = await call("cook_recipe", {
                    recipe_id: recipeId,
                    portions_by_member: [{ user_id: "u1", portions: 1 }],
                    total_portions: 2,
                });
                expect(cooked.isError).toBeFalsy();
                expect(cooked.structuredContent?.meal_ids).toHaveLength(1);
                expect(db.inserted).toHaveLength(1);
                expect(db.inserted[0]).toMatchObject({
                    user_id: "u1",
                    calories: 100,
                });
                // rice: 1/4 x 400 + 1/4 x 400 = 200; beans: 1/4 x 200 = 50.
                expect(await stockOf(ids["Rice"]!)).toBe(300);
                expect(await stockOf(ids["Beans"]!)).toBe(850);

                // log_recipe_portion logs the same version.
                const portion = await call("log_recipe_portion", {
                    recipe_id: recipeId,
                    portions: 2,
                    meal_type: "dinner",
                });
                expect(portion.isError).toBeFalsy();
                expect(db.inserted[1]).toMatchObject({
                    user_id: "u1",
                    calories: 200,
                });
            });
        },
    );

    test.each(ERAS)(
        "plan_recipe with member_ids totals exactly those members' versions and ignores the servings given (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId, lines } = await mealPrep(call);
                for (const item of await db.fridgeStore.listItems("hh-1")) {
                    await db.fridgeStore.deleteItem("hh-1", item.id);
                }
                await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                    action: "remove",
                    ingredient_id: lines["Beans"],
                });
                await db.variantsStore.saveOverride({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    ingredientId: lines["Rice"]!,
                    action: "amount",
                    amount: 800,
                    unit: "g",
                });
                await db.recipesStore.upsertPortion({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    portionCount: 2,
                });
                const today = (await call("get_week_plan")).structuredContent
                    ?.today as string;
                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "dinner",
                    servings: 4,
                    member_ids: ["u1", "u2"],
                });
                expect(planned.isError).toBeFalsy();
                expect(
                    (
                        planned.structuredContent?.plan as {
                            member_ids: string[];
                        }
                    ).member_ids,
                ).toEqual(["u1", "u2"]);
                expect(textOf(planned)).toContain("[member_id: u2]");
                const week = await call("get_week_plan");
                const need = Object.fromEntries(
                    (
                        week.structuredContent?.missing as {
                            display_name: string;
                            amount: number;
                        }[]
                    ).map((row) => [row.display_name, row.amount]),
                );
                // Four servings asked for, but the plan is its people: u1 1
                // portion (rice 100), u2 2 portions (rice 400, beans 100),
                // and nothing left over at the base.
                expect(need).toEqual({ Rice: 500, Beans: 100 });
                expect(textOf(planned)).toContain("3 portions");
                expect(
                    (planned.structuredContent?.plan as { servings: number })
                        .servings,
                ).toBe(3);

                // Two servings for people who saved three portions between
                // them: the text says what is counted.
                const lunch = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "lunch",
                    servings: 2,
                    member_ids: ["u1", "u2"],
                });
                expect(lunch.isError).toBeFalsy();
                expect(textOf(lunch)).toContain("lunch · 3 portions");
                expect(textOf(lunch)).not.toContain("2 servings");
                expect(textOf(await call("get_week_plan"))).toContain(
                    "(3 portions)",
                );

                const refused = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "lunch",
                    member_ids: ["nobody"],
                });
                expect(refused.isError).toBe(true);
            });
        },
    );

    test.each(ERAS)(
        "add_recipe_to_grocery totals each member's version at their portion count (%p)",
        async (era) => {
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Safeway",
            );
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                const { recipeId, lines } = await mealPrep(call);
                // Nothing in the fridge covers it.
                for (const item of await db.fridgeStore.listItems("hh-1")) {
                    await db.fridgeStore.deleteItem("hh-1", item.id);
                }
                await call("set_recipe_variant", {
                    recipe_id: recipeId,
                    member_id: "u1",
                    action: "remove",
                    ingredient_id: lines["Beans"],
                });
                await db.variantsStore.saveOverride({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    ingredientId: lines["Rice"]!,
                    action: "amount",
                    amount: 800,
                    unit: "g",
                });
                await db.recipesStore.upsertPortion({
                    householdId: "hh-1",
                    recipeId,
                    userId: "u2",
                    portionCount: 2,
                });
                const added = await call("add_recipe_to_grocery", {
                    recipe_id: recipeId,
                    store_id: store.id,
                    member_ids: ["u1", "u2"],
                });
                expect(added.isError).toBeFalsy();
                expect(added.structuredContent?.total_portions).toBe(3);
                const needs = Object.fromEntries(
                    (
                        added.structuredContent?.remainder as {
                            display_name: string;
                            remainder: { amount: number; unit: string };
                        }[]
                    ).map((row) => [row.display_name, row.remainder]),
                );
                expect(needs).toEqual({
                    Rice: { amount: 500, unit: "g" },
                    Beans: { amount: 100, unit: "g" },
                });
            });
        },
    );
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

describe("convert_quantity over HTTP", () => {
    test.each(ERAS)(
        "is always listed, converts with the usual product's serving line, and refuses without a factor (%p)",
        async (era) => {
            const plain = await db.foodsStore.insertFood(
                newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name: "Peanut butter",
                }),
            );
            const product = await db.foodsStore.insertFood(
                newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name: "Jif Creamy",
                    genericFoodId: plain.id,
                    serving: { label: "2 tbsp (32 g)", amount: 32, unit: "g" },
                }),
            );
            await db.foodsStore.updateFoodRow({
                ...plain,
                usualProductId: product.id,
            });
            const bare = await db.foodsStore.insertFood(
                newFood({ householdId: "hh-1", kind: "food", name: "Flour" }),
            );
            await withHttpClient("u1", era, async (client) => {
                expect(
                    (await client.listTools()).tools.map((t) => t.name),
                ).toContain("convert_quantity");
                const pints = (await client.callTool({
                    name: "convert_quantity",
                    arguments: {
                        amount: 1,
                        unit: "pints",
                        to_unit: "cups",
                    },
                })) as ToolResult;
                const p = CONVERT_QUANTITY_OUTPUT_SCHEMA.parse(
                    pints.structuredContent,
                );
                expect(p).toMatchObject({
                    ok: true,
                    unit: "cup",
                    amount: 1.97,
                });

                const cup = (await client.callTool({
                    name: "convert_quantity",
                    arguments: {
                        amount: 1,
                        unit: "cup",
                        to_unit: "g",
                        food_id: plain.id,
                    },
                })) as ToolResult;
                const c = CONVERT_QUANTITY_OUTPUT_SCHEMA.parse(
                    cup.structuredContent,
                );
                expect(c).toMatchObject({
                    ok: true,
                    unit: "g",
                    amount: 256,
                });
                expect(c.factors_used).toEqual([
                    {
                        factor: "grams_per_ml",
                        value: 1.067,
                        source: "product_serving",
                        from_food_id: product.id,
                        from_food_name: "Jif Creamy",
                        serving_label: "2 tbsp (32 g)",
                    },
                ]);
                expect(textOf(cup)).toContain('serving "2 tbsp (32 g)"');

                const flour = (await client.callTool({
                    name: "convert_quantity",
                    arguments: {
                        amount: 2,
                        unit: "cups",
                        to_unit: "g",
                        food_id: bare.id,
                    },
                })) as ToolResult;
                expect(flour.isError).toBeFalsy();
                expect(
                    CONVERT_QUANTITY_OUTPUT_SCHEMA.parse(
                        flour.structuredContent,
                    ),
                ).toMatchObject({
                    ok: false,
                    amount: null,
                    reason: "missing_grams_per_ml",
                });

                const noFood = (await client.callTool({
                    name: "convert_quantity",
                    arguments: { amount: 1, unit: "cup", to_unit: "g" },
                })) as ToolResult;
                expect(
                    CONVERT_QUANTITY_OUTPUT_SCHEMA.parse(
                        noFood.structuredContent,
                    ),
                ).toMatchObject({ ok: false, reason: "needs_food" });
            });
        },
    );
});

describe("rate_product over HTTP", () => {
    test.each(ERAS)("lists and returns structuredContent (%p)", async (era) => {
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
        setFlagsForTests(createMemoryFlags({}));
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
    });

    test.each(ERAS)(
        "each member carries the Product screen's verdict and reason, and each part its display and status (%p)",
        async (era) => {
            db.members = [
                {
                    householdId: "hh-1",
                    userId: "u1",
                    role: "owner",
                    displayName: "Ann",
                },
                {
                    householdId: "hh-1",
                    userId: "u2",
                    role: "member",
                    displayName: "Bo",
                },
            ];
            db.goals = goals({ daily_sugar_g: 30 });
            await addAllergen(db.rulesStore, {
                householdId: "hh-1",
                userId: "u1",
                allergen: "milk",
            });
            const food = newFood({
                householdId: "hh-1",
                kind: "food",
                name: "Sweet Yogurt",
                allergens: ["milk"],
                sugarG: 50,
                gramsPerEach: 40,
                offQuality: {
                    nutriscoreGrade: "a",
                    novaGroup: 4,
                    ecoscoreGrade: "a-plus",
                    additives: [
                        { tag: "en:e330", risk: "none" },
                        { tag: "en:e250", risk: "high" },
                    ],
                    allergensTags: null,
                    tracesTags: null,
                    ingredientsAnalysisTags: null,
                    labelsTags: null,
                    fetchedAt: "2026-11-09T12:00:00.000Z",
                },
            });
            await db.foodsStore.insertFood(food);
            setFlagsForTests(createMemoryFlags({}));
            try {
                await withHttpClient("u1", era, async (client) => {
                    const out = RATE_PRODUCT_OUTPUT_SCHEMA.parse(
                        (
                            (await client.callTool({
                                name: "rate_product",
                                arguments: { food_id: food.id },
                            })) as ToolResult
                        ).structuredContent,
                    );
                    const ann = out.checks.find((c) => c.user_id === "u1");
                    const bo = out.checks.find((c) => c.user_id === "u2");
                    expect(ann?.verdict).toBe("avoid");
                    expect(ann?.reason).toBe(
                        "Contains Milk · listed as an allergy",
                    );
                    expect(bo?.verdict).toBe("good");
                    expect(bo?.reason).toBe(
                        "Fits today · 20 g sugar toward your 50 g",
                    );
                    // The wire notice keeps its own sentence; the reason is
                    // the app's line, not a copy of it.
                    expect(bo?.notices[0]?.message).not.toBe(bo?.reason);

                    expect(out.preset_label).toBe("Balanced");
                    const part = (name: string) =>
                        out.breakdown.find((row) => row.part === name);
                    expect(part("nutrition")).toMatchObject({
                        label: "Nutri-Score",
                        display: "A",
                        status: "good",
                    });
                    expect(part("processing")).toMatchObject({
                        label: "Processing",
                        display: "NOVA 4 · ultra-processed",
                    });
                    expect(part("additives")).toMatchObject({
                        label: "Additives",
                        display: "2 additive(s), 1 high risk",
                    });
                    expect(part("environment")).toMatchObject({
                        display: "A+",
                    });
                    expect(
                        out.info_rows.find((row) => row.kind === "sugars"),
                    ).toMatchObject({ per_100g: 50, status: "over" });
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
            setFlagsForTests(createMemoryFlags({}));
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
});

describe("list_usuals over HTTP", () => {
    afterEach(() => resetFlagsForTests());

    const WEEKDAYS = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];

    function addUtcDays(iso: string, delta: number): string {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d! + delta))
            .toISOString()
            .slice(0, 10);
    }

    function weekdayOf(iso: string): number {
        return new Date(`${iso}T00:00:00Z`).getUTCDay();
    }

    function setRestockWeekday(weekday: number, enabled = true) {
        db.household!.preferences = {
            ...db.household!.preferences,
            restock: {
                ...DEFAULT_RESTOCK,
                enabled,
                weekday: weekday as 0 | 1 | 2 | 3 | 4 | 5 | 6,
            },
        };
    }

    // Four usuals: one on a weekly schedule never bought, one added when low
    // with nothing in stock, one weekly but paused, one every four weeks and
    // bought a week ago.
    async function seedUsuals() {
        const today = utcTodayFromDate();
        await db.settingsStore.insertStore({
            id: "store-1",
            householdId: "hh-1",
            name: "Corner",
            sortOrder: 0,
        });
        const plain = (name: string, extra: Partial<Food>) =>
            newFood({
                householdId: "hh-1",
                kind: "food",
                name,
                defaultUnit: "each",
                ...extra,
            });
        const milk = plain("Oat milk", {
            restockSchedule: "weekly",
            usualStoreId: "store-1",
            usualAmount: { amount: 2, unit: "each" },
        });
        const eggs = plain("Eggs", {
            restockWhenLow: true,
            usualAmount: { amount: 12, unit: "each" },
        });
        const rice = plain("Rice", {
            restockSchedule: "weekly",
            restockPaused: true,
        });
        const salt = plain("Salt", {
            restockSchedule: "every_n_weeks",
            restockEveryWeeks: 4,
            lastRestockedOn: addUtcDays(today, -7),
        });
        const notUsual = plain("Plain flour", {});
        for (const food of [milk, eggs, rice, salt, notUsual]) {
            await db.foodsStore.insertFood(food);
        }
        return { today, milk, eggs, rice, salt };
    }

    type UsualsOut = z.infer<typeof LIST_USUALS_OUTPUT_SCHEMA>;

    test.each(ERAS)(
        "each usual says whether it is due and why (%p)",
        async (era) => {
            const { today, milk, eggs, rice, salt } = await seedUsuals();
            setRestockWeekday(weekdayOf(today));
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const names = (await client.listTools()).tools.map(
                    (t) => t.name,
                );
                expect(names).toContain("list_usuals");
                const r = (await client.callTool({
                    name: "list_usuals",
                    arguments: {},
                })) as ToolResult;
                expect(r.isError).toBeFalsy();
                const out: UsualsOut = LIST_USUALS_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.today).toBe(today);
                expect(out.restock_weekday).toBe(weekdayOf(today));
                expect(out.restock_weekday_name).toBe(
                    WEEKDAYS[weekdayOf(today)]!,
                );
                expect(out.is_restock_day).toBe(true);
                // Plain flour has no schedule and no low rule: not a usual.
                // Due ones come first, then the rest by name.
                expect(out.usuals.map((u) => u.name)).toEqual([
                    "Eggs",
                    "Oat milk",
                    "Rice",
                    "Salt",
                ]);
                const byId = new Map(out.usuals.map((u) => [u.food_id, u]));
                const scheduled = byId.get(milk.id)!;
                expect(scheduled.due?.trigger).toBe("schedule");
                expect(scheduled.due?.reason).toContain("weekly");
                expect(scheduled).toMatchObject({
                    kind: "food",
                    schedule: "weekly",
                    every_weeks: null,
                    store_id: "store-1",
                    store_name: "Corner",
                    amount: 2,
                    unit: "each",
                    paused: false,
                    restock_when_low: false,
                });
                const low = byId.get(eggs.id)!;
                expect(low.due?.trigger).toBe("low");
                expect(low).toMatchObject({
                    schedule: null,
                    restock_when_low: true,
                    low_level: 3,
                    store_id: null,
                    store_name: null,
                    amount: 12,
                });
                expect(byId.get(rice.id)).toMatchObject({
                    paused: true,
                    due: null,
                });
                expect(byId.get(salt.id)).toMatchObject({
                    schedule: "every_n_weeks",
                    every_weeks: 4,
                    due: null,
                });
                expect(out.restock_enabled).toBe(true);
                const text = r.content[0]?.text ?? "";
                expect(text).toContain("Oat milk");
                expect(text).toContain("add when below 3 each");
                expect(text).toContain("every 4 weeks");
                expect(text).not.toContain("Automatic restock is off");
            });
        },
    );

    // The arguments the restock card sends to add_grocery_line for a usual.
    function cardAddArgs(u: UsualsOut["usuals"][number]) {
        const args: Record<string, unknown> = {
            kind: u.kind,
            food_id: u.food_id,
        };
        if (u.store_id) args.store_id = u.store_id;
        if (u.amount != null) args.amount = u.amount;
        if (u.unit) args.unit = u.unit;
        return args;
    }

    test.each(ERAS)(
        "the card's arguments add every shape of due usual through add_grocery_line (%p)",
        async (era) => {
            const today = utcTodayFromDate();
            setRestockWeekday(weekdayOf(today));
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Corner",
            );
            const mk = (name: string, extra: Partial<Food>) =>
                newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name,
                    defaultUnit: "each",
                    restockSchedule: "weekly",
                    ...extra,
                });
            const foods = [
                mk("Milk", {
                    usualStoreId: store.id,
                    usualAmount: { amount: 1, unit: "gal" },
                }),
                mk("Rice", { defaultUnit: "g" }),
                mk("Eggs", { usualAmount: { amount: 12, unit: "each" } }),
                mk("Towels", {
                    kind: "supply",
                    defaultUnit: "roll",
                    usualStoreId: store.id,
                    usualAmount: { amount: 6, unit: "roll" },
                }),
                mk("Soap", { kind: "supply", defaultUnit: "bottle" }),
            ];
            for (const food of foods) await db.foodsStore.insertFood(food);
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const r = (await client.callTool({
                    name: "list_usuals",
                    arguments: {},
                })) as ToolResult;
                const out = LIST_USUALS_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                const due = out.usuals.filter((u) => u.due);
                expect(due.map((u) => u.name).sort()).toEqual([
                    "Eggs",
                    "Milk",
                    "Rice",
                    "Soap",
                    "Towels",
                ]);
                expect(due.every((u) => !u.on_list)).toBe(true);
                for (const u of due) {
                    const added = (await client.callTool({
                        name: "add_grocery_line",
                        arguments: cardAddArgs(u),
                    })) as ToolResult;
                    expect(added.isError).toBeFalsy();
                    expect(
                        (added.structuredContent as { status?: string }).status,
                    ).toBe("ok");
                }
                expect(await db.groceryStore.listLines("hh-1")).toHaveLength(
                    due.length,
                );
            });
        },
    );

    test.each(ERAS)(
        "add_grocery_line twice for one food leaves one line and says so (%p)",
        async (era) => {
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Corner",
            );
            const milk = await db.foodsStore.insertFood(
                newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name: "Milk",
                    defaultUnit: "each",
                }),
            );
            await withHttpClient("u1", era, async (client) => {
                const add = async (args: Record<string, unknown>) =>
                    (await client.callTool({
                        name: "add_grocery_line",
                        arguments: args,
                    })) as ToolResult;
                const args = {
                    kind: "food",
                    food_id: milk.id,
                    store_id: store.id,
                };
                // Two restock cards (or a card and the runner) send the same call.
                const [a, b] = await Promise.all([add(args), add(args)]);
                for (const r of [a, b]) {
                    expect(r.isError).toBeFalsy();
                    ADD_GROCERY_LINE_OUTPUT_SCHEMA.parse(r.structuredContent);
                }
                const out = [a, b].map((r) => r.structuredContent as never) as {
                    id: string;
                    already_on_list: boolean;
                }[];
                expect(out[0]!.id).toBe(out[1]!.id);
                expect(out.map((o) => o.already_on_list).sort()).toEqual([
                    false,
                    true,
                ]);
                const repeat = out[0]!.already_on_list ? a : b;
                expect(repeat.content[0]?.text).toContain(
                    "already on the list",
                );
                expect(
                    [a, b].find((r) => r !== repeat)!.content[0]?.text,
                ).toContain("Added Milk");
                expect(await db.groceryStore.listLines("hh-1")).toHaveLength(1);

                // Without a store the server picks the one it is listed at.
                const picked = await add({ kind: "food", food_id: milk.id });
                expect(
                    (picked.structuredContent as { already_on_list: boolean })
                        .already_on_list,
                ).toBe(true);

                // Once it is ticked off, adding it again is a new line.
                await client.callTool({
                    name: "check_grocery_line",
                    arguments: { id: out[0]!.id, checked: true },
                });
                const next = await add(args);
                expect(
                    (next.structuredContent as { already_on_list: boolean })
                        .already_on_list,
                ).toBe(false);
                expect(await db.groceryStore.listLines("hh-1")).toHaveLength(2);
            });
        },
    );

    test.each(ERAS)(
        "a due usual already on the grocery list says on_list, and a checked line does not count (%p)",
        async (era) => {
            const { today, milk } = await seedUsuals();
            setRestockWeekday(weekdayOf(today));
            const store = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Market",
            );
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const list = async () =>
                    LIST_USUALS_OUTPUT_SCHEMA.parse(
                        (
                            (await client.callTool({
                                name: "list_usuals",
                                arguments: {},
                            })) as ToolResult
                        ).structuredContent,
                    );
                const onList = (out: UsualsOut) =>
                    Object.fromEntries(
                        out.usuals.map((u) => [u.name, u.on_list]),
                    );
                expect(onList(await list())).toMatchObject({
                    "Oat milk": false,
                    Eggs: false,
                });
                const added = (await client.callTool({
                    name: "add_grocery_line",
                    arguments: {
                        kind: "food",
                        food_id: milk.id,
                        store_id: store.id,
                        amount: 2,
                        unit: "each",
                    },
                })) as ToolResult;
                expect(
                    (added.structuredContent as { status?: string }).status,
                ).toBe("ok");
                const out = await list();
                expect(onList(out)).toMatchObject({
                    "Oat milk": true,
                    Eggs: false,
                });
                expect(
                    out.usuals.find((u) => u.food_id === milk.id)?.due,
                ).not.toBeNull();
                // Checked off means bought: the usual no longer counts as listed.
                const [line] = await db.groceryStore.listLines("hh-1");
                await db.groceryStore.updateLine({ ...line!, checked: true });
                expect(onList(await list())["Oat milk"]).toBe(false);
            });
        },
    );

    test.each(ERAS)(
        "a low usual follows the runner's rule: a recent tick covers it, a stale tick does not, a dismissal hides it (%p)",
        async (era) => {
            const { today, eggs } = await seedUsuals();
            setRestockWeekday((weekdayOf(today) + 3) % 7);
            const market = await createGroceryStore(
                db.settingsStore,
                "hh-1",
                "Market",
            );
            setFlagsForTests(createMemoryFlags({}));
            const stamp = async (lastRestockedOn: string | null) => {
                await db.foodsStore.updateFoodRow({
                    ...(await db.foodsStore.getFood("hh-1", eggs.id))!,
                    lastRestockedOn,
                });
            };
            await withHttpClient("u1", era, async (client) => {
                const eggsRow = async () => {
                    const r = (await client.callTool({
                        name: "list_usuals",
                        arguments: {},
                    })) as ToolResult;
                    return {
                        row: LIST_USUALS_OUTPUT_SCHEMA.parse(
                            r.structuredContent,
                        ).usuals.find((u) => u.food_id === eggs.id)!,
                        text: r.content[0]?.text ?? "",
                    };
                };
                const open = await eggsRow();
                expect(open.row).toMatchObject({
                    due: { trigger: "low" },
                    on_list: false,
                    dismissed: false,
                });
                const added = (await client.callTool({
                    name: "add_grocery_line",
                    arguments: {
                        kind: "food",
                        food_id: eggs.id,
                        store_id: market.id,
                        amount: 12,
                        unit: "each",
                    },
                })) as ToolResult;
                expect(
                    (added.structuredContent as { status?: string }).status,
                ).toBe("ok");
                expect((await eggsRow()).row.on_list).toBe(true);
                // Ticked off: a recent tick still covers a low usual.
                const [line] = await db.groceryStore.listLines("hh-1");
                await db.groceryStore.updateLine({ ...line!, checked: true });
                await stamp(addUtcDays(today, -2));
                expect((await eggsRow()).row.on_list).toBe(true);
                // A stale tick does not.
                await stamp(addUtcDays(today, -8));
                expect((await eggsRow()).row.on_list).toBe(false);
                // A dismissed running-low notice hides it until the next restock.
                await db.dismissalsStore.insert({
                    householdId: "hh-1",
                    code: "grocery.running_low",
                    subjectKind: "food",
                    subjectId: eggs.id,
                    relatedKey: addUtcDays(today, -8),
                    dismissedBy: "u1",
                });
                const hidden = await eggsRow();
                expect(hidden.row).toMatchObject({
                    on_list: false,
                    dismissed: true,
                });
                expect(hidden.text).toContain("dismissed");
                // Restocking later moves the scope, so the dismissal lapses.
                await stamp(addUtcDays(today, -9));
                expect((await eggsRow()).row.dismissed).toBe(false);
            });
        },
    );

    test.each(ERAS)(
        "the text says so when a usual has no low level, no N, or restock is off (%p)",
        async (era) => {
            const mk = (name: string, extra: Partial<Food>) =>
                newFood({
                    householdId: "hh-1",
                    kind: "food",
                    name,
                    defaultUnit: "each",
                    ...extra,
                });
            // Add-when-low with no usual amount: no level applies.
            await db.foodsStore.insertFood(
                mk("Flour", { restockWhenLow: true }),
            );
            await db.foodsStore.insertFood(
                mk("Tea", {
                    restockSchedule: "every_n_weeks",
                    restockEveryWeeks: null,
                }),
            );
            setRestockWeekday(0, false);
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const r = (await client.callTool({
                    name: "list_usuals",
                    arguments: {},
                })) as ToolResult;
                const out = LIST_USUALS_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.restock_enabled).toBe(false);
                const text = r.content[0]?.text ?? "";
                expect(text).toContain("add when low (no level set)");
                expect(text).not.toContain("a quarter of the usual");
                expect(text).toContain("every few weeks (not set)");
                expect(text).not.toContain("null");
                expect(text).toContain("Automatic restock is off");
            });
        },
    );

    test.each(ERAS)(
        "off the restock day only the low usual is due (%p)",
        async (era) => {
            const { today, milk, eggs } = await seedUsuals();
            setRestockWeekday((weekdayOf(today) + 1) % 7);
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const r = (await client.callTool({
                    name: "list_usuals",
                    arguments: {},
                })) as ToolResult;
                const out = LIST_USUALS_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.is_restock_day).toBe(false);
                const byId = new Map(out.usuals.map((u) => [u.food_id, u]));
                expect(byId.get(milk.id)?.due).toBeNull();
                expect(byId.get(eggs.id)?.due?.trigger).toBe("low");
            });
        },
    );

    test.each(ERAS)(
        "no usuals still returns structuredContent (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const r = (await client.callTool({
                    name: "list_usuals",
                    arguments: {},
                })) as ToolResult;
                const out = LIST_USUALS_OUTPUT_SCHEMA.parse(
                    r.structuredContent,
                );
                expect(out.usuals).toEqual([]);
                expect(r.content[0]?.text).toMatch(/no usuals/i);
            });
        },
    );
});

describe("plan tools over HTTP", () => {
    afterEach(() => resetFlagsForTests());

    const PLAN_TOOLS = [
        "get_week_plan",
        "plan_recipe",
        "unplan_recipe",
        "update_plan",
        "add_plan_missing_to_groceries",
    ];

    function addUtcDays(iso: string, delta: number): string {
        const [y, m, d] = iso.split("-").map(Number);
        return new Date(Date.UTC(y!, m! - 1, d! + delta))
            .toISOString()
            .slice(0, 10);
    }

    function callerOf(client: Client): CallTool {
        return async (name, args = {}) =>
            (await client.callTool({ name, arguments: args })) as ToolResult;
    }

    // A schema rejection and a handler error both mean "refused"; the text is
    // what the caller reads either way.
    async function refusal(
        call: CallTool,
        name: string,
        args: Record<string, unknown>,
    ): Promise<string> {
        try {
            const r = await call(name, args);
            expect(r.isError).toBe(true);
            return String(r.content[0]?.text ?? "");
        } catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }

    // Bread (1 portion) needs 200 g of Flour; the kitchen holds none.
    async function seedBread(call: CallTool) {
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
        return { recipeId, flourId: flour.structuredContent?.id as string };
    }

    async function addStore() {
        await db.settingsStore.insertStore({
            id: "store-1",
            householdId: "hh-1",
            name: "Corner",
            sortOrder: 0,
        });
        await db.settingsStore.insertSection({
            id: "section-1",
            householdId: "hh-1",
            storeId: "store-1",
            name: "Other",
            sortOrder: 0,
            hidden: false,
            isOther: true,
        });
    }

    test.each(ERAS)(
        "plan_recipe then get_week_plan shows it, unplan_recipe then removes it (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const names = (await client.listTools()).tools.map(
                    (t) => t.name,
                );
                for (const name of PLAN_TOOLS) expect(names).toContain(name);
                const call = callerOf(client);
                const { recipeId } = await seedBread(call);
                const today = utcTodayFromDate();
                const day = addUtcDays(today, 2);

                const empty = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan")).structuredContent,
                );
                expect(empty.from).toBe(today);
                expect(empty.planned_count).toBe(0);
                expect(empty.days).toHaveLength(7);
                expect(empty.missing).toEqual([]);

                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: day,
                    slot: "dinner",
                    servings: 2,
                });
                expect(planned.isError).toBeFalsy();
                const created = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    planned.structuredContent,
                );
                expect(created.already_planned).toBe(false);
                expect(created.plan).toMatchObject({
                    recipe_id: recipeId,
                    recipe_name: "Bread",
                    date: day,
                    slot: "dinner",
                    servings: 2,
                });

                const week = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan")).structuredContent,
                );
                expect(week.planned_count).toBe(1);
                const onDay = week.days.find((d) => d.date === day)!;
                expect(onDay.weekday).toBe(
                    WEEKDAY_NAMES[new Date(`${day}T00:00:00Z`).getUTCDay()]!,
                );
                expect(onDay.plans).toEqual([
                    {
                        plan_id: created.plan.plan_id,
                        recipe_id: recipeId,
                        recipe_name: "Bread",
                        slot: "dinner",
                        servings: 2,
                        // Flour has no nutrition: the figure is unknown, not 0.
                        kcal_per_portion: null,
                    },
                ]);
                // Nothing in stock: the 2-serving plan needs 400 g of flour.
                expect(week.missing).toHaveLength(1);
                expect(week.missing[0]).toMatchObject({
                    display_name: "Flour",
                    amount: 400,
                    unit: "g",
                    unknown: false,
                    unmeasured: false,
                    needed_by: [
                        {
                            plan_id: created.plan.plan_id,
                            recipe_id: recipeId,
                            recipe_name: "Bread",
                            date: day,
                            slot: "dinner",
                        },
                    ],
                });
                expect(week.missing[0]!.food_id).toBeTruthy();

                const removed = await call("unplan_recipe", {
                    plan_id: created.plan.plan_id,
                });
                expect(removed.isError).toBeFalsy();
                expect(
                    UNPLAN_RECIPE_OUTPUT_SCHEMA.parse(
                        removed.structuredContent,
                    ),
                ).toEqual({ removed: true, plan_id: created.plan.plan_id });
                const after = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan")).structuredContent,
                );
                expect(after.planned_count).toBe(0);
                expect(after.missing).toEqual([]);
            });
        },
    );

    test.each(ERAS)(
        "plan_recipe repeat puts a recipe on every day it names, unplan_recipe removes one day or the series (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId } = await seedBread(call);
                const today = utcTodayFromDate();
                const datesOnPlan = async () =>
                    WEEK_PLAN_OUTPUT_SCHEMA.parse(
                        (await call("get_week_plan")).structuredContent,
                    ).days.flatMap((d) => d.plans.map(() => d.date));

                const planned = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "dinner",
                    repeat: "daily",
                });
                expect(planned.isError).toBeFalsy();
                const created = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    planned.structuredContent,
                );
                expect(created.plan.repeats).toBe(true);
                expect(created.plan.plan_id).toBe(
                    `rule:${created.plan.plan_id.split(":")[1]}:${today}`,
                );
                expect(await datesOnPlan()).toEqual(
                    [0, 1, 2, 3, 4, 5, 6].map((n) => addUtcDays(today, n)),
                );
                // The same repeat again is the same repeat.
                const again = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (
                        await call("plan_recipe", {
                            recipe_id: recipeId,
                            date: today,
                            slot: "dinner",
                            repeat: "daily",
                        })
                    ).structuredContent,
                );
                expect(again).toMatchObject({ already_planned: true });
                expect(await datesOnPlan()).toHaveLength(7);

                // One day: the default scope.
                const dayId = `rule:${created.plan.plan_id.split(":")[1]}:${addUtcDays(today, 2)}`;
                const dayRemoved = await call("unplan_recipe", {
                    plan_id: dayId,
                });
                expect(dayRemoved.isError).toBeFalsy();
                expect(await datesOnPlan()).toEqual(
                    [0, 1, 3, 4, 5, 6].map((n) => addUtcDays(today, n)),
                );
                // The whole series from a day on; earlier days stay.
                const seriesRemoved = await call("unplan_recipe", {
                    plan_id: `rule:${created.plan.plan_id.split(":")[1]}:${addUtcDays(today, 4)}`,
                    scope: "series",
                });
                expect(seriesRemoved.isError).toBeFalsy();
                expect(await datesOnPlan()).toEqual(
                    [0, 1, 3].map((n) => addUtcDays(today, n)),
                );

                // Pick days, weekdays or a bad choice.
                const picked = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (
                        await call("plan_recipe", {
                            recipe_id: recipeId,
                            date: today,
                            slot: "lunch",
                            repeat: "days",
                            days: [0, 1, 2, 3, 4, 5, 6],
                        })
                    ).structuredContent,
                );
                expect(picked.plan.repeats).toBe(true);
                const bad = await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: today,
                    slot: "lunch",
                    repeat: "days",
                });
                expect(bad.isError).toBe(true);
                // `series` on a plan that does not repeat is refused.
                const oneOff = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (
                        await call("plan_recipe", {
                            recipe_id: recipeId,
                            date: today,
                            slot: "snack",
                        })
                    ).structuredContent,
                );
                expect(oneOff.plan.repeats).toBeUndefined();
                const refused = await call("unplan_recipe", {
                    plan_id: oneOff.plan.plan_id,
                    scope: "series",
                });
                expect(refused.isError).toBe(true);
            });
        },
    );

    test.each(ERAS)(
        "update_plan changes one planned entry: a one-off in place, one day of a series alone, and the series only through repeat (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId } = await seedBread(call);
                const today = utcTodayFromDate();
                const day = (n: number) => addUtcDays(today, n);
                const week = async () =>
                    WEEK_PLAN_OUTPUT_SCHEMA.parse(
                        (await call("get_week_plan")).structuredContent,
                    ).days.flatMap((d) =>
                        d.plans.map((p) => `${d.date} ${p.slot} ${p.servings}`),
                    );

                // A one-off changes where it is and keeps its id.
                const one = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (
                        await call("plan_recipe", {
                            recipe_id: recipeId,
                            date: day(2),
                            slot: "dinner",
                            servings: 2,
                        })
                    ).structuredContent,
                );
                const moved = await call("update_plan", {
                    plan_id: one.plan.plan_id,
                    date: day(3),
                    slot: "lunch",
                    servings: 4,
                });
                expect(moved.isError).toBeFalsy();
                const movedOut = UPDATE_PLAN_OUTPUT_SCHEMA.parse(
                    moved.structuredContent,
                );
                expect(movedOut).toMatchObject({
                    changed: true,
                    already_planned: false,
                    repeat: "once",
                    plan: {
                        plan_id: one.plan.plan_id,
                        date: day(3),
                        slot: "lunch",
                        servings: 4,
                    },
                });
                // The text names the resulting plan and its recipe, and how to undo.
                expect(textOf(moved)).toStartWith("Updated: Bread");
                expect(textOf(moved)).toContain(
                    `[plan_id: ${one.plan.plan_id}]`,
                );
                expect(textOf(moved)).toContain(`[recipe_id: ${recipeId}]`);
                // The guard recorded it (these memory stores seed no rows, so
                // the sentence says it can't be undone here; the undo itself
                // is tested against Postgres).
                expect(textOf(moved)).toContain("Settings › AI connections");
                expect(await week()).toEqual([`${day(3)} lunch 4`]);

                // The same values again: nothing written, no undo promised.
                const same = await call("update_plan", {
                    plan_id: one.plan.plan_id,
                    date: day(3),
                    slot: "lunch",
                    servings: 4,
                    recipe_id: recipeId,
                    repeat: "once",
                });
                expect(same.isError).toBeFalsy();
                expect(textOf(same)).toStartWith("Nothing changed: Bread");
                expect(textOf(same)).not.toContain("Settings › AI connections");
                expect(
                    UPDATE_PLAN_OUTPUT_SCHEMA.parse(same.structuredContent),
                ).toMatchObject({ changed: false });

                // A repeat: one day changes that day only (its id changes) ...
                const series = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (
                        await call("plan_recipe", {
                            recipe_id: recipeId,
                            date: day(0),
                            slot: "snack",
                            repeat: "daily",
                            servings: 1,
                        })
                    ).structuredContent,
                );
                const ruleId = series.plan.plan_id.split(":")[1];
                const detached = UPDATE_PLAN_OUTPUT_SCHEMA.parse(
                    (
                        await call("update_plan", {
                            plan_id: `rule:${ruleId}:${day(2)}`,
                            servings: 3,
                        })
                    ).structuredContent,
                );
                expect(detached.plan.plan_id).not.toContain("rule:");
                expect(detached.plan.repeats).toBeUndefined();
                expect(
                    (await week()).filter((l) => l.includes("snack")),
                ).toEqual(
                    [0, 1, 2, 3, 4, 5, 6].map(
                        (n) => `${day(n)} snack ${n === 2 ? 3 : 1}`,
                    ),
                );
                // ... and a repeat change is the series from that day on.
                const changed = await call("update_plan", {
                    plan_id: `rule:${ruleId}:${day(4)}`,
                    repeat: "weekly",
                });
                expect(changed.isError).toBeFalsy();
                const changedOut = UPDATE_PLAN_OUTPUT_SCHEMA.parse(
                    changed.structuredContent,
                );
                expect(changedOut.repeat).toBe("weekly");
                expect(changedOut.plan.repeats).toBe(true);
                expect(changedOut.plan.plan_id).toMatch(/^rule:/);
                expect(changedOut.plan.plan_id).not.toContain(ruleId!);
                expect(textOf(changed)).toContain(
                    `[plan_id: ${changedOut.plan.plan_id}]`,
                );
                expect(textOf(changed)).toContain("Repeats every week on");
                expect(
                    (await week()).filter((l) => l.includes("snack")),
                ).toEqual(
                    [0, 1, 2, 3, 4].map(
                        (n) => `${day(n)} snack ${n === 2 ? 3 : 1}`,
                    ),
                );

                // Refusals: no such plan, a bad recipe, a past day, a bad weekday.
                expect(
                    await refusal(call, "update_plan", {
                        plan_id: crypto.randomUUID(),
                        servings: 2,
                    }),
                ).toContain("Plan not found.");
                expect(
                    await refusal(call, "update_plan", {
                        plan_id: one.plan.plan_id,
                        recipe_id: "nope",
                    }),
                ).toContain("Recipe not found.");
                expect(
                    await refusal(call, "update_plan", {
                        plan_id: one.plan.plan_id,
                        date: addUtcDays(today, -1),
                    }),
                ).toContain("Pick today or a later day.");
                expect(
                    await refusal(call, "update_plan", {
                        plan_id: one.plan.plan_id,
                        repeat: "days",
                        days: [9],
                    }),
                ).toContain("weekday");

                // A repeat or Once from a day that has passed would cut the
                // series there and erase the days up to today: refused, with
                // the days before today as they were.
                const began = await db.plansStore.addRule({
                    householdId: "hh-1",
                    recipeId,
                    slot: "lunch",
                    servings: 1,
                    startsOn: day(-6),
                    repeat: "daily",
                });
                const pastDays = async () =>
                    (await db.plansStore.listPlans("hh-1", day(-6), day(-1)))
                        .length;
                expect(await pastDays()).toBe(6);
                for (const args of [
                    { repeat: "weekly" },
                    { date: day(2), repeat: "weekly" },
                    { repeat: "once" },
                    { date: day(2), repeat: "once" },
                ]) {
                    expect(
                        await refusal(call, "update_plan", {
                            plan_id: `rule:${began!.id}:${day(-4)}`,
                            ...args,
                        }),
                    ).toContain(
                        "That day has passed. Change the repeat from today or a later day.",
                    );
                    expect(await pastDays()).toBe(6);
                    expect(
                        (await db.plansStore.getRule("hh-1", began!.id))
                            ?.endsOn,
                    ).toBeNull();
                }
            });
        },
    );

    test.each(ERAS)(
        "get_week_plan carries what the plan is missing as a notice with its dismiss fields, and dismiss_notice dismisses it (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId, flourId } = await seedBread(call);
                const day = addUtcDays(utcTodayFromDate(), 2);

                // Nothing is planned, so nothing is missing and nothing to say.
                const empty = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan")).structuredContent,
                );
                expect(empty.notices).toEqual([]);

                const planned = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (
                        await call("plan_recipe", {
                            recipe_id: recipeId,
                            date: day,
                            slot: "dinner",
                        })
                    ).structuredContent,
                );

                const read = await call("get_week_plan");
                const week = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    read.structuredContent,
                );
                expect(week.missing).toHaveLength(1);
                expect(week.notices).toHaveLength(1);
                // The shape every other tool sends a notice in.
                const notice = NOTICE_SCHEMA.parse(week.notices[0]);
                expect(notice).toMatchObject({
                    code: "plan.missing_ingredient",
                    severity: "warn",
                    subject: { kind: "food", id: flourId },
                    can_dismiss: true,
                    dismiss: {
                        code: "plan.missing_ingredient",
                        subject_kind: "food",
                        subject_id: flourId,
                        related_id: planned.plan.plan_id,
                    },
                });
                expect(notice.message).toContain("Flour");
                expect(notice.message).toContain("Bread");
                // The text names the fields dismiss_notice takes.
                const text = textOf(read);
                expect(text).toContain(notice.message);
                expect(text).toContain("[code: plan.missing_ingredient]");
                expect(text).toContain("[subject_kind: food]");
                expect(text).toContain(`[subject_id: ${flourId}]`);
                expect(text).toContain(`[related_id: ${planned.plan.plan_id}]`);

                const dismissed = await call("dismiss_notice", {
                    code: notice.dismiss!.code,
                    subject_kind: notice.dismiss!.subject_kind,
                    subject_id: notice.dismiss!.subject_id,
                    related_id: notice.dismiss!.related_id ?? undefined,
                });
                expect(dismissed.isError).toBeFalsy();
                expect(dismissed.structuredContent).toEqual({
                    dismissed: true,
                });

                // Only the notice goes: the plan still lists what it needs.
                const after = await call("get_week_plan");
                const again = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    after.structuredContent,
                );
                expect(again.notices).toEqual([]);
                expect(again.missing).toHaveLength(1);
                expect(textOf(after)).not.toContain("plan.missing_ingredient");

                // It is not an inbox kind: list_notices never carried it.
                const inbox = LIST_NOTICES_OUTPUT_SCHEMA.parse(
                    (await call("list_notices")).structuredContent,
                );
                expect(
                    inbox.notifications.map((n) => n.message).join("\n"),
                ).not.toContain("Flour");
            });
        },
    );

    test.each(ERAS)(
        "get_week_plan starts at from and a recipe with nutrition shows kcal per portion (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const oats = await call("upsert_food", {
                    name: "Oats",
                    calories: 400,
                    protein_g: 10,
                    carbs_g: 60,
                    fat_g: 8,
                });
                expect(oats.isError).toBeFalsy();
                const recipe = await call("create_recipe", {
                    name: "Porridge",
                    yield_portions: 2,
                });
                const recipeId = recipe.structuredContent?.id as string;
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: oats.structuredContent?.id as string,
                    amount: 100,
                    unit: "g",
                });
                const day = addUtcDays(utcTodayFromDate(), 3);
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: day,
                    slot: "breakfast",
                });
                const week = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan", { from: day }))
                        .structuredContent,
                );
                expect(week.from).toBe(day);
                expect(week.days[0]!.date).toBe(day);
                expect(week.days[6]!.date).toBe(addUtcDays(day, 6));
                const entry = week.days[0]!.plans[0]!;
                // Servings default to the recipe's yield; 100 g of 400 kcal/100 g over 2 portions.
                expect(entry.servings).toBe(2);
                expect(entry.kcal_per_portion).toBe(200);
            });
        },
    );

    test.each(ERAS)(
        "plan_recipe refuses a bad slot, a bad or past date, bad servings and an unknown recipe (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId } = await seedBread(call);
                const today = utcTodayFromDate();
                const ok = { recipe_id: recipeId, date: today, slot: "lunch" };

                expect(
                    await refusal(call, "plan_recipe", {
                        ...ok,
                        slot: "brunch",
                    }),
                ).toMatch(/breakfast|slot/i);
                expect(
                    await refusal(call, "plan_recipe", {
                        ...ok,
                        date: "2026-13-45",
                    }),
                ).toMatch(/date|day/i);
                expect(
                    await refusal(call, "plan_recipe", {
                        ...ok,
                        date: "next tuesday",
                    }),
                ).toMatch(/date|day/i);
                expect(
                    await refusal(call, "plan_recipe", {
                        ...ok,
                        date: addUtcDays(today, -1),
                    }),
                ).toMatch(/today or a later day/i);
                expect(
                    await refusal(call, "plan_recipe", { ...ok, servings: 0 }),
                ).toMatch(/servings/i);
                expect(
                    await refusal(call, "plan_recipe", {
                        ...ok,
                        servings: 1000,
                    }),
                ).toMatch(/999/);
                expect(
                    await refusal(call, "plan_recipe", {
                        ...ok,
                        recipe_id: "00000000-0000-4000-8000-000000000000",
                    }),
                ).toMatch(/recipe.*not found|not found/i);
                expect(
                    WEEK_PLAN_OUTPUT_SCHEMA.parse(
                        (await call("get_week_plan")).structuredContent,
                    ).planned_count,
                ).toBe(0);
            });
        },
    );

    test.each(ERAS)(
        "planning the same recipe on the same day and slot twice is one plan (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId } = await seedBread(call);
                const args = {
                    recipe_id: recipeId,
                    date: utcTodayFromDate(),
                    slot: "snack",
                };
                const first = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (await call("plan_recipe", args)).structuredContent,
                );
                const second = PLAN_RECIPE_OUTPUT_SCHEMA.parse(
                    (await call("plan_recipe", args)).structuredContent,
                );
                expect(first.already_planned).toBe(false);
                expect(second.already_planned).toBe(true);
                expect(second.plan.plan_id).toBe(first.plan.plan_id);
                expect(
                    WEEK_PLAN_OUTPUT_SCHEMA.parse(
                        (await call("get_week_plan")).structuredContent,
                    ).planned_count,
                ).toBe(1);
            });
        },
    );

    test.each(ERAS)(
        "unplan_recipe with an unknown plan id is a clear error (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                expect(
                    await refusal(call, "unplan_recipe", {
                        plan_id: "00000000-0000-4000-8000-000000000000",
                    }),
                ).toMatch(/plan not found/i);
                expect(
                    await refusal(call, "unplan_recipe", {
                        plan_id: "not-a-uuid",
                    }),
                ).toMatch(/plan not found/i);
            });
        },
    );

    test.each(ERAS)(
        "add_plan_missing_to_groceries puts the missing lines on the list with source plan and a second call adds nothing (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await addStore();
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId, flourId } = await seedBread(call);
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: utcTodayFromDate(),
                    slot: "dinner",
                });
                const first = await call("add_plan_missing_to_groceries");
                expect(first.isError).toBeFalsy();
                const out = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    first.structuredContent,
                );
                expect(out.added).toHaveLength(1);
                expect(out.added[0]).toMatchObject({
                    food_id: flourId,
                    display_name: "Flour",
                    amount: 200,
                    unit: "g",
                });
                expect(out.on_list).toEqual([]);
                expect(out.unknown).toEqual([]);
                expect(out.skipped).toEqual([]);
                const lines = await db.groceryStore.listLines("hh-1");
                expect(lines).toHaveLength(1);
                expect(lines[0]).toMatchObject({
                    foodId: flourId,
                    source: "plan",
                });

                const again = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    (await call("add_plan_missing_to_groceries"))
                        .structuredContent,
                );
                expect(again.added).toEqual([]);
                expect(again.on_list).toHaveLength(1);
                expect(again.on_list[0]).toMatchObject({
                    food_id: flourId,
                    display_name: "Flour",
                    existing_line_id: out.added[0]!.line_id,
                });
                expect(await db.groceryStore.listLines("hh-1")).toHaveLength(1);
            });
        },
    );

    test.each(ERAS)(
        "add_plan_missing_to_groceries notes an unmeasured ingredient and a line whose stock cannot be counted (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await addStore();
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId, flourId } = await seedBread(call);
                const pepper = await call("upsert_food", { name: "Pepper" });
                await call("add_recipe_ingredient", {
                    recipe_id: recipeId,
                    food_id: pepper.structuredContent?.id as string,
                    amount: null,
                });
                // Flour is stocked in "each", which cannot be turned into grams.
                const loc = await call("add_fridge_location", {
                    name: "Pantry",
                });
                const stocked = await call("add_fridge_item", {
                    location_id: loc.structuredContent?.id as string,
                    kind: "food",
                    food_id: flourId,
                    amount: 1,
                    unit: "each",
                });
                expect(stocked.isError).toBeFalsy();
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: utcTodayFromDate(),
                    slot: "dinner",
                });
                const week = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan")).structuredContent,
                );
                const byName = new Map(
                    week.missing.map((m) => [m.display_name, m]),
                );
                expect(byName.get("Flour")).toMatchObject({
                    unknown: true,
                    amount: 200,
                    unit: "g",
                });
                expect(byName.get("Pepper")).toMatchObject({
                    unmeasured: true,
                    amount: null,
                });

                const out = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    (await call("add_plan_missing_to_groceries"))
                        .structuredContent,
                );
                expect(out.added.map((a) => a.display_name).sort()).toEqual([
                    "Flour",
                    "Pepper",
                ]);
                expect(out.unknown.map((u) => u.display_name)).toEqual([
                    "Flour",
                ]);
                expect(out.unknown[0]!.notice.length).toBeGreaterThan(0);
                const noteOf = (name: string) =>
                    out.added.find((a) => a.display_name === name)!.note;
                expect(noteOf("Flour")).toBe(PLAN_UNKNOWN_LINE_NOTE);
                expect(noteOf("Pepper")).toBe("to taste");
                const stored = await db.groceryStore.listLines("hh-1");
                expect(stored.map((l) => l.note).sort()).toEqual(
                    [PLAN_UNKNOWN_LINE_NOTE, "to taste"].sort(),
                );
            });
        },
    );

    test.each(ERAS)(
        "add_plan_missing_to_groceries with nothing planned adds nothing, and with no store says to add one (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const none = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    (await call("add_plan_missing_to_groceries"))
                        .structuredContent,
                );
                expect(none).toEqual({
                    added: [],
                    on_list: [],
                    unknown: [],
                    skipped: [],
                });
                const { recipeId } = await seedBread(call);
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: utcTodayFromDate(),
                    slot: "dinner",
                });
                expect(
                    await refusal(call, "add_plan_missing_to_groceries", {}),
                ).toMatch(/add a store/i);
            });
        },
    );

    test.each(ERAS)(
        "a household far from UTC plans by its own calendar: from, yesterday refused, today accepted (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            const now = new Date();
            // UTC+14 and UTC-11: at every instant at least one of them is on a
            // different calendar day from UTC.
            const timezone = ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find(
                (zone) => dateInTz(now, zone) !== dateInTz(now, "UTC"),
            )!;
            const householdToday = dateInTz(now, timezone);
            expect(householdToday).not.toBe(utcTodayFromDate());
            db.profile = { ...PROFILE_BASE, timezone };
            try {
                await withHttpClient("u1", era, async (client) => {
                    const call = callerOf(client);
                    const { recipeId } = await seedBread(call);
                    expect(
                        WEEK_PLAN_OUTPUT_SCHEMA.parse(
                            (await call("get_week_plan")).structuredContent,
                        ).from,
                    ).toBe(householdToday);
                    expect(
                        await refusal(call, "plan_recipe", {
                            recipe_id: recipeId,
                            date: addUtcDays(householdToday, -1),
                            slot: "dinner",
                        }),
                    ).toMatch(/today or a later day/i);
                    const planned = await call("plan_recipe", {
                        recipe_id: recipeId,
                        date: householdToday,
                        slot: "dinner",
                    });
                    expect(planned.isError).toBeFalsy();
                    const week = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                        (await call("get_week_plan")).structuredContent,
                    );
                    expect(week.days[0]!.date).toBe(householdToday);
                    expect(week.days[0]!.plans).toHaveLength(1);
                });
            } finally {
                db.profile = null;
            }
        },
    );

    test.each(ERAS)(
        "add_plan_missing_to_groceries takes an optional `from`: a later day adds that window's needs, a past day is refused, and a past plan is never listed (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await addStore();
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const listed = (await client.listTools()).tools.find(
                    (t) => t.name === "add_plan_missing_to_groceries",
                )!;
                expect(
                    Object.keys(listed.inputSchema.properties ?? {}),
                ).toEqual(["from", "food_ids"]);
                const { recipeId, flourId } = await seedBread(call);
                const today = utcTodayFromDate();
                const yesterday = addUtcDays(today, -1);
                // A plan the web would never show: stored for a past day.
                await db.plansStore.addPlan({
                    householdId: "hh-1",
                    recipeId,
                    date: yesterday,
                    slot: "dinner",
                });
                // Today's window does not list it.
                const none = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    (await call("add_plan_missing_to_groceries"))
                        .structuredContent,
                );
                expect(none.added).toEqual([]);
                // A window that starts yesterday is refused.
                expect(
                    await refusal(call, "add_plan_missing_to_groceries", {
                        from: yesterday,
                    }),
                ).toMatch(/pick today or a later day/i);
                expect(
                    await refusal(call, "add_plan_missing_to_groceries", {
                        from: "soon",
                    }),
                ).toMatch(/date/i);
                expect(await db.groceryStore.listLines("hh-1")).toEqual([]);
                // A plan ten days out is outside today's window, inside its own.
                const later = addUtcDays(today, 10);
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: later,
                    slot: "dinner",
                });
                const outsideToday = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    (await call("add_plan_missing_to_groceries"))
                        .structuredContent,
                );
                expect(outsideToday.added).toEqual([]);
                const out = ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                    (
                        await call("add_plan_missing_to_groceries", {
                            from: later,
                        })
                    ).structuredContent,
                );
                expect(out.added).toHaveLength(1);
                expect(out.added[0]).toMatchObject({
                    food_id: flourId,
                    display_name: "Flour",
                });
            });
        },
    );

    test.each(ERAS)(
        "add_plan_missing_to_groceries with food_ids adds only those foods: an empty list or an id that is not missing adds nothing (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await addStore();
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const { recipeId, flourId } = await seedBread(call);
                await call("plan_recipe", {
                    recipe_id: recipeId,
                    date: utcTodayFromDate(),
                    slot: "dinner",
                });
                const none = async (food_ids: string[]) =>
                    ADD_PLAN_MISSING_OUTPUT_SCHEMA.parse(
                        (
                            await call("add_plan_missing_to_groceries", {
                                food_ids,
                            })
                        ).structuredContent,
                    );
                const textOf = async (food_ids: string[]) =>
                    JSON.stringify(
                        (
                            await call("add_plan_missing_to_groceries", {
                                food_ids,
                            })
                        ).content,
                    );
                expect((await none([])).added).toEqual([]);
                expect((await none(["not-a-missing-food"])).added).toEqual([]);
                // An empty list is no choice; an id that is not missing is a
                // choice that matched nothing: each says which.
                expect(await textOf([])).toContain(
                    "No foods were chosen, so nothing was added.",
                );
                expect(await textOf(["not-a-missing-food"])).toContain(
                    "None of those foods is missing for the plan",
                );
                expect(await db.groceryStore.listLines("hh-1")).toEqual([]);
                const out = await none([flourId]);
                expect(out.added).toHaveLength(1);
                expect(out.added[0]).toMatchObject({ food_id: flourId });
                expect(await db.groceryStore.listLines("hh-1")).toHaveLength(1);
            });
        },
    );

    test.each(ERAS)(
        "get_week_plan says the household's today whatever `from` is (%p)",
        async (era) => {
            setFlagsForTests(createMemoryFlags({}));
            await withHttpClient("u1", era, async (client) => {
                const call = callerOf(client);
                const today = utcTodayFromDate();
                const plain = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan")).structuredContent,
                );
                expect(plain.today).toBe(today);
                expect(plain.from).toBe(today);
                const later = addUtcDays(today, 9);
                const week = WEEK_PLAN_OUTPUT_SCHEMA.parse(
                    (await call("get_week_plan", { from: later }))
                        .structuredContent,
                );
                expect(week.from).toBe(later);
                expect(week.today).toBe(today);
            });
        },
    );

    describe("week-plan widget", () => {
        const WEEK_PLAN_V2_URI = widgetUri("week-plan.html");

        test.each(ERAS)(
            "get_week_plan links the week-plan uri, which lists and reads (%p)",
            async (era) => {
                setFlagsForTests(createMemoryFlags({}));
                const assembled = await getWidgetHtml("week-plan");
                await withHttpClient("u1", era, async (client) => {
                    const { tools } = await client.listTools();
                    const week = tools.find((t) => t.name === "get_week_plan");
                    expect(
                        (week?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(WEEK_PLAN_V2_URI);
                    expect(week?._meta?.["openai/outputTemplate"]).toBe(
                        WEEK_PLAN_V2_URI,
                    );
                    // The writes the card calls carry no widget of their own.
                    for (const name of [
                        "unplan_recipe",
                        "add_plan_missing_to_groceries",
                    ]) {
                        expect(
                            tools.find((t) => t.name === name)?._meta?.ui,
                        ).toBeUndefined();
                    }
                    const { resources } = await client.listResources();
                    expect(resources.map((r) => r.uri)).toContain(
                        WEEK_PLAN_V2_URI,
                    );
                    const res = await client.readResource({
                        uri: WEEK_PLAN_V2_URI,
                    });
                    expect((res.contents[0] as { text?: string }).text).toBe(
                        assembled,
                    );
                });
            },
        );
    });
});

describe("get_household_digest", () => {
    const bob = "22222222-2222-4222-8222-222222222222";

    async function withHouseholdDigestClient(
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
        const flags = evaluateViewerFlags(flagCtx, createMemoryFlags({}));
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

    test("returns schema output and respects week_of", async () => {
        db.profile = { ...PROFILE_BASE, timezone: "UTC" };
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
        ];
        await withHouseholdDigestClient(async (call) => {
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
        await withHouseholdDigestClient(async (call) => {
            const r = await call("get_household_digest", {
                week_of: "not-a-date",
            });
            expect(r.isError).toBe(true);
            expect(textOf(r)).toContain("week_of");
        });
    });

    test("impossible calendar week_of is an error", async () => {
        await withHouseholdDigestClient(async (call) => {
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
        await withHouseholdDigestClient(async (call) => {
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
    test.each(ERAS)("lists and returns structuredContent (%p)", async (era) => {
        db.profile = { ...PROFILE_BASE, timezone: "UTC" };
        db.members = [
            {
                householdId: "hh-1",
                userId: "u1",
                role: "owner",
                displayName: "U1",
            },
        ];
        setFlagsForTests(createMemoryFlags({}));
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
    });
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
            setFlagsForTests(createMemoryFlags({}));
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
                    resourceUri: "ui://widget/v2/meal-logged.html",
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
                ).toEqual({ resourceUri: "ui://widget/v2/goal-progress.html" });
                const res = await client.readResource({
                    uri: "ui://widget/v2/meal-logged.html",
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
                    uri: "ui://widget/v2/meal-logged.html",
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

    // Every ui:// resource the server lists: the eight cards above plus the
    // six that were v2-only (component-gallery is dev-only and never listed).
    const ALL_WIDGET_URIS = [
        ...MCP_WIDGET_FILES,
        "attention.html",
        "use-soon.html",
        "recipe-card.html",
        "product-score.html",
        "restock-nudge.html",
        "week-plan.html",
    ]
        .map((f) => widgetUri(f))
        .sort();
    const ATTENTION_V2_URI = widgetUri("attention.html");

    describe("attention widget", () => {
        afterEach(() => resetFlagsForTests());

        test.each(ERAS)(
            "links attention uri, lists and reads the resource (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({}));
                const assembled = await getWidgetHtml("attention");
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
                    const sc0 = LIST_NOTICES_OUTPUT_SCHEMA.parse(
                        empty.structuredContent,
                    );
                    expect(sc0).toEqual({ count: 0, notifications: [] });
                });
            },
        );

        test.each(ERAS)(
            "list_notices output parses with notifications present (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({}));
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
                    const sc = LIST_NOTICES_OUTPUT_SCHEMA.parse(
                        listed.structuredContent,
                    );
                    expect(sc.count).toBe(1);
                    expect(sc.notifications).toHaveLength(1);
                    expect(sc.notifications[0]!.kind).toBe("food_expiring");
                });
            },
        );
    });

    describe("product-score widget", () => {
        afterEach(() => resetFlagsForTests());

        const PRODUCT_SCORE_V2_URI = widgetUri("product-score.html");

        test.each(ERAS)(
            "rate_product links the product-score uri, which lists and reads (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({}));
                const assembled = await getWidgetHtml("product-score");
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const rate = tools.find((t) => t.name === "rate_product");
                    expect(
                        (rate?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(PRODUCT_SCORE_V2_URI);
                    expect(rate?._meta?.["openai/outputTemplate"]).toBe(
                        PRODUCT_SCORE_V2_URI,
                    );
                    const { resources } = await client.listResources();
                    expect(resources.map((r) => r.uri)).toContain(
                        PRODUCT_SCORE_V2_URI,
                    );
                    const res = await client.readResource({
                        uri: PRODUCT_SCORE_V2_URI,
                    });
                    expect((res.contents[0] as { text?: string }).text).toBe(
                        assembled,
                    );
                });
            },
        );
    });

    describe("restock-nudge widget", () => {
        afterEach(() => resetFlagsForTests());

        const RESTOCK_V2_URI = widgetUri("restock-nudge.html");

        test.each(ERAS)(
            "list_usuals links the restock-nudge uri, which lists and reads (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({}));
                const assembled = await getWidgetHtml("restock-nudge");
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const usuals = tools.find((t) => t.name === "list_usuals");
                    expect(
                        (usuals?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(RESTOCK_V2_URI);
                    expect(usuals?._meta?.["openai/outputTemplate"]).toBe(
                        RESTOCK_V2_URI,
                    );
                    const { resources } = await client.listResources();
                    expect(resources.map((r) => r.uri)).toContain(
                        RESTOCK_V2_URI,
                    );
                    const res = await client.readResource({
                        uri: RESTOCK_V2_URI,
                    });
                    expect((res.contents[0] as { text?: string }).text).toBe(
                        assembled,
                    );
                });
            },
        );
    });

    describe("use-soon widget", () => {
        afterEach(() => resetFlagsForTests());

        const USE_SOON_V2_URI = widgetUri("use-soon.html");

        function addDaysUtc(iso: string, delta: number): string {
            const [y, m, d] = iso.split("-").map(Number);
            return new Date(Date.UTC(y!, m! - 1, d! + delta))
                .toISOString()
                .slice(0, 10);
        }

        test.each(ERAS)(
            "links the use-soon uri and lists and reads the resource (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({}));
                const assembled = await getWidgetHtml("use-soon");
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const list = tools.find((t) => t.name === "list_expiring");
                    expect(
                        (list?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(USE_SOON_V2_URI);
                    expect(list?._meta?.["openai/outputTemplate"]).toBe(
                        USE_SOON_V2_URI,
                    );
                    const { resources } = await client.listResources();
                    expect(resources.map((r) => r.uri)).toContain(
                        USE_SOON_V2_URI,
                    );
                    const res = await client.readResource({
                        uri: USE_SOON_V2_URI,
                    });
                    expect((res.contents[0] as { text?: string }).text).toBe(
                        assembled,
                    );
                    const empty = await client.callTool({
                        name: "list_expiring",
                        arguments: {},
                    });
                    expect(
                        LIST_EXPIRING_OUTPUT_SCHEMA.parse(
                            empty.structuredContent,
                        ),
                    ).toEqual({ items: [], featured: null });
                });
            },
        );

        test.each(ERAS)(
            "list_expiring names each item's location, days left and recipe, and the recipe using the most of them; the wording is unchanged and the ids ride at the line ends (%p)",
            async (mode) => {
                await withHttpClient("u1", mode, async (client) => {
                    const call = async (
                        name: string,
                        args: Record<string, unknown>,
                    ) =>
                        (await client.callTool({
                            name,
                            arguments: args,
                        })) as {
                            structuredContent: Record<string, unknown>;
                            content: { text: string }[];
                        };
                    const food = async (name: string) =>
                        (
                            await call("upsert_food", {
                                name,
                                calories: 100,
                                protein_g: 10,
                                carbs_g: 20,
                                fat_g: 5,
                            })
                        ).structuredContent.id as string;
                    const salmon = await food("Salmon");
                    const rice = await food("Rice");
                    const kale = await food("Kale");
                    const loc = await call("add_fridge_location", {
                        name: "Fridge",
                    });
                    const locationId = loc.structuredContent.id as string;
                    const today = utcTodayFromDate();
                    const dated = new Map<string, number>();
                    for (const [foodId, days] of [
                        [salmon, 1],
                        [rice, 2],
                        [kale, 30],
                    ] as const) {
                        const added = await call("add_fridge_item", {
                            location_id: locationId,
                            kind: "food",
                            food_id: foodId,
                            amount: 500,
                            unit: "g",
                        });
                        const id = added.structuredContent.id as string;
                        const row = (
                            await db.fridgeStore.listItems("hh-1")
                        ).find((r) => r.id === id)!;
                        await db.fridgeStore.updateItem({
                            ...row,
                            expiresOn: addDaysUtc(today, days),
                        });
                        dated.set(foodId, days);
                    }
                    const recipe = await call("create_recipe", {
                        name: "Salmon rice",
                        yield_portions: 2,
                        prep_minutes: 10,
                        cook_minutes: 15,
                    });
                    const recipeId = recipe.structuredContent.id as string;
                    for (const foodId of [salmon, rice]) {
                        await call("add_recipe_ingredient", {
                            recipe_id: recipeId,
                            food_id: foodId,
                            amount: 200,
                            unit: "g",
                        });
                    }

                    const listed = await call("list_expiring", { days: 3 });
                    const parsed = LIST_EXPIRING_OUTPUT_SCHEMA.parse(
                        listed.structuredContent,
                    );
                    expect(parsed.items.map((i) => i.display_name)).toEqual([
                        "Salmon",
                        "Rice",
                    ]);
                    expect(parsed.items.map((i) => i.days_left)).toEqual([
                        1, 2,
                    ]);
                    expect(parsed.items.map((i) => i.location)).toEqual([
                        "Fridge",
                        "Fridge",
                    ]);
                    for (const item of parsed.items) {
                        expect(item.recipe).toEqual({
                            id: recipeId,
                            name: "Salmon rice",
                        });
                    }
                    // 200 g salmon + 200 g rice over 2 portions: 100 g of each.
                    expect(parsed.featured).toEqual({
                        id: recipeId,
                        name: "Salmon rice",
                        uses: 2,
                        minutes: 25,
                        calories: 200,
                        protein_g: 20,
                        carbs_g: 40,
                        fat_g: 10,
                    });
                    expect(
                        stripIdTags(listed.content[0]!.text).split("\n"),
                    ).toEqual([
                        ...parsed.items.map((item) =>
                            fridgeExpiryLine({
                                name: item.display_name,
                                amount: item.amount,
                                unit: item.unit,
                                expiresOn: item.expires_on,
                            }),
                        ),
                        `Best use: ${parsed.featured!.name}`,
                    ]);
                });
            },
        );

        test.each(ERAS)(
            "list_expiring gives an item no recipe uses recipe null and no featured recipe when only one item is used (%p)",
            async (mode) => {
                await withHttpClient("u1", mode, async (client) => {
                    const loc = await client.callTool({
                        name: "add_fridge_location",
                        arguments: { name: "Fridge" },
                    });
                    const added = await client.callTool({
                        name: "add_fridge_item",
                        arguments: {
                            location_id: (
                                loc.structuredContent as { id: string }
                            ).id,
                            kind: "food",
                            name: "Lonely yogurt",
                            amount: 1,
                            unit: "g",
                        },
                    });
                    const id = (added.structuredContent as { id: string }).id;
                    const row = (await db.fridgeStore.listItems("hh-1")).find(
                        (r) => r.id === id,
                    )!;
                    await db.fridgeStore.updateItem({
                        ...row,
                        expiresOn: addDaysUtc(utcTodayFromDate(), -1),
                    });
                    const listed = await client.callTool({
                        name: "list_expiring",
                        arguments: {},
                    });
                    const parsed = LIST_EXPIRING_OUTPUT_SCHEMA.parse(
                        listed.structuredContent,
                    );
                    expect(parsed.items).toHaveLength(1);
                    expect(parsed.items[0]).toMatchObject({
                        display_name: "Lonely yogurt",
                        days_left: -1,
                        location: "Fridge",
                        recipe: null,
                    });
                    expect(parsed.featured).toBeNull();
                });
            },
        );
    });

    describe("recipe mention warnings", () => {
        const STEPS = "Fry the rice.\nScramble 2 eggs into it and serve.";

        function caller(client: {
            callTool: (a: {
                name: string;
                arguments: Record<string, unknown>;
            }) => Promise<unknown>;
        }) {
            return async (name: string, args: Record<string, unknown>) =>
                (await client.callTool({
                    name,
                    arguments: args,
                })) as ToolResult;
        }

        test.each(ERAS)(
            "an import names the food its steps miss, get_recipe and verify_recipe repeat it, and adding it clears it (%p)",
            async (mode) => {
                const {
                    IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA,
                    VERIFY_RECIPE_OUTPUT_SCHEMA,
                } = await import("./mcp/tools/recipes.js");
                await withHttpClient("u1", mode, async (client) => {
                    const call = caller(client);
                    const imported = await call("import_recipe_from_text", {
                        text: "caption",
                        instructions: STEPS,
                        name: "Fried rice",
                        ingredients: [{ name: "rice", amount: 200, unit: "g" }],
                    });
                    expect(imported.isError).toBeFalsy();
                    const importBody =
                        IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA.parse(
                            imported.structuredContent,
                        );
                    // A complete import is a draft, ready to save.
                    expect(importBody.verification).toBe("unverified");
                    expect(importBody).toMatchObject({
                        draft: true,
                        ready_to_save: true,
                    });
                    expect(importBody.draft_expires_at).not.toBeNull();
                    expect(textOf(imported)).toContain("save_recipe");
                    expect(
                        importBody.mention_warnings.map((w) => w.key),
                    ).toEqual(["egg"]);
                    expect(importBody.mention_warnings[0]).toMatchObject({
                        food: "egg",
                        food_id: null,
                        amount: 2,
                    });
                    expect(textOf(imported)).toContain(
                        "The steps mention egg, which isn't an ingredient.",
                    );
                    expect(textOf(imported)).toContain("add_recipe_ingredient");
                    const recipeId = importBody.recipe!.id;

                    const got = await call("get_recipe", { id: recipeId });
                    const body = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        got.structuredContent,
                    );
                    expect(body.mention_warnings.map((w) => w.key)).toEqual([
                        "egg",
                    ]);
                    // A warning never changes verification.
                    expect(body.verification).toBe("unverified");
                    expect(body.ready_to_save).toBe(true);
                    expect(body.problems).toEqual([]);
                    expect(textOf(got)).toContain(
                        "The steps mention egg, which isn't an ingredient.",
                    );

                    const checked = await call("verify_recipe", {
                        recipe_id: recipeId,
                    });
                    const checkedBody = VERIFY_RECIPE_OUTPUT_SCHEMA.parse(
                        checked.structuredContent,
                    );
                    expect(checkedBody.status).toBe("unverified");
                    expect(checkedBody.ready_to_save).toBe(true);
                    expect(
                        checkedBody.mention_warnings.map((w) => w.key),
                    ).toEqual(["egg"]);
                    expect(textOf(checked)).toContain("passed the check");
                    expect(textOf(checked)).toContain("mention egg");

                    // Save is the one promotion, on either era.
                    const saved = await call("save_recipe", {
                        recipe_id: recipeId,
                    });
                    expect(saved.isError).toBeFalsy();
                    expect(saved.structuredContent).toMatchObject({
                        status: "saved",
                        verification: "verified",
                    });
                    const savedBody = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        (await call("get_recipe", { id: recipeId }))
                            .structuredContent,
                    );
                    expect(savedBody).toMatchObject({
                        verification: "verified",
                        draft: false,
                        draft_expires_at: null,
                    });

                    const added = await call("add_recipe_ingredient", {
                        recipe_id: recipeId,
                        name: "egg",
                        amount: 2,
                        unit: "each",
                    });
                    expect(added.isError).toBeFalsy();
                    const after = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        (await call("get_recipe", { id: recipeId }))
                            .structuredContent,
                    );
                    expect(after.mention_warnings).toEqual([]);
                });
            },
        );

        test.each(ERAS)(
            "a failing warning lookup never turns a saved import or a read into an error (%p)",
            async (mode) => {
                const {
                    IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA,
                    VERIFY_RECIPE_OUTPUT_SCHEMA,
                } = await import("./mcp/tools/recipes.js");
                const logged = spyOn(console, "error").mockImplementation(
                    () => {},
                );
                const original = db.foodsStore.listAllAliases;
                try {
                    await withHttpClient("u1", mode, async (client) => {
                        const call = caller(client);
                        // Only the lookup that finds the warnings breaks (the
                        // import itself reads aliases too and must keep working).
                        db.foodsStore.listAllAliases = async (...args) => {
                            if (
                                new Error().stack?.includes("mentionVocabulary")
                            ) {
                                throw new Error("aliases are down");
                            }
                            return original.apply(db.foodsStore, args);
                        };
                        const imported = await call("import_recipe_from_text", {
                            text: "caption",
                            instructions: STEPS,
                            name: "Fried rice",
                            ingredients: [
                                { name: "rice", amount: 200, unit: "g" },
                            ],
                        });
                        expect(imported.isError).toBeFalsy();
                        const importBody =
                            IMPORT_RECIPE_FROM_TEXT_OUTPUT_SCHEMA.parse(
                                imported.structuredContent,
                            );
                        expect(importBody.recipe).not.toBeNull();
                        expect(importBody.mention_warnings).toEqual([]);
                        const recipeId = importBody.recipe!.id;

                        const got = await call("get_recipe", { id: recipeId });
                        expect(got.isError).toBeFalsy();
                        expect(
                            GET_RECIPE_OUTPUT_SCHEMA.parse(
                                got.structuredContent,
                            ).mention_warnings,
                        ).toEqual([]);

                        const checked = await call("verify_recipe", {
                            recipe_id: recipeId,
                        });
                        expect(checked.isError).toBeFalsy();
                        const checkedBody = VERIFY_RECIPE_OUTPUT_SCHEMA.parse(
                            checked.structuredContent,
                        );
                        expect(checkedBody.status).toBe("unverified");
                        expect(checkedBody.mention_warnings).toEqual([]);
                        expect(logged).toHaveBeenCalled();

                        // Healthy again, the warning is back.
                        db.foodsStore.listAllAliases = original;
                        const back = GET_RECIPE_OUTPUT_SCHEMA.parse(
                            (await call("get_recipe", { id: recipeId }))
                                .structuredContent,
                        );
                        expect(back.mention_warnings.map((w) => w.key)).toEqual(
                            ["egg"],
                        );
                    });
                } finally {
                    db.foodsStore.listAllAliases = original;
                    logged.mockRestore();
                }
            },
        );

        test.each(ERAS)(
            "a hand-made recipe always has an empty mention_warnings (%p)",
            async (mode) => {
                await withHttpClient("u1", mode, async (client) => {
                    const call = caller(client);
                    const made = await call("create_recipe", {
                        name: "Hand made",
                        yield_portions: 2,
                        instructions: STEPS,
                    });
                    const got = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        (
                            await call("get_recipe", {
                                id: made.structuredContent?.id as string,
                            })
                        ).structuredContent,
                    );
                    expect(got.mention_warnings).toEqual([]);
                });
            },
        );

        test.each(ERAS)(
            "import_recipe_from_url lists the egg a Pad See Ew page's steps use (%p)",
            async (mode) => {
                const { IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA } =
                    await import("./mcp/tools/recipes.js");
                const { join } = await import("node:path");
                const page = await Bun.file(
                    join(
                        import.meta.dir,
                        "domain/fixtures/recipe-pages/pad-see-ew.html",
                    ),
                ).text();
                db.recipeImportFetcher = {
                    async robotsAllows() {
                        return true;
                    },
                    async fetchPage() {
                        return {
                            ok: true as const,
                            url: "https://example.com/pad-see-ew",
                            status: 200,
                            contentType: "text/html",
                            body: page,
                        };
                    },
                };
                await withHttpClient("u1", mode, async (client) => {
                    const call = caller(client);
                    const imported = await call("import_recipe_from_url", {
                        url: "https://example.com/pad-see-ew",
                    });
                    expect(imported.isError).toBeFalsy();
                    const body = IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                        imported.structuredContent,
                    );
                    expect(body.mention_warnings.map((w) => w.key)).toEqual([
                        "egg",
                    ]);
                    expect(textOf(imported)).toContain(
                        "The steps mention egg, which isn't an ingredient.",
                    );
                });
            },
        );

        test.each(ERAS)(
            "a duplicate import still lists the existing recipe's warnings (%p)",
            async (mode) => {
                const { IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA } =
                    await import("./mcp/tools/recipes.js");
                const { join } = await import("node:path");
                const page = await Bun.file(
                    join(
                        import.meta.dir,
                        "domain/fixtures/recipe-pages/pad-see-ew.html",
                    ),
                ).text();
                db.recipeImportFetcher = {
                    async robotsAllows() {
                        return true;
                    },
                    async fetchPage() {
                        return {
                            ok: true as const,
                            url: "https://example.com/pad-see-ew-again",
                            status: 200,
                            contentType: "text/html",
                            body: page,
                        };
                    },
                };
                await withHttpClient("u1", mode, async (client) => {
                    const call = caller(client);
                    const args = {
                        url: "https://example.com/pad-see-ew-again",
                    };
                    const first = IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                        (await call("import_recipe_from_url", args))
                            .structuredContent,
                    );
                    expect(first.mention_warnings.map((w) => w.key)).toEqual([
                        "egg",
                    ]);
                    const again = await call("import_recipe_from_url", args);
                    expect(again.isError).toBeFalsy();
                    const body = IMPORT_RECIPE_FROM_URL_OUTPUT_SCHEMA.parse(
                        again.structuredContent,
                    );
                    expect(body.status).toBe("duplicate");
                    expect(body.recipe_id).toBe(first.recipe_id);
                    expect(body.mention_warnings.map((w) => w.key)).toEqual([
                        "egg",
                    ]);
                    expect(textOf(again)).toContain(
                        "The steps mention egg, which isn't an ingredient.",
                    );
                });
            },
        );
    });

    describe("recipe-card widget", () => {
        afterEach(() => resetFlagsForTests());

        const RECIPE_CARD_V2_URI = widgetUri("recipe-card.html");

        async function stockedRecipe(client: {
            callTool: (a: {
                name: string;
                arguments: Record<string, unknown>;
            }) => Promise<unknown>;
        }) {
            const call = async (name: string, args: Record<string, unknown>) =>
                (await client.callTool({
                    name,
                    arguments: args,
                })) as ToolResult;
            const loc = await call("add_fridge_location", { name: "Pantry" });
            const recipe = await call("create_recipe", {
                name: "Rice bowl",
                yield_portions: 2,
            });
            const recipeId = recipe.structuredContent?.id as string;
            const food = await call("upsert_food", { name: "Rice" });
            const foodId = food.structuredContent?.id as string;
            await call("add_recipe_ingredient", {
                recipe_id: recipeId,
                food_id: foodId,
                amount: 100,
                unit: "g",
            });
            await call("add_fridge_item", {
                location_id: loc.structuredContent?.id as string,
                kind: "food",
                food_id: foodId,
                amount: 500,
                unit: "g",
            });
            return { call, recipeId };
        }

        test.each(ERAS)(
            "links the recipe-card uri and lists and reads the resource (%p)",
            async (mode) => {
                setFlagsForTests(createMemoryFlags({}));
                const assembled = await getWidgetHtml("recipe-card");
                await withHttpClient("u1", mode, async (client) => {
                    const { tools } = await client.listTools();
                    const tool = tools.find((t) => t.name === "get_recipe");
                    expect(
                        (tool?._meta?.ui as { resourceUri?: string })
                            ?.resourceUri,
                    ).toBe(RECIPE_CARD_V2_URI);
                    expect(tool?._meta?.["openai/outputTemplate"]).toBe(
                        RECIPE_CARD_V2_URI,
                    );
                    const { resources } = await client.listResources();
                    expect(resources.map((r) => r.uri)).toContain(
                        RECIPE_CARD_V2_URI,
                    );
                    const res = await client.readResource({
                        uri: RECIPE_CARD_V2_URI,
                    });
                    expect((res.contents[0] as { text?: string }).text).toBe(
                        assembled,
                    );
                    const { call, recipeId } = await stockedRecipe(client);
                    const got = await call("get_recipe", { id: recipeId });
                    const body = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        got.structuredContent,
                    );
                    expect(body.cook_preview?.cookable).toBe(true);
                });
            },
        );

        test.each(ERAS)(
            "get_recipe suggests the meal slot from the viewer's timezone (%p)",
            async (mode) => {
                await withHttpClient("u1", mode, async (client) => {
                    const { call, recipeId } = await stockedRecipe(client);
                    // UTC fallback when no timezone is saved.
                    const before = [guessMealType("UTC")];
                    const bare = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        (await call("get_recipe", { id: recipeId }))
                            .structuredContent,
                    );
                    before.push(guessMealType("UTC"));
                    expect(before).toContain(bare.suggested_meal_type);
                    const tz = "Pacific/Auckland";
                    const set = await call("set_timezone", { timezone: tz });
                    expect(set.isError).toBeFalsy();
                    const slots = [guessMealType(tz)];
                    const zoned = GET_RECIPE_OUTPUT_SCHEMA.parse(
                        (await call("get_recipe", { id: recipeId }))
                            .structuredContent,
                    );
                    slots.push(guessMealType(tz));
                    expect(slots).toContain(zoned.suggested_meal_type);
                });
            },
        );

        test.each(ERAS)(
            "the card's Confirm arguments are valid: cook_recipe with total_portions, then log_recipe_portion with one portion (%p)",
            async (mode) => {
                await withHttpClient("u1", mode, async (client) => {
                    const { call, recipeId } = await stockedRecipe(client);
                    const cooked = await call("cook_recipe", {
                        recipe_id: recipeId,
                        total_portions: 3,
                    });
                    expect(cooked.isError).toBeFalsy();
                    expect(cooked.structuredContent).toMatchObject({
                        total_portions: 3,
                        shortfalls: [],
                        meal_ids: [],
                        unmeasured: [],
                    });
                    const logged = await call("log_recipe_portion", {
                        recipe_id: recipeId,
                        portions: 1,
                    });
                    expect(logged.isError).toBeFalsy();
                    expect(logged.structuredContent).toMatchObject({
                        action: "logged",
                    });
                });
            },
        );
    });

    describe("widget URIs", () => {
        test.each(ERAS)(
            "tools link the v2 URIs and every widget is listed once (%p)",
            async (mode) => {
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
                    expect(MEAL_LOGGED_WIDGET_URI).toBe(
                        "ui://widget/v2/meal-logged.html",
                    );

                    const { resources } = await client.listResources();
                    const widgetUris = resources
                        .map((r) => r.uri)
                        .filter((u) => u.startsWith("ui://widget/"))
                        .sort();
                    expect(widgetUris).toEqual(ALL_WIDGET_URIS);
                    // The retired v1 URIs are gone, not served alongside.
                    expect(
                        widgetUris.every((u) =>
                            u.startsWith("ui://widget/v2/"),
                        ),
                    ).toBe(true);
                    await expect(
                        client.readResource({
                            uri: "ui://widget/meal-logged.html",
                        }),
                    ).rejects.toThrow();
                });
            },
        );

        test.each(ERAS)(
            "the grocery-list and fridge cards read as their assembly (%p)",
            async (mode) => {
                for (const key of ["grocery-list", "fridge"] as const) {
                    const assembled = await getWidgetHtml(key);
                    const uri = widgetUri(`${key}.html`);
                    await withHttpClient("u1", mode, async (client) => {
                        const res = await client.readResource({ uri });
                        const c = res.contents[0] as {
                            mimeType?: string;
                            text?: string;
                        };
                        expect(c.mimeType).toBe("text/html;profile=mcp-app");
                        expect(c.text).toBe(assembled);
                    });
                }
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

describe("log_meal with a per-100 ml food over HTTP", () => {
    // As OFF hands over a liquid: per 100 ml, no density, default unit grams.
    async function halfAndHalf() {
        const created = await findOrCreateManualFood(
            db.foodsStore,
            "hh-1",
            "food",
            "Half & Half",
        );
        const food = await updateFood(db.foodsStore, "hh-1", created.id, {
            calories: 130,
            fatG: 11,
        });
        return (await db.foodsStore.updateFoodRow({
            ...food,
            nutritionBasis: "100ml",
        }))!;
    }

    test.each(ERAS)(
        "an amount with no unit is millilitres and logs the calories (%p)",
        async (mode) => {
            const food = await halfAndHalf();
            await withHttpClient("u1", mode, async (client) => {
                const r = (await client.callTool({
                    name: "log_meal",
                    arguments: {
                        description: "Coffee",
                        meal_type: "breakfast",
                        items: [{ food_id: food.id, amount: 30 }],
                    },
                })) as ToolResult;
                expect(r.isError).toBeFalsy();
                expect(textOf(r)).not.toContain("Nutrition unknown");
            });
            expect(db.inserted[0]!.calories).toBe(39);
            const items = db.inserted[0]!.items as Record<string, unknown>[];
            expect(items[0]).toMatchObject({
                unit: "ml",
                amount: 30,
                calories: 39,
            });
        },
    );

    test.each(ERAS)(
        "grams with no density stay unknown and the text says to log it in ml (%p)",
        async (mode) => {
            const food = await halfAndHalf();
            await withHttpClient("u1", mode, async (client) => {
                const r = (await client.callTool({
                    name: "log_meal",
                    arguments: {
                        description: "Coffee",
                        meal_type: "breakfast",
                        items: [{ food_id: food.id, amount: 30, unit: "g" }],
                    },
                })) as ToolResult;
                expect(r.isError).toBeFalsy();
                expect(textOf(r)).toContain(
                    "Nutrition unknown for: Half & Half (a per-100 ml food: log it in ml",
                );
            });
            expect(db.inserted[0]!.calories).toBeUndefined();
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
                { resourceUri: "ui://widget/v2/meal-logged.html" },
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
        expect(html).toContain('class="fd-recipes-page"');
        expect(html).toContain("vm.tiktok.com/ZM123");
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
        expect(html).toContain('aria-label="Paste recipe"');
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
        const home = await siteApp.request("http://x/settings/household", {
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
        // A member is refused with Not allowed and a way back, not told they
        // have no household.
        const html = await r.text();
        expect(html).toContain("Not allowed");
        expect(html).toContain('href="/"');
        expect(html).not.toContain("No household yet");
        expect(html).not.toContain("/logout");
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
        // The token is for this response only.
        expect(r.headers.get("cache-control")).toBe("no-store");
        const html = await r.text();
        expect(html).toContain('data-fd-settings-page="household"');
        expect(html).toContain(
            '<h1 class="fd-detail-bar__title">Household token</h1>',
        );
        expect(html).toContain("Shown only now");
        expect(html).toContain(HOUSEHOLD_TOKEN_PREFIX);
        const shown = html.match(
            new RegExp(`<code[^>]*>(${HOUSEHOLD_TOKEN_PREFIX}[^<]+)</code>`),
        )?.[1];
        expect(shown).toBeDefined();
        expect(html.split(shown!)).toHaveLength(2);
        // Shown once: the next visit to the page does not carry it.
        const again = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(alice) },
        });
        const againHtml = await again.text();
        expect(againHtml).not.toContain("Shown only now");
        expect(againHtml).not.toContain(shown!);
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

    test("a manager-only page refuses a member with Not allowed and a way back", async () => {
        const r = await siteApp.request(
            "http://x/settings/household/stores/add",
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(bob),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "name=Safeway",
            },
        );
        expect(r.status).toBe(403);
        expect(await db.settingsStore.listStores("hh-1")).toEqual([]);
        const html = await r.text();
        expect(html).toContain("Not allowed");
        expect(html).toContain(
            '<a class="fd-btn fd-btn--primary" data-fd-btn href="/">',
        );
        expect(html).not.toContain("No household yet");
        expect(html).not.toContain("/logout");
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
        expect(await r.text()).toContain("Confirm removing Bob in the sheet.");
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
            /<dialog class="fd-sheet[^"]*" id="fd-household-add-member"[^>]*data-sheet-open-on-load/,
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
        expect(html).toContain(
            '<a class="fd-kitchen-tab" href="/kitchen/fridge" aria-current="page">Fridge</a>',
        );
        expect(html).toContain(
            "Add a place in Settings, then add items with the button above.",
        );
        expect(html).not.toContain("Coming soon.");
        expect(html).not.toContain('class="facts"');
    });

    test("POST /kitchen/fridge/items adds a supply with the entered unit", async () => {
        const locationId = (await addLocation(db.fridgeStore, "hh-1", "Pantry"))
            .id;
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
        const locationId = (await addLocation(db.fridgeStore, "hh-1", "Fridge"))
            .id;
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
        const fridge = await addLocation(db.fridgeStore, "hh-1", "Fridge");
        const pantry = await addLocation(db.fridgeStore, "hh-1", "Pantry");
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
        expect(html).toContain('class="fd-settings-error"');
        expect(html).toContain("That item is no longer in the fridge.");
        expect(
            html.match(/That item is no longer in the fridge\./g)?.length,
        ).toBe(1);
        expect(html).not.toContain("Fridge item updated");
        expect(html).not.toMatch(/data-modal-open-on-load/);
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
        expect(html).toContain('class="fd-settings-error"');
        expect(html).toContain("That item is no longer in the fridge.");
        expect(
            html.match(/That item is no longer in the fridge\./g)?.length,
        ).toBe(1);
        expect(html).not.toContain("Removed from the fridge");
        expect(html).not.toMatch(/data-modal-open-on-load/);
        expect(await db.fridgeStore.listItems("hh-1")).toEqual([]);
        expect(await db.stockStore.listMovements("hh-1")).toEqual([]);
    });

    test("GET /kitchen/fridge is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/kitchen/fridge", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("No household yet");
        expect(html).not.toContain("<h1>Fridge</h1>");
    });

    test("GET /kitchen/groceries lists by store and GET /recipes is the cookbook", async () => {
        const grocery = await siteApp.request("http://x/kitchen/groceries", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(grocery.status).toBe(200);
        const groceryHtml = await grocery.text();
        expect(groceryHtml).toContain(
            '<a class="fd-kitchen-tab" href="/kitchen/groceries" aria-current="page">',
        );
        expect(groceryHtml).toContain("Nothing on the list yet");
        expect(groceryHtml).not.toContain("Coming soon.");

        const recipes = await siteApp.request("http://x/recipes", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(recipes.status).toBe(200);
        const recipesHtml = await recipes.text();
        expect(recipesHtml).toContain(
            '<h1 class="fd-page-header__title">Recipes</h1>',
        );
        expect(recipesHtml).not.toContain("Coming soon.");
        expect(recipesHtml).toContain("0 saved");
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
        const recipeId = importedRecipeId(second);
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
        expect(badLink.headers.get("set-cookie")).toBeNull();
        const badHtml = await badLink.text();
        expect(badHtml).toContain("Keep this caption");
        expect(badHtml).toContain('name="text_origin" value="shared"');
        expect(badHtml).toContain("That doesn't look like a web link.");
    });

    test("POST /recipes/import of text with no steps lands as a draft that Save refuses in place, listing what is left", async () => {
        db.recipeImportFetcher = {
            async robotsAllows() {
                return true;
            },
            async fetchPage() {
                throw new Error("fetch should not run for pasted text");
            },
        };
        const post = (path: string, body: string) =>
            siteApp.request(`http://x${path}`, {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body,
            });
        const imported = await post(
            "/recipes/import",
            new URLSearchParams({
                import_step: "paste",
                text_only: "1",
                text: "Plain pancakes\n\nIngredients\n- 2 cups flour\n- 1 cup milk\n- 2 eggs\n",
            }).toString(),
        );
        expect(imported.status).toBe(303);
        const recipeId = importedRecipeId(imported);
        const draft = await db.recipesStore.getRecipe("hh-1", recipeId);
        expect(draft?.verification).toBe("unverified");
        expect(draft?.draftExpiresAt).not.toBeNull();
        const refused = await post(`/recipes/${recipeId}/save`, "");
        expect(refused.status).toBe(422);
        expect(refused.headers.get("set-cookie")).toBeNull();
        const html = await refused.text();
        expect(html).toContain("Not saved yet.");
        expect(html).toContain('id="fd-recipe-draft"');
        expect(html).toContain(`action="/recipes/${recipeId}/save"`);
        expect(
            (await db.recipesStore.getRecipe("hh-1", recipeId))?.verification,
        ).toBe("unverified");
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
        // An import that did not work says why inline, never as a toast.
        expect(pasteNeeded.headers.get("set-cookie")).toBeNull();
        const pasteHtml = await pasteNeeded.text();
        expect(pasteHtml).toContain("Paste the Instagram caption below.");
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
        // The recipe page shows what came in: no toast.
        expect(imported.headers.get("set-cookie")).toBeNull();
        const recipeId = importedRecipeId(imported);
        expect(recipeId.length).toBeGreaterThan(0);
        // It lands as a draft with a 7-day expiry, on a page that offers
        // Save, and stays out of the recipe list until it is saved.
        const draft = await db.recipesStore.getRecipe("hh-1", recipeId);
        expect(draft?.verification).toBe("unverified");
        expect(draft?.draftExpiresAt).not.toBeNull();
        expect(
            (await db.recipesStore.listRecipes("hh-1")).map((r) => r.id),
        ).not.toContain(recipeId);
        // The importer's first landing, the address the import answered with.
        const draftPage = await siteApp.request(
            `http://x/recipes/${recipeId}?imported=1`,
            { headers: { cookie: cookieFor(alice) } },
        );
        const draftHtml = await draftPage.text();
        expect(draftHtml).toContain(`action="/recipes/${recipeId}/save"`);
        expect(draftHtml).not.toContain('id="fd-recipe-cook-sheet"');
        // It stays a draft until Save, which passes the check here (the
        // caption has its ingredients and steps) and answers 303, no toast.
        expect(draftHtml).toContain('id="fd-recipe-leave-sheet"');
        // A later visit (Recipes › Drafts) is not that landing: no guard.
        const laterPage = await siteApp.request(
            `http://x/recipes/${recipeId}`,
            { headers: { cookie: cookieFor(alice) } },
        );
        expect(await laterPage.text()).not.toContain(
            'id="fd-recipe-leave-sheet"',
        );
        const saved = await siteApp.request(
            `http://x/recipes/${recipeId}/save`,
            {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "",
            },
        );
        expect(saved.status).toBe(303);
        expect(saved.headers.get("location")).toBe(`/recipes/${recipeId}`);
        expect(saved.headers.get("set-cookie")).toBeNull();
        const afterSave = await db.recipesStore.getRecipe("hh-1", recipeId);
        expect(afterSave?.verification).toBe("verified");
        expect(afterSave?.draftExpiresAt).toBeNull();

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
        const pinRecipeId = importedRecipeId(pinSite);
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
        const fallbackId = importedRecipeId(pinFallback);
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
        expect(pinGone.headers.get("set-cookie")).toBeNull();
        const pinGoneHtml = await pinGone.text();
        expect(pinGoneHtml).toContain("That page doesn't exist anymore.");
        expect(pinGoneHtml).toContain('value="Kept Chef"');
        expect(pinGoneHtml).toContain(">Recipe website</span>");

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

    test("POST /recipes/:id/delete: a member is refused, the owner deletes a member's recipe", async () => {
        const { id: recipeId } = await createRecipe(db.recipesStore, {
            householdId: "hh-1",
            creatorId: alice,
            name: "Mac",
            yieldPortions: 4,
        });
        await addRecipeManualIngredient(db.recipesStore, db.foodsStore, {
            householdId: "hh-1",
            recipeId,
            name: "Pasta",
            amount: 400,
            unit: "",
        });
        const detail = await siteApp.request(`http://x/recipes/${recipeId}`, {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await detail.text();
        expect(html).toContain("Pasta");
        expect(html).toContain("400 g");
        // No figures for it yet: dashes, and the why is a warning icon on the
        // ingredient (no list of reasons under the tiles).
        expect(html).not.toContain("fd-recipe-caption--warn");
        expect(html).toContain("fd-icon--warning");
        expect(html).toContain("no nutrition");

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

        const { id: bobId } = await createRecipe(db.recipesStore, {
            householdId: "hh-1",
            creatorId: bob,
            name: "Salad",
            yieldPortions: 1,
        });
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

    test("the retired forms with no page behind them answer 404 and write nothing", async () => {
        const recipeId = (
            await createRecipe(db.recipesStore, {
                householdId: "hh-1",
                creatorId: alice,
                name: "Retired forms",
                yieldPortions: 2,
            })
        ).id;
        for (const path of [
            "/kitchen/fridge/locations",
            "/kitchen/fridge/locations/loc-1/delete",
            "/settings/household/sections/sec-1",
            "/settings/household/stores/store-1/rules",
            "/recipes",
            `/recipes/${recipeId}`,
            `/recipes/${recipeId}/instructions`,
            // `/recipes/:id/ingredients` is the Add ingredient sheet's route
            // now; an id that is no ingredient's is still not found.
            `/recipes/${recipeId}/ingredients/ing-1`,
            `/recipes/${recipeId}/ingredients/ing-1/delete`,
            `/recipes/${recipeId}/ingredients/ing-1/move`,
            `/recipes/${recipeId}/portions`,
            `/recipes/${recipeId}/log-portion`,
            `/recipes/${recipeId}/cook`,
            `/recipes/${recipeId}/add-to-grocery`,
            `/recipes/${recipeId}/unresolved`,
            `/recipes/${recipeId}/verify`,
        ]) {
            const res = await siteApp.request(`http://x${path}`, {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: "name=Pantry&yield_portions=3&portions=1",
            });
            expect(res.status, path).toBe(404);
        }
        expect(await db.fridgeStore.listLocations("hh-1")).toHaveLength(0);
        const recipes = await db.recipesStore.listRecipes("hh-1");
        expect(recipes.map((row) => row.name)).toEqual(["Retired forms"]);
    });

    test("GET /recipes is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/recipes", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("No household yet");
        expect(html).not.toContain("<h1>Recipes</h1>");
    });

    test("POST cook/confirm redirects when recipe is unverified", async () => {
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
        for (const extra of ["", "&log_serving=1"]) {
            const res = await siteApp.request(
                `http://x/recipes/${imported.recipe.id}/cook/confirm`,
                {
                    method: "POST",
                    headers: {
                        cookie: cookieFor(alice),
                        "content-type": "application/x-www-form-urlencoded",
                    },
                    body: `servings=1&meal_type=dinner${extra}`,
                },
            );
            expect(res.status).toBe(303);
            expect(res.headers.get("location")).toBe(
                `/recipes/${imported.recipe.id}`,
            );
            expect(res.headers.get("set-cookie") ?? "").toContain(
                "foodable_toast",
            );
        }
    });

    test("POST /recipes/:id/variant and /variant/clear change only the signed-in person's own version", async () => {
        const recipe = await createRecipe(db.recipesStore, {
            householdId: "hh-1",
            creatorId: alice,
            name: "Mac",
            yieldPortions: 4,
        });
        const cheese = await addRecipeManualIngredient(
            db.recipesStore,
            db.foodsStore,
            {
                householdId: "hh-1",
                recipeId: recipe.id,
                name: "Cheese",
                amount: 200,
                unit: "g",
            },
        );
        const post = (who: string, path: string, body: string) =>
            siteApp.request(`http://x/recipes/${recipe.id}${path}`, {
                method: "POST",
                headers: {
                    cookie: cookieFor(who),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body,
            });
        const rows = () => db.variantsStore.listOverrides("hh-1", recipe.id);

        // A form that names another person does not reach them.
        const set = await post(
            bob,
            "/variant",
            `action=amount&ingredient_id=${cheese.id}&amount=50&unit=g&user_id=${alice}&member_id=${alice}`,
        );
        expect(set.status).toBe(303);
        expect(set.headers.get("location")).toBe(`/recipes/${recipe.id}`);
        expect((await rows()).map((row) => [row.userId, row.amount])).toEqual([
            [bob, 50],
        ]);
        // The base recipe is as it was.
        expect(
            (await db.recipesStore.listIngredients("hh-1", recipe.id))[0]
                ?.quantity,
        ).toEqual({ amount: 200, unit: "g" });

        const bad = await post(bob, "/variant", "action=teleport");
        expect(bad.status).toBe(400);
        expect(await bad.text()).toContain("Pick what to change");
        const unknown = await post(
            bob,
            "/variant",
            "action=remove&ingredient_id=nope",
        );
        expect(unknown.status).toBe(400);
        expect(await rows()).toHaveLength(1);

        // A blank ingredient_id names nothing: refused, not "clear it all".
        const blank = await post(bob, "/variant/clear", "ingredient_id=");
        expect(blank.status).toBe(400);
        expect(await blank.text()).toContain("Name the change to clear");
        expect(await rows()).toHaveLength(1);

        // Alice clearing hers touches nothing of Bob's.
        const none = await post(alice, "/variant/clear", "");
        expect(none.status).toBe(303);
        expect(await rows()).toHaveLength(1);
        const cleared = await post(bob, "/variant/clear", "");
        expect(cleared.status).toBe(303);
        expect(await rows()).toEqual([]);
        expect(
            (
                await siteApp.request(
                    `http://x/recipes/not-a-uuid/variant/clear`,
                    {
                        method: "POST",
                        headers: { cookie: cookieFor(bob) },
                    },
                )
            ).status,
        ).toBe(404);
    });

    test("POST /recipes/:id/plan keeps the people it is planned for, and refuses someone outside the household", async () => {
        const recipe = await createRecipe(db.recipesStore, {
            householdId: "hh-1",
            creatorId: alice,
            name: "Mac",
            yieldPortions: 4,
        });
        const plan = (extra: string) =>
            siteApp.request(`http://x/recipes/${recipe.id}/plan`, {
                method: "POST",
                headers: {
                    cookie: cookieFor(alice),
                    "content-type": "application/x-www-form-urlencoded",
                },
                body: `date=2099-01-05&slot=dinner&servings=2${extra}`,
            });
        const refused = await plan(`&member_ids=${outsider}`);
        expect(refused.status).toBe(400);
        expect(await refused.text()).toContain(
            "Pick people who are in the household.",
        );
        expect(
            await db.plansStore.listPlans("hh-1", "2099-01-01", "2099-01-31"),
        ).toEqual([]);
        const ok = await plan(`&member_ids=${alice}&member_ids=${bob}`);
        expect(ok.status).toBe(303);
        const planned = await db.plansStore.listPlans(
            "hh-1",
            "2099-01-01",
            "2099-01-31",
        );
        expect(planned.map((p) => p.memberIds)).toEqual([[alice, bob]]);
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
        expect(html).toContain("Uncheck");
        expect(html).toContain('id="fd-grocery-clear-form"');
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
        expect(html).toContain("Add anyway");
        expect(html).toContain('name="confirm_allergen" value="1"');
        // The warning names the food that was typed.
        expect(html).toContain("Peanut Butter contains peanut");
        expect(html).toContain("Bob");
        expect(html).toContain(`name="store_id" value="${store.id}"`);
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
        expect(html).toContain("No household yet");
        expect(html).not.toContain("fd-kitchen-groceries-page");
    });

    test("GET /settings is the account page, not a stub", async () => {
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('data-fd-settings-page="home"');
        expect(html).toContain('href="/settings/help"');
        expect(html).not.toContain("bottom-nav");
        expect(html).not.toContain("coming-soon");
    });

    test("GET /settings/household/items goes to the saved foods page", async () => {
        const r = await siteApp.request("http://x/settings/household/items", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(302);
        expect(r.headers.get("location")).toBe("/settings/saved");
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
        expect(html).toContain('<span class="fd-settings-hh-name">');
        expect(html).toContain('action="/settings/household"');
        expect(html).toContain("Alice");
        expect(html).toContain("Bob");
    });

    test("GET /settings/household offers the owner a Turbo-free token rotation", async () => {
        const r = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('commandfor="fd-household-rotate-token"');
        expect(html).toContain("Rotate household token");
        expect(html).toContain("Rotate household token?");
        expect(html).toContain("Agents using the old token stop working.");
        expect(html).toMatch(
            /<form[^>]*method="post"[^>]*action="\/settings\/household\/rotate-token"[^>]*data-turbo="false"/,
        );
        expect(html).not.toContain("Shown only now");
    });

    test("GET /settings/household does not offer a member the token rotation", async () => {
        db.profile = { ...PROFILE_BASE, user_id: bob };
        const r = await siteApp.request("http://x/settings/household", {
            headers: { cookie: cookieFor(bob) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).not.toContain("fd-household-rotate-token");
        expect(html).not.toContain("/settings/household/rotate-token");
        expect(html).not.toContain("Rotate household token");
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
        expect(html).toContain('<span class="fd-settings-hh-name">');
        expect(html).not.toContain('commandfor="fd-household-add-member"');
        expect(html).not.toContain('action="/settings/household/stores"');
    });

    test("GET /settings/help is available to members", async () => {
        const r = await siteApp.request("http://x/settings/help", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(200);
        const html = await r.text();
        expect(html).toContain('data-fd-settings-page="help"');
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
        const [store] = await db.settingsStore.listStores("hh-1");
        expect(store?.name).toBe("Safeway");
        const sections = await db.settingsStore.listSections(store!.id);
        expect(sections.map((row) => row.name)).toEqual(
            expect.arrayContaining(["Produce", "Other"]),
        );
    });

    test("GET /settings is 403 for a non-member", async () => {
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("No household yet");
        expect(html).not.toContain("<h1>Settings</h1>");
    });

    test("GET /nutrition redirects to /", async () => {
        const r = await siteApp.request("http://x/nutrition", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(303);
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
        // The Display control lives on Settings home now; the old page
        // redirects there.
        const old = await siteApp.request("http://x/settings/display", {
            headers: { cookie: cookieFor(alice) },
        });
        expect(old.status).toBe(301);
        expect(old.headers.get("location")).toBe("/settings");
        const r = await siteApp.request("http://x/settings", {
            headers: { cookie: cookieFor(alice) },
        });
        const html = await r.text();
        expect(html).toContain('<html lang="en">');
        expect(html).toContain(
            'type="radio" name="theme" value="system" checked',
        );
    });

    test("?member= of a stranger is 403, Not allowed with a way back to Today", async () => {
        const r = await siteApp.request(`http://x/?member=${outsider}`, {
            headers: { cookie: cookieFor(alice) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("Not allowed");
        expect(html).toContain(
            '<a class="fd-btn fd-btn--primary" data-fd-btn href="/">',
        );
        expect(html).not.toContain("No household yet");
        expect(html).not.toContain("/logout");
        expect(html).not.toContain("<iframe");
    });

    test("a non-member sees 403 when a household already exists", async () => {
        const r = await siteApp.request("http://x/", {
            headers: { cookie: cookieFor(outsider) },
        });
        expect(r.status).toBe(403);
        const html = await r.text();
        expect(html).toContain("No household yet");
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
            // The foods table checks a unit factor > 0: a zero factor is a bad
            // document, not a database error while writing it.
            ...(["grams_per_ml", "grams_per_each"] as const).map(
                (
                    key,
                ): [
                    string,
                    Record<string, unknown>,
                    () => void,
                    string,
                    RegExp,
                ] => [
                    `${key} of zero`,
                    {
                        document: documentJson({
                            ingredients: [
                                {
                                    food_name: "Lentils",
                                    amount: 300,
                                    unit: "g",
                                    food: { ...NONE, [key]: 0 },
                                },
                            ],
                        }),
                    },
                    () => {},
                    "not_recipe",
                    new RegExp(
                        `isn't a Foodable recipe\\.[^]*ingredients\\.0\\.food\\.${key}`,
                        "i",
                    ),
                ],
            ),
            // A NUL cannot be stored and no other control character belongs
            // in a recipe: the tool refuses the document rather than fail
            // while writing it.
            ...(
                [
                    ["a NUL in the name", { name: "So\u0000up" }, /name:/],
                    [
                        "a NUL in the instructions",
                        { instructions: "Stir\u0000 well" },
                        /instructions:/,
                    ],
                    ["a NUL in a tag", { tags: ["so\u0000up"] }, /tags\.0:/],
                    [
                        "a NUL in an ingredient name",
                        {
                            ingredients: [
                                {
                                    food_name: "Len\u0000tils",
                                    amount: 300,
                                    unit: "g",
                                    food: { ...NONE },
                                },
                            ],
                        },
                        /ingredients\.0\.food_name:/,
                    ],
                    [
                        "a NUL in an ingredient unit",
                        {
                            ingredients: [
                                {
                                    food_name: "Lentils",
                                    amount: 300,
                                    unit: "g\u0000",
                                    food: { ...NONE },
                                },
                            ],
                        },
                        /ingredients\.0\.unit:/,
                    ],
                    [
                        "an escape character in the name",
                        { name: "So\u001bup" },
                        /name:/,
                    ],
                ] as [string, Record<string, unknown>, RegExp][]
            ).map(
                ([label, over, where]): [
                    string,
                    Record<string, unknown>,
                    () => void,
                    string,
                    RegExp,
                ] => [
                    label,
                    { document: documentJson(over) },
                    () => {},
                    "not_recipe",
                    new RegExp(
                        `isn't a Foodable recipe\\.[^]*${where.source}[^]*control character`,
                        "i",
                    ),
                ],
            ),
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

describe("list_recipes filters and query over HTTP", () => {
    type Call = (
        name: string,
        args?: Record<string, unknown>,
    ) => Promise<ToolResult>;

    /** Pancakes (quick, starred), Omelette (quick), Stew (slow, starred). */
    async function seed(call: Call) {
        const make = async (
            name: string,
            prep_minutes: number,
            cook_minutes: number,
        ) => {
            const made = await call("create_recipe", {
                name,
                yield_portions: 2,
                prep_minutes,
                cook_minutes,
            });
            expect(made.isError).toBeFalsy();
            return made.structuredContent?.id as string;
        };
        const pancakes = await make("Pancakes", 5, 5);
        await make("Omelette", 5, 5);
        const stew = await make("Stew", 30, 120);
        await db.recipesStore.setFavourite("hh-1", "u1", pancakes, true);
        await db.recipesStore.setFavourite("hh-1", "u1", stew, true);
    }

    async function names(call: Call, args: Record<string, unknown>) {
        const listed = await call("list_recipes", args);
        expect(listed.isError).toBeFalsy();
        return (listed.structuredContent?.recipes as { name: string }[])
            .map((recipe) => recipe.name)
            .sort();
    }

    test.each(ERAS)("filters combine with AND (%p)", async (era) => {
        await withHttpClient("u1", era, async (client) => {
            const call: Call = async (name, args = {}) =>
                (await client.callTool({
                    name,
                    arguments: args,
                })) as ToolResult;
            await seed(call);
            expect(await names(call, {})).toEqual([
                "Omelette",
                "Pancakes",
                "Stew",
            ]);
            expect(await names(call, { filters: ["quick"] })).toEqual([
                "Omelette",
                "Pancakes",
            ]);
            expect(await names(call, { filters: ["favourites"] })).toEqual([
                "Pancakes",
                "Stew",
            ]);
            expect(
                await names(call, { filters: ["quick", "favourites"] }),
            ).toEqual(["Pancakes"]);
            expect(await names(call, { filters: [] })).toEqual([
                "Omelette",
                "Pancakes",
                "Stew",
            ]);
        });
    });

    test.each(ERAS)(
        "query matches the name and combines with filters (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                await seed(call);
                expect(await names(call, { query: "OME" })).toEqual([
                    "Omelette",
                ]);
                expect(
                    await names(call, { query: "e", filters: ["favourites"] }),
                ).toEqual(["Pancakes", "Stew"]);
                expect(
                    await names(call, { query: "stew", filters: ["quick"] }),
                ).toEqual([]);
                expect(await names(call, { query: "  " })).toHaveLength(3);
            });
        },
    );

    test.each(ERAS)(
        "favourites are the caller's own stars, not another member's (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                await seed(call);
                const omelette = (
                    (await call("list_recipes", { query: "omelette" }))
                        .structuredContent?.recipes as { id: string }[]
                )[0]!.id;
                // Another member stars Omelette; u1's own stars are untouched.
                await db.recipesStore.setFavourite(
                    "hh-1",
                    "u2",
                    omelette,
                    true,
                );
                expect(await names(call, { filters: ["favourites"] })).toEqual([
                    "Pancakes",
                    "Stew",
                ]);
            });
        },
    );

    test.each(ERAS)(
        "the household token reads the owner's stars (%p)",
        async (era) => {
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
                { versionNegotiation: { mode: era } },
            );
            await client.connect(transport);
            try {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                await seed(call);
                const omelette = (
                    (await call("list_recipes", { query: "omelette" }))
                        .structuredContent?.recipes as { id: string }[]
                )[0]!.id;
                await db.recipesStore.setFavourite(
                    "hh-1",
                    "u2",
                    omelette,
                    true,
                );
                expect(await names(call, { filters: ["favourites"] })).toEqual([
                    "Pancakes",
                    "Stew",
                ]);
            } finally {
                await client.close();
            }
        },
    );

    test.each(ERAS)(
        "the existing filters still apply with the new ones (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const call: Call = async (name, args = {}) =>
                    (await client.callTool({
                        name,
                        arguments: args,
                    })) as ToolResult;
                await seed(call);
                expect(
                    await names(call, {
                        verification: "verified",
                        filters: ["quick"],
                    }),
                ).toEqual(["Omelette", "Pancakes"]);
            });
        },
    );

    test.each(ERAS)(
        "an unknown filter id is refused by the schema (%p)",
        async (era) => {
            await withHttpClient("u1", era, async (client) => {
                const result = (await client.callTool({
                    name: "list_recipes",
                    arguments: { filters: ["nonsense"] },
                })) as ToolResult;
                expect(result.isError).toBe(true);
            });
        },
    );
});
