import {
    familyIdOf,
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
    quantity: LinkedQuantity | null;
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

function mergeFactors(
    row: FoodQuantityFactors | undefined,
    need: FoodQuantityFactors | undefined,
): FoodQuantityFactors {
    return {
        gramsPerEach: row?.gramsPerEach ?? need?.gramsPerEach ?? null,
        gramsPerMl: row?.gramsPerMl ?? need?.gramsPerMl ?? null,
    };
}

export function amountInUnit(
    q: LinkedQuantity,
    to: string,
    rowFood: FoodQuantityFactors | undefined,
    needFood: FoodQuantityFactors | undefined,
): number | null {
    const sameDimension = convertToUnit(q, to);
    if (sameDimension != null) return sameDimension;
    const food = mergeFactors(rowFood, needFood);
    const grams = toGrams(q, food);
    if (grams == null) return null;
    return fromGrams(grams, to, needFood);
}

export function sameFood(
    a: LinkedNeed,
    b: LinkedNeed,
    foodsById: ReadonlyMap<
        string,
        { genericFoodId?: string | null }
    > = new Map(),
): boolean {
    if (!a.foodId || !b.foodId) return false;
    return familyIdOf(a.foodId, foodsById) === familyIdOf(b.foodId, foodsById);
}

function unmeasuredAlreadyHave(
    need: LinkedNeed,
    stock: LinkedNeed[],
    foodsById: ReadonlyMap<string, FoodQuantityFactors>,
): AlreadyHaveTag | null {
    const matches = stock.filter((row) => sameFood(need, row, foodsById));
    if (matches.length === 0) return null;
    for (const row of matches) {
        if (!row.quantity || !(row.quantity.amount > 0)) continue;
        return { cover: "full" };
    }
    return null;
}

export function alreadyHaveTag(
    need: LinkedNeed,
    stock: LinkedNeed[],
    foodsById: ReadonlyMap<string, FoodQuantityFactors> = new Map(),
): AlreadyHaveTag | null {
    if (need.quantity == null) {
        return unmeasuredAlreadyHave(need, stock, foodsById);
    }
    const matches = stock.filter((row) => sameFood(need, row, foodsById));
    if (matches.length === 0) return null;
    const targetUnit = need.quantity.unit;
    const needFood = foodFor(need, foodsById);
    let have = 0;
    let converted = 0;
    for (const row of matches) {
        if (!row.quantity) continue;
        const rowFood = row.foodId ? foodsById.get(row.foodId) : undefined;
        const amount = amountInUnit(
            row.quantity,
            targetUnit,
            rowFood,
            needFood,
        );
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
    displayName: string;
    quantity: LinkedQuantity | null;
    foodId?: string | null;
};

export type RecipeGroceryRemainderLine = {
    displayName: string;
    need: LinkedQuantity | null;
    remainder: LinkedQuantity | null;
    skipped: boolean;
    unmeasured: boolean;
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
        if (ingredient.quantity == null) {
            const tag = alreadyHaveTag(
                {
                    quantity: null,
                    foodId: ingredient.foodId,
                },
                input.stock,
                foodsById,
            );
            const skipped = tag?.cover === "full";
            return {
                displayName: ingredient.displayName,
                need: null,
                remainder: null,
                skipped,
                unmeasured: true,
                tag,
                foodId: ingredient.foodId ?? null,
            };
        }
        const need: LinkedQuantity = {
            amount: roundAmount(ingredient.quantity.amount * scale),
            unit: ingredient.quantity.unit,
        };
        const tag = alreadyHaveTag(
            {
                quantity: need,
                foodId: ingredient.foodId,
            },
            input.stock,
            foodsById,
        );
        if (need.amount <= 0 || tag?.cover === "full") {
            return {
                displayName: ingredient.displayName,
                need,
                remainder: null,
                skipped: true,
                unmeasured: false,
                tag,
                foodId: ingredient.foodId ?? null,
            };
        }
        if (tag?.cover === "partial") {
            return {
                displayName: ingredient.displayName,
                need,
                remainder: tag.need,
                skipped: false,
                unmeasured: false,
                tag,
                foodId: ingredient.foodId ?? null,
            };
        }
        return {
            displayName: ingredient.displayName,
            need,
            remainder: need,
            skipped: false,
            unmeasured: false,
            tag: null,
            foodId: ingredient.foodId ?? null,
        };
    });
}
