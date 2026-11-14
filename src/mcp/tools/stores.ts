import { type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withAnalytics } from "../../analytics.js";
import { liveGroceryStore } from "../../db/grocery.js";
import { liveStoreManagement } from "../../db/grocery-stores.js";
import { liveSettingsStore } from "../../db/settings.js";
import { GroceryInputError } from "../../domain/grocery.js";
import {
    applyLinePlacements,
    readStoreLayout,
} from "../../domain/grocery-lines.js";
import {
    applySectionEdits,
    deleteMoveTarget,
    deleteRemovedSections,
    groceryLineCounts,
    moveRemovedSectionLines,
    netRenames,
    planStoreSectionsChange,
    renameStore,
    sectionsChanged,
    sectionsReordered,
} from "../../domain/grocery-sections.js";
import {
    createStoreWithSections,
    deleteStore,
    planStoreDeletion,
    reorderStores,
    saveGroceryPreferences,
} from "../../domain/grocery-stores.js";
import {
    SettingsInputError,
    type GrocerySection,
} from "../../domain/settings.js";
import { gatedTool } from "../gated.js";
import {
    captureDismissals,
    destructiveOutcome,
    dismissedOn,
    uncapturedNote,
    withUndo,
} from "../shared.js";
import type { ToolContext } from "../shared.js";

/** One flag gates every grocery and store admin tool. */
export const HOUSEHOLD_ADMIN_FLAG = "mcp-household-admin" as const;

/** The nine tools behind the flag, in the order they are registered. */
export const HOUSEHOLD_ADMIN_TOOL_NAMES = [
    "clear_grocery_list",
    "move_grocery_lines",
    "update_grocery_line",
    "list_stores",
    "create_store",
    "update_store",
    "delete_store",
    "reorder_stores",
    "set_store_sections",
] as const;

/** A store or section id from `list_stores`, with an error an agent can act on. */
export const ADMIN_ID = (what: string) =>
    z.uuid(`${what} must be an id taken from list_stores`);

const sectionWire = z.object({
    id: z.string(),
    name: z.string(),
    /** 1-based place in the walk through the store. */
    position: z.number().int(),
    hidden: z.boolean(),
    is_other: z.boolean(),
    line_count: z.number().int(),
});

const storeWire = z.object({
    id: z.string(),
    name: z.string(),
    /** 1-based place among the household's stores. */
    position: z.number().int(),
    is_default: z.boolean(),
    line_count: z.number().int(),
    sections: z.array(sectionWire),
});

export const LIST_STORES_OUTPUT_SCHEMA = z.object({
    default_store_id: z.string().nullable(),
    use_usual_store: z.boolean(),
    stores: z.array(storeWire),
});

export const CREATE_STORE_OUTPUT_SCHEMA = z.object({
    id: z.string(),
    name: z.string(),
    sections: z.array(sectionWire),
});

export const UPDATE_STORE_OUTPUT_SCHEMA = z.object({
    id: z.string(),
    name: z.string(),
    changed: z.boolean(),
    is_default: z.boolean(),
    use_usual_store: z.boolean(),
});

export const DELETE_STORE_OUTPUT_SCHEMA = z.object({
    deleted: z.boolean(),
    id: z.string(),
    name: z.string().nullable(),
    moved_lines: z.number().int(),
    deleted_lines: z.number().int(),
    moved_to: z.object({ id: z.string(), name: z.string() }).nullable(),
    cleared_default: z.boolean(),
});

export const REORDER_STORES_OUTPUT_SCHEMA = z.object({
    changed: z.boolean(),
    stores: z.array(
        z.object({
            id: z.string(),
            name: z.string(),
            position: z.number().int(),
        }),
    ),
});

export const SET_STORE_SECTIONS_OUTPUT_SCHEMA = z.object({
    store_id: z.string(),
    store: z.string(),
    changed: z.boolean(),
    added: z.array(z.string()),
    renamed: z.array(z.object({ from: z.string(), to: z.string() })),
    hidden: z.array(z.string()),
    shown: z.array(z.string()),
    /** Sections removed; their lines moved to Other. */
    removed: z.array(
        z.object({ name: z.string(), moved_lines: z.number().int() }),
    ),
    reordered: z.boolean(),
    sections: z.array(sectionWire),
});

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}

