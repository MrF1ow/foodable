import type { FoodsStore } from "./foods.js";
import type { GroceryLine, GroceryListStore } from "./grocery.js";
import type { NoticeDismissalsStore } from "./notice-dismissals.js";
import {
    createGroceryStore,
    sameName,
    SettingsInputError,
    storeNameTaken,
    type GroceryPreferences,
    type GrocerySection,
    type GroceryStore,
    type MemorySettingsStore,
    type SettingsStore,
} from "./settings.js";

/**
 * What deleting a store writes. `moves` carry the destination section of each
 * line moved to `moveTo`; `deleteLineIds` are the lines removed with the store.
 * The live adapter applies a plan in one transaction.
 */
export type StoreDeletionPlan = {
    storeId: string;
    moveTo: string | null;
    moves: { lineId: string; sectionId: string }[];
    deleteLineIds: string[];
    clearDefault: boolean;
};

export type StoreDeletionResult = {
    movedLines: number;
    deletedLines: number;
    clearedDefault: boolean;
};

/** The writes that span tables, so the live adapter can do each in one transaction. */
export type StoreManagementStore = {
    storeLineCount(householdId: string, storeId: string): Promise<number>;
    applyStoreDeletion(
        householdId: string,
        plan: StoreDeletionPlan,
    ): Promise<void>;
    /** Dense positions 0..n-1 in the given order; the ids are the household's stores, validated by the caller. */
    writeStoreOrder(householdId: string, orderedIds: string[]): Promise<void>;
};

/**
 * Where a line from `from` lands in the destination store: the section with
 * the same name, else the destination's "Other" section.
 */
export function destinationSectionId(
    fromSections: readonly GrocerySection[],
    toSections: readonly GrocerySection[],
    line: Pick<GroceryLine, "sectionId">,
): string {
    const source = fromSections.find((row) => row.id === line.sectionId);
    const named = source
        ? toSections.find((row) => sameName(row.name, source.name))
        : undefined;
    const target = named ?? toSections.find((row) => row.isOther);
    if (!target) {
        throw new SettingsInputError("That store has no sections.");
    }
    return target.id;
}

/**
 * Pure plan for deleting `storeId`. With `moveTo` every line of the store
 * moves there; without it the store's lines are deleted with it. Deleting the
 * default store clears that preference.
 */
export function planStoreDeletion(input: {
    storeId: string;
    moveTo?: string | null;
    stores: readonly GroceryStore[];
    sectionsByStore: ReadonlyMap<string, readonly GrocerySection[]>;
    lines: readonly GroceryLine[];
    prefs: GroceryPreferences;
}): StoreDeletionPlan {
    if (!input.stores.some((row) => row.id === input.storeId)) {
        throw new SettingsInputError("Unknown store.");
    }
    const moveTo = input.moveTo ? input.moveTo : null;
    if (moveTo !== null) {
        if (moveTo === input.storeId) {
            throw new SettingsInputError(
                "Pick a different store to move the lines to.",
            );
        }
        if (!input.stores.some((row) => row.id === moveTo)) {
            throw new SettingsInputError("Unknown store.");
        }
    }
    const own = input.lines.filter((row) => row.storeId === input.storeId);
    const moves: StoreDeletionPlan["moves"] = [];
    const deleteLineIds: string[] = [];
    if (moveTo !== null) {
        const fromSections = input.sectionsByStore.get(input.storeId) ?? [];
        const toSections = input.sectionsByStore.get(moveTo) ?? [];
        for (const line of own) {
            moves.push({
                lineId: line.id,
                sectionId: destinationSectionId(fromSections, toSections, line),
            });
        }
    } else {
        for (const line of own) deleteLineIds.push(line.id);
    }
    return {
        storeId: input.storeId,
        moveTo,
        moves,
        deleteLineIds,
        clearDefault: input.prefs.defaultStoreId === input.storeId,
    };
}

