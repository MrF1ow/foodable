import type { FoodResult } from "../foods.js";
import {
    findFoodById,
    findOrCreateFoodByBarcode,
    findOrCreateManualFood,
    FoodsInputError,
    type Food,
    type FoodsStore,
} from "./foods.js";
import { storedFoodUnit } from "./food-quantity.js";

export type FridgeKind = "food" | "supply";

export type FridgeQuantity = { amount: number; unit: string };

export type FridgeLocation = {
    id: string;
    householdId: string;
    name: string;
    sortOrder: number;
};

export type FridgeItem = {
    id: string;
    householdId: string;
    locationId: string;
    kind: FridgeKind;
    displayName: string;
    quantity: FridgeQuantity;
    foodId: string | null;
    purchasedOn?: string | null;
    openedOn?: string | null;
    expiresOn?: string | null;
};

export type FridgeSnapshot = {
    locations: FridgeLocation[];
    items: FridgeItem[];
};

export type FridgeStore = {
    listLocations(householdId: string): Promise<FridgeLocation[]>;
    insertLocation(row: FridgeLocation): Promise<FridgeLocation>;
    updateLocation(row: FridgeLocation): Promise<FridgeLocation | null>;
    deleteLocation(householdId: string, id: string): Promise<boolean>;
    listItems(householdId: string): Promise<FridgeItem[]>;
    insertItem(row: FridgeItem): Promise<FridgeItem>;
    updateItem(row: FridgeItem): Promise<FridgeItem | null>;
    deleteItem(householdId: string, id: string): Promise<boolean>;
};

export class FridgeInputError extends Error {
    readonly code = "fridge_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "FridgeInputError";
    }
}

export function createMemoryFridgeStore(): FridgeStore {
    const locations: FridgeLocation[] = [];
    const items: FridgeItem[] = [];

    return {
        async listLocations(householdId) {
            return locations
                .filter((row) => row.householdId === householdId)
                .slice()
                .sort(
                    (a, b) =>
                        a.sortOrder - b.sortOrder ||
                        a.name.localeCompare(b.name),
                );
        },
        async insertLocation(row) {
            locations.push({ ...row });
            return { ...row };
        },
        async updateLocation(row) {
            const idx = locations.findIndex(
                (loc) =>
                    loc.id === row.id && loc.householdId === row.householdId,
            );
            if (idx < 0) return null;
            locations[idx] = { ...row };
            return { ...row };
        },
        async deleteLocation(householdId, id) {
            const before = locations.length;
            for (let i = items.length - 1; i >= 0; i--) {
                if (
                    items[i]!.householdId === householdId &&
                    items[i]!.locationId === id
                ) {
                    items.splice(i, 1);
                }
            }
            const next = locations.filter(
                (loc) => !(loc.householdId === householdId && loc.id === id),
            );
            const removed = next.length < before;
            locations.length = 0;
            locations.push(...next);
            return removed;
        },
        async listItems(householdId) {
            return items
                .filter((row) => row.householdId === householdId)
                .map((row) => ({ ...row, quantity: { ...row.quantity } }));
        },
        async insertItem(row) {
            const saved = {
                ...row,
                quantity: { ...row.quantity },
                purchasedOn: row.purchasedOn ?? null,
                openedOn: row.openedOn ?? null,
                expiresOn: row.expiresOn ?? null,
            };
            items.push(saved);
            return {
                ...saved,
                quantity: { ...saved.quantity },
            };
        },
        async updateItem(row) {
            const idx = items.findIndex(
                (item) =>
                    item.id === row.id && item.householdId === row.householdId,
            );
            if (idx < 0) return null;
            items[idx] = {
                ...row,
                quantity: { ...row.quantity },
                purchasedOn: row.purchasedOn ?? null,
                openedOn: row.openedOn ?? null,
                expiresOn: row.expiresOn ?? null,
            };
            return {
                ...row,
                quantity: { ...row.quantity },
                purchasedOn: row.purchasedOn ?? null,
                openedOn: row.openedOn ?? null,
                expiresOn: row.expiresOn ?? null,
            };
        },
        async deleteItem(householdId, id) {
            const before = items.length;
            const next = items.filter(
                (item) => !(item.householdId === householdId && item.id === id),
            );
            const removed = next.length < before;
            items.length = 0;
            items.push(...next);
            return removed;
        },
    };
}

