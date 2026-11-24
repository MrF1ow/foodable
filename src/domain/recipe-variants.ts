// A person's own version of a recipe. The recipe keeps one base; each member
// may override single ingredients of it, and their version is the base with
// those rows applied. Nothing here copies the base: a base edit reaches every
// version except at an ingredient that version overrides.
//
// Pure functions plus a store seam (types, an in-memory twin of the Postgres
// adapter in `db/recipes.ts`, row mappers). Cook, the grocery list, the week
// plan and logged meals call `recipeNeeds` and `variantFor` instead of reading
// the base ingredients directly.

import { familyIdOf, type FoodQuantityFactors } from "./food-quantity.js";
import { findFoodById, FoodsInputError, type FoodsStore } from "./foods.js";
import { amountInUnit } from "./linking.js";
import {
    canonicalFactor,
    canonicalUnitText,
    dimensionOf,
    isQuantityUnit,
} from "./quantity.js";
import {
    addRecipeIngredientById,
    assertEditKeepsCheck,
    noteForUnmeasuredIngredient,
    RecipeInputError,
    swapRecipeIngredientFood,
    updateRecipeIngredient,
    type RecipeIngredient,
    type RecipesStore,
} from "./recipes.js";

export const VARIANT_ACTIONS = ["remove", "amount", "food", "add"] as const;
export type VariantAction = (typeof VARIANT_ACTIONS)[number];

/**
 * One change a person makes to the base recipe. `userId` is the member it
 * belongs to, keyed like `recipe_portions.user_id`.
 *
 * - `remove`: the base ingredient is left out.
 * - `amount`: `amount` and `unit` replace the base's; a null amount is "to
 *   taste".
 * - `food`: `foodId` and `displayName` replace the base's food; an `amount`
 *   (with its `unit`) replaces the base amount too. No amount and no unit
 *   keeps the base's; no amount with a unit is the person's "to taste".
 * - `add`: an ingredient only this person has (`ingredientId` null).
 */
export type RecipeVariantOverride = {
    id: string;
    householdId: string;
    recipeId: string;
    userId: string;
    ingredientId: string | null;
    action: VariantAction;
    amount: number | null;
    unit: string | null;
    foodId: string | null;
    displayName: string | null;
    createdAt: string;
    updatedAt: string;
};

export type NewRecipeVariantOverride = {
    id?: string;
    householdId: string;
    recipeId: string;
    userId: string;
    ingredientId: string | null;
    action: VariantAction;
    amount?: number | null;
    unit?: string | null;
    foodId?: string | null;
    displayName?: string | null;
    /**
     * The unit an `amount` row takes when it names none and the person's
     * earlier row for the ingredient has none either: the base ingredient's
     * own. Not stored.
     */
    defaultUnit?: string | null;
};

/**
 * What a store saves for `next` given the person's `earlier` row on the same
 * base ingredient, or throws. Stores call it inside the same lock that reads
 * `earlier`, so two writes to one ingredient cannot lose each other's half:
 *
 * - an `amount` on an ingredient the person swapped keeps the swap (food and
 *   name) and sets the amount (none means "to taste"), and a swap's unit when
 *   none is given;
 * - a `food` with no amount on an ingredient the person already gave an
 *   amount (an `amount` row, or an earlier swap that kept one) keeps that
 *   amount and unit, and keeps "to taste" the same way.
 *
 * Everything else replaces the earlier row, as the one-row-per-ingredient
 * rule says.
 */
export function mergeWithEarlier(
    earlier: RecipeVariantOverride | undefined,
    next: NewRecipeVariantOverride,
): NewRecipeVariantOverride {
    const { defaultUnit, ...row } = next;
    if (row.action === "amount") {
        const amount = row.amount ?? null;
        const swapped = earlier?.action === "food" ? earlier : undefined;
        const unit = row.unit || swapped?.unit || defaultUnit || null;
        if (amount != null && !unit) {
            throw new RecipeInputError("Give a unit with the amount.");
        }
        return swapped
            ? {
                  ...row,
                  action: "food",
                  amount,
                  // No amount on a swap is "to taste": the unit marks it, so
                  // the swap does not read the base's amount.
                  unit: amount == null ? (unit ?? "g") : unit,
                  foodId: swapped.foodId,
                  displayName: swapped.displayName,
              }
            : { ...row, amount, unit: amount == null ? "g" : unit };
    }
    if (
        row.action === "food" &&
        row.amount == null &&
        (earlier?.action === "amount" || earlier?.action === "food")
    ) {
        // The person already said how much: a measure, or "to taste". A swap
        // with no amount of its own keeps that, whichever row said it.
        if (earlier.amount != null) {
            return { ...row, amount: earlier.amount, unit: earlier.unit };
        }
        if (earlier.action === "amount" || earlier.unit != null) {
            return { ...row, amount: null, unit: earlier.unit ?? "g" };
        }
    }
    return row;
}

/**
 * Two added rows of one person's for what is now one food: what the row that
 * stays carries. The amounts add when they convert (40 g and 0.06 kg are 100
 * g); otherwise the kept food's row stands as it is.
 */
export function foldAddedAmounts(
    kept: { amount: number | null; unit: string | null },
    dropped: { amount: number | null; unit: string | null },
): { amount: number | null; unit: string | null } {
    if (
        kept.amount == null ||
        kept.unit == null ||
        dropped.amount == null ||
        dropped.unit == null
    ) {
        return { amount: kept.amount, unit: kept.unit };
    }
    const extra = amountInUnit(
        { amount: dropped.amount, unit: dropped.unit },
        kept.unit,
        undefined,
        undefined,
    );
    return extra == null
        ? { amount: kept.amount, unit: kept.unit }
        : {
              amount: Math.round((kept.amount + extra) * 1e6) / 1e6,
              unit: kept.unit,
          };
}

