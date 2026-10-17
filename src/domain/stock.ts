import { catalogIdentity } from "./food-identity.js";
import {
    findFoodById,
    FoodsInputError,
    type Food,
    type FoodsStore,
} from "./foods.js";
import {
    fromGrams,
    toGrams,
    type FoodQuantityFactors,
} from "./food-quantity.js";
import {
    type FridgeItem,
    type FridgeStore,
    FridgeInputError,
} from "./fridge.js";
import type { GroceryLine, GroceryListStore } from "./grocery.js";
import {
    convertQuantity,
    dimensionOf,
    isQuantityUnit,
    type Quantity,
    type QuantityUnit,
} from "./quantity.js";
import type { RecipesStore } from "./recipes.js";

export type StockReason = "purchase" | "cook" | "eat" | "discard" | "adjust";

export type StockMovement = {
    id: string;
    householdId: string;
    foodId: string;
    fridgeItemId: string | null;
    delta: number;
    unit: string;
    reason: StockReason;
    groceryLineId: string | null;
    recipeId: string | null;
    mealId: string | null;
    actorUserId: string | null;
    createdAt: string;
};

export type StockStore = {
    insertMovement(row: StockMovement): Promise<StockMovement>;
    /** Attach the meal a movement produced. The movement is written first
     * (the meal's amount depends on what was actually deducted), so the link
     * is set once the meal exists. */
    linkMeal(
        householdId: string,
        movementId: string,
        mealId: string,
    ): Promise<void>;
    listMovements(
        householdId: string,
        foodId?: string,
    ): Promise<StockMovement[]>;
};

export type StockShortfall = {
    foodId: string;
    displayName: string;
    amount: number;
    unit: string;
};

export type ApplyMovementInput = {
    householdId: string;
    foodId: string;
    delta: number;
    unit: string;
    reason: StockReason;
    locationId?: string | null;
    fridgeItemId?: string | null;
    groceryLineId?: string | null;
    recipeId?: string | null;
    mealId?: string | null;
    actorUserId?: string | null;
    purchasedOn?: string | null;
    openedOn?: string | null;
    expiresOn?: string | null;
    now?: Date;
};

export type ApplyMovementResult = {
    movement: StockMovement;
    shortfall: StockShortfall | null;
    item: FridgeItem | null;
};

export class StockInputError extends Error {
    readonly code = "stock_input" as const;

    constructor(message: string) {
        super(message);
        this.name = "StockInputError";
    }
}

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

function todayIsoDate(now: Date): string {
    return now.toISOString().slice(0, 10);
}

function wrapFoodsError(err: unknown): never {
    if (err instanceof FoodsInputError) {
        throw new StockInputError(err.message);
    }
    throw err;
}

export function createMemoryStockStore(): StockStore {
    const movements: StockMovement[] = [];
    return {
        async insertMovement(row) {
            const saved = { ...row };
            movements.push(saved);
            return { ...saved };
        },
        async linkMeal(householdId, movementId, mealId) {
            const row = movements.find(
                (m) => m.id === movementId && m.householdId === householdId,
            );
            if (row) row.mealId = mealId;
        },
        async listMovements(householdId, foodId) {
            return movements
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        (foodId == null || row.foodId === foodId),
                )
                .map((row) => ({ ...row }))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        },
    };
}

export function convertStockAmount(
    amount: number,
    fromUnit: string,
    toUnit: string,
    food: FoodQuantityFactors | null | undefined,
): number | null {
    if (!Number.isFinite(amount)) return null;
    const from = fromUnit.trim();
    const to = toUnit.trim();
    if (!from || !to) return null;
    if (from === to || from.toLowerCase() === to.toLowerCase()) {
        return roundAmount(amount);
    }
    if (!isQuantityUnit(from) || !isQuantityUnit(to)) return null;
    if (dimensionOf(from) === dimensionOf(to)) {
        return convertQuantity(
            { amount, unit: from } as Quantity,
            to as QuantityUnit,
        ).amount;
    }
    const grams = toGrams({ amount, unit: from }, food);
    if (grams == null) return null;
    return fromGrams(grams, to, food);
}

