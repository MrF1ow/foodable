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
import {
    getRecipeView,
    listRecipes,
    macrosForPerson,
} from "../../domain/recipes.js";
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
import { findOrCreateFoodByBarcodeResult } from "../../domain/foods.js";
import { MealItemsError, type MealItemSpec } from "../../domain/meals.js";
import { toGrams } from "../../domain/food-quantity.js";
import { unitHintsForLog } from "../../domain/log-search.js";
import {
    foodDisplayScore,
    offHitDisplayScore,
} from "../../domain/product-screen.js";
import { insertMeal, insertWater, insertWeight } from "../../db/nutrition.js";
import { mealWriteFromItems, resolveWriteTimestamp } from "../../meal-write.js";
import { MAX_CALORIES, MAX_MACRO_G } from "../../domain/import.js";
import {
    assertPlausibleWeight,
    resolveWriteWeightUnit,
} from "../../weight-write.js";
import { toGrams as weightToGrams, isWeightUnit } from "../../domain/units.js";
import { formAmount, formOptionalNumber, formText } from "../form.js";
import { logWaterFromForm } from "../pages/nutrition.js";
import { redirectWithToast } from "../components/toast.js";
import { renderDashboardPage, weighInPrefillForUser } from "../loaders.js";
import { getHouseholdMembership } from "../../db/household.js";
import {
    FD_LOG_POST,
    FD_LOG_QUICK_POST,
    FD_LOG_WATER_POST,
    FD_LOG_WEIGHT_POST,
    type LogAmountPrefill,
    type QuickCaloriesPrefill,
    type WeighInPrefill,
} from "../pages/v2/log-sheet.js";
import { safeReturnPath } from "../usual-products-path.js";
import { gatedRoute } from "../gated.js";
import { requireMember, siteMember } from "../middleware.js";
import { fridgeBarcodeLookup } from "./fridge.js";

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
    foodsById: Map<string, Food>,
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
            kcal_per_portion: line.calories ?? null,
            protein_g_per_portion: line.protein_g ?? null,
            carbs_g_per_portion: line.carbs_g ?? null,
            fat_g_per_portion: line.fat_g ?? null,
        };
    }
    if (line.food_id) {
        const food = foodsById.get(line.food_id);
        const score = food ? foodDisplayScore(food) : null;
        return {
            ...base,
            food_id: line.food_id,
            amount: line.amount,
            unit: line.unit,
            grams_per_each: food?.gramsPerEach ?? null,
            grams_per_ml: food?.gramsPerMl ?? null,
            kcal_per_100g: food?.calories ?? null,
            protein_per_100g: food?.proteinG ?? null,
            carbs_per_100g: food?.carbsG ?? null,
            fat_per_100g: food?.fatG ?? null,
            ...(score != null ? { product_score: score } : {}),
        };
    }
    return base;
}

async function enrichHistoryItem(
    item: LogSearchSourceItem,
    householdId: string,
    userId: string,
    foodsById: Map<string, Food>,
): Promise<LogSearchSourceItem> {
    if (item.recipe_id) {
        try {
            const view = await getRecipeView(
                liveRecipesStore(),
                householdId,
                item.recipe_id,
                userId,
            );
            const macros = macrosForPerson(
                view.ingredients,
                view.yieldPortions,
                1,
                foodsById,
            );
            return {
                ...item,
                kcal_per_portion: macros?.calories ?? null,
                protein_g_per_portion: macros?.protein_g ?? null,
                carbs_g_per_portion: macros?.carbs_g ?? null,
                fat_g_per_portion: macros?.fat_g ?? null,
            };
        } catch {
            return item;
        }
    }
    return item;
}

async function loadHistoryMeals(
    userId: string,
    householdId: string,
    query: string,
    limit: number,
    tz: string,
    foodsById: Map<string, Food>,
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
    const items = meals.map((meal) => historyItemFromMeal(meal, foodsById));
    return Promise.all(
        items.map((item) =>
            enrichHistoryItem(item, householdId, userId, foodsById),
        ),
    );
}

