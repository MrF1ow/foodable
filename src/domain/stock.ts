import { createHash } from "node:crypto";
import {
    effectiveFoodsByIds,
    familyOf,
    findFoodById,
    foodsByIds,
    FoodsInputError,
    markUsualRestocked,
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
import {
    onGroceryList,
    type GroceryLine,
    type GroceryListStore,
} from "./grocery.js";
import {
    canonicalUnitText,
    convertQuantity,
    dimensionOf,
    isQuantityUnit,
    type Quantity,
    type QuantityUnit,
} from "./quantity.js";
import {
    RecipeInputError,
    type Recipe,
    type RecipeIngredient,
    type RecipesStore,
} from "./recipes.js";
import { NOTICE_SEVERITY, type Notice } from "./notices.js";
import {
    assertRecipeVerified,
    RecipeUnverifiedError,
} from "./recipe-import.js";
import { isCalendarDate } from "./insights.js";

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
        since?: string,
    ): Promise<StockMovement[]>;
    /** Whether the household's ledger holds a movement with this id. */
    hasMovement(householdId: string, id: string): Promise<boolean>;
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
    /** Names each movement row this call records; random ids by default. */
    newMovementId?: () => string;
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
            // The id is the primary key, as in the table.
            if (movements.some((m) => m.id === row.id)) {
                throw new Error(`stock movement ${row.id} already exists`);
            }
            const saved = { ...row };
            movements.push(saved);
            return { ...saved };
        },
        async hasMovement(householdId, id) {
            return movements.some(
                (m) => m.householdId === householdId && m.id === id,
            );
        },
        async linkMeal(householdId, movementId, mealId) {
            const row = movements.find(
                (m) => m.id === movementId && m.householdId === householdId,
            );
            if (row) row.mealId = mealId;
        },
        async listMovements(householdId, foodId, since) {
            // Compare instants, not strings: "…+00:00" and "…Z" spell the
            // same time but do not sort alike.
            const sinceMs = since == null ? null : Date.parse(since);
            return movements
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        (foodId == null || row.foodId === foodId) &&
                        (sinceMs == null ||
                            Date.parse(row.createdAt) >= sinceMs),
                )
                .map((row) => ({ ...row }))
                .sort((a, b) => {
                    const diff =
                        Date.parse(b.createdAt) - Date.parse(a.createdAt);
                    if (diff !== 0) return diff;
                    return b.id.localeCompare(a.id);
                });
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

export type FamilyFoodRow = Pick<Food, "id" | "genericFoodId">;

/** Same family match {@link planDecrement} uses when choosing fridge rows to deduct. */
export function fridgeItemMatchesFood(
    itemFoodId: string | null | undefined,
    needFoodId: string,
    familyFoodMap: ReadonlyMap<string, FamilyFoodRow>,
): boolean {
    if (!itemFoodId) return false;
    const needRow = familyFoodMap.get(needFoodId);
    const needFamily = needRow ? familyOf(needRow) : needFoodId;
    const row = familyFoodMap.get(itemFoodId);
    if (!row) return itemFoodId === needFoodId;
    return familyOf(row) === needFamily;
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
        quantity: { amount, unit: canonicalUnitText(input.unit) },
        foodId: food.id,
        purchasedOn:
            input.purchasedOn ??
            (input.reason === "purchase" ? todayIsoDate(now) : null),
        openedOn: input.openedOn ?? null,
        expiresOn: input.expiresOn ?? null,
    });
    return { item, applied: amount, unit: input.unit };
}

/** One fridge item a decrement draws from, with what it holds before and after. */
export type DecrementStep = {
    item: FridgeItem;
    /** Amounts in the item's own unit; `amountAfter` is 0 when the item goes. */
    amountBefore: number;
    amountAfter: number;
    remove: boolean;
    /**
     * False when rounding the leftover back into the item's unit landed on the
     * amount it already had: nothing left the shelf, so nothing counts as taken.
     */
    counted: boolean;
    /** The ledger line this step writes; null when it writes none. */
    ledger: DecrementLedgerLine | null;
};