function unitsCompatible(
    fromUnit: string,
    toUnit: string,
    food: FoodQuantityFactors | null | undefined,
): boolean {
    return convertStockAmount(1, fromUnit, toUnit, food) != null;
}

function expirySortKey(item: FridgeItem): number {
    if (!item.expiresOn) return Number.POSITIVE_INFINITY;
    const ms = Date.parse(item.expiresOn);
    return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY;
}

export async function lastUsedLocationId(
    fridge: FridgeStore,
    householdId: string,
    foodId: string,
): Promise<string | null> {
    const items = (await fridge.listItems(householdId)).filter(
        (item) => item.foodId === foodId,
    );
    const last = items[items.length - 1];
    if (last) return last.locationId;
    const locations = await fridge.listLocations(householdId);
    return locations[0]?.id ?? null;
}

function datesOf(item: FridgeItem): {
    purchasedOn: string | null;
    openedOn: string | null;
    expiresOn: string | null;
} {
    return {
        purchasedOn: item.purchasedOn ?? null,
        openedOn: item.openedOn ?? null,
        expiresOn: item.expiresOn ?? null,
    };
}

async function incrementInto(
    fridge: FridgeStore,
    food: Food,
    input: ApplyMovementInput,
    now: Date,
): Promise<{ item: FridgeItem; applied: number; unit: string }> {
    const amount = roundAmount(input.delta);
    if (!(amount > 0)) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
    const items = await fridge.listItems(input.householdId);
    const locationId =
        input.locationId ??
        items.find((item) => item.id === input.fridgeItemId)?.locationId ??
        (await lastUsedLocationId(fridge, input.householdId, input.foodId));
    if (!locationId) {
        throw new StockInputError("Add a fridge location first.");
    }
    const locations = await fridge.listLocations(input.householdId);
    if (!locations.some((loc) => loc.id === locationId)) {
        throw new FridgeInputError("Unknown location.");
    }

    let target: FridgeItem | undefined;
    if (input.fridgeItemId) {
        target = items.find(
            (item) =>
                item.id === input.fridgeItemId &&
                item.householdId === input.householdId,
        );
        if (!target) {
            throw new StockInputError("Unknown fridge item.");
        }
        if (target.foodId !== input.foodId) {
            throw new StockInputError("That item is a different food.");
        }
        if (!unitsCompatible(input.unit, target.quantity.unit, food)) {
            throw new StockInputError(
                "That amount cannot be merged into the existing item.",
            );
        }
    } else {
        const incomingExpiry = input.expiresOn ?? null;
        target = items.find(
            (item) =>
                item.foodId === input.foodId &&
                item.locationId === locationId &&
                (item.expiresOn ?? null) === incomingExpiry &&
                unitsCompatible(input.unit, item.quantity.unit, food),
        );
    }

    if (target) {
        const add = convertStockAmount(
            amount,
            input.unit,
            target.quantity.unit,
            food,
        );
        if (add == null) {
            throw new StockInputError(
                "That amount cannot be merged into the existing item.",
            );
        }
        const updated = await fridge.updateItem({
            ...target,
            ...datesOf(target),
            quantity: {
                amount: roundAmount(target.quantity.amount + add),
                unit: target.quantity.unit,
            },
            purchasedOn: target.purchasedOn ?? input.purchasedOn ?? null,
            openedOn: target.openedOn ?? input.openedOn ?? null,
            expiresOn: target.expiresOn ?? input.expiresOn ?? null,
        });
        if (!updated) {
            throw new StockInputError("Unknown fridge item.");
        }
        return { item: updated, applied: amount, unit: input.unit };
    }

    const item = await fridge.insertItem({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        locationId,
        kind: food.kind,
        displayName: food.name,
        quantity: { amount, unit: input.unit.trim() },
        identity: catalogIdentity(food.kind, food.id, food.name),
        foodId: food.id,
        purchasedOn:
            input.purchasedOn ??
            (input.reason === "purchase" ? todayIsoDate(now) : null),
        openedOn: input.openedOn ?? null,
        expiresOn: input.expiresOn ?? null,
    });
    return { item, applied: amount, unit: input.unit };
}

