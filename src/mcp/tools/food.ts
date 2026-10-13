import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics, categorizeError } from "../../analytics.js";
import {
    normalizeBarcode,
    lookupBarcode,
    formatFoodResult,
    type FoodResult,
} from "../../foods.js";
import { searchFoodsByName } from "../../food-search.js";
import { liveFoodsStore } from "../../db/foods.js";
import {
    findFoodById,
    findOrCreateManualFood,
    mergeFoods,
    searchFoodCatalog,
    updateFood,
} from "../../domain/foods.js";
import { householdFoodNames } from "../shared.js";
import type { ToolContext } from "../shared.js";

export function registerLookupBarcodeTool(server: McpServer, ctx: ToolContext) {
    const { alcohol, personSchema, actorUserId, analytics } = ctx;
    server.registerTool(
        "lookup_barcode",
        {
            title: "Look Up Barcode",
            description:
                "Look up a packaged product's label nutrition by barcode via Open Food Facts. The figures come from the product's own label as transcribed by the Open Food Facts community, so they beat estimating — but they are not verified by this server and can be wrong, stale, or missing entirely. Pass the barcode digits (EAN/UPC, 8–14 digits). The user can type them, or you can read them from a photo of the package — transcribe the human-readable digits printed beneath the barcode. Returns the product name, serving, and macros, which you can then pass to log_meal scaled to the amount eaten. When Open Food Facts has computed them, it also returns the Nutri-Score (A–E, a nutritional-quality grade) and NOVA group (1–4, how processed the product is) — pass these along if the user is asking about the product's quality, not just its macros; they're omitted, not \"n/a\", when OFF hasn't computed one for that product. If no product is found, fall back to web search or estimation. Two gaps to close yourself before logging: a fiber or sugar figure shown as n/a is missing data rather than a zero, so estimate it and pass it anyway; and Open Food Facts carries no caffeine at all, so for a coffee, tea, cola, energy drink or other caffeinated product get caffeine_mg from the label or a web search.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            inputSchema: personSchema({
                barcode: z
                    .string()
                    .describe(
                        "Product barcode digits (EAN-8/13, UPC-A/E, or GTIN-14). Spaces and separators are ignored.",
                    ),
            }),
        },
        async ({ barcode, user_id }) => {
            // lookupBarcode's own failures (OFF down, timeout, bad config) are
            // caught below and turned into a normal (non-isError) content
            // response so the model can fall back to estimating — but that
            // means withAnalytics never sees a thrown error. Without this flag
            // an OFF outage silently records as `success: true`, which is how
            // it stayed invisible to tool_analytics entirely.
            // Safe only because withAnalytics awaits the handler to
            // completion before reading this via `outcome` below — it is not
            // read concurrently with the handler running.
            let offFailure: string | null = null;
            return withAnalytics(
                "lookup_barcode",
                async () => {
                    const userId = await actorUserId(user_id);
                    const normalized = normalizeBarcode(barcode);
                    if (!normalized) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `"${barcode}" is not a valid barcode (expected 8–14 digits). Double-check the number, or estimate the macros from the product description instead.`,
                                },
                            ],
                        };
                    }

                    let food;
                    try {
                        food = await lookupBarcode(normalized);
                    } catch (err) {
                        const msg =
                            err instanceof Error ? err.message : String(err);
                        // Route through the same categorizeError used for
                        // thrown errors elsewhere, so a config problem
                        // ("OFF_USER_AGENT is not configured") or an OFF rate
                        // limit lands in service_misconfigured/rate_limited
                        // instead of a generic bucket local to this tool.
                        const category = categorizeError(err);
                        offFailure =
                            category === "unknown"
                                ? "external_api_error"
                                : category;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Couldn't reach Open Food Facts right now (${msg}). Estimate the macros from the product description or ask the user, then log the meal.`,
                                },
                            ],
                        };
                    }

                    if (!food) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `No product found in Open Food Facts for barcode ${normalized}. Ask the user what the product is, or estimate the macros, then log the meal.`,
                                },
                            ],
                        };
                    }

                    return {
                        content: [
                            {
                                type: "text",
                                text: formatFoodResult(food, alcohol),
                            },
                        ],
                    };
                },
                analytics,
                { barcode },
                {
                    outcome: () =>
                        offFailure
                            ? { success: false, errorCategory: offFailure }
                            : { success: true },
                },
            );
        },
    );
}

const SEARCH_FOOD_ITEM = z.object({
    food_id: z.string().nullable(),
    name: z.string(),
    brand: z.string().nullable(),
    source: z.string(),
    barcode: z.string().nullable(),
    calories: z.number().nullable(),
    protein_g: z.number().nullable(),
    carbs_g: z.number().nullable(),
    fat_g: z.number().nullable(),
    fiber_g: z.number().nullable(),
    sugar_g: z.number().nullable(),
    serving: z.string().nullable(),
    default_unit: z.string().nullable(),
});

