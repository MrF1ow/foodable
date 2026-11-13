export const DEFAULT_STORE_SECTIONS = [
    "Produce",
    "Dairy",
    "Meat & seafood",
    "Bakery",
    "Frozen",
    "Pantry",
    "Beverages",
    "Household",
    "Other",
] as const;

export type GroceryStore = {
    id: string;
    householdId: string;
    name: string;
    sortOrder: number;
};

export type GrocerySection = {
    id: string;
    householdId: string;
    storeId: string;
    name: string;
    sortOrder: number;
    hidden: boolean;
    isOther: boolean;
};

/** Keys in `households.household_preferences`; flat, dotted names. */
export const GROCERY_DEFAULT_STORE_KEY = "grocery.default_store_id";
export const GROCERY_USE_USUAL_STORE_KEY = "grocery.use_usual_store";
/**
 * The household's switch for destructive agent changes. Missing, or anything
 * but a stored `false`, means Allowed, so a household that never touched it
 * and a household whose preferences were rewritten both stay on.
 */
export const AGENTS_DESTRUCTIVE_ALLOWED_KEY = "agents.destructive_allowed";

/**
 * How a grocery line with no store of its own picks one. `defaultStoreId` is
 * the household's preferred store: it replaces the first-store fallback, and
 * with `useUsualStore` on it also comes before the list history. Unset (the
 * default), placement is exactly what it was before these preferences existed.
 */
export type GroceryPreferences = {
    defaultStoreId: string | null;
    useUsualStore: boolean;
};

export const DEFAULT_GROCERY_PREFERENCES: GroceryPreferences = {
    defaultStoreId: null,
    useUsualStore: false,
};

/** Reads the two keys out of a stored preferences object; anything else is ignored. */
export function groceryPreferencesFromJson(raw: unknown): GroceryPreferences {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { ...DEFAULT_GROCERY_PREFERENCES };
    }
    const record = raw as Record<string, unknown>;
    const id = record[GROCERY_DEFAULT_STORE_KEY];
    return {
        defaultStoreId: typeof id === "string" && id.trim() ? id.trim() : null,
        useUsualStore: record[GROCERY_USE_USUAL_STORE_KEY] === true,
    };
}

/** Reads the agents switch out of a stored preferences object. */
export function agentDestructiveAllowedFromJson(raw: unknown): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return true;
    return (
        (raw as Record<string, unknown>)[AGENTS_DESTRUCTIVE_ALLOWED_KEY] !==
        false
    );
}

export type SettingsStore = {
    getLocation(householdId: string): Promise<string | null>;
    setLocation(householdId: string, location: string | null): Promise<void>;
    getGroceryPreferences(householdId: string): Promise<GroceryPreferences>;
    /** Writes both preferences. A default store of another household is rejected. */
    setGroceryPreferences(
        householdId: string,
        prefs: GroceryPreferences,
    ): Promise<GroceryPreferences>;
    /** Whether agents may make destructive changes (default: yes). */
    getAgentDestructiveAllowed(householdId: string): Promise<boolean>;
    /** Writes the switch and returns it. Who may flip it is the caller's rule. */
    setAgentDestructiveAllowed(
        householdId: string,
        allowed: boolean,
    ): Promise<boolean>;
    listStores(householdId: string): Promise<GroceryStore[]>;
    insertStore(row: GroceryStore): Promise<GroceryStore>;
    /** Writes the store's name; null when the store is not this household's. */
    updateStore(row: GroceryStore): Promise<GroceryStore | null>;
    listSections(storeId: string): Promise<GrocerySection[]>;
    getSection(householdId: string, id: string): Promise<GrocerySection | null>;
    insertSection(row: GrocerySection): Promise<GrocerySection>;
    updateSection(row: GrocerySection): Promise<GrocerySection | null>;
};

export class SettingsInputError extends Error {
    readonly code = "settings_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "SettingsInputError";
    }
}

/**
 * The memory store also exposes the two store writes that the live adapter
 * does inside one transaction with the grocery lines (`src/db/grocery-stores.ts`),
 * so `createMemoryStoreManagement` can compose them.
 */
export type MemorySettingsStore = SettingsStore & {
    __removeStore(householdId: string, storeId: string): boolean;
    __setStoreOrder(householdId: string, orderedIds: string[]): void;
};