async function decrementFrom(
    fridge: FridgeStore,
    food: Food,
    input: ApplyMovementInput,
): Promise<{
    item: FridgeItem | null;
    applied: number;
    unit: string;
    shortfall: number;
}> {
    const need = roundAmount(Math.abs(input.delta));
    if (!(need > 0)) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
    const unit = input.unit.trim();
    const items = await fridge.listItems(input.householdId);
    const pool = (
        input.fridgeItemId
            ? items.filter((item) => item.id === input.fridgeItemId)
            : items.filter((item) => item.foodId === input.foodId)
    ).slice();
    if (input.fridgeItemId) {
        const target = pool[0];
        if (!target) throw new StockInputError("Unknown fridge item.");
        if (target.foodId !== input.foodId) {
            throw new StockInputError("That item is a different food.");
        }
    }
    pool.sort((a, b) => {
        const byExpiry = expirySortKey(a) - expirySortKey(b);
        if (byExpiry !== 0) return byExpiry;
        return a.id.localeCompare(b.id);
    });

    let remaining = need;
    let lastItem: FridgeItem | null = null;
    for (const item of pool) {
        if (remaining <= 0) break;
        const haveInNeed = convertStockAmount(
            item.quantity.amount,
            item.quantity.unit,
            unit,
            food,
        );
        if (haveInNeed == null || haveInNeed <= 0) continue;
        const take = Math.min(haveInNeed, remaining);
        const leaveInNeed = roundAmount(haveInNeed - take);
        if (leaveInNeed <= 0) {
            await fridge.deleteItem(input.householdId, item.id);
            lastItem = null;
        } else {
            const leaveInItem = convertStockAmount(
                leaveInNeed,
                unit,
                item.quantity.unit,
                food,
            );
            if (leaveInItem == null || leaveInItem <= 0) {
                await fridge.deleteItem(input.householdId, item.id);
                lastItem = null;
            } else {
                lastItem = await fridge.updateItem({
                    ...item,
                    ...datesOf(item),
                    quantity: {
                        amount: leaveInItem,
                        unit: item.quantity.unit,
                    },
                });
            }
        }
        remaining = roundAmount(remaining - take);
    }
    const applied = roundAmount(need - Math.max(remaining, 0));
    return {
        item: lastItem,
        applied,
        unit,
        shortfall: remaining > 0 ? remaining : 0,
    };
}

/**
 * Apply one signed stock movement. Positive deltas merge into an existing
 * fridge item with the same food, location, and convertible unit, or create
 * one. Negative deltas walk items oldest-expiry first and never go negative:
 * leftover demand is a shortfall, not a clamped zero.
 */