/** A domain refusal as the tool error an agent reads; anything else passes through. */
function asToolError(err: unknown): never {
    if (err instanceof SettingsInputError || err instanceof GroceryInputError) {
        throw new Error(err.message);
    }
    throw err;
}

function sectionsWire(
    sections: readonly GrocerySection[],
    counts: ReadonlyMap<string, number>,
) {
    return sections.map((row, index) => ({
        id: row.id,
        name: row.name,
        position: index + 1,
        hidden: row.hidden,
        is_other: row.isOther,
        line_count: counts.get(row.id) ?? 0,
    }));
}

const NOT_DESTRUCTIVE = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
} as const;

const DESTRUCTIVE = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
} as const;

const UNDO_NOTE =
    "Records the change and the household can undo it for 24 hours; refused while the household has turned off destructive agent changes.";

export function registerStoreTools(server: McpServer, ctx: ToolContext) {
    const {
        callerHouseholdId,
        callerManagerHouseholdId,
        analytics,
        runDestructive,
    } = ctx;

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "list_stores",
        {
            title: "List Stores",
            description:
                "List the household's grocery stores in order, each with its sections (order, hidden, line counts) and how many grocery lines it holds, plus the grocery preferences (default store, use a food's usual store first). Call it before changing stores or sections: the ids come from here.",
            annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
            outputSchema: LIST_STORES_OUTPUT_SCHEMA,
        },
        async () =>
            withAnalytics(
                "list_stores",
                async () => {
                    const householdId = await callerHouseholdId();
                    const settings = liveSettingsStore();
                    const layout = await readStoreLayout(settings, householdId);
                    const prefs =
                        await settings.getGroceryPreferences(householdId);
                    const counts = groceryLineCounts(
                        await liveGroceryStore().listLines(householdId),
                    );
                    const stores = layout.stores.map((store, index) => ({
                        id: store.id,
                        name: store.name,
                        position: index + 1,
                        is_default: store.id === prefs.defaultStoreId,
                        line_count: counts.byStore.get(store.id) ?? 0,
                        sections: sectionsWire(
                            layout.sectionsByStore.get(store.id) ?? [],
                            counts.bySection,
                        ),
                    }));
                    const defaultName = stores.find(
                        (row) => row.is_default,
                    )?.name;
                    const header = `${plural(stores.length, "store")}. Default store: ${defaultName ?? "none"}. Use a food's usual store first: ${prefs.useUsualStore ? "on" : "off"}.`;
                    const body = stores.map(
                        (store) =>
                            `${store.position}. ${store.name}${store.is_default ? " (default)" : ""} — ${plural(store.line_count, "line")}\n   Sections: ${
                                store.sections
                                    .map(
                                        (section) =>
                                            `${section.name}${section.hidden ? " (hidden)" : ""}${section.line_count > 0 ? ` [${section.line_count}]` : ""}`,
                                    )
                                    .join(", ") || "none"
                            }`,
                    );
                    return {
                        content: [
                            {
                                type: "text" as const,
                                text:
                                    stores.length === 0
                                        ? `No stores yet. ${header} Add one with create_store.`
                                        : [header, ...body].join("\n"),
                            },
                        ],
                        structuredContent: {
                            default_store_id: prefs.defaultStoreId,
                            use_usual_store: prefs.useUsualStore,
                            stores,
                        },
                    };
                },
                analytics,
            ),
    );

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "create_store",
        {
            title: "Create Store",
            description:
                "Add a grocery store. Without `sections` it gets the app's default sections (Produce, Dairy, Meat & seafood, Bakery, Frozen, Pantry, Beverages, Household, Other). With `sections` it gets exactly those, in that order, and an Other section last. Owner or admin only, like the app.",
            annotations: NOT_DESTRUCTIVE,
            inputSchema: z.object({
                name: z.string().trim().min(1).max(100),
                sections: z
                    .array(z.string().trim().min(1).max(100))
                    .min(1)
                    .max(50)
                    .optional()
                    .describe(
                        "Section names in walk order. Leave out for the app's default sections.",
                    ),
            }),
            outputSchema: CREATE_STORE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "create_store",
                async () => {
                    const householdId = await callerManagerHouseholdId();
                    try {
                        const made = await createStoreWithSections(
                            liveSettingsStore(),
                            householdId,
                            args.name,
                            args.sections,
                        );
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: `Added store ${made.store.name} with ${plural(made.sections.length, "section")}: ${made.sections.map((row) => row.name).join(", ")}.`,
                                },
                            ],
                            structuredContent: {
                                id: made.store.id,
                                name: made.store.name,
                                sections: sectionsWire(
                                    made.sections,
                                    new Map(),
                                ),
                            },
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
            ),
    );

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "update_store",
        {
            title: "Update Store",
            description: `Rename a store and/or change the household's store preferences: make it the default store (is_default true; false only clears it when it is the default now) and whether a food's usual store comes before the list history (use_usual_store, a household-wide setting). Overwrites what the household set. ${UNDO_NOTE} Owner or admin only.`,
            annotations: DESTRUCTIVE,
            inputSchema: z.object({
                id: ADMIN_ID("id"),
                name: z.string().trim().min(1).max(100).optional(),
                is_default: z.boolean().optional(),
                use_usual_store: z.boolean().optional(),
            }),
            outputSchema: UPDATE_STORE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "update_store",
                async () => {
                    await callerManagerHouseholdId();
                    if (
                        args.name === undefined &&
                        args.is_default === undefined &&
                        args.use_usual_store === undefined
                    ) {
                        throw new Error(
                            "Nothing to change: pass name, is_default or use_usual_store.",
                        );
                    }
                    try {
                        const run = await runDestructive(
                            "update_store",
                            async (rec, householdId) => {
                                const settings = liveSettingsStore();
                                const stores =
                                    await settings.listStores(householdId);
                                const store = stores.find(
                                    (row) => row.id === args.id,
                                );
                                if (!store) {
                                    throw new SettingsInputError(
                                        `No store found with id ${args.id}. Use list_stores.`,
                                    );
                                }
                                const prefs =
                                    await settings.getGroceryPreferences(
                                        householdId,
                                    );
                                const wasDefault =
                                    prefs.defaultStoreId === store.id;
                                const rename =
                                    args.name !== undefined &&
                                    args.name !== store.name;
                                const nextDefault =
                                    args.is_default === undefined
                                        ? wasDefault
                                        : args.is_default;
                                const nextUsual =
                                    args.use_usual_store ?? prefs.useUsualStore;
                                const prefsChange =
                                    nextDefault !== wasDefault ||
                                    nextUsual !== prefs.useUsualStore;
                                const value = {
                                    id: store.id,
                                    name: store.name,
                                    changed: rename || prefsChange,
                                    is_default: nextDefault,
                                    use_usual_store: nextUsual,
                                };
                                if (!value.changed) {
                                    return {
                                        value,
                                        summary: "",
                                        changed: false,
                                    };
                                }
                                if (rename) {
                                    await rec.captureByIds(
                                        "grocery_stores",
                                        [store.id],
                                        "updated",
                                    );
                                }
                                if (prefsChange) {
                                    await rec.captureByIds(
                                        "households",
                                        [householdId],
                                        "updated",
                                    );
                                }
                                const said: string[] = [];
                                if (rename) {
                                    const renamed = await renameStore(
                                        settings,
                                        householdId,
                                        store.id,
                                        args.name!,
                                    );
                                    value.name = renamed.name;
                                    said.push(
                                        `renamed ${store.name} to ${renamed.name}`,
                                    );
                                }
                                if (prefsChange) {
                                    await saveGroceryPreferences(
                                        settings,
                                        householdId,
                                        {
                                            defaultStoreId: nextDefault
                                                ? store.id
                                                : wasDefault
                                                  ? null
                                                  : prefs.defaultStoreId,
                                            useUsualStore: nextUsual,
                                        },
                                    );
                                    if (nextDefault !== wasDefault) {
                                        said.push(
                                            nextDefault
                                                ? `made ${value.name} the default store`
                                                : `${value.name} is no longer the default store`,
                                        );
                                    }
                                    if (nextUsual !== prefs.useUsualStore) {
                                        said.push(
                                            `usual store first is now ${nextUsual ? "on" : "off"}`,
                                        );
                                    }
                                }
                                return {
                                    value,
                                    summary: `Store ${store.name}: ${said.join("; ")}`,
                                    changed: true,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { value } = run;
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(
                                        value.changed
                                            ? `Updated store ${value.name}.`
                                            : `Store ${value.name} already has those settings; nothing changed.`,
                                        run.undo,
                                    ),
                                },
                            ],
                            structuredContent: value,
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "delete_store",
        {
            title: "Delete Store",
            description: `Delete a store and its sections and store rules. A store with grocery lines needs a choice: lines "move" sends them to another store (move_to, else the default store when it is another store, else the first other one; each keeps its aisle by name, else lands in Other) or "delete" removes them. Deleting the default store clears that preference; foods whose usual store it was lose it. ${UNDO_NOTE} Owner or admin only.`,
            annotations: DESTRUCTIVE,
            inputSchema: z.object({
                id: ADMIN_ID("id"),
                lines: z
                    .enum(["move", "delete"])
                    .optional()
                    .describe(
                        "What to do with the store's grocery lines. Required when it has any.",
                    ),
                move_to: ADMIN_ID("move_to")
                    .optional()
                    .describe(
                        'The store to move the lines to, with lines "move".',
                    ),
            }),
            outputSchema: DELETE_STORE_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "delete_store",
                async () => {
                    await callerManagerHouseholdId();
                    try {
                        const run = await runDestructive<
                            z.infer<typeof DELETE_STORE_OUTPUT_SCHEMA>
                        >("delete_store", async (rec, householdId) => {
                            const settings = liveSettingsStore();
                            const grocery = liveGroceryStore();
                            const layout = await readStoreLayout(
                                settings,
                                householdId,
                            );
                            const store = layout.stores.find(
                                (row) => row.id === args.id,
                            );
                            if (!store) {
                                throw new SettingsInputError(
                                    `No store found with id ${args.id}. Use list_stores.`,
                                );
                            }
                            const lines = await grocery.listLines(householdId);
                            const own = lines.filter(
                                (row) => row.storeId === store.id,
                            );
                            const prefs =
                                await settings.getGroceryPreferences(
                                    householdId,
                                );
                            if (own.length > 0 && !args.lines) {
                                throw new SettingsInputError(
                                    `${store.name} has ${plural(own.length, "line")} on the list. Choose what to do with ${own.length === 1 ? "it" : "them"}: lines "move" (to another store) or "delete".`,
                                );
                            }
                            if (args.move_to && args.lines !== "move") {
                                throw new SettingsInputError(
                                    'move_to only applies with lines "move".',
                                );
                            }
                            // A store with no lines has nothing to move.
                            const target =
                                args.lines === "move" && own.length > 0
                                    ? args.move_to
                                        ? layout.stores.find(
                                              (row) => row.id === args.move_to,
                                          )
                                        : deleteMoveTarget(
                                              layout.stores,
                                              store.id,
                                              prefs.defaultStoreId,
                                          )
                                    : null;
                            if (args.lines === "move" && own.length > 0) {
                                if (!target) {
                                    throw new SettingsInputError(
                                        args.move_to
                                            ? "Unknown store."
                                            : 'There is no other store to move the lines to; use lines "delete".',
                                    );
                                }
                                if (target.id === store.id) {
                                    throw new SettingsInputError(
                                        "Pick a different store to move the lines to.",
                                    );
                                }
                            }
                            const deps = {
                                management: liveStoreManagement(),
                                settings,
                                grocery,
                            };
                            let moved = 0;
                            if (target) {
                                // The app's own plan says where each line goes. The
                                // lines move first, as updated rows: a line that
                                // is still in the store when its cascade is
                                // recorded would be recorded as deleted too, and
                                // undo could not put it back twice.
                                const plan = planStoreDeletion({
                                    storeId: store.id,
                                    moveTo: target.id,
                                    stores: layout.stores,
                                    sectionsByStore: layout.sectionsByStore,
                                    lines,
                                    prefs,
                                });
                                await rec.captureByIds(
                                    "grocery_lines",
                                    plan.moves.map((row) => row.lineId),
                                    "updated",
                                );
                                moved = (
                                    await applyLinePlacements(
                                        grocery,
                                        plan.moves.map((move) => ({
                                            line: own.find(
                                                (row) => row.id === move.lineId,
                                            )!,
                                            storeId: target.id,
                                            sectionId: move.sectionId,
                                        })),
                                    )
                                ).length;
                            }
                            const report = await rec.captureCascade(
                                "grocery_stores",
                                [{ id: store.id }],
                            );
                            if (!target) {
                                await captureDismissals(
                                    rec,
                                    householdId,
                                    dismissedOn(
                                        "grocery_line",
                                        own.map((row) => row.id),
                                    ),
                                );
                            }
                            const clearsDefault =
                                prefs.defaultStoreId === store.id;
                            if (clearsDefault) {
                                await rec.captureByIds(
                                    "households",
                                    [householdId],
                                    "updated",
                                );
                            }
                            // The app's own deletion, told to move what is left: a
                            // line that reached the store since the lines above
                            // were read is moved, never deleted, and then it was
                            // not recorded either, so the whole call is refused.
                            const result = await deleteStore(
                                deps,
                                householdId,
                                store.id,
                                { moveTo: target?.id ?? null },
                            );
                            const stray = target
                                ? result.movedLines + result.deletedLines
                                : result.deletedLines - own.length;
                            if (stray !== 0) {
                                throw new SettingsInputError(
                                    `${store.name} changed while it was being deleted (its lines are not the ones this call saw). Nothing was changed. Try again.`,
                                );
                            }
                            const value = {
                                deleted: true,
                                id: store.id,
                                name: store.name,
                                moved_lines: moved,
                                deleted_lines: result.deletedLines,
                                moved_to: target
                                    ? { id: target.id, name: target.name }
                                    : null,
                                cleared_default: result.clearedDefault,
                            };
                            const what = target
                                ? ` (moved ${plural(moved, "line")} to ${target.name})`
                                : value.deleted_lines > 0
                                  ? ` and its ${plural(value.deleted_lines, "line")}`
                                  : "";
                            return {
                                value,
                                summary: `Deleted store ${store.name}${what}${uncapturedNote(report.uncaptured)}`,
                                changed: true,
                            };
                        });
                        if (run.refused) return run.result;
                        const { value } = run;
                        const text = [
                            `Deleted store ${value.name}${
                                value.moved_to
                                    ? ` and moved its ${plural(value.moved_lines, "line")} to ${value.moved_to.name}`
                                    : value.deleted_lines > 0
                                      ? ` and its ${plural(value.deleted_lines, "line")}`
                                      : " (it had no lines)"
                            }.`,
                            value.cleared_default
                                ? "It was the default store, so the household has no default store now."
                                : "",
                        ]
                            .filter(Boolean)
                            .join(" ");
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(text, run.undo),
                                },
                            ],
                            structuredContent: value,
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "reorder_stores",
        {
            title: "Reorder Stores",
            description: `Put the household's stores in a new order. Pass every store id once, in the order they should appear. ${UNDO_NOTE} Owner or admin only.`,
            annotations: DESTRUCTIVE,
            inputSchema: z.object({
                ordered_ids: z
                    .array(ADMIN_ID("each ordered id"))
                    .min(1)
                    .max(200),
            }),
            outputSchema: REORDER_STORES_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "reorder_stores",
                async () => {
                    await callerManagerHouseholdId();
                    try {
                        const run = await runDestructive(
                            "reorder_stores",
                            async (rec, householdId) => {
                                const settings = liveSettingsStore();
                                const before =
                                    await settings.listStores(householdId);
                                const missing = before.filter(
                                    (row) => !args.ordered_ids.includes(row.id),
                                );
                                if (
                                    missing.length > 0 &&
                                    args.ordered_ids.every((id) =>
                                        before.some((row) => row.id === id),
                                    )
                                ) {
                                    throw new SettingsInputError(
                                        `List every store once. Missing: ${missing.map((row) => row.name).join(", ")}.`,
                                    );
                                }
                                const same =
                                    before.length === args.ordered_ids.length &&
                                    before.every(
                                        (row, index) =>
                                            row.id === args.ordered_ids[index],
                                    );
                                if (same) {
                                    return {
                                        value: {
                                            changed: false,
                                            stores: before.map(
                                                (row, index) => ({
                                                    id: row.id,
                                                    name: row.name,
                                                    position: index + 1,
                                                }),
                                            ),
                                        },
                                        summary: "",
                                        changed: false,
                                    };
                                }
                                await rec.captureByIds(
                                    "grocery_stores",
                                    before.map((row) => row.id),
                                    "updated",
                                );
                                const after = await reorderStores(
                                    {
                                        management: liveStoreManagement(),
                                        settings,
                                    },
                                    householdId,
                                    args.ordered_ids,
                                );
                                const stores = after.map((row, index) => ({
                                    id: row.id,
                                    name: row.name,
                                    position: index + 1,
                                }));
                                return {
                                    value: { changed: true, stores },
                                    summary: `Reordered the stores: ${stores.map((row) => row.name).join(", ")}`,
                                    changed: true,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { value } = run;
                        const order = value.stores
                            .map((row) => row.name)
                            .join(", ");
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(
                                        value.changed
                                            ? `Stores are now in this order: ${order}.`
                                            : `The stores are already in that order: ${order}.`,
                                        run.undo,
                                    ),
                                },
                            ],
                            structuredContent: value,
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );

    gatedTool(
        server,
        ctx,
        HOUSEHOLD_ADMIN_FLAG,
        "set_store_sections",
        {
            title: "Set Store Sections",
            description: `Change one store's sections in a single call: remove some (their grocery lines move to the store's Other section, which cannot be removed), add new ones (placed before Other), rename, hide or show, and put them in order. Sections are named by their name (any case) or id. Applied in that order, so \`order\` sees the sections after the other changes; it lists the sections that should come first, in order, and the rest keep their order (Other stays last, hidden sections keep their place). ${UNDO_NOTE} Owner or admin only.`,
            annotations: DESTRUCTIVE,
            inputSchema: z.object({
                store_id: ADMIN_ID("store_id"),
                remove: z.array(z.string().trim().min(1)).max(50).optional(),
                add: z
                    .array(z.string().trim().min(1).max(100))
                    .max(50)
                    .optional(),
                rename: z
                    .array(
                        z.object({
                            section: z.string().trim().min(1),
                            name: z.string().trim().min(1).max(100),
                        }),
                    )
                    .max(50)
                    .optional(),
                hide: z.array(z.string().trim().min(1)).max(50).optional(),
                show: z.array(z.string().trim().min(1)).max(50).optional(),
                order: z.array(z.string().trim().min(1)).max(100).optional(),
            }),
            outputSchema: SET_STORE_SECTIONS_OUTPUT_SCHEMA,
        },
        async (args) =>
            withAnalytics(
                "set_store_sections",
                async () => {
                    await callerManagerHouseholdId();
                    if (
                        !args.remove?.length &&
                        !args.add?.length &&
                        !args.rename?.length &&
                        !args.hide?.length &&
                        !args.show?.length &&
                        !args.order?.length
                    ) {
                        throw new Error(
                            "Nothing to change: pass remove, add, rename, hide, show or order.",
                        );
                    }
                    try {
                        const run = await runDestructive(
                            "set_store_sections",
                            async (rec, householdId) => {
                                const settings = liveSettingsStore();
                                const grocery = liveGroceryStore();
                                const store = (
                                    await settings.listStores(householdId)
                                ).find((row) => row.id === args.store_id);
                                if (!store) {
                                    throw new SettingsInputError(
                                        `No store found with id ${args.store_id}. Use list_stores.`,
                                    );
                                }
                                const start = await settings.listSections(
                                    store.id,
                                );
                                // Everything is resolved and checked here, before a write.
                                const plan = planStoreSectionsChange({
                                    storeId: store.id,
                                    storeName: store.name,
                                    sections: start,
                                    lines: await grocery.listLines(householdId),
                                    change: args,
                                });
                                const { removal } = plan;
                                const goneIds = new Set(
                                    removal.removals.map(
                                        (row) => row.section.id,
                                    ),
                                );
                                // Adding rewrites the other sections' positions, so every
                                // section that stays is recorded as it was before anything
                                // is written. A removed one is recorded as deleted below.
                                await rec.captureByIds(
                                    "grocery_sections",
                                    start
                                        .filter((row) => !goneIds.has(row.id))
                                        .map((row) => row.id),
                                    "updated",
                                );
                                const removed = removal.removals.map((row) => ({
                                    name: row.section.name,
                                    moved_lines: row.lineIds.length,
                                }));
                                let reportedUncaptured: string[] = [];
                                if (removal.removals.length > 0) {
                                    // Removal goes first. The lines move to Other as updated
                                    // rows before the sections are recorded, so the cascade
                                    // finds none of them in a section: they are not deleted.
                                    await rec.captureByIds(
                                        "grocery_lines",
                                        removal.removals.flatMap(
                                            (row) => row.lineIds,
                                        ),
                                        "updated",
                                    );
                                    await moveRemovedSectionLines(
                                        grocery,
                                        householdId,
                                        removal,
                                    );
                                    const report = await rec.captureCascade(
                                        "grocery_sections",
                                        removal.removals.map((row) => ({
                                            id: row.section.id,
                                        })),
                                    );
                                    reportedUncaptured = report.uncaptured;
                                    // The cascade found only the sections themselves. A
                                    // line it also found reached a removed section after
                                    // the lines above were read: it would be deleted, so
                                    // the whole call is refused instead.
                                    if (
                                        report.captured !==
                                        removal.removals.length
                                    ) {
                                        throw new SettingsInputError(
                                            `${store.name} changed while its sections were being removed. Nothing was changed. Try again.`,
                                        );
                                    }
                                    await deleteRemovedSections(
                                        settings,
                                        householdId,
                                        removal,
                                    );
                                }
                                const { added } = await applySectionEdits(
                                    settings,
                                    householdId,
                                    plan,
                                    {
                                        added: (section) =>
                                            rec.inserted("grocery_sections", [
                                                section.id,
                                            ]),
                                    },
                                );
                                const end = await settings.listSections(
                                    store.id,
                                );
                                const changed = sectionsChanged(start, end);
                                const reordered = sectionsReordered(start, end);
                                const renamed = netRenames(
                                    plan.rename,
                                    start,
                                    end,
                                );
                                const hidden = plan.hide.map((row) => row.name);
                                const shown = plan.show.map((row) => row.name);
                                const counts = groceryLineCounts(
                                    await grocery.listLines(householdId),
                                );
                                const value = {
                                    store_id: store.id,
                                    store: store.name,
                                    changed,
                                    added: added.map((row) => row.name),
                                    renamed,
                                    hidden,
                                    shown,
                                    removed,
                                    reordered,
                                    sections: sectionsWire(
                                        end,
                                        counts.bySection,
                                    ),
                                };
                                const said = [
                                    removed.length > 0
                                        ? `removed ${removed.map((row) => `${row.name} (${plural(row.moved_lines, "line")} moved to Other)`).join(", ")}`
                                        : "",
                                    value.added.length > 0
                                        ? `added ${value.added.join(", ")}`
                                        : "",
                                    renamed.length > 0
                                        ? `renamed ${renamed.map((row) => `${row.from} to ${row.to}`).join(", ")}`
                                        : "",
                                    hidden.length > 0
                                        ? `hid ${hidden.join(", ")}`
                                        : "",
                                    shown.length > 0
                                        ? `showed ${shown.join(", ")}`
                                        : "",
                                    reordered ? "reordered" : "",
                                ].filter(Boolean);
                                return {
                                    value,
                                    summary: `Sections of ${store.name}: ${said.join("; ") || "changed"}${uncapturedNote(reportedUncaptured)}`,
                                    changed,
                                };
                            },
                        );
                        if (run.refused) return run.result;
                        const { value } = run;
                        const order = value.sections
                            .map(
                                (row) =>
                                    `${row.name}${row.hidden ? " (hidden)" : ""}`,
                            )
                            .join(", ");
                        return {
                            content: [
                                {
                                    type: "text" as const,
                                    text: withUndo(
                                        value.changed
                                            ? `Updated the sections of ${value.store}. They are now: ${order}.`
                                            : `${value.store} already has those sections; nothing changed.`,
                                        run.undo,
                                    ),
                                },
                            ],
                            structuredContent: value,
                        };
                    } catch (err) {
                        return asToolError(err);
                    }
                },
                analytics,
                undefined,
                { outcome: destructiveOutcome },
            ),
    );
}
