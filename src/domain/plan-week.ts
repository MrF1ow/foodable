// Reading the household's week plan: which recipes sit on which day, and what
// they need that the kitchen does not already hold. Pure functions over plans,
// recipes and stock; `addMissingToGroceries` is the one adapter, and it goes
// through the same add-line path as every other grocery source.

import { familyIdOf, type FoodQuantityFactors } from "./food-quantity.js";
import type { FoodsStore } from "./foods.js";
import {
    addGroceryFoodById,
    GroceryInputError,
    type GroceryLine,
    type GroceryListStore,
} from "./grocery.js";
import {
    amountInUnit,
    type LinkedNeed,
    type LinkedQuantity,
    type RecipeGroceryIngredient,
} from "./linking.js";
import {
    checkPlanDate,
    planSlotRank,
    type PlanSlot,
    type RecipePlan,
} from "./plan.js";
import { dimensionOf, isQuantityUnit } from "./quantity.js";
import type { SettingsStore } from "./settings.js";

/** Days the week view covers. */
export const WEEK_PLAN_DAYS = 7;

function roundAmount(amount: number): number {
    return Math.round(amount * 10) / 10;
}

/** `date` moved by `days` calendar days, both written `YYYY-MM-DD`. */
export function addPlanDays(date: string, days: number): string {
    const probe = new Date(`${checkPlanDate(date)}T00:00:00Z`);
    probe.setUTCDate(probe.getUTCDate() + days);
    return probe.toISOString().slice(0, 10);
}

function compareDayThenSlot(a: RecipePlan, b: RecipePlan): number {
    return (
        a.date.localeCompare(b.date) ||
        planSlotRank(a.slot) - planSlotRank(b.slot) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id)
    );
}

export type WeekPlanDay = {
    date: string;
    /** In slot order. */
    plans: RecipePlan[];
};

/**
 * `days` days from `from` (the week view passes today), each with the plans
 * on it in slot order. Plans before `from`, or after the last day, belong to
 * no day: a plan left in the past is hidden, never deleted.
 */
export function weekPlan(
    plans: readonly RecipePlan[],
    from: string,
    days: number = WEEK_PLAN_DAYS,
): WeekPlanDay[] {
    const sorted = [...plans].sort(compareDayThenSlot);
    const out: WeekPlanDay[] = [];
    for (let i = 0; i < days; i++) {
        const date = addPlanDays(from, i);
        out.push({
            date,
            plans: sorted.filter((p) => p.date === date).map((p) => ({ ...p })),
        });
    }
    return out;
}

/** The recipe facts `missingForPlan` needs, keyed by recipe id. */
export type PlanRecipe = {
    id: string;
    name: string;
    yieldPortions: number;
    ingredients: RecipeGroceryIngredient[];
};

/** One planned recipe that needs a missing food. */
export type PlanNeed = {
    planId: string;
    recipeId: string;
    recipeName: string;
    date: string;
    slot: PlanSlot;
    servings: number;
    /** What this plan alone needs, scaled by servings; null for an unmeasured ingredient. */
    need: LinkedQuantity | null;
};

export type PlanMissingLine = {
    /** An ingredient's food; null when the recipe line names no food. */
    foodId: string | null;
    displayName: string;
    /** Everything the plans in the window need of this food, in `missing`'s unit. */
    need: LinkedQuantity | null;
    /** What the kitchen holds in that unit, null when none was counted. */
    have: LinkedQuantity | null;
    /**
     * What is short, in the recipe's unit. Null for an ingredient with no
     * amount. When `unknown` it is the full recipe amount, not a guess.
     */
    missing: LinkedQuantity | null;
    /**
     * A unit could not be converted (no grams-per-each or grams-per-ml on
     * the food), so what is short cannot be worked out.
     */
    unknown: boolean;
    /** The recipe gives no amount ("salt, to taste"). */
    unmeasured: boolean;
    neededBy: PlanNeed[];
};

export type MissingForPlanOptions = {
    /** First day of the window, `YYYY-MM-DD`. */
    from: string;
    /** Days in the window, `from` included: 7 for the week, 3 for a heads-up. */
    days: number;
    foodsById?: ReadonlyMap<string, FoodQuantityFactors>;
};

function factorsOf(
    foodId: string | null | undefined,
    foodsById: ReadonlyMap<string, FoodQuantityFactors>,
): FoodQuantityFactors | undefined {
    return foodId ? foodsById.get(foodId) : undefined;
}