export async function applyMovement(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: ApplyMovementInput,
): Promise<ApplyMovementResult> {
    if (!Number.isFinite(input.delta) || input.delta === 0) {
        throw new StockInputError("Enter a non-zero amount.");
    }
    const unit = input.unit.trim();
    if (!unit) throw new StockInputError("Enter a unit.");
    let food: Food;
    try {
        food = await findFoodById(foods, input.householdId, input.foodId);
    } catch (err) {
        wrapFoodsError(err);
    }
    const now = input.now ?? new Date();
    const signed = input.delta;
    const changed =
        signed > 0
            ? await incrementInto(fridge, food, { ...input, unit }, now)
            : await decrementFrom(fridge, food, { ...input, unit });
    const appliedSigned = signed > 0 ? changed.applied : -changed.applied;
    if (appliedSigned === 0 && signed < 0) {
        const movement = await stock.insertMovement({
            id: crypto.randomUUID(),
            householdId: input.householdId,
            foodId: food.id,
            fridgeItemId: input.fridgeItemId ?? null,
            delta: 0,
            unit,
            reason: input.reason,
            groceryLineId: input.groceryLineId ?? null,
            recipeId: input.recipeId ?? null,
            mealId: input.mealId ?? null,
            actorUserId: input.actorUserId ?? null,
            createdAt: now.toISOString(),
        });
        return {
            movement,
            shortfall: {
                foodId: food.id,
                displayName: food.name,
                amount: Math.abs(signed),
                unit,
            },
            item: null,
        };
    }
    const movement = await stock.insertMovement({
        id: crypto.randomUUID(),
        householdId: input.householdId,
        foodId: food.id,
        fridgeItemId: changed.item?.id ?? null,
        delta: appliedSigned,
        unit: changed.unit,
        reason: input.reason,
        groceryLineId: input.groceryLineId ?? null,
        recipeId: input.recipeId ?? null,
        mealId: input.mealId ?? null,
        actorUserId: input.actorUserId ?? null,
        createdAt: now.toISOString(),
    });
    const shortfallAmount =
        signed < 0 && "shortfall" in changed ? changed.shortfall : 0;
    return {
        movement,
        shortfall:
            shortfallAmount > 0
                ? {
                      foodId: food.id,
                      displayName: food.name,
                      amount: shortfallAmount,
                      unit,
                  }
                : null,
        item: changed.item,
    };
}

export type ExpiryLevel = "expired" | "high" | "medium" | "low";

export function utcTodayFromDate(now = new Date()): string {
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    )
        .toISOString()
        .slice(0, 10);
}

function utcDayIndex(isoDate: string): number {
    const [y, m, d] = isoDate.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!) / 86_400_000;
}

/** Days from `today` until `expiresOn` (0 = expires today). */
function daysUntilExpiry(today: string, expiresOn: string): number {
    return utcDayIndex(expiresOn) - utcDayIndex(today);
}

export function expiryLevel(
    expiresOn: string | null | undefined,
    today: string,
): ExpiryLevel | null {
    if (!expiresOn) return null;
    const days = daysUntilExpiry(today, expiresOn);
    if (days < 0) return "expired";
    if (days <= 1) return "high";
    if (days <= 3) return "medium";
    if (days <= 7) return "low";
    return null;
}

export function listExpiring(
    items: readonly FridgeItem[],
    days = 3,
    now = new Date(),
): FridgeItem[] {
    const horizon = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    horizon.setUTCDate(horizon.getUTCDate() + days);
    const latest = horizon.toISOString().slice(0, 10);
    return items
        .filter((item) => item.expiresOn && item.expiresOn <= latest)
        .slice()
        .sort((a, b) => {
            const byDate = (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "");
            if (byDate !== 0) return byDate;
            return a.displayName.localeCompare(b.displayName);
        });
}

export function ledgerAmount(
    quantity: { amount: number; unit: string },
    food: FoodQuantityFactors,
): { amount: number; unit: string } | null {
    const grams = toGrams(quantity, food);
    if (grams != null) return { amount: grams, unit: "g" };
    return {
        amount: roundAmount(quantity.amount),
        unit: quantity.unit,
    };
}

export function ledgerMatchesStock(
    items: readonly FridgeItem[],
    movements: readonly StockMovement[],
    food: Food,
): boolean {
    const itemTotal = items
        .filter((item) => item.foodId === food.id)
        .reduce((sum, item) => {
            const converted = convertStockAmount(
                item.quantity.amount,
                item.quantity.unit,
                food.defaultUnit || "g",
                food,
            );
            return converted == null ? sum : sum + converted;
        }, 0);
    const ledgerTotal = movements
        .filter((row) => row.foodId === food.id)
        .reduce((sum, row) => {
            const converted = convertStockAmount(
                row.delta,
                row.unit,
                food.defaultUnit || "g",
                food,
            );
            return converted == null ? sum : sum + converted;
        }, 0);
    return roundAmount(itemTotal) === roundAmount(ledgerTotal);
}