/** Every method is scoped to one household: an id from another names nothing. */
export type RecipeVariantsStore = {
    /** Every override of the recipe, every member's, oldest first. */
    listOverrides(
        householdId: string,
        recipeId: string,
    ): Promise<RecipeVariantOverride[]>;
    /** The overrides of several recipes at once, every member's, oldest first. */
    listOverridesForRecipes(
        householdId: string,
        recipeIds: readonly string[],
    ): Promise<RecipeVariantOverride[]>;
    /** The overrides that name `foodId` (a swapped or added food), every member's. */
    listOverridesByFood(
        householdId: string,
        foodId: string,
    ): Promise<RecipeVariantOverride[]>;
    /**
     * Saves one override. A row that names a base ingredient replaces the
     * person's earlier row for it (one per person and ingredient); an `add`
     * replaces the person's earlier add of the same food (one per person,
     * recipe and added food), so saving it again changes nothing.
     */
    saveOverride(row: NewRecipeVariantOverride): Promise<RecipeVariantOverride>;
    /**
     * Takes back one override: its own id, or the base ingredient it is on.
     * False when the person has none like that.
     */
    deleteOverride(
        householdId: string,
        recipeId: string,
        userId: string,
        ref: string,
    ): Promise<boolean>;
    /**
     * Takes back one row, by id, only while it still says what `row` says (its
     * action, amount, unit, food and name). False when it is gone or has been
     * saved differently since `row` was read, and then nothing is deleted.
     */
    deleteOverrideIfUnchanged(
        householdId: string,
        row: RecipeVariantOverride,
    ): Promise<boolean>;
    /** Takes back the person's whole version of the recipe; how many rows went. */
    clearVariant(
        householdId: string,
        recipeId: string,
        userId: string,
    ): Promise<number>;
    /**
     * Holds the recipe's versions still until the surrounding transaction
     * ends: an align of the recipe waits for it, and it waits for one in
     * flight. A caller that records rows before deleting them takes it first,
     * so what it recorded is what it deletes. Does nothing outside a
     * transaction, and in the in-memory twin.
     */
    lockVersions(recipeId: string): Promise<void>;
    /**
     * Locks a base ingredient's row until the surrounding transaction ends,
     * before any override row is touched: removing the ingredient or the
     * recipe locks the ingredient and then cascades to its overrides, so an
     * align that went the other way round could deadlock with it. False when
     * the ingredient is gone.
     */
    lockBaseIngredient(
        householdId: string,
        ingredientId: string,
    ): Promise<boolean>;
};

export function createMemoryVariantsStore(): RecipeVariantsStore & {
    /** Test seam: every row held. */
    __rows(): RecipeVariantOverride[];
    /**
     * What a food merge does to the rows (`FoodsStore.linkRefs`): the dropped
     * food's rows name the kept one, and where one person added both foods to
     * a recipe the two rows become one.
     */
    repointFood(householdId: string, fromId: string, toId: string): void;
} {
    const rows: RecipeVariantOverride[] = [];
    let tick = 0;
    const stamp = () =>
        new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
    const clone = (row: RecipeVariantOverride): RecipeVariantOverride => ({
        ...row,
    });
    return {
        __rows: () => rows.map(clone),
        repointFood(householdId, fromId, toId) {
            for (const row of [...rows]) {
                if (row.householdId !== householdId || row.foodId !== fromId) {
                    continue;
                }
                const twin =
                    row.action === "add"
                        ? rows.find(
                              (other) =>
                                  other.recipeId === row.recipeId &&
                                  other.userId === row.userId &&
                                  other.action === "add" &&
                                  other.foodId === toId,
                          )
                        : undefined;
                if (twin) {
                    Object.assign(twin, foldAddedAmounts(twin, row));
                    rows.splice(rows.indexOf(row), 1);
                } else {
                    row.foodId = toId;
                }
            }
        },
        async listOverrides(householdId, recipeId) {
            return rows
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.recipeId === recipeId,
                )
                .map(clone);
        },
        async listOverridesForRecipes(householdId, recipeIds) {
            const wanted = new Set(recipeIds);
            return rows
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        wanted.has(row.recipeId),
                )
                .map(clone);
        },
        async listOverridesByFood(householdId, foodId) {
            return rows
                .filter(
                    (row) =>
                        row.householdId === householdId &&
                        row.foodId === foodId,
                )
                .map(clone);
        },
        async saveOverride(given) {
            const now = stamp();
            const earlier =
                given.ingredientId == null
                    ? undefined
                    : rows.find(
                          (row) =>
                              row.recipeId === given.recipeId &&
                              row.userId === given.userId &&
                              row.ingredientId === given.ingredientId,
                      );
            const input = mergeWithEarlier(earlier, given);
            const existing =
                input.ingredientId == null
                    ? input.action === "add" && input.foodId
                        ? rows.find(
                              (row) =>
                                  row.recipeId === input.recipeId &&
                                  row.userId === input.userId &&
                                  row.action === "add" &&
                                  row.foodId === input.foodId,
                          )
                        : undefined
                    : earlier;
            const saved: RecipeVariantOverride = {
                id: existing?.id ?? input.id ?? crypto.randomUUID(),
                householdId: input.householdId,
                recipeId: input.recipeId,
                userId: input.userId,
                ingredientId: input.ingredientId,
                action: input.action,
                amount: input.amount ?? null,
                unit: input.unit ?? null,
                foodId: input.foodId ?? null,
                displayName: input.displayName ?? null,
                createdAt: existing?.createdAt ?? now,
                updatedAt: now,
            };
            if (existing) rows[rows.indexOf(existing)] = saved;
            else rows.push(saved);
            return clone(saved);
        },
        async deleteOverride(householdId, recipeId, userId, ref) {
            const at = rows.findIndex(
                (row) =>
                    row.householdId === householdId &&
                    row.recipeId === recipeId &&
                    row.userId === userId &&
                    (row.id === ref || row.ingredientId === ref),
            );
            if (at < 0) return false;
            rows.splice(at, 1);
            return true;
        },
        async deleteOverrideIfUnchanged(householdId, given) {
            const at = rows.findIndex(
                (row) =>
                    row.householdId === householdId &&
                    row.recipeId === given.recipeId &&
                    row.userId === given.userId &&
                    row.id === given.id &&
                    row.action === given.action &&
                    row.amount === given.amount &&
                    row.unit === given.unit &&
                    row.foodId === given.foodId &&
                    row.displayName === given.displayName,
            );
            if (at < 0) return false;
            rows.splice(at, 1);
            return true;
        },
        async lockVersions() {},
        async lockBaseIngredient() {
            return true;
        },
        async clearVariant(householdId, recipeId, userId) {
            let removed = 0;
            for (let i = rows.length - 1; i >= 0; i--) {
                const row = rows[i]!;
                if (
                    row.householdId === householdId &&
                    row.recipeId === recipeId &&
                    row.userId === userId
                ) {
                    rows.splice(i, 1);
                    removed++;
                }
            }
            return removed;
        },
    };
}