export function createMemorySettingsStore(): MemorySettingsStore {
    const locations = new Map<string, string | null>();
    const preferences = new Map<string, GroceryPreferences>();
    const agentSwitch = new Map<string, boolean>();
    const stores: GroceryStore[] = [];
    const sections: GrocerySection[] = [];

    return {
        async getGroceryPreferences(householdId) {
            return {
                ...(preferences.get(householdId) ??
                    DEFAULT_GROCERY_PREFERENCES),
            };
        },
        async setGroceryPreferences(householdId, prefs) {
            if (
                prefs.defaultStoreId !== null &&
                !stores.some(
                    (row) =>
                        row.id === prefs.defaultStoreId &&
                        row.householdId === householdId,
                )
            ) {
                throw new SettingsInputError("Unknown store.");
            }
            preferences.set(householdId, { ...prefs });
            return { ...prefs };
        },
        async getAgentDestructiveAllowed(householdId) {
            return agentSwitch.get(householdId) ?? true;
        },
        async setAgentDestructiveAllowed(householdId, allowed) {
            agentSwitch.set(householdId, allowed);
            return allowed;
        },
        __removeStore(householdId, storeId) {
            const idx = stores.findIndex(
                (row) => row.id === storeId && row.householdId === householdId,
            );
            if (idx < 0) return false;
            stores.splice(idx, 1);
            for (let i = sections.length - 1; i >= 0; i--) {
                if (sections[i]!.storeId === storeId) sections.splice(i, 1);
            }
            return true;
        },
        __setStoreOrder(householdId, orderedIds) {
            orderedIds.forEach((id, index) => {
                const row = stores.find(
                    (r) => r.id === id && r.householdId === householdId,
                );
                if (row) row.sortOrder = index;
            });
        },
        async getLocation(householdId) {
            return locations.has(householdId)
                ? (locations.get(householdId) ?? null)
                : null;
        },
        async setLocation(householdId, location) {
            locations.set(householdId, location);
        },
        async listStores(householdId) {
            return stores
                .filter((row) => row.householdId === householdId)
                .slice()
                .sort(
                    (a, b) =>
                        a.sortOrder - b.sortOrder ||
                        a.name.localeCompare(b.name),
                )
                .map((row) => ({ ...row }));
        },
        async insertStore(row) {
            stores.push({ ...row });
            return { ...row };
        },
        async updateStore(row) {
            const idx = stores.findIndex(
                (store) =>
                    store.id === row.id &&
                    store.householdId === row.householdId,
            );
            if (idx < 0) return null;
            stores[idx] = { ...stores[idx]!, name: row.name };
            return { ...stores[idx]! };
        },
        async listSections(storeId) {
            return sections
                .filter((row) => row.storeId === storeId)
                .slice()
                .sort(
                    (a, b) =>
                        a.sortOrder - b.sortOrder ||
                        a.name.localeCompare(b.name),
                )
                .map((row) => ({ ...row }));
        },
        async getSection(householdId, id) {
            const row = sections.find(
                (section) =>
                    section.id === id && section.householdId === householdId,
            );
            return row ? { ...row } : null;
        },
        async insertSection(row) {
            sections.push({ ...row });
            return { ...row };
        },
        async updateSection(row) {
            const idx = sections.findIndex(
                (section) =>
                    section.id === row.id &&
                    section.householdId === row.householdId,
            );
            if (idx < 0) return null;
            sections[idx] = { ...row };
            return { ...row };
        },
    };
}

export async function createGroceryStore(
    store: SettingsStore,
    householdId: string,
    name: string,
): Promise<GroceryStore> {
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a store name.");
    const existing = await store.listStores(householdId);
    if (existing.some((row) => row.name === trimmed)) {
        throw new SettingsInputError("That store already exists.");
    }
    const sortOrder =
        existing.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1;
    const groceryStore = await store.insertStore({
        id: crypto.randomUUID(),
        householdId,
        name: trimmed,
        sortOrder,
    });
    for (const [index, sectionName] of DEFAULT_STORE_SECTIONS.entries()) {
        await store.insertSection({
            id: crypto.randomUUID(),
            householdId,
            storeId: groceryStore.id,
            name: sectionName,
            sortOrder: index,
            hidden: false,
            isOther: sectionName === "Other",
        });
    }
    return groceryStore;
}

export async function renameSection(
    store: SettingsStore,
    householdId: string,
    sectionId: string,
    name: string,
): Promise<GrocerySection> {
    const trimmed = name.trim();
    if (!trimmed) throw new SettingsInputError("Enter a section name.");
    const current = await store.getSection(householdId, sectionId);
    if (current == null) throw new SettingsInputError("Unknown section.");
    const siblings = await store.listSections(current.storeId);
    if (siblings.some((row) => row.id !== sectionId && row.name === trimmed)) {
        throw new SettingsInputError("That section already exists.");
    }
    const updated = await store.updateSection({ ...current, name: trimmed });
    if (updated == null) throw new SettingsInputError("Unknown section.");
    return updated;
}

export async function setHouseholdLocation(
    store: SettingsStore,
    householdId: string,
    location: string,
): Promise<string | null> {
    const trimmed = location.trim();
    const value = trimmed ? trimmed : null;
    await store.setLocation(householdId, value);
    return value;
}

export function groceryStoreFromRow(row: {
    id: unknown;
    household_id: unknown;
    name: unknown;
    sort_order: unknown;
}): GroceryStore {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        name: String(row.name),
        sortOrder: Number(row.sort_order) || 0,
    };
}

export function grocerySectionFromRow(row: {
    id: unknown;
    household_id: unknown;
    store_id: unknown;
    name: unknown;
    sort_order: unknown;
    hidden: unknown;
    is_other: unknown;
}): GrocerySection {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        storeId: String(row.store_id),
        name: String(row.name),
        sortOrder: Number(row.sort_order) || 0,
        hidden: row.hidden === true,
        isOther: row.is_other === true,
    };
}

export function groceryStoreToRow(row: GroceryStore) {
    return {
        id: row.id,
        household_id: row.householdId,
        name: row.name,
        sort_order: row.sortOrder,
    };
}

export function grocerySectionToRow(row: GrocerySection) {
    return {
        id: row.id,
        household_id: row.householdId,
        store_id: row.storeId,
        name: row.name,
        sort_order: row.sortOrder,
        hidden: row.hidden,
        is_other: row.isOther,
    };
}