export type PutAwayResult = {
    line: GroceryLine;
    movement: StockMovement;
    item: FridgeItem | null;
};

export async function putAwayGroceryLines(
    grocery: GroceryListStore,
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        lineIds: string[];
        locationId?: string | null;
        actorUserId?: string | null;
        expiresOn?: string | null;
    },
): Promise<PutAwayResult[]> {
    const lines = await grocery.listLines(input.householdId);
    const results: PutAwayResult[] = [];
    for (const lineId of input.lineIds) {
        const line = lines.find((row) => row.id === lineId);
        if (!line) throw new StockInputError("Unknown grocery line.");
        if (!line.foodId) {
            throw new StockInputError(
                `${line.displayName} is not linked to a food.`,
            );
        }
        const locationId =
            input.locationId ||
            (await lastUsedLocationId(fridge, input.householdId, line.foodId));
        const applied = await applyMovement(fridge, stock, foods, {
            householdId: input.householdId,
            foodId: line.foodId,
            delta: line.quantity.amount,
            unit: line.quantity.unit,
            reason: "purchase",
            locationId,
            groceryLineId: line.id,
            actorUserId: input.actorUserId,
            expiresOn: input.expiresOn,
        });
        await grocery.deleteLine(input.householdId, line.id);
        results.push({
            line,
            movement: applied.movement,
            item: applied.item,
        });
    }
    return results;
}

export type CookRecipeResult = {
    totalPortions: number;
    shortfalls: StockShortfall[];
};

export async function cookRecipe(
    recipes: RecipesStore,
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        recipeId: string;
        totalPortions: number;
        deductStock?: boolean;
        actorUserId?: string | null;
    },
): Promise<CookRecipeResult> {
    const recipe = await recipes.getRecipe(input.householdId, input.recipeId);
    if (!recipe) throw new StockInputError("Unknown recipe.");
    const totalPortions = input.totalPortions;
    if (!Number.isFinite(totalPortions) || totalPortions <= 0) {
        throw new StockInputError("Enter portions greater than zero.");
    }
    const ingredients = await recipes.listIngredients(
        input.householdId,
        recipe.id,
    );
    const shortfalls: StockShortfall[] = [];
    if (input.deductStock === false) {
        return { totalPortions, shortfalls };
    }
    const scale = totalPortions / recipe.yieldPortions;
    for (const ingredient of ingredients) {
        if (!ingredient.foodId) {
            shortfalls.push({
                foodId: "",
                displayName: ingredient.displayName,
                amount: roundAmount(ingredient.quantity.amount * scale),
                unit: ingredient.quantity.unit,
            });
            continue;
        }
        const need = roundAmount(ingredient.quantity.amount * scale);
        if (!(need > 0)) continue;
        const applied = await applyMovement(fridge, stock, foods, {
            householdId: input.householdId,
            foodId: ingredient.foodId,
            delta: -need,
            unit: ingredient.quantity.unit,
            reason: "cook",
            recipeId: recipe.id,
            actorUserId: input.actorUserId,
        });
        if (applied.shortfall) shortfalls.push(applied.shortfall);
    }
    return { totalPortions, shortfalls };
}

export async function eatFridgeItem(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        itemId: string;
        amount?: number;
        actorUserId?: string | null;
    },
): Promise<ApplyMovementResult & { itemBefore: FridgeItem }> {
    const items = await fridge.listItems(input.householdId);
    const current = items.find((item) => item.id === input.itemId);
    if (!current) throw new StockInputError("Unknown fridge item.");
    if (!current.foodId) {
        throw new StockInputError(
            `${current.displayName} is not linked to a food.`,
        );
    }
    const amount = input.amount ?? current.quantity.amount;
    const result = await applyMovement(fridge, stock, foods, {
        householdId: input.householdId,
        foodId: current.foodId,
        delta: -amount,
        unit: current.quantity.unit,
        reason: "eat",
        fridgeItemId: current.id,
        actorUserId: input.actorUserId,
    });
    return { ...result, itemBefore: current };
}

