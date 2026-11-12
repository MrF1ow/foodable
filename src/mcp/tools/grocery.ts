import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { liveFridgeStore } from "../../db/fridge.js";
import { liveFoodsStore } from "../../db/foods.js";
import { liveNoticeDismissalsStore } from "../../db/notice-dismissals.js";
import {
    getHouseholdConfig,
    getHouseholdOwnerProfile,
} from "../../db/household.js";
import { householdToday } from "../../db/restock.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveSettingsStore } from "../../db/settings.js";
import { liveStockStore } from "../../db/stock.js";
import { withAnalytics } from "../../analytics.js";
import { lookupBarcode } from "../../foods.js";
import { alreadyHaveTag } from "../../domain/linking.js";
import { listFridge } from "../../domain/fridge.js";
import {
    effectiveFoodsByIds,
    foodsByIds,
    isUsualGroceryLine,
} from "../../domain/foods.js";
import {
    addGroceryFoodByBarcode,
    addGroceryFoodById,
    addGroceryManualFood,
    addGrocerySupply,
    allergenNotices,
    checkGroceryLine,
    clearCheckedLines,
    GROCERY_LINE_SOURCES,
    listGrocery,
    type GroceryAmountPickReason,
    type GroceryStorePickReason,
} from "../../domain/grocery.js";
import {
    dismissedKeySet,
    isDismissedIn,
} from "../../domain/notice-dismissals.js";
import { sortNotices } from "../../domain/notices.js";
import {
    groceryRestockNotices,
    usualsList,
    type UsualListRow,
} from "../../domain/restock.js";
import { RESTOCK_SCHEDULES } from "../../domain/foods.js";
import { householdTodayAt } from "../../household.js";
import { gatedTool } from "../gated.js";
import {
    NotedGroceryLineAmountRequiredError,
    putAwayGroceryLines,
    StockInputError,
} from "../../domain/stock.js";
import { WIDGET_LOCALE } from "../../routes.js";
import {
    groceryLineExtras,
    householdAllergenMembers,
    NOTICE_SCHEMA,
    NEW_FOOD_INPUT,
    ON_SIMILAR_INPUT,
    noticeToWire,
    onSimilarFor,
    similarFoodsText,
    similarFoodsWire,
    SIMILAR_FOODS_ENTRY,
    WRITE_STATUS,
    registerWidgetResource,
} from "../shared.js";
import type { ToolContext } from "../shared.js";
import { SimilarFoodsError } from "../../domain/foods.js";
import { GroceryInputError } from "../../domain/grocery.js";
import { WEEKDAY_NAMES } from "../../domain/weekdays.js";

export const ADD_GROCERY_LINE_OUTPUT_SCHEMA = z.object({
    status: WRITE_STATUS,
    similar_foods: z.array(SIMILAR_FOODS_ENTRY),
    id: z.string().nullable(),
    display_name: z.string().nullable(),
    already_have: z.string().nullable(),
    store_id: z.string().nullable(),
    amount: z.number().nullable(),
    unit: z.string().nullable(),
    notices: z.array(NOTICE_SCHEMA),
});

const groceryLineSchema = z.object({
    id: z.string(),
    store_id: z.string(),
    section_id: z.string(),
    display_name: z.string(),
    amount: z.number(),
    unit: z.string(),
    checked: z.boolean(),
    source: z.enum(GROCERY_LINE_SOURCES),
    source_fridge_item_id: z.string().nullable(),
    note: z.string().nullable(),
    already_have: z.string().nullable(),
    /** The name of the store the line is filed under. */
    store: z.string(),
    /** The usual product's display name when the line's food has one, else null. */
    product_name: z.string().nullable(),
    /** Whether the line is the household's usual product for its food. */
    usual: z.boolean(),
    product: z
        .object({
            food_id: z.string(),
            name: z.string(),
        })
        .nullable(),
    notices: z.array(NOTICE_SCHEMA),
});

export const GROCERY_LIST_OUTPUT_SCHEMA = z.object({
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
});