export function overrideFromRow(row: {
    id: unknown;
    household_id: unknown;
    recipe_id: unknown;
    user_id: unknown;
    ingredient_id: unknown;
    action: unknown;
    amount: unknown;
    unit: unknown;
    food_id: unknown;
    display_name: unknown;
    created_at: unknown;
    updated_at: unknown;
}): RecipeVariantOverride {
    const iso = (value: unknown) =>
        value instanceof Date ? value.toISOString() : String(value);
    return {
        id: String(row.id),
        householdId: String(row.household_id),
        recipeId: String(row.recipe_id),
        userId: String(row.user_id),
        ingredientId:
            row.ingredient_id == null ? null : String(row.ingredient_id),
        action: String(row.action) as VariantAction,
        amount: row.amount == null ? null : Number(row.amount),
        unit: row.unit == null ? null : String(row.unit),
        foodId: row.food_id == null ? null : String(row.food_id),
        displayName: row.display_name == null ? null : String(row.display_name),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
    };
}

export function overrideToRow(row: NewRecipeVariantOverride) {
    return {
        household_id: row.householdId,
        recipe_id: row.recipeId,
        user_id: row.userId,
        ingredient_id: row.ingredientId,
        action: row.action,
        amount: row.amount ?? null,
        unit: row.unit ?? null,
        food_id: row.foodId ?? null,
        display_name: row.displayName ?? null,
    };
}

/** What one ingredient of a version is, against the base. */
export type VariantChange = "amount" | "food" | "add";

export type VariantIngredient = RecipeIngredient & {
    /** The base ingredient this line comes from; null on an added one. */
    baseIngredientId: string | null;
    /** How the line differs from the base; null when it is the base's own. */
    change: VariantChange | null;
};

/** A member's version of a recipe: the base with their overrides applied. */
export type RecipeVariant = {
    userId: string;
    /** In the base's order, then the added ingredients, oldest first. */
    ingredients: VariantIngredient[];
    /** Base ingredients this version leaves out. */
    removed: RecipeIngredient[];
    /** How many overrides took effect; 0 means the version is the base. */
    overrideCount: number;
};

/**
 * Member ids are uuids, stored lower case; a person typing one may not. They
 * name the same member whatever the case.
 */