const FOOD_OUTPUT = z.object({
    id: z.string(),
    kind: z.enum(["food", "supply"]),
    name: z.string(),
    brand: z.string().nullable(),
    default_unit: z.string(),
    grams_per_each: z.number().nullable(),
    grams_per_ml: z.number().nullable(),
    calories: z.number().nullable(),
    protein_g: z.number().nullable(),
    carbs_g: z.number().nullable(),
    fat_g: z.number().nullable(),
    fiber_g: z.number().nullable(),
    sugar_g: z.number().nullable(),
    alcohol_g: z.number().nullable(),
    caffeine_mg: z.number().nullable(),
    nutrition_source: z.string().nullable(),
    allergens: z.array(z.string()),
    aliases: z.array(z.string()),
    barcodes: z.array(z.string()),
    archived: z.boolean(),
});

function foodPayload(
    food: {
        id: string;
        kind: "food" | "supply";
        name: string;
        brand: string | null;
        defaultUnit: string;
        gramsPerEach: number | null;
        gramsPerMl: number | null;
        calories: number | null;
        proteinG: number | null;
        carbsG: number | null;
        fatG: number | null;
        fiberG: number | null;
        sugarG: number | null;
        alcoholG: number | null;
        caffeineMg: number | null;
        nutritionSource: string | null;
        allergens: string[];
        archivedAt: string | null;
    },
    aliases: string[],
    barcodes: string[],
) {
    return {
        id: food.id,
        kind: food.kind,
        name: food.name,
        brand: food.brand,
        default_unit: food.defaultUnit,
        grams_per_each: food.gramsPerEach,
        grams_per_ml: food.gramsPerMl,
        calories: food.calories,
        protein_g: food.proteinG,
        carbs_g: food.carbsG,
        fat_g: food.fatG,
        fiber_g: food.fiberG,
        sugar_g: food.sugarG,
        alcohol_g: food.alcoholG,
        caffeine_mg: food.caffeineMg,
        nutrition_source: food.nutritionSource,
        allergens: food.allergens,
        aliases,
        barcodes,
        archived: food.archivedAt != null,
    };
}

function formatSearchHit(hit: {
    food_id: string | null;
    name: string;
    brand: string | null;
    source: string;
    barcode: string | null;
    calories: number | null;
}): string {
    const bits = [hit.name];
    if (hit.brand) bits.push(hit.brand);
    if (hit.food_id) bits.push(`food_id ${hit.food_id}`);
    if (hit.barcode) bits.push(hit.barcode);
    if (hit.calories != null) bits.push(`${hit.calories} kcal`);
    bits.push(hit.source);
    return bits.join(" · ");
}