export const LIST_USUALS_OUTPUT_SCHEMA = z.object({
    /** The household's restock weekday, 0 = Sunday. */
    restock_weekday: z.number().int().min(0).max(6),
    restock_weekday_name: z.string(),
    /** Today in the household's time zone, `YYYY-MM-DD`. */
    today: z.string(),
    is_restock_day: z.boolean(),
    /** The household's restock automation switch; when off, due usuals are not added to the list on their own. */
    restock_enabled: z.boolean(),
    usuals: z.array(
        z.object({
            food_id: z.string(),
            name: z.string(),
            /** The usual product's display name; null when the food has none. */
            product_name: z.string().nullable(),
            store_id: z.string().nullable(),
            store_name: z.string().nullable(),
            /** The usual amount to add; null means 1 of the unit. */
            amount: z.number().nullable(),
            unit: z.string(),
            schedule: z.enum(RESTOCK_SCHEDULES).nullable(),
            /** N when the schedule is every_n_weeks, else null. */
            every_weeks: z.number().int().nullable(),
            last_restocked_on: z.string().nullable(),
            restock_when_low: z.boolean(),
            /** The level stock is compared with (in the unit); null when add-when-low is off. */
            low_level: z.number().nullable(),
            paused: z.boolean(),
            /** Why the usual is due now and what triggered it; null when it is not due. */
            due: z
                .object({
                    reason: z.string(),
                    trigger: z.enum(["schedule", "low"]),
                })
                .nullable(),
        }),
    ),
});

function usualWire(row: UsualListRow) {
    return {
        food_id: row.foodId,
        name: row.name,
        product_name: row.productName,
        store_id: row.storeId,
        store_name: row.storeName,
        amount: row.amount,
        unit: row.unit,
        schedule: row.schedule,
        every_weeks: row.everyWeeks,
        last_restocked_on: row.lastRestockedOn,
        restock_when_low: row.restockWhenLow,
        low_level: row.lowLevel,
        paused: row.paused,
        due: row.due,
    };
}

function usualLine(row: UsualListRow): string {
    const how = [
        row.schedule == null
            ? null
            : row.schedule === "every_n_weeks"
              ? row.everyWeeks == null
                  ? "every few weeks (not set)"
                  : `every ${row.everyWeeks} weeks`
              : row.schedule,
        row.restockWhenLow
            ? row.lowLevel == null
                ? "add when low (no level set)"
                : `add when below ${row.lowLevel} ${row.unit}`
            : null,
        row.paused ? "paused" : null,
    ].filter((part): part is string => part != null);
    const what = row.productName
        ? `${row.name} → ${row.productName}`
        : row.name;
    const status = row.due ? `DUE (${row.due.reason})` : "not due";
    return `- ${what}: ${how.join(", ")}; ${status}`;
}

