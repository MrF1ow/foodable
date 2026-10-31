import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { withAnalytics } from "../../analytics.js";
import { lookupBarcode } from "../../foods.js";
import { alreadyHaveTag } from "../../domain/linking.js";
import { listFridge } from "../../domain/fridge.js";
import { foodsByIds } from "../../domain/foods.js";
import {
    addGroceryFoodByBarcode,
    addGroceryFoodById,
    addGroceryManualFood,
    addGrocerySupply,
    checkGroceryLine,
    clearCheckedLines,
    listGrocery,
} from "../../domain/grocery.js";
import { putAwayGroceryLines, StockInputError } from "../../domain/stock.js";
import { getWidgetHtml } from "../../widgets.js";
import { WIDGET_LOCALE } from "../../routes.js";
import {
    groceryLineExtras,
    APP_UI_MIME_TYPE,
    GROCERY_LIST_WIDGET_URI,
} from "../shared.js";
import type { ToolContext } from "../shared.js";

export function registerGroceryTools(server: McpServer, ctx: ToolContext) {
    const { callerHouseholdId, analytics, uiMeta } = ctx;
    const groceryLineSchema = z.object({
        id: z.string(),
        store_id: z.string(),
        section_id: z.string(),
        display_name: z.string(),
        amount: z.number(),
        unit: z.string(),
        checked: z.boolean(),
        already_have: z.string().nullable(),
    });
    server.registerTool(
        "list_grocery_lines",
        {
            title: "List Grocery Lines",
            description:
                "List grocery lines grouped by store and section, with already-have against the fridge.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: z.object({
                locale: z.string(),
                stores: z.array(
                    z.object({
                        id: z.string(),
                        name: z.string(),
                        sections: z.array(
                            z.object({
                                id: z.string(),
                                name: z.string(),
                                lines: z.array(groceryLineSchema),
                            }),
                        ),
                    }),
                ),
            }),
            ...uiMeta(GROCERY_LIST_WIDGET_URI),
        },
        async () =>
            withAnalytics(
                "list_grocery_lines",
                async () => {
                    const householdId = await callerHouseholdId();
                    const snapshot = await listGrocery(
                        liveGroceryStore(),
                        liveSettingsStore(),
                        householdId,
                    );
                    const fridge = await listFridge(
                        liveFridgeStore(),
                        householdId,
                    );
                    const foods = await foodsByIds(
                        liveFoodsStore(),
                        householdId,
                        [
                            ...snapshot.lines.map((line) => line.foodId),
                            ...fridge.items.map((item) => item.foodId),
                        ],
                    );
                    const stock = fridge.items.map((item) => ({
                        quantity: item.quantity,
                        foodId: item.foodId,
                    }));
                    const linePayload = (
                        line: (typeof snapshot.lines)[number],
                    ) => {
                        const tag = alreadyHaveTag(
                            {
                                quantity: line.quantity,
                                foodId: line.foodId,
                            },
                            stock,
                            foods,
                        );
                        return {
                            id: line.id,
                            store_id: line.storeId,
                            section_id: line.sectionId,
                            display_name: line.displayName,
                            amount: line.quantity.amount,
                            unit: line.quantity.unit,
                            checked: line.checked,
                            already_have:
                                tag == null
                                    ? null
                                    : tag.cover === "full"
                                      ? "already have"
                                      : `already have: have ${tag.have.amount} ${tag.have.unit}, need ${tag.need.amount} ${tag.need.unit}`,
                        };
                    };
                    const payload = {
                        locale: WIDGET_LOCALE,
                        stores: snapshot.stores.map((store) => ({
                            id: store.id,
                            name: store.name,
                            sections: snapshot.sections
                                .filter(
                                    (section) => section.storeId === store.id,
                                )
                                .map((section) => ({
                                    id: section.id,
                                    name: section.name,
                                    lines: snapshot.lines
                                        .filter(
                                            (line) =>
                                                line.sectionId === section.id,
                                        )
                                        .map(linePayload),
                                }))
                                .filter((section) => section.lines.length > 0),
                        })),
                    };
                    const lines = payload.stores.flatMap((store) =>
                        store.sections.flatMap((section) => section.lines),
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    lines.length === 0
                                        ? "Grocery list is empty."
                                        : lines
                                              .map((line) => {
                                                  const tag = line.already_have
                                                      ? ` [${line.already_have}]`
                                                      : "";
                                                  return `${line.display_name} ${line.amount} ${line.unit}${tag}`;
                                              })
                                              .join("\n"),
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    server.registerResource(
        "grocery-list-widget",
        GROCERY_LIST_WIDGET_URI,
        {
            title: "Grocery List",
            description:
                "Interactive UI for list_grocery_lines: stores, sections, and lines with already-have tags and check-off.",
            mimeType: APP_UI_MIME_TYPE,
        },
        async (uri) => {
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: APP_UI_MIME_TYPE,
                        text: await getWidgetHtml("grocery-list"),
                        _meta: { ui: { prefersBorder: true } },
                    },
                ],
            };
        },
    );

    server.registerTool(
        "add_grocery_line",
        {
            title: "Add Grocery Line",
            description:
                "Add a food or supply line to a grocery store. Omit section_id to let the server pick the section: where that food already sits, else the aisle its name suggests, else Other. Reports already-have when fridge stock matches, and allergen warnings for household members.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                store_id: z.string(),
                kind: z.enum(["food", "supply"]),
                amount: z.coerce.number(),
                name: z.string().optional(),
                barcode: z.string().optional(),
                food_id: z.string().optional(),
                unit: z.string().optional(),
                section_id: z.string().optional(),
            }),
            outputSchema: z.object({
                id: z.string(),
                display_name: z.string(),
                already_have: z.string().nullable(),
                warning: z.string().nullable(),
            }),
        },
        async (args) =>
            withAnalytics(
                "add_grocery_line",
                async () => {
                    const householdId = await callerHouseholdId();
                    const grocery = liveGroceryStore();
                    const settings = liveSettingsStore();
                    const foods = liveFoodsStore();
                    const line =
                        args.kind === "supply"
                            ? await addGrocerySupply(grocery, settings, foods, {
                                  householdId,
                                  storeId: args.store_id,
                                  sectionId: args.section_id,
                                  name: args.name ?? "",
                                  amount: args.amount,
                                  unit: args.unit ?? "",
                                  foodId: args.food_id,
                              })
                            : args.food_id
                              ? await addGroceryFoodById(
                                    grocery,
                                    settings,
                                    foods,
                                    {
                                        householdId,
                                        storeId: args.store_id,
                                        sectionId: args.section_id,
                                        foodId: args.food_id,
                                        amount: args.amount,
                                        unit: args.unit,
                                    },
                                )
                              : args.barcode
                                ? await addGroceryFoodByBarcode(
                                      grocery,
                                      settings,
                                      foods,
                                      {
                                          householdId,
                                          storeId: args.store_id,
                                          sectionId: args.section_id,
                                          barcode: args.barcode,
                                          amount: args.amount,
                                          unit: args.unit,
                                      },
                                      { lookup: lookupBarcode },
                                  )
                                : await addGroceryManualFood(
                                      grocery,
                                      settings,
                                      foods,
                                      {
                                          householdId,
                                          storeId: args.store_id,
                                          sectionId: args.section_id,
                                          name: args.name ?? "",
                                          amount: args.amount,
                                          unit: args.unit,
                                      },
                                  );
                    const extras = await groceryLineExtras(householdId, line);
                    const bits = [
                        `Added ${line.displayName} ${line.quantity.amount} ${line.quantity.unit}`,
                    ];
                    if (extras.alreadyHave) bits.push(extras.alreadyHave);
                    if (extras.warning) bits.push(extras.warning);
                    return {
                        content: [{ type: "text", text: bits.join(". ") }],
                        structuredContent: {
                            id: line.id,
                            display_name: line.displayName,
                            already_have: extras.alreadyHave,
                            warning: extras.warning,
                        },
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "check_grocery_line",
        {
            title: "Check Grocery Line",
            description:
                "Mark a grocery line checked or unchecked. Checking does not add the item to the fridge.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            inputSchema: z.object({
                id: z.string(),
                checked: z.boolean().optional(),
            }),
        },
        async (args) =>
            withAnalytics(
                "check_grocery_line",
                async () => {
                    const householdId = await callerHouseholdId();
                    const line = await checkGroceryLine(
                        liveGroceryStore(),
                        householdId,
                        args.id,
                        args.checked ?? true,
                    );
                    if (!line) {
                        throw new Error(
                            `No grocery line found with id ${args.id}.`,
                        );
                    }
                    return {
                        content: [
                            {
                                type: "text",
                                text: line.checked
                                    ? `Checked ${line.displayName}. Fridge unchanged.`
                                    : `Unchecked ${line.displayName}.`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "delete_grocery_line",
        {
            title: "Delete Grocery Line",
            description: "Remove one grocery line.",
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
                "delete_grocery_line",
                async () => {
                    const householdId = await callerHouseholdId();
                    const deleted = await liveGroceryStore().deleteLine(
                        householdId,
                        args.id,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: deleted
                                    ? `Deleted grocery line ${args.id}.`
                                    : `No grocery line found with id ${args.id}.`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "clear_checked_grocery_lines",
        {
            title: "Clear Checked Grocery Lines",
            description: "Remove every checked grocery line.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: true,
                openWorldHint: false,
            },
        },
        async () =>
            withAnalytics(
                "clear_checked_grocery_lines",
                async () => {
                    const householdId = await callerHouseholdId();
                    const removed = await clearCheckedLines(
                        liveGroceryStore(),
                        householdId,
                    );
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Cleared ${removed} checked line${removed === 1 ? "" : "s"}.`,
                            },
                        ],
                    };
                },
                analytics,
            ),
    );

    server.registerTool(
        "put_away_grocery_lines",
        {
            title: "Put Away Grocery Lines",
            description:
                "Move grocery lines into the fridge as a purchase. Defaults to each food's last-used location. Deletes the lines. Clear checked stays for lines you do not want stocked.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                line_ids: z.array(z.string()).min(1),
                location_id: z.string().optional(),
            }),
            outputSchema: z.object({
                put_away: z.array(
                    z.object({
                        line_id: z.string(),
                        display_name: z.string(),
                        fridge_item_id: z.string().nullable(),
                    }),
                ),
            }),
        },
        async (args) =>
            withAnalytics(
                "put_away_grocery_lines",
                async () => {
                    const householdId = await callerHouseholdId();
                    try {
                        const results = await putAwayGroceryLines(
                            liveGroceryStore(),
                            liveFridgeStore(),
                            liveStockStore(),
                            liveFoodsStore(),
                            {
                                householdId,
                                lineIds: args.line_ids,
                                locationId: args.location_id,
                            },
                        );
                        const payload = {
                            put_away: results.map((row) => ({
                                line_id: row.line.id,
                                display_name: row.line.displayName,
                                fridge_item_id: row.item?.id ?? null,
                            })),
                        };
                        return {
                            content: [
                                {
                                    type: "text",
                                    text:
                                        results.length === 0
                                            ? "Nothing to put away."
                                            : results
                                                  .map(
                                                      (row) =>
                                                          `Put away ${row.line.displayName}.`,
                                                  )
                                                  .join("\n"),
                                },
                            ],
                            structuredContent: payload,
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