function offToSource(hit: FoodResult): LogSearchSourceItem {
    const per100 = catalogNutritionFromOff(hit);
    const score = offHitDisplayScore(hit);
    return {
        kind: "off",
        id: hit.source,
        name: hit.name,
        brand: hit.brand,
        barcode: hit.barcode,
        source: hit.source,
        kcal_per_100g: per100.calories,
        protein_per_100g: per100.proteinG,
        carbs_per_100g: per100.carbsG,
        fat_per_100g: per100.fatG,
        ...(score != null ? { product_score: score } : {}),
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
    const score = foodDisplayScore(row);
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
        protein_per_100g: row.proteinG,
        carbs_per_100g: row.carbsG,
        fat_per_100g: row.fatG,
        ...(score != null ? { product_score: score } : {}),
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
        input.householdId,
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
    const foodsCatalog = new Map(listed.map((row) => [row.id, row]));
    const recipe: LogSearchSourceItem[] = [];
    for (const row of recipes) {
        const view = await getRecipeView(
            liveRecipesStore(),
            input.householdId,
            row.id,
            input.userId,
        );
        const macros = view
            ? macrosForPerson(
                  view.ingredients,
                  view.yieldPortions,
                  1,
                  foodsCatalog,
              )
            : null;
        recipe.push({
            kind: "recipe",
            id: row.id,
            recipe_id: row.id,
            name: row.name,
            source: "recipe",
            kcal_per_portion: macros?.calories ?? null,
            protein_g_per_portion: macros?.protein_g ?? null,
            carbs_g_per_portion: macros?.carbs_g ?? null,
            fat_g_per_portion: macros?.fat_g ?? null,
        });
    }

    const fridge = await listFridge(liveFridgeStore(), input.householdId);
    const stock: LogSearchSourceItem[] = [];
    for (const item of fridge.items) {
        const foodRow = item.foodId
            ? (foodsById.get(item.foodId) ?? null)
            : null;
        const score = foodRow ? foodDisplayScore(foodRow) : null;
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
            protein_per_100g: foodRow?.proteinG ?? null,
            carbs_per_100g: foodRow?.carbsG ?? null,
            fat_per_100g: foodRow?.fatG ?? null,
            stock_amount: item.quantity.amount,
            stock_unit: item.quantity.unit,
            ...(score != null ? { product_score: score } : {}),
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

const MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

function parseMealType(
    raw: string,
): "breakfast" | "lunch" | "dinner" | "snack" {
    const t = raw.trim().toLowerCase();
    switch (t) {
        case "breakfast":
        case "lunch":
        case "dinner":
        case "snack":
            return t;
        default:
            throw new MealItemsError("Choose a meal type.");
    }
}

const AMOUNT_MAX_GRAM = 5000;
const AMOUNT_MAX_EACH = 50;
const AMOUNT_MAX_PORTION = 50;

function assertLogAmount(amount: number, unit: string): void {
    if (unit === "portion" && amount > AMOUNT_MAX_PORTION) {
        throw new MealItemsError(
            `Keep portions at ${AMOUNT_MAX_PORTION} or less.`,
        );
    }
    if (unit === "each" && amount > AMOUNT_MAX_EACH) {
        throw new MealItemsError(`Keep each at ${AMOUNT_MAX_EACH} or less.`);
    }
    if ((unit === "g" || unit === "ml") && amount > AMOUNT_MAX_GRAM) {
        throw new MealItemsError(`Keep ${unit} at ${AMOUNT_MAX_GRAM} or less.`);
    }
}

async function enrichAmountPrefill(
    householdId: string,
    userId: string,
    prefill: LogAmountPrefill,
): Promise<LogAmountPrefill> {
    if (prefill.recipe_id) {
        const view = await getRecipeView(
            liveRecipesStore(),
            householdId,
            prefill.recipe_id,
            userId,
        );
        const foods = await liveFoodsStore().listFoods(householdId);
        const catalog = new Map(foods.map((row) => [row.id, row]));
        const macros = view
            ? macrosForPerson(view.ingredients, view.yieldPortions, 1, catalog)
            : null;
        return {
            ...prefill,
            name: view?.name ?? prefill.name,
            unit_hints: ["portion"],
            kcal_per_100g: macros?.calories ?? null,
            protein_per_100g: macros?.protein_g ?? null,
            carbs_per_100g: macros?.carbs_g ?? null,
            fat_per_100g: macros?.fat_g ?? null,
        };
    }
    const foodId = prefill.food_id?.trim();
    if (foodId) {
        const foods = await liveFoodsStore().listFoods(householdId);
        const food = foods.find((row) => row.id === foodId);
        if (food) {
            return {
                ...prefill,
                name: food.name,
                unit_hints: unitHintsForLog({
                    grams_per_each: food.gramsPerEach,
                    grams_per_ml: food.gramsPerMl,
                }),
                kcal_per_100g: food.calories,
                protein_per_100g: food.proteinG,
                carbs_per_100g: food.carbsG,
                fat_per_100g: food.fatG,
                grams_per_ml: food.gramsPerMl,
                grams_per_each: food.gramsPerEach,
            };
        }
    }
    return prefill;
}

type LogSheetRerender = Omit<
    import("../pages/v2/log-sheet.js").RenderLogSheetsOpts,
    "timezone"
>;

async function logSheetErrorPage(
    userId: string,
    sheet: LogSheetRerender,
): Promise<Response> {
    const page = await renderDashboardPage(
        userId,
        undefined,
        undefined,
        undefined,
        sheet,
    );
    return new Response(page.html, {
        status: page.status === 200 ? 400 : page.status,
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

async function logErrorPage(
    userId: string,
    error: string,
    prefill: LogAmountPrefill,
    tz: string,
): Promise<Response> {
    // The error shows inside the reopened amount sheet only, not as a second
    // page-level banner too.
    const page = await renderDashboardPage(
        userId,
        undefined,
        undefined,
        undefined,
        {
            amountOpenOnLoad: true,
            amountError: error,
            amount: prefill,
        },
    );
    return new Response(page.html, {
        status: page.status === 200 ? 400 : page.status,
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

export async function buildLogWriteItem(input: {
    householdId: string;
    foodId?: string;
    recipeId?: string;
    barcode?: string;
    amount: number;
    unit: string;
}): Promise<{ spec: MealItemSpec; name: string }> {
    const unit = input.unit.trim();
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new MealItemsError("Enter an amount greater than zero.");
    }
    assertLogAmount(input.amount, unit);
    if (input.recipeId?.trim()) {
        if (unit !== "portion") {
            throw new MealItemsError("Recipes are logged in portions.");
        }
        return {
            spec: { recipeId: input.recipeId.trim(), portions: input.amount },
            name: "Recipe",
        };
    }
    let foodId = input.foodId?.trim();
    const barcode = input.barcode?.trim();
    if (!foodId && barcode) {
        const { food } = await findOrCreateFoodByBarcodeResult(
            liveFoodsStore(),
            input.householdId,
            barcode,
            (code) => fridgeBarcodeLookup(code, input.householdId),
        );
        foodId = food.id;
    }
    if (!foodId) {
        throw new MealItemsError("Pick a food, recipe, or product to log.");
    }
    const foods = await liveFoodsStore().listFoods(input.householdId);
    const food = foods.find((row) => row.id === foodId);
    const hints = unitHintsForLog(
        food
            ? {
                  grams_per_each: food.gramsPerEach,
                  grams_per_ml: food.gramsPerMl,
              }
            : {},
    );
    if (!hints.includes(unit)) {
        throw new MealItemsError(
            `Unit “${unit}” is not available for this food.`,
        );
    }
    const grams = toGrams(
        { amount: input.amount, unit },
        food
            ? { gramsPerEach: food.gramsPerEach, gramsPerMl: food.gramsPerMl }
            : null,
    );
    if (grams == null) {
        throw new MealItemsError(
            `Unit “${unit}” is not available for this food.`,
        );
    }
    return {
        spec: { foodId, amount: input.amount, unit },
        name: food?.name ?? "Food",
    };
}

logRoutes.post(
    FD_LOG_POST,
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const profile = await getProfile(userId);
        const tz =
            profile?.timezone && validateTz(profile.timezone)
                ? profile.timezone
                : "UTC";
        const body = await c.req.parseBody();
        const amount = formAmount(body, "amount");
        const unit = formText(body, "unit");
        const logged_at = formText(body, "logged_at") || undefined;
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        const prefill: LogAmountPrefill = {
            name: formText(body, "display_name") || "Food",
            food_id: formText(body, "food_id") || undefined,
            recipe_id: formText(body, "recipe_id") || undefined,
            barcode: formText(body, "barcode") || undefined,
            amount,
            unit,
            meal_type: formText(body, "meal_type"),
            logged_at,
        };
        try {
            const meal_type = parseMealType(prefill.meal_type ?? "");
            prefill.meal_type = meal_type;
            const { spec, name } = await buildLogWriteItem({
                householdId: member.householdId,
                foodId: prefill.food_id,
                recipeId: prefill.recipe_id,
                barcode: prefill.barcode,
                amount,
                unit,
            });
            prefill.name = name;
            const { iso } = await resolveWriteTimestamp(userId, logged_at);
            const computed = await mealWriteFromItems(member.householdId, [
                spec,
            ]);
            await insertMeal(userId, {
                description: computed.description,
                meal_type,
                logged_at: iso,
                ...computed.totals,
                items: computed.items,
                item_digest: computed.item_digest,
            });
            return redirectWithToast(c, returnTo, "nutrition.meal.logged");
        } catch (err) {
            const message =
                err instanceof MealItemsError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not log this meal.";
            const filled = await enrichAmountPrefill(
                member.householdId,
                userId,
                prefill,
            );
            return logErrorPage(userId, message, filled, tz);
        }
    },
);

function parseBoundedMacro(
    raw: number | undefined,
    label: string,
): number | undefined {
    if (raw === undefined) return undefined;
    if (!Number.isFinite(raw) || raw < 0) {
        throw new MealItemsError(`Enter ${label} as zero or more.`);
    }
    if (raw > MAX_MACRO_G) {
        throw new MealItemsError(`Keep ${label} at ${MAX_MACRO_G} g or less.`);
    }
    return raw;
}

function parseQuickCalories(raw: number): number {
    if (!Number.isFinite(raw) || raw <= 0) {
        throw new MealItemsError("Enter calories greater than zero.");
    }
    if (raw > MAX_CALORIES) {
        throw new MealItemsError(`Keep calories at ${MAX_CALORIES} or less.`);
    }
    return raw;
}

logRoutes.post(
    FD_LOG_QUICK_POST,
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const profile = await getProfile(userId);
        const tz =
            profile?.timezone && validateTz(profile.timezone)
                ? profile.timezone
                : "UTC";
        const body = await c.req.parseBody();
        const calories = formAmount(body, "calories");
        const meal_type = formText(body, "meal_type");
        const description = formText(body, "description") || "Quick calories";
        const logged_at = formText(body, "logged_at") || undefined;
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        const prefill: QuickCaloriesPrefill = {
            calories,
            protein_g: formOptionalNumber(body, "protein_g"),
            carbs_g: formOptionalNumber(body, "carbs_g"),
            fat_g: formOptionalNumber(body, "fat_g"),
            description,
            meal_type,
            logged_at,
        };
        try {
            const mealType = parseMealType(meal_type);
            const kcal = parseQuickCalories(calories);
            const protein_g = parseBoundedMacro(prefill.protein_g, "protein");
            const carbs_g = parseBoundedMacro(prefill.carbs_g, "carbs");
            const fat_g = parseBoundedMacro(prefill.fat_g, "fat");
            const { iso } = await resolveWriteTimestamp(userId, logged_at);
            await insertMeal(userId, {
                description,
                meal_type: mealType,
                logged_at: iso,
                calories: kcal,
                protein_g,
                carbs_g,
                fat_g,
            });
            return redirectWithToast(c, returnTo, "nutrition.meal.logged");
        } catch (err) {
            const message =
                err instanceof MealItemsError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not log this meal.";
            return logSheetErrorPage(userId, {
                quickCaloriesOpenOnLoad: true,
                quickCaloriesError: message,
                quickCalories: prefill,
            });
        }
    },
);

logRoutes.post(
    FD_LOG_WATER_POST,
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const body = await c.req.parseBody();
        const logged_at = formText(body, "logged_at") || undefined;
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        try {
            const amountRaw =
                formText(body, "amount_ml") ||
                String(formAmount(body, "amount_ml"));
            const result = await logWaterFromForm(
                userId,
                { amount_ml: amountRaw },
                async (uid, input) =>
                    insertWater(uid, {
                        ...input,
                        logged_at: (
                            await resolveWriteTimestamp(userId, logged_at)
                        ).iso,
                    }),
            );
            if (!result.ok) {
                throw new MealItemsError(result.error);
            }
            return redirectWithToast(c, returnTo, "nutrition.water.logged");
        } catch (err) {
            const message =
                err instanceof MealItemsError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not log water.";
            return logSheetErrorPage(userId, {
                searchOpenOnLoad: true,
                searchError: message,
            });
        }
    },
);

logRoutes.post(
    FD_LOG_WEIGHT_POST,
    requireMember,
    gatedRoute("ui-v2", { notFound: true }),
    async (c) => {
        const member = siteMember(c);
        const userId = member.userId;
        const body = await c.req.parseBody();
        const weight = formAmount(body, "weight");
        const unitRaw = formText(body, "unit");
        const logged_at = formText(body, "logged_at") || undefined;
        const returnTo = safeReturnPath(formText(body, "return_to"), "/");
        const resolvedUnit = isWeightUnit(unitRaw)
            ? unitRaw
            : await resolveWriteWeightUnit(userId, undefined);
        const weighBase = await weighInPrefillForUser(userId);
        const prefill: WeighInPrefill = {
            ...weighBase,
            weight,
            unit: resolvedUnit,
            logged_at,
        };
        try {
            const { iso } = await resolveWriteTimestamp(userId, logged_at);
            const weight_g = weightToGrams(weight, resolvedUnit);
            assertPlausibleWeight(weight_g, resolvedUnit);
            await insertWeight(userId, {
                weight_g,
                logged_at: iso,
            });
            return redirectWithToast(c, returnTo, "nutrition.weight.logged");
        } catch (err) {
            const message =
                err instanceof MealItemsError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : "Could not log weight.";
            return logSheetErrorPage(userId, {
                weighInOpenOnLoad: true,
                weighInError: message,
                weighIn: prefill,
            });
        }
    },
);
