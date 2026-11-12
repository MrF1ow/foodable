import type { GroceryLine } from "./grocery.js";
import {
    SettingsInputError,
    type GrocerySection,
    type GroceryStore,
    type SettingsStore,
} from "./settings.js";

function sameName(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Renames a store. A name another store of the household has is refused. */
export async function renameStore(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
    name: string,
): Promise<GroceryStore> {
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a store name.");
    const stores = await settings.listStores(householdId);
    const current = stores.find((row) => row.id === storeId);
    if (!current) throw new SettingsInputError("Unknown store.");
    if (
        stores.some((row) => row.id !== storeId && sameName(row.name, trimmed))
    ) {
        throw new SettingsInputError("That store already exists.");
    }
    const updated = await settings.updateStore({ ...current, name: trimmed });
    if (!updated) throw new SettingsInputError("Unknown store.");
    return updated;
}

async function storeSections(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
): Promise<GrocerySection[]> {
    const stores = await settings.listStores(householdId);
    if (!stores.some((row) => row.id === storeId)) {
        throw new SettingsInputError("Unknown store.");
    }
    return settings.listSections(storeId);
}

/** Writes dense positions 0..n-1 for the given order, only where one changed. */
async function writeSectionOrder(
    settings: SettingsStore,
    ordered: readonly GrocerySection[],
): Promise<void> {
    for (const [index, row] of ordered.entries()) {
        if (row.sortOrder === index) continue;
        await settings.updateSection({ ...row, sortOrder: index });
    }
}

/**
 * Adds a section to a store, just before its Other section so Other stays the
 * last stop of the walk.
 */
export async function addSection(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
    name: string,
): Promise<GrocerySection> {
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a section name.");
    const existing = await storeSections(settings, householdId, storeId);
    if (existing.some((row) => sameName(row.name, trimmed))) {
        throw new SettingsInputError("That section already exists.");
    }
    const created = await settings.insertSection({
        id: crypto.randomUUID(),
        householdId,
        storeId,
        name: trimmed,
        // Past every current position; the dense rewrite below settles it.
        sortOrder: existing.length,
        hidden: false,
        isOther: false,
    });
    const otherIndex = existing.findIndex((row) => row.isOther);
    const ordered =
        otherIndex < 0
            ? [...existing, created]
            : [
                  ...existing.slice(0, otherIndex),
                  created,
                  ...existing.slice(otherIndex),
              ];
    await writeSectionOrder(settings, ordered);
    return (await settings.getSection(householdId, created.id)) ?? created;
}

/**
 * Reorders a store's visible sections. `orderedIds` must be exactly the
 * sections that are neither hidden nor Other, each once. They fill the slots
 * those sections already held, so hidden sections keep their place and Other
 * stays last.
 */
export async function reorderSections(
    settings: SettingsStore,
    householdId: string,
    storeId: string,
    orderedIds: readonly string[],
): Promise<GrocerySection[]> {
    const all = await storeSections(settings, householdId, storeId);
    const movable = all.filter((row) => !row.hidden && !row.isOther);
    const known = new Set(movable.map((row) => row.id));
    const seen = new Set<string>();
    for (const id of orderedIds) {
        if (!known.has(id)) throw new SettingsInputError("Unknown section.");
        if (seen.has(id)) {
            throw new SettingsInputError("A section is listed twice.");
        }
        seen.add(id);
    }
    if (seen.size !== known.size) {
        throw new SettingsInputError("List every section once.");
    }
    const byId = new Map(movable.map((row) => [row.id, row] as const));
    let next = 0;
    const ordered = all.map((row) =>
        row.hidden || row.isOther ? row : byId.get(orderedIds[next++]!)!,
    );
    await writeSectionOrder(settings, ordered);
    return settings.listSections(storeId);
}

/** Hides or shows a section. The Other section is the fallback, so it stays. */
export async function setSectionHidden(
    settings: SettingsStore,
    householdId: string,
    sectionId: string,
    hidden: boolean,
): Promise<GrocerySection> {
    const current = await settings.getSection(householdId, sectionId);
    if (!current) throw new SettingsInputError("Unknown section.");
    if (hidden && current.isOther) {
        throw new SettingsInputError("The Other section cannot be hidden.");
    }
    const updated = await settings.updateSection({ ...current, hidden });
    if (!updated) throw new SettingsInputError("Unknown section.");
    return updated;
}

export type GroceryLineCounts = {
    byStore: Map<string, number>;
    bySection: Map<string, number>;
};

/** How many lines are on the list per store and per section ("5 on the list"). */
export function groceryLineCounts(
    lines: readonly Pick<GroceryLine, "storeId" | "sectionId">[],
): GroceryLineCounts {
    const byStore = new Map<string, number>();
    const bySection = new Map<string, number>();
    for (const line of lines) {
        byStore.set(line.storeId, (byStore.get(line.storeId) ?? 0) + 1);
        bySection.set(line.sectionId, (bySection.get(line.sectionId) ?? 0) + 1);
    }
    return { byStore, bySection };
}

/**
 * The up/down buttons of an order form: `move` is "<id>:up" or "<id>:down".
 * Returns the order with that one id moved a step; an id already at the edge,
 * an id not in the list or a malformed `move` leaves the order as it was.
 */
export function applyOrderMove(ids: readonly string[], move: string): string[] {
    const cut = move.lastIndexOf(":");
    const next = [...ids];
    if (cut < 0) return next;
    const id = move.slice(0, cut);
    const direction = move.slice(cut + 1);
    const from = next.indexOf(id);
    const to =
        direction === "up" ? from - 1 : direction === "down" ? from + 1 : -1;
    if (from < 0 || to < 0 || to >= next.length) return next;
    [next[from], next[to]] = [next[to]!, next[from]!];
    return next;
}

/**
 * Where "Move N lines to …" sends a deleted store's lines: the default store
 * when it is another store, else the first other store. Null when the store
 * is the only one, so the only choice left is deleting its lines.
 */
export function deleteMoveTarget(
    stores: readonly GroceryStore[],
    storeId: string,
    defaultStoreId: string | null,
): GroceryStore | null {
    const others = stores.filter((row) => row.id !== storeId);
    return others.find((row) => row.id === defaultStoreId) ?? others[0] ?? null;
}