/** Where a decrement draws from. Pure: nothing is written to build it. */
export type DecrementPlan = {
    steps: DecrementStep[];
    applied: number;
    unit: string;
    shortfall: number;
    /** An item held stock but its unit has no known conversion to the need's. */
    skippedForUnits: boolean;
    /** Id of the item left behind by the last step, null when it was removed. */
    lastItemId: string | null;
    useSingleMovementForm: boolean;
};

/**
 * Decide which items a negative movement draws from, oldest expiry first and
 * never below zero. Reads only what it is handed, so a caller can plan against
 * a snapshot (or a copy it keeps updating) without touching the fridge.
 */
export function planDecrement(
    items: readonly FridgeItem[],
    familyFoodMap: ReadonlyMap<string, Food>,
    needFood: Food,
    effectiveNeed: FoodQuantityFactors,
    input: {
        foodId: string;
        delta: number;
        unit: string;
        fridgeItemId?: string | null;
    },
): DecrementPlan {
    const need = roundAmount(Math.abs(input.delta));
    if (!(need > 0)) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
    const unit = canonicalUnitText(input.unit);
    const rawNeedFactors: FoodQuantityFactors = {
        gramsPerEach: needFood.gramsPerEach ?? null,
        gramsPerMl: needFood.gramsPerMl ?? null,
    };
    let useSingleMovementForm = true;
    const pool = (
        input.fridgeItemId
            ? items.filter((item) => item.id === input.fridgeItemId)
            : items.filter((item) =>
                  fridgeItemMatchesFood(
                      item.foodId,
                      input.foodId,
                      familyFoodMap,
                  ),
              )
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
    let lastItemId: string | null = null;
    let skippedForUnits = false;
    const steps: DecrementStep[] = [];
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
        if (haveInNeed == null) skippedForUnits = true;
        if (haveInNeed == null || haveInNeed <= 0) continue;
        const take = Math.min(haveInNeed, remaining);
        const leaveInNeed = roundAmount(haveInNeed - take);
        const amountBefore = item.quantity.amount;
        let amountAfter = 0;
        let remove = true;
        if (leaveInNeed > 0) {
            const leaveInItem = convertStockAmount(
                leaveInNeed,
                unit,
                item.quantity.unit,
                factors,
            );
            if (leaveInItem != null && leaveInItem > 0) {
                amountAfter = leaveInItem;
                remove = false;
            }
        }
        lastItemId = remove ? null : item.id;
        const counted = remove || amountAfter !== amountBefore;
        let ledger: DecrementLedgerLine | null = null;
        if (counted && item.foodId) {
            const line = ledgerLineFor(
                item,
                rowFood,
                amountBefore,
                amountAfter,
            );
            if (line.delta !== 0) {
                ledger = {
                    ...line,
                    foodId: item.foodId,
                    fridgeItemId: remove ? null : item.id,
                };
            }
        }
        steps.push({
            item,
            amountBefore,
            amountAfter,
            remove,
            counted,
            ledger,
        });
        if (counted) remaining = roundAmount(remaining - take);
    }
    return {
        steps,
        applied: roundAmount(need - Math.max(remaining, 0)),
        unit,
        shortfall: remaining > 0 ? remaining : 0,
        skippedForUnits,
        lastItemId,
        useSingleMovementForm,
    };
}

/** The ledger rows a decrement plan writes, in order: one per touched item,
 * or a single row in the food's own terms when every item matched it exactly. */
export type PlannedMovement = {
    foodId: string;
    fridgeItemId: string | null;
    delta: number;
    unit: string;
};

export function plannedDecrementMovements(
    plan: DecrementPlan,
    food: Pick<Food, "id">,
    fridgeItemId: string | null | undefined,
): PlannedMovement[] {
    if (plan.applied === 0) {
        return [
            {
                foodId: food.id,
                fridgeItemId: fridgeItemId ?? null,
                delta: 0,
                unit: plan.unit,
            },
        ];
    }
    if (plan.useSingleMovementForm) {
        return [
            {
                foodId: food.id,
                fridgeItemId: plan.lastItemId,
                delta: -plan.applied,
                unit: plan.unit,
            },
        ];
    }
    return plan.steps.flatMap((step) =>
        step.ledger
            ? [
                  {
                      foodId: step.ledger.foodId,
                      fridgeItemId: step.ledger.fridgeItemId,
                      delta: step.ledger.delta,
                      unit: step.ledger.unit,
                  },
              ]
            : [],
    );
}

