import { Hono } from "hono";
import { searchFoodsByName } from "../../food-search.js";
import type { FoodResult } from "../../foods.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { getMealsInRange, searchMeals } from "../../db/nutrition.js";
import type { Meal } from "../../db/nutrition.js";
import { getProfile } from "../../db/profiles.js";
import { checkWebSearchRateLimit } from "../../rate-limit.js";
import {
    catalogNutritionFromOff,
    matchFoodsByWords,
} from "../../domain/foods.js";
import type { Food, FoodsStore } from "../../domain/foods.js";
import { listFridge } from "../../domain/fridge.js";
import { listRecipes } from "../../domain/recipes.js";
import {
    householdLogSearchCount,
    mergeLogResults,
    recentHistoryStart,
    type LogSearchGroupKind,
    type LogSearchResult,
    type LogSearchSourceItem,
    type LogSearchSources,
} from "../../domain/log-search.js";
import { todayInTz, validateTz } from "../../domain/tz.js";
import { gatedRoute } from "../gated.js";
import { requireMember, siteMember } from "../middleware.js";

export const logRoutes = new Hono();

const RECENT_HISTORY_DAYS = 14;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function parseLimit(raw: string | undefined): number {
    const n = Number.parseInt(raw ?? "", 10);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
}

function trimSources(result: LogSearchResult, limit: number): LogSearchResult {
    let remaining = limit;
    const groups = [];
    for (const group of result.groups) {
        if (remaining <= 0) break;
        const items = group.items.slice(0, remaining);
        remaining -= items.length;
        if (items.length > 0) groups.push({ kind: group.kind, items });
    }
    return { groups };
}

function historyItemFromMeal(
    meal: Meal,
    foodsById: Map<
        string,
        { gramsPerEach: number | null; gramsPerMl: number | null }
    >,
): LogSearchSourceItem {
    const items = meal.items ?? [];
    const base: LogSearchSourceItem = {
        kind: "history",
        id: meal.id,
        name: meal.description,
        source: "meal",
        logged_at: meal.logged_at,
        meal_kcal: meal.calories,
    };
    if (items.length !== 1) {
        return base;
    }
    const line = items[0]!;
    if (line.recipe_id) {
        return {
            ...base,
            recipe_id: line.recipe_id,
            amount: line.amount,
            unit: line.unit,
            grams_per_each: null,
            grams_per_ml: null,
        };
    }
    if (line.food_id) {
        const food = foodsById.get(line.food_id);
        return {
            ...base,
            food_id: line.food_id,
            amount: line.amount,
            unit: line.unit,
            grams_per_each: food?.gramsPerEach ?? null,
            grams_per_ml: food?.gramsPerMl ?? null,
        };
    }
    return base;
}

async function loadHistoryMeals(
    userId: string,
    query: string,
    limit: number,
    tz: string,
    foodsById: Map<
        string,
        { gramsPerEach: number | null; gramsPerMl: number | null }
    >,
): Promise<LogSearchSourceItem[]> {
    const trimmed = query.trim();
    let meals: Meal[];
    if (trimmed) {
        meals = await searchMeals(userId, [trimmed], { limit });
    } else {
        const end = todayInTz(tz);
        const start = recentHistoryStart(end, RECENT_HISTORY_DAYS);
        const range = await getMealsInRange(userId, start, end, tz);
        meals = range
            .slice()
            .sort((a, b) => b.logged_at.localeCompare(a.logged_at))
            .slice(0, limit);
    }
    return meals.map((meal) => historyItemFromMeal(meal, foodsById));
}

function offToSource(hit: FoodResult): LogSearchSourceItem {
    const per100 = catalogNutritionFromOff(hit);
    return {
        kind: "off",
        id: hit.source,
        name: hit.name,
        brand: hit.brand,
        barcode: hit.barcode,
        source: hit.source,
        kcal_per_100g: per100.calories,
    };
}

/**
 * An OFF product whose barcode is already on a household food is that food:
 * the hit is dropped, and the food's id is returned so the caller can list the
 * household food even when its name did not match the query. A barcode on an
 * archived food (not in `activeFoodIds`) does not count: the household hid
 * that food, so the product is offered from Open Food Facts again.
 */
async function splitOffByHouseholdBarcode(
    store: FoodsStore,
    householdId: string,
    offHits: FoodResult[],
    activeFoodIds: ReadonlySet<string>,
): Promise<{ kept: FoodResult[]; householdFoodIds: string[] }> {
    if (offHits.length === 0) return { kept: [], householdFoodIds: [] };
    const barcodeToFoodId = await store.getBarcodeFoodIds(
        householdId,
        offHits.map((f) => f.barcode),
    );
    const kept: FoodResult[] = [];
    const householdFoodIds: string[] = [];
    for (const hit of offHits) {
        const foodId = barcodeToFoodId.get(hit.barcode);
        if (foodId && activeFoodIds.has(foodId)) {
            if (!householdFoodIds.includes(foodId))
                householdFoodIds.push(foodId);
        } else {
            kept.push(hit);
        }
    }
    return { kept, householdFoodIds };
}

