import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { householdToday } from "../../db/restock.js";
import { liveStockStore } from "../../db/stock.js";
import { withAnalytics } from "../../analytics.js";
import { lookupBarcode } from "../../foods.js";
import {
    addLocation,
    deleteLocation,
    FridgeInputError,
    listFridge,
    moveItem,
    prepareAddFoodByBarcode,
    prepareAddFoodById,
    prepareAddManualFood,
    prepareAddSupply,
} from "../../domain/fridge.js";
import {
    addFridgeItemAdjust,
    daysUntilExpiry,
    deleteFridgeItemAdjust,
    discardFridgeItem,
    eatFridgeItem,
    fridgeEatLogsMeal,
    fridgeNotices,
    listExpiring,
    StockInputError,
    updateFridgeItemQuantityAdjust,
} from "../../domain/stock.js";
import { sortNotices } from "../../domain/notices.js";
import { fridgeExpiryLine } from "../../copy/notices.js";
import { effectiveFoodsByIds, findFoodById } from "../../domain/foods.js";
import { listRecipes, recipeTotalMinutes } from "../../domain/recipes.js";
import { useSoonFromPrefetch } from "../../domain/suggestions.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";
import { insertMeal, snapshotToMealItemWrite } from "../../db/nutrition.js";
import { liveRecipesStore } from "../../db/recipes.js";
import {
    registerV2OnlyWidgetResource,
    registerWidgetResource,
    uiMetaForKey,
    NOTICE_SCHEMA,
    NEW_FOOD_INPUT,
    ON_SIMILAR_INPUT,
    noticeToWire,
    onSimilarFor,
    similarFoodsText,
    similarFoodsWire,
    SIMILAR_FOODS_ENTRY,
    WRITE_STATUS,
    captureDismissals,
    destructiveOutcome,
    dismissedOn,
    uncapturedNote,
    withUndo,
    type ToolContext,
} from "../shared.js";
import { SimilarFoodsError } from "../../domain/foods.js";

export const ADD_FRIDGE_ITEM_OUTPUT_SCHEMA = z.object({
    status: WRITE_STATUS,
    similar_foods: z.array(SIMILAR_FOODS_ENTRY),
    id: z.string().nullable(),
    display_name: z.string().nullable(),
    amount: z.number().nullable(),
    unit: z.string().nullable(),
});

const fridgeItemSchema = z.object({
    id: z.string(),
    location_id: z.string(),
    /** The name of the location the item is filed in. */
    location: z.string(),
    kind: z.enum(["food", "supply"]),
    display_name: z.string(),
    amount: z.number(),
    unit: z.string(),
    expires_on: z.string().nullable(),
    /** Whole days from the household's today to `expires_on` (negative once past), null when undated. */
    days_left: z.number().nullable(),
    notices: z.array(NOTICE_SCHEMA),
});

export const GET_FRIDGE_OUTPUT_SCHEMA = z.object({
    locations: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            sort_order: z.number(),
            items: z.array(fridgeItemSchema),
        }),
    ),
});

export const LIST_EXPIRING_OUTPUT_SCHEMA = z.object({
    items: z.array(
        z.object({
            id: z.string(),
            display_name: z.string(),
            amount: z.number(),
            unit: z.string(),
            expires_on: z.string(),
            /** The name of the location the item is filed in. */
            location: z.string(),
            /** Whole days from the household's today to `expires_on` (negative once past). */
            days_left: z.number(),
            /** The recipe to use it in: the first cookable one that uses it. */
            recipe: z.object({ id: z.string(), name: z.string() }).nullable(),
        }),
    ),
    /** The cookable recipe that uses the most of the listed items (two or more), or null. */
    featured: z
        .object({
            id: z.string(),
            name: z.string(),
            /** How many of the listed items it uses. */
            uses: z.number(),
            /** Prep plus cook minutes; null when either is unknown. */
            minutes: z.number().nullable(),
            /** Per portion; null when any ingredient's nutrition is unknown. */
            calories: z.number().nullable(),
            protein_g: z.number().nullable(),
            carbs_g: z.number().nullable(),
            fat_g: z.number().nullable(),
        })
        .nullable(),
});