/**
 * Write a plan to the fridge. A store can answer that an item vanished under
 * it; the returned plan then records no item id for that step, so the ledger
 * never names an item that is not there.
 */
async function applyDecrementPlan(
    fridge: FridgeStore,
    householdId: string,
    plan: DecrementPlan,
): Promise<{ plan: DecrementPlan; lastItem: FridgeItem | null }> {
    let lastItem: FridgeItem | null = null;
    const steps: DecrementStep[] = [];
    for (const step of plan.steps) {
        if (step.remove) {
            await fridge.deleteItem(householdId, step.item.id);
            lastItem = null;
            steps.push(step);
            continue;
        }
        const updated = await fridge.updateItem({
            ...step.item,
            ...datesOf(step.item),
            quantity: {
                amount: step.amountAfter,
                unit: step.item.quantity.unit,
            },
        });
        lastItem = updated;
        steps.push(
            updated || !step.ledger
                ? step
                : { ...step, ledger: { ...step.ledger, fridgeItemId: null } },
        );
    }
    return {
        plan: { ...plan, steps, lastItemId: lastItem?.id ?? null },
        lastItem,
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
    const unit = canonicalUnitText(input.unit);
    if (!unit) throw new StockInputError("Enter a unit.");
    let food: Food;
    try {
        food = await findFoodById(foods, input.householdId, input.foodId);
    } catch (err) {
        wrapFoodsError(err);
    }
    const now = input.now ?? new Date();
    const signed = input.delta;
    const newId = input.newMovementId ?? (() => crypto.randomUUID());
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
            id: newId(),
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
    const items = await fridge.listItems(input.householdId);
    const familyFoodMap = await loadFamilyFoodMap(
        foods,
        input.householdId,
        items.map((item) => item.foodId).filter(Boolean) as string[],
        input.foodId,
    );
    const planned = planDecrement(items, familyFoodMap, food, effectiveNeed, {
        ...input,
        unit,
    });
    const { plan, lastItem } = await applyDecrementPlan(
        fridge,
        input.householdId,
        planned,
    );
    const rows = plannedDecrementMovements(plan, food, input.fridgeItemId);
    if (plan.applied === 0) {
        const movement = await stock.insertMovement({
            id: newId(),
            ...rows[0]!,
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
    for (const row of rows) {
        movements.push(
            await stock.insertMovement({
                id: newId(),
                ...row,
                ...movementBase,
            }),
        );
    }
    const movement = movements[movements.length - 1]!;
    const shortfallAmount = plan.shortfall;
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
        item: lastItem,
    };
}

export type ExpiryLevel = "expired" | "high" | "medium" | "low";

/** UTC calendar date; production expiry/notice "today" uses `householdToday` / `householdTodayAt`. */
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
export function daysUntilExpiry(today: string, expiresOn: string): number {
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
    today: string,
    days = 3,
): FridgeItem[] {
    const [y, m, d] = today.split("-").map(Number);
    const latest = new Date(Date.UTC(y!, m! - 1, d! + days))
        .toISOString()
        .slice(0, 10);
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
        "id" | "kind" | "foodId" | "displayName" | "quantity" | "expiresOn"
    >[],
    today: string,
    grocery?: {
        lines: readonly Pick<GroceryLine, "foodId" | "checked">[];
        foodsById: ReadonlyMap<string, Pick<Food, "id" | "genericFoodId">>;
    },
): Notice[] {
    const out: Notice[] = [];
    for (const item of items) {
        const level = expiryLevel(item.expiresOn, today);
        if (level == null) continue;
        const expiresOn = item.expiresOn ?? "";
        const baseParams: Record<string, string | number | string[]> = {
            name: item.displayName,
            amount: item.quantity.amount,
            unit: item.quantity.unit,
            expiresOn,
            level,
        };
        if (grocery && item.kind === "food" && item.foodId != null) {
            const listed = onGroceryList(
                item,
                grocery.lines,
                grocery.foodsById,
            );
            baseParams.onGroceryList = listed ? "yes" : "no";
            if (level !== "expired") {
                baseParams.daysLeft = daysUntilExpiry(today, expiresOn);
            }
        }
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
        /** Per-line location and expiry; each field falls back to the shared input. */
        perLine?: Record<
            string,
            { locationId?: string | null; expiresOn?: string | null }
        >;
        /**
         * The household-local day (`YYYY-MM-DD`). When given, each food put
         * away stamps its usual's last restocked day.
         */
        restockedOn?: string;
    },
): Promise<PutAwayResult[]> {
    const lines = await grocery.listLines(input.householdId);
    // A line is put away once per call, however often its id is repeated.
    const selected = [...new Set(input.lineIds)].map((lineId) => {
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
    const locations = await fridge.listLocations(input.householdId);
    const locationIds = new Set(locations.map((loc) => loc.id));

    type ResolvedPutAway = {
        line: GroceryLine;
        chosenId: string;
        locationId: string;
        expiresOn: string | null | undefined;
        delta: number;
        unit: string;
    };
    const resolved: ResolvedPutAway[] = [];

    for (const { line, chosenId } of plans) {
        const override = input.amountOverrides?.[line.id];
        if (line.note?.trim() && override == null) {
            throw new NotedGroceryLineAmountRequiredError(line.displayName);
        }
        if (override) {
            if (!Number.isFinite(override.amount)) {
                throw new StockInputError(
                    `Enter an amount greater than zero for ${line.displayName}.`,
                );
            }
            const effectiveOverride = roundAmount(override.amount);
            if (!(effectiveOverride > 0)) {
                throw new StockInputError(
                    `Enter an amount greater than zero for ${line.displayName}.`,
                );
            }
        }

        const lineOpts = input.perLine?.[line.id];
        const explicitLoc =
            lineOpts?.locationId != null && lineOpts.locationId !== ""
                ? lineOpts.locationId
                : input.locationId != null && input.locationId !== ""
                  ? input.locationId
                  : null;
        let locationId = explicitLoc;
        if (!locationId) {
            locationId =
                recentLocationForFood(fridgeItems, chosenId) ??
                recentLocationForFood(fridgeItems, line.foodId!) ??
                (await lastUsedLocationId(fridge, input.householdId, chosenId));
        }
        if (!locationId) {
            throw new StockInputError("Add a fridge location first.");
        }
        if (!locationIds.has(locationId)) {
            throw new FridgeInputError("Unknown location.");
        }

        const rawExpiry =
            lineOpts?.expiresOn !== undefined
                ? lineOpts.expiresOn
                : input.expiresOn;
        const expiresOn =
            rawExpiry === undefined
                ? undefined
                : rawExpiry === null || rawExpiry === ""
                  ? null
                  : rawExpiry;
        if (
            expiresOn != null &&
            expiresOn !== "" &&
            !isCalendarDate(expiresOn)
        ) {
            throw new StockInputError(
                `Enter a valid expiry date for ${line.displayName}.`,
            );
        }

        const delta = override?.amount ?? line.quantity.amount;
        const unit =
            override?.unit != null && override.unit !== ""
                ? override.unit
                : line.quantity.unit;

        resolved.push({
            line,
            chosenId,
            locationId,
            expiresOn,
            delta,
            unit,
        });
    }

    for (const row of resolved) {
        const effectiveAmount = roundAmount(row.delta);
        if (!(effectiveAmount > 0)) {
            throw new StockInputError(
                `Enter an amount greater than zero for ${row.line.displayName}.`,
            );
        }
    }

    const results: PutAwayResult[] = [];
    for (const row of resolved) {
        const applied = await applyMovement(fridge, stock, foods, {
            householdId: input.householdId,
            foodId: row.chosenId,
            delta: row.delta,
            unit: row.unit,
            reason: "purchase",
            locationId: row.locationId,
            groceryLineId: row.line.id,
            actorUserId: input.actorUserId,
            expiresOn: row.expiresOn,
        });
        await grocery.deleteLine(input.householdId, row.line.id);
        if (input.restockedOn) {
            // The put-away is saved; a failed stamp only delays the next schedule.
            try {
                await markUsualRestocked(
                    foods,
                    input.householdId,
                    row.chosenId,
                    input.restockedOn,
                );
            } catch (err) {
                console.error(
                    `[restock] stamp failed: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        results.push({
            line: row.line,
            movement: applied.movement,
            item: applied.item,
            productFoodId: row.chosenId,
        });
    }
    return results;
}

export type CookRecipeResult = {
    totalPortions: number;
    shortfalls: StockShortfall[];
    unmeasured: { foodId: string | null; displayName: string }[];
    /** Set when `submitKey` named a cook that already ran: nothing was taken. */
    alreadyCooked?: true;
};

/**
 * The id of the `ordinal`-th ledger row a cook records under `submitKey`.
 * The same submit names the same rows, so a repeat collides on the ledger's
 * primary key instead of taking the ingredients a second time.
 */
export function cookMovementId(
    householdId: string,
    recipeId: string,
    submitKey: string,
    ordinal: number,
): string {
    const hex = createHash("sha256")
        .update(`cook\0${householdId}\0${recipeId}\0${submitKey}\0${ordinal}`)
        .digest("hex");
    // Shaped like a version-5 uuid so it passes for one anywhere that checks.
    const variant = ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
        .toString(16)
        .padStart(2, "0");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

/** The row whose presence says the cook under `submitKey` has already run. */
export function cookClaimId(
    householdId: string,
    recipeId: string,
    submitKey: string,
): string {
    return cookMovementId(householdId, recipeId, submitKey, 0);
}

/** What one ingredient asks of the fridge when a recipe is cooked. */
export type CookStep =
    | { kind: "unlinked"; shortfall: StockShortfall }
    | {
          kind: "draw";
          displayName: string;
          foodId: string;
          need: number;
          unit: string;
      };

/**
 * Turn a recipe's ingredients into what cooking it asks of the fridge, scaled
 * to `totalPortions`. The one place that decides which ingredients draw stock,
 * which are unmeasured and which have no food to draw from, so the real cook
 * and its preview cannot disagree about them.
 */
export function planCookSteps(
    ingredients: readonly Pick<
        RecipeIngredient,
        "displayName" | "foodId" | "quantity"
    >[],
    yieldPortions: number,
    totalPortions: number,
    deductStock = true,
): { steps: CookStep[]; unmeasured: CookRecipeResult["unmeasured"] } {
    const steps: CookStep[] = [];
    const unmeasured: CookRecipeResult["unmeasured"] = [];
    const scale = totalPortions / yieldPortions;
    for (const ingredient of ingredients) {
        if (ingredient.quantity == null) {
            unmeasured.push({
                foodId: ingredient.foodId,
                displayName: ingredient.displayName,
            });
            continue;
        }
        if (!deductStock) continue;
        const need = roundAmount(ingredient.quantity.amount * scale);
        if (!ingredient.foodId) {
            steps.push({
                kind: "unlinked",
                shortfall: {
                    foodId: "",
                    displayName: ingredient.displayName,
                    amount: need,
                    unit: ingredient.quantity.unit,
                },
            });
            continue;
        }
        if (!(need > 0)) continue;
        steps.push({
            kind: "draw",
            displayName: ingredient.displayName,
            foodId: ingredient.foodId,
            need,
            unit: ingredient.quantity.unit,
        });
    }
    return { steps, unmeasured };
}

async function loadCookableRecipe(
    recipes: RecipesStore,
    input: { householdId: string; recipeId: string; totalPortions: number },
): Promise<{ recipe: Recipe; ingredients: RecipeIngredient[] }> {
    const recipe = await recipes.getRecipe(input.householdId, input.recipeId);
    if (!recipe) throw new StockInputError("Unknown recipe.");
    if (recipe.verification === "unverified") {
        await assertRecipeVerified(recipes, input.householdId, input.recipeId);
    }
    if (!Number.isFinite(input.totalPortions) || input.totalPortions <= 0) {
        throw new StockInputError("Enter portions greater than zero.");
    }
    const ingredients = await recipes.listIngredients(
        input.householdId,
        recipe.id,
    );
    return { recipe, ingredients };
}

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
        /**
         * One submit of the cook sheet. A second cook under the same key takes
         * nothing and answers `alreadyCooked`: the key names the ledger rows
         * (see {@link cookMovementId}), so it holds across requests and
         * restarts. Run the cook in one transaction so that two submits in
         * flight at once cannot both take the ingredients.
         */
        submitKey?: string | null;
    },
): Promise<CookRecipeResult> {
    const { recipe, ingredients } = await loadCookableRecipe(recipes, input);
    const totalPortions = input.totalPortions;
    const { steps, unmeasured } = planCookSteps(
        ingredients,
        recipe.yieldPortions,
        totalPortions,
        input.deductStock !== false,
    );
    // Every drawn food must resolve before the first write, so a cook with an
    // unknown or archived ingredient fails whole instead of half-applying.
    for (const step of steps) {
        if (step.kind !== "draw") continue;
        try {
            await findFoodById(foods, input.householdId, step.foodId);
        } catch (err) {
            wrapFoodsError(err);
        }
    }
    const submitKey = input.submitKey || null;
    if (
        submitKey &&
        (await stock.hasMovement(
            input.householdId,
            cookClaimId(input.householdId, recipe.id, submitKey),
        ))
    ) {
        return {
            totalPortions,
            shortfalls: [],
            unmeasured,
            alreadyCooked: true,
        };
    }
    let ordinal = 0;
    const newMovementId = submitKey
        ? () =>
              cookMovementId(input.householdId, recipe.id, submitKey, ordinal++)
        : undefined;
    const shortfalls: StockShortfall[] = [];
    for (const step of steps) {
        if (step.kind === "unlinked") {
            shortfalls.push(step.shortfall);
            continue;
        }
        const applied = await applyMovement(fridge, stock, foods, {
            householdId: input.householdId,
            foodId: step.foodId,
            delta: -step.need,
            unit: step.unit,
            reason: "cook",
            recipeId: recipe.id,
            actorUserId: input.actorUserId,
            newMovementId,
        });
        if (applied.shortfall) shortfalls.push(applied.shortfall);
    }
    return { totalPortions, shortfalls, unmeasured };
}

/** The fridge and food data a cook preview plans against. */
export type CookStock = {
    items: readonly FridgeItem[];
    /** Every food an item or an ingredient names, by id. */
    foods: ReadonlyMap<string, Food>;
    /** Quantity factors with a usual product's overrides applied, by food id. */
    effective: ReadonlyMap<string, FoodQuantityFactors>;
};

export type CookPreviewLine = {
    /** The food of the fridge item the amount leaves. */
    foodId: string;
    displayName: string;
    fromItemId: string;
    unit: string;
    before: number;
    /** 0 when the item is used up. */
    after: number;
};

export type CookPreviewShortfall = StockShortfall & {
    /** Some stock of this food could not be counted: its unit has no known
     * conversion to the recipe's, so the real shortfall may be smaller. */
    unknownFactor: boolean;
};

export type CookPreview = {
    totalPortions: number;
    lines: CookPreviewLine[];
    /** The ledger rows a real cook records, in order. */
    movements: PlannedMovement[];
    shortfalls: CookPreviewShortfall[];
    unmeasured: CookRecipeResult["unmeasured"];
};

/**
 * Dry run of {@link cookRecipe}: what leaves the fridge for `servings` portions,
 * item by item, without writing. Plans each ingredient with the same
 * {@link planCookSteps} and {@link planDecrement} the real cook runs, against a
 * copy of the stock that earlier ingredients have already drawn down. Plain
 * data in and out, so a widget can render it as is.
 */
export function cookPreview(
    recipe: {
        yieldPortions: number;
        ingredients: readonly Pick<
            RecipeIngredient,
            "displayName" | "foodId" | "quantity"
        >[];
    },
    servings: number,
    stock: CookStock,
): CookPreview {
    if (!Number.isFinite(servings) || servings <= 0) {
        throw new StockInputError("Enter portions greater than zero.");
    }
    const { steps, unmeasured } = planCookSteps(
        recipe.ingredients,
        recipe.yieldPortions,
        servings,
    );
    let items = stock.items.slice();
    const lines: CookPreviewLine[] = [];
    const movements: PlannedMovement[] = [];
    const shortfalls: CookPreviewShortfall[] = [];
    for (const step of steps) {
        if (step.kind === "unlinked") {
            shortfalls.push({ ...step.shortfall, unknownFactor: false });
            continue;
        }
        const food = stock.foods.get(step.foodId);
        if (!food || food.archivedAt) {
            throw new StockInputError("Unknown food.");
        }
        const plan = planDecrement(
            items,
            stock.foods,
            food,
            stock.effective.get(step.foodId) ?? food,
            { foodId: step.foodId, delta: -step.need, unit: step.unit },
        );
        movements.push(...plannedDecrementMovements(plan, food, null));
        const byId = new Map(plan.steps.map((entry) => [entry.item.id, entry]));
        for (const entry of plan.steps) {
            if (!entry.counted) continue;
            lines.push({
                foodId: entry.item.foodId ?? step.foodId,
                displayName: entry.item.displayName,
                fromItemId: entry.item.id,
                unit: entry.item.quantity.unit,
                before: entry.amountBefore,
                after: entry.amountAfter,
            });
        }
        items = items.flatMap((item) => {
            const entry = byId.get(item.id);
            if (!entry) return [item];
            if (entry.remove) return [];
            return [
                {
                    ...item,
                    quantity: {
                        amount: entry.amountAfter,
                        unit: item.quantity.unit,
                    },
                },
            ];
        });
        if (plan.shortfall > 0) {
            shortfalls.push({
                foodId: food.id,
                displayName: food.name,
                amount: plan.shortfall,
                unit: plan.unit,
                unknownFactor: plan.skippedForUnits,
            });
        }
    }
    return {
        totalPortions: servings,
        lines,
        movements,
        shortfalls,
        unmeasured,
    };
}

/**
 * True for the domain errors that mean a recipe cannot be previewed or cooked
 * as it stands (a bad quantity, an unverified or unlinked ingredient, a
 * missing or archived food). Callers show those as "no preview"; anything
 * else is a real failure and must keep propagating.
 */
export function isCookPreviewUnavailable(err: unknown): err is Error {
    return (
        err instanceof StockInputError ||
        err instanceof RecipeInputError ||
        err instanceof RecipeUnverifiedError ||
        err instanceof FoodsInputError
    );
}

/** Load what {@link cookPreview} needs for a stored recipe and run it. */
export async function previewCookRecipe(
    recipes: RecipesStore,
    fridge: FridgeStore,
    foods: FoodsStore,
    input: { householdId: string; recipeId: string; totalPortions: number },
): Promise<CookPreview> {
    const { recipe, ingredients } = await loadCookableRecipe(recipes, input);
    const items = await fridge.listItems(input.householdId);
    const ids = [
        ...items.map((item) => item.foodId),
        ...ingredients.map((ingredient) => ingredient.foodId),
    ];
    const [catalog, effective] = await Promise.all([
        foodsByIds(foods, input.householdId, ids),
        effectiveFoodsByIds(foods, input.householdId, ids),
    ]);
    return cookPreview(
        { yieldPortions: recipe.yieldPortions, ingredients },
        input.totalPortions,
        { items, foods: catalog, effective },
    );
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
    if (!Number.isFinite(amount) || !(roundAmount(amount) > 0)) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
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
    if (!Number.isFinite(amount) || !(roundAmount(amount) > 0)) {
        throw new StockInputError("Enter an amount greater than zero.");
    }
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
