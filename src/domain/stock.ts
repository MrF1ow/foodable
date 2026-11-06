import {
    effectiveFoodsByIds,
    familyOf,
    findFoodById,
    foodsByIds,
    FoodsInputError,
    type Food,
    type FoodsStore,
    type MemoryFoodRefHolder,
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
import { NOTICE_SEVERITY, type Notice } from "./notices.js";

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

/** Memory stock ledger plus merge hook so `MemoryFoodsStore.repointFoodRefs` can retarget movements. */
export type MemoryStockStore = StockStore & MemoryFoodRefHolder;

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
    movements: StockMovement[];
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

export class NotedGroceryLineAmountRequiredError extends StockInputError {
    readonly webMessage = "Enter the amount you bought.";

    constructor(displayName: string) {
        super(
            `${displayName} is 'to taste' on the list; give the amount you bought.`,
        );
        this.name = "NotedGroceryLineAmountRequiredError";
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

export function createMemoryStockStore(): MemoryStockStore {
    const movements: StockMovement[] = [];
    return {
        repointFood(householdId, fromId, toId) {
            for (const row of movements) {
                if (row.householdId === householdId && row.foodId === fromId) {
                    row.foodId = toId;
                }
            }
        },
        countFoodRefs(householdId) {
            const counts = new Map<string, number>();
            for (const row of movements) {
                if (row.householdId !== householdId) continue;
                const fid = row.foodId;
                counts.set(fid, (counts.get(fid) ?? 0) + 1);
            }
            return counts;
        },
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

function mergeQuantityFactors(
    row: FoodQuantityFactors | null | undefined,
    need: FoodQuantityFactors | null | undefined,
): FoodQuantityFactors {
    return {
        gramsPerEach: row?.gramsPerEach ?? need?.gramsPerEach ?? null,
        gramsPerMl: row?.gramsPerMl ?? need?.gramsPerMl ?? null,
    };
}

function quantityFactorsEqual(
    a: FoodQuantityFactors,
    b: FoodQuantityFactors,
): boolean {
    return (
        (a.gramsPerEach ?? null) === (b.gramsPerEach ?? null) &&
        (a.gramsPerMl ?? null) === (b.gramsPerMl ?? null)
    );
}

function recentLocationForFood(
    items: readonly FridgeItem[],
    foodId: string,
): string | null {
    const forFood = items.filter((item) => item.foodId === foodId);
    return forFood[forFood.length - 1]?.locationId ?? null;
}

export type DecrementLedgerLine = {
    foodId: string;
    delta: number;
    unit: string;
    fridgeItemId: string | null;
};

/**
 * The per-item movement for a decrement, written the way `ledgerMatchesStock`
 * reads it back: the change in the item food's default unit, converted with
 * that food's own factors, so before and after round identically on both
 * sides. Falls back to the item's own unit when that conversion is unknown.
 */
function ledgerLineFor(
    item: FridgeItem,
    food: Food | undefined,
    amountBefore: number,
    amountAfter: number,
): { delta: number; unit: string } {
    const unit = item.quantity.unit;
    if (food) {
        const ledgerUnit = food.defaultUnit || "g";
        const before = convertStockAmount(amountBefore, unit, ledgerUnit, food);
        const after =
            amountAfter === 0
                ? 0
                : convertStockAmount(amountAfter, unit, ledgerUnit, food);
        if (before != null && after != null) {
            return { delta: roundAmount(after - before), unit: ledgerUnit };
        }
    }
    return { delta: roundAmount(amountAfter - amountBefore), unit };
}

async function loadFamilyFoodMap(
    foods: FoodsStore,
    householdId: string,
    itemFoodIds: string[],
    inputFoodId: string,
): Promise<Map<string, Food>> {
    const ids = new Set(itemFoodIds);
    ids.add(inputFoodId);
    return foodsByIds(foods, householdId, [...ids]);
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
    foods: FoodsStore,
    needFood: Food,
    effectiveNeed: FoodQuantityFactors,
    input: ApplyMovementInput,
): Promise<{
    item: FridgeItem | null;
    applied: number;
    unit: string;
    shortfall: number;
    ledgerLines: DecrementLedgerLine[];
    useSingleMovementForm: boolean;
}> {
    const need = roundAmount(Math.abs(input.delta));
    if (!(need > 0)) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
    const unit = input.unit.trim();
    const items = await fridge.listItems(input.householdId);
    const familyFoodMap = await loadFamilyFoodMap(
        foods,
        input.householdId,
        items.map((item) => item.foodId).filter(Boolean) as string[],
        input.foodId,
    );
    const rawNeedFactors: FoodQuantityFactors = {
        gramsPerEach: needFood.gramsPerEach ?? null,
        gramsPerMl: needFood.gramsPerMl ?? null,
    };
    let useSingleMovementForm = true;
    const needFamily = familyOf(needFood);
    const pool = (
        input.fridgeItemId
            ? items.filter((item) => item.id === input.fridgeItemId)
            : items.filter((item) => {
                  if (!item.foodId) return false;
                  const row = familyFoodMap.get(item.foodId);
                  if (!row) return item.foodId === input.foodId;
                  return familyOf(row) === needFamily;
              })
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
    const ledgerLines: DecrementLedgerLine[] = [];
    for (const item of pool) {
        if (remaining <= 0) break;
        const rowFood = item.foodId
            ? familyFoodMap.get(item.foodId)
            : undefined;
        const factors = mergeQuantityFactors(rowFood, effectiveNeed);
        if (item.foodId !== input.foodId) {
            useSingleMovementForm = false;
        }
        if (!quantityFactorsEqual(factors, rawNeedFactors)) {
            useSingleMovementForm = false;
        }
        const haveInNeed = convertStockAmount(
            item.quantity.amount,
            item.quantity.unit,
            unit,
            factors,
        );
        if (haveInNeed == null || haveInNeed <= 0) continue;
        const take = Math.min(haveInNeed, remaining);
        const leaveInNeed = roundAmount(haveInNeed - take);
        const amountBefore = item.quantity.amount;
        let amountAfter = 0;
        let itemAfter: FridgeItem | null = null;
        if (leaveInNeed <= 0) {
            await fridge.deleteItem(input.householdId, item.id);
            lastItem = null;
        } else {
            const leaveInItem = convertStockAmount(
                leaveInNeed,
                unit,
                item.quantity.unit,
                factors,
            );
            if (leaveInItem == null || leaveInItem <= 0) {
                await fridge.deleteItem(input.householdId, item.id);
                lastItem = null;
            } else {
                amountAfter = leaveInItem;
                itemAfter = await fridge.updateItem({
                    ...item,
                    ...datesOf(item),
                    quantity: {
                        amount: leaveInItem,
                        unit: item.quantity.unit,
                    },
                });
                lastItem = itemAfter;
            }
        }
        // Rounding the leftover back into the item's unit can land on the
        // amount it already had. Nothing left the shelf, so nothing counts as
        // taken: the remainder stays a shortfall.
        if (itemAfter && amountAfter === amountBefore) continue;
        if (item.foodId) {
            const line = ledgerLineFor(
                item,
                rowFood,
                amountBefore,
                amountAfter,
            );
            if (line.delta !== 0) {
                ledgerLines.push({
                    ...line,
                    foodId: item.foodId,
                    fridgeItemId: itemAfter?.id ?? null,
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
        ledgerLines,
        useSingleMovementForm,
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
    const movementBase = {
        householdId: input.householdId,
        reason: input.reason,
        groceryLineId: input.groceryLineId ?? null,
        recipeId: input.recipeId ?? null,
        mealId: input.mealId ?? null,
        actorUserId: input.actorUserId ?? null,
        createdAt: now.toISOString(),
    };

    if (signed > 0) {
        const changed = await incrementInto(
            fridge,
            food,
            { ...input, unit },
            now,
        );
        const appliedSigned = changed.applied;
        const movement = await stock.insertMovement({
            id: crypto.randomUUID(),
            foodId: food.id,
            fridgeItemId: changed.item?.id ?? null,
            delta: appliedSigned,
            unit: changed.unit,
            ...movementBase,
        });
        return {
            movement,
            movements: [movement],
            shortfall: null,
            item: changed.item,
        };
    }

    const effectiveMap = await effectiveFoodsByIds(foods, input.householdId, [
        input.foodId,
    ]);
    const effectiveNeed = effectiveMap.get(input.foodId) ?? food;
    const changed = await decrementFrom(fridge, foods, food, effectiveNeed, {
        ...input,
        unit,
    });
    const appliedSigned = -changed.applied;
    if (appliedSigned === 0) {
        const movement = await stock.insertMovement({
            id: crypto.randomUUID(),
            foodId: food.id,
            fridgeItemId: input.fridgeItemId ?? null,
            delta: 0,
            unit,
            ...movementBase,
        });
        return {
            movement,
            movements: [movement],
            shortfall: {
                foodId: food.id,
                displayName: food.name,
                amount: Math.abs(signed),
                unit,
            },
            item: null,
        };
    }

    const movements: StockMovement[] = [];
    if (changed.useSingleMovementForm) {
        movements.push(
            await stock.insertMovement({
                id: crypto.randomUUID(),
                foodId: food.id,
                fridgeItemId: changed.item?.id ?? null,
                delta: appliedSigned,
                unit: changed.unit,
                ...movementBase,
            }),
        );
    } else {
        for (const line of changed.ledgerLines) {
            movements.push(
                await stock.insertMovement({
                    id: crypto.randomUUID(),
                    foodId: line.foodId,
                    fridgeItemId: line.fridgeItemId,
                    delta: line.delta,
                    unit: line.unit,
                    ...movementBase,
                }),
            );
        }
    }
    const movement = movements[movements.length - 1]!;
    const shortfallAmount = changed.shortfall;
    return {
        movement,
        movements,
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

/** One notice per fridge item based on expiry vs `today`; input order preserved. */
export function fridgeNotices(
    items: readonly Pick<
        FridgeItem,
        "id" | "displayName" | "quantity" | "expiresOn"
    >[],
    today: string,
): Notice[] {
    const out: Notice[] = [];
    for (const item of items) {
        const level = expiryLevel(item.expiresOn, today);
        if (level == null) continue;
        const expiresOn = item.expiresOn ?? "";
        const baseParams = {
            name: item.displayName,
            amount: item.quantity.amount,
            unit: item.quantity.unit,
            expiresOn,
            level,
        };
        const code = level === "expired" ? "fridge.expired" : "fridge.expiring";
        out.push({
            code,
            severity: NOTICE_SEVERITY[code],
            subject: { kind: "fridge_item", id: item.id },
            related: [],
            params: baseParams,
        });
    }
    return out;
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
    const itemTotal = ledgerTotalInUnit(
        items
            .filter((item) => item.foodId === food.id)
            .map((item) => ({
                amount: item.quantity.amount,
                unit: item.quantity.unit,
            })),
        food,
    );
    const ledgerTotal = ledgerTotalInUnit(
        movements
            .filter((row) => row.foodId === food.id)
            .map((row) => ({ amount: row.delta, unit: row.unit })),
        food,
    );
    return roundAmount(itemTotal) === roundAmount(ledgerTotal);
}

/**
 * Sums amounts per unit first, then converts each sum once to the food's
 * ledger unit. Converting row by row rounds each row, so two 15 ml rows on a
 * gram food read 15.5 + 15.5 on one side and 30.9 on the other once a density
 * is known (for example after a merge fills `gramsPerMl`).
 */
function ledgerTotalInUnit(
    rows: readonly { amount: number; unit: string }[],
    food: Food,
): number {
    const byUnit = new Map<string, { unit: string; amount: number }>();
    for (const row of rows) {
        const key = row.unit.trim().toLowerCase();
        const group = byUnit.get(key);
        if (group) group.amount += row.amount;
        else byUnit.set(key, { unit: row.unit, amount: row.amount });
    }
    let total = 0;
    for (const group of byUnit.values()) {
        const converted = convertStockAmount(
            group.amount,
            group.unit,
            food.defaultUnit || "g",
            food,
        );
        if (converted != null) total += converted;
    }
    return total;
}

export type PutAwayResult = {
    line: GroceryLine;
    movement: StockMovement;
    item: FridgeItem | null;
    productFoodId: string;
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
        productFoodIds?: Record<string, string | null>;
        /** Overrides line quantity when putting away (e.g. to-taste lines). */
        amountOverrides?: Record<
            string,
            { amount: number; unit?: string | null }
        >;
    },
): Promise<PutAwayResult[]> {
    const lines = await grocery.listLines(input.householdId);
    const selected = input.lineIds.map((lineId) => {
        const line = lines.find((row) => row.id === lineId);
        if (!line) throw new StockInputError("Unknown grocery line.");
        if (!line.foodId) {
            throw new StockInputError(
                `${line.displayName} is not linked to a food.`,
            );
        }
        return line;
    });
    const lineFoodIds = selected.map((line) => line.foodId!);
    const explicitChosen = selected.map((line) => {
        const pick = input.productFoodIds?.[line.id];
        return pick != null && pick !== "" ? pick : null;
    });
    const effective = await effectiveFoodsByIds(
        foods,
        input.householdId,
        lineFoodIds,
    );
    const preloadIds = new Set(lineFoodIds);
    for (const id of explicitChosen) {
        if (id) preloadIds.add(id);
    }
    for (const line of selected) {
        const eff = effective.get(line.foodId!);
        if (eff?.product?.id) preloadIds.add(eff.product.id);
    }
    const rawFoods = await foodsByIds(foods, input.householdId, [
        ...preloadIds,
    ]);
    const plans: { line: GroceryLine; chosenId: string }[] = [];
    for (let i = 0; i < selected.length; i++) {
        const line = selected[i]!;
        const lineFood = rawFoods.get(line.foodId!)!;
        const eff = effective.get(line.foodId!)!;
        const chosen = explicitChosen[i] ?? eff.product?.id ?? line.foodId!;
        const chosenRow = rawFoods.get(chosen);
        if (!chosenRow || chosenRow.archivedAt) {
            throw new StockInputError("Unknown food.");
        }
        if (familyOf(chosenRow) !== familyOf(lineFood)) {
            throw new StockInputError(
                `That product is not one of ${line.displayName}'s products.`,
            );
        }
        plans.push({ line, chosenId: chosen });
    }
    const fridgeItems = await fridge.listItems(input.householdId);
    const results: PutAwayResult[] = [];
    for (const { line, chosenId } of plans) {
        let locationId = input.locationId;
        if (!locationId) {
            locationId =
                recentLocationForFood(fridgeItems, chosenId) ??
                recentLocationForFood(fridgeItems, line.foodId!) ??
                (await lastUsedLocationId(fridge, input.householdId, chosenId));
        }
        const override = input.amountOverrides?.[line.id];
        if (line.note?.trim() && override == null) {
            throw new NotedGroceryLineAmountRequiredError(line.displayName);
        }
        const delta = override?.amount ?? line.quantity.amount;
        const unit =
            override?.unit != null && override.unit !== ""
                ? override.unit
                : line.quantity.unit;
        const applied = await applyMovement(fridge, stock, foods, {
            householdId: input.householdId,
            foodId: chosenId,
            delta,
            unit,
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
            productFoodId: chosenId,
        });
    }
    return results;
}

export type CookRecipeResult = {
    totalPortions: number;
    shortfalls: StockShortfall[];
    unmeasured: { foodId: string | null; displayName: string }[];
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
    const unmeasured: CookRecipeResult["unmeasured"] = [];
    const scale = totalPortions / recipe.yieldPortions;
    for (const ingredient of ingredients) {
        if (ingredient.quantity == null) {
            unmeasured.push({
                foodId: ingredient.foodId,
                displayName: ingredient.displayName,
            });
            continue;
        }
        if (input.deductStock === false) {
            continue;
        }
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
    return { totalPortions, shortfalls, unmeasured };
}

/** Meal logging after an eat movement applies only to catalog foods, not supplies. */
export function fridgeEatLogsMeal(food: Pick<Food, "kind">): boolean {
    return food.kind === "food";
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
    // Stock is kept to 0.1, so an amount that rounds to zero would delete the
    // item rather than update it.
    if (!Number.isFinite(input.amount) || roundAmount(input.amount) <= 0) {
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
    const effectiveMap = await effectiveFoodsByIds(foods, input.householdId, [
        current.foodId,
    ]);
    const effectiveNeed = effectiveMap.get(current.foodId) ?? food;
    const factors = mergeQuantityFactors(food, effectiveNeed);
    const currentInUnit = convertStockAmount(
        current.quantity.amount,
        current.quantity.unit,
        unit,
        factors,
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