function foodToSource(row: Food): LogSearchSourceItem {
    return {
        kind: "food",
        id: row.id,
        name: row.name,
        food_id: row.id,
        brand: row.brand,
        source: "household",
        grams_per_each: row.gramsPerEach,
        grams_per_ml: row.gramsPerMl,
        kcal_per_100g: row.calories,
    };
}

export async function buildLogSearchSources(input: {
    householdId: string;
    userId: string;
    query: string;
    limit: number;
    timezone: string;
}): Promise<{ sources: LogSearchSources; foodsById: Map<string, Food> }> {
    const foodsStore = liveFoodsStore();
    const listed = await foodsStore.listFoods(input.householdId);
    const foodsById = new Map(listed.map((row) => [row.id, row]));
    const history = await loadHistoryMeals(
        input.userId,
        input.query,
        input.limit,
        input.timezone,
        foodsById,
    );
    // An empty query shows recent meals only: nothing else to load.
    if (!input.query.trim()) {
        return { sources: { history }, foodsById };
    }

    const aliasMap = await foodsStore.listAllAliases(input.householdId);
    const food = matchFoodsByWords(input.query, listed, aliasMap).map(
        foodToSource,
    );

    const recipes = await listRecipes(liveRecipesStore(), input.householdId);
    const recipe: LogSearchSourceItem[] = recipes.map((row) => ({
        kind: "recipe",
        id: row.id,
        name: row.name,
        source: "recipe",
    }));

    const fridge = await listFridge(liveFridgeStore(), input.householdId);
    const stock: LogSearchSourceItem[] = [];
    for (const item of fridge.items) {
        const foodRow = item.foodId
            ? (foodsById.get(item.foodId) ?? null)
            : null;
        stock.push({
            kind: "stock",
            id: item.id,
            name: foodRow?.name ?? item.displayName,
            food_id: item.foodId,
            brand: foodRow?.brand ?? null,
            source: "fridge",
            grams_per_each: foodRow?.gramsPerEach ?? null,
            grams_per_ml: foodRow?.gramsPerMl ?? null,
            kcal_per_100g: foodRow?.calories ?? null,
        });
    }

    return { sources: { food, recipe, history, stock }, foodsById };
}

function countHouseholdHits(sources: LogSearchSources, query: string): number {
    return householdLogSearchCount(mergeLogResults(sources, query));
}

logRoutes.get(
    "/api/log/search",
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const rate = await checkWebSearchRateLimit(member.userId);
        c.header("X-RateLimit-Limit", String(rate.limit));
        c.header("X-RateLimit-Remaining", String(rate.remaining));
        if (!rate.allowed) {
            c.header("Retry-After", String(rate.retryAfterSeconds ?? 60));
            return c.json(
                {
                    error: "rate_limited",
                    error_description: `Rate limit exceeded (${rate.limit} requests per minute). Retry after ${rate.retryAfterSeconds}s.`,
                },
                429,
            );
        }

        const q = c.req.query("q") ?? "";
        const limit = parseLimit(c.req.query("limit"));
        const online = c.req.query("online") === "1";
        const profile = await getProfile(member.userId);
        const tz =
            profile?.timezone && validateTz(profile.timezone)
                ? profile.timezone
                : "UTC";

        const flags = c.get("viewerFlags");
        const offLookups = flags.offLookups === true;

        const built = await buildLogSearchSources({
            householdId: member.householdId,
            userId: member.userId,
            query: q,
            limit,
            timezone: tz,
        });
        let { sources } = built;

        let offHits: FoodResult[] = [];
        if (offLookups && q.trim()) {
            const householdHits = countHouseholdHits(sources, q);
            if (online || householdHits < 5) {
                try {
                    offHits = await searchFoodsByName(q.trim(), [], {
                        householdId: member.householdId,
                    });
                } catch {
                    offHits = [];
                }
            }
        }

        if (offHits.length > 0) {
            const { kept, householdFoodIds } = await splitOffByHouseholdBarcode(
                liveFoodsStore(),
                member.householdId,
                offHits,
                new Set(built.foodsById.keys()),
            );
            const food = [...(sources.food ?? [])];
            const listed = new Set(food.map((item) => item.food_id));
            for (const id of householdFoodIds) {
                const row = built.foodsById.get(id);
                if (row && !listed.has(id)) {
                    food.push(foodToSource(row));
                }
            }
            sources = { ...sources, food };
            if (kept.length > 0) sources.off = kept.map(offToSource);
        }

        const merged = mergeLogResults(sources, q);
        return c.json(trimSources(merged, limit));
    },
);

export function logSearchGroupKinds(
    result: LogSearchResult,
): LogSearchGroupKind[] {
    return result.groups.map((g) => g.kind);
}