/**
 * `q` in `to`, by the one conversion `linking` uses: a unit of the same kind
 * converts directly, anything else goes through grams. Either side may know the
 * factor, so they are merged first. Null when it cannot.
 */
function amountIn(
    q: LinkedQuantity,
    to: string,
    holder: FoodQuantityFactors | undefined,
    wanter: FoodQuantityFactors | undefined,
): number | null {
    return amountInUnit(q, to, holder, {
        gramsPerEach: holder?.gramsPerEach ?? wanter?.gramsPerEach ?? null,
        gramsPerMl: holder?.gramsPerMl ?? wanter?.gramsPerMl ?? null,
    });
}

/** Units that convert straight into each other share a kind; anything else stands alone. */
function unitKind(unit: string): string {
    return isQuantityUnit(unit) ? dimensionOf(unit) : `unit:${unit}`;
}

const KIND_RANK: Record<string, number> = { mass: 0, volume: 1, count: 2 };

function compareKinds(a: string, b: string): number {
    return (KIND_RANK[a] ?? 3) - (KIND_RANK[b] ?? 3) || a.localeCompare(b);
}

type Entry = { info: Omit<PlanNeed, "need">; need: LinkedQuantity | null };

/** Everything needed in one kind of unit, summed in the unit it was first met in. */
type Bucket = {
    kind: string;
    unit: string;
    amount: number;
    entries: Entry[];
};

type Group = {
    key: string;
    foodId: string | null;
    displayName: string;
    /** The factors any food of the family is known by. */
    food: FoodQuantityFactors | undefined;
    buckets: Map<string, Bucket>;
    unmeasured: Entry[];
};

function asNeeds(entries: Entry[]): PlanNeed[] {
    return entries.map((e) => ({ ...e.info, need: e.need }));
}

/**
 * Buckets of one food, by kind of unit and in a fixed kind order, so the
 * result does not depend on the order plans were given in. A bucket whose
 * amount converts into an earlier one (the food has a density, or a weight per
 * piece) joins it; the rest stay their own.
 */
function baseBuckets(group: Group): Bucket[] {
    const ordered = [...group.buckets.values()].sort((a, b) =>
        compareKinds(a.kind, b.kind),
    );
    const bases: Bucket[] = [];
    for (const bucket of ordered) {
        let joined = false;
        for (const base of bases) {
            const amount = amountIn(
                { amount: bucket.amount, unit: bucket.unit },
                base.unit,
                group.food,
                group.food,
            );
            if (amount == null) continue;
            base.amount += amount;
            base.entries.push(...bucket.entries);
            joined = true;
            break;
        }
        if (!joined) bases.push({ ...bucket, entries: [...bucket.entries] });
    }
    return bases;
}

/**
 * What the plans in the window need beyond the stock. Needs are summed per
 * food family across plans (scaled by the plan's servings over the recipe's
 * yield), stock of the same family is subtracted per kind of unit, and a food
 * the stock fully covers is left out. Plans before `from` or after the window
 * are ignored, and so are plans whose recipe is not in `recipes`.
 *
 * A quantity that cannot be converted, because the food has no grams-per-each
 * or grams-per-ml, is never guessed. When the stock that can be counted does
 * not cover the need and some stock cannot be counted, the line comes back with
 * `unknown: true` and the full recipe amount.
 */