export async function addFridgeItemAdjust(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        foodId: string;
        amount: number;
        unit: string;
        locationId: string;
        actorUserId?: string | null;
        purchasedOn?: string | null;
        openedOn?: string | null;
        expiresOn?: string | null;
    },
): Promise<ApplyMovementResult> {
    return applyMovement(fridge, stock, foods, {
        householdId: input.householdId,
        foodId: input.foodId,
        delta: input.amount,
        unit: input.unit,
        reason: "adjust",
        locationId: input.locationId,
        actorUserId: input.actorUserId,
        purchasedOn: input.purchasedOn,
        openedOn: input.openedOn,
        expiresOn: input.expiresOn,
    });
}

export async function updateFridgeItemQuantityAdjust(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        itemId: string;
        amount: number;
        unit?: string;
        actorUserId?: string | null;
    },
): Promise<FridgeItem | null> {
    const items = await fridge.listItems(input.householdId);
    const current = items.find((item) => item.id === input.itemId);
    if (!current) return null;
    if (!current.foodId) {
        throw new StockInputError(
            `${current.displayName} is not linked to a food.`,
        );
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
    const unit = input.unit?.trim() || current.quantity.unit;
    if (!unit) throw new StockInputError("Enter a unit.");
    let food: Food;
    try {
        food = await findFoodById(foods, input.householdId, current.foodId);
    } catch (err) {
        wrapFoodsError(err);
    }
    const currentInUnit = convertStockAmount(
        current.quantity.amount,
        current.quantity.unit,
        unit,
        food,
    );
    if (currentInUnit == null) {
        throw new StockInputError(
            "That amount cannot be merged into the existing item.",
        );
    }
    const delta = roundAmount(input.amount - currentInUnit);
    if (delta === 0) {
        if (
            unit === current.quantity.unit &&
            current.quantity.amount === roundAmount(input.amount)
        ) {
            return current;
        }
        return fridge.updateItem({
            ...current,
            ...datesOf(current),
            quantity: { amount: roundAmount(input.amount), unit },
        });
    }
    const result = await applyMovement(fridge, stock, foods, {
        householdId: input.householdId,
        foodId: current.foodId,
        delta,
        unit,
        reason: "adjust",
        fridgeItemId: current.id,
        actorUserId: input.actorUserId,
    });
    return result.item;
}

export async function deleteFridgeItemAdjust(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        itemId: string;
        actorUserId?: string | null;
    },
): Promise<boolean> {
    const items = await fridge.listItems(input.householdId);
    const current = items.find((item) => item.id === input.itemId);
    if (!current) return false;
    if (!current.foodId) {
        throw new StockInputError(
            `${current.displayName} is not linked to a food.`,
        );
    }
    await applyMovement(fridge, stock, foods, {
        householdId: input.householdId,
        foodId: current.foodId,
        delta: -current.quantity.amount,
        unit: current.quantity.unit,
        reason: "adjust",
        fridgeItemId: current.id,
        actorUserId: input.actorUserId,
    });
    return true;
}

export async function discardFridgeItem(
    fridge: FridgeStore,
    stock: StockStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        itemId: string;
        amount?: number;
        actorUserId?: string | null;
    },
): Promise<ApplyMovementResult> {
    const items = await fridge.listItems(input.householdId);
    const current = items.find((item) => item.id === input.itemId);
    if (!current) throw new StockInputError("Unknown fridge item.");
    if (!current.foodId) {
        throw new StockInputError(
            `${current.displayName} is not linked to a food.`,
        );
    }
    const amount = input.amount ?? current.quantity.amount;
    return applyMovement(fridge, stock, foods, {
        householdId: input.householdId,
        foodId: current.foodId,
        delta: -amount,
        unit: current.quantity.unit,
        reason: "discard",
        fridgeItemId: current.id,
        actorUserId: input.actorUserId,
    });
}
