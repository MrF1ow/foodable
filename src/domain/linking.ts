import {
    identityKey,
    type FoodIdentity,
    type SupplyIdentity,
} from "./food-identity.js";
import {
    fromGrams,
    toGrams,
    type FoodQuantityFactors,
} from "./food-quantity.js";
import {
    convertQuantity,
    isQuantityUnit,
    type Quantity,
    type QuantityUnit,
} from "./quantity.js";

export type LinkedQuantity = { amount: number; unit: string };

export type LinkedNeed = {
    identity: FoodIdentity | SupplyIdentity;
    quantity: LinkedQuantity;
    foodId?: string | null;
};

export type AlreadyHaveTag =
    | { cover: "full" }
    | { cover: "partial"; have: LinkedQuantity; need: LinkedQuantity };

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

function convertToUnit(q: LinkedQuantity, to: string): number | null {
    if (q.unit === to) return q.amount;
    if (!isQuantityUnit(q.unit) || !isQuantityUnit(to)) return null;
    try {
        return convertQuantity(
            { amount: q.amount, unit: q.unit } as Quantity,
            to as QuantityUnit,
        ).amount;
    } catch {
        return null;
    }
}

function foodFor(
    need: LinkedNeed,
    foodsById: ReadonlyMap<string, FoodQuantityFactors>,
): FoodQuantityFactors | undefined {
    if (!need.foodId) return undefined;
    return foodsById.get(need.foodId);
}

function amountInUnit(
    q: LinkedQuantity,
    to: string,
    food: FoodQuantityFactors | undefined,
): number | null {
    const sameDimension = convertToUnit(q, to);
    if (sameDimension != null) return sameDimension;
    if (!food) return null;
    const grams = toGrams(q, food);
    if (grams == null) return null;
    return fromGrams(grams, to, food);
}

function sameFood(a: LinkedNeed, b: LinkedNeed): boolean {
    if (a.foodId && b.foodId) return a.foodId === b.foodId;
    if (a.foodId || b.foodId) return false;
    return identityKey(a.identity) === identityKey(b.identity);
}

export function alreadyHaveTag(
    need: LinkedNeed,
    stock: LinkedNeed[],
    foodsById: ReadonlyMap<string, FoodQuantityFactors> = new Map(),
): AlreadyHaveTag | null {
    const matches = stock.filter((row) => sameFood(need, row));
    if (matches.length === 0) return null;
    const targetUnit = need.quantity.unit;
    const food = foodFor(need, foodsById);
    let have = 0;
    let converted = 0;
    for (const row of matches) {
        const amount = amountInUnit(row.quantity, targetUnit, food);
        if (amount == null) continue;
        have += amount;
        converted += 1;
    }
    if (converted === 0) return null;
    have = roundAmount(have);
    const wanted = roundAmount(need.quantity.amount);
    if (have >= wanted) return { cover: "full" };
    if (have <= 0) return null;
    return {
        cover: "partial",
        have: { amount: have, unit: targetUnit },
        need: { amount: roundAmount(wanted - have), unit: targetUnit },
    };
}

export type RecipeGroceryIngredient = {
    identity: FoodIdentity | SupplyIdentity;
    displayName: string;
    quantity: LinkedQuantity;
    foodId?: string | null;
};

export type RecipeGroceryRemainderLine = {
    identity: FoodIdentity | SupplyIdentity;
    displayName: string;
    need: LinkedQuantity;
    remainder: LinkedQuantity | null;
    skipped: boolean;
    tag: AlreadyHaveTag | null;
    foodId?: string | null;
};

export function recipeToGroceryRemainder(input: {
    ingredients: RecipeGroceryIngredient[];
    yieldPortions: number;
    portionCounts: number[];
    /** Overrides the members' sum: the recipe's yield for a whole batch,
     * more for leftovers. */
    totalPortions?: number;
    stock: LinkedNeed[];
    foodsById?: ReadonlyMap<string, FoodQuantityFactors>;
}): RecipeGroceryRemainderLine[] {
    const portionSum =
        input.totalPortions ??
        input.portionCounts.reduce((sum, n) => sum + n, 0);
    const scale = portionSum / input.yieldPortions;
    const foodsById = input.foodsById ?? new Map();
    return input.ingredients.map((ingredient) => {
        const need: LinkedQuantity = {
            amount: roundAmount(ingredient.quantity.amount * scale),
            unit: ingredient.quantity.unit,
        };
        const tag = alreadyHaveTag(
            {
                identity: ingredient.identity,
                quantity: need,
                foodId: ingredient.foodId,
            },
            input.stock,
            foodsById,
        );
        if (need.amount <= 0 || tag?.cover === "full") {
            return {
                identity: ingredient.identity,
                displayName: ingredient.displayName,
                need,
                remainder: null,
                skipped: true,
                tag,
                foodId: ingredient.foodId ?? null,
            };
        }
        if (tag?.cover === "partial") {
            return {
                identity: ingredient.identity,
                displayName: ingredient.displayName,
                need,
                remainder: tag.need,
                skipped: false,
                tag,
                foodId: ingredient.foodId ?? null,
            };
        }
        return {
            identity: ingredient.identity,
            displayName: ingredient.displayName,
            need,
            remainder: need,
            skipped: false,
            tag: null,
            foodId: ingredient.foodId ?? null,
        };
    });
}