export function registerGroceryTools(server: McpServer, ctx: ToolContext) {
    const { callerHouseholdId, analytics, uiMeta } = ctx;
    server.registerTool(
        "list_grocery_lines",
        {
            title: "List Grocery Lines",
            description:
                "List grocery lines grouped by store and section, with already-have against the fridge. Each line includes `notices` (e.g. allergens).",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: GROCERY_LIST_OUTPUT_SCHEMA,
            ...uiMeta("grocery-list"),
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
                    const foods = await effectiveFoodsByIds(
                        liveFoodsStore(),
                        householdId,
                        [
                            ...snapshot.lines.map((line) => line.foodId),
                            ...fridge.items.map((item) => item.foodId),
                        ],
                    );
                    // A usual line can be the product itself, whose usual is
                    // recorded on its generic food (shared with the Kitchen).
                    const generics = await foodsByIds(
                        liveFoodsStore(),
                        householdId,
                        snapshot.lines.map(
                            (line) =>
                                (line.foodId
                                    ? foods.get(line.foodId)?.genericFoodId
                                    : null) ?? null,
                        ),
                    );
                    const storeNames = new Map(
                        snapshot.stores.map((store) => [store.id, store.name]),
                    );
                    const allergenMembers =
                        await householdAllergenMembers(householdId);
                    const today = await householdToday(householdId);
                    const dismissals =
                        await liveNoticeDismissalsStore().listForHousehold(
                            householdId,
                        );
                    const dismissed = dismissedKeySet(dismissals);
                    const restockNotices = groceryRestockNotices(
                        snapshot.lines,
                        fridge.items,
                        today,
                    ).filter((n) => !isDismissedIn(n, dismissed));
                    const restockByLine = new Map(
                        restockNotices.map((n) => [n.subject.id, n]),
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
                        const eff = line.foodId
                            ? foods.get(line.foodId)
                            : undefined;
                        const restock = restockByLine.get(line.id);
                        const notices = sortNotices([
                            ...allergenNotices(
                                { kind: "grocery_line", id: line.id },
                                line.displayName,
                                allergenMembers,
                                eff ? eff.allergens : null,
                            ),
                            ...(restock ? [restock] : []),
                        ]).map(noticeToWire);
                        return {
                            id: line.id,
                            store_id: line.storeId,
                            section_id: line.sectionId,
                            display_name: line.displayName,
                            amount: line.quantity.amount,
                            unit: line.quantity.unit,
                            checked: line.checked,
                            source: line.source,
                            source_fridge_item_id: line.sourceFridgeItemId,
                            note: line.note,
                            already_have:
                                tag == null
                                    ? null
                                    : tag.cover === "full"
                                      ? "already have"
                                      : `already have: have ${tag.have.amount} ${tag.have.unit}, need ${tag.need.amount} ${tag.need.unit}`,
                            store: storeNames.get(line.storeId) ?? "",
                            product_name: eff?.product?.name ?? null,
                            usual: isUsualGroceryLine({
                                lineFoodId: line.foodId,
                                effectiveProductId: eff?.product?.id,
                                food: eff,
                                genericOf: (id) => generics.get(id),
                            }),
                            product: eff?.product
                                ? {
                                      food_id: eff.product.id,
                                      name: eff.product.name,
                                  }
                                : null,
                            notices,
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
                                                  const blockSuffix =
                                                      line.notices
                                                          .filter(
                                                              (n) =>
                                                                  n.severity ===
                                                                      "block" ||
                                                                  n.code ===
                                                                      "grocery.restocked",
                                                          )
                                                          .map(
                                                              (n) =>
                                                                  ` — ${n.message}`,
                                                          )
                                                          .join("");
                                                  const note =
                                                      line.note?.trim();
                                                  const lineText = note
                                                      ? `${line.display_name} · ${note}`
                                                      : `${line.display_name} ${line.amount} ${line.unit}`;
                                                  return `${lineText}${tag}${blockSuffix}`;
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

    registerWidgetResource(server, ctx, {
        key: "grocery-list",
        resourceName: "grocery-list-widget",
        title: "Grocery List",
        description:
            "Interactive UI for list_grocery_lines: stores, sections, and lines with already-have tags and check-off.",
    });

    server.registerTool(
        "add_grocery_line",
        {
            title: "Add Grocery Line",
            description:
                "Add a food or supply line to the grocery list. Pass store_id only when you want to choose the store; when store_id is omitted the server picks in order: that food's usual store, else a store where the food's family already has a line, else the first household store. Pass amount only when you want to choose the quantity; when amount is omitted the server uses the food's usual amount, else 1 of its default unit. Omit section_id to let the server pick the section within the chosen store: where that food already sits, else the aisle its name suggests, else Other. Reports already-have when fridge stock matches. Allergen matches for household members are in this result's `notices`.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                store_id: z.string().optional(),
                kind: z.enum(["food", "supply"]),
                amount: z.coerce.number().optional(),
                name: z.string().optional(),
                barcode: z.string().optional(),
                food_id: z.string().optional(),
                unit: z.string().optional(),
                section_id: z.string().optional(),
                on_similar: ON_SIMILAR_INPUT,
                new_food: NEW_FOOD_INPUT,
            }),
            outputSchema: ADD_GROCERY_LINE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "add_grocery_line",
                async () => {
                    const householdId = await callerHouseholdId();
                    const grocery = liveGroceryStore();
                    const settings = liveSettingsStore();
                    const foods = liveFoodsStore();
                    const onSimilar = onSimilarFor(args);
                    const similarNull = {
                        status: "similar_foods" as const,
                        similar_foods: [] as z.infer<
                            typeof SIMILAR_FOODS_ENTRY
                        >[],
                        id: null,
                        display_name: null,
                        already_have: null,
                        store_id: null,
                        amount: null,
                        unit: null,
                        notices: [],
                    };
                    try {
                        const stores = await settings.listStores(householdId);
                        const storeNameById = new Map(
                            stores.map((row) => [row.id, row.name]),
                        );
                        let storeReason: GroceryStorePickReason = "chosen";
                        let amountReason: GroceryAmountPickReason = "chosen";
                        const onPicked = (pick: {
                            storeId: string;
                            storeReason: GroceryStorePickReason;
                            quantity: { amount: number; unit: string };
                            amountReason: GroceryAmountPickReason;
                        }) => {
                            storeReason = pick.storeReason;
                            amountReason = pick.amountReason;
                        };
                        const line =
                            args.kind === "supply"
                                ? await addGrocerySupply(
                                      grocery,
                                      settings,
                                      foods,
                                      {
                                          householdId,
                                          storeId: args.store_id,
                                          sectionId: args.section_id,
                                          name: args.name ?? "",
                                          amount: args.amount,
                                          unit: args.unit ?? "",
                                          foodId: args.food_id,
                                          onPicked,
                                          onSimilar,
                                      },
                                  )
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
                                            onPicked,
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
                                              onPicked,
                                          },
                                          {
                                              lookup: (barcode) =>
                                                  lookupBarcode(barcode, {
                                                      householdId,
                                                  }),
                                          },
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
                                              onPicked,
                                              onSimilar,
                                          },
                                      );
                        const extras = await groceryLineExtras(
                            householdId,
                            line,
                        );
                        const storeName =
                            storeNameById.get(line.storeId) ?? line.storeId;
                        const parenthetical: string[] = [];
                        if (storeReason !== "chosen") {
                            if (storeReason === "usual") {
                                parenthetical.push("usual store");
                            } else if (storeReason === "list") {
                                parenthetical.push("already on the list there");
                            } else if (storeReason === "preferred") {
                                parenthetical.push("default store");
                            } else if (storeReason === "default") {
                                parenthetical.push("first store");
                            }
                        }
                        if (amountReason !== "chosen") {
                            if (amountReason === "usual") {
                                parenthetical.push("usual amount");
                            } else if (amountReason === "default") {
                                parenthetical.push("default amount");
                            }
                        }
                        const pickNote =
                            parenthetical.length > 0
                                ? ` (${parenthetical.join(", ")})`
                                : "";
                        const bits = [
                            `Added ${line.displayName} ${line.quantity.amount} ${line.quantity.unit} at ${storeName}${pickNote}`,
                        ];
                        if (extras.alreadyHave) bits.push(extras.alreadyHave);
                        if (extras.allergenText) bits.push(extras.allergenText);
                        return {
                            content: [{ type: "text", text: bits.join(". ") }],
                            structuredContent: {
                                status: "ok" as const,
                                similar_foods: [],
                                id: line.id,
                                display_name: line.displayName,
                                already_have: extras.alreadyHave,
                                store_id: line.storeId,
                                amount: line.quantity.amount,
                                unit: line.quantity.unit,
                                notices: extras.notices.map(noticeToWire),
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
                        if (err instanceof GroceryInputError) {
                            throw new Error(err.message);
                        }
                        throw err;
                    }
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
                        (args.checked ?? true)
                            ? {
                                  foods: liveFoodsStore(),
                                  today: await householdToday(householdId),
                              }
                            : undefined,
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
                "Move grocery lines into the fridge as a purchase. Defaults to each food's last-used location. Optional product_food_ids maps each grocery line id to the product actually bought (defaults to the food's usual product). Optional amounts gives the real quantity for each line (required for to-taste lines that only carry a placeholder on the list). line_ids stays a plain list for backward compatibility. Deletes the lines. Clear checked stays for lines you do not want stocked.",
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            },
            inputSchema: z.object({
                line_ids: z.array(z.string()).min(1),
                location_id: z.string().optional(),
                product_food_ids: z
                    .record(z.string(), z.string().nullable())
                    .optional()
                    .describe(
                        "Grocery line id → the product actually bought; defaults to the food's usual product.",
                    ),
                amounts: z
                    .array(
                        z.object({
                            line_id: z.string(),
                            amount: z.coerce.number(),
                            unit: z.string().optional(),
                        }),
                    )
                    .optional()
                    .describe(
                        "Real purchased amount per line; required for to-taste grocery lines.",
                    ),
            }),
            outputSchema: z.object({
                put_away: z.array(
                    z.object({
                        line_id: z.string(),
                        display_name: z.string(),
                        fridge_item_id: z.string().nullable(),
                        product_food_id: z.string(),
                    }),
                ),
                failed: z.array(
                    z.object({
                        line_id: z.string(),
                        message: z.string(),
                    }),
                ),
            }),
        },
        async (args) =>
            withAnalytics(
                "put_away_grocery_lines",
                async () => {
                    const householdId = await callerHouseholdId();
                    const amountOverrides = Object.fromEntries(
                        (args.amounts ?? []).map((row) => [
                            row.line_id,
                            { amount: row.amount, unit: row.unit },
                        ]),
                    );
                    const putAway: {
                        line_id: string;
                        display_name: string;
                        fridge_item_id: string | null;
                        product_food_id: string;
                    }[] = [];
                    const failed: { line_id: string; message: string }[] = [];
                    const restockedOn = await householdToday(householdId);
                    for (const lineId of args.line_ids) {
                        try {
                            const results = await putAwayGroceryLines(
                                liveGroceryStore(),
                                liveFridgeStore(),
                                liveStockStore(),
                                liveFoodsStore(),
                                {
                                    householdId,
                                    lineIds: [lineId],
                                    restockedOn,
                                    locationId: args.location_id,
                                    productFoodIds: args.product_food_ids,
                                    amountOverrides,
                                },
                            );
                            for (const row of results) {
                                putAway.push({
                                    line_id: row.line.id,
                                    display_name: row.line.displayName,
                                    fridge_item_id: row.item?.id ?? null,
                                    product_food_id: row.productFoodId,
                                });
                            }
                        } catch (err) {
                            if (
                                err instanceof
                                    NotedGroceryLineAmountRequiredError ||
                                err instanceof StockInputError
                            ) {
                                failed.push({
                                    line_id: lineId,
                                    message: err.message,
                                });
                                continue;
                            }
                            throw err;
                        }
                    }
                    const payload = { put_away: putAway, failed };
                    const textParts = [
                        ...putAway.map(
                            (row) => `Put away ${row.display_name}.`,
                        ),
                        ...failed.map((row) => row.message),
                    ];
                    return {
                        content: [
                            {
                                type: "text",
                                text:
                                    textParts.length === 0
                                        ? "Nothing to put away."
                                        : textParts.join("\n"),
                            },
                        ],
                        structuredContent: payload,
                    };
                },
                analytics,
            ),
    );

    gatedTool(
        server,
        ctx,
        "mcp-list-usuals",
        "list_usuals",
        {
            title: "List Usuals",
            description:
                "List the household's usuals (foods bought on a schedule or added when stock runs low) with each one's schedule, low setting, usual product and store, and whether it is due today and why. Call it when the user asks what to restock, or at the start of a chat on the household's restock day. Due usuals come first. To restock one, call add_grocery_line with its food_id.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: LIST_USUALS_OUTPUT_SCHEMA,
        },
        async () =>
            withAnalytics(
                "list_usuals",
                async () => {
                    const householdId = await callerHouseholdId();
                    const [config, owner, listed, stock, stores] =
                        await Promise.all([
                            getHouseholdConfig(householdId),
                            getHouseholdOwnerProfile(householdId),
                            liveFoodsStore().listFoods(householdId),
                            liveFridgeStore().listItems(householdId),
                            liveSettingsStore().listStores(householdId),
                        ]);
                    const weekday = config.preferences.restock.weekday;
                    const today = householdTodayAt(config.preferences, owner);
                    const { rows, isRestockDay } = usualsList({
                        listed,
                        stock,
                        stores,
                        today,
                        householdRestockDay: weekday,
                    });
                    const dayName = WEEKDAY_NAMES[weekday] ?? "Sunday";
                    const restockEnabled = config.preferences.restock.enabled;
                    const header = `Restock day is ${dayName}; today is ${today}${isRestockDay ? " (restock day)" : ""}.${restockEnabled ? "" : " Automatic restock is off, so due usuals are not added to the list on their own."}`;
                    const text =
                        rows.length === 0
                            ? `${header} No usuals set up.`
                            : `${header}\n${rows.map(usualLine).join("\n")}`;
                    return {
                        content: [{ type: "text" as const, text }],
                        structuredContent: {
                            restock_weekday: weekday,
                            restock_weekday_name: dayName,
                            today,
                            is_restock_day: isRestockDay,
                            restock_enabled: restockEnabled,
                            usuals: rows.map(usualWire),
                        },
                    };
                },
                analytics,
            ),
    );
}