export async function storeLineCount(
    management: Pick<StoreManagementStore, "storeLineCount">,
    householdId: string,
    storeId: string,
): Promise<number> {
    return management.storeLineCount(householdId, storeId);
}

export async function deleteStore(
    deps: {
        management: StoreManagementStore;
        settings: SettingsStore;
        grocery: Pick<GroceryListStore, "listLines">;
    },
    householdId: string,
    storeId: string,
    opts: { moveTo?: string | null } = {},
): Promise<StoreDeletionResult> {
    const stores = await deps.settings.listStores(householdId);
    const sectionLists = await Promise.all(
        stores.map((row) => deps.settings.listSections(row.id)),
    );
    const sectionsByStore = new Map(
        stores.map((row, index) => [row.id, sectionLists[index]!] as const),
    );
    const plan = planStoreDeletion({
        storeId,
        moveTo: opts.moveTo,
        stores,
        sectionsByStore,
        lines: await deps.grocery.listLines(householdId),
        prefs: await deps.settings.getGroceryPreferences(householdId),
    });
    await deps.management.applyStoreDeletion(householdId, plan);
    return {
        movedLines: plan.moves.length,
        deletedLines: plan.deleteLineIds.length,
        clearedDefault: plan.clearDefault,
    };
}

/** `orderedIds` must be exactly the household's stores, each once. */
export async function reorderStores(
    deps: { management: StoreManagementStore; settings: SettingsStore },
    householdId: string,
    orderedIds: readonly string[],
): Promise<GroceryStore[]> {
    const stores = await deps.settings.listStores(householdId);
    const known = new Set(stores.map((row) => row.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
        if (!known.has(id)) throw new SettingsInputError("Unknown store.");
        if (seen.has(id)) {
            throw new SettingsInputError("A store is listed twice.");
        }
        seen.add(id);
    }
    if (seen.size !== known.size) {
        throw new SettingsInputError("List every store once.");
    }
    await deps.management.writeStoreOrder(householdId, [...orderedIds]);
    return deps.settings.listStores(householdId);
}

/**
 * Creates a store. Without `sectionNames` it is the app's own "add a store"
 * (`createGroceryStore`, the default sections). With them the store gets
 * exactly those sections, in that order, and an Other section last: lines with
 * no section of their own land there, so every store has one. A section named
 * Other (any case) is that section.
 */
export async function createStoreWithSections(
    settings: SettingsStore,
    householdId: string,
    name: string,
    sectionNames?: readonly string[],
): Promise<{ store: GroceryStore; sections: GrocerySection[] }> {
    if (sectionNames === undefined) {
        const store = await createGroceryStore(settings, householdId, name);
        return { store, sections: await settings.listSections(store.id) };
    }
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a store name.");
    const wanted: string[] = [];
    for (const raw of sectionNames) {
        const section = raw.trim();
        if (!section) throw new SettingsInputError("Enter a section name.");
        if (wanted.some((row) => sameName(row, section))) {
            throw new SettingsInputError("A section is listed twice.");
        }
        wanted.push(section);
    }
    const existing = await settings.listStores(householdId);
    if (storeNameTaken(existing, trimmed)) {
        throw new SettingsInputError("That store already exists.");
    }
    const other = wanted.find((row) => sameName(row, "other")) ?? "Other";
    const ordered = [...wanted.filter((row) => !sameName(row, "other")), other];
    const store = await settings.insertStore({
        id: crypto.randomUUID(),
        householdId,
        name: trimmed,
        sortOrder:
            existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
    });
    const sections: GrocerySection[] = [];
    for (const [index, sectionName] of ordered.entries()) {
        sections.push(
            await settings.insertSection({
                id: crypto.randomUUID(),
                householdId,
                storeId: store.id,
                name: sectionName,
                sortOrder: index,
                hidden: false,
                isOther: sectionName === other,
            }),
        );
    }
    return { store, sections };
}

/** Merges a patch into the stored preferences; a default store must be one of the household's. */
export async function saveGroceryPreferences(
    settings: SettingsStore,
    householdId: string,
    patch: Partial<GroceryPreferences>,
): Promise<GroceryPreferences> {
    const current = await settings.getGroceryPreferences(householdId);
    const next: GroceryPreferences = {
        defaultStoreId:
            patch.defaultStoreId !== undefined
                ? patch.defaultStoreId
                : current.defaultStoreId,
        useUsualStore:
            patch.useUsualStore !== undefined
                ? patch.useUsualStore
                : current.useUsualStore,
    };
    if (next.defaultStoreId !== null) {
        const stores = await settings.listStores(householdId);
        if (!stores.some((row) => row.id === next.defaultStoreId)) {
            throw new SettingsInputError("Unknown store.");
        }
    }
    return settings.setGroceryPreferences(householdId, next);
}

/**
 * Memory twin of the live adapter, composed from the memory settings and
 * grocery stores. Pass `foods` and `dismissals` to also mirror the database's
 * `on delete set null` for a food's usual store and the dismissal cleanup for
 * deleted lines.
 */
export function createMemoryStoreManagement(
    settings: MemorySettingsStore,
    grocery: GroceryListStore,
    linked: {
        foods?: Pick<FoodsStore, "listFoods" | "updateFoodRow">;
        dismissals?: NoticeDismissalsStore;
    } = {},
): StoreManagementStore {
    return {
        async storeLineCount(householdId, storeId) {
            const lines = await grocery.listLines(householdId);
            return lines.filter((row) => row.storeId === storeId).length;
        },
        async applyStoreDeletion(householdId, plan) {
            const stores = await settings.listStores(householdId);
            if (!stores.some((row) => row.id === plan.storeId)) {
                throw new SettingsInputError("Unknown store.");
            }
            const lines = await grocery.listLines(householdId);
            const touched = new Set([
                ...plan.moves.map((row) => row.lineId),
                ...plan.deleteLineIds,
            ]);
            const stray = lines.filter(
                (row) => row.storeId === plan.storeId && !touched.has(row.id),
            );
            if (stray.length > 0) {
                throw new SettingsInputError("The list changed. Try again.");
            }
            for (const move of plan.moves) {
                const line = lines.find((row) => row.id === move.lineId);
                if (!line || line.storeId !== plan.storeId) {
                    throw new SettingsInputError(
                        "The list changed. Try again.",
                    );
                }
                await grocery.updateLine({
                    ...line,
                    storeId: plan.moveTo!,
                    sectionId: move.sectionId,
                });
            }
            for (const id of plan.deleteLineIds) {
                await grocery.deleteLine(householdId, id);
                await linked.dismissals?.deleteForSubject(
                    householdId,
                    "grocery_line",
                    id,
                );
            }
            settings.__removeStore(householdId, plan.storeId);
            if (linked.foods) {
                for (const food of await linked.foods.listFoods(householdId)) {
                    if (food.usualStoreId === plan.storeId) {
                        await linked.foods.updateFoodRow({
                            ...food,
                            usualStoreId: null,
                        });
                    }
                }
            }
            if (plan.clearDefault) {
                const prefs = await settings.getGroceryPreferences(householdId);
                if (prefs.defaultStoreId === plan.storeId) {
                    await settings.setGroceryPreferences(householdId, {
                        ...prefs,
                        defaultStoreId: null,
                    });
                }
            }
        },
        async writeStoreOrder(householdId, orderedIds) {
            const have = new Set(
                (await settings.listStores(householdId)).map((row) => row.id),
            );
            if (
                have.size !== orderedIds.length ||
                orderedIds.some((id) => !have.has(id))
            ) {
                throw new SettingsInputError("The stores changed. Try again.");
            }
            settings.__setStoreOrder(householdId, orderedIds);
        },
    };
}