// The stock ledger rounds amounts to one decimal place (`roundAmount` in
// domain/stock.ts); so does the check that decides whether tossing an amount
// leaves anything of the item.
function roundStockAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

function shortfallText(
    rows: { displayName: string; amount: number; unit: string }[],
): string {
    if (rows.length === 0) return "";
    return (
        " Shortfall: " +
        rows
            .map((row) => `${row.displayName} ${row.amount} ${row.unit}`)
            .join("; ") +
        "."
    );
}

export function registerFridgeTools(server: McpServer, ctx: ToolContext) {
    const {
        callerHouseholdId,
        analytics,
        actorUserId,
        requireHouseholdMemberId,
        uiMeta,
        runDestructive,
    } = ctx;
    server.registerTool(
        "get_fridge",
        {
            title: "Get Fridge",
            description:
                "List household fridge and pantry locations with the items filed in each. Use the location ids for add_fridge_item. Each item includes `notices` for expiry when dated.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: GET_FRIDGE_OUTPUT_SCHEMA,
            ...uiMeta("fridge"),
        },
        async () =>
            withAnalytics(
                "get_fridge",
                async () => {
                    const householdId = await callerHouseholdId();
                    const [
                        { locations, items },
                        today,
                        groceryLines,
                        allFoods,
                    ] = await Promise.all([
                        listFridge(liveFridgeStore(), householdId),
                        householdToday(householdId),
                        liveGroceryStore().listLines(householdId),
                        liveFoodsStore().listFoods(householdId),
                    ]);
                    const foodsById = new Map(
                        allFoods.map((row) => [
                            row.id,
                            { id: row.id, genericFoodId: row.genericFoodId },
                        ]),
                    );
                    const groceryCtx = { lines: groceryLines, foodsById };
                    const payload = {
                        locations: locations.map((row) => ({
                            id: row.id,
                            name: row.name,
                            sort_order: row.sortOrder,
                            items: items
                                .filter((item) => item.locationId === row.id)
                                .map((item) => ({
                                    id: item.id,
                                    location_id: item.locationId,
                                    location: row.name,
                                    kind: item.kind,
                                    display_name: item.displayName,
                                    amount: item.quantity.amount,
                                    unit: item.quantity.unit,
                                    expires_on: item.expiresOn ?? null,
                                    days_left: item.expiresOn
                                        ? daysUntilExpiry(today, item.expiresOn)
                                        : null,
                                    notices: sortNotices(
                                        fridgeNotices(
                                            [item],
                                            today,
                                            groceryCtx,
                                        ),
                                    ).map(noticeToWire),
                                })),
                        })),
                    };
                    const itemCount = payload.locations.reduce(
                        (n, loc) => n + loc.items.length,
                        0,
                    );
                    const text =
                        payload.locations.length === 0
                            ? "No fridge locations."
                            : itemCount === 0
                              ? payload.locations
                                    .map((row) => `${row.name} ${row.id}`)
                                    .join("\n") + "\nFridge is empty."
                              : payload.locations
                                    .map((row) => {
                                        const lines =
                                            row.items.length === 0
                                                ? "  (empty)"
                                                : row.items
                                                      .map(
                                                          (item) =>
                                                              `  ${item.display_name} ${item.amount} ${item.unit}${item.expires_on ? ` exp ${item.expires_on}` : ""} ${item.id}`,
                                                      )
                                                      .join("\n");
                                        return `${row.name} ${row.id}\n${lines}`;
                                    })
                                    .join("\n");
                    return {
                        content: [{ type: "text", text }],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    registerWidgetResource(server, ctx, {
        key: "fridge",
        resourceName: "fridge-widget",
        title: "Fridge",
        description:
            "Interactive UI for get_fridge: locations with their items, with automatic light/dark theming.",
    });

    server.registerTool(
        "add_fridge_location",
        {
            title: "Add Fridge Location",
            description: "Add a named fridge or pantry location.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                name: z.string().min(1).describe("Location name"),
            }),
            outputSchema: z.object({
                id: z.string(),
                name: z.string(),
            }),
        },
        async (args) =>
            withAnalytics(
                "add_fridge_location",
                async () => {
                    const householdId = await callerHouseholdId();
                    const location = await addLocation(
                        liveFridgeStore(),
                        householdId,
                        args.name,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Added ${location.name} ${location.id}`,
                            },
                        ],
                        structuredContent: {
                            id: location.id,
                            name: location.name,
                        },
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "delete_fridge_location",
        {
            title: "Delete Fridge Location",
            description:
                "Delete a fridge location and the items filed under it.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string().describe("Location id"),
            }),
        },
        async (args) =>
            withAnalytics(
                "delete_fridge_location",
                async () => {
                    const run = await runDestructive(
                        "delete_fridge_location",
                        async (rec, householdId) => {
                            const store = liveFridgeStore();
                            const location = (
                                await store.listLocations(householdId)
                            ).find((row) => row.id === args.id);
                            const items = location
                                ? (await store.listItems(householdId)).filter(
                                      (item) => item.locationId === args.id,
                                  ).length
                                : 0;
                            // The items go with their location, so they are
                            // recorded with it.
                            const report = await rec.captureCascade(
                                "fridge_locations",
                                [{ id: args.id }],
                            );
                            await captureDismissals(
                                rec,
                                householdId,
                                dismissedOn(
                                    "fridge_item",
                                    (await store.listItems(householdId))
                                        .filter(
                                            (item) =>
                                                item.locationId === args.id,
                                        )
                                        .map((item) => item.id),
                                ),
                            );
                            const deleted = await deleteLocation(
                                store,
                                householdId,
                                args.id,
                            );
                            return {
                                value: { deleted },
                                summary: `Deleted fridge location ${location?.name ?? args.id}${items > 0 ? ` and its ${items} item${items === 1 ? "" : "s"}` : ""}${uncapturedNote(report.uncaptured)}`,
                                changed: deleted,
                            };
                        },
                    );
                    if (run.refused) return run.result;
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text: withUndo(
                                    run.value.deleted
                                        ? `Deleted location ${args.id}.`
                                        : `No location found with id ${args.id}.`,
                                    run.undo,
                                ),
                            },
                        ],
                    };
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    server.registerTool(
        "add_fridge_item",
        {
            title: "Add Fridge Item",
            description:
                "Add a food or supply to a fridge location. Food defaults to the catalog food's default_unit when unit is omitted. Pass a barcode for packaged food, a name for a manual food, and name plus unit for a supply.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                location_id: z.string(),
                kind: z.enum(["food", "supply"]),
                amount: z.coerce.number(),
                name: z.string().optional(),
                barcode: z.string().optional(),
                food_id: z.string().optional(),
                unit: z.string().optional(),
                on_similar: ON_SIMILAR_INPUT,
                new_food: NEW_FOOD_INPUT,
            }),
            outputSchema: ADD_FRIDGE_ITEM_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "add_fridge_item",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveFridgeStore();
                    const foods = liveFoodsStore();
                    const onSimilar = onSimilarFor(args);
                    const similarNull = {
                        status: "similar_foods" as const,
                        similar_foods: [] as z.infer<
                            typeof SIMILAR_FOODS_ENTRY
                        >[],
                        id: null,
                        display_name: null,
                        amount: null,
                        unit: null,
                    };
                    try {
                        const prepared =
                            args.kind === "supply"
                                ? await prepareAddSupply(store, foods, {
                                      householdId,
                                      locationId: args.location_id,
                                      name: args.name ?? "",
                                      amount: args.amount,
                                      unit: args.unit ?? "",
                                      foodId: args.food_id,
                                      onSimilar,
                                  })
                                : args.food_id
                                  ? await prepareAddFoodById(store, foods, {
                                        householdId,
                                        locationId: args.location_id,
                                        foodId: args.food_id,
                                        amount: args.amount,
                                        unit: args.unit,
                                    })
                                  : args.barcode
                                    ? await prepareAddFoodByBarcode(
                                          store,
                                          foods,
                                          {
                                              householdId,
                                              locationId: args.location_id,
                                              barcode: args.barcode,
                                              amount: args.amount,
                                              unit: args.unit,
                                          },
                                          {
                                              lookup: (barcode) =>
                                                  lookupBarcode(barcode, {
                                                      householdId,
                                                  }),
                                          },
                                      )
                                    : await prepareAddManualFood(store, foods, {
                                          householdId,
                                          locationId: args.location_id,
                                          name: args.name ?? "",
                                          amount: args.amount,
                                          unit: args.unit,
                                          onSimilar,
                                      });
                        const added = await addFridgeItemAdjust(
                            store,
                            liveStockStore(),
                            foods,
                            {
                                householdId: prepared.householdId,
                                foodId: prepared.food.id,
                                amount: prepared.amount,
                                unit: prepared.unit,
                                locationId: prepared.locationId,
                            },
                        );
                        const item = added.item;
                        if (!item) {
                            throw new Error("Could not add fridge item.");
                        }
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Added ${item.displayName} ${item.quantity.amount} ${item.quantity.unit} ${item.id}`,
                                },
                            ],
                            structuredContent: {
                                status: "ok" as const,
                                similar_foods: [],
                                id: item.id,
                                display_name: item.displayName,
                                amount: item.quantity.amount,
                                unit: item.quantity.unit,
                            },
                        };
                    } catch (err) {
                        if (err instanceof SimilarFoodsError) {
                            const wire = similarFoodsWire(err.entries);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: similarFoodsText(err.entries),
                                    },
                                ],
                                structuredContent: {
                                    ...similarNull,
                                    similar_foods: wire,
                                },
                            };
                        }
                        if (
                            err instanceof FridgeInputError ||
                            err instanceof StockInputError
                        ) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
            ),
    );

    server.registerTool(
        "update_fridge_item",
        {
            title: "Update Fridge Item",
            description:
                "Change a fridge item's quantity and/or move it to another location.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
                amount: z.coerce.number().optional(),
                unit: z.string().optional(),
                location_id: z.string().optional(),
            }),
        },
        async (args) =>
            withAnalytics(
                "update_fridge_item",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveFridgeStore();
                    try {
                        if (args.amount != null) {
                            const updated =
                                await updateFridgeItemQuantityAdjust(
                                    store,
                                    liveStockStore(),
                                    liveFoodsStore(),
                                    {
                                        householdId,
                                        itemId: args.id,
                                        amount: args.amount,
                                        unit: args.unit,
                                    },
                                );
                            if (!updated) {
                                throw new Error(
                                    `No fridge item found with id ${args.id}.`,
                                );
                            }
                        }
                        if (args.location_id != null) {
                            const moved = await moveItem(
                                store,
                                householdId,
                                args.id,
                                args.location_id,
                            );
                            if (!moved) {
                                throw new Error(
                                    `No fridge item found with id ${args.id}.`,
                                );
                            }
                        }
                        if (args.amount == null && args.location_id == null) {
                            throw new Error("Pass amount and/or location_id.");
                        }
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Updated fridge item ${args.id}.`,
                                },
                            ],
                        };
                    } catch (err) {
                        if (
                            err instanceof FridgeInputError ||
                            err instanceof StockInputError
                        ) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
            ),
    );

    server.registerTool(
        "delete_fridge_item",
        {
            title: "Delete Fridge Item",
            description: "Remove one fridge item.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
            }),
        },
        async (args) =>
            withAnalytics(
                "delete_fridge_item",
                async () => {
                    try {
                        const run = await runDestructive(
                            "delete_fridge_item",
                            async (rec, householdId) => {
                                const fridge = liveFridgeStore();
                                const item = (
                                    await fridge.listItems(householdId)
                                ).find((row) => row.id === args.id);
                                // Captured before the write, so the stock
                                // movement it adds is recorded too.
                                await rec.captureCascade("fridge_items", [
                                    { id: args.id },
                                ]);
                                await captureDismissals(
                                    rec,
                                    householdId,
                                    dismissedOn("fridge_item", [args.id]),
                                );
                                const deleted = await deleteFridgeItemAdjust(
                                    fridge,
                                    liveStockStore(),
                                    liveFoodsStore(),
                                    { householdId, itemId: args.id },
                                );
                                return {
                                    value: { deleted },
                                    summary: `Deleted fridge item ${item?.displayName ?? args.id}`,
                                    changed: deleted,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(
                                        run.value.deleted
                                            ? `Deleted fridge item ${args.id}.`
                                            : `No fridge item found with id ${args.id}.`,
                                        run.undo,
                                    ),
                                },
                            ],
                        };
                    } catch (err) {
                        if (
                            err instanceof FridgeInputError ||
                            err instanceof StockInputError
                        ) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    registerV2OnlyWidgetResource(server, ctx, {
        key: "use-soon",
        resourceName: "use-soon",
        title: "Use soon",
        description:
            "Items about to expire and the recipe that uses them, for list_expiring.",
        flag: "widget-use-soon",
    });

    server.registerTool(
        "list_expiring",
        {
            title: "List Expiring",
            description:
                "List fridge items that expire within the given number of days (default 3), including already expired items. Oldest first.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                days: z.coerce.number().int().min(0).max(365).optional(),
            }),
            outputSchema: LIST_EXPIRING_OUTPUT_SCHEMA,
            ...uiMetaForKey(ctx, "use-soon", {
                v2: true,
                flag: "widget-use-soon",
            }),
        },
        async (args) =>
            withAnalytics(
                "list_expiring",
                async () => {
                    const householdId = await callerHouseholdId();
                    const [{ locations, items }, today] = await Promise.all([
                        listFridge(liveFridgeStore(), householdId),
                        householdToday(householdId),
                    ]);
                    const expiring = listExpiring(items, today, args.days ?? 3);
                    const locationNames = new Map(
                        locations.map((row) => [row.id, row.name]),
                    );
                    // Recipes are only read when something is expiring: the
                    // same inputs the household app's Use soon section reads.
                    let uses: ReturnType<typeof useSoonFromPrefetch> = {
                        uses: [],
                        best: null,
                    };
                    if (expiring.length > 0) {
                        const recipesStore = liveRecipesStore();
                        const [recipes, allIngredients] = await Promise.all([
                            listRecipes(recipesStore, householdId),
                            recipesStore.listIngredientsForHousehold(
                                householdId,
                            ),
                        ]);
                        const foodsById = await effectiveFoodsByIds(
                            liveFoodsStore(),
                            householdId,
                            allIngredients.map((row) => row.foodId),
                        );
                        uses = useSoonFromPrefetch(
                            {
                                recipes,
                                allIngredients,
                                fridgeItems: items,
                                foodsById,
                            },
                            expiring,
                        );
                    }
                    const recipeFor = new Map(
                        uses.uses.map((use) => [
                            use.item.id,
                            use.recipes[0] ?? null,
                        ]),
                    );
                    const best = uses.best;
                    const payload = {
                        items: expiring.map((item) => {
                            const recipe = recipeFor.get(item.id) ?? null;
                            return {
                                id: item.id,
                                display_name: item.displayName,
                                amount: item.quantity.amount,
                                unit: item.quantity.unit,
                                expires_on: item.expiresOn ?? "",
                                location:
                                    locationNames.get(item.locationId) ?? "",
                                days_left: item.expiresOn
                                    ? daysUntilExpiry(today, item.expiresOn)
                                    : 0,
                                recipe: recipe
                                    ? { id: recipe.recipeId, name: recipe.name }
                                    : null,
                            };
                        }),
                        featured: best
                            ? (() => {
                                  const macros = best.row.macrosPerPortion;
                                  const known = !macros.incomplete;
                                  return {
                                      id: best.row.recipe.id,
                                      name: best.row.recipe.name,
                                      uses: best.itemCount,
                                      minutes: recipeTotalMinutes(
                                          best.row.recipe,
                                      ),
                                      calories: known ? macros.calories : null,
                                      protein_g: known
                                          ? macros.protein_g
                                          : null,
                                      carbs_g: known ? macros.carbs_g : null,
                                      fat_g: known ? macros.fat_g : null,
                                  };
                              })()
                            : null,
                    };
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    payload.items.length === 0
                                        ? "Nothing expiring soon."
                                        : payload.items
                                              .map((item) =>
                                                  fridgeExpiryLine({
                                                      name: item.display_name,
                                                      amount: item.amount,
                                                      unit: item.unit,
                                                      expiresOn:
                                                          item.expires_on,
                                                  }),
                                              )
                                              .join("\n"),
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "eat_fridge_item",
        {
            title: "Eat Fridge Item",
            description:
                "Deduct a fridge item as eaten (oldest-lot item, never negative) and log a food-backed meal through the same meal-items path as log_meal. Household supplies (kind 'supply') are deducted as used and log no meal (meal_id null).",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
                amount: z.coerce.number().optional(),
                meal_type: z
                    .enum(["breakfast", "lunch", "dinner", "snack"])
                    .optional(),
                member_id: z.string().optional(),
            }),
            outputSchema: z.object({
                shortfall: z
                    .object({
                        amount: z.number(),
                        unit: z.string(),
                    })
                    .nullable(),
                meal_id: z.string().nullable(),
            }),
        },
        async (args) =>
            withAnalytics(
                "eat_fridge_item",
                async () => {
                    const householdId = await callerHouseholdId();
                    const eaterId = args.member_id
                        ? await requireHouseholdMemberId(args.member_id)
                        : await actorUserId(undefined);
                    try {
                        const eaten = await eatFridgeItem(
                            liveFridgeStore(),
                            liveStockStore(),
                            liveFoodsStore(),
                            {
                                householdId,
                                itemId: args.id,
                                amount: args.amount,
                                actorUserId: eaterId,
                            },
                        );
                        const applied = Math.abs(eaten.movement.delta);
                        let mealId: string | null = null;
                        // Names an eaten food whose nutrition could not be
                        // worked out (a per-100 ml food kept in grams with no
                        // density), so the meal is not silently blank.
                        let unknownNote = "";
                        const foodId = eaten.itemBefore.foodId;
                        if (applied > 0 && foodId) {
                            const food = await findFoodById(
                                liveFoodsStore(),
                                householdId,
                                foodId,
                            );
                            if (!fridgeEatLogsMeal(food)) {
                                const payload = {
                                    shortfall: eaten.shortfall
                                        ? {
                                              amount: eaten.shortfall.amount,
                                              unit: eaten.shortfall.unit,
                                          }
                                        : null,
                                    meal_id: null as string | null,
                                };
                                return {
                                    content: [
                                        {
                                            type: "text" as const,
                                            text: `Used ${applied} ${eaten.itemBefore.quantity.unit} of ${eaten.itemBefore.displayName}.`,
                                        },
                                    ],
                                    structuredContent: payload,
                                };
                            }
                            const { built, specs } = await resolveAndBuildMeal({
                                householdId,
                                foods: liveFoodsStore(),
                                recipes: liveRecipesStore(),
                                items: [
                                    {
                                        foodId,
                                        amount: applied,
                                        unit: eaten.itemBefore.quantity.unit,
                                        name: eaten.itemBefore.displayName,
                                    },
                                ],
                            });
                            const { meal } = await insertMeal(eaterId, {
                                description: descriptionFromItems(built.items),
                                meal_type: args.meal_type ?? "snack",
                                calories: built.totals.calories ?? undefined,
                                protein_g: built.totals.protein_g ?? undefined,
                                carbs_g: built.totals.carbs_g ?? undefined,
                                fat_g: built.totals.fat_g ?? undefined,
                                fiber_g: built.totals.fiber_g ?? undefined,
                                sugar_g: built.totals.sugar_g ?? undefined,
                                alcohol_g: built.totals.alcohol_g ?? undefined,
                                caffeine_mg:
                                    built.totals.caffeine_mg ?? undefined,
                                items: built.items.map((item) =>
                                    snapshotToMealItemWrite(item, householdId),
                                ),
                                item_digest: itemListDigest(specs),
                            });
                            mealId = meal.id;
                            if (built.unknownItems.length > 0) {
                                unknownNote = ` Nutrition unknown for: ${built.unknownItems.join(", ")}.`;
                            }
                            await liveStockStore().linkMeal(
                                householdId,
                                eaten.movement.id,
                                meal.id,
                            );
                        }
                        const payload = {
                            shortfall: eaten.shortfall
                                ? {
                                      amount: eaten.shortfall.amount,
                                      unit: eaten.shortfall.unit,
                                  }
                                : null,
                            meal_id: mealId,
                        };
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Ate ${applied} ${eaten.itemBefore.quantity.unit} ${eaten.itemBefore.displayName}.${shortfallText(
                                        eaten.shortfall
                                            ? [eaten.shortfall]
                                            : [],
                                    )}${unknownNote}`,
                                },
                            ],
                            structuredContent: payload,
                        };
                    } catch (err) {
                        if (
                            err instanceof StockInputError ||
                            err instanceof MealItemsError
                        ) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
            ),
    );

    server.registerTool(
        "discard_fridge_item",
        {
            title: "Discard Fridge Item",
            description:
                "Toss a fridge item. Records a discard movement and never goes negative.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
                amount: z.coerce.number().optional(),
            }),
        },
        async (args) =>
            withAnalytics(
                "discard_fridge_item",
                async () => {
                    try {
                        const run = await runDestructive(
                            "discard_fridge_item",
                            async (rec, householdId) => {
                                const fridge = liveFridgeStore();
                                const item = (
                                    await fridge.listItems(householdId)
                                ).find((row) => row.id === args.id);
                                // Tossing all of an item removes it; tossing
                                // part of it lowers the amount. The row is
                                // recorded as the one it will become.
                                const tossing =
                                    args.amount ?? item?.quantity.amount ?? 0;
                                const removes =
                                    !item ||
                                    roundStockAmount(
                                        item.quantity.amount -
                                            Math.min(
                                                item.quantity.amount,
                                                tossing,
                                            ),
                                    ) <= 0;
                                if (removes) {
                                    // The row goes, and with it what points
                                    // at it: movements and grocery sources.
                                    await rec.captureCascade("fridge_items", [
                                        { id: args.id },
                                    ]);
                                    await captureDismissals(
                                        rec,
                                        householdId,
                                        dismissedOn("fridge_item", [args.id]),
                                    );
                                } else {
                                    await rec.captureByIds(
                                        "fridge_items",
                                        [args.id],
                                        "updated",
                                    );
                                }
                                const tossed = await discardFridgeItem(
                                    fridge,
                                    liveStockStore(),
                                    liveFoodsStore(),
                                    {
                                        householdId,
                                        itemId: args.id,
                                        amount: args.amount,
                                    },
                                );
                                // The row was recorded as the state it was
                                // expected to end in. If the ledger decided
                                // otherwise, record nothing rather than a
                                // snapshot that cannot be undone.
                                const remains = (
                                    await fridge.listItems(householdId)
                                ).some((row) => row.id === args.id);
                                if (remains === removes) {
                                    throw new Error(
                                        "The fridge item changed while it was being tossed. Nothing was changed; try again.",
                                    );
                                }
                                return {
                                    value: { tossed },
                                    summary: `Tossed ${Math.abs(tossed.movement.delta)} ${tossed.movement.unit} of ${item?.displayName ?? args.id}`,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { tossed } = run.value;
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(
                                        `Tossed ${Math.abs(tossed.movement.delta)} ${tossed.movement.unit}.${shortfallText(
                                            tossed.shortfall
                                                ? [tossed.shortfall]
                                                : [],
                                        )}`,
                                        run.undo,
                                    ),
                                },
                            ],
                        };
                    } catch (err) {
                        if (err instanceof StockInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );
}