export async function listFridge(
    store: FridgeStore,
    householdId: string,
): Promise<FridgeSnapshot> {
    const [locations, items] = await Promise.all([
        store.listLocations(householdId),
        store.listItems(householdId),
    ]);
    return { locations, items };
}

export async function addLocation(
    store: FridgeStore,
    householdId: string,
    name: string,
): Promise<FridgeLocation> {
    const trimmed = name.trim();
    if (!trimmed) throw new FridgeInputError("Enter a location name.");
    const existing = await store.listLocations(householdId);
    if (existing.some((loc) => loc.name === trimmed)) {
        throw new FridgeInputError("That location already exists.");
    }
    const sortOrder =
        existing.reduce((max, loc) => Math.max(max, loc.sortOrder), -1) + 1;
    return store.insertLocation({
        id: crypto.randomUUID(),
        householdId,
        name: trimmed,
        sortOrder,
    });
}

export async function deleteLocation(
    store: FridgeStore,
    householdId: string,
    id: string,
): Promise<boolean> {
    return store.deleteLocation(householdId, id);
}

function parseAmount(amount: number): number {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new FridgeInputError("Enter an amount greater than zero.");
    }
    return amount;
}

function wrapFoodsError(err: unknown): never {
    if (err instanceof FoodsInputError) {
        throw new FridgeInputError(err.message);
    }
    throw err;
}

export type PreparedFridgeAdd = {
    householdId: string;
    locationId: string;
    amount: number;
    unit: string;
    food: Food;
};

async function insertFromFood(
    store: FridgeStore,
    input: PreparedFridgeAdd,
): Promise<FridgeItem> {
    return store.insertItem({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        locationId: input.locationId,
        kind: input.food.kind,
        displayName: input.food.name,
        quantity: { amount: input.amount, unit: input.unit },
        foodId: input.food.id,
        purchasedOn: null,
        openedOn: null,
        expiresOn: null,
    });
}

export async function prepareAddFoodById(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        foodId: string;
        amount: number;
        unit?: string;
    },
): Promise<PreparedFridgeAdd> {
    await requireLocation(store, input.householdId, input.locationId);
    const amount = parseAmount(input.amount);
    try {
        const food = await findFoodById(foods, input.householdId, input.foodId);
        if (food.kind !== "food") {
            throw new FridgeInputError("That catalog item is a supply.");
        }
        return {
            householdId: input.householdId,
            locationId: input.locationId,
            amount,
            unit: storedFoodUnit(input.unit, food),
            food,
        };
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addFoodById(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        foodId: string;
        amount: number;
        unit?: string;
    },
): Promise<FridgeItem> {
    return insertFromFood(store, await prepareAddFoodById(store, foods, input));
}

export async function prepareAddFoodByBarcode(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        barcode: string;
        amount: number;
        unit?: string;
    },
    opts: {
        lookup: (barcode: string) => Promise<FoodResult | null>;
    },
): Promise<PreparedFridgeAdd> {
    await requireLocation(store, input.householdId, input.locationId);
    const amount = parseAmount(input.amount);
    try {
        const food = await findOrCreateFoodByBarcode(
            foods,
            input.householdId,
            input.barcode,
            opts.lookup,
        );
        return {
            householdId: input.householdId,
            locationId: input.locationId,
            amount,
            unit: storedFoodUnit(input.unit, food),
            food,
        };
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addFoodByBarcode(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        barcode: string;
        amount: number;
        unit?: string;
    },
    opts: {
        lookup: (barcode: string) => Promise<FoodResult | null>;
    },
): Promise<FridgeItem> {
    return insertFromFood(
        store,
        await prepareAddFoodByBarcode(store, foods, input, opts),
    );
}

export async function prepareAddManualFood(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        name: string;
        amount: number;
        unit?: string;
    },
): Promise<PreparedFridgeAdd> {
    await requireLocation(store, input.householdId, input.locationId);
    const amount = parseAmount(input.amount);
    try {
        const food = await findOrCreateManualFood(
            foods,
            input.householdId,
            "food",
            input.name,
        );
        return {
            householdId: input.householdId,
            locationId: input.locationId,
            amount,
            unit: storedFoodUnit(input.unit, food),
            food,
        };
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addManualFood(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        name: string;
        amount: number;
        unit?: string;
    },
): Promise<FridgeItem> {
    return insertFromFood(
        store,
        await prepareAddManualFood(store, foods, input),
    );
}

export async function prepareAddSupply(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        name: string;
        amount: number;
        unit: string;
        foodId?: string;
    },
): Promise<PreparedFridgeAdd> {
    await requireLocation(store, input.householdId, input.locationId);
    const unit = input.unit.trim();
    if (!unit) throw new FridgeInputError("Enter a unit.");
    const amount = parseAmount(input.amount);
    try {
        const food = input.foodId
            ? await findFoodById(foods, input.householdId, input.foodId)
            : await findOrCreateManualFood(
                  foods,
                  input.householdId,
                  "supply",
                  input.name,
              );
        if (food.kind !== "supply") {
            throw new FridgeInputError("That catalog item is a food.");
        }
        return {
            householdId: input.householdId,
            locationId: input.locationId,
            amount,
            unit,
            food,
        };
    } catch (err) {
        wrapFoodsError(err);
    }
}