export function missingForPlan(
    plans: readonly RecipePlan[],
    recipes: readonly PlanRecipe[],
    stock: readonly LinkedNeed[],
    options: MissingForPlanOptions,
): PlanMissingLine[] {
    const foodsById = options.foodsById ?? new Map();
    const last = addPlanDays(options.from, options.days - 1);
    const recipeById = new Map(recipes.map((r) => [r.id, r]));
    const groups = new Map<string, Group>();

    const inWindow = plans
        .filter((p) => p.date >= options.from && p.date <= last)
        .sort(compareDayThenSlot);
    for (const plan of inWindow) {
        const recipe = recipeById.get(plan.recipeId);
        if (!recipe || !(recipe.yieldPortions > 0)) continue;
        const scale = plan.servings / recipe.yieldPortions;
        const info = {
            planId: plan.id,
            recipeId: recipe.id,
            recipeName: recipe.name,
            date: plan.date,
            slot: plan.slot,
            servings: plan.servings,
        };
        for (const ingredient of recipe.ingredients) {
            const key = ingredient.foodId
                ? familyIdOf(ingredient.foodId, foodsById)
                : `name:${ingredient.displayName.trim().toLowerCase()}`;
            const factors = factorsOf(ingredient.foodId, foodsById);
            let group = groups.get(key);
            if (!group) {
                group = {
                    key,
                    foodId: ingredient.foodId ?? null,
                    displayName: ingredient.displayName,
                    food: factors,
                    buckets: new Map(),
                    unmeasured: [],
                };
                groups.set(key, group);
            } else if (factors) {
                group.food = {
                    gramsPerEach:
                        group.food?.gramsPerEach ?? factors.gramsPerEach,
                    gramsPerMl: group.food?.gramsPerMl ?? factors.gramsPerMl,
                };
            }
            const q = ingredient.quantity;
            if (q == null) {
                group.unmeasured.push({ info, need: null });
                continue;
            }
            const scaled = q.amount * scale;
            const entry: Entry = {
                info,
                need: { amount: roundAmount(scaled), unit: q.unit },
            };
            const kind = unitKind(q.unit);
            const bucket = group.buckets.get(kind);
            if (!bucket) {
                group.buckets.set(kind, {
                    kind,
                    unit: q.unit,
                    amount: scaled,
                    entries: [entry],
                });
                continue;
            }
            bucket.amount +=
                amountIn(
                    { amount: scaled, unit: q.unit },
                    bucket.unit,
                    undefined,
                    undefined,
                ) ?? scaled;
            bucket.entries.push(entry);
        }
    }

    const lines: PlanMissingLine[] = [];
    for (const group of groups.values()) {
        const held = stock.filter(
            (row) =>
                group.foodId != null &&
                row.foodId != null &&
                familyIdOf(row.foodId, foodsById) === group.key,
        );
        const bases = baseBuckets(group);
        // Each row counts toward the first kind of unit it converts into, but
        // stays unknown to every kind it cannot convert into.
        const used = new Set<LinkedNeed>();
        const rows = held.filter(
            (row) => row.quantity != null && row.quantity.amount > 0,
        );

        for (const bucket of bases) {
            const need = roundAmount(bucket.amount);
            if (!(need > 0)) continue;
            let have = 0;
            let counted = 0;
            let uncounted = 0;
            for (const row of rows) {
                const converted = amountIn(
                    row.quantity!,
                    bucket.unit,
                    factorsOf(row.foodId, foodsById),
                    group.food,
                );
                if (converted == null) {
                    uncounted += 1;
                    continue;
                }
                if (used.has(row)) continue;
                used.add(row);
                have += converted;
                counted += 1;
            }
            have = roundAmount(have);
            const short = roundAmount(need - have);
            // What can be counted covers it: stock that cannot be counted
            // does not change that.
            if (counted > 0 && short <= 0) continue;
            const unknown = uncounted > 0;
            lines.push({
                foodId: group.foodId,
                displayName: group.displayName,
                need: { amount: need, unit: bucket.unit },
                have: counted > 0 ? { amount: have, unit: bucket.unit } : null,
                missing: {
                    amount: unknown ? need : short,
                    unit: bucket.unit,
                },
                unknown,
                unmeasured: false,
                neededBy: asNeeds(bucket.entries),
            });
        }

        if (
            bases.length === 0 &&
            group.unmeasured.length > 0 &&
            !held.some((row) => (row.quantity?.amount ?? 0) > 0)
        ) {
            lines.push({
                foodId: group.foodId,
                displayName: group.displayName,
                need: null,
                have: null,
                missing: null,
                unknown: false,
                unmeasured: true,
                neededBy: asNeeds(group.unmeasured),
            });
        }
    }

    return lines.sort(
        (a, b) =>
            (a.neededBy[0]?.date ?? "").localeCompare(
                b.neededBy[0]?.date ?? "",
            ) || a.displayName.localeCompare(b.displayName),
    );
}

/**
 * The sentence that goes with an `unknown` line added to the list. `added` is
 * what was put on the list; it is the line's full amount unless the list
 * already held some of it.
 */
export function unknownMissingNotice(
    line: PlanMissingLine,
    added: LinkedQuantity | null = line.missing,
): string {
    const full =
        line.missing != null &&
        added != null &&
        added.unit === line.missing.unit &&
        added.amount === line.missing.amount;
    const what = !added
        ? "the full amount"
        : full
          ? `the full ${added.amount} ${added.unit}`
          : `${added.amount} ${added.unit} more`;
    return `${line.displayName}: can't tell how much of it you already have, so ${what} is on the list.`;
}