export function registerSearchFoodTool(server: McpServer, ctx: ToolContext) {
    const { callerHouseholdId, analytics } = ctx;
    server.registerTool(
        "search_food",
        {
            title: "Search Food",
            description:
                "Search the household food catalog first, then Open Food Facts. Household hits include food_id. Prefer passing food_id to fridge, grocery, and recipe add tools. Do not use this to search logged meals — that is search_meals.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true,
            },
            inputSchema: z.object({
                query: z.string().min(1),
            }),
            outputSchema: z.object({
                foods: z.array(SEARCH_FOOD_ITEM),
            }),
        },
        async (args) =>
            withAnalytics(
                "search_food",
                async () => {
                    const householdId = await callerHouseholdId();
                    const names = await householdFoodNames(householdId);
                    // Open Food Facts is an outside service and goes down
                    // (503s). The household catalog must still answer, as it
                    // does in the web app's food search.
                    let offHits: FoodResult[] = [];
                    let offError: string | null = null;
                    try {
                        offHits = await searchFoodsByName(args.query, names);
                    } catch (err) {
                        offError =
                            err instanceof Error ? err.message : String(err);
                        console.warn(`[search_food] ${offError}`);
                    }
                    const foods = await searchFoodCatalog(
                        liveFoodsStore(),
                        householdId,
                        args.query,
                        offHits,
                    );
                    const payload = { foods };
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    (foods.length === 0
                                        ? `No foods found for "${args.query}".`
                                        : foods
                                              .map(formatSearchHit)
                                              .join("\n")) +
                                    (offError
                                        ? `\nOpen Food Facts is unavailable (${offError}); these are household foods only.`
                                        : ""),
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );
}

export function registerCatalogFoodTools(server: McpServer, ctx: ToolContext) {
    const { callerHouseholdId, analytics } = ctx;
    server.registerTool(
        "get_food",
        {
            title: "Get Food",
            description:
                "Read one household catalog food, including aliases, barcodes, nutrition per 100 g, default unit, grams per each, grams per millilitre, and allergens.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                food_id: z.string(),
            }),
            outputSchema: FOOD_OUTPUT,
        },
        async (args) =>
            withAnalytics(
                "get_food",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveFoodsStore();
                    const food = await findFoodById(
                        store,
                        householdId,
                        args.food_id,
                    );
                    const [aliases, barcodes] = await Promise.all([
                        store.listAliases(householdId, food.id),
                        store.listBarcodes(householdId, food.id),
                    ]);
                    const payload = foodPayload(food, aliases, barcodes);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `${payload.name} ${payload.id}`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "upsert_food",
        {
            title: "Upsert Food",
            description:
                "Create or update a household catalog food. Pass food_id to edit. Nutrition is per 100 g. Edit default_unit, grams_per_each, and grams_per_ml so counts and volumes convert. Manual foods and supplies use name when creating.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                food_id: z.string().optional(),
                kind: z.enum(["food", "supply"]).optional(),
                name: z.string().optional(),
                brand: z.string().nullable().optional(),
                default_unit: z.string().optional(),
                grams_per_each: z.coerce.number().nullable().optional(),
                grams_per_ml: z.coerce.number().nullable().optional(),
                calories: z.coerce.number().nullable().optional(),
                protein_g: z.coerce.number().nullable().optional(),
                carbs_g: z.coerce.number().nullable().optional(),
                fat_g: z.coerce.number().nullable().optional(),
                fiber_g: z.coerce.number().nullable().optional(),
                sugar_g: z.coerce.number().nullable().optional(),
                alcohol_g: z.coerce.number().nullable().optional(),
                caffeine_mg: z.coerce.number().nullable().optional(),
                nutrition_source: z
                    .enum(["openfoodfacts", "manual", "estimate", "recipe"])
                    .nullable()
                    .optional(),
                allergens: z.array(z.string()).optional(),
                aliases: z.array(z.string()).optional(),
                archived: z.boolean().optional(),
            }),
            outputSchema: FOOD_OUTPUT,
        },
        async (args) =>
            withAnalytics(
                "upsert_food",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveFoodsStore();
                    const kind = args.kind ?? "food";
                    const food = args.food_id
                        ? await findFoodById(store, householdId, args.food_id)
                        : await findOrCreateManualFood(
                              store,
                              householdId,
                              kind,
                              args.name ?? "",
                          );
                    const saved = await updateFood(
                        store,
                        householdId,
                        food.id,
                        {
                            name: args.name,
                            brand: args.brand,
                            defaultUnit: args.default_unit,
                            gramsPerEach: args.grams_per_each,
                            gramsPerMl: args.grams_per_ml,
                            calories: args.calories,
                            proteinG: args.protein_g,
                            carbsG: args.carbs_g,
                            fatG: args.fat_g,
                            fiberG: args.fiber_g,
                            sugarG: args.sugar_g,
                            alcoholG: args.alcohol_g,
                            caffeineMg: args.caffeine_mg,
                            nutritionSource: args.nutrition_source,
                            allergens: args.allergens,
                            aliases: args.aliases,
                            archived: args.archived,
                        },
                    );
                    const [aliases, barcodes] = await Promise.all([
                        store.listAliases(householdId, saved.id),
                        store.listBarcodes(householdId, saved.id),
                    ]);
                    const payload = foodPayload(saved, aliases, barcodes);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Saved ${payload.name} ${payload.id}`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "merge_foods",
        {
            title: "Merge Foods",
            description:
                "Merge two household catalog foods. keep_id stays; drop_id is archived and its barcodes, aliases, and item references move to keep_id.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                keep_id: z.string(),
                drop_id: z.string(),
            }),
            outputSchema: FOOD_OUTPUT,
        },
        async (args) =>
            withAnalytics(
                "merge_foods",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveFoodsStore();
                    const saved = await mergeFoods(
                        store,
                        householdId,
                        args.keep_id,
                        args.drop_id,
                    );
                    const [aliases, barcodes] = await Promise.all([
                        store.listAliases(householdId, saved.id),
                        store.listBarcodes(householdId, saved.id),
                    ]);
                    const payload = foodPayload(saved, aliases, barcodes);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Merged into ${payload.name} ${payload.id}`,
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );
}

export function registerFoodTools(server: McpServer, ctx: ToolContext) {
    registerLookupBarcodeTool(server, ctx);
    registerSearchFoodTool(server, ctx);
    registerCatalogFoodTools(server, ctx);
}