export async function addSupply(
    store: FridgeStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        locationId: string;
        name: string;
        amount: number;
        unit: string;
        foodId?: string;
    },
): Promise<FridgeItem> {
    return insertFromFood(store, await prepareAddSupply(store, foods, input));
}

export async function updateItemQuantity(
    store: FridgeStore,
    householdId: string,
    itemId: string,
    quantity: FridgeQuantity,
): Promise<FridgeItem | null> {
    const items = await store.listItems(householdId);
    const current = items.find((item) => item.id === itemId);
    if (!current) return null;
    const amount = parseAmount(quantity.amount);
    const unit = current.kind === "food" ? "g" : quantity.unit.trim();
    if (current.kind === "supply" && !unit) {
        throw new FridgeInputError("Enter a unit.");
    }
    return store.updateItem({
        ...current,
        quantity: { amount, unit },
    });
}

export async function moveItem(
    store: FridgeStore,
    householdId: string,
    itemId: string,
    locationId: string,
): Promise<FridgeItem | null> {
    await requireLocation(store, householdId, locationId);
    const items = await store.listItems(householdId);
    const current = items.find((item) => item.id === itemId);
    if (!current) return null;
    return store.updateItem({ ...current, locationId });
}

export async function deleteItem(
    store: FridgeStore,
    householdId: string,
    itemId: string,
): Promise<boolean> {
    return store.deleteItem(householdId, itemId);
}

async function requireLocation(
    store: FridgeStore,
    householdId: string,
    locationId: string,
): Promise<FridgeLocation> {
    const locations = await store.listLocations(householdId);
    const loc = locations.find((row) => row.id === locationId);
    if (!loc) throw new FridgeInputError("Unknown location.");
    return loc;
}

export function fridgeLocationFromRow(row: {
    id: unknown;
    household_id: unknown;
    name: unknown;
    sort_order: unknown;
}): FridgeLocation {
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        name: String(row.name),
        sortOrder: Number(row.sort_order) || 0,
    };
}

export function fridgeItemFromRow(row: {
    id: unknown;
    household_id: unknown;
    location_id: unknown;
    kind: unknown;
    display_name: unknown;
    amount: unknown;
    unit: unknown;
    food_id?: unknown;
    purchased_on?: unknown;
    opened_on?: unknown;
    expires_on?: unknown;
}): FridgeItem {
    const kind = row.kind === "supply" ? "supply" : "food";
    const dateOrNull = (value: unknown): string | null =>
        value == null || value === "" ? null : String(value).slice(0, 10);
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        locationId: String(row.location_id),
        kind,
        displayName: String(row.display_name),
        quantity: {
            amount: Number(row.amount),
            unit: String(row.unit),
        },
        foodId:
            row.food_id == null || row.food_id === ""
                ? null
                : String(row.food_id),
        purchasedOn: dateOrNull(row.purchased_on),
        openedOn: dateOrNull(row.opened_on),
        expiresOn: dateOrNull(row.expires_on),
    };
}

export function fridgeLocationToRow(row: FridgeLocation) {
    return {
        id: row.id,
        household_id: row.householdId,
        name: row.name,
        sort_order: row.sortOrder,
    };
}

export function fridgeItemToRow(row: FridgeItem) {
    return {
        id: row.id,
        household_id: row.householdId,
        location_id: row.locationId,
        kind: row.kind,
        display_name: row.displayName,
        amount: row.quantity.amount,
        unit: row.quantity.unit,
        food_id: row.foodId,
        purchased_on: row.purchasedOn ?? null,
        opened_on: row.openedOn ?? null,
        expires_on: row.expiresOn ?? null,
    };
}
