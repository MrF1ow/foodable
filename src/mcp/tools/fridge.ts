import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
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
    deleteFridgeItemAdjust,
    discardFridgeItem,
    eatFridgeItem,
    fridgeEatLogsMeal,
    listExpiring,
    StockInputError,
    updateFridgeItemQuantityAdjust,
} from "../../domain/stock.js";
import { findFoodById } from "../../domain/foods.js";
import {
    descriptionFromItems,
    itemListDigest,
    MealItemsError,
    resolveAndBuildMeal,
} from "../../domain/meals.js";
import { insertMeal, snapshotToMealItemWrite } from "../../db/nutrition.js";
import { liveRecipesStore } from "../../db/recipes.js";
import { getWidgetHtml } from "../../widgets.js";
import { WIDGET_LOCALE } from "../../routes.js";
import {
    APP_UI_MIME_TYPE,
    FRIDGE_WIDGET_URI,
    type ToolContext,
} from "../shared.js";

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
    } = ctx;
    const fridgeItemSchema = z.object({
        id: z.string(),
        location_id: z.string(),
        kind: z.enum(["food", "supply"]),
        display_name: z.string(),
        amount: z.number(),
        unit: z.string(),
        expires_on: z.string().nullable(),
    });
    server.registerTool(
        "get_fridge",
        {
            title: "Get Fridge",
            description:
                "List household fridge and pantry locations with the items filed in each. Use the location ids for add_fridge_item.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: z.object({
                locale: z.string(),
                locations: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                        sort_order: z.number(),
                        items: z.array(fridgeItemSchema),
                    }),
                ),
            }),
            ...uiMeta(FRIDGE_WIDGET_URI),
        },
        async () =>
            withAnalytics(
                "get_fridge",
                async () => {
                    const householdId = await callerHouseholdId();
                    const { locations, items } = await listFridge(
                        liveFridgeStore(),
                        householdId,
                    );
                    const payload = {
                        locale: WIDGET_LOCALE,
                        locations: locations.map((row) => ({
                            id: row.id,
                            name: row.name,
                            sort_order: row.sortOrder,
                            items: items
                                .filter((item) => item.locationId === row.id)
                                .map((item) => ({
                                    id: item.id,
                                    location_id: item.locationId,
                                    kind: item.kind,
                                    display_name: item.displayName,
                                    amount: item.quantity.amount,
                                    unit: item.quantity.unit,
                                    expires_on: item.expiresOn ?? null,
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

    server.registerResource(
        "fridge-widget",
        FRIDGE_WIDGET_URI,
        {
            title: "Fridge",
            description:
                "Interactive UI for get_fridge: locations with their items, with automatic light/dark theming.",
            mimeType: APP_UI_MIME_TYPE,
        },
        async (uri) => {
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: APP_UI_MIME_TYPE,
                        text: await getWidgetHtml("fridge"),
                        _meta: { ui: { prefersBorder: true } },
                    },
                ],
            };
        },
    );

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
                    const householdId = await callerHouseholdId();
                    const deleted = await deleteLocation(
                        liveFridgeStore(),
                        householdId,
                        args.id,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: deleted
                                    ? `Deleted location ${args.id}.`
                                    : `No location found with id ${args.id}.`,
                            },
                        ],
                    };
                },
                analytics,
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
            }),
            outputSchema: z.object({
                id: z.string(),
                display_name: z.string(),
                amount: z.number(),
                unit: z.string(),
            }),
        },
        async (args) =>
            withAnalytics(
                "add_fridge_item",
                async () => {
                    const householdId = await callerHouseholdId();
                    const store = liveFridgeStore();
                    const foods = liveFoodsStore();
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
                                          { lookup: lookupBarcode },
                                      )
                                    : await prepareAddManualFood(store, foods, {
                                          householdId,
                                          locationId: args.location_id,
                                          name: args.name ?? "",
                                          amount: args.amount,
                                          unit: args.unit,
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
                                id: item.id,
                                display_name: item.displayName,
                                amount: item.quantity.amount,
                                unit: item.quantity.unit,
                            },
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
                    const householdId = await callerHouseholdId();
                    try {
                        const deleted = await deleteFridgeItemAdjust(
                            liveFridgeStore(),
                            liveStockStore(),
                            liveFoodsStore(),
                            {
                                householdId,
                                itemId: args.id,
                            },
                        );
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: deleted
                                        ? `Deleted fridge item ${args.id}.`
                                        : `No fridge item found with id ${args.id}.`,
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
            outputSchema: z.object({
                items: z.array(
                    z.object({
                        id: z.string(),
                        display_name: z.string(),
                        amount: z.number(),
                        unit: z.string(),
                        expires_on: z.string(),
                    }),
                ),
            }),
        },
        async (args) =>
            withAnalytics(
                "list_expiring",
                async () => {
                    const householdId = await callerHouseholdId();
                    const { items } = await listFridge(
                        liveFridgeStore(),
                        householdId,
                    );
                    const expiring = listExpiring(items, args.days ?? 3);
                    const payload = {
                        items: expiring.map((item) => ({
                            id: item.id,
                            display_name: item.displayName,
                            amount: item.quantity.amount,
                            unit: item.quantity.unit,
                            expires_on: item.expiresOn ?? "",
                        })),
                    };
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    payload.items.length === 0
                                        ? "Nothing expiring soon."
                                        : payload.items
                                              .map(
                                                  (item) =>
                                                      `${item.display_name} ${item.amount} ${item.unit} expires ${item.expires_on}`,
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
                "Deduct a fridge item as eaten (oldest-lot item, never negative) and log a food-backed meal through the same meal-items path as log_meal.",
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
                                    )}`,
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
                    const householdId = await callerHouseholdId();
                    try {
                        const tossed = await discardFridgeItem(
                            liveFridgeStore(),
                            liveStockStore(),
                            liveFoodsStore(),
                            {
                                householdId,
                                itemId: args.id,
                                amount: args.amount,
                            },
                        );
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Tossed ${Math.abs(tossed.movement.delta)} ${tossed.movement.unit}.${shortfallText(
                                        tossed.shortfall
                                            ? [tossed.shortfall]
                                            : [],
                                    )}`,
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
            ),
    );
}