export type AddMissingToGroceriesResult = {
    added: GroceryLine[];
    /** Lines the list already covers (a line of the food is on it); nothing was added. */
    onList: { line: PlanMissingLine; existing: GroceryLine }[];
    /**
     * Lines added although the list holds the food too: what the list holds
     * covered some of it, or was in a unit that cannot be compared, so the
     * UI can show both.
     */
    alsoOnList: {
        line: PlanMissingLine;
        added: GroceryLine;
        existing: GroceryLine[];
    }[];
    /** Lines added with the recipe's amount because what is held could not be counted. */
    unknown: { line: PlanMissingLine; notice: string }[];
    /** Lines that could not be added, with why. */
    skipped: { line: PlanMissingLine; reason: string }[];
};

/**
 * Puts `lines` (from `missingForPlan`) on the grocery list with source `plan`.
 *
 * A food already on the list is not doubled. An unmeasured ingredient is left
 * off when any line of the food is there, checked or not. A measured one has
 * the unchecked lines of the food (a product stands for its plain food) taken
 * off what is added, when their unit converts; the list covering it all adds
 * nothing, and a line in a unit that cannot be compared adds the full amount
 * and is reported in `alsoOnList`. Lines of this same call never count against
 * each other. Ingredients are always plain foods: a recipe has no supplies.
 * The store comes from the usual pick unless `storeId` names one.
 */
export async function addMissingToGroceries(
    grocery: GroceryListStore,
    settings: SettingsStore,
    foods: FoodsStore,
    input: {
        householdId: string;
        lines: readonly PlanMissingLine[];
        storeId?: string;
    },
): Promise<AddMissingToGroceriesResult> {
    const stores = await settings.listStores(input.householdId);
    if (stores.length === 0) throw new GroceryInputError("Add a store first.");

    const listed = await foods.listFoods(input.householdId);
    const foodsById = new Map<
        string,
        FoodQuantityFactors & { genericFoodId: string | null }
    >(
        listed.map((row) => [
            row.id,
            {
                genericFoodId: row.genericFoodId,
                gramsPerEach: row.gramsPerEach,
                gramsPerMl: row.gramsPerMl,
            },
        ]),
    );
    const before = await grocery.listLines(input.householdId);
    const result: AddMissingToGroceriesResult = {
        added: [],
        onList: [],
        alsoOnList: [],
        unknown: [],
        skipped: [],
    };

    for (const line of input.lines) {
        if (!line.foodId) {
            result.skipped.push({ line, reason: "no food" });
            continue;
        }
        const family = familyIdOf(line.foodId, foodsById);
        const sameFood = before.filter(
            (row) =>
                row.foodId != null &&
                familyIdOf(row.foodId, foodsById) === family,
        );
        const open = sameFood.filter((row) => !row.checked);

        let amount = line.missing?.amount;
        if (line.missing == null) {
            if (sameFood[0]) {
                result.onList.push({ line, existing: sameFood[0] });
                continue;
            }
        } else {
            let covered = 0;
            let first: GroceryLine | undefined;
            for (const row of open) {
                const converted = amountIn(
                    row.quantity,
                    line.missing.unit,
                    foodsById.get(row.foodId!),
                    foodsById.get(line.foodId),
                );
                if (converted == null) continue;
                covered += converted;
                first ??= row;
            }
            if (first) {
                const rest = roundAmount(line.missing.amount - covered);
                if (rest <= 0) {
                    result.onList.push({ line, existing: first });
                    continue;
                }
                amount = rest;
            }
        }

        try {
            let inserted = await addGroceryFoodById(grocery, settings, foods, {
                householdId: input.householdId,
                storeId: input.storeId,
                foodId: line.foodId,
                amount,
                unit: line.missing?.unit,
                source: "plan",
            });
            if (line.unmeasured) {
                const noted = await grocery.updateLine({
                    ...inserted,
                    note: "to taste",
                });
                if (noted) inserted = noted;
            }
            result.added.push(inserted);
            if (open.length > 0) {
                result.alsoOnList.push({
                    line,
                    added: inserted,
                    existing: open,
                });
            }
            if (line.unknown) {
                result.unknown.push({
                    line,
                    notice: unknownMissingNotice(line, inserted.quantity),
                });
            }
        } catch (err) {
            if (err instanceof GroceryInputError) {
                result.skipped.push({ line, reason: err.message });
                continue;
            }
            throw err;
        }
    }
    return result;
}