export function sameMember(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

function baseLine(ingredient: RecipeIngredient): VariantIngredient {
    return {
        ...ingredient,
        quantity: ingredient.quantity ? { ...ingredient.quantity } : null,
        baseIngredientId: ingredient.id,
        change: null,
    };
}

/**
 * `userId`'s version of the recipe. Only that person's overrides apply, and
 * only those still pointing at a base ingredient the recipe has: when a base
 * ingredient is deleted its overrides go with it (a cascade in the database),
 * and one left behind in memory is ignored here, so a removed ingredient never
 * resurfaces in a version.
 *
 * A base edit flows through: the version reads the base ingredient as it is
 * now, and an override replaces only what it names (an `amount` row the
 * amount and unit, a `food` row the food).
 */
export function variantFor(
    recipe: { id: string; ingredients: readonly RecipeIngredient[] },
    overrides: readonly RecipeVariantOverride[],
    userId: string,
): RecipeVariant {
    const mine = overrides.filter(
        (row) => row.recipeId === recipe.id && sameMember(row.userId, userId),
    );
    const byIngredient = new Map<string, RecipeVariantOverride>();
    const added: RecipeVariantOverride[] = [];
    for (const row of mine) {
        if (row.action === "add" || row.ingredientId == null) {
            if (row.action === "add") added.push(row);
            continue;
        }
        byIngredient.set(row.ingredientId, row);
    }
    const ingredients: VariantIngredient[] = [];
    const removed: RecipeIngredient[] = [];
    let applied = 0;
    for (const base of recipe.ingredients) {
        const row = byIngredient.get(base.id);
        if (!row) {
            ingredients.push(baseLine(base));
            continue;
        }
        applied++;
        if (row.action === "remove") {
            removed.push(base);
            continue;
        }
        if (row.action === "amount") {
            ingredients.push({
                ...baseLine(base),
                quantity:
                    row.amount == null
                        ? null
                        : {
                              amount: row.amount,
                              unit: row.unit ?? base.quantity?.unit ?? "g",
                          },
                change: "amount",
            });
            continue;
        }
        // food
        ingredients.push({
            ...baseLine(base),
            foodId: row.foodId ?? base.foodId,
            displayName: row.displayName ?? base.displayName,
            quantity:
                row.amount == null
                    ? row.unit != null
                        ? null
                        : base.quantity
                          ? { ...base.quantity }
                          : null
                    : {
                          amount: row.amount,
                          unit: row.unit ?? base.quantity?.unit ?? "g",
                      },
            change: "food",
        });
    }
    const sorted = [...added].sort(
        (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    let sortOrder = recipe.ingredients.reduce(
        (max, row) => Math.max(max, row.sortOrder),
        -1,
    );
    for (const row of sorted) {
        applied++;
        sortOrder += 1;
        ingredients.push({
            id: row.id,
            householdId: row.householdId,
            recipeId: row.recipeId,
            kind: "food",
            displayName: row.displayName ?? "",
            quantity:
                row.amount == null
                    ? null
                    : { amount: row.amount, unit: row.unit ?? "g" },
            foodId: row.foodId,
            sortOrder,
            note: null,
            baseIngredientId: null,
            change: "add",
        });
    }
    return { userId, ingredients, removed, overrideCount: applied };
}

/** Who has a version of a recipe, and how far it departs from the base. */
export type VariantCoverage = {
    userId: string;
    overrideCount: number;
    hasVersion: boolean;
};

/**
 * For each of `memberIds` (in that order), whether they have a version of the
 * recipe: at least one override that still applies to it.
 */
export function variantCoverage(
    recipe: { id: string; ingredients: readonly RecipeIngredient[] },
    overrides: readonly RecipeVariantOverride[],
    memberIds: readonly string[],
): VariantCoverage[] {
    return memberIds.map((userId) => {
        const { overrideCount } = variantFor(recipe, overrides, userId);
        return { userId, overrideCount, hasVersion: overrideCount > 0 };
    });
}

/** A member and how many portions of a recipe they eat. */
export type MemberPortion = { userId: string; portions: number };

/**
 * One line of what a cook or a shop needs in all: the amount is the total
 * across every person's version, not per portion.
 */
export type RecipeNeedLine = {
    displayName: string;
    foodId: string | null;
    quantity: { amount: number; unit: string } | null;
};

/**
 * `q` in unit `to`, or null when the two cannot meet. Units of one kind (g and
 * kg) convert exactly, with no rounding to a tenth; units of different kinds
 * (g and ml, each) go through the foods' own factors.
 */
function convertNeed(
    q: { amount: number; unit: string },
    to: string,
    fromFood: FoodQuantityFactors | undefined,
    toFood: FoodQuantityFactors | undefined,
): number | null {
    if (q.unit === to) return q.amount;
    if (
        isQuantityUnit(q.unit) &&
        isQuantityUnit(to) &&
        q.unit !== "each" &&
        to !== "each" &&
        dimensionOf(q.unit) === dimensionOf(to)
    ) {
        return (q.amount * canonicalFactor(q.unit)) / canonicalFactor(to);
    }
    return amountInUnit(q, to, fromFood, toFood);
}

/**
 * What cooking or buying `totalPortions` of a recipe needs when some of the
 * portions are specific people's. Each member's portions use that member's
 * version of the recipe, and the portions nobody is named for (`totalPortions`
 * beyond the members' sum) use the base. The total is never below the
 * members' sum, so a member's portions are never cut.
 *
 * Lines are in the base's order (a swapped food stays at its place), added
 * ingredients after. An ingredient two people want in the same unit is one
 * line; in different units, one line each; the same food added by two
 * people in the same unit is one line. An unmeasured ingredient ("to taste")
 * is one line with no quantity, unless some version measures it.
 */
export function recipeNeeds(input: {
    ingredients: readonly RecipeIngredient[];
    yieldPortions: number;
    overrides: readonly RecipeVariantOverride[];
    members: readonly MemberPortion[];
    totalPortions: number;
    recipeId?: string;
    /**
     * The household's foods, when known: lets two lines of one food in units
     * of different kinds (grams and millilitres) meet through the food's own
     * density. Without it only units of one kind (g and kg) merge.
     */
    foodsById?: ReadonlyMap<string, FoodQuantityFactors>;
}): RecipeNeedLine[] {
    const recipeId = input.recipeId ?? input.ingredients[0]?.recipeId ?? "";
    const memberSum = input.members.reduce((sum, m) => sum + m.portions, 0);
    const basePortions = Math.max(0, input.totalPortions - memberSum);
    const shares: { userId: string | null; portions: number }[] = [];
    if (basePortions > 0) shares.push({ userId: null, portions: basePortions });
    for (const member of input.members) {
        shares.push({ userId: member.userId, portions: member.portions });
    }

    type Line = {
        group: string;
        rank: number;
        displayName: string;
        foodId: string | null;
        unit: string | null;
        amount: number;
        measured: boolean;
    };
    const lines = new Map<string, Line>();
    const order: string[] = [];
    const baseRank = new Map(
        input.ingredients.map((row, index) => [row.id, index]),
    );
    const addRank = input.ingredients.length;
    for (const share of shares) {
        const lineups: VariantIngredient[] =
            share.userId == null
                ? input.ingredients.map(baseLine)
                : variantFor(
                      { id: recipeId, ingredients: input.ingredients },
                      input.overrides,
                      share.userId,
                  ).ingredients;
        for (const line of lineups) {
            const rank =
                line.baseIngredientId == null
                    ? addRank
                    : (baseRank.get(line.baseIngredientId) ?? addRank);
            const unit = line.quantity?.unit ?? null;
            // What the line is (an ingredient of this food), whatever its unit.
            const group =
                line.baseIngredientId == null
                    ? `add:${line.foodId ?? line.displayName}`
                    : `${line.baseIngredientId}\0${line.foodId}`;
            const key = `${group}\0${unit}`;
            let into = lines.get(key);
            if (!into) {
                into = {
                    group,
                    rank,
                    displayName: line.displayName,
                    foodId: line.foodId,
                    unit,
                    amount: 0,
                    measured: line.quantity != null,
                };
                lines.set(key, into);
                order.push(key);
            }
            if (line.quantity != null) {
                into.amount +=
                    line.quantity.amount *
                    (share.portions / input.yieldPortions);
            }
        }
    }
    // An ingredient one person leaves "to taste" and another measures is one
    // measured line: the unmeasured twin of a same-ingredient, same-food line
    // that has an amount adds nothing.
    const measuredGroups = new Set(
        [...lines.values()]
            .filter((line) => line.measured)
            .map((line) => line.group),
    );
    const kept = order
        .map((key, index) => ({ line: lines.get(key)!, index }))
        .filter(({ line }) => line.measured || !measuredGroups.has(line.group))
        .sort((a, b) => a.line.rank - b.line.rank || a.index - b.index)
        .map(({ line }) => line);
    // One food in units that convert is one need, whichever version wrote
    // which unit: 300 g and 0.3 kg of flour are 600 g, netted against the
    // stock once. A unit that cannot be converted (cups of flour with no known
    // density) stays its own line.
    const foodsById = input.foodsById ?? new Map<string, FoodQuantityFactors>();
    const merged: Line[] = [];
    for (const line of kept) {
        if (line.measured && line.unit != null && line.foodId != null) {
            const family = familyIdOf(line.foodId, foodsById);
            const into = merged.find(
                (other) =>
                    other.measured &&
                    other.unit != null &&
                    other.foodId != null &&
                    familyIdOf(other.foodId, foodsById) === family &&
                    convertNeed(
                        { amount: 1, unit: line.unit! },
                        other.unit,
                        foodsById.get(line.foodId!),
                        foodsById.get(other.foodId),
                    ) != null,
            );
            if (into) {
                into.amount += convertNeed(
                    { amount: line.amount, unit: line.unit },
                    into.unit!,
                    foodsById.get(line.foodId),
                    foodsById.get(into.foodId!),
                )!;
                continue;
            }
        }
        merged.push({ ...line });
    }
    return merged.map((line) => ({
        displayName: line.displayName,
        foodId: line.foodId,
        quantity:
            line.measured && line.unit != null
                ? { amount: line.amount, unit: line.unit }
                : null,
    }));
}

export type SetVariantInput = {
    householdId: string;
    recipeId: string;
    userId: string;
    action: VariantAction;
    /** The base ingredient; an `add` row names none, and one already added cannot be replaced. */
    ingredientId?: string | null;
    amount?: number | null;
    unit?: string | null;
    foodId?: string | null;
};

function positive(value: number, label: string): number {
    if (!Number.isFinite(value) || value <= 0) {
        throw new RecipeInputError(`${label} must be greater than zero.`);
    }
    return value;
}

/**
 * Records one change to the person's version of a recipe. The base ingredient
 * must belong to the recipe, a swapped or added food must be in the household's
 * catalog, and an amount must be greater than zero. Setting the same ingredient
 * again replaces the earlier change.
 */
export async function setRecipeVariant(
    recipes: RecipesStore,
    foods: FoodsStore,
    variants: RecipeVariantsStore,
    input: SetVariantInput,
): Promise<RecipeVariantOverride> {
    const recipe = await recipes.getRecipe(input.householdId, input.recipeId);
    if (!recipe) throw new RecipeInputError("Unknown recipe.");
    const base = await recipes.listIngredients(input.householdId, recipe.id);
    const ingredientId = input.ingredientId?.trim() || null;
    let ingredient: RecipeIngredient | undefined;
    if (input.action === "add") {
        if (ingredientId) {
            throw new RecipeInputError(
                "An added ingredient is not on the base recipe: leave out ingredient_id.",
            );
        }
    } else {
        ingredient = base.find((row) => row.id === ingredientId);
        if (!ingredient) {
            throw new RecipeInputError(
                "Unknown ingredient: use the id of one of the recipe's ingredients.",
            );
        }
    }
    const unitText = input.unit == null ? null : canonicalUnitText(input.unit);
    if (input.action === "remove") {
        return variants.saveOverride({
            householdId: input.householdId,
            recipeId: recipe.id,
            userId: input.userId,
            ingredientId,
            action: "remove",
        });
    }
    if (input.action === "amount") {
        // The store merges this with the person's earlier row for the
        // ingredient under its own lock: an amount on a swapped ingredient
        // keeps the swap.
        const amount =
            input.amount == null ? null : positive(input.amount, "Amount");
        return variants.saveOverride({
            householdId: input.householdId,
            recipeId: recipe.id,
            userId: input.userId,
            ingredientId,
            action: "amount",
            amount,
            unit: unitText,
            defaultUnit: ingredient?.quantity?.unit ?? null,
        });
    }
    // food and add: the food comes from the catalog.
    if (!input.foodId) {
        throw new RecipeInputError("Say which food: pass food_id.");
    }
    let food;
    try {
        food = await findFoodById(foods, input.householdId, input.foodId);
    } catch (err) {
        if (err instanceof FoodsInputError) {
            throw new RecipeInputError(err.message);
        }
        throw err;
    }
    if (food.kind !== "food") {
        throw new RecipeInputError("That catalog item is a supply.");
    }
    const amount =
        input.amount == null ? null : positive(input.amount, "Amount");
    // The unit is fixed now: an added ingredient has no base to read one from,
    // and a swap takes the base's unit as it is today, so a later edit of the
    // base's unit does not turn "300 g" into 300 kg.
    const unit =
        amount == null
            ? null
            : unitText ||
              (input.action === "food" ? ingredient?.quantity?.unit : null) ||
              null;
    if (amount != null && !unit) {
        throw new RecipeInputError("Give a unit with the amount.");
    }
    return variants.saveOverride({
        householdId: input.householdId,
        recipeId: recipe.id,
        userId: input.userId,
        ingredientId,
        action: input.action,
        amount,
        unit,
        foodId: food.id,
        displayName: food.name,
    });
}

/**
 * Takes back the person's change to one ingredient (`ingredientId`: the base
 * ingredient, or the id of an added line), or with none named their whole
 * version. How many rows went; 0 when they had nothing to take back.
 */
export async function clearRecipeVariant(
    recipes: RecipesStore,
    variants: RecipeVariantsStore,
    input: {
        householdId: string;
        recipeId: string;
        userId: string;
        ingredientId?: string | null;
    },
): Promise<number> {
    const recipe = await recipes.getRecipe(input.householdId, input.recipeId);
    if (!recipe) throw new RecipeInputError("Unknown recipe.");
    if (input.ingredientId != null && input.ingredientId.trim() === "") {
        throw new RecipeInputError(
            "Name the change to clear, or leave ingredient_id out to clear the whole version.",
        );
    }
    const ref = input.ingredientId?.trim();
    if (ref) {
        return (await variants.deleteOverride(
            input.householdId,
            recipe.id,
            input.userId,
            ref,
        ))
            ? 1
            : 0;
    }
    return variants.clearVariant(input.householdId, recipe.id, input.userId);
}

/** One quantity as a recipe line holds it; null is "to taste". */
type LineQuantity = { amount: number; unit: string } | null;

/**
 * How one person's version differs from the base at one place. `ref` is what
 * `alignChange` takes to name the change: the base ingredient's id, or, for an
 * added line, the id of the person's own row. `rowKey` names that row as it
 * was read, so an align can tell it was saved again since.
 */
export type VersionDifference =
    | {
          kind: "removed";
          ref: string;
          /** Names the stored row as shown (`overrideKey`); align posts it back. */
          rowKey: string;
          ingredientId: string;
          displayName: string;
          base: LineQuantity;
      }
    | {
          kind: "amount";
          ref: string;
          /** Names the stored row as shown (`overrideKey`); align posts it back. */
          rowKey: string;
          ingredientId: string;
          displayName: string;
          base: LineQuantity;
          version: LineQuantity;
      }
    | {
          kind: "swapped";
          ref: string;
          /** Names the stored row as shown (`overrideKey`); align posts it back. */
          rowKey: string;
          ingredientId: string;
          /** The base's own name for the line. */
          displayName: string;
          foodId: string | null;
          /** The name of the food the person uses instead. */
          foodName: string;
          base: LineQuantity;
          version: LineQuantity;
      }
    | {
          kind: "added";
          ref: string;
          /** Names the stored row as shown (`overrideKey`); align posts it back. */
          rowKey: string;
          ingredientId: null;
          displayName: string;
          foodId: string | null;
          version: LineQuantity;
      };

/** Every difference between one person's version and the base, base order first. */
export function versionDifferences(
    recipe: { id: string; ingredients: readonly RecipeIngredient[] },
    overrides: readonly RecipeVariantOverride[],
    userId: string,
): VersionDifference[] {
    return differencesOf(
        recipe,
        variantFor(recipe, overrides, userId),
        overrides,
    );
}

function differencesOf(
    recipe: { ingredients: readonly RecipeIngredient[] },
    version: RecipeVariant,
    overrides: readonly RecipeVariantOverride[],
): VersionDifference[] {
    const out: VersionDifference[] = [];
    // The stored row behind a change: the person's row on a base ingredient,
    // or, for an added line, the row whose id the line carries.
    const keyOf = (ref: string, added: boolean) => {
        const row = overrides.find(
            (r) =>
                sameMember(r.userId, version.userId) &&
                (added ? r.id === ref : r.ingredientId === ref),
        );
        return row ? overrideKey(row) : "";
    };
    const gone = new Set(version.removed.map((row) => row.id));
    for (const base of recipe.ingredients) {
        if (gone.has(base.id)) {
            out.push({
                kind: "removed",
                ref: base.id,
                rowKey: keyOf(base.id, false),
                ingredientId: base.id,
                displayName: base.displayName,
                base: base.quantity,
            });
            continue;
        }
        const line = version.ingredients.find(
            (row) => row.baseIngredientId === base.id && row.change,
        );
        if (line?.change === "amount") {
            out.push({
                kind: "amount",
                ref: base.id,
                rowKey: keyOf(base.id, false),
                ingredientId: base.id,
                displayName: base.displayName,
                base: base.quantity,
                version: line.quantity,
            });
        } else if (line?.change === "food") {
            out.push({
                kind: "swapped",
                ref: base.id,
                rowKey: keyOf(base.id, false),
                ingredientId: base.id,
                displayName: base.displayName,
                foodId: line.foodId,
                foodName: line.displayName,
                base: base.quantity,
                version: line.quantity,
            });
        }
    }
    for (const line of version.ingredients) {
        if (line.change !== "add") continue;
        out.push({
            kind: "added",
            ref: line.id,
            rowKey: keyOf(line.id, true),
            ingredientId: null,
            displayName: line.displayName,
            foodId: line.foodId,
            version: line.quantity,
        });
    }
    return out;
}

export type VersionsCompare = {
    recipeId: string;
    /** The base recipe's lines, in order. */
    base: {
        ingredientId: string;
        displayName: string;
        foodId: string | null;
        quantity: LineQuantity;
    }[];
    /** Members with a version, in the order given, and how theirs differs. */
    versions: {
        userId: string;
        overrideCount: number;
        differences: VersionDifference[];
    }[];
    /** Members who use the base as it is. */
    usingBase: string[];
};

/**
 * The admin's compare view: the base lines, each member's differences from
 * them, and who has no version. Only `memberIds` are looked at, so a row left
 * by someone who has since left the household shows nowhere.
 */
export function compareVersions(
    recipe: { id: string; ingredients: readonly RecipeIngredient[] },
    overrides: readonly RecipeVariantOverride[],
    memberIds: readonly string[],
): VersionsCompare {
    const versions: VersionsCompare["versions"] = [];
    const usingBase: string[] = [];
    for (const userId of memberIds) {
        const version = variantFor(recipe, overrides, userId);
        if (version.overrideCount === 0) {
            usingBase.push(userId);
            continue;
        }
        versions.push({
            userId,
            overrideCount: version.overrideCount,
            differences: differencesOf(recipe, version, overrides),
        });
    }
    return {
        recipeId: recipe.id,
        base: recipe.ingredients.map((row) => ({
            ingredientId: row.id,
            displayName: row.displayName,
            foodId: row.foodId,
            quantity: row.quantity ? { ...row.quantity } : null,
        })),
        versions,
        usingBase,
    };
}

/** The same food in the same amount. */
function sameLine(
    a: { foodId: string | null; quantity: LineQuantity },
    b: { foodId: string | null; quantity: LineQuantity },
): boolean {
    return a.foodId === b.foodId && sameQuantity(a.quantity, b.quantity);
}

function sameQuantity(a: LineQuantity, b: LineQuantity): boolean {
    if (a == null || b == null) return a == null && b == null;
    const close = (x: number, y: number) =>
        Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
    const ua = canonicalUnitText(a.unit);
    const ub = canonicalUnitText(b.unit);
    if (ua === ub) return close(a.amount, b.amount);
    // Same dimension (50 g, 0.05 kg): compare exactly, not through the
    // display rounding `amountInUnit` applies.
    if (isQuantityUnit(ua) && isQuantityUnit(ub)) {
        return (
            dimensionOf(ua) === dimensionOf(ub) &&
            close(
                a.amount * canonicalFactor(ua),
                b.amount * canonicalFactor(ub),
            )
        );
    }
    return false;
}

export type AlignResult = {
    kind: "amount" | "swapped" | "added";
    /** The base ingredient that changed, or the one the added line became. */
    ingredientId: string;
    /** Overrides taken away because the base now says the same. */
    removed: number;
    /** Added lines of other people that became an amount on the new base line. */
    converted: number;
    /** Other people's overrides that stay because they still differ. */
    kept: { userId: string; action: VariantAction }[];
};

export type AlignDeps = {
    recipes: RecipesStore;
    /** The catalog: a food an align puts in the base is checked against it. */
    foods: FoodsStore;
    variants: RecipeVariantsStore;
    /** Runs the whole align as one unit; the live one is a database transaction. */
    transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
};

/**
 * Pushes one person's change into the base recipe, for everyone.
 *
 * - An amount or a swap on a base ingredient: the base ingredient takes that
 *   amount, or that food and amount.
 * - An added line: it becomes a base ingredient, after the last.
 * - A removal is refused: taking an ingredient out of the base is a recipe
 *   edit, and would silently drop what other people set on it.
 *
 * Afterwards the person's own row is gone. Everyone else keeps cooking what
 * they cooked before: another person's row on that ingredient goes only when
 * what it gave them is what the new base says with no row at all; a row that
 * still differs stays (50 g next to a base of 150 g is still theirs), and one
 * the change would have altered (an amount under a new food, a swap that
 * followed the base amount) is rewritten to say what they had. Another
 * person's added line of the same food becomes an amount on the new base
 * ingredient when its amount differs, so they never get the food twice.
 *
 * A verified recipe is not allowed to fail its check because of the change.
 * Everything runs in one transaction.
 */
export async function alignChange(
    deps: AlignDeps,
    input: {
        householdId: string;
        recipeId: string;
        userId: string;
        ref: string;
        /** The change as the admin saw it (`VersionDifference.rowKey`). */
        rowKey: string;
    },
): Promise<AlignResult> {
    const run = deps.transaction ?? (<T>(fn: () => Promise<T>) => fn());
    return run(async () => {
        const { recipes, foods, variants } = deps;
        // The base ingredient is locked before anything is read: a base edit
        // that commits while this waits is then what everything below reads
        // and decides from. It is also locked before any override row is
        // touched: removing the ingredient locks it and then cascades to its
        // overrides, so the other order could deadlock with that. The ref of
        // an added line names no ingredient and locks nothing; one that is
        // gone or is not this recipe's is found missing below.
        await variants.lockBaseIngredient(input.householdId, input.ref);
        const recipe = await recipes.getRecipe(
            input.householdId,
            input.recipeId,
        );
        if (!recipe) throw new RecipeInputError("Unknown recipe.");
        const base = await recipes.listIngredients(
            input.householdId,
            recipe.id,
        );
        const all = await variants.listOverrides(input.householdId, recipe.id);
        const gone = () =>
            new RecipeInputError("That change no longer exists.");
        const chosen = all.find(
            (row) =>
                sameMember(row.userId, input.userId) &&
                (row.action === "add"
                    ? row.id === input.ref
                    : row.ingredientId === input.ref &&
                      base.some((b) => b.id === row.ingredientId)),
        );
        if (!chosen) throw gone();
        // The admin saw one version of this change; push that one, not
        // whatever the person has saved since.
        if (overrideKey(chosen) !== input.rowKey) {
            throw new RecipeInputError("Their change changed; look again.");
        }
        if (chosen.action === "remove") {
            throw new RecipeInputError(
                "A removed ingredient can't be aligned: take it out of the recipe itself.",
            );
        }

        // What the base looks like afterwards.
        let target: RecipeIngredient;
        let proposed: RecipeIngredient[];
        const isNew = chosen.action === "add";
        const old = isNew
            ? undefined
            : base.find((row) => row.id === chosen.ingredientId)!;
        // The food the line becomes, by its catalog name; the stored name
        // stands in only for a row that names no food (which the check below
        // refuses on a verified recipe).
        const food =
            chosen.foodId == null
                ? null
                : await findCatalogFood(
                      foods,
                      input.householdId,
                      chosen.foodId,
                  );
        if (isNew) {
            const quantity =
                chosen.amount == null
                    ? null
                    : { amount: chosen.amount, unit: chosen.unit ?? "g" };
            target = {
                id: crypto.randomUUID(),
                householdId: input.householdId,
                recipeId: recipe.id,
                kind: "food",
                displayName: food?.name ?? chosen.displayName ?? "",
                quantity,
                foodId: chosen.foodId,
                sortOrder:
                    base.reduce(
                        (max, row) => Math.max(max, row.sortOrder),
                        -1,
                    ) + 1,
                note: noteForUnmeasuredIngredient(quantity, null),
            };
            proposed = [...base, target];
        } else {
            const line = variantFor(
                { id: recipe.id, ingredients: base },
                [chosen],
                chosen.userId,
            ).ingredients.find((row) => row.baseIngredientId === old!.id)!;
            target = {
                ...old!,
                foodId: line.foodId,
                displayName: food?.name ?? line.displayName,
                quantity: line.quantity,
                note: noteForUnmeasuredIngredient(line.quantity, old!.note),
            };
            proposed = base.map((row) => (row.id === old!.id ? target : row));
        }

        // A saved recipe must not break: the same refusal every base edit
        // uses, and before the person's row is dropped, so a refused align
        // keeps it.
        assertEditKeepsCheck(
            { recipe, ingredients: base },
            { recipe, ingredients: proposed },
            await recipes.getImport(input.householdId, recipe.id),
        );
        if (target.foodId == null) {
            throw new RecipeInputError("That change names no food.");
        }

        // Every row taken away is taken only while it is still what was read
        // above: a person who saved something newer in between keeps it, and
        // the align stops. Nothing is changed before the person's own row is
        // confirmed.
        const changed = () =>
            new RecipeInputError(
                "A version changed while it was being aligned. Nothing was changed; try again.",
            );
        const result: AlignResult = {
            kind: isNew
                ? "added"
                : chosen.action === "food"
                  ? "swapped"
                  : "amount",
            ingredientId: target.id,
            removed: 0,
            converted: 0,
            kept: [],
        };
        // `counted` is false for a row that is replaced rather than dropped.
        const drop = async (row: RecipeVariantOverride, counted = true) => {
            const deleted = await variants.deleteOverrideIfUnchanged(
                input.householdId,
                row,
            );
            if (!deleted) throw changed();
            if (counted) result.removed++;
        };
        await drop(chosen);

        // The base edit goes through the same functions a person editing the
        // recipe uses.
        if (isNew) {
            const saved = await addRecipeIngredientById(recipes, foods, {
                householdId: input.householdId,
                recipeId: recipe.id,
                foodId: target.foodId,
                amount: target.quantity?.amount ?? null,
                unit: target.quantity?.unit,
            });
            target = saved;
            result.ingredientId = saved.id;
            proposed = [...base, saved];
        } else if (chosen.action === "food") {
            await swapRecipeIngredientFood(recipes, foods, {
                householdId: input.householdId,
                recipeId: recipe.id,
                ingredientId: old!.id,
                foodId: target.foodId,
                amount: target.quantity?.amount ?? null,
                unit: target.quantity?.unit,
            });
        } else {
            await updateRecipeIngredient(
                recipes,
                input.householdId,
                recipe.id,
                old!.id,
                {
                    amount: target.quantity?.amount ?? null,
                    unit: target.quantity?.unit,
                },
                foods,
            );
        }

        // What the base ingredient is now, as saved.
        if (!isNew) {
            const saved = (
                await recipes.listIngredients(input.householdId, recipe.id)
            ).find((row) => row.id === old!.id);
            if (saved) {
                target = saved;
                proposed = base.map((row) =>
                    row.id === old!.id ? saved : row,
                );
            }
        }

        // Clean up the rows the base now makes redundant.
        const afterwards = { id: recipe.id, ingredients: proposed };
        for (const row of all) {
            if (row.id === chosen.id) continue;
            if (isNew) {
                if (row.action !== "add" || row.foodId !== chosen.foodId) {
                    continue;
                }
                const theirs =
                    row.amount == null
                        ? null
                        : { amount: row.amount, unit: row.unit ?? "g" };
                if (sameQuantity(theirs, target.quantity)) {
                    await drop(row);
                    continue;
                }
                await drop(row, false);
                await variants.saveOverride({
                    householdId: input.householdId,
                    recipeId: recipe.id,
                    userId: row.userId,
                    ingredientId: target.id,
                    action: "amount",
                    amount: row.amount,
                    unit: row.unit,
                    defaultUnit: target.quantity?.unit ?? null,
                });
                result.converted++;
                result.kept.push({ userId: row.userId, action: "amount" });
                continue;
            }
            if (row.ingredientId !== target.id || row.action === "add") {
                continue;
            }
            if (row.action === "remove") {
                result.kept.push({ userId: row.userId, action: row.action });
                continue;
            }
            // Everyone else cooks exactly what they cooked before the align:
            // the food and the amount their row gave them over the old base.
            const lineOf = (ingredients: readonly RecipeIngredient[]) =>
                variantFor(
                    { id: recipe.id, ingredients },
                    [row],
                    row.userId,
                ).ingredients.find(
                    (entry) => entry.baseIngredientId === target.id,
                )!;
            const cookedBefore = lineOf(base);
            if (sameLine(cookedBefore, target)) {
                // They would cook this with no row at all.
                await drop(row);
                continue;
            }
            if (sameLine(lineOf(afterwards.ingredients), cookedBefore)) {
                result.kept.push({ userId: row.userId, action: row.action });
                continue;
            }
            // Their row no longer gives them that (a swap changed the food
            // under their amount, or the base amount they followed moved):
            // say it outright.
            const keepsFood = cookedBefore.foodId === target.foodId;
            const quantity = cookedBefore.quantity;
            await drop(row, false);
            await variants.saveOverride({
                householdId: input.householdId,
                recipeId: recipe.id,
                userId: row.userId,
                ingredientId: target.id,
                action: keepsFood ? "amount" : "food",
                amount: quantity?.amount ?? null,
                // No amount with a unit is "to taste".
                unit: quantity?.unit ?? "g",
                ...(keepsFood
                    ? {}
                    : {
                          foodId: cookedBefore.foodId,
                          displayName: cookedBefore.displayName,
                      }),
            });
            result.kept.push({
                userId: row.userId,
                action: keepsFood ? "amount" : "food",
            });
        }

        return result;
    });
}

/** A catalog food a change names, or a refusal in the recipes' own words. */
async function findCatalogFood(
    foods: FoodsStore,
    householdId: string,
    foodId: string,
) {
    try {
        const food = await findFoodById(foods, householdId, foodId);
        if (food.kind !== "food") {
            throw new RecipeInputError("That catalog item is a supply.");
        }
        return food;
    } catch (err) {
        if (err instanceof FoodsInputError) {
            throw new RecipeInputError(err.message);
        }
        throw err;
    }
}

async function ownRows(
    recipes: RecipesStore,
    variants: RecipeVariantsStore,
    input: { householdId: string; recipeId: string; userId: string },
) {
    const recipe = await recipes.getRecipe(input.householdId, input.recipeId);
    if (!recipe) throw new RecipeInputError("Unknown recipe.");
    const all = await variants.listOverrides(input.householdId, recipe.id);
    const mine = all.filter((row) => sameMember(row.userId, input.userId));
    if (mine.length === 0) {
        throw new RecipeInputError(
            "That person has no version of this recipe.",
        );
    }
    return { recipe, all, mine };
}

/**
 * What names one stored row to a confirm: its id and when it was last saved,
 * so a row saved again since the preview no longer matches.
 */
export function overrideKey(row: { id: string; updatedAt: string }): string {
    return `${row.id}@${row.updatedAt}`;
}

/**
 * What a reset would take back, changing nothing: how many rows, which ones
 * (`rowKeys`, which the confirm hands back), and how the person's version
 * differs from the base. Refused when they have no version.
 */
export async function previewReset(
    recipes: RecipesStore,
    variants: RecipeVariantsStore,
    input: { householdId: string; recipeId: string; userId: string },
): Promise<{
    userId: string;
    overrideCount: number;
    rowKeys: string[];
    differences: VersionDifference[];
}> {
    const { recipe, all, mine } = await ownRows(recipes, variants, input);
    const base = await recipes.listIngredients(input.householdId, recipe.id);
    return {
        userId: mine[0]!.userId,
        overrideCount: mine.length,
        rowKeys: mine.map(overrideKey),
        differences: versionDifferences(
            { id: recipe.id, ingredients: base },
            all,
            input.userId,
        ),
    };
}

/**
 * Takes back the rows an admin was shown (`rowKeys` from `previewReset`) and
 * nothing else, so the person reads the base again. How many rows went.
 * Refused, with nothing taken, when they had no version or when their rows are
 * no longer exactly those: a row added or saved again since the preview is
 * one the admin never saw.
 */
export async function resetVariant(
    recipes: RecipesStore,
    variants: RecipeVariantsStore,
    input: {
        householdId: string;
        recipeId: string;
        userId: string;
        rowKeys: readonly string[];
        /** Runs the reset as one unit; the live one is a database transaction. */
        transaction?: <T>(fn: () => Promise<T>) => Promise<T>;
    },
): Promise<number> {
    const run = input.transaction ?? (<T>(fn: () => Promise<T>) => fn());
    return run(async () => {
        const { mine } = await ownRows(recipes, variants, input);
        const changed = () =>
            new RecipeInputError("Their version changed; look again.");
        const shown = new Set(input.rowKeys);
        if (
            shown.size !== mine.length ||
            mine.some((row) => !shown.has(overrideKey(row)))
        ) {
            throw changed();
        }
        for (const row of mine) {
            if (
                !(await variants.deleteOverrideIfUnchanged(
                    input.householdId,
                    row,
                ))
            ) {
                throw changed();
            }
        }
        return mine.length;
    });
}
